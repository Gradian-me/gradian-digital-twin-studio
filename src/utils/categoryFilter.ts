import type { FacilityCategoryFilter, Room, SpatialAsset } from '../types/twin';

export interface FacilityCategoryMeta {
  id: FacilityCategoryFilter;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}

export const FACILITY_CATEGORIES: FacilityCategoryMeta[] = [
  {
    id: 'all',
    label: 'All Systems',
    shortLabel: 'All',
    color: '#A78BFA',
    description: 'Full facility visibility across all functional disciplines',
  },
  {
    id: 'IT',
    label: 'IT & Data Center',
    shortLabel: 'IT',
    color: '#06B6D4',
    description: 'Core Data Center, IDF Distribution Racks, Switches, SCADA & Control Rooms',
  },
  {
    id: 'PRODUCTION',
    label: 'Production & Cleanrooms',
    shortLabel: 'Production',
    color: '#8B5CF6',
    description: 'Biopharmaceutical upstream/downstream suites, Grade A–D aseptic filling & manufacturing',
  },
  {
    id: 'LABORATORY',
    label: 'Laboratory & QC',
    shortLabel: 'Lab',
    color: '#3B82F6',
    description: 'Analytical QC labs, microbiology, HPLC benches, biosafety cabinets & fume hoods',
  },
  {
    id: 'VALIDATION',
    label: 'Validation & QA',
    shortLabel: 'Validation',
    color: '#10B981',
    description: 'QA offices, validation suites, stability chambers, calibration & monitoring sensors',
  },
  {
    id: 'UTILITIES',
    label: 'Utilities & MEP',
    shortLabel: 'Utilities',
    color: '#F59E0B',
    description: 'HVAC AHUs, WFI loops, chillers, electrical panels, UPS & CRAC cooling',
  },
  {
    id: 'SAFETY',
    label: 'Safety & Fire',
    shortLabel: 'Safety',
    color: '#EF4444',
    description: 'Fire extinguishers, fireboxes, pass boxes, airlocks, safety showers & emergency egress',
  },
  {
    id: 'WAREHOUSE',
    label: 'Warehouse & Cold Chain',
    shortLabel: 'Warehouse',
    color: '#6366F1',
    description: 'GMP warehouses, cold rooms, pallet racking, forklifts & distribution staging',
  },
];

export function getCategoryMeta(filter: FacilityCategoryFilter): FacilityCategoryMeta {
  return FACILITY_CATEGORIES.find((c) => c.id === filter) ?? FACILITY_CATEGORIES[0];
}

export function doesRoomMatchCategory(room: Room, filter: FacilityCategoryFilter): boolean {
  if (filter === 'all') return true;
  const text = `${room.name} ${room.code} ${room.category} ${room.spaceTypeId} ${(room.metadata?.tags ?? []).join(' ')} ${room.metadata?.department ?? ''}`.toLowerCase();

  switch (filter) {
    case 'IT':
      return (
        text.includes('data center') ||
        text.includes('server') ||
        text.includes('scada') ||
        text.includes('control') ||
        text.includes('network') ||
        text.includes('idf') ||
        text.includes('mdf') ||
        text.includes('telecom') ||
        text.includes('it ') ||
        room.spaceTypeId === 'st-server-room' ||
        room.spaceTypeId === 'st-control-room'
      );
    case 'PRODUCTION':
      return (
        room.category === 'Pharmaceutical Manufacturing' ||
        room.category === 'Cleanrooms' ||
        text.includes('bioreactor') ||
        text.includes('upstream') ||
        text.includes('downstream') ||
        text.includes('filling') ||
        text.includes('aseptic') ||
        text.includes('cell culture') ||
        text.includes('purification') ||
        text.includes('buffer') ||
        text.includes('media') ||
        text.includes('lyophil') ||
        text.includes('packaging')
      );
    case 'LABORATORY':
      return (
        room.category === 'Quality & Laboratories' ||
        text.includes('lab') ||
        text.includes('qc') ||
        text.includes('microbio') ||
        text.includes('analytical') ||
        text.includes('r&d') ||
        text.includes('hplc')
      );
    case 'VALIDATION':
      return (
        text.includes('qa') ||
        text.includes('validation') ||
        text.includes('quality') ||
        text.includes('stability') ||
        text.includes('audit') ||
        text.includes('compliance') ||
        text.includes('metrology') ||
        room.complianceStatus !== 'compliant' ||
        room.environmental?.monitoringRequired === true
      );
    case 'UTILITIES':
      return (
        room.category === 'Utilities' ||
        text.includes('utility') ||
        text.includes('hvac') ||
        text.includes('mechanical') ||
        text.includes('wfi') ||
        text.includes('chiller') ||
        text.includes('electrical') ||
        text.includes('boiler') ||
        text.includes('plant')
      );
    case 'SAFETY':
      return (
        text.includes('airlock') ||
        text.includes('gown') ||
        text.includes('safety') ||
        text.includes('fire') ||
        text.includes('emergency') ||
        text.includes('wash') ||
        text.includes('corridor') ||
        text.includes('vestibule')
      );
    case 'WAREHOUSE':
      return (
        room.category === 'Warehouses & Logistics' ||
        text.includes('warehouse') ||
        text.includes('cold') ||
        text.includes('storage') ||
        text.includes('dispatch') ||
        text.includes('shipping') ||
        text.includes('receiving') ||
        text.includes('staging') ||
        text.includes('quarantine')
      );
    default:
      return true;
  }
}

