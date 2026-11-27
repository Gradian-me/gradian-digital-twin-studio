import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AppWindow,
  ArrowLeft,
  Box,
  CalendarClock,
  Camera,
  ChevronDown,
  CloudUpload,
  Columns2,
  DoorOpen,
  Download,
  Droplets,
  FileText,
  Flame,
  Footprints,
  Gauge,
  Glasses,
  Grid3X3,
  History,
  Layers,
  LayoutGrid,
  Magnet,
  Maximize2,
  Minimize2,
  Moon,
  MoreHorizontal,
  MousePointer2,
  Move,
  PaintBucket,
  PenTool,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  Save,
  Scale,
  ScanText,
  Scissors,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Thermometer,
  Timer,
  Undo2,
  BookOpen,
  Calendar,
  ClipboardCheck,
  GitBranch,
  Map as MapIcon,
  QrCode,
  Shield,
  TrendingDown,
  Eye,
  Lock,
  Pencil,
  Wand2,
  Waypoints,
  Workflow,
  Wrench,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useGmpStore } from '../store/useGmpStore';
import { useRiskIncidentStore } from '../store/useRiskIncidentStore';
import { useAclStore, computeEffectivePermissions, getActiveAclUser } from '../store/useAclStore';
import { useAuth } from '../context/AuthContext';
import { UserAvatarMenu } from './UserAvatarMenu';
import type { OrthoPreset, ToolMode } from '../types/twin';

