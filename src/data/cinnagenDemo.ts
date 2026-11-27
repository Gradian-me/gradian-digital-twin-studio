import type {
  DigitalTwinScene,
  EnterpriseNode,
  Floor,
  NetworkArchitectureState,
  NetworkUserNode,
  Opening,
  Room,
  SceneCamera,
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

/**
 * Guarantees every designed room on a floor has at least one walkable door opening
 * so First-Person Walk Mode can always enter and exit every room smoothly.
 */
export function ensureDoorsForAllRooms(
  rooms: Room[],
  walls: Wall[],
  existingOpenings: Opening[]
): Opening[] {
  const result = [...existingOpenings];
  const wallById = new Map<string, Wall>();
  walls.forEach((w) => wallById.set(w.id, w));

  // Helper: check if any door opening sits spatially near a wall segment
  const wallHasSpatialDoor = (w: Wall): boolean => {
    const dx = w.x2 - w.x1;
    const dz = w.z2 - w.z1;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 0.04) return false;
    return result.some((op) => {
      if (op.kind !== 'door' || op.floorId !== w.floorId) return false;
      if (op.wallId === w.id) return true;
      const host = wallById.get(op.wallId);
      if (!host) return false;
      const cx = host.x1 + (host.x2 - host.x1) * op.offsetRatio;
      const cz = host.z1 + (host.z2 - host.z1) * op.offsetRatio;
      const t = Math.max(0, Math.min(1, ((cx - w.x1) * dx + (cz - w.z1) * dz) / lenSq));
      const px = w.x1 + t * dx;
      const pz = w.z1 + t * dz;
      return Math.hypot(cx - px, cz - pz) <= 0.45;
    });
  };

  rooms.forEach((rm) => {
    const rmWalls = walls.filter((w) => w.roomId === rm.id && w.floorId === rm.floorId);
    if (rmWalls.length === 0) return;
    if (rmWalls.some((w) => wallHasSpatialDoor(w))) return;

    // Pick best interior/corridor-facing wall (prefer South or North wall facing floor center)
    const floorRooms = rooms.filter((r) => r.floorId === rm.floorId);
    const avgZ = floorRooms.reduce((s, r) => s + r.z + r.depth / 2, 0) / Math.max(1, floorRooms.length);
    const roomCenterZ = rm.z + rm.depth / 2;
    const preferredSuffix = roomCenterZ <= avgZ ? '-w3' : '-w1';
    const hostWall =
      rmWalls.find((w) => w.id.endsWith(preferredSuffix)) ??
      rmWalls.find((w) => Math.hypot(w.x2 - w.x1, w.z2 - w.z1) >= 2.2) ??
      rmWalls[0];

    const isClean = rm.category === 'Cleanrooms' || rm.category === 'Pharmaceutical Manufacturing';
    const isGlass = hostWall.presetId === 'full-glass-wall' || hostWall.presetId === 'glass-partition';
    const isWarehouse = rm.category === 'Warehouses & Logistics';

    result.push({
      id: `op-auto-${rm.id}`,
      floorId: rm.floorId,
      wallId: hostWall.id,
      kind: 'door',
      subtype: isGlass ? 'glass-door' : isClean ? 'cleanroom-door' : isWarehouse ? 'double-door' : 'single-door',
      name: `${rm.code} · ${rm.name} Access Door`,
      offsetRatio: 0.48,
      width: isWarehouse ? 1.8 : 1.3,
      height: 2.25,
      sillHeight: 0,
      thickness: isGlass ? 0.08 : 0.14,
      swingDirection: isWarehouse ? 'both' : 'right',
      swingAngle: 90,
      materialId: isGlass ? 'mat-glass-cleanroom' : isClean ? 'mat-cleanroom-panel' : 'mat-carbon-steel',
      frameColor: isClean ? '#2563EB' : '#334155',
      lockType: isClean ? 'RFID Interlock' : 'Badge Access',
      accessControl: isClean ? 'badge' : 'none',
      fireRating: '60 min',
      status: 'closed',
      layerId: 'layer-openings',
    });
  });

  return result;
}

const COST_CENTER_BY_CATEGORY: Record<string, string> = {
  Biopharmaceutical: 'CC-BIO-101 · Sterile Biologics Production',
  Laboratory: 'CC-QC-204 · Quality Control & Analytical',
  'HVAC & Utilities': 'CC-UTL-301 · Clean Utilities & GMP HVAC',
  'IT & Data Center': 'CC-IT-401 · OT/IT Infrastructure & SCADA',
  'Warehouse & Logistics': 'CC-GDP-501 · Cold-Chain Supply & Logistics',
  'Furniture & Workplace': 'CC-FAC-602 · QA Workplace & Admin',
  'Building & Safety': 'CC-EHS-701 · EHS Fire & Biosafety',
};

const SOP_IDS_BY_CATEGORY: Record<string, string[]> = {
  Biopharmaceutical: ['sop-bio-cipsip', 'sop-chrom-oq', 'sop-lyo-cal', 'sop-all-dev'],
  Laboratory: ['sop-hplc-pm', 'sop-all-dev'],
  'HVAC & Utilities': ['sop-cleanroom-pq', 'sop-all-dev'],
  'IT & Data Center': ['sop-it-rack', 'sop-all-dev'],
  'Warehouse & Logistics': ['sop-wh-cold', 'sop-all-dev'],
  'Furniture & Workplace': ['sop-cleanroom-pq', 'sop-all-dev'],
  'Building & Safety': ['sop-cleanroom-pq', 'sop-all-dev'],
};

/**
 * Guarantees every device/asset carries complete SOP links, identification,
 * cost center, vendor service history, and owner custody history.
 */
export function enrichAssetHistory(asset: SpatialAsset): SpatialAsset {
  const costCenter =
    asset.costCenter ||
    COST_CENTER_BY_CATEGORY[asset.category] ||
    'CC-OPS-100 · Facility Operations';

  const matchedSops =
    asset.sopIds && asset.sopIds.length > 0
      ? asset.sopIds
      : asset.archetype === 'lyophilizer' || asset.archetype === 'filling-line'
        ? ['sop-lyo-cal', 'sop-cleanroom-pq', 'sop-all-dev']
        : asset.archetype === 'chromatography-skid' || asset.archetype === 'filtration-skid'
          ? ['sop-chrom-oq', 'sop-bio-cipsip', 'sop-all-dev']
          : SOP_IDS_BY_CATEGORY[asset.category] || ['sop-all-dev'];

  const vendorHistory =
    asset.vendorHistory && asset.vendorHistory.length > 0
      ? asset.vendorHistory
      : [
          {
            id: `vh-${asset.id}-1`,
            date: asset.installationDate || '2024-10-12',
            vendor: asset.manufacturer || 'OEM Authorized Partner',
            action: 'OEM Delivery, Installation & FAT/SAT',
            costUsd: Math.round((asset.capexUsd || 15000) * 0.08),
            reference: `PO-FAT-${asset.assetId}`,
            note: `Factory acceptance and site rigging completed for ${asset.model}.`,
          },
          {
            id: `vh-${asset.id}-2`,
            date: asset.commissioningDate || '2025-01-20',
            vendor: `${asset.manufacturer || 'OEM'} Field Validation Services`,
            action: 'IQ / OQ / PQ Qualification & Traceable Calibration',
            costUsd: Math.round((asset.annualOpexUsd || 3200) * 0.35),
            reference: `VAL-PQ-${asset.assetId}`,
            note: 'Passed EU GMP Annex 15 & 21 CFR Part 11 verification protocol.',
          },
          {
            id: `vh-${asset.id}-3`,
            date: asset.lastMaintenance || '2026-08-14',
            vendor: 'Gradian Certified Metrology & OEM Care',
            action: asset.operationalStatus === 'maintenance-due' ? 'Preventive Inspection (Action Pending)' : 'Annual PM & Sensor Re-Calibration',
            costUsd: Math.round((asset.annualOpexUsd || 3200) * 0.28),
            reference: `WO-PM-${asset.assetId}`,
            note: 'Verified NIST-traceable calibration tolerance and replaced wear seals/filters.',
          },
        ];

  const ownerHistory =
    asset.ownerHistory && asset.ownerHistory.length > 0
      ? asset.ownerHistory
      : [
          {
            id: `oh-${asset.id}-1`,
            date: asset.installationDate || '2024-10-12',
            owner: 'Capital Projects & Commissioning Team',
            department: 'Site Engineering',
            costCenter: 'CC-CAPEX-001 · Campus Expansion',
            note: 'Initial procurement, site handover, and GMP tagging.',
          },
          {
            id: `oh-${asset.id}-2`,
            date: asset.commissioningDate || '2025-01-20',
            owner: asset.owner || 'CinnaGen Engineering',
            department: asset.department || 'Biologics Manufacturing',
            costCenter,
            note: `Operational custody assigned to ${asset.responsiblePerson || 'Area Lead'}.`,
          },
        ];

  const hasSopDoc = asset.documents?.some((d) => d.kind === 'SOP');
  const documents = hasSopDoc
    ? asset.documents
    : [
        ...(asset.documents || []),
        {
          id: `d-sop-${asset.id}`,
          title: `Standard Operating Procedure (${asset.category})`,
          kind: 'SOP',
          code: `SOP-${asset.assetId}`,
        },
      ];

  return {
    ...asset,
    costCenter,
    sopIds: matchedSops,
    vendorHistory,
    ownerHistory,
    documents,
    qrCode: asset.qrCode || `GRADIAN://ASSET/${asset.assetId}`,
    equipmentId: asset.equipmentId || `EQ-${asset.assetId}`,
  };
}

/**
 * Guarantees every room across all floors has a valid room number code
 * and at least one realistic 3D equipment/furniture model inside its footprint.
 */
