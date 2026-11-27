import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Box,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Columns2,
  Compass,
  Eye,
  Footprints,
  GitBranch,
  Grid2X2,
  Info,
  Layers,
  Loader2,
  MapPin,
  MessageSquarePlus,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Wand2,
  Wind,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { evaluateProductionLine, useGmpStore } from '../store/useGmpStore';
import { getTargetFmeaSummary, useRiskIncidentStore } from '../store/useRiskIncidentStore';
import { OBJECT_LIBRARY } from '../data/objectLibrary';
import { DEFAULT_MATERIALS } from '../data/materialsLibrary';
import { fetchApiJson } from '../utils/safeJson';
import type { ProposedAIAction } from '../types/twin';

interface MayaChartDatum {
  label: string;
  value: number;
  target?: number;
  color?: string;
}

interface MayaChartSpec {
  title: string;
  subtitle?: string;
  kind: 'bar' | 'line' | 'kpi' | string;
  unit?: string;
  data: MayaChartDatum[];
}

interface CreatedOrLinkedEntity {
  type: 'room' | 'asset' | 'floor' | 'building' | 'camera' | 'flow';
  id: string;
  code: string;
  name: string;
  reason?: string;
  floorCode?: string;
}

interface MayaMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  highlightTitle?: string;
  charts?: MayaChartSpec[];
  proposedActions?: ProposedAIAction[];
  navigationTargets?: CreatedOrLinkedEntity[];
  applied?: boolean;
  appliedCount?: number;
  appliedComment?: string;
  createdEntities?: CreatedOrLinkedEntity[];
  followUpSuggestions?: string[];
  modelUsed?: string;
  error?: boolean;
  retryPrompt?: string;
}

type TemplateCategoryId = 'gmp' | 'fmea' | 'assets' | 'rooms';

interface MayaPromptTemplate {
  title: string;
  summary: string;
  prompt: string;
}

const CHART_COLORS: Record<string, string> = {
  violet: '#8B5CF6',
  amber: '#F59E0B',
  emerald: '#10B981',
  cyan: '#06B6D4',
  rose: '#F43F5E',
};

const MAYA_TEMPLATE_GROUPS: {
  id: TemplateCategoryId;
  label: string;
  templates: MayaPromptTemplate[];
}[] = [
  {
    id: 'gmp',
    label: 'GMP',
    templates: [
      {
        title: 'Production Line Eligibility Audit',
        summary: 'Highlight blocked lines on 3D map & draft corrective work orders',
        prompt:
          'Check all production lines for GMP eligibility, highlight blocked lines on the 2D/3D map, cite every blocking room and asset code, and propose corrective work orders.',
      },
      {
        title: 'Overdue Calibrations & OQ/PQ',
        summary: 'Rank overdue GMP cycles and generate prioritized work orders',
        prompt:
          'List all GMP-critical equipment with overdue or due-soon calibration, IQ/OQ/PQ qualification, or preventive maintenance, chart compliance status, and propose prioritized work orders.',
      },
      {
        title: 'EU Annex 1 Pressure Cascade',
        summary: 'Verify Grade A/B/C/D cleanroom differentials across floors',
        prompt:
          'Audit EU GMP Annex 1 Grade A/B/C/D cleanroom pressure cascades across our rooms, flag differential pressure risks, and switch 3D analytics to Pressure Cascade.',
      },
      {
        title: 'Batch Release & SOP Readiness',
        summary: 'Verify SOPs, open work orders, and room readiness before batch start',
        prompt:
          'Review GMP batch release readiness across active production suites: summarize open/overdue work orders, cleanroom room readiness, and blocking equipment with 3D jump targets.',
      },
    ],
  },
  {
    id: 'fmea',
    label: 'FMEA',
    templates: [
      {
        title: 'Top FMEA Risks by RPN (S×O×D)',
        summary: 'Chart highest RPN failure modes and propose CAPA mitigations',
        prompt:
          'Rank the highest RPN FMEA risks across rooms and equipment in a chart and table, explain failure modes and root causes, and recommend CAPA mitigation steps with 3D navigation targets.',
      },
      {
        title: 'Telemetry Alarms & Drift Containment',
        summary: 'Correlate live sensor drifts with FMEA risk priorities',
        prompt:
          'Analyze all live temperature, humidity, and differential pressure telemetry alarms/drifts, map affected rooms and equipment, visualize deviations in a chart, and suggest FMEA containment.',
      },
      {
        title: 'Aseptic Suite HVAC & Contamination FMEA',
        summary: 'Evaluate HEPA failure, pressure loss & airlock interlock breach',
        prompt:
          'Perform a focused GMP FMEA on Grade A and Grade B aseptic suites covering HEPA H14 degradation, ΔP reversal, and airlock interlock failures, citing exact room and asset codes.',
      },
      {
        title: 'Open vs. Mitigated Risk Register',
        summary: 'Track S×O×D risk reduction and next verification actions',
        prompt:
          'Summarize all open, investigating, and mitigated FMEA incidents by severity, occurrence, and detection (RPN), and list the next verification actions for each affected room or asset.',
      },
    ],
  },
  {
    id: 'assets',
    label: 'Assets',
    templates: [
      {
        title: 'Bioreactor & Process Asset Audit',
        summary: 'Locate critical process skids, condition scores & next maintenance',
        prompt:
          'List all GMP-critical bioreactors, lyophilizers, chromatography skids, and filling assets with their room code, operational status, condition score, and next maintenance date.',
      },
      {
        title: 'Energy Load & Condition Breakdown',
        summary: 'Chart equipment kW draw and flag maintenance-due assets',
        prompt:
          'Chart power consumption (kW) and condition scores across equipment on this floor, highlight any standby or maintenance-due assets, and link each one for 3D inspection.',
      },
      {
        title: 'Place 2× 2000L Bioreactors',
        summary: 'Auto-place stainless bioreactors with 1.8m GMP service clearance',
        prompt:
          'Place 2 stainless 2000L Bioreactors with 1.8m GMP service clearance in the Upstream Cell Culture Suite and verify spatial clearances.',
      },
      {
        title: 'IT Racks & SCADA Connectivity Check',
        summary: 'Inspect server racks, OPC UA / SCADA nodes & offline equipment',
        prompt:
          'Locate all IT & Data Center racks, network switches, and SCADA/OPC UA connected equipment across the facility and flag any offline or maintenance-due units.',
      },
    ],
  },
  {
    id: 'rooms',
    label: 'Rooms',
    templates: [
      {
        title: 'Room Area, Grade & Density Table',
        summary: 'Compare rooms by m², cleanroom grade, pressure & asset count',
        prompt:
          'Compare all rooms on the active floor by area (m²), cleanroom grade, pressure (Pa), temperature, and placed equipment count in a table and bar chart.',
      },
      {
        title: 'Room HVAC, AHU & HEPA Audit',
        summary: 'Inspect AHU assignment, ACH airflow & HEPA filter classes',
        prompt:
          'Audit every room HVAC configuration (AHU unit, air changes per hour ACH, HEPA class, differential pressure, and status), chart ACH by room, and flag rooms needing HVAC tuning.',
      },
      {
        title: 'Design New 10×8m QC HPLC Lab',
        summary: 'Add cleanroom QC lab with 3 HPLC benches & area chart',
        prompt:
          'Add a new 10x8m QC HPLC Analytical Lab with 3 HPLC benches without overlapping existing rooms and chart the updated room area breakdown.',
      },
      {
        title: 'Clean Personnel & Material Flows',
        summary: 'Design unidirectional GMP flows & Pressure Cascade overlay',
        prompt:
          'Design clean unidirectional Personnel and Material flow routes connecting our cleanrooms and airlocks, and switch 3D analytics to Pressure Cascade.',
      },
    ],
  },
];

