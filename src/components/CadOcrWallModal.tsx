import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  FileCode2,
  FileImage,
  Layers,
  Loader2,
  ScanText,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { useTwinStore, type CadOcrPlanPayload } from '../store/useTwinStore';
import { fetchApiJson } from '../utils/safeJson';
import {
  decodeSvgDataUrl,
  normalizeVectorsToPlan,
  parseAsciiDxf,
  parseSvgPlan,
  type ExtractedOpening,
  type ExtractedRoom,
  type ExtractedWall,
  type PlanAlignBox,
  type RawTextLabel,
  type RawVectorSegment,
  type SvgViewBox,
} from '../utils/cadPlanParser';

const SAMPLE_LOFT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
  <rect x="40" y="40" width="720" height="420" fill="#0f172a" stroke="#e2e8f0" stroke-width="8" data-wall="exterior"/>
  <!-- Full Glass Curtain Facade along South & River Atrium -->
  <line x1="40" y1="460" x2="760" y2="460" stroke="#38bdf8" stroke-width="6" class="glass curtain-wall"/>
  <line x1="280" y1="220" x2="540" y2="220" stroke="#38bdf8" stroke-width="5" class="glass"/>
  <!-- Interior Partitions -->
  <line x1="280" y1="40" x2="280" y2="460" stroke="#cbd5e1" stroke-width="5"/>
  <line x1="540" y1="40" x2="540" y2="460" stroke="#cbd5e1" stroke-width="5"/>
  <line x1="40" y1="250" x2="280" y2="250" stroke="#cbd5e1" stroke-width="5"/>
  <line x1="540" y1="250" x2="760" y2="250" stroke="#cbd5e1" stroke-width="5"/>
  <text x="160" y="150" fill="#f8fafc" font-size="18" text-anchor="middle">403 Loft West</text>
  <text x="160" y="360" fill="#f8fafc" font-size="18" text-anchor="middle">405 Studio Corner</text>
  <text x="410" y="135" fill="#f8fafc" font-size="18" text-anchor="middle">404 Central Atrium</text>
  <text x="410" y="345" fill="#f8fafc" font-size="18" text-anchor="middle">406 Glass Gallery</text>
  <text x="650" y="150" fill="#f8fafc" font-size="18" text-anchor="middle">407 Executive Suite</text>
  <text x="650" y="360" fill="#f8fafc" font-size="18" text-anchor="middle">408 River Lounge</text>
</svg>`;

const SAMPLE_CLEANROOM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 540" width="900" height="540">
  <rect x="45" y="45" width="810" height="450" fill="#0b1120" stroke="#e2e8f0" stroke-width="9" data-wall="exterior"/>
  <!-- Observation Corridor Full Glass Wall -->
  <line x1="45" y1="365" x2="855" y2="365" stroke="#38bdf8" stroke-width="6" class="full-glass-wall"/>
  <!-- Cleanroom Suites -->
  <line x1="315" y1="45" x2="315" y2="365" stroke="#cbd5e1" stroke-width="5"/>
  <line x1="585" y1="45" x2="585" y2="365" stroke="#cbd5e1" stroke-width="5"/>
  <line x1="585" y1="205" x2="855" y2="205" stroke="#cbd5e1" stroke-width="5"/>
  <text x="180" y="205" fill="#f8fafc" font-size="18" text-anchor="middle">RM-201 Upstream Culture</text>
  <text x="450" y="205" fill="#f8fafc" font-size="18" text-anchor="middle">RM-202 Aseptic Fill Core</text>
  <text x="720" y="128" fill="#f8fafc" font-size="18" text-anchor="middle">RM-203 QC Analytical Lab</text>
  <text x="720" y="288" fill="#f8fafc" font-size="18" text-anchor="middle">RM-204 Material Airlock</text>
  <text x="450" y="435" fill="#7dd3fc" font-size="18" text-anchor="middle">RM-205 Glass Viewing Corridor</text>
</svg>`;

