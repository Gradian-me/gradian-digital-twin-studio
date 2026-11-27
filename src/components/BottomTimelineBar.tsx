import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  Contrast,
  GitCompare,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  RotateCcw,
  Wrench,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useGmpStore } from '../store/useGmpStore';
import { formatArea, formatCurrency, formatLength } from '../utils/spatial';
import {
  computeAssetFailurePredictions,
  type MaintenanceMilestone,
} from '../utils/predictiveMaintenance';

const MIN_TS = new Date('2024-01-01').getTime();
const DEFAULT_MAX_TS = new Date('2027-12-31').getTime();

function dateToPct(dateStr: string, maxTs: number): number {
  const ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return 100;
  return Math.max(0, Math.min(100, ((ts - MIN_TS) / Math.max(1, maxTs - MIN_TS)) * 100));
}

function pctToDate(pct: number, maxTs: number): string {
  const ts = MIN_TS + (Math.max(0, Math.min(100, pct)) / 100) * (maxTs - MIN_TS);
  return new Date(ts).toISOString().slice(0, 10);
}

function milestoneTone(sev: MaintenanceMilestone['severity']) {
  if (sev === 'critical') {
    return {
      pin: 'bg-rose-500 border-white dark:border-zinc-950',
      chipActive: 'border-rose-500 bg-rose-600 text-white',
      chipIdle: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20',
      text: 'text-rose-500 dark:text-rose-400',
      glyph: '✖',
    };
  }
  if (sev === 'warning') {
    return {
      pin: 'bg-amber-500 border-white dark:border-zinc-950',
      chipActive: 'border-amber-500 bg-amber-500 text-zinc-950',
      chipIdle: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20',
      text: 'text-amber-600 dark:text-amber-400',
      glyph: '▲',
    };
  }
  return {
    pin: 'bg-cyan-500 border-white dark:border-zinc-950',
    chipActive: 'border-cyan-500 bg-cyan-600 text-white',
    chipIdle: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-500/20',
    text: 'text-cyan-600 dark:text-cyan-400',
    glyph: '◆',
  };
}

