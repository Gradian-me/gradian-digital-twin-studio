import type {
  HvacAirflowMode,
  HvacHepaClass,
  Room,
  RoomHvacConfig,
} from '../types/twin';

export interface AhuCatalogUnit {
  id: string;
  name: string;
  zone: string;
  color: string;
  capacityM3h: number;
}

export const AHU_CATALOG: AhuCatalogUnit[] = [
  { id: 'AHU-01', name: 'AHU-01 · Upstream & Downstream GMP', zone: 'Bldg A · Grade C/D', color: '#06B6D4', capacityM3h: 42000 },
  { id: 'AHU-02', name: 'AHU-02 · Aseptic Fill-Finish Grade A/B', zone: 'Bldg A · Grade A/B', color: '#38BDF8', capacityM3h: 28000 },
  { id: 'AHU-03', name: 'AHU-03 · QC Labs & R&D Exhaust', zone: 'Bldg B · Level 1', color: '#818CF8', capacityM3h: 32000 },
  { id: 'AHU-04', name: 'AHU-04 · Offices, QA & Support', zone: 'Campus Support', color: '#34D399', capacityM3h: 24000 },
  { id: 'CRAC-DC01', name: 'CRAC-DC01 · Precision IT Cooling', zone: 'SCADA & Data Center', color: '#A855F7', capacityM3h: 18000 },
  { id: 'CHW-COLD', name: 'CHW-COLD · 2–8°C GDP Cold Chain', zone: 'Bldg B · Cold Storage', color: '#0284C7', capacityM3h: 22000 },
];

export const HEPA_CLASSES: HvacHepaClass[] = [
  'ULPA U15',
  'HEPA H14',
  'HEPA H13',
  'MERV-14',
  'MERV-11',
];

export const AIRFLOW_MODES: { id: HvacAirflowMode; label: string; color: string }[] = [
  { id: 'laminar-udaf', label: 'Laminar UDAF (0.45 m/s)', color: '#38BDF8' },
  { id: 'positive-cascade', label: 'Positive Cascade (+ΔP)', color: '#06B6D4' },
  { id: 'negative-containment', label: 'Negative Containment (-ΔP)', color: '#F43F5E' },
  { id: 'cold-recirc', label: 'Cold-Chain Recirculation', color: '#3B82F6' },
  { id: 'balanced', label: 'Balanced Comfort Supply', color: '#10B981' },
];

/** Derives a complete, realistic HVAC configuration for any room if not explicitly customized */
export function getEffectiveRoomHvac(room: Room): RoomHvacConfig {
  if (room.environmental.hvac) {
    const existing = room.environmental.hvac;
    const resolvedStatus = existing.systemStatus ?? existing.status ?? 'online';
    return {
      ...existing,
      airChangesPerHour: existing.airChangesPerHour ?? room.environmental.airChangesPerHour,
      targetPressurePa: existing.targetPressurePa ?? room.environmental.pressurePa,
      status: resolvedStatus,
      systemStatus: resolvedStatus,
    };
  }

  const grade = room.environmental.cleanroomGrade;
  const nameLc = `${room.name} ${room.category}`.toLowerCase();
  const area = Math.max(4, room.width * room.depth);

  let ahuId = 'AHU-04';
  if (nameLc.includes('cold') || room.environmental.temperatureC <= 10) {
    ahuId = 'CHW-COLD';
  } else if (nameLc.includes('scada') || nameLc.includes('data') || nameLc.includes('server') || nameLc.includes('control')) {
    ahuId = 'CRAC-DC01';
  } else if (grade.includes('Grade A') || grade.includes('Grade B') || nameLc.includes('aseptic') || nameLc.includes('fill')) {
    ahuId = 'AHU-02';
  } else if (nameLc.includes('lab') || nameLc.includes('micro') || nameLc.includes('stability') || nameLc.includes('r&d') || room.floorId === 'fl-b1') {
    ahuId = 'AHU-03';
  } else if (grade.includes('Grade C') || grade.includes('Grade D') || room.floorId === 'fl-a0') {
    ahuId = 'AHU-01';
  }

  const ahuUnit = AHU_CATALOG.find((u) => u.id === ahuId) ?? AHU_CATALOG[0];

  let hepaClass: HvacHepaClass = 'MERV-14';
  if (grade.includes('Grade A')) hepaClass = 'ULPA U15';
  else if (grade.includes('Grade B') || grade.includes('Grade C')) hepaClass = 'HEPA H14';
  else if (grade.includes('Grade D') || nameLc.includes('lab')) hepaClass = 'HEPA H13';
  else if (grade === 'Unclassified') hepaClass = 'MERV-11';

  let airflowMode: HvacAirflowMode = 'balanced';
  if (grade.includes('Grade A')) airflowMode = 'laminar-udaf';
  else if (nameLc.includes('cold') || room.environmental.temperatureC <= 10) airflowMode = 'cold-recirc';
  else if (room.environmental.pressurePa < 0 || nameLc.includes('micro') || nameLc.includes('waste') || nameLc.includes('quarantine')) {
    airflowMode = 'negative-containment';
  } else if (room.environmental.pressurePa >= 10) {
    airflowMode = 'positive-cascade';
  }

  const diffuserCount = Math.min(8, Math.max(1, Math.round(area / 22)));
  const supplyTempC = Number(Math.max(2, room.environmental.temperatureC - 2.5).toFixed(1));
  const initialStatus = room.complianceStatus === 'deviation' ? 'alarm' : 'online';

  return {
    ahuId: ahuUnit.id,
    ahuName: ahuUnit.name,
    hepaClass,
    airflowMode,
    airChangesPerHour: room.environmental.airChangesPerHour,
    targetPressurePa: room.environmental.pressurePa,
    supplyTempC,
    damperPct: airflowMode === 'laminar-udaf' ? 92 : airflowMode === 'positive-cascade' ? 78 : 65,
    diffuserCount,
    exhaustPct: airflowMode === 'negative-containment' ? 115 : 85,
    status: initialStatus,
    systemStatus: initialStatus,
    showDucts: true,
  };
}

/** Calculates real-time supply airflow in m³/h from room volume × ACH */
export function computeRoomSupplyM3h(room: Room): number {
  const vol = Math.max(10, room.width * room.depth * room.height);
  const ach = Math.max(2, room.environmental.airChangesPerHour || 6);
  return Math.round(vol * ach);
}

export function getAhuColor(ahuId: string): string {
  return AHU_CATALOG.find((a) => a.id === ahuId)?.color ?? '#06B6D4';
}
