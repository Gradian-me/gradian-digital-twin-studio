import React, { useEffect, useMemo } from 'react';
import {
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
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { formatArea, formatCurrency, formatLength } from '../utils/spatial';

const MIN_TS = new Date('2024-01-01').getTime();
const MAX_TS = new Date('2027-06-30').getTime();

function dateToPct(dateStr: string): number {
  const ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return 100;
  return Math.max(0, Math.min(100, ((ts - MIN_TS) / (MAX_TS - MIN_TS)) * 100));
}

function pctToDate(pct: number): string {
  const ts = MIN_TS + (Math.max(0, Math.min(100, pct)) / 100) * (MAX_TS - MIN_TS);
  return new Date(ts).toISOString().slice(0, 10);
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

  // Playback loop when 5D timeline is playing
  useEffect(() => {
    if (!timelinePlaying) return;
    const interval = window.setInterval(() => {
      const current = new Date(useTwinStore.getState().timelineDate).getTime();
      const stepDays = 14 * useTwinStore.getState().timelineSpeed;
      const nextTs = current + stepDays * 86_400_000;
      if (nextTs >= MAX_TS) {
        setTimelineDate(new Date(MAX_TS).toISOString().slice(0, 10));
        setTimelinePlaying(false);
      } else {
        setTimelineDate(new Date(nextTs).toISOString().slice(0, 10));
      }
    }, 350);
    return () => window.clearInterval(interval);
  }, [timelinePlaying, setTimelineDate, setTimelinePlaying]);

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

  return (
    <footer className="bg-white dark:bg-[#111114] border-t border-zinc-200 dark:border-zinc-800 shrink-0 z-20">
      {/* Expandable 5D Digital Twin Timeline Drawer */}
      {bottomTimelineOpen && (
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-[#0D0D10] space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-violet-500" />
                5D Lifecycle Timeline
              </span>
              <button
                onClick={() => setTimelinePlaying(!timelinePlaying)}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium whitespace-nowrap"
              >
                {timelinePlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                {timelinePlaying ? 'Pause' : 'Play'}
              </button>
              <button
                onClick={() => {
                  setTimelinePlaying(false);
                  setTimelineDate('2024-03-01');
                }}
                className="p-1 rounded border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#22222C]"
                title="Reset timeline to project start"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <select
                aria-label="Timeline Playback Speed"
                value={timelineSpeed}
                onChange={(e) => setTimelineSpeed(Number(e.target.value))}
                className="h-6 px-1.5 rounded text-[11px] font-mono bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
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
                max="2027-06-30"
                onChange={(e) => setTimelineDate(e.target.value)}
                className="h-6 px-2 rounded text-[11px] font-mono bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
              />
              <button
                onClick={() => setCompareDate(compareDate ? null : '2025-06-01')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border whitespace-nowrap ${
                  compareDate
                    ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                    : 'border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                <GitCompare className="w-3 h-3" />
                {compareDate ? 'Comparing' : 'Compare Date'}
              </button>
              {compareDate && (
                <input
                  type="date"
                  aria-label="Comparison Baseline Date"
                  value={compareDate}
                  min="2024-01-01"
                  max="2027-06-30"
                  onChange={(e) => setCompareDate(e.target.value)}
                  className="h-6 px-2 rounded text-[11px] font-mono bg-white dark:bg-[#1C1C24] border border-blue-400 dark:border-blue-600"
                />
              )}
            </div>

            {/* 5D Operational & Cost Metrics */}
            <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono tabular-nums">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Spaces </span>
                <span className="font-semibold text-slate-900 dark:text-white">{current5D.rooms}</span>
                {compare5D && (
                  <span className="text-violet-500 ml-1">
                    ({current5D.rooms - compare5D.rooms >= 0 ? '+' : ''}
                    {current5D.rooms - compare5D.rooms})
                  </span>
                )}
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Assets </span>
                <span className="font-semibold text-slate-900 dark:text-white">{current5D.assets}</span>
                {compare5D && (
                  <span className="text-violet-500 ml-1">
                    ({current5D.assets - compare5D.assets >= 0 ? '+' : ''}
                    {current5D.assets - compare5D.assets})
                  </span>
                )}
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">CapEx </span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {formatCurrency(current5D.capex)}
                </span>
                {compare5D && (
                  <span className="text-violet-500 ml-1">
                    ({current5D.capex >= compare5D.capex ? '+' : '-'}
                    {formatCurrency(Math.abs(current5D.capex - compare5D.capex))})
                  </span>
                )}
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Annual OpEx </span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {formatCurrency(current5D.opex)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Load </span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {current5D.energyKw.toFixed(0)} kW
                </span>
              </div>
            </div>
          </div>

          {/* Scrubber Track + Milestone Pins */}
          <div className="space-y-1.5">
            <input
              type="range"
              aria-label="5D Timeline Scrubber"
              min={0}
              max={100}
              step={0.5}
              value={dateToPct(timelineDate)}
              onChange={(e) => setTimelineDate(pctToDate(Number(e.target.value)))}
              className="w-full accent-blue-600"
            />
            <div className="flex flex-wrap items-center gap-2">
              {scene.timelineEvents.map((ev) => {
                const isActive = timelineDate >= ev.date;
                return (
                  <button
                    key={ev.id}
                    onClick={() => setTimelineDate(ev.date)}
                    title={`${ev.date}: ${ev.description}`}
                    className={`px-2 py-0.5 rounded text-[11px] border transition-colors whitespace-nowrap ${
                      timelineDate === ev.date
                        ? 'border-violet-500 bg-violet-600 text-white'
                        : isActive
                          ? 'border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#1C1C24] text-slate-800 dark:text-slate-200'
                          : 'border-slate-200 dark:border-zinc-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    <span className="font-mono mr-1 opacity-75">{ev.date.slice(0, 7)}</span>
                    {ev.title}
                  </button>
                );
              })}
            </div>
          </div>
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

        {/* Right: Warnings, 5D Drawer Toggle, Canvas Backdrop, Right Panel Toggle */}
        <div className="flex items-center gap-2 shrink-0">
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
            className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap ${
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
