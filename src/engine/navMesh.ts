import * as THREE from 'three';
import type { Floor, Opening, SpatialAsset, Wall } from '../types/twin';
import { getAssetBounds } from '../utils/spatial';

export type PathRoutingAlgorithm = 'shortest' | 'least-congested';

export interface NoGoZone {
  id: string;
  floorId: string;
  label: string;
  kind: 'room' | 'circle';
  roomId?: string;
  x: number;
  z: number;
  width?: number;
  depth?: number;
  radius?: number;
}

export interface PathFindOptions {
  algorithm?: PathRoutingAlgorithm;
  noGoZones?: NoGoZone[];
}

export interface FloorNavMesh {
  floorId: string;
  cellSize: number;
  cols: number;
  rows: number;
  width: number;
  depth: number;
  /** 1 = walkable, 0 = blocked by wall or equipment */
  grid: Uint8Array;
  /** 0.0 (wide open corridor) to 1.0 (tight / high-equipment-density congestion zone) */
  congestionCost: Float32Array;
  walkableCount: number;
  totalCount: number;
  walkablePercent: number;
  isWalkable: (x: number, z: number) => boolean;
  resolveMove: (
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number
  ) => { x: number; z: number; collided: boolean };
  findNearestWalkable: (x: number, z: number, noGoZones?: NoGoZone[]) => { x: number; z: number };
  findPath: (
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    options?: PathFindOptions
  ) => { x: number; z: number }[];
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

export function isPointInsideNoGoZones(
  wx: number,
  wz: number,
  zones?: NoGoZone[],
  padding = 0.2
): boolean {
  if (!zones || zones.length === 0) return false;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z.kind === 'room' && z.width && z.depth) {
      if (
        wx >= z.x - padding &&
        wx <= z.x + z.width + padding &&
        wz >= z.z - padding &&
        wz <= z.z + z.depth + padding
      ) {
        return true;
      }
    } else {
      const r = (z.radius ?? 2.0) + padding;
      const dx = wx - z.x;
      const dz = wz - z.z;
      if (dx * dx + dz * dz <= r * r) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Automatically computes a high-resolution walkable NavMesh for a floor by rasterizing:
 * 1. All architectural walls (with character shoulder clearance radius)
 * 2. World-space doorway portals that cleanly cut through BOTH the host wall AND any overlapping
 *    adjacent room wall (preventing rooms with shared double-walls from trapping walk mode)
 * 3. Blocking placed equipment footprints while preserving clear doorway egress corridors
 * 4. A multi-source congestion / clearance cost field for 'Least Congested' routing
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
  const total = cols * rows;
  const grid = new Uint8Array(total);
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
      halfWidth: Math.max(0.42, d.width * 0.5 - 0.04),
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

  const distToSeg = (px: number, pz: number, x1: number, z1: number, x2: number, z2: number) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-6) return Math.hypot(px - x1, pz - z1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
    return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
  };