const QUICK_DESIGN_PROMPTS = [
  MAYA_TEMPLATE_GROUPS[0].templates[0].prompt,
  MAYA_TEMPLATE_GROUPS[1].templates[0].prompt,
  MAYA_TEMPLATE_GROUPS[2].templates[0].prompt,
  MAYA_TEMPLATE_GROUPS[3].templates[1].prompt,
];

/**
 * Safe, zero-HTML-injection Markdown renderer supporting headings, bold, inline code
 * (with automatic 1-click 3D navigation when an inline code matches a room/asset/floor code),
 * bullet/numbered lists, and Markdown tables.
 */
function renderInlineTokens(
  text: string,
  resolveCodeTarget?: (token: string) => CreatedOrLinkedEntity | null,
  onJumpEntity?: (ent: CreatedOrLinkedEntity) => void
): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-zinc-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
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
          className="px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-300 font-mono text-[11px]"
        >
          {token}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

const RichMarkdownBlock: React.FC<{
  markdown: string;
  resolveCodeTarget?: (token: string) => CreatedOrLinkedEntity | null;
  onJumpEntity?: (ent: CreatedOrLinkedEntity) => void;
}> = ({ markdown, resolveCodeTarget, onJumpEntity }) => {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    // Markdown Table block
    if (line.startsWith('|') && line.endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const rows = tableLines
        .filter((l) => !/^\|[\s:-]+\|$/.test(l.replace(/\|/g, '|').replace(/\s/g, '')))
        .map((l) =>
          l
            .slice(1, -1)
            .split('|')
            .map((cell) => cell.trim())
        );

      if (rows.length > 0) {
        const [header, ...body] = rows;
        blocks.push(
          <div
            key={`tbl-${i}`}
            className="my-2.5 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#0D0D11]"
          >
            <table className="w-full text-left border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-[#15151C]">
                  {header.map((cell, ci) => (
                    <th key={ci} className="px-3 py-2 font-semibold text-zinc-700 dark:text-zinc-200 whitespace-nowrap">
                      {renderInlineTokens(cell, resolveCodeTarget, onJumpEntity)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                {body.map((row, ri) => (
                  <tr key={ri} className="hover:bg-violet-500/5">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300 font-mono tabular-nums">
                        {renderInlineTokens(cell, resolveCodeTarget, onJumpEntity)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      blocks.push(
        <h4 key={`h3-${i}`} className="text-xs font-bold text-violet-600 dark:text-violet-300 mt-3 mb-1">
          {renderInlineTokens(line.slice(4), resolveCodeTarget, onJumpEntity)}
        </h4>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ') || line.startsWith('# ')) {
      const content = line.replace(/^#+\s+/, '');
      blocks.push(
        <h3 key={`h2-${i}`} className="text-sm font-bold text-zinc-900 dark:text-white mt-3 mb-1.5">
          {renderInlineTokens(content, resolveCodeTarget, onJumpEntity)}
        </h3>
      );
      i++;
      continue;
    }

    // Bullet list
    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="my-1.5 space-y-1 pl-4 list-disc marker:text-violet-500">
          {items.map((it, idx) => (
            <li key={idx} className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              {renderInlineTokens(it, resolveCodeTarget, onJumpEntity)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="my-1.5 space-y-1 pl-4 list-decimal marker:text-amber-500 marker:font-mono">
          {items.map((it, idx) => (
            <li key={idx} className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              {renderInlineTokens(it, resolveCodeTarget, onJumpEntity)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph
    blocks.push(
      <p key={`p-${i}`} className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300 my-1.5">
        {renderInlineTokens(line, resolveCodeTarget, onJumpEntity)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{blocks}</div>;
};

/**
 * Embedded Interactive SVG Visual Chart inside Maya's chat messages
 */
const InlineMayaChart: React.FC<{ chart: MayaChartSpec }> = ({ chart }) => {
  const data = Array.isArray(chart.data) ? chart.data.slice(0, 8) : [];
  if (data.length === 0) return null;

  if (chart.kind === 'kpi') {
    return (
      <div className="my-2.5 p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0D0D11] space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-zinc-900 dark:text-white">{chart.title}</div>
          {chart.subtitle && <span className="text-[10.5px] text-zinc-500">{chart.subtitle}</span>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {data.map((d, idx) => {
            const accent = CHART_COLORS[d.color || ''] ?? (idx % 2 === 0 ? '#8B5CF6' : '#F59E0B');
            return (
              <div
                key={idx}
                className="p-2.5 rounded-xl bg-white dark:bg-[#15151C] border border-zinc-200 dark:border-zinc-800"
              >
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{d.label}</div>
                <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums">
                  <span className="text-base font-bold" style={{ color: accent }}>
                    {Number(d.value).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </span>
                  {chart.unit && <span className="text-[10px] text-zinc-400">{chart.unit}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (chart.kind === 'line' && data.length >= 2) {
    const W = 400;
    const H = 128;
    const padX = 24;
    const padY = 16;
    const vals = data.map((d) => Number(d.value) || 0);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = Math.max(0.01, maxV - minV);

    const pts = data.map((d, idx) => {
      const x = padX + (idx / Math.max(1, data.length - 1)) * (W - padX * 2);
      const y = H - padY - ((Number(d.value) - minV) / span) * (H - padY * 2);
      return { ...d, x, y };
    });
    const pathD = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaD = `${pathD} L${pts[pts.length - 1].x.toFixed(1)},${(H - padY).toFixed(1)} L${pts[0].x.toFixed(1)},${(H - padY).toFixed(1)} Z`;

    return (
      <div className="my-2.5 p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0D0D11] space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-white">
            <BarChart3 className="w-3.5 h-3.5 text-violet-500" />
            <span>{chart.title}</span>
          </div>
          {chart.unit && <span className="text-[10px] font-mono text-amber-500">{chart.unit}</span>}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32">
          <defs>
            <linearGradient id={`maya-line-${chart.title.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaD} fill={`url(#maya-line-${chart.title.replace(/\W/g, '')})`} />
          <path d={pathD} fill="none" stroke="#8B5CF6" strokeWidth={2.2} strokeLinejoin="round" />
          {pts.map((p, idx) => (
            <g key={idx}>
              <circle cx={p.x} cy={p.y} r={3.5} fill="#F59E0B" stroke="#0D0D11" strokeWidth={1.5} />
              <text x={p.x} y={H - 2} textAnchor="middle" className="fill-zinc-500 font-mono text-[8.5px]">
                {p.label.slice(0, 8)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  // Default: Modern Rounded Horizontal Bar Chart
  const maxVal = Math.max(1, ...data.map((d) => Math.abs(Number(d.value) || 0)));
  return (
    <div className="my-2.5 p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0D0D11] space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-white">
          <BarChart3 className="w-3.5 h-3.5 text-violet-500" />
          <span>{chart.title}</span>
        </div>
        {chart.subtitle && <span className="text-[10.5px] text-zinc-500">{chart.subtitle}</span>}
      </div>
      <div className="space-y-2">
        {data.map((d, idx) => {
          const pct = Math.max(6, Math.min(100, (Math.abs(Number(d.value) || 0) / maxVal) * 100));
          const fill = CHART_COLORS[d.color || ''] ?? (idx % 2 === 0 ? '#8B5CF6' : '#F59E0B');
          return (
            <div key={idx} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-700 dark:text-zinc-300 truncate pr-2">{d.label}</span>
                <span className="font-mono tabular-nums font-semibold text-zinc-900 dark:text-white shrink-0">
                  {Number(d.value).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  {chart.unit ? ` ${chart.unit}` : ''}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: fill }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const MayaChatDrawer: React.FC = () => {
  const showMayaChat = useTwinStore((s) => s.showMayaChat);
  const setShowMayaChat = useTwinStore((s) => s.setShowMayaChat);
  const screen = useTwinStore((s) => s.screen);
  const openCinnaGenDemo = useTwinStore((s) => s.openCinnaGenDemo);
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const viewMode = useTwinStore((s) => s.viewMode);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const past = useTwinStore((s) => s.past);
  const undo = useTwinStore((s) => s.undo);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const drillInto = useTwinStore((s) => s.drillInto);
  const walkInsideRoom = useTwinStore((s) => s.walkInsideRoom);
  const openEntityInfo = useTwinStore((s) => s.openEntityInfo);
  const setShowHvacOverlay = useTwinStore((s) => s.setShowHvacOverlay);
  const setShowFlows = useTwinStore((s) => s.setShowFlows);
  const setScreen = useTwinStore((s) => s.setScreen);
  const setPendingAIActions = useTwinStore((s) => s.setPendingAIActions);
  const applyPendingAIActions = useTwinStore((s) => s.applyPendingAIActions);
  const showToast = useTwinStore((s) => s.showToast);

  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const riskIncidents = useRiskIncidentStore((s) => s.incidents);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showTemplatesTray, setShowTemplatesTray] = useState(true);
  const [activeTemplateCategory, setActiveTemplateCategory] = useState<TemplateCategoryId>('gmp');
  const [selectedActionIndicesByMsg, setSelectedActionIndicesByMsg] = useState<Record<string, number[]>>({});
  const [commentByMsg, setCommentByMsg] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<MayaMessage[]>([
    {
      id: 'maya-welcome',
      role: 'assistant',
      highlightTitle: 'Maya · GMP, FMEA & 3D Digital Twin Copilot',
      content:
        'Hi! I am **Maya**, your AI Spatial Architect & GMP Quality Copilot.\n\nChoose a **GMP, FMEA, Asset, or Room** template below — or ask anything in natural language. Every room code, asset tag, and risk target I cite is directly clickable to **fly straight to its exact 3D location** on the digital twin.',
      followUpSuggestions: QUICK_DESIGN_PROMPTS.slice(0, 3),
    },
  ]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (showMayaChat) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [showMayaChat]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const activeFloor = useMemo(
    () => scene.floors.find((f) => f.id === activeFloorId) ?? scene.floors[0],
    [scene.floors, activeFloorId]
  );

  // Fast lookup map for inline backtick entity code navigation
  const codeToEntityMap = useMemo(() => {
    const map = new Map<string, CreatedOrLinkedEntity>();
    const floorCodeById = new Map(scene.floors.map((f) => [f.id, f.code]));

    scene.buildings.forEach((b) => {
      if (b.code) {
        map.set(b.code.toLowerCase(), { type: 'building', id: b.id, code: b.code, name: b.name });
      }
    });
    scene.floors.forEach((f) => {
      if (f.code) {
        map.set(f.code.toLowerCase(), { type: 'floor', id: f.id, code: f.code, name: f.name });
      }
    });
    scene.rooms.forEach((r) => {
      if (r.code) {
        map.set(r.code.toLowerCase(), {
          type: 'room',
          id: r.id,
          code: r.code,
          name: r.name,
          floorCode: floorCodeById.get(r.floorId),
        });
      }
    });
    scene.assets.forEach((a) => {
      if (a.assetId) {
        map.set(a.assetId.toLowerCase(), {
          type: 'asset',
          id: a.id,
          code: a.assetId,
          name: a.name,
          floorCode: floorCodeById.get(a.floorId),
        });
      }
    });
    return map;
  }, [scene.buildings, scene.floors, scene.rooms, scene.assets]);

  const resolveInlineCodeTarget = (token: string): CreatedOrLinkedEntity | null => {
    const clean = token.trim().toLowerCase();
    return codeToEntityMap.get(clean) ?? null;
  };

  const buildSummaries = () => {
    const floorRooms = scene.rooms.filter((r) => r.floorId === activeFloor?.id);
    const floorAssets = scene.assets.filter((a) => a.floorId === activeFloor?.id);
    const floorCodeById = new Map(scene.floors.map((f) => [f.id, f.code]));

    const gmpState = useGmpStore.getState();
    const productionLineSummaries = gmpState.productionLines.map((line) => {
      const ev = evaluateProductionLine(line, scene, gmpState.complianceByAssetId, gmpState.workOrders);
      return {
        id: line.id,
        code: line.code,
        name: line.name,
        productFamily: line.productFamily,
        eligible: ev.eligible,
        blockingCount: ev.blockingCount,
        warningCount: ev.warningCount,
        roomCount: line.roomIds.length,
        assetCount: line.assetIds.length,
        issues: ev.issues.slice(0, 6).map((iss) => ({
          entity: `${iss.entityCode} (${iss.entityName})`,
          reasonType: iss.reasonType,
          severity: iss.severity,
          dueDate: iss.dueDate,
          message: iss.message,
        })),
      };
    });
    const overdueWorkOrders = gmpState.workOrders.filter((w) => w.status === 'overdue');
    const flaggedComplianceAssets = scene.assets
      .map((a) => {
        const rec = gmpState.complianceByAssetId[a.id];
        if (!rec) return null;
        const statuses = [rec.calibration.status, rec.qualification.status, rec.maintenance.status];
        if (!statuses.includes('overdue') && !statuses.includes('due-soon')) return null;
        return {
          id: a.id,
          assetId: a.assetId,
          name: a.name,
          floorCode: floorCodeById.get(a.floorId),
          calibration: rec.calibration.status,
          qualification: `${rec.qualification.stage}:${rec.qualification.status}`,
          maintenance: rec.maintenance.status,
          nextCalibrationDue: rec.calibration.nextDueDate,
        };
      })
      .filter(Boolean)
      .slice(0, 14);

    // Live FMEA & Risk Register summary
    const openIncidents = riskIncidents
      .filter((inc) => inc.status !== 'closed' && inc.status !== 'mitigated')
      .sort((a, b) => b.rpn - a.rpn);
    const fmeaSummary = {
      totalIncidents: riskIncidents.length,
      openCount: openIncidents.length,
      criticalCount: openIncidents.filter((i) => i.rpn >= 200).length,
      highCount: openIncidents.filter((i) => i.rpn >= 100 && i.rpn < 200).length,
      mitigatedCount: riskIncidents.filter(
        (i) => i.status === 'mitigated' || i.status === 'closed'
      ).length,
      topIncidents: [...riskIncidents]
        .sort((a, b) => b.rpn - a.rpn)
        .slice(0, 12)
        .map((i) => ({
          id: i.id,
          code: i.code,
          title: i.title,
          status: i.status,
          kind: i.kind,
          targetKind: i.targetKind,
          targetId: i.targetId,
          targetCode: i.targetCode,
          targetName: i.targetName,
          failureMode: i.failureMode,
          cause: i.cause,
          severity: i.severity,
          occurrence: i.occurrence,
          detection: i.detection,
          rpn: i.rpn,
          owner: i.owner,
        })),
    };

    const facilitySummary = {
      projectName: scene.name,
      industry: scene.industry,
      buildings: scene.buildings.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      floors: scene.floors.map((f) => ({
        id: f.id,
        code: f.code,
        name: f.name,
        buildingId: f.buildingId,
        elevation: f.elevation,
      })),
      activeFloor: activeFloor
        ? {
            id: activeFloor.id,
            name: activeFloor.name,
            code: activeFloor.code,
            width: activeFloor.width,
            depth: activeFloor.depth,
            height: activeFloor.height,
          }
        : null,
      rooms: floorRooms.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        floorId: r.floorId,
        floorCode: floorCodeById.get(r.floorId),
        x: r.x,
        z: r.z,
        width: r.width,
        depth: r.depth,
        grade: r.environmental.cleanroomGrade,
        pressurePa: r.environmental.pressurePa,
        tempC: r.environmental.temperatureC,
        humidityPct: r.environmental.humidityPct,
        hvac: r.environmental.hvac
          ? {
              ahuId: r.environmental.hvac.ahuId,
              ach: r.environmental.hvac.airChangesPerHour,
              hepaClass: r.environmental.hvac.hepaClass,
              status: r.environmental.hvac.status,
            }
          : null,
      })),
      otherFloorRooms: scene.rooms
        .filter((r) => r.floorId !== activeFloor?.id)
        .slice(0, 24)
        .map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          floorCode: floorCodeById.get(r.floorId),
          grade: r.environmental.cleanroomGrade,
          pressurePa: r.environmental.pressurePa,
          hvacAhu: r.environmental.hvac?.ahuId ?? null,
        })),
      assetsCount: scene.assets.length,
      assets: floorAssets.slice(0, 32).map((a) => ({
        id: a.id,
        assetId: a.assetId,
        name: a.name,
        category: a.category,
        templateId: a.templateId,
        roomId: a.roomId,
        floorCode: floorCodeById.get(a.floorId),
        operationalStatus: a.operationalStatus,
        criticality: a.criticality,
        energyKw: a.energyKw,
        conditionScore: a.conditionScore,
        nextMaintenance: a.nextMaintenance,
        protocol: a.connectivity?.protocol ?? 'None',
        x: a.x,
        z: a.z,
      })),
      otherFloorCriticalAssets: scene.assets
        .filter((a) => a.floorId !== activeFloor?.id)
        .slice(0, 20)
        .map((a) => ({
          id: a.id,
          assetId: a.assetId,
          name: a.name,
          category: a.category,
          floorCode: floorCodeById.get(a.floorId),
          operationalStatus: a.operationalStatus,
          criticality: a.criticality,
        })),
      gmpCompliance: {
        productionLines: productionLineSummaries,
        overdueWorkOrdersCount: overdueWorkOrders.length,
        overdueWorkOrders: overdueWorkOrders.slice(0, 8).map((w) => ({
          woNumber: w.woNumber,
          title: w.title,
          target: w.targetName,
          serviceType: w.serviceType,
          dueDate: w.dueDate,
          assignee: w.assigneeName,
        })),
        flaggedComplianceAssets,
        activeSopsCount: gmpState.sops.length,
      },
      fmeaSummary,
      availableMaterials: DEFAULT_MATERIALS.slice(0, 18).map((m) => ({ id: m.id, name: m.name })),
      availableEquipment: OBJECT_LIBRARY.slice(0, 24).map((e) => ({ id: e.id, name: e.name, category: e.category })),
    };

    const alarmSensors = sensors.filter((s) => readings[s.id]?.status === 'alarm');
    const warnSensors = sensors.filter((s) => readings[s.id]?.status === 'warning');
    const telemetrySummary = {
      totalSensors: sensors.length,
      alarmCount: alarmSensors.length,
      warningCount: warnSensors.length,
      flaggedSensors: [...alarmSensors, ...warnSensors].slice(0, 12).map((s) => ({
        tag: s.tag,
        targetId: s.targetId,
        target: s.targetName,
        value: readings[s.id]?.value ?? s.nominal,
        unit: s.unit,
        status: readings[s.id]?.status ?? 'nominal',
      })),
    };

    return { facilitySummary, telemetrySummary };
  };

  const sendMessage = async (textOverride?: string) => {
    const prompt = (textOverride ?? input).trim();
    if (!prompt || loading) return;

    if (!textOverride) setInput('');
    setShowTemplatesTray(false);

    const userMsg: MayaMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: prompt,
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setLoading(true);

    try {
      const { facilitySummary, telemetrySummary } = buildSummaries();
      const data = await fetchApiJson<any>(
        '/api/maya-chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: prompt,
            history: nextHistory.slice(-6).map((m) => ({ role: m.role, content: m.content })),
            facilitySummary,
            telemetrySummary,
          }),
        },
        'Maya is momentarily busy. Please click Retry.'
      );

      const rawNavTargets: CreatedOrLinkedEntity[] = Array.isArray(data.navigationTargets)
        ? data.navigationTargets
            .filter((t: any) => t && (t.id || t.code || t.name))
            .map((t: any) => ({
              type:
                t.type === 'asset' || t.type === 'floor' || t.type === 'building'
                  ? t.type
                  : 'room',
              id: String(t.id ?? ''),
              code: String(t.code ?? ''),
              name: String(t.name ?? ''),
              reason: t.reason ? String(t.reason) : undefined,
            }))
        : [];

      const assistantMsg: MayaMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        highlightTitle: data.highlightTitle,
        content: data.markdown || data.explanation || 'Analysis ready.',
        charts: Array.isArray(data.charts) ? data.charts : [],
        proposedActions: Array.isArray(data.proposedActions) ? data.proposedActions : [],
        navigationTargets: rawNavTargets,
        followUpSuggestions: Array.isArray(data.followUpSuggestions) ? data.followUpSuggestions : [],
        modelUsed: data.modelUsed,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: err?.message || 'Maya could not reach the AI model right now. Please retry.',
          error: true,
          retryPrompt: prompt,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Accurate 3D Digital Twin Navigation from Maya AI:
   * - Resolves rooms, assets, floors, or buildings across the entire multi-building campus
   * - Switches out of Hub/2D into 3D Perspective (or keeps Split Map when open on desktop)
   * - Uses building-local elevation coordinates via drillInto/focusEntity so Building B & upper floors frame dead-center
   * - Re-triggers camera flight after 1 animation frame when freshly mounting Viewport3D
   */
  const jumpToEntityIn3D = (entity: CreatedOrLinkedEntity, closeDrawer = true) => {
    const wasInHub = screen === 'hub';
    const wasIn2D = viewMode === '2d';

    if (wasInHub) {
      openCinnaGenDemo();
    } else {
      setScreen('workspace');
    }

    const targetViewMode = !closeDrawer && viewMode === 'split' ? 'split' : '3d-perspective';
    setViewMode(targetViewMode);

    const executeFocus = () => {
      const latestScene = useTwinStore.getState().scene;
      const codeLc = (entity.code || '').trim().toLowerCase();
      const nameLc = (entity.name || '').trim().toLowerCase();

      if (entity.type === 'building') {
        const bldg = latestScene.buildings.find(
          (b) => b.id === entity.id || (codeLc && b.code.toLowerCase() === codeLc) || b.name.toLowerCase() === nameLc
        );
        if (bldg) {
          drillInto('building', bldg.id);
          return `Building ${bldg.code} · ${bldg.name}`;
        }
      }

      if (entity.type === 'floor') {
        const fl = latestScene.floors.find(
          (f) => f.id === entity.id || (codeLc && f.code.toLowerCase() === codeLc) || f.name.toLowerCase() === nameLc
        );
        if (fl) {
          drillInto('floor', fl.id);
          return `Floor ${fl.code} · ${fl.name}`;
        }
      }

      if (entity.type === 'room') {
        const rm = latestScene.rooms.find(
          (r) =>
            r.id === entity.id ||
            (codeLc && r.code.toLowerCase() === codeLc) ||
            (nameLc.length >= 4 && r.name.toLowerCase() === nameLc)
        );
        if (rm) {
          focusEntity({ type: 'room', id: rm.id });
          const fl = latestScene.floors.find((f) => f.id === rm.floorId);
          return `Room ${rm.code} · ${rm.name}${fl ? ` (${fl.code})` : ''}`;
        }
      }

      if (entity.type === 'asset') {
        const a = latestScene.assets.find(
          (x) =>
            x.id === entity.id ||
            (codeLc && x.assetId.toLowerCase() === codeLc) ||
            (nameLc.length >= 4 && x.name.toLowerCase() === nameLc)
        );
        if (a) {
          focusEntity({ type: 'asset', id: a.id });
          const fl = latestScene.floors.find((f) => f.id === a.floorId);
          return `${a.assetId} · ${a.name}${fl ? ` (${fl.code})` : ''}`;
        }
      }

      // Cross-type fallback in case AI tagged a room as asset or vice-versa
      const fallbackRoom = latestScene.rooms.find(
        (r) => r.id === entity.id || (codeLc && r.code.toLowerCase() === codeLc)
      );
      if (fallbackRoom) {
        focusEntity({ type: 'room', id: fallbackRoom.id });
        return `Room ${fallbackRoom.code} · ${fallbackRoom.name}`;
      }
      const fallbackAsset = latestScene.assets.find(
        (a) => a.id === entity.id || (codeLc && a.assetId.toLowerCase() === codeLc)
      );
      if (fallbackAsset) {
        focusEntity({ type: 'asset', id: fallbackAsset.id });
        return `${fallbackAsset.assetId} · ${fallbackAsset.name}`;
      }
      return null;
    };

    const label = executeFocus();
    if (wasInHub || wasIn2D) {
      // Ensure freshly mounted Viewport3D receives the camera flight cleanly
      requestAnimationFrame(() => {
        setTimeout(() => {
          executeFocus();
        }, 80);
      });
    }

    if (closeDrawer) setShowMayaChat(false);
    if (label) {
      showToast(`3D Focus: ${label}`, 'info');
    }
  };

  const handleWalkIntoRoom = (roomId: string) => {
    if (screen === 'hub') openCinnaGenDemo();
    else setScreen('workspace');
    setViewMode('3d-perspective');
    setShowMayaChat(false);
    walkInsideRoom(roomId);
  };

  const findReferencedEntitiesInMessage = (msg: MayaMessage): CreatedOrLinkedEntity[] => {
    const found: CreatedOrLinkedEntity[] = [];
    const seen = new Set<string>();
    const floorCodeById = new Map(scene.floors.map((f) => [f.id, f.code]));

    const pushIfNew = (ent: CreatedOrLinkedEntity) => {
      // Canonicalize against live scene so IDs, codes, and floor badges are always exact
      const codeLc = (ent.code || '').trim().toLowerCase();
      if (ent.type === 'room') {
        const rm = scene.rooms.find((r) => r.id === ent.id || (codeLc && r.code.toLowerCase() === codeLc));
        if (!rm) return;
        const key = `room:${rm.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        found.push({
          type: 'room',
          id: rm.id,
          code: rm.code,
          name: rm.name,
          reason: ent.reason,
          floorCode: floorCodeById.get(rm.floorId),
        });
        return;
      }
      if (ent.type === 'asset') {
        const a = scene.assets.find((x) => x.id === ent.id || (codeLc && x.assetId.toLowerCase() === codeLc));
        if (!a) return;
        const key = `asset:${a.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        found.push({
          type: 'asset',
          id: a.id,
          code: a.assetId,
          name: a.name,
          reason: ent.reason,
          floorCode: floorCodeById.get(a.floorId),
        });
        return;
      }
      if (ent.type === 'floor') {
        const fl = scene.floors.find((f) => f.id === ent.id || (codeLc && f.code.toLowerCase() === codeLc));
        if (!fl) return;
        const key = `floor:${fl.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        found.push({ type: 'floor', id: fl.id, code: fl.code, name: fl.name, reason: ent.reason });
        return;
      }
      if (ent.type === 'building') {
        const b = scene.buildings.find((x) => x.id === ent.id || (codeLc && x.code.toLowerCase() === codeLc));
        if (!b) return;
        const key = `building:${b.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        found.push({ type: 'building', id: b.id, code: b.code, name: b.name, reason: ent.reason });
      }
    };

    // 1. Newly created entities first
    (msg.createdEntities ?? []).forEach(pushIfNew);

    // 2. Explicit structured navigationTargets from Maya
    (msg.navigationTargets ?? []).forEach(pushIfNew);

    // 3. Match any scene rooms, assets, or floors mentioned in content or proposedActions
    const haystack = [
      msg.content,
      ...(msg.proposedActions ?? []).map((a) => `${a.title} ${a.details} ${(a.entityIds ?? []).join(' ')}`),
    ]
      .join(' ')
      .toLowerCase();

    for (const r of scene.rooms) {
      if (
        (r.code && haystack.includes(r.code.toLowerCase())) ||
        (r.name && r.name.length >= 5 && haystack.includes(r.name.toLowerCase()))
      ) {
        pushIfNew({ type: 'room', id: r.id, code: r.code, name: r.name });
      }
    }
    for (const a of scene.assets) {
      if (
        (a.assetId && haystack.includes(a.assetId.toLowerCase())) ||
        (a.name && a.name.length >= 5 && haystack.includes(a.name.toLowerCase()))
      ) {
        pushIfNew({ type: 'asset', id: a.id, code: a.assetId, name: a.name });
      }
    }
    return found.slice(0, 10);
  };

  const getSelectedIndices = (msgId: string, total: number): number[] => {
    const saved = selectedActionIndicesByMsg[msgId];
    if (saved) return saved.filter((i) => i >= 0 && i < total);
    return Array.from({ length: total }, (_, i) => i);
  };

  const toggleActionSelection = (msgId: string, idx: number, total: number) => {
    const current = getSelectedIndices(msgId, total);
    const next = current.includes(idx)
      ? current.filter((i) => i !== idx)
      : [...current, idx].sort((a, b) => a - b);
    setSelectedActionIndicesByMsg((prev) => ({ ...prev, [msgId]: next }));
  };

  const handleApplyActions = (msgId: string, allActions: ProposedAIAction[]) => {
    const selectedIdxs = getSelectedIndices(msgId, allActions.length);
    const actions = selectedIdxs.map((i) => allActions[i]).filter(Boolean);
    if (actions.length === 0) {
      showToast('Select at least one proposed action from the checklist before applying', 'warning');
      return;
    }

    const customComment = (commentByMsg[msgId] ?? '').trim();

    if (screen === 'hub') {
      openCinnaGenDemo();
    }
    const gmpStore = useGmpStore.getState();
    const spatialActions: ProposedAIAction[] = [];
    let gmpAppliedCount = 0;
    const createdOrTouched: CreatedOrLinkedEntity[] = [];

    for (const act of actions) {
      if (act.type === 'highlight_production_line') {
        const targetLine =
          gmpStore.productionLines.find(
            (l) => l.id === act.lineId || l.code.toLowerCase() === (act.lineId || '').toLowerCase()
          ) ?? gmpStore.productionLines[0];
        if (targetLine) {
          const ev = gmpStore.checkLineEligibility(targetLine.id, scene, true);
          if (ev) {
            gmpAppliedCount++;
            const firstRoom = scene.rooms.find((r) => targetLine.roomIds.includes(r.id));
            if (firstRoom) {
              createdOrTouched.push({ type: 'room', id: firstRoom.id, code: firstRoom.code, name: firstRoom.name });
            }
            showToast(
              `${ev.lineName}: ${ev.eligible ? 'ELIGIBLE (Highlighted Green)' : `NOT ELIGIBLE — ${ev.blockingCount} blocker(s) (Highlighted Red)`}`,
              ev.eligible ? 'success' : 'error'
            );
          }
        }
      } else if (act.type === 'create_work_order') {
        const assetId = act.entityIds?.[0];
        const targetAsset = scene.assets.find((a) => a.id === assetId || a.assetId === assetId);
        const rawSvc = (act.serviceType || 'calibration').toLowerCase();
        const serviceType: 'calibration' | 'qualification' | 'maintenance' | 'corrective-repair' | 'cleaning-cip-sip' | 'inspection' =
          rawSvc.includes('qual')
            ? 'qualification'
            : rawSvc.includes('correct')
              ? 'corrective-repair'
              : rawSvc.includes('clean') || rawSvc.includes('cip') || rawSvc.includes('sip')
                ? 'cleaning-cip-sip'
                : rawSvc.includes('maint') || rawSvc.includes('pm')
                  ? 'maintenance'
                  : rawSvc.includes('inspect')
                    ? 'inspection'
                    : 'calibration';
        const targetCategory = targetAsset?.category ?? 'Biopharmaceutical';
        const eligibleTechs = gmpStore.getEligiblePersonnel(targetCategory, serviceType);
        const tech = eligibleTechs[0] ?? gmpStore.personnel[0];
        const dueDate =
          act.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        gmpStore.createWorkOrder({
          title: act.title || `${serviceType} — ${targetAsset?.name ?? 'Facility Asset'}`,
          description: `${act.details || 'Generated by Maya AI GMP Compliance Copilot.'}${customComment ? `\nEngineer Comment: ${customComment}` : ''}`,
          serviceType,
          priority: (act.priority as any) || 'high',
          status: 'open',
          targetKind: targetAsset ? 'asset' : 'room',
          targetId: targetAsset?.id ?? scene.rooms[0]?.id ?? 'facility',
          targetName: targetAsset ? `${targetAsset.assetId} · ${targetAsset.name}` : 'Facility Area',
          targetCategory,
          assigneeId: tech?.id ?? 'tech-01',
          assigneeName: tech?.name ?? 'Dr. Elena Rostova',
          lastServiceDate: today,
          dueDate,
          estimatedHours: 2.5,
          checklist: [
            { id: `chk-${Date.now()}-1`, text: 'Verify SOP & lockout/tagout prerequisites', done: false },
            { id: `chk-${Date.now()}-2`, text: 'Execute procedure & record certificate', done: false },
            { id: `chk-${Date.now()}-3`, text: 'QA e-signature & 21 CFR Part 11 release', done: false },
          ],
        });
        if (targetAsset) {
          createdOrTouched.push({
            type: 'asset',
            id: targetAsset.id,
            code: targetAsset.assetId,
            name: targetAsset.name,
          });
        }
        gmpAppliedCount++;
      } else {
        spatialActions.push(act);
      }
    }

    if (spatialActions.length > 0) {
      setPendingAIActions(spatialActions, customComment || 'Maya Map Design Update');
      const result = applyPendingAIActions({ customComment: customComment || undefined });
      if (result?.createdEntities) {
        result.createdEntities.forEach((ce) => createdOrTouched.push(ce));
      }
    }

    const totalApplied = spatialActions.length + gmpAppliedCount;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              applied: true,
              appliedCount: totalApplied,
              appliedComment: customComment || m.appliedComment,
              createdEntities: createdOrTouched.length > 0 ? createdOrTouched : m.createdEntities,
            }
          : m
      )
    );
    if (spatialActions.length > 0) {
      showToast(
        `Maya applied ${totalApplied} selected change${totalApplied > 1 ? 's' : ''} to your digital twin`,
        'success',
        true
      );
    } else if (gmpAppliedCount > 0) {
      showToast(`Maya executed ${gmpAppliedCount} GMP compliance action${gmpAppliedCount > 1 ? 's' : ''}`, 'success');
    }
  };

  if (!showMayaChat) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex justify-end">
      {/* Subtle scrim only when on Hub; keep map interactive when in Workspace */}
      {screen === 'hub' && (
        <div
          className="fixed inset-0 bg-black/55 pointer-events-auto"
          onClick={() => setShowMayaChat(false)}
        />
      )}

      {/* Standalone Modern Rounded Charcoal + Violet + Amber Maya Chat Panel */}
      <aside className="relative pointer-events-auto w-full max-w-[500px] h-full sm:h-[calc(100vh-24px)] sm:my-3 sm:mr-3 flex flex-col rounded-none sm:rounded-3xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
        {/* Header with explicit Back button + Map Split View shortcut */}
        <header className="px-4 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#15151C] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setShowMayaChat(false)}
              className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1C1C25] text-zinc-600 dark:text-zinc-300 hover:border-violet-500 hover:text-violet-500 transition-colors shrink-0"
              title="Back to Workspace"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="w-9 h-9 rounded-2xl gradian-violet-amber text-white flex items-center justify-center shadow-sm shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                  Maya AI Map Studio
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-600 dark:text-violet-300 shrink-0">
                  Live Designer
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                {activeFloor ? `${activeFloor.code} · ${activeFloor.name}` : scene.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {screen === 'workspace' && viewMode !== 'split' && (
              <button
                onClick={() => setViewMode('split')}
                className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1C1C25] hover:border-violet-500 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 transition-colors"
                title="Show 2D & 3D Split Map beside Maya"
              >
                <Columns2 className="w-3.5 h-3.5 text-amber-500" />
                <span>Split Map</span>
              </button>
            )}
            <button
              onClick={() =>
                setMessages([
                  {
                    id: `reset-${Date.now()}`,
                    role: 'assistant',
                    highlightTitle: 'New Design Session Started',
                    content:
                      'Canvas context refreshed. Ask me to **add rooms**, **arrange equipment**, **optimize cleanroom pressure**, or **visualize telemetry trends**.',
                    followUpSuggestions: QUICK_DESIGN_PROMPTS.slice(0, 3),
                  },
                ])
              }
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors"
              title="Clear Chat History"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowMayaChat(false)}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors"
              title="Close Maya Chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Conversation Thread */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              {msg.role === 'user' ? (
                <div className="max-w-[88%] px-4 py-2.5 rounded-2xl rounded-br-md bg-violet-600 text-white text-xs leading-relaxed shadow-sm">
                  {msg.content}
                </div>
              ) : (
                <div
                  className={`w-full rounded-2xl rounded-tl-md p-4 border shadow-xs ${
                    msg.error
                      ? 'bg-amber-500/10 border-amber-500/40'
                      : 'bg-white dark:bg-[#17171F] border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  {msg.highlightTitle && (
                    <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-zinc-200/80 dark:border-zinc-800">
                      <span className="text-xs font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                        <Wand2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        {msg.highlightTitle}
                      </span>
                      {msg.modelUsed && (
                        <span className="text-[9.5px] font-mono text-zinc-400 shrink-0">
                          {msg.modelUsed}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Safe Formatted Markdown with Clickable 3D Entity Codes */}
                  <RichMarkdownBlock
                    markdown={msg.content}
                    resolveCodeTarget={resolveInlineCodeTarget}
                    onJumpEntity={(ent) => jumpToEntityIn3D(ent, true)}
                  />

                  {/* Retry Button for transient demand spikes */}
                  {msg.error && msg.retryPrompt && (
                    <button
                      onClick={() => sendMessage(msg.retryPrompt)}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Request
                    </button>
                  )}

                  {/* Embedded Interactive Charts */}
                  {msg.charts && msg.charts.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {msg.charts.map((c, idx) => (
                        <InlineMayaChart key={idx} chart={c} />
                      ))}
                    </div>
                  )}

                  {/* Clickable Referenced / Created Objects → Precision 3D Navigation + Walk / Info / FMEA */}
                  {(() => {
                    const linkedObjects = findReferencedEntitiesInMessage(msg);
                    const lcContent = msg.content.toLowerCase();
                    const mentionsHvac = /\b(hvac|ahu|hepa|airflow|ach|duct)\b/.test(lcContent);
                    const mentionsFlows = /\b(flow route|personnel flow|material flow|unidirectional)\b/.test(lcContent);
                    const mentionsFmea = /\b(fmea|rpn|capa|failure mode)\b/.test(lcContent);
                    if (linkedObjects.length === 0 && !mentionsHvac && !mentionsFlows && !mentionsFmea) return null;

                    return (
                      <div className="mt-3 pt-2.5 border-t border-zinc-200/70 dark:border-zinc-800/80 space-y-2">
                        {linkedObjects.length > 0 && (
                          <>
                            <div className="flex items-center justify-between gap-2 text-[10.5px] font-semibold text-zinc-500 dark:text-zinc-400">
                              <span className="flex items-center gap-1.5">
                                <MapPin className="w-3 h-3 text-amber-500" />
                                3D Model Navigation ({linkedObjects.length})
                              </span>
                              <span className="text-[10px] text-zinc-400">Click to fly in 3D</span>
                            </div>
                            <div className="space-y-1.5">
                              {linkedObjects.map((ent) => {
                                const fmea =
                                  ent.type === 'room' || ent.type === 'asset'
                                    ? getTargetFmeaSummary(riskIncidents, ent.type, ent.id, false)
                                    : null;
                                return (
                                  <div
                                    key={`${ent.type}-${ent.id}`}
                                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-zinc-50 dark:bg-[#111118] border border-zinc-200 dark:border-zinc-800 hover:border-violet-500/50 transition-colors"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => jumpToEntityIn3D(ent, true)}
                                      className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer group"
                                      title={`Fly to ${ent.code} · ${ent.name} on 3D Model`}
                                    >
                                      <span className="font-mono font-bold text-[10.5px] text-violet-600 dark:text-violet-300 group-hover:underline shrink-0 tabular-nums">
                                        {ent.code}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-[11.5px] font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                          {ent.name}
                                        </div>
                                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                                          {ent.type === 'room'
                                            ? 'Room'
                                            : ent.type === 'asset'
                                              ? 'Equipment'
                                              : ent.type === 'floor'
                                                ? 'Floor'
                                                : 'Building'}
                                          {ent.floorCode ? ` · ${ent.floorCode}` : ''}
                                          {ent.reason ? ` · ${ent.reason}` : ''}
                                        </div>
                                      </div>
                                    </button>

                                    <div className="flex items-center gap-1 shrink-0">
                                      {fmea && fmea.worstIncident && fmea.shortLabel && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openRiskModal({
                                              mode: 'resolve',
                                              incidentId: fmea.worstIncident!.id,
                                            })
                                          }
                                          className={`px-1.5 py-1 rounded-lg font-mono text-[9.5px] font-bold tabular-nums cursor-pointer ${
                                            fmea.level === 'critical'
                                              ? 'text-rose-500 bg-rose-500/12 hover:bg-rose-500/20'
                                              : 'text-amber-500 bg-amber-500/12 hover:bg-amber-500/20'
                                          }`}
                                          title={`Open FMEA: ${fmea.worstIncident.title}`}
                                        >
                                          {fmea.shortLabel}
                                        </button>
                                      )}
                                      {ent.type === 'room' && (
                                        <button
                                          type="button"
                                          onClick={() => handleWalkIntoRoom(ent.id)}
                                          className="p-1.5 rounded-lg text-zinc-500 hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                                          title="Walk Inside Room (1st-Person)"
                                        >
                                          <Footprints className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      {(ent.type === 'room' || ent.type === 'asset') && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openEntityInfo({ type: ent.type as 'room' | 'asset', id: ent.id })
                                          }
                                          className="p-1.5 rounded-lg text-zinc-500 hover:text-violet-500 hover:bg-violet-500/10 transition-colors cursor-pointer"
                                          title="Open Specs, SOP & GMP History"
                                        >
                                          <Info className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => jumpToEntityIn3D(ent, true)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10.5px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
                                        title="Fly directly to object in 3D"
                                      >
                                        <Eye className="w-3 h-3" />
                                        3D
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}

                        {/* Contextual 3D Layer & Risk Shortcuts */}
                        {(mentionsHvac || mentionsFlows || mentionsFmea) && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            {mentionsHvac && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (screen === 'hub') openCinnaGenDemo();
                                  else setScreen('workspace');
                                  setViewMode('3d-perspective');
                                  setShowHvacOverlay(true);
                                  setShowMayaChat(false);
                                  showToast('3D HVAC Ductwork & Diffuser Overlay enabled', 'info');
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                <Wind className="w-3 h-3" />
                                Show 3D HVAC Ducts
                              </button>
                            )}
                            {mentionsFlows && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (screen === 'hub') openCinnaGenDemo();
                                  else setScreen('workspace');
                                  setViewMode('3d-perspective');
                                  setShowFlows(true);
                                  setShowMayaChat(false);
                                  showToast('3D GMP Process & Personnel Flows enabled', 'info');
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                <GitBranch className="w-3 h-3" />
                                Show 3D Flows
                              </button>
                            )}
                            {mentionsFmea && riskIncidents.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  openRiskModal({
                                    mode: 'resolve',
                                    incidentId: [...riskIncidents].sort((a, b) => b.rpn - a.rpn)[0]?.id,
                                  })
                                }
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                <AlertTriangle className="w-3 h-3" />
                                Open Top FMEA Risk
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Previewable Map Modification Checklist + Custom Comment + Apply + Show on 3D CTA */}
                  {msg.proposedActions && msg.proposedActions.length > 0 && (() => {
                    const total = msg.proposedActions.length;
                    const selectedIdxs = getSelectedIndices(msg.id, total);
                    const commentVal = commentByMsg[msg.id] ?? '';
                    const primaryTarget =
                      msg.createdEntities?.[0] ?? findReferencedEntitiesInMessage(msg)[0] ?? null;

                    return (
                      <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] font-semibold text-violet-600 dark:text-violet-300 flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5" />
                            Proposed Actions Checklist ({selectedIdxs.length}/{total})
                          </span>
                          <div className="flex items-center gap-2 text-[10.5px]">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedActionIndicesByMsg((prev) => ({
                                  ...prev,
                                  [msg.id]: Array.from({ length: total }, (_, i) => i),
                                }))
                              }
                              className="text-violet-400 hover:underline font-semibold cursor-pointer"
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedActionIndicesByMsg((prev) => ({ ...prev, [msg.id]: [] }))
                              }
                              className="text-zinc-400 hover:underline cursor-pointer"
                            >
                              Clear
                            </button>
                            {msg.applied && (
                              <span className="font-medium text-emerald-500 flex items-center gap-1">
                                <Check className="w-3 h-3" /> Applied
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          {msg.proposedActions.map((act, idx) => {
                            const checked = selectedIdxs.includes(idx);
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => toggleActionSelection(msg.id, idx, total)}
                                className={`w-full text-left px-3 py-2 rounded-xl border text-[11px] flex items-start gap-2.5 transition cursor-pointer ${
                                  checked
                                    ? 'bg-violet-600/10 border-violet-500/50'
                                    : 'bg-zinc-50 dark:bg-[#101016] border-zinc-200 dark:border-zinc-800 opacity-65 hover:opacity-100'
                                }`}
                              >
                                <span className="mt-0.5 shrink-0 text-violet-500">
                                  {checked ? (
                                    <CheckSquare className="w-4 h-4" />
                                  ) : (
                                    <Square className="w-4 h-4 text-zinc-400" />
                                  )}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                                    {act.title}
                                  </div>
                                  <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                                    {act.details}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* Optional Custom Engineering Comment before Apply */}
                        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#101016] px-2.5 py-2 space-y-1">
                          <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            <MessageSquarePlus className="w-3 h-3 text-amber-500" />
                            Custom Comment / Change Rationale (logged to Audit Trail)
                          </label>
                          <input
                            type="text"
                            value={commentVal}
                            onChange={(e) =>
                              setCommentByMsg((prev) => ({ ...prev, [msg.id]: e.target.value }))
                            }
                            placeholder="e.g., Approved for Phase-2 GMP expansion per CR-2026-041..."
                            className="w-full bg-transparent text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                          />
                        </div>

                        {msg.appliedComment && (
                          <div className="text-[10.5px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl px-2.5 py-1.5">
                            Logged comment: &ldquo;{msg.appliedComment}&rdquo;
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          <button
                            type="button"
                            disabled={selectedIdxs.length === 0}
                            onClick={() => handleApplyActions(msg.id, msg.proposedActions!)}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-colors disabled:opacity-40 cursor-pointer ${
                              msg.applied
                                ? 'bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40'
                                : 'bg-violet-600 hover:bg-violet-500 text-white shadow-sm'
                            }`}
                          >
                            {msg.applied ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                Re-Apply Selected ({selectedIdxs.length})
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                Apply Selected ({selectedIdxs.length})
                              </>
                            )}
                          </button>

                          {msg.applied && (
                            <button
                              type="button"
                              onClick={() => {
                                if (primaryTarget) {
                                  jumpToEntityIn3D(primaryTarget, true);
                                } else {
                                  if (screen === 'hub') openCinnaGenDemo();
                                  else setScreen('workspace');
                                  setViewMode('3d-perspective');
                                  setShowMayaChat(false);
                                }
                              }}
                              className="flex items-center justify-center gap-1.5 py-2 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold shadow-sm transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Show on 3D Model
                            </button>
                          )}

                          {past.length > 0 && (
                            <button
                              type="button"
                              onClick={undo}
                              className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-amber-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 flex items-center gap-1 transition-colors cursor-pointer"
                              title="Undo last map change"
                            >
                              <Undo2 className="w-3.5 h-3.5 text-amber-500" />
                              Undo
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Clickable Follow-up Suggestions */}
                  {msg.followUpSuggestions && msg.followUpSuggestions.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-zinc-200/70 dark:border-zinc-800/80 flex flex-wrap gap-1.5">
                      {msg.followUpSuggestions.slice(0, 3).map((sug, idx) => (
                        <button
                          key={idx}
                          onClick={() => sendMessage(sug)}
                          className="text-left px-2.5 py-1.5 rounded-xl bg-zinc-100 dark:bg-[#111116] hover:bg-violet-500/15 hover:text-violet-600 dark:hover:text-violet-300 border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-300 transition-colors"
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-zinc-100 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-300">
              <Loader2 className="w-4 h-4 text-violet-500 animate-spin shrink-0" />
              <span>Maya is designing spatial layouts &amp; computing charts...</span>
            </div>
          )}
        </div>

        {/* Collapsible GMP / FMEA / Assets / Rooms Prompt Templates Tray */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-[#13131A] shrink-0">
          <div className="px-3.5 py-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowTemplatesTray((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 hover:text-violet-600 dark:hover:text-violet-300 transition-colors cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5 text-violet-500" />
              <span>Question Templates</span>
              <span className="text-[10px] font-normal text-zinc-400">GMP · FMEA · Assets · Rooms</span>
              {showTemplatesTray ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
              )}
            </button>

            {showTemplatesTray && (
              <div className="flex items-center gap-1">
                {MAYA_TEMPLATE_GROUPS.map((grp) => {
                  const active = activeTemplateCategory === grp.id;
                  const GrpIcon =
                    grp.id === 'gmp'
                      ? ShieldCheck
                      : grp.id === 'fmea'
                        ? AlertTriangle
                        : grp.id === 'assets'
                          ? Box
                          : Grid2X2;
                  return (
                    <button
                      key={grp.id}
                      type="button"
                      onClick={() => setActiveTemplateCategory(grp.id)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        active
                          ? 'bg-violet-600 text-white'
                          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <GrpIcon className="w-3 h-3 shrink-0" />
                      <span>{grp.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {showTemplatesTray && (
            <div className="px-3.5 pb-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
              {(MAYA_TEMPLATE_GROUPS.find((g) => g.id === activeTemplateCategory) ?? MAYA_TEMPLATE_GROUPS[0]).templates.map(
                (tpl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={loading}
                    onClick={() => sendMessage(tpl.prompt)}
                    className="text-left p-2 rounded-xl bg-white dark:bg-[#191922] hover:bg-violet-500/10 border border-zinc-200 dark:border-zinc-800 hover:border-violet-500/40 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <div className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {tpl.title}
                    </div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400 line-clamp-1 mt-0.5">
                      {tpl.summary}
                    </div>
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Modern Rounded Chat Composer */}
        <footer className="p-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#15151C] shrink-0">
          <div className="rounded-2xl bg-white dark:bg-[#0D0D12] border border-zinc-200 dark:border-zinc-800 focus-within:border-violet-500 transition-colors p-2 flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask Maya about GMP eligibility, FMEA risks, HVAC, rooms, or equipment..."
              className="flex-1 bg-transparent px-2 py-1 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 resize-none focus:outline-none max-h-28"
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white transition-colors shrink-0"
              title="Send to Maya (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10.5px] text-zinc-500 px-1">
            <span>Enter to send · Click any cited code to fly in 3D</span>
            <span>All map edits support 1-click Undo</span>
          </div>
        </footer>
      </aside>
    </div>
  );
};
