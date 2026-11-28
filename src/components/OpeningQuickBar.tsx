import React from 'react';
import { AppWindow, ChevronLeft, ChevronRight, DoorOpen, Trash2, X } from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { OPENING_PRESETS } from '../data/materialsLibrary';
import type { OpeningSubtype } from '../types/twin';

interface OpeningQuickBarProps {
  isDark?: boolean;
}

/**
 * Compact inline editor bar rendered whenever a door or window opening is selected
 * in Design Mode (both 2D & 3D), allowing immediate type change, dimensions,
 * wall position sliding, and deletion without hunting through side panels.
 */
export const OpeningQuickBar: React.FC<OpeningQuickBarProps> = ({ isDark = true }) => {
  const scene = useTwinStore((s) => s.scene);
  const selected = useTwinStore((s) => s.selected);
  const workspaceMode = useTwinStore((s) => s.workspaceMode);
  const updateOpening = useTwinStore((s) => s.updateOpening);
  const deleteSelected = useTwinStore((s) => s.deleteSelected);
  const clearSelection = useTwinStore((s) => s.clearSelection);

  if (workspaceMode !== 'design') return null;
  if (selected.length !== 1 || selected[0].type !== 'opening') return null;

  const op = scene.openings.find((o) => o.id === selected[0].id);
  if (!op) return null;

  const hostWall = scene.walls.find((w) => w.id === op.wallId);
  const wallLen = hostWall ? Math.hypot(hostWall.x2 - hostWall.x1, hostWall.z2 - hostWall.z1) : 4;
  const maxW = Math.max(0.6, Number((wallLen - 0.2).toFixed(2)));
  const maxH = Math.max(0.6, Number(((hostWall?.height ?? 3.4) - op.sillHeight - 0.08).toFixed(2)));

  const handleSubtypeChange = (nextSubtype: OpeningSubtype) => {
    const preset = OPENING_PRESETS.find((p) => p.subtype === nextSubtype);
    if (!preset) return;
    updateOpening(op.id, {
      subtype: preset.subtype,
      kind: preset.kind,
      name: preset.name,
      width: preset.width,
      height: preset.height,
      sillHeight: preset.sillHeight,
      swingDirection: preset.swingDirection,
      accessControl: preset.accessControl,
      fireRating: preset.fireRating,
      frameColor: preset.frameColor,
    });
  };

  const nudgePos = (delta: number) => {
    const next = Math.max(0.08, Math.min(0.92, Number((op.offsetRatio + delta).toFixed(3))));
    updateOpening(op.id, { offsetRatio: next });
  };

  const sameKindPresets = OPENING_PRESETS.filter((p) => p.kind === op.kind);
  const otherKindPresets = OPENING_PRESETS.filter((p) => p.kind !== op.kind);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className={`pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl border shadow-2xl text-[11px] max-w-[96vw] ${
        isDark
          ? 'bg-[#14141C] border-violet-500/50 text-zinc-100'
          : 'bg-white border-violet-400 text-zinc-900'
      }`}
    >
      {/* Kind Badge */}
      <div className="flex items-center gap-1 pr-1.5 border-r border-zinc-700/40 shrink-0">
        {op.kind === 'window' ? (
          <AppWindow className="w-3.5 h-3.5 text-sky-400" />
        ) : (
          <DoorOpen className="w-3.5 h-3.5 text-amber-400" />
        )}
        <span className="font-semibold capitalize">{op.kind}</span>
      </div>

      {/* Type selector */}
      <select
        aria-label="Opening Type"
        value={op.subtype}
        onChange={(e) => handleSubtypeChange(e.target.value as OpeningSubtype)}
        className={`h-7 px-1.5 rounded-lg border text-[11px] font-medium max-w-[165px] truncate focus:outline-none focus:border-violet-500 ${
          isDark
            ? 'bg-[#1B1B25] border-zinc-700 text-zinc-100'
            : 'bg-zinc-50 border-zinc-300 text-zinc-900'
        }`}
      >
        <optgroup label={op.kind === 'door' ? 'Door Types' : 'Window Types'}>
          {sameKindPresets.map((p) => (
            <option key={p.subtype} value={p.subtype}>
              {p.name}
            </option>
          ))}
        </optgroup>
        <optgroup label={op.kind === 'door' ? 'Convert to Window' : 'Convert to Door'}>
          {otherKindPresets.map((p) => (
            <option key={p.subtype} value={p.subtype}>
              {p.name}
            </option>
          ))}
        </optgroup>
      </select>

      {/* Size Controls: Width / Height / Sill */}
      <div className="flex items-center gap-1 font-mono tabular-nums">
        <label className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-400">W</span>
          <input
            type="number"
            min={0.5}
            max={maxW}
            step={0.1}
            value={op.width}
            onChange={(e) => updateOpening(op.id, { width: Math.max(0.5, Number(e.target.value) || 0.9) })}
            className={`w-13 h-7 px-1 rounded-lg border text-[11px] text-center ${
              isDark ? 'bg-[#1B1B25] border-zinc-700 text-zinc-100' : 'bg-zinc-50 border-zinc-300 text-zinc-900'
            }`}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-400">H</span>
          <input
            type="number"
            min={0.5}
            max={maxH}
            step={0.1}
            value={op.height}
            onChange={(e) => updateOpening(op.id, { height: Math.max(0.5, Number(e.target.value) || 1.2) })}
            className={`w-13 h-7 px-1 rounded-lg border text-[11px] text-center ${
              isDark ? 'bg-[#1B1B25] border-zinc-700 text-zinc-100' : 'bg-zinc-50 border-zinc-300 text-zinc-900'
            }`}
          />
        </label>
        {op.kind === 'window' && (
          <label className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-400">Sill</span>
            <input
              type="number"
              min={0.1}
              max={Math.max(0.2, Number(((hostWall?.height ?? 3.4) - 0.6).toFixed(2)))}
              step={0.1}
              value={op.sillHeight}
              onChange={(e) => updateOpening(op.id, { sillHeight: Math.max(0, Number(e.target.value) || 0) })}
              className={`w-13 h-7 px-1 rounded-lg border text-[11px] text-center ${
                isDark ? 'bg-[#1B1B25] border-zinc-700 text-zinc-100' : 'bg-zinc-50 border-zinc-300 text-zinc-900'
              }`}
            />
          </label>
        )}
      </div>

      {/* Wall Position Slider + Nudge */}
      <div className="flex items-center gap-1 pl-1 border-l border-zinc-700/40">
        <button
          type="button"
          onClick={() => nudgePos(-0.04)}
          title="Slide left along wall"
          className="h-7 w-6 rounded-lg flex items-center justify-center hover:bg-violet-500/20 text-zinc-400 hover:text-violet-400 cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <input
          type="range"
          aria-label="Position along wall"
          min={0.08}
          max={0.92}
          step={0.01}
          value={op.offsetRatio}
          onChange={(e) => updateOpening(op.id, { offsetRatio: Number(e.target.value) })}
          className="w-16 accent-violet-500 cursor-pointer"
        />
        <button
          type="button"
          onClick={() => nudgePos(0.04)}
          title="Slide right along wall"
          className="h-7 w-6 rounded-lg flex items-center justify-center hover:bg-violet-500/20 text-zinc-400 hover:text-violet-400 cursor-pointer"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <span className="font-mono text-[10px] text-zinc-400 tabular-nums w-8 text-right">
          {Math.round(op.offsetRatio * 100)}%
        </span>
      </div>

      {/* Delete & Close */}
      <div className="flex items-center gap-1 pl-1 border-l border-zinc-700/40">
        <button
          type="button"
          onClick={deleteSelected}
          title={`Delete ${op.kind}`}
          className="h-7 px-2 rounded-lg bg-red-500/15 hover:bg-red-500 text-red-400 hover:text-white font-semibold flex items-center gap-1 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Delete</span>
        </button>
        <button
          type="button"
          onClick={clearSelection}
          title="Deselect"
          className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
