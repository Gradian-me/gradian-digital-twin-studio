import React, { useEffect, useRef, useState } from 'react';
import { Check, Hexagon, X } from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { SPACE_TYPE_LIBRARY } from '../data/spaceTypes';
import { formatArea, formatLength } from '../utils/spatial';

export const PolygonSpaceNameModal: React.FC = () => {
  const pendingPolygonSpace = useTwinStore((s) => s.pendingPolygonSpace);
  const setPendingPolygonSpace = useTwinStore((s) => s.setPendingPolygonSpace);
  const addPolygonRoom = useTwinStore((s) => s.addPolygonRoom);
  const selectedSpaceTypeId = useTwinStore((s) => s.selectedSpaceTypeId);
  const scene = useTwinStore((s) => s.scene);

  const [name, setName] = useState('');
  const [spaceTypeId, setSpaceTypeId] = useState(selectedSpaceTypeId);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (pendingPolygonSpace) {
      const floorCount = scene.rooms.filter((r) => r.floorId === pendingPolygonSpace.floorId).length;
      setName(`Area ${floorCount + 1}`);
      setSpaceTypeId(selectedSpaceTypeId);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    }
  }, [pendingPolygonSpace?.id]);

  if (!pendingPolygonSpace) return null;

  const allSpaceTypes = [...SPACE_TYPE_LIBRARY, ...scene.customSpaceTypes];

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    addPolygonRoom(pendingPolygonSpace.polygon, name.trim() || 'Named Area', spaceTypeId);
  };

  return (
    <div className="fixed top-[106px] left-1/2 -translate-x-1/2 z-50 w-[440px] max-w-[calc(100vw-2rem)] bg-white dark:bg-[#14141C] border border-emerald-500/60 rounded-xl shadow-2xl p-3.5">
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0">
            <Hexagon className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Enclosed Space Detected ({pendingPolygonSpace.polygon.length}-Point Polygon)
            </div>
            <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
              Area: {formatArea(pendingPolygonSpace.areaSqm, scene.unitSystem)} · Span{' '}
              {formatLength(pendingPolygonSpace.bounds.width, scene.unitSystem, 1)} ×{' '}
              {formatLength(pendingPolygonSpace.bounds.depth, scene.unitSystem, 1)}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPendingPolygonSpace(null)}
          title="Dismiss (you can still click the polygon area anytime)"
          className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-2.5">
        <div className="grid grid-cols-5 gap-2">
          <label className="col-span-3 block">
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 block mb-0.5">
              Space Name
            </span>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Buffer Prep Room, North Corridor..."
              className="w-full h-8 px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="col-span-2 block">
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 block mb-0.5">
              Space Type
            </span>
            <select
              value={spaceTypeId}
              onChange={(e) => setSpaceTypeId(e.target.value)}
              className="w-full h-8 px-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              {allSpaceTypes.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-end gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => setPendingPolygonSpace(null)}
            className="h-8 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            Later
          </button>
          <button
            type="submit"
            className="h-8 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" /> Save Named Area
          </button>
        </div>
      </form>
    </div>
  );
};
