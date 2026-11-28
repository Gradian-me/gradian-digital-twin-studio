import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  Building2,
  CalendarClock,
  Camera,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Compass,
  DoorOpen,
  Droplets,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Focus,
  Footprints,
  Gauge,
  Glasses,
  Globe,
  Info,
  Layers,
  Lightbulb,
  Link2,
  Lock,
  Map as MapIcon,
  MapPin,
  Moon,
  Navigation,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Route,
  Scissors,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tablet,
  Thermometer,
  User,
  Volume2,
  VolumeX,
  Waypoints,
  Wind,
  X,
  Zap,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { useTwinStore, type RenderStyle } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useGmpStore } from '../store/useGmpStore';
import { useAclStore, computeEffectivePermissions, getActiveAclUser } from '../store/useAclStore';
import { useMayaStore } from '../store/useMayaStore';
import { getTargetFmeaSummary, useRiskIncidentStore } from '../store/useRiskIncidentStore';
import {
  AHU_CATALOG,
  computeRoomSupplyM3h,
  getAhuColor,
  getEffectiveRoomHvac,
} from '../utils/hvac';
import {
  FACILITY_CATEGORIES,
  doesAssetMatchCategory,
  doesRoomMatchCategory,
  getCategoryMeta,
} from '../utils/categoryFilter';
import { HEATMAP_SCALES, renderFloorHeatmapCanvas } from '../engine/heatmapGenerator';
import { METRIC_PRESETS, type HeatmapMetric, type SensorDefinition } from '../types/telemetry';
import { MiniSparkline } from './TelemetryDashboard';
import { AssetMini3DViewer } from './AssetMini3DViewer';
import { DEFAULT_MATERIALS, OPENING_PRESETS } from '../data/materialsLibrary';
import { OBJECT_LIBRARY } from '../data/objectLibrary';
import { findOpeningDropZone } from '../utils/openingPlacement';
import { OpeningQuickBar } from './OpeningQuickBar';
import { getProceduralMaterial } from '../engine/proceduralTextures';
import { buildProceduralEquipmentGroup } from '../engine/equipmentBuilder';
import {
  buildFloorNavMesh,
  buildNavMeshVisualGroup,
  planGmpRoute,
  type FloorNavMesh,
  type GmpRouteCheckpoint,
  type NoGoZone,
  type PathRoutingAlgorithm,
} from '../engine/navMesh';
import {
  DEFAULT_SPATIAL_AUDIO_SETTINGS,
  FacilitySpatialAudioEngine,
  type NearbyAudioTelemetry,
  type SpatialAudioSettings,
} from '../engine/spatialAudio';
import {
  animatePathFinderVisual,
  computePathLengthMeters,
  populateNoGoZonesVisual,
  populatePathFinderVisual,
  type PathFinderVisualRig,
} from '../engine/pathFinderVisual';
import {
  PathFinderConfigPopover,
  SpatialAudioSettingsPopover,
} from './WalkthroughConfigPopovers';
import { getAssetBounds, getRoomColorForAnalytics, snapValue } from '../utils/spatial';
import { computeFlowRoomSequence } from '../utils/flowAnalytics';
import { computeSnappedPlacement } from '../utils/placementSnap';
import { detectEnclosedWallPolygons } from '../utils/polygonSpaces';
import {
  computeSwitchLocalTransform,
  getEffectiveRoomLighting,
  getFixtureCatalogItem,
  kelvinToHex,
} from '../utils/lighting';
import { attachCanvasPinchGuard } from '../utils/preventPinchZoom';
import { MayaController, loadMayaGltf } from '../lib/mayaController';
import type { Building, Floor, MaterialDef, Opening, Room, SpatialAsset, Wall } from '../types/twin';

const _projVec = new THREE.Vector3();
const _projViewMat = new THREE.Matrix4();
const _tmpMat4 = new THREE.Matrix4();
const _tmpVec3 = new THREE.Vector3();
const _tmpScale = new THREE.Vector3(1, 1, 1);
const _tmpColor = new THREE.Color();
const _flipQuatX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const _identityQuat = new THREE.Quaternion();
const _mayaAxisX = new THREE.Vector3(1, 0, 0);
const _mayaAdditiveQuat = new THREE.Quaternion();

interface FlowPulseTrack {
  samples: Float32Array; // N * 3 base world-space xyz points (before exploded offset)
  sampleCount: number;
  phase: number;
  speed: number;
  scale: number;
  levelIndex: number;
}

interface WalkAvatarRig {
  root: THREE.Group;
  modelHolder: THREE.Group;
  shadowRing: THREE.Mesh;
  mayaController: MayaController | null;
  torsoPivot: THREE.Object3D | null;
  armL: THREE.Object3D | null;
  armR: THREE.Object3D | null;
  legL: THREE.Object3D | null;
  legR: THREE.Object3D | null;
  baseTorsoY: number;
  activeMotionMode: 'idle' | 'walk' | 'sprint' | 'jump';
  manualEmoteUntil: number;
  loaded: boolean;
  disposed: boolean;
}

function buildWalkAvatar(onLoaded?: () => void): WalkAvatarRig {
  const root = new THREE.Group();
  root.visible = false;

  // Ground contact halo so MAYA's footing is unmistakable during walking and jumping
  const shadowRing = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.38, 28),
    new THREE.MeshBasicMaterial({
      color: '#8B5CF6',
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  shadowRing.rotation.x = -Math.PI / 2;
  shadowRing.position.y = 0.025;
  root.add(shadowRing);

  const modelHolder = new THREE.Group();
  root.add(modelHolder);

  const rig: WalkAvatarRig = {
    root,
    modelHolder,
    shadowRing,
    mayaController: null,
    torsoPivot: null,
    armL: null,
    armR: null,
    legL: null,
    legR: null,
    baseTorsoY: 0.38,
    activeMotionMode: 'idle',
    manualEmoteUntil: 0,
    loaded: false,
    disposed: false,
  };

  // Load MAYA Cinematic v3 GLB asynchronously and ground feet flush at y = 0
  loadMayaGltf('/models/maya.glb')
    .then((gltf) => {
      if (rig.disposed) {
        gltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => m.dispose());
          }
        });
        return;
      }

      const model = gltf.scene;
      model.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = obj.name !== 'StatusIconAtlas';
          mesh.receiveShadow = true;
        }
      });

      // Scale MAYA (~2.14 units tall) to crisp ~0.98m proportions so head & torso glide cleanly through 1.0m doors
      const mayaScale = 0.46;
      model.scale.setScalar(mayaScale);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      if (Number.isFinite(bounds.min.y)) {
        model.position.y -= bounds.min.y;
      }

      modelHolder.add(model);

      const controller = new MayaController(gltf, {
        fade: 0.42,
        faceFade: 0.16,
        autoReturn: true,
      });
      controller.setGowned(useMayaStore.getState().isGowned);

      rig.mayaController = controller;
      rig.torsoPivot = model.getObjectByName('TorsoPivot') ?? null;
      rig.armL = model.getObjectByName('Arm_L') ?? null;
      rig.armR = model.getObjectByName('Arm_R') ?? null;
      rig.legL = model.getObjectByName('Leg_L') ?? null;
      rig.legR = model.getObjectByName('Leg_R') ?? null;
      rig.baseTorsoY = rig.torsoPivot ? rig.torsoPivot.position.y : 0.38;
      rig.loaded = true;
      onLoaded?.();
    })
    .catch((err) => {
      console.error('Failed to load MAYA 3D character:', err);
    });

  return rig;
}

function pickWalkSpawn(
  activeFl: Floor | undefined,
  rooms: Room[],
  navMesh: FloorNavMesh | null
): { x: number; z: number; lookX: number; lookZ: number } {
  const flW = activeFl?.width ?? 28;
  const flD = activeFl?.depth ?? 18;
  const flRooms = activeFl ? rooms.filter((r) => r.floorId === activeFl.id) : [];

  // Prefer a corridor or spacious room center so user always spawns grounded inside a real room
  const corridor = flRooms.find((r) =>
    /corridor|hall|lobby|airlock|aisle|gallery/i.test(r.name)
  );
  const largestRoom =
    corridor ??
    [...flRooms].sort((a, b) => b.width * b.depth - a.width * a.depth)[0];

  const seedX = largestRoom
    ? largestRoom.x + largestRoom.width * 0.5
    : flW * 0.5;
  const seedZ = largestRoom
    ? largestRoom.z + largestRoom.depth * 0.5
    : flD * 0.5;

  const safe = navMesh
    ? navMesh.findNearestWalkable(seedX, seedZ)
    : { x: seedX, z: seedZ };

  const clampedX = Math.max(0.8, Math.min(flW - 0.8, safe.x));
  const clampedZ = Math.max(0.8, Math.min(flD - 0.8, safe.z));
  const lookX = largestRoom ? largestRoom.x + largestRoom.width * 0.8 : flW * 0.5;
  const lookZ = largestRoom ? largestRoom.z + largestRoom.depth * 0.25 : flD * 0.25;
  return { x: clampedX, z: clampedZ, lookX, lookZ };
}

const PULSE_SAMPLES = 48;

function sampleCurveWorld(
  curve: THREE.CatmullRomCurve3,
  ox: number,
  oy: number,
  oz: number
): Float32Array {
  const arr = new Float32Array(PULSE_SAMPLES * 3);
  for (let i = 0; i < PULSE_SAMPLES; i++) {
    const t = i / (PULSE_SAMPLES - 1);
    curve.getPointAt(t, _tmpVec3);
    arr[i * 3] = _tmpVec3.x + ox;
    arr[i * 3 + 1] = _tmpVec3.y + oy;
    arr[i * 3 + 2] = _tmpVec3.z + oz;
  }
  return arr;
}

// Deduplicate & trim overlapping coplanar wall segments (prevents Z-fighting / crashy flicker when adjacent rooms share a wall)
function deduplicateCoplanarWalls(walls: Wall[], openings: Opening[]): Wall[] {
  const openingCountByWall = new Map<string, number>();
  for (const op of openings) {
    openingCountByWall.set(op.wallId, (openingCountByWall.get(op.wallId) ?? 0) + 1);
  }

  const isGlass = (w: Wall) =>
    w.presetId === 'full-glass-wall' ||
    w.presetId === 'glass-partition' ||
    w.materialId === 'mat-glass-cleanroom' ||
    w.opacity < 0.65;

  // Prioritize walls with openings, glass partitions, greater thickness, and longer length
  const sorted = [...walls].sort((a, b) => {
    const opDiff = (openingCountByWall.get(b.id) ?? 0) - (openingCountByWall.get(a.id) ?? 0);
    if (opDiff !== 0) return opDiff;
    const glassDiff = Number(isGlass(b)) - Number(isGlass(a));
    if (glassDiff !== 0) return glassDiff;
    const thickDiff = (b.thickness || 0.18) - (a.thickness || 0.18);
    if (Math.abs(thickDiff) > 0.01) return thickDiff;
    const lenA = Math.hypot(a.x2 - a.x1, a.z2 - a.z1);
    const lenB = Math.hypot(b.x2 - b.x1, b.z2 - b.z1);
    return lenB - lenA;
  });

  const accepted: Wall[] = [];

  for (const w of sorted) {
    const dx = w.x2 - w.x1;
    const dz = w.z2 - w.z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ux = dx / len;
    const uz = dz / len;

    // Collect intervals along [0, len] already covered by an accepted coplanar wall
    const covered: [number, number][] = [];
    for (const acc of accepted) {
      const adx = acc.x2 - acc.x1;
      const adz = acc.z2 - acc.z1;
      const alen = Math.hypot(adx, adz);
      if (alen < 0.05) continue;
      const dot = Math.abs((adx / alen) * ux + (adz / alen) * uz);
      if (dot < 0.97) continue;

      // Perpendicular distance from acc midpoint to w's infinite line
      const midX = (acc.x1 + acc.x2) * 0.5 - w.x1;
      const midZ = (acc.z1 + acc.z2) * 0.5 - w.z1;
      const perp = Math.abs(midX * -uz + midZ * ux);
      const maxPerp = Math.max(0.24, ((w.thickness || 0.18) + (acc.thickness || 0.18)) * 0.65);
      if (perp > maxPerp) continue;

      const t1 = (acc.x1 - w.x1) * ux + (acc.z1 - w.z1) * uz;
      const t2 = (acc.x2 - w.x1) * ux + (acc.z2 - w.z1) * uz;
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(len, Math.max(t1, t2));
      if (hi - lo > 0.08) {
        covered.push([lo, hi]);
      }
    }

    if (covered.length === 0) {
      accepted.push(w);
      continue;
    }

    // Merge covered intervals and keep uncovered remainders
    covered.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const seg of covered) {
      if (merged.length === 0 || seg[0] > merged[merged.length - 1][1] + 0.04) {
        merged.push([seg[0], seg[1]]);
      } else {
        merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], seg[1]);
      }
    }

    let cursor = 0;
    let partIdx = 0;
    for (const [lo, hi] of merged) {
      if (lo - cursor > 0.14) {
        accepted.push({
          ...w,
          id: partIdx === 0 ? w.id : `${w.id}__p${partIdx}`,
          x1: Number((w.x1 + ux * cursor).toFixed(3)),
          z1: Number((w.z1 + uz * cursor).toFixed(3)),
          x2: Number((w.x1 + ux * lo).toFixed(3)),
          z2: Number((w.z1 + uz * lo).toFixed(3)),
        });
        partIdx++;
      }
      cursor = Math.max(cursor, hi);
    }
    if (len - cursor > 0.14) {
      accepted.push({
        ...w,
        id: partIdx === 0 ? w.id : `${w.id}__p${partIdx}`,
        x1: Number((w.x1 + ux * cursor).toFixed(3)),
        z1: Number((w.z1 + uz * cursor).toFixed(3)),
        x2: w.x2,
        z2: w.z2,
      });
    }
  }

  return accepted;
}

// Exact sub-stepped 2D circle-vs-wall-segment collision with wall sliding.
// Walkable open door openings (sillHeight < 0.25m) punch cleanly through BOTH their host wall
// AND any coplanar adjacent/shared room wall; closed doors, solid walls, glass walls, and windows block 100%.
function resolveStrictWallCollision(
  prevX: number,
  prevZ: number,
  targetX: number,
  targetZ: number,
  playerRadius: number,
  walls: Wall[],
  openings: Opening[],
  floorWidth: number,
  floorDepth: number,
  openDoorsMap?: Record<string, boolean>
): { x: number; z: number } {
  const wallById = new Map<string, Wall>();
  for (const w of walls) {
    wallById.set(w.id, w);
  }

  // Precompute world-space passable door portals so open doors cut through double/shared adjacent walls
  const passablePortals: {
    wallId: string;
    cx: number;
    cz: number;
    ux: number;
    uz: number;
    width: number;
    hostThickness: number;
  }[] = [];

  for (const o of openings) {
    if (o.kind !== 'door' || o.sillHeight >= 0.25) continue;
    const host = wallById.get(o.wallId);
    if (!host) continue;
    const hdx = host.x2 - host.x1;
    const hdz = host.z2 - host.z1;
    const hlen = Math.hypot(hdx, hdz);
    if (hlen < 0.05) continue;

    const cx = host.x1 + hdx * o.offsetRatio;
    const cz = host.z1 + hdz * o.offsetRatio;
    const ux = hdx / hlen;
    const uz = hdz / hlen;
    const hostThick = host.thickness || 0.18;
    const isOpen = !openDoorsMap ? true : (openDoorsMap[o.id] ?? o.status === 'open');

    // Only allow escape if player center is literally embedded INSIDE the solid wall slab
    // (never when standing in front of a closed door!)
    const relPrevX = prevX - cx;
    const relPrevZ = prevZ - cz;
    const prevAlong = Math.abs(relPrevX * ux + relPrevZ * uz);
    const prevPerp = Math.abs(relPrevX * -uz + relPrevZ * ux);
    const stuckInsideWallPlane =
      !isOpen && prevPerp < hostThick * 0.5 + 0.04 && prevAlong < o.width * 0.45;

    if (!isOpen && !stuckInsideWallPlane) continue;

    passablePortals.push({
      wallId: host.id,
      cx,
      cz,
      ux,
      uz,
      width: o.width,
      hostThickness: hostThick,
    });
  }

  const solidSegments: { ax: number; az: number; bx: number; bz: number; halfThick: number }[] = [];

  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dz = w.z2 - w.z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ux = dx / len;
    const uz = dz / len;
    const wallThick = w.thickness || 0.18;
    const halfThick = Math.max(0.08, wallThick * 0.5);

    const doorGaps: [number, number][] = [];
    for (const portal of passablePortals) {
      const relX = portal.cx - w.x1;
      const relZ = portal.cz - w.z1;
      const proj = relX * ux + relZ * uz;

      let cutsThisWall = portal.wallId === w.id;
      if (!cutsThisWall) {
        // Cut coplanar / parallel adjacent walls (e.g. Room South Wall overlapping Corridor North Wall)
        const parallelDot = Math.abs(portal.ux * ux + portal.uz * uz);
        if (parallelDot >= 0.88) {
          const perp = Math.abs(relX * -uz + relZ * ux);
          const maxCoplanarSep = Math.max(0.65, wallThick + portal.hostThickness + 0.28);
          if (perp <= maxCoplanarSep) {
            cutsThisWall = true;
          }
        }
      }

      if (!cutsThisWall) continue;

      // Account for wall-end circular collision cap (playerRadius + halfThick) so MAYA never snags jambs
      const half = Math.max(0.46, portal.width * 0.5) + halfThick + Math.min(0.16, playerRadius * 0.4);
      if (proj + half > 0 && proj - half < len) {
        doorGaps.push([Math.max(0, proj - half), Math.min(len, proj + half)]);
      }
    }

    doorGaps.sort((a, b) => a[0] - b[0]);

    let cursor = 0;
    for (const [gStart, gEnd] of doorGaps) {
      if (gStart - cursor > 0.04) {
        solidSegments.push({
          ax: w.x1 + ux * cursor,
          az: w.z1 + uz * cursor,
          bx: w.x1 + ux * gStart,
          bz: w.z1 + uz * gStart,
          halfThick,
        });
      }
      cursor = Math.max(cursor, gEnd);
    }
    if (len - cursor > 0.04) {
      solidSegments.push({
        ax: w.x1 + ux * cursor,
        az: w.z1 + uz * cursor,
        bx: w.x1 + ux * len,
        bz: w.z1 + uz * len,
        halfThick,
      });
    }
  }

  const totalDist = Math.hypot(targetX - prevX, targetZ - prevZ);
  const steps = Math.max(1, Math.ceil(totalDist / 0.16));
  let cx = prevX;
  let cz = prevZ;
  const stepDx = (targetX - prevX) / steps;
  const stepDz = (targetZ - prevZ) / steps;

  for (let s = 0; s < steps; s++) {
    const beforeX = cx;
    const beforeZ = cz;
    cx += stepDx;
    cz += stepDz;

    for (let iter = 0; iter < 3; iter++) {
      for (const seg of solidSegments) {
        const sx = seg.bx - seg.ax;
        const sz = seg.bz - seg.az;
        const lenSq = sx * sx + sz * sz;
        if (lenSq < 1e-6) continue;
        let t = ((cx - seg.ax) * sx + (cz - seg.az) * sz) / lenSq;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const px = seg.ax + sx * t;
        const pz = seg.az + sz * t;
        const ox = cx - px;
        const oz = cz - pz;
        const distSq = ox * ox + oz * oz;
        const minDist = playerRadius + seg.halfThick;
        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          if (dist > 1e-5) {
            const push = minDist - dist;
            cx += (ox / dist) * push;
            cz += (oz / dist) * push;
          } else {
            const segLen = Math.sqrt(lenSq);
            const nx = -sz / segLen;
            const nz = sx / segLen;
            const side = (beforeX - px) * nx + (beforeZ - pz) * nz >= 0 ? 1 : -1;
            cx = px + nx * side * minDist;
            cz = pz + nz * side * minDist;
          }
        }
      }
    }
  }

  if (floorWidth > 1 && floorDepth > 1) {
    const margin = Math.max(0.35, playerRadius);
    cx = Math.max(margin, Math.min(floorWidth - margin, cx));
    cz = Math.max(margin, Math.min(floorDepth - margin, cz));
  }

  return { x: cx, z: cz };
}

/**
 * Exact 2D circle-vs-equipment AABB pushout so MAYA smoothly glides around
 * bioreactors, tanks, benches, lockers, and skids in both manual & auto-walk modes.
 */
function resolveAssetCollisions(
  x: number,
  z: number,
  playerRadius: number,
  assets: SpatialAsset[],
  walls: Wall[],
  openings: Opening[],
  openDoorsMap?: Record<string, boolean>
): { x: number; z: number } {
  if (assets.length === 0) return { x, z };
  if (isInsideOpenDoorPortal(x, z, walls, openings, openDoorsMap)) {
    return { x, z };
  }
  let cx = x;
  let cz = z;
  const r = Math.max(0.18, playerRadius * 0.92);

  for (let iter = 0; iter < 2; iter++) {
    for (const a of assets) {
      if (a.hidden || a.y >= 1.55) continue;
      if (a.width < 0.24 && a.depth < 0.24) continue;
      const b = getAssetBounds(a);
      const shrink = 0.04;
      const minX = b.minX + shrink;
      const maxX = b.maxX - shrink;
      const minZ = b.minZ + shrink;
      const maxZ = b.maxZ - shrink;
      if (maxX <= minX || maxZ <= minZ) continue;

      const closestX = Math.max(minX, Math.min(cx, maxX));
      const closestZ = Math.max(minZ, Math.min(cz, maxZ));
      const dx = cx - closestX;
      const dz = cz - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < r * r) {
        if (distSq > 1e-6) {
          const dist = Math.sqrt(distSq);
          const push = r - dist;
          cx += (dx / dist) * push;
          cz += (dz / dist) * push;
        } else {
          // Inside box: push out along nearest face
          const penLeft = Math.abs(cx - minX);
          const penRight = Math.abs(maxX - cx);
          const penTop = Math.abs(cz - minZ);
          const penBot = Math.abs(maxZ - cz);
          const m = Math.min(penLeft, penRight, penTop, penBot);
          if (m === penLeft) cx = minX - r;
          else if (m === penRight) cx = maxX + r;
          else if (m === penTop) cz = minZ - r;
          else cz = maxZ + r;
        }
      }
    }
  }
  return { x: cx, z: cz };
}

function isInsideOpenDoorPortal(
  x: number,
  z: number,
  walls: Wall[],
  openings: Opening[],
  openDoorsMap?: Record<string, boolean>
): boolean {
  for (const o of openings) {
    if (o.kind !== 'door' || o.sillHeight >= 0.25) continue;
    const isOpen = !openDoorsMap ? true : (openDoorsMap[o.id] ?? o.status === 'open');
    if (!isOpen) continue;
    const host = walls.find((w) => w.id === o.wallId);
    if (!host) continue;
    const dx = host.x2 - host.x1;
    const dz = host.z2 - host.z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    const cx = host.x1 + dx * o.offsetRatio;
    const cz = host.z1 + dz * o.offsetRatio;
    const rx = x - cx;
    const rz = z - cz;
    const along = Math.abs(rx * ux + rz * uz);
    const perp = Math.abs(rx * nx + rz * nz);
    const halfWidth = Math.max(0.5, o.width * 0.5 + 0.04);
    const halfDepth = Math.max(0.95, (host.thickness || 0.18) + 0.72);
    if (along <= halfWidth && perp <= halfDepth) {
      return true;
    }
  }
  return false;
}

function isNearFloorDoorway(x: number, z: number, walls: Wall[], openings: Opening[]): boolean {
  for (const o of openings) {
    if (o.kind !== 'door' || o.sillHeight >= 0.25) continue;
    const w = walls.find((wall) => wall.id === o.wallId);
    if (!w) continue;
    const cx = w.x1 + (w.x2 - w.x1) * o.offsetRatio;
    const cz = w.z1 + (w.z2 - w.z1) * o.offsetRatio;
    if (Math.hypot(x - cx, z - cz) <= Math.max(1.25, o.width * 0.9)) {
      return true;
    }
  }
  return false;
}

function findClosedDoorAhead(
  px: number,
  pz: number,
  tx: number,
  tz: number,
  walls: Wall[],
  openings: Opening[],
  openDoorsMap: Record<string, boolean>,
  maxLookAhead = 1.95
): { opening: Opening; wall: Wall; cx: number; cz: number; dist: number } | null {
  const segDx = tx - px;
  const segDz = tz - pz;
  const segLen = Math.hypot(segDx, segDz);
  const dirX = segLen > 1e-4 ? segDx / segLen : 0;
  const dirZ = segLen > 1e-4 ? segDz / segLen : 0;

  let best: { opening: Opening; wall: Wall; cx: number; cz: number; dist: number } | null = null;
  for (const o of openings) {
    if (o.kind !== 'door' || o.sillHeight >= 0.25) continue;
    const isOpen = Boolean(openDoorsMap[o.id] ?? o.status === 'open');
    if (isOpen) continue;
    const host = walls.find((w) => w.id === o.wallId);
    if (!host) continue;

    const dcx = host.x1 + (host.x2 - host.x1) * o.offsetRatio;
    const dcz = host.z1 + (host.z2 - host.z1) * o.offsetRatio;
    const dist = Math.hypot(dcx - px, dcz - pz);
    if (dist > maxLookAhead) continue;

    // Check if door lies ahead along travel direction OR sits right on the segment toward target
    const toDoorX = dcx - px;
    const toDoorZ = dcz - pz;
    const forwardDot = dist > 1e-4 ? (toDoorX * dirX + toDoorZ * dirZ) / dist : 1;

    let distToSeg = dist;
    if (segLen > 1e-4) {
      const t = Math.max(0, Math.min(1, (toDoorX * segDx + toDoorZ * segDz) / (segLen * segLen)));
      distToSeg = Math.hypot(dcx - (px + segDx * t), dcz - (pz + segDz * t));
    }

    const onPath =
      dist <= 1.25 ||
      (forwardDot >= 0.35 && distToSeg <= Math.max(0.85, o.width * 0.65));

    if (onPath && (!best || dist < best.dist)) {
      best = { opening: o, wall: host, cx: dcx, cz: dcz, dist };
    }
  }
  return best;
}

// Cached procedural radial floor light-pool texture for ultra-fast Night Mode warm room glow
let _warmLightPoolTex: THREE.CanvasTexture | null = null;
function getWarmLightPoolTexture(): THREE.CanvasTexture | null {
  if (_warmLightPoolTex) return _warmLightPoolTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255, 224, 172, 0.52)');
  grad.addColorStop(0.35, 'rgba(255, 200, 128, 0.28)');
  grad.addColorStop(0.72, 'rgba(255, 178, 92, 0.08)');
  grad.addColorStop(1, 'rgba(255, 160, 64, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  _warmLightPoolTex = new THREE.CanvasTexture(c);
  _warmLightPoolTex.colorSpace = THREE.SRGBColorSpace;
  return _warmLightPoolTex;
}

const isSoftwareGl = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
})();

function disposeObject3D(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  });
}

function applyBlueprintWireframeToGroup(
  group: THREE.Object3D,
  edgeColor = '#38BDF8',
  fillOpacity = 0.16,
  clipPlanes: THREE.Plane[] = []
) {
  const meshes: THREE.Mesh[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      meshes.push(child as THREE.Mesh);
    }
  });
  meshes.forEach((mesh) => {
    mesh.material = new THREE.MeshBasicMaterial({
      color: '#0284C7',
      transparent: true,
      opacity: fillOpacity,
      depthWrite: false,
      clippingPlanes: clipPlanes,
    });
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 24),
      new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: true,
        opacity: 0.78,
        clippingPlanes: clipPlanes,
      })
    );
    mesh.add(edges);
  });
}

// Local telemetry subscriber for each 3D sensor beacon chip (prevents 1.5s full-Viewport3D re-renders)
const Viewport3DSensorPinChip = React.memo<{
  pin: {
    key: string;
    targetKind: 'asset' | 'room';
    targetId: string;
    targetName: string;
    targetCode: string;
    mainSensor: SensorDefinition;
  };
  isInspected: boolean;
  fmea: ReturnType<typeof getTargetFmeaSummary> | null;
  onToggleInspect: (key: string) => void;
  onOpenRisk: (incidentId: string) => void;
  registerDom: (key: string, el: HTMLDivElement | null) => void;
}>(({ pin, isInspected, fmea, onToggleInspect, onOpenRisk, registerDom }) => {
  const snap = useTelemetryStore((s) => s.readings[pin.mainSensor.id]);
  const val = snap?.value ?? pin.mainSensor.nominal;
  const status = snap?.status ?? 'nominal';

  const dotCls =
    status === 'alarm' || fmea?.level === 'critical'
      ? 'bg-rose-500'
      : status === 'warning' || fmea?.level === 'high'
        ? 'bg-amber-400'
        : 'bg-emerald-400';
  const borderCls = isInspected
    ? 'border-violet-400 ring-2 ring-violet-500/40'
    : status === 'alarm' || fmea?.level === 'critical'
      ? 'border-rose-500/90'
      : status === 'warning' || fmea?.level === 'high'
        ? 'border-amber-500/80'
        : 'border-zinc-700/90 hover:border-violet-400';

  return (
    <div
      ref={(el) => registerDom(pin.key, el)}
      style={{ opacity: 0, willChange: 'transform' }}
      className="absolute top-0 left-0"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onToggleInspect(pin.key)}
          className={`group flex items-center gap-1.5 rounded-full bg-[#131319] text-zinc-100 border ${borderCls} shadow-lg px-2.5 py-1 text-[10.5px] font-mono tabular-nums whitespace-nowrap transition-colors cursor-pointer`}
          title={`${pin.targetName} — Click to inspect 3D model & live sensors`}
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
          <span className="font-semibold text-zinc-100">{pin.targetCode}</span>
          <span className="text-zinc-500">·</span>
          <span className="text-amber-300 font-semibold">
            {val.toFixed(pin.mainSensor.precision)}
            <span className="text-zinc-400 font-normal ml-0.5">{pin.mainSensor.unit}</span>
          </span>
        </button>
        {fmea && fmea.level !== 'clear' && fmea.worstIncident && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenRisk(fmea.worstIncident!.id);
            }}
            className={`px-1.5 py-0.5 rounded-md text-[9.5px] font-mono font-bold tabular-nums shadow-lg cursor-pointer ${
              fmea.level === 'critical'
                ? 'bg-rose-500 text-white'
                : fmea.level === 'high'
                  ? 'bg-amber-400 text-zinc-950'
                  : fmea.level === 'mitigated'
                    ? 'bg-emerald-500 text-zinc-950'
                    : 'bg-violet-500 text-white'
            }`}
            title={`FMEA ${fmea.shortLabel}: ${fmea.worstIncident.title}`}
          >
            {fmea.shortLabel}
          </button>
        )}
      </div>
      <div className="mx-auto w-px h-2.5 bg-violet-500/60" />
    </div>
  );
});

// Local telemetry subscriber for Focused Pin Inspector body
const Viewport3DInspectedPinBody: React.FC<{
  inspectedAssetObj: any;
  inspectedRoomObj: any;
  mainSensor: SensorDefinition;
  secondarySensors: SensorDefinition[];
}> = ({ inspectedAssetObj, inspectedRoomObj, mainSensor, secondarySensors }) => {
  const readings = useTelemetryStore((s) => s.readings);
  const allCh = [mainSensor, ...secondarySensors];
  return (
    <>
      <AssetMini3DViewer
        asset={inspectedAssetObj}
        room={inspectedRoomObj}
        height={186}
        statusAccent={readings[mainSensor.id]?.status ?? 'nominal'}
      />
      <div className="space-y-1.5 max-h-40 overflow-y-auto overscroll-contain touch-pan-y pr-0.5">
        {allCh.map((s) => {
          const snap = readings[s.id];
          const v = snap?.value ?? s.nominal;
          const st = snap?.status ?? 'nominal';
          const color =
            st === 'alarm'
              ? '#F43F5E'
              : st === 'warning'
                ? '#F59E0B'
                : METRIC_PRESETS[s.metric]?.color ?? '#8B5CF6';
          return (
            <div
              key={s.id}
              className="px-3 py-2 rounded-2xl bg-zinc-50 dark:bg-[#191923] border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                  {s.tag} {s.isMainSensor ? '★' : ''}
                </div>
                <div className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200 truncate">
                  {s.name.split('·').pop()?.trim() || s.name}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <MiniSparkline points={snap?.history ?? []} color={color} width={48} height={18} />
                <span className="font-mono tabular-nums text-xs font-bold text-zinc-900 dark:text-white">
                  {v.toFixed(s.precision)}
                  <span className="text-[10px] font-normal text-zinc-400 ml-0.5">{s.unit}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

// Local telemetry subscriber for First-Person Walk handheld tablet room metrics
const Viewport3DWalkRoomMetrics: React.FC<{
  tempSnap?: SensorDefinition;
  rhSnap?: SensorDefinition;
  dpSnap?: SensorDefinition;
  curRoom?: Room;
}> = ({ tempSnap, rhSnap, dpSnap, curRoom }) => {
  const readings = useTelemetryStore((s) => s.readings);
  const tVal = tempSnap ? readings[tempSnap.id]?.value ?? tempSnap.nominal : curRoom?.environmental.temperatureC ?? 21.0;
  const rhVal = rhSnap ? readings[rhSnap.id]?.value ?? rhSnap.nominal : curRoom?.environmental.humidityPct ?? 45;
  const dpVal = dpSnap ? readings[dpSnap.id]?.value ?? dpSnap.nominal : curRoom?.environmental.pressurePa ?? 15;
  return (
    <div className="grid grid-cols-3 gap-1.5 font-mono tabular-nums">
      <div className="p-1.5 sm:p-2 rounded-xl bg-[#1A1A25] border border-zinc-800">
        <div className="text-[9px] text-zinc-400 flex items-center gap-0.5">
          <Thermometer className="w-2.5 h-2.5 text-amber-400" /> T
        </div>
        <div className="text-[11px] sm:text-xs font-bold text-white mt-0.5">
          {tVal.toFixed(1)}°
        </div>
      </div>
      <div className="p-1.5 sm:p-2 rounded-xl bg-[#1A1A25] border border-zinc-800">
        <div className="text-[9px] text-zinc-400 flex items-center gap-0.5">
          <Droplets className="w-2.5 h-2.5 text-cyan-400" /> RH
        </div>
        <div className="text-[11px] sm:text-xs font-bold text-white mt-0.5">
          {rhVal.toFixed(0)}%
        </div>
      </div>
      <div className="p-1.5 sm:p-2 rounded-xl bg-[#1A1A25] border border-zinc-800">
        <div className="text-[9px] text-zinc-400 flex items-center gap-0.5">
          <Gauge className="w-2.5 h-2.5 text-emerald-400" /> ΔP
        </div>
        <div className="text-[11px] sm:text-xs font-bold text-emerald-400 mt-0.5">
          {dpVal >= 0 ? '+' : ''}
          {dpVal.toFixed(0)}Pa
        </div>
      </div>
    </div>
  );
};

export const Viewport3D: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const storeRef = useRef(useTwinStore.getState());

  // Reactive subscriptions
  const sceneData = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const activeBuildingId = useTwinStore((s) => s.activeBuildingId);
  const activeDepartmentId = useTwinStore((s) => s.activeDepartmentId);
  const activeRoomId = useTwinStore((s) => s.activeRoomId);
  const drillLevel = useTwinStore((s) => s.drillLevel);
  const showAllFloors = useTwinStore((s) => s.showAllFloors);
  const renderStyle = useTwinStore((s) => s.renderStyle);
  const workspaceMode = useTwinStore((s) => s.workspaceMode);
  const categoryFilter = useTwinStore((s) => s.categoryFilter);
  const viewMode = useTwinStore((s) => s.viewMode);
  const orthoPreset = useTwinStore((s) => s.orthoPreset);
  const activeTool = useTwinStore((s) => s.activeTool);
  const transformMode = useTwinStore((s) => s.transformMode);
  const selected = useTwinStore((s) => s.selected);
  const isolatedIds = useTwinStore((s) => s.isolatedIds);
  const isolatedAssetType = useTwinStore((s) => s.isolatedAssetType);
  const snap = useTwinStore((s) => s.snap);
  const analyticsMetric = useTwinStore((s) => s.analyticsMetric);
  const sectionCutEnabled = useTwinStore((s) => s.sectionCutEnabled);
  const sectionCutHeight = useTwinStore((s) => s.sectionCutHeight);
  const sectionCutAxis = useTwinStore((s) => s.sectionCutAxis);
  const sectionCutFlipped = useTwinStore((s) => s.sectionCutFlipped);
  const explodedFactor = useTwinStore((s) => s.explodedFactor);
  const firstPersonMode = useTwinStore((s) => s.firstPersonMode);
  const firstPersonTabletVisible = useTwinStore((s) => s.firstPersonTabletVisible);
  const vrSessionActive = useTwinStore((s) => s.vrSessionActive);
  const vrMode = useTwinStore((s) => s.vrMode);
  const vrToggleNonce = useTwinStore((s) => s.vrToggleNonce);
  const showNavMesh = useTwinStore((s) => s.showNavMesh);
  const lightingMode = useTwinStore((s) => s.lightingMode);
  const animateFlows = useTwinStore((s) => s.animateFlows);
  const showFlows = useTwinStore((s) => s.showFlows);
  const isolatedFlowId = useTwinStore((s) => s.isolatedFlowId);
  const hiddenFlowIds = useTwinStore((s) => s.hiddenFlowIds);
  const showRoomPins = useTwinStore((s) => s.showRoomPins);
  const showHvacOverlay = useTwinStore((s) => s.showHvacOverlay);
  const hvacAhuFilter = useTwinStore((s) => s.hvacAhuFilter);
  const showFmeaIndicators = useTwinStore((s) => s.showFmeaIndicators);
  const timelineDate = useTwinStore((s) => s.timelineDate);
  const canvasBackdrop = useTwinStore((s) => s.canvasBackdrop);
  const cameraCommand = useTwinStore((s) => s.cameraCommand);
  const pendingAIActions = useTwinStore((s) => s.pendingAIActions);
  const measurePoints = useTwinStore((s) => s.measurePoints);

  const drillInto = useTwinStore((s) => s.drillInto);
  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const setShowAllFloors = useTwinStore((s) => s.setShowAllFloors);
  const setExplodedFactor = useTwinStore((s) => s.setExplodedFactor);
  const setCategoryFilter = useTwinStore((s) => s.setCategoryFilter);
  const setRenderStyle = useTwinStore((s) => s.setRenderStyle);
  const clearIsolation = useTwinStore((s) => s.clearIsolation);
  const flyToCamera = useTwinStore((s) => s.flyToCamera);
  const buildDirectUrl = useTwinStore((s) => s.buildDirectUrl);
  const showToast = useTwinStore((s) => s.showToast);
  const setSectionCut = useTwinStore((s) => s.setSectionCut);
  const resetSectionCut = useTwinStore((s) => s.resetSectionCut);
  const setFirstPersonMode = useTwinStore((s) => s.setFirstPersonMode);
  const setFirstPersonTabletVisible = useTwinStore((s) => s.setFirstPersonTabletVisible);
  const requestVrToggle = useTwinStore((s) => s.requestVrToggle);
  const setVrSessionState = useTwinStore((s) => s.setVrSessionState);
  const openEntityInfo = useTwinStore((s) => s.openEntityInfo);
  const setShowNavMesh = useTwinStore((s) => s.setShowNavMesh);
  const toggleLightingMode = useTwinStore((s) => s.toggleLightingMode);
  const setAnimateFlows = useTwinStore((s) => s.setAnimateFlows);
  const setShowFlows = useTwinStore((s) => s.setShowFlows);
  const toggleFlowVisibility = useTwinStore((s) => s.toggleFlowVisibility);
  const isolateFlow = useTwinStore((s) => s.isolateFlow);
  const setActiveFlowInfoId = useTwinStore((s) => s.setActiveFlowInfoId);
  const setShowRoomPins = useTwinStore((s) => s.setShowRoomPins);
  const setShowHvacOverlay = useTwinStore((s) => s.setShowHvacOverlay);
  const setHvacAhuFilter = useTwinStore((s) => s.setHvacAhuFilter);
  const setShowFmeaIndicators = useTwinStore((s) => s.setShowFmeaIndicators);
  const updateRoomHvac = useTwinStore((s) => s.updateRoomHvac);
  const selectEntity = useTwinStore((s) => s.selectEntity);
  const setRightTab = useTwinStore((s) => s.setRightTab);
  const setRightPanelOpen = useTwinStore((s) => s.setRightPanelOpen);
  const walkInsideRoom = useTwinStore((s) => s.walkInsideRoom);

  const [vrStereoSplit, setVrStereoSplit] = useState(false);
  const vrStereoSplitRef = useRef(false);
  vrStereoSplitRef.current = vrStereoSplit;
  const xrSessionRef = useRef<any>(null);
  const vrAutoWalkRef = useRef(false);
  const openLiveCamera = useTwinStore((s) => s.openLiveCamera);
  const openRackDesigner = useTwinStore((s) => s.openRackDesigner);
  const openDataCenterPage = useTwinStore((s) => s.openDataCenterPage);
  const activeNetworkTrace = useTwinStore((s) => s.activeNetworkTrace);
  const startNetworkTrace = useTwinStore((s) => s.startNetworkTrace);
  const clearNetworkTrace = useTwinStore((s) => s.clearNetworkTrace);
  const qrHighlight = useTwinStore((s) => s.qrHighlight);
  const clearQrHighlight = useTwinStore((s) => s.clearQrHighlight);
  const voiceHighlightIds = useTwinStore((s) => s.voiceHighlightIds);
  const voiceHighlightBanner = useTwinStore((s) => s.voiceHighlightBanner);
  const clearVoiceHighlight = useTwinStore((s) => s.clearVoiceHighlight);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const wallChainAnchor = useTwinStore((s) => s.wallChainAnchor);

  const aclUsers = useAclStore((s) => s.users);
  const aclRoles = useAclStore((s) => s.roles);
  const aclGroups = useAclStore((s) => s.groups);
  const activeAclUserId = useAclStore((s) => s.activeAclUserId);
  const isReadOnly = useMemo(() => {
    if (workspaceMode === 'view') return true;
    const activeUser = getActiveAclUser({ users: aclUsers, activeAclUserId });
    if (!activeUser) return false;
    if (activeUser.status === 'suspended') return true;
    return !computeEffectivePermissions(activeUser, aclRoles, aclGroups).includes('spatial.edit');
  }, [workspaceMode, aclUsers, aclRoles, aclGroups, activeAclUserId]);

  // Real-Time Telemetry & Heatmap Store Subscriptions (readings subscribed locally in subcomponents & heatmap listener)
  const heatmapMetric = useTelemetryStore((s) => s.heatmapMetric);
  const heatmapOpacity = useTelemetryStore((s) => s.heatmapOpacity);
  const show3DSensorPins = useTelemetryStore((s) => s.show3DSensorPins);
  const sensors = useTelemetryStore((s) => s.sensors);
  const setHeatmapMetric = useTelemetryStore((s) => s.setHeatmapMetric);
  const setHeatmapOpacity = useTelemetryStore((s) => s.setHeatmapOpacity);
  const setShow3DSensorPins = useTelemetryStore((s) => s.setShow3DSensorPins);
  const openDashboard = useTelemetryStore((s) => s.openDashboard);
  const buildTelemetryTabUrl = useTelemetryStore((s) => s.buildTelemetryTabUrl);
  const activeLineHighlight = useGmpStore((s) => s.activeLineHighlight);
  const clearLineHighlight = useGmpStore((s) => s.clearLineHighlight);
  const openGmpModal = useGmpStore((s) => s.openGmpModal);
  const openResourceSchedulingModal = useGmpStore((s) => s.openResourceSchedulingModal);
  const riskIncidents = useRiskIncidentStore((s) => s.incidents);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);

  // Exclusive single-subject HUD bottom dock (only ONE subject panel open at a time)
  const [activeDockSubject, setActiveDockSubject] = useState<'xray' | 'flows' | 'hvac' | 'sensors' | 'fmea' | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const toggleDockSubject = (subject: 'xray' | 'flows' | 'hvac' | 'sensors' | 'fmea') => {
    setDockCollapsed(false);
    setActiveDockSubject((prev) => (prev === subject ? null : subject));
  };
  const [inspectedPinKey, setInspectedPinKey] = useState<string | null>(null);
  const [spotlightRoomId, setSpotlightRoomId] = useState<string | null>(null);
  const [fpState, setFpState] = useState<{ x: number; z: number; jumpHeight: number; walkablePct: number }>({
    x: 10,
    z: 8,
    jumpHeight: 0,
    walkablePct: 82,
  });

  // Virtual 360° Walk Mode Joystick state & refs
  const fpJoystickRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const fpSprintRef = useRef(false);
  const joyPadRef = useRef<HTMLDivElement | null>(null);
  const joyActivePointerRef = useRef<number | null>(null);
  const [joyKnob, setJoyKnob] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [joySprint, setJoySprint] = useState(false);
  const [walkCameraMode, setWalkCameraMode] = useState<'first-person' | 'third-person'>('first-person');
  const walkCameraModeRef = useRef<'first-person' | 'third-person'>('first-person');
  walkCameraModeRef.current = walkCameraMode;
  const [showDecompPopover, setShowDecompPopover] = useState(false);

  useEffect(() => {
    if (!firstPersonMode) {
      fpJoystickRef.current = { x: 0, y: 0 };
      fpSprintRef.current = false;
      joyActivePointerRef.current = null;
      setJoyKnob({ x: 0, y: 0 });
      setJoySprint(false);
    }
  }, [firstPersonMode]);

  // Immediately clear 3D wall draft preview when Escape or Right-Click stops wall chaining,
  // and display eligible host wall drop-zones as soon as Place Door / Place Window is activated
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    if (!wallChainAnchor && activeTool === 'draw-wall') {
      disposeObject3D(eng.placeGhostGroup);
      eng.placeGhostGroup.clear();
      eng.placeGhostGroup.visible = false;
      eng.requestRender();
      setPlaceSnapBadge(null);
      return;
    }

    if (
      (activeTool === 'place-door' || activeTool === 'place-window') &&
      workspaceMode !== 'view'
    ) {
      const st = storeRef.current;
      const activeFl = st.scene.floors.find((f) => f.id === activeFloorId);
      const flElev = activeFl?.elevation ?? 0;
      const isCampus = st.drillLevel === 'campus';
      const activeBldg = st.scene.buildings.find((b) => b.id === activeFl?.buildingId);
      const ox = isCampus && activeBldg ? activeBldg.originX : 0;
      const oz = isCampus && activeBldg ? activeBldg.originZ : 0;
      const accent = activeTool === 'place-window' ? '#38BDF8' : '#10B981';

      disposeObject3D(eng.placeGhostGroup);
      eng.placeGhostGroup.clear();
      eng.placeGhostGroup.visible = true;

      const eligibleWalls = st.scene.walls.filter(
        (w) => w.floorId === activeFloorId && Math.hypot(w.x2 - w.x1, w.z2 - w.z1) >= 0.7
      );
      eligibleWalls.forEach((w) => {
        const wLen = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
        const ang = Math.atan2(w.z2 - w.z1, w.x2 - w.x1);
        const mx = ox + (w.x1 + w.x2) / 2;
        const mz = oz + (w.z1 + w.z2) / 2;
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(wLen, 0.12, w.thickness + 0.14),
          new THREE.MeshBasicMaterial({
            color: accent,
            transparent: true,
            opacity: 0.38,
            depthWrite: false,
          })
        );
        strip.position.set(mx, flElev + w.height + 0.06, mz);
        strip.rotation.y = -ang;
        eng.placeGhostGroup.add(strip);

        const baseStrip = new THREE.Mesh(
          new THREE.BoxGeometry(wLen, 0.06, w.thickness + 0.18),
          new THREE.MeshBasicMaterial({
            color: accent,
            transparent: true,
            opacity: 0.28,
            depthWrite: false,
          })
        );
        baseStrip.position.set(mx, flElev + 0.04, mz);
        baseStrip.rotation.y = -ang;
        eng.placeGhostGroup.add(baseStrip);
      });

      setPlaceSnapBadge({
        label:
          eligibleWalls.length > 0
            ? `${activeTool === 'place-window' ? 'WINDOW' : 'DOOR'} DROP ZONES READY (${eligibleWalls.length} WALLS) — HOVER A WALL`
            : 'NO WALLS ON THIS FLOOR — DRAW A WALL OR ROOM FIRST',
        isWall: eligibleWalls.length > 0,
        isWarning: eligibleWalls.length === 0,
      });
      eng.requestRender();
      return;
    }

    if (
      activeTool !== 'place-object' &&
      activeTool !== 'draw-wall' &&
      activeTool !== 'draw-room'
    ) {
      if (eng.placeGhostGroup.visible) {
        disposeObject3D(eng.placeGhostGroup);
        eng.placeGhostGroup.clear();
        eng.placeGhostGroup.visible = false;
        eng.requestRender();
      }
      setPlaceSnapBadge(null);
    }
  }, [wallChainAnchor, activeTool, activeFloorId, workspaceMode, sceneData.walls]);

  const updateJoystickFromClient = (clientX: number, clientY: number) => {
    const pad = joyPadRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.36;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    const nx = dx / maxR;
    const ny = dy / maxR;
    fpJoystickRef.current = { x: nx, y: ny };
    setJoyKnob({ x: dx, y: dy });
    engineRef.current?.requestRender();
  };

  const handleJoyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    joyActivePointerRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateJoystickFromClient(e.clientX, e.clientY);
  };

  const handleJoyPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joyActivePointerRef.current !== e.pointerId) return;
    e.stopPropagation();
    updateJoystickFromClient(e.clientX, e.clientY);
  };

  const handleJoyPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joyActivePointerRef.current !== e.pointerId) return;
    e.stopPropagation();
    joyActivePointerRef.current = null;
    fpJoystickRef.current = { x: 0, y: 0 };
    setJoyKnob({ x: 0, y: 0 });
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const triggerWalkJump = () => {
    const eng = engineRef.current;
    if (!eng || !eng.fpOnGround) return;
    eng.fpVelY = 7.6;
    eng.fpOnGround = false;
    eng.requestRender();
  };

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (walkCameraMode === 'third-person' && eng.walkAvatar.mayaController && storeRef.current.firstPersonMode) {
      eng.walkAvatar.manualEmoteUntil = performance.now() + 2600;
      eng.walkAvatar.mayaController.setState('wave', { fade: 0.24, restart: true });
    }
    eng.requestRender();
  }, [walkCameraMode]);

  storeRef.current = useTwinStore.getState();

  const pinDomRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const roomPinDomRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const projectPinsRef = useRef<(force?: boolean) => void>(() => {});
  const viewportSizeRef = useRef<{ w: number; h: number }>({ w: 800, h: 560 });
  const lastCamProjRef = useRef<Float32Array>(new Float32Array(16));

  type WalkInteractable = {
    kind: 'door' | 'light' | 'equipment' | 'gown';
    id: string;
    code: string;
    title: string;
    actionLabel: string;
    detail: string;
    worldX: number;
    worldY: number;
    worldZ: number;
    roomId?: string;
    switchId?: string;
    switchLabel?: string;
    isOnOrOpen?: boolean;
  };

  type AnimatedDoorRig = {
    openingId: string;
    floorId: string;
    subtype: string;
    label: string;
    roomId?: string;
    worldX: number;
    worldY: number;
    worldZ: number;
    progress: number;
    swingSign: number;
    singlePivot?: THREE.Group;
    leftPivot?: THREE.Group;
    rightPivot?: THREE.Group;
    slideLeft?: THREE.Group;
    slideRight?: THREE.Group;
    slideTravel: number;
    rollCurtain?: THREE.Mesh;
    rollMaxH: number;
    closerArm?: THREE.Mesh;
    ledMat?: THREE.MeshBasicMaterial;
  };

  type RoomLightRig = {
    roomId: string;
    roomCode: string;
    roomName: string;
    floorId: string;
    switches: Array<{
      id: string;
      label: string;
      defaultOn: boolean;
      worldX: number;
      worldY: number;
      worldZ: number;
      ledMat: THREE.MeshBasicMaterial;
      rocker: THREE.Mesh;
    }>;
    fixtures: Array<{
      id: string;
      switchId: string;
      defaultOn: boolean;
      mat: THREE.MeshStandardMaterial;
      maxEmissive: number;
      isEmergency: boolean;
    }>;
    pointLight?: THREE.PointLight;
    maxLightIntensity: number;
    dimOverlayMat: THREE.MeshBasicMaterial;
    dimOverlayMesh: THREE.Mesh;
    darkEnvelopeMat: THREE.MeshBasicMaterial;
    darkEnvelopeMesh: THREE.Mesh;
  };

  const [nearbyInteractable, setNearbyInteractable] = useState<(WalkInteractable & { screenX: number; screenY: number }) | null>(null);
  const nearbyInteractableRef = useRef<WalkInteractable | null>(null);
  const [walkInspectAssetId, setWalkInspectAssetId] = useState<string | null>(null);
  const [placeSnapBadge, setPlaceSnapBadge] = useState<{ label: string; isWall: boolean; isWarning?: boolean } | null>(null);
  const [fpExpandedPad, setFpExpandedPad] = useState(false);

  // 3D HRTF Spatial Audio & Visual Path Finder State (muted by default)
  const spatialAudioRef = useRef<FacilitySpatialAudioEngine | null>(null);
  const [spatialAudioEnabled, setSpatialAudioEnabled] = useState(false);
  const spatialAudioEnabledRef = useRef(false);
  spatialAudioEnabledRef.current = spatialAudioEnabled;
  const [spatialAudioSettingsOpen, setSpatialAudioSettingsOpen] = useState(false);
  const [spatialAudioSettings, setSpatialAudioSettings] = useState<SpatialAudioSettings>(() => ({
    masterVolume: DEFAULT_SPATIAL_AUDIO_SETTINGS.masterVolume,
    machinery: { ...DEFAULT_SPATIAL_AUDIO_SETTINGS.machinery },
    ventilation: { ...DEFAULT_SPATIAL_AUDIO_SETTINGS.ventilation },
  }));
  const [audioTelemetry, setAudioTelemetry] = useState<NearbyAudioTelemetry | null>(null);

  const toggleSpatialAudio = useCallback(() => {
    const next = !spatialAudioEnabledRef.current;
    spatialAudioEnabledRef.current = next;
    setSpatialAudioEnabled(next);
    if (!spatialAudioRef.current) {
      spatialAudioRef.current = new FacilitySpatialAudioEngine();
    }
    const shouldBeActive = Boolean(storeRef.current.firstPersonMode && next);
    spatialAudioRef.current.setEnabled(shouldBeActive);
    if (!shouldBeActive) {
      setAudioTelemetry(null);
    }
  }, []);

  const [pathFinderOpen, setPathFinderOpen] = useState(false);
  const [pathAlgorithm, setPathAlgorithm] = useState<PathRoutingAlgorithm>('gmp-compliant');
  const pathAlgorithmRef = useRef<PathRoutingAlgorithm>('gmp-compliant');
  pathAlgorithmRef.current = pathAlgorithm;

  const [noGoZones, setNoGoZones] = useState<NoGoZone[]>([]);
  const noGoZonesRef = useRef<NoGoZone[]>([]);
  noGoZonesRef.current = noGoZones;

  const [placingNoGoZone, setPlacingNoGoZone] = useState(false);
  const placingNoGoZoneRef = useRef(false);
  placingNoGoZoneRef.current = placingNoGoZone;

  const [noGoRadius, setNoGoRadius] = useState(2.4);
  const noGoRadiusRef = useRef(2.4);
  noGoRadiusRef.current = noGoRadius;

  const [noGoLabelDraft, setNoGoLabelDraft] = useState('');
  const noGoLabelDraftRef = useRef('');
  noGoLabelDraftRef.current = noGoLabelDraft;

  const [pathFinderHud, setPathFinderHud] = useState<{
    label: string;
    code: string;
    remainingM: number;
    autoWalking: boolean;
    protocolSummary?: string;
    roomTrail?: string;
    statusStep?: string | null;
  } | null>(null);

  const openDoorsState = useMayaStore((s) => s.openDoors);
  const roomLightsState = useMayaStore((s) => s.roomLights);
  const switchStates = useMayaStore((s) => s.switchStates);
  const mayaIsGowned = useMayaStore((s) => s.isGowned);
  const focusedInspectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    engineRef.current?.walkAvatar.mayaController?.setGowned(mayaIsGowned);
    engineRef.current?.requestRender();
  }, [mayaIsGowned]);

  useEffect(() => {
    engineRef.current?.requestRender();
  }, [openDoorsState, roomLightsState, switchStates]);

  useEffect(() => {
    const el = focusedInspectorRef.current;
    if (!el) return;
    return attachCanvasPinchGuard(el);
  }, [inspectedPinKey]);

  const clearPathFinderRoute = useCallback(() => {
    const eng = engineRef.current;
    if (eng) {
      eng.pathFinderDest = null;
      eng.pathFinderWaypoints = [];
      eng.teleportQueue = [];
      eng.teleportTarget = null;
      eng.autoNavCheckpoints = [];
      eng.autoNavPendingDoorId = null;
      eng.autoNavPauseUntil = 0;
      eng.autoNavStatus = null;
      eng.teleportRing.visible = false;
      eng.pathFinderGroup.visible = false;
      disposeObject3D(eng.pathFinderGroup);
      eng.pathFinderGroup.clear();
      eng.pathFinderRig = null;
      eng.requestRender();
    }
    setPathFinderHud(null);
  }, []);

  const setPathFinderRoute = useCallback(
    (
      dest: { label: string; code: string; x: number; z: number; roomId?: string },
      autoWalk: boolean
    ) => {
      const eng = engineRef.current;
      if (!eng) return;
      const st = storeRef.current;
      const fl = st.scene.floors.find((f) => f.id === st.activeFloorId);
      const flElev = fl?.elevation ?? 0;
      const floorRooms = st.scene.rooms.filter((r) => r.floorId === st.activeFloorId);
      const algo = pathAlgorithmRef.current;
      const zones = noGoZonesRef.current;

      const plan = planGmpRoute(
        eng.navMesh,
        eng.fpPosX,
        eng.fpPosZ,
        dest.x,
        dest.z,
        floorRooms,
        {
          algorithm: algo,
          noGoZones: zones,
          rooms: floorRooms,
          isGowned: useMayaStore.getState().isGowned,
        }
      );

      const pts = plan.points;
      const finalPt = pts[pts.length - 1] ?? { x: dest.x, z: dest.z };
      const destRoomMatch =
        (dest.roomId ? floorRooms.find((r) => r.id === dest.roomId) : undefined) ??
        floorRooms.find(
          (r) =>
            finalPt.x >= r.x &&
            finalPt.x <= r.x + r.width &&
            finalPt.z >= r.z &&
            finalPt.z <= r.z + r.depth
        );

      eng.pathFinderDest = {
        label: dest.label,
        code: dest.code,
        x: finalPt.x,
        z: finalPt.z,
        roomId: destRoomMatch?.id,
      };
      eng.pathFinderWaypoints = pts;
      eng.autoNavCheckpoints = autoWalk ? [...plan.checkpoints] : [];
      eng.autoNavPendingDoorId = null;
      eng.autoNavPauseUntil = 0;
      eng.autoNavStatus = autoWalk
        ? plan.passesThroughPal
          ? 'Routing via PAL gowning & clean corridor...'
          : 'Walking along GMP path (auto-opening doors)...'
        : null;

      eng.pathFinderRig = populatePathFinderVisual(
        eng.pathFinderGroup,
        pts,
        flElev,
        disposeObject3D,
        algo,
        plan.checkpoints
      );
      eng.lastPathRerouteAt = performance.now();

      if (autoWalk) {
        eng.teleportQueue = pts.slice(1);
        eng.teleportTarget = eng.teleportQueue.shift() ?? { x: finalPt.x, z: finalPt.z };
        eng.teleportRing.visible = true;
        eng.teleportRing.position.set(finalPt.x, flElev + 0.055, finalPt.z);
        if (spatialAudioEnabledRef.current && spatialAudioRef.current) {
          spatialAudioRef.current.setEnabled(true);
        }
      } else {
        eng.teleportQueue = [];
        eng.teleportTarget = null;
        eng.teleportRing.visible = false;
      }

      const distM = Number(computePathLengthMeters(pts).toFixed(1));
      const roomTrail =
        plan.roomSequence.length > 1
          ? plan.roomSequence.map((r) => r.code).join(' → ')
          : undefined;
      setPathFinderHud({
        label: dest.label,
        code: dest.code,
        remainingM: distM,
        autoWalking: autoWalk,
        protocolSummary: plan.gmpProtocolSummary,
        roomTrail,
        statusStep: eng.autoNavStatus,
      });
      setPathFinderOpen(false);
      st.showToast(
        autoWalk
          ? `${plan.gmpProtocolSummary}: walking to ${dest.code} (${distM}m)`
          : `${plan.gmpProtocolSummary}: route highlighted to ${dest.code} (${distM}m)`,
        'info'
      );
      eng.requestRender();
    },
    []
  );

  // Sync user-configured Spatial Audio rolloff distances & falloff curves into Web Audio engine
  useEffect(() => {
    if (!spatialAudioRef.current) {
      spatialAudioRef.current = new FacilitySpatialAudioEngine();
    }
    spatialAudioRef.current.updateSettings(spatialAudioSettings);
  }, [spatialAudioSettings]);

  // Sync 3D No-Go Exclusion Zones & live-recalculate any active Path Finder route when config changes
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const fl = sceneData.floors.find((f) => f.id === activeFloorId);
    const flElev = fl?.elevation ?? 0;
    const floorRooms = sceneData.rooms.filter((r) => r.floorId === activeFloorId);
    const floorZones = noGoZones.filter((z) => z.floorId === activeFloorId);
    populateNoGoZonesVisual(eng.noGoZonesGroup, floorZones, flElev, disposeObject3D);

    if (eng.pathFinderDest && eng.pathFinderGroup.visible) {
      const dest = eng.pathFinderDest;
      const plan = planGmpRoute(
        eng.navMesh,
        eng.fpPosX,
        eng.fpPosZ,
        dest.x,
        dest.z,
        floorRooms,
        {
          algorithm: pathAlgorithm,
          noGoZones,
          rooms: floorRooms,
          isGowned: useMayaStore.getState().isGowned,
        }
      );
      const pts = plan.points;
      eng.pathFinderWaypoints = pts;
      eng.pathFinderRig = populatePathFinderVisual(
        eng.pathFinderGroup,
        pts,
        flElev,
        disposeObject3D,
        pathAlgorithm,
        plan.checkpoints
      );
      if (eng.teleportTarget) {
        eng.autoNavCheckpoints = [...plan.checkpoints];
        eng.teleportQueue = pts.slice(1);
        eng.teleportTarget = eng.teleportQueue.shift() ?? null;
      }
      const distM = Number(computePathLengthMeters(pts).toFixed(1));
      const roomTrail =
        plan.roomSequence.length > 1
          ? plan.roomSequence.map((r) => r.code).join(' → ')
          : undefined;
      setPathFinderHud((prev) =>
        prev
          ? {
              ...prev,
              remainingM: distM,
              protocolSummary: plan.gmpProtocolSummary,
              roomTrail,
            }
          : null
      );
    }
    eng.requestRender();
  }, [noGoZones, pathAlgorithm, activeFloorId, sceneData.floors, sceneData.rooms]);

  // Manage 3D Spatial Audio activation with first-person walkthrough mode
  useEffect(() => {
    if (!spatialAudioRef.current) {
      spatialAudioRef.current = new FacilitySpatialAudioEngine();
    }
    const active = Boolean(firstPersonMode && spatialAudioEnabled);
    spatialAudioRef.current.setEnabled(active);
    if (!active) {
      setAudioTelemetry(null);
    }
    if (!firstPersonMode) {
      setPathFinderOpen(false);
      setSpatialAudioSettingsOpen(false);
      setPlacingNoGoZone(false);
      clearPathFinderRoute();
    }
  }, [firstPersonMode, spatialAudioEnabled, clearPathFinderRoute]);

  // Dispose Web Audio graph cleanly on unmount
  useEffect(() => {
    return () => {
      spatialAudioRef.current?.dispose();
      spatialAudioRef.current = null;
    };
  }, []);

  const executeInteractable = useCallback((item: WalkInteractable) => {
    const maya = useMayaStore.getState();
    const eng = engineRef.current;
    if (item.kind === 'door') {
      const opened = maya.toggleDoor(item.id, item.title, item.roomId ?? null);
      if (spatialAudioEnabledRef.current) {
        spatialAudioRef.current?.playDoorCue(opened);
      }
      if (eng?.walkAvatar.mayaController) {
        eng.walkAvatar.manualEmoteUntil = performance.now() + 1800;
        eng.walkAvatar.mayaController.setState('working', { expression: 'approval', fade: 0.2, restart: true });
      }
      storeRef.current.showToast(`${opened ? 'Opened' : 'Closed'} ${item.title}`, 'info');
      eng?.requestRender();
    } else if (item.kind === 'light') {
      const targetRoomId = item.roomId || item.id;
      const isOn = maya.toggleRoomLight(
        targetRoomId,
        item.code,
        item.title,
        item.switchId,
        item.switchLabel
      );
      if (spatialAudioEnabledRef.current) {
        spatialAudioRef.current?.playSwitchCue(isOn);
      }
      if (eng?.walkAvatar.mayaController) {
        eng.walkAvatar.manualEmoteUntil = performance.now() + 1600;
        eng.walkAvatar.mayaController.setState('approval', { expression: isOn ? 'happy' : 'neutral', fade: 0.2, restart: true });
      }
      const swName = item.switchLabel ? `${item.code} · ${item.switchLabel}` : `${item.code} lighting`;
      storeRef.current.showToast(`${swName} turned ${isOn ? 'ON (Day)' : 'OFF (Night)'}`, 'info');
      eng?.requestRender();
    } else if (item.kind === 'equipment') {
      setWalkInspectAssetId(item.id);
      const ast = storeRef.current.scene.assets.find((a) => a.id === item.id);
      if (ast) {
        maya.setMood('analyze', 'curious', `Inspecting ${ast.assetId} · ${ast.name}`, 6000);
        maya.logInteraction({
          kind: 'equipment',
          targetId: ast.id,
          targetCode: ast.assetId,
          targetName: ast.name,
          summary: `Inspected ${ast.assetId} (${ast.name}) & opened SOP quick card`,
          mayaState: 'analyze',
          roomId: ast.roomId ?? null,
        });
      }
      if (eng?.walkAvatar.mayaController) {
        eng.walkAvatar.manualEmoteUntil = performance.now() + 3400;
        eng.walkAvatar.mayaController.setState('analyze', { expression: 'curious', fade: 0.25, restart: true });
      }
      eng?.requestRender();
    } else if (item.kind === 'gown') {
      const nextGowned = !maya.isGowned;
      maya.setGowned(nextGowned, item.title, item.roomId ?? null);
      if (eng?.walkAvatar.mayaController) {
        eng.walkAvatar.mayaController.setGowned(nextGowned);
        eng.walkAvatar.manualEmoteUntil = performance.now() + 2200;
        eng.walkAvatar.mayaController.setState(nextGowned ? 'celebrate' : 'approval', {
          expression: 'happy',
          fade: 0.22,
          restart: true,
        });
      }
      storeRef.current.showToast(
        nextGowned
          ? 'MAYA changed into Full Sterile Cleanroom Gown (Grade A/B)'
          : 'MAYA de-gowned back to Standard Facility Uniform',
        'success'
      );
      eng?.requestRender();
    }
  }, []);

  const saveCurrentWalkPose = useCallback(() => {
    const eng = engineRef.current;
    const st = storeRef.current;
    if (!eng || !st.firstPersonMode) return;
    const curRoom = st.scene.rooms.find(
      (r) =>
        r.floorId === st.activeFloorId &&
        eng.fpPosX >= r.x &&
        eng.fpPosX <= r.x + r.width &&
        eng.fpPosZ >= r.z &&
        eng.fpPosZ <= r.z + r.depth
    );
    useMayaStore.getState().saveWalkPose({
      floorId: st.activeFloorId,
      x: Number(eng.fpPosX.toFixed(2)),
      z: Number(eng.fpPosZ.toFixed(2)),
      yaw: eng.fpYaw,
      camYaw: eng.fpCamYaw,
      pitch: eng.fpPitch,
      cameraMode: walkCameraModeRef.current,
      roomId: curRoom?.id ?? null,
      roomCode: curRoom?.code ?? null,
      roomName: curRoom?.name ?? null,
    });
  }, []);

  const executeInteractableRef = useRef(executeInteractable);
  executeInteractableRef.current = executeInteractable;

  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    hemi: THREE.HemisphereLight;
    keyLight: THREE.DirectionalLight;
    rimLight: THREE.DirectionalLight;
    nightLightsGroup: THREE.Group;
    navMeshGroup: THREE.Group;
    navMesh: FloorNavMesh | null;
    flowsGroup: THREE.Group;
    hvacGroup: THREE.Group;
    traceGroup: THREE.Group;
    placeGhostGroup: THREE.Group;
    pathFinderGroup: THREE.Group;
    noGoZonesGroup: THREE.Group;
    pathFinderRig: PathFinderVisualRig | null;
    pathFinderDest: { label: string; code: string; x: number; z: number; roomId?: string } | null;
    pathFinderWaypoints: Array<{ x: number; z: number }>;
    teleportQueue: Array<{ x: number; z: number }>;
    autoNavCheckpoints: GmpRouteCheckpoint[];
    autoNavPendingDoorId: string | null;
    autoNavPauseUntil: number;
    autoNavStatus: string | null;
    autoOpenedDoors: Array<{
      id: string;
      label: string;
      roomId: string | null;
      x: number;
      z: number;
      subtype: string;
      openedAt: number;
    }>;
    lastPathRerouteAt: number;
    teleportRing: THREE.Mesh;
    teleportTarget: { x: number; z: number } | null;
    animatedDoors: Map<string, AnimatedDoorRig>;
    roomLightRigs: Map<string, RoomLightRig>;
    flowPulseInstancedMesh: THREE.InstancedMesh | null;
    flowPulseTracks: FlowPulseTrack[];
    tracePulseInstancedMesh: THREE.InstancedMesh | null;
    tracePulseTracks: FlowPulseTrack[];
    lastPulseTick: number;
    fpVelX: number;
    fpVelZ: number;
    fpVelY: number;
    autoWalkSpeed: number;
    camSmoothX: number;
    camSmoothY: number;
    camSmoothZ: number;
    camSmoothReady: boolean;
    fpOnGround: boolean;
    fpYaw: number;
    fpCamYaw: number;
    fpPitch: number;
    fpPosX: number;
    fpPosZ: number;
    fpJumpY: number;
    fpAnimPhase: number;
    fpMoveBlend: number;
    walkAvatar: WalkAvatarRig;
    fpLookDragging: boolean;
    fpLookLastX: number;
    fpLookLastY: number;
    vrRig: THREE.Group;
    lastFpUiSync: number;
    perspCamera: THREE.PerspectiveCamera;
    orthoCamera: THREE.OrthographicCamera;
    activeCamera: THREE.Camera;
    orbit: OrbitControls;
    transform: TransformControls;
    contentGroup: THREE.Group;
    heatmapGroup: THREE.Group;
    heatmapCache: Map<
      string,
      { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh }
    >;
    gridHelper: THREE.Group;
    assetGroupMap: Map<string, THREE.Object3D>;
    clippingPlane: THREE.Plane;
    camTargetPos: THREE.Vector3 | null;
    camTargetLook: THREE.Vector3 | null;
    requestRender: () => void;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    keys: Set<string>;
    dispose: () => void;
  } | null>(null);

  // Initialize Three.js renderer, matte-charcoal studio RoomEnvironment, lights, and controls ONCE
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 560;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Calibrated exposure so cleanroom white/epoxy surfaces have crisp contrast instead of washing out
    renderer.toneMappingExposure = 0.88;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    renderer.xr.enabled = true;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color('#0A0A0D');
    threeScene.fog = new THREE.Fog('#0A0A0D', 85, 240);

    // Calibrated Studio PBR reflections (prevents blown-out whites)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    threeScene.environment = envTex;
    (threeScene as any).environmentIntensity = 0.44;
    pmrem.dispose();

    // Balanced Architectural 3-Point Lighting Rig
    const hemi = new THREE.HemisphereLight('#DCE7F5', '#1F1F26', 0.42);
    threeScene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#FFF6E8', 0.92);
    keyLight.position.set(36, 48, 30);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -65;
    keyLight.shadow.camera.right = 65;
    keyLight.shadow.camera.top = 65;
    keyLight.shadow.camera.bottom = -65;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 160;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    threeScene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#93C5FD', 0.28);
    rimLight.position.set(-34, 26, -28);
    threeScene.add(rimLight);

    const nightLightsGroup = new THREE.Group();
    threeScene.add(nightLightsGroup);

    const perspCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 450);
    perspCamera.position.set(18, 23, 35);

    const aspect = width / height;
    const frustum = 32;
    const orthoCamera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      -150,
      450
    );
    orthoCamera.position.set(38, 34, 38);

    const orbit = new OrbitControls(perspCamera, renderer.domElement);
    orbit.target.set(18, 1.2, 11);
    orbit.enableDamping = !isSoftwareGl;
    orbit.dampingFactor = 0.08;
    orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    orbit.minDistance = 0.6;
    orbit.maxDistance = 190;
    orbit.update();

    const transform = new TransformControls(perspCamera, renderer.domElement);
    transform.setSize(0.75);
    threeScene.add(transform.getHelper());

    const contentGroup = new THREE.Group();
    threeScene.add(contentGroup);

    const flowsGroup = new THREE.Group();
    threeScene.add(flowsGroup);

    const hvacGroup = new THREE.Group();
    threeScene.add(hvacGroup);

    const traceGroup = new THREE.Group();
    threeScene.add(traceGroup);

    const placeGhostGroup = new THREE.Group();
    placeGhostGroup.visible = false;
    threeScene.add(placeGhostGroup);

    const pathFinderGroup = new THREE.Group();
    pathFinderGroup.visible = false;
    threeScene.add(pathFinderGroup);

    const noGoZonesGroup = new THREE.Group();
    noGoZonesGroup.visible = false;
    threeScene.add(noGoZonesGroup);

    // Glowing floor target ring for Point-and-Click Teleportation in Walk Mode
    const teleportRing = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.44, 32),
      new THREE.MeshBasicMaterial({
        color: '#22D3EE',
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    teleportRing.rotation.x = -Math.PI / 2;
    teleportRing.visible = false;
    threeScene.add(teleportRing);

    const animatedDoors = new Map<string, AnimatedDoorRig>();
    const roomLightRigs = new Map<string, RoomLightRig>();

    const vrRig = new THREE.Group();
    threeScene.add(vrRig);

    const walkAvatar = buildWalkAvatar(() => {
      engineRef.current?.requestRender();
    });
    threeScene.add(walkAvatar.root);

    const navMeshGroup = new THREE.Group();
    threeScene.add(navMeshGroup);

    const heatmapGroup = new THREE.Group();
    threeScene.add(heatmapGroup);
    const heatmapCache = new Map<
      string,
      { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh }
    >();

    const gridHelper = new THREE.Group();
    threeScene.add(gridHelper);

    viewportSizeRef.current = { w: width, h: height };

    const clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
    const assetGroupMap = new Map<string, THREE.Object3D>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const keys = new Set<string>();

    // Coalesced on-demand renderer with software-WebGL fence pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;
    let lastTickTime = performance.now();

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 75);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastTickTime) / 1000);
        lastTickTime = now;

        const eng = engineRef.current;
        let needsAnother = false;

        if (eng) {
          if (eng.camTargetPos && eng.camTargetLook && eng.activeCamera === eng.perspCamera) {
            const k = 6.5;
            eng.perspCamera.position.x = THREE.MathUtils.damp(eng.perspCamera.position.x, eng.camTargetPos.x, k, dt);
            eng.perspCamera.position.y = THREE.MathUtils.damp(eng.perspCamera.position.y, eng.camTargetPos.y, k, dt);
            eng.perspCamera.position.z = THREE.MathUtils.damp(eng.perspCamera.position.z, eng.camTargetPos.z, k, dt);
            eng.orbit.target.x = THREE.MathUtils.damp(eng.orbit.target.x, eng.camTargetLook.x, k, dt);
            eng.orbit.target.y = THREE.MathUtils.damp(eng.orbit.target.y, eng.camTargetLook.y, k, dt);
            eng.orbit.target.z = THREE.MathUtils.damp(eng.orbit.target.z, eng.camTargetLook.z, k, dt);
            if (
              eng.perspCamera.position.distanceTo(eng.camTargetPos) < 0.08 &&
              eng.orbit.target.distanceTo(eng.camTargetLook) < 0.08
            ) {
              eng.perspCamera.position.copy(eng.camTargetPos);
              eng.orbit.target.copy(eng.camTargetLook);
              eng.camTargetPos = null;
              eng.camTargetLook = null;
            } else {
              needsAnother = true;
            }
          }

          // Animate realistic doors by type + sync dynamic room lighting every frame
          const mayaSnapshot = useMayaStore.getState();
          const sceneOpeningsById = new Map(
            storeRef.current.scene.openings.map((op) => [op.id, op] as const)
          );
          eng.animatedDoors.forEach((rig) => {
            const opRecord = sceneOpeningsById.get(rig.openingId);
            const isDoorOpen = mayaSnapshot.openDoors[rig.openingId] ?? opRecord?.status === 'open';
            const targetOpen = isDoorOpen ? 1 : 0;
            if (Math.abs(rig.progress - targetOpen) > 0.002) {
              rig.progress = THREE.MathUtils.damp(rig.progress, targetOpen, 7.5, dt);
              if (Math.abs(rig.progress - targetOpen) <= 0.004) rig.progress = targetOpen;
              needsAnother = true;
            }
            const p = rig.progress;
            if (rig.singlePivot) {
              rig.singlePivot.rotation.y = rig.swingSign * p * (Math.PI * 0.48);
              if (rig.closerArm) {
                rig.closerArm.rotation.y = rig.swingSign * p * (Math.PI * 0.36);
              }
            } else if (rig.leftPivot && rig.rightPivot) {
              rig.leftPivot.rotation.y = -p * (Math.PI * 0.46);
              rig.rightPivot.rotation.y = p * (Math.PI * 0.46);
            } else if (rig.slideLeft && rig.slideRight) {
              rig.slideLeft.position.x = -p * rig.slideTravel;
              rig.slideRight.position.x = p * rig.slideTravel;
            } else if (rig.rollCurtain) {
              const sY = Math.max(0.06, 1 - p * 0.92);
              rig.rollCurtain.scale.y = sY;
              rig.rollCurtain.position.y = rig.rollMaxH - (rig.rollMaxH * sY) / 2;
            }
            if (rig.ledMat) {
              rig.ledMat.color.set(p > 0.35 ? '#22D3EE' : '#10B981');
            }
          });

          eng.roomLightRigs.forEach((lr) => {
            const switchMap = new Map<string, boolean>();
            for (const sw of lr.switches) {
              const on = mayaSnapshot.isSwitchOn(sw.id, lr.roomId, sw.defaultOn);
              switchMap.set(sw.id, on);
              sw.ledMat.color.set(on ? '#34D399' : '#F59E0B');
              sw.rocker.rotation.x = on ? -0.22 : 0.22;
            }

            let primaryTotal = 0;
            let primaryOn = 0;
            for (const fx of lr.fixtures) {
              const swOn = switchMap.has(fx.switchId)
                ? Boolean(switchMap.get(fx.switchId))
                : mayaSnapshot.isSwitchOn(fx.switchId, lr.roomId, fx.defaultOn);
              if (!fx.isEmergency) {
                primaryTotal++;
                if (swOn) primaryOn++;
              }
              const targetEmissive = swOn ? fx.maxEmissive : 0.03;
              if (Math.abs(fx.mat.emissiveIntensity - targetEmissive) > 0.015) {
                fx.mat.emissiveIntensity = THREE.MathUtils.damp(
                  fx.mat.emissiveIntensity,
                  targetEmissive,
                  9,
                  dt
                );
                needsAnother = true;
              }
            }

            const litRatio =
              primaryTotal > 0
                ? primaryOn / primaryTotal
                : mayaSnapshot.roomLights[lr.roomId] ?? true
                  ? 1
                  : 0;

            if (lr.pointLight) {
              const targetInt = lr.maxLightIntensity * litRatio;
              if (Math.abs(lr.pointLight.intensity - targetInt) > 0.02) {
                lr.pointLight.intensity = THREE.MathUtils.damp(lr.pointLight.intensity, targetInt, 8, dt);
                needsAnother = true;
              }
            }

            const targetFloorDim = (1 - litRatio) * 0.62;
            if (Math.abs(lr.dimOverlayMat.opacity - targetFloorDim) > 0.008) {
              lr.dimOverlayMat.opacity = THREE.MathUtils.damp(lr.dimOverlayMat.opacity, targetFloorDim, 8, dt);
              lr.dimOverlayMesh.visible = lr.dimOverlayMat.opacity > 0.01;
              needsAnother = true;
            }

            const targetEnvelopeDark = (1 - litRatio) * 0.72;
            if (Math.abs(lr.darkEnvelopeMat.opacity - targetEnvelopeDark) > 0.008) {
              lr.darkEnvelopeMat.opacity = THREE.MathUtils.damp(
                lr.darkEnvelopeMat.opacity,
                targetEnvelopeDark,
                8,
                dt
              );
              lr.darkEnvelopeMesh.visible = lr.darkEnvelopeMat.opacity > 0.01;
              needsAnother = true;
            }
          });

          // First-Person & Third-Person Character Walkthrough: Grounded Physics, Teleport, GTA Camera & Maya Avatar
          if (storeRef.current.firstPersonMode) {
            const activeFl = storeRef.current.scene.floors.find(
              (f) => f.id === storeRef.current.activeFloorId
            );
            const floorElev = activeFl?.elevation ?? 0;
            const joy = fpJoystickRef.current;
            const joyMag = Math.hypot(joy.x, joy.y);
            const hasJoy = joyMag > 0.05;
            const sprinting =
              eng.keys.has('ShiftLeft') || eng.keys.has('ShiftRight') || fpSprintRef.current;
            const isThirdPerson =
              walkCameraModeRef.current === 'third-person' && !eng.renderer.xr.isPresenting;

            let movedThisFrame = false;
            let manualWalkActive = false;

            const keyFwd =
              (eng.keys.has('KeyW') || eng.keys.has('ArrowUp') ? 1 : 0) -
              (eng.keys.has('KeyS') || eng.keys.has('ArrowDown') ? 1 : 0);
            const keyRight =
              (eng.keys.has('KeyD') || eng.keys.has('ArrowRight') ? 1 : 0) -
              (eng.keys.has('KeyA') || eng.keys.has('ArrowLeft') ? 1 : 0);

            const fwdAmt = keyFwd + (hasJoy ? -joy.y : 0);
            const rightAmt = keyRight + (hasJoy ? joy.x : 0);
            const inputLen = Math.hypot(fwdAmt, rightAmt);

            const flId = storeRef.current.activeFloorId;
            const flWalls = storeRef.current.scene.walls.filter((w) => w.floorId === flId);
            const flOpenings = storeRef.current.scene.openings.filter((o) => o.floorId === flId);
            const flAssets = storeRef.current.scene.assets.filter(
              (a) => a.floorId === flId && !a.hidden
            );
            const floorW = activeFl?.width ?? 0;
            const floorD = activeFl?.depth ?? 0;
            const openDoorsMap = mayaSnapshot.openDoors;
            const MAYA_RADIUS = 0.28;

            // GMP Pressure Cascade Integrity: auto-close cleanroom/airlock/fire doors behind MAYA
            // once she has walked cleanly past them (> 2.25m away and > 900ms after opening)
            if (eng.autoOpenedDoors.length > 0) {
              for (let di = eng.autoOpenedDoors.length - 1; di >= 0; di--) {
                const openedDoor = eng.autoOpenedDoors[di];
                if (openedDoor.id === eng.autoNavPendingDoorId) continue;
                const clearDist = Math.hypot(
                  eng.fpPosX - openedDoor.x,
                  eng.fpPosZ - openedDoor.z
                );
                if (clearDist > 2.25 && now - openedDoor.openedAt > 900) {
                  if (useMayaStore.getState().openDoors[openedDoor.id]) {
                    useMayaStore
                      .getState()
                      .toggleDoor(openedDoor.id, openedDoor.label, openedDoor.roomId);
                    if (spatialAudioEnabledRef.current) {
                      spatialAudioRef.current?.playDoorCue(false);
                    }
                  }
                  eng.autoOpenedDoors.splice(di, 1);
                  needsAnother = true;
                }
              }
            }

            // Smooth velocity-damped manual walking (supports smooth acceleration + inertia coasting)
            const hasManualInput = inputLen > 0.02;
            const hasResidualVel = !eng.teleportTarget && Math.hypot(eng.fpVelX, eng.fpVelZ) > 0.08;

            if (hasManualInput || hasResidualVel) {
              if (hasManualInput) {
                manualWalkActive = true;
                eng.teleportTarget = null;
                eng.teleportQueue = [];
                eng.autoNavPendingDoorId = null;
                eng.autoNavPauseUntil = 0;
                eng.autoNavStatus = null;
                eng.autoWalkSpeed = 0;
                eng.teleportRing.visible = false;

                const maxSpeed = sprinting ? 7.4 : 4.4;
                const moveYaw = isThirdPerson ? eng.fpCamYaw : eng.fpYaw;
                const fwdX = -Math.sin(moveYaw);
                const fwdZ = -Math.cos(moveYaw);
                const rgtX = Math.cos(moveYaw);
                const rgtZ = -Math.sin(moveYaw);

                const throttle = Math.min(1, inputLen);
                const targetVx = ((fwdX * fwdAmt + rgtX * rightAmt) / inputLen) * maxSpeed * throttle;
                const targetVz = ((fwdZ * fwdAmt + rgtZ * rightAmt) / inputLen) * maxSpeed * throttle;
                eng.fpVelX = THREE.MathUtils.damp(eng.fpVelX, targetVx, 13, dt);
                eng.fpVelZ = THREE.MathUtils.damp(eng.fpVelZ, targetVz, 13, dt);
              } else {
                // Smooth deceleration glide to stop
                eng.fpVelX = THREE.MathUtils.damp(eng.fpVelX, 0, 16, dt);
                eng.fpVelZ = THREE.MathUtils.damp(eng.fpVelZ, 0, 16, dt);
                if (Math.hypot(eng.fpVelX, eng.fpVelZ) < 0.06) {
                  eng.fpVelX = 0;
                  eng.fpVelZ = 0;
                }
              }

              const moveX = eng.fpVelX * dt;
              const moveZ = eng.fpVelZ * dt;
              const totalDist = Math.hypot(moveX, moveZ);

              // Rotate MAYA smoothly toward movement direction + smooth follow-behind camera alignment
              if (totalDist > 0.001) {
                if (isThirdPerson) {
                  const desiredCharYaw = Math.atan2(-moveX, -moveZ);
                  let diffChar = desiredCharYaw - eng.fpYaw;
                  while (diffChar > Math.PI) diffChar -= Math.PI * 2;
                  while (diffChar < -Math.PI) diffChar += Math.PI * 2;
                  eng.fpYaw += diffChar * Math.min(1, dt * 10);

                  if (!eng.fpLookDragging && hasManualInput) {
                    let diffCam = eng.fpYaw - eng.fpCamYaw;
                    while (diffCam > Math.PI) diffCam -= Math.PI * 2;
                    while (diffCam < -Math.PI) diffCam += Math.PI * 2;
                    eng.fpCamYaw += diffCam * Math.min(1, dt * 3.8);
                  }
                } else {
                  eng.fpCamYaw = eng.fpYaw;
                }

                // Sub-step every <= 0.075m with strict closed-door, wall & equipment collision
                const subSteps = Math.max(1, Math.ceil(totalDist / 0.075));
                const stepDx = moveX / subSteps;
                const stepDz = moveZ / subSteps;

                let stepX = eng.fpPosX;
                let stepZ = eng.fpPosZ;

                for (let s = 0; s < subSteps; s++) {
                  const wantX = stepX + stepDx;
                  const wantZ = stepZ + stepDz;

                  // Strict wall & closed-door collision FIRST
                  const wallRes = resolveStrictWallCollision(
                    stepX,
                    stepZ,
                    wantX,
                    wantZ,
                    MAYA_RADIUS,
                    flWalls,
                    flOpenings,
                    floorW,
                    floorD,
                    openDoorsMap
                  );

                  // Strict equipment/furniture collision SECOND, then re-verify walls
                  const assetRes = resolveAssetCollisions(
                    wallRes.x,
                    wallRes.z,
                    MAYA_RADIUS,
                    flAssets,
                    flWalls,
                    flOpenings,
                    openDoorsMap
                  );
                  const strict = resolveStrictWallCollision(
                    stepX,
                    stepZ,
                    assetRes.x,
                    assetRes.z,
                    MAYA_RADIUS,
                    flWalls,
                    flOpenings,
                    floorW,
                    floorD,
                    openDoorsMap
                  );

                  if (Math.hypot(strict.x - stepX, strict.z - stepZ) < 0.0005) {
                    // Kill velocity component pushing into wall/closed door so zero jitter occurs
                    eng.fpVelX *= 0.45;
                    eng.fpVelZ *= 0.45;
                    break;
                  }
                  stepX = strict.x;
                  stepZ = strict.z;
                }

                if (Math.hypot(stepX - eng.fpPosX, stepZ - eng.fpPosZ) > 0.0008) {
                  movedThisFrame = true;
                }
                eng.fpPosX = stepX;
                eng.fpPosZ = stepZ;
              }
              needsAnother = true;
            } else if (eng.teleportTarget) {
              // Autonomous GMP Waypoint Navigation (auto-opens doors/airlocks, stages via PAL gowning, closes cleanroom doors behind)
              const triggerAutoDoorOpen = (doorHit: {
                opening: Opening;
                wall: Wall;
                cx: number;
                cz: number;
              }) => {
                const op = doorHit.opening;
                const maya = useMayaStore.getState();
                const isInterlock =
                  op.subtype === 'airlock-door' || op.accessControl === 'interlock';
                // GMP Airlock Cascade: close any previously auto-opened door before opening an interlocked door
                if (isInterlock && eng.autoOpenedDoors.length > 0) {
                  for (let k = eng.autoOpenedDoors.length - 1; k >= 0; k--) {
                    const prevDoor = eng.autoOpenedDoors[k];
                    if (prevDoor.id !== op.id && maya.openDoors[prevDoor.id]) {
                      maya.toggleDoor(prevDoor.id, prevDoor.label, prevDoor.roomId);
                      if (spatialAudioEnabledRef.current) {
                        spatialAudioRef.current?.playDoorCue(false);
                      }
                    }
                    eng.autoOpenedDoors.splice(k, 1);
                  }
                }

                const doorLabel = op.name || 'Facility Door';
                const waitMs = isInterlock
                  ? 720
                  : op.accessControl === 'biometric'
                    ? 660
                    : op.accessControl === 'badge'
                      ? 500
                      : 400;
                const stepMsg = isInterlock
                  ? `Interlock cascade · Opening ${doorLabel}`
                  : op.accessControl === 'biometric'
                    ? `Biometric scan · Opening ${doorLabel}`
                    : op.accessControl === 'badge'
                      ? `Badge access · Opening ${doorLabel}`
                      : `Opening ${doorLabel}`;

                if (!(maya.openDoors[op.id] ?? op.status === 'open')) {
                  maya.toggleDoor(op.id, doorLabel, doorHit.wall.roomId ?? null);
                  if (spatialAudioEnabledRef.current) {
                    spatialAudioRef.current?.playDoorCue(true);
                  }
                }

                if (!eng.autoOpenedDoors.some((d) => d.id === op.id)) {
                  eng.autoOpenedDoors.push({
                    id: op.id,
                    label: doorLabel,
                    roomId: doorHit.wall.roomId ?? null,
                    x: doorHit.cx,
                    z: doorHit.cz,
                    subtype: op.subtype,
                    openedAt: now,
                  });
                }

                eng.autoNavPendingDoorId = op.id;
                eng.autoNavPauseUntil = now + waitMs;
                eng.autoNavStatus = stepMsg;
                if (eng.walkAvatar.mayaController) {
                  eng.walkAvatar.manualEmoteUntil = now + waitMs + 350;
                  eng.walkAvatar.mayaController.setState('working', {
                    expression: 'approval',
                    fade: 0.2,
                    restart: true,
                  });
                }
                setPathFinderHud((prev) => (prev ? { ...prev, statusStep: stepMsg } : null));
              };

              let autoPaused = false;

              // 1. Wait for a door that MAYA just triggered to finish swinging/sliding clear
              if (eng.autoNavPendingDoorId) {
                const rig = eng.animatedDoors.get(eng.autoNavPendingDoorId);
                if (rig) {
                  const faceYaw = Math.atan2(-(rig.worldX - eng.fpPosX), -(rig.worldZ - eng.fpPosZ));
                  let dy = faceYaw - eng.fpYaw;
                  while (dy > Math.PI) dy -= Math.PI * 2;
                  while (dy < -Math.PI) dy += Math.PI * 2;
                  eng.fpYaw += dy * Math.min(1, dt * 10);
                }
                const doorReady = !rig || rig.progress >= 0.72;
                if (now < eng.autoNavPauseUntil || !doorReady) {
                  eng.autoWalkSpeed = THREE.MathUtils.damp(eng.autoWalkSpeed, 0, 12, dt);
                  autoPaused = true;
                  needsAnother = true;
                } else {
                  eng.autoNavPendingDoorId = null;
                  eng.autoNavStatus = 'Walking along GMP path...';
                  setPathFinderHud((prev) =>
                    prev ? { ...prev, statusStep: eng.autoNavStatus } : null
                  );
                }
              } else if (now < eng.autoNavPauseUntil) {
                // 2. Waiting at GMP PAL Gowning / De-Gowning protocol checkpoint
                eng.autoWalkSpeed = THREE.MathUtils.damp(eng.autoWalkSpeed, 0, 12, dt);
                autoPaused = true;
                needsAnother = true;
              }

              // 3. Trigger PAL Gowning / De-Gowning checkpoint when MAYA reaches it
              if (!autoPaused && eng.autoNavCheckpoints.length > 0) {
                const cp = eng.autoNavCheckpoints[0];
                if (Math.hypot(cp.x - eng.fpPosX, cp.z - eng.fpPosZ) < 1.15) {
                  eng.autoNavCheckpoints.shift();
                  eng.autoNavPauseUntil = now + cp.durationMs;
                  eng.autoNavStatus = cp.label;
                  eng.autoWalkSpeed = 0;
                  const gownOn = cp.kind === 'gowning';
                  useMayaStore
                    .getState()
                    .setGowned(gownOn, `${cp.roomCode} · ${cp.roomName}`, cp.roomId);
                  if (eng.walkAvatar.mayaController) {
                    eng.walkAvatar.mayaController.setGowned(gownOn);
                    eng.walkAvatar.manualEmoteUntil = now + cp.durationMs + 300;
                    eng.walkAvatar.mayaController.setState(gownOn ? 'celebrate' : 'working', {
                      expression: 'happy',
                      fade: 0.2,
                      restart: true,
                    });
                  }
                  storeRef.current.showToast(
                    gownOn
                      ? `Changed into Full Sterile Cleanroom Gown in ${cp.roomCode}`
                      : `De-Gowned Cleanroom Suit in ${cp.roomCode}`,
                    'success'
                  );
                  setPathFinderHud((prev) => (prev ? { ...prev, statusStep: cp.label } : null));
                  autoPaused = true;
                  needsAnother = true;
                }
              }

              if (!autoPaused) {
                const tdx = eng.teleportTarget.x - eng.fpPosX;
                const tdz = eng.teleportTarget.z - eng.fpPosZ;
                const dist = Math.hypot(tdx, tdz);
                if (dist < 0.28) {
                  if (eng.teleportQueue.length > 0) {
                    eng.teleportTarget = eng.teleportQueue.shift() ?? null;
                    needsAnother = true;
                  } else {
                    eng.teleportTarget = null;
                    eng.teleportRing.visible = false;
                    eng.autoNavPendingDoorId = null;
                    eng.autoNavPauseUntil = 0;
                    eng.autoNavStatus = null;
                    if (eng.pathFinderDest) {
                      const arrivedDest = eng.pathFinderDest;
                      const destDist = Math.hypot(
                        arrivedDest.x - eng.fpPosX,
                        arrivedDest.z - eng.fpPosZ
                      );
                      if (destDist < 1.6) {
                        // If arriving in a dark room, automatically turn on room lighting
                        const destRoom =
                          (arrivedDest.roomId
                            ? storeRef.current.scene.rooms.find(
                                (r) => r.id === arrivedDest.roomId
                              )
                            : undefined) ??
                          storeRef.current.scene.rooms.find(
                            (r) =>
                              r.floorId === flId &&
                              eng.fpPosX >= r.x &&
                              eng.fpPosX <= r.x + r.width &&
                              eng.fpPosZ >= r.z &&
                              eng.fpPosZ <= r.z + r.depth
                          );
                        if (destRoom && useMayaStore.getState().roomLights[destRoom.id] === false) {
                          const turnedOn = useMayaStore
                            .getState()
                            .toggleRoomLight(destRoom.id, destRoom.code, destRoom.name);
                          if (spatialAudioEnabledRef.current) {
                            spatialAudioRef.current?.playSwitchCue(turnedOn);
                          }
                        }
                        if (eng.walkAvatar.mayaController) {
                          eng.walkAvatar.manualEmoteUntil = now + 1800;
                          eng.walkAvatar.mayaController.setState('approval', {
                            expression: 'happy',
                            fade: 0.22,
                            restart: true,
                          });
                        }
                        eng.pathFinderDest = null;
                        eng.pathFinderWaypoints = [];
                        eng.autoNavCheckpoints = [];
                        eng.pathFinderGroup.visible = false;
                        disposeObject3D(eng.pathFinderGroup);
                        eng.pathFinderGroup.clear();
                        eng.pathFinderRig = null;
                        setPathFinderHud(null);
                        storeRef.current.showToast(
                          `Arrived at ${arrivedDest.code} · ${arrivedDest.label}`,
                          'success'
                        );
                      } else {
                        setPathFinderHud((prev) =>
                          prev ? { ...prev, autoWalking: false, statusStep: null } : null
                        );
                      }
                    }
                  }
                } else {
                  // 4. Proactively scan ahead for any closed door along the planned GMP route
                  const upcomingDoor = findClosedDoorAhead(
                    eng.fpPosX,
                    eng.fpPosZ,
                    eng.teleportTarget.x,
                    eng.teleportTarget.z,
                    flWalls,
                    flOpenings,
                    useMayaStore.getState().openDoors,
                    1.95
                  );

                  if (upcomingDoor) {
                    triggerAutoDoorOpen(upcomingDoor);
                    needsAnother = true;
                  } else {
                    // Smooth speed ramp-in & arrival ease-out for silky autonomous walking
                    const isFinalLeg = eng.teleportQueue.length === 0;
                    const desiredAutoSpeed =
                      isFinalLeg && dist < 1.25 ? Math.max(1.4, dist * 3.5) : 4.55;
                    eng.autoWalkSpeed = THREE.MathUtils.damp(
                      eng.autoWalkSpeed,
                      desiredAutoSpeed,
                      8,
                      dt
                    );
                    const step = Math.min(dist, eng.autoWalkSpeed * dt);
                    const subSteps = Math.max(1, Math.ceil(step / 0.08));
                    const sDx = ((tdx / dist) * step) / subSteps;
                    const sDz = ((tdz / dist) * step) / subSteps;
                    let curX = eng.fpPosX;
                    let curZ = eng.fpPosZ;
                    const liveOpenDoors = useMayaStore.getState().openDoors;

                    for (let s = 0; s < subSteps; s++) {
                      const wallRes = resolveStrictWallCollision(
                        curX,
                        curZ,
                        curX + sDx,
                        curZ + sDz,
                        MAYA_RADIUS,
                        flWalls,
                        flOpenings,
                        floorW,
                        floorD,
                        liveOpenDoors
                      );
                      const assetRes = resolveAssetCollisions(
                        wallRes.x,
                        wallRes.z,
                        MAYA_RADIUS,
                        flAssets,
                        flWalls,
                        flOpenings,
                        liveOpenDoors
                      );
                      const strict = resolveStrictWallCollision(
                        curX,
                        curZ,
                        assetRes.x,
                        assetRes.z,
                        MAYA_RADIUS,
                        flWalls,
                        flOpenings,
                        floorW,
                        floorD,
                        liveOpenDoors
                      );
                      if (Math.hypot(strict.x - curX, strict.z - curZ) < 0.0004) break;
                      curX = strict.x;
                      curZ = strict.z;
                    }

                    const moved = Math.hypot(curX - eng.fpPosX, curZ - eng.fpPosZ);
                    if (moved < 0.004) {
                      // Safety net: check if ANY closed door is within 2.2m and open it rather than stalling
                      const blockingDoor = findClosedDoorAhead(
                        eng.fpPosX,
                        eng.fpPosZ,
                        eng.teleportTarget.x,
                        eng.teleportTarget.z,
                        flWalls,
                        flOpenings,
                        useMayaStore.getState().openDoors,
                        2.25
                      );
                      if (blockingDoor) {
                        triggerAutoDoorOpen(blockingDoor);
                        needsAnother = true;
                      } else if (eng.teleportQueue.length > 0) {
                        eng.teleportTarget = eng.teleportQueue.shift() ?? null;
                        needsAnother = true;
                      } else {
                        eng.teleportTarget = null;
                        eng.teleportQueue = [];
                        eng.autoWalkSpeed = 0;
                        eng.teleportRing.visible = false;
                        eng.autoNavStatus = null;
                        setPathFinderHud((prev) =>
                          prev ? { ...prev, autoWalking: false, statusStep: null } : null
                        );
                      }
                    } else {
                      eng.fpPosX = curX;
                      eng.fpPosZ = curZ;
                      movedThisFrame = true;
                      const targetYaw = Math.atan2(-tdx, -tdz);
                      let dyaw = targetYaw - eng.fpYaw;
                      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
                      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
                      eng.fpYaw += dyaw * Math.min(1, dt * 8.5);
                      if (!eng.fpLookDragging) {
                        let dcam = eng.fpYaw - eng.fpCamYaw;
                        while (dcam > Math.PI) dcam -= Math.PI * 2;
                        while (dcam < -Math.PI) dcam += Math.PI * 2;
                        eng.fpCamYaw += dcam * Math.min(1, dt * 4.2);
                      }
                      const finalGoal =
                        eng.teleportQueue.length > 0
                          ? eng.teleportQueue[eng.teleportQueue.length - 1]
                          : eng.teleportTarget;
                      eng.teleportRing.visible = true;
                      eng.teleportRing.position.set(finalGoal.x, floorElev + 0.055, finalGoal.z);
                      const pulse = 0.85 + Math.sin(now * 0.01) * 0.18;
                      eng.teleportRing.scale.setScalar(pulse);
                      needsAnother = true;
                    }
                  }
                }
              }
            }

            // Animate 3D Path Finder Ribbon & Dynamically Update Route while Walking
            if (eng.pathFinderDest && eng.pathFinderGroup.visible) {
              animatePathFinderVisual(eng.pathFinderRig, now * 0.001);
              needsAnother = true;
              const distToDest = Math.hypot(
                eng.pathFinderDest.x - eng.fpPosX,
                eng.pathFinderDest.z - eng.fpPosZ
              );
              if (distToDest < 1.25 && !eng.teleportTarget) {
                const arrivedDest = eng.pathFinderDest;
                eng.pathFinderDest = null;
                eng.pathFinderWaypoints = [];
                eng.autoNavCheckpoints = [];
                eng.pathFinderGroup.visible = false;
                disposeObject3D(eng.pathFinderGroup);
                eng.pathFinderGroup.clear();
                eng.pathFinderRig = null;
                setPathFinderHud(null);
                storeRef.current.showToast(
                  `Arrived at ${arrivedDest.code} · ${arrivedDest.label}`,
                  'success'
                );
              } else if (movedThisFrame && now - eng.lastPathRerouteAt > 260) {
                eng.lastPathRerouteAt = now;
                const algo = pathAlgorithmRef.current;
                let pts: { x: number; z: number }[];
                if (eng.teleportTarget) {
                  // Preserve active multi-leg GMP route (including PAL staging) and trim behind MAYA
                  pts = [
                    { x: eng.fpPosX, z: eng.fpPosZ },
                    eng.teleportTarget,
                    ...eng.teleportQueue,
                  ];
                } else {
                  const floorRooms = storeRef.current.scene.rooms.filter(
                    (r) => r.floorId === flId
                  );
                  const replan = planGmpRoute(
                    eng.navMesh,
                    eng.fpPosX,
                    eng.fpPosZ,
                    eng.pathFinderDest.x,
                    eng.pathFinderDest.z,
                    floorRooms,
                    {
                      algorithm: algo,
                      noGoZones: noGoZonesRef.current,
                      rooms: floorRooms,
                      isGowned: useMayaStore.getState().isGowned,
                    }
                  );
                  pts = replan.points;
                }
                eng.pathFinderWaypoints = pts;
                eng.pathFinderRig = populatePathFinderVisual(
                  eng.pathFinderGroup,
                  pts,
                  floorElev,
                  disposeObject3D,
                  algo,
                  eng.autoNavCheckpoints
                );
                const remM = Number(computePathLengthMeters(pts).toFixed(1));
                setPathFinderHud((prev) =>
                  prev
                    ? {
                        ...prev,
                        remainingM: remM,
                        autoWalking: Boolean(eng.teleportTarget),
                        statusStep: eng.autoNavStatus,
                      }
                    : null
                );
              }
            }

            // High-Arc Vertical Jump Physics (Spacebar / Touch Jump — ~2.14m peak)
            if (!eng.fpOnGround || Math.abs(eng.fpVelY) > 0.001) {
              eng.fpVelY -= 13.5 * dt;
              const nextJumpY = eng.fpJumpY + eng.fpVelY * dt;
              if (nextJumpY <= 0) {
                eng.fpJumpY = 0;
                eng.fpVelY = 0;
                eng.fpOnGround = true;
              } else {
                eng.fpJumpY = nextJumpY;
                needsAnother = true;
              }
            }

            // Update MAYA 3D Character Avatar (visible in 3rd-person mode, hidden in 1st-person & WebXR)
            const av = eng.walkAvatar;
            av.root.visible = isThirdPerson;
            av.root.position.set(eng.fpPosX, floorElev + eng.fpJumpY, eng.fpPosZ);
            av.root.rotation.y = eng.fpYaw + Math.PI;

            // Keep ground contact halo anchored cleanly to the floor slab beneath MAYA
            av.shadowRing.position.y = 0.025 - eng.fpJumpY;
            const haloScale = Math.max(0.45, 1 - eng.fpJumpY * 0.22);
            av.shadowRing.scale.setScalar(haloScale);

            const targetBlend = movedThisFrame ? (sprinting ? 1.0 : 0.72) : 0;
            eng.fpMoveBlend = THREE.MathUtils.damp(eng.fpMoveBlend, targetBlend, 10, dt);
            if (eng.fpMoveBlend > 0.015) {
              eng.fpAnimPhase += dt * (sprinting ? 14.2 : 9.4);
              if (!movedThisFrame) needsAnother = true;
            }

            if (isThirdPerson && av.mayaController) {
              const desiredMode: WalkAvatarRig['activeMotionMode'] = !eng.fpOnGround
                ? 'jump'
                : movedThisFrame
                  ? sprinting
                    ? 'sprint'
                    : 'walk'
                  : 'idle';

              if (desiredMode !== av.activeMotionMode) {
                av.activeMotionMode = desiredMode;
                if (desiredMode === 'jump') {
                  av.manualEmoteUntil = 0;
                  av.mayaController.setState('celebrate', { fade: 0.18, restart: true });
                } else if (desiredMode === 'sprint') {
                  av.manualEmoteUntil = 0;
                  av.mayaController.setState('idle', { expression: 'confident', fade: 0.26 });
                } else if (desiredMode === 'walk') {
                  av.manualEmoteUntil = 0;
                  av.mayaController.setState('idle', { expression: 'happy', fade: 0.3 });
                } else if (now > av.manualEmoteUntil) {
                  av.mayaController.setState('idle', { fade: 0.42 });
                }
              }

              av.mayaController.update(dt);

              if (!eng.fpOnGround) {
                if (av.legL) av.legL.rotation.x = THREE.MathUtils.damp(av.legL.rotation.x, -0.52, 12, dt);
                if (av.legR) av.legR.rotation.x = THREE.MathUtils.damp(av.legR.rotation.x, 0.36, 12, dt);
                if (av.torsoPivot) {
                  av.torsoPivot.position.y = THREE.MathUtils.damp(
                    av.torsoPivot.position.y,
                    av.baseTorsoY + 0.04,
                    12,
                    dt
                  );
                }
              } else {
                const swing = Math.sin(eng.fpAnimPhase) * eng.fpMoveBlend;
                const bob = Math.abs(Math.sin(eng.fpAnimPhase)) * 0.055 * eng.fpMoveBlend;
                if (av.legL) av.legL.rotation.x = THREE.MathUtils.damp(av.legL.rotation.x, swing * 0.72, 16, dt);
                if (av.legR) av.legR.rotation.x = THREE.MathUtils.damp(av.legR.rotation.x, -swing * 0.72, 16, dt);
                if (av.torsoPivot) {
                  av.torsoPivot.position.y = THREE.MathUtils.damp(
                    av.torsoPivot.position.y,
                    av.baseTorsoY + bob,
                    16,
                    dt
                  );
                  if (eng.fpMoveBlend > 0.01) {
                    _mayaAdditiveQuat.setFromAxisAngle(_mayaAxisX, eng.fpMoveBlend * (sprinting ? 0.16 : 0.06));
                    av.torsoPivot.quaternion.multiply(_mayaAdditiveQuat);
                  }
                }
                if (eng.fpMoveBlend > 0.01) {
                  if (av.armL) {
                    _mayaAdditiveQuat.setFromAxisAngle(_mayaAxisX, -swing * 0.56);
                    av.armL.quaternion.multiply(_mayaAdditiveQuat);
                  }
                  if (av.armR) {
                    _mayaAdditiveQuat.setFromAxisAngle(_mayaAxisX, swing * 0.56);
                    av.armR.quaternion.multiply(_mayaAdditiveQuat);
                  }
                }
              }

              if (!isSoftwareGl) needsAnother = true;
            }

            // Place Camera for 1st Person vs Smoothly Damped GTA-Style 3rd Person Follow-Behind
            if (isThirdPerson) {
              const pitchClamped = Math.max(-0.46, Math.min(0.62, eng.fpPitch));
              const desiredDist = 2.75;
              const camH = Math.max(1.12, Math.min(3.1, 1.98 - Math.sin(pitchClamped) * 1.25));
              const rawCamX = eng.fpPosX + Math.sin(eng.fpCamYaw) * desiredDist;
              const rawCamZ = eng.fpPosZ + Math.cos(eng.fpCamYaw) * desiredDist;
              // Pull 3rd-person camera inside room walls so camera never clips behind walls
              const safeCam = resolveStrictWallCollision(
                eng.fpPosX,
                eng.fpPosZ,
                rawCamX,
                rawCamZ,
                0.28,
                flWalls,
                flOpenings,
                floorW,
                floorD,
                openDoorsMap
              );
              const targetCamY = floorElev + camH + eng.fpJumpY * 0.82;
              if (!eng.camSmoothReady) {
                eng.camSmoothX = safeCam.x;
                eng.camSmoothY = targetCamY;
                eng.camSmoothZ = safeCam.z;
                eng.camSmoothReady = true;
              } else {
                const dampX = THREE.MathUtils.damp(eng.camSmoothX, safeCam.x, 12, dt);
                const dampZ = THREE.MathUtils.damp(eng.camSmoothZ, safeCam.z, 12, dt);
                const clampedCam = resolveStrictWallCollision(
                  eng.fpPosX,
                  eng.fpPosZ,
                  dampX,
                  dampZ,
                  0.26,
                  flWalls,
                  flOpenings,
                  floorW,
                  floorD,
                  openDoorsMap
                );
                eng.camSmoothX = clampedCam.x;
                eng.camSmoothY = THREE.MathUtils.damp(eng.camSmoothY, targetCamY, 12, dt);
                eng.camSmoothZ = clampedCam.z;
              }
              eng.perspCamera.position.set(eng.camSmoothX, eng.camSmoothY, eng.camSmoothZ);
              eng.perspCamera.lookAt(eng.fpPosX, floorElev + 1.15 + eng.fpJumpY, eng.fpPosZ);
              if (
                manualWalkActive ||
                Math.hypot(eng.camSmoothX - safeCam.x, eng.camSmoothZ - safeCam.z) > 0.015
              ) {
                needsAnother = true;
              }
            } else {
              eng.camSmoothReady = false;
              eng.perspCamera.position.set(eng.fpPosX, floorElev + 1.66 + eng.fpJumpY, eng.fpPosZ);
              eng.perspCamera.rotation.order = 'YXZ';
              eng.perspCamera.rotation.set(eng.fpPitch, eng.fpYaw, 0);
            }

            // Update 3D HRTF Spatial Audio Listener (ambient machines, chillers, server racks & HVAC)
            if (spatialAudioRef.current && spatialAudioEnabledRef.current) {
              spatialAudioRef.current.updateListener(
                eng.fpPosX,
                floorElev + 1.66 + eng.fpJumpY,
                eng.fpPosZ,
                eng.fpYaw,
                eng.fpPitch
              );
            }

            // Throttled live sync for walk HUD, MAYA room tracking & Universal 3D Interaction Sign
            if (now - eng.lastFpUiSync > 120) {
              eng.lastFpUiSync = now;
              if (spatialAudioRef.current && spatialAudioEnabledRef.current) {
                const tel = spatialAudioRef.current.getTelemetry();
                setAudioTelemetry((prev) =>
                  prev &&
                  prev.active === tel.active &&
                  prev.dominantLabel === tel.dominantLabel &&
                  prev.estimatedDb === tel.estimatedDb
                    ? prev
                    : tel
                );
              }
              const cx = Number(eng.fpPosX.toFixed(1));
              const cz = Number(eng.fpPosZ.toFixed(1));
              const jh = Math.max(0, Number(eng.fpJumpY.toFixed(2)));
              const wp = eng.navMesh?.walkablePercent ?? 82;
              setFpState((prev) =>
                prev.x === cx && prev.z === cz && prev.jumpHeight === jh && prev.walkablePct === wp
                  ? prev
                  : { x: cx, z: cz, jumpHeight: jh, walkablePct: wp }
              );

              // Sync current room into MAYA Life domain
              const curRm = storeRef.current.scene.rooms.find(
                (r) =>
                  r.floorId === flId &&
                  eng.fpPosX >= r.x &&
                  eng.fpPosX <= r.x + r.width &&
                  eng.fpPosZ >= r.z &&
                  eng.fpPosZ <= r.z + r.depth
              );
              if (curRm) {
                mayaSnapshot.setActiveLocation(curRm.id, curRm.code, curRm.name);
              }

              // Find nearest interactable (Door, Light Switch, or Equipment) within 2.65m
              let bestItem: WalkInteractable | null = null;
              let bestDist = 2.65;

              eng.animatedDoors.forEach((rig) => {
                if (rig.floorId !== flId) return;
                const d = Math.hypot(rig.worldX - eng.fpPosX, rig.worldZ - eng.fpPosZ);
                if (d < bestDist) {
                  bestDist = d;
                  const opRecord = sceneOpeningsById.get(rig.openingId);
                  const isOpen = Boolean(openDoorsMap[rig.openingId] ?? opRecord?.status === 'open');
                  bestItem = {
                    kind: 'door',
                    id: rig.openingId,
                    code: rig.subtype.replace(/-/g, ' ').toUpperCase(),
                    title: rig.label,
                    actionLabel: isOpen ? 'Close Door' : 'Open Door',
                    detail: `${rig.label} · ${isOpen ? 'Open' : 'Closed'}`,
                    worldX: rig.worldX,
                    worldY: rig.worldY + 1.45,
                    worldZ: rig.worldZ,
                    roomId: rig.roomId,
                    isOnOrOpen: isOpen,
                  };
                }
              });

              eng.roomLightRigs.forEach((lr) => {
                if (lr.floorId !== flId) return;
                for (const sw of lr.switches) {
                  const d = Math.hypot(sw.worldX - eng.fpPosX, sw.worldZ - eng.fpPosZ);
                  if (d < Math.min(bestDist, 2.35)) {
                    bestDist = d;
                    const isOn = mayaSnapshot.isSwitchOn(sw.id, lr.roomId, sw.defaultOn);
                    bestItem = {
                      kind: 'light',
                      id: sw.id,
                      code: lr.roomCode,
                      title: lr.roomName,
                      switchId: sw.id,
                      switchLabel: sw.label,
                      actionLabel: isOn ? `Switch OFF · ${sw.label}` : `Switch ON · ${sw.label}`,
                      detail: `${lr.roomCode} · ${isOn ? 'ON (Day)' : 'OFF (Night)'}`,
                      worldX: sw.worldX,
                      worldY: sw.worldY + 0.42,
                      worldZ: sw.worldZ,
                      roomId: lr.roomId,
                      isOnOrOpen: isOn,
                    };
                  }
                }
              });

              if (!bestItem || bestDist > 1.75) {
                const flAssetsScan = storeRef.current.scene.assets.filter(
                  (a) => a.floorId === flId && !a.hidden
                );
                for (const ast of flAssetsScan) {
                  const d = Math.hypot(ast.x - eng.fpPosX, ast.z - eng.fpPosZ);
                  const reach = Math.max(1.8, Math.max(ast.width, ast.depth) * 0.65 + 1.05);
                  if (d < reach && d < bestDist) {
                    bestDist = d;
                    const isGownStation =
                      /locker|bench|gown/i.test(`${ast.name} ${ast.templateId}`) &&
                      curRm &&
                      /gown|pal|airlock/i.test(`${curRm.name} ${curRm.spaceTypeId ?? ''}`);
                    if (isGownStation) {
                      const gownedNow = mayaSnapshot.isGowned;
                      bestItem = {
                        kind: 'gown',
                        id: ast.id,
                        code: curRm.code,
                        title: `${curRm.code} · ${curRm.name}`,
                        actionLabel: gownedNow ? 'Remove Cleanroom Gown' : 'Put On Full Cleanroom Gown',
                        detail: gownedNow
                          ? 'Change back to Standard Uniform'
                          : 'EU GMP Grade A/B Bunny Suit, Hood & Gloves',
                        worldX: ast.x,
                        worldY: floorElev + ast.y + Math.min(2.1, ast.height + 0.35),
                        worldZ: ast.z,
                        roomId: curRm.id,
                        isOnOrOpen: gownedNow,
                      };
                    } else {
                      bestItem = {
                        kind: 'equipment',
                        id: ast.id,
                        code: ast.assetId,
                        title: ast.name,
                        actionLabel: 'Inspect & Read SOP',
                        detail: `${ast.assetId} · ${ast.category}`,
                        worldX: ast.x,
                        worldY: floorElev + ast.y + Math.min(2.3, ast.height + 0.35),
                        worldZ: ast.z,
                        roomId: ast.roomId,
                      };
                    }
                  }
                }
              }

              nearbyInteractableRef.current = bestItem;
              if (bestItem) {
                const bi = bestItem as WalkInteractable;
                _projVec.set(bi.worldX, bi.worldY, bi.worldZ).project(eng.perspCamera);
                const { w, h } = viewportSizeRef.current;
                const sx = (_projVec.x * 0.5 + 0.5) * w;
                const sy = (-_projVec.y * 0.5 + 0.5) * h;
                const clampedX = Math.max(130, Math.min(w - 130, _projVec.z < 1 ? sx : w / 2));
                const clampedY = Math.max(76, Math.min(h - 140, _projVec.z < 1 ? sy : h * 0.42));
                setNearbyInteractable({ ...bi, screenX: clampedX, screenY: clampedY });
              } else {
                setNearbyInteractable((prev) => (prev ? null : prev));
              }
            }
          } else {
            eng.walkAvatar.root.visible = false;
            eng.teleportRing.visible = false;
            eng.teleportTarget = null;
            eng.teleportQueue = [];
            eng.autoNavCheckpoints = [];
            eng.autoNavPendingDoorId = null;
            eng.autoNavPauseUntil = 0;
            eng.autoNavStatus = null;
            eng.autoOpenedDoors = [];
            if (eng.pathFinderGroup.visible) {
              eng.pathFinderGroup.visible = false;
              eng.pathFinderDest = null;
              eng.pathFinderWaypoints = [];
              setPathFinderHud(null);
            }
            if (nearbyInteractableRef.current) {
              nearbyInteractableRef.current = null;
              setNearbyInteractable(null);
            }
          }

          // Animated 3D Flow & Network Trace Pulse Beads (Single InstancedMesh, zero-GC pre-sampled LUT)
          const hasFlowPulses =
            storeRef.current.animateFlows &&
            eng.flowPulseInstancedMesh !== null &&
            eng.flowPulseTracks.length > 0;
          const hasTracePulses =
            eng.tracePulseInstancedMesh !== null && eng.tracePulseTracks.length > 0;

          if (hasFlowPulses || hasTracePulses) {
            const pulseElapsed = now - eng.lastPulseTick;
            // Pace idle pulse-only frames to ~30fps so GPU/CPU stay cool while keeping animation crisp
            if (needsAnother || pulseElapsed >= 32) {
              const stepDt = Math.min(0.08, Math.max(dt, pulseElapsed / 1000));
              eng.lastPulseTick = now;
              const curExploded = storeRef.current.explodedFactor;

              const advanceInstanced = (
                inst: THREE.InstancedMesh | null,
                tracks: FlowPulseTrack[]
              ) => {
                if (!inst || tracks.length === 0) return;
                for (let i = 0; i < tracks.length; i++) {
                  const tr = tracks[i];
                  tr.phase = (tr.phase + stepDt * tr.speed) % 1;
                  const fIdx = tr.phase * (tr.sampleCount - 1);
                  const i0 = Math.floor(fIdx);
                  const i1 = Math.min(tr.sampleCount - 1, i0 + 1);
                  const frac = fIdx - i0;
                  const b0 = i0 * 3;
                  const b1 = i1 * 3;
                  const x = tr.samples[b0] + (tr.samples[b1] - tr.samples[b0]) * frac;
                  const y =
                    tr.samples[b0 + 1] +
                    (tr.samples[b1 + 1] - tr.samples[b0 + 1]) * frac +
                    curExploded * tr.levelIndex * 5.2;
                  const z = tr.samples[b0 + 2] + (tr.samples[b1 + 2] - tr.samples[b0 + 2]) * frac;
                  _tmpVec3.set(x, y, z);
                  _tmpScale.setScalar(tr.scale);
                  _tmpMat4.compose(_tmpVec3, _identityQuat, _tmpScale);
                  inst.setMatrixAt(i, _tmpMat4);
                }
                inst.instanceMatrix.needsUpdate = true;
              };

              if (hasFlowPulses) advanceInstanced(eng.flowPulseInstancedMesh, eng.flowPulseTracks);
              if (hasTracePulses) advanceInstanced(eng.tracePulseInstancedMesh, eng.tracePulseTracks);
            }
            if (!isSoftwareGl) needsAnother = true;
          }

          if (!storeRef.current.firstPersonMode) {
            eng.orbit.update();
          }

          // Render: support Side-by-Side Stereo VR preview when toggled during desktop VR Immersion
          if (
            storeRef.current.vrMode === 'stereo-preview' &&
            vrStereoSplitRef.current &&
            eng.activeCamera === eng.perspCamera
          ) {
            const cw = renderer.domElement.clientWidth || 800;
            const ch = renderer.domElement.clientHeight || 560;
            const halfW = Math.floor(cw / 2);
            const origPos = eng.perspCamera.position.clone();
            const origAspect = eng.perspCamera.aspect;
            const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(eng.perspCamera.quaternion);
            const ipdHalf = 0.032;

            eng.perspCamera.aspect = Math.max(0.2, halfW / ch);
            eng.perspCamera.updateProjectionMatrix();
            renderer.setScissorTest(true);

            // Left eye
            eng.perspCamera.position.copy(origPos).addScaledVector(rightAxis, -ipdHalf);
            renderer.setViewport(0, 0, halfW, ch);
            renderer.setScissor(0, 0, halfW, ch);
            renderer.render(threeScene, eng.perspCamera);

            // Right eye
            eng.perspCamera.position.copy(origPos).addScaledVector(rightAxis, ipdHalf);
            renderer.setViewport(halfW, 0, cw - halfW, ch);
            renderer.setScissor(halfW, 0, cw - halfW, ch);
            renderer.render(threeScene, eng.perspCamera);

            // Restore camera & full viewport
            eng.perspCamera.position.copy(origPos);
            eng.perspCamera.aspect = origAspect;
            eng.perspCamera.updateProjectionMatrix();
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, cw, ch);
          } else {
            renderer.render(threeScene, eng.activeCamera);
          }
          projectPinsRef.current();
        }

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsAnother) requestRender();
        };

        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    orbit.addEventListener('start', () => {
      if (engineRef.current) {
        engineRef.current.camTargetPos = null;
        engineRef.current.camTargetLook = null;
      }
    });
    orbit.addEventListener('change', requestRender);

    transform.addEventListener('dragging-changed', (event: any) => {
      orbit.enabled = !event.value;
      if (!event.value && transform.object) {
        const assetId = transform.object.userData?.entityId;
        if (assetId && transform.object.userData?.entityType === 'asset') {
          const st = storeRef.current;
          const obj = transform.object;
          const asset = st.scene.assets.find((a) => a.id === assetId);
          if (asset) {
            let nx = snapValue(obj.position.x, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid);
            let nz = snapValue(obj.position.z, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid);
            let nextRotY = Number(obj.rotation.y.toFixed(3));
            if (st.transformMode === 'translate' && st.snap.enabled && st.snap.snapToWall) {
              const flWalls = st.scene.walls.filter((w) => w.floorId === st.activeFloorId);
              const snappedWall = computeSnappedPlacement(
                obj.position.x,
                obj.position.z,
                asset.width,
                asset.depth,
                flWalls,
                st.snap
              );
              nx = snappedWall.x;
              nz = snappedWall.z;
              if (snappedWall.snappedWall) nextRotY = snappedWall.rotationY;
            }
            st.updateAsset(
              assetId,
              {
                x: nx,
                z: nz,
                rotationY: nextRotY,
                width: Math.max(0.25, Number((asset.width * obj.scale.x).toFixed(2))),
                height: Math.max(0.25, Number((asset.height * obj.scale.y).toFixed(2))),
                depth: Math.max(0.25, Number((asset.depth * obj.scale.z).toFixed(2))),
              },
              true
            );
          }
        }
      }
      requestRender();
    });
    transform.addEventListener('change', requestRender);

    let pointerDownPos = { x: 0, y: 0 };
    let draft3DStart: { x: number; z: number } | null = null;
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();

    const snap3DWallPt = (
      rawX: number,
      rawZ: number,
      anchor: { x: number; z: number } | null
    ) => {
      const st = storeRef.current;
      let x = snapValue(rawX, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid);
      let z = snapValue(rawZ, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid);
      if (st.snap.enabled && st.snap.snapToWall) {
        let best = 0.65;
        for (const w of st.scene.walls) {
          if (w.floorId !== st.activeFloorId) continue;
          for (const ep of [
            { x: w.x1, z: w.z1 },
            { x: w.x2, z: w.z2 },
          ]) {
            const d = Math.hypot(ep.x - x, ep.z - z);
            if (d < best) {
              best = d;
              x = ep.x;
              z = ep.z;
            }
          }
        }
        if (best < 0.65) return { x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) };
      }
      if (anchor && st.snap.enabled && st.snap.angleStepDeg > 0) {
        const dx = x - anchor.x;
        const dz = z - anchor.z;
        const len = Math.hypot(dx, dz);
        if (len > 0.15) {
          const stepRad = (st.snap.angleStepDeg * Math.PI) / 180;
          const a = Math.round(Math.atan2(dz, dx) / stepRad) * stepRad;
          const sl = st.snap.snapToGrid ? snapValue(len, st.snap.gridSize, true) : len;
          x = anchor.x + Math.cos(a) * sl;
          z = anchor.z + Math.sin(a) * sl;
        }
      }
      return { x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) };
    };

    const getPointerNDC = (e: PointerEvent | MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const pickEntityAtEvent = (e: PointerEvent | MouseEvent) => {
      const eng = engineRef.current;
      if (!eng) return null;
      getPointerNDC(e);
      raycaster.setFromCamera(pointer, eng.activeCamera);
      const intersects = raycaster.intersectObjects(contentGroup.children, true);
      for (const hit of intersects) {
        let node: THREE.Object3D | null = hit.object;
        while (node && node !== contentGroup) {
          if (node.userData?.entityType && node.userData?.entityId) {
            return {
              entityType: String(node.userData.entityType),
              entityId: String(node.userData.entityId),
              buildingId: node.userData.buildingId ? String(node.userData.buildingId) : undefined,
              switchId: node.userData.switchId ? String(node.userData.switchId) : undefined,
              switchLabel: node.userData.switchLabel ? String(node.userData.switchLabel) : undefined,
              point: hit.point.clone(),
            };
          }
          node = node.parent;
        }
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
      const eng = engineRef.current;
      const st = storeRef.current;
      if (e.button === 2 && st.activeTool === 'draw-wall' && st.wallChainAnchor) {
        st.setWallChainAnchor(null);
        if (eng) {
          disposeObject3D(eng.placeGhostGroup);
          eng.placeGhostGroup.clear();
          eng.placeGhostGroup.visible = false;
          requestRender();
        }
        setPlaceSnapBadge(null);
        return;
      }
      if (eng && st.firstPersonMode) {
        eng.fpLookDragging = true;
        eng.fpLookLastX = e.clientX;
        eng.fpLookLastY = e.clientY;
      }
    };

    let lastMoveRaycast = 0;
    const onPointerMove = (e: PointerEvent) => {
      const eng = engineRef.current;
      if (!eng) return;

      // GTA-Style 3rd-Person Free Orbit (idle) vs 1st-Person Head-Look
      if (storeRef.current.firstPersonMode && eng.fpLookDragging) {
        const dx = e.clientX - eng.fpLookLastX;
        const dy = e.clientY - eng.fpLookLastY;
        eng.fpLookLastX = e.clientX;
        eng.fpLookLastY = e.clientY;
        if (walkCameraModeRef.current === 'third-person') {
          // Orbit camera freely 360° around MAYA so you can view MAYA's face when idle!
          eng.fpCamYaw -= dx * 0.0052;
          eng.fpPitch = Math.max(-0.46, Math.min(0.62, eng.fpPitch - dy * 0.004));
        } else {
          eng.fpYaw -= dx * 0.0042;
          eng.fpCamYaw = eng.fpYaw;
          eng.fpPitch = Math.max(-1.22, Math.min(1.22, eng.fpPitch - dy * 0.0038));
          eng.perspCamera.rotation.order = 'YXZ';
          eng.perspCamera.rotation.set(eng.fpPitch, eng.fpYaw, 0);
        }
        requestRender();
        return;
      }

      const now = performance.now();
      if (now - lastMoveRaycast < 50) return;
      lastMoveRaycast = now;
      getPointerNDC(e);
      raycaster.setFromCamera(pointer, eng.activeCamera);
      const st = storeRef.current;
      const activeFl = st.scene.floors.find((f) => f.id === st.activeFloorId);
      const flElev = activeFl?.elevation ?? 0;
      groundPlane.constant = -flElev;

      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        st.setCursorCoords({
          x: Number(hitPoint.x.toFixed(2)),
          y: Number(flElev.toFixed(2)),
          z: Number(hitPoint.z.toFixed(2)),
        });

        // Live 3D Snap-to-Grid & Snap-to-Wall ghost preview for place-object tool
        if (st.activeTool === 'place-object' && st.workspaceMode !== 'view') {
          const allObjs = [...OBJECT_LIBRARY, ...st.scene.customObjects];
          const tpl = allObjs.find((o) => o.id === st.selectedObjectTemplateId) ?? allObjs[0];
          const flWalls = st.scene.walls.filter((w) => w.floorId === st.activeFloorId);
          const snapped = computeSnappedPlacement(
            hitPoint.x,
            hitPoint.z,
            tpl?.width ?? 1.2,
            tpl?.depth ?? 1.0,
            flWalls,
            st.snap,
            { floorWidth: activeFl?.width, floorDepth: activeFl?.depth }
          );

          disposeObject3D(eng.placeGhostGroup);
          eng.placeGhostGroup.clear();
          eng.placeGhostGroup.visible = true;

          const gw = tpl?.width ?? 1.2;
          const gh = tpl?.height ?? 1.6;
          const gd = tpl?.depth ?? 1.0;
          const tint = snapped.snappedWall ? '#22D3EE' : '#A78BFA';

          const ghostBox = new THREE.Mesh(
            new THREE.BoxGeometry(gw, gh, gd),
            new THREE.MeshBasicMaterial({
              color: tint,
              transparent: true,
              opacity: 0.24,
              depthWrite: false,
            })
          );
          ghostBox.position.set(snapped.x, flElev + gh / 2 + 0.04, snapped.z);
          ghostBox.rotation.y = snapped.rotationY;
          eng.placeGhostGroup.add(ghostBox);

          const ghostEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(gw, gh, gd)),
            new THREE.LineBasicMaterial({ color: tint })
          );
          ghostEdges.position.copy(ghostBox.position);
          ghostEdges.rotation.y = snapped.rotationY;
          eng.placeGhostGroup.add(ghostEdges);

          if (snapped.snappedWall) {
            const wLineGeo = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(snapped.snappedWall.ax, flElev + 0.08, snapped.snappedWall.az),
              new THREE.Vector3(snapped.snappedWall.bx, flElev + 0.08, snapped.snappedWall.bz),
            ]);
            eng.placeGhostGroup.add(
              new THREE.Line(wLineGeo, new THREE.LineBasicMaterial({ color: '#22D3EE' }))
            );
          }

          setPlaceSnapBadge({
            label: snapped.snappedWall
              ? `WALL SNAP · ${snapped.x}, ${snapped.z}`
              : snapped.snappedGrid
                ? `GRID SNAP · ${snapped.x}, ${snapped.z}`
                : `${snapped.x}, ${snapped.z}`,
            isWall: Boolean(snapped.snappedWall),
          });
          requestRender();
        } else if (
          (st.activeTool === 'place-door' || st.activeTool === 'place-window') &&
          st.workspaceMode !== 'view'
        ) {
          const isCampus = st.drillLevel === 'campus';
          const activeBldg = st.scene.buildings.find((b) => b.id === activeFl?.buildingId);
          const ox = isCampus && activeBldg ? activeBldg.originX : 0;
          const oz = isCampus && activeBldg ? activeBldg.originZ : 0;

          const pickedHover = pickEntityAtEvent(e);
          const preferredWallId = pickedHover?.entityType === 'wall' ? pickedHover.entityId : null;
          const refX = (preferredWallId && pickedHover?.point ? pickedHover.point.x : hitPoint.x) - ox;
          const refZ = (preferredWallId && pickedHover?.point ? pickedHover.point.z : hitPoint.z) - oz;

          const wantKind = st.activeTool === 'place-window' ? 'window' : 'door';
          const preset =
            OPENING_PRESETS.find((p) => p.subtype === st.selectedOpeningSubtype && p.kind === wantKind) ??
            OPENING_PRESETS.find((p) => p.kind === wantKind) ??
            OPENING_PRESETS[0];

          const drop = findOpeningDropZone(
            refX,
            refZ,
            st.scene.walls,
            st.activeFloorId,
            preset,
            st.snap,
            2.2,
            preferredWallId
          );

          disposeObject3D(eng.placeGhostGroup);
          eng.placeGhostGroup.clear();
          eng.placeGhostGroup.visible = true;

          const accent = wantKind === 'window' ? '#38BDF8' : '#10B981';
          const eligibleWalls = st.scene.walls.filter(
            (w) => w.floorId === st.activeFloorId && Math.hypot(w.x2 - w.x1, w.z2 - w.z1) >= 0.7
          );
          eligibleWalls.forEach((w) => {
            const wLen = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
            const ang = Math.atan2(w.z2 - w.z1, w.x2 - w.x1);
            const mx = ox + (w.x1 + w.x2) / 2;
            const mz = oz + (w.z1 + w.z2) / 2;
            const isTarget = drop?.wall.id === w.id;

            const topStrip = new THREE.Mesh(
              new THREE.BoxGeometry(wLen, isTarget ? 0.14 : 0.08, w.thickness + (isTarget ? 0.16 : 0.1)),
              new THREE.MeshBasicMaterial({
                color: accent,
                transparent: true,
                opacity: isTarget ? 0.78 : 0.28,
                depthWrite: false,
              })
            );
            topStrip.position.set(mx, flElev + w.height + 0.05, mz);
            topStrip.rotation.y = -ang;
            eng.placeGhostGroup.add(topStrip);

            const baseStrip = new THREE.Mesh(
              new THREE.BoxGeometry(wLen, 0.05, w.thickness + (isTarget ? 0.2 : 0.12)),
              new THREE.MeshBasicMaterial({
                color: accent,
                transparent: true,
                opacity: isTarget ? 0.65 : 0.2,
                depthWrite: false,
              })
            );
            baseStrip.position.set(mx, flElev + 0.035, mz);
            baseStrip.rotation.y = -ang;
            eng.placeGhostGroup.add(baseStrip);
          });

          if (drop) {
            const ghostDepth = drop.wall.thickness + 0.16;
            const ghostGroup = new THREE.Group();
            ghostGroup.position.set(
              ox + drop.worldX,
              flElev + drop.sillHeight + drop.height / 2,
              oz + drop.worldZ
            );
            ghostGroup.rotation.y = -drop.angleRad;

            const ghostFill = new THREE.Mesh(
              new THREE.BoxGeometry(drop.width, drop.height, ghostDepth),
              new THREE.MeshBasicMaterial({
                color: accent,
                transparent: true,
                opacity: 0.38,
                depthWrite: false,
              })
            );
            const ghostEdges = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(drop.width, drop.height, ghostDepth)),
              new THREE.LineBasicMaterial({ color: '#FFFFFF' })
            );
            ghostGroup.add(ghostFill, ghostEdges);
            eng.placeGhostGroup.add(ghostGroup);

            setPlaceSnapBadge({
              label:
                wantKind === 'window'
                  ? `WINDOW ${drop.width.toFixed(2)}×${drop.height.toFixed(2)}m · SILL ${drop.sillHeight.toFixed(2)}m · CLICK WALL TO PLACE`
                  : `DOOR ${drop.width.toFixed(2)}×${drop.height.toFixed(2)}m · CLICK WALL TO PLACE`,
              isWall: true,
            });
          } else {
            const warnRing = new THREE.Mesh(
              new THREE.RingGeometry(0.28, 0.42, 24),
              new THREE.MeshBasicMaterial({
                color: '#EF4444',
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.85,
              })
            );
            warnRing.rotation.x = -Math.PI / 2;
            warnRing.position.set(hitPoint.x, flElev + 0.06, hitPoint.z);
            eng.placeGhostGroup.add(warnRing);

            setPlaceSnapBadge({
              label:
                wantKind === 'window'
                  ? 'MOVE ONTO A WALL TO PLACE WINDOW — CANNOT PLACE IN AIR'
                  : 'MOVE ONTO A WALL TO PLACE DOOR — CANNOT PLACE IN AIR',
              isWall: false,
              isWarning: true,
            });
          }
          requestRender();
        } else if (
          (st.activeTool === 'draw-wall' || st.activeTool === 'draw-room') &&
          st.workspaceMode !== 'view'
        ) {
          const activeAnchor = st.activeTool === 'draw-wall' ? st.wallChainAnchor : draft3DStart;
          const curPt =
            st.activeTool === 'draw-wall'
              ? snap3DWallPt(hitPoint.x, hitPoint.z, activeAnchor)
              : {
                  x: snapValue(hitPoint.x, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid),
                  z: snapValue(hitPoint.z, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid),
                };

          disposeObject3D(eng.placeGhostGroup);
          eng.placeGhostGroup.clear();
          eng.placeGhostGroup.visible = true;

          if (!activeAnchor) {
            const marker = new THREE.Mesh(
              new THREE.CylinderGeometry(0.18, 0.18, 0.08, 16),
              new THREE.MeshBasicMaterial({ color: '#8B5CF6' })
            );
            marker.position.set(curPt.x, flElev + 0.06, curPt.z);
            eng.placeGhostGroup.add(marker);
            setPlaceSnapBadge({
              label:
                st.activeTool === 'draw-wall'
                  ? `CLICK WALL START · ${curPt.x}, ${curPt.z}`
                  : `CLICK ROOM CORNER · ${curPt.x}, ${curPt.z}`,
              isWall: false,
            });
          } else if (st.activeTool === 'draw-wall') {
            const anchorDot = new THREE.Mesh(
              new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16),
              new THREE.MeshBasicMaterial({ color: '#10B981' })
            );
            anchorDot.position.set(activeAnchor.x, flElev + 0.07, activeAnchor.z);
            eng.placeGhostGroup.add(anchorDot);

            const len = Math.hypot(curPt.x - activeAnchor.x, curPt.z - activeAnchor.z);
            const wallH = activeFl?.height ? Math.min(3.6, activeFl.height) : 3.4;
            if (len > 0.1) {
              const box = new THREE.Mesh(
                new THREE.BoxGeometry(len, wallH, 0.16),
                new THREE.MeshBasicMaterial({
                  color: '#8B5CF6',
                  transparent: true,
                  opacity: 0.34,
                  depthWrite: false,
                })
              );
              box.position.set(
                (activeAnchor.x + curPt.x) / 2,
                flElev + wallH / 2,
                (activeAnchor.z + curPt.z) / 2
              );
              box.rotation.y = -Math.atan2(curPt.z - activeAnchor.z, curPt.x - activeAnchor.x);
              eng.placeGhostGroup.add(box);
            }
            const deg = Math.round(
              ((Math.atan2(curPt.z - activeAnchor.z, curPt.x - activeAnchor.x) * 180) / Math.PI + 360) % 360
            );
            setPlaceSnapBadge({
              label: `WALL ${len.toFixed(2)}m · ${deg}° — CLICK TO CONTINUE · ESC TO STOP`,
              isWall: true,
            });
          } else {
            const rx = Math.min(activeAnchor.x, curPt.x);
            const rz = Math.min(activeAnchor.z, curPt.z);
            const rw = Math.max(0.2, Math.abs(curPt.x - activeAnchor.x));
            const rd = Math.max(0.2, Math.abs(curPt.z - activeAnchor.z));
            const rh = activeFl?.height ?? 3.6;
            const roomGhost = new THREE.Mesh(
              new THREE.BoxGeometry(rw, rh, rd),
              new THREE.MeshBasicMaterial({
                color: '#8B5CF6',
                transparent: true,
                opacity: 0.2,
                depthWrite: false,
              })
            );
            roomGhost.position.set(rx + rw / 2, flElev + rh / 2, rz + rd / 2);
            eng.placeGhostGroup.add(roomGhost);
            const edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(rw, rh, rd)),
              new THREE.LineBasicMaterial({ color: '#A78BFA' })
            );
            edges.position.copy(roomGhost.position);
            eng.placeGhostGroup.add(edges);
            setPlaceSnapBadge({
              label: `ROOM ${rw.toFixed(1)}×${rd.toFixed(1)}m (${(rw * rd).toFixed(1)}m²) — CLICK TO CREATE`,
              isWall: false,
            });
          }
          requestRender();
        } else if (eng.placeGhostGroup.visible) {
          draft3DStart = null;
          eng.placeGhostGroup.visible = false;
          setPlaceSnapBadge(null);
          requestRender();
        }

        // Subtle floor teleport preview ring in walk mode
        if (st.firstPersonMode && !eng.teleportTarget) {
          const validFloor =
            (!eng.navMesh || eng.navMesh.isWalkable(hitPoint.x, hitPoint.z)) &&
            hitPoint.x > 0.4 &&
            hitPoint.z > 0.4 &&
            hitPoint.x < (activeFl?.width ?? 60) - 0.4 &&
            hitPoint.z < (activeFl?.depth ?? 40) - 0.4;
          eng.teleportRing.visible = validFloor;
          if (validFloor) {
            eng.teleportRing.position.set(hitPoint.x, flElev + 0.05, hitPoint.z);
            eng.teleportRing.scale.setScalar(0.88);
          }
          requestRender();
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const eng = engineRef.current;
      if (eng) eng.fpLookDragging = false;
      if (e.button !== 0) return;
      const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (moved > 5) return;
      if (!eng || transform.dragging) return;

      const st = storeRef.current;
      getPointerNDC(e);
      raycaster.setFromCamera(pointer, eng.activeCamera);

      const activeFl = st.scene.floors.find((f) => f.id === st.activeFloorId);
      const flElev = activeFl?.elevation ?? 0;
      groundPlane.constant = -flElev;

      // Walk Mode Point-and-Click A* Path Finder Teleportation & Direct Door/Switch Clicks
      if (st.firstPersonMode) {
        if (spatialAudioEnabledRef.current && spatialAudioRef.current) {
          spatialAudioRef.current.setEnabled(true);
        }
        const picked = pickEntityAtEvent(e);
        if (
          (picked?.entityType === 'door-interact' || picked?.entityType === 'opening') &&
          eng.animatedDoors.has(picked.entityId)
        ) {
          const rig = eng.animatedDoors.get(picked.entityId);
          if (rig) {
            executeInteractableRef.current({
              kind: 'door',
              id: rig.openingId,
              code: rig.subtype,
              title: rig.label,
              actionLabel: 'Toggle Door',
              detail: rig.label,
              worldX: rig.worldX,
              worldY: rig.worldY,
              worldZ: rig.worldZ,
              roomId: rig.roomId,
            });
            return;
          }
        }
        if (picked?.entityType === 'light-switch') {
          const lr = eng.roomLightRigs.get(picked.entityId);
          if (lr) {
            const matchedSw =
              lr.switches.find((s) => s.id === picked.switchId) ?? lr.switches[0];
            executeInteractableRef.current({
              kind: 'light',
              id: matchedSw?.id ?? lr.roomId,
              code: lr.roomCode,
              title: lr.roomName,
              switchId: matchedSw?.id,
              switchLabel: matchedSw?.label ?? picked.switchLabel,
              actionLabel: 'Toggle Light',
              detail: lr.roomName,
              worldX: matchedSw?.worldX ?? 0,
              worldY: matchedSw?.worldY ?? 1.25,
              worldZ: matchedSw?.worldZ ?? 0,
              roomId: lr.roomId,
            });
            return;
          }
        }
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          const tx = Math.max(0.65, Math.min((activeFl?.width ?? 40) - 0.65, hitPoint.x));
          const tz = Math.max(0.65, Math.min((activeFl?.depth ?? 28) - 0.65, hitPoint.z));

          // Interactive Floor Placement Mode for User-Defined Path Finder No-Go Exclusion Zones
          if (placingNoGoZoneRef.current && activeFl) {
            const existingCount = noGoZonesRef.current.filter((z) => z.floorId === activeFl.id).length;
            const customLabel =
              noGoLabelDraftRef.current.trim() || `No-Go Zone #${existingCount + 1}`;
            const newZone: NoGoZone = {
              id: `nogo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              floorId: activeFl.id,
              label: customLabel,
              kind: 'circle',
              x: Number(tx.toFixed(2)),
              z: Number(tz.toFixed(2)),
              radius: noGoRadiusRef.current,
            };
            setNoGoZones((prev) => [...prev, newZone]);
            setPlacingNoGoZone(false);
            setNoGoLabelDraft('');
            st.showToast(
              `Marked "${customLabel}" (r=${newZone.radius?.toFixed(1)}m) as Path Finder No-Go zone`,
              'info'
            );
            requestRender();
            return;
          }

          const flWalls = st.scene.walls.filter((w) => w.floorId === st.activeFloorId);
          const flOpenings = st.scene.openings.filter((o) => o.floorId === st.activeFloorId);
          const safeDest = resolveStrictWallCollision(
            tx,
            tz,
            tx,
            tz,
            0.28,
            flWalls,
            flOpenings,
            activeFl?.width ?? 0,
            activeFl?.depth ?? 0,
            useMayaStore.getState().openDoors
          );
          if (!eng.navMesh || eng.navMesh.isWalkable(safeDest.x, safeDest.z)) {
            const floorRooms = st.scene.rooms.filter((r) => r.floorId === st.activeFloorId);
            const destRoom = floorRooms.find(
              (r) =>
                safeDest.x >= r.x &&
                safeDest.x <= r.x + r.width &&
                safeDest.z >= r.z &&
                safeDest.z <= r.z + r.depth
            );
            const algo = pathAlgorithmRef.current;
            const plan = planGmpRoute(
              eng.navMesh,
              eng.fpPosX,
              eng.fpPosZ,
              safeDest.x,
              safeDest.z,
              floorRooms,
              {
                algorithm: algo,
                noGoZones: noGoZonesRef.current,
                rooms: floorRooms,
              }
            );
            const pts = plan.points;
            const finalPt = pts[pts.length - 1] ?? { x: safeDest.x, z: safeDest.z };
            const distM = computePathLengthMeters(pts);
            const label = destRoom ? destRoom.name : 'Selected Floor Point';
            const code = destRoom ? destRoom.code : 'POINT';

            eng.pathFinderDest = {
              label,
              code,
              x: finalPt.x,
              z: finalPt.z,
              roomId: destRoom?.id,
            };
            eng.pathFinderWaypoints = pts;
            eng.autoNavCheckpoints = [...plan.checkpoints];
            eng.autoNavPendingDoorId = null;
            eng.autoNavPauseUntil = 0;
            eng.autoNavStatus = plan.passesThroughPal
              ? 'Routing via PAL gowning & clean corridor...'
              : 'Walking along GMP path (auto-opening doors)...';
            eng.pathFinderRig = populatePathFinderVisual(
              eng.pathFinderGroup,
              pts,
              flElev,
              disposeObject3D,
              algo,
              plan.checkpoints
            );
            eng.lastPathRerouteAt = performance.now();

            eng.teleportQueue = pts.slice(1);
            eng.teleportTarget = eng.teleportQueue.shift() ?? { x: finalPt.x, z: finalPt.z };
            eng.teleportRing.visible = true;
            eng.teleportRing.position.set(finalPt.x, flElev + 0.055, finalPt.z);

            const roomTrail =
              plan.roomSequence.length > 1
                ? plan.roomSequence.map((r) => r.code).join(' → ')
                : undefined;
            setPathFinderHud({
              label,
              code,
              remainingM: Number(distM.toFixed(1)),
              autoWalking: true,
              protocolSummary: plan.gmpProtocolSummary,
              roomTrail,
              statusStep: eng.autoNavStatus,
            });
            requestRender();
          }
        }
        return;
      }

      if (st.activeTool === 'place-object') {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          const allObjs = [...OBJECT_LIBRARY, ...st.scene.customObjects];
          const tpl = allObjs.find((o) => o.id === st.selectedObjectTemplateId) ?? allObjs[0];
          const flWalls = st.scene.walls.filter((w) => w.floorId === st.activeFloorId);
          const snapped = computeSnappedPlacement(
            hitPoint.x,
            hitPoint.z,
            tpl?.width ?? 1.2,
            tpl?.depth ?? 1.0,
            flWalls,
            st.snap,
            { floorWidth: activeFl?.width, floorDepth: activeFl?.depth }
          );
          st.addAsset(st.selectedObjectTemplateId, snapped.x, snapped.z, {
            x: snapped.x,
            z: snapped.z,
            rotationY: snapped.rotationY,
          });
          eng.placeGhostGroup.visible = false;
          setPlaceSnapBadge(null);
          st.setActiveTool('select');
        }
        return;
      }

      if (st.activeTool === 'place-camera') {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          st.addCamera({
            floorId: st.activeFloorId,
            name: `Camera ${st.scene.cameras.length + 1}`,
            kind: 'security',
            group: 'Custom Cameras',
            position: [Number(hitPoint.x.toFixed(2)), 3.0, Number(hitPoint.z.toFixed(2))],
            target: [Number((hitPoint.x + 5).toFixed(2)), 1.3, Number((hitPoint.z + 3).toFixed(2))],
            fov: 60,
            focalLengthMm: 28,
            coverageRadius: 10,
            visibleCone: true,
            layerId: 'layer-cameras',
          });
          st.setActiveTool('select');
        }
        return;
      }

      if ((st.activeTool === 'draw-wall' || st.activeTool === 'draw-room') && st.workspaceMode !== 'view') {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          if (st.activeTool === 'draw-wall') {
            const curAnchor = st.wallChainAnchor;
            const clickPt = snap3DWallPt(hitPoint.x, hitPoint.z, curAnchor);
            if (!curAnchor) {
              st.setWallChainAnchor(clickPt);
            } else {
              const len = Math.hypot(clickPt.x - curAnchor.x, clickPt.z - curAnchor.z);
              if (len >= 0.4) {
                st.addWall(curAnchor.x, curAnchor.z, clickPt.x, clickPt.z);
                st.setWallChainAnchor(clickPt);
              }
            }
          } else {
            const clickPt = {
              x: snapValue(hitPoint.x, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid),
              z: snapValue(hitPoint.z, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid),
            };
            if (!draft3DStart) {
              draft3DStart = clickPt;
            } else {
              const rx = Math.min(draft3DStart.x, clickPt.x);
              const rz = Math.min(draft3DStart.z, clickPt.z);
              const rw = Math.abs(clickPt.x - draft3DStart.x);
              const rd = Math.abs(clickPt.z - draft3DStart.z);
              if (rw >= 1.5 && rd >= 1.5) {
                st.addRoom(rx, rz, rw, rd);
                st.setActiveTool('select');
              }
              draft3DStart = null;
              eng.placeGhostGroup.visible = false;
              setPlaceSnapBadge(null);
            }
          }
          requestRender();
        }
        return;
      }

      if (st.activeTool === 'measure') {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          st.addMeasurePoint({
            x: snapValue(hitPoint.x, st.snap.gridSize, st.snap.enabled),
            z: snapValue(hitPoint.z, st.snap.gridSize, st.snap.enabled),
          });
        }
        return;
      }

      const picked = pickEntityAtEvent(e);

      if (st.activeTool === 'paint-material' && picked) {
        if (
          picked.entityType === 'room' ||
          picked.entityType === 'wall' ||
          picked.entityType === 'asset' ||
          picked.entityType === 'floor'
        ) {
          st.paintSurfaceWithMaterial(picked.entityType, picked.entityId, st.selectedMaterialId);
        }
        return;
      }

      if (st.activeTool === 'place-door' || st.activeTool === 'place-window') {
        const isCampus = st.drillLevel === 'campus';
        const activeBldg = st.scene.buildings.find((b) => b.id === activeFl?.buildingId);
        const ox = isCampus && activeBldg ? activeBldg.originX : 0;
        const oz = isCampus && activeBldg ? activeBldg.originZ : 0;

        const wantKind = st.activeTool === 'place-window' ? 'window' : 'door';
        const preset =
          OPENING_PRESETS.find((p) => p.subtype === st.selectedOpeningSubtype && p.kind === wantKind) ??
          OPENING_PRESETS.find((p) => p.kind === wantKind) ??
          OPENING_PRESETS[0];

        const preferredWallId = picked?.entityType === 'wall' ? picked.entityId : null;
        let refX: number | null = null;
        let refZ: number | null = null;
        if (preferredWallId && picked?.point) {
          refX = picked.point.x - ox;
          refZ = picked.point.z - oz;
        } else if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          refX = hitPoint.x - ox;
          refZ = hitPoint.z - oz;
        }

        const drop =
          refX !== null && refZ !== null
            ? findOpeningDropZone(
                refX,
                refZ,
                st.scene.walls,
                st.activeFloorId,
                preset,
                st.snap,
                2.2,
                preferredWallId
              )
            : null;

        if (drop) {
          st.addOpeningOnWall(drop.wall.id, drop.offsetRatio, preset.subtype);
          disposeObject3D(eng.placeGhostGroup);
          eng.placeGhostGroup.clear();
          eng.placeGhostGroup.visible = false;
          setPlaceSnapBadge(null);
          st.setActiveTool('select');
          requestRender();
        } else {
          st.showToast(
            wantKind === 'window'
              ? 'Windows must be placed on a wall or room perimeter — click a highlighted wall.'
              : 'Doors must be placed on a wall or room perimeter — click a highlighted wall.',
            'warning'
          );
        }
        return;
      }

      // Direct wall switch click works in Orbit View mode too!
      if (picked?.entityType === 'light-switch') {
        const lr = eng.roomLightRigs.get(picked.entityId);
        if (lr) {
          const matchedSw =
            lr.switches.find((s) => s.id === picked.switchId) ?? lr.switches[0];
          executeInteractableRef.current({
            kind: 'light',
            id: matchedSw?.id ?? lr.roomId,
            code: lr.roomCode,
            title: lr.roomName,
            switchId: matchedSw?.id,
            switchLabel: matchedSw?.label ?? picked.switchLabel,
            actionLabel: 'Toggle Light',
            detail: lr.roomName,
            worldX: matchedSw?.worldX ?? 0,
            worldY: matchedSw?.worldY ?? 1.25,
            worldZ: matchedSw?.worldZ ?? 0,
            roomId: lr.roomId,
          });
          return;
        }
      }

      if (picked?.entityType === 'detected-space') {
        if (st.workspaceMode !== 'view') {
          const floorWalls = st.scene.walls.filter((w) => w.floorId === st.activeFloorId);
          const floorRooms = st.scene.rooms.filter((r) => r.floorId === st.activeFloorId);
          const found = detectEnclosedWallPolygons(floorWalls, floorRooms, st.activeFloorId).find(
            (sp) => sp.id === picked.entityId
          );
          if (found) {
            st.setPendingPolygonSpace(found);
          }
        }
        return;
      }

      if (picked) {
        const normalizedType = picked.entityType === 'door-interact' ? 'opening' : picked.entityType;
        st.selectEntity({ type: normalizedType as any, id: picked.entityId }, e.shiftKey);
        if (normalizedType === 'opening' && st.workspaceMode === 'design') {
          st.setRightTab('properties');
          st.setRightPanelOpen(true);
        }
      } else if (!e.shiftKey) {
        st.clearSelection();
      }
    };

    // Double-click 3D Spatial Drill-Down (Campus → Building → Floor → Room → Asset)
    const onDoubleClick = (e: MouseEvent) => {
      const st = storeRef.current;
      if (st.activeTool !== 'select') return;
      const picked = pickEntityAtEvent(e);
      if (!picked) return;

      if (st.drillLevel === 'campus') {
        if (picked.buildingId) {
          st.drillInto('building', picked.buildingId);
          return;
        }
        if (picked.entityType === 'floor') {
          const fl = st.scene.floors.find((f) => f.id === picked.entityId);
          if (fl) st.drillInto('building', fl.buildingId);
          return;
        }
      }
      if (picked.entityType === 'camera') {
        st.openLiveCamera(picked.entityId);
        return;
      }
      if (picked.entityType === 'asset') {
        const ast = st.scene.assets.find((a) => a.id === picked.entityId);
        if (ast && (ast.category === 'IT & Data Center' || ast.rackConfig)) {
          st.openRackDesigner(ast.id);
          return;
        }
        st.drillInto('asset', picked.entityId);
      } else if (picked.entityType === 'room') {
        st.drillInto('room', picked.entityId);
      } else if (picked.entityType === 'floor') {
        st.drillInto('floor', picked.entityId);
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const st = storeRef.current;
      if (st.workspaceMode === 'view') {
        st.showToast('View Mode active — switch to Design Mode to place or paint objects.', 'warning');
        return;
      }
      const aclState = useAclStore.getState();
      const aclUser = getActiveAclUser(aclState);
      if (
        aclUser &&
        (aclUser.status === 'suspended' ||
          !computeEffectivePermissions(aclUser, aclState.roles, aclState.groups).includes('spatial.edit'))
      ) {
        st.showToast('ACL Read-Only — your active role cannot modify spatial equipment.', 'warning');
        return;
      }
      const smartRoomId = e.dataTransfer?.getData('application/x-gradian-smart-room');
      const templateId = e.dataTransfer?.getData('application/x-gradian-object');
      const materialId = e.dataTransfer?.getData('application/x-gradian-material');
      const eng = engineRef.current;
      if (!eng) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, eng.activeCamera);

      const activeFl = st.scene.floors.find((f) => f.id === st.activeFloorId);
      groundPlane.constant = -(activeFl?.elevation ?? 0);

      if (smartRoomId) {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          st.addSmartRoomFromTemplate(smartRoomId, hitPoint.x, hitPoint.z);
        }
      } else if (templateId) {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          st.addAsset(templateId, hitPoint.x, hitPoint.z);
        }
      } else if (materialId) {
        const intersects = raycaster.intersectObjects(contentGroup.children, true);
        for (const hit of intersects) {
          let node: THREE.Object3D | null = hit.object;
          while (node && node !== contentGroup) {
            if (node.userData?.entityType === 'room' || node.userData?.entityType === 'wall' || node.userData?.entityType === 'asset') {
              st.paintSurfaceWithMaterial(node.userData.entityType, node.userData.entityId, materialId);
              return;
            }
            node = node.parent;
          }
        }
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      if (storeRef.current.firstPersonMode) {
        if (spatialAudioEnabledRef.current && spatialAudioRef.current) {
          spatialAudioRef.current.setEnabled(true);
        }
        if ((e.code === 'Enter' || e.code === 'KeyE') && nearbyInteractableRef.current) {
          e.preventDefault();
          executeInteractableRef.current(nearbyInteractableRef.current);
          return;
        }
        if (e.code === 'Space') {
          e.preventDefault();
          const eng = engineRef.current;
          if (eng && eng.fpOnGround) {
            eng.fpVelY = 7.6;
            eng.fpOnGround = false;
            requestRender();
          }
          return;
        }
        if (e.code === 'KeyV') {
          e.preventDefault();
          setWalkCameraMode((prev) => (prev === 'first-person' ? 'third-person' : 'first-person'));
          requestRender();
          return;
        }
        keys.add(e.code);
        requestRender();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
    };

    const detachPinchGuard = attachCanvasPinchGuard(container, (deltaY) => {
      const eng = engineRef.current;
      if (!eng || storeRef.current.firstPersonMode) return;
      const scale = deltaY > 0 ? 1.07 : 0.93;
      if (eng.activeCamera === eng.orthoCamera) {
        eng.orthoCamera.zoom = Math.max(0.25, Math.min(8, eng.orthoCamera.zoom / scale));
        eng.orthoCamera.updateProjectionMatrix();
      } else {
        const offset = eng.perspCamera.position.clone().sub(eng.orbit.target);
        const nextLen = Math.max(2.0, Math.min(180, offset.length() * scale));
        offset.setLength(nextLen);
        eng.perspCamera.position.copy(eng.orbit.target).add(offset);
        eng.orbit.update();
      }
      requestRender();
    });

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);
    renderer.domElement.addEventListener('dragover', onDragOver);
    renderer.domElement.addEventListener('drop', onDrop);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const resizeObserver = new ResizeObserver(() => {
      if (!container || disposed) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 560;
      viewportSizeRef.current = { w, h };
      perspCamera.aspect = w / h;
      perspCamera.updateProjectionMatrix();
      const asp = w / h;
      orthoCamera.left = (-frustum * asp) / 2;
      orthoCamera.right = (frustum * asp) / 2;
      orthoCamera.top = frustum / 2;
      orthoCamera.bottom = -frustum / 2;
      orthoCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
      projectPinsRef.current(true);
      requestRender();
    });
    resizeObserver.observe(container);

    (window as any).__gradianCapture3D = () => {
      if (!engineRef.current) return null;
      renderer.render(threeScene, engineRef.current.activeCamera);
      return renderer.domElement.toDataURL('image/png');
    };

    engineRef.current = {
      renderer,
      scene: threeScene,
      hemi,
      keyLight,
      rimLight,
      nightLightsGroup,
      navMeshGroup,
      navMesh: null,
      flowsGroup,
      hvacGroup,
      traceGroup,
      placeGhostGroup,
      pathFinderGroup,
      noGoZonesGroup,
      pathFinderRig: null,
      pathFinderDest: null,
      pathFinderWaypoints: [],
      teleportQueue: [],
      autoNavCheckpoints: [],
      autoNavPendingDoorId: null,
      autoNavPauseUntil: 0,
      autoNavStatus: null,
      autoOpenedDoors: [],
      lastPathRerouteAt: 0,
      teleportRing,
      teleportTarget: null,
      animatedDoors,
      roomLightRigs,
      flowPulseInstancedMesh: null,
      flowPulseTracks: [],
      tracePulseInstancedMesh: null,
      tracePulseTracks: [],
      lastPulseTick: 0,
      fpVelX: 0,
      fpVelZ: 0,
      fpVelY: 0,
      autoWalkSpeed: 0,
      camSmoothX: 10,
      camSmoothY: 2,
      camSmoothZ: 10.8,
      camSmoothReady: false,
      fpOnGround: true,
      fpYaw: 0,
      fpCamYaw: 0,
      fpPitch: 0,
      fpPosX: 10,
      fpPosZ: 8,
      fpJumpY: 0,
      fpAnimPhase: 0,
      fpMoveBlend: 0,
      walkAvatar,
      fpLookDragging: false,
      fpLookLastX: 0,
      fpLookLastY: 0,
      vrRig,
      lastFpUiSync: 0,
      perspCamera,
      orthoCamera,
      activeCamera: perspCamera,
      orbit,
      transform,
      contentGroup,
      gridHelper,
      assetGroupMap,
      clippingPlane,
      camTargetPos: null,
      camTargetLook: null,
      heatmapGroup,
      heatmapCache,
      requestRender,
      raycaster,
      pointer,
      keys,
      dispose: () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        resizeObserver.disconnect();
        detachPinchGuard();
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        renderer.domElement.removeEventListener('dblclick', onDoubleClick);
        renderer.domElement.removeEventListener('dragover', onDragOver);
        renderer.domElement.removeEventListener('drop', onDrop);
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        orbit.dispose();
        transform.dispose();
        heatmapCache.forEach((entry) => {
          entry.texture.dispose();
          entry.mesh.geometry.dispose();
          (entry.mesh.material as THREE.Material).dispose();
        });
        heatmapCache.clear();
        disposeObject3D(contentGroup);
        disposeObject3D(flowsGroup);
        disposeObject3D(hvacGroup);
        disposeObject3D(traceGroup);
        disposeObject3D(placeGhostGroup);
        disposeObject3D(pathFinderGroup);
        disposeObject3D(noGoZonesGroup);
        disposeObject3D(navMeshGroup);
        disposeObject3D(nightLightsGroup);
        walkAvatar.disposed = true;
        walkAvatar.mayaController?.dispose();
        disposeObject3D(walkAvatar.root);
        disposeObject3D(gridHelper);
        envTex.dispose();
        renderer.dispose();
        delete (window as any).__gradianCapture3D;
      },
    };

    requestRender();

    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Update matte-charcoal / daylight / Night Mode architectural spotlights & exposure
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    disposeObject3D(eng.nightLightsGroup);
    eng.nightLightsGroup.clear();

    const isNight = lightingMode === 'night';
    const isDarkCanvas = canvasBackdrop === 'dark';
    const bg =
      renderStyle === 'wireframe'
        ? '#07090F'
        : isNight
          ? '#050508'
          : isDarkCanvas
            ? '#0B0B10'
            : '#E6E8EE';
    eng.scene.background = new THREE.Color(bg);
    eng.scene.fog = new THREE.Fog(bg, isNight ? 55 : 85, isNight ? 185 : 240);

    if (isNight) {
      eng.renderer.toneMappingExposure = 0.94;
      (eng.scene as any).environmentIntensity = 0.16;
      eng.hemi.intensity = 0.2;
      eng.hemi.color.set('#6B82B8');
      eng.hemi.groundColor.set('#08090F');
      eng.keyLight.intensity = 0.26;
      eng.keyLight.color.set('#9DBBF2');
      eng.rimLight.intensity = 0.22;
      eng.rimLight.color.set('#7C6AF6');

      // Architectural Night Mode: warm tungsten SpotLights (capped at 6 for 60fps, zero extra shadow maps)
      // + procedural additive floor light-pools in EVERY room + recessed ceiling downlights + dark plinth surround
      const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
      const flRooms = sceneData.rooms.filter((r) => r.floorId === activeFloorId);
      const elev = activeFl?.elevation ?? 0;
      const ceilY = elev + (activeFl?.height ?? 3.8) - 0.12;
      const floorW = activeFl?.width ?? 28;
      const floorD = activeFl?.depth ?? 18;

      // Dark architectural nighttime ground surround plinth beneath active floor
      const plinthMat = new THREE.MeshStandardMaterial({
        color: '#0B0D14',
        roughness: 0.92,
        metalness: 0.08,
      });
      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(floorW + 26, 0.36, floorD + 26),
        plinthMat
      );
      plinth.position.set(floorW / 2, elev - 0.42, floorD / 2);
      plinth.receiveShadow = true;
      eng.nightLightsGroup.add(plinth);

      // Subtle exterior architectural perimeter bollards with warm amber lamp caps
      const bollardPostGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.85, 8);
      const bollardCapGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.12, 8);
      const bollardPostMat = new THREE.MeshStandardMaterial({ color: '#1A1C24', roughness: 0.55, metalness: 0.65 });
      const bollardCapMat = new THREE.MeshBasicMaterial({ color: '#FFD08A' });
      const bollardCoords: [number, number][] = [
        [-2.2, -2.2],
        [floorW * 0.5, -2.2],
        [floorW + 2.2, -2.2],
        [-2.2, floorD + 2.2],
        [floorW * 0.5, floorD + 2.2],
        [floorW + 2.2, floorD + 2.2],
      ];
      bollardCoords.forEach(([bx, bz]) => {
        const post = new THREE.Mesh(bollardPostGeo, bollardPostMat);
        post.position.set(bx, elev + 0.2, bz);
        const cap = new THREE.Mesh(bollardCapGeo, bollardCapMat);
        cap.position.set(bx, elev + 0.66, bz);
        eng.nightLightsGroup.add(post, cap);
      });

      // Soft warm radial floor glow decal for EVERY room on the floor (zero dynamic light cost!)
      const poolTex = getWarmLightPoolTexture();
      const collarGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.05, 16);
      const diffuserGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.06, 16);
      const collarMat = new THREE.MeshStandardMaterial({ color: '#1F2029', roughness: 0.45, metalness: 0.72 });

      const roomsForGlow =
        flRooms.length > 0
          ? flRooms
          : [
              { id: 'def-1', x: 0, z: 0, width: floorW * 0.5, depth: floorD, environmental: { cleanroomGrade: 'Unclassified' } } as Room,
              { id: 'def-2', x: floorW * 0.5, z: 0, width: floorW * 0.5, depth: floorD, environmental: { cleanroomGrade: 'Unclassified' } } as Room,
            ];

      roomsForGlow.forEach((rm, idx) => {
        const rx = rm.x + rm.width / 2;
        const rz = rm.z + rm.depth / 2;
        const isAsepticCore =
          rm.environmental?.cleanroomGrade === 'Grade A / ISO 5' ||
          rm.environmental?.cleanroomGrade === 'Grade B / ISO 6';
        const tintHex = isAsepticCore ? '#E0F2FE' : idx % 4 === 3 ? '#FFE4C4' : '#FFD699';

        // Recessed ceiling downlight collar + glowing diffuser
        const collar = new THREE.Mesh(collarGeo, collarMat);
        collar.position.set(rx, ceilY, rz);
        const diffuser = new THREE.Mesh(
          diffuserGeo,
          new THREE.MeshBasicMaterial({ color: tintHex })
        );
        diffuser.position.set(rx, ceilY - 0.01, rz);
        eng.nightLightsGroup.add(collar, diffuser);

        // Floor radial warm light pool (AdditiveBlending, depthWrite false)
        if (poolTex) {
          const poolMat = new THREE.MeshBasicMaterial({
            map: poolTex,
            color: tintHex,
            transparent: true,
            opacity: isAsepticCore ? 0.42 : 0.62,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const pool = new THREE.Mesh(
            new THREE.PlaneGeometry(Math.max(2.6, rm.width * 0.96), Math.max(2.6, rm.depth * 0.96)),
            poolMat
          );
          pool.rotation.x = -Math.PI / 2;
          pool.position.set(rx, elev + 0.025, rz);
          pool.renderOrder = 3;
          eng.nightLightsGroup.add(pool);
        }
      });

      // Up to 6 real architectural tungsten SpotLights (largest/key rooms) for rich 3D specular & wall bounce
      const rankedRooms = [...roomsForGlow]
        .sort((a, b) => b.width * b.depth - a.width * a.depth)
        .slice(0, 6);

      rankedRooms.forEach((rm, idx) => {
        const lx = rm.x + rm.width / 2;
        const lz = rm.z + rm.depth / 2;
        const isAsepticCore =
          rm.environmental?.cleanroomGrade === 'Grade A / ISO 5' ||
          rm.environmental?.cleanroomGrade === 'Grade B / ISO 6';
        const spotColor = isAsepticCore ? '#DCEFFF' : idx % 3 === 0 ? '#FFD79A' : '#FFE3B3';
        const span = Math.max(rm.width, rm.depth);
        const spot = new THREE.SpotLight(
          spotColor,
          isAsepticCore ? 22 : 28,
          Math.max(18, span * 2.4),
          Math.PI / 2.65,
          0.74,
          1.35
        );
        spot.position.set(lx, ceilY + 0.85, lz);
        spot.castShadow = false;
        const tgt = new THREE.Object3D();
        tgt.position.set(lx, elev, lz);
        eng.nightLightsGroup.add(tgt);
        spot.target = tgt;
        eng.nightLightsGroup.add(spot);
      });
    } else if (isDarkCanvas) {
      // Refined Charcoal Dark Studio Lighting (crisp silhouettes, zero overexposure)
      eng.renderer.toneMappingExposure = 0.9;
      (eng.scene as any).environmentIntensity = 0.48;
      eng.hemi.intensity = 0.44;
      eng.hemi.color.set('#E2E8F0');
      eng.hemi.groundColor.set('#181820');
      eng.keyLight.intensity = 0.98;
      eng.keyLight.color.set('#FFF7ED');
      eng.rimLight.intensity = 0.36;
      eng.rimLight.color.set('#A78BFA');
    } else {
      // Clean Bright Architectural Daylight Studio
      eng.renderer.toneMappingExposure = 0.92;
      (eng.scene as any).environmentIntensity = 0.54;
      eng.hemi.intensity = 0.58;
      eng.hemi.color.set('#F8FAFC');
      eng.hemi.groundColor.set('#CBD5E1');
      eng.keyLight.intensity = 0.96;
      eng.keyLight.color.set('#FFF9F0');
      eng.rimLight.intensity = 0.24;
      eng.rimLight.color.set('#93C5FD');
    }

    eng.requestRender();
  }, [canvasBackdrop, renderStyle, lightingMode, activeFloorId, sceneData.rooms, sceneData.floors]);

  // Automatic NavMesh Generation from Walls, Doors (carved passages), and Equipment Footprints
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
    disposeObject3D(eng.navMeshGroup);
    eng.navMeshGroup.clear();

    if (!activeFl) {
      eng.navMesh = null;
      return;
    }
    const flWalls = sceneData.walls.filter((w) => w.floorId === activeFl.id);
    const flOpenings = sceneData.openings.filter((o) => o.floorId === activeFl.id);
    const flAssets = sceneData.assets.filter((a) => a.floorId === activeFl.id && !a.hidden);

    const nm = buildFloorNavMesh(activeFl, flWalls, flOpenings, flAssets);
    eng.navMesh = nm;
    setFpState((prev) => ({ ...prev, walkablePct: nm.walkablePercent }));

    // Sync active floor rooms & equipment into 3D Spatial Audio Engine
    const flRooms = sceneData.rooms.filter((r) => r.floorId === activeFl.id);
    if (!spatialAudioRef.current) {
      spatialAudioRef.current = new FacilitySpatialAudioEngine();
    }
    spatialAudioRef.current.syncFloorSources(flRooms, flAssets, activeFl.elevation);

    if (showNavMesh) {
      const vis = buildNavMeshVisualGroup(nm, activeFl.elevation + 0.06);
      eng.navMeshGroup.add(vis);
    }
    eng.requestRender();
  }, [
    activeFloorId,
    sceneData.floors,
    sceneData.rooms,
    sceneData.walls,
    sceneData.openings,
    sceneData.assets,
    showNavMesh,
  ]);

  // Kick flow pulse animation loop whenever animateFlows toggles on
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !animateFlows) return;
    eng.requestRender();
    if (isSoftwareGl) {
      const id = window.setInterval(() => {
        engineRef.current?.requestRender();
      }, 220);
      return () => window.clearInterval(id);
    }
  }, [animateFlows]);

  // Switch Perspective / Orthographic / First-Person camera & preset angles
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
    const cx = activeFl ? activeFl.width / 2 : 16;
    const cz = activeFl ? activeFl.depth / 2 : 10;
    const cy = activeFl ? activeFl.elevation + 1.4 : 1.4;

    if (viewMode === '3d-ortho') {
      eng.activeCamera = eng.orthoCamera;
      eng.orbit.object = eng.orthoCamera;
      eng.transform.camera = eng.orthoCamera;

      const dist = 44;
      const map: Record<string, [number, number, number]> = {
        isometric: [cx + dist * 0.72, cy + dist * 0.68, cz + dist * 0.72],
        top: [cx, cy + dist, cz + 0.01],
        bottom: [cx, cy - dist, cz + 0.01],
        front: [cx, cy, cz + dist],
        back: [cx, cy, cz - dist],
        left: [cx - dist, cy, cz],
        right: [cx + dist, cy, cz],
      };
      const pos = map[orthoPreset] ?? map.isometric;
      eng.orthoCamera.position.set(pos[0], pos[1], pos[2]);
      eng.orbit.target.set(cx, cy, cz);
      eng.orthoCamera.zoom = 1.0;
      eng.orthoCamera.updateProjectionMatrix();
      eng.orbit.update();
    } else {
      eng.activeCamera = eng.perspCamera;
      eng.orbit.object = eng.perspCamera;
      eng.transform.camera = eng.perspCamera;
      if (firstPersonMode) {
        // Auto-clear section cuts, floor decomposition & campus multi-building offset so character is grounded 1:1 on the floor
        if (storeRef.current.sectionCutEnabled) resetSectionCut();
        if (storeRef.current.explodedFactor > 0.01) setExplodedFactor(0);
        if (storeRef.current.drillLevel === 'campus' && activeFloorId) {
          drillInto('floor', activeFloorId);
        }

        eng.orbit.enabled = false;
        eng.camTargetPos = null;
        eng.camTargetLook = null;

        const mayaState = useMayaStore.getState();
        const restorePose =
          mayaState.pendingRestoreWalkPose && mayaState.savedWalkPose
            ? mayaState.savedWalkPose
            : null;
        const floorElev = activeFl?.elevation ?? 0;

        if (restorePose) {
          eng.fpPosX = restorePose.x;
          eng.fpPosZ = restorePose.z;
          eng.fpJumpY = 0;
          eng.fpVelX = 0;
          eng.fpVelZ = 0;
          eng.fpVelY = 0;
          eng.autoWalkSpeed = 0;
          eng.camSmoothReady = false;
          eng.fpOnGround = true;
          eng.fpMoveBlend = 0;
          eng.fpYaw = restorePose.yaw;
          eng.fpCamYaw = restorePose.camYaw;
          eng.fpPitch = restorePose.pitch;
          walkCameraModeRef.current = restorePose.cameraMode;
          setWalkCameraMode(restorePose.cameraMode);
          mayaState.clearPendingRestoreWalkPose();
        } else {
          const spawn = pickWalkSpawn(activeFl, storeRef.current.scene.rooms, eng.navMesh);
          eng.fpPosX = spawn.x;
          eng.fpPosZ = spawn.z;
          eng.fpJumpY = 0;
          eng.fpVelX = 0;
          eng.fpVelZ = 0;
          eng.fpVelY = 0;
          eng.autoWalkSpeed = 0;
          eng.camSmoothReady = false;
          eng.fpOnGround = true;
          eng.fpMoveBlend = 0;
          eng.fpYaw = Math.atan2(-(spawn.lookX - spawn.x), -(spawn.lookZ - spawn.z));
          eng.fpCamYaw = eng.fpYaw;
          eng.fpPitch = -0.05;
        }

        const isThird = walkCameraModeRef.current === 'third-person';
        eng.walkAvatar.root.visible = isThird;
        eng.walkAvatar.mayaController?.setGowned(mayaState.isGowned);
        eng.walkAvatar.root.position.set(eng.fpPosX, floorElev, eng.fpPosZ);
        eng.walkAvatar.root.rotation.y = eng.fpYaw + Math.PI;
        if (isThird) {
          const initCamX = eng.fpPosX + Math.sin(eng.fpCamYaw) * 2.75;
          const initCamY = floorElev + 2.02;
          const initCamZ = eng.fpPosZ + Math.cos(eng.fpCamYaw) * 2.75;
          eng.camSmoothX = initCamX;
          eng.camSmoothY = initCamY;
          eng.camSmoothZ = initCamZ;
          eng.camSmoothReady = true;
          eng.perspCamera.position.set(initCamX, initCamY, initCamZ);
          eng.perspCamera.lookAt(eng.fpPosX, floorElev + 1.15, eng.fpPosZ);
        } else {
          eng.perspCamera.position.set(eng.fpPosX, floorElev + 1.52, eng.fpPosZ);
          eng.perspCamera.rotation.order = 'YXZ';
          eng.perspCamera.rotation.set(eng.fpPitch, eng.fpYaw, 0);
        }
        setFpState((prev) => ({
          ...prev,
          x: Number(eng.fpPosX.toFixed(1)),
          z: Number(eng.fpPosZ.toFixed(1)),
          jumpHeight: 0,
        }));
      } else {
        eng.walkAvatar.root.visible = false;
        eng.orbit.enabled = true;
        eng.fpLookDragging = false;
        // Place orbit target smoothly 5m in front of camera when leaving walk mode
        const lookDir = new THREE.Vector3();
        eng.perspCamera.getWorldDirection(lookDir);
        if (eng.perspCamera.position.y < (activeFl?.elevation ?? 0) + 3.2) {
          eng.orbit.target.copy(eng.perspCamera.position).addScaledVector(lookDir, 5);
          eng.orbit.update();
        }
      }
    }
    eng.requestRender();
  }, [viewMode, orthoPreset, firstPersonMode, activeFloorId]);

  // Execute camera viewpoint flight commands
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !cameraCommand) return;
    if (cameraCommand.fov) {
      eng.perspCamera.fov = cameraCommand.fov;
      eng.perspCamera.updateProjectionMatrix();
    }
    if (storeRef.current.firstPersonMode) {
      // Snap character & camera grounded inside the target room
      const activeFl = storeRef.current.scene.floors.find(
        (f) => f.id === storeRef.current.activeFloorId
      );
      const floorElev = activeFl?.elevation ?? 0;
      const pos = cameraCommand.position;
      const tgt = cameraCommand.target;
      const safePos = eng.navMesh
        ? eng.navMesh.findNearestWalkable(pos[0], pos[2])
        : { x: pos[0], z: pos[2] };
      eng.fpPosX = safePos.x;
      eng.fpPosZ = safePos.z;
      eng.fpJumpY = 0;
      eng.fpVelY = 0;
      eng.fpOnGround = true;
      const dx = tgt[0] - safePos.x;
      const dz = tgt[2] - safePos.z;
      const dy = tgt[1] - (floorElev + 1.66);
      const horiz = Math.max(0.01, Math.hypot(dx, dz));
      eng.fpYaw = Math.atan2(-dx, -dz);
      eng.fpCamYaw = eng.fpYaw;
      eng.fpPitch = Math.max(-0.55, Math.min(0.65, Math.atan2(dy, horiz)));

      const isThird = walkCameraModeRef.current === 'third-person';
      eng.walkAvatar.root.visible = isThird;
      eng.walkAvatar.root.position.set(safePos.x, floorElev, safePos.z);
      eng.walkAvatar.root.rotation.y = eng.fpYaw + Math.PI;
      if (isThird) {
        eng.perspCamera.position.set(
          safePos.x + Math.sin(eng.fpYaw) * 2.85,
          floorElev + 2.05,
          safePos.z + Math.cos(eng.fpYaw) * 2.85
        );
        eng.perspCamera.lookAt(safePos.x, floorElev + 1.12, safePos.z);
      } else {
        eng.perspCamera.position.set(safePos.x, floorElev + 1.66, safePos.z);
        eng.perspCamera.rotation.order = 'YXZ';
        eng.perspCamera.rotation.set(eng.fpPitch, eng.fpYaw, 0);
      }
      eng.camTargetPos = null;
      eng.camTargetLook = null;
      setFpState((prev) => ({
        ...prev,
        x: Number(safePos.x.toFixed(1)),
        z: Number(safePos.z.toFixed(1)),
        jumpHeight: 0,
      }));
    } else {
      eng.camTargetPos = new THREE.Vector3(...cameraCommand.position);
      eng.camTargetLook = new THREE.Vector3(...cameraCommand.target);
    }
    eng.requestRender();
  }, [cameraCommand]);

  // WebXR VR Immersion Session Lifecycle (triggered by TopToolbar VR Immersion button)
  useEffect(() => {
    if (vrToggleNonce === 0) return;
    const eng = engineRef.current;
    if (!eng) return;

    const exitVr = async () => {
      if (xrSessionRef.current) {
        try {
          await xrSessionRef.current.end();
        } catch {
          // ignore already-ended session
        }
        xrSessionRef.current = null;
      }
      eng.renderer.setAnimationLoop(null);
      if (eng.perspCamera.parent === eng.vrRig) {
        const worldPos = new THREE.Vector3();
        eng.perspCamera.getWorldPosition(worldPos);
        eng.vrRig.remove(eng.perspCamera);
        eng.scene.add(eng.perspCamera);
        eng.perspCamera.position.copy(worldPos);
      }
      setVrStereoSplit(false);
      setVrSessionState(false, 'off');
      if (vrAutoWalkRef.current) {
        vrAutoWalkRef.current = false;
        setFirstPersonMode(false);
      }
      eng.requestRender();
    };

    if (storeRef.current.vrSessionActive) {
      void exitVr();
      showToast('Exited VR Immersion session', 'info');
      return;
    }

    const launchVr = async () => {
      const xrNav = (navigator as any).xr;
      let webXrSupported = false;
      if (xrNav && typeof xrNav.isSessionSupported === 'function') {
        try {
          webXrSupported = await xrNav.isSessionSupported('immersive-vr');
        } catch {
          webXrSupported = false;
        }
      }

      if (webXrSupported && xrNav) {
        try {
          const session = await xrNav.requestSession('immersive-vr', {
            optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
          });
          xrSessionRef.current = session;
          const activeFl = storeRef.current.scene.floors.find(
            (f) => f.id === storeRef.current.activeFloorId
          );
          const cx = (activeFl?.width ?? 28) / 2;
          const cz = (activeFl?.depth ?? 18) / 2;
          const spawn = eng.navMesh
            ? eng.navMesh.findNearestWalkable(cx - 3, cz + 1.5)
            : { x: cx - 3, z: cz + 1.5 };

          eng.orbit.enabled = false;
          eng.vrRig.position.set(spawn.x, activeFl?.elevation ?? 0, spawn.z);
          eng.perspCamera.position.set(0, 1.65, 0);
          eng.perspCamera.rotation.set(0, 0, 0);
          eng.vrRig.add(eng.perspCamera);

          await eng.renderer.xr.setSession(session);
          setVrSessionState(true, 'webxr');
          showToast('WebXR VR Immersion active — use controller thumbsticks to walk the digital twin', 'success');

          let lastXrTime = performance.now();
          eng.renderer.setAnimationLoop((time: number, frame?: any) => {
            const dt = Math.min(0.08, (time - lastXrTime) / 1000);
            lastXrTime = time;

            // WebXR controller thumbstick locomotion with strict wall + NavMesh collision
            if (frame && session.inputSources) {
              for (const src of session.inputSources) {
                const axes = src.gamepad?.axes;
                if (axes && axes.length >= 4) {
                  const strafe = Math.abs(axes[2]) > 0.14 ? axes[2] : 0;
                  const fwd = Math.abs(axes[3]) > 0.14 ? -axes[3] : 0;
                  if (strafe !== 0 || fwd !== 0) {
                    const xrCam = eng.renderer.xr.getCamera();
                    const dir = new THREE.Vector3();
                    xrCam.getWorldDirection(dir);
                    dir.y = 0;
                    if (dir.lengthSq() > 0.001) dir.normalize();
                    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
                    const moveX = (dir.x * fwd + right.x * strafe) * 3.4 * dt;
                    const moveZ = (dir.z * fwd + right.z * strafe) * 3.4 * dt;
                    const flId = storeRef.current.activeFloorId;
                    const flWalls = storeRef.current.scene.walls.filter((w) => w.floorId === flId);
                    const flOpenings = storeRef.current.scene.openings.filter((o) => o.floorId === flId);
                    const curX = eng.vrRig.position.x;
                    const curZ = eng.vrRig.position.z;
                    const navRes = eng.navMesh
                      ? eng.navMesh.resolveMove(curX, curZ, curX + moveX, curZ + moveZ)
                      : { x: curX + moveX, z: curZ + moveZ };
                    const strict = resolveStrictWallCollision(
                      curX,
                      curZ,
                      navRes.x,
                      navRes.z,
                      0.56,
                      flWalls,
                      flOpenings,
                      activeFl?.width ?? 0,
                      activeFl?.depth ?? 0,
                      useMayaStore.getState().openDoors
                    );
                    eng.vrRig.position.x = strict.x;
                    eng.vrRig.position.z = strict.z;
                  }
                }
              }
            }

            eng.renderer.render(eng.scene, eng.perspCamera);
          });

          session.addEventListener('end', () => {
            xrSessionRef.current = null;
            eng.renderer.setAnimationLoop(null);
            if (eng.perspCamera.parent === eng.vrRig) {
              eng.vrRig.remove(eng.perspCamera);
              eng.scene.add(eng.perspCamera);
            }
            eng.orbit.enabled = !storeRef.current.firstPersonMode;
            setVrSessionState(false, 'off');
            eng.requestRender();
          });
          return;
        } catch {
          // Fall through gracefully to interactive Stereo/Head-Look VR Immersion Preview
        }
      }

      // Graceful interactive VR Immersion Walk & Stereo Preview when headset hardware isn't attached
      vrAutoWalkRef.current = !storeRef.current.firstPersonMode;
      if (!storeRef.current.firstPersonMode) {
        setFirstPersonMode(true);
      }
      setVrSessionState(true, 'stereo-preview');
      showToast(
        'VR Immersion Walk active (no WebXR headset detected — drag to look around, WASD/Joystick to walk, toggle Stereo VR Eyes in banner)',
        'info'
      );
      eng.requestRender();
    };

    void launchVr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrToggleNonce]);

  useEffect(() => {
    engineRef.current?.requestRender();
  }, [vrStereoSplit]);

  // Update TransformControls mode & live Snap-to-Grid / Angle increments
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.transform.setMode(transformMode);
    eng.transform.setTranslationSnap(snap.enabled && snap.snapToGrid ? snap.gridSize : null);
    eng.transform.setRotationSnap(
      snap.enabled && snap.angleStepDeg > 0 ? (snap.angleStepDeg * Math.PI) / 180 : null
    );
    eng.transform.setScaleSnap(snap.enabled ? 0.05 : null);
    eng.requestRender();
  }, [transformMode, snap.enabled, snap.snapToGrid, snap.gridSize, snap.angleStepDeg]);

  // Rebuild architectural floor grid matching exact snap.gridSize
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    disposeObject3D(eng.gridHelper);
    eng.gridHelper.clear();

    if (snap.showGrid) {
      const isCampusOrOrgIso = drillLevel === 'campus' || isolatedAssetType !== null;
      const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
      const cellSize = isCampusOrOrgIso
        ? Math.max(1, snap.gridSize * 2)
        : Math.max(0.25, snap.gridSize);
      const rawSpan = isCampusOrOrgIso
        ? Math.max(90, ...sceneData.buildings.map((b) => b.originX + b.width + 24))
        : Math.max(activeFl?.width ?? 40, activeFl?.depth ?? 40) + 12;
      const divisions = Math.max(12, Math.min(240, Math.round(rawSpan / cellSize)));
      const alignedSpan = divisions * cellSize;
      const isDesign = workspaceMode === 'design';
      const grid = new THREE.GridHelper(
        alignedSpan,
        divisions,
        renderStyle === 'wireframe'
          ? 0x0ea5e9
          : isDesign
            ? canvasBackdrop === 'dark'
              ? 0x52525b
              : 0x71717a
            : canvasBackdrop === 'dark'
              ? 0x27272a
              : 0xa1a1aa,
        renderStyle === 'wireframe'
          ? 0x0c4a6e
          : isDesign
            ? canvasBackdrop === 'dark'
              ? 0x27272f
              : 0xcbd5e1
            : canvasBackdrop === 'dark'
              ? 0x18181b
              : 0xd4d4d8
      );
      grid.position.set(
        isCampusOrOrgIso ? alignedSpan * 0.35 : (activeFl?.width ?? 36) / 2,
        isCampusOrOrgIso
          ? -0.06
          : isDesign
            ? (activeFl?.elevation ?? 0) + 0.018
            : (activeFl?.elevation ?? 0) - 0.04,
        (activeFl?.depth ?? 22) / 2
      );
      const mat = grid.material as THREE.Material;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.opacity = Math.min(0.75, snap.gridOpacity + (isDesign ? 0.16 : 0.08));
      eng.gridHelper.add(grid);
    }
    eng.requestRender();
  }, [snap.showGrid, snap.gridSize, snap.gridOpacity, activeFloorId, canvasBackdrop, drillLevel, isolatedAssetType, renderStyle, sceneData.buildings, workspaceMode]);

  // Rebuild 3D Spatial Scene Graph cleanly whenever geometry/drill/isolation/renderStyle changes
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    eng.transform.detach();
    disposeObject3D(eng.contentGroup);
    eng.contentGroup.clear();
    eng.assetGroupMap.clear();
    eng.animatedDoors.clear();
    eng.roomLightRigs.clear();

    const maxAniso = eng.renderer.capabilities.getMaxAnisotropy();
    const allMats: MaterialDef[] = [...sceneData.customMaterials, ...DEFAULT_MATERIALS];
    const getMat = (id: string, tint?: string) => {
      const def = allMats.find((m) => m.id === id) ?? DEFAULT_MATERIALS[0];
      return getProceduralMaterial(def, tint, maxAniso, isSoftwareGl);
    };

    const isLayerVisible = (layerId: string) => {
      const l = sceneData.layers.find((x) => x.id === layerId);
      return l ? l.visible : true;
    };

    const isOrgIsolation = isolatedAssetType !== null;
    const isCategoryXray = categoryFilter !== 'all';
    const categoryMeta = getCategoryMeta(categoryFilter);
    const isMultiBuilding = drillLevel === 'campus' || isOrgIsolation;
    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);

    const buildingsToRender: Building[] = isMultiBuilding
      ? sceneData.buildings
      : sceneData.buildings.filter((b) => b.id === activeBuildingId);

    // Global Multi-Axis Section Cut Clipping Plane (clips ALL meshes including procedural sub-meshes)
    const clipPlanes: THREE.Plane[] = [];
    if (sectionCutEnabled) {
      const sign = sectionCutFlipped ? 1 : -1;
      if (sectionCutAxis === 'y') {
        const cutPos = (activeFl?.elevation ?? 0) + sectionCutHeight;
        eng.clippingPlane.normal.set(0, sign, 0);
        eng.clippingPlane.constant = -sign * cutPos;
      } else if (sectionCutAxis === 'x') {
        eng.clippingPlane.normal.set(sign, 0, 0);
        eng.clippingPlane.constant = -sign * sectionCutHeight;
      } else {
        eng.clippingPlane.normal.set(0, 0, sign);
        eng.clippingPlane.constant = -sign * sectionCutHeight;
      }
      clipPlanes.push(eng.clippingPlane);
      eng.renderer.clippingPlanes = [eng.clippingPlane];
    } else {
      eng.renderer.clippingPlanes = [];
    }

    const selectedSet = new Set(selected.map((s) => `${s.type}:${s.id}`));

    buildingsToRender.forEach((bldg) => {
      const bldgGroup = new THREE.Group();
      if (isMultiBuilding) {
        bldgGroup.position.set(bldg.originX, 0, bldg.originZ);
      }
      bldgGroup.userData = { entityType: 'building', entityId: bldg.id, buildingId: bldg.id };
      eng.contentGroup.add(bldgGroup);

      const bldgFloors: Floor[] =
        isMultiBuilding || showAllFloors || drillLevel === 'building'
          ? sceneData.floors.filter((f) => f.buildingId === bldg.id)
          : activeFl && activeFl.buildingId === bldg.id
            ? [activeFl]
            : [];

      // Architectural Floor Decomposition Riser Guide Columns (scaled in O(1) when explodedFactor changes)
      const initExploded = storeRef.current.explodedFactor;
      if (bldgFloors.length > 1) {
        const sortedFloors = [...bldgFloors].sort((a, b) => a.levelIndex - b.levelIndex);
        const topFl = sortedFloors[sortedFloors.length - 1];
        const totalStackH = topFl.elevation + initExploded * topFl.levelIndex * 5.2 + topFl.height;
        const riserCorners: [number, number][] = [
          [0, 0],
          [bldg.width, 0],
          [bldg.width, bldg.depth],
          [0, bldg.depth],
        ];
        const riserMat = new THREE.LineDashedMaterial({
          color: '#F59E0B',
          dashSize: 0.05,
          gapSize: 0.035,
          transparent: true,
          opacity: 0.62,
        });
        riserCorners.forEach(([rx, rz]) => {
          const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(rx, 0, rz),
            new THREE.Vector3(rx, 1, rz),
          ]);
          const line = new THREE.Line(lineGeo, riserMat);
          line.computeLineDistances();
          line.scale.y = totalStackH;
          line.visible = initExploded > 0.04;
          line.userData.decompRiser = {
            topElevation: topFl.elevation,
            topHeight: topFl.height,
            topLevelIndex: topFl.levelIndex,
          };
          bldgGroup.add(line);
        });
      }

      bldgFloors.forEach((floor) => {
        const floorGroup = new THREE.Group();
        const explodedOffset = initExploded * floor.levelIndex * 5.2;
        floorGroup.position.y = floor.elevation + explodedOffset;
        floorGroup.userData = {
          entityType: 'floor',
          entityId: floor.id,
          buildingId: bldg.id,
          decompFloor: { baseY: floor.elevation, levelIndex: floor.levelIndex },
        };
        bldgGroup.add(floorGroup);

        const splitMidX = floor.width * 0.5;
        const isWireframeAtX = (xVal: number) =>
          renderStyle === 'wireframe' || (renderStyle === 'blueprint-split' && xVal >= splitMidX);

        // Twin-Split Glowing Vertical Holographic Divider Plane
        if (renderStyle === 'blueprint-split' && !isOrgIsolation) {
          const scanPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(floor.depth + 2.4, floor.height + 1.4),
            new THREE.MeshBasicMaterial({
              color: '#38BDF8',
              transparent: true,
              opacity: 0.14,
              side: THREE.DoubleSide,
              depthWrite: false,
            })
          );
          scanPlane.rotation.y = Math.PI / 2;
          scanPlane.position.set(splitMidX, floor.height / 2, floor.depth / 2);
          floorGroup.add(scanPlane);

          const scanRim = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(floor.depth + 2.4, floor.height + 1.4)),
            new THREE.LineBasicMaterial({ color: '#38BDF8', transparent: true, opacity: 0.85 })
          );
          scanRim.rotation.y = Math.PI / 2;
          scanRim.position.copy(scanPlane.position);
          floorGroup.add(scanRim);
        }

        // 1. Floor Slab + Perimeter Architectural Columns (hyper-realistic detailing)
        if (isLayerVisible('layer-architecture')) {
          if (isOrgIsolation || isCategoryXray || renderStyle === 'wireframe') {
            const ghostSlab = new THREE.Mesh(
              new THREE.BoxGeometry(floor.width, floor.slabThickness, floor.depth),
              new THREE.MeshBasicMaterial({
                color: '#0EA5E9',
                transparent: true,
                opacity: isOrgIsolation ? 0.08 : isCategoryXray ? 0.07 : 0.12,
                depthWrite: false,
              })
            );
            ghostSlab.position.set(floor.width / 2, -floor.slabThickness / 2, floor.depth / 2);
            ghostSlab.userData = { entityType: 'floor', entityId: floor.id, buildingId: bldg.id };
            floorGroup.add(ghostSlab);

            const slabEdge = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(floor.width, floor.slabThickness, floor.depth)),
              new THREE.LineBasicMaterial({
                color: isOrgIsolation || isCategoryXray ? '#38BDF8' : '#0EA5E9',
                transparent: true,
                opacity: isOrgIsolation || isCategoryXray ? 0.36 : 0.72,
              })
            );
            slabEdge.position.copy(ghostSlab.position);
            floorGroup.add(slabEdge);
          } else {
            const slabMat = getMat(floor.slabMaterialId);
            slabMat.clippingPlanes = clipPlanes;
            const slab = new THREE.Mesh(
              new THREE.BoxGeometry(floor.width, floor.slabThickness, floor.depth),
              slabMat
            );
            slab.position.set(floor.width / 2, -floor.slabThickness / 2, floor.depth / 2);
            slab.receiveShadow = true;
            slab.userData = { entityType: 'floor', entityId: floor.id, buildingId: bldg.id };
            floorGroup.add(slab);

            const slabEdge = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(floor.width, floor.slabThickness, floor.depth)),
              new THREE.LineBasicMaterial({ color: renderStyle === 'blueprint-split' ? '#38BDF8' : '#3F3F46' })
            );
            slabEdge.position.copy(slab.position);
            floorGroup.add(slabEdge);

            // Structural corner & perimeter columns ONLY when designed rooms exist on this floor
            // (prevents stray corner columns appearing around blank/imported SVG/DWG floorplans)
            const hasDesignedRoomsOnFloor = sceneData.rooms.some((r) => r.floorId === floor.id);
            if (hasDesignedRoomsOnFloor) {
              const colMat = new THREE.MeshStandardMaterial({
                color: '#52525B',
                roughness: 0.42,
                metalness: 0.55,
                clippingPlanes: clipPlanes,
              });
              const colPositions: [number, number][] = [
                [0.2, 0.2],
                [floor.width - 0.2, 0.2],
                [0.2, floor.depth - 0.2],
                [floor.width - 0.2, floor.depth - 0.2],
                [floor.width / 2, 0.2],
                [floor.width / 2, floor.depth - 0.2],
              ];
              colPositions.forEach(([cx, cz]) => {
                const wire = isWireframeAtX(cx);
                const colGeo = new THREE.BoxGeometry(0.32, floor.height, 0.32);
                const col = new THREE.Mesh(
                  colGeo,
                  wire
                    ? new THREE.MeshBasicMaterial({ color: '#0284C7', transparent: true, opacity: 0.14, depthWrite: false })
                    : colMat
                );
                col.position.set(cx, floor.height / 2, cz);
                if (!wire) {
                  col.castShadow = true;
                  col.receiveShadow = true;
                } else {
                  col.add(
                    new THREE.LineSegments(
                      new THREE.EdgesGeometry(colGeo),
                      new THREE.LineBasicMaterial({ color: '#38BDF8', transparent: true, opacity: 0.8 })
                    )
                  );
                }
                floorGroup.add(col);
              });
            }
          }
        }

        // 2. Reference Blueprint Overlays
        if (isLayerVisible('layer-references') && !isOrgIsolation) {
          sceneData.references
            .filter((r) => r.floorId === floor.id && r.visible)
            .forEach((refPlan) => {
              const tex = new THREE.TextureLoader().load(refPlan.dataUrl, () => eng.requestRender());
              tex.colorSpace = THREE.SRGBColorSpace;
              const refMesh = new THREE.Mesh(
                new THREE.PlaneGeometry(refPlan.width, refPlan.depth),
                new THREE.MeshBasicMaterial({
                  map: tex,
                  transparent: true,
                  opacity: refPlan.opacity,
                  depthWrite: false,
                  side: THREE.DoubleSide,
                })
              );
              refMesh.rotation.x = -Math.PI / 2;
              refMesh.rotation.z = -(refPlan.rotationDeg * Math.PI) / 180;
              refMesh.position.set(refPlan.x + refPlan.width / 2, refPlan.elevation + 0.015, refPlan.z + refPlan.depth / 2);
              refMesh.userData = { entityType: 'reference', entityId: refPlan.id, buildingId: bldg.id };
              floorGroup.add(refMesh);
            });
        }

        // 3. Rooms (Floor Finish Surfaces — Rectangular & Enclosed Polygon — + Drill Focus Highlight + Blueprint Wireframe)
        if (isLayerVisible('layer-architecture')) {
          const buildRoomFloorGeo = (rm: Room, thickness = 0.04): THREE.BufferGeometry => {
            if (rm.polygon && rm.polygon.length >= 3) {
              const shape = new THREE.Shape();
              rm.polygon.forEach((p, idx) => {
                if (idx === 0) shape.moveTo(p.x, p.z);
                else shape.lineTo(p.x, p.z);
              });
              shape.closePath();
              const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
              geo.rotateX(Math.PI / 2);
              geo.translate(0, thickness, 0);
              return geo;
            }
            const geo = new THREE.BoxGeometry(rm.width, thickness, rm.depth);
            geo.translate(rm.x + rm.width / 2, thickness / 2, rm.z + rm.depth / 2);
            return geo;
          };

          sceneData.rooms
            .filter((r) => r.floorId === floor.id && r.activeFromDate <= timelineDate)
            .forEach((room: Room) => {
              if (!isOrgIsolation && isolatedIds.length > 0 && !isolatedIds.includes(room.id)) return;
              const isSel = selectedSet.has(`room:${room.id}`);
              const isRoomDrilled = drillLevel === 'room' && activeRoomId === room.id;
              const isDimmedByRoomDrill = drillLevel === 'room' && activeRoomId && activeRoomId !== room.id;
              const roomCenterX = room.x + room.width / 2;
              const wireMode = isWireframeAtX(roomCenterX);
              const matchesCat = !isCategoryXray || doesRoomMatchCategory(room, categoryFilter);

              if (isOrgIsolation || wireMode || !matchesCat) {
                const rmGeo = buildRoomFloorGeo(room, 0.04);
                const rmMesh = new THREE.Mesh(
                  rmGeo,
                  new THREE.MeshBasicMaterial({
                    color: '#0EA5E9',
                    transparent: true,
                    opacity: isOrgIsolation || !matchesCat ? 0.06 : 0.14,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                  })
                );
                rmMesh.userData = { entityType: 'room', entityId: room.id, buildingId: bldg.id };
                floorGroup.add(rmMesh);

                const rmEdge = new THREE.LineSegments(
                  new THREE.EdgesGeometry(rmGeo),
                  new THREE.LineBasicMaterial({
                    color: isSel ? '#10B981' : '#38BDF8',
                    transparent: true,
                    opacity: isOrgIsolation || !matchesCat ? 0.24 : 0.72,
                  })
                );
                floorGroup.add(rmEdge);
              } else {
                const isLineFailRoom = activeLineHighlight?.failingRoomIds.includes(room.id) ?? false;
                const isLineOkRoom = activeLineHighlight?.compliantRoomIds.includes(room.id) ?? false;
                const useTint = isLineFailRoom
                  ? '#EF4444'
                  : isLineOkRoom
                    ? activeLineHighlight?.eligible
                      ? '#10B981'
                      : '#34D399'
                    : analyticsMetric !== 'none'
                      ? getRoomColorForAnalytics(room, analyticsMetric)
                      : undefined;
                const floorMat = getMat(room.floorMaterialId, useTint);
                floorMat.polygonOffset = true;
                floorMat.polygonOffsetFactor = -1;
                floorMat.polygonOffsetUnits = -1;
                floorMat.clippingPlanes = clipPlanes;
                if (room.polygon && room.polygon.length >= 3) {
                  floorMat.side = THREE.DoubleSide;
                }
                if (isDimmedByRoomDrill) {
                  floorMat.transparent = true;
                  floorMat.opacity = 0.25;
                }

                const rmMesh = new THREE.Mesh(buildRoomFloorGeo(room, 0.04), floorMat);
                rmMesh.receiveShadow = true;
                rmMesh.userData = { entityType: 'room', entityId: room.id, buildingId: bldg.id };
                floorGroup.add(rmMesh);

                // Per-Room Visible Wall Light Switches + Typed Ceiling Fixtures + Real Day/Night Lighting Effect
                const floorOpeningsForRoom = sceneData.openings.filter((o) => o.floorId === floor.id);
                const floorWallsForRoom = sceneData.walls.filter((w) => w.floorId === floor.id);
                const effLighting = getEffectiveRoomLighting(room, floorOpeningsForRoom, floorWallsForRoom);
                const mayaLightSnap = useMayaStore.getState();

                const switchRigs: RoomLightRig['switches'] = [];
                const fixtureRigs: RoomLightRig['fixtures'] = [];
                const switchStateMap = new Map<string, boolean>();

                for (const sw of effLighting.switches) {
                  const swOn = mayaLightSnap.isSwitchOn(sw.id, room.id, sw.isOn);
                  switchStateMap.set(sw.id, swOn);
                  const tr = computeSwitchLocalTransform(room, sw, 0.22);

                  const swGroup = new THREE.Group();
                  swGroup.position.set(tr.x, tr.y, tr.z);
                  swGroup.rotation.y = tr.rotY;
                  swGroup.userData = {
                    entityType: 'light-switch',
                    entityId: room.id,
                    buildingId: bldg.id,
                    switchId: sw.id,
                    switchLabel: sw.label,
                  };

                  // Outer high-contrast dark frame housing proud of wall face
                  const swFrame = new THREE.Mesh(
                    new THREE.BoxGeometry(0.24, 0.34, 0.048),
                    new THREE.MeshStandardMaterial({ color: '#1E293B', roughness: 0.35, metalness: 0.45 })
                  );
                  // Brushed white/silver inner switch face plate
                  const swPlate = new THREE.Mesh(
                    new THREE.BoxGeometry(0.19, 0.29, 0.056),
                    new THREE.MeshStandardMaterial({ color: '#F8FAFC', roughness: 0.22, metalness: 0.15 })
                  );
                  swPlate.position.z = 0.004;
                  // Large tactile rocker paddle
                  const swRocker = new THREE.Mesh(
                    new THREE.BoxGeometry(0.095, 0.135, 0.068),
                    new THREE.MeshStandardMaterial({ color: '#E2E8F0', roughness: 0.25, metalness: 0.2 })
                  );
                  swRocker.position.set(0, -0.025, 0.012);
                  swRocker.rotation.x = swOn ? -0.22 : 0.22;
                  // Bright glowing LED indicator strip above rocker
                  const swLedMat = new THREE.MeshBasicMaterial({
                    color: swOn ? '#34D399' : '#F59E0B',
                  });
                  const swLed = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.028, 0.064), swLedMat);
                  swLed.position.set(0, 0.095, 0.01);

                  swGroup.add(swFrame, swPlate, swRocker, swLed);
                  floorGroup.add(swGroup);

                  switchRigs.push({
                    id: sw.id,
                    label: sw.label,
                    defaultOn: sw.isOn,
                    worldX: (isMultiBuilding ? bldg.originX : 0) + tr.x,
                    worldY: floor.elevation + tr.y,
                    worldZ: (isMultiBuilding ? bldg.originZ : 0) + tr.z,
                    ledMat: swLedMat,
                    rocker: swRocker,
                  });
                }

                let initPrimaryTotal = 0;
                let initPrimaryOn = 0;
                const ceilingY = Math.max(2.65, room.height - 0.06);

                for (const fx of effLighting.fixtures) {
                  const cat = getFixtureCatalogItem(fx.type);
                  const fxOn = switchStateMap.has(fx.switchId)
                    ? Boolean(switchStateMap.get(fx.switchId))
                    : mayaLightSnap.isSwitchOn(fx.switchId, room.id, true);
                  const isEmergency = fx.type === 'emergency-bulkhead';
                  if (!isEmergency) {
                    initPrimaryTotal++;
                    if (fxOn) initPrimaryOn++;
                  }

                  const fxColor = kelvinToHex(fx.kelvin, cat.emissiveHex);
                  const maxEmissive =
                    fx.type === 'uv-c-sterilizer'
                      ? 1.5
                      : fx.type === 'high-bay'
                        ? 1.65
                        : fx.type === 'emergency-bulkhead'
                          ? 1.2
                          : 1.35;

                  const fxLensMat = new THREE.MeshStandardMaterial({
                    color: fxColor,
                    emissive: fxColor,
                    emissiveIntensity: fxOn ? maxEmissive : 0.03,
                    roughness: 0.18,
                    metalness: 0.08,
                  });

                  const fxGroup = new THREE.Group();
                  const fxWorldX = room.x + Math.max(0.25, Math.min(room.width - 0.25, fx.relX * room.width));
                  const fxWorldZ = room.z + Math.max(0.25, Math.min(room.depth - 0.25, fx.relZ * room.depth));
                  fxGroup.position.set(fxWorldX, ceilingY, fxWorldZ);

                  const housingMat = new THREE.MeshStandardMaterial({
                    color: '#334155',
                    roughness: 0.4,
                    metalness: 0.5,
                  });

                  if (fx.type === 'recessed-downlight' || fx.type === 'high-bay') {
                    const rad = fx.type === 'high-bay' ? 0.34 : 0.18;
                    const hgt = fx.type === 'high-bay' ? 0.18 : 0.05;
                    const housing = new THREE.Mesh(
                      new THREE.CylinderGeometry(rad * 1.12, rad * 1.18, hgt, 18),
                      housingMat
                    );
                    const lens = new THREE.Mesh(
                      new THREE.CylinderGeometry(rad, rad, 0.025, 18),
                      fxLensMat
                    );
                    lens.position.y = -hgt / 2 - 0.01;
                    fxGroup.add(housing, lens);
                  } else {
                    const baseW =
                      fx.type === 'led-troffer'
                        ? 1.2
                        : fx.type === 'linear-vapor'
                          ? 1.35
                          : fx.type === 'uv-c-sterilizer'
                            ? 1.15
                            : 0.38;
                    const baseD =
                      fx.type === 'led-troffer'
                        ? 0.6
                        : fx.type === 'linear-vapor'
                          ? 0.2
                          : fx.type === 'uv-c-sterilizer'
                            ? 0.16
                            : 0.14;
                    const fw = Math.min(room.width * 0.45, baseW);
                    const fd = Math.min(room.depth * 0.45, baseD);
                    const housing = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.06, 0.055, fd + 0.06), housingMat);
                    const lens = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.024, fd), fxLensMat);
                    lens.position.y = -0.032;
                    fxGroup.add(housing, lens);
                  }
                  floorGroup.add(fxGroup);

                  fixtureRigs.push({
                    id: fx.id,
                    switchId: fx.switchId,
                    defaultOn: fxOn,
                    mat: fxLensMat,
                    maxEmissive,
                    isEmergency,
                  });
                }

                const initLitRatio =
                  initPrimaryTotal > 0
                    ? initPrimaryOn / initPrimaryTotal
                    : mayaLightSnap.roomLights[room.id] ?? true
                      ? 1
                      : 0;

                // Real 3D Room PointLight on active floor for true local Day/Night illumination
                let roomPointLight: THREE.PointLight | undefined;
                const maxLightIntensity = Math.min(2.6, Math.max(1.2, (room.width * room.depth) / 28));
                if (floor.id === activeFloorId && !isMultiBuilding) {
                  roomPointLight = new THREE.PointLight(
                    '#FFFBEB',
                    maxLightIntensity * initLitRatio,
                    Math.max(room.width, room.depth) * 1.45 + 3,
                    1.6
                  );
                  roomPointLight.position.set(roomCenterX, Math.max(2.3, room.height - 0.35), room.z + room.depth / 2);
                  floorGroup.add(roomPointLight);
                }

                // Floor Dimmer Wash
                const dimOverlayMat = new THREE.MeshBasicMaterial({
                  color: '#04060C',
                  transparent: true,
                  opacity: (1 - initLitRatio) * 0.62,
                  depthWrite: false,
                });
                const dimOverlayMesh = new THREE.Mesh(
                  new THREE.PlaneGeometry(Math.max(0.4, room.width - 0.14), Math.max(0.4, room.depth - 0.14)),
                  dimOverlayMat
                );
                dimOverlayMesh.rotation.x = -Math.PI / 2;
                dimOverlayMesh.position.set(roomCenterX, 0.055, room.z + room.depth / 2);
                dimOverlayMesh.visible = initLitRatio < 0.99;
                floorGroup.add(dimOverlayMesh);

                // Full 3D Interior Room Darkening Envelope (BackSide box inside walls/ceiling for unmistakable Day <-> Night feel)
                const darkEnvelopeMat = new THREE.MeshBasicMaterial({
                  color: '#03050B',
                  transparent: true,
                  opacity: (1 - initLitRatio) * 0.72,
                  side: THREE.BackSide,
                  depthWrite: false,
                });
                const envH = Math.max(2.4, room.height - 0.12);
                const darkEnvelopeMesh = new THREE.Mesh(
                  new THREE.BoxGeometry(
                    Math.max(0.4, room.width - 0.24),
                    envH,
                    Math.max(0.4, room.depth - 0.24)
                  ),
                  darkEnvelopeMat
                );
                darkEnvelopeMesh.position.set(roomCenterX, envH / 2 + 0.06, room.z + room.depth / 2);
                darkEnvelopeMesh.visible = initLitRatio < 0.99;
                floorGroup.add(darkEnvelopeMesh);

                eng.roomLightRigs.set(room.id, {
                  roomId: room.id,
                  roomCode: room.code,
                  roomName: room.name,
                  floorId: floor.id,
                  switches: switchRigs,
                  fixtures: fixtureRigs,
                  pointLight: roomPointLight,
                  maxLightIntensity,
                  dimOverlayMat,
                  dimOverlayMesh,
                  darkEnvelopeMat,
                  darkEnvelopeMesh,
                });

                const isVoiceHighlightedRoom = voiceHighlightIds.includes(room.id);
                if (isSel || isRoomDrilled || isCategoryXray || isVoiceHighlightedRoom) {
                  const outlineColor = isVoiceHighlightedRoom
                    ? '#F59E0B'
                    : isRoomDrilled
                      ? '#10B981'
                      : isCategoryXray
                        ? categoryMeta.color
                        : '#3B82F6';
                  if (room.polygon && room.polygon.length >= 3) {
                    const loopPts = room.polygon.map((p) => new THREE.Vector3(p.x, 0.08, p.z));
                    const selLoop = new THREE.LineLoop(
                      new THREE.BufferGeometry().setFromPoints(loopPts),
                      new THREE.LineBasicMaterial({ color: outlineColor })
                    );
                    floorGroup.add(selLoop);
                  } else {
                    const selOutline = new THREE.LineSegments(
                      new THREE.EdgesGeometry(new THREE.BoxGeometry(room.width, isVoiceHighlightedRoom ? 0.35 : 0.09, room.depth)),
                      new THREE.LineBasicMaterial({ color: outlineColor })
                    );
                    selOutline.position.set(roomCenterX, isVoiceHighlightedRoom ? 0.2 : 0.06, room.z + room.depth / 2);
                    floorGroup.add(selOutline);
                  }
                }
              }
            });

          // Auto-Detected Unnamed Enclosed Polygon Spaces (Clickable 3D Highlight Pads on Active Floor)
          if (floor.id === activeFloorId) {
            const flWallsForPoly = sceneData.walls.filter(
              (w) => w.floorId === floor.id && w.activeFromDate <= timelineDate
            );
            const flRoomsForPoly = sceneData.rooms.filter(
              (r) => r.floorId === floor.id && r.activeFromDate <= timelineDate
            );
            const detected3DSpaces = detectEnclosedWallPolygons(flWallsForPoly, flRoomsForPoly, floor.id);
            detected3DSpaces.forEach((sp) => {
              const shape = new THREE.Shape();
              sp.polygon.forEach((p, idx) => {
                if (idx === 0) shape.moveTo(p.x, p.z);
                else shape.lineTo(p.x, p.z);
              });
              shape.closePath();
              const padGeo = new THREE.ShapeGeometry(shape);
              padGeo.rotateX(Math.PI / 2);
              const padMesh = new THREE.Mesh(
                padGeo,
                new THREE.MeshBasicMaterial({
                  color: '#10B981',
                  transparent: true,
                  opacity: 0.16,
                  depthWrite: false,
                  side: THREE.DoubleSide,
                })
              );
              padMesh.position.y = 0.032;
              padMesh.userData = { entityType: 'detected-space', entityId: sp.id, buildingId: bldg.id };
              floorGroup.add(padMesh);

              const borderPts = sp.polygon.map((p) => new THREE.Vector3(p.x, 0.048, p.z));
              const borderLoop = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(borderPts),
                new THREE.LineBasicMaterial({
                  color: '#10B981',
                  transparent: true,
                  opacity: 0.85,
                })
              );
              floorGroup.add(borderLoop);
            });
          }
        }

        // 4. Walls with Automatic Door & Window Opening Cuts + Wireframe/Ghost Support
        if (isLayerVisible('layer-walls')) {
          const floorOpenings = isLayerVisible('layer-openings')
            ? sceneData.openings.filter((o) => o.floorId === floor.id)
            : [];

          const floorWallsList = sceneData.walls.filter(
            (w) => w.floorId === floor.id && w.activeFromDate <= timelineDate
          );
          const floorWallMap = new Map<string, Wall>();
          floorWallsList.forEach((fw) => floorWallMap.set(fw.id, fw));
          const floorRoomMap = new Map<string, Room>();
          sceneData.rooms
            .filter((r) => r.floorId === floor.id)
            .forEach((rm) => floorRoomMap.set(rm.id, rm));

          const renderWalls = deduplicateCoplanarWalls(floorWallsList, floorOpenings);
          const renderedOpeningIds = new Set<string>();

          renderWalls.forEach((wall: Wall) => {
              const baseWallId = wall.id.replace(/__p\d+$/, '');
              const dx = wall.x2 - wall.x1;
              const dz = wall.z2 - wall.z1;
              const len = Math.hypot(dx, dz);
              if (len < 0.05) return;

              const midX = (wall.x1 + wall.x2) / 2;
              const wireMode = isWireframeAtX(midX);
              const angle = Math.atan2(dz, dx);
              const wallGroup = new THREE.Group();
              wallGroup.position.set(wall.x1, wall.elevation, wall.z1);
              wallGroup.rotation.y = -angle;
              wallGroup.userData = { entityType: 'wall', entityId: baseWallId, buildingId: bldg.id };

              const hostRoom = wall.roomId ? floorRoomMap.get(wall.roomId) : undefined;
              const wallXrayGhost =
                isOrgIsolation ||
                (isCategoryXray && (!hostRoom || !doesRoomMatchCategory(hostRoom, categoryFilter)));

              if (wallXrayGhost) {
                // Ultra-clean X-Ray ghost architectural wall outline so matched category/assets pop cleanly
                const ghostGeo = new THREE.BoxGeometry(len, wall.height, wall.thickness);
                if (isCategoryXray) {
                  const xrayPane = new THREE.Mesh(
                    ghostGeo,
                    new THREE.MeshBasicMaterial({
                      color: '#38BDF8',
                      transparent: true,
                      opacity: 0.055,
                      depthWrite: false,
                      clippingPlanes: clipPlanes,
                    })
                  );
                  xrayPane.position.set(len / 2, wall.height / 2, 0);
                  wallGroup.add(xrayPane);
                }
                const ghostEdge = new THREE.LineSegments(
                  new THREE.EdgesGeometry(ghostGeo),
                  new THREE.LineBasicMaterial({
                    color: '#38BDF8',
                    transparent: true,
                    opacity: isCategoryXray ? 0.22 : 0.16,
                    clippingPlanes: clipPlanes,
                  })
                );
                ghostEdge.position.set(len / 2, wall.height / 2, 0);
                wallGroup.add(ghostEdge);
                floorGroup.add(wallGroup);
                return;
              }

              const isSel = selectedSet.has(`wall:${baseWallId}`);
              const isGlassWall =
                wall.presetId === 'full-glass-wall' ||
                wall.presetId === 'glass-partition' ||
                wall.materialId === 'mat-glass-cleanroom' ||
                wall.opacity < 0.65;
              const isFullGlassCurtain = wall.presetId === 'full-glass-wall';

              const wallMat = wireMode
                ? new THREE.MeshBasicMaterial({
                    color: '#0284C7',
                    transparent: true,
                    opacity: 0.12,
                    depthWrite: false,
                    clippingPlanes: clipPlanes,
                  })
                : isGlassWall
                  ? new THREE.MeshPhysicalMaterial({
                      color: isSel ? '#60A5FA' : isFullGlassCurtain ? '#D6F3FF' : '#C2E9FB',
                      roughness: 0.04,
                      metalness: 0.04,
                      ior: 1.52,
                      reflectivity: 0.94,
                      clearcoat: 1.0,
                      clearcoatRoughness: 0.04,
                      transmission: isSoftwareGl ? 0 : isFullGlassCurtain ? 0.74 : 0.66,
                      thickness: 0.08,
                      transparent: true,
                      opacity:
                        drillLevel === 'room' && activeRoomId && wall.roomId !== activeRoomId
                          ? 0.14
                          : isSoftwareGl
                            ? isFullGlassCurtain
                              ? 0.28
                              : 0.34
                            : 0.94,
                      depthWrite: false,
                      clippingPlanes: clipPlanes,
                    })
                  : getMat(wall.materialId, isSel ? '#60A5FA' : undefined);

              if (!wireMode && !isGlassWall) {
                wallMat.opacity = drillLevel === 'room' && activeRoomId && wall.roomId !== activeRoomId ? 0.18 : wall.opacity;
                wallMat.transparent = wallMat.opacity < 0.98;
                wallMat.polygonOffset = true;
                wallMat.polygonOffsetFactor = 1;
                wallMat.polygonOffsetUnits = 1;
                wallMat.clippingPlanes = clipPlanes;
              }

              const curtainFrameMat =
                !wireMode && isGlassWall
                  ? new THREE.MeshStandardMaterial({
                      color: isSel ? '#8B5CF6' : '#1E222B',
                      roughness: 0.32,
                      metalness: 0.82,
                      clippingPlanes: clipPlanes,
                    })
                  : null;

              const frostBandMat =
                !wireMode && isGlassWall
                  ? new THREE.MeshStandardMaterial({
                      color: '#E2F4FF',
                      roughness: 0.52,
                      metalness: 0.04,
                      transparent: true,
                      opacity: 0.19,
                      depthWrite: false,
                      clippingPlanes: clipPlanes,
                    })
                  : null;

              const addWallSeg = (segW: number, segH: number, posX: number, posY: number) => {
                if (!wireMode && isGlassWall && curtainFrameMat) {
                  // Architectural Full Glass Curtain Wall / Glass Partition assembly
                  const glassThick = Math.min(0.032, Math.max(0.018, wall.thickness * 0.42));
                  const frameThick = Math.max(0.065, wall.thickness + 0.015);
                  const trackH = 0.075;
                  const innerH = Math.max(0.1, segH - trackH * 2);

                  // Main low-iron glass panel
                  const paneGeo = new THREE.BoxGeometry(segW, innerH, glassThick);
                  const pane = new THREE.Mesh(paneGeo, wallMat);
                  pane.position.set(posX, posY, 0);
                  pane.renderOrder = 4;
                  wallGroup.add(pane);

                  // Subtle architectural frosted privacy manifestation band at eye/waist height
                  if (frostBandMat && segH > 2.0 && posY - segH / 2 < 1.15 && posY + segH / 2 > 1.38) {
                    const band = new THREE.Mesh(
                      new THREE.BoxGeometry(Math.max(0.06, segW - 0.04), 0.24, glassThick + 0.004),
                      frostBandMat
                    );
                    band.position.set(posX, 1.24, 0);
                    band.renderOrder = 5;
                    wallGroup.add(band);
                  }

                  // Dark anodized aluminum top & bottom structural channels
                  const botTrack = new THREE.Mesh(
                    new THREE.BoxGeometry(segW, trackH, frameThick),
                    curtainFrameMat
                  );
                  botTrack.position.set(posX, posY - segH / 2 + trackH / 2, 0);
                  botTrack.castShadow = true;
                  botTrack.receiveShadow = true;
                  wallGroup.add(botTrack);

                  const topTrack = new THREE.Mesh(
                    new THREE.BoxGeometry(segW, trackH, frameThick),
                    curtainFrameMat
                  );
                  topTrack.position.set(posX, posY + segH / 2 - trackH / 2, 0);
                  wallGroup.add(topTrack);

                  // Vertical structural mullions spaced every ~1.8m (plus segment end posts)
                  const bayCount = Math.max(1, Math.round(segW / 1.8));
                  const mullionW = isFullGlassCurtain ? 0.055 : 0.045;
                  for (let b = 0; b <= bayCount; b++) {
                    const mx = posX - segW / 2 + (b / bayCount) * segW;
                    const mullion = new THREE.Mesh(
                      new THREE.BoxGeometry(mullionW, segH, frameThick),
                      curtainFrameMat
                    );
                    mullion.position.set(mx, posY, 0);
                    mullion.castShadow = true;
                    wallGroup.add(mullion);
                  }

                  // Horizontal transom bar for tall full-glass curtain walls (> 3.0m)
                  if (isFullGlassCurtain && segH >= 3.0) {
                    const transom = new THREE.Mesh(
                      new THREE.BoxGeometry(segW, 0.045, frameThick * 0.92),
                      curtainFrameMat
                    );
                    transom.position.set(posX, posY + segH * 0.24, 0);
                    wallGroup.add(transom);
                  }
                  return;
                }

                const segGeo = new THREE.BoxGeometry(segW, segH, wall.thickness);
                const seg = new THREE.Mesh(segGeo, wallMat);
                seg.position.set(posX, posY, 0);
                if (!wireMode) {
                  seg.castShadow = true;
                  seg.receiveShadow = true;
                  // Crisp architectural seam edge lines so light cleanroom walls never visually bleed together
                  seg.add(
                    new THREE.LineSegments(
                      new THREE.EdgesGeometry(segGeo, 28),
                      new THREE.LineBasicMaterial({
                        color: isSel ? '#8B5CF6' : '#3F3F46',
                        transparent: true,
                        opacity: isSel ? 0.85 : 0.34,
                      })
                    )
                  );
                } else {
                  seg.add(
                    new THREE.LineSegments(
                      new THREE.EdgesGeometry(segGeo),
                      new THREE.LineBasicMaterial({
                        color: isSel ? '#10B981' : '#38BDF8',
                        transparent: true,
                        opacity: 0.72,
                        clippingPlanes: clipPlanes,
                      })
                    )
                  );
                }
                wallGroup.add(seg);
              };

              // Direct host openings + coplanar adjacent-wall door cuts (eliminates double-wall blocked doors & z-fighting)
              const ux = dx / len;
              const uz = dz / len;
              const cutEntries: { op: Opening; centerDist: number; renderFrame: boolean }[] = [];

              floorOpenings.forEach((op) => {
                const hostWall = floorWallMap.get(op.wallId);
                if (!hostWall) return;
                const odx = hostWall.x2 - hostWall.x1;
                const odz = hostWall.z2 - hostWall.z1;
                const olen = Math.hypot(odx, odz);
                if (olen < 0.05) return;
                const ox = hostWall.x1 + odx * op.offsetRatio;
                const oz = hostWall.z1 + odz * op.offsetRatio;
                const relX = ox - wall.x1;
                const relZ = oz - wall.z1;
                const proj = relX * ux + relZ * uz;

                if (op.wallId === baseWallId) {
                  if (proj > 0.05 && proj < len - 0.05) {
                    const shouldRenderFrame = !renderedOpeningIds.has(op.id);
                    if (shouldRenderFrame) renderedOpeningIds.add(op.id);
                    cutEntries.push({ op, centerDist: proj, renderFrame: shouldRenderFrame });
                  }
                  return;
                }

                const dot = Math.abs((odx / olen) * ux + (odz / olen) * uz);
                if (dot < 0.96) return;
                const perp = Math.abs(relX * -uz + relZ * ux);
                if (perp <= Math.max(0.38, wall.thickness + hostWall.thickness + 0.14) && proj > 0.05 && proj < len - 0.05) {
                  const shouldRenderFrame = !renderedOpeningIds.has(op.id);
                  if (shouldRenderFrame) renderedOpeningIds.add(op.id);
                  cutEntries.push({ op, centerDist: proj, renderFrame: shouldRenderFrame });
                }
              });

              cutEntries.sort((a, b) => a.centerDist - b.centerDist);

              let cursor = 0;
              cutEntries.forEach(({ op, centerDist, renderFrame }) => {
                const start = Math.max(cursor, centerDist - op.width / 2);
                const end = Math.min(len, centerDist + op.width / 2);

                if (start - cursor > 0.04) {
                  addWallSeg(start - cursor, wall.height, cursor + (start - cursor) / 2, wall.height / 2);
                }

                const opW = Math.max(0.2, end - start);
                const opCenter = start + opW / 2;

                const effSill = Math.max(0, Math.min(op.sillHeight, Math.max(0, wall.height - 0.45)));
                const effH = Math.max(0.35, Math.min(op.height, Math.max(0.35, wall.height - effSill - 0.04)));

                if (effSill > 0.04) {
                  addWallSeg(opW, effSill, opCenter, effSill / 2);
                }

                const topY = effSill + effH;
                if (wall.height - topY > 0.04) {
                  const hdrH = wall.height - topY;
                  addWallSeg(opW, hdrH, opCenter, topY + hdrH / 2);
                }

                if (!wireMode && renderFrame) {
                  const opGroup = new THREE.Group();
                  opGroup.position.set(opCenter, effSill, 0);
                  opGroup.userData = { entityType: 'opening', entityId: op.id, buildingId: bldg.id };
                  const opSelected = selectedSet.has(`opening:${op.id}`);
                  const frameDepth = wall.thickness + 0.05;
                  const frameMat = new THREE.MeshStandardMaterial({
                    color: opSelected ? '#8B5CF6' : op.frameColor || '#262933',
                    roughness: 0.3,
                    metalness: 0.74,
                    clippingPlanes: clipPlanes,
                  });
                  const hardwareMat = new THREE.MeshPhysicalMaterial({
                    color: '#E5E7EB',
                    roughness: 0.16,
                    metalness: 0.94,
                    clearcoat: 0.5,
                    clippingPlanes: clipPlanes,
                  });
                  const glassPaneMat = new THREE.MeshPhysicalMaterial({
                    color: '#D8F2FF',
                    roughness: 0.04,
                    metalness: 0.04,
                    ior: 1.52,
                    reflectivity: 0.94,
                    clearcoat: 1.0,
                    clearcoatRoughness: 0.04,
                    transmission: isSoftwareGl ? 0 : 0.76,
                    thickness: 0.05,
                    transparent: true,
                    opacity: isSoftwareGl ? 0.34 : 0.94,
                    depthWrite: false,
                    clippingPlanes: clipPlanes,
                  });

                  const jambT = 0.065;
                  // Outer rebated perimeter jambs + header
                  const leftJ = new THREE.Mesh(new THREE.BoxGeometry(jambT, effH, frameDepth), frameMat);
                  leftJ.position.set(-opW / 2 + jambT / 2, effH / 2, 0);
                  leftJ.castShadow = true;
                  opGroup.add(leftJ);

                  const rightJ = new THREE.Mesh(new THREE.BoxGeometry(jambT, effH, frameDepth), frameMat);
                  rightJ.position.set(opW / 2 - jambT / 2, effH / 2, 0);
                  rightJ.castShadow = true;
                  opGroup.add(rightJ);

                  const topJ = new THREE.Mesh(new THREE.BoxGeometry(opW, jambT, frameDepth), frameMat);
                  topJ.position.set(0, effH - jambT / 2, 0);
                  opGroup.add(topJ);

                  if (opSelected) {
                    const selOutline = new THREE.LineSegments(
                      new THREE.EdgesGeometry(new THREE.BoxGeometry(opW + 0.08, effH + 0.08, frameDepth + 0.1)),
                      new THREE.LineBasicMaterial({ color: '#A78BFA' })
                    );
                    selOutline.position.set(0, effH / 2, 0);
                    opGroup.add(selOutline);
                  }

                  if (op.kind === 'window') {
                    // Protruding architectural window sill ledge + bottom gasket
                    const sillLedge = new THREE.Mesh(
                      new THREE.BoxGeometry(opW + 0.08, 0.055, wall.thickness + 0.14),
                      frameMat
                    );
                    sillLedge.position.set(0, 0.025, 0);
                    sillLedge.castShadow = true;
                    sillLedge.receiveShadow = true;
                    opGroup.add(sillLedge);

                    // Double-glazed architectural pane
                    const paneW = Math.max(0.12, opW - jambT * 2);
                    const paneH = Math.max(0.12, effH - jambT - 0.055);
                    const pane = new THREE.Mesh(new THREE.BoxGeometry(paneW, paneH, 0.028), glassPaneMat);
                    pane.position.set(0, 0.055 + paneH / 2, 0);
                    pane.renderOrder = 4;
                    opGroup.add(pane);

                    // Center vertical mullion(s) on wider windows (> 1.55m) + slim horizontal transom on tall windows
                    if (opW > 1.55) {
                      const dividers = opW > 2.7 ? 2 : 1;
                      for (let d = 1; d <= dividers; d++) {
                        const mx = -opW / 2 + (opW / (dividers + 1)) * d;
                        const mullion = new THREE.Mesh(
                          new THREE.BoxGeometry(0.04, paneH, frameDepth * 0.72),
                          frameMat
                        );
                        mullion.position.set(mx, 0.055 + paneH / 2, 0);
                        opGroup.add(mullion);
                      }
                    }
                    if (effH > 1.45) {
                      const trans = new THREE.Mesh(
                        new THREE.BoxGeometry(paneW, 0.032, frameDepth * 0.65),
                        frameMat
                      );
                      trans.position.set(0, effH * 0.72, 0);
                      opGroup.add(trans);
                    }
                  } else {
                    // Realistic Interactive Animated Architectural Door Assembly (Per Type)
                    const leafW = Math.max(0.35, opW - jambT * 2);
                    const leafH = Math.max(1.2, effH - jambT);
                    const isInitiallyOpen = Boolean(
                      useMayaStore.getState().openDoors[op.id] ?? op.status === 'open'
                    );
                    const initProg = isInitiallyOpen ? 1 : 0;
                    const swingSign = op.swingDirection === 'left' ? -1 : 1;
                    const doorWorldX = (isMultiBuilding ? bldg.originX : 0) + wall.x1 + Math.cos(angle) * opCenter;
                    const doorWorldZ = (isMultiBuilding ? bldg.originZ : 0) + wall.z1 + Math.sin(angle) * opCenter;
                    const doorLabel =
                      op.subtype === 'cleanroom-door'
                        ? 'ISO Cleanroom Door'
                        : op.subtype === 'airlock-door'
                          ? 'Airlock Interlock Door'
                          : op.subtype === 'double-door'
                            ? 'Double Leaf Door'
                            : op.subtype === 'sliding-door' || op.subtype === 'automatic-door'
                              ? 'Automatic Sliding Door'
                              : op.subtype === 'roller-shutter'
                                ? 'High-Speed Roll-Up Door'
                                : op.subtype === 'glass-door'
                                  ? 'Tempered Glass Door'
                                  : op.subtype === 'fire-door' || op.subtype === 'emergency-door'
                                    ? 'Fire Rated Egress Door'
                                    : 'Facility Door';

                    opGroup.userData = { entityType: 'opening', entityId: op.id, buildingId: bldg.id, isDoor: true };

                    const closer = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.055, 0.06), hardwareMat);
                    closer.position.set(-leafW * 0.22, effH - jambT - 0.04, frameDepth / 2 + 0.02);
                    opGroup.add(closer);

                    const closerArm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.022, 0.024), hardwareMat);
                    closerArm.position.set(-leafW * 0.22, effH - jambT - 0.015, frameDepth / 2 + 0.055);
                    closerArm.rotation.y = swingSign * initProg * (Math.PI * 0.36);
                    opGroup.add(closerArm);

                    let doorLedMat: THREE.MeshBasicMaterial | undefined;

                    const addPullHandle = (parent: THREE.Group, hx: number, hy: number, isBar = false) => {
                      for (const side of [-1, 1]) {
                        if (isBar) {
                          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.44, 10), hardwareMat);
                          bar.position.set(hx, hy, side * 0.065);
                          parent.add(bar);
                          for (const sy of [-0.17, 0.17]) {
                            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.05, 8), hardwareMat);
                            post.rotation.x = Math.PI / 2;
                            post.position.set(hx, hy + sy, side * 0.042);
                            parent.add(post);
                          }
                        } else {
                          const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.016, 12), hardwareMat);
                          rose.rotation.x = Math.PI / 2;
                          rose.position.set(hx, hy, side * 0.032);
                          const lever = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.022), hardwareMat);
                          lever.position.set(hx - 0.055, hy, side * 0.062);
                          parent.add(rose, lever);
                        }
                      }
                    };

                    if (op.subtype === 'roller-shutter') {
                      const drum = new THREE.Mesh(
                        new THREE.CylinderGeometry(0.14, 0.14, opW + 0.12, 12),
                        frameMat
                      );
                      drum.rotation.z = Math.PI / 2;
                      drum.position.set(0, effH + 0.12, 0);
                      opGroup.add(drum);

                      const curtainMat = new THREE.MeshStandardMaterial({
                        color: '#94A3B8',
                        roughness: 0.38,
                        metalness: 0.55,
                        clippingPlanes: clipPlanes,
                      });
                      const curtain = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.045), curtainMat);
                      const sY = Math.max(0.06, 1 - initProg * 0.92);
                      curtain.scale.y = sY;
                      curtain.position.set(0, leafH - (leafH * sY) / 2, 0);
                      opGroup.add(curtain);

                      eng.animatedDoors.set(op.id, {
                        openingId: op.id,
                        floorId: floor.id,
                        subtype: op.subtype,
                        label: doorLabel,
                        roomId: wall.roomId,
                        worldX: doorWorldX,
                        worldY: floor.elevation,
                        worldZ: doorWorldZ,
                        progress: initProg,
                        swingSign,
                        slideTravel: 0,
                        rollCurtain: curtain,
                        rollMaxH: leafH,
                      });
                    } else if (op.subtype === 'sliding-door' || op.subtype === 'automatic-door') {
                      const halfW = leafW / 2 - 0.01;
                      const solidLeafMat = new THREE.MeshStandardMaterial({
                        color: '#D6DCE5',
                        roughness: 0.24,
                        metalness: 0.38,
                        clippingPlanes: clipPlanes,
                      });
                      const rail = new THREE.Mesh(
                        new THREE.BoxGeometry(opW + 0.7, 0.095, frameDepth + 0.05),
                        frameMat
                      );
                      rail.position.set(0, effH + 0.035, 0);
                      opGroup.add(rail);

                      const slideTravel = halfW * 0.88;
                      const slideLeft = new THREE.Group();
                      const slideRight = new THREE.Group();
                      slideLeft.position.x = -initProg * slideTravel;
                      slideRight.position.x = initProg * slideTravel;

                      const buildSlideLeaf = (grp: THREE.Group, side: -1 | 1) => {
                        const cx = side * (halfW / 2 + 0.006);
                        const leaf = new THREE.Mesh(new THREE.BoxGeometry(halfW, leafH, 0.048), solidLeafMat);
                        leaf.position.set(cx, leafH / 2, 0);
                        leaf.castShadow = true;
                        const vw = Math.min(0.36, halfW * 0.56);
                        const vh = Math.min(1.05, leafH * 0.5);
                        const vFrame = new THREE.Mesh(new THREE.BoxGeometry(vw + 0.04, vh + 0.04, 0.054), frameMat);
                        vFrame.position.set(cx, leafH * 0.58, 0);
                        const vGlass = new THREE.Mesh(new THREE.BoxGeometry(vw, vh, 0.058), glassPaneMat);
                        vGlass.position.set(cx, leafH * 0.58, 0);
                        grp.add(leaf, vFrame, vGlass);
                        addPullHandle(grp, cx - side * (halfW * 0.34), 1.04, true);
                      };
                      buildSlideLeaf(slideLeft, -1);
                      buildSlideLeaf(slideRight, 1);
                      opGroup.add(slideLeft, slideRight);

                      doorLedMat = new THREE.MeshBasicMaterial({ color: isInitiallyOpen ? '#22D3EE' : '#10B981' });
                      const sensorBar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.04), doorLedMat);
                      sensorBar.position.set(0, effH + 0.09, frameDepth / 2 + 0.015);
                      opGroup.add(sensorBar);

                      eng.animatedDoors.set(op.id, {
                        openingId: op.id,
                        floorId: floor.id,
                        subtype: op.subtype,
                        label: doorLabel,
                        roomId: wall.roomId,
                        worldX: doorWorldX,
                        worldY: floor.elevation,
                        worldZ: doorWorldZ,
                        progress: initProg,
                        swingSign,
                        slideLeft,
                        slideRight,
                        slideTravel,
                        rollMaxH: leafH,
                        ledMat: doorLedMat,
                      });
                    } else if (op.subtype === 'double-door') {
                      const halfW = leafW / 2 - 0.012;
                      const solidLeafMat = new THREE.MeshStandardMaterial({
                        color: '#E2E8F0',
                        roughness: 0.28,
                        metalness: 0.34,
                        clippingPlanes: clipPlanes,
                      });
                      const leftPivot = new THREE.Group();
                      leftPivot.position.set(-leafW / 2, 0, 0);
                      leftPivot.rotation.y = -initProg * (Math.PI * 0.46);

                      const rightPivot = new THREE.Group();
                      rightPivot.position.set(leafW / 2, 0, 0);
                      rightPivot.rotation.y = initProg * (Math.PI * 0.46);

                      const buildSwingLeaf = (pivot: THREE.Group, dir: 1 | -1) => {
                        const lx = dir * (halfW / 2);
                        const leaf = new THREE.Mesh(new THREE.BoxGeometry(halfW, leafH, 0.05), solidLeafMat);
                        leaf.position.set(lx, leafH / 2, 0);
                        leaf.castShadow = true;
                        const kick = new THREE.Mesh(new THREE.BoxGeometry(halfW - 0.04, 0.28, 0.056), hardwareMat);
                        kick.position.set(lx, 0.16, 0);
                        const vw = Math.min(0.32, halfW * 0.46);
                        const vh = Math.min(0.84, leafH * 0.38);
                        const vFrame = new THREE.Mesh(new THREE.BoxGeometry(vw + 0.04, vh + 0.04, 0.056), frameMat);
                        vFrame.position.set(lx, leafH * 0.62, 0);
                        const vGlass = new THREE.Mesh(new THREE.BoxGeometry(vw, vh, 0.06), glassPaneMat);
                        vGlass.position.set(lx, leafH * 0.62, 0);
                        pivot.add(leaf, kick, vFrame, vGlass);
                        addPullHandle(pivot, dir * (halfW - 0.12), 1.04, true);
                      };
                      buildSwingLeaf(leftPivot, 1);
                      buildSwingLeaf(rightPivot, -1);
                      opGroup.add(leftPivot, rightPivot);

                      eng.animatedDoors.set(op.id, {
                        openingId: op.id,
                        floorId: floor.id,
                        subtype: op.subtype,
                        label: doorLabel,
                        roomId: wall.roomId,
                        worldX: doorWorldX,
                        worldY: floor.elevation,
                        worldZ: doorWorldZ,
                        progress: initProg,
                        swingSign,
                        leftPivot,
                        rightPivot,
                        slideTravel: 0,
                        rollMaxH: leafH,
                      });
                    } else {
                      // Single-leaf hinged door (Glass, Modern ISO Blue Cleanroom Door, Fire Door, Standard Door)
                      const doorPivot = new THREE.Group();
                      doorPivot.position.set(-leafW / 2, 0, 0);
                      doorPivot.rotation.y = swingSign * initProg * (Math.PI * 0.48);

                      if (op.subtype === 'glass-door') {
                        const gLeaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.024), glassPaneMat);
                        gLeaf.position.set(leafW / 2, leafH / 2, 0);
                        gLeaf.renderOrder = 4;
                        const botRail = new THREE.Mesh(new THREE.BoxGeometry(leafW, 0.085, 0.036), hardwareMat);
                        botRail.position.set(leafW / 2, 0.045, 0);
                        const topPatch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.038), hardwareMat);
                        topPatch.position.set(0.1, leafH - 0.035, 0);
                        doorPivot.add(gLeaf, botRail, topPatch);
                        addPullHandle(doorPivot, leafW - 0.14, 1.06, true);
                      } else {
                        const isFire = op.subtype === 'fire-door' || op.subtype === 'emergency-door';
                        const isCleanroom = op.subtype === 'cleanroom-door' || op.subtype === 'airlock-door';
                        // Modern pharmaceutical ISO blue cleanroom door finish matching cleanroom standard
                        const leafColor = isFire ? '#B91C1C' : isCleanroom ? '#0369A1' : '#CBD5E1';
                        const solidLeafMat = new THREE.MeshStandardMaterial({
                          color: leafColor,
                          roughness: isCleanroom ? 0.22 : 0.36,
                          metalness: isFire ? 0.45 : isCleanroom ? 0.26 : 0.2,
                          clippingPlanes: clipPlanes,
                        });
                        const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.052), solidLeafMat);
                        leaf.position.set(leafW / 2, leafH / 2, 0);
                        leaf.castShadow = true;
                        doorPivot.add(leaf);

                        const kick = new THREE.Mesh(new THREE.BoxGeometry(leafW - 0.04, 0.26, 0.058), hardwareMat);
                        kick.position.set(leafW / 2, 0.15, 0);
                        doorPivot.add(kick);

                        if (isCleanroom || isFire || leafW >= 0.88) {
                          const vw = isFire ? 0.18 : Math.min(0.4, leafW * 0.44);
                          const vh = isFire ? 0.72 : Math.min(0.76, leafH * 0.36);
                          const vx = isFire ? leafW * 0.72 : leafW * 0.54;
                          const gasketMat = new THREE.MeshStandardMaterial({
                            color: '#0F172A',
                            roughness: 0.4,
                            metalness: 0.3,
                          });
                          const vFrame = new THREE.Mesh(new THREE.BoxGeometry(vw + 0.05, vh + 0.05, 0.06), gasketMat);
                          vFrame.position.set(vx, leafH * 0.64, 0);
                          const vGlass = new THREE.Mesh(new THREE.BoxGeometry(vw, vh, 0.064), glassPaneMat);
                          vGlass.position.set(vx, leafH * 0.64, 0);
                          doorPivot.add(vFrame, vGlass);
                        }

                        if (isCleanroom || op.accessControl === 'interlock' || op.accessControl === 'badge') {
                          const ledColor =
                            op.status === 'alarm'
                              ? '#EF4444'
                              : isInitiallyOpen
                                ? '#22D3EE'
                                : op.status === 'interlocked'
                                  ? '#F59E0B'
                                  : '#10B981';
                          doorLedMat = new THREE.MeshBasicMaterial({ color: ledColor });
                          const led = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.042, 0.03), doorLedMat);
                          led.position.set(0, effH + 0.055, frameDepth / 2 + 0.01);
                          opGroup.add(led);
                        }

                        if (isFire) {
                          const crashBar = new THREE.Mesh(
                            new THREE.BoxGeometry(leafW * 0.74, 0.06, 0.06),
                            new THREE.MeshStandardMaterial({ color: '#FACC15', roughness: 0.3, metalness: 0.4 })
                          );
                          crashBar.position.set(leafW / 2, 1.0, 0.055);
                          doorPivot.add(crashBar);
                        } else {
                          addPullHandle(doorPivot, leafW - 0.12, 1.02, false);
                        }
                      }

                      opGroup.add(doorPivot);
                      eng.animatedDoors.set(op.id, {
                        openingId: op.id,
                        floorId: floor.id,
                        subtype: op.subtype,
                        label: doorLabel,
                        roomId: wall.roomId,
                        worldX: doorWorldX,
                        worldY: floor.elevation,
                        worldZ: doorWorldZ,
                        progress: initProg,
                        swingSign,
                        singlePivot: doorPivot,
                        slideTravel: 0,
                        rollMaxH: leafH,
                        closerArm,
                        ledMat: doorLedMat,
                      });
                    }
                  }
                  wallGroup.add(opGroup);
                }
                cursor = end;
              });

              if (len - cursor > 0.04) {
                addWallSeg(len - cursor, wall.height, cursor + (len - cursor) / 2, wall.height / 2);
              }

              floorGroup.add(wallGroup);
            });
        }

        // 5. Intelligent 3D Industrial & Lab Equipment Assets
        sceneData.assets
          .filter((a) => a.floorId === floor.id && !a.hidden && a.installationDate <= timelineDate)
          .forEach((asset) => {
            if (!isLayerVisible(asset.layerId)) return;
            if (isOrgIsolation) {
              const matchesIsolatedType =
                asset.templateId === isolatedAssetType.templateId ||
                asset.archetype === isolatedAssetType.archetype;
              if (!matchesIsolatedType) return;
            } else if (isolatedIds.length > 0 && !isolatedIds.includes(asset.id)) {
              return;
            }

            const isLineFailAsset = activeLineHighlight?.failingAssetIds.includes(asset.id) ?? false;
            const isLineOkAsset = activeLineHighlight?.compliantAssetIds.includes(asset.id) ?? false;
            const isSel = selectedSet.has(`asset:${asset.id}`);
            let statusTint: string | null = null;
            if (isLineFailAsset) {
              statusTint = '#EF4444';
            } else if (isLineOkAsset) {
              statusTint = '#10B981';
            } else if (analyticsMetric === 'maintenance') {
              statusTint = asset.operationalStatus === 'maintenance-due' ? '#F59E0B' : '#16A34A';
            } else if (analyticsMetric === 'utilization') {
              statusTint = asset.utilizationPct >= 85 ? '#DC2626' : asset.utilizationPct >= 70 ? '#D97706' : '#16A34A';
            } else if (analyticsMetric === 'risk') {
              statusTint = asset.criticality === 'gmp-critical' ? '#DC2626' : asset.criticality === 'high' ? '#EA580C' : '#16A34A';
            }

            const mat = getMat(asset.materialId, asset.color);
            mat.clippingPlanes = clipPlanes;

            const assetGroup = buildProceduralEquipmentGroup(asset, mat, isSel, statusTint);
            assetGroup.position.set(asset.x, asset.y + 0.04, asset.z);
            assetGroup.rotation.set(asset.rotationX, asset.rotationY, asset.rotationZ);
            assetGroup.userData = { entityType: 'asset', entityId: asset.id, buildingId: bldg.id };

            const assetMatchesCategory = !isCategoryXray || doesAssetMatchCategory(asset, categoryFilter);

            if ((!isOrgIsolation && isWireframeAtX(asset.x)) || (isCategoryXray && !assetMatchesCategory)) {
              applyBlueprintWireframeToGroup(
                assetGroup,
                '#38BDF8',
                isCategoryXray && !assetMatchesCategory ? 0.09 : 0.16,
                clipPlanes
              );
            }

            const isVoiceHighlightedAsset = voiceHighlightIds.includes(asset.id);

            // Glowing beacon ring around matched assets during Voice Query, Org-Wide Isolation, Category X-Ray, OR Production Line Eligibility Check
            if (isVoiceHighlightedAsset || isOrgIsolation || isLineFailAsset || isLineOkAsset || (isCategoryXray && assetMatchesCategory)) {
              const beaconHex = isVoiceHighlightedAsset
                ? '#F59E0B'
                : isLineFailAsset
                  ? '#EF4444'
                  : isCategoryXray && assetMatchesCategory
                    ? categoryMeta.color
                    : '#10B981';
              const ringR = Math.max(asset.width, asset.depth) * 0.68 + 0.32;
              const ring = new THREE.Mesh(
                new THREE.RingGeometry(ringR - 0.12, ringR, 36),
                new THREE.MeshBasicMaterial({
                  color: beaconHex,
                  side: THREE.DoubleSide,
                  transparent: true,
                  opacity: 0.92,
                })
              );
              ring.rotation.x = -Math.PI / 2;
              ring.position.y = 0.04;
              assetGroup.add(ring);

              // Subtle vertical locator line above the asset
              const beaconPts = [
                new THREE.Vector3(0, asset.height + 0.15, 0),
                new THREE.Vector3(0, asset.height + 1.55, 0),
              ];
              const beaconLine = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(beaconPts),
                new THREE.LineBasicMaterial({ color: beaconHex, transparent: true, opacity: 0.78 })
              );
              assetGroup.add(beaconLine);

              const beaconDot = new THREE.Mesh(
                new THREE.SphereGeometry(0.16, 12, 12),
                new THREE.MeshBasicMaterial({ color: '#34D399' })
              );
              beaconDot.position.set(0, asset.height + 1.9, 0);
              assetGroup.add(beaconDot);
            }

            floorGroup.add(assetGroup);
            eng.assetGroupMap.set(asset.id, assetGroup);
          });

        // 6. Realistic 10-Part Industrial 4K CCTV Cameras & Architectural 16:9 FOV Frustum
        if (isLayerVisible('layer-cameras') && !isOrgIsolation) {
          sceneData.cameras
            .filter((c) => c.floorId === floor.id)
            .forEach((cam) => {
              const camGrp = new THREE.Group();
              camGrp.position.set(cam.position[0], cam.position[1], cam.position[2]);
              camGrp.lookAt(cam.target[0], cam.target[1], cam.target[2]);
              camGrp.userData = { entityType: 'camera', entityId: cam.id, buildingId: bldg.id };

              const isSel = selectedSet.has(`camera:${cam.id}`);
              const accentHex = isSel ? '#3B82F6' : '#10B981';

              const shellMat = new THREE.MeshStandardMaterial({
                color: isSel ? '#DBEAFE' : '#E2E8F0',
                roughness: 0.28,
                metalness: 0.58,
              });
              const darkAnodMat = new THREE.MeshStandardMaterial({
                color: '#181A22',
                roughness: 0.36,
                metalness: 0.72,
              });
              const steelMat = new THREE.MeshStandardMaterial({
                color: '#94A3B8',
                roughness: 0.22,
                metalness: 0.85,
              });
              const accentMat = new THREE.MeshStandardMaterial({
                color: accentHex,
                emissive: accentHex,
                emissiveIntensity: isSel ? 0.75 : 0.45,
                roughness: 0.25,
                metalness: 0.35,
              });

              // 1. Rear wall/ceiling mounting flange plate + 4 stainless bolts
              const mountFlange = new THREE.Mesh(
                new THREE.CylinderGeometry(0.105, 0.115, 0.028, 16),
                darkAnodMat
              );
              mountFlange.rotation.x = Math.PI / 2;
              mountFlange.position.set(0, 0.075, -0.34);
              camGrp.add(mountFlange);

              for (let bi = 0; bi < 4; bi++) {
                const ang = (bi * Math.PI) / 2 + Math.PI / 4;
                const bolt = new THREE.Mesh(
                  new THREE.CylinderGeometry(0.011, 0.011, 0.014, 8),
                  steelMat
                );
                bolt.rotation.x = Math.PI / 2;
                bolt.position.set(Math.cos(ang) * 0.078, 0.075 + Math.sin(ang) * 0.078, -0.324);
                camGrp.add(bolt);
              }

              // 2. Articulated gooseneck strut + ball-joint knuckle + locking collar
              const armStrut = new THREE.Mesh(
                new THREE.CylinderGeometry(0.022, 0.028, 0.21, 12),
                steelMat
              );
              armStrut.rotation.x = Math.PI / 2 + 0.32;
              armStrut.position.set(0, 0.042, -0.235);
              camGrp.add(armStrut);

              const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.044, 12, 12), darkAnodMat);
              knuckle.position.set(0, 0.008, -0.155);
              camGrp.add(knuckle);

              const lockRing = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.009, 8, 16), steelMat);
              lockRing.position.set(0, 0.008, -0.125);
              camGrp.add(lockRing);

              // 3. Weatherproof die-cast aluminum cylindrical camera body + cooling collar
              const mainBody = new THREE.Mesh(
                new THREE.CylinderGeometry(0.082, 0.092, 0.30, 18),
                shellMat
              );
              mainBody.rotation.x = Math.PI / 2;
              mainBody.position.set(0, 0, 0.02);
              camGrp.add(mainBody);

              const coolingBand = new THREE.Mesh(
                new THREE.CylinderGeometry(0.091, 0.091, 0.065, 18),
                darkAnodMat
              );
              coolingBand.rotation.x = Math.PI / 2;
              coolingBand.position.set(0, 0, -0.02);
              camGrp.add(coolingBand);

              // 4. Overhanging architectural glare sunshield hood
              const hood = new THREE.Mesh(
                new THREE.CylinderGeometry(
                  0.102,
                  0.106,
                  0.34,
                  16,
                  1,
                  true,
                  -Math.PI * 0.42,
                  Math.PI * 0.84
                ),
                shellMat
              );
              hood.rotation.x = Math.PI / 2;
              hood.position.set(0, 0.012, 0.045);
              hood.material = shellMat.clone();
              (hood.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
              camGrp.add(hood);

              // 5. Stepped matte-black optical lens barrel + metallic status bezel ring
              const lensBarrel = new THREE.Mesh(
                new THREE.CylinderGeometry(0.068, 0.078, 0.06, 20),
                darkAnodMat
              );
              lensBarrel.rotation.x = Math.PI / 2;
              lensBarrel.position.set(0, 0, 0.19);
              camGrp.add(lensBarrel);

              const bezelRing = new THREE.Mesh(
                new THREE.TorusGeometry(0.068, 0.0065, 10, 24),
                accentMat
              );
              bezelRing.position.set(0, 0, 0.218);
              camGrp.add(bezelRing);

              // 6. Multi-coated curved optical glass lens dome
              const glassLens = new THREE.Mesh(
                new THREE.SphereGeometry(0.045, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
                new THREE.MeshPhysicalMaterial({
                  color: '#0C1E38',
                  roughness: 0.04,
                  metalness: 0.12,
                  clearcoat: 1.0,
                  clearcoatRoughness: 0.04,
                  transmission: isSoftwareGl ? 0 : 0.35,
                  ior: 1.52,
                  reflectivity: 0.96,
                })
              );
              glassLens.rotation.x = Math.PI / 2;
              glassLens.position.set(0, 0, 0.195);
              camGrp.add(glassLens);

              // 7. 6-LED Infrared Night-Vision Ring + Live Status Indicator LED + PoE Cable Gland
              const irMat = new THREE.MeshStandardMaterial({
                color: '#7F1D1D',
                emissive: '#DC2626',
                emissiveIntensity: lightingMode === 'night' ? 1.15 : 0.3,
                roughness: 0.2,
              });
              for (let li = 0; li < 6; li++) {
                const a = (li * Math.PI * 2) / 6;
                const irLed = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 8), irMat);
                irLed.position.set(Math.cos(a) * 0.056, Math.sin(a) * 0.056, 0.216);
                camGrp.add(irLed);
              }

              const statusLed = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), accentMat);
              statusLed.position.set(0, -0.072, 0.155);
              camGrp.add(statusLed);

              const cableGland = new THREE.Mesh(
                new THREE.CylinderGeometry(0.016, 0.016, 0.08, 8),
                darkAnodMat
              );
              cableGland.rotation.z = Math.PI / 5;
              cableGland.position.set(0.025, -0.058, -0.14);
              camGrp.add(cableGland);

              // 8. Architectural 16:9 Rectangular FOV Frustum + Wireframe Optical Rays
              if (cam.visibleCone) {
                const frustLen = Math.min(8.5, Math.max(2.5, cam.coverageRadius * 0.58));
                const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * frustLen * 0.42;
                const halfW = halfH * 1.45;
                const z0 = 0.22;
                const z1 = z0 + frustLen;

                const fv = new Float32Array([
                  // Top face
                  0, 0, z0, -halfW, halfH, z1, halfW, halfH, z1,
                  // Bottom face
                  0, 0, z0, halfW, -halfH, z1, -halfW, -halfH, z1,
                  // Left face
                  0, 0, z0, -halfW, -halfH, z1, -halfW, halfH, z1,
                  // Right face
                  0, 0, z0, halfW, halfH, z1, halfW, -halfH, z1,
                ]);
                const frustGeo = new THREE.BufferGeometry();
                frustGeo.setAttribute('position', new THREE.BufferAttribute(fv, 3));
                const frustMesh = new THREE.Mesh(
                  frustGeo,
                  new THREE.MeshBasicMaterial({
                    color: accentHex,
                    transparent: true,
                    opacity: isSel ? 0.14 : 0.075,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                  })
                );
                camGrp.add(frustMesh);

                // Crisp wireframe boundary rays + far-plane frame
                const edgeVerts = new Float32Array([
                  0, 0, z0, -halfW, halfH, z1,
                  0, 0, z0, halfW, halfH, z1,
                  0, 0, z0, halfW, -halfH, z1,
                  0, 0, z0, -halfW, -halfH, z1,
                  -halfW, halfH, z1, halfW, halfH, z1,
                  halfW, halfH, z1, halfW, -halfH, z1,
                  halfW, -halfH, z1, -halfW, -halfH, z1,
                  -halfW, -halfH, z1, -halfW, halfH, z1,
                ]);
                const edgeGeo = new THREE.BufferGeometry();
                edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeVerts, 3));
                const edgeLines = new THREE.LineSegments(
                  edgeGeo,
                  new THREE.LineBasicMaterial({
                    color: accentHex,
                    transparent: true,
                    opacity: isSel ? 0.65 : 0.34,
                  })
                );
                camGrp.add(edgeLines);
              }

              floorGroup.add(camGrp);
            });
        }

        // (Flows, HVAC, and Network Trace are built in dedicated lightweight layer effects below so toggling them never rebuilds building geometry)

        // 8. Multi-Point Measurement Tape & Area Markers in 3D
        if (measurePoints.length > 0 && floor.id === activeFloorId) {
          const pts3 = measurePoints.map((p) => new THREE.Vector3(p.x, 0.18, p.z));
          const pinGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.32, 12);
          const pinMat = new THREE.MeshBasicMaterial({ color: '#F59E0B' });
          pts3.forEach((pt) => {
            const pin = new THREE.Mesh(pinGeo, pinMat);
            pin.position.copy(pt);
            floorGroup.add(pin);
          });
          if (pts3.length >= 2) {
            const lineGeo = new THREE.BufferGeometry().setFromPoints(pts3);
            const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#F59E0B' }));
            floorGroup.add(line);
          }
          if (pts3.length >= 3) {
            const closeGeo = new THREE.BufferGeometry().setFromPoints([pts3[pts3.length - 1], pts3[0]]);
            floorGroup.add(
              new THREE.Line(closeGeo, new THREE.LineBasicMaterial({ color: '#F59E0B', transparent: true, opacity: 0.55 }))
            );
          }
        }

        // 9. AI Copilot Proposed Action Ghost Previews
        if (floor.id === activeFloorId && pendingAIActions.length > 0) {
          pendingAIActions.forEach((act) => {
            if (act.type === 'create_room') {
              const w = act.width ?? 10;
              const d = act.depth ?? 8;
              const h = act.height ?? 3.6;
              const ghost = new THREE.Mesh(
                new THREE.BoxGeometry(w, h, d),
                new THREE.MeshBasicMaterial({ color: '#38BDF8', transparent: true, opacity: 0.24, depthWrite: false })
              );
              ghost.position.set((act.x ?? 4) + w / 2, h / 2, (act.z ?? 4) + d / 2);
              floorGroup.add(ghost);
            } else if (act.type === 'place_equipment') {
              const count = Math.min(6, Math.max(1, act.count ?? 1));
              for (let i = 0; i < count; i++) {
                const gx = (act.x ?? 6) + i * ((act.clearance ?? 1.2) + 1.8);
                const gz = act.z ?? 6;
                const ghost = new THREE.Mesh(
                  new THREE.BoxGeometry(1.8, 2.4, 1.8),
                  new THREE.MeshBasicMaterial({ color: '#38BDF8', wireframe: true })
                );
                ghost.position.set(gx, 1.2, gz);
                floorGroup.add(ghost);
              }
            }
          });
        }

      });
    });

    // Attach TransformControls to single selected asset ONLY in Design Mode with spatial.edit permission
    if (!isReadOnly && !isMultiBuilding && selected.length === 1 && selected[0].type === 'asset' && activeTool === 'select') {
      const targetObj = eng.assetGroupMap.get(selected[0].id);
      if (targetObj) {
        eng.transform.attach(targetObj);
      }
    } else {
      eng.transform.detach();
    }

    eng.requestRender();
  }, [
    sceneData,
    activeFloorId,
    activeBuildingId,
    activeRoomId,
    drillLevel,
    showAllFloors,
    renderStyle,
    categoryFilter,
    isReadOnly,
    selected,
    isolatedIds,
    isolatedAssetType,
    analyticsMetric,
    sectionCutEnabled,
    sectionCutHeight,
    sectionCutAxis,
    sectionCutFlipped,
    lightingMode,
    timelineDate,
    activeTool,
    pendingAIActions,
    measurePoints,
    activeLineHighlight,
    voiceHighlightIds,
  ]);

  // Independent 3D Flows Layer + Single InstancedMesh Animated Pulses (Toggling flows never rebuilds buildings!)
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    disposeObject3D(eng.flowsGroup);
    eng.flowsGroup.clear();
    eng.flowPulseInstancedMesh = null;
    eng.flowPulseTracks = [];

    const isOrgIsolation = isolatedAssetType !== null;
    const flowLayer = sceneData.layers.find((x) => x.id === 'layer-flows');
    const flowLayerVisible = flowLayer ? flowLayer.visible : true;

    if (!showFlows || !flowLayerVisible || isOrgIsolation) {
      eng.requestRender();
      return;
    }

    const isMultiBuilding = drillLevel === 'campus';
    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
    const buildingsToRender = isMultiBuilding
      ? sceneData.buildings
      : sceneData.buildings.filter((b) => b.id === activeBuildingId);
    const selectedSet = new Set(selected.map((s) => `${s.type}:${s.id}`));

    const pulseTracks: FlowPulseTrack[] = [];
    const pulseColors: string[] = [];
    const arrowGeoNormal = new THREE.ConeGeometry(0.15, 0.34, 8);
    const arrowGeoIso = new THREE.ConeGeometry(0.2, 0.42, 8);
    const upVec = new THREE.Vector3(0, 1, 0);

    buildingsToRender.forEach((bldg) => {
      const ox = isMultiBuilding ? bldg.originX : 0;
      const oz = isMultiBuilding ? bldg.originZ : 0;
      const bldgFloors =
        isMultiBuilding || showAllFloors || drillLevel === 'building'
          ? sceneData.floors.filter((f) => f.buildingId === bldg.id)
          : activeFl && activeFl.buildingId === bldg.id
            ? [activeFl]
            : [];

      bldgFloors.forEach((floor) => {
        const curExploded = storeRef.current.explodedFactor;
        const oy = floor.elevation + curExploded * floor.levelIndex * 5.2;
        const flFlows = sceneData.flows.filter((f) => {
          if (f.floorId !== floor.id || f.points.length < 2) return false;
          if (isolatedFlowId) return f.id === isolatedFlowId;
          return !hiddenFlowIds.includes(f.id);
        });
        if (flFlows.length === 0) return;

        const floorFlowGrp = new THREE.Group();
        floorFlowGrp.position.set(ox, oy, oz);
        floorFlowGrp.userData.decompFloor = { baseY: floor.elevation, levelIndex: floor.levelIndex };
        eng.flowsGroup.add(floorFlowGrp);

        flFlows.forEach((flow) => {
          const isIsolated = isolatedFlowId === flow.id;
          // Flush architectural floor-level illuminated flow strips (y = 0.045m) so flows NEVER pierce MAYA's body
          const pts = flow.points.map((p) => new THREE.Vector3(p.x, isIsolated ? 0.065 : 0.045, p.z));
          const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
          const tubeGeo = new THREE.TubeGeometry(
            curve,
            Math.max(14, Math.min(48, pts.length * 8)),
            isIsolated ? 0.068 : 0.046,
            6,
            false
          );
          const isSel = selectedSet.has(`flow:${flow.id}`);
          const tubeMat = new THREE.MeshStandardMaterial({
            color: isSel ? '#FFFFFF' : flow.color,
            emissive: flow.color,
            emissiveIntensity: isIsolated ? 1.15 : lightingMode === 'night' ? 0.85 : 0.42,
            roughness: 0.26,
            metalness: 0.22,
          });
          const mesh = new THREE.Mesh(tubeGeo, tubeMat);
          mesh.userData = { entityType: 'flow', entityId: flow.id, buildingId: bldg.id };
          floorFlowGrp.add(mesh);

          if (isIsolated) {
            const seq = computeFlowRoomSequence(flow, sceneData.rooms);
            seq.steps.forEach((st) => {
              const rm = sceneData.rooms.find((r) => r.id === st.roomId);
              if (!rm) return;
              const rimGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(rm.width - 0.14, 0.06, rm.depth - 0.14));
              const rim = new THREE.LineSegments(rimGeo, new THREE.LineBasicMaterial({ color: flow.color }));
              rim.position.set(rm.x + rm.width / 2, 0.08, rm.z + rm.depth / 2);
              floorFlowGrp.add(rim);

              const beacon = new THREE.Mesh(
                new THREE.CylinderGeometry(0.24, 0.3, 0.05, 12),
                new THREE.MeshBasicMaterial({ color: flow.color })
              );
              beacon.position.set(st.centerX, 0.05, st.centerZ);
              floorFlowGrp.add(beacon);
            });
          }

          if (animateFlows && flow.animated !== false) {
            const samples = sampleCurveWorld(curve, ox, floor.elevation, oz);
            const pulseCount = Math.min(4, Math.max(2, Math.round(curve.getLength() / 6.5)));
            for (let pIdx = 0; pIdx < pulseCount; pIdx++) {
              pulseTracks.push({
                samples,
                sampleCount: PULSE_SAMPLES,
                phase: pIdx / pulseCount,
                speed: 0.18 + (pIdx % 2) * 0.03,
                scale: isIsolated ? 0.95 : 0.72,
                levelIndex: floor.levelIndex,
              });
              pulseColors.push(flow.color);
            }
          }

          const last = pts[pts.length - 1];
          const prev = pts[pts.length - 2];
          const dir = new THREE.Vector3().subVectors(last, prev).normalize();
          const arrow = new THREE.Mesh(
            isIsolated ? arrowGeoIso : arrowGeoNormal,
            tubeMat
          );
          arrow.position.copy(last);
          arrow.quaternion.setFromUnitVectors(upVec, dir);
          floorFlowGrp.add(arrow);
        });
      });
    });

    if (pulseTracks.length > 0) {
      const pulseGeo = new THREE.SphereGeometry(0.11, 8, 8);
      const pulseMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
      const inst = new THREE.InstancedMesh(pulseGeo, pulseMat, pulseTracks.length);
      inst.frustumCulled = false;
      const initExp = storeRef.current.explodedFactor;
      for (let i = 0; i < pulseTracks.length; i++) {
        const tr = pulseTracks[i];
        const idx = Math.floor(tr.phase * (tr.sampleCount - 1)) * 3;
        _tmpVec3.set(
          tr.samples[idx],
          tr.samples[idx + 1] + initExp * tr.levelIndex * 5.2,
          tr.samples[idx + 2]
        );
        _tmpScale.setScalar(tr.scale);
        _tmpMat4.compose(_tmpVec3, _identityQuat, _tmpScale);
        inst.setMatrixAt(i, _tmpMat4);
        _tmpColor.set(pulseColors[i]).lerp(_tmpColor.clone().set('#FFFFFF'), 0.45);
        inst.setColorAt(i, _tmpColor);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      eng.flowsGroup.add(inst);
      eng.flowPulseInstancedMesh = inst;
      eng.flowPulseTracks = pulseTracks;
    }

    eng.requestRender();
  }, [
    showFlows,
    animateFlows,
    isolatedFlowId,
    hiddenFlowIds,
    isolatedAssetType,
    sceneData.flows,
    sceneData.rooms,
    sceneData.floors,
    sceneData.buildings,
    sceneData.layers,
    activeFloorId,
    activeBuildingId,
    drillLevel,
    showAllFloors,
    lightingMode,
    selected,
  ]);

  // Independent InstancedMesh 3D HVAC Ductwork & HEPA Diffuser Overlay (~12 draw calls, <2ms toggle!)
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    disposeObject3D(eng.hvacGroup);
    eng.hvacGroup.clear();

    const isOrgIsolation = isolatedAssetType !== null;
    if (!showHvacOverlay || isOrgIsolation) {
      eng.requestRender();
      return;
    }

    const isMultiBuilding = drillLevel === 'campus';
    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
    const buildingsToRender = isMultiBuilding
      ? sceneData.buildings
      : sceneData.buildings.filter((b) => b.id === activeBuildingId);
    const clipPlanes = sectionCutEnabled ? [eng.clippingPlane] : [];

    // Shared unit geometries + pooled materials across all visible floors
    const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    const unitFlexGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6);
    const supplyTrunkMat = new THREE.MeshStandardMaterial({
      color: '#0EA5E9',
      metalness: 0.58,
      roughness: 0.28,
      emissive: '#0284C7',
      emissiveIntensity: 0.25,
      clippingPlanes: clipPlanes,
    });
    const returnTrunkMat = new THREE.MeshStandardMaterial({
      color: '#F59E0B',
      metalness: 0.45,
      roughness: 0.38,
      emissive: '#B45309',
      emissiveIntensity: 0.18,
      clippingPlanes: clipPlanes,
    });
    const branchMatCache = new Map<string, THREE.MeshStandardMaterial>();
    const getBranchMat = (hex: string) => {
      let m = branchMatCache.get(hex);
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          color: hex,
          metalness: 0.52,
          roughness: 0.3,
          emissive: hex,
          emissiveIntensity: 0.22,
          clippingPlanes: clipPlanes,
        });
        branchMatCache.set(hex, m);
      }
      return m;
    };

    interface DiffuserInstance {
      x: number;
      y: number;
      z: number;
      statusHex: string;
      positivePressure: boolean;
    }
    const diffGeo = new THREE.BoxGeometry(0.62, 0.12, 0.62);
    const diffMat = new THREE.MeshStandardMaterial({
      color: '#E4E4E7',
      metalness: 0.65,
      roughness: 0.25,
      clippingPlanes: clipPlanes,
    });
    const collarGeo = new THREE.BoxGeometry(0.68, 0.04, 0.68);
    const collarMat = new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      roughness: 0.3,
      clippingPlanes: clipPlanes,
    });
    const coneGeo = new THREE.ConeGeometry(0.28, 0.55, 8, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      clippingPlanes: clipPlanes,
    });

    const initExplodedHvac = storeRef.current.explodedFactor;

    buildingsToRender.forEach((bldg) => {
      const ox = isMultiBuilding ? bldg.originX : 0;
      const oz = isMultiBuilding ? bldg.originZ : 0;
      const bldgFloors =
        isMultiBuilding || showAllFloors || drillLevel === 'building'
          ? sceneData.floors.filter((f) => f.buildingId === bldg.id)
          : activeFl && activeFl.buildingId === bldg.id
            ? [activeFl]
            : [];

      bldgFloors.forEach((floor) => {
        const floorHvacRooms = sceneData.rooms.filter((r) => {
          if (r.floorId !== floor.id) return false;
          if (hvacAhuFilter === 'all') return true;
          return getEffectiveRoomHvac(r).ahuId === hvacAhuFilter;
        });
        if (floorHvacRooms.length === 0) return;

        // Per-floor HVAC group allows O(1) floor decomposition without rebuilding any ducts or diffusers
        const floorHvacGrp = new THREE.Group();
        floorHvacGrp.position.set(
          ox,
          floor.elevation + initExplodedHvac * floor.levelIndex * 5.2,
          oz
        );
        floorHvacGrp.userData.decompFloor = {
          baseY: floor.elevation,
          levelIndex: floor.levelIndex,
        };
        eng.hvacGroup.add(floorHvacGrp);

        const ductY = Math.max(2.5, floor.height - 0.36);
        const returnY = Math.max(2.3, ductY - 0.26);
        const spineZ = Number((floor.depth * 0.5).toFixed(2));
        const floorDiffusers: DiffuserInstance[] = [];

        let minRoomX = Infinity;
        let maxRoomX = -Infinity;
        for (const r of floorHvacRooms) {
          const cx = r.x + r.width / 2;
          if (cx < minRoomX) minRoomX = cx;
          if (cx > maxRoomX) maxRoomX = cx;
        }
        minRoomX = Math.max(1.2, minRoomX);
        maxRoomX = Math.min(floor.width - 1.2, maxRoomX);
        const trunkLen = Math.max(2.0, maxRoomX - minRoomX + 1.2);
        const trunkCenterX = (minRoomX + maxRoomX) / 2;

        const supplyTrunk = new THREE.Mesh(unitBoxGeo, supplyTrunkMat);
        supplyTrunk.scale.set(trunkLen, 0.26, 0.42);
        supplyTrunk.position.set(trunkCenterX, ductY, spineZ - 0.26);
        floorHvacGrp.add(supplyTrunk);

        const returnTrunk = new THREE.Mesh(unitBoxGeo, returnTrunkMat);
        returnTrunk.scale.set(trunkLen, 0.22, 0.34);
        returnTrunk.position.set(trunkCenterX, returnY, spineZ + 0.28);
        floorHvacGrp.add(returnTrunk);

        floorHvacRooms.forEach((rm) => {
          const cfg = getEffectiveRoomHvac(rm);
          const ahuColor = getAhuColor(cfg.ahuId);
          const rcx = rm.x + rm.width / 2;
          const rcz = rm.z + rm.depth / 2;
          const bMat = getBranchMat(ahuColor);

          const branchLen = Math.abs(rcz - (spineZ - 0.26));
          if (branchLen > 0.35) {
            const branch = new THREE.Mesh(unitBoxGeo, bMat);
            branch.scale.set(0.24, 0.18, branchLen);
            branch.position.set(rcx, ductY, (rcz + (spineZ - 0.26)) / 2);
            floorHvacGrp.add(branch);
          }

          const retLen = Math.abs(rcz - (spineZ + 0.28));
          if (retLen > 0.35) {
            const retBranch = new THREE.Mesh(unitBoxGeo, returnTrunkMat);
            retBranch.scale.set(0.18, 0.14, retLen);
            retBranch.position.set(rcx + 0.34, returnY, (rcz + (spineZ + 0.28)) / 2);
            floorHvacGrp.add(retBranch);
          }

          const diffCount = Math.max(1, Math.min(8, cfg.diffuserCount));
          const cols =
            diffCount <= 2
              ? diffCount
              : Math.ceil(Math.sqrt(diffCount * (rm.width / Math.max(1, rm.depth))));
          const rows = Math.max(1, Math.ceil(diffCount / Math.max(1, cols)));
          const statusHex =
            cfg.systemStatus === 'alarm'
              ? '#F43F5E'
              : cfg.systemStatus === 'maintenance'
                ? '#F59E0B'
                : cfg.systemStatus === 'standby'
                  ? '#71717A'
                  : ahuColor;

          let placed = 0;
          for (let rIdx = 0; rIdx < rows && placed < diffCount; rIdx++) {
            for (let cIdx = 0; cIdx < cols && placed < diffCount; cIdx++) {
              const dx = rm.x + ((cIdx + 0.5) / cols) * rm.width;
              const dz = rm.z + ((rIdx + 0.5) / rows) * rm.depth;
              floorDiffusers.push({
                x: dx,
                y: ductY,
                z: dz,
                statusHex,
                positivePressure: cfg.targetPressurePa >= 0,
              });

              const dDist = Math.hypot(dx - rcx, dz - rcz);
              if (dDist > 0.35) {
                const flex = new THREE.Mesh(unitFlexGeo, bMat);
                flex.scale.set(1, dDist, 1);
                flex.position.set((dx + rcx) / 2, ductY - 0.04, (dz + rcz) / 2);
                flex.rotation.z = Math.PI / 2;
                flex.rotation.y = -Math.atan2(dz - rcz, dx - rcx);
                floorHvacGrp.add(flex);
              }
              placed++;
            }
          }
        });

        if (floorDiffusers.length > 0) {
          const count = floorDiffusers.length;
          const diffInst = new THREE.InstancedMesh(diffGeo, diffMat, count);
          const collarInst = new THREE.InstancedMesh(collarGeo, collarMat, count);
          const coneInst = new THREE.InstancedMesh(coneGeo, coneMat, count);
          diffInst.frustumCulled = false;
          collarInst.frustumCulled = false;
          coneInst.frustumCulled = false;

          _tmpScale.set(1, 1, 1);
          for (let i = 0; i < count; i++) {
            const d = floorDiffusers[i];
            _tmpVec3.set(d.x, d.y - 0.16, d.z);
            _tmpMat4.compose(_tmpVec3, _identityQuat, _tmpScale);
            diffInst.setMatrixAt(i, _tmpMat4);

            _tmpVec3.set(d.x, d.y - 0.22, d.z);
            _tmpMat4.compose(_tmpVec3, _identityQuat, _tmpScale);
            collarInst.setMatrixAt(i, _tmpMat4);
            _tmpColor.set(d.statusHex);
            collarInst.setColorAt(i, _tmpColor);

            _tmpVec3.set(d.x, d.y - 0.54, d.z);
            _tmpMat4.compose(_tmpVec3, d.positivePressure ? _flipQuatX : _identityQuat, _tmpScale);
            coneInst.setMatrixAt(i, _tmpMat4);
            _tmpColor.set(d.positivePressure ? '#38BDF8' : '#F59E0B');
            coneInst.setColorAt(i, _tmpColor);
          }

          diffInst.instanceMatrix.needsUpdate = true;
          collarInst.instanceMatrix.needsUpdate = true;
          if (collarInst.instanceColor) collarInst.instanceColor.needsUpdate = true;
          coneInst.instanceMatrix.needsUpdate = true;
          if (coneInst.instanceColor) coneInst.instanceColor.needsUpdate = true;

          diffInst.computeBoundingSphere();
          collarInst.computeBoundingSphere();
          coneInst.computeBoundingSphere();

          floorHvacGrp.add(diffInst, collarInst, coneInst);
        }
      });
    });

    eng.requestRender();
  }, [
    showHvacOverlay,
    hvacAhuFilter,
    isolatedAssetType,
    sceneData.rooms,
    sceneData.floors,
    sceneData.buildings,
    activeFloorId,
    activeBuildingId,
    drillLevel,
    showAllFloors,
    sectionCutEnabled,
    sectionCutHeight,
    sectionCutAxis,
    sectionCutFlipped,
  ]);

  // Independent 3D IT Network Port & Cable Trace Overlay
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    disposeObject3D(eng.traceGroup);
    eng.traceGroup.clear();
    eng.tracePulseInstancedMesh = null;
    eng.tracePulseTracks = [];

    if (!activeNetworkTrace) {
      eng.requestRender();
      return;
    }

    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
    if (!activeFl) return;
    const bldg = sceneData.buildings.find((b) => b.id === activeFl.buildingId);
    const isMultiBuilding = drillLevel === 'campus' || isolatedAssetType !== null;
    const ox = isMultiBuilding ? bldg?.originX ?? 0 : 0;
    const oz = isMultiBuilding ? bldg?.originZ ?? 0 : 0;
    const oy = activeFl.elevation + storeRef.current.explodedFactor * activeFl.levelIndex * 5.2;

    const floorHops = activeNetworkTrace.hops.filter(
      (h) => !h.floorId || h.floorId === activeFl.id
    );
    const traceHops = floorHops.length > 0 ? floorHops : activeNetworkTrace.hops;
    const traceHex =
      activeNetworkTrace.status === 'error'
        ? '#F43F5E'
        : activeNetworkTrace.status === 'warning'
          ? '#F59E0B'
          : '#06B6D4';

    const trayY = Math.max(2.65, activeFl.height - 0.55);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: traceHex,
      emissive: traceHex,
      emissiveIntensity: 1.35,
      roughness: 0.2,
    });
    const riserMat = new THREE.MeshStandardMaterial({
      color: traceHex,
      emissive: traceHex,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.85,
    });

    const traceFloorGrp = new THREE.Group();
    traceFloorGrp.position.set(ox, oy, oz);
    traceFloorGrp.userData.decompFloor = {
      baseY: activeFl.elevation,
      levelIndex: activeFl.levelIndex,
    };
    eng.traceGroup.add(traceFloorGrp);

    const sphereGeo = new THREE.SphereGeometry(0.24, 12, 12);
    const ringGeo = new THREE.TorusGeometry(0.42, 0.04, 8, 22);
    const unitRiserGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 8);

    traceHops.forEach((hop) => {
      const baseY = hop.kind === 'user-node' ? 1.1 : 1.7;
      const beacon = new THREE.Mesh(sphereGeo, beaconMat);
      beacon.position.set(hop.x, baseY, hop.z);
      traceFloorGrp.add(beacon);

      const ring = new THREE.Mesh(ringGeo, riserMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(hop.x, 0.08, hop.z);
      traceFloorGrp.add(ring);

      const riserH = Math.max(0.4, trayY - baseY);
      const riser = new THREE.Mesh(unitRiserGeo, riserMat);
      riser.scale.set(1, riserH, 1);
      riser.position.set(hop.x, baseY + riserH / 2, hop.z);
      traceFloorGrp.add(riser);
    });

    if (traceHops.length >= 2) {
      const cablePts: THREE.Vector3[] = [];
      traceHops.forEach((hop, idx) => {
        const baseY = hop.kind === 'user-node' ? 1.1 : 1.7;
        if (idx === 0) cablePts.push(new THREE.Vector3(hop.x, baseY, hop.z));
        cablePts.push(new THREE.Vector3(hop.x, trayY, hop.z));
        if (idx === traceHops.length - 1) {
          cablePts.push(new THREE.Vector3(hop.x, baseY, hop.z));
        }
      });
      const curve = new THREE.CatmullRomCurve3(cablePts, false, 'catmullrom', 0.12);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(24, traceHops.length * 18), 0.075, 8, false),
        new THREE.MeshStandardMaterial({
          color: traceHex,
          emissive: traceHex,
          emissiveIntensity: 1.25,
          roughness: 0.18,
        })
      );
      traceFloorGrp.add(tube);

      const samples = sampleCurveWorld(curve, ox, activeFl.elevation, oz);
      const tracks: FlowPulseTrack[] = [];
      for (let pIdx = 0; pIdx < 4; pIdx++) {
        tracks.push({
          samples,
          sampleCount: PULSE_SAMPLES,
          phase: pIdx / 4,
          speed: 0.28,
          scale: 0.75,
          levelIndex: activeFl.levelIndex,
        });
      }
      const pulseInst = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.18, 8, 8),
        new THREE.MeshBasicMaterial({ color: '#FFFFFF' }),
        tracks.length
      );
      pulseInst.frustumCulled = false;
      pulseInst.computeBoundingSphere();
      eng.traceGroup.add(pulseInst);
      eng.tracePulseInstancedMesh = pulseInst;
      eng.tracePulseTracks = tracks;
    }

    eng.requestRender();
  }, [
    activeNetworkTrace,
    activeFloorId,
    sceneData.floors,
    sceneData.buildings,
    drillLevel,
    isolatedAssetType,
  ]);

  // Real-Time 3D Environmental Heatmap Overlay (Updates CanvasTexture in-place without rebuilding geometry)
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    if (heatmapMetric === 'none') {
      eng.heatmapGroup.visible = false;
      eng.requestRender();
      return;
    }

    eng.heatmapGroup.visible = true;
    const isOrgIsolation = isolatedAssetType !== null;
    const isMultiBuilding = drillLevel === 'campus' || isOrgIsolation;
    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
    const buildingsToRender = isMultiBuilding
      ? sceneData.buildings
      : sceneData.buildings.filter((b) => b.id === activeBuildingId);

    const visibleFloorIds = new Set<string>();

    buildingsToRender.forEach((bldg) => {
      const bldgFloors =
        isMultiBuilding || showAllFloors || drillLevel === 'building'
          ? sceneData.floors.filter((f) => f.buildingId === bldg.id)
          : activeFl && activeFl.buildingId === bldg.id
            ? [activeFl]
            : [];

      bldgFloors.forEach((floor) => {
        visibleFloorIds.add(floor.id);
        let entry = eng.heatmapCache.get(floor.id);
        if (!entry) {
          const canvas = document.createElement('canvas');
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;

          const geo = new THREE.PlaneGeometry(floor.width, floor.depth);
          const mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: heatmapOpacity,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.renderOrder = 12;
          eng.heatmapGroup.add(mesh);
          entry = { canvas, texture, mesh };
          eng.heatmapCache.set(floor.id, entry);
        }

        renderFloorHeatmapCanvas(
          entry.canvas,
          floor,
          sceneData.rooms,
          sensors,
          useTelemetryStore.getState().readings,
          heatmapMetric
        );
        entry.texture.needsUpdate = true;
        const mat = entry.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = heatmapOpacity;
        entry.mesh.visible = true;

        const ox = isMultiBuilding ? bldg.originX : 0;
        const oz = isMultiBuilding ? bldg.originZ : 0;
        const explodedOffset = storeRef.current.explodedFactor * floor.levelIndex * 5.2;
        entry.mesh.userData.decompFloor = {
          baseY: floor.elevation + 0.085,
          levelIndex: floor.levelIndex,
        };
        entry.mesh.position.set(
          ox + floor.width / 2,
          floor.elevation + explodedOffset + 0.085,
          oz + floor.depth / 2
        );
      });
    });

    eng.heatmapCache.forEach((entry, flId) => {
      if (!visibleFloorIds.has(flId)) {
        entry.mesh.visible = false;
      }
    });

    eng.requestRender();

    // Subscribe directly to telemetry readings ONLY while heatmap is active (avoids full Viewport3D re-renders)
    const unsub = useTelemetryStore.subscribe((state, prev) => {
      if (state.readings === prev.readings) return;
      eng.heatmapCache.forEach((entry, flId) => {
        if (!entry.mesh.visible) return;
        const fl = sceneData.floors.find((f) => f.id === flId);
        if (!fl) return;
        renderFloorHeatmapCanvas(entry.canvas, fl, sceneData.rooms, state.sensors, state.readings, heatmapMetric);
        entry.texture.needsUpdate = true;
      });
      eng.requestRender();
    });
    return unsub;
  }, [
    heatmapMetric,
    heatmapOpacity,
    sensors,
    sceneData.buildings,
    sceneData.floors,
    sceneData.rooms,
    activeFloorId,
    activeBuildingId,
    drillLevel,
    showAllFloors,
    isolatedAssetType,
  ]);

  // Zero-Rebuild O(N) Floor Decomposition Transform Effect (60fps smooth slider on mobile & desktop!)
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    const applyDecomp = (root: THREE.Object3D) => {
      root.traverse((obj) => {
        const floorMeta = obj.userData?.decompFloor as
          | { baseY: number; levelIndex: number }
          | undefined;
        if (floorMeta) {
          obj.position.y = floorMeta.baseY + explodedFactor * floorMeta.levelIndex * 5.2;
        }
        const riserMeta = obj.userData?.decompRiser as
          | { topElevation: number; topHeight: number; topLevelIndex: number }
          | undefined;
        if (riserMeta) {
          obj.visible = explodedFactor > 0.04;
          obj.scale.y =
            riserMeta.topElevation +
            explodedFactor * riserMeta.topLevelIndex * 5.2 +
            riserMeta.topHeight;
        }
      });
    };

    applyDecomp(eng.contentGroup);
    applyDecomp(eng.flowsGroup);
    applyDecomp(eng.hvacGroup);
    applyDecomp(eng.traceGroup);
    applyDecomp(eng.heatmapGroup);

    // Immediately reposition animated pulse beads to match new floor elevations
    const syncPulses = (inst: THREE.InstancedMesh | null, tracks: FlowPulseTrack[]) => {
      if (!inst || tracks.length === 0) return;
      for (let i = 0; i < tracks.length; i++) {
        const tr = tracks[i];
        const fIdx = tr.phase * (tr.sampleCount - 1);
        const i0 = Math.floor(fIdx);
        const i1 = Math.min(tr.sampleCount - 1, i0 + 1);
        const frac = fIdx - i0;
        const b0 = i0 * 3;
        const b1 = i1 * 3;
        const x = tr.samples[b0] + (tr.samples[b1] - tr.samples[b0]) * frac;
        const y =
          tr.samples[b0 + 1] +
          (tr.samples[b1 + 1] - tr.samples[b0 + 1]) * frac +
          explodedFactor * tr.levelIndex * 5.2;
        const z = tr.samples[b0 + 2] + (tr.samples[b1 + 2] - tr.samples[b0 + 2]) * frac;
        _tmpVec3.set(x, y, z);
        _tmpScale.setScalar(tr.scale);
        _tmpMat4.compose(_tmpVec3, _identityQuat, _tmpScale);
        inst.setMatrixAt(i, _tmpMat4);
      }
      inst.instanceMatrix.needsUpdate = true;
    };
    syncPulses(eng.flowPulseInstancedMesh, eng.flowPulseTracks);
    syncPulses(eng.tracePulseInstancedMesh, eng.tracePulseTracks);

    projectPinsRef.current(true);
    eng.requestRender();
  }, [explodedFactor]);

  // Compute Visible 3D Equipment & Room Sensor Indicator Anchors (Bioreactors, HPLCs, Skids, Rooms)
  const visibleSensorPins = useMemo(() => {
    if (!show3DSensorPins || sensors.length === 0) return [];
    const isOrgIsolation = isolatedAssetType !== null;
    const isMultiBuilding = drillLevel === 'campus' || isOrgIsolation;
    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);

    const floorSet = new Set<string>();
    const bldgMap = new Map(sceneData.buildings.map((b) => [b.id, b]));
    const floorMap = new Map(sceneData.floors.map((f) => [f.id, f]));

    if (isMultiBuilding) {
      sceneData.floors.forEach((f) => floorSet.add(f.id));
    } else if (showAllFloors || drillLevel === 'building') {
      sceneData.floors
        .filter((f) => f.buildingId === activeBuildingId)
        .forEach((f) => floorSet.add(f.id));
    } else if (activeFl) {
      floorSet.add(activeFl.id);
    }

    // Group sensors by host target on visible floors
    const grouped = new Map<
      string,
      {
        key: string;
        targetKind: 'asset' | 'room';
        targetId: string;
        targetName: string;
        targetCode: string;
        mainSensor: SensorDefinition;
        secondarySensors: SensorDefinition[];
        wx: number;
        wy: number;
        wz: number;
        priority: number;
      }
    >();

    sensors.forEach((s) => {
      if (!floorSet.has(s.floorId)) return;
      // Show equipment indicators always when pins enabled; show room indicators when environmental heatmap is active
      if (s.targetKind === 'room' && heatmapMetric === 'none') return;
      if (s.targetKind === 'room' && heatmapMetric !== 'none' && s.metric !== heatmapMetric) return;

      const key = `${s.targetKind}:${s.targetId}`;
      const fl = floorMap.get(s.floorId);
      const bldg = fl ? bldgMap.get(fl.buildingId) : null;
      const ox = isMultiBuilding ? bldg?.originX ?? 0 : 0;
      const oz = isMultiBuilding ? bldg?.originZ ?? 0 : 0;
      const explodedOffset = explodedFactor * (fl?.levelIndex ?? 0) * 5.2;
      const wy = (fl?.elevation ?? 0) + explodedOffset + s.y;

      const existing = grouped.get(key);
      if (!existing) {
        const lower = s.targetName.toLowerCase();
        const priority = lower.includes('bioreactor')
          ? 100
          : lower.includes('hplc')
            ? 95
            : lower.includes('chrom') || lower.includes('lyoph') || lower.includes('autoclave')
              ? 80
              : s.targetKind === 'asset'
                ? 60
                : 40;

        grouped.set(key, {
          key,
          targetKind: s.targetKind,
          targetId: s.targetId,
          targetName: s.targetName,
          targetCode: s.targetCode,
          mainSensor: s,
          secondarySensors: [],
          wx: ox + s.x,
          wy,
          wz: oz + s.z,
          priority,
        });
      } else {
        if (s.isMainSensor) {
          existing.secondarySensors.push(existing.mainSensor);
          existing.mainSensor = s;
        } else {
          existing.secondarySensors.push(s);
        }
      }
    });

    // Limit total simultaneous pins so viewport stays uncluttered and readable
    return Array.from(grouped.values())
      .sort((a, b) => b.priority - a.priority)
      .slice(0, isMultiBuilding ? 10 : 12);
  }, [
    show3DSensorPins,
    sensors,
    heatmapMetric,
    isolatedAssetType,
    drillLevel,
    showAllFloors,
    activeFloorId,
    activeBuildingId,
    sceneData.buildings,
    sceneData.floors,
    explodedFactor,
  ]);

  // Compute Floating 3D Architectural Room Number Pins (inspired by luxury cutaway floorplan HUD)
  const isolatedFlowObj = useMemo(
    () => (isolatedFlowId ? sceneData.flows.find((f) => f.id === isolatedFlowId) ?? null : null),
    [isolatedFlowId, sceneData.flows]
  );

  const isolatedFlowStepMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!isolatedFlowObj) return map;
    const seq = computeFlowRoomSequence(isolatedFlowObj, sceneData.rooms);
    seq.steps.forEach((st) => {
      if (!map.has(st.roomId)) map.set(st.roomId, st.stepOrder);
    });
    return map;
  }, [isolatedFlowObj, sceneData.rooms]);

  const visibleRoomPins = useMemo(() => {
    if (!showRoomPins || firstPersonMode || isolatedAssetType !== null) return [];
    const targetFloors =
      drillLevel === 'campus'
        ? sceneData.floors
        : showAllFloors
          ? sceneData.floors.filter((f) => f.buildingId === activeBuildingId)
          : sceneData.floors.filter((f) => f.id === activeFloorId);

    const floorMap = new Map(targetFloors.map((f) => [f.id, f]));
    const buildingMap = new Map(sceneData.buildings.map((b) => [b.id, b]));
    const singleFloorBuilding = targetFloors.length === 1 ? buildingMap.get(targetFloors[0].buildingId) : null;

    return sceneData.rooms
      .filter((r) => floorMap.has(r.floorId) && r.activeFromDate <= timelineDate)
      .map((r) => {
        const fl = floorMap.get(r.floorId)!;
        const bldg = buildingMap.get(fl.buildingId);
        const ox = drillLevel === 'campus' ? bldg?.originX ?? 0 : singleFloorBuilding ? 0 : bldg?.originX ?? 0;
        const oz = drillLevel === 'campus' ? bldg?.originZ ?? 0 : singleFloorBuilding ? 0 : bldg?.originZ ?? 0;
        const explodedOffset = explodedFactor * fl.levelIndex * 5.2;
        return {
          room: r,
          wx: ox + r.x + r.width / 2,
          wy: fl.elevation + explodedOffset + Math.min(2.6, r.height * 0.52),
          wz: oz + r.z + r.depth / 2,
          flowStep: isolatedFlowStepMap.get(r.id) ?? null,
        };
      });
  }, [
    showRoomPins,
    firstPersonMode,
    isolatedAssetType,
    drillLevel,
    showAllFloors,
    activeBuildingId,
    sceneData.buildings,
    sceneData.floors,
    sceneData.rooms,
    activeFloorId,
    explodedFactor,
    timelineDate,
    isolatedFlowStepMap,
  ]);

  // Pre-compute FMEA summaries for visible pins so rendering never scans incident lists on every frame
  const sensorPinFmeaMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getTargetFmeaSummary>>();
    if (!showFmeaIndicators) return map;
    for (const pin of visibleSensorPins) {
      map.set(
        pin.key,
        getTargetFmeaSummary(
          riskIncidents,
          pin.targetKind === 'room' ? 'room' : 'asset',
          pin.targetId
        )
      );
    }
    return map;
  }, [showFmeaIndicators, visibleSensorPins, riskIncidents]);

  const roomPinFmeaMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getTargetFmeaSummary>>();
    if (!showFmeaIndicators) return map;
    for (const rp of visibleRoomPins) {
      map.set(rp.room.id, getTargetFmeaSummary(riskIncidents, 'room', rp.room.id, true));
    }
    return map;
  }, [showFmeaIndicators, visibleRoomPins, riskIncidents]);

  const registerSensorPinDom = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) pinDomRefs.current.set(key, el);
    else pinDomRefs.current.delete(key);
  }, []);

  const handleToggleInspectPin = useCallback((key: string) => {
    setInspectedPinKey((prev) => (prev === key ? null : key));
  }, []);

  const handleOpenPinRisk = useCallback(
    (incidentId: string) => {
      openRiskModal({ mode: 'resolve', incidentId });
    },
    [openRiskModal]
  );

  // Project 3D sensor & architectural room pins with cached viewport size, camera dirty check, and 2D collision culling
  useEffect(() => {
    const projectAll = (force = false) => {
      const eng = engineRef.current;
      if (!eng) return;
      const { w, h } = viewportSizeRef.current;
      if (!w || !h) return;

      // Skip DOM work completely if camera projection*view matrix hasn't moved
      _projViewMat.multiplyMatrices(
        eng.activeCamera.projectionMatrix,
        eng.activeCamera.matrixWorldInverse
      );
      const elems = _projViewMat.elements;
      const last = lastCamProjRef.current;
      if (!force) {
        let changed = false;
        for (let i = 0; i < 16; i++) {
          if (Math.abs(elems[i] - last[i]) > 1e-5) {
            changed = true;
            break;
          }
        }
        if (!changed) return;
      }
      for (let i = 0; i < 16; i++) last[i] = elems[i];

      // Fast 2D AABB collision list so tags never overlap each other
      const placedBoxes: [number, number, number, number][] = [];
      const collides = (x1: number, y1: number, x2: number, y2: number) => {
        for (let i = 0; i < placedBoxes.length; i++) {
          const b = placedBoxes[i];
          if (x1 < b[2] && x2 > b[0] && y1 < b[3] && y2 > b[1]) return true;
        }
        return false;
      };

      visibleSensorPins.forEach((pin) => {
        const el = pinDomRefs.current.get(pin.key);
        if (!el) return;
        _projVec.set(pin.wx, pin.wy, pin.wz).project(eng.activeCamera);
        const visible = _projVec.z >= -1 && _projVec.z <= 1;
        if (!visible) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          return;
        }
        const px = (_projVec.x * 0.5 + 0.5) * w;
        const py = (-_projVec.y * 0.5 + 0.5) * h;
        const inBounds = px > 40 && px < w - 40 && py > 54 && py < h - 60;
        const bx1 = px - 68;
        const by1 = py - 32;
        const bx2 = px + 68;
        const by2 = py + 2;
        const show = inBounds && (inspectedPinKey === pin.key || !collides(bx1, by1, bx2, by2));
        if (show) placedBoxes.push([bx1, by1, bx2, by2]);
        el.style.opacity = show ? '1' : '0';
        el.style.pointerEvents = show ? 'auto' : 'none';
        if (show) {
          el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%)`;
        }
      });

      visibleRoomPins.forEach((rp) => {
        const el = roomPinDomRefs.current.get(rp.room.id);
        if (!el) return;
        _projVec.set(rp.wx, rp.wy, rp.wz).project(eng.activeCamera);
        const visible = _projVec.z >= -1 && _projVec.z <= 1;
        if (!visible) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          return;
        }
        const px = (_projVec.x * 0.5 + 0.5) * w;
        const py = (-_projVec.y * 0.5 + 0.5) * h;
        const inBounds = px > 44 && px < w - 58 && py > 56 && py < h - 64;
        const bx1 = px - 46;
        const by1 = py - 15;
        const bx2 = px + 46;
        const by2 = py + 15;
        const show = inBounds && (spotlightRoomId === rp.room.id || !collides(bx1, by1, bx2, by2));
        if (show) placedBoxes.push([bx1, by1, bx2, by2]);
        el.style.opacity = show ? '1' : '0';
        el.style.pointerEvents = show ? 'auto' : 'none';
        if (show) {
          el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
        }
      });
    };

    projectPinsRef.current = projectAll;
    projectAll(true);
  }, [visibleSensorPins, visibleRoomPins, inspectedPinKey, spotlightRoomId]);

  // Derived breadcrumbs for Spatial Drill-Down HUD
  const activeBuilding = sceneData.buildings.find((b) => b.id === activeBuildingId);
  const activeFloor = sceneData.floors.find((f) => f.id === activeFloorId);
  const activeDept = activeDepartmentId
    ? sceneData.hierarchy.find((h) => h.id === activeDepartmentId)
    : null;
  const activeRoom = activeRoomId ? sceneData.rooms.find((r) => r.id === activeRoomId) : null;
  const activeAsset =
    selected.length === 1 && selected[0].type === 'asset'
      ? sceneData.assets.find((a) => a.id === selected[0].id)
      : null;

  const isolatedMatches = useMemo(() => {
    if (!isolatedAssetType) return [];
    return sceneData.assets.filter(
      (a) =>
        a.templateId === isolatedAssetType.templateId ||
        a.archetype === isolatedAssetType.archetype
    );
  }, [sceneData.assets, isolatedAssetType]);

  const jumpToIsolatedInstance = (assetId: string) => {
    const asset = sceneData.assets.find((a) => a.id === assetId);
    if (!asset) return;
    const fl = sceneData.floors.find((f) => f.id === asset.floorId);
    const bldg = fl ? sceneData.buildings.find((b) => b.id === fl.buildingId) : null;
    const ox = bldg?.originX ?? 0;
    const oz = bldg?.originZ ?? 0;
    const ey = (fl?.elevation ?? 0) + asset.y;
    flyToCamera(
      [ox + asset.x + 4.8, ey + Math.max(3.6, asset.height + 2.2), oz + asset.z + 4.8],
      [ox + asset.x, ey + asset.height / 2, oz + asset.z],
      42
    );
  };

  const renderStyleOptions: { id: RenderStyle; label: string; title: string }[] = [
    { id: 'realistic', label: 'PBR', title: 'Studio PBR Shaded View' },
    { id: 'blueprint-split', label: 'Split', title: 'Twin Split Cutaway View' },
    { id: 'wireframe', label: 'X-Ray', title: 'X-Ray CAD Wireframe View' },
  ];

  const inspectedPin = useMemo(
    () => (inspectedPinKey ? visibleSensorPins.find((p) => p.key === inspectedPinKey) ?? null : null),
    [inspectedPinKey, visibleSensorPins]
  );

  const inspectedAssetObj = useMemo(
    () =>
      inspectedPin?.targetKind === 'asset'
        ? sceneData.assets.find((a) => a.id === inspectedPin.targetId) ?? null
        : null,
    [inspectedPin, sceneData.assets]
  );

  const inspectedRoomObj = useMemo(
    () =>
      inspectedPin?.targetKind === 'room'
        ? sceneData.rooms.find((r) => r.id === inspectedPin.targetId) ?? null
        : null,
    [inspectedPin, sceneData.rooms]
  );

  const handleDrillStepBack = () => {
    if (drillLevel === 'asset') {
      if (activeRoom) drillInto('room', activeRoom.id);
      else if (activeFloor) drillInto('floor', activeFloor.id);
      else drillInto('campus');
    } else if (drillLevel === 'room') {
      if (activeFloor) drillInto('floor', activeFloor.id);
      else drillInto('campus');
    } else if (drillLevel === 'department') {
      if (activeFloor) drillInto('floor', activeFloor.id);
      else drillInto('campus');
    } else if (drillLevel === 'floor') {
      if (activeBuilding) drillInto('building', activeBuilding.id);
      else drillInto('campus');
    } else if (drillLevel === 'building') {
      drillInto('campus');
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none touch-none">
      <div ref={mountRef} className="w-full h-full touch-none" />

      {/* Live 3D Snap-to-Grid / Snap-to-Wall / Door & Window Drop-Zone Placement Indicator */}
      {!firstPersonMode &&
        (activeTool === 'place-object' ||
          activeTool === 'place-door' ||
          activeTool === 'place-window' ||
          activeTool === 'draw-wall' ||
          activeTool === 'draw-room') &&
        placeSnapBadge && (
          <div
            className={`pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-xl border text-[11px] font-mono font-bold shadow-xl ${
              placeSnapBadge.isWarning
                ? 'bg-rose-950/95 border-rose-400 text-rose-200'
                : placeSnapBadge.isWall
                  ? 'bg-cyan-950/95 border-cyan-400 text-cyan-200'
                  : 'bg-violet-950/95 border-violet-400 text-violet-200'
            }`}
          >
            {placeSnapBadge.label}
          </div>
        )}

      {/* Physical QR Scan Instant Highlight HUD */}
      {qrHighlight && !firstPersonMode && (
        <div className="absolute top-14 left-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-[#111116]/95 border border-emerald-500/60 shadow-xl text-[11px] text-zinc-100 max-w-[calc(100%-24px)]">
          <span className="font-mono font-bold text-emerald-400 shrink-0">QR LOCK</span>
          <span className="text-zinc-500">·</span>
          <span className="font-mono font-semibold text-amber-400 shrink-0">{qrHighlight.code}</span>
          <span className="truncate text-zinc-200 max-w-[180px] sm:max-w-[260px]">{qrHighlight.label}</span>
          <button
            type="button"
            onClick={() => openEntityInfo({ type: qrHighlight.entityType, id: qrHighlight.entityId })}
            className="px-2 py-0.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold shrink-0 cursor-pointer"
          >
            Info
          </button>
          <button
            type="button"
            onClick={() => setViewMode('2d')}
            className="px-2 py-0.5 rounded-lg border border-zinc-700 hover:border-cyan-400 text-zinc-200 font-medium shrink-0 cursor-pointer"
          >
            2D Plan
          </button>
          <button
            type="button"
            onClick={clearQrHighlight}
            className="p-0.5 rounded text-zinc-400 hover:text-white cursor-pointer shrink-0"
            aria-label="Clear QR highlight"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* MAYA Global Voice Command Highlight Banner */}
      {voiceHighlightBanner && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-[#111118]/95 border border-amber-400/70 shadow-2xl text-[11px] text-zinc-100 max-w-[calc(100%-24px)]">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-white truncate">{voiceHighlightBanner.title}</div>
            <div className="text-[10px] text-amber-300/90 truncate">{voiceHighlightBanner.subtitle}</div>
          </div>
          {voiceHighlightIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const firstId = voiceHighlightIds[0];
                const isRoom = sceneData.rooms.some((r) => r.id === firstId);
                focusEntity({ type: isRoom ? 'room' : 'asset', id: firstId });
              }}
              className="px-2 py-0.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold shrink-0 cursor-pointer"
            >
              Focus
            </button>
          )}
          <button
            type="button"
            onClick={clearVoiceHighlight}
            className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer shrink-0"
            title="Clear Voice Highlight"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Unified Non-Overlapping Top HUD Bar: Spatial Breadcrumb (left) + View Controls (right) */}
      <div className="absolute top-2.5 inset-x-2.5 z-20 flex items-center justify-between gap-2 pointer-events-none">
        {/* Left: Spatial 3D Drill-Down Breadcrumb HUD (hidden during Walk Mode) */}
        {!firstPersonMode ? (
          <div className="pointer-events-auto flex items-center gap-0.5 px-1.5 py-1 rounded-xl bg-white/95 dark:bg-[#131319]/95 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 shadow-lg text-[11px] min-w-0 overflow-x-auto no-scrollbar">
            {drillLevel !== 'campus' && (
              <button
                onClick={handleDrillStepBack}
                className="flex items-center justify-center p-1 rounded-lg bg-zinc-100 dark:bg-[#1C1C26] text-zinc-700 dark:text-zinc-200 hover:bg-violet-600 hover:text-white transition-colors shrink-0 mr-0.5 cursor-pointer"
                title="Step Back Up One Spatial Level"
              >
                <ArrowLeft className="w-3 h-3" />
              </button>
            )}

            <button
              onClick={() => drillInto('campus')}
              className={`flex items-center gap-1 px-1.5 py-1 rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                drillLevel === 'campus'
                  ? 'bg-violet-600 text-white font-semibold'
                  : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
              title="Zoom out to Full Campus"
            >
              <Globe className="w-3 h-3" />
              <span className="hidden sm:inline">Campus</span>
            </button>

            {activeBuilding && (
              <>
                <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
                <button
                  onClick={() => drillInto('building', activeBuilding.id)}
                  className={`flex items-center gap-1 px-1.5 py-1 rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    drillLevel === 'building'
                      ? 'bg-violet-600 text-white font-semibold'
                      : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  title={activeBuilding.name}
                >
                  <Building2 className="w-3 h-3" />
                  <span>{activeBuilding.code}</span>
                </button>
              </>
            )}

            {activeFloor && (
              <>
                <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
                <button
                  onClick={() => drillInto('floor', activeFloor.id)}
                  className={`flex items-center gap-1 px-1.5 py-1 rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    drillLevel === 'floor'
                      ? 'bg-violet-600 text-white font-semibold'
                      : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  title={activeFloor.name}
                >
                  <Layers className="w-3 h-3" />
                  <span>{activeFloor.code}</span>
                </button>
              </>
            )}

            {activeDept && (
              <>
                <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0 hidden md:block" />
                <button
                  onClick={() => drillInto('department', activeDept.id)}
                  className={`hidden md:inline-flex px-1.5 py-1 rounded-lg whitespace-nowrap shrink-0 max-w-[130px] truncate transition-colors cursor-pointer ${
                    drillLevel === 'department'
                      ? 'bg-violet-600 text-white font-semibold'
                      : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  title={activeDept.name}
                >
                  {activeDept.name}
                </button>
              </>
            )}

            {activeRoom && (
              <>
                <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
                <button
                  onClick={() => drillInto('room', activeRoom.id)}
                  className={`px-1.5 py-1 rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    drillLevel === 'room'
                      ? 'bg-violet-600 text-white font-semibold'
                      : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  title={`${activeRoom.code} · ${activeRoom.name}`}
                >
                  {activeRoom.code}
                </button>
              </>
            )}

            {activeAsset && drillLevel === 'asset' && (
              <>
                <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
                <span className="px-1.5 py-0.5 rounded-lg bg-amber-500 text-zinc-950 font-mono font-semibold whitespace-nowrap shrink-0">
                  {activeAsset.assetId}
                </span>
              </>
            )}

            <button
              onClick={() => {
                const url = buildDirectUrl();
                navigator.clipboard?.writeText(url).catch(() => {});
                showToast('Direct deep-link URL copied to clipboard', 'success');
              }}
              className="ml-0.5 pl-1.5 border-l border-zinc-200 dark:border-zinc-800 p-1 text-zinc-500 hover:text-violet-500 shrink-0 cursor-pointer"
              title="Copy Direct URL to current 3D view & layer"
            >
              <Link2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div />
        )}

        {/* Right: Compact Room Pins + Day/Night + Render Style Switcher */}
        <div className="pointer-events-auto flex items-center gap-1 shrink-0">
          {!firstPersonMode && (
            <button
              onClick={() => setShowRoomPins(!showRoomPins)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-xl border shadow-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                showRoomPins
                  ? 'bg-[#151520] border-violet-500/60 text-violet-300'
                  : 'bg-white/95 dark:bg-[#131319]/95 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-violet-500'
              }`}
              title="Toggle Floating 3D Room Number Pins & Walk-Inside Cards"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Rooms</span>
            </button>
          )}

          <button
            onClick={toggleLightingMode}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-xl border shadow-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              lightingMode === 'night'
                ? 'bg-[#151520] border-amber-500/70 text-amber-300'
                : 'bg-white/95 dark:bg-[#131319]/95 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-violet-500'
            }`}
            title={lightingMode === 'night' ? 'Night Architectural Spotlights (click for Daylight)' : 'Daylight Mode (click for Night Spotlights)'}
          >
            {lightingMode === 'night' ? (
              <>
                <Moon className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden lg:inline">Night</span>
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span className="hidden lg:inline">Day</span>
              </>
            )}
          </button>

          {!firstPersonMode && (
            <div className="hidden sm:flex items-center gap-0.5 p-0.5 rounded-xl bg-white/95 dark:bg-[#131319]/95 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 shadow-lg text-[11px]">
              {renderStyleOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setRenderStyle(opt.id)}
                  title={opt.title}
                  className={`px-2 py-1 rounded-lg font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    renderStyle === opt.id
                      ? opt.id === 'realistic'
                        ? 'bg-violet-600 text-white'
                        : 'bg-amber-500 text-zinc-950 font-semibold'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active IT Port & Cable Trace HUD (3D Mode) */}
      {activeNetworkTrace && !firstPersonMode && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-14 left-1/2 -translate-x-1/2 z-30 flex flex-wrap sm:flex-nowrap items-center gap-2 px-3.5 py-2 rounded-2xl border border-cyan-500/60 bg-[#0D1320] text-cyan-50 shadow-2xl text-xs max-w-[94%]"
        >
          <Route className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <div className="font-bold truncate">{activeNetworkTrace.title}</div>
            <div className="text-[10.5px] font-mono text-cyan-300/90 truncate">
              {activeNetworkTrace.subtitle} · {activeNetworkTrace.hops.length} hops
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            <button
              type="button"
              onClick={() => startNetworkTrace(activeNetworkTrace, '2d')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold cursor-pointer"
            >
              <MapIcon className="w-3 h-3" />
              2D Trace
            </button>
            <button
              type="button"
              onClick={() => openDataCenterPage(activeNetworkTrace.targetAssetId ?? null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold cursor-pointer"
            >
              <Server className="w-3 h-3" />
              IT Designer
            </button>
            <button
              type="button"
              onClick={clearNetworkTrace}
              className="p-1 rounded-lg hover:bg-white/15 cursor-pointer"
              title="Clear IT Network Trace"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Category X-Ray filter is now integrated into the unified bottom-center HUD dock (zero overlap) */}

      {/* Right-Edge Vertical Architectural Level & Floor Decomposition Rail (SITE / ALL / L1 / L0 + Explode) */}
      {!firstPersonMode && (() => {
        const bldgFloors = sceneData.floors
          .filter((f) => f.buildingId === activeBuildingId)
          .sort((a, b) => b.levelIndex - a.levelIndex);
        if (bldgFloors.length === 0) return null;
        const isSiteMode = drillLevel === 'campus';
        const isAllFloorsMode = !isSiteMode && showAllFloors;
        return (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1 p-1.5 rounded-2xl bg-[#111117] border border-zinc-800 shadow-2xl">
            <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 px-1 pb-0.5">
              LVL
            </span>
            <button
              type="button"
              onClick={() => drillInto('campus')}
              className={`min-w-[38px] h-7 px-2 rounded-xl font-mono text-[10px] font-bold transition-colors cursor-pointer ${
                isSiteMode
                  ? 'bg-violet-500 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
              title="All Buildings & Full Site Overview"
            >
              SITE
            </button>
            <button
              type="button"
              onClick={() => {
                drillInto('building', activeBuildingId);
                setShowAllFloors(true);
              }}
              className={`min-w-[38px] h-7 px-2 rounded-xl font-mono text-[10px] font-bold transition-colors cursor-pointer ${
                isAllFloorsMode
                  ? 'bg-amber-400 text-zinc-950 shadow-md'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
              title="Show All Floors of Active Building"
            >
              ALL
            </button>
            <div className="w-6 h-px bg-zinc-800 my-0.5" />
            {bldgFloors.map((fl) => {
              const isAct = !isSiteMode && !showAllFloors && fl.id === activeFloorId;
              const shortLbl = fl.code ? fl.code.replace(/^FL-?/i, 'L') : `L${fl.levelIndex + 1}`;
              return (
                <button
                  key={fl.id}
                  type="button"
                  onClick={() => {
                    setShowAllFloors(false);
                    if (drillLevel === 'campus') {
                      drillInto('floor', fl.id);
                    } else {
                      setActiveFloor(fl.id);
                    }
                  }}
                  className={`min-w-[38px] h-7 px-2 rounded-xl font-mono text-[10.5px] font-bold transition-colors cursor-pointer ${
                    isAct
                      ? 'bg-white text-zinc-950 shadow-md'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                  title={`${fl.name} (Elev ${fl.elevation}m)`}
                >
                  {shortLbl}
                </button>
              );
            })}
            <div className="w-6 h-px bg-zinc-800 my-0.5" />
            <span className="text-[8px] font-mono uppercase tracking-wider text-zinc-500">
              DEC
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowDecompPopover((v) => !v)}
                className={`min-w-[38px] h-7 px-1.5 rounded-xl font-mono text-[9.5px] font-bold tabular-nums transition-colors cursor-pointer touch-manipulation ${
                  explodedFactor > 0.04 || showDecompPopover
                    ? 'bg-amber-500 text-zinc-950 shadow-md'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
                title="Floor Decomposition Slider (Smooth 0–100% Exploded Stack)"
              >
                {explodedFactor > 0.04 ? `${Math.round(explodedFactor * 100)}%` : 'EXP'}
              </button>

              {showDecompPopover && (
                <div className="absolute right-12 bottom-0 w-56 rounded-2xl bg-[#111118] border border-amber-500/50 shadow-2xl p-3 text-zinc-100 z-30">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      Floor Decomp
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-[11px] font-bold tabular-nums text-white">
                        {Math.round(explodedFactor * 100)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowDecompPopover(false)}
                        className="p-0.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                        title="Close"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={explodedFactor}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val > 0.02 && !showAllFloors && drillLevel !== 'campus') {
                        setShowAllFloors(true);
                      }
                      setExplodedFactor(val);
                    }}
                    className="w-full h-2 accent-amber-500 cursor-pointer touch-pan-x"
                  />

                  <div className="grid grid-cols-4 gap-1 mt-2">
                    {[0, 0.35, 0.7, 1].map((preset) => {
                      const activePreset = Math.abs(explodedFactor - preset) < 0.05;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            if (preset > 0 && !showAllFloors && drillLevel !== 'campus') {
                              setShowAllFloors(true);
                            }
                            setExplodedFactor(preset);
                          }}
                          className={`py-1 rounded-lg font-mono text-[10px] font-bold tabular-nums transition-colors cursor-pointer touch-manipulation ${
                            activePreset
                              ? 'bg-amber-500 text-zinc-950'
                              : 'bg-zinc-800/90 text-zinc-300 hover:bg-zinc-700'
                          }`}
                        >
                          {Math.round(preset * 100)}%
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 3D Projected Architectural Room Number Pins with FMEA Status Indicators */}
      {showRoomPins && visibleRoomPins.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {visibleRoomPins.map((rp) => {
            const isActiveSpot = spotlightRoomId === rp.room.id;
            const hasFlowStep = rp.flowStep !== null;
            const fmea = roomPinFmeaMap.get(rp.room.id) ?? null;
            const fmeaBadgeCls =
              fmea?.level === 'critical'
                ? 'bg-rose-500 text-white'
                : fmea?.level === 'high'
                  ? 'bg-amber-400 text-zinc-950'
                  : fmea?.level === 'medium'
                    ? 'bg-violet-500 text-white'
                    : fmea?.level === 'mitigated'
                      ? 'bg-emerald-500 text-zinc-950'
                      : '';
            return (
              <div
                key={rp.room.id}
                ref={(el) => {
                  if (el) roomPinDomRefs.current.set(rp.room.id, el);
                  else roomPinDomRefs.current.delete(rp.room.id);
                }}
                style={{ opacity: 0, willChange: 'transform' }}
                className="absolute top-0 left-0 flex items-center gap-1"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSpotlightRoomId(isActiveSpot ? null : rp.room.id);
                    setInspectedPinKey(null);
                  }}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-mono font-bold shadow-xl border transition-transform hover:scale-105 cursor-pointer ${
                    isActiveSpot
                      ? 'bg-white text-zinc-950 border-white ring-2 ring-amber-400/70'
                      : fmea?.level === 'critical'
                        ? 'bg-[#1A1116] text-rose-100 border-rose-500/80'
                        : fmea?.level === 'high'
                          ? 'bg-[#191611] text-amber-100 border-amber-400/75'
                          : hasFlowStep
                            ? 'bg-[#151520] text-amber-200 border-amber-400/80'
                            : lightingMode === 'night'
                              ? 'bg-[#121219] text-amber-100 border-amber-400/45 hover:border-amber-300'
                              : 'bg-[#13131A] text-zinc-100 border-zinc-700 hover:border-violet-400'
                  }`}
                  title={`${rp.room.code} · ${rp.room.name} (${(rp.room.width * rp.room.depth).toFixed(1)} m²) — Click for details & Walk Inside`}
                >
                  {hasFlowStep && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-zinc-950 text-[9.5px] font-extrabold -ml-1">
                      {rp.flowStep}
                    </span>
                  )}
                  <span>{rp.room.code || rp.room.name.slice(0, 6)}</span>
                </button>
                {fmea && fmea.level !== 'clear' && fmea.worstIncident && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openRiskModal({ mode: 'resolve', incidentId: fmea.worstIncident!.id });
                    }}
                    className={`px-1.5 py-0.5 rounded-md text-[9.5px] font-mono font-bold tabular-nums shadow-lg cursor-pointer hover:brightness-110 ${fmeaBadgeCls}`}
                    title={`FMEA ${fmea.shortLabel} (${fmea.openCount} active): ${fmea.worstIncident.title} — Click to open FMEA resolution`}
                  >
                    {fmea.shortLabel}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Sleek Matte-Obsidian Room Spotlight Card (positioned cleanly above bottom dock with zero overlap) */}
      {!firstPersonMode && spotlightRoomId && (() => {
        const rm = sceneData.rooms.find((r) => r.id === spotlightRoomId);
        if (!rm) return null;
        const areaSqm = rm.width * rm.depth;
        const areaSqft = Math.round(areaSqm * 10.7639);
        const fl = sceneData.floors.find((f) => f.id === rm.floorId);
        const roomAssetCount = sceneData.assets.filter((a) => a.roomId === rm.id).length;
        const roomFlowStep = isolatedFlowStepMap.get(rm.id) ?? null;
        const rmHvac = getEffectiveRoomHvac(rm);
        const rmFmea = getTargetFmeaSummary(riskIncidents, 'room', rm.id, true);

        return (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 w-[440px] max-w-[calc(100%-24px)] rounded-2xl bg-[#111117] border border-zinc-700/80 shadow-[0_24px_60px_rgba(0,0,0,0.75)] p-3.5 text-zinc-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  <span>{fl?.name || 'Active Floor'}</span>
                  <span>·</span>
                  <span className="text-amber-300">{rm.environmental.cleanroomGrade}</span>
                  <span>·</span>
                  <span className="text-cyan-300">{rmHvac.ahuId} · {rmHvac.hepaClass}</span>
                  {roomFlowStep !== null && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                      Flow #{roomFlowStep}
                    </span>
                  )}
                  {rmFmea.level !== 'clear' && rmFmea.worstIncident && (
                    <button
                      type="button"
                      onClick={() => openRiskModal({ mode: 'resolve', incidentId: rmFmea.worstIncident!.id })}
                      className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                        rmFmea.level === 'critical'
                          ? 'bg-rose-500/25 text-rose-300 border border-rose-500/50'
                          : rmFmea.level === 'high'
                            ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}
                    >
                      FMEA {rmFmea.shortLabel}
                    </button>
                  )}
                </div>
                <div className="flex items-baseline gap-2.5 mt-1">
                  <span className="text-xl font-bold font-mono tracking-tight text-white tabular-nums">
                    {rm.code}
                  </span>
                  <span className="text-sm font-semibold text-zinc-200 truncate">{rm.name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-[11px] font-mono tabular-nums text-zinc-400">
                  <span>
                    <strong className="text-zinc-100">{areaSqm.toFixed(1)} m²</strong> ({areaSqft.toLocaleString()} ft²)
                  </span>
                  <span>·</span>
                  <span className="text-emerald-400">
                    {rmHvac.targetPressurePa >= 0 ? '+' : ''}
                    {rmHvac.targetPressurePa} Pa
                  </span>
                  <span>·</span>
                  <span className="text-cyan-300">{rmHvac.airChangesPerHour} ACH</span>
                  <span>·</span>
                  <span>{rmHvac.supplyTempC.toFixed(1)}°C</span>
                  <span>·</span>
                  <span>{roomAssetCount} assets</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSpotlightRoomId(null)}
                className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer shrink-0"
                title="Close Room Spotlight"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setSpotlightRoomId(null);
                  walkInsideRoom(rm.id);
                }}
                className="flex-1 min-w-[105px] flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-[11px] font-bold tracking-wide uppercase transition-colors cursor-pointer"
              >
                <Footprints className="w-3.5 h-3.5" />
                Walk
              </button>
              <button
                type="button"
                onClick={() => {
                  selectEntity({ type: 'room', id: rm.id });
                  setShowHvacOverlay(true);
                  setActiveDockSubject('hvac');
                  setRightTab('properties');
                  setRightPanelOpen(true);
                  setSpotlightRoomId(null);
                }}
                className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-zinc-950 border border-cyan-500/40 text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                title="Inspect & Edit Room HVAC & Ductwork"
              >
                <Wind className="w-3.5 h-3.5" />
                HVAC
              </button>
              <button
                type="button"
                onClick={() => {
                  openEntityInfo({ type: 'room', id: rm.id });
                  setSpotlightRoomId(null);
                }}
                className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                title="Open Room SOPs, Identification, Related Devices & Sensors"
              >
                <Info className="w-3.5 h-3.5" />
                Info
              </button>
              <button
                type="button"
                onClick={() => {
                  openEntityInfo({ type: 'room', id: rm.id }, { autoEligibility: true });
                  setSpotlightRoomId(null);
                }}
                className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                title="Run GMP Room Eligibility & Qualification Check"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Eligibility
              </button>
              <button
                type="button"
                onClick={() => {
                  drillInto('room', rm.id);
                  setSpotlightRoomId(null);
                }}
                className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-violet-600 text-zinc-100 text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
              >
                <Focus className="w-3.5 h-3.5" />
                Focus
              </button>
              <button
                type="button"
                onClick={() => {
                  openResourceSchedulingModal(rm.id);
                  setSpotlightRoomId(null);
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-700 hover:border-violet-400 text-zinc-200 text-xs font-semibold transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                title="Schedule Personnel & Equipment in this Zone"
              >
                <CalendarClock className="w-3.5 h-3.5 text-violet-400" />
                <span>Schedule</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  openDashboard({ tab: 'trends', roomId: rm.id });
                  setSpotlightRoomId(null);
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-700 hover:border-amber-400 text-zinc-200 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                title="Open Live Room Telemetry"
              >
                <Activity className="w-3.5 h-3.5 text-amber-400" />
              </button>
            </div>
          </div>
        );
      })()}

      {/* Floating Multi-Axis Section Cut Bar with Instant Reset (hidden during Walk / VR so walls & banners stay clear) */}
      {sectionCutEnabled && !firstPersonMode && !vrSessionActive && (
        <div className="absolute top-16 right-3 z-20 px-3 py-2.5 rounded-2xl bg-white dark:bg-[#131319] border border-violet-500/50 shadow-2xl flex flex-col gap-2 w-64 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5 text-violet-500" />
              Section Cut ({sectionCutAxis.toUpperCase()})
            </span>
            <button
              onClick={resetSectionCut}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-[#1E1E28] hover:bg-violet-600 hover:text-white text-zinc-700 dark:text-zinc-200 font-medium transition-colors"
              title="Reset & Disable Section Cut"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
          <div className="flex items-center gap-1">
            {(['y', 'x', 'z'] as const).map((ax) => (
              <button
                key={ax}
                onClick={() => {
                  const defaultVal =
                    ax === 'y'
                      ? Number(((activeFloor?.height ?? 4) * 0.55).toFixed(1))
                      : ax === 'x'
                        ? Number(((activeFloor?.width ?? 30) * 0.5).toFixed(1))
                        : Number(((activeFloor?.depth ?? 20) * 0.5).toFixed(1));
                  setSectionCut(true, defaultVal, ax, sectionCutFlipped);
                }}
                className={`flex-1 py-1 rounded-lg font-mono uppercase font-semibold transition-colors ${
                  sectionCutAxis === ax
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-100 dark:bg-[#1C1C26] text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {ax} Axis
              </button>
            ))}
            <button
              onClick={() => setSectionCut(true, sectionCutHeight, sectionCutAxis, !sectionCutFlipped)}
              className={`px-2 py-1 rounded-lg font-medium transition-colors ${
                sectionCutFlipped
                  ? 'bg-amber-500 text-zinc-950 font-semibold'
                  : 'bg-zinc-100 dark:bg-[#1C1C26] text-zinc-600 dark:text-zinc-300'
              }`}
              title="Flip Clipping Direction"
            >
              Flip
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.2}
              max={
                sectionCutAxis === 'y'
                  ? Math.max(6, (activeFloor?.height ?? 4) + 1)
                  : sectionCutAxis === 'x'
                    ? activeFloor?.width ?? 36
                    : activeFloor?.depth ?? 24
              }
              step={0.1}
              value={sectionCutHeight}
              onChange={(e) => setSectionCut(true, Number(e.target.value), sectionCutAxis, sectionCutFlipped)}
              className="flex-1 accent-violet-500"
            />
            <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-300 w-11 text-right">
              {sectionCutHeight.toFixed(1)}m
            </span>
          </div>
        </div>
      )}

      {/* Unified Non-Overlapping Top-Center Banner Stack (VR Immersion + Walkthrough Strip + Org Isolation + Eligibility Highlight) */}
      {(firstPersonMode || vrSessionActive || isolatedAssetType || activeLineHighlight) && (
        <div className="absolute top-3 sm:top-14 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1.5 max-w-[calc(100%-24px)] pointer-events-none">
          {vrSessionActive && (
            <div className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-[#0C1520]/95 border border-cyan-500/60 text-cyan-50 text-[11px] shadow-2xl overflow-x-auto max-w-full">
              <span className="flex items-center gap-1.5 font-semibold text-cyan-300 whitespace-nowrap shrink-0">
                <Glasses className="w-3.5 h-3.5" />
                {vrMode === 'webxr' ? 'WebXR VR Active' : 'VR Immersion Walk'}
              </span>
              <span className="hidden md:inline text-cyan-700">|</span>
              <span className="hidden md:inline font-mono text-[10px] text-cyan-100/80 whitespace-nowrap">
                {vrMode === 'webxr'
                  ? 'Headset Tracked · Thumbstick Walk'
                  : 'Drag to Turn Head · WASD / Joystick Walk'}
              </span>
              {vrMode !== 'webxr' && (
                <>
                  <span className="text-cyan-800">|</span>
                  <button
                    type="button"
                    onClick={() =>
                      setWalkCameraMode((m) => (m === 'first-person' ? 'third-person' : 'first-person'))
                    }
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      walkCameraMode === 'third-person'
                        ? 'bg-violet-600 text-white'
                        : 'bg-zinc-800 text-cyan-200 hover:bg-zinc-700'
                    }`}
                    title="Toggle 1st-Person Eye View vs 3rd-Person MAYA Character (V)"
                  >
                    <User className="w-3 h-3" />
                    {walkCameraMode === 'third-person' ? '3rd Person · MAYA' : '1st Person'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVrStereoSplit((v) => !v)}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      vrStereoSplit
                        ? 'bg-cyan-500 text-zinc-950'
                        : 'bg-zinc-800 text-cyan-200 hover:bg-zinc-700'
                    }`}
                    title="Toggle Side-by-Side Stereoscopic VR Preview"
                  >
                    {vrStereoSplit ? 'Stereo SBS On' : 'Stereo Eyes'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={requestVrToggle}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <X className="w-3 h-3" /> Exit VR
              </button>
            </div>
          )}

          {firstPersonMode && !vrSessionActive && (
            <div className="pointer-events-auto flex items-center justify-between sm:justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-2xl bg-[#111116]/95 border border-violet-500/50 text-zinc-100 text-[10.5px] sm:text-[11px] shadow-2xl max-w-[calc(100vw-16px)]">
              <span className="flex items-center gap-1 font-semibold text-violet-300 whitespace-nowrap shrink-0">
                <Footprints className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Walk Mode</span>
                <span className="sm:hidden">Walk</span>
              </span>
              <span className="hidden lg:inline text-zinc-600">|</span>
              <span className="hidden lg:inline font-mono text-[10px] text-zinc-300 whitespace-nowrap">
                WASD / Joystick · Space Jump · V Camera
              </span>
              <span className="hidden sm:inline text-zinc-600">|</span>
              <button
                type="button"
                onClick={() =>
                  setWalkCameraMode((m) => (m === 'first-person' ? 'third-person' : 'first-person'))
                }
                className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-lg text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  walkCameraMode === 'third-person'
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                }`}
                title="Toggle 1st-Person Eye View vs 3rd-Person MAYA Character (V)"
              >
                <User className="w-3 h-3" />
                <span className="hidden sm:inline">
                  {walkCameraMode === 'third-person' ? '3rd Person · MAYA' : '1st Person'}
                </span>
                <span className="sm:hidden">{walkCameraMode === 'third-person' ? '3P' : '1P'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !useMayaStore.getState().isGowned;
                  useMayaStore.getState().setGowned(next, 'Walkthrough Quick PPE');
                  engineRef.current?.walkAvatar.mayaController?.setGowned(next);
                  storeRef.current.showToast(
                    next ? 'Full Cleanroom Gown ON' : 'Standard Uniform ON',
                    'info'
                  );
                }}
                className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-lg text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  mayaIsGowned
                    ? 'bg-cyan-500/25 border border-cyan-400/60 text-cyan-200'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
                title={
                  mayaIsGowned
                    ? 'MAYA is wearing Full Sterile Cleanroom Gown (Click to De-Gown)'
                    : 'MAYA is in Standard Uniform (Click or visit Gowning Room PAL to Gown)'
                }
              >
                <ShieldCheck className="w-3 h-3 text-cyan-400" />
                <span className="hidden sm:inline">{mayaIsGowned ? 'Gowned' : 'Uniform'}</span>
                <span className="sm:hidden">{mayaIsGowned ? 'Gown' : 'PPE'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowNavMesh(!showNavMesh)}
                className={`px-1.5 sm:px-2 py-0.5 rounded-lg text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  showNavMesh
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
                title="Toggle Walkable NavMesh Overlay"
              >
                <span className="hidden sm:inline">{showNavMesh ? 'NavMesh On' : 'NavMesh'}</span>
                <span className="sm:hidden">Nav</span>
              </button>
              <button
                type="button"
                onClick={() => setFirstPersonTabletVisible(!firstPersonTabletVisible)}
                className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-lg bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 text-zinc-200 text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                title={firstPersonTabletVisible ? 'Hide Walk Field Pad' : 'Show Walk Field Pad'}
              >
                {firstPersonTabletVisible ? <EyeOff className="w-3 h-3" /> : <Tablet className="w-3 h-3" />}
                <span className="hidden sm:inline">
                  {firstPersonTabletVisible ? 'Hide Pad' : 'Field Pad'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFirstPersonMode(false)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <X className="w-3 h-3" />
                <span>Exit</span>
              </button>
            </div>
          )}

          {!firstPersonMode && isolatedAssetType && (
            <div className="pointer-events-auto px-3.5 py-2 rounded-2xl bg-[#131319] text-zinc-100 border border-violet-500/60 shadow-2xl flex flex-wrap items-center gap-2 text-xs max-w-full">
              <div className="flex items-center gap-1.5">
                <Focus className="w-4 h-4 text-violet-400 shrink-0" />
                <span className="font-semibold text-violet-400">Isolation:</span>
                <span className="font-medium text-white">{isolatedAssetType.label}</span>
                <span className="font-mono text-[10.5px] text-zinc-400">
                  {isolatedAssetType.count} units · {isolatedAssetType.buildingsCount} bldg · {isolatedAssetType.floorsCount} fl
                </span>
              </div>

              <div className="hidden sm:flex items-center gap-1 flex-wrap">
                {isolatedMatches.slice(0, 6).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => jumpToIsolatedInstance(m.id)}
                    className="px-2 py-0.5 rounded-lg bg-[#1D1D26] border border-zinc-700 hover:border-amber-400 font-mono text-[10px] text-zinc-200 transition-colors cursor-pointer"
                    title={`Fly to ${m.name} (${m.assetId})`}
                  >
                    {m.assetId}
                  </button>
                ))}
                {isolatedMatches.length > 6 && (
                  <span className="text-[10px] font-mono text-zinc-400">+{isolatedMatches.length - 6}</span>
                )}
              </div>

              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => {
                    const url = buildDirectUrl({ isolateType: isolatedAssetType.templateId });
                    navigator.clipboard?.writeText(url).catch(() => {});
                    showToast('Copied direct URL for this org-wide isolation view', 'success');
                  }}
                  className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-violet-400 cursor-pointer"
                  title="Copy Direct Isolation URL"
                >
                  <Link2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={clearIsolation}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] font-medium cursor-pointer"
                >
                  <X className="w-3 h-3" /> Exit
                </button>
              </div>
            </div>
          )}

          {!firstPersonMode && activeLineHighlight && (
            <div
              className={`pointer-events-auto flex items-center gap-2.5 px-3.5 py-2 rounded-2xl border shadow-2xl text-xs max-w-full ${
                activeLineHighlight.eligible
                  ? 'bg-emerald-950/95 border-emerald-500/70 text-emerald-100'
                  : 'bg-rose-950/95 border-rose-500/70 text-rose-100'
              }`}
            >
              {activeLineHighlight.eligible ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <div className="min-w-0 truncate">
                <span className="font-extrabold uppercase tracking-wide mr-1.5">
                  {activeLineHighlight.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}
                </span>
                <span className="font-semibold">{activeLineHighlight.lineName}</span>
                {!activeLineHighlight.eligible && (
                  <span className="ml-1.5 text-[11px] opacity-85">
                    ({activeLineHighlight.blockingCount} blocking)
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => openGmpModal({ tab: 'lines', lineId: activeLineHighlight.lineId })}
                className="rounded-xl bg-white/15 hover:bg-white/25 px-2.5 py-1 text-[11px] font-bold shrink-0 cursor-pointer"
              >
                Details
              </button>
              <button
                type="button"
                onClick={clearLineHighlight}
                className="p-1 rounded-lg hover:bg-white/15 shrink-0 cursor-pointer"
                title="Clear Eligibility Highlight"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3D Projected Compact Non-Overlapping Sensor Beacon Chips with FMEA Indicators (Local Telemetry Subscribers) */}
      {show3DSensorPins && visibleSensorPins.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {visibleSensorPins.map((pin) => (
            <Viewport3DSensorPinChip
              key={pin.key}
              pin={pin}
              isInspected={inspectedPinKey === pin.key}
              fmea={sensorPinFmeaMap.get(pin.key) ?? null}
              onToggleInspect={handleToggleInspectPin}
              onOpenRisk={handleOpenPinRisk}
              registerDom={registerSensorPinDom}
            />
          ))}
        </div>
      )}

      {/* Focused Single-Object 3D & Live Telemetry Inspection Dialog (Opaque Charcoal, Zero WebGL Blur, Pinch-Protected) */}
      {inspectedPin && (
        <div
          ref={focusedInspectorRef}
          className="absolute top-16 left-3 z-30 w-[364px] max-w-[calc(100%-24px)] rounded-3xl bg-white dark:bg-[#13131A] border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181822] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setInspectedPinKey(null)}
                className="p-1.5 rounded-xl bg-white dark:bg-[#22222F] border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-violet-500 hover:text-violet-500 transition-colors shrink-0 cursor-pointer"
                title="Back to 3D Floor View"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <div className="min-w-0">
                <div className="text-[10.5px] font-mono text-violet-600 dark:text-violet-400 truncate">
                  {inspectedPin.targetCode} · Focused 3D Inspector
                </div>
                <div className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                  {inspectedPin.targetName}
                </div>
              </div>
            </div>
            <button
              onClick={() => setInspectedPinKey(null)}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0 cursor-pointer"
              title="Close Inspector"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3.5 space-y-3">
            <Viewport3DInspectedPinBody
              inspectedAssetObj={inspectedAssetObj}
              inspectedRoomObj={inspectedRoomObj}
              mainSensor={inspectedPin.mainSensor}
              secondarySensors={inspectedPin.secondarySensors}
            />

            {/* Action Buttons: Equipment Info (SOPs & History) + Live Trends & Tags + New Tab */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  openEntityInfo({
                    type: inspectedPin.targetKind === 'asset' ? 'asset' : 'room',
                    id: inspectedPin.targetId,
                  });
                  setInspectedPinKey(null);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold transition-colors cursor-pointer"
              >
                <Info className="w-3.5 h-3.5" />
                {inspectedPin.targetKind === 'asset' ? 'Equipment Info' : 'Room Info'}
              </button>
              <button
                type="button"
                onClick={() => {
                  openDashboard({
                    tab: 'trends',
                    assetId: inspectedPin.targetKind === 'asset' ? inspectedPin.targetId : null,
                    roomId: inspectedPin.targetKind === 'room' ? inspectedPin.targetId : null,
                    sensorId: inspectedPin.mainSensor.id,
                  });
                  setInspectedPinKey(null);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5" />
                Live Trends
              </button>
              <a
                href={buildTelemetryTabUrl({
                  tab: 'trends',
                  assetId: inspectedPin.targetKind === 'asset' ? inspectedPin.targetId : undefined,
                  roomId: inspectedPin.targetKind === 'room' ? inspectedPin.targetId : undefined,
                  sensorId: inspectedPin.mainSensor.id,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#1C1C26] hover:border-amber-500 text-zinc-700 dark:text-zinc-200 transition-colors"
                title="Open Detailed Telemetry in New Tab"
              >
                <ExternalLink className="w-3.5 h-3.5 text-amber-500" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* UNIFIED NON-OVERLAPPING BOTTOM-CENTER HUD DOCK (Exclusive Single-Subject Accordion: X-Ray | Flows | HVAC | Sensors | FMEA) */}
      {!firstPersonMode && (() => {
        const visibleFlows =
          showAllFloors || drillLevel === 'campus'
            ? sceneData.flows
            : sceneData.flows.filter((f) => f.floorId === activeFloorId);
        const activeFloorRooms = sceneData.rooms.filter((r) =>
          showAllFloors || drillLevel === 'campus' ? true : r.floorId === activeFloorId
        );
        const activeFmeaIncidents = riskIncidents
          .filter((i) => i.status === 'open' || i.status === 'investigating')
          .sort((a, b) => b.rpn - a.rpn);
        const criticalFmeaCount = activeFmeaIncidents.filter((i) => i.rpn >= 200).length;
        const highFmeaCount = activeFmeaIncidents.filter((i) => i.rpn >= 100 && i.rpn < 200).length;

        return (
          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 w-[min(96%,560px)] pointer-events-none">
            {/* Selected Door / Window Inline Quick Editor (Change Type, Size, Sill, Position, Delete) */}
            {!spotlightRoomId && (
              <div className="pointer-events-auto">
                <OpeningQuickBar isDark={canvasBackdrop === 'dark'} />
              </div>
            )}

            {/* Contextual Action Bar (always stacked cleanly ABOVE the dock — never overlaps) */}
            {!spotlightRoomId && activeTool !== 'select' && (
              <div className="pointer-events-none px-3 py-1.5 rounded-xl bg-violet-600 text-white text-[11px] font-medium shadow-lg text-center">
                {activeTool === 'place-object' && 'Click floor in 3D to place selected equipment'}
                {activeTool === 'paint-material' && 'Click any room floor, wall, or equipment to paint material'}
                {activeTool === 'place-camera' && 'Click floor to place new camera'}
                {activeTool === 'place-door' && 'Hover & click any highlighted wall drop zone to place door'}
                {activeTool === 'place-window' && 'Hover & click any highlighted wall drop zone to place window'}
                {activeTool === 'measure' && 'Click two points on the floor to measure distance'}
                {activeTool === 'draw-wall' &&
                  (wallChainAnchor
                    ? 'Wall chain active — click next point to continue · Press Esc or Right-Click to stop'
                    : 'Click floor to start drawing continuous 3D walls · Press Esc to stop')}
                {activeTool === 'draw-room' && 'Click two corners on the 3D floor to create a room with automatic walls'}
                {activeTool === 'draw-flow' &&
                  'Switch to 2D or Split View to draft multi-point flow routes with precision'}
              </div>
            )}

            {!spotlightRoomId && selected.length === 1 && selected[0].type === 'camera' && (
              <button
                type="button"
                onClick={() => openLiveCamera(selected[0].id)}
                className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-xl transition-colors cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                Open LiveCam &amp; Credentials
              </button>
            )}

            {!spotlightRoomId && activeAsset && (
              <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openEntityInfo({ type: 'asset', id: activeAsset.id })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#131319] hover:bg-violet-600 text-white border border-violet-500/50 text-[11px] font-semibold shadow-xl transition-colors cursor-pointer"
                >
                  <Info className="w-3.5 h-3.5 text-violet-300" />
                  Device Info &amp; SOPs
                </button>
                {(activeAsset.category === 'IT & Data Center' || activeAsset.rackConfig) && (
                  <button
                    type="button"
                    onClick={() => openRackDesigner(activeAsset.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl gradian-violet-amber text-white text-[11px] font-semibold shadow-xl hover:opacity-95 transition-opacity cursor-pointer"
                  >
                    <Server className="w-3.5 h-3.5" />
                    42U Rack Designer
                  </button>
                )}
              </div>
            )}

            {!spotlightRoomId && !activeAsset && selected.length === 1 && selected[0].type === 'room' && (
              <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openEntityInfo({ type: 'room', id: selected[0].id })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#131319] hover:bg-violet-600 text-white border border-violet-500/50 text-[11px] font-semibold shadow-xl transition-colors cursor-pointer"
                >
                  <Info className="w-3.5 h-3.5 text-violet-300" />
                  Room Info
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowHvacOverlay(true);
                    setActiveDockSubject('hvac');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold shadow-xl transition-colors cursor-pointer"
                >
                  <Wind className="w-3.5 h-3.5" />
                  Room HVAC
                </button>
                <button
                  type="button"
                  onClick={() => openEntityInfo({ type: 'room', id: selected[0].id }, { autoEligibility: true })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold shadow-xl transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Eligibility
                </button>
              </div>
            )}

            {/* EXCLUSIVE SINGLE-SUBJECT ACCORDION DRAWER (Only ONE subject visible at a time) */}
            {!dockCollapsed && activeDockSubject === 'xray' && (
              <div className="pointer-events-auto w-full rounded-2xl bg-[#111117] border border-zinc-800 shadow-2xl p-2.5 text-zinc-100 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold flex items-center gap-1.5 text-zinc-200">
                    <Layers className="w-3.5 h-3.5 text-violet-400" />
                    Category X-Ray Discipline Filter
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveDockSubject(null)}
                    className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {FACILITY_CATEGORIES.map((cat) => {
                    const active = categoryFilter === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCategoryFilter(active && cat.id !== 'all' ? 'all' : cat.id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                          active
                            ? 'bg-white text-zinc-950'
                            : 'bg-[#1A1A23] text-zinc-300 border border-zinc-800 hover:border-violet-500/60'
                        }`}
                        title={cat.description}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                        <span>{cat.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!dockCollapsed && activeDockSubject === 'flows' && (
              <div className="pointer-events-auto w-full rounded-2xl bg-[#111117] border border-zinc-800 shadow-2xl p-2.5 text-[11px] text-zinc-100 space-y-2">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Waypoints className="w-3.5 h-3.5 text-violet-400" />
                    Process Flows ({visibleFlows.length})
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowFlows(!showFlows)}
                      className={`px-2 py-0.5 rounded-lg flex items-center gap-1 text-[10px] font-semibold cursor-pointer ${
                        showFlows
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/35'
                          : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                      }`}
                    >
                      {showFlows ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                      {showFlows ? 'On' : 'Off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnimateFlows(!animateFlows)}
                      className={`px-2 py-0.5 rounded-lg flex items-center gap-1 text-[10px] font-medium cursor-pointer ${
                        animateFlows ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {animateFlows ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                      {animateFlows ? 'Anim' : 'Static'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDockSubject(null)}
                      className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {isolatedFlowId && (
                  <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-xl bg-amber-500/15 border border-amber-500/40 text-[10px] text-amber-300">
                    <span className="truncate font-semibold">
                      Isolated: {sceneData.flows.find((f) => f.id === isolatedFlowId)?.name ?? 'Flow'}
                    </span>
                    <button
                      type="button"
                      onClick={() => isolateFlow(null)}
                      className="px-1.5 py-0.5 rounded bg-amber-500 text-zinc-950 font-bold shrink-0 cursor-pointer"
                    >
                      Show All
                    </button>
                  </div>
                )}

                <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
                  {visibleFlows.map((fl) => {
                    const isIso = isolatedFlowId === fl.id;
                    const isHidden = !showFlows || hiddenFlowIds.includes(fl.id) || (isolatedFlowId !== null && !isIso);
                    const seq = computeFlowRoomSequence(fl, sceneData.rooms);
                    const flObj = sceneData.floors.find((x) => x.id === fl.floorId);

                    return (
                      <div
                        key={fl.id}
                        className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-xl border transition-colors ${
                          isIso
                            ? 'bg-violet-500/15 border-violet-500/60'
                            : isHidden
                              ? 'bg-[#0D0D12] border-zinc-800/70 opacity-55'
                              : 'bg-[#191922] border-zinc-800'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveFlowInfoId(fl.id)}
                          className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer group"
                        >
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fl.color }} />
                          <div className="min-w-0 flex-1">
                            <div className="text-zinc-200 font-medium truncate group-hover:text-violet-400">
                              {fl.name}
                            </div>
                            <div className="text-[9.5px] font-mono tabular-nums text-zinc-400">
                              {flObj?.code ? `${flObj.code} · ` : ''}
                              {seq.steps.length} rooms · {seq.totalLengthM}m
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => isolateFlow(fl.id)}
                            className={`p-1 rounded-lg cursor-pointer ${
                              isIso ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-amber-400 hover:bg-zinc-800'
                            }`}
                            title={isIso ? 'Exit Flow Isolation' : 'Isolate This Flow'}
                          >
                            <Focus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleFlowVisibility(fl.id)}
                            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                            title={hiddenFlowIds.includes(fl.id) ? 'Show This Flow' : 'Hide This Flow'}
                          >
                            {hiddenFlowIds.includes(fl.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveFlowInfoId(fl.id)}
                            className="p-1 rounded-lg text-zinc-400 hover:text-violet-400 hover:bg-zinc-800 cursor-pointer"
                            title="Open Flow Details"
                          >
                            <Info className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {visibleFlows.length === 0 && (
                    <div className="text-center py-3 text-zinc-500 text-[11px]">
                      No flows on this level yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {!dockCollapsed && activeDockSubject === 'hvac' && (
              <div className="pointer-events-auto w-full rounded-2xl bg-[#111117] border border-zinc-800 shadow-2xl p-2.5 text-[11px] text-zinc-100 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Wind className="w-3.5 h-3.5 text-cyan-400" />
                    HVAC Ductwork &amp; Room Air Handling
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowHvacOverlay(!showHvacOverlay)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold cursor-pointer ${
                        showHvacOverlay
                          ? 'bg-cyan-500 text-zinc-950'
                          : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                      }`}
                    >
                      3D Ducts: {showHvacOverlay ? 'ON' : 'OFF'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDockSubject(null)}
                      className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* AHU Zone Filter */}
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
                  <button
                    type="button"
                    onClick={() => setHvacAhuFilter('all')}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold whitespace-nowrap cursor-pointer ${
                      hvacAhuFilter === 'all'
                        ? 'bg-white text-zinc-950'
                        : 'bg-[#191922] text-zinc-400 border border-zinc-800 hover:text-white'
                    }`}
                  >
                    All AHUs
                  </button>
                  {AHU_CATALOG.map((ahu) => (
                    <button
                      key={ahu.id}
                      type="button"
                      onClick={() => {
                        setHvacAhuFilter(hvacAhuFilter === ahu.id ? 'all' : ahu.id);
                        if (!showHvacOverlay) setShowHvacOverlay(true);
                      }}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold whitespace-nowrap cursor-pointer ${
                        hvacAhuFilter === ahu.id
                          ? 'bg-cyan-500 text-zinc-950'
                          : 'bg-[#191922] text-zinc-300 border border-zinc-800 hover:border-cyan-500/60'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ahu.color }} />
                      {ahu.id}
                    </button>
                  ))}
                </div>

                {/* Per-Room Quick HVAC Control List */}
                <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
                  {activeFloorRooms
                    .filter((rm) => hvacAhuFilter === 'all' || getEffectiveRoomHvac(rm).ahuId === hvacAhuFilter)
                    .map((rm) => {
                      const cfg = getEffectiveRoomHvac(rm);
                      const m3h = computeRoomSupplyM3h(rm);
                      return (
                        <div
                          key={rm.id}
                          className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl bg-[#191922] border border-zinc-800"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              selectEntity({ type: 'room', id: rm.id });
                              setRightTab('properties');
                              setRightPanelOpen(true);
                            }}
                            className="min-w-0 flex-1 text-left cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: getAhuColor(cfg.ahuId) }}
                              />
                              <span className="font-mono font-bold text-white text-[10.5px]">{rm.code}</span>
                              <span className="text-zinc-300 truncate group-hover:text-cyan-300">{rm.name}</span>
                            </div>
                            <div className="text-[9.5px] font-mono tabular-nums text-zinc-400 mt-0.5">
                              {cfg.ahuId} · {cfg.hepaClass} · {cfg.airChangesPerHour} ACH ·{' '}
                              {cfg.targetPressurePa >= 0 ? '+' : ''}
                              {cfg.targetPressurePa} Pa · {m3h.toLocaleString()} m³/h
                            </div>
                          </button>

                          {!isReadOnly && (
                            <div className="flex items-center gap-1 shrink-0">
                              <select
                                value={cfg.ahuId}
                                onChange={(e) => updateRoomHvac(rm.id, { ahuId: e.target.value })}
                                className="bg-[#111117] border border-zinc-700 rounded-lg px-1.5 py-0.5 text-[10px] font-mono text-zinc-200 focus:outline-none focus:border-cyan-500"
                                title="Assign AHU"
                              >
                                {AHU_CATALOG.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.id}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() =>
                                  updateRoomHvac(rm.id, {
                                    airChangesPerHour: Math.max(4, cfg.airChangesPerHour - 2),
                                  })
                                }
                                className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-[11px] cursor-pointer"
                                title="Decrease ACH"
                              >
                                -
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateRoomHvac(rm.id, {
                                    airChangesPerHour: Math.min(80, cfg.airChangesPerHour + 2),
                                  })
                                }
                                className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-[11px] cursor-pointer"
                                title="Increase ACH"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {!dockCollapsed && activeDockSubject === 'sensors' && (
              <div className="pointer-events-auto w-full rounded-2xl bg-[#111117] border border-zinc-800 shadow-2xl p-2.5 text-[11px] text-zinc-100 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-violet-400" />
                    Sensors, 3D Tags &amp; Live Heatmap
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveDockSubject(null)}
                    className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      { id: 'none', label: 'Map Off', icon: null },
                      { id: 'temperature', label: 'Temp', icon: <Thermometer className="w-3 h-3" /> },
                      { id: 'humidity', label: 'RH%', icon: <Droplets className="w-3 h-3" /> },
                      { id: 'pressure', label: 'ΔP Pa', icon: <Gauge className="w-3 h-3" /> },
                    ] as { id: HeatmapMetric; label: string; icon: React.ReactNode }[]
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setHeatmapMetric(m.id)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-xl font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        heatmapMetric === m.id
                          ? m.id === 'none'
                            ? 'bg-zinc-100 text-zinc-900'
                            : 'bg-amber-500 text-zinc-950 font-semibold'
                          : 'bg-[#1A1A23] text-zinc-300 border border-zinc-800 hover:text-white'
                      }`}
                    >
                      {m.icon}
                      <span>{m.label}</span>
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setShow3DSensorPins(!show3DSensorPins)}
                    className={`px-2.5 py-1 rounded-xl font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      show3DSensorPins
                        ? 'bg-violet-500/20 text-violet-300 border border-violet-500/50'
                        : 'bg-[#1A1A23] text-zinc-400 border border-zinc-800'
                    }`}
                  >
                    3D Tags: {show3DSensorPins ? 'On' : 'Off'}
                  </button>

                  <button
                    type="button"
                    onClick={() => openDashboard({ tab: 'trends' })}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium whitespace-nowrap cursor-pointer"
                  >
                    <Activity className="w-3 h-3" />
                    Telemetry
                  </button>

                  <a
                    href={buildTelemetryTabUrl({ tab: 'trends' })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-xl bg-[#1A1A23] border border-zinc-800 text-zinc-400 hover:text-amber-400"
                    title="Open Telemetry in New Tab"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {heatmapMetric !== 'none' && (
                  <div className="pt-1.5 border-t border-zinc-800 space-y-1.5">
                    <div
                      className="h-2 w-full rounded-full"
                      style={{
                        background: `linear-gradient(to right, ${HEATMAP_SCALES[heatmapMetric].stops
                          .map((s) => `${s.hex} ${Math.round(s.t * 100)}%`)
                          .join(', ')})`,
                      }}
                    />
                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-zinc-400">
                      <span>{HEATMAP_SCALES[heatmapMetric].min} {HEATMAP_SCALES[heatmapMetric].unit}</span>
                      <div className="flex items-center gap-1.5 flex-1 max-w-[160px]">
                        <span>Opacity</span>
                        <input
                          type="range"
                          min={0.2}
                          max={0.95}
                          step={0.05}
                          value={heatmapOpacity}
                          onChange={(e) => setHeatmapOpacity(Number(e.target.value))}
                          className="flex-1 accent-violet-500"
                        />
                        <span>{Math.round(heatmapOpacity * 100)}%</span>
                      </div>
                      <span>{HEATMAP_SCALES[heatmapMetric].max} {HEATMAP_SCALES[heatmapMetric].unit}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!dockCollapsed && activeDockSubject === 'fmea' && (
              <div className="pointer-events-auto w-full rounded-2xl bg-[#111117] border border-zinc-800 shadow-2xl p-2.5 text-[11px] text-zinc-100 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                    FMEA Risk Status ({activeFmeaIncidents.length} Active)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowFmeaIndicators(!showFmeaIndicators)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold cursor-pointer ${
                        showFmeaIndicators
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/45'
                          : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                      }`}
                    >
                      3D Badges: {showFmeaIndicators ? 'ON' : 'OFF'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openRiskModal({ mode: 'create' })}
                      className="px-2 py-0.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold cursor-pointer"
                    >
                      + Log FMEA
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDockSubject(null)}
                      className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-center font-mono tabular-nums">
                  <div className="px-2 py-1 rounded-xl bg-rose-500/12 border border-rose-500/35">
                    <div className="text-[10px] text-rose-300">Critical ≥200</div>
                    <div className="text-sm font-bold text-rose-400">{criticalFmeaCount}</div>
                  </div>
                  <div className="px-2 py-1 rounded-xl bg-amber-500/12 border border-amber-500/35">
                    <div className="text-[10px] text-amber-300">High 100-199</div>
                    <div className="text-sm font-bold text-amber-400">{highFmeaCount}</div>
                  </div>
                  <div className="px-2 py-1 rounded-xl bg-emerald-500/12 border border-emerald-500/35">
                    <div className="text-[10px] text-emerald-300">Mitigated</div>
                    <div className="text-sm font-bold text-emerald-400">
                      {riskIncidents.filter((i) => i.status === 'mitigated' || i.status === 'closed').length}
                    </div>
                  </div>
                </div>

                <div className="space-y-1 max-h-40 overflow-y-auto pr-0.5">
                  {activeFmeaIncidents.slice(0, 6).map((inc) => (
                    <button
                      key={inc.id}
                      type="button"
                      onClick={() => openRiskModal({ mode: 'resolve', incidentId: inc.id })}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl bg-[#191922] border border-zinc-800 hover:border-rose-500/60 text-left cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold text-violet-300">{inc.targetCode}</span>
                          <span className="text-zinc-200 truncate">{inc.title}</span>
                        </div>
                        <div className="text-[9.5px] font-mono text-zinc-400 truncate">
                          S{inc.severity}×O{inc.occurrence}×D{inc.detection} · {inc.failureMode}
                        </div>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold tabular-nums shrink-0 ${
                          inc.rpn >= 200
                            ? 'bg-rose-500 text-white'
                            : inc.rpn >= 100
                              ? 'bg-amber-400 text-zinc-950'
                              : 'bg-violet-500 text-white'
                        }`}
                      >
                        RPN {inc.rpn}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* COMPACT SINGLE-ROW BOTTOM DOCK RAIL (Zero overlapping footer menus across all viewports) */}
            <div className="pointer-events-auto max-w-full overflow-x-auto no-scrollbar rounded-2xl bg-[#111117] border border-zinc-800 shadow-[0_14px_40px_rgba(0,0,0,0.75)] px-1.5 py-1 flex items-center gap-1 text-[11px]">
              {dockCollapsed ? (
                <button
                  type="button"
                  onClick={() => setDockCollapsed(false)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-zinc-300 hover:text-white font-medium cursor-pointer whitespace-nowrap"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-violet-400" />
                  <span>Scene Dock</span>
                  <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => toggleDockSubject('xray')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      activeDockSubject === 'xray'
                        ? 'bg-white text-zinc-950'
                        : categoryFilter !== 'all'
                          ? 'bg-violet-500/20 text-violet-300 border border-violet-500/45'
                          : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>{categoryFilter === 'all' ? 'X-Ray' : getCategoryMeta(categoryFilter).shortLabel}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleDockSubject('flows')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      activeDockSubject === 'flows'
                        ? 'bg-white text-zinc-950'
                        : isolatedFlowId
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/45'
                          : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <Waypoints className="w-3.5 h-3.5 text-violet-400" />
                    <span>Flows</span>
                    <span className="font-mono tabular-nums text-[10px] opacity-75">
                      {showFlows ? visibleFlows.length : 'Off'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleDockSubject('hvac')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      activeDockSubject === 'hvac'
                        ? 'bg-white text-zinc-950'
                        : showHvacOverlay
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/45'
                          : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <Wind className="w-3.5 h-3.5 text-cyan-400" />
                    <span>HVAC</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleDockSubject('sensors')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      activeDockSubject === 'sensors'
                        ? 'bg-white text-zinc-950'
                        : heatmapMetric !== 'none'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/45'
                          : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5 text-violet-400" />
                    <span>Sensors</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleDockSubject('fmea')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      activeDockSubject === 'fmea'
                        ? 'bg-white text-zinc-950'
                        : criticalFmeaCount > 0
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/45'
                          : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span>FMEA</span>
                    {activeFmeaIncidents.length > 0 && (
                      <span className="font-mono tabular-nums text-[10px] font-bold">
                        {activeFmeaIncidents.length}
                      </span>
                    )}
                  </button>

                  {isReadOnly && (
                    <span className="pl-1.5 pr-1 border-l border-zinc-800 flex items-center gap-1 text-[10px] font-mono text-amber-400 shrink-0">
                      <Lock className="w-3 h-3" />
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setActiveDockSubject(null);
                      setDockCollapsed(true);
                    }}
                    className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 cursor-pointer shrink-0"
                    title="Minimize Scene Dock"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* FIRST-PERSON WALK MODE: Tactile 360° Virtual Joystick (Bottom-Left) + Non-Overlapping Field Pad */}
      {firstPersonMode && (() => {
        const curRoom = sceneData.rooms.find(
          (r) =>
            r.floorId === activeFloorId &&
            fpState.x >= r.x &&
            fpState.x <= r.x + r.width &&
            fpState.z >= r.z &&
            fpState.z <= r.z + r.depth
        );
        const nearbyAssets = sceneData.assets
          .filter((a) => a.floorId === activeFloorId && !a.hidden)
          .map((a) => ({ asset: a, dist: Math.hypot(a.x - fpState.x, a.z - fpState.z) }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 3);
        const roomSensors = curRoom
          ? sensors.filter((s) => s.targetKind === 'room' && s.targetId === curRoom.id)
          : [];
        const tempSnap = roomSensors.find((s) => s.metric === 'temperature');
        const rhSnap = roomSensors.find((s) => s.metric === 'humidity');
        const dpSnap = roomSensors.find((s) => s.metric === 'pressure');

        return (
          <>
            {/* Bottom-Left Tactile 360° Virtual Walk Joystick (100% Unobstructed on Mobile & Desktop) */}
            <div className="absolute bottom-4 left-3 sm:left-4 z-30 flex items-end gap-2.5 select-none">
              <div
                ref={joyPadRef}
                onPointerDown={handleJoyPointerDown}
                onPointerMove={handleJoyPointerMove}
                onPointerUp={handleJoyPointerUp}
                onPointerCancel={handleJoyPointerUp}
                className="relative w-[108px] h-[108px] sm:w-[112px] sm:h-[112px] rounded-full bg-[#0F1016]/90 border-2 border-zinc-700/80 shadow-[0_12px_36px_rgba(0,0,0,0.65)] touch-none cursor-grab active:cursor-grabbing flex items-center justify-center"
                title="Drag to walk (walls, equipment & closed doors are solid)"
              >
                {/* Inner concentric guide ring & directional ticks */}
                <div className="absolute inset-3 rounded-full border border-zinc-700/50 pointer-events-none" />
                <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[9px] font-mono font-bold text-zinc-500 pointer-events-none">
                  W
                </span>
                <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-mono font-bold text-zinc-500 pointer-events-none">
                  S
                </span>
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-mono font-bold text-zinc-500 pointer-events-none">
                  A
                </span>
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono font-bold text-zinc-500 pointer-events-none">
                  D
                </span>
                {/* Spring-return thumbstick */}
                <div
                  style={{
                    transform: `translate3d(${joyKnob.x}px, ${joyKnob.y}px, 0)`,
                  }}
                  className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500 to-violet-700 border-2 border-violet-300/80 shadow-[0_0_18px_rgba(139,92,246,0.55)] pointer-events-none flex items-center justify-center transition-transform duration-75"
                >
                  <div className="w-3.5 h-3.5 rounded-full bg-white/30" />
                </div>
              </div>
            </div>

            {/* Bottom-Right Ergonomic Action Buttons on Mobile, Left-Adjacent on Large Desktop (Zero Overlap) */}
            <div className="absolute bottom-4 right-3 md:right-auto md:left-[138px] z-30 flex flex-col gap-2 pb-0.5 select-none">
              <button
                type="button"
                onClick={() =>
                  setWalkCameraMode((m) => (m === 'first-person' ? 'third-person' : 'first-person'))
                }
                className={`w-10 h-10 rounded-full border flex items-center justify-center shadow-lg transition cursor-pointer ${
                  walkCameraMode === 'third-person'
                    ? 'bg-violet-600 border-violet-300 text-white'
                    : 'bg-[#12131A]/90 border-zinc-700 text-zinc-300 hover:border-violet-400'
                }`}
                title={
                  walkCameraMode === 'third-person'
                    ? '3rd-Person MAYA View (Click or V for 1st-Person)'
                    : '1st-Person View (Click or V for 3rd-Person MAYA)'
                }
              >
                <User className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !joySprint;
                  fpSprintRef.current = next;
                  setJoySprint(next);
                }}
                className={`w-10 h-10 rounded-full border flex items-center justify-center shadow-lg transition cursor-pointer ${
                  joySprint
                    ? 'bg-amber-500 border-amber-300 text-zinc-950'
                    : 'bg-[#12131A]/90 border-zinc-700 text-zinc-300 hover:border-violet-400'
                }`}
                title={joySprint ? 'Sprint Active (Click to Walk)' : 'Toggle Sprint Speed'}
              >
                <Zap className="w-4 h-4" />
              </button>
              {nearbyInteractable ? (
                <>
                  <button
                    type="button"
                    onClick={() => executeInteractable(nearbyInteractable)}
                    className={`w-11 h-11 rounded-full border-2 flex items-center justify-center shadow-[0_0_22px_rgba(34,211,238,0.55)] active:scale-95 transition cursor-pointer ${
                      nearbyInteractable.kind === 'door'
                        ? 'bg-cyan-500 border-cyan-200 text-zinc-950'
                        : nearbyInteractable.kind === 'gown'
                          ? 'bg-sky-400 border-cyan-100 text-zinc-950'
                          : nearbyInteractable.kind === 'light'
                            ? 'bg-amber-400 border-amber-200 text-zinc-950'
                            : 'bg-violet-500 border-violet-200 text-white'
                    }`}
                    title={`${nearbyInteractable.actionLabel} (Enter)`}
                  >
                    {nearbyInteractable.kind === 'door' ? (
                      <DoorOpen className="w-5 h-5" />
                    ) : nearbyInteractable.kind === 'gown' ? (
                      <ShieldCheck className="w-5 h-5" />
                    ) : nearbyInteractable.kind === 'light' ? (
                      <Lightbulb className="w-5 h-5" />
                    ) : (
                      <FileText className="w-5 h-5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={triggerWalkJump}
                    className="hidden sm:flex w-10 h-10 rounded-full bg-[#12131A]/95 border border-zinc-700 hover:border-violet-400 text-zinc-200 items-center justify-center shadow-lg active:scale-95 transition cursor-pointer"
                    title="High Jump (Space)"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={triggerWalkJump}
                  className="w-10 h-10 rounded-full bg-[#12131A]/95 border border-zinc-700 hover:border-violet-400 text-zinc-200 flex items-center justify-center shadow-lg active:scale-95 transition cursor-pointer"
                  title="High Jump (Space)"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Universal 3D-Anchored Floating Interaction Sign (Doors, Gowning Station, Light Switches, Equipment — ENTER Key) */}
            {nearbyInteractable && (
              <div
                style={{
                  transform: `translate3d(${nearbyInteractable.screenX}px, ${nearbyInteractable.screenY}px, 0) translate(-50%, -100%)`,
                }}
                className="absolute top-0 left-0 z-30 pointer-events-auto transition-transform duration-75"
              >
                <button
                  type="button"
                  onClick={() => executeInteractable(nearbyInteractable)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-2xl border shadow-[0_12px_32px_rgba(0,0,0,0.8)] text-left cursor-pointer transition hover:scale-[1.03] ${
                    nearbyInteractable.kind === 'door'
                      ? 'bg-[#0C1524] border-cyan-400/80 text-cyan-50'
                      : nearbyInteractable.kind === 'gown'
                        ? 'bg-[#081A24] border-sky-400/85 text-sky-50'
                        : nearbyInteractable.kind === 'light'
                          ? 'bg-[#19160C] border-amber-400/80 text-amber-50'
                          : 'bg-[#141122] border-violet-400/80 text-violet-50'
                  }`}
                >
                  <span className="px-1.5 py-0.5 rounded-md bg-white text-zinc-950 font-mono text-[10px] font-extrabold tracking-wide shrink-0">
                    ENTER
                  </span>
                  {nearbyInteractable.kind === 'door' ? (
                    <DoorOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  ) : nearbyInteractable.kind === 'gown' ? (
                    <ShieldCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  ) : nearbyInteractable.kind === 'light' ? (
                    <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  )}
                  <div className="min-w-0 leading-tight">
                    <div className="text-[11px] font-bold whitespace-nowrap">
                      {nearbyInteractable.actionLabel}
                    </div>
                    <div className="text-[9.5px] font-mono opacity-80 truncate max-w-[180px]">
                      {nearbyInteractable.detail}
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* Walk Mode Quick Equipment Info & SOP Inspection Card (Opened via Spacebar beside Equipment) */}
            {walkInspectAssetId && (() => {
              const inspAsset = sceneData.assets.find((a) => a.id === walkInspectAssetId);
              if (!inspAsset) return null;
              const assetSops = useGmpStore
                .getState()
                .sops.filter(
                  (d) =>
                    d.id === `sop-asset-${inspAsset.id}` ||
                    (d.archetypes ?? []).includes(inspAsset.archetype) ||
                    d.equipmentCategory === inspAsset.category
                );
              const primarySop = assetSops[0];
              return (
                <div className="absolute top-16 right-3 z-30 w-[300px] max-w-[calc(100%-24px)] rounded-2xl bg-[#111118]/95 border border-violet-500/60 shadow-2xl p-3 text-zinc-100 space-y-2.5 backdrop-blur-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] font-bold text-amber-400">
                        {inspAsset.assetId} · {inspAsset.category}
                      </div>
                      <div className="text-xs font-bold text-white truncate">{inspAsset.name}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setWalkInspectAssetId(null)}
                      className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono tabular-nums">
                    <div className="px-2 py-1 rounded-lg bg-[#1A1A24] border border-zinc-800">
                      <div className="text-zinc-400">Status</div>
                      <div className="font-bold text-emerald-400 capitalize">{inspAsset.operationalStatus}</div>
                    </div>
                    <div className="px-2 py-1 rounded-lg bg-[#1A1A24] border border-zinc-800">
                      <div className="text-zinc-400">Power</div>
                      <div className="font-bold text-zinc-100">{inspAsset.energyKw} kW</div>
                    </div>
                    <div className="px-2 py-1 rounded-lg bg-[#1A1A24] border border-zinc-800">
                      <div className="text-zinc-400">SOPs</div>
                      <div className="font-bold text-violet-300">{assetSops.length}</div>
                    </div>
                  </div>
                  {primarySop && (
                    <div className="rounded-xl bg-[#181822] border border-zinc-800 p-2 text-[10.5px]">
                      <div className="font-mono text-[9.5px] font-bold text-violet-400">
                        {primarySop.docNumber} · v{primarySop.version}
                      </div>
                      <div className="font-semibold text-zinc-100 line-clamp-1 mt-0.5">{primarySop.title}</div>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    {primarySop && (
                      <button
                        type="button"
                        onClick={() => {
                          saveCurrentWalkPose();
                          useMayaStore
                            .getState()
                            .startReadingSop(primarySop.id, primarySop.title, inspAsset.id, inspAsset.assetId);
                          setWalkInspectAssetId(null);
                          useTwinStore.getState().setScreen('maya-life');
                        }}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" />
                        MAYA Read SOP
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setWalkInspectAssetId(null);
                        openEntityInfo({ type: 'asset', id: inspAsset.id });
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-[#1C1C28] border border-zinc-700 hover:border-violet-400 text-[11px] font-semibold text-zinc-200 cursor-pointer"
                    >
                      Details
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Ultra-Minimal Floating Walk Field Pad (Top-Docked on Mobile/Tablet so Joystick is 100% Clear; Bottom-Center on Desktop) */}
            {firstPersonTabletVisible && (
              <div
                className="absolute top-[52px] left-2 right-2 md:top-auto md:bottom-3 md:left-1/2 md:-translate-x-1/2 md:right-auto z-20 pointer-events-none flex flex-col-reverse md:flex-col items-center gap-2"
              >
                {/* Active No-Go Floor Placement Mode Indicator */}
                {placingNoGoZone && (
                  <div className="pointer-events-auto px-3 py-1.5 rounded-xl bg-rose-600 text-white text-[11px] font-semibold shadow-lg flex items-center gap-2">
                    <span>Click any spot on the 3D floor to place a {noGoRadius.toFixed(1)}m No-Go Zone</span>
                    <button
                      type="button"
                      onClick={() => setPlacingNoGoZone(false)}
                      className="px-2 py-0.5 rounded-md bg-black/25 hover:bg-black/40 text-[10px] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Spatial Audio Settings Popover (Rolloff Distance & Falloff Curves) */}
                {spatialAudioSettingsOpen && (
                  <div className="pointer-events-auto w-full flex justify-center">
                    <SpatialAudioSettingsPopover
                      settings={spatialAudioSettings}
                      enabled={spatialAudioEnabled}
                      telemetry={audioTelemetry}
                      onToggleEnabled={toggleSpatialAudio}
                      onChange={(next) => setSpatialAudioSettings(next)}
                      onTestChannel={(ch) => {
                        if (!spatialAudioEnabledRef.current) {
                          spatialAudioEnabledRef.current = true;
                          setSpatialAudioEnabled(true);
                        }
                        spatialAudioRef.current?.setEnabled(true);
                        spatialAudioRef.current?.playTestCue(ch);
                      }}
                      onClose={() => setSpatialAudioSettingsOpen(false)}
                    />
                  </div>
                )}

                {/* Path Finder Destinations, Routing Algorithm & No-Go Zones Popover */}
                {pathFinderOpen && (
                  <div className="pointer-events-auto w-full flex justify-center">
                    <PathFinderConfigPopover
                      activeFloorId={activeFloorId}
                      currentRoomId={curRoom?.id ?? null}
                      floorRooms={sceneData.rooms.filter((r) => r.floorId === activeFloorId)}
                      floorAssets={sceneData.assets.filter((a) => a.floorId === activeFloorId && !a.hidden)}
                      algorithm={pathAlgorithm}
                      noGoZones={noGoZones}
                      placingNoGo={placingNoGoZone}
                      noGoRadius={noGoRadius}
                      noGoLabelDraft={noGoLabelDraft}
                      onChangeAlgorithm={(algo) => {
                        setPathAlgorithm(algo);
                        storeRef.current.showToast(
                          algo === 'gmp-compliant'
                            ? 'Routing switched to EU GMP Annex 1 Compliant Path'
                            : algo === 'least-congested'
                              ? 'Routing switched to Least Congested'
                              : 'Routing switched to Shortest Distance',
                          'info'
                        );
                      }}
                      onTogglePlacingNoGo={() => {
                        setPlacingNoGoZone((v) => !v);
                        setPathFinderOpen(false);
                      }}
                      onChangeNoGoRadius={setNoGoRadius}
                      onChangeNoGoLabelDraft={setNoGoLabelDraft}
                      onToggleRoomNoGo={(rm) => {
                        setNoGoZones((prev) => {
                          const exists = prev.find(
                            (z) => z.floorId === activeFloorId && z.kind === 'room' && z.roomId === rm.id
                          );
                          if (exists) {
                            return prev.filter((z) => z.id !== exists.id);
                          }
                          return [
                            ...prev,
                            {
                              id: `nogo-room-${rm.id}`,
                              floorId: activeFloorId,
                              label: `${rm.code} · ${rm.name}`,
                              kind: 'room',
                              roomId: rm.id,
                              x: rm.x,
                              z: rm.z,
                              width: rm.width,
                              depth: rm.depth,
                            },
                          ];
                        });
                      }}
                      onRemoveNoGoZone={(id) =>
                        setNoGoZones((prev) => prev.filter((z) => z.id !== id))
                      }
                      onClearNoGoZones={() =>
                        setNoGoZones((prev) => prev.filter((z) => z.floorId !== activeFloorId))
                      }
                      onSelectDestination={(dest, autoWalk) => setPathFinderRoute(dest, autoWalk)}
                      onClose={() => setPathFinderOpen(false)}
                    />
                  </div>
                )}

                <div className="pointer-events-auto rounded-2xl bg-[#0F1016]/95 border border-zinc-700/80 shadow-[0_12px_36px_rgba(0,0,0,0.72)] text-zinc-100 overflow-hidden w-full max-w-[480px] md:min-w-[310px]">
                  {/* Active Path Finder / Autonomous GMP Go-To Strip */}
                  {pathFinderHud && (
                    <div
                      className={`px-3 py-1.5 border-b space-y-1 text-[10.5px] ${
                        pathAlgorithm === 'gmp-compliant'
                          ? 'bg-violet-500/14 border-violet-500/35'
                          : pathAlgorithm === 'least-congested'
                            ? 'bg-emerald-500/12 border-emerald-500/30'
                            : 'bg-cyan-500/12 border-cyan-500/30'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Navigation
                            className={`w-3.5 h-3.5 shrink-0 ${
                              pathAlgorithm === 'gmp-compliant'
                                ? 'text-violet-300'
                                : pathAlgorithm === 'least-congested'
                                  ? 'text-emerald-400'
                                  : 'text-cyan-400'
                            }`}
                          />
                          <span className="font-mono font-bold text-cyan-300 shrink-0">
                            {pathFinderHud.code}
                          </span>
                          <span className="text-zinc-200 truncate">{pathFinderHud.label}</span>
                          <span className="font-mono text-emerald-300 font-semibold tabular-nums shrink-0">
                            {pathFinderHud.remainingM}m (~{Math.max(1, Math.round(pathFinderHud.remainingM / 3.8))}s)
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!pathFinderHud.autoWalking && engineRef.current?.pathFinderDest && (
                            <button
                              type="button"
                              onClick={() => {
                                const d = engineRef.current?.pathFinderDest;
                                if (d) setPathFinderRoute(d, true);
                              }}
                              className="px-1.5 py-0.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[9.5px] cursor-pointer"
                            >
                              Go To
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={clearPathFinderRoute}
                            className="p-0.5 rounded text-zinc-400 hover:text-white cursor-pointer"
                            title="Stop & clear navigation route"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      {(pathFinderHud.statusStep || pathFinderHud.roomTrail) && (
                        <div className="flex items-center justify-between gap-2 text-[9.5px] text-zinc-300">
                          <span className="truncate text-violet-200 font-medium">
                            {pathFinderHud.statusStep ?? pathFinderHud.protocolSummary}
                          </span>
                          {pathFinderHud.roomTrail && (
                            <span className="font-mono text-zinc-400 truncate max-w-[190px] shrink-0">
                              {pathFinderHud.roomTrail}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="px-3 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10.5px] font-bold text-violet-300 shrink-0">
                        {curRoom ? curRoom.code : activeFloor?.code ?? 'FLOOR'}
                      </span>
                      <span className="text-xs font-semibold text-white truncate max-w-[115px]">
                        {curRoom ? curRoom.name : 'Corridor'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Spatial Audio Mute Toggle */}
                      <button
                        type="button"
                        onClick={toggleSpatialAudio}
                        className={`px-1.5 py-1 rounded-lg border text-[10px] font-mono flex items-center gap-1 cursor-pointer transition ${
                          spatialAudioEnabled
                            ? 'bg-emerald-500/15 border-emerald-400/45 text-emerald-300'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                        }`}
                        title={
                          spatialAudioEnabled
                            ? `3D Spatial Audio ON (${audioTelemetry?.estimatedDb ?? 42} dB · ${audioTelemetry?.dominantLabel ?? 'Ambient'})`
                            : 'Enable 3D Spatial Audio (Equipment & HVAC)'
                        }
                      >
                        {spatialAudioEnabled ? (
                          <Volume2 className="w-3 h-3" />
                        ) : (
                          <VolumeX className="w-3 h-3" />
                        )}
                        {spatialAudioEnabled && audioTelemetry?.active && (
                          <span className="hidden sm:inline text-[9.5px] tabular-nums">
                            {audioTelemetry.estimatedDb}dB
                          </span>
                        )}
                      </button>

                      {/* Spatial Audio Settings Menu Trigger */}
                      <button
                        type="button"
                        onClick={() => {
                          setSpatialAudioSettingsOpen((v) => !v);
                          setPathFinderOpen(false);
                        }}
                        className={`p-1 rounded-lg border text-[10px] cursor-pointer transition ${
                          spatialAudioSettingsOpen
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-emerald-400/40'
                        }`}
                        title="Spatial Audio Settings (Rolloff Distance & Falloff Curves)"
                        aria-label="Spatial Audio Settings"
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                      </button>

                      {/* Go To Room & GMP Path Finder Trigger */}
                      <button
                        type="button"
                        onClick={() => {
                          setPathFinderOpen((v) => !v);
                          setSpatialAudioSettingsOpen(false);
                        }}
                        className={`px-2 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition ${
                          pathFinderOpen || pathFinderHud
                            ? pathAlgorithm === 'gmp-compliant'
                              ? 'bg-violet-500/25 border-violet-400/60 text-violet-100'
                              : pathAlgorithm === 'least-congested'
                                ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                                : 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:border-violet-400/50'
                        }`}
                        title="Go To Room via GMP Path (auto-opens doors, airlocks & PAL gowning)"
                      >
                        <Route className="w-3 h-3" />
                        <span>Go To</span>
                        {noGoZones.filter((z) => z.floorId === activeFloorId).length > 0 && (
                          <span className="font-mono text-[9px] text-rose-300 tabular-nums">
                            ·{noGoZones.filter((z) => z.floorId === activeFloorId).length}
                          </span>
                        )}
                      </button>

                      {curRoom && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextOn = useMayaStore
                              .getState()
                              .toggleRoomLight(curRoom.id, curRoom.code, curRoom.name);
                            if (spatialAudioEnabledRef.current) {
                              spatialAudioRef.current?.playSwitchCue(nextOn);
                            }
                          }}
                          className={`p-1 rounded-lg border text-[10px] cursor-pointer transition ${
                            (roomLightsState[curRoom.id] ?? true)
                              ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                              : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                          }`}
                          title="Toggle Current Room Lighting"
                        >
                          <Lightbulb className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          saveCurrentWalkPose();
                          useTwinStore.getState().setScreen('maya-life');
                        }}
                        className="px-2 py-0.5 rounded-lg bg-violet-600/90 hover:bg-violet-500 text-white text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                        title="Open MAYA Life AI Studio (saves your current game position)"
                      >
                        <Sparkles className="w-3 h-3" />
                        MAYA
                      </button>
                      <button
                        type="button"
                        onClick={() => setFpExpandedPad((v) => !v)}
                        className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                        title={fpExpandedPad ? 'Compact Pad' : 'Expand Room Telemetry & Audio'}
                      >
                        {fpExpandedPad ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFirstPersonTabletVisible(false)}
                        className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                        title="Hide Minimal Pad"
                      >
                        <EyeOff className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {fpExpandedPad && (
                    <div className="px-3 pb-2.5 pt-1.5 border-t border-zinc-800/80 space-y-2">
                      <Viewport3DWalkRoomMetrics
                        tempSnap={tempSnap}
                        rhSnap={rhSnap}
                        dpSnap={dpSnap}
                        curRoom={curRoom}
                      />
                      {spatialAudioEnabled && audioTelemetry?.active && (
                        <div className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums">
                          <span className="text-emerald-300 truncate flex items-center gap-1.5">
                            <Volume2 className="w-3 h-3 shrink-0" />
                            <span className="truncate">{audioTelemetry.dominantLabel}</span>
                          </span>
                          <span className="text-emerald-200 shrink-0">
                            {audioTelemetry.estimatedDb} dB · {audioTelemetry.activeSources} src
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400 font-mono tabular-nums">
                        <span>Pos {fpState.x}, {fpState.z} · Click floor for Path Teleport</span>
                        <span>{Object.values(openDoorsState).filter(Boolean).length} doors open</span>
                      </div>
                      {nearbyAssets.length > 0 && (
                        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                          {nearbyAssets.map(({ asset, dist }) => (
                            <button
                              key={asset.id}
                              type="button"
                              onClick={() => setWalkInspectAssetId(asset.id)}
                              className="px-2 py-0.5 rounded-lg bg-[#1A1A26] border border-zinc-700/80 hover:border-violet-400 font-mono text-[9.5px] text-zinc-200 whitespace-nowrap cursor-pointer"
                            >
                              {asset.assetId} ({dist.toFixed(1)}m)
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
};