export const TopToolbar: React.FC = () => {
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const activeBuildingId = useTwinStore((s) => s.activeBuildingId);
  const drillLevel = useTwinStore((s) => s.drillLevel);
  const showAllFloors = useTwinStore((s) => s.showAllFloors);
  const workspaceMode = useTwinStore((s) => s.workspaceMode);
  const viewMode = useTwinStore((s) => s.viewMode);
  const orthoPreset = useTwinStore((s) => s.orthoPreset);
  const activeTool = useTwinStore((s) => s.activeTool);
  const transformMode = useTwinStore((s) => s.transformMode);
  const snap = useTwinStore((s) => s.snap);
  const past = useTwinStore((s) => s.past);
  const future = useTwinStore((s) => s.future);
  const theme = useTwinStore((s) => s.theme);
  const sectionCutEnabled = useTwinStore((s) => s.sectionCutEnabled);
  const sectionCutHeight = useTwinStore((s) => s.sectionCutHeight);
  const sectionCutAxis = useTwinStore((s) => s.sectionCutAxis);
  const sectionCutFlipped = useTwinStore((s) => s.sectionCutFlipped);
  const explodedFactor = useTwinStore((s) => s.explodedFactor);
  const firstPersonMode = useTwinStore((s) => s.firstPersonMode);
  const vrSessionActive = useTwinStore((s) => s.vrSessionActive);
  const lightingMode = useTwinStore((s) => s.lightingMode);
  const showNavMesh = useTwinStore((s) => s.showNavMesh);
  const animateFlows = useTwinStore((s) => s.animateFlows);
  const showFlowLegend = useTwinStore((s) => s.showFlowLegend);
  const validationIssues = useTwinStore((s) => s.validationIssues);
  const autoSaveEnabled = useTwinStore((s) => s.autoSaveEnabled);
  const autoSaveSecondsLeft = useTwinStore((s) => s.autoSaveSecondsLeft);
  const auditLog = useTwinStore((s) => s.auditLog);
  const canvasMaximized = useTwinStore((s) => s.canvasMaximized);
  const showMayaChat = useTwinStore((s) => s.showMayaChat);

  const setScreen = useTwinStore((s) => s.setScreen);
  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const setShowAllFloors = useTwinStore((s) => s.setShowAllFloors);
  const drillInto = useTwinStore((s) => s.drillInto);
  const setWorkspaceMode = useTwinStore((s) => s.setWorkspaceMode);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const setOrthoPreset = useTwinStore((s) => s.setOrthoPreset);
  const setActiveTool = useTwinStore((s) => s.setActiveTool);
  const setTransformMode = useTwinStore((s) => s.setTransformMode);
  const updateSnap = useTwinStore((s) => s.updateSnap);
  const undo = useTwinStore((s) => s.undo);
  const redo = useTwinStore((s) => s.redo);
  const toggleTheme = useTwinStore((s) => s.toggleTheme);
  const setUnitSystem = useTwinStore((s) => s.setUnitSystem);
  const setSectionCut = useTwinStore((s) => s.setSectionCut);
  const resetSectionCut = useTwinStore((s) => s.resetSectionCut);
  const setExplodedFactor = useTwinStore((s) => s.setExplodedFactor);
  const setFirstPersonMode = useTwinStore((s) => s.setFirstPersonMode);
  const requestVrToggle = useTwinStore((s) => s.requestVrToggle);
  const toggleLightingMode = useTwinStore((s) => s.toggleLightingMode);
  const setShowNavMesh = useTwinStore((s) => s.setShowNavMesh);
  const setAnimateFlows = useTwinStore((s) => s.setAnimateFlows);
  const setShowFlowLegend = useTwinStore((s) => s.setShowFlowLegend);
  const toggleMaximizeCanvas = useTwinStore((s) => s.toggleMaximizeCanvas);
  const setShowExportModal = useTwinStore((s) => s.setShowExportModal);
  const setShowXRModal = useTwinStore((s) => s.setShowXRModal);
  const setShowAIPlannerModal = useTwinStore((s) => s.setShowAIPlannerModal);
  const setShowCadOcrModal = useTwinStore((s) => s.setShowCadOcrModal);
  const setShowModelsGallery = useTwinStore((s) => s.setShowModelsGallery);
  const setShowQuickSearch = useTwinStore((s) => s.setShowQuickSearch);
  const setShowMayaChat = useTwinStore((s) => s.setShowMayaChat);
  const setShowCameraManager = useTwinStore((s) => s.setShowCameraManager);
  const openRackDesigner = useTwinStore((s) => s.openRackDesigner);
  const setShowSaveValidationModal = useTwinStore((s) => s.setShowSaveValidationModal);
  const setAutoSaveEnabled = useTwinStore((s) => s.setAutoSaveEnabled);
  const setShowAuditTrailModal = useTwinStore((s) => s.setShowAuditTrailModal);
  const refreshValidation = useTwinStore((s) => s.refreshValidation);
  const setRightTab = useTwinStore((s) => s.setRightTab);
  const setLeftTab = useTwinStore((s) => s.setLeftTab);
  const saveProjectToLocal = useTwinStore((s) => s.saveProjectToLocal);
  const createSnapshot = useTwinStore((s) => s.createSnapshot);
  const showToast = useTwinStore((s) => s.showToast);

  const heatmapMetric = useTelemetryStore((s) => s.heatmapMetric);
  const setHeatmapMetric = useTelemetryStore((s) => s.setHeatmapMetric);
  const openDashboard = useTelemetryStore((s) => s.openDashboard);
  const readings = useTelemetryStore((s) => s.readings);

  const activeAlarmCount = Object.values(readings).filter((r) => r.status === 'alarm').length;
  const openGmpModal = useGmpStore((s) => s.openGmpModal);
  const openQrLabelModal = useGmpStore((s) => s.openQrLabelModal);
  const openResourceSchedulingModal = useGmpStore((s) => s.openResourceSchedulingModal);
  const heldSchedulesCount = useGmpStore(
    (s) => s.resourceAssignments.filter((a) => a.status === 'telemetry-hold').length
  );
  const showMiniMap = useGmpStore((s) => s.showMiniMap);
  const setShowMiniMap = useGmpStore((s) => s.setShowMiniMap);
  const overdueWorkOrders = useGmpStore((s) => s.workOrders.filter((w) => w.status === 'overdue').length);
  const selected = useTwinStore((s) => s.selected);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);
  const openAssetPdfModal = useRiskIncidentStore((s) => s.openAssetPdfModal);
  const openRiskCount = useRiskIncidentStore(
    (s) => s.incidents.filter((i) => i.status === 'open' || i.status === 'investigating').length
  );
  const openAclModal = useAclStore((s) => s.openAclModal);
  const aclUsers = useAclStore((s) => s.users);
  const aclRoles = useAclStore((s) => s.roles);
  const aclGroups = useAclStore((s) => s.groups);
  const activeAclUserId = useAclStore((s) => s.activeAclUserId);
  const aclCanEdit = (() => {
    const activeUser = getActiveAclUser({ users: aclUsers, activeAclUserId });
    if (!activeUser) return true;
    if (activeUser.status === 'suspended') return false;
    return computeEffectivePermissions(activeUser, aclRoles, aclGroups).includes('spatial.edit');
  })();
  const isReadOnly = workspaceMode === 'view' || !aclCanEdit;

  const { user, signInWithGoogle, getIdToken } = useAuth();
  const [savingCloud, setSavingCloud] = useState(false);

  // Clean Hover/Click Popovers (replaces cluttered always-visible toolbars)
  const [openMenu, setOpenMenu] = useState<'none' | 'tools' | 'ortho' | 'inspect' | 'more'>('none');
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setOpenMenu('none');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const activeFloor = scene.floors.find((f) => f.id === activeFloorId);

  const handleCloudSave = async () => {
    saveProjectToLocal();
    if (!user) {
      showToast('Saved locally. Sign in with Google to synchronize to cloud.', 'info');
      return;
    }
    setSavingCloud(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Missing auth token');
      const res = await fetch(`/api/projects/${encodeURIComponent(scene.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: scene.name,
          code: scene.code,
          description: scene.description,
          industry: scene.industry,
          unitSystem: scene.unitSystem,
          revision: scene.revision,
          sceneData: scene,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      showToast('Synchronized project to Cloud Workspace', 'success');
    } catch {
      showToast('Saved locally. Cloud sync will retry when available.', 'warning');
    } finally {
      setSavingCloud(false);
    }
  };

  const handleQuickSnapshot = async () => {
    const label = `Revision ${scene.revision}.${useTwinStore.getState().snapshots.length + 1}`;
    const snapObj = createSnapshot(label);
    if (user) {
      try {
        const token = await getIdToken();
        if (token) {
          await fetch(`/api/projects/${encodeURIComponent(scene.id)}/snapshots`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              id: snapObj.id,
              versionTag: snapObj.versionTag,
              label: snapObj.label,
              summary: snapObj.summary,
              sceneData: snapObj.sceneData,
            }),
          });
        }
      } catch {
        // local snapshot already created
      }
    }
  };

  const tools: { id: ToolMode; label: string; icon: React.ReactNode; shortcut: string; onPick?: () => void }[] = [
    { id: 'select', label: 'Select', icon: <MousePointer2 className="w-3.5 h-3.5" />, shortcut: 'V' },
    {
      id: 'draw-room',
      label: 'Room',
      icon: <Square className="w-3.5 h-3.5" />,
      shortcut: 'R',
      onPick: () => {
        setLeftTab('spaces');
        if (viewMode === '3d-perspective' || viewMode === '3d-ortho') setViewMode('split');
      },
    },
    {
      id: 'draw-wall',
      label: 'Wall',
      icon: <PenTool className="w-3.5 h-3.5" />,
      shortcut: 'W',
      onPick: () => {
        if (viewMode === '3d-perspective' || viewMode === '3d-ortho') setViewMode('split');
      },
    },
    { id: 'place-door', label: 'Door', icon: <DoorOpen className="w-3.5 h-3.5" />, shortcut: 'D' },
    { id: 'place-window', label: 'Window', icon: <AppWindow className="w-3.5 h-3.5" />, shortcut: 'N' },
    {
      id: 'place-object',
      label: 'Equipment',
      icon: <Box className="w-3.5 h-3.5" />,
      shortcut: 'E',
      onPick: () => setLeftTab('objects'),
    },
    {
      id: 'paint-material',
      label: 'Paint',
      icon: <PaintBucket className="w-3.5 h-3.5" />,
      shortcut: 'B',
      onPick: () => setRightTab('materials'),
    },
    {
      id: 'draw-flow',
      label: 'Flow Route',
      icon: <Waypoints className="w-3.5 h-3.5" />,
      shortcut: 'F',
      onPick: () => {
        setRightTab('flows');
        if (viewMode === '3d-perspective' || viewMode === '3d-ortho') setViewMode('split');
      },
    },
    { id: 'place-camera', label: 'Camera', icon: <Camera className="w-3.5 h-3.5" />, shortcut: 'C' },
    { id: 'measure', label: 'Measure', icon: <Ruler className="w-3.5 h-3.5" />, shortcut: 'M' },
  ];

  const currentToolMeta = tools.find((t) => t.id === activeTool) ?? tools[0];
  const orthoOptions: OrthoPreset[] = ['isometric', 'top', 'front', 'back', 'left', 'right', 'bottom'];

  return (
    <header
      ref={headerRef}
      className="h-14 bg-white dark:bg-[#121216] border-b border-zinc-200 dark:border-zinc-800/90 px-3 lg:px-4 flex items-center justify-between gap-2 shrink-0 z-30"
    >
      {/* ZONE 1 (Left): Back to Hub + Active Floor + Ctrl+K Search + Undo/Redo */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={() => setScreen('hub')}
          className="flex items-center gap-1.5 h-9 px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] text-zinc-700 dark:text-zinc-200 hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-300 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          title="Back to Executive Overview Hub"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Overview</span>
        </button>

        <select
          aria-label="Active Floor or Campus View"
          value={
            drillLevel === 'campus'
              ? '__SITE__'
              : showAllFloors
                ? '__ALL_FLOORS__'
                : activeFloorId
          }
          onChange={(e) => {
            const val = e.target.value;
            if (val === '__SITE__') {
              drillInto('campus');
            } else if (val === '__ALL_FLOORS__') {
              drillInto('building', activeBuildingId);
              setShowAllFloors(true);
            } else {
              setShowAllFloors(false);
              setActiveFloor(val);
            }
          }}
          className="h-9 px-2.5 text-xs font-medium rounded-xl bg-zinc-100 dark:bg-[#18181F] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 max-w-[148px] lg:max-w-[192px] truncate focus:outline-none focus:border-violet-500"
        >
          <option value="__SITE__">All Buildings (Site)</option>
          <option value="__ALL_FLOORS__">All Floors (Building)</option>
          {scene.floors.map((fl) => (
            <option key={fl.id} value={fl.id}>
              {fl.code} — {fl.name}
            </option>
          ))}
        </select>

        {/* Global Ctrl+K Search Trigger */}
        <button
          onClick={() => setShowQuickSearch(true)}
          className="flex items-center gap-2 h-9 px-3 rounded-xl bg-zinc-100 dark:bg-[#18181F] border border-zinc-200 dark:border-zinc-800 hover:border-violet-500/70 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
          title="Command & Direct Search (Ctrl+K)"
        >
          <Search className="w-3.5 h-3.5 text-violet-500" />
          <span className="hidden lg:inline">Search...</span>
          <kbd className="hidden sm:inline px-1.5 py-0.5 text-[10px] font-mono rounded-md bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700 text-zinc-500">
            ⌘K
          </kbd>
        </button>

        {/* Compact Undo / Redo */}
        <div className="hidden xl:flex items-center gap-0.5 pl-1 border-l border-zinc-200 dark:border-zinc-800 shrink-0">
          <button
            onClick={undo}
            disabled={past.length === 0}
            className="p-2 rounded-xl text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={future.length === 0}
            className="p-2 rounded-xl text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ZONE 2 (Center): Design/View Lock + View Mode Switcher + CAD Tools & 3D/Heatmap Popovers */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Strict Design / View Mode Segmented Switcher */}
        <div
          className="flex items-center bg-zinc-100 dark:bg-[#18181F] p-1 rounded-xl border border-zinc-200 dark:border-zinc-800"
          title={
            !aclCanEdit
              ? 'ACL Read-Only — active role lacks spatial edit permission'
              : 'Switch between Design Mode (editable) and View Mode (strict read-only)'
          }
        >
          <button
            onClick={() => {
              if (!aclCanEdit) {
                showToast('ACL Read-Only: active user role cannot enter Design Mode.', 'warning');
                return;
              }
              setWorkspaceMode('design');
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
              !isReadOnly
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
            } ${!aclCanEdit ? 'opacity-45 cursor-not-allowed' : ''}`}
          >
            <Pencil className="w-3 h-3" />
            <span className="hidden xl:inline">Design</span>
          </button>
          <button
            onClick={() => setWorkspaceMode('view')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
              isReadOnly
                ? 'bg-amber-500 text-zinc-950 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            {!aclCanEdit ? <Lock className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span className="hidden xl:inline">{!aclCanEdit ? 'ACL Lock' : 'View'}</span>
          </button>
        </div>

        {/* CAD Authoring Tools — Hover or Click Popover (Eliminates Always-Visible Clutter) */}
        <div
          className="relative"
          onMouseEnter={() => setOpenMenu('tools')}
          onMouseLeave={() => setOpenMenu((m) => (m === 'tools' ? 'none' : m))}
        >
          <button
            onClick={() => setOpenMenu((m) => (m === 'tools' ? 'none' : 'tools'))}
            className={`flex items-center gap-1.5 h-9 px-3 rounded-xl border text-xs font-medium whitespace-nowrap transition-colors ${
              activeTool !== 'select' || openMenu === 'tools'
                ? 'border-violet-500/70 bg-violet-500/12 text-violet-700 dark:text-violet-300'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#18181F] text-zinc-700 dark:text-zinc-200 hover:border-violet-500/60'
            }`}
            title="Hover or click to choose CAD Drawing & Modeling Tools"
          >
            {activeTool === 'select' ? <Wrench className="w-3.5 h-3.5 text-violet-500" /> : currentToolMeta.icon}
            <span className="hidden sm:inline">{activeTool === 'select' ? 'Tools' : currentToolMeta.label}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {openMenu === 'tools' && (
            <div className="absolute left-0 top-full pt-1.5 z-50">
              <div className="w-72 rounded-2xl bg-white dark:bg-[#15151C] border border-zinc-200 dark:border-zinc-800 shadow-2xl p-3 space-y-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-zinc-900 dark:text-white">Authoring &amp; CAD Tools</span>
                  <span className="font-mono text-zinc-400">Shortcuts</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {tools.map((t) => {
                    const toolBlocked = isReadOnly && t.id !== 'select' && t.id !== 'measure';
                    return (
                      <button
                        key={t.id}
                        disabled={toolBlocked}
                        onClick={() => {
                          setActiveTool(t.id);
                          t.onPick?.();
                          setOpenMenu('none');
                        }}
                        className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-medium transition-colors ${
                          activeTool === t.id
                            ? 'bg-violet-600 text-white shadow-xs'
                            : toolBlocked
                              ? 'bg-zinc-100/60 dark:bg-[#181820]/60 text-zinc-400 opacity-45 cursor-not-allowed'
                              : 'bg-zinc-50 dark:bg-[#1B1B24] text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/15 hover:text-violet-600 dark:hover:text-violet-300'
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          {t.icon}
                          <span className="truncate">{t.label}</span>
                        </span>
                        <kbd
                          className={`text-[9.5px] font-mono px-1 rounded ${
                            activeTool === t.id ? 'bg-white/20 text-white' : 'text-zinc-400'
                          }`}
                        >
                          {t.shortcut}
                        </kbd>
                      </button>
                    );
                  })}
                </div>

                {/* Transform Gizmo + Snap/Grid Quick Row */}
                <div className="pt-2.5 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    {(
                      [
                        { id: 'translate', icon: <Move className="w-3.5 h-3.5" />, title: 'Move Gizmo' },
                        { id: 'rotate', icon: <RotateCw className="w-3.5 h-3.5" />, title: 'Rotate Gizmo' },
                        { id: 'scale', icon: <Scale className="w-3.5 h-3.5" />, title: 'Scale Gizmo' },
                      ] as const
                    ).map((g) => (
                      <button
                        key={g.id}
                        onClick={() => {
                          setActiveTool('select');
                          setTransformMode(g.id);
                        }}
                        title={g.title}
                        className={`p-1.5 rounded-lg transition-colors ${
                          transformMode === g.id
                            ? 'bg-violet-600 text-white'
                            : 'bg-zinc-100 dark:bg-[#1B1B24] text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                        }`}
                      >
                        {g.icon}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateSnap({ enabled: !snap.enabled })}
                      title={`Snap (${snap.enabled ? 'On' : 'Off'})`}
                      className={`px-2 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1 ${
                        snap.enabled
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40'
                          : 'bg-zinc-100 dark:bg-[#1B1B24] text-zinc-500'
                      }`}
                    >
                      <Magnet className="w-3 h-3" />
                      Snap
                    </button>
                    <button
                      onClick={() => updateSnap({ showGrid: !snap.showGrid })}
                      title="Toggle Architectural Grid"
                      className={`p-1.5 rounded-lg ${
                        snap.showGrid
                          ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white'
                          : 'bg-zinc-100 dark:bg-[#1B1B24] text-zinc-400'
                      }`}
                    >
                      <Grid3X3 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Clean Rounded View Mode Switcher */}
        <div className="relative flex items-center bg-zinc-100 dark:bg-[#18181F] p-1 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setViewMode('2d')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              viewMode === '2d'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            2D
          </button>
          <button
            onClick={() => setViewMode('3d-perspective')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              viewMode === '3d-perspective'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            3D
          </button>
          <button
            onClick={() => {
              setViewMode('3d-ortho');
              setOpenMenu((m) => (m === 'ortho' ? 'none' : 'ortho'));
            }}
            className={`hidden sm:inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              viewMode === '3d-ortho'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            Ortho
          </button>
          <button
            onClick={() => setViewMode('split')}
            title="Synchronized 2D + 3D Split View"
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1 transition-colors ${
              viewMode === 'split'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Split</span>
          </button>

          {openMenu === 'ortho' && (
            <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-[#15151C] border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-1.5 w-36 z-50">
              {orthoOptions.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setOrthoPreset(p);
                    setOpenMenu('none');
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs capitalize transition-colors ${
                    orthoPreset === p
                      ? 'bg-violet-600 text-white font-medium'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 3D Inspection & Heatmap — Hover or Click Popover */}
        <div
          className="relative"
          onMouseEnter={() => setOpenMenu('inspect')}
          onMouseLeave={() => setOpenMenu((m) => (m === 'inspect' ? 'none' : m))}
        >
          <button
            onClick={() => setOpenMenu((m) => (m === 'inspect' ? 'none' : 'inspect'))}
            className={`flex items-center gap-1.5 h-9 px-3 rounded-xl border text-xs font-medium whitespace-nowrap transition-colors ${
              heatmapMetric !== 'none' || sectionCutEnabled || explodedFactor > 0 || firstPersonMode
                ? 'border-amber-500/70 bg-amber-500/12 text-amber-600 dark:text-amber-300'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#18181F] text-zinc-700 dark:text-zinc-200 hover:border-amber-500/60'
            }`}
            title="Live 3D Heatmaps, Section Cut, Exploded Floors & Walk Mode"
          >
            <Thermometer className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden lg:inline">
              {heatmapMetric === 'none'
                ? '3D & Map'
                : heatmapMetric === 'temperature'
                  ? 'Temp Map'
                  : heatmapMetric === 'humidity'
                    ? 'RH Map'
                    : 'ΔP Map'}
            </span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {openMenu === 'inspect' && (
            <div className="absolute right-0 top-full pt-1.5 z-50">
              <div className="w-72 rounded-2xl bg-white dark:bg-[#15151C] border border-zinc-200 dark:border-zinc-800 shadow-2xl p-3.5 space-y-3.5">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-zinc-900 dark:text-white">
                    Live 3D Environmental Heatmap
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(
                      [
                        { id: 'none', label: 'Off', icon: null },
                        { id: 'temperature', label: 'Temp', icon: <Thermometer className="w-3 h-3" /> },
                        { id: 'humidity', label: 'RH%', icon: <Droplets className="w-3 h-3" /> },
                        { id: 'pressure', label: 'ΔP', icon: <Gauge className="w-3 h-3" /> },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setHeatmapMetric(m.id)}
                        className={`flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-medium transition-colors ${
                          heatmapMetric === m.id
                            ? 'bg-amber-500 text-zinc-950 font-semibold'
                            : 'bg-zinc-100 dark:bg-[#1D1D26] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                        }`}
                      >
                        {m.icon}
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-200">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sectionCutEnabled}
                        onChange={(e) =>
                          setSectionCut(
                            e.target.checked,
                            activeFloor?.height ? Number((activeFloor.height * 0.55).toFixed(1)) : 2.2,
                            sectionCutAxis,
                            sectionCutFlipped
                          )
                        }
                        className="accent-violet-500"
                      />
                      <Scissors className="w-3.5 h-3.5 text-violet-500" />
                      <span>Section Cut</span>
                    </label>
                    {sectionCutEnabled && (
                      <button
                        onClick={resetSectionCut}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-violet-600 hover:text-white text-[10px] font-medium"
                      >
                        <RotateCcw className="w-2.5 h-2.5" /> Reset
                      </button>
                    )}
                  </div>
                  {sectionCutEnabled && (
                    <div className="space-y-1.5 pl-1">
                      <div className="flex items-center gap-1">
                        {(['y', 'x', 'z'] as const).map((ax) => (
                          <button
                            key={ax}
                            onClick={() => {
                              const defVal =
                                ax === 'y'
                                  ? Number(((activeFloor?.height ?? 4) * 0.55).toFixed(1))
                                  : ax === 'x'
                                    ? Number(((activeFloor?.width ?? 30) * 0.5).toFixed(1))
                                    : Number(((activeFloor?.depth ?? 20) * 0.5).toFixed(1));
                              setSectionCut(true, defVal, ax, sectionCutFlipped);
                            }}
                            className={`flex-1 py-0.5 rounded-lg font-mono text-[10px] uppercase font-semibold ${
                              sectionCutAxis === ax
                                ? 'bg-violet-600 text-white'
                                : 'bg-zinc-100 dark:bg-[#1D1D26] text-zinc-500'
                            }`}
                          >
                            {ax}
                          </button>
                        ))}
                        <button
                          onClick={() =>
                            setSectionCut(true, sectionCutHeight, sectionCutAxis, !sectionCutFlipped)
                          }
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-medium ${
                            sectionCutFlipped
                              ? 'bg-amber-500 text-zinc-950 font-semibold'
                              : 'bg-zinc-100 dark:bg-[#1D1D26] text-zinc-500'
                          }`}
                        >
                          Flip
                        </button>
                      </div>
                      <div className="flex justify-between text-[11px] font-mono text-zinc-500">
                        <span>Plane ({sectionCutAxis.toUpperCase()})</span>
                        <span>{sectionCutHeight.toFixed(1)} m</span>
                      </div>
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
                        onChange={(e) =>
                          setSectionCut(true, Number(e.target.value), sectionCutAxis, sectionCutFlipped)
                        }
                        className="w-full accent-violet-500"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[11px] text-zinc-600 dark:text-zinc-300">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Layers className="w-3.5 h-3.5 text-amber-500" /> Floor Decomposition
                      </span>
                      <span className="font-mono tabular-nums text-amber-500 font-semibold">
                        {Math.round(explodedFactor * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={explodedFactor}
                      onChange={(e) => setExplodedFactor(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                    <div className="grid grid-cols-3 gap-1">
                      {[0, 0.5, 1].map((preset) => (
                        <button
                          key={preset}
                          onClick={() => setExplodedFactor(preset)}
                          className={`py-1 rounded-lg text-[10px] font-mono font-semibold transition-colors ${
                            Math.abs(explodedFactor - preset) < 0.04
                              ? 'bg-amber-500 text-zinc-950'
                              : 'bg-zinc-100 dark:bg-[#1D1D26] text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                          }`}
                        >
                          {preset === 0 ? 'Stacked 0%' : preset === 0.5 ? 'Split 50%' : 'Decomp 100%'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quick 3D Overlays: Night Spotlights, NavMesh, Animated Flows, Flow Legend */}
                  <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-2 gap-1.5 text-[11px]">
                    <button
                      onClick={toggleLightingMode}
                      className={`py-1.5 px-2 rounded-xl font-medium flex items-center justify-center gap-1 ${
                        lightingMode === 'night'
                          ? 'bg-amber-500 text-zinc-950 font-semibold'
                          : 'bg-zinc-100 dark:bg-[#1D1D26] text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      {lightingMode === 'night' ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
                      {lightingMode === 'night' ? 'Night On' : 'Night Mode'}
                    </button>
                    <button
                      onClick={() => setShowNavMesh(!showNavMesh)}
                      className={`py-1.5 px-2 rounded-xl font-medium flex items-center justify-center gap-1 ${
                        showNavMesh
                          ? 'bg-violet-600 text-white'
                          : 'bg-zinc-100 dark:bg-[#1D1D26] text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      NavMesh {showNavMesh ? 'On' : 'Off'}
                    </button>
                    <button
                      onClick={() => setAnimateFlows(!animateFlows)}
                      className={`py-1.5 px-2 rounded-xl font-medium flex items-center justify-center gap-1 ${
                        animateFlows
                          ? 'bg-violet-600 text-white'
                          : 'bg-zinc-100 dark:bg-[#1D1D26] text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      Flow Anim
                    </button>
                    <button
                      onClick={() => setShowFlowLegend(!showFlowLegend)}
                      className={`py-1.5 px-2 rounded-xl font-medium flex items-center justify-center gap-1 ${
                        showFlowLegend
                          ? 'bg-zinc-800 text-white dark:bg-zinc-700'
                          : 'bg-zinc-100 dark:bg-[#1D1D26] text-zinc-500'
                      }`}
                    >
                      Legend {showFlowLegend ? 'On' : 'Off'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Dedicated Separate Character Walkthrough Button */}
        <button
          onClick={() => {
            if (!firstPersonMode && viewMode === '2d') setViewMode('3d-perspective');
            setFirstPersonMode(!firstPersonMode);
          }}
          className={`flex items-center gap-1.5 h-9 px-3 rounded-xl border text-xs font-semibold whitespace-nowrap transition-colors ${
            firstPersonMode
              ? 'border-violet-500 bg-violet-600 text-white shadow-sm'
              : 'border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#18181F] text-zinc-700 dark:text-zinc-200 hover:border-violet-500'
          }`}
          title="First-Person Character Walkthrough (NavMesh + WASD + Space Jump + Area Tablet)"
        >
          <Footprints className={`w-3.5 h-3.5 ${firstPersonMode ? 'text-white' : 'text-violet-500'}`} />
          <span className="hidden lg:inline">{firstPersonMode ? 'Exit Walk' : 'Walkthrough'}</span>
        </button>

        {/* WebXR VR Immersion Toggle */}
        <button
          type="button"
          onClick={() => {
            if (!vrSessionActive && viewMode === '2d') {
              setViewMode('3d-perspective');
              setTimeout(() => requestVrToggle(), 80);
            } else {
              requestVrToggle();
            }
          }}
          className={`flex items-center gap-1.5 h-9 px-3 rounded-xl border text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
            vrSessionActive
              ? 'border-cyan-400 bg-cyan-500 text-zinc-950 shadow-sm'
              : 'border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#18181F] text-zinc-700 dark:text-zinc-200 hover:border-cyan-500'
          }`}
          title="Launch WebXR VR Immersion Session for Active 3D Viewport"
        >
          <Glasses className={`w-3.5 h-3.5 ${vrSessionActive ? 'text-zinc-950' : 'text-cyan-500'}`} />
          <span className="hidden xl:inline">{vrSessionActive ? 'Exit VR' : 'VR Immersion'}</span>
        </button>
      </div>

      {/* ZONE 3 (Right): Save & Validate + Maya AI + Telemetry + Ellipsis Overflow Menu */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Validate & Save Gate Button (Pre-Save Full Audit + AI Auto-Fix + Confirmation) */}
        <button
          onClick={() => {
            refreshValidation();
            setShowSaveValidationModal(true);
          }}
          className={`flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
            validationIssues.length > 0
              ? 'border-amber-500/60 bg-amber-500/12 text-amber-600 dark:text-amber-300 hover:bg-amber-500/20'
              : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
          }`}
          title="Run Comprehensive GMP Validation, AI Auto-Fix & Save (Ctrl+S)"
        >
          <Save className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Save</span>
          {validationIssues.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-zinc-950 font-mono text-[10px] font-bold">
              {validationIssues.length}
            </span>
          )}
        </button>

        {/* Auto-save Toggle (60s Inactivity → Save & Validation Workflow) */}
        <button
          role="switch"
          aria-checked={autoSaveEnabled}
          onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
          className={`flex items-center gap-1.5 h-9 px-2.5 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
            autoSaveEnabled
              ? 'border-violet-500/70 bg-violet-500/15 text-violet-700 dark:text-violet-300 hover:bg-violet-500/25'
              : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] text-zinc-600 dark:text-zinc-400 hover:border-violet-500/50 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
          title={
            autoSaveEnabled
              ? `Auto-save active: triggers Save & Validation after 60s of inactivity (${autoSaveSecondsLeft}s left)`
              : 'Enable Auto-save (triggers Save & Validation after 60s of inactivity)'
          }
        >
          <Timer className={`w-3.5 h-3.5 ${autoSaveEnabled ? 'text-violet-500 dark:text-violet-400' : 'text-zinc-400'}`} />
          <span className="hidden md:inline">Auto-save</span>
          <span
            className={`relative inline-flex items-center w-7 h-4 rounded-full transition-colors ${
              autoSaveEnabled ? 'bg-violet-600' : 'bg-zinc-300 dark:bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block w-3 h-3 rounded-full bg-white shadow-xs transform transition-transform ${
                autoSaveEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
              }`}
            />
          </span>
          {autoSaveEnabled && (
            <span className="hidden xl:inline font-mono text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
              {autoSaveSecondsLeft}s
            </span>
          )}
        </button>

        {/* Standalone Maya AI Map Designer Chat */}
        <button
          onClick={() => setShowMayaChat(!showMayaChat)}
          className="flex items-center gap-1.5 h-9 px-3 rounded-xl gradian-violet-amber text-white text-xs font-semibold shadow-sm hover:opacity-95 transition-opacity whitespace-nowrap shrink-0"
          title="Open Maya AI Map Designer Chat (Design & Edit Map by Chat)"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Maya AI</span>
        </button>

        {/* Live Telemetry Dashboard */}
        <button
          onClick={() => openDashboard({ tab: 'trends' })}
          className="flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] hover:border-violet-500 text-zinc-800 dark:text-zinc-200 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
          title="Open Live Sensors, Trends & 3D Equipment Console"
        >
          <Activity className={`w-3.5 h-3.5 ${activeAlarmCount > 0 ? 'text-rose-500' : 'text-amber-500'}`} />
          <span className="hidden lg:inline">Telemetry</span>
          {activeAlarmCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-500 font-mono text-[10px] font-bold">
              {activeAlarmCount}
            </span>
          )}
        </button>

        {/* GMP Operations & Production Line Eligibility */}
        <button
          onClick={() => openGmpModal({ tab: 'lines' })}
          className="flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] hover:border-emerald-500 text-zinc-800 dark:text-zinc-200 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          title="GMP Production Line Eligibility, Calibration/PQ, Work Orders, Calendar, SOPs & Wiki"
        >
          <ClipboardCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span className="hidden xl:inline">GMP Ops</span>
          {overdueWorkOrders > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white font-mono text-[10px] font-bold">
              {overdueWorkOrders}
            </span>
          )}
        </button>

        {/* Telemetry-Gated Resource & Zone Scheduling */}
        <button
          onClick={() => openResourceSchedulingModal(null)}
          className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] hover:border-violet-500 text-zinc-800 dark:text-zinc-200 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          title="Telemetry-Gated Resource & Zone Scheduling (Personnel & GMP Equipment)"
        >
          <CalendarClock className="w-3.5 h-3.5 text-violet-500" />
          <span className="hidden xl:inline">Schedule</span>
          {heldSchedulesCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 font-mono text-[10px] font-bold tabular-nums">
              {heldSchedulesCount}
            </span>
          )}
        </button>

        {/* Dedicated CAD / DWG / SVG -> Plan Walls OCR Tool */}
        <button
          onClick={() => setShowCadOcrModal(true)}
          className="hidden md:flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] hover:border-cyan-500 text-zinc-800 dark:text-zinc-200 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          title="DWG / DXF / SVG to Plan Walls & Glass Curtain Walls using Vision OCR"
        >
          <ScanText className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden xl:inline">CAD / SVG OCR</span>
        </button>

        {/* QR / Barcode Camera Scanner & Label Designer */}
        <button
          onClick={() => openQrLabelModal('scanner')}
          className="hidden sm:flex items-center justify-center h-9 w-9 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] hover:border-amber-500 text-zinc-700 dark:text-zinc-200 transition-colors shrink-0 cursor-pointer"
          title="QR / Barcode / DataMatrix Camera Scanner & Industrial Label Designer"
        >
          <QrCode className="w-4 h-4 text-amber-500" />
        </button>

        {/* Modern Ellipsis Overflow Menu (Replaces 10+ Cluttered Header Buttons) */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu((m) => (m === 'more' ? 'none' : 'more'))}
            className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
              openMenu === 'more'
                ? 'border-violet-500 bg-violet-500/15 text-violet-500'
                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] text-zinc-600 dark:text-zinc-300 hover:border-violet-500/60'
            }`}
            title="More Workspace Tools (AI Planner, 3D Gallery, VR/AR, Export, Sync, Theme)"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {openMenu === 'more' && (
            <div className="absolute right-0 top-full mt-1.5 w-64 rounded-2xl bg-white dark:bg-[#15151C] border border-zinc-200 dark:border-zinc-800 shadow-2xl p-2 space-y-1 z-50">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Studios &amp; Libraries
              </div>
              <button
                onClick={() => {
                  setShowAIPlannerModal(true);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors cursor-pointer"
              >
                <Wand2 className="w-4 h-4 text-violet-500" />
                <span>AI Floor Planner Playground</span>
              </button>
              <button
                onClick={() => {
                  setShowCadOcrModal(true);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-cyan-500/12 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors cursor-pointer"
              >
                <ScanText className="w-4 h-4 text-cyan-400" />
                <span>DWG / SVG to Walls (OCR)</span>
              </button>
              <button
                onClick={() => {
                  setShowModelsGallery(true);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
              >
                <LayoutGrid className="w-4 h-4 text-amber-500" />
                <span>3D Models Gallery (80+ PBR)</span>
              </button>
              <button
                onClick={() => {
                  setShowCameraManager(true);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
              >
                <Camera className="w-4 h-4 text-emerald-500" />
                <span>Cameras &amp; LiveCam Panel</span>
              </button>
              <button
                onClick={() => {
                  const firstRack = scene.assets.find(
                    (a) => a.category === 'IT & Data Center' || a.rackConfig
                  );
                  openRackDesigner(firstRack?.id);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
              >
                <Server className="w-4 h-4 text-violet-500" />
                <span>42U IT / Network Rack Designer</span>
              </button>
              <button
                onClick={() => {
                  setShowXRModal(true);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
              >
                <Glasses className="w-4 h-4 text-cyan-500" />
                <span>AR Surface Detection / VR Stereo</span>
              </button>
              <button
                onClick={() => {
                  setShowAuditTrailModal(true);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
              >
                <span className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                  <span>21 CFR Part 11 Audit Trail</span>
                </span>
                <span className="font-mono text-[10px] text-zinc-400">{auditLog.length}</span>
              </button>

              <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                GMP Operations &amp; Labels
              </div>
              <button
                onClick={() => {
                  openRiskModal({ mode: 'heatmap', floorId: activeFloorId });
                  setOpenMenu('none');
                }}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-amber-500/12 hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2.5">
                  <Flame className="w-4 h-4 text-amber-500" />
                  <span>Facility Risk Heatmap (S×O)</span>
                </span>
                {openRiskCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 font-mono text-[9.5px] font-bold tabular-nums">
                    {openRiskCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  const selAsset = selected.find((s) => s.type === 'asset');
                  openAssetPdfModal(selAsset?.id ?? null);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors cursor-pointer"
              >
                <FileText className="w-4 h-4 text-violet-500" />
                <span>Asset FMEA &amp; GMP PDF Report</span>
              </button>
              <button
                onClick={() => {
                  openResourceSchedulingModal(null);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2.5">
                  <CalendarClock className="w-4 h-4 text-violet-500" />
                  <span>Resource &amp; Zone Scheduling</span>
                </span>
                {heldSchedulesCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 font-mono text-[9.5px] font-bold tabular-nums">
                    {heldSchedulesCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  openGmpModal({ tab: 'lines' });
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-emerald-500/12 hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors cursor-pointer"
              >
                <GitBranch className="w-4 h-4 text-emerald-500" />
                <span>Production Line Eligibility</span>
              </button>
              <button
                onClick={() => {
                  openGmpModal({ tab: 'predictive' });
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-rose-500/12 hover:text-rose-500 transition-colors cursor-pointer"
              >
                <TrendingDown className="w-4 h-4 text-rose-500" />
                <span>Predictive Failure Forecast</span>
              </button>
              <button
                onClick={() => {
                  openGmpModal({ tab: 'workflows' });
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-500 transition-colors cursor-pointer"
              >
                <Workflow className="w-4 h-4 text-violet-500" />
                <span>GMP Workflows &amp; E-Sign</span>
              </button>
              <button
                onClick={() => {
                  openGmpModal({ tab: 'workorders' });
                  setOpenMenu('none');
                }}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
              >
                <span className="flex items-center gap-2.5">
                  <ClipboardCheck className="w-4 h-4 text-amber-500" />
                  <span>Work Orders &amp; Cron Jobs</span>
                </span>
                {overdueWorkOrders > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white font-mono text-[9.5px] font-bold">
                    {overdueWorkOrders}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  openGmpModal({ tab: 'calendar' });
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
              >
                <Calendar className="w-4 h-4 text-violet-400" />
                <span>Compliance &amp; Service Calendar</span>
              </button>
              <button
                onClick={() => {
                  openGmpModal({ tab: 'sops' });
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
              >
                <BookOpen className="w-4 h-4 text-sky-400" />
                <span>SOPs, Records &amp; Troubleshoot Wiki</span>
              </button>
              <button
                onClick={() => {
                  openQrLabelModal('designer');
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-amber-500/12 hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
              >
                <QrCode className="w-4 h-4 text-amber-500" />
                <span>QR Scanner &amp; Label Designer</span>
              </button>
              <button
                onClick={() => {
                  setShowMiniMap(!showMiniMap);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="flex items-center gap-2.5">
                  <MapIcon className="w-4 h-4 text-violet-400" />
                  <span>Draggable Birds-Eye Mini-Map</span>
                </span>
                <span className={`font-mono text-[10px] font-semibold ${showMiniMap ? 'text-emerald-400' : 'text-zinc-400'}`}>
                  {showMiniMap ? 'ON' : 'OFF'}
                </span>
              </button>

              <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Security, Project &amp; Sync
              </div>
              <button
                onClick={() => {
                  openAclModal('users');
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors cursor-pointer"
              >
                <Shield className="w-4 h-4 text-violet-500" />
                <span>ACL, Roles &amp; User Grouping</span>
              </button>
              <button
                onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="flex items-center gap-2.5">
                  <Timer className={`w-4 h-4 ${autoSaveEnabled ? 'text-violet-500' : 'text-zinc-400'}`} />
                  <span>Auto-save (60s idle)</span>
                </span>
                <span className={`font-mono text-[10px] font-semibold ${autoSaveEnabled ? 'text-violet-500' : 'text-zinc-400'}`}>
                  {autoSaveEnabled ? `ON · ${autoSaveSecondsLeft}s` : 'OFF'}
                </span>
              </button>
              <button
                onClick={() => {
                  user ? handleCloudSave() : signInWithGoogle();
                  setOpenMenu('none');
                }}
                disabled={savingCloud}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <CloudUpload className="w-4 h-4 text-emerald-500" />
                <span>{savingCloud ? 'Syncing...' : user ? 'Save to Cloud Workspace' : 'Sign In with Google to Sync'}</span>
              </button>
              <button
                onClick={() => {
                  handleQuickSnapshot();
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <History className="w-4 h-4 text-amber-500" />
                <span>Capture Revision Snapshot</span>
              </button>
              <button
                onClick={() => {
                  setShowExportModal(true);
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <Download className="w-4 h-4 text-zinc-400" />
                <span>Export GLB / JSON / Report</span>
              </button>

              <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
              <div className="px-2.5 py-1.5 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300">
                <span>Units</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setUnitSystem('metric')}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-medium ${
                      scene.unitSystem === 'metric' ? 'bg-violet-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800'
                    }`}
                  >
                    m
                  </button>
                  <button
                    onClick={() => setUnitSystem('imperial')}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-medium ${
                      scene.unitSystem === 'imperial' ? 'bg-violet-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800'
                    }`}
                  >
                    ft
                  </button>
                </div>
              </div>

              <button
                onClick={() => {
                  toggleTheme();
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4 text-violet-500" />
                )}
                <span>{theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Charcoal'}</span>
              </button>

              <button
                onClick={() => {
                  toggleMaximizeCanvas();
                  setOpenMenu('none');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                {canvasMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                <span>{canvasMaximized ? 'Restore Side Panels' : 'Focus Full Viewport'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Logged-in User Avatar, Online/Offline Status Indicator & Profile/ACL Menu */}
        <UserAvatarMenu onCloudSync={handleCloudSave} savingCloud={savingCloud} />
      </div>
    </header>
  );
};