/** Rasterizes an SVG string into a crisp high-contrast PNG data URL for Gemini Vision OCR */
async function rasterizeSvgToPng(svgText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.min(1280, Math.max(640, img.naturalWidth || 960));
        const h = Math.min(960, Math.max(420, img.naturalHeight || 600));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable');
        ctx.fillStyle = '#09090D';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not rasterize SVG for Vision OCR.'));
    };
    img.src = url;
  });
}

export const CadOcrWallModal: React.FC = () => {
  const open = useTwinStore((s) => s.showCadOcrModal);
  const cadOcrReferenceId = useTwinStore((s) => s.cadOcrReferenceId);
  const setOpen = useTwinStore((s) => s.setShowCadOcrModal);
  const importCadOcrPlan = useTwinStore((s) => s.importCadOcrPlan);
  const references = useTwinStore((s) => s.scene.references);
  const activeFloor = useTwinStore(
    (s) => s.scene.floors.find((f) => f.id === s.activeFloorId) ?? s.scene.floors[0]
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sourceName, setSourceName] = useState<string>('');
  const [sourceKind, setSourceKind] = useState<'svg' | 'dxf' | 'dwg' | 'image' | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [rawVectorHint, setRawVectorHint] = useState<string>('');
  const [footprintWidthM, setFootprintWidthM] = useState<number>(28);
  const [footprintDepthM, setFootprintDepthM] = useState<number>(18);
  const [wallHeightM, setWallHeightM] = useState<number>(3.6);
  const [replaceExisting, setReplaceExisting] = useState<boolean>(true);

  const [walls, setWalls] = useState<ExtractedWall[]>([]);
  const [rooms, setRooms] = useState<ExtractedRoom[]>([]);
  const [openings, setOpenings] = useState<ExtractedOpening[]>([]);
  const [detectedLabels, setDetectedLabels] = useState<string[]>([]);
  const [ocrSummary, setOcrSummary] = useState<string>('');
  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);

  const rawSegmentsRef = useRef<RawVectorSegment[]>([]);
  const rawLabelsRef = useRef<RawTextLabel[]>([]);
  const rawViewBoxRef = useRef<SvgViewBox | null>(null);
  const alignBoxRef = useRef<PlanAlignBox | null>(null);

  // Auto-load imported ReferencePlan (SVG or PNG/JPG) when opened via "Turn SVG into 3D Model"
  useEffect(() => {
    if (!open || !cadOcrReferenceId) return;
    const refPlan = references.find((r) => r.id === cadOcrReferenceId);
    if (!refPlan) return;

    const targetW = Math.max(8, Math.round(refPlan.width || 28));
    const targetD = Math.max(8, Math.round(refPlan.depth || 18));
    setFootprintWidthM(targetW);
    setFootprintDepthM(targetD);
    setSourceName(refPlan.name);
    setNotice(null);
    alignBoxRef.current = {
      x: refPlan.x ?? 1,
      z: refPlan.z ?? 1,
      width: refPlan.width || targetW,
      depth: refPlan.depth || targetD,
    };

    const isSvg =
      refPlan.fileType.includes('svg') ||
      refPlan.name.toLowerCase().endsWith('.svg') ||
      refPlan.dataUrl.startsWith('data:image/svg+xml');

    if (isSvg) {
      const svgText = decodeSvgDataUrl(refPlan.dataUrl);
      setSourceKind('svg');
      if (svgText) {
        const parsed = parseSvgPlan(svgText);
        rawSegmentsRef.current = parsed.segments;
        rawLabelsRef.current = parsed.labels;
        rawViewBoxRef.current = parsed.viewBox ?? null;
        setRawVectorHint(
          `SVG labels: ${parsed.labels.map((l) => `"${l.text}"@(${l.x.toFixed(0)},${l.y.toFixed(0)})`).join(', ')} | ${parsed.segments.length} vector segments`
        );
        const res = normalizeVectorsToPlan(parsed.segments, parsed.labels, targetW, targetD, {
          viewBox: parsed.viewBox,
          alignBox: alignBoxRef.current ?? undefined,
        });
        setWalls(res.walls);
        setRooms(res.rooms);
        setOpenings(res.openings);
        setDetectedLabels(parsed.labels.map((l) => l.text));
        if (res.walls.length > 0) {
          setOcrSummary(
            `Ready for 3D extrusion: extracted ${res.walls.length} walls (${res.walls.filter((w) => w.presetId === 'full-glass-wall').length} full glass), ${res.rooms.length} room zones & ${res.openings.length} doors/windows from imported SVG (${refPlan.name}).`
          );
        } else {
          setOcrSummary('');
          setNotice({
            tone: 'warn',
            text: 'No direct SVG line/rect/path walls were detected in this SVG (it may contain embedded raster graphics). Click "Run AI Vision OCR" to trace walls & room numbers automatically.',
          });
        }
        rasterizeSvgToPng(svgText)
          .then((png) => setImageDataUrl(png))
          .catch(() => setImageDataUrl(refPlan.dataUrl));
      } else {
        setImageDataUrl(refPlan.dataUrl);
        setNotice({
          tone: 'info',
          text: 'Imported SVG loaded. Click "Run AI Vision OCR" to detect walls, glass partitions, and room numbers.',
        });
      }
    } else {
      setSourceKind('image');
      rawSegmentsRef.current = [];
      rawLabelsRef.current = [];
      setRawVectorHint('');
      setWalls([]);
      setRooms([]);
      setOpenings([]);
      setDetectedLabels([]);
      setOcrSummary('');
      setImageDataUrl(refPlan.dataUrl);
      setNotice({
        tone: 'info',
        text: `Loaded imported blueprint "${refPlan.name}" (${targetW}×${targetD} m). Click "Run AI Vision OCR" to extract 3D walls, full glass walls, openings & room numbers.`,
      });
    }
  }, [open, cadOcrReferenceId, references]);

  const wallStats = useMemo(() => {
    const glassCount = walls.filter(
      (w) => w.presetId === 'full-glass-wall' || w.presetId === 'glass-partition'
    ).length;
    const extCount = walls.filter((w) => w.isExterior).length;
    return { glassCount, extCount, total: walls.length };
  }, [walls]);

  if (!open) return null;

  const applyLocalVectorExtraction = (
    name: string,
    kind: 'svg' | 'dxf',
    segs: RawVectorSegment[],
    lbls: RawTextLabel[],
    wM: number,
    dM: number,
    viewBox?: SvgViewBox | null
  ) => {
    rawSegmentsRef.current = segs;
    rawLabelsRef.current = lbls;
    rawViewBoxRef.current = viewBox ?? null;
    alignBoxRef.current = null;
    const res = normalizeVectorsToPlan(segs, lbls, wM, dM, {
      viewBox: viewBox ?? undefined,
    });
    setWalls(res.walls);
    setRooms(res.rooms);
    setOpenings(res.openings);
    setDetectedLabels(lbls.map((l) => l.text));
    setOcrSummary(
      `Parsed ${res.walls.length} walls (${res.walls.filter((w) => w.presetId === 'full-glass-wall').length} full glass walls), ${res.rooms.length} room zones & ${res.openings.length} doors/windows from ${kind.toUpperCase()} (${name}).`
    );
    setNotice(null);
  };

  const loadSampleSvg = async (sample: 'loft' | 'cleanroom') => {
    const svgText = sample === 'loft' ? SAMPLE_LOFT_SVG : SAMPLE_CLEANROOM_SVG;
    const name = sample === 'loft' ? 'Architectural_Loft_GlassWalls.svg' : 'Biopharma_Cleanroom_Suite.svg';
    setSourceName(name);
    setSourceKind('svg');
    const parsed = parseSvgPlan(svgText);
    setRawVectorHint(
      `SVG labels: ${parsed.labels.map((l) => `"${l.text}"@(${l.x},${l.y})`).join(', ')} | ${parsed.segments.length} vector segments`
    );
    applyLocalVectorExtraction(name, 'svg', parsed.segments, parsed.labels, footprintWidthM, footprintDepthM, parsed.viewBox);
    try {
      const png = await rasterizeSvgToPng(svgText);
      setImageDataUrl(png);
    } catch {
      setImageDataUrl(null);
    }
  };

  const handleFileSelected = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    setSourceName(file.name);
    setNotice(null);

    if (ext === 'svg') {
      const text = await file.text();
      setSourceKind('svg');
      const parsed = parseSvgPlan(text);
      setRawVectorHint(
        `SVG labels: ${parsed.labels.map((l) => `"${l.text}"@(${l.x},${l.y})`).join(', ')} | ${parsed.segments.length} vector segments`
      );
      applyLocalVectorExtraction(file.name, 'svg', parsed.segments, parsed.labels, footprintWidthM, footprintDepthM, parsed.viewBox);
      try {
        const png = await rasterizeSvgToPng(text);
        setImageDataUrl(png);
      } catch {
        setImageDataUrl(null);
      }
      return;
    }

    if (ext === 'dxf' || ext === 'dwg') {
      const buf = await file.arrayBuffer();
      const head = new TextDecoder('ascii').decode(buf.slice(0, 12));
      const isBinaryDwg = /^AC10\d\d/.test(head);
      if (isBinaryDwg) {
        setSourceKind('dwg');
        setWalls([]);
        setRooms([]);
        setOpenings([]);
        setImageDataUrl(null);
        setNotice({
          tone: 'warn',
          text: `Detected proprietary binary AutoCAD DWG (${head.slice(0, 6)}). Export as ASCII .DXF, .SVG, or high-contrast .PNG/.JPG screenshot from AutoCAD/LibreCAD, then click "Run AI Vision OCR" to convert directly into 3D walls & glass partitions.`,
        });
        return;
      }

      const text = new TextDecoder('utf-8').decode(buf);
      setSourceKind('dxf');
      const parsed = parseAsciiDxf(text);
      setRawVectorHint(
        `DXF labels: ${parsed.labels.map((l) => `"${l.text}"`).join(', ')} | ${parsed.segments.length} LINE/POLYLINE entities`
      );
      if (parsed.segments.length === 0) {
        setNotice({
          tone: 'warn',
          text: 'No ASCII LINE or LWPOLYLINE entities were found in this CAD file. Try uploading an exported SVG or blueprint PNG/JPG and running AI Vision OCR.',
        });
      } else {
        applyLocalVectorExtraction(file.name, 'dxf', parsed.segments, parsed.labels, footprintWidthM, footprintDepthM);
      }
      return;
    }

    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      setSourceKind('image');
      rawSegmentsRef.current = [];
      rawLabelsRef.current = [];
      setRawVectorHint('');
      const reader = new FileReader();
      reader.onload = () => {
        setImageDataUrl(String(reader.result));
        setNotice({
          tone: 'info',
          text: 'Drawing loaded. Click "Run AI Vision OCR" to detect walls, full glass partitions, doors, windows, and room numbers.',
        });
      };
      reader.readAsDataURL(file);
      return;
    }

    setNotice({
      tone: 'error',
      text: `Unsupported file type ".${ext}". Please upload .svg, .dxf, .dwg, .png, .jpg, or .webp.`,
    });
  };

  const handleRecalibrateLocal = (nextW: number, nextD: number) => {
    setFootprintWidthM(nextW);
    setFootprintDepthM(nextD);
    if (rawSegmentsRef.current.length > 0 && (sourceKind === 'svg' || sourceKind === 'dxf')) {
      const res = normalizeVectorsToPlan(rawSegmentsRef.current, rawLabelsRef.current, nextW, nextD, {
        viewBox: rawViewBoxRef.current ?? undefined,
        alignBox: alignBoxRef.current
          ? { ...alignBoxRef.current, width: nextW, depth: nextD }
          : undefined,
      });
      setWalls(res.walls);
      setRooms(res.rooms);
      setOpenings(res.openings);
    }
  };

  const runAiVisionOcr = async () => {
    if (!imageDataUrl && !rawVectorHint) {
      setNotice({ tone: 'warn', text: 'Upload a drawing or load a sample SVG first.' });
      return;
    }
    setOcrLoading(true);
    setNotice(null);
    try {
      const mimeMatch = imageDataUrl?.match(/^data:([^;]+);base64,/);
      const data = await fetchApiJson<any>('/api/cad/ocr-plan-walls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: sourceName || 'uploaded-plan',
          imageBase64: imageDataUrl || undefined,
          mimeType: mimeMatch ? mimeMatch[1] : 'image/png',
          vectorHint: rawVectorHint || undefined,
          targetWidthM: footprintWidthM,
          targetDepthM: footprintDepthM,
          wallHeightM,
        }),
      });

      const aiWalls: ExtractedWall[] = (data.walls || []).map((w: any, i: number) => ({
        x1: Number(w.x1),
        z1: Number(w.z1),
        x2: Number(w.x2),
        z2: Number(w.z2),
        presetId: w.presetId || 'interior-standard',
        name: w.name || `OCR Wall ${i + 1}`,
        isExterior: Boolean(w.isExterior || w.presetId === 'exterior-structural'),
      }));
      const aiRooms: ExtractedRoom[] = (data.rooms || []).map((r: any, i: number) => ({
        code: String(r.code || `RM-${i + 101}`),
        name: String(r.name || `Zone ${i + 1}`),
        x: Number(r.x),
        z: Number(r.z),
        width: Number(r.width),
        depth: Number(r.depth),
      }));
      const aiOpenings: ExtractedOpening[] = (data.openings || []).map((o: any) => ({
        wallIndex: Number(o.wallIndex),
        offsetRatio: Number(o.offsetRatio ?? 0.5),
        kind: o.kind === 'window' ? 'window' : 'door',
        subtype: o.subtype,
        width: o.width ? Number(o.width) : undefined,
        height: o.height ? Number(o.height) : undefined,
        sillHeight: o.sillHeight !== undefined ? Number(o.sillHeight) : undefined,
        name: o.name,
      }));

      setWalls(aiWalls);
      setRooms(aiRooms);
      setOpenings(aiOpenings);
      setDetectedLabels(Array.isArray(data.detectedLabels) ? data.detectedLabels : []);
      setOcrSummary(
        `${data.ocrSummary || 'AI Vision OCR completed.'} (${data.modelUsed || 'Gemini Vision'})`
      );
      if (data.footprintWidthM) setFootprintWidthM(Math.round(Number(data.footprintWidthM)));
      if (data.footprintDepthM) setFootprintDepthM(Math.round(Number(data.footprintDepthM)));
    } catch (err: any) {
      setNotice({
        tone: 'error',
        text: err?.message || 'AI Vision OCR failed. Check your connection or API key and retry.',
      });
    } finally {
      setOcrLoading(false);
    }
  };

  const handleApplyToFloor = (switchTo3D = false) => {
    if (walls.length === 0) return;
    const payload: CadOcrPlanPayload = {
      sourceName: sourceName || 'CAD/SVG OCR Plan',
      replaceExisting,
      footprintWidthM,
      footprintDepthM,
      wallHeightM,
      walls,
      rooms,
      openings,
    };
    importCadOcrPlan(payload, switchTo3D ? { switchToViewMode: '3d-perspective' } : undefined);
  };

  const toggleWallGlass = (idx: number) => {
    setWalls((prev) =>
      prev.map((w, i) =>
        i === idx
          ? {
              ...w,
              presetId: w.presetId === 'full-glass-wall' ? 'interior-standard' : 'full-glass-wall',
            }
          : w
      )
    );
  };

  // Preview SVG viewBox calculation
  const previewBounds = useMemo(() => {
    const w = Math.max(footprintWidthM + 2, 16);
    const d = Math.max(footprintDepthM + 2, 12);
    return { w, d };
  }, [footprintWidthM, footprintDepthM]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-0 sm:p-4">
      <div className="w-full h-[100dvh] sm:h-auto sm:max-w-5xl sm:max-h-[92vh] flex flex-col rounded-none sm:rounded-2xl bg-[#111117] border-0 sm:border border-zinc-800 shadow-[0_28px_80px_rgba(0,0,0,0.85)] overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 bg-[#15151E] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-violet-300">
              <ScanText className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-semibold">
                Separate CAD &amp; Blueprint Vision OCR Pipeline
              </div>
              <h2 className="text-base font-bold text-white">
                DWG / DXF / SVG to Plan Walls &amp; Glass Curtain Walls (OCR)
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main 2-column Workspace */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-zinc-800">
          {/* Left Column: Upload, Samples, OCR Trigger & Calibration */}
          <div className="lg:col-span-5 p-4 space-y-4 bg-[#121219]">
            {/* File Dropzone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="rounded-2xl border-2 border-dashed border-zinc-700 hover:border-violet-500 bg-[#171722] p-4 text-center cursor-pointer transition-colors space-y-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg,.dxf,.dwg,.png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelected(f);
                  e.target.value = '';
                }}
              />
              <Upload className="w-6 h-6 mx-auto text-violet-400" />
              <div className="text-xs font-semibold text-white">
                Drop or Upload .SVG, .DXF, .DWG, or Blueprint Image
              </div>
              <div className="text-[11px] text-zinc-400">
                Direct vector extraction for SVG/DXF + AI Vision OCR for room numbers, glass walls &amp; openings
              </div>
              {sourceName && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/15 border border-violet-500/40 text-[11px] font-mono text-violet-300">
                  {sourceKind === 'image' ? (
                    <FileImage className="w-3.5 h-3.5" />
                  ) : (
                    <FileCode2 className="w-3.5 h-3.5" />
                  )}
                  {sourceName}
                </div>
              )}
            </div>

            {/* Instant Built-In Architectural Samples */}
            <div className="space-y-1.5">
              <div className="text-[10.5px] font-mono uppercase tracking-wider text-zinc-400">
                Or Test Instantly with Sample Architectural SVGs
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => loadSampleSvg('loft')}
                  className="p-2.5 rounded-xl bg-[#181824] hover:bg-[#1E1E2E] border border-zinc-800 hover:border-cyan-400/60 text-left transition-colors cursor-pointer"
                >
                  <div className="text-xs font-semibold text-white">Loft + Glass Walls</div>
                  <div className="text-[10px] text-cyan-300 mt-0.5">6 suites · Full Glass Facade</div>
                </button>
                <button
                  type="button"
                  onClick={() => loadSampleSvg('cleanroom')}
                  className="p-2.5 rounded-xl bg-[#181824] hover:bg-[#1E1E2E] border border-zinc-800 hover:border-violet-400/60 text-left transition-colors cursor-pointer"
                >
                  <div className="text-xs font-semibold text-white">GMP Cleanroom SVG</div>
                  <div className="text-[10px] text-violet-300 mt-0.5">5 rooms · Viewing Corridor</div>
                </button>
              </div>
            </div>

            {/* AI Vision OCR Button */}
            <button
              type="button"
              onClick={runAiVisionOcr}
              disabled={ocrLoading || (!imageDataUrl && !rawVectorHint)}
              className="w-full py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {ocrLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Running Gemini Vision OCR on Plan...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Run AI Vision OCR (Detect Walls, Glass &amp; Room Numbers)
                </>
              )}
            </button>

            {notice && (
              <div
                className={`rounded-xl p-3 text-xs border flex items-start gap-2 ${
                  notice.tone === 'error'
                    ? 'bg-rose-950/40 border-rose-500/45 text-rose-200'
                    : notice.tone === 'warn'
                      ? 'bg-amber-950/35 border-amber-500/45 text-amber-200'
                      : 'bg-violet-950/35 border-violet-500/40 text-violet-200'
                }`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{notice.text}</span>
              </div>
            )}

            {/* Real-World Scale Calibration */}
            <div className="rounded-xl bg-[#171722] border border-zinc-800 p-3.5 space-y-3">
              <div className="text-[11px] font-semibold text-zinc-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                Metric Scale &amp; Floor Placement ({activeFloor?.name || 'Active Floor'})
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="space-y-1">
                  <span className="text-[10px] font-mono text-zinc-400">Width (m)</span>
                  <input
                    type="number"
                    min={8}
                    max={160}
                    value={footprintWidthM}
                    onChange={(e) => handleRecalibrateLocal(Number(e.target.value) || 24, footprintDepthM)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#101016] border border-zinc-700 font-mono text-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-mono text-zinc-400">Depth (m)</span>
                  <input
                    type="number"
                    min={8}
                    max={160}
                    value={footprintDepthM}
                    onChange={(e) => handleRecalibrateLocal(footprintWidthM, Number(e.target.value) || 16)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#101016] border border-zinc-700 font-mono text-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-mono text-zinc-400">Wall H (m)</span>
                  <input
                    type="number"
                    step={0.1}
                    min={2.4}
                    max={8}
                    value={wallHeightM}
                    onChange={(e) => setWallHeightM(Number(e.target.value) || 3.6)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#101016] border border-zinc-700 font-mono text-white"
                  />
                </label>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setReplaceExisting(true)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer ${
                    replaceExisting
                      ? 'bg-violet-600/20 border-violet-500 text-violet-200'
                      : 'bg-[#101016] border-zinc-800 text-zinc-400'
                  }`}
                >
                  Replace Floor Plan
                </button>
                <button
                  type="button"
                  onClick={() => setReplaceExisting(false)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer ${
                    !replaceExisting
                      ? 'bg-violet-600/20 border-violet-500 text-violet-200'
                      : 'bg-[#101016] border-zinc-800 text-zinc-400'
                  }`}
                >
                  Append Walls
                </button>
              </div>
            </div>

            {/* OCR Detected Text Labels */}
            {detectedLabels.length > 0 && (
              <div className="rounded-xl bg-[#171722] border border-zinc-800 p-3 space-y-1.5">
                <div className="text-[10.5px] font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  OCR Room Labels Detected ({detectedLabels.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {detectedLabels.map((lbl, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-700 font-mono text-[10.5px] text-zinc-200"
                    >
                      {lbl}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Interactive Extracted Wall & Room Vector Preview */}
          <div className="lg:col-span-7 p-4 flex flex-col gap-3 bg-[#0E0E14]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-white">
                Extracted 2D Plan Preview{' '}
                <span className="font-mono text-zinc-400 font-normal">
                  (Click any wall line to toggle Full Glass Wall)
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10.5px] font-mono">
                <span className="flex items-center gap-1 text-zinc-300">
                  <span className="w-2.5 h-1 bg-zinc-200 inline-block" /> Solid ({wallStats.total - wallStats.glassCount})
                </span>
                <span className="flex items-center gap-1 text-cyan-300">
                  <span className="w-2.5 h-1 bg-cyan-400 inline-block" /> Full Glass ({wallStats.glassCount})
                </span>
                <span className="flex items-center gap-1 text-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Openings ({openings.length})
                </span>
              </div>
            </div>

            <div className="flex-1 min-h-[300px] rounded-2xl bg-[#09090D] border border-zinc-800 relative overflow-hidden flex items-center justify-center">
              {walls.length > 0 ? (
                <svg
                  viewBox={`0 0 ${previewBounds.w} ${previewBounds.d}`}
                  className="w-full h-full max-h-[390px] p-3"
                >
                  {/* Background meter grid */}
                  <defs>
                    <pattern id="ocrGrid" width="2" height="2" patternUnits="userSpaceOnUse">
                      <path d="M 2 0 L 0 0 0 2" fill="none" stroke="#1F202B" strokeWidth="0.06" />
                    </pattern>
                  </defs>
                  <rect x="0" y="0" width={previewBounds.w} height={previewBounds.d} fill="url(#ocrGrid)" />

                  {/* Rooms */}
                  {rooms.map((rm, idx) => (
                    <g key={idx}>
                      <rect
                        x={rm.x}
                        y={rm.z}
                        width={rm.width}
                        height={rm.depth}
                        fill="#8B5CF6"
                        fillOpacity={0.12}
                        stroke="#8B5CF6"
                        strokeOpacity={0.35}
                        strokeWidth={0.08}
                      />
                      <text
                        x={rm.x + rm.width / 2}
                        y={rm.z + rm.depth / 2 - 0.15}
                        fill="#F8FAFC"
                        fontSize={0.62}
                        fontFamily="monospace"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {rm.code}
                      </text>
                      <text
                        x={rm.x + rm.width / 2}
                        y={rm.z + rm.depth / 2 + 0.52}
                        fill="#A1A1AA"
                        fontSize={0.42}
                        fontFamily="sans-serif"
                        textAnchor="middle"
                      >
                        {rm.name.slice(0, 22)} · {(rm.width * rm.depth).toFixed(0)}m²
                      </text>
                    </g>
                  ))}

                  {/* Clickable Walls (click to toggle Full Glass Wall) */}
                  {walls.map((w, idx) => {
                    const isGlass = w.presetId === 'full-glass-wall' || w.presetId === 'glass-partition';
                    return (
                      <line
                        key={idx}
                        x1={w.x1}
                        y1={w.z1}
                        x2={w.x2}
                        y2={w.z2}
                        stroke={isGlass ? '#38BDF8' : w.isExterior ? '#F8FAFC' : '#A1A1AA'}
                        strokeWidth={isGlass ? 0.24 : w.isExterior ? 0.3 : 0.2}
                        strokeDasharray={isGlass ? '0.6 0.18' : undefined}
                        strokeLinecap="round"
                        className="cursor-pointer hover:stroke-violet-400"
                        onClick={() => toggleWallGlass(idx)}
                      >
                        <title>{`${w.name} (${w.presetId}) — Click to toggle Full Glass Wall`}</title>
                      </line>
                    );
                  })}

                  {/* Doors & Windows markers */}
                  {openings.map((op, idx) => {
                    const w = walls[op.wallIndex];
                    if (!w) return null;
                    const ox = w.x1 + (w.x2 - w.x1) * op.offsetRatio;
                    const oz = w.z1 + (w.z2 - w.z1) * op.offsetRatio;
                    return (
                      <circle
                        key={idx}
                        cx={ox}
                        cy={oz}
                        r={0.34}
                        fill={op.kind === 'window' ? '#38BDF8' : '#F59E0B'}
                        stroke="#09090D"
                        strokeWidth={0.08}
                      >
                        <title>{op.name || `${op.kind} (${op.subtype})`}</title>
                      </circle>
                    );
                  })}
                </svg>
              ) : imageDataUrl ? (
                <img
                  src={imageDataUrl}
                  alt="Uploaded CAD Blueprint"
                  className="max-h-[360px] object-contain p-3"
                />
              ) : (
                <div className="text-center p-8 space-y-2 text-zinc-500">
                  <Wand2 className="w-8 h-8 mx-auto text-zinc-700" />
                  <div className="text-xs font-medium text-zinc-400">
                    Upload an SVG / DXF / DWG or pick a sample architectural plan on the left
                  </div>
                  <div className="text-[11px]">
                    Extracted walls, full glass curtain walls, doors, windows, and OCR room zones will preview here before generating 3D geometry.
                  </div>
                </div>
              )}
            </div>

            {ocrSummary && (
              <div className="rounded-xl bg-[#151520] border border-zinc-800 px-3.5 py-2.5 text-xs text-zinc-300">
                {ocrSummary}
              </div>
            )}

            {/* Footer Action Bar */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800">
              <div className="text-[11px] font-mono text-zinc-400">
                Ready: <strong className="text-white">{walls.length}</strong> walls ·{' '}
                <strong className="text-cyan-300">{wallStats.glassCount}</strong> glass walls ·{' '}
                <strong className="text-white">{rooms.length}</strong> rooms ·{' '}
                <strong className="text-amber-300">{openings.length}</strong> openings
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={walls.length === 0}
                  onClick={() => handleApplyToFloor(false)}
                  className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 text-zinc-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Apply to 2D Plan
                </button>
                <button
                  type="button"
                  disabled={walls.length === 0}
                  onClick={() => handleApplyToFloor(true)}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Box className="w-4 h-4" />
                  Build 3D Model &amp; Open 3D
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