  const assetBoxes = floorAssets.map((a) => {
    const b = getAssetBounds(a);
    const pad = Math.min(agentRadius, 0.18);
    return {
      cx: a.x,
      cz: a.z,
      weight: a.operationalStatus === 'running' ? 1.0 : 0.55,
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

      if (wx < 0.2 || wx > width - 0.2 || wz < 0.2 || wz > depth - 0.2) {
        grid[idx] = 0;
        continue;
      }

      if (isInsideAnyDoorPortal(wx, wz)) {
        grid[idx] = 1;
        walkableCount++;
        continue;
      }

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

  // Build congestion cost field (0.0 = wide open uncongested path, 1.0 = tight bottleneck / dense equipment)
  const congestionCost = new Float32Array(total);
  const obsDist = new Int16Array(total);
  obsDist.fill(999);
  const bfsQueue = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;

  for (let i = 0; i < total; i++) {
    if (grid[i] === 0) {
      obsDist[i] = 0;
      bfsQueue[qTail++] = i;
    }
  }

  const maxClearCells = 6; // ~2.1m clearance radius
  while (qHead < qTail) {
    const cur = bfsQueue[qHead++];
    const curD = obsDist[cur];
    if (curD >= maxClearCells) continue;
    const cr = Math.floor(cur / cols);
    const cc = cur - cr * cols;
    const nextD = curD + 1;
    if (cc + 1 < cols) {
      const ni = cur + 1;
      if (obsDist[ni] > nextD) {
        obsDist[ni] = nextD;
        bfsQueue[qTail++] = ni;
      }
    }
    if (cc - 1 >= 0) {
      const ni = cur - 1;
      if (obsDist[ni] > nextD) {
        obsDist[ni] = nextD;
        bfsQueue[qTail++] = ni;
      }
    }
    if (cr + 1 < rows) {
      const ni = cur + cols;
      if (obsDist[ni] > nextD) {
        obsDist[ni] = nextD;
        bfsQueue[qTail++] = ni;
      }
    }
    if (cr - 1 >= 0) {
      const ni = cur - cols;
      if (obsDist[ni] > nextD) {
        obsDist[ni] = nextD;
        bfsQueue[qTail++] = ni;
      }
    }
  }

  for (let r = 0; r < rows; r++) {
    const wz = (r + 0.5) * cellSize;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (grid[idx] !== 1) {
        congestionCost[idx] = 1;
        continue;
      }
      // 1. Wall/obstacle proximity bottleneck penalty
      const dCells = Math.min(maxClearCells, obsDist[idx]);
      const wallProximity = 1 - dCells / maxClearCells; // 1 near wall, 0 in wide corridor

      // 2. Active equipment cluster density penalty
      const wx = (c + 0.5) * cellSize;
      let eqCrowd = 0;
      for (let ai = 0; ai < assetBoxes.length; ai++) {
        const a = assetBoxes[ai];
        const dist = Math.hypot(wx - a.cx, wz - a.cz);
        if (dist < 2.8) {
          eqCrowd += ((2.8 - dist) / 2.8) * 0.42 * a.weight;
        }
      }

      congestionCost[idx] = Math.min(1, wallProximity * 0.62 + Math.min(0.65, eqCrowd));
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
    if (isWalkable(toX, fromZ)) {
      return { x: toX, z: fromZ, collided: true };
    }
    if (isWalkable(fromX, toZ)) {
      return { x: fromX, z: toZ, collided: true };
    }
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

  const findNearestWalkable = (x: number, z: number, noGoZones?: NoGoZone[]) => {
    const floorNoGo = noGoZones?.filter((zn) => zn.floorId === floor.id);
    if (isWalkable(x, z) && !isPointInsideNoGoZones(x, z, floorNoGo)) {
      return { x, z };
    }
    const startC = Math.max(0, Math.min(cols - 1, Math.floor(x / cellSize)));
    const startR = Math.max(0, Math.min(rows - 1, Math.floor(z / cellSize)));
    for (let rad = 1; rad <= Math.max(cols, rows); rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
          const nc = startC + dc;
          const nr = startR + dr;
          if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && grid[nr * cols + nc] === 1) {
            const wx = (nc + 0.5) * cellSize;
            const wz = (nr + 0.5) * cellSize;
            if (!isPointInsideNoGoZones(wx, wz, floorNoGo)) {
              return { x: wx, z: wz };
            }
          }
        }
      }
    }
    return { x: width / 2, z: depth / 2 };
  };

  /**
   * 8-directional A* pathfinder supporting:
   * - 'shortest': minimum Euclidean walking distance with line-of-sight string-pull smoothing
   * - 'least-congested': penalizes narrow bottlenecks & high-equipment-density zones
   * - User-defined 'No-Go' zones completely excluded from traversal
   */
  const findPath = (
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    options?: PathFindOptions
  ): { x: number; z: number }[] => {
    const algorithm: PathRoutingAlgorithm = options?.algorithm ?? 'shortest';
    const floorNoGo = (options?.noGoZones ?? []).filter((z) => z.floorId === floor.id);

    // Pre-rasterize No-Go cells for fast O(1) lookup during A*
    let noGoMask: Uint8Array | null = null;
    if (floorNoGo.length > 0) {
      noGoMask = new Uint8Array(total);
      for (let r = 0; r < rows; r++) {
        const wz = (r + 0.5) * cellSize;
        for (let c = 0; c < cols; c++) {
          const wx = (c + 0.5) * cellSize;
          if (isPointInsideNoGoZones(wx, wz, floorNoGo, 0.22)) {
            noGoMask[r * cols + c] = 1;
          }
        }
      }
    }

    const startPt = isWalkable(fromX, fromZ)
      ? { x: fromX, z: fromZ }
      : findNearestWalkable(fromX, fromZ, floorNoGo);
    const goalPt =
      isWalkable(toX, toZ) && !isPointInsideNoGoZones(toX, toZ, floorNoGo, 0.22)
        ? { x: toX, z: toZ }
        : findNearestWalkable(toX, toZ, floorNoGo);

    if (Math.hypot(goalPt.x - startPt.x, goalPt.z - startPt.z) < cellSize * 0.6) {
      return [startPt, goalPt];
    }

    const hasCleanLineOfSight = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      checkCongestion: boolean
    ) => {
      const dist = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(2, Math.ceil(dist / (cellSize * 0.42)));
      let maxAllowedCongestion = 1;
      if (checkCongestion) {
        const cA =
          congestionCost[
            Math.max(0, Math.min(rows - 1, Math.floor(az / cellSize))) * cols +
              Math.max(0, Math.min(cols - 1, Math.floor(ax / cellSize)))
          ];
        const cB =
          congestionCost[
            Math.max(0, Math.min(rows - 1, Math.floor(bz / cellSize))) * cols +
              Math.max(0, Math.min(cols - 1, Math.floor(bx / cellSize)))
          ];
        maxAllowedCongestion = Math.max(cA, cB) + 0.22;
      }

      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const px = ax + (bx - ax) * t;
        const pz = az + (bz - az) * t;
        const c = Math.floor(px / cellSize);
        const r = Math.floor(pz / cellSize);
        if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
        const idx = r * cols + c;
        if (grid[idx] !== 1) return false;
        if (noGoMask && noGoMask[idx] === 1) return false;
        if (checkCongestion && congestionCost[idx] > maxAllowedCongestion) return false;
      }
      return true;
    };

