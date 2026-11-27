import React, { useMemo, useState } from 'react';
import {
  Lightbulb,
  Plus,
  Power,
  Sparkles,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useMayaStore } from '../store/useMayaStore';
import type {
  LightFixtureType,
  Room,
  RoomLightFixture,
  RoomLightSwitch,
  RoomLightingConfig,
} from '../types/twin';
import {
  LIGHT_FIXTURE_CATALOG,
  getEffectiveRoomLighting,
  getFixtureCatalogItem,
} from '../utils/lighting';

interface LightingDesignerPanelProps {
  /** Optional pre-selected roomId (used when embedded in RightInspector for a specific room) */
  fixedRoomId?: string;
  compact?: boolean;
}

const WALL_SIDES: Array<{ id: RoomLightSwitch['wallSide']; label: string }> = [
  { id: 'north', label: 'North Wall' },
  { id: 'south', label: 'South Wall' },
  { id: 'east', label: 'East Wall' },
  { id: 'west', label: 'West Wall' },
];

/**
 * Interactive Room Lighting & Wall Switch Designer.
 * Lets users add wall switches, add ceiling light fixtures by Light Type, bind each fixture
 * to a related wall switch, position fixtures on an interactive 2D room grid, and test
 * instant room Day/Night lighting toggle in the 3D digital twin.
 */
