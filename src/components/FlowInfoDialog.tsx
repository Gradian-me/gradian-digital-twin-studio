import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Focus,
  Footprints,
  MapPin,
  Pause,
  Play,
  Ruler,
  ShieldCheck,
  Waypoints,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { computeFlowRoomSequence } from '../utils/flowAnalytics';

export const FlowInfoDialog: React.FC = () => {
  const activeFlowInfoId = useTwinStore((s) => s.activeFlowInfoId);
  const setActiveFlowInfoId = useTwinStore((s) => s.setActiveFlowInfoId);
  const scene = useTwinStore((s) => s.scene);
  const showFlows = useTwinStore((s) => s.showFlows);
  const setShowFlows = useTwinStore((s) => s.setShowFlows);
  const isolatedFlowId = useTwinStore((s) => s.isolatedFlowId);
  const isolateFlow = useTwinStore((s) => s.isolateFlow);
  const hiddenFlowIds = useTwinStore((s) => s.hiddenFlowIds);
  const toggleFlowVisibility = useTwinStore((s) => s.toggleFlowVisibility);
  const animateFlows = useTwinStore((s) => s.animateFlows);
  const setAnimateFlows = useTwinStore((s) => s.setAnimateFlows);
  const drillInto = useTwinStore((s) => s.drillInto);
  const walkInsideRoom = useTwinStore((s) => s.walkInsideRoom);

  const flow = useMemo(
    () => (activeFlowInfoId ? scene.flows.find((f) => f.id === activeFlowInfoId) ?? null : null),
    [activeFlowInfoId, scene.flows]
  );

  const floorFlows = useMemo(
    () => (flow ? scene.flows.filter((f) => f.floorId === flow.floorId) : []),
    [flow, scene.flows]
  );

  const analytics = useMemo(
    () => (flow ? computeFlowRoomSequence(flow, scene.rooms) : null),
    [flow, scene.rooms]
  );

  if (!flow || !analytics) return null;

  const floor = scene.floors.find((f) => f.id === flow.floorId);
  const isIsolated = isolatedFlowId === flow.id;
  const isHidden = !showFlows || hiddenFlowIds.includes(flow.id);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[#111117] border border-zinc-800 shadow-[0_28px_80px_rgba(0,0,0,0.8)] overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 bg-[#15151E] flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
              style={{
                backgroundColor: `${flow.color}22`,
                borderColor: `${flow.color}66`,
              }}
            >
              <Waypoints className="w-5 h-5" style={{ color: flow.color }} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-mono uppercase tracking-wider text-zinc-400">
                <span>{floor?.name || 'Active Floor'}</span>
                <span>·</span>
                <span style={{ color: flow.color }} className="font-bold">
                  {flow.flowType} flow
                </span>
                <span>·</span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200">
                  {flow.cleanlinessClass}
                </span>
                {isIsolated && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold">
                    ISOLATED IN VIEWPORT
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold text-white truncate mt-0.5">{flow.name}</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {flow.flowRateLabel || 'Standard Shift'} · {flow.capacityLabel || 'GMP Validated'}
                {flow.restrictions ? ` · ${flow.restrictions}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveFlowInfoId(null)}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer shrink-0"
            title="Close Flow Info Dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Flow Switcher Strip + Viewport Visibility Controls */}
        <div className="px-5 py-2.5 border-b border-zinc-800/80 bg-[#0E0E14] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full">
            {floorFlows.map((fl) => (
              <button
                key={fl.id}
                type="button"
                onClick={() => setActiveFlowInfoId(fl.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-medium whitespace-nowrap border transition-colors cursor-pointer ${
                  fl.id === flow.id
                    ? 'bg-zinc-800 border-violet-500/70 text-white'
                    : 'bg-[#14141C] border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: fl.color }} />
                {fl.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => isolateFlow(flow.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer ${
                isIsolated
                  ? 'bg-amber-500 text-zinc-950'
                  : 'bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 text-zinc-200'
              }`}
            >
              <Focus className="w-3.5 h-3.5" />
              {isIsolated ? 'Exit Isolation' : 'Isolate Flow'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!showFlows) setShowFlows(true);
                else toggleFlowVisibility(flow.id);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-colors cursor-pointer ${
                isHidden
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white'
                  : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              }`}
            >
              {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {isHidden ? 'Hidden' : 'Visible'}
            </button>
            <button
              type="button"
              onClick={() => setAnimateFlows(!animateFlows)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-zinc-800 hover:bg-violet-600 text-zinc-200 transition-colors cursor-pointer"
            >
              {animateFlows ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {animateFlows ? 'Anim On' : 'Static'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* KPI Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-[#171721] border border-zinc-800 p-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Ruler className="w-3.5 h-3.5 text-violet-400" />
                Total Route Length
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-white mt-1">
                {analytics.totalLengthM.toFixed(1)} m
              </div>
              <div className="text-[10.5px] font-mono text-zinc-500">
                {(analytics.totalLengthM * 3.28084).toFixed(0)} ft · {flow.points.length} waypoints
              </div>
            </div>

            <div className="rounded-xl bg-[#171721] border border-zinc-800 p-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                Rooms in Sequence
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-white mt-1">
                {analytics.steps.length}
              </div>
              <div className="text-[10.5px] font-mono text-zinc-500">
                {analytics.uniqueRoomIds.length} unique areas traversed
              </div>
            </div>

            <div className="rounded-xl bg-[#171721] border border-zinc-800 p-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Total Traversed Area
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-white mt-1">
                {analytics.totalTraversedAreaSqm.toFixed(1)} m²
              </div>
              <div className="text-[10.5px] font-mono text-zinc-500">
                {analytics.totalTraversedAreaSqft.toLocaleString()} ft² combined footprint
              </div>
            </div>

            <div className="rounded-xl bg-[#171721] border border-zinc-800 p-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                Est. Transit Time
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-white mt-1">
                {analytics.estimatedTransitSeconds}s
              </div>
              <div className="text-[10.5px] font-mono text-zinc-500">
                Includes airlock transitions
              </div>
            </div>
          </div>

          {/* Visual Horizontal Room Sequence Chain */}
          {analytics.steps.length > 0 && (
            <div className="rounded-xl bg-[#15151E] border border-zinc-800 p-3.5 space-y-2.5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                Ordered Room-by-Room Flow Progression
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {analytics.steps.map((st, idx) => (
                  <React.Fragment key={`${st.roomId}-${st.stepOrder}`}>
                    <button
                      type="button"
                      onClick={() => {
                        drillInto('room', st.roomId);
                        setActiveFlowInfoId(null);
                      }}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[#1C1C28] border border-zinc-700/80 hover:border-violet-400 transition-colors cursor-pointer"
                      title={`Jump to ${st.roomCode} (${st.roomName})`}
                    >
                      <span
                        className="w-5 h-5 rounded-full text-[10px] font-mono font-extrabold flex items-center justify-center text-zinc-950"
                        style={{ backgroundColor: flow.color }}
                      >
                        {String(st.stepOrder).padStart(2, '0')}
                      </span>
                      <div className="text-left">
                        <div className="text-[11px] font-mono font-bold text-white leading-tight">
                          {st.roomCode}
                        </div>
                        <div className="text-[9.5px] text-zinc-400 leading-tight max-w-[115px] truncate">
                          {st.roomName}
                        </div>
                      </div>
                    </button>
                    {idx < analytics.steps.length - 1 && (
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* Pressure Cascade & Contamination Validation Strip */}
          {analytics.pressureWarnings.length > 0 ? (
            <div className="rounded-xl bg-amber-950/35 border border-amber-500/45 p-3.5 space-y-1.5">
              <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Pressure Cascade Advisory ({analytics.pressureWarnings.length})
              </div>
              {analytics.pressureWarnings.map((w, i) => (
                <div key={i} className="text-xs text-amber-200/90 pl-5">
                  • {w}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl bg-emerald-950/30 border border-emerald-500/35 px-3.5 py-2.5 flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Pressure cascade and clean/dirty zoning verified across all {analytics.steps.length} room steps.
            </div>
          )}

          {/* Detailed Ordered Room Numbers & Areas Table */}
          <div className="rounded-xl border border-zinc-800 overflow-hidden bg-[#14141C]">
            <div className="px-4 py-2.5 bg-[#181822] border-b border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                Detailed Room Sequence, Numbers &amp; Areas
              </span>
              <span className="text-[10.5px] font-mono text-zinc-400">
                Ordered along directional flow path
              </span>
            </div>

            {analytics.steps.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-400">
                This flow route currently lies outside defined room polygons on {floor?.name || 'this floor'}. Drag waypoints over rooms to compute room-by-room traversal.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[10px] font-mono uppercase tracking-wider text-zinc-400 bg-[#121218]">
                      <th className="py-2.5 px-3">Order</th>
                      <th className="py-2.5 px-3">Room #</th>
                      <th className="py-2.5 px-3">Area / Space Name</th>
                      <th className="py-2.5 px-3 text-right">Room Area</th>
                      <th className="py-2.5 px-3 text-right">Path In Room</th>
                      <th className="py-2.5 px-3 text-right">Pressure</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {analytics.steps.map((st) => (
                      <tr
                        key={`${st.roomId}-${st.stepOrder}`}
                        className="hover:bg-zinc-800/40 transition-colors"
                      >
                        <td className="py-2.5 px-3 font-mono font-bold tabular-nums">
                          <span
                            className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-[11px] font-extrabold text-zinc-950"
                            style={{ backgroundColor: flow.color }}
                          >
                            {String(st.stepOrder).padStart(2, '0')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-white whitespace-nowrap">
                          {st.roomCode}
                          {st.revisit && (
                            <span className="ml-1.5 text-[9.5px] px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300 font-normal">
                              Re-entry
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-zinc-100">{st.roomName}</div>
                          <div className="text-[10.5px] text-zinc-400">
                            {st.cleanroomGrade} · {st.category}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-bold text-zinc-100">{st.areaSqm.toFixed(1)} m²</div>
                          <div className="text-[10px] text-zinc-500">
                            {st.areaSqft.toLocaleString()} ft²
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-zinc-200">{st.segmentDistanceM.toFixed(1)} m</div>
                          <div className="text-[10px] text-zinc-500">
                            @{st.entryDistanceM.toFixed(1)}m
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-emerald-400 font-semibold">
                            {st.pressurePa >= 0 ? '+' : ''}
                            {st.pressurePa} Pa
                          </div>
                          {st.pressureDeltaFromPrevPa !== null && (
                            <div
                              className={`text-[10px] ${
                                st.pressureDeltaFromPrevPa > 0
                                  ? 'text-cyan-400'
                                  : st.pressureDeltaFromPrevPa < 0
                                    ? 'text-amber-400'
                                    : 'text-zinc-500'
                              }`}
                            >
                              Δ {st.pressureDeltaFromPrevPa >= 0 ? '+' : ''}
                              {st.pressureDeltaFromPrevPa} Pa
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                drillInto('room', st.roomId);
                                setActiveFlowInfoId(null);
                              }}
                              className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-violet-600 text-zinc-200 hover:text-white text-[10.5px] font-semibold cursor-pointer"
                              title={`Focus ${st.roomCode} in 3D`}
                            >
                              Focus
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveFlowInfoId(null);
                                walkInsideRoom(st.roomId);
                              }}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-white hover:text-zinc-950 text-zinc-200 cursor-pointer"
                              title={`Walk Inside ${st.roomCode}`}
                            >
                              <Footprints className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
