import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Check,
  Columns2,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { evaluateProductionLine, useGmpStore } from '../store/useGmpStore';
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

interface MayaMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  highlightTitle?: string;
  charts?: MayaChartSpec[];
  proposedActions?: ProposedAIAction[];
  applied?: boolean;
  followUpSuggestions?: string[];
  modelUsed?: string;
  error?: boolean;
  retryPrompt?: string;
}

const CHART_COLORS: Record<string, string> = {
  violet: '#8B5CF6',
  amber: '#F59E0B',
  emerald: '#10B981',
  cyan: '#06B6D4',
  rose: '#F43F5E',
};

const QUICK_DESIGN_PROMPTS = [
  'Check production line eligibility, highlight blocked lines on the 2D/3D map, and propose corrective work orders',
  'Add a new 10x8m QC HPLC Analytical Lab with 3 HPLC benches and chart room area breakdown',
  'Place 2 stainless 2000L Bioreactors with 1.8m clearance in the Upstream Cell Culture Suite',
  'Analyze live temperature, humidity & pressure telemetry risks and visualize deviations in a chart',
  'Design clean Personnel & Material flow routes and switch analytics to Pressure Cascade',
];

/**
 * Safe, zero-HTML-injection Markdown renderer supporting headings, bold, inline code,
 * bullet/numbered lists, and Markdown tables.
 */
