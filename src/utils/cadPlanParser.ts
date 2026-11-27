import type { OpeningSubtype, WallPresetId } from '../types/twin';

export interface ExtractedWall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  presetId: WallPresetId;
  name: string;
  isExterior: boolean;
}

export interface ExtractedRoom {
  code: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface ExtractedOpening {
  wallIndex: number;
  offsetRatio: number;
  kind: 'door' | 'window';
  subtype?: OpeningSubtype;
  width?: number;
  height?: number;
  sillHeight?: number;
  name?: string;
}

export interface RawVectorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isGlassHint?: boolean;
  isExteriorHint?: boolean;
  strokeWidth?: number;
}

export interface RawTextLabel {
  x: number;
  y: number;
  text: string;
}

export interface SvgViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanAlignBox {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface ParsedSvgMetadata {
  viewBox?: SvgViewBox;
  aspectRatio?: number;
}

export interface ParsedVectorResult {
  segments: RawVectorSegment[];
  labels: RawTextLabel[];
  viewBox?: SvgViewBox;
  meta: ParsedSvgMetadata;
}

function isGlassColor(stroke: string | null, cls: string): boolean {
  const lc = `${stroke || ''} ${cls || ''}`.toLowerCase();
  return (
    lc.includes('glass') ||
    lc.includes('curtain') ||
    lc.includes('glaz') ||
    lc.includes('38bdf8') ||
    lc.includes('0ea5e9') ||
    lc.includes('00ffff') ||
    lc.includes('cyan') ||
    lc.includes('7dd3fc')
  );
}

/** Detect red/magenta/orange/green annotation/flow arrows that are NOT architectural walls */
function isAnnotationOrFlowStroke(stroke: string | null, cls: string): boolean {
  const lc = `${stroke || ''} ${cls || ''}`.toLowerCase();
  if (lc.includes('flow') || lc.includes('arrow') || lc.includes('route') || lc.includes('marker') || lc.includes('dimension')) {
    return true;
  }
  const hexMatch = lc.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    // Pure vivid red/pink/rose flow arrows (e.g. #ff4d4f, #ef4444, #e11d48, #ff0000)
    if (r > 175 && g < 110 && b < 110 && r - Math.max(g, b) > 75) return true;
  }
  const rgbMatch = lc.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    if (r > 175 && g < 110 && b < 110 && r - Math.max(g, b) > 75) return true;
  }
  if (lc.includes('red') || lc.includes('crimson') || lc.includes('salmon')) return true;
  return false;
}

type Mat2D = [number, number, number, number, number, number]; // a, b, c, d, e, f