export const LightingDesignerPanel: React.FC<LightingDesignerPanelProps> = ({
  fixedRoomId,
  compact = false,
}) => {
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const updateRoomLighting = useTwinStore((s) => s.updateRoomLighting);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const showToast = useTwinStore((s) => s.showToast);

  const switchStates = useMayaStore((s) => s.switchStates);
  const roomLights = useMayaStore((s) => s.roomLights);
  const setSwitchState = useMayaStore((s) => s.setSwitchState);

  const floorRooms = useMemo(
    () => scene.rooms.filter((r) => (fixedRoomId ? r.id === fixedRoomId : r.floorId === activeFloorId)),
    [scene.rooms, activeFloorId, fixedRoomId]
  );

  const [pickedRoomId, setPickedRoomId] = useState<string>(
    fixedRoomId || floorRooms[0]?.id || scene.rooms[0]?.id || ''
  );

  const activeRoom: Room | undefined = useMemo(() => {
    if (fixedRoomId) return scene.rooms.find((r) => r.id === fixedRoomId);
    return (
      floorRooms.find((r) => r.id === pickedRoomId) ??
      floorRooms[0] ??
      scene.rooms[0]
    );
  }, [fixedRoomId, floorRooms, pickedRoomId, scene.rooms]);

  // Draft inputs for adding a new fixture or switch
  const [newFixtureType, setNewFixtureType] = useState<LightFixtureType>('led-troffer');
  const [newFixtureLabel, setNewFixtureLabel] = useState('');
  const [newFixtureSwitchId, setNewFixtureSwitchId] = useState('');
  const [newSwitchLabel, setNewSwitchLabel] = useState('');
  const [newSwitchWall, setNewSwitchWall] = useState<RoomLightSwitch['wallSide']>('north');
  const [newSwitchOffset, setNewSwitchOffset] = useState(0.3);

  const lighting: RoomLightingConfig | null = useMemo(() => {
    if (!activeRoom) return null;
    const flOpenings = scene.openings.filter((o) => o.floorId === activeRoom.floorId);
    const flWalls = scene.walls.filter((w) => w.floorId === activeRoom.floorId);
    return getEffectiveRoomLighting(activeRoom, flOpenings, flWalls);
  }, [activeRoom, scene.openings, scene.walls]);

  if (!activeRoom || !lighting) {
    return (
      <div className="p-4 text-xs text-zinc-400">
        No rooms available on this floor yet. Add a room or drop a Smart Room Template first.
      </div>
    );
  }

  const effectiveSelectedSwitchId =
    lighting.switches.some((s) => s.id === newFixtureSwitchId)
      ? newFixtureSwitchId
      : lighting.switches[0]?.id ?? '';

  const saveLighting = (next: RoomLightingConfig) => {
    updateRoomLighting(activeRoom.id, next);
  };

  const getSwitchIsOn = (sw: RoomLightSwitch) => {
    if (switchStates[sw.id] !== undefined) return switchStates[sw.id];
    if (roomLights[activeRoom.id] !== undefined) return roomLights[activeRoom.id];
    return sw.isOn;
  };

  const handleToggleSwitch = (sw: RoomLightSwitch) => {
    const nextOn = !getSwitchIsOn(sw);
    setSwitchState(sw.id, activeRoom.id, nextOn, sw.label, activeRoom.code, activeRoom.name);
    saveLighting({
      ...lighting,
      switches: lighting.switches.map((s) => (s.id === sw.id ? { ...s, isOn: nextOn } : s)),
    });
  };

  const handleAddSwitch = () => {
    const id = `sw-${activeRoom.id}-${Date.now().toString(36).slice(-4)}`;
    const nextSw: RoomLightSwitch = {
      id,
      label: newSwitchLabel.trim() || `${activeRoom.code} Switch ${lighting.switches.length + 1}`,
      wallSide: newSwitchWall,
      offsetRatio: newSwitchOffset,
      heightM: 1.28,
      isOn: true,
      dimmerPct: 100,
    };
    saveLighting({
      ...lighting,
      switches: [...lighting.switches, nextSw],
    });
    setNewSwitchLabel('');
    setNewFixtureSwitchId(id);
    showToast(`Added wall switch "${nextSw.label}" on ${newSwitchWall} wall`, 'success');
  };

  const handleDeleteSwitch = (swId: string) => {
    if (lighting.switches.length <= 1) {
      showToast('Keep at least one wall switch in the room.', 'warning');
      return;
    }
    const remaining = lighting.switches.filter((s) => s.id !== swId);
    const fallbackSw = remaining[0].id;
    saveLighting({
      switches: remaining,
      fixtures: lighting.fixtures.map((f) => (f.switchId === swId ? { ...f, switchId: fallbackSw } : f)),
    });
  };

  const handleAddFixture = (relX = 0.5, relZ = 0.5) => {
    const cat = getFixtureCatalogItem(newFixtureType);
    const nextFix: RoomLightFixture = {
      id: `fix-${activeRoom.id}-${Date.now().toString(36).slice(-4)}`,
      label: newFixtureLabel.trim() || `${cat.shortName} ${lighting.fixtures.length + 1}`,
      type: newFixtureType,
      switchId: effectiveSelectedSwitchId || lighting.switches[0]?.id || '',
      relX: Number(Math.min(0.88, Math.max(0.12, relX)).toFixed(2)),
      relZ: Number(Math.min(0.88, Math.max(0.12, relZ)).toFixed(2)),
      kelvin: cat.defaultKelvin,
      intensity: cat.defaultIntensity,
    };
    saveLighting({
      ...lighting,
      fixtures: [...lighting.fixtures, nextFix],
    });
    setNewFixtureLabel('');
    showToast(`Added ${cat.shortName} linked to wall switch`, 'success');
  };

  const handleUpdateFixture = (id: string, patch: Partial<RoomLightFixture>) => {
    saveLighting({
      ...lighting,
      fixtures: lighting.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  };

  const handleDeleteFixture = (id: string) => {
    saveLighting({
      ...lighting,
      fixtures: lighting.fixtures.filter((f) => f.id !== id),
    });
  };

  const handleUpdateSwitch = (id: string, patch: Partial<RoomLightSwitch>) => {
    saveLighting({
      ...lighting,
      switches: lighting.switches.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  };

  const anyPrimaryOn = lighting.fixtures.some((f) => {
    const cat = getFixtureCatalogItem(f.type);
    const sw = lighting.switches.find((s) => s.id === f.switchId);
    return cat.isPrimaryLight && (sw ? getSwitchIsOn(sw) : true);
  });

  return (
    <div className={`space-y-3 ${compact ? 'text-[11px]' : 'text-xs'}`}>
      {/* Room Selector & Live Day/Night Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!fixedRoomId ? (
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <label className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 shrink-0">
              Room
            </label>
            <select
              value={activeRoom.id}
              onChange={(e) => setPickedRoomId(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-xl bg-zinc-100 dark:bg-[#181823] border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-900 dark:text-white"
            >
              {floorRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.name} ({r.width}×{r.depth}m)
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Lightbulb className={`w-4 h-4 ${anyPrimaryOn ? 'text-amber-400' : 'text-zinc-500'}`} />
            <span className="font-bold text-zinc-900 dark:text-white">
              Lighting &amp; Wall Switches
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <span
            className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border ${
              anyPrimaryOn
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
            }`}
          >
            {anyPrimaryOn ? 'ROOM LIT' : 'ROOM DARK (NIGHT)'}
          </span>
          {!fixedRoomId && (
            <button
              type="button"
              onClick={() => focusEntity({ type: 'room', id: activeRoom.id })}
              className="px-2 py-1 rounded-lg bg-violet-600/15 hover:bg-violet-600 text-violet-400 hover:text-white text-[10.5px] font-semibold transition cursor-pointer"
            >
              Focus 3D
            </button>
          )}
        </div>
      </div>

      {/* Interactive 2D Room Ceiling & Wall-Switch Placement Map */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 p-3 space-y-2">
        <div className="flex items-center justify-between text-[10px] text-zinc-400">
          <span className="font-mono uppercase tracking-wider">
            Interactive Ceiling &amp; Wall Map · Click inside room to drop selected light
          </span>
          <span className="font-mono tabular-nums">
            {activeRoom.width}m × {activeRoom.depth}m
          </span>
        </div>

        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const relZ = (e.clientY - rect.top) / rect.height;
            handleAddFixture(relX, relZ);
          }}
          className={`relative w-full h-36 rounded-xl border-2 cursor-crosshair overflow-hidden transition-colors ${
            anyPrimaryOn
              ? 'bg-[#172033] border-sky-500/45'
              : 'bg-[#08090F] border-zinc-700'
          }`}
          title="Click anywhere inside the room to place the currently selected light fixture type"
        >
          {/* Subtle 25% grid */}
          <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(to_right,#94a3b8_1px,transparent_1px),linear-gradient(to_bottom,#94a3b8_1px,transparent_1px)] bg-[size:25%_25%]" />

          {/* Wall Cardinal Hints */}
          <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[8.5px] font-mono text-zinc-500 pointer-events-none">
            NORTH
          </span>
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8.5px] font-mono text-zinc-500 pointer-events-none">
            SOUTH
          </span>

          {/* Wall Switches on Room Perimeter */}
          {lighting.switches.map((sw) => {
            const isOn = getSwitchIsOn(sw);
            const style: React.CSSProperties =
              sw.wallSide === 'north'
                ? { left: `${sw.offsetRatio * 100}%`, top: '4px', transform: 'translateX(-50%)' }
                : sw.wallSide === 'south'
                  ? { left: `${sw.offsetRatio * 100}%`, bottom: '4px', transform: 'translateX(-50%)' }
                  : sw.wallSide === 'west'
                    ? { top: `${sw.offsetRatio * 100}%`, left: '4px', transform: 'translateY(-50%)' }
                    : { top: `${sw.offsetRatio * 100}%`, right: '4px', transform: 'translateY(-50%)' };
            return (
              <button
                key={sw.id}
                type="button"
                style={style}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleSwitch(sw);
                }}
                className={`absolute z-10 px-1.5 py-0.5 rounded border text-[9px] font-mono font-bold flex items-center gap-1 shadow-md cursor-pointer transition ${
                  isOn
                    ? 'bg-emerald-500 border-emerald-200 text-zinc-950'
                    : 'bg-zinc-800 border-amber-400/70 text-amber-300'
                }`}
                title={`${sw.label} (${sw.wallSide} wall) — Click to toggle ON/OFF`}
              >
                <Power className="w-2.5 h-2.5" />
                SW
              </button>
            );
          })}

          {/* Ceiling Light Fixtures */}
          {lighting.fixtures.map((fix) => {
            const sw = lighting.switches.find((s) => s.id === fix.switchId);
            const isOn = sw ? getSwitchIsOn(sw) : true;
            const cat = getFixtureCatalogItem(fix.type);
            return (
              <div
                key={fix.id}
                style={{
                  left: `${fix.relX * 100}%`,
                  top: `${fix.relZ * 100}%`,
                  transform: 'translate(-50%, -50%)',
                }}
                onClick={(e) => e.stopPropagation()}
                className="absolute flex flex-col items-center pointer-events-none"
              >
                <div
                  className={`rounded-md border transition-all ${
                    fix.type === 'recessed-downlight' || fix.type === 'high-bay'
                      ? 'w-5 h-5 rounded-full'
                      : fix.type === 'linear-vapor' || fix.type === 'uv-c-sterilizer'
                        ? 'w-9 h-2.5'
                        : 'w-8 h-4'
                  }`}
                  style={{
                    backgroundColor: isOn ? cat.emissiveHex : '#27272F',
                    borderColor: isOn ? '#FFFFFF' : '#52525B',
                    boxShadow: isOn ? `0 0 18px ${cat.emissiveHex}` : 'none',
                  }}
                />
                <span className="mt-0.5 text-[8.5px] font-mono text-zinc-300 bg-black/60 px-1 rounded whitespace-nowrap">
                  {fix.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 1: Wall Light Switches (MAYA Interactable) */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#14141C] p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-amber-500">
            Wall Light Switches ({lighting.switches.length})
          </span>
          <span className="text-[10px] text-zinc-500">MAYA presses Enter at switch</span>
        </div>

        <div className="space-y-1.5">
          {lighting.switches.map((sw) => {
            const isOn = getSwitchIsOn(sw);
            const boundCount = lighting.fixtures.filter((f) => f.switchId === sw.id).length;
            return (
              <div
                key={sw.id}
                className="p-2 rounded-xl bg-white dark:bg-[#1A1A25] border border-zinc-200 dark:border-zinc-800 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      value={sw.label}
                      onChange={(e) => handleUpdateSwitch(sw.id, { label: e.target.value })}
                      className="w-full bg-transparent text-xs font-semibold text-zinc-900 dark:text-white focus:outline-none border-b border-transparent focus:border-violet-500"
                    />
                    <div className="text-[10px] text-zinc-500 font-mono">
                      {sw.wallSide.toUpperCase()} wall · {Math.round(sw.offsetRatio * 100)}% · {boundCount} light(s)
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSwitch(sw)}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold flex items-center gap-1 cursor-pointer transition ${
                      isOn
                        ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-400'
                        : 'bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-amber-300'
                    }`}
                  >
                    {isOn ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                    {isOn ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSwitch(sw.id)}
                    className="p-1 rounded-lg text-zinc-400 hover:text-rose-400 cursor-pointer"
                    title="Delete switch"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={sw.wallSide}
                    onChange={(e) =>
                      handleUpdateSwitch(sw.id, { wallSide: e.target.value as RoomLightSwitch['wallSide'] })
                    }
                    className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-[#111118] border border-zinc-200 dark:border-zinc-700 text-[10.5px]"
                  >
                    {WALL_SIDES.map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono">
                    <span>Pos</span>
                    <input
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.02}
                      value={sw.offsetRatio}
                      onChange={(e) =>
                        handleUpdateSwitch(sw.id, { offsetRatio: Number(e.target.value) })
                      }
                      className="flex-1 accent-amber-500"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Switch Row */}
        <div className="pt-1 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            value={newSwitchLabel}
            onChange={(e) => setNewSwitchLabel(e.target.value)}
            placeholder="New switch label (e.g. UV-C Switch)"
            className="flex-1 min-w-[130px] px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#111118] border border-zinc-200 dark:border-zinc-700 text-[11px]"
          />
          <select
            value={newSwitchWall}
            onChange={(e) => setNewSwitchWall(e.target.value as RoomLightSwitch['wallSide'])}
            className="px-2 py-1.5 rounded-lg bg-white dark:bg-[#111118] border border-zinc-200 dark:border-zinc-700 text-[11px]"
          >
            {WALL_SIDES.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={10}
            max={90}
            value={Math.round(newSwitchOffset * 100)}
            onChange={(e) =>
              setNewSwitchOffset(Math.min(0.9, Math.max(0.1, Number(e.target.value) / 100)))
            }
            className="w-14 px-2 py-1.5 rounded-lg bg-white dark:bg-[#111118] border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono tabular-nums"
            title="Offset % along wall"
          />
          <button
            type="button"
            onClick={handleAddSwitch}
            className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Switch
          </button>
        </div>
      </div>

      {/* Section 2: Ceiling Light Fixtures + Related Switch Assignment */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#14141C] p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-sky-400">
            Light Fixtures ({lighting.fixtures.length})
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            {lighting.fixtures.reduce((acc, f) => acc + getFixtureCatalogItem(f.type).watts, 0)} W total
          </span>
        </div>

        {/* Add New Fixture Form */}
        <div className="p-2.5 rounded-xl bg-white dark:bg-[#1A1A25] border border-violet-500/35 space-y-2">
          <div className="text-[10px] font-semibold text-violet-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Add Light &amp; Assign Related Switch
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <select
              value={newFixtureType}
              onChange={(e) => setNewFixtureType(e.target.value as LightFixtureType)}
              className="px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-[#111118] border border-zinc-200 dark:border-zinc-700 text-[11px] font-medium"
            >
              {LIGHT_FIXTURE_CATALOG.map((c) => (
                <option key={c.type} value={c.type}>
                  {c.name} ({c.watts}W)
                </option>
              ))}
            </select>
            <select
              value={effectiveSelectedSwitchId}
              onChange={(e) => setNewFixtureSwitchId(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-[#111118] border border-zinc-200 dark:border-zinc-700 text-[11px] font-medium"
            >
              {lighting.switches.map((sw) => (
                <option key={sw.id} value={sw.id}>
                  Switch: {sw.label} ({sw.wallSide})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newFixtureLabel}
              onChange={(e) => setNewFixtureLabel(e.target.value)}
              placeholder="Optional fixture name..."
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-[#111118] border border-zinc-200 dark:border-zinc-700 text-[11px]"
            />
            <button
              type="button"
              onClick={() => handleAddFixture(0.5, 0.5)}
              className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[11px] flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Light
            </button>
          </div>
        </div>

        {/* Installed Fixtures List */}
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
          {lighting.fixtures.map((fix) => {
            const cat = getFixtureCatalogItem(fix.type);
            const sw = lighting.switches.find((s) => s.id === fix.switchId);
            const isOn = sw ? getSwitchIsOn(sw) : true;
            return (
              <div
                key={fix.id}
                className="p-2 rounded-xl bg-white dark:bg-[#1A1A25] border border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: isOn ? cat.emissiveHex : '#52525B',
                      boxShadow: isOn ? `0 0 8px ${cat.emissiveHex}` : 'none',
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-zinc-900 dark:text-white truncate">
                      {fix.label}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-500">
                      {cat.shortName} · {fix.kelvin}K · ({Math.round(fix.relX * 100)}%,{' '}
                      {Math.round(fix.relZ * 100)}%)
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <select
                    value={fix.type}
                    onChange={(e) =>
                      handleUpdateFixture(fix.id, { type: e.target.value as LightFixtureType })
                    }
                    className="px-1.5 py-1 rounded-lg bg-zinc-100 dark:bg-[#111118] border border-zinc-200 dark:border-zinc-700 text-[10px]"
                    title="Light Type"
                  >
                    {LIGHT_FIXTURE_CATALOG.map((c) => (
                      <option key={c.type} value={c.type}>
                        {c.shortName}
                      </option>
                    ))}
                  </select>
                  <select
                    value={fix.switchId}
                    onChange={(e) => handleUpdateFixture(fix.id, { switchId: e.target.value })}
                    className="px-1.5 py-1 rounded-lg bg-zinc-100 dark:bg-[#111118] border border-zinc-200 dark:border-zinc-700 text-[10px] max-w-[125px]"
                    title="Related Wall Switch"
                  >
                    {lighting.switches.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleDeleteFixture(fix.id)}
                    className="p-1 rounded-lg text-zinc-400 hover:text-rose-400 cursor-pointer"
                    title="Remove light fixture"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
