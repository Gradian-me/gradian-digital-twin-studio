import React, { useMemo } from 'react';
import { Download, ExternalLink, Printer, QrCode, X } from 'lucide-react';

export interface ItLabelPayload {
  kind: 'rack' | 'device' | 'port' | 'user-node';
  code: string;
  title: string;
  subtitle: string;
  location: string;
  ipOrVlan: string;
  uplinkPath: string;
  serialOrMac: string;
  statusLabel: string;
  rackAssetId?: string;
}

interface ItLabelPrintModalProps {
  label: ItLabelPayload | null;
  onClose: () => void;
  onOpenLabelStudio?: (assetId: string) => void;
}

/** Deterministic 17x17 QR-style visual matrix with 3 finder patterns for crisp industrial labels */
function buildQrMatrix(seedText: string): boolean[][] {
  const n = 17;
  const grid: boolean[][] = Array.from({ length: n }, () => Array(n).fill(false));

  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const border = r === 0 || r === 4 || c === 0 || c === 4;
        const center = r === 2 && c === 2;
        if (r0 + r < n && c0 + c < n) {
          grid[r0 + r][c0 + c] = border || center;
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, n - 5);
  drawFinder(n - 5, 0);

  let hash = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    hash ^= seedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const inTL = r < 6 && c < 6;
      const inTR = r < 6 && c >= n - 6;
      const inBL = r >= n - 6 && c < 6;
      if (inTL || inTR || inBL) continue;
      hash ^= (r * 31 + c * 17) & 0xff;
      hash = Math.imul(hash, 16777619);
      grid[r][c] = (hash >>> 29) % 2 === 0;
    }
  }
  return grid;
}

