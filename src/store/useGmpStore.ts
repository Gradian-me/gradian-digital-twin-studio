import { create } from 'zustand';
import type {
  CronScheduleJob,
  EligibilityIssue,
  EligibleTechnician,
  EquipmentComplianceRecord,
  EquipmentLifecycleEvent,
  GmpModalTab,
  ProductionLine,
  ProductionLineEligibilityResult,
  QrLabelModalTab,
  ServiceActionType,
  SopDocument,
  WikiArticle,
  WorkOrder,
  WorkOrderStatus,
} from '../types/gmp';
import type { DigitalTwinScene, EquipmentCategory } from '../types/twin';
import {
  addDaysToIso,
  buildDefaultComplianceForAsset,
  buildSeedCronJobs,
  buildSeedProductionLines,
  buildSeedWorkOrders,
  computeDateStatus,
  INITIAL_ELIGIBLE_PERSONNEL,
  INITIAL_SOP_DOCUMENTS,
  INITIAL_WIKI_ARTICLES,
  todayIso,
} from '../data/gmpDemoData';
import { useTwinStore } from './useTwinStore';

const GMP_STORAGE_KEY = 'gradian_gmp_ops_v1';

interface PersistedGmpState {
  complianceByAssetId: Record<string, EquipmentComplianceRecord>;
  productionLines: ProductionLine[];
  workOrders: WorkOrder[];
  cronJobs: CronScheduleJob[];
  personnel: EligibleTechnician[];
  sops: SopDocument[];
  wikiArticles: WikiArticle[];
}

