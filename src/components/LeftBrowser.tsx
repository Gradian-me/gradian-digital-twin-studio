import React, { useMemo, useRef, useState } from 'react';
import {
  Box,
  Building2,
  ChevronDown,
  ChevronRight,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  FileImage,
  Focus,
  FolderTree,
  Grid2X2,
  Layers,
  Link2,
  Lock,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { useTwinStore, type LeftPanelTab } from '../store/useTwinStore';
import { SPACE_CATEGORIES, SPACE_TYPE_LIBRARY } from '../data/spaceTypes';
import { EQUIPMENT_CATEGORIES, OBJECT_LIBRARY } from '../data/objectLibrary';
import { formatArea, formatLength } from '../utils/spatial';
import type { EquipmentCategory, SpaceCategory } from '../types/twin';

export const LeftBrowser: React.FC = () => {
  const scene = useTwinStore((s) => s.scene);
  const leftTab = useTwinStore((s) => s.leftTab);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const activeBuildingId = useTwinStore((s) => s.activeBuildingId);
  const selected = useTwinStore((s) => s.selected);
  const selectedSpaceTypeId = useTwinStore((s) => s.selectedSpaceTypeId);
  const selectedObjectTemplateId = useTwinStore((s) => s.selectedObjectTemplateId);
  const favoriteSpaceTypes = useTwinStore((s) => s.favoriteSpaceTypes);
  const favoriteObjects = useTwinStore((s) => s.favoriteObjects);
  const calibratingRefId = useTwinStore((s) => s.calibratingRefId);
  const calibrationPoints = useTwinStore((s) => s.calibrationPoints);

  const setLeftTab = useTwinStore((s) => s.setLeftTab);
  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const setActiveBuilding = useTwinStore((s) => s.setActiveBuilding);
  const setActiveTool = useTwinStore((s) => s.setActiveTool);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const setSelectedSpaceTypeId = useTwinStore((s) => s.setSelectedSpaceTypeId);
  const setSelectedObjectTemplateId = useTwinStore((s) => s.setSelectedObjectTemplateId);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const addFloor = useTwinStore((s) => s.addFloor);
  const addBuilding = useTwinStore((s) => s.addBuilding);
  const addRoom = useTwinStore((s) => s.addRoom);
  const addAsset = useTwinStore((s) => s.addAsset);
  const updateLayer = useTwinStore((s) => s.updateLayer);
  const addLayer = useTwinStore((s) => s.addLayer);
  const addReferencePlan = useTwinStore((s) => s.addReferencePlan);
  const updateReferencePlan = useTwinStore((s) => s.updateReferencePlan);
  const deleteReferencePlan = useTwinStore((s) => s.deleteReferencePlan);
  const startCalibratingRef = useTwinStore((s) => s.startCalibratingRef);
  const applyReferenceCalibration = useTwinStore((s) => s.applyReferenceCalibration);
  const cancelCalibration = useTwinStore((s) => s.cancelCalibration);
  const toggleFavorite = useTwinStore((s) => s.toggleFavorite);
  const addCustomSpaceType = useTwinStore((s) => s.addCustomSpaceType);
  const addCustomObjectTemplate = useTwinStore((s) => s.addCustomObjectTemplate);
  const drillInto = useTwinStore((s) => s.drillInto);
  const isolateLayerDirect = useTwinStore((s) => s.isolateLayerDirect);
  const activeLayerFocusId = useTwinStore((s) => s.activeLayerFocusId);
  const clearIsolation = useTwinStore((s) => s.clearIsolation);
  const buildDirectUrl = useTwinStore((s) => s.buildDirectUrl);
  const setShowModelsGallery = useTwinStore((s) => s.setShowModelsGallery);
  const showToast = useTwinStore((s) => s.showToast);

  const [search, setSearch] = useState('');
  const [spaceCat, setSpaceCat] = useState<'All' | 'Favorites' | SpaceCategory>('All');
  const [objCat, setObjCat] = useState<'All' | 'Favorites' | EquipmentCategory>('All');
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    'bldg-a': true,
    'bldg-b': true,
    'fl-a0': true,
  });

  // Quick Add Floor / Building forms
  const [showAddFloor, setShowAddFloor] = useState(false);
  const [newFloorName, setNewFloorName] = useState('Level 2 — Expansion Suite');
  const [newFloorHeight, setNewFloorHeight] = useState(3.8);
  const [dupFloorId, setDupFloorId] = useState('');
  const [newBldgName, setNewBldgName] = useState('');
  const [showAddBldg, setShowAddBldg] = useState(false);

  // Reference calibration input
  const [calibDistance, setCalibDistance] = useState('10');
  const refFileInput = useRef<HTMLInputElement | null>(null);

  // Custom space / object form
  const [showCustomSpace, setShowCustomSpace] = useState(false);
  const [customSpaceName, setCustomSpaceName] = useState('');
  const [showCustomObj, setShowCustomObj] = useState(false);
  const [customObjName, setCustomObjName] = useState('');

  // Custom Layer form
  const [newLayerName, setNewLayerName] = useState('');

  // Arrow-key navigation across Tree, Spaces, and Assets
  const [kbdNavId, setKbdNavId] = useState<string | null>(null);
  const navItemRefs = useRef<Map<string, HTMLElement>>(new Map());

  const allSpaceTypes = useMemo(
    () => [...scene.customSpaceTypes, ...SPACE_TYPE_LIBRARY],
    [scene.customSpaceTypes]
  );

  const filteredSpaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSpaceTypes.filter((s) => {
      if (spaceCat === 'Favorites' && !favoriteSpaceTypes.includes(s.id)) return false;
      if (spaceCat !== 'All' && spaceCat !== 'Favorites' && s.category !== spaceCat) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.environmental.cleanroomGrade.toLowerCase().includes(q)
      );
    });
  }, [allSpaceTypes, spaceCat, favoriteSpaceTypes, search]);

  const allObjects = useMemo(
    () => [...scene.customObjects, ...OBJECT_LIBRARY],
    [scene.customObjects]
  );

  const filteredObjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allObjects.filter((o) => {
      if (objCat === 'Favorites' && !favoriteObjects.includes(o.id)) return false;
      if (objCat !== 'All' && objCat !== 'Favorites' && o.category !== objCat) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        o.manufacturer.toLowerCase().includes(q) ||
        o.model.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q)
      );
    });
  }, [allObjects, objCat, favoriteObjects, search]);

  const handleUploadReference = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const fl = scene.floors.find((f) => f.id === activeFloorId);
      addReferencePlan({
        floorId: activeFloorId,
        name: file.name,
        layerCategory: 'reference-plan',
        dataUrl: String(reader.result),
        fileType: file.type || 'image/png',
        x: 0.5,
        z: 0.5,
        elevation: 0,
        width: fl ? fl.width - 1 : 28,
        depth: fl ? fl.depth - 1 : 18,
        rotationDeg: 0,
        opacity: 0.65,
        visible: true,
        locked: false,
        calibrated: false,
        layerId: 'layer-references',
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const tabs: { id: LeftPanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'hierarchy', label: 'Tree', icon: <FolderTree className="w-3.5 h-3.5" /> },
    { id: 'spaces', label: 'Spaces', icon: <Grid2X2 className="w-3.5 h-3.5" /> },
    { id: 'objects', label: 'Assets', icon: <Box className="w-3.5 h-3.5" /> },
    { id: 'layers', label: 'Layers', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'references', label: 'Plans', icon: <FileImage className="w-3.5 h-3.5" /> },
  ];

  const toggleExpand = (id: string) =>
    setExpandedNodes((prev) => ({ ...prev, [id]: !prev[id] }));

  // Build flat keyboard-navigable item list for the active LeftBrowser tab
  const navItems = useMemo<{ key: string; onSelect: () => void }[]>(() => {
    if (leftTab === 'spaces') {
      return filteredSpaces.map((sp) => ({
        key: `sp-${sp.id}`,
        onSelect: () => {
          setSelectedSpaceTypeId(sp.id);
          setActiveTool('draw-room');
        },
      }));
    }
    if (leftTab === 'objects') {
      return filteredObjects.map((obj) => ({
        key: `obj-${obj.id}`,
        onSelect: () => {
          setSelectedObjectTemplateId(obj.id);
          setActiveTool('place-object');
        },
      }));
    }
    if (leftTab === 'hierarchy') {
      const q = search.trim().toLowerCase();
      const out: { key: string; onSelect: () => void }[] = [];
      scene.buildings.forEach((bldg) => {
        out.push({ key: `b-${bldg.id}`, onSelect: () => drillInto('building', bldg.id) });
        if (expandedNodes[bldg.id] ?? true) {
          scene.floors
            .filter((f) => f.buildingId === bldg.id)
            .forEach((fl) => {
              out.push({ key: `fl-${fl.id}`, onSelect: () => drillInto('floor', fl.id) });
              if (expandedNodes[fl.id] ?? fl.id === activeFloorId) {
                const fRooms = scene.rooms.filter(
                  (r) =>
                    r.floorId === fl.id &&
                    (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
                );
                const fAssets = scene.assets.filter(
                  (a) =>
                    a.floorId === fl.id &&
                    (!q || a.name.toLowerCase().includes(q) || a.assetId.toLowerCase().includes(q))
                );
                fRooms.forEach((rm) => {
                  out.push({ key: `rm-${rm.id}`, onSelect: () => drillInto('room', rm.id) });
                  fAssets
                    .filter((a) => a.roomId === rm.id)
                    .forEach((a) => {
                      out.push({ key: `ast-${a.id}`, onSelect: () => drillInto('asset', a.id) });
                    });
                });
              }
            });
        }
      });
      return out;
    }
    return [];
  }, [
    leftTab,
    filteredSpaces,
    filteredObjects,
    scene.buildings,
    scene.floors,
    scene.rooms,
    scene.assets,
    expandedNodes,
    activeFloorId,
    search,
    drillInto,
    setSelectedSpaceTypeId,
    setSelectedObjectTemplateId,
    setActiveTool,
  ]);

  const handleSidebarKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const idx = tabs.findIndex((t) => t.id === leftTab);
      const next =
        e.key === 'ArrowRight'
          ? (idx + 1) % tabs.length
          : (idx - 1 + tabs.length) % tabs.length;
      setLeftTab(tabs[next].id);
      setSearch('');
      setKbdNavId(null);
      return;
    }
    if (navItems.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const curIdx = kbdNavId ? navItems.findIndex((n) => n.key === kbdNavId) : -1;
      const nextIdx =
        e.key === 'ArrowDown'
          ? Math.min(navItems.length - 1, curIdx + 1)
          : Math.max(0, curIdx <= 0 ? 0 : curIdx - 1);
      const next = navItems[nextIdx];
      if (next) {
        setKbdNavId(next.key);
        next.onSelect();
        requestAnimationFrame(() => {
          navItemRefs.current.get(next.key)?.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth',
          });
        });
      }
    } else if (e.key === 'Enter' && kbdNavId) {
      const item = navItems.find((n) => n.key === kbdNavId);
      if (item) {
        e.preventDefault();
        item.onSelect();
      }
    }
  };

  return (
    <aside
      tabIndex={0}
      onKeyDown={handleSidebarKeyDown}
      className="w-72 bg-white dark:bg-[#111114] border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-full shrink-0 select-none focus:outline-none"
    >
      {/* Tab Bar */}
      <div className="grid grid-cols-5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0D0D10]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setLeftTab(t.id);
              setSearch('');
            }}
            className={`py-2.5 flex flex-col items-center gap-1 text-[10px] font-medium border-b-2 transition-colors ${
              leftTab === t.id
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-[#111114]'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Search Bar (for Tree, Spaces, Objects) */}
      {(leftTab === 'hierarchy' || leftTab === 'spaces' || leftTab === 'objects') && (
        <div className="p-2.5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                leftTab === 'hierarchy'
                  ? 'Filter buildings, rooms, assets...'
                  : leftTab === 'spaces'
                    ? 'Search 60+ GMP space types...'
                    : 'Search bioreactors, HPLC, racks...'
              }
              className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-md bg-zinc-100 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-400 px-0.5">
            <span>↑ ↓ Arrow keys to navigate</span>
            <span className="font-mono">Alt+←/→ Tabs</span>
          </div>
        </div>
      )}

      {/* TAB 1: ENTERPRISE SPATIAL HIERARCHY */}
      {leftTab === 'hierarchy' && (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2 text-xs">
          {/* Enterprise Breadcrumb Root with Campus 3D Drill */}
          <div className="px-2.5 py-2 rounded-lg bg-zinc-50 dark:bg-[#161619] border border-zinc-200 dark:border-zinc-800 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-zinc-400 font-medium">Enterprise Spatial Root</span>
              <button
                onClick={() => drillInto('campus')}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-medium"
                title="View entire multi-building campus in 3D"
              >
                <Compass className="w-3 h-3" /> Campus 3D
              </button>
            </div>
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {scene.hierarchy.find((h) => h.level === 'site')?.name ?? scene.name}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
              {scene.buildings.length} Bldgs · {scene.floors.length} Floors · {scene.rooms.length} Rooms · {scene.assets.length} Assets
            </div>
          </div>

          {/* Quick Add Building / Floor */}
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowAddFloor((v) => !v)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C] font-medium"
            >
              <Plus className="w-3 h-3" /> Add Floor
            </button>
            <button
              onClick={() => setShowAddBldg((v) => !v)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C] font-medium"
            >
              <Building2 className="w-3 h-3" /> Add Bldg
            </button>
          </div>

          {showAddBldg && (
            <div className="p-2.5 rounded-md bg-slate-50 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700 space-y-2">
              <input
                value={newBldgName}
                onChange={(e) => setNewBldgName(e.target.value)}
                placeholder="Building C — Formulation Annex"
                className="w-full px-2 py-1 text-xs rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
              />
              <button
                onClick={() => {
                  addBuilding(newBldgName.trim() || `Building ${scene.buildings.length + 1}`);
                  setNewBldgName('');
                  setShowAddBldg(false);
                }}
                className="w-full py-1 rounded bg-violet-600 text-white font-medium"
              >
                Create Building
              </button>
            </div>
          )}

          {showAddFloor && (
            <div className="p-2.5 rounded-md bg-slate-50 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700 space-y-2">
              <input
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
                placeholder="Floor Name"
                className="w-full px-2 py-1 text-xs rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
              />
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-500">Height (m)</label>
                <input
                  type="number"
                  step={0.2}
                  value={newFloorHeight}
                  onChange={(e) => setNewFloorHeight(Number(e.target.value))}
                  className="w-16 px-1.5 py-1 text-xs rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700 font-mono"
                />
              </div>
              <select
                value={dupFloorId}
                onChange={(e) => setDupFloorId(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
              >
                <option value="">Blank floor slab</option>
                {scene.floors.map((fl) => (
                  <option key={fl.id} value={fl.id}>
                    Duplicate layout from {fl.code}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const baseFl = scene.floors.find((f) => f.buildingId === activeBuildingId);
                  addFloor({
                    buildingId: activeBuildingId,
                    name: newFloorName.trim() || 'New Floor',
                    height: newFloorHeight,
                    width: baseFl?.width ?? 34,
                    depth: baseFl?.depth ?? 22,
                    duplicateFromFloorId: dupFloorId || undefined,
                  });
                  setShowAddFloor(false);
                }}
                className="w-full py-1 rounded bg-violet-600 text-white font-medium"
              >
                Stack Floor
              </button>
            </div>
          )}

          {/* Building → Floor → Room → Asset Tree */}
          <div className="space-y-1">
            {scene.buildings.map((bldg) => {
              const bExpanded = expandedNodes[bldg.id] ?? true;
              const bFloors = scene.floors.filter((f) => f.buildingId === bldg.id);
              return (
                <div key={bldg.id}>
                  <div
                    onClick={() => {
                      toggleExpand(bldg.id);
                      setActiveBuilding(bldg.id);
                    }}
                    className={`group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-md cursor-pointer ${
                      activeBuildingId === bldg.id
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {bExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                      <Building2 className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{bldg.name}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        drillInto('building', bldg.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded bg-zinc-200/80 dark:bg-zinc-800 text-[10px] font-medium hover:text-emerald-400 shrink-0"
                      title="Drill 3D into Building"
                    >
                      3D
                    </button>
                  </div>

                  {bExpanded && (
                    <div className="ml-3 pl-2 border-l border-zinc-200 dark:border-zinc-800 space-y-1 mt-1">
                      {bFloors.map((fl) => {
                        const fExpanded = expandedNodes[fl.id] ?? fl.id === activeFloorId;
                        const q = search.trim().toLowerCase();
                        const fRooms = scene.rooms.filter(
                          (r) =>
                            r.floorId === fl.id &&
                            (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
                        );
                        const fAssets = scene.assets.filter(
                          (a) =>
                            a.floorId === fl.id &&
                            (!q || a.name.toLowerCase().includes(q) || a.assetId.toLowerCase().includes(q))
                        );

                        return (
                          <div key={fl.id}>
                            <div
                              onClick={() => {
                                toggleExpand(fl.id);
                                drillInto('floor', fl.id);
                              }}
                              className={`flex items-center justify-between gap-1 px-2 py-1 rounded cursor-pointer ${
                                activeFloorId === fl.id
                                  ? 'bg-zinc-100 dark:bg-[#1C1C21] font-semibold text-zinc-900 dark:text-white'
                                  : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                              }`}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                {fExpanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                                <span className="truncate">{fl.code} · {fl.name}</span>
                              </div>
                              <span className="font-mono text-[10px] text-zinc-400 shrink-0">
                                +{fl.elevation.toFixed(1)}m
                              </span>
                            </div>

                            {fExpanded && (
                              <div className="ml-3 pl-2 border-l border-zinc-200 dark:border-zinc-800 space-y-0.5 mt-0.5">
                                {fRooms.map((rm) => {
                                  const isSel = selected.some((s) => s.type === 'room' && s.id === rm.id);
                                  const rmAssets = fAssets.filter((a) => a.roomId === rm.id);
                                  return (
                                    <div key={rm.id}>
                                      <button
                                        ref={(el) => {
                                          if (el) navItemRefs.current.set(`rm-${rm.id}`, el);
                                          else navItemRefs.current.delete(`rm-${rm.id}`);
                                        }}
                                        onClick={() => {
                                          setKbdNavId(`rm-${rm.id}`);
                                          drillInto('room', rm.id);
                                        }}
                                        className={`w-full text-left flex items-center justify-between gap-1 px-2 py-1 rounded text-[11px] ${
                                          isSel || kbdNavId === `rm-${rm.id}`
                                            ? 'bg-violet-600 text-white'
                                            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                        }`}
                                      >
                                        <span className="truncate">{rm.name}</span>
                                        <span className={`font-mono text-[10px] shrink-0 ${isSel || kbdNavId === `rm-${rm.id}` ? 'text-violet-100' : 'text-zinc-400'}`}>
                                          {formatArea(rm.width * rm.depth, scene.unitSystem)}
                                        </span>
                                      </button>
                                      {rmAssets.length > 0 && (
                                        <div className="ml-3 space-y-0.5">
                                          {rmAssets.map((a) => {
                                            const aSel = selected.some((s) => s.type === 'asset' && s.id === a.id);
                                            return (
                                              <button
                                                key={a.id}
                                                ref={(el) => {
                                                  if (el) navItemRefs.current.set(`ast-${a.id}`, el);
                                                  else navItemRefs.current.delete(`ast-${a.id}`);
                                                }}
                                                onClick={() => {
                                                  setKbdNavId(`ast-${a.id}`);
                                                  drillInto('asset', a.id);
                                                }}
                                                className={`w-full text-left flex items-center justify-between gap-1 px-2 py-0.5 rounded text-[11px] ${
                                                  aSel || kbdNavId === `ast-${a.id}`
                                                    ? 'bg-violet-500/20 text-violet-600 dark:text-violet-300 font-medium'
                                                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                                }`}
                                              >
                                                <span className="truncate">{a.name}</span>
                                                <span className="font-mono text-[10px] shrink-0">{a.assetId}</span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: SPACE TYPE LIBRARY */}
      {leftTab === 'spaces' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-2.5 py-2 border-b border-slate-200 dark:border-zinc-800 flex items-center gap-1.5">
            <select
              value={spaceCat}
              onChange={(e) => setSpaceCat(e.target.value as any)}
              className="flex-1 px-2 py-1 text-xs rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
            >
              <option value="All">All Categories ({allSpaceTypes.length})</option>
              <option value="Favorites">Favorites ({favoriteSpaceTypes.length})</option>
              {SPACE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={() => setShowCustomSpace((v) => !v)}
              className="p-1.5 rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C]"
              title="Save Custom Space Template"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {showCustomSpace && (
            <div className="p-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#14141A] space-y-2 text-xs">
              <input
                value={customSpaceName}
                onChange={(e) => setCustomSpaceName(e.target.value)}
                placeholder="Custom space type name..."
                className="w-full px-2 py-1 rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
              />
              <button
                onClick={() => {
                  if (!customSpaceName.trim()) return;
                  const base = SPACE_TYPE_LIBRARY[0];
                  addCustomSpaceType({
                    ...base,
                    id: `st-custom-${Date.now()}`,
                    name: customSpaceName.trim(),
                    isCustom: true,
                  });
                  setCustomSpaceName('');
                  setShowCustomSpace(false);
                }}
                className="w-full py-1 rounded bg-violet-600 text-white font-medium"
              >
                Save Space Template
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {filteredSpaces.map((sp) => {
              const active = selectedSpaceTypeId === sp.id;
              const isFav = favoriteSpaceTypes.includes(sp.id);
              return (
                <div
                  key={sp.id}
                  ref={(el) => {
                    if (el) navItemRefs.current.set(`sp-${sp.id}`, el);
                    else navItemRefs.current.delete(`sp-${sp.id}`);
                  }}
                  className={`p-2.5 rounded-lg border transition-colors ${
                    active || kbdNavId === `sp-${sp.id}`
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => {
                        setSelectedSpaceTypeId(sp.id);
                        setActiveTool('draw-room');
                        setViewMode('split');
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: sp.color }}
                        />
                        <span className="text-xs font-medium text-slate-900 dark:text-white truncate">
                          {sp.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                        {sp.environmental.cleanroomGrade} · {sp.environmental.pressurePa >= 0 ? `+${sp.environmental.pressurePa}` : sp.environmental.pressurePa} Pa · {sp.defaultWidth}×{sp.defaultDepth}m
                      </div>
                    </div>
                    <button
                      onClick={() => toggleFavorite('space', sp.id)}
                      className={`p-1 rounded ${isFav ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <button
                      onClick={() => {
                        setSelectedSpaceTypeId(sp.id);
                        setActiveTool('draw-room');
                        setViewMode('split');
                      }}
                      className="flex-1 py-1 text-[11px] font-medium rounded bg-slate-100 dark:bg-[#1C1C24] hover:bg-violet-600 hover:text-white transition-colors"
                    >
                      Draw in 2D
                    </button>
                    <button
                      onClick={() => {
                        addRoom(2, 2, sp.defaultWidth, sp.defaultDepth, sp.id, sp.name);
                      }}
                      className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C]"
                      title="Insert room with default dimensions"
                    >
                      Quick Add
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: SEARCHABLE 3D OBJECT LIBRARY */}
      {leftTab === 'objects' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-2.5 py-2 border-b border-slate-200 dark:border-zinc-800 flex items-center gap-1.5">
            <select
              value={objCat}
              onChange={(e) => setObjCat(e.target.value as any)}
              className="flex-1 px-2 py-1 text-xs rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
            >
              <option value="All">All Equipment ({allObjects.length})</option>
              <option value="Favorites">Favorites ({favoriteObjects.length})</option>
              {EQUIPMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={() => setShowCustomObj((v) => !v)}
              className="p-1.5 rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C]"
              title="Save Custom Equipment Template"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {showCustomObj && (
            <div className="p-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#14141A] space-y-2 text-xs">
              <input
                value={customObjName}
                onChange={(e) => setCustomObjName(e.target.value)}
                placeholder="Custom equipment name..."
                className="w-full px-2 py-1 rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
              />
              <button
                onClick={() => {
                  if (!customObjName.trim()) return;
                  const base = OBJECT_LIBRARY[0];
                  addCustomObjectTemplate({
                    ...base,
                    id: `eq-custom-${Date.now()}`,
                    name: customObjName.trim(),
                    manufacturer: 'Custom Template',
                    isCustom: true,
                  });
                  setCustomObjName('');
                  setShowCustomObj(false);
                }}
                className="w-full py-1 rounded bg-violet-600 text-white font-medium"
              >
                Save Object Template
              </button>
            </div>
          )}

          <div className="px-2.5 py-2 border-b border-zinc-200 dark:border-zinc-800 space-y-1.5">
            <button
              onClick={() => setShowModelsGallery(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Open 3D Models Gallery ({allObjects.length})
            </button>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Drag any item onto the 2D or 3D canvas, or inspect in 3D Gallery.
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {filteredObjects.map((obj) => {
              const active = selectedObjectTemplateId === obj.id;
              const isFav = favoriteObjects.includes(obj.id);
              return (
                <div
                  key={obj.id}
                  ref={(el) => {
                    if (el) navItemRefs.current.set(`obj-${obj.id}`, el);
                    else navItemRefs.current.delete(`obj-${obj.id}`);
                  }}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-gradian-object', obj.id);
                    setSelectedObjectTemplateId(obj.id);
                  }}
                  className={`p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
                    active || kbdNavId === `obj-${obj.id}`
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                        {obj.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {obj.manufacturer} · {obj.model}
                      </div>
                      <div className="text-[10px] font-mono tabular-nums text-slate-400 mt-0.5">
                        {formatLength(obj.width, scene.unitSystem, 1)} × {formatLength(obj.depth, scene.unitSystem, 1)} × {formatLength(obj.height, scene.unitSystem, 1)} · {obj.energyKw} kW
                      </div>
                    </div>
                    <button
                      onClick={() => toggleFavorite('object', obj.id)}
                      className={`p-1 rounded ${isFav ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <button
                      onClick={() => {
                        setSelectedObjectTemplateId(obj.id);
                        setActiveTool('place-object');
                      }}
                      className="flex-1 py-1 text-[11px] font-medium rounded bg-slate-100 dark:bg-[#1C1C24] hover:bg-violet-600 hover:text-white transition-colors"
                    >
                      Click to Place
                    </button>
                    <button
                      onClick={() => {
                        const fl = scene.floors.find((f) => f.id === activeFloorId);
                        addAsset(obj.id, (fl?.width ?? 20) / 2, (fl?.depth ?? 14) / 2);
                      }}
                      className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C]"
                    >
                      Drop Center
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: LAYER MANAGER WITH DIRECT URL & ISOLATION */}
      {leftTab === 'layers' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-2.5 border-b border-zinc-200 dark:border-zinc-800 space-y-2">
            <div className="flex gap-1.5">
              <input
                value={newLayerName}
                onChange={(e) => setNewLayerName(e.target.value)}
                placeholder="New layer name..."
                className="flex-1 px-2 py-1 text-xs rounded bg-zinc-100 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-700"
              />
              <button
                onClick={() => {
                  if (!newLayerName.trim()) return;
                  addLayer(newLayerName.trim(), 'MEP & Process', '#0EA5E9');
                  setNewLayerName('');
                }}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
              >
                Add
              </button>
            </div>
            {activeLayerFocusId && (
              <button
                onClick={() => {
                  scene.layers.forEach((l) => updateLayer(l.id, { visible: true }));
                  clearIsolation();
                }}
                className="w-full py-1 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
              >
                Show All Layers (Clear Layer Focus)
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {scene.layers.map((layer) => {
              const isFocused = activeLayerFocusId === layer.id;
              return (
                <div
                  key={layer.id}
                  className={`p-2 rounded-lg border space-y-1.5 transition-colors ${
                    isFocused
                      ? 'border-emerald-500 bg-emerald-500/5'
                      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#161619]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: layer.color }} />
                      <span className="text-xs font-medium truncate">{layer.name}</span>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => isolateLayerDirect(layer.id)}
                        className={`p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                          isFocused ? 'text-emerald-500' : 'text-zinc-400 hover:text-emerald-400'
                        }`}
                        title="Isolate / Focus this Layer"
                      >
                        <Focus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          const url = buildDirectUrl({ layerId: layer.id });
                          navigator.clipboard?.writeText(url).catch(() => {});
                          showToast(`Copied direct URL for layer "${layer.name}"`, 'success');
                        }}
                        className="p-1 rounded text-zinc-400 hover:text-cyan-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        title="Copy Direct URL to this Layer"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                        className={`p-1 rounded ${layer.visible ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-400'}`}
                        title="Toggle Visibility"
                      >
                        {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                        className={`p-1 rounded ${layer.locked ? 'text-amber-500' : 'text-zinc-400'}`}
                        title="Toggle Lock"
                      >
                        {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-zinc-400">
                    <span>{layer.group}</span>
                    <span className="font-mono">{Math.round(layer.opacity * 100)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 5: REFERENCE PLANS & 2-POINT SCALE CALIBRATION */}
      {leftTab === 'references' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-2.5 border-b border-slate-200 dark:border-zinc-800 space-y-2">
            <button
              onClick={() => refFileInput.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium"
            >
              <Upload className="w-3.5 h-3.5" /> Import Blueprint (PNG/JPG/SVG)
            </button>
            <input
              ref={refFileInput}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={handleUploadReference}
            />
          </div>

          {calibratingRefId && (
            <div className="p-3 border-b border-indigo-500/30 bg-indigo-500/10 space-y-2 text-xs">
              <div className="font-semibold text-indigo-600 dark:text-indigo-300">
                2-Point Scale Calibration ({calibrationPoints.length}/2 pts)
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                Click two points with a known real-world span on the 2D floor plan, then enter the true distance below.
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={calibDistance}
                  onChange={(e) => setCalibDistance(e.target.value)}
                  className="w-20 px-2 py-1 rounded bg-white dark:bg-[#14141A] border border-slate-300 dark:border-zinc-700 font-mono"
                />
                <span className="text-slate-500">meters</span>
              </div>
              <div className="flex gap-1.5">
                <button
                  disabled={calibrationPoints.length < 2}
                  onClick={() => applyReferenceCalibration(Number(calibDistance))}
                  className="flex-1 py-1 rounded bg-indigo-600 text-white font-medium disabled:opacity-40"
                >
                  Apply Scale
                </button>
                <button
                  onClick={cancelCalibration}
                  className="px-2.5 py-1 rounded border border-slate-300 dark:border-zinc-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {scene.references.filter((r) => r.floorId === activeFloorId).length === 0 ? (
              <div className="text-center py-8 px-3 text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <FileImage className="w-7 h-7 mx-auto text-slate-400" />
                <p>No reference floor plans on this level yet.</p>
                <p className="text-[11px]">
                  Import an architectural drawing to overlay, calibrate with two known points, and trace walls &amp; rooms directly over it.
                </p>
              </div>
            ) : (
              scene.references
                .filter((r) => r.floorId === activeFloorId)
                .map((refPlan) => (
                  <div
                    key={refPlan.id}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-zinc-800 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{refPlan.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateReferencePlan(refPlan.id, { visible: !refPlan.visible })}
                          className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        >
                          {refPlan.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => deleteReferencePlan(refPlan.id)}
                          className="p-1 text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span>Opacity</span>
                        <span className="font-mono">{Math.round(refPlan.opacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={refPlan.opacity}
                        onChange={(e) => updateReferencePlan(refPlan.id, { opacity: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>{refPlan.width}×{refPlan.depth} m</span>
                      <span>{refPlan.calibrated ? 'Calibrated' : 'Uncalibrated'}</span>
                    </div>
                    <button
                      onClick={() => startCalibratingRef(refPlan.id)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-slate-100 dark:bg-[#1C1C24] hover:bg-indigo-600 hover:text-white font-medium transition-colors"
                    >
                      <Crosshair className="w-3.5 h-3.5" /> 2-Point Scale Calibration
                    </button>
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
