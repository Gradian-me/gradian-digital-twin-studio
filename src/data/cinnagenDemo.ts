import type {
  DigitalTwinScene,
  EnterpriseNode,
  Floor,
  Opening,
  Room,
  SpatialAsset,
  SpatialMetadata,
  Wall,
} from '../types/twin.ts';
import { DEFAULT_LAYERS, WALL_PRESETS } from './materialsLibrary.ts';
import { OBJECT_LIBRARY } from './objectLibrary.ts';
import { SPACE_TYPE_LIBRARY } from './spaceTypes.ts';

function makeMeta(
  code: string,
  description: string,
  department: string,
  owner = 'Dr. Reza Kamali',
  status: SpatialMetadata['status'] = 'operational',
  tags: string[] = []
): SpatialMetadata {
  return {
    code,
    description,
    status,
    tags,
    owner,
    department,
    accessPermission: department.includes('GMP') || department.includes('Production') ? 'gmp-authorized' : 'restricted',
    createdAt: '2024-03-15',
    updatedAt: '2026-10-18',
    revision: 4,
    customProperties: {
      'GMP Annex': 'EU GMP Annex 1 (2022)',
      'Validation Protocol': `PQ-${code}`,
    },
    linkedDocuments: [
      { id: `doc-${code}-1`, title: `SOP-${code} Standard Operating Procedure`, type: 'SOP', ref: `DMS-${code}-01` },
      { id: `doc-${code}-2`, title: `DQ/IQ/OQ Qualification Package`, type: 'Validation', ref: `VAL-${code}-04` },
    ],
    relatedSystems: ['BMS / EMS', 'Clean Utilities'],
    relatedProcesses: ['mAb Biologics Production'],
  };
}

export function generateWallsForRoom(room: Room, existingPrefix: string): Wall[] {
  const preset =
    WALL_PRESETS.find((p) => p.id === (room.category === 'Cleanrooms' || room.category === 'Pharmaceutical Manufacturing' ? 'cleanroom-panel' : 'interior-standard')) ??
    WALL_PRESETS[0];

  const x1 = room.x;
  const z1 = room.z;
  const x2 = room.x + room.width;
  const z2 = room.z + room.depth;

  const segments: [string, number, number, number, number][] = [
    ['North', x1, z1, x2, z1],
    ['East', x2, z1, x2, z2],
    ['South', x2, z2, x1, z2],
    ['West', x1, z2, x1, z1],
  ];

  return segments.map(([dir, sx, sz, ex, ez], i) => ({
    id: `${existingPrefix}-w${i + 1}`,
    floorId: room.floorId,
    roomId: room.id,
    name: `${room.name} ${dir} Wall`,
    x1: sx,
    z1: sz,
    x2: ex,
    z2: ez,
    height: room.height,
    thickness: preset.thickness,
    elevation: 0,
    presetId: preset.id,
    isExterior: false,
    isStructural: preset.isStructural,
    fireRating: preset.fireRating,
    acousticRatingDb: preset.acousticRatingDb,
    materialId: room.wallMaterialId || preset.materialId,
    color: preset.color,
    opacity: preset.opacity,
    layerId: 'layer-walls',
    activeFromDate: room.activeFromDate,
  }));
}

function makeRoom(
  id: string,
  floorId: string,
  departmentId: string,
  name: string,
  code: string,
  spaceTypeId: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  overrides?: Partial<Room>
): Room {
  const tpl = SPACE_TYPE_LIBRARY.find((s) => s.id === spaceTypeId) ?? SPACE_TYPE_LIBRARY[0];
  return {
    id,
    floorId,
    departmentId,
    name,
    code,
    spaceTypeId: tpl.id,
    category: tpl.category,
    x,
    z,
    width,
    depth,
    height: overrides?.height ?? tpl.defaultHeight,
    color: overrides?.color ?? tpl.color,
    floorMaterialId: overrides?.floorMaterialId ?? tpl.defaultFloorMaterialId,
    wallMaterialId: overrides?.wallMaterialId ?? tpl.defaultWallMaterialId,
    ceilingMaterialId: tpl.defaultCeilingMaterialId,
    layerId: 'layer-architecture',
    environmental: { ...tpl.environmental, ...(overrides?.environmental ?? {}) },
    occupancyMax: Math.max(2, Math.round((width * depth) / 14)),
    currentOccupancy: Math.max(1, Math.round((width * depth) / 28)),
    utilizationPct: overrides?.utilizationPct ?? 74,
    riskLevel:
      overrides?.riskLevel ??
      (tpl.environmental.cleanroomGrade.includes('Grade A')
        ? 'critical'
        : tpl.environmental.cleanroomGrade.includes('Grade B') || tpl.environmental.cleanroomGrade.includes('Grade C')
          ? 'high'
          : 'low'),
    complianceStatus: overrides?.complianceStatus ?? 'compliant',
    energyKw: overrides?.energyKw ?? Number(((width * depth) * 0.28).toFixed(1)),
    costPerSqm: tpl.costPerSqm,
    activeFromDate: overrides?.activeFromDate ?? '2024-06-01',
    metadata: makeMeta(code, `${name} (${tpl.complianceStandard})`, departmentId, 'Dr. Sara Tehrani', 'operational', [
      tpl.category,
      tpl.environmental.cleanroomGrade,
    ]),
  };
}

function makeAsset(
  id: string,
  floorId: string,
  roomId: string,
  templateId: string,
  name: string,
  assetCode: string,
  x: number,
  z: number,
  rotationY = 0,
  overrides?: Partial<SpatialAsset>
): SpatialAsset {
  const tpl = OBJECT_LIBRARY.find((o) => o.id === templateId) ?? OBJECT_LIBRARY[0];
  const layerId =
    tpl.category === 'HVAC & Utilities'
      ? 'layer-utilities'
      : tpl.category === 'Warehouse & Logistics'
        ? 'layer-logistics'
        : tpl.category === 'Furniture & Workplace'
          ? 'layer-furniture'
          : tpl.category === 'Building & Safety'
            ? 'layer-safety'
            : 'layer-equipment';

  const status = overrides?.operationalStatus ?? 'running';
  return {
    id,
    floorId,
    roomId,
    templateId: tpl.id,
    archetype: tpl.archetype,
    name,
    assetId: assetCode,
    equipmentId: `EQ-${assetCode}`,
    category: tpl.category,
    manufacturer: tpl.manufacturer,
    model: tpl.model,
    serialNumber: `SN-2025-${assetCode.replace(/[^A-Z0-9]/g, '')}`,
    description: tpl.description,
    tags: [tpl.category, tpl.manufacturer],
    criticality:
      overrides?.criticality ??
      (tpl.category === 'Biopharmaceutical' ? 'gmp-critical' : tpl.category === 'Laboratory' ? 'high' : 'medium'),
    owner: 'CinnaGen Engineering',
    department: tpl.category === 'Laboratory' ? 'Quality Control' : tpl.category === 'Warehouse & Logistics' ? 'Supply Chain' : 'Biologics Manufacturing',
    responsiblePerson: 'Eng. Nima Farhadi',
    x,
    y: overrides?.y ?? 0,
    z,
    rotationX: 0,
    rotationY,
    rotationZ: 0,
    width: overrides?.width ?? tpl.width,
    depth: overrides?.depth ?? tpl.depth,
    height: overrides?.height ?? tpl.height,
    weightKg: tpl.weightKg,
    clearanceM: tpl.clearanceM,
    materialId: overrides?.materialId ?? tpl.defaultMaterialId,
    color: overrides?.color ?? tpl.defaultColor,
    layerId,
    operationalStatus: status,
    installationDate: overrides?.installationDate ?? '2024-10-12',
    commissioningDate: overrides?.commissioningDate ?? '2025-01-20',
    warrantyUntil: '2028-01-20',
    maintenanceSchedule: 'Quarterly GMP Calibration',
    lastMaintenance: '2026-08-14',
    nextMaintenance: status === 'maintenance-due' ? '2026-11-28' : '2027-02-14',
    capacityLabel: tpl.category === 'Biopharmaceutical' ? '2,000 L / Batch' : 'Nominal 100%',
    utilizationPct: overrides?.utilizationPct ?? (status === 'running' ? 84 : status === 'maintenance-due' ? 42 : 60),
    availabilityPct: status === 'maintenance-due' ? 91.5 : 98.7,
    conditionScore: status === 'maintenance-due' ? 72 : 95,
    lifecycle: overrides?.lifecycle ?? (status === 'maintenance-due' ? 'maintenance' : 'operational'),
    capexUsd: tpl.capexUsd,
    annualOpexUsd: tpl.annualOpexUsd,
    energyKw: tpl.energyKw,
    connectivity: {
      protocol: tpl.category === 'Building & Safety' ? 'MQTT' : tpl.category === 'HVAC & Utilities' ? 'BACnet' : 'OPC UA',
      endpoint: `opc.tcp://scada.cinnagen.local:4840/${assetCode}`,
      plcTag: `PLC_A1.${assetCode.replace(/-/g, '_')}`,
      scadaNode: `SCADA-GMP-${assetCode}`,
      historianId: `PI_HIST_${assetCode}`,
      liveMetrics:
        tpl.category === 'Biopharmaceutical'
          ? [
              { label: 'Process Temp', value: '37.0', unit: '°C', status: 'ok' },
              { label: 'Dissolved O2', value: '42.4', unit: '%', status: 'ok' },
              { label: 'Vessel Pressure', value: '0.45', unit: 'bar', status: 'ok' },
            ]
          : tpl.category === 'Laboratory'
            ? [
                { label: 'Column Temp', value: '25.0', unit: '°C', status: 'ok' },
                { label: 'Calibration Drift', value: '0.02', unit: '%', status: 'ok' },
              ]
            : [
                { label: 'Power Draw', value: String(tpl.energyKw), unit: 'kW', status: 'ok' },
                { label: 'Sensor Health', value: status === 'maintenance-due' ? 'Service Due' : 'Nominal', unit: '', status: status === 'maintenance-due' ? 'warn' : 'ok' },
              ],
    },
    documents: [
      { id: `d1-${id}`, title: `${tpl.manufacturer} ${tpl.model} Datasheet`, kind: 'Datasheet', code: `DS-${assetCode}` },
      { id: `d2-${id}`, title: `IQ/OQ/PQ Calibration Certificate`, kind: 'Calibration', code: `CAL-${assetCode}` },
      { id: `d3-${id}`, title: `Preventive Maintenance SOP`, kind: 'SOP', code: `SOP-PM-${assetCode}` },
    ],
    qrCode: `GRADIAN://ASSET/${assetCode}`,
    relatedSystems: ['SCADA', 'MES Batch Control', 'Clean Utilities'],
    relatedProcesses: ['Biologics Campaign #2026-B4'],
    ...overrides,
  };
}

