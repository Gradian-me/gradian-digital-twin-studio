import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  ClipboardList,
  Compass,
  Download,
  FileCheck2,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  ShieldAlert,
  Sparkles,
  Tag,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import {
  buildCode128Bars,
  buildDataMatrix,
  buildQrMatrix,
  renderBarcodeSvgString,
  renderDataMatrixSvgString,
  renderQrSvgString,
} from '../utils/barcodeSvg';
import type { Room, SpatialAsset } from '../types/twin';
import type { SensorDefinition } from '../types/telemetry';

type LabelEntityKind = 'equipment' | 'room' | 'sensor';
type LabelSymbology = 'qr+barcode' | 'qr-only' | 'datamatrix' | 'barcode-only';
type LabelFinish = 'brushed-iron' | 'charcoal-anodized' | 'cleanroom-white' | 'violet-amber';
type CornerStyle = 'rounded-2xl' | 'rounded-xl' | 'rounded-none';

interface LabelItem {
  key: string; // e.g. eq:<id>, rm:<id>, sn:<id>
  id: string;
  kind: LabelEntityKind;
  code: string;
  name: string;
  subtitle: string;
  locationLabel: string;
  qrPayload: string;
  sizeMm: { w: number; h: number; desc: string };
  calDue?: string;
  qualDue?: string;
  pmDue?: string;
  status?: 'valid' | 'due-soon' | 'overdue' | string;
  cleanroomGrade?: string;
  pressurePa?: number;
  unit?: string;
  assetRef?: SpatialAsset;
  roomRef?: Room;
  sensorRef?: SensorDefinition;
}

const QrSvgInline: React.FC<{ payload: string; fg: string; bg: string; size?: number }> = ({
  payload,
  fg,
  bg,
  size = 76,
}) => {
  const mat = useMemo(() => buildQrMatrix(payload, 25), [payload]);
  const n = mat.length;
  const pad = 2;
  const total = n + pad * 2;
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="shrink-0"
    >
      <rect width={total} height={total} fill={bg} rx={1.5} />
      {mat.map((row, r) =>
        row.map((cell, c) =>
          cell ? (
            <rect key={`${r}-${c}`} x={c + pad} y={r + pad} width={1} height={1} fill={fg} />
          ) : null
        )
      )}
    </svg>
  );
};

const DataMatrixInline: React.FC<{ payload: string; fg: string; bg: string; size?: number }> = ({
  payload,
  fg,
  bg,
  size = 46,
}) => {
  const mat = useMemo(() => buildDataMatrix(payload, 16), [payload]);
  const n = mat.length;
  const pad = 1.5;
  const total = n + pad * 2;
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="shrink-0"
    >
      <rect width={total} height={total} fill={bg} rx={1} />
      {mat.map((row, r) =>
        row.map((cell, c) =>
          cell ? (
            <rect key={`${r}-${c}`} x={c + pad} y={r + pad} width={1} height={1} fill={fg} />
          ) : null
        )
      )}
    </svg>
  );
};

