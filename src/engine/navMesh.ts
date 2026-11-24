import * as THREE from 'three';
import type { Floor, Opening, SpatialAsset, Wall } from '../types/twin';
import { getAssetBounds } from '../utils/spatial';

export interface FloorNavMesh {
  floorId: string;
  cellSize: number;
  cols: number;
  rows: number;
  width: number;
  depth: number;
  /** 1 = walkable, 0 = blocked by wall or equipment */
  grid: Uint8Array;
  walkableCount: number;
  totalCount: number;
  walkablePercent: number;
  isWalkable: (x: number, z: number) => boolean;
  resolveMove: (fromX: number, fromZ: number, toX: number, toZ: number) => { x: number; z: number; collided: boolean };
  findNearestWalkable: (x: number, z: number) => { x: number; z: number };
}

/**
 * Automatically computes a high-resolution walkable NavMesh for a floor by rasterizing:
 * 1. All architectural walls (with character shoulder clearance radius)
 * 2. Carving walkable doorway passages through all door openings
 * 3. Blocking all placed equipment/assets (accounting for footprint & rotation)
 */
export function buildFloorNavMesh(
  floor: Floor,
  walls: Wall[],
  openings: Opening[],
  assets: SpatialAsset[],
  cellSize = 0.4,
  agentRadius = 0.28
): FloorNavMesh {
  const width = Math.max(4, floor.width);
  const depth = Math.max(4, floor.depth);
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(depth / cellSize);
  const grid = new Uint8Array(cols * rows);
  grid.fill(1);

  const floorWalls = walls.filter((w) => w.floorId === floor.id);
  const floorOpenings = openings.filter((o) => o.floorId === floor.id && o.kind === 'door');
  const floorAssets = assets.filter((a) => a.floorId === floor.id && !a.hidden);

  // Precompute wall openings map
  const wallDoorsMap = new Map<string, Opening[]>();
  floorOpenings.forEach((op) => {
    const arr = wallDoorsMap.get(op.wallId) ?? [];
    arr.push(op);
    wallDoorsMap.set(op.wallId, arr);
  });

  // Helper: distance from point (px,pz) to segment (x1,z1)-(x2,z2) + projection parameter t in [0,1]
  const distToSeg = (px: number, pz: number, x1: number, z1: number, x2: number, z2: number) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-6) return { dist: Math.hypot(px - x1, pz - z1), t: 0, len: 0 };
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
    const projX = x1 + t * dx;
    const projZ = z1 + t * dz;
    return { dist: Math.hypot(px - projX, pz - projZ), t, len: Math.sqrt(lenSq) };
  };

  // Precompute asset AABBs with agent clearance
  const assetBoxes = floorAssets.map((a) => {
    const b = getAssetBounds(a);
    const pad = Math.min(agentRadius, 0.22);
    return {
      minX: b.minX - pad,
      maxX: b.maxX + pad,
      minZ: b.minZ - pad,
      maxZ: b.maxZ + pad,
    };
  });

  let walkableCount = 0;

  for (let r = 0; r < rows; r++) {
    const wz = (r + 0.5) * cellSize;
    for (let c = 0; c < cols; c++) {
      const wx = (c + 0.5) * cellSize;
      const idx = r * cols + c;

      // Stay inside slab perimeter
      if (wx < 0.25 || wx > width - 0.25 || wz < 0.25 || wz > depth - 0.25) {
        grid[idx] = 0;
        continue;
      }

      // Check walls (respecting door openings!)
      let blocked = false;
      for (const w of floorWalls) {
        const { dist, t, len } = distToSeg(wx, wz, w.x1, w.z1, w.x2, w.z2);
        const halfThick = w.thickness * 0.5 + agentRadius;
        if (dist <= halfThick) {
          // Check if this point falls inside a door opening along the wall
          const doors = wallDoorsMap.get(w.id);
          let insideDoor = false;
          if (doors && len > 0.1) {
            const along = t * len;
            for (const d of doors) {
              const center = d.offsetRatio * len;
              const clearHalf = Math.max(0.35, d.width * 0.5 - 0.06);
              if (Math.abs(along - center) <= clearHalf) {
                insideDoor = true;
                break;
              }
            }
          }
          if (!insideDoor) {
            blocked = true;
            break;
          }
        }
      }

      if (!blocked) {
        // Check equipment footprints
        for (const box of assetBoxes) {
          if (wx >= box.minX && wx <= box.maxX && wz >= box.minZ && wz <= box.maxZ) {
            blocked = true;
            break;
          }
        }
      }

      if (blocked) {
        grid[idx] = 0;
      } else {
        grid[idx] = 1;
        walkableCount++;
      }
    }
  }

  const isWalkable = (x: number, z: number) => {
    const c = Math.floor(x / cellSize);
    const r = Math.floor(z / cellSize);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
    return grid[r * cols + c] === 1;
  };

  const resolveMove = (fromX: number, fromZ: number, toX: number, toZ: number) => {
    if (isWalkable(toX, toZ)) {
      return { x: toX, z: toZ, collided: false };
    }
    // Smooth wall-sliding: try moving along X only, then Z only
    if (isWalkable(toX, fromZ)) {
      return { x: toX, z: fromZ, collided: true };
    }
    if (isWalkable(fromX, toZ)) {
      return { x: fromX, z: toZ, collided: true };
    }
    // If currently stuck inside an obstacle, allow stepping out gently
    if (!isWalkable(fromX, fromZ)) {
      return { x: toX, z: toZ, collided: true };
    }
    return { x: fromX, z: fromZ, collided: true };
  };

  const findNearestWalkable = (x: number, z: number) => {
    if (isWalkable(x, z)) return { x, z };
    const startC = Math.max(0, Math.min(cols - 1, Math.floor(x / cellSize)));
    const startR = Math.max(0, Math.min(rows - 1, Math.floor(z / cellSize)));
    for (let rad = 1; rad <= Math.max(cols, rows); rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
          const nc = startC + dc;
          const nr = startR + dr;
          if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && grid[nr * cols + nc] === 1) {
            return { x: (nc + 0.5) * cellSize, z: (nr + 0.5) * cellSize };
          }
        }
      }
    }
    return { x: width / 2, z: depth / 2 };
  };

  return {
    floorId: floor.id,
    cellSize,
    cols,
    rows,
    width,
    depth,
    grid,
    walkableCount,
    totalCount: cols * rows,
    walkablePercent: cols * rows > 0 ? Math.round((walkableCount / (cols * rows)) * 100) : 0,
    isWalkable,
    resolveMove,
    findNearestWalkable,
  };
}

