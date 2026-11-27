import type { DigitalTwinScene, Room, RoomFireExtinguisher, RoomFireSafetyConfig, RoomFireSensor } from '../types/twin';

export interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

const DEFAULT_DEPARTMENTS: DepartmentOption[] = [
  { id: 'dept-usp', code: 'USP', name: 'Upstream Bioprocessing' },
  { id: 'dept-dsp', code: 'DSP', name: 'Downstream Purification' },
  { id: 'dept-fill', code: 'FILL', name: 'Aseptic Fill & Finish' },
  { id: 'dept-qc', code: 'QC', name: 'Quality Control & Analytical Labs' },
  { id: 'dept-qa', code: 'QA', name: 'Quality Assurance & GMP Compliance' },
  { id: 'dept-it', code: 'IT', name: 'IT & OT Infrastructure' },
  { id: 'dept-eng', code: 'ENG', name: 'Facilities, HVAC & Utilities' },
  { id: 'dept-wh', code: 'WH', name: 'Cold Chain & Logistics' },
];

export function getSceneDepartments(scene: DigitalTwinScene): DepartmentOption[] {
  const fromHierarchy: DepartmentOption[] = scene.hierarchy
    .filter((n) => n.level === 'department')
    .map((n) => ({
      id: n.id,
      code: n.metadata?.code || n.name.slice(0, 4).toUpperCase(),
      name: n.name,
    }));

  const seen = new Set(fromHierarchy.map((d) => d.id));
  const merged = [...fromHierarchy];
  for (const fallback of DEFAULT_DEPARTMENTS) {
    if (!seen.has(fallback.id)) {
      merged.push(fallback);
    }
  }
  return merged;
}

function hashCode(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function getDepartmentCostCenter(dept?: DepartmentOption | null): string {
  if (!dept) return 'CC-1000 · General Operations';
  const code = (dept.code || dept.name).toUpperCase();
  const map: Record<string, string> = {
    USP: 'CC-2100 · Upstream Bioprocessing',
    DSP: 'CC-2200 · Downstream Purification',
    FILL: 'CC-2300 · Aseptic Fill & Finish',
    QC: 'CC-3100 · Quality Control & Analytical',
    QA: 'CC-3200 · Quality Assurance & Compliance',
    IT: 'CC-4100 · IT & OT Infrastructure',
    DC: 'CC-4100 · IT & OT Infrastructure',
    ENG: 'CC-5100 · Facilities & Utilities',
    WH: 'CC-6100 · Cold Chain & Logistics',
  };
  for (const [k, v] of Object.entries(map)) {
    if (code.includes(k)) return v;
  }
  const num = 1100 + (hashCode(dept.id) % 850);
  return `CC-${num} · ${dept.name}`;
}

export function getDefaultRoomOwner(room: Room, dept?: DepartmentOption | null): string {
  if (room.owner && room.owner.trim()) return room.owner;
  if (room.metadata?.owner && room.metadata.owner.trim()) return room.metadata.owner;
  if (dept?.name) {
    const lower = dept.name.toLowerCase();
    if (lower.includes('upstream')) return 'Dr. N. Rahimi (USP Lead)';
    if (lower.includes('downstream')) return 'Dr. L. Azizi (DSP Lead)';
    if (lower.includes('fill') || lower.includes('aseptic')) return 'Dr. Elena Rostova (Aseptic Lead)';
    if (lower.includes('quality') || lower.includes('qc')) return 'Sara Moradi (QC Lab Manager)';
    if (lower.includes('it') || lower.includes('data')) return 'Reza Tavakoli (OT/IT Architect)';
    if (lower.includes('util') || lower.includes('eng')) return 'Marcus Vance (Facility Eng Lead)';
    if (lower.includes('ware') || lower.includes('log') || lower.includes('cold')) return 'A. Karimi (Cold Chain Lead)';
    return `${dept.name} Operations Lead`;
  }
  return 'Facility Operations Manager';
}

export function getEffectiveRoomFireSafety(room: Room): RoomFireSafetyConfig {
  if (
    room.fireSafety &&
    (room.fireSafety.sensors.length > 0 || room.fireSafety.extinguishers.length > 0)
  ) {
    return room.fireSafety;
  }

  const seed = hashCode(room.id || room.code);
  const code = (room.code || 'RM').replace(/[^A-Z0-9-]/gi, '').toUpperCase();
  const lowerName = room.name.toLowerCase();
  const isItOrDc =
    lowerName.includes('data') ||
    lowerName.includes('server') ||
    lowerName.includes('it ') ||
    lowerName.includes('mdf') ||
    lowerName.includes('idf');
  const isCleanroom =
    room.environmental.cleanroomGrade !== 'CNC (Controlled)' &&
    room.environmental.cleanroomGrade !== 'Unclassified';
  const isUtilityOrWarehouse =
    room.category === 'Utilities' || room.category === 'Warehouses & Logistics';

  const sensors: RoomFireSensor[] = [
    {
      id: `fs-${room.id}-1`,
      tag: `SD-${code}-01`,
      type: isItOrDc || isCleanroom ? 'VESDA Aspirating' : 'Optical Smoke',
      zone: `FZ-${code.slice(0, 2) || '01'}`,
      status: seed % 17 === 0 ? 'test-due' : 'normal',
      lastTested: '2026-08-14',
      nextTestDue: '2027-02-14',
      sensitivity: isItOrDc || isCleanroom ? '0.02% obs/m (Class A)' : '2.1% obs/m (EN54-7)',
    },
    {
      id: `fs-${room.id}-2`,
      tag: `HD-${code}-02`,
      type: isUtilityOrWarehouse ? 'UV/IR Flame' : 'Thermal Rate-of-Rise',
      zone: `FZ-${code.slice(0, 2) || '01'}`,
      status: 'normal',
      lastTested: '2026-09-02',
      nextTestDue: '2027-03-02',
      sensitivity: isUtilityOrWarehouse ? 'UV 185nm / IR 4.3µm' : '57°C Fixed / +8°C/min',
    },
  ];

  const extinguishers: RoomFireExtinguisher[] = [
    {
      id: `fe-${room.id}-1`,
      tag: `FE-${code}-01`,
      agent: isItOrDc
        ? 'FM-200 Clean Agent'
        : isCleanroom
          ? 'CO2 (Carbon Dioxide)'
          : 'ABC Dry Powder',
      capacityKg: isItOrDc ? 6 : 5,
      classRating: isItOrDc || isCleanroom ? 'Class B · C · Electrical' : 'Class A · B · C',
      pressureStatus: seed % 13 === 0 ? 'recharge-due' : 'green-nominal',
      locationHint: 'Near Primary Entry Door',
      lastInspection: '2026-10-01',
      nextInspection: '2027-04-01',
    },
  ];

  if (room.width * room.depth >= 45 || isItOrDc || isUtilityOrWarehouse) {
    extinguishers.push({
      id: `fe-${room.id}-2`,
      tag: `FE-${code}-02`,
      agent: isUtilityOrWarehouse ? 'CO2 (Carbon Dioxide)' : 'Water Mist',
      capacityKg: 6,
      classRating: isUtilityOrWarehouse ? 'Class B · Electrical' : 'Class A · C · Cleanroom Safe',
      pressureStatus: 'green-nominal',
      locationHint: 'Secondary Egress / Utility Corner',
      lastInspection: '2026-10-01',
      nextInspection: '2027-04-01',
    });
  }

  return { sensors, extinguishers };
}
