import { create } from 'zustand';
import type {
  AssignmentStatus,
  CronScheduleJob,
  EligibilityIssue,
  EligibleTechnician,
  EquipmentComplianceRecord,
  EquipmentLifecycleEvent,
  GmpModalTab,
  GmpWorkflowInstance,
  GmpWorkflowStep,
  ProductionLine,
  ProductionLineEligibilityResult,
  QrLabelModalTab,
  ResourceAssignment,
  ServiceActionType,
  ShiftWindow,
  SopDocument,
  WikiArticle,
  WorkOrder,
  WorkOrderStatus,
} from '../types/gmp';
import type { DigitalTwinScene, EquipmentCategory } from '../types/twin';
import {
  addDaysToIso,
  buildComprehensiveSopsForScene,
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
  workflows?: GmpWorkflowInstance[];
  resourceAssignments?: ResourceAssignment[];
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
  workflows: GmpWorkflowInstance[];
  resourceAssignments: ResourceAssignment[];

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

  showResourceSchedulingModal: boolean;
  focusedScheduleRoomId: string | null;

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

  // GMP Workflows
  createWorkflow: (wf: Omit<GmpWorkflowInstance, 'id' | 'code' | 'createdAt' | 'updatedAt'>) => GmpWorkflowInstance;
  advanceWorkflowStep: (
    workflowId: string,
    stepId: string,
    action: 'start' | 'complete' | 'reject',
    signedBy?: string,
    notes?: string
  ) => void;
  addWorkflowStep: (workflowId: string, step: Omit<GmpWorkflowStep, 'id'>) => void;
  deleteWorkflow: (workflowId: string) => void;

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

  // Resource Scheduling & Zone Dispatch
  openResourceSchedulingModal: (roomId?: string | null) => void;
  closeResourceSchedulingModal: () => void;
  assignResourceToZone: (
    assignment: Omit<ResourceAssignment, 'id' | 'createdAt'>,
    relocateEquipmentOnMap?: boolean
  ) => ResourceAssignment;
  updateResourceAssignmentStatus: (id: string, status: AssignmentStatus) => void;
  removeResourceAssignment: (id: string) => void;
  autoBalanceAssignmentsForTelemetry: (
    roomTelemetryMap: Record<string, { status: 'nominal' | 'warning' | 'alarm'; summary: string }>
  ) => { held: number; resumed: number };

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
    workflows: state.workflows,
    resourceAssignments: state.resourceAssignments,
  });
}

function buildSeedResourceAssignments(
  scene: DigitalTwinScene,
  personnel: EligibleTechnician[]
): ResourceAssignment[] {
  const today = todayIso();
  const rooms = scene.rooms;
  if (rooms.length === 0) return [];

  const pickRoom = (predicate: (r: DigitalTwinScene['rooms'][number]) => boolean, fallbackIdx: number) =>
    rooms.find(predicate) ?? rooms[fallbackIdx % rooms.length];

  const bioRoom = pickRoom((r) => /bioreactor|upstream|ferment/i.test(r.name), 0);
  const fillRoom = pickRoom((r) => /fill|aseptic|lyo/i.test(r.name), 1);
  const qcRoom = pickRoom((r) => /qc|lab|hplc|analyt/i.test(r.name), 2);
  const coldRoom = pickRoom((r) => /cold|warehouse|storage/i.test(r.name), 3);

  const findAssetForRoom = (roomId: string, fallbackIdx: number) =>
    scene.assets.find((a) => a.roomId === roomId) ?? scene.assets[fallbackIdx % Math.max(1, scene.assets.length)];

  const seed: ResourceAssignment[] = [];
  const shiftList: ShiftWindow[] = ['morning-06-14', 'morning-06-14', 'swing-14-22', 'morning-06-14'];
  const targetRooms = [bioRoom, fillRoom, qcRoom, coldRoom];

  targetRooms.forEach((rm, idx) => {
    const tech = personnel[idx % personnel.length];
    if (rm && tech) {
      seed.push({
        id: `ra-seed-staff-${idx + 1}`,
        roomId: rm.id,
        roomCode: rm.code,
        roomName: rm.name,
        floorId: rm.floorId,
        date: today,
        shift: shiftList[idx],
        resourceKind: 'personnel',
        resourceId: tech.id,
        resourceCode: tech.badgeId,
        resourceName: tech.name,
        roleOrCategory: tech.role,
        status: idx === 0 ? 'active' : 'scheduled',
        telemetryGatePassed: true,
        telemetrySnapshotNote: `${rm.environmental.temperatureC.toFixed(1)}°C · ${rm.environmental.humidityPct}% RH · ${rm.environmental.pressurePa >= 0 ? '+' : ''}${rm.environmental.pressurePa} Pa`,
        notes: idx === 0 ? 'Batch inoculation & live bioprocess monitoring' : 'Scheduled zone coverage & GMP log verification',
        createdAt: new Date().toISOString(),
        assignedBy: 'Operations Manager',
      });
    }
    const asset = rm ? findAssetForRoom(rm.id, idx) : undefined;
    if (rm && asset && idx < 3) {
      seed.push({
        id: `ra-seed-eq-${idx + 1}`,
        roomId: rm.id,
        roomCode: rm.code,
        roomName: rm.name,
        floorId: rm.floorId,
        date: today,
        shift: shiftList[idx],
        resourceKind: 'equipment',
        resourceId: asset.id,
        resourceCode: asset.assetId,
        resourceName: asset.name,
        roleOrCategory: asset.category,
        status: idx === 0 ? 'active' : 'scheduled',
        telemetryGatePassed: true,
        telemetrySnapshotNote: `${rm.environmental.temperatureC.toFixed(1)}°C · ${rm.environmental.humidityPct}% RH · ${rm.environmental.pressurePa >= 0 ? '+' : ''}${rm.environmental.pressurePa} Pa`,
        notes: 'Primary campaign unit reserved for shift run',
        createdAt: new Date().toISOString(),
        assignedBy: 'Operations Manager',
      });
    }
  });

  return seed;
}

