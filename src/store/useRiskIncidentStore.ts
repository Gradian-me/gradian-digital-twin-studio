import { create } from 'zustand';
import type { DigitalTwinScene } from '../types/twin';
import type { LiveSensorSnapshot, SensorDefinition } from '../types/telemetry';

export type RiskIncidentKind = 'alarm' | 'drift' | 'fmea-risk' | 'compliance-deviation';
export type RiskTargetKind = 'asset' | 'room' | 'line' | 'network';
export type IncidentStatus = 'open' | 'investigating' | 'mitigated' | 'closed';

export interface AiResolutionPlan {
  summary: string;
  rootCause: string;
  immediateContainment: string[];
  capaActions: string[];
  sopReferences: string[];
  residualSeverity: number;
  residualOccurrence: number;
  residualDetection: number;
  residualRpn: number;
  recommendedWorkOrderTitle: string;
  recommendedPriority: 'critical' | 'high' | 'medium';
  generatedAt: string;
  modelUsed: string;
  applied?: boolean;
}

export interface RiskIncidentRecord {
  id: string;
  code: string;
  kind: RiskIncidentKind;
  status: IncidentStatus;
  source: 'auto-telemetry' | 'manual' | 'ai-detected';
  targetKind: RiskTargetKind;
  targetId: string;
  targetCode: string;
  targetName: string;
  floorId?: string;
  roomId?: string;
  sensorId?: string;
  sensorTag?: string;
  currentValueLabel?: string;
  title: string;
  failureMode: string;
  effect: string;
  cause: string;
  currentControls: string;
  severity: number; // S: 1-10
  occurrence: number; // O: 1-10
  detection: number; // D: 1-10
  rpn: number; // S * O * D (1-1000)
  initialRpn: number;
  owner: string;
  createdAt: string;
  updatedAt: string;
  aiResolution?: AiResolutionPlan;
  linkedWorkOrderId?: string;
}

export interface RiskModalPrefill {
  mode: 'create' | 'resolve' | 'heatmap';
  incidentId?: string;
  targetKind?: RiskTargetKind;
  targetId?: string;
  targetCode?: string;
  targetName?: string;
  floorId?: string;
  roomId?: string;
}

export function computeRpn(severity: number, occurrence: number, detection: number): number {
  const s = Math.max(1, Math.min(10, Math.round(severity)));
  const o = Math.max(1, Math.min(10, Math.round(occurrence)));
  const d = Math.max(1, Math.min(10, Math.round(detection)));
  return s * o * d;
}

export function getRpnPriority(rpn: number): {
  label: 'Critical' | 'High' | 'Medium' | 'Low';
  textClass: string;
  bgClass: string;
  borderClass: string;
} {
  if (rpn >= 200) {
    return {
      label: 'Critical',
      textClass: 'text-rose-500 dark:text-rose-400',
      bgClass: 'bg-rose-500/12',
      borderClass: 'border-rose-500/40',
    };
  }
  if (rpn >= 100) {
    return {
      label: 'High',
      textClass: 'text-amber-600 dark:text-amber-400',
      bgClass: 'bg-amber-500/12',
      borderClass: 'border-amber-500/40',
    };
  }
  if (rpn >= 50) {
    return {
      label: 'Medium',
      textClass: 'text-violet-600 dark:text-violet-400',
      bgClass: 'bg-violet-500/12',
      borderClass: 'border-violet-500/40',
    };
  }
  return {
    label: 'Low',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-500/12',
    borderClass: 'border-emerald-500/40',
  };
}

export interface FmeaTargetSummary {
  openCount: number;
  totalCount: number;
  maxRpn: number;
  worstIncident: RiskIncidentRecord | null;
  level: 'critical' | 'high' | 'medium' | 'mitigated' | 'clear';
  shortLabel: string;
}

