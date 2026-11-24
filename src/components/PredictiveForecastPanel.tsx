import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Compass,
  GitBranch,
  History,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  Workflow,
  Wrench,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { evaluateProductionLine, useGmpStore } from '../store/useGmpStore';
import { addDaysToIso, todayIso } from '../data/gmpDemoData';
import type { SpatialAsset } from '../types/twin';
import type { EquipmentComplianceRecord, ProductionLine } from '../types/gmp';

export interface AssetPredictiveForecast {
  asset: SpatialAsset;
  compliance: EquipmentComplianceRecord | null;
  lineIds: string[];
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
  recentEventDates: { date: string; daysFromToday: number; outcome: string; title: string }[];
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

export function buildAssetForecasts(
  assets: SpatialAsset[],
  complianceMap: Record<string, EquipmentComplianceRecord>,
  productionLines: ProductionLine[],
  sensors: { id: string; targetId: string; targetKind: string }[],
  readings: Record<string, { status: string }>
): AssetPredictiveForecast[] {
  const today = todayIso();

  return assets.map((asset) => {
    const comp = complianceMap[asset.id] ?? null;
    const seed = deterministicSeed(asset.id + asset.assetId);
    const events = comp?.lifecycleEvents ?? [];

    // Analyze historical lifecycle intervals & failure/conditional outcomes
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

    // Live telemetry stress on this asset
    const assetSensors = sensors.filter((s) => s.targetKind === 'asset' && s.targetId === asset.id);
    const alarmSensors = assetSensors.filter((s) => readings[s.id]?.status === 'alarm').length;
    const warnSensors = assetSensors.filter((s) => readings[s.id]?.status === 'warning').length;
    const telemetryStressCount = alarmSensors * 2 + warnSensors;

    // Check earliest compliance due date
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

    // Weibull-inspired Remaining Useful Life (RUL) computation
    const lastMaintDate = comp?.maintenance.lastDate ?? addDaysToIso(today, -60);
    const daysSinceLastMaint = Math.max(1, diffDays(today, lastMaintDate));
    const mtbfDays = Math.max(
      45,
      Math.round(avgInterval * (1.15 - failEvents * 0.14 - condEvents * 0.06))
    );

    let daysToFailure: number;
    if (overdueCount > 0) {
      // Overdue compliance assets have high near-term failure risk (7 to 26 days)
      daysToFailure = Math.max(6, 24 - overdueCount * 6 - telemetryStressCount * 3 + (seed % 7));
    } else if (dueSoonCount > 0 || alarmSensors > 0) {
      daysToFailure = Math.max(18, 48 - dueSoonCount * 8 - telemetryStressCount * 6 + (seed % 15));
    } else {
      const baseRemaining = Math.max(25, mtbfDays - Math.round(daysSinceLastMaint * 0.65));
      daysToFailure = Math.min(
        320,
        Math.max(28, baseRemaining - failEvents * 18 - telemetryStressCount * 10 + (seed % 28))
      );
    }

    const uncertaintyDays = Math.max(5, Math.min(28, Math.round(daysToFailure * 0.18)));
    const estimatedFailureDate = addDaysToIso(today, daysToFailure);
    const earliestFailureDate = addDaysToIso(today, Math.max(2, daysToFailure - uncertaintyDays));
    const latestFailureDate = addDaysToIso(today, daysToFailure + uncertaintyDays);

    const healthIndex = Math.max(
      14,
      Math.min(
        98,
        Math.round(
          100 -
            overdueCount * 24 -
            dueSoonCount * 11 -
            failEvents * 12 -
            condEvents * 6 -
            telemetryStressCount * 8 -
            Math.max(0, 45 - daysToFailure) * 0.45
        )
      )
    );

    const riskBand: AssetPredictiveForecast['riskBand'] =
      daysToFailure <= 30 || healthIndex < 45
        ? 'critical'
        : daysToFailure <= 65 || healthIndex < 68
          ? 'high'
          : daysToFailure <= 130
            ? 'watch'
            : 'healthy';

    const modes = FAILURE_MODES_BY_CATEGORY[asset.category] ?? [
      'Component Mechanical Wear & Tolerance Drift',
    ];
    const primaryFailureMode = modes[seed % modes.length];

    const contributingFactors: string[] = [];
    if (overdueCount > 0) {
      contributingFactors.push(`${overdueCount} overdue GMP compliance cycle(s) accelerating degradation`);
    }
    if (failEvents > 0) {
      contributingFactors.push(`${failEvents} historical deviation/failure event(s) shortened MTBF to ${mtbfDays}d`);
    }
    if (condEvents > 0) {
      contributingFactors.push(`${condEvents} conditional pass inspection(s) in audit history`);
    }
    if (alarmSensors > 0) {
      contributingFactors.push(`${alarmSensors} live telemetry alarm(s) indicating active operational stress`);
    } else if (warnSensors > 0) {
      contributingFactors.push(`${warnSensors} live telemetry warning(s) near upper control limit`);
    }
    if (daysToFailure < daysToNextScheduled && daysToNextScheduled > 0) {
      contributingFactors.push(
        `Estimated failure (${estimatedFailureDate}) precedes next scheduled PM (${nextScheduledServiceDate})`
      );
    }
    if (contributingFactors.length === 0) {
      contributingFactors.push(`Stable historical lifecycle (${events.length} passed milestones · MTBF ${mtbfDays}d)`);
    }

    const lineIds = productionLines
      .filter((l) => l.assetIds.includes(asset.id))
      .map((l) => l.id);

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
      recentEventDates,
    };
  });
}

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
  const [riskFilter, setRiskFilter] = useState<'all' | 'high-plus' | 'critical'>('all');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

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

  const filteredForecasts = useMemo(() => {
    return forecasts
      .filter((f) => {
        if (lineFilter !== 'all' && !f.lineIds.includes(lineFilter)) return false;
        if (riskFilter === 'critical' && f.riskBand !== 'critical') return false;
        if (riskFilter === 'high-plus' && f.riskBand !== 'critical' && f.riskBand !== 'high') {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.daysToFailure - b.daysToFailure);
  }, [forecasts, lineFilter, riskFilter]);

  // Group into Production Line swimlanes + Unassigned Utilities
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
          items: unassigned.slice(0, 8),
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

  // KPI metrics
  const criticalCount = forecasts.filter((f) => f.riskBand === 'critical').length;
  const failsBeforePmCount = forecasts.filter((f) => f.failsBeforeScheduledPm).length;
  const avgHealth =
    forecasts.length > 0
      ? Math.round(forecasts.reduce((acc, f) => acc + f.healthIndex, 0) / forecasts.length)
      : 100;
  const impactedLinesCount = productionLines.filter((line) =>
    forecasts.some((f) => f.lineIds.includes(line.id) && f.daysToFailure <= 30)
  ).length;

  // Timeline coordinate mapping: [-45 days (history) ... +horizonDays (forecast)]
  const historySpan = 45;
  const totalSpan = historySpan + horizonDays;
  const dayToPct = (dayOffset: number) => {
    const clamped = Math.max(-historySpan, Math.min(horizonDays, dayOffset));
    return ((clamped + historySpan) / totalSpan) * 100;
  };
  const todayPct = dayToPct(0);
  const dangerEndPct = dayToPct(30);

  const monthTicks = useMemo(() => {
    const step = horizonDays === 90 ? 15 : horizonDays === 180 ? 30 : 60;
    const ticks: { day: number; label: string; pct: number }[] = [
      { day: -30, label: '-30d', pct: dayToPct(-30) },
      { day: 0, label: 'TODAY', pct: dayToPct(0) },
    ];
    for (let d = step; d <= horizonDays; d += step) {
      ticks.push({ day: d, label: `+${d}d`, pct: dayToPct(d) });
    }
    return ticks;
  }, [horizonDays]);

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

  const handleLaunchPredictiveWorkflow = (f: AssetPredictiveForecast) => {
    const line = productionLines.find((l) => f.lineIds.includes(l.id));
    const eligibleTechs = getEligiblePersonnel(f.asset.category, 'maintenance');
    const techName = eligibleTechs[0]?.name ?? personnel[0]?.name ?? 'Sara Lindqvist';

    createWorkflow({
      title: `Predictive Intervention — ${f.asset.assetId} (${f.primaryFailureMode})`,
      description: `Auto-generated from Predictive Maintenance Forecast. Estimated failure date ${f.estimatedFailureDate} (Health ${f.healthIndex}%, MTBF ${f.mtbfDays}d). Execute preventive overhaul before unplanned line downtime.`,
      workflowType: 'preventive-intervention',
      priority: f.riskBand === 'critical' ? 'critical' : 'high',
      status: 'active',
      triggerSource: 'predictive-forecast',
      linkedLineId: line?.id,
      linkedLineName: line ? `${line.code} · ${line.name}` : undefined,
      linkedAssetId: f.asset.id,
      linkedAssetCode: f.asset.assetId,
      linkedAssetName: f.asset.name,
      predictedFailureDate: f.estimatedFailureDate,
      steps: [
        {
          id: `st-${Date.now()}-1`,
          title: 'Engineering Reliability Review & Spare Parts Staging',
          roleRequired: 'Reliability Engineer',
          assigneeName: 'Marcus Vance',
          status: 'in-progress',
          slaHours: 6,
          notes: f.contributingFactors.join(' · '),
        },
        {
          id: `st-${Date.now()}-2`,
          title: `Preventive Service: ${f.primaryFailureMode}`,
          roleRequired: 'Certified Maintenance Tech',
          assigneeName: techName,
          status: 'pending',
          slaHours: 16,
        },
        {
          id: `st-${Date.now()}-3`,
          title: 'Post-Service Calibration & Telemetry Drift Check',
          roleRequired: 'Metrology Specialist',
          assigneeName: techName,
          status: 'pending',
          slaHours: 8,
        },
        {
          id: `st-${Date.now()}-4`,
          title: 'QA Electronic Sign-Off & Production Line Release',
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
    const targetDue = addDaysToIso(todayIso(), Math.max(3, Math.min(14, f.daysToFailure - 5)));
    const wo = createWorkOrder({
      title: `[Predictive PM] ${f.asset.assetId} — ${f.primaryFailureMode}`,
      description: `Pre-emptive maintenance scheduled ahead of estimated failure date ${f.estimatedFailureDate} (Health ${f.healthIndex}%).`,
      serviceType: 'maintenance',
      targetKind: 'asset',
      targetId: f.asset.id,
      targetName: `${f.asset.assetId} · ${f.asset.name}`,
      targetCategory: f.asset.category,
      productionLineId: f.lineIds[0],
      assigneeId: tech?.id ?? 'tech-01',
      assigneeName: tech?.name ?? 'Sara Lindqvist',
      priority: f.riskBand === 'critical' ? 'critical' : 'high',
      status: 'open',
      lastServiceDate: f.compliance?.maintenance.lastDate ?? todayIso(),
      dueDate: targetDue,
      estimatedHours: 3.5,
      checklist: [
        { id: `chk-${Date.now()}-1`, text: `Inspect for ${f.primaryFailureMode}`, done: false },
        { id: `chk-${Date.now()}-2`, text: 'Replace wear components & recalibrate sensors', done: false },
        { id: `chk-${Date.now()}-3`, text: 'Verify telemetry nominal & sign 21 CFR Part 11 record', done: false },
      ],
    });
    showToast(`Created preventive ${wo.woNumber} due ${targetDue}`, 'success');
  };

  // Weibull Survival Curve helper for selected asset
  const survivalPath = useMemo(() => {
    if (!activeForecast) return '';
    const W = 280;
    const H = 88;
    const eta = Math.max(15, activeForecast.daysToFailure * 1.25);
    const beta = activeForecast.riskBand === 'critical' ? 2.4 : 1.85;
    const pts: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const day = (i / 24) * 180;
      const surv = Math.exp(-Math.pow(day / eta, beta));
      const x = 10 + (i / 24) * (W - 20);
      const y = H - 12 - surv * (H - 22);
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(' ');
  }, [activeForecast]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Top KPI Summary Strip & Controls */}
      <div
        className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 shrink-0 ${
          isDark ? 'bg-[#14141C] border-zinc-800' : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-3 py-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-rose-400 font-semibold">
                Critical (&le;30d)
              </div>
              <div className="text-xs font-mono font-extrabold text-rose-500">
                {criticalCount} Assets
              </div>
            </div>
          </div>

          <div className="px-3 py-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 flex items-center gap-2">
            <TrendingDown className="w-3.5 h-3.5 text-amber-500" />
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-amber-400 font-semibold">
                Fails Before PM
              </div>
              <div className="text-xs font-mono font-extrabold text-amber-500">
                {failsBeforePmCount} Collisions
              </div>
            </div>
          </div>

          <div className="px-3 py-1.5 rounded-xl border border-violet-500/35 bg-violet-500/10 flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5 text-violet-400" />
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-violet-400 font-semibold">
                Lines At 30d Risk
              </div>
              <div className="text-xs font-mono font-extrabold text-violet-400">
                {impactedLinesCount} / {productionLines.length}
              </div>
            </div>
          </div>

          <div className="px-3 py-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-emerald-500" />
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-emerald-400 font-semibold">
                Fleet Health
              </div>
              <div className="text-xs font-mono font-extrabold text-emerald-500">
                {avgHealth}%
              </div>
            </div>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={lineFilter}
            onChange={(e) => setLineFilter(e.target.value)}
            className={`px-2.5 py-1.5 text-xs rounded-xl border cursor-pointer ${
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

          <div
            className={`flex items-center p-0.5 rounded-xl border text-[11px] ${
              isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
            }`}
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'high-plus', label: 'High+' },
                { id: 'critical', label: 'Critical' },
              ] as const
            ).map((rf) => (
              <button
                key={rf.id}
                type="button"
                onClick={() => setRiskFilter(rf.id)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  riskFilter === rf.id
                    ? 'bg-violet-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {rf.label}
              </button>
            ))}
          </div>

          <div
            className={`flex items-center p-0.5 rounded-xl border text-[11px] ${
              isDark ? 'bg-[#111116] border-zinc-800' : 'bg-white border-slate-200'
            }`}
          >
            {([90, 180, 365] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizonDays(h)}
                className={`px-2 py-1 rounded-lg font-mono font-semibold transition cursor-pointer ${
                  horizonDays === h
                    ? 'bg-amber-500 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {h}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Split: Left Predictive Timeline by Production Line | Right Selected Asset Forecast Details */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* Left: Swimlane Timeline Visualization */}
        <div className="lg:col-span-8 overflow-y-auto p-4 space-y-4">
          {/* Legend + Axis Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-zinc-400">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-400 border border-zinc-200" />
                Historical Lifecycle Event
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rotate-45 bg-sky-400 inline-block" />
                Scheduled PM / Cal Due
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-2 rounded-full bg-rose-500/40 border border-rose-500 inline-block" />
                Est. Failure Window &amp; Date
              </span>
            </div>
            <span className="font-mono text-[10px]">
              Horizon: -45d History &rarr; +{horizonDays}d Forecast
            </span>
          </div>

          {/* Sticky Timeline Scale Bar */}
          <div
            className={`rounded-2xl border px-3 py-2 flex items-center ${
              isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-100 border-slate-200'
            }`}
          >
            <div className="w-44 sm:w-52 shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Line / Equipment Asset
            </div>
            <div className="flex-1 relative h-5">
              {monthTicks.map((tk) => (
                <div
                  key={tk.day}
                  style={{ left: `${tk.pct}%` }}
                  className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
                >
                  <span
                    className={`font-mono text-[9.5px] font-bold ${
                      tk.day === 0 ? 'text-violet-400' : 'text-zinc-400'
                    }`}
                  >
                    {tk.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Production Line Swimlanes */}
          {swimlanes.map((lane) => {
            const earliestInLane = lane.items[0];
            return (
              <div
                key={lane.id}
                className={`rounded-2xl border overflow-hidden ${
                  isDark ? 'bg-[#15151D] border-zinc-800' : 'bg-white border-slate-200'
                }`}
              >
                {/* Production Line Status Header */}
                <div
                  className={`px-3.5 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 ${
                    isDark ? 'bg-[#1A1A24] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: lane.color }}
                    />
                    <span className="font-mono text-xs font-bold text-amber-400">{lane.code}</span>
                    <span className="text-xs font-bold truncate">{lane.name}</span>
                    {lane.eligible !== null && (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9.5px] font-extrabold uppercase border ${
                          lane.eligible
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
                            : 'bg-rose-500/15 text-rose-400 border-rose-500/40'
                        }`}
                      >
                        {lane.eligible ? (
                          <ShieldCheck className="w-3 h-3" />
                        ) : (
                          <ShieldAlert className="w-3 h-3" />
                        )}
                        {lane.eligible ? 'LINE ELIGIBLE' : `LINE BLOCKED (${lane.blockingCount})`}
                      </span>
                    )}
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">
                      {lane.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {earliestInLane && (
                      <span className="text-[10.5px] font-mono text-zinc-400">
                        Next Est. Failure:{' '}
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
                        className="px-2 py-1 rounded-lg border border-zinc-700 hover:border-violet-500 text-[10px] font-semibold text-violet-400 cursor-pointer"
                      >
                        Highlight Map
                      </button>
                    )}
                  </div>
                </div>

                {/* Asset Timeline Rows */}
                {lane.items.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-zinc-500">
                    No assets matching the active risk filter in this production line.
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800/50">
                    {lane.items.map((item) => {
                      const isSel = activeForecast?.asset.id === item.asset.id;
                      const failPct = dayToPct(item.daysToFailure);
                      const bandStartPct = dayToPct(item.daysToFailure - item.uncertaintyDays);
                      const bandEndPct = dayToPct(item.daysToFailure + item.uncertaintyDays);
                      const pmPct = dayToPct(item.daysToNextScheduled);
                      const color = riskColor(item.riskBand);

                      return (
                        <div
                          key={item.asset.id}
                          onClick={() => setSelectedAssetId(item.asset.id)}
                          className={`px-3.5 py-2.5 flex items-center gap-2 transition cursor-pointer ${
                            isSel
                              ? isDark
                                ? 'bg-violet-500/12'
                                : 'bg-violet-50'
                              : isDark
                                ? 'hover:bg-zinc-800/40'
                                : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* Asset Info Column */}
                          <div className="w-44 sm:w-52 shrink-0 min-w-0 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span className="font-mono text-[11px] font-bold truncate">
                                {item.asset.assetId}
                              </span>
                              <span
                                className="ml-auto font-mono text-[10px] font-bold"
                                style={{ color }}
                              >
                                {item.healthIndex}%
                              </span>
                            </div>
                            <div className="text-[10.5px] text-zinc-400 truncate mt-0.5">
                              {item.asset.name}
                            </div>
                            {item.failsBeforeScheduledPm && (
                              <div className="text-[9.5px] font-semibold text-amber-400 mt-0.5 flex items-center gap-1">
                                <AlertTriangle className="w-2.5 h-2.5" />
                                Fails before PM ({item.daysToFailure}d vs {item.daysToNextScheduled}d)
                              </div>
                            )}
                          </div>

                          {/* Interactive SVG / CSS Timeline Track */}
                          <div className="flex-1 relative h-10 select-none">
                            {/* 30-Day Critical Window Shading */}
                            <div
                              style={{
                                left: `${todayPct}%`,
                                width: `${Math.max(1, dangerEndPct - todayPct)}%`,
                              }}
                              className="absolute inset-y-0 bg-rose-500/8 border-x border-rose-500/20 pointer-events-none"
                            />

                            {/* Baseline Track */}
                            <div
                              className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] ${
                                isDark ? 'bg-zinc-800' : 'bg-slate-200'
                              }`}
                            />

                            {/* Today Vertical Reference Line */}
                            <div
                              style={{ left: `${todayPct}%` }}
                              className="absolute inset-y-0 w-[1.5px] bg-violet-500/80 z-10 pointer-events-none"
                            />

                            {/* Historical Lifecycle Events (Left of Today) */}
                            {item.recentEventDates.map((ev, idx) => (
                              <div
                                key={idx}
                                style={{ left: `${dayToPct(ev.daysFromToday)}%` }}
                                title={`${ev.date} · ${ev.title} (${ev.outcome.toUpperCase()})`}
                                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full z-10 ${
                                  ev.outcome === 'fail'
                                    ? 'bg-rose-500'
                                    : ev.outcome === 'conditional'
                                      ? 'bg-amber-400'
                                      : 'bg-zinc-400'
                                }`}
                              />
                            ))}

                            {/* Scheduled PM / Cal Due Diamond */}
                            <div
                              style={{ left: `${pmPct}%` }}
                              title={`Next Scheduled PM/Cal: ${item.nextScheduledServiceDate}`}
                              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-sky-400 border border-zinc-950 z-20"
                            />

                            {/* Estimated Failure Uncertainty Window Bar */}
                            <div
                              style={{
                                left: `${bandStartPct}%`,
                                width: `${Math.max(2, bandEndPct - bandStartPct)}%`,
                                backgroundColor: `${color}35`,
                                borderColor: color,
                              }}
                              className="absolute top-1/2 -translate-y-1/2 h-4 rounded-full border z-10"
                            />

                            {/* Estimated Failure Date Core Marker */}
                            <div
                              style={{
                                left: `${failPct}%`,
                                backgroundColor: color,
                              }}
                              title={`Estimated Failure: ${item.estimatedFailureDate} (±${item.uncertaintyDays}d)`}
                              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full ring-2 ring-white dark:ring-[#15151D] shadow-md z-30"
                            />

                            {/* Compact Date Label */}
                            <span
                              style={{
                                left: `${Math.min(88, Math.max(12, failPct))}%`,
                                color,
                              }}
                              className="absolute -bottom-0.5 -translate-x-1/2 font-mono text-[9px] font-bold whitespace-nowrap z-20"
                            >
                              {item.estimatedFailureDate.slice(5)} ({item.daysToFailure}d)
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

        {/* Right: Selected Asset Reliability Forecast & Action Panel */}
        <div
          className={`lg:col-span-4 border-l overflow-y-auto p-4 space-y-4 ${
            isDark ? 'bg-[#14141B] border-zinc-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          {activeForecast ? (
            <>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-amber-400">
                    {activeForecast.asset.assetId}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase text-white"
                    style={{ backgroundColor: riskColor(activeForecast.riskBand) }}
                  >
                    {activeForecast.riskBand} risk
                  </span>
                </div>
                <h3 className="text-sm font-extrabold">{activeForecast.asset.name}</h3>
                <p className="text-[11px] text-zinc-400">
                  {activeForecast.primaryFailureMode}
                </p>
              </div>

              {/* Forecast Metrics Grid */}
              <div className="grid grid-cols-2 gap-2">
                <div
                  className={`p-2.5 rounded-xl border ${
                    isDark ? 'bg-[#1A1A24] border-zinc-800' : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="text-[10px] text-zinc-400">Est. Failure Date</div>
                  <div
                    className="text-xs font-mono font-extrabold mt-0.5"
                    style={{ color: riskColor(activeForecast.riskBand) }}
                  >
                    {activeForecast.estimatedFailureDate}
                  </div>
                  <div className="text-[9.5px] text-zinc-400 font-mono">
                    &plusmn;{activeForecast.uncertaintyDays} days ({activeForecast.daysToFailure}d left)
                  </div>
                </div>
                <div
                  className={`p-2.5 rounded-xl border ${
                    isDark ? 'bg-[#1A1A24] border-zinc-800' : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="text-[10px] text-zinc-400">Health &amp; Historical MTBF</div>
                  <div className="text-xs font-mono font-extrabold text-violet-400 mt-0.5">
                    {activeForecast.healthIndex}% Health
                  </div>
                  <div className="text-[9.5px] text-zinc-400 font-mono">
                    MTBF: {activeForecast.mtbfDays} days
                  </div>
                </div>
              </div>

              {/* Weibull Survival Probability Curve */}
              <div
                className={`p-3 rounded-2xl border space-y-2 ${
                  isDark ? 'bg-[#101016] border-zinc-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between text-[10.5px]">
                  <span className="font-bold text-zinc-300">180-Day Reliability Survival Curve</span>
                  <span className="font-mono text-violet-400">Weibull R(t)</span>
                </div>
                <svg viewBox="0 0 280 88" className="w-full h-24">
                  <line x1="10" y1="76" x2="270" y2="76" stroke="#3F3F46" strokeWidth="1" />
                  <line
                    x1="10"
                    y1="44"
                    x2="270"
                    y2="44"
                    stroke="#F59E0B"
                    strokeDasharray="3 3"
                    strokeWidth="0.8"
                    opacity="0.5"
                  />
                  <path
                    d={survivalPath}
                    fill="none"
                    stroke={riskColor(activeForecast.riskBand)}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                  <text x="12" y="14" className="fill-zinc-400 font-mono text-[8px]">
                    100%
                  </text>
                  <text x="12" y="42" className="fill-amber-400 font-mono text-[8px]">
                    50% Threshold
                  </text>
                  <text x="235" y="85" className="fill-zinc-400 font-mono text-[8px]">
                    +180d
                  </text>
                </svg>
              </div>

              {/* Contributing Historical Lifecycle & Telemetry Factors */}
              <div className="space-y-1.5">
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-violet-400" />
                  Forecast Drivers (Lifecycle + SCADA)
                </div>
                <div className="space-y-1.5">
                  {activeForecast.contributingFactors.map((fac, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded-xl border text-[11px] leading-snug ${
                        isDark
                          ? 'bg-[#1A1A24] border-zinc-800 text-zinc-300'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      {fac}
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons: Launch Workflow / Schedule PM WO / Fly to 3D */}
              <div className="space-y-2 pt-2 border-t border-zinc-800/70">
                <button
                  type="button"
                  onClick={() => handleLaunchPredictiveWorkflow(activeForecast)}
                  className="w-full py-2.5 px-3 rounded-xl gradian-violet-amber text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md hover:opacity-95 transition cursor-pointer"
                >
                  <Workflow className="w-4 h-4" />
                  Launch Predictive Intervention Workflow
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleCreatePreventiveWo(activeForecast)}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                      isDark
                        ? 'bg-[#1A1A24] border-zinc-700 hover:border-emerald-500 text-emerald-400'
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
                        ? 'bg-[#1A1A24] border-zinc-700 hover:border-violet-500 text-violet-300'
                        : 'bg-white border-slate-200 hover:border-violet-500 text-violet-700'
                    }`}
                  >
                    <Compass className="w-3.5 h-3.5" />
                    Locate in 3D
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-zinc-500 p-4 text-center">
              Select any equipment row on the timeline to inspect reliability predictions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