export const BottomTimelineBar: React.FC = () => {
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const cursorCoords = useTwinStore((s) => s.cursorCoords);
  const measurePoints = useTwinStore((s) => s.measurePoints);
  const validationIssues = useTwinStore((s) => s.validationIssues);
  const timelineDate = useTwinStore((s) => s.timelineDate);
  const compareDate = useTwinStore((s) => s.compareDate);
  const timelinePlaying = useTwinStore((s) => s.timelinePlaying);
  const timelineSpeed = useTwinStore((s) => s.timelineSpeed);
  const bottomTimelineOpen = useTwinStore((s) => s.bottomTimelineOpen);
  const leftPanelOpen = useTwinStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useTwinStore((s) => s.rightPanelOpen);
  const canvasBackdrop = useTwinStore((s) => s.canvasBackdrop);
  const selected = useTwinStore((s) => s.selected);
  const firstPersonMode = useTwinStore((s) => s.firstPersonMode);

  const setTimelineDate = useTwinStore((s) => s.setTimelineDate);
  const setCompareDate = useTwinStore((s) => s.setCompareDate);
  const setTimelinePlaying = useTwinStore((s) => s.setTimelinePlaying);
  const setTimelineSpeed = useTwinStore((s) => s.setTimelineSpeed);
  const setBottomTimelineOpen = useTwinStore((s) => s.setBottomTimelineOpen);
  const setLeftPanelOpen = useTwinStore((s) => s.setLeftPanelOpen);
  const setRightPanelOpen = useTwinStore((s) => s.setRightPanelOpen);
  const setRightTab = useTwinStore((s) => s.setRightTab);
  const toggleCanvasBackdrop = useTwinStore((s) => s.toggleCanvasBackdrop);
  const drillInto = useTwinStore((s) => s.drillInto);
  const selectEntity = useTwinStore((s) => s.selectEntity);
  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const showToast = useTwinStore((s) => s.showToast);

  // Live telemetry sensor history & predictive Maintenance Milestones
  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const showMaintenanceMilestones = useTelemetryStore((s) => s.showMaintenanceMilestones);
  const setShowMaintenanceMilestones = useTelemetryStore((s) => s.setShowMaintenanceMilestones);
  const activeMilestoneAssetId = useTelemetryStore((s) => s.activeMilestoneAssetId);
  const setActiveMilestoneAssetId = useTelemetryStore((s) => s.setActiveMilestoneAssetId);
  const openDashboard = useTelemetryStore((s) => s.openDashboard);

  const complianceByAssetId = useGmpStore((s) => s.complianceByAssetId);
  const createWorkOrder = useGmpStore((s) => s.createWorkOrder);
  const personnel = useGmpStore((s) => s.personnel);
  const [drawerTab, setDrawerTab] = useState<'phases' | 'maintenance'>('phases');

  const maintenanceMilestones = useMemo(
    () => computeAssetFailurePredictions(sensors, readings, scene.assets, complianceByAssetId),
    [sensors, readings, scene.assets, complianceByAssetId]
  );

  // Prominent upcoming milestones to pin on the timeline (up to 8 nearest predicted failure dates)
  const timelineMilestones = useMemo(
    () => maintenanceMilestones.slice(0, 8),
    [maintenanceMilestones]
  );

  const urgentMilestoneCount = useMemo(
    () => maintenanceMilestones.filter((m) => m.severity === 'critical' || m.severity === 'warning').length,
    [maintenanceMilestones]
  );

  const maxTs = useMemo(() => {
    let hi = DEFAULT_MAX_TS;
    for (const m of timelineMilestones) {
      const ts = new Date(m.predictedFailureDate).getTime() + 30 * 86_400_000;
      if (!Number.isNaN(ts) && ts > hi) hi = ts;
    }
    return hi;
  }, [timelineMilestones]);

  const maxDateIso = useMemo(() => new Date(maxTs).toISOString().slice(0, 10), [maxTs]);

  const activeMilestone = useMemo(() => {
    if (activeMilestoneAssetId) {
      const byId = maintenanceMilestones.find((m) => m.assetId === activeMilestoneAssetId);
      if (byId) return byId;
    }
    return timelineMilestones.find((m) => m.predictedFailureDate === timelineDate) ?? null;
  }, [activeMilestoneAssetId, maintenanceMilestones, timelineMilestones, timelineDate]);

  // Playback loop when 5D timeline is playing
  useEffect(() => {
    if (!timelinePlaying) return;
    const interval = window.setInterval(() => {
      const current = new Date(useTwinStore.getState().timelineDate).getTime();
      const stepDays = 14 * useTwinStore.getState().timelineSpeed;
      const nextTs = current + stepDays * 86_400_000;
      if (nextTs >= maxTs) {
        setTimelineDate(new Date(maxTs).toISOString().slice(0, 10));
        setTimelinePlaying(false);
      } else {
        setTimelineDate(new Date(nextTs).toISOString().slice(0, 10));
      }
    }, 350);
    return () => window.clearInterval(interval);
  }, [timelinePlaying, maxTs, setTimelineDate, setTimelinePlaying]);

  const floorStats = useMemo(() => {
    const floorRooms = scene.rooms.filter((r) => r.floorId === activeFloorId);
    const floorAssets = scene.assets.filter((a) => a.floorId === activeFloorId);
    const area = floorRooms.reduce((sum, r) => sum + r.width * r.depth, 0);
    return { rooms: floorRooms.length, assets: floorAssets.length, area };
  }, [scene.rooms, scene.assets, activeFloorId]);

  const measureDistance = useMemo(() => {
    if (measurePoints.length < 2) return null;
    const [a, b] = measurePoints;
    return Math.hypot(b.x - a.x, b.z - a.z);
  }, [measurePoints]);

  const statsAtDate = (dateStr: string) => {
    const activeRooms = scene.rooms.filter((r) => r.activeFromDate <= dateStr);
    const activeAssets = scene.assets.filter((a) => a.installationDate <= dateStr);
    const capexRooms = activeRooms.reduce((sum, r) => sum + r.width * r.depth * r.costPerSqm, 0);
    const capexAssets = activeAssets.reduce((sum, a) => sum + a.capexUsd, 0);
    const opex = activeAssets.reduce((sum, a) => sum + a.annualOpexUsd, 0);
    const energyKw =
      activeRooms.reduce((s, r) => s + r.energyKw, 0) +
      activeAssets.reduce((s, a) => s + a.energyKw, 0);
    return {
      rooms: activeRooms.length,
      assets: activeAssets.length,
      capex: capexRooms + capexAssets,
      opex,
      energyKw,
    };
  };

  const current5D = useMemo(() => statsAtDate(timelineDate), [scene, timelineDate]);
  const compare5D = useMemo(
    () => (compareDate ? statsAtDate(compareDate) : null),
    [scene, compareDate]
  );

  const criticalWarnings = validationIssues.filter(
    (v) => v.severity === 'critical' || v.severity === 'error'
  ).length;

  const handleSelectMilestone = (m: MaintenanceMilestone) => {
    setTimelinePlaying(false);
    setTimelineDate(m.predictedFailureDate);
    setActiveMilestoneAssetId(m.assetId);
    setActiveFloor(m.floorId);
    selectEntity({ type: 'asset', id: m.assetId });
    drillInto('asset', m.assetId);
  };

  const handleScheduleMilestonePm = (m: MaintenanceMilestone) => {
    const tech = personnel[0];
    const wo = createWorkOrder({
      title: `Predictive PM — ${m.assetCode} (${m.driverMetricLabel})`,
      description: `Scheduled from 5D Timeline Maintenance Milestone.\nPredicted failure: ${m.predictedFailureDate} (${m.daysUntilFailure}d, ${m.confidencePct}% confidence).\nDriver: ${m.driverSensorTag} (${m.currentValue} ${m.unit} → Alarm ${m.alarmThreshold} ${m.unit}).`,
      serviceType: 'maintenance',
      targetKind: 'asset',
      targetId: m.assetId,
      targetName: `${m.assetCode} · ${m.assetName}`,
      targetCategory: m.category,
      assigneeId: tech?.id ?? 'tech-01',
      assigneeName: tech?.name ?? 'Reliability Engineer',
      priority: m.severity === 'critical' ? 'critical' : m.severity === 'warning' ? 'high' : 'medium',
      status: 'open',
      lastServiceDate: new Date().toISOString().slice(0, 10),
      dueDate: m.recommendedServiceDate,
      estimatedHours: 3,
      checklist: [
        { id: `tl-pm-1-${Date.now()}`, text: m.recommendedAction, done: false },
      ],
    });
    showToast(`Created Predictive PM ${wo.woNumber} for ${m.assetCode} (due ${m.recommendedServiceDate})`, 'success');
  };

  return (
    <footer className="bg-white dark:bg-[#111114] border-t border-zinc-200 dark:border-zinc-800 shrink-0 z-20">
      {/* Simplified, Clean 5D Digital Twin Timeline Drawer */}
      {bottomTimelineOpen && (
        <div className="px-3 sm:px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/95 dark:bg-[#0D0D11] space-y-2">
          {/* Row 1: Compact Controls + Tab Switcher + Concise 5D Metrics */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-1 mr-0.5">
                <Clock className="w-3.5 h-3.5 text-violet-500" />
                <span>5D Timeline</span>
              </span>
              <button
                type="button"
                onClick={() => setTimelinePlaying(!timelinePlaying)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                title={timelinePlaying ? 'Pause 5D Playback' : 'Play 5D Timeline'}
              >
                {timelinePlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{timelinePlaying ? 'Pause' : 'Play'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimelinePlaying(false);
                  setActiveMilestoneAssetId(null);
                  setTimelineDate('2024-03-01');
                }}
                className="p-1 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-[#1E1E28] cursor-pointer"
                title="Reset timeline to project start"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <select
                aria-label="Timeline Playback Speed"
                value={timelineSpeed}
                onChange={(e) => setTimelineSpeed(Number(e.target.value))}
                className="h-6 px-1.5 rounded-lg text-[11px] font-mono bg-white dark:bg-[#181822] border border-zinc-300 dark:border-zinc-700 cursor-pointer"
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
              </select>
              <input
                type="date"
                aria-label="Current 5D Date"
                value={timelineDate}
                min="2024-01-01"
                max={maxDateIso}
                onChange={(e) => setTimelineDate(e.target.value)}
                className="h-6 px-1.5 rounded-lg text-[11px] font-mono bg-white dark:bg-[#181822] border border-zinc-300 dark:border-zinc-700"
              />
              <button
                type="button"
                onClick={() => setCompareDate(compareDate ? null : '2025-06-01')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border whitespace-nowrap cursor-pointer ${
                  compareDate
                    ? 'border-violet-500 bg-violet-500/15 text-violet-600 dark:text-violet-300'
                    : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-zinc-500'
                }`}
                title="Compare active date against a baseline date"
              >
                <GitCompare className="w-3 h-3" />
                <span className="hidden sm:inline">{compareDate ? 'Comparing' : 'Compare'}</span>
              </button>
              {compareDate && (
                <input
                  type="date"
                  aria-label="Comparison Baseline Date"
                  value={compareDate}
                  min="2024-01-01"
                  max={maxDateIso}
                  onChange={(e) => setCompareDate(e.target.value)}
                  className="h-6 px-1.5 rounded-lg text-[11px] font-mono bg-white dark:bg-[#181822] border border-violet-400 dark:border-violet-600"
                />
              )}

              {/* Focused Strip Switcher: Phases vs Maintenance */}
              <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-200/70 dark:bg-[#171722] border border-zinc-300/70 dark:border-zinc-800 ml-0.5">
                <button
                  type="button"
                  onClick={() => setDrawerTab('phases')}
                  className={`px-2 py-0.5 rounded-md text-[10.5px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                    drawerTab === 'phases'
                      ? 'bg-violet-600 text-white'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  Phases ({scene.timelineEvents.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDrawerTab('maintenance');
                    setShowMaintenanceMilestones(true);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                    drawerTab === 'maintenance'
                      ? 'bg-amber-500 text-zinc-950'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  <Wrench className="w-2.5 h-2.5" />
                  <span>Maint. ({timelineMilestones.length})</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => openDashboard({ tab: 'predictive' })}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-zinc-200 dark:border-zinc-800 hover:border-violet-500 text-zinc-700 dark:text-zinc-200 whitespace-nowrap cursor-pointer"
                title="Open Predictive Telemetry Charts"
              >
                <Activity className="w-3 h-3 text-violet-500" />
                <span className="hidden md:inline">Forecast</span>
              </button>
            </div>

            {/* Concise Single-Line 5D KPI Summary */}
            <div className="flex items-center gap-2.5 text-[11px] font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
              <span>
                <strong className="text-zinc-900 dark:text-white">{current5D.rooms}</strong> rooms
                {compare5D && current5D.rooms !== compare5D.rooms && (
                  <span className="text-violet-400 ml-0.5">
                    ({current5D.rooms - compare5D.rooms > 0 ? '+' : ''}
                    {current5D.rooms - compare5D.rooms})
                  </span>
                )}
              </span>
              <span className="text-zinc-400 dark:text-zinc-700">·</span>
              <span>
                <strong className="text-zinc-900 dark:text-white">{current5D.assets}</strong> assets
                {compare5D && current5D.assets !== compare5D.assets && (
                  <span className="text-violet-400 ml-0.5">
                    ({current5D.assets - compare5D.assets > 0 ? '+' : ''}
                    {current5D.assets - compare5D.assets})
                  </span>
                )}
              </span>
              <span className="text-zinc-400 dark:text-zinc-700">·</span>
              <span>
                CapEx <strong className="text-zinc-900 dark:text-white">{formatCurrency(current5D.capex)}</strong>
              </span>
              <span className="hidden xl:inline text-zinc-400 dark:text-zinc-700">·</span>
              <span className="hidden xl:inline">
                OpEx <strong className="text-zinc-900 dark:text-white">{formatCurrency(current5D.opex)}</strong>
              </span>
              <span className="hidden lg:inline text-zinc-400 dark:text-zinc-700">·</span>
              <span className="hidden lg:inline">
                <strong className="text-zinc-900 dark:text-white">{current5D.energyKw.toFixed(0)}</strong> kW
              </span>
            </div>
          </div>

          {/* Row 2: Slim Scrubber Track with Clickable Milestone Diamonds */}
          <div className="relative pt-3">
            {showMaintenanceMilestones && timelineMilestones.length > 0 && (
              <div className="absolute inset-x-1 top-0 h-3 pointer-events-none">
                {timelineMilestones.map((m) => {
                  const leftPct = dateToPct(m.predictedFailureDate, maxTs);
                  const tone = milestoneTone(m.severity);
                  const isFocused = activeMilestone?.assetId === m.assetId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setDrawerTab('maintenance');
                        handleSelectMilestone(m);
                      }}
                      style={{ left: `${leftPct}%` }}
                      title={`${m.assetCode} · Predicted Failure ${m.predictedFailureDate} (${m.daysUntilFailure}d) · ${m.driverSensorTag}`}
                      className={`pointer-events-auto absolute top-0.5 -translate-x-1/2 w-2.5 h-2.5 rotate-45 border cursor-pointer transition-transform ${tone.pin} ${
                        isFocused ? 'scale-125 ring-2 ring-violet-500' : 'hover:scale-125'
                      }`}
                    />
                  );
                })}
              </div>
            )}

            <input
              type="range"
              aria-label="5D Timeline Scrubber"
              min={0}
              max={100}
              step={0.25}
              value={dateToPct(timelineDate, maxTs)}
              onChange={(e) => setTimelineDate(pctToDate(Number(e.target.value), maxTs))}
              className="w-full h-1.5 accent-violet-600 cursor-pointer"
            />
          </div>

          {/* Row 3: Single Clean Horizontal Scrollable Strip (Phases OR Maintenance — never stacked clutter) */}
          {drawerTab === 'phases' ? (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
              {scene.timelineEvents.map((ev) => {
                const isSelected = timelineDate === ev.date && !activeMilestone;
                const isReached = timelineDate >= ev.date;
                const shortTitle =
                  ev.title.length > 28 ? `${ev.title.slice(0, 26).trim()}…` : ev.title;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => {
                      setActiveMilestoneAssetId(null);
                      setTimelineDate(ev.date);
                    }}
                    title={`${ev.date} · ${ev.title} — ${ev.description}`}
                    className={`px-2 py-1 rounded-lg text-[10.5px] border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'border-violet-500 bg-violet-600 text-white font-semibold'
                        : isReached
                          ? 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#171722] text-zinc-800 dark:text-zinc-200 hover:border-violet-500/60'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    <span className="font-mono opacity-75 mr-1">{ev.date.slice(0, 7)}</span>
                    <span>{shortTitle}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                {timelineMilestones.length === 0 ? (
                  <span className="text-[11px] text-zinc-500">All monitored equipment within nominal predictive thresholds.</span>
                ) : (
                  timelineMilestones.map((m) => {
                    const tone = milestoneTone(m.severity);
                    const isSel = activeMilestone?.assetId === m.assetId;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSelectMilestone(m)}
                        title={`${m.assetCode} (${m.assetName}) · Predicted Failure ${m.predictedFailureDate} (${m.daysUntilFailure}d) · ${m.driverSensorTag}: ${m.currentValue}${m.unit} / ${m.alarmThreshold}${m.unit}`}
                        className={`px-2 py-1 rounded-lg text-[10.5px] border transition-colors whitespace-nowrap shrink-0 font-mono tabular-nums cursor-pointer ${
                          isSel ? tone.chipActive : tone.chipIdle
                        }`}
                      >
                        <span className="mr-1">{tone.glyph}</span>
                        <span className="font-semibold">{m.assetCode}</span>
                        <span className="mx-1 opacity-70">·</span>
                        <span>{m.daysUntilFailure}d</span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Compact Action Strip ONLY when a milestone is selected */}
              {activeMilestone && (() => {
                const tone = milestoneTone(activeMilestone.severity);
                return (
                  <div className="px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#14141C] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                      <span className={`font-mono font-bold ${tone.text}`}>
                        {tone.glyph} {activeMilestone.assetCode}
                      </span>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate max-w-[200px]">
                        {activeMilestone.assetName}
                      </span>
                      <span className="text-zinc-400">·</span>
                      <span className="font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                        Due {activeMilestone.predictedFailureDate} ({activeMilestone.daysUntilFailure}d)
                      </span>
                      <span className="hidden md:inline text-zinc-400">·</span>
                      <span className="hidden md:inline font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                        {activeMilestone.driverSensorTag}: {activeMilestone.currentValue}
                        {activeMilestone.unit} / {activeMilestone.alarmThreshold}
                        {activeMilestone.unit} ({activeMilestone.confidencePct}%)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveMilestoneAssetId(activeMilestone.assetId);
                          openDashboard({
                            tab: 'predictive',
                            assetId: activeMilestone.assetId,
                            sensorId: activeMilestone.driverSensorId,
                          });
                        }}
                        className="px-2 py-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-zinc-700 dark:text-zinc-200 font-medium cursor-pointer"
                      >
                        Forecast
                      </button>
                      <button
                        type="button"
                        onClick={() => handleScheduleMilestonePm(activeMilestone)}
                        className="px-2 py-0.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold cursor-pointer"
                      >
                        Schedule PM
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveMilestoneAssetId(null)}
                        className="p-0.5 rounded text-zinc-400 hover:text-zinc-200 cursor-pointer"
                        title="Dismiss milestone detail"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Compact Single-Line Engineering Status Bar */}
      <div className="h-8 px-3 flex items-center justify-between gap-3 text-[11px] text-zinc-600 dark:text-zinc-400">
        {/* Left: Panel Toggles & Live Coordinates */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => setLeftPanelOpen(!leftPanelOpen)}
            title="Toggle Left Spatial Browser"
            className={`p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              leftPanelOpen ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'
            }`}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>

          <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
            X {formatLength(cursorCoords.x, scene.unitSystem)} · Y{' '}
            {formatLength(cursorCoords.y, scene.unitSystem)} · Z{' '}
            {formatLength(cursorCoords.z, scene.unitSystem)}
          </span>

          {measureDistance !== null && (
            <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold whitespace-nowrap">
              · Measure: {formatLength(measureDistance, scene.unitSystem)}
            </span>
          )}

          {firstPersonMode && (
            <span className="hidden lg:inline text-emerald-600 dark:text-emerald-400 font-medium whitespace-nowrap">
              · WASD / Arrows to walk · Mouse drag to look
            </span>
          )}
        </div>

        {/* Center: Active Floor Summary */}
        <div className="hidden md:flex items-center gap-3 font-mono tabular-nums whitespace-nowrap">
          <span>
            {floorStats.rooms} rooms · {formatArea(floorStats.area, scene.unitSystem)} ·{' '}
            {floorStats.assets} assets
          </span>
          {selected.length > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              {selected.length} selected
            </span>
          )}
        </div>

        {/* Right: Warnings, Maintenance Milestones, 5D Drawer Toggle, Canvas Backdrop, Right Panel Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {timelineMilestones.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setDrawerTab('maintenance');
                setShowMaintenanceMilestones(true);
                setBottomTimelineOpen(true);
              }}
              className={`hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer ${
                urgentMilestoneCount > 0
                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                  : 'text-zinc-600 dark:text-zinc-300'
              }`}
              title="View Predictive Maintenance Milestones on 5D Timeline"
            >
              <Wrench className="w-3 h-3" />
              <span className="font-mono tabular-nums">
                {urgentMilestoneCount > 0
                  ? `${urgentMilestoneCount} maint. due`
                  : `${timelineMilestones.length} milestones`}
              </span>
            </button>
          )}

          <button
            onClick={() => setRightTab('validation')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap ${
              criticalWarnings > 0
                ? 'text-red-600 dark:text-red-400 font-medium'
                : validationIssues.length > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
            }`}
            title="Inspect Spatial Validation Warnings"
          >
            <AlertTriangle className="w-3 h-3" />
            <span className="font-mono tabular-nums">{validationIssues.length} checks</span>
          </button>

          <button
            onClick={() => setBottomTimelineOpen(!bottomTimelineOpen)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap cursor-pointer ${
              bottomTimelineOpen
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
            }`}
          >
            <Calendar className="w-3 h-3" />
            <span className="font-mono">{timelineDate}</span>
            {bottomTimelineOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronUp className="w-3 h-3" />
            )}
          </button>

          <button
            onClick={toggleCanvasBackdrop}
            title={`Canvas Backdrop: ${canvasBackdrop === 'dark' ? 'Dark' : 'Light'}`}
            className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
          >
            <Contrast className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            title="Toggle Right Inspector"
            className={`p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              rightPanelOpen ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'
            }`}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </footer>
  );
};
