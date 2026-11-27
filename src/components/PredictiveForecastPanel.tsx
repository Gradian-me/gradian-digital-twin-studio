import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  DollarSign,
  ExternalLink,
  Gauge,
  GitBranch,
  History,
  Loader2,
  Package,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { evaluateProductionLine, useGmpStore } from '../store/useGmpStore';
import { addDaysToIso, todayIso } from '../data/gmpDemoData';
import type { SpatialAsset } from '../types/twin';
import type {
  EquipmentComplianceRecord,
  ProductionLine,
  ServiceActionType,
  WorkOrderPriority,
} from '../types/gmp';
import type { LiveSensorSnapshot, SensorDefinition } from '../types/telemetry';

export interface CriticalMaintenanceAlert {
  id: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  severity: 'breach' | 'imminent' | 'drift';
  gxpStandard: string;
  sensorId: string;
  sensorTag: string;
  sensorName: string;
  metric: string;
  unit: string;
  currentValue: number;
  thresholdValue: number;
  direction: 'high' | 'low';
  trend: 'rising' | 'falling' | 'stable';
  deltaPerTick: number;
  predictedDeviationDays: number;
  predictedDeviationDate: string;
  marginPct: number; // 0 = breached, 100 = at nominal
  estimatedBatchImpactUsd: number;
  summary: string;
  isRoomEms: boolean;
}

export interface AssetPredictiveForecast {
  asset: SpatialAsset;
  compliance: EquipmentComplianceRecord | null;
  lineIds: string[];
  primaryLineId: string | null;
  primaryLineCode: string;
  primaryLineName: string;
  primaryLineStatus: ProductionLine['status'] | 'unassigned';
  usageHours: number;
  utilizationPct: number;
  mtbfDays: number;
  healthIndex: number; // 0-100
  daysToFailure: number;
  uncertaintyDays: number;
  estimatedFailureDate: string;
  earliestFailureDate: string;
  latestFailureDate: string;
  nextScheduledServiceDate: string;
  daysToNextScheduled: number;
  failsBeforeScheduledPm: boolean;
  riskBand: 'critical' | 'high' | 'watch' | 'healthy';
  primaryFailureMode: string;
  contributingFactors: string[];
  telemetryStressCount: number;
  historicalIncidentCount: number;
  lifecycleEventCount: number;
  recentEventDates: { date: string; daysFromToday: number; outcome: string; title: string }[];
  // World-class EAM & EMS fields
  boundSensors: { sensor: SensorDefinition; reading: LiveSensorSnapshot | null; isRoomEms: boolean }[];
  criticalAlert: CriticalMaintenanceAlert | null;
  allAlerts: CriticalMaintenanceAlert[];
  sparePartName: string;
  sparePartStatus: 'in-stock' | 'low-stock' | 'lead-4d';
  sparePartQty: number;
  unplannedCostUsd: number;
  preventiveCostUsd: number;
  downtimeHoursRisk: number;
}

interface TimelineChartDatum {
  assetId: string;
  assetCode: string;
  assetName: string;
  axisLabel: string;
  lineCode: string;
  lineName: string;
  lineStatus: ProductionLine['status'] | 'unassigned';
  lineEligible: boolean | null;
  blockingCount: number;
  daysToFailure: number;
  clampedFailureDays: number;
  uncertaintyDays: number;
  estimatedFailureDate: string;
  earliestFailureDate: string;
  latestFailureDate: string;
  daysToNextScheduled: number;
  clampedPmDays: number | null;
  nextScheduledServiceDate: string;
  failsBeforeScheduledPm: boolean;
  healthIndex: number;
  usageHours: number;
  utilizationPct: number;
  mtbfDays: number;
  historicalIncidentCount: number;
  lifecycleEventCount: number;
  riskBand: AssetPredictiveForecast['riskBand'];
  primaryFailureMode: string;
  color: string;
  // Critical Maintenance Alert overlay coordinate
  alertDay: number | null;
  alertSeverity: CriticalMaintenanceAlert['severity'] | null;
  alertSummary: string | null;
  alertSensorTag: string | null;
  alertCurrentValue: string | null;
  alertThresholdValue: string | null;
  alertGxpStandard: string | null;
  alertDeviationDate: string | null;
  alertBatchImpactUsd: number;
}

interface AiEamDiagnosis {
  headline: string;
  severityVerdict: 'IMMEDIATE_HOLD' | 'EXPEDITED_PM' | 'SCHEDULED_WATCH' | string;
  gxpComplianceAssessment: string;
  rootCauseHypotheses: {
    cause: string;
    confidencePct: number;
    telemetryEvidence: string;
  }[];
  recommendedWorkOrder: {
    title: string;
    serviceType: string;
    priority: string;
    estimatedHours: number;
    dueInDays: number;
    sopReference: string;
    requiredParts: string[];
    checklist: string[];
  };
  downtimeCostComparison: {
    unplannedCostUsd: number;
    preventiveCostUsd: number;
    downtimeHoursSaved: number;
    batchRiskMitigated: string;
  };
  optimizationRecommendations: string[];
  modelUsed?: string;
}

const FAILURE_MODES_BY_CATEGORY: Record<string, string[]> = {
  Biopharmaceutical: [
    'Mechanical Agitator Seal / Diaphragm Valve Wear',
    'Condenser Elastomer Gasket & Vacuum Drift',
    'DO / pH Probe Membrane Drift Beyond GMP Limit',
    'SIP Steam Trap Fouling & Thermal Lag',
  ],
  Laboratory: [
    'HPLC Quaternary Pump Piston Seal Fatigue',
    'UV-Vis Lamp Intensity Decay & Baseline Noise',
    'Isolator HEPA Pressure Drop & Airflow Imbalance',
  ],
  'HVAC & Utilities': [
    'HEPA Terminal Filter ΔP Saturation',
    'WFI Loop Heat Exchanger Fouling',
    'AHU Supply Fan Bearing Vibration Spike',
  ],
  'IT & Data Center': [
    'UPS Battery String Impedance Degradation',
    'PLC Redundant Power Supply Thermal Drift',
  ],
  'Warehouse & Logistics': [
    'Cold-Chain Compressor Thermal Cycling Fatigue',
    'Door Seal Frost & Humidity Ingress',
  ],
};

const SPARE_PARTS_BY_CATEGORY: Record<string, string[]> = {
  Biopharmaceutical: [
    '316L Mechanical Seal Kit (EPDM/PTFE)',
    'Hamilton Optical DO/pH Sensor Cartridge',
    'Sanitary Diaphragm Valve Rebuild Kit',
    'SIP Sanitary Steam Trap Assembly',
  ],
  Laboratory: [
    'UHPLC Sapphire Piston & Seal Pack',
    'Deuterium UV Lamp Module (2000h)',
    'H14 Terminal HEPA Cartridge (Iso)',
  ],
  'HVAC & Utilities': [
    'HEPA H14 Gel-Seal Filter Module',
    'Sanitary Plate Heat Exchanger Gasket Set',
    'VFD Bearing & Belt Service Kit',
  ],
  'IT & Data Center': [
    'VRLA Redundant Battery Cartridge',
    '24VDC Redundant PLC Power Module',
  ],
  'Warehouse & Logistics': [
    'Scroll Compressor Contactor & Valve Kit',
    'Cryo-Grade EPDM Door Gasket',
  ],
};

const EMS_SCENARIOS: { id: string | null; label: string }[] = [
  { id: null, label: 'Nominal EMS' },
  { id: 'bioreactor-thermal-excursion', label: 'Bioreactor Thermal' },
  { id: 'cleanroom-pressure-drop', label: 'Cleanroom ΔP Drop' },
  { id: 'hplc-overpressure', label: 'HPLC Overpressure' },
  { id: 'humidity-spike', label: 'Humidity Spike' },
];

function diffDays(isoA: string, isoB: string): number {
  const a = new Date(`${isoA}T00:00:00`).getTime();
  const b = new Date(`${isoB}T00:00:00`).getTime();
  return Math.round((a - b) / 86400000);
}

function deterministicSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function formatShortDate(iso: string): string {
  const dt = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatUsd(val: number): string {
  if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
  if (val >= 1000) return `$${Math.round(val / 1000)}k`;
  return `$${Math.round(val)}`;
}

function resolveGxpStandard(metric: string, isRoomEms: boolean): string {
  if (isRoomEms || metric === 'pressure' || metric === 'particles' || metric === 'humidity') {
    return 'EU GMP Annex 1 (EMS Environmental Control)';
  }
  if (metric === 'temperature' || metric === 'ph' || metric === 'dissolved-o2') {
    return 'FDA 21 CFR 211.68 (Critical Process Parameter)';
  }
  if (metric === 'vessel-pressure' || metric === 'flow-rate' || metric === 'uv-absorbance') {
    return 'ICH Q7 / USP <1058> (Analytical & Process Qualification)';
  }
  return 'FDA 21 CFR Part 11 / EU GMP Annex 15';
}

function computeSensorGxpAlert(
  asset: SpatialAsset,
  sensor: SensorDefinition,
  reading: LiveSensorSnapshot | null,
  isRoomEms: boolean,
  today: string,
  batchImpactUsd: number,
  complianceOverdue: boolean
): CriticalMaintenanceAlert | null {
  if (!reading) return null;

  const upperSpan = Math.max(0.01, sensor.alarmHigh - sensor.nominal);
  const lowerSpan = Math.max(0.01, sensor.nominal - sensor.alarmLow);
  const highDist = sensor.alarmHigh - reading.value;
  const lowDist = reading.value - sensor.alarmLow;

  const highRatio = highDist / upperSpan; // <=0 breached, ~0.25-0.45 warning
  const lowRatio = lowDist / lowerSpan;

  const closerHigh = highRatio <= lowRatio;
  const direction: 'high' | 'low' = closerHigh ? 'high' : 'low';
  const thresholdValue = closerHigh ? sensor.alarmHigh : sensor.alarmLow;
  const warnBoundary = closerHigh ? sensor.warnHigh : sensor.warnLow;
  const closestMarginRatio = Math.min(highRatio, lowRatio);
  const marginPct = Math.max(0, Math.min(100, Math.round(closestMarginRatio * 100)));

  // Linear slope over recent history
  const hist = reading.history ?? [];
  let slope = reading.delta;
  if (hist.length >= 6) {
    const recent = hist.slice(-6);
    slope = (recent[recent.length - 1].value - recent[0].value) / (recent.length - 1);
  }
  const driftingTowardLimit =
    (direction === 'high' && (reading.trend === 'rising' || slope > 0)) ||
    (direction === 'low' && (reading.trend === 'falling' || slope < 0));

  const gxpStandard = resolveGxpStandard(sensor.metric, isRoomEms);

  // Case 1: Active GxP Alarm Breach
  if (reading.status === 'alarm') {
    const predictedDeviationDays = 1;
    return {
      id: `alrt-${asset.id}-${sensor.id}`,
      assetId: asset.id,
      assetCode: asset.assetId,
      assetName: asset.name,
      severity: 'breach',
      gxpStandard,
      sensorId: sensor.id,
      sensorTag: sensor.tag,
      sensorName: sensor.name,
      metric: sensor.metric,
      unit: sensor.unit,
      currentValue: reading.value,
      thresholdValue,
      direction,
      trend: reading.trend,
      deltaPerTick: Number(slope.toFixed(sensor.precision + 1)),
      predictedDeviationDays,
      predictedDeviationDate: addDaysToIso(today, predictedDeviationDays),
      marginPct: 0,
      estimatedBatchImpactUsd: batchImpactUsd,
      summary: `${sensor.tag} at ${reading.value}${sensor.unit} breached GxP ${direction === 'high' ? 'Alarm High' : 'Alarm Low'} (${thresholdValue}${sensor.unit})`,
      isRoomEms,
    };
  }

  // Case 2: Active Warning — Imminent GxP Deviation
  if (reading.status === 'warning') {
    const days = Math.max(2, Math.min(11, Math.round(2 + (marginPct / 35) * 7)));
    return {
      id: `alrt-${asset.id}-${sensor.id}`,
      assetId: asset.id,
      assetCode: asset.assetId,
      assetName: asset.name,
      severity: 'imminent',
      gxpStandard,
      sensorId: sensor.id,
      sensorTag: sensor.tag,
      sensorName: sensor.name,
      metric: sensor.metric,
      unit: sensor.unit,
      currentValue: reading.value,
      thresholdValue,
      direction,
      trend: reading.trend,
      deltaPerTick: Number(slope.toFixed(sensor.precision + 1)),
      predictedDeviationDays: days,
      predictedDeviationDate: addDaysToIso(today, days),
      marginPct,
      estimatedBatchImpactUsd: Math.round(batchImpactUsd * 0.85),
      summary: `${sensor.tag} (${reading.value}${sensor.unit}) inside GxP Action Band (Warn ${warnBoundary}${sensor.unit} -> Limit ${thresholdValue}${sensor.unit})`,
      isRoomEms,
    };
  }

  // Case 3: Drift trajectory toward GxP threshold OR sensor overdue calibration on stressed asset
  const calDays = sensor.calibrationDue ? diffDays(sensor.calibrationDue, today) : 120;
  const nearWarnMargin = closestMarginRatio <= 0.58 && driftingTowardLimit;
  const calRiskOnOverdue = !isRoomEms && (calDays <= 14 || complianceOverdue) && sensor.isMainSensor;

  if (nearWarnMargin || calRiskOnOverdue) {
    const days = calRiskOnOverdue
      ? Math.max(4, Math.min(14, complianceOverdue ? 6 : Math.max(4, calDays)))
      : Math.max(7, Math.min(22, Math.round(closestMarginRatio * 28)));
    return {
      id: `alrt-${asset.id}-${sensor.id}`,
      assetId: asset.id,
      assetCode: asset.assetId,
      assetName: asset.name,
      severity: 'drift',
      gxpStandard,
      sensorId: sensor.id,
      sensorTag: sensor.tag,
      sensorName: sensor.name,
      metric: sensor.metric,
      unit: sensor.unit,
      currentValue: reading.value,
      thresholdValue,
      direction,
      trend: reading.trend,
      deltaPerTick: Number(slope.toFixed(sensor.precision + 1)),
      predictedDeviationDays: days,
      predictedDeviationDate: addDaysToIso(today, days),
      marginPct,
      estimatedBatchImpactUsd: Math.round(batchImpactUsd * 0.6),
      summary: calRiskOnOverdue
        ? `${sensor.tag} calibration/GMP drift risk (${reading.value}${sensor.unit} vs ${thresholdValue}${sensor.unit} limit)`
        : `${sensor.tag} drifting ${reading.trend} toward ${thresholdValue}${sensor.unit} (${marginPct}% headroom)`,
      isRoomEms,
    };
  }

  return null;
}

export function buildAssetForecasts(
  assets: SpatialAsset[],
  complianceMap: Record<string, EquipmentComplianceRecord>,
  productionLines: ProductionLine[],
  sensors: SensorDefinition[],
  readings: Record<string, LiveSensorSnapshot>
): AssetPredictiveForecast[] {
  const today = todayIso();

  return assets.map((asset) => {
    const comp = complianceMap[asset.id] ?? null;
    const seed = deterministicSeed(asset.id + asset.assetId);
    const events = comp?.lifecycleEvents ?? [];

    const sortedDates = [...events]
      .map((e) => e.date)
      .filter(Boolean)
      .sort();

    let avgInterval = comp?.maintenance.intervalDays ?? 180;
    if (sortedDates.length >= 2) {
      let sum = 0;
      let count = 0;
      for (let i = 1; i < sortedDates.length; i++) {
        const gap = Math.abs(diffDays(sortedDates[i], sortedDates[i - 1]));
        if (gap >= 10 && gap <= 730) {
          sum += gap;
          count++;
        }
      }
      if (count > 0) avgInterval = Math.round(sum / count);
    }

    const failEvents = events.filter((e) => e.outcome === 'fail' || e.stage === 'deviation-capa').length;
    const condEvents = events.filter((e) => e.outcome === 'conditional').length;

    const matchedLines = productionLines.filter((l) => l.assetIds.includes(asset.id));
    const primaryLine = matchedLines[0] ?? null;
    const primaryLineStatus: AssetPredictiveForecast['primaryLineStatus'] = primaryLine
      ? primaryLine.status
      : 'unassigned';

    // Collect asset-specific sensors + host cleanroom EMS sensors
    const assetSensors = sensors.filter((s) => s.targetKind === 'asset' && s.targetId === asset.id);
    const roomEmsSensors = asset.roomId
      ? sensors.filter((s) => s.targetKind === 'room' && s.targetId === asset.roomId)
      : [];

    const boundSensors = [
      ...assetSensors.map((sensor) => ({
        sensor,
        reading: readings[sensor.id] ?? null,
        isRoomEms: false,
      })),
      ...roomEmsSensors.map((sensor) => ({
        sensor,
        reading: readings[sensor.id] ?? null,
        isRoomEms: true,
      })),
    ];

    const alarmSensors = boundSensors.filter((b) => b.reading?.status === 'alarm').length;
    const warnSensors = boundSensors.filter((b) => b.reading?.status === 'warning').length;
    const telemetryStressCount = alarmSensors * 2 + warnSensors;

    // Usage history derived from lifecycle span, production line status, and telemetry load
    const baseDailyHours =
      primaryLineStatus === 'active'
        ? 18.5
        : primaryLineStatus === 'changeover'
          ? 14.5
          : primaryLineStatus === 'maintenance-hold'
            ? 11.0
            : primaryLineStatus === 'standby'
              ? 8.5
              : 14.0;
    const operatingDaysHistory = Math.max(95, 160 + events.length * 42 + (seed % 210));
    const usageHours = Math.round(operatingDaysHistory * baseDailyHours + telemetryStressCount * 140);
    const utilizationPct = Math.min(
      98,
      Math.max(
        42,
        Math.round(
          (primaryLineStatus === 'active'
            ? 81
            : primaryLineStatus === 'changeover'
              ? 74
              : primaryLineStatus === 'maintenance-hold'
                ? 64
                : primaryLineStatus === 'standby'
                  ? 54
                  : 72) +
            (seed % 13) +
            telemetryStressCount * 3
        )
      )
    );

    const dueCandidates = comp
      ? [comp.calibration.nextDueDate, comp.qualification.nextDueDate, comp.maintenance.nextDueDate]
      : [asset.nextMaintenance || addDaysToIso(today, 90)];
    const nextScheduledServiceDate = [...dueCandidates].sort()[0] ?? addDaysToIso(today, 90);
    const daysToNextScheduled = diffDays(nextScheduledServiceDate, today);

    const overdueCount = comp
      ? [comp.calibration.status, comp.qualification.status, comp.maintenance.status].filter(
          (st) => st === 'overdue'
        ).length
      : 0;
    const dueSoonCount = comp
      ? [comp.calibration.status, comp.qualification.status, comp.maintenance.status].filter(
          (st) => st === 'due-soon'
        ).length
      : 0;

    // Cost & batch risk model per equipment category
    const baseBatchExposure =
      asset.category === 'Biopharmaceutical'
        ? 240000
        : asset.category === 'Laboratory'
          ? 68000
          : asset.category === 'HVAC & Utilities'
            ? 145000
            : 48000;
    const estimatedBatchImpactUsd = Math.round(
      baseBatchExposure * (primaryLine ? 1.15 : 0.72) + (seed % 32) * 1000
    );

    // Evaluate all Critical Maintenance Alerts from live telemetry
    const severityRank = { breach: 0, imminent: 1, drift: 2 };
    const allAlerts: CriticalMaintenanceAlert[] = [];
    for (const bs of boundSensors) {
      const al = computeSensorGxpAlert(
        asset,
        bs.sensor,
        bs.reading,
        bs.isRoomEms,
        today,
        estimatedBatchImpactUsd,
        overdueCount > 0
      );
      if (al) allAlerts.push(al);
    }
    allAlerts.sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        a.predictedDeviationDays - b.predictedDeviationDays
    );
    const criticalAlert = allAlerts[0] ?? null;

    const lastMaintDate = comp?.maintenance.lastDate ?? addDaysToIso(today, -60);
    const daysSinceLastMaint = Math.max(1, diffDays(today, lastMaintDate));
    const loadMultiplier =
      primaryLineStatus === 'active'
        ? 0.92
        : primaryLineStatus === 'maintenance-hold'
          ? 0.86
          : primaryLineStatus === 'changeover'
            ? 0.96
            : primaryLineStatus === 'standby'
              ? 1.12
              : 1.0;

    const mtbfDays = Math.max(
      45,
      Math.round(avgInterval * (1.15 - failEvents * 0.14 - condEvents * 0.06) * loadMultiplier)
    );

    let daysToFailure: number;
    if (criticalAlert?.severity === 'breach') {
      daysToFailure = Math.max(3, Math.min(12, 8 - alarmSensors * 2 + (seed % 4)));
    } else if (overdueCount > 0) {
      daysToFailure = Math.max(6, 24 - overdueCount * 6 - telemetryStressCount * 3 + (seed % 7));
    } else if (dueSoonCount > 0 || warnSensors > 0) {
      daysToFailure = Math.max(16, 46 - dueSoonCount * 8 - telemetryStressCount * 6 + (seed % 15));
    } else {
      const wearFactor = 0.55 + (utilizationPct / 100) * 0.25;
      const baseRemaining = Math.max(25, mtbfDays - Math.round(daysSinceLastMaint * wearFactor));
      daysToFailure = Math.min(
        320,
        Math.max(28, baseRemaining - failEvents * 18 - telemetryStressCount * 10 + (seed % 28))
      );
    }

    const uncertaintyDays = Math.max(4, Math.min(26, Math.round(daysToFailure * 0.18)));
    const estimatedFailureDate = addDaysToIso(today, daysToFailure);
    const earliestFailureDate = addDaysToIso(today, Math.max(2, daysToFailure - uncertaintyDays));
    const latestFailureDate = addDaysToIso(today, daysToFailure + uncertaintyDays);

    const healthIndex = Math.max(
      12,
      Math.min(
        98,
        Math.round(
          100 -
            overdueCount * 22 -
            dueSoonCount * 10 -
            failEvents * 12 -
            condEvents * 6 -
            telemetryStressCount * 11 -
            (criticalAlert?.severity === 'breach' ? 18 : criticalAlert?.severity === 'imminent' ? 9 : 0) -
            Math.max(0, 45 - daysToFailure) * 0.42
        )
      )
    );

    const riskBand: AssetPredictiveForecast['riskBand'] =
      criticalAlert?.severity === 'breach' || daysToFailure <= 30 || healthIndex < 45
        ? 'critical'
        : criticalAlert?.severity === 'imminent' || daysToFailure <= 65 || healthIndex < 68
          ? 'high'
          : daysToFailure <= 130
            ? 'watch'
            : 'healthy';

    const modes = FAILURE_MODES_BY_CATEGORY[asset.category] ?? [
      'Component Mechanical Wear & Tolerance Drift',
    ];
    const primaryFailureMode = modes[seed % modes.length];

    const parts = SPARE_PARTS_BY_CATEGORY[asset.category] ?? ['OEM Preventive Seal & Sensor Kit'];
    const sparePartName = parts[seed % parts.length];
    const sparePartQty = (seed % 6) === 0 ? 0 : (seed % 4) + 1;
    const sparePartStatus: AssetPredictiveForecast['sparePartStatus'] =
      sparePartQty === 0 ? 'lead-4d' : sparePartQty === 1 ? 'low-stock' : 'in-stock';

    const preventiveCostUsd = Math.round(
      (asset.category === 'Biopharmaceutical' ? 6800 : 3200) + (seed % 18) * 150
    );
    const unplannedCostUsd = Math.round(
      preventiveCostUsd * 4.8 + (primaryLine ? estimatedBatchImpactUsd * 0.42 : 18000)
    );
    const downtimeHoursRisk = Math.round(
      (asset.category === 'Biopharmaceutical' ? 36 : 18) + (overdueCount + alarmSensors) * 8
    );

    const contributingFactors: string[] = [];
    if (criticalAlert) {
      contributingFactors.push(
        `CRITICAL EMS ALERT: ${criticalAlert.summary} (${criticalAlert.gxpStandard})`
      );
    }
    if (overdueCount > 0) {
      contributingFactors.push(`${overdueCount} overdue GMP compliance cycle(s) accelerating degradation`);
    }
    if (failEvents > 0) {
      contributingFactors.push(`${failEvents} historical deviation/failure event(s) shortened MTBF to ${mtbfDays}d`);
    }
    if (condEvents > 0) {
      contributingFactors.push(`${condEvents} conditional pass inspection(s) in audit history`);
    }
    if (primaryLine) {
      contributingFactors.push(
        `Assigned to ${primaryLine.code} (${primaryLine.status.toUpperCase()}) at ${utilizationPct}% duty load (${usageHours.toLocaleString()} cumulative hrs)`
      );
    }
    if (daysToFailure < daysToNextScheduled && daysToNextScheduled > 0) {
      contributingFactors.push(
        `Estimated failure (${estimatedFailureDate}) precedes next scheduled PM (${nextScheduledServiceDate})`
      );
    }
    if (contributingFactors.length === 0) {
      contributingFactors.push(`Stable historical lifecycle (${events.length} passed milestones · MTBF ${mtbfDays}d)`);
    }

    const lineIds = matchedLines.map((l) => l.id);

    const recentEventDates = events
      .map((ev) => ({
        date: ev.date,
        daysFromToday: diffDays(ev.date, today),
        outcome: ev.outcome,
        title: ev.title,
      }))
      .filter((e) => e.daysFromToday <= 0 && e.daysFromToday >= -180)
      .slice(0, 6);

    return {
      asset,
      compliance: comp,
      lineIds,
      primaryLineId: primaryLine?.id ?? null,
      primaryLineCode: primaryLine?.code ?? 'FAC-UTIL',
      primaryLineName: primaryLine?.name ?? 'Shared Facility Utility',
      primaryLineStatus,
      usageHours,
      utilizationPct,
      mtbfDays,
      healthIndex,
      daysToFailure,
      uncertaintyDays,
      estimatedFailureDate,
      earliestFailureDate,
      latestFailureDate,
      nextScheduledServiceDate,
      daysToNextScheduled,
      failsBeforeScheduledPm: daysToNextScheduled > 0 && daysToFailure < daysToNextScheduled,
      riskBand,
      primaryFailureMode,
      contributingFactors,
      telemetryStressCount,
      historicalIncidentCount: failEvents + condEvents,
      lifecycleEventCount: events.length,
      recentEventDates,
      boundSensors,
      criticalAlert,
      allAlerts,
      sparePartName,
      sparePartStatus,
      sparePartQty,
      unplannedCostUsd,
      preventiveCostUsd,
      downtimeHoursRisk,
    };
  });
}

