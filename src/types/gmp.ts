import type { EquipmentCategory } from './twin';

export type ComplianceStatus = 'valid' | 'due-soon' | 'overdue' | 'in-progress' | 'not-required';

export interface ComplianceCycle {
  lastDate: string; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD
  intervalDays: number;
  certificateOrProtocol: string;
  performedBy: string;
  status: ComplianceStatus;
  notes?: string;
}

export interface EquipmentLifecycleEvent {
  id: string;
  assetId: string;
  date: string; // YYYY-MM-DD
  stage:
    | 'procurement'
    | 'fat-sat'
    | 'installation-iq'
    | 'qualification-oq-pq'
    | 'owner-change'
    | 'calibration'
    | 'maintenance'
    | 'deviation-capa'
    | 'sop-update'
    | 'work-order';
  title: string;
  performedBy: string;
  ownerSnapshot?: string;
  referenceDoc?: string;
  outcome: 'pass' | 'conditional' | 'fail' | 'info';
  notes: string;
}

export interface EquipmentComplianceRecord {
  assetId: string;
  calibration: ComplianceCycle;
  qualification: ComplianceCycle & { stage: 'IQ' | 'OQ' | 'PQ' | 'Re-PQ' };
  maintenance: ComplianceCycle;
  owner: string;
  department: string;
  gmpCriticality: 'direct-impact' | 'indirect-impact' | 'no-impact';
  lifecycleEvents: EquipmentLifecycleEvent[];
}

export interface ProductionLine {
  id: string;
  code: string;
  name: string;
  productFamily: string;
  description: string;
  owner: string;
  color: string;
  roomIds: string[];
  assetIds: string[];
  status: 'active' | 'changeover' | 'maintenance-hold' | 'standby';
  targetBatchSize: string;
  lastEligibilityCheck?: string;
}

export interface EligibilityIssue {
  id: string;
  entityKind: 'asset' | 'room';
  entityId: string;
  entityCode: string;
  entityName: string;
  reasonType: 'calibration' | 'qualification' | 'maintenance' | 'work-order' | 'room-deviation';
  severity: 'blocking' | 'warning';
  dueDate?: string;
  daysOverdue?: number;
  message: string;
}

export interface ProductionLineEligibilityResult {
  lineId: string;
  lineName: string;
  checkedAt: string;
  eligible: boolean;
  blockingCount: number;
  warningCount: number;
  compliantAssetIds: string[];
  failingAssetIds: string[];
  compliantRoomIds: string[];
  failingRoomIds: string[];
  issues: EligibilityIssue[];
}

export type ServiceActionType =
  | 'calibration'
  | 'qualification'
  | 'maintenance'
  | 'corrective-repair'
  | 'cleaning-cip-sip'
  | 'inspection';

export type WorkOrderStatus = 'open' | 'in-progress' | 'waiting-qa' | 'completed' | 'overdue';
export type WorkOrderPriority = 'critical' | 'high' | 'medium' | 'low';

export interface WorkOrder {
  id: string;
  woNumber: string;
  title: string;
  description: string;
  serviceType: ServiceActionType;
  targetKind: 'asset' | 'room' | 'line';
  targetId: string;
  targetName: string;
  targetCategory: EquipmentCategory | 'Facility / Room';
  productionLineId?: string;
  assigneeId: string;
  assigneeName: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  lastServiceDate: string;
  dueDate: string;
  completedDate?: string;
  estimatedHours: number;
  sopId?: string;
  cronJobId?: string;
  checklist: { id: string; text: string; done: boolean }[];
  createdAt: string;
}

export interface CronScheduleJob {
  id: string;
  name: string;
  cronExpression: string; // e.g. "0 6 1 */3 *"
  humanSchedule: string;
  enabled: boolean;
  serviceType: ServiceActionType;
  targetKind: 'asset' | 'line';
  targetId: string;
  targetName: string;
  targetCategory: EquipmentCategory | 'Facility / Room';
  intervalDays: number;
  defaultAssigneeId: string;
  priority: WorkOrderPriority;
  sopId?: string;
  lastRunAt?: string;
  nextRunAt: string;
  generatedCount: number;
}

export interface EligibleTechnician {
  id: string;
  name: string;
  role: string;
  department: string;
  badgeId: string;
  email: string;
  certifiedCategories: (EquipmentCategory | 'Facility / Room')[];
  certifiedServices: ServiceActionType[];
  certExpiry: string;
  active: boolean;
}

export type SopActionCategory =
  | 'Calibration'
  | 'Qualification'
  | 'Maintenance'
  | 'Operation'
  | 'Cleaning / CIP-SIP'
  | 'Deviation / CAPA';

export interface SopDocument {
  id: string;
  docNumber: string;
  title: string;
  docType: 'SOP' | 'Record' | 'Protocol' | 'Checklist';
  equipmentCategory: EquipmentCategory | 'All Equipment' | 'Facility / Room';
  archetypes?: string[];
  actionType: SopActionCategory;
  version: string;
  effectiveDate: string;
  reviewDueDate: string;
  author: string;
  status: 'effective' | 'draft' | 'under-review';
  markdown: string;
}

export interface WikiArticle {
  id: string;
  slug: string;
  title: string;
  category: 'Troubleshooting' | 'GMP Compliance' | 'Instrumentation' | 'Cleanroom HVAC' | 'IT / SCADA';
  equipmentCategories: (EquipmentCategory | 'All Equipment')[];
  tags: string[];
  author: string;
  updatedAt: string;
  severity?: 'critical' | 'common' | 'reference';
  markdown: string;
}

export type GmpWorkflowType =
  | 'preventive-intervention'
  | 'deviation-capa'
  | 'change-control'
  | 'line-release'
  | 're-qualification';

export type GmpWorkflowStepStatus = 'pending' | 'in-progress' | 'completed' | 'rejected';

export interface GmpWorkflowStep {
  id: string;
  title: string;
  roleRequired: string;
  assigneeName: string;
  status: GmpWorkflowStepStatus;
  slaHours: number;
  completedAt?: string;
  signedBy?: string;
  signatureHash?: string;
  notes?: string;
}

export interface GmpWorkflowInstance {
  id: string;
  code: string;
  title: string;
  description: string;
  workflowType: GmpWorkflowType;
  priority: WorkOrderPriority;
  status: 'active' | 'waiting-approval' | 'completed' | 'blocked';
  triggerSource: 'predictive-forecast' | 'eligibility-block' | 'telemetry-alarm' | 'manual';
  linkedLineId?: string;
  linkedLineName?: string;
  linkedAssetId?: string;
  linkedAssetCode?: string;
  linkedAssetName?: string;
  predictedFailureDate?: string;
  createdAt: string;
  updatedAt: string;
  steps: GmpWorkflowStep[];
}

export type GmpModalTab =
  | 'lines'
  | 'compliance'
  | 'predictive'
  | 'workflows'
  | 'workorders'
  | 'calendar'
  | 'sops'
  | 'wiki';
export type QrLabelModalTab = 'scanner' | 'designer';