function multiplyMat2D(m1: Mat2D, m2: Mat2D): Mat2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function parseTransformAttr(attr: string | null): Mat2D {
  let m: Mat2D = [1, 0, 0, 1, 0, 0];
  if (!attr) return m;
  const re = /(translate|scale|rotate|matrix)\s*\(([^)]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attr)) !== null) {
    const fn = match[1].toLowerCase();
    const nums = match[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    let next: Mat2D = [1, 0, 0, 1, 0, 0];
    if (fn === 'translate' && nums.length >= 1) {
      next = [1, 0, 0, 1, nums[0], nums[1] ?? 0];
    } else if (fn === 'scale' && nums.length >= 1) {
      next = [nums[0], 0, 0, nums[1] ?? nums[0], 0, 0];
    } else if (fn === 'rotate' && nums.length >= 1) {
      const rad = (nums[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      if (nums.length >= 3) {
        const cx = nums[1];
        const cy = nums[2];
        next = multiplyMat2D(
          multiplyMat2D([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]),
          [1, 0, 0, 1, -cx, -cy]
        );
      } else {
        next = [cos, sin, -sin, cos, 0, 0];
      }
    } else if (fn === 'matrix' && nums.length >= 6) {
      next = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
    }
    m = multiplyMat2D(m, next);
  }
  return m;
}

function getCumulativeTransform(el: Element): Mat2D {
  const chain: Element[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName.toLowerCase() !== 'svg') {
    chain.push(cur);
    cur = cur.parentElement;
  }
  let m: Mat2D = [1, 0, 0, 1, 0, 0];
  for (let i = chain.length - 1; i >= 0; i--) {
    const tf = chain[i].getAttribute('transform');
    if (tf) m = multiplyMat2D(m, parseTransformAttr(tf));
  }
  return m;
}

function applyMat2D(m: Mat2D, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

function isInsideNonRenderedContainer(el: Element): boolean {
  let cur: Element | null = el.parentElement;
  while (cur) {
    const tag = cur.tagName.toLowerCase();
    if (
      tag === 'defs' ||
      tag === 'clippath' ||
      tag === 'mask' ||
      tag === 'pattern' ||
      tag === 'symbol' ||
      tag === 'marker'
    ) {
      return true;
    }
    if (cur.getAttribute('display') === 'none' || cur.getAttribute('visibility') === 'hidden') {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

function getInheritedAttr(el: Element, attrName: string, styleMap: Record<string, Record<string, string>>): string | null {
  let cur: Element | null = el;
  while (cur) {
    const direct = cur.getAttribute(attrName);
    if (direct && direct !== 'inherit') return direct;
    const inlineStyle = cur.getAttribute('style') || '';
    const styleMatch = inlineStyle.match(new RegExp(`(?:^|;)\\s*${attrName}\\s*:\\s*([^;]+)`, 'i'));
    if (styleMatch) return styleMatch[1].trim();
    const cls = cur.getAttribute('class') || '';
    for (const c of cls.split(/\s+/)) {
      if (c && styleMap[`.${c}`]?.[attrName]) return styleMap[`.${c}`][attrName];
    }
    const id = cur.getAttribute('id');
    if (id && styleMap[`#${id}`]?.[attrName]) return styleMap[`#${id}`][attrName];
    cur = cur.parentElement;
  }
  return null;
}

function parseCssStyleBlocks(doc: Document): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = {};
  doc.querySelectorAll('style').forEach((styleEl) => {
    const css = styleEl.textContent || '';
    const ruleRe = /([^{]+)\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css)) !== null) {
      const selectors = m[1].split(',').map((s) => s.trim());
      const props: Record<string, string> = {};
      m[2].split(';').forEach((decl) => {
        const idx = decl.indexOf(':');
        if (idx > 0) {
          const k = decl.slice(0, idx).trim().toLowerCase();
          const v = decl.slice(idx + 1).trim();
          if (k && v) props[k] = v;
        }
      });
      selectors.forEach((sel) => {
        if (sel) map[sel] = { ...(map[sel] || {}), ...props };
      });
    }
  });
  return map;
}

export function decodeSvgDataUrl(dataUrl: string): string | null {
  if (!dataUrl.startsWith('data:image/svg+xml')) return null;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return null;
  const meta = dataUrl.slice(0, commaIdx);
  const body = dataUrl.slice(commaIdx + 1);
  try {
    if (meta.includes(';base64')) {
      const bin = atob(body);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(body);
  } catch {
    try {
      return atob(body);
    } catch {
      return null;
    }
  }
}

/** Deterministic client-side SVG architectural geometry + <text> OCR extractor */
export function parseSvgPlan(svgText: string): ParsedVectorResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  const styleMap = parseCssStyleBlocks(doc);

  let viewBox: ParsedSvgMetadata['viewBox'];
  if (svgEl) {
    const vbAttr = svgEl.getAttribute('viewBox');
    if (vbAttr) {
      const nums = vbAttr.trim().split(/[\s,]+/).map(Number);
      if (nums.length >= 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0) {
        viewBox = { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
      }
    }
    if (!viewBox) {
      const w = parseFloat(svgEl.getAttribute('width') || '');
      const h = parseFloat(svgEl.getAttribute('height') || '');
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        viewBox = { x: 0, y: 0, width: w, height: h };
      }
    }
  }

  const segments: RawVectorSegment[] = [];
  const labels: RawTextLabel[] = [];

  const pushTransformed = (
    m: Mat2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    isGlassHint: boolean,
    isExteriorHint = false,
    strokeWidth = 1
  ) => {
    const p1 = applyMat2D(m, x1, y1);
    const p2 = applyMat2D(m, x2, y2);
    if (!Number.isFinite(p1.x) || !Number.isFinite(p1.y) || !Number.isFinite(p2.x) || !Number.isFinite(p2.y)) {
      return;
    }
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) > 0.5) {
      segments.push({
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        isGlassHint,
        isExteriorHint,
        strokeWidth,
      });
    }
  };

  const inspectStrokeMeta = (el: Element) => {
    const stroke = getInheritedAttr(el, 'stroke', styleMap);
    const fill = getInheritedAttr(el, 'fill', styleMap);
    const sw = parseFloat(getInheritedAttr(el, 'stroke-width', styleMap) || '1') || 1;
    const markerEnd = el.getAttribute('marker-end') || el.getAttribute('marker-start') || '';
    const cls = `${el.getAttribute('class') || ''} ${el.getAttribute('id') || ''} ${el.getAttribute('data-wall') || ''}`;
    const isArrowOrFlow = Boolean(markerEnd) || isAnnotationOrFlowStroke(stroke, cls);
    const isInvisibleStroke = stroke === 'none' || stroke === 'transparent';
    const hasVisibleFill = Boolean(fill && fill !== 'none' && fill !== 'transparent');
    return {
      stroke,
      fill,
      sw,
      cls,
      isGlass: isGlassColor(stroke, cls),
      isExt: cls.toLowerCase().includes('exterior') || cls.toLowerCase().includes('outer'),
      isArrowOrFlow,
      isInvisibleStroke,
      hasVisibleFill,
    };
  };

  // <line>
  doc.querySelectorAll('line').forEach((el) => {
    if (isInsideNonRenderedContainer(el)) return;
    const meta = inspectStrokeMeta(el);
    if (meta.isArrowOrFlow || meta.isInvisibleStroke) return;
    const m = getCumulativeTransform(el);
    const x1 = parseFloat(el.getAttribute('x1') || '0');
    const y1 = parseFloat(el.getAttribute('y1') || '0');
    const x2 = parseFloat(el.getAttribute('x2') || '0');
    const y2 = parseFloat(el.getAttribute('y2') || '0');
    pushTransformed(m, x1, y1, x2, y2, meta.isGlass, meta.isExt, meta.sw);
  });

  // <rect>
  doc.querySelectorAll('rect').forEach((el) => {
    if (isInsideNonRenderedContainer(el)) return;
    const meta = inspectStrokeMeta(el);
    if (meta.isArrowOrFlow) return;
    const m = getCumulativeTransform(el);
    const x = parseFloat(el.getAttribute('x') || '0');
    const y = parseFloat(el.getAttribute('y') || '0');
    const w = parseFloat(el.getAttribute('width') || '0');
    const h = parseFloat(el.getAttribute('height') || '0');
    if (w < 1.0 || h < 1.0) return;

    // Skip full-canvas white/background backing rectangles
    if (viewBox) {
      const p1 = applyMat2D(m, x, y);
      const p2 = applyMat2D(m, x + w, y + h);
      const rw = Math.abs(p2.x - p1.x);
      const rh = Math.abs(p2.y - p1.y);
      const coversWholeCanvas = rw >= viewBox.width * 0.96 && rh >= viewBox.height * 0.96;
      if (coversWholeCanvas && (meta.isInvisibleStroke || !meta.stroke)) return;
    }

    // If it's a thin filled wall-strip rectangle (common in CAD/Illustrator exports), convert directly to centerline wall!
    const aspect = Math.max(w / h, h / w);
    const minSide = Math.min(w, h);
    const refDiag = viewBox ? Math.hypot(viewBox.width, viewBox.height) : 1000;
    if (meta.hasVisibleFill && aspect >= 5 && minSide <= refDiag * 0.035) {
      if (w >= h) {
        pushTransformed(m, x, y + h / 2, x + w, y + h / 2, meta.isGlass, meta.isExt, minSide);
      } else {
        pushTransformed(m, x + w / 2, y, x + w / 2, y + h, meta.isGlass, meta.isExt, minSide);
      }
      return;
    }

    // Skip unstroked filled decorative zone shading rectangles when stroke is explicitly none
    if (meta.isInvisibleStroke && !meta.isExt) return;

    pushTransformed(m, x, y, x + w, y, meta.isGlass, meta.isExt, meta.sw);
    pushTransformed(m, x + w, y, x + w, y + h, meta.isGlass, meta.isExt, meta.sw);
    pushTransformed(m, x + w, y + h, x, y + h, meta.isGlass, meta.isExt, meta.sw);
    pushTransformed(m, x, y + h, x, y, meta.isGlass, meta.isExt, meta.sw);
  });

  // <polyline> & <polygon>
  doc.querySelectorAll('polyline, polygon').forEach((el) => {
    if (isInsideNonRenderedContainer(el)) return;
    const meta = inspectStrokeMeta(el);
    if (meta.isArrowOrFlow) return;
    if (meta.isInvisibleStroke && !meta.hasVisibleFill) return;
    const m = getCumulativeTransform(el);
    const raw = (el.getAttribute('points') || '').trim();
    const nums = raw.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push({ x: nums[i], y: nums[i + 1] });
    }
    // Skip tiny 3-point arrow heads
    if (pts.length <= 3 && el.tagName.toLowerCase() === 'polygon') {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (viewBox && span < Math.min(viewBox.width, viewBox.height) * 0.03) return;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      pushTransformed(m, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, meta.isGlass, meta.isExt, meta.sw);
    }
    if (el.tagName.toLowerCase() === 'polygon' && pts.length > 2) {
      pushTransformed(m, pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y, meta.isGlass, meta.isExt, meta.sw);
    }
  });

  // <path> (full M/L/H/V/C/S/Q/T/A/Z support with Bezier sampling & compact arc flags)
  doc.querySelectorAll('path').forEach((el) => {
    if (isInsideNonRenderedContainer(el)) return;
    const meta = inspectStrokeMeta(el);
    if (meta.isArrowOrFlow) return;
    // Skip filled-only tinted room-highlight overlays (e.g. light blue/green translucent zone polygons with no stroke)
    if (meta.isInvisibleStroke && !meta.isExt) {
      const fillLc = (meta.fill || '').toLowerCase();
      const isDarkWallFill = fillLc === '#000' || fillLc === '#000000' || fillLc === 'black' || fillLc.includes('1e293b') || fillLc.includes('334155') || fillLc.includes('0f172a') || fillLc.includes('111');
      if (!isDarkWallFill) return;
    }

    const m = getCumulativeTransform(el);
    const d = el.getAttribute('d') || '';
    const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) || [];

    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let cmd = '';
    let i = 0;
    while (i < tokens.length) {
      if (/^[MLHVCSQTAZmlhvcsqtaz]$/.test(tokens[i])) {
        cmd = tokens[i++];
        if (cmd === 'Z' || cmd === 'z') {
          pushTransformed(m, cx, cy, sx, sy, meta.isGlass, meta.isExt, meta.sw);
          cx = sx;
          cy = sy;
        }
        continue;
      }
      const n1 = parseFloat(tokens[i++]);
      if (!Number.isFinite(n1)) continue;
      if (cmd === 'M' || cmd === 'm') {
        const n2 = parseFloat(tokens[i++]);
        if (!Number.isFinite(n2)) break;
        cx = cmd === 'm' ? cx + n1 : n1;
        cy = cmd === 'm' ? cy + n2 : n2;
        sx = cx;
        sy = cy;
        cmd = cmd === 'm' ? 'l' : 'L';
      } else if (cmd === 'L' || cmd === 'l') {
        const n2 = parseFloat(tokens[i++]);
        if (!Number.isFinite(n2)) break;
        const nx = cmd === 'l' ? cx + n1 : n1;
        const ny = cmd === 'l' ? cy + n2 : n2;
        pushTransformed(m, cx, cy, nx, ny, meta.isGlass, meta.isExt, meta.sw);
        cx = nx;
        cy = ny;
      } else if (cmd === 'H' || cmd === 'h') {
        const nx = cmd === 'h' ? cx + n1 : n1;
        pushTransformed(m, cx, cy, nx, cy, meta.isGlass, meta.isExt, meta.sw);
        cx = nx;
      } else if (cmd === 'V' || cmd === 'v') {
        const ny = cmd === 'v' ? cy + n1 : n1;
        pushTransformed(m, cx, cy, cx, ny, meta.isGlass, meta.isExt, meta.sw);
        cy = ny;
      } else if (cmd === 'C' || cmd === 'c') {
        const coords = [
          n1,
          parseFloat(tokens[i++]),
          parseFloat(tokens[i++]),
          parseFloat(tokens[i++]),
          parseFloat(tokens[i++]),
          parseFloat(tokens[i++]),
        ];
        if (coords.some((c) => !Number.isFinite(c))) break;
        const nx = cmd === 'c' ? cx + coords[4] : coords[4];
        const ny = cmd === 'c' ? cy + coords[5] : coords[5];
        pushTransformed(m, cx, cy, nx, ny, meta.isGlass, meta.isExt, meta.sw);
        cx = nx;
        cy = ny;
      } else if (cmd === 'S' || cmd === 's' || cmd === 'Q' || cmd === 'q') {
        const coords = [n1, parseFloat(tokens[i++]), parseFloat(tokens[i++]), parseFloat(tokens[i++])];
        if (coords.some((c) => !Number.isFinite(c))) break;
        const nx = cmd === 's' || cmd === 'q' ? cx + coords[2] : coords[2];
        const ny = cmd === 's' || cmd === 'q' ? cy + coords[3] : coords[3];
        pushTransformed(m, cx, cy, nx, ny, meta.isGlass, meta.isExt, meta.sw);
        cx = nx;
        cy = ny;
      } else if (cmd === 'T' || cmd === 't') {
        const n2 = parseFloat(tokens[i++]);
        if (!Number.isFinite(n2)) break;
        const nx = cmd === 't' ? cx + n1 : n1;
        const ny = cmd === 't' ? cy + n2 : n2;
        pushTransformed(m, cx, cy, nx, ny, meta.isGlass, meta.isExt, meta.sw);
        cx = nx;
        cy = ny;
      } else if (cmd === 'A' || cmd === 'a') {
        // Arc: skip door-swing arc as solid wall, just advance pen
        const coords = [
          n1,
          parseFloat(tokens[i++]),
          parseFloat(tokens[i++]),
          parseFloat(tokens[i++]),
          parseFloat(tokens[i++]),
          parseFloat(tokens[i++]),
          parseFloat(tokens[i++]),
        ];
        if (coords.some((c) => !Number.isFinite(c))) break;
        cx = cmd === 'a' ? cx + coords[5] : coords[5];
        cy = cmd === 'a' ? cy + coords[6] : coords[6];
      }
    }
  });

  // <text> OCR room labels
  doc.querySelectorAll('text').forEach((el) => {
    if (isInsideNonRenderedContainer(el)) return;
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!txt) return;
    const m = getCumulativeTransform(el);
    const pt = applyMat2D(m, parseFloat(el.getAttribute('x') || '0'), parseFloat(el.getAttribute('y') || '0'));
    labels.push({ x: pt.x, y: pt.y, text: txt });
  });

  return {
    segments,
    labels,
    viewBox,
    meta: {
      viewBox,
      aspectRatio: viewBox ? viewBox.width / viewBox.height : undefined,
    },
  };
}