export function ensureRoomsHaveCodesAndModels(scene: DigitalTwinScene): void {
  const usedCodes = new Set(scene.rooms.map((r) => r.code?.trim()).filter(Boolean));
  const floorRoomCounters = new Map<string, number>();

  scene.rooms.forEach((rm) => {
    const fl = scene.floors.find((f) => f.id === rm.floorId);
    const flPrefix = (fl?.code || 'FL').replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'RM';
    const baseNum = (fl?.levelIndex ?? 0) === 0 ? 101 : 201 + ((fl?.levelIndex ?? 1) - 1) * 100;
    const count = floorRoomCounters.get(rm.floorId) ?? 0;
    floorRoomCounters.set(rm.floorId, count + 1);

    if (!rm.code || !rm.code.trim()) {
      let seq = baseNum + count;
      let candidate = `${flPrefix}-${seq}`;
      while (usedCodes.has(candidate)) {
        seq += 1;
        candidate = `${flPrefix}-${seq}`;
      }
      rm.code = candidate;
      usedCodes.add(candidate);
      if (rm.metadata) {
        rm.metadata.code = candidate;
      }
    }

    // Ensure every room in the site list has at least one 3D model inside it
    const roomAssets = scene.assets.filter(
      (a) =>
        a.roomId === rm.id ||
        (a.floorId === rm.floorId &&
          a.x >= rm.x &&
          a.x <= rm.x + rm.width &&
          a.z >= rm.z &&
          a.z <= rm.z + rm.depth)
    );

    if (roomAssets.length === 0) {
      const cat = (rm.category || '').toLowerCase();
      const nameL = (rm.name || '').toLowerCase();
      const tplId =
        nameL.includes('cold') || nameL.includes('freezer')
          ? 'eq-cold-room-unit'
          : nameL.includes('conference') || nameL.includes('board') || nameL.includes('audit')
            ? 'eq-conf-table'
            : nameL.includes('server') || nameL.includes('data') || nameL.includes('control')
              ? 'eq-scada-console'
              : nameL.includes('warehouse') || nameL.includes('storage') || nameL.includes('quarantine')
                ? 'eq-pallet-rack'
                : nameL.includes('hvac') || nameL.includes('ahu')
                  ? 'eq-ahu'
                  : nameL.includes('elec') || nameL.includes('ups')
                    ? 'eq-electrical-panel'
                    : nameL.includes('airlock') || nameL.includes('pal') || nameL.includes('gown')
                      ? 'eq-locker'
                      : cat.includes('lab') || cat.includes('quality')
                        ? 'eq-lab-bench'
                        : cat.includes('office')
                          ? 'eq-desk'
                          : cat.includes('cleanroom') || cat.includes('pharma')
                            ? 'eq-bioreactor-su'
                            : 'eq-lab-bench';

      const cx = Number((rm.x + rm.width * 0.5).toFixed(2));
      const cz = Number((rm.z + rm.depth * 0.5).toFixed(2));
      const cleanCode = rm.code.replace(/[^A-Z0-9]/gi, '');
      const autoAsset = enrichAssetHistory(
        makeAsset(
          `ast-auto-${rm.id}`,
          rm.floorId,
          rm.id,
          tplId,
          `${rm.name} Primary Station`,
          `EQ-${cleanCode}`,
          cx,
          cz,
          0
        )
      );
      scene.assets.push(autoAsset);
    }
  });

  // Guarantee EVERY room across ALL floors has at least one connected IT/OT NetworkUserNode
  if (scene.networkArchitecture) {
    const netArch = scene.networkArchitecture;
    const itRacks = scene.assets.filter(
      (a) => a.category === 'IT & Data Center' || Boolean(a.rackConfig)
    );
    if (itRacks.length > 0) {
      const coveredRooms = new Set(netArch.userNodes.map((n) => n.roomId).filter(Boolean));
      let autoSeq = netArch.userNodes.length + 1;

      scene.rooms.forEach((rm) => {
        if (coveredRooms.has(rm.id)) return;
        const floorRacks = itRacks.filter((r) => r.floorId === rm.floorId);
        const targetRack =
          floorRacks.find((r) => r.rackConfig?.devices.some((d) => d.tier === 'access')) ??
          floorRacks[0] ??
          itRacks.find((r) => r.rackConfig?.devices.some((d) => d.tier === 'access')) ??
          itRacks[0];
        if (!targetRack?.rackConfig?.devices?.length) return;

        const targetDev =
          targetRack.rackConfig.devices.find((d) => d.tier === 'access') ??
          targetRack.rackConfig.devices.find((d) => d.kind === 'switch') ??
          targetRack.rackConfig.devices[0];
        if (!targetDev) return;

        const usedPortIds = new Set(netArch.userNodes.map((n) => n.connectedPortId));
        let port = targetDev.ports.find(
          (p) => p.kind === 'RJ45' && !p.isUplink && !usedPortIds.has(p.id)
        );
        if (!port) {
          const nextNum = targetDev.ports.filter((p) => p.kind === 'RJ45').length + 1;
          port = {
            id: `${targetDev.id}-gi${nextNum}`,
            label: `Gi1/0/${nextNum}`,
            kind: 'RJ45',
            speedGbps: 1,
            status: 'up',
            vlan: 'VLAN-10-OT',
            connectedToLabel: `${rm.code} Drop`,
            poeWatts: 12,
          };
          targetDev.ports.push(port);
        }

        const nameL = (rm.name || '').toLowerCase();
        const catL = (rm.category || '').toLowerCase();
        const nodeKind: NetworkUserNode['nodeKind'] =
          nameL.includes('hvac') || nameL.includes('water') || nameL.includes('wfi') || nameL.includes('elec') || nameL.includes('ups')
            ? 'iot-gateway'
            : nameL.includes('lab') || nameL.includes('micro') || nameL.includes('analytical') || nameL.includes('stability') || nameL.includes('r&d')
              ? 'hplc-drop'
              : nameL.includes('corridor') || nameL.includes('dock') || nameL.includes('warehouse') || nameL.includes('cold') || nameL.includes('quarantine')
                ? 'wifi-ap'
                : nameL.includes('airlock') || nameL.includes('mal') || nameL.includes('pal')
                  ? 'badge-reader'
                  : nameL.includes('downstream') || nameL.includes('media') || nameL.includes('buffer') || nameL.includes('pack') || nameL.includes('fill') || catL.includes('cleanroom')
                    ? 'hmi-panel'
                    : 'workstation';

        const prefixMap: Record<NetworkUserNode['nodeKind'], string> = {
          'hmi-panel': 'HMI',
          'hplc-drop': 'LAB',
          'wifi-ap': 'AP',
          'badge-reader': 'ACS',
          'iot-gateway': 'BMS',
          'cctv-cam': 'CAM',
          'ip-phone': 'VOIP',
          workstation: 'WS',
        };
        const vlanMap: Record<NetworkUserNode['nodeKind'], string> = {
          'hmi-panel': 'VLAN-10-OT',
          'hplc-drop': 'VLAN-31-LAB',
          'wifi-ap': 'VLAN-50-WIFI',
          'badge-reader': 'VLAN-70-ACS',
          'iot-gateway': 'VLAN-20-SCADA',
          'cctv-cam': 'VLAN-70-ACS',
          'ip-phone': 'VLAN-11-QA',
          workstation: 'VLAN-11-QA',
        };
        const octet3 =
          nodeKind === 'hmi-panel'
            ? 20
            : nodeKind === 'hplc-drop'
              ? 31
              : nodeKind === 'wifi-ap'
                ? 50
                : nodeKind === 'badge-reader'
                  ? 70
                  : nodeKind === 'iot-gateway'
                    ? 22
                    : 11;

        const cleanCode = (rm.code || `RM${autoSeq}`).replace(/[^A-Z0-9-]/gi, '').toUpperCase();
        const prefix = prefixMap[nodeKind];
        const code = `${prefix}-${cleanCode}`;
        const labelSuffix =
          nodeKind === 'iot-gateway'
            ? 'BMS / PLC Telemetry Gateway'
            : nodeKind === 'hplc-drop'
              ? 'Lab Instrument Network Drop'
              : nodeKind === 'wifi-ap'
                ? 'Industrial Wi-Fi 6E AP'
                : nodeKind === 'badge-reader'
                  ? 'Interlock RFID Access Controller'
                  : nodeKind === 'hmi-panel'
                    ? 'Cleanroom Process HMI Terminal'
                    : 'GMP Room Workstation Drop';

        const nx = Number((rm.x + Math.min(rm.width - 1.2, Math.max(1.2, rm.width * 0.52))).toFixed(2));
        const nz = Number((rm.z + Math.min(rm.depth - 1.2, Math.max(1.2, rm.depth * 0.5))).toFixed(2));
        const ipHost = 80 + ((autoSeq * 3) % 160);
        const hexIdx = autoSeq.toString(16).toUpperCase().padStart(2, '0');

        netArch.userNodes.push({
          id: `un-room-${rm.id}`,
          code,
          name: `${rm.name} ${labelSuffix}`,
          nodeKind,
          floorId: rm.floorId,
          roomId: rm.id,
          x: nx,
          z: nz,
          wallJackId: `WJ-${cleanCode}-01`,
          ipAddress: `10.42.${octet3}.${ipHost}`,
          macAddress: `3C:7C:3F:E0:${hexIdx}:${(ipHost % 250).toString(16).toUpperCase().padStart(2, '0')}`,
          vlan: vlanMap[nodeKind],
          poeWatts: nodeKind === 'wifi-ap' ? 21.5 : nodeKind === 'hmi-panel' ? 16.4 : nodeKind === 'iot-gateway' ? 11.2 : 9.5,
          connectedRackId: targetRack.id,
          connectedDeviceId: targetDev.id,
          connectedPortId: port.id,
          media: nodeKind === 'wifi-ap' || nodeKind === 'hmi-panel' ? 'PoE++ Cat6A' : 'Cat6A',
          status: 'online',
          bandwidthMbps: 180 + (autoSeq % 5) * 65,
          latencyMs: Number((0.9 + (autoSeq % 7) * 0.25).toFixed(1)),
          packetLossPct: 0.0,
          crcErrors: 0,
          notes: `Auto-provisioned room drop in ${rm.code} (${rm.name}) → ${targetRack.assetId} ${targetDev.model} [${port.label}].`,
        });
        coveredRooms.add(rm.id);
        autoSeq += 1;
      });
    }
  }
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

function makeEnrichedAsset(
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
  return enrichAssetHistory(makeAsset(id, floorId, roomId, templateId, name, assetCode, x, z, rotationY, overrides));
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
  const fullGlassWallIds = new Set([
    'rm-a0-pack-w2',
    'rm-a0-corridor-w2',
    'rm-a1-conf-w1',
    'rm-a1-qa-w1',
    'rm-b1-rd-w1',
  ]);
  const fullGlassPreset = WALL_PRESETS.find((p) => p.id === 'full-glass-wall');
  const walls: Wall[] = [];
  allRooms.forEach((rm) => {
    const rmWalls = generateWallsForRoom(rm, rm.id).map((w) =>
      fullGlassWallIds.has(w.id) && fullGlassPreset
        ? {
            ...w,
            presetId: fullGlassPreset.id,
            thickness: fullGlassPreset.thickness,
            materialId: fullGlassPreset.materialId,
            color: fullGlassPreset.color,
            opacity: fullGlassPreset.opacity,
            isStructural: false,
            fireRating: fullGlassPreset.fireRating,
            acousticRatingDb: fullGlassPreset.acousticRatingDb,
          }
        : w
    );
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
    { id: 'op-13', floorId: 'fl-a0', wallId: 'rm-a0-corridor-w4', kind: 'door', subtype: 'fire-door', name: 'West Corridor Emergency Fire Exit', offsetRatio: 0.5, width: 1.25, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'left', swingAngle: 90, materialId: 'mat-carbon-steel', frameColor: '#DC2626', lockType: 'Panic Crash Bar', accessControl: 'none', fireRating: '120 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-14', floorId: 'fl-a1', wallId: 'rm-a1-conf-w1', kind: 'door', subtype: 'glass-door', name: 'Executive Audit Suite Frameless Entry', offsetRatio: 0.25, width: 1.15, height: 2.3, sillHeight: 0, thickness: 0.08, swingDirection: 'right', swingAngle: 90, materialId: 'mat-glass-cleanroom', frameColor: '#1E293B', lockType: 'RFID Glass Patch Lock', accessControl: 'badge', fireRating: 'None', status: 'closed', layerId: 'layer-openings' },
    // Complete doorway connectivity across all Building A & B rooms so walk mode moves freely everywhere
    { id: 'op-15', floorId: 'fl-a0', wallId: 'rm-a0-media-w1', kind: 'door', subtype: 'cleanroom-door', name: 'Media & Buffer Corridor Entry', offsetRatio: 0.52, width: 1.45, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#2563EB', lockType: 'RFID Badge', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-16', floorId: 'fl-a0', wallId: 'rm-a0-upstream-w2', kind: 'door', subtype: 'cleanroom-door', name: 'Upstream → Downstream Transfer Door', offsetRatio: 0.55, width: 1.35, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#2563EB', lockType: 'Interlock', accessControl: 'interlock', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-17', floorId: 'fl-a1', wallId: 'rm-a1-hvac-w3', kind: 'door', subtype: 'double-door', name: 'HVAC Plant Maintenance Double Door', offsetRatio: 0.5, width: 1.7, height: 2.3, sillHeight: 0, thickness: 0.14, swingDirection: 'both', swingAngle: 90, materialId: 'mat-carbon-steel', frameColor: '#334155', lockType: 'Badge', accessControl: 'badge', fireRating: '90 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-18', floorId: 'fl-a1', wallId: 'rm-a1-wfi-w3', kind: 'door', subtype: 'single-door', name: 'WFI Generation Suite Access Door', offsetRatio: 0.5, width: 1.3, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#2563EB', lockType: 'Badge', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-19', floorId: 'fl-a1', wallId: 'rm-a1-elec-w3', kind: 'door', subtype: 'fire-door', name: 'Electrical MCC & UPS Fire-Rated Door', offsetRatio: 0.45, width: 1.35, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-carbon-steel', frameColor: '#DC2626', lockType: 'Keycard + Fire Panic', accessControl: 'badge', fireRating: '120 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-20', floorId: 'fl-a1', wallId: 'rm-a1-control-w1', kind: 'door', subtype: 'security-door', name: 'SCADA & Data Center Biometric Door', offsetRatio: 0.55, width: 1.25, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-carbon-steel', frameColor: '#4F46E5', lockType: 'Biometric + RFID', accessControl: 'biometric', fireRating: '90 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-21', floorId: 'fl-a1', wallId: 'rm-a1-qa-w1', kind: 'door', subtype: 'glass-door', name: 'QA Batch Review Suite Glass Entry (A1-205)', offsetRatio: 0.45, width: 1.3, height: 2.3, sillHeight: 0, thickness: 0.08, swingDirection: 'right', swingAngle: 90, materialId: 'mat-glass-cleanroom', frameColor: '#1E293B', lockType: 'RFID Glass Lock', accessControl: 'badge', fireRating: 'None', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-22', floorId: 'fl-a1', wallId: 'rm-a1-qa-w2', kind: 'door', subtype: 'glass-door', name: 'QA → Executive Audit Connecting Door', offsetRatio: 0.5, width: 1.2, height: 2.25, sillHeight: 0, thickness: 0.08, swingDirection: 'right', swingAngle: 90, materialId: 'mat-glass-cleanroom', frameColor: '#1E293B', lockType: 'Badge', accessControl: 'badge', fireRating: 'None', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-23', floorId: 'fl-a1', wallId: 'rm-a1-control-w2', kind: 'door', subtype: 'single-door', name: 'SCADA → QA Suite Internal Door', offsetRatio: 0.42, width: 1.2, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#334155', lockType: 'Badge', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-24', floorId: 'fl-b0', wallId: 'rm-b0-raw-w3', kind: 'door', subtype: 'double-door', name: 'Raw Warehouse → Receiving Dock Passage', offsetRatio: 0.52, width: 2.2, height: 2.6, sillHeight: 0, thickness: 0.16, swingDirection: 'both', swingAngle: 90, materialId: 'mat-carbon-steel', frameColor: '#334155', lockType: 'Badge', accessControl: 'badge', fireRating: '90 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-25', floorId: 'fl-b0', wallId: 'rm-b0-cold-w3', kind: 'door', subtype: 'sliding-door', name: 'Cold Storage (2–8°C) Insulated Sliding Door', offsetRatio: 0.5, width: 1.9, height: 2.5, sillHeight: 0, thickness: 0.18, swingDirection: 'slide', swingAngle: 0, materialId: 'mat-cleanroom-panel', frameColor: '#0284C7', lockType: 'Thermal Interlock', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-26', floorId: 'fl-b0', wallId: 'rm-b0-quarantine-w3', kind: 'door', subtype: 'single-door', name: 'Quarantine & Sampling Bay Entry', offsetRatio: 0.5, width: 1.4, height: 2.3, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-carbon-steel', frameColor: '#D97706', lockType: 'QA Seal Lock', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-27', floorId: 'fl-b0', wallId: 'rm-b0-dispatch-w4', kind: 'door', subtype: 'double-door', name: 'Receiving ↔ Dispatch Connecting Door', offsetRatio: 0.5, width: 2.0, height: 2.5, sillHeight: 0, thickness: 0.14, swingDirection: 'both', swingAngle: 90, materialId: 'mat-carbon-steel', frameColor: '#334155', lockType: 'None', accessControl: 'none', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-28', floorId: 'fl-b1', wallId: 'rm-b1-analytical-w3', kind: 'door', subtype: 'cleanroom-door', name: 'QC Analytical Chemistry Lab Entry', offsetRatio: 0.2, width: 1.35, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#2563EB', lockType: 'Badge', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-29', floorId: 'fl-b1', wallId: 'rm-b1-micro-w3', kind: 'door', subtype: 'airlock-door', name: 'QC Microbiology Sterility Airlock Door', offsetRatio: 0.45, width: 1.3, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#0D9488', lockType: 'Interlock', accessControl: 'interlock', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-30', floorId: 'fl-b1', wallId: 'rm-b1-sample-w3', kind: 'door', subtype: 'single-door', name: 'Sample Receiving Entry Door', offsetRatio: 0.5, width: 1.25, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#334155', lockType: 'Badge', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-31', floorId: 'fl-b1', wallId: 'rm-b1-stability-w1', kind: 'door', subtype: 'cleanroom-door', name: 'ICH Stability Chamber Room Entry', offsetRatio: 0.48, width: 1.35, height: 2.25, sillHeight: 0, thickness: 0.14, swingDirection: 'right', swingAngle: 90, materialId: 'mat-cleanroom-panel', frameColor: '#2563EB', lockType: 'Badge', accessControl: 'badge', fireRating: '60 min', status: 'closed', layerId: 'layer-openings' },
    { id: 'op-32', floorId: 'fl-b1', wallId: 'rm-b1-rd-w1', kind: 'door', subtype: 'glass-door', name: 'Bioprocess R&D Lab Glass Entry', offsetRatio: 0.32, width: 1.35, height: 2.3, sillHeight: 0, thickness: 0.08, swingDirection: 'right', swingAngle: 90, materialId: 'mat-glass-cleanroom', frameColor: '#1E293B', lockType: 'Badge', accessControl: 'badge', fireRating: 'None', status: 'closed', layerId: 'layer-openings' },
  ];

  // Guarantee zero isolated rooms even if custom rooms are later appended
  const verifiedOpenings = ensureDoorsForAllRooms(allRooms, walls, openings);

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
    makeAsset('ast-pbx-1', 'fl-a0', 'rm-a0-mal', 'eq-pass-box', 'Dynamic HEPA Pass Box PB-101 (MAL → Corridor)', 'PB-101', 17.8, 14.3, 0),
    makeAsset('ast-pbx-2', 'fl-a0', 'rm-a0-filling', 'eq-pass-box', 'Aseptic Interlocked Pass Box PB-102 (Grade B → C)', 'PB-102', 24.8, 9.2, Math.PI),

    makeAsset('ast-pck-1', 'fl-a0', 'rm-a0-pack', 'eq-inspection-machine', 'Automated Vision Inspector VI-400', 'VI-501', 26.2, 16.6, 0),
    makeAsset('ast-pck-2', 'fl-a0', 'rm-a0-pack', 'eq-packaging-line', 'Serialized Cartoning Line BEC-300', 'PKG-502', 31.2, 17.4, 0),
    makeAsset('ast-saf-1', 'fl-a0', 'rm-a0-corridor', 'eq-fire-ext', 'Emergency Shower & Fire Station', 'SAF-A01', 2.4, 11.6, 0),
    makeAsset('ast-fbx-1', 'fl-a0', 'rm-a0-corridor', 'eq-firebox', 'Corridor West Fire Hose Firebox FB-A01', 'FB-A01', 12.2, 10.35, 0),
    makeAsset('ast-fbx-2', 'fl-a0', 'rm-a0-corridor', 'eq-firebox', 'Corridor East Fire Hose Firebox FB-A02', 'FB-A02', 28.6, 10.35, 0),
    makeAsset('ast-fex-1', 'fl-a0', 'rm-a0-upstream', 'eq-fire-extinguisher', 'CO2 Cleanroom Fire Extinguisher FE-A01', 'FE-A01', 1.7, 9.2, 0),
    makeAsset('ast-fex-2', 'fl-a0', 'rm-a0-pack', 'eq-fire-extinguisher', 'Packaging Bay CO2 Extinguisher FE-A02', 'FE-A02', 34.1, 14.3, Math.PI),

    // Building A · Level 1 (Utilities & QA)
    makeAsset('ast-ahu-1', 'fl-a1', 'rm-a1-hvac', 'eq-ahu', 'Cleanroom AHU-01 (Upstream/Downstream)', 'AHU-01', 5.0, 4.2, 0),
    makeAsset('ast-ahu-2', 'fl-a1', 'rm-a1-hvac', 'eq-ahu', 'Aseptic Suite AHU-02 (Grade A/B)', 'AHU-02', 11.4, 4.2, 0),
    makeAsset('ast-chl-1', 'fl-a1', 'rm-a1-hvac', 'eq-chiller', 'Glycol Process Chiller CH-01', 'CH-01', 8.2, 8.2, 0, { operationalStatus: 'maintenance-due' }),
    makeAsset('ast-wfi-1', 'fl-a1', 'rm-a1-wfi', 'eq-wfi-skid', 'Multi-Effect WFI Still', 'WFI-01', 19.2, 4.4, 0),
    makeAsset('ast-wfi-2', 'fl-a1', 'rm-a1-wfi', 'eq-water-tank', '5000L 80°C WFI Storage Tank', 'WFI-T01', 23.6, 4.6, 0),
    makeAsset('ast-wfi-3', 'fl-a1', 'rm-a1-wfi', 'eq-ro-unit', 'Purified Water RO/EDI Skid', 'PW-01', 21.4, 8.4, 0),
    makeAsset('ast-elc-1', 'fl-a1', 'rm-a1-elec', 'eq-electrical-panel', 'Main GMP Switchgear MCC-1', 'MCC-01', 29.5, 3.8, 0),
    makeAsset('ast-elc-2', 'fl-a1', 'rm-a1-elec', 'eq-ups', '250 kVA Critical Load UPS', 'UPS-01', 32.6, 7.6, 0),
    makeAsset('ast-it-rack-1', 'fl-a1', 'rm-a1-control', 'eq-server-rack-42u', 'Core Data Center 42U Rack DC-01 (MDF)', 'DC-R01', 2.4, 18.6, 0, {
      rackConfig: {
        totalUnits: 42,
        rackRole: 'core-dc',
        locationZone: 'Bldg A · Level 1 · SCADA & Data Center MDF',
        maxPowerKw: 12,
        coolingZone: 'Cold Aisle A1',
        subnetCidr: '10.42.10.0/24',
        devices: [
          {
            id: 'dev-sw-1',
            name: 'Core OT Switch Nexus-9336 (Core-01)',
            kind: 'switch',
            tier: 'core',
            uStart: 40,
            uHeight: 2,
            powerW: 650,
            ipAddress: '10.42.10.1',
            macAddress: '00:1A:2B:93:36:01',
            serialNumber: 'FDO2541CORE01',
            vlan: 'VLAN-10-OT',
            vendor: 'Cisco',
            model: 'Nexus 9336C-FX2',
            status: 'online',
            cpuPct: 24,
            memPct: 38,
            tempC: 38,
            uptimeLabel: '21d 38m',
            ports: [
              { id: 'p-1', label: 'Eth1/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-10-OT', status: 'up', isUplink: true, utilizationPct: 41, crcErrors: 0, opticalDbm: -2.4, connectedToLabel: 'PA-3420 FW' },
              { id: 'p-2', label: 'Eth1/2', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up', utilizationPct: 58, crcErrors: 0, opticalDbm: -2.9, connectedToLabel: 'PVE-GMP-01' },
              { id: 'p-3', label: 'Eth1/3', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-30-EMS', status: 'up', utilizationPct: 33, crcErrors: 0, connectedToLabel: 'EMS Cluster 02' },
              { id: 'p-4', label: 'Eth1/4', kind: 'QSFP28', speedGbps: 100, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true, utilizationPct: 47, crcErrors: 0, opticalDbm: -1.8, connectedToLabel: 'IDF-A0 Dist-SW' },
              { id: 'p-5', label: 'Eth1/5', kind: 'QSFP28', speedGbps: 40, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true, utilizationPct: 39, crcErrors: 2, opticalDbm: -3.1, connectedToLabel: 'IDF-B1 Lab Dist-SW' },
              { id: 'p-6', label: 'Eth1/6', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true, utilizationPct: 29, crcErrors: 0, opticalDbm: -2.6, connectedToLabel: 'NET-R01 Patch Dist' },
              { id: 'p-7', label: 'Eth1/7', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-30-EMS', status: 'up', utilizationPct: 44, crcErrors: 0, opticalDbm: -2.2, connectedToLabel: 'GMP Vault NAS' },
              { id: 'p-8', label: 'Eth1/8', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up', utilizationPct: 6, crcErrors: 0, connectedToLabel: 'UPS-6K NMC' },
            ],
          },
          {
            id: 'dev-fw-1',
            name: 'GMP DMZ Industrial Firewall',
            kind: 'firewall',
            tier: 'security',
            uStart: 38,
            uHeight: 2,
            powerW: 420,
            ipAddress: '10.42.10.254',
            macAddress: '00:1B:17:34:20:FE',
            serialNumber: 'PA3420GMP991',
            vlan: 'VLAN-99-DMZ',
            vendor: 'Palo Alto',
            model: 'PA-3420',
            status: 'online',
            cpuPct: 12,
            memPct: 28,
            tempC: 41,
            uptimeLabel: '48d 14h',
            ports: [
              { id: 'fw-1', label: 'Mgmt', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up', utilizationPct: 12, crcErrors: 0, connectedToLabel: 'Wireguard VPN' },
              { id: 'fw-2', label: 'OT-Core', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-10-OT', status: 'up', isUplink: true, utilizationPct: 41, crcErrors: 0, opticalDbm: -2.5, connectedToLabel: 'Nexus Core-01' },
              { id: 'fw-3', label: 'ISP-WAN', kind: 'RJ45', speedGbps: 2.5, vlan: 'VLAN-99-DMZ', status: 'up', isUplink: true, utilizationPct: 24, crcErrors: 0, connectedToLabel: 'Cloudflare Tunnel' },
              { id: 'fw-4', label: 'DMZ-HA', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-DMZ', status: 'standby', utilizationPct: 3, crcErrors: 0, connectedToLabel: 'HA Peer' },
            ],
          },
          {
            id: 'dev-srv-1',
            name: 'pve-gmp-01 · Proxmox VE Cluster',
            kind: 'server',
            tier: 'compute',
            uStart: 30,
            uHeight: 2,
            powerW: 850,
            ipAddress: '10.42.10.21',
            macAddress: 'D4:BE:D9:76:00:21',
            serialNumber: 'DL760HIST001',
            vlan: 'VLAN-20-SCADA',
            vendor: 'Dell EMC',
            model: 'PowerEdge R760',
            status: 'online',
            cpuPct: 44,
            memPct: 62,
            tempC: 45,
            uptimeLabel: '41d 6h',
            hypervisorVersion: 'Proxmox VE 9.2.24',
            workloads: [
              { id: 'wl-101', vmid: 'VM 101', name: 'mes-batch-prod', kind: 'VM', hostTag: 'GMP-OT', status: 'up', cpuPct: 46, memPct: 68 },
              { id: 'wl-102', vmid: 'VM 102', name: 'scada-historian', kind: 'VM', hostTag: 'SCADA', status: 'up', cpuPct: 54, memPct: 74 },
              { id: 'wl-103', vmid: 'CT 103', name: 'lims-empower', kind: 'CT', hostTag: 'QC-Lab', status: 'up', cpuPct: 28, memPct: 49 },
              { id: 'wl-104', vmid: 'VM 104', name: 'qms-part11-vault', kind: 'VM', hostTag: 'QA-GXP', status: 'up', cpuPct: 32, memPct: 61 },
              { id: 'wl-105', vmid: 'CT 105', name: 'opc-ua-broker', kind: 'CT', hostTag: 'SCADA', status: 'up', cpuPct: 19, memPct: 34 },
              { id: 'wl-106', vmid: 'CT 106', name: 'staging-mirror', kind: 'CT', hostTag: 'DR-Lab', status: 'stopped', cpuPct: 0, memPct: 0 },
            ],
            ports: [
              { id: 's1-1', label: 'NIC1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up', utilizationPct: 58, crcErrors: 0 },
              { id: 's1-2', label: 'iDRAC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up', utilizationPct: 4, crcErrors: 0 },
            ],
          },
          {
            id: 'dev-nas-1',
            name: 'GMP Vault NAS · DXP4800',
            kind: 'storage',
            tier: 'compute',
            uStart: 25,
            uHeight: 2,
            powerW: 340,
            ipAddress: '10.42.10.30',
            macAddress: 'A8:A1:59:48:00:30',
            serialNumber: 'UGDXP4800GMP1',
            vlan: 'VLAN-30-EMS',
            vendor: 'UGREEN / TrueNAS',
            model: 'DXP4800 Enterprise',
            status: 'online',
            cpuPct: 10,
            memPct: 34,
            diskPct: 73,
            tempC: 39,
            uptimeLabel: '64d 11h',
            driveBays: [
              { id: 'bay-1', slot: 1, label: 'NVMe-01', capacityLabel: '3.6 TiB', tempC: 42, health: 'healthy', usedPct: 74 },
              { id: 'bay-2', slot: 2, label: 'NVMe-02', capacityLabel: '3.6 TiB', tempC: 38, health: 'healthy', usedPct: 71 },
              { id: 'bay-3', slot: 3, label: 'NVMe-03', capacityLabel: '3.6 TiB', tempC: 41, health: 'healthy', usedPct: 75 },
              { id: 'bay-4', slot: 4, label: 'NVMe-04', capacityLabel: '3.6 TiB', tempC: 37, health: 'healthy', usedPct: 72 },
            ],
            ports: [
              { id: 'nas-1', label: '10G-ETH0', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-30-EMS', status: 'up', utilizationPct: 44, crcErrors: 0, connectedToLabel: 'Nexus Eth1/7' },
              { id: 'nas-2', label: '2.5G-MGMT', kind: 'RJ45', speedGbps: 2.5, vlan: 'VLAN-99-MGMT', status: 'up', utilizationPct: 11, crcErrors: 0 },
            ],
          },
          {
            id: 'dev-srv-2',
            name: 'EMS GMP Telemetry Cluster 02',
            kind: 'server',
            tier: 'compute',
            uStart: 28,
            uHeight: 2,
            powerW: 780,
            ipAddress: '10.42.10.22',
            macAddress: 'D4:BE:D9:76:00:22',
            serialNumber: 'DL760EMS002',
            vlan: 'VLAN-30-EMS',
            vendor: 'Dell EMC',
            model: 'PowerEdge R760',
            status: 'online',
            cpuPct: 48,
            memPct: 52,
            tempC: 43,
            uptimeLabel: '33d 9h',
            ports: [
              { id: 's2-1', label: 'NIC1', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-30-EMS', status: 'up', utilizationPct: 33, crcErrors: 0 },
            ],
          },
          {
            id: 'dev-ups-1',
            name: 'Rack Dual-Conversion UPS 6kVA',
            kind: 'ups',
            tier: 'power',
            uStart: 1,
            uHeight: 4,
            powerW: 320,
            ipAddress: '10.42.10.90',
            macAddress: '00:C0:B7:6K:00:90',
            serialNumber: 'APC6KRM9001',
            vlan: 'VLAN-99-MGMT',
            vendor: 'APC',
            model: 'Smart-UPS SRT6KRM',
            status: 'online',
            cpuPct: 11,
            memPct: 19,
            tempC: 31,
            uptimeLabel: '182d 4h',
            ports: [
              { id: 'u1-1', label: 'NMC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up', utilizationPct: 2, crcErrors: 0 },
            ],
          },
        ],
        cables: [
          { id: 'cab-1', fromDeviceId: 'dev-sw-1', fromPortId: 'p-1', toDeviceId: 'dev-fw-1', toPortId: 'fw-2', media: 'OM4 Fiber', vlan: 'VLAN-10-OT', color: '#06B6D4', label: 'OT-CORE-UPLINK' },
          { id: 'cab-2', fromDeviceId: 'dev-sw-1', fromPortId: 'p-2', toDeviceId: 'dev-srv-1', toPortId: 's1-1', media: 'DAC Twinax', vlan: 'VLAN-20-SCADA', color: '#8B5CF6', label: 'MES-HIST-10G' },
          { id: 'cab-3', fromDeviceId: 'dev-sw-1', fromPortId: 'p-3', toDeviceId: 'dev-srv-2', toPortId: 's2-1', media: 'Cat6A', vlan: 'VLAN-30-EMS', color: '#F59E0B', label: 'EMS-GMP-LINK' },
          { id: 'cab-4', fromDeviceId: 'dev-sw-1', fromPortId: 'p-7', toDeviceId: 'dev-nas-1', toPortId: 'nas-1', media: 'OM4 Fiber', vlan: 'VLAN-30-EMS', color: '#10B981', label: 'NAS-VAULT-10G' },
          { id: 'cab-5', fromDeviceId: 'dev-sw-1', fromPortId: 'p-8', toDeviceId: 'dev-ups-1', toPortId: 'u1-1', media: 'Cat6A', vlan: 'VLAN-99-MGMT', color: '#64748B', label: 'UPS-NMC-1G' },
        ],
      },
    }),
    makeAsset('ast-it-net-1', 'fl-a1', 'rm-a1-control', 'eq-network-rack-42u', 'Bldg A Level 1 Distribution Rack NET-01 (IDF-A1)', 'NET-R01', 4.1, 18.6, 0, {
      rackConfig: {
        totalUnits: 42,
        rackRole: 'distribution-idf',
        locationZone: 'Bldg A · Level 1 · QA & Control Wing',
        maxPowerKw: 8,
        coolingZone: 'Cold Aisle A1',
        subnetCidr: '10.42.11.0/24',
        devices: [
          {
            id: 'dev-dist-a1',
            name: 'Bldg A-L1 Distribution Switch C9300-24S',
            kind: 'switch',
            tier: 'distribution',
            uStart: 40,
            uHeight: 1,
            powerW: 360,
            ipAddress: '10.42.11.1',
            macAddress: '70:DB:98:A1:10:01',
            serialNumber: 'FCW2541DISTA1',
            vlan: 'VLAN-11-QA',
            vendor: 'Cisco',
            model: 'Catalyst 9300-24S',
            status: 'online',
            cpuPct: 22,
            tempC: 36,
            ports: [
              { id: 'da1-up1', label: 'Te1/1/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true, utilizationPct: 29, crcErrors: 0, opticalDbm: -2.6, connectedToLabel: 'DC-R01 Core Eth1/6' },
              { id: 'da1-dn1', label: 'Te1/0/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-11-QA', status: 'up', isUplink: true, utilizationPct: 34, crcErrors: 0, opticalDbm: -2.1, connectedToLabel: 'SW-2960-A1 Te1/0/1' },
              { id: 'da1-dn2', label: 'Gi1/0/2', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-20-SCADA', status: 'up', utilizationPct: 18, crcErrors: 0 },
            ],
          },
          {
            id: 'dev-acc-2960-a1',
            name: 'Access Switch Cisco 2960-X (A1-QA/SCADA)',
            kind: 'switch',
            tier: 'access',
            uStart: 37,
            uHeight: 1,
            powerW: 240,
            ipAddress: '10.42.11.10',
            macAddress: 'C8:00:84:29:60:A1',
            serialNumber: 'FOC2419C2960A1',
            vlan: 'VLAN-11-QA',
            vendor: 'Cisco',
            model: 'Catalyst 2960-X 48FPS-L',
            status: 'online',
            cpuPct: 19,
            tempC: 34,
            ports: [
              { id: 'a1-gi1', label: 'Gi1/0/1', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-11-QA', status: 'up', poeWatts: 12.4, utilizationPct: 28, crcErrors: 0, connectedToLabel: 'QA-WS-01' },
              { id: 'a1-gi2', label: 'Gi1/0/2', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-11-QA', status: 'up', poeWatts: 8.2, utilizationPct: 21, crcErrors: 0, connectedToLabel: 'QA-VAL-02' },
              { id: 'a1-gi3', label: 'Gi1/0/3', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-20-SCADA', status: 'up', poeWatts: 15.0, utilizationPct: 44, crcErrors: 0, connectedToLabel: 'SCADA-OP-01' },
              { id: 'a1-gi4', label: 'Gi1/0/4', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-50-WIFI', status: 'up', poeWatts: 22.5, utilizationPct: 52, crcErrors: 0, connectedToLabel: 'AP-A1-AUDIT' },
              { id: 'a1-te1', label: 'Te1/0/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true, utilizationPct: 34, crcErrors: 0, opticalDbm: -2.2, connectedToLabel: 'Dist C9300 Te1/0/1' },
            ],
          },
          {
            id: 'dev-pp-a1',
            name: '24-Port OM4 Fiber & Cat6A Patch Panel',
            kind: 'patch-panel',
            tier: 'access',
            uStart: 35,
            uHeight: 1,
            powerW: 0,
            ipAddress: 'Passive',
            vlan: 'TRUNK',
            vendor: 'Panduit',
            model: 'Opticom 24-LC / Cat6A',
            status: 'online',
            ports: [
              { id: 'ppa1-1', label: 'LC-01', kind: 'Fiber-LC', speedGbps: 10, vlan: 'VLAN-99-UPLINK', status: 'up' },
              { id: 'ppa1-2', label: 'RJ-01', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-11-QA', status: 'up' },
            ],
          },
        ],
        cables: [
          { id: 'cab-a1-1', fromDeviceId: 'dev-acc-2960-a1', fromPortId: 'a1-te1', toDeviceId: 'dev-dist-a1', toPortId: 'da1-dn1', media: 'OM4 Fiber', vlan: 'VLAN-99-UPLINK', color: '#06B6D4', label: '2960-TO-DIST-10G' },
        ],
      },
    }),
    // Floor Distribution Rack (IDF) on Building A Ground Floor (GMP Production)
    makeAsset('ast-idf-a0', 'fl-a0', 'rm-a0-corridor', 'eq-network-rack-42u', 'Bldg A Ground Floor IDF Distribution Rack (IDF-A0)', 'IDF-A0-01', 33.8, 10.6, 0, {
      rackConfig: {
        totalUnits: 24,
        rackRole: 'distribution-idf',
        locationZone: 'Bldg A · Ground Floor · Cleanroom Corridor East',
        maxPowerKw: 6,
        coolingZone: 'Grade C Corridor',
        subnetCidr: '10.42.20.0/24',
        devices: [
          {
            id: 'dev-dist-a0',
            name: 'Bldg A-L0 Distribution Switch C9300X',
            kind: 'switch',
            tier: 'distribution',
            uStart: 22,
            uHeight: 1,
            powerW: 390,
            ipAddress: '10.42.20.1',
            macAddress: '70:DB:98:A0:20:01',
            serialNumber: 'FCW2541DISTA0',
            vlan: 'VLAN-10-OT',
            vendor: 'Cisco',
            model: 'Catalyst 9300X-24Y',
            status: 'online',
            cpuPct: 28,
            tempC: 37,
            ports: [
              { id: 'da0-up1', label: 'Hu1/1/1', kind: 'QSFP28', speedGbps: 100, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true, utilizationPct: 47, crcErrors: 0, opticalDbm: -1.9, connectedToLabel: 'DC-R01 Core Eth1/4' },
              { id: 'da0-dn1', label: 'Te1/0/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-10-OT', status: 'up', isUplink: true, utilizationPct: 42, crcErrors: 0, opticalDbm: -2.4, connectedToLabel: 'SW-2960-A0 Te1/0/1' },
            ],
          },
          {
            id: 'dev-acc-2960-a0',
            name: 'Access Switch Cisco 2960-X (Production HMI/CCTV)',
            kind: 'switch',
            tier: 'access',
            uStart: 19,
            uHeight: 1,
            powerW: 295,
            ipAddress: '10.42.20.10',
            macAddress: 'C8:00:84:29:60:A0',
            serialNumber: 'FOC2419C2960A0',
            vlan: 'VLAN-10-OT',
            vendor: 'Cisco',
            model: 'Catalyst 2960-X 48FPS-L',
            status: 'online',
            cpuPct: 35,
            tempC: 39,
            ports: [
              { id: 'a0-gi1', label: 'Gi1/0/1', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-10-OT', status: 'up', poeWatts: 18.4, utilizationPct: 36, crcErrors: 0, connectedToLabel: 'HMI-UP-01' },
              { id: 'a0-gi2', label: 'Gi1/0/2', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-10-OT', status: 'up', poeWatts: 19.2, utilizationPct: 49, crcErrors: 0, connectedToLabel: 'HMI-FILL-01' },
              { id: 'a0-gi3', label: 'Gi1/0/3', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-60-CCTV', status: 'up', poeWatts: 14.5, utilizationPct: 61, crcErrors: 3, connectedToLabel: 'CAM-UP-01' },
              { id: 'a0-gi4', label: 'Gi1/0/4', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-70-ACS', status: 'error', poeWatts: 6.2, utilizationPct: 88, crcErrors: 14, connectedToLabel: 'BADGE-PAL-01' },
              { id: 'a0-te1', label: 'Te1/0/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true, utilizationPct: 42, crcErrors: 0, opticalDbm: -2.4, connectedToLabel: 'Dist C9300X Te1/0/1' },
            ],
          },
        ],
        cables: [
          { id: 'cab-a0-1', fromDeviceId: 'dev-acc-2960-a0', fromPortId: 'a0-te1', toDeviceId: 'dev-dist-a0', toPortId: 'da0-dn1', media: 'OM4 Fiber', vlan: 'VLAN-99-UPLINK', color: '#06B6D4', label: 'A0-2960-DIST-10G' },
        ],
      },
    }),
    // Floor Distribution Rack (IDF) on Building B Level 1 (QC Labs)
    makeAsset('ast-idf-b1', 'fl-b1', 'rm-b1-sample', 'eq-network-rack-42u', 'Bldg B QC Labs IDF Distribution Rack (IDF-B1)', 'IDF-B1-01', 29.6, 8.6, 0, {
      rackConfig: {
        totalUnits: 24,
        rackRole: 'distribution-idf',
        locationZone: 'Bldg B · Level 1 · QC Sample & Lab Core',
        maxPowerKw: 6,
        coolingZone: 'Lab HVAC Zone B1',
        subnetCidr: '10.42.31.0/24',
        devices: [
          {
            id: 'dev-dist-b1',
            name: 'Bldg B-L1 Lab Distribution Switch C9300',
            kind: 'switch',
            tier: 'distribution',
            uStart: 22,
            uHeight: 1,
            powerW: 340,
            ipAddress: '10.42.31.1',
            macAddress: '70:DB:98:B1:31:01',
            serialNumber: 'FCW2541DISTB1',
            vlan: 'VLAN-31-LAB',
            vendor: 'Cisco',
            model: 'Catalyst 9300-24S',
            status: 'warning',
            cpuPct: 41,
            tempC: 44,
            ports: [
              { id: 'db1-up1', label: 'Fo1/1/1', kind: 'QSFP28', speedGbps: 40, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true, utilizationPct: 39, crcErrors: 2, opticalDbm: -3.2, connectedToLabel: 'DC-R01 Core Eth1/5' },
              { id: 'db1-dn1', label: 'Te1/0/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-31-LAB', status: 'up', isUplink: true, utilizationPct: 54, crcErrors: 1, opticalDbm: -2.8, connectedToLabel: 'SW-2960-B1 Te1/0/1' },
            ],
          },
          {
            id: 'dev-acc-2960-b1',
            name: 'Access Switch Cisco 2960-X (HPLC/LIMS Lab)',
            kind: 'switch',
            tier: 'access',
            uStart: 19,
            uHeight: 1,
            powerW: 265,
            ipAddress: '10.42.31.10',
            macAddress: 'C8:00:84:29:60:B1',
            serialNumber: 'FOC2419C2960B1',
            vlan: 'VLAN-31-LAB',
            vendor: 'Cisco',
            model: 'Catalyst 2960-X 48FPS-L',
            status: 'online',
            cpuPct: 26,
            tempC: 35,
            ports: [
              { id: 'b1-gi1', label: 'Gi1/0/1', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-31-LAB', status: 'up', poeWatts: 0, utilizationPct: 64, crcErrors: 0, connectedToLabel: 'HPLC-DROP-01' },
              { id: 'b1-gi2', label: 'Gi1/0/2', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-31-LAB', status: 'up', poeWatts: 0, utilizationPct: 58, crcErrors: 0, connectedToLabel: 'LCMS-DROP-01' },
              { id: 'b1-gi3', label: 'Gi1/0/3', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-31-LAB', status: 'up', poeWatts: 11.4, utilizationPct: 29, crcErrors: 0, connectedToLabel: 'LIMS-WS-RD1' },
              { id: 'b1-te1', label: 'Te1/0/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true, utilizationPct: 54, crcErrors: 1, opticalDbm: -2.8, connectedToLabel: 'Dist C9300 Te1/0/1' },
            ],
          },
        ],
        cables: [
          { id: 'cab-b1-1', fromDeviceId: 'dev-acc-2960-b1', fromPortId: 'b1-te1', toDeviceId: 'dev-dist-b1', toPortId: 'db1-dn1', media: 'OM4 Fiber', vlan: 'VLAN-99-UPLINK', color: '#06B6D4', label: 'B1-2960-DIST-10G' },
        ],
      },
    }),
    makeAsset('ast-fbx-a1', 'fl-a1', 'rm-a1-elec', 'eq-firebox', 'Electrical Switchgear Firebox FB-A10', 'FB-A10', 27.6, 10.4, Math.PI),
    makeAsset('ast-fex-a1', 'fl-a1', 'rm-a1-control', 'eq-fire-extinguisher', 'Data Center CO2 Extinguisher FE-A11', 'FE-A11', 1.6, 13.0, 0),
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
    makeAsset('ast-wh-5', 'fl-b0', 'rm-b0-cold', 'eq-pallet-rack', 'Cold Chain Rack 2–8°C Row 1', 'CLD-R1', 18.2, 3.4, 0),
    makeAsset('ast-wh-6', 'fl-b0', 'rm-b0-cold', 'eq-cold-room-unit', 'Modular Walk-In Cold Room Chamber (2–8 °C)', 'CR-B01', 21.8, 8.8, Math.PI),
    makeAsset('ast-wh-7', 'fl-b0', 'rm-b0-cold', 'eq-sensor-env', 'Cold Storage Mapped Sensor', 'EMS-B0-02', 23.8, 3.6, 0),
    makeAsset('ast-wh-8', 'fl-b0', 'rm-b0-quarantine', 'eq-pallet-rack', 'Quarantine Hold Rack Q1', 'QRN-R1', 28.0, 5.5, Math.PI / 2),
    makeAsset('ast-wh-9', 'fl-b0', 'rm-b0-dock', 'eq-conveyor', 'Inbound Receiving Conveyor', 'CNV-01', 6.0, 15.2, 0),
    makeAsset('ast-wh-10', 'fl-b0', 'rm-b0-dock', 'eq-weighing-station', 'Inbound Pallet Scale', 'SCL-01', 12.2, 15.4, 0),
    makeAsset('ast-wh-11', 'fl-b0', 'rm-b0-dispatch', 'eq-packing-station', 'Thermal Shipper Pack Station', 'PCK-B1', 21.8, 15.4, 0),
    makeAsset('ast-wh-12', 'fl-b0', 'rm-b0-dispatch', 'eq-pallet', 'Validated Cold-Pack Pallet', 'PLT-B9', 27.2, 15.5, 0),
    makeAsset('ast-fbx-b0', 'fl-b0', 'rm-b0-dock', 'eq-firebox', 'Loading Dock Fire Hose Firebox FB-B01', 'FB-B01', 1.8, 12.6, 0),
    makeAsset('ast-fex-b0', 'fl-b0', 'rm-b0-raw', 'eq-fire-extinguisher', 'Warehouse ABC Fire Extinguisher FE-B01', 'FE-B01', 13.8, 11.2, Math.PI),

    // Building B · Level 1 (QC Labs)
    makeAsset('ast-qc-1', 'fl-b1', 'rm-b1-analytical', 'eq-hplc', 'Waters ACQUITY UHPLC #1', 'HPLC-01', 4.0, 3.2, 0),
    makeAsset('ast-qc-2', 'fl-b1', 'rm-b1-analytical', 'eq-hplc', 'Waters ACQUITY UHPLC #2', 'HPLC-02', 7.2, 3.2, 0),
    makeAsset('ast-qc-3', 'fl-b1', 'rm-b1-analytical', 'eq-lcms', 'Agilent LC-MS/MS Characterization', 'LCMS-01', 11.4, 3.4, 0),
    makeAsset('ast-qc-4', 'fl-b1', 'rm-b1-analytical', 'eq-lab-bench', 'Analytical Sample Prep Island', 'BNC-01', 6.2, 7.6, 0),
    makeAsset('ast-qc-5', 'fl-b1', 'rm-b1-analytical', 'eq-fume-hood', 'Solvent Extraction Fume Hood', 'FH-01', 12.2, 8.2, Math.PI),
    makeAsset('ast-qc-6', 'fl-b1', 'rm-b1-micro', 'eq-biosafety-cab', 'Class II A2 Biosafety Cabinet #1', 'BSC-01', 18.0, 3.2, 0),
    makeAsset('ast-qc-7', 'fl-b1', 'rm-b1-micro', 'eq-isolator', 'Sterility Testing Isolator', 'ISO-01', 22.8, 3.8, 0),
    makeAsset('ast-qc-8', 'fl-b1', 'rm-b1-micro', 'eq-incubator', 'CO2 Bioburden Incubator Stack', 'INC-01', 18.0, 8.0, 0),
    makeAsset('ast-qc-pbx', 'fl-b1', 'rm-b1-micro', 'eq-pass-box', 'QC Micro Sample Transfer Pass Box PB-B1', 'PB-B01', 25.0, 8.4, -Math.PI / 2),
    makeAsset('ast-qc-9', 'fl-b1', 'rm-b1-sample', 'eq-lab-fridge', 'QC Sample Refrigerator (2–8°C)', 'FRG-01', 28.4, 4.2, 0),
    makeAsset('ast-qc-10', 'fl-b1', 'rm-b1-stability', 'eq-stability-chamber', 'ICH Stability Chamber 25°C/60%RH', 'STB-01', 4.2, 14.8, 0),
    makeAsset('ast-qc-11', 'fl-b1', 'rm-b1-stability', 'eq-stability-chamber', 'ICH Accelerated Chamber 40°C/75%RH', 'STB-02', 8.2, 14.8, 0),
    makeAsset('ast-qc-12', 'fl-b1', 'rm-b1-stability', 'eq-ul-freezer', 'Master Cell Bank -80°C Freezer', 'ULT-01', 11.8, 15.0, 0),
    makeAsset('ast-qc-13', 'fl-b1', 'rm-b1-rd', 'eq-lab-bench', 'Bioprocess R&D Bench A', 'RD-B01', 19.0, 15.0, 0),
    makeAsset('ast-qc-14', 'fl-b1', 'rm-b1-rd', 'eq-pcr', 'qPCR Residual DNA Analyzer', 'PCR-01', 25.5, 14.8, 0),
    makeAsset('ast-qc-fex', 'fl-b1', 'rm-b1-analytical', 'eq-fire-extinguisher', 'Analytical Lab CO2 Extinguisher FE-B11', 'FE-B11', 1.7, 9.8, 0),
    // Additional models ensuring every room across all floors has rich 3D equipment
    makeAsset('ast-cnf-2', 'fl-a1', 'rm-a1-conf', 'eq-scada-console', 'Audit Review Presentation Console', 'CNF-02', 25.6, 19.2, Math.PI / 2),
    makeAsset('ast-wh-8b', 'fl-b0', 'rm-b0-quarantine', 'eq-weighing-station', 'QA Quarantine Sampling Scale', 'QRN-SCL1', 27.6, 9.4, 0),
    makeAsset('ast-qc-9b', 'fl-b1', 'rm-b1-sample', 'eq-lab-bench', 'Sample Login & Barcode Intake Bench', 'SMP-B01', 28.2, 7.6, 0),
  ].map((a) => enrichAssetHistory(a));

  const cameras: SceneCamera[] = [
    {
      id: 'cam-1',
      floorId: 'fl-a0',
      roomId: 'rm-a0-upstream',
      name: 'Upstream Bioreactor Bay CCTV (A0-101)',
      kind: 'security',
      group: 'GMP Production CCTV',
      position: [1.8, 3.3, 1.8],
      target: [7.6, 1.4, 5.6],
      fov: 68,
      focalLengthMm: 24,
      coverageRadius: 11,
      visibleCone: true,
      layerId: 'layer-cameras',
      ipAddress: '10.42.20.101',
      port: 554,
      protocol: 'RTSP',
      streamPath: '/h265/ch01/main/av_stream',
      username: 'gmp_cctv_op',
      hasCredentials: true,
      resolution: '2560×1440',
      fps: 30,
      nightVision: true,
      status: 'recording',
    },
    {
      id: 'cam-2',
      floorId: 'fl-a0',
      roomId: 'rm-a0-downstream',
      name: 'Downstream Chromatography Suite Cam (A0-102)',
      kind: 'inspection',
      group: 'GMP Production CCTV',
      position: [13.8, 3.2, 8.8],
      target: [19.2, 1.4, 4.4],
      fov: 62,
      focalLengthMm: 28,
      coverageRadius: 10,
      visibleCone: true,
      layerId: 'layer-cameras',
      ipAddress: '10.42.20.102',
      port: 554,
      protocol: 'RTSP',
      streamPath: '/h265/ch02/main',
      username: 'gmp_cctv_op',
      hasCredentials: true,
      resolution: '2560×1440',
      fps: 30,
      status: 'recording',
    },
    {
      id: 'cam-3',
      floorId: 'fl-a0',
      roomId: 'rm-a0-filling',
      name: 'Aseptic Filling & Lyo Isolator Cam (A0-103)',
      kind: 'inspection',
      group: 'Grade A/B Monitoring',
      position: [24.8, 3.1, 8.9],
      target: [29.4, 1.5, 4.6],
      fov: 56,
      focalLengthMm: 35,
      coverageRadius: 9,
      visibleCone: true,
      layerId: 'layer-cameras',
      ipAddress: '10.42.20.103',
      port: 554,
      protocol: 'ONVIF',
      streamPath: '/onvif/aseptic-01',
      username: 'gmp_cctv_op',
      hasCredentials: true,
      resolution: '3840×2160',
      fps: 30,
      status: 'recording',
    },
    {
      id: 'cam-4',
      floorId: 'fl-a0',
      roomId: 'rm-a0-corridor',
      name: 'Grade C Clean Corridor East Cam (A0-104)',
      kind: 'security',
      group: 'Corridor & Access',
      position: [3.2, 3.1, 11.7],
      target: [18.0, 1.5, 11.7],
      fov: 74,
      focalLengthMm: 21,
      coverageRadius: 14,
      visibleCone: true,
      layerId: 'layer-cameras',
      ipAddress: '10.42.20.104',
      port: 554,
      protocol: 'RTSP',
      streamPath: '/h265/ch04/main',
      resolution: '2560×1440',
      fps: 25,
      status: 'online',
    },
    {
      id: 'cam-5',
      floorId: 'fl-a1',
      roomId: 'rm-a1-control',
      name: 'SCADA & Data Center MDF Rack Cam (A1-204)',
      kind: 'security',
      group: 'IT & SCADA Security',
      position: [10.8, 3.2, 13.0],
      target: [3.6, 1.4, 17.8],
      fov: 66,
      focalLengthMm: 24,
      coverageRadius: 10,
      visibleCone: true,
      layerId: 'layer-cameras',
      ipAddress: '10.42.10.105',
      port: 554,
      protocol: 'RTSP',
      streamPath: '/h265/dc-mdf/main',
      username: 'ot_sec_admin',
      hasCredentials: true,
      resolution: '3840×2160',
      fps: 30,
      status: 'recording',
    },
    {
      id: 'cam-6',
      floorId: 'fl-a1',
      roomId: 'rm-a1-qa',
      name: 'QA Batch Review & Documentation Cam (A1-205)',
      kind: 'fixed-industrial',
      group: 'QA & Audit Suites',
      position: [12.8, 3.1, 12.8],
      target: [18.5, 1.2, 16.8],
      fov: 64,
      focalLengthMm: 24,
      coverageRadius: 9,
      visibleCone: true,
      layerId: 'layer-cameras',
      ipAddress: '10.42.11.106',
      port: 554,
      protocol: 'RTSP',
      streamPath: '/h265/qa-205/main',
      resolution: '2560×1440',
      fps: 30,
      status: 'online',
    },
    {
      id: 'cam-7',
      floorId: 'fl-b0',
      roomId: 'rm-b0-cold',
      name: 'Cold Storage 2–8°C Vault Cam (B0-102)',
      kind: 'security',
      group: 'GDP Warehouse CCTV',
      position: [16.0, 3.8, 2.0],
      target: [20.6, 1.5, 7.6],
      fov: 70,
      focalLengthMm: 24,
      coverageRadius: 11,
      visibleCone: true,
      layerId: 'layer-cameras',
      ipAddress: '10.42.30.107',
      port: 554,
      protocol: 'RTSP',
      streamPath: '/h265/cold-b0/main',
      resolution: '2560×1440',
      fps: 25,
      nightVision: true,
      status: 'recording',
    },
    {
      id: 'cam-8',
      floorId: 'fl-b1',
      roomId: 'rm-b1-analytical',
      name: 'QC Analytical HPLC/LC-MS Lab Cam (B1-201)',
      kind: 'inspection',
      group: 'Lab Viewpoints',
      position: [2.0, 3.1, 9.6],
      target: [8.2, 1.2, 4.4],
      fov: 66,
      focalLengthMm: 24,
      coverageRadius: 11,
      visibleCone: true,
      layerId: 'layer-cameras',
      ipAddress: '10.42.31.108',
      port: 554,
      protocol: 'RTSP',
      streamPath: '/h265/qc-b1/main',
      resolution: '3840×2160',
      fps: 30,
      status: 'recording',
    },
  ];

  const networkArchitecture: NetworkArchitectureState = {
    userNodes: [
      {
        id: 'un-qa-01',
        code: 'NODE-QA-01',
        name: 'QA Batch Release Workstation #1',
        nodeKind: 'workstation',
        floorId: 'fl-a1',
        roomId: 'rm-a1-qa',
        x: 15.4,
        z: 15.0,
        wallJackId: 'WJ-A1-205-01',
        ipAddress: '10.42.11.41',
        macAddress: '3C:7C:3F:A1:01:41',
        vlan: 'VLAN-11-QA',
        poeWatts: 12.4,
        connectedRackId: 'ast-it-net-1',
        connectedDeviceId: 'dev-acc-2960-a1',
        connectedPortId: 'a1-gi1',
        media: 'Cat6A',
        status: 'online',
        bandwidthMbps: 280,
        latencyMs: 1.2,
        packetLossPct: 0.0,
        crcErrors: 0,
        notes: 'Connected to Cisco 2960-X Gi1/0/1 in IDF-A1 → Core DC-R01.',
      },
      {
        id: 'un-qa-02',
        code: 'NODE-VAL-02',
        name: 'Validation Lead Workstation #2',
        nodeKind: 'workstation',
        floorId: 'fl-a1',
        roomId: 'rm-a1-qa',
        x: 19.8,
        z: 15.0,
        wallJackId: 'WJ-A1-205-02',
        ipAddress: '10.42.11.42',
        macAddress: '3C:7C:3F:A1:01:42',
        vlan: 'VLAN-11-QA',
        poeWatts: 8.2,
        connectedRackId: 'ast-it-net-1',
        connectedDeviceId: 'dev-acc-2960-a1',
        connectedPortId: 'a1-gi2',
        media: 'Cat6A',
        status: 'online',
        bandwidthMbps: 210,
        latencyMs: 1.4,
        packetLossPct: 0.0,
        crcErrors: 0,
      },
      {
        id: 'un-scada-01',
        code: 'NODE-SCADA-01',
        name: 'SCADA Operator Terminal #1',
        nodeKind: 'hmi-panel',
        floorId: 'fl-a1',
        roomId: 'rm-a1-control',
        x: 5.2,
        z: 15.2,
        wallJackId: 'WJ-A1-204-03',
        ipAddress: '10.42.20.51',
        macAddress: '3C:7C:3F:A1:04:51',
        vlan: 'VLAN-20-SCADA',
        poeWatts: 15.0,
        connectedRackId: 'ast-it-net-1',
        connectedDeviceId: 'dev-acc-2960-a1',
        connectedPortId: 'a1-gi3',
        media: 'PoE++ Cat6A',
        status: 'online',
        bandwidthMbps: 440,
        latencyMs: 0.9,
        packetLossPct: 0.0,
        crcErrors: 0,
      },
      {
        id: 'un-ap-a1',
        code: 'AP-A1-AUDIT',
        name: 'Cisco Catalyst 9136 Wi-Fi 6E AP (Audit)',
        nodeKind: 'wifi-ap',
        floorId: 'fl-a1',
        roomId: 'rm-a1-conf',
        x: 29.5,
        z: 16.5,
        wallJackId: 'WJ-A1-206-AP1',
        ipAddress: '10.42.50.14',
        macAddress: 'F4:CF:E2:91:36:14',
        vlan: 'VLAN-50-WIFI',
        poeWatts: 22.5,
        connectedRackId: 'ast-it-net-1',
        connectedDeviceId: 'dev-acc-2960-a1',
        connectedPortId: 'a1-gi4',
        media: 'PoE++ Cat6A',
        status: 'online',
        bandwidthMbps: 520,
        latencyMs: 2.1,
        packetLossPct: 0.01,
        crcErrors: 0,
      },
      {
        id: 'un-hmi-up',
        code: 'HMI-UP-01',
        name: 'Bioreactor BR-2001 Cleanroom HMI',
        nodeKind: 'hmi-panel',
        floorId: 'fl-a0',
        roomId: 'rm-a0-upstream',
        x: 5.6,
        z: 6.4,
        wallJackId: 'WJ-A0-101-01',
        ipAddress: '10.42.20.61',
        macAddress: '00:1B:1B:A0:01:61',
        vlan: 'VLAN-10-OT',
        poeWatts: 18.4,
        connectedRackId: 'ast-idf-a0',
        connectedDeviceId: 'dev-acc-2960-a0',
        connectedPortId: 'a0-gi1',
        media: 'PoE++ Cat6A',
        status: 'online',
        bandwidthMbps: 360,
        latencyMs: 1.1,
        packetLossPct: 0.0,
        crcErrors: 0,
      },
      {
        id: 'un-hmi-fil',
        code: 'HMI-FILL-01',
        name: 'Aseptic Filler ALF-5000 PLC Drop',
        nodeKind: 'hmi-panel',
        floorId: 'fl-a0',
        roomId: 'rm-a0-filling',
        x: 28.4,
        z: 6.2,
        wallJackId: 'WJ-A0-103-02',
        ipAddress: '10.42.20.62',
        macAddress: '00:1B:1B:A0:03:62',
        vlan: 'VLAN-10-OT',
        poeWatts: 19.2,
        connectedRackId: 'ast-idf-a0',
        connectedDeviceId: 'dev-acc-2960-a0',
        connectedPortId: 'a0-gi2',
        media: 'PoE++ Cat6A',
        status: 'online',
        bandwidthMbps: 490,
        latencyMs: 0.8,
        packetLossPct: 0.0,
        crcErrors: 0,
      },
      {
        id: 'un-badge-pal',
        code: 'BADGE-PAL-01',
        name: 'PAL Biometric Interlock Reader',
        nodeKind: 'badge-reader',
        floorId: 'fl-a0',
        roomId: 'rm-a0-pal',
        x: 14.0,
        z: 14.2,
        wallJackId: 'WJ-A0-106-04',
        ipAddress: '10.42.70.18',
        macAddress: 'A4:14:37:70:00:18',
        vlan: 'VLAN-70-ACS',
        poeWatts: 6.2,
        connectedRackId: 'ast-idf-a0',
        connectedDeviceId: 'dev-acc-2960-a0',
        connectedPortId: 'a0-gi4',
        media: 'Cat6A',
        status: 'error',
        bandwidthMbps: 48,
        latencyMs: 19.4,
        packetLossPct: 2.8,
        crcErrors: 14,
        notes: 'Intermittent CRC error burst detected on 2960-X Gi1/0/4 — inspect RJ45 termination.',
      },
      {
        id: 'un-hplc-01',
        code: 'HPLC-DROP-01',
        name: 'Waters UHPLC #1 Empower CDS Drop',
        nodeKind: 'hplc-drop',
        floorId: 'fl-b1',
        roomId: 'rm-b1-analytical',
        x: 4.0,
        z: 4.4,
        wallJackId: 'WJ-B1-201-01',
        ipAddress: '10.42.31.71',
        macAddress: '00:50:C2:B1:01:71',
        vlan: 'VLAN-31-LAB',
        poeWatts: 0,
        connectedRackId: 'ast-idf-b1',
        connectedDeviceId: 'dev-acc-2960-b1',
        connectedPortId: 'b1-gi1',
        media: 'Cat6A',
        status: 'online',
        bandwidthMbps: 640,
        latencyMs: 1.6,
        packetLossPct: 0.0,
        crcErrors: 0,
      },
      {
        id: 'un-lcms-01',
        code: 'LCMS-DROP-01',
        name: 'Agilent LC-MS/MS Data Acquisition Drop',
        nodeKind: 'hplc-drop',
        floorId: 'fl-b1',
        roomId: 'rm-b1-analytical',
        x: 11.4,
        z: 4.6,
        wallJackId: 'WJ-B1-201-02',
        ipAddress: '10.42.31.72',
        macAddress: '00:50:C2:B1:01:72',
        vlan: 'VLAN-31-LAB',
        poeWatts: 0,
        connectedRackId: 'ast-idf-b1',
        connectedDeviceId: 'dev-acc-2960-b1',
        connectedPortId: 'b1-gi2',
        media: 'Cat6A',
        status: 'online',
        bandwidthMbps: 580,
        latencyMs: 1.5,
        packetLossPct: 0.0,
        crcErrors: 0,
      },
    ],
    interRackLinks: [
      {
        id: 'irl-a0-core',
        label: 'TRUNK-IDF-A0 → DC-CORE-01 (100G OS2)',
        tier: 'dist-to-core',
        fromRackId: 'ast-idf-a0',
        fromDeviceId: 'dev-dist-a0',
        fromPortId: 'da0-up1',
        toRackId: 'ast-it-rack-1',
        toDeviceId: 'dev-sw-1',
        toPortId: 'p-4',
        media: 'OS2 Single-Mode',
        speedGbps: 100,
        vlanTrunk: 'VLAN 10,20,60,70,99',
        status: 'up',
        utilizationPct: 47,
        opticalRxDbm: -1.9,
        crcErrors: 0,
      },
      {
        id: 'irl-a1-core',
        label: 'TRUNK-IDF-A1 → DC-CORE-01 (10G OM4)',
        tier: 'dist-to-core',
        fromRackId: 'ast-it-net-1',
        fromDeviceId: 'dev-dist-a1',
        fromPortId: 'da1-up1',
        toRackId: 'ast-it-rack-1',
        toDeviceId: 'dev-sw-1',
        toPortId: 'p-6',
        media: 'OM4 Fiber',
        speedGbps: 10,
        vlanTrunk: 'VLAN 11,20,50,99',
        status: 'up',
        utilizationPct: 29,
        opticalRxDbm: -2.6,
        crcErrors: 0,
      },
      {
        id: 'irl-b1-core',
        label: 'TRUNK-IDF-B1 → DC-CORE-01 (40G OS2 Campus Fiber)',
        tier: 'dist-to-core',
        fromRackId: 'ast-idf-b1',
        fromDeviceId: 'dev-dist-b1',
        fromPortId: 'db1-up1',
        toRackId: 'ast-it-rack-1',
        toDeviceId: 'dev-sw-1',
        toPortId: 'p-5',
        media: 'OS2 Single-Mode',
        speedGbps: 40,
        vlanTrunk: 'VLAN 31,99',
        status: 'degraded',
        utilizationPct: 39,
        opticalRxDbm: -3.2,
        crcErrors: 2,
      },
    ],
    monitoringApis: [
      {
        id: 'mon-prom-1',
        name: 'Campus Prometheus SNMP Exporter',
        provider: 'Prometheus',
        endpointUrl: 'https://monitor.cinnagen.local:9090/api/v1/query',
        authType: 'bearer',
        pollIntervalSec: 15,
        enabled: true,
        lastStatus: 'connected',
        lastCheckedAt: 'Just now',
        mappedMetrics: ['ifHCInOctets', 'ifInErrors', 'poeWatts', 'opticalRxDbm'],
      },
      {
        id: 'mon-netbox-1',
        name: 'NetBox Enterprise DCIM Sync',
        provider: 'NetBox',
        endpointUrl: 'https://netbox.cinnagen.local/api/dcim/racks/',
        authType: 'api-key',
        pollIntervalSec: 60,
        enabled: false,
        lastStatus: 'idle',
        mappedMetrics: ['racks', 'devices', 'interfaces', 'cables', 'vlans'],
      },
      {
        id: 'mon-cisco-1',
        name: 'Cisco Catalyst Center / DNA Assurance',
        provider: 'Cisco Catalyst Center',
        endpointUrl: 'https://dnac.cinnagen.local/dna/intent/api/v1/network-device',
        authType: 'bearer',
        pollIntervalSec: 30,
        enabled: false,
        lastStatus: 'idle',
        mappedMetrics: ['switchHealth', 'clientLatency', 'portCrcErrors', 'uplinkStatus'],
      },
    ],
    topologyMap: {
      diagramName: 'cinnagen-dc-live-map',
      snapToGrid: true,
      showLegend: false,
      vlans: [
        { id: 'v-10', vlanTag: 'VLAN-10-OT', name: 'GMP Production OT', subnet: '10.42.10.0/24', color: '#10B981', visible: true },
        { id: 'v-20', vlanTag: 'VLAN-20-SCADA', name: 'SCADA & Historian', subnet: '10.42.20.0/24', color: '#8B5CF6', visible: true },
        { id: 'v-30', vlanTag: 'VLAN-30-EMS', name: 'EMS & Vault Storage', subnet: '10.42.30.0/24', color: '#06B6D4', visible: true },
        { id: 'v-31', vlanTag: 'VLAN-31-LAB', name: 'QC Lab & Empower', subnet: '10.42.31.0/24', color: '#3B82F6', visible: true },
        { id: 'v-11', vlanTag: 'VLAN-11-QA', name: 'QA Batch Release', subnet: '10.42.11.0/24', color: '#14B8A6', visible: true },
        { id: 'v-50', vlanTag: 'VLAN-50-WIFI', name: 'Campus Wi-Fi 6E', subnet: '10.42.50.0/24', color: '#F59E0B', visible: true },
        { id: 'v-70', vlanTag: 'VLAN-70-ACS', name: 'Access Control / CCTV', subnet: '10.42.70.0/24', color: '#EC4899', visible: true },
        { id: 'v-99', vlanTag: 'VLAN-99-UPLINK', name: 'Fiber Trunk & DMZ', subnet: '10.42.99.0/24', color: '#38BDF8', visible: true },
      ],
      nodePositions: {
        // Row 1: Perimeter DMZ + Core Firewall + Power UPS
        'custom:vpn-wg': { x: 40, y: 40 },
        'custom:tunnel-cf': { x: 40, y: 180 },
        'dev:dev-fw-1': { x: 380, y: 40 },
        'dev:dev-ups-1': { x: 840, y: 40 },
        // Row 2: Core Nexus Switch + Building B Distribution & Access
        'dev:dev-sw-1': { x: 380, y: 200 },
        'dev:dev-dist-b1': { x: 960, y: 200 },
        'dev:dev-acc-2960-b1': { x: 1520, y: 200 },
        // Row 3: Compute / Storage / Floor A0 & A1 Distribution Switches
        'dev:dev-srv-2': { x: 40, y: 400 },
        'dev:dev-dist-a0': { x: 360, y: 400 },
        'dev:dev-nas-1': { x: 940, y: 400 },
        'dev:dev-dist-a1': { x: 1380, y: 400 },
        // Row 4: Hypervisor Cluster + Access 2960-X Switches
        'dev:dev-srv-1': { x: 40, y: 660 },
        'dev:dev-acc-2960-a0': { x: 640, y: 660 },
        'dev:dev-acc-2960-a1': { x: 1220, y: 660 },
        // Row 5: Key User Nodes (clean spaced row, zero overlap)
        'un:un-hmi-up': { x: 40, y: 940 },
        'un:un-hmi-fil': { x: 300, y: 940 },
        'un:un-badge-pal': { x: 560, y: 940 },
        'un:un-qa-01': { x: 820, y: 940 },
        'un:un-qa-02': { x: 1080, y: 940 },
        'un:un-scada-01': { x: 1340, y: 940 },
        'un:un-ap-a1': { x: 1600, y: 940 },
        'un:un-hplc-01': { x: 1520, y: 400 },
        'un:un-lcms-01': { x: 1780, y: 400 },
      },
      boxes: [
        {
          id: 'frame-dmz',
          kind: 'frame',
          title: 'Remote Access & DMZ Perimeter',
          subtitle: 'Zero-Trust Edge',
          x: 20,
          y: 12,
          width: 310,
          height: 295,
          color: '#F59E0B',
        },
        {
          id: 'frame-mdf',
          kind: 'frame',
          title: 'MDF Core Data Center · A1-204',
          subtitle: 'DC-R01 · Cold Aisle A1',
          x: 355,
          y: 12,
          width: 790,
          height: 340,
          color: '#06B6D4',
          roomId: 'rm-a1-control',
        },
      ],
      texts: [
        {
          id: 'txt-core-note',
          text: '100G OS2 Campus Backbone · Search any device/port/node to isolate its full recursive graph',
          x: 360,
          y: 362,
          color: '#94A3B8',
          fontSize: 11,
        },
      ],
      tables: [],
      customNodes: [
        {
          id: 'vpn-wg',
          kind: 'vpn',
          badge: 'Wireguard',
          name: 'Mgmt Remote Access',
          subtitle: 'VPN Peer · 10.42.99.2',
          ipAddress: '10.42.99.2',
          vlan: 'VLAN-99-UPLINK',
          status: 'online',
          x: 60,
          y: 40,
          latencyMs: 0.3,
          packetLossPct: 0.0,
          uptimeLabel: '32d 4h',
        },
        {
          id: 'tunnel-cf',
          kind: 'tunnel',
          badge: 'Cloudflare',
          name: 'Cloudflare Tunnel',
          subtitle: 'Zero-Trust Vendor Portal',
          ipAddress: '198.51.100.14',
          vlan: 'VLAN-99-UPLINK',
          status: 'online',
          x: 60,
          y: 185,
          latencyMs: 4.1,
          packetLossPct: 0.0,
          uptimeLabel: '19d 8h',
        },
      ],
      customCables: [
        {
          id: 'cc-wg-fw',
          fromNodeId: 'custom:vpn-wg',
          toNodeId: 'dev:dev-fw-1',
          toPortId: 'fw-1',
          label: 'WG-MGMT',
          speedLabel: '1G VPN',
          vlan: 'VLAN-99-UPLINK',
          color: '#10B981',
          style: 'dashed',
          status: 'up',
        },
        {
          id: 'cc-cf-fw',
          fromNodeId: 'custom:tunnel-cf',
          toNodeId: 'dev:dev-fw-1',
          toPortId: 'fw-3',
          label: 'CF-EDGE',
          speedLabel: '2.5G Tunnel',
          vlan: 'VLAN-99-UPLINK',
          color: '#F59E0B',
          style: 'dashed',
          status: 'up',
        },
      ],
    },
  };

  const flows = [
    // ── Building A · Level 0 (A0-101 .. A0-108) ──
    {
      id: 'flw-pers-1',
      floorId: 'fl-a0',
      name: 'Unidirectional Personnel Gowning Flow (PAL → Core)',
      flowType: 'personnel' as const,
      points: [
        { x: 14, z: 20.5 },
        { x: 14, z: 12.0 },
        { x: 6.5, z: 12.0 },
        { x: 6.5, z: 6.5 },
        { x: 18.5, z: 6.5 },
        { x: 29.0, z: 6.5 },
      ],
      color: '#10B981',
      flowRateLabel: '18 operators / shift',
      capacityLabel: 'Max 24 concurrent',
      cleanlinessClass: 'clean' as const,
      restrictions: 'Grade C/B gowning qualification required (A0-106 → A0-104 → A0-101/102/103)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-mat-1',
      floorId: 'fl-a0',
      name: 'Media → Upstream → Downstream → Fill-Finish → Packaging',
      flowType: 'product' as const,
      points: [
        { x: 5.5, z: 17.5 },
        { x: 5.5, z: 5.5 },
        { x: 17.5, z: 5.5 },
        { x: 28.5, z: 5.5 },
        { x: 29.5, z: 17.0 },
      ],
      color: '#2563EB',
      flowRateLabel: '2,000 L / batch',
      capacityLabel: '42 batches / yr',
      cleanlinessClass: 'clean' as const,
      restrictions: 'Closed single-use transfer manifolds (A0-105 → A0-101 → A0-102 → A0-103 → A0-108)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-wst-1',
      floorId: 'fl-a0',
      name: 'Biowaste & Spent Single-Use Exit Route (MAL)',
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
      restrictions: 'Double-bagged autoclaved before exit via A0-107 MAL',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-air-1',
      floorId: 'fl-a0',
      name: 'A0 Positive Pressure Cascade (+45 → +30 → +15 Pa)',
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
      restrictions: 'Continuous EMS differential pressure alarm (AHU-01/02)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-a0-emg',
      floorId: 'fl-a0',
      name: 'A0 Emergency Egress & Clean Corridor Escape',
      flowType: 'evacuation' as const,
      points: [
        { x: 29.5, z: 17.5 },
        { x: 29.5, z: 11.8 },
        { x: 14.0, z: 11.8 },
        { x: 3.0, z: 11.8 },
      ],
      color: '#F59E0B',
      flowRateLabel: '< 45s egress time',
      capacityLabel: 'Break-glass interlock override',
      cleanlinessClass: 'emergency' as const,
      restrictions: 'Unobstructed 1.8m Grade C corridor egress (A0-108 → A0-104)',
      layerId: 'layer-flows',
    },

    // ── Building A · Level 1 (A1-201 .. A1-206) ──
    {
      id: 'flw-a1-hvac-dist',
      floorId: 'fl-a1',
      name: 'Central AHU Supply & Return Trunk Routing',
      flowType: 'airflow' as const,
      points: [
        { x: 8.5, z: 5.5 },
        { x: 8.5, z: 11.2 },
        { x: 18.5, z: 11.2 },
        { x: 29.5, z: 11.2 },
      ],
      color: '#06B6D4',
      flowRateLabel: '64,000 m³/h main header',
      capacityLabel: 'AHU-01 / AHU-02 / AHU-03',
      cleanlinessClass: 'clean' as const,
      restrictions: 'H14 HEPA bank + automated VFD pressure modulation (A1-201)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-a1-wfi-loop',
      floorId: 'fl-a1',
      name: 'WFI & Clean Steam Distribution Loop (80 °C)',
      flowType: 'utility' as const,
      points: [
        { x: 21.5, z: 6.0 },
        { x: 14.0, z: 6.0 },
        { x: 14.0, z: 11.0 },
        { x: 21.5, z: 11.0 },
        { x: 21.5, z: 6.0 },
      ],
      color: '#38BDF8',
      flowRateLabel: '3,200 L/h @ 1.8 m/s',
      capacityLabel: '316L electropolished Ra ≤ 0.4µm',
      cleanlinessClass: 'clean' as const,
      restrictions: 'Continuous ozone & TOC < 500 ppb monitoring (A1-202 → A0 risers)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-a1-power-scada',
      floorId: 'fl-a1',
      name: 'Redundant UPS Power & OT Fiber Backbone',
      flowType: 'utility' as const,
      points: [
        { x: 31.0, z: 6.0 },
        { x: 31.0, z: 11.3 },
        { x: 6.5, z: 11.3 },
        { x: 6.5, z: 16.5 },
      ],
      color: '#F59E0B',
      flowRateLabel: '2 × 400 kVA Dual Bus',
      capacityLabel: 'N+1 UPS + 10G SCADA ring',
      cleanlinessClass: 'bidirectional' as const,
      restrictions: 'Segregated OT VLAN-30 conduit (A1-203 MCC → A1-204 SCADA)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-a1-qa-pers',
      floorId: 'fl-a1',
      name: 'QA Batch Review, SCADA & Audit Circulation',
      flowType: 'personnel' as const,
      points: [
        { x: 6.5, z: 16.5 },
        { x: 18.0, z: 16.5 },
        { x: 29.5, z: 16.5 },
        { x: 29.5, z: 11.5 },
        { x: 8.5, z: 11.5 },
      ],
      color: '#10B981',
      flowRateLabel: '32 QA / Eng staff',
      capacityLabel: 'Badge-controlled CNC access',
      cleanlinessClass: 'bidirectional' as const,
      restrictions: 'Direct QA oversight path (A1-204 → A1-205 → A1-206 → Utility Spine)',
      layerId: 'layer-flows',
    },

    // ── Building B · Level 0 (B0-101 .. B0-105) ──
    {
      id: 'flw-b0-inbound',
      floorId: 'fl-b0',
      name: 'Inbound Raw Material → Quarantine → GDP Storage',
      flowType: 'material' as const,
      points: [
        { x: 8.5, z: 16.5 },
        { x: 8.5, z: 11.5 },
        { x: 28.0, z: 11.5 },
        { x: 28.0, z: 6.5 },
        { x: 8.0, z: 6.5 },
      ],
      color: '#8B5CF6',
      flowRateLabel: '28 pallets / day',
      capacityLabel: 'WMS barcode quarantine lock',
      cleanlinessClass: 'bidirectional' as const,
      restrictions: 'QA release sticker required before transfer (B0-104 → B0-103 → B0-101)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-b0-coldchain',
      floorId: 'fl-b0',
      name: 'Cold-Chain Biologics (2–8 °C) Storage → Dispatch',
      flowType: 'product' as const,
      points: [
        { x: 20.0, z: 6.5 },
        { x: 20.0, z: 12.0 },
        { x: 24.0, z: 15.5 },
      ],
      color: '#2563EB',
      flowRateLabel: '14 cryo/reefer shippers / day',
      capacityLabel: 'Max 12 min ambient staging',
      cleanlinessClass: 'clean' as const,
      restrictions: 'Validated 2–8 °C thermal blankets & NFC loggers (B0-102 → B0-105)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-b0-forklift',
      floorId: 'fl-b0',
      name: 'Electric Forklift & Operator Safety Aisle',
      flowType: 'personnel' as const,
      points: [
        { x: 4.0, z: 15.5 },
        { x: 16.0, z: 15.5 },
        { x: 16.0, z: 11.5 },
        { x: 4.0, z: 11.5 },
        { x: 4.0, z: 6.5 },
      ],
      color: '#10B981',
      flowRateLabel: '4 AGV / reach trucks',
      capacityLabel: 'Max 8 km/h warehouse limit',
      cleanlinessClass: 'bidirectional' as const,
      restrictions: 'High-vis PPE & separated pedestrian walkway (B0-104 ↔ B0-101)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-b0-cold-air',
      floorId: 'fl-b0',
      name: 'Glycol Evaporator Cold Air Recirculation (2–8 °C)',
      flowType: 'airflow' as const,
      points: [
        { x: 16.5, z: 3.0 },
        { x: 23.5, z: 3.0 },
        { x: 23.5, z: 9.5 },
        { x: 16.5, z: 9.5 },
      ],
      color: '#06B6D4',
      flowRateLabel: '12,400 m³/h @ 4.5 °C',
      capacityLabel: '±1.0 °C mapped uniformity',
      cleanlinessClass: 'clean' as const,
      restrictions: 'Dual redundant glycol coil bank CHW-COLD (B0-102)',
      layerId: 'layer-flows',
    },

    // ── Building B · Level 1 (B1-201 .. B1-205) ──
    {
      id: 'flw-b1-sample',
      floorId: 'fl-b1',
      name: 'QC Sample Intake → Micro / Analytical / Stability',
      flowType: 'material' as const,
      points: [
        { x: 28.5, z: 6.0 },
        { x: 20.5, z: 6.0 },
        { x: 8.0, z: 6.0 },
        { x: 8.0, z: 15.2 },
      ],
      color: '#8B5CF6',
      flowRateLabel: '140 LIMS samples / day',
      capacityLabel: '21 CFR Part 11 chain-of-custody',
      cleanlinessClass: 'clean' as const,
      restrictions: 'Sealed bio-transport pouches (B1-203 → B1-202 → B1-201 → B1-204)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-b1-rd-tech',
      floorId: 'fl-b1',
      name: 'Bioprocess R&D → Analytical Characterization Flow',
      flowType: 'personnel' as const,
      points: [
        { x: 22.5, z: 15.2 },
        { x: 22.5, z: 11.2 },
        { x: 10.5, z: 11.2 },
        { x: 10.5, z: 6.0 },
      ],
      color: '#10B981',
      flowRateLabel: '22 scientists / shift',
      capacityLabel: 'Lab coat & BSL-2 eye protection',
      cleanlinessClass: 'clean' as const,
      restrictions: 'Separate BSL-2 micro gowning (B1-205 → B1-201)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-b1-lab-waste',
      floorId: 'fl-b1',
      name: 'Biohazard & HPLC Solvent Waste Extraction',
      flowType: 'waste' as const,
      points: [
        { x: 19.5, z: 8.5 },
        { x: 25.0, z: 11.2 },
        { x: 28.5, z: 11.2 },
        { x: 28.5, z: 15.5 },
      ],
      color: '#EF4444',
      flowRateLabel: '85 L solvent + 40 kg biohazard / wk',
      capacityLabel: 'UN-certified flameproof drums',
      cleanlinessClass: 'dirty' as const,
      restrictions: 'Segregated biohazard & acetonitrile waste (B1-202/201 → B1-203/205 exit)',
      layerId: 'layer-flows',
    },
    {
      id: 'flw-b1-hvac',
      floorId: 'fl-b1',
      name: 'BSL-2 Negative Exhaust & Lab Fume Hood Makeup Air',
      flowType: 'airflow' as const,
      points: [
        { x: 6.5, z: 3.5 },
        { x: 20.5, z: 3.5 },
        { x: 20.5, z: 15.0 },
        { x: 7.5, z: 15.0 },
      ],
      color: '#06B6D4',
      flowRateLabel: '22,000 m³/h 100% single-pass',
      capacityLabel: 'B1-202 @ -15 Pa BSL-2 negative',
      cleanlinessClass: 'clean' as const,
      restrictions: 'AHU-03 HEPA bag-in/bag-out exhaust (B1-201..205)',
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
    openings: verifiedOpenings,
    assets,
    cameras,
    references: [],
    layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
    flows,
    timelineEvents,
    customMaterials: [],
    customSpaceTypes: [],
    customObjects: [],
    networkArchitecture,
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
      makeAsset('a6', 'fl-1', 'rm-4', 'eq-pass-box', 'Dynamic HEPA Pass Box PB-01', 'AF-PB01', 10.8, 12.2, 0),
      makeAsset('a7', 'fl-1', 'rm-3', 'eq-fire-extinguisher', 'Cleanroom CO2 Extinguisher FE-01', 'AF-FE01', 2.8, 15.8, 0),
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
      makeAsset('q8', 'fl-1', 'rm-2', 'eq-pass-box', 'Microbiology Transfer Pass Box', 'QC-PB01', 16.0, 9.8, 0),
      makeAsset('q9', 'fl-1', 'rm-1', 'eq-fire-extinguisher', 'Lab CO2 Fire Extinguisher', 'QC-FE01', 2.8, 10.2, 0),
      makeAsset('q10', 'fl-1', 'rm-4', 'eq-desk', 'QA Batch Review & LIMS Desk', 'QC-QA01', 18.6, 14.2, 0),
      makeAsset('q11', 'fl-1', 'rm-4', 'eq-lab-bench', 'Sample Prep & Retention Bench', 'QC-SP01', 23.4, 14.6, 0),
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
      makeAsset('w4', 'fl-1', 'rm-2', 'eq-pallet-rack', 'Cold Chain Rack 1', 'CLD-01', 20.5, 4.5, 0),
      makeAsset('w5', 'fl-1', 'rm-2', 'eq-cold-room-unit', 'Walk-In Cold Room Chamber (2–8 °C)', 'CLD-CR01', 22.8, 9.2, Math.PI),
      makeAsset('w6', 'fl-1', 'rm-3', 'eq-conveyor', 'Outbound Staging Conveyor', 'CNV-01', 10.0, 15.0, 0),
      makeAsset('w7', 'fl-1', 'rm-3', 'eq-firebox', 'Dock Fire Hose Firebox', 'WH-FB01', 3.0, 12.5, 0),
      makeAsset('w8', 'fl-1', 'rm-1', 'eq-fire-extinguisher', 'Warehouse Extinguisher', 'WH-FE01', 15.0, 11.2, Math.PI),
    ];
  }

  if (base.rooms.length > 0) {
    base.openings = ensureDoorsForAllRooms(base.rooms, base.walls, base.openings);
    // Anchor default camera to first room so it always shows meaningful interior content
    const firstRm = base.rooms[0];
    base.cameras = [
      {
        id: 'cam-rm-1',
        floorId: firstRm.floorId,
        roomId: firstRm.id,
        name: `${firstRm.code} · ${firstRm.name} Cam`,
        kind: 'security',
        group: 'Facility CCTV',
        position: [firstRm.x + 0.9, 3.1, firstRm.z + 0.9],
        target: [firstRm.x + firstRm.width * 0.55, 1.3, firstRm.z + firstRm.depth * 0.55],
        fov: 66,
        focalLengthMm: 24,
        coverageRadius: 11,
        visibleCone: true,
        layerId: 'layer-cameras',
        ipAddress: '10.42.20.101',
        port: 554,
        protocol: 'RTSP',
        streamPath: '/h265/ch01/main',
        resolution: '2560×1440',
        fps: 30,
        status: 'recording',
      },
    ];
  }

  base.assets = base.assets.map((a) => enrichAssetHistory(a));
  ensureRoomsHaveCodesAndModels(base);
  return base;
}
