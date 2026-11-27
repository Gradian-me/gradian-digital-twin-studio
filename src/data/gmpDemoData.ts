import type {
  ComplianceStatus,
  CronScheduleJob,
  EligibleTechnician,
  EquipmentComplianceRecord,
  EquipmentLifecycleEvent,
  ProductionLine,
  SopDocument,
  WikiArticle,
  WorkOrder,
} from '../types/gmp';
import type { DigitalTwinScene, SpatialAsset } from '../types/twin';

export function computeDateStatus(dueDateStr: string, referenceNow = new Date()): ComplianceStatus {
  const due = new Date(`${dueDateStr}T23:59:59`);
  if (Number.isNaN(due.getTime())) return 'valid';
  const diffDays = Math.ceil((due.getTime() - referenceNow.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 21) return 'due-soon';
  return 'valid';
}

export function addDaysToIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildDefaultComplianceForAsset(
  asset: SpatialAsset,
  idx = 0
): EquipmentComplianceRecord {
  const now = new Date();
  const base = todayIso();

  // Give realistic spread so audits & eligibility checks show both compliant & attention items
  const isOverdueCal =
    asset.assetId === 'LYO-401' ||
    asset.assetId === 'FILL-402' ||
    asset.operationalStatus === 'maintenance-due';
  const isDueSoonPM = asset.assetId === 'HPLC-301' || asset.assetId === 'CHR-201' || idx % 6 === 4;

  const calLast = addDaysToIso(base, isOverdueCal ? -205 : -72 - (idx % 30));
  const calNext = addDaysToIso(base, isOverdueCal ? -14 : 95 + (idx % 60));

  const qualLast = addDaysToIso(base, -180 - (idx % 90));
  const qualNext = addDaysToIso(base, asset.assetId === 'LYO-401' ? -5 : 165 + (idx % 120));

  const pmLast = addDaysToIso(base, isDueSoonPM ? -80 : -35 - (idx % 25));
  const pmNext = addDaysToIso(base, isDueSoonPM ? 9 : 55 + (idx % 45));

  const owner = asset.owner || asset.responsiblePerson || 'Dr. N. Rahimi (Process Eng.)';
  const dept = asset.department || asset.category;

  const events: EquipmentLifecycleEvent[] = [
    {
      id: `lc-${asset.id}-1`,
      assetId: asset.id,
      date: asset.installationDate || '2024-03-12',
      stage: 'procurement',
      title: `Procurement & URS Approval (${asset.manufacturer} ${asset.model})`,
      performedBy: 'M. Shirazi · Capital Projects',
      ownerSnapshot: 'Capital Engineering Team',
      referenceDoc: `URS-${asset.assetId}-001`,
      outcome: 'pass',
      notes: `User Requirement Specification signed off for ${asset.name} (${asset.serialNumber}).`,
    },
    {
      id: `lc-${asset.id}-2`,
      assetId: asset.id,
      date: addDaysToIso(asset.installationDate || '2024-03-12', 42),
      stage: 'fat-sat',
      title: 'Factory & Site Acceptance Testing (FAT / SAT)',
      performedBy: 'A. Karimi · Validation Lead',
      ownerSnapshot: 'Commissioning & Qualification',
      referenceDoc: `SAT-${asset.assetId}-2024`,
      outcome: 'pass',
      notes: 'P&ID verification, utility hook-up, OPC UA / SCADA tag handshake, and interlock tests passed.',
    },
    {
      id: `lc-${asset.id}-3`,
      assetId: asset.id,
      date: asset.commissioningDate || '2024-06-18',
      stage: 'installation-iq',
      title: 'Installation Qualification (IQ) Completed',
      performedBy: 'S. Mohammadi · QA Validation',
      ownerSnapshot: owner,
      referenceDoc: `IQ-${asset.assetId}-R1`,
      outcome: 'pass',
      notes: 'Material certificates (316L/USP Class VI), weld logs, slope checks, and cleanroom placement verified.',
    },
    {
      id: `lc-${asset.id}-4`,
      assetId: asset.id,
      date: qualLast,
      stage: 'qualification-oq-pq',
      title: 'Operational & Performance Qualification (OQ / PQ)',
      performedBy: 'Dr. L. Azizi · QA Compliance',
      ownerSnapshot: owner,
      referenceDoc: `PQ-${asset.assetId}-R2`,
      outcome: computeDateStatus(qualNext, now) === 'overdue' ? 'conditional' : 'pass',
      notes: 'Three consecutive media/performance runs met EU GMP Annex 1 & FDA 21 CFR Part 11 acceptance criteria.',
    },
    {
      id: `lc-${asset.id}-5`,
      assetId: asset.id,
      date: addDaysToIso(qualLast, 15),
      stage: 'owner-change',
      title: `System Owner Handover to ${owner}`,
      performedBy: 'Plant Director · Quality Unit',
      ownerSnapshot: owner,
      referenceDoc: `CHG-${asset.assetId}-04`,
      outcome: 'info',
      notes: `Formal GMP system ownership transferred to ${owner} (${dept}).`,
    },
    {
      id: `lc-${asset.id}-6`,
      assetId: asset.id,
      date: calLast,
      stage: 'calibration',
      title: 'NIST-Traceable Multi-Point Sensor Calibration',
      performedBy: 'R. Tavakoli · Metrology',
      ownerSnapshot: owner,
      referenceDoc: `CAL-${asset.assetId}-26`,
      outcome: computeDateStatus(calNext, now) === 'overdue' ? 'fail' : 'pass',
      notes:
        computeDateStatus(calNext, now) === 'overdue'
          ? 'Calibration interval elapsed — re-calibration work order required before batch release.'
          : 'All temperature, pressure, pH/DO, and flow transmitters verified within ±0.15% tolerance.',
    },
    {
      id: `lc-${asset.id}-7`,
      assetId: asset.id,
      date: pmLast,
      stage: 'maintenance',
      title: 'Scheduled Preventive Maintenance (PM)',
      performedBy: 'H. Jafari · Reliability Eng.',
      ownerSnapshot: owner,
      referenceDoc: `PM-${asset.assetId}-Q1`,
      outcome: 'pass',
      notes: 'Elastomer gaskets, HEPA/vent filters, drive bearings, and safety relief valves inspected and logged.',
    },
  ];

  return {
    assetId: asset.id,
    calibration: {
      lastDate: calLast,
      nextDueDate: calNext,
      intervalDays: 180,
      certificateOrProtocol: `CAL-${asset.assetId}-2026`,
      performedBy: 'R. Tavakoli (Metrology)',
      status: computeDateStatus(calNext, now),
    },
    qualification: {
      stage: 'Re-PQ',
      lastDate: qualLast,
      nextDueDate: qualNext,
      intervalDays: 365,
      certificateOrProtocol: `PQ-${asset.assetId}-R2`,
      performedBy: 'Dr. L. Azizi (QA Validation)',
      status: computeDateStatus(qualNext, now),
    },
    maintenance: {
      lastDate: pmLast,
      nextDueDate: pmNext,
      intervalDays: 90,
      certificateOrProtocol: `PM-${asset.assetId}-90D`,
      performedBy: 'H. Jafari (Reliability)',
      status: computeDateStatus(pmNext, now),
    },
    owner,
    department: dept,
    gmpCriticality:
      asset.category === 'Biopharmaceutical' ||
      asset.category === 'Laboratory'
        ? 'direct-impact'
        : 'indirect-impact',
    lifecycleEvents: events,
  };
}

export function buildSeedProductionLines(scene: DigitalTwinScene): ProductionLine[] {
  const upstreamRooms = scene.rooms
    .filter((r) => /cell|bioreactor|purif|chrom|media|buffer|airlock/i.test(r.name))
    .slice(0, 4)
    .map((r) => r.id);
  const upstreamAssets = scene.assets
    .filter((a) => /bio|chrom|tff|sub|cip|media|buffer/i.test(a.name + ' ' + a.assetId))
    .slice(0, 6)
    .map((a) => a.id);

  const fillRooms = scene.rooms
    .filter((r) => /fill|sterile|lyo|aseptic|wash|pack/i.test(r.name))
    .slice(0, 4)
    .map((r) => r.id);
  const fillAssets = scene.assets
    .filter((a) => /lyo|fill|auto|isolator|wash|cap/i.test(a.name + ' ' + a.assetId))
    .slice(0, 6)
    .map((a) => a.id);

  const qcRooms = scene.rooms
    .filter((r) => /qc|lab|micro|server|data|cold|ware/i.test(r.name))
    .slice(0, 4)
    .map((r) => r.id);
  const qcAssets = scene.assets
    .filter((a) => /hplc|bsc|rack|scada|freez|incub|pcr/i.test(a.name + ' ' + a.assetId))
    .slice(0, 6)
    .map((a) => a.id);

  // Fallback guarantees every line has rooms & assets even in custom/smaller projects
  const fallbackRoomIds = scene.rooms.slice(0, 3).map((r) => r.id);
  const fallbackAssetIds = scene.assets.slice(0, 4).map((a) => a.id);

  return [
    {
      id: 'line-mab-upstream',
      code: 'LINE-01',
      name: 'mAb Drug Substance Line 1 (Upstream & Purification)',
      productFamily: 'Monoclonal Antibody (CinnaMab-2000L)',
      description:
        'Integrated Grade C cell culture bioreactors, harvest filtration, and downstream chromatography train.',
      owner: 'Dr. N. Rahimi',
      color: '#10B981',
      roomIds: upstreamRooms.length > 0 ? upstreamRooms : fallbackRoomIds,
      assetIds: upstreamAssets.length > 0 ? upstreamAssets : fallbackAssetIds,
      status: 'active',
      targetBatchSize: '2,000 L Harvest / 14-day perfusion',
    },
    {
      id: 'line-aseptic-fill',
      code: 'LINE-02',
      name: 'Sterile Vial Fill-Finish & Lyophilization Line 2',
      productFamily: 'Lyophilized Biologics (Grade A/B)',
      description:
        'Aseptic Grade A isolator vial filling, freeze-drying lyophilizer, and terminal sterilization suite.',
      owner: 'S. Mohammadi',
      color: '#F59E0B',
      roomIds: fillRooms.length > 0 ? fillRooms : scene.rooms.slice(2, 5).map((r) => r.id),
      assetIds: fillAssets.length > 0 ? fillAssets : scene.assets.slice(3, 7).map((a) => a.id),
      status: 'maintenance-hold',
      targetBatchSize: '24,000 Vials / Lot',
    },
    {
      id: 'line-qc-release',
      code: 'LINE-03',
      name: 'QC Release Analytics & 21 CFR Part 11 IT Backbone',
      productFamily: 'Lot Release & Stability Testing',
      description:
        'Analytical HPLC / Bioassay suite integrated with redundant 42U SCADA & historian compute racks.',
      owner: 'Dr. L. Azizi',
      color: '#8B5CF6',
      roomIds: qcRooms.length > 0 ? qcRooms : scene.rooms.slice(0, 2).map((r) => r.id),
      assetIds: qcAssets.length > 0 ? qcAssets : scene.assets.slice(0, 3).map((a) => a.id),
      status: 'active',
      targetBatchSize: 'Continuous Lot Release',
    },
  ];
}

export const INITIAL_ELIGIBLE_PERSONNEL: EligibleTechnician[] = [
  {
    id: 'tech-tavakoli',
    name: 'Reza Tavakoli',
    role: 'Lead Metrology & Calibration Engineer',
    department: 'Metrology & Instrumentation',
    badgeId: 'EMP-1042',
    email: 'r.tavakoli@cinnagen.example',
    certifiedCategories: [
      'Biopharmaceutical',
      'Laboratory',
      'HVAC & Utilities',
      'Building & Safety',
      'Facility / Room',
    ],
    certifiedServices: ['calibration', 'qualification', 'inspection'],
    certExpiry: '2027-09-30',
    active: true,
  },
  {
    id: 'tech-jafari',
    name: 'Hossein Jafari',
    role: 'Senior Reliability & Bioprocess Maintenance Tech',
    department: 'Plant Maintenance',
    badgeId: 'EMP-1088',
    email: 'h.jafari@cinnagen.example',
    certifiedCategories: [
      'Biopharmaceutical',
      'HVAC & Utilities',
      'Warehouse & Logistics',
      'Building & Safety',
    ],
    certifiedServices: ['maintenance', 'corrective-repair', 'cleaning-cip-sip', 'inspection'],
    certExpiry: '2027-06-15',
    active: true,
  },
  {
    id: 'tech-azizi',
    name: 'Dr. Leila Azizi',
    role: 'Principal QA Validation Specialist (IQ/OQ/PQ)',
    department: 'Quality Assurance & Validation',
    badgeId: 'EMP-1019',
    email: 'l.azizi@cinnagen.example',
    certifiedCategories: [
      'Biopharmaceutical',
      'Laboratory',
      'HVAC & Utilities',
      'IT & Data Center',
      'Warehouse & Logistics',
      'Facility / Room',
    ],
    certifiedServices: ['qualification', 'inspection', 'calibration'],
    certExpiry: '2028-01-20',
    active: true,
  },
  {
    id: 'tech-moradi',
    name: 'Sara Moradi',
    role: 'Analytical Instrumentation Specialist (HPLC/GC)',
    department: 'QC Analytical Lab',
    badgeId: 'EMP-1124',
    email: 's.moradi@cinnagen.example',
    certifiedCategories: ['Laboratory', 'Furniture & Workplace'],
    certifiedServices: ['calibration', 'qualification', 'maintenance', 'corrective-repair'],
    certExpiry: '2027-11-10',
    active: true,
  },
  {
    id: 'tech-kiani',
    name: 'Amir Kiani',
    role: 'OT/IT Infrastructure & SCADA Network Engineer',
    department: 'Digital Manufacturing & IT',
    badgeId: 'EMP-1175',
    email: 'a.kiani@cinnagen.example',
    certifiedCategories: ['IT & Data Center', 'Building & Safety', 'HVAC & Utilities'],
    certifiedServices: ['maintenance', 'qualification', 'corrective-repair', 'inspection'],
    certExpiry: '2027-08-01',
    active: true,
  },
  {
    id: 'tech-hosseini',
    name: 'Maryam Hosseini',
    role: 'Cleanroom Sterilization & CIP/SIP Specialist',
    department: 'Aseptic Operations',
    badgeId: 'EMP-1201',
    email: 'm.hosseini@cinnagen.example',
    certifiedCategories: ['Biopharmaceutical', 'Laboratory', 'HVAC & Utilities', 'Facility / Room'],
    certifiedServices: ['cleaning-cip-sip', 'qualification', 'inspection'],
    certExpiry: '2027-12-31',
    active: true,
  },
];

export function buildSeedWorkOrders(scene: DigitalTwinScene, lines: ProductionLine[]): WorkOrder[] {
  const base = todayIso();
  const findAsset = (pattern: RegExp, fallbackIdx = 0) =>
    scene.assets.find((a) => pattern.test(a.assetId + ' ' + a.name)) ?? scene.assets[fallbackIdx];

  const bio = findAsset(/bio|2000/i, 0);
  const lyo = findAsset(/lyo|fill/i, 1);
  const hplc = findAsset(/hplc/i, 2);
  const rack = findAsset(/rack|dc-r01/i, 3);
  const chr = findAsset(/chr|chrom/i, 4);

  const list: WorkOrder[] = [];

  if (lyo) {
    list.push({
      id: 'wo-2026-101',
      woNumber: 'WO-2026-0101',
      title: `Overdue Shelf Temperature & Vacuum Sensor Calibration — ${lyo.assetId}`,
      description:
        'Multi-point NIST-traceable RTD shelf mapping and Pirani/capacitance manometer vacuum calibration required to clear Line 2 GMP release hold.',
      serviceType: 'calibration',
      targetKind: 'asset',
      targetId: lyo.id,
      targetName: `${lyo.name} (${lyo.assetId})`,
      targetCategory: lyo.category,
      productionLineId: lines[1]?.id,
      assigneeId: 'tech-tavakoli',
      assigneeName: 'Reza Tavakoli',
      priority: 'critical',
      status: 'overdue',
      lastServiceDate: addDaysToIso(base, -195),
      dueDate: addDaysToIso(base, -4),
      estimatedHours: 4.5,
      sopId: 'sop-lyo-cal',
      checklist: [
        { id: 'c1', text: 'Verify calibrated Fluke dry-well reference certificate validity', done: true },
        { id: 'c2', text: 'Perform 3-point RTD check (-40°C, 0°C, +40°C) across all shelves', done: false },
        { id: 'c3', text: 'Verify vacuum leak rate < 0.02 mbar·L/s', done: false },
        { id: 'c4', text: 'Upload signed 21 CFR Part 11 calibration certificate', done: false },
      ],
      createdAt: addDaysToIso(base, -18),
    });
  }

  if (hplc) {
    list.push({
      id: 'wo-2026-102',
      woNumber: 'WO-2026-0102',
      title: `Quarterly Preventive Maintenance & Pump Seal Replacement — ${hplc.assetId}`,
      description:
        'Replace binary gradient pump piston seals, inline degasser check valve, and verify UV-DAD wavelength accuracy with Holmium Oxide filter.',
      serviceType: 'maintenance',
      targetKind: 'asset',
      targetId: hplc.id,
      targetName: `${hplc.name} (${hplc.assetId})`,
      targetCategory: hplc.category,
      productionLineId: lines[2]?.id,
      assigneeId: 'tech-moradi',
      assigneeName: 'Sara Moradi',
      priority: 'high',
      status: 'in-progress',
      lastServiceDate: addDaysToIso(base, -82),
      dueDate: addDaysToIso(base, 5),
      estimatedHours: 3.0,
      sopId: 'sop-hplc-pm',
      cronJobId: 'cron-hplc-pm',
      checklist: [
        { id: 'c1', text: 'Flush mobile phase channels with HPLC-grade IPA/Water', done: true },
        { id: 'c2', text: 'Replace primary & secondary pump piston seals', done: true },
        { id: 'c3', text: 'Run USP <621> system suitability injection (RSD < 0.5%)', done: false },
      ],
      createdAt: addDaysToIso(base, -7),
    });
  }

  if (bio) {
    list.push({
      id: 'wo-2026-103',
      woNumber: 'WO-2026-0103',
      title: `SIP Cycle Verification & pH/DO Probe Calibration — ${bio.assetId}`,
      description:
        'Execute Steam-in-Place thermal distribution check (121.5°C × 30 min) and 2-point buffer calibration on redundant Mettler-Toledo pH/DO probes.',
      serviceType: 'cleaning-cip-sip',
      targetKind: 'asset',
      targetId: bio.id,
      targetName: `${bio.name} (${bio.assetId})`,
      targetCategory: bio.category,
      productionLineId: lines[0]?.id,
      assigneeId: 'tech-hosseini',
      assigneeName: 'Maryam Hosseini',
      priority: 'high',
      status: 'open',
      lastServiceDate: addDaysToIso(base, -21),
      dueDate: addDaysToIso(base, 9),
      estimatedHours: 5.0,
      sopId: 'sop-bio-cipsip',
      cronJobId: 'cron-bio-cal',
      checklist: [
        { id: 'c1', text: 'Confirm clean steam supply pressure at 2.2 bar(g)', done: false },
        { id: 'c2', text: 'Verify cold-spot F0 >= 15 min across bottom harvest valve', done: false },
        { id: 'c3', text: 'Calibrate pH (4.01/7.00) and DO (0%/100% air sat)', done: false },
      ],
      createdAt: addDaysToIso(base, -3),
    });
  }

  if (rack) {
    list.push({
      id: 'wo-2026-104',
      woNumber: 'WO-2026-0104',
      title: `Redundant Dual-PDU Failover & 42U Rack Patch Audit — ${rack.assetId}`,
      description:
        'Verify A/B UPS transfer switch failover, inspect OM4 fiber patch ports, and validate OPC UA historian backup integrity.',
      serviceType: 'inspection',
      targetKind: 'asset',
      targetId: rack.id,
      targetName: `${rack.name} (${rack.assetId})`,
      targetCategory: rack.category,
      productionLineId: lines[2]?.id,
      assigneeId: 'tech-kiani',
      assigneeName: 'Amir Kiani',
      priority: 'medium',
      status: 'open',
      lastServiceDate: addDaysToIso(base, -60),
      dueDate: addDaysToIso(base, 14),
      estimatedHours: 2.0,
      sopId: 'sop-it-rack',
      cronJobId: 'cron-it-audit',
      checklist: [
        { id: 'c1', text: 'Inspect PDU-A and PDU-B load balancing (< 65% per bus)', done: false },
        { id: 'c2', text: 'Verify zero CRC errors across SCADA uplink SFP+ ports', done: false },
      ],
      createdAt: addDaysToIso(base, -2),
    });
  }

  if (chr) {
    list.push({
      id: 'wo-2026-105',
      woNumber: 'WO-2026-0105',
      title: `Annual Re-Qualification (Re-PQ) Flow & UV Detector Check — ${chr.assetId}`,
      description:
        'Perform annual flow accuracy, gradient linearity, and conductivity transmitter qualification per EU GMP Annex 15.',
      serviceType: 'qualification',
      targetKind: 'asset',
      targetId: chr.id,
      targetName: `${chr.name} (${chr.assetId})`,
      targetCategory: chr.category,
      productionLineId: lines[0]?.id,
      assigneeId: 'tech-azizi',
      assigneeName: 'Dr. Leila Azizi',
      priority: 'medium',
      status: 'waiting-qa',
      lastServiceDate: addDaysToIso(base, -340),
      dueDate: addDaysToIso(base, 22),
      estimatedHours: 6.0,
      sopId: 'sop-chrom-oq',
      checklist: [
        { id: 'c1', text: 'Execute gradient step linearity (0–100% Buffer B)', done: true },
        { id: 'c2', text: 'QA signature on Re-PQ summary report', done: false },
      ],
      createdAt: addDaysToIso(base, -10),
    });
  }

  return list;
}

export function buildSeedCronJobs(scene: DigitalTwinScene, lines: ProductionLine[]): CronScheduleJob[] {
  const base = todayIso();
  const bio = scene.assets.find((a) => /bio/i.test(a.assetId + a.name)) ?? scene.assets[0];
  const hplc = scene.assets.find((a) => /hplc/i.test(a.assetId + a.name)) ?? scene.assets[1] ?? bio;
  const rack = scene.assets.find((a) => /rack|dc-r01/i.test(a.assetId + a.name)) ?? scene.assets[2] ?? bio;

  return [
    {
      id: 'cron-bio-cal',
      name: 'Quarterly Bioreactor Sensor Calibration & SIP Check',
      cronExpression: '0 6 1 */3 *',
      humanSchedule: 'Every 3 months on the 1st at 06:00',
      enabled: true,
      serviceType: 'calibration',
      targetKind: 'asset',
      targetId: bio?.id ?? 'asset-1',
      targetName: bio ? `${bio.name} (${bio.assetId})` : 'Bioreactor Train',
      targetCategory: bio?.category ?? 'Biopharmaceutical',
      intervalDays: 90,
      defaultAssigneeId: 'tech-tavakoli',
      priority: 'high',
      sopId: 'sop-bio-cipsip',
      lastRunAt: addDaysToIso(base, -85),
      nextRunAt: addDaysToIso(base, 5),
      generatedCount: 4,
    },
    {
      id: 'cron-hplc-pm',
      name: 'Monthly HPLC System Suitability & Seal PM',
      cronExpression: '0 7 1 * *',
      humanSchedule: 'Monthly on the 1st at 07:00',
      enabled: true,
      serviceType: 'maintenance',
      targetKind: 'asset',
      targetId: hplc?.id ?? 'asset-2',
      targetName: hplc ? `${hplc.name} (${hplc.assetId})` : 'QC HPLC System',
      targetCategory: hplc?.category ?? 'Laboratory',
      intervalDays: 30,
      defaultAssigneeId: 'tech-moradi',
      priority: 'medium',
      sopId: 'sop-hplc-pm',
      lastRunAt: addDaysToIso(base, -26),
      nextRunAt: addDaysToIso(base, 4),
      generatedCount: 11,
    },
    {
      id: 'cron-line1-pq',
      name: 'Semi-Annual Line 1 Cleanroom & Equipment Re-PQ',
      cronExpression: '0 8 1 1,7 *',
      humanSchedule: 'Jan 1 & Jul 1 at 08:00',
      enabled: true,
      serviceType: 'qualification',
      targetKind: 'line',
      targetId: lines[0]?.id ?? 'line-mab-upstream',
      targetName: lines[0]?.name ?? 'Production Line 1',
      targetCategory: 'Biopharmaceutical',
      intervalDays: 180,
      defaultAssigneeId: 'tech-azizi',
      priority: 'high',
      sopId: 'sop-cleanroom-pq',
      lastRunAt: addDaysToIso(base, -150),
      nextRunAt: addDaysToIso(base, 30),
      generatedCount: 2,
    },
    {
      id: 'cron-it-audit',
      name: 'Bi-Monthly 42U IT/SCADA Rack Power & Patch Integrity Audit',
      cronExpression: '0 5 15 */2 *',
      humanSchedule: 'Every 2 months on the 15th at 05:00',
      enabled: true,
      serviceType: 'inspection',
      targetKind: 'asset',
      targetId: rack?.id ?? 'asset-3',
      targetName: rack ? `${rack.name} (${rack.assetId})` : '42U Compute Rack',
      targetCategory: 'IT & Data Center',
      intervalDays: 60,
      defaultAssigneeId: 'tech-kiani',
      priority: 'medium',
      sopId: 'sop-it-rack',
      lastRunAt: addDaysToIso(base, -46),
      nextRunAt: addDaysToIso(base, 14),
      generatedCount: 6,
    },
  ];
}

export const INITIAL_SOP_DOCUMENTS: SopDocument[] = [
  {
    id: 'sop-bio-cipsip',
    docNumber: 'SOP-BIO-001',
    title: 'Stainless & Single-Use Bioreactor CIP / SIP & Probe Calibration',
    docType: 'SOP',
    equipmentCategory: 'Biopharmaceutical',
    archetypes: ['bioreactor-ss', 'bioreactor-su', 'vessel-tank'],
    actionType: 'Cleaning / CIP-SIP',
    version: '4.2',
    effectiveDate: '2026-01-15',
    reviewDueDate: '2028-01-15',
    author: 'Dr. N. Rahimi',
    status: 'effective',
    markdown: `# SOP-BIO-001 · Bioreactor CIP/SIP & Probe Calibration

## 1. Purpose & GMP Scope
Standardizes **Clean-in-Place (CIP)**, **Steam-in-Place (SIP)**, and **pH / Dissolved Oxygen (DO) calibration** for all stainless-steel (316L) and single-use bioreactors operating in Grade C/D suites.

## 2. Critical Process Parameters (CPP)
| Parameter | Target Setpoint | Acceptance Limit | Sensor Tag |
| --- | --- | --- | --- |
| CIP Caustic Wash | 0.5 M NaOH @ 65 °C | 62–70 °C × 30 min | \`TT-BIO-01\` |
| WFI Final Rinse | Conductivity < 1.3 µS/cm | TOC < 500 ppb | \`CT-CIP-02\` |
| SIP Sterilization | 121.5 °C @ 1.15 bar(g) | F0 ≥ 15.0 min | \`TT-SIP-CS\` |
| pH 2-Point Cal | pH 4.01 & pH 7.00 | Slope 95–103% | \`AT-PH-01\` |
| DO Probe Slope | 0% N2 / 100% Air | Drift < ±1.5% / 24h | \`AT-DO-01\` |

## 3. SIP Sterilization Thermal Profile
\`\`\`chart:line
{
  "title": "Bioreactor SIP Thermal Hold Curve",
  "subtitle": "Vessel Core vs Jacket Setpoint (45-min Validation Cycle)",
  "unit": "°C",
  "xKey": "minute",
  "target": 121.5,
  "targetLabel": "SIP Min 121.5 °C",
  "series": [
    { "key": "coreTemp", "label": "Core Temp", "color": "#8B5CF6" },
    { "key": "jacketTemp", "label": "Jacket Temp", "color": "#06B6D4" }
  ],
  "data": [
    { "minute": "0m", "coreTemp": 65.0, "jacketTemp": 71.5 },
    { "minute": "10m", "coreTemp": 103.4, "jacketTemp": 112.0 },
    { "minute": "20m", "coreTemp": 121.8, "jacketTemp": 124.2 },
    { "minute": "30m", "coreTemp": 122.4, "jacketTemp": 124.5 },
    { "minute": "40m", "coreTemp": 122.1, "jacketTemp": 123.9 },
    { "minute": "45m", "coreTemp": 96.8, "jacketTemp": 90.2 }
  ]
}
\`\`\`

## 4. Pre-Operation Verification Checklist
- [x] Confirm valid calibration sticker & digital QR record on vessel skid.
- [x] Verify rupture disc integrity and sterile vent filter **WIT (Water Intrusion Test)** pass certificate.
- [ ] Inspect mechanical seal condensate trap and bottom diaphragm harvest valve torque.
- [ ] Record batch-ready sign-off in Electronic Batch Record (EBR) per **21 CFR Part 11**.

## 5. Safety & Gowning
> [!WARNING] Wear Class C sterile garments, face shield, and thermal gloves during live steam header isolation. Never open sample ports when vessel gauge pressure exceeds **0.05 bar(g)**.`,
  },
  {
    id: 'sop-chrom-oq',
    docNumber: 'SOP-DSP-014',
    title: 'Chromatography & TFF Skid OQ/PQ Qualification & Flow Verification',
    docType: 'Protocol',
    equipmentCategory: 'Biopharmaceutical',
    archetypes: ['chrom-skid', 'tff-skid'],
    actionType: 'Qualification',
    version: '3.1',
    effectiveDate: '2025-11-01',
    reviewDueDate: '2027-11-01',
    author: 'Dr. L. Azizi',
    status: 'effective',
    markdown: `# SOP-DSP-014 · Chromatography & TFF Skid Qualification

## 1. Objective
Defines annual **Operational & Performance Qualification (OQ/PQ)** criteria for Protein A / Ion-Exchange chromatography skids and Ultrafiltration / Diafiltration TFF skids.

## 2. Qualification Test Matrix
| Test Item | Acceptance Criteria | Instrument Reference |
| --- | --- | --- |
| Pump Flow Accuracy | ±2.0% of nominal (10–300 L/h) | Coriolis Mass Flow Master |
| Gradient Linearity (Buffer B) | R² ≥ 0.998 across 0–100% | Conductivity Cell |
| UV-280 nm Absorbance | ±0.015 AU at 1.0 AU filter | Certified NIST Neutral Filter |
| Pressure Transducer Zero/Span | ±0.05 bar across 0–4 bar | Deadweight Tester |

## 3. Deviation Handling
- Any test outside acceptance limits automatically places the skid into **QA Hold** and blocks associated Production Line eligibility until CAPA closure.`,
  },
  {
    id: 'sop-hplc-pm',
    docNumber: 'SOP-QC-022',
    title: 'HPLC / UHPLC Preventive Maintenance & USP <621> Suitability Record',
    docType: 'Record',
    equipmentCategory: 'Laboratory',
    archetypes: ['hplc-instrument', 'lab-bench', 'biosafety-cabinet'],
    actionType: 'Maintenance',
    version: '5.0',
    effectiveDate: '2026-02-01',
    reviewDueDate: '2028-02-01',
    author: 'Sara Moradi',
    status: 'effective',
    markdown: `# SOP-QC-022 · HPLC Preventive Maintenance & Suitability

## 1. Scope
Applies to all Agilent / Waters **HPLC & UHPLC** analytical trains in QC Chemistry and In-Process Control laboratories.

## 2. Quarterly PM Procedure
1. **System Flush**: Flush all four gradient lines with 50:50 IPA/HPLC Water at 1.0 mL/min for 20 minutes.
2. **Pump Hydraulics**: Replace sapphire piston seals and outlet check-valve cartridges; run leak test at **400 bar** (pressure drop < 2 bar/min).
3. **Autosampler**: Inspect needle seat and rotor seal; verify injection precision with 6 replicate caffeine standards (**%RSD ≤ 0.5%**).
4. **UV-DAD Optics**: Verify Holmium Oxide wavelength accuracy at **241.1 nm, 360.9 nm, and 536.2 nm** (±1.0 nm).

## 3. Required Audit Attachments
- Chromatogram audit trail exported from Empower / Chromeleon CDS.
- Signed technician badge verification and updated next-due QR label.`,
  },
  {
    id: 'sop-lyo-cal',
    docNumber: 'SOP-ASEP-009',
    title: 'Lyophilizer & Sterile Vial Filler Calibration & Integrity Protocol',
    docType: 'SOP',
    equipmentCategory: 'Biopharmaceutical',
    archetypes: ['lyophilizer', 'filling-line', 'tablet-press'],
    actionType: 'Calibration',
    version: '3.4',
    effectiveDate: '2025-12-10',
    reviewDueDate: '2027-12-10',
    author: 'Reza Tavakoli',
    status: 'effective',
    markdown: `# SOP-ASEP-009 · Lyophilizer & Fill-Finish Calibration

## 1. Metrology Requirements
Ensures Grade A aseptic vial filling accuracy and freeze-dryer shelf thermal uniformity per **EU GMP Annex 1 (2022)**.

## 2. Calibration Acceptance Table
| Subsystem | Points Verified | Maximum Permissible Error |
| --- | --- | --- |
| Lyophilizer Shelf RTDs | -45 °C, 0 °C, +40 °C | ±0.3 °C |
| Condenser Temperature | -70 °C | ±1.0 °C |
| Chamber Vacuum (Capacitance) | 0.05, 0.20, 1.00 mbar | ±2% of reading |
| Peristaltic Fill Dosing | 1.0 mL – 10.0 mL | ±0.8% gravimetric weight |

## 3. Release Verification
- Confirm chamber vacuum leak rate **< 0.02 mbar·L/s** over 30 minutes prior to returning Line 2 to **Eligible** status.`,
  },
  {
    id: 'sop-cleanroom-pq',
    docNumber: 'SOP-FAC-004',
    title: 'Cleanroom HVAC Pressure Cascade, HEPA Integrity & Particle PQ',
    docType: 'SOP',
    equipmentCategory: 'HVAC & Utilities',
    archetypes: ['autoclave', 'ahu-unit', 'isolator'],
    actionType: 'Qualification',
    version: '6.0',
    effectiveDate: '2026-01-02',
    reviewDueDate: '2028-01-02',
    author: 'Dr. L. Azizi',
    status: 'effective',
    markdown: `# SOP-FAC-004 · Cleanroom HVAC & HEPA Qualification

## 1. ISO 14644-1 & EU Annex 1 Limits
| Cleanroom Grade | Max Particles ≥ 0.5 µm (At Rest) | Differential Pressure | Min ACH |
| --- | --- | --- | --- |
| Grade A / ISO 5 | 3,520 / m³ | +40 to +45 Pa (LAF 0.45 m/s) | Unidirectional |
| Grade B / ISO 6 | 3,520 / m³ | +30 Pa | ≥ 40 ACH |
| Grade C / ISO 7 | 352,000 / m³ | +15 to +20 Pa | ≥ 20 ACH |
| Grade D / ISO 8 | 3,520,000 / m³ | +5 to +10 Pa | ≥ 12 ACH |

## 2. Cleanroom Airflow Target vs Actual & 24h Trend
\`\`\`chart:target
{
  "title": "Cleanroom Air Changes per Hour (ACH) vs Annex 1 Target",
  "subtitle": "Measured Supply Airflow across Qualified Suites",
  "unit": "ACH",
  "xKey": "suite",
  "series": [{ "key": "actual", "label": "Measured ACH" }],
  "data": [
    { "suite": "A0-103 Grade B", "actual": 46, "target": 40 },
    { "suite": "A0-101 Grade C", "actual": 26, "target": 20 },
    { "suite": "B0-102 Grade C", "actual": 22, "target": 20 },
    { "suite": "A1-201 Grade D", "actual": 15, "target": 12 }
  ]
}
\`\`\`

\`\`\`chart:area
{
  "title": "24-Hour Differential Pressure Cascade Stability",
  "subtitle": "Continuous EMS Trend (Pa)",
  "unit": "Pa",
  "xKey": "hour",
  "target": 30,
  "targetLabel": "Grade B Min +30 Pa",
  "series": [
    { "key": "gradeA", "label": "Grade A Core", "color": "#06B6D4" },
    { "key": "gradeB", "label": "Grade B Fill", "color": "#10B981" },
    { "key": "gradeC", "label": "Grade C Upstream", "color": "#8B5CF6" }
  ],
  "data": [
    { "hour": "00:00", "gradeA": 44, "gradeB": 33, "gradeC": 18 },
    { "hour": "06:00", "gradeA": 45, "gradeB": 34, "gradeC": 19 },
    { "hour": "12:00", "gradeA": 43, "gradeB": 32, "gradeC": 17 },
    { "hour": "18:00", "gradeA": 45, "gradeB": 34, "gradeC": 19 },
    { "hour": "24:00", "gradeA": 44, "gradeB": 33, "gradeC": 18 }
  ]
}
\`\`\`

## 3. HEPA DOP / PAO Leak Test
- Aerosol challenge upstream concentration **20–80 µg/L**; downstream scan penetration must not exceed **0.01%** at any point.`,
  },
  {
    id: 'sop-it-rack',
    docNumber: 'SOP-IT-011',
    title: '42U GMP Data Center Rack, Redundant PDU & 21 CFR Part 11 Backup SOP',
    docType: 'SOP',
    equipmentCategory: 'IT & Data Center',
    archetypes: ['server-rack', 'network-rack', 'patch-cabinet', 'pdu-cabinet', 'ups-tower', 'scada-console'],
    actionType: 'Operation',
    version: '2.3',
    effectiveDate: '2026-02-18',
    reviewDueDate: '2028-02-18',
    author: 'Amir Kiani',
    status: 'effective',
    markdown: `# SOP-IT-011 · GMP IT/OT 42U Rack & SCADA Infrastructure

## 1. Purpose
Governs physical rack layout, VLAN segmentation (OT SCADA VLAN 110 vs Corporate), redundant PDU loading, and immutable audit trail backup for GMP manufacturing servers.

## 2. Operational Guardrails
- Maintain rack inlet cold-aisle temperature between **18.0 °C and 24.0 °C** (RH 40–55%).
- Never exceed **70% rated kW capacity** on any single PDU bus (A or B) to preserve N+1 failover headroom.
- Label every fiber/copper patch cord at both ends using **Micro-QR / DataMatrix** tags matching the 42U Rack Designer port matrix.
- Verify nightly encrypted PostgreSQL & Historian snapshot replication with SHA-256 checksum verification.

## 3. Rack Power Load & Network Capacity Mix
\`\`\`chart:bar
{
  "title": "42U Rack Redundant Bus A vs Bus B Load",
  "unit": "kW",
  "xKey": "rack",
  "target": 12,
  "targetLabel": "70% N+1 Limit",
  "series": [
    { "key": "busA", "label": "PDU Bus A", "color": "#06B6D4" },
    { "key": "busB", "label": "PDU Bus B", "color": "#8B5CF6" }
  ],
  "data": [
    { "rack": "DC-R01", "busA": 9.4, "busB": 9.1 },
    { "rack": "DC-R02", "busA": 8.2, "busB": 8.0 },
    { "rack": "NET-R01", "busA": 5.1, "busB": 4.9 },
    { "rack": "IDF-A0", "busA": 3.4, "busB": 3.3 }
  ]
}
\`\`\`

\`\`\`chart:pie
{
  "title": "Data Center Port Allocation by VLAN Segment",
  "unit": "%",
  "xKey": "vlan",
  "series": [{ "key": "pct", "label": "Port Share" }],
  "data": [
    { "vlan": "OT SCADA (VLAN 10)", "pct": 38, "color": "#06B6D4" },
    { "vlan": "GMP BMS/EMS (VLAN 20)", "pct": 29, "color": "#10B981" },
    { "vlan": "Storage & Backup (VLAN 40)", "pct": 21, "color": "#8B5CF6" },
    { "vlan": "DMZ & Mgmt (VLAN 99)", "pct": 12, "color": "#F59E0B" }
  ]
}
\`\`\``,
  },
  {
    id: 'sop-wh-cold',
    docNumber: 'SOP-LOG-007',
    title: 'Cold Chain (+2–8 °C) Thermal Mapping & Warehouse Rack Inspection',
    docType: 'Checklist',
    equipmentCategory: 'Warehouse & Logistics',
    archetypes: ['pallet-rack', 'lab-freezer', 'agv-robot', 'forklift'],
    actionType: 'Maintenance',
    version: '2.8',
    effectiveDate: '2025-10-20',
    reviewDueDate: '2027-10-20',
    author: 'Hossein Jafari',
    status: 'effective',
    markdown: `# SOP-LOG-007 · Cold Storage & Warehouse Rack Compliance

## 1. Thermal Mapping Verification
- Place minimum **15 calibrated data loggers** across top/middle/bottom rack tiers and door-opening zones for 72 continuous hours.
- Confirm excursion alarms trigger within **5 minutes** if chamber drifts outside **+2.0 °C to +8.0 °C**.

## 2. Pallet Rack & AGV Safety Inspection
- Inspect upright frames, beam locking pins, and floor anchor bolts for forklift impact damage.
- Verify AGV LiDAR safety curtains and emergency stop bumpers weekly.`,
  },
  {
    id: 'sop-all-dev',
    docNumber: 'SOP-QA-099',
    title: 'Equipment Out-of-Calibration (OOC) Deviation & CAPA Record',
    docType: 'Record',
    equipmentCategory: 'All Equipment',
    actionType: 'Deviation / CAPA',
    version: '7.1',
    effectiveDate: '2026-01-01',
    reviewDueDate: '2028-01-01',
    author: 'Quality Unit',
    status: 'effective',
    markdown: `# SOP-QA-099 · Out-of-Calibration (OOC) & Deviation Handling

## 1. Immediate Containment (Within 2 Hours)
1. Tag the equipment **DO NOT USE — OUT OF CALIBRATION** and mark status in Gradian Digital Twin Studio.
2. Run **Production Line Eligibility Check** to identify impacted manufacturing suites and quarantine in-process lots.
3. Open a Critical Corrective Work Order and assign a certified metrology or reliability engineer.

## 2. Impact Assessment & Root Cause
- Review historical telemetry trends since the last passing calibration date.
- Document 5-Why / Fishbone root cause and verify corrective action effectiveness prior to QA release.`,
  },
];

const ARCHETYPE_SOP_SPECS: Record<
  string,
  {
    prefix: string;
    actionType: SopDocument['actionType'];
    ppe: string;
    cpps: [string, string, string][];
    steps: string[];
    alarms: string[];
    pmInterval: string;
  }
> = {
  'bioreactor-ss': {
    prefix: 'USP',
    actionType: 'Operation',
    ppe: 'Grade C cleanroom suit, sterile nitrile gloves, safety visor, thermal sleeves during SIP',
    cpps: [
      ['Culture Temperature', '37.0 ± 0.2 °C', 'Jacket PID loop'],
      ['Dissolved Oxygen (DO)', '40.0 ± 3.0 %', 'O2 sparger cascade'],
      ['pH Setpoint', '7.05 ± 0.05', 'CO2 / 1M NaOH'],
      ['Agitation Speed', '95–140 RPM', 'Magnetic drive'],
    ],
    steps: [
      'Verify SIP sterilization cycle F0 ≥ 15.0 min and sterile vent filter WIT pass certificate.',
      'Perform 2-point pH buffer calibration (4.01 / 7.00) and 100% air-saturated DO probe span.',
      'Charge sterile basal media through pre-steamed transfer manifold under +0.2 bar(g) overlay.',
      'Inoculate seed train via aseptic Weld-Connect transfer and initiate SCADA batch recipe.',
      'Record hourly IPC samples (VCD, viability, glucose, lactate) in Electronic Batch Record.',
    ],
    alarms: [
      'High Pressure (> 0.6 bar(g)): Verify exhaust heater & vent filter condensate drain immediately.',
      'DO Drop (< 15%): Check mass flow controller O2 supply pressure and sparger backpressure.',
    ],
    pmInterval: 'Quarterly mechanical seal inspection & annual hydrostatic / rupture disc certification.',
  },
  'bioreactor-su': {
    prefix: 'USP',
    actionType: 'Operation',
    ppe: 'Grade C gowning, double sterile gloves, safety glasses',
    cpps: [
      ['Bag Pressure Integrity', '0.15 bar hold (< 0.005 bar/5m)', 'Pre-fill leak test'],
      ['Temperature Control', '37.0 ± 0.3 °C', 'Electric heating blanket'],
      ['DO / pH Optical Sensor', 'Pre-gamma calibrated patch', 'Optical reader'],
    ],
    steps: [
      'Inspect single-use bioprocess film bag lot CoA, gamma irradiation dot, and sterile connectors.',
      'Install bag smoothly into stainless jacket shell ensuring bottom impeller hub locks cleanly.',
      'Execute automated pre-use pressure decay integrity test prior to media fill.',
      'Connect sterile optical pH/DO fibers, load-cell zero tare, and exhaust filter heater sleeve.',
      'Start perfusion/fed-batch profile and confirm active SCADA alarm routing.',
    ],
    alarms: [
      'Leak Test Fail: Quarantine bag lot, do not charge media, open QA Deviation SOP-QA-099.',
      'Load Cell Drift: Verify tubing strain relief and re-zero only prior to inoculation.',
    ],
    pmInterval: 'Semi-annual load cell linearity calibration & annual heating jacket thermal mapping.',
  },
  'chrom-skid': {
    prefix: 'DSP',
    actionType: 'Operation',
    ppe: 'Grade C cleanroom apparel, chemical splash goggles, nitrile gloves',
    cpps: [
      ['Linear Flow Velocity', '150–300 cm/h (±2%)', 'Coriolis mass flowmeter'],
      ['Pre-Column Pressure', '≤ 2.8 bar(g)', 'PT-01 high-pressure interlock'],
      ['UV-280 nm Peak Cut', '0.15–2.50 AU', 'Dual-wavelength UV cell'],
      ['Elution Buffer pH', '3.50 ± 0.05', 'Inline pH/conductivity'],
    ],
    steps: [
      'Verify column packing HETP/Asymmetry qualification certificate and resin sanitization status.',
      'Prime A/B buffer pumps, purge air trap, and zero UV-280 nm & conductivity baselines.',
      'Equilibrate column with 5 CV Equilibration Buffer until outlet pH and conductivity stabilize.',
      'Load clarified harvest at validated residence time while monitoring ΔP across column.',
      'Execute wash, low-pH elution peak collection, CIP (0.1M NaOH), and 20% ethanol storage.',
    ],
    alarms: [
      'High ΔP Alarm (> 2.5 bar): Ramp down pump automatically; inspect inline 0.2µm guard filter.',
      'Air Sensor Triggered: Pause load step, vent bubble trap, verify feed vessel level.',
    ],
    pmInterval: 'Quarterly pump head seal check, semi-annual UV filter check, annual OQ/PQ.',
  },
  'tff-skid': {
    prefix: 'DSP',
    actionType: 'Operation',
    ppe: 'Grade C cleanroom apparel, splash goggles, chemical-resistant gloves',
    cpps: [
      ['Transmembrane Pressure (TMP)', '0.8–1.4 bar', 'Retentate control valve'],
      ['Crossflow Flux', '4–6 L/min·m²', 'Recirculation lobe pump'],
      ['Normalized Water Perm (NWP)', '≥ 80% of initial', 'Post-CIP membrane check'],
    ],
    steps: [
      'Torque cassette holder evenly to manufacturer spec and flush storage preservative with WFI.',
      'Measure pre-use Normalized Water Permeability (NWP) and confirm membrane integrity test.',
      'Equilibrate cassettes with formulation buffer and transfer bulk intermediate to retentate tank.',
      'Execute concentration (UF) and 7-diavolume constant-volume diafiltration (DF).',
      'Recover product pool with minimal hold-up flush and perform validated caustic CIP.',
    ],
    alarms: [
      'Feed Pressure > 3.5 bar: Check retentate proportional valve position and membrane fouling.',
    ],
    pmInterval: 'Semi-annual pressure transmitter calibration and peristaltic/lobe pump rebuild.',
  },
  'lyophilizer': {
    prefix: 'ASEP',
    actionType: 'Operation',
    ppe: 'Grade B/C aseptic garmenting, cryogenic thermal gloves for unloading',
    cpps: [
      ['Shelf Freezing Ramp', '-45.0 ± 1.5 °C', 'Silicone oil heat exchanger'],
      ['Condenser Temperature', '≤ -65.0 °C', 'Cascade refrigeration'],
      ['Chamber Vacuum', '80–120 µbar', 'Capacitance manometer'],
      ['Chamber Leak Rate', '≤ 0.02 mbar·L/s', 'Pre-batch integrity test'],
    ],
    steps: [
      'Confirm completed SIP cycle, chamber leak-rate pass, and sterile vent filter integrity.',
      'Load partially stoppered vials via Grade A LAF transfer cart onto pre-cooled shelves (+5 °C).',
      'Initiate validated freeze-drying recipe (Freezing → Primary Drying → Secondary Drying).',
      'Confirm Pirani-to-Capacitance Manometer convergence indicating primary drying endpoint.',
      'Backfill with sterile dry N2 to 750 mbar, hydraulically stopper vials, and unload to crimper.',
    ],
    alarms: [
      'Vacuum Excursion (> 200 µbar): Switch to backup vacuum pump; alert QA for batch impact.',
      'Condenser Temp Rise (> -55 °C): Inspect refrigeration compressor oil & suction pressure.',
    ],
    pmInterval: 'Monthly vacuum pump oil change, semi-annual shelf temperature mapping & vacuum cal.',
  },
  'filling-line': {
    prefix: 'ASEP',
    actionType: 'Operation',
    ppe: 'Grade A/B sterile barrier gowning, sterile double gloves, isolator gauntlets',
    cpps: [
      ['LAF Air Velocity', '0.45 m/s ± 20%', 'Unidirectional Grade A'],
      ['Fill Weight Accuracy', 'Target ± 1.5%', '100% IPC checkweigher'],
      ['Isolator ΔP vs Grade C', '+35 to +45 Pa', 'Continuous EMS'],
      ['VHP Decontamination', '6-log Geobacillus kill', 'Pre-campaign BI cycle'],
    ],
    steps: [
      'Complete VHP bio-decontamination cycle and confirm H2O2 aeration < 1.0 ppm.',
      'Perform isolator glove leak tests and install pre-sterilized peristaltic fill path & needles.',
      'Execute 10-vial start-up fill weight verification and stopper placement check.',
      'Run aseptic filling campaign with continuous ≥ 0.5µm / 5.0µm viable & non-viable monitoring.',
      'Perform post-use sterilizing filter bubble-point integrity test prior to batch disposition.',
    ],
    alarms: [
      'Isolator Door / Glove Interlock Open: Line stops immediately; initiate sterile intervention SOP.',
      'Particle Count Alert (≥ 0.5µm): Pause fill, investigate air disturbance, notify QA.',
    ],
    pmInterval: 'Monthly servo/peristaltic dosing calibration, semi-annual smoke study & HEPA DOP scan.',
  },
  'ahu-unit': {
    prefix: 'FAC',
    actionType: 'Maintenance',
    ppe: 'Safety glasses, cut-resistant gloves, dust respirator during pre-filter swap',
    cpps: [
      ['Supply Airflow', 'Design ACH ± 10%', 'VFD supply fan'],
      ['Supply Temp / RH', '19.5 °C / 45% RH', 'Chilled water & steam coil'],
      ['HEPA Final ΔP', '120–350 Pa', 'Differential pressure switch'],
    ],
    steps: [
      'Verify BMS telemetry for supply/return VFD frequencies, coil valves, and damper feedback.',
      'Inspect G4 pre-filter, F9 bag filter, and H14 terminal HEPA differential pressure gauges.',
      'Verify condensate drain pan cleanliness, belt tension, and fan bearing vibration levels.',
      'Confirm room pressure cascade remains strictly positive from Grade A → B → C → D → CNC.',
    ],
    alarms: [
      'High HEPA ΔP (> 380 Pa): Schedule H14 filter replacement and post-install PAO leak scan.',
      'Supply Fan Fault: Verify redundant standby fan auto-cutover and maintain cleanroom pressure.',
    ],
    pmInterval: 'Quarterly pre-filter change, semi-annual coil sanitization & annual HEPA integrity scan.',
  },
  'server-rack': {
    prefix: 'IT',
    actionType: 'Operation',
    ppe: 'ESD wrist strap, insulated footwear, ear protection in hot aisles',
    cpps: [
      ['Cold Aisle Inlet Temp', '18.0–24.0 °C', 'ASHRAE TC 9.9 Class A1'],
      ['Relative Humidity', '40–55% RH', 'Non-condensing'],
      ['Dual PDU Bus Load', '≤ 70% per A/B bus', 'N+1 failover margin'],
    ],
    steps: [
      'Authenticate badge & biometric access; verify rack change ticket in CMDB / ITIL log.',
      'Confirm dual PDU feeds (Bus A & Bus B) and UPS battery health before hardware service.',
      'Trace physical fiber/copper patch cords against 42U Rack Designer port matrix and Micro-QR tags.',
      'Verify VLAN isolation (OT SCADA VLAN-10 vs Corporate VLAN-30) and redundant trunk link up.',
      'Update asset inventory and close rack doors to preserve cold/hot aisle containment.',
    ],
    alarms: [
      'Rack Inlet > 27 °C: Check CRAC/In-Row chiller setpoint and blanking panel integrity.',
      'Link Down / Redundancy Loss: Inspect SFP+ optical power levels and failover path.',
    ],
    pmInterval: 'Monthly UPS self-test, quarterly thermal camera scan & semi-annual fiber cleaning.',
  },
};

export function buildComprehensiveSopsForScene(scene: DigitalTwinScene): SopDocument[] {
  const docs: SopDocument[] = [...INITIAL_SOP_DOCUMENTS];
  const existingIds = new Set(docs.map((d) => d.id));
  const roomById = new Map(scene.rooms.map((r) => [r.id, r]));

  scene.assets.forEach((asset, idx) => {
    const sopId = `sop-asset-${asset.id}`;
    if (existingIds.has(sopId)) return;
    existingIds.add(sopId);

    const spec =
      ARCHETYPE_SOP_SPECS[asset.archetype] ??
      (asset.category === 'IT & Data Center'
        ? ARCHETYPE_SOP_SPECS['server-rack']
        : asset.category === 'HVAC & Utilities'
          ? ARCHETYPE_SOP_SPECS['ahu-unit']
          : {
              prefix: 'OPS',
              actionType: 'Operation' as const,
              ppe: 'Cleanroom/lab gowning, safety glasses, nitrile gloves',
              cpps: [
                ['Operating Power Load', `${asset.energyKw} kW nominal (±10%)`, 'Facility power meter'],
                ['Utilization Target', `${asset.utilizationPct}% nominal`, 'MES / BMS monitor'],
                ['Condition Threshold', '≥ 80% reliability index', 'Predictive telemetry'],
              ] as [string, string, string][],
              steps: [
                `Verify calibration sticker, QR tag (${asset.assetId}), and active qualification status before start.`,
                `Inspect utility connections, electrical interlocks, and surrounding clearance (${asset.width}m × ${asset.depth}m footprint).`,
                `Confirm environmental conditions inside assigned room meet GMP/operational specification.`,
                `Start ${asset.name} following validated recipe/checklist and monitor live telemetry sensors.`,
                `Log run completion, sanitization status, and any anomalies in the Digital Twin audit trail.`,
              ],
              alarms: [
                `Telemetry Excursion: Place ${asset.assetId} into safe hold and notify supervisor / QA immediately.`,
                `Emergency Stop Active: Isolate utility supply before troubleshooting; log CAPA if batch impacted.`,
              ],
              pmInterval: 'Quarterly preventive inspection & annual calibration/qualification verification.',
            });

    const room = asset.roomId ? roomById.get(asset.roomId) : undefined;
    const roomLabel = room ? `${room.code} — ${room.name} (${room.environmental.cleanroomGrade})` : 'Facility Floor';
    const docNum = `SOP-${spec.prefix}-${String(101 + idx).padStart(3, '0')}`;
    const cppRows = spec.cpps
      .map(([p, lim, ctrl]) => `| ${p} | ${lim} | ${ctrl} |`)
      .join('\n');
    const stepsMd = spec.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const alarmsMd = spec.alarms.map((a) => `- **${a.split(':')[0]}**: ${a.split(':').slice(1).join(':').trim()}`).join('\n');

    docs.push({
      id: sopId,
      docNumber: docNum,
      title: `${asset.assetId} · ${asset.name} Standard Operating & Safety SOP`,
      docType: 'SOP',
      equipmentCategory: asset.category,
      archetypes: [asset.archetype],
      actionType: spec.actionType,
      version: '2.0',
      effectiveDate: '2026-01-10',
      reviewDueDate: '2028-01-10',
      author: asset.owner || 'GMP Engineering & QA',
      status: 'effective',
      markdown: `# ${docNum} · ${asset.name} (\`${asset.assetId}\`)

## 1. Purpose, Location & Scope
Governs safe startup, GMP operation, alarm response, and preventive maintenance for **${asset.name}** (Tag \`${asset.assetId}\`, Model: ${asset.manufacturer} ${asset.model}) located in **${roomLabel}**.

- **Equipment Category**: ${asset.category} · Criticality: **${asset.criticality.toUpperCase()}**
- **Rated Power**: ${asset.energyKw} kW · Dimensions: ${asset.width}m × ${asset.depth}m × ${asset.height}m
- **Required PPE & Gowning**: ${spec.ppe}

## 2. Critical Process Parameters & Limits
| Parameter | Operating Target / Limit | Control / Verification |
| --- | --- | --- |
${cppRows}

## 3. Step-by-Step Operating Procedure
${stepsMd}

## 4. Alarm, Deviation & Emergency Response
${alarmsMd}

## 5. Preventive Maintenance & References
- **PM & Calibration Cadence**: ${spec.pmInterval}
- **Cross-References**: \`SOP-QA-099\` (Out-of-Calibration Deviation), 21 CFR Part 11 Electronic Records, EU GMP Annex 1.`,
    });
  });

  return docs;
}

export const INITIAL_WIKI_ARTICLES: WikiArticle[] = [
  {
    id: 'wiki-bio-do-drift',
    slug: 'bioreactor-do-probe-drift',
    title: 'Bioreactor Dissolved Oxygen (DO) Probe Drift During Long Perfusion Runs',
    category: 'Troubleshooting',
    equipmentCategories: ['Biopharmaceutical'],
    tags: ['bioreactor', 'DO', 'calibration', 'SIP', 'sensor-drift'],
    author: 'Reza Tavakoli',
    updatedAt: '2026-02-14',
    severity: 'critical',
    markdown: `# Bioreactor DO Probe Drift Troubleshooting

## Symptom
Optical or polarographic DO sensor drifts **> 3% air saturation** within 72 hours after SIP sterilization, triggering false low-DO sparge cascades.

## Probable Root Causes
1. **Optical Cap Photobleaching / Membrane Fouling**: Excessive SIP cycles (> 40 cycles) degrade the luminophore spot.
2. **Air-Bubble Entrapment**: Micro-bubbles clinging to horizontal probe tips at high agitation (> 180 RPM).
3. **Electrolyte Depletion (Polarographic)**: Low internal KCl fill or torn PTFE membrane.

## Corrective Action Steps
- Compare primary \`AT-DO-01\` against redundant \`AT-DO-02\` in the **Live Telemetry Trends** console.
- If optical spot cycle counter exceeds **35 SIPs**, replace the optical sensor cap during next turnaround.
- Verify probe insertion angle is **15° upward** from horizontal to shed gas bubbles cleanly.
- Re-zero with certified 99.999% N₂ and perform 100% air-saturation span calibration per \`SOP-BIO-001\`.`,
  },
  {
    id: 'wiki-hplc-pressure',
    slug: 'hplc-high-backpressure-ripple',
    title: 'HPLC High Backpressure Ripples & Retention Time Shift Diagnostics',
    category: 'Troubleshooting',
    equipmentCategories: ['Laboratory'],
    tags: ['HPLC', 'backpressure', 'pump-seal', 'column', 'QC'],
    author: 'Sara Moradi',
    updatedAt: '2026-02-10',
    severity: 'common',
    markdown: `# HPLC Pressure Ripple & Retention Shift Guide

## Quick Diagnostic Matrix
| Observation | Likely Fault | Immediate Fix |
| --- | --- | --- |
| Sawtooth pressure ripple > 5 bar | Air bubble or worn outlet check valve | Purge pump at 5 mL/min with degassed MeOH; sonicate check valve |
| Steady pressure climb > +40 bar | Plugged guard column or inlet frit | Isolate column; backflush or replace 0.5 µm inline frit |
| Gradual retention time drift | Worn piston seal / buffer evaporation | Replace piston seals per \`SOP-QC-022\` and prepare fresh mobile phase |

## Verification
Run 6 replicate USP suitability standards and verify pressure ripple **< 1.5 bar** and peak tailing factor **0.9–1.3**.`,
  },
  {
    id: 'wiki-hvac-cascade',
    slug: 'cleanroom-pressure-cascade-drop',
    title: 'Resolving Grade B / Grade C Cleanroom Differential Pressure Drop',
    category: 'Cleanroom HVAC',
    equipmentCategories: ['HVAC & Utilities', 'Building & Safety'],
    tags: ['HVAC', 'cleanroom', 'pressure-cascade', 'HEPA', 'Annex-1'],
    author: 'Hossein Jafari',
    updatedAt: '2026-01-29',
    severity: 'critical',
    markdown: `# Cleanroom Differential Pressure Cascade Loss

## Symptom
Differential pressure between **Grade B Filling Suite** and **Personnel Airlock** drops below **+10 Pa**, triggering BMS/SCADA alarm and 3D Pressure Heatmap warning.

## Root Cause Isolation
1. **Door Interlock / Gasket Leak**: Check magnetic interlock status and inflatable door seals on PAL/MAL airlocks.
2. **Supply AHU VFD / Damper Drift**: Inspect supply airflow damper actuator feedback and pre-filter ΔP (replace G4/F9 filters if ΔP > 250 Pa).
3. **Exhaust Fan Over-Draw**: Confirm biosafety cabinet or autoclave canopy exhaust dampers did not lock wide open.

## Recovery & QA Verification
- Restore cascade to **≥ +15 Pa** differential between adjacent grades.
- Allow **20-minute recovery period** and verify particle counts before resuming aseptic operations.`,
  },
  {
    id: 'wiki-lyo-vacuum',
    slug: 'lyophilizer-vacuum-leak-rate',
    title: 'Lyophilizer Chamber Vacuum Leak Rate Exceeds 0.02 mbar·L/s',
    category: 'Troubleshooting',
    equipmentCategories: ['Biopharmaceutical'],
    tags: ['lyophilizer', 'vacuum', 'silicone-gasket', 'Pirani'],
    author: 'Reza Tavakoli',
    updatedAt: '2026-02-20',
    severity: 'critical',
    markdown: `# Lyophilizer Vacuum Leak Rate Troubleshooting

## Symptom
Pre-batch leak rate test fails above **0.02 mbar·L/s** or Pirani vs Capacitance Manometer delta remains > 0.05 mbar after primary drying.

## Step-by-Step Fault Tree
1. **Main Chamber Door Silicone Gasket**: Inspect for hairline tears, glass shard debris, or dry-cracking; wipe with WFI & lint-free cleanroom swab.
2. **Condenser Isolation Valve (Mushroom Valve)**: Verify pneumatic actuator seating pressure (**6.0 bar**).
3. **Vent Filter Housing Tri-Clamp**: Check EPDM sanitary gasket compression and sterile filter drain valve closure.
4. **Vacuum Pump Oil Mist / Ballast**: Check Edwards dry-screw pump purge flow and gas ballast seal.

## Audit Record
Log leak test pass trend in the Equipment Lifecycle History before clearing Line 2 eligibility hold.`,
  },
  {
    id: 'wiki-it-scada-opcua',
    slug: 'scada-opcua-historian-failover',
    title: '42U IT/OT Rack OPC UA Telemetry Latency & Redundant PDU Failover',
    category: 'IT / SCADA',
    equipmentCategories: ['IT & Data Center'],
    tags: ['42U-rack', 'OPC-UA', 'SCADA', 'PDU', 'VLAN'],
    author: 'Amir Kiani',
    updatedAt: '2026-02-22',
    severity: 'reference',
    markdown: `# OT/IT Rack OPC UA Latency & Power Failover Wiki

## Network & Port Checklist
- Verify SCADA Core Switch uplink ports (**SFP+ 10GbE** in 42U Rack Designer) show **0 FCS/CRC errors** and link status **UP**.
- Ensure PLC VLAN (\`VLAN 110\`) maintains strict firewall ACL isolation from Corporate IT (\`VLAN 20\`).
- Confirm NTP time synchronization drift across all PLCs and Historian nodes is **< 50 ms** for 21 CFR Part 11 timestamp compliance.

## Redundant Power Bus Verification
- Keep both **PDU-A** and **PDU-B** below **65% load** so loss of either UPS feed carries 100% of rack servers with zero brownout.`,
  },
];
