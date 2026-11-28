import type { OpeningSubtype, SnapConfig, Wall } from '../types/twin';
import type { OpeningPresetConfig } from '../data/materialsLibrary';
import { snapValue } from './spatial';

export const OPENING_DND_MIME = 'application/x-gradian-opening';

let activeDraggedOpeningSubtype: OpeningSubtype | null = null;

export function setActiveDraggedOpeningSubtype(subtype: OpeningSubtype | null): void {
  activeDraggedOpeningSubtype = subtype;
}

export function getActiveDraggedOpeningSubtype(): OpeningSubtype | null {
  return activeDraggedOpeningSubtype;
}

export interface ClampedOpeningSpec {
  width: number;
  height: number;
  sillHeight: number;
  offsetRatio: number;
  wallLength: number;
}

export interface WallOpeningDropPreview {
  wall: Wall;
  offsetRatio: number;
  worldX: number;
  worldZ: number;
  angleRad: number;
  width: number;
  height: number;
  sillHeight: number;
  distFromStart: number;
  wallLength: number;
  distToWall: number;
}

/**
 * Strictly clamps an opening's width, height, sillHeight, and offsetRatio so that
 * doors and windows ALWAYS sit cleanly inside their host wall — never overhanging
 * wall endpoints or floating above the wall top in mid-air.
 */
export function clampOpeningToWall(
  wall: Wall,
  desiredWidth: number,
  desiredHeight: number,
  desiredSillHeight: number,
  desiredOffsetRatio: number
): ClampedOpeningSpec {
  const wallLength = Math.max(0.4, Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1));
  const margin = Math.min(0.14, wallLength * 0.12);
  const maxWidth = Math.max(0.45, wallLength - margin * 2);
  const width = Number(Math.max(0.45, Math.min(desiredWidth, maxWidth)).toFixed(2));

  const wallH = Math.max(1.2, wall.height || 3.4);
  const topClearance = 0.08;
  const maxSill = Math.max(0, wallH - 0.55 - topClearance);
  const sillHeight = Number(Math.max(0, Math.min(desiredSillHeight, maxSill)).toFixed(2));

  const maxH = Math.max(0.4, wallH - sillHeight - topClearance);
  const height = Number(Math.max(0.4, Math.min(desiredHeight, maxH)).toFixed(2));

  const minRatio = Math.min(0.48, (width / 2 + margin) / wallLength);
  const maxRatio = Math.max(0.52, 1 - (width / 2 + margin) / wallLength);
  const offsetRatio = Number(
    Math.max(minRatio, Math.min(maxRatio, desiredOffsetRatio)).toFixed(3)
  );

  return { width, height, sillHeight, offsetRatio, wallLength };
}

/**
 * Finds the nearest valid wall segment on the active floor within `maxCaptureDist`
 * and computes a snapped, wall-clamped drop-zone preview for a door or window.
 * Returns `null` when the pointer is in open air away from any wall.
 */
export function findOpeningDropZone(
  worldX: number,
  worldZ: number,
  walls: Wall[],
  floorId: string,
  preset: Pick<OpeningPresetConfig, 'width' | 'height' | 'sillHeight'>,
  snap: SnapConfig,
  maxCaptureDist = 1.8,
  preferredWallId?: string | null
): WallOpeningDropPreview | null {
  const floorWalls = walls.filter((w) => w.floorId === floorId);
  if (floorWalls.length === 0) return null;

  let best: WallOpeningDropPreview | null = null;
  let bestScore = Infinity;

  for (const wall of floorWalls) {
    const dx = wall.x2 - wall.x1;
    const dz = wall.z2 - wall.z1;
    const lenSq = dx * dx + dz * dz;
    const len = Math.sqrt(lenSq);
    if (len < 0.7) continue; // Too short to host a door or window

    const rawT = ((worldX - wall.x1) * dx + (worldZ - wall.z1) * dz) / lenSq;
    const clampedT = Math.max(0, Math.min(1, rawT));
    const projX = wall.x1 + dx * clampedT;
    const projZ = wall.z1 + dz * clampedT;
    const distToWall = Math.hypot(worldX - projX, worldZ - projZ);

    const isPreferred = preferredWallId && wall.id === preferredWallId;
    if (!isPreferred && distToWall > maxCaptureDist) continue;

    // Slight priority bonus for the directly raycasted wall in 3D
    const score = isPreferred ? Math.max(0, distToWall - 0.35) : distToWall;
    if (score >= bestScore) continue;

    let snappedT = clampedT;
    if (snap.enabled && snap.snapToGrid) {
      const distAlong = snapValue(clampedT * len, snap.gridSize, true);
      snappedT = distAlong / len;
    }

    const clamped = clampOpeningToWall(
      wall,
      preset.width,
      preset.height,
      preset.sillHeight,
      snappedT
    );

    const cx = wall.x1 + dx * clamped.offsetRatio;
    const cz = wall.z1 + dz * clamped.offsetRatio;

    bestScore = score;
    best = {
      wall,
      offsetRatio: clamped.offsetRatio,
      worldX: Number(cx.toFixed(3)),
      worldZ: Number(cz.toFixed(3)),
      angleRad: Math.atan2(dz, dx),
      width: clamped.width,
      height: clamped.height,
      sillHeight: clamped.sillHeight,
      distFromStart: Number((clamped.offsetRatio * len).toFixed(2)),
      wallLength: Number(len.toFixed(2)),
      distToWall: Number(distToWall.toFixed(3)),
    };
  }

  return best;
}