/** Deterministic ASCII DXF ENTITIES parser (LINE, LWPOLYLINE, POLYLINE/VERTEX, TEXT, MTEXT) */
export function parseAsciiDxf(dxfText: string): ParsedVectorResult {
  const lines = dxfText.split(/\r?\n/).map((l) => l.trim());
  const segments: RawVectorSegment[] = [];
  const labels: RawTextLabel[] = [];

  let i = 0;
  while (i < lines.length - 1) {
    const code = lines[i];
    const val = lines[i + 1];
    if (code === '0' && val === 'LINE') {
      let x1 = 0;
      let y1 = 0;
      let x2 = 0;
      let y2 = 0;
      let layer = '';
      i += 2;
      while (i < lines.length - 1 && lines[i] !== '0') {
        const c = lines[i];
        const v = lines[i + 1];
        if (c === '8') layer = v;
        if (c === '10') x1 = parseFloat(v);
        if (c === '20') y1 = parseFloat(v);
        if (c === '11') x2 = parseFloat(v);
        if (c === '21') y2 = parseFloat(v);
        i += 2;
      }
      if (Math.hypot(x2 - x1, y2 - y1) > 0.01) {
        segments.push({
          x1,
          y1: -y1,
          x2,
          y2: -y2,
          isGlassHint: isGlassColor(null, layer),
          isExteriorHint: /ext|shell|facade/i.test(layer),
        });
      }
      continue;
    }

    if (code === '0' && val === 'LWPOLYLINE') {
      const pts: { x: number; y: number }[] = [];
      let closed = false;
      let layer = '';
      let pendingX: number | null = null;
      i += 2;
      while (i < lines.length - 1 && lines[i] !== '0') {
        const c = lines[i];
        const v = lines[i + 1];
        if (c === '8') layer = v;
        if (c === '70') closed = (parseInt(v, 10) & 1) === 1;
        if (c === '10') pendingX = parseFloat(v);
        if (c === '20' && pendingX !== null) {
          pts.push({ x: pendingX, y: -parseFloat(v) });
          pendingX = null;
        }
        i += 2;
      }
      const glass = isGlassColor(null, layer);
      const ext = /ext|shell|facade/i.test(layer);
      for (let k = 0; k < pts.length - 1; k++) {
        segments.push({ x1: pts[k].x, y1: pts[k].y, x2: pts[k + 1].x, y2: pts[k + 1].y, isGlassHint: glass, isExteriorHint: ext });
      }
      if (closed && pts.length > 2) {
        segments.push({
          x1: pts[pts.length - 1].x,
          y1: pts[pts.length - 1].y,
          x2: pts[0].x,
          y2: pts[0].y,
          isGlassHint: glass,
          isExteriorHint: ext,
        });
      }
      continue;
    }

    if (code === '0' && val === 'POLYLINE') {
      const pts: { x: number; y: number }[] = [];
      let closed = false;
      let layer = '';
      i += 2;
      while (i < lines.length - 1 && lines[i] !== '0') {
        const c = lines[i];
        const v = lines[i + 1];
        if (c === '8') layer = v;
        if (c === '70') closed = (parseInt(v, 10) & 1) === 1;
        i += 2;
      }
      while (i < lines.length - 1) {
        if (lines[i] === '0' && lines[i + 1] === 'VERTEX') {
          let vx = 0;
          let vy = 0;
          i += 2;
          while (i < lines.length - 1 && lines[i] !== '0') {
            if (lines[i] === '10') vx = parseFloat(lines[i + 1]);
            if (lines[i] === '20') vy = parseFloat(lines[i + 1]);
            i += 2;
          }
          pts.push({ x: vx, y: -vy });
          continue;
        }
        if (lines[i] === '0' && lines[i + 1] === 'SEQEND') {
          i += 2;
          break;
        }
        break;
      }
      const glass = isGlassColor(null, layer);
      for (let k = 0; k < pts.length - 1; k++) {
        segments.push({ x1: pts[k].x, y1: pts[k].y, x2: pts[k + 1].x, y2: pts[k + 1].y, isGlassHint: glass });
      }
      if (closed && pts.length > 2) {
        segments.push({ x1: pts[pts.length - 1].x, y1: pts[pts.length - 1].y, x2: pts[0].x, y2: pts[0].y, isGlassHint: glass });
      }
      continue;
    }

    if (code === '0' && (val === 'TEXT' || val === 'MTEXT')) {
      let x = 0;
      let y = 0;
      let txt = '';
      i += 2;
      while (i < lines.length - 1 && lines[i] !== '0') {
        const c = lines[i];
        const v = lines[i + 1];
        if (c === '10') x = parseFloat(v);
        if (c === '20') y = parseFloat(v);
        if (c === '1') txt = v.replace(/\\P/g, ' ').replace(/\{[^;]+;|\}/g, '').trim();
        i += 2;
      }
      if (txt) labels.push({ x, y: -y, text: txt });
      continue;
    }

    i += 2;
  }

  return { segments, labels, meta: {} };
}

