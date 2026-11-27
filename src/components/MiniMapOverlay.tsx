import React, { useMemo, useRef, useState } from 'react';
import {
  Compass,
  Crosshair,
  GripHorizontal,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';

export const MiniMapOverlay: React.FC = () => {
  const { scene, activeFloorId, selected, theme, firstPersonMode } = useTwinStore();
  const { showMiniMap, setShowMiniMap, jumpFromMiniMap, activeLineHighlight, miniMapTarget } =
    useGmpStore();

  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1280
  );
  // Default offset clears the right-edge vertical LVL / SITE / ALL / L1 / L0 navigation rail
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 74, y: 58 });
  const [draggingWidget, setDraggingWidget] = useState(false);
  const [navDragging, setNavDragging] = useState(false);
  const [hoverWorld, setHoverWorld] = useState<{ x: number; z: number } | null>(null);

  const dragStartRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );
  const svgRef = useRef<SVGSVGElement | null>(null);

  const isDark = theme === 'dark';
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  const activeFloor = useMemo(
    () => scene.floors.find((f) => f.id === activeFloorId) ?? scene.floors[0],
    [scene.floors, activeFloorId]
  );

  const floorRooms = useMemo(
    () => scene.rooms.filter((r) => r.floorId === activeFloor?.id),
    [scene.rooms, activeFloor?.id]
  );
  const floorWalls = useMemo(
    () => scene.walls.filter((w) => w.floorId === activeFloor?.id),
    [scene.walls, activeFloor?.id]
  );
  const floorAssets = useMemo(
    () => scene.assets.filter((a) => a.floorId === activeFloor?.id && !a.hidden),
    [scene.assets, activeFloor?.id]
  );

  const bounds = useMemo(() => {
    const fw = activeFloor?.width ?? 36;
    const fd = activeFloor?.depth ?? 22;
    let minX = 0;
    let minZ = 0;
    let maxX = fw;
    let maxZ = fd;
    floorRooms.forEach((r) => {
      minX = Math.min(minX, r.x);
      minZ = Math.min(minZ, r.z);
      maxX = Math.max(maxX, r.x + r.width);
      maxZ = Math.max(maxZ, r.z + r.depth);
    });
    floorAssets.forEach((a) => {
      minX = Math.min(minX, a.x - 1);
      minZ = Math.min(minZ, a.z - 1);
      maxX = Math.max(maxX, a.x + 1);
      maxZ = Math.max(maxZ, a.z + 1);
    });
    const pad = 1.6;
    return {
      minX: minX - pad,
      minZ: minZ - pad,
      width: Math.max(10, maxX - minX + pad * 2),
      depth: Math.max(10, maxZ - minZ + pad * 2),
    };
  }, [activeFloor, floorRooms, floorAssets]);

  if (!activeFloor || firstPersonMode) return null;

  if (!showMiniMap) {
    return (
      <button
        type="button"
        onClick={() => setShowMiniMap(true)}
        title="Show Birds-Eye Mini-Map"
        className={`absolute bottom-14 right-[74px] z-20 flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold shadow-lg border transition cursor-pointer ${
          isDark
            ? 'bg-[#14141A]/95 border-zinc-700/80 text-zinc-200 hover:border-violet-500/60 hover:text-violet-300'
            : 'bg-white/95 border-slate-200 text-slate-700 hover:border-violet-400 hover:text-violet-700'
        }`}
      >
        <MapIcon className="w-3.5 h-3.5 text-violet-400" />
        <span>Mini-Map</span>
      </button>
    );
  }

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingWidget(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
  };

  const handleHeaderPointerMove = (e: React.PointerEvent) => {
    if (!draggingWidget || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    // Bottom-right anchored offset (keep clear of the 56px right-edge LVL/SITE rail)
    const nextRight = Math.max(72, Math.min(window.innerWidth - 256, dragStartRef.current.origX - dx));
    const nextBottom = Math.max(54, Math.min(window.innerHeight - 230, dragStartRef.current.origY - dy));
    setPos({ x: nextRight, y: nextBottom });
  };

  const handleHeaderPointerUp = (e: React.PointerEvent) => {
    if (!draggingWidget) return;
    setDraggingWidget(false);
    dragStartRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const clientToWorld = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const u = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return {
      x: bounds.minX + u * bounds.width,
      z: bounds.minZ + v * bounds.depth,
    };
  };

  const handleMapPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const w = clientToWorld(e.clientX, e.clientY);
    if (!w) return;
    setNavDragging(true);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    jumpFromMiniMap(w.x, w.z);
  };

  const handleMapPointerMove = (e: React.PointerEvent) => {
    const w = clientToWorld(e.clientX, e.clientY);
    setHoverWorld(w);
    if (navDragging && w) {
      jumpFromMiniMap(w.x, w.z);
    }
  };

  const handleMapPointerUp = (e: React.PointerEvent) => {
    if (!navDragging) return;
    setNavDragging(false);
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const getRoomFill = (roomId: string, baseColor: string) => {
    if (activeLineHighlight) {
      if (activeLineHighlight.failingRoomIds.includes(roomId)) return '#EF4444';
      if (activeLineHighlight.compliantRoomIds.includes(roomId)) {
        return activeLineHighlight.eligible ? '#10B981' : '#34D399';
      }
      return isDark ? '#1F2028' : '#CBD5E1';
    }
    return baseColor || (isDark ? '#272733' : '#94A3B8');
  };

  const getAssetColor = (assetId: string) => {
    if (selectedIds.has(assetId)) return '#F59E0B';
    if (activeLineHighlight) {
      if (activeLineHighlight.failingAssetIds.includes(assetId)) return '#EF4444';
      if (activeLineHighlight.compliantAssetIds.includes(assetId)) return '#10B981';
    }
    return '#8B5CF6';
  };

  return (
    <div
      style={{ right: `${pos.x}px`, bottom: `${pos.y}px` }}
      className={`absolute z-20 select-none rounded-2xl border shadow-2xl transition-shadow ${
        isDark
          ? 'bg-[#111116]/95 border-zinc-700/80 text-zinc-100 shadow-black/60'
          : 'bg-white/95 border-slate-200 text-slate-900 shadow-slate-900/15'
      } ${collapsed ? 'w-44' : 'w-60'}`}
    >
      {/* Draggable Header */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 border-b cursor-grab active:cursor-grabbing ${
          isDark ? 'border-zinc-800 bg-[#17171F] rounded-t-2xl' : 'border-slate-100 bg-slate-50 rounded-t-2xl'
        } ${collapsed ? 'rounded-b-2xl border-b-0' : ''}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <GripHorizontal className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <Compass className="w-3.5 h-3.5 text-violet-400 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider truncate">
            {activeFloor.code} · Mini-Map
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand Mini-Map' : 'Collapse Mini-Map'}
            className={`p-1 rounded-lg transition cursor-pointer ${
              isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
            }`}
          >
            {collapsed ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={() => setShowMiniMap(false)}
            title="Hide Mini-Map"
            className={`p-1 rounded-lg transition cursor-pointer ${
              isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
            }`}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-2">
          <div
            className={`relative rounded-xl overflow-hidden border ${
              isDark ? 'bg-[#09090D] border-zinc-800' : 'bg-slate-100 border-slate-200'
            }`}
          >
            <svg
              ref={svgRef}
              viewBox={`${bounds.minX} ${bounds.minZ} ${bounds.width} ${bounds.depth}`}
              className="w-full h-36 block cursor-crosshair"
              onPointerDown={handleMapPointerDown}
              onPointerMove={handleMapPointerMove}
              onPointerUp={handleMapPointerUp}
              onPointerLeave={() => setHoverWorld(null)}
            >
              {/* Floor slab outline */}
              <rect
                x={0}
                y={0}
                width={activeFloor.width}
                height={activeFloor.depth}
                fill={isDark ? '#121219' : '#FFFFFF'}
                stroke={isDark ? '#3F3F46' : '#CBD5E1'}
                strokeWidth={0.28}
                rx={0.4}
              />

              {/* Rooms */}
              {floorRooms.map((rm) => {
                const isSelected = selectedIds.has(rm.id);
                const fill = getRoomFill(rm.id, rm.color);
                return (
                  <g key={rm.id}>
                    <rect
                      x={rm.x}
                      y={rm.z}
                      width={rm.width}
                      height={rm.depth}
                      fill={fill}
                      fillOpacity={activeLineHighlight ? 0.55 : isDark ? 0.34 : 0.32}
                      stroke={isSelected ? '#F59E0B' : fill}
                      strokeWidth={isSelected ? 0.45 : 0.22}
                      rx={0.2}
                    />
                  </g>
                );
              })}

              {/* Walls */}
              {floorWalls.map((w) => (
                <line
                  key={w.id}
                  x1={w.x1}
                  y1={w.z1}
                  x2={w.x2}
                  y2={w.z2}
                  stroke={isDark ? '#A1A1AA' : '#475569'}
                  strokeWidth={Math.max(0.22, w.thickness * 0.9)}
                  strokeLinecap="round"
                />
              ))}

              {/* Equipment markers */}
              {floorAssets.map((a) => {
                const isSel = selectedIds.has(a.id);
                const c = getAssetColor(a.id);
                return (
                  <g key={a.id}>
                    {isSel && (
                      <circle
                        cx={a.x}
                        cy={a.z}
                        r={1.15}
                        fill="none"
                        stroke="#F59E0B"
                        strokeWidth={0.3}
                      />
                    )}
                    <circle
                      cx={a.x}
                      cy={a.z}
                      r={isSel ? 0.65 : 0.44}
                      fill={c}
                      stroke={isDark ? '#09090D' : '#FFFFFF'}
                      strokeWidth={0.14}
                    />
                  </g>
                );
              })}

              {/* Last jump target crosshair */}
              {miniMapTarget && (
                <g>
                  <circle
                    cx={miniMapTarget.x}
                    cy={miniMapTarget.z}
                    r={1.4}
                    fill="rgba(139, 92, 246, 0.16)"
                    stroke="#A78BFA"
                    strokeWidth={0.28}
                    strokeDasharray="0.5 0.35"
                  />
                  <circle cx={miniMapTarget.x} cy={miniMapTarget.z} r={0.32} fill="#F59E0B" />
                </g>
              )}
            </svg>

            {/* Quick Center Button */}
            <button
              type="button"
              onClick={() => jumpFromMiniMap(activeFloor.width / 2, activeFloor.depth / 2)}
              title="Center on Floor"
              className={`absolute bottom-1.5 right-1.5 p-1 rounded-lg border text-[10px] transition cursor-pointer ${
                isDark
                  ? 'bg-[#17171F]/90 border-zinc-700 text-zinc-300 hover:border-violet-500'
                  : 'bg-white/90 border-slate-200 text-slate-600 hover:border-violet-400'
              }`}
            >
              <Crosshair className="w-3 h-3" />
            </button>
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[10px] px-0.5">
            <span className={isDark ? 'text-zinc-400' : 'text-slate-500'}>
              {hoverWorld
                ? `X ${hoverWorld.x.toFixed(1)}m · Z ${hoverWorld.z.toFixed(1)}m`
                : 'Click / drag to jump 2D & 3D'}
            </span>
            <span className="font-mono text-[9.5px] text-violet-400 font-semibold">
              {floorRooms.length}R · {floorAssets.length}E
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