function renderInlineTokens(text: string): React.ReactNode[] {
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
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-300 font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

const RichMarkdownBlock: React.FC<{ markdown: string }> = ({ markdown }) => {
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
                      {renderInlineTokens(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                {body.map((row, ri) => (
                  <tr key={ri} className="hover:bg-violet-500/5">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300 font-mono tabular-nums">
                        {renderInlineTokens(cell)}
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
          {renderInlineTokens(line.slice(4))}
        </h4>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ') || line.startsWith('# ')) {
      const content = line.replace(/^#+\s+/, '');
      blocks.push(
        <h3 key={`h2-${i}`} className="text-sm font-bold text-zinc-900 dark:text-white mt-3 mb-1.5">
          {renderInlineTokens(content)}
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
              {renderInlineTokens(it)}
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
              {renderInlineTokens(it)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph
    blocks.push(
      <p key={`p-${i}`} className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300 my-1.5">
        {renderInlineTokens(line)}
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
  const setPendingAIActions = useTwinStore((s) => s.setPendingAIActions);
  const applyPendingAIActions = useTwinStore((s) => s.applyPendingAIActions);
  const showToast = useTwinStore((s) => s.showToast);

  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<MayaMessage[]>([
    {
      id: 'maya-welcome',
      role: 'assistant',
      highlightTitle: 'Maya · Conversational Digital Twin Architect',
      content:
        'Hi! I am **Maya**, your AI Spatial Designer for Gradian Digital Twin Studio.\n\nTell me how you want to **design, expand, or optimize your facility map** — I will draft clean GMP rooms, place bioreactors or HPLCs with clearances, visualize live telemetry & risk charts, and let you apply changes directly to the live 2D/3D map with full Undo.',
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

  const buildSummaries = () => {
    const floorRooms = scene.rooms.filter((r) => r.floorId === activeFloor?.id);
    const floorAssets = scene.assets.filter((a) => a.floorId === activeFloor?.id);

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

    const facilitySummary = {
      projectName: scene.name,
      industry: scene.industry,
      activeFloor: activeFloor
        ? { id: activeFloor.id, name: activeFloor.name, code: activeFloor.code, width: activeFloor.width, depth: activeFloor.depth, height: activeFloor.height }
        : null,
      rooms: floorRooms.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        x: r.x,
        z: r.z,
        width: r.width,
        depth: r.depth,
        grade: r.environmental.cleanroomGrade,
        pressurePa: r.environmental.pressurePa,
        tempC: r.environmental.temperatureC,
      })),
      assetsCount: floorAssets.length,
      assets: floorAssets.slice(0, 28).map((a) => ({
        id: a.id,
        assetId: a.assetId,
        name: a.name,
        templateId: a.templateId,
        roomId: a.roomId,
        x: a.x,
        z: a.z,
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
      },
      availableMaterials: DEFAULT_MATERIALS.slice(0, 18).map((m) => ({ id: m.id, name: m.name })),
      availableEquipment: OBJECT_LIBRARY.slice(0, 24).map((e) => ({ id: e.id, name: e.name, category: e.category })),
    };

    const alarmSensors = sensors.filter((s) => readings[s.id]?.status === 'alarm');
    const warnSensors = sensors.filter((s) => readings[s.id]?.status === 'warning');
    const telemetrySummary = {
      totalSensors: sensors.length,
      alarmCount: alarmSensors.length,
      warningCount: warnSensors.length,
      flaggedSensors: [...alarmSensors, ...warnSensors].slice(0, 10).map((s) => ({
        tag: s.tag,
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

      const assistantMsg: MayaMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        highlightTitle: data.highlightTitle,
        content: data.markdown || data.explanation || 'Analysis ready.',
        charts: Array.isArray(data.charts) ? data.charts : [],
        proposedActions: Array.isArray(data.proposedActions) ? data.proposedActions : [],
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

  const handleApplyActions = (msgId: string, actions: ProposedAIAction[]) => {
    if (screen === 'hub') {
      openCinnaGenDemo();
    }
    const gmpStore = useGmpStore.getState();
    const spatialActions: ProposedAIAction[] = [];
    let gmpAppliedCount = 0;

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
          description: act.details || 'Generated by Maya AI GMP Compliance Copilot.',
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
        gmpAppliedCount++;
      } else {
        spatialActions.push(act);
      }
    }

    if (spatialActions.length > 0) {
      setPendingAIActions(spatialActions, 'Maya Map Design Update');
      applyPendingAIActions();
    }

    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, applied: true } : m)));
    if (spatialActions.length > 0) {
      showToast(
        `Maya applied ${spatialActions.length + gmpAppliedCount} change${spatialActions.length + gmpAppliedCount > 1 ? 's' : ''} to your digital twin`,
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

                  {/* Safe Formatted Markdown */}
                  <RichMarkdownBlock markdown={msg.content} />

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

                  {/* Previewable Map Modification Actions */}
                  {msg.proposedActions && msg.proposedActions.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-violet-600 dark:text-violet-300 flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5" />
                          Proposed Map Changes ({msg.proposedActions.length})
                        </span>
                        {msg.applied && (
                          <span className="text-[10.5px] font-medium text-emerald-500 flex items-center gap-1">
                            <Check className="w-3 h-3" /> Applied
                          </span>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        {msg.proposedActions.map((act, idx) => (
                          <div
                            key={idx}
                            className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-[#101016] border border-zinc-200 dark:border-zinc-800 text-[11px]"
                          >
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {act.title}
                            </div>
                            <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                              {act.details}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleApplyActions(msg.id, msg.proposedActions!)}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-colors ${
                            msg.applied
                              ? 'bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40'
                              : 'bg-violet-600 hover:bg-violet-500 text-white shadow-sm'
                          }`}
                        >
                          {msg.applied ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Re-Apply to Live Map
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5" />
                              Apply to 2D / 3D Map
                            </>
                          )}
                        </button>
                        {past.length > 0 && (
                          <button
                            onClick={undo}
                            className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-amber-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 flex items-center gap-1 transition-colors"
                            title="Undo last map change"
                          >
                            <Undo2 className="w-3.5 h-3.5 text-amber-500" />
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  )}

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
              placeholder="Ask Maya to design rooms, place bioreactors/HPLCs, optimize flows, or chart sensor risks..."
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
            <span>Enter to send · Shift+Enter for newline</span>
            <span>All map edits support 1-click Undo</span>
          </div>
        </footer>
      </aside>
    </div>
  );
};
