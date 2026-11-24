import * as THREE from 'three';
import type { MaterialDef } from '../types/twin';

const textureCache = new Map<string, THREE.Texture>();

function createCanvasTexture(
  key: string,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeat = 2,
  maxAnisotropy = 4
): THREE.CanvasTexture {
  const cached = textureCache.get(key);
  if (cached) return cached as THREE.CanvasTexture;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  textureCache.set(key, tex);
  return tex;
}

export function getProceduralMaterial(
  matDef: MaterialDef,
  tintHex?: string,
  maxAnisotropy = 4,
  isSoftwareGl = false
): THREE.MeshStandardMaterial {
  const color = tintHex || matDef.baseColor;
  const key = `${matDef.id}_${color}_${matDef.pattern}_${matDef.uvScale}_${matDef.customTextureDataUrl ? 'custom' : 'proc'}`;

  let map: THREE.Texture | null = null;

  if (matDef.customTextureDataUrl) {
    const existing = textureCache.get(key);
    if (existing) {
      map = existing;
    } else {
      const loader = new THREE.TextureLoader();
      const loaded = loader.load(matDef.customTextureDataUrl);
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.wrapS = THREE.RepeatWrapping;
      loaded.wrapT = THREE.RepeatWrapping;
      loaded.repeat.set(matDef.uvScale || 2, matDef.uvScale || 2);
      loaded.anisotropy = maxAnisotropy;
      textureCache.set(key, loaded);
      map = loaded;
    }
  } else if (matDef.pattern !== 'solid' && matDef.pattern !== 'glass') {
    map = createCanvasTexture(
      key,
      (ctx, size) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, size, size);

        if (matDef.pattern === 'epoxy-speckle') {
          for (let i = 0; i < 420; i++) {
            const x = (i * 73) % size;
            const y = (i * 139) % size;
            ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.08)';
            ctx.fillRect(x, y, 2, 2);
          }
          ctx.strokeStyle = 'rgba(15,23,42,0.06)';
          ctx.lineWidth = 1;
          ctx.strokeRect(1, 1, size - 2, size - 2);
        } else if (matDef.pattern === 'cleanroom-panel') {
          ctx.strokeStyle = 'rgba(100,116,139,0.25)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(size / 2, 0);
          ctx.lineTo(size / 2, size);
          ctx.moveTo(0, size - 2);
          ctx.lineTo(size, size - 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(2, 2, size / 2 - 4, size - 6);
        } else if (matDef.pattern === 'brushed-metal') {
          for (let y = 0; y < size; y += 2) {
            const alpha = ((y * 17) % 10) * 0.012;
            ctx.fillStyle = y % 4 === 0 ? `rgba(255,255,255,${alpha})` : `rgba(15,23,42,${alpha})`;
            ctx.fillRect(0, y, size, 1);
          }
        } else if (matDef.pattern === 'concrete') {
          for (let i = 0; i < 650; i++) {
            const x = (i * 97) % size;
            const y = (i * 53) % size;
            ctx.fillStyle = i % 3 === 0 ? 'rgba(15,23,42,0.09)' : 'rgba(255,255,255,0.07)';
            ctx.fillRect(x, y, 3, 3);
          }
          ctx.strokeStyle = 'rgba(15,23,42,0.12)';
          ctx.lineWidth = 1;
          ctx.strokeRect(0, 0, size, size);
        } else if (matDef.pattern === 'tile-grid') {
          ctx.strokeStyle = 'rgba(71,85,105,0.22)';
          ctx.lineWidth = 2;
          const step = size / 4;
          for (let i = 0; i <= 4; i++) {
            ctx.beginPath();
            ctx.moveTo(i * step, 0);
            ctx.lineTo(i * step, size);
            ctx.moveTo(0, i * step);
            ctx.lineTo(size, i * step);
            ctx.stroke();
          }
        } else if (matDef.pattern === 'brick') {
          const rows = 8;
          const rowH = size / rows;
          const brickW = size / 4;
          ctx.strokeStyle = 'rgba(241,245,249,0.45)';
          ctx.lineWidth = 2;
          for (let r = 0; r < rows; r++) {
            const offset = r % 2 === 0 ? 0 : brickW / 2;
            ctx.beginPath();
            ctx.moveTo(0, r * rowH);
            ctx.lineTo(size, r * rowH);
            ctx.stroke();
            for (let c = -1; c <= 4; c++) {
              ctx.beginPath();
              ctx.moveTo(c * brickW + offset, r * rowH);
              ctx.lineTo(c * brickW + offset, (r + 1) * rowH);
              ctx.stroke();
            }
          }
        } else if (matDef.pattern === 'wood-grain') {
          for (let y = 0; y < size; y += 3) {
            ctx.fillStyle = y % 6 === 0 ? 'rgba(69,39,14,0.11)' : 'rgba(255,237,213,0.08)';
            ctx.fillRect(0, y, size, 2);
          }
        } else if (matDef.pattern === 'industrial-coat') {
          for (let i = 0; i < 300; i++) {
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fillRect((i * 41) % size, (i * 89) % size, 2, 2);
          }
        }
      },
      matDef.uvScale || 2,
      maxAnisotropy
    );
  }

  const isGlass = matDef.pattern === 'glass' || matDef.opacity < 0.95;

  return new THREE.MeshStandardMaterial({
    color: map ? '#ffffff' : color,
    map: map ?? undefined,
    roughness: isSoftwareGl ? Math.max(0.15, matDef.roughness) : matDef.roughness,
    metalness: matDef.metalness,
    transparent: isGlass,
    opacity: matDef.opacity,
    depthWrite: !isGlass,
  });
}

export function disposeCachedTextures() {
  textureCache.forEach((tex) => tex.dispose());
  textureCache.clear();
}
