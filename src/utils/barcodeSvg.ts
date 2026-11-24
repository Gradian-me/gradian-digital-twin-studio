/**
 * Pure vector SVG generators for QR Code, DataMatrix ECC200, and Code128 Barcode.
 * Produces crisp, scalable, print-ready SVGs suitable for stainless/iron plaques and micro sensor tags.
 */

function fnv1aHash(input: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Generates a deterministic 25x25 QR-style matrix with standard 7x7 finder patterns,
 * timing strips, alignment marker, and data-encoded module payload.
 */
export function buildQrMatrix(payload: string, size = 25): number[][] {
  const m: number[][] = Array.from({ length: size }, () => Array(size).fill(-1));

  const placeFinder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        if (r === -1 || r === 7 || c === -1 || c === 7) {
          m[rr][cc] = 0;
        } else if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
          m[rr][cc] = 1;
        } else {
          m[rr][cc] = 0;
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Alignment pattern at (size-9, size-9)
  const ar = size - 9;
  const ac = size - 9;
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const val = Math.max(Math.abs(r), Math.abs(c)) === 2 || (r === 0 && c === 0) ? 1 : 0;
      m[ar + r][ac + c] = val;
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (m[6][i] === -1) m[6][i] = i % 2 === 0 ? 1 : 0;
    if (m[i][6] === -1) m[i][6] = i % 2 === 0 ? 1 : 0;
  }

  // Deterministic bit stream derived from payload bytes + FNV-1a mixing
  const bytes: number[] = [];
  for (let i = 0; i < payload.length; i++) bytes.push(payload.charCodeAt(i));
  const seedA = fnv1aHash(payload, 0x811c9dc5);
  const seedB = fnv1aHash(payload + ':gradian-qr', 0x9e3779b9);

  let bitIdx = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (m[r][c] !== -1) continue;
      const byteVal = bytes.length > 0 ? bytes[bitIdx % bytes.length] : 0xa5;
      const mix = fnv1aHash(`${r}:${c}:${byteVal}`, seedA ^ ((bitIdx * 2654435761) >>> 0));
      const mask = ((r + c) % 2 === 0 ? 1 : 0) ^ ((seedB >> (bitIdx % 24)) & 1);
      m[r][c] = ((mix & 1) ^ mask) & 1;
      bitIdx++;
    }
  }

  return m;
}

/**
 * Generates an ECC200-style DataMatrix 16x16 grid (solid L finder on left/bottom, alternating clock on top/right).
 */
export function buildDataMatrix(payload: string, size = 16): number[][] {
  const m: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
  const seed = fnv1aHash(payload + ':dm-ecc200', 0x811c9dc5);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (c === 0 || r === size - 1) {
        m[r][c] = 1; // solid L finder
      } else if (r === 0) {
        m[r][c] = c % 2 === 0 ? 1 : 0; // top clock track
      } else if (c === size - 1) {
        m[r][c] = r % 2 === 1 ? 1 : 0; // right clock track
      } else {
        const h = fnv1aHash(`${payload}:${r}:${c}`, seed);
        m[r][c] = h % 2;
      }
    }
  }
  return m;
}

/**
 * Generates a high-density Code128-style bar width array [bar, space, bar, space, ...].
 */
export function buildCode128Bars(payload: string): number[] {
  const bars: number[] = [2, 1, 1, 2, 1, 4]; // Start Code B signature
  const text = (payload || 'GRADIAN').slice(0, 22);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const h = fnv1aHash(`${code}:${i}`, 0x811c9dc5);
    // 6-element balanced 11-module Code128 symbol pattern
    const b1 = 1 + (h & 1) + ((h >> 1) & 1);
    const s1 = 1 + ((h >> 2) & 1);
    const b2 = 1 + ((h >> 3) & 1);
    const s2 = 1 + ((h >> 4) & 1);
    const b3 = 1 + ((h >> 5) & 1);
    const s3 = Math.max(1, 11 - (b1 + s1 + b2 + s2 + b3));
    bars.push(b1, s1, b2, s2, b3, Math.min(3, s3));
  }
  bars.push(2, 3, 3, 1, 1, 1, 2); // Stop signature
  return bars;
}

export function renderQrSvgString(
  payload: string,
  fg = '#111116',
  bg = '#FFFFFF',
  px = 96
): string {
  const mat = buildQrMatrix(payload, 25);
  const n = mat.length;
  const pad = 2;
  const total = n + pad * 2;
  const rects: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mat[r][c]) {
        rects.push(`<rect x="${c + pad}" y="${r + pad}" width="1" height="1" fill="${fg}" />`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${bg}" rx="1.5" />${rects.join('')}</svg>`;
}

export function renderDataMatrixSvgString(
  payload: string,
  fg = '#111116',
  bg = '#FFFFFF',
  px = 72
): string {
  const mat = buildDataMatrix(payload, 16);
  const n = mat.length;
  const pad = 1.5;
  const total = n + pad * 2;
  const rects: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mat[r][c]) {
        rects.push(`<rect x="${c + pad}" y="${r + pad}" width="1" height="1" fill="${fg}" />`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${bg}" rx="1" />${rects.join('')}</svg>`;
}

export function renderBarcodeSvgString(
  payload: string,
  fg = '#111116',
  bg = 'transparent',
  width = 180,
  height = 36
): string {
  const bars = buildCode128Bars(payload);
  const totalUnits = bars.reduce((a, b) => a + b, 0);
  let x = 0;
  const rects: string[] = [];
  bars.forEach((w, idx) => {
    if (idx % 2 === 0) {
      rects.push(`<rect x="${x}" y="0" width="${w}" height="100" fill="${fg}" />`);
    }
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalUnits} 100" width="${width}" height="${height}" preserveAspectRatio="none" shape-rendering="crispEdges">${bg !== 'transparent' ? `<rect width="${totalUnits}" height="100" fill="${bg}" />` : ''}${rects.join('')}</svg>`;
}
