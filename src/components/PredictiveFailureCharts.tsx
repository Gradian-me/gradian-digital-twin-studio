import React, { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Crosshair,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import type { LiveSensorSnapshot, SensorDefinition } from '../types/telemetry';
import {
  buildSensorForecastSeries,
  type MaintenanceMilestone,
  type MaintenanceSeverity,
} from '../utils/predictiveMaintenance';

interface PredictiveFailureChartsProps {
  milestones: MaintenanceMilestone[];
  selectedMilestone: MaintenanceMilestone | null;
  selectedSensor: SensorDefinition | null;
  selectedSnapshot?: LiveSensorSnapshot;
  isDark?: boolean;
  onSelectAsset: (assetId: string) => void;
  onJumpToTimeline?: (milestone: MaintenanceMilestone) => void;
  onSchedulePm?: (milestone: MaintenanceMilestone) => void;
}

interface HorizonChartDatum {
  dayOffset: number;
  axisLabel: string;
  dateLabel: string;
  historyValue: number | null;
  forecastValue: number | null;
  warnLimit: number;
  alarmLimit: number;
  kind: 'history' | 'now' | 'forecast';
}

interface FleetBarDatum {
  assetId: string;
  code: string;
  name: string;
  daysUntilFailure: number;
  healthScore: number;
  severity: MaintenanceSeverity;
  predictedFailureDate: string;
  driverSensorTag: string;
  confidencePct: number;
}

const SEVERITY_HEX: Record<MaintenanceSeverity, string> = {
  critical: '#E11D48',
  warning: '#D97706',
  advisory: '#0891B2',
  healthy: '#059669',
};

const SEVERITY_LABEL: Record<MaintenanceSeverity, string> = {
  critical: 'Critical Risk',
  warning: 'Elevated Drift',
  advisory: 'Advisory Watch',
  healthy: 'Nominal Horizon',
};

export const PredictiveFailureCharts: React.FC<PredictiveFailureChartsProps> = ({
  milestones,
  selectedMilestone,
  selectedSensor,
  selectedSnapshot,
  isDark = true,
  onSelectAsset,
  onJumpToTimeline,
  onSchedulePm,
}) => {
  const [fleetMetric, setFleetMetric] = useState<'days' | 'health'>('days');

  const gridStroke = isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.10)';
  const axisTickColor = isDark ? '#94A3B8' : '#475569';
  const surfaceBg = isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200';
  const subSurfaceBg = isDark ? 'bg-slate-950/70 border-slate-800/80' : 'bg-slate-50 border-slate-200';
  const primaryText = isDark ? 'text-slate-100' : 'text-slate-900';
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-600';

  const activeMilestone = selectedMilestone ?? milestones[0] ?? null;

  const { horizonData, yDomain, warnLimit, alarmLimit, severityHex } = useMemo(() => {
    if (!activeMilestone || !selectedSensor) {
      return {
        horizonData: [] as HorizonChartDatum[],
        yDomain: [0, 100] as [number, number],
        warnLimit: 0,
        alarmLimit: 0,
        severityHex: SEVERITY_HEX.advisory,
      };
    }

    const raw = buildSensorForecastSeries(selectedSensor, selectedSnapshot, activeMilestone);
    const wLimit =
      activeMilestone.boundDirection === 'high'
        ? selectedSensor.warnHigh
        : selectedSensor.warnLow;
    const aLimit = activeMilestone.alarmThreshold;

    // Deduplicate dayOffset & bridge Day 0 so history and forecast connect seamlessly
    const byDay = new Map<number, HorizonChartDatum>();
    let lastHistoryDay = 0;
    let lastHistoryVal = activeMilestone.currentValue;

    for (const pt of raw) {
      const axisLabel =
        pt.dayOffset === 0
          ? 'Today'
          : pt.dayOffset > 0
            ? `+${pt.dayOffset}d`
            : `${pt.dayOffset}d`;

      if (pt.kind === 'history') {
        lastHistoryDay = pt.dayOffset;
        lastHistoryVal = pt.value;
        byDay.set(pt.dayOffset, {
          dayOffset: pt.dayOffset,
          axisLabel,
          dateLabel: pt.dateLabel,
          historyValue: pt.value,
          forecastValue: null,
          warnLimit: wLimit,
          alarmLimit: aLimit,
          kind: pt.dayOffset === 0 ? 'now' : 'history',
        });
      } else {
        const existing = byDay.get(pt.dayOffset);
        if (existing) {
          existing.forecastValue = pt.value;
        } else {
          byDay.set(pt.dayOffset, {
            dayOffset: pt.dayOffset,
            axisLabel,
            dateLabel: pt.dateLabel,
            historyValue: null,
            forecastValue: pt.value,
            warnLimit: wLimit,
            alarmLimit: aLimit,
            kind: 'forecast',
          });
        }
      }
    }

    // Bridge last history point into forecast line so there is no gap at Day 0
    const bridge = byDay.get(lastHistoryDay);
    if (bridge) {
      bridge.forecastValue = lastHistoryVal;
      bridge.kind = 'now';
    } else {
      byDay.set(0, {
        dayOffset: 0,
        axisLabel: 'Today',
        dateLabel: new Date().toISOString().slice(0, 10),
        historyValue: activeMilestone.currentValue,
        forecastValue: activeMilestone.currentValue,
        warnLimit: wLimit,
        alarmLimit: aLimit,
        kind: 'now',
      });
    }

    const sorted = Array.from(byDay.values()).sort((a, b) => a.dayOffset - b.dayOffset);
    const allVals: number[] = [wLimit, aLimit, selectedSensor.nominal];
    for (const d of sorted) {
      if (d.historyValue !== null) allVals.push(d.historyValue);
      if (d.forecastValue !== null) allVals.push(d.forecastValue);
    }

    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const span = Math.max(0.5, maxV - minV);
    const pad = span * 0.14;

    return {
      horizonData: sorted,
      yDomain: [
        Number((minV - pad).toFixed(selectedSensor.precision + 1)),
        Number((maxV + pad).toFixed(selectedSensor.precision + 1)),
      ] as [number, number],
      warnLimit: wLimit,
      alarmLimit: aLimit,
      severityHex: SEVERITY_HEX[activeMilestone.severity],
    };
  }, [activeMilestone, selectedSensor, selectedSnapshot]);

  const fleetBarData = useMemo<FleetBarDatum[]>(() => {
    return milestones.slice(0, 12).map((m) => ({
      assetId: m.assetId,
      code: m.assetCode.length > 12 ? `${m.assetCode.slice(0, 11)}…` : m.assetCode,
      name: m.assetName,
      daysUntilFailure: m.daysUntilFailure,
      healthScore: m.healthScore,
      severity: m.severity,
      predictedFailureDate: m.predictedFailureDate,
      driverSensorTag: m.driverSensorTag,
      confidencePct: m.confidencePct,
    }));
  }, [milestones]);

  if (!activeMilestone) {
    return (
      <div className={`rounded-xl border p-8 text-center ${surfaceBg}`}>
        <Activity className="w-8 h-8 mx-auto mb-3 text-slate-400" />
        <h3 className={`text-sm font-semibold ${primaryText}`}>
          No Equipment Telemetry Available for Failure Forecasting
        </h3>
        <p className={`text-xs mt-1 max-w-md mx-auto ${mutedText}`}>
          Attach at least one live equipment sensor in the Define Tags tab to generate OLS drift curves and predicted maintenance milestones.
        </p>
      </div>
    );
  }

  const todayAxisLabel =
    horizonData.find((d) => d.kind === 'now')?.axisLabel ?? 'Today';
  const failureAxisLabel =
    horizonData.length > 0 ? horizonData[horizonData.length - 1].axisLabel : undefined;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      {/* Primary Degradation & Predicted Failure Chart */}
      <section className={`xl:col-span-7 rounded-xl border p-4 flex flex-col gap-3 ${surfaceBg}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 shrink-0" style={{ color: severityHex }} />
              <h3 className={`text-sm font-semibold truncate ${primaryText}`}>
                {activeMilestone.assetCode} — {activeMilestone.assetName}
              </h3>
            </div>
            <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs mt-1 ${mutedText}`}>
              <span className="font-mono tabular-nums">{activeMilestone.driverSensorTag}</span>
              <span aria-hidden="true">·</span>
              <span>{activeMilestone.driverMetricLabel}</span>
              <span aria-hidden="true">·</span>
              <span style={{ color: severityHex }} className="font-medium">
                {SEVERITY_LABEL[activeMilestone.severity]}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                R² {activeMilestone.rSquared.toFixed(2)} ({activeMilestone.confidencePct}% conf)
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onJumpToTimeline && (
              <button
                type="button"
                onClick={() => onJumpToTimeline(activeMilestone)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                  isDark
                    ? 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                Inspect in 3D
              </button>
            )}
            {onSchedulePm && (
              <button
                type="button"
                onClick={() => onSchedulePm(activeMilestone)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors whitespace-nowrap shrink-0"
              >
                <CalendarClock className="w-3.5 h-3.5" />
                Schedule PM
              </button>
            )}
          </div>
        </div>

        {/* Inline Tabular Key Figures Strip (zero-pill hairline grid) */}
        <div
          className={`grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border px-3 py-2.5 ${subSurfaceBg}`}
        >
          <div>
            <div className={`text-[11px] ${mutedText}`}>Current Reading</div>
            <div className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${primaryText}`}>
              {activeMilestone.currentValue.toFixed(activeMilestone.precision)} {activeMilestone.unit}
            </div>
          </div>
          <div>
            <div className={`text-[11px] ${mutedText}`}>Alarm Limit ({activeMilestone.boundDirection})</div>
            <div className="text-sm font-semibold font-mono tabular-nums mt-0.5 text-rose-500">
              {activeMilestone.alarmThreshold.toFixed(activeMilestone.precision)} {activeMilestone.unit}
            </div>
          </div>
          <div>
            <div className={`text-[11px] ${mutedText}`}>Predicted Failure</div>
            <div
              className="text-sm font-semibold font-mono tabular-nums mt-0.5"
              style={{ color: severityHex }}
            >
              {activeMilestone.predictedFailureDate} ({activeMilestone.daysUntilFailure}d)
            </div>
          </div>
          <div>
            <div className={`text-[11px] ${mutedText}`}>Drift Rate / Day</div>
            <div className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${primaryText}`}>
              {activeMilestone.driftPerDay >= 0 ? '+' : ''}
              {activeMilestone.driftPerDay} {activeMilestone.unit}
            </div>
          </div>
        </div>

        {/* Recharts ComposedChart: Observed History + Projected Failure Curve */}
        <div className="w-full h-[270px] sm:h-[290px]">
          {horizonData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={horizonData}
                margin={{ top: 14, right: 20, left: 4, bottom: 8 }}
              >
                <defs>
                  <linearGradient id="pfHistoryFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366F1" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#6366F1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis
                  dataKey="axisLabel"
                  tick={{ fill: axisTickColor, fontSize: 11 }}
                  axisLine={{ stroke: gridStroke }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={yDomain}
                  tick={{ fill: axisTickColor, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                  tickFormatter={(v: number) =>
                    `${Number(v).toFixed(Math.min(1, activeMilestone.precision))}`
                  }
                />

                {/* Shaded Risk Zone between Warning and Alarm thresholds */}
                <ReferenceArea
                  y1={Math.min(warnLimit, alarmLimit)}
                  y2={Math.max(warnLimit, alarmLimit)}
                  fill="#F59E0B"
                  fillOpacity={isDark ? 0.1 : 0.12}
                />

                {/* Warning Threshold */}
                <ReferenceLine
                  y={warnLimit}
                  stroke="#D97706"
                  strokeDasharray="4 4"
                  strokeWidth={1.25}
                  label={{
                    value: `Warn ${warnLimit}`,
                    position: 'insideTopLeft',
                    fill: '#D97706',
                    fontSize: 10,
                  }}
                />

                {/* Alarm / Failure Threshold */}
                <ReferenceLine
                  y={alarmLimit}
                  stroke="#E11D48"
                  strokeDasharray="5 3"
                  strokeWidth={1.5}
                  label={{
                    value: `Alarm ${alarmLimit} ${activeMilestone.unit}`,
                    position: 'insideBottomLeft',
                    fill: '#E11D48',
                    fontSize: 10,
                  }}
                />

                {/* Today Marker */}
                <ReferenceLine
                  x={todayAxisLabel}
                  stroke={isDark ? '#94A3B8' : '#475569'}
                  strokeDasharray="2 3"
                  label={{
                    value: 'Today',
                    position: 'top',
                    fill: axisTickColor,
                    fontSize: 10,
                  }}
                />

                {/* Predicted Failure Horizon Marker */}
                {failureAxisLabel && failureAxisLabel !== todayAxisLabel && (
                  <ReferenceLine
                    x={failureAxisLabel}
                    stroke={severityHex}
                    strokeDasharray="3 3"
                    label={{
                      value: `Failure (${activeMilestone.daysUntilFailure}d)`,
                      position: 'insideTopRight',
                      fill: severityHex,
                      fontSize: 10,
                    }}
                  />
                )}

                <Tooltip
                  cursor={{
                    stroke: isDark ? 'rgba(148,163,184,0.35)' : 'rgba(15,23,42,0.25)',
                    strokeWidth: 1,
                  }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0].payload as HorizonChartDatum;
                    const activeVal = row.forecastValue ?? row.historyValue ?? 0;
                    const margin = Math.abs(alarmLimit - activeVal);
                    return (
                      <div
                        className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
                          isDark
                            ? 'bg-slate-950 border-slate-700 text-slate-100'
                            : 'bg-white border-slate-200 text-slate-900'
                        }`}
                      >
                        <div className="font-semibold font-mono tabular-nums">
                          {row.dateLabel} ({row.axisLabel})
                        </div>
                        <div className="mt-1 space-y-0.5 font-mono tabular-nums">
                          {row.historyValue !== null && (
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-indigo-400">Observed</span>
                              <span>
                                {row.historyValue.toFixed(activeMilestone.precision)}{' '}
                                {activeMilestone.unit}
                              </span>
                            </div>
                          )}
                          {row.forecastValue !== null && (
                            <div className="flex items-center justify-between gap-4">
                              <span style={{ color: severityHex }}>Projected</span>
                              <span>
                                {row.forecastValue.toFixed(activeMilestone.precision)}{' '}
                                {activeMilestone.unit}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-700/40 text-[11px] opacity-80">
                            <span>Alarm Margin</span>
                            <span>
                              {margin.toFixed(activeMilestone.precision)} {activeMilestone.unit}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />

                <Area
                  type="monotone"
                  dataKey="historyValue"
                  name="Observed History"
                  stroke="#6366F1"
                  strokeWidth={2.25}
                  fill="url(#pfHistoryFill)"
                  dot={{ r: 2.5, fill: '#6366F1', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#818CF8', stroke: '#ffffff', strokeWidth: 1.5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />

                <Line
                  type="monotone"
                  dataKey="forecastValue"
                  name="OLS Failure Trajectory"
                  stroke={severityHex}
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  dot={{ r: 3, fill: severityHex, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: severityHex, stroke: '#ffffff', strokeWidth: 1.5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className={`h-full flex items-center justify-center text-xs ${mutedText}`}>
              Waiting for sensor history samples…
            </div>
          )}
        </div>

        {/* Recommended Engineering Action */}
        <div
          className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs ${subSurfaceBg}`}
        >
          <AlertTriangle
            className="w-4 h-4 shrink-0 mt-0.5"
            style={{ color: severityHex }}
          />
          <div className="min-w-0">
            <span className={`font-semibold ${primaryText}`}>
              Recommended Service ({activeMilestone.recommendedServiceDate}):{' '}
            </span>
            <span className={mutedText}>{activeMilestone.recommendedAction}</span>
          </div>
        </div>
      </section>

      {/* Secondary Fleet Failure Horizon Comparison BarChart */}
      <section className={`xl:col-span-5 rounded-xl border p-4 flex flex-col gap-3 ${surfaceBg}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
              <h3 className={`text-sm font-semibold ${primaryText}`}>
                Fleet Failure Horizon
              </h3>
            </div>
            <p className={`text-xs mt-0.5 ${mutedText}`}>
              Click any equipment bar to inspect its degradation curve
            </p>
          </div>

          <div
            className={`inline-flex items-center gap-0.5 p-0.5 rounded-lg border ${
              isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setFleetMetric('days')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                fleetMetric === 'days'
                  ? isDark
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-900 shadow-xs'
                  : mutedText
              }`}
            >
              Days Left
            </button>
            <button
              type="button"
              onClick={() => setFleetMetric('health')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                fleetMetric === 'health'
                  ? isDark
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-900 shadow-xs'
                  : mutedText
              }`}
            >
              Health %
            </button>
          </div>
        </div>

        <div className="w-full h-[305px] sm:h-[325px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={fleetBarData}
              layout="vertical"
              margin={{ top: 6, right: 18, left: 6, bottom: 6 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
              <XAxis
                type="number"
                domain={fleetMetric === 'health' ? [0, 100] : [0, 'dataMax']}
                tick={{ fill: axisTickColor, fontSize: 11 }}
                axisLine={{ stroke: gridStroke }}
                tickLine={false}
                tickFormatter={(v: number) => (fleetMetric === 'health' ? `${v}%` : `${v}d`)}
              />
              <YAxis
                type="category"
                dataKey="code"
                width={86}
                tick={{ fill: axisTickColor, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              {fleetMetric === 'days' && (
                <ReferenceLine
                  x={14}
                  stroke="#E11D48"
                  strokeDasharray="3 3"
                  label={{
                    value: '14d Crit',
                    position: 'top',
                    fill: '#E11D48',
                    fontSize: 10,
                  }}
                />
              )}
              <Tooltip
                cursor={{
                  fill: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.05)',
                }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const item = payload[0].payload as FleetBarDatum;
                  return (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
                        isDark
                          ? 'bg-slate-950 border-slate-700 text-slate-100'
                          : 'bg-white border-slate-200 text-slate-900'
                      }`}
                    >
                      <div className="font-semibold">{item.name}</div>
                      <div className={`text-[11px] font-mono ${mutedText}`}>
                        {item.code} · {item.driverSensorTag}
                      </div>
                      <div className="mt-1.5 space-y-0.5 font-mono tabular-nums">
                        <div className="flex items-center justify-between gap-4">
                          <span className={mutedText}>Failure Date</span>
                          <span style={{ color: SEVERITY_HEX[item.severity] }}>
                            {item.predictedFailureDate} ({item.daysUntilFailure}d)
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className={mutedText}>Health Score</span>
                          <span>{item.healthScore} / 100</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className={mutedText}>Confidence</span>
                          <span>{item.confidencePct}%</span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey={fleetMetric === 'days' ? 'daysUntilFailure' : 'healthScore'}
                radius={[0, 4, 4, 0]}
                barSize={16}
                isAnimationActive={false}
                onClick={(entry) => {
                  const id = (entry as unknown as FleetBarDatum | undefined)?.assetId;
                  if (id) onSelectAsset(id);
                }}
              >
                {fleetBarData.map((entry) => {
                  const isSelected = entry.assetId === activeMilestone.assetId;
                  return (
                    <Cell
                      key={entry.assetId}
                      cursor="pointer"
                      fill={SEVERITY_HEX[entry.severity]}
                      fillOpacity={isSelected ? 1 : 0.65}
                      stroke={isSelected ? (isDark ? '#F8FAFC' : '#0F172A') : 'none'}
                      strokeWidth={isSelected ? 1.5 : 0}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend Footer (clean unboxed typographic strip) */}
        <div
          className={`flex flex-wrap items-center justify-between gap-2 pt-2 border-t text-[11px] ${
            isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-600'
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-rose-600 inline-block" />
              Critical (&le;14d)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-600 inline-block" />
              Warning (&le;45d)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-cyan-600 inline-block" />
              Advisory (&le;105d)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
              Healthy
            </span>
          </div>
          <span className="font-mono tabular-nums">
            Showing {fleetBarData.length} of {milestones.length} assets
          </span>
        </div>
      </section>
    </div>
  );
};
