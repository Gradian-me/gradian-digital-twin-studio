import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Droplets,
  ExternalLink,
  Eye,
  EyeOff,
  Focus,
  Footprints,
  Gauge,
  Glasses,
  Globe,
  Info,
  Layers,
  Link2,
  Lock,
  Map as MapIcon,
  MapPin,
  Moon,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Route,
  Scissors,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Tablet,
  Thermometer,
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
import { DEFAULT_MATERIALS } from '../data/materialsLibrary';
import { getProceduralMaterial } from '../engine/proceduralTextures';
import { buildProceduralEquipmentGroup } from '../engine/equipmentBuilder';
import {
  buildFloorNavMesh,
  buildNavMeshVisualGroup,
  type FloorNavMesh,
} from '../engine/navMesh';
import { getRoomColorForAnalytics, snapValue } from '../utils/spatial';
import { computeFlowRoomSequence } from '../utils/flowAnalytics';
import type { Building, Floor, MaterialDef, Opening, Room, Wall } from '../types/twin';

const _projVec = new THREE.Vector3();

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
// Walkable door openings (sillHeight < 0.25m) remain passable; solid walls, glass walls, and windows block 100%.
function resolveStrictWallCollision(
  prevX: number,
  prevZ: number,
  targetX: number,
  targetZ: number,
  playerRadius: number,
  walls: Wall[],
  openings: Opening[],
  floorWidth: number,
  floorDepth: number
): { x: number; z: number } {
  const solidSegments: { ax: number; az: number; bx: number; bz: number; halfThick: number }[] = [];

  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dz = w.z2 - w.z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ux = dx / len;
    const uz = dz / len;
    const halfThick = Math.max(0.08, (w.thickness || 0.18) * 0.5);

    const doorGaps = openings
      .filter((o) => o.wallId === w.id && o.kind === 'door' && o.sillHeight < 0.25)
      .map((o) => {
        const c = o.offsetRatio * len;
        const half = Math.max(0.45, o.width * 0.5);
        return [Math.max(0, c - half), Math.min(len, c + half)] as [number, number];
      })
      .sort((a, b) => a[0] - b[0]);

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
  const setViewMode = useTwinStore((s) => s.setViewMode);

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

  // Real-Time Telemetry & Heatmap Store Subscriptions
  const heatmapMetric = useTelemetryStore((s) => s.heatmapMetric);
  const heatmapOpacity = useTelemetryStore((s) => s.heatmapOpacity);
  const show3DSensorPins = useTelemetryStore((s) => s.show3DSensorPins);
  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
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

  useEffect(() => {
    if (!firstPersonMode) {
      fpJoystickRef.current = { x: 0, y: 0 };
      fpSprintRef.current = false;
      joyActivePointerRef.current = null;
      setJoyKnob({ x: 0, y: 0 });
      setJoySprint(false);
    }
  }, [firstPersonMode]);

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
    eng.fpVelY = 5.4;
    eng.fpOnGround = false;
    eng.requestRender();
  };

  storeRef.current = useTwinStore.getState();

  const pinDomRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const roomPinDomRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const projectPinsRef = useRef<() => void>(() => {});

  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    hemi: THREE.HemisphereLight;
    keyLight: THREE.DirectionalLight;
    rimLight: THREE.DirectionalLight;
    nightLightsGroup: THREE.Group;
    navMeshGroup: THREE.Group;
    navMesh: FloorNavMesh | null;
    flowPulses: { mesh: THREE.Mesh; curve: THREE.CatmullRomCurve3; phase: number; speed: number }[];
    fpVelY: number;
    fpOnGround: boolean;
    fpYaw: number;
    fpPitch: number;
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

    const vrRig = new THREE.Group();
    threeScene.add(vrRig);

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

          // First-Person Character Walkthrough: True Human-Head Rotation + Sub-stepped Anti-Tunnel NavMesh & Wall Collision
          if (storeRef.current.firstPersonMode) {
            const activeFl = storeRef.current.scene.floors.find(
              (f) => f.id === storeRef.current.activeFloorId
            );
            const eyeBaseY = (activeFl?.elevation ?? 0) + 1.68;
            const joy = fpJoystickRef.current;
            const joyMag = Math.hypot(joy.x, joy.y);
            const hasJoy = joyMag > 0.05;

            // Keep camera head rotation exact in YXZ human-neck order (no orbit arc!)
            eng.perspCamera.rotation.order = 'YXZ';
            eng.perspCamera.rotation.set(eng.fpPitch, eng.fpYaw, 0);

            if (eng.keys.size > 0 || hasJoy) {
              const sprinting =
                eng.keys.has('ShiftLeft') || eng.keys.has('ShiftRight') || fpSprintRef.current;
              const speed = (sprinting ? 8.2 : 4.8) * dt;
              const forward = new THREE.Vector3(
                -Math.sin(eng.fpYaw),
                0,
                -Math.cos(eng.fpYaw)
              ).normalize();
              const right = new THREE.Vector3(
                Math.cos(eng.fpYaw),
                0,
                -Math.sin(eng.fpYaw)
              ).normalize();

              const keyFwd =
                (eng.keys.has('KeyW') || eng.keys.has('ArrowUp') ? 1 : 0) -
                (eng.keys.has('KeyS') || eng.keys.has('ArrowDown') ? 1 : 0);
              const keyRight =
                (eng.keys.has('KeyD') || eng.keys.has('ArrowRight') ? 1 : 0) -
                (eng.keys.has('KeyA') || eng.keys.has('ArrowLeft') ? 1 : 0);

              const fwdAmt = keyFwd + (hasJoy ? -joy.y : 0);
              const rightAmt = keyRight + (hasJoy ? joy.x : 0);
              const inputLen = Math.hypot(fwdAmt, rightAmt);

              if (inputLen > 0.02) {
                const throttle = Math.min(1, inputLen);
                const move = new THREE.Vector3()
                  .addScaledVector(forward, fwdAmt / inputLen)
                  .addScaledVector(right, rightAmt / inputLen)
                  .multiplyScalar(speed * throttle);

                const flId = storeRef.current.activeFloorId;
                const flWalls = storeRef.current.scene.walls.filter((w) => w.floorId === flId);
                const flOpenings = storeRef.current.scene.openings.filter((o) => o.floorId === flId);
                const floorW = activeFl?.width ?? 0;
                const floorD = activeFl?.depth ?? 0;

                // Sub-step every <= 0.075m so even Fast/Sprint mode can NEVER tunnel through walls or non-NavMesh zones
                const totalDist = Math.hypot(move.x, move.z);
                const subSteps = Math.max(1, Math.ceil(totalDist / 0.075));
                const stepDx = move.x / subSteps;
                const stepDz = move.z / subSteps;

                let stepX = eng.perspCamera.position.x;
                let stepZ = eng.perspCamera.position.z;

                for (let s = 0; s < subSteps; s++) {
                  const wantX = stepX + stepDx;
                  const wantZ = stepZ + stepDz;

                  // 1. Always enforce NavMesh walkability (door portals are already carved walkable in navMesh.ts)
                  const navRes = eng.navMesh
                    ? eng.navMesh.resolveMove(stepX, stepZ, wantX, wantZ)
                    : { x: wantX, z: wantZ };

                  // 2. Always enforce analytic solid-wall circle collision
                  const strict = resolveStrictWallCollision(
                    stepX,
                    stepZ,
                    navRes.x,
                    navRes.z,
                    0.36,
                    flWalls,
                    flOpenings,
                    floorW,
                    floorD
                  );

                  // 3. Final NavMesh guard so wall-sliding never pushes player into a non-walkable equipment/void cell
                  if (eng.navMesh && !eng.navMesh.isWalkable(strict.x, strict.z)) {
                    const reNav = eng.navMesh.resolveMove(stepX, stepZ, strict.x, strict.z);
                    if (eng.navMesh.isWalkable(reNav.x, reNav.z)) {
                      stepX = reNav.x;
                      stepZ = reNav.z;
                    }
                    break;
                  }

                  if (Math.hypot(strict.x - stepX, strict.z - stepZ) < 0.0005) {
                    break;
                  }
                  stepX = strict.x;
                  stepZ = strict.z;
                }

                eng.perspCamera.position.x = stepX;
                eng.perspCamera.position.z = stepZ;
                needsAnother = true;
              }
            }

            // Vertical Jump Physics (Spacebar)
            if (!eng.fpOnGround || Math.abs(eng.fpVelY) > 0.001) {
              eng.fpVelY -= 14.2 * dt;
              const nextY = eng.perspCamera.position.y + eng.fpVelY * dt;
              if (nextY <= eyeBaseY) {
                eng.perspCamera.position.y = eyeBaseY;
                eng.fpVelY = 0;
                eng.fpOnGround = true;
              } else {
                eng.perspCamera.position.y = nextY;
                needsAnother = true;
              }
            }

            // Throttled live sync for the handheld character tablet
            if (now - eng.lastFpUiSync > 160) {
              eng.lastFpUiSync = now;
              const cx = Number(eng.perspCamera.position.x.toFixed(1));
              const cz = Number(eng.perspCamera.position.z.toFixed(1));
              const jh = Math.max(0, Number((eng.perspCamera.position.y - eyeBaseY).toFixed(2)));
              const wp = eng.navMesh?.walkablePercent ?? 82;
              setFpState((prev) =>
                prev.x === cx && prev.z === cz && prev.jumpHeight === jh && prev.walkablePct === wp
                  ? prev
                  : { x: cx, z: cz, jumpHeight: jh, walkablePct: wp }
              );
            }
          }

          // Animated 3D Flow Pulse Beads
          if (storeRef.current.animateFlows && eng.flowPulses.length > 0) {
            for (const fp of eng.flowPulses) {
              fp.phase = (fp.phase + dt * fp.speed) % 1;
              const pt = fp.curve.getPointAt(fp.phase);
              fp.mesh.position.copy(pt);
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
          const nx = snapValue(obj.position.x, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid);
          const nz = snapValue(obj.position.z, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid);
          const asset = st.scene.assets.find((a) => a.id === assetId);
          if (asset) {
            st.updateAsset(
              assetId,
              {
                x: nx,
                z: nz,
                rotationY: Number(obj.rotation.y.toFixed(3)),
                width: Math.max(0.3, Number((asset.width * obj.scale.x).toFixed(2))),
                height: Math.max(0.3, Number((asset.height * obj.scale.y).toFixed(2))),
                depth: Math.max(0.3, Number((asset.depth * obj.scale.z).toFixed(2))),
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
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();

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
      if (eng && storeRef.current.firstPersonMode) {
        eng.fpLookDragging = true;
        eng.fpLookLastX = e.clientX;
        eng.fpLookLastY = e.clientY;
      }
    };

    let lastMoveRaycast = 0;
    const onPointerMove = (e: PointerEvent) => {
      const eng = engineRef.current;
      if (!eng) return;

      // True human-head first-person look rotation (yaw/pitch around eye position, NOT an orbit arc!)
      if (storeRef.current.firstPersonMode && eng.fpLookDragging) {
        const dx = e.clientX - eng.fpLookLastX;
        const dy = e.clientY - eng.fpLookLastY;
        eng.fpLookLastX = e.clientX;
        eng.fpLookLastY = e.clientY;
        eng.fpYaw -= dx * 0.0042;
        eng.fpPitch = Math.max(-1.22, Math.min(1.22, eng.fpPitch - dy * 0.0038));
        eng.perspCamera.rotation.order = 'YXZ';
        eng.perspCamera.rotation.set(eng.fpPitch, eng.fpYaw, 0);
        requestRender();
        return;
      }

      const now = performance.now();
      if (now - lastMoveRaycast < 60) return;
      lastMoveRaycast = now;
      getPointerNDC(e);
      raycaster.setFromCamera(pointer, eng.activeCamera);
      const activeFl = storeRef.current.scene.floors.find((f) => f.id === storeRef.current.activeFloorId);
      groundPlane.constant = -(activeFl?.elevation ?? 0);
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        storeRef.current.setCursorCoords({
          x: Number(hitPoint.x.toFixed(2)),
          y: Number((activeFl?.elevation ?? 0).toFixed(2)),
          z: Number(hitPoint.z.toFixed(2)),
        });
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

      if (st.activeTool === 'place-object') {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          st.addAsset(st.selectedObjectTemplateId, hitPoint.x, hitPoint.z);
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
        if (picked.entityType === 'room' || picked.entityType === 'wall' || picked.entityType === 'asset') {
          st.paintSurfaceWithMaterial(picked.entityType, picked.entityId, st.selectedMaterialId);
        }
        return;
      }

      if (st.activeTool === 'place-door' || st.activeTool === 'place-window') {
        if (picked?.entityType === 'wall') {
          st.addOpeningOnWall(picked.entityId, 0.5, st.selectedOpeningSubtype);
          st.setActiveTool('select');
        }
        return;
      }

      if (picked) {
        st.selectEntity({ type: picked.entityType as any, id: picked.entityId }, e.shiftKey);
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
      const templateId = e.dataTransfer?.getData('application/x-gradian-object');
      const materialId = e.dataTransfer?.getData('application/x-gradian-material');
      const eng = engineRef.current;
      if (!eng) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, eng.activeCamera);

      const st = storeRef.current;
      const activeFl = st.scene.floors.find((f) => f.id === st.activeFloorId);
      groundPlane.constant = -(activeFl?.elevation ?? 0);

      if (templateId) {
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
        if (e.code === 'Space') {
          e.preventDefault();
          const eng = engineRef.current;
          if (eng && eng.fpOnGround) {
            eng.fpVelY = 4.9;
            eng.fpOnGround = false;
            requestRender();
          }
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
      perspCamera.aspect = w / h;
      perspCamera.updateProjectionMatrix();
      const asp = w / h;
      orthoCamera.left = (-frustum * asp) / 2;
      orthoCamera.right = (frustum * asp) / 2;
      orthoCamera.top = frustum / 2;
      orthoCamera.bottom = -frustum / 2;
      orthoCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
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
      flowPulses: [],
      fpVelY: 0,
      fpOnGround: true,
      fpYaw: 0,
      fpPitch: 0,
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
        disposeObject3D(navMeshGroup);
        disposeObject3D(nightLightsGroup);
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

    if (showNavMesh) {
      const vis = buildNavMeshVisualGroup(nm, activeFl.elevation + 0.06);
      eng.navMeshGroup.add(vis);
    }
    eng.requestRender();
  }, [
    activeFloorId,
    sceneData.floors,
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
        // Disable OrbitControls so dragging rotates like a human head in-place (not an orbital arc!)
        eng.orbit.enabled = false;
        eng.camTargetPos = null;
        eng.camTargetLook = null;
        const spawn = eng.navMesh
          ? eng.navMesh.findNearestWalkable(cx - 4, cz + 2)
          : { x: cx - 4, z: cz + 2 };
        const eyeY = (activeFl?.elevation ?? 0) + 1.68;
        eng.fpVelY = 0;
        eng.fpOnGround = true;
        eng.perspCamera.position.set(spawn.x, eyeY, spawn.z);
        eng.fpYaw = Math.atan2(-(cx - spawn.x), -(cz - spawn.z));
        eng.fpPitch = -0.04;
        eng.perspCamera.rotation.order = 'YXZ';
        eng.perspCamera.rotation.set(eng.fpPitch, eng.fpYaw, 0);
        setFpState((prev) => ({
          ...prev,
          x: Number(spawn.x.toFixed(1)),
          z: Number(spawn.z.toFixed(1)),
          jumpHeight: 0,
        }));
      } else {
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
      // Snap directly inside room at eye-level with human head orientation
      const pos = cameraCommand.position;
      const tgt = cameraCommand.target;
      const safePos = eng.navMesh
        ? eng.navMesh.findNearestWalkable(pos[0], pos[2])
        : { x: pos[0], z: pos[2] };
      eng.perspCamera.position.set(safePos.x, pos[1], safePos.z);
      const dx = tgt[0] - safePos.x;
      const dz = tgt[2] - safePos.z;
      const dy = tgt[1] - pos[1];
      const horiz = Math.max(0.01, Math.hypot(dx, dz));
      eng.fpYaw = Math.atan2(-dx, -dz);
      eng.fpPitch = Math.max(-1.1, Math.min(1.1, Math.atan2(dy, horiz)));
      eng.perspCamera.rotation.order = 'YXZ';
      eng.perspCamera.rotation.set(eng.fpPitch, eng.fpYaw, 0);
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
                      0.36,
                      flWalls,
                      flOpenings,
                      activeFl?.width ?? 0,
                      activeFl?.depth ?? 0
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

  // Update TransformControls mode
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.transform.setMode(transformMode);
    eng.requestRender();
  }, [transformMode]);

  // Rebuild architectural floor grid
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    disposeObject3D(eng.gridHelper);
    eng.gridHelper.clear();

    if (snap.showGrid) {
      const isCampusOrOrgIso = drillLevel === 'campus' || isolatedAssetType !== null;
      const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
      const campusSpan = isCampusOrOrgIso
        ? Math.max(90, ...sceneData.buildings.map((b) => b.originX + b.width + 24))
        : Math.max(activeFl?.width ?? 40, activeFl?.depth ?? 40) + 20;
      const divisions = Math.max(16, Math.min(120, Math.round(campusSpan / Math.max(1, snap.gridSize * (isCampusOrOrgIso ? 2 : 1)))));
      const grid = new THREE.GridHelper(
        campusSpan,
        divisions,
        renderStyle === 'wireframe' ? 0x0ea5e9 : canvasBackdrop === 'dark' ? 0x27272a : 0xa1a1aa,
        renderStyle === 'wireframe' ? 0x0c4a6e : canvasBackdrop === 'dark' ? 0x18181b : 0xd4d4d8
      );
      grid.position.set(
        isCampusOrOrgIso ? campusSpan * 0.35 : (activeFl?.width ?? 36) / 2,
        isCampusOrOrgIso ? -0.06 : (activeFl?.elevation ?? 0) - 0.04,
        (activeFl?.depth ?? 22) / 2
      );
      const mat = grid.material as THREE.Material;
      mat.transparent = true;
      mat.opacity = Math.min(0.65, snap.gridOpacity + 0.1);
      eng.gridHelper.add(grid);
    }
    eng.requestRender();
  }, [snap.showGrid, snap.gridSize, snap.gridOpacity, activeFloorId, canvasBackdrop, drillLevel, isolatedAssetType, renderStyle, sceneData.buildings]);

  // Rebuild 3D Spatial Scene Graph cleanly whenever geometry/drill/isolation/renderStyle changes
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    eng.transform.detach();
    disposeObject3D(eng.contentGroup);
    eng.contentGroup.clear();
    eng.assetGroupMap.clear();
    eng.flowPulses = [];

    const maxAniso = eng.renderer.capabilities.getMaxAnisotropy();
    const allMats: MaterialDef[] = [...DEFAULT_MATERIALS, ...sceneData.customMaterials];
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

      // Architectural Floor Decomposition Riser Guide Columns when Exploded > 5%
      if (explodedFactor > 0.04 && bldgFloors.length > 1) {
        const sortedFloors = [...bldgFloors].sort((a, b) => a.levelIndex - b.levelIndex);
        const topFl = sortedFloors[sortedFloors.length - 1];
        const totalStackH = topFl.elevation + explodedFactor * topFl.levelIndex * 5.2 + topFl.height;
        const riserCorners: [number, number][] = [
          [0, 0],
          [bldg.width, 0],
          [bldg.width, bldg.depth],
          [0, bldg.depth],
        ];
        const riserMat = new THREE.LineDashedMaterial({
          color: '#F59E0B',
          dashSize: 0.45,
          gapSize: 0.3,
          transparent: true,
          opacity: 0.6,
        });
        riserCorners.forEach(([rx, rz]) => {
          const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(rx, 0, rz),
            new THREE.Vector3(rx, totalStackH, rz),
          ]);
          const line = new THREE.Line(lineGeo, riserMat);
          line.computeLineDistances();
          bldgGroup.add(line);
        });
      }

      bldgFloors.forEach((floor) => {
        const floorGroup = new THREE.Group();
        const explodedOffset = explodedFactor * floor.levelIndex * 5.2;
        floorGroup.position.y = floor.elevation + explodedOffset;
        floorGroup.userData = { entityType: 'floor', entityId: floor.id, buildingId: bldg.id };
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

        // 3. Rooms (Floor Finish Surfaces + Drill Focus Highlight + Blueprint Wireframe)
        if (isLayerVisible('layer-architecture')) {
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
                const rmGeo = new THREE.BoxGeometry(room.width, 0.04, room.depth);
                const rmMesh = new THREE.Mesh(
                  rmGeo,
                  new THREE.MeshBasicMaterial({
                    color: '#0EA5E9',
                    transparent: true,
                    opacity: isOrgIsolation || !matchesCat ? 0.06 : 0.14,
                    depthWrite: false,
                  })
                );
                rmMesh.position.set(roomCenterX, 0.02, room.z + room.depth / 2);
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
                rmEdge.position.copy(rmMesh.position);
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
                if (isDimmedByRoomDrill) {
                  floorMat.transparent = true;
                  floorMat.opacity = 0.25;
                }

                const rmMesh = new THREE.Mesh(new THREE.BoxGeometry(room.width, 0.04, room.depth), floorMat);
                rmMesh.position.set(roomCenterX, 0.02, room.z + room.depth / 2);
                rmMesh.receiveShadow = true;
                rmMesh.userData = { entityType: 'room', entityId: room.id, buildingId: bldg.id };
                floorGroup.add(rmMesh);

                if (isSel || isRoomDrilled || isCategoryXray) {
                  const selOutline = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.BoxGeometry(room.width, 0.09, room.depth)),
                    new THREE.LineBasicMaterial({
                      color: isRoomDrilled ? '#10B981' : isCategoryXray ? categoryMeta.color : '#3B82F6',
                    })
                  );
                  selOutline.position.set(roomCenterX, 0.06, room.z + room.depth / 2);
                  floorGroup.add(selOutline);
                }
              }
            });
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

                if (op.sillHeight > 0.04) {
                  addWallSeg(opW, op.sillHeight, opCenter, op.sillHeight / 2);
                }

                const topY = op.sillHeight + op.height;
                if (wall.height - topY > 0.04) {
                  const hdrH = wall.height - topY;
                  addWallSeg(opW, hdrH, opCenter, topY + hdrH / 2);
                }

                if (!wireMode && renderFrame) {
                  const opGroup = new THREE.Group();
                  opGroup.position.set(opCenter, op.sillHeight, 0);
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
                  const leftJ = new THREE.Mesh(new THREE.BoxGeometry(jambT, op.height, frameDepth), frameMat);
                  leftJ.position.set(-opW / 2 + jambT / 2, op.height / 2, 0);
                  leftJ.castShadow = true;
                  opGroup.add(leftJ);

                  const rightJ = new THREE.Mesh(new THREE.BoxGeometry(jambT, op.height, frameDepth), frameMat);
                  rightJ.position.set(opW / 2 - jambT / 2, op.height / 2, 0);
                  rightJ.castShadow = true;
                  opGroup.add(rightJ);

                  const topJ = new THREE.Mesh(new THREE.BoxGeometry(opW, jambT, frameDepth), frameMat);
                  topJ.position.set(0, op.height - jambT / 2, 0);
                  opGroup.add(topJ);

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
                    const paneH = Math.max(0.12, op.height - jambT - 0.055);
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
                    if (op.height > 1.45) {
                      const trans = new THREE.Mesh(
                        new THREE.BoxGeometry(paneW, 0.032, frameDepth * 0.65),
                        frameMat
                      );
                      trans.position.set(0, op.height * 0.72, 0);
                      opGroup.add(trans);
                    }
                  } else {
                    // Realistic architectural door assembly
                    const leafW = Math.max(0.35, opW - jambT * 2);
                    const leafH = Math.max(1.2, op.height - jambT);
                    const doorPivot = new THREE.Group();
                    // Hinge pivot on left jamb so open state swings realistically
                    doorPivot.position.set(-leafW / 2, 0, 0);
                    if (op.status === 'open') {
                      doorPivot.rotation.y = op.swingDirection === 'left' ? -Math.PI / 3 : Math.PI / 3;
                    }

                    // Overhead hydraulic door closer arm above header
                    const closer = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.055), hardwareMat);
                    closer.position.set(-leafW * 0.25, op.height - jambT - 0.035, frameDepth / 2 + 0.015);
                    opGroup.add(closer);

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

                    if (op.subtype === 'glass-door') {
                      // Frameless tempered glass architectural door with stainless patch fittings & dual vertical pull bars
                      const gLeaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.024), glassPaneMat);
                      gLeaf.position.set(leafW / 2, leafH / 2, 0);
                      gLeaf.renderOrder = 4;
                      doorPivot.add(gLeaf);

                      // Top & bottom stainless patch rails
                      const botRail = new THREE.Mesh(new THREE.BoxGeometry(leafW, 0.085, 0.036), hardwareMat);
                      botRail.position.set(leafW / 2, 0.045, 0);
                      const topPatch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.038), hardwareMat);
                      topPatch.position.set(0.1, leafH - 0.035, 0);
                      doorPivot.add(botRail, topPatch);

                      addPullHandle(doorPivot, leafW - 0.14, 1.06, true);
                    } else if (op.subtype === 'double-door' || op.subtype === 'sliding-door' || op.subtype === 'automatic-door') {
                      const isSliding = op.subtype === 'sliding-door' || op.subtype === 'automatic-door';
                      const halfW = leafW / 2 - 0.012;
                      const leafColor = isSliding ? '#D6DCE5' : '#E2E8F0';
                      const solidLeafMat = new THREE.MeshStandardMaterial({
                        color: leafColor,
                        roughness: 0.28,
                        metalness: 0.34,
                        clippingPlanes: clipPlanes,
                      });
                      const kickMat = new THREE.MeshStandardMaterial({
                        color: '#CBD5E1',
                        roughness: 0.2,
                        metalness: 0.88,
                        clippingPlanes: clipPlanes,
                      });

                      // Overhead aluminum track for sliding/automatic doors
                      if (isSliding) {
                        const rail = new THREE.Mesh(
                          new THREE.BoxGeometry(opW + 0.5, 0.09, frameDepth + 0.04),
                          frameMat
                        );
                        rail.position.set(0, op.height + 0.03, 0);
                        opGroup.add(rail);
                      }

                      for (const side of [-1, 1]) {
                        const slideShift = isSliding && op.status === 'open' ? side * halfW * 0.65 : 0;
                        const cx = leafW / 2 + side * (halfW / 2 + 0.008) + slideShift;
                        const leaf = new THREE.Mesh(new THREE.BoxGeometry(halfW, leafH, 0.05), solidLeafMat);
                        leaf.position.set(cx, leafH / 2, 0);
                        leaf.castShadow = true;
                        doorPivot.add(leaf);

                        // Stainless kickplate
                        const kick = new THREE.Mesh(new THREE.BoxGeometry(halfW - 0.04, 0.28, 0.056), kickMat);
                        kick.position.set(cx, 0.16, 0);
                        doorPivot.add(kick);

                        // Recessed glazed vision-lite window
                        const vw = Math.min(0.32, halfW * 0.44);
                        const vh = Math.min(0.82, leafH * 0.38);
                        const vFrame = new THREE.Mesh(new THREE.BoxGeometry(vw + 0.04, vh + 0.04, 0.056), frameMat);
                        vFrame.position.set(cx, leafH * 0.62, 0);
                        const vGlass = new THREE.Mesh(new THREE.BoxGeometry(vw, vh, 0.06), glassPaneMat);
                        vGlass.position.set(cx, leafH * 0.62, 0);
                        doorPivot.add(vFrame, vGlass);

                        addPullHandle(doorPivot, cx - side * (halfW * 0.32), 1.04, true);
                      }
                    } else {
                      // Cleanroom, airlock, fire, emergency, security, or standard architectural single door
                      const isFire = op.subtype === 'fire-door' || op.subtype === 'emergency-door';
                      const isCleanroom = op.subtype === 'cleanroom-door' || op.subtype === 'airlock-door';
                      const leafColor = isFire ? '#B91C1C' : isCleanroom ? '#F1F5F9' : '#CBD5E1';
                      const solidLeafMat = new THREE.MeshStandardMaterial({
                        color: leafColor,
                        roughness: isCleanroom ? 0.24 : 0.38,
                        metalness: isFire ? 0.45 : 0.2,
                        clippingPlanes: clipPlanes,
                      });
                      const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.052), solidLeafMat);
                      leaf.position.set(leafW / 2, leafH / 2, 0);
                      leaf.castShadow = true;
                      doorPivot.add(leaf);

                      // Stainless kickplate at bottom
                      const kick = new THREE.Mesh(
                        new THREE.BoxGeometry(leafW - 0.04, 0.26, 0.058),
                        hardwareMat
                      );
                      kick.position.set(leafW / 2, 0.15, 0);
                      doorPivot.add(kick);

                      // Flush vision-lite glass window on cleanroom / airlock / fire doors
                      if (isCleanroom || isFire || leafW >= 0.88) {
                        const vw = isFire ? 0.18 : Math.min(0.36, leafW * 0.38);
                        const vh = isFire ? 0.72 : Math.min(0.68, leafH * 0.32);
                        const vx = isFire ? leafW * 0.72 : leafW * 0.56;
                        const vFrame = new THREE.Mesh(new THREE.BoxGeometry(vw + 0.045, vh + 0.045, 0.058), frameMat);
                        vFrame.position.set(vx, leafH * 0.64, 0);
                        const vGlass = new THREE.Mesh(new THREE.BoxGeometry(vw, vh, 0.062), glassPaneMat);
                        vGlass.position.set(vx, leafH * 0.64, 0);
                        doorPivot.add(vFrame, vGlass);
                      }

                      // Interlock status LED indicator above cleanroom / airlock doors
                      if (isCleanroom || op.accessControl === 'interlock' || op.accessControl === 'badge') {
                        const ledColor =
                          op.status === 'alarm'
                            ? '#EF4444'
                            : op.status === 'interlocked'
                              ? '#F59E0B'
                              : '#10B981';
                        const led = new THREE.Mesh(
                          new THREE.BoxGeometry(0.18, 0.042, 0.03),
                          new THREE.MeshBasicMaterial({ color: ledColor })
                        );
                        led.position.set(0, op.height + 0.055, frameDepth / 2 + 0.01);
                        opGroup.add(led);
                      }

                      if (isFire) {
                        // Horizontal panic crash bar
                        const crashBar = new THREE.Mesh(
                          new THREE.BoxGeometry(leafW * 0.74, 0.06, 0.06),
                          new THREE.MeshStandardMaterial({ color: '#FACC15', roughness: 0.3, metalness: 0.4 })
                        );
                        crashBar.position.set(leafW / 2, 1.0, 0.055);
                        doorPivot.add(crashBar);
                      } else {
                        addPullHandle(doorPivot, leafW - 0.12, 1.02, isCleanroom);
                      }
                    }

                    opGroup.add(doorPivot);
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

            // Glowing beacon ring around matched assets during Org-Wide Isolation, Category X-Ray, OR Production Line Eligibility Check
            if (isOrgIsolation || isLineFailAsset || isLineOkAsset || (isCategoryXray && assetMatchesCategory)) {
              const beaconHex = isLineFailAsset
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

        // 7. 3D Flow & Connectivity Ribbons + Isolation Mode + Room Sequence Markers + Animated Pulse Beads
        if (showFlows && isLayerVisible('layer-flows') && !isOrgIsolation) {
          sceneData.flows
            .filter((f) => {
              if (f.floorId !== floor.id || f.points.length < 2) return false;
              if (isolatedFlowId) return f.id === isolatedFlowId;
              return !hiddenFlowIds.includes(f.id);
            })
            .forEach((flow) => {
              const isIsolated = isolatedFlowId === flow.id;
              const pts = flow.points.map((p) => new THREE.Vector3(p.x, isIsolated ? 0.32 : 0.24, p.z));
              const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
              const tubeGeo = new THREE.TubeGeometry(
                curve,
                Math.max(16, pts.length * 10),
                isIsolated ? 0.115 : 0.085,
                8,
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
              floorGroup.add(mesh);

              // When this flow is isolated, highlight every room it traverses with a glowing floor rim
              if (isIsolated) {
                const seq = computeFlowRoomSequence(flow, sceneData.rooms);
                seq.steps.forEach((st) => {
                  const rm = sceneData.rooms.find((r) => r.id === st.roomId);
                  if (!rm) return;
                  const rimGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(rm.width - 0.14, 0.06, rm.depth - 0.14));
                  const rim = new THREE.LineSegments(
                    rimGeo,
                    new THREE.LineBasicMaterial({ color: flow.color })
                  );
                  rim.position.set(rm.x + rm.width / 2, 0.08, rm.z + rm.depth / 2);
                  floorGroup.add(rim);

                  const beacon = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.26, 0.32, 0.08, 16),
                    new THREE.MeshBasicMaterial({ color: flow.color })
                  );
                  beacon.position.set(st.centerX, 0.07, st.centerZ);
                  floorGroup.add(beacon);
                });
              }

              // Animated glowing flow packets traveling along the route
              if (animateFlows && flow.animated !== false) {
                const pulseCount = Math.min(5, Math.max(2, Math.round(curve.getLength() / 5.5)));
                for (let pIdx = 0; pIdx < pulseCount; pIdx++) {
                  const bead = new THREE.Mesh(
                    new THREE.SphereGeometry(isIsolated ? 0.21 : 0.17, 10, 10),
                    new THREE.MeshBasicMaterial({ color: '#FFFFFF' })
                  );
                  const halo = new THREE.Mesh(
                    new THREE.SphereGeometry(isIsolated ? 0.34 : 0.28, 10, 10),
                    new THREE.MeshBasicMaterial({
                      color: flow.color,
                      transparent: true,
                      opacity: isIsolated ? 0.62 : 0.45,
                      depthWrite: false,
                    })
                  );
                  bead.add(halo);
                  const phase = pIdx / pulseCount;
                  bead.position.copy(curve.getPointAt(phase));
                  floorGroup.add(bead);
                  eng.flowPulses.push({
                    mesh: bead,
                    curve,
                    phase,
                    speed: 0.18 + (pIdx % 2) * 0.03,
                  });
                }
              }

              const last = pts[pts.length - 1];
              const prev = pts[pts.length - 2];
              const dir = new THREE.Vector3().subVectors(last, prev).normalize();
              const arrow = new THREE.Mesh(
                new THREE.ConeGeometry(isIsolated ? 0.3 : 0.24, isIsolated ? 0.64 : 0.52, 10),
                new THREE.MeshStandardMaterial({
                  color: flow.color,
                  emissive: flow.color,
                  emissiveIntensity: isIsolated ? 1.2 : lightingMode === 'night' ? 0.9 : 0.45,
                })
              );
              arrow.position.copy(last);
              arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
              floorGroup.add(arrow);
            });
        }

        // 8. Measurement Tape Line in 3D
        if (measurePoints.length === 2 && floor.id === activeFloorId) {
          const p1 = new THREE.Vector3(measurePoints[0].x, 0.2, measurePoints[0].z);
          const p2 = new THREE.Vector3(measurePoints[1].x, 0.2, measurePoints[1].z);
          const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
          const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#F59E0B' }));
          floorGroup.add(line);
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

        // 9.5. 3D HVAC Ductwork, HEPA Terminal Diffusers & Airflow Indicators
        if (showHvacOverlay && !isOrgIsolation) {
          const floorHvacRooms = sceneData.rooms.filter((r) => {
            if (r.floorId !== floor.id) return false;
            if (hvacAhuFilter === 'all') return true;
            return getEffectiveRoomHvac(r).ahuId === hvacAhuFilter;
          });

          if (floorHvacRooms.length > 0) {
            const ductY = Math.max(2.5, floor.height - 0.36);
            const returnY = Math.max(2.3, ductY - 0.26);
            const spineZ = Number((floor.depth * 0.5).toFixed(2));
            const minRoomX = Math.max(1.2, Math.min(...floorHvacRooms.map((r) => r.x + r.width / 2)));
            const maxRoomX = Math.min(floor.width - 1.2, Math.max(...floorHvacRooms.map((r) => r.x + r.width / 2)));
            const trunkLen = Math.max(2.0, maxRoomX - minRoomX + 1.2);
            const trunkCenterX = (minRoomX + maxRoomX) / 2;

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

            // Main horizontal supply & return plenum trunks
            const supplyTrunk = new THREE.Mesh(
              new THREE.BoxGeometry(trunkLen, 0.26, 0.42),
              supplyTrunkMat
            );
            supplyTrunk.position.set(trunkCenterX, ductY, spineZ - 0.26);
            floorGroup.add(supplyTrunk);

            const returnTrunk = new THREE.Mesh(
              new THREE.BoxGeometry(trunkLen, 0.22, 0.34),
              returnTrunkMat
            );
            returnTrunk.position.set(trunkCenterX, returnY, spineZ + 0.28);
            floorGroup.add(returnTrunk);

            // Per-room branch ducts, HEPA ceiling diffusers, damper status collars & airflow cones
            floorHvacRooms.forEach((rm) => {
              const cfg = getEffectiveRoomHvac(rm);
              const ahuColor = getAhuColor(cfg.ahuId);
              const rcx = rm.x + rm.width / 2;
              const rcz = rm.z + rm.depth / 2;

              const branchMat = new THREE.MeshStandardMaterial({
                color: ahuColor,
                metalness: 0.52,
                roughness: 0.3,
                emissive: ahuColor,
                emissiveIntensity: 0.22,
                clippingPlanes: clipPlanes,
              });

              const branchLen = Math.abs(rcz - (spineZ - 0.26));
              if (branchLen > 0.35) {
                const branch = new THREE.Mesh(
                  new THREE.BoxGeometry(0.24, 0.18, branchLen),
                  branchMat
                );
                branch.position.set(rcx, ductY, (rcz + (spineZ - 0.26)) / 2);
                floorGroup.add(branch);
              }

              // Return stub
              const retLen = Math.abs(rcz - (spineZ + 0.28));
              if (retLen > 0.35) {
                const retBranch = new THREE.Mesh(
                  new THREE.BoxGeometry(0.18, 0.14, retLen),
                  returnTrunkMat
                );
                retBranch.position.set(rcx + 0.34, returnY, (rcz + (spineZ + 0.28)) / 2);
                floorGroup.add(retBranch);
              }

              // HEPA diffuser terminal boxes distributed cleanly across room ceiling
              const diffCount = Math.max(1, Math.min(8, cfg.diffuserCount));
              const cols = diffCount <= 2 ? diffCount : Math.ceil(Math.sqrt(diffCount * (rm.width / Math.max(1, rm.depth))));
              const rows = Math.max(1, Math.ceil(diffCount / Math.max(1, cols)));
              const statusHex =
                cfg.systemStatus === 'alarm'
                  ? '#F43F5E'
                  : cfg.systemStatus === 'maintenance'
                    ? '#F59E0B'
                    : cfg.systemStatus === 'standby'
                      ? '#71717A'
                      : ahuColor;

              const diffuserMat = new THREE.MeshStandardMaterial({
                color: '#E4E4E7',
                metalness: 0.65,
                roughness: 0.25,
                clippingPlanes: clipPlanes,
              });
              const collarMat = new THREE.MeshStandardMaterial({
                color: statusHex,
                emissive: statusHex,
                emissiveIntensity: cfg.systemStatus === 'alarm' ? 0.9 : 0.45,
                roughness: 0.3,
                clippingPlanes: clipPlanes,
              });
              const coneMat = new THREE.MeshBasicMaterial({
                color: cfg.targetPressurePa < 0 ? '#F59E0B' : '#38BDF8',
                transparent: true,
                opacity: 0.32,
                depthWrite: false,
                clippingPlanes: clipPlanes,
              });

              let placed = 0;
              for (let rIdx = 0; rIdx < rows && placed < diffCount; rIdx++) {
                for (let cIdx = 0; cIdx < cols && placed < diffCount; cIdx++) {
                  const dx = rm.x + ((cIdx + 0.5) / cols) * rm.width;
                  const dz = rm.z + ((rIdx + 0.5) / rows) * rm.depth;
                  const diffBox = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.62), diffuserMat);
                  diffBox.position.set(dx, ductY - 0.16, dz);
                  diffBox.userData = { entityType: 'room', entityId: rm.id, buildingId: bldg.id };
                  floorGroup.add(diffBox);

                  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.04, 0.68), collarMat);
                  collar.position.set(dx, ductY - 0.22, dz);
                  floorGroup.add(collar);

                  // Subtle airflow plume cone (downward for supply/positive, upward for negative exhaust)
                  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 8, 1, true), coneMat);
                  cone.position.set(dx, ductY - 0.54, dz);
                  if (cfg.targetPressurePa >= 0) {
                    cone.rotation.x = Math.PI;
                  }
                  floorGroup.add(cone);

                  // Tie diffuser to room branch manifold if offset from center
                  const dDist = Math.hypot(dx - rcx, dz - rcz);
                  if (dDist > 0.35) {
                    const flex = new THREE.Mesh(
                      new THREE.CylinderGeometry(0.06, 0.06, dDist, 6),
                      branchMat
                    );
                    flex.position.set((dx + rcx) / 2, ductY - 0.04, (dz + rcz) / 2);
                    flex.rotation.z = Math.PI / 2;
                    flex.rotation.y = -Math.atan2(dz - rcz, dx - rcx);
                    floorGroup.add(flex);
                  }
                  placed++;
                }
              }
            });
          }
        }

        // 10. Active IT Network Port & Cable End-to-End 3D Trace (Overhead Cable Tray + Drop Risers + Hop Beacons)
        if (activeNetworkTrace && floor.id === activeFloorId) {
          const floorHops = activeNetworkTrace.hops.filter(
            (h) => !h.floorId || h.floorId === floor.id
          );
          const traceHops = floorHops.length > 0 ? floorHops : activeNetworkTrace.hops;
          const traceHex =
            activeNetworkTrace.status === 'error'
              ? '#F43F5E'
              : activeNetworkTrace.status === 'warning'
                ? '#F59E0B'
                : '#06B6D4';

          const trayY = Math.max(2.65, floor.height - 0.55);
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

          // Render hop beacons + vertical cable risers to overhead tray
          traceHops.forEach((hop) => {
            const baseY = hop.kind === 'user-node' ? 1.1 : 1.7;
            const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), beaconMat);
            beacon.position.set(hop.x, baseY, hop.z);
            floorGroup.add(beacon);

            const ring = new THREE.Mesh(
              new THREE.TorusGeometry(0.42, 0.04, 10, 28),
              riserMat
            );
            ring.rotation.x = Math.PI / 2;
            ring.position.set(hop.x, 0.08, hop.z);
            floorGroup.add(ring);

            const riserH = Math.max(0.4, trayY - baseY);
            const riser = new THREE.Mesh(
              new THREE.CylinderGeometry(0.045, 0.045, riserH, 8),
              riserMat
            );
            riser.position.set(hop.x, baseY + riserH / 2, hop.z);
            floorGroup.add(riser);
          });

          // Overhead glowing conduit connecting all hops in order
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
              new THREE.TubeGeometry(curve, Math.max(32, traceHops.length * 24), 0.075, 10, false),
              new THREE.MeshStandardMaterial({
                color: traceHex,
                emissive: traceHex,
                emissiveIntensity: 1.25,
                roughness: 0.18,
              })
            );
            floorGroup.add(tube);

            // Animated data packet pulses travelling along traced cable
            const pulseMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
            for (let pIdx = 0; pIdx < 4; pIdx++) {
              const bead = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), pulseMat);
              const phase = pIdx / 4;
              bead.position.copy(curve.getPointAt(phase));
              floorGroup.add(bead);
              eng.flowPulses.push({
                mesh: bead,
                curve,
                phase,
                speed: 0.28,
              });
            }
          }
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
    animateFlows,
    showFlows,
    isolatedFlowId,
    hiddenFlowIds,
    explodedFactor,
    timelineDate,
    activeTool,
    pendingAIActions,
    measurePoints,
    activeLineHighlight,
    activeNetworkTrace,
    showHvacOverlay,
    hvacAhuFilter,
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
          readings,
          heatmapMetric
        );
        entry.texture.needsUpdate = true;
        const mat = entry.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = heatmapOpacity;
        entry.mesh.visible = true;

        const ox = isMultiBuilding ? bldg.originX : 0;
        const oz = isMultiBuilding ? bldg.originZ : 0;
        const explodedOffset = explodedFactor * floor.levelIndex * 5.2;
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
  }, [
    heatmapMetric,
    heatmapOpacity,
    sensors,
    readings,
    sceneData.buildings,
    sceneData.floors,
    sceneData.rooms,
    activeFloorId,
    activeBuildingId,
    drillLevel,
    showAllFloors,
    explodedFactor,
    isolatedAssetType,
  ]);

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

  // Project 3D sensor & architectural room pin coordinates directly onto DOM elements (zero React re-renders during orbit)
  useEffect(() => {
    const projectAll = () => {
      const eng = engineRef.current;
      const container = mountRef.current;
      if (!eng || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;

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
        el.style.opacity = inBounds ? '1' : '0';
        el.style.pointerEvents = inBounds ? 'auto' : 'none';
        el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%)`;
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
        el.style.opacity = inBounds ? '1' : '0';
        el.style.pointerEvents = inBounds ? 'auto' : 'none';
        el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
      });
    };

    projectPinsRef.current = projectAll;
    projectAll();
  }, [visibleSensorPins, visibleRoomPins, readings]);

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

  const renderStyleOptions: { id: RenderStyle; label: string }[] = [
    { id: 'realistic', label: 'Studio PBR' },
    { id: 'blueprint-split', label: 'Twin Split' },
    { id: 'wireframe', label: 'X-Ray CAD' },
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
    <div className="relative w-full h-full overflow-hidden select-none">
      <div ref={mountRef} className="w-full h-full" />

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

      {/* Top-Left: Spatial 3D Drill-Down Breadcrumb HUD (hidden during Walk Mode for clean viewport) */}
      {!firstPersonMode && (
        <div className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1.5 rounded-2xl bg-white dark:bg-[#131319] border border-zinc-200 dark:border-zinc-800 shadow-xl text-[11px] max-w-[calc(100%-220px)] sm:max-w-[calc(100%-340px)] overflow-x-auto z-20">
          {drillLevel !== 'campus' && (
            <button
              onClick={handleDrillStepBack}
              className="flex items-center gap-1 px-2 py-1 rounded-xl bg-zinc-100 dark:bg-[#1C1C26] text-zinc-700 dark:text-zinc-200 hover:bg-violet-600 hover:text-white transition-colors shrink-0 mr-0.5 cursor-pointer"
              title="Step Back Up One Spatial Level"
            >
              <ArrowLeft className="w-3 h-3" />
            </button>
          )}

          <button
            onClick={() => drillInto('campus')}
            className={`flex items-center gap-1 px-2 py-1 rounded-xl whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              drillLevel === 'campus'
                ? 'bg-violet-600 text-white font-semibold'
                : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            title="Zoom out to Full Campus"
          >
            <Globe className="w-3 h-3" />
            Campus
          </button>

          {activeBuilding && (
            <>
              <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
              <button
                onClick={() => drillInto('building', activeBuilding.id)}
                className={`flex items-center gap-1 px-2 py-1 rounded-xl whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  drillLevel === 'building'
                    ? 'bg-violet-600 text-white font-semibold'
                    : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Building2 className="w-3 h-3" />
                {activeBuilding.code}
              </button>
            </>
          )}

          {activeFloor && (
            <>
              <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
              <button
                onClick={() => drillInto('floor', activeFloor.id)}
                className={`flex items-center gap-1 px-2 py-1 rounded-xl whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  drillLevel === 'floor'
                    ? 'bg-violet-600 text-white font-semibold'
                    : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Layers className="w-3 h-3" />
                {activeFloor.code}
              </button>
            </>
          )}

          {activeDept && (
            <>
              <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
              <button
                onClick={() => drillInto('department', activeDept.id)}
                className={`px-2 py-1 rounded-xl whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  drillLevel === 'department'
                    ? 'bg-violet-600 text-white font-semibold'
                    : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
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
                className={`px-2 py-1 rounded-xl whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  drillLevel === 'room'
                    ? 'bg-violet-600 text-white font-semibold'
                    : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {activeRoom.code}
              </button>
            </>
          )}

          {activeAsset && drillLevel === 'asset' && (
            <>
              <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
              <span className="px-2 py-1 rounded-xl bg-amber-500 text-zinc-950 font-mono font-semibold whitespace-nowrap shrink-0">
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
            className="ml-1 pl-1.5 border-l border-zinc-200 dark:border-zinc-800 p-1 text-zinc-500 hover:text-violet-500 shrink-0 cursor-pointer"
            title="Copy Direct URL to current 3D view & layer"
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top-Right: Room Pins + Night Mode Architectural Spotlights + Render Style Switcher */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
        {!firstPersonMode && (
          <button
            onClick={() => setShowRoomPins(!showRoomPins)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-2xl border shadow-xl text-[11px] font-semibold transition-colors cursor-pointer ${
              showRoomPins
                ? 'bg-[#151520] border-violet-500/60 text-violet-300'
                : 'bg-white dark:bg-[#131319] border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-violet-500'
            }`}
            title="Toggle Floating 3D Room Number Pins & Walk-Inside Cards"
          >
            <MapPin className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Rooms</span>
          </button>
        )}

        <button
          onClick={toggleLightingMode}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-2xl border shadow-xl text-[11px] font-semibold transition-colors cursor-pointer ${
            lightingMode === 'night'
              ? 'bg-[#151520] border-amber-500/70 text-amber-300'
              : 'bg-white dark:bg-[#131319] border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-violet-500'
          }`}
          title="Toggle Day / Night Mode Architectural Spotlights"
        >
          {lightingMode === 'night' ? (
            <>
              <Moon className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Night Spots</span>
            </>
          ) : (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span className="hidden sm:inline">Daylight</span>
            </>
          )}
        </button>

        {!firstPersonMode && (
          <div className="hidden sm:flex items-center gap-0.5 p-1 rounded-2xl bg-white dark:bg-[#131319] border border-zinc-200 dark:border-zinc-800 shadow-xl text-[11px]">
            {renderStyleOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setRenderStyle(opt.id)}
                className={`px-2.5 py-1 rounded-xl font-medium whitespace-nowrap transition-colors cursor-pointer ${
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
            <button
              type="button"
              onClick={() => {
                const next = explodedFactor < 0.25 ? 0.5 : explodedFactor < 0.85 ? 1 : 0;
                setExplodedFactor(next);
                if (next > 0 && !showAllFloors && drillLevel !== 'campus') {
                  setShowAllFloors(true);
                }
              }}
              className={`min-w-[38px] h-7 px-1.5 rounded-xl font-mono text-[9.5px] font-bold tabular-nums transition-colors cursor-pointer ${
                explodedFactor > 0.04
                  ? 'bg-amber-500 text-zinc-950 shadow-md'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
              title="Cycle Floor Decomposition / Exploded View (0% → 50% → 100%)"
            >
              {explodedFactor > 0.04 ? `${Math.round(explodedFactor * 100)}%` : 'EXP'}
            </button>
          </div>
        );
      })()}

      {/* 3D Projected Architectural Room Number Pins with FMEA Status Indicators */}
      {showRoomPins && visibleRoomPins.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {visibleRoomPins.map((rp) => {
            const isActiveSpot = spotlightRoomId === rp.room.id;
            const hasFlowStep = rp.flowStep !== null;
            const fmea = showFmeaIndicators
              ? getTargetFmeaSummary(riskIncidents, 'room', rp.room.id, true)
              : null;
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
                className="absolute top-0 left-0 transition-opacity duration-150 flex items-center gap-1"
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

      {/* Floating Multi-Axis Section Cut Bar with Instant Reset */}
      {sectionCutEnabled && (
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
            <div className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-[#111116]/95 border border-violet-500/50 text-zinc-100 text-[11px] shadow-2xl overflow-x-auto max-w-full">
              <span className="flex items-center gap-1.5 font-semibold text-violet-300 whitespace-nowrap shrink-0">
                <Footprints className="w-3.5 h-3.5" />
                Walk Mode
              </span>
              <span className="hidden md:inline text-zinc-600">|</span>
              <span className="hidden md:inline font-mono text-[10px] text-zinc-300 whitespace-nowrap">
                Joystick / WASD · Drag to Look
              </span>
              <span className="text-zinc-600">|</span>
              <button
                type="button"
                onClick={() => setShowNavMesh(!showNavMesh)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  showNavMesh
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {showNavMesh ? 'NavMesh On' : 'NavMesh'}
              </button>
              <button
                type="button"
                onClick={() => setFirstPersonTabletVisible(!firstPersonTabletVisible)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 text-zinc-200 text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                {firstPersonTabletVisible ? <EyeOff className="w-3 h-3" /> : <Tablet className="w-3 h-3" />}
                {firstPersonTabletVisible ? 'Hide Pad' : 'Field Pad'}
              </button>
              <button
                type="button"
                onClick={() => setFirstPersonMode(false)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <X className="w-3 h-3" /> Exit
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

      {/* 3D Projected Compact Non-Overlapping Sensor Beacon Chips with FMEA Indicators */}
      {show3DSensorPins && visibleSensorPins.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {visibleSensorPins.map((pin) => {
            const snap = readings[pin.mainSensor.id];
            const val = snap?.value ?? pin.mainSensor.nominal;
            const status = snap?.status ?? 'nominal';
            const isInspected = inspectedPinKey === pin.key;
            const pinFmea = showFmeaIndicators
              ? getTargetFmeaSummary(
                  riskIncidents,
                  pin.targetKind === 'room' ? 'room' : 'asset',
                  pin.targetId
                )
              : null;
            const dotCls =
              status === 'alarm' || pinFmea?.level === 'critical'
                ? 'bg-rose-500'
                : status === 'warning' || pinFmea?.level === 'high'
                  ? 'bg-amber-400'
                  : 'bg-emerald-400';
            const borderCls = isInspected
              ? 'border-violet-400 ring-2 ring-violet-500/40'
              : status === 'alarm' || pinFmea?.level === 'critical'
                ? 'border-rose-500/90'
                : status === 'warning' || pinFmea?.level === 'high'
                  ? 'border-amber-500/80'
                  : 'border-zinc-700/90 hover:border-violet-400';

            return (
              <div
                key={pin.key}
                ref={(el) => {
                  if (el) pinDomRefs.current.set(pin.key, el);
                  else pinDomRefs.current.delete(pin.key);
                }}
                style={{ opacity: 0, willChange: 'transform' }}
                className="absolute top-0 left-0 transition-opacity duration-150"
              >
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setInspectedPinKey(isInspected ? null : pin.key)}
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
                  {pinFmea && pinFmea.level !== 'clear' && pinFmea.worstIncident && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openRiskModal({ mode: 'resolve', incidentId: pinFmea.worstIncident!.id });
                      }}
                      className={`px-1.5 py-0.5 rounded-md text-[9.5px] font-mono font-bold tabular-nums shadow-lg cursor-pointer ${
                        pinFmea.level === 'critical'
                          ? 'bg-rose-500 text-white'
                          : pinFmea.level === 'high'
                            ? 'bg-amber-400 text-zinc-950'
                            : pinFmea.level === 'mitigated'
                              ? 'bg-emerald-500 text-zinc-950'
                              : 'bg-violet-500 text-white'
                      }`}
                      title={`FMEA ${pinFmea.shortLabel}: ${pinFmea.worstIncident.title}`}
                    >
                      {pinFmea.shortLabel}
                    </button>
                  )}
                </div>
                <div className="mx-auto w-px h-2.5 bg-violet-500/60" />
              </div>
            );
          })}
        </div>
      )}

      {/* Focused Single-Object 3D & Live Telemetry Inspection Dialog (Opaque Charcoal, Zero WebGL Blur) */}
      {inspectedPin && (
        <div className="absolute top-16 left-3 z-30 w-[356px] max-w-[calc(100%-24px)] rounded-3xl bg-white dark:bg-[#13131A] border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181822] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setInspectedPinKey(null)}
                className="p-1.5 rounded-xl bg-white dark:bg-[#22222F] border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-violet-500 hover:text-violet-500 transition-colors shrink-0"
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
              className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
              title="Close Inspector"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3.5 space-y-3">
            {/* Dedicated Focused 3D Turntable Viewer for THIS Specific Object */}
            <AssetMini3DViewer
              asset={inspectedAssetObj}
              room={inspectedRoomObj}
              height={186}
              statusAccent={readings[inspectedPin.mainSensor.id]?.status ?? 'nominal'}
            />

            {/* Primary & Secondary Live Sensors */}
            {(() => {
              const allCh = [inspectedPin.mainSensor, ...inspectedPin.secondarySensors];
              return (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
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
              );
            })()}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => {
                  openDashboard({
                    tab: 'trends',
                    assetId: inspectedPin.targetKind === 'asset' ? inspectedPin.targetId : null,
                    roomId: inspectedPin.targetKind === 'room' ? inspectedPin.targetId : null,
                    sensorId: inspectedPin.mainSensor.id,
                  });
                  setInspectedPinKey(null);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
              >
                <Activity className="w-3.5 h-3.5" />
                Live Trends &amp; Tags
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
                className="flex items-center gap-1.5 py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#1C1C26] hover:border-amber-500 text-zinc-700 dark:text-zinc-200 text-xs font-medium transition-colors"
                title="Open Detailed Telemetry in New Tab"
              >
                <ExternalLink className="w-3.5 h-3.5 text-amber-500" />
                New Tab
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
            {/* Contextual Action Bar (always stacked cleanly ABOVE the dock — never overlaps) */}
            {!spotlightRoomId && activeTool !== 'select' && (
              <div className="pointer-events-none px-3 py-1.5 rounded-xl bg-violet-600 text-white text-[11px] font-medium shadow-lg text-center">
                {activeTool === 'place-object' && 'Click floor in 3D to place selected equipment'}
                {activeTool === 'paint-material' && 'Click any room floor, wall, or equipment to paint material'}
                {activeTool === 'place-camera' && 'Click floor to place new camera'}
                {activeTool === 'place-door' && 'Click any wall to insert door opening'}
                {activeTool === 'place-window' && 'Click any wall to insert observation window'}
                {activeTool === 'measure' && 'Click two points on the floor to measure distance'}
                {(activeTool === 'draw-room' || activeTool === 'draw-wall' || activeTool === 'draw-flow') &&
                  'Switch to 2D or Split View to draft rooms, walls, and routes with precision'}
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
            {/* Bottom-Left Tactile 360° Virtual Walk Joystick + Sprint & Jump Controls */}
            <div className="absolute bottom-4 left-4 z-30 flex items-end gap-2.5 select-none">
              <div
                ref={joyPadRef}
                onPointerDown={handleJoyPointerDown}
                onPointerMove={handleJoyPointerMove}
                onPointerUp={handleJoyPointerUp}
                onPointerCancel={handleJoyPointerUp}
                className="relative w-[112px] h-[112px] rounded-full bg-[#0F1016]/90 border-2 border-zinc-700/80 shadow-[0_12px_36px_rgba(0,0,0,0.65)] touch-none cursor-grab active:cursor-grabbing flex items-center justify-center"
                title="Drag to walk (walls & glass solid, doors passable)"
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

              {/* Sprint Toggle & Jump Action Buttons */}
              <div className="flex flex-col gap-2 pb-1">
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
                <button
                  type="button"
                  onClick={triggerWalkJump}
                  className="w-10 h-10 rounded-full bg-[#12131A]/90 border border-zinc-700 hover:border-violet-400 text-zinc-200 flex items-center justify-center shadow-lg active:scale-95 transition cursor-pointer"
                  title="Jump (Space)"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Ruggedized Field Pad — anchored bottom-right on mobile/tablet and bottom-center on lg+ so it NEVER collides with the bottom-left Joystick */}
            {firstPersonTabletVisible && (
              <div
                className="absolute bottom-3 right-3 lg:bottom-0 lg:left-1/2 lg:-translate-x-1/2 lg:right-auto z-20 pointer-events-auto flex items-end justify-center transition-transform duration-150"
                style={{ transform: `translateY(${Math.min(18, fpState.jumpHeight * 14)}px)` }}
              >
                {/* Left Character Forearm & Cleanroom Gloved Hand (Desktop lg+ only) */}
                <svg
                  width="84"
                  height="140"
                  viewBox="0 0 92 154"
                  className="-mr-5 z-20 drop-shadow-2xl hidden lg:block select-none pointer-events-none"
                >
                  <defs>
                    <linearGradient id="fpSleeveL" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#27272A" />
                      <stop offset="100%" stopColor="#121216" />
                    </linearGradient>
                    <linearGradient id="fpGloveL" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#E4E4E7" />
                      <stop offset="100%" stopColor="#A1A1AA" />
                    </linearGradient>
                  </defs>
                  <path d="M 8 154 L 30 92 L 66 102 L 46 154 Z" fill="url(#fpSleeveL)" stroke="#3F3F46" strokeWidth="1.5" />
                  <path d="M 28 92 L 67 101 L 64 111 L 25 102 Z" fill="#7C3AED" />
                  <path d="M 32 90 C 30 62, 54 44, 78 50 C 89 53, 88 67, 74 71 L 68 98 Z" fill="url(#fpGloveL)" stroke="#71717A" strokeWidth="1.2" />
                  <ellipse cx="77" cy="60" rx="11" ry="7" fill="#F4F4F5" stroke="#71717A" strokeWidth="1" />
                </svg>

                {/* Ruggedized Field Tablet Bezel + Live Room Telemetry Display */}
                <div className="w-[210px] sm:w-[300px] lg:w-[410px] rounded-2xl lg:rounded-b-none lg:rounded-t-3xl bg-[#101015] border-2 lg:border-b-0 lg:border-t-4 lg:border-x-4 border-zinc-700 shadow-[0_-14px_50px_rgba(0,0,0,0.75)] overflow-hidden">
                  <div className="px-3 py-1.5 bg-[#09090D] border-b border-zinc-800 flex items-center justify-between text-[10px] font-mono">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-violet-400 font-semibold truncate">FIELD PAD</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-zinc-400 shrink-0 tabular-nums">
                      <span>
                        {fpState.x},{fpState.z}
                      </span>
                      <button
                        type="button"
                        onClick={() => setFirstPersonTabletVisible(false)}
                        className="p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
                        title="Hide Field Pad"
                      >
                        <EyeOff className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 sm:p-3 bg-gradient-to-b from-[#14141D] to-[#0D0D13] space-y-2 text-zinc-100">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[9.5px] font-mono text-violet-400 uppercase tracking-wider truncate">
                          {curRoom ? `${curRoom.code} · ZONE` : `${activeFloor?.code ?? 'FLOOR'} · CORRIDOR`}
                        </div>
                        <div className="text-xs sm:text-sm font-bold text-white truncate">
                          {curRoom ? curRoom.name : `${activeFloor?.name ?? 'Facility Floor'}`}
                        </div>
                      </div>
                      <span className="hidden sm:inline-block px-2 py-0.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 font-mono text-[10px] font-semibold shrink-0">
                        {curRoom ? curRoom.environmental.cleanroomGrade : 'Navigable'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 font-mono tabular-nums">
                      <div className="p-1.5 sm:p-2 rounded-xl bg-[#1A1A25] border border-zinc-800">
                        <div className="text-[9px] text-zinc-400 flex items-center gap-0.5">
                          <Thermometer className="w-2.5 h-2.5 text-amber-400" /> T
                        </div>
                        <div className="text-[11px] sm:text-xs font-bold text-white mt-0.5">
                          {(tempSnap ? readings[tempSnap.id]?.value ?? tempSnap.nominal : curRoom?.environmental.temperatureC ?? 21.0).toFixed(1)}°
                        </div>
                      </div>
                      <div className="p-1.5 sm:p-2 rounded-xl bg-[#1A1A25] border border-zinc-800">
                        <div className="text-[9px] text-zinc-400 flex items-center gap-0.5">
                          <Droplets className="w-2.5 h-2.5 text-cyan-400" /> RH
                        </div>
                        <div className="text-[11px] sm:text-xs font-bold text-white mt-0.5">
                          {(rhSnap ? readings[rhSnap.id]?.value ?? rhSnap.nominal : curRoom?.environmental.humidityPct ?? 45).toFixed(0)}%
                        </div>
                      </div>
                      <div className="p-1.5 sm:p-2 rounded-xl bg-[#1A1A25] border border-zinc-800">
                        <div className="text-[9px] text-zinc-400 flex items-center gap-0.5">
                          <Gauge className="w-2.5 h-2.5 text-emerald-400" /> ΔP
                        </div>
                        <div className="text-[11px] sm:text-xs font-bold text-emerald-400 mt-0.5">
                          {(dpSnap ? readings[dpSnap.id]?.value ?? dpSnap.nominal : curRoom?.environmental.pressurePa ?? 15) >= 0 ? '+' : ''}
                          {(dpSnap ? readings[dpSnap.id]?.value ?? dpSnap.nominal : curRoom?.environmental.pressurePa ?? 15).toFixed(0)}Pa
                        </div>
                      </div>
                    </div>

                    <div className="hidden sm:flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/80 text-[10px]">
                      <span className="text-zinc-400 shrink-0">Nearby:</span>
                      <div className="flex items-center gap-1.5 overflow-x-auto">
                        {nearbyAssets.map(({ asset, dist }) => (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => openDashboard({ tab: 'trends', assetId: asset.id })}
                            className="px-2 py-0.5 rounded-lg bg-[#1C1C28] border border-zinc-700/80 hover:border-violet-400 font-mono text-[10px] text-zinc-200 whitespace-nowrap cursor-pointer"
                          >
                            {asset.assetId} ({dist.toFixed(1)}m)
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Character Forearm & Cleanroom Gloved Hand (Desktop lg+ only) */}
                <svg
                  width="84"
                  height="140"
                  viewBox="0 0 92 154"
                  className="-ml-5 z-20 drop-shadow-2xl hidden lg:block select-none pointer-events-none"
                >
                  <defs>
                    <linearGradient id="fpSleeveR" x1="1" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#27272A" />
                      <stop offset="100%" stopColor="#121216" />
                    </linearGradient>
                    <linearGradient id="fpGloveR" x1="1" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E4E4E7" />
                      <stop offset="100%" stopColor="#A1A1AA" />
                    </linearGradient>
                  </defs>
                  <path d="M 84 154 L 62 92 L 26 102 L 46 154 Z" fill="url(#fpSleeveR)" stroke="#3F3F46" strokeWidth="1.5" />
                  <path d="M 64 92 L 25 101 L 28 111 L 67 102 Z" fill="#7C3AED" />
                  <path d="M 60 90 C 62 62, 38 44, 14 50 C 3 53, 4 67, 18 71 L 24 98 Z" fill="url(#fpGloveR)" stroke="#71717A" strokeWidth="1.2" />
                  <ellipse cx="15" cy="60" rx="11" ry="7" fill="#F4F4F5" stroke="#71717A" strokeWidth="1" />
                </svg>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
};
