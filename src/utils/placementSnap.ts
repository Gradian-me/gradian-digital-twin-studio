import type { SnapConfig, Wall } from '../types/twin';
import { snapValue } from './spatial';

export interface WallSnapInfo {
  wallId: string;
  wallName: string;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  projX: number;
  projZ: number;
  distance: number;
}

export interface PlacementSnapResult {
  x: number;
  z: number;
  rotationY: number;
  snappedGrid: boolean;
  snappedWall: WallSnapInfo | null;
}

/**
 * Computes precision Snap-to-Grid and Snap-to-Wall placement for the 'place-object' tool.
 * When within `wallThreshold` of a wall segment, aligns the asset flush against the wall face
 * on the cursor's side and rotates `rotationY` so the asset's front faces cleanly into the room.
 */
export function computeSnappedPlacement(
  rawX: number,
  rawZ: number,
  assetWidth: number,
  assetDepth: number,
  walls: Wall[],
  snap: SnapConfig,
  options?: {
    wallThreshold?: number;
    floorWidth?: number;
    floorDepth?: number;
  }
): PlacementSnapResult {
  const useGrid = Boolean(snap.enabled && snap.snapToGrid);
  const gridSize = Math.max(0.1, snap.gridSize || 0.5);

  let x = useGrid ? snapValue(rawX, gridSize, true) : Number(rawX.toFixed(2));
  let z = useGrid ? snapValue(rawZ, gridSize, true) : Number(rawZ.toFixed(2));
  let rotationY = 0;
  let snappedWall: WallSnapInfo | null = null;

  const allowWallSnap = snap.enabled && (snap.snapToWall || snap.snapToGrid);
  const threshold = options?.wallThreshold ?? 0.95;

  if (allowWallSnap && walls.length > 0) {
    let bestDist = threshold;
    let bestCandidate: {
      wall: Wall;
      projX: number;
      projZ: number;
      ux: number;
      uz: number;
      nx: number;
      nz: number;
      t: number;
      len: number;
      dist: number;
    } | null = null;

    for (const wall of walls) {
      const dx = wall.x2 - wall.x1;
      const dz = wall.z2 - wall.z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.25) continue;
      const ux = dx / len;
      const uz = dz / len;

      // Project raw cursor onto wall segment
      const rawT = ((rawX - wall.x1) * ux + (rawZ - wall.z1) * uz) / len;
      const marginRatio = Math.min(0.42, (assetWidth * 0.5) / len);
      const t = Math.max(marginRatio, Math.min(1 - marginRatio, rawT));
      const projX = wall.x1 + dx * t;
      const projZ = wall.z1 + dz * t;

      const ox = rawX - projX;
      const oz = rawZ - projZ;
      const dist = Math.hypot(ox, oz);

      if (dist < bestDist) {
        // Wall normal pointing toward cursor side
        let nx = -uz;
        let nz = ux;
        if (ox * nx + oz * nz < 0) {
          nx = -nx;
          nz = -nz;
        }
        bestDist = dist;
        bestCandidate = { wall, projX, projZ, ux, uz, nx, nz, t, len, dist };
      }
    }

    if (bestCandidate) {
      const { wall, ux, uz, nx, nz, len } = bestCandidate;
      // Snap along the wall tangent to grid if grid snapping is active
      let alongDist = bestCandidate.t * len;
      if (useGrid) {
        const minAlong = Math.min(len * 0.45, assetWidth * 0.5 + 0.05);
        alongDist = Math.max(
          minAlong,
          Math.min(len - minAlong, snapValue(alongDist, gridSize, true))
        );
      }

      const projX = wall.x1 + ux * alongDist;
      const projZ = wall.z1 + uz * alongDist;
      const wallHalfThick = Math.max(0.08, (wall.thickness || 0.18) * 0.5);
      const clearance = wallHalfThick + assetDepth * 0.5 + 0.04;

      x = Number((projX + nx * clearance).toFixed(2));
      z = Number((projZ + nz * clearance).toFixed(2));
      // Face +Z of the asset outward along the wall normal (into the room)
      rotationY = Number(Math.atan2(nx, nz).toFixed(3));

      snappedWall = {
        wallId: wall.id,
        wallName: wall.name || 'Wall',
        ax: wall.x1,
        az: wall.z1,
        bx: wall.x2,
        bz: wall.z2,
        projX: Number(projX.toFixed(2)),
        projZ: Number(projZ.toFixed(2)),
        distance: Number(bestCandidate.dist.toFixed(2)),
      };
    }
  }

  if (options?.floorWidth && options.floorWidth > 1) {
    x = Math.max(0.35, Math.min(options.floorWidth - 0.35, x));
  }
  if (options?.floorDepth && options.floorDepth > 1) {
    z = Math.max(0.35, Math.min(options.floorDepth - 0.35, z));
  }

  return {
    x,
    z,
    rotationY,
    snappedGrid: useGrid,
    snappedWall,
  };
}
