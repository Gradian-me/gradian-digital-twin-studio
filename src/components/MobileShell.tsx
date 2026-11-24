import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Box,
  Camera,
  CameraOff,
  Compass,
  FolderTree,
  Home,
  Moon,
  QrCode,
  Search,
  Sun,
  Tag,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import { Viewport3D } from './Viewport3D';
import { Viewport2D } from './Viewport2D';
import { formatArea } from '../utils/spatial';

type MobileTab = 'view' | 'tree' | 'assets' | 'qr' | 'alerts';

export const MobileShell: React.FC = () => {
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const viewMode = useTwinStore((s) => s.viewMode);
  const theme = useTwinStore((s) => s.theme);
  const validationIssues = useTwinStore((s) => s.validationIssues);
  const selected = useTwinStore((s) => s.selected);

  const setScreen = useTwinStore((s) => s.setScreen);
  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const toggleTheme = useTwinStore((s) => s.toggleTheme);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const setShowQuickSearch = useTwinStore((s) => s.setShowQuickSearch);
  const complianceByAssetId = useGmpStore((s) => s.complianceByAssetId);
  const sops = useGmpStore((s) => s.sops);
  const openGmpModal = useGmpStore((s) => s.openGmpModal);
  const openQrLabelModal = useGmpStore((s) => s.openQrLabelModal);

  const [tab, setTab] = useState<MobileTab>('view');
  const [query, setQuery] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopMobileCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (tab !== 'qr') {
      stopMobileCamera();
    }
    return () => stopMobileCamera();
  }, [tab]);

  useEffect(() => {
    if (!cameraActive) return;
    let cancelled = false;
    let rafId = 0;

    const startScan = async () => {
      try {
        setCameraError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        const detector = BarcodeDetectorCtor
          ? new BarcodeDetectorCtor({
              formats: ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13'],
            })
          : null;

        const tick = async () => {
          if (cancelled) return;
          if (detector && videoRef.current && videoRef.current.readyState >= 2) {
            try {
              const found = await detector.detect(videoRef.current);
              if (found && found.length > 0 && found[0].rawValue) {
                const raw = String(found[0].rawValue);
                setLastScannedCode(raw);
                setQrInput(raw);
              }
            } catch {
              // ignore transient frame errors
            }
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (err: any) {
        setCameraError(err?.message || 'Camera access denied or unavailable on this device.');
        setCameraActive(false);
      }
    };

    startScan();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [cameraActive]);

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scene.assets;
    return scene.assets.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.assetId.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    );
  }, [scene.assets, query]);

  const qrMatchedAsset = useMemo(() => {
    const q = qrInput.trim().toLowerCase();
    if (!q) return scene.assets[0] ?? null;
    return (
      scene.assets.find(
        (a) =>
          a.assetId.toLowerCase().includes(q) ||
          a.qrCode.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q)
      ) ?? null
    );
  }, [scene.assets, qrInput]);

  const selectedAsset = useMemo(() => {
    const first = selected[0];
    if (!first || first.type !== 'asset') return null;
    return scene.assets.find((a) => a.id === first.id) ?? null;
  }, [selected, scene.assets]);

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-[#09090B] text-zinc-900 dark:text-zinc-100 md:hidden">
      {/* Slim Mobile Top Header */}
      <header className="h-12 px-3 bg-white dark:bg-[#111114] border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setScreen('hub')}
            className="p-1.5 rounded-md text-zinc-600 dark:text-zinc-300"
            aria-label="Project Hub"
          >
            <Home className="w-4 h-4" />
          </button>
          <select
            aria-label="Active Floor"
            value={activeFloorId}
            onChange={(e) => setActiveFloor(e.target.value)}
            className="h-7 px-2 text-xs font-medium rounded bg-zinc-100 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800 max-w-[155px] truncate"
          >
            {scene.floors.map((fl) => (
              <option key={fl.id} value={fl.id}>
                {fl.code} · {fl.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowQuickSearch(true)}
            className="p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] text-zinc-600 dark:text-zinc-300"
            aria-label="Quick Search"
          >
            <Search className="w-3.5 h-3.5 text-violet-500" />
          </button>
          {tab === 'view' && (
            <button
              onClick={() => setViewMode(viewMode === '2d' ? '3d-perspective' : '2d')}
              className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            >
              {viewMode === '2d' ? '3D' : '2D'}
            </button>
          )}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F]"
            aria-label="Toggle Theme"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-violet-600" />
            )}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 relative overflow-hidden">
        {tab === 'view' && (
          <div className="w-full h-full relative">
            {viewMode === '2d' ? <Viewport2D /> : <Viewport3D />}
            {selectedAsset && (
              <div className="absolute bottom-3 left-3 right-3 p-3 rounded-lg bg-white/95 dark:bg-[#121216]/95 border border-slate-200 dark:border-zinc-700 shadow-lg text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-white truncate">
                    {selectedAsset.name}
                  </span>
                  <span className="font-mono text-violet-600 dark:text-violet-400 shrink-0">
                    {selectedAsset.assetId}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  {selectedAsset.manufacturer} {selectedAsset.model} · Status:{' '}
                  <strong className="capitalize">{selectedAsset.operationalStatus}</strong> · Next PM{' '}
                  {selectedAsset.nextMaintenance}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'tree' && (
          <div className="h-full overflow-y-auto p-3 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Spatial Hierarchy · {scene.name}
            </h2>
            {scene.buildings.map((b) => (
              <div
                key={b.id}
                className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#121216] overflow-hidden"
              >
                <div className="px-3 py-2 text-xs font-semibold bg-slate-50 dark:bg-[#14141A] border-b border-slate-200 dark:border-zinc-800">
                  {b.code} · {b.name}
                </div>
                {scene.floors
                  .filter((f) => f.buildingId === b.id)
                  .map((fl) => (
                    <div key={fl.id} className="p-2.5 space-y-1.5 border-b last:border-b-0 border-slate-100 dark:border-zinc-800">
                      <button
                        onClick={() => {
                          setActiveFloor(fl.id);
                          setTab('view');
                        }}
                        className="text-xs font-semibold text-violet-600 dark:text-violet-400"
                      >
                        {fl.code} — {fl.name}
                      </button>
                      <div className="grid grid-cols-1 gap-1 pl-2">
                        {scene.rooms
                          .filter((r) => r.floorId === fl.id)
                          .map((r) => (
                            <button
                              key={r.id}
                              onClick={() => {
                                focusEntity({ type: 'room', id: r.id });
                                setTab('view');
                              }}
                              className="text-left px-2 py-1.5 rounded bg-slate-50 dark:bg-[#181820] text-xs flex items-center justify-between"
                            >
                              <span className="truncate">{r.name}</span>
                              <span className="font-mono text-[10px] text-slate-500 shrink-0 ml-2">
                                {formatArea(r.width * r.depth, scene.unitSystem)}
                              </span>
                            </button>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}

        {tab === 'assets' && (
          <div className="h-full flex flex-col p-3 space-y-2.5">
            <div className="relative shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search equipment, tag, or category..."
                className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-white dark:bg-[#121216] border border-slate-200 dark:border-zinc-800"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {filteredAssets.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    focusEntity({ type: 'asset', id: a.id });
                    setTab('view');
                  }}
                  className="w-full text-left p-3 rounded-lg bg-white dark:bg-[#121216] border border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{a.name}</div>
                    <div className="text-[11px] font-mono text-slate-500 truncate">
                      {a.assetId} · {a.manufacturer} · {a.operationalStatus}
                    </div>
                  </div>
                  <span className="text-[11px] text-violet-600 dark:text-violet-400 font-medium shrink-0">
                    Locate
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'qr' && (
          <div className="h-full overflow-y-auto p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                QR / Barcode / DataMatrix Scanner
              </h2>
              <button
                type="button"
                onClick={() => openQrLabelModal('designer')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500 text-zinc-950 text-[11px] font-semibold cursor-pointer"
              >
                <Tag className="w-3 h-3" />
                Label Designer
              </button>
            </div>

            {/* Live Camera Feed */}
            <div className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 relative">
              {cameraActive ? (
                <div className="relative h-48 w-full">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-40 h-40 rounded-2xl border-2 border-violet-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
                  </div>
                  <button
                    type="button"
                    onClick={stopMobileCamera}
                    className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-1 rounded-xl bg-black/80 text-white text-[11px] font-semibold cursor-pointer"
                  >
                    <CameraOff className="w-3.5 h-3.5 text-rose-400" />
                    Stop
                  </button>
                </div>
              ) : (
                <div className="p-4 flex flex-col items-center justify-center text-center gap-2 bg-zinc-100 dark:bg-[#13131A]">
                  <button
                    type="button"
                    onClick={() => setCameraActive(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-sm cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    Start Live Camera Scan (QR / Barcode / DataMatrix)
                  </button>
                  <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400">
                    Point at any equipment plaque, iron room sign, or micro sensor tag
                  </p>
                  {cameraError && (
                    <p className="text-[11px] text-rose-500 font-medium">{cameraError}</p>
                  )}
                </div>
              )}
            </div>

            {lastScannedCode && (
              <div className="px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                Scanned: {lastScannedCode}
              </div>
            )}

            <input
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              placeholder="Or type asset tag / QR code (e.g. BR-2001, LYO-401)..."
              className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-[#121216] border border-slate-200 dark:border-zinc-800"
            />
            {qrMatchedAsset ? (() => {
              const gmpRec = complianceByAssetId[qrMatchedAsset.id];
              const matchingSops = sops.filter(
                (s) => s.equipmentCategory === qrMatchedAsset.category
              );
              return (
                <div className="p-4 rounded-2xl bg-white dark:bg-[#121216] border border-slate-200 dark:border-zinc-800 space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">{qrMatchedAsset.name}</span>
                    <span className="font-mono text-violet-500 shrink-0">{qrMatchedAsset.assetId}</span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500">{qrMatchedAsset.qrCode}</div>

                  {gmpRec && (
                    <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                      <div className="p-2 rounded-xl bg-zinc-50 dark:bg-[#181822] border border-zinc-200 dark:border-zinc-800">
                        <span className="text-zinc-400 block">Calibration</span>
                        <strong className={`font-mono ${gmpRec.calibration.status === 'overdue' ? 'text-rose-500' : 'text-emerald-500'}`}>
                          {gmpRec.calibration.nextDueDate}
                        </strong>
                      </div>
                      <div className="p-2 rounded-xl bg-zinc-50 dark:bg-[#181822] border border-zinc-200 dark:border-zinc-800">
                        <span className="text-zinc-400 block">{gmpRec.qualification.stage}</span>
                        <strong className={`font-mono ${gmpRec.qualification.status === 'overdue' ? 'text-rose-500' : 'text-emerald-500'}`}>
                          {gmpRec.qualification.nextDueDate}
                        </strong>
                      </div>
                      <div className="p-2 rounded-xl bg-zinc-50 dark:bg-[#181822] border border-zinc-200 dark:border-zinc-800">
                        <span className="text-zinc-400 block">PM Due</span>
                        <strong className={`font-mono ${gmpRec.maintenance.status === 'overdue' ? 'text-rose-500' : 'text-emerald-500'}`}>
                          {gmpRec.maintenance.nextDueDate}
                        </strong>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-zinc-800 text-[11px]">
                    <div>
                      <span className="text-slate-500 block">Status</span>
                      <strong className="capitalize">{qrMatchedAsset.operationalStatus}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Protocol / PLC</span>
                      <strong className="font-mono">{qrMatchedAsset.connectivity.plcTag}</strong>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        stopMobileCamera();
                        setViewMode('3d-perspective');
                        focusEntity({ type: 'asset', id: qrMatchedAsset.id });
                        setTab('view');
                      }}
                      className="py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold cursor-pointer"
                    >
                      Fly to 3D
                    </button>
                    <button
                      type="button"
                      onClick={() => openGmpModal({ tab: 'sops', assetId: qrMatchedAsset.id })}
                      className="py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#1B1B24] text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-amber-500" />
                      SOPs ({matchingSops.length})
                    </button>
                  </div>
                </div>
              );
            })() : (
              <p className="text-xs text-slate-500">No matching asset found for that tag.</p>
            )}
          </div>
        )}

        {tab === 'alerts' && (
          <div className="h-full overflow-y-auto p-3 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Maintenance &amp; Spatial Alerts ({validationIssues.length})
            </h2>
            {validationIssues.map((issue) => (
              <button
                key={issue.id}
                onClick={() => {
                  setActiveFloor(issue.floorId);
                  if (issue.entityIds[0]) {
                    focusEntity({ type: issue.entityType, id: issue.entityIds[0] });
                  }
                  setTab('view');
                }}
                className="w-full text-left p-3 rounded-lg bg-white dark:bg-[#121216] border border-slate-200 dark:border-zinc-800 space-y-1"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold truncate">{issue.title}</span>
                  <span
                    className={`font-mono text-[10px] uppercase shrink-0 ml-2 ${
                      issue.severity === 'critical' || issue.severity === 'error'
                        ? 'text-red-500'
                        : issue.severity === 'warning'
                          ? 'text-amber-500'
                          : 'text-violet-500'
                    }`}
                  >
                    {issue.code}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {issue.description}
                </p>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Compact Bottom Nav (56px — well under 15% of viewport height) */}
      <nav className="h-14 bg-white dark:bg-[#111114] border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-5 shrink-0">
        {(
          [
            { id: 'view', label: 'Explore', icon: Compass },
            { id: 'tree', label: 'Site', icon: FolderTree },
            { id: 'assets', label: 'Assets', icon: Box },
            { id: 'qr', label: 'QR/AR', icon: QrCode },
            { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                active
                  ? 'text-violet-600 dark:text-violet-400'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
