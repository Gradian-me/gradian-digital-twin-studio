import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bot,
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
  List,
  Loader2,
  MapPin,
  MessageSquarePlus,
  Mic,
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
import { useMayaStore, type MayaDrawerMessage } from '../store/useMayaStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { evaluateProductionLine, useGmpStore } from '../store/useGmpStore';
import { getTargetFmeaSummary, useRiskIncidentStore } from '../store/useRiskIncidentStore';
import { useMayaTranscribe } from '../hooks/useMayaTranscribe';
import { OBJECT_LIBRARY } from '../data/objectLibrary';
import { DEFAULT_MATERIALS } from '../data/materialsLibrary';
import { fetchApiJson } from '../utils/safeJson';
import type { ProposedAIAction } from '../types/twin';
import {
  EmbeddedMarkdownChart,
  RichMarkdownRenderer,
  type EmbeddedChartType,
  type MarkdownEntityTarget,
} from './RichMarkdownRenderer';

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

type TemplateCategoryId = 'gmp' | 'fmea' | 'assets' | 'rooms' | 'charts';

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
  {
    id: 'charts',
    label: 'Charts',
    templates: [
      {
        title: 'Energy & Asset Load (Pie + Bar)',
        summary: 'Distribution pie chart & bar comparison with GFM summary table',
        prompt:
          'Analyze our facility power consumption (kW) across equipment and rooms. Render a Markdown GFM comparison table, a `chart:pie` distribution chart by category, and a `chart:bar` comparison of the top energy-consuming assets.',
      },
      {
        title: 'Telemetry & HVAC Trends (Line + Area)',
        summary: 'Multi-series trend lines & area envelopes with target limits',
        prompt:
          'Generate a telemetry & cleanroom HVAC trend analysis including a `chart:line` temperature/pressure trend with target limits, a `chart:area` 24h ACH airflow envelope, and a structured Markdown parameter table.',
      },
      {
        title: 'Compliance Target vs Actual (Target)',
        summary: 'KPI target attainment bars & threshold benchmark line',
        prompt:
          'Evaluate room GMP readiness, calibration compliance, and condition scores against 95% targets using a `chart:target` Target vs Actual chart and a clean Markdown table with 3D jump links.',
      },
      {
        title: 'Full Executive Facility Report',
        summary: 'Complete report with Table, Line, Bar, Pie & Target charts',
        prompt:
          'Produce an executive facility analytics report in Markdown combining a GFM comparison table, a `chart:line` performance trend, a `chart:target` KPI attainment chart, and a `chart:pie` asset/energy share breakdown.',
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

const RichMarkdownBlock: React.FC<{
  markdown: string;
  resolveCodeTarget?: (token: string) => CreatedOrLinkedEntity | null;
  onJumpEntity?: (ent: CreatedOrLinkedEntity) => void;
}> = ({ markdown, resolveCodeTarget, onJumpEntity }) => {
  const isDark =
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true;
  return (
    <RichMarkdownRenderer
      markdown={markdown}
      isDark={isDark}
      compact
      resolveCodeTarget={
        resolveCodeTarget
          ? (token) => {
              const found = resolveCodeTarget(token);
              if (!found) return null;
              return {
                type:
                  found.type === 'room' ||
                  found.type === 'asset' ||
                  found.type === 'floor' ||
                  found.type === 'building'
                    ? found.type
                    : 'asset',
                id: found.id,
                code: found.code,
                name: found.name,
                reason: found.reason,
              } as MarkdownEntityTarget;
            }
          : undefined
      }
      onJumpEntity={
        onJumpEntity && resolveCodeTarget
          ? (ent) => {
              const full = resolveCodeTarget(ent.code);
              if (full) onJumpEntity(full);
            }
          : undefined
      }
    />
  );
};

/**
 * Embedded Interactive Recharts Visual Chart inside Maya's chat messages
 * Supports: pie, bar, line, area, target, composed, and kpi summary grids.
 */
const InlineMayaChart: React.FC<{ chart: MayaChartSpec }> = ({ chart }) => {
  const data = Array.isArray(chart.data) ? chart.data.slice(0, 12) : [];
  if (data.length === 0) return null;

  const isDark =
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true;

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

  const normalizedKind: EmbeddedChartType =
    chart.kind === 'pie' ||
    chart.kind === 'line' ||
    chart.kind === 'area' ||
    chart.kind === 'target' ||
    chart.kind === 'composed' ||
    chart.kind === 'bar'
      ? chart.kind
      : data.some((d) => typeof d.target === 'number')
      ? 'target'
      : 'bar';

  return (
    <EmbeddedMarkdownChart
      isDark={isDark}
      spec={{
        type: normalizedKind,
        title: chart.title,
        subtitle: chart.subtitle,
        unit: chart.unit,
        xKey: 'label',
        series: [{ key: 'value', label: chart.unit ? `Value (${chart.unit})` : 'Value' }],
        data: data.map((d) => ({
          label: d.label,
          value: Number(d.value) || 0,
          ...(typeof d.target === 'number' ? { target: d.target } : {}),
          ...(d.color ? { color: d.color } : {}),
        })),
      }}
    />
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

  const drawerThreads = useMayaStore((s) => s.drawerThreads);
  const activeDrawerThreadId = useMayaStore((s) => s.activeDrawerThreadId);
  const createDrawerThread = useMayaStore((s) => s.createDrawerThread);
  const selectDrawerThread = useMayaStore((s) => s.selectDrawerThread);
  const deleteDrawerThread = useMayaStore((s) => s.deleteDrawerThread);
  const renameDrawerThread = useMayaStore((s) => s.renameDrawerThread);
  const appendDrawerMessage = useMayaStore((s) => s.appendDrawerMessage);
  const updateDrawerMessage = useMayaStore((s) => s.updateDrawerMessage);
  const clearActiveDrawerThread = useMayaStore((s) => s.clearActiveDrawerThread);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showTemplatesTray, setShowTemplatesTray] = useState(true);
  const [showThreadsPanel, setShowThreadsPanel] = useState(false);
  const [activeTemplateCategory, setActiveTemplateCategory] = useState<TemplateCategoryId>('gmp');
  const [selectedActionIndicesByMsg, setSelectedActionIndicesByMsg] = useState<Record<string, number[]>>({});
  const [commentByMsg, setCommentByMsg] = useState<Record<string, string>>({});

  const transcribe = useMayaTranscribe({
    onTranscript: (text) => {
      setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      showToast('Voice transcribed with Gemini 3.5 Transcribe', 'success');
    },
    onError: (msg) => showToast(msg, 'error'),
  });

  const activeThread = useMemo(
    () => drawerThreads.find((t) => t.id === activeDrawerThreadId) ?? drawerThreads[0],
    [drawerThreads, activeDrawerThreadId]
  );
  const messages = (activeThread?.messages ?? []) as MayaMessage[];

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

  const generateAsyncDrawerTitle = async (
    threadId: string,
    firstUserMessage: string,
    firstAssistantReply?: string
  ) => {
    try {
      const res = await fetch('/api/maya/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstUserMessage,
          firstAssistantReply: firstAssistantReply?.slice(0, 320),
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.title && typeof data.title === 'string') {
        renameDrawerThread(threadId, data.title, true);
      }
    } catch {
      // Non-blocking fallback
    }
  };

  const sendMessage = async (textOverride?: string) => {
    const prompt = (textOverride ?? input).trim();
    if (!prompt || loading) return;

    if (!textOverride) setInput('');
    setShowTemplatesTray(false);

    const targetThreadId = useMayaStore.getState().activeDrawerThreadId;
    const targetThreadObj = useMayaStore
      .getState()
      .drawerThreads.find((t) => t.id === targetThreadId);
    const shouldGenerateTitle = Boolean(targetThreadObj && !targetThreadObj.titleGenerated);

    const userMsg: MayaDrawerMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: prompt,
    };
    const nextHistory = [...messages, userMsg];
    appendDrawerMessage(userMsg, targetThreadId);
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

      const assistantContent = data.markdown || data.explanation || 'Analysis ready.';
      const assistantMsg: MayaDrawerMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        highlightTitle: data.highlightTitle,
        content: assistantContent,
        charts: Array.isArray(data.charts) ? data.charts : [],
        proposedActions: Array.isArray(data.proposedActions) ? data.proposedActions : [],
        navigationTargets: rawNavTargets,
        followUpSuggestions: Array.isArray(data.followUpSuggestions) ? data.followUpSuggestions : [],
        modelUsed: data.modelUsed,
      };
      appendDrawerMessage(assistantMsg, targetThreadId);

      if (shouldGenerateTitle) {
        void generateAsyncDrawerTitle(targetThreadId, prompt, assistantContent);
      }
    } catch (err: any) {
      appendDrawerMessage(
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: err?.message || 'Maya could not reach the AI model right now. Please retry.',
          error: true,
          retryPrompt: prompt,
        },
        targetThreadId
      );
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
    updateDrawerMessage(msgId, (m) => ({
      ...m,
      applied: true,
      appliedCount: totalApplied,
      appliedComment: customComment || m.appliedComment,
      createdEntities: createdOrTouched.length > 0 ? createdOrTouched : m.createdEntities,
    }));
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
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                  {activeThread?.title || 'Maya AI Map Studio'}
                </h2>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                {drawerThreads.length} chat{drawerThreads.length === 1 ? '' : 's'} ·{' '}
                {activeFloor ? `${activeFloor.code} · ${activeFloor.name}` : scene.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowThreadsPanel((v) => !v)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-xl border text-[11px] font-semibold transition-colors cursor-pointer ${
                showThreadsPanel
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1C1C25] text-zinc-700 dark:text-zinc-200 hover:border-violet-500'
              }`}
              title={`Toggle Dedicated Chat List (${drawerThreads.length})`}
            >
              <List className="w-3.5 h-3.5" />
              <span className="font-mono text-[10px]">{drawerThreads.length}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                createDrawerThread();
                setShowThreadsPanel(false);
                setShowTemplatesTray(true);
              }}
              className="p-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer"
              title="New Dedicated Chat Thread"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setShowMayaChat(false);
                setScreen('maya-life');
              }}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl border border-violet-500/40 bg-violet-500/12 hover:bg-violet-500/20 text-[11px] font-semibold text-violet-700 dark:text-violet-300 transition-colors cursor-pointer"
              title="Open dedicated MAYA Life 3D Companion & SOP Studio"
            >
              <Bot className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Life</span>
            </button>
            {screen === 'workspace' && viewMode !== 'split' && (
              <button
                onClick={() => setViewMode('split')}
                className="hidden sm:flex items-center gap-1 p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1C1C25] hover:border-violet-500 text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer"
                title="Show 2D & 3D Split Map beside Maya"
              >
                <Columns2 className="w-3.5 h-3.5 text-amber-500" />
              </button>
            )}
            <button
              onClick={clearActiveDrawerThread}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Reset Current Thread"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowMayaChat(false)}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close Maya Chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Dedicated Chat Threads List Drawer */}
        {showThreadsPanel && (
          <div className="px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#14141C] space-y-1.5 max-h-52 overflow-y-auto shrink-0">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500 px-1">
              <span>Dedicated Conversations (Auto AI Titles)</span>
              <button
                type="button"
                onClick={() => {
                  createDrawerThread();
                  setShowThreadsPanel(false);
                }}
                className="text-violet-500 hover:underline font-bold cursor-pointer"
              >
                + New Chat
              </button>
            </div>
            {drawerThreads.map((th) => {
              const isAct = th.id === activeDrawerThreadId;
              return (
                <div
                  key={th.id}
                  onClick={() => {
                    selectDrawerThread(th.id);
                    setShowThreadsPanel(false);
                  }}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border transition cursor-pointer ${
                    isAct
                      ? 'bg-violet-600/15 border-violet-500/60 text-zinc-900 dark:text-white'
                      : 'bg-white dark:bg-[#1A1A24] border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-violet-500/40'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate">{th.title}</div>
                    <div className="text-[10px] text-zinc-400 font-mono tabular-nums">
                      {th.messages.length} msgs ·{' '}
                      {new Date(th.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {drawerThreads.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDrawerThread(th.id);
                      }}
                      className="p-1 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer shrink-0"
                      title="Delete Chat Thread"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

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

        {/* Modern Rounded Chat Composer with Voice Transcription */}
        <footer className="p-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#15151C] shrink-0 space-y-2">
          {(transcribe.isRecording || transcribe.isTranscribing) && (
            <div className="px-3 py-1.5 rounded-xl border border-violet-500/35 bg-violet-500/10 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                {transcribe.isTranscribing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500 shrink-0" />
                    <span className="text-[11px] font-medium text-violet-700 dark:text-violet-300 truncate">
                      Transcribing audio (gemini-3.5-transcribe)...
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                    <span className="font-mono text-[11px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                      {String(Math.floor(transcribe.durationSec / 60)).padStart(2, '0')}:
                      {String(transcribe.durationSec % 60).padStart(2, '0')}
                    </span>
                    <div className="flex items-end gap-0.5 h-3.5">
                      {[0.35, 0.75, 1, 0.6, 0.35].map((w, idx) => (
                        <span
                          key={idx}
                          className="w-1 rounded-full bg-violet-500 transition-all duration-75"
                          style={{
                            height: `${Math.max(25, Math.min(100, Math.round((0.2 + transcribe.audioLevel * w) * 100)))}%`,
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              {transcribe.isRecording && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={transcribe.cancelRecording}
                    className="p-1 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
                    title="Cancel recording"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => transcribe.stopAndTranscribe()}
                    className="px-2 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-[10.5px] font-semibold cursor-pointer"
                  >
                    Insert
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      transcribe.stopAndTranscribe((text) => {
                        const merged = input.trim() ? `${input.trim()} ${text}` : text;
                        sendMessage(merged);
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10.5px] font-semibold cursor-pointer"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl bg-white dark:bg-[#0D0D12] border border-zinc-200 dark:border-zinc-800 focus-within:border-violet-500 transition-colors p-2 flex items-end gap-2">
            <button
              type="button"
              disabled={loading || transcribe.isTranscribing}
              onClick={() =>
                transcribe.isRecording ? transcribe.stopAndTranscribe() : transcribe.startRecording()
              }
              className={`p-2.5 rounded-xl border transition-colors shrink-0 cursor-pointer disabled:opacity-40 ${
                transcribe.isRecording
                  ? 'bg-rose-600 border-rose-500 text-white'
                  : 'bg-zinc-50 dark:bg-[#171720] border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-violet-500 hover:text-violet-500'
              }`}
              title={
                transcribe.isRecording
                  ? 'Stop & Transcribe Voice'
                  : 'Voice Input (Gemini 3.5 Transcribe)'
              }
            >
              {transcribe.isTranscribing ? (
                <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
              ) : transcribe.isRecording ? (
                <Square className="w-4 h-4 fill-current" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
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
              placeholder={
                transcribe.isRecording
                  ? 'Listening to your voice... click Insert or Send'
                  : 'Ask Maya or tap Mic to dictate GMP, FMEA, HVAC, or room queries...'
              }
              className="flex-1 bg-transparent px-2 py-1 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 resize-none focus:outline-none max-h-28"
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white transition-colors shrink-0 cursor-pointer"
              title="Send to Maya (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-between text-[10.5px] text-zinc-500 px-1">
            <span>Enter to send · Tap Mic for Gemini 3.5 Transcribe</span>
            <span>All map edits support 1-click Undo</span>
          </div>
        </footer>
      </aside>
    </div>
  );
};
