import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Focus,
  History,
  Info,
  Lightbulb,
  Link2,
  Lock,
  PaintBucket,
  Pause,
  Play,
  Plus,
  QrCode,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Video,
  Waypoints,
  Wind,
  Wrench,
} from 'lucide-react';
import { useTwinStore, type RightPanelTab } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useGmpStore } from '../store/useGmpStore';
import { useAclStore, computeEffectivePermissions } from '../store/useAclStore';
import { useRiskIncidentStore, getTargetFmeaSummary } from '../store/useRiskIncidentStore';
import { METRIC_PRESETS } from '../types/telemetry';
import { MiniSparkline } from './TelemetryDashboard';
import { SchemaVisualizerD3 } from './SchemaVisualizerD3';
import { EntityRisksSection } from './RiskFmeaCenter';
import { LightingDesignerPanel } from './LightingDesignerPanel';
import {
  AHU_CATALOG,
  AIRFLOW_MODES,
  HEPA_CLASSES,
  computeRoomSupplyM3h,
  getAhuColor,
  getEffectiveRoomHvac,
} from '../utils/hvac';
import { DEFAULT_MATERIALS, WALL_PRESETS } from '../data/materialsLibrary';
import { OBJECT_LIBRARY } from '../data/objectLibrary';
import {
  formatArea,
  formatCurrency,
  formatLength,
  formatVolume,
  getAnalyticsLegend,
} from '../utils/spatial';
import { fetchApiJson } from '../utils/safeJson';
import { computeFlowRoomSequence } from '../utils/flowAnalytics';
import type {
  AnalyticsMetric,
  CleanroomGrade,
  FlowType,
  ProposedAIAction,
  WallPresetId,
} from '../types/twin';

const CLEANROOM_GRADES: CleanroomGrade[] = [
  'Grade A / ISO 5',
  'Grade B / ISO 6',
  'Grade C / ISO 7',
  'Grade D / ISO 8',
  'CNC (Controlled)',
  'Unclassified',
];

const ANALYTICS_OPTIONS: { id: AnalyticsMetric; label: string }[] = [
  { id: 'none', label: 'Realistic Materials (Off)' },
  { id: 'space-type', label: 'Space Classification' },
  { id: 'cleanroom-grade', label: 'Cleanroom Grade (A–D / ISO)' },
  { id: 'pressure-cascade', label: 'Pressure Cascade (Pa)' },
  { id: 'temperature', label: 'Temperature Zones (°C)' },
  { id: 'utilization', label: 'Space & Asset Utilization (%)' },
  { id: 'compliance', label: 'GMP Compliance Status' },
  { id: 'risk', label: 'Contamination & Risk Level' },
  { id: 'cost', label: 'Capital Cost Intensity ($)' },
  { id: 'energy', label: 'Energy Load (kW)' },
  { id: 'maintenance', label: 'Maintenance Due Status' },
];

