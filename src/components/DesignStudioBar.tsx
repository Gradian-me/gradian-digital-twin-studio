import React, { useMemo, useRef, useState } from 'react';
import {
  Box,
  Building2,
  Check,
  ChevronDown,
  Copy,
  DoorOpen,
  Grid3X3,
  GripVertical,
  Hexagon,
  Layers,
  Lightbulb,
  Magnet,
  Maximize2,
  MousePointer2,
  Move,
  Paintbrush,
  Plus,
  RotateCw,
  Ruler,
  Search,
  Sparkles,
  Square,
  SquareSplitHorizontal,
  Trash2,
  Upload,
  Wind,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { DEFAULT_MATERIALS, OPENING_PRESETS, WALL_PRESETS } from '../data/materialsLibrary';
import { OBJECT_LIBRARY } from '../data/objectLibrary';
import { SPACE_TYPE_LIBRARY } from '../data/spaceTypes';
import { SMART_ROOM_TEMPLATES } from '../data/smartRoomTemplates';
import { formatArea, formatLength } from '../utils/spatial';
import { detectEnclosedWallPolygons } from '../utils/polygonSpaces';
import { OPENING_DND_MIME, setActiveDraggedOpeningSubtype } from '../utils/openingPlacement';
import { LightingDesignerPanel } from './LightingDesignerPanel';
import type { MaterialDef } from '../types/twin';

type StudioPopover =
  | 'none'
  | 'floors'
  | 'room'
  | 'wall'
  | 'door'
  | 'window'
  | 'equipment'
  | 'lighting'
  | 'textures'
  | 'snap';

const GRID_SIZES = [0.1, 0.25, 0.5, 1.0, 2.0];
const ANGLE_STEPS = [5, 15, 30, 45, 90];

function computeMeasureStats(pts: { x: number; z: number }[]) {
  if (pts.length < 2) return { totalDist: 0, area: 0 };
  let totalDist = 0;
  for (let i = 1; i < pts.length; i++) {
    totalDist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  let area = 0;
  if (pts.length >= 3) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a.x * b.z - b.x * a.z;
    }
    area = Math.abs(area) / 2;
  }
  return { totalDist, area };
}

