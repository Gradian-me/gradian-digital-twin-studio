import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Building2,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  DollarSign,
  Eye,
  FileText,
  Flame,
  Footprints,
  History,
  Info,
  Layers,
  MapPin,
  QrCode,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  UserCheck,
  Wind,
  Wrench,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useRiskIncidentStore, getTargetFmeaSummary } from '../store/useRiskIncidentStore';
import { useAclStore, getActiveAclUser, computeEffectivePermissions } from '../store/useAclStore';
import { useMayaStore } from '../store/useMayaStore';
import { EntityRisksSection } from './RiskFmeaCenter';
import { LiveCctvCanvas } from './CameraManagerModal';
import { RichMarkdownRenderer } from './RichMarkdownRenderer';
import { enrichAssetHistory } from '../data/cinnagenDemo';
import {
  AHU_CATALOG,
  AIRFLOW_MODES,
  HEPA_CLASSES,
  computeRoomSupplyM3h,
  getAhuColor,
  getEffectiveRoomHvac,
} from '../utils/hvac';
import {
  getDefaultRoomOwner,
  getDepartmentCostCenter,
  getEffectiveRoomFireSafety,
  getSceneDepartments,
} from '../utils/fireSafety';
import type { Room, SpatialAsset } from '../types/twin';

interface EligibilityFinding {
  id: string;
  severity: 'blocker' | 'warning';
  category: 'Compliance' | 'Calibration' | 'Qualification' | 'Work Order' | 'Telemetry';
  title: string;
  detail: string;
  targetType: 'asset' | 'room' | 'sensor';
  targetId: string;
}

interface RoomEligibilityReport {
  eligible: boolean;
  checkedAt: string;
  roomCode: string;
  roomName: string;
  totalAssets: number;
  compliantAssets: number;
  activeSensors: number;
  openWorkOrders: number;
  blockers: EligibilityFinding[];
  warnings: EligibilityFinding[];
}