function buildSeedWorkflows(): GmpWorkflowInstance[] {
  const today = todayIso();
  return [
    {
      id: 'wf-pred-lyo',
      code: 'WF-2026-104',
      title: 'Predictive Pre-Failure Intervention — Lyophilizer Condenser & Vacuum Seal',
      description:
        'Triggered by historical lifecycle wear model + overdue vacuum sensor calibration. Replace condenser elastomer seal and execute OQ leak-rate verification prior to estimated failure window.',
      workflowType: 'preventive-intervention',
      priority: 'critical',
      status: 'active',
      triggerSource: 'predictive-forecast',
      linkedLineId: 'line-fill-02',
      linkedLineName: 'LINE-02 · Aseptic Fill-Finish & Lyo',
      linkedAssetCode: 'LYO-401',
      linkedAssetName: 'Production Lyophilizer LYO-401',
      predictedFailureDate: addDaysToIso(today, 14),
      createdAt: addDaysToIso(today, -2),
      updatedAt: today,
      steps: [
        {
          id: 'st-104-1',
          title: 'Predictive Risk Triage & Line Hold Assessment',
          roleRequired: 'Reliability Engineer',
          assigneeName: 'Marcus Vance',
          status: 'completed',
          slaHours: 4,
          completedAt: addDaysToIso(today, -1),
          signedBy: 'Marcus Vance',
          signatureHash: '21CFR-A8F4C91E',
          notes: 'Confirmed accelerated vacuum pump cycling from historical lifecycle events.',
        },
        {
          id: 'st-104-2',
          title: 'Execute Seal Kit Replacement & Vacuum Calibration',
          roleRequired: 'Certified Metrology Tech',
          assigneeName: 'Sara Lindqvist',
          status: 'in-progress',
          slaHours: 16,
          notes: 'Spare EPDM seal kit staged in Grade C airlock; calibration standard NIST-992 ready.',
        },
        {
          id: 'st-104-3',
          title: 'Leak-Rate OQ Verification (< 0.02 mbar·L/s)',
          roleRequired: 'Validation Specialist',
          assigneeName: 'Reza Tavakoli',
          status: 'pending',
          slaHours: 8,
        },
        {
          id: 'st-104-4',
          title: 'QA Batch Release & Production Line Re-Eligibility Sign-Off',
          roleRequired: 'QA / GMP Compliance Lead',
          assigneeName: 'Dr. Elena Rostova',
          status: 'pending',
          slaHours: 6,
        },
      ],
    },
    {
      id: 'wf-capa-fill',
      code: 'WF-2026-105',
      title: 'Deviation & CAPA — Aseptic Vial Filler Isolator Re-Qualification',
      description:
        'Corrective workflow to clear blocked LINE-02 eligibility caused by overdue PQ smoke-study and particle counter calibration.',
      workflowType: 'deviation-capa',
      priority: 'high',
      status: 'waiting-approval',
      triggerSource: 'eligibility-block',
      linkedLineId: 'line-fill-02',
      linkedLineName: 'LINE-02 · Aseptic Fill-Finish & Lyo',
      linkedAssetCode: 'FILL-402',
      linkedAssetName: 'Aseptic Vial Filler Isolator FILL-402',
      predictedFailureDate: addDaysToIso(today, 22),
      createdAt: addDaysToIso(today, -4),
      updatedAt: today,
      steps: [
        {
          id: 'st-105-1',
          title: 'Log Deviation DEV-2026-088 & Quarantine Batch Window',
          roleRequired: 'QA Specialist',
          assigneeName: 'Dr. Elena Rostova',
          status: 'completed',
          slaHours: 2,
          completedAt: addDaysToIso(today, -3),
          signedBy: 'Dr. Elena Rostova',
          signatureHash: '21CFR-7D31E20B',
        },
        {
          id: 'st-105-2',
          title: 'ISO 5 Laminar Airflow & Particle Counter Re-Calibration',
          roleRequired: 'Cleanroom Metrology',
          assigneeName: 'Sara Lindqvist',
          status: 'completed',
          slaHours: 12,
          completedAt: addDaysToIso(today, -1),
          signedBy: 'Sara Lindqvist',
          signatureHash: '21CFR-9B14F82A',
          notes: '0.5μm & 5.0μm channels verified within ISO 14644-1 Grade A limits.',
        },
        {
          id: 'st-105-3',
          title: 'Final QA Director E-Signature & CAPA Closure',
          roleRequired: 'QA Director',
          assigneeName: 'Dr. Elena Rostova',
          status: 'in-progress',
          slaHours: 8,
        },
      ],
    },
    {
      id: 'wf-rel-mab',
      code: 'WF-2026-106',
      title: 'Pre-Campaign Batch Release — LINE-01 mAb Drug Substance Suite',
      description:
        'Standard GMP line clearance, CIP/SIP verification, and digital twin eligibility attestation before 2000L bioreactor inoculation.',
      workflowType: 'line-release',
      priority: 'medium',
      status: 'completed',
      triggerSource: 'manual',
      linkedLineId: 'line-mab-01',
      linkedLineName: 'LINE-01 · mAb Drug Substance Suite',
      linkedAssetCode: 'BR-2001',
      linkedAssetName: '2000L Stainless Steel Bioreactor BR-2001',
      createdAt: addDaysToIso(today, -6),
      updatedAt: addDaysToIso(today, -2),
      steps: [
        {
          id: 'st-106-1',
          title: 'Automated Twin Eligibility Check (All Dates Valid)',
          roleRequired: 'Production Supervisor',
          assigneeName: 'Marcus Vance',
          status: 'completed',
          slaHours: 2,
          completedAt: addDaysToIso(today, -5),
          signedBy: 'Marcus Vance',
          signatureHash: '21CFR-4C90B11F',
        },
        {
          id: 'st-106-2',
          title: 'SIP Sterilization Cycle Attestation (121.5°C / 30 min)',
          roleRequired: 'Bioprocess Lead',
          assigneeName: 'David Okafor',
          status: 'completed',
          slaHours: 6,
          completedAt: addDaysToIso(today, -3),
          signedBy: 'David Okafor',
          signatureHash: '21CFR-6E22D40C',
        },
        {
          id: 'st-106-3',
          title: 'QA Final Line Release Sign-Off',
          roleRequired: 'QA / GMP Compliance Lead',
          assigneeName: 'Dr. Elena Rostova',
          status: 'completed',
          slaHours: 4,
          completedAt: addDaysToIso(today, -2),
          signedBy: 'Dr. Elena Rostova',
          signatureHash: '21CFR-1F88A73D',
        },
      ],
    },
  ];
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

  const personnelList =
    persisted?.personnel && persisted.personnel.length > 0
      ? persisted.personnel
      : INITIAL_ELIGIBLE_PERSONNEL;

  const resourceAssignments =
    persisted?.resourceAssignments && persisted.resourceAssignments.length > 0
      ? persisted.resourceAssignments
      : buildSeedResourceAssignments(initialScene, personnelList);

  return {
    initializedForProjectId: initialScene.id,
    complianceByAssetId,
    productionLines,
    eligibilityByLineId: {},
    activeLineHighlight: null,
    workOrders,
    cronJobs,
    personnel: personnelList,
    sops: (() => {
      const generated = buildComprehensiveSopsForScene(initialScene);
      const base = persisted?.sops && persisted.sops.length > 0 ? [...persisted.sops] : [];
      const seen = new Set(base.map((d) => d.id));
      generated.forEach((doc) => {
        if (!seen.has(doc.id)) {
          base.push(doc);
          seen.add(doc.id);
        }
      });
      return base;
    })(),
    wikiArticles:
      persisted?.wikiArticles && persisted.wikiArticles.length > 0
        ? persisted.wikiArticles
        : INITIAL_WIKI_ARTICLES,
    workflows:
      persisted?.workflows && persisted.workflows.length > 0
        ? persisted.workflows
        : buildSeedWorkflows(),
    resourceAssignments,

    showGmpModal: false,
    gmpTab: 'lines',
    focusedAssetId: null,
    focusedLineId: productionLines[0]?.id ?? null,
    focusedSopId: null,
    focusedWikiId: null,

    showQrLabelModal: false,
    qrLabelTab: 'scanner',
    preselectedLabelIds: [],

    showResourceSchedulingModal: false,
    focusedScheduleRoomId: null,

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
      const generatedSops = buildComprehensiveSopsForScene(scene);
      const seenSopIds = new Set(state.sops.map((d) => d.id));
      const missingSops = generatedSops.filter((d) => !seenSopIds.has(d.id));
      const nextSops = missingSops.length > 0 ? [...state.sops, ...missingSops] : state.sops;
      if (missingSops.length > 0) changed = true;

      if (changed || state.initializedForProjectId !== scene.id) {
        set({
          complianceByAssetId: nextComp,
          sops: nextSops,
          initializedForProjectId: scene.id,
        });
        persist({ ...get(), complianceByAssetId: nextComp, sops: nextSops });
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

    createWorkflow: (input) => {
      const today = todayIso();
      const seq = 107 + get().workflows.length;
      const created: GmpWorkflowInstance = {
        ...input,
        id: `wf-${Date.now().toString(36)}`,
        code: `WF-${today.slice(0, 4)}-${seq}`,
        createdAt: today,
        updatedAt: today,
      };
      set((s) => ({ workflows: [created, ...s.workflows] }));
      persist(get());
      useTwinStore.getState().showToast(`Launched workflow ${created.code}`, 'success');
      return created;
    },

    advanceWorkflowStep: (workflowId, stepId, action, signedBy = 'QA Operator', notes) => {
      const today = todayIso();
      const hash = `21CFR-${Math.abs(
        (workflowId + stepId + Date.now()).split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7)
      )
        .toString(16)
        .toUpperCase()
        .slice(0, 8)}`;

      let completedWf: GmpWorkflowInstance | null = null;

      set((s) => {
        const nextWorkflows = s.workflows.map((wf) => {
          if (wf.id !== workflowId) return wf;
          let autoStartNext = false;
          const nextSteps = wf.steps.map((st) => {
            if (st.id === stepId) {
              if (action === 'complete') {
                autoStartNext = true;
                return {
                  ...st,
                  status: 'completed' as const,
                  completedAt: today,
                  signedBy,
                  signatureHash: hash,
                  notes: notes ? notes : st.notes,
                };
              }
              if (action === 'reject') {
                return {
                  ...st,
                  status: 'rejected' as const,
                  completedAt: today,
                  signedBy,
                  signatureHash: hash,
                  notes: notes ? notes : st.notes,
                };
              }
              return { ...st, status: 'in-progress' as const };
            }
            if (autoStartNext && st.status === 'pending') {
              autoStartNext = false;
              return { ...st, status: 'in-progress' as const };
            }
            return st;
          });

          const allDone = nextSteps.every((st) => st.status === 'completed');
          const hasReject = nextSteps.some((st) => st.status === 'rejected');
          const lastPending =
            !allDone &&
            nextSteps.filter((st) => st.status !== 'completed').length === 1;

          const nextStatus: GmpWorkflowInstance['status'] = hasReject
            ? 'blocked'
            : allDone
              ? 'completed'
              : lastPending
                ? 'waiting-approval'
                : 'active';

          const updated: GmpWorkflowInstance = {
            ...wf,
            status: nextStatus,
            updatedAt: today,
            steps: nextSteps,
          };
          if (allDone && wf.status !== 'completed') {
            completedWf = updated;
          }
          return updated;
        });
        return { workflows: nextWorkflows };
      });

      // Automatically record immutable lifecycle audit event when a workflow completes
      if (completedWf && (completedWf as GmpWorkflowInstance).linkedAssetId) {
        const wfRef = completedWf as GmpWorkflowInstance;
        get().addLifecycleEvent(wfRef.linkedAssetId!, {
          date: today,
          stage:
            wfRef.workflowType === 'deviation-capa'
              ? 'deviation-capa'
              : wfRef.workflowType === 're-qualification'
                ? 'qualification-oq-pq'
                : 'maintenance',
          title: `Workflow Completed: ${wfRef.code} — ${wfRef.title}`,
          performedBy: signedBy,
          referenceDoc: wfRef.code,
          outcome: 'pass',
          notes: `All ${wfRef.steps.length} GMP workflow stages verified & electronically signed.`,
        });
        useTwinStore
          .getState()
          .showToast(`Workflow ${wfRef.code} completed & logged to equipment lifecycle history`, 'success');
      }
      persist(get());
    },

    addWorkflowStep: (workflowId, step) => {
      const today = todayIso();
      set((s) => ({
        workflows: s.workflows.map((wf) =>
          wf.id === workflowId
            ? {
                ...wf,
                status: wf.status === 'completed' ? 'active' : wf.status,
                updatedAt: today,
                steps: [
                  ...wf.steps,
                  {
                    ...step,
                    id: `st-${Date.now().toString(36)}`,
                  },
                ],
              }
            : wf
        ),
      }));
      persist(get());
    },

    deleteWorkflow: (workflowId) => {
      set((s) => ({ workflows: s.workflows.filter((w) => w.id !== workflowId) }));
      persist(get());
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

    openResourceSchedulingModal: (roomId = null) => {
      get().syncWithScene(useTwinStore.getState().scene);
      set({
        showResourceSchedulingModal: true,
        focusedScheduleRoomId: roomId,
      });
    },
    closeResourceSchedulingModal: () => set({ showResourceSchedulingModal: false }),

    assignResourceToZone: (assignment, relocateEquipmentOnMap = false) => {
      const created: ResourceAssignment = {
        ...assignment,
        id: `ra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
      };
      set((s) => ({
        resourceAssignments: [created, ...s.resourceAssignments],
      }));

      const twin = useTwinStore.getState();
      if (relocateEquipmentOnMap && created.resourceKind === 'equipment') {
        const targetRoom = twin.scene.rooms.find((r) => r.id === created.roomId);
        if (targetRoom) {
          const cx = Number((targetRoom.x + targetRoom.width * 0.5).toFixed(2));
          const cz = Number((targetRoom.z + targetRoom.depth * 0.5).toFixed(2));
          twin.updateAsset(created.resourceId, {
            roomId: targetRoom.id,
            floorId: targetRoom.floorId,
            x: cx,
            z: cz,
          });
        }
      }

      twin.recordAudit({
        category: created.resourceKind === 'equipment' ? 'asset' : 'spatial',
        action: `Scheduled ${created.resourceKind === 'personnel' ? 'Personnel' : 'Equipment'} to Zone`,
        entityType: created.resourceKind === 'equipment' ? 'asset' : 'room',
        entityId: created.resourceKind === 'equipment' ? created.resourceId : created.roomId,
        entityName: `${created.resourceName} → ${created.roomCode}`,
        summary: `Assigned ${created.resourceName} (${created.resourceCode}) to ${created.roomCode} (${created.roomName}) for ${created.date} (${created.shift}). Telemetry: ${created.telemetrySnapshotNote}.${created.overrideReason ? ` Override: ${created.overrideReason}` : ''}`,
      });

      twin.showToast(
        `Assigned ${created.resourceName} to ${created.roomCode} (${created.roomName})`,
        created.telemetryGatePassed ? 'success' : 'warning'
      );

      persist(get());
      return created;
    },

    updateResourceAssignmentStatus: (id, status) => {
      set((s) => ({
        resourceAssignments: s.resourceAssignments.map((item) =>
          item.id === id ? { ...item, status } : item
        ),
      }));
      persist(get());
    },

    removeResourceAssignment: (id) => {
      set((s) => ({
        resourceAssignments: s.resourceAssignments.filter((item) => item.id !== id),
      }));
      persist(get());
    },

    autoBalanceAssignmentsForTelemetry: (roomTelemetryMap) => {
      let held = 0;
      let resumed = 0;
      set((s) => ({
        resourceAssignments: s.resourceAssignments.map((item) => {
          if (item.status === 'completed') return item;
          const tel = roomTelemetryMap[item.roomId];
          if (!tel) return item;
          if (tel.status === 'alarm' && item.status !== 'telemetry-hold' && !item.overrideReason) {
            held += 1;
            return {
              ...item,
              status: 'telemetry-hold' as const,
              telemetryGatePassed: false,
              telemetrySnapshotNote: tel.summary,
            };
          }
          if (tel.status === 'nominal' && item.status === 'telemetry-hold') {
            resumed += 1;
            return {
              ...item,
              status: 'scheduled' as const,
              telemetryGatePassed: true,
              telemetrySnapshotNote: tel.summary,
            };
          }
          return item;
        }),
      }));
      persist(get());
      return { held, resumed };
    },

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