export const DesignStudioBar: React.FC = () => {
  const workspaceMode = useTwinStore((s) => s.workspaceMode);
  const scene = useTwinStore((s) => s.scene);
  const activeBuildingId = useTwinStore((s) => s.activeBuildingId);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const activeTool = useTwinStore((s) => s.activeTool);
  const transformMode = useTwinStore((s) => s.transformMode);
  const selectedSpaceTypeId = useTwinStore((s) => s.selectedSpaceTypeId);
  const selectedWallPresetId = useTwinStore((s) => s.selectedWallPresetId);
  const selectedOpeningSubtype = useTwinStore((s) => s.selectedOpeningSubtype);
  const selectedObjectTemplateId = useTwinStore((s) => s.selectedObjectTemplateId);
  const selectedMaterialId = useTwinStore((s) => s.selectedMaterialId);
  const selected = useTwinStore((s) => s.selected);
  const snap = useTwinStore((s) => s.snap);
  const measurePoints = useTwinStore((s) => s.measurePoints);
  const showHvacOverlay = useTwinStore((s) => s.showHvacOverlay);

  const setActiveTool = useTwinStore((s) => s.setActiveTool);
  const setTransformMode = useTwinStore((s) => s.setTransformMode);
  const setSelectedSpaceTypeId = useTwinStore((s) => s.setSelectedSpaceTypeId);
  const setSelectedWallPresetId = useTwinStore((s) => s.setSelectedWallPresetId);
  const setSelectedOpeningSubtype = useTwinStore((s) => s.setSelectedOpeningSubtype);
  const setSelectedObjectTemplateId = useTwinStore((s) => s.setSelectedObjectTemplateId);
  const setSelectedMaterialId = useTwinStore((s) => s.setSelectedMaterialId);
  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const setActiveBuilding = useTwinStore((s) => s.setActiveBuilding);
  const addFloor = useTwinStore((s) => s.addFloor);
  const updateFloor = useTwinStore((s) => s.updateFloor);
  const deleteFloor = useTwinStore((s) => s.deleteFloor);
  const addBuilding = useTwinStore((s) => s.addBuilding);
  const addSmartRoomFromTemplate = useTwinStore((s) => s.addSmartRoomFromTemplate);
  const updateSnap = useTwinStore((s) => s.updateSnap);
  const setUnitSystem = useTwinStore((s) => s.setUnitSystem);
  const clearMeasure = useTwinStore((s) => s.clearMeasure);
  const setShowHvacOverlay = useTwinStore((s) => s.setShowHvacOverlay);
  const selectEntity = useTwinStore((s) => s.selectEntity);
  const setRightPanelOpen = useTwinStore((s) => s.setRightPanelOpen);
  const setRightTab = useTwinStore((s) => s.setRightTab);
  const addCustomMaterial = useTwinStore((s) => s.addCustomMaterial);
  const paintSurfaceWithMaterial = useTwinStore((s) => s.paintSurfaceWithMaterial);
  const scanFloorPolygonSpaces = useTwinStore((s) => s.scanFloorPolygonSpaces);
  const showToast = useTwinStore((s) => s.showToast);

  const detectedPolygonSpaces = useMemo(
    () => detectEnclosedWallPolygons(scene.walls, scene.rooms, activeFloorId),
    [scene.walls, scene.rooms, activeFloorId]
  );

  const [openPopover, setOpenPopover] = useState<StudioPopover>('none');
  const [equipQuery, setEquipQuery] = useState('');
  const [equipCategory, setEquipCategory] = useState<string>('all');
  const [matCategory, setMatCategory] = useState<string>('All');
  const [newFloorName, setNewFloorName] = useState('');
  const [newBuildingName, setNewBuildingName] = useState('');
  const textureFileRef = useRef<HTMLInputElement | null>(null);

  const unitSystem = scene.unitSystem;

  const activeBuilding = useMemo(
    () => scene.buildings.find((b) => b.id === activeBuildingId) ?? scene.buildings[0],
    [scene.buildings, activeBuildingId]
  );
  const buildingFloors = useMemo(
    () =>
      scene.floors
        .filter((f) => f.buildingId === (activeBuilding?.id ?? ''))
        .sort((a, b) => a.levelIndex - b.levelIndex),
    [scene.floors, activeBuilding]
  );
  const activeFloor = useMemo(
    () => scene.floors.find((f) => f.id === activeFloorId) ?? buildingFloors[0],
    [scene.floors, activeFloorId, buildingFloors]
  );

  const allMaterials = useMemo(() => {
    const overrides = new Map<string, MaterialDef>();
    for (const m of DEFAULT_MATERIALS) overrides.set(m.id, m);
    for (const m of scene.customMaterials) overrides.set(m.id, m);
    return Array.from(overrides.values());
  }, [scene.customMaterials]);

  const materialCategories = useMemo(
    () => ['All', ...Array.from(new Set(allMaterials.map((m) => m.category)))],
    [allMaterials]
  );

  const filteredMaterials = useMemo(
    () => (matCategory === 'All' ? allMaterials : allMaterials.filter((m) => m.category === matCategory)),
    [allMaterials, matCategory]
  );

  const allObjects = useMemo(() => [...OBJECT_LIBRARY, ...scene.customObjects], [scene.customObjects]);
  const equipCategories = useMemo(
    () => ['all', ...Array.from(new Set(allObjects.map((o) => o.category)))],
    [allObjects]
  );
  const filteredObjects = useMemo(() => {
    const q = equipQuery.trim().toLowerCase();
    return allObjects.filter((o) => {
      if (equipCategory !== 'all' && o.category !== equipCategory) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q) ||
        o.manufacturer.toLowerCase().includes(q) ||
        o.model.toLowerCase().includes(q)
      );
    });
  }, [allObjects, equipCategory, equipQuery]);

  const doorPresets = useMemo(() => OPENING_PRESETS.filter((p) => p.kind === 'door'), []);
  const windowPresets = useMemo(() => OPENING_PRESETS.filter((p) => p.kind === 'window'), []);

  const currentWallPreset = WALL_PRESETS.find((p) => p.id === selectedWallPresetId) ?? WALL_PRESETS[0];
  const currentOpeningPreset = OPENING_PRESETS.find((p) => p.subtype === selectedOpeningSubtype) ?? OPENING_PRESETS[0];
  const currentObjectTpl = allObjects.find((o) => o.id === selectedObjectTemplateId) ?? allObjects[0];
  const currentMaterial = allMaterials.find((m) => m.id === selectedMaterialId) ?? allMaterials[0];
  const measureStats = useMemo(() => computeMeasureStats(measurePoints), [measurePoints]);

  if (workspaceMode !== 'design') return null;

  const togglePopover = (p: StudioPopover) => setOpenPopover((prev) => (prev === p ? 'none' : p));

  const handleUploadTexture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const newMat: MaterialDef = {
        id: `mat-custom-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        category: 'Custom',
        baseColor: '#FFFFFF',
        roughness: 0.45,
        metalness: 0.05,
        opacity: 1,
        reflectivity: 0.4,
        pattern: 'solid',
        uvScale: 1,
        textureRotation: 0,
        customTextureDataUrl: dataUrl,
      };
      addCustomMaterial(newMat);
      setSelectedMaterialId(newMat.id);
      setActiveTool('paint-material');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleOpenHvacDesign = () => {
    const next = !showHvacOverlay;
    setShowHvacOverlay(next);
    const floorRooms = scene.rooms.filter((r) => r.floorId === activeFloorId);
    const targetRoom =
      selected[0]?.type === 'room'
        ? floorRooms.find((r) => r.id === selected[0].id) ?? floorRooms[0]
        : floorRooms[0];
    if (targetRoom) {
      selectEntity({ type: 'room', id: targetRoom.id });
      setRightTab('properties');
      setRightPanelOpen(true);
    }
    showToast(next ? 'HVAC Overlay & Room AHU Controls active' : 'HVAC Overlay hidden', 'info');
  };

  return (
    <div className="h-11 bg-white dark:bg-[#111117] border-b border-zinc-200 dark:border-zinc-800 px-2 sm:px-3 flex items-center justify-between gap-1.5 z-30 shrink-0 relative">
      {/* LEFT: Floors + Core Architectural Authoring */}
      <div className="flex items-center gap-1 min-w-0">
        {/* FLOOR & SLAB DESIGNER POPOVER */}
        <div className="relative">
          <button
            type="button"
            onClick={() => togglePopover('floors')}
            title={`Floors & Buildings (${activeFloor?.code ?? 'Floor'})`}
            className={`h-8 px-2 sm:px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              openPopover === 'floors'
                ? 'border-violet-500 bg-violet-500/12 text-violet-700 dark:text-violet-300'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-800 dark:text-zinc-200 hover:border-violet-500/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-violet-500 shrink-0" />
            <span>{activeFloor?.code ?? 'Floor'}</span>
            {activeFloor && (
              <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 tabular-nums hidden 2xl:inline">
                {activeFloor.width}×{activeFloor.depth}m
              </span>
            )}
            <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
          </button>

          {openPopover === 'floors' && activeFloor && (
            <div className="absolute left-0 top-full mt-1.5 w-[340px] bg-white dark:bg-[#14141B] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-3 z-50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-violet-500" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Floors &amp; Buildings</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenPopover('none')}
                  className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Building selector */}
              <div className="flex items-center gap-1.5">
                <select
                  value={activeBuilding?.id ?? ''}
                  onChange={(e) => setActiveBuilding(e.target.value)}
                  className="flex-1 h-7 px-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-100"
                >
                  {scene.buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <input
                    value={newBuildingName}
                    onChange={(e) => setNewBuildingName(e.target.value)}
                    placeholder="New bldg..."
                    className="w-24 h-7 px-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const nm = newBuildingName.trim() || `Building ${scene.buildings.length + 1}`;
                      addBuilding(nm);
                      setNewBuildingName('');
                    }}
                    title="Add Building"
                    className="h-7 px-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-violet-500/15 text-zinc-700 dark:text-zinc-200 text-[11px] font-medium cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Floor list */}
              <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
                {buildingFloors.map((f) => {
                  const isActive = f.id === activeFloor.id;
                  return (
                    <div
                      key={f.id}
                      className={`flex items-center justify-between px-2 py-1.5 rounded-lg border text-xs transition-colors ${
                        isActive
                          ? 'border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium'
                          : 'border-zinc-200/70 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveFloor(f.id)}
                        className="flex-1 text-left flex items-center gap-2 min-w-0 cursor-pointer"
                      >
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800">
                          {f.code}
                        </span>
                        <span className="truncate">{f.name}</span>
                        <span className="text-[10px] text-zinc-400 tabular-nums ml-auto">
                          {f.width}×{f.depth}m · +{f.elevation.toFixed(1)}m
                        </span>
                      </button>
                      {scene.floors.length > 1 && (
                        <button
                          type="button"
                          onClick={() => deleteFloor(f.id)}
                          title="Delete Floor"
                          className="ml-1.5 p-1 rounded hover:bg-red-500/15 text-zinc-400 hover:text-red-500 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add Floor quick actions */}
              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5">
                <input
                  value={newFloorName}
                  onChange={(e) => setNewFloorName(e.target.value)}
                  placeholder={`Level ${buildingFloors.length} name (optional)`}
                  className="w-full h-7 px-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs"
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeBuilding) return;
                      addFloor({
                        buildingId: activeBuilding.id,
                        name: newFloorName.trim() || `Level ${buildingFloors.length}`,
                        width: activeFloor.width,
                        depth: activeFloor.depth,
                        height: activeFloor.height,
                      });
                      setNewFloorName('');
                    }}
                    className="h-7 px-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Blank Floor
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeBuilding) return;
                      addFloor({
                        buildingId: activeBuilding.id,
                        name: newFloorName.trim() || `${activeFloor.name} (Copy)`,
                        width: activeFloor.width,
                        depth: activeFloor.depth,
                        height: activeFloor.height,
                        duplicateFromFloorId: activeFloor.id,
                      });
                      setNewFloorName('');
                    }}
                    className="h-7 px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" /> Duplicate Floor
                  </button>
                </div>
              </div>

              {/* Active Floor Dimensions & Slab Material */}
              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Active Floor Slab ({activeFloor.code})
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="block">
                    <span className="text-[10px] text-zinc-500">Width (m)</span>
                    <input
                      type="number"
                      min={6}
                      max={200}
                      step={1}
                      value={activeFloor.width}
                      onChange={(e) => updateFloor(activeFloor.id, { width: Math.max(6, Number(e.target.value) || 20) })}
                      className="w-full h-7 px-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono tabular-nums"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-zinc-500">Depth (m)</span>
                    <input
                      type="number"
                      min={6}
                      max={200}
                      step={1}
                      value={activeFloor.depth}
                      onChange={(e) => updateFloor(activeFloor.id, { depth: Math.max(6, Number(e.target.value) || 20) })}
                      className="w-full h-7 px-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono tabular-nums"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-zinc-500">Height (m)</span>
                    <input
                      type="number"
                      min={2.4}
                      max={16}
                      step={0.1}
                      value={activeFloor.height}
                      onChange={(e) => updateFloor(activeFloor.id, { height: Math.max(2.4, Number(e.target.value) || 4) })}
                      className="w-full h-7 px-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono tabular-nums"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-zinc-500 mr-1">Slab:</span>
                  {allMaterials
                    .filter((m) => m.category === 'Flooring' || m.category === 'Masonry & Stone')
                    .slice(0, 8)
                    .map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        title={m.name}
                        onClick={() => paintSurfaceWithMaterial('floor', activeFloor.id, m.id)}
                        className={`w-5 h-5 rounded border cursor-pointer transition-transform hover:scale-110 ${
                          activeFloor.slabMaterialId === m.id
                            ? 'border-violet-500 ring-1 ring-violet-500'
                            : 'border-zinc-300 dark:border-zinc-700'
                        }`}
                        style={{ backgroundColor: m.baseColor }}
                      />
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-0.5 shrink-0" />

        {/* SELECT + GIZMO MODE */}
        <div className="flex items-center bg-zinc-100 dark:bg-[#181820] rounded-lg p-0.5 border border-zinc-200 dark:border-zinc-800 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTool('select');
              setOpenPopover('none');
            }}
            title="Select Tool (V)"
            className={`h-7 px-2 rounded-md text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
              activeTool === 'select'
                ? 'bg-violet-600 text-white'
                : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <MousePointer2 className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden xl:inline">Select</span>
          </button>
          {activeTool === 'select' && (
            <>
              <button
                type="button"
                onClick={() => setTransformMode('translate')}
                title="Move Gizmo (G)"
                className={`h-7 w-7 rounded-md flex items-center justify-center cursor-pointer transition-colors ${
                  transformMode === 'translate'
                    ? 'bg-white dark:bg-zinc-800 text-violet-600 dark:text-violet-300 shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <Move className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setTransformMode('rotate')}
                title="Rotate Gizmo (E)"
                className={`h-7 w-7 rounded-md flex items-center justify-center cursor-pointer transition-colors ${
                  transformMode === 'rotate'
                    ? 'bg-white dark:bg-zinc-800 text-violet-600 dark:text-violet-300 shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setTransformMode('scale')}
                title="Scale Gizmo (S)"
                className={`h-7 w-7 rounded-md flex items-center justify-center cursor-pointer transition-colors ${
                  transformMode === 'scale'
                    ? 'bg-white dark:bg-zinc-800 text-violet-600 dark:text-violet-300 shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* ROOM TOOL + PRESETS */}
        <div className="relative flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTool('draw-room');
              setOpenPopover('none');
            }}
            title="Draw Room (R)"
            className={`h-8 pl-2 pr-1.5 rounded-l-lg border-y border-l text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
              activeTool === 'draw-room'
                ? 'border-violet-500 bg-violet-600 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Square className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden md:inline">Room</span>
          </button>
          <button
            type="button"
            onClick={() => togglePopover('room')}
            aria-label="Room Templates"
            className={`h-8 px-1 rounded-r-lg border text-[11px] flex items-center cursor-pointer transition-colors ${
              activeTool === 'draw-room'
                ? 'border-violet-500 bg-violet-700 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <ChevronDown className="w-3 h-3" />
          </button>

          {openPopover === 'room' && (
            <div className="absolute left-0 top-full mt-1.5 w-80 bg-white dark:bg-[#14141B] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-3 z-50 space-y-2.5">
              <div className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 flex items-center justify-between">
                <span>Draw Room Space Type</span>
                <span className="text-[10px] text-zinc-400">Drag 2D / 2-click 3D</span>
              </div>
              <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto pr-0.5">
                {SPACE_TYPE_LIBRARY.slice(0, 12).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      setSelectedSpaceTypeId(st.id);
                      setActiveTool('draw-room');
                      setOpenPopover('none');
                    }}
                    className={`px-2 py-1.5 rounded-lg border text-left text-[11px] flex items-center gap-1.5 cursor-pointer ${
                      selectedSpaceTypeId === st.id
                        ? 'border-violet-500 bg-violet-500/12 text-violet-700 dark:text-violet-300 font-medium'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: st.color }} />
                    <span className="truncate">{st.name}</span>
                  </button>
                ))}
              </div>
              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-500 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> 1-Click Smart Room Templates
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {SMART_ROOM_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        addSmartRoomFromTemplate(tpl.id);
                        setOpenPopover('none');
                      }}
                      className="w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-violet-500/60 hover:bg-violet-500/8 text-left flex items-center justify-between text-[11px] cursor-pointer"
                    >
                      <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate">{tpl.name}</span>
                      <span className="text-[10px] text-zinc-400 font-mono tabular-nums shrink-0 ml-2">
                        {tpl.width}×{tpl.depth}m
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* WALL TOOL + PRESETS */}
        <div className="relative flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTool('draw-wall');
              setOpenPopover('none');
            }}
            title={`Wall (${currentWallPreset.name})`}
            className={`h-8 pl-2 pr-1.5 rounded-l-lg border-y border-l text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
              activeTool === 'draw-wall'
                ? 'border-violet-500 bg-violet-600 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <SquareSplitHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden md:inline">Wall</span>
          </button>
          <button
            type="button"
            onClick={() => togglePopover('wall')}
            aria-label="Wall Presets"
            className={`h-8 px-1 rounded-r-lg border text-[11px] flex items-center cursor-pointer transition-colors ${
              activeTool === 'draw-wall'
                ? 'border-violet-500 bg-violet-700 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <ChevronDown className="w-3 h-3" />
          </button>

          {openPopover === 'wall' && (
            <div className="absolute left-0 top-full mt-1.5 w-72 bg-white dark:bg-[#14141B] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-2.5 z-50 space-y-1 max-h-80 overflow-y-auto">
              <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Wall Construction Presets
              </div>
              {WALL_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setSelectedWallPresetId(preset.id);
                    setActiveTool('draw-wall');
                    setOpenPopover('none');
                  }}
                  className={`w-full px-2 py-1.5 rounded-lg border text-left flex items-center gap-2 cursor-pointer transition-colors ${
                    selectedWallPresetId === preset.id
                      ? 'border-violet-500 bg-violet-500/12 text-violet-700 dark:text-violet-300'
                      : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-200'
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded border border-zinc-300 dark:border-zinc-700 shrink-0"
                    style={{ backgroundColor: preset.color, opacity: preset.opacity }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium truncate">{preset.name}</div>
                    <div className="text-[10px] text-zinc-400 font-mono tabular-nums">
                      {(preset.thickness * 1000).toFixed(0)}mm · {preset.height}mH · {preset.fireRating}
                    </div>
                  </div>
                  {selectedWallPresetId === preset.id && <Check className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* DETECT ENCLOSED POLYGON SPACES */}
        <button
          type="button"
          onClick={() => {
            scanFloorPolygonSpaces();
            setOpenPopover('none');
          }}
          title="Detect enclosed polygonal areas formed by walls and name them as rooms"
          className={`h-8 px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
            detectedPolygonSpaces.length > 0
              ? 'border-emerald-500/70 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
              : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          <Hexagon className="w-3.5 h-3.5 text-emerald-500" />
          <span className="hidden xl:inline">Spaces</span>
          {detectedPolygonSpaces.length > 0 && (
            <span className="px-1 py-0.2 rounded bg-emerald-600 text-white text-[9.5px] font-mono font-bold tabular-nums">
              {detectedPolygonSpaces.length}
            </span>
          )}
        </button>

        {/* DOOR TOOL + PRESETS (Click or Drag onto Wall) */}
        <div className="relative flex items-center shrink-0">
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              const doorSub =
                currentOpeningPreset.kind === 'door'
                  ? currentOpeningPreset.subtype
                  : doorPresets[0].subtype;
              e.dataTransfer.setData(OPENING_DND_MIME, doorSub);
              e.dataTransfer.effectAllowed = 'copy';
              setActiveDraggedOpeningSubtype(doorSub);
              setSelectedOpeningSubtype(doorSub);
            }}
            onDragEnd={() => setActiveDraggedOpeningSubtype(null)}
            onClick={() => {
              setActiveTool('place-door');
              setOpenPopover('none');
            }}
            title={`Door (${currentOpeningPreset.name}) — Click or drag onto a wall`}
            className={`h-8 pl-2 pr-1.5 rounded-l-lg border-y border-l text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-grab active:cursor-grabbing transition-colors ${
              activeTool === 'place-door'
                ? 'border-violet-500 bg-violet-600 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <DoorOpen className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden lg:inline">Door</span>
          </button>
          <button
            type="button"
            onClick={() => togglePopover('door')}
            aria-label="Door Types"
            className={`h-8 px-1 rounded-r-lg border text-[11px] flex items-center cursor-pointer transition-colors ${
              activeTool === 'place-door'
                ? 'border-violet-500 bg-violet-700 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <ChevronDown className="w-3 h-3" />
          </button>

          {openPopover === 'door' && (
            <div className="absolute left-0 top-full mt-1.5 w-76 bg-white dark:bg-[#14141B] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-2.5 z-50 space-y-1 max-h-80 overflow-y-auto">
              <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Door Types — Click or drag onto a wall
              </div>
              {doorPresets.map((preset) => (
                <button
                  key={preset.subtype}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(OPENING_DND_MIME, preset.subtype);
                    e.dataTransfer.effectAllowed = 'copy';
                    setActiveDraggedOpeningSubtype(preset.subtype);
                    setSelectedOpeningSubtype(preset.subtype);
                    requestAnimationFrame(() => setOpenPopover('none'));
                  }}
                  onDragEnd={() => setActiveDraggedOpeningSubtype(null)}
                  onClick={() => {
                    setSelectedOpeningSubtype(preset.subtype);
                    setActiveTool('place-door');
                    setOpenPopover('none');
                  }}
                  className={`w-full px-2 py-1.5 rounded-lg border text-left flex items-center gap-2 cursor-grab active:cursor-grabbing transition-colors ${
                    selectedOpeningSubtype === preset.subtype
                      ? 'border-violet-500 bg-violet-500/12 text-violet-700 dark:text-violet-300'
                      : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-200'
                  }`}
                >
                  <GripVertical className="w-3 h-3 text-zinc-400 shrink-0" />
                  <span
                    className="w-3.5 h-3.5 rounded-xs border border-zinc-400 shrink-0"
                    style={{ backgroundColor: preset.frameColor }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium truncate">{preset.name}</div>
                    <div className="text-[10px] text-zinc-400 font-mono tabular-nums">
                      {preset.width}m × {preset.height}mH · {preset.accessControl}
                    </div>
                  </div>
                  {selectedOpeningSubtype === preset.subtype && <Check className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* WINDOW TOOL + PRESETS (Click or Drag onto Wall) */}
        <div className="relative flex items-center shrink-0">
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              const winSub =
                currentOpeningPreset.kind === 'window'
                  ? currentOpeningPreset.subtype
                  : windowPresets[0].subtype;
              e.dataTransfer.setData(OPENING_DND_MIME, winSub);
              e.dataTransfer.effectAllowed = 'copy';
              setActiveDraggedOpeningSubtype(winSub);
              setSelectedOpeningSubtype(winSub);
            }}
            onDragEnd={() => setActiveDraggedOpeningSubtype(null)}
            onClick={() => {
              setActiveTool('place-window');
              setOpenPopover('none');
            }}
            title="Place Window on Wall (N) — Click or drag onto a wall"
            className={`h-8 pl-2 pr-1.5 rounded-l-lg border-y border-l text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-grab active:cursor-grabbing transition-colors ${
              activeTool === 'place-window'
                ? 'border-violet-500 bg-violet-600 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden lg:inline">Window</span>
          </button>
          <button
            type="button"
            onClick={() => togglePopover('window')}
            aria-label="Window Types"
            className={`h-8 px-1 rounded-r-lg border text-[11px] flex items-center cursor-pointer transition-colors ${
              activeTool === 'place-window'
                ? 'border-violet-500 bg-violet-700 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <ChevronDown className="w-3 h-3" />
          </button>

          {openPopover === 'window' && (
            <div className="absolute left-0 top-full mt-1.5 w-72 bg-white dark:bg-[#14141B] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-2.5 z-50 space-y-1">
              <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Window Types — Click or drag onto a wall
              </div>
              {windowPresets.map((preset) => (
                <button
                  key={preset.subtype}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(OPENING_DND_MIME, preset.subtype);
                    e.dataTransfer.effectAllowed = 'copy';
                    setActiveDraggedOpeningSubtype(preset.subtype);
                    setSelectedOpeningSubtype(preset.subtype);
                    requestAnimationFrame(() => setOpenPopover('none'));
                  }}
                  onDragEnd={() => setActiveDraggedOpeningSubtype(null)}
                  onClick={() => {
                    setSelectedOpeningSubtype(preset.subtype);
                    setActiveTool('place-window');
                    setOpenPopover('none');
                  }}
                  className={`w-full px-2 py-1.5 rounded-lg border text-left flex items-center gap-2 cursor-grab active:cursor-grabbing transition-colors ${
                    selectedOpeningSubtype === preset.subtype
                      ? 'border-violet-500 bg-violet-500/12 text-violet-700 dark:text-violet-300'
                      : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-200'
                  }`}
                >
                  <GripVertical className="w-3 h-3 text-zinc-400 shrink-0" />
                  <span className="w-3.5 h-3.5 rounded-xs border border-sky-400 bg-sky-300/40 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium truncate">{preset.name}</div>
                    <div className="text-[10px] text-zinc-400 font-mono tabular-nums">
                      {preset.width}m × {preset.height}mH · Sill {preset.sillHeight}m
                    </div>
                  </div>
                  {selectedOpeningSubtype === preset.subtype && <Check className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-0.5 shrink-0" />

        {/* EQUIPMENT PLACEMENT PICKER */}
        <div className="relative flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTool('place-object');
              setOpenPopover('none');
            }}
            title={`Place Equipment: ${currentObjectTpl?.name ?? ''}`}
            className={`h-8 pl-2 pr-1.5 rounded-l-lg border-y border-l text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
              activeTool === 'place-object'
                ? 'border-violet-500 bg-violet-600 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Box className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden xl:inline">Equipment</span>
          </button>
          <button
            type="button"
            onClick={() => togglePopover('equipment')}
            aria-label="Equipment Catalog"
            className={`h-8 px-1 rounded-r-lg border text-[11px] flex items-center cursor-pointer transition-colors ${
              activeTool === 'place-object'
                ? 'border-violet-500 bg-violet-700 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <ChevronDown className="w-3 h-3" />
          </button>

          {openPopover === 'equipment' && (
            <div className="absolute left-0 top-full mt-1.5 w-88 bg-white dark:bg-[#14141B] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-3 z-50 space-y-2">
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    value={equipQuery}
                    onChange={(e) => setEquipQuery(e.target.value)}
                    placeholder="Search bioreactors, racks, HVAC, sensors..."
                    className="w-full h-7 pl-7 pr-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setOpenPopover('none')}
                  className="p-1 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {equipCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setEquipCategory(cat)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                      equipCategory === cat
                        ? 'bg-violet-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    {cat === 'all' ? 'All' : cat}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-0.5">
                {filteredObjects.slice(0, 48).map((obj) => (
                  <button
                    key={obj.id}
                    type="button"
                    onClick={() => {
                      setSelectedObjectTemplateId(obj.id);
                      setActiveTool('place-object');
                      setOpenPopover('none');
                    }}
                    className={`p-2 rounded-lg border text-left cursor-pointer transition-colors ${
                      selectedObjectTemplateId === obj.id
                        ? 'border-violet-500 bg-violet-500/12'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-violet-500/50 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: obj.defaultColor }} />
                      <span className="text-[11px] font-medium text-zinc-900 dark:text-zinc-100 truncate">{obj.name}</span>
                    </div>
                    <div className="text-[10px] text-zinc-400 font-mono tabular-nums mt-0.5">
                      {obj.width}×{obj.depth}×{obj.height}m
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* HVAC DESIGNER TOGGLE */}
        <button
          type="button"
          onClick={handleOpenHvacDesign}
          title="HVAC Overlay & Room AHU Controls"
          className={`h-8 px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
            showHvacOverlay
              ? 'border-cyan-500 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
              : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          <Wind className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden xl:inline">HVAC</span>
        </button>

        {/* LIGHTING & WALL SWITCH DESIGNER */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => togglePopover('lighting')}
            title="Room Lighting & Wall Switch Designer"
            className={`h-8 px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
              openPopover === 'lighting'
                ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="hidden xl:inline">Lights</span>
          </button>

          {openPopover === 'lighting' && (
            <div className="absolute right-0 xl:left-0 xl:right-auto top-full mt-1.5 w-[340px] sm:w-[360px] max-h-[70vh] overflow-y-auto bg-white dark:bg-[#14141B] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-3 z-50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500" /> Room Lighting &amp; Switch Designer
                </span>
                <button
                  type="button"
                  onClick={() => setOpenPopover('none')}
                  className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <LightingDesignerPanel compact />
            </div>
          )}
        </div>

        {/* TEXTURES & MATERIALS PAINTER */}
        <div className="relative flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTool('paint-material');
              setOpenPopover('none');
            }}
            title={`Paint Material: ${currentMaterial?.name ?? ''}`}
            className={`h-8 pl-2 pr-1.5 rounded-l-lg border-y border-l text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
              activeTool === 'paint-material'
                ? 'border-violet-500 bg-violet-600 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Paintbrush className="w-3.5 h-3.5 shrink-0" />
            <span
              className="w-2.5 h-2.5 rounded-xs border border-white/50 shrink-0"
              style={{ backgroundColor: currentMaterial?.baseColor ?? '#cbd5e1' }}
            />
            <span className="hidden 2xl:inline">Textures</span>
          </button>
          <button
            type="button"
            onClick={() => togglePopover('textures')}
            aria-label="Material Palette"
            className={`h-8 px-1 rounded-r-lg border text-[11px] flex items-center cursor-pointer transition-colors ${
              activeTool === 'paint-material'
                ? 'border-violet-500 bg-violet-700 text-white'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <ChevronDown className="w-3 h-3" />
          </button>

          {openPopover === 'textures' && (
            <div className="absolute right-0 xl:left-0 xl:right-auto top-full mt-1.5 w-80 bg-white dark:bg-[#14141B] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-3 z-50 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Surface Textures &amp; PBR</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => textureFileRef.current?.click()}
                    className="h-6 px-2 rounded bg-violet-500/12 text-violet-600 dark:text-violet-300 text-[10px] font-medium flex items-center gap-1 hover:bg-violet-500/20 cursor-pointer"
                  >
                    <Upload className="w-3 h-3" /> Upload
                  </button>
                  <input
                    ref={textureFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleUploadTexture}
                    className="hidden"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {materialCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setMatCategory(cat)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer ${
                      matCategory === cat
                        ? 'bg-violet-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-0.5">
                {filteredMaterials.map((mat) => (
                  <button
                    key={mat.id}
                    type="button"
                    onClick={() => {
                      setSelectedMaterialId(mat.id);
                      setActiveTool('paint-material');
                      setOpenPopover('none');
                    }}
                    className={`p-1.5 rounded-lg border text-left flex items-center gap-2 cursor-pointer transition-colors ${
                      selectedMaterialId === mat.id
                        ? 'border-violet-500 bg-violet-500/12'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <span
                      className="w-6 h-6 rounded border border-zinc-300 dark:border-zinc-700 shrink-0 bg-cover bg-center"
                      style={{
                        backgroundColor: mat.baseColor,
                        backgroundImage: mat.customTextureDataUrl ? `url(${mat.customTextureDataUrl})` : undefined,
                      }}
                    />
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-zinc-800 dark:text-zinc-100 truncate">{mat.name}</div>
                      <div className="text-[9px] text-zinc-400">{mat.pattern}</div>
                    </div>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setRightTab('materials');
                  setRightPanelOpen(true);
                  setOpenPopover('none');
                }}
                className="w-full h-7 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-[11px] font-medium text-violet-600 dark:text-violet-400 cursor-pointer"
              >
                Open Full PBR Material Tuner →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Snap & Grid Size, Units, Multi-Point Measure */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* SNAP & GRID SIZE POPOVER */}
        <div className="relative">
          <button
            type="button"
            onClick={() => togglePopover('snap')}
            className={`h-8 px-2.5 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
              snap.enabled
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-500'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span className="font-mono tabular-nums">{snap.gridSize}m</span>
            <span className="text-[10px] opacity-75 hidden lg:inline">
              {snap.enabled ? `· ${snap.angleStepDeg}°` : '· Off'}
            </span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {openPopover === 'snap' && (
            <div className="absolute right-0 top-full mt-1.5 w-76 bg-white dark:bg-[#14141B] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-3 z-50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Magnet className="w-3.5 h-3.5 text-emerald-500" /> Precision Grid &amp; Snapping
                </span>
                <button
                  type="button"
                  onClick={() => updateSnap({ enabled: !snap.enabled })}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${
                    snap.enabled ? 'bg-emerald-600 text-white' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {snap.enabled ? 'SNAP ON' : 'SNAP OFF'}
                </button>
              </div>

              {/* Grid size buttons */}
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Grid Cell Size
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {GRID_SIZES.map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => updateSnap({ gridSize: sz, enabled: true, snapToGrid: true })}
                      className={`h-7 rounded-lg text-[11px] font-mono tabular-nums cursor-pointer border transition-colors ${
                        snap.gridSize === sz
                          ? 'border-violet-500 bg-violet-600 text-white font-semibold'
                          : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-violet-500/50'
                      }`}
                    >
                      {sz}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Angle snap buttons */}
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Angle Snap Step
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {ANGLE_STEPS.map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() => updateSnap({ angleStepDeg: deg })}
                      className={`h-7 rounded-lg text-[11px] font-mono tabular-nums cursor-pointer border transition-colors ${
                        snap.angleStepDeg === deg
                          ? 'border-violet-500 bg-violet-600 text-white font-semibold'
                          : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-violet-500/50'
                      }`}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>

              {/* Individual snap targets */}
              <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-zinc-200 dark:border-zinc-800">
                {(
                  [
                    ['snapToGrid', 'Snap to Grid'],
                    ['snapToWall', 'Snap to Walls'],
                    ['snapToObject', 'Snap to Objects'],
                    ['snapToCenter', 'Snap to Center'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateSnap({ [key]: !snap[key] })}
                    className={`h-7 px-2 rounded-lg border text-[11px] font-medium flex items-center justify-between cursor-pointer ${
                      snap[key]
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-500'
                    }`}
                  >
                    <span>{label}</span>
                    {snap[key] && <Check className="w-3 h-3" />}
                  </button>
                ))}
              </div>

              {/* Grid visibility + opacity */}
              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <label className="flex items-center gap-1.5 cursor-pointer text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={snap.showGrid}
                      onChange={(e) => updateSnap({ showGrid: e.target.checked })}
                      className="accent-violet-600"
                    />
                    Show Viewport Grid
                  </label>
                  <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                    {Math.round(snap.gridOpacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  value={snap.gridOpacity}
                  onChange={(e) => updateSnap({ gridOpacity: Number(e.target.value) })}
                  className="w-full accent-violet-600"
                />
              </div>
            </div>
          )}
        </div>

        {/* UNIT SYSTEM TOGGLE */}
        <button
          type="button"
          onClick={() => setUnitSystem(unitSystem === 'metric' ? 'imperial' : 'metric')}
          title="Switch Measurement Units (Metric / Imperial)"
          className="h-8 px-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-[11px] font-mono font-semibold text-zinc-700 dark:text-zinc-200 hover:border-violet-500/50 whitespace-nowrap cursor-pointer"
        >
          {unitSystem === 'metric' ? 'm' : 'ft'}
        </button>

        {/* MULTI-POINT MEASURE TOOL */}
        <button
          type="button"
          onClick={() => {
            setActiveTool(activeTool === 'measure' ? 'select' : 'measure');
            setOpenPopover('none');
          }}
          title="Multi-Point Tape Measure & Area (M)"
          className={`h-8 px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
            activeTool === 'measure'
              ? 'border-amber-500 bg-amber-500 text-zinc-950 font-semibold'
              : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181820] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          <Ruler className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden xl:inline">Measure</span>
        </button>

        {measurePoints.length > 0 && (
          <div className="flex items-center gap-1.5 h-8 px-2 rounded-lg bg-amber-500/12 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-[11px] font-mono tabular-nums whitespace-nowrap">
            <span>{formatLength(measureStats.totalDist, unitSystem)}</span>
            {measureStats.area > 0.01 && (
              <span className="opacity-80">· {formatArea(measureStats.area, unitSystem)}</span>
            )}
            <button
              type="button"
              onClick={clearMeasure}
              title="Clear Measurement"
              className="p-0.5 rounded hover:bg-amber-500/20 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
