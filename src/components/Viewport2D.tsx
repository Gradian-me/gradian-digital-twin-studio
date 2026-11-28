import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  AlignHorizontalJustifyCenter,
  Box,
  CheckCircle2,
  DoorOpen,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Focus,
  Grid3X3,
  Hand,
  Info,
  Lock,
  Moon,
  Pause,
  Play,
  Route,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  Waypoints,
  Wind,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import { useAclStore, computeEffectivePermissions } from '../store/useAclStore';
import { getTargetFmeaSummary, useRiskIncidentStore } from '../store/useRiskIncidentStore';
import { AHU_CATALOG, computeRoomSupplyM3h, getAhuColor, getEffectiveRoomHvac } from '../utils/hvac';
import { doesAssetMatchCategory, doesRoomMatchCategory } from '../utils/categoryFilter';
import {
  formatArea,
  formatLength,
  getRoomColorForAnalytics,
  snapValue,
} from '../utils/spatial';
import { computeFlowRoomSequence } from '../utils/flowAnalytics';
import { computeSnappedPlacement, type PlacementSnapResult } from '../utils/placementSnap';
import { OBJECT_LIBRARY } from '../data/objectLibrary';
import { OPENING_PRESETS } from '../data/materialsLibrary';
import type { OpeningSubtype } from '../types/twin';
import {
  detectEnclosedWallPolygons,
  getRoomAreaSqm,
  getRoomCentroid,
} from '../utils/polygonSpaces';
import {
  OPENING_DND_MIME,
  findOpeningDropZone,
  getActiveDraggedOpeningSubtype,
  setActiveDraggedOpeningSubtype,
  type WallOpeningDropPreview,
} from '../utils/openingPlacement';
import { OpeningQuickBar } from './OpeningQuickBar';

