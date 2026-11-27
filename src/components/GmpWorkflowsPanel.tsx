import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Compass,
  Play,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  Workflow,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import { useAuth } from '../context/AuthContext';
import { addDaysToIso, todayIso } from '../data/gmpDemoData';
import type { GmpWorkflowType, WorkOrderPriority } from '../types/gmp';

const WORKFLOW_TEMPLATES: {
  id: GmpWorkflowType;
  label: string;
  badge: string;
  defaultSteps: { title: string; roleRequired: string; slaHours: number }[];
}[] = [
  {
    id: 'preventive-intervention',
    label: 'Predictive Pre-Failure Intervention',
    badge: 'PdM',
    defaultSteps: [
      { title: 'Reliability Triage & Risk Verification', roleRequired: 'Reliability Engineer', slaHours: 4 },
      { title: 'Preventive Component Overhaul & Calibration', roleRequired: 'Metrology Engineer', slaHours: 16 },
      { title: 'Post-Service Telemetry & OQ Check', roleRequired: 'Validation Specialist', slaHours: 8 },
      { title: 'QA Electronic Sign-Off & Line Release', roleRequired: 'QA / GMP Lead', slaHours: 4 },
    ],
  },
  {
    id: 'deviation-capa',
    label: 'GMP Deviation & CAPA Investigation',
    badge: 'CAPA',
    defaultSteps: [
      { title: 'Deviation Containment & Quarantine Assessment', roleRequired: 'QA Specialist', slaHours: 2 },
      { title: 'Root Cause Analysis (5-Why / Fishbone)', roleRequired: 'Process Engineer', slaHours: 24 },
      { title: 'Corrective & Preventive Action Execution', roleRequired: 'Maintenance Lead', slaHours: 48 },
      { title: 'QA Director Effectiveness Check & Closure', roleRequired: 'QA Director', slaHours: 12 },
    ],
  },
  {
    id: 'line-release',
    label: 'Production Line Batch Release',
    badge: 'RELEASE',
    defaultSteps: [
      { title: 'Digital Twin Line Eligibility Audit', roleRequired: 'Production Supervisor', slaHours: 2 },
      { title: 'CIP / SIP Sterilization & Cleanroom Check', roleRequired: 'Bioprocess Lead', slaHours: 6 },
      { title: 'QA Final Batch Clearance E-Signature', roleRequired: 'QA / GMP Lead', slaHours: 4 },
    ],
  },
  {
    id: 're-qualification',
    label: 'Equipment IQ / OQ / PQ Re-Qualification',
    badge: 'IQ/OQ/PQ',
    defaultSteps: [
      { title: 'Protocol Authoring & Pre-Execution Approval', roleRequired: 'Validation Lead', slaHours: 12 },
      { title: 'Execute OQ / PQ Test Scripts & Traceability', roleRequired: 'Validation Engineer', slaHours: 24 },
      { title: 'Summary Report & Final QA Approval', roleRequired: 'QA Director', slaHours: 8 },
    ],
  },
];

interface GmpWorkflowsPanelProps {
  isDark: boolean;
  onFlyToAsset3D: (assetId: string) => void;
}

