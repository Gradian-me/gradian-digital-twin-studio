import React, { useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
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
  Flashlight,
  Map as MapIcon,
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
  Zap,
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
    viewMode,
    highlightScannedEntity,
    recordAudit,
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
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [autoHighlightOnScan, setAutoHighlightOnScan] = useState(true);
  const [highlightTargetView, setHighlightTargetView] = useState<'current' | '3d' | '2d'>('current');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [decoderEngine, setDecoderEngine] = useState<'native+jsqr' | 'jsqr'>('native+jsqr');
  const [manualCode, setManualCode] = useState('');
  const [scannedRaw, setScannedRaw] = useState<string | null>(null);
  const [matchedItem, setMatchedItem] = useState<LabelItem | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRafRef = useRef<number | null>(null);
  const autoHighlightRef = useRef(autoHighlightOnScan);
  const highlightTargetViewRef = useRef(highlightTargetView);
  autoHighlightRef.current = autoHighlightOnScan;
  highlightTargetViewRef.current = highlightTargetView;

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
  const [mobileDesignerStep, setMobileDesignerStep] = useState<'items' | 'style' | 'preview'>('items');

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

  const hasAutoInitSelectionRef = useRef(false);

  // Sync preselected IDs once when modal opens (never override explicit user Clear!)
  useEffect(() => {
    if (!showQrLabelModal) {
      hasAutoInitSelectionRef.current = false;
      return;
    }
    if (preselectedLabelIds.length > 0) {
      const resolvedKeys = preselectedLabelIds
        .map((rawId) => {
          const hit = allLabelItems.find((i) => i.id === rawId || i.key === rawId || i.code === rawId);
          return hit?.key;
        })
        .filter((k): k is string => Boolean(k));
      if (resolvedKeys.length > 0) {
        setSelectedKeys(resolvedKeys);
        hasAutoInitSelectionRef.current = true;
        return;
      }
    }
    if (!hasAutoInitSelectionRef.current && allLabelItems.length > 0) {
      // Pre-select 1 equipment, 1 room, 1 sensor on first open so user sees all 3 label formats immediately
      const defaults: string[] = [];
      const eq = allLabelItems.find((i) => i.kind === 'equipment');
      const rm = allLabelItems.find((i) => i.kind === 'room');
      const sn = allLabelItems.find((i) => i.kind === 'sensor');
      if (eq) defaults.push(eq.key);
      if (rm) defaults.push(rm.key);
      if (sn) defaults.push(sn.key);
      setSelectedKeys(defaults);
      hasAutoInitSelectionRef.current = true;
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

  const highlightItemInViewport = (
    item: LabelItem,
    preferredView: 'current' | '3d' | '2d' = 'current'
  ) => {
    stopCamera();
    if (item.assetRef) {
      highlightScannedEntity({
        entityType: 'asset',
        entityId: item.assetRef.id,
        code: item.code,
        label: item.name,
        preferredView,
      });
    } else if (item.roomRef) {
      highlightScannedEntity({
        entityType: 'room',
        entityId: item.roomRef.id,
        code: item.code,
        label: item.name,
        preferredView,
      });
    } else if (item.sensorRef) {
      const s = item.sensorRef;
      highlightScannedEntity({
        entityType: s.targetKind === 'asset' ? 'asset' : 'room',
        entityId: s.targetId,
        code: item.code,
        label: `${item.name} (${s.targetCode})`,
        preferredView,
      });
    }
    closeQrLabelModal();
  };

  const handleScanMatch = (rawValue: string, fromCamera = false) => {
    setScannedRaw(rawValue);
    const hit = resolveCodeToItem(rawValue);
    setMatchedItem(hit);
    if (hit) {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(45);
        } catch {
          // ignore unsupported vibrate
        }
      }
      recordAudit({
        category: 'asset',
        action: `QR Tag Scanned (${hit.code})`,
        entityType: hit.kind === 'room' ? 'room' : 'asset',
        entityId: hit.id,
        entityName: hit.name,
        summary: `Physical ${hit.kind} tag decoded via ${fromCamera ? 'mobile camera' : 'code lookup'}: ${rawValue}`,
      });
      if (fromCamera && autoHighlightRef.current) {
        highlightItemInViewport(hit, highlightTargetViewRef.current);
      } else {
        showToast(`Identified ${hit.kind.toUpperCase()}: ${hit.code} · ${hit.name}`, 'success');
      }
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
    setTorchOn(false);
    setTorchSupported(false);
    setCameraActive(false);
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
        advanced: [{ torch: next }],
      });
      setTorchOn(next);
    } catch {
      showToast('Flashlight torch is not supported by this camera lens', 'info');
    }
  };

  const photoScanInputRef = useRef<HTMLInputElement | null>(null);

  const decodeQrFromBitmapWithJsQr = (bitmap: ImageBitmap): string | null => {
    const maxDim = 960;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const offscreen = canvasRef.current ?? document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const decoded = jsQR(imgData.data, w, h, { inversionAttempts: 'attemptBoth' });
    return decoded?.data ?? null;
  };

  const handlePhotoScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCameraError(null);

    try {
      const bitmap = await createImageBitmap(file);
      let rawValue: string | null = null;

      // 1. Try native BarcodeDetector first (handles QR + DataMatrix + 1D barcodes)
      const BarcodeDetectorCtor = (
        window as unknown as {
          BarcodeDetector?: new (opts?: { formats?: string[] }) => {
            detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
          };
        }
      ).BarcodeDetector;
      if (BarcodeDetectorCtor) {
        try {
          const detector = new BarcodeDetectorCtor({
            formats: ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13'],
          });
          const codes = await detector.detect(bitmap);
          if (codes.length > 0 && codes[0].rawValue) {
            rawValue = codes[0].rawValue;
          }
        } catch {
          // fall through to jsQR
        }
      }

      // 2. Universal cross-browser jsQR fallback (works on iOS Safari, Firefox, Chrome)
      if (!rawValue) {
        rawValue = decodeQrFromBitmapWithJsQr(bitmap);
      }

      bitmap.close();
      if (rawValue) {
        handleScanMatch(rawValue, true);
      } else {
        setCameraError('No QR code or barcode detected in that photo. Try a sharper close-up or type the code below.');
        showToast('No QR/barcode found in image', 'warning');
      }
    } catch {
      setCameraError('Could not read barcode from photo. Try another image or enter the asset code below.');
    }
  };

  const startCamera = async (mode: 'environment' | 'user' = facingMode) => {
    stopCamera();
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera streaming is unavailable in this browser. Use "Scan from Photo" or enter a code below.');
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (innerErr) {
        const name = innerErr instanceof DOMException ? innerErr.name : '';
        if (name === 'OverconstrainedError' || name === 'NotFoundError') {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else {
          throw innerErr;
        }
      }
      streamRef.current = stream;
      setCameraActive(true);

      // Detect torch capability on rear mobile lenses
      try {
        const track = stream.getVideoTracks()[0];
        const caps = (track as unknown as { getCapabilities?: () => { torch?: boolean } })?.getCapabilities?.();
        setTorchSupported(Boolean(caps?.torch));
      } catch {
        setTorchSupported(false);
      }

      requestAnimationFrame(async () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const BarcodeDetectorCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts?: { formats?: string[] }) => {
              detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
            };
          }
        ).BarcodeDetector;
        const nativeDetector = BarcodeDetectorCtor
          ? new BarcodeDetectorCtor({
              formats: ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13'],
            })
          : null;
        setDecoderEngine(nativeDetector ? 'native+jsqr' : 'jsqr');

        let lastTick = 0;
        const scanLoop = async (ts: number) => {
          if (!streamRef.current) return;
          if (ts - lastTick > 220 && videoRef.current && videoRef.current.readyState >= 2) {
            lastTick = ts;
            let detectedValue: string | null = null;

            // Native multi-format detector (QR, DataMatrix, Code 128)
            if (nativeDetector) {
              try {
                const codes = await nativeDetector.detect(videoRef.current);
                if (codes.length > 0 && codes[0].rawValue) {
                  detectedValue = codes[0].rawValue;
                }
              } catch {
                // ignore transient frame error and fall back to jsQR
              }
            }

            // Cross-browser jsQR frame scan via hidden canvas
            if (!detectedValue && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
              try {
                const vw = videoRef.current.videoWidth;
                const vh = videoRef.current.videoHeight;
                const scale = Math.min(1, 640 / Math.max(vw, vh));
                const cw = Math.max(1, Math.round(vw * scale));
                const ch = Math.max(1, Math.round(vh * scale));
                const canvas = canvasRef.current ?? document.createElement('canvas');
                canvas.width = cw;
                canvas.height = ch;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(videoRef.current, 0, 0, cw, ch);
                  const imageData = ctx.getImageData(0, 0, cw, ch);
                  const qr = jsQR(imageData.data, cw, ch, { inversionAttempts: 'dontInvert' });
                  if (qr?.data) {
                    detectedValue = qr.data;
                  }
                }
              } catch {
                // ignore transient canvas decode error
              }
            }

            if (detectedValue) {
              handleScanMatch(detectedValue, true);
              stopCamera();
              return;
            }
          }
          scanRafRef.current = requestAnimationFrame(scanLoop);
        };
        scanRafRef.current = requestAnimationFrame(scanLoop);
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      const msg =
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Camera permission was blocked by browser/iframe settings.'
          : err instanceof Error
            ? err.message
            : 'Camera access denied';
      setCameraError(`${msg} Use "Scan from Photo" (mobile/desktop camera capture) or enter the tag code below.`);
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
    highlightItemInViewport(item, '3d');
  };

  const handleGoTo2D = (item: LabelItem) => {
    highlightItemInViewport(item, '2d');
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

  const buildLabelSheetSvg = (): string | null => {
    if (selectedLabelItems.length === 0) return null;
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

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="max-width:100%;height:auto;display:block;">
  <rect width="100%" height="100%" fill="#FFFFFF" />
  <text x="20" y="24" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="700" fill="#1E293B">Gradian Industrial Label Sheet (${selectedLabelItems.length} labels)</text>
  ${blocks.join('\n')}
</svg>`;
  };

  const handleDownloadSvgSheet = () => {
    const svgDoc = buildLabelSheetSvg();
    if (!svgDoc) return;
    const blob = new Blob([svgDoc], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gradian-industrial-labels-${selectedLabelItems.length}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${selectedLabelItems.length} print-ready vector labels (.svg)`, 'success');
  };

  const handlePrintLabels = () => {
    const svgDoc = buildLabelSheetSvg();
    if (!svgDoc) return;
    const printHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Gradian Industrial Label Sheet (${selectedLabelItems.length})</title>
  <style>
    @page { size: auto; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body { margin: 0; padding: 0; background: #ffffff; color: #0f172a; font-family: Inter, Arial, sans-serif; }
    .sheet { padding: 8px; }
    svg { width: 100%; height: auto; display: block; }
  </style>
</head>
<body>
  <div class="sheet">${svgDoc}</div>
</body>
</html>`;

    // Use a hidden same-origin iframe so printing works cleanly inside embedded previews without window.open
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    document.body.appendChild(iframe);

    const cleanup = () => {
      window.setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1500);
    };

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc || !iframe.contentWindow) throw new Error('Print frame unavailable');
      doc.open();
      doc.write(printHtml);
      doc.close();

      window.setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          showToast(`Prepared ${selectedLabelItems.length} vector label(s) for printing`, 'success');
        } catch {
          // Fallback: download standalone printable HTML sheet if iframe print is blocked
          const blob = new Blob([printHtml], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `gradian-print-labels-${selectedLabelItems.length}.html`;
          a.click();
          URL.revokeObjectURL(url);
          showToast('Downloaded printable label sheet (.html) — open to print', 'info');
        } finally {
          cleanup();
        }
      }, 180);
    } catch {
      cleanup();
      const blob = new Blob([printHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gradian-print-labels-${selectedLabelItems.length}.html`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Downloaded printable label sheet (.html) — open to print', 'info');
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-0 sm:p-4">
      <div
        className={`w-full max-w-6xl h-[100dvh] sm:h-[92vh] flex flex-col rounded-none sm:rounded-3xl border-0 sm:border shadow-2xl overflow-hidden ${
          isDark
            ? 'bg-[#111116] border-zinc-800 text-zinc-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Single-Row Non-Wrapping Top Bar */}
        <div
          className={`flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b shrink-0 ${
            isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={closeQrLabelModal}
              className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold border transition cursor-pointer whitespace-nowrap shrink-0 ${
                isDark
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-amber-500 flex items-center justify-center text-white shadow-md shrink-0">
              <QrCode className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-bold leading-tight truncate">
                QR Scanner &amp; Industrial Label Designer
              </h2>
              <p className={`hidden sm:block text-[11px] truncate ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                Scan tags straight into 3D + SOPs · Design metal room signs, equipment plaques &amp; micro sensor labels
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeQrLabelModal}
            aria-label="Close"
            className={`p-1.5 rounded-xl transition cursor-pointer shrink-0 ${
              isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Clean Single-Line Mode Switcher Strip */}
        <div
          className={`px-3 sm:px-4 py-2 border-b flex items-center gap-1.5 overflow-x-auto shrink-0 ${
            isDark ? 'bg-[#13131A] border-zinc-800' : 'bg-white border-slate-200'
          }`}
        >
          <button
            type="button"
            onClick={() => openQrLabelModal('scanner')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
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
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
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
        </div>

        {/* BODY */}
        {qrLabelTab === 'scanner' ? (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-3.5 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4">
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
                <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
                {!cameraActive && (
                  <div className="text-center p-4 sm:p-6 max-w-sm">
                    <div className="w-12 h-12 mx-auto rounded-2xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center mb-2.5">
                      <Camera className="w-6 h-6 text-violet-400" />
                    </div>
                    <h3 className="text-sm font-bold text-white">
                      Mobile &amp; Live Camera QR Tag Scanner
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Scan physical equipment QR tags, DataMatrix, or Code 128 plaques to instantly highlight the asset in 3D/2D.
                    </p>
                    <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => startCamera('environment')}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg transition cursor-pointer whitespace-nowrap min-h-[42px]"
                      >
                        <Camera className="w-4 h-4" />
                        <span>Open Mobile Camera</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => photoScanInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3.5 py-2.5 text-xs font-semibold text-zinc-100 transition cursor-pointer whitespace-nowrap min-h-[42px]"
                      >
                        <Upload className="w-3.5 h-3.5 text-amber-400" />
                        <span>Capture Tag Photo</span>
                      </button>
                    </div>
                    <input
                      ref={photoScanInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoScan}
                      className="hidden"
                    />
                  </div>
                )}

                {cameraActive && (
                  <>
                    {/* Aiming reticle overlay */}
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="w-52 h-52 rounded-2xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.48)] relative overflow-hidden">
                        <div className="absolute inset-x-0 top-1/2 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
                      </div>
                    </div>
                    <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
                      <span className="rounded-lg bg-black/80 px-2.5 py-1 text-[10px] font-mono font-semibold text-emerald-300 border border-emerald-500/30 truncate">
                        {decoderEngine === 'native+jsqr'
                          ? 'Active · QR / DataMatrix / Barcode'
                          : 'Active · Universal QR Optical Engine'}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {torchSupported && (
                          <button
                            type="button"
                            onClick={toggleTorch}
                            className={`rounded-xl px-2.5 py-1.5 text-[11px] font-semibold border cursor-pointer flex items-center gap-1 ${
                              torchOn
                                ? 'bg-amber-500 text-zinc-950 border-amber-400'
                                : 'bg-black/80 text-white border-zinc-700 hover:bg-zinc-800'
                            }`}
                            title="Toggle Flashlight Torch"
                          >
                            <Flashlight className="w-3.5 h-3.5" />
                            <span>{torchOn ? 'On' : 'Flash'}</span>
                          </button>
                        )}
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

              {/* Instant 3D/2D Highlight Behavior Bar */}
              <div
                className={`rounded-2xl border px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 ${
                  isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoHighlightOnScan}
                    onChange={(e) => setAutoHighlightOnScan(e.target.checked)}
                    className="accent-emerald-500 w-4 h-4 rounded"
                  />
                  <Zap className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>Instant highlight in viewport on QR scan</span>
                </label>

                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-300/60 dark:border-zinc-800">
                  {(
                    [
                      { id: 'current', label: `Active (${viewMode === '2d' ? '2D' : viewMode === 'split' ? 'Split' : '3D'})` },
                      { id: '3d', label: '3D View' },
                      { id: '2d', label: '2D Plan' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setHighlightTargetView(opt.id)}
                      className={`px-2 py-1 rounded-md text-[10.5px] font-semibold transition cursor-pointer whitespace-nowrap ${
                        highlightTargetView === opt.id
                          ? 'bg-violet-600 text-white'
                          : isDark
                            ? 'text-zinc-400 hover:text-zinc-200'
                            : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => handleGoTo3D(matchedItem)}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-3 py-2 text-xs font-bold shadow-sm transition cursor-pointer"
                    >
                      <Compass className="w-3.5 h-3.5" />
                      <span>Highlight 3D</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGoTo2D(matchedItem)}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-2 text-xs font-bold shadow-sm transition cursor-pointer"
                    >
                      <MapIcon className="w-3.5 h-3.5" />
                      <span>Highlight 2D</span>
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
          /* LABEL DESIGNER TAB — spacious 3-step mobile switcher, dual-pane on desktop */
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Mobile 3-Step Switcher (< lg) eliminates stacked micro-scrollboxes */}
            <div
              className={`lg:hidden px-3 py-2 border-b grid grid-cols-3 gap-1.5 shrink-0 ${
                isDark ? 'bg-[#101016] border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              {(
                [
                  { id: 'items', label: `1. Items (${selectedKeys.length})` },
                  { id: 'style', label: '2. Style' },
                  { id: 'preview', label: `3. Preview (${selectedLabelItems.length})` },
                ] as const
              ).map((step) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setMobileDesignerStep(step.id)}
                  className={`min-h-[38px] rounded-xl px-2 py-1.5 text-[11px] font-bold transition cursor-pointer whitespace-nowrap truncate ${
                    mobileDesignerStep === step.id
                      ? 'bg-violet-600 text-white shadow-sm'
                      : isDark
                        ? 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                        : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                  }`}
                >
                  {step.label}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-12 overflow-hidden">
              {/* Left Selector Panel (Items) */}
              <div
                className={`${
                  mobileDesignerStep === 'items' ? 'flex' : 'hidden lg:flex'
                } flex-1 lg:flex-none min-h-0 lg:col-span-4 lg:border-r flex-col overflow-hidden ${
                  isDark ? 'border-zinc-800 bg-[#14141A]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="p-3 border-b border-zinc-800/60 space-y-2.5 shrink-0">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="Filter equipment, rooms, sensors..."
                      className={`w-full rounded-xl border pl-8 pr-3 py-2 text-xs outline-none ${
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
                        className={`flex-1 rounded-lg py-1.5 text-[10px] font-bold uppercase transition cursor-pointer ${
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
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={`tabular-nums ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                      {selectedKeys.length} selected for batch print
                    </span>
                    <div className="flex gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          const visibleKeys = filteredItems.map((i) => i.key);
                          setSelectedKeys(visibleKeys);
                          showToast(`Selected all ${visibleKeys.length} visible labels`, 'info');
                        }}
                        className="text-violet-400 hover:underline font-semibold cursor-pointer"
                      >
                        Select Visible ({filteredItems.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedKeys([]);
                          showToast('Cleared label selection', 'info');
                        }}
                        className="text-zinc-400 hover:text-zinc-200 hover:underline cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-2.5 space-y-1.5">
                  {filteredItems.map((item) => {
                    const checked = selectedKeys.includes(item.key);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => toggleSelectKey(item.key)}
                        className={`w-full min-h-[48px] text-left rounded-xl p-2.5 border flex items-center gap-2.5 transition cursor-pointer ${
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
                              className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 tabular-nums ${
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
              <div
                className={`${
                  mobileDesignerStep === 'items' ? 'hidden lg:flex' : 'flex'
                } flex-1 lg:flex-none min-h-0 lg:col-span-8 flex-col overflow-hidden`}
              >
                {/* Customization Bar (always visible on desktop; dedicated scrollable pane on mobile 'style' step) */}
                <div
                  className={`${
                    mobileDesignerStep === 'style'
                      ? 'flex-1 overflow-y-auto overscroll-contain touch-pan-y p-4 space-y-4 lg:flex-none lg:overflow-visible lg:space-y-0'
                      : 'hidden lg:block'
                  } lg:p-3 lg:border-b shrink-0 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-2.5">
                    <div>
                      <label className="text-[11px] lg:text-[10px] font-semibold text-zinc-400 block mb-1">
                        Company Header
                      </label>
                      <input
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className={`w-full rounded-xl lg:rounded-lg border px-3 lg:px-2 py-2.5 lg:py-1 text-xs lg:text-[11px] outline-none ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] lg:text-[10px] font-semibold text-zinc-400 block mb-1">
                        Substrate Finish
                      </label>
                      <select
                        value={finish}
                        onChange={(e) => setFinish(e.target.value as LabelFinish)}
                        className={`w-full rounded-xl lg:rounded-lg border px-3 lg:px-2 py-2.5 lg:py-1 text-xs lg:text-[11px] outline-none cursor-pointer ${
                          isDark ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100' : 'bg-white border-slate-300'
                        }`}
                      >
                        <option value="brushed-iron">Brushed Iron / Stainless Steel</option>
                        <option value="charcoal-anodized">Anodized Charcoal Metal</option>
                        <option value="violet-amber">Violet &amp; Amber Branded</option>
                        <option value="cleanroom-white">Cleanroom Matte White</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] lg:text-[10px] font-semibold text-zinc-400 block mb-1">
                        Symbology
                      </label>
                      <select
                        value={symbology}
                        onChange={(e) => setSymbology(e.target.value as LabelSymbology)}
                        className={`w-full rounded-xl lg:rounded-lg border px-3 lg:px-2 py-2.5 lg:py-1 text-xs lg:text-[11px] outline-none cursor-pointer ${
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
                      <label className="text-[11px] lg:text-[10px] font-semibold text-zinc-400 block mb-1">
                        Company Logo &amp; Corners
                      </label>
                      <div className="flex items-center gap-1.5">
                        <label
                          className={`flex-1 flex items-center justify-center gap-1 rounded-xl lg:rounded-lg border px-3 lg:px-2 py-2.5 lg:py-1 text-xs lg:text-[10px] font-semibold cursor-pointer transition ${
                            isDark
                              ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-violet-500'
                              : 'bg-white border-slate-300 text-slate-700'
                          }`}
                        >
                          <Upload className="w-3.5 h-3.5 lg:w-3 lg:h-3 text-amber-400" />
                          <span>{companyLogo ? 'Change' : 'Logo'}</span>
                          <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                        </label>
                        <select
                          value={cornerStyle}
                          onChange={(e) => setCornerStyle(e.target.value as CornerStyle)}
                          className={`rounded-xl lg:rounded-lg border px-2.5 lg:px-1.5 py-2.5 lg:py-1 text-xs lg:text-[10px] cursor-pointer ${
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

                  {/* Mobile-only compliance checkboxes + Preview CTA inside Style step */}
                  <div className="lg:hidden space-y-3 pt-2 border-t border-zinc-800/60">
                    <div className="flex flex-col gap-2.5 text-xs">
                      <label className="inline-flex items-center gap-2.5 cursor-pointer py-1">
                        <input
                          type="checkbox"
                          checked={showComplianceDates}
                          onChange={(e) => setShowComplianceDates(e.target.checked)}
                          className="w-4 h-4 accent-violet-500"
                        />
                        <span className="font-medium">Show Calibration &amp; PQ Compliance Dates</span>
                      </label>
                      <label className="inline-flex items-center gap-2.5 cursor-pointer py-1">
                        <input
                          type="checkbox"
                          checked={showMountingHoles}
                          onChange={(e) => setShowMountingHoles(e.target.checked)}
                          className="w-4 h-4 accent-amber-500"
                        />
                        <span className="font-medium">Show Corner Iron Sign Mounting Grommets</span>
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMobileDesignerStep('preview')}
                      className="w-full min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition cursor-pointer"
                    >
                      Open Print Preview ({selectedLabelItems.length} Labels) →
                    </button>
                  </div>
                </div>

                {/* Desktop Action Strip */}
                <div
                  className={`hidden lg:flex px-4 py-2 border-b flex-wrap items-center justify-between gap-2 text-[11px] shrink-0 ${
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
                      className="flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-1.5 text-xs font-bold transition cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export Vector SVG</span>
                    </button>
                    <button
                      type="button"
                      disabled={selectedLabelItems.length === 0}
                      onClick={handlePrintLabels}
                      className="flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 px-3 py-1.5 text-xs font-bold transition cursor-pointer whitespace-nowrap"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print Sheet</span>
                    </button>
                  </div>
                </div>

                {/* WYSIWYG Print Preview Canvas */}
                <div
                  className={`${
                    mobileDesignerStep === 'preview' ? 'flex-1' : 'hidden lg:block lg:flex-1'
                  } min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 space-y-5`}
                >
                  {selectedLabelItems.length === 0 ? (
                    <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center opacity-70">
                      <Tag className="w-9 h-9 text-violet-400 mb-2" />
                      <p className="text-sm font-bold">Select Equipment, Rooms, or Sensors</p>
                      <p className="text-xs text-zinc-400 mt-1 max-w-xs">
                        Automatic physical sizing: 220×140mm iron room signs, 100×60mm equipment plaques, 35×18mm micro sensor tags.
                      </p>
                      <button
                        type="button"
                        onClick={() => setMobileDesignerStep('items')}
                        className="lg:hidden mt-4 rounded-xl bg-violet-600 text-white px-4 py-2 text-xs font-bold cursor-pointer"
                      >
                        Select Items →
                      </button>
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

            {/* Sticky Mobile Export / Print Footer (< lg) */}
            <div
              className={`lg:hidden px-3 py-2.5 border-t flex items-center gap-2 shrink-0 ${
                isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <button
                type="button"
                disabled={selectedLabelItems.length === 0}
                onClick={handleDownloadSvgSheet}
                className="flex-1 min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-2 text-xs font-bold transition cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export SVG</span>
              </button>
              <button
                type="button"
                disabled={selectedLabelItems.length === 0}
                onClick={handlePrintLabels}
                className="flex-1 min-h-[42px] flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 px-3 py-2 text-xs font-bold transition cursor-pointer whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Sheet ({selectedLabelItems.length})</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