export const Viewport2D: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const activeTool = useTwinStore((s) => s.activeTool);
  const selected = useTwinStore((s) => s.selected);
  const snap = useTwinStore((s) => s.snap);
  const analyticsMetric = useTwinStore((s) => s.analyticsMetric);
  const timelineDate = useTwinStore((s) => s.timelineDate);
  const canvasBackdrop = useTwinStore((s) => s.canvasBackdrop);
  const toggleCanvasBackdrop = useTwinStore((s) => s.toggleCanvasBackdrop);
  const measurePoints = useTwinStore((s) => s.measurePoints);
  const calibrationPoints = useTwinStore((s) => s.calibrationPoints);
  const pendingAIActions = useTwinStore((s) => s.pendingAIActions);
  const animateFlows = useTwinStore((s) => s.animateFlows);
  const showFlows = useTwinStore((s) => s.showFlows);
  const isolatedFlowId = useTwinStore((s) => s.isolatedFlowId);
  const hiddenFlowIds = useTwinStore((s) => s.hiddenFlowIds);
  const showHvacOverlay = useTwinStore((s) => s.showHvacOverlay);
  const hvacAhuFilter = useTwinStore((s) => s.hvacAhuFilter);
  const showFmeaIndicators = useTwinStore((s) => s.showFmeaIndicators);
  const editingFlowId = useTwinStore((s) => s.editingFlowId);

  const selectEntity = useTwinStore((s) => s.selectEntity);
  const clearSelection = useTwinStore((s) => s.clearSelection);
  const setCursorCoords = useTwinStore((s) => s.setCursorCoords);
  const addRoom = useTwinStore((s) => s.addRoom);
  const addSmartRoomFromTemplate = useTwinStore((s) => s.addSmartRoomFromTemplate);
  const addWall = useTwinStore((s) => s.addWall);
  const addOpeningOnWall = useTwinStore((s) => s.addOpeningOnWall);
  const updateOpening = useTwinStore((s) => s.updateOpening);
  const deleteSelected = useTwinStore((s) => s.deleteSelected);
  const addAsset = useTwinStore((s) => s.addAsset);
  const updateAsset = useTwinStore((s) => s.updateAsset);
  const updateRoom = useTwinStore((s) => s.updateRoom);
  const updateWall = useTwinStore((s) => s.updateWall);
  const updateFlowRoute = useTwinStore((s) => s.updateFlowRoute);
  const updateRoomHvac = useTwinStore((s) => s.updateRoomHvac);
  const setRightTab = useTwinStore((s) => s.setRightTab);
  const setRightPanelOpen = useTwinStore((s) => s.setRightPanelOpen);
  const showToast = useTwinStore((s) => s.showToast);
  const addMeasurePoint = useTwinStore((s) => s.addMeasurePoint);
  const addCalibrationPoint = useTwinStore((s) => s.addCalibrationPoint);
  const paintSurfaceWithMaterial = useTwinStore((s) => s.paintSurfaceWithMaterial);
  const addFlowRoute = useTwinStore((s) => s.addFlowRoute);
  const addCamera = useTwinStore((s) => s.addCamera);
  const cursorCoords = useTwinStore((s) => s.cursorCoords);
  const setActiveTool = useTwinStore((s) => s.setActiveTool);
  const setAnimateFlows = useTwinStore((s) => s.setAnimateFlows);
  const setShowFlows = useTwinStore((s) => s.setShowFlows);
  const toggleFlowVisibility = useTwinStore((s) => s.toggleFlowVisibility);
  const isolateFlow = useTwinStore((s) => s.isolateFlow);
  const setActiveFlowInfoId = useTwinStore((s) => s.setActiveFlowInfoId);
  const setShowHvacOverlay = useTwinStore((s) => s.setShowHvacOverlay);
  const setHvacAhuFilter = useTwinStore((s) => s.setHvacAhuFilter);
  const setShowFmeaIndicators = useTwinStore((s) => s.setShowFmeaIndicators);
  const setEditingFlowId = useTwinStore((s) => s.setEditingFlowId);
  const openLiveCamera = useTwinStore((s) => s.openLiveCamera);
  const openRackDesigner = useTwinStore((s) => s.openRackDesigner);
  const openCadOcrForReference = useTwinStore((s) => s.openCadOcrForReference);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const flyToCamera = useTwinStore((s) => s.flyToCamera);
  const openEntityInfo = useTwinStore((s) => s.openEntityInfo);
  const activeNetworkTrace = useTwinStore((s) => s.activeNetworkTrace);
  const startNetworkTrace = useTwinStore((s) => s.startNetworkTrace);
  const clearNetworkTrace = useTwinStore((s) => s.clearNetworkTrace);
  const qrHighlight = useTwinStore((s) => s.qrHighlight);
  const clearQrHighlight = useTwinStore((s) => s.clearQrHighlight);
  const openDataCenterPage = useTwinStore((s) => s.openDataCenterPage);
  const riskIncidents = useRiskIncidentStore((s) => s.incidents);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);
  const [activeDockSubject, setActiveDockSubject] = useState<'flows' | 'hvac' | 'fmea' | null>(null);
  const toggleDockSubject = (subj: 'flows' | 'hvac' | 'fmea') =>
    setActiveDockSubject((prev) => (prev === subj ? null : subj));
  const [placePreview, setPlacePreview] = useState<PlacementSnapResult | null>(null);

  const selectedMaterialId = useTwinStore((s) => s.selectedMaterialId);
  const selectedObjectTemplateId = useTwinStore((s) => s.selectedObjectTemplateId);
  const selectedOpeningSubtype = useTwinStore((s) => s.selectedOpeningSubtype);
  const selectedFlowType = useTwinStore((s) => s.selectedFlowType);
  const workspaceMode = useTwinStore((s) => s.workspaceMode);
  const categoryFilter = useTwinStore((s) => s.categoryFilter);
  const wallChainAnchor = useTwinStore((s) => s.wallChainAnchor);
  const setWallChainAnchor = useTwinStore((s) => s.setWallChainAnchor);
  const pendingPolygonSpace = useTwinStore((s) => s.pendingPolygonSpace);
  const setPendingPolygonSpace = useTwinStore((s) => s.setPendingPolygonSpace);
  const [openingDropPreview, setOpeningDropPreview] = useState<WallOpeningDropPreview | null>(null);
  const [openingHoverPt, setOpeningHoverPt] = useState<{ x: number; z: number } | null>(null);
  const [draggingOpeningId, setDraggingOpeningId] = useState<string | null>(null);
  const [hoveredOpeningId, setHoveredOpeningId] = useState<string | null>(null);
  const [resizingOpening, setResizingOpening] = useState<{
    id: string;
    side: -1 | 1;
  } | null>(null);
  const [openingContextMenu, setOpeningContextMenu] = useState<{
    openingId: string;
    x: number;
    y: number;
  } | null>(null);
  const [dragOpeningSubtype, setDragOpeningSubtype] = useState<OpeningSubtype | null>(null);

  const activeOpeningPreset = useMemo(() => {
    if (dragOpeningSubtype) {
      const dragged = OPENING_PRESETS.find((p) => p.subtype === dragOpeningSubtype);
      if (dragged) return dragged;
    }
    const matched = OPENING_PRESETS.find((p) => p.subtype === selectedOpeningSubtype);
    if (activeTool === 'place-window') {
      return matched?.kind === 'window'
        ? matched
        : OPENING_PRESETS.find((p) => p.kind === 'window') ?? OPENING_PRESETS[0];
    }
    if (activeTool === 'place-door') {
      return matched?.kind === 'door'
        ? matched
        : OPENING_PRESETS.find((p) => p.kind === 'door') ?? OPENING_PRESETS[0];
    }
    return matched ?? OPENING_PRESETS[0];
  }, [dragOpeningSubtype, selectedOpeningSubtype, activeTool]);

  useEffect(() => {
    if (!openingContextMenu) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpeningContextMenu(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openingContextMenu]);

  const aclUsers = useAclStore((s) => s.users);
  const aclRoles = useAclStore((s) => s.roles);
  const aclGroups = useAclStore((s) => s.groups);
  const activeAclUserId = useAclStore((s) => s.activeAclUserId);

  const isReadOnly = useMemo(() => {
    if (workspaceMode === 'view') return true;
    const u = aclUsers.find((x) => x.id === activeAclUserId) ?? aclUsers[0];
    if (!u) return false;
    return !computeEffectivePermissions(u, aclRoles, aclGroups).includes('spatial.edit');
  }, [workspaceMode, aclUsers, aclRoles, aclGroups, activeAclUserId]);

  const activeFloor = useMemo(
    () => scene.floors.find((f) => f.id === activeFloorId) ?? scene.floors[0],
    [scene.floors, activeFloorId]
  );

  // Pan & Zoom state in meters
  const [zoom, setZoom] = useState(22); // pixels per meter
  const [pan, setPan] = useState({ x: 56, y: 48 });
  const zoomRef = useRef(22);
  const panRef = useRef({ x: 56, y: 48 });
  zoomRef.current = zoom;
  panRef.current = pan;

  const [isPanning, setIsPanning] = useState(false);
  const [isHandMode, setIsHandMode] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const panOriginRef = useRef({ mx: 0, my: 0, px: 0, py: 0, moved: false });
  const pendingRoomSelectRef = useRef<{ roomId: string; shiftKey: boolean } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{ dist: number; cx: number; cy: number; zoom: number; panX: number; panY: number } | null>(null);

  // GMP Production Line Eligibility Highlighting & Mini-Map Pan Sync
  const activeLineHighlight = useGmpStore((s) => s.activeLineHighlight);
  const clearLineHighlight = useGmpStore((s) => s.clearLineHighlight);
  const openGmpModal = useGmpStore((s) => s.openGmpModal);
  const miniMapTarget = useGmpStore((s) => s.miniMapTarget);

  useEffect(() => {
    if (!miniMapTarget || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setPan({
      x: Math.round(rect.width / 2 - miniMapTarget.x * zoomRef.current),
      y: Math.round(rect.height / 2 - miniMapTarget.z * zoomRef.current),
    });
  }, [miniMapTarget]);

  // Auto-center & zoom 2D viewport onto a physical QR-scanned asset or room
  useEffect(() => {
    if (!qrHighlight || qrHighlight.floorId !== activeFloorId || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nextZoom = Math.max(zoomRef.current, 28);
    setZoom(nextZoom);
    setPan({
      x: Math.round(rect.width / 2 - qrHighlight.x * nextZoom),
      y: Math.round(rect.height / 2 - qrHighlight.z * nextZoom),
    });
  }, [qrHighlight, activeFloorId]);

  // Auto-center 2D viewport on Active IT Port & Cable Trace hops
  useEffect(() => {
    if (!activeNetworkTrace || !svgRef.current) return;
    const floorHops = activeNetworkTrace.hops.filter(
      (h) => !h.floorId || h.floorId === activeFloorId
    );
    const hops = floorHops.length > 0 ? floorHops : activeNetworkTrace.hops;
    if (hops.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const cx = hops.reduce((sum, h) => sum + h.x, 0) / hops.length;
    const cz = hops.reduce((sum, h) => sum + h.z, 0) / hops.length;
    setPan({
      x: Math.round(rect.width / 2 - cx * zoomRef.current),
      y: Math.round(rect.height / 2 - cz * zoomRef.current),
    });
  }, [activeNetworkTrace, activeFloorId]);

  const zoomAtClientPoint = useCallback((factor: number, clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const curZoom = zoomRef.current;
    const curPan = panRef.current;
    const nextZoom = Math.max(5, Math.min(96, Number((curZoom * factor).toFixed(2))));
    if (nextZoom === curZoom) return;
    if (rect) {
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const ratio = nextZoom / curZoom;
      const nextPan = {
        x: Number((sx - (sx - curPan.x) * ratio).toFixed(1)),
        y: Number((sy - (sy - curPan.y) * ratio).toFixed(1)),
      };
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
    } else {
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    }
  }, []);

  const fitFloorToView = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !activeFloor || rect.width <= 0 || rect.height <= 0) {
      setZoom(22);
      setPan({ x: 56, y: 48 });
      return;
    }
    const padX = 72;
    const padY = 72;
    const availW = Math.max(120, rect.width - padX * 2);
    const availH = Math.max(120, rect.height - padY * 2);
    const nextZoom = Math.max(
      6,
      Math.min(60, Number(Math.min(availW / Math.max(4, activeFloor.width), availH / Math.max(4, activeFloor.depth)).toFixed(2)))
    );
    const nextPan = {
      x: Math.round((rect.width - activeFloor.width * nextZoom) / 2),
      y: Math.round((rect.height - activeFloor.depth * nextZoom) / 2),
    };
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  }, [activeFloor]);

  // Native non-passive wheel & Safari gesture listeners: prevents whole-app browser zoom when zooming 2D canvas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch-to-zoom or Ctrl+wheel
        const factor = Math.max(0.75, Math.min(1.35, Math.exp(-e.deltaY * 0.01)));
        zoomAtClientPoint(factor, e.clientX, e.clientY);
        return;
      }

      if (e.shiftKey || (Math.abs(e.deltaX) > 2 && Math.abs(e.deltaY) < 40)) {
        // Two-finger trackpad pan or Shift+wheel horizontal/2D pan
        const nextPan = {
          x: Number((panRef.current.x - e.deltaX).toFixed(1)),
          y: Number((panRef.current.y - e.deltaY).toFixed(1)),
        };
        panRef.current = nextPan;
        setPan(nextPan);
        return;
      }

      // Standard mouse wheel zoom anchored at pointer
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      zoomAtClientPoint(factor, e.clientX, e.clientY);
    };

    const preventGesture = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', preventGesture, { passive: false });
    el.addEventListener('gesturechange', preventGesture, { passive: false });
    el.addEventListener('gestureend', preventGesture, { passive: false });

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', preventGesture);
      el.removeEventListener('gesturechange', preventGesture);
      el.removeEventListener('gestureend', preventGesture);
    };
  }, [zoomAtClientPoint]);

  // Spacebar hold to pan from any tool
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    const onBlur = () => setSpacePressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Interactive drawing/dragging state
  const [draftStart, setDraftStart] = useState<{ x: number; z: number } | null>(null);
  const [draftCurrent, setDraftCurrent] = useState<{ x: number; z: number } | null>(null);
  const [flowDraftPoints, setFlowDraftPoints] = useState<{ x: number; z: number }[]>([]);

  // Clear local wall/opening draft cursor state when tool changes or Escape stops chaining
  useEffect(() => {
    if (!wallChainAnchor && activeTool === 'draw-wall') {
      setDraftStart(null);
      setDraftCurrent(null);
    }
    if (activeTool !== 'place-door' && activeTool !== 'place-window') {
      setOpeningDropPreview(null);
      setOpeningHoverPt(null);
    }
  }, [wallChainAnchor, activeTool]);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [draggingWallHandle, setDraggingWallHandle] = useState<{ wallId: string; end: 1 | 2 } | null>(null);
  const [draggingFlowNode, setDraggingFlowNode] = useState<{ flowId: string; idx: number } | null>(null);
  const [draggingRoom, setDraggingRoom] = useState<{
    roomId: string;
    mode: 'move' | 'resize';
    startPt: { x: number; z: number };
    origX: number;
    origZ: number;
    origW: number;
    origD: number;
  } | null>(null);

  const isLayerVisible = (layerId: string) => {
    const l = scene.layers.find((x) => x.id === layerId);
    return l ? l.visible : true;
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, z: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const rawX = (sx - panRef.current.x) / zoomRef.current;
    const rawZ = (sy - panRef.current.y) / zoomRef.current;
    return {
      x: snapValue(rawX, snap.gridSize, snap.enabled && snap.snapToGrid),
      z: snapValue(rawZ, snap.gridSize, snap.enabled && snap.snapToGrid),
    };
  };

  // Snap wall points to nearby wall endpoints and angleStepDeg when enabled
  const snapWallPoint = (
    rawPt: { x: number; z: number },
    anchor?: { x: number; z: number } | null,
    excludeWallId?: string
  ) => {
    let x = rawPt.x;
    let z = rawPt.z;
    if (snap.enabled && snap.snapToWall) {
      let bestDist = 0.65;
      for (const w of scene.walls) {
        if (w.floorId !== activeFloorId || w.id === excludeWallId) continue;
        for (const ep of [
          { x: w.x1, z: w.z1 },
          { x: w.x2, z: w.z2 },
        ]) {
          const d = Math.hypot(ep.x - x, ep.z - z);
          if (d < bestDist) {
            bestDist = d;
            x = ep.x;
            z = ep.z;
          }
        }
      }
      if (bestDist < 0.65) {
        return { x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) };
      }
    }
    if (anchor && snap.enabled && snap.angleStepDeg > 0) {
      const dx = x - anchor.x;
      const dz = z - anchor.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.15) {
        const stepRad = (snap.angleStepDeg * Math.PI) / 180;
        const snappedAngle = Math.round(Math.atan2(dz, dx) / stepRad) * stepRad;
        const snappedLen = snap.snapToGrid ? snapValue(len, snap.gridSize, true) : len;
        x = anchor.x + Math.cos(snappedAngle) * snappedLen;
        z = anchor.z + Math.sin(snappedAngle) * snappedLen;
      }
    }
    return { x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) };
  };

  const beginPan = (e: React.PointerEvent<SVGSVGElement>) => {
    setIsPanning(true);
    panOriginRef.current = {
      mx: e.clientX,
      my: e.clientY,
      px: panRef.current.x,
      py: panRef.current.y,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if synthetic pointer
    }
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Track multi-touch pointers for 2-finger pinch-zoom & pan on touchscreens
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      pinchStateRef.current = {
        dist: Math.max(10, dist),
        cx,
        cy,
        zoom: zoomRef.current,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      setIsPanning(false);
      pendingRoomSelectRef.current = null;
      return;
    }

    // Right-click stops an active continuous wall chain cleanly (just like Escape)
    if (e.button === 2 && !isReadOnly && activeTool === 'draw-wall' && wallChainAnchor) {
      setWallChainAnchor(null);
      setDraftStart(null);
      setDraftCurrent(null);
      return;
    }

    // Middle click, Right click, Alt+drag, Space+drag, or Hand/Pan mode pans immediately from anywhere
    if (
      e.button === 1 ||
      e.button === 2 ||
      (e.button === 0 && (e.altKey || spacePressed || isHandMode))
    ) {
      pendingRoomSelectRef.current = null;
      beginPan(e);
      return;
    }
    if (e.button !== 0) return;

    const pt = screenToWorld(e.clientX, e.clientY);

    if (activeTool === 'measure') {
      addMeasurePoint(pt);
      return;
    }

    if (!isReadOnly) {
      if (activeTool === 'draw-room') {
        setDraftStart(pt);
        setDraftCurrent(pt);
        return;
      }

      if (activeTool === 'draw-wall') {
        if (wallChainAnchor) {
          const endPt = snapWallPoint(pt, wallChainAnchor);
          const len = Math.hypot(endPt.x - wallChainAnchor.x, endPt.z - wallChainAnchor.z);
          if (len >= 0.4) {
            addWall(wallChainAnchor.x, wallChainAnchor.z, endPt.x, endPt.z);
            setWallChainAnchor(endPt);
            setDraftStart(null);
            setDraftCurrent(endPt);
          }
        } else {
          const startPt = snapWallPoint(pt, null);
          setWallChainAnchor(startPt);
          setDraftStart(startPt);
          setDraftCurrent(startPt);
        }
        return;
      }

      if (activeTool === 'place-door' || activeTool === 'place-window') {
        const drop = findOpeningDropZone(
          pt.x,
          pt.z,
          scene.walls,
          activeFloorId,
          activeOpeningPreset,
          snap,
          1.8
        );
        if (drop) {
          addOpeningOnWall(drop.wall.id, drop.offsetRatio, activeOpeningPreset.subtype);
          setOpeningDropPreview(null);
          setOpeningHoverPt(null);
          setActiveTool('select');
        } else {
          showToast(
            `${activeTool === 'place-window' ? 'Windows' : 'Doors'} must be placed on a wall or room perimeter — hover over a highlighted wall.`,
            'warning'
          );
        }
        return;
      }

      if (activeTool === 'place-object') {
        const allObjs = [...OBJECT_LIBRARY, ...scene.customObjects];
        const tpl = allObjs.find((o) => o.id === selectedObjectTemplateId) ?? allObjs[0];
        const flWalls = scene.walls.filter((w) => w.floorId === activeFloorId);
        const snapped = computeSnappedPlacement(
          pt.x,
          pt.z,
          tpl?.width ?? 1.2,
          tpl?.depth ?? 1.0,
          flWalls,
          snap,
          { floorWidth: activeFloor?.width, floorDepth: activeFloor?.depth }
        );
        addAsset(selectedObjectTemplateId, snapped.x, snapped.z, {
          x: snapped.x,
          z: snapped.z,
          rotationY: snapped.rotationY,
        });
        setPlacePreview(null);
        setActiveTool('select');
        return;
      }

      if (activeTool === 'place-camera') {
        addCamera({
          floorId: activeFloorId,
          name: `Camera ${scene.cameras.length + 1}`,
          kind: 'security',
          group: 'Floor Plan Cameras',
          position: [pt.x, 3.0, pt.z],
          target: [pt.x + 5, 1.3, pt.z + 2],
          fov: 60,
          focalLengthMm: 28,
          coverageRadius: 10,
          visibleCone: true,
          layerId: 'layer-cameras',
        });
        setActiveTool('select');
        return;
      }

      if (activeTool === 'calibrate-ref') {
        addCalibrationPoint(pt);
        return;
      }

      if (activeTool === 'draw-flow') {
        setFlowDraftPoints((prev) => [...prev, pt]);
        return;
      }
    }

    // In select mode (or view-only mode), dragging on canvas background, floor slab, reference blueprint, or any room pans smoothly!
    // (Short clicks without movement still select the room or clear selection on pointerUp.)
    if (activeTool === 'select' || isReadOnly) {
      beginPan(e);
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Two-finger touch pinch-zoom & pan
    if (activePointersRef.current.size === 2 && pinchStateRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const init = pinchStateRef.current;
      const rect = svgRef.current?.getBoundingClientRect();
      const nextZoom = Math.max(5, Math.min(96, Number((init.zoom * (dist / init.dist)).toFixed(2))));
      const ratio = nextZoom / init.zoom;
      const anchorX = rect ? init.cx - rect.left : init.cx;
      const anchorY = rect ? init.cy - rect.top : init.cy;
      const nextPan = {
        x: Number((anchorX - (anchorX - init.panX) * ratio + (cx - init.cx)).toFixed(1)),
        y: Number((anchorY - (anchorY - init.panY) * ratio + (cy - init.cy)).toFixed(1)),
      };
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
      return;
    }

    const pt = screenToWorld(e.clientX, e.clientY);
    setCursorCoords({ x: pt.x, y: activeFloor?.elevation ?? 0, z: pt.z });

    if (!isReadOnly && activeTool === 'place-object') {
      const allObjs = [...OBJECT_LIBRARY, ...scene.customObjects];
      const tpl = allObjs.find((o) => o.id === selectedObjectTemplateId) ?? allObjs[0];
      const flWalls = scene.walls.filter((w) => w.floorId === activeFloorId);
      setPlacePreview(
        computeSnappedPlacement(
          pt.x,
          pt.z,
          tpl?.width ?? 1.2,
          tpl?.depth ?? 1.0,
          flWalls,
          snap,
          { floorWidth: activeFloor?.width, floorDepth: activeFloor?.depth }
        )
      );
    } else if (placePreview) {
      setPlacePreview(null);
    }

    if (!isReadOnly && (activeTool === 'place-door' || activeTool === 'place-window')) {
      const drop = findOpeningDropZone(
        pt.x,
        pt.z,
        scene.walls,
        activeFloorId,
        activeOpeningPreset,
        snap,
        1.8
      );
      setOpeningDropPreview(drop);
      setOpeningHoverPt(pt);
    } else if (openingDropPreview || openingHoverPt) {
      setOpeningDropPreview(null);
      setOpeningHoverPt(null);
    }

    if (isPanning) {
      const dx = e.clientX - panOriginRef.current.mx;
      const dy = e.clientY - panOriginRef.current.my;
      if (!panOriginRef.current.moved && Math.hypot(dx, dy) > 4) {
        panOriginRef.current.moved = true;
      }
      if (panOriginRef.current.moved || isHandMode || spacePressed || e.buttons === 4 || e.buttons === 2) {
        const nextPan = {
          x: panOriginRef.current.px + dx,
          y: panOriginRef.current.py + dy,
        };
        panRef.current = nextPan;
        setPan(nextPan);
      }
      return;
    }

    if (!isReadOnly && activeTool === 'draw-wall' && wallChainAnchor) {
      setDraftCurrent(snapWallPoint(pt, wallChainAnchor));
      return;
    }

    if (draftStart) {
      setDraftCurrent(activeTool === 'draw-wall' ? snapWallPoint(pt, draftStart) : pt);
      return;
    }

    if (draggingRoom) {
      const dx = pt.x - draggingRoom.startPt.x;
      const dz = pt.z - draggingRoom.startPt.z;
      if (draggingRoom.mode === 'move') {
        const nx = snapValue(draggingRoom.origX + dx, snap.gridSize, snap.enabled && snap.snapToGrid);
        const nz = snapValue(draggingRoom.origZ + dz, snap.gridSize, snap.enabled && snap.snapToGrid);
        updateRoom(draggingRoom.roomId, { x: nx, z: nz });
      } else {
        const nw = Math.max(
          1.5,
          snapValue(draggingRoom.origW + dx, snap.gridSize, snap.enabled && snap.snapToGrid)
        );
        const nd = Math.max(
          1.5,
          snapValue(draggingRoom.origD + dz, snap.gridSize, snap.enabled && snap.snapToGrid)
        );
        updateRoom(draggingRoom.roomId, { width: nw, depth: nd });
      }
      return;
    }

    if (draggingAssetId) {
      updateAsset(draggingAssetId, { x: pt.x, z: pt.z }, false);
      return;
    }

    if (resizingOpening) {
      const op = scene.openings.find((o) => o.id === resizingOpening.id);
      const hostWall = op ? scene.walls.find((w) => w.id === op.wallId) : null;
      if (op && hostWall) {
        const dx = hostWall.x2 - hostWall.x1;
        const dz = hostWall.z2 - hostWall.z1;
        const len = Math.hypot(dx, dz);
        if (len > 0.7) {
          const centerDist = op.offsetRatio * len;
          const projDist = ((pt.x - hostWall.x1) * dx + (pt.z - hostWall.z1) * dz) / len;
          const halfSpan = Math.abs(projDist - centerDist);
          const rawWidth = Math.max(0.6, Math.min(len - 0.3, halfSpan * 2));
          const snappedW = snap.enabled && snap.snapToGrid
            ? Math.max(0.6, Number((Math.round(rawWidth / Math.min(0.25, snap.gridSize)) * Math.min(0.25, snap.gridSize)).toFixed(2)))
            : Number(rawWidth.toFixed(2));
          updateOpening(op.id, { width: snappedW });
        }
      }
      return;
    }

    if (draggingOpeningId) {
      const op = scene.openings.find((o) => o.id === draggingOpeningId);
      const hostWall = op ? scene.walls.find((w) => w.id === op.wallId) : null;
      if (op && hostWall) {
        const dx = hostWall.x2 - hostWall.x1;
        const dz = hostWall.z2 - hostWall.z1;
        const lenSq = dx * dx + dz * dz;
        if (lenSq > 0.04) {
          const len = Math.sqrt(lenSq);
          let distAlong = ((pt.x - hostWall.x1) * dx + (pt.z - hostWall.z1) * dz) / len;
          if (snap.enabled && snap.snapToGrid) {
            distAlong = snapValue(distAlong, snap.gridSize, true);
          }
          const clampedRatio = Math.max(0.05, Math.min(0.95, distAlong / len));
          updateOpening(op.id, { offsetRatio: Number(clampedRatio.toFixed(3)) });
        }
      }
      return;
    }

    if (draggingWallHandle) {
      const w = scene.walls.find((x) => x.id === draggingWallHandle.wallId);
      const anchor = w
        ? draggingWallHandle.end === 1
          ? { x: w.x2, z: w.z2 }
          : { x: w.x1, z: w.z1 }
        : null;
      const snappedEnd = snapWallPoint(pt, anchor, draggingWallHandle.wallId);
      updateWall(
        draggingWallHandle.wallId,
        draggingWallHandle.end === 1
          ? { x1: snappedEnd.x, z1: snappedEnd.z }
          : { x2: snappedEnd.x, z2: snappedEnd.z }
      );
      return;
    }

    if (draggingFlowNode) {
      const fl = scene.flows.find((f) => f.id === draggingFlowNode.flowId);
      if (fl) {
        const nextPts = fl.points.map((p, idx) =>
          idx === draggingFlowNode.idx ? { x: pt.x, z: pt.z } : p
        );
        updateFlowRoute(fl.id, { points: nextPts });
      }
    }
  };

  const handleSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }

    if (isPanning) {
      const didDrag = panOriginRef.current.moved;
      setIsPanning(false);
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
      if (!didDrag && !isHandMode && !spacePressed && e.button === 0) {
        if (pendingRoomSelectRef.current) {
          selectEntity(
            { type: 'room', id: pendingRoomSelectRef.current.roomId },
            pendingRoomSelectRef.current.shiftKey
          );
        } else if (!e.shiftKey) {
          clearSelection();
        }
      }
      pendingRoomSelectRef.current = null;
    }

    if (draftStart && draftCurrent) {
      if (activeTool === 'draw-room') {
        const rx = Math.min(draftStart.x, draftCurrent.x);
        const rz = Math.min(draftStart.z, draftCurrent.z);
        const rw = Math.abs(draftCurrent.x - draftStart.x);
        const rd = Math.abs(draftCurrent.z - draftStart.z);
        if (rw >= 1.5 && rd >= 1.5) {
          addRoom(rx, rz, rw, rd);
          setActiveTool('select');
        }
        setDraftStart(null);
        setDraftCurrent(null);
      } else if (activeTool === 'draw-wall') {
        const len = Math.hypot(draftCurrent.x - draftStart.x, draftCurrent.z - draftStart.z);
        if (len >= 0.4) {
          addWall(draftStart.x, draftStart.z, draftCurrent.x, draftCurrent.z);
          setWallChainAnchor(draftCurrent);
        }
        setDraftStart(null);
      }
    }

    if (draggingAssetId) {
      const movedAsset = scene.assets.find((a) => a.id === draggingAssetId);
      if (movedAsset) {
        updateAsset(draggingAssetId, { x: movedAsset.x, z: movedAsset.z }, true);
      }
      setDraggingAssetId(null);
    }

    if (draggingRoom) {
      setDraggingRoom(null);
    }

    if (draggingWallHandle) {
      setDraggingWallHandle(null);
    }

    if (draggingOpeningId) {
      setDraggingOpeningId(null);
    }

    if (resizingOpening) {
      setResizingOpening(null);
    }

    if (draggingFlowNode) {
      setDraggingFlowNode(null);
    }
  };

  const finishFlowDraft = () => {
    if (flowDraftPoints.length < 2) {
      setFlowDraftPoints([]);
      return;
    }
    const colorMap: Record<string, string> = {
      personnel: '#10B981',
      material: '#2563EB',
      product: '#0284C7',
      waste: '#EF4444',
      utility: '#F59E0B',
      evacuation: '#DC2626',
      maintenance: '#8B5CF6',
      airflow: '#06B6D4',
    };
    addFlowRoute({
      floorId: activeFloorId,
      name: `${selectedFlowType.charAt(0).toUpperCase() + selectedFlowType.slice(1)} Route ${scene.flows.length + 1}`,
      flowType: selectedFlowType,
      points: flowDraftPoints,
      color: colorMap[selectedFlowType] ?? '#2563EB',
      flowRateLabel: 'Standard Flow',
      capacityLabel: 'Nominal',
      cleanlinessClass: selectedFlowType === 'waste' ? 'dirty' : selectedFlowType === 'evacuation' ? 'emergency' : 'clean',
      restrictions: 'Defined on 2D Floor Plan',
      layerId: 'layer-flows',
    });
    setFlowDraftPoints([]);
    setActiveTool('select');
  };

  const handleDragOver = (e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (isReadOnly) return;
    const draggedSubtype =
      getActiveDraggedOpeningSubtype() ??
      (Array.from(e.dataTransfer.types).includes(OPENING_DND_MIME) ? selectedOpeningSubtype : null);
    if (draggedSubtype) {
      e.dataTransfer.dropEffect = 'copy';
      if (dragOpeningSubtype !== draggedSubtype) {
        setDragOpeningSubtype(draggedSubtype);
      }
      const preset =
        OPENING_PRESETS.find((p) => p.subtype === draggedSubtype) ?? activeOpeningPreset;
      const pt = screenToWorld(e.clientX, e.clientY);
      const drop = findOpeningDropZone(pt.x, pt.z, scene.walls, activeFloorId, preset, snap, 2.2);
      setOpeningDropPreview(drop);
      setOpeningHoverPt(pt);
    }
  };

  const handleDragLeave = (e: React.DragEvent<SVGSVGElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      if (dragOpeningSubtype) {
        setDragOpeningSubtype(null);
        setOpeningDropPreview(null);
        setOpeningHoverPt(null);
      }
    }
  };

  const handleDrop = (e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (isReadOnly) return;

    const openingSubtype = (e.dataTransfer.getData(OPENING_DND_MIME) ||
      getActiveDraggedOpeningSubtype() ||
      '') as OpeningSubtype | '';
    if (openingSubtype) {
      setDragOpeningSubtype(null);
      setActiveDraggedOpeningSubtype(null);
      setOpeningDropPreview(null);
      setOpeningHoverPt(null);
      const preset =
        OPENING_PRESETS.find((p) => p.subtype === openingSubtype) ?? activeOpeningPreset;
      const pt = screenToWorld(e.clientX, e.clientY);
      const drop = findOpeningDropZone(pt.x, pt.z, scene.walls, activeFloorId, preset, snap, 2.2);
      if (drop) {
        addOpeningOnWall(drop.wall.id, drop.offsetRatio, preset.subtype);
        setActiveTool('select');
      } else {
        showToast(
          preset.kind === 'window'
            ? 'Drop windows directly onto a highlighted wall segment.'
            : 'Drop doors directly onto a highlighted wall segment.',
          'warning'
        );
      }
      return;
    }

    const smartRoomId = e.dataTransfer.getData('application/x-gradian-smart-room');
    if (smartRoomId) {
      const pt = screenToWorld(e.clientX, e.clientY);
      useTwinStore.getState().addSmartRoomFromTemplate(smartRoomId, pt.x, pt.z);
      return;
    }
    const templateId = e.dataTransfer.getData('application/x-gradian-object');
    if (templateId) {
      const pt = screenToWorld(e.clientX, e.clientY);
      addAsset(templateId, pt.x, pt.z);
      return;
    }
    const materialId = e.dataTransfer.getData('application/x-gradian-material');
    if (materialId) {
      const pt = screenToWorld(e.clientX, e.clientY);
      const hitRoom = scene.rooms.find(
        (r) =>
          r.floorId === activeFloorId &&
          pt.x >= r.x &&
          pt.x <= r.x + r.width &&
          pt.z >= r.z &&
          pt.z <= r.z + r.depth
      );
      if (hitRoom) {
        paintSurfaceWithMaterial('room', hitRoom.id, materialId);
      } else if (activeFloor) {
        paintSurfaceWithMaterial('floor', activeFloor.id, materialId);
      }
    }
  };

  const rooms = useMemo(
    () => scene.rooms.filter((r) => r.floorId === activeFloorId && r.activeFromDate <= timelineDate),
    [scene.rooms, activeFloorId, timelineDate]
  );
  const walls = useMemo(
    () => scene.walls.filter((w) => w.floorId === activeFloorId && w.activeFromDate <= timelineDate),
    [scene.walls, activeFloorId, timelineDate]
  );
  const openings = useMemo(
    () => scene.openings.filter((o) => o.floorId === activeFloorId),
    [scene.openings, activeFloorId]
  );
  const assets = useMemo(
    () => scene.assets.filter((a) => a.floorId === activeFloorId && !a.hidden && a.installationDate <= timelineDate),
    [scene.assets, activeFloorId, timelineDate]
  );
  const cameras = useMemo(
    () => scene.cameras.filter((c) => c.floorId === activeFloorId),
    [scene.cameras, activeFloorId]
  );
  const flows = useMemo(
    () => scene.flows.filter((f) => f.floorId === activeFloorId),
    [scene.flows, activeFloorId]
  );
  const references = useMemo(
    () => scene.references.filter((r) => r.floorId === activeFloorId && r.visible),
    [scene.references, activeFloorId]
  );
  const detectedSpaces = useMemo(
    () => detectEnclosedWallPolygons(walls, rooms, activeFloorId),
    [walls, rooms, activeFloorId]
  );

  // Pre-compute Room FMEA summaries so panning/zooming never re-runs incident scans
  const roomFmeaMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getTargetFmeaSummary>>();
    if (!showFmeaIndicators) return map;
    for (const rm of rooms) {
      map.set(rm.id, getTargetFmeaSummary(riskIncidents, 'room', rm.id, true));
    }
    return map;
  }, [showFmeaIndicators, rooms, riskIncidents]);

  // Pre-compute 2D HVAC ductwork & diffuser layout in world-meter coordinates (scaled by zoom at draw time)
  const hvac2DLayout = useMemo(() => {
    if (!showHvacOverlay || !activeFloor) return null;
    const items: {
      id: string;
      ahuHex: string;
      cx: number;
      cy: number;
      rx: number;
      rzBottom: number;
      badgeLabel: string;
      diffs: { x: number; y: number }[];
    }[] = [];

    let minX = Infinity;
    let maxX = -Infinity;

    for (const rm of rooms) {
      const cfg = getEffectiveRoomHvac(rm);
      if (hvacAhuFilter !== 'all' && cfg.ahuId !== hvacAhuFilter) continue;
      const cx = rm.x + rm.width / 2;
      const cy = rm.z + rm.depth / 2;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;

      const diffCount = Math.max(1, Math.min(6, cfg.diffuserCount));
      const cols = diffCount <= 2 ? diffCount : Math.ceil(Math.sqrt(diffCount));
      const rows = Math.max(1, Math.ceil(diffCount / cols));
      const diffs: { x: number; y: number }[] = [];
      for (let rIdx = 0; rIdx < rows && diffs.length < diffCount; rIdx++) {
        for (let cIdx = 0; cIdx < cols && diffs.length < diffCount; cIdx++) {
          diffs.push({
            x: rm.x + ((cIdx + 0.5) / cols) * rm.width,
            y: rm.z + ((rIdx + 0.5) / rows) * rm.depth,
          });
        }
      }

      items.push({
        id: rm.id,
        ahuHex: getAhuColor(cfg.ahuId),
        cx,
        cy,
        rx: rm.x,
        rzBottom: rm.z + rm.depth,
        badgeLabel: `${cfg.ahuId} · ${cfg.airChangesPerHour}ACH · ${cfg.targetPressurePa >= 0 ? '+' : ''}${cfg.targetPressurePa}Pa`,
        diffs,
      });
    }

    if (items.length === 0) return null;
    return {
      spineZ: activeFloor.depth * 0.5,
      minX,
      maxX,
      items,
    };
  }, [showHvacOverlay, activeFloor, rooms, hvacAhuFilter]);

  const visibleFlows = useMemo(() => {
    if (!showFlows) return [];
    return flows.filter((fl) => {
      if (fl.points.length < 2) return false;
      if (isolatedFlowId) return fl.id === isolatedFlowId;
      return !hiddenFlowIds.includes(fl.id);
    });
  }, [showFlows, flows, isolatedFlowId, hiddenFlowIds]);

  const selectedSet = useMemo(() => new Set(selected.map((s) => `${s.type}:${s.id}`)), [selected]);
  const isDarkBg = canvasBackdrop === 'dark';

  const measureDist =
    measurePoints.length === 2
      ? Math.hypot(measurePoints[1].x - measurePoints[0].x, measurePoints[1].z - measurePoints[0].z)
      : null;

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none touch-none overscroll-none transition-colors duration-200 ${
        isDarkBg ? 'bg-[#09090D]' : 'bg-[#EDEEF2]'
      }`}
    >
      <svg
        ref={svgRef}
        className={`w-full h-full touch-none ${
          isPanning && panOriginRef.current.moved
            ? 'cursor-grabbing'
            : isHandMode || spacePressed
              ? 'cursor-grab'
              : activeTool === 'select'
                ? 'cursor-grab'
                : 'cursor-crosshair'
        }`}
        onPointerDown={(e) => {
          if (openingContextMenu) setOpeningContextMenu(null);
          handleSvgPointerDown(e);
        }}
        onPointerMove={handleSvgPointerMove}
        onPointerUp={handleSvgPointerUp}
        onPointerCancel={handleSvgPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <defs>
          <filter id="slabShadow2D" x="-6%" y="-6%" width="112%" height="112%">
            <feDropShadow
              dx="0"
              dy="4"
              stdDeviation="8"
              floodColor={isDarkBg ? '#000000' : '#18181B'}
              floodOpacity={isDarkBg ? 0.55 : 0.1}
            />
          </filter>
          <pattern
            id="minorGrid2D"
            width={snap.gridSize * zoom}
            height={snap.gridSize * zoom}
            patternUnits="userSpaceOnUse"
            x={pan.x}
            y={pan.y}
          >
            <path
              d={`M ${snap.gridSize * zoom} 0 L 0 0 0 ${snap.gridSize * zoom}`}
              fill="none"
              stroke={isDarkBg ? 'rgba(63,63,70,0.22)' : 'rgba(161,161,170,0.26)'}
              strokeWidth="0.7"
            />
          </pattern>
          <pattern
            id="majorGrid2D"
            width={snap.gridSize * snap.majorGridEvery * zoom}
            height={snap.gridSize * snap.majorGridEvery * zoom}
            patternUnits="userSpaceOnUse"
            x={pan.x}
            y={pan.y}
          >
            <rect width={snap.gridSize * snap.majorGridEvery * zoom} height={snap.gridSize * snap.majorGridEvery * zoom} fill="url(#minorGrid2D)" />
            <path
              d={`M ${snap.gridSize * snap.majorGridEvery * zoom} 0 L 0 0 0 ${snap.gridSize * snap.majorGridEvery * zoom}`}
              fill="none"
              stroke={isDarkBg ? 'rgba(82,82,91,0.38)' : 'rgba(113,113,122,0.38)'}
              strokeWidth="1"
            />
          </pattern>
        </defs>

        {/* Background Grid */}
        <rect
          width="100%"
          height="100%"
          fill={snap.showGrid ? 'url(#majorGrid2D)' : 'transparent'}
          data-canvas-bg="true"
        />

        <g
          transform={`translate(${pan.x}, ${pan.y})`}
          pointerEvents={isHandMode || spacePressed ? 'none' : undefined}
        >
          {/* Floor Slab Boundary */}
          {activeFloor && (
            <g>
              <rect
                x={0}
                y={0}
                width={activeFloor.width * zoom}
                height={activeFloor.depth * zoom}
                rx={4}
                fill={isDarkBg ? '#13131A' : '#FFFFFF'}
                stroke={isDarkBg ? '#2E2E3A' : '#CBD5E1'}
                strokeWidth={2}
                filter="url(#slabShadow2D)"
                data-canvas-bg="true"
              />
              {/* Overall Floor Dimension Labels */}
              <text
                x={(activeFloor.width * zoom) / 2}
                y={-12}
                textAnchor="middle"
                className={`font-mono text-[11px] font-medium ${isDarkBg ? 'fill-zinc-400' : 'fill-zinc-500'}`}
              >
                {formatLength(activeFloor.width, scene.unitSystem, 1)}
              </text>
              <text
                x={-14}
                y={(activeFloor.depth * zoom) / 2}
                textAnchor="middle"
                transform={`rotate(-90, -14, ${(activeFloor.depth * zoom) / 2})`}
                className={`font-mono text-[11px] font-medium ${isDarkBg ? 'fill-zinc-400' : 'fill-zinc-500'}`}
              >
                {formatLength(activeFloor.depth, scene.unitSystem, 1)}
              </text>
            </g>
          )}

          {/* Reference Blueprints */}
          {isLayerVisible('layer-references') &&
            references.map((refPlan) => (
              <g
                key={refPlan.id}
                transform={`translate(${refPlan.x * zoom}, ${refPlan.z * zoom}) rotate(${refPlan.rotationDeg})`}
                opacity={refPlan.opacity}
              >
                <image
                  href={refPlan.dataUrl}
                  width={refPlan.width * zoom}
                  height={refPlan.depth * zoom}
                  preserveAspectRatio="none"
                  pointerEvents="none"
                />
                {selectedSet.has(`reference:${refPlan.id}`) && (
                  <rect
                    width={refPlan.width * zoom}
                    height={refPlan.depth * zoom}
                    fill="none"
                    stroke="#6366F1"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                )}
              </g>
            ))}

          {/* Rooms (Rectangular & Enclosed Polygon Spaces) */}
          {isLayerVisible('layer-architecture') &&
            rooms.map((rm) => {
              const isSel = selectedSet.has(`room:${rm.id}`);
              const fillColor = getRoomColorForAnalytics(rm, analyticsMetric);
              const hasPoly = Boolean(rm.polygon && rm.polygon.length >= 3);
              const polyPointsAttr = hasPoly
                ? rm.polygon!.map((p) => `${p.x * zoom},${p.z * zoom}`).join(' ')
                : '';
              const area = getRoomAreaSqm(rm);
              const centroid = getRoomCentroid(rm);
              const rw = rm.width * zoom;
              const rd = rm.depth * zoom;
              const rx = rm.x * zoom;
              const rz = rm.z * zoom;
              const shortTitle = rm.name.length > 24 ? `${rm.name.slice(0, 22)}…` : rm.name;
              const metaLabel = `${rm.code} · ${formatArea(area, scene.unitSystem)} · ${rm.environmental.pressurePa >= 0 ? `+${rm.environmental.pressurePa}` : rm.environmental.pressurePa} Pa`;
              const pillW = Math.min(Math.max(rw - 12, 60), Math.max(shortTitle.length * 6.4, metaLabel.length * 5.6) + 18);

              const isLineFailRoom = activeLineHighlight?.failingRoomIds.includes(rm.id) ?? false;
              const isLineOkRoom = activeLineHighlight?.compliantRoomIds.includes(rm.id) ?? false;
              const isLineDimmed = Boolean(activeLineHighlight) && !isLineFailRoom && !isLineOkRoom;
              const isCatDimmed = categoryFilter !== 'all' && !doesRoomMatchCategory(rm, categoryFilter);
              const roomBaseFill = isLineFailRoom
                ? '#EF4444'
                : isLineOkRoom
                  ? activeLineHighlight?.eligible
                    ? '#10B981'
                    : '#34D399'
                  : fillColor;

              const roomFillOpacity =
                isLineFailRoom || isLineOkRoom
                  ? 0.28
                  : isLineDimmed
                    ? 0.04
                    : analyticsMetric !== 'none'
                      ? isDarkBg
                        ? 0.3
                        : 0.34
                      : isDarkBg
                        ? 0.085
                        : 0.13;
              const roomStroke = isLineFailRoom
                ? '#EF4444'
                : isLineOkRoom
                  ? '#10B981'
                  : isSel
                    ? '#8B5CF6'
                    : isDarkBg
                      ? '#2F2F3D'
                      : fillColor;
              const roomStrokeOpacity = isSel || isLineFailRoom || isLineOkRoom ? 1 : isDarkBg ? 0.9 : 0.45;
              const roomStrokeWidth = isLineFailRoom || isLineOkRoom ? 3 : isSel ? 2.5 : 1.1;

              return (
                <g
                  key={rm.id}
                  opacity={isCatDimmed ? 0.16 : 1}
                  onPointerDown={(e) => {
                    if (isHandMode || spacePressed || e.button !== 0 || e.altKey || activeTool === 'draw-wall') {
                      return; // Allow bubbling to SVG pan / continuous wall chain handler
                    }
                    if (activeTool === 'paint-material' && !isReadOnly) {
                      e.stopPropagation();
                      paintSurfaceWithMaterial('room', rm.id, selectedMaterialId);
                    } else if (activeTool === 'select' || isReadOnly) {
                      // Record room click and let event bubble so dragging >4px pans the 2D canvas smoothly
                      pendingRoomSelectRef.current = { roomId: rm.id, shiftKey: e.shiftKey };
                    }
                  }}
                  className={
                    activeTool === 'draw-wall'
                      ? 'cursor-crosshair'
                      : isHandMode || spacePressed
                        ? 'cursor-grab'
                        : 'cursor-pointer'
                  }
                >
                  {hasPoly ? (
                    <>
                      {isDarkBg && <polygon points={polyPointsAttr} fill="#181822" />}
                      <polygon
                        points={polyPointsAttr}
                        fill={roomBaseFill}
                        fillOpacity={roomFillOpacity}
                        stroke={roomStroke}
                        strokeOpacity={roomStrokeOpacity}
                        strokeWidth={roomStrokeWidth}
                        strokeLinejoin="round"
                      />
                    </>
                  ) : (
                    <>
                      {/* Neutral Charcoal Base Plate in Dark Mode (prevents muddy navy tint) */}
                      {isDarkBg && (
                        <rect
                          x={rx}
                          y={rz}
                          width={rw}
                          height={rd}
                          fill="#181822"
                        />
                      )}
                      <rect
                        x={rx}
                        y={rz}
                        width={rw}
                        height={rd}
                        fill={roomBaseFill}
                        fillOpacity={roomFillOpacity}
                        stroke={roomStroke}
                        strokeOpacity={roomStrokeOpacity}
                        strokeWidth={roomStrokeWidth}
                      />
                      {/* Subtle Zone Color Top Accent Bar */}
                      <rect
                        x={rx + 1}
                        y={rz + 1}
                        width={Math.max(0, rw - 2)}
                        height={Math.min(3.5, rd)}
                        fill={
                          isLineFailRoom
                            ? '#EF4444'
                            : isLineOkRoom
                              ? '#10B981'
                              : isSel
                                ? '#8B5CF6'
                                : fillColor
                        }
                        fillOpacity={isLineDimmed ? 0.2 : isDarkBg ? 0.78 : 0.7}
                        pointerEvents="none"
                      />
                    </>
                  )}
                  {/* Selected Room Move & Corner Resize Handles in Design Mode */}
                  {isSel && !isReadOnly && activeTool === 'select' && !hasPoly && (
                    <g>
                      <rect
                        x={rx + rw - 11}
                        y={rz + rd - 11}
                        width={11}
                        height={11}
                        rx={2}
                        fill="#8B5CF6"
                        stroke="#FFFFFF"
                        strokeWidth={1.5}
                        className="cursor-nwse-resize"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setDraggingRoom({
                            roomId: rm.id,
                            mode: 'resize',
                            startPt: screenToWorld(e.clientX, e.clientY),
                            origX: rm.x,
                            origZ: rm.z,
                            origW: rm.width,
                            origD: rm.depth,
                          });
                        }}
                      />
                      <circle
                        cx={rx + 10}
                        cy={rz + rd - 10}
                        r={5.5}
                        fill="#10B981"
                        stroke="#FFFFFF"
                        strokeWidth={1.5}
                        className="cursor-move"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setDraggingRoom({
                            roomId: rm.id,
                            mode: 'move',
                            startPt: screenToWorld(e.clientX, e.clientY),
                            origX: rm.x,
                            origZ: rm.z,
                            origW: rm.width,
                            origD: rm.depth,
                          });
                        }}
                      />
                    </g>
                  )}
                  {/* Readable Room Label Badge (centroid for polygon rooms, top-left for rectangular rooms) */}
                  {zoom >= 12 && rw >= 68 && rd >= 42 && (
                    <g
                      pointerEvents="none"
                      transform={
                        hasPoly
                          ? `translate(${centroid.x * zoom - pillW / 2}, ${centroid.z * zoom - 15})`
                          : `translate(${rx + 6}, ${rz + 7})`
                      }
                    >
                      <rect
                        x={0}
                        y={0}
                        width={pillW}
                        height={30}
                        rx={6}
                        fill={isDarkBg ? '#101016' : '#FFFFFF'}
                        fillOpacity={isDarkBg ? 0.84 : 0.88}
                        stroke={isSel ? '#8B5CF6' : isDarkBg ? '#2A2A36' : '#E4E4E7'}
                        strokeWidth={0.9}
                      />
                      <text
                        x={8}
                        y={13}
                        className={`text-[10.5px] font-semibold ${isDarkBg ? 'fill-zinc-100' : 'fill-zinc-900'}`}
                      >
                        {shortTitle}
                      </text>
                      <text
                        x={8}
                        y={24.5}
                        className={`font-mono text-[9px] ${isDarkBg ? 'fill-zinc-400' : 'fill-zinc-500'}`}
                      >
                        {metaLabel}
                      </text>
                    </g>
                  )}
                  {/* 2D Room FMEA RPN Status Indicator (Memoized Lookup) */}
                  {showFmeaIndicators && (() => {
                    const rmFmea = roomFmeaMap.get(rm.id);
                    if (!rmFmea || rmFmea.level === 'clear' || !rmFmea.worstIncident || rw < 42) return null;
                    const badgeFill =
                      rmFmea.level === 'critical'
                        ? '#F43F5E'
                        : rmFmea.level === 'high'
                          ? '#F59E0B'
                          : rmFmea.level === 'mitigated'
                            ? '#10B981'
                            : '#8B5CF6';
                    const textFill = rmFmea.level === 'high' || rmFmea.level === 'mitigated' ? '#09090B' : '#FFFFFF';
                    const bw = 54;
                    return (
                      <g
                        transform={`translate(${rx + rw - bw - 6}, ${rz + 7})`}
                        className="cursor-pointer"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          openRiskModal({ mode: 'resolve', incidentId: rmFmea.worstIncident!.id });
                        }}
                      >
                        <rect x={0} y={0} width={bw} height={17} rx={4} fill={badgeFill} />
                        <text
                          x={bw / 2}
                          y={11.5}
                          textAnchor="middle"
                          fill={textFill}
                          className="font-mono text-[9px] font-bold"
                        >
                          {rmFmea.shortLabel}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}

          {/* Auto-Detected Unnamed Enclosed Polygon Spaces */}
          {isLayerVisible('layer-architecture') &&
            detectedSpaces.map((sp) => {
              const ptsAttr = sp.polygon.map((p) => `${p.x * zoom},${p.z * zoom}`).join(' ');
              const isPending = pendingPolygonSpace?.id === sp.id;
              const cx = sp.centroid.x * zoom;
              const cy = sp.centroid.z * zoom;
              const badgeText = `${formatArea(sp.areaSqm, scene.unitSystem)} · Name Area`;
              const badgeW = Math.max(98, badgeText.length * 6.2 + 16);
              return (
                <g
                  key={sp.id}
                  pointerEvents={activeTool === 'draw-wall' ? 'none' : 'auto'}
                  className={activeTool === 'draw-wall' ? undefined : 'cursor-pointer'}
                  onPointerDown={(e) => {
                    if (activeTool === 'draw-wall' || isReadOnly || e.button !== 0 || isHandMode || spacePressed) return;
                    e.stopPropagation();
                    setPendingPolygonSpace(sp);
                  }}
                >
                  <polygon
                    points={ptsAttr}
                    fill="#10B981"
                    fillOpacity={isPending ? 0.26 : isDarkBg ? 0.12 : 0.14}
                    stroke="#10B981"
                    strokeWidth={isPending ? 2.4 : 1.6}
                    strokeDasharray="6 4"
                    strokeLinejoin="round"
                  />
                  {zoom >= 10 && (
                    <g transform={`translate(${cx - badgeW / 2}, ${cy - 11})`}>
                      <rect
                        x={0}
                        y={0}
                        width={badgeW}
                        height={22}
                        rx={6}
                        fill={isPending ? '#059669' : isDarkBg ? '#0F1A17' : '#ECFDF5'}
                        stroke="#10B981"
                        strokeWidth={1.1}
                      />
                      <text
                        x={badgeW / 2}
                        y={14}
                        textAnchor="middle"
                        className={`font-mono text-[9.5px] font-semibold ${
                          isPending
                            ? 'fill-white'
                            : isDarkBg
                              ? 'fill-emerald-300'
                              : 'fill-emerald-800'
                        }`}
                      >
                        {badgeText}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

          {/* 2D HVAC Ductwork & HEPA Terminal Diffuser Overlay (Precomputed Layout) */}
          {hvac2DLayout && (
            <g pointerEvents="none">
              <line
                x1={hvac2DLayout.minX * zoom}
                y1={hvac2DLayout.spineZ * zoom - 4}
                x2={hvac2DLayout.maxX * zoom}
                y2={hvac2DLayout.spineZ * zoom - 4}
                stroke="#06B6D4"
                strokeWidth={4}
                strokeDasharray="10 4"
                strokeOpacity={0.85}
              />
              <line
                x1={hvac2DLayout.minX * zoom}
                y1={hvac2DLayout.spineZ * zoom + 5}
                x2={hvac2DLayout.maxX * zoom}
                y2={hvac2DLayout.spineZ * zoom + 5}
                stroke="#F59E0B"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                strokeOpacity={0.7}
              />
              {hvac2DLayout.items.map((item) => {
                const cx = item.cx * zoom;
                const cy = item.cy * zoom;
                const spineY = hvac2DLayout.spineZ * zoom - 4;
                return (
                  <g key={`hvac-2d-${item.id}`}>
                    <line
                      x1={cx}
                      y1={spineY}
                      x2={cx}
                      y2={cy}
                      stroke={item.ahuHex}
                      strokeWidth={2.4}
                      strokeOpacity={0.85}
                    />
                    {item.diffs.map((d, di) => {
                      const dx = d.x * zoom;
                      const dy = d.y * zoom;
                      return (
                        <g key={di} transform={`translate(${dx}, ${dy})`}>
                          <line x1={cx - dx} y1={cy - dy} x2={0} y2={0} stroke={item.ahuHex} strokeWidth={1.2} strokeOpacity={0.55} />
                          <rect x={-7} y={-7} width={14} height={14} rx={2} fill="#09090D" fillOpacity={0.85} stroke={item.ahuHex} strokeWidth={1.4} />
                          <line x1={-5} y1={-5} x2={5} y2={5} stroke={item.ahuHex} strokeWidth={1} />
                          <line x1={5} y1={-5} x2={-5} y2={5} stroke={item.ahuHex} strokeWidth={1} />
                        </g>
                      );
                    })}
                    {zoom >= 12 && (
                      <g transform={`translate(${item.rx * zoom + 6}, ${item.rzBottom * zoom - 20})`}>
                        <rect x={0} y={0} width={118} height={15} rx={3} fill="#0B131E" fillOpacity={0.88} stroke={item.ahuHex} strokeWidth={0.8} />
                        <text x={5} y={10.5} fill="#E0F2FE" className="font-mono text-[8.5px] font-semibold">
                          {item.badgeLabel}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Walls */}
          {isLayerVisible('layer-walls') &&
            walls.map((w) => {
              const isSel = selectedSet.has(`wall:${w.id}`);
              const isGlassWall = w.presetId === 'full-glass-wall' || w.presetId === 'glass-partition';
              const wallLen = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
              const isOpeningTool =
                !isReadOnly &&
                (activeTool === 'place-door' ||
                  activeTool === 'place-window' ||
                  Boolean(dragOpeningSubtype));
              const isDropTargetWall = isOpeningTool && openingDropPreview?.wall.id === w.id;
              const isEligibleDropWall = isOpeningTool && wallLen >= 0.7;
              const dropAccent =
                activeOpeningPreset.kind === 'window' ? '#38BDF8' : '#F59E0B';
              const markerRatios = wallLen >= 6 ? [0.25, 0.5, 0.75] : [0.5];
              return (
                <g key={w.id}>
                  {/* Glowing Wall Drop-Zone Corridor & Target Markers when placing/dragging a Door or Window */}
                  {isEligibleDropWall && (
                    <g pointerEvents="none">
                      <line
                        x1={w.x1 * zoom}
                        y1={w.z1 * zoom}
                        x2={w.x2 * zoom}
                        y2={w.z2 * zoom}
                        stroke={isDropTargetWall ? '#10B981' : dropAccent}
                        strokeWidth={Math.max(14, w.thickness * zoom + 12)}
                        strokeOpacity={isDropTargetWall ? 0.38 : 0.16}
                        strokeLinecap="round"
                      />
                      <line
                        x1={w.x1 * zoom}
                        y1={w.z1 * zoom}
                        x2={w.x2 * zoom}
                        y2={w.z2 * zoom}
                        stroke={isDropTargetWall ? '#34D399' : dropAccent}
                        strokeWidth={1.6}
                        strokeOpacity={isDropTargetWall ? 0.9 : 0.55}
                        strokeDasharray="6 4"
                      />
                      {!isDropTargetWall &&
                        markerRatios.map((r) => {
                          const mx = (w.x1 + (w.x2 - w.x1) * r) * zoom;
                          const mz = (w.z1 + (w.z2 - w.z1) * r) * zoom;
                          return (
                            <g key={r} transform={`translate(${mx}, ${mz})`}>
                              <circle
                                r={5.5}
                                fill={isDarkBg ? '#0F172A' : '#FFFFFF'}
                                stroke={dropAccent}
                                strokeWidth={1.6}
                              />
                              <circle r={2} fill={dropAccent} />
                            </g>
                          );
                        })}
                    </g>
                  )}
                  <line
                    x1={w.x1 * zoom}
                    y1={w.z1 * zoom}
                    x2={w.x2 * zoom}
                    y2={w.z2 * zoom}
                    stroke={
                      isDropTargetWall
                        ? '#10B981'
                        : isSel
                          ? '#8B5CF6'
                          : isGlassWall
                            ? '#38BDF8'
                            : isDarkBg
                              ? '#D4D4DE'
                              : '#27272A'
                    }
                    strokeWidth={Math.max(3, w.thickness * zoom)}
                    strokeOpacity={isGlassWall && !isSel ? 0.78 : 1}
                    strokeDasharray={w.presetId === 'full-glass-wall' ? '8 2' : undefined}
                    strokeLinecap="square"
                    className={activeTool === 'draw-wall' || isOpeningTool ? 'cursor-crosshair' : 'cursor-pointer'}
                    onPointerDown={(e) => {
                      if (activeTool === 'draw-wall' || isHandMode || spacePressed || e.altKey || e.button !== 0) {
                        return; // Let click bubble to SVG wall chaining / pan handler so users can snap onto walls & close loops
                      }
                      e.stopPropagation();
                      if (isOpeningTool) {
                        const clickPt = screenToWorld(e.clientX, e.clientY);
                        const drop = findOpeningDropZone(
                          clickPt.x,
                          clickPt.z,
                          scene.walls,
                          activeFloorId,
                          activeOpeningPreset,
                          snap,
                          2.2,
                          w.id
                        );
                        if (drop) {
                          addOpeningOnWall(drop.wall.id, drop.offsetRatio, activeOpeningPreset.subtype);
                          setOpeningDropPreview(null);
                          setOpeningHoverPt(null);
                          setActiveTool('select');
                        }
                      } else if (!isReadOnly && activeTool === 'paint-material') {
                        paintSurfaceWithMaterial('wall', w.id, selectedMaterialId);
                      } else if (activeTool === 'select' || isReadOnly) {
                        selectEntity({ type: 'wall', id: w.id }, e.shiftKey);
                      }
                    }}
                  />
                  {/* Visual Endpoint Drag Handles when Selected */}
                  {isSel && !isReadOnly && (
                    <>
                      <circle
                        cx={w.x1 * zoom}
                        cy={w.z1 * zoom}
                        r={5}
                        fill="#8B5CF6"
                        stroke="#FFFFFF"
                        strokeWidth={1.5}
                        className="cursor-move"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setDraggingWallHandle({ wallId: w.id, end: 1 });
                        }}
                      />
                      <circle
                        cx={w.x2 * zoom}
                        cy={w.z2 * zoom}
                        r={5}
                        fill="#8B5CF6"
                        stroke="#FFFFFF"
                        strokeWidth={1.5}
                        className="cursor-move"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setDraggingWallHandle({ wallId: w.id, end: 2 });
                        }}
                      />
                    </>
                  )}
                </g>
              );
            })}

          {/* Doors & Windows (Interactive: Hover Highlight, Select, Slide Along Wall, Resize Handles, Right-Click Context Menu) */}
          {isLayerVisible('layer-openings') &&
            openings.map((op) => {
              const wall = walls.find((w) => w.id === op.wallId);
              if (!wall) return null;
              const wallLen = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
              const angleRad = Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1);
              const angleDeg = (angleRad * 180) / Math.PI;
              const cx = (wall.x1 + (wall.x2 - wall.x1) * op.offsetRatio) * zoom;
              const cy = (wall.z1 + (wall.z2 - wall.z1) * op.offsetRatio) * zoom;
              const isSel = selectedSet.has(`opening:${op.id}`);
              const isHovered = hoveredOpeningId === op.id;
              const isDraggingThis = draggingOpeningId === op.id || resizingOpening?.id === op.id;
              const ow = op.width * zoom;
              const swingFlip = op.swingDirection === 'left' ? -1 : 1;
              const hoverStroke = op.kind === 'window' ? '#38BDF8' : '#A78BFA';
              const leftClearM = Math.max(0, op.offsetRatio * wallLen - op.width / 2);
              const rightClearM = Math.max(0, (1 - op.offsetRatio) * wallLen - op.width / 2);

              return (
                <g key={op.id}>
                  <g
                    transform={`translate(${cx}, ${cy}) rotate(${angleDeg})`}
                    className={
                      isDraggingThis
                        ? 'cursor-grabbing'
                        : isSel && !isReadOnly
                          ? 'cursor-grab'
                          : 'cursor-pointer'
                    }
                    onPointerEnter={() => setHoveredOpeningId(op.id)}
                    onPointerLeave={() =>
                      setHoveredOpeningId((cur) => (cur === op.id ? null : cur))
                    }
                    onPointerDown={(e) => {
                      if (
                        activeTool === 'draw-wall' ||
                        activeTool === 'place-door' ||
                        activeTool === 'place-window' ||
                        isHandMode ||
                        spacePressed ||
                        e.altKey ||
                        e.button !== 0
                      ) {
                        return;
                      }
                      e.stopPropagation();
                      setOpeningContextMenu(null);
                      selectEntity({ type: 'opening', id: op.id }, e.shiftKey);
                      setRightTab('properties');
                      setRightPanelOpen(true);
                      if (!isReadOnly && activeTool === 'select') {
                        setDraggingOpeningId(op.id);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      selectEntity({ type: 'opening', id: op.id });
                      const rect = containerRef.current?.getBoundingClientRect();
                      const rawX = rect ? e.clientX - rect.left : e.clientX;
                      const rawY = rect ? e.clientY - rect.top : e.clientY;
                      const maxW = rect ? rect.width - 280 : rawX;
                      const maxH = rect ? rect.height - 340 : rawY;
                      setOpeningContextMenu({
                        openingId: op.id,
                        x: Math.max(12, Math.min(maxW, rawX)),
                        y: Math.max(12, Math.min(maxH, rawY)),
                      });
                    }}
                  >
                    {/* Generous transparent hit target for effortless clicking & hovering */}
                    <rect x={-ow / 2 - 8} y={-15} width={ow + 16} height={30} fill="transparent" />

                    {/* Hover Highlight Halo */}
                    {isHovered && !isSel && (
                      <rect
                        x={-ow / 2 - 5}
                        y={-9.5}
                        width={ow + 10}
                        height={19}
                        rx={4}
                        fill={hoverStroke}
                        fillOpacity={0.18}
                        stroke={hoverStroke}
                        strokeWidth={1.6}
                      />
                    )}

                    {/* Selection Highlight Ring */}
                    {isSel && (
                      <rect
                        x={-ow / 2 - 5}
                        y={-9.5}
                        width={ow + 10}
                        height={19}
                        rx={4}
                        fill="#8B5CF6"
                        fillOpacity={0.22}
                        stroke="#8B5CF6"
                        strokeWidth={1.8}
                        strokeDasharray="4 2"
                      />
                    )}

                    {/* Cut wall gap */}
                    <rect
                      x={-ow / 2}
                      y={-4.5}
                      width={ow}
                      height={9}
                      fill={isDarkBg ? '#181822' : '#FFFFFF'}
                    />

                    {op.kind === 'window' ? (
                      <>
                        <rect
                          x={-ow / 2}
                          y={-3.2}
                          width={ow}
                          height={6.4}
                          fill="#38BDF8"
                          fillOpacity={isSel || isHovered ? 0.92 : 0.78}
                          stroke={isSel ? '#8B5CF6' : isHovered ? '#7DD3FC' : '#0284C7'}
                          strokeWidth={isSel || isHovered ? 2 : 1.5}
                        />
                        <line
                          x1={-ow / 2 + 2}
                          y1={0}
                          x2={ow / 2 - 2}
                          y2={0}
                          stroke="#E0F2FE"
                          strokeWidth={1}
                          strokeOpacity={0.9}
                        />
                      </>
                    ) : (
                      <>
                        <line
                          x1={-ow / 2}
                          y1={0}
                          x2={-ow / 2}
                          y2={swingFlip * ow * 0.85}
                          stroke={
                            isSel
                              ? '#8B5CF6'
                              : isHovered
                                ? '#C4B5FD'
                                : isDarkBg
                                  ? '#F59E0B'
                                  : '#7C3AED'
                          }
                          strokeWidth={isSel || isHovered ? 2.6 : 2}
                        />
                        <path
                          d={`M ${-ow / 2} ${swingFlip * ow * 0.85} A ${ow * 0.85} ${ow * 0.85} 0 0 ${swingFlip > 0 ? 0 : 1} ${ow / 2} 0`}
                          fill={isHovered || isSel ? '#8B5CF6' : 'none'}
                          fillOpacity={isHovered || isSel ? 0.1 : 0}
                          stroke={
                            isSel
                              ? '#8B5CF6'
                              : isHovered
                                ? '#C4B5FD'
                                : isDarkBg
                                  ? '#F59E0B'
                                  : '#7C3AED'
                          }
                          strokeOpacity={0.88}
                          strokeWidth={isSel || isHovered ? 1.6 : 1.2}
                          strokeDasharray="3 2"
                        />
                      </>
                    )}

                    {/* Selected Opening Slide & Endpoint Width Resize Handles */}
                    {isSel && !isReadOnly && (
                      <>
                        <circle
                          cx={0}
                          cy={0}
                          r={4.2}
                          fill="#8B5CF6"
                          stroke="#FFFFFF"
                          strokeWidth={1.4}
                        />
                        {([-1, 1] as const).map((side) => (
                          <rect
                            key={side}
                            x={side * (ow / 2) - 3.5}
                            y={-6.5}
                            width={7}
                            height={13}
                            rx={2}
                            fill="#FFFFFF"
                            stroke="#7C3AED"
                            strokeWidth={1.6}
                            className="cursor-ew-resize"
                            onPointerDown={(ev) => {
                              if (ev.button !== 0) return;
                              ev.stopPropagation();
                              setOpeningContextMenu(null);
                              setResizingOpening({ id: op.id, side });
                            }}
                          />
                        ))}
                      </>
                    )}
                  </g>

                  {/* Floating Hover / Live Drag Dimension Callout */}
                  {(isHovered || isDraggingThis) && !openingContextMenu && (() => {
                    const labelText = isDraggingThis
                      ? `← ${leftClearM.toFixed(1)}m | ${op.width.toFixed(2)}m (${Math.round(op.offsetRatio * 100)}%) | ${rightClearM.toFixed(1)}m →`
                      : `${op.name} · ${op.width.toFixed(2)}×${op.height.toFixed(2)}m · Right-click`;
                    const boxW = Math.max(138, labelText.length * 5.6 + 16);
                    return (
                      <g pointerEvents="none" transform={`translate(${cx - boxW / 2}, ${cy - 30})`}>
                        <rect
                          x={0}
                          y={0}
                          width={boxW}
                          height={20}
                          rx={5}
                          fill={isDraggingThis ? '#4C1D95' : isDarkBg ? '#14141D' : '#18181B'}
                          fillOpacity={0.94}
                          stroke={isDraggingThis ? '#A78BFA' : hoverStroke}
                          strokeWidth={1}
                        />
                        <text
                          x={boxW / 2}
                          y={13}
                          textAnchor="middle"
                          className="font-mono text-[9px] font-semibold fill-white"
                        >
                          {labelText}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}

          {/* Live 2D Door / Window Wall Drop-Zone Preview Ghost (Active for both Tool Click & Drag-and-Drop) */}
          {!isReadOnly &&
            (activeTool === 'place-door' ||
              activeTool === 'place-window' ||
              Boolean(dragOpeningSubtype)) &&
            openingDropPreview &&
            (() => {
              const angleDeg = (openingDropPreview.angleRad * 180) / Math.PI;
              const cx = openingDropPreview.worldX * zoom;
              const cy = openingDropPreview.worldZ * zoom;
              const ow = openingDropPreview.width * zoom;
              const isWin = activeOpeningPreset.kind === 'window';
              const isDraggingDnd = Boolean(dragOpeningSubtype);
              const leftDist = Math.max(
                0,
                openingDropPreview.distFromStart - openingDropPreview.width / 2
              );
              const rightDist = Math.max(
                0,
                openingDropPreview.wallLength -
                  openingDropPreview.distFromStart -
                  openingDropPreview.width / 2
              );
              const badgeLabel = `${isWin ? 'Window' : 'Door'} · ${openingDropPreview.width.toFixed(1)}×${openingDropPreview.height.toFixed(1)}m · ${Math.round(openingDropPreview.offsetRatio * 100)}%${isDraggingDnd ? ' · Drop to place' : ''}`;
              const badgeW = Math.max(132, badgeLabel.length * 6.0 + 16);
              const wx1 = openingDropPreview.wall.x1 * zoom;
              const wy1 = openingDropPreview.wall.z1 * zoom;
              const wx2 = openingDropPreview.wall.x2 * zoom;
              const wy2 = openingDropPreview.wall.z2 * zoom;
              const cosA = Math.cos(openingDropPreview.angleRad);
              const sinA = Math.sin(openingDropPreview.angleRad);
              const edgeLx = cx - cosA * (ow / 2);
              const edgeLy = cy - sinA * (ow / 2);
              const edgeRx = cx + cosA * (ow / 2);
              const edgeRy = cy + sinA * (ow / 2);
              const midLx = (wx1 + edgeLx) / 2;
              const midLy = (wy1 + edgeLy) / 2;
              const midRx = (wx2 + edgeRx) / 2;
              const midRy = (wy2 + edgeRy) / 2;

              return (
                <g pointerEvents="none">
                  {/* Live Wall Endpoint Clearance Labels */}
                  {leftDist >= 0.25 && (
                    <g transform={`translate(${midLx - 18}, ${midLy - 16})`}>
                      <rect x={0} y={0} width={36} height={14} rx={3} fill="#064E3B" fillOpacity={0.92} />
                      <text x={18} y={10} textAnchor="middle" className="font-mono text-[8.5px] font-semibold fill-emerald-200">
                        {leftDist.toFixed(1)}m
                      </text>
                    </g>
                  )}
                  {rightDist >= 0.25 && (
                    <g transform={`translate(${midRx - 18}, ${midRy - 16})`}>
                      <rect x={0} y={0} width={36} height={14} rx={3} fill="#064E3B" fillOpacity={0.92} />
                      <text x={18} y={10} textAnchor="middle" className="font-mono text-[8.5px] font-semibold fill-emerald-200">
                        {rightDist.toFixed(1)}m
                      </text>
                    </g>
                  )}

                  {/* Architectural Opening Ghost Preview */}
                  <g transform={`translate(${cx}, ${cy}) rotate(${angleDeg})`}>
                    <rect
                      x={-ow / 2 - 5}
                      y={-10}
                      width={ow + 10}
                      height={20}
                      rx={4}
                      fill="#10B981"
                      fillOpacity={0.28}
                      stroke="#10B981"
                      strokeWidth={2}
                    />
                    {/* Drop-zone edge anchor brackets */}
                    <line x1={-ow / 2} y1={-12} x2={-ow / 2} y2={12} stroke="#34D399" strokeWidth={1.6} />
                    <line x1={ow / 2} y1={-12} x2={ow / 2} y2={12} stroke="#34D399" strokeWidth={1.6} />
                    {isWin ? (
                      <>
                        <rect
                          x={-ow / 2}
                          y={-3.5}
                          width={ow}
                          height={7}
                          fill="#38BDF8"
                          fillOpacity={0.92}
                          stroke="#FFFFFF"
                          strokeWidth={1.2}
                        />
                        <line x1={-ow / 2 + 2} y1={0} x2={ow / 2 - 2} y2={0} stroke="#FFFFFF" strokeWidth={1} />
                      </>
                    ) : (
                      <>
                        <line x1={-ow / 2} y1={0} x2={-ow / 2} y2={ow * 0.85} stroke="#10B981" strokeWidth={2.5} />
                        <path
                          d={`M ${-ow / 2} ${ow * 0.85} A ${ow * 0.85} ${ow * 0.85} 0 0 0 ${ow / 2} 0`}
                          fill="#10B981"
                          fillOpacity={0.16}
                          stroke="#10B981"
                          strokeWidth={1.5}
                          strokeDasharray="4 2"
                        />
                      </>
                    )}
                  </g>

                  <g transform={`translate(${cx - badgeW / 2}, ${cy - 34})`}>
                    <rect x={0} y={0} width={badgeW} height={21} rx={5} fill="#065F46" stroke="#34D399" strokeWidth={1.2} />
                    <text x={badgeW / 2} y={13.5} textAnchor="middle" className="font-mono text-[9.5px] font-semibold fill-white">
                      {badgeLabel}
                    </text>
                  </g>
                </g>
              );
            })()}

          {/* Off-wall Invalid Drop Indicator when hovering or dragging in empty air */}
          {!isReadOnly &&
            (activeTool === 'place-door' ||
              activeTool === 'place-window' ||
              Boolean(dragOpeningSubtype)) &&
            !openingDropPreview &&
            openingHoverPt && (
              <g pointerEvents="none" transform={`translate(${openingHoverPt.x * zoom}, ${openingHoverPt.z * zoom})`}>
                <circle r={7} fill="#EF4444" fillOpacity={0.14} stroke="#EF4444" strokeWidth={1.8} strokeDasharray="3 2" />
                <line x1={-3.5} y1={-3.5} x2={3.5} y2={3.5} stroke="#EF4444" strokeWidth={1.5} />
                <line x1={3.5} y1={-3.5} x2={-3.5} y2={3.5} stroke="#EF4444" strokeWidth={1.5} />
                <g transform="translate(-84, -30)">
                  <rect x={0} y={0} width={168} height={20} rx={5} fill="#7F1D1D" stroke="#EF4444" strokeWidth={1} />
                  <text x={84} y={13} textAnchor="middle" className="font-mono text-[9px] font-semibold fill-red-100">
                    {dragOpeningSubtype ? 'Drop onto a highlighted wall' : 'Move onto a wall to place'}
                  </text>
                </g>
              </g>
            )}

          {/* Flow Routes (Animated + Toggle Off + Isolate + Interactive Node Modify Mode) */}
          {showFlows &&
            isLayerVisible('layer-flows') &&
            visibleFlows.map((fl) => {
                const isSel = selectedSet.has(`flow:${fl.id}`);
                const isModifying = !isReadOnly && (isSel || editingFlowId === fl.id);
                const d = fl.points
                  .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * zoom} ${p.z * zoom}`)
                  .join(' ');
              return (
                <g
                  key={fl.id}
                  className="cursor-pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    selectEntity({ type: 'flow', id: fl.id }, e.shiftKey);
                  }}
                >
                  {/* Base Path */}
                  <path
                    d={d}
                    fill="none"
                    stroke={isModifying ? '#FFFFFF' : fl.color}
                    strokeWidth={isModifying ? 5 : 3.2}
                    strokeOpacity={isModifying ? 0.35 : 0.92}
                    strokeDasharray={fl.flowType === 'airflow' ? '6 4' : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Colored Flow Core + Optional Animated Pulse Overlay */}
                  <path
                    d={d}
                    fill="none"
                    stroke={fl.color}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {animateFlows && fl.animated !== false && (
                    <path
                      d={d}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeOpacity={0.82}
                      strokeWidth={2}
                      strokeDasharray="6 26"
                      strokeLinecap="round"
                      className="animate-flow-dash pointer-events-none"
                    />
                  )}

                  {/* Midpoint "+" Insert Node Handles in Modify Mode */}
                  {isModifying &&
                    fl.points.slice(0, -1).map((p, idx) => {
                      const next = fl.points[idx + 1];
                      const mx = ((p.x + next.x) / 2) * zoom;
                      const mz = ((p.z + next.z) / 2) * zoom;
                      return (
                        <g
                          key={`mid-${idx}`}
                          transform={`translate(${mx}, ${mz})`}
                          className="cursor-copy"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            const inserted = [
                              ...fl.points.slice(0, idx + 1),
                              {
                                x: Number(((p.x + next.x) / 2).toFixed(2)),
                                z: Number(((p.z + next.z) / 2).toFixed(2)),
                              },
                              ...fl.points.slice(idx + 1),
                            ];
                            updateFlowRoute(fl.id, { points: inserted });
                          }}
                        >
                          <circle r={6} fill="#18181F" stroke="#8B5CF6" strokeWidth={1.5} />
                          <text
                            y={3}
                            textAnchor="middle"
                            className="fill-violet-300 text-[10px] font-bold pointer-events-none"
                          >
                            +
                          </text>
                        </g>
                      );
                    })}

                  {/* Draggable Vertex Nodes (Double-click / Right-click removes node when > 2 pts) */}
                  {fl.points.map((p, idx) => (
                    <circle
                      key={idx}
                      cx={p.x * zoom}
                      cy={p.z * zoom}
                      r={isModifying ? 6.5 : idx === fl.points.length - 1 ? 5 : 3.5}
                      fill={isModifying ? '#FFFFFF' : fl.color}
                      stroke={isModifying ? '#8B5CF6' : isDarkBg ? '#111116' : '#FFFFFF'}
                      strokeWidth={isModifying ? 2.2 : 1.2}
                      className={isModifying ? 'cursor-move' : 'cursor-pointer'}
                      onPointerDown={(e) => {
                        if (!isModifying) return;
                        e.stopPropagation();
                        setDraggingFlowNode({ flowId: fl.id, idx });
                      }}
                      onDoubleClick={(e) => {
                        if (!isModifying || fl.points.length <= 2) return;
                        e.stopPropagation();
                        updateFlowRoute(fl.id, {
                          points: fl.points.filter((_, i) => i !== idx),
                        });
                      }}
                      onContextMenu={(e) => {
                        if (!isModifying || fl.points.length <= 2) return;
                        e.preventDefault();
                        e.stopPropagation();
                        updateFlowRoute(fl.id, {
                          points: fl.points.filter((_, i) => i !== idx),
                        });
                      }}
                    >
                      <title>
                        {isModifying
                          ? `Node ${idx + 1} (${p.x}m, ${p.z}m) — Drag to move, double-click or right-click to delete`
                          : fl.name}
                      </title>
                    </circle>
                  ))}
                </g>
              );
            })}

          {/* Intelligent Assets */}
          {assets.map((asset) => {
            if (!isLayerVisible(asset.layerId)) return null;
            const isSel = selectedSet.has(`asset:${asset.id}`);
            const aw = asset.width * zoom;
            const ad = asset.depth * zoom;
            const rotDeg = (-asset.rotationY * 180) / Math.PI;
            const isCyl =
              asset.archetype === 'bioreactor-ss' ||
              asset.archetype === 'bioreactor-su' ||
              asset.archetype === 'vessel-tank';
            const isLineFailAsset = activeLineHighlight?.failingAssetIds.includes(asset.id) ?? false;
            const isLineOkAsset = activeLineHighlight?.compliantAssetIds.includes(asset.id) ?? false;
            const fillCol = isLineFailAsset
              ? '#DC2626'
              : isLineOkAsset
                ? '#059669'
                : asset.operationalStatus === 'maintenance-due'
                  ? '#D97706'
                  : isSel
                    ? '#7C3AED'
                    : isDarkBg
                      ? '#232330'
                      : '#F4F4F7';
            const strokeCol = isLineFailAsset
              ? '#FCA5A5'
              : isLineOkAsset
                ? '#6EE7B7'
                : asset.operationalStatus === 'maintenance-due'
                  ? '#FBBF24'
                  : isSel
                    ? '#C4B5FD'
                    : isDarkBg
                      ? '#717184'
                      : '#3F3F46';
            const labelFill =
              isLineFailAsset || isLineOkAsset || isSel || asset.operationalStatus === 'maintenance-due' || isDarkBg
                ? '#F4F4F5'
                : '#18181B';

            const isCatDimmed = categoryFilter !== 'all' && !doesAssetMatchCategory(asset, categoryFilter);

            return (
              <g
                key={asset.id}
                opacity={isCatDimmed ? 0.14 : 1}
                transform={`translate(${asset.x * zoom}, ${asset.z * zoom}) rotate(${rotDeg})`}
                className={isReadOnly ? 'cursor-pointer' : 'cursor-move'}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (!isReadOnly && activeTool === 'paint-material') {
                    paintSurfaceWithMaterial('asset', asset.id, selectedMaterialId);
                    return;
                  }
                  if (activeTool === 'select' || isReadOnly) {
                    selectEntity({ type: 'asset', id: asset.id }, e.shiftKey);
                    if (!asset.locked && !isReadOnly) setDraggingAssetId(asset.id);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (asset.category === 'IT & Data Center' || asset.rackConfig) {
                    openRackDesigner(asset.id);
                  }
                }}
              >
                {/* Clearance envelope when selected */}
                {isSel && (
                  <rect
                    x={-(aw / 2 + asset.clearanceM * zoom)}
                    y={-(ad / 2 + asset.clearanceM * zoom)}
                    width={aw + asset.clearanceM * 2 * zoom}
                    height={ad + asset.clearanceM * 2 * zoom}
                    fill="rgba(139,92,246,0.1)"
                    stroke="#8B5CF6"
                    strokeWidth={1.2}
                    strokeDasharray="4 3"
                  />
                )}
                {isCyl ? (
                  <>
                    <circle
                      cx={0}
                      cy={0}
                      r={Math.min(aw, ad) / 2}
                      fill={fillCol}
                      fillOpacity={0.94}
                      stroke={strokeCol}
                      strokeWidth={isSel ? 2.4 : 1.4}
                    />
                    <circle
                      cx={0}
                      cy={0}
                      r={Math.max(2, Math.min(aw, ad) / 2 - 4)}
                      fill="none"
                      stroke={strokeCol}
                      strokeOpacity={0.35}
                      strokeWidth={0.8}
                      pointerEvents="none"
                    />
                  </>
                ) : (
                  <rect
                    x={-aw / 2}
                    y={-ad / 2}
                    width={aw}
                    height={ad}
                    rx={3}
                    fill={fillCol}
                    fillOpacity={0.94}
                    stroke={strokeCol}
                    strokeWidth={isSel ? 2.4 : 1.4}
                  />
                )}
                {zoom >= 14 && (
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    pointerEvents="none"
                    fill={labelFill}
                    className="font-mono text-[9px] font-semibold"
                  >
                    {asset.assetId}
                  </text>
                )}
                {showFmeaIndicators && (() => {
                  const astFmea = getTargetFmeaSummary(riskIncidents, 'asset', asset.id);
                  if (astFmea.level === 'clear' || !astFmea.worstIncident) return null;
                  const fillHex =
                    astFmea.level === 'critical'
                      ? '#F43F5E'
                      : astFmea.level === 'high'
                        ? '#F59E0B'
                        : astFmea.level === 'mitigated'
                          ? '#10B981'
                          : '#8B5CF6';
                  const txtHex = astFmea.level === 'high' || astFmea.level === 'mitigated' ? '#09090B' : '#FFFFFF';
                  return (
                    <g
                      transform={`translate(-22, ${-ad / 2 - 15})`}
                      className="cursor-pointer"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        openRiskModal({ mode: 'resolve', incidentId: astFmea.worstIncident!.id });
                      }}
                    >
                      <rect x={0} y={0} width={44} height={13} rx={3} fill={fillHex} />
                      <text x={22} y={9.5} textAnchor="middle" fill={txtHex} className="font-mono text-[8px] font-bold">
                        {astFmea.shortLabel}
                      </text>
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* Cameras & FOV Wedges */}
          {isLayerVisible('layer-cameras') &&
            cameras.map((cam) => {
              const isSel = selectedSet.has(`camera:${cam.id}`);
              const dx = cam.target[0] - cam.position[0];
              const dz = cam.target[2] - cam.position[2];
              const baseAngle = Math.atan2(dz, dx);
              const halfFov = ((cam.fov * Math.PI) / 180) / 2;
              const r = Math.min(8, cam.coverageRadius * 0.65) * zoom;
              const x1 = Math.cos(baseAngle - halfFov) * r;
              const y1 = Math.sin(baseAngle - halfFov) * r;
              const x2 = Math.cos(baseAngle + halfFov) * r;
              const y2 = Math.sin(baseAngle + halfFov) * r;

              return (
                <g
                  key={cam.id}
                  transform={`translate(${cam.position[0] * zoom}, ${cam.position[2] * zoom})`}
                  className="cursor-pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    selectEntity({ type: 'camera', id: cam.id }, e.shiftKey);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    openLiveCamera(cam.id);
                  }}
                >
                  {cam.visibleCone && (
                    <path
                      d={`M 0 0 L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`}
                      fill={isSel ? '#3B82F6' : '#10B981'}
                      fillOpacity={0.16}
                      stroke={isSel ? '#3B82F6' : '#10B981'}
                      strokeWidth={1}
                    />
                  )}
                  <circle r={6} fill={isSel ? '#3B82F6' : '#10B981'} stroke="#FFFFFF" strokeWidth={1.5} />
                </g>
              );
            })}

          {/* Physical QR Scan Instant Target-Lock Highlight Beacon */}
          {qrHighlight && qrHighlight.floorId === activeFloorId && (
            <g
              transform={`translate(${qrHighlight.x * zoom}, ${qrHighlight.z * zoom})`}
              pointerEvents="none"
            >
              <circle
                r={Math.max(26, zoom * 1.45)}
                fill="rgba(16, 185, 129, 0.14)"
                stroke="#10B981"
                strokeWidth={2}
                strokeDasharray="6 4"
              />
              <circle
                r={Math.max(18, zoom * 0.95)}
                fill="none"
                stroke="#F59E0B"
                strokeWidth={2.5}
              />
              <g transform={`translate(0, ${-Math.max(32, zoom * 1.55)})`}>
                <rect
                  x={-54}
                  y={-13}
                  width={108}
                  height={22}
                  rx={6}
                  fill="#09090D"
                  stroke="#10B981"
                  strokeWidth={1.4}
                />
                <text
                  x={0}
                  y={1.5}
                  textAnchor="middle"
                  fill="#34D399"
                  className="font-mono text-[10px] font-bold"
                >
                  QR · {qrHighlight.code}
                </text>
              </g>
            </g>
          )}

          {/* Active Drawing Preview (Room / Wall) */}
          {draftStart && draftCurrent && activeTool === 'draw-room' && (
            <g>
              <rect
                x={Math.min(draftStart.x, draftCurrent.x) * zoom}
                y={Math.min(draftStart.z, draftCurrent.z) * zoom}
                width={Math.abs(draftCurrent.x - draftStart.x) * zoom}
                height={Math.abs(draftCurrent.z - draftStart.z) * zoom}
                fill="rgba(37,99,235,0.22)"
                stroke="#3B82F6"
                strokeWidth={2}
                strokeDasharray="6 4"
              />
              <text
                x={((draftStart.x + draftCurrent.x) / 2) * zoom}
                y={((draftStart.z + draftCurrent.z) / 2) * zoom}
                textAnchor="middle"
                className="font-mono text-xs fill-blue-400 font-semibold"
              >
                {formatLength(Math.abs(draftCurrent.x - draftStart.x), scene.unitSystem, 1)} ×{' '}
                {formatLength(Math.abs(draftCurrent.z - draftStart.z), scene.unitSystem, 1)}
              </text>
            </g>
          )}

          {wallChainAnchor && draftCurrent && activeTool === 'draw-wall' && (() => {
            const len = Math.hypot(draftCurrent.x - wallChainAnchor.x, draftCurrent.z - wallChainAnchor.z);
            const deg = Math.round(
              ((Math.atan2(draftCurrent.z - wallChainAnchor.z, draftCurrent.x - wallChainAnchor.x) * 180) / Math.PI +
                360) %
                360
            );
            return (
              <g pointerEvents="none">
                <line
                  x1={wallChainAnchor.x * zoom}
                  y1={wallChainAnchor.z * zoom}
                  x2={draftCurrent.x * zoom}
                  y2={draftCurrent.z * zoom}
                  stroke="#8B5CF6"
                  strokeWidth={4}
                  strokeDasharray="6 4"
                />
                {/* Active chain continuation anchor dot */}
                <circle
                  cx={wallChainAnchor.x * zoom}
                  cy={wallChainAnchor.z * zoom}
                  r={7.5}
                  fill="#10B981"
                  fillOpacity={0.25}
                  stroke="#10B981"
                  strokeWidth={1.6}
                />
                <circle
                  cx={wallChainAnchor.x * zoom}
                  cy={wallChainAnchor.z * zoom}
                  r={4}
                  fill="#10B981"
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                />
                <circle
                  cx={draftCurrent.x * zoom}
                  cy={draftCurrent.z * zoom}
                  r={4.5}
                  fill="#8B5CF6"
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                />
                {len >= 0.1 && (
                  <text
                    x={((wallChainAnchor.x + draftCurrent.x) / 2) * zoom}
                    y={((wallChainAnchor.z + draftCurrent.z) / 2) * zoom - 10}
                    textAnchor="middle"
                    className="font-mono text-xs fill-violet-400 font-semibold"
                  >
                    {formatLength(len, scene.unitSystem)} · {deg}°
                  </text>
                )}
              </g>
            );
          })()}

          {/* Flow Draft Polyline */}
          {flowDraftPoints.length > 0 && (
            <g>
              <polyline
                points={flowDraftPoints.map((p) => `${p.x * zoom},${p.z * zoom}`).join(' ')}
                fill="none"
                stroke="#14B8A6"
                strokeWidth={3}
                strokeDasharray="5 3"
              />
              {flowDraftPoints.map((p, idx) => (
                <circle key={idx} cx={p.x * zoom} cy={p.z * zoom} r={4.5} fill="#14B8A6" />
              ))}
            </g>
          )}

          {/* Multi-Point Measurement Tape & Area Polygon */}
          {measurePoints.length > 0 && (() => {
            let totalDist = 0;
            const segments: { a: { x: number; z: number }; b: { x: number; z: number }; dist: number }[] = [];
            for (let i = 1; i < measurePoints.length; i++) {
              const a = measurePoints[i - 1];
              const b = measurePoints[i];
              const d = Math.hypot(b.x - a.x, b.z - a.z);
              totalDist += d;
              segments.push({ a, b, dist: d });
            }
            let polyArea = 0;
            if (measurePoints.length >= 3) {
              for (let i = 0; i < measurePoints.length; i++) {
                const a = measurePoints[i];
                const b = measurePoints[(i + 1) % measurePoints.length];
                polyArea += a.x * b.z - b.x * a.z;
              }
              polyArea = Math.abs(polyArea) / 2;
            }
            const lastPt = measurePoints[measurePoints.length - 1];
            const liveSegDist =
              activeTool === 'measure'
                ? Math.hypot(cursorCoords.x - lastPt.x, cursorCoords.z - lastPt.z)
                : 0;
            return (
              <g pointerEvents="none">
                {measurePoints.length >= 3 && (
                  <polygon
                    points={measurePoints.map((p) => `${p.x * zoom},${p.z * zoom}`).join(' ')}
                    fill="#F59E0B"
                    fillOpacity={0.14}
                    stroke="#F59E0B"
                    strokeWidth={1.2}
                    strokeDasharray="3 3"
                  />
                )}
                {segments.map((seg, idx) => (
                  <g key={idx}>
                    <line
                      x1={seg.a.x * zoom}
                      y1={seg.a.z * zoom}
                      x2={seg.b.x * zoom}
                      y2={seg.b.z * zoom}
                      stroke="#F59E0B"
                      strokeWidth={2.5}
                    />
                    <text
                      x={((seg.a.x + seg.b.x) / 2) * zoom}
                      y={((seg.a.z + seg.b.z) / 2) * zoom - 7}
                      textAnchor="middle"
                      className="font-mono text-[11px] fill-amber-400 font-semibold"
                    >
                      {formatLength(seg.dist, scene.unitSystem)}
                    </text>
                  </g>
                ))}
                {/* Live cursor preview segment while Measure tool is active */}
                {activeTool === 'measure' && liveSegDist > 0.05 && (
                  <g>
                    <line
                      x1={lastPt.x * zoom}
                      y1={lastPt.z * zoom}
                      x2={cursorCoords.x * zoom}
                      y2={cursorCoords.z * zoom}
                      stroke="#F59E0B"
                      strokeWidth={1.8}
                      strokeDasharray="5 4"
                      strokeOpacity={0.85}
                    />
                    <text
                      x={((lastPt.x + cursorCoords.x) / 2) * zoom}
                      y={((lastPt.z + cursorCoords.z) / 2) * zoom - 7}
                      textAnchor="middle"
                      className="font-mono text-[10.5px] fill-amber-300 font-semibold"
                    >
                      {formatLength(liveSegDist, scene.unitSystem)}
                    </text>
                  </g>
                )}
                {measurePoints.map((p, idx) => (
                  <circle key={idx} cx={p.x * zoom} cy={p.z * zoom} r={5} fill="#F59E0B" stroke="#FFFFFF" strokeWidth={1.5} />
                ))}
                {measurePoints.length >= 2 && (
                  <g transform={`translate(${lastPt.x * zoom + 10}, ${lastPt.z * zoom - 12})`}>
                    <rect
                      x={0}
                      y={0}
                      width={polyArea > 0.05 ? 164 : 112}
                      height={22}
                      rx={5}
                      fill="#14141B"
                      fillOpacity={0.94}
                      stroke="#F59E0B"
                      strokeWidth={1}
                    />
                    <text x={8} y={14.5} className="font-mono text-[10.5px] fill-amber-300 font-semibold">
                      Σ {formatLength(totalDist, scene.unitSystem)}
                      {polyArea > 0.05 ? ` · ${formatArea(polyArea, scene.unitSystem)}` : ''}
                    </text>
                  </g>
                )}
              </g>
            );
          })()}

          {/* Reference Calibration Points */}
          {calibrationPoints.length > 0 && (
            <g>
              {calibrationPoints.map((p, idx) => (
                <circle key={idx} cx={p.x * zoom} cy={p.z * zoom} r={6} fill="#6366F1" stroke="#FFFFFF" strokeWidth={2} />
              ))}
              {calibrationPoints.length === 2 && (
                <line
                  x1={calibrationPoints[0].x * zoom}
                  y1={calibrationPoints[0].z * zoom}
                  x2={calibrationPoints[1].x * zoom}
                  y2={calibrationPoints[1].z * zoom}
                  stroke="#6366F1"
                  strokeWidth={2.5}
                />
              )}
            </g>
          )}

          {/* AI Copilot Ghost Preview */}
          {pendingAIActions.map((act, idx) =>
            act.type === 'create_room' ? (
              <rect
                key={idx}
                x={(act.x ?? 4) * zoom}
                y={(act.z ?? 4) * zoom}
                width={(act.width ?? 10) * zoom}
                height={(act.depth ?? 8) * zoom}
                fill="rgba(56,189,248,0.22)"
                stroke="#38BDF8"
                strokeWidth={2}
                strokeDasharray="6 3"
              />
            ) : null
          )}

          {/* Active IT Network Port & Cable End-to-End Trace Overlay */}
          {activeNetworkTrace && (() => {
            const hops = activeNetworkTrace.hops.filter(
              (h) => !h.floorId || h.floorId === activeFloorId
            );
            const displayHops = hops.length > 0 ? hops : activeNetworkTrace.hops;
            if (displayHops.length === 0) return null;
            const traceColor =
              activeNetworkTrace.status === 'error'
                ? '#F43F5E'
                : activeNetworkTrace.status === 'warning'
                  ? '#F59E0B'
                  : '#06B6D4';
            const pathD = displayHops
              .map((h, i) => `${i === 0 ? 'M' : 'L'} ${h.x * zoom} ${h.z * zoom}`)
              .join(' ');
            return (
              <g className="pointer-events-none">
                {displayHops.length >= 2 && (
                  <>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={traceColor}
                      strokeOpacity={0.28}
                      strokeWidth={11}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={pathD}
                      fill="none"
                      stroke={traceColor}
                      strokeWidth={3.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={pathD}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeOpacity={0.9}
                      strokeWidth={2}
                      strokeDasharray="7 18"
                      strokeLinecap="round"
                      className="animate-flow-dash"
                    />
                  </>
                )}
                {displayHops.map((h, idx) => {
                  const hx = h.x * zoom;
                  const hz = h.z * zoom;
                  return (
                    <g key={h.id} transform={`translate(${hx}, ${hz})`}>
                      <circle r={13} fill={traceColor} fillOpacity={0.22} />
                      <circle r={8} fill={traceColor} stroke="#FFFFFF" strokeWidth={2} />
                      <text
                        y={3.5}
                        textAnchor="middle"
                        className="fill-white text-[9.5px] font-mono font-bold"
                      >
                        {idx + 1}
                      </text>
                      <g transform="translate(12, -16)">
                        <rect
                          x={0}
                          y={-11}
                          width={Math.max(88, h.label.length * 6.2 + 12)}
                          height={20}
                          rx={5}
                          fill="#0D111C"
                          fillOpacity={0.92}
                          stroke={traceColor}
                          strokeWidth={1}
                        />
                        <text
                          x={6}
                          y={2.5}
                          className="fill-white text-[9.5px] font-mono font-semibold"
                        >
                          {h.label}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </g>
            );
          })()}

          {/* Live Snap-to-Grid & Snap-to-Wall Placement Ghost for place-object tool */}
          {!isReadOnly && activeTool === 'place-object' && placePreview && (() => {
            const allObjs = [...OBJECT_LIBRARY, ...scene.customObjects];
            const tpl = allObjs.find((o) => o.id === selectedObjectTemplateId) ?? allObjs[0];
            const wPx = (tpl?.width ?? 1.2) * zoom;
            const dPx = (tpl?.depth ?? 1.0) * zoom;
            const cx = placePreview.x * zoom;
            const cz = placePreview.z * zoom;
            const deg = (-placePreview.rotationY * 180) / Math.PI;
            const wallSnap = placePreview.snappedWall;
            return (
              <g className="pointer-events-none">
                {wallSnap && (
                  <>
                    <line
                      x1={wallSnap.ax * zoom}
                      y1={wallSnap.az * zoom}
                      x2={wallSnap.bx * zoom}
                      y2={wallSnap.bz * zoom}
                      stroke="#22D3EE"
                      strokeWidth={3.5}
                      strokeLinecap="round"
                      strokeOpacity={0.85}
                    />
                    <line
                      x1={wallSnap.projX * zoom}
                      y1={wallSnap.projZ * zoom}
                      x2={cx}
                      y2={cz}
                      stroke="#22D3EE"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                    <circle cx={wallSnap.projX * zoom} cy={wallSnap.projZ * zoom} r={4} fill="#22D3EE" />
                  </>
                )}
                <g transform={`translate(${cx}, ${cz}) rotate(${deg})`}>
                  <rect
                    x={-wPx / 2}
                    y={-dPx / 2}
                    width={wPx}
                    height={dPx}
                    rx={4}
                    fill={wallSnap ? '#06B6D4' : '#8B5CF6'}
                    fillOpacity={0.28}
                    stroke={wallSnap ? '#22D3EE' : '#A78BFA'}
                    strokeWidth={2}
                    strokeDasharray="5 3"
                  />
                  {/* Front orientation indicator */}
                  <line
                    x1={0}
                    y1={dPx / 2}
                    x2={0}
                    y2={dPx / 2 + 10}
                    stroke={wallSnap ? '#22D3EE' : '#A78BFA'}
                    strokeWidth={2}
                  />
                </g>
                <g transform={`translate(${cx + 12}, ${cz - dPx / 2 - 14})`}>
                  <rect
                    x={0}
                    y={-11}
                    width={wallSnap ? 148 : 114}
                    height={19}
                    rx={5}
                    fill="#0D111C"
                    fillOpacity={0.92}
                    stroke={wallSnap ? '#22D3EE' : '#8B5CF6'}
                    strokeWidth={1}
                  />
                  <text x={6} y={2} className="fill-white text-[9.5px] font-mono font-semibold">
                    {wallSnap
                      ? `WALL SNAP · ${placePreview.x},${placePreview.z}`
                      : placePreview.snappedGrid
                        ? `GRID SNAP · ${placePreview.x},${placePreview.z}`
                        : `${placePreview.x},${placePreview.z}`}
                  </text>
                </g>
              </g>
            );
          })()}
        </g>
      </svg>

      {/* Floating Action Banner whenever an Imported SVG / Blueprint exists on this floor */}
      {references.length > 0 && !activeLineHighlight && (
        <div
          className={`absolute top-3 right-3 z-20 flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-2xl border shadow-2xl text-xs ${
            isDarkBg
              ? 'bg-[#14141C] border-amber-500/45 text-zinc-100'
              : 'bg-white border-amber-400/70 text-zinc-900'
          }`}
        >
          <span className="text-[11px] font-mono text-zinc-400 truncate max-w-[160px]" title={references[0].name}>
            {references[0].name}
          </span>
          <button
            type="button"
            onClick={() => openCadOcrForReference(references[0].id)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[11px] transition-colors cursor-pointer shrink-0"
          >
            <Box className="w-3.5 h-3.5" />
            {references[0].fileType.includes('svg') || references[0].name.toLowerCase().endsWith('.svg')
              ? 'Turn SVG into 3D Model'
              : 'Convert Plan to 3D Model'}
          </button>
        </div>
      )}

      {activeTool === 'draw-flow' && (
        <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-md bg-teal-600 text-white text-xs font-medium shadow-sm">
          <span>Click floor waypoints to trace {selectedFlowType} route ({flowDraftPoints.length} pts)</span>
          {flowDraftPoints.length >= 2 && (
            <button
              onClick={finishFlowDraft}
              className="px-2 py-0.5 rounded bg-white text-teal-700 font-semibold hover:bg-teal-50"
            >
              Finish Route
            </button>
          )}
          <button
            onClick={() => {
              setFlowDraftPoints([]);
              setActiveTool('select');
            }}
            className="px-1.5 py-0.5 rounded bg-teal-700 hover:bg-teal-800"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Flow Modify Mode Banner */}
      {(editingFlowId || (selected.length === 1 && selected[0].type === 'flow')) && activeTool === 'select' && (
        <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#15151E] border border-violet-500/60 text-zinc-100 text-xs shadow-xl">
          <Waypoints className="w-3.5 h-3.5 text-violet-400" />
          <span>Flow Node Modify Mode: Drag nodes · Click + to insert · Double-click node to remove</span>
          {editingFlowId && (
            <button
              onClick={() => setEditingFlowId(null)}
              className="px-2 py-0.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold"
            >
              Done
            </button>
          )}
        </div>
      )}

      {activeTool !== 'select' && activeTool !== 'draw-flow' && (
        <div className="absolute top-3 left-3 px-3 py-1.5 rounded-md bg-violet-600 text-white text-xs font-medium shadow-sm pointer-events-none">
          {activeTool === 'draw-room' && 'Click and drag on the 2D floor plan to draw a room with automatic walls'}
          {activeTool === 'draw-wall' &&
            (wallChainAnchor
              ? 'Wall chain active — click next point to continue · Press Esc or Right-Click to stop'
              : 'Click a starting dot to draw continuous walls · Press Esc to stop')}
          {activeTool === 'place-door' && 'Click any wall line to insert a door opening'}
          {activeTool === 'place-window' && 'Click any wall line to insert an observation window'}
          {activeTool === 'place-object' && 'Click floor to place equipment — auto Snap-to-Grid & Snap-to-Wall active'}
          {activeTool === 'paint-material' && 'Click any room, wall, or equipment to apply the active material'}
          {activeTool === 'measure' && 'Click two points to measure exact real-world distance'}
          {activeTool === 'place-camera' && 'Click to place a camera with field-of-view cone'}
          {activeTool === 'calibrate-ref' && `Calibration: click 2 known points on the reference blueprint (${calibrationPoints.length}/2)`}
        </div>
      )}

      {activeNetworkTrace && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-wrap sm:flex-nowrap items-center gap-2 px-3.5 py-2 rounded-2xl border border-cyan-500/60 bg-[#0D1320]/95 text-cyan-50 shadow-2xl text-xs max-w-[94%]"
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
              onClick={() => startNetworkTrace(activeNetworkTrace, '3d')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold cursor-pointer"
            >
              <Box className="w-3 h-3" />
              3D Trace
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

      {activeLineHighlight && !activeNetworkTrace && (
        <div
          className={`absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-3.5 py-2 rounded-2xl border shadow-2xl text-xs max-w-[92%] ${
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
          <div className="min-w-0">
            <span className="font-extrabold uppercase tracking-wide mr-1.5">
              {activeLineHighlight.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}
            </span>
            <span className="font-semibold truncate">{activeLineHighlight.lineName}</span>
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

      {/* UNIFIED NON-OVERLAPPING 2D BOTTOM-CENTER HUD STACK (Selection Toolbox + Exclusive Accordion Drawer + Compact Dock Rail) */}
      {/* Physical QR Scan Instant Highlight HUD Banner in 2D */}
      {qrHighlight && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-3 left-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-[#111116]/95 border border-emerald-500/60 shadow-xl text-[11px] text-zinc-100 max-w-[calc(100%-24px)]"
        >
          <span className="font-mono font-bold text-emerald-400 shrink-0">QR LOCK</span>
          <span className="text-zinc-500">·</span>
          <span className="font-mono font-semibold text-amber-400 shrink-0">{qrHighlight.code}</span>
          <span className="truncate text-zinc-200 max-w-[160px] sm:max-w-[240px]">{qrHighlight.label}</span>
          <button
            type="button"
            onClick={() => openEntityInfo({ type: qrHighlight.entityType, id: qrHighlight.entityId })}
            className="px-2 py-0.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold shrink-0 cursor-pointer"
          >
            Info
          </button>
          <button
            type="button"
            onClick={() => setViewMode('3d-perspective')}
            className="px-2 py-0.5 rounded-lg border border-zinc-700 hover:border-violet-400 text-zinc-200 font-medium shrink-0 cursor-pointer"
          >
            3D View
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

      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 w-[min(96%,640px)] pointer-events-none"
      >
        {/* Inline Quick Editor for Selected Door / Window */}
        <OpeningQuickBar isDark={isDarkBg} />

        {/* Selected Entity Toolbox (cleanly stacked ABOVE the dock — zero overlap) */}
        {selected.length > 0 && (() => {
          const primary = selected[0];
          const selAsset = primary.type === 'asset' ? scene.assets.find((a) => a.id === primary.id) : null;
          const selRoom = primary.type === 'room' ? scene.rooms.find((r) => r.id === primary.id) : null;
          const selCam = primary.type === 'camera' ? scene.cameras.find((c) => c.id === primary.id) : null;
          if (!selAsset && !selRoom && !selCam) return null;

          const code = selAsset ? selAsset.assetId : selRoom ? selRoom.code : 'CAM';
          const label = selAsset ? selAsset.name : selRoom ? selRoom.name : selCam!.name;

          const handleGoTo3D = () => {
            setViewMode('3d-perspective');
            const bldg = activeFloor?.buildingId
              ? scene.buildings?.find((b) => b.id === activeFloor.buildingId)
              : null;
            const ox = bldg?.originX ?? 0;
            const oz = bldg?.originZ ?? 0;
            const elev = activeFloor?.elevation ?? 0;
            if (selAsset) {
              flyToCamera(
                [ox + selAsset.x + 4.4, elev + Math.max(3.2, selAsset.height + 1.8), oz + selAsset.z + 4.4],
                [ox + selAsset.x, elev + selAsset.height * 0.5, oz + selAsset.z],
                42
              );
            } else if (selRoom) {
              const cx = ox + selRoom.x + selRoom.width / 2;
              const cz = oz + selRoom.z + selRoom.depth / 2;
              flyToCamera(
                [cx + Math.max(5.5, selRoom.width * 0.65), elev + Math.max(6.2, selRoom.width * 0.55), cz + Math.max(6.5, selRoom.depth * 0.85)],
                [cx, elev + 1.2, cz],
                44
              );
            } else if (selCam) {
              focusEntity({ type: 'camera', id: selCam.id });
            }
          };

          return (
            <div
              className={`pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 px-3 py-1.5 rounded-2xl border shadow-2xl text-xs max-w-full ${
                isDarkBg
                  ? 'bg-[#14141C] border-zinc-700 text-zinc-100'
                  : 'bg-white border-zinc-200 text-zinc-900'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0 pr-1.5 border-r border-zinc-700/40">
                <span className="font-mono text-[10.5px] font-bold text-amber-500 shrink-0">{code}</span>
                <span className="font-semibold truncate max-w-[130px] sm:max-w-[190px]">{label}</span>
              </div>
              <button
                type="button"
                onClick={handleGoTo3D}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer"
              >
                <Box className="w-3.5 h-3.5" />
                Go to 3D
              </button>
              {(selAsset || selRoom) && (
                <button
                  type="button"
                  onClick={() =>
                    openEntityInfo(selAsset ? { type: 'asset', id: selAsset.id } : { type: 'room', id: selRoom!.id })
                  }
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                    isDarkBg
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-violet-500'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-violet-500'
                  }`}
                >
                  <Info className="w-3.5 h-3.5 text-violet-400" />
                  Info
                </button>
              )}
              {selCam && (
                <button
                  type="button"
                  onClick={() => openLiveCamera(selCam.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-amber-400" />
                  Live Feed
                </button>
              )}
              {selRoom && (
                <button
                  type="button"
                  onClick={() => openEntityInfo({ type: 'room', id: selRoom.id }, { autoEligibility: true })}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-[11px] font-bold whitespace-nowrap cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Eligibility
                </button>
              )}
              <button
                type="button"
                onClick={clearSelection}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })()}

        {/* Exclusive Single-Subject Popover Drawer (Flows | HVAC | FMEA) */}
        {activeDockSubject === 'flows' && isLayerVisible('layer-flows') && (
          <div
            className={`pointer-events-auto w-full max-w-md rounded-2xl border shadow-2xl p-2.5 text-[11px] space-y-2 ${
              isDarkBg ? 'bg-[#14141C] border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="font-semibold flex items-center gap-1.5">
                <Waypoints className="w-3.5 h-3.5 text-violet-500" />
                Floor Flows ({flows.length})
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowFlows(!showFlows)}
                  className={`px-2 py-0.5 rounded-lg flex items-center gap-1 text-[10px] font-semibold cursor-pointer ${
                    showFlows ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/35' : 'bg-zinc-800 text-zinc-400'
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
                  className="p-0.5 text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {flows.map((fl) => {
                const isIso = isolatedFlowId === fl.id;
                const isHidden = !showFlows || hiddenFlowIds.includes(fl.id) || (isolatedFlowId !== null && !isIso);
                const seq = computeFlowRoomSequence(fl, scene.rooms);
                return (
                  <div
                    key={fl.id}
                    className={`flex items-center justify-between gap-1.5 px-2 py-1 rounded-xl border ${
                      isIso
                        ? 'bg-violet-500/15 border-violet-500/60'
                        : isHidden
                          ? 'opacity-50 border-zinc-700/40'
                          : isDarkBg
                            ? 'bg-[#1A1A24] border-zinc-800'
                            : 'bg-zinc-50 border-zinc-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveFlowInfoId(fl.id)}
                      className="flex items-center gap-1.5 truncate flex-1 text-left cursor-pointer"
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: fl.color }} />
                      <span className="truncate font-medium">{fl.name}</span>
                      <span className="font-mono text-[9.5px] text-zinc-500 shrink-0">({seq.steps.length}rm)</span>
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => isolateFlow(fl.id)}
                        className={`p-1 rounded-lg cursor-pointer ${isIso ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-amber-400'}`}
                      >
                        <Focus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFlowVisibility(fl.id)}
                        className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
                      >
                        {hiddenFlowIds.includes(fl.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeDockSubject === 'hvac' && (
          <div
            className={`pointer-events-auto w-full max-w-md rounded-2xl border shadow-2xl p-2.5 text-[11px] space-y-2 ${
              isDarkBg ? 'bg-[#14141C] border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5 text-cyan-400" />
                2D HVAC Ducts &amp; Room Air Handling
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowHvacOverlay(!showHvacOverlay)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold cursor-pointer ${
                    showHvacOverlay ? 'bg-cyan-500 text-zinc-950' : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  Overlay: {showHvacOverlay ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDockSubject(null)}
                  className="p-0.5 text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setHvacAhuFilter('all')}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold cursor-pointer ${
                  hvacAhuFilter === 'all' ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                All
              </button>
              {AHU_CATALOG.map((ahu) => (
                <button
                  key={ahu.id}
                  type="button"
                  onClick={() => {
                    setHvacAhuFilter(hvacAhuFilter === ahu.id ? 'all' : ahu.id);
                    if (!showHvacOverlay) setShowHvacOverlay(true);
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold whitespace-nowrap cursor-pointer ${
                    hvacAhuFilter === ahu.id ? 'bg-cyan-500 text-zinc-950' : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {ahu.id}
                </button>
              ))}
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {rooms
                .filter((r) => hvacAhuFilter === 'all' || getEffectiveRoomHvac(r).ahuId === hvacAhuFilter)
                .map((rm) => {
                  const cfg = getEffectiveRoomHvac(rm);
                  return (
                    <div
                      key={rm.id}
                      className={`flex items-center justify-between gap-2 px-2 py-1 rounded-xl border ${
                        isDarkBg ? 'bg-[#1A1A24] border-zinc-800' : 'bg-zinc-50 border-zinc-200'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold truncate">
                          <span className="font-mono text-cyan-400 mr-1.5">{rm.code}</span>
                          {rm.name}
                        </div>
                        <div className="text-[9.5px] font-mono tabular-nums text-zinc-400">
                          {cfg.ahuId} · {cfg.hepaClass} · {cfg.airChangesPerHour} ACH · {computeRoomSupplyM3h(rm).toLocaleString()} m³/h
                        </div>
                      </div>
                      {!isReadOnly && (
                        <select
                          value={cfg.ahuId}
                          onChange={(e) => updateRoomHvac(rm.id, { ahuId: e.target.value })}
                          className="bg-zinc-900 border border-zinc-700 text-zinc-200 rounded-lg px-1.5 py-0.5 text-[10px] font-mono"
                        >
                          {AHU_CATALOG.map((a) => (
                            <option key={a.id} value={a.id}>{a.id}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {activeDockSubject === 'fmea' && (
          <div
            className={`pointer-events-auto w-full max-w-md rounded-2xl border shadow-2xl p-2.5 text-[11px] space-y-2 ${
              isDarkBg ? 'bg-[#14141C] border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                2D FMEA Risk Indicators
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowFmeaIndicators(!showFmeaIndicators)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold cursor-pointer ${
                    showFmeaIndicators ? 'bg-rose-500/20 text-rose-300 border border-rose-500/45' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  Badges: {showFmeaIndicators ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => openRiskModal({ mode: 'create' })}
                  className="px-2 py-0.5 rounded-lg bg-violet-600 text-white text-[10px] font-semibold cursor-pointer"
                >
                  + Log FMEA
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDockSubject(null)}
                  className="p-0.5 text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {riskIncidents
                .filter((i) => i.status === 'open' || i.status === 'investigating')
                .sort((a, b) => b.rpn - a.rpn)
                .slice(0, 5)
                .map((inc) => (
                  <button
                    key={inc.id}
                    type="button"
                    onClick={() => openRiskModal({ mode: 'resolve', incidentId: inc.id })}
                    className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-xl border text-left cursor-pointer ${
                      isDarkBg ? 'bg-[#1A1A24] border-zinc-800 hover:border-rose-500/60' : 'bg-zinc-50 border-zinc-200'
                    }`}
                  >
                    <span className="truncate font-medium">
                      <span className="font-mono text-violet-400 mr-1.5">{inc.targetCode}</span>
                      {inc.title}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono text-[9.5px] font-bold shrink-0 ${
                        inc.rpn >= 200 ? 'bg-rose-500 text-white' : inc.rpn >= 100 ? 'bg-amber-400 text-zinc-950' : 'bg-violet-500 text-white'
                      }`}
                    >
                      RPN {inc.rpn}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Unified Single-Row 2D Bottom Dock (Zero Overlap on Mobile & Desktop) */}
        <div
          className={`pointer-events-auto max-w-full overflow-x-auto no-scrollbar flex items-center gap-1 rounded-2xl border px-1.5 py-1 text-[11px] shadow-xl transition-colors ${
            isDarkBg ? 'bg-[#14141C] border-zinc-800 text-zinc-200' : 'bg-white border-zinc-200 text-zinc-800'
          }`}
        >
          {isLayerVisible('layer-flows') && flows.length > 0 && (
            <button
              type="button"
              onClick={() => toggleDockSubject('flows')}
              className={`flex items-center gap-1 px-2 py-1 rounded-xl font-semibold whitespace-nowrap cursor-pointer ${
                activeDockSubject === 'flows'
                  ? 'bg-violet-600 text-white'
                  : isDarkBg
                    ? 'hover:bg-zinc-800 text-zinc-300'
                    : 'hover:bg-zinc-100 text-zinc-700'
              }`}
            >
              <Waypoints className="w-3.5 h-3.5 text-violet-400" />
              <span>Flows ({flows.length})</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleDockSubject('hvac')}
            className={`flex items-center gap-1 px-2 py-1 rounded-xl font-semibold whitespace-nowrap cursor-pointer ${
              activeDockSubject === 'hvac'
                ? 'bg-cyan-500 text-zinc-950'
                : showHvacOverlay
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                  : isDarkBg
                    ? 'hover:bg-zinc-800 text-zinc-300'
                    : 'hover:bg-zinc-100 text-zinc-700'
            }`}
          >
            <Wind className="w-3.5 h-3.5 text-cyan-400" />
            <span>HVAC</span>
          </button>
          <button
            type="button"
            onClick={() => toggleDockSubject('fmea')}
            className={`flex items-center gap-1 px-2 py-1 rounded-xl font-semibold whitespace-nowrap cursor-pointer ${
              activeDockSubject === 'fmea'
                ? 'bg-rose-500 text-white'
                : isDarkBg
                  ? 'hover:bg-zinc-800 text-zinc-300'
                  : 'hover:bg-zinc-100 text-zinc-700'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>FMEA</span>
          </button>

          <span className={`w-px h-4 shrink-0 ${isDarkBg ? 'bg-zinc-800' : 'bg-zinc-200'}`} />

          {isReadOnly && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-amber-500/15 text-amber-400 text-[10px] font-semibold shrink-0">
              <Lock className="w-3 h-3" />
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsHandMode((h) => !h)}
            className={`flex items-center gap-1 px-2 py-1 rounded-xl font-semibold whitespace-nowrap cursor-pointer ${
              isHandMode || spacePressed
                ? 'bg-violet-600 text-white'
                : isDarkBg
                  ? 'hover:bg-zinc-800 text-zinc-300'
                  : 'hover:bg-zinc-100 text-zinc-700'
            }`}
          >
            <Hand className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pan</span>
          </button>
          <button
            type="button"
            onClick={toggleCanvasBackdrop}
            className={`p-1 rounded-xl cursor-pointer shrink-0 ${
              isDarkBg ? 'hover:bg-zinc-800 text-amber-400' : 'hover:bg-zinc-100 text-violet-600'
            }`}
            title={isDarkBg ? 'Light Paper' : 'Dark Charcoal'}
          >
            {isDarkBg ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => {
              const rect = svgRef.current?.getBoundingClientRect();
              zoomAtClientPoint(0.85, rect ? rect.left + rect.width / 2 : 0, rect ? rect.top + rect.height / 2 : 0);
            }}
            className={`px-1.5 py-0.5 rounded-lg font-mono cursor-pointer shrink-0 ${isDarkBg ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            -
          </button>
          <span className="font-mono tabular-nums text-[10.5px] w-9 text-center shrink-0">
            {Math.round((zoom / 22) * 100)}%
          </span>
          <button
            type="button"
            onClick={() => {
              const rect = svgRef.current?.getBoundingClientRect();
              zoomAtClientPoint(1.18, rect ? rect.left + rect.width / 2 : 0, rect ? rect.top + rect.height / 2 : 0);
            }}
            className={`px-1.5 py-0.5 rounded-lg font-mono cursor-pointer shrink-0 ${isDarkBg ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            +
          </button>
          <button
            type="button"
            onClick={fitFloorToView}
            className={`px-2 py-0.5 rounded-lg font-medium cursor-pointer shrink-0 ${isDarkBg ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            Fit
          </button>
        </div>
      </div>

      {/* RIGHT-CLICK OPENING CONTEXT MENU (Edit Type, Size, Sill, Position Along Wall, Flip Swing, Delete) */}
      {openingContextMenu && (() => {
        const ctxOp = scene.openings.find((o) => o.id === openingContextMenu.openingId);
        if (!ctxOp) return null;
        const hostWall = scene.walls.find((w) => w.id === ctxOp.wallId);
        const wallLen = hostWall
          ? Math.hypot(hostWall.x2 - hostWall.x1, hostWall.z2 - hostWall.z1)
          : 4;
        const doorPresets = OPENING_PRESETS.filter((p) => p.kind === 'door');
        const windowPresets = OPENING_PRESETS.filter((p) => p.kind === 'window');

        return (
          <div
            style={{ left: openingContextMenu.x, top: openingContextMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            className={`absolute z-50 w-[272px] rounded-xl border shadow-2xl p-3 space-y-2.5 text-[11px] ${
              isDarkBg
                ? 'bg-[#14141D] border-violet-500/50 text-zinc-100'
                : 'bg-white border-violet-300 text-zinc-900'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-1.5 min-w-0">
                {ctxOp.kind === 'window' ? (
                  <Grid3X3 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                ) : (
                  <DoorOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold truncate">{ctxOp.name}</div>
                  <div className="text-[9.5px] font-mono text-zinc-400 tabular-nums">
                    Wall {wallLen.toFixed(1)}m · {ctxOp.width.toFixed(2)}×{ctxOp.height.toFixed(2)}m
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpeningContextMenu(null)}
                aria-label="Close menu"
                className="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {!isReadOnly ? (
              <>
                {/* Type Selector */}
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Opening Type
                  </span>
                  <select
                    value={ctxOp.subtype}
                    onChange={(e) => {
                      const nextPreset = OPENING_PRESETS.find((p) => p.subtype === e.target.value);
                      if (!nextPreset) return;
                      updateOpening(ctxOp.id, {
                        kind: nextPreset.kind,
                        subtype: nextPreset.subtype,
                        name: nextPreset.name,
                        width: nextPreset.width,
                        height: nextPreset.height,
                        sillHeight: nextPreset.sillHeight,
                        frameColor: nextPreset.frameColor,
                        accessControl: nextPreset.accessControl,
                      });
                    }}
                    className={`w-full h-7 px-2 rounded-lg border text-[11px] font-medium focus:outline-none focus:border-violet-500 ${
                      isDarkBg
                        ? 'bg-[#1B1B26] border-zinc-700 text-zinc-100'
                        : 'bg-zinc-50 border-zinc-300 text-zinc-900'
                    }`}
                  >
                    <optgroup label="Doors">
                      {doorPresets.map((p) => (
                        <option key={p.subtype} value={p.subtype}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Windows">
                      {windowPresets.map((p) => (
                        <option key={p.subtype} value={p.subtype}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>

                {/* Dimensions: Width, Height, Sill */}
                <div className={`grid gap-1.5 ${ctxOp.kind === 'window' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-zinc-400">Width (m)</span>
                    <input
                      type="number"
                      min={0.6}
                      max={Math.max(0.8, Number((wallLen - 0.3).toFixed(2)))}
                      step={0.1}
                      value={ctxOp.width}
                      onChange={(e) =>
                        updateOpening(ctxOp.id, { width: Math.max(0.6, Number(e.target.value) || 0.9) })
                      }
                      className={`w-full h-7 px-1.5 rounded-lg border font-mono tabular-nums text-[11px] ${
                        isDarkBg
                          ? 'bg-[#1B1B26] border-zinc-700 text-zinc-100'
                          : 'bg-zinc-50 border-zinc-300 text-zinc-900'
                      }`}
                    />
                  </label>
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-zinc-400">Height (m)</span>
                    <input
                      type="number"
                      min={0.5}
                      max={hostWall ? Number((hostWall.height - 0.1).toFixed(2)) : 3.2}
                      step={0.1}
                      value={ctxOp.height}
                      onChange={(e) =>
                        updateOpening(ctxOp.id, { height: Math.max(0.5, Number(e.target.value) || 1.2) })
                      }
                      className={`w-full h-7 px-1.5 rounded-lg border font-mono tabular-nums text-[11px] ${
                        isDarkBg
                          ? 'bg-[#1B1B26] border-zinc-700 text-zinc-100'
                          : 'bg-zinc-50 border-zinc-300 text-zinc-900'
                      }`}
                    />
                  </label>
                  {ctxOp.kind === 'window' && (
                    <label className="block space-y-0.5">
                      <span className="text-[10px] text-zinc-400">Sill (m)</span>
                      <input
                        type="number"
                        min={0}
                        max={hostWall ? Number(Math.max(0, hostWall.height - 0.7).toFixed(2)) : 2.2}
                        step={0.1}
                        value={ctxOp.sillHeight}
                        onChange={(e) =>
                          updateOpening(ctxOp.id, { sillHeight: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className={`w-full h-7 px-1.5 rounded-lg border font-mono tabular-nums text-[11px] ${
                          isDarkBg
                            ? 'bg-[#1B1B26] border-zinc-700 text-zinc-100'
                            : 'bg-zinc-50 border-zinc-300 text-zinc-900'
                        }`}
                      />
                    </label>
                  )}
                </div>

                {/* Position Along Wall */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400">
                    <span>Position Along Wall</span>
                    <span className="font-mono tabular-nums font-semibold text-violet-400">
                      {Math.round(ctxOp.offsetRatio * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={0.95}
                    step={0.01}
                    value={ctxOp.offsetRatio}
                    onChange={(e) => updateOpening(ctxOp.id, { offsetRatio: Number(e.target.value) })}
                    className="w-full accent-violet-500 cursor-pointer"
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => updateOpening(ctxOp.id, { offsetRatio: 0.5 })}
                      className={`flex-1 h-7 px-2 rounded-lg border text-[10.5px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                        isDarkBg
                          ? 'bg-[#1B1B26] border-zinc-700 hover:border-violet-500 text-zinc-200'
                          : 'bg-zinc-50 border-zinc-300 hover:border-violet-500 text-zinc-800'
                      }`}
                    >
                      <AlignHorizontalJustifyCenter className="w-3 h-3" /> Center
                    </button>
                    {ctxOp.kind === 'door' && (
                      <button
                        type="button"
                        onClick={() =>
                          updateOpening(ctxOp.id, {
                            swingDirection: ctxOp.swingDirection === 'left' ? 'right' : 'left',
                          })
                        }
                        className={`flex-1 h-7 px-2 rounded-lg border text-[10.5px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                          isDarkBg
                            ? 'bg-[#1B1B26] border-zinc-700 hover:border-violet-500 text-zinc-200'
                            : 'bg-zinc-50 border-zinc-300 hover:border-violet-500 text-zinc-800'
                        }`}
                      >
                        <FlipHorizontal2 className="w-3 h-3" /> Flip Swing
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-[10.5px] text-amber-400 flex items-center gap-1.5 py-1">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                Switch to Design Mode to edit or delete openings.
              </div>
            )}

            {/* Footer: Full Properties + Delete */}
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  selectEntity({ type: 'opening', id: ctxOp.id });
                  setRightTab('properties');
                  setRightPanelOpen(true);
                  setOpeningContextMenu(null);
                }}
                className={`flex-1 h-7 px-2 rounded-lg border text-[10.5px] font-semibold flex items-center justify-center gap-1 cursor-pointer ${
                  isDarkBg
                    ? 'bg-violet-600/20 border-violet-500/50 text-violet-300 hover:bg-violet-600 hover:text-white'
                    : 'bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-600 hover:text-white'
                }`}
              >
                <SlidersHorizontal className="w-3 h-3" /> Properties
              </button>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => {
                    selectEntity({ type: 'opening', id: ctxOp.id });
                    deleteSelected();
                    setOpeningContextMenu(null);
                  }}
                  className="h-7 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10.5px] font-semibold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
