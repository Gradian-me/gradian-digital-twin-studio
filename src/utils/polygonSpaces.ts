import type { Room, Wall } from '../types/twin';

export interface PolygonPoint {
  x: number;
  z: number;
}

export interface DetectedPolygonSpace {
  id: string;
  floorId: string;
  polygon: PolygonPoint[];
  areaSqm: number;
  centroid: PolygonPoint;
  bounds: { x: number; z: number; width: number; depth: number };
}

/** Shoelace signed area in XZ plane (positive = CCW in standard math XY mapped to XZ) */
export function computeSignedPolygonArea(pts: PolygonPoint[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

export function computePolygonArea(pts: PolygonPoint[]): number {
  return Math.abs(computeSignedPolygonArea(pts));
}

export function computePolygonCentroid(pts: PolygonPoint[]): PolygonPoint {
  if (pts.length === 0) return { x: 0, z: 0 };
  if (pts.length < 3) {
    const sx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const sz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    return { x: Number(sx.toFixed(3)), z: Number(sz.toFixed(3)) };
  }
  const signedArea = computeSignedPolygonArea(pts);
  if (Math.abs(signedArea) < 1e-6) {
    const sx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const sz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    return { x: Number(sx.toFixed(3)), z: Number(sz.toFixed(3)) };
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = a.x * b.z - b.x * a.z;
    cx += (a.x + b.x) * cross;
    cz += (a.z + b.z) * cross;
  }
  const factor = 1 / (6 * signedArea);
  return {
    x: Number((cx * factor).toFixed(3)),
    z: Number((cz * factor).toFixed(3)),
  };
}

export function computePolygonBounds(pts: PolygonPoint[]) {
  if (pts.length === 0) return { x: 0, z: 0, width: 0, depth: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return {
    x: Number(minX.toFixed(3)),
    z: Number(minZ.toFixed(3)),
    width: Number(Math.max(0.1, maxX - minX).toFixed(3)),
    depth: Number(Math.max(0.1, maxZ - minZ).toFixed(3)),
  };
}

export function isPointInPolygon(x: number, z: number, pts: PolygonPoint[]): boolean {
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const zi = pts[i].z;
    const xj = pts[j].x;
    const zj = pts[j].z;
    const intersect =
      zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function getRoomAreaSqm(room: Pick<Room, 'width' | 'depth' | 'polygon'>): number {
  if (room.polygon && room.polygon.length >= 3) {
    const a = computePolygonArea(room.polygon);
    if (a > 0.1) return a;
  }
  return room.width * room.depth;
}

export function getRoomCentroid(room: Pick<Room, 'x' | 'z' | 'width' | 'depth' | 'polygon'>): PolygonPoint {
  if (room.polygon && room.polygon.length >= 3) {
    return computePolygonCentroid(room.polygon);
  }
  return {
    x: Number((room.x + room.width / 2).toFixed(3)),
    z: Number((room.z + room.depth / 2).toFixed(3)),
  };
}

/** Find segment intersection parameter t on segment A->B and u on C->D (0..1) */
function segmentIntersection(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number
): { t: number; u: number; x: number; z: number } | null {
  const rX = bx - ax;
  const rZ = bz - az;
  const sX = dx - cx;
  const sZ = dz - cz;
  const denom = rX * sZ - rZ * sX;
  if (Math.abs(denom) < 1e-7) return null;
  const qpX = cx - ax;
  const qpZ = cz - az;
  const t = (qpX * sZ - qpZ * sX) / denom;
  const u = (qpX * rZ - qpZ * rX) / denom;
  const eps = 1e-3;
  if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
    const ct = Math.max(0, Math.min(1, t));
    const cu = Math.max(0, Math.min(1, u));
    return {
      t: ct,
      u: cu,
      x: ax + ct * rX,
      z: az + ct * rZ,
    };
  }
  return null;
}

/** Project point P onto segment A->B, returning parameter t in [0,1] and distance */
function projectPointOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): { t: number; dist: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-8) return { t: 0, dist: Math.hypot(px - ax, pz - az) };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  const cx = ax + t * dx;
  const cz = az + t * dz;
  return { t, dist: Math.hypot(px - cx, pz - cz) };
}

/**
 * Detects minimal enclosed polygonal spaces formed by walls on a floor that are not yet
 * covered by an existing named Room.
 *
 * Uses planar subdivision (handling crossings & T-junctions) + directed half-edge
 * minimal-cycle face extraction.
 */
export function detectEnclosedWallPolygons(
  walls: Wall[],
  existingRooms: Room[],
  floorId: string,
  options?: { snapTol?: number; minAreaSqm?: number }
): DetectedPolygonSpace[] {
  const floorWalls = walls.filter((w) => w.floorId === floorId);
  if (floorWalls.length < 3) return [];

  const snapTol = options?.snapTol ?? 0.16;
  const minAreaSqm = options?.minAreaSqm ?? 1.0;

  // 1. Collect split parameters along every wall segment (intersections + T-junctions)
  const splitParams: number[][] = floorWalls.map(() => [0, 1]);

  for (let i = 0; i < floorWalls.length; i++) {
    const w1 = floorWalls[i];
    for (let j = i + 1; j < floorWalls.length; j++) {
      const w2 = floorWalls[j];

      // Crossing intersection
      const hit = segmentIntersection(w1.x1, w1.z1, w1.x2, w1.z2, w2.x1, w2.z1, w2.x2, w2.z2);
      if (hit) {
        if (hit.t > 0.01 && hit.t < 0.99) splitParams[i].push(hit.t);
        if (hit.u > 0.01 && hit.u < 0.99) splitParams[j].push(hit.u);
      }

      // Near-endpoint T-junctions (w2 endpoints near w1 interior)
      for (const [px, pz] of [
        [w2.x1, w2.z1],
        [w2.x2, w2.z2],
      ]) {
        const proj = projectPointOnSegment(px, pz, w1.x1, w1.z1, w1.x2, w1.z2);
        if (proj.dist <= snapTol && proj.t > 0.01 && proj.t < 0.99) {
          splitParams[i].push(proj.t);
        }
      }
      // Near-endpoint T-junctions (w1 endpoints near w2 interior)
      for (const [px, pz] of [
        [w1.x1, w1.z1],
        [w1.x2, w1.z2],
      ]) {
        const proj = projectPointOnSegment(px, pz, w2.x1, w2.z1, w2.x2, w2.z2);
        if (proj.dist <= snapTol && proj.t > 0.01 && proj.t < 0.99) {
          splitParams[j].push(proj.t);
        }
      }
    }
  }

  // 2. Build merged vertex list & undirected edge set
  const vertices: PolygonPoint[] = [];
  const getOrCreateVertex = (x: number, z: number): number => {
    for (let i = 0; i < vertices.length; i++) {
      if (Math.hypot(vertices[i].x - x, vertices[i].z - z) <= snapTol) {
        return i;
      }
    }
    vertices.push({ x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) });
    return vertices.length - 1;
  };

  const edgeSet = new Set<string>();
  const adjacency = new Map<number, Set<number>>();
  const addUndirectedEdge = (u: number, v: number) => {
    if (u === v) return;
    const key = u < v ? `${u}:${v}` : `${v}:${u}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    if (!adjacency.has(u)) adjacency.set(u, new Set());
    if (!adjacency.has(v)) adjacency.set(v, new Set());
    adjacency.get(u)!.add(v);
    adjacency.get(v)!.add(u);
  };

  for (let i = 0; i < floorWalls.length; i++) {
    const w = floorWalls[i];
    const params = splitParams[i].sort((a, b) => a - b);
    const dedup: number[] = [params[0]];
    for (let k = 1; k < params.length; k++) {
      if (params[k] - dedup[dedup.length - 1] > 0.008) dedup.push(params[k]);
    }
    for (let k = 0; k < dedup.length - 1; k++) {
      const t0 = dedup[k];
      const t1 = dedup[k + 1];
      const x0 = w.x1 + (w.x2 - w.x1) * t0;
      const z0 = w.z1 + (w.z2 - w.z1) * t0;
      const x1 = w.x1 + (w.x2 - w.x1) * t1;
      const z1 = w.z1 + (w.z2 - w.z1) * t1;
      if (Math.hypot(x1 - x0, z1 - z0) < 0.12) continue;
      const u = getOrCreateVertex(x0, z0);
      const v = getOrCreateVertex(x1, z1);
      addUndirectedEdge(u, v);
    }
  }

  // 3. Iteratively prune degree-1 dangling spurs (open walls that cannot bound a face)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [u, nbrs] of adjacency.entries()) {
      if (nbrs.size <= 1) {
        for (const v of nbrs) {
          adjacency.get(v)?.delete(u);
        }
        adjacency.delete(u);
        changed = true;
      }
    }
  }

  if (adjacency.size < 3) return [];

  // 4. Sort outgoing neighbors by angle around each vertex for planar face traversal
  const sortedNeighbors = new Map<number, number[]>();
  for (const [u, nbrs] of adjacency.entries()) {
    const pu = vertices[u];
    const sorted = Array.from(nbrs).sort((a, b) => {
      const angA = Math.atan2(vertices[a].z - pu.z, vertices[a].x - pu.x);
      const angB = Math.atan2(vertices[b].z - pu.z, vertices[b].x - pu.x);
      return angA - angB;
    });
    sortedNeighbors.set(u, sorted);
  }

  // 5. Enumerate all minimal faces by walking directed half-edges:
  // Arriving at v from u, pick the next edge immediately before u in CCW order (sharpest right/interior turn)
  const visitedHalfEdges = new Set<string>();
  const rawFaces: PolygonPoint[][] = [];

  for (const [startU, nbrs] of sortedNeighbors.entries()) {
    for (const startV of nbrs) {
      const startKey = `${startU}->${startV}`;
      if (visitedHalfEdges.has(startKey)) continue;

      const cycleIndices: number[] = [];
      let currU = startU;
      let currV = startV;
      let guard = 0;
      let closed = false;

      while (guard < 64) {
        guard++;
        const heKey = `${currU}->${currV}`;
        if (visitedHalfEdges.has(heKey)) break;
        visitedHalfEdges.add(heKey);
        cycleIndices.push(currU);

        const nextList = sortedNeighbors.get(currV);
        if (!nextList || nextList.length === 0) break;
        const backIdx = nextList.indexOf(currU);
        if (backIdx === -1) break;
        // Take the next clockwise neighbor (backIdx - 1 mod n)
        const nextV = nextList[(backIdx - 1 + nextList.length) % nextList.length];

        currU = currV;
        currV = nextV;
        if (currU === startU && currV === startV) {
          closed = true;
          break;
        }
      }

      if (!closed || cycleIndices.length < 3) continue;
      // Ensure simple polygon (no repeated vertex within the face)
      if (new Set(cycleIndices).size !== cycleIndices.length) continue;

      const poly = cycleIndices.map((idx) => vertices[idx]);
      // With backIdx - 1 (clockwise turn around interior), bounded interior faces have positive signedArea in XZ
      const signed = computeSignedPolygonArea(poly);
      if (signed >= minAreaSqm) {
        rawFaces.push(poly);
      }
    }
  }

  // 6. Simplify collinear intermediate vertices & filter out rooms that already cover the face
  const floorRooms = existingRooms.filter((r) => r.floorId === floorId);
  const results: DetectedPolygonSpace[] = [];
  const seenSignatures = new Set<string>();

  for (const face of rawFaces) {
    // Remove collinear mid-points along straight edges
    const simplified: PolygonPoint[] = [];
    for (let i = 0; i < face.length; i++) {
      const prev = face[(i - 1 + face.length) % face.length];
      const curr = face[i];
      const next = face[(i + 1) % face.length];
      const cross = Math.abs(
        (curr.x - prev.x) * (next.z - curr.z) - (curr.z - prev.z) * (next.x - curr.x)
      );
      if (cross > 0.02) {
        simplified.push(curr);
      }
    }
    const poly = simplified.length >= 3 ? simplified : face;
    const areaSqm = Number(computePolygonArea(poly).toFixed(2));
    if (areaSqm < minAreaSqm) continue;

    const centroid = computePolygonCentroid(poly);
    const bounds = computePolygonBounds(poly);

    // Deduplicate by quantized centroid + area signature
    const sig = `${Math.round(centroid.x * 4)}:${Math.round(centroid.z * 4)}:${Math.round(areaSqm)}`;
    if (seenSignatures.has(sig)) continue;
    seenSignatures.add(sig);

    // Check if an existing Room on this floor already represents this enclosed polygon
    const alreadyExists = floorRooms.some((rm) => {
      const rmArea = getRoomAreaSqm(rm);
      const rmCenter = getRoomCentroid(rm);
      const centroidInsideRm =
        rm.polygon && rm.polygon.length >= 3
          ? isPointInPolygon(centroid.x, centroid.z, rm.polygon)
          : centroid.x >= rm.x - 0.15 &&
            centroid.x <= rm.x + rm.width + 0.15 &&
            centroid.z >= rm.z - 0.15 &&
            centroid.z <= rm.z + rm.depth + 0.15;
      const rmCenterInsidePoly = isPointInPolygon(rmCenter.x, rmCenter.z, poly);
      if (centroidInsideRm && rmCenterInsidePoly) {
        const areaRatio = Math.min(rmArea, areaSqm) / Math.max(rmArea, areaSqm, 0.01);
        if (areaRatio >= 0.55) return true;
      }
      // Also check direct bounding overlap if centroid is right inside an existing room of similar size
      if (centroidInsideRm && Math.abs(rmArea - areaSqm) / Math.max(rmArea, areaSqm, 1) < 0.28) {
        return true;
      }
      return false;
    });

    if (alreadyExists) continue;

    results.push({
      id: `poly-${floorId}-${Math.round(centroid.x * 10)}-${Math.round(centroid.z * 10)}-${Math.round(areaSqm * 10)}`,
      floorId,
      polygon: poly,
      areaSqm,
      centroid,
      bounds,
    });
  }

  return results.sort((a, b) => a.areaSqm - b.areaSqm);
}
