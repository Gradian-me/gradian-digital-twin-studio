import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Download,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileUp,
  GitCompare,
  History,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useAuth } from '../context/AuthContext';
import {
  exportAssetsToCSV,
  exportRoomScheduleCSV,
  exportSceneToOBJ,
  formatCurrency,
  triggerFileDownload,
} from '../utils/spatial';
import type { DigitalTwinScene, LocalSnapshot } from '../types/twin';

export const ExportSnapshotsModal: React.FC = () => {
  const showExportModal = useTwinStore((s) => s.showExportModal);
  const setShowExportModal = useTwinStore((s) => s.setShowExportModal);
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const snapshots = useTwinStore((s) => s.snapshots);
  const createSnapshot = useTwinStore((s) => s.createSnapshot);
  const restoreSnapshot = useTwinStore((s) => s.restoreSnapshot);
  const importProjectJSON = useTwinStore((s) => s.importProjectJSON);
  const showToast = useTwinStore((s) => s.showToast);

  const { user, getIdToken } = useAuth();
  const [tab, setTab] = useState<'export' | 'snapshots'>('export');
  const [snapLabel, setSnapLabel] = useState('');
  const [snapSummary, setSnapSummary] = useState('');
  const [compareA, setCompareA] = useState<string>('');
  const [compareB, setCompareB] = useState<string>('current');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const comparison = useMemo(() => {
    if (!compareA) return null;
    const snapA = snapshots.find((s) => s.id === compareA)?.sceneData;
    const snapB =
      compareB === 'current'
        ? scene
        : snapshots.find((s) => s.id === compareB)?.sceneData;
    if (!snapA || !snapB) return null;
    const calcCapex = (sc: DigitalTwinScene) =>
      sc.rooms.reduce((s, r) => s + r.width * r.depth * r.costPerSqm, 0) +
      sc.assets.reduce((s, a) => s + a.capexUsd, 0);
    return {
      roomsDelta: snapB.rooms.length - snapA.rooms.length,
      wallsDelta: snapB.walls.length - snapA.walls.length,
      assetsDelta: snapB.assets.length - snapA.assets.length,
      capexDelta: calcCapex(snapB) - calcCapex(snapA),
      aRooms: snapA.rooms.length,
      bRooms: snapB.rooms.length,
      aAssets: snapA.assets.length,
      bAssets: snapB.assets.length,
    };
  }, [compareA, compareB, snapshots, scene]);

  if (!showExportModal) return null;

  const safeSlug = scene.code.toLowerCase().replace(/[^a-z0-9-_]+/g, '-');

  const handleExportJSON = () => {
    triggerFileDownload(
      `${safeSlug}-digital-twin.json`,
      JSON.stringify(scene, null, 2),
      'application/json'
    );
    showToast('Exported full Digital Twin JSON', 'success');
  };

  const handleExportAssetsCSV = () => {
    triggerFileDownload(`${safeSlug}-asset-register.csv`, exportAssetsToCSV(scene), 'text/csv');
    showToast('Exported Equipment & Asset Register CSV', 'success');
  };

  const handleExportRoomsCSV = () => {
    triggerFileDownload(
      `${safeSlug}-room-schedule.csv`,
      exportRoomScheduleCSV(scene),
      'text/csv'
    );
    showToast('Exported GMP Room Schedule CSV', 'success');
  };

  const handleExportOBJ = () => {
    const objText = exportSceneToOBJ(scene, activeFloorId);
    triggerFileDownload(`${safeSlug}-floor-3d.obj`, objText, 'text/plain');
    showToast('Exported active floor 3D OBJ mesh', 'success');
  };

  const handleCaptureScreenshot = () => {
    const captureFn = (window as unknown as { __gradianCapture3D?: () => string | null })
      .__gradianCapture3D;
    const dataUrl = captureFn?.();
    if (!dataUrl) {
      showToast('Switch to 3D or Split view to capture a 3D studio screenshot.', 'warning');
      return;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${safeSlug}-3d-studio.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Saved 3D Viewport PNG screenshot', 'success');
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed.buildings || !parsed.floors) throw new Error('Invalid schema');
        importProjectJSON(parsed as DigitalTwinScene);
        setShowExportModal(false);
      } catch {
        showToast('Could not parse Digital Twin JSON file.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSaveSnapshot = async () => {
    const label =
      snapLabel.trim() || `Revision ${scene.revision}.${snapshots.length + 1}`;
    const snap: LocalSnapshot = createSnapshot(label, snapSummary.trim() || undefined);
    setSnapLabel('');
    setSnapSummary('');

    if (user) {
      try {
        const token = await getIdToken();
        if (token) {
          await fetch(`/api/projects/${encodeURIComponent(scene.id)}/snapshots`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              id: snap.id,
              versionTag: snap.versionTag,
              label: snap.label,
              summary: snap.summary,
              sceneData: snap.sceneData,
            }),
          });
        }
      } catch {
        // already persisted locally
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[90vh] bg-white dark:bg-[#121216] border-0 sm:border border-slate-200 dark:border-zinc-800 rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setShowExportModal(false)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 shrink-0 transition-colors"
              title="Back"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
              <span className="hidden sm:inline">Back</span>
            </button>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
                Export, Import &amp; Revision Snapshots
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {scene.name} · {scene.code} · Rev {scene.revision}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowExportModal(false)}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#22222C] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 border-b border-slate-200 dark:border-zinc-800 flex items-center gap-4 text-xs font-medium shrink-0 overflow-x-auto">
          <button
            onClick={() => setTab('export')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              tab === 'export'
                ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            Import &amp; Export
          </button>
          <button
            onClick={() => setTab('snapshots')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              tab === 'snapshots'
                ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Snapshots &amp; Revision Compare ({snapshots.length})
          </button>
        </div>

        {/* Content */}
        <div key={tab} className="flex-1 min-h-0 p-4 sm:p-5 overflow-y-auto overscroll-contain touch-pan-y space-y-5">
          {tab === 'export' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleExportJSON}
                  className="text-left p-4 rounded-lg border border-slate-200 dark:border-zinc-800 hover:border-violet-500 dark:hover:border-violet-500 transition-colors"
                >
                  <FileJson className="w-5 h-5 text-violet-500 mb-2" />
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Digital Twin JSON
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Complete hierarchy, 2D/3D geometry, materials, flows, cameras &amp; 5D data.
                  </p>
                </button>

                <button
                  onClick={handleExportAssetsCSV}
                  className="text-left p-4 rounded-lg border border-slate-200 dark:border-zinc-800 hover:border-violet-500 dark:hover:border-violet-500 transition-colors"
                >
                  <FileSpreadsheet className="w-5 h-5 text-emerald-500 mb-2" />
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Asset Register CSV
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {scene.assets.length} intelligent assets with SCADA/PLC tags, CapEx, OpEx &amp; PM dates.
                  </p>
                </button>

                <button
                  onClick={handleExportRoomsCSV}
                  className="text-left p-4 rounded-lg border border-slate-200 dark:border-zinc-800 hover:border-violet-500 dark:hover:border-violet-500 transition-colors"
                >
                  <FileSpreadsheet className="w-5 h-5 text-sky-500 mb-2" />
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    GMP Room Schedule CSV
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {scene.rooms.length} spaces with cleanroom grade, ΔP, ACH, area, volume &amp; compliance.
                  </p>
                </button>

                <button
                  onClick={handleExportOBJ}
                  className="text-left p-4 rounded-lg border border-slate-200 dark:border-zinc-800 hover:border-violet-500 dark:hover:border-violet-500 transition-colors"
                >
                  <FileCode2 className="w-5 h-5 text-violet-500 mb-2" />
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    3D Geometry (.OBJ)
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Wavefront OBJ spatial massing of the active floor for CAD &amp; BIM tools.
                  </p>
                </button>

                <button
                  onClick={handleCaptureScreenshot}
                  className="text-left p-4 rounded-lg border border-slate-200 dark:border-zinc-800 hover:border-violet-500 dark:hover:border-violet-500 transition-colors"
                >
                  <Camera className="w-5 h-5 text-amber-500 mb-2" />
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    3D Studio Snapshot (.PNG)
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    High-resolution PNG capture directly from the live WebGL viewport.
                  </p>
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-left p-4 rounded-lg border border-dashed border-slate-300 dark:border-zinc-700 hover:border-violet-500 transition-colors"
                >
                  <FileUp className="w-5 h-5 text-slate-500 dark:text-slate-400 mb-2" />
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Import Digital Twin JSON
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Load an existing Gradian JSON facility twin into the workspace.
                  </p>
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImportJSON}
              />

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#181820] border border-slate-200 dark:border-zinc-800 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  BIM &amp; Interoperability Pipeline:
                </span>{' '}
                Reference plans (PNG/JPG/SVG) with 2-point real-world calibration are supported in the left{' '}
                <strong>Refs</strong> browser. IFC, Revit RVT, and GLTF/GLB ingestion hooks are structured on the scene entity schema.
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {/* Create Snapshot Form */}
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-800 space-y-2.5">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Create Revision Snapshot
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={snapLabel}
                    onChange={(e) => setSnapLabel(e.target.value)}
                    placeholder={`Revision ${scene.revision}.${snapshots.length + 1}`}
                    className="px-2.5 py-1.5 text-xs rounded-md bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
                  />
                  <input
                    value={snapSummary}
                    onChange={(e) => setSnapSummary(e.target.value)}
                    placeholder="Change note (e.g. Added Grade B airlock)..."
                    className="px-2.5 py-1.5 text-xs rounded-md bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
                  />
                </div>
                <button
                  onClick={handleSaveSnapshot}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Snapshot
                </button>
              </div>

              {/* Compare Two Snapshots */}
              {snapshots.length > 0 && (
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-zinc-800 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <GitCompare className="w-3.5 h-3.5 text-violet-500" />
                    Compare Revisions
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={compareA}
                      onChange={(e) => setCompareA(e.target.value)}
                      className="px-2 py-1.5 text-xs rounded bg-slate-50 dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
                    >
                      <option value="">Select baseline snapshot...</option>
                      {snapshots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.versionTag} — {s.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={compareB}
                      onChange={(e) => setCompareB(e.target.value)}
                      className="px-2 py-1.5 text-xs rounded bg-slate-50 dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
                    >
                      <option value="current">Current Working Model</option>
                      {snapshots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.versionTag} — {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {comparison && (
                    <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-xs tabular-nums">
                      <div className="p-2 rounded bg-slate-50 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-800">
                        <div className="text-[10px] text-slate-500">Rooms Δ</div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {comparison.roomsDelta >= 0 ? '+' : ''}
                          {comparison.roomsDelta}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-50 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-800">
                        <div className="text-[10px] text-slate-500">Walls Δ</div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {comparison.wallsDelta >= 0 ? '+' : ''}
                          {comparison.wallsDelta}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-50 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-800">
                        <div className="text-[10px] text-slate-500">Assets Δ</div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {comparison.assetsDelta >= 0 ? '+' : ''}
                          {comparison.assetsDelta}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-50 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-800">
                        <div className="text-[10px] text-slate-500">CapEx Δ</div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {comparison.capexDelta >= 0 ? '+' : '-'}
                          {formatCurrency(Math.abs(comparison.capexDelta))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Saved Snapshots List */}
              {snapshots.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-500 dark:text-slate-400">
                  No revision snapshots yet. Capture a snapshot before major layout changes.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-lg">
                  {snapshots.map((snap) => (
                    <div
                      key={snap.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {snap.versionTag} · {snap.label}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {snap.summary} · {new Date(snap.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          restoreSnapshot(snap);
                          setShowExportModal(false);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C] text-xs font-medium whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