/**
 * Normalize raw vector segments + OCR labels into metric plan walls, rooms & smart openings.
 * When `alignBox` (matching the ReferencePlan x/z/width/depth) AND `viewBox` are provided,
 * extracted 3D walls align 1:1 right on top of the displayed SVG blueprint!
 */
export function normalizeVectorsToPlan(
  segments: RawVectorSegment[],
  labels: RawTextLabel[],
  targetWidthM: number,
  targetDepthM: number,
  options?: {
    viewBox?: ParsedSvgMetadata['viewBox'];
    alignBox?: { x: number; z: number; width: number; depth: number };
  }
): { walls: ExtractedWall[]; rooms: ExtractedRoom[]; openings: ExtractedOpening[] } {
  if (segments.length === 0) return { walls: [], rooms: [], openings: [] };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  segments.forEach((s) => {
    minX = Math.min(minX, s.x1, s.x2);
    maxX = Math.max(maxX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxY = Math.max(maxY, s.y1, s.y2);
  });

  let tx: (x: number) => number;
  let tz: (y: number) => number;
  let boundMinX: number;
  let boundMaxX: number;
  let boundMinZ: number;
  let boundMaxZ: number;

  if (options?.viewBox && options?.alignBox) {
    // 1:1 exact alignment with the rendered ReferencePlan rectangle on the floor!
    const vb = options.viewBox;
    const box = options.alignBox;
    const sx = box.width / Math.max(1e-3, vb.width);
    const sz = box.depth / Math.max(1e-3, vb.height);
    tx = (x: number) => Number((box.x + (x - vb.x) * sx).toFixed(2));
    tz = (y: number) => Number((box.z + (y - vb.y) * sz).toFixed(2));
    boundMinX = tx(minX);
    boundMaxX = tx(maxX);
    boundMinZ = tz(minY);
    boundMaxZ = tz(maxY);
  } else {
    const rawW = Math.max(1, maxX - minX);
    const rawH = Math.max(1, maxY - minY);
    const pad = 1.2;
    const usableW = Math.max(4, targetWidthM - pad * 2);
    const usableD = Math.max(4, targetDepthM - pad * 2);
    const scale = Math.min(usableW / rawW, usableD / rawH);
    tx = (x: number) => Number((pad + (x - minX) * scale).toFixed(2));
    tz = (y: number) => Number((pad + (y - minY) * scale).toFixed(2));
    boundMinX = pad;
    boundMaxX = pad + rawW * scale;
    boundMinZ = pad;
    boundMaxZ = pad + rawH * scale;
  }

  // Convert segments into metric space & collapse near-parallel double-line CAD walls
  const deduped: ExtractedWall[] = [];
  const near = (a: number, b: number, tol = 0.16) => Math.abs(a - b) <= tol;

  segments.forEach((s, idx) => {
    const x1 = tx(s.x1);
    const z1 = tz(s.y1);
    const x2 = tx(s.x2);
    const z2 = tz(s.y2);
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.35) return;

    // Check exact duplicate OR close parallel double-line wall (<0.32m separation with >70% overlap)
    const existingIdx = deduped.findIndex((w) => {
      if (
        (near(w.x1, x1) && near(w.z1, z1) && near(w.x2, x2) && near(w.z2, z2)) ||
        (near(w.x1, x2) && near(w.z1, z2) && near(w.x2, x1) && near(w.z2, z1))
      ) {
        return true;
      }
      // Horizontal double-line wall collapse
      const wHoriz = Math.abs(w.z1 - w.z2) < 0.08;
      const sHoriz = Math.abs(z1 - z2) < 0.08;
      if (wHoriz && sHoriz && Math.abs((w.z1 + w.z2) / 2 - (z1 + z2) / 2) < 0.32) {
        const wMin = Math.min(w.x1, w.x2);
        const wMax = Math.max(w.x1, w.x2);
        const sMin = Math.min(x1, x2);
        const sMax = Math.max(x1, x2);
        const overlap = Math.min(wMax, sMax) - Math.max(wMin, sMin);
        if (overlap > Math.min(wMax - wMin, sMax - sMin) * 0.72) return true;
      }
      // Vertical double-line wall collapse
      const wVert = Math.abs(w.x1 - w.x2) < 0.08;
      const sVert = Math.abs(x1 - x2) < 0.08;
      if (wVert && sVert && Math.abs((w.x1 + w.x2) / 2 - (x1 + x2) / 2) < 0.32) {
        const wMin = Math.min(w.z1, w.z2);
        const wMax = Math.max(w.z1, w.z2);
        const sMin = Math.min(z1, z2);
        const sMax = Math.max(z1, z2);
        const overlap = Math.min(wMax, sMax) - Math.max(wMin, sMin);
        if (overlap > Math.min(wMax - wMin, sMax - sMin) * 0.72) return true;
      }
      return false;
    });

    const onPerimeter =
      (near(x1, boundMinX, 0.35) && near(x2, boundMinX, 0.35)) ||
      (near(z1, boundMinZ, 0.35) && near(z2, boundMinZ, 0.35)) ||
      (near(x1, boundMaxX, 0.35) && near(x2, boundMaxX, 0.35)) ||
      (near(z1, boundMaxZ, 0.35) && near(z2, boundMaxZ, 0.35));

    const presetId: WallPresetId = s.isGlassHint
      ? 'full-glass-wall'
      : s.isExteriorHint || onPerimeter
        ? 'exterior-structural'
        : 'cleanroom-panel';

    const wallObj: ExtractedWall = {
      x1,
      z1,
      x2,
      z2,
      presetId,
      name: s.isGlassHint
        ? `Full Glass Wall ${idx + 1}`
        : onPerimeter
          ? `Exterior Envelope ${idx + 1}`
          : `Interior Wall ${idx + 1}`,
      isExterior: onPerimeter && !s.isGlassHint,
    };

    if (existingIdx >= 0) {
      if (s.isGlassHint) deduped[existingIdx] = wallObj;
    } else {
      deduped.push(wallObj);
    }
  });

  // Estimate room bounding regions around each OCR text label OR auto-synthesize rooms from grid cells when SVG has no <text> labels
  const rooms: ExtractedRoom[] = [];
  const xStops = Array.from(
    new Set(
      deduped
        .filter((w) => Math.abs(w.x1 - w.x2) < 0.35)
        .map((w) => Number(((w.x1 + w.x2) / 2).toFixed(2)))
    )
  ).sort((a, b) => a - b);
  const zStops = Array.from(
    new Set(
      deduped
        .filter((w) => Math.abs(w.z1 - w.z2) < 0.35)
        .map((w) => Number(((w.z1 + w.z2) / 2).toFixed(2)))
    )
  ).sort((a, b) => a - b);

  // Cluster stops within 0.6m so jittery CAD vertices don't create micro-sliver rooms
  const clusterStops = (arr: number[]) => {
    const out: number[] = [];
    for (const v of arr) {
      if (out.length === 0 || v - out[out.length - 1] >= 1.2) {
        out.push(v);
      }
    }
    return out;
  };
  const cxStops = clusterStops(xStops);
  const czStops = clusterStops(zStops);

  if (labels.length > 0) {
    labels.forEach((lbl, idx) => {
      const lx = tx(lbl.x);
      const lz = tz(lbl.y);
      const leftX = [...cxStops].reverse().find((x) => x <= lx + 0.15) ?? boundMinX;
      const rightX = cxStops.find((x) => x > lx + 0.15) ?? boundMaxX;
      const topZ = [...czStops].reverse().find((z) => z <= lz + 0.15) ?? boundMinZ;
      const botZ = czStops.find((z) => z > lz + 0.15) ?? boundMaxZ;
      const rw = Math.max(2.2, Number((rightX - leftX).toFixed(2)));
      const rd = Math.max(2.2, Number((botZ - topZ).toFixed(2)));
      const tokens = lbl.text.split(/\s+/);
      const looksLikeCode = /^[A-Z0-9-]{2,8}$/i.test(tokens[0]) && /\d/.test(tokens[0]);
      const code = looksLikeCode ? tokens[0].toUpperCase() : `RM-${String(idx + 101)}`;
      const name = looksLikeCode && tokens.length > 1 ? tokens.slice(1).join(' ') : lbl.text;
      rooms.push({
        code,
        name,
        x: Number(leftX.toFixed(2)),
        z: Number(topZ.toFixed(2)),
        width: rw,
        depth: rd,
      });
    });
  } else if (cxStops.length >= 2 && czStops.length >= 2) {
    // Auto-create interior room footprints from detected wall grid cells (cap to 12 cleanest zones)
    let roomIdx = 1;
    for (let xi = 0; xi < cxStops.length - 1 && roomIdx <= 12; xi++) {
      for (let zi = 0; zi < czStops.length - 1 && roomIdx <= 12; zi++) {
        const rx = cxStops[xi];
        const rz = czStops[zi];
        const rw = Number((cxStops[xi + 1] - rx).toFixed(2));
        const rd = Number((czStops[zi + 1] - rz).toFixed(2));
        if (rw >= 2.2 && rd >= 2.2) {
          rooms.push({
            code: `RM-${100 + roomIdx}`,
            name: `CAD Zone ${roomIdx}`,
            x: rx,
            z: rz,
            width: rw,
            depth: rd,
          });
          roomIdx++;
        }
      }
    }
  } else {
    // Fallback single floor room matching the extracted wall footprint
    const rw = Math.max(4, Number((boundMaxX - boundMinX).toFixed(2)));
    const rd = Math.max(4, Number((boundMaxZ - boundMinZ).toFixed(2)));
    rooms.push({
      code: 'RM-101',
      name: 'Main Plan Suite',
      x: Number(boundMinX.toFixed(2)),
      z: Number(boundMinZ.toFixed(2)),
      width: rw,
      depth: rd,
    });
  }

  // Auto-propose doors on interior walls and observation windows on exterior walls
  const openings: ExtractedOpening[] = [];
  deduped.forEach((w, wallIdx) => {
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
    if (len < 2.1) return;
    if (w.presetId === 'full-glass-wall') {
      openings.push({
        wallIndex: wallIdx,
        offsetRatio: 0.5,
        kind: 'door',
        subtype: 'glass-door',
        width: 1.15,
        height: 2.3,
        sillHeight: 0,
        name: `Glass Entry Door ${openings.length + 1}`,
      });
    } else if (w.isExterior && len >= 4.2) {
      openings.push({
        wallIndex: wallIdx,
        offsetRatio: 0.5,
        kind: 'window',
        subtype: 'double-glazing',
        width: Math.min(3.0, Number((len * 0.32).toFixed(2))),
        height: 1.5,
        sillHeight: 0.9,
        name: `Exterior Window ${openings.length + 1}`,
      });
    } else if (!w.isExterior && len >= 2.5) {
      openings.push({
        wallIndex: wallIdx,
        offsetRatio: 0.5,
        kind: 'door',
        subtype: 'cleanroom-door',
        width: 1.1,
        height: 2.2,
        sillHeight: 0,
        name: `Interior Door ${openings.length + 1}`,
      });
    }
  });

  return { walls: deduped, rooms, openings };
}
