import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Moon, Pause, Play, ShieldAlert, Sun, Waypoints, X } from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import {
  formatArea,
  formatLength,
  getRoomColorForAnalytics,
  snapValue,
} from '../utils/spatial';

export const Viewport2D: React.FC = () => {
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
  const showFlowLegend = useTwinStore((s) => s.showFlowLegend);
  const editingFlowId = useTwinStore((s) => s.editingFlowId);

  const selectEntity = useTwinStore((s) => s.selectEntity);
  const clearSelection = useTwinStore((s) => s.clearSelection);
  const setCursorCoords = useTwinStore((s) => s.setCursorCoords);
  const addRoom = useTwinStore((s) => s.addRoom);
  const addWall = useTwinStore((s) => s.addWall);
  const addOpeningOnWall = useTwinStore((s) => s.addOpeningOnWall);
  const addAsset = useTwinStore((s) => s.addAsset);
  const updateAsset = useTwinStore((s) => s.updateAsset);
  const updateWall = useTwinStore((s) => s.updateWall);
  const updateFlowRoute = useTwinStore((s) => s.updateFlowRoute);
  const addMeasurePoint = useTwinStore((s) => s.addMeasurePoint);
  const addCalibrationPoint = useTwinStore((s) => s.addCalibrationPoint);
  const paintSurfaceWithMaterial = useTwinStore((s) => s.paintSurfaceWithMaterial);
  const addFlowRoute = useTwinStore((s) => s.addFlowRoute);
  const addCamera = useTwinStore((s) => s.addCamera);
  const setActiveTool = useTwinStore((s) => s.setActiveTool);
  const setAnimateFlows = useTwinStore((s) => s.setAnimateFlows);
  const setShowFlowLegend = useTwinStore((s) => s.setShowFlowLegend);
  const setEditingFlowId = useTwinStore((s) => s.setEditingFlowId);
  const openLiveCamera = useTwinStore((s) => s.openLiveCamera);
  const openRackDesigner = useTwinStore((s) => s.openRackDesigner);

  const selectedMaterialId = useTwinStore((s) => s.selectedMaterialId);
  const selectedObjectTemplateId = useTwinStore((s) => s.selectedObjectTemplateId);
  const selectedFlowType = useTwinStore((s) => s.selectedFlowType);

  const activeFloor = useMemo(
    () => scene.floors.find((f) => f.id === activeFloorId) ?? scene.floors[0],
    [scene.floors, activeFloorId]
  );

  // Pan & Zoom state in meters
  const [zoom, setZoom] = useState(22); // pixels per meter
  const [pan, setPan] = useState({ x: 56, y: 48 });
  const [isPanning, setIsPanning] = useState(false);
  const panOriginRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });

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
      x: Math.round(rect.width / 2 - miniMapTarget.x * zoom),
      y: Math.round(rect.height / 2 - miniMapTarget.z * zoom),
    });
  }, [miniMapTarget, zoom]);

  // Interactive drawing/dragging state
  const [draftStart, setDraftStart] = useState<{ x: number; z: number } | null>(null);
  const [draftCurrent, setDraftCurrent] = useState<{ x: number; z: number } | null>(null);
  const [flowDraftPoints, setFlowDraftPoints] = useState<{ x: number; z: number }[]>([]);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [draggingWallHandle, setDraggingWallHandle] = useState<{ wallId: string; end: 1 | 2 } | null>(null);
  const [draggingFlowNode, setDraggingFlowNode] = useState<{ flowId: string; idx: number } | null>(null);

  const isLayerVisible = (layerId: string) => {
    const l = scene.layers.find((x) => x.id === layerId);
    return l ? l.visible : true;
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, z: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const rawX = (sx - pan.x) / zoom;
    const rawZ = (sy - pan.y) / zoom;
    return {
      x: snapValue(rawX, snap.gridSize, snap.enabled && snap.snapToGrid),
      z: snapValue(rawZ, snap.gridSize, snap.enabled && snap.snapToGrid),
    };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    setZoom((z) => Math.max(8, Math.min(72, Number((z * factor).toFixed(2)))));
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Middle click or Alt+drag pans
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      panOriginRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
      return;
    }
    if (e.button !== 0) return;

    const pt = screenToWorld(e.clientX, e.clientY);

    if (activeTool === 'draw-room' || activeTool === 'draw-wall') {
      setDraftStart(pt);
      setDraftCurrent(pt);
      return;
    }

    if (activeTool === 'place-object') {
      addAsset(selectedObjectTemplateId, pt.x, pt.z);
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

    if (activeTool === 'measure') {
      addMeasurePoint(pt);
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

    if (e.target === svgRef.current || (e.target as HTMLElement).dataset.canvasBg === 'true') {
      if (!e.shiftKey) clearSelection();
      setIsPanning(true);
      panOriginRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pt = screenToWorld(e.clientX, e.clientY);
    setCursorCoords({ x: pt.x, y: activeFloor?.elevation ?? 0, z: pt.z });

    if (isPanning) {
      setPan({
        x: panOriginRef.current.px + (e.clientX - panOriginRef.current.mx),
        y: panOriginRef.current.py + (e.clientY - panOriginRef.current.my),
      });
      return;
    }

    if (draftStart) {
      setDraftCurrent(pt);
      return;
    }

    if (draggingAssetId) {
      updateAsset(draggingAssetId, { x: pt.x, z: pt.z }, false);
      return;
    }

    if (draggingWallHandle) {
      updateWall(
        draggingWallHandle.wallId,
        draggingWallHandle.end === 1 ? { x1: pt.x, z1: pt.z } : { x2: pt.x, z2: pt.z }
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

  const handleSvgPointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
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
      } else if (activeTool === 'draw-wall') {
        const len = Math.hypot(draftCurrent.x - draftStart.x, draftCurrent.z - draftStart.z);
        if (len >= 0.4) {
          addWall(draftStart.x, draftStart.z, draftCurrent.x, draftCurrent.z);
        }
      }
      setDraftStart(null);
      setDraftCurrent(null);
    }

    if (draggingAssetId) {
      const movedAsset = scene.assets.find((a) => a.id === draggingAssetId);
      if (movedAsset) {
        updateAsset(draggingAssetId, { x: movedAsset.x, z: movedAsset.z }, true);
      }
      setDraggingAssetId(null);
    }

    if (draggingWallHandle) {
      setDraggingWallHandle(null);
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

  const handleDrop = (e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    const templateId = e.dataTransfer.getData('application/x-gradian-object');
    if (templateId) {
      const pt = screenToWorld(e.clientX, e.clientY);
      addAsset(templateId, pt.x, pt.z);
    }
  };

  const rooms = scene.rooms.filter((r) => r.floorId === activeFloorId && r.activeFromDate <= timelineDate);
  const walls = scene.walls.filter((w) => w.floorId === activeFloorId && w.activeFromDate <= timelineDate);
  const openings = scene.openings.filter((o) => o.floorId === activeFloorId);
  const assets = scene.assets.filter((a) => a.floorId === activeFloorId && !a.hidden && a.installationDate <= timelineDate);
  const cameras = scene.cameras.filter((c) => c.floorId === activeFloorId);
  const flows = scene.flows.filter((f) => f.floorId === activeFloorId);
  const references = scene.references.filter((r) => r.floorId === activeFloorId && r.visible);

  const selectedSet = new Set(selected.map((s) => `${s.type}:${s.id}`));
  const isDarkBg = canvasBackdrop === 'dark';

  const measureDist =
    measurePoints.length === 2
      ? Math.hypot(measurePoints[1].x - measurePoints[0].x, measurePoints[1].z - measurePoints[0].z)
      : null;

  return (
    <div
      className={`relative w-full h-full overflow-hidden select-none transition-colors duration-200 ${
        isDarkBg ? 'bg-[#09090D]' : 'bg-[#EDEEF2]'
      }`}
    >
      <svg
        ref={svgRef}
        className="w-full h-full cursor-crosshair"
        onWheel={handleWheel}
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handleSvgPointerMove}
        onPointerUp={handleSvgPointerUp}
        onDragOver={(e) => e.preventDefault()}
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

        <g transform={`translate(${pan.x}, ${pan.y})`}>
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

          {/* Rooms */}
          {isLayerVisible('layer-architecture') &&
            rooms.map((rm) => {
              const isSel = selectedSet.has(`room:${rm.id}`);
              const fillColor = getRoomColorForAnalytics(rm, analyticsMetric);
              const area = rm.width * rm.depth;
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
              const roomBaseFill = isLineFailRoom
                ? '#EF4444'
                : isLineOkRoom
                  ? activeLineHighlight?.eligible
                    ? '#10B981'
                    : '#34D399'
                  : fillColor;

              return (
                <g
                  key={rm.id}
                  onPointerDown={(e) => {
                    if (activeTool === 'paint-material') {
                      e.stopPropagation();
                      paintSurfaceWithMaterial('room', rm.id, selectedMaterialId);
                    } else if (activeTool === 'select') {
                      e.stopPropagation();
                      selectEntity({ type: 'room', id: rm.id }, e.shiftKey);
                    }
                  }}
                  className="cursor-pointer"
                >
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
                    fillOpacity={
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
                              : 0.13
                    }
                    stroke={
                      isLineFailRoom
                        ? '#EF4444'
                        : isLineOkRoom
                          ? '#10B981'
                          : isSel
                            ? '#8B5CF6'
                            : isDarkBg
                              ? '#2F2F3D'
                              : fillColor
                    }
                    strokeOpacity={isSel || isLineFailRoom || isLineOkRoom ? 1 : isDarkBg ? 0.9 : 0.45}
                    strokeWidth={isLineFailRoom || isLineOkRoom ? 3 : isSel ? 2.5 : 1.1}
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
                  {/* Readable Top-Anchored Room Label Badge (avoids colliding with center equipment) */}
                  {zoom >= 12 && rw >= 68 && rd >= 42 && (
                    <g pointerEvents="none" transform={`translate(${rx + 6}, ${rz + 7})`}>
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
                </g>
              );
            })}

          {/* Walls */}
          {isLayerVisible('layer-walls') &&
            walls.map((w) => {
              const isSel = selectedSet.has(`wall:${w.id}`);
              return (
                <g key={w.id}>
                  <line
                    x1={w.x1 * zoom}
                    y1={w.z1 * zoom}
                    x2={w.x2 * zoom}
                    y2={w.z2 * zoom}
                    stroke={isSel ? '#8B5CF6' : isDarkBg ? '#D4D4DE' : '#27272A'}
                    strokeWidth={Math.max(3, w.thickness * zoom)}
                    strokeLinecap="square"
                    className="cursor-pointer"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (activeTool === 'place-door' || activeTool === 'place-window') {
                        const clickPt = screenToWorld(e.clientX, e.clientY);
                        const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
                        const t =
                          len > 0
                            ? ((clickPt.x - w.x1) * (w.x2 - w.x1) + (clickPt.z - w.z1) * (w.z2 - w.z1)) / (len * len)
                            : 0.5;
                        addOpeningOnWall(w.id, t);
                        setActiveTool('select');
                      } else if (activeTool === 'paint-material') {
                        paintSurfaceWithMaterial('wall', w.id, selectedMaterialId);
                      } else if (activeTool === 'select') {
                        selectEntity({ type: 'wall', id: w.id }, e.shiftKey);
                      }
                    }}
                  />
                  {/* Visual Endpoint Drag Handles when Selected */}
                  {isSel && (
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

          {/* Doors & Windows */}
          {isLayerVisible('layer-openings') &&
            openings.map((op) => {
              const wall = walls.find((w) => w.id === op.wallId);
              if (!wall) return null;
              const angleRad = Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1);
              const angleDeg = (angleRad * 180) / Math.PI;
              const cx = (wall.x1 + (wall.x2 - wall.x1) * op.offsetRatio) * zoom;
              const cy = (wall.z1 + (wall.z2 - wall.z1) * op.offsetRatio) * zoom;
              const isSel = selectedSet.has(`opening:${op.id}`);
              const ow = op.width * zoom;

              return (
                <g
                  key={op.id}
                  transform={`translate(${cx}, ${cy}) rotate(${angleDeg})`}
                  className="cursor-pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    selectEntity({ type: 'opening', id: op.id }, e.shiftKey);
                  }}
                >
                  {/* Cut wall gap (matches charcoal slab in dark mode, white in light mode) */}
                  <rect
                    x={-ow / 2}
                    y={-4.5}
                    width={ow}
                    height={9}
                    fill={isDarkBg ? '#181822' : '#FFFFFF'}
                  />
                  {op.kind === 'window' ? (
                    <rect
                      x={-ow / 2}
                      y={-2.5}
                      width={ow}
                      height={5}
                      fill="#38BDF8"
                      fillOpacity={0.7}
                      stroke={isSel ? '#8B5CF6' : '#0284C7'}
                      strokeWidth={1.5}
                    />
                  ) : (
                    <>
                      <line
                        x1={-ow / 2}
                        y1={0}
                        x2={-ow / 2}
                        y2={ow * 0.85}
                        stroke={isSel ? '#8B5CF6' : isDarkBg ? '#F59E0B' : '#7C3AED'}
                        strokeWidth={2}
                      />
                      <path
                        d={`M ${-ow / 2} ${ow * 0.85} A ${ow * 0.85} ${ow * 0.85} 0 0 0 ${ow / 2} 0`}
                        fill="none"
                        stroke={isSel ? '#8B5CF6' : isDarkBg ? '#F59E0B' : '#7C3AED'}
                        strokeOpacity={0.85}
                        strokeWidth={1.2}
                        strokeDasharray="3 2"
                      />
                    </>
                  )}
                </g>
              );
            })}

          {/* Flow Routes (Animated + Interactive Node Modify Mode) */}
          {isLayerVisible('layer-flows') &&
            flows.map((fl) => {
              if (fl.points.length < 2) return null;
              const isSel = selectedSet.has(`flow:${fl.id}`);
              const isModifying = isSel || editingFlowId === fl.id;
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

            return (
              <g
                key={asset.id}
                transform={`translate(${asset.x * zoom}, ${asset.z * zoom}) rotate(${rotDeg})`}
                className="cursor-move"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (activeTool === 'paint-material') {
                    paintSurfaceWithMaterial('asset', asset.id, selectedMaterialId);
                    return;
                  }
                  if (activeTool === 'select') {
                    selectEntity({ type: 'asset', id: asset.id }, e.shiftKey);
                    if (!asset.locked) setDraggingAssetId(asset.id);
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

          {draftStart && draftCurrent && activeTool === 'draw-wall' && (
            <g>
              <line
                x1={draftStart.x * zoom}
                y1={draftStart.z * zoom}
                x2={draftCurrent.x * zoom}
                y2={draftCurrent.z * zoom}
                stroke="#3B82F6"
                strokeWidth={4}
                strokeDasharray="6 4"
              />
              <text
                x={((draftStart.x + draftCurrent.x) / 2) * zoom}
                y={((draftStart.z + draftCurrent.z) / 2) * zoom - 8}
                textAnchor="middle"
                className="font-mono text-xs fill-blue-400 font-semibold"
              >
                {formatLength(Math.hypot(draftCurrent.x - draftStart.x, draftCurrent.z - draftStart.z), scene.unitSystem)}
              </text>
            </g>
          )}

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

          {/* Measurement Tape */}
          {measurePoints.length > 0 && (
            <g>
              {measurePoints.map((p, idx) => (
                <circle key={idx} cx={p.x * zoom} cy={p.z * zoom} r={5} fill="#F59E0B" stroke="#FFFFFF" strokeWidth={1.5} />
              ))}
              {measurePoints.length === 2 && measureDist !== null && (
                <>
                  <line
                    x1={measurePoints[0].x * zoom}
                    y1={measurePoints[0].z * zoom}
                    x2={measurePoints[1].x * zoom}
                    y2={measurePoints[1].z * zoom}
                    stroke="#F59E0B"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                  />
                  <text
                    x={((measurePoints[0].x + measurePoints[1].x) / 2) * zoom}
                    y={((measurePoints[0].z + measurePoints[1].z) / 2) * zoom - 8}
                    textAnchor="middle"
                    className="font-mono text-xs fill-amber-400 font-semibold"
                  >
                    {formatLength(measureDist, scene.unitSystem)}
                  </text>
                </>
              )}
            </g>
          )}

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
        </g>
      </svg>

      {/* Contextual 2D Tool Prompt, Canvas Dark/Light Toggle & Zoom Controls */}
      <div
        className={`absolute bottom-3 right-3 flex items-center gap-1 rounded-2xl border px-2 py-1 text-xs shadow-xl backdrop-blur-md transition-colors ${
          isDarkBg
            ? 'bg-[#14141C]/95 border-zinc-800 text-zinc-200'
            : 'bg-white/95 border-zinc-200 text-zinc-800'
        }`}
      >
        <button
          onClick={toggleCanvasBackdrop}
          className={`p-1 rounded-xl transition-colors ${
            isDarkBg ? 'hover:bg-zinc-800 text-amber-400' : 'hover:bg-zinc-100 text-violet-600'
          }`}
          title={isDarkBg ? 'Switch 2D Canvas to Light Paper' : 'Switch 2D Canvas to Dark Charcoal'}
        >
          {isDarkBg ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
        <span className={`w-px h-4 ${isDarkBg ? 'bg-zinc-800' : 'bg-zinc-200'}`} />
        <button
          onClick={() => setZoom((z) => Math.max(8, z - 4))}
          className={`px-1.5 py-0.5 rounded-lg font-mono ${isDarkBg ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          title="Zoom Out"
        >
          -
        </button>
        <span className={`font-mono tabular-nums text-[11px] w-11 text-center ${isDarkBg ? 'text-zinc-300' : 'text-zinc-600'}`}>
          {Math.round((zoom / 22) * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.min(72, z + 4))}
          className={`px-1.5 py-0.5 rounded-lg font-mono ${isDarkBg ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          title="Zoom In"
        >
          +
        </button>
        <button
          onClick={() => {
            setZoom(22);
            setPan({ x: 56, y: 48 });
          }}
          className={`px-2 py-0.5 rounded-lg text-[11px] font-medium ${isDarkBg ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
        >
          Fit
        </button>
      </div>

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

      {/* Toggleable 2D Flow Legend */}
      {isLayerVisible('layer-flows') && flows.length > 0 && (
        showFlowLegend ? (
          <div
            className={`absolute bottom-3 left-3 z-20 w-52 rounded-2xl border shadow-xl backdrop-blur-md p-2.5 text-[11px] space-y-1.5 transition-colors ${
              isDarkBg
                ? 'bg-[#14141C]/95 border-zinc-800 text-zinc-100'
                : 'bg-white/95 border-zinc-200 text-zinc-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`font-semibold flex items-center gap-1.5 ${isDarkBg ? 'text-white' : 'text-zinc-900'}`}>
                <Waypoints className="w-3.5 h-3.5 text-violet-500" />
                Flow Legend
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setAnimateFlows(!animateFlows)}
                  className={`px-1.5 py-0.5 rounded-lg flex items-center gap-1 text-[10px] font-medium ${
                    animateFlows
                      ? 'bg-violet-600 text-white'
                      : isDarkBg
                        ? 'bg-zinc-800 text-zinc-400'
                        : 'bg-zinc-100 text-zinc-500'
                  }`}
                >
                  {animateFlows ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                  {animateFlows ? 'Anim' : 'Off'}
                </button>
                <button
                  onClick={() => setShowFlowLegend(false)}
                  className={`p-0.5 text-zinc-400 ${isDarkBg ? 'hover:text-white' : 'hover:text-zinc-900'}`}
                  title="Hide Flow Legend"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {flows.map((fl) => (
                <div key={fl.id} className="flex items-center justify-between gap-2">
                  <span className={`flex items-center gap-1.5 truncate ${isDarkBg ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: fl.color }} />
                    <span className="truncate">{fl.name}</span>
                  </span>
                  <span className="font-mono text-[9px] uppercase text-zinc-400">{fl.flowType}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowFlowLegend(true)}
            className={`absolute bottom-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl border shadow-xl backdrop-blur-md text-[11px] font-medium hover:border-violet-500 transition-colors ${
              isDarkBg
                ? 'bg-[#14141C]/95 border-zinc-800 text-zinc-200'
                : 'bg-white/95 border-zinc-200 text-zinc-700'
            }`}
          >
            <Waypoints className="w-3.5 h-3.5 text-violet-500" />
            Flows
          </button>
        )
      )}

      {activeTool !== 'select' && activeTool !== 'draw-flow' && (
        <div className="absolute top-3 left-3 px-3 py-1.5 rounded-md bg-violet-600 text-white text-xs font-medium shadow-sm pointer-events-none">
          {activeTool === 'draw-room' && 'Click and drag on the 2D floor plan to draw a room with automatic walls'}
          {activeTool === 'draw-wall' && 'Click and drag between two points to draw a wall segment'}
          {activeTool === 'place-door' && 'Click any wall line to insert a door opening'}
          {activeTool === 'place-window' && 'Click any wall line to insert an observation window'}
          {activeTool === 'place-object' && 'Click anywhere on the floor plan to place selected equipment'}
          {activeTool === 'paint-material' && 'Click any room, wall, or equipment to apply the active material'}
          {activeTool === 'measure' && 'Click two points to measure exact real-world distance'}
          {activeTool === 'place-camera' && 'Click to place a camera with field-of-view cone'}
          {activeTool === 'calibrate-ref' && `Calibration: click 2 known points on the reference blueprint (${calibrationPoints.length}/2)`}
        </div>
      )}
      {activeLineHighlight && (
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
    </div>
  );
};