export function getTargetFmeaSummary(
  incidents: RiskIncidentRecord[],
  targetKind: RiskTargetKind | 'any',
  targetId: string,
  alsoMatchRoomId?: boolean
): FmeaTargetSummary {
  const matches = incidents.filter((inc) => {
    if (targetKind === 'any') {
      return inc.targetId === targetId || (alsoMatchRoomId && inc.roomId === targetId);
    }
    if (targetKind === 'asset') {
      return (inc.targetKind === 'asset' || inc.targetKind === 'network') && inc.targetId === targetId;
    }
    if (targetKind === 'room') {
      return (
        (inc.targetKind === 'room' && inc.targetId === targetId) ||
        (alsoMatchRoomId && inc.roomId === targetId)
      );
    }
    return inc.targetKind === targetKind && inc.targetId === targetId;
  });

  if (matches.length === 0) {
    return { openCount: 0, totalCount: 0, maxRpn: 0, worstIncident: null, level: 'clear', shortLabel: '' };
  }

  const active = matches.filter((m) => m.status === 'open' || m.status === 'investigating');
  const pool = active.length > 0 ? active : matches;
  const sorted = [...pool].sort((a, b) => b.rpn - a.rpn);
  const worst = sorted[0];
  const maxRpn = worst.rpn;

  if (active.length === 0) {
    return {
      openCount: 0,
      totalCount: matches.length,
      maxRpn,
      worstIncident: worst,
      level: 'mitigated',
      shortLabel: 'MIT',
    };
  }

  const level: FmeaTargetSummary['level'] =
    maxRpn >= 200 ? 'critical' : maxRpn >= 100 ? 'high' : 'medium';

  return {
    openCount: active.length,
    totalCount: matches.length,
    maxRpn,
    worstIncident: worst,
    level,
    shortLabel: `RPN ${maxRpn}`,
  };
}

const STORAGE_KEY = 'gradian_risk_fmea_incidents_v1';

