import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Flame,
  Loader2,
  Map as MapIcon,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import {
  computeRpn,
  getRpnPriority,
  useRiskIncidentStore,
  type AiResolutionPlan,
  type IncidentStatus,
  type RiskIncidentKind,
  type RiskIncidentRecord,
  type RiskTargetKind,
} from '../store/useRiskIncidentStore';
import { fetchApiJson } from '../utils/safeJson';
import { FacilityRiskHeatmapD3 } from './FacilityRiskHeatmapD3';

/** Helper to navigate directly from any Risk/Alarm/Drift to 3D, 2D, IT Designer, GMP Line, or Telemetry */
export function navigateToRiskTarget(
  incident: RiskIncidentRecord,
  destination: '3d' | '2d' | 'telemetry' | 'network' | 'line'
) {
  const twin = useTwinStore.getState();
  const gmp = useGmpStore.getState();
  const telemetry = useTelemetryStore.getState();
  const riskStore = useRiskIncidentStore.getState();

  // Close overlays cleanly so navigation feels immediate
  riskStore.closeRiskModal();
  twin.closeEntityInfo();

  if (destination === 'telemetry') {
    telemetry.openDashboard({
      tab: 'trends',
      sensorId: incident.sensorId ?? null,
      assetId: incident.targetKind === 'asset' ? incident.targetId : null,
      roomId: incident.targetKind === 'room' ? incident.targetId : incident.roomId ?? null,
    });
    return;
  }

  if (destination === 'network') {
    twin.openDataCenterPage(incident.targetKind === 'asset' || incident.targetKind === 'network' ? incident.targetId : null);
    return;
  }

  if (destination === 'line') {
    gmp.openGmpModal({ tab: 'lines', lineId: incident.targetId });
    return;
  }

  // Resolve spatial target for 3D or 2D workspace navigation
  const scene = twin.scene;
  const viewMode = destination === '2d' ? '2d' : '3d-perspective';

  if (incident.targetKind === 'asset' || incident.targetKind === 'network') {
    const asset =
      scene.assets.find((a) => a.id === incident.targetId || a.assetId === incident.targetCode) ??
      scene.assets[0];
    if (asset) {
      const floor = scene.floors.find((f) => f.id === asset.floorId);
      twin.setScreen('workspace');
      gmp.closeGmpModal();
      if (floor) {
        twin.setActiveBuilding(floor.buildingId);
        twin.setActiveFloor(floor.id);
      }
      twin.setViewMode(viewMode);
      twin.selectEntity({ type: 'asset', id: asset.id });
      twin.focusEntity({ type: 'asset', id: asset.id });
      return;
    }
  }

  if (incident.targetKind === 'room') {
    const room =
      scene.rooms.find((r) => r.id === incident.targetId || r.code === incident.targetCode) ??
      scene.rooms[0];
    if (room) {
      const floor = scene.floors.find((f) => f.id === room.floorId);
      twin.setScreen('workspace');
      gmp.closeGmpModal();
      if (floor) {
        twin.setActiveBuilding(floor.buildingId);
        twin.setActiveFloor(floor.id);
      }
      twin.setViewMode(viewMode);
      twin.selectEntity({ type: 'room', id: room.id });
      twin.focusEntity({ type: 'room', id: room.id });
      return;
    }
  }

  if (incident.targetKind === 'line') {
    const line = gmp.productionLines.find((l) => l.id === incident.targetId);
    const firstRoom =
      (line?.roomIds.length ? scene.rooms.find((r) => r.id === line.roomIds[0]) : null) ??
      (incident.roomId ? scene.rooms.find((r) => r.id === incident.roomId) : null) ??
      scene.rooms[0];
    if (firstRoom) {
      const floor = scene.floors.find((f) => f.id === firstRoom.floorId);
      twin.setScreen('workspace');
      gmp.closeGmpModal();
      if (floor) {
        twin.setActiveBuilding(floor.buildingId);
        twin.setActiveFloor(floor.id);
      }
      twin.setViewMode(viewMode);
      twin.selectEntity({ type: 'room', id: firstRoom.id });
      twin.focusEntity({ type: 'room', id: firstRoom.id });
      return;
    }
  }

  twin.setScreen('workspace');
  twin.setViewMode(viewMode);
}

const KIND_LABELS: Record<RiskIncidentKind, string> = {
  alarm: 'Alarm',
  drift: 'Drift',
  'fmea-risk': 'FMEA Risk',
  'compliance-deviation': 'GMP Deviation',
};

const STATUS_LABELS: Record<IncidentStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  mitigated: 'Mitigated',
  closed: 'Closed',
};

/* ───────────────────────────────────────────────────────────────────────────
 * 1. MODAL: Create Manual FMEA Risk / Drift OR Inspect & AI-Resolve Incident
 * ─────────────────────────────────────────────────────────────────────────── */
