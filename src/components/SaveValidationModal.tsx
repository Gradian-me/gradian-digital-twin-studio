import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  Crosshair,
  Info,
  Loader2,
  ShieldAlert,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useAuth } from '../context/AuthContext';
import { fetchApiJson } from '../utils/safeJson';

interface AIFixPlanItem {
  issueId: string;
  code: string;
  action: string;
  entityId?: string;
  title: string;
  rationale: string;
}

export const SaveValidationModal: React.FC = () => {
  const showSaveValidationModal = useTwinStore((s) => s.showSaveValidationModal);
  const setShowSaveValidationModal = useTwinStore((s) => s.setShowSaveValidationModal);
  const scene = useTwinStore((s) => s.scene);
  const validationIssues = useTwinStore((s) => s.validationIssues);
  const refreshValidation = useTwinStore((s) => s.refreshValidation);
  const applyValidationAutoFixes = useTwinStore((s) => s.applyValidationAutoFixes);
  const saveProjectToLocal = useTwinStore((s) => s.saveProjectToLocal);
  const createSnapshot = useTwinStore((s) => s.createSnapshot);
  const recordAudit = useTwinStore((s) => s.recordAudit);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const showToast = useTwinStore((s) => s.showToast);

  const { user, getIdToken } = useAuth();

  const [saveNote, setSaveNote] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiFixes, setAiFixes] = useState<AIFixPlanItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const counts = useMemo(() => {
    let critical = 0;
    let error = 0;
    let warning = 0;
    let info = 0;
    for (const i of validationIssues) {
      if (i.severity === 'critical') critical++;
      else if (i.severity === 'error') error++;
      else if (i.severity === 'warning') warning++;
      else info++;
    }
    return { critical, error, warning, info };
  }, [validationIssues]);

  if (!showSaveValidationModal) return null;

  const handleClose = () => {
    setShowSaveValidationModal(false);
    setAiSummary(null);
    setAiFixes([]);
    setConfirmed(false);
  };

  const handleAnalyzeAndPlanFixes = async () => {
    setAiLoading(true);
    try {
      const data = await fetchApiJson<any>(
        '/api/validate-fix',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            issues: validationIssues,
            floorSummary: {
              projectName: scene.name,
              floors: scene.floors.length,
              rooms: scene.rooms.length,
              assets: scene.assets.length,
            },
          }),
        },
        'Could not reach AI validation solver. Please retry.'
      );
      setAiSummary(data.summary || 'AI analyzed all detected GMP & spatial issues.');
      setAiFixes(Array.isArray(data.fixes) ? data.fixes : []);
    } catch (err: any) {
      showToast(err?.message || 'Could not reach AI validation solver.', 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAIFixes = () => {
    if (aiFixes.length === 0) return;
    const applied = applyValidationAutoFixes(aiFixes);
    refreshValidation();
    setAiFixes([]);
    setAiSummary(`Applied ${applied} automated spatial & GMP remediation actions. Re-validated scene.`);
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    try {
      saveProjectToLocal();
      if (saveNote.trim()) {
        createSnapshot(saveNote.trim(), `Validated save (${validationIssues.length} notices)`);
      }
      recordAudit({
        category: 'save',
        action: 'Confirmed Validated Save',
        entityType: 'project',
        entityId: scene.id,
        entityName: scene.name,
        summary: `Confirmed save with ${counts.critical} critical, ${counts.error} errors, ${counts.warning} warnings.${saveNote.trim() ? ` Note: "${saveNote.trim()}"` : ''}`,
      });

      if (user) {
        const token = await getIdToken();
        if (token) {
          await fetch(`/api/projects/${encodeURIComponent(scene.id)}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              name: scene.name,
              code: scene.code,
              description: scene.description,
              industry: scene.industry,
              unitSystem: scene.unitSystem,
              revision: scene.revision,
              sceneData: scene,
            }),
          });
          showToast('Saved locally & synchronized to Cloud SQL with Audit Trail entry', 'success');
        }
      }
      handleClose();
    } catch {
      showToast('Saved locally & logged in Audit Trail (cloud sync offline)', 'warning');
      handleClose();
    } finally {
      setSaving(false);
    }
  };

  const hasBlocking = counts.critical > 0 || counts.error > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[90vh] bg-white dark:bg-[#111116] border-0 sm:border border-zinc-200 dark:border-zinc-800 rounded-none sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-[#0E0E12] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={handleClose}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
              Back
            </button>
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white truncate">
                Pre-Save GMP &amp; Spatial Validation Gate
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                Review all collisions, pressure cascades, egress doors, flows, racks &amp; cameras before committing save
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary KPI Strip */}
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 grid grid-cols-4 gap-2.5 shrink-0 bg-zinc-50/40 dark:bg-[#13131A]">
          <div className="p-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-center">
            <div className="text-lg font-mono font-bold text-rose-500">{counts.critical}</div>
            <div className="text-[10px] font-semibold uppercase text-rose-400">Critical</div>
          </div>
          <div className="p-2.5 rounded-2xl border border-orange-500/30 bg-orange-500/10 text-center">
            <div className="text-lg font-mono font-bold text-orange-500">{counts.error}</div>
            <div className="text-[10px] font-semibold uppercase text-orange-400">Errors</div>
          </div>
          <div className="p-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-center">
            <div className="text-lg font-mono font-bold text-amber-500">{counts.warning}</div>
            <div className="text-[10px] font-semibold uppercase text-amber-400">Warnings</div>
          </div>
          <div className="p-2.5 rounded-2xl border border-violet-500/30 bg-violet-500/10 text-center">
            <div className="text-lg font-mono font-bold text-violet-500">{counts.info}</div>
            <div className="text-[10px] font-semibold uppercase text-violet-400">Notices</div>
          </div>
        </div>

        {/* Issues List + AI Remediation Preview */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 sm:p-5 space-y-4">
          {validationIssues.length === 0 ? (
            <div className="p-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-300">
                100% GMP &amp; Spatial Validation Passed
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Zero clashes, valid cleanroom pressure cascades, compliant egress, balanced IT racks, and healthy flows.
              </p>
            </div>
          ) : (
            <>
              {/* AI Auto-Fix Banner */}
              <div className="p-4 rounded-2xl border border-violet-500/35 bg-violet-500/10 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5 max-w-xl">
                  <div className="text-xs font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    AI Engineering Auto-Remediation Available
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-300">
                    Let AI analyze all {validationIssues.length} detected issues and generate safe, previewable fixes for clashes, clearances, doors, pressure cascades, flows &amp; racks.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAnalyzeAndPlanFixes}
                    disabled={aiLoading}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl gradian-violet-amber text-white text-xs font-semibold shadow-sm hover:opacity-95 disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {aiLoading ? 'Analyzing...' : 'Fix with AI'}
                  </button>
                  {aiFixes.length > 0 && (
                    <button
                      onClick={handleApplyAIFixes}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      Apply {aiFixes.length} Fixes
                    </button>
                  )}
                </div>
              </div>

              {aiSummary && (
                <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#17171F] border border-violet-500/30 space-y-2">
                  <div className="text-xs font-semibold text-violet-500">AI Engineering Assessment</div>
                  <p className="text-xs text-zinc-700 dark:text-zinc-200 leading-relaxed">{aiSummary}</p>
                  {aiFixes.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {aiFixes.map((fx, i) => (
                        <div
                          key={`${fx.issueId}-${i}`}
                          className="text-[11px] px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2"
                        >
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{fx.title}</span>
                          <span className="font-mono text-[10px] text-emerald-500">{fx.code}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Full Issue Breakdown */}
              <div className="space-y-2">
                {validationIssues.map((iss) => {
                  const badgeCls =
                    iss.severity === 'critical'
                      ? 'bg-rose-500/15 text-rose-500 border-rose-500/30'
                      : iss.severity === 'error'
                        ? 'bg-orange-500/15 text-orange-500 border-orange-500/30'
                        : iss.severity === 'warning'
                          ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                          : 'bg-violet-500/15 text-violet-500 border-violet-500/30';
                  return (
                    <div
                      key={iss.id}
                      className="p-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#15151C] flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono font-semibold uppercase ${badgeCls}`}>
                            {iss.severity} · {iss.code}
                          </span>
                          <span className="text-xs font-semibold text-zinc-900 dark:text-white">
                            {iss.title}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{iss.description}</p>
                        {iss.autoFixHint && (
                          <div className="text-[10.5px] text-emerald-500 font-medium flex items-center gap-1">
                            <Info className="w-3 h-3" />
                            Suggested Fix: {iss.autoFixHint}
                          </div>
                        )}
                      </div>
                      {iss.entityIds[0] && (
                        <button
                          onClick={() => {
                            const et = iss.entityType === 'opening' ? 'wall' : iss.entityType;
                            focusEntity({ type: et as any, id: iss.entityIds[0] });
                            handleClose();
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#1C1C26] border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-[11px] font-medium flex items-center gap-1 shrink-0"
                        >
                          <Crosshair className="w-3 h-3 text-violet-500" />
                          Inspect
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer Confirmation */}
        <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0E0E12] space-y-3 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            <div className="sm:col-span-7">
              <input
                value={saveNote}
                onChange={(e) => setSaveNote(e.target.value)}
                placeholder="Optional GMP revision / Audit Trail save note (creates snapshot)..."
                className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="sm:col-span-5 flex items-center justify-end gap-2">
              {hasBlocking && (
                <label className="flex items-center gap-1.5 text-[11px] text-amber-500 cursor-pointer mr-2">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="accent-amber-500"
                  />
                  Acknowledge {counts.critical + counts.error} issue(s)
                </label>
              )}
              <button
                onClick={handleConfirmSave}
                disabled={saving || (hasBlocking && !confirmed)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5" />
                )}
                Confirm &amp; Save Revision
              </button>
            </div>
          </div>
          {hasBlocking && !confirmed && (
            <div className="text-[11px] text-amber-500 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Click "Fix with AI" above to resolve critical/error issues automatically, or check Acknowledge to save anyway.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