function buildSeedIncidents(): RiskIncidentRecord[] {
  const now = new Date();
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

  return [
    {
      id: 'inc-seed-dp-fill',
      code: 'INC-2026-041',
      kind: 'drift',
      status: 'open',
      source: 'auto-telemetry',
      targetKind: 'room',
      targetId: 'rm-filling',
      targetCode: 'A0-103',
      targetName: 'Aseptic Vial Filling Suite (Grade A/B)',
      floorId: 'fl-a-0',
      roomId: 'rm-filling',
      sensorTag: 'PDT-A0103-01',
      currentValueLabel: '+37.8 Pa (Target +45 Pa)',
      title: 'Grade B Differential Pressure Cascade Drift (-7.2 Pa)',
      failureMode: 'HEPA Differential Pressure Cascade Decay',
      effect: 'Potential loss of positive pressure barrier into Grade A isolator zone & batch quarantine.',
      cause: 'Supply AHU-01 damper actuator hysteresis and pre-filter ΔP loading above 280 Pa.',
      currentControls: 'BMS continuous ΔP alarm at +35 Pa; daily cleanroom pressure log.',
      severity: 8,
      occurrence: 6,
      detection: 5,
      rpn: 240,
      initialRpn: 240,
      owner: 'Dr. N. Rahimi · Sterile Ops',
      createdAt: minsAgo(28),
      updatedAt: minsAgo(6),
    },
    {
      id: 'inc-seed-br2001-do',
      code: 'INC-2026-042',
      kind: 'drift',
      status: 'investigating',
      source: 'auto-telemetry',
      targetKind: 'asset',
      targetId: 'ast-br-2001',
      targetCode: 'BR-2001',
      targetName: 'Production Bioreactor BR-2001',
      floorId: 'fl-a-0',
      roomId: 'rm-upstream',
      sensorTag: 'DOT-BR2001-01',
      currentValueLabel: '34.2% DO (Target 40% ±3%)',
      title: 'Dissolved Oxygen Control Loop Drift in Fed-Batch Day 6',
      failureMode: 'Sparger Mass Transfer Efficiency Drift & Optical DO Probe Fouling',
      effect: 'Sub-optimal cell viability, lactate spike, and potential mAb glycosylation shift.',
      cause: 'Micro-sparger partial bio-fouling combined with 90-day optical probe drift.',
      currentControls: 'SCADA cascade O2 enrichment PID; offline blood-gas analyzer checks every 12h.',
      severity: 9,
      occurrence: 5,
      detection: 5,
      rpn: 225,
      initialRpn: 225,
      owner: 'Eng. S. Karimi · Upstream Lead',
      createdAt: minsAgo(65),
      updatedAt: minsAgo(14),
    },
    {
      id: 'inc-seed-coldroom-temp',
      code: 'INC-2026-043',
      kind: 'alarm',
      status: 'open',
      source: 'auto-telemetry',
      targetKind: 'room',
      targetId: 'rm-cold-storage',
      targetCode: 'A0-104',
      targetName: 'Cold Room 2–8°C Biologics Storage',
      floorId: 'fl-a-0',
      roomId: 'rm-cold-storage',
      sensorTag: 'TT-A0104-01',
      currentValueLabel: '8.7 °C (Limit 2.0–8.0 °C)',
      title: 'Cold Room 2–8°C High-Temperature Excursion Alarm',
      failureMode: 'Evaporator Defrost Solenoid Valve Sticking Open',
      effect: 'Thermal stability excursion risk for stored bulk drug substance (BDS) containers.',
      cause: 'Delayed post-defrost cut-in relay combined with frequent door opening during staging.',
      currentControls: 'Dual redundant PT100 probes; SMS escalation after 10 min > 8.0 °C.',
      severity: 8,
      occurrence: 6,
      detection: 7,
      rpn: 336,
      initialRpn: 336,
      owner: 'M. Azizi · Cold Chain QA',
      createdAt: minsAgo(12),
      updatedAt: minsAgo(3),
    },
    {
      id: 'inc-seed-hplc-press',
      code: 'INC-2026-044',
      kind: 'drift',
      status: 'open',
      source: 'auto-telemetry',
      targetKind: 'asset',
      targetId: 'ast-hplc-01',
      targetCode: 'HPLC-01',
      targetName: 'Agilent 1290 Infinity II UHPLC',
      floorId: 'fl-a-1',
      roomId: 'rm-qc-lab',
      sensorTag: 'PT-HPLC01-01',
      currentValueLabel: '448 bar (+11% baseline drift)',
      title: 'UHPLC System Backpressure Rising Drift Trend',
      failureMode: 'In-Line Solvent Frit & Guard Column Particulate Restriction',
      effect: 'Peak broadening, retention time drift, and invalidated QC release assay sequence.',
      cause: 'Buffer salt precipitation during overnight standby flush cycle.',
      currentControls: 'Empower CDS system suitability SST check prior to batch injection.',
      severity: 6,
      occurrence: 6,
      detection: 4,
      rpn: 144,
      initialRpn: 144,
      owner: 'Dr. L. Moradi · QC Analytical',
      createdAt: minsAgo(110),
      updatedAt: minsAgo(22),
    },
    {
      id: 'inc-seed-line-mab',
      code: 'INC-2026-045',
      kind: 'fmea-risk',
      status: 'open',
      source: 'manual',
      targetKind: 'line',
      targetId: 'line-mab-01',
      targetCode: 'LINE-01',
      targetName: 'mAb Drug Substance & Aseptic Fill-Finish Line',
      floorId: 'fl-a-0',
      title: 'Cross-Suite Airlock Interlock & Bioreactor Transfer Hold-Time Risk',
      failureMode: 'Simultaneous Airlock Interlock Override During Harvest Transfer',
      effect: 'Grade C-to-B cross-contamination risk and batch release hold under EU GMP Annex 1.',
      cause: 'Operator pass-through timing overlap when staging harvest bags alongside CIP turnover.',
      currentControls: 'Electronic magnetic interlock + badge audit log + SOP-OPS-018 line clearance.',
      severity: 8,
      occurrence: 5,
      detection: 6,
      rpn: 240,
      initialRpn: 240,
      owner: 'Dr. N. Rahimi · QA Director',
      createdAt: minsAgo(240),
      updatedAt: minsAgo(45),
    },
    {
      id: 'inc-seed-it-crc',
      code: 'INC-2026-046',
      kind: 'alarm',
      status: 'open',
      source: 'auto-telemetry',
      targetKind: 'network',
      targetId: 'ast-idf-a0',
      targetCode: 'IDF-A0-01',
      targetName: 'Floor A0 IDF Rack · Catalyst 2960-X [Gi1/0/3]',
      floorId: 'fl-a-0',
      sensorTag: 'CRC-BADGE-PAL01',
      currentValueLabel: '18 CRC/min · 4.2% Loss',
      title: 'Access Switch 2960-X Port CRC Error Burst (Airlock Badge Reader)',
      failureMode: 'Cat6A Patch Termination Oxidation / EMI Coupling on PoE Drop',
      effect: 'Intermittent cleanroom badge interlock latency & dropped audit telemetry frames.',
      cause: 'Unshielded patch cord routed parallel to 400V VFD motor feeder conduit.',
      currentControls: 'SNMPv3 port error trap; secondary failover badge controller on VLAN-55.',
      severity: 6,
      occurrence: 6,
      detection: 4,
      rpn: 144,
      initialRpn: 144,
      owner: 'A. Hosseini · OT/IT Network NOC',
      createdAt: minsAgo(19),
      updatedAt: minsAgo(4),
    },
  ];
}