    // Fast path for shortest mode when completely unobstructed and outside No-Go zones
    if (
      algorithm === 'shortest' &&
      hasCleanLineOfSight(startPt.x, startPt.z, goalPt.x, goalPt.z, false)
    ) {
      return [startPt, goalPt];
    }

    const sc = Math.max(0, Math.min(cols - 1, Math.floor(startPt.x / cellSize)));
    const sr = Math.max(0, Math.min(rows - 1, Math.floor(startPt.z / cellSize)));
    const gc = Math.max(0, Math.min(cols - 1, Math.floor(goalPt.x / cellSize)));
    const gr = Math.max(0, Math.min(rows - 1, Math.floor(goalPt.z / cellSize)));

    const startIdx = sr * cols + sc;
    const goalIdx = gr * cols + gc;
    const startedInNoGo = Boolean(noGoMask && noGoMask[startIdx] === 1);

    const gScore = new Float32Array(total);
    gScore.fill(Infinity);
    const cameFrom = new Int32Array(total);
    cameFrom.fill(-1);
    const closed = new Uint8Array(total);

    const heapIdx: number[] = [];
    const heapF: number[] = [];
    const pushHeap = (idx: number, f: number) => {
      let i = heapIdx.length;
      heapIdx.push(idx);
      heapF.push(f);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= heapF[i]) break;
        [heapIdx[p], heapIdx[i]] = [heapIdx[i], heapIdx[p]];
        [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
        i = p;
      }
    };
    const popHeap = (): number => {
      const top = heapIdx[0];
      const lastIdx = heapIdx.pop()!;
      const lastF = heapF.pop()!;
      if (heapIdx.length > 0) {
        heapIdx[0] = lastIdx;
        heapF[0] = lastF;
        let i = 0;
        const n = heapIdx.length;
        while (true) {
          let smallest = i;
          const l = (i << 1) + 1;
          const r = l + 1;
          if (l < n && heapF[l] < heapF[smallest]) smallest = l;
          if (r < n && heapF[r] < heapF[smallest]) smallest = r;
          if (smallest === i) break;
          [heapIdx[i], heapIdx[smallest]] = [heapIdx[smallest], heapIdx[i]];
          [heapF[i], heapF[smallest]] = [heapF[smallest], heapF[i]];
          i = smallest;
        }
      }
      return top;
    };

    const octile = (c1: number, r1: number, c2: number, r2: number) => {
      const dx = Math.abs(c1 - c2);
      const dz = Math.abs(r1 - r2);
      return Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz);
    };

    gScore[startIdx] = 0;
    pushHeap(startIdx, octile(sc, sr, gc, gr));

    const dirs: [number, number, number][] = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 1.41421356],
      [1, -1, 1.41421356],
      [-1, 1, 1.41421356],
      [-1, -1, 1.41421356],
    ];

    let found = false;
    let bestClosestIdx = startIdx;
    let bestClosestH = octile(sc, sr, gc, gr);
    let expanded = 0;
    const maxExpansions = Math.min(total, 18000);
    const congestionWeight = algorithm === 'least-congested' ? 3.2 : 0.0;

    while (heapIdx.length > 0 && expanded < maxExpansions) {
      const cur = popHeap();
      if (closed[cur]) continue;
      closed[cur] = 1;
      expanded++;

      if (cur === goalIdx) {
        found = true;
        break;
      }

      const cr = Math.floor(cur / cols);
      const cc = cur - cr * cols;
      const hCur = octile(cc, cr, gc, gr);
      if (hCur < bestClosestH) {
        bestClosestH = hCur;
        bestClosestIdx = cur;
      }

      const curInNoGo = Boolean(noGoMask && noGoMask[cur] === 1);

      for (let d = 0; d < dirs.length; d++) {
        const [dc, dr, baseCost] = dirs[d];
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const nIdx = nr * cols + nc;
        if (closed[nIdx] || grid[nIdx] !== 1) continue;

        const nextInNoGo = Boolean(noGoMask && noGoMask[nIdx] === 1);
        // Never enter a No-Go zone unless escaping outward from starting inside one
        if (nextInNoGo && !(startedInNoGo && curInNoGo)) continue;

        // Prevent clipping diagonal corners through walls/equipment/No-Go zones
        if (dc !== 0 && dr !== 0) {
          const idx1 = cr * cols + nc;
          const idx2 = nr * cols + cc;
          if (grid[idx1] !== 1 || grid[idx2] !== 1) continue;
          if (!curInNoGo && noGoMask && (noGoMask[idx1] === 1 || noGoMask[idx2] === 1)) continue;
        }

        const stepMultiplier =
          1 +
          congestionCost[nIdx] * congestionWeight +
          (nextInNoGo ? 12.0 : 0);
        const tentative = gScore[cur] + baseCost * stepMultiplier;
        if (tentative < gScore[nIdx]) {
          cameFrom[nIdx] = cur;
          gScore[nIdx] = tentative;
          pushHeap(nIdx, tentative + octile(nc, nr, gc, gr));
        }
      }
    }

    const endIdx = found ? goalIdx : bestClosestIdx;
    const rawPts: { x: number; z: number }[] = [];
    let walk = endIdx;
    while (walk !== -1) {
      const wr = Math.floor(walk / cols);
      const wc = walk - wr * cols;
      rawPts.push({ x: (wc + 0.5) * cellSize, z: (wr + 0.5) * cellSize });
      if (walk === startIdx) break;
      walk = cameFrom[walk];
    }
    rawPts.reverse();

    if (rawPts.length === 0) return [startPt, goalPt];
    rawPts[0] = startPt;
    if (found) rawPts[rawPts.length - 1] = goalPt;

    // Greedy line-of-sight string-pull smoothing (preserving least-congested detours!)
    const checkCongestion = algorithm === 'least-congested';
    const smoothed: { x: number; z: number }[] = [rawPts[0]];
    let anchor = 0;
    while (anchor < rawPts.length - 1) {
      let furthest = anchor + 1;
      for (let probe = rawPts.length - 1; probe > anchor + 1; probe--) {
        if (
          hasCleanLineOfSight(
            rawPts[anchor].x,
            rawPts[anchor].z,
            rawPts[probe].x,
            rawPts[probe].z,
            checkCongestion
          )
        ) {
          furthest = probe;
          break;
        }
      }
      smoothed.push(rawPts[furthest]);
      anchor = furthest;
    }

    return smoothed;
  };

  return {
    floorId: floor.id,
    cellSize,
    cols,
    rows,
    width,
    depth,
    grid,
    congestionCost,
    walkableCount,
    totalCount: total,
    walkablePercent: total > 0 ? Math.round((walkableCount / total) * 100) : 0,
    isWalkable,
    resolveMove,
    findNearestWalkable,
    findPath,
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