export const RiskFmeaModal: React.FC = () => {
  const show = useRiskIncidentStore((s) => s.riskModalOpen);
  const prefill = useRiskIncidentStore((s) => s.riskModalPrefill);
  const incidents = useRiskIncidentStore((s) => s.incidents);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);
  const closeRiskModal = useRiskIncidentStore((s) => s.closeRiskModal);
  const openAssetPdfModal = useRiskIncidentStore((s) => s.openAssetPdfModal);
  const addManualRiskIncident = useRiskIncidentStore((s) => s.addManualRiskIncident);
  const updateFmeaScores = useRiskIncidentStore((s) => s.updateFmeaScores);
  const updateIncidentStatus = useRiskIncidentStore((s) => s.updateIncidentStatus);
  const attachAiResolution = useRiskIncidentStore((s) => s.attachAiResolution);
  const markAiResolutionApplied = useRiskIncidentStore((s) => s.markAiResolutionApplied);
  const deleteIncident = useRiskIncidentStore((s) => s.deleteIncident);

  const scene = useTwinStore((s) => s.scene);
  const recordAudit = useTwinStore((s) => s.recordAudit);
  const showToast = useTwinStore((s) => s.showToast);

  const productionLines = useGmpStore((s) => s.productionLines);
  const createWorkOrder = useGmpStore((s) => s.createWorkOrder);
  const personnel = useGmpStore((s) => s.personnel);

  const activeIncident = useMemo(
    () => (prefill?.incidentId ? incidents.find((i) => i.id === prefill.incidentId) ?? null : null),
    [incidents, prefill?.incidentId]
  );

  // Create Form State
  const [targetKind, setTargetKind] = useState<RiskTargetKind>('asset');
  const [targetId, setTargetId] = useState<string>('');
  const [kind, setKind] = useState<RiskIncidentKind>('fmea-risk');
  const [title, setTitle] = useState('');
  const [failureMode, setFailureMode] = useState('');
  const [effect, setEffect] = useState('');
  const [cause, setCause] = useState('');
  const [currentControls, setCurrentControls] = useState('');
  const [owner, setOwner] = useState('Quality Engineering · FMEA Board');
  const [severity, setSeverity] = useState(7);
  const [occurrence, setOccurrence] = useState(5);
  const [detection, setDetection] = useState(5);

  // Modal View Tab (Incident/Create form vs. D3 Facility Risk Heatmap)
  const [modalTab, setModalTab] = useState<'detail' | 'heatmap'>('detail');

  // AI Resolution State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Build target choices based on targetKind
  const targetOptions = useMemo(() => {
    if (targetKind === 'room') {
      return scene.rooms.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        floorId: r.floorId,
        roomId: r.id,
      }));
    }
    if (targetKind === 'line') {
      return productionLines.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        floorId: scene.rooms.find((r) => r.id === l.roomIds[0])?.floorId,
        roomId: l.roomIds[0],
      }));
    }
    if (targetKind === 'network') {
      return scene.assets
        .filter((a) => a.category === 'IT & Data Center' || Boolean(a.rackConfig))
        .map((a) => ({
          id: a.id,
          code: a.assetId,
          name: a.name,
          floorId: a.floorId,
          roomId: a.roomId,
        }));
    }
    return scene.assets.map((a) => ({
      id: a.id,
      code: a.assetId,
      name: a.name,
      floorId: a.floorId,
      roomId: a.roomId,
    }));
  }, [scene.assets, scene.rooms, productionLines, targetKind]);

  // Reset form & tab when modal opens
  useEffect(() => {
    if (!show || !prefill) return;
    setAiError(null);
    setAiLoading(false);
    setModalTab(prefill.mode === 'heatmap' ? 'heatmap' : 'detail');
    if (prefill.mode === 'create' || prefill.mode === 'heatmap') {
      const nextKind = prefill.targetKind ?? 'asset';
      setTargetKind(nextKind);
      setTargetId(prefill.targetId ?? '');
      setKind('fmea-risk');
      setTitle('');
      setFailureMode('');
      setEffect('');
      setCause('');
      setCurrentControls('Scheduled SOP verification & SCADA continuous alarm');
      setOwner('Quality Engineering · FMEA Board');
      setSeverity(7);
      setOccurrence(5);
      setDetection(5);
    }
  }, [show, prefill]);

  // Ensure a valid targetId is selected when switching targetKind
  useEffect(() => {
    if (!show || prefill?.mode !== 'create') return;
    if (targetOptions.length > 0 && !targetOptions.some((o) => o.id === targetId)) {
      setTargetId(targetOptions[0].id);
    }
  }, [show, prefill?.mode, targetOptions, targetId]);

  // Keyboard Escape handler
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRiskModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, closeRiskModal]);

  if (!show || !prefill) return null;

  const isCreate = prefill.mode === 'create' || !activeIncident;
  const liveRpn = computeRpn(severity, occurrence, detection);
  const livePriority = getRpnPriority(liveRpn);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const chosen = targetOptions.find((o) => o.id === targetId);
    const created = addManualRiskIncident({
      kind,
      targetKind,
      targetId: chosen?.id ?? prefill.targetId ?? 'site-global',
      targetCode: chosen?.code ?? prefill.targetCode ?? 'SITE',
      targetName: chosen?.name ?? prefill.targetName ?? scene.name,
      floorId: chosen?.floorId ?? prefill.floorId,
      roomId: chosen?.roomId ?? prefill.roomId,
      title: title.trim() || `${KIND_LABELS[kind]} on ${chosen?.name ?? 'Facility Target'}`,
      failureMode: failureMode.trim() || title.trim() || 'Operational process drift / component failure',
      effect: effect.trim() || 'Potential GMP compliance deviation or reduced equipment availability.',
      cause: cause.trim() || 'Under engineering root cause investigation.',
      currentControls: currentControls.trim() || 'Periodic inspection & BMS telemetry alerting.',
      severity,
      occurrence,
      detection,
      owner: owner.trim() || 'Quality Engineering',
    });

    recordAudit({
      category: 'validation-ai',
      action: `Logged Manual ${KIND_LABELS[kind]} (${created.code})`,
      entityType: targetKind === 'room' ? 'room' : targetKind === 'asset' ? 'asset' : 'project',
      entityId: created.targetId,
      entityName: created.targetName,
      summary: `${created.title} · FMEA RPN ${created.rpn} (S:${created.severity} × O:${created.occurrence} × D:${created.detection})`,
    });
    showToast(`${created.code} logged (RPN ${created.rpn})`, 'success');
    closeRiskModal();
  };

  const handleGenerateAiResolution = async (inc: RiskIncidentRecord) => {
    setAiLoading(true);
    setAiError(null);
    try {
      const data = await fetchApiJson<{ resolution: AiResolutionPlan }>(
        '/api/incidents/ai-resolve',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incident: {
              code: inc.code,
              kind: inc.kind,
              title: inc.title,
              targetKind: inc.targetKind,
              targetCode: inc.targetCode,
              targetName: inc.targetName,
              currentValueLabel: inc.currentValueLabel,
              failureMode: inc.failureMode,
              effect: inc.effect,
              cause: inc.cause,
              currentControls: inc.currentControls,
              severity: inc.severity,
              occurrence: inc.occurrence,
              detection: inc.detection,
              rpn: inc.rpn,
            },
            facilityContext: {
              facilityName: scene.name,
              siteCode: scene.id,
            },
          }),
        },
        'Failed to generate AI CAPA resolution.'
      );
      if (!data?.resolution) {
        throw new Error('AI resolution returned an empty response.');
      }
      attachAiResolution(inc.id, data.resolution);
      showToast(`AI resolution ready for ${inc.code} (Residual RPN ${data.resolution.residualRpn})`, 'success');
    } catch (err: any) {
      setAiError(err?.message || 'Unable to reach Gemini AI Resolution service.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiResolution = (inc: RiskIncidentRecord) => {
    const plan = inc.aiResolution;
    if (!plan) return;

    const assignee = personnel[0];
    const targetAsset =
      inc.targetKind === 'asset' || inc.targetKind === 'network'
        ? scene.assets.find((a) => a.id === inc.targetId)
        : null;
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const wo = createWorkOrder({
      title: plan.recommendedWorkOrderTitle || `CAPA: ${inc.title}`,
      description: `${plan.summary}\n\nRoot Cause: ${plan.rootCause}\nIncident: ${inc.code} (RPN ${inc.rpn} → ${plan.residualRpn})`,
      serviceType: 'corrective-repair',
      targetKind: inc.targetKind === 'room' ? 'room' : inc.targetKind === 'line' ? 'line' : 'asset',
      targetId: inc.targetId,
      targetName: `${inc.targetCode} · ${inc.targetName}`,
      targetCategory: targetAsset?.category ?? 'Facility / Room',
      productionLineId: inc.targetKind === 'line' ? inc.targetId : undefined,
      assigneeId: assignee?.id ?? 'tech-01',
      assigneeName: assignee?.name ?? 'Lead Reliability Engineer',
      priority: plan.recommendedPriority || (inc.rpn >= 200 ? 'critical' : 'high'),
      status: 'open',
      lastServiceDate: today,
      dueDate: due,
      estimatedHours: 4,
      checklist: [
        ...plan.immediateContainment.map((step, idx) => ({
          id: `chk-cont-${idx}-${Date.now()}`,
          text: `[Containment] ${step}`,
          done: false,
        })),
        ...plan.capaActions.map((step, idx) => ({
          id: `chk-capa-${idx}-${Date.now()}`,
          text: `[CAPA] ${step}`,
          done: false,
        })),
      ],
    });

    markAiResolutionApplied(inc.id, wo.woNumber);
    recordAudit({
      category: 'validation-ai',
      action: `Applied AI FMEA Resolution & Opened ${wo.woNumber}`,
      entityType: inc.targetKind === 'room' ? 'room' : inc.targetKind === 'asset' ? 'asset' : 'project',
      entityId: inc.targetId,
      entityName: inc.targetName,
      summary: `${inc.code} mitigated via Gemini CAPA · RPN reduced ${inc.initialRpn} → ${plan.residualRpn}`,
    });
    showToast(`Applied AI CAPA & created Work Order ${wo.woNumber}`, 'success');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeRiskModal();
      }}
    >
      <div
        className={`w-full ${
          modalTab === 'heatmap' ? 'max-w-5xl' : 'max-w-3xl'
        } h-[100dvh] sm:h-auto sm:max-h-[92vh] rounded-none sm:rounded-3xl bg-white dark:bg-[#111116] border-0 sm:border border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden transition-[max-width] duration-200`}
      >
        {/* Header */}
        <header className="shrink-0 px-4 sm:px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-zinc-50/90 dark:bg-[#16161D]">
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
              {modalTab === 'heatmap' ? (
                <>
                  <Flame className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Facility Floor Plan Risk Intensity (Severity × Occurrence)</span>
                </>
              ) : isCreate ? (
                <>
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Manual FMEA &amp; Risk Priority Entry</span>
                </>
              ) : (
                <>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{activeIncident.code}</span>
                  <span>·</span>
                  <span>{KIND_LABELS[activeIncident.kind]}</span>
                  <span>·</span>
                  <span>{activeIncident.source === 'auto-telemetry' ? 'Auto-Logged Telemetry' : 'Manual Register'}</span>
                </>
              )}
            </div>
            <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-50 truncate mt-0.5">
              {modalTab === 'heatmap'
                ? 'Facility FMEA Risk Heatmap'
                : isCreate
                  ? 'Log Risk, Drift or FMEA Failure Mode'
                  : activeIncident.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={closeRiskModal}
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            aria-label="Close FMEA dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Modal View Switcher */}
        <div className="shrink-0 px-4 sm:px-6 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#13131A] flex items-center justify-between gap-2 flex-wrap">
          <div className="inline-flex items-center p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setModalTab('detail')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                modalTab === 'detail'
                  ? 'bg-violet-600 text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {isCreate ? 'Log New FMEA Risk' : 'Incident & AI CAPA'}
            </button>
            <button
              type="button"
              onClick={() => setModalTab('heatmap')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                modalTab === 'heatmap'
                  ? 'bg-amber-500 text-zinc-950'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              Facility Heatmap (S×O)
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              const targetAssetId =
                activeIncident && (activeIncident.targetKind === 'asset' || activeIncident.targetKind === 'network')
                  ? activeIncident.targetId
                  : prefill.targetKind === 'asset' || prefill.targetKind === 'network'
                    ? prefill.targetId ?? null
                    : null;
              openAssetPdfModal(targetAssetId);
            }}
            className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-violet-500" />
            Asset FMEA &amp; GMP PDF
          </button>
        </div>

        {/* Single Spacious Native Scroll Area */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y px-4 sm:px-6 py-5 space-y-6">
          {modalTab === 'heatmap' ? (
            <FacilityRiskHeatmapD3
              initialFloorId={activeIncident?.floorId ?? prefill.floorId ?? 'all'}
              highlightIncidentId={activeIncident?.id ?? null}
              onSelectIncident={(inc) => {
                openRiskModal({ mode: 'resolve', incidentId: inc.id });
                setModalTab('detail');
              }}
              onNavigate3D={(inc) => navigateToRiskTarget(inc, '3d')}
              onOpenAssetPdf={(assetId) => openAssetPdfModal(assetId)}
            />
          ) : isCreate ? (
            <form id="fmea-create-form" onSubmit={handleCreateSubmit} className="space-y-5">
              {/* Target & Classification */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Target Domain</span>
                  <select
                    value={targetKind}
                    onChange={(e) => setTargetKind(e.target.value as RiskTargetKind)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="asset">Equipment / Asset</option>
                    <option value="room">Room / Cleanroom Zone</option>
                    <option value="line">Production Line</option>
                    <option value="network">IT / Data Center Hardware</option>
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Target Entity</span>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100"
                  >
                    {targetOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.code} · {opt.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Incident / Risk Type</span>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as RiskIncidentKind)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="fmea-risk">FMEA Process / Equipment Risk</option>
                    <option value="drift">Live Parameter Drift</option>
                    <option value="alarm">Critical Alarm Excursion</option>
                    <option value="compliance-deviation">GMP Compliance Deviation</option>
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Responsible Owner</span>
                  <input
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="e.g., Dr. N. Rahimi · QA Sterile"
                    className="w-full min-h-[44px] px-3 rounded-xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Incident / Risk Title</span>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., WFI Loop Return Temperature Drift Below 80°C"
                  className="w-full min-h-[44px] px-3 rounded-xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100"
                />
              </label>

              {/* FMEA Failure Mode / Effect / Cause */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Potential Failure Mode</span>
                  <textarea
                    rows={2}
                    value={failureMode}
                    onChange={(e) => setFailureMode(e.target.value)}
                    placeholder="How can this equipment, room, or line fail?"
                    className="w-full p-3 rounded-xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 resize-none"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Potential Effect on Product / GMP</span>
                  <textarea
                    rows={2}
                    value={effect}
                    onChange={(e) => setEffect(e.target.value)}
                    placeholder="Impact on sterility, batch release, or uptime"
                    className="w-full p-3 rounded-xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 resize-none"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Potential Root Cause</span>
                  <textarea
                    rows={2}
                    value={cause}
                    onChange={(e) => setCause(e.target.value)}
                    placeholder="Underlying mechanical, HVAC, or procedural cause"
                    className="w-full p-3 rounded-xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 resize-none"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Current Detection &amp; Controls</span>
                  <textarea
                    rows={2}
                    value={currentControls}
                    onChange={(e) => setCurrentControls(e.target.value)}
                    placeholder="Existing alarms, SOP checks, or interlocks"
                    className="w-full p-3 rounded-xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 resize-none"
                  />
                </label>
              </div>

              {/* Live FMEA RPN Calculator */}
              <div className="p-4 sm:p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#16161F] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      FMEA Risk Priority Number (RPN = S × O × D)
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      Rate Severity, Occurrence, and Detection difficulty from 1 (low) to 10 (highest risk)
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-bold font-mono tabular-nums ${livePriority.textClass}`}>
                      RPN {liveRpn}
                    </div>
                    <div className={`text-xs font-semibold ${livePriority.textClass}`}>
                      {livePriority.label} Priority
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <label className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-600 dark:text-zinc-400">Severity (S)</span>
                      <span className="font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{severity} / 10</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={severity}
                      onChange={(e) => setSeverity(Number(e.target.value))}
                      className="w-full accent-rose-500"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-600 dark:text-zinc-400">Occurrence (O)</span>
                      <span className="font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{occurrence} / 10</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={occurrence}
                      onChange={(e) => setOccurrence(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-600 dark:text-zinc-400">Detection (D)</span>
                      <span className="font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{detection} / 10</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={detection}
                      onChange={(e) => setDetection(Number(e.target.value))}
                      className="w-full accent-violet-500"
                    />
                  </label>
                </div>
              </div>
            </form>
          ) : (
            /* ── INSPECT & AI RESOLVE MODE ── */
            (() => {
              const inc = activeIncident;
              const prio = getRpnPriority(inc.rpn);
              const resPrio = inc.aiResolution ? getRpnPriority(inc.aiResolution.residualRpn) : null;

              return (
                <div className="space-y-6">
                  {/* Context Strip + Quick Navigation */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="space-y-1 min-w-0">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {inc.targetCode} · {inc.targetName}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>Owner: {inc.owner}</span>
                        {inc.currentValueLabel && (
                          <>
                            <span>·</span>
                            <span className="font-mono font-medium text-amber-600 dark:text-amber-400">
                              {inc.currentValueLabel}
                            </span>
                          </>
                        )}
                        {inc.linkedWorkOrderId && (
                          <>
                            <span>·</span>
                            <span className="font-mono text-emerald-600 dark:text-emerald-400">
                              CAPA {inc.linkedWorkOrderId}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Direct Spatial & Telemetry Jumps */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => navigateToRiskTarget(inc, '3d')}
                        className="min-h-[38px] px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Box className="w-3.5 h-3.5" />
                        Go to 3D
                      </button>
                      <button
                        type="button"
                        onClick={() => navigateToRiskTarget(inc, '2d')}
                        className="min-h-[38px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-zinc-800 dark:text-zinc-100 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                      >
                        <MapIcon className="w-3.5 h-3.5" />
                        Go to 2D
                      </button>
                      {(inc.sensorId || inc.targetKind === 'asset' || inc.targetKind === 'room') && (
                        <button
                          type="button"
                          onClick={() => navigateToRiskTarget(inc, 'telemetry')}
                          className="min-h-[38px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 text-zinc-800 dark:text-zinc-100 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                        >
                          <Activity className="w-3.5 h-3.5 text-emerald-500" />
                          Telemetry
                        </button>
                      )}
                      {(inc.targetKind === 'asset' || inc.targetKind === 'network') && (
                        <button
                          type="button"
                          onClick={() => openAssetPdfModal(inc.targetId)}
                          className="min-h-[38px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-amber-500 text-zinc-800 dark:text-zinc-100 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5 text-amber-500" />
                          PDF Report
                        </button>
                      )}
                      {inc.targetKind === 'network' && (
                        <button
                          type="button"
                          onClick={() => navigateToRiskTarget(inc, 'network')}
                          className="min-h-[38px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-cyan-500 text-zinc-800 dark:text-zinc-100 text-xs font-medium cursor-pointer"
                        >
                          IT Designer
                        </button>
                      )}
                    </div>
                  </div>

                  {/* FMEA Breakdown & Interactive Scoring */}
                  <div className="p-4 sm:p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#16161F] space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                            Current FMEA RPN
                          </div>
                          <div className={`text-2xl font-bold font-mono tabular-nums ${prio.textClass}`}>
                            {inc.rpn}{' '}
                            <span className="text-xs font-sans font-semibold">({prio.label})</span>
                          </div>
                        </div>
                        {inc.initialRpn !== inc.rpn && (
                          <div className="text-xs font-mono text-zinc-500">
                            Initial {inc.initialRpn} → {inc.rpn}
                          </div>
                        )}
                      </div>

                      {/* Status Selector */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">Status</span>
                        <select
                          value={inc.status}
                          onChange={(e) => updateIncidentStatus(inc.id, e.target.value as IncidentStatus)}
                          className="min-h-[38px] px-3 rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-900 dark:text-zinc-100"
                        >
                          {(Object.keys(STATUS_LABELS) as IncidentStatus[]).map((st) => (
                            <option key={st} value={st}>
                              {STATUS_LABELS[st]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <label className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-zinc-500">Severity (S)</span>
                          <span className="font-mono font-bold tabular-nums">{inc.severity}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={10}
                          value={inc.severity}
                          onChange={(e) =>
                            updateFmeaScores(inc.id, Number(e.target.value), inc.occurrence, inc.detection)
                          }
                          className="w-full accent-rose-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-zinc-500">Occurrence (O)</span>
                          <span className="font-mono font-bold tabular-nums">{inc.occurrence}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={10}
                          value={inc.occurrence}
                          onChange={(e) =>
                            updateFmeaScores(inc.id, inc.severity, Number(e.target.value), inc.detection)
                          }
                          className="w-full accent-amber-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-zinc-500">Detection (D)</span>
                          <span className="font-mono font-bold tabular-nums">{inc.detection}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={10}
                          value={inc.detection}
                          onChange={(e) =>
                            updateFmeaScores(inc.id, inc.severity, inc.occurrence, Number(e.target.value))
                          }
                          className="w-full accent-violet-500"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-200/80 dark:border-zinc-800 text-xs">
                      <div>
                        <div className="text-zinc-500 font-medium mb-0.5">Failure Mode</div>
                        <div className="text-zinc-900 dark:text-zinc-100">{inc.failureMode}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-medium mb-0.5">Potential Effect</div>
                        <div className="text-zinc-900 dark:text-zinc-100">{inc.effect}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-medium mb-0.5">Suspected Cause</div>
                        <div className="text-zinc-900 dark:text-zinc-100">{inc.cause}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500 font-medium mb-0.5">Current Controls</div>
                        <div className="text-zinc-900 dark:text-zinc-100">{inc.currentControls}</div>
                      </div>
                    </div>
                  </div>

                  {/* Gemini AI Resolution & CAPA Engine */}
                  <div className="p-4 sm:p-5 rounded-2xl border border-violet-500/30 bg-violet-500/[0.04] dark:bg-violet-500/[0.07] space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-violet-500 shrink-0" />
                        <div>
                          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            AI Root Cause &amp; CAPA Resolution
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            Generates containment steps, GMP CAPA actions, SOP references &amp; residual RPN
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={aiLoading}
                        onClick={() => handleGenerateAiResolution(inc)}
                        className="min-h-[40px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        {aiLoading ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Analyzing…
                          </>
                        ) : inc.aiResolution ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5" />
                            Regenerate Plan
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            Generate AI Resolution
                          </>
                        )}
                      </button>
                    </div>

                    {aiError && (
                      <div className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-600 dark:text-rose-300 flex items-center justify-between gap-2">
                        <span>{aiError}</span>
                        <button
                          type="button"
                          onClick={() => handleGenerateAiResolution(inc)}
                          className="underline font-semibold shrink-0 cursor-pointer"
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    {inc.aiResolution && (
                      <div className="space-y-4 pt-2 border-t border-violet-500/20">
                        <div className="text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed">
                          {inc.aiResolution.summary}
                        </div>

                        <div className="text-xs space-y-1">
                          <div className="font-semibold text-zinc-700 dark:text-zinc-300">Engineering Root Cause</div>
                          <div className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
                            {inc.aiResolution.rootCause}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                          <div className="space-y-1.5">
                            <div className="font-semibold text-amber-600 dark:text-amber-400">
                              Immediate Containment
                            </div>
                            <ol className="list-decimal list-inside space-y-1.5 text-zinc-700 dark:text-zinc-300">
                              {inc.aiResolution.immediateContainment.map((step, i) => (
                                <li key={i} className="leading-snug">
                                  {step}
                                </li>
                              ))}
                            </ol>
                          </div>

                          <div className="space-y-1.5">
                            <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                              Preventive CAPA Actions
                            </div>
                            <ol className="list-decimal list-inside space-y-1.5 text-zinc-700 dark:text-zinc-300">
                              {inc.aiResolution.capaActions.map((step, i) => (
                                <li key={i} className="leading-snug">
                                  {step}
                                </li>
                              ))}
                            </ol>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-violet-500/20">
                          <div className="text-xs space-y-0.5">
                            <div className="text-zinc-500">
                              SOPs: {inc.aiResolution.sopReferences.join(' · ')}
                            </div>
                            <div className="font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
                              Projected Residual RPN:{' '}
                              <span className={`font-bold ${resPrio?.textClass}`}>
                                {inc.aiResolution.residualRpn}
                              </span>{' '}
                              (S:{inc.aiResolution.residualSeverity} × O:{inc.aiResolution.residualOccurrence} × D:
                              {inc.aiResolution.residualDetection})
                            </div>
                          </div>

                          {inc.aiResolution.applied ? (
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-4 h-4" />
                              CAPA Applied ({inc.linkedWorkOrderId})
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleApplyAiResolution(inc)}
                              className="min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                            >
                              <ClipboardCheck className="w-4 h-4" />
                              Apply Resolution &amp; Create CAPA Work Order
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          )}
        </div>

        {/* Footer */}
        <footer className="shrink-0 px-4 sm:px-6 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-[#16161D] flex items-center justify-between gap-3">
          {modalTab === 'heatmap' ? (
            <>
              <button
                type="button"
                onClick={() => setModalTab('detail')}
                className="min-h-[40px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {isCreate ? 'Log New FMEA Risk' : 'Back to Incident'}
              </button>
              <button
                type="button"
                onClick={closeRiskModal}
                className="min-h-[40px] px-4 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </>
          ) : isCreate ? (
            <>
              <button
                type="button"
                onClick={closeRiskModal}
                className="min-h-[42px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="fmea-create-form"
                className="min-h-[42px] px-5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Save FMEA Risk (RPN {liveRpn})
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  if (activeIncident) {
                    deleteIncident(activeIncident.id);
                    closeRiskModal();
                  }
                }}
                className="min-h-[40px] px-3 rounded-xl text-rose-500 hover:bg-rose-500/10 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove Record
              </button>
              <button
                type="button"
                onClick={closeRiskModal}
                className="min-h-[40px] px-4 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
};

/* ───────────────────────────────────────────────────────────────────────────
 * 2. REUSABLE SECTION: Risks, Drifts & FMEA on Equipment, Rooms & Lines
 * ─────────────────────────────────────────────────────────────────────────── */
export interface EntityRisksSectionProps {
  targetKind: RiskTargetKind;
  targetId: string;
  targetCode: string;
  targetName: string;
  floorId?: string;
  roomId?: string;
  /** For Production Lines: also aggregate risks on constituent assets & rooms */
  extraAssetIds?: string[];
  extraRoomIds?: string[];
  compact?: boolean;
}

export const EntityRisksSection: React.FC<EntityRisksSectionProps> = ({
  targetKind,
  targetId,
  targetCode,
  targetName,
  floorId,
  roomId,
  extraAssetIds,
  extraRoomIds,
  compact = false,
}) => {
  const incidents = useRiskIncidentStore((s) => s.incidents);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);
  const openAssetPdfModal = useRiskIncidentStore((s) => s.openAssetPdfModal);

  const matchingIncidents = useMemo(() => {
    const extraAssetSet = new Set(extraAssetIds ?? []);
    const extraRoomSet = new Set(extraRoomIds ?? []);

    return incidents
      .filter((inc) => {
        if (inc.targetId === targetId) return true;
        if (targetKind === 'room' && inc.roomId === targetId) return true;
        if (targetKind === 'line') {
          if (extraAssetSet.has(inc.targetId)) return true;
          if (extraRoomSet.has(inc.targetId)) return true;
          if (inc.roomId && extraRoomSet.has(inc.roomId)) return true;
        }
        return false;
      })
      .sort((a, b) => {
        const openA = a.status === 'open' || a.status === 'investigating' ? 1 : 0;
        const openB = b.status === 'open' || b.status === 'investigating' ? 1 : 0;
        if (openA !== openB) return openB - openA;
        return b.rpn - a.rpn;
      });
  }, [incidents, targetId, targetKind, extraAssetIds, extraRoomIds]);

  const openCount = matchingIncidents.filter((i) => i.status === 'open' || i.status === 'investigating').length;
  const maxRpn = matchingIncidents.reduce((m, i) => Math.max(m, i.rpn), 0);

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShieldAlert className={`w-3.5 h-3.5 shrink-0 ${openCount > 0 ? 'text-amber-500' : 'text-emerald-500'}`} />
          <span className={compact ? 'text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 truncate' : 'text-xs font-bold text-zinc-900 dark:text-zinc-100'}>
            Risks, Drifts &amp; FMEA ({matchingIncidents.length})
          </span>
          {maxRpn > 0 && (
            <span className={`font-mono text-[11px] font-bold tabular-nums ${getRpnPriority(maxRpn).textClass}`}>
              · Max RPN {maxRpn}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {(targetKind === 'asset' || targetKind === 'network') && (
            <button
              type="button"
              onClick={() => openAssetPdfModal(targetId)}
              className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-amber-500 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 flex items-center gap-1 cursor-pointer"
              title="Generate FMEA & GMP Compliance PDF Report"
            >
              <FileText className="w-3 h-3 text-amber-500" />
              PDF
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              openRiskModal({
                mode: 'create',
                targetKind,
                targetId,
                targetCode,
                targetName,
                floorId,
                roomId,
              })
            }
            className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            Add FMEA
          </button>
        </div>
      </div>

      {matchingIncidents.length === 0 ? (
        <div className="px-3 py-3 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400">
          No open alarms, drifts, or FMEA risks logged for {targetCode}.
        </div>
      ) : (
        <div className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#14141B] overflow-hidden">
          {matchingIncidents.map((inc) => {
            const prio = getRpnPriority(inc.rpn);
            return (
              <div key={inc.id} className={compact ? 'p-2.5 space-y-1.5' : 'p-3.5 space-y-2'}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-mono text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-1.5">
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200">{inc.code}</span>
                      <span>·</span>
                      <span className={inc.kind === 'alarm' ? 'text-rose-500 font-semibold' : inc.kind === 'drift' ? 'text-amber-500 font-semibold' : 'text-violet-500 font-semibold'}>
                        {KIND_LABELS[inc.kind]}
                      </span>
                      <span>·</span>
                      <span>{STATUS_LABELS[inc.status]}</span>
                      {inc.targetId !== targetId && (
                        <>
                          <span>·</span>
                          <span>{inc.targetCode}</span>
                        </>
                      )}
                    </div>
                    <div className={compact ? 'text-xs font-semibold text-zinc-900 dark:text-zinc-100 leading-snug mt-0.5' : 'text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5'}>
                      {inc.title}
                    </div>
                    {inc.currentValueLabel && (
                      <div className="text-[11px] font-mono text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 shrink-0" />
                        <span>{inc.currentValueLabel}</span>
                      </div>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <div className={`text-xs font-mono font-bold tabular-nums ${prio.textClass}`}>
                      RPN {inc.rpn}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-500 tabular-nums">
                      {inc.severity}×{inc.occurrence}×{inc.detection}
                    </div>
                  </div>
                </div>

                {!compact && (
                  <div className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                    {inc.failureMode} — {inc.cause}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => openRiskModal({ mode: 'resolve', incidentId: inc.id })}
                    className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    {inc.aiResolution ? 'View AI CAPA' : 'AI Resolve'}
                  </button>
                  {!compact && (
                    <>
                      <button
                        type="button"
                        onClick={() => navigateToRiskTarget(inc, '3d')}
                        className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-[11px] text-zinc-700 dark:text-zinc-200 cursor-pointer"
                      >
                        3D
                      </button>
                      <button
                        type="button"
                        onClick={() => navigateToRiskTarget(inc, '2d')}
                        className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-[11px] text-zinc-700 dark:text-zinc-200 cursor-pointer"
                      >
                        2D
                      </button>
                    </>
                  )}
                  {inc.linkedWorkOrderId && (
                    <span className="ml-auto text-[10.5px] font-mono text-emerald-600 dark:text-emerald-400">
                      {inc.linkedWorkOrderId}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