const BarcodeInline: React.FC<{
  payload: string;
  fg: string;
  width?: number;
  height?: number;
}> = ({ payload, fg, width = 140, height = 24 }) => {
  const bars = useMemo(() => buildCode128Bars(payload), [payload]);
  const totalUnits = useMemo(() => bars.reduce((a, b) => a + b, 0), [bars]);
  let cursor = 0;
  return (
    <svg
      viewBox={`0 0 ${totalUnits} 100`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className="block"
    >
      {bars.map((w, idx) => {
        const x = cursor;
        cursor += w;
        if (idx % 2 !== 0) return null;
        return <rect key={idx} x={x} y={0} width={w} height={100} fill={fg} />;
      })}
    </svg>
  );
};

export const QrLabelStudioModal: React.FC = () => {
  const {
    scene,
    theme,
    selectEntity,
    setActiveFloor,
    setViewMode,
    flyToCamera,
    showToast,
  } = useTwinStore();
  const {
    showQrLabelModal,
    qrLabelTab,
    preselectedLabelIds,
    closeQrLabelModal,
    openQrLabelModal,
    complianceByAssetId,
    sops,
    openGmpModal,
    createWorkOrder,
    personnel,
  } = useGmpStore();
  const { sensors, readings } = useTelemetryStore();

  const isDark = theme === 'dark';

  // Camera Scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectorSupported, setDetectorSupported] = useState<boolean>(true);
  const [manualCode, setManualCode] = useState('');
  const [scannedRaw, setScannedRaw] = useState<string | null>(null);
  const [matchedItem, setMatchedItem] = useState<LabelItem | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRafRef = useRef<number | null>(null);

  // Label Designer state
  const [kindFilter, setKindFilter] = useState<'all' | LabelEntityKind>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [companyName, setCompanyName] = useState('CinnaGen Biopharma · Gradian GMP');
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [symbology, setSymbology] = useState<LabelSymbology>('qr+barcode');
  const [finish, setFinish] = useState<LabelFinish>('brushed-iron');
  const [cornerStyle, setCornerStyle] = useState<CornerStyle>('rounded-2xl');
  const [showComplianceDates, setShowComplianceDates] = useState(true);
  const [showMountingHoles, setShowMountingHoles] = useState(true);

  const allLabelItems = useMemo<LabelItem[]>(() => {
    const items: LabelItem[] = [];

    scene.assets.forEach((a) => {
      const fl = scene.floors.find((f) => f.id === a.floorId);
      const rm = scene.rooms.find((r) => r.id === a.roomId);
      const comp = complianceByAssetId[a.id];
      const worstStatus =
        comp?.calibration.status === 'overdue' ||
        comp?.qualification.status === 'overdue' ||
        comp?.maintenance.status === 'overdue'
          ? 'overdue'
          : comp?.calibration.status === 'due-soon' ||
              comp?.qualification.status === 'due-soon' ||
              comp?.maintenance.status === 'due-soon'
            ? 'due-soon'
            : 'valid';

      items.push({
        key: `eq:${a.id}`,
        id: a.id,
        kind: 'equipment',
        code: a.assetId || a.equipmentId,
        name: a.name,
        subtitle: `${a.manufacturer} ${a.model} · ${a.category}`,
        locationLabel: `${fl?.code ?? 'FL'} · ${rm?.code ?? 'Suite'}`,
        qrPayload: `GRADIAN://EQ/${a.assetId}/${a.id}`,
        sizeMm: { w: 100, h: 60, desc: '100 × 60 mm Equipment Plaque' },
        calDue: comp?.calibration.nextDueDate,
        qualDue: comp?.qualification.nextDueDate,
        pmDue: comp?.maintenance.nextDueDate,
        status: worstStatus,
        assetRef: a,
      });
    });

    scene.rooms.forEach((r) => {
      const fl = scene.floors.find((f) => f.id === r.floorId);
      items.push({
        key: `rm:${r.id}`,
        id: r.id,
        kind: 'room',
        code: r.code,
        name: r.name,
        subtitle: `${r.environmental.cleanroomGrade} · ${r.environmental.pressurePa >= 0 ? '+' : ''}${r.environmental.pressurePa} Pa`,
        locationLabel: `${fl?.code ?? 'FL'} · ${r.width.toFixed(0)}×${r.depth.toFixed(0)}m`,
        qrPayload: `GRADIAN://ROOM/${r.code}/${r.id}`,
        sizeMm: { w: 220, h: 140, desc: '220 × 140 mm Iron / Steel Door Sign' },
        status: r.complianceStatus,
        cleanroomGrade: r.environmental.cleanroomGrade,
        pressurePa: r.environmental.pressurePa,
        roomRef: r,
      });
    });

    sensors.forEach((s) => {
      const fl = scene.floors.find((f) => f.id === s.floorId);
      items.push({
        key: `sn:${s.id}`,
        id: s.id,
        kind: 'sensor',
        code: s.tag,
        name: s.name,
        subtitle: `${s.metric.toUpperCase()} (${s.unit}) · ${s.protocol}`,
        locationLabel: `${fl?.code ?? 'FL'} · ${s.targetCode}`,
        qrPayload: `GRADIAN://TAG/${s.tag}/${s.id}`,
        sizeMm: { w: 35, h: 18, desc: '35 × 18 mm Micro Sensor Tag' },
        calDue: s.calibrationDue,
        unit: s.unit,
        sensorRef: s,
      });
    });

    return items;
  }, [scene, complianceByAssetId, sensors]);

  // Sync preselected IDs when modal opens
  useEffect(() => {
    if (!showQrLabelModal) return;
    if (preselectedLabelIds.length > 0) {
      const resolvedKeys = preselectedLabelIds
        .map((rawId) => {
          const hit = allLabelItems.find((i) => i.id === rawId || i.key === rawId || i.code === rawId);
          return hit?.key;
        })
        .filter((k): k is string => Boolean(k));
      if (resolvedKeys.length > 0) {
        setSelectedKeys(resolvedKeys);
        return;
      }
    }
    if (selectedKeys.length === 0 && allLabelItems.length > 0) {
      // Pre-select 1 equipment, 1 room, 1 sensor so user sees all 3 label formats immediately!
      const defaults: string[] = [];
      const eq = allLabelItems.find((i) => i.kind === 'equipment');
      const rm = allLabelItems.find((i) => i.kind === 'room');
      const sn = allLabelItems.find((i) => i.kind === 'sensor');
      if (eq) defaults.push(eq.key);
      if (rm) defaults.push(rm.key);
      if (sn) defaults.push(sn.key);
      setSelectedKeys(defaults);
    }
  }, [showQrLabelModal, preselectedLabelIds, allLabelItems]);

  // Resolve scanned string to an item
  const resolveCodeToItem = (raw: string): LabelItem | null => {
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    return (
      allLabelItems.find(
        (item) =>
          item.qrPayload.toLowerCase() === q ||
          item.code.toLowerCase() === q ||
          item.id.toLowerCase() === q ||
          q.includes(item.code.toLowerCase()) ||
          item.name.toLowerCase().includes(q)
      ) ?? null
    );
  };

  const handleScanMatch = (rawValue: string) => {
    setScannedRaw(rawValue);
    const hit = resolveCodeToItem(rawValue);
    setMatchedItem(hit);
    if (hit) {
      showToast(`Identified ${hit.kind.toUpperCase()}: ${hit.code} · ${hit.name}`, 'success');
    } else {
      showToast(`Code "${rawValue}" did not match an asset, room, or sensor tag`, 'info');
    }
  };

  const stopCamera = () => {
    if (scanRafRef.current) {
      cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const startCamera = async (mode: 'environment' | 'user' = facingMode) => {
    stopCamera();
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera API unavailable in this browser context. Use quick scan or manual tag entry below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);

      requestAnimationFrame(async () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        if (!BarcodeDetectorCtor) {
          setDetectorSupported(false);
          return;
        }
        setDetectorSupported(true);
        const detector = new BarcodeDetectorCtor({
          formats: ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13'],
        });

        let lastTick = 0;
        const scanLoop = async (ts: number) => {
          if (!streamRef.current) return;
          if (ts - lastTick > 280 && videoRef.current && videoRef.current.readyState >= 2) {
            lastTick = ts;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes.length > 0 && codes[0].rawValue) {
                handleScanMatch(codes[0].rawValue);
                stopCamera();
                return;
              }
            } catch {
              // ignore transient frame error
            }
          }
          scanRafRef.current = requestAnimationFrame(scanLoop);
        };
        scanRafRef.current = requestAnimationFrame(scanLoop);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera permission denied';
      setCameraError(`Unable to open camera (${msg}). You can still enter or pick a QR/Barcode tag below.`);
      setCameraActive(false);
    }
  };

  useEffect(() => {
    if (!showQrLabelModal || qrLabelTab !== 'scanner') {
      stopCamera();
    }
    return () => stopCamera();
  }, [showQrLabelModal, qrLabelTab]);

  const handleGoTo3D = (item: LabelItem) => {
    if (item.assetRef) {
      const a = item.assetRef;
      setActiveFloor(a.floorId);
      selectEntity({ type: 'asset', id: a.id });
      setViewMode('3d-perspective');
      const fl = scene.floors.find((f) => f.id === a.floorId);
      const elev = fl?.elevation ?? 0;
      flyToCamera([a.x + 4.2, elev + 3.4, a.z + 4.2], [a.x, elev + a.height * 0.5, a.z]);
    } else if (item.roomRef) {
      const r = item.roomRef;
      setActiveFloor(r.floorId);
      selectEntity({ type: 'room', id: r.id });
      setViewMode('3d-perspective');
      const fl = scene.floors.find((f) => f.id === r.floorId);
      const elev = fl?.elevation ?? 0;
      const cx = r.x + r.width / 2;
      const cz = r.z + r.depth / 2;
      flyToCamera([cx + 7, elev + 7.5, cz + 7], [cx, elev + 0.5, cz]);
    } else if (item.sensorRef) {
      const s = item.sensorRef;
      setActiveFloor(s.floorId);
      if (s.targetKind === 'asset') selectEntity({ type: 'asset', id: s.targetId });
      else selectEntity({ type: 'room', id: s.targetId });
      setViewMode('3d-perspective');
      const fl = scene.floors.find((f) => f.id === s.floorId);
      const elev = fl?.elevation ?? 0;
      flyToCamera([s.x + 3.8, elev + 3.0, s.z + 3.8], [s.x, elev + 1.2, s.z]);
    }
    closeQrLabelModal();
  };

  // Matching SOPs for scanned equipment/item
  const matchingSops = useMemo(() => {
    if (!matchedItem) return [];
    if (matchedItem.assetRef) {
      const a = matchedItem.assetRef;
      return sops.filter(
        (d) =>
          d.equipmentCategory === 'All Equipment' ||
          d.equipmentCategory === a.category ||
          (d.archetypes && d.archetypes.includes(a.archetype))
      );
    }
    if (matchedItem.roomRef) {
      return sops.filter(
        (d) => d.equipmentCategory === 'HVAC & Utilities' || d.equipmentCategory === 'All Equipment'
      );
    }
    return sops.filter((d) => d.equipmentCategory === 'All Equipment' || d.actionType === 'Calibration');
  }, [matchedItem, sops]);

  const filteredItems = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return allLabelItems.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q)
      );
    });
  }, [allLabelItems, kindFilter, searchText]);

  const selectedLabelItems = useMemo(
    () => allLabelItems.filter((i) => selectedKeys.includes(i.key)),
    [allLabelItems, selectedKeys]
  );

  const toggleSelectKey = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCompanyLogo(reader.result);
        showToast('Company logo loaded into label templates', 'success');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadSvgSheet = () => {
    if (selectedLabelItems.length === 0) return;
    const cols = 2;
    const cellW = 460;
    const cellH = 260;
    const rows = Math.ceil(selectedLabelItems.length / cols);
    const totalW = cols * cellW + 40;
    const totalH = rows * cellH + 60;

    const bgHex =
      finish === 'cleanroom-white'
        ? '#F8FAFC'
        : finish === 'brushed-iron'
          ? '#CBD5E1'
          : finish === 'violet-amber'
            ? '#161326'
            : '#14141A';
    const fgHex = finish === 'cleanroom-white' || finish === 'brushed-iron' ? '#0F172A' : '#F4F4F5';
    const accentHex = finish === 'violet-amber' ? '#F59E0B' : '#7C3AED';

    const escapeXml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const blocks = selectedLabelItems.map((item, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const ox = 20 + col * cellW;
      const oy = 40 + row * cellH;
      const w = item.kind === 'room' ? 430 : item.kind === 'equipment' ? 380 : 250;
      const h = item.kind === 'room' ? 230 : item.kind === 'equipment' ? 200 : 120;
      const rx = cornerStyle === 'rounded-2xl' ? 22 : cornerStyle === 'rounded-xl' ? 12 : 0;

      const codeSvg =
        item.kind === 'sensor' || symbology === 'datamatrix'
          ? renderDataMatrixSvgString(item.qrPayload, '#111116', '#FFFFFF', item.kind === 'sensor' ? 68 : 96)
          : renderQrSvgString(item.qrPayload, '#111116', '#FFFFFF', item.kind === 'room' ? 108 : 96);

      const barSvg =
        symbology === 'qr+barcode' || symbology === 'barcode-only'
          ? renderBarcodeSvgString(item.code, fgHex, 'transparent', 180, 26)
          : '';

      const holes =
        showMountingHoles && item.kind === 'room'
          ? `<circle cx="18" cy="18" r="5" fill="#475569" stroke="#1E293B" stroke-width="2" />
             <circle cx="${w - 18}" cy="18" r="5" fill="#475569" stroke="#1E293B" stroke-width="2" />
             <circle cx="18" cy="${h - 18}" r="5" fill="#475569" stroke="#1E293B" stroke-width="2" />
             <circle cx="${w - 18}" cy="${h - 18}" r="5" fill="#475569" stroke="#1E293B" stroke-width="2" />`
          : '';

      return `<g transform="translate(${ox}, ${oy})">
        <rect x="0" y="0" width="${w}" height="${h}" rx="${rx}" fill="${bgHex}" stroke="${accentHex}" stroke-width="2.5" />
        ${holes}
        <text x="26" y="34" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="700" fill="${accentHex}">${escapeXml(companyName.toUpperCase())}</text>
        <text x="26" y="64" font-family="Inter, Arial, sans-serif" font-size="${item.kind === 'sensor' ? 16 : 22}" font-weight="800" fill="${fgHex}">${escapeXml(item.code)}</text>
        <text x="26" y="86" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="600" fill="${fgHex}">${escapeXml(item.name.slice(0, 34))}</text>
        <text x="26" y="106" font-family="Inter, Arial, sans-serif" font-size="10.5" fill="${fgHex}" opacity="0.78">${escapeXml(item.subtitle.slice(0, 42))}</text>
        <text x="26" y="${h - 20}" font-family="monospace" font-size="9.5" fill="${fgHex}" opacity="0.7">${escapeXml(item.sizeMm.desc)}</text>
        <g transform="translate(${w - (item.kind === 'sensor' ? 84 : 124)}, ${item.kind === 'sensor' ? 26 : 34})">${codeSvg}</g>
        ${barSvg && item.kind !== 'sensor' ? `<g transform="translate(26, ${h - 62})">${barSvg}</g>` : ''}
      </g>`;
    });

    const svgDoc = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
  <rect width="100%" height="100%" fill="#FFFFFF" />
  <text x="20" y="24" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="700" fill="#1E293B">Gradian Industrial Label Sheet (${selectedLabelItems.length} labels)</text>
  ${blocks.join('\n')}
</svg>`;

    const blob = new Blob([svgDoc], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gradian-industrial-labels-${selectedLabelItems.length}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${selectedLabelItems.length} print-ready vector labels (.svg)`, 'success');
  };

  const getCardStyleClasses = (kind: LabelEntityKind) => {
    if (finish === 'brushed-iron') {
      return {
        wrapper:
          'bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 text-slate-950 border-slate-500/80 shadow-inner',
        accentText: 'text-slate-700',
        mutedText: 'text-slate-700/85',
        badge: 'bg-slate-900 text-amber-300',
        qrFg: '#0F172A',
        qrBg: '#FFFFFF',
      };
    }
    if (finish === 'cleanroom-white') {
      return {
        wrapper: 'bg-white text-slate-900 border-slate-300 shadow-sm',
        accentText: 'text-violet-700',
        mutedText: 'text-slate-500',
        badge: 'bg-violet-600 text-white',
        qrFg: '#0F172A',
        qrBg: '#F8FAFC',
      };
    }
    if (finish === 'violet-amber') {
      return {
        wrapper:
          'bg-gradient-to-br from-[#17122B] via-[#12121A] to-[#1D1510] text-zinc-100 border-violet-500/70 shadow-lg',
        accentText: 'text-amber-400',
        mutedText: 'text-zinc-300/80',
        badge: 'bg-amber-500 text-zinc-950',
        qrFg: '#111116',
        qrBg: '#FFFFFF',
      };
    }
    return {
      wrapper:
        kind === 'room'
          ? 'bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950 text-zinc-100 border-zinc-600'
          : 'bg-[#14141B] text-zinc-100 border-zinc-700',
      accentText: 'text-violet-400',
      mutedText: 'text-zinc-400',
      badge: 'bg-violet-600 text-white',
      qrFg: '#111116',
      qrBg: '#FFFFFF',
    };
  };

  if (!showQrLabelModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4">
      <div
        className={`w-full max-w-6xl h-[90vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden ${
          isDark
            ? 'bg-[#111116] border-zinc-800 text-zinc-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Top Bar with explicit Back Button */}
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b ${
            isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={closeQrLabelModal}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                isDark
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-amber-500 flex items-center justify-center text-white shadow-md">
              <QrCode className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold leading-tight">
                QR / Barcode / DataMatrix Scanner & Industrial Label Designer
              </h2>
              <p className={`text-[11px] ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                Scan tags straight into 3D + SOPs · Design metal room signs, equipment plaques & micro sensor labels
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => openQrLabelModal('scanner')}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                qrLabelTab === 'scanner'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-600/25'
                  : isDark
                    ? 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span>Camera Scanner</span>
            </button>
            <button
              type="button"
              onClick={() => openQrLabelModal('designer')}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                qrLabelTab === 'designer'
                  ? 'bg-amber-500 text-zinc-950 shadow-md shadow-amber-500/25'
                  : isDark
                    ? 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Label Designer ({selectedKeys.length})</span>
            </button>
            <button
              type="button"
              onClick={closeQrLabelModal}
              aria-label="Close"
              className={`p-1.5 rounded-xl transition cursor-pointer ${
                isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* BODY */}
        {qrLabelTab === 'scanner' ? (
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left: Camera Viewfinder + Manual Scan */}
            <div className="lg:col-span-6 flex flex-col gap-3">
              <div
                className={`relative rounded-2xl overflow-hidden border aspect-video flex flex-col items-center justify-center ${
                  isDark ? 'bg-[#09090D] border-zinc-800' : 'bg-slate-950 border-slate-300'
                }`}
              >
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
                />
                {!cameraActive && (
                  <div className="text-center p-6 max-w-sm">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center mb-3">
                      <Camera className="w-7 h-7 text-violet-400" />
                    </div>
                    <h3 className="text-sm font-bold text-white">
                      Multi-Format Live Optical Scanner
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Detects <strong>QR Code</strong>, <strong>DataMatrix ECC200</strong>,{' '}
                      <strong>Code 128</strong>, <strong>Code 39</strong>, and <strong>EAN-13</strong>{' '}
                      industrial tags via device camera.
                    </p>
                    <button
                      type="button"
                      onClick={() => startCamera('environment')}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 px-4 py-2 text-xs font-bold text-white shadow-lg hover:brightness-110 transition cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Start Camera Scanner</span>
                    </button>
                  </div>
                )}

                {cameraActive && (
                  <>
                    {/* Aiming reticle overlay */}
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="w-52 h-52 rounded-2xl border-2 border-violet-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] relative overflow-hidden">
                        <div className="absolute inset-x-0 top-1/2 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-pulse" />
                      </div>
                    </div>
                    <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
                      <span className="rounded-lg bg-black/75 px-2.5 py-1 text-[10px] font-semibold text-violet-300 border border-violet-500/30">
                        {detectorSupported
                          ? 'Scanning QR / DataMatrix / Barcode…'
                          : 'Live camera active (manual fallback ready)'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const next = facingMode === 'environment' ? 'user' : 'environment';
                            setFacingMode(next);
                            startCamera(next);
                          }}
                          className="rounded-xl bg-black/80 px-2.5 py-1.5 text-[11px] font-semibold text-white border border-zinc-700 hover:bg-zinc-800 cursor-pointer flex items-center gap-1"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Flip
                        </button>
                        <button
                          type="button"
                          onClick={stopCamera}
                          className="rounded-xl bg-rose-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-500 cursor-pointer flex items-center gap-1"
                        >
                          <CameraOff className="w-3.5 h-3.5" />
                          Stop
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {cameraError && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-300">
                  {cameraError}
                </div>
              )}

              {/* Manual / Hardware USB-HID Barcode Wedge Input */}
              <div
                className={`rounded-2xl border p-3.5 ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="text-[11px] font-bold uppercase tracking-wider text-violet-400 mb-2">
                  Handheld Scanner / Manual Code Entry
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleScanMatch(manualCode);
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="Scan or type tag e.g. BR-2001, LYO-401, A0-101, TT-BR2001-01..."
                    className={`flex-1 rounded-xl border px-3 py-2 text-xs outline-none ${
                      isDark
                        ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100 focus:border-violet-500'
                        : 'bg-white border-slate-300 text-slate-900 focus:border-violet-500'
                    }`}
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 text-xs font-bold transition cursor-pointer"
                  >
                    Lookup
                  </button>
                </form>

                {/* Instant Test-Scan Chips */}
                <div className="mt-3">
                  <div className={`text-[10px] font-semibold mb-1.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                    Instant Simulate Scan (Equipment · Rooms · Sensors):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allLabelItems.slice(0, 8).map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setManualCode(item.code);
                          handleScanMatch(item.qrPayload);
                        }}
                        className={`rounded-lg px-2 py-1 text-[10px] font-mono font-semibold border transition cursor-pointer ${
                          isDark
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-violet-500 hover:text-violet-300'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-violet-500'
                        }`}
                      >
                        {item.code}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Scan Result + Compliance + Direct SOPs + Go To 3D */}
            <div className="lg:col-span-6 flex flex-col gap-3">
              {matchedItem ? (
                <div
                  className={`rounded-2xl border p-4 flex flex-col gap-3.5 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-lg bg-violet-600/20 text-violet-300 border border-violet-500/40 px-2 py-0.5 text-[10px] font-bold uppercase">
                          {matchedItem.kind}
                        </span>
                        <span className="font-mono text-xs font-bold text-amber-400">
                          {matchedItem.code}
                        </span>
                        {matchedItem.status && (
                          <span
                            className={`rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase ${
                              matchedItem.status === 'overdue' || matchedItem.status === 'deviation'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : matchedItem.status === 'due-soon' || matchedItem.status === 'review-due'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            }`}
                          >
                            {matchedItem.status}
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-bold mt-1">{matchedItem.name}</h3>
                      <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-slate-600'}`}>
                        {matchedItem.subtitle} · {matchedItem.locationLabel}
                      </p>
                    </div>
                    <QrSvgInline payload={matchedItem.qrPayload} fg="#111116" bg="#FFFFFF" size={64} />
                  </div>

                  {/* Calibration / Qualification / Maintenance Dates if Equipment */}
                  {matchedItem.assetRef && (
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        {
                          label: 'Calibration Due',
                          val: matchedItem.calDue ?? '—',
                          st: complianceByAssetId[matchedItem.id]?.calibration.status ?? 'valid',
                        },
                        {
                          label: 'Qualification Due',
                          val: matchedItem.qualDue ?? '—',
                          st: complianceByAssetId[matchedItem.id]?.qualification.status ?? 'valid',
                        },
                        {
                          label: 'Next PM Due',
                          val: matchedItem.pmDue ?? '—',
                          st: complianceByAssetId[matchedItem.id]?.maintenance.status ?? 'valid',
                        },
                      ].map((box) => (
                        <div
                          key={box.label}
                          className={`rounded-xl p-2.5 border ${
                            box.st === 'overdue'
                              ? 'bg-rose-500/10 border-rose-500/40'
                              : box.st === 'due-soon'
                                ? 'bg-amber-500/10 border-amber-500/40'
                                : isDark
                                  ? 'bg-[#101016] border-zinc-800'
                                  : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className={`text-[10px] ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                            {box.label}
                          </div>
                          <div className="font-mono text-xs font-bold mt-0.5">{box.val}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Sensor Live Reading if Sensor */}
                  {matchedItem.sensorRef && (
                    <div
                      className={`rounded-xl p-3 border flex items-center justify-between ${
                        isDark ? 'bg-[#101016] border-zinc-800' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                          Live Telemetry Reading
                        </div>
                        <div className="text-lg font-mono font-bold text-violet-400">
                          {readings[matchedItem.id]?.value?.toFixed(2) ??
                            matchedItem.sensorRef.nominal}{' '}
                          {matchedItem.sensorRef.unit}
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-zinc-400">
                        <div>PLC: {matchedItem.sensorRef.plcAddress}</div>
                        <div>Cal Due: {matchedItem.sensorRef.calibrationDue}</div>
                      </div>
                    </div>
                  )}

                  {/* Primary Action Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleGoTo3D(matchedItem)}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-3 py-2 text-xs font-bold shadow-md hover:brightness-110 transition cursor-pointer"
                    >
                      <Compass className="w-3.5 h-3.5" />
                      <span>Fly to 3D</span>
                    </button>
                    {matchedItem.assetRef && (
                      <button
                        type="button"
                        onClick={() => {
                          closeQrLabelModal();
                          openGmpModal({ tab: 'compliance', assetId: matchedItem.id });
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white px-3 py-2 text-xs font-bold transition cursor-pointer"
                      >
                        <FileCheck2 className="w-3.5 h-3.5" />
                        <span>Lifecycle Audit</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedKeys([matchedItem.key]);
                        openQrLabelModal('designer', [matchedItem.key]);
                      }}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 px-3 py-2 text-xs font-bold transition cursor-pointer"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      <span>Design Label</span>
                    </button>
                    {matchedItem.assetRef && (
                      <button
                        type="button"
                        onClick={() => {
                          const a = matchedItem.assetRef!;
                          const tech = personnel[0];
                          createWorkOrder({
                            title: `Field Scan Inspection — ${a.assetId}`,
                            description: `Created directly from QR/Barcode scan of ${a.name} (${a.assetId}).`,
                            serviceType: 'inspection',
                            targetKind: 'asset',
                            targetId: a.id,
                            targetName: `${a.name} (${a.assetId})`,
                            targetCategory: a.category,
                            assigneeId: tech?.id ?? 'tech-tavakoli',
                            assigneeName: tech?.name ?? 'Reza Tavakoli',
                            priority: 'medium',
                            status: 'open',
                            lastServiceDate: new Date().toISOString().slice(0, 10),
                            dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
                            estimatedHours: 1.5,
                            sopId: matchingSops[0]?.id,
                            checklist: [
                              { id: 's1', text: 'Verify physical equipment status & calibration sticker', done: false },
                              { id: 's2', text: 'Record scan inspection notes in audit trail', done: false },
                            ],
                          });
                          showToast(`Work Order created for ${a.assetId}`, 'success');
                        }}
                        className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold border transition cursor-pointer ${
                          isDark
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-violet-500'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-violet-500'
                        }`}
                      >
                        <Wrench className="w-3.5 h-3.5 text-amber-400" />
                        <span>New Work Order</span>
                      </button>
                    )}
                  </div>

                  {/* Direct SOPs & Records on Scan */}
                  <div
                    className={`rounded-xl border p-3 ${
                      isDark ? 'bg-[#101016] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold flex items-center gap-1.5 text-violet-400">
                        <BookOpen className="w-3.5 h-3.5" />
                        SOPs & GMP Records for This {matchedItem.kind} ({matchingSops.length})
                      </span>
                    </div>
                    <div className="space-y-1.5 max-h-44 overflow-y-auto">
                      {matchingSops.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => {
                            closeQrLabelModal();
                            openGmpModal({ tab: 'sops', sopId: doc.id });
                          }}
                          className={`w-full text-left rounded-xl px-3 py-2 border flex items-center justify-between gap-2 transition cursor-pointer ${
                            isDark
                              ? 'bg-[#17171F] border-zinc-800 hover:border-violet-500/60'
                              : 'bg-slate-50 border-slate-200 hover:border-violet-400'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] font-bold text-amber-400">
                                {doc.docNumber}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-semibold">
                                {doc.actionType}
                              </span>
                            </div>
                            <div className="text-xs font-semibold truncate mt-0.5">{doc.title}</div>
                          </div>
                          <span className="text-[10px] font-bold text-violet-400 shrink-0">
                            Open MD →
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className={`flex-1 rounded-2xl border border-dashed p-8 flex flex-col items-center justify-center text-center ${
                    isDark ? 'border-zinc-800 bg-[#14141B]/60' : 'border-slate-300 bg-slate-50'
                  }`}
                >
                  <ScanLine className="w-10 h-10 text-violet-400/70 mb-3" />
                  <h3 className="text-sm font-bold">Ready for Scan</h3>
                  <p className={`text-xs max-w-xs mt-1 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                    Point the camera at any QR, DataMatrix, or Code128 industrial label — or click a quick-test tag — to jump straight into 3D, check Calibration/PQ dates, and open linked SOPs.
                  </p>
                  {scannedRaw && (
                    <div className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-1.5 text-[11px] text-rose-300 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>No match for: {scannedRaw}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* LABEL DESIGNER TAB */
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            {/* Left Selector Panel */}
            <div
              className={`lg:col-span-4 border-r flex flex-col overflow-hidden ${
                isDark ? 'border-zinc-800 bg-[#14141A]' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="p-3 border-b border-zinc-800/60 space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Filter equipment, rooms, sensors..."
                    className={`w-full rounded-xl border pl-8 pr-3 py-1.5 text-xs outline-none ${
                      isDark
                        ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100 focus:border-violet-500'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
                <div className="flex items-center gap-1">
                  {(['all', 'equipment', 'room', 'sensor'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKindFilter(k)}
                      className={`flex-1 rounded-lg py-1 text-[10px] font-bold uppercase transition cursor-pointer ${
                        kindFilter === k
                          ? 'bg-violet-600 text-white'
                          : isDark
                            ? 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                            : 'bg-white text-slate-600 border border-slate-200'
                      }`}
                    >
                      {k === 'all' ? 'All' : k === 'equipment' ? 'Equip' : k === 'room' ? 'Rooms' : 'Sensors'}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className={isDark ? 'text-zinc-400' : 'text-slate-500'}>
                    {selectedKeys.length} selected for batch print
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedKeys(filteredItems.slice(0, 12).map((i) => i.key))}
                      className="text-violet-400 hover:underline font-semibold cursor-pointer"
                    >
                      Select Visible
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedKeys([])}
                      className="text-zinc-400 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredItems.map((item) => {
                  const checked = selectedKeys.includes(item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => toggleSelectKey(item.key)}
                      className={`w-full text-left rounded-xl p-2 border flex items-center gap-2.5 transition cursor-pointer ${
                        checked
                          ? 'bg-violet-600/15 border-violet-500/60'
                          : isDark
                            ? 'bg-[#17171F] border-zinc-800/80 hover:border-zinc-700'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-md flex items-center justify-center border shrink-0 ${
                          checked
                            ? 'bg-violet-600 border-violet-500 text-white'
                            : isDark
                              ? 'border-zinc-600'
                              : 'border-slate-300'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[11px] font-bold truncate">{item.code}</span>
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                              item.kind === 'room'
                                ? 'bg-amber-500/20 text-amber-300'
                                : item.kind === 'sensor'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-violet-500/20 text-violet-300'
                            }`}
                          >
                            {item.sizeMm.w}×{item.sizeMm.h}mm
                          </span>
                        </div>
                        <div className="text-[11px] truncate opacity-85">{item.name}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: Customization Controls + Live Industrial Label Preview Sheet */}
            <div className="lg:col-span-8 flex flex-col overflow-hidden">
              {/* Customization Bar */}
              <div
                className={`p-3 border-b grid grid-cols-2 md:grid-cols-4 gap-2.5 ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 block mb-1">
                    Company Header
                  </label>
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className={`w-full rounded-lg border px-2 py-1 text-[11px] outline-none ${
                      isDark ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100' : 'bg-white border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 block mb-1">
                    Substrate Finish
                  </label>
                  <select
                    value={finish}
                    onChange={(e) => setFinish(e.target.value as LabelFinish)}
                    className={`w-full rounded-lg border px-2 py-1 text-[11px] outline-none cursor-pointer ${
                      isDark ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100' : 'bg-white border-slate-300'
                    }`}
                  >
                    <option value="brushed-iron">Brushed Iron / Stainless Steel</option>
                    <option value="charcoal-anodized">Anodized Charcoal Metal</option>
                    <option value="violet-amber">Violet & Amber Branded</option>
                    <option value="cleanroom-white">Cleanroom Matte White</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 block mb-1">
                    Symbology
                  </label>
                  <select
                    value={symbology}
                    onChange={(e) => setSymbology(e.target.value as LabelSymbology)}
                    className={`w-full rounded-lg border px-2 py-1 text-[11px] outline-none cursor-pointer ${
                      isDark ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100' : 'bg-white border-slate-300'
                    }`}
                  >
                    <option value="qr+barcode">QR Code + Code128 Barcode</option>
                    <option value="qr-only">QR Code Only</option>
                    <option value="datamatrix">DataMatrix ECC200 (2D)</option>
                    <option value="barcode-only">Code128 Barcode Only</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 block mb-1">
                    Company Logo & Corners
                  </label>
                  <div className="flex items-center gap-1.5">
                    <label
                      className={`flex-1 flex items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold cursor-pointer transition ${
                        isDark
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-violet-500'
                          : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      <Upload className="w-3 h-3 text-amber-400" />
                      <span>{companyLogo ? 'Change' : 'Logo'}</span>
                      <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                    </label>
                    <select
                      value={cornerStyle}
                      onChange={(e) => setCornerStyle(e.target.value as CornerStyle)}
                      className={`rounded-lg border px-1.5 py-1 text-[10px] cursor-pointer ${
                        isDark ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100' : 'bg-white border-slate-300'
                      }`}
                    >
                      <option value="rounded-2xl">Modern Rounded</option>
                      <option value="rounded-xl">Soft Radius</option>
                      <option value="rounded-none">Sharp Cut</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Action Strip */}
              <div
                className={`px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-[11px] ${
                  isDark ? 'bg-[#121218] border-zinc-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showComplianceDates}
                      onChange={(e) => setShowComplianceDates(e.target.checked)}
                      className="accent-violet-500"
                    />
                    <span>Show Cal/PQ Dates</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showMountingHoles}
                      onChange={(e) => setShowMountingHoles(e.target.checked)}
                      className="accent-amber-500"
                    />
                    <span>Iron Sign Grommets</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={selectedLabelItems.length === 0}
                    onClick={handleDownloadSvgSheet}
                    className="flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-1.5 text-xs font-bold transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Vector SVG Sheet</span>
                  </button>
                  <button
                    type="button"
                    disabled={selectedLabelItems.length === 0}
                    onClick={() => {
                      window.print();
                      showToast('Sent selected labels to system print dialog', 'info');
                    }}
                    className="flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 px-3 py-1.5 text-xs font-bold transition cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print Sheet</span>
                  </button>
                </div>
              </div>

              {/* WYSIWYG Print Preview Canvas */}
              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {selectedLabelItems.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-70">
                    <Tag className="w-9 h-9 text-violet-400 mb-2" />
                    <p className="text-sm font-bold">Select Equipment, Rooms, or Sensors on the left</p>
                    <p className="text-xs text-zinc-400 mt-1">
                      Automatic physical sizing: 220×140mm iron room signs, 100×60mm equipment plaques, 35×18mm micro sensor tags.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-4 items-start">
                    {selectedLabelItems.map((item) => {
                      const sty = getCardStyleClasses(item.kind);

                      // ROOM IRON SIGN (220 x 140 mm)
                      if (item.kind === 'room') {
                        return (
                          <div
                            key={item.key}
                            className={`relative w-full max-w-[440px] border-2 p-5 ${cornerStyle} ${sty.wrapper}`}
                          >
                            {showMountingHoles && (
                              <>
                                <span className="absolute top-2.5 left-2.5 w-2.5 h-2.5 rounded-full bg-zinc-700 border border-zinc-900 shadow-inner" />
                                <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-zinc-700 border border-zinc-900 shadow-inner" />
                                <span className="absolute bottom-2.5 left-2.5 w-2.5 h-2.5 rounded-full bg-zinc-700 border border-zinc-900 shadow-inner" />
                                <span className="absolute bottom-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-zinc-700 border border-zinc-900 shadow-inner" />
                              </>
                            )}
                            <div className="flex items-center justify-between gap-2 pl-2 pr-2 pb-2 border-b border-current/15">
                              <div className="flex items-center gap-2 min-w-0">
                                {companyLogo ? (
                                  <img
                                    src={companyLogo}
                                    alt="Logo"
                                    className="w-6 h-6 rounded-md object-contain bg-white p-0.5"
                                  />
                                ) : (
                                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-600 to-amber-500 flex items-center justify-center text-[10px] font-black text-white">
                                    G
                                  </div>
                                )}
                                <span className={`text-[10px] font-extrabold uppercase tracking-widest truncate ${sty.accentText}`}>
                                  {companyName}
                                </span>
                              </div>
                              <span className={`text-[9px] px-2 py-0.5 rounded-md font-bold ${sty.badge}`}>
                                220×140mm IRON SIGN
                              </span>
                            </div>

                            <div className="mt-3 px-2 flex items-center justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="font-mono text-2xl font-black tracking-tight leading-none">
                                  {item.code}
                                </div>
                                <div className="text-sm font-bold mt-1 leading-snug">{item.name}</div>
                                <div className={`text-[11px] font-semibold mt-1.5 ${sty.accentText}`}>
                                  {item.cleanroomGrade}
                                </div>
                                <div className={`text-[10px] mt-0.5 ${sty.mutedText}`}>
                                  Differential Pressure: {item.pressurePa !== undefined && item.pressurePa >= 0 ? '+' : ''}
                                  {item.pressurePa} Pa · {item.locationLabel}
                                </div>
                                {(symbology === 'qr+barcode' || symbology === 'barcode-only') && (
                                  <div className="mt-2.5">
                                    <BarcodeInline
                                      payload={item.code}
                                      fg={finish === 'brushed-iron' || finish === 'cleanroom-white' ? '#0F172A' : '#F4F4F5'}
                                      width={165}
                                      height={22}
                                    />
                                  </div>
                                )}
                              </div>
                              {symbology !== 'barcode-only' && (
                                <div className="p-1.5 rounded-xl bg-white shadow-sm shrink-0">
                                  {symbology === 'datamatrix' ? (
                                    <DataMatrixInline payload={item.qrPayload} fg={sty.qrFg} bg={sty.qrBg} size={84} />
                                  ) : (
                                    <QrSvgInline payload={item.qrPayload} fg={sty.qrFg} bg={sty.qrBg} size={88} />
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }

                      // MICRO SENSOR TAG (35 x 18 mm)
                      if (item.kind === 'sensor') {
                        return (
                          <div
                            key={item.key}
                            className={`w-[238px] border-2 px-2.5 py-2 flex items-center justify-between gap-2 ${cornerStyle} ${sty.wrapper}`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1">
                                <span className={`text-[8px] font-black uppercase tracking-wider truncate ${sty.accentText}`}>
                                  35×18mm SENSOR TAG
                                </span>
                              </div>
                              <div className="font-mono text-xs font-black truncate mt-0.5">
                                {item.code}
                              </div>
                              <div className={`text-[9px] truncate ${sty.mutedText}`}>{item.subtitle}</div>
                              {showComplianceDates && item.calDue && (
                                <div className="font-mono text-[8.5px] font-bold mt-0.5 text-emerald-500">
                                  CAL: {item.calDue}
                                </div>
                              )}
                            </div>
                            <div className="p-1 rounded-lg bg-white shrink-0">
                              {symbology === 'qr-only' || symbology === 'qr+barcode' ? (
                                <QrSvgInline payload={item.qrPayload} fg={sty.qrFg} bg={sty.qrBg} size={46} />
                              ) : (
                                <DataMatrixInline payload={item.qrPayload} fg={sty.qrFg} bg={sty.qrBg} size={44} />
                              )}
                            </div>
                          </div>
                        );
                      }

                      // EQUIPMENT PLAQUE (100 x 60 mm)
                      return (
                        <div
                          key={item.key}
                          className={`w-full max-w-[350px] border-2 p-3.5 ${cornerStyle} ${sty.wrapper}`}
                        >
                          <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-current/15">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {companyLogo ? (
                                <img
                                  src={companyLogo}
                                  alt="Logo"
                                  className="w-5 h-5 rounded object-contain bg-white p-0.5"
                                />
                              ) : (
                                <Sparkles className={`w-3.5 h-3.5 shrink-0 ${sty.accentText}`} />
                              )}
                              <span className={`text-[9px] font-extrabold uppercase tracking-wider truncate ${sty.accentText}`}>
                                {companyName}
                              </span>
                            </div>
                            <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-bold shrink-0 ${sty.badge}`}>
                              100×60mm
                            </span>
                          </div>

                          <div className="mt-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-lg font-black leading-none">{item.code}</div>
                              <div className="text-xs font-bold truncate mt-1">{item.name}</div>
                              <div className={`text-[10px] truncate ${sty.mutedText}`}>
                                {item.locationLabel}
                              </div>
                              {showComplianceDates && (
                                <div className="mt-1.5 grid grid-cols-2 gap-1 font-mono text-[9px]">
                                  <span>CAL: {item.calDue ?? 'N/A'}</span>
                                  <span>PQ: {item.qualDue ?? 'N/A'}</span>
                                </div>
                              )}
                              {(symbology === 'qr+barcode' || symbology === 'barcode-only') && (
                                <div className="mt-2">
                                  <BarcodeInline
                                    payload={item.code}
                                    fg={finish === 'brushed-iron' || finish === 'cleanroom-white' ? '#0F172A' : '#F4F4F5'}
                                    width={150}
                                    height={18}
                                  />
                                </div>
                              )}
                            </div>
                            {symbology !== 'barcode-only' && (
                              <div className="p-1.5 rounded-xl bg-white shadow-sm shrink-0">
                                {symbology === 'datamatrix' ? (
                                  <DataMatrixInline payload={item.qrPayload} fg={sty.qrFg} bg={sty.qrBg} size={68} />
                                ) : (
                                  <QrSvgInline payload={item.qrPayload} fg={sty.qrFg} bg={sty.qrBg} size={72} />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
