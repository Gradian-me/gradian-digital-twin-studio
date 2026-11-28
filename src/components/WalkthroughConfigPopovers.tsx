/**
 * Walkthrough First-Person / Third-Person Configuration Popovers:
 * 1. SpatialAudioSettingsPopover — Adjust master volume, rolloff distance, and
 *    Linear / Inverse / Exponential falloff curves independently for Machinery and Ventilation,
 *    with a live SVG attenuation curve plot and per-channel test cues.
 * 2. PathFinderConfigPopover — Navigate to rooms/assets, toggle 'Shortest Distance' vs
 *    'Least Congested' A* routing, and define / manage 3D 'No-Go' exclusion zones
 *    (either by clicking on the 3D floor or restricting specific rooms).
 */
import React, { useMemo, useState } from 'react';
import {
  Ban,
  Crosshair,
  Navigation,
  Play,
  RotateCcw,
  Route,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  Wind,
  Wrench,
  X,
} from 'lucide-react';
import {
  DEFAULT_SPATIAL_AUDIO_SETTINGS,
  computeSpatialAttenuation,
  type NearbyAudioTelemetry,
  type SpatialAudioChannelConfig,
  type SpatialAudioSettings,
  type SpatialDistanceModel,
} from '../engine/spatialAudio';
import type { NoGoZone, PathRoutingAlgorithm } from '../engine/navMesh';
import type { Room, SpatialAsset } from '../types/twin';
import { SelectedBadgesBar } from './SelectedBadgesBar';

const DISTANCE_MODELS: Array<{ id: SpatialDistanceModel; label: string; hint: string }> = [
  { id: 'linear', label: 'Linear', hint: 'Constant drop-off to max distance' },
  { id: 'inverse', label: 'Inverse', hint: 'Natural physical 1/r acoustic rolloff' },
  { id: 'exponential', label: 'Exponential', hint: 'Steep proximity focus near machines' },
];