/**
 * Generates a single merged, high-performance BufferGeometry for visualizing
 * the walkable NavMesh surface in 3D (violet translucent walkable polygons + subtle wireframe).
 */
export function buildNavMeshVisualGroup(navMesh: FloorNavMesh, yOffset = 0.09): THREE.Group {
  const group = new THREE.Group();
  const positions: number[] = [];
  const cs = navMesh.cellSize;
  const inset = cs * 0.06;

  for (let r = 0; r < navMesh.rows; r++) {
    for (let c = 0; c < navMesh.cols; c++) {
      if (navMesh.grid[r * navMesh.cols + c] !== 1) continue;
      const x0 = c * cs + inset;
      const x1 = (c + 1) * cs - inset;
      const z0 = r * cs + inset;
      const z1 = (r + 1) * cs - inset;

      // Two triangles per walkable cell
      positions.push(x0, yOffset, z0, x0, yOffset, z1, x1, yOffset, z1);
      positions.push(x0, yOffset, z0, x1, yOffset, z1, x1, yOffset, z0);
    }
  }

  if (positions.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      color: '#8B5CF6',
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 8;
    group.add(mesh);

    const wireMat = new THREE.MeshBasicMaterial({
      color: '#C4B5FD',
      wireframe: true,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const wireMesh = new THREE.Mesh(geo, wireMat);
    wireMesh.position.y = 0.005;
    wireMesh.renderOrder = 9;
    group.add(wireMesh);
  }

  return group;
}