export const RightInspector: React.FC = () => {
  const scene = useTwinStore((s) => s.scene);
  const rightTab = useTwinStore((s) => s.rightTab);
  const selected = useTwinStore((s) => s.selected);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const selectedMaterialId = useTwinStore((s) => s.selectedMaterialId);
  const analyticsMetric = useTwinStore((s) => s.analyticsMetric);
  const validationIssues = useTwinStore((s) => s.validationIssues);
  const pendingAIActions = useTwinStore((s) => s.pendingAIActions);
  const aiPreviewMessage = useTwinStore((s) => s.aiPreviewMessage);
  const selectedFlowType = useTwinStore((s) => s.selectedFlowType);

  const setRightTab = useTwinStore((s) => s.setRightTab);
  const setActiveTool = useTwinStore((s) => s.setActiveTool);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const setSelectedMaterialId = useTwinStore((s) => s.setSelectedMaterialId);

  const gmpComplianceByAssetId = useGmpStore((s) => s.complianceByAssetId);
  const openGmpModal = useGmpStore((s) => s.openGmpModal);
  const openQrLabelModal = useGmpStore((s) => s.openQrLabelModal);
  const setAnalyticsMetric = useTwinStore((s) => s.setAnalyticsMetric);
  const setSelectedFlowType = useTwinStore((s) => s.setSelectedFlowType);
  const updateRoom = useTwinStore((s) => s.updateRoom);
  const updateWall = useTwinStore((s) => s.updateWall);
  const splitWall = useTwinStore((s) => s.splitWall);
  const updateOpening = useTwinStore((s) => s.updateOpening);
  const updateAsset = useTwinStore((s) => s.updateAsset);
  const alignSelectedAssets = useTwinStore((s) => s.alignSelectedAssets);
  const deleteSelected = useTwinStore((s) => s.deleteSelected);
  const duplicateSelected = useTwinStore((s) => s.duplicateSelected);
  const paintSurfaceWithMaterial = useTwinStore((s) => s.paintSurfaceWithMaterial);
  const addCustomMaterial = useTwinStore((s) => s.addCustomMaterial);
  const addCamera = useTwinStore((s) => s.addCamera);
  const updateCamera = useTwinStore((s) => s.updateCamera);
  const deleteCamera = useTwinStore((s) => s.deleteCamera);
  const flyToCamera = useTwinStore((s) => s.flyToCamera);
  const updateFlowRoute = useTwinStore((s) => s.updateFlowRoute);
  const deleteFlowRoute = useTwinStore((s) => s.deleteFlowRoute);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const refreshValidation = useTwinStore((s) => s.refreshValidation);
  const setPendingAIActions = useTwinStore((s) => s.setPendingAIActions);
  const applyPendingAIActions = useTwinStore((s) => s.applyPendingAIActions);
  const clearPendingAIActions = useTwinStore((s) => s.clearPendingAIActions);
  const undo = useTwinStore((s) => s.undo);
  const isolateSameTypeOrgWide = useTwinStore((s) => s.isolateSameTypeOrgWide);
  const clearIsolation = useTwinStore((s) => s.clearIsolation);
  const isolatedAssetType = useTwinStore((s) => s.isolatedAssetType);
  const drillInto = useTwinStore((s) => s.drillInto);
  const buildDirectUrl = useTwinStore((s) => s.buildDirectUrl);
  const setShowMayaChat = useTwinStore((s) => s.setShowMayaChat);
  const setShowCameraManager = useTwinStore((s) => s.setShowCameraManager);
  const openLiveCamera = useTwinStore((s) => s.openLiveCamera);
  const openRackDesigner = useTwinStore((s) => s.openRackDesigner);
  const setShowSaveValidationModal = useTwinStore((s) => s.setShowSaveValidationModal);
  const setShowAuditTrailModal = useTwinStore((s) => s.setShowAuditTrailModal);
  const animateFlows = useTwinStore((s) => s.animateFlows);
  const setAnimateFlows = useTwinStore((s) => s.setAnimateFlows);
  const showFlows = useTwinStore((s) => s.showFlows);
  const setShowFlows = useTwinStore((s) => s.setShowFlows);
  const isolatedFlowId = useTwinStore((s) => s.isolatedFlowId);
  const isolateFlow = useTwinStore((s) => s.isolateFlow);
  const hiddenFlowIds = useTwinStore((s) => s.hiddenFlowIds);
  const toggleFlowVisibility = useTwinStore((s) => s.toggleFlowVisibility);
  const setActiveFlowInfoId = useTwinStore((s) => s.setActiveFlowInfoId);
  const showFlowLegend = useTwinStore((s) => s.showFlowLegend);
  const setShowFlowLegend = useTwinStore((s) => s.setShowFlowLegend);
  const editingFlowId = useTwinStore((s) => s.editingFlowId);
  const setEditingFlowId = useTwinStore((s) => s.setEditingFlowId);
  const showToast = useTwinStore((s) => s.showToast);
  const openEntityInfo = useTwinStore((s) => s.openEntityInfo);
  const workspaceMode = useTwinStore((s) => s.workspaceMode);
  const showHvacOverlay = useTwinStore((s) => s.showHvacOverlay);
  const setShowHvacOverlay = useTwinStore((s) => s.setShowHvacOverlay);
  const updateRoomHvac = useTwinStore((s) => s.updateRoomHvac);

  const riskIncidents = useRiskIncidentStore((s) => s.incidents);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);
  const openAssetPdfModal = useRiskIncidentStore((s) => s.openAssetPdfModal);

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

  const telemetrySensors = useTelemetryStore((s) => s.sensors);
  const telemetryReadings = useTelemetryStore((s) => s.readings);
  const openTelemetryDashboard = useTelemetryStore((s) => s.openDashboard);
  const buildTelemetryTabUrl = useTelemetryStore((s) => s.buildTelemetryTabUrl);
  const setHeatmapMetric = useTelemetryStore((s) => s.setHeatmapMetric);

  const copyDirectLink = (overrides: Parameters<typeof buildDirectUrl>[0], label: string) => {
    const url = buildDirectUrl(overrides);
    navigator.clipboard?.writeText(url).catch(() => {});
    showToast(`Direct URL copied for ${label}`, 'success');
  };

  const [assetSubTab, setAssetSubTab] = useState<'general' | 'spatial' | 'ops' | 'iot' | 'docs'>('general');
  const [openRoomSection, setOpenRoomSection] = useState<'specs' | 'hvac' | 'lighting' | 'sensors' | 'fmea'>('specs');
  const [openAssetSection, setOpenAssetSection] = useState<'specs' | 'gmp' | 'fmea'>('specs');
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiHistory, setAiHistory] = useState<{ role: 'user' | 'assistant'; text: string; analysis?: string }[]>([
    {
      role: 'assistant',
      text: 'Ready to assist with GMP layout engineering, equipment clearance checks, cleanroom analytics, and spatial edits. All changes preview before applying.',
    },
  ]);

  const texInputRef = useRef<HTMLInputElement | null>(null);

  const primarySel = selected[0] ?? null;
  const selRoom = primarySel?.type === 'room' ? scene.rooms.find((r) => r.id === primarySel.id) : null;
  const selWall = primarySel?.type === 'wall' ? scene.walls.find((w) => w.id === primarySel.id) : null;
  const selOpening = primarySel?.type === 'opening' ? scene.openings.find((o) => o.id === primarySel.id) : null;
  const selAsset = primarySel?.type === 'asset' ? scene.assets.find((a) => a.id === primarySel.id) : null;
  const selCamera = primarySel?.type === 'camera' ? scene.cameras.find((c) => c.id === primarySel.id) : null;
  const selFlow = primarySel?.type === 'flow' ? scene.flows.find((f) => f.id === primarySel.id) : null;
  const selFloor = scene.floors.find((f) => f.id === activeFloorId);

  const allMaterials = useMemo(
    () => [...scene.customMaterials, ...DEFAULT_MATERIALS],
    [scene.customMaterials]
  );

  // Analytics KPI Rollups
  const kpis = useMemo(() => {
    const flRooms = scene.rooms.filter((r) => r.floorId === activeFloorId);
    const flAssets = scene.assets.filter((a) => a.floorId === activeFloorId);
    const totalRoomArea = flRooms.reduce((sum, r) => sum + r.width * r.depth, 0);
    const slabArea = selFloor ? selFloor.width * selFloor.depth : 1;
    const totalCapex = flAssets.reduce((sum, a) => sum + a.capexUsd, 0);
    const totalEnergy = flAssets.reduce((sum, a) => sum + a.energyKw, 0);
    const avgUtil = flRooms.length ? Math.round(flRooms.reduce((s, r) => s + r.utilizationPct, 0) / flRooms.length) : 0;
    const cleanroomCount = flRooms.filter((r) => r.environmental.cleanroomGrade.includes('Grade')).length;
    return {
      totalRoomArea,
      slabArea,
      efficiencyPct: Math.min(100, Math.round((totalRoomArea / Math.max(1, slabArea)) * 100)),
      totalCapex,
      totalEnergy,
      avgUtil,
      cleanroomCount,
      roomCount: flRooms.length,
      assetCount: flAssets.length,
    };
  }, [scene, activeFloorId, selFloor]);

  const handleUploadCustomTexture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      addCustomMaterial({
        id: `mat-custom-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        category: 'Custom',
        baseColor: '#FFFFFF',
        roughness: 0.45,
        metalness: 0.1,
        opacity: 1,
        reflectivity: 0.4,
        pattern: 'solid',
        uvScale: 2,
        textureRotation: 0,
        customTextureDataUrl: String(reader.result),
        isCustom: true,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const playCameraTour = () => {
    const cams = scene.cameras.filter((c) => c.floorId === activeFloorId);
    if (cams.length === 0) return;
    cams.forEach((cam, idx) => {
      window.setTimeout(() => {
        flyToCamera(cam.position, cam.target, cam.fov);
      }, idx * 2400);
    });
  };

  const runAICommand = async (commandText?: string) => {
    const prompt = (commandText ?? aiInput).trim();
    if (!prompt || aiLoading) return;
    setAiInput('');
    setAiError(null);
    setAiLoading(true);
    setAiHistory((prev) => [...prev, { role: 'user', text: prompt }]);

    const flRooms = scene.rooms.filter((r) => r.floorId === activeFloorId);
    const flAssets = scene.assets.filter((a) => a.floorId === activeFloorId);

    const facilitySummary = {
      projectName: scene.name,
      activeFloor: selFloor ? { id: selFloor.id, name: selFloor.name, width: selFloor.width, depth: selFloor.depth } : null,
      rooms: flRooms.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        x: r.x,
        z: r.z,
        width: r.width,
        depth: r.depth,
        height: r.height,
        grade: r.environmental.cleanroomGrade,
        pressurePa: r.environmental.pressurePa,
        utilizationPct: r.utilizationPct,
      })),
      assets: flAssets.map((a) => ({
        id: a.id,
        assetId: a.assetId,
        name: a.name,
        roomId: a.roomId,
        status: a.operationalStatus,
        utilizationPct: a.utilizationPct,
        capexUsd: a.capexUsd,
      })),
      warningsCount: validationIssues.length,
      availableMaterials: DEFAULT_MATERIALS.slice(0, 12).map((m) => ({ id: m.id, name: m.name })),
      availableEquipment: OBJECT_LIBRARY.slice(0, 20).map((o) => ({ id: o.id, name: o.name })),
    };

    try {
      const data = await fetchApiJson<any>(
        '/api/copilot',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, facilitySummary }),
        },
        'AI Copilot request failed. Please retry.'
      );
      const actions: ProposedAIAction[] = Array.isArray(data.proposedActions) ? data.proposedActions : [];
      setAiHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.explanation || 'Analysis complete.',
          analysis: data.analysisSummary,
        },
      ]);
      if (actions.length > 0) {
        setPendingAIActions(actions, data.explanation);
      }
    } catch (err: any) {
      setAiError(err?.message || 'Unable to reach AI Copilot.');
    } finally {
      setAiLoading(false);
    }
  };

  const tabs: { id: RightPanelTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'properties', label: 'Props', icon: <Sliders className="w-3.5 h-3.5" /> },
    { id: 'materials', label: 'Mat', icon: <PaintBucket className="w-3.5 h-3.5" /> },
    { id: 'cameras', label: 'Cam', icon: <Camera className="w-3.5 h-3.5" /> },
    { id: 'analytics', label: 'KPI', icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: 'flows', label: 'Flow', icon: <Waypoints className="w-3.5 h-3.5" /> },
    { id: 'validation', label: 'Warn', icon: <AlertTriangle className="w-3.5 h-3.5" />, count: validationIssues.length },
    { id: 'copilot', label: 'AI', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'schema', label: 'SQL', icon: <Database className="w-3.5 h-3.5" /> },
  ];

  const multiAssetCount = selected.filter((s) => s.type === 'asset').length;
  const orgWideMatchCount = selAsset
    ? scene.assets.filter(
        (a) => a.templateId === selAsset.templateId || a.archetype === selAsset.archetype
      ).length
    : 0;

  return (
    <aside className="w-80 xl:w-[340px] bg-white dark:bg-[#111114] border-l border-zinc-200 dark:border-zinc-800 flex flex-col h-full shrink-0">
      {/* Inspector Tab Strip */}
      <div className="grid grid-cols-8 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0D0D10]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setRightTab(t.id)}
            title={t.id === 'schema' ? 'Cloud SQL Database Schema (D3.js)' : t.label}
            className={`py-2 flex flex-col items-center gap-0.5 text-[9.5px] font-medium border-b-2 transition-colors relative ${
              rightTab === t.id
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-[#111114]'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.count !== undefined && t.count > 0 && (
              <span className="font-mono text-[8.5px] text-amber-500 font-semibold leading-none">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* TAB 1: CONTEXTUAL PROPERTIES INSPECTOR */}
      {rightTab === 'properties' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
          {isReadOnly && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl border border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-300 text-[11px] font-medium">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>
                {workspaceMode === 'view'
                  ? 'View Mode active — spatial & property editing locked.'
                  : 'ACL Read-Only role — editing & deletion disabled.'}
              </span>
            </div>
          )}

          {/* Multi-Selection Align & Distribute Bar */}
          {multiAssetCount >= 2 && !isReadOnly && (
            <div className="p-2.5 rounded-lg border border-violet-500/30 bg-violet-500/5 space-y-2">
              <div className="font-semibold text-violet-600 dark:text-violet-400">
                {multiAssetCount} Assets Selected — Align &amp; Distribute
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(['left', 'center-x', 'right', 'distribute-x', 'top', 'center-z', 'bottom', 'distribute-z'] as const).map(
                  (mode) => (
                    <button
                      key={mode}
                      onClick={() => alignSelectedAssets(mode)}
                      className="py-1 px-1 text-[10px] rounded bg-white dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 capitalize"
                    >
                      {mode.replace('-', ' ')}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {/* Selected ROOM Properties (Exclusive Single-Subject Accordion) */}
          {selRoom && (() => {
            const roomHvac = getEffectiveRoomHvac(selRoom);
            const supplyM3h = computeRoomSupplyM3h(selRoom);
            const ahuColor = getAhuColor(roomHvac.ahuId);
            const roomFmea = getTargetFmeaSummary(riskIncidents, 'room', selRoom.id, true);
            const roomSensors = telemetrySensors.filter(
              (s) => s.targetKind === 'room' && s.targetId === selRoom.id
            );
            const fmeaToneClass =
              roomFmea.level === 'critical'
                ? 'bg-rose-500/15 text-rose-500 border-rose-500/40'
                : roomFmea.level === 'high'
                  ? 'bg-amber-500/15 text-amber-500 border-amber-500/40'
                  : roomFmea.level === 'medium'
                    ? 'bg-violet-500/15 text-violet-400 border-violet-500/40'
                    : roomFmea.level === 'mitigated'
                      ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40'
                      : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/25';

            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-medium">
                        Room · {selRoom.code}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (roomFmea.worstIncident) {
                            openRiskModal({ mode: 'resolve', incidentId: roomFmea.worstIncident.id });
                          } else {
                            setOpenRoomSection('fmea');
                          }
                        }}
                        className={`px-1.5 py-0.5 rounded border font-mono text-[9.5px] font-bold tabular-nums cursor-pointer ${fmeaToneClass}`}
                        title={
                          roomFmea.worstIncident
                            ? `FMEA Status: ${roomFmea.worstIncident.title}`
                            : 'No open FMEA risks on this room'
                        }
                      >
                        {roomFmea.shortLabel || 'FMEA OK'}
                      </button>
                    </div>
                    <input
                      value={selRoom.name}
                      disabled={isReadOnly}
                      onChange={(e) => updateRoom(selRoom.id, { name: e.target.value })}
                      className="font-semibold text-sm bg-transparent w-full focus:outline-none text-zinc-900 dark:text-zinc-100 disabled:opacity-90"
                    />
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => drillInto('room', selRoom.id)}
                      className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      title="Drill 3D into Room"
                    >
                      <Compass className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        copyDirectLink(
                          { roomId: selRoom.id, floorId: selRoom.floorId, drillLevel: 'room' },
                          selRoom.name
                        )
                      }
                      className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      title="Copy Direct Room URL"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                    {!isReadOnly && (
                      <>
                        <button onClick={duplicateSelected} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Duplicate">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={deleteSelected} className="p-1.5 rounded text-red-500 hover:bg-red-500/10" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Room Quick Actions: Full Info & GMP Eligibility Check */}
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEntityInfo({ type: 'room', id: selRoom.id })}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-violet-600/15 hover:bg-violet-600 text-violet-600 dark:text-violet-300 hover:text-white border border-violet-500/35 text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    <Info className="w-3.5 h-3.5" />
                    Room Info &amp; SOPs
                  </button>
                  <button
                    type="button"
                    onClick={() => openEntityInfo({ type: 'room', id: selRoom.id }, { autoEligibility: true })}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-[11px] font-bold transition-colors cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Check Eligibility
                  </button>
                </div>

                {/* Exclusive Single-Subject Accordion Stack */}
                <div className="space-y-1.5">
                  {/* SECTION 1: Dimensions & GMP Specs */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#14141A] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenRoomSection('specs')}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 font-semibold text-[11.5px] text-zinc-800 dark:text-zinc-100">
                        {openRoomSection === 'specs' ? (
                          <ChevronDown className="w-3.5 h-3.5 text-violet-500" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        Dimensions &amp; GMP Specs
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                        {formatArea(selRoom.width * selRoom.depth, scene.unitSystem)}
                      </span>
                    </button>
                    {openRoomSection === 'specs' && (
                      <fieldset disabled={isReadOnly} className="px-3 pb-3 pt-1 space-y-3 min-w-0 border-t border-zinc-200/70 dark:border-zinc-800 disabled:opacity-80">
                        <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
                          <label className="space-y-1">
                            <span className="text-[10px] text-slate-400">Width (m)</span>
                            <input
                              type="number"
                              step={0.5}
                              value={selRoom.width}
                              onChange={(e) => updateRoom(selRoom.id, { width: Math.max(2, Number(e.target.value)) })}
                              className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] text-slate-400">Depth (m)</span>
                            <input
                              type="number"
                              step={0.5}
                              value={selRoom.depth}
                              onChange={(e) => updateRoom(selRoom.id, { depth: Math.max(2, Number(e.target.value)) })}
                              className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] text-slate-400">Height (m)</span>
                            <input
                              type="number"
                              step={0.2}
                              value={selRoom.height}
                              onChange={(e) => updateRoom(selRoom.id, { height: Math.max(2.4, Number(e.target.value)) })}
                              className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                            />
                          </label>
                        </div>

                        <div className="flex justify-between py-1.5 border-y border-slate-200 dark:border-zinc-800 font-mono text-[10.5px] text-slate-500 tabular-nums">
                          <span>Area: {formatArea(selRoom.width * selRoom.depth, scene.unitSystem)}</span>
                          <span>Vol: {formatVolume(selRoom.width * selRoom.depth * selRoom.height, scene.unitSystem)}</span>
                        </div>

                        <label className="block space-y-1">
                          <span className="text-[10px] text-slate-400">Cleanroom Classification</span>
                          <select
                            value={selRoom.environmental.cleanroomGrade}
                            onChange={(e) =>
                              updateRoom(selRoom.id, {
                                environmental: { ...selRoom.environmental, cleanroomGrade: e.target.value as CleanroomGrade },
                              })
                            }
                            className="w-full px-2 py-1.5 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                          >
                            {CLEANROOM_GRADES.map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                        </label>
                        <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                          <label className="space-y-1">
                            <span className="text-[10px] text-slate-400">Temp (°C)</span>
                            <input
                              type="number"
                              value={selRoom.environmental.temperatureC}
                              onChange={(e) =>
                                updateRoom(selRoom.id, {
                                  environmental: { ...selRoom.environmental, temperatureC: Number(e.target.value) },
                                })
                              }
                              className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] text-slate-400">Humidity (% RH)</span>
                            <input
                              type="number"
                              value={selRoom.environmental.humidityPct}
                              onChange={(e) =>
                                updateRoom(selRoom.id, {
                                  environmental: { ...selRoom.environmental, humidityPct: Number(e.target.value) },
                                })
                              }
                              className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                            />
                          </label>
                        </div>
                        <label className="block space-y-1">
                          <span className="text-[10px] text-slate-400">Compliance Status</span>
                          <select
                            value={selRoom.complianceStatus}
                            onChange={(e) => updateRoom(selRoom.id, { complianceStatus: e.target.value as any })}
                            className="w-full px-2 py-1.5 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                          >
                            <option value="compliant">GMP Compliant</option>
                            <option value="review-due">Qualification Review Due</option>
                            <option value="deviation">Active Deviation</option>
                          </select>
                        </label>
                      </fieldset>
                    )}
                  </div>

                  {/* SECTION 2: HVAC & Air Handling */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#14141A] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenRoomSection('hvac')}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 font-semibold text-[11.5px] text-zinc-800 dark:text-zinc-100">
                        {openRoomSection === 'hvac' ? (
                          <ChevronDown className="w-3.5 h-3.5 text-sky-400" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        <Wind className="w-3.5 h-3.5 text-sky-400" />
                        HVAC &amp; Air Handling
                      </span>
                      <span className="flex items-center gap-1 font-mono text-[10px] tabular-nums text-sky-500">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ahuColor }} />
                        {roomHvac.ahuId} · {roomHvac.hepaClass}
                      </span>
                    </button>
                    {openRoomSection === 'hvac' && (
                      <div className="px-3 pb-3 pt-2 space-y-2.5 border-t border-zinc-200/70 dark:border-zinc-800">
                        {/* Live Airflow Readout + 3D Duct Toggle */}
                        <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-sky-500/10 border border-sky-500/25">
                          <div>
                            <div className="text-[9.5px] uppercase tracking-wider text-sky-500 font-semibold">
                              Calculated Supply Airflow
                            </div>
                            <div className="font-mono text-sm font-bold tabular-nums text-zinc-900 dark:text-white">
                              {supplyM3h.toLocaleString()} m³/h
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowHvacOverlay(!showHvacOverlay)}
                            className={`px-2 py-1 rounded-lg text-[10.5px] font-semibold transition-colors cursor-pointer ${
                              showHvacOverlay
                                ? 'bg-sky-500 text-white'
                                : 'bg-white dark:bg-[#1B1B24] border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200'
                            }`}
                          >
                            {showHvacOverlay ? '3D Ducts On' : 'Show 3D Ducts'}
                          </button>
                        </div>

                        <fieldset disabled={isReadOnly} className="space-y-2.5 min-w-0 disabled:opacity-80">
                          <label className="block space-y-1">
                            <span className="text-[10px] text-slate-400">Assigned Air Handling Unit (AHU)</span>
                            <select
                              value={roomHvac.ahuId}
                              onChange={(e) => {
                                const picked = AHU_CATALOG.find((a) => a.id === e.target.value);
                                updateRoomHvac(selRoom.id, {
                                  ahuId: e.target.value,
                                  ahuName: picked?.name ?? e.target.value,
                                });
                              }}
                              className="w-full px-2 py-1.5 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700 text-[11px]"
                            >
                              {AHU_CATALOG.map((ahu) => (
                                <option key={ahu.id} value={ahu.id}>
                                  {ahu.id} — {ahu.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <div className="grid grid-cols-2 gap-2">
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">HEPA / ULPA Class</span>
                              <select
                                value={roomHvac.hepaClass}
                                onChange={(e) => updateRoomHvac(selRoom.id, { hepaClass: e.target.value as any })}
                                className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700 text-[11px]"
                              >
                                {HEPA_CLASSES.map((hc) => (
                                  <option key={hc} value={hc}>{hc}</option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">System Status</span>
                              <select
                                value={roomHvac.status}
                                onChange={(e) => updateRoomHvac(selRoom.id, { status: e.target.value as any })}
                                className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700 text-[11px] capitalize"
                              >
                                <option value="online">Online · Nominal</option>
                                <option value="alarm">Alarm / ΔP Drift</option>
                                <option value="maintenance">Maintenance</option>
                                <option value="standby">Standby</option>
                              </select>
                            </label>
                          </div>

                          <label className="block space-y-1">
                            <span className="text-[10px] text-slate-400">Airflow Pattern</span>
                            <select
                              value={roomHvac.airflowMode}
                              onChange={(e) => updateRoomHvac(selRoom.id, { airflowMode: e.target.value as any })}
                              className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700 text-[11px]"
                            >
                              {AIRFLOW_MODES.map((m) => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                              ))}
                            </select>
                          </label>

                          <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">Pressure ΔP (Pa)</span>
                              <input
                                type="number"
                                value={selRoom.environmental.pressurePa}
                                onChange={(e) =>
                                  updateRoomHvac(selRoom.id, { targetPressurePa: Number(e.target.value) })
                                }
                                className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">Air Changes (ACH)</span>
                              <input
                                type="number"
                                min={1}
                                max={120}
                                value={selRoom.environmental.airChangesPerHour}
                                onChange={(e) =>
                                  updateRoomHvac(selRoom.id, { airChangesPerHour: Math.max(1, Number(e.target.value)) })
                                }
                                className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">Supply Temp (°C)</span>
                              <input
                                type="number"
                                step={0.5}
                                value={roomHvac.supplyTempC}
                                onChange={(e) =>
                                  updateRoomHvac(selRoom.id, { supplyTempC: Number(e.target.value) })
                                }
                                className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">HEPA Diffusers</span>
                              <input
                                type="number"
                                min={1}
                                max={12}
                                value={roomHvac.diffuserCount}
                                onChange={(e) =>
                                  updateRoomHvac(selRoom.id, {
                                    diffuserCount: Math.max(1, Math.min(12, Math.round(Number(e.target.value)))),
                                  })
                                }
                                className="w-full px-2 py-1 rounded bg-white dark:bg-[#101015] border border-slate-200 dark:border-zinc-700"
                              />
                            </label>
                          </div>

                          <label className="block space-y-1">
                            <div className="flex justify-between text-[10px] text-slate-400 font-mono tabular-nums">
                              <span>VAV Damper Opening</span>
                              <span className="font-semibold text-sky-500">{roomHvac.damperPct}%</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={roomHvac.damperPct}
                              onChange={(e) =>
                                updateRoomHvac(selRoom.id, { damperPct: Number(e.target.value) })
                              }
                              className="w-full accent-sky-500"
                            />
                          </label>
                        </fieldset>
                      </div>
                    )}
                  </div>

                  {/* SECTION 2B: Room Lighting & Wall Switch Designer */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#14141A] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenRoomSection('lighting')}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 font-semibold text-[11.5px] text-zinc-800 dark:text-zinc-100">
                        {openRoomSection === 'lighting' ? (
                          <ChevronDown className="w-3.5 h-3.5 text-amber-500" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                        Lighting &amp; Wall Switches
                      </span>
                      <span className="font-mono text-[10px] text-amber-500">Day / Night</span>
                    </button>
                    {openRoomSection === 'lighting' && (
                      <div className="p-2.5 border-t border-zinc-200/70 dark:border-zinc-800">
                        <LightingDesignerPanel fixedRoomId={selRoom.id} compact />
                      </div>
                    )}
                  </div>

                  {/* SECTION 3: Live Room Sensors */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#14141A] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenRoomSection('sensors')}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 font-semibold text-[11.5px] text-zinc-800 dark:text-zinc-100">
                        {openRoomSection === 'sensors' ? (
                          <ChevronDown className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        <Activity className="w-3.5 h-3.5 text-emerald-500" />
                        Live Room Sensors
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                        {roomSensors.length} tags
                      </span>
                    </button>
                    {openRoomSection === 'sensors' && (
                      <div className="px-3 pb-3 pt-2 space-y-2 border-t border-zinc-200/70 dark:border-zinc-800">
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => setHeatmapMetric('temperature')}
                            className="text-[10.5px] text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                          >
                            Show 3D Thermal Heatmap
                          </button>
                          <a
                            href={buildTelemetryTabUrl({ tab: 'trends', roomId: selRoom.id })}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10.5px] text-zinc-400 hover:text-emerald-500"
                            title="Open Room Telemetry in New Tab"
                          >
                            Console <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        {roomSensors.map((s) => {
                          const snap = telemetryReadings[s.id];
                          const col = METRIC_PRESETS[s.metric]?.color ?? '#10B981';
                          return (
                            <button
                              key={s.id}
                              onClick={() =>
                                openTelemetryDashboard({ tab: 'trends', roomId: selRoom.id, sensorId: s.id })
                              }
                              className="w-full flex items-center justify-between gap-2 p-2 rounded-md bg-white dark:bg-[#101015] border border-zinc-200 dark:border-zinc-800 hover:border-emerald-500 text-left"
                            >
                              <div className="min-w-0">
                                <div className="font-mono text-[10.5px] font-semibold truncate">{s.tag}</div>
                                <div className="font-mono tabular-nums text-xs text-zinc-900 dark:text-white">
                                  {(snap?.value ?? s.nominal).toFixed(s.precision)} {s.unit}
                                </div>
                              </div>
                              <MiniSparkline points={snap?.history ?? []} color={col} width={62} height={20} />
                            </button>
                          );
                        })}
                        {roomSensors.length === 0 && (
                          <div className="text-[11px] text-zinc-500 py-1">No live room sensors bound yet.</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* SECTION 4: FMEA Risks & Drifts */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#14141A] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenRoomSection('fmea')}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 font-semibold text-[11.5px] text-zinc-800 dark:text-zinc-100">
                        {openRoomSection === 'fmea' ? (
                          <ChevronDown className="w-3.5 h-3.5 text-rose-500" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                        FMEA Risks &amp; Drifts
                      </span>
                      <span className={`px-1.5 py-0.5 rounded border font-mono text-[9.5px] font-bold tabular-nums ${fmeaToneClass}`}>
                        {roomFmea.shortLabel || 'CLEAR'}
                      </span>
                    </button>
                    {openRoomSection === 'fmea' && (
                      <div className="p-2.5 border-t border-zinc-200/70 dark:border-zinc-800">
                        <EntityRisksSection
                          compact
                          targetKind="room"
                          targetId={selRoom.id}
                          targetCode={selRoom.code}
                          targetName={selRoom.name}
                          floorId={selRoom.floorId}
                          roomId={selRoom.id}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Selected WALL Properties */}
          {selWall && (
            <fieldset disabled={isReadOnly} className="space-y-3 min-w-0 disabled:opacity-80">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-zinc-800">
                <div>
                  <div className="text-[10px] text-violet-500 font-medium">Architectural Wall</div>
                  <div className="font-semibold text-sm">{selWall.name}</div>
                </div>
                {!isReadOnly && (
                  <button onClick={deleteSelected} className="p-1.5 rounded text-red-500 hover:bg-red-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] text-slate-400">Wall Construction Preset</span>
                <select
                  value={selWall.presetId}
                  onChange={(e) => {
                    const preset = WALL_PRESETS.find((p) => p.id === (e.target.value as WallPresetId));
                    if (preset) {
                      updateWall(selWall.id, {
                        presetId: preset.id,
                        thickness: preset.thickness,
                        height: preset.height,
                        materialId: preset.materialId,
                        color: preset.color,
                        opacity: preset.opacity,
                        fireRating: preset.fireRating,
                        acousticRatingDb: preset.acousticRatingDb,
                      });
                    }
                  }}
                  className="w-full px-2 py-1.5 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                >
                  {WALL_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>

              <div className="space-y-2">
                <div className="flex justify-between text-[11px]">
                  <span>Wall Height</span>
                  <span className="font-mono">{selWall.height.toFixed(2)} m</span>
                </div>
                <input
                  type="range"
                  min={2.2}
                  max={6.5}
                  step={0.1}
                  value={selWall.height}
                  onChange={(e) => updateWall(selWall.id, { height: Number(e.target.value) })}
                  className="w-full"
                />
                <div className="flex justify-between text-[11px]">
                  <span>Thickness</span>
                  <span className="font-mono">{Math.round(selWall.thickness * 1000)} mm</span>
                </div>
                <input
                  type="range"
                  min={0.08}
                  max={0.4}
                  step={0.02}
                  value={selWall.thickness}
                  onChange={(e) => updateWall(selWall.id, { thickness: Number(e.target.value) })}
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-500">
                <div>Fire: {selWall.fireRating}</div>
                <div>Acoustic: {selWall.acousticRatingDb} dB</div>
              </div>

              {!isReadOnly && (
                <button
                  onClick={() => splitWall(selWall.id)}
                  className="w-full py-1.5 rounded border border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C] font-medium"
                >
                  Split Wall at Midpoint
                </button>
              )}
            </fieldset>
          )}

          {/* Selected OPENING (Door/Window) Properties */}
          {selOpening && (
            <fieldset disabled={isReadOnly} className="space-y-3 min-w-0 disabled:opacity-80">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-zinc-800">
                <div>
                  <div className="text-[10px] text-violet-500 font-medium capitalize">{selOpening.kind} Opening</div>
                  <div className="font-semibold text-sm">{selOpening.name}</div>
                </div>
                {!isReadOnly && (
                  <button onClick={deleteSelected} className="p-1.5 rounded text-red-500 hover:bg-red-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono">
                <label className="space-y-1">
                  <span className="text-[10px] text-slate-400">Width (m)</span>
                  <input
                    type="number"
                    step={0.1}
                    value={selOpening.width}
                    onChange={(e) => updateOpening(selOpening.id, { width: Math.max(0.6, Number(e.target.value)) })}
                    className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-slate-400">Height (m)</span>
                  <input
                    type="number"
                    step={0.1}
                    value={selOpening.height}
                    onChange={(e) => updateOpening(selOpening.id, { height: Math.max(0.6, Number(e.target.value)) })}
                    className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-[10px] text-slate-400">Position Along Wall ({Math.round(selOpening.offsetRatio * 100)}%)</span>
                <input
                  type="range"
                  min={0.15}
                  max={0.85}
                  step={0.02}
                  value={selOpening.offsetRatio}
                  onChange={(e) => updateOpening(selOpening.id, { offsetRatio: Number(e.target.value) })}
                  className="w-full"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] text-slate-400">Operational State</span>
                <select
                  value={selOpening.status}
                  onChange={(e) => updateOpening(selOpening.id, { status: e.target.value as any })}
                  className="w-full px-2 py-1.5 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                >
                  <option value="closed">Closed</option>
                  <option value="open">Open</option>
                  <option value="interlocked">GMP Interlocked</option>
                  <option value="alarm">Door Held Open Alarm</option>
                </select>
              </label>
            </fieldset>
          )}

          {/* Selected INTELLIGENT ASSET Properties (Exclusive Single-Subject Accordion) */}
          {selAsset && (() => {
            const assetFmea = getTargetFmeaSummary(riskIncidents, 'asset', selAsset.id);
            const assetFmeaTone =
              assetFmea.level === 'critical'
                ? 'bg-rose-500/15 text-rose-500 border-rose-500/40'
                : assetFmea.level === 'high'
                  ? 'bg-amber-500/15 text-amber-500 border-amber-500/40'
                  : assetFmea.level === 'medium'
                    ? 'bg-violet-500/15 text-violet-400 border-violet-500/40'
                    : assetFmea.level === 'mitigated'
                      ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40'
                      : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/25';
            const gmpRec = gmpComplianceByAssetId[selAsset.id];
            const pillTone = (st?: string) =>
              st === 'overdue'
                ? 'bg-rose-500/15 text-rose-500 border-rose-500/30'
                : st === 'due-soon'
                  ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30';

            return (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                        {selAsset.assetId} · {selAsset.category}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (assetFmea.worstIncident) {
                            openRiskModal({ mode: 'resolve', incidentId: assetFmea.worstIncident.id });
                          } else {
                            setOpenAssetSection('fmea');
                          }
                        }}
                        className={`px-1.5 py-0.5 rounded border font-mono text-[9.5px] font-bold tabular-nums cursor-pointer ${assetFmeaTone}`}
                        title={
                          assetFmea.worstIncident
                            ? `FMEA Status: ${assetFmea.worstIncident.title}`
                            : 'No open FMEA risks on this equipment'
                        }
                      >
                        {assetFmea.shortLabel || 'FMEA OK'}
                      </button>
                    </div>
                    <input
                      value={selAsset.name}
                      disabled={isReadOnly}
                      onChange={(e) => updateAsset(selAsset.id, { name: e.target.value })}
                      className="font-semibold text-sm bg-transparent w-full focus:outline-none text-zinc-900 dark:text-zinc-100 disabled:opacity-90"
                    />
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() =>
                        copyDirectLink(
                          { assetId: selAsset.id, floorId: selAsset.floorId, drillLevel: 'asset' },
                          selAsset.assetId
                        )
                      }
                      className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      title="Copy Direct Asset URL"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                    {!isReadOnly && (
                      <>
                        <button onClick={duplicateSelected} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Duplicate">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={deleteSelected} className="p-1.5 rounded text-red-500 hover:bg-red-500/10" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Org-Wide Same-Type Isolation Action */}
                <div className="flex items-center gap-1.5">
                  {isolatedAssetType?.templateId === selAsset.templateId ? (
                    <button
                      onClick={clearIsolation}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium transition-colors"
                    >
                      <Focus className="w-3.5 h-3.5" />
                      Exit Org Isolation ({isolatedAssetType.count} shown)
                    </button>
                  ) : (
                    <button
                      onClick={() => isolateSameTypeOrgWide(selAsset.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-zinc-100 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 text-[11px] font-medium transition-colors"
                      title="Isolate every instance of this equipment type across all buildings & floors in the organization"
                    >
                      <Focus className="w-3.5 h-3.5 text-emerald-500" />
                      Isolate Same Type Org-Wide ({orgWideMatchCount})
                    </button>
                  )}
                  <button
                    onClick={() => drillInto('asset', selAsset.id)}
                    className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-[#18181C] hover:border-violet-500 text-zinc-700 dark:text-zinc-200"
                    title="Focus 3D Camera on Asset"
                  >
                    <Compass className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Full Device Identification & FMEA/GMP Compliance PDF */}
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEntityInfo({ type: 'asset', id: selAsset.id })}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11.5px] font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    <Info className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Full Device Info</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openAssetPdfModal(selAsset.id)}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#181820] hover:border-amber-500 text-zinc-800 dark:text-zinc-100 text-[11.5px] font-semibold transition-colors cursor-pointer"
                    title="Generate FMEA Risk & GMP Compliance PDF Report"
                  >
                    <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="truncate">FMEA/GMP PDF</span>
                  </button>
                </div>

                {/* Contextual IT / Network 42U Rack Designer Launcher */}
                {(selAsset.category === 'IT & Data Center' || selAsset.rackConfig) && (
                  <button
                    onClick={() => openRackDesigner(selAsset.id)}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl gradian-violet-amber text-white text-xs font-semibold shadow-sm hover:opacity-95 transition-opacity cursor-pointer"
                  >
                    <Server className="w-3.5 h-3.5" />
                    Open 42U Rack, Ports &amp; Patch Designer
                  </button>
                )}

                {/* Exclusive Single-Subject Accordion for Equipment */}
                <div className="space-y-1.5">
                  {/* ACCORDION 1: FMEA Risks & Drifts */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#14141A] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenAssetSection('fmea')}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 font-semibold text-[11.5px] text-zinc-800 dark:text-zinc-100">
                        {openAssetSection === 'fmea' ? (
                          <ChevronDown className="w-3.5 h-3.5 text-rose-500" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                        FMEA Risks &amp; Drifts
                      </span>
                      <span className={`px-1.5 py-0.5 rounded border font-mono text-[9.5px] font-bold tabular-nums ${assetFmeaTone}`}>
                        {assetFmea.shortLabel || 'CLEAR'}
                      </span>
                    </button>
                    {openAssetSection === 'fmea' && (
                      <div className="p-2.5 border-t border-zinc-200/70 dark:border-zinc-800">
                        <EntityRisksSection
                          compact
                          targetKind={selAsset.category === 'IT & Data Center' ? 'network' : 'asset'}
                          targetId={selAsset.id}
                          targetCode={selAsset.assetId}
                          targetName={selAsset.name}
                          floorId={selAsset.floorId}
                          roomId={selAsset.roomId}
                        />
                      </div>
                    )}
                  </div>

                  {/* ACCORDION 2: GMP Compliance, Cal/Qual/PM Dates, SOPs & Labels */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#14141A] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenAssetSection('gmp')}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 font-semibold text-[11.5px] text-zinc-800 dark:text-zinc-100">
                        {openAssetSection === 'gmp' ? (
                          <ChevronDown className="w-3.5 h-3.5 text-violet-500" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        <ShieldCheck className="w-3.5 h-3.5 text-violet-500" />
                        GMP Compliance &amp; SOPs
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                        {gmpRec?.lifecycleEvents.length ?? 0} events
                      </span>
                    </button>
                    {openAssetSection === 'gmp' && (
                      <div className="p-2.5 space-y-2 border-t border-zinc-200/70 dark:border-zinc-800">
                        {gmpRec && (
                          <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                            <div className={`px-2 py-1 rounded-lg border ${pillTone(gmpRec.calibration.status)}`}>
                              <div className="text-[9px] opacity-80">Cal Due</div>
                              <div className="font-mono font-semibold truncate">{gmpRec.calibration.nextDueDate}</div>
                            </div>
                            <div className={`px-2 py-1 rounded-lg border ${pillTone(gmpRec.qualification.status)}`}>
                              <div className="text-[9px] opacity-80">{gmpRec.qualification.stage} Due</div>
                              <div className="font-mono font-semibold truncate">{gmpRec.qualification.nextDueDate}</div>
                            </div>
                            <div className={`px-2 py-1 rounded-lg border ${pillTone(gmpRec.maintenance.status)}`}>
                              <div className="text-[9px] opacity-80">PM Due</div>
                              <div className="font-mono font-semibold truncate">{gmpRec.maintenance.nextDueDate}</div>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => openGmpModal({ tab: 'compliance', assetId: selAsset.id })}
                            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1B1B24] hover:border-violet-500 text-[10.5px] font-semibold text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer"
                          >
                            <History className="w-3 h-3 text-violet-500" />
                            Lifecycle &amp; Dates
                          </button>
                          <button
                            type="button"
                            onClick={() => openGmpModal({ tab: 'sops', assetId: selAsset.id })}
                            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1B1B24] hover:border-violet-500 text-[10.5px] font-semibold text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer"
                          >
                            <BookOpen className="w-3 h-3 text-amber-500" />
                            SOPs &amp; Records
                          </button>
                          <button
                            type="button"
                            onClick={() => openGmpModal({ tab: 'workorders', assetId: selAsset.id })}
                            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1B1B24] hover:border-emerald-500 text-[10.5px] font-semibold text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer"
                          >
                            <Wrench className="w-3 h-3 text-emerald-500" />
                            Work Order
                          </button>
                          <button
                            type="button"
                            onClick={() => openQrLabelModal('designer', [`asset:${selAsset.id}`])}
                            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1B1B24] hover:border-amber-500 text-[10.5px] font-semibold text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer"
                          >
                            <QrCode className="w-3 h-3 text-amber-500" />
                            QR Label
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ACCORDION 3: Asset Specs, Spatial, Ops, IoT & Docs */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#14141A] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenAssetSection('specs')}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 font-semibold text-[11.5px] text-zinc-800 dark:text-zinc-100">
                        {openAssetSection === 'specs' ? (
                          <ChevronDown className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        <Sliders className="w-3.5 h-3.5 text-emerald-500" />
                        Engineering Specs &amp; Telemetry
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400 uppercase">
                        {assetSubTab}
                      </span>
                    </button>

                    {openAssetSection === 'specs' && (
                      <div className="p-2.5 space-y-3 border-t border-zinc-200/70 dark:border-zinc-800">
                        {/* Sub-tabs for Intelligent Object Data */}
                        <div className="grid grid-cols-5 gap-1 p-0.5 rounded-md bg-zinc-100 dark:bg-[#0D0D10] border border-zinc-200/70 dark:border-zinc-800">
                          {(['general', 'spatial', 'ops', 'iot', 'docs'] as const).map((st) => (
                            <button
                              key={st}
                              onClick={() => setAssetSubTab(st)}
                              className={`py-1 rounded text-[10px] font-medium capitalize ${
                                assetSubTab === st ? 'bg-white dark:bg-[#1C1C21] text-emerald-600 dark:text-emerald-400 shadow-xs' : 'text-zinc-500'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>

              {assetSubTab === 'general' && (
                <fieldset disabled={isReadOnly} className="space-y-2 min-w-0 disabled:opacity-80">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Asset Tag</span>
                      <input
                        value={selAsset.assetId}
                        onChange={(e) => updateAsset(selAsset.id, { assetId: e.target.value })}
                        className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700 font-mono"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Criticality</span>
                      <select
                        value={selAsset.criticality}
                        onChange={(e) => updateAsset(selAsset.id, { criticality: e.target.value as any })}
                        className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                      >
                        <option value="gmp-critical">GMP Critical</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div><span className="text-slate-400 block text-[10px]">Manufacturer</span>{selAsset.manufacturer}</div>
                    <div><span className="text-slate-400 block text-[10px]">Model</span>{selAsset.model}</div>
                    <div><span className="text-slate-400 block text-[10px]">Owner</span>{selAsset.owner}</div>
                    <div><span className="text-slate-400 block text-[10px]">Responsible</span>{selAsset.responsiblePerson}</div>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pt-1 border-t border-slate-200 dark:border-zinc-800">
                    {selAsset.description}
                  </p>
                </fieldset>
              )}

              {assetSubTab === 'spatial' && (
                <fieldset disabled={isReadOnly} className="space-y-3 font-mono tabular-nums min-w-0 disabled:opacity-80">
                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Pos X (m)</span>
                      <input
                        type="number"
                        step={0.25}
                        value={selAsset.x}
                        onChange={(e) => updateAsset(selAsset.id, { x: Number(e.target.value) })}
                        className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Elev Y (m)</span>
                      <input
                        type="number"
                        step={0.1}
                        value={selAsset.y}
                        onChange={(e) => updateAsset(selAsset.id, { y: Number(e.target.value) })}
                        className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Pos Z (m)</span>
                      <input
                        type="number"
                        step={0.25}
                        value={selAsset.z}
                        onChange={(e) => updateAsset(selAsset.id, { z: Number(e.target.value) })}
                        className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                      />
                    </label>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Rotation Y</span>
                      <span>{Math.round((selAsset.rotationY * 180) / Math.PI)}°</span>
                    </div>
                    <div className="flex gap-1">
                      {[0, 45, 90, 180, 270].map((deg) => (
                        <button
                          key={deg}
                          onClick={() => updateAsset(selAsset.id, { rotationY: (deg * Math.PI) / 180 })}
                          className="flex-1 py-1 rounded bg-slate-100 dark:bg-[#1C1C24] hover:bg-violet-600 hover:text-white text-[10px]"
                        >
                          {deg}°
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Width</span>
                      <input
                        type="number"
                        step={0.1}
                        value={selAsset.width}
                        onChange={(e) => updateAsset(selAsset.id, { width: Math.max(0.3, Number(e.target.value)) })}
                        className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Depth</span>
                      <input
                        type="number"
                        step={0.1}
                        value={selAsset.depth}
                        onChange={(e) => updateAsset(selAsset.id, { depth: Math.max(0.3, Number(e.target.value)) })}
                        className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-slate-400">Height</span>
                      <input
                        type="number"
                        step={0.1}
                        value={selAsset.height}
                        onChange={(e) => updateAsset(selAsset.id, { height: Math.max(0.3, Number(e.target.value)) })}
                        className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                      />
                    </label>
                  </div>
                </fieldset>
              )}

              {assetSubTab === 'ops' && (
                <fieldset disabled={isReadOnly} className="space-y-2 min-w-0 disabled:opacity-80">
                  <label className="block space-y-1">
                    <span className="text-[10px] text-slate-400">Operational Status</span>
                    <select
                      value={selAsset.operationalStatus}
                      onChange={(e) => updateAsset(selAsset.id, { operationalStatus: e.target.value as any })}
                      className="w-full px-2 py-1.5 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
                    >
                      <option value="running">Running · Nominal</option>
                      <option value="standby">Standby</option>
                      <option value="commissioning">IQ/OQ Commissioning</option>
                      <option value="maintenance-due">Preventive Maintenance Due</option>
                      <option value="offline">Offline</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px] pt-1">
                    <div><span className="text-slate-400 block text-[10px]">CapEx</span>{formatCurrency(selAsset.capexUsd)}</div>
                    <div><span className="text-slate-400 block text-[10px]">Annual OpEx</span>{formatCurrency(selAsset.annualOpexUsd)}</div>
                    <div><span className="text-slate-400 block text-[10px]">Utilization</span>{selAsset.utilizationPct}%</div>
                    <div><span className="text-slate-400 block text-[10px]">Energy Load</span>{selAsset.energyKw} kW</div>
                    <div><span className="text-slate-400 block text-[10px]">Next PM</span>{selAsset.nextMaintenance}</div>
                    <div><span className="text-slate-400 block text-[10px]">Condition</span>{selAsset.conditionScore}/100</div>
                  </div>
                </fieldset>
              )}

              {assetSubTab === 'iot' && (
                <div className="space-y-3">
                  <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-[#16161A] border border-zinc-200 dark:border-zinc-800 space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between"><span className="text-zinc-400">Protocol</span><span>{selAsset.connectivity.protocol}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">PLC Tag</span><span>{selAsset.connectivity.plcTag}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">SCADA</span><span>{selAsset.connectivity.scadaNode}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">Historian</span><span>{selAsset.connectivity.historianId}</span></div>
                  </div>

                  {/* Live Real-Time Sensors from Mock Telemetry Database */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-emerald-500" /> Live Sensor Tags
                      </div>
                      <button
                        onClick={() => openTelemetryDashboard({ tab: 'define', assetId: selAsset.id })}
                        className="flex items-center gap-1 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                      >
                        <Plus className="w-3 h-3" /> Define Tag
                      </button>
                    </div>

                    {telemetrySensors
                      .filter((s) => s.targetKind === 'asset' && s.targetId === selAsset.id)
                      .map((s) => {
                        const snap = telemetryReadings[s.id];
                        const val = snap?.value ?? s.nominal;
                        const status = snap?.status ?? 'nominal';
                        const col =
                          status === 'alarm'
                            ? '#EF4444'
                            : status === 'warning'
                              ? '#F59E0B'
                              : METRIC_PRESETS[s.metric]?.color ?? '#10B981';

                        return (
                          <button
                            key={s.id}
                            onClick={() =>
                              openTelemetryDashboard({ tab: 'trends', assetId: selAsset.id, sensorId: s.id })
                            }
                            className="w-full p-2 rounded-lg bg-zinc-50 dark:bg-[#16161A] border border-zinc-200 dark:border-zinc-800 hover:border-emerald-500 flex items-center justify-between gap-2 text-left transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10.5px] font-semibold text-zinc-900 dark:text-zinc-100">
                                  {s.tag}
                                </span>
                                {s.isMainSensor && (
                                  <span className="text-[9.5px] text-amber-500 font-medium">Main</span>
                                )}
                              </div>
                              <div className="text-[10.5px] text-zinc-500 truncate">
                                {s.name.split('·').pop()?.trim() || s.name}
                              </div>
                              <div className="mt-0.5 font-mono tabular-nums text-xs font-semibold text-zinc-900 dark:text-white">
                                {val.toFixed(s.precision)} <span className="text-zinc-400 font-normal">{s.unit}</span>
                              </div>
                            </div>
                            <MiniSparkline points={snap?.history ?? []} color={col} width={64} height={22} />
                          </button>
                        );
                      })}

                    {telemetrySensors.filter((s) => s.targetKind === 'asset' && s.targetId === selAsset.id).length === 0 &&
                      selAsset.connectivity.liveMetrics.map((m, i) => (
                        <div key={i} className="flex items-center justify-between py-1.5 border-b border-zinc-200 dark:border-zinc-800 font-mono text-[11px]">
                          <span className="text-zinc-500">{m.label}</span>
                          <span className={m.status === 'warn' ? 'text-amber-500 font-semibold' : 'text-zinc-900 dark:text-white'}>
                            {m.value} {m.unit}
                          </span>
                        </div>
                      ))}
                  </div>

                  {/* Direct Detailed Dashboard & New Tab Actions */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      onClick={() => openTelemetryDashboard({ tab: 'trends', assetId: selAsset.id })}
                      className="py-1.5 px-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium flex items-center justify-center gap-1"
                    >
                      <Activity className="w-3.5 h-3.5" /> Live Console
                    </button>
                    <a
                      href={buildTelemetryTabUrl({ tab: 'trends', assetId: selAsset.id })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-1.5 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium flex items-center justify-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> New Tab
                    </a>
                  </div>
                </div>
              )}

              {assetSubTab === 'docs' && (
                <div className="space-y-2">
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-zinc-800 font-mono text-[11px]">
                    <div className="text-[10px] text-slate-400">Digital Twin QR Identifier</div>
                    <div className="text-slate-800 dark:text-slate-100 mt-0.5 break-all">{selAsset.qrCode}</div>
                  </div>
                  <div className="space-y-1.5">
                    {selAsset.documents.map((d) => (
                      <div key={d.id} className="p-2 rounded border border-slate-200 dark:border-zinc-800">
                        <div className="font-medium text-xs">{d.title}</div>
                        <div className="text-[10px] font-mono text-slate-400">{d.kind} · {d.code}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Selected CAMERA Properties (Direction Yaw/Pitch, FOV, LiveCam & Argon2 Credentials) */}
          {selCamera && (() => {
            const dx = selCamera.target[0] - selCamera.position[0];
            const dy = selCamera.target[1] - selCamera.position[1];
            const dz = selCamera.target[2] - selCamera.position[2];
            const horiz = Math.max(0.1, Math.hypot(dx, dz));
            const yawDeg = Math.round(((Math.atan2(dz, dx) * 180) / Math.PI + 360) % 360);
            const pitchDeg = Math.round((Math.atan2(dy, horiz) * 180) / Math.PI);
            const setDir = (nyaw: number, npitch: number) => {
              const dist = Math.max(4, Math.hypot(dx, dy, dz));
              const yr = (nyaw * Math.PI) / 180;
              const pr = (npitch * Math.PI) / 180;
              const tx = Number((selCamera.position[0] + Math.cos(pr) * Math.cos(yr) * dist).toFixed(2));
              const ty = Number((selCamera.position[1] + Math.sin(pr) * dist).toFixed(2));
              const tz = Number((selCamera.position[2] + Math.cos(pr) * Math.sin(yr) * dist).toFixed(2));
              updateCamera(selCamera.id, { target: [tx, ty, tz] });
            };
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono text-violet-500 uppercase">
                      IP / CCTV Camera · {selCamera.kind}
                    </div>
                    <input
                      value={selCamera.name}
                      disabled={isReadOnly}
                      onChange={(e) => updateCamera(selCamera.id, { name: e.target.value })}
                      className="font-semibold text-sm bg-transparent w-full focus:outline-none text-zinc-900 dark:text-zinc-100 disabled:opacity-90"
                    />
                  </div>
                  {!isReadOnly && (
                    <button
                      onClick={() => deleteCamera(selCamera.id)}
                      className="p-1.5 rounded text-rose-500 hover:bg-rose-500/10"
                      title="Delete Camera"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => openLiveCamera(selCamera.id)}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl gradian-violet-amber text-white text-[11px] font-semibold"
                  >
                    <Video className="w-3.5 h-3.5" /> LiveCam &amp; Auth
                  </button>
                  <button
                    onClick={() => flyToCamera(selCamera.position, selCamera.target, selCamera.fov)}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-zinc-100 dark:bg-[#1C1C26] border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-[11px] font-semibold"
                  >
                    <Compass className="w-3.5 h-3.5 text-violet-500" /> Go to 3D
                  </button>
                </div>

                <fieldset disabled={isReadOnly} className="space-y-3 min-w-0 disabled:opacity-80">

                <div className="grid grid-cols-3 gap-1.5 font-mono">
                  {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                    <label key={axis} className="space-y-1">
                      <span className="text-[10px] text-zinc-400">Pos {axis} (m)</span>
                      <input
                        type="number"
                        step={0.25}
                        value={selCamera.position[idx]}
                        onChange={(e) => {
                          const pos: [number, number, number] = [...selCamera.position] as any;
                          pos[idx] = Number(e.target.value);
                          updateCamera(selCamera.id, { position: pos });
                        }}
                        className="w-full px-2 py-1 rounded bg-zinc-100 dark:bg-[#14141A] border border-zinc-200 dark:border-zinc-700"
                      />
                    </label>
                  ))}
                </div>

                <div className="space-y-2">
                  <label className="block space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span>Pan Direction (Yaw)</span>
                      <span className="font-mono text-violet-500">{yawDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={359}
                      value={yawDeg}
                      onChange={(e) => setDir(Number(e.target.value), pitchDeg)}
                      className="w-full accent-violet-500"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span>Tilt Direction (Pitch)</span>
                      <span className="font-mono text-violet-500">{pitchDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min={-75}
                      max={45}
                      value={pitchDeg}
                      onChange={(e) => setDir(yawDeg, Number(e.target.value))}
                      className="w-full accent-violet-500"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span>Field of View (FOV)</span>
                      <span className="font-mono text-amber-500">{selCamera.fov}°</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={120}
                      value={selCamera.fov}
                      onChange={(e) => updateCamera(selCamera.id, { fov: Number(e.target.value) })}
                      className="w-full accent-amber-500"
                    />
                  </label>
                </div>
                </fieldset>

                <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-[#16161E] border border-zinc-200 dark:border-zinc-800 space-y-1 font-mono text-[10.5px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">IP Endpoint</span>
                    <span className="text-zinc-900 dark:text-white">
                      {selCamera.ipAddress ? `${selCamera.ipAddress}:${selCamera.port ?? 554}` : 'Unassigned'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Auth Credentials</span>
                    <span className={selCamera.hasCredentials ? 'text-emerald-500' : 'text-amber-500'}>
                      {selCamera.hasCredentials ? 'Argon2id Protected' : 'Configure in LiveCam'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Selected FLOW ROUTE Properties (Modify Nodes + Animation + Legend) */}
          {selFlow && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono text-violet-500 uppercase">
                    Process / Logistics Flow · {selFlow.points.length} Nodes
                  </div>
                  <input
                    value={selFlow.name}
                    disabled={isReadOnly}
                    onChange={(e) => updateFlowRoute(selFlow.id, { name: e.target.value })}
                    className="font-semibold text-sm bg-transparent w-full focus:outline-none text-zinc-900 dark:text-zinc-100 disabled:opacity-90"
                  />
                </div>
                {!isReadOnly && (
                  <button
                    onClick={() => deleteFlowRoute(selFlow.id)}
                    className="p-1.5 rounded text-rose-500 hover:bg-rose-500/10"
                    title="Delete Flow"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {!isReadOnly && (
                <button
                  onClick={() => {
                    setEditingFlowId(editingFlowId === selFlow.id ? null : selFlow.id);
                    setViewMode('split');
                  }}
                  className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                    editingFlowId === selFlow.id
                      ? 'bg-amber-500 text-zinc-950'
                      : 'bg-violet-600 hover:bg-violet-500 text-white'
                  }`}
                >
                  <Waypoints className="w-3.5 h-3.5" />
                  {editingFlowId === selFlow.id ? 'Exit Node Modify Mode' : 'Modify Flow Nodes in 2D'}
                </button>
              )}

              <fieldset disabled={isReadOnly} className="grid grid-cols-2 gap-2 min-w-0 disabled:opacity-80">
                <label className="space-y-1">
                  <span className="text-[10px] text-zinc-400">Flow Type</span>
                  <select
                    value={selFlow.flowType}
                    onChange={(e) => updateFlowRoute(selFlow.id, { flowType: e.target.value as FlowType })}
                    className="w-full px-2 py-1.5 rounded bg-zinc-100 dark:bg-[#14141A] border border-zinc-200 dark:border-zinc-700 capitalize"
                  >
                    {(['personnel', 'material', 'product', 'waste', 'utility', 'airflow', 'evacuation', 'maintenance'] as FlowType[]).map(
                      (ft) => (
                        <option key={ft} value={ft}>{ft}</option>
                      )
                    )}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-zinc-400">Route Color</span>
                  <input
                    type="color"
                    value={selFlow.color}
                    onChange={(e) => updateFlowRoute(selFlow.id, { color: e.target.value })}
                    className="w-full h-8 rounded bg-zinc-100 dark:bg-[#14141A] border border-zinc-200 dark:border-zinc-700 p-0.5"
                  />
                </label>
              </fieldset>

              <div className="flex items-center justify-between gap-2 pt-1">
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={animateFlows && selFlow.animated !== false}
                    onChange={(e) => {
                      setAnimateFlows(e.target.checked);
                      updateFlowRoute(selFlow.id, { animated: e.target.checked });
                    }}
                    className="accent-violet-500"
                  />
                  Animated Pulses
                </label>
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showFlowLegend}
                    onChange={(e) => setShowFlowLegend(e.target.checked)}
                    className="accent-violet-500"
                  />
                  Show Legend
                </label>
              </div>
            </div>
          )}

          {/* Default Floor Summary when nothing selected */}
          {!selRoom && !selWall && !selOpening && !selAsset && !selCamera && !selFlow && selFloor && (
            <div className="space-y-3">
              <div className="pb-2 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] text-zinc-400">Active Floor Inspector</div>
                  <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{selFloor.name}</div>
                  <div className="font-mono text-[11px] text-zinc-500">
                    {selFloor.code} · Elev +{selFloor.elevation.toFixed(2)} m · H {selFloor.height} m
                  </div>
                </div>
                <button
                  onClick={() =>
                    copyDirectLink({ floorId: selFloor.id, drillLevel: 'floor' }, selFloor.name)
                  }
                  className="p-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-300 shrink-0"
                  title="Copy Direct Floor URL"
                >
                  <Link2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2.5 font-mono tabular-nums">
                <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-[#161619] border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[10px] text-zinc-400">Gross Slab</div>
                  <div className="text-sm font-semibold mt-0.5">{formatArea(kpis.slabArea, scene.unitSystem)}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-[#161619] border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[10px] text-zinc-400">Assigned Rooms</div>
                  <div className="text-sm font-semibold mt-0.5">{formatArea(kpis.totalRoomArea, scene.unitSystem)}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-[#161619] border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[10px] text-zinc-400">Rooms</div>
                  <div className="text-sm font-semibold mt-0.5">{kpis.roomCount}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-[#161619] border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[10px] text-zinc-400">Smart Assets</div>
                  <div className="text-sm font-semibold mt-0.5">{kpis.assetCount}</div>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Select any room, wall, door, window, or equipment object in 2D or 3D to inspect dimensions, isolate same-type assets organization-wide, copy direct deep links, or edit GMP telemetry.
              </p>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: VISUAL MATERIAL DESIGNER */}
      {rightTab === 'materials' && (
        <div className="flex-1 flex flex-col overflow-hidden text-xs">
          <div className="p-2.5 border-b border-slate-200 dark:border-zinc-800 space-y-2">
            <div className="flex gap-1.5">
              <button
                onClick={() => setActiveTool('paint-material')}
                className="flex-1 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white font-medium"
              >
                Activate Paint Tool
              </button>
              <button
                onClick={() => texInputRef.current?.click()}
                className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C] flex items-center gap-1"
                title="Upload Custom Texture"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              <input ref={texInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadCustomTexture} />
            </div>
            {primarySel && (primarySel.type === 'room' || primarySel.type === 'wall' || primarySel.type === 'asset') && (
              <button
                onClick={() => paintSurfaceWithMaterial(primarySel.type as any, primarySel.id, selectedMaterialId)}
                className="w-full py-1.5 rounded border border-violet-500 text-violet-600 dark:text-violet-400 font-medium hover:bg-violet-500/10"
              >
                Apply Selected Material to Active {primarySel.type}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 grid grid-cols-2 gap-2 content-start">
            {allMaterials.map((mat) => {
              const active = selectedMaterialId === mat.id;
              return (
                <div
                  key={mat.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-gradian-material', mat.id);
                    setSelectedMaterialId(mat.id);
                  }}
                  onClick={() => setSelectedMaterialId(mat.id)}
                  className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                    active ? 'border-violet-500 bg-violet-500/5' : 'border-slate-200 dark:border-zinc-800 hover:border-slate-400'
                  }`}
                >
                  <div
                    className="h-10 rounded-md border border-black/10 mb-1.5 bg-cover bg-center"
                    style={{
                      backgroundColor: mat.baseColor,
                      backgroundImage: mat.customTextureDataUrl ? `url(${mat.customTextureDataUrl})` : undefined,
                    }}
                  />
                  <div className="text-[11px] font-medium truncate">{mat.name}</div>
                  <div className="text-[10px] font-mono text-slate-400">
                    R:{mat.roughness} M:{mat.metalness}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: CAMERAS & VIEWPOINTS */}
      {rightTab === 'cameras' && (
        <div className="flex-1 flex flex-col overflow-hidden text-xs">
          <div className="p-2.5 border-b border-slate-200 dark:border-zinc-800 space-y-1.5">
            <button
              onClick={() => setShowCameraManager(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl gradian-violet-amber text-white font-semibold shadow-sm"
            >
              <Video className="w-3.5 h-3.5" /> Open Camera Command Panel &amp; LiveCam
            </button>
            <div className="flex gap-1.5">
              <button
                onClick={() => setActiveTool('place-camera')}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Place Camera
              </button>
              <button
                onClick={playCameraTour}
                className="px-3 py-1.5 rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C] flex items-center gap-1"
              >
                <Play className="w-3.5 h-3.5" /> Tour
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {scene.cameras
              .filter((c) => c.floorId === activeFloorId)
              .map((cam) => (
                <div key={cam.id} className="p-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{cam.name}</div>
                      <div className="text-[10px] font-mono text-slate-400 truncate">
                        {cam.kind} · FOV {cam.fov}° {cam.ipAddress ? `· ${cam.ipAddress}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteCamera(cam.id)}
                      className="p-1 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openLiveCamera(cam.id)}
                      className="flex-1 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors flex items-center justify-center gap-1"
                    >
                      <Video className="w-3 h-3" /> LiveCam
                    </button>
                    <button
                      onClick={() => flyToCamera(cam.position, cam.target, cam.fov)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#1C1C24] hover:bg-violet-600 hover:text-white font-medium transition-colors"
                    >
                      3D
                    </button>
                    <button
                      onClick={() => updateCamera(cam.id, { visibleCone: !cam.visibleCone })}
                      className={`px-2 py-1 rounded-lg border text-[10px] ${
                        cam.visibleCone ? 'border-emerald-500/50 text-emerald-500' : 'border-slate-300 dark:border-zinc-700 text-slate-400'
                      }`}
                    >
                      FOV
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* TAB 4: SPATIAL ANALYTICS & KPI COLOR OVERLAYS */}
      {rightTab === 'analytics' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
          <div className="space-y-1.5">
            <div className="font-semibold text-slate-900 dark:text-white">3D / 2D Visual Color Overlay</div>
            <select
              value={analyticsMetric}
              onChange={(e) => setAnalyticsMetric(e.target.value as AnalyticsMetric)}
              className="w-full px-2.5 py-2 rounded-md bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700 font-medium"
            >
              {ANALYTICS_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Dynamic Legend */}
          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-800 space-y-1.5">
            <div className="text-[10px] font-semibold text-slate-500">Active Legend</div>
            {getAnalyticsLegend(analyticsMetric).map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-3 h-3 rounded-xs shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-slate-700 dark:text-slate-300">{item.label}</span>
              </div>
            ))}
          </div>

          {/* Floor & Pharma KPIs */}
          <div className="space-y-2">
            <div className="font-semibold text-slate-900 dark:text-white">Active Floor Intelligence</div>
            <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-zinc-800">
                <div className="text-[10px] text-slate-400">Space Efficiency</div>
                <div className="text-base font-semibold">{kpis.efficiencyPct}%</div>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-zinc-800">
                <div className="text-[10px] text-slate-400">Avg Utilization</div>
                <div className="text-base font-semibold">{kpis.avgUtil}%</div>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-zinc-800">
                <div className="text-[10px] text-slate-400">GMP Cleanrooms</div>
                <div className="text-base font-semibold">{kpis.cleanroomCount} / {kpis.roomCount}</div>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-zinc-800">
                <div className="text-[10px] text-slate-400">Equipment CapEx</div>
                <div className="text-base font-semibold">{formatCurrency(kpis.totalCapex)}</div>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-zinc-800 col-span-2">
                <div className="text-[10px] text-slate-400">Active Electrical &amp; Process Load</div>
                <div className="text-base font-semibold">{kpis.totalEnergy.toFixed(1)} kW</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: FLOW & CONNECTIVITY */}
      {rightTab === 'flows' && (
        <div className="flex-1 flex flex-col overflow-hidden text-xs">
          <div className="p-2.5 border-b border-slate-200 dark:border-zinc-800 space-y-2">
            <select
              value={selectedFlowType}
              onChange={(e) => setSelectedFlowType(e.target.value as FlowType)}
              className="w-full px-2 py-1.5 rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700 capitalize"
            >
              {(['personnel', 'material', 'product', 'waste', 'utility', 'airflow', 'evacuation', 'maintenance'] as FlowType[]).map(
                (ft) => (
                  <option key={ft} value={ft}>{ft} Flow Route</option>
                )
              )}
            </select>
            <button
              onClick={() => {
                setActiveTool('draw-flow');
                setViewMode('split');
              }}
              className="w-full py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium"
            >
              Trace New Route in 2D
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setAnimateFlows(!animateFlows)}
                className={`py-1.5 rounded-xl text-[11px] font-medium flex items-center justify-center gap-1 ${
                  animateFlows
                    ? 'bg-violet-500/15 text-violet-500 border border-violet-500/40'
                    : 'bg-zinc-100 dark:bg-[#1B1B24] text-zinc-500'
                }`}
              >
                {animateFlows ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                {animateFlows ? 'Animated On' : 'Static'}
              </button>
              <button
                onClick={() => setShowFlowLegend(!showFlowLegend)}
                className={`py-1.5 rounded-xl text-[11px] font-medium cursor-pointer ${
                  showFlowLegend
                    ? 'bg-amber-500/15 text-amber-500 border border-amber-500/40'
                    : 'bg-zinc-100 dark:bg-[#1B1B24] text-zinc-500'
                }`}
              >
                Legend: {showFlowLegend ? 'Visible' : 'Hidden'}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowFlows(!showFlows)}
                className={`flex-1 py-1.5 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  showFlows
                    ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/35'
                    : 'bg-zinc-100 dark:bg-[#1B1B24] text-zinc-400 border border-zinc-700/40'
                }`}
              >
                {showFlows ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {showFlows ? 'All Flows Visible' : 'All Flows Turned Off'}
              </button>
              {isolatedFlowId && (
                <button
                  onClick={() => isolateFlow(null)}
                  className="px-2.5 py-1.5 rounded-xl bg-amber-500 text-zinc-950 text-[11px] font-bold cursor-pointer"
                >
                  Clear Isolation
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {scene.flows
              .filter((f) => f.floorId === activeFloorId)
              .map((fl) => {
                const isIso = isolatedFlowId === fl.id;
                const isHidden = hiddenFlowIds.includes(fl.id);
                const seq = computeFlowRoomSequence(fl, scene.rooms);
                return (
                  <div
                    key={fl.id}
                    className={`p-2.5 rounded-xl border space-y-1.5 transition-colors ${
                      isIso
                        ? 'border-amber-500/70 bg-amber-500/5'
                        : 'border-slate-200 dark:border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fl.color }} />
                        <span className="font-medium truncate">{fl.name}</span>
                      </div>
                      <button
                        onClick={() => deleteFlowRoute(fl.id)}
                        className="text-slate-400 hover:text-red-500 cursor-pointer"
                        title="Delete Flow Route"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {fl.flowType} · {seq.steps.length} rooms · {seq.totalLengthM}m · {seq.totalTraversedAreaSqm} m²
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        onClick={() => setActiveFlowInfoId(fl.id)}
                        className="py-1 rounded-lg text-[10.5px] font-semibold bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center gap-1 cursor-pointer"
                        title="View Ordered Room Numbers & Areas"
                      >
                        <Info className="w-3 h-3" /> Info
                      </button>
                      <button
                        onClick={() => isolateFlow(fl.id)}
                        className={`py-1 rounded-lg text-[10.5px] font-semibold flex items-center justify-center gap-1 cursor-pointer ${
                          isIso
                            ? 'bg-amber-500 text-zinc-950'
                            : 'bg-zinc-100 dark:bg-[#1C1C26] hover:bg-amber-500 hover:text-zinc-950'
                        }`}
                      >
                        <Focus className="w-3 h-3" /> {isIso ? 'Isolated' : 'Isolate'}
                      </button>
                      <button
                        onClick={() => toggleFlowVisibility(fl.id)}
                        className={`py-1 rounded-lg text-[10.5px] font-semibold flex items-center justify-center gap-1 cursor-pointer ${
                          isHidden
                            ? 'bg-zinc-200 dark:bg-zinc-900 text-zinc-400'
                            : 'bg-zinc-100 dark:bg-[#1C1C26] hover:bg-zinc-700'
                        }`}
                      >
                        {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        {isHidden ? 'Off' : 'On'}
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        setEditingFlowId(editingFlowId === fl.id ? null : fl.id);
                        setViewMode('split');
                      }}
                      className={`w-full py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                        editingFlowId === fl.id
                          ? 'bg-amber-500 text-zinc-950'
                          : 'bg-zinc-100 dark:bg-[#1C1C26] hover:bg-violet-600 hover:text-white'
                      }`}
                    >
                      {editingFlowId === fl.id ? 'Done Modifying Nodes' : 'Modify Flow Nodes'}
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* TAB 6: SPATIAL VALIDATION & SMART WARNINGS */}
      {rightTab === 'validation' && (
        <div className="flex-1 flex flex-col overflow-hidden text-xs">
          <div className="p-2.5 border-b border-slate-200 dark:border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold">GMP &amp; Spatial Audit ({validationIssues.length})</span>
              <button
                onClick={refreshValidation}
                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C]"
              >
                Re-Scan
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => {
                  refreshValidation();
                  setShowSaveValidationModal(true);
                }}
                className="flex items-center justify-center gap-1 py-1.5 rounded-xl gradian-violet-amber text-white font-semibold"
              >
                <Sparkles className="w-3.5 h-3.5" /> Fix with AI &amp; Save
              </button>
              <button
                onClick={() => setShowAuditTrailModal(true)}
                className="flex items-center justify-center gap-1 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 font-medium"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-amber-500" /> Audit Trail
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {validationIssues.length === 0 ? (
              <div className="text-center py-8 text-slate-500 space-y-1.5">
                <Check className="w-7 h-7 mx-auto text-emerald-500" />
                <div className="font-medium text-slate-800 dark:text-slate-200">Zero Spatial Clashes</div>
                <p className="text-[11px]">All rooms, walls, clearances, and equipment bounds pass validation.</p>
              </div>
            ) : (
              validationIssues.map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => {
                    if (issue.entityIds[0]) {
                      focusEntity({
                        type: issue.entityType === 'flow' ? 'flow' : issue.entityType,
                        id: issue.entityIds[0],
                      });
                    }
                  }}
                  className="w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-zinc-800 hover:border-violet-500 transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-mono font-semibold uppercase ${
                        issue.severity === 'critical' || issue.severity === 'error'
                          ? 'text-red-500'
                          : issue.severity === 'warning'
                            ? 'text-amber-500'
                            : 'text-violet-500'
                      }`}
                    >
                      {issue.severity} · {issue.code}
                    </span>
                    <ShieldAlert className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  </div>
                  <div className="font-medium text-slate-900 dark:text-white">{issue.title}</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{issue.description}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 7: LIVE GEMINI AI DIGITAL TWIN COPILOT */}
      {rightTab === 'copilot' && (
        <div className="flex-1 flex flex-col overflow-hidden text-xs">
          {/* Standalone Maya AI Studio Pop-Out */}
          <div className="p-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#14141A]">
            <button
              onClick={() => setShowMayaChat(true)}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl gradian-violet-amber text-white text-xs font-semibold shadow-sm hover:opacity-95 transition-opacity"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Open Full Maya AI Map Designer (Charts &amp; Markdown)
            </button>
          </div>
          {/* Quick Command Chips */}
          <div className="p-2 border-b border-slate-200 dark:border-zinc-800 flex flex-wrap gap-1">
            {[
              'Color rooms by cleanroom grade',
              'Add 2 bioreactors with 1.5m clearance',
              'Make all walls 4.0 meters high',
              'Find equipment requiring maintenance',
            ].map((cmd) => (
              <button
                key={cmd}
                onClick={() => runAICommand(cmd)}
                className="px-2 py-1 rounded bg-slate-100 dark:bg-[#1C1C24] hover:bg-violet-600 hover:text-white text-[10px] transition-colors text-left"
              >
                {cmd}
              </button>
            ))}
          </div>

          {/* Conversation & Proposed Actions */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
            {aiHistory.map((msg, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded-lg ${
                  msg.role === 'user'
                    ? 'bg-violet-600 text-white ml-6'
                    : 'bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-slate-200 mr-2'
                }`}
              >
                <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                {msg.analysis && (
                  <p className="mt-1.5 pt-1.5 border-t border-slate-200 dark:border-zinc-700 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {msg.analysis}
                  </p>
                )}
              </div>
            ))}

            {aiLoading && (
              <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-[#14141A] text-slate-500 font-mono text-[11px]">
                Analyzing spatial hierarchy and drafting previewable actions...
              </div>
            )}

            {aiError && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-[11px]">
                {aiError}
              </div>
            )}

            {/* Preview-Before-Apply Action Plan Card */}
            {pendingAIActions.length > 0 && (
              <div className="p-3 rounded-lg border border-violet-500 bg-violet-500/10 space-y-2.5">
                <div className="font-semibold text-violet-600 dark:text-violet-400">
                  Proposed Actions ({pendingAIActions.length}) — Preview Active
                </div>
                {aiPreviewMessage && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">{aiPreviewMessage}</p>
                )}
                <div className="space-y-1.5">
                  {pendingAIActions.map((act, i) => (
                    <div key={i} className="p-2 rounded bg-white dark:bg-[#14141A] border border-slate-200 dark:border-zinc-800">
                      <div className="font-medium text-slate-900 dark:text-white">{act.title}</div>
                      <div className="text-[11px] text-slate-500">{act.details}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => applyPendingAIActions()}
                    className="flex-1 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold"
                  >
                    Confirm &amp; Apply
                  </button>
                  <button
                    onClick={clearPendingAIActions}
                    className="px-3 py-1.5 rounded border border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C]"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Prompt Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runAICommand();
            }}
            className="p-2.5 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-1.5"
          >
            <input
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              placeholder="Ask AI to design, modify, or analyze..."
              className="flex-1 px-2.5 py-1.5 rounded-md bg-zinc-100 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={undo}
              className="px-2 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 text-[11px]"
              title="Undo last applied AI action"
            >
              Undo
            </button>
            <button
              type="submit"
              disabled={aiLoading || !aiInput.trim()}
              className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}

      {/* TAB 8: CLOUD SQL DATABASE SCHEMA VISUALIZER (D3.js) */}
      {rightTab === 'schema' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <SchemaVisualizerD3 />
        </div>
      )}
    </aside>
  );
};