function buildBarcodeBars(code: string): { x: number; w: number }[] {
  const bars: { x: number; w: number }[] = [];
  let cursor = 0;
  const normalized = code.toUpperCase() || 'IT-NODE-01';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    const pattern = [
      (ch % 3) + 1,
      ((ch >> 1) % 2) + 1,
      ((ch >> 2) % 3) + 1,
      ((ch >> 3) % 2) + 1,
    ];
    for (let j = 0; j < pattern.length; j++) {
      const w = pattern[j] * 1.4;
      if (j % 2 === 0) bars.push({ x: cursor, w });
      cursor += w;
    }
    cursor += 1.4;
  }
  return bars;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildLabelSvgMarkup(label: ItLabelPayload): string {
  const qr = buildQrMatrix(`${label.code}|${label.ipOrVlan}|${label.location}`);
  const bars = buildBarcodeBars(label.code);
  const qrCells: string[] = [];
  const cell = 5.4;
  const qrX = 24;
  const qrY = 58;
  for (let r = 0; r < qr.length; r++) {
    for (let c = 0; c < qr[r].length; c++) {
      if (qr[r][c]) {
        qrCells.push(
          `<rect x="${(qrX + c * cell).toFixed(1)}" y="${(qrY + r * cell).toFixed(1)}" width="${cell}" height="${cell}" fill="#09090B" />`
        );
      }
    }
  }
  const maxBarX = bars.length > 0 ? bars[bars.length - 1].x + bars[bars.length - 1].w : 120;
  const barScale = Math.min(2.1, 270 / Math.max(40, maxBarX));
  const barSvg = bars
    .map(
      (b) =>
        `<rect x="${(142 + b.x * barScale).toFixed(1)}" y="168" width="${(b.w * barScale).toFixed(1)}" height="28" fill="#09090B" />`
    )
    .join('');

  const kindTag = label.kind.replace('-', ' ').toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="236" viewBox="0 0 460 236">
  <rect x="2" y="2" width="456" height="232" rx="12" fill="#FFFFFF" stroke="#18181B" stroke-width="2.5" />
  <rect x="2" y="2" width="456" height="38" rx="10" fill="#111118" />
  <rect x="2" y="24" width="456" height="16" fill="#111118" />
  <text x="18" y="26" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700" fill="#FFFFFF">IT ASSET ID · ${escapeXml(kindTag)}</text>
  <text x="442" y="26" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" font-weight="700" fill="#38BDF8">${escapeXml(label.statusLabel.toUpperCase())}</text>
  <rect x="18" y="52" width="104" height="104" rx="6" fill="#FFFFFF" stroke="#E4E4E7" stroke-width="1.5" />
  ${qrCells.join('')}
  <text x="70" y="172" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9.5" font-weight="700" fill="#18181B">${escapeXml(label.code)}</text>
  <text x="70" y="185" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="8" fill="#52525B">SCAN FOR TELEMETRY</text>
  <text x="142" y="70" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" fill="#09090B">${escapeXml(label.code)}</text>
  <text x="142" y="88" font-family="system-ui, -apple-system, sans-serif" font-size="11.5" font-weight="600" fill="#27272A">${escapeXml(label.title.slice(0, 38))}</text>
  <text x="142" y="106" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" fill="#52525B">LOC: ${escapeXml(label.location.slice(0, 42))}</text>
  <text x="142" y="122" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" fill="#1D4ED8">NET: ${escapeXml(label.ipOrVlan.slice(0, 42))}</text>
  <text x="142" y="138" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9.5" fill="#3F3F46">PATH: ${escapeXml(label.uplinkPath.slice(0, 44))}</text>
  <text x="142" y="154" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" fill="#71717A">ID/MAC: ${escapeXml(label.serialOrMac.slice(0, 42))}</text>
  ${barSvg}
  <text x="142" y="212" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" fill="#52525B">${escapeXml(label.subtitle.slice(0, 48))}</text>
</svg>`;
}

export const ItLabelPrintModal: React.FC<ItLabelPrintModalProps> = ({
  label,
  onClose,
  onOpenLabelStudio,
}) => {
  const svgMarkup = useMemo(() => (label ? buildLabelSvgMarkup(label) : ''), [label]);

  if (!label) return null;

  const handlePrint = () => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`<!doctype html>
<html>
  <head>
    <title>IT Label - ${escapeXml(label.code)}</title>
    <style>
      @page { margin: 8mm; }
      body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #fff; }
      svg { max-width: 100%; height: auto; }
    </style>
  </head>
  <body>
    ${svgMarkup}
  </body>
</html>`);
      doc.close();
      iframe.contentWindow?.focus();
      window.setTimeout(() => {
        iframe.contentWindow?.print();
        window.setTimeout(() => {
          document.body.removeChild(iframe);
        }, 600);
      }, 150);
    } else {
      document.body.removeChild(iframe);
    }
  };

  const handleDownloadSvg = () => {
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IT-LABEL-${label.code.replace(/[^a-zA-Z0-9-_]/g, '_')}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#13141C] border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-[#0D0E14]">
          <div className="flex items-center gap-2 min-w-0">
            <QrCode className="w-4 h-4 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                Industrial IT Identification Label
              </div>
              <div className="text-[10.5px] font-mono text-zinc-500 truncate">
                {label.code} · {label.kind.toUpperCase()}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Crisp SVG Label Preview */}
          <div className="rounded-xl bg-zinc-100 dark:bg-[#090A0F] border border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-center">
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`}
              alt={`Identification label for ${label.code}`}
              className="w-full max-w-[440px] rounded-lg shadow-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-[#181A24] p-3 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="truncate"><span className="text-zinc-400">Code:</span> {label.code}</div>
            <div className="truncate"><span className="text-zinc-400">Net:</span> {label.ipOrVlan}</div>
            <div className="col-span-2 truncate"><span className="text-zinc-400">Location:</span> {label.location}</div>
            <div className="col-span-2 truncate"><span className="text-zinc-400">Uplink Path:</span> {label.uplinkPath}</div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {label.rackAssetId && onOpenLabelStudio && (
              <button
                type="button"
                onClick={() => {
                  onOpenLabelStudio(label.rackAssetId!);
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:border-violet-500 text-xs font-semibold text-zinc-700 dark:text-zinc-200 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5 text-violet-500" />
                Open in Label Studio
              </button>
            )}
            <button
              type="button"
              onClick={handleDownloadSvg}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:border-amber-500 text-xs font-semibold text-zinc-700 dark:text-zinc-200 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-amber-500" />
              Download SVG
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-sm cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Label
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
