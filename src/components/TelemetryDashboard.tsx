import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Box,
  CalendarClock,
  ChevronRight,
  Cpu,
  ExternalLink,
  GitBranch,
  Layers,
  Minus,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  TrendingDown,
  Wrench,
  X,
} from 'lucide-react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import { AssetMini3DViewer } from './AssetMini3DViewer';
import { PredictiveFailureCharts } from './PredictiveFailureCharts';
import { VirtualGrid, VirtualList } from './VirtualList';
import {
  computeAssetFailurePredictions,
  type MaintenanceMilestone,
  type MaintenanceSeverity,
} from '../utils/predictiveMaintenance';

type TelemetryDashboardTab = 'trends' | 'equipment' | 'predictive' | 'define' | 'relationships';
import {
  METRIC_PRESETS,
  type LiveSensorSnapshot,
  type SensorDefinition,
  type SensorMetricType,
  type SensorProtocol,
  type SensorRelationshipType,
  type SensorStatus,
} from '../types/telemetry';

interface Props {
  standalone?: boolean;
}

const RELATIONSHIP_META: Record<
  SensorRelationshipType,
  { label: string; color: string; short: string }
> = {
  controls: { label: 'PID Control Loop', color: '#8B5CF6', short: 'Controls' },
  cascades_to: { label: 'Pressure Cascade', color: '#38BDF8', short: 'Cascades To' },
  redundant_backup: { label: 'Redundant Backup', color: '#A78BFA', short: 'Redundant' },
  interlocks: { label: 'Safety Interlock', color: '#F43F5E', short: 'Interlocks' },
  correlates_with: { label: 'Process Correlation', color: '#F59E0B', short: 'Correlates' },
  feeds_into: { label: 'Utility / Media Feed', color: '#10B981', short: 'Feeds Into' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusText(status: SensorStatus): { label: string; cls: string; badgeCls: string; glyph: string } {
  if (status === 'alarm') {
    return {
      label: 'Alarm',
      cls: 'text-rose-500 dark:text-rose-400',
      badgeCls: 'bg-rose-500/15 text-rose-500 dark:text-rose-400 border-rose-500/30',
      glyph: '✖',
    };
  }
  if (status === 'warning') {
    return {
      label: 'Drifting',
      cls: 'text-amber-600 dark:text-amber-400',
      badgeCls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
      glyph: '▲',
    };
  }
  return {
    label: 'Nominal',
    cls: 'text-emerald-600 dark:text-emerald-400',
    badgeCls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    glyph: '●',
  };
}

/**
 * Compact crisp SVG sparkline for equipment cards, overview widgets & sensor rows.
 */
export const MiniSparkline: React.FC<{
  points: { value: number }[];
  color: string;
  width?: number;
  height?: number;
}> = ({ points, color, width = 92, height = 26 }) => {
  if (!points || points.length < 2) {
    return <div style={{ width, height }} className="opacity-30 shrink-0" />;
  }
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(0.0001, max - min);
  const path = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * width;
      const y = height - 3 - ((v - min) / span) * (height - 6);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible shrink-0">
      <path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

function severityMeta(sev: MaintenanceSeverity): { label: string; glyph: string; textCls: string; accentHex: string } {
  if (sev === 'critical') {
    return { label: 'Critical', glyph: '✖', textCls: 'text-rose-500 dark:text-rose-400', accentHex: '#F43F5E' };
  }
  if (sev === 'warning') {
    return { label: 'Due Soon', glyph: '▲', textCls: 'text-amber-600 dark:text-amber-400', accentHex: '#F59E0B' };
  }
  if (sev === 'advisory') {
    return { label: 'Advisory', glyph: '◆', textCls: 'text-cyan-600 dark:text-cyan-400', accentHex: '#06B6D4' };
  }
  return { label: 'Healthy', glyph: '●', textCls: 'text-emerald-600 dark:text-emerald-400', accentHex: '#10B981' };
}

/**
 * High-precision interactive SVG time-series trend chart with hover crosshair,
 * setpoint band, warning/alarm threshold reference lines, and live value readout.
 */
const LiveTrendChart: React.FC<{
  sensor: SensorDefinition;
  snapshot?: LiveSensorSnapshot;
}> = ({ sensor, snapshot }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const history = snapshot?.history ?? [];
  const metricColor = METRIC_PRESETS[sensor.metric]?.color ?? '#8B5CF6';

  const W = 720;
  const H = 228;
  const padL = 52;
  const padR = 20;
  const padT = 18;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const { yMin, yMax, pathD, areaD, pts } = useMemo(() => {
    const vals = history.map((p) => p.value);
    const dataMin = vals.length ? Math.min(...vals) : sensor.nominal - 1;
    const dataMax = vals.length ? Math.max(...vals) : sensor.nominal + 1;
    const lo = Math.min(dataMin, sensor.warnLow, sensor.nominal) - Math.max(0.2, (sensor.warnHigh - sensor.warnLow) * 0.2);
    const hi = Math.max(dataMax, sensor.warnHigh, sensor.nominal) + Math.max(0.2, (sensor.warnHigh - sensor.warnLow) * 0.2);
    const span = Math.max(0.001, hi - lo);

    const mapped = history.map((pt, i) => {
      const x = padL + (history.length > 1 ? (i / (history.length - 1)) * innerW : innerW);
      const y = padT + innerH - ((pt.value - lo) / span) * innerH;
      return { ...pt, x, y };
    });

    const d = mapped.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const a = mapped.length
      ? `${d} L${mapped[mapped.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${mapped[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`
      : '';

    return { yMin: lo, yMax: hi, pathD: d, areaD: a, pts: mapped };
  }, [history, sensor, innerW, innerH]);

  const mapY = (v: number) => padT + innerH - ((v - yMin) / Math.max(0.001, yMax - yMin)) * innerH;
  const activePt = hoverIdx !== null && pts[hoverIdx] ? pts[hoverIdx] : pts[pts.length - 1];

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + (yMax - yMin) * t);

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="font-mono font-semibold text-violet-600 dark:text-violet-400">{sensor.tag}</span>
          <span className="text-zinc-600 dark:text-zinc-300 truncate">{sensor.name}</span>
          <span className="text-zinc-400 hidden sm:inline">·</span>
          <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 hidden sm:inline">
            {sensor.protocol} / {sensor.plcAddress}
          </span>
        </div>
        {activePt && (
          <div className="flex items-center gap-2 font-mono tabular-nums text-[11px] text-zinc-600 dark:text-zinc-300 shrink-0">
            <span>{formatTime(activePt.ts)}</span>
            <span className="text-zinc-400">·</span>
            <span className="font-semibold text-zinc-900 dark:text-white">
              {activePt.value.toFixed(sensor.precision)} {sensor.unit}
            </span>
          </div>
        )}
      </div>

      <div className="relative w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-[#0B0B0E]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-[228px] block cursor-crosshair select-none"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={(e) => {
            if (!pts.length) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * W;
            const ratio = Math.max(0, Math.min(1, (relX - padL) / innerW));
            setHoverIdx(Math.round(ratio * (pts.length - 1)));
          }}
        >
          <defs>
            <linearGradient id={`grad-${sensor.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={metricColor} stopOpacity="0.30" />
              <stop offset="100%" stopColor={metricColor} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {yTicks.map((val, i) => {
            const y = mapY(val);
            return (
              <g key={i}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-zinc-200 dark:text-zinc-800/80"
                  strokeWidth={1}
                />
                <text
                  x={padL - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-zinc-500 font-mono text-[10px]"
                >
                  {val.toFixed(sensor.precision)}
                </text>
              </g>
            );
          })}

          <rect
            x={padL}
            y={Math.max(padT, mapY(sensor.warnHigh))}
            width={innerW}
            height={Math.max(2, Math.min(padT + innerH, mapY(sensor.warnLow)) - Math.max(padT, mapY(sensor.warnHigh)))}
            fill="#8B5CF6"
            opacity={0.07}
          />

          <line
            x1={padL}
            x2={W - padR}
            y1={mapY(sensor.nominal)}
            y2={mapY(sensor.nominal)}
            stroke="#8B5CF6"
            strokeDasharray="4 4"
            strokeWidth={1}
            opacity={0.7}
          />

          {sensor.alarmHigh <= yMax && sensor.alarmHigh >= yMin && (
            <g>
              <line
                x1={padL}
                x2={W - padR}
                y1={mapY(sensor.alarmHigh)}
                y2={mapY(sensor.alarmHigh)}
                stroke="#F43F5E"
                strokeDasharray="3 3"
                strokeWidth={1}
                opacity={0.8}
              />
              <text x={W - padR - 4} y={mapY(sensor.alarmHigh) - 4} textAnchor="end" className="fill-rose-400 font-mono text-[9px]">
                HI ALARM {sensor.alarmHigh}
              </text>
            </g>
          )}

          {sensor.alarmLow <= yMax && sensor.alarmLow >= yMin && (
            <g>
              <line
                x1={padL}
                x2={W - padR}
                y1={mapY(sensor.alarmLow)}
                y2={mapY(sensor.alarmLow)}
                stroke="#F43F5E"
                strokeDasharray="3 3"
                strokeWidth={1}
                opacity={0.8}
              />
              <text x={W - padR - 4} y={mapY(sensor.alarmLow) + 10} textAnchor="end" className="fill-rose-400 font-mono text-[9px]">
                LO ALARM {sensor.alarmLow}
              </text>
            </g>
          )}

          {areaD && <path d={areaD} fill={`url(#grad-${sensor.id})`} />}
          {pathD && (
            <path d={pathD} fill="none" stroke={metricColor} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
          )}

          {activePt && (
            <g>
              <line
                x1={activePt.x}
                x2={activePt.x}
                y1={padT}
                y2={padT + innerH}
                stroke="currentColor"
                className="text-zinc-400 dark:text-zinc-600"
                strokeDasharray="2 2"
                strokeWidth={1}
              />
              <circle
                cx={activePt.x}
                cy={activePt.y}
                r={5}
                fill={activePt.status === 'alarm' ? '#F43F5E' : activePt.status === 'warning' ? '#F59E0B' : metricColor}
                stroke="#0A0A0D"
                strokeWidth={2}
              />
            </g>
          )}

          {pts.length > 2 &&
            [0, Math.floor(pts.length / 2), pts.length - 1].map((idx) => {
              const p = pts[idx];
              return (
                <text
                  key={idx}
                  x={p.x}
                  y={H - 8}
                  textAnchor={idx === 0 ? 'start' : idx === pts.length - 1 ? 'end' : 'middle'}
                  className="fill-zinc-500 font-mono text-[9.5px]"
                >
                  {formatTime(p.ts)}
                </text>
              );
            })}
        </svg>
      </div>
    </div>
  );
};

export const TelemetryDashboard: React.FC<Props> = ({ standalone = false }) => {
  const scene = useTwinStore((s) => s.scene);
  const theme = useTwinStore((s) => s.theme);
  const drillInto = useTwinStore((s) => s.drillInto);
  const showToast = useTwinStore((s) => s.showToast);
  const complianceByAssetId = useGmpStore((s) => s.complianceByAssetId);
  const createWorkOrder = useGmpStore((s) => s.createWorkOrder);
  const personnel = useGmpStore((s) => s.personnel);

  const dashboardOpen = useTelemetryStore((s) => s.dashboardOpen);
  const dashboardTab = useTelemetryStore((s) => s.dashboardTab);
  const dashboardFocusAssetId = useTelemetryStore((s) => s.dashboardFocusAssetId);
  const dashboardFocusSensorId = useTelemetryStore((s) => s.dashboardFocusSensorId);
  const dashboardFocusRoomId = useTelemetryStore((s) => s.dashboardFocusRoomId);
  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const relationships = useTelemetryStore((s) => s.relationships);
  const streamRunning = useTelemetryStore((s) => s.streamRunning);
  const activeScenario = useTelemetryStore((s) => s.activeScenario);
  const serverTime = useTelemetryStore((s) => s.serverTime);
  const showMaintenanceMilestones = useTelemetryStore((s) => s.showMaintenanceMilestones);
  const activeMilestoneAssetId = useTelemetryStore((s) => s.activeMilestoneAssetId);

  const closeDashboard = useTelemetryStore((s) => s.closeDashboard);
  const setDashboardTab = useTelemetryStore((s) => s.setDashboardTab);
  const setDashboardFocus = useTelemetryStore((s) => s.setDashboardFocus);
  const toggleStream = useTelemetryStore((s) => s.toggleStream);
  const fetchLiveSnapshot = useTelemetryStore((s) => s.fetchLiveSnapshot);
  const createSensor = useTelemetryStore((s) => s.createSensor);
  const updateSensor = useTelemetryStore((s) => s.updateSensor);
  const deleteSensor = useTelemetryStore((s) => s.deleteSensor);
  const createRelationship = useTelemetryStore((s) => s.createRelationship);
  const deleteRelationship = useTelemetryStore((s) => s.deleteRelationship);
  const triggerScenario = useTelemetryStore((s) => s.triggerScenario);
  const buildTelemetryTabUrl = useTelemetryStore((s) => s.buildTelemetryTabUrl);
  const setShowMaintenanceMilestones = useTelemetryStore((s) => s.setShowMaintenanceMilestones);
  const setActiveMilestoneAssetId = useTelemetryStore((s) => s.setActiveMilestoneAssetId);

  // Back navigation stack across all steps/tabs
  const [navHistory, setNavHistory] = useState<TelemetryDashboardTab[]>([]);
  const [showSwitcherModal, setShowSwitcherModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<'all' | 'bioreactors' | 'hplc' | 'equipment' | 'rooms' | 'alarms'>('all');
  const [predictiveSeverityFilter, setPredictiveSeverityFilter] = useState<'all' | MaintenanceSeverity>('all');
  const [selectedPredictiveAssetId, setSelectedPredictiveAssetId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Sensor Definition Form State
  const [formTargetKind, setFormTargetKind] = useState<'asset' | 'room'>('asset');
  const [formTargetId, setFormTargetId] = useState<string>('');
  const [formMetric, setFormMetric] = useState<SensorMetricType>('temperature');
  const [formTag, setFormTag] = useState('');
  const [formName, setFormName] = useState('');
  const [formUnit, setFormUnit] = useState('°C');
  const [formNominal, setFormNominal] = useState('37.0');
  const [formWarnLow, setFormWarnLow] = useState('36.2');
  const [formWarnHigh, setFormWarnHigh] = useState('37.8');
  const [formAlarmLow, setFormAlarmLow] = useState('35.5');
  const [formAlarmHigh, setFormAlarmHigh] = useState('38.5');
  const [formProtocol, setFormProtocol] = useState<SensorProtocol>('OPC UA');
  const [formPlc, setFormPlc] = useState('');
  const [formSamplingHz, setFormSamplingHz] = useState('2');
  const [formMainSensor, setFormMainSensor] = useState(true);
  const [formDesc, setFormDesc] = useState('');
  const [savingSensor, setSavingSensor] = useState(false);

  // Relationship Definition Form State
  const [relSourceId, setRelSourceId] = useState('');
  const [relTargetId, setRelTargetId] = useState('');
  const [relType, setRelType] = useState<SensorRelationshipType>('controls');
  const [relLabel, setRelLabel] = useState('');
  const [relDesc, setRelDesc] = useState('');

  const navigateToTab = (next: TelemetryDashboardTab) => {
    if (next === dashboardTab) return;
    setNavHistory((prev) => [...prev.slice(-12), dashboardTab]);
    setDashboardTab(next);
  };

  const handleBack = () => {
    if (showSwitcherModal) {
      setShowSwitcherModal(false);
      return;
    }
    if (navHistory.length > 0) {
      const prevTab = navHistory[navHistory.length - 1];
      setNavHistory((h) => h.slice(0, -1));
      setDashboardTab(prevTab);
      return;
    }
    if (dashboardTab !== 'trends') {
      setDashboardTab('trends');
      return;
    }
    if (!standalone) {
      closeDashboard();
    }
  };

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSwitcherModal) {
          setShowSwitcherModal(false);
        } else if (showMoreMenu) {
          setShowMoreMenu(false);
        }
      }
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showSwitcherModal, showMoreMenu]);

  useEffect(() => {
    if (!formTargetId) {
      const firstAsset = scene.assets.find((a) => a.archetype.includes('bioreactor')) ?? scene.assets[0];
      if (firstAsset) {
        setFormTargetKind('asset');
        setFormTargetId(firstAsset.id);
      }
    }
  }, [scene.assets, formTargetId]);

  const applyMetricPreset = (metric: SensorMetricType, targetKind = formTargetKind, targetId = formTargetId) => {
    setFormMetric(metric);
    const p = METRIC_PRESETS[metric];
    setFormUnit(p.unit);
    setFormNominal(String(p.nominal));
    setFormWarnLow(String(p.warnLow));
    setFormWarnHigh(String(p.warnHigh));
    setFormAlarmLow(String(p.alarmLow));
    setFormAlarmHigh(String(p.alarmHigh));

    const targetObj =
      targetKind === 'asset'
        ? scene.assets.find((a) => a.id === targetId)
        : scene.rooms.find((r) => r.id === targetId);
    const rawCode = targetKind === 'asset'
      ? (targetObj as { assetId?: string } | undefined)?.assetId ?? 'EQ01'
      : (targetObj as { code?: string } | undefined)?.code ?? 'RM01';
    const clean = String(rawCode).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
    const seq = String(sensors.filter((s) => s.targetId === targetId).length + 1).padStart(2, '0');
    setFormTag(`${p.isaPrefix}-${clean}-${seq}`);
    setFormName(`${targetObj?.name ?? 'Unit'} · ${p.label}`);
    setFormPlc(`SCADA.${clean}.${p.isaPrefix}_${seq}`);
  };

  // Group sensors by host target (Equipment Asset or Room)
  const targetGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        targetKind: 'asset' | 'room';
        targetId: string;
        name: string;
        code: string;
        category: string;
        floorId: string;
        sensors: SensorDefinition[];
        mainSensor: SensorDefinition;
        worstStatus: SensorStatus;
      }
    >();

    sensors.forEach((s) => {
      const key = `${s.targetKind}:${s.targetId}`;
      const existing = map.get(key);
      const st = readings[s.id]?.status ?? 'nominal';
      if (!existing) {
        map.set(key, {
          key,
          targetKind: s.targetKind,
          targetId: s.targetId,
          name: s.targetName,
          code: s.targetCode,
          category: s.targetCategory,
          floorId: s.floorId,
          sensors: [s],
          mainSensor: s,
          worstStatus: st,
        });
      } else {
        existing.sensors.push(s);
        if (s.isMainSensor) existing.mainSensor = s;
        if (st === 'alarm' || (st === 'warning' && existing.worstStatus === 'nominal')) {
          existing.worstStatus = st;
        }
      }
    });

    return Array.from(map.values());
  }, [sensors, readings]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return targetGroups.filter((g) => {
      if (categoryFilter === 'bioreactors' && !g.name.toLowerCase().includes('bioreactor')) return false;
      if (categoryFilter === 'hplc' && !g.name.toLowerCase().includes('hplc')) return false;
      if (categoryFilter === 'equipment' && g.targetKind !== 'asset') return false;
      if (categoryFilter === 'rooms' && g.targetKind !== 'room') return false;
      if (categoryFilter === 'alarms' && g.worstStatus === 'nominal') return false;

      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        g.code.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q) ||
        g.sensors.some((s) => s.tag.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      );
    });
  }, [targetGroups, categoryFilter, searchQuery]);

  // Resolve currently focused group & active sensor
  const activeGroup = useMemo(() => {
    if (dashboardFocusSensorId) {
      const s = sensors.find((x) => x.id === dashboardFocusSensorId);
      if (s) {
        const g = targetGroups.find((tg) => tg.targetId === s.targetId && tg.targetKind === s.targetKind);
        if (g) return g;
      }
    }
    if (dashboardFocusAssetId) {
      const g = targetGroups.find((tg) => tg.targetKind === 'asset' && tg.targetId === dashboardFocusAssetId);
      if (g) return g;
    }
    if (dashboardFocusRoomId) {
      const g = targetGroups.find((tg) => tg.targetKind === 'room' && tg.targetId === dashboardFocusRoomId);
      if (g) return g;
    }
    return (
      targetGroups.find((tg) => tg.name.toLowerCase().includes('bioreactor')) ??
      targetGroups[0] ??
      null
    );
  }, [targetGroups, sensors, dashboardFocusAssetId, dashboardFocusSensorId, dashboardFocusRoomId]);

  const activeSensor = useMemo(() => {
    if (dashboardFocusSensorId) {
      const found = sensors.find((s) => s.id === dashboardFocusSensorId);
      if (found) return found;
    }
    return activeGroup?.mainSensor ?? sensors[0] ?? null;
  }, [activeGroup, sensors, dashboardFocusSensorId]);

  const focusedAsset = useMemo(
    () => (activeGroup?.targetKind === 'asset' ? scene.assets.find((a) => a.id === activeGroup.targetId) ?? null : null),
    [activeGroup, scene.assets]
  );

  const focusedRoom = useMemo(
    () => (activeGroup?.targetKind === 'room' ? scene.rooms.find((r) => r.id === activeGroup.targetId) ?? null : null),
    [activeGroup, scene.rooms]
  );

  const focusedFloor = useMemo(
    () => (activeGroup ? scene.floors.find((f) => f.id === activeGroup.floorId) ?? null : null),
    [activeGroup, scene.floors]
  );

  // Predictive Asset Failure & Maintenance Milestones computed from live sensor history
  const maintenanceMilestones = useMemo(
    () => computeAssetFailurePredictions(sensors, readings, scene.assets, complianceByAssetId),
    [sensors, readings, scene.assets, complianceByAssetId]
  );

  const filteredMilestones = useMemo(() => {
    if (predictiveSeverityFilter === 'all') return maintenanceMilestones;
    return maintenanceMilestones.filter((m) => m.severity === predictiveSeverityFilter);
  }, [maintenanceMilestones, predictiveSeverityFilter]);

  const focusedAssetMilestone = useMemo(() => {
    if (!focusedAsset) return null;
    return maintenanceMilestones.find((m) => m.assetId === focusedAsset.id) ?? null;
  }, [focusedAsset, maintenanceMilestones]);

  const selectedMilestone = useMemo(() => {
    const targetId = selectedPredictiveAssetId ?? activeMilestoneAssetId ?? dashboardFocusAssetId;
    if (targetId) {
      const hit = maintenanceMilestones.find((m) => m.assetId === targetId);
      if (hit) return hit;
    }
    return filteredMilestones[0] ?? maintenanceMilestones[0] ?? null;
  }, [
    selectedPredictiveAssetId,
    activeMilestoneAssetId,
    dashboardFocusAssetId,
    filteredMilestones,
    maintenanceMilestones,
  ]);

  const selectedMilestoneSensor = useMemo(
    () => (selectedMilestone ? sensors.find((s) => s.id === selectedMilestone.driverSensorId) ?? null : null),
    [selectedMilestone, sensors]
  );

  const predictiveSummary = useMemo(() => {
    const total = maintenanceMilestones.length;
    const critical = maintenanceMilestones.filter((m) => m.severity === 'critical').length;
    const warning = maintenanceMilestones.filter((m) => m.severity === 'warning').length;
    const meanHealth =
      total > 0
        ? Math.round(maintenanceMilestones.reduce((acc, m) => acc + m.healthScore, 0) / total)
        : 100;
    return { total, critical, warning, meanHealth };
  }, [maintenanceMilestones]);

  const handleJumpToTimelineMilestone = (milestone: MaintenanceMilestone) => {
    const twin = useTwinStore.getState();
    setShowMaintenanceMilestones(true);
    setActiveMilestoneAssetId(milestone.assetId);
    twin.setScreen('workspace');
    twin.setBottomTimelineOpen(true);
    twin.setTimelineDate(milestone.predictedFailureDate);
    twin.setActiveFloor(milestone.floorId);
    twin.selectEntity({ type: 'asset', id: milestone.assetId });
    if (!standalone) {
      closeDashboard();
      window.setTimeout(() => {
        useTwinStore.getState().drillInto('asset', milestone.assetId);
      }, 60);
    }
    showToast(
      `Timeline set to Maintenance Milestone: ${milestone.assetCode} (${milestone.predictedFailureDate})`,
      'info'
    );
  };

  const handleSchedulePredictivePm = (milestone: MaintenanceMilestone) => {
    const tech = personnel[0];
    const wo = createWorkOrder({
      title: `Predictive PM — ${milestone.assetCode} (${milestone.driverMetricLabel})`,
      description: `Auto-scheduled from Telemetry Sensor History forecast.\nPredicted failure: ${milestone.predictedFailureDate} (${milestone.daysUntilFailure}d, ${milestone.confidencePct}% confidence).\nDriver: ${milestone.driverSensorTag} (${milestone.currentValue} ${milestone.unit} → Alarm ${milestone.alarmThreshold} ${milestone.unit}).\nAction: ${milestone.recommendedAction}`,
      serviceType: 'maintenance',
      targetKind: 'asset',
      targetId: milestone.assetId,
      targetName: `${milestone.assetCode} · ${milestone.assetName}`,
      targetCategory: milestone.category,
      assigneeId: tech?.id ?? 'tech-01',
      assigneeName: tech?.name ?? 'Reliability Engineer',
      priority: milestone.severity === 'critical' ? 'critical' : milestone.severity === 'warning' ? 'high' : 'medium',
      status: 'open',
      lastServiceDate: new Date().toISOString().slice(0, 10),
      dueDate: milestone.recommendedServiceDate,
      estimatedHours: 3,
      checklist: [
        { id: `pm-1-${Date.now()}`, text: milestone.recommendedAction, done: false },
        { id: `pm-2-${Date.now()}`, text: `Verify ${milestone.driverSensorTag} returns within nominal band`, done: false },
      ],
    });
    showToast(`Scheduled Predictive PM ${wo.woNumber} for ${milestone.assetCode} (due ${milestone.recommendedServiceDate})`, 'success');
  };

  // Global Telemetry KPIs
  const kpis = useMemo(() => {
    const roomTemp = sensors.filter((s) => s.targetKind === 'room' && s.metric === 'temperature');
    const roomRh = sensors.filter((s) => s.targetKind === 'room' && s.metric === 'humidity');
    const roomDp = sensors.filter((s) => s.targetKind === 'room' && s.metric === 'pressure');

    const avg = (list: SensorDefinition[]) => {
      if (!list.length) return 0;
      const sum = list.reduce((acc, s) => acc + (readings[s.id]?.value ?? s.nominal), 0);
      return sum / list.length;
    };

    let alarmCount = 0;
    let warnCount = 0;
    sensors.forEach((s) => {
      const st = readings[s.id]?.status ?? 'nominal';
      if (st === 'alarm') alarmCount++;
      else if (st === 'warning') warnCount++;
    });

    return {
      avgTemp: avg(roomTemp),
      avgRh: avg(roomRh),
      avgDp: avg(roomDp),
      alarmCount,
      warnCount,
      totalSensors: sensors.length,
      totalRelationships: relationships.length,
    };
  }, [sensors, readings, relationships]);

  const activeGroupRelationships = useMemo(() => {
    if (!activeGroup) return relationships;
    const ids = new Set(activeGroup.sensors.map((s) => s.id));
    return relationships.filter((r) => ids.has(r.sourceSensorId) || ids.has(r.targetSensorId));
  }, [activeGroup, relationships]);

  if (!standalone && !dashboardOpen) return null;

  const handleSaveNewSensor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTag.trim() || !formName.trim() || !formTargetId) return;
    setSavingSensor(true);
    try {
      const targetAsset = formTargetKind === 'asset' ? scene.assets.find((a) => a.id === formTargetId) : null;
      const targetRoom = formTargetKind === 'room' ? scene.rooms.find((r) => r.id === formTargetId) : null;
      const floorId = targetAsset?.floorId ?? targetRoom?.floorId ?? scene.floors[0]?.id ?? 'fl-a1';
      const fl = scene.floors.find((f) => f.id === floorId);
      const x = targetAsset ? targetAsset.x : targetRoom ? targetRoom.x + targetRoom.width / 2 : 6;
      const z = targetAsset ? targetAsset.z : targetRoom ? targetRoom.z + targetRoom.depth / 2 : 6;
      const y = targetAsset ? targetAsset.y + targetAsset.height + 0.35 : 2.2;
      const preset = METRIC_PRESETS[formMetric];

      const created = await createSensor({
        id: `sens-custom-${Date.now()}`,
        tag: formTag.trim().toUpperCase(),
        name: formName.trim(),
        metric: formMetric,
        unit: formUnit.trim() || preset.unit,
        targetKind: formTargetKind,
        targetId: formTargetId,
        targetName: targetAsset?.name ?? targetRoom?.name ?? 'Space',
        targetCode: targetAsset?.assetId ?? targetRoom?.code ?? 'UNIT',
        targetCategory: targetAsset?.category ?? targetRoom?.category ?? 'Facility',
        floorId,
        buildingId: fl?.buildingId ?? 'bldg-a',
        x,
        y,
        z,
        nominal: Number(formNominal) || preset.nominal,
        minRange: preset.minRange,
        maxRange: preset.maxRange,
        warnLow: Number(formWarnLow),
        warnHigh: Number(formWarnHigh),
        alarmLow: Number(formAlarmLow),
        alarmHigh: Number(formAlarmHigh),
        precision: preset.precision,
        isMainSensor: formMainSensor,
        protocol: formProtocol,
        plcAddress: formPlc.trim() || `SCADA.${formTag.trim().toUpperCase()}`,
        samplingHz: Number(formSamplingHz) || 1,
        calibrationDue: '2027-06-30',
        description: formDesc.trim() || `User-defined ${preset.label} sensor tag`,
        isCustom: true,
      });

      setDashboardFocus({
        assetId: created.targetKind === 'asset' ? created.targetId : null,
        roomId: created.targetKind === 'room' ? created.targetId : null,
        sensorId: created.id,
      });
      navigateToTab('trends');
      showToast(`Defined live sensor tag ${created.tag} and linked to ${created.targetName}`, 'success');
    } finally {
      setSavingSensor(false);
    }
  };

  const handleSaveRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relSourceId || !relTargetId || relSourceId === relTargetId) return;
    await createRelationship({
      id: `rel-custom-${Date.now()}`,
      sourceSensorId: relSourceId,
      targetSensorId: relTargetId,
      type: relType,
      label: relLabel.trim() || RELATIONSHIP_META[relType].label,
      description: relDesc.trim() || 'User-defined control / telemetry dependency.',
      active: true,
    });
    setRelLabel('');
    setRelDesc('');
    showToast('Sensor relationship saved to telemetry database', 'success');
  };

  const newTabHref = buildTelemetryTabUrl({
    tab: dashboardTab,
    assetId: activeGroup?.targetKind === 'asset' ? activeGroup.targetId : undefined,
    roomId: activeGroup?.targetKind === 'room' ? activeGroup.targetId : undefined,
    sensorId: activeSensor?.id,
  });

  const backLabel =
    navHistory.length > 0
      ? navHistory[navHistory.length - 1] === 'trends'
        ? 'Back to Trends'
        : navHistory[navHistory.length - 1] === 'equipment'
          ? 'Back to Matrix'
          : navHistory[navHistory.length - 1] === 'define'
            ? 'Back to Tag Studio'
            : 'Back'
      : dashboardTab !== 'trends'
        ? 'Back to Trends'
        : 'Back to 3D';

  const containerCls = standalone
    ? 'h-[100dvh] w-screen flex flex-col bg-zinc-50 dark:bg-[#0A0A0D] text-zinc-900 dark:text-zinc-100 overflow-hidden'
    : 'fixed inset-0 h-[100dvh] z-50 flex flex-col bg-zinc-50 dark:bg-[#0A0A0D] text-zinc-900 dark:text-zinc-100 overflow-hidden';

  return (
    <div className={containerCls}>
      {/* Solid, Opaque, Fully Responsive 3-Zone Header */}
      <header className="h-16 px-4 lg:px-5 border-b border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] flex items-center justify-between gap-3 shrink-0 z-30">
        {/* Left Zone: Back Button + Brand + Live Status */}
        <div className="flex items-center gap-2.5 min-w-0">
          {!standalone || navHistory.length > 0 || dashboardTab !== 'trends' ? (
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#1A1A22] hover:border-violet-500/50 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors shrink-0"
              title={backLabel}
            >
              <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
              <span className="hidden sm:inline">{backLabel}</span>
            </button>
          ) : (
            <a
              href={window.location.origin + window.location.pathname}
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#1A1A22] hover:border-violet-500/50 text-xs font-medium text-zinc-700 dark:text-zinc-200 shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
              <span className="hidden sm:inline">3D Studio</span>
            </a>
          )}

          <div className="w-9 h-9 rounded-xl gradian-violet-amber text-white flex items-center justify-center shrink-0 shadow-sm">
            <Activity className="w-4 h-4" />
          </div>

          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white truncate">
              Telemetry Console
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums truncate">
              <span className={streamRunning ? 'text-emerald-500' : 'text-amber-500'}>
                {streamRunning ? '● Live' : '❚❚ Paused'}
              </span>
              <span>·</span>
              <span className="truncate">{formatTime(serverTime)}</span>
            </div>
          </div>
        </div>

        {/* Center Zone: Clean Rounded Tab Switcher */}
        <nav className="hidden lg:flex items-center gap-1 p-1 rounded-2xl bg-zinc-100 dark:bg-[#0D0D11] border border-zinc-200 dark:border-zinc-800/80 shrink-0">
          {(
            [
              { id: 'trends', label: 'Live Trends', icon: <Activity className="w-3.5 h-3.5" /> },
              { id: 'predictive', label: 'Predictive Failure', icon: <TrendingDown className="w-3.5 h-3.5" /> },
              { id: 'equipment', label: 'Equipment Matrix', icon: <Cpu className="w-3.5 h-3.5" /> },
              { id: 'define', label: 'Add Sensor Tag', icon: <Plus className="w-3.5 h-3.5" /> },
              { id: 'relationships', label: 'Control Loops', icon: <GitBranch className="w-3.5 h-3.5" /> },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => navigateToTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
                dashboardTab === t.id
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {t.icon}
              {t.label}
              {t.id === 'predictive' && predictiveSummary.critical > 0 && (
                <span className="ml-0.5 font-mono text-[10px] font-bold text-rose-400">
                  ({predictiveSummary.critical})
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Right Zone: Stream Toggle, New Tab, Ellipsis Overflow, Close */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={toggleStream}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#1A1A22] hover:border-violet-500/50 text-xs font-medium whitespace-nowrap transition-colors"
            title={streamRunning ? 'Pause live telemetry stream' : 'Resume live stream'}
          >
            {streamRunning ? <Pause className="w-3.5 h-3.5 text-amber-500" /> : <Play className="w-3.5 h-3.5 text-emerald-500" />}
            <span className="hidden sm:inline">{streamRunning ? 'Pause' : 'Resume'}</span>
          </button>

          {!standalone ? (
            <a
              href={newTabHref}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium whitespace-nowrap transition-colors"
              title="Open this detailed sensor dashboard in a dedicated browser tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>New Tab</span>
            </a>
          ) : (
            <a
              href={window.location.origin + window.location.pathname}
              className="hidden sm:flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium whitespace-nowrap transition-colors"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>3D Studio</span>
            </a>
          )}

          {/* Ellipsis Menu for Scenario Simulator & Refresh */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setShowMoreMenu((v) => !v)}
              className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-colors ${
                showMoreMenu || activeScenario
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-500'
                  : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#1A1A22] text-zinc-600 dark:text-zinc-300 hover:border-violet-500/50'
              }`}
              title="Simulation Scenarios & Telemetry Options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] shadow-2xl p-3 space-y-3 z-50">
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500" />
                    Fault &amp; Excursion Simulator
                  </div>
                  <select
                    aria-label="Simulate Telemetry Scenario"
                    value={activeScenario ?? ''}
                    onChange={(e) => {
                      triggerScenario(e.target.value || null);
                      setShowMoreMenu(false);
                    }}
                    className="w-full h-9 px-2.5 text-xs rounded-xl bg-zinc-50 dark:bg-[#111116] border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200"
                  >
                    <option value="">Nominal GMP Operation</option>
                    <option value="bioreactor-thermal-excursion">Test: Bioreactor Thermal Excursion</option>
                    <option value="hplc-overpressure">Test: HPLC Pump Overpressure</option>
                    <option value="cleanroom-pressure-drop">Test: Cleanroom ΔP Cascade Drop</option>
                    <option value="humidity-spike">Test: HVAC Humidity Spike</option>
                  </select>
                </div>

                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-1.5">
                  <button
                    onClick={() => {
                      fetchLiveSnapshot(scene);
                      setShowMoreMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-[#22222C] text-xs font-medium text-zinc-700 dark:text-zinc-200"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-violet-500" />
                    Force Refresh from Telemetry DB
                  </button>
                  <button
                    onClick={() => {
                      setShowMoreMenu(false);
                      setShowSwitcherModal(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-[#22222C] text-xs font-medium text-zinc-700 dark:text-zinc-200"
                  >
                    <Box className="w-3.5 h-3.5 text-amber-500" />
                    Switch Monitored Equipment ({targetGroups.length})
                  </button>
                  {!standalone && (
                    <a
                      href={newTabHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sm:hidden w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-medium"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open Dedicated Tab
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {!standalone && (
            <button
              onClick={closeDashboard}
              className="h-9 w-9 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#1A1A22] text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:border-rose-500/50 flex items-center justify-center transition-colors"
              title="Close Telemetry Console"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Responsive Narrow-Screen Tab Bar */}
      <div className="flex lg:hidden items-center gap-1.5 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] overflow-x-auto shrink-0">
        {(
          [
            { id: 'trends', label: 'Live Trends' },
            { id: 'predictive', label: 'Predictive Failure' },
            { id: 'equipment', label: 'Equipment Matrix' },
            { id: 'define', label: 'Add Sensor Tag' },
            { id: 'relationships', label: 'Control Loops' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => navigateToTab(t.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
              dashboardTab === t.id
                ? 'bg-violet-600 text-white'
                : 'bg-zinc-100 dark:bg-[#1A1A22] text-zinc-600 dark:text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Compact Facility Environmental KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-zinc-200 dark:divide-zinc-800/80 border-b border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] shrink-0">
        <div className="px-4 py-2.5">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Mean Facility Temp</div>
          <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
            <span className="text-lg font-semibold text-zinc-900 dark:text-white">{kpis.avgTemp.toFixed(1)}</span>
            <span className="text-xs text-zinc-400">°C</span>
          </div>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Mean Humidity</div>
          <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
            <span className="text-lg font-semibold text-zinc-900 dark:text-white">{kpis.avgRh.toFixed(1)}</span>
            <span className="text-xs text-zinc-400">%RH</span>
          </div>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Mean Cleanroom ΔP</div>
          <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
            <span className="text-lg font-semibold text-zinc-900 dark:text-white">+{kpis.avgDp.toFixed(1)}</span>
            <span className="text-xs text-zinc-400">Pa</span>
          </div>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Active Sensor Tags</div>
          <div className="mt-0.5 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-semibold text-zinc-900 dark:text-white">{kpis.totalSensors}</span>
            <span className="text-[11px] text-violet-500">{kpis.totalRelationships} loops</span>
          </div>
        </div>
        <div className="px-4 py-2.5 col-span-2 md:col-span-1">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">System Health</div>
          <div className="mt-0.5 flex items-baseline gap-3 font-mono tabular-nums text-sm font-semibold">
            {kpis.alarmCount > 0 ? (
              <span className="text-rose-500">✖ {kpis.alarmCount} Alarm</span>
            ) : (
              <span className="text-emerald-500">● 0 Alarms</span>
            )}
            {kpis.warnCount > 0 && <span className="text-amber-500">▲ {kpis.warnCount} Drift</span>}
          </div>
        </div>
      </div>

      {/* Main Scrollable Content Area */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* TAB 1: FOCUSED 3D OBJECT INSPECTOR + LIVE TRENDS (NO CLUTTERED 200-ITEM SIDEBAR) */}
        {dashboardTab === 'trends' && (
          <main className="flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 lg:p-6">
            {activeGroup && activeSensor ? (
              <div className="max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Left 4 Columns: Focused 3D Model Viewer for THIS Single Equipment / Room */}
                <section className="lg:col-span-4 space-y-4">
                  <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] p-4 space-y-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[11px] font-mono text-violet-600 dark:text-violet-400">
                          <span>{activeGroup.code}</span>
                          <span className="text-zinc-400">·</span>
                          <span className="truncate text-zinc-500 dark:text-zinc-400">{activeGroup.category}</span>
                        </div>
                        <h2 className="mt-0.5 text-lg font-bold tracking-tight text-zinc-900 dark:text-white leading-snug">
                          {activeGroup.name}
                        </h2>
                        {focusedFloor && (
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                            {focusedFloor.code} · {focusedFloor.name}
                          </div>
                        )}
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-xl border text-[11px] font-mono font-semibold shrink-0 ${
                          statusText(activeGroup.worstStatus).badgeCls
                        }`}
                      >
                        {statusText(activeGroup.worstStatus).glyph} {statusText(activeGroup.worstStatus).label}
                      </span>
                    </div>

                    {/* Interactive Isolated 3D Turntable Viewer for THIS Specific Object */}
                    <div className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
                      <AssetMini3DViewer
                        asset={focusedAsset}
                        room={focusedRoom}
                        statusAccent={activeGroup.worstStatus}
                        height={250}
                      />
                    </div>

                    {/* Quick Object Actions */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setShowSwitcherModal(true)}
                        className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl bg-zinc-100 dark:bg-[#1B1B24] hover:bg-violet-600 hover:text-white text-zinc-800 dark:text-zinc-200 text-xs font-medium transition-colors"
                      >
                        <Search className="w-3.5 h-3.5" />
                        Switch Object
                      </button>
                      {!standalone ? (
                        <button
                          onClick={() => {
                            const twin = useTwinStore.getState();
                            twin.setScreen('workspace');
                            if (twin.viewMode === '2d') {
                              twin.setViewMode('3d-perspective');
                            }
                            twin.setFirstPersonMode(false);
                            twin.setRightPanelOpen(true);
                            twin.setRightTab('properties');
                            closeDashboard();
                            window.setTimeout(() => {
                              useTwinStore
                                .getState()
                                .drillInto(
                                  activeGroup.targetKind === 'asset' ? 'asset' : 'room',
                                  activeGroup.targetId
                                );
                            }, 60);
                          }}
                          className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 hover:bg-violet-500/10 text-xs font-medium transition-colors"
                        >
                          <Box className="w-3.5 h-3.5 text-violet-500" />
                          Locate in 3D
                        </button>
                      ) : (
                        <a
                          href={`${window.location.origin}${window.location.pathname}?view=3d-perspective&${activeGroup.targetKind === 'asset' ? 'asset' : 'room'}=${encodeURIComponent(activeGroup.targetId)}`}
                          className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium transition-colors"
                        >
                          <Box className="w-3.5 h-3.5 text-violet-500" />
                          Open in 3D
                        </a>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        setFormTargetKind(activeGroup.targetKind);
                        setFormTargetId(activeGroup.targetId);
                        applyMetricPreset('temperature', activeGroup.targetKind, activeGroup.targetId);
                        navigateToTab('define');
                      }}
                      className="w-full flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Sensor Tag to {activeGroup.code}
                    </button>

                    {/* Compact Spec Strip */}
                    {focusedAsset && (
                      <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800/80 grid grid-cols-2 gap-2.5 text-[11px]">
                        <div>
                          <span className="text-zinc-500 block">Manufacturer</span>
                          <span className="font-medium text-zinc-900 dark:text-zinc-200">{focusedAsset.manufacturer || 'GMP OEM'}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block">Model</span>
                          <span className="font-mono text-zinc-900 dark:text-zinc-200">{focusedAsset.model || focusedAsset.archetype}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block">Dimensions</span>
                          <span className="font-mono text-zinc-900 dark:text-zinc-200">
                            {focusedAsset.width.toFixed(1)}×{focusedAsset.depth.toFixed(1)}×{focusedAsset.height.toFixed(1)}m
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block">Channels</span>
                          <span className="font-mono text-amber-500 font-semibold">{activeGroup.sensors.length} live tags</span>
                        </div>
                      </div>
                    )}
                    {focusedRoom && (
                      <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800/80 grid grid-cols-2 gap-2.5 text-[11px]">
                        <div>
                          <span className="text-zinc-500 block">Cleanroom Grade</span>
                          <span className="font-semibold text-violet-500">{focusedRoom.environmental.cleanroomGrade}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block">Floor Area</span>
                          <span className="font-mono text-zinc-900 dark:text-zinc-200">
                            {(focusedRoom.width * focusedRoom.depth).toFixed(1)} m²
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* Right 8 Columns: Channels, Live SVG Trend Chart, Linked Loops */}
                <section className="lg:col-span-8 space-y-5 min-w-0">
                  {/* All Live Channels for This Equipment/Space */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {activeGroup.sensors.map((s) => {
                      const snap = readings[s.id];
                      const val = snap?.value ?? s.nominal;
                      const st = statusText(snap?.status ?? 'nominal');
                      const isActive = activeSensor.id === s.id;
                      const color = METRIC_PRESETS[s.metric]?.color ?? '#8B5CF6';

                      return (
                        <div
                          key={s.id}
                          onClick={() => setDashboardFocus({ sensorId: s.id })}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === 'Enter' && setDashboardFocus({ sensorId: s.id })}
                          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                            isActive
                              ? 'bg-white dark:bg-[#17171F] border-violet-500 ring-1 ring-violet-500/30 shadow-sm'
                              : 'bg-white dark:bg-[#121216] border-zinc-200 dark:border-zinc-800/80 hover:border-violet-500/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="font-mono text-zinc-500 dark:text-zinc-400 truncate">{s.tag}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  activeGroup.sensors.forEach((other) => {
                                    if (other.id !== s.id && other.isMainSensor) {
                                      updateSensor(other.id, { isMainSensor: false });
                                    }
                                  });
                                  updateSensor(s.id, { isMainSensor: !s.isMainSensor });
                                }}
                                title={s.isMainSensor ? 'Primary 3D indicator sensor' : 'Set as primary 3D sensor'}
                                className={s.isMainSensor ? 'text-amber-400' : 'text-zinc-400 hover:text-amber-400'}
                              >
                                <Star className="w-3.5 h-3.5" fill={s.isMainSensor ? 'currentColor' : 'none'} />
                              </button>
                              <span className={`font-mono ${st.cls}`}>{st.glyph}</span>
                            </div>
                          </div>

                          <div className="mt-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                            {s.name.split('·').pop()?.trim() || s.name}
                          </div>

                          <div className="mt-2.5 flex items-end justify-between gap-2">
                            <div>
                              <div className="flex items-baseline gap-1 font-mono tabular-nums">
                                <span className="text-2xl font-bold text-zinc-900 dark:text-white">
                                  {val.toFixed(s.precision)}
                                </span>
                                <span className="text-xs text-zinc-400">{s.unit}</span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1 text-[10.5px] font-mono tabular-nums text-zinc-500">
                                {snap?.trend === 'rising' ? (
                                  <ArrowUpRight className="w-3 h-3 text-amber-500" />
                                ) : snap?.trend === 'falling' ? (
                                  <ArrowDownRight className="w-3 h-3 text-violet-400" />
                                ) : (
                                  <Minus className="w-3 h-3 text-zinc-400" />
                                )}
                                <span>
                                  {snap && snap.delta >= 0 ? '+' : ''}
                                  {(snap?.delta ?? 0).toFixed(s.precision)}
                                </span>
                                <span>·</span>
                                <span>SP {s.nominal}</span>
                              </div>
                            </div>
                            <MiniSparkline points={snap?.history ?? []} color={color} width={78} height={26} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Primary Live Time-Series Chart */}
                  <div className="p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] shadow-sm">
                    <LiveTrendChart sensor={activeSensor} snapshot={readings[activeSensor.id]} />

                    <div className="mt-4 pt-3.5 border-t border-zinc-200 dark:border-zinc-800/80 grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs font-mono tabular-nums">
                      <div>
                        <div className="text-[10.5px] font-sans text-zinc-500">Observed Min</div>
                        <div className="mt-0.5 font-semibold">
                          {(readings[activeSensor.id]?.minObserved ?? activeSensor.nominal).toFixed(activeSensor.precision)} {activeSensor.unit}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10.5px] font-sans text-zinc-500">Observed Mean</div>
                        <div className="mt-0.5 font-semibold">
                          {(readings[activeSensor.id]?.avgObserved ?? activeSensor.nominal).toFixed(activeSensor.precision)} {activeSensor.unit}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10.5px] font-sans text-zinc-500">Observed Max</div>
                        <div className="mt-0.5 font-semibold">
                          {(readings[activeSensor.id]?.maxObserved ?? activeSensor.nominal).toFixed(activeSensor.precision)} {activeSensor.unit}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10.5px] font-sans text-zinc-500">Warning Band</div>
                        <div className="mt-0.5 text-amber-500">
                          {activeSensor.warnLow} – {activeSensor.warnHigh}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10.5px] font-sans text-zinc-500">Alarm Limits</div>
                        <div className="mt-0.5 text-rose-500">
                          {activeSensor.alarmLow} – {activeSensor.alarmHigh}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10.5px] font-sans text-zinc-500">Calibration Due</div>
                        <div className="mt-0.5">{activeSensor.calibrationDue}</div>
                      </div>
                    </div>

                    {/* Inline Predictive Failure Forecast Strip for Focused Asset */}
                    {focusedAssetMilestone && (() => {
                      const sev = severityMeta(focusedAssetMilestone.severity);
                      return (
                        <div className="mt-4 pt-3.5 border-t border-zinc-200 dark:border-zinc-800/80 flex flex-wrap items-center justify-between gap-3">
                          <div className="space-y-0.5 min-w-0">
                            <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-2">
                              <span className={`font-semibold ${sev.textCls}`}>
                                {sev.glyph} Predicted Failure: {focusedAssetMilestone.predictedFailureDate}
                              </span>
                              <span>·</span>
                              <span className="tabular-nums">{focusedAssetMilestone.daysUntilFailure}d remaining</span>
                              <span>·</span>
                              <span className="tabular-nums">{focusedAssetMilestone.confidencePct}% confidence</span>
                            </div>
                            <div className="text-xs text-zinc-600 dark:text-zinc-300">
                              Driver {focusedAssetMilestone.driverSensorTag} · Recommended PM by{' '}
                              <span className="font-mono font-semibold">{focusedAssetMilestone.recommendedServiceDate}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPredictiveAssetId(focusedAssetMilestone.assetId);
                                navigateToTab('predictive');
                              }}
                              className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 cursor-pointer"
                            >
                              Forecast Curve
                            </button>
                            {!standalone && (
                              <button
                                type="button"
                                onClick={() => handleJumpToTimelineMilestone(focusedAssetMilestone)}
                                className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                              >
                                <CalendarClock className="w-3.5 h-3.5" />
                                Show on Timeline
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Connected Sensor Relationships for This Asset */}
                  <div className="p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] space-y-3 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                          Linked Control Loops &amp; Sensor Relationships
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Active upstream/downstream dependencies, safety interlocks, and pressure cascades
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setRelSourceId(activeSensor.id);
                          navigateToTab('relationships');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-600 hover:text-white text-xs font-medium transition-colors"
                      >
                        Manage Loops →
                      </button>
                    </div>

                    {activeGroupRelationships.length === 0 ? (
                      <div className="text-xs text-zinc-500 py-3">
                        No relationships defined for this asset yet. Click &ldquo;Manage Loops&rdquo; to wire control loops or interlocks.
                      </div>
                    ) : (
                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                        {activeGroupRelationships.map((rel) => {
                          const src = sensors.find((s) => s.id === rel.sourceSensorId);
                          const tgt = sensors.find((s) => s.id === rel.targetSensorId);
                          if (!src || !tgt) return null;
                          const meta = RELATIONSHIP_META[rel.type];
                          return (
                            <div key={rel.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2 font-mono">
                                <button
                                  onClick={() =>
                                    setDashboardFocus({
                                      assetId: src.targetKind === 'asset' ? src.targetId : null,
                                      roomId: src.targetKind === 'room' ? src.targetId : null,
                                      sensorId: src.id,
                                    })
                                  }
                                  className="px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-[#1B1B24] font-semibold text-zinc-900 dark:text-zinc-100 hover:text-violet-400"
                                >
                                  {src.tag}
                                </button>
                                <span style={{ color: meta.color }} className="font-sans font-medium">
                                  — {rel.label} →
                                </span>
                                <button
                                  onClick={() =>
                                    setDashboardFocus({
                                      assetId: tgt.targetKind === 'asset' ? tgt.targetId : null,
                                      roomId: tgt.targetKind === 'room' ? tgt.targetId : null,
                                      sensorId: tgt.id,
                                    })
                                  }
                                  className="px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-[#1B1B24] font-semibold text-zinc-900 dark:text-zinc-100 hover:text-violet-400"
                                >
                                  {tgt.tag}
                                </button>
                              </div>
                              <span className="text-zinc-500 dark:text-zinc-400 text-[11px]">{rel.description}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : (
              <div className="p-12 text-center text-sm text-zinc-500">
                Loading live sensor channels from telemetry database...
              </div>
            )}
          </main>
        )}

        {/* TAB 2: EQUIPMENT & MAIN SENSORS MATRIX (VIRTUALIZED WINDOWED GRID) */}
        {dashboardTab === 'equipment' && (
          <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="shrink-0 px-4 lg:px-6 pt-4 pb-3 border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-[#0D0D12]">
              <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={handleBack}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
                    Back
                  </button>
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white truncate">
                      Monitored Bioreactors, HPLCs, Process Skids &amp; Cleanrooms
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {filteredGroups.length} units · Windowed virtual grid for smooth live telemetry scrolling
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search equipment or tag..."
                    className="h-9 px-3 rounded-xl bg-white dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800 text-xs w-48 sm:w-56 focus:outline-none focus:border-violet-500"
                  />
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-200/70 dark:bg-[#14141A] overflow-x-auto max-w-full">
                    {(
                      [
                        { id: 'all', label: 'All' },
                        { id: 'bioreactors', label: 'Bioreactors' },
                        { id: 'hplc', label: 'HPLC' },
                        { id: 'equipment', label: 'Equipment' },
                        { id: 'rooms', label: 'Rooms' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setCategoryFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          categoryFilter === f.id
                            ? 'bg-violet-600 text-white'
                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <VirtualGrid
              items={filteredGroups}
              rowHeight={276}
              minColumnWidth={310}
              maxColumns={3}
              gap={16}
              overscanRows={2}
              resetScrollKey={`${categoryFilter}-${searchQuery}`}
              className="flex-1 min-h-0"
              paddingClassName="max-w-[1440px] mx-auto p-4 lg:p-6"
              getKey={(g) => g.key}
              emptyState={
                <div className="p-12 text-center text-xs text-zinc-500">
                  No monitored equipment or rooms match this filter.
                </div>
              }
              renderItem={(g) => {
                const mainSnap = readings[g.mainSensor.id];
                const st = statusText(g.worstStatus);
                const mainColor = METRIC_PRESETS[g.mainSensor.metric]?.color ?? '#8B5CF6';
                const cardTabUrl = buildTelemetryTabUrl({
                  tab: 'trends',
                  assetId: g.targetKind === 'asset' ? g.targetId : undefined,
                  roomId: g.targetKind === 'room' ? g.targetId : undefined,
                  sensorId: g.mainSensor.id,
                });

                return (
                  <div className="h-full p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] hover:border-violet-500/50 transition-colors flex flex-col justify-between gap-2.5 overflow-hidden">
                    <div className="min-h-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-mono text-violet-500 truncate">
                            {g.code} · <span className="text-zinc-500">{g.category}</span>
                          </div>
                          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white truncate mt-0.5">
                            {g.name}
                          </h3>
                        </div>
                        <span className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono font-medium shrink-0 ${st.badgeCls}`}>
                          {st.glyph} {st.label}
                        </span>
                      </div>

                      <div className="mt-2.5 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                            Main · <span className="font-mono">{g.mainSensor.tag}</span>
                          </div>
                          <div className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
                            <span className="text-2xl font-bold text-zinc-900 dark:text-white">
                              {(mainSnap?.value ?? g.mainSensor.nominal).toFixed(g.mainSensor.precision)}
                            </span>
                            <span className="text-xs text-zinc-400">{g.mainSensor.unit}</span>
                          </div>
                        </div>
                        <MiniSparkline points={mainSnap?.history ?? []} color={mainColor} width={92} height={28} />
                      </div>

                      {g.sensors.length > 1 && (
                        <div className="mt-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80 space-y-1">
                          {g.sensors
                            .filter((s) => s.id !== g.mainSensor.id)
                            .slice(0, 3)
                            .map((s) => {
                              const snap = readings[s.id];
                              const sSt = statusText(snap?.status ?? 'nominal');
                              return (
                                <div key={s.id} className="flex items-center justify-between text-xs">
                                  <span className="text-zinc-500 dark:text-zinc-400 truncate pr-2">
                                    {s.name.split('·').pop()?.trim() || s.name}
                                  </span>
                                  <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200 shrink-0">
                                    {(snap?.value ?? s.nominal).toFixed(s.precision)} {s.unit}{' '}
                                    <span className={sSt.cls}>{sSt.glyph}</span>
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setDashboardFocus({
                            assetId: g.targetKind === 'asset' ? g.targetId : null,
                            roomId: g.targetKind === 'room' ? g.targetId : null,
                            sensorId: g.mainSensor.id,
                          });
                          navigateToTab('trends');
                        }}
                        className="text-xs font-semibold text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
                      >
                        Inspect 3D &amp; Trends
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                      <a
                        href={cardTabUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                      >
                        <ExternalLink className="w-3 h-3" />
                        New Tab
                      </a>
                    </div>
                  </div>
                );
              }}
            />
          </main>
        )}

        {/* TAB 3: SENSOR TAG STUDIO (WITH EXPLICIT BACK BUTTON) */}
        {dashboardTab === 'define' && (
          <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 lg:p-6">
            <div className="max-w-6xl mx-auto space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={handleBack}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-semibold text-zinc-800 dark:text-zinc-100 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
                  {backLabel}
                </button>
                <span className="text-xs font-mono text-zinc-500">ISA-5.1 Live Sensor Tag Studio</span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleSaveNewSensor}
                  className="lg:col-span-7 p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] space-y-4"
                >
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                      Define New Sensor Tag
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Bind a real-time telemetry tag to any Bioreactor, HPLC, equipment unit, or cleanroom with ISA-5.1 naming and alarm limits.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="space-y-1 text-xs">
                      <span className="text-zinc-500">Host Type</span>
                      <select
                        value={formTargetKind}
                        onChange={(e) => {
                          const kind = e.target.value as 'asset' | 'room';
                          setFormTargetKind(kind);
                          const firstId = kind === 'asset' ? scene.assets[0]?.id ?? '' : scene.rooms[0]?.id ?? '';
                          setFormTargetId(firstId);
                          applyMetricPreset(formMetric, kind, firstId);
                        }}
                        className="w-full h-9 px-2.5 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      >
                        <option value="asset">Equipment Asset</option>
                        <option value="room">Room / Cleanroom</option>
                      </select>
                    </label>

                    <label className="sm:col-span-2 space-y-1 text-xs">
                      <span className="text-zinc-500">Target Equipment or Room</span>
                      <select
                        value={formTargetId}
                        onChange={(e) => {
                          setFormTargetId(e.target.value);
                          applyMetricPreset(formMetric, formTargetKind, e.target.value);
                        }}
                        className="w-full h-9 px-2.5 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      >
                        {formTargetKind === 'asset'
                          ? scene.assets.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.assetId} — {a.name} ({a.category})
                              </option>
                            ))
                          : scene.rooms.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.code} — {r.name} ({r.environmental.cleanroomGrade})
                              </option>
                            ))}
                      </select>
                    </label>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs text-zinc-500">Sensor Measurement Type (Auto-fills ISA Tag &amp; Bounds)</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(Object.keys(METRIC_PRESETS) as SensorMetricType[]).map((m) => (
                        <button
                          type="button"
                          key={m}
                          onClick={() => applyMetricPreset(m)}
                          className={`px-2.5 py-2 rounded-xl text-left text-xs border transition-colors ${
                            formMetric === m
                              ? 'border-violet-500 bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold'
                              : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#1A1A22] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                          }`}
                        >
                          <div className="truncate">{METRIC_PRESETS[m].label}</div>
                          <div className="text-[10px] font-mono opacity-75">
                            {METRIC_PRESETS[m].isaPrefix} · {METRIC_PRESETS[m].unit}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <label className="space-y-1">
                      <span className="text-zinc-500">Sensor Tag (ISA-5.1)</span>
                      <input
                        required
                        value={formTag}
                        onChange={(e) => setFormTag(e.target.value)}
                        placeholder="TT-BR2001-06"
                        className="w-full h-9 px-3 rounded-xl font-mono bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      />
                    </label>
                    <label className="sm:col-span-2 space-y-1">
                      <span className="text-zinc-500">Display Name</span>
                      <input
                        required
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="2000L Bioreactor · Jacket Outlet Temp"
                        className="w-full h-9 px-3 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
                    <label className="space-y-1">
                      <span className="text-zinc-500">Unit</span>
                      <input
                        value={formUnit}
                        onChange={(e) => setFormUnit(e.target.value)}
                        className="w-full h-9 px-2.5 rounded-xl font-mono bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-500">Nominal SP</span>
                      <input
                        type="number"
                        step="any"
                        value={formNominal}
                        onChange={(e) => setFormNominal(e.target.value)}
                        className="w-full h-9 px-2.5 rounded-xl font-mono bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-amber-500">Warn Low</span>
                      <input
                        type="number"
                        step="any"
                        value={formWarnLow}
                        onChange={(e) => setFormWarnLow(e.target.value)}
                        className="w-full h-9 px-2.5 rounded-xl font-mono bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-amber-500">Warn High</span>
                      <input
                        type="number"
                        step="any"
                        value={formWarnHigh}
                        onChange={(e) => setFormWarnHigh(e.target.value)}
                        className="w-full h-9 px-2.5 rounded-xl font-mono bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-rose-500">Alarm Low</span>
                      <input
                        type="number"
                        step="any"
                        value={formAlarmLow}
                        onChange={(e) => setFormAlarmLow(e.target.value)}
                        className="w-full h-9 px-2.5 rounded-xl font-mono bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-rose-500">Alarm High</span>
                      <input
                        type="number"
                        step="any"
                        value={formAlarmHigh}
                        onChange={(e) => setFormAlarmHigh(e.target.value)}
                        className="w-full h-9 px-2.5 rounded-xl font-mono bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <label className="space-y-1">
                      <span className="text-zinc-500">Industrial Protocol</span>
                      <select
                        value={formProtocol}
                        onChange={(e) => setFormProtocol(e.target.value as SensorProtocol)}
                        className="w-full h-9 px-2.5 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      >
                        <option value="OPC UA">OPC UA</option>
                        <option value="MQTT">MQTT</option>
                        <option value="Modbus TCP">Modbus TCP</option>
                        <option value="BACnet">BACnet</option>
                        <option value="HART">HART</option>
                        <option value="REST API">REST API</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-500">PLC / SCADA Address</span>
                      <input
                        value={formPlc}
                        onChange={(e) => setFormPlc(e.target.value)}
                        placeholder="PLC_A1.BR2001.TT_06"
                        className="w-full h-9 px-3 rounded-xl font-mono bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-500">Sampling Rate (Hz)</span>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="20"
                        value={formSamplingHz}
                        onChange={(e) => setFormSamplingHz(e.target.value)}
                        className="w-full h-9 px-3 rounded-xl font-mono bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                      />
                    </label>
                  </div>

                  <label className="block space-y-1 text-xs">
                    <span className="text-zinc-500">Engineering Notes</span>
                    <input
                      value={formDesc}
                      onChange={(e) => setFormDesc(e.target.value)}
                      placeholder="Optional calibration or GMP Annex 1 monitoring note..."
                      className="w-full h-9 px-3 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                    />
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formMainSensor}
                        onChange={(e) => setFormMainSensor(e.target.checked)}
                      />
                      <span>Feature as Main Sensor on 3D Viewport Indicator</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleBack}
                        className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingSensor}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {savingSensor ? 'Registering...' : 'Register Live Sensor Tag'}
                      </button>
                    </div>
                  </div>
                </form>

                {/* Registered Tag Directory (Virtualized) */}
                <div className="lg:col-span-5 p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] flex flex-col h-[520px] lg:h-[660px] overflow-hidden">
                  <div className="shrink-0 flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                        Registered Sensor Tags ({sensors.length})
                      </h3>
                      <p className="text-[11px] text-zinc-500">Click star to promote Main Sensor; delete custom tags</p>
                    </div>
                  </div>
                  <VirtualList
                    items={sensors}
                    itemHeight={54}
                    overscan={8}
                    className="flex-1 min-h-0 mt-1"
                    getKey={(s) => s.id}
                    emptyState={
                      <div className="p-6 text-center text-xs text-zinc-500">
                        No sensor tags registered yet.
                      </div>
                    }
                    renderItem={(s) => {
                      const snap = readings[s.id];
                      return (
                        <div className="h-full border-b border-zinc-100 dark:border-zinc-800/70 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{s.tag}</span>
                              <span className="text-[10.5px] text-violet-500 truncate">{s.targetCode}</span>
                            </div>
                            <div className="text-[11px] text-zinc-500 truncate">{s.name}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                              {(snap?.value ?? s.nominal).toFixed(s.precision)} {s.unit}
                            </span>
                            <button
                              onClick={() => updateSensor(s.id, { isMainSensor: !s.isMainSensor })}
                              className={s.isMainSensor ? 'text-amber-400' : 'text-zinc-400 hover:text-amber-400'}
                              title="Toggle Main Sensor"
                            >
                              <Star className="w-3.5 h-3.5" fill={s.isMainSensor ? 'currentColor' : 'none'} />
                            </button>
                            <button
                              onClick={() => deleteSensor(s.id)}
                              className="text-zinc-400 hover:text-rose-500"
                              title="Delete Sensor Tag"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              </div>
            </div>
          </main>
        )}

        {/* TAB 4: SENSOR RELATIONSHIPS & CONTROL LOOPS (WITH EXPLICIT BACK BUTTON) */}
        {dashboardTab === 'relationships' && (
          <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 lg:p-6">
            <div className="max-w-6xl mx-auto space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={handleBack}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-semibold text-zinc-800 dark:text-zinc-100 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
                  {backLabel}
                </button>
                <span className="text-xs font-mono text-zinc-500">{relationships.length} Active Loops</span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleSaveRelationship}
                  className="lg:col-span-5 p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] space-y-4 self-start"
                >
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                      Define Sensor Relationship
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Connect sensors to model PID control loops, cleanroom pressure cascades, safety interlocks, or redundant probes.
                    </p>
                  </div>

                  <label className="block space-y-1 text-xs">
                    <span className="text-zinc-500">Source Sensor (Trigger / Upstream)</span>
                    <select
                      required
                      value={relSourceId}
                      onChange={(e) => setRelSourceId(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                    >
                      <option value="">Select source sensor...</option>
                      {sensors.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.tag} — {s.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1 text-xs">
                    <span className="text-zinc-500">Relationship Type</span>
                    <select
                      value={relType}
                      onChange={(e) => setRelType(e.target.value as SensorRelationshipType)}
                      className="w-full h-9 px-2.5 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                    >
                      {(Object.keys(RELATIONSHIP_META) as SensorRelationshipType[]).map((k) => (
                        <option key={k} value={k}>
                          {RELATIONSHIP_META[k].label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1 text-xs">
                    <span className="text-zinc-500">Target Sensor (Controlled / Downstream)</span>
                    <select
                      required
                      value={relTargetId}
                      onChange={(e) => setRelTargetId(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                    >
                      <option value="">Select target sensor...</option>
                      {sensors
                        .filter((s) => s.id !== relSourceId)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.tag} — {s.name}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="block space-y-1 text-xs">
                    <span className="text-zinc-500">Loop / Link Label</span>
                    <input
                      value={relLabel}
                      onChange={(e) => setRelLabel(e.target.value)}
                      placeholder="e.g., Jacket Thermal Interlock"
                      className="w-full h-9 px-3 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                    />
                  </label>

                  <label className="block space-y-1 text-xs">
                    <span className="text-zinc-500">Engineering Rule Description</span>
                    <textarea
                      rows={2}
                      value={relDesc}
                      onChange={(e) => setRelDesc(e.target.value)}
                      placeholder="Describe how the source reading governs or interlocks the target sensor..."
                      className="w-full p-2.5 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={!relSourceId || !relTargetId || relSourceId === relTargetId}
                    className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-40 transition-colors"
                  >
                    Create Sensor Relationship
                  </button>
                </form>

                <div className="lg:col-span-7 p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Active Control Loops &amp; Sensor Dependencies ({relationships.length})
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Real-time values shown on both ends of each dependency link
                    </p>
                  </div>

                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                    {relationships.map((rel) => {
                      const src = sensors.find((s) => s.id === rel.sourceSensorId);
                      const tgt = sensors.find((s) => s.id === rel.targetSensorId);
                      if (!src || !tgt) return null;
                      const srcSnap = readings[src.id];
                      const tgtSnap = readings[tgt.id];
                      const meta = RELATIONSHIP_META[rel.type];

                      return (
                        <div key={rel.id} className="py-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <button
                                onClick={() => {
                                  setDashboardFocus({
                                    assetId: src.targetKind === 'asset' ? src.targetId : null,
                                    roomId: src.targetKind === 'room' ? src.targetId : null,
                                    sensorId: src.id,
                                  });
                                  navigateToTab('trends');
                                }}
                                className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-[#1A1A22] font-mono hover:text-violet-400"
                              >
                                <span className="font-semibold">{src.tag}</span>{' '}
                                <span className="text-zinc-500">
                                  {(srcSnap?.value ?? src.nominal).toFixed(src.precision)} {src.unit}
                                </span>
                              </button>

                              <span style={{ color: meta.color }} className="font-medium">
                                ── {rel.label} ──▶
                              </span>

                              <button
                                onClick={() => {
                                  setDashboardFocus({
                                    assetId: tgt.targetKind === 'asset' ? tgt.targetId : null,
                                    roomId: tgt.targetKind === 'room' ? tgt.targetId : null,
                                    sensorId: tgt.id,
                                  });
                                  navigateToTab('trends');
                                }}
                                className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-[#1A1A22] font-mono hover:text-violet-400"
                              >
                                <span className="font-semibold">{tgt.tag}</span>{' '}
                                <span className="text-zinc-500">
                                  {(tgtSnap?.value ?? tgt.nominal).toFixed(tgt.precision)} {tgt.unit}
                                </span>
                              </button>
                            </div>

                            <button
                              onClick={() => deleteRelationship(rel.id)}
                              className="p-1 text-zinc-400 hover:text-rose-500 shrink-0"
                              title="Delete Relationship"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                            <span>{rel.description}</span>
                            <span className="font-mono shrink-0 ml-2" style={{ color: meta.color }}>
                              {meta.short}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </main>
        )}

        {/* TAB 5: PREDICTIVE FAILURE FORECAST & MAINTENANCE MILESTONES */}
        {dashboardTab === 'predictive' && (
          <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 lg:p-6">
            <div className="max-w-[1440px] mx-auto space-y-5">
              {/* Top Section Header + Timeline Sync Toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleBack}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
                    Back
                  </button>
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                      Predictive Asset Failure &amp; Maintenance Milestones
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Recharts OLS drift forecasting &amp; fleet horizon analysis · Synced directly to the 5D Timeline bar
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] text-xs font-medium text-zinc-700 dark:text-zinc-200 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showMaintenanceMilestones}
                      onChange={(e) => setShowMaintenanceMilestones(e.target.checked)}
                      className="accent-amber-500 rounded"
                    />
                    <span>Show Milestones on 5D Timeline</span>
                  </label>
                  {!standalone && selectedMilestone && (
                    <button
                      type="button"
                      onClick={() => handleJumpToTimelineMilestone(selectedMilestone)}
                      className="h-9 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                      Open Timeline Bar
                    </button>
                  )}
                </div>
              </div>

              {/* 4-Column Fleet Predictive KPI Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121216]">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Monitored Equipment</div>
                  <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-zinc-900 dark:text-white">
                    {predictiveSummary.total}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">Active sensor-history models</div>
                </div>
                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121216]">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Critical Failures (≤14d)</div>
                  <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-rose-500">
                    {predictiveSummary.critical}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">Immediate PM intervention</div>
                </div>
                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121216]">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Upcoming Service (15–45d)</div>
                  <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-amber-500">
                    {predictiveSummary.warning}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">Pinned as 5D timeline milestones</div>
                </div>
                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121216]">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Mean Fleet Health</div>
                  <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-emerald-500">
                    {predictiveSummary.meanHealth}%
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">Composite drift &amp; margin index</div>
                </div>
              </div>

              {/* Recharts Predictive Failure Visualization Suite */}
              <PredictiveFailureCharts
                milestones={maintenanceMilestones}
                selectedMilestone={selectedMilestone}
                selectedSensor={selectedMilestoneSensor}
                selectedSnapshot={
                  selectedMilestoneSensor ? readings[selectedMilestoneSensor.id] : undefined
                }
                isDark={theme === 'dark'}
                onSelectAsset={(assetId) => setSelectedPredictiveAssetId(assetId)}
                onJumpToTimeline={!standalone ? handleJumpToTimelineMilestone : undefined}
                onSchedulePm={handleSchedulePredictivePm}
              />

              {/* Ranked Maintenance Milestones Directory (Virtualized Rows) */}
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121216] overflow-hidden">
                <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Maintenance Milestones Forecast ({filteredMilestones.length})
                    </h3>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      Click any row to update the Recharts horizon curve or scrub directly to its 5D Timeline milestone
                    </p>
                  </div>

                  <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-800 overflow-x-auto max-w-full">
                    {(
                      [
                        { id: 'all', label: 'All' },
                        { id: 'critical', label: 'Critical ≤14d' },
                        { id: 'warning', label: 'Due Soon ≤45d' },
                        { id: 'advisory', label: 'Advisory' },
                        { id: 'healthy', label: 'Healthy' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setPredictiveSeverityFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          predictiveSeverityFilter === f.id
                            ? 'bg-violet-600 text-white'
                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <div className="min-w-[780px]">
                    <div className="grid grid-cols-12 items-center border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#16161E] text-[11px] text-zinc-500 dark:text-zinc-400 font-medium py-2.5 px-4">
                      <div className="col-span-3">Equipment</div>
                      <div className="col-span-2">Driver Sensor</div>
                      <div className="col-span-2 text-right">Live / Alarm</div>
                      <div className="col-span-2 text-right">Predicted Failure</div>
                      <div className="col-span-1 text-right">Health</div>
                      <div className="col-span-2 text-right">Actions</div>
                    </div>
                    <VirtualList
                      items={filteredMilestones}
                      itemHeight={60}
                      overscan={6}
                      maxHeight={420}
                      resetScrollKey={predictiveSeverityFilter}
                      getKey={(m) => m.id}
                      emptyState={
                        <div className="py-8 text-center text-xs text-zinc-500">
                          No equipment matches this predictive severity filter.
                        </div>
                      }
                      renderItem={(m) => {
                        const sev = severityMeta(m.severity);
                        const isSel = selectedMilestone?.assetId === m.assetId;
                        return (
                          <div
                            onClick={() => setSelectedPredictiveAssetId(m.assetId)}
                            className={`h-full grid grid-cols-12 items-center px-4 border-b border-zinc-100 dark:border-zinc-800/70 text-xs cursor-pointer transition-colors ${
                              isSel
                                ? 'bg-violet-500/10'
                                : 'hover:bg-zinc-50 dark:hover:bg-[#181822]'
                            }`}
                          >
                            <div className="col-span-3 min-w-0 pr-2">
                              <div className="font-mono font-semibold text-zinc-900 dark:text-white truncate">
                                {m.assetCode}
                              </div>
                              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                                {m.assetName}
                              </div>
                            </div>
                            <div className="col-span-2 min-w-0 pr-2">
                              <div className="font-mono text-violet-600 dark:text-violet-400 truncate">
                                {m.driverSensorTag}
                              </div>
                              <div className="text-[11px] text-zinc-500 truncate">
                                {m.driverMetricLabel} · {m.confidencePct}%
                              </div>
                            </div>
                            <div className="col-span-2 text-right font-mono tabular-nums whitespace-nowrap pr-2">
                              <div className="font-semibold text-zinc-900 dark:text-white">
                                {m.currentValue.toFixed(m.precision)} {m.unit}
                              </div>
                              <div className="text-[10.5px] text-rose-500">
                                Limit {m.alarmThreshold} {m.unit}
                              </div>
                            </div>
                            <div className="col-span-2 text-right font-mono tabular-nums whitespace-nowrap pr-2">
                              <div className={`font-semibold ${sev.textCls}`}>
                                {sev.glyph} {m.predictedFailureDate}
                              </div>
                              <div className="text-[10.5px] text-zinc-500">
                                in {m.daysUntilFailure}d · PM {m.recommendedServiceDate}
                              </div>
                            </div>
                            <div className="col-span-1 text-right font-mono tabular-nums pr-2">
                              <span
                                className={
                                  m.healthScore < 55
                                    ? 'text-rose-500 font-semibold'
                                    : m.healthScore < 75
                                      ? 'text-amber-500 font-semibold'
                                      : 'text-emerald-500 font-semibold'
                                }
                              >
                                {m.healthScore}%
                              </span>
                            </div>
                            <div
                              className="col-span-2 text-right whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="inline-flex items-center gap-1.5">
                                {!standalone && (
                                  <button
                                    type="button"
                                    onClick={() => handleJumpToTimelineMilestone(m)}
                                    className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500 text-amber-600 dark:text-amber-400 hover:text-zinc-950 font-semibold text-[11px] transition-colors cursor-pointer"
                                  >
                                    Timeline
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleSchedulePredictivePm(m)}
                                  className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-zinc-700 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                                >
                                  PM Order
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </main>
        )}
      </div>

      {/* On-Demand Equipment / Room Switcher Dialog (Virtualized) */}
      {showSwitcherModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-0 sm:p-4"
          onClick={() => setShowSwitcherModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl h-[100dvh] sm:h-[80vh] sm:rounded-3xl border-0 sm:border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121216] shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="shrink-0 px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setShowSwitcherModal(false)}
                  className="p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-violet-500 text-zinc-600 dark:text-zinc-300"
                  title="Back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                    Select Equipment or Cleanroom to Inspect
                  </h3>
                  <p className="text-[11px] text-zinc-500">
                    {filteredGroups.length} monitored units matching filter
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSwitcherModal(false)}
                className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="shrink-0 p-4 border-b border-zinc-200 dark:border-zinc-800 space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Bioreactor, HPLC, Autoclave, Room, or Sensor Tag..."
                  className="w-full h-9 pl-9 pr-3 rounded-xl bg-zinc-50 dark:bg-[#1A1A22] border border-zinc-200 dark:border-zinc-800 text-xs focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'bioreactors', label: 'Bioreactors' },
                    { id: 'hplc', label: 'HPLC' },
                    { id: 'rooms', label: 'Rooms' },
                    { id: 'alarms', label: 'Alerts Only' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setCategoryFilter(f.id)}
                    className={`px-3 py-1 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      categoryFilter === f.id
                        ? 'bg-violet-600 text-white'
                        : 'bg-zinc-100 dark:bg-[#1A1A22] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <VirtualList
              items={filteredGroups}
              itemHeight={62}
              overscan={8}
              resetScrollKey={`${categoryFilter}-${searchQuery}`}
              className="flex-1 min-h-0"
              getKey={(g) => g.key}
              emptyState={
                <div className="p-8 text-center text-xs text-zinc-500">
                  No monitored equipment or rooms match this filter.
                </div>
              }
              renderItem={(g) => {
                const mainSnap = readings[g.mainSensor.id];
                const isSel = activeGroup?.key === g.key;
                const stInfo = statusText(g.worstStatus);
                return (
                  <button
                    onClick={() => {
                      setDashboardFocus({
                        assetId: g.targetKind === 'asset' ? g.targetId : null,
                        roomId: g.targetKind === 'room' ? g.targetId : null,
                        sensorId: g.mainSensor.id,
                      });
                      setShowSwitcherModal(false);
                    }}
                    className={`w-full h-full text-left px-5 border-b border-zinc-100 dark:border-zinc-800/70 flex items-center justify-between gap-3 transition-colors ${
                      isSel
                        ? 'bg-violet-500/10'
                        : 'hover:bg-zinc-50 dark:hover:bg-[#1A1A22]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-violet-500 font-semibold shrink-0">{g.code}</span>
                        <span className="text-xs font-semibold text-zinc-900 dark:text-white truncate">{g.name}</span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-0.5 truncate">
                        {g.mainSensor.tag} · {g.sensors.length} channels · {g.category}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono tabular-nums text-xs font-bold text-zinc-900 dark:text-white">
                        {(mainSnap?.value ?? g.mainSensor.nominal).toFixed(g.mainSensor.precision)} {g.mainSensor.unit}
                      </div>
                      <div className={`text-[10.5px] font-mono ${stInfo.cls}`}>
                        {stInfo.glyph} {stInfo.label}
                      </div>
                    </div>
                  </button>
                );
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
