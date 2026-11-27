/**
 * Unified, safe React JSX Markdown Renderer (zero dangerouslySetInnerHTML)
 * with full GFM tables (column alignments, CSV export, tabular-nums), callouts,
 * checklists, code blocks, clickable 3D entity chips, and embedded interactive
 * Recharts visualizations (`line`, `bar`, `area`, `pie`, `target`, `composed`).
 *
 * Also exports ready-to-insert Markdown Chart & Table Templates (`MARKDOWN_TEMPLATES`)
 * and a reusable `<MarkdownTemplateToolbar />` for SOP, Wiki, and AI chat authoring.
 */
import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import {
  BarChart3,
  TrendingUp,
  PieChart as PieChartIcon,
  AreaChart as AreaChartIcon,
  Target,
  Table2,
  Compass,
  Download,
  CheckSquare,
  Square,
  FileSpreadsheet,
  Sparkles,
} from 'lucide-react';

export interface MarkdownEntityTarget {
  type: 'room' | 'asset' | 'floor' | 'building' | 'sop';
  id?: string;
  code: string;
  name: string;
  reason?: string;
}

export type EmbeddedChartType = 'line' | 'bar' | 'area' | 'pie' | 'target' | 'composed';

export interface EmbeddedChartSeries {
  key: string;
  label?: string;
  color?: string;
  type?: 'bar' | 'line' | 'area';
}

export interface EmbeddedChartSpec {
  type: EmbeddedChartType;
  title?: string;
  subtitle?: string;
  unit?: string;
  xKey?: string;
  target?: number;
  targetLabel?: string;
  series?: EmbeddedChartSeries[];
  data: Array<Record<string, any>>;
}

const CHART_PALETTE = [
  '#8B5CF6', // violet
  '#06B6D4', // cyan
  '#10B981', // emerald
  '#F59E0B', // amber
  '#F43F5E', // rose
  '#3B82F6', // blue
  '#EC4899', // pink
  '#14B8A6', // teal
];

const NAMED_COLORS: Record<string, string> = {
  violet: '#8B5CF6',
  purple: '#8B5CF6',
  cyan: '#06B6D4',
  emerald: '#10B981',
  green: '#10B981',
  amber: '#F59E0B',
  orange: '#F97316',
  rose: '#F43F5E',
  red: '#EF4444',
  blue: '#3B82F6',
  indigo: '#6366F1',
};

function resolveSeriesColor(color: string | undefined, idx: number): string {
  if (!color) return CHART_PALETTE[idx % CHART_PALETTE.length];
  const lower = color.trim().toLowerCase();
  if (NAMED_COLORS[lower]) return NAMED_COLORS[lower];
  if (/^#[0-9a-f]{3,8}$/i.test(color.trim())) return color.trim();
  return CHART_PALETTE[idx % CHART_PALETTE.length];
}

function tryParseChartSpec(raw: string, hintType?: string): EmbeddedChartSpec | null {
  const cleaned = raw
    .trim()
    // Strip trailing commas before closing brackets/braces for forgiving LLM JSON
    .replace(/,\s*([}\]])/g, '$1');
  if (!cleaned) return null;

  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object') return null;
    const rawData = Array.isArray(parsed.data) ? parsed.data : null;
    if (!rawData || rawData.length === 0) return null;

    const rawType = String(parsed.type ?? parsed.chartType ?? parsed.kind ?? hintType ?? 'bar')
      .toLowerCase()
      .trim();
    const validTypes: EmbeddedChartType[] = ['line', 'bar', 'area', 'pie', 'target', 'composed'];
    const type: EmbeddedChartType = validTypes.includes(rawType as EmbeddedChartType)
      ? (rawType as EmbeddedChartType)
      : rawType === 'donut'
      ? 'pie'
      : rawType === 'kpi'
      ? 'target'
      : 'bar';

    const firstRow = rawData[0] ?? {};
    const keys = Object.keys(firstRow);
    const xKey =
      parsed.xKey ||
      keys.find((k) => ['label', 'name', 'time', 'step', 'period', 'date', 'category', 'room', 'x'].includes(k.toLowerCase())) ||
      keys[0] ||
      'label';

    let series: EmbeddedChartSeries[] | undefined = Array.isArray(parsed.series)
      ? parsed.series
          .filter((s: any) => s && typeof s.key === 'string')
          .map((s: any, idx: number) => ({
            key: s.key,
            label: s.label || s.key,
            color: resolveSeriesColor(s.color, idx),
            type: s.type,
          }))
      : undefined;

    if (!series || series.length === 0) {
      const numericKeys = keys.filter(
        (k) =>
          k !== xKey &&
          k !== 'color' &&
          k !== 'target' &&
          typeof firstRow[k] === 'number'
      );
      if (numericKeys.length > 0) {
        series = numericKeys.map((k, idx) => ({
          key: k,
          label: k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, ' $1'),
          color: CHART_PALETTE[idx % CHART_PALETTE.length],
        }));
      } else {
        series = [{ key: 'value', label: 'Value', color: CHART_PALETTE[0] }];
      }
    }

    return {
      type,
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
      unit: typeof parsed.unit === 'string' ? parsed.unit : '',
      xKey,
      target: typeof parsed.target === 'number' ? parsed.target : undefined,
      targetLabel: typeof parsed.targetLabel === 'string' ? parsed.targetLabel : undefined,
      series,
      data: rawData,
    };
  } catch {
    return null;
  }
}

/**
 * Interactive Recharts Visualization Block rendered inside Markdown
 */
