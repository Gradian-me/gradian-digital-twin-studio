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

interface DoorPortal {
  cx: number;
  cz: number;
  ux: number; // unit tangent along wall
  uz: number;
  nx: number; // unit normal perpendicular to wall
  nz: number;
  halfWidth: number;
  halfDepth: number; // clearance on both sides of the door so overlapping room walls also open
}

/**
 * Automatically computes a high-resolution walkable NavMesh for a floor by rasterizing:
 * 1. All architectural walls (with character shoulder clearance radius)
 * 2. World-space doorway portals that cleanly cut through BOTH the host wall AND any overlapping
 *    adjacent room wall (preventing rooms with shared double-walls from trapping walk mode)
 * 3. Blocking placed equipment footprints while preserving clear doorway egress corridors
 */
export function buildFloorNavMesh(
  floor: Floor,
  walls: Wall[],
  openings: Opening[],
  assets: SpatialAsset[],
  cellSize = 0.35,
  agentRadius = 0.24
): FloorNavMesh {
  const width = Math.max(4, floor.width);
  const depth = Math.max(4, floor.depth);
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(depth / cellSize);
  const grid = new Uint8Array(cols * rows);
  grid.fill(1);

  const floorWalls = walls.filter((w) => w.floorId === floor.id);
  const wallById = new Map<string, Wall>();
  floorWalls.forEach((w) => wallById.set(w.id, w));

  const floorDoors = openings.filter((o) => o.floorId === floor.id && o.kind === 'door');
  const floorAssets = assets.filter((a) => a.floorId === floor.id && !a.hidden);

  // Build world-space door portals so any door punches cleanly through double/shared walls
  const doorPortals: DoorPortal[] = [];
  floorDoors.forEach((d) => {
    const host = wallById.get(d.wallId);
    if (!host) return;
    const dx = host.x2 - host.x1;
    const dz = host.z2 - host.z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    const cx = host.x1 + dx * d.offsetRatio;
    const cz = host.z1 + dz * d.offsetRatio;
    doorPortals.push({
      cx,
      cz,
      ux,
      uz,
      nx,
      nz,
      // Generous walkable opening width so shoulder clearance never snags on door jambs
      halfWidth: Math.max(0.42, d.width * 0.5 - 0.04),
      // Extend across host + adjacent shared wall + immediate threshold on both sides
      halfDepth: Math.max(0.75, host.thickness + agentRadius + 0.38),
    });
  });

  const isInsideAnyDoorPortal = (wx: number, wz: number) => {
    for (let i = 0; i < doorPortals.length; i++) {
      const p = doorPortals[i];
      const rx = wx - p.cx;
      const rz = wz - p.cz;
      const along = Math.abs(rx * p.ux + rz * p.uz);
      const perp = Math.abs(rx * p.nx + rz * p.nz);
      if (along <= p.halfWidth && perp <= p.halfDepth) {
        return true;
      }
    }
    return false;
  };

  // Helper: distance from point (px,pz) to segment (x1,z1)-(x2,z2)
  const distToSeg = (px: number, pz: number, x1: number, z1: number, x2: number, z2: number) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-6) return Math.hypot(px - x1, pz - z1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
    return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
  };

  // Precompute asset AABBs with conservative agent clearance
  const assetBoxes = floorAssets.map((a) => {
    const b = getAssetBounds(a);
    const pad = Math.min(agentRadius, 0.18);
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
      if (wx < 0.2 || wx > width - 0.2 || wz < 0.2 || wz > depth - 0.2) {
        grid[idx] = 0;
        continue;
      }

      // World-space door portals ALWAYS stay open and walkable across overlapping room walls
      if (isInsideAnyDoorPortal(wx, wz)) {
        grid[idx] = 1;
        walkableCount++;
        continue;
      }

      // Check architectural walls
      let blocked = false;
      for (let wi = 0; wi < floorWalls.length; wi++) {
        const w = floorWalls[wi];
        const dist = distToSeg(wx, wz, w.x1, w.z1, w.x2, w.z2);
        const halfThick = w.thickness * 0.5 + agentRadius;
        if (dist <= halfThick) {
          blocked = true;
          break;
        }
      }

      if (!blocked) {
        // Check equipment footprints
        for (let ai = 0; ai < assetBoxes.length; ai++) {
          const box = assetBoxes[ai];
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

  const resolveSingleStep = (fromX: number, fromZ: number, toX: number, toZ: number) => {
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
    // Gentle doorway funnel assist: if sliding near a doorway portal center, nudge along portal axis
    for (let i = 0; i < doorPortals.length; i++) {
      const p = doorPortals[i];
      const distToCenter = Math.hypot(fromX - p.cx, fromZ - p.cz);
      if (distToCenter < p.halfWidth + 0.9) {
        const stepX = fromX + (p.cx - fromX) * 0.18;
        const stepZ = fromZ + (p.cz - fromZ) * 0.18;
        if (isWalkable(stepX, stepZ)) {
          return { x: stepX, z: stepZ, collided: false };
        }
      }
    }
    // If somehow spawned inside a non-walkable cell, nudge strictly toward nearest walkable cell (never tunnel forward)
    if (!isWalkable(fromX, fromZ)) {
      const safe = findNearestWalkable(fromX, fromZ);
      const dx = safe.x - fromX;
      const dz = safe.z - fromZ;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.001) {
        const pull = Math.min(dist, 0.15);
        return { x: fromX + (dx / dist) * pull, z: fromZ + (dz / dist) * pull, collided: true };
      }
    }
    return { x: fromX, z: fromZ, collided: true };
  };

  const resolveMove = (fromX: number, fromZ: number, toX: number, toZ: number) => {
    const totalDx = toX - fromX;
    const totalDz = toZ - fromZ;
    const totalDist = Math.hypot(totalDx, totalDz);
    if (totalDist < 1e-5) {
      return { x: fromX, z: fromZ, collided: false };
    }
    // Sub-step every <= 0.08m so Fast/Sprint mode can NEVER tunnel through walls or non-NavMesh cells
    const steps = Math.max(1, Math.ceil(totalDist / 0.08));
    let cx = fromX;
    let cz = fromZ;
    let collided = false;
    for (let s = 0; s < steps; s++) {
      const nx = cx + totalDx / steps;
      const nz = cz + totalDz / steps;
      const res = resolveSingleStep(cx, cz, nx, nz);
      cx = res.x;
      cz = res.z;
      if (res.collided) collided = true;
    }
    return { x: cx, z: cz, collided };
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