/** Custom SVG overlay marker plotted natively inside Recharts when telemetry indicates imminent GxP deviation */
const CriticalAlertScatterShape = (props: any) => {
  const { cx, cy, payload } = props ?? {};
  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload?.alertSeverity) {
    return null;
  }
  const severity: CriticalMaintenanceAlert['severity'] = payload.alertSeverity;
  const isBreach = severity === 'breach';
  const isImminent = severity === 'imminent';
  const fill = isBreach ? '#E11D48' : isImminent ? '#F43F5E' : '#F59E0B';
  const halo = isBreach ? 'rgba(225,29,72,0.28)' : isImminent ? 'rgba(244,63,94,0.24)' : 'rgba(245,158,11,0.22)';

  if (severity === 'drift') {
    // High-contrast Amber Warning Triangle
    return (
      <g className="cursor-pointer">
        <circle cx={cx} cy={cy} r={12} fill={halo} />
        <polygon
          points={`${cx},${cy - 8.5} ${cx + 8.5},${cy + 6.5} ${cx - 8.5},${cy + 6.5}`}
          fill={fill}
          stroke="#111116"
          strokeWidth={1.5}
        />
        <text
          x={cx}
          y={cy + 3.5}
          textAnchor="middle"
          fill="#111116"
          fontSize={9.5}
          fontWeight={900}
          fontFamily="ui-monospace, SFMono-Regular, monospace"
        >
          !
        </text>
      </g>
    );
  }

  // High-contrast Crimson Critical Maintenance Alert Octagon/Shield
  return (
    <g className="cursor-pointer">
      <circle cx={cx} cy={cy} r={13} fill={halo} stroke={fill} strokeWidth={1} strokeOpacity={0.55} />
      <polygon
        points={`${cx - 4},${cy - 8.5} ${cx + 4},${cy - 8.5} ${cx + 8.5},${cy - 4} ${cx + 8.5},${cy + 4} ${cx + 4},${cy + 8.5} ${cx - 4},${cy + 8.5} ${cx - 8.5},${cy + 4} ${cx - 8.5},${cy - 4}`}
        fill={fill}
        stroke="#FFFFFF"
        strokeWidth={1.4}
      />
      <text
        x={cx}
        y={cy + 3.5}
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize={10.5}
        fontWeight={900}
        fontFamily="ui-monospace, SFMono-Regular, monospace"
      >
        !
      </text>
    </g>
  );
};

interface PredictiveForecastPanelProps {
  isDark: boolean;
  onFlyToAsset3D: (assetId: string) => void;
  onOpenWorkflowsTab: () => void;
}