export const GmpWorkflowsPanel: React.FC<GmpWorkflowsPanelProps> = ({
  isDark,
  onFlyToAsset3D,
}) => {
  const { user } = useAuth();
  const scene = useTwinStore((s) => s.scene);
  const showToast = useTwinStore((s) => s.showToast);

  const workflows = useGmpStore((s) => s.workflows);
  const productionLines = useGmpStore((s) => s.productionLines);
  const personnel = useGmpStore((s) => s.personnel);
  const createWorkflow = useGmpStore((s) => s.createWorkflow);
  const advanceWorkflowStep = useGmpStore((s) => s.advanceWorkflowStep);
  const addWorkflowStep = useGmpStore((s) => s.addWorkflowStep);
  const deleteWorkflow = useGmpStore((s) => s.deleteWorkflow);
  const createWorkOrder = useGmpStore((s) => s.createWorkOrder);

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'waiting-approval' | 'completed' | 'blocked'>('all');
  const [selectedWfId, setSelectedWfId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [mobilePane, setMobilePane] = useState<'list' | 'detail'>('list');

  // Create Workflow Form State
  const [wfTemplate, setWfTemplate] = useState<GmpWorkflowType>('preventive-intervention');
  const [wfTitle, setWfTitle] = useState('');
  const [wfDesc, setWfDesc] = useState('');
  const [wfPriority, setWfPriority] = useState<WorkOrderPriority>('high');
  const [wfLineId, setWfLineId] = useState<string>(productionLines[0]?.id ?? '');
  const [wfAssetId, setWfAssetId] = useState<string>(scene.assets[0]?.id ?? '');

  // Add Custom Stage State
  const [newStepTitle, setNewStepTitle] = useState('');
  const [newStepRole, setNewStepRole] = useState('QA Specialist');
  const [stepNote, setStepNote] = useState('');

  const filteredWorkflows = useMemo(() => {
    if (statusFilter === 'all') return workflows;
    return workflows.filter((w) => w.status === statusFilter);
  }, [workflows, statusFilter]);

  const activeWf = useMemo(
    () =>
      filteredWorkflows.find((w) => w.id === selectedWfId) ??
      filteredWorkflows[0] ??
      null,
    [filteredWorkflows, selectedWfId]
  );

  const currentSignerName = user?.displayName || user?.email?.split('@')[0] || 'Dr. Elena Rostova';

  const handleCreateWorkflow = (e: React.FormEvent) => {
    e.preventDefault();
    const tpl =
      WORKFLOW_TEMPLATES.find((t) => t.id === wfTemplate) ?? WORKFLOW_TEMPLATES[0];
    const line = productionLines.find((l) => l.id === wfLineId);
    const asset = scene.assets.find((a) => a.id === wfAssetId);

    const created = createWorkflow({
      title:
        wfTitle.trim() ||
        `${tpl.label} — ${asset?.assetId ?? line?.code ?? 'Facility'}`,
      description:
        wfDesc.trim() ||
        `Controlled GMP ${tpl.label} pipeline with 21 CFR Part 11 electronic signature checkpoints.`,
      workflowType: wfTemplate,
      priority: wfPriority,
      status: 'active',
      triggerSource: 'manual',
      linkedLineId: line?.id,
      linkedLineName: line ? `${line.code} · ${line.name}` : undefined,
      linkedAssetId: asset?.id,
      linkedAssetCode: asset?.assetId,
      linkedAssetName: asset?.name,
      steps: tpl.defaultSteps.map((s, idx) => ({
        id: `st-${Date.now()}-${idx}`,
        title: s.title,
        roleRequired: s.roleRequired,
        assigneeName: personnel[idx % personnel.length]?.name ?? 'Dr. Elena Rostova',
        status: idx === 0 ? 'in-progress' : 'pending',
        slaHours: s.slaHours,
      })),
    });

    setSelectedWfId(created.id);
    setWfTitle('');
    setWfDesc('');
    setShowCreateForm(false);
  };

  const handleSpawnWorkOrderFromStep = (stepTitle: string) => {
    if (!activeWf) return;
    const asset = scene.assets.find(
      (a) => a.id === activeWf.linkedAssetId || a.assetId === activeWf.linkedAssetCode
    );
    const tech = personnel[0];
    const due = addDaysToIso(todayIso(), 5);
    const wo = createWorkOrder({
      title: `[${activeWf.code}] ${stepTitle}`,
      description: `Spawned from GMP workflow ${activeWf.code}: ${activeWf.title}`,
      serviceType:
        activeWf.workflowType === 're-qualification'
          ? 'qualification'
          : activeWf.workflowType === 'deviation-capa'
            ? 'corrective-repair'
            : 'maintenance',
      targetKind: asset ? 'asset' : 'line',
      targetId: asset?.id ?? activeWf.linkedLineId ?? 'facility',
      targetName: asset ? `${asset.assetId} · ${asset.name}` : activeWf.linkedLineName ?? 'Facility',
      targetCategory: asset?.category ?? 'Biopharmaceutical',
      productionLineId: activeWf.linkedLineId,
      assigneeId: tech?.id ?? 'tech-01',
      assigneeName: tech?.name ?? 'Sara Lindqvist',
      priority: activeWf.priority,
      status: 'open',
      lastServiceDate: todayIso(),
      dueDate: due,
      estimatedHours: 3,
      checklist: [
        { id: `chk-${Date.now()}-1`, text: `Execute workflow step: ${stepTitle}`, done: false },
        { id: `chk-${Date.now()}-2`, text: 'Attach evidence & update workflow signature', done: false },
      ],
    });
    showToast(`Spawned ${wo.woNumber} linked to ${activeWf.code}`, 'success');
  };

  const statusTone = (st: string) => {
    switch (st) {
      case 'completed':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40';
      case 'blocked':
      case 'rejected':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/40';
      case 'waiting-approval':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/40';
      case 'in-progress':
      case 'active':
        return 'bg-violet-500/15 text-violet-300 border-violet-500/40';
      default:
        return 'bg-zinc-500/15 text-zinc-400 border-zinc-600/40';
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col lg:grid lg:grid-cols-12">
      {/* Left Workflow Queue & Template Launcher */}
      <div
        className={`${
          mobilePane === 'detail' ? 'hidden lg:flex' : 'flex'
        } flex-1 lg:flex-none min-h-0 lg:col-span-4 lg:border-r flex-col overflow-hidden ${
          isDark ? 'bg-[#14141A] border-zinc-800' : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="p-3 border-b border-zinc-800/60 space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-violet-400 flex items-center gap-1.5">
              <Workflow className="w-3.5 h-3.5" />
              GMP Workflows ({workflows.length})
            </span>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm((v) => !v);
                setMobilePane('detail');
              }}
              className="flex items-center gap-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-2.5 py-1.5 text-[11px] font-bold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              New Workflow
            </button>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'active', label: 'Active' },
                { id: 'waiting-approval', label: 'QA Sign' },
                { id: 'completed', label: 'Done' },
                { id: 'blocked', label: 'Blocked' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`px-2 py-1 rounded-lg text-[10.5px] font-semibold whitespace-nowrap cursor-pointer transition ${
                  statusFilter === f.id
                    ? 'bg-violet-600 text-white'
                    : isDark
                      ? 'bg-[#1B1B24] text-zinc-400 hover:text-zinc-200'
                      : 'bg-white text-slate-600 border border-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-2.5 space-y-2">
          {filteredWorkflows.map((wf) => {
            const doneCount = wf.steps.filter((s) => s.status === 'completed').length;
            const pct = Math.round((doneCount / Math.max(1, wf.steps.length)) * 100);
            const isSel = !showCreateForm && activeWf?.id === wf.id;

            return (
              <div
                key={wf.id}
                onClick={() => {
                  setShowCreateForm(false);
                  setSelectedWfId(wf.id);
                  setMobilePane('detail');
                }}
                className={`rounded-2xl p-3 border transition cursor-pointer space-y-2 ${
                  isSel
                    ? 'bg-violet-600/15 border-violet-500/70'
                    : isDark
                      ? 'bg-[#17171F] border-zinc-800 hover:border-zinc-700'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10.5px] font-bold text-amber-400">{wf.code}</span>
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[9.5px] font-extrabold uppercase border ${statusTone(
                      wf.status
                    )}`}
                  >
                    {wf.status}
                  </span>
                </div>
                <div className="text-xs font-bold leading-snug">{wf.title}</div>
                <div className="flex items-center justify-between text-[10px] text-zinc-400">
                  <span className="truncate">{wf.linkedAssetCode || wf.linkedLineName || 'Site-wide'}</span>
                  <span className="font-mono shrink-0">
                    {doneCount}/{wf.steps.length} steps
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor:
                        wf.status === 'completed'
                          ? '#10B981'
                          : wf.status === 'blocked'
                            ? '#F43F5E'
                            : '#8B5CF6',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Visual Workflow Pipeline & Stage Approvals OR New Workflow Builder */}
      <div
        className={`${
          mobilePane === 'list' ? 'hidden lg:block' : 'block'
        } flex-1 lg:flex-none min-h-0 lg:col-span-8 overflow-y-auto overscroll-contain touch-pan-y p-4 sm:p-5 space-y-4`}
      >
        <div
          className={`lg:hidden sticky -top-4 z-10 -mx-4 px-4 py-2.5 flex items-center justify-between border-b ${
            isDark ? 'bg-[#111116] border-zinc-800/80' : 'bg-white border-slate-200'
          }`}
        >
          <button
            type="button"
            onClick={() => setMobilePane('list')}
            className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold border cursor-pointer ${
              isDark
                ? 'bg-zinc-900 border-zinc-700 text-zinc-200'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All Workflows
          </button>
          {activeWf && !showCreateForm && (
            <span className="font-mono text-[11px] font-bold text-amber-400">
              {activeWf.code}
            </span>
          )}
        </div>
        {showCreateForm ? (
          <form
            onSubmit={handleCreateWorkflow}
            className={`rounded-2xl border p-4 space-y-4 ${
              isDark ? 'bg-[#17171F] border-violet-500/40' : 'bg-white border-violet-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold flex items-center gap-1.5 text-violet-400">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Launch Controlled GMP Workflow
                </h3>
                <p className="text-[11px] text-zinc-400">
                  Select a validated pharmaceutical workflow blueprint and bind it to a Production Line &amp; Equipment asset.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                Cancel
              </button>
            </div>

            {/* Blueprint Template Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {WORKFLOW_TEMPLATES.map((tpl) => {
                const active = wfTemplate === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setWfTemplate(tpl.id)}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      active
                        ? 'bg-violet-600/15 border-violet-500 text-white'
                        : isDark
                          ? 'bg-[#111116] border-zinc-800 hover:border-zinc-700'
                          : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">{tpl.label}</span>
                      <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">
                        {tpl.badge}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-zinc-400 mt-1">
                      {tpl.defaultSteps.length} approval &amp; execution stages
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10.5px] text-zinc-400 font-semibold">Workflow Title</span>
                <input
                  value={wfTitle}
                  onChange={(e) => setWfTitle(e.target.value)}
                  placeholder="Optional custom title..."
                  className={`w-full px-3 py-2 text-xs rounded-xl border ${
                    isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-300'
                  }`}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10.5px] text-zinc-400 font-semibold">Priority</span>
                <select
                  value={wfPriority}
                  onChange={(e) => setWfPriority(e.target.value as WorkOrderPriority)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border ${
                    isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-300'
                  }`}
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10.5px] text-zinc-400 font-semibold">Linked Production Line</span>
                <select
                  value={wfLineId}
                  onChange={(e) => setWfLineId(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border ${
                    isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-300'
                  }`}
                >
                  <option value="">None (Facility-wide)</option>
                  {productionLines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} · {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10.5px] text-zinc-400 font-semibold">Linked Equipment Asset</span>
                <select
                  value={wfAssetId}
                  onChange={(e) => setWfAssetId(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border ${
                    isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-300'
                  }`}
                >
                  <option value="">None</option>
                  {scene.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.assetId} · {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <textarea
              rows={2}
              value={wfDesc}
              onChange={(e) => setWfDesc(e.target.value)}
              placeholder="Scope, justification, or linked SOP / deviation reference..."
              className={`w-full px-3 py-2 text-xs rounded-xl border ${
                isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-300'
              }`}
            />

            <div className="flex justify-end gap-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl gradian-violet-amber text-white text-xs font-bold cursor-pointer shadow-md"
              >
                Create &amp; Start Workflow
              </button>
            </div>
          </form>
        ) : activeWf ? (
          <>
            {/* Active Workflow Header Card */}
            <div
              className={`rounded-2xl border p-4 space-y-3 ${
                isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-amber-400">{activeWf.code}</span>
                    <span
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase border ${statusTone(
                        activeWf.status
                      )}`}
                    >
                      {activeWf.status}
                    </span>
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono uppercase bg-violet-500/15 text-violet-300">
                      {activeWf.triggerSource}
                    </span>
                    {activeWf.predictedFailureDate && (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Est. Failure {activeWf.predictedFailureDate}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-extrabold">{activeWf.title}</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">{activeWf.description}</p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {activeWf.linkedAssetId && (
                    <button
                      type="button"
                      onClick={() => onFlyToAsset3D(activeWf.linkedAssetId!)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
                    >
                      <Compass className="w-3.5 h-3.5" />
                      3D Asset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteWorkflow(activeWf.id)}
                    className="p-2 rounded-xl text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                    title="Delete Workflow"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Horizontal Pipeline Progress Overview */}
              <div className="pt-2 border-t border-zinc-800/60 flex items-center gap-1.5 overflow-x-auto pb-1">
                {activeWf.steps.map((st, idx) => (
                  <React.Fragment key={st.id}>
                    <div
                      className={`px-2.5 py-1.5 rounded-xl border text-[10.5px] font-semibold whitespace-nowrap flex items-center gap-1.5 ${statusTone(
                        st.status
                      )}`}
                    >
                      <span className="font-mono text-[9.5px] opacity-80">{idx + 1}.</span>
                      <span className="max-w-[140px] truncate">{st.title}</span>
                    </div>
                    {idx < activeWf.steps.length - 1 && (
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Interactive Step-by-Step Approval & Execution Cards */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-violet-400">
                  Workflow Execution Stages &amp; 21 CFR Part 11 E-Signatures
                </h4>
                <span className="text-[11px] text-zinc-400">
                  Active Signer: <strong className="text-amber-400">{currentSignerName}</strong>
                </span>
              </div>

              <input
                value={stepNote}
                onChange={(e) => setStepNote(e.target.value)}
                placeholder="Optional e-signature verification note for your next approval / rejection..."
                className={`w-full px-3 py-2 text-xs rounded-xl border ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-white border-slate-200'
                }`}
              />

              {activeWf.steps.map((step, idx) => (
                <div
                  key={step.id}
                  className={`rounded-2xl border p-3.5 space-y-2.5 ${
                    step.status === 'in-progress'
                      ? 'border-violet-500/60 bg-violet-500/8'
                      : isDark
                        ? 'bg-[#17171F] border-zinc-800'
                        : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div
                        className={`w-7 h-7 rounded-xl flex items-center justify-center font-mono text-xs font-bold shrink-0 ${
                          step.status === 'completed'
                            ? 'bg-emerald-500 text-white'
                            : step.status === 'rejected'
                              ? 'bg-rose-500 text-white'
                              : step.status === 'in-progress'
                                ? 'bg-violet-600 text-white'
                                : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {step.status === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : step.status === 'rejected' ? (
                          <XCircle className="w-4 h-4" />
                        ) : (
                          idx + 1
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold">{step.title}</div>
                        <div className="text-[11px] text-zinc-400 flex flex-wrap items-center gap-2 mt-0.5">
                          <span className="flex items-center gap-1">
                            <UserCheck className="w-3 h-3 text-violet-400" />
                            {step.roleRequired} · {step.assigneeName}
                          </span>
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3 text-amber-400" />
                            SLA {step.slaHours}h
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {step.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() =>
                            advanceWorkflowStep(activeWf.id, step.id, 'start', currentSignerName)
                          }
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          <Play className="w-3 h-3" />
                          Start Stage
                        </button>
                      )}
                      {(step.status === 'in-progress' || step.status === 'pending') && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              advanceWorkflowStep(
                                activeWf.id,
                                step.id,
                                'complete',
                                currentSignerName,
                                stepNote.trim() || undefined
                              );
                              setStepNote('');
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            Approve &amp; E-Sign
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              advanceWorkflowStep(
                                activeWf.id,
                                step.id,
                                'reject',
                                currentSignerName,
                                stepNote.trim() || 'Escalated for QA review.'
                              );
                              setStepNote('');
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/35 text-[11px] font-semibold cursor-pointer"
                          >
                            <ShieldAlert className="w-3 h-3" />
                            Reject
                          </button>
                        </>
                      )}
                      {step.status !== 'completed' && (
                        <button
                          type="button"
                          onClick={() => handleSpawnWorkOrderFromStep(step.title)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold cursor-pointer ${
                            isDark
                              ? 'bg-[#111116] border-zinc-700 hover:border-amber-500 text-amber-400'
                              : 'bg-slate-50 border-slate-200 text-amber-700'
                          }`}
                          title="Create a linked Work Order for this workflow stage"
                        >
                          <Wrench className="w-3 h-3" />
                          Spawn WO
                        </button>
                      )}
                    </div>
                  </div>

                  {(step.notes || step.signatureHash) && (
                    <div
                      className={`px-3 py-2 rounded-xl text-[11px] flex flex-wrap items-center justify-between gap-2 ${
                        isDark ? 'bg-[#111116] text-zinc-300' : 'bg-slate-50 text-slate-700'
                      }`}
                    >
                      <span>{step.notes || 'Electronic signature verified.'}</span>
                      {step.signatureHash && (
                        <span className="font-mono text-[10px] text-emerald-400 shrink-0">
                          Signed by {step.signedBy} · {step.completedAt} · {step.signatureHash}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Append Custom Approval Stage */}
              <div
                className={`p-3 rounded-2xl border flex flex-wrap items-center gap-2 ${
                  isDark ? 'bg-[#14141B] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <input
                  value={newStepTitle}
                  onChange={(e) => setNewStepTitle(e.target.value)}
                  placeholder="Add custom verification or approval stage..."
                  className={`flex-1 min-w-[180px] px-3 py-1.5 text-xs rounded-xl border ${
                    isDark ? 'bg-[#101016] border-zinc-700' : 'bg-white border-slate-300'
                  }`}
                />
                <input
                  value={newStepRole}
                  onChange={(e) => setNewStepRole(e.target.value)}
                  placeholder="Required Role"
                  className={`w-40 px-3 py-1.5 text-xs rounded-xl border ${
                    isDark ? 'bg-[#101016] border-zinc-700' : 'bg-white border-slate-300'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newStepTitle.trim()) return;
                    addWorkflowStep(activeWf.id, {
                      title: newStepTitle.trim(),
                      roleRequired: newStepRole.trim() || 'QA Specialist',
                      assigneeName: currentSignerName,
                      status: 'pending',
                      slaHours: 8,
                    });
                    setNewStepTitle('');
                    showToast('Added custom workflow stage', 'success');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Stage
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-xs text-zinc-500">
            Select a workflow or click New Workflow to start a GMP approval pipeline.
          </div>
        )}
      </div>
    </div>
  );
};
