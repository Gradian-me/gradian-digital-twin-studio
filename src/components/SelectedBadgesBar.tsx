import React from 'react';
import { X } from 'lucide-react';

export interface SelectedBadgeItem {
  id: string;
  code?: string;
  label: string;
}

interface SelectedBadgesBarProps {
  items: SelectedBadgeItem[];
  onRemove: (id: string) => void;
  onClearAll?: () => void;
  title?: string;
  maxVisible?: number;
  isDark?: boolean;
}

/**
 * Compact pinned section displayed on top of filterable multi-select search lists
 * so users can review selected items at a glance and click × on any badge to deselect.
 */
export const SelectedBadgesBar: React.FC<SelectedBadgesBarProps> = ({
  items,
  onRemove,
  onClearAll,
  title = 'Selected',
  maxVisible = 24,
  isDark = true,
}) => {
  if (items.length === 0) return null;

  const visible = items.slice(0, maxVisible);
  const overflow = items.length - visible.length;

  return (
    <div
      className={`rounded-xl border px-2.5 py-2 space-y-1.5 ${
        isDark
          ? 'bg-[#171722] border-violet-500/35 text-zinc-100'
          : 'bg-violet-50/70 border-violet-200 text-zinc-900'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-400">
          {title} ({items.length})
        </span>
        {onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-[10px] font-semibold text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-0.5">
        {visible.map((item) => (
          <span
            key={item.id}
            className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md border text-[10.5px] font-medium max-w-[210px] ${
              isDark
                ? 'bg-[#222233] border-violet-500/40 text-violet-100'
                : 'bg-white border-violet-300 text-violet-900'
            }`}
          >
            {item.code && (
              <span className="font-mono text-[10px] font-bold text-violet-400 shrink-0">
                {item.code}
              </span>
            )}
            <span className="truncate">{item.label}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.id);
              }}
              aria-label={`Deselect ${item.code || item.label}`}
              className="p-0.5 rounded hover:bg-rose-500/20 hover:text-rose-400 transition-colors shrink-0 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {overflow > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-zinc-800/80 text-zinc-400 font-mono text-[10px]">
            +{overflow} more
          </span>
        )}
      </div>
    </div>
  );
};