export const PredictiveForecastPanel: React.FC<PredictiveForecastPanelProps> = ({
  isDark,
  onFlyToAsset3D,
  onOpenWorkflowsTab,
}) => {
  const scene = useTwinStore((s) => s.scene);
  const showToast = useTwinStore((s) => s.showToast);

  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const activeScenario = useTelemetryStore((s) => s.activeScenario);
  const triggerScenario = useTelemetryStore((s) => s.triggerScenario);
  const openTelemetryDashboard = useTelemetryStore((s) => s.openDashboard);
  const fetchLiveSnapshot = useTelemetryStore((s) => s.fetchLiveSnapshot);
  const initialized = useTelemetryStore((s) => s.initialized);

  const complianceByAssetId = useGmpStore((s) => s.complianceByAssetId);
  const productionLines = useGmpStore((s) => s.productionLines);
  const workOrders = useGmpStore((s) => s.workOrders);
  const personnel = useGmpStore((s) => s.personnel);
  const getEligiblePersonnel = useGmpStore((s) => s.getEligiblePersonnel);
  const createWorkOrder = useGmpStore((s) => s.createWorkOrder);
  const createWorkflow = useGmpStore((s) => s.createWorkflow);
  const checkLineEligibility = useGmpStore((s) => s.checkLineEligibility);

  const [horizonDays, setHorizonDays] = useState<90 | 180 | 365>(180);
  const [lineFilter, setLineFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<'all' | 'alerts' | 'high-plus' | 'critical'>('all');
  const [chartSortMode, setChartSortMode] = useState<'urgency' | 'alerts' | 'line'>('urgency');
  const [showCriticalAlertOverlay, setShowCriticalAlertOverlay] = useState(true);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'overview' | 'ai-copilot' | 'ems-live'>('overview');
  const [selectedSensorId, setSelectedSensorId] = useState<string | null>(null);

  // AI-First EAM Diagnostics State (keyed by assetId or 'fleet')
  const [aiDiagByKey, setAiDiagByKey] = useState<Record<string, AiEamDiagnosis>>({});
  const [aiLoadingKey, setAiLoadingKey] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized) {
      fetchLiveSnapshot(scene);
    }
  }, [initialized, fetchLiveSnapshot, scene]);

  const today = useMemo(() => todayIso(), []);

  const forecasts = useMemo(
    () =>
      buildAssetForecasts(
        scene.assets,
        complianceByAssetId,
        productionLines,
        sensors,
        readings
      ),
    [scene.assets, complianceByAssetId, productionLines, sensors, readings]
  );

  const lineEvaluations = useMemo(() => {
    const map: Record<string, ReturnType<typeof evaluateProductionLine>> = {};
    for (const line of productionLines) {
      map[line.id] = evaluateProductionLine(line, scene, complianceByAssetId, workOrders);
    }
    return map;
  }, [productionLines, scene, complianceByAssetId, workOrders]);

  const riskColor = (band: AssetPredictiveForecast['riskBand']) => {
    switch (band) {
      case 'critical':
        return '#F43F5E';
      case 'high':
        return '#F59E0B';
      case 'watch':
        return '#8B5CF6';
      default:
        return '#10B981';
    }
  };

  const alertSeverityMeta = (sev: CriticalMaintenanceAlert['severity']) => {
    if (sev === 'breach') {
      return { label: '✖ GxP Breach', color: '#E11D48', bg: 'bg-rose-500/15 border-rose-500/40 text-rose-400' };
    }
    if (sev === 'imminent') {
      return { label: '▲ Imminent Deviation', color: '#F43F5E', bg: 'bg-rose-500/12 border-rose-500/35 text-rose-300' };
    }
    return { label: '◆ Drift Alert', color: '#F59E0B', bg: 'bg-amber-500/12 border-amber-500/35 text-amber-300' };
  };

  const filteredForecasts = useMemo(() => {
    return forecasts
      .filter((f) => {
        if (lineFilter !== 'all' && !f.lineIds.includes(lineFilter)) return false;
        if (riskFilter === 'alerts' && !f.criticalAlert) return false;
        if (riskFilter === 'critical' && f.riskBand !== 'critical') return false;
        if (riskFilter === 'high-plus' && f.riskBand !== 'critical' && f.riskBand !== 'high') {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.daysToFailure - b.daysToFailure);
  }, [forecasts, lineFilter, riskFilter]);

  // All active Critical Maintenance Alerts across fleet
  const fleetAlerts = useMemo(
    () =>
      forecasts
        .filter((f) => f.criticalAlert !== null)
        .map((f) => f.criticalAlert!)
        .sort((a, b) => a.predictedDeviationDays - b.predictedDeviationDays),
    [forecasts]
  );

  const totalBatchExposureUsd = useMemo(
    () => fleetAlerts.reduce((acc, a) => acc + a.estimatedBatchImpactUsd, 0),
    [fleetAlerts]
  );

  // Recharts timeline dataset: plots Estimated Failure Date + Critical GxP Alert Overlay + Scheduled PM
  const timelineChartData = useMemo<TimelineChartDatum[]>(() => {
    const sorted = [...filteredForecasts];
    if (chartSortMode === 'alerts') {
      const rank = { breach: 0, imminent: 1, drift: 2 };
      sorted.sort((a, b) => {
        const ra = a.criticalAlert ? rank[a.criticalAlert.severity] : 9;
        const rb = b.criticalAlert ? rank[b.criticalAlert.severity] : 9;
        if (ra !== rb) return ra - rb;
        return a.daysToFailure - b.daysToFailure;
      });
    } else if (chartSortMode === 'line') {
      sorted.sort((a, b) => {
        const cmp = a.primaryLineCode.localeCompare(b.primaryLineCode);
        return cmp !== 0 ? cmp : a.daysToFailure - b.daysToFailure;
      });
    }

    return sorted.slice(0, 15).map((f) => {
      const ev = f.primaryLineId ? lineEvaluations[f.primaryLineId] : null;
      const lineTag = ev && !ev.eligible ? `${f.primaryLineCode}!` : f.primaryLineCode;
      const al = f.criticalAlert;
      return {
        assetId: f.asset.id,
        assetCode: f.asset.assetId,
        assetName: f.asset.name,
        axisLabel: `${f.asset.assetId} · ${lineTag}`,
        lineCode: f.primaryLineCode,
        lineName: f.primaryLineName,
        lineStatus: f.primaryLineStatus,
        lineEligible: ev ? ev.eligible : null,
        blockingCount: ev?.blockingCount ?? 0,
        daysToFailure: f.daysToFailure,
        clampedFailureDays: Math.min(horizonDays, Math.max(2, f.daysToFailure)),
        uncertaintyDays: f.uncertaintyDays,
        estimatedFailureDate: f.estimatedFailureDate,
        earliestFailureDate: f.earliestFailureDate,
        latestFailureDate: f.latestFailureDate,
        daysToNextScheduled: f.daysToNextScheduled,
        clampedPmDays:
          f.daysToNextScheduled >= 0 && f.daysToNextScheduled <= horizonDays
            ? f.daysToNextScheduled
            : null,
        nextScheduledServiceDate: f.nextScheduledServiceDate,
        failsBeforeScheduledPm: f.failsBeforeScheduledPm,
        healthIndex: f.healthIndex,
        usageHours: f.usageHours,
        utilizationPct: f.utilizationPct,
        mtbfDays: f.mtbfDays,
        historicalIncidentCount: f.historicalIncidentCount,
        lifecycleEventCount: f.lifecycleEventCount,
        riskBand: f.riskBand,
        primaryFailureMode: f.primaryFailureMode,
        color: riskColor(f.riskBand),
        alertDay:
          al && al.predictedDeviationDays <= horizonDays
            ? Math.max(1, al.predictedDeviationDays)
            : null,
        alertSeverity: al?.severity ?? null,
        alertSummary: al?.summary ?? null,
        alertSensorTag: al?.sensorTag ?? null,
        alertCurrentValue: al ? `${al.currentValue}${al.unit}` : null,
        alertThresholdValue: al ? `${al.thresholdValue}${al.unit}` : null,
        alertGxpStandard: al?.gxpStandard ?? null,
        alertDeviationDate: al?.predictedDeviationDate ?? null,
        alertBatchImpactUsd: al?.estimatedBatchImpactUsd ?? 0,
      };
    });
  }, [filteredForecasts, chartSortMode, lineEvaluations, horizonDays]);

  const timelineChartHeight = Math.max(260, Math.min(500, timelineChartData.length * 34 + 54));

  const xAxisTicks = useMemo(() => {
    const step = horizonDays === 90 ? 15 : horizonDays === 180 ? 30 : 60;
    const ticks: number[] = [];
    for (let d = 0; d <= horizonDays; d += step) {
      ticks.push(d);
    }
    return ticks;
  }, [horizonDays]);

  const swimlanes = useMemo(() => {
    const lanes: {
      id: string;
      code: string;
      name: string;
      status: string;
      eligible: boolean | null;
      blockingCount: number;
      color: string;
      items: AssetPredictiveForecast[];
    }[] = [];

    const visibleLines =
      lineFilter === 'all'
        ? productionLines
        : productionLines.filter((l) => l.id === lineFilter);

    for (const line of visibleLines) {
      const ev = lineEvaluations[line.id];
      const items = filteredForecasts.filter((f) => f.lineIds.includes(line.id));
      lanes.push({
        id: line.id,
        code: line.code,
        name: line.name,
        status: line.status,
        eligible: ev ? ev.eligible : null,
        blockingCount: ev?.blockingCount ?? 0,
        color: line.color,
        items,
      });
    }

    if (lineFilter === 'all') {
      const assignedIds = new Set(productionLines.flatMap((l) => l.assetIds));
      const unassigned = filteredForecasts.filter((f) => !assignedIds.has(f.asset.id));
      if (unassigned.length > 0) {
        lanes.push({
          id: 'unassigned',
          code: 'FAC-UTIL',
          name: 'Shared Facility & Lab Utilities',
          status: 'active',
          eligible: null,
          blockingCount: 0,
          color: '#64748B',
          items: unassigned.slice(0, 6),
        });
      }
    }
    return lanes;
  }, [productionLines, lineEvaluations, filteredForecasts, lineFilter]);

  const activeForecast = useMemo(
    () =>
      filteredForecasts.find((f) => f.asset.id === selectedAssetId) ??
      filteredForecasts[0] ??
      null,
    [filteredForecasts, selectedAssetId]
  );

  // Selected sensor for live EMS sparkline inside right-hand inspector
  const activeSensorBinding = useMemo(() => {
    if (!activeForecast || activeForecast.boundSensors.length === 0) return null;
    return (
      activeForecast.boundSensors.find((b) => b.sensor.id === selectedSensorId) ??
      activeForecast.boundSensors.find((b) => b.sensor.id === activeForecast.criticalAlert?.sensorId) ??
      activeForecast.boundSensors[0]
    );
  }, [activeForecast, selectedSensorId]);

  const liveSensorSparkData = useMemo(() => {
    const hist = activeSensorBinding?.reading?.history ?? [];
    return hist.slice(-24).map((pt, idx) => ({
      idx: idx + 1,
      timeLabel: new Date(pt.ts).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
      value: pt.value,
      status: pt.status,
    }));
  }, [activeSensorBinding]);

  // KPI metrics
  const criticalCount = forecasts.filter((f) => f.riskBand === 'critical').length;
  const failsBeforePmCount = forecasts.filter((f) => f.failsBeforeScheduledPm).length;
  const avgHealth =
    forecasts.length > 0
      ? Math.round(forecasts.reduce((acc, f) => acc + f.healthIndex, 0) / forecasts.length)
      : 100;

  // Recharts Weibull Survival Probability Curve dataset for selected asset
  const survivalCurveData = useMemo(() => {
    if (!activeForecast) return [];
    const eta = Math.max(15, activeForecast.daysToFailure * 1.25);
    const beta = activeForecast.riskBand === 'critical' ? 2.4 : 1.85;
    const pts: { day: number; dateLabel: string; survivalPct: number }[] = [];
    for (let day = 0; day <= 180; day += 10) {
      const surv = Math.exp(-Math.pow(day / eta, beta));
      pts.push({
        day,
        dateLabel: day === 0 ? 'Today' : formatShortDate(addDaysToIso(today, day)),
        survivalPct: Math.round(surv * 1000) / 10,
      });
    }
    return pts;
  }, [activeForecast, today]);

  // Run Server-Side Gemini AI-First EAM / EMS Diagnosis
  const handleRunAiDiagnosis = async (mode: 'asset-triage' | 'fleet-optimization', target?: AssetPredictiveForecast | null) => {
    const f = target ?? activeForecast;
    if (mode === 'asset-triage' && !f) return;
    const key = mode === 'fleet-optimization' ? 'fleet' : f!.asset.id;

    setInspectorTab('ai-copilot');
    setAiError(null);
    setAiLoadingKey(key);

    try {
      const payload = {
        mode,
        assetContext: f
          ? {
              assetCode: f.asset.assetId,
              assetName: f.asset.name,
              category: f.asset.category,
              manufacturer: f.asset.manufacturer,
              model: f.asset.model,
              productionLine: {
                code: f.primaryLineCode,
                name: f.primaryLineName,
                status: f.primaryLineStatus,
                eligible: f.primaryLineId ? lineEvaluations[f.primaryLineId]?.eligible ?? null : null,
              },
              usageHours: f.usageHours,
              utilizationPct: f.utilizationPct,
              mtbfDays: f.mtbfDays,
              healthIndex: f.healthIndex,
              estimatedFailureDate: f.estimatedFailureDate,
              daysToFailure: f.daysToFailure,
              nextScheduledServiceDate: f.nextScheduledServiceDate,
              failsBeforeScheduledPm: f.failsBeforeScheduledPm,
              primaryFailureMode: f.primaryFailureMode,
              sparePart: {
                name: f.sparePartName,
                status: f.sparePartStatus,
                qtyOnHand: f.sparePartQty,
              },
              criticalAlert: f.criticalAlert,
              liveTelemetry: f.boundSensors.slice(0, 6).map((bs) => ({
                tag: bs.sensor.tag,
                name: bs.sensor.name,
                metric: bs.sensor.metric,
                unit: bs.sensor.unit,
                currentValue: bs.reading?.value ?? null,
                status: bs.reading?.status ?? 'unknown',
                trend: bs.reading?.trend ?? 'stable',
                warnLow: bs.sensor.warnLow,
                warnHigh: bs.sensor.warnHigh,
                alarmLow: bs.sensor.alarmLow,
                alarmHigh: bs.sensor.alarmHigh,
                calibrationDue: bs.sensor.calibrationDue,
              })),
            }
          : null,
        fleetSummary: {
          totalAssets: forecasts.length,
          criticalAssets: criticalCount,
          activeGxpAlertsCount: fleetAlerts.length,
          totalBatchExposureUsd,
          activeEmsScenario: activeScenario,
          topAlerts: fleetAlerts.slice(0, 6).map((a) => ({
            assetCode: a.assetCode,
            severity: a.severity,
            sensorTag: a.sensorTag,
            summary: a.summary,
            predictedDeviationDate: a.predictedDeviationDate,
            batchImpactUsd: a.estimatedBatchImpactUsd,
          })),
        },
      };

      const res = await fetch('/api/eam/ai-diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'AI diagnostic engine returned an error.');
      }
      setAiDiagByKey((prev) => ({ ...prev, [key]: data as AiEamDiagnosis }));
    } catch (err: any) {
      setAiError(err?.message || 'Unable to reach AI diagnostic service.');
    } finally {
      setAiLoadingKey(null);
    }
  };

  const handleDispatchAiWorkOrder = (diag: AiEamDiagnosis, f: AssetPredictiveForecast) => {
    const validServices: ServiceActionType[] = [
      'maintenance',
      'calibration',
      'qualification',
      'cleaning-cip-sip',
      'corrective-repair',
      'inspection',
    ];
    const svc: ServiceActionType = validServices.includes(
      diag.recommendedWorkOrder.serviceType as ServiceActionType
    )
      ? (diag.recommendedWorkOrder.serviceType as ServiceActionType)
      : 'maintenance';

    const validPriorities: WorkOrderPriority[] = ['critical', 'high', 'medium', 'low'];
    const prio: WorkOrderPriority = validPriorities.includes(
      diag.recommendedWorkOrder.priority as WorkOrderPriority
    )
      ? (diag.recommendedWorkOrder.priority as WorkOrderPriority)
      : 'high';

    const eligible = getEligiblePersonnel(f.asset.category, svc);
    const tech = eligible[0] ?? personnel[0];
    const dueDate = addDaysToIso(
      todayIso(),
      Math.max(1, Math.min(30, Number(diag.recommendedWorkOrder.dueInDays) || 3))
    );

    const wo = createWorkOrder({
      title: diag.recommendedWorkOrder.title,
      description: `AI-Generated EAM Work Order (${diag.recommendedWorkOrder.sopReference}). ${diag.gxpComplianceAssessment} Required Parts: ${diag.recommendedWorkOrder.requiredParts.join(', ')}.`,
      serviceType: svc,
      targetKind: 'asset',
      targetId: f.asset.id,
      targetName: `${f.asset.assetId} · ${f.asset.name}`,
      targetCategory: f.asset.category,
      productionLineId: f.lineIds[0],
      assigneeId: tech?.id ?? 'tech-01',
      assigneeName: tech?.name ?? 'Sara Lindqvist',
      priority: prio,
      status: 'open',
      lastServiceDate: f.compliance?.maintenance.lastDate ?? todayIso(),
      dueDate,
      estimatedHours: Number(diag.recommendedWorkOrder.estimatedHours) || 3,
      checklist: diag.recommendedWorkOrder.checklist.map((text, idx) => ({
        id: `ai-chk-${Date.now()}-${idx}`,
        text,
        done: false,
      })),
    });
    showToast(`Dispatched AI Work Order ${wo.woNumber} due ${dueDate}`, 'success');
  };

  const handleLaunchPredictiveWorkflow = (f: AssetPredictiveForecast, customHeadline?: string) => {
    const line = productionLines.find((l) => f.lineIds.includes(l.id));
    const eligibleTechs = getEligiblePersonnel(f.asset.category, 'maintenance');
    const techName = eligibleTechs[0]?.name ?? personnel[0]?.name ?? 'Sara Lindqvist';

    createWorkflow({
      title:
        customHeadline ??
        `${f.criticalAlert ? 'GxP Alert CAPA' : 'Predictive Intervention'} — ${f.asset.assetId}`,
      description: f.criticalAlert
        ? `Triggered by Critical Maintenance Alert (${f.criticalAlert.summary}). ${f.criticalAlert.gxpStandard}. Est. Failure ${f.estimatedFailureDate} · Usage ${f.usageHours.toLocaleString()} hrs.`
        : `Generated from Predictive Maintenance Forecast. Est. failure ${f.estimatedFailureDate} (Health ${f.healthIndex}%, MTBF ${f.mtbfDays}d).`,
      workflowType: f.criticalAlert ? 'deviation-capa' : 'preventive-intervention',
      priority: f.criticalAlert?.severity === 'breach' || f.riskBand === 'critical' ? 'critical' : 'high',
      status: 'active',
      triggerSource: 'predictive-forecast',
      linkedLineId: line?.id,
      linkedLineName: line ? `${line.code} · ${line.name}` : undefined,
      linkedAssetId: f.asset.id,
      linkedAssetCode: f.asset.assetId,
      linkedAssetName: f.asset.name,
      predictedFailureDate: f.criticalAlert?.predictedDeviationDate ?? f.estimatedFailureDate,
      steps: [
        {
          id: `st-${Date.now()}-1`,
          title: 'GxP Telemetry Containment & Spare Parts Staging',
          roleRequired: 'Reliability Engineer',
          assigneeName: 'Marcus Vance',
          status: 'in-progress',
          slaHours: 4,
          notes: `Part: ${f.sparePartName} (${f.sparePartStatus}) · ${f.contributingFactors[0] ?? ''}`,
        },
        {
          id: `st-${Date.now()}-2`,
          title: `Preventive Intervention: ${f.primaryFailureMode}`,
          roleRequired: 'Certified Maintenance Tech',
          assigneeName: techName,
          status: 'pending',
          slaHours: 12,
        },
        {
          id: `st-${Date.now()}-3`,
          title: 'Post-Service Calibration & EMS Threshold Verification',
          roleRequired: 'Metrology Specialist',
          assigneeName: techName,
          status: 'pending',
          slaHours: 6,
        },
        {
          id: `st-${Date.now()}-4`,
          title: 'QA 21 CFR Part 11 Electronic Sign-Off & Line Release',
          roleRequired: 'QA / GMP Compliance Lead',
          assigneeName: 'Dr. Elena Rostova',
          status: 'pending',
          slaHours: 4,
        },
      ],
    });
    onOpenWorkflowsTab();
  };

  const handleCreatePreventiveWo = (f: AssetPredictiveForecast) => {
    const eligible = getEligiblePersonnel(f.asset.category, 'maintenance');
    const tech = eligible[0] ?? personnel[0];
    const targetDue = addDaysToIso(
      todayIso(),
      Math.max(1, Math.min(14, (f.criticalAlert?.predictedDeviationDays ?? f.daysToFailure) - 2))
    );
    const wo = createWorkOrder({
      title: `[${f.criticalAlert ? 'GxP Alert PM' : 'Predictive PM'}] ${f.asset.assetId} — ${f.primaryFailureMode}`,
      description: f.criticalAlert
        ? `Preventive intervention ahead of projected GxP deviation (${f.criticalAlert.summary}). Spare part: ${f.sparePartName}.`
        : `Pre-emptive maintenance scheduled ahead of estimated failure date ${f.estimatedFailureDate} (Health ${f.healthIndex}%).`,
      serviceType: 'maintenance',
      targetKind: 'asset',
      targetId: f.asset.id,
      targetName: `${f.asset.assetId} · ${f.asset.name}`,
      targetCategory: f.asset.category,
      productionLineId: f.lineIds[0],
      assigneeId: tech?.id ?? 'tech-01',
      assigneeName: tech?.name ?? 'Sara Lindqvist',
      priority: f.criticalAlert?.severity === 'breach' || f.riskBand === 'critical' ? 'critical' : 'high',
      status: 'open',
      lastServiceDate: f.compliance?.maintenance.lastDate ?? todayIso(),
      dueDate: targetDue,
      estimatedHours: 3.5,
      checklist: [
        { id: `chk-${Date.now()}-1`, text: `Inspect for ${f.primaryFailureMode}`, done: false },
        { id: `chk-${Date.now()}-2`, text: `Stage & install ${f.sparePartName}`, done: false },
        { id: `chk-${Date.now()}-3`, text: 'Verify live EMS/SCADA readings inside GxP nominal band', done: false },
      ],
    });
    showToast(`Created preventive ${wo.woNumber} due ${targetDue}`, 'success');
  };

  const activeLineEval =
    activeForecast?.primaryLineId ? lineEvaluations[activeForecast.primaryLineId] : null;
  const activeAiDiag = activeForecast
    ? aiDiagByKey[activeForecast.asset.id] ?? aiDiagByKey['fleet'] ?? null
    : aiDiagByKey['fleet'] ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y lg:overflow-hidden flex flex-col">
      {/* Top Enterprise EAM & EMS KPI Ribbon + Controls */}
      <div
        className={`px-3 sm:px-4 py-2.5 sm:py-3 border-b flex flex-col lg:flex-row lg:flex-wrap lg:items-center lg:justify-between gap-2.5 sm:gap-3 shrink-0 ${
          isDark ? 'bg-[#13131A] border-zinc-800' : 'bg-slate-50 border-slate-200'
        }`}
      >
        {/* Tabular KPI Strip (clean flat divider style) */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <button
            type="button"
            onClick={() => setRiskFilter(riskFilter === 'alerts' ? 'all' : 'alerts')}
            className="text-left group cursor-pointer"
          >
            <div className="text-[10px] font-semibold text-rose-400">
              Critical GxP Alerts
            </div>
            <div className="font-mono tabular-nums text-sm font-extrabold text-rose-500 flex items-center gap-1.5">
              <span>{fleetAlerts.length}</span>
              <span className="text-[10px] font-normal text-zinc-400 group-hover:text-rose-400">
                {totalBatchExposureUsd > 0 ? `${formatUsd(totalBatchExposureUsd)} risk` : 'Nominal'}
              </span>
            </div>
          </button>

          <div className={`h-7 w-px ${isDark ? 'bg-zinc-800' : 'bg-slate-200'}`} />

          <div>
            <div className="text-[10px] font-semibold text-amber-400">Pre-PM Collisions</div>
            <div className="font-mono tabular-nums text-sm font-extrabold text-amber-500">
              {failsBeforePmCount} <span className="text-[10px] font-normal text-zinc-400">assets</span>
            </div>
          </div>

          <div className={`h-7 w-px ${isDark ? 'bg-zinc-800' : 'bg-slate-200'}`} />

          <div>
            <div className="text-[10px] font-semibold text-zinc-400">Critical (&le;30d)</div>
            <div className="font-mono tabular-nums text-sm font-extrabold">
              {criticalCount} <span className="text-[10px] font-normal text-zinc-400">/ {forecasts.length}</span>
            </div>
          </div>

          <div className={`h-7 w-px ${isDark ? 'bg-zinc-800' : 'bg-slate-200'}`} />

          <div>
            <div className="text-[10px] font-semibold text-emerald-400">Fleet Health</div>
            <div className="font-mono tabular-nums text-sm font-extrabold text-emerald-500">
              {avgHealth}%
            </div>
          </div>
        </div>

        {/* Right EAM & EMS Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Live EMS Excursion Simulator Selector */}
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <select
              value={activeScenario ?? ''}
              onChange={(e) => {
                const val = e.target.value || null;
                triggerScenario(val);
                showToast(
                  val
                    ? `EMS excursion active: ${EMS_SCENARIOS.find((s) => s.id === val)?.label}`
                    : 'EMS telemetry restored to nominal limits',
                  val ? 'info' : 'success'
                );
              }}
              title="Simulate live EMS / SCADA threshold excursion"
              className={`px-2.5 py-1.5 text-xs rounded-lg border cursor-pointer ${
                activeScenario
                  ? 'bg-rose-500/15 border-rose-500/50 text-rose-300 font-semibold'
                  : isDark
                    ? 'bg-[#111116] border-zinc-700 text-zinc-200'
                    : 'bg-white border-slate-300 text-slate-800'
              }`}
            >
              {EMS_SCENARIOS.map((sc) => (
                <option key={sc.id ?? 'nominal'} value={sc.id ?? ''}>
                  EMS: {sc.label}
                </option>
              ))}
            </select>
          </div>

          <select
            value={lineFilter}
            onChange={(e) => setLineFilter(e.target.value)}
            className={`px-2.5 py-1.5 text-xs rounded-lg border cursor-pointer ${
              isDark ? 'bg-[#111116] border-zinc-700 text-zinc-200' : 'bg-white border-slate-300'
            }`}
          >
            <option value="all">All Production Lines</option>
            {productionLines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </select>

          {/* Risk Filter Segmented Control */}
          <div
            className={`flex items-center p-0.5 rounded-lg border text-[11px] ${
              isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
            }`}
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'alerts', label: `GxP Alerts (${fleetAlerts.length})` },
                { id: 'high-plus', label: 'High+' },
                { id: 'critical', label: 'Critical' },
              ] as const
            ).map((rf) => (
              <button
                key={rf.id}
                type="button"
                onClick={() => setRiskFilter(rf.id)}
                className={`px-2.5 py-1 rounded-md font-semibold transition whitespace-nowrap cursor-pointer ${
                  riskFilter === rf.id
                    ? rf.id === 'alerts'
                      ? 'bg-rose-600 text-white'
                      : 'bg-violet-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {rf.label}
              </button>
            ))}
          </div>

          {/* Horizon Selector */}
          <div
            className={`flex items-center p-0.5 rounded-lg border text-[11px] ${
              isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
            }`}
          >
            {([90, 180, 365] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizonDays(h)}
                className={`px-2 py-1 rounded-md font-mono font-semibold transition cursor-pointer ${
                  horizonDays === h
                    ? 'bg-amber-500 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {h}d
              </button>
            ))}
          </div>

          {/* Primary AI-First Action */}
          <button
            type="button"
            onClick={() => handleRunAiDiagnosis('fleet-optimization')}
            disabled={aiLoadingKey !== null}
            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition"
          >
            {aiLoadingKey === 'fleet' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            AI Fleet Triage
          </button>
        </div>
      </div>

      {/* Main Asymmetric Workspace: Unified smooth scroll on mobile, independent 2-column panes on desktop */}
      <div className="lg:flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-12 lg:overflow-hidden">
        {/* Left Stage */}
        <div className="lg:col-span-8 lg:min-h-0 lg:overflow-y-auto p-3 sm:p-4 space-y-4">
          {/* Active Critical GxP Alerts Action Strip (only when alerts exist) */}
          {fleetAlerts.length > 0 && (
            <div
              className={`rounded-xl border px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 ${
                isDark
                  ? 'bg-rose-950/25 border-rose-500/35 text-rose-100'
                  : 'bg-rose-50 border-rose-200 text-rose-950'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertOctagon className="w-4 h-4 text-rose-500 shrink-0" />
                <div className="min-w-0 text-xs">
                  <span className="font-bold">
                    {fleetAlerts.length} Imminent GxP Telemetry Deviation{fleetAlerts.length > 1 ? 's' : ''} Detected
                  </span>
                  <span className="mx-1.5 text-zinc-500">·</span>
                  <span className="font-mono tabular-nums text-rose-400 font-semibold">
                    {fleetAlerts[0].assetCode} ({fleetAlerts[0].sensorTag}: {fleetAlerts[0].currentValue}
                    {fleetAlerts[0].unit} vs {fleetAlerts[0].thresholdValue}
                    {fleetAlerts[0].unit})
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const topAsset = forecasts.find((f) => f.asset.id === fleetAlerts[0].assetId);
                    if (topAsset) {
                      setSelectedAssetId(topAsset.asset.id);
                      handleRunAiDiagnosis('asset-triage', topAsset);
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition"
                >
                  <Bot className="w-3 h-3" />
                  AI Diagnose Top Alert
                </button>
              </div>
            </div>
          )}

          {/* Primary Recharts Timeline Visualization Card */}
          <div
            className={`rounded-xl border overflow-hidden ${
              isDark ? 'bg-[#14141C] border-zinc-800' : 'bg-white border-slate-200'
            }`}
          >
            <div
              className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 ${
                isDark ? 'bg-[#181822] border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <BarChart3 className="w-4 h-4 text-violet-400 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-xs font-bold tracking-tight truncate">
                    Estimated Failure Date &amp; Critical GxP Maintenance Alert Timeline
                  </h3>
                  <p className="text-[11px] text-zinc-400 truncate">
                    Usage history, production line status &amp; live SCADA/EMS threshold breach overlays
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Toggle Critical Alert Overlay on Recharts */}
                <button
                  type="button"
                  onClick={() => setShowCriticalAlertOverlay((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    showCriticalAlertOverlay
                      ? 'bg-rose-500/15 border-rose-500/45 text-rose-300'
                      : isDark
                        ? 'bg-[#111116] border-zinc-700 text-zinc-400'
                        : 'bg-white border-slate-300 text-slate-500'
                  }`}
                >
                  <AlertOctagon className="w-3 h-3" />
                  Critical Alerts Overlay: {showCriticalAlertOverlay ? 'On' : 'Off'}
                </button>

                {/* Sort Segmented Control */}
                <div
                  className={`flex items-center p-0.5 rounded-lg border text-[10.5px] ${
                    isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
                  }`}
                >
                  {(
                    [
                      { id: 'urgency', label: 'Failure Date' },
                      { id: 'alerts', label: 'GxP Alerts First' },
                      { id: 'line', label: 'Prod Line' },
                    ] as const
                  ).map((sm) => (
                    <button
                      key={sm.id}
                      type="button"
                      onClick={() => setChartSortMode(sm.id)}
                      className={`px-2 py-1 rounded-md font-semibold transition whitespace-nowrap cursor-pointer ${
                        chartSortMode === sm.id
                          ? 'bg-violet-600 text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {sm.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Clean Typographic Legend */}
            <div className="px-4 pt-2.5 pb-1 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-zinc-400">
              <div className="flex flex-wrap items-center gap-3.5">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded-xs bg-rose-500 inline-block" />
                  Critical (&le;30d)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded-xs bg-amber-500 inline-block" />
                  High (31–65d)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded-xs bg-violet-500 inline-block" />
                  Watch
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded-xs bg-emerald-500 inline-block" />
                  Healthy
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rotate-45 bg-sky-400 inline-block" />
                  Scheduled PM
                </span>
                <span className="flex items-center gap-1.5 text-rose-300 font-semibold">
                  <span className="w-3.5 h-3.5 rounded-sm bg-rose-600 text-white font-mono text-[9px] font-black inline-flex items-center justify-center">
                    !
                  </span>
                  Critical GxP Alert
                </span>
              </div>
              <span className="font-mono tabular-nums text-[10px] text-zinc-500">
                ! on axis = Blocked Line · {timelineChartData.length} / {filteredForecasts.length} assets
              </span>
            </div>

            {/* Recharts ComposedChart Timeline */}
            <div className="px-2 pb-3 pt-1">
              {timelineChartData.length === 0 ? (
                <div className="h-52 flex flex-col items-center justify-center gap-2 text-xs text-zinc-500">
                  <span>No equipment assets match the active production line or risk filter.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLineFilter('all');
                      setRiskFilter('all');
                    }}
                    className="px-3 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:border-violet-500 cursor-pointer"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={timelineChartHeight}>
                  <ComposedChart
                    layout="vertical"
                    data={timelineChartData}
                    margin={{ top: 14, right: 28, bottom: 8, left: 6 }}
                    onClick={(state: any) => {
                      const clickedId = state?.activePayload?.[0]?.payload?.assetId ?? null;
                      if (clickedId) setSelectedAssetId(clickedId);
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke={isDark ? '#27272A' : '#E2E8F0'}
                    />
                    <XAxis
                      type="number"
                      domain={[0, horizonDays]}
                      ticks={xAxisTicks}
                      tickFormatter={(d: number) =>
                        d === 0 ? 'Today' : formatShortDate(addDaysToIso(today, d))
                      }
                      tick={{
                        fill: isDark ? '#A1A1AA' : '#475569',
                        fontSize: 10,
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      }}
                      axisLine={{ stroke: isDark ? '#3F3F46' : '#CBD5E1' }}
                      tickLine={{ stroke: isDark ? '#3F3F46' : '#CBD5E1' }}
                    />
                    <YAxis
                      type="category"
                      dataKey="axisLabel"
                      width={158}
                      tick={{
                        fill: isDark ? '#E4E4E7' : '#1E293B',
                        fontSize: 10.5,
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      }}
                      axisLine={{ stroke: isDark ? '#3F3F46' : '#CBD5E1' }}
                      tickLine={false}
                    />

                    {/* 30-Day Critical Risk Window */}
                    <ReferenceArea
                      x1={0}
                      x2={Math.min(30, horizonDays)}
                      fill="#F43F5E"
                      fillOpacity={isDark ? 0.09 : 0.07}
                      stroke="#F43F5E"
                      strokeOpacity={0.28}
                      strokeDasharray="3 3"
                    />
                    <ReferenceLine
                      x={0}
                      stroke="#8B5CF6"
                      strokeWidth={2}
                      label={{
                        value: 'TODAY',
                        position: 'insideTopRight',
                        fill: '#A78BFA',
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    />
                    <ReferenceLine
                      x={30}
                      stroke="#F43F5E"
                      strokeDasharray="4 4"
                      strokeOpacity={0.65}
                      label={{
                        value: '30d Risk Limit',
                        position: 'insideTopRight',
                        fill: '#FB7185',
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    />

                    <Tooltip
                      cursor={{ fill: isDark ? 'rgba(139,92,246,0.09)' : 'rgba(139,92,246,0.07)' }}
                      content={(tooltipProps: {
                        active?: boolean;
                        payload?: readonly { payload?: TimelineChartDatum }[];
                      }) => {
                        if (!tooltipProps.active || !tooltipProps.payload?.length) return null;
                        const row = tooltipProps.payload[0]?.payload;
                        if (!row) return null;
                        return (
                          <div
                            className={`rounded-xl border p-3 shadow-2xl max-w-sm text-[11px] space-y-2 ${
                              isDark
                                ? 'bg-[#101016]/96 border-zinc-700 text-zinc-100'
                                : 'bg-white/96 border-slate-300 text-slate-900'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-bold text-amber-400">
                                {row.assetCode}
                              </span>
                              <span className="font-mono text-[10px] font-bold" style={{ color: row.color }}>
                                {row.riskBand.toUpperCase()} RISK · {row.healthIndex}% HEALTH
                              </span>
                            </div>
                            <div className="font-bold text-xs leading-tight">{row.assetName}</div>

                            {/* Critical Maintenance Alert Callout inside Tooltip */}
                            {row.alertSeverity && (
                              <div
                                className={`rounded-lg border px-2.5 py-2 space-y-1 ${
                                  row.alertSeverity === 'drift'
                                    ? 'bg-amber-500/12 border-amber-500/40 text-amber-200'
                                    : 'bg-rose-500/15 border-rose-500/45 text-rose-100'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-extrabold">
                                  <span>
                                    {row.alertSeverity === 'breach'
                                      ? '✖ CRITICAL GxP THRESHOLD BREACH'
                                      : row.alertSeverity === 'imminent'
                                        ? '▲ IMMINENT GxP DEVIATION'
                                        : '◆ GxP TELEMETRY DRIFT ALERT'}
                                  </span>
                                  <span>{row.alertDeviationDate}</span>
                                </div>
                                <div className="text-[10.5px] leading-snug">{row.alertSummary}</div>
                                <div className="flex items-center justify-between text-[9.5px] font-mono opacity-90 pt-0.5">
                                  <span>{row.alertGxpStandard}</span>
                                  <span>Risk: {formatUsd(row.alertBatchImpactUsd)}</span>
                                </div>
                              </div>
                            )}

                            {/* Production Line & Usage History */}
                            <div className="flex items-center gap-2 text-[10.5px] text-zinc-400">
                              <span className="font-mono font-semibold text-violet-300">
                                {row.lineCode}
                              </span>
                              <span>·</span>
                              <span className="uppercase font-mono text-[10px]">{row.lineStatus}</span>
                              {row.lineEligible !== null && (
                                <>
                                  <span>·</span>
                                  <span
                                    className={`font-semibold ${
                                      row.lineEligible ? 'text-emerald-400' : 'text-rose-400'
                                    }`}
                                  >
                                    {row.lineEligible
                                      ? 'Line Eligible'
                                      : `Blocked (${row.blockingCount})`}
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-zinc-800/80 font-mono tabular-nums text-[10px]">
                              <div>
                                <div className="text-zinc-400 text-[9px]">Est. Failure Date</div>
                                <div className="font-bold" style={{ color: row.color }}>
                                  {row.estimatedFailureDate} ({row.daysToFailure}d)
                                </div>
                              </div>
                              <div>
                                <div className="text-zinc-400 text-[9px]">Next Scheduled PM</div>
                                <div className="font-bold text-sky-400">
                                  {row.nextScheduledServiceDate}
                                </div>
                              </div>
                              <div>
                                <div className="text-zinc-400 text-[9px]">Usage History</div>
                                <div className="font-bold">
                                  {row.usageHours.toLocaleString()}h · {row.utilizationPct}% load
                                </div>
                              </div>
                              <div>
                                <div className="text-zinc-400 text-[9px]">Historical MTBF</div>
                                <div className="font-bold text-violet-400">
                                  {row.mtbfDays}d ({row.lifecycleEventCount} logs)
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    />

                    {/* Remaining Useful Life Bar terminating at Estimated Failure Date */}
                    <Bar
                      dataKey="clampedFailureDays"
                      name="Est. Failure Date"
                      barSize={14}
                      radius={[0, 6, 6, 0]}
                      className="cursor-pointer"
                      onClick={(barData: any) => {
                        const id = barData?.assetId ?? barData?.payload?.assetId;
                        if (id) setSelectedAssetId(id);
                      }}
                    >
                      {timelineChartData.map((entry) => {
                        const isSelected = activeForecast?.asset.id === entry.assetId;
                        return (
                          <Cell
                            key={entry.assetId}
                            fill={entry.color}
                            fillOpacity={isSelected ? 1 : 0.72}
                            stroke={isSelected ? '#FFFFFF' : entry.color}
                            strokeWidth={isSelected ? 1.8 : 0.6}
                          />
                        );
                      })}
                    </Bar>

                    {/* Scheduled PM / Calibration Due Diamond Marker */}
                    <Scatter
                      dataKey="clampedPmDays"
                      name="Scheduled PM / Cal Due"
                      fill="#38BDF8"
                      shape="diamond"
                    />

                    {/* Critical Maintenance Alerts Telemetry Overlay */}
                    {showCriticalAlertOverlay && (
                      <Scatter
                        dataKey="alertDay"
                        name="Critical Maintenance Alert"
                        shape={<CriticalAlertScatterShape />}
                        onClick={(pt: any) => {
                          const id = pt?.assetId ?? pt?.payload?.assetId;
                          if (id) {
                            setSelectedAssetId(id);
                            setInspectorTab('overview');
                          }
                        }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Production Line Readiness & Asset Failure Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-violet-400" />
                Production Line Readiness &amp; Telemetry Alert Breakdown
              </h4>
              <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                {swimlanes.length} operational groups
              </span>
            </div>

            {swimlanes.map((lane) => {
              const earliestInLane = lane.items[0];
              const laneAlertCount = lane.items.filter((i) => i.criticalAlert !== null).length;
              return (
                <div
                  key={lane.id}
                  className={`rounded-xl border overflow-hidden ${
                    isDark ? 'bg-[#14141C] border-zinc-800' : 'bg-white border-slate-200'
                  }`}
                >
                  <div
                    className={`px-3.5 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 ${
                      isDark ? 'bg-[#181822] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 text-xs">
                      <span className="font-mono font-bold text-amber-400">{lane.code}</span>
                      <span className="font-bold truncate">{lane.name}</span>
                      <span className="text-zinc-500">·</span>
                      {lane.eligible !== null && (
                        <span
                          className={`inline-flex items-center gap-1 font-semibold text-[11px] ${
                            lane.eligible ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {lane.eligible ? (
                            <ShieldCheck className="w-3.5 h-3.5" />
                          ) : (
                            <ShieldAlert className="w-3.5 h-3.5" />
                          )}
                          {lane.eligible ? 'Eligible' : `Blocked (${lane.blockingCount})`}
                        </span>
                      )}
                      {laneAlertCount > 0 && (
                        <>
                          <span className="text-zinc-500">·</span>
                          <span className="font-mono text-[11px] font-bold text-rose-400">
                            {laneAlertCount} GxP alert{laneAlertCount > 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      {earliestInLane && (
                        <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                          Next Est. Fail:{' '}
                          <strong style={{ color: riskColor(earliestInLane.riskBand) }}>
                            {earliestInLane.estimatedFailureDate} ({earliestInLane.daysToFailure}d)
                          </strong>
                        </span>
                      )}
                      {lane.id !== 'unassigned' && (
                        <button
                          type="button"
                          onClick={() => {
                            checkLineEligibility(lane.id, scene, true);
                            showToast(`Highlighted ${lane.code} eligibility status on 2D/3D map`, 'info');
                          }}
                          className="px-2.5 py-1 rounded-lg border border-zinc-700 hover:border-violet-500 text-[11px] font-semibold text-violet-300 cursor-pointer transition"
                        >
                          Highlight Map
                        </button>
                      )}
                    </div>
                  </div>

                  {lane.items.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-zinc-500">
                      No assets matching the active filter in this production line.
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-800/60">
                      {lane.items.map((item) => {
                        const isSel = activeForecast?.asset.id === item.asset.id;
                        const color = riskColor(item.riskBand);
                        const alMeta = item.criticalAlert
                          ? alertSeverityMeta(item.criticalAlert.severity)
                          : null;
                        return (
                          <div
                            key={item.asset.id}
                            onClick={() => setSelectedAssetId(item.asset.id)}
                            className={`px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 transition cursor-pointer ${
                              isSel
                                ? isDark
                                  ? 'bg-violet-500/12'
                                  : 'bg-violet-50'
                                : isDark
                                  ? 'hover:bg-zinc-800/40'
                                  : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 text-xs">
                              <span className="font-mono font-bold">{item.asset.assetId}</span>
                              <span className="text-zinc-400 truncate max-w-[185px]">
                                {item.asset.name}
                              </span>
                              {alMeta && item.criticalAlert && (
                                <span
                                  className="font-mono text-[10.5px] font-bold"
                                  style={{ color: alMeta.color }}
                                >
                                  {alMeta.label} ({item.criticalAlert.sensorTag})
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 font-mono tabular-nums text-[11px]">
                              <span className="text-zinc-400">
                                {item.usageHours.toLocaleString()}h
                              </span>
                              <span className="text-sky-400">
                                PM {item.nextScheduledServiceDate.slice(5)}
                              </span>
                              <span className="font-bold" style={{ color }}>
                                Fail {item.estimatedFailureDate.slice(5)} ({item.daysToFailure}d)
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: AI-First EAM & EMS Command Inspector */}
        <div
          className={`lg:col-span-4 border-t lg:border-t-0 lg:border-l flex flex-col lg:min-h-0 lg:overflow-hidden ${
            isDark ? 'bg-[#121219] border-zinc-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          {/* Inspector Sub-Tabs */}
          <div
            className={`px-3 py-2 border-b flex items-center gap-1 overflow-x-auto shrink-0 ${
              isDark ? 'bg-[#16161F] border-zinc-800' : 'bg-white border-slate-200'
            }`}
          >
            {(
              [
                { id: 'overview', label: 'Reliability & Alerts', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
                { id: 'ai-copilot', label: 'AI Copilot', icon: <Sparkles className="w-3.5 h-3.5" /> },
                { id: 'ems-live', label: 'EMS Live', icon: <Cpu className="w-3.5 h-3.5" /> },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setInspectorTab(tab.id)}
                className={`flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition cursor-pointer ${
                  inspectorTab === tab.id
                    ? 'bg-violet-600 text-white'
                    : isDark
                      ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="lg:flex-1 lg:overflow-y-auto p-3.5 sm:p-4 space-y-4">
            {activeForecast ? (
              <>
                {/* Selected Asset Header */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-amber-400">
                      {activeForecast.asset.assetId}
                    </span>
                    <span
                      className="font-mono text-[10.5px] font-extrabold uppercase"
                      style={{ color: riskColor(activeForecast.riskBand) }}
                    >
                      {activeForecast.riskBand} risk · {activeForecast.healthIndex}% health
                    </span>
                  </div>
                  <h3 className="text-sm font-bold leading-snug">{activeForecast.asset.name}</h3>
                  <div className="text-[11px] text-zinc-400 flex flex-wrap items-center gap-1.5">
                    <span>{activeForecast.primaryLineCode}</span>
                    <span>·</span>
                    <span className="uppercase font-mono text-[10px]">
                      {activeForecast.primaryLineStatus}
                    </span>
                    {activeLineEval && (
                      <>
                        <span>·</span>
                        <span className={activeLineEval.eligible ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                          {activeLineEval.eligible ? 'Line Eligible' : 'Line Blocked'}
                        </span>
                      </>
                    )}
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      {activeForecast.usageHours.toLocaleString()} hrs ({activeForecast.utilizationPct}%)
                    </span>
                  </div>
                </div>

                {/* ==================== SUB-TAB 1: RELIABILITY & ALERTS ==================== */}
                {inspectorTab === 'overview' && (
                  <>
                    {/* Critical Maintenance Alert Callout */}
                    {activeForecast.criticalAlert && (
                      <div
                        className={`p-3 rounded-xl border space-y-2 ${
                          activeForecast.criticalAlert.severity === 'drift'
                            ? 'bg-amber-500/10 border-amber-500/35'
                            : 'bg-rose-500/12 border-rose-500/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span
                            className="font-mono font-extrabold"
                            style={{
                              color: alertSeverityMeta(activeForecast.criticalAlert.severity).color,
                            }}
                          >
                            {alertSeverityMeta(activeForecast.criticalAlert.severity).label}
                          </span>
                          <span className="font-mono tabular-nums text-zinc-300 font-bold">
                            Est. {activeForecast.criticalAlert.predictedDeviationDate} (+
                            {activeForecast.criticalAlert.predictedDeviationDays}d)
                          </span>
                        </div>
                        <p className="text-xs leading-snug font-medium">
                          {activeForecast.criticalAlert.summary}
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-1 text-[10.5px] font-mono text-zinc-400 pt-1 border-t border-zinc-800/60">
                          <span>{activeForecast.criticalAlert.gxpStandard}</span>
                          <span className="text-rose-400 font-bold">
                            Batch Exposure: {formatUsd(activeForecast.criticalAlert.estimatedBatchImpactUsd)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Core Forecast & Cost Avoidance Grid */}
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        className={`p-2.5 rounded-xl border ${
                          isDark ? 'bg-[#171721] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="text-[10px] text-zinc-400">Est. Failure Date</div>
                        <div
                          className="text-xs font-mono tabular-nums font-extrabold mt-0.5"
                          style={{ color: riskColor(activeForecast.riskBand) }}
                        >
                          {activeForecast.estimatedFailureDate}
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono tabular-nums">
                          &plusmn;{activeForecast.uncertaintyDays}d ({activeForecast.daysToFailure}d left)
                        </div>
                      </div>

                      <div
                        className={`p-2.5 rounded-xl border ${
                          isDark ? 'bg-[#171721] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="text-[10px] text-zinc-400">Cost Avoidance ROI</div>
                        <div className="text-xs font-mono tabular-nums font-extrabold text-emerald-400 mt-0.5">
                          Save {formatUsd(activeForecast.unplannedCostUsd - activeForecast.preventiveCostUsd)}
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono tabular-nums">
                          PM {formatUsd(activeForecast.preventiveCostUsd)} vs {formatUsd(activeForecast.unplannedCostUsd)}
                        </div>
                      </div>
                    </div>

                    {/* Spare Part BOM Readiness */}
                    <div
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                        isDark ? 'bg-[#171721] border-zinc-800' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Package className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[10px] text-zinc-400">Required Spare Part (EAM BOM)</div>
                          <div className="font-semibold truncate text-[11.5px]">
                            {activeForecast.sparePartName}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[10.5px] font-bold shrink-0 ${
                          activeForecast.sparePartStatus === 'in-stock'
                            ? 'text-emerald-400'
                            : activeForecast.sparePartStatus === 'low-stock'
                              ? 'text-amber-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {activeForecast.sparePartStatus === 'in-stock'
                          ? `In Stock (${activeForecast.sparePartQty})`
                          : activeForecast.sparePartStatus === 'low-stock'
                            ? 'Low Stock (1)'
                            : 'Order 4d Lead'}
                      </span>
                    </div>

                    {/* Recharts 180-Day Weibull Reliability Survival Curve */}
                    <div
                      className={`p-3 rounded-xl border space-y-2 ${
                        isDark ? 'bg-[#0F0F15] border-zinc-800' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold">180-Day Reliability Survival Curve</span>
                        <span className="font-mono text-violet-400">Weibull R(t)</span>
                      </div>
                      <div className="h-32 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={survivalCurveData}
                            margin={{ top: 6, right: 8, left: -24, bottom: 0 }}
                          >
                            <defs>
                              <linearGradient id="weibullGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop
                                  offset="5%"
                                  stopColor={riskColor(activeForecast.riskBand)}
                                  stopOpacity={0.42}
                                />
                                <stop
                                  offset="95%"
                                  stopColor={riskColor(activeForecast.riskBand)}
                                  stopOpacity={0.03}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke={isDark ? '#27272A' : '#E2E8F0'}
                            />
                            <XAxis
                              dataKey="day"
                              tickFormatter={(d: number) => `+${d}d`}
                              tick={{
                                fill: '#A1A1AA',
                                fontSize: 9,
                                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                              }}
                              interval={5}
                            />
                            <YAxis
                              domain={[0, 100]}
                              ticks={[0, 50, 100]}
                              tickFormatter={(v: number) => `${v}%`}
                              tick={{
                                fill: '#A1A1AA',
                                fontSize: 9,
                                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                              }}
                            />
                            <ReferenceLine
                              y={50}
                              stroke="#F59E0B"
                              strokeDasharray="3 3"
                              strokeOpacity={0.75}
                            />
                            {activeForecast.daysToFailure <= 180 && (
                              <ReferenceLine
                                x={Math.round(activeForecast.daysToFailure / 10) * 10}
                                stroke={riskColor(activeForecast.riskBand)}
                                strokeDasharray="3 3"
                              />
                            )}
                            <Tooltip
                              contentStyle={{
                                backgroundColor: isDark ? '#111116' : '#FFFFFF',
                                borderColor: isDark ? '#3F3F46' : '#CBD5E1',
                                borderRadius: '0.75rem',
                                fontSize: '10.5px',
                                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                              }}
                              formatter={(val: any) => [`${val}%`, 'Survival Prob.']}
                              labelFormatter={(d: any) =>
                                `+${d}d (${formatShortDate(addDaysToIso(today, Number(d)))})`
                              }
                            />
                            <Area
                              type="monotone"
                              dataKey="survivalPct"
                              stroke={riskColor(activeForecast.riskBand)}
                              strokeWidth={2}
                              fill="url(#weibullGrad)"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Forecast Drivers */}
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-zinc-400 flex items-center gap-1.5">
                        <History className="w-3.5 h-3.5 text-violet-400" />
                        Telemetry &amp; Lifecycle Forecast Drivers
                      </div>
                      <div className="space-y-1.5">
                        {activeForecast.contributingFactors.map((fac, idx) => (
                          <div
                            key={idx}
                            className={`p-2 rounded-lg border text-[11px] leading-snug ${
                              isDark
                                ? 'bg-[#171721] border-zinc-800 text-zinc-300'
                                : 'bg-white border-slate-200 text-slate-700'
                            }`}
                          >
                            {fac}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Primary Actions */}
                    <div className="space-y-2 pt-2 border-t border-zinc-800/70">
                      <button
                        type="button"
                        onClick={() => handleRunAiDiagnosis('asset-triage', activeForecast)}
                        className="w-full py-2.5 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Sparkles className="w-4 h-4" />
                        Run AI Root-Cause &amp; GxP Diagnosis
                      </button>

                      <button
                        type="button"
                        onClick={() => handleLaunchPredictiveWorkflow(activeForecast)}
                        className={`w-full py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer ${
                          isDark
                            ? 'bg-[#171721] border-zinc-700 hover:border-amber-500 text-amber-300'
                            : 'bg-white border-slate-200 hover:border-amber-500 text-amber-700'
                        }`}
                      >
                        <Workflow className="w-3.5 h-3.5" />
                        Launch Intervention Workflow
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleCreatePreventiveWo(activeForecast)}
                          className={`py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                            isDark
                              ? 'bg-[#171721] border-zinc-700 hover:border-emerald-500 text-emerald-400'
                              : 'bg-white border-slate-200 hover:border-emerald-500 text-emerald-700'
                          }`}
                        >
                          <Wrench className="w-3.5 h-3.5" />
                          Schedule PM WO
                        </button>
                        <button
                          type="button"
                          onClick={() => onFlyToAsset3D(activeForecast.asset.id)}
                          className={`py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                            isDark
                              ? 'bg-[#171721] border-zinc-700 hover:border-violet-500 text-violet-300'
                              : 'bg-white border-slate-200 hover:border-violet-500 text-violet-700'
                          }`}
                        >
                          <Compass className="w-3.5 h-3.5" />
                          Locate in 3D
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* ==================== SUB-TAB 2: AI COPILOT EAM ARCHITECT ==================== */}
                {inspectorTab === 'ai-copilot' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={aiLoadingKey !== null}
                        onClick={() => handleRunAiDiagnosis('asset-triage', activeForecast)}
                        className="flex-1 py-2 px-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition"
                      >
                        {aiLoadingKey === activeForecast.asset.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Bot className="w-3.5 h-3.5" />
                        )}
                        Diagnose {activeForecast.asset.assetId}
                      </button>
                      <button
                        type="button"
                        disabled={aiLoadingKey !== null}
                        onClick={() => handleRunAiDiagnosis('fleet-optimization', activeForecast)}
                        className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition ${
                          isDark
                            ? 'bg-[#171721] border-zinc-700 hover:border-violet-500 text-zinc-200'
                            : 'bg-white border-slate-300 hover:border-violet-500 text-slate-800'
                        }`}
                      >
                        {aiLoadingKey === 'fleet' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        Fleet Plan
                      </button>
                    </div>

                    {aiError && (
                      <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs text-rose-300 space-y-2">
                        <div className="font-bold flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          AI Diagnostic Error
                        </div>
                        <p className="leading-snug">{aiError}</p>
                        <button
                          type="button"
                          onClick={() => handleRunAiDiagnosis('asset-triage', activeForecast)}
                          className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          Retry Diagnosis
                        </button>
                      </div>
                    )}

                    {aiLoadingKey !== null && (
                      <div
                        className={`p-4 rounded-xl border space-y-2.5 ${
                          isDark ? 'bg-[#171721] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 text-xs font-semibold text-violet-400">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Analyzing SCADA telemetry, GxP limits &amp; MTBF history...
                        </div>
                        <div className="h-3 rounded bg-zinc-800/80 w-4/5" />
                        <div className="h-3 rounded bg-zinc-800/60 w-3/5" />
                        <div className="h-14 rounded-lg bg-zinc-800/50 w-full" />
                      </div>
                    )}

                    {!aiLoadingKey && activeAiDiag && (
                      <div className="space-y-3">
                        {/* Verdict Header */}
                        <div
                          className={`p-3 rounded-xl border space-y-1.5 ${
                            activeAiDiag.severityVerdict === 'IMMEDIATE_HOLD'
                              ? 'bg-rose-500/12 border-rose-500/40'
                              : activeAiDiag.severityVerdict === 'EXPEDITED_PM'
                                ? 'bg-amber-500/10 border-amber-500/35'
                                : 'bg-emerald-500/10 border-emerald-500/35'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[10.5px] font-mono font-extrabold">
                            <span
                              className={
                                activeAiDiag.severityVerdict === 'IMMEDIATE_HOLD'
                                  ? 'text-rose-400'
                                  : activeAiDiag.severityVerdict === 'EXPEDITED_PM'
                                    ? 'text-amber-400'
                                    : 'text-emerald-400'
                              }
                            >
                              {activeAiDiag.severityVerdict.replace(/_/g, ' ')}
                            </span>
                            <span className="text-zinc-400">AI EAM Verdict</span>
                          </div>
                          <div className="text-xs font-bold leading-snug">
                            {activeAiDiag.headline}
                          </div>
                          <p className="text-[11px] text-zinc-300 leading-relaxed">
                            {activeAiDiag.gxpComplianceAssessment}
                          </p>
                        </div>

                        {/* Cost & Downtime Impact */}
                        <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                          <div
                            className={`p-2.5 rounded-xl border ${
                              isDark ? 'bg-[#171721] border-zinc-800' : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="text-[10px] text-zinc-400 font-sans">Unplanned vs PM</div>
                            <div className="text-xs font-extrabold text-emerald-400 mt-0.5">
                              {formatUsd(activeAiDiag.downtimeCostComparison.preventiveCostUsd)} vs{' '}
                              {formatUsd(activeAiDiag.downtimeCostComparison.unplannedCostUsd)}
                            </div>
                          </div>
                          <div
                            className={`p-2.5 rounded-xl border ${
                              isDark ? 'bg-[#171721] border-zinc-800' : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="text-[10px] text-zinc-400 font-sans">Downtime Saved</div>
                            <div className="text-xs font-extrabold text-violet-400 mt-0.5">
                              {activeAiDiag.downtimeCostComparison.downtimeHoursSaved} hrs
                            </div>
                          </div>
                        </div>

                        {/* Root Cause Hypotheses */}
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-bold text-zinc-400">
                            Ranked Root-Cause Hypotheses
                          </div>
                          {activeAiDiag.rootCauseHypotheses.map((rc, i) => (
                            <div
                              key={i}
                              className={`p-2.5 rounded-xl border space-y-1 ${
                                isDark ? 'bg-[#171721] border-zinc-800' : 'bg-white border-slate-200'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="font-semibold leading-snug">{rc.cause}</span>
                                <span className="font-mono tabular-nums text-[11px] font-bold text-violet-400 shrink-0">
                                  {Math.round(rc.confidencePct)}%
                                </span>
                              </div>
                              <p className="text-[10.5px] text-zinc-400 leading-snug">
                                {rc.telemetryEvidence}
                              </p>
                            </div>
                          ))}
                        </div>

                        {/* AI Recommended Work Order Blueprint (1-Click Executable) */}
                        <div
                          className={`p-3 rounded-xl border space-y-2 ${
                            isDark ? 'bg-[#171721] border-zinc-800' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-amber-400">
                              AI Work Order Blueprint
                            </span>
                            <span className="font-mono text-[10px] text-zinc-400">
                              {activeAiDiag.recommendedWorkOrder.sopReference}
                            </span>
                          </div>
                          <div className="text-xs font-bold leading-snug">
                            {activeAiDiag.recommendedWorkOrder.title}
                          </div>
                          <div className="text-[10.5px] font-mono text-zinc-400">
                            Priority: {activeAiDiag.recommendedWorkOrder.priority.toUpperCase()} · Est:{' '}
                            {activeAiDiag.recommendedWorkOrder.estimatedHours}h · Due in{' '}
                            {activeAiDiag.recommendedWorkOrder.dueInDays}d
                          </div>
                          {activeAiDiag.recommendedWorkOrder.requiredParts.length > 0 && (
                            <div className="text-[10.5px] text-zinc-300">
                              <span className="text-zinc-400">Parts BOM: </span>
                              {activeAiDiag.recommendedWorkOrder.requiredParts.join(' · ')}
                            </div>
                          )}
                          <ul className="space-y-1 pt-1 border-t border-zinc-800/70">
                            {activeAiDiag.recommendedWorkOrder.checklist.slice(0, 4).map((step, idx) => (
                              <li key={idx} className="text-[11px] text-zinc-300 flex items-start gap-1.5">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                                <span>{step}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="grid grid-cols-2 gap-2 pt-1.5">
                            <button
                              type="button"
                              onClick={() => handleDispatchAiWorkOrder(activeAiDiag, activeForecast)}
                              className="py-2 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                              Dispatch AI WO
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleLaunchPredictiveWorkflow(activeForecast, activeAiDiag.headline)
                              }
                              className="py-2 px-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition"
                            >
                              <Workflow className="w-3.5 h-3.5" />
                              Launch CAPA
                            </button>
                          </div>
                        </div>

                        {/* Fleet Optimization Recommendations */}
                        {activeAiDiag.optimizationRecommendations.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-[11px] font-bold text-zinc-400">
                              EAM Optimization Actions
                            </div>
                            {activeAiDiag.optimizationRecommendations.map((rec, idx) => (
                              <div
                                key={idx}
                                className={`p-2 rounded-lg border text-[11px] leading-snug ${
                                  isDark
                                    ? 'bg-[#171721] border-zinc-800 text-zinc-300'
                                    : 'bg-white border-slate-200 text-slate-700'
                                }`}
                              >
                                {idx + 1}. {rec}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {!aiLoadingKey && !activeAiDiag && !aiError && (
                      <div
                        className={`p-4 rounded-xl border text-center space-y-2.5 ${
                          isDark ? 'bg-[#171721] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <Bot className="w-7 h-7 text-violet-400 mx-auto" />
                        <div className="text-xs font-bold">AI-First EAM &amp; GxP Reliability Copilot</div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Analyze live SCADA/EMS threshold margins, historical MTBF, spare-part BOM readiness,
                          and 21 CFR Part 11 risk to auto-author an executable GMP Work Order.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleRunAiDiagnosis('asset-triage', activeForecast)}
                          className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer transition"
                        >
                          Run AI Diagnosis Now
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ==================== SUB-TAB 3: EMS LIVE TELEMETRY ==================== */}
                {inspectorTab === 'ems-live' && (
                  <div className="space-y-3">
                    {activeForecast.boundSensors.length === 0 ? (
                      <div
                        className={`p-4 rounded-xl border text-center text-xs text-zinc-400 ${
                          isDark ? 'bg-[#171721] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        No SCADA or Cleanroom EMS sensors are currently mapped to this asset.
                      </div>
                    ) : (
                      <>
                        {/* Sensor Selector Strip */}
                        <div className="flex flex-wrap gap-1.5">
                          {activeForecast.boundSensors.map((bs) => {
                            const isSel = activeSensorBinding?.sensor.id === bs.sensor.id;
                            const st = bs.reading?.status ?? 'nominal';
                            return (
                              <button
                                key={bs.sensor.id}
                                type="button"
                                onClick={() => setSelectedSensorId(bs.sensor.id)}
                                className={`px-2 py-1 rounded-lg border font-mono text-[10.5px] font-semibold transition cursor-pointer ${
                                  isSel
                                    ? 'bg-violet-600 border-violet-500 text-white'
                                    : st === 'alarm'
                                      ? 'bg-rose-500/15 border-rose-500/45 text-rose-300'
                                      : st === 'warning'
                                        ? 'bg-amber-500/15 border-amber-500/45 text-amber-300'
                                        : isDark
                                          ? 'bg-[#171721] border-zinc-800 text-zinc-300'
                                          : 'bg-white border-slate-200 text-slate-700'
                                }`}
                              >
                                {bs.sensor.tag}
                              </button>
                            );
                          })}
                        </div>

                        {/* Live Recharts Sensor Stream Chart with GxP Threshold Reference Lines */}
                        {activeSensorBinding && (
                          <div
                            className={`p-3 rounded-xl border space-y-2 ${
                              isDark ? 'bg-[#0F0F15] border-zinc-800' : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-xs font-bold">{activeSensorBinding.sensor.name}</div>
                                <div className="text-[10.5px] font-mono text-zinc-400">
                                  {activeSensorBinding.sensor.tag} · {activeSensorBinding.sensor.protocol} ·{' '}
                                  {activeSensorBinding.isRoomEms ? 'Room EMS' : 'Equipment SCADA'}
                                </div>
                              </div>
                              <div className="text-right font-mono tabular-nums">
                                <div
                                  className={`text-sm font-extrabold ${
                                    activeSensorBinding.reading?.status === 'alarm'
                                      ? 'text-rose-400'
                                      : activeSensorBinding.reading?.status === 'warning'
                                        ? 'text-amber-400'
                                        : 'text-emerald-400'
                                  }`}
                                >
                                  {activeSensorBinding.reading?.value ?? '--'}{' '}
                                  <span className="text-[10px] font-normal">
                                    {activeSensorBinding.sensor.unit}
                                  </span>
                                </div>
                                <div className="text-[10px] text-zinc-400 uppercase">
                                  {activeSensorBinding.reading?.status ?? 'offline'} ·{' '}
                                  {activeSensorBinding.reading?.trend ?? 'stable'}
                                </div>
                              </div>
                            </div>

                            <div className="h-36 w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart
                                  data={liveSensorSparkData}
                                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                                >
                                  <defs>
                                    <linearGradient id="emsLiveGrad" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.4} />
                                      <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0.02} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke={isDark ? '#27272A' : '#E2E8F0'}
                                  />
                                  <XAxis
                                    dataKey="timeLabel"
                                    tick={{ fill: '#A1A1AA', fontSize: 9 }}
                                    interval={6}
                                  />
                                  <YAxis
                                    domain={['auto', 'auto']}
                                    tick={{
                                      fill: '#A1A1AA',
                                      fontSize: 9,
                                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                                    }}
                                  />
                                  <ReferenceLine
                                    y={activeSensorBinding.sensor.alarmHigh}
                                    stroke="#F43F5E"
                                    strokeDasharray="3 3"
                                  />
                                  <ReferenceLine
                                    y={activeSensorBinding.sensor.warnHigh}
                                    stroke="#F59E0B"
                                    strokeDasharray="2 3"
                                  />
                                  <ReferenceLine
                                    y={activeSensorBinding.sensor.warnLow}
                                    stroke="#F59E0B"
                                    strokeDasharray="2 3"
                                  />
                                  <ReferenceLine
                                    y={activeSensorBinding.sensor.alarmLow}
                                    stroke="#F43F5E"
                                    strokeDasharray="3 3"
                                  />
                                  <Tooltip
                                    contentStyle={{
                                      backgroundColor: isDark ? '#111116' : '#FFFFFF',
                                      borderColor: isDark ? '#3F3F46' : '#CBD5E1',
                                      borderRadius: '0.75rem',
                                      fontSize: '10.5px',
                                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                                    }}
                                    formatter={(v: any) => [
                                      `${v} ${activeSensorBinding.sensor.unit}`,
                                      activeSensorBinding.sensor.tag,
                                    ]}
                                  />
                                  <Area
                                    type="monotone"
                                    dataKey="value"
                                    stroke="#A78BFA"
                                    strokeWidth={2}
                                    fill="url(#emsLiveGrad)"
                                    isAnimationActive={false}
                                  />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>

                            <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-zinc-800/70 font-mono tabular-nums text-[10px]">
                              <div>
                                <div className="text-zinc-500">GxP Alarm Band</div>
                                <div className="text-rose-400 font-semibold">
                                  {activeSensorBinding.sensor.alarmLow} – {activeSensorBinding.sensor.alarmHigh}
                                </div>
                              </div>
                              <div>
                                <div className="text-zinc-500">Action Warn</div>
                                <div className="text-amber-400 font-semibold">
                                  {activeSensorBinding.sensor.warnLow} – {activeSensorBinding.sensor.warnHigh}
                                </div>
                              </div>
                              <div>
                                <div className="text-zinc-500">Cal Due</div>
                                <div className="text-zinc-300 font-semibold">
                                  {activeSensorBinding.sensor.calibrationDue}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Full Asset Sensor Table */}
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-bold text-zinc-400">
                            All Monitored GxP Parameters ({activeForecast.boundSensors.length})
                          </div>
                          {activeForecast.boundSensors.map((bs) => {
                            const st = bs.reading?.status ?? 'nominal';
                            return (
                              <div
                                key={bs.sensor.id}
                                onClick={() => setSelectedSensorId(bs.sensor.id)}
                                className={`p-2 rounded-lg border flex items-center justify-between gap-2 text-[11px] cursor-pointer ${
                                  isDark
                                    ? 'bg-[#171721] border-zinc-800 hover:border-zinc-700'
                                    : 'bg-white border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="font-mono font-bold truncate">{bs.sensor.tag}</div>
                                  <div className="text-[10px] text-zinc-400 truncate">
                                    {bs.sensor.name}
                                  </div>
                                </div>
                                <div className="text-right font-mono tabular-nums shrink-0">
                                  <div
                                    className={`font-bold ${
                                      st === 'alarm'
                                        ? 'text-rose-400'
                                        : st === 'warning'
                                          ? 'text-amber-400'
                                          : 'text-emerald-400'
                                    }`}
                                  >
                                    {bs.reading?.value ?? '--'} {bs.sensor.unit}
                                  </div>
                                  <div className="text-[9.5px] text-zinc-500 uppercase">{st}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            openTelemetryDashboard({
                              assetId: activeForecast.asset.id,
                              sensorId: activeSensorBinding?.sensor.id ?? null,
                              tab: 'trends',
                            })
                          }
                          className={`w-full py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition ${
                            isDark
                              ? 'bg-[#171721] border-zinc-700 hover:border-violet-500 text-violet-300'
                              : 'bg-white border-slate-300 hover:border-violet-500 text-violet-700'
                          }`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Full EMS Telemetry Console
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-zinc-500 p-4 text-center">
                Select any equipment bar on the timeline to inspect reliability predictions and GxP alerts.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