function loadPersistedGmp(): Partial<PersistedGmpState> | null {
  try {
    const raw = localStorage.getItem(GMP_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersistedGmp(data: PersistedGmpState) {
  try {
    localStorage.setItem(GMP_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

export interface MiniMapJumpTarget {
  x: number;
  z: number;
  ts: number;
}

interface GmpState {
  initializedForProjectId: string | null;
  complianceByAssetId: Record<string, EquipmentComplianceRecord>;
  productionLines: ProductionLine[];
  eligibilityByLineId: Record<string, ProductionLineEligibilityResult>;
  activeLineHighlight: ProductionLineEligibilityResult | null;

  workOrders: WorkOrder[];
  cronJobs: CronScheduleJob[];
  personnel: EligibleTechnician[];
  sops: SopDocument[];
  wikiArticles: WikiArticle[];

  // UI & Modal navigation
  showGmpModal: boolean;
  gmpTab: GmpModalTab;
  focusedAssetId: string | null;
  focusedLineId: string | null;
  focusedSopId: string | null;
  focusedWikiId: string | null;

  showQrLabelModal: boolean;
  qrLabelTab: QrLabelModalTab;
  preselectedLabelIds: string[];

  showMiniMap: boolean;
  miniMapTarget: MiniMapJumpTarget | null;

  // Actions
  syncWithScene: (scene: DigitalTwinScene) => void;
  getCompliance: (assetId: string) => EquipmentComplianceRecord | null;
  updateCompliance: (
    assetId: string,
    patch: {
      calibration?: Partial<EquipmentComplianceRecord['calibration']>;
      qualification?: Partial<EquipmentComplianceRecord['qualification']>;
      maintenance?: Partial<EquipmentComplianceRecord['maintenance']>;
      owner?: string;
      department?: string;
      gmpCriticality?: EquipmentComplianceRecord['gmpCriticality'];
    }
  ) => void;
  addLifecycleEvent: (assetId: string, event: Omit<EquipmentLifecycleEvent, 'id' | 'assetId'>) => void;

  // Production Lines & Eligibility
  saveProductionLine: (line: Omit<ProductionLine, 'id'> & { id?: string }) => ProductionLine;
  deleteProductionLine: (lineId: string) => void;
  checkLineEligibility: (lineId: string, scene?: DigitalTwinScene, highlightOnMap?: boolean) => ProductionLineEligibilityResult | null;
  clearLineHighlight: () => void;

  // Work Orders & Cron Jobs
  createWorkOrder: (wo: Omit<WorkOrder, 'id' | 'woNumber' | 'createdAt'>) => WorkOrder;
  updateWorkOrderStatus: (woId: string, status: WorkOrderStatus) => void;
  toggleWorkOrderChecklist: (woId: string, checkId: string) => void;
  deleteWorkOrder: (woId: string) => void;

  addCronJob: (job: Omit<CronScheduleJob, 'id' | 'generatedCount'>) => CronScheduleJob;
  toggleCronJob: (jobId: string) => void;
  runCronJobNow: (jobId: string) => WorkOrder | null;
  deleteCronJob: (jobId: string) => void;

  // Eligible Personnel
  addTechnician: (tech: Omit<EligibleTechnician, 'id'>) => EligibleTechnician;
  getEligiblePersonnel: (category: EquipmentCategory | 'Facility / Room', serviceType: ServiceActionType) => EligibleTechnician[];

  // SOPs & Wiki
  addSopDocument: (doc: Omit<SopDocument, 'id'>) => SopDocument;
  updateSopDocument: (id: string, patch: Partial<SopDocument>) => void;
  addWikiArticle: (article: Omit<WikiArticle, 'id'>) => WikiArticle;

  // Navigation helpers
  openGmpModal: (opts?: {
    tab?: GmpModalTab;
    assetId?: string | null;
    lineId?: string | null;
    sopId?: string | null;
    wikiId?: string | null;
  }) => void;
  closeGmpModal: () => void;
  setGmpTab: (tab: GmpModalTab) => void;

  openQrLabelModal: (tab?: QrLabelModalTab, preselectedIds?: string[]) => void;
  closeQrLabelModal: () => void;

  setShowMiniMap: (show: boolean) => void;
  jumpFromMiniMap: (x: number, z: number) => void;
}

function persist(state: GmpState) {
  savePersistedGmp({
    complianceByAssetId: state.complianceByAssetId,
    productionLines: state.productionLines,
    workOrders: state.workOrders,
    cronJobs: state.cronJobs,
    personnel: state.personnel,
    sops: state.sops,
    wikiArticles: state.wikiArticles,
  });
}

export function evaluateProductionLine(
  line: ProductionLine,
  scene: DigitalTwinScene,
  complianceMap: Record<string, EquipmentComplianceRecord>,
  workOrders: WorkOrder[]
): ProductionLineEligibilityResult {
  const now = new Date();
  const issues: EligibilityIssue[] = [];
  const compliantAssetIds: string[] = [];
  const failingAssetIds: string[] = [];
  const compliantRoomIds: string[] = [];
  const failingRoomIds: string[] = [];

  const daysPast = (iso: string) => {
    const d = new Date(`${iso}T23:59:59`);
    return Math.max(1, Math.ceil((now.getTime() - d.getTime()) / 86400000));
  };

  // Check every assigned Room
  for (const roomId of line.roomIds) {
    const rm = scene.rooms.find((r) => r.id === roomId);
    if (!rm) continue;
    if (rm.complianceStatus === 'deviation') {
      failingRoomIds.push(rm.id);
      issues.push({
        id: `elig-rm-${rm.id}`,
        entityKind: 'room',
        entityId: rm.id,
        entityCode: rm.code,
        entityName: rm.name,
        reasonType: 'room-deviation',
        severity: 'blocking',
        message: `${rm.name} (${rm.code}) has an active GMP cleanroom deviation.`,
      });
    } else if (rm.complianceStatus === 'review-due') {
      compliantRoomIds.push(rm.id);
      issues.push({
        id: `elig-rm-warn-${rm.id}`,
        entityKind: 'room',
        entityId: rm.id,
        entityCode: rm.code,
        entityName: rm.name,
        reasonType: 'room-deviation',
        severity: 'warning',
        message: `${rm.name} (${rm.code}) cleanroom qualification review is due soon.`,
      });
    } else {
      compliantRoomIds.push(rm.id);
    }
  }

  // Check every assigned Equipment Asset
  for (const assetId of line.assetIds) {
    const asset = scene.assets.find((a) => a.id === assetId);
    if (!asset) continue;
    const comp = complianceMap[asset.id] ?? buildDefaultComplianceForAsset(asset, 0);
    let assetBlocked = false;

    const calStatus = computeDateStatus(comp.calibration.nextDueDate, now);
    if (calStatus === 'overdue') {
      assetBlocked = true;
      const d = daysPast(comp.calibration.nextDueDate);
      issues.push({
        id: `elig-cal-${asset.id}`,
        entityKind: 'asset',
        entityId: asset.id,
        entityCode: asset.assetId,
        entityName: asset.name,
        reasonType: 'calibration',
        severity: 'blocking',
        dueDate: comp.calibration.nextDueDate,
        daysOverdue: d,
        message: `Calibration expired on ${comp.calibration.nextDueDate} (${d}d overdue).`,
      });
    } else if (calStatus === 'due-soon') {
      issues.push({
        id: `elig-cal-w-${asset.id}`,
        entityKind: 'asset',
        entityId: asset.id,
        entityCode: asset.assetId,
        entityName: asset.name,
        reasonType: 'calibration',
        severity: 'warning',
        dueDate: comp.calibration.nextDueDate,
        message: `Calibration due soon on ${comp.calibration.nextDueDate}.`,
      });
    }

    const qualStatus = computeDateStatus(comp.qualification.nextDueDate, now);
    if (qualStatus === 'overdue') {
      assetBlocked = true;
      const d = daysPast(comp.qualification.nextDueDate);
      issues.push({
        id: `elig-qual-${asset.id}`,
        entityKind: 'asset',
        entityId: asset.id,
        entityCode: asset.assetId,
        entityName: asset.name,
        reasonType: 'qualification',
        severity: 'blocking',
        dueDate: comp.qualification.nextDueDate,
        daysOverdue: d,
        message: `${comp.qualification.stage} qualification expired on ${comp.qualification.nextDueDate} (${d}d overdue).`,
      });
    } else if (qualStatus === 'due-soon') {
      issues.push({
        id: `elig-qual-w-${asset.id}`,
        entityKind: 'asset',
        entityId: asset.id,
        entityCode: asset.assetId,
        entityName: asset.name,
        reasonType: 'qualification',
        severity: 'warning',
        dueDate: comp.qualification.nextDueDate,
        message: `${comp.qualification.stage} qualification review approaching (${comp.qualification.nextDueDate}).`,
      });
    }

    const pmStatus = computeDateStatus(comp.maintenance.nextDueDate, now);
    if (pmStatus === 'overdue') {
      assetBlocked = true;
      const d = daysPast(comp.maintenance.nextDueDate);
      issues.push({
        id: `elig-pm-${asset.id}`,
        entityKind: 'asset',
        entityId: asset.id,
        entityCode: asset.assetId,
        entityName: asset.name,
        reasonType: 'maintenance',
        severity: 'blocking',
        dueDate: comp.maintenance.nextDueDate,
        daysOverdue: d,
        message: `Preventive Maintenance overdue since ${comp.maintenance.nextDueDate} (${d}d overdue).`,
      });
    } else if (pmStatus === 'due-soon') {
      issues.push({
        id: `elig-pm-w-${asset.id}`,
        entityKind: 'asset',
        entityId: asset.id,
        entityCode: asset.assetId,
        entityName: asset.name,
        reasonType: 'maintenance',
        severity: 'warning',
        dueDate: comp.maintenance.nextDueDate,
        message: `Preventive Maintenance due soon (${comp.maintenance.nextDueDate}).`,
      });
    }

    const blockingWos = workOrders.filter(
      (wo) =>
        wo.targetId === asset.id &&
        wo.status !== 'completed' &&
        (wo.status === 'overdue' || wo.priority === 'critical')
    );
    for (const wo of blockingWos) {
      assetBlocked = true;
      issues.push({
        id: `elig-wo-${wo.id}`,
        entityKind: 'asset',
        entityId: asset.id,
        entityCode: asset.assetId,
        entityName: asset.name,
        reasonType: 'work-order',
        severity: 'blocking',
        dueDate: wo.dueDate,
        message: `Open ${wo.priority.toUpperCase()} Work Order ${wo.woNumber}: ${wo.title}`,
      });
    }

    if (assetBlocked) failingAssetIds.push(asset.id);
    else compliantAssetIds.push(asset.id);
  }

  const blockingCount = issues.filter((i) => i.severity === 'blocking').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  return {
    lineId: line.id,
    lineName: line.name,
    checkedAt: new Date().toISOString(),
    eligible: blockingCount === 0,
    blockingCount,
    warningCount,
    compliantAssetIds,
    failingAssetIds,
    compliantRoomIds,
    failingRoomIds,
    issues,
  };
}

export const useGmpStore = create<GmpState>((set, get) => {
  const initialScene = useTwinStore.getState().scene;
  const persisted = loadPersistedGmp();

  const complianceByAssetId: Record<string, EquipmentComplianceRecord> = {
    ...(persisted?.complianceByAssetId ?? {}),
  };
  initialScene.assets.forEach((a, idx) => {
    if (!complianceByAssetId[a.id]) {
      complianceByAssetId[a.id] = buildDefaultComplianceForAsset(a, idx);
    }
  });

  const productionLines =
    persisted?.productionLines && persisted.productionLines.length > 0
      ? persisted.productionLines
      : buildSeedProductionLines(initialScene);

  const workOrders =
    persisted?.workOrders && persisted.workOrders.length > 0
      ? persisted.workOrders
      : buildSeedWorkOrders(initialScene, productionLines);

  const cronJobs =
    persisted?.cronJobs && persisted.cronJobs.length > 0
      ? persisted.cronJobs
      : buildSeedCronJobs(initialScene, productionLines);

  return {
    initializedForProjectId: initialScene.id,
    complianceByAssetId,
    productionLines,
    eligibilityByLineId: {},
    activeLineHighlight: null,
    workOrders,
    cronJobs,
    personnel:
      persisted?.personnel && persisted.personnel.length > 0
        ? persisted.personnel
        : INITIAL_ELIGIBLE_PERSONNEL,
    sops:
      persisted?.sops && persisted.sops.length > 0 ? persisted.sops : INITIAL_SOP_DOCUMENTS,
    wikiArticles:
      persisted?.wikiArticles && persisted.wikiArticles.length > 0
        ? persisted.wikiArticles
        : INITIAL_WIKI_ARTICLES,

    showGmpModal: false,
    gmpTab: 'lines',
    focusedAssetId: null,
    focusedLineId: productionLines[0]?.id ?? null,
    focusedSopId: null,
    focusedWikiId: null,

    showQrLabelModal: false,
    qrLabelTab: 'scanner',
    preselectedLabelIds: [],

    showMiniMap: true,
    miniMapTarget: null,

    syncWithScene: (scene) => {
      const state = get();
      let changed = false;
      const nextComp = { ...state.complianceByAssetId };
      scene.assets.forEach((a, idx) => {
        if (!nextComp[a.id]) {
          nextComp[a.id] = buildDefaultComplianceForAsset(a, idx);
          changed = true;
        }
      });
      if (changed || state.initializedForProjectId !== scene.id) {
        set({ complianceByAssetId: nextComp, initializedForProjectId: scene.id });
        persist({ ...get(), complianceByAssetId: nextComp });
      }
    },

    getCompliance: (assetId) => {
      const state = get();
      if (state.complianceByAssetId[assetId]) return state.complianceByAssetId[assetId];
      const asset = useTwinStore.getState().scene.assets.find((a) => a.id === assetId);
      if (!asset) return null;
      const built = buildDefaultComplianceForAsset(asset, 0);
      set((s) => ({
        complianceByAssetId: { ...s.complianceByAssetId, [assetId]: built },
      }));
      return built;
    },

    updateCompliance: (assetId, patch) => {
      const current = get().getCompliance(assetId);
      if (!current) return;
      const now = new Date();
      const nextCal = patch.calibration
        ? {
            ...current.calibration,
            ...patch.calibration,
            status: computeDateStatus(
              patch.calibration.nextDueDate ?? current.calibration.nextDueDate,
              now
            ),
          }
        : current.calibration;
      const nextQual = patch.qualification
        ? {
            ...current.qualification,
            ...patch.qualification,
            status: computeDateStatus(
              patch.qualification.nextDueDate ?? current.qualification.nextDueDate,
              now
            ),
          }
        : current.qualification;
      const nextPm = patch.maintenance
        ? {
            ...current.maintenance,
            ...patch.maintenance,
            status: computeDateStatus(
              patch.maintenance.nextDueDate ?? current.maintenance.nextDueDate,
              now
            ),
          }
        : current.maintenance;

      const updated: EquipmentComplianceRecord = {
        ...current,
        calibration: nextCal,
        qualification: nextQual,
        maintenance: nextPm,
        owner: patch.owner ?? current.owner,
        department: patch.department ?? current.department,
        gmpCriticality: patch.gmpCriticality ?? current.gmpCriticality,
      };

      const nextMap = { ...get().complianceByAssetId, [assetId]: updated };
      set({ complianceByAssetId: nextMap });
      persist(get());

      // Refresh active line highlight if open
      const activeHl = get().activeLineHighlight;
      if (activeHl) {
        get().checkLineEligibility(activeHl.lineId, useTwinStore.getState().scene, true);
      }

      const asset = useTwinStore.getState().scene.assets.find((a) => a.id === assetId);
      useTwinStore.getState().recordAudit({
        category: 'asset',
        action: 'Updated GMP Compliance Dates',
        entityType: 'asset',
        entityId: assetId,
        entityName: asset?.name ?? assetId,
        summary: `Updated Cal (${nextCal.nextDueDate}), Qual (${nextQual.nextDueDate}), PM (${nextPm.nextDueDate})`,
      });
    },

    addLifecycleEvent: (assetId, event) => {
      const current = get().getCompliance(assetId);
      if (!current) return;
      const created: EquipmentLifecycleEvent = {
        ...event,
        id: `lc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        assetId,
      };
      const updated: EquipmentComplianceRecord = {
        ...current,
        lifecycleEvents: [created, ...current.lifecycleEvents],
      };
      set((s) => ({
        complianceByAssetId: { ...s.complianceByAssetId, [assetId]: updated },
      }));
      persist(get());
    },

    saveProductionLine: (input) => {
      const existing = input.id
        ? get().productionLines.find((l) => l.id === input.id)
        : undefined;
      const line: ProductionLine = existing
        ? { ...existing, ...input, id: existing.id }
        : {
            ...input,
            id: `line-${Date.now().toString(36)}`,
          };
      const nextLines = existing
        ? get().productionLines.map((l) => (l.id === line.id ? line : l))
        : [...get().productionLines, line];

      set({ productionLines: nextLines, focusedLineId: line.id });
      persist(get());

      useTwinStore.getState().recordAudit({
        category: 'spatial',
        action: existing ? 'Updated Production Line Master Data' : 'Created Production Line Master Data',
        entityType: 'project',
        entityId: line.id,
        entityName: `${line.code} · ${line.name}`,
        summary: `${line.roomIds.length} rooms, ${line.assetIds.length} equipment assigned`,
      });
      return line;
    },

    deleteProductionLine: (lineId) => {
      set((s) => ({
        productionLines: s.productionLines.filter((l) => l.id !== lineId),
        activeLineHighlight: s.activeLineHighlight?.lineId === lineId ? null : s.activeLineHighlight,
      }));
      persist(get());
    },

    checkLineEligibility: (lineId, sceneArg, highlightOnMap = true) => {
      const scene = sceneArg ?? useTwinStore.getState().scene;
      get().syncWithScene(scene);
      const line = get().productionLines.find((l) => l.id === lineId);
      if (!line) return null;

      const result = evaluateProductionLine(
        line,
        scene,
        get().complianceByAssetId,
        get().workOrders
      );

      set((s) => ({
        productionLines: s.productionLines.map((l) =>
          l.id === lineId ? { ...l, lastEligibilityCheck: result.checkedAt } : l
        ),
        eligibilityByLineId: { ...s.eligibilityByLineId, [lineId]: result },
        activeLineHighlight: highlightOnMap ? result : s.activeLineHighlight,
      }));
      persist(get());

      useTwinStore.getState().recordAudit({
        category: 'validation-ai',
        action: `Production Line Eligibility Check (${result.eligible ? 'ELIGIBLE' : 'BLOCKED'})`,
        entityType: 'project',
        entityId: line.id,
        entityName: `${line.code} · ${line.name}`,
        summary: result.eligible
          ? `All ${result.compliantAssetIds.length} equipment & ${result.compliantRoomIds.length} rooms compliant.`
          : `Blocked by ${result.blockingCount} compliance issue(s), ${result.warningCount} warning(s).`,
      });

      return result;
    },

    clearLineHighlight: () => set({ activeLineHighlight: null }),

    createWorkOrder: (input) => {
      const nextNum = get().workOrders.length + 101;
      const created: WorkOrder = {
        ...input,
        id: `wo-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        woNumber: `WO-2026-0${nextNum}`,
        createdAt: todayIso(),
      };
      set((s) => ({ workOrders: [created, ...s.workOrders] }));
      persist(get());

      if (created.targetKind === 'asset') {
        get().addLifecycleEvent(created.targetId, {
          date: todayIso(),
          stage: 'work-order',
          title: `Work Order Created: ${created.woNumber} (${created.serviceType})`,
          performedBy: created.assigneeName,
          referenceDoc: created.woNumber,
          outcome: 'info',
          notes: `${created.title} — Due ${created.dueDate}.`,
        });
      }

      useTwinStore.getState().recordAudit({
        category: 'asset',
        action: `Created Work Order ${created.woNumber}`,
        entityType: created.targetKind === 'room' ? 'room' : 'asset',
        entityId: created.targetId,
        entityName: created.targetName,
        summary: `${created.serviceType} assigned to ${created.assigneeName}, due ${created.dueDate}`,
      });
      return created;
    },

    updateWorkOrderStatus: (woId, status) => {
      const wo = get().workOrders.find((w) => w.id === woId);
      if (!wo) return;
      const nowIso = todayIso();

      set((s) => ({
        workOrders: s.workOrders.map((w) =>
          w.id === woId
            ? {
                ...w,
                status,
                completedDate: status === 'completed' ? nowIso : w.completedDate,
              }
            : w
        ),
      }));

      // Auto-roll forward equipment calibration/qualification/maintenance due date upon completion!
      if (status === 'completed' && wo.targetKind === 'asset') {
        const comp = get().getCompliance(wo.targetId);
        if (comp) {
          if (wo.serviceType === 'calibration') {
            const nextDue = addDaysToIso(nowIso, comp.calibration.intervalDays || 180);
            get().updateCompliance(wo.targetId, {
              calibration: {
                lastDate: nowIso,
                nextDueDate: nextDue,
                performedBy: wo.assigneeName,
                certificateOrProtocol: `${wo.woNumber}-CERT`,
              },
            });
          } else if (wo.serviceType === 'qualification') {
            const nextDue = addDaysToIso(nowIso, comp.qualification.intervalDays || 365);
            get().updateCompliance(wo.targetId, {
              qualification: {
                lastDate: nowIso,
                nextDueDate: nextDue,
                performedBy: wo.assigneeName,
                certificateOrProtocol: `${wo.woNumber}-PQ`,
              },
            });
          } else if (wo.serviceType === 'maintenance' || wo.serviceType === 'cleaning-cip-sip') {
            const nextDue = addDaysToIso(nowIso, comp.maintenance.intervalDays || 90);
            get().updateCompliance(wo.targetId, {
              maintenance: {
                lastDate: nowIso,
                nextDueDate: nextDue,
                performedBy: wo.assigneeName,
                certificateOrProtocol: `${wo.woNumber}-PM`,
              },
            });
          }

          get().addLifecycleEvent(wo.targetId, {
            date: nowIso,
            stage:
              wo.serviceType === 'calibration'
                ? 'calibration'
                : wo.serviceType === 'qualification'
                  ? 'qualification-oq-pq'
                  : 'maintenance',
            title: `Completed ${wo.woNumber}: ${wo.title}`,
            performedBy: wo.assigneeName,
            referenceDoc: wo.woNumber,
            outcome: 'pass',
            notes: `Service executed and closed; next compliance due date automatically rolled forward.`,
          });
        }
      }

      persist(get());
    },

    toggleWorkOrderChecklist: (woId, checkId) => {
      set((s) => ({
        workOrders: s.workOrders.map((w) =>
          w.id === woId
            ? {
                ...w,
                checklist: w.checklist.map((c) =>
                  c.id === checkId ? { ...c, done: !c.done } : c
                ),
              }
            : w
        ),
      }));
      persist(get());
    },

    deleteWorkOrder: (woId) => {
      set((s) => ({ workOrders: s.workOrders.filter((w) => w.id !== woId) }));
      persist(get());
    },

    addCronJob: (input) => {
      const created: CronScheduleJob = {
        ...input,
        id: `cron-${Date.now().toString(36)}`,
        generatedCount: 0,
      };
      set((s) => ({ cronJobs: [created, ...s.cronJobs] }));
      persist(get());
      return created;
    },

    toggleCronJob: (jobId) => {
      set((s) => ({
        cronJobs: s.cronJobs.map((j) => (j.id === jobId ? { ...j, enabled: !j.enabled } : j)),
      }));
      persist(get());
    },

    runCronJobNow: (jobId) => {
      const job = get().cronJobs.find((j) => j.id === jobId);
      if (!job) return null;
      const tech = get().personnel.find((p) => p.id === job.defaultAssigneeId) ?? get().personnel[0];
      const nowIso = todayIso();
      const dueDate = addDaysToIso(nowIso, Math.min(30, Math.max(7, Math.round(job.intervalDays / 3))));

      const wo = get().createWorkOrder({
        title: `[Auto-Cron] ${job.name}`,
        description: `Automatically spawned by Cron rule (${job.cronExpression} · ${job.humanSchedule}).`,
        serviceType: job.serviceType,
        targetKind: job.targetKind,
        targetId: job.targetId,
        targetName: job.targetName,
        targetCategory: job.targetCategory,
        assigneeId: tech?.id ?? 'tech-tavakoli',
        assigneeName: tech?.name ?? 'Reza Tavakoli',
        priority: job.priority,
        status: 'open',
        lastServiceDate: job.lastRunAt ?? nowIso,
        dueDate,
        estimatedHours: 2.5,
        sopId: job.sopId,
        cronJobId: job.id,
        checklist: [
          { id: `chk-${Date.now()}-1`, text: `Review attached SOP & safety permit`, done: false },
          { id: `chk-${Date.now()}-2`, text: `Execute ${job.serviceType} protocol & verify tolerances`, done: false },
          { id: `chk-${Date.now()}-3`, text: `Sign electronic audit log & update asset label`, done: false },
        ],
      });

      set((s) => ({
        cronJobs: s.cronJobs.map((j) =>
          j.id === jobId
            ? {
                ...j,
                lastRunAt: nowIso,
                nextRunAt: addDaysToIso(nowIso, j.intervalDays),
                generatedCount: j.generatedCount + 1,
              }
            : j
        ),
      }));
      persist(get());
      useTwinStore.getState().showToast(`Cron job spawned ${wo.woNumber} (Due ${dueDate})`, 'success');
      return wo;
    },

    deleteCronJob: (jobId) => {
      set((s) => ({ cronJobs: s.cronJobs.filter((j) => j.id !== jobId) }));
      persist(get());
    },

    addTechnician: (input) => {
      const created: EligibleTechnician = {
        ...input,
        id: `tech-${Date.now().toString(36)}`,
      };
      set((s) => ({ personnel: [...s.personnel, created] }));
      persist(get());
      return created;
    },

    getEligiblePersonnel: (category, serviceType) => {
      return get().personnel.filter(
        (p) =>
          p.active &&
          p.certifiedCategories.includes(category) &&
          p.certifiedServices.includes(serviceType)
      );
    },

    addSopDocument: (input) => {
      const created: SopDocument = {
        ...input,
        id: `sop-${Date.now().toString(36)}`,
      };
      set((s) => ({ sops: [created, ...s.sops], focusedSopId: created.id }));
      persist(get());
      return created;
    },

    updateSopDocument: (id, patch) => {
      set((s) => ({
        sops: s.sops.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      }));
      persist(get());
    },

    addWikiArticle: (input) => {
      const created: WikiArticle = {
        ...input,
        id: `wiki-${Date.now().toString(36)}`,
      };
      set((s) => ({ wikiArticles: [created, ...s.wikiArticles], focusedWikiId: created.id }));
      persist(get());
      return created;
    },

    openGmpModal: (opts) => {
      get().syncWithScene(useTwinStore.getState().scene);
      set((s) => ({
        showGmpModal: true,
        gmpTab: opts?.tab ?? s.gmpTab,
        focusedAssetId: opts?.assetId !== undefined ? opts.assetId : s.focusedAssetId,
        focusedLineId: opts?.lineId !== undefined ? opts.lineId : s.focusedLineId,
        focusedSopId: opts?.sopId !== undefined ? opts.sopId : s.focusedSopId,
        focusedWikiId: opts?.wikiId !== undefined ? opts.wikiId : s.focusedWikiId,
      }));
    },

    closeGmpModal: () => set({ showGmpModal: false }),
    setGmpTab: (gmpTab) => set({ gmpTab }),

    openQrLabelModal: (tab = 'scanner', preselectedIds) => {
      get().syncWithScene(useTwinStore.getState().scene);
      set((s) => ({
        showQrLabelModal: true,
        qrLabelTab: tab,
        preselectedLabelIds: preselectedIds ?? s.preselectedLabelIds,
      }));
    },
    closeQrLabelModal: () => set({ showQrLabelModal: false }),

    setShowMiniMap: (showMiniMap) => set({ showMiniMap }),
    jumpFromMiniMap: (x, z) => {
      const twin = useTwinStore.getState();
      const fl = twin.scene.floors.find((f) => f.id === twin.activeFloorId) ?? twin.scene.floors[0];
      const elev = fl?.elevation ?? 0;
      // Fly 3D camera smoothly to the clicked mini-map location
      twin.flyToCamera([x + 6.5, elev + 8.5, z + 7.5], [x, elev + 0.8, z]);
      // Also notify Viewport2D to center pan on (x, z)
      set({ miniMapTarget: { x, z, ts: Date.now() } });
    },
  };
});