export function doesAssetMatchCategory(asset: SpatialAsset, filter: FacilityCategoryFilter): boolean {
  if (filter === 'all') return true;
  const text = `${asset.name} ${asset.assetId} ${asset.category} ${asset.archetype} ${(asset.tags ?? []).join(' ')} ${asset.department ?? ''}`.toLowerCase();

  switch (filter) {
    case 'IT':
      return (
        asset.category === 'IT & Data Center' ||
        Boolean(asset.rackConfig) ||
        asset.archetype === 'server-rack' ||
        asset.archetype === 'network-rack' ||
        asset.archetype === 'patch-cabinet' ||
        asset.archetype === 'scada-console' ||
        asset.archetype === 'ups-tower' ||
        asset.archetype === 'pdu-cabinet' ||
        asset.archetype === 'crac-cooling' ||
        text.includes('switch') ||
        text.includes('rack') ||
        text.includes('server') ||
        text.includes('scada') ||
        text.includes('network')
      );
    case 'PRODUCTION':
      return (
        asset.category === 'Biopharmaceutical' ||
        asset.archetype === 'bioreactor-ss' ||
        asset.archetype === 'bioreactor-su' ||
        asset.archetype === 'chromatography-skid' ||
        asset.archetype === 'filtration-skid' ||
        asset.archetype === 'filling-line' ||
        asset.archetype === 'lyophilizer' ||
        asset.archetype === 'isolator' ||
        asset.archetype === 'vessel-tank' ||
        asset.archetype === 'tablet-press' ||
        asset.archetype === 'fluid-bed-dryer' ||
        asset.archetype === 'granulator' ||
        asset.archetype === 'autoclave'
      );
    case 'LABORATORY':
      return (
        asset.category === 'Laboratory' ||
        asset.archetype === 'hplc-instrument' ||
        asset.archetype === 'biosafety-cabinet' ||
        asset.archetype === 'fume-hood' ||
        asset.archetype === 'lab-bench' ||
        asset.archetype === 'lab-freezer'
      );
    case 'VALIDATION':
      return (
        asset.archetype === 'stability-chamber' ||
        asset.archetype === 'sensor-node' ||
        asset.criticality === 'gmp-critical' ||
        text.includes('validation') ||
        text.includes('calibrat') ||
        text.includes('qa') ||
        text.includes('monitor') ||
        text.includes('sensor') ||
        asset.operationalStatus === 'maintenance-due'
      );
    case 'UTILITIES':
      return (
        asset.category === 'HVAC & Utilities' ||
        asset.archetype === 'ahu-unit' ||
        asset.archetype === 'chiller' ||
        asset.archetype === 'wfi-skid' ||
        asset.archetype === 'electrical-panel' ||
        asset.archetype === 'ups-tower' ||
        asset.archetype === 'crac-cooling' ||
        asset.archetype === 'pdu-cabinet'
      );
    case 'SAFETY':
      return (
        asset.category === 'Building & Safety' ||
        asset.archetype === 'fire-extinguisher' ||
        asset.archetype === 'firebox-cabinet' ||
        asset.archetype === 'pass-box' ||
        asset.archetype === 'safety-station' ||
        text.includes('fire') ||
        text.includes('safety') ||
        text.includes('eyewash') ||
        text.includes('pass box')
      );
    case 'WAREHOUSE':
      return (
        asset.category === 'Warehouse & Logistics' ||
        asset.archetype === 'pallet-rack' ||
        asset.archetype === 'forklift' ||
        asset.archetype === 'conveyor' ||
        asset.archetype === 'agv-robot' ||
        asset.archetype === 'cold-room-unit' ||
        text.includes('cold') ||
        text.includes('pallet') ||
        text.includes('warehouse')
      );
    default:
      return true;
  }
}
