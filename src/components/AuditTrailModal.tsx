import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  History,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { triggerFileDownload } from '../utils/spatial';
import type { AuditLogEntry } from '../types/twin';

const CATEGORIES: { id: 'all' | AuditLogEntry['category']; label: string }[] = [
  { id: 'all', label: 'All Events' },
  { id: 'asset', label: 'Equipment' },
  { id: 'wall-opening', label: 'Walls & Doors' },
  { id: 'flow', label: 'Flows' },
  { id: 'camera', label: 'Cameras' },
  { id: 'network-rack', label: 'IT Racks' },
  { id: 'settings', label: 'Settings' },
  { id: 'validation-ai', label: 'AI & Validation' },
  { id: 'save', label: 'Saves' },
];

export const AuditTrailModal: React.FC = () => {
  const showAuditTrailModal = useTwinStore((s) => s.showAuditTrailModal);
  const setShowAuditTrailModal = useTwinStore((s) => s.setShowAuditTrailModal);
  const auditLog = useTwinStore((s) => s.auditLog);
  const clearAuditLog = useTwinStore((s) => s.clearAuditLog);
  const scene = useTwinStore((s) => s.scene);

  const [category, setCategory] = useState<'all' | AuditLogEntry['category']>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return auditLog.filter((e) => {
      if (category !== 'all' && e.category !== category) return false;
      if (!q) return true;
      return (
        e.action.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        (e.entityName ?? '').toLowerCase().includes(q) ||
        e.actor.toLowerCase().includes(q)
      );
    });
  }, [auditLog, category, search]);

  if (!showAuditTrailModal) return null;

  const handleExportJSON = () => {
    triggerFileDownload(
      `${scene.code || 'gradian'}-audit-trail.json`,
      JSON.stringify(auditLog, null, 2),
      'application/json'
    );
  };

  const handleExportCSV = () => {
    const header = 'Timestamp,Actor,Category,Action,Entity,Summary';
    const rows = auditLog.map((e) =>
      [
        e.timestamp,
        `"${e.actor}"`,
        e.category,
        `"${e.action.replace(/"/g, '""')}"`,
        `"${(e.entityName ?? '').replace(/"/g, '""')}"`,
        `"${e.summary.replace(/"/g, '""')}"`,
      ].join(',')
    );
    triggerFileDownload(
      `${scene.code || 'gradian'}-audit-trail.csv`,
      [header, ...rows].join('\n'),
      'text/csv'
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-5xl h-[100dvh] sm:h-[88vh] bg-white dark:bg-[#111116] border-0 sm:border border-zinc-200 dark:border-zinc-800 rounded-none sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-[#0E0E12] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setShowAuditTrailModal(false)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
              Back
            </button>
            <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
              <History className="w-4 h-4 text-violet-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white truncate">
                21 CFR Part 11 Digital Twin Audit Trail ({auditLog.length} entries)
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                Immutable chronological log of every position, wall, door, flow, camera, IT rack, setting &amp; save change
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium"
            >
              <Download className="w-3.5 h-3.5 text-amber-500" />
              CSV
            </button>
            <button
              onClick={handleExportJSON}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium"
            >
              <Download className="w-3.5 h-3.5 text-violet-500" />
              JSON
            </button>
            <button
              onClick={() => setShowAuditTrailModal(false)}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2.5 shrink-0 bg-zinc-50/40 dark:bg-[#13131A]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter audit trail by entity, action, or summary..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-white dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-violet-500"
              />
            </div>
            {auditLog.length > 0 && (
              <button
                onClick={clearAuditLog}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 text-xs font-medium"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Session Log
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  category === cat.id
                    ? 'bg-violet-600 text-white'
                    : 'bg-white dark:bg-[#181820] border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chronological Table */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 space-y-2">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-zinc-500">
              No audit entries recorded for this filter yet. Edit any room, wall, asset, flow, camera, rack, or setting to see live tracking.
            </div>
          ) : (
            filtered.map((entry) => {
              const hasDiff = Boolean(entry.before || entry.after);
              const isExp = expandedId === entry.id;
              return (
                <div
                  key={entry.id}
                  className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#15151C] overflow-hidden"
                >
                  <div
                    onClick={() => hasDiff && setExpandedId(isExp ? null : entry.id)}
                    className={`px-4 py-3 flex items-start justify-between gap-3 ${hasDiff ? 'cursor-pointer hover:bg-zinc-100/70 dark:hover:bg-[#1A1A24]' : ''}`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {hasDiff ? (
                        isExp ? (
                          <ChevronDown className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-400 mt-0.5 shrink-0" />
                        )
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-zinc-400 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded-lg bg-violet-500/15 text-violet-500 font-mono text-[10px] font-semibold uppercase">
                            {entry.category}
                          </span>
                          <span className="text-xs font-semibold text-zinc-900 dark:text-white">
                            {entry.action}
                          </span>
                          {entry.entityName && (
                            <span className="text-[11px] font-mono text-amber-500">
                              {entry.entityName}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {entry.summary}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono text-[10px] text-zinc-500">
                      <div>{new Date(entry.timestamp).toLocaleTimeString()}</div>
                      <div>{entry.actor}</div>
                    </div>
                  </div>

                  {isExp && hasDiff && (
                    <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0F0F14] grid grid-cols-1 sm:grid-cols-2 gap-3 text-[10.5px] font-mono">
                      <div>
                        <div className="text-zinc-500 mb-1">Before</div>
                        <pre className="p-2.5 rounded-xl bg-zinc-100 dark:bg-[#17171F] text-rose-400 overflow-x-auto">
                          {JSON.stringify(entry.before ?? {}, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-zinc-500 mb-1">After</div>
                        <pre className="p-2.5 rounded-xl bg-zinc-100 dark:bg-[#17171F] text-emerald-400 overflow-x-auto">
                          {JSON.stringify(entry.after ?? {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