function loadInitialIncidents(): RiskIncidentRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  return buildSeedIncidents();
}

function saveIncidents(list: RiskIncidentRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

interface RiskIncidentState {
  incidents: RiskIncidentRecord[];
  autoLogEnabled: boolean;
  riskModalOpen: boolean;
  riskModalPrefill: RiskModalPrefill | null;
  assetPdfModalOpen: boolean;
  assetPdfTargetId: string | null;

  setAutoLogEnabled: (enabled: boolean) => void;
  openRiskModal: (prefill: RiskModalPrefill) => void;
  closeRiskModal: () => void;
  openAssetPdfModal: (assetId?: string | null) => void;
  closeAssetPdfModal: () => void;

  /** Bind seeded IDs cleanly to the active scene's real rooms/assets/lines if IDs differ */
  reconcileWithScene: (
    scene: DigitalTwinScene,
    productionLines: { id: string; code: string; name: string }[]
  ) => void;

  /** Automatically logs or updates incidents when live telemetry enters alarm or warning drift */
  syncTelemetryAnomalies: (
    sensors: SensorDefinition[],
    readings: Record<string, LiveSensorSnapshot>,
    scene: DigitalTwinScene
  ) => void;

  addManualRiskIncident: (input: {
    kind: RiskIncidentKind;
    targetKind: RiskTargetKind;
    targetId: string;
    targetCode: string;
    targetName: string;
    floorId?: string;
    roomId?: string;
    title: string;
    failureMode: string;
    effect: string;
    cause: string;
    currentControls: string;
    severity: number;
    occurrence: number;
    detection: number;
    owner: string;
    currentValueLabel?: string;
  }) => RiskIncidentRecord;

  updateFmeaScores: (id: string, severity: number, occurrence: number, detection: number) => void;
  updateIncidentStatus: (id: string, status: IncidentStatus) => void;
  attachAiResolution: (id: string, plan: AiResolutionPlan) => void;
  markAiResolutionApplied: (id: string, workOrderId?: string) => void;
  deleteIncident: (id: string) => void;
}

export const useRiskIncidentStore = create<RiskIncidentState>((set, get) => ({
  incidents: loadInitialIncidents(),
  autoLogEnabled: true,
  riskModalOpen: false,
  riskModalPrefill: null,
  assetPdfModalOpen: false,
  assetPdfTargetId: null,

  setAutoLogEnabled: (enabled) => set({ autoLogEnabled: enabled }),

  openRiskModal: (prefill) => set({ riskModalOpen: true, riskModalPrefill: prefill }),
  closeRiskModal: () => set({ riskModalOpen: false, riskModalPrefill: null }),
  openAssetPdfModal: (assetId = null) =>
    set({ assetPdfModalOpen: true, assetPdfTargetId: assetId ?? null }),
  closeAssetPdfModal: () => set({ assetPdfModalOpen: false }),

  reconcileWithScene: (scene, productionLines) => {
    const current = get().incidents;
    let changed = false;

    const updated = current.map((inc) => {
      if (inc.targetKind === 'room') {
        const exists = scene.rooms.some((r) => r.id === inc.targetId);
        if (!exists && scene.rooms.length > 0) {
          const match =
            scene.rooms.find((r) => r.code.toLowerCase() === inc.targetCode.toLowerCase()) ??
            scene.rooms.find((r) =>
              inc.targetName.toLowerCase().includes('cold')
                ? /cold|stor|ware/i.test(r.name)
                : /fill|asep|clean|upst/i.test(r.name)
            ) ??
            scene.rooms[0];
          changed = true;
          return {
            ...inc,
            targetId: match.id,
            targetCode: match.code,
            targetName: match.name,
            floorId: match.floorId,
            roomId: match.id,
          };
        }
      } else if (inc.targetKind === 'asset' || inc.targetKind === 'network') {
        const exists = scene.assets.some((a) => a.id === inc.targetId);
        if (!exists && scene.assets.length > 0) {
          const match =
            scene.assets.find((a) => a.assetId.toLowerCase() === inc.targetCode.toLowerCase()) ??
            scene.assets.find((a) =>
              inc.targetKind === 'network'
                ? a.category === 'IT & Data Center' || Boolean(a.rackConfig)
                : inc.targetCode.startsWith('HPLC')
                  ? /hplc|chrom|lab/i.test(a.name)
                  : /bio|react/i.test(a.name)
            ) ??
            scene.assets[0];
          changed = true;
          return {
            ...inc,
            targetId: match.id,
            targetCode: match.assetId,
            targetName: match.name,
            floorId: match.floorId,
            roomId: match.roomId,
          };
        }
      } else if (inc.targetKind === 'line') {
        const exists = productionLines.some((l) => l.id === inc.targetId);
        if (!exists && productionLines.length > 0) {
          const match =
            productionLines.find((l) => l.code.toLowerCase() === inc.targetCode.toLowerCase()) ??
            productionLines[0];
          changed = true;
          return {
            ...inc,
            targetId: match.id,
            targetCode: match.code,
            targetName: match.name,
          };
        }
      }
      return inc;
    });

    if (changed) {
      saveIncidents(updated);
      set({ incidents: updated });
    }
  },

  syncTelemetryAnomalies: (sensors, readings, scene) => {
    if (!get().autoLogEnabled || sensors.length === 0) return;
    const current = get().incidents;
    const next = [...current];
    let mutated = false;
    const nowIso = new Date().toISOString();

    for (const s of sensors) {
      const snap = readings[s.id];
      if (!snap) continue;
      if (snap.status !== 'alarm' && snap.status !== 'warning') continue;

      const valueLabel = `${snap.value.toFixed(s.precision)} ${s.unit} (Limit ${s.alarmLow}–${s.alarmHigh})`;
      const existingIdx = next.findIndex(
        (inc) =>
          (inc.sensorId === s.id || inc.sensorTag === s.tag) &&
          inc.status !== 'closed'
      );

      if (existingIdx >= 0) {
        const ex = next[existingIdx];
        if (ex.currentValueLabel !== valueLabel || (snap.status === 'alarm' && ex.kind !== 'alarm')) {
          next[existingIdx] = {
            ...ex,
            kind: snap.status === 'alarm' ? 'alarm' : ex.kind,
            currentValueLabel: valueLabel,
            updatedAt: nowIso,
          };
          mutated = true;
        }
        continue;
      }

      // Limit auto-created open telemetry incidents to avoid flooding during chaos scenarios
      const openAutoCount = next.filter((x) => x.source === 'auto-telemetry' && x.status === 'open').length;
      if (openAutoCount >= 14) continue;

      const isAlarm = snap.status === 'alarm';
      const sev = isAlarm ? 8 : 6;
      const occ = isAlarm ? 6 : 5;
      const det = isAlarm ? 6 : 4;
      const rpn = computeRpn(sev, occ, det);

      const roomObj =
        s.targetKind === 'room'
          ? scene.rooms.find((r) => r.id === s.targetId)
          : scene.rooms.find((r) =>
              scene.assets.some((a) => a.id === s.targetId && a.roomId === r.id)
            );

      const seq = 100 + next.length + 1;
      next.unshift({
        id: `inc-auto-${s.id}-${Date.now()}`,
        code: `INC-2026-${seq}`,
        kind: isAlarm ? 'alarm' : 'drift',
        status: 'open',
        source: 'auto-telemetry',
        targetKind: s.targetKind === 'room' ? 'room' : 'asset',
        targetId: s.targetId,
        targetCode: s.targetCode,
        targetName: s.targetName,
        floorId: s.floorId,
        roomId: roomObj?.id,
        sensorId: s.id,
        sensorTag: s.tag,
        currentValueLabel: valueLabel,
        title: `${s.tag} · ${s.name} ${isAlarm ? 'Excursion Alarm' : 'Parameter Drift'}`,
        failureMode: `${s.metric.toUpperCase()} out-of-trend deviation on ${s.targetName}`,
        effect: isAlarm
          ? `Direct GxP compliance threshold breach on ${s.targetCode}; batch impact assessment required.`
          : `Approaching upper/lower action limit (${s.warnLow}–${s.warnHigh} ${s.unit}); predictive drift flagged.`,
        cause: `Automated telemetry stream (${s.protocol}) detected ${snap.trend} excursion beyond nominal setpoint ${s.nominal} ${s.unit}.`,
        currentControls: `Real-time ${s.protocol} monitoring at ${s.samplingHz} Hz (PLC ${s.plcAddress}).`,
        severity: sev,
        occurrence: occ,
        detection: det,
        rpn,
        initialRpn: rpn,
        owner: 'QA / Facilities Shift Lead',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      mutated = true;
    }

    if (mutated) {
      saveIncidents(next);
      set({ incidents: next });
    }
  },

  addManualRiskIncident: (input) => {
    const nowIso = new Date().toISOString();
    const current = get().incidents;
    const rpn = computeRpn(input.severity, input.occurrence, input.detection);
    const seq = 200 + current.length + 1;
    const record: RiskIncidentRecord = {
      id: `inc-man-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      code: `FMEA-2026-${seq}`,
      kind: input.kind,
      status: 'open',
      source: 'manual',
      targetKind: input.targetKind,
      targetId: input.targetId,
      targetCode: input.targetCode,
      targetName: input.targetName,
      floorId: input.floorId,
      roomId: input.roomId,
      currentValueLabel: input.currentValueLabel,
      title: input.title.trim(),
      failureMode: input.failureMode.trim(),
      effect: input.effect.trim(),
      cause: input.cause.trim(),
      currentControls: input.currentControls.trim() || 'Routine GMP visual inspection & BMS alarm',
      severity: Math.max(1, Math.min(10, Math.round(input.severity))),
      occurrence: Math.max(1, Math.min(10, Math.round(input.occurrence))),
      detection: Math.max(1, Math.min(10, Math.round(input.detection))),
      rpn,
      initialRpn: rpn,
      owner: input.owner.trim() || 'QA Engineering',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const next = [record, ...current];
    saveIncidents(next);
    set({ incidents: next });
    return record;
  },

  updateFmeaScores: (id, severity, occurrence, detection) => {
    const rpn = computeRpn(severity, occurrence, detection);
    const next = get().incidents.map((inc) =>
      inc.id === id
        ? {
            ...inc,
            severity: Math.max(1, Math.min(10, Math.round(severity))),
            occurrence: Math.max(1, Math.min(10, Math.round(occurrence))),
            detection: Math.max(1, Math.min(10, Math.round(detection))),
            rpn,
            updatedAt: new Date().toISOString(),
          }
        : inc
    );
    saveIncidents(next);
    set({ incidents: next });
  },

  updateIncidentStatus: (id, status) => {
    const next = get().incidents.map((inc) =>
      inc.id === id ? { ...inc, status, updatedAt: new Date().toISOString() } : inc
    );
    saveIncidents(next);
    set({ incidents: next });
  },

  attachAiResolution: (id, plan) => {
    const next = get().incidents.map((inc) =>
      inc.id === id
        ? {
            ...inc,
            status: inc.status === 'open' ? ('investigating' as IncidentStatus) : inc.status,
            aiResolution: plan,
            updatedAt: new Date().toISOString(),
          }
        : inc
    );
    saveIncidents(next);
    set({ incidents: next });
  },

  markAiResolutionApplied: (id, workOrderId) => {
    const next = get().incidents.map((inc) => {
      if (inc.id !== id || !inc.aiResolution) return inc;
      const plan = inc.aiResolution;
      return {
        ...inc,
        status: 'mitigated' as IncidentStatus,
        severity: plan.residualSeverity,
        occurrence: plan.residualOccurrence,
        detection: plan.residualDetection,
        rpn: plan.residualRpn,
        linkedWorkOrderId: workOrderId ?? inc.linkedWorkOrderId,
        aiResolution: { ...plan, applied: true },
        updatedAt: new Date().toISOString(),
      };
    });
    saveIncidents(next);
    set({ incidents: next });
  },

  deleteIncident: (id) => {
    const next = get().incidents.filter((inc) => inc.id !== id);
    saveIncidents(next);
    set({ incidents: next });
  },
}));