const FalloffCurvePreview: React.FC<{
  machinery: SpatialAudioChannelConfig;
  ventilation: SpatialAudioChannelConfig;
}> = ({ machinery, ventilation }) => {
  const W = 280;
  const H = 86;
  const padL = 24;
  const padR = 10;
  const padT = 8;
  const padB = 18;
  const maxPlotDist = 25;

  const buildPath = (cfg: SpatialAudioChannelConfig) => {
    const samples = 48;
    const pts: string[] = [];
    for (let i = 0; i <= samples; i++) {
      const d = (i / samples) * maxPlotDist;
      const gain = Math.min(1.25, computeSpatialAttenuation(d, cfg) * cfg.volume);
      const x = padL + (d / maxPlotDist) * (W - padL - padR);
      const y = H - padB - Math.min(1, gain / 1.25) * (H - padT - padB);
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(' ');
  };

  const machPath = useMemo(() => buildPath(machinery), [machinery]);
  const ventPath = useMemo(() => buildPath(ventilation), [ventilation]);

  return (
    <div className="rounded-xl bg-[#0A0B10] border border-zinc-800 p-2">
      <div className="flex items-center justify-between text-[9.5px] text-zinc-400 mb-1 px-0.5">
        <span className="font-medium text-zinc-300">3D Volume Falloff Curve (0–25m)</span>
        <div className="flex items-center gap-2.5 font-mono">
          <span className="inline-flex items-center gap-1 text-cyan-300">
            <span className="w-2 h-0.5 bg-cyan-400 inline-block" />
            Machinery
          </span>
          <span className="inline-flex items-center gap-1 text-emerald-300">
            <span className="w-2 h-0.5 bg-emerald-400 inline-block" />
            Ventilation
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[86px] block">
        {/* Horizontal grid lines */}
        {[0, 0.5, 1].map((frac) => {
          const y = H - padB - frac * (H - padT - padB);
          return (
            <g key={frac}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="#232533"
                strokeDasharray="2 3"
              />
              <text x={padL - 4} y={y + 3} textAnchor="end" className="fill-zinc-500 font-mono text-[8px]">
                {Math.round(frac * 100)}%
              </text>
            </g>
          );
        })}
        {/* Distance ticks */}
        {[0, 5, 10, 15, 20, 25].map((m) => {
          const x = padL + (m / maxPlotDist) * (W - padL - padR);
          return (
            <text
              key={m}
              x={x}
              y={H - 4}
              textAnchor="middle"
              className="fill-zinc-500 font-mono text-[8px]"
            >
              {m}m
            </text>
          );
        })}
        {/* Ventilation curve */}
        <path d={ventPath} fill="none" stroke="#10B981" strokeWidth={1.8} strokeLinecap="round" />
        {/* Machinery curve */}
        <path d={machPath} fill="none" stroke="#22D3EE" strokeWidth={2.0} strokeLinecap="round" />
      </svg>
    </div>
  );
};

interface ChannelControlBlockProps {
  title: string;
  accent: 'cyan' | 'emerald';
  icon: React.ReactNode;
  config: SpatialAudioChannelConfig;
  onChange: (patch: Partial<SpatialAudioChannelConfig>) => void;
  onTest: () => void;
}

const ChannelControlBlock: React.FC<ChannelControlBlockProps> = ({
  title,
  accent,
  icon,
  config,
  onChange,
  onTest,
}) => {
  const accentText = accent === 'cyan' ? 'text-cyan-300' : 'text-emerald-300';
  const activeTab =
    accent === 'cyan'
      ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
      : 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200';
  const rangeAccent = accent === 'cyan' ? 'accent-cyan-400' : 'accent-emerald-400';

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#13141D] p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${accentText}`}>
          {icon}
          <span>{title}</span>
        </div>
        <button
          type="button"
          onClick={onTest}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-[10px] text-zinc-200 cursor-pointer transition-colors"
          title={`Preview ${title} audio`}
        >
          <Play className="w-2.5 h-2.5" />
          <span>Test</span>
        </button>
      </div>

      {/* Falloff Curve Segmented Control */}
      <div className="grid grid-cols-3 gap-1">
        {DISTANCE_MODELS.map((m) => {
          const active = config.distanceModel === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ distanceModel: m.id })}
              title={m.hint}
              className={`px-1.5 py-1 rounded-lg border text-[10px] font-medium transition-colors cursor-pointer ${
                active
                  ? activeTab
                  : 'bg-[#0C0D14] border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Sliders: Volume, Ref Distance, Max Rolloff Distance, Rolloff Steepness */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
        <label className="space-y-0.5">
          <div className="flex justify-between text-zinc-400">
            <span>Volume</span>
            <span className="font-mono text-zinc-200 tabular-nums">
              {Math.round(config.volume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={config.volume}
            onChange={(e) => onChange({ volume: Number(e.target.value) })}
            className={`w-full h-1.5 cursor-pointer ${rangeAccent}`}
          />
        </label>

        <label className="space-y-0.5">
          <div className="flex justify-between text-zinc-400">
            <span>Falloff Slope</span>
            <span className="font-mono text-zinc-200 tabular-nums">
              {config.rolloffFactor.toFixed(2)}×
            </span>
          </div>
          <input
            type="range"
            min={0.3}
            max={3.8}
            step={0.05}
            value={config.rolloffFactor}
            onChange={(e) => onChange({ rolloffFactor: Number(e.target.value) })}
            className={`w-full h-1.5 cursor-pointer ${rangeAccent}`}
          />
        </label>

        <label className="space-y-0.5">
          <div className="flex justify-between text-zinc-400">
            <span>Full-Vol Radius</span>
            <span className="font-mono text-zinc-200 tabular-nums">
              {config.refDistance.toFixed(1)}m
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={7.5}
            step={0.25}
            value={config.refDistance}
            onChange={(e) => {
              const nextRef = Number(e.target.value);
              onChange({
                refDistance: nextRef,
                maxDistance: Math.max(config.maxDistance, nextRef + 2),
              });
            }}
            className={`w-full h-1.5 cursor-pointer ${rangeAccent}`}
          />
        </label>

        <label className="space-y-0.5">
          <div className="flex justify-between text-zinc-400">
            <span>Max Rolloff Dist</span>
            <span className="font-mono text-zinc-200 tabular-nums">
              {config.maxDistance.toFixed(0)}m
            </span>
          </div>
          <input
            type="range"
            min={4}
            max={32}
            step={1}
            value={config.maxDistance}
            onChange={(e) =>
              onChange({ maxDistance: Math.max(config.refDistance + 1, Number(e.target.value)) })
            }
            className={`w-full h-1.5 cursor-pointer ${rangeAccent}`}
          />
        </label>
      </div>
    </div>
  );
};

export interface SpatialAudioSettingsPopoverProps {
  settings: SpatialAudioSettings;
  enabled: boolean;
  telemetry: NearbyAudioTelemetry | null;
  onToggleEnabled: () => void;
  onChange: (next: SpatialAudioSettings) => void;
  onTestChannel: (channel: 'machinery' | 'ventilation') => void;
  onClose: () => void;
}

export const SpatialAudioSettingsPopover: React.FC<SpatialAudioSettingsPopoverProps> = ({
  settings,
  enabled,
  telemetry,
  onToggleEnabled,
  onChange,
  onTestChannel,
  onClose,
}) => {
  return (
    <div className="w-[340px] max-w-[92vw] rounded-2xl bg-[#0F1016] border border-zinc-700/85 shadow-[0_14px_40px_rgba(0,0,0,0.78)] text-zinc-100 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white">
          <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
          <span>3D Spatial Audio Settings</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              onChange({
                masterVolume: DEFAULT_SPATIAL_AUDIO_SETTINGS.masterVolume,
                machinery: { ...DEFAULT_SPATIAL_AUDIO_SETTINGS.machinery },
                ventilation: { ...DEFAULT_SPATIAL_AUDIO_SETTINGS.ventilation },
              })
            }
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
            title="Reset spatial audio defaults"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
            aria-label="Close spatial audio settings"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2.5 max-h-[48vh] md:max-h-[68vh] overflow-y-auto">
        {/* Master Row + Acoustic Live Summary */}
        <div className="flex items-center justify-between gap-3 text-[10.5px]">
          <button
            type="button"
            onClick={onToggleEnabled}
            className={`px-2.5 py-1 rounded-lg border font-medium flex items-center gap-1.5 cursor-pointer transition-colors shrink-0 ${
              enabled
                ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
            }`}
          >
            {enabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            <span>{enabled ? 'HRTF Active' : 'Muted'}</span>
          </button>

          <label className="flex-1 flex items-center gap-2">
            <span className="text-zinc-400 whitespace-nowrap">Master</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={settings.masterVolume}
              onChange={(e) =>
                onChange({ ...settings, masterVolume: Number(e.target.value) })
              }
              className="flex-1 h-1.5 accent-violet-400 cursor-pointer"
            />
            <span className="font-mono text-zinc-200 tabular-nums w-8 text-right">
              {Math.round(settings.masterVolume * 100)}%
            </span>
          </label>
        </div>

        {enabled && telemetry?.active && (
          <div className="px-2.5 py-1.5 rounded-lg bg-[#141621] border border-zinc-800 flex items-center justify-between gap-2 text-[10px]">
            <span className="text-zinc-300 truncate">
              Nearest: <strong className="text-white">{telemetry.dominantLabel}</strong>
              {telemetry.dominantDistanceM !== null ? ` (${telemetry.dominantDistanceM}m)` : ''}
            </span>
            <span className="font-mono text-emerald-300 tabular-nums shrink-0">
              {telemetry.estimatedDb} dB
            </span>
          </div>
        )}

        {/* Live Attenuation Curve Plot */}
        <FalloffCurvePreview
          machinery={settings.machinery}
          ventilation={settings.ventilation}
        />

        {/* Machinery & Equipment Channel */}
        <ChannelControlBlock
          title="Machinery & Process Equipment"
          accent="cyan"
          icon={<Wrench className="w-3.5 h-3.5" />}
          config={settings.machinery}
          onChange={(patch) =>
            onChange({ ...settings, machinery: { ...settings.machinery, ...patch } })
          }
          onTest={() => onTestChannel('machinery')}
        />

        {/* Room Ventilation / HVAC Channel */}
        <ChannelControlBlock
          title="Room Ventilation & Cleanroom HVAC"
          accent="emerald"
          icon={<Wind className="w-3.5 h-3.5" />}
          config={settings.ventilation}
          onChange={(patch) =>
            onChange({ ...settings, ventilation: { ...settings.ventilation, ...patch } })
          }
          onTest={() => onTestChannel('ventilation')}
        />
      </div>
    </div>
  );
};

export interface PathFinderConfigPopoverProps {
  activeFloorId: string;
  currentRoomId?: string | null;
  floorRooms: Room[];
  floorAssets: SpatialAsset[];
  algorithm: PathRoutingAlgorithm;
  noGoZones: NoGoZone[];
  placingNoGo: boolean;
  noGoRadius: number;
  noGoLabelDraft: string;
  onChangeAlgorithm: (algo: PathRoutingAlgorithm) => void;
  onTogglePlacingNoGo: () => void;
  onChangeNoGoRadius: (r: number) => void;
  onChangeNoGoLabelDraft: (label: string) => void;
  onToggleRoomNoGo: (room: Room) => void;
  onRemoveNoGoZone: (id: string) => void;
  onClearNoGoZones: () => void;
  onSelectDestination: (
    dest: { label: string; code: string; x: number; z: number; roomId?: string },
    autoWalk: boolean
  ) => void;
  onClose: () => void;
}

export const PathFinderConfigPopover: React.FC<PathFinderConfigPopoverProps> = ({
  activeFloorId,
  currentRoomId,
  floorRooms,
  floorAssets,
  algorithm,
  noGoZones,
  placingNoGo,
  noGoRadius,
  noGoLabelDraft,
  onChangeAlgorithm,
  onTogglePlacingNoGo,
  onChangeNoGoRadius,
  onChangeNoGoLabelDraft,
  onToggleRoomNoGo,
  onRemoveNoGoZone,
  onClearNoGoZones,
  onSelectDestination,
  onClose,
}) => {
  const [tab, setTab] = useState<'navigate' | 'config'>('navigate');
  const [search, setSearch] = useState('');

  const floorNoGoZones = useMemo(
    () => noGoZones.filter((z) => z.floorId === activeFloorId),
    [noGoZones, activeFloorId]
  );

  const restrictedRoomIds = useMemo(() => {
    const s = new Set<string>();
    floorNoGoZones.forEach((z) => {
      if (z.kind === 'room' && z.roomId) s.add(z.roomId);
    });
    return s;
  }, [floorNoGoZones]);

  const navItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const roomItems = floorRooms.map((r) => ({
      id: `rm-${r.id}`,
      roomId: r.id,
      kind: 'Room' as const,
      code: r.code,
      label: r.name,
      grade: r.environmental?.cleanroomGrade || '',
      isCurrent: currentRoomId === r.id,
      x: r.x + r.width * 0.5,
      z: r.z + r.depth * 0.5,
      restricted: restrictedRoomIds.has(r.id),
    }));
    const assetItems = floorAssets.map((a) => ({
      id: `as-${a.id}`,
      roomId: a.roomId,
      kind: 'Asset' as const,
      code: a.assetId,
      label: a.name,
      grade: '',
      isCurrent: false,
      x: a.x,
      z: a.z,
      restricted: false,
    }));
    return [...roomItems, ...assetItems]
      .filter(
        (it) =>
          !q ||
          it.code.toLowerCase().includes(q) ||
          it.label.toLowerCase().includes(q) ||
          it.grade.toLowerCase().includes(q)
      )
      .slice(0, 32);
  }, [floorRooms, floorAssets, search, restrictedRoomIds, currentRoomId]);

  const algoBadgeLabel =
    algorithm === 'gmp-compliant'
      ? 'GMP Path'
      : algorithm === 'least-congested'
        ? 'Least Congested'
        : 'Shortest';

  return (
    <div className="w-[356px] max-w-[94vw] rounded-2xl bg-[#0F1016] border border-violet-500/45 shadow-[0_14px_40px_rgba(0,0,0,0.78)] text-zinc-100 overflow-hidden">
      {/* Header + Mode Tabs */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-200">
          <Route className="w-3.5 h-3.5 text-violet-400" />
          <span>Go To &amp; Path Finder</span>
          <span className="text-[10px] font-mono text-zinc-400">· {algoBadgeLabel}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
          aria-label="Close Path Finder"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Segmented Tabs */}
      <div className="px-2.5 pt-2 pb-1.5 border-b border-zinc-800/80 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => setTab('navigate')}
          className={`px-2 py-1.5 rounded-lg text-[10.5px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
            tab === 'navigate'
              ? 'bg-cyan-500/20 border border-cyan-400/50 text-cyan-100'
              : 'bg-[#151620] border border-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Navigation className="w-3 h-3" />
          <span>Destinations</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('config')}
          className={`px-2 py-1.5 rounded-lg text-[10.5px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
            tab === 'config'
              ? 'bg-rose-500/20 border border-rose-400/50 text-rose-100'
              : 'bg-[#151620] border border-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Ban className="w-3 h-3" />
          <span>Routing &amp; No-Go ({floorNoGoZones.length})</span>
        </button>
      </div>

      {tab === 'navigate' ? (
        <div>
          {/* Quick Routing Protocol Selector */}
          <div className="px-2.5 pt-2 pb-1.5 border-b border-zinc-800/80 space-y-1.5">
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'gmp-compliant', label: 'GMP Path', activeCls: 'bg-violet-500/20 border-violet-400/60 text-violet-100' },
                  { id: 'shortest', label: 'Shortest', activeCls: 'bg-cyan-500/20 border-cyan-400/60 text-cyan-100' },
                  { id: 'least-congested', label: 'Uncongested', activeCls: 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => onChangeAlgorithm(mode.id)}
                  className={`px-1.5 py-1 rounded-lg border text-[10px] font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                    algorithm === mode.id
                      ? mode.activeCls
                      : 'bg-[#141520] border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {mode.id === 'gmp-compliant' && <ShieldCheck className="w-3 h-3 shrink-0" />}
                  <span>{mode.label}</span>
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search room, cleanroom grade, or equipment..."
                className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-[#181924] border border-zinc-700/80 text-[11px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400"
              />
            </div>
          </div>

          <div className="max-h-[38vh] md:max-h-56 overflow-y-auto divide-y divide-zinc-800/70">
            {navItems.map((item) => (
              <div
                key={item.id}
                className="px-2.5 py-2 flex items-center justify-between gap-2 hover:bg-white/[0.03]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                    <span className="font-mono font-bold text-cyan-300">{item.code}</span>
                    {item.grade && (
                      <span className="text-[9.5px] font-mono text-violet-300">
                        · {item.grade}
                      </span>
                    )}
                    {!item.grade && <span className="text-zinc-500">· {item.kind}</span>}
                    {item.isCurrent && (
                      <span className="text-emerald-400 font-semibold">· Here</span>
                    )}
                    {item.restricted && (
                      <span className="text-rose-400 font-semibold">· No-Go</span>
                    )}
                  </div>
                  <div className="text-[11px] font-medium text-zinc-100 truncate">
                    {item.label}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      onSelectDestination(
                        {
                          label: item.label,
                          code: item.code,
                          x: item.x,
                          z: item.z,
                          roomId: item.roomId,
                        },
                        false
                      )
                    }
                    className="px-2 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 text-[10px] font-semibold cursor-pointer"
                    title="Highlight GMP walking path on the 3D floor"
                  >
                    Guide
                  </button>
                  <button
                    type="button"
                    disabled={item.isCurrent}
                    onClick={() =>
                      onSelectDestination(
                        {
                          label: item.label,
                          code: item.code,
                          x: item.x,
                          z: item.z,
                          roomId: item.roomId,
                        },
                        true
                      )
                    }
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                      item.isCurrent
                        ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                        : 'bg-violet-600 hover:bg-violet-500 text-white cursor-pointer'
                    }`}
                    title="Auto-walk via GMP path, opening & closing doors, airlocks & PAL gowning"
                  >
                    Go To
                  </button>
                </div>
              </div>
            ))}
            {navItems.length === 0 && (
              <div className="p-4 text-center text-[11px] text-zinc-500">
                No matching rooms or assets on this floor.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-3 space-y-3 max-h-[48vh] md:max-h-[64vh] overflow-y-auto">
          {/* 1. Routing Algorithm Toggle */}
          <div className="space-y-1.5">
            <div className="text-[10.5px] font-semibold text-zinc-300">
              AI Routing Algorithm
            </div>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => onChangeAlgorithm('gmp-compliant')}
                className={`w-full p-2 rounded-xl border text-left transition-colors cursor-pointer ${
                  algorithm === 'gmp-compliant'
                    ? 'bg-violet-500/18 border-violet-400/65 text-white'
                    : 'bg-[#141520] border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5 text-violet-300" />
                  <span>EU GMP Annex 1 Compliant Path</span>
                </div>
                <div className="text-[9.5px] opacity-80 mt-0.5 leading-snug">
                  Uses clean corridors, stages via PAL gowning on grade changes, avoids MALs &amp; auto-opens/closes doors
                </div>
              </button>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onChangeAlgorithm('shortest')}
                  className={`p-2 rounded-xl border text-left transition-colors cursor-pointer ${
                    algorithm === 'shortest'
                      ? 'bg-cyan-500/15 border-cyan-400/60 text-white'
                      : 'bg-[#141520] border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="text-[11px] font-semibold">Shortest Distance</div>
                  <div className="text-[9.5px] opacity-75 mt-0.5 leading-snug">
                    Minimum meters via direct doors
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onChangeAlgorithm('least-congested')}
                  className={`p-2 rounded-xl border text-left transition-colors cursor-pointer ${
                    algorithm === 'least-congested'
                      ? 'bg-emerald-500/15 border-emerald-400/60 text-white'
                      : 'bg-[#141520] border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="text-[11px] font-semibold">Least Congested</div>
                  <div className="text-[9.5px] opacity-75 mt-0.5 leading-snug">
                    Avoids bottlenecks &amp; dense machinery
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* 2. Define Floor No-Go Zone (Click to Place) */}
          <div className="rounded-xl border border-zinc-800 bg-[#141520] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-semibold text-rose-300">
                Place Floor No-Go Zone
              </span>
              <span className="text-[10px] font-mono text-zinc-400 tabular-nums">
                Radius {noGoRadius.toFixed(1)}m
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={noGoLabelDraft}
                onChange={(e) => onChangeNoGoLabelDraft(e.target.value)}
                placeholder="Zone label (e.g. Spill / Maintenance)"
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#0B0C12] border border-zinc-700/80 text-[10.5px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-400"
              />
            </div>

            <input
              type="range"
              min={1.2}
              max={6.0}
              step={0.3}
              value={noGoRadius}
              onChange={(e) => onChangeNoGoRadius(Number(e.target.value))}
              className="w-full h-1.5 accent-rose-500 cursor-pointer"
            />

            <button
              type="button"
              onClick={onTogglePlacingNoGo}
              className={`w-full py-1.5 px-3 rounded-lg border text-[10.5px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                placingNoGo
                  ? 'bg-rose-600 border-rose-400 text-white'
                  : 'bg-rose-500/15 hover:bg-rose-500/25 border-rose-500/45 text-rose-200'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>
                {placingNoGo
                  ? 'Click anywhere on 3D floor (Active)...'
                  : 'Click Floor to Mark No-Go Zone'}
              </span>
            </button>
          </div>

          {/* 3. Quick Room Exclusion Toggles */}
          {floorRooms.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10.5px] font-semibold text-zinc-300">
                Block Entire Rooms (No-Go)
              </div>
              <SelectedBadgesBar
                items={floorRooms
                  .filter((rm) => restrictedRoomIds.has(rm.id))
                  .map((rm) => ({
                    id: rm.id,
                    code: rm.code,
                    label: rm.name,
                  }))}
                onRemove={(roomId) => {
                  const rm = floorRooms.find((r) => r.id === roomId);
                  if (rm) onToggleRoomNoGo(rm);
                }}
                onClearAll={onClearNoGoZones}
                title="Blocked Rooms"
                isDark
              />
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {floorRooms.map((rm) => {
                  const blocked = restrictedRoomIds.has(rm.id);
                  return (
                    <button
                      key={rm.id}
                      type="button"
                      onClick={() => onToggleRoomNoGo(rm)}
                      className={`px-2 py-1 rounded-lg border text-[10px] font-mono cursor-pointer transition-colors ${
                        blocked
                          ? 'bg-rose-600/25 border-rose-400/60 text-rose-200 font-semibold'
                          : 'bg-[#141520] border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                      }`}
                      title={`${blocked ? 'Allow' : 'Restrict'} routing through ${rm.code} · ${rm.name}`}
                    >
                      {blocked ? '× ' : '+ '}
                      {rm.code}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Active No-Go Zones List */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="font-semibold text-zinc-300">
                Active No-Go Zones ({floorNoGoZones.length})
              </span>
              {floorNoGoZones.length > 0 && (
                <button
                  type="button"
                  onClick={onClearNoGoZones}
                  className="text-[10px] text-rose-400 hover:text-rose-300 cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>

            {floorNoGoZones.length === 0 ? (
              <div className="text-[10px] text-zinc-500 py-1.5">
                No exclusion zones defined on this floor. Click above to mark a floor zone or block a room.
              </div>
            ) : (
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {floorNoGoZones.map((z) => (
                  <div
                    key={z.id}
                    className="px-2.5 py-1.5 rounded-lg bg-[#141520] border border-rose-500/30 flex items-center justify-between gap-2 text-[10.5px]"
                  >
                    <div className="min-w-0">
                      <div className="text-zinc-100 font-medium truncate">{z.label}</div>
                      <div className="text-[9.5px] text-zinc-400 font-mono tabular-nums">
                        {z.kind === 'room'
                          ? `Room Block (${z.width?.toFixed(0)}×${z.depth?.toFixed(0)}m)`
                          : `Circle r=${(z.radius ?? 2).toFixed(1)}m @ (${z.x.toFixed(1)}, ${z.z.toFixed(1)})`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveNoGoZone(z.id)}
                      className="p-1 rounded text-zinc-400 hover:text-rose-400 cursor-pointer shrink-0"
                      title="Remove No-Go zone"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