export function createCinnaGenCampusScene(): DigitalTwinScene {
  const hierarchy: EnterpriseNode[] = [
    { id: 'ent-1', name: 'Gradian Life Sciences Group', level: 'enterprise', parentId: null, metadata: makeMeta('ENT-GLS', 'Global Biopharmaceutical Enterprise', 'Corporate') },
    { id: 'org-1', name: 'Biologics Manufacturing Division', level: 'organization', parentId: 'ent-1', metadata: makeMeta('ORG-BIO', 'Sterile & Recombinant Manufacturing Operations', 'Operations') },
    { id: 'comp-1', name: 'CinnaGen Biopharmaceuticals', level: 'company', parentId: 'org-1', metadata: makeMeta('CMP-CNG', 'EU-GMP Certified Biopharmaceutical Manufacturer', 'Executive') },
    { id: 'site-1', name: 'CinnaGen Biopharmaceutical Manufacturing Campus', level: 'site', parentId: 'comp-1', metadata: makeMeta('SITE-ALBZ', 'Primary 4.2-hectare GMP Biologics Campus', 'Site Operations') },
    { id: 'dept-mfg', name: 'GMP Biologics Production', level: 'department', parentId: 'bldg-a', metadata: makeMeta('DEPT-MFG', 'Upstream, Downstream & Aseptic Fill-Finish', 'Production') },
    { id: 'dept-qa', name: 'QA, Control & Utilities', level: 'department', parentId: 'bldg-a', metadata: makeMeta('DEPT-QA', 'Quality Assurance, BMS & Clean Utilities', 'Quality') },
    { id: 'dept-wh', name: 'Cold-Chain Supply & Warehouse', level: 'department', parentId: 'bldg-b', metadata: makeMeta('DEPT-WH', 'GDP Warehouse & Controlled Cold Storage', 'Logistics') },
    { id: 'dept-qc', name: 'Quality Control & R&D Labs', level: 'department', parentId: 'bldg-b', metadata: makeMeta('DEPT-QC', 'Analytical, Microbiology & Stability Labs', 'Quality Control') },
  ];

  const buildings = [
    {
      id: 'bldg-a',
      siteId: 'site-1',
      name: 'Building A — GMP Biologics & Fill-Finish',
      code: 'BLDG-A',
      description: 'Core monoclonal antibody manufacturing, aseptic vial filling, lyophilization, QA, and clean utility penthouse.',
      width: 36,
      depth: 22,
      originX: 0,
      originZ: 0,
      color: '#2563EB',
      metadata: makeMeta('BLDG-A', 'Primary EU-GMP Sterile Production Building', 'Production'),
    },
    {
      id: 'bldg-b',
      siteId: 'site-1',
      name: 'Building B — QC Laboratories & Cold-Chain Warehouse',
      code: 'BLDG-B',
      description: 'GDP raw material & 2–8°C cold storage warehouse with Level 1 Analytical & Microbiology QC Labs.',
      width: 32,
      depth: 20,
      originX: 42,
      originZ: 0,
      color: '#0D9488',
      metadata: makeMeta('BLDG-B', 'QC Laboratories and GDP Cold-Chain Logistics Hub', 'Quality & Supply Chain'),
    },
  ];

  const floors: Floor[] = [
    {
      id: 'fl-a0',
      buildingId: 'bldg-a',
      sectionName: 'GMP Production Core',
      name: 'Bldg A · Ground Floor (GMP Manufacturing)',
      code: 'A-L0',
      levelIndex: 0,
      elevation: 0,
      height: 4.0,
      slabThickness: 0.35,
      width: 36,
      depth: 22,
      slabMaterialId: 'mat-epoxy-gray',
      metadata: makeMeta('A-L0', 'Grade A/B/C/D Biologics Production & Aseptic Fill-Finish', 'Production'),
    },
    {
      id: 'fl-a1',
      buildingId: 'bldg-a',
      sectionName: 'Utilities & QA Offices',
      name: 'Bldg A · Level 1 (HVAC / WFI & QA)',
      code: 'A-L1',
      levelIndex: 1,
      elevation: 4.35,
      height: 3.8,
      slabThickness: 0.3,
      width: 36,
      depth: 22,
      slabMaterialId: 'mat-concrete-sealed',
      metadata: makeMeta('A-L1', 'Clean Utility Generation, AHU Plant, Central Control & QA Offices', 'Utilities & QA'),
    },
    {
      id: 'fl-b0',
      buildingId: 'bldg-b',
      sectionName: 'GDP Logistics Wing',
      name: 'Bldg B · Ground Floor (Cold-Chain Warehouse)',
      code: 'B-L0',
      levelIndex: 0,
      elevation: 0,
      height: 5.0,
      slabThickness: 0.4,
      width: 32,
      depth: 20,
      slabMaterialId: 'mat-concrete-sealed',
      metadata: makeMeta('B-L0', 'Raw Materials, 2–8°C Cold Storage, Quarantine & Loading Docks', 'Logistics'),
    },
    {
      id: 'fl-b1',
      buildingId: 'bldg-b',
      sectionName: 'Analytical & Micro Labs',
      name: 'Bldg B · Level 1 (QC & R&D Laboratories)',
      code: 'B-L1',
      levelIndex: 1,
      elevation: 5.4,
      height: 3.6,
      slabThickness: 0.3,
      width: 32,
      depth: 20,
      slabMaterialId: 'mat-ceramic-lab',
      metadata: makeMeta('B-L1', 'QC Analytical HPLC/LC-MS, Microbiology, Stability Chambers', 'Quality Control'),
    },
  ];

  // Building A · Ground Floor Rooms (36m x 22m)
  const roomsA0: Room[] = [
    makeRoom('rm-a0-upstream', 'fl-a0', 'dept-mfg', 'Upstream Cell Culture Suite', 'A0-101', 'st-cell-culture', 1, 1, 12, 9, {
      utilizationPct: 88,
      activeFromDate: '2024-06-01',
    }),
    makeRoom('rm-a0-downstream', 'fl-a0', 'dept-mfg', 'Downstream Purification Suite', 'A0-102', 'st-downstream', 13, 1, 11, 9, {
      utilizationPct: 82,
      activeFromDate: '2024-07-15',
    }),
    makeRoom('rm-a0-filling', 'fl-a0', 'dept-mfg', 'Aseptic Vial Filling & Lyo (Grade A/B)', 'A0-103', 'st-aseptic-filling', 24, 1, 11, 9, {
      utilizationPct: 91,
      riskLevel: 'critical',
      activeFromDate: '2024-09-01',
    }),
    makeRoom('rm-a0-corridor', 'fl-a0', 'dept-mfg', 'Grade C Clean Corridor', 'A0-104', 'st-clean-corridor', 1, 10, 34, 3.5, {
      utilizationPct: 45,
      activeFromDate: '2024-05-01',
    }),
    makeRoom('rm-a0-media', 'fl-a0', 'dept-mfg', 'Media & Buffer Preparation', 'A0-105', 'st-media-buffer', 1, 13.5, 10, 7.5, {
      utilizationPct: 76,
      activeFromDate: '2024-06-15',
    }),
    makeRoom('rm-a0-pal', 'fl-a0', 'dept-mfg', 'Personnel Airlock & Gowning (PAL)', 'A0-106', 'st-pal', 11, 13.5, 6, 7.5, {
      utilizationPct: 62,
      activeFromDate: '2024-05-15',
    }),
    makeRoom('rm-a0-mal', 'fl-a0', 'dept-mfg', 'Material Airlock & Autoclave (MAL)', 'A0-107', 'st-mal', 17, 13.5, 6, 7.5, {
      utilizationPct: 68,
      activeFromDate: '2024-06-01',
    }),
    makeRoom('rm-a0-pack', 'fl-a0', 'dept-mfg', 'Inspection & Secondary Packaging', 'A0-108', 'st-packaging', 23, 13.5, 12, 7.5, {
      utilizationPct: 79,
      complianceStatus: 'review-due',
      activeFromDate: '2024-11-01',
    }),
  ];

  // Building A · Level 1 Rooms (36m x 22m)
  const roomsA1: Room[] = [
    makeRoom('rm-a1-hvac', 'fl-a1', 'dept-qa', 'Central GMP HVAC / AHU Plant', 'A1-201', 'st-hvac-plant', 1, 1, 15, 10, {
      utilizationPct: 85,
      activeFromDate: '2024-04-15',
    }),
    makeRoom('rm-a1-wfi', 'fl-a1', 'dept-qa', 'Purified Water & WFI Generation', 'A1-202', 'st-wfi-room', 16, 1, 11, 10, {
      utilizationPct: 90,
      activeFromDate: '2024-05-20',
    }),
    makeRoom('rm-a1-elec', 'fl-a1', 'dept-qa', 'Electrical MCC & UPS Room', 'A1-203', 'st-electrical', 27, 1, 8, 10, {
      utilizationPct: 78,
      activeFromDate: '2024-04-01',
    }),
    makeRoom('rm-a1-control', 'fl-a1', 'dept-qa', 'Central SCADA & BMS Control Room', 'A1-204', 'st-control-room', 1, 12, 11, 9, {
      utilizationPct: 92,
      activeFromDate: '2024-08-01',
    }),
    makeRoom('rm-a1-qa', 'fl-a1', 'dept-qa', 'QA Batch Review & Documentation', 'A1-205', 'st-qa-office', 12, 12, 12, 9, {
      utilizationPct: 72,
      activeFromDate: '2024-09-15',
    }),
    makeRoom('rm-a1-conf', 'fl-a1', 'dept-qa', 'Executive Board & Audit Room', 'A1-206', 'st-conference', 24, 12, 11, 9, {
      utilizationPct: 58,
      activeFromDate: '2024-10-01',
    }),
  ];

  // Building B · Ground Floor Rooms (32m x 20m)
  const roomsB0: Room[] = [
    makeRoom('rm-b0-raw', 'fl-b0', 'dept-wh', 'Raw Material GDP Warehouse', 'B0-101', 'st-raw-warehouse', 1, 1, 14, 11, {
      utilizationPct: 81,
      activeFromDate: '2024-05-01',
    }),
    makeRoom('rm-b0-cold', 'fl-b0', 'dept-wh', 'Biologics Cold Storage (2–8 °C)', 'B0-102', 'st-cold-storage', 15, 1, 10, 11, {
      utilizationPct: 89,
      riskLevel: 'high',
      activeFromDate: '2024-06-15',
    }),
    makeRoom('rm-b0-quarantine', 'fl-b0', 'dept-wh', 'Quarantine & Sampling Bay', 'B0-103', 'st-quarantine', 25, 1, 6, 11, {
      utilizationPct: 64,
      activeFromDate: '2024-06-01',
    }),
    makeRoom('rm-b0-dock', 'fl-b0', 'dept-wh', 'Receiving & Loading Dock', 'B0-104', 'st-loading-dock', 1, 12, 16, 7, {
      utilizationPct: 70,
      activeFromDate: '2024-04-20',
    }),
    makeRoom('rm-b0-dispatch', 'fl-b0', 'dept-wh', 'Cold-Chain Dispatch & Staging', 'B0-105', 'st-dispatch', 17, 12, 14, 7, {
      utilizationPct: 75,
      activeFromDate: '2024-07-01',
    }),
  ];

  // Building B · Level 1 Rooms (32m x 20m)
  const roomsB1: Room[] = [
    makeRoom('rm-b1-analytical', 'fl-b1', 'dept-qc', 'QC Analytical Chemistry Lab', 'B1-201', 'st-qc-analytical', 1, 1, 14, 10, {
      utilizationPct: 86,
      activeFromDate: '2024-07-01',
    }),
    makeRoom('rm-b1-micro', 'fl-b1', 'dept-qc', 'QC Microbiology & Sterility Lab', 'B1-202', 'st-qc-micro', 15, 1, 11, 10, {
      utilizationPct: 84,
      riskLevel: 'high',
      activeFromDate: '2024-07-15',
    }),
    makeRoom('rm-b1-sample', 'fl-b1', 'dept-qc', 'Sample Receiving & Retention', 'B1-203', 'st-sample-receiving', 26, 1, 5, 10, {
      utilizationPct: 66,
      activeFromDate: '2024-06-20',
    }),
    makeRoom('rm-b1-stability', 'fl-b1', 'dept-qc', 'ICH Stability Chamber Room', 'B1-204', 'st-stability-room', 1, 11.5, 13, 7.5, {
      utilizationPct: 92,
      activeFromDate: '2024-08-10',
    }),
    makeRoom('rm-b1-rd', 'fl-b1', 'dept-qc', 'Bioprocess R&D Lab', 'B1-205', 'st-rd-lab', 14, 11.5, 17, 7.5, {
      utilizationPct: 77,
      activeFromDate: '2024-09-01',
    }),
  ];

  const allRooms = [...roomsA0, ...roomsA1, ...roomsB0, ...roomsB1];

  // Generate clean room perimeter walls
  const walls: Wall[] = [];
  allRooms.forEach((rm) => {
    const rmWalls = generateWallsForRoom(rm, rm.id);
    walls.push(...rmWalls);
  });

  // Add realistic doors and observation windows on key walls
  const openings: Opening[] = [
    { id: 'op-1', floorId: 'fl-a0', wallId: 'rm-a0-upstream-w3', kind: 'door', subtype: 'cleanroom-door', name: 'Upstream Cleanroom Entry', offsetRatio: 0.35, width: 1.4, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#2563EB', lockType: 'Electromagnetic Interlock', accessControl: 'interlock', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-2', floorId: 'fl-a0', wallId: 'rm-a0-upstream-w3', kind: 'window', subtype: 'observation-window', name: 'Upstream Viewing Window', offsetRatio: 0.72, width: 3.0, height: 1.35, sillHeight: 1.0, thickness: 0.12, swingDirection: 'slide', swingAngle: 0, materialId: 'mat-glass-cleanroom', frameColor: '#475569', lockType: 'Sealed Flush', accessControl: 'none', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-3', floorId: 'fl-a0', wallId: 'rm-a0-downstream-w3', kind: 'door', subtype: 'cleanroom-door', name: 'Downstream Entry Door', offsetRatio: 0.3, width: 1.4, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#2563EB', lockType: 'RFID Badge', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-4', floorId: 'fl-a0', wallId: 'rm-a0-downstream-w3', kind: 'window', subtype: 'cleanroom-window', name: 'Downstream Observation Glass', offsetRatio: 0.68, width: 2.8, height: 1.35, sillHeight: 1.0, thickness: 0.12, swingDirection: 'slide', swingAngle: 0, materialId: 'mat-glass-cleanroom', frameColor: '#475569', lockType: 'Sealed Flush', accessControl: 'none', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-5', floorId: 'fl-a0', wallId: 'rm-a0-filling-w3', kind: 'door', subtype: 'airlock-door', name: 'Aseptic Suite Airlock Door', offsetRatio: 0.25, width: 1.3, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#2563EB', lockType: 'Interlocked Cascade', accessControl: 'interlock', fireRating: '60 min', status: 'interlocked', layerId: 'layer-openings' },
    { id: 'op-6', floorId: 'fl-a0', wallId: 'rm-a0-filling-w3', kind: 'window', subtype: 'observation-window', name: 'Grade A Isolator Viewing Window', offsetRatio: 0.65, width: 3.4, height: 1.4, sillHeight: 0.95, thickness: 0.12, swingDirection: 'slide', swingAngle: 0, materialId: 'mat-glass-cleanroom', frameColor: '#475569', lockType: 'Sealed Flush', accessControl: 'none', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-7', floorId: 'fl-a0', wallId: 'rm-a0-pal-w1', kind: 'door', subtype: 'airlock-door', name: 'PAL Clean-Side Door', offsetRatio: 0.5, width: 1.2, height: 2.2, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#2563EB', lockType: 'Biometric Interlock', accessControl: 'biometric', fireRating: '60 min', status: 'interlocked', layerId: 'layer-openings' },
    { id: 'op-8', floorId: 'fl-a0', wallId: 'rm-a0-mal-w1', kind: 'door', subtype: 'double-door', name: 'MAL Transfer Double Door', offsetRatio: 0.5, width: 2.0, height: 2.4, sillHeight: 0, thickness: 0.14, swingDirection: 'both', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#475569', lockType: 'Interlock', accessControl: 'interlock', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-9', floorId: 'fl-a0', wallId: 'rm-a0-pack-w1', kind: 'door', subtype: 'sliding-door', name: 'Packaging Line Sliding Door', offsetRatio: 0.4, width: 1.8, height: 2.3, sillHeight: 0, thickness: 0.14, swingDirection: 'slide', swingAngle: 0, materialId: 'mat-cleanroom-panel', frameColor: '#334155', lockType: 'Badge', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-10', floorId: 'fl-b0', wallId: 'rm-b0-dock-w3', kind: 'door', subtype: 'warehouse-door', name: 'Loading Dock Bay 1 Shutter', offsetRatio: 0.25, width: 3.2, height: 3.4, sillHeight: 0, thickness: 0.25, swingDirection: 'slide', swingAngle: 0, materialId: 'mat-carbon-steel', frameColor: '#334155', lockType: 'Dock Interlock', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-11', floorId: 'fl-b0', wallId: 'rm-b0-dock-w3', kind: 'door', subtype: 'warehouse-door', name: 'Loading Dock Bay 2 Shutter', offsetRatio: 0.72, width: 3.2, height: 3.4, sillHeight: 0, thickness: 0.25, swingDirection: 'slide', swingAngle: 0, materialId: 'mat-carbon-steel', frameColor: '#334155', lockType: 'Dock Interlock', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-12', floorId: 'fl-b1', wallId: 'rm-b1-analytical-w3', kind: 'window', subtype: 'double-glazing', name: 'Analytical Lab Corridor Glass', offsetRatio: 0.5, width: 3.2, height: 1.4, sillHeight: 0.95, thickness: 0.12, swingDirection: 'slide', swingAngle: 0, materialId: 'mat-glass-cleanroom', frameColor: '#475569', lockType: 'Fixed', accessControl: 'none', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
  ];

  // Realistic intelligent assets across all 4 floors
  const assets: SpatialAsset[] = [
    // Building A · Ground Floor (GMP Biologics)
    makeAsset('ast-bio-1', 'fl-a0', 'rm-a0-upstream', 'eq-bioreactor-ss', 'Production Bioreactor BR-2001', 'BR-2001', 3.8, 4.2, 0),
    makeAsset('ast-bio-2', 'fl-a0', 'rm-a0-upstream', 'eq-bioreactor-ss', 'Production Bioreactor BR-2002', 'BR-2002', 7.4, 4.2, 0),
    makeAsset('ast-bio-3', 'fl-a0', 'rm-a0-upstream', 'eq-seed-reactor', 'Seed Bioreactor BR-0250', 'BR-0250', 10.6, 4.0, 0),
    makeAsset('ast-bio-4', 'fl-a0', 'rm-a0-upstream', 'eq-bioreactor-su', 'Single-Use Bioreactor SUB-1001', 'SUB-1001', 3.8, 7.6, Math.PI / 2, { operationalStatus: 'commissioning', installationDate: '2025-05-10' }),
    makeAsset('ast-env-1', 'fl-a0', 'rm-a0-upstream', 'eq-sensor-env', 'EMS Upstream ΔP/Temp Sensor', 'EMS-A0-01', 12.1, 8.8, 0),

    makeAsset('ast-chr-1', 'fl-a0', 'rm-a0-downstream', 'eq-chrom-skid', 'Protein A Capture Chrom Skid', 'CHR-301', 15.8, 3.8, 0),
    makeAsset('ast-chr-2', 'fl-a0', 'rm-a0-downstream', 'eq-tff-skid', 'UF/DF TFF Filtration Skid', 'TFF-302', 19.6, 3.8, 0),
    makeAsset('ast-chr-3', 'fl-a0', 'rm-a0-downstream', 'eq-buffer-tank', 'Elution Pool Hold Tank', 'TNK-303', 22.1, 4.2, 0),
    makeAsset('ast-chr-4', 'fl-a0', 'rm-a0-downstream', 'eq-filtration-skid', 'Viral Clearance Skid VF-304', 'VF-304', 17.5, 7.4, 0, { operationalStatus: 'maintenance-due' }),

    makeAsset('ast-fil-1', 'fl-a0', 'rm-a0-filling', 'eq-vial-filler', 'Aseptic Vial Filling Line ALF-5000', 'FIL-401', 28.4, 4.4, 0),
    makeAsset('ast-fil-2', 'fl-a0', 'rm-a0-filling', 'eq-lyophilizer', 'Production Lyophilizer LYO-402', 'LYO-402', 32.6, 7.2, Math.PI / 2),
    makeAsset('ast-fil-3', 'fl-a0', 'rm-a0-filling', 'eq-particle-counter', 'Grade A Continuous Particle Counter', 'PC-401', 25.5, 7.8, 0),

    makeAsset('ast-med-1', 'fl-a0', 'rm-a0-media', 'eq-media-tank', 'Media Prep Tank MP-101', 'MP-101', 3.4, 16.5, 0),
    makeAsset('ast-med-2', 'fl-a0', 'rm-a0-media', 'eq-buffer-tank', 'Buffer Prep Tank BP-102', 'BP-102', 6.4, 16.5, 0),
    makeAsset('ast-med-3', 'fl-a0', 'rm-a0-media', 'eq-cip-skid', 'Central CIP/SIP Skid', 'CIP-103', 8.8, 18.8, 0),

    makeAsset('ast-pal-1', 'fl-a0', 'rm-a0-pal', 'eq-locker', 'Cleanroom Gowning Lockers', 'PAL-L01', 12.6, 15.2, 0),
    makeAsset('ast-pal-2', 'fl-a0', 'rm-a0-pal', 'eq-bench', 'Step-Over Demarcation Bench', 'PAL-B01', 14.0, 17.4, 0),
    makeAsset('ast-pal-3', 'fl-a0', 'rm-a0-pal', 'eq-wash-station', 'Hands-Free Cleanroom Sink', 'PAL-S01', 15.4, 19.6, Math.PI),

    makeAsset('ast-mal-1', 'fl-a0', 'rm-a0-mal', 'eq-autoclave', 'Pass-Through Steam Autoclave', 'AUT-201', 19.8, 16.4, 0),
    makeAsset('ast-mal-2', 'fl-a0', 'rm-a0-mal', 'eq-pallet', 'Sanitized Material Pallet', 'PLT-202', 20.4, 19.4, 0),

    makeAsset('ast-pck-1', 'fl-a0', 'rm-a0-pack', 'eq-inspection-machine', 'Automated Vision Inspector VI-400', 'VI-501', 26.2, 16.6, 0),
    makeAsset('ast-pck-2', 'fl-a0', 'rm-a0-pack', 'eq-packaging-line', 'Serialized Cartoning Line BEC-300', 'PKG-502', 31.2, 17.4, 0),
    makeAsset('ast-saf-1', 'fl-a0', 'rm-a0-corridor', 'eq-fire-ext', 'Emergency Shower & Fire Station', 'SAF-A01', 2.4, 11.6, 0),

    // Building A · Level 1 (Utilities & QA)
    makeAsset('ast-ahu-1', 'fl-a1', 'rm-a1-hvac', 'eq-ahu', 'Cleanroom AHU-01 (Upstream/Downstream)', 'AHU-01', 5.0, 4.2, 0),
    makeAsset('ast-ahu-2', 'fl-a1', 'rm-a1-hvac', 'eq-ahu', 'Aseptic Suite AHU-02 (Grade A/B)', 'AHU-02', 11.4, 4.2, 0),
    makeAsset('ast-chl-1', 'fl-a1', 'rm-a1-hvac', 'eq-chiller', 'Glycol Process Chiller CH-01', 'CH-01', 8.2, 8.2, 0, { operationalStatus: 'maintenance-due' }),
    makeAsset('ast-wfi-1', 'fl-a1', 'rm-a1-wfi', 'eq-wfi-skid', 'Multi-Effect WFI Still', 'WFI-01', 19.2, 4.4, 0),
    makeAsset('ast-wfi-2', 'fl-a1', 'rm-a1-wfi', 'eq-water-tank', '5000L 80°C WFI Storage Tank', 'WFI-T01', 23.6, 4.6, 0),
    makeAsset('ast-wfi-3', 'fl-a1', 'rm-a1-wfi', 'eq-ro-unit', 'Purified Water RO/EDI Skid', 'PW-01', 21.4, 8.4, 0),
    makeAsset('ast-elc-1', 'fl-a1', 'rm-a1-elec', 'eq-electrical-panel', 'Main GMP Switchgear MCC-1', 'MCC-01', 29.5, 3.8, 0),
    makeAsset('ast-elc-2', 'fl-a1', 'rm-a1-elec', 'eq-ups', '250 kVA Critical Load UPS', 'UPS-01', 32.6, 7.6, 0),
    makeAsset('ast-it-rack-1', 'fl-a1', 'rm-a1-control', 'eq-server-rack-42u', 'OT/SCADA 42U Compute Rack DC-01', 'DC-R01', 2.4, 18.6, 0, {
      rackConfig: {
        totalUnits: 42,
        maxPowerKw: 12,
        coolingZone: 'Cold Aisle A1',
        subnetCidr: '10.42.10.0/24',
        devices: [
          {
            id: 'dev-sw-1',
            name: 'Core OT Switch Nexus-9336',
            kind: 'switch',
            uStart: 40,
            uHeight: 2,
            powerW: 650,
            ipAddress: '10.42.10.1',
            vlan: 'VLAN-10-OT',
            vendor: 'Cisco',
            model: 'Nexus 9336C-FX2',
            status: 'online',
            ports: [
              { id: 'p-1', label: 'Eth1/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-10-OT', status: 'up' },
              { id: 'p-2', label: 'Eth1/2', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up' },
              { id: 'p-3', label: 'Eth1/3', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-30-EMS', status: 'up' },
              { id: 'p-4', label: 'Eth1/4', kind: 'QSFP28', speedGbps: 100, vlan: 'VLAN-99-UPLINK', status: 'up' },
            ],
          },
          {
            id: 'dev-fw-1',
            name: 'GMP DMZ Industrial Firewall',
            kind: 'firewall',
            uStart: 38,
            uHeight: 2,
            powerW: 420,
            ipAddress: '10.42.10.254',
            vlan: 'VLAN-99-DMZ',
            vendor: 'Palo Alto',
            model: 'PA-3420',
            status: 'online',
            ports: [
              { id: 'fw-1', label: 'Mgmt', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-DMZ', status: 'up' },
              { id: 'fw-2', label: 'Eth1/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-10-OT', status: 'up' },
            ],
          },
          {
            id: 'dev-srv-1',
            name: 'MES / Batch Historian Node 01',
            kind: 'server',
            uStart: 30,
            uHeight: 2,
            powerW: 850,
            ipAddress: '10.42.10.21',
            vlan: 'VLAN-20-SCADA',
            vendor: 'Dell EMC',
            model: 'PowerEdge R760',
            status: 'online',
            ports: [
              { id: 's1-1', label: 'NIC1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up' },
              { id: 's1-2', label: 'iDRAC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up' },
            ],
          },
          {
            id: 'dev-srv-2',
            name: 'EMS GMP Telemetry Cluster 02',
            kind: 'server',
            uStart: 28,
            uHeight: 2,
            powerW: 780,
            ipAddress: '10.42.10.22',
            vlan: 'VLAN-30-EMS',
            vendor: 'Dell EMC',
            model: 'PowerEdge R760',
            status: 'online',
            ports: [
              { id: 's2-1', label: 'NIC1', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-30-EMS', status: 'up' },
            ],
          },
          {
            id: 'dev-ups-1',
            name: 'Rack Dual-Conversion UPS 6kVA',
            kind: 'ups',
            uStart: 1,
            uHeight: 4,
            powerW: 320,
            ipAddress: '10.42.10.90',
            vlan: 'VLAN-99-MGMT',
            vendor: 'APC',
            model: 'Smart-UPS SRT6KRM',
            status: 'online',
            ports: [
              { id: 'u1-1', label: 'NMC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up' },
            ],
          },
        ],
        cables: [
          {
            id: 'cab-1',
            fromDeviceId: 'dev-sw-1',
            fromPortId: 'p-1',
            toDeviceId: 'dev-fw-1',
            toPortId: 'fw-2',
            media: 'OM4 Fiber',
            vlan: 'VLAN-10-OT',
            color: '#06B6D4',
            label: 'OT-CORE-UPLINK',
          },
          {
            id: 'cab-2',
            fromDeviceId: 'dev-sw-1',
            fromPortId: 'p-2',
            toDeviceId: 'dev-srv-1',
            toPortId: 's1-1',
            media: 'DAC Twinax',
            vlan: 'VLAN-20-SCADA',
            color: '#8B5CF6',
            label: 'MES-HIST-10G',
          },
          {
            id: 'cab-3',
            fromDeviceId: 'dev-sw-1',
            fromPortId: 'p-3',
            toDeviceId: 'dev-srv-2',
            toPortId: 's2-1',
            media: 'Cat6A',
            vlan: 'VLAN-30-EMS',
            color: '#F59E0B',
            label: 'EMS-GMP-LINK',
          },
        ],
      },
    }),
    makeAsset('ast-it-net-1', 'fl-a1', 'rm-a1-control', 'eq-network-rack', 'Cleanroom Fiber Patch Rack NET-01', 'NET-R01', 4.1, 18.6, 0),
    makeAsset('ast-ctl-1', 'fl-a1', 'rm-a1-control', 'eq-scada-console', 'SCADA Operator Console 1', 'CTL-01', 5.2, 15.2, 0),
    makeAsset('ast-ctl-2', 'fl-a1', 'rm-a1-control', 'eq-desk', 'EMS Environmental Console 2', 'CTL-02', 9.0, 15.2, 0),
    makeAsset('ast-qa-1', 'fl-a1', 'rm-a1-qa', 'eq-desk', 'QA Release Lead Desk', 'QA-01', 15.4, 15.0, 0),
    makeAsset('ast-qa-2', 'fl-a1', 'rm-a1-qa', 'eq-desk', 'Validation Engineer Desk', 'QA-02', 19.8, 15.0, 0),
    makeAsset('ast-qa-3', 'fl-a1', 'rm-a1-qa', 'eq-cabinet', 'Batch Record Fireproof Archive', 'QA-ARC1', 22.6, 18.6, Math.PI / 2),
    makeAsset('ast-cnf-1', 'fl-a1', 'rm-a1-conf', 'eq-conf-table', 'Executive GMP Audit Table', 'CNF-01', 29.5, 16.5, 0),

    // Building B · Ground Floor (Cold-Chain Warehouse)
    makeAsset('ast-wh-1', 'fl-b0', 'rm-b0-raw', 'eq-pallet-rack', 'Raw Material Rack Row A', 'RCK-A1', 4.5, 3.2, 0),
    makeAsset('ast-wh-2', 'fl-b0', 'rm-b0-raw', 'eq-pallet-rack', 'Raw Material Rack Row B', 'RCK-B1', 4.5, 7.2, 0),
    makeAsset('ast-wh-3', 'fl-b0', 'rm-b0-raw', 'eq-pallet-rack', 'Raw Material Rack Row C', 'RCK-C1', 10.6, 3.2, 0),
    makeAsset('ast-wh-4', 'fl-b0', 'rm-b0-raw', 'eq-forklift', 'Electric Reach Forklift FL-01', 'FL-01', 10.8, 8.2, Math.PI / 2),
    makeAsset('ast-wh-5', 'fl-b0', 'rm-b0-cold', 'eq-pallet-rack', 'Cold Chain Rack 2–8°C Row 1', 'CLD-R1', 18.2, 3.8, 0),
    makeAsset('ast-wh-6', 'fl-b0', 'rm-b0-cold', 'eq-pallet-rack', 'Cold Chain Rack 2–8°C Row 2', 'CLD-R2', 18.2, 8.2, 0),
    makeAsset('ast-wh-7', 'fl-b0', 'rm-b0-cold', 'eq-sensor-env', 'Cold Storage Mapped Sensor', 'EMS-B0-02', 23.6, 6.0, 0),
    makeAsset('ast-wh-8', 'fl-b0', 'rm-b0-quarantine', 'eq-pallet-rack', 'Quarantine Hold Rack Q1', 'QRN-R1', 28.0, 5.5, Math.PI / 2),
    makeAsset('ast-wh-9', 'fl-b0', 'rm-b0-dock', 'eq-conveyor', 'Inbound Receiving Conveyor', 'CNV-01', 6.0, 15.2, 0),
    makeAsset('ast-wh-10', 'fl-b0', 'rm-b0-dock', 'eq-weighing-station', 'Inbound Pallet Scale', 'SCL-01', 12.2, 15.4, 0),
    makeAsset('ast-wh-11', 'fl-b0', 'rm-b0-dispatch', 'eq-packing-station', 'Thermal Shipper Pack Station', 'PCK-B1', 21.8, 15.4, 0),
    makeAsset('ast-wh-12', 'fl-b0', 'rm-b0-dispatch', 'eq-pallet', 'Validated Cold-Pack Pallet', 'PLT-B9', 27.2, 15.5, 0),

    // Building B · Level 1 (QC Labs)
    makeAsset('ast-qc-1', 'fl-b1', 'rm-b1-analytical', 'eq-hplc', 'Waters ACQUITY UHPLC #1', 'HPLC-01', 4.0, 3.2, 0),
    makeAsset('ast-qc-2', 'fl-b1', 'rm-b1-analytical', 'eq-hplc', 'Waters ACQUITY UHPLC #2', 'HPLC-02', 7.2, 3.2, 0),
    makeAsset('ast-qc-3', 'fl-b1', 'rm-b1-analytical', 'eq-lcms', 'Agilent LC-MS/MS Characterization', 'LCMS-01', 11.4, 3.4, 0),
    makeAsset('ast-qc-4', 'fl-b1', 'rm-b1-analytical', 'eq-lab-bench', 'Analytical Sample Prep Island', 'BNC-01', 6.2, 7.6, 0),
    makeAsset('ast-qc-5', 'fl-b1', 'rm-b1-analytical', 'eq-fume-hood', 'Solvent Extraction Fume Hood', 'FH-01', 12.2, 8.2, Math.PI),
    makeAsset('ast-qc-6', 'fl-b1', 'rm-b1-micro', 'eq-biosafety-cab', 'Class II A2 Biosafety Cabinet #1', 'BSC-01', 18.0, 3.2, 0),
    makeAsset('ast-qc-7', 'fl-b1', 'rm-b1-micro', 'eq-isolator', 'Sterility Testing Isolator', 'ISO-01', 22.8, 3.8, 0),
    makeAsset('ast-qc-8', 'fl-b1', 'rm-b1-micro', 'eq-incubator', 'CO2 Bioburden Incubator Stack', 'INC-01', 18.0, 8.0, 0),
    makeAsset('ast-qc-9', 'fl-b1', 'rm-b1-sample', 'eq-lab-fridge', 'QC Sample Refrigerator (2–8°C)', 'FRG-01', 28.4, 4.2, 0),
    makeAsset('ast-qc-10', 'fl-b1', 'rm-b1-stability', 'eq-stability-chamber', 'ICH Stability Chamber 25°C/60%RH', 'STB-01', 4.2, 14.8, 0),
    makeAsset('ast-qc-11', 'fl-b1', 'rm-b1-stability', 'eq-stability-chamber', 'ICH Accelerated Chamber 40°C/75%RH', 'STB-02', 8.2, 14.8, 0),
    makeAsset('ast-qc-12', 'fl-b1', 'rm-b1-stability', 'eq-ul-freezer', 'Master Cell Bank -80°C Freezer', 'ULT-01', 11.8, 15.0, 0),
    makeAsset('ast-qc-13', 'fl-b1', 'rm-b1-rd', 'eq-lab-bench', 'Bioprocess R&D Bench A', 'RD-B01', 19.0, 15.0, 0),
    makeAsset('ast-qc-14', 'fl-b1', 'rm-b1-rd', 'eq-pcr', 'qPCR Residual DNA Analyzer', 'PCR-01', 25.5, 14.8, 0),
  ];

  const cameras = [
    {
      id: 'cam-1',
      floorId: 'fl-a0',
      name: 'GMP Production Overview',
      kind: 'perspective' as const,
      group: 'Executive Viewpoints',
      position: [18, 22, 34] as [number, number, number],
      target: [18, 1.5, 11] as [number, number, number],
      fov: 45,
      focalLengthMm: 35,
      coverageRadius: 14,
      visibleCone: true,
      layerId: 'layer-cameras',
      status: 'online' as const,
      resolution: '3840×2160',
      fps: 30,
    },
    {
      id: 'cam-2',
      floorId: 'fl-a0',
      name: 'Upstream Bioreactor Bay CCTV',
      kind: 'security' as const,
      group: 'GMP Monitoring',
      position: [2.2, 3.4, 2.2] as [number, number, number],
      target: [8.0, 1.4, 6.2] as [number, number, number],
      fov: 68,
      focalLengthMm: 24,
      coverageRadius: 11,
      visibleCone: true,
      layerId: 'layer-cameras',
      ipAddress: '10.42.20.101',
      port: 554,
      protocol: 'RTSP' as const,
      streamPath: '/h265/ch01/main/av_stream',
      username: 'gmp_cctv_op',
      hasCredentials: true,
      resolution: '2560×1440',
      fps: 30,
      nightVision: true,
      status: 'recording' as const,
    },
    {
      id: 'cam-3',
      floorId: 'fl-a0',
      name: 'Aseptic Filling Line Inspection Cam',
      kind: 'inspection' as const,
      group: 'GMP Monitoring',
      position: [25.2, 3.1, 8.8] as [number, number, number],
      target: [29.4, 1.5, 4.4] as [number, number, number],
      fov: 52,
      focalLengthMm: 35,
      coverageRadius: 9,
      visibleCone: true,
      layerId: 'layer-cameras',
    },
    {
      id: 'cam-4',
      floorId: 'fl-b1',
      name: 'QC Analytical Lab Overview',
      kind: 'perspective' as const,
      group: 'Lab Viewpoints',
      position: [16, 18, 28] as [number, number, number],
      target: [15, 1.2, 10] as [number, number, number],
      fov: 45,
      focalLengthMm: 35,
      coverageRadius: 12,
      visibleCone: true,
      layerId: 'layer-cameras',
    },
  ];

  const flows = [
    {
      id: 'flw-pers-1',
      floorId: 'fl-a0',
      name: 'Unidirectional Personnel Gowning Flow',
      flowType: 'personnel' as const,
      points: [
        { x: 14, z: 20.5 },
        { x: 14, z: 12.0 },
        { x: 6.5, z: 12.0 },
        { x: 6.5, z: 8.5 },
      ],
      color: '#10B981',
      flowRateLabel: '18 operators / shift',
      capacityLabel: 'Max 24 concurrent',
      cleanlinessClass: 'clean' as const,
      restrictions: 'Grade C/B gowning qualification required',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-mat-1',
      floorId: 'fl-a0',
      name: 'Upstream → Downstream → Fill-Finish Product Flow',
      flowType: 'product' as const,
      points: [
        { x: 5.5, z: 16.5 },
        { x: 5.5, z: 5.5 },
        { x: 17.5, z: 5.5 },
        { x: 28.5, z: 5.5 },
        { x: 29.5, z: 16.8 },
      ],
      color: '#2563EB',
      flowRateLabel: '2,000 L / batch',
      capacityLabel: '42 batches / yr',
      cleanlinessClass: 'clean' as const,
      restrictions: 'Closed single-use transfer manifolds',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-wst-1',
      floorId: 'fl-a0',
      name: 'Biowaste & Spent Single-Use Exit Route',
      flowType: 'waste' as const,
      points: [
        { x: 22.0, z: 8.5 },
        { x: 20.0, z: 12.0 },
        { x: 20.0, z: 19.5 },
      ],
      color: '#EF4444',
      flowRateLabel: '320 kg / batch',
      capacityLabel: 'Autoclave cycle 90 min',
      cleanlinessClass: 'dirty' as const,
      restrictions: 'Double-bagged autoclaved before exit',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-air-1',
      floorId: 'fl-a0',
      name: 'Positive Pressure Cascade (+45 → +30 → +15 Pa)',
      flowType: 'airflow' as const,
      points: [
        { x: 29.5, z: 3.0 },
        { x: 18.5, z: 3.0 },
        { x: 18.5, z: 11.5 },
        { x: 14.0, z: 16.0 },
      ],
      color: '#06B6D4',
      flowRateLabel: '35,000 m³/h HEPA',
      capacityLabel: 'ΔP ≥ 15 Pa per grade',
      cleanlinessClass: 'clean' as const,
      restrictions: 'Continuous EMS differential pressure alarm',
      layerId: 'layer-flows',
    },
  ];

  const timelineEvents = [
    { id: 'tl-1', date: '2024-04-01', phase: 'construction' as const, title: 'Structural Shell & Utility Slabs Completed', description: 'Building A & B structural concrete frames and electrical switchgear commissioned.', costDeltaUsd: 4200000 },
    { id: 'tl-2', date: '2024-06-15', phase: 'construction' as const, title: 'Cleanroom Modular Panels & Epoxy Finishes', description: 'Grade A/B/C/D cleanroom envelopes, pressure cascades, and cold-storage panels installed.', costDeltaUsd: 3850000 },
    { id: 'tl-3', date: '2024-10-12', phase: 'installation' as const, title: 'Core Bioreactors, Chromatography & Fill-Finish Rigging', description: '2000L stainless bioreactors, AKTAprocess skid, ALF-5000 isolator, and lyophilizer set.', costDeltaUsd: 6950000 },
    { id: 'tl-4', date: '2025-01-20', phase: 'commissioning' as const, title: 'IQ/OQ/PQ Qualification & Media Fills', description: 'Three consecutive sterile aseptic process simulations passed under EU GMP Annex 1.', costDeltaUsd: 1150000 },
    { id: 'tl-5', date: '2025-06-01', phase: 'operation' as const, title: 'Commercial mAb Campaign Launch & SUB Expansion', description: 'Single-use 1000L bioreactor train commissioned for commercial biologics output.', costDeltaUsd: 680000 },
    { id: 'tl-6', date: '2026-11-22', phase: 'operation' as const, title: 'Current Live Digital Twin Baseline', description: 'Full campus operating at 84% average utilization with 2 scheduled preventive maintenance items.', costDeltaUsd: 240000 },
    { id: 'tl-7', date: '2027-06-01', phase: 'maintenance' as const, title: 'Planned 2027 Lyophilizer & Chiller Overhaul', description: 'Scheduled annual shutdown for HEPA recertification and glycol chiller retrofit.', costDeltaUsd: 410000 },
  ];

  return {
    id: 'proj-cinnagen-campus',
    name: 'CinnaGen Biopharmaceutical Manufacturing Campus',
    code: 'CNG-DT-2026',
    description:
      'Multi-building EU-GMP biopharmaceutical digital twin covering upstream/downstream biologics, Grade A/B aseptic fill-finish, QC analytical & microbiology laboratories, clean utilities, and GDP cold-chain warehousing.',
    industry: 'Biopharmaceutical',
    unitSystem: 'metric',
    revision: 4,
    updatedAt: '2026-11-22T12:00:00.000Z',
    hierarchy,
    buildings,
    floors,
    rooms: allRooms,
    zones: [
      { id: 'zn-1', roomId: 'rm-a0-filling', floorId: 'fl-a0', name: 'Grade A Aseptic Core', code: 'ZN-A1', zoneType: 'aseptic-core', x: 25.5, z: 2.2, width: 6.2, depth: 4.5, color: '#06B6D4' },
      { id: 'zn-2', roomId: 'rm-a0-pal', floorId: 'fl-a0', name: 'Pressure Cascade +20 Pa', code: 'ZN-PC1', zoneType: 'pressure-cascade', x: 11.4, z: 14, width: 5.2, depth: 6.5, color: '#22D3EE' },
    ],
    walls,
    openings,
    assets,
    cameras,
    references: [],
    layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
    flows,
    timelineEvents,
    customMaterials: [],
    customSpaceTypes: [],
    customObjects: [],
  };
}

export function createTemplateScene(
  templateKind: 'blank' | 'aseptic-suite' | 'qc-lab' | 'cold-warehouse',
  customName?: string
): DigitalTwinScene {
  const id = `proj-${Date.now()}`;
  const now = new Date().toISOString();

  if (templateKind === 'blank') {
    const floor: Floor = {
      id: 'fl-1',
      buildingId: 'bldg-1',
      sectionName: 'Main Block',
      name: 'Ground Floor (Level 0)',
      code: 'L0',
      levelIndex: 0,
      elevation: 0,
      height: 3.8,
      slabThickness: 0.3,
      width: 30,
      depth: 20,
      slabMaterialId: 'mat-concrete-sealed',
      metadata: makeMeta('L0', 'Primary facility floor slab', 'Facilities', 'Project Architect', 'planned'),
    };
    return {
      id,
      name: customName || 'Untitled Industrial Facility',
      code: 'DT-NEW-01',
      description: 'Blank spatial digital twin canvas ready for room drawing, wall design, and intelligent equipment placement.',
      industry: 'Industrial',
      unitSystem: 'metric',
      revision: 1,
      updatedAt: now,
      hierarchy: [
        { id: 'ent-1', name: 'Enterprise Group', level: 'enterprise', parentId: null, metadata: makeMeta('ENT-01', 'Root Enterprise', 'Corporate') },
        { id: 'site-1', name: 'Primary Manufacturing Site', level: 'site', parentId: 'ent-1', metadata: makeMeta('SITE-01', 'Industrial Site', 'Operations') },
        { id: 'dept-1', name: 'Operations', level: 'department', parentId: 'bldg-1', metadata: makeMeta('DEPT-01', 'Core Operations', 'Operations') },
      ],
      buildings: [
        {
          id: 'bldg-1',
          siteId: 'site-1',
          name: 'Building 1 — Main Facility',
          code: 'BLDG-01',
          description: 'Primary industrial structure',
          width: 30,
          depth: 20,
          originX: 0,
          originZ: 0,
          color: '#2563EB',
          metadata: makeMeta('BLDG-01', 'Main Building', 'Facilities'),
        },
      ],
      floors: [floor],
      rooms: [],
      zones: [],
      walls: [],
      openings: [],
      assets: [],
      cameras: [
        {
          id: 'cam-default',
          floorId: 'fl-1',
          name: 'Site Isometric View',
          kind: 'perspective',
          group: 'Default',
          position: [15, 20, 30],
          target: [15, 1, 10],
          fov: 45,
          focalLengthMm: 35,
          coverageRadius: 12,
          visibleCone: false,
          layerId: 'layer-cameras',
        },
      ],
      references: [],
      layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
      flows: [],
      timelineEvents: [
        { id: 'tl-init', date: '2026-01-01', phase: 'construction', title: 'Site Baseline Created', description: 'Initial blank site digital twin created.', costDeltaUsd: 0 },
      ],
      customMaterials: [],
      customSpaceTypes: [],
      customObjects: [],
    };
  }

  // Build focused industry starter templates
  const base = createTemplateScene('blank', customName);
  if (templateKind === 'aseptic-suite') {
    base.name = customName || 'Aseptic Fill-Finish Cleanroom Suite';
    base.code = 'ASEP-100';
    base.industry = 'Biopharmaceutical';
    base.description = 'Pre-configured EU GMP Annex 1 Grade A/B/C fill-finish suite with interlocked airlocks and lyophilization.';
    const rooms = [
      makeRoom('rm-1', 'fl-1', 'dept-1', 'Grade A/B Aseptic Filling Suite', 'AF-101', 'st-aseptic-filling', 2, 2, 13, 9),
      makeRoom('rm-2', 'fl-1', 'dept-1', 'Formulation & Hold Room', 'AF-102', 'st-formulation', 15, 2, 11, 9),
      makeRoom('rm-3', 'fl-1', 'dept-1', 'Personnel Airlock (PAL)', 'AF-103', 'st-pal', 2, 11, 6, 6),
      makeRoom('rm-4', 'fl-1', 'dept-1', 'Material Airlock (MAL)', 'AF-104', 'st-mal', 8, 11, 7, 6),
      makeRoom('rm-5', 'fl-1', 'dept-1', 'Component Sterilization', 'AF-105', 'st-sterile-wash', 15, 11, 11, 6),
    ];
    base.rooms = rooms;
    base.walls = rooms.flatMap((r) => generateWallsForRoom(r, r.id));
    base.assets = [
      makeAsset('a1', 'fl-1', 'rm-1', 'eq-vial-filler', 'Aseptic Vial Filler ALF-5000', 'AF-FIL01', 6.5, 5.5, 0),
      makeAsset('a2', 'fl-1', 'rm-1', 'eq-lyophilizer', 'Lyophilizer LYO-01', 'AF-LYO01', 12.2, 7.2, Math.PI / 2),
      makeAsset('a3', 'fl-1', 'rm-2', 'eq-mixing-tank', 'Formulation Tank FT-01', 'AF-FT01', 18.2, 5.5, 0),
      makeAsset('a4', 'fl-1', 'rm-2', 'eq-filtration-skid', 'Sterile Filtration Skid', 'AF-SF01', 22.4, 5.5, 0),
      makeAsset('a5', 'fl-1', 'rm-5', 'eq-autoclave', 'Barrier Autoclave AUT-01', 'AF-AUT01', 20.0, 14.0, 0),
    ];
  } else if (templateKind === 'qc-lab') {
    base.name = customName || 'QC Analytical & Microbiology Lab';
    base.code = 'QC-LAB-01';
    base.industry = 'Quality Control Laboratory';
    base.description = 'ISO 17025 analytical chemistry, microbiology sterility, and ICH stability chamber laboratory block.';
    const rooms = [
      makeRoom('rm-1', 'fl-1', 'dept-1', 'Analytical Chemistry Lab', 'QC-101', 'st-qc-analytical', 2, 2, 13, 9),
      makeRoom('rm-2', 'fl-1', 'dept-1', 'Microbiology Lab', 'QC-102', 'st-qc-micro', 15, 2, 12, 9),
      makeRoom('rm-3', 'fl-1', 'dept-1', 'ICH Stability Chambers', 'QC-103', 'st-stability-room', 2, 11, 13, 7),
      makeRoom('rm-4', 'fl-1', 'dept-1', 'QA Review & Sample Prep', 'QC-104', 'st-qa-office', 15, 11, 12, 7),
    ];
    base.rooms = rooms;
    base.walls = rooms.flatMap((r) => generateWallsForRoom(r, r.id));
    base.assets = [
      makeAsset('q1', 'fl-1', 'rm-1', 'eq-hplc', 'UHPLC System 1', 'HPLC-01', 5.0, 4.2, 0),
      makeAsset('q2', 'fl-1', 'rm-1', 'eq-lcms', 'LC-MS/MS System', 'LCMS-01', 10.2, 4.2, 0),
      makeAsset('q3', 'fl-1', 'rm-1', 'eq-lab-bench', 'Prep Island Bench', 'BNC-01', 7.5, 8.2, 0),
      makeAsset('q4', 'fl-1', 'rm-2', 'eq-biosafety-cab', 'Class II Biosafety Cabinet', 'BSC-01', 18.2, 4.2, 0),
      makeAsset('q5', 'fl-1', 'rm-2', 'eq-isolator', 'Sterility Isolator', 'ISO-01', 23.0, 4.5, 0),
      makeAsset('q6', 'fl-1', 'rm-3', 'eq-stability-chamber', 'Stability Chamber 25°C', 'STB-01', 5.5, 14.5, 0),
      makeAsset('q7', 'fl-1', 'rm-3', 'eq-ul-freezer', '-80°C Reference Freezer', 'ULT-01', 10.5, 14.5, 0),
    ];
  } else if (templateKind === 'cold-warehouse') {
    base.name = customName || 'GDP Cold-Chain Distribution Hub';
    base.code = 'GDP-WH-01';
    base.industry = 'Warehouses & Logistics';
    base.description = 'Temperature-mapped ambient and 2–8°C biopharmaceutical storage facility with quarantine and docks.';
    const rooms = [
      makeRoom('rm-1', 'fl-1', 'dept-1', 'Controlled Ambient Storage', 'WH-101', 'st-raw-warehouse', 2, 2, 14, 10),
      makeRoom('rm-2', 'fl-1', 'dept-1', 'Cold Storage (2–8 °C)', 'WH-102', 'st-cold-storage', 16, 2, 12, 10),
      makeRoom('rm-3', 'fl-1', 'dept-1', 'Receiving & Dispatch Dock', 'WH-103', 'st-loading-dock', 2, 12, 26, 6.5),
    ];
    base.rooms = rooms;
    base.walls = rooms.flatMap((r) => generateWallsForRoom(r, r.id));
    base.assets = [
      makeAsset('w1', 'fl-1', 'rm-1', 'eq-pallet-rack', 'Ambient Rack A', 'RCK-01', 5.5, 4.5, 0),
      makeAsset('w2', 'fl-1', 'rm-1', 'eq-pallet-rack', 'Ambient Rack B', 'RCK-02', 5.5, 8.5, 0),
      makeAsset('w3', 'fl-1', 'rm-1', 'eq-forklift', 'Electric Reach Truck', 'FL-01', 12.0, 7.0, Math.PI / 2),
      makeAsset('w4', 'fl-1', 'rm-2', 'eq-pallet-rack', 'Cold Chain Rack 1', 'CLD-01', 20.5, 5.0, 0),
      makeAsset('w5', 'fl-1', 'rm-2', 'eq-pallet-rack', 'Cold Chain Rack 2', 'CLD-02', 20.5, 9.0, 0),
      makeAsset('w6', 'fl-1', 'rm-3', 'eq-conveyor', 'Outbound Staging Conveyor', 'CNV-01', 10.0, 15.0, 0),
    ];
  }

  return base;
}