export const EmbeddedMarkdownChart: React.FC<{
  spec: EmbeddedChartSpec;
  isDark?: boolean;
}> = ({ spec, isDark = true }) => {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const xKey = spec.xKey || 'label';
  const unit = spec.unit ? ` ${spec.unit}` : '';
  const series = spec.series && spec.series.length > 0
    ? spec.series
    : [{ key: 'value', label: 'Value', color: CHART_PALETTE[0] }];
  const primaryKey = series[0].key;

  const gridStroke = isDark ? '#272732' : '#E2E8F0';
  const axisTick = isDark ? '#A1A1AA' : '#475569';
  const tooltipStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#14141C' : '#FFFFFF',
    borderColor: isDark ? '#2E2E3E' : '#CBD5E1',
    borderRadius: 10,
    fontSize: 11,
    color: isDark ? '#F4F4F5' : '#0F172A',
    boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
  };

  // Detect per-row target key for Target vs Actual charts
  const hasRowTarget = useMemo(
    () => spec.data.some((d) => typeof d.target === 'number'),
    [spec.data]
  );

  const typeBadgeLabel =
    spec.type === 'line'
      ? 'Trend Line'
      : spec.type === 'area'
      ? 'Area Trend'
      : spec.type === 'pie'
      ? 'Distribution Pie'
      : spec.type === 'target'
      ? 'Target vs Actual'
      : spec.type === 'composed'
      ? 'Combined'
      : 'Comparison Bar';

  const exportCsv = () => {
    const cols = [xKey, ...series.map((s) => s.key), ...(hasRowTarget ? ['target'] : [])];
    const header = cols.join(',');
    const rows = spec.data.map((r) =>
      cols.map((c) => JSON.stringify(r[c] ?? '')).join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(spec.title || 'chart-data').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`my-3 rounded-xl border overflow-hidden ${
        isDark
          ? 'border-zinc-800 bg-[#0F1016] text-zinc-100'
          : 'border-slate-200 bg-white text-slate-900'
      }`}
    >
      {/* Header */}
      <div
        className={`px-3.5 py-2.5 border-b flex items-center justify-between gap-2 flex-wrap ${
          isDark ? 'border-zinc-800/80 bg-[#151620]' : 'border-slate-200 bg-slate-50'
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold truncate">
            <span>{spec.title || 'Analytics Visualization'}</span>
            <span className={`text-[10px] font-mono ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
              · {typeBadgeLabel}
              {spec.unit ? ` (${spec.unit})` : ''}
            </span>
          </div>
          {spec.subtitle && (
            <div className={`text-[11px] truncate mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
              {spec.subtitle}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <div
            className={`flex items-center p-0.5 rounded-lg border ${
              isDark ? 'bg-[#0D0E14] border-zinc-800' : 'bg-white border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setViewMode('chart')}
              className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
                viewMode === 'chart'
                  ? 'bg-violet-600 text-white'
                  : isDark
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Chart
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-violet-600 text-white'
                  : isDark
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Data
            </button>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            title="Download CSV"
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              isDark
                ? 'border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800'
                : 'border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Download className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      {viewMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[11.5px]">
            <thead>
              <tr
                className={
                  isDark
                    ? 'bg-[#171824] text-zinc-300 border-b border-zinc-800'
                    : 'bg-slate-50 text-slate-700 border-b border-slate-200'
                }
              >
                <th className="px-3 py-2 font-semibold">{xKey}</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-2 font-semibold text-right">
                    {s.label || s.key}
                    {spec.unit ? ` (${spec.unit})` : ''}
                  </th>
                ))}
                {hasRowTarget && (
                  <th className="px-3 py-2 font-semibold text-right">
                    Target{spec.unit ? ` (${spec.unit})` : ''}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className={isDark ? 'divide-y divide-zinc-800/60' : 'divide-y divide-slate-100'}>
              {spec.data.map((row, idx) => (
                <tr key={idx} className={isDark ? 'hover:bg-white/[0.02]' : 'hover:bg-slate-50'}>
                  <td className="px-3 py-1.5 font-medium">{String(row[xKey] ?? '')}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {typeof row[s.key] === 'number' ? row[s.key].toLocaleString() : String(row[s.key] ?? '—')}
                    </td>
                  ))}
                  {hasRowTarget && (
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-500">
                      {typeof row.target === 'number' ? row.target.toLocaleString() : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-3">
          <div className="w-full h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              {spec.type === 'pie' ? (
                <PieChart>
                  <Pie
                    data={spec.data}
                    dataKey={primaryKey}
                    nameKey={xKey}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={82}
                    paddingAngle={2.5}
                    stroke={isDark ? '#0F1016' : '#FFFFFF'}
                    strokeWidth={2}
                  >
                    {spec.data.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={resolveSeriesColor(entry.color, idx)}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(val: any) => [`${val}${unit}`, series[0].label || primaryKey]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              ) : spec.type === 'line' ? (
                <LineChart data={spec.data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey={xKey} tick={{ fill: axisTick, fontSize: 10.5 }} stroke={gridStroke} />
                  <YAxis tick={{ fill: axisTick, fontSize: 10.5 }} stroke={gridStroke} width={44} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(val: any, name: any) => [`${val}${unit}`, name]}
                  />
                  {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  {typeof spec.target === 'number' && (
                    <ReferenceLine
                      y={spec.target}
                      stroke="#F59E0B"
                      strokeDasharray="5 4"
                      label={{
                        value: spec.targetLabel || `Target: ${spec.target}${unit}`,
                        position: 'insideTopRight',
                        fill: '#F59E0B',
                        fontSize: 10,
                      }}
                    />
                  )}
                  {series.map((s, idx) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label || s.key}
                      stroke={resolveSeriesColor(s.color, idx)}
                      strokeWidth={2.2}
                      dot={{ r: 3.5, strokeWidth: 1.5 }}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                  {hasRowTarget && (
                    <Line
                      type="monotone"
                      dataKey="target"
                      name="Target"
                      stroke="#F59E0B"
                      strokeDasharray="5 4"
                      strokeWidth={1.8}
                      dot={false}
                    />
                  )}
                </LineChart>
              ) : spec.type === 'area' ? (
                <AreaChart data={spec.data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                  <defs>
                    {series.map((s, idx) => {
                      const col = resolveSeriesColor(s.color, idx);
                      const gid = `md-area-${s.key}-${idx}`;
                      return (
                        <linearGradient key={gid} id={gid} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={col} stopOpacity={0.42} />
                          <stop offset="95%" stopColor={col} stopOpacity={0.03} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey={xKey} tick={{ fill: axisTick, fontSize: 10.5 }} stroke={gridStroke} />
                  <YAxis tick={{ fill: axisTick, fontSize: 10.5 }} stroke={gridStroke} width={44} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(val: any, name: any) => [`${val}${unit}`, name]}
                  />
                  {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  {typeof spec.target === 'number' && (
                    <ReferenceLine
                      y={spec.target}
                      stroke="#F59E0B"
                      strokeDasharray="5 4"
                      label={{
                        value: spec.targetLabel || `Limit: ${spec.target}${unit}`,
                        position: 'insideTopRight',
                        fill: '#F59E0B',
                        fontSize: 10,
                      }}
                    />
                  )}
                  {series.map((s, idx) => {
                    const col = resolveSeriesColor(s.color, idx);
                    return (
                      <Area
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.label || s.key}
                        stroke={col}
                        strokeWidth={2}
                        fill={`url(#md-area-${s.key}-${idx})`}
                      />
                    );
                  })}
                </AreaChart>
              ) : spec.type === 'target' || spec.type === 'composed' ? (
                <ComposedChart data={spec.data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey={xKey} tick={{ fill: axisTick, fontSize: 10.5 }} stroke={gridStroke} />
                  <YAxis tick={{ fill: axisTick, fontSize: 10.5 }} stroke={gridStroke} width={44} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(val: any, name: any) => [`${val}${unit}`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {typeof spec.target === 'number' && (
                    <ReferenceLine
                      y={spec.target}
                      stroke="#F59E0B"
                      strokeDasharray="5 4"
                      label={{
                        value: spec.targetLabel || `Target: ${spec.target}${unit}`,
                        position: 'insideTopRight',
                        fill: '#F59E0B',
                        fontSize: 10,
                      }}
                    />
                  )}
                  {series.map((s, idx) => {
                    const col = resolveSeriesColor(s.color, idx);
                    if (s.type === 'line' || (spec.type === 'composed' && idx > 0)) {
                      return (
                        <Line
                          key={s.key}
                          type="monotone"
                          dataKey={s.key}
                          name={s.label || s.key}
                          stroke={col}
                          strokeWidth={2.2}
                          dot={{ r: 3.5 }}
                        />
                      );
                    }
                    return (
                      <Bar
                        key={s.key}
                        dataKey={s.key}
                        name={s.label || s.key}
                        fill={col}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={38}
                      >
                        {spec.type === 'target' &&
                          spec.data.map((entry, ei) => {
                            const val = Number(entry[s.key] ?? 0);
                            const tgt =
                              typeof entry.target === 'number'
                                ? entry.target
                                : typeof spec.target === 'number'
                                ? spec.target
                                : null;
                            const fill =
                              tgt !== null
                                ? val >= tgt
                                  ? '#10B981'
                                  : val >= tgt * 0.85
                                  ? '#F59E0B'
                                  : '#F43F5E'
                                : resolveSeriesColor(entry.color, ei);
                            return <Cell key={ei} fill={fill} />;
                          })}
                      </Bar>
                    );
                  })}
                  {hasRowTarget && (
                    <Line
                      type="monotone"
                      dataKey="target"
                      name="Target"
                      stroke="#F59E0B"
                      strokeWidth={2.2}
                      strokeDasharray="4 4"
                      dot={{ r: 4, fill: '#F59E0B' }}
                    />
                  )}
                </ComposedChart>
              ) : (
                <BarChart data={spec.data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey={xKey} tick={{ fill: axisTick, fontSize: 10.5 }} stroke={gridStroke} />
                  <YAxis tick={{ fill: axisTick, fontSize: 10.5 }} stroke={gridStroke} width={44} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(val: any, name: any) => [`${val}${unit}`, name]}
                  />
                  {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  {typeof spec.target === 'number' && (
                    <ReferenceLine
                      y={spec.target}
                      stroke="#F59E0B"
                      strokeDasharray="5 4"
                      label={{
                        value: spec.targetLabel || `Target: ${spec.target}${unit}`,
                        position: 'insideTopRight',
                        fill: '#F59E0B',
                        fontSize: 10,
                      }}
                    />
                  )}
                  {series.map((s, idx) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.label || s.key}
                      fill={resolveSeriesColor(s.color, idx)}
                      radius={[6, 6, 0, 0]}
                      maxBarSize={42}
                    >
                      {series.length === 1 &&
                        spec.data.map((entry, ei) => (
                          <Cell
                            key={ei}
                            fill={resolveSeriesColor(entry.color, ei)}
                          />
                        ))}
                    </Bar>
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Target Attainment Summary Strip for Target Charts */}
          {spec.type === 'target' && (hasRowTarget || typeof spec.target === 'number') && (
            <div
              className={`mt-2.5 pt-2 border-t grid grid-cols-2 sm:grid-cols-4 gap-2 ${
                isDark ? 'border-zinc-800/80' : 'border-slate-200'
              }`}
            >
              {spec.data.slice(0, 4).map((row, idx) => {
                const actual = Number(row[primaryKey] ?? 0);
                const tgt = typeof row.target === 'number' ? row.target : spec.target ?? 100;
                const pct = tgt > 0 ? Math.round((actual / tgt) * 100) : 100;
                const statusColor =
                  pct >= 100
                    ? 'text-emerald-400'
                    : pct >= 85
                    ? 'text-amber-400'
                    : 'text-rose-400';
                return (
                  <div key={idx} className="text-[10.5px] min-w-0">
                    <div className={`truncate ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                      {String(row[xKey])}
                    </div>
                    <div className="flex items-baseline gap-1.5 font-mono tabular-nums mt-0.5">
                      <span className="font-semibold">{actual}{unit}</span>
                      <span className={`text-[10px] font-semibold ${statusColor}`}>
                        {pct}% of {tgt}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Parse a GFM pipe table row cleanly while respecting escaped pipes.
 */
function parseTableCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((c) => c.trim());
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  const cells = parseTableCells(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s+/g, '')));
}

function parseTableAlignments(line: string): Array<'left' | 'center' | 'right'> {
  return parseTableCells(line).map((c) => {
    const clean = c.replace(/\s+/g, '');
    if (clean.startsWith(':') && clean.endsWith(':')) return 'center';
    if (clean.endsWith(':')) return 'right';
    return 'left';
  });
}

function renderInlineRich(
  text: string,
  isDark: boolean,
  resolveCodeTarget?: (token: string) => MarkdownEntityTarget | null,
  onJumpEntity?: (ent: MarkdownEntityTarget) => void
): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className={isDark ? 'font-semibold text-white' : 'font-semibold text-slate-950'}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
      return (
        <del key={idx} className="opacity-65">
          {part.slice(2, -2)}
        </del>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2 && !part.startsWith('**')) {
      return (
        <em key={idx} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const token = part.slice(1, -1).trim();
      const matchedTarget = resolveCodeTarget ? resolveCodeTarget(token) : null;
      if (matchedTarget && onJumpEntity) {
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onJumpEntity(matchedTarget)}
            title={`Fly to ${matchedTarget.code} · ${matchedTarget.name} in 3D`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-500/15 hover:bg-violet-600 text-violet-700 dark:text-violet-300 hover:text-white font-mono text-[11px] font-semibold transition-colors cursor-pointer align-baseline"
          >
            <span>{token}</span>
            <Compass className="w-2.5 h-2.5 shrink-0 opacity-80" />
          </button>
        );
      }
      return (
        <code
          key={idx}
          className={`px-1.5 py-0.5 rounded font-mono text-[11px] ${
            isDark ? 'bg-violet-500/18 text-violet-200' : 'bg-violet-100/90 text-violet-800'
          }`}
        >
          {token}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export interface RichMarkdownRendererProps {
  markdown: string;
  isDark?: boolean;
  compact?: boolean;
  resolveCodeTarget?: (token: string) => MarkdownEntityTarget | null;
  onJumpEntity?: (ent: MarkdownEntityTarget) => void;
}

export const RichMarkdownRenderer: React.FC<RichMarkdownRendererProps> = ({
  markdown,
  isDark = true,
  compact = false,
  resolveCodeTarget,
  onJumpEntity,
}) => {
  const blocks = useMemo(() => {
    const lines = (markdown || '').replace(/\r\n/g, '\n').split('\n');
    const out: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const rawLine = lines[i];
      const line = rawLine.trimEnd();
      const trimmed = line.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      // 1. Fenced code block or Embedded Recharts Chart block (```chart, ```chart:line, ```chart:pie, etc.)
      if (trimmed.startsWith('```')) {
        const fenceLang = trimmed.slice(3).trim().toLowerCase();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length && lines[i].trim().startsWith('```')) {
          i++;
        }
        const bodyText = codeLines.join('\n');

        const isChartFence =
          fenceLang === 'chart' ||
          fenceLang.startsWith('chart:') ||
          fenceLang.startsWith('chart-') ||
          (fenceLang === 'json' && /"chartType"|"type"\s*:\s*"(line|bar|area|pie|target|composed)"/.test(bodyText));

        if (isChartFence) {
          const hint = fenceLang.includes(':')
            ? fenceLang.split(':')[1]
            : fenceLang.includes('-')
            ? fenceLang.split('-')[1]
            : undefined;
          const spec = tryParseChartSpec(bodyText, hint);
          if (spec) {
            out.push(<EmbeddedMarkdownChart key={`chart-${i}`} spec={spec} isDark={isDark} />);
            continue;
          }
        }

        out.push(
          <div
            key={`code-${i}`}
            className={`my-2.5 rounded-xl border overflow-hidden ${
              isDark ? 'border-zinc-800 bg-[#0B0C10]' : 'border-slate-200 bg-slate-50'
            }`}
          >
            {fenceLang && (
              <div
                className={`px-3 py-1 text-[10px] font-mono border-b ${
                  isDark
                    ? 'border-zinc-800 bg-[#14151D] text-zinc-400'
                    : 'border-slate-200 bg-slate-100 text-slate-500'
                }`}
              >
                {fenceLang}
              </div>
            )}
            <pre className="p-3 overflow-x-auto text-[11px] font-mono leading-relaxed">
              <code>{bodyText}</code>
            </pre>
          </div>
        );
        continue;
      }

      // 2. GFM Pipe Table (supports leading/trailing pipes or unbordered pipe rows + separator row)
      if (
        trimmed.includes('|') &&
        i + 1 < lines.length &&
        isTableSeparatorLine(lines[i + 1])
      ) {
        const headers = parseTableCells(trimmed);
        const alignments = parseTableAlignments(lines[i + 1]);
        const tableRows: string[][] = [];
        i += 2;
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          lines[i].includes('|') &&
          !lines[i].trim().startsWith('#') &&
          !lines[i].trim().startsWith('```')
        ) {
          tableRows.push(parseTableCells(lines[i]));
          i++;
        }

        const downloadTableCsv = () => {
          const csvLines = [
            headers.map((h) => JSON.stringify(h)).join(','),
            ...tableRows.map((r) =>
              headers.map((_, ci) => JSON.stringify(r[ci] ?? '')).join(',')
            ),
          ];
          const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'markdown-table.csv';
          a.click();
          URL.revokeObjectURL(url);
        };

        out.push(
          <div
            key={`tbl-${i}`}
            className={`my-3 rounded-xl border overflow-hidden ${
              isDark ? 'border-zinc-800 bg-[#0F1016]' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11.5px]">
                <thead>
                  <tr
                    className={
                      isDark
                        ? 'bg-[#171824] text-zinc-200 border-b border-zinc-800'
                        : 'bg-slate-50 text-slate-800 border-b border-slate-200'
                    }
                  >
                    {headers.map((h, hi) => {
                      const align = alignments[hi] ?? 'left';
                      const alignCls =
                        align === 'right'
                          ? 'text-right'
                          : align === 'center'
                          ? 'text-center'
                          : 'text-left';
                      return (
                        <th
                          key={hi}
                          className={`px-3 py-2 font-semibold whitespace-nowrap ${alignCls}`}
                        >
                          {renderInlineRich(h, isDark, resolveCodeTarget, onJumpEntity)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody
                  className={isDark ? 'divide-y divide-zinc-800/60' : 'divide-y divide-slate-100'}
                >
                  {tableRows.map((row, ri) => (
                    <tr
                      key={ri}
                      className={
                        isDark
                          ? 'hover:bg-violet-500/[0.06] transition-colors'
                          : 'hover:bg-slate-50/90 transition-colors'
                      }
                    >
                      {headers.map((_, ci) => {
                        const cell = row[ci] ?? '';
                        const align = alignments[ci] ?? 'left';
                        const isNumericCell = /^[\s±<>≥≤$€%+\-0-9.,°µ/]+$/.test(
                          cell.replace(/`/g, '')
                        );
                        const alignCls =
                          align === 'right'
                            ? 'text-right'
                            : align === 'center'
                            ? 'text-center'
                            : 'text-left';
                        return (
                          <td
                            key={ci}
                            className={`px-3 py-2 align-top ${alignCls} ${
                              isNumericCell ? 'font-mono tabular-nums' : ''
                            } ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}
                          >
                            {renderInlineRich(cell, isDark, resolveCodeTarget, onJumpEntity)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className={`px-3 py-1 border-t flex items-center justify-between text-[10px] ${
                isDark
                  ? 'border-zinc-800/70 bg-[#13141C] text-zinc-500'
                  : 'border-slate-100 bg-slate-50/70 text-slate-400'
              }`}
            >
              <span className="tabular-nums">
                {tableRows.length} rows · {headers.length} columns
              </span>
              <button
                type="button"
                onClick={downloadTableCsv}
                className={`inline-flex items-center gap-1 hover:underline cursor-pointer ${
                  isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <FileSpreadsheet className="w-3 h-3" />
                <span>CSV</span>
              </button>
            </div>
          </div>
        );
        continue;
      }

      // 3. Horizontal rule
      if (/^([-*_]){3,}$/.test(trimmed)) {
        out.push(
          <hr
            key={`hr-${i}`}
            className={`my-3 border-t ${isDark ? 'border-zinc-800' : 'border-slate-200'}`}
          />
        );
        i++;
        continue;
      }

      // 4. Headings (# to ####)
      if (trimmed.startsWith('#### ')) {
        out.push(
          <h4
            key={`h4-${i}`}
            className={`text-xs font-semibold mt-3 mb-1 ${isDark ? 'text-zinc-200' : 'text-slate-800'}`}
          >
            {renderInlineRich(trimmed.slice(5), isDark, resolveCodeTarget, onJumpEntity)}
          </h4>
        );
        i++;
        continue;
      }
      if (trimmed.startsWith('### ')) {
        out.push(
          <h3
            key={`h3-${i}`}
            className={`text-xs font-bold mt-3.5 mb-1 ${
              isDark ? 'text-violet-300' : 'text-violet-700'
            }`}
          >
            {renderInlineRich(trimmed.slice(4), isDark, resolveCodeTarget, onJumpEntity)}
          </h3>
        );
        i++;
        continue;
      }
      if (trimmed.startsWith('## ')) {
        out.push(
          <h2
            key={`h2-${i}`}
            className={`${compact ? 'text-[13px]' : 'text-sm'} font-bold mt-4 mb-1.5 pb-1 border-b ${
              isDark
                ? 'border-zinc-800 text-zinc-100'
                : 'border-slate-200 text-slate-900'
            }`}
          >
            {renderInlineRich(trimmed.slice(3), isDark, resolveCodeTarget, onJumpEntity)}
          </h2>
        );
        i++;
        continue;
      }
      if (trimmed.startsWith('# ')) {
        out.push(
          <h1
            key={`h1-${i}`}
            className={`${compact ? 'text-sm' : 'text-base'} font-bold tracking-tight mt-1 mb-2 ${
              isDark ? 'text-white' : 'text-slate-950'
            }`}
          >
            {renderInlineRich(trimmed.slice(2), isDark, resolveCodeTarget, onJumpEntity)}
          </h1>
        );
        i++;
        continue;
      }

      // 5. Blockquote / Callout (hairline all-around border, zero thick border-l-4)
      if (trimmed.startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        const joined = quoteLines.join(' ');
        const isWarn = /^\[!WARNING\]|^\[!CAUTION\]|warning:|safety:/i.test(joined);
        const cleanQuote = joined.replace(/^\[!(NOTE|WARNING|CAUTION|TIP|IMPORTANT)\]\s*/i, '');
        out.push(
          <blockquote
            key={`bq-${i}`}
            className={`my-2.5 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${
              isWarn
                ? isDark
                  ? 'border-amber-500/35 bg-amber-500/10 text-amber-100'
                  : 'border-amber-300 bg-amber-50 text-amber-950'
                : isDark
                ? 'border-zinc-800 bg-[#151620] text-zinc-300'
                : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}
          >
            {renderInlineRich(cleanQuote, isDark, resolveCodeTarget, onJumpEntity)}
          </blockquote>
        );
        continue;
      }

      // 6. Task Checklist (- [ ] or - [x])
      if (/^[-*]\s+\[[ xX]\]\s+/.test(trimmed)) {
        const items: Array<{ checked: boolean; text: string }> = [];
        while (i < lines.length && /^[-*]\s+\[[ xX]\]\s+/.test(lines[i].trim())) {
          const m = lines[i].trim().match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
          items.push({
            checked: (m?.[1] ?? '').toLowerCase() === 'x',
            text: m?.[2] ?? '',
          });
          i++;
        }
        out.push(
          <div key={`chk-${i}`} className="my-2 space-y-1.5">
            {items.map((it, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs">
                {it.checked ? (
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                )}
                <span
                  className={`leading-relaxed ${
                    it.checked ? 'line-through opacity-65' : ''
                  } ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}
                >
                  {renderInlineRich(it.text, isDark, resolveCodeTarget, onJumpEntity)}
                </span>
              </div>
            ))}
          </div>
        );
        continue;
      }

      // 7. Unordered list
      if (/^[-*•]\s+/.test(trimmed)) {
        const items: string[] = [];
        while (
          i < lines.length &&
          /^[-*•]\s+/.test(lines[i].trim()) &&
          !/^[-*]\s+\[[ xX]\]\s+/.test(lines[i].trim())
        ) {
          items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
          i++;
        }
        out.push(
          <ul key={`ul-${i}`} className="my-1.5 space-y-1 pl-4 list-disc marker:text-violet-500">
            {items.map((it, idx) => (
              <li
                key={idx}
                className={`text-xs leading-relaxed ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}
              >
                {renderInlineRich(it, isDark, resolveCodeTarget, onJumpEntity)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // 8. Ordered list
      if (/^\d+\.\s+/.test(trimmed)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
          i++;
        }
        out.push(
          <ol
            key={`ol-${i}`}
            className="my-1.5 space-y-1 pl-4 list-decimal marker:text-violet-500 marker:font-mono"
          >
            {items.map((it, idx) => (
              <li
                key={idx}
                className={`text-xs leading-relaxed ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}
              >
                {renderInlineRich(it, isDark, resolveCodeTarget, onJumpEntity)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // 9. Standard paragraph
      out.push(
        <p
          key={`p-${i}`}
          className={`text-xs leading-relaxed my-1.5 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}
        >
          {renderInlineRich(trimmed, isDark, resolveCodeTarget, onJumpEntity)}
        </p>
      );
      i++;
    }

    return out;
  }, [markdown, isDark, compact, resolveCodeTarget, onJumpEntity]);

  return <div className="space-y-0.5">{blocks}</div>;
};

/**
 * Ready-to-insert Markdown Templates covering Tables, Trends & Comparisons
 * (Line, Bar, Area, Pie, Target vs Actual, and Full Executive Report).
 */
export interface MarkdownTemplateItem {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  kind: 'line' | 'bar' | 'area' | 'pie' | 'target' | 'table' | 'report';
  markdown: string;
  chatPrompt: string;
}

export const MARKDOWN_TEMPLATES: MarkdownTemplateItem[] = [
  {
    id: 'tpl-line-trend',
    label: 'Line Trend Chart',
    shortLabel: 'Line',
    description: 'Multi-point process or telemetry trend with target threshold',
    kind: 'line',
    chatPrompt:
      'Generate a Markdown report with a line trend chart (`chart:line`) and summary table showing temperature, differential pressure, or batch telemetry trends against target limits.',
    markdown: `
## Process Telemetry Trend
\`\`\`chart:line
{
  "title": "SIP Thermal Sterilization Profile",
  "subtitle": "Vessel Core vs Jacket Temperature across 45-min Cycle",
  "unit": "°C",
  "xKey": "time",
  "target": 121.5,
  "targetLabel": "Min Sterilization 121.5 °C",
  "series": [
    { "key": "coreTemp", "label": "Core Temp", "color": "#8B5CF6" },
    { "key": "jacketTemp", "label": "Jacket Temp", "color": "#06B6D4" }
  ],
  "data": [
    { "time": "0m", "coreTemp": 65.0, "jacketTemp": 72.0 },
    { "time": "10m", "coreTemp": 104.2, "jacketTemp": 112.5 },
    { "time": "20m", "coreTemp": 121.8, "jacketTemp": 124.0 },
    { "time": "30m", "coreTemp": 122.3, "jacketTemp": 124.2 },
    { "time": "40m", "coreTemp": 122.1, "jacketTemp": 123.8 },
    { "time": "45m", "coreTemp": 98.4, "jacketTemp": 91.0 }
  ]
}
\`\`\`
`,
  },
  {
    id: 'tpl-bar-compare',
    label: 'Bar Comparison Chart',
    shortLabel: 'Bar',
    description: 'Side-by-side comparison across rooms, equipment, or suites',
    kind: 'bar',
    chatPrompt:
      'Compare facility rooms or critical equipment power load (kW) and condition scores using a Markdown bar comparison chart (`chart:bar`) and a formatted GFM table.',
    markdown: `
## Equipment Power Load Comparison
\`\`\`chart:bar
{
  "title": "Active Power Draw by Process Asset",
  "subtitle": "Nominal vs Peak kW Load across Production Suite",
  "unit": "kW",
  "xKey": "asset",
  "target": 32,
  "targetLabel": "Breaker Alert 32 kW",
  "series": [
    { "key": "nominal", "label": "Nominal Load", "color": "#06B6D4" },
    { "key": "peak", "label": "Peak Load", "color": "#8B5CF6" }
  ],
  "data": [
    { "asset": "BR-2001", "nominal": 24, "peak": 31 },
    { "asset": "BR-2002", "nominal": 22, "peak": 29 },
    { "asset": "LYO-401", "nominal": 28, "peak": 35 },
    { "asset": "AHU-01", "nominal": 19, "peak": 24 },
    { "asset": "DC-R01", "nominal": 14, "peak": 18 }
  ]
}
\`\`\`
`,
  },
  {
    id: 'tpl-area-trend',
    label: 'Area Trend Chart',
    shortLabel: 'Area',
    description: 'Filled time-series curve for airflow, HVAC load, or cumulative usage',
    kind: 'area',
    chatPrompt:
      'Show cleanroom HVAC airflow (ACH) and differential pressure stability over a 24-hour shift using a Markdown area trend chart (`chart:area`) and summary table.',
    markdown: `
## Cleanroom HVAC Load & Airflow Trend
\`\`\`chart:area
{
  "title": "24h Cleanroom HVAC Supply & Energy Envelope",
  "subtitle": "Grade B Aseptic Core Airflow Stability",
  "unit": "ACH",
  "xKey": "hour",
  "target": 40,
  "targetLabel": "Annex 1 Min 40 ACH",
  "series": [
    { "key": "gradeB", "label": "Grade B Core", "color": "#10B981" },
    { "key": "gradeC", "label": "Grade C Suite", "color": "#06B6D4" }
  ],
  "data": [
    { "hour": "00:00", "gradeB": 44, "gradeC": 24 },
    { "hour": "04:00", "gradeB": 45, "gradeC": 25 },
    { "hour": "08:00", "gradeB": 48, "gradeC": 28 },
    { "hour": "12:00", "gradeB": 49, "gradeC": 29 },
    { "hour": "16:00", "gradeB": 47, "gradeC": 27 },
    { "hour": "20:00", "gradeB": 45, "gradeC": 25 }
  ]
}
\`\`\`
`,
  },
  {
    id: 'tpl-pie-share',
    label: 'Pie Distribution Chart',
    shortLabel: 'Pie',
    description: 'Proportional breakdown by category, zone, or energy share',
    kind: 'pie',
    chatPrompt:
      'Break down facility energy consumption or equipment counts by category using a Markdown pie distribution chart (`chart:pie`) and a structured table.',
    markdown: `
## Facility Energy Share Breakdown
\`\`\`chart:pie
{
  "title": "Facility Electrical Load Share by System",
  "subtitle": "Percentage of Total 1,258 kW Demand",
  "unit": "%",
  "xKey": "segment",
  "series": [{ "key": "share", "label": "Load Share" }],
  "data": [
    { "segment": "HVAC & Cleanroom", "share": 42, "color": "#06B6D4" },
    { "segment": "Bioprocess Skids", "share": 28, "color": "#8B5CF6" },
    { "segment": "Cold Chain & Lyo", "share": 16, "color": "#10B981" },
    { "segment": "IT & Data Center", "share": 10, "color": "#F59E0B" },
    { "segment": "Lighting & Aux", "share": 4, "color": "#F43F5E" }
  ]
}
\`\`\`
`,
  },
  {
    id: 'tpl-target-kpi',
    label: 'Target vs Actual Chart',
    shortLabel: 'Target',
    description: 'KPI attainment against target setpoints with color-coded thresholds',
    kind: 'target',
    chatPrompt:
      'Build a Target vs Actual compliance & KPI attainment chart (`chart:target`) comparing actual performance against GMP setpoints across suites.',
    markdown: `
## GMP Target vs Actual Attainment
\`\`\`chart:target
{
  "title": "Cleanroom Suite Readiness & Target Compliance",
  "subtitle": "Actual Score vs 95% GMP Release Target",
  "unit": "%",
  "xKey": "suite",
  "series": [{ "key": "actual", "label": "Actual Score" }],
  "data": [
    { "suite": "Upstream A0-101", "actual": 98, "target": 95 },
    { "suite": "Aseptic A0-103", "actual": 96, "target": 95 },
    { "suite": "Chrom B0-102", "actual": 88, "target": 95 },
    { "suite": "QC Lab A1-201", "actual": 94, "target": 95 },
    { "suite": "MDF Core A1-204", "actual": 99, "target": 95 }
  ]
}
\`\`\`
`,
  },
  {
    id: 'tpl-table-cpp',
    label: 'CPP Parameter Table',
    shortLabel: 'Table',
    description: 'Aligned GFM specification table with sensor tags and limits',
    kind: 'table',
    chatPrompt:
      'Summarize all critical operating parameters, target setpoints, acceptance limits, and sensor tags in a clean Markdown table.',
    markdown: `
## Critical Process Parameters (CPP)
| Process Step | Target Setpoint | Acceptance Limit | Sensor Tag | Status |
| :--- | :---: | :---: | :---: | ---: |
| **CIP Caustic Wash** | \`0.5 M NaOH @ 65 °C\` | \`62–70 °C × 30 min\` | \`TT-BIO-01\` | Pass |
| **WFI Final Rinse** | \`< 1.3 µS/cm\` | \`TOC < 500 ppb\` | \`CT-CIP-02\` | Pass |
| **SIP Sterilization** | \`121.5 °C @ 1.15 bar\` | \`F0 ≥ 15.0 min\` | \`TT-SIP-CS\` | Pass |
| **pH 2-Point Cal** | \`pH 4.01 & 7.00\` | \`Slope 95–103%\` | \`AT-PH-01\` | Pass |
`,
  },
  {
    id: 'tpl-exec-report',
    label: 'Full Analytics Report',
    shortLabel: 'Full Report',
    description: 'Complete template with Table + Line Trend + Target + Pie charts',
    kind: 'report',
    chatPrompt:
      'Create a full executive GMP facility analytics report in Markdown containing: (1) a formatted comparison table, (2) a trend line chart (`chart:line`), (3) a target vs actual chart (`chart:target`), and (4) a pie distribution chart (`chart:pie`).',
    markdown: `# Facility Performance & GMP Analytics Report

## 1. Executive Parameter Matrix
| Suite / Asset | Metric | Actual | Target | Status |
| :--- | :--- | ---: | ---: | :---: |
| **Upstream Suite** | Batch Yield | \`96.4%\` | \`94.0%\` | On Target |
| **Aseptic Core** | Differential Pressure | \`+45 Pa\` | \`+40 Pa\` | Nominal |
| **MDF Data Center** | PUE Efficiency | \`1.34\` | \`1.40\` | Optimal |

## 2. Trend Comparison (Line)
\`\`\`chart:line
{
  "title": "Weekly Batch Yield vs Target Trend",
  "unit": "%",
  "xKey": "week",
  "target": 94,
  "targetLabel": "Target 94%",
  "series": [
    { "key": "yield", "label": "Batch Yield", "color": "#8B5CF6" },
    { "key": "oee", "label": "Equipment OEE", "color": "#10B981" }
  ],
  "data": [
    { "week": "W1", "yield": 92.4, "oee": 85.0 },
    { "week": "W2", "yield": 94.1, "oee": 87.5 },
    { "week": "W3", "yield": 95.3, "oee": 89.2 },
    { "week": "W4", "yield": 96.4, "oee": 91.0 }
  ]
}
\`\`\`

## 3. Target Attainment & Load Share
\`\`\`chart:target
{
  "title": "Department Compliance vs Target",
  "unit": "%",
  "xKey": "dept",
  "series": [{ "key": "score", "label": "Compliance" }],
  "data": [
    { "dept": "Bioprocess", "score": 97, "target": 95 },
    { "dept": "Fill-Finish", "score": 96, "target": 95 },
    { "dept": "Utilities", "score": 91, "target": 95 },
    { "dept": "IT / OT", "score": 99, "target": 95 }
  ]
}
\`\`\`

\`\`\`chart:pie
{
  "title": "Maintenance Work Order Mix",
  "unit": "%",
  "xKey": "type",
  "series": [{ "key": "pct", "label": "Share" }],
  "data": [
    { "type": "Preventive (PM)", "pct": 54, "color": "#10B981" },
    { "type": "Calibration", "pct": 26, "color": "#06B6D4" },
    { "type": "Qualification", "pct": 14, "color": "#8B5CF6" },
    { "type": "Corrective", "pct": 6, "color": "#F43F5E" }
  ]
}
\`\`\`
`,
  },
];

function templateIcon(kind: MarkdownTemplateItem['kind']) {
  switch (kind) {
    case 'line':
      return <TrendingUp className="w-3 h-3" />;
    case 'bar':
      return <BarChart3 className="w-3 h-3" />;
    case 'area':
      return <AreaChartIcon className="w-3 h-3" />;
    case 'pie':
      return <PieChartIcon className="w-3 h-3" />;
    case 'target':
      return <Target className="w-3 h-3" />;
    case 'table':
      return <Table2 className="w-3 h-3" />;
    default:
      return <Sparkles className="w-3 h-3" />;
  }
}

/**
 * Compact toolbar for inserting Chart & Table Markdown templates into any SOP/Wiki editor
 * or triggering chart-rich AI responses.
 */
export const MarkdownTemplateToolbar: React.FC<{
  onInsert: (snippet: string, template: MarkdownTemplateItem) => void;
  isDark?: boolean;
  label?: string;
}> = ({ onInsert, isDark = true, label = 'Insert Chart / Table:' }) => {
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 px-2.5 py-2 rounded-xl border ${
        isDark
          ? 'bg-[#12131B] border-zinc-800 text-zinc-300'
          : 'bg-slate-50 border-slate-200 text-slate-700'
      }`}
    >
      <span className="text-[10.5px] font-medium opacity-75 mr-1 whitespace-nowrap">{label}</span>
      {MARKDOWN_TEMPLATES.map((tpl) => (
        <button
          key={tpl.id}
          type="button"
          onClick={() => onInsert(tpl.markdown, tpl)}
          title={tpl.description}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
            isDark
              ? 'bg-[#1A1B26] border-zinc-700/80 text-zinc-200 hover:border-violet-500/70 hover:text-white'
              : 'bg-white border-slate-300 text-slate-700 hover:border-violet-500 hover:text-violet-700'
          }`}
        >
          {templateIcon(tpl.kind)}
          <span>{tpl.shortLabel}</span>
        </button>
      ))}
    </div>
  );
};
