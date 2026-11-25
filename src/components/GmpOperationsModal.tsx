import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookMarked,
  BookOpen,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Compass,
  Download,
  Edit3,
  FileText,
  GitBranch,
  History,
  Layers,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  UserCheck,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { PredictiveForecastPanel } from './PredictiveForecastPanel';
import { GmpWorkflowsPanel } from './GmpWorkflowsPanel';
import type {
  EquipmentLifecycleEvent,
  GmpModalTab,
  ServiceActionType,
  SopActionCategory,
  WikiArticle,
  WorkOrderPriority,
  WorkOrderStatus,
} from '../types/gmp';
import type { EquipmentCategory } from '../types/twin';
import { addDaysToIso, todayIso } from '../data/gmpDemoData';

/**
 * Safe React JSX Markdown renderer (no raw HTML injection).
 * Supports headings, markdown tables, blockquotes, bullet/numbered lists, bold, and inline code.
 */
const SafeMarkdownView: React.FC<{ markdown: string; isDark: boolean }> = ({ markdown, isDark }) => {
  const renderInline = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} className={isDark ? 'text-white font-bold' : 'text-slate-950 font-bold'}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={idx}
            className={`px-1.5 py-0.5 rounded font-mono text-[11px] ${
              isDark ? 'bg-violet-500/20 text-amber-300' : 'bg-violet-100 text-violet-800'
            }`}
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  const lines = markdown.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    // Markdown table
    if (line.trim().startsWith('|') && i + 1 < lines.length && lines[i + 1].includes('---')) {
      const headers = line
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(
          lines[i]
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean)
        );
        i++;
      }
      blocks.push(
        <div
          key={`tbl-${i}`}
          className={`my-3 overflow-x-auto rounded-xl border ${
            isDark ? 'border-zinc-800 bg-[#0E0E13]' : 'border-slate-200 bg-white'
          }`}
        >
          <table className="w-full text-left text-xs">
            <thead className={isDark ? 'bg-zinc-900/90 text-violet-300' : 'bg-slate-100 text-slate-700'}>
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi} className="px-3 py-2 font-bold border-b border-zinc-800/60">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr
                  key={ri}
                  className={isDark ? 'border-b border-zinc-800/50 last:border-0' : 'border-b border-slate-100'}
                >
                  {r.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.startsWith('# ')) {
      blocks.push(
        <h1 key={i} className="text-lg font-extrabold tracking-tight mt-1 mb-2 text-violet-400">
          {renderInline(line.slice(2))}
        </h1>
      );
    } else if (line.startsWith('## ')) {
      blocks.push(
        <h2
          key={i}
          className={`text-sm font-bold mt-4 mb-1.5 pb-1 border-b ${
            isDark ? 'border-zinc-800 text-amber-300' : 'border-slate-200 text-violet-700'
          }`}
        >
          {renderInline(line.slice(3))}
        </h2>
      );
    } else if (line.startsWith('### ')) {
      blocks.push(
        <h3 key={i} className="text-xs font-bold uppercase tracking-wider mt-3 mb-1 text-violet-300">
          {renderInline(line.slice(4))}
        </h3>
      );
    } else if (line.startsWith('> ')) {
      blocks.push(
        <blockquote
          key={i}
          className={`my-2 rounded-xl border-l-4 border-amber-500 px-3 py-2 text-xs ${
            isDark ? 'bg-amber-500/10 text-amber-200' : 'bg-amber-50 text-amber-900'
          }`}
        >
          {renderInline(line.slice(2))}
        </blockquote>
      );
    } else if (/^[-*]\s+/.test(line.trim())) {
      blocks.push(
        <div key={i} className="flex items-start gap-2 text-xs my-1 pl-1">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
          <span className="leading-relaxed">{renderInline(line.trim().replace(/^[-*]\s+/, ''))}</span>
        </div>
      );
    } else if (/^\d+\.\s+/.test(line.trim())) {
      const match = line.trim().match(/^(\d+)\.\s+(.*)$/);
      blocks.push(
        <div key={i} className="flex items-start gap-2 text-xs my-1 pl-1">
          <span className="font-mono text-[10px] font-bold text-amber-400 mt-0.5 shrink-0">
            {match?.[1]}.
          </span>
          <span className="leading-relaxed">{renderInline(match?.[2] ?? line)}</span>
        </div>
      );
    } else if (line.trim() !== '') {
      blocks.push(
        <p key={i} className={`text-xs leading-relaxed my-1.5 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
          {renderInline(line)}
        </p>
      );
    }
    i++;
  }

  return <div className="space-y-0.5">{blocks}</div>;
};

const EQUIPMENT_CATEGORIES: EquipmentCategory[] = [
  'Biopharmaceutical',
  'Laboratory',
  'HVAC & Utilities',
  'Warehouse & Logistics',
  'IT & Data Center',
  'Furniture & Workplace',
  'Building & Safety',
];

const SERVICE_TYPES: { id: ServiceActionType; label: string }[] = [
  { id: 'calibration', label: 'Calibration' },
  { id: 'qualification', label: 'Qualification (IQ/OQ/PQ)' },
  { id: 'maintenance', label: 'Preventive Maintenance' },
  { id: 'cleaning-cip-sip', label: 'Cleaning / CIP-SIP' },
  { id: 'corrective-repair', label: 'Corrective Repair' },
  { id: 'inspection', label: 'GMP Inspection' },
];

export const GmpOperationsModal: React.FC = () => {
  const { scene, theme, selectEntity, setActiveFloor, setViewMode, flyToCamera, showToast } = useTwinStore();
  const telemetrySensors = useTelemetryStore((s) => s.sensors);
  const telemetryReadings = useTelemetryStore((s) => s.readings);
  const {
    showGmpModal,
    gmpTab,
    focusedAssetId,
    focusedLineId,
    focusedSopId,
    focusedWikiId,
    closeGmpModal,
    setGmpTab,
    complianceByAssetId,
    updateCompliance,
    addLifecycleEvent,
    productionLines,
    eligibilityByLineId,
    saveProductionLine,
    deleteProductionLine,
    checkLineEligibility,
    clearLineHighlight,
    workOrders,
    createWorkOrder,
    updateWorkOrderStatus,
    toggleWorkOrderChecklist,
    deleteWorkOrder,
    cronJobs,
    addCronJob,
    toggleCronJob,
    runCronJobNow,
    deleteCronJob,
    personnel,
    addTechnician,
    getEligiblePersonnel,
    sops,
    addSopDocument,
    updateSopDocument,
    wikiArticles,
    addWikiArticle,
    workflows,
    openQrLabelModal,
  } = useGmpStore();

  const isDark = theme === 'dark';

  // Production Line Editor state
  const [selectedLineId, setSelectedLineId] = useState<string>(focusedLineId ?? productionLines[0]?.id ?? '');
  const [creatingNewLine, setCreatingNewLine] = useState(false);
  const [lineForm, setLineForm] = useState({
    code: 'LINE-04',
    name: '',
    productFamily: '',
    description: '',
    owner: 'Dr. N. Rahimi',
    color: '#8B5CF6',
    targetBatchSize: '1,000 L',
    status: 'active' as 'active' | 'changeover' | 'maintenance-hold' | 'standby',
    roomIds: [] as string[],
    assetIds: [] as string[],
  });

  // Compliance / Lifecycle tab state
  const [assetSearch, setAssetSearch] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>(
    focusedAssetId ?? scene.assets[0]?.id ?? ''
  );
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({
    stage: 'calibration' as EquipmentLifecycleEvent['stage'],
    title: '',
    performedBy: 'Reza Tavakoli · Metrology',
    referenceDoc: '',
    outcome: 'pass' as EquipmentLifecycleEvent['outcome'],
    notes: '',
  });

  // Work Orders sub-tab state
  const [woSubTab, setWoSubTab] = useState<'inbox' | 'create' | 'cron' | 'personnel'>('inbox');
  const [woStatusFilter, setWoStatusFilter] = useState<'all' | WorkOrderStatus>('all');
  const [newWo, setNewWo] = useState({
    title: '',
    description: '',
    serviceType: 'calibration' as ServiceActionType,
    targetId: scene.assets[0]?.id ?? '',
    productionLineId: '',
    assigneeId: '',
    priority: 'high' as WorkOrderPriority,
    lastServiceDate: todayIso(),
    dueDate: addDaysToIso(todayIso(), 14),
    estimatedHours: 2.5,
    sopId: sops[0]?.id ?? '',
  });
  const [newCron, setNewCron] = useState({
    name: '',
    cronExpression: '0 6 1 */3 *',
    humanSchedule: 'Quarterly on the 1st at 06:00',
    serviceType: 'calibration' as ServiceActionType,
    targetId: scene.assets[0]?.id ?? '',
    intervalDays: 90,
    defaultAssigneeId: personnel[0]?.id ?? 'tech-tavakoli',
    priority: 'medium' as WorkOrderPriority,
    sopId: sops[0]?.id ?? '',
  });
  const [newTech, setNewTech] = useState({
    name: '',
    role: '',
    department: 'Engineering',
    badgeId: 'EMP-1305',
    email: '',
    certifiedCategories: ['Biopharmaceutical'] as (EquipmentCategory | 'Facility / Room')[],
    certifiedServices: ['calibration', 'maintenance'] as ServiceActionType[],
    certExpiry: '2028-01-01',
  });

  // Calendar state
  const nowDate = new Date();
  const [calYear, setCalYear] = useState(nowDate.getFullYear());
  const [calMonth, setCalMonth] = useState(nowDate.getMonth());
  const [calScope, setCalScope] = useState<'all' | 'line' | 'asset'>('all');
  const [calScopeId, setCalScopeId] = useState<string>('');
  const [selectedCalDate, setSelectedCalDate] = useState<string>(todayIso());

  // SOPs state
  const [sopSearch, setSopSearch] = useState('');
  const [sopCatFilter, setSopCatFilter] = useState<string>('all');
  const [sopActionFilter, setSopActionFilter] = useState<string>('all');
  const [selectedSopId, setSelectedSopId] = useState<string>(focusedSopId ?? sops[0]?.id ?? '');
  const [editingSop, setEditingSop] = useState(false);
  const [creatingSop, setCreatingSop] = useState(false);
  const [sopDraft, setSopDraft] = useState({
    docNumber: 'SOP-NEW-010',
    title: '',
    docType: 'SOP' as 'SOP' | 'Record' | 'Protocol' | 'Checklist',
    equipmentCategory: 'Biopharmaceutical' as EquipmentCategory | 'All Equipment' | 'Facility / Room',
    actionType: 'Operation' as SopActionCategory,
    version: '1.0',
    author: 'QA Compliance',
    markdown: '# New GMP Standard Operating Procedure\n\n## 1. Purpose\nDescribe procedure steps...\n',
  });

  // Wiki state
  const [wikiSearch, setWikiSearch] = useState('');
  const [wikiCatFilter, setWikiCatFilter] = useState<string>('all');
  const [selectedWikiId, setSelectedWikiId] = useState<string>(
    focusedWikiId ?? wikiArticles[0]?.id ?? ''
  );
  const [creatingWiki, setCreatingWiki] = useState(false);
  const [wikiDraft, setWikiDraft] = useState({
    title: '',
    category: 'Troubleshooting' as WikiArticle['category'],
    tags: 'sensor, gmp',
    author: 'Engineering Team',
    severity: 'common' as 'critical' | 'common' | 'reference',
    markdown: '# Troubleshooting Guide\n\n## Symptom\n\n## Root Cause\n\n## Corrective Action\n',
  });

  // Sync focus when modal opens with targeted IDs
  React.useEffect(() => {
    if (!showGmpModal) return;
    if (focusedAssetId) setSelectedAssetId(focusedAssetId);
    if (focusedLineId) setSelectedLineId(focusedLineId);
    if (focusedSopId) setSelectedSopId(focusedSopId);
    if (focusedWikiId) setSelectedWikiId(focusedWikiId);
  }, [showGmpModal, focusedAssetId, focusedLineId, focusedSopId, focusedWikiId]);

  const activeLine = useMemo(
    () => productionLines.find((l) => l.id === selectedLineId) ?? productionLines[0] ?? null,
    [productionLines, selectedLineId]
  );

  const activeLineEligibility = activeLine ? eligibilityByLineId[activeLine.id] : undefined;

  const activeAsset = useMemo(
    () => scene.assets.find((a) => a.id === selectedAssetId) ?? scene.assets[0] ?? null,
    [scene.assets, selectedAssetId]
  );

  const activeCompliance = activeAsset ? complianceByAssetId[activeAsset.id] : undefined;

  const flyToAssetIn3D = (assetId: string) => {
    const a = scene.assets.find((x) => x.id === assetId);
    if (!a) return;
    setActiveFloor(a.floorId);
    selectEntity({ type: 'asset', id: a.id });
    setViewMode('3d-perspective');
    const fl = scene.floors.find((f) => f.id === a.floorId);
    const elev = fl?.elevation ?? 0;
    flyToCamera([a.x + 4.2, elev + 3.5, a.z + 4.2], [a.x, elev + a.height * 0.5, a.z]);
    closeGmpModal();
  };

  // Calendar events computation
  interface CalEventItem {
    id: string;
    date: string;
    kind: 'calibration' | 'qualification' | 'maintenance' | 'work-order';
    title: string;
    subtitle: string;
    assetId?: string;
    status: string;
  }

  const calendarEvents = useMemo<CalEventItem[]>(() => {
    const list: CalEventItem[] = [];
    const allowedAssetIds =
      calScope === 'all'
        ? null
        : calScope === 'asset'
          ? new Set([calScopeId])
          : new Set(productionLines.find((l) => l.id === calScopeId)?.assetIds ?? []);

    scene.assets.forEach((a) => {
      if (allowedAssetIds && !allowedAssetIds.has(a.id)) return;
      const comp = complianceByAssetId[a.id];
      if (!comp) return;
      list.push({
        id: `cal-${a.id}`,
        date: comp.calibration.nextDueDate,
        kind: 'calibration',
        title: `Cal Due · ${a.assetId}`,
        subtitle: `${a.name} (${comp.calibration.certificateOrProtocol})`,
        assetId: a.id,
        status: comp.calibration.status,
      });
      list.push({
        id: `qual-${a.id}`,
        date: comp.qualification.nextDueDate,
        kind: 'qualification',
        title: `${comp.qualification.stage} Due · ${a.assetId}`,
        subtitle: `${a.name} (${comp.qualification.certificateOrProtocol})`,
        assetId: a.id,
        status: comp.qualification.status,
      });
      list.push({
        id: `pm-${a.id}`,
        date: comp.maintenance.nextDueDate,
        kind: 'maintenance',
        title: `PM Due · ${a.assetId}`,
        subtitle: `${a.name} (${comp.maintenance.certificateOrProtocol})`,
        assetId: a.id,
        status: comp.maintenance.status,
      });
    });

    workOrders.forEach((wo) => {
      if (calScope === 'asset' && wo.targetId !== calScopeId) return;
      if (
        calScope === 'line' &&
        wo.productionLineId !== calScopeId &&
        !(allowedAssetIds && allowedAssetIds.has(wo.targetId))
      ) {
        return;
      }
      list.push({
        id: `wo-${wo.id}`,
        date: wo.dueDate,
        kind: 'work-order',
        title: `${wo.woNumber} · ${wo.serviceType}`,
        subtitle: `${wo.title} (${wo.assigneeName})`,
        assetId: wo.targetKind === 'asset' ? wo.targetId : undefined,
        status: wo.status,
      });
    });

    return list;
  }, [scene.assets, complianceByAssetId, workOrders, calScope, calScopeId, productionLines]);

  const calendarGrid = useMemo(() => {
    const first = new Date(calYear, calMonth, 1);
    const startDay = first.getDay(); // 0=Sun
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells: { iso: string | null; day: number | null }[] = [];
    for (let i = 0; i < startDay; i++) cells.push({ iso: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(calMonth + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      cells.push({ iso: `${calYear}-${mm}-${dd}`, day: d });
    }
    return cells;
  }, [calYear, calMonth]);

  // Eligible personnel for currently chosen Work Order asset & serviceType
  const woTargetAsset = scene.assets.find((a) => a.id === newWo.targetId) ?? scene.assets[0];
  const eligibleForWo = useMemo(() => {
    const cat = woTargetAsset?.category ?? 'Biopharmaceutical';
    const matches = getEligiblePersonnel(cat, newWo.serviceType);
    return matches.length > 0 ? matches : personnel.filter((p) => p.active);
  }, [woTargetAsset, newWo.serviceType, getEligiblePersonnel, personnel]);

  const filteredSops = useMemo(() => {
    const q = sopSearch.trim().toLowerCase();
    return sops.filter((d) => {
      if (sopCatFilter !== 'all' && d.equipmentCategory !== sopCatFilter) return false;
      if (sopActionFilter !== 'all' && d.actionType !== sopActionFilter) return false;
      if (!q) return true;
      return (
        d.docNumber.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        d.markdown.toLowerCase().includes(q)
      );
    });
  }, [sops, sopSearch, sopCatFilter, sopActionFilter]);

  const activeSop = useMemo(
    () => sops.find((s) => s.id === selectedSopId) ?? filteredSops[0] ?? null,
    [sops, selectedSopId, filteredSops]
  );

  const filteredWiki = useMemo(() => {
    const q = wikiSearch.trim().toLowerCase();
    return wikiArticles.filter((w) => {
      if (wikiCatFilter !== 'all' && w.category !== wikiCatFilter) return false;
      if (!q) return true;
      return (
        w.title.toLowerCase().includes(q) ||
        w.tags.some((t) => t.toLowerCase().includes(q)) ||
        w.markdown.toLowerCase().includes(q)
      );
    });
  }, [wikiArticles, wikiSearch, wikiCatFilter]);

  const activeWiki = useMemo(
    () => wikiArticles.find((w) => w.id === selectedWikiId) ?? filteredWiki[0] ?? null,
    [wikiArticles, selectedWikiId, filteredWiki]
  );

  const overdueWoCount = workOrders.filter((w) => w.status === 'overdue').length;
  const activeWorkflowCount = workflows.filter((w) => w.status !== 'completed').length;
  const gxpTelemetryAlertCount = useMemo(() => {
    let count = 0;
    for (const s of telemetrySensors) {
      const st = telemetryReadings[s.id]?.status;
      if (st === 'alarm' || st === 'warning') count++;
    }
    return count;
  }, [telemetrySensors, telemetryReadings]);

  if (!showGmpModal) return null;

  const tabs: { id: GmpModalTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'lines', label: 'Production Lines', icon: <GitBranch className="w-3.5 h-3.5" /> },
    { id: 'compliance', label: 'Cal / Qual & Audit', icon: <History className="w-3.5 h-3.5" /> },
    {
      id: 'predictive',
      label: 'Predictive & EMS AI',
      icon: <TrendingDown className="w-3.5 h-3.5" />,
      badge: gxpTelemetryAlertCount > 0 ? gxpTelemetryAlertCount : undefined,
    },
    {
      id: 'workflows',
      label: 'Workflows',
      icon: <Workflow className="w-3.5 h-3.5" />,
      badge: activeWorkflowCount > 0 ? activeWorkflowCount : undefined,
    },
    {
      id: 'workorders',
      label: 'Work Orders & Cron',
      icon: <ClipboardCheck className="w-3.5 h-3.5" />,
      badge: overdueWoCount > 0 ? overdueWoCount : undefined,
    },
    { id: 'calendar', label: 'Calendar', icon: <CalendarIcon className="w-3.5 h-3.5" /> },
    { id: 'sops', label: 'SOPs & Records', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'wiki', label: 'Troubleshoot Wiki', icon: <BookMarked className="w-3.5 h-3.5" /> },
  ];

  const handleToggleLineRoom = (roomId: string) => {
    if (creatingNewLine) {
      setLineForm((f) => ({
        ...f,
        roomIds: f.roomIds.includes(roomId)
          ? f.roomIds.filter((id) => id !== roomId)
          : [...f.roomIds, roomId],
      }));
    } else if (activeLine) {
      const next = activeLine.roomIds.includes(roomId)
        ? activeLine.roomIds.filter((id) => id !== roomId)
        : [...activeLine.roomIds, roomId];
      saveProductionLine({ ...activeLine, roomIds: next });
    }
  };

  const handleToggleLineAsset = (assetId: string) => {
    if (creatingNewLine) {
      setLineForm((f) => ({
        ...f,
        assetIds: f.assetIds.includes(assetId)
          ? f.assetIds.filter((id) => id !== assetId)
          : [...f.assetIds, assetId],
      }));
    } else if (activeLine) {
      const next = activeLine.assetIds.includes(assetId)
        ? activeLine.assetIds.filter((id) => id !== assetId)
        : [...activeLine.assetIds, assetId];
      saveProductionLine({ ...activeLine, assetIds: next });
    }
  };

  const exportAuditHistoryJson = () => {
    if (!activeAsset || !activeCompliance) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      standard: 'FDA 21 CFR Part 11 / EU GMP Annex 15',
      asset: {
        id: activeAsset.id,
        assetId: activeAsset.assetId,
        name: activeAsset.name,
        category: activeAsset.category,
        manufacturer: activeAsset.manufacturer,
        model: activeAsset.model,
        serialNumber: activeAsset.serialNumber,
      },
      compliance: activeCompliance,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GMP-Audit-${activeAsset.assetId}-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported 21 CFR Part 11 audit package for ${activeAsset.assetId}`, 'success');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4">
      <div
        className={`w-full max-w-7xl h-[91vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden ${
          isDark
            ? 'bg-[#111116] border-zinc-800 text-zinc-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Header Bar with Explicit Back Button */}
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b ${
            isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={closeGmpModal}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                isDark
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-amber-500 flex items-center justify-center text-white shadow-md shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold truncate">
                GMP Lifecycle, Production Line Eligibility, Work Orders & SOP Repository
              </h2>
              <p className={`text-[11px] truncate ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                21 CFR Part 11 Equipment Audit · Automated Eligibility Highlighting · Cron Scheduler · Markdown SOPs & Wiki
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeGmpModal}
            aria-label="Close"
            className={`p-1.5 rounded-xl transition cursor-pointer ${
              isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          className={`px-4 py-2 border-b flex items-center gap-1.5 overflow-x-auto ${
            isDark ? 'bg-[#13131A] border-zinc-800' : 'bg-white border-slate-200'
          }`}
        >
          {tabs.map((t) => {
            const active = gmpTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setGmpTab(t.id)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  active
                    ? 'bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-md shadow-violet-600/20'
                    : isDark
                      ? 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
                {t.badge !== undefined && (
                  <span className="ml-0.5 rounded-full bg-rose-500 text-white px-1.5 py-0.5 text-[9px] font-bold">
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ==================== TAB 1: PRODUCTION LINES & ELIGIBILITY ==================== */}
        {gmpTab === 'lines' && (
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            {/* Left List of Production Lines */}
            <div
              className={`lg:col-span-4 border-r flex flex-col overflow-hidden ${
                isDark ? 'border-zinc-800 bg-[#14141A]' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="p-3 border-b border-zinc-800/60 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-violet-400">
                  Production Lines ({productionLines.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingNewLine(true);
                    setLineForm({
                      code: `LINE-0${productionLines.length + 1}`,
                      name: '',
                      productFamily: '',
                      description: '',
                      owner: 'Dr. N. Rahimi',
                      color: '#8B5CF6',
                      targetBatchSize: '1,000 L',
                      status: 'active',
                      roomIds: [],
                      assetIds: [],
                    });
                  }}
                  className="flex items-center gap-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-2.5 py-1 text-[11px] font-bold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Line
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                {productionLines.map((line) => {
                  const res = eligibilityByLineId[line.id];
                  const isSel = !creatingNewLine && activeLine?.id === line.id;
                  return (
                    <div
                      key={line.id}
                      onClick={() => {
                        setCreatingNewLine(false);
                        setSelectedLineId(line.id);
                      }}
                      className={`rounded-2xl p-3 border transition cursor-pointer ${
                        isSel
                          ? 'bg-violet-600/15 border-violet-500/70'
                          : isDark
                            ? 'bg-[#17171F] border-zinc-800 hover:border-zinc-700'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: line.color }}
                          />
                          <span className="font-mono text-[11px] font-bold text-amber-400">
                            {line.code}
                          </span>
                        </div>
                        {res ? (
                          <span
                            className={`text-[9.5px] font-extrabold px-2 py-0.5 rounded-lg uppercase ${
                              res.eligible
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            }`}
                          >
                            {res.eligible ? 'ELIGIBLE' : `BLOCKED (${res.blockingCount})`}
                          </span>
                        ) : (
                          <span className="text-[9.5px] text-zinc-400 uppercase font-semibold">
                            {line.status}
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-bold mt-1 leading-snug">{line.name}</div>
                      <div className={`text-[10.5px] mt-1 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                        {line.roomIds.length} Rooms · {line.assetIds.length} Equipment · {line.owner}
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCreatingNewLine(false);
                            setSelectedLineId(line.id);
                            const out = checkLineEligibility(line.id, scene, true);
                            if (out) {
                              showToast(
                                out.eligible
                                  ? `${line.code} is ELIGIBLE — Highlighted Emerald on 2D/3D map`
                                  : `${line.code} BLOCKED (${out.blockingCount} issues) — Highlighted Red on map`,
                                out.eligible ? 'success' : 'error'
                              );
                            }
                          }}
                          className="flex-1 rounded-xl bg-gradient-to-r from-emerald-600 to-violet-600 hover:brightness-110 text-white py-1.5 text-[11px] font-bold transition cursor-pointer"
                        >
                          Check Eligibility & Highlight
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Graphical Line Master Data & Eligibility Detail */}
            <div className="lg:col-span-8 overflow-y-auto p-4 space-y-4">
              {creatingNewLine ? (
                <div
                  className={`rounded-2xl border p-4 space-y-3 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-violet-400">
                      Create New Production Line Master Data
                    </h3>
                    <button
                      type="button"
                      onClick={() => setCreatingNewLine(false)}
                      className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      value={lineForm.code}
                      onChange={(e) => setLineForm((f) => ({ ...f, code: e.target.value }))}
                      placeholder="Line Code (e.g. LINE-04)"
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                    <input
                      value={lineForm.name}
                      onChange={(e) => setLineForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Production Line Name"
                      className={`sm:col-span-2 rounded-xl border px-3 py-2 text-xs ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                    <input
                      value={lineForm.productFamily}
                      onChange={(e) => setLineForm((f) => ({ ...f, productFamily: e.target.value }))}
                      placeholder="Product Family / Modality"
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                    <input
                      value={lineForm.owner}
                      onChange={(e) => setLineForm((f) => ({ ...f, owner: e.target.value }))}
                      placeholder="Process Owner"
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                    <input
                      value={lineForm.targetBatchSize}
                      onChange={(e) => setLineForm((f) => ({ ...f, targetBatchSize: e.target.value }))}
                      placeholder="Target Batch Size"
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (!lineForm.name.trim()) {
                          showToast('Please enter a Production Line Name', 'info');
                          return;
                        }
                        const saved = saveProductionLine(lineForm);
                        setSelectedLineId(saved.id);
                        setCreatingNewLine(false);
                        showToast(`Saved Production Line ${saved.code}`, 'success');
                      }}
                      className="rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 text-xs font-bold cursor-pointer"
                    >
                      Save Production Line
                    </button>
                  </div>
                </div>
              ) : activeLine ? (
                <>
                  {/* Line Header & Eligibility Trigger */}
                  <div
                    className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
                      isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-amber-400">
                          {activeLine.code}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-lg bg-violet-500/20 text-violet-300 font-semibold">
                          {activeLine.productFamily}
                        </span>
                      </div>
                      <h3 className="text-base font-extrabold mt-1">{activeLine.name}</h3>
                      <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-600'}`}>
                        Owner: {activeLine.owner} · Batch: {activeLine.targetBatchSize}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          const res = checkLineEligibility(activeLine.id, scene, true);
                          if (res) {
                            showToast(
                              res.eligible
                                ? `${activeLine.code} ELIGIBLE — Map highlighted Emerald Green`
                                : `${activeLine.code} NOT ELIGIBLE — ${res.blockingCount} blocking issue(s) highlighted Red`,
                              res.eligible ? 'success' : 'error'
                            );
                          }
                        }}
                        className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 text-white px-4 py-2 text-xs font-extrabold shadow-lg hover:brightness-110 transition cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>Check Eligibility & Highlight Map</span>
                      </button>
                      {activeLineEligibility && (
                        <button
                          type="button"
                          onClick={closeGmpModal}
                          className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 text-xs font-bold cursor-pointer"
                        >
                          <Compass className="w-3.5 h-3.5" />
                          <span>View on 2D/3D Map</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          clearLineHighlight();
                          deleteProductionLine(activeLine.id);
                          showToast(`Deleted ${activeLine.code}`, 'info');
                        }}
                        title="Delete Line"
                        className="p-2 rounded-xl border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Eligibility Verdict Banner */}
                  {activeLineEligibility && (
                    <div
                      className={`rounded-2xl border-2 p-4 ${
                        activeLineEligibility.eligible
                          ? 'bg-emerald-500/10 border-emerald-500/60'
                          : 'bg-rose-500/10 border-rose-500/60'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          {activeLineEligibility.eligible ? (
                            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                          ) : (
                            <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0" />
                          )}
                          <div>
                            <div
                              className={`text-sm font-black uppercase tracking-wide ${
                                activeLineEligibility.eligible ? 'text-emerald-300' : 'text-rose-300'
                              }`}
                            >
                              {activeLineEligibility.eligible
                                ? 'PRODUCTION LINE ELIGIBLE FOR GMP BATCH RELEASE'
                                : `LINE NOT ELIGIBLE — ${activeLineEligibility.blockingCount} BLOCKING COMPLIANCE ISSUE(S)`}
                            </div>
                            <div className="text-[11px] opacity-80">
                              {activeLineEligibility.compliantRoomIds.length} Rooms OK ·{' '}
                              {activeLineEligibility.compliantAssetIds.length} Equipment OK ·{' '}
                              {activeLineEligibility.failingAssetIds.length} Equipment Failing ·{' '}
                              {activeLineEligibility.warningCount} Warning(s)
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={clearLineHighlight}
                          className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
                        >
                          Clear Map Highlight
                        </button>
                      </div>

                      {activeLineEligibility.issues.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {activeLineEligibility.issues.map((issue) => (
                            <div
                              key={issue.id}
                              className={`rounded-xl px-3 py-2 border flex flex-wrap items-center justify-between gap-2 text-xs ${
                                issue.severity === 'blocking'
                                  ? 'bg-rose-950/50 border-rose-500/40 text-rose-100'
                                  : 'bg-amber-950/40 border-amber-500/40 text-amber-100'
                              }`}
                            >
                              <div className="min-w-0">
                                <span className="font-mono font-bold mr-1.5">{issue.entityCode}</span>
                                <span className="font-semibold">{issue.entityName}:</span>{' '}
                                <span className="opacity-90">{issue.message}</span>
                              </div>
                              {issue.entityKind === 'asset' && (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedAssetId(issue.entityId);
                                      setGmpTab('compliance');
                                    }}
                                    className="rounded-lg bg-white/15 hover:bg-white/25 px-2 py-1 text-[10px] font-bold cursor-pointer"
                                  >
                                    Update Dates
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => flyToAssetIn3D(issue.entityId)}
                                    className="rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-2 py-1 text-[10px] font-bold cursor-pointer"
                                  >
                                    Locate 3D
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : null}

              {/* Graphical Multi-Select Rooms & Equipment Pickers */}
              {(creatingNewLine || activeLine) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Rooms Graphical Selector */}
                  <div
                    className={`rounded-2xl border p-3.5 ${
                      isDark ? 'bg-[#15151D] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-bold flex items-center gap-1.5 text-violet-400">
                        <Layers className="w-3.5 h-3.5" />
                        Assigned Cleanrooms / Suites (
                        {(creatingNewLine ? lineForm.roomIds : activeLine?.roomIds ?? []).length})
                      </span>
                    </div>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {scene.rooms.map((rm) => {
                        const selected = (
                          creatingNewLine ? lineForm.roomIds : activeLine?.roomIds ?? []
                        ).includes(rm.id);
                        return (
                          <button
                            key={rm.id}
                            type="button"
                            onClick={() => handleToggleLineRoom(rm.id)}
                            className={`w-full text-left rounded-xl px-3 py-2 border flex items-center justify-between gap-2 transition cursor-pointer ${
                              selected
                                ? 'bg-violet-600/20 border-violet-500/70'
                                : isDark
                                  ? 'bg-[#101016] border-zinc-800 hover:border-zinc-700'
                                  : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10.5px] font-bold text-amber-400">
                                  {rm.code}
                                </span>
                                <span className="text-xs font-semibold truncate">{rm.name}</span>
                              </div>
                              <div className="text-[10px] text-zinc-400">
                                {rm.environmental.cleanroomGrade} · +{rm.environmental.pressurePa} Pa
                              </div>
                            </div>
                            <span
                              className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                                rm.complianceStatus === 'deviation'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-emerald-500/15 text-emerald-300'
                              }`}
                            >
                              {selected ? 'IN LINE' : rm.complianceStatus}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Equipment Graphical Selector */}
                  <div
                    className={`rounded-2xl border p-3.5 ${
                      isDark ? 'bg-[#15151D] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-bold flex items-center gap-1.5 text-amber-400">
                        <Wrench className="w-3.5 h-3.5" />
                        Assigned Equipment Assets (
                        {(creatingNewLine ? lineForm.assetIds : activeLine?.assetIds ?? []).length})
                      </span>
                    </div>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {scene.assets.map((a) => {
                        const selected = (
                          creatingNewLine ? lineForm.assetIds : activeLine?.assetIds ?? []
                        ).includes(a.id);
                        const comp = complianceByAssetId[a.id];
                        const hasOverdue =
                          comp?.calibration.status === 'overdue' ||
                          comp?.qualification.status === 'overdue' ||
                          comp?.maintenance.status === 'overdue';
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => handleToggleLineAsset(a.id)}
                            className={`w-full text-left rounded-xl px-3 py-2 border flex items-center justify-between gap-2 transition cursor-pointer ${
                              selected
                                ? hasOverdue
                                  ? 'bg-rose-500/15 border-rose-500/70'
                                  : 'bg-emerald-500/15 border-emerald-500/60'
                                : isDark
                                  ? 'bg-[#101016] border-zinc-800 hover:border-zinc-700'
                                  : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    hasOverdue ? 'bg-rose-500' : 'bg-emerald-400'
                                  }`}
                                />
                                <span className="font-mono text-[10.5px] font-bold">
                                  {a.assetId}
                                </span>
                                <span className="text-xs font-semibold truncate">{a.name}</span>
                              </div>
                              <div className="text-[10px] text-zinc-400 pl-3.5">
                                Cal: {comp?.calibration.nextDueDate ?? '—'} · PQ:{' '}
                                {comp?.qualification.nextDueDate ?? '—'}
                              </div>
                            </div>
                            <span
                              className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase shrink-0 ${
                                selected
                                  ? hasOverdue
                                    ? 'bg-rose-500 text-white'
                                    : 'bg-emerald-500 text-zinc-950'
                                  : isDark
                                    ? 'bg-zinc-800 text-zinc-400'
                                    : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {selected ? (hasOverdue ? 'OVERDUE' : 'ASSIGNED') : 'ADD'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== TAB 2: EQUIPMENT COMPLIANCE & LIFECYCLE AUDIT HISTORY ==================== */}
        {gmpTab === 'compliance' && (
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            {/* Left Equipment List */}
            <div
              className={`lg:col-span-4 border-r flex flex-col overflow-hidden ${
                isDark ? 'border-zinc-800 bg-[#14141A]' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="p-3 border-b border-zinc-800/60">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                    placeholder="Search equipment tag, name..."
                    className={`w-full rounded-xl border pl-8 pr-3 py-1.5 text-xs outline-none ${
                      isDark ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100' : 'bg-white border-slate-300'
                    }`}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {scene.assets
                  .filter(
                    (a) =>
                      !assetSearch.trim() ||
                      a.name.toLowerCase().includes(assetSearch.toLowerCase()) ||
                      a.assetId.toLowerCase().includes(assetSearch.toLowerCase())
                  )
                  .map((a) => {
                    const comp = complianceByAssetId[a.id];
                    const bad =
                      comp?.calibration.status === 'overdue' ||
                      comp?.qualification.status === 'overdue' ||
                      comp?.maintenance.status === 'overdue';
                    const warn =
                      !bad &&
                      (comp?.calibration.status === 'due-soon' ||
                        comp?.qualification.status === 'due-soon' ||
                        comp?.maintenance.status === 'due-soon');
                    const active = activeAsset?.id === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setSelectedAssetId(a.id)}
                        className={`w-full text-left rounded-xl p-2.5 border transition cursor-pointer ${
                          active
                            ? 'bg-violet-600/15 border-violet-500/70'
                            : isDark
                              ? 'bg-[#17171F] border-zinc-800/80 hover:border-zinc-700'
                              : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold">{a.assetId}</span>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                              bad
                                ? 'bg-rose-500/20 text-rose-300'
                                : warn
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {bad ? 'OVERDUE' : warn ? 'DUE SOON' : 'COMPLIANT'}
                          </span>
                        </div>
                        <div className="text-xs font-semibold truncate mt-0.5">{a.name}</div>
                        <div className="text-[10px] text-zinc-400 truncate">
                          Owner: {comp?.owner ?? a.owner}
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Right Compliance Dates Editor + Full Audit Lifecycle Timeline */}
            <div className="lg:col-span-8 overflow-y-auto p-4 space-y-4">
              {activeAsset && activeCompliance && (
                <>
                  {/* Equipment Header */}
                  <div
                    className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
                      isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-amber-400">
                          {activeAsset.assetId}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-lg bg-violet-500/20 text-violet-300 font-semibold">
                          {activeAsset.category}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 font-semibold uppercase">
                          {activeCompliance.gmpCriticality}
                        </span>
                      </div>
                      <h3 className="text-base font-extrabold mt-1">{activeAsset.name}</h3>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        {activeAsset.manufacturer} {activeAsset.model} · S/N {activeAsset.serialNumber}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => flyToAssetIn3D(activeAsset.id)}
                        className="flex items-center gap-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 text-xs font-bold cursor-pointer"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        3D
                      </button>
                      <button
                        type="button"
                        onClick={() => openQrLabelModal('designer', [activeAsset.id])}
                        className="flex items-center gap-1 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 px-3 py-1.5 text-xs font-bold cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        QR Label
                      </button>
                      <button
                        type="button"
                        onClick={exportAuditHistoryJson}
                        className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold border cursor-pointer ${
                          isDark
                            ? 'bg-zinc-900 border-zinc-700 hover:border-violet-500'
                            : 'bg-white border-slate-300'
                        }`}
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        Audit Export
                      </button>
                    </div>
                  </div>

                  {/* Calibration / Qualification / Maintenance Editable Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {(
                      [
                        { key: 'calibration', title: 'Calibration', cycle: activeCompliance.calibration },
                        {
                          key: 'qualification',
                          title: `Qualification (${activeCompliance.qualification.stage})`,
                          cycle: activeCompliance.qualification,
                        },
                        { key: 'maintenance', title: 'Preventive Maintenance', cycle: activeCompliance.maintenance },
                      ] as const
                    ).map((item) => (
                      <div
                        key={item.key}
                        className={`rounded-2xl border p-3.5 space-y-2 ${
                          item.cycle.status === 'overdue'
                            ? 'bg-rose-500/10 border-rose-500/50'
                            : item.cycle.status === 'due-soon'
                              ? 'bg-amber-500/10 border-amber-500/50'
                              : isDark
                                ? 'bg-[#15151D] border-zinc-800'
                                : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{item.title}</span>
                          <span
                            className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${
                              item.cycle.status === 'overdue'
                                ? 'bg-rose-500 text-white'
                                : item.cycle.status === 'due-soon'
                                  ? 'bg-amber-500 text-zinc-950'
                                  : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {item.cycle.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[9.5px] text-zinc-400 block">Last Date</label>
                            <input
                              type="date"
                              value={item.cycle.lastDate}
                              onChange={(e) =>
                                updateCompliance(activeAsset.id, {
                                  [item.key]: { lastDate: e.target.value },
                                })
                              }
                              className={`w-full rounded-lg border px-1.5 py-1 text-[11px] font-mono ${
                                isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                              }`}
                            />
                          </div>
                          <div>
                            <label className="text-[9.5px] text-zinc-400 block">Next Due Date</label>
                            <input
                              type="date"
                              value={item.cycle.nextDueDate}
                              onChange={(e) =>
                                updateCompliance(activeAsset.id, {
                                  [item.key]: { nextDueDate: e.target.value },
                                })
                              }
                              className={`w-full rounded-lg border px-1.5 py-1 text-[11px] font-mono ${
                                isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                              }`}
                            />
                          </div>
                        </div>

                        <div className="text-[10px] text-zinc-400 flex items-center justify-between pt-1">
                          <span className="font-mono truncate">{item.cycle.certificateOrProtocol}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const today = todayIso();
                              const next = addDaysToIso(today, item.cycle.intervalDays || 180);
                              updateCompliance(activeAsset.id, {
                                [item.key]: { lastDate: today, nextDueDate: next },
                              });
                              addLifecycleEvent(activeAsset.id, {
                                date: today,
                                stage:
                                  item.key === 'calibration'
                                    ? 'calibration'
                                    : item.key === 'qualification'
                                      ? 'qualification-oq-pq'
                                      : 'maintenance',
                                title: `Renewed ${item.title} (Next due ${next})`,
                                performedBy: item.cycle.performedBy,
                                referenceDoc: item.cycle.certificateOrProtocol,
                                outcome: 'pass',
                                notes: 'Compliance cycle completed and verified under GMP audit log.',
                              });
                              showToast(`${item.title} renewed through ${next}`, 'success');
                            }}
                            className="text-violet-400 hover:text-violet-300 font-bold shrink-0 cursor-pointer"
                          >
                            Renew Now
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* System Owner & Department */}
                  <div
                    className={`rounded-2xl border p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3 ${
                      isDark ? 'bg-[#15151D] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">System Owner</label>
                      <input
                        value={activeCompliance.owner}
                        onChange={(e) =>
                          updateCompliance(activeAsset.id, { owner: e.target.value })
                        }
                        className={`w-full rounded-xl border px-2.5 py-1.5 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-slate-50 border-slate-300'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">Department</label>
                      <input
                        value={activeCompliance.department}
                        onChange={(e) =>
                          updateCompliance(activeAsset.id, { department: e.target.value })
                        }
                        className={`w-full rounded-xl border px-2.5 py-1.5 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-slate-50 border-slate-300'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">GMP Impact Class</label>
                      <select
                        value={activeCompliance.gmpCriticality}
                        onChange={(e) =>
                          updateCompliance(activeAsset.id, {
                            gmpCriticality: e.target.value as 'direct-impact' | 'indirect-impact' | 'no-impact',
                          })
                        }
                        className={`w-full rounded-xl border px-2.5 py-1.5 text-xs cursor-pointer ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-slate-50 border-slate-300'
                        }`}
                      >
                        <option value="direct-impact">Direct GMP Impact</option>
                        <option value="indirect-impact">Indirect GMP Impact</option>
                        <option value="no-impact">Non-GMP / Utility</option>
                      </select>
                    </div>
                  </div>

                  {/* Full Historical Lifecycle Timeline (Pharma Audit Trail) */}
                  <div
                    className={`rounded-2xl border p-4 ${
                      isDark ? 'bg-[#15151D] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-violet-400">
                          Full Equipment Lifecycle & Audit History ({activeCompliance.lifecycleEvents.length})
                        </h4>
                        <p className="text-[10.5px] text-zinc-400">
                          Procurement · FAT/SAT · IQ/OQ/PQ · Owner Handovers · Calibration · PM · Deviations
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAddEvent((v) => !v)}
                        className="flex items-center gap-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 text-[11px] font-bold cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Log Lifecycle Event
                      </button>
                    </div>

                    {showAddEvent && (
                      <div
                        className={`mb-4 rounded-xl border p-3 space-y-2 ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <select
                            value={newEvent.stage}
                            onChange={(e) =>
                              setNewEvent((f) => ({
                                ...f,
                                stage: e.target.value as EquipmentLifecycleEvent['stage'],
                              }))
                            }
                            className={`rounded-lg border px-2 py-1.5 text-xs ${
                              isDark ? 'bg-[#17171F] border-zinc-700' : 'bg-white border-slate-300'
                            }`}
                          >
                            <option value="calibration">Calibration</option>
                            <option value="qualification-oq-pq">Qualification (OQ/PQ)</option>
                            <option value="maintenance">Preventive Maintenance</option>
                            <option value="owner-change">Owner Handover</option>
                            <option value="deviation-capa">Deviation / CAPA</option>
                            <option value="work-order">Work Order</option>
                          </select>
                          <input
                            value={newEvent.title}
                            onChange={(e) => setNewEvent((f) => ({ ...f, title: e.target.value }))}
                            placeholder="Event Title"
                            className={`sm:col-span-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                              isDark ? 'bg-[#17171F] border-zinc-700' : 'bg-white border-slate-300'
                            }`}
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            value={newEvent.performedBy}
                            onChange={(e) => setNewEvent((f) => ({ ...f, performedBy: e.target.value }))}
                            placeholder="Performed By"
                            className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                              isDark ? 'bg-[#17171F] border-zinc-700' : 'bg-white border-slate-300'
                            }`}
                          />
                          <input
                            value={newEvent.referenceDoc}
                            onChange={(e) => setNewEvent((f) => ({ ...f, referenceDoc: e.target.value }))}
                            placeholder="Ref Cert / Protocol #"
                            className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                              isDark ? 'bg-[#17171F] border-zinc-700' : 'bg-white border-slate-300'
                            }`}
                          />
                          <select
                            value={newEvent.outcome}
                            onChange={(e) =>
                              setNewEvent((f) => ({
                                ...f,
                                outcome: e.target.value as EquipmentLifecycleEvent['outcome'],
                              }))
                            }
                            className={`rounded-lg border px-2 py-1.5 text-xs ${
                              isDark ? 'bg-[#17171F] border-zinc-700' : 'bg-white border-slate-300'
                            }`}
                          >
                            <option value="pass">PASS</option>
                            <option value="conditional">CONDITIONAL</option>
                            <option value="fail">FAIL</option>
                            <option value="info">INFO</option>
                          </select>
                        </div>
                        <textarea
                          rows={2}
                          value={newEvent.notes}
                          onChange={(e) => setNewEvent((f) => ({ ...f, notes: e.target.value }))}
                          placeholder="Audit observations, calibration tolerance notes, or CAPA details..."
                          className={`w-full rounded-lg border px-2.5 py-1.5 text-xs ${
                            isDark ? 'bg-[#17171F] border-zinc-700' : 'bg-white border-slate-300'
                          }`}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowAddEvent(false)}
                            className="text-xs px-3 py-1 text-zinc-400 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!newEvent.title.trim()) return;
                              addLifecycleEvent(activeAsset.id, {
                                date: todayIso(),
                                stage: newEvent.stage,
                                title: newEvent.title,
                                performedBy: newEvent.performedBy,
                                ownerSnapshot: activeCompliance.owner,
                                referenceDoc: newEvent.referenceDoc || `AUD-${Date.now().toString().slice(-4)}`,
                                outcome: newEvent.outcome,
                                notes: newEvent.notes,
                              });
                              setShowAddEvent(false);
                              setNewEvent((f) => ({ ...f, title: '', notes: '' }));
                              showToast('Recorded immutable GMP lifecycle event', 'success');
                            }}
                            className="rounded-lg bg-emerald-600 text-white px-3 py-1 text-xs font-bold cursor-pointer"
                          >
                            Save Audit Entry
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2.5">
                      {activeCompliance.lifecycleEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className={`relative pl-4 border-l-2 ${
                            ev.outcome === 'fail'
                              ? 'border-rose-500'
                              : ev.outcome === 'conditional'
                                ? 'border-amber-500'
                                : 'border-violet-500/70'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10.5px] font-bold text-amber-400">
                                {ev.date}
                              </span>
                              <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-bold uppercase">
                                {ev.stage}
                              </span>
                              {ev.referenceDoc && (
                                <span className="font-mono text-[10px] text-zinc-400">
                                  {ev.referenceDoc}
                                </span>
                              )}
                            </div>
                            <span
                              className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                                ev.outcome === 'pass'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : ev.outcome === 'fail'
                                    ? 'bg-rose-500/20 text-rose-300'
                                    : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {ev.outcome}
                            </span>
                          </div>
                          <div className="text-xs font-bold mt-0.5">{ev.title}</div>
                          <p className={`text-[11px] mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-600'}`}>
                            {ev.notes}
                          </p>
                          <div className="text-[10px] text-zinc-500 mt-0.5">
                            By: {ev.performedBy}
                            {ev.ownerSnapshot ? ` · System Owner: ${ev.ownerSnapshot}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ==================== TAB 3: WORK ORDERS, TASK INBOX, CRON JOBS & ELIGIBLE PERSONNEL ==================== */}
        {gmpTab === 'workorders' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Sub-Tab Bar */}
            <div
              className={`px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 ${
                isDark ? 'bg-[#14141A] border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { id: 'inbox', label: `Task Inbox (${workOrders.length})` },
                    { id: 'create', label: '+ Create Work Order' },
                    { id: 'cron', label: `Cron Auto-Scheduler (${cronJobs.length})` },
                    { id: 'personnel', label: `Eligible Personnel (${personnel.length})` },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setWoSubTab(st.id)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                      woSubTab === st.id
                        ? 'bg-amber-500 text-zinc-950'
                        : isDark
                          ? 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                          : 'bg-white text-slate-700 border border-slate-200'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
              {woSubTab === 'inbox' && (
                <div className="flex items-center gap-1">
                  {(['all', 'overdue', 'open', 'in-progress', 'waiting-qa', 'completed'] as const).map(
                    (st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setWoStatusFilter(st)}
                        className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase cursor-pointer ${
                          woStatusFilter === st
                            ? 'bg-violet-600 text-white'
                            : isDark
                              ? 'bg-zinc-900 text-zinc-400'
                              : 'bg-white text-slate-600 border border-slate-200'
                        }`}
                      >
                        {st}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* SUB-TAB: TASK INBOX */}
              {woSubTab === 'inbox' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {workOrders
                    .filter((w) => woStatusFilter === 'all' || w.status === woStatusFilter)
                    .map((wo) => (
                      <div
                        key={wo.id}
                        className={`rounded-2xl border p-4 flex flex-col gap-2.5 ${
                          wo.status === 'overdue'
                            ? 'bg-rose-500/10 border-rose-500/50'
                            : isDark
                              ? 'bg-[#17171F] border-zinc-800'
                              : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-xs font-bold text-amber-400">
                                {wo.woNumber}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-bold uppercase">
                                {wo.serviceType}
                              </span>
                              <span
                                className={`text-[9.5px] px-1.5 py-0.5 rounded font-black uppercase ${
                                  wo.priority === 'critical'
                                    ? 'bg-rose-500 text-white'
                                    : wo.priority === 'high'
                                      ? 'bg-amber-500 text-zinc-950'
                                      : 'bg-zinc-700 text-zinc-200'
                                }`}
                              >
                                {wo.priority}
                              </span>
                            </div>
                            <h4 className="text-xs font-extrabold mt-1">{wo.title}</h4>
                            <p className="text-[11px] text-zinc-400 mt-0.5">{wo.description}</p>
                          </div>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg uppercase shrink-0 ${
                              wo.status === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : wo.status === 'overdue'
                                  ? 'bg-rose-500 text-white'
                                  : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {wo.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-[10.5px] rounded-xl bg-black/20 p-2">
                          <div>
                            <span className="text-zinc-400 block text-[9.5px]">Assignee</span>
                            <span className="font-semibold">{wo.assigneeName}</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 block text-[9.5px]">Last Service</span>
                            <span className="font-mono">{wo.lastServiceDate}</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 block text-[9.5px]">Due Date</span>
                            <span className="font-mono font-bold text-amber-300">{wo.dueDate}</span>
                          </div>
                        </div>

                        {/* Checklist */}
                        <div className="space-y-1">
                          {wo.checklist.map((chk) => (
                            <label
                              key={chk.id}
                              className="flex items-center gap-2 text-[11px] cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={chk.done}
                                onChange={() => toggleWorkOrderChecklist(wo.id, chk.id)}
                                className="accent-violet-500"
                              />
                              <span className={chk.done ? 'line-through opacity-55' : ''}>
                                {chk.text}
                              </span>
                            </label>
                          ))}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/60">
                          <div className="flex items-center gap-1.5">
                            {wo.sopId && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSopId(wo.sopId!);
                                  setGmpTab('sops');
                                }}
                                className="rounded-lg bg-violet-500/15 text-violet-300 px-2 py-1 text-[10px] font-bold hover:bg-violet-500/25 cursor-pointer"
                              >
                                Open Linked SOP
                              </button>
                            )}
                            {wo.targetKind === 'asset' && (
                              <button
                                type="button"
                                onClick={() => flyToAssetIn3D(wo.targetId)}
                                className="rounded-lg bg-zinc-800 text-zinc-200 px-2 py-1 text-[10px] font-bold hover:bg-zinc-700 cursor-pointer"
                              >
                                Locate 3D
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {wo.status !== 'completed' && (
                              <>
                                {wo.status !== 'in-progress' && (
                                  <button
                                    type="button"
                                    onClick={() => updateWorkOrderStatus(wo.id, 'in-progress')}
                                    className="rounded-lg bg-amber-500/20 text-amber-300 px-2.5 py-1 text-[10.5px] font-bold hover:bg-amber-500/30 cursor-pointer"
                                  >
                                    Start
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateWorkOrderStatus(wo.id, 'completed');
                                    showToast(
                                      `Closed ${wo.woNumber} & rolled forward next compliance due date!`,
                                      'success'
                                    );
                                  }}
                                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 text-[10.5px] font-bold cursor-pointer"
                                >
                                  Complete & Roll Dates
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => deleteWorkOrder(wo.id)}
                              className="p-1 text-rose-400 hover:bg-rose-500/15 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {/* SUB-TAB: CREATE WORK ORDER */}
              {woSubTab === 'create' && (
                <div
                  className={`max-w-3xl mx-auto rounded-2xl border p-5 space-y-3.5 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <h3 className="text-sm font-extrabold text-violet-400">
                    Create GMP Work Order (Auto-Filtered Eligible Personnel)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">Target Equipment</label>
                      <select
                        value={newWo.targetId}
                        onChange={(e) => setNewWo((f) => ({ ...f, targetId: e.target.value }))}
                        className={`w-full rounded-xl border px-3 py-2 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      >
                        {scene.assets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.assetId} · {a.name} ({a.category})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">Service Action Type</label>
                      <select
                        value={newWo.serviceType}
                        onChange={(e) =>
                          setNewWo((f) => ({ ...f, serviceType: e.target.value as ServiceActionType }))
                        }
                        className={`w-full rounded-xl border px-3 py-2 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      >
                        {SERVICE_TYPES.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] text-zinc-400 block mb-1">Work Order Title</label>
                      <input
                        value={newWo.title}
                        onChange={(e) => setNewWo((f) => ({ ...f, title: e.target.value }))}
                        placeholder="e.g. Semi-Annual RTD & Pressure Transmitter Calibration"
                        className={`w-full rounded-xl border px-3 py-2 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-emerald-400 font-bold block mb-1">
                        Eligible Certified Personnel ({eligibleForWo.length} qualified for{' '}
                        {woTargetAsset?.category})
                      </label>
                      <select
                        value={newWo.assigneeId || eligibleForWo[0]?.id || ''}
                        onChange={(e) => setNewWo((f) => ({ ...f, assigneeId: e.target.value }))}
                        className={`w-full rounded-xl border px-3 py-2 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-emerald-500/40' : 'bg-white border-emerald-400'
                        }`}
                      >
                        {eligibleForWo.map((p) => (
                          <option key={p.id} value={p.id}>
                            ✓ {p.name} ({p.role} · {p.badgeId})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">Linked SOP / Record</label>
                      <select
                        value={newWo.sopId}
                        onChange={(e) => setNewWo((f) => ({ ...f, sopId: e.target.value }))}
                        className={`w-full rounded-xl border px-3 py-2 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      >
                        {sops.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.docNumber} · {d.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">Last Service Date</label>
                      <input
                        type="date"
                        value={newWo.lastServiceDate}
                        onChange={(e) => setNewWo((f) => ({ ...f, lastServiceDate: e.target.value }))}
                        className={`w-full rounded-xl border px-3 py-2 text-xs font-mono ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">Target Due Date</label>
                      <input
                        type="date"
                        value={newWo.dueDate}
                        onChange={(e) => setNewWo((f) => ({ ...f, dueDate: e.target.value }))}
                        className={`w-full rounded-xl border px-3 py-2 text-xs font-mono ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">Priority</label>
                      <select
                        value={newWo.priority}
                        onChange={(e) =>
                          setNewWo((f) => ({ ...f, priority: e.target.value as WorkOrderPriority }))
                        }
                        className={`w-full rounded-xl border px-3 py-2 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      >
                        <option value="critical">Critical (Blocks Line Release)</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-1">Production Line</label>
                      <select
                        value={newWo.productionLineId}
                        onChange={(e) => setNewWo((f) => ({ ...f, productionLineId: e.target.value }))}
                        className={`w-full rounded-xl border px-3 py-2 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      >
                        <option value="">None / Facility-Wide</option>
                        {productionLines.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code} · {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] text-zinc-400 block mb-1">Scope & Instructions</label>
                      <textarea
                        rows={2}
                        value={newWo.description}
                        onChange={(e) => setNewWo((f) => ({ ...f, description: e.target.value }))}
                        placeholder="Specify calibration points, replacement gaskets, or QA sign-off requirements..."
                        className={`w-full rounded-xl border px-3 py-2 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (!woTargetAsset) return;
                        const tech =
                          personnel.find((p) => p.id === (newWo.assigneeId || eligibleForWo[0]?.id)) ??
                          eligibleForWo[0];
                        const created = createWorkOrder({
                          title:
                            newWo.title.trim() ||
                            `${newWo.serviceType.toUpperCase()} — ${woTargetAsset.assetId}`,
                          description:
                            newWo.description.trim() ||
                            `Scheduled ${newWo.serviceType} for ${woTargetAsset.name}.`,
                          serviceType: newWo.serviceType,
                          targetKind: 'asset',
                          targetId: woTargetAsset.id,
                          targetName: `${woTargetAsset.name} (${woTargetAsset.assetId})`,
                          targetCategory: woTargetAsset.category,
                          productionLineId: newWo.productionLineId || undefined,
                          assigneeId: tech?.id ?? 'tech-tavakoli',
                          assigneeName: tech?.name ?? 'Reza Tavakoli',
                          priority: newWo.priority,
                          status: 'open',
                          lastServiceDate: newWo.lastServiceDate,
                          dueDate: newWo.dueDate,
                          estimatedHours: newWo.estimatedHours,
                          sopId: newWo.sopId || undefined,
                          checklist: [
                            { id: 'c1', text: 'Verify safety lock-out & linked SOP version', done: false },
                            { id: 'c2', text: `Perform ${newWo.serviceType} & record test values`, done: false },
                            { id: 'c3', text: 'QA verification & update physical QR sticker', done: false },
                          ],
                        });
                        showToast(`Created Work Order ${created.woNumber}`, 'success');
                        setWoSubTab('inbox');
                      }}
                      className="rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 text-white px-5 py-2 text-xs font-extrabold cursor-pointer"
                    >
                      Create & Dispatch Work Order
                    </button>
                  </div>
                </div>
              )}

              {/* SUB-TAB: CRON AUTO-SCHEDULER */}
              {woSubTab === 'cron' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {cronJobs.map((job) => (
                      <div
                        key={job.id}
                        className={`rounded-2xl border p-4 flex flex-col gap-2.5 ${
                          isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-violet-500/20 text-violet-300">
                                {job.cronExpression}
                              </span>
                              <span className="text-[10px] text-amber-400 font-semibold uppercase">
                                {job.serviceType}
                              </span>
                            </div>
                            <h4 className="text-xs font-extrabold mt-1">{job.name}</h4>
                            <p className="text-[11px] text-zinc-400">
                              {job.humanSchedule} · Target: {job.targetName}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleCronJob(job.id)}
                            className={`rounded-lg px-2 py-1 text-[10px] font-bold cursor-pointer ${
                              job.enabled
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {job.enabled ? 'ACTIVE' : 'PAUSED'}
                          </button>
                        </div>
                        <div className="flex items-center justify-between text-[10.5px] text-zinc-400 pt-1">
                          <span>
                            Next Run: <strong className="font-mono text-zinc-200">{job.nextRunAt}</strong>
                          </span>
                          <span>Spawned: {job.generatedCount} WOs</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/60">
                          <button
                            type="button"
                            onClick={() => runCronJobNow(job.id)}
                            className="flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 text-[11px] font-bold cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                            Run Cron Now (Generate Next WO)
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteCronJob(job.id)}
                            className="p-1.5 text-rose-400 hover:bg-rose-500/15 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add Cron Job Form */}
                  <div
                    className={`rounded-2xl border p-4 space-y-3 ${
                      isDark ? 'bg-[#15151D] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                      + Add Recurring Cron Rule
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <input
                        value={newCron.name}
                        onChange={(e) => setNewCron((c) => ({ ...c, name: e.target.value }))}
                        placeholder="Cron Job Name"
                        className={`rounded-xl border px-3 py-2 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      />
                      <input
                        value={newCron.cronExpression}
                        onChange={(e) => setNewCron((c) => ({ ...c, cronExpression: e.target.value }))}
                        placeholder="Cron (e.g. 0 6 1 */3 *)"
                        className={`rounded-xl border px-3 py-2 text-xs font-mono ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      />
                      <select
                        value={newCron.targetId}
                        onChange={(e) => setNewCron((c) => ({ ...c, targetId: e.target.value }))}
                        className={`rounded-xl border px-3 py-2 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      >
                        {scene.assets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.assetId} · {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          const target = scene.assets.find((a) => a.id === newCron.targetId) ?? scene.assets[0];
                          if (!target) return;
                          addCronJob({
                            name: newCron.name.trim() || `Recurring ${newCron.serviceType} · ${target.assetId}`,
                            cronExpression: newCron.cronExpression,
                            humanSchedule: `Every ${newCron.intervalDays} days`,
                            enabled: true,
                            serviceType: newCron.serviceType,
                            targetKind: 'asset',
                            targetId: target.id,
                            targetName: `${target.name} (${target.assetId})`,
                            targetCategory: target.category,
                            intervalDays: newCron.intervalDays,
                            defaultAssigneeId: newCron.defaultAssigneeId,
                            priority: newCron.priority,
                            sopId: newCron.sopId,
                            nextRunAt: addDaysToIso(todayIso(), 14),
                          });
                          setNewCron((c) => ({ ...c, name: '' }));
                          showToast('Added automated Cron scheduler rule', 'success');
                        }}
                        className="rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 px-4 py-1.5 text-xs font-bold cursor-pointer"
                      >
                        Save Cron Job
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SUB-TAB: ELIGIBLE PERSONNEL MATRIX */}
              {woSubTab === 'personnel' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {personnel.map((p) => (
                      <div
                        key={p.id}
                        className={`rounded-2xl border p-3.5 space-y-2 ${
                          isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-violet-600/20 text-violet-300 flex items-center justify-center font-bold text-xs">
                              <UserCheck className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-xs font-extrabold">{p.name}</div>
                              <div className="text-[10px] text-zinc-400">{p.role}</div>
                            </div>
                          </div>
                          <span className="font-mono text-[10px] text-amber-400">{p.badgeId}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {p.certifiedCategories.map((c) => (
                            <span
                              key={c}
                              className="text-[9.5px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-semibold"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {p.certifiedServices.map((s) => (
                            <span
                              key={s}
                              className="text-[9.5px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-semibold uppercase"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                        <div className="text-[10px] text-zinc-500 pt-1">
                          Cert Valid Until: <span className="font-mono text-zinc-300">{p.certExpiry}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Quick Add Certified Technician */}
                  <div
                    className={`rounded-2xl border p-4 space-y-3 ${
                      isDark ? 'bg-[#15151D] border-zinc-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <h4 className="text-xs font-extrabold text-emerald-400 uppercase tracking-wider">
                      + Certify Eligible Technician for Equipment Types
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        value={newTech.name}
                        onChange={(e) => setNewTech((t) => ({ ...t, name: e.target.value }))}
                        placeholder="Full Name"
                        className={`rounded-xl border px-3 py-1.5 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      />
                      <input
                        value={newTech.role}
                        onChange={(e) => setNewTech((t) => ({ ...t, role: e.target.value }))}
                        placeholder="Role / Certification"
                        className={`rounded-xl border px-3 py-1.5 text-xs ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      />
                      <input
                        value={newTech.badgeId}
                        onChange={(e) => setNewTech((t) => ({ ...t, badgeId: e.target.value }))}
                        placeholder="Badge ID"
                        className={`rounded-xl border px-3 py-1.5 text-xs font-mono ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {EQUIPMENT_CATEGORIES.map((cat) => {
                        const on = newTech.certifiedCategories.includes(cat);
                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() =>
                              setNewTech((t) => ({
                                ...t,
                                certifiedCategories: on
                                  ? t.certifiedCategories.filter((c) => c !== cat)
                                  : [...t.certifiedCategories, cat],
                              }))
                            }
                            className={`rounded-lg px-2 py-1 text-[10px] font-bold border cursor-pointer ${
                              on
                                ? 'bg-violet-600 text-white border-violet-500'
                                : isDark
                                  ? 'bg-zinc-900 border-zinc-700 text-zinc-400'
                                  : 'bg-white border-slate-300 text-slate-600'
                            }`}
                          >
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          if (!newTech.name.trim()) return;
                          addTechnician({
                            ...newTech,
                            role: newTech.role || 'Certified GMP Service Engineer',
                            email: newTech.email || 'tech@cinnagen.example',
                            active: true,
                          });
                          setNewTech((t) => ({ ...t, name: '', role: '' }));
                          showToast(`Added certified technician ${newTech.name}`, 'success');
                        }}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 text-xs font-bold cursor-pointer"
                      >
                        Save Technician Certification
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== TAB 4: COMPLIANCE & PRODUCTION LINE CALENDAR ==================== */}
        {gmpTab === 'calendar' && (
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            <div className="lg:col-span-8 flex flex-col overflow-hidden p-4">
              {/* Calendar Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (calMonth === 0) {
                        setCalMonth(11);
                        setCalYear((y) => y - 1);
                      } else setCalMonth((m) => m - 1);
                    }}
                    className={`p-1.5 rounded-xl border cursor-pointer ${
                      isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                    }`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-extrabold min-w-[140px] text-center">
                    {new Date(calYear, calMonth, 1).toLocaleString('en-US', {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (calMonth === 11) {
                        setCalMonth(0);
                        setCalYear((y) => y + 1);
                      } else setCalMonth((m) => m + 1);
                    }}
                    className={`p-1.5 rounded-xl border cursor-pointer ${
                      isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'
                    }`}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const n = new Date();
                      setCalYear(n.getFullYear());
                      setCalMonth(n.getMonth());
                      setSelectedCalDate(todayIso());
                    }}
                    className="rounded-xl bg-violet-600/20 text-violet-300 px-2.5 py-1 text-[11px] font-bold cursor-pointer"
                  >
                    Today
                  </button>
                </div>

                {/* Scope Filter: All Facility / Production Line / Equipment */}
                <div className="flex items-center gap-1.5">
                  <select
                    value={calScope}
                    onChange={(e) => {
                      const next = e.target.value as 'all' | 'line' | 'asset';
                      setCalScope(next);
                      if (next === 'line') setCalScopeId(productionLines[0]?.id ?? '');
                      else if (next === 'asset') setCalScopeId(scene.assets[0]?.id ?? '');
                      else setCalScopeId('');
                    }}
                    className={`rounded-xl border px-2.5 py-1.5 text-xs cursor-pointer ${
                      isDark ? 'bg-[#17171F] border-zinc-700' : 'bg-white border-slate-300'
                    }`}
                  >
                    <option value="all">All Facility</option>
                    <option value="line">By Production Line</option>
                    <option value="asset">By Equipment</option>
                  </select>
                  {calScope === 'line' && (
                    <select
                      value={calScopeId}
                      onChange={(e) => setCalScopeId(e.target.value)}
                      className={`rounded-xl border px-2.5 py-1.5 text-xs cursor-pointer ${
                        isDark ? 'bg-[#17171F] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    >
                      {productionLines.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code} · {l.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {calScope === 'asset' && (
                    <select
                      value={calScopeId}
                      onChange={(e) => setCalScopeId(e.target.value)}
                      className={`rounded-xl border px-2.5 py-1.5 text-xs cursor-pointer ${
                        isDark ? 'bg-[#17171F] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    >
                      {scene.assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.assetId} · {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Weekday Headers */}
              <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[10px] font-bold uppercase text-zinc-400">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>

              {/* Month Grid */}
              <div className="flex-1 grid grid-cols-7 gap-1 overflow-y-auto">
                {calendarGrid.map((cell, idx) => {
                  if (!cell.iso) {
                    return <div key={`empty-${idx}`} className="rounded-xl opacity-20" />;
                  }
                  const dayEvents = calendarEvents.filter((ev) => ev.date === cell.iso);
                  const isToday = cell.iso === todayIso();
                  const isSel = cell.iso === selectedCalDate;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => setSelectedCalDate(cell.iso!)}
                      className={`min-h-[72px] rounded-xl border p-1.5 text-left flex flex-col gap-1 transition cursor-pointer ${
                        isSel
                          ? 'bg-violet-600/20 border-violet-500'
                          : isDark
                            ? 'bg-[#16161E] border-zinc-800 hover:border-zinc-700'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span
                        className={`text-[10.5px] font-mono font-bold ${
                          isToday ? 'text-amber-400' : isDark ? 'text-zinc-300' : 'text-slate-700'
                        }`}
                      >
                        {cell.day}
                      </span>
                      <div className="space-y-0.5 w-full overflow-hidden">
                        {dayEvents.slice(0, 3).map((ev) => (
                          <div
                            key={ev.id}
                            className={`truncate rounded px-1 py-0.5 text-[8.5px] font-bold ${
                              ev.kind === 'work-order'
                                ? 'bg-amber-500/25 text-amber-300'
                                : ev.kind === 'calibration'
                                  ? 'bg-violet-500/25 text-violet-300'
                                  : ev.kind === 'qualification'
                                    ? 'bg-emerald-500/25 text-emerald-300'
                                    : 'bg-sky-500/25 text-sky-300'
                            }`}
                          >
                            {ev.title}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-[8.5px] text-zinc-400 font-semibold">
                            +{dayEvents.length - 3} more
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Day Detail + Upcoming Feed */}
            <div
              className={`lg:col-span-4 border-l p-4 overflow-y-auto space-y-3 ${
                isDark ? 'border-zinc-800 bg-[#14141A]' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                  Due on {selectedCalDate}
                </h4>
                <div className="mt-2 space-y-2">
                  {calendarEvents.filter((e) => e.date === selectedCalDate).length === 0 ? (
                    <p className="text-xs text-zinc-400">
                      No calibrations, qualifications, or work orders scheduled on this date.
                    </p>
                  ) : (
                    calendarEvents
                      .filter((e) => e.date === selectedCalDate)
                      .map((ev) => (
                        <div
                          key={ev.id}
                          className={`rounded-xl border p-3 ${
                            isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="text-xs font-bold">{ev.title}</div>
                          <div className="text-[11px] text-zinc-400 mt-0.5">{ev.subtitle}</div>
                          {ev.assetId && (
                            <button
                              type="button"
                              onClick={() => flyToAssetIn3D(ev.assetId!)}
                              className="mt-2 text-[10.5px] font-bold text-violet-400 hover:underline cursor-pointer"
                            >
                              Locate Asset in 3D →
                            </button>
                          )}
                        </div>
                      ))
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800/70">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-violet-400 mb-2">
                  Upcoming & Overdue Schedule
                </h4>
                <div className="space-y-1.5">
                  {[...calendarEvents]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .slice(0, 12)
                    .map((ev) => (
                      <button
                        key={`up-${ev.id}`}
                        type="button"
                        onClick={() => {
                          setSelectedCalDate(ev.date);
                          const [y, m] = ev.date.split('-').map(Number);
                          if (y && m) {
                            setCalYear(y);
                            setCalMonth(m - 1);
                          }
                        }}
                        className={`w-full text-left rounded-xl px-2.5 py-2 border flex items-center justify-between gap-2 transition cursor-pointer ${
                          ev.status === 'overdue'
                            ? 'bg-rose-500/10 border-rose-500/40'
                            : isDark
                              ? 'bg-[#17171F] border-zinc-800 hover:border-violet-500/50'
                              : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold truncate">{ev.title}</div>
                          <div className="text-[10px] text-zinc-400 truncate">{ev.subtitle}</div>
                        </div>
                        <span className="font-mono text-[10px] font-bold text-amber-400 shrink-0">
                          {ev.date}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 5: SOP & RECORDS MARKDOWN REPOSITORY ==================== */}
        {gmpTab === 'sops' && (
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            {/* Left SOP List */}
            <div
              className={`lg:col-span-4 border-r flex flex-col overflow-hidden ${
                isDark ? 'border-zinc-800 bg-[#14141A]' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="p-3 border-b border-zinc-800/60 space-y-2">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      value={sopSearch}
                      onChange={(e) => setSopSearch(e.target.value)}
                      placeholder="Search SOPs, records..."
                      className={`w-full rounded-xl border pl-8 pr-2 py-1.5 text-xs ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingSop(true);
                      setEditingSop(false);
                    }}
                    className="rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-2.5 py-1.5 text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={sopCatFilter}
                    onChange={(e) => setSopCatFilter(e.target.value)}
                    className={`rounded-lg border px-2 py-1 text-[10.5px] cursor-pointer ${
                      isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                    }`}
                  >
                    <option value="all">All Equipment</option>
                    {EQUIPMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sopActionFilter}
                    onChange={(e) => setSopActionFilter(e.target.value)}
                    className={`rounded-lg border px-2 py-1 text-[10.5px] cursor-pointer ${
                      isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                    }`}
                  >
                    <option value="all">All Action Types</option>
                    <option value="Calibration">Calibration</option>
                    <option value="Qualification">Qualification</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="Operation">Operation</option>
                    <option value="Cleaning / CIP-SIP">Cleaning / CIP-SIP</option>
                    <option value="Deviation / CAPA">Deviation / CAPA</option>
                  </select>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {filteredSops.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => {
                      setCreatingSop(false);
                      setEditingSop(false);
                      setSelectedSopId(doc.id);
                    }}
                    className={`w-full text-left rounded-xl p-2.5 border transition cursor-pointer ${
                      !creatingSop && activeSop?.id === doc.id
                        ? 'bg-violet-600/15 border-violet-500/70'
                        : isDark
                          ? 'bg-[#17171F] border-zinc-800 hover:border-zinc-700'
                          : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-[10.5px] font-bold text-amber-400">
                        {doc.docNumber} · v{doc.version}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-bold">
                        {doc.docType}
                      </span>
                    </div>
                    <div className="text-xs font-bold mt-0.5 leading-snug">{doc.title}</div>
                    <div className="text-[10px] text-zinc-400 mt-0.5">
                      {doc.equipmentCategory} · {doc.actionType}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right Markdown Viewer / Editor */}
            <div className="lg:col-span-8 overflow-y-auto p-5">
              {creatingSop ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-violet-400">
                      Author New Controlled SOP / GMP Record (Markdown)
                    </h3>
                    <button
                      type="button"
                      onClick={() => setCreatingSop(false)}
                      className="text-xs text-zinc-400 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      value={sopDraft.docNumber}
                      onChange={(e) => setSopDraft((d) => ({ ...d, docNumber: e.target.value }))}
                      placeholder="SOP-BIO-050"
                      className={`rounded-xl border px-3 py-2 text-xs font-mono ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                    <input
                      value={sopDraft.title}
                      onChange={(e) => setSopDraft((d) => ({ ...d, title: e.target.value }))}
                      placeholder="Document Title"
                      className={`sm:col-span-2 rounded-xl border px-3 py-2 text-xs ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                  </div>
                  <textarea
                    rows={14}
                    value={sopDraft.markdown}
                    onChange={(e) => setSopDraft((d) => ({ ...d, markdown: e.target.value }))}
                    className={`w-full rounded-2xl border p-3 font-mono text-xs ${
                      isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                    }`}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (!sopDraft.title.trim()) return;
                        const created = addSopDocument({
                          ...sopDraft,
                          effectiveDate: todayIso(),
                          reviewDueDate: addDaysToIso(todayIso(), 730),
                          status: 'effective',
                        });
                        setSelectedSopId(created.id);
                        setCreatingSop(false);
                        showToast(`Published ${created.docNumber}`, 'success');
                      }}
                      className="rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 text-xs font-bold cursor-pointer"
                    >
                      Publish Controlled Document
                    </button>
                  </div>
                </div>
              ) : activeSop ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-800/70">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-amber-400">
                          {activeSop.docNumber}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-bold">
                          v{activeSop.version} · {activeSop.docType}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold uppercase">
                          {activeSop.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-1">
                        Category: {activeSop.equipmentCategory} · Action: {activeSop.actionType} ·
                        Author: {activeSop.author} · Effective: {activeSop.effectiveDate}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingSop((e) => !e)}
                        className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold border cursor-pointer ${
                          isDark
                            ? 'bg-zinc-900 border-zinc-700 hover:border-violet-500'
                            : 'bg-white border-slate-300'
                        }`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        {editingSop ? 'Preview MD' : 'Edit MD'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const blob = new Blob([activeSop.markdown], { type: 'text/markdown' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${activeSop.docNumber}-v${activeSop.version}.md`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1 rounded-xl bg-amber-500 text-zinc-950 px-3 py-1.5 text-xs font-bold cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        .MD
                      </button>
                    </div>
                  </div>

                  {editingSop ? (
                    <textarea
                      rows={18}
                      value={activeSop.markdown}
                      onChange={(e) => updateSopDocument(activeSop.id, { markdown: e.target.value })}
                      className={`w-full rounded-2xl border p-4 font-mono text-xs leading-relaxed ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100' : 'bg-white border-slate-300'
                      }`}
                    />
                  ) : (
                    <SafeMarkdownView markdown={activeSop.markdown} isDark={isDark} />
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ==================== TAB 6: TROUBLESHOOTING KNOWLEDGE BASE & WIKI ==================== */}
        {gmpTab === 'wiki' && (
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            <div
              className={`lg:col-span-4 border-r flex flex-col overflow-hidden ${
                isDark ? 'border-zinc-800 bg-[#14141A]' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="p-3 border-b border-zinc-800/60 space-y-2">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      value={wikiSearch}
                      onChange={(e) => setWikiSearch(e.target.value)}
                      placeholder="Search symptoms, tags, faults..."
                      className={`w-full rounded-xl border pl-8 pr-2 py-1.5 text-xs ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreatingWiki(true)}
                    className="rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 px-2.5 py-1.5 text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <select
                  value={wikiCatFilter}
                  onChange={(e) => setWikiCatFilter(e.target.value)}
                  className={`w-full rounded-lg border px-2 py-1 text-[10.5px] cursor-pointer ${
                    isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                  }`}
                >
                  <option value="all">All Knowledge Base Categories</option>
                  <option value="Troubleshooting">Troubleshooting</option>
                  <option value="Cleanroom HVAC">Cleanroom HVAC</option>
                  <option value="IT / SCADA">IT / SCADA</option>
                  <option value="GMP Compliance">GMP Compliance</option>
                  <option value="Instrumentation">Instrumentation</option>
                </select>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {filteredWiki.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => {
                      setCreatingWiki(false);
                      setSelectedWikiId(w.id);
                    }}
                    className={`w-full text-left rounded-xl p-2.5 border transition cursor-pointer ${
                      !creatingWiki && activeWiki?.id === w.id
                        ? 'bg-violet-600/15 border-violet-500/70'
                        : isDark
                          ? 'bg-[#17171F] border-zinc-800 hover:border-zinc-700'
                          : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9.5px] font-bold text-amber-400 uppercase">
                        {w.category}
                      </span>
                      {w.severity === 'critical' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold uppercase">
                          CRITICAL FAULT
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-bold mt-0.5 leading-snug">{w.title}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {w.tags.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="lg:col-span-8 overflow-y-auto p-5">
              {creatingWiki ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-amber-400">
                      Publish New Troubleshooting Wiki Article
                    </h3>
                    <button
                      type="button"
                      onClick={() => setCreatingWiki(false)}
                      className="text-xs text-zinc-400 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={wikiDraft.title}
                      onChange={(e) => setWikiDraft((w) => ({ ...w, title: e.target.value }))}
                      placeholder="Article Title (e.g. Autoclave Vacuum Pulse Failure)"
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                    <input
                      value={wikiDraft.tags}
                      onChange={(e) => setWikiDraft((w) => ({ ...w, tags: e.target.value }))}
                      placeholder="Comma-separated tags (e.g. autoclave, vacuum, steam)"
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                      }`}
                    />
                  </div>
                  <textarea
                    rows={14}
                    value={wikiDraft.markdown}
                    onChange={(e) => setWikiDraft((w) => ({ ...w, markdown: e.target.value }))}
                    className={`w-full rounded-2xl border p-3 font-mono text-xs ${
                      isDark ? 'bg-[#0E0E13] border-zinc-700' : 'bg-white border-slate-300'
                    }`}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (!wikiDraft.title.trim()) return;
                        const created = addWikiArticle({
                          slug: wikiDraft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                          title: wikiDraft.title,
                          category: wikiDraft.category,
                          equipmentCategories: ['All Equipment'],
                          tags: wikiDraft.tags
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                          author: wikiDraft.author,
                          updatedAt: todayIso(),
                          severity: wikiDraft.severity,
                          markdown: wikiDraft.markdown,
                        });
                        setSelectedWikiId(created.id);
                        setCreatingWiki(false);
                        showToast('Published Wiki troubleshooting article', 'success');
                      }}
                      className="rounded-xl bg-amber-500 text-zinc-950 px-4 py-2 text-xs font-extrabold cursor-pointer"
                    >
                      Publish Wiki Article
                    </button>
                  </div>
                </div>
              ) : activeWiki ? (
                <div className="space-y-4">
                  <div className="pb-3 border-b border-zinc-800/70">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold uppercase">
                        {activeWiki.category}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        Author: {activeWiki.author} · Updated: {activeWiki.updatedAt}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {activeWiki.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-2 py-0.5 rounded-lg bg-violet-500/15 text-violet-300 font-mono"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <SafeMarkdownView markdown={activeWiki.markdown} isDark={isDark} />
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ==================== TAB 7: PREDICTIVE MAINTENANCE FORECAST ==================== */}
        {gmpTab === 'predictive' && (
          <PredictiveForecastPanel
            isDark={isDark}
            onFlyToAsset3D={flyToAssetIn3D}
            onOpenWorkflowsTab={() => setGmpTab('workflows')}
          />
        )}

        {/* ==================== TAB 8: GMP APPROVAL & PREVENTIVE WORKFLOWS ==================== */}
        {gmpTab === 'workflows' && (
          <GmpWorkflowsPanel isDark={isDark} onFlyToAsset3D={flyToAssetIn3D} />
        )}
      </div>
    </div>
  );
};