export const EntityInfoModal: React.FC = () => {
  const entityInfoTarget = useTwinStore((s) => s.entityInfoTarget);
  const entityInfoAutoEligibility = useTwinStore((s) => s.entityInfoAutoEligibility);
  const entityInfoInitialTab = useTwinStore((s) => s.entityInfoInitialTab);
  const auditLog = useTwinStore((s) => s.auditLog);
  const closeEntityInfo = useTwinStore((s) => s.closeEntityInfo);
  const openEntityInfo = useTwinStore((s) => s.openEntityInfo);
  const scene = useTwinStore((s) => s.scene);
  const theme = useTwinStore((s) => s.theme);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const selectEntity = useTwinStore((s) => s.selectEntity);
  const flyToCamera = useTwinStore((s) => s.flyToCamera);
  const walkInsideRoom = useTwinStore((s) => s.walkInsideRoom);
  const setScreen = useTwinStore((s) => s.setScreen);
  const showToast = useTwinStore((s) => s.showToast);
  const updateRoom = useTwinStore((s) => s.updateRoom);
  const updateRoomHvac = useTwinStore((s) => s.updateRoomHvac);
  const openLiveCamera = useTwinStore((s) => s.openLiveCamera);
  const setShowHvacOverlay = useTwinStore((s) => s.setShowHvacOverlay);
  const workspaceMode = useTwinStore((s) => s.workspaceMode);
  const startReadingSop = useMayaStore((s) => s.startReadingSop);
  const mayaInteractions = useMayaStore((s) => s.interactions);

  const sops = useGmpStore((s) => s.sops);
  const complianceByAssetId = useGmpStore((s) => s.complianceByAssetId);
  const workOrders = useGmpStore((s) => s.workOrders);
  const productionLines = useGmpStore((s) => s.productionLines);
  const openGmpModal = useGmpStore((s) => s.openGmpModal);
  const openQrLabelModal = useGmpStore((s) => s.openQrLabelModal);

  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const openDashboard = useTelemetryStore((s) => s.openDashboard);

  const [eligibilityReport, setEligibilityReport] = useState<RoomEligibilityReport | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'sops' | 'history' | 'relations' | 'risks'>('overview');
  const [selectedSopId, setSelectedSopId] = useState<string | null>(null);
  const [highlightFireSection, setHighlightFireSection] = useState(false);
  const fireSafetyRef = useRef<HTMLElement | null>(null);
  const riskIncidents = useRiskIncidentStore((s) => s.incidents);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);
  const openAssetPdfModal = useRiskIncidentStore((s) => s.openAssetPdfModal);

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

  const isDark = theme === 'dark';

  const rawAsset: SpatialAsset | null = useMemo(() => {
    if (entityInfoTarget?.type !== 'asset') return null;
    return scene.assets.find((a) => a.id === entityInfoTarget.id) ?? null;
  }, [entityInfoTarget, scene.assets]);

  const asset: SpatialAsset | null = useMemo(
    () => (rawAsset ? enrichAssetHistory(rawAsset) : null),
    [rawAsset]
  );

  const room: Room | null = useMemo(() => {
    if (entityInfoTarget?.type === 'room') {
      return scene.rooms.find((r) => r.id === entityInfoTarget.id) ?? null;
    }
    if (asset?.roomId) {
      return scene.rooms.find((r) => r.id === asset.roomId) ?? null;
    }
    return null;
  }, [entityInfoTarget, scene.rooms, asset]);

  const floor = useMemo(() => {
    const flId = entityInfoTarget?.type === 'asset' ? asset?.floorId : room?.floorId;
    return scene.floors.find((f) => f.id === flId) ?? scene.floors[0] ?? null;
  }, [entityInfoTarget, asset, room, scene.floors]);

  const building = useMemo(() => {
    if (!floor?.buildingId) return scene.buildings?.[0] ?? null;
    return scene.buildings?.find((b) => b.id === floor.buildingId) ?? null;
  }, [floor, scene.buildings]);

  // Reset sub-tab & eligibility report when target changes
  useEffect(() => {
    setActiveSubTab('overview');
    setEligibilityReport(null);
  }, [entityInfoTarget?.type, entityInfoTarget?.id]);

  // Compute Room Eligibility report on demand or automatically
  const evaluateRoomEligibility = (targetRoom: Room): RoomEligibilityReport => {
    const roomAssets = scene.assets.filter((a) => a.roomId === targetRoom.id);
    const roomSensors = sensors.filter(
      (s) =>
        s.targetId === targetRoom.id ||
        roomAssets.some((a) => a.id === s.targetId || a.assetId === s.targetCode)
    );
    const roomWOs = workOrders.filter(
      (wo) =>
        wo.status !== 'completed' &&
        (wo.targetId === targetRoom.id || roomAssets.some((a) => a.id === wo.targetId))
    );

    const blockers: EligibilityFinding[] = [];
    const warnings: EligibilityFinding[] = [];

    if (targetRoom.complianceStatus === 'deviation') {
      blockers.push({
        id: `rm-comp-${targetRoom.id}`,
        severity: 'blocker',
        category: 'Compliance',
        title: `Room ${targetRoom.code} Active GMP Deviation`,
        detail: `Cleanroom ${targetRoom.name} (${targetRoom.environmental.cleanroomGrade}) is flagged in deviation status. QA release required before batch start.`,
        targetType: 'room',
        targetId: targetRoom.id,
      });
    } else if (targetRoom.complianceStatus === 'review-due') {
      warnings.push({
        id: `rm-rev-${targetRoom.id}`,
        severity: 'warning',
        category: 'Compliance',
        title: `Periodic Qualification Review Due`,
        detail: `${targetRoom.name} requires scheduled environmental review sign-off.`,
        targetType: 'room',
        targetId: targetRoom.id,
      });
    }

    roomSensors.forEach((s) => {
      const r = readings[s.id];
      if (!r) return;
      if (r.status === 'alarm') {
        blockers.push({
          id: `sens-alm-${s.id}`,
          severity: 'blocker',
          category: 'Telemetry',
          title: `Sensor ${s.tag} Out-of-Specification (${r.value.toFixed(1)} ${s.unit})`,
          detail: `${s.name} breached GMP limit (${s.alarmLow}–${s.alarmHigh} ${s.unit}).`,
          targetType: 'sensor',
          targetId: s.id,
        });
      } else if (r.status === 'warning') {
        warnings.push({
          id: `sens-warn-${s.id}`,
          severity: 'warning',
          category: 'Telemetry',
          title: `Sensor ${s.tag} Alert Threshold (${r.value.toFixed(1)} ${s.unit})`,
          detail: `${s.name} approaching compliance threshold.`,
          targetType: 'sensor',
          targetId: s.id,
        });
      }
    });

    let compliantAssets = 0;
    roomAssets.forEach((a) => {
      const comp = complianceByAssetId[a.id];
      let assetBlocked = false;
      if (comp) {
        if (comp.calibration.status === 'overdue') {
          assetBlocked = true;
          blockers.push({
            id: `cal-${a.id}`,
            severity: 'blocker',
            category: 'Calibration',
            title: `${a.assetId} Calibration Overdue`,
            detail: `${a.name} calibration expired on ${comp.calibration.nextDueDate}.`,
            targetType: 'asset',
            targetId: a.id,
          });
        } else if (comp.calibration.status === 'due-soon') {
          warnings.push({
            id: `cal-warn-${a.id}`,
            severity: 'warning',
            category: 'Calibration',
            title: `${a.assetId} Calibration Due Soon`,
            detail: `Scheduled calibration due ${comp.calibration.nextDueDate}.`,
            targetType: 'asset',
            targetId: a.id,
          });
        }
        if (comp.qualification.status === 'overdue') {
          assetBlocked = true;
          blockers.push({
            id: `qual-${a.id}`,
            severity: 'blocker',
            category: 'Qualification',
            title: `${a.assetId} Re-Qualification Overdue`,
            detail: `${a.name} OQ/PQ expired on ${comp.qualification.nextDueDate}.`,
            targetType: 'asset',
            targetId: a.id,
          });
        }
        if (comp.maintenance.status === 'overdue') {
          warnings.push({
            id: `pm-warn-${a.id}`,
            severity: 'warning',
            category: 'Work Order',
            title: `${a.assetId} Preventive Maintenance Overdue`,
            detail: `${a.name} PM due ${comp.maintenance.nextDueDate}.`,
            targetType: 'asset',
            targetId: a.id,
          });
        }
      }
      if (a.operationalStatus === 'offline' || a.operationalStatus === 'maintenance-due') {
        assetBlocked = true;
        blockers.push({
          id: `st-maint-${a.id}`,
          severity: 'blocker',
          category: 'Compliance',
          title: `${a.assetId} Out of Service / Maintenance Required`,
          detail: `${a.name} is currently in ${a.operationalStatus} state.`,
          targetType: 'asset',
          targetId: a.id,
        });
      }
      if (!assetBlocked) compliantAssets++;
    });

    roomWOs.forEach((wo) => {
      if (wo.status === 'overdue' || wo.priority === 'critical') {
        blockers.push({
          id: `wo-${wo.id}`,
          severity: 'blocker',
          category: 'Work Order',
          title: `${wo.woNumber} · ${wo.title}`,
          detail: `${wo.status.toUpperCase()} (${wo.priority}) · Due ${wo.dueDate} · Assignee: ${wo.assigneeName}`,
          targetType: wo.targetKind === 'asset' ? 'asset' : 'room',
          targetId: wo.targetId,
        });
      } else {
        warnings.push({
          id: `wo-open-${wo.id}`,
          severity: 'warning',
          category: 'Work Order',
          title: `${wo.woNumber} · ${wo.title}`,
          detail: `Status: ${wo.status} · Due ${wo.dueDate}`,
          targetType: wo.targetKind === 'asset' ? 'asset' : 'room',
          targetId: wo.targetId,
        });
      }
    });

    return {
      eligible: blockers.length === 0,
      checkedAt: new Date().toLocaleTimeString(),
      roomCode: targetRoom.code,
      roomName: targetRoom.name,
      totalAssets: roomAssets.length,
      compliantAssets,
      activeSensors: roomSensors.length,
      openWorkOrders: roomWOs.length,
      blockers,
      warnings,
    };
  };

  useEffect(() => {
    if (!entityInfoTarget) return;
    if (entityInfoInitialTab === 'fire') {
      setActiveSubTab('overview');
      setHighlightFireSection(true);
      const t = window.setTimeout(() => {
        fireSafetyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
      const t2 = window.setTimeout(() => setHighlightFireSection(false), 3600);
      return () => {
        window.clearTimeout(t);
        window.clearTimeout(t2);
      };
    } else if (
      entityInfoInitialTab === 'sops' ||
      entityInfoInitialTab === 'history' ||
      entityInfoInitialTab === 'relations' ||
      entityInfoInitialTab === 'risks'
    ) {
      setActiveSubTab(entityInfoInitialTab);
    } else {
      setActiveSubTab('overview');
    }
    setHighlightFireSection(false);
  }, [entityInfoTarget?.id, entityInfoInitialTab]);

  useEffect(() => {
    if (entityInfoTarget?.type === 'room' && room && entityInfoAutoEligibility) {
      setEligibilityReport(evaluateRoomEligibility(room));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityInfoTarget?.id, entityInfoAutoEligibility, room?.id]);

  // Linked SOPs for current asset or room
  const linkedSops = useMemo(() => {
    if (entityInfoTarget?.type === 'asset' && asset) {
      const explicitIds = asset.sopIds ?? [];
      const explicit = sops.filter((s) => explicitIds.includes(s.id));
      if (explicit.length > 0) return explicit;
      return sops.filter(
        (s) => s.equipmentCategory === asset.category || s.equipmentCategory === 'All Equipment'
      );
    }
    if (entityInfoTarget?.type === 'room' && room) {
      return sops.filter(
        (s) =>
          s.equipmentCategory === 'Facility / Room' ||
          s.equipmentCategory === 'All Equipment' ||
          /cleanroom|cold|deviation|hvac/i.test(s.title)
      );
    }
    return [];
  }, [entityInfoTarget, asset, room, sops]);

  // Related devices
  const relatedDevices = useMemo(() => {
    if (entityInfoTarget?.type === 'asset' && asset) {
      const sameLineAssetIds = new Set<string>();
      productionLines.forEach((line) => {
        if (line.assetIds.includes(asset.id)) {
          line.assetIds.forEach((id) => sameLineAssetIds.add(id));
        }
      });
      return scene.assets
        .filter((other) => {
          if (other.id === asset.id) return false;
          if (asset.roomId && other.roomId === asset.roomId) return true;
          if (sameLineAssetIds.has(other.id)) return true;
          if (other.floorId === asset.floorId && other.category === asset.category) return true;
          return false;
        })
        .slice(0, 12);
    }
    if (entityInfoTarget?.type === 'room' && room) {
      return scene.assets.filter((a) => a.roomId === room.id);
    }
    return [];
  }, [entityInfoTarget, asset, room, scene.assets, productionLines]);

  // Related sensors
  const relatedSensors = useMemo(() => {
    if (entityInfoTarget?.type === 'asset' && asset) {
      return sensors.filter(
        (s) =>
          s.targetId === asset.id ||
          s.targetCode === asset.assetId ||
          (asset.roomId && s.targetId === asset.roomId)
      );
    }
    if (entityInfoTarget?.type === 'room' && room) {
      const roomAssetIds = new Set(scene.assets.filter((a) => a.roomId === room.id).map((a) => a.id));
      return sensors.filter((s) => s.targetId === room.id || roomAssetIds.has(s.targetId));
    }
    return [];
  }, [entityInfoTarget, asset, room, sensors, scene.assets]);

  // Related production lines
  const relatedLines = useMemo(() => {
    if (entityInfoTarget?.type === 'asset' && asset) {
      return productionLines.filter(
        (l) => l.assetIds.includes(asset.id) || (asset.roomId && l.roomIds.includes(asset.roomId))
      );
    }
    if (entityInfoTarget?.type === 'room' && room) {
      return productionLines.filter((l) => l.roomIds.includes(room.id));
    }
    return [];
  }, [entityInfoTarget, asset, room, productionLines]);

  // Navigation helper to jump straight to 3D on the exact floor & building coordinates
  const navigateToAssetIn3D = (targetAsset: SpatialAsset) => {
    const fl = scene.floors.find((f) => f.id === targetAsset.floorId);
    const bldg = fl?.buildingId ? scene.buildings?.find((b) => b.id === fl.buildingId) : null;
    const ox = bldg?.originX ?? 0;
    const oz = bldg?.originZ ?? 0;
    const elev = fl?.elevation ?? 0;
    setScreen('workspace');
    setActiveFloor(targetAsset.floorId);
    setViewMode('3d-perspective');
    selectEntity({ type: 'asset', id: targetAsset.id });
    flyToCamera(
      [ox + targetAsset.x + 4.4, elev + Math.max(3.2, targetAsset.height + 1.8), oz + targetAsset.z + 4.4],
      [ox + targetAsset.x, elev + targetAsset.height * 0.5, oz + targetAsset.z],
      42
    );
    closeEntityInfo();
    showToast(`Focused ${targetAsset.assetId} · ${targetAsset.name} in 3D`, 'info');
  };

  const navigateToRoomIn3D = (targetRoom: Room) => {
    const fl = scene.floors.find((f) => f.id === targetRoom.floorId);
    const bldg = fl?.buildingId ? scene.buildings?.find((b) => b.id === fl.buildingId) : null;
    const ox = bldg?.originX ?? 0;
    const oz = bldg?.originZ ?? 0;
    const elev = fl?.elevation ?? 0;
    const cx = ox + targetRoom.x + targetRoom.width / 2;
    const cz = oz + targetRoom.z + targetRoom.depth / 2;
    setScreen('workspace');
    setActiveFloor(targetRoom.floorId);
    setViewMode('3d-perspective');
    selectEntity({ type: 'room', id: targetRoom.id });
    flyToCamera(
      [cx + Math.max(5.5, targetRoom.width * 0.65), elev + Math.max(6.5, targetRoom.width * 0.55), cz + Math.max(6.5, targetRoom.depth * 0.85)],
      [cx, elev + 1.2, cz],
      44
    );
    closeEntityInfo();
    showToast(`Focused Room ${targetRoom.code} · ${targetRoom.name} in 3D`, 'info');
  };

  const navigateToSensorIn3D = (sensorId: string) => {
    const s = sensors.find((item) => item.id === sensorId);
    if (!s) return;
    const targetAsset = scene.assets.find((a) => a.id === s.targetId || a.assetId === s.targetCode);
    if (targetAsset) {
      navigateToAssetIn3D(targetAsset);
      return;
    }
    const targetRoom = scene.rooms.find((r) => r.id === s.targetId || r.code === s.targetCode);
    if (targetRoom) {
      navigateToRoomIn3D(targetRoom);
      return;
    }
    const fl = scene.floors.find((f) => f.id === s.floorId);
    const bldg = fl?.buildingId ? scene.buildings?.find((b) => b.id === fl.buildingId) : null;
    const ox = bldg?.originX ?? 0;
    const oz = bldg?.originZ ?? 0;
    const elev = fl?.elevation ?? 0;
    setScreen('workspace');
    setActiveFloor(s.floorId);
    setViewMode('3d-perspective');
    flyToCamera([ox + s.x + 3.5, elev + s.y + 2.5, oz + s.z + 3.5], [ox + s.x, elev + s.y, oz + s.z], 42);
    closeEntityInfo();
    showToast(`Focused Sensor ${s.tag} in 3D`, 'info');
  };

  if (!entityInfoTarget) return null;
  if (entityInfoTarget.type === 'asset' && !asset) return null;
  if (entityInfoTarget.type === 'room' && !room) return null;

  const isAssetMode = entityInfoTarget.type === 'asset' && !!asset;
  const assetCompliance = asset ? complianceByAssetId[asset.id] : undefined;
  const entityFmea = isAssetMode && asset
    ? getTargetFmeaSummary(riskIncidents, 'asset', asset.id)
    : room
      ? getTargetFmeaSummary(riskIncidents, 'room', room.id, true)
      : { openCount: 0, totalCount: 0, maxRpn: 0, worstIncident: null, level: 'clear' as const, shortLabel: '' };
  const entityRiskCount = entityFmea.totalCount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4"
      onClick={closeEntityInfo}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[92vh] flex flex-col rounded-none sm:rounded-3xl border-0 sm:border shadow-2xl overflow-hidden ${
          isDark
            ? 'bg-[#111116] border-zinc-800 text-zinc-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Top Modal Header */}
        <header
          className={`px-4 py-3 border-b flex items-center justify-between gap-3 shrink-0 ${
            isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={closeEntityInfo}
              className={`p-2 rounded-xl border transition shrink-0 cursor-pointer ${
                isDark
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-amber-500 flex items-center justify-center text-white shrink-0">
              {isAssetMode ? <Cpu className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-bold text-amber-400">
                  {isAssetMode ? asset!.assetId : room!.code}
                </span>
                <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400">
                  {isAssetMode ? asset!.category : room!.environmental.cleanroomGrade}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (entityFmea.worstIncident) {
                      openRiskModal({ mode: 'resolve', incidentId: entityFmea.worstIncident.id });
                    } else {
                      setActiveSubTab('risks');
                    }
                  }}
                  className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border tabular-nums cursor-pointer ${
                    entityFmea.level === 'critical'
                      ? 'bg-rose-500/15 text-rose-400 border-rose-500/40'
                      : entityFmea.level === 'high'
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/40'
                        : entityFmea.level === 'medium'
                          ? 'bg-violet-500/15 text-violet-300 border-violet-500/40'
                          : entityFmea.level === 'mitigated'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                            : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/25'
                  }`}
                >
                  {entityFmea.shortLabel || 'FMEA CLEAR'}
                </button>
                {floor && (
                  <span className="text-[10px] font-mono text-zinc-400">
                    {building ? `${building.code} · ` : ''}
                    {floor.code}
                  </span>
                )}
              </div>
              <h2 className="text-sm sm:text-base font-extrabold truncate">
                {isAssetMode ? asset!.name : room!.name}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={closeEntityInfo}
            aria-label="Close info dialog"
            className={`p-2 rounded-xl transition cursor-pointer shrink-0 ${
              isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Action Strip */}
        <div
          className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 shrink-0 ${
            isDark ? 'bg-[#13131A] border-zinc-800' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5 sm:pb-0">
            {(['overview', 'sops', 'history', 'relations', 'risks'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveSubTab(tab)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  activeSubTab === tab
                    ? 'bg-violet-600 text-white'
                    : isDark
                      ? 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab === 'overview'
                  ? 'Overview'
                  : tab === 'sops'
                    ? `SOPs (${linkedSops.length})`
                    : tab === 'history'
                      ? isAssetMode
                        ? 'Activity & History'
                        : 'Compliance & History'
                      : tab === 'relations'
                        ? `Related (${relatedDevices.length + relatedSensors.length})`
                        : `Risks & FMEA (${entityRiskCount})`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {!isAssetMode && room && (
              <button
                type="button"
                onClick={() => {
                  const rep = evaluateRoomEligibility(room);
                  setEligibilityReport(rep);
                  setActiveSubTab('overview');
                  showToast(
                    `${room.code} Eligibility: ${rep.eligible ? 'ELIGIBLE FOR PRODUCTION' : `NOT ELIGIBLE (${rep.blockers.length} blocker${rep.blockers.length === 1 ? '' : 's'})`}`,
                    rep.eligible ? 'success' : 'error'
                  );
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold transition cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Check Eligibility
              </button>
            )}

            {isAssetMode && asset && (
              <button
                type="button"
                onClick={() => openAssetPdfModal(asset.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                  isDark
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-amber-500'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-amber-500'
                }`}
                title="Generate FMEA Risk & GMP Compliance PDF Report"
              >
                <FileText className="w-3.5 h-3.5 text-amber-500" />
                PDF Report
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (isAssetMode && asset) navigateToAssetIn3D(asset);
                else if (room) navigateToRoomIn3D(room);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              Go to 3D
            </button>

            {!isAssetMode && room && (
              <button
                type="button"
                onClick={() => {
                  setScreen('workspace');
                  walkInsideRoom(room.id);
                  closeEntityInfo();
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                  isDark
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-violet-500'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-violet-500'
                }`}
              >
                <Footprints className="w-3.5 h-3.5 text-amber-400" />
                Walk Inside
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const targetId = isAssetMode ? asset!.id : room!.id;
                closeEntityInfo();
                openQrLabelModal('designer', [targetId]);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                isDark
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-amber-500'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-amber-500'
              }`}
              title="Open QR & Barcode Label Designer"
            >
              <QrCode className="w-3.5 h-3.5 text-amber-400" />
              Label
            </button>

            {isAssetMode && asset && (
              <button
                type="button"
                onClick={() => {
                  closeEntityInfo();
                  openGmpModal({ tab: 'compliance', assetId: asset.id });
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                  isDark
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-violet-500'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-violet-500'
                }`}
              >
                <ClipboardCheck className="w-3.5 h-3.5 text-violet-400" />
                GMP Audit
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 space-y-4">
          {/* Room Eligibility Result Banner (when Check Eligibility was clicked) */}
          {!isAssetMode && eligibilityReport && (
            <div
              className={`rounded-2xl border p-4 space-y-3 ${
                eligibilityReport.eligible
                  ? 'bg-emerald-500/10 border-emerald-500/40'
                  : 'bg-rose-500/10 border-rose-500/45'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {eligibilityReport.eligible ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
                  )}
                  <div>
                    <div className="text-xs font-extrabold uppercase tracking-wider">
                      {eligibilityReport.eligible
                        ? 'Room Eligible for GMP Operations'
                        : `Not Eligible — ${eligibilityReport.blockers.length} Critical Blocker${eligibilityReport.blockers.length === 1 ? '' : 's'}`}
                    </div>
                    <div className="text-[11px] text-zinc-400 tabular-nums">
                      Checked at {eligibilityReport.checkedAt} · {eligibilityReport.compliantAssets}/
                      {eligibilityReport.totalAssets} Assets Compliant · {eligibilityReport.activeSensors}{' '}
                      Live Sensors · {eligibilityReport.openWorkOrders} Open Work Orders
                    </div>
                  </div>
                </div>
              </div>

              {eligibilityReport.blockers.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
                    Blocking Conditions
                  </div>
                  {eligibilityReport.blockers.map((b) => (
                    <div
                      key={b.id}
                      className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
                        isDark ? 'bg-[#16161E] border-rose-500/30' : 'bg-white border-rose-200'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          <span className="text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                            {b.category}
                          </span>
                          <span className="truncate">{b.title}</span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">{b.detail}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (b.targetType === 'asset') {
                            const hit = scene.assets.find((x) => x.id === b.targetId);
                            if (hit) navigateToAssetIn3D(hit);
                          } else if (b.targetType === 'sensor') {
                            navigateToSensorIn3D(b.targetId);
                          } else if (room) {
                            navigateToRoomIn3D(room);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10.5px] font-semibold shrink-0 cursor-pointer"
                      >
                        Go to 3D
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {eligibilityReport.warnings.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                    Advisory Warnings ({eligibilityReport.warnings.length})
                  </div>
                  {eligibilityReport.warnings.slice(0, 4).map((w) => (
                    <div
                      key={w.id}
                      className={`rounded-xl border px-3 py-1.5 flex items-center justify-between gap-2 text-[11px] ${
                        isDark ? 'bg-[#16161E] border-amber-500/30' : 'bg-white border-amber-200'
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="font-semibold">{w.title}</span>
                        <span className="text-zinc-400"> — {w.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 1: OVERVIEW — IDENTIFICATION, COST CENTER, SOPS */}
          {activeSubTab === 'overview' && isAssetMode && asset && (
            <div className="space-y-4">
              {/* Identification & Financial Master Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <section
                  className={`rounded-2xl border p-4 space-y-2.5 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-400">
                    <Tag className="w-3.5 h-3.5" />
                    Equipment Identification
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-[10px] text-zinc-500 uppercase">Asset Tag</dt>
                      <dd className="font-mono font-bold text-amber-400">{asset.assetId}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-zinc-500 uppercase">QR / Barcode ID</dt>
                      <dd className="font-mono text-[11px] truncate">{asset.qrCode}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-zinc-500 uppercase">Manufacturer</dt>
                      <dd className="font-semibold">{asset.manufacturer}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-zinc-500 uppercase">Model</dt>
                      <dd className="font-semibold">{asset.model}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-zinc-500 uppercase">Serial Number</dt>
                      <dd className="font-mono text-[11px]">{asset.serialNumber}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-zinc-500 uppercase">Operational Status</dt>
                      <dd className="capitalize font-semibold">{asset.operationalStatus}</dd>
                    </div>
                    <div className="col-span-2 pt-1 border-t border-zinc-800/40 flex items-center justify-between gap-2">
                      <div>
                        <dt className="text-[10px] text-zinc-500 uppercase">Assigned Room / Zone</dt>
                        <dd className="font-semibold">
                          {room ? `${room.code} · ${room.name}` : 'Unassigned Floor Area'}
                        </dd>
                      </div>
                      {room && (
                        <button
                          type="button"
                          onClick={() => openEntityInfo({ type: 'room', id: room.id })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600/15 hover:bg-violet-600 text-violet-300 hover:text-white text-[10.5px] font-semibold transition cursor-pointer"
                        >
                          <MapPin className="w-3 h-3" />
                          Room Info
                        </button>
                      )}
                    </div>
                  </dl>
                </section>

                <section
                  className={`rounded-2xl border p-4 space-y-2.5 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                    <DollarSign className="w-3.5 h-3.5" />
                    Ownership, Cost Center &amp; GMP Status
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div className="col-span-2">
                      <dt className="text-[10px] text-zinc-500 uppercase">Cost Center</dt>
                      <dd className="font-mono font-bold text-emerald-400">
                        {asset.costCenter ?? 'CC-4100 · GMP Manufacturing Ops'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-zinc-500 uppercase">Department / Owner</dt>
                      <dd className="font-semibold">{asset.owner}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-zinc-500 uppercase">Responsible Person</dt>
                      <dd className="font-semibold">{asset.responsiblePerson}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-zinc-500 uppercase">CapEx / OpEx</dt>
                      <dd className="font-mono tabular-nums">
                        ${asset.capexUsd.toLocaleString()} / ${asset.annualOpexUsd.toLocaleString()}/yr
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-zinc-500 uppercase">Power / Footprint</dt>
                      <dd className="font-mono tabular-nums">
                        {asset.energyKw} kW · {asset.width.toFixed(1)}×{asset.depth.toFixed(1)}m
                      </dd>
                    </div>
                    {assetCompliance && (
                      <div className="col-span-2 pt-1 border-t border-zinc-800/40 grid grid-cols-3 gap-2">
                        <div>
                          <div className="text-[9.5px] text-zinc-500 uppercase">Calibration</div>
                          <div className="font-mono text-[10.5px] font-semibold">
                            {assetCompliance.calibration.nextDueDate}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9.5px] text-zinc-500 uppercase">Qualification</div>
                          <div className="font-mono text-[10.5px] font-semibold">
                            {assetCompliance.qualification.nextDueDate}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9.5px] text-zinc-500 uppercase">Next PM</div>
                          <div className="font-mono text-[10.5px] font-semibold">
                            {assetCompliance.maintenance.nextDueDate}
                          </div>
                        </div>
                      </div>
                    )}
                  </dl>
                </section>
              </div>

              {/* Controlled SOP Documents */}
              <section
                className={`rounded-2xl border p-4 space-y-2.5 ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-400">
                    <FileText className="w-3.5 h-3.5" />
                    Controlled SOPs &amp; Work Instructions ({linkedSops.length})
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {linkedSops.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => {
                        closeEntityInfo();
                        openGmpModal({ tab: 'sops', sopId: doc.id });
                      }}
                      className={`text-left rounded-xl border p-3 transition flex items-start justify-between gap-2 cursor-pointer ${
                        isDark
                          ? 'bg-[#111116] border-zinc-800 hover:border-violet-500/70'
                          : 'bg-white border-slate-200 hover:border-violet-500'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10.5px] font-bold text-amber-400">
                            {doc.docNumber}
                          </span>
                          <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-semibold">
                            v{doc.version}
                          </span>
                        </div>
                        <div className="text-xs font-bold mt-0.5 line-clamp-1">{doc.title}</div>
                        <div className="text-[10.5px] text-zinc-400 mt-0.5">
                          {doc.actionType} · Effective {doc.effectiveDate}
                        </div>
                      </div>
                      <ArrowUpRight className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                    </button>
                  ))}
                </div>
              </section>

              {/* Quick Preview of Related Devices & Sensors right on Overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <section
                  className={`rounded-2xl border p-4 space-y-2.5 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-400">
                      <Layers className="w-3.5 h-3.5" />
                      Related Devices ({relatedDevices.length})
                    </div>
                    {relatedDevices.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setActiveSubTab('relations')}
                        className="text-[11px] font-semibold text-violet-400 hover:underline cursor-pointer"
                      >
                        View all
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {relatedDevices.slice(0, 4).map((dev) => (
                      <div
                        key={dev.id}
                        className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
                          isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => openEntityInfo({ type: 'asset', id: dev.id })}
                          className="text-left min-w-0 flex-1 cursor-pointer group"
                        >
                          <div className="font-mono text-[10px] font-bold text-amber-400">
                            {dev.assetId}
                          </div>
                          <div className="text-xs font-semibold truncate group-hover:text-violet-400 transition">
                            {dev.name}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => navigateToAssetIn3D(dev)}
                          className="px-2 py-1 rounded-lg bg-violet-600/15 hover:bg-violet-600 text-violet-300 hover:text-white text-[10px] font-semibold shrink-0 transition cursor-pointer"
                        >
                          3D
                        </button>
                      </div>
                    ))}
                    {relatedDevices.length === 0 && (
                      <div className="text-xs text-zinc-500 py-2">No sibling devices assigned.</div>
                    )}
                  </div>
                </section>

                <section
                  className={`rounded-2xl border p-4 space-y-2.5 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                      <Radio className="w-3.5 h-3.5" />
                      Related Sensors ({relatedSensors.length})
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {relatedSensors.slice(0, 4).map((sens) => {
                      const snap = readings[sens.id];
                      const val = snap ? snap.value.toFixed(1) : sens.nominal.toFixed(1);
                      const status = snap?.status ?? 'nominal';
                      return (
                        <div
                          key={sens.id}
                          className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
                            status === 'alarm'
                              ? 'bg-rose-500/10 border-rose-500/40'
                              : status === 'warning'
                                ? 'bg-amber-500/10 border-amber-500/40'
                                : isDark
                                  ? 'bg-[#111116] border-zinc-800'
                                  : 'bg-white border-slate-200'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              closeEntityInfo();
                              openDashboard({ tab: 'trends', sensorId: sens.id });
                            }}
                            className="text-left min-w-0 flex-1 cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] font-bold text-amber-400">
                                {sens.tag}
                              </span>
                              <span className="font-mono text-[11px] font-bold tabular-nums text-emerald-400">
                                {val} {sens.unit}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-400 truncate group-hover:text-violet-400">
                              {sens.name}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => navigateToSensorIn3D(sens.id)}
                            className="px-2 py-1 rounded-lg bg-violet-600/15 hover:bg-violet-600 text-violet-300 hover:text-white text-[10px] font-semibold shrink-0 transition cursor-pointer"
                          >
                            3D
                          </button>
                        </div>
                      );
                    })}
                    {relatedSensors.length === 0 && (
                      <div className="text-xs text-zinc-500 py-2">No sensors bound yet.</div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* TAB 1 (ROOM MODE): OVERVIEW */}
          {activeSubTab === 'overview' && !isAssetMode && room && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div
                  className={`rounded-2xl border p-3 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-[10px] uppercase text-zinc-500">Area / Volume</div>
                  <div className="mt-1 font-mono text-sm font-bold tabular-nums">
                    {(room.width * room.depth).toFixed(0)} m²
                  </div>
                  <div className="text-[10px] font-mono text-zinc-400 tabular-nums">
                    {(room.width * room.depth * room.height).toFixed(0)} m³ · H {room.height}m
                  </div>
                </div>
                <div
                  className={`rounded-2xl border p-3 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-[10px] uppercase text-zinc-500">Cleanroom Grade</div>
                  <div className="mt-1 text-sm font-bold text-violet-400">
                    {room.environmental.cleanroomGrade}
                  </div>
                  <div className="text-[10px] text-zinc-400">{room.category}</div>
                </div>
                <div
                  className={`rounded-2xl border p-3 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-[10px] uppercase text-zinc-500">HVAC Conditions</div>
                  <div className="mt-1 font-mono text-sm font-bold tabular-nums text-amber-400">
                    {room.environmental.pressurePa >= 0 ? '+' : ''}
                    {room.environmental.pressurePa} Pa
                  </div>
                  <div className="text-[10px] font-mono text-zinc-400 tabular-nums">
                    {room.environmental.temperatureC}°C · {room.environmental.humidityPct}% RH ·{' '}
                    {room.environmental.airChangesPerHour} ACH
                  </div>
                </div>
                <div
                  className={`rounded-2xl border p-3 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-[10px] uppercase text-zinc-500">Compliance</div>
                  <div
                    className={`mt-1 text-sm font-bold capitalize ${
                      room.complianceStatus === 'compliant'
                        ? 'text-emerald-400'
                        : room.complianceStatus === 'deviation'
                          ? 'text-rose-400'
                          : 'text-amber-400'
                    }`}
                  >
                    {room.complianceStatus}
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    {relatedDevices.length} devices · {relatedSensors.length} sensors
                  </div>
                </div>
              </div>

              {/* Per-Room HVAC & Air Handling Configuration */}
              {(() => {
                const rmHvac = getEffectiveRoomHvac(room);
                const m3h = computeRoomSupplyM3h(room);
                const ahuTint = getAhuColor(rmHvac.ahuId);
                const disabled = isReadOnly;
                return (
                  <section
                    className={`rounded-2xl border p-4 space-y-3 ${
                      isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-400">
                        <Wind className="w-3.5 h-3.5" />
                        HVAC &amp; Air Handling Control
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: ahuTint }}
                        />
                        <span className="font-mono text-[10.5px] text-zinc-400 normal-case tabular-nums">
                          {m3h.toLocaleString()} m³/h
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowHvacOverlay(true);
                          navigateToRoomIn3D(room);
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-sky-500 hover:bg-sky-400 text-zinc-950 text-[11px] font-bold transition cursor-pointer"
                      >
                        <Wind className="w-3 h-3" />
                        Inspect 3D Ducts
                      </button>
                    </div>
                    <fieldset disabled={disabled} className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs disabled:opacity-75">
                      <label className="space-y-1">
                        <span className="text-[10px] text-zinc-500 uppercase">AHU Unit</span>
                        <select
                          value={rmHvac.ahuId}
                          onChange={(e) => {
                            const picked = AHU_CATALOG.find((a) => a.id === e.target.value);
                            updateRoomHvac(room.id, {
                              ahuId: e.target.value,
                              ahuName: picked?.name ?? e.target.value,
                            });
                          }}
                          className={`w-full px-2 py-1.5 rounded-lg border text-xs ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        >
                          {AHU_CATALOG.map((a) => (
                            <option key={a.id} value={a.id}>{a.id}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-zinc-500 uppercase">HEPA Filter</span>
                        <select
                          value={rmHvac.hepaClass}
                          onChange={(e) => updateRoomHvac(room.id, { hepaClass: e.target.value as any })}
                          className={`w-full px-2 py-1.5 rounded-lg border text-xs ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        >
                          {HEPA_CLASSES.map((hc) => (
                            <option key={hc} value={hc}>{hc}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-zinc-500 uppercase">Airflow Mode</span>
                        <select
                          value={rmHvac.airflowMode}
                          onChange={(e) => updateRoomHvac(room.id, { airflowMode: e.target.value as any })}
                          className={`w-full px-2 py-1.5 rounded-lg border text-xs ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        >
                          {AIRFLOW_MODES.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-zinc-500 uppercase">HVAC Status</span>
                        <select
                          value={rmHvac.status}
                          onChange={(e) => updateRoomHvac(room.id, { status: e.target.value as any })}
                          className={`w-full px-2 py-1.5 rounded-lg border text-xs capitalize ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        >
                          <option value="online">Online</option>
                          <option value="alarm">Alarm</option>
                          <option value="maintenance">Maintenance</option>
                          <option value="standby">Standby</option>
                        </select>
                      </label>
                      <label className="space-y-1 font-mono tabular-nums">
                        <span className="text-[10px] text-zinc-500 uppercase font-sans">Pressure ΔP (Pa)</span>
                        <input
                          type="number"
                          value={room.environmental.pressurePa}
                          onChange={(e) => updateRoomHvac(room.id, { targetPressurePa: Number(e.target.value) })}
                          className={`w-full px-2 py-1 rounded-lg border ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        />
                      </label>
                      <label className="space-y-1 font-mono tabular-nums">
                        <span className="text-[10px] text-zinc-500 uppercase font-sans">ACH</span>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={room.environmental.airChangesPerHour}
                          onChange={(e) => updateRoomHvac(room.id, { airChangesPerHour: Math.max(1, Number(e.target.value)) })}
                          className={`w-full px-2 py-1 rounded-lg border ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        />
                      </label>
                      <label className="space-y-1 font-mono tabular-nums">
                        <span className="text-[10px] text-zinc-500 uppercase font-sans">Damper (%)</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          value={rmHvac.damperPct}
                          onChange={(e) => updateRoomHvac(room.id, { damperPct: Math.max(0, Math.min(100, Number(e.target.value))) })}
                          className={`w-full px-2 py-1 rounded-lg border ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        />
                      </label>
                      <label className="space-y-1 font-mono tabular-nums">
                        <span className="text-[10px] text-zinc-500 uppercase font-sans">Supply °C</span>
                        <input
                          type="number"
                          step={0.5}
                          value={rmHvac.supplyTempC}
                          onChange={(e) => updateRoomHvac(room.id, { supplyTempC: Number(e.target.value) })}
                          className={`w-full px-2 py-1 rounded-lg border ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        />
                      </label>
                    </fieldset>
                  </section>
                );
              })()}

              {/* Owner, Department & Cost Center Assignment */}
              {(() => {
                const departments = getSceneDepartments(scene);
                const currentDept = departments.find((d) => d.id === room.departmentId) ?? departments[0];
                const effectiveOwner = getDefaultRoomOwner(room, currentDept);
                const effectiveCostCenter = room.costCenter || getDepartmentCostCenter(currentDept);
                const costCenterOptions = departments.map((d) => ({
                  deptId: d.id,
                  deptName: d.name,
                  costCenter: getDepartmentCostCenter(d),
                }));
                return (
                  <section
                    className={`rounded-2xl border p-4 space-y-3 ${
                      isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                        <UserCheck className="w-3.5 h-3.5" />
                        Owner, Department &amp; Cost Center
                      </div>
                      <span className="text-[10.5px] font-mono text-zinc-400">
                        {isReadOnly ? 'Read-Only' : 'Editable'}
                      </span>
                    </div>
                    <fieldset
                      disabled={isReadOnly}
                      className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs disabled:opacity-80"
                    >
                      <label className="space-y-1">
                        <span className="text-[10px] text-zinc-500 uppercase">Department</span>
                        <select
                          value={currentDept?.id ?? room.departmentId}
                          onChange={(e) => {
                            const nextDept = departments.find((d) => d.id === e.target.value);
                            updateRoom(room.id, {
                              departmentId: e.target.value,
                              costCenter: getDepartmentCostCenter(nextDept),
                            });
                          }}
                          className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        >
                          {departments.map((dept) => (
                            <option key={dept.id} value={dept.id}>
                              {dept.code} · {dept.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-zinc-500 uppercase">Cost Center</span>
                        <select
                          value={effectiveCostCenter}
                          onChange={(e) => {
                            const matched = costCenterOptions.find((c) => c.costCenter === e.target.value);
                            updateRoom(room.id, {
                              costCenter: e.target.value,
                              ...(matched ? { departmentId: matched.deptId } : {}),
                            });
                          }}
                          className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        >
                          {costCenterOptions.map((c) => (
                            <option key={c.deptId} value={c.costCenter}>
                              {c.costCenter}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-zinc-500 uppercase">Room Owner</span>
                        <input
                          type="text"
                          value={effectiveOwner}
                          onChange={(e) =>
                            updateRoom(room.id, {
                              owner: e.target.value,
                              metadata: { ...room.metadata, owner: e.target.value },
                            })
                          }
                          className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${
                            isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                          }`}
                        />
                      </label>
                    </fieldset>
                  </section>
                );
              })()}

              {/* Related Cameras with Live Preview */}
              {(() => {
                const roomCx = room.x + room.width / 2;
                const roomCz = room.z + room.depth / 2;
                const floorCams = scene.cameras.filter((c) => c.floorId === room.floorId);
                const directCams = floorCams.filter((c) => {
                  const [px, , pz] = c.position;
                  const [tx, , tz] = c.target;
                  const insidePos =
                    px >= room.x - 0.8 &&
                    px <= room.x + room.width + 0.8 &&
                    pz >= room.z - 0.8 &&
                    pz <= room.z + room.depth + 0.8;
                  const insideTgt =
                    tx >= room.x &&
                    tx <= room.x + room.width &&
                    tz >= room.z &&
                    tz <= room.z + room.depth;
                  const withinRadius =
                    Math.hypot(px - roomCx, pz - roomCz) <= Math.max(8, c.coverageRadius || 10);
                  return insidePos || insideTgt || withinRadius;
                });
                const roomCams =
                  directCams.length > 0
                    ? directCams.slice(0, 2)
                    : floorCams
                        .slice()
                        .sort(
                          (a, b) =>
                            Math.hypot(a.position[0] - roomCx, a.position[2] - roomCz) -
                            Math.hypot(b.position[0] - roomCx, b.position[2] - roomCz)
                        )
                        .slice(0, 1);
                const floorObj = scene.floors.find((f) => f.id === room.floorId);

                return (
                  <section
                    className={`rounded-2xl border p-4 space-y-3 ${
                      isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
                        <Camera className="w-3.5 h-3.5" />
                        Related Cameras &amp; Live Preview ({roomCams.length})
                      </div>
                      {roomCams[0] && (
                        <button
                          type="button"
                          onClick={() => {
                            closeEntityInfo();
                            openLiveCamera(roomCams[0].id);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-cyan-500/15 hover:bg-cyan-500 text-cyan-300 hover:text-zinc-950 text-[11px] font-semibold transition cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          Open Camera Manager
                        </button>
                      )}
                    </div>
                    {roomCams.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {roomCams.map((cam) => (
                          <div
                            key={cam.id}
                            className={`rounded-xl border overflow-hidden ${
                              isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="relative h-32 w-full bg-black overflow-hidden">
                              <LiveCctvCanvas
                                camera={cam}
                                floorName={floorObj?.name ?? 'Floor'}
                                room={room}
                                roomAssets={relatedDevices}
                                nightVision={false}
                                ptzZoom={1}
                                ptzPan={0}
                              />
                              <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-rose-600/90 text-white font-mono text-[9px] font-bold tracking-wider">
                                LIVE
                              </span>
                            </div>
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-semibold truncate">{cam.name}</div>
                                <div className="text-[10px] font-mono text-zinc-400">
                                  FOV {cam.fov}° · {cam.kind.toUpperCase()}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  closeEntityInfo();
                                  openLiveCamera(cam.id);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold shrink-0 cursor-pointer"
                              >
                                Full Feed
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-zinc-500">No surveillance cameras assigned to this floor.</div>
                    )}
                  </section>
                );
              })()}

              {/* Fire Safety: Related Fire Sensors & Fire Extinguisher List */}
              {(() => {
                const fireSafety = getEffectiveRoomFireSafety(room);
                return (
                  <section
                    ref={fireSafetyRef}
                    className={`rounded-2xl border p-4 space-y-3 transition-all ${
                      highlightFireSection
                        ? 'bg-rose-500/15 border-rose-400 ring-2 ring-rose-500/40'
                        : isDark
                          ? 'bg-[#17171F] border-zinc-800'
                          : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-400">
                        <Flame className="w-3.5 h-3.5" />
                        Fire Sensors ({fireSafety.sensors.length}) &amp; Extinguishers ({fireSafety.extinguishers.length})
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400">NFPA 72 / EN 54 Monitored</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                          Fire Detection Sensors
                        </div>
                        {fireSafety.sensors.map((fs) => (
                          <div
                            key={fs.id}
                            className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
                              isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10.5px] font-bold text-rose-400">{fs.tag}</span>
                                <span className="text-[11px] font-semibold truncate">{fs.type}</span>
                              </div>
                              <div className="text-[10px] text-zinc-400 truncate">
                                {fs.sensitivity} · Next test {fs.nextTestDue}
                              </div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-md font-mono text-[9.5px] font-bold uppercase shrink-0 ${
                                fs.status === 'normal'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-amber-500/15 text-amber-400'
                              }`}
                            >
                              {fs.status === 'normal' ? 'ACTIVE' : 'TEST DUE'}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                          Portable &amp; Clean-Agent Extinguishers
                        </div>
                        {fireSafety.extinguishers.map((fe) => (
                          <div
                            key={fe.id}
                            className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
                              isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10.5px] font-bold text-amber-400">{fe.tag}</span>
                                <span className="text-[11px] font-semibold truncate">
                                  {fe.agent} ({fe.capacityKg}kg)
                                </span>
                              </div>
                              <div className="text-[10px] text-zinc-400 truncate">
                                {fe.locationHint} · {fe.classRating} · Due {fe.nextInspection}
                              </div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-md font-mono text-[9.5px] font-bold uppercase shrink-0 ${
                                fe.pressureStatus === 'green-nominal'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-rose-500/15 text-rose-400'
                              }`}
                            >
                              {fe.pressureStatus === 'green-nominal' ? 'OK' : 'RECHARGE'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                );
              })()}

              {/* Room SOPs */}
              <section
                className={`rounded-2xl border p-4 space-y-2.5 ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-400">
                  <FileText className="w-3.5 h-3.5" />
                  Room &amp; Cleanroom SOPs ({linkedSops.length})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {linkedSops.slice(0, 6).map((doc) => (
                    <div
                      key={doc.id}
                      className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 ${
                        isDark
                          ? 'bg-[#111116] border-zinc-800 hover:border-violet-500'
                          : 'bg-white border-slate-200 hover:border-violet-500'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          closeEntityInfo();
                          openGmpModal({ tab: 'sops', sopId: doc.id });
                        }}
                        className="text-left min-w-0 flex-1 cursor-pointer"
                      >
                        <div className="font-mono text-[10px] font-bold text-amber-400">
                          {doc.docNumber} · v{doc.version}
                        </div>
                        <div className="text-xs font-semibold truncate">{doc.title}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          startReadingSop(doc.id, doc.title, null, doc.docNumber);
                          closeEntityInfo();
                          setScreen('maya-life');
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-600/20 hover:bg-violet-600 text-violet-300 hover:text-white text-[10px] font-semibold shrink-0 transition cursor-pointer"
                        title="Open in MAYA Life Studio to read & analyze"
                      >
                        <Sparkles className="w-3 h-3" />
                        MAYA
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Devices & Sensors inside Room */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <section
                  className={`rounded-2xl border p-4 space-y-2 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-violet-400 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5" />
                    Installed Equipment ({relatedDevices.length})
                  </div>
                  <div className="space-y-1.5">
                    {relatedDevices.map((dev) => (
                      <div
                        key={dev.id}
                        className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
                          isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => openEntityInfo({ type: 'asset', id: dev.id })}
                          className="text-left min-w-0 flex-1 cursor-pointer group"
                        >
                          <div className="font-mono text-[10px] font-bold text-amber-400">
                            {dev.assetId}
                          </div>
                          <div className="text-xs font-semibold truncate group-hover:text-violet-400">
                            {dev.name}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => navigateToAssetIn3D(dev)}
                          className="px-2.5 py-1 rounded-lg bg-violet-600/15 hover:bg-violet-600 text-violet-300 hover:text-white text-[10px] font-semibold shrink-0 cursor-pointer"
                        >
                          Go to 3D
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section
                  className={`rounded-2xl border p-4 space-y-2 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    Environmental &amp; Process Sensors ({relatedSensors.length})
                  </div>
                  <div className="space-y-1.5">
                    {relatedSensors.map((sens) => {
                      const snap = readings[sens.id];
                      const val = snap ? snap.value.toFixed(1) : sens.nominal.toFixed(1);
                      return (
                        <div
                          key={sens.id}
                          className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
                            isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              closeEntityInfo();
                              openDashboard({ tab: 'trends', sensorId: sens.id });
                            }}
                            className="text-left min-w-0 flex-1 cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] font-bold text-amber-400">
                                {sens.tag}
                              </span>
                              <span className="font-mono text-[11px] font-bold tabular-nums text-emerald-400">
                                {val} {sens.unit}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-400 truncate group-hover:text-violet-400">
                              {sens.name}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => navigateToSensorIn3D(sens.id)}
                            className="px-2.5 py-1 rounded-lg bg-violet-600/15 hover:bg-violet-600 text-violet-300 hover:text-white text-[10px] font-semibold shrink-0 cursor-pointer"
                          >
                            Go to 3D
                          </button>
                        </div>
                      );
                    })}
                    {relatedSensors.length === 0 && (
                      <div className="text-xs text-zinc-500 py-2">No sensors bound to this room.</div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* DEDICATED SOP LIBRARY & FULL READER TAB */}
          {activeSubTab === 'sops' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div
                className={`lg:col-span-4 rounded-2xl border p-3 space-y-2 ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-violet-400">
                    <BookOpen className="w-3.5 h-3.5" />
                    Linked SOPs ({linkedSops.length})
                  </div>
                </div>
                {linkedSops.length === 0 ? (
                  <div className="text-xs text-zinc-500 py-6 text-center">
                    No SOP documents matched this entity yet.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-0.5">
                    {linkedSops.map((sop) => {
                      const activeSopObj =
                        linkedSops.find((s) => s.id === selectedSopId) ?? linkedSops[0];
                      const isSel = activeSopObj?.id === sop.id;
                      return (
                        <button
                          key={sop.id}
                          type="button"
                          onClick={() => setSelectedSopId(sop.id)}
                          className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                            isSel
                              ? 'bg-violet-600/15 border-violet-500'
                              : isDark
                                ? 'bg-[#111116] border-zinc-800 hover:border-violet-500/40'
                                : 'bg-white border-slate-200 hover:border-violet-400'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-mono text-[10px] font-bold text-violet-400">
                              {sop.docNumber}
                            </span>
                            <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-300">
                              v{sop.version}
                            </span>
                          </div>
                          <div className="text-xs font-semibold mt-0.5 line-clamp-2">{sop.title}</div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">{sop.actionType}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div
                className={`lg:col-span-8 rounded-2xl border p-4 space-y-3 ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                {(() => {
                  const activeSopObj =
                    linkedSops.find((s) => s.id === selectedSopId) ?? linkedSops[0] ?? null;
                  if (!activeSopObj) {
                    return (
                      <div className="text-xs text-zinc-500 py-12 text-center">
                        Select an SOP on the left to inspect its full GMP procedure.
                      </div>
                    );
                  }
                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-zinc-200 dark:border-zinc-800">
                        <div className="min-w-0">
                          <div className="font-mono text-[10.5px] font-bold text-violet-400">
                            {activeSopObj.docNumber} · v{activeSopObj.version} · {activeSopObj.status.toUpperCase()}
                          </div>
                          <div className="text-sm font-bold truncate">{activeSopObj.title}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            startReadingSop(
                              activeSopObj.id,
                              activeSopObj.title,
                              asset?.id ?? null,
                              asset?.assetId ?? room?.code
                            );
                            closeEntityInfo();
                            setScreen('maya-life');
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer shrink-0"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Read with MAYA
                        </button>
                      </div>
                      <div className="max-h-[420px] overflow-y-auto pr-1">
                        <RichMarkdownRenderer markdown={activeSopObj.markdown} isDark={isDark} compact />
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* TAB 2: UNIFIED ACTIVITY, AUDIT & VENDOR/OWNER HISTORY (ASSET) OR COMPLIANCE & ELIGIBILITY (ROOM) */}
          {activeSubTab === 'history' && isAssetMode && asset && (() => {
            const assetWorkOrders = workOrders.filter(
              (w) => w.targetId === asset.id || w.targetName.includes(asset.assetId)
            );
            const assetAuditEntries = auditLog.filter(
              (a) =>
                a.entityId === asset.id ||
                a.summary.toLowerCase().includes(asset.assetId.toLowerCase()) ||
                a.summary.toLowerCase().includes(asset.name.toLowerCase())
            );
            const assetMayaEntries = mayaInteractions.filter(
              (m) => m.targetId === asset.id || m.targetCode === asset.assetId
            );

            return (
              <div className="space-y-4">
                {/* Unified Activity & Audit Timeline */}
                <section
                  className={`rounded-2xl border p-4 space-y-3 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
                      <History className="w-3.5 h-3.5" />
                      Unified Activity, Work Orders &amp; Audit History (
                      {assetWorkOrders.length + assetAuditEntries.length + assetMayaEntries.length})
                    </div>
                    <span className="font-mono text-[10px] text-zinc-400">
                      21 CFR Part 11 · Real-Time Trail
                    </span>
                  </div>

                  {assetWorkOrders.length + assetAuditEntries.length + assetMayaEntries.length === 0 ? (
                    <div className="text-xs text-zinc-500 py-3">
                      No live work orders or audit activity recorded yet for {asset.assetId}.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[260px] overflow-y-auto pr-1">
                      {assetWorkOrders.map((wo) => (
                        <div
                          key={wo.id}
                          className={`rounded-xl border p-3 space-y-1 ${
                            isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-bold text-amber-400">
                              {wo.woNumber} · {wo.serviceType}
                            </span>
                            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400">
                              {wo.status}
                            </span>
                          </div>
                          <div className="text-xs font-semibold">{wo.title}</div>
                          <div className="text-[10.5px] text-zinc-400 font-mono">
                            Due {wo.dueDate} · {wo.assigneeName}
                          </div>
                        </div>
                      ))}

                      {assetMayaEntries.map((mi) => (
                        <div
                          key={mi.id}
                          className={`rounded-xl border p-3 space-y-1 ${
                            isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-bold text-violet-400">
                              MAYA · {mi.kind.toUpperCase()}
                            </span>
                            <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                              {new Date(mi.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="text-xs font-semibold">{mi.summary}</div>
                          <div className="text-[10px] text-zinc-500">State: {mi.mayaState}</div>
                        </div>
                      ))}

                      {assetAuditEntries.map((ae) => (
                        <div
                          key={ae.id}
                          className={`rounded-xl border p-3 space-y-1 ${
                            isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-bold text-emerald-400">
                              AUDIT · {ae.action}
                            </span>
                            <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                              {new Date(ae.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="text-xs font-medium">{ae.summary}</div>
                          <div className="text-[10px] text-zinc-500">Actor: {ae.actor}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <section
                    className={`rounded-2xl border p-4 space-y-3 ${
                      isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                      <Wrench className="w-3.5 h-3.5" />
                      Vendor &amp; OEM Service History ({asset.vendorHistory?.length ?? 0})
                    </div>
                    <div className="space-y-2.5">
                      {(asset.vendorHistory ?? []).map((vh) => (
                        <div
                          key={vh.id}
                          className={`rounded-xl border p-3 space-y-1 ${
                            isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold">{vh.vendor}</span>
                            <span className="font-mono text-[10px] text-amber-400">{vh.date}</span>
                          </div>
                          <div className="text-[11px] font-semibold text-violet-400">{vh.action}</div>
                          <div className="flex items-center justify-between text-[10.5px] text-zinc-400 font-mono">
                            <span>Ref: {vh.reference ?? 'OEM-SVC'}</span>
                            {vh.costUsd ? <span>${vh.costUsd.toLocaleString()}</span> : null}
                          </div>
                          {vh.note && <p className="text-[11px] text-zinc-400 pt-0.5">{vh.note}</p>}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section
                    className={`rounded-2xl border p-4 space-y-3 ${
                      isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-400">
                      <UserCheck className="w-3.5 h-3.5" />
                      Owner &amp; Cost Center Custody History ({asset.ownerHistory?.length ?? 0})
                    </div>
                    <div className="space-y-2.5">
                      {(asset.ownerHistory ?? []).map((oh) => (
                        <div
                          key={oh.id}
                          className={`rounded-xl border p-3 space-y-1 ${
                            isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold">{oh.owner}</span>
                            <span className="font-mono text-[10px] text-emerald-400">{oh.date}</span>
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            {oh.department} · <span className="font-mono text-amber-400">{oh.costCenter}</span>
                          </div>
                          <p className="text-[11px] text-zinc-400">{oh.note}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            );
          })()}

          {activeSubTab === 'history' && !isAssetMode && room && (
            <div className="space-y-4">
              <div
                className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    GMP Room Eligibility &amp; Qualification Audit
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    Evaluates cleanroom compliance status, live environmental sensor alarms, overdue work orders, and all equipment calibration/OQ-PQ records inside {room.code}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEligibilityReport(evaluateRoomEligibility(room))}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Run Eligibility Check Now
                </button>
              </div>

              {relatedLines.length > 0 && (
                <section
                  className={`rounded-2xl border p-4 space-y-2 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-violet-400">
                    Associated Production Lines ({relatedLines.length})
                  </div>
                  <div className="space-y-2">
                    {relatedLines.map((line) => (
                      <div
                        key={line.id}
                        className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
                          isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div>
                          <span className="font-mono text-xs font-bold text-amber-400">{line.code}</span>
                          <span className="text-xs font-semibold ml-2">{line.name}</span>
                          <div className="text-[10.5px] text-zinc-400">
                            {line.productFamily} · Batch {line.targetBatchSize}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            closeEntityInfo();
                            openGmpModal({ tab: 'lines', lineId: line.id });
                          }}
                          className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          Open Line
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* TAB 3: FULL RELATED DEVICES & SENSORS GRAPH */}
          {activeSubTab === 'relations' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <section
                className={`rounded-2xl border p-4 space-y-2.5 ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="text-xs font-bold uppercase tracking-wider text-violet-400 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  Related Devices ({relatedDevices.length})
                </div>
                <div className="space-y-2">
                  {relatedDevices.map((dev) => (
                    <div
                      key={dev.id}
                      className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 ${
                        isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => openEntityInfo({ type: 'asset', id: dev.id })}
                        className="text-left min-w-0 flex-1 cursor-pointer group"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10.5px] font-bold text-amber-400">
                            {dev.assetId}
                          </span>
                          <span className="text-[9.5px] text-zinc-400">{dev.category}</span>
                        </div>
                        <div className="text-xs font-bold truncate group-hover:text-violet-400">
                          {dev.name}
                        </div>
                        <div className="text-[10.5px] text-zinc-400 truncate">
                          {dev.manufacturer} {dev.model}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEntityInfo({ type: 'asset', id: dev.id })}
                          className="p-1.5 rounded-lg border border-zinc-700/70 hover:border-violet-500 text-zinc-300 cursor-pointer"
                          title="Inspect device details"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => navigateToAssetIn3D(dev)}
                          className="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10.5px] font-semibold cursor-pointer"
                        >
                          Go to 3D
                        </button>
                      </div>
                    </div>
                  ))}
                  {relatedDevices.length === 0 && (
                    <div className="text-xs text-zinc-500 py-4 text-center">No related devices found.</div>
                  )}
                </div>
              </section>

              <section
                className={`rounded-2xl border p-4 space-y-2.5 ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5" />
                  Related Telemetry Sensors ({relatedSensors.length})
                </div>
                <div className="space-y-2">
                  {relatedSensors.map((sens) => {
                    const snap = readings[sens.id];
                    const val = snap ? snap.value.toFixed(1) : sens.nominal.toFixed(1);
                    const status = snap?.status ?? 'nominal';
                    return (
                      <div
                        key={sens.id}
                        className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 ${
                          status === 'alarm'
                            ? 'bg-rose-500/10 border-rose-500/45'
                            : status === 'warning'
                              ? 'bg-amber-500/10 border-amber-500/45'
                              : isDark
                                ? 'bg-[#111116] border-zinc-800'
                                : 'bg-white border-slate-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            closeEntityInfo();
                            openDashboard({ tab: 'trends', sensorId: sens.id });
                          }}
                          className="text-left min-w-0 flex-1 cursor-pointer group"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10.5px] font-bold text-amber-400">
                              {sens.tag}
                            </span>
                            <span className="font-mono text-xs font-extrabold tabular-nums text-emerald-400">
                              {val} {sens.unit}
                            </span>
                            {status !== 'nominal' && (
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            )}
                          </div>
                          <div className="text-xs font-semibold truncate group-hover:text-violet-400">
                            {sens.name}
                          </div>
                          <div className="text-[10px] text-zinc-400 font-mono">
                            Limits: {sens.alarmLow}–{sens.alarmHigh} {sens.unit} · {sens.protocol}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => navigateToSensorIn3D(sens.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10.5px] font-semibold shrink-0 cursor-pointer"
                        >
                          Go to 3D
                        </button>
                      </div>
                    );
                  })}
                  {relatedSensors.length === 0 && (
                    <div className="text-xs text-zinc-500 py-4 text-center">No sensors linked yet.</div>
                  )}
                </div>
              </section>
            </div>
          )}

          {activeSubTab === 'risks' && (
            <div className="space-y-4">
              <EntityRisksSection
                targetKind={isAssetMode ? (asset!.category === 'IT & Data Center' ? 'network' : 'asset') : 'room'}
                targetId={isAssetMode ? asset!.id : room!.id}
                targetCode={isAssetMode ? asset!.assetId : room!.code}
                targetName={isAssetMode ? asset!.name : room!.name}
                floorId={isAssetMode ? asset!.floorId : room!.floorId}
                roomId={isAssetMode ? asset!.roomId : room!.id}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
