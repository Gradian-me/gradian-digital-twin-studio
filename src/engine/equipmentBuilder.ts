import * as THREE from 'three';
import type { SpatialAsset } from '../types/twin';

// Shared lightweight reusable PBR materials for composite industrial equipment sub-details
const MAT_DARK_STEEL = new THREE.MeshStandardMaterial({ color: '#1C1E26', roughness: 0.42, metalness: 0.76 });
const MAT_BRUSHED_STEEL = new THREE.MeshStandardMaterial({ color: '#D4DCE6', roughness: 0.22, metalness: 0.88 });
const MAT_CHROME = new THREE.MeshPhysicalMaterial({
  color: '#F4F7FA',
  roughness: 0.11,
  metalness: 0.95,
  clearcoat: 0.65,
  clearcoatRoughness: 0.08,
});
const MAT_COPPER_FITTING = new THREE.MeshStandardMaterial({ color: '#D97706', roughness: 0.26, metalness: 0.88 });
const MAT_GLASS = new THREE.MeshPhysicalMaterial({
  color: '#D8F1FF',
  roughness: 0.05,
  metalness: 0.04,
  ior: 1.52,
  reflectivity: 0.92,
  clearcoat: 1.0,
  clearcoatRoughness: 0.04,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
});
const MAT_MEDIA_FLUID = new THREE.MeshStandardMaterial({
  color: '#F59E0B',
  emissive: '#D97706',
  emissiveIntensity: 0.34,
  roughness: 0.14,
  metalness: 0.06,
  transparent: true,
  opacity: 0.72,
});
const MAT_SCREEN = new THREE.MeshStandardMaterial({
  color: '#A78BFA',
  emissive: '#7C3AED',
  emissiveIntensity: 0.92,
  roughness: 0.14,
  metalness: 0.1,
});
const MAT_ACCENT_BLUE = new THREE.MeshStandardMaterial({ color: '#7C3AED', roughness: 0.36, metalness: 0.38 });
const MAT_ACCENT_AMBER = new THREE.MeshStandardMaterial({
  color: '#F59E0B',
  emissive: '#B45309',
  emissiveIntensity: 0.38,
  roughness: 0.34,
  metalness: 0.26,
});
const MAT_ACCENT_RED = new THREE.MeshStandardMaterial({
  color: '#DC2626',
  emissive: '#991B1B',
  emissiveIntensity: 0.32,
  roughness: 0.38,
  metalness: 0.22,
});
const MAT_ACCENT_GREEN = new THREE.MeshStandardMaterial({
  color: '#10B981',
  emissive: '#059669',
  emissiveIntensity: 0.55,
  roughness: 0.32,
  metalness: 0.2,
});
const MAT_RUBBER = new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.88, metalness: 0.06 });
const MAT_PALLET_BOX = new THREE.MeshStandardMaterial({ color: '#D4B483', roughness: 0.78, metalness: 0.02 });

let cachedContactShadowMat: THREE.MeshBasicMaterial | null = null;
function getContactShadowMaterial(): THREE.MeshBasicMaterial {
  if (cachedContactShadowMat) return cachedContactShadowMat;
  let tex: THREE.CanvasTexture | null = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 6, 32, 32, 30);
      grad.addColorStop(0, 'rgba(0,0,0,0.42)');
      grad.addColorStop(0.65, 'rgba(0,0,0,0.18)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
      tex = new THREE.CanvasTexture(c);
    }
  }
  cachedContactShadowMat = new THREE.MeshBasicMaterial({
    map: tex ?? undefined,
    color: '#000000',
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  return cachedContactShadowMat;
}
const SHARED_SHADOW_GEO = new THREE.PlaneGeometry(1, 1);

function addMesh(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0
) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/**
 * Builds a composite 10-22 part procedural 3D industrial/biopharma model
 * with bottom-center pivot at y = 0 matching the asset's real-world dimensions.
 */
export function buildProceduralEquipmentGroup(
  asset: SpatialAsset,
  primaryMat: THREE.Material,
  isSelected: boolean,
  statusTint?: string | null
): THREE.Group {
  const group = new THREE.Group();
  const { width: W, depth: D, height: H, archetype } = asset;

  const bodyMat = statusTint
    ? new THREE.MeshStandardMaterial({ color: statusTint, roughness: 0.28, metalness: 0.62 })
    : primaryMat;

  switch (archetype) {
    case 'bioreactor-ss':
    case 'bioreactor-su': {
      const r = Math.min(W, D) * 0.34;
      const skidH = 0.14;
      const vx = -W * 0.12;
      // 1. Stainless base skid platform + vibration isolation feet
      addMesh(group, new THREE.BoxGeometry(W * 0.94, skidH, D * 0.94), MAT_DARK_STEEL, 0, skidH / 2 + 0.04, 0);
      for (const fx of [-W * 0.42, W * 0.42]) {
        for (const fz of [-D * 0.42, D * 0.42]) {
          addMesh(group, new THREE.CylinderGeometry(0.06, 0.08, 0.05, 10), MAT_RUBBER, fx, 0.025, fz);
        }
      }
      // 2. Main cylindrical jacketed 316L vessel with stepped cooling jacket collar
      const cylH = H * 0.54;
      const vesselY = skidH + 0.38 + cylH / 2;
      addMesh(group, new THREE.CylinderGeometry(r, r, cylH, 32), bodyMat, vx, vesselY, 0);
      addMesh(group, new THREE.CylinderGeometry(r * 1.045, r * 1.045, cylH * 0.64, 32), MAT_BRUSHED_STEEL, vx, vesselY - cylH * 0.06, 0);
      // 3. Top & bottom torispherical flanged heads + sanitary weld rings
      const topDome = addMesh(group, new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), MAT_CHROME, vx, vesselY + cylH / 2, 0);
      topDome.scale.y = 0.62;
      const botDome = addMesh(group, new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bodyMat, vx, vesselY - cylH / 2, 0);
      botDome.scale.y = 0.58;
      addMesh(group, new THREE.TorusGeometry(r * 1.03, 0.032, 10, 32), MAT_CHROME, vx, vesselY + cylH / 2, 0, Math.PI / 2, 0, 0);
      addMesh(group, new THREE.TorusGeometry(r * 1.03, 0.028, 10, 32), MAT_CHROME, vx, vesselY - cylH / 2, 0, Math.PI / 2, 0, 0);
      // 4. Four tubular stainless support legs with load-cell pads
      for (const lx of [-1, 1]) {
        for (const lz of [-1, 1]) {
          addMesh(group, new THREE.CylinderGeometry(0.05, 0.055, 0.64, 12), MAT_CHROME, vx + lx * r * 0.72, skidH + 0.34, lz * r * 0.72);
          addMesh(group, new THREE.CylinderGeometry(0.085, 0.085, 0.04, 12), MAT_COPPER_FITTING, vx + lx * r * 0.72, skidH + 0.06, lz * r * 0.72);
        }
      }
      // 5. Overhead servo agitator motor + finned gearbox + sterile seal housing
      const motorBaseY = vesselY + cylH / 2 + r * 0.62;
      addMesh(group, new THREE.CylinderGeometry(r * 0.24, r * 0.3, 0.14, 16), MAT_CHROME, vx, motorBaseY, 0);
      addMesh(group, new THREE.CylinderGeometry(r * 0.22, r * 0.22, H * 0.16, 18), MAT_DARK_STEEL, vx, motorBaseY + 0.07 + H * 0.08, 0);
      addMesh(group, new THREE.CylinderGeometry(r * 0.14, r * 0.18, 0.09, 16), MAT_ACCENT_AMBER, vx, motorBaseY + 0.12 + H * 0.16, 0);
      // 6. Armored sight-glass viewport with amber culture media luminescence
      addMesh(group, new THREE.BoxGeometry(r * 0.24, cylH * 0.46, 0.06), MAT_DARK_STEEL, vx, vesselY, r * 0.99);
      addMesh(group, new THREE.BoxGeometry(r * 0.16, cylH * 0.38, 0.08), MAT_MEDIA_FLUID, vx, vesselY - 0.03, r * 1.0);
      addMesh(group, new THREE.BoxGeometry(r * 0.18, cylH * 0.42, 0.09), MAT_GLASS, vx, vesselY, r * 1.01);
      // 7. Side SCADA / PLC automation control tower with bevelled screen & status beacon
      const cabW = W * 0.28;
      const cabH = H * 0.66;
      addMesh(group, new THREE.BoxGeometry(cabW, cabH, D * 0.44), MAT_BRUSHED_STEEL, W * 0.3, skidH + 0.04 + cabH / 2, 0);
      addMesh(group, new THREE.BoxGeometry(cabW * 0.84, cabH * 0.32, 0.05), MAT_DARK_STEEL, W * 0.3, skidH + cabH * 0.7, D * 0.22);
      addMesh(group, new THREE.BoxGeometry(cabW * 0.74, cabH * 0.24, 0.06), MAT_SCREEN, W * 0.3, skidH + cabH * 0.7, D * 0.225);
      // Status stack light pole on cabinet roof
      addMesh(group, new THREE.CylinderGeometry(0.02, 0.02, 0.26, 8), MAT_CHROME, W * 0.3, skidH + cabH + 0.17, 0);
      addMesh(group, new THREE.CylinderGeometry(0.045, 0.045, 0.08, 12), MAT_ACCENT_GREEN, W * 0.3, skidH + cabH + 0.31, 0);
      // 8. Sanitary tri-clamp transfer manifold pipes + pressure gauge
      addMesh(group, new THREE.CylinderGeometry(0.036, 0.036, W * 0.38, 12), MAT_CHROME, W * 0.09, vesselY + cylH * 0.34, 0, 0, 0, Math.PI / 2);
      addMesh(group, new THREE.CylinderGeometry(0.032, 0.032, W * 0.38, 12), MAT_CHROME, W * 0.09, vesselY - cylH * 0.26, 0.14, 0, 0, Math.PI / 2);
      addMesh(group, new THREE.CylinderGeometry(0.06, 0.06, 0.04, 14), MAT_ACCENT_AMBER, vx + r * 0.58, motorBaseY + 0.06, r * 0.35, Math.PI / 2, 0, 0);
      break;
    }

    case 'vessel-tank': {
      const r = Math.min(W, D) * 0.42;
      const legH = 0.44;
      const cylH = Math.max(0.5, H - legH - r * 0.78);
      const cy = legH + cylH / 2;
      addMesh(group, new THREE.CylinderGeometry(r, r, cylH, 28), bodyMat, 0, cy, 0);
      const top = addMesh(group, new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), MAT_CHROME, 0, cy + cylH / 2, 0);
      top.scale.y = 0.65;
      addMesh(group, new THREE.TorusGeometry(r * 1.02, 0.03, 10, 28), MAT_CHROME, 0, cy + cylH / 2, 0, Math.PI / 2, 0, 0);
      addMesh(group, new THREE.ConeGeometry(r, 0.32, 24), bodyMat, 0, legH - 0.12, 0, Math.PI, 0, 0);
      for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        addMesh(group, new THREE.CylinderGeometry(0.05, 0.055, legH + 0.14, 10), MAT_DARK_STEEL, Math.cos(a) * r * 0.78, (legH + 0.14) / 2, Math.sin(a) * r * 0.78);
      }
      addMesh(group, new THREE.CylinderGeometry(0.15, 0.15, 0.24, 14), MAT_DARK_STEEL, 0, cy + cylH / 2 + r * 0.72, 0);
      addMesh(group, new THREE.BoxGeometry(0.1, cylH * 0.52, 0.08), MAT_ACCENT_BLUE, 0, cy, r * 0.96);
      break;
    }

    case 'chromatography-skid':
    case 'filtration-skid': {
      // Stainless mobile skid frame + casters
      addMesh(group, new THREE.BoxGeometry(W, 0.16, D), MAT_DARK_STEEL, 0, 0.12, 0);
      for (const cx of [-W * 0.42, W * 0.42]) {
        for (const cz of [-D * 0.42, D * 0.42]) {
          addMesh(group, new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), MAT_RUBBER, cx, 0.04, cz, 0, 0, Math.PI / 2);
        }
      }
      addMesh(group, new THREE.BoxGeometry(W * 0.92, H * 0.38, D * 0.8), bodyMat, 0, 0.2 + H * 0.19, 0);
      // Dual acrylic/borosilicate resin columns with stainless end-adapters & amber resin bed
      const colR = Math.min(W, D) * 0.16;
      const colH = H * 0.54;
      for (const ox of [-W * 0.24, W * 0.06]) {
        addMesh(group, new THREE.CylinderGeometry(colR * 0.86, colR * 0.86, colH * 0.76, 18), MAT_MEDIA_FLUID, ox, H * 0.42 + colH * 0.46, 0);
        addMesh(group, new THREE.CylinderGeometry(colR, colR, colH, 20), MAT_GLASS, ox, H * 0.42 + colH / 2, 0);
        addMesh(group, new THREE.CylinderGeometry(colR * 1.18, colR * 1.18, 0.08, 20), MAT_CHROME, ox, H * 0.42 + colH, 0);
        addMesh(group, new THREE.CylinderGeometry(colR * 1.18, colR * 1.18, 0.08, 20), MAT_CHROME, ox, H * 0.42, 0);
        // Tie rods
        for (const a of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
          addMesh(group, new THREE.CylinderGeometry(0.014, 0.014, colH, 6), MAT_CHROME, ox + Math.cos(a) * colR * 1.08, H * 0.42 + colH / 2, Math.sin(a) * colR * 1.08);
        }
      }
      // Overhead valve manifold bridge
      addMesh(group, new THREE.CylinderGeometry(0.032, 0.032, W * 0.55, 10), MAT_CHROME, -W * 0.08, H * 0.42 + colH + 0.12, 0, 0, 0, Math.PI / 2);
      // Control HMI tower on right
      addMesh(group, new THREE.BoxGeometry(W * 0.24, H * 0.76, D * 0.56), MAT_BRUSHED_STEEL, W * 0.34, 0.18 + H * 0.38, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.18, H * 0.24, 0.05), MAT_SCREEN, W * 0.34, H * 0.68, D * 0.29);
      break;
    }

    case 'filling-line':
    case 'isolator': {
      const baseH = H * 0.38;
      const glassH = H * 0.4;
      const hoodH = H * 0.22;
      // Lower stainless machine plinth + inspection panel trims
      addMesh(group, new THREE.BoxGeometry(W, baseH, D), bodyMat, 0, baseH / 2, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.96, 0.08, D * 1.01), MAT_DARK_STEEL, 0, 0.04, 0);
      // Corner mullions
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          addMesh(group, new THREE.BoxGeometry(0.09, glassH, 0.09), MAT_DARK_STEEL, sx * (W / 2 - 0.06), baseH + glassH / 2, sz * (D / 2 - 0.06));
        }
      }
      // Crystal isolator glass chamber
      addMesh(group, new THREE.BoxGeometry(W * 0.94, glassH, D * 0.92), MAT_GLASS, 0, baseH + glassH / 2, 0);
      // Internal stainless rotary filling starwheels + dosing needles
      const count = Math.max(2, Math.floor(W / 1.2));
      for (let i = 0; i < count; i++) {
        const px = -W * 0.35 + (i / Math.max(1, count - 1)) * W * 0.7;
        addMesh(group, new THREE.CylinderGeometry(0.24, 0.28, 0.24, 20), MAT_CHROME, px, baseH + 0.12, 0);
        addMesh(group, new THREE.CylinderGeometry(0.05, 0.05, glassH * 0.55, 10), MAT_BRUSHED_STEEL, px, baseH + glassH * 0.62, 0);
      }
      // Overhead HEPA Grade A laminar plenum with status strip
      addMesh(group, new THREE.BoxGeometry(W, hoodH, D), MAT_BRUSHED_STEEL, 0, baseH + glassH + hoodH / 2, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.92, 0.035, 0.04), MAT_ACCENT_BLUE, 0, baseH + glassH + 0.04, D * 0.5);
      // Glove port oval rings on front glass
      const ports = Math.min(4, count + 1);
      for (let i = 0; i < ports; i++) {
        const px = -W * 0.35 + (i / Math.max(1, ports - 1)) * W * 0.7;
        addMesh(group, new THREE.TorusGeometry(0.12, 0.022, 10, 20), MAT_ACCENT_AMBER, px, baseH + glassH * 0.45, D * 0.47);
      }
      // Swivel Operator HMI arm + display
      addMesh(group, new THREE.BoxGeometry(0.46, 0.36, 0.06), MAT_DARK_STEEL, W * 0.42, baseH + 0.22, D * 0.52);
      addMesh(group, new THREE.BoxGeometry(0.4, 0.3, 0.07), MAT_SCREEN, W * 0.42, baseH + 0.22, D * 0.525);
      break;
    }

    case 'lyophilizer':
    case 'autoclave': {
      // Main stainless pressure chamber body with recessed flange bezel
      addMesh(group, new THREE.BoxGeometry(W * 0.72, H * 0.92, D * 0.88), bodyMat, -W * 0.12, H * 0.46, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.66, H * 0.78, 0.12), MAT_BRUSHED_STEEL, -W * 0.12, H * 0.48, D * 0.45);
      // Locking radial bolts & circular armored porthole
      addMesh(group, new THREE.TorusGeometry(0.25, 0.035, 12, 24), MAT_CHROME, -W * 0.12, H * 0.58, D * 0.51);
      addMesh(group, new THREE.CylinderGeometry(0.22, 0.22, 0.12, 20), MAT_GLASS, -W * 0.12, H * 0.58, D * 0.47, Math.PI / 2, 0, 0);
      addMesh(group, new THREE.BoxGeometry(0.05, 0.42, 0.08), MAT_ACCENT_AMBER, -W * 0.4, H * 0.48, D * 0.52);
      // Rear condenser / steam drum + relief manifold
      addMesh(group, new THREE.CylinderGeometry(D * 0.32, D * 0.32, H * 0.68, 22), MAT_DARK_STEEL, W * 0.3, H * 0.4, 0);
      addMesh(group, new THREE.CylinderGeometry(0.05, 0.05, H * 0.26, 10), MAT_CHROME, W * 0.3, H * 0.85, 0);
      // Side HMI control cabinet
      addMesh(group, new THREE.BoxGeometry(W * 0.24, H * 0.86, D * 0.46), MAT_DARK_STEEL, W * 0.36, H * 0.43, D * 0.22);
      addMesh(group, new THREE.BoxGeometry(W * 0.18, 0.34, 0.05), MAT_SCREEN, W * 0.36, H * 0.66, D * 0.46);
      break;
    }

    case 'biosafety-cabinet':
    case 'fume-hood': {
      addMesh(group, new THREE.BoxGeometry(W * 0.96, H * 0.36, D * 0.9), MAT_DARK_STEEL, 0, H * 0.18, 0);
      addMesh(group, new THREE.BoxGeometry(W, H * 0.6, D * 0.92), bodyMat, 0, H * 0.36 + H * 0.3, -D * 0.02);
      addMesh(group, new THREE.BoxGeometry(W * 0.88, H * 0.34, 0.05), MAT_GLASS, 0, H * 0.56, D * 0.44, -0.14, 0, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.9, 0.06, D * 0.84), MAT_CHROME, 0, H * 0.38, 0);
      addMesh(group, new THREE.CylinderGeometry(0.18, 0.22, 0.22, 16), MAT_CHROME, 0, H - 0.04, -D * 0.1);
      addMesh(group, new THREE.BoxGeometry(W * 0.54, 0.11, 0.05), MAT_SCREEN, 0, H * 0.84, D * 0.45);
      break;
    }

    case 'hplc-instrument': {
      // Lab anti-vibration bench base + dark phenolic top
      const deskH = 0.88;
      addMesh(group, new THREE.BoxGeometry(W, 0.065, D), MAT_DARK_STEEL, 0, deskH, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.92, deskH - 0.06, D * 0.84), bodyMat, 0, (deskH - 0.06) / 2, 0);
      // 4-tier modular UHPLC analytical tower (Quaternary Pump, Autosampler, Column Oven, DAD Detector)
      const modW = W * 0.44;
      const modD = D * 0.64;
      const tiers = [0.13, 0.28, 0.43, 0.56];
      tiers.forEach((ty, idx) => {
        addMesh(group, new THREE.BoxGeometry(modW, 0.125, modD), idx % 2 === 0 ? MAT_BRUSHED_STEEL : MAT_CHROME, -W * 0.2, deskH + ty, -D * 0.05);
        addMesh(group, new THREE.BoxGeometry(modW * 0.92, 0.018, 0.02), idx === 1 ? MAT_ACCENT_BLUE : MAT_DARK_STEEL, -W * 0.2, deskH + ty + 0.04, -D * 0.05 + modD * 0.51);
        addMesh(group, new THREE.BoxGeometry(0.05, 0.025, 0.02), idx === 0 ? MAT_ACCENT_GREEN : MAT_ACCENT_AMBER, -W * 0.2 + modW * 0.38, deskH + ty, -D * 0.05 + modD * 0.51);
      });
      // Solvent cabinet tray + 4 borosilicate mobile-phase carboys with amber/clear buffer
      addMesh(group, new THREE.BoxGeometry(modW * 0.98, 0.04, modD * 0.92), MAT_DARK_STEEL, -W * 0.2, deskH + 0.64, -D * 0.05);
      for (let i = 0; i < 4; i++) {
        const bx = -W * 0.34 + i * (modW * 0.22);
        addMesh(group, new THREE.CylinderGeometry(0.045, 0.048, 0.16, 12), i % 2 === 0 ? MAT_GLASS : MAT_MEDIA_FLUID, bx, deskH + 0.74, -D * 0.05);
        addMesh(group, new THREE.CylinderGeometry(0.022, 0.022, 0.035, 10), MAT_ACCENT_BLUE, bx, deskH + 0.835, -D * 0.05);
      }
      // Chromatography Data System (CDS) dual-bezel monitor + keyboard
      addMesh(group, new THREE.BoxGeometry(0.52, 0.34, 0.04), MAT_DARK_STEEL, W * 0.24, deskH + 0.34, -D * 0.12);
      addMesh(group, new THREE.BoxGeometry(0.46, 0.28, 0.045), MAT_SCREEN, W * 0.24, deskH + 0.34, -D * 0.115);
      addMesh(group, new THREE.BoxGeometry(0.07, 0.18, 0.07), MAT_DARK_STEEL, W * 0.24, deskH + 0.11, -D * 0.12);
      addMesh(group, new THREE.BoxGeometry(0.36, 0.02, 0.14), MAT_DARK_STEEL, W * 0.24, deskH + 0.045, D * 0.18);
      break;
    }

    case 'stability-chamber':
    case 'lab-freezer': {
      addMesh(group, new THREE.BoxGeometry(W, H * 0.92, D), bodyMat, 0, H * 0.46, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.94, H * 0.12, D * 0.94), MAT_DARK_STEEL, 0, H * 0.94, 0);
      addMesh(group, new THREE.BoxGeometry(0.06, H * 0.55, 0.08), MAT_CHROME, W * 0.38, H * 0.5, D * 0.51);
      if (archetype === 'stability-chamber') {
        addMesh(group, new THREE.BoxGeometry(W * 0.54, H * 0.52, 0.05), MAT_GLASS, -W * 0.06, H * 0.52, D * 0.505);
      }
      addMesh(group, new THREE.BoxGeometry(0.32, 0.14, 0.04), MAT_SCREEN, 0, H * 0.85, D * 0.51);
      break;
    }

    case 'lab-bench': {
      const topH = Math.min(0.92, H);
      addMesh(group, new THREE.BoxGeometry(W, 0.07, D), MAT_DARK_STEEL, 0, topH, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.9, topH - 0.12, D * 0.82), bodyMat, 0, (topH - 0.12) / 2 + 0.06, 0);
      if (H > 1.1) {
        addMesh(group, new THREE.BoxGeometry(0.08, H - topH, 0.08), MAT_CHROME, -W * 0.42, topH + (H - topH) / 2, 0);
        addMesh(group, new THREE.BoxGeometry(0.08, H - topH, 0.08), MAT_CHROME, W * 0.42, topH + (H - topH) / 2, 0);
        addMesh(group, new THREE.BoxGeometry(W * 0.9, 0.05, D * 0.35), MAT_CHROME, 0, H - 0.05, 0);
      }
      break;
    }

    case 'ahu-unit': {
      addMesh(group, new THREE.BoxGeometry(W, 0.18, D), MAT_DARK_STEEL, 0, 0.09, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.98, H * 0.84, D * 0.96), bodyMat, 0, 0.18 + H * 0.42, 0);
      for (const ox of [-W * 0.3, 0, W * 0.3]) {
        addMesh(group, new THREE.BoxGeometry(W * 0.24, H * 0.62, 0.06), MAT_BRUSHED_STEEL, ox, H * 0.52, D * 0.49);
        addMesh(group, new THREE.CylinderGeometry(0.14, 0.14, 0.08, 16), MAT_GLASS, ox, H * 0.62, D * 0.51, Math.PI / 2, 0, 0);
      }
      addMesh(group, new THREE.BoxGeometry(W * 0.24, 0.32, D * 0.55), MAT_CHROME, -W * 0.32, H, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.24, 0.32, D * 0.55), MAT_ACCENT_BLUE, W * 0.32, H, 0);
      break;
    }

    case 'chiller': {
      addMesh(group, new THREE.BoxGeometry(W, H * 0.52, D), MAT_DARK_STEEL, 0, H * 0.26, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.92, H * 0.36, D * 0.86), bodyMat, 0, H * 0.68, 0);
      // Axial cooling fan shrouds on top
      const fans = Math.max(2, Math.round(W / 1.1));
      for (let i = 0; i < fans; i++) {
        const fx = -W * 0.34 + (i / Math.max(1, fans - 1)) * W * 0.68;
        addMesh(group, new THREE.CylinderGeometry(D * 0.3, D * 0.34, 0.28, 16), MAT_CHROME, fx, H * 0.94, 0);
      }
      break;
    }

    case 'wfi-skid': {
      addMesh(group, new THREE.BoxGeometry(W, 0.16, D), MAT_DARK_STEEL, 0, 0.08, 0);
      // 4 vertical distillation columns
      const cols = 4;
      for (let i = 0; i < cols; i++) {
        const cx = -W * 0.34 + (i / (cols - 1)) * W * 0.52;
        addMesh(group, new THREE.CylinderGeometry(0.22, 0.22, H * 0.84, 16), bodyMat, cx, 0.16 + H * 0.42, 0);
      }
      // Header pipe across top
      addMesh(group, new THREE.CylinderGeometry(0.06, 0.06, W * 0.65, 10), MAT_CHROME, -W * 0.08, H * 0.92, 0, 0, 0, Math.PI / 2);
      // Automation cabinet
      addMesh(group, new THREE.BoxGeometry(W * 0.22, H * 0.72, D * 0.65), MAT_CHROME, W * 0.36, 0.16 + H * 0.36, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.16, 0.3, 0.04), MAT_SCREEN, W * 0.36, H * 0.62, D * 0.34);
      break;
    }

    case 'electrical-panel': {
      addMesh(group, new THREE.BoxGeometry(W, H, D), bodyMat, 0, H / 2, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.96, 0.12, D * 0.98), MAT_DARK_STEEL, 0, 0.06, 0);
      const bays = Math.max(2, Math.round(W / 0.75));
      for (let i = 0; i < bays; i++) {
        const bx = -W * 0.38 + (i / Math.max(1, bays - 1)) * W * 0.76;
        addMesh(group, new THREE.BoxGeometry(W / bays - 0.08, H * 0.82, 0.04), MAT_DARK_STEEL, bx, H * 0.52, D * 0.5);
        addMesh(group, new THREE.BoxGeometry(0.06, 0.16, 0.06), MAT_ACCENT_RED, bx + 0.12, H * 0.64, D * 0.53);
      }
      break;
    }

    case 'pallet-rack': {
      // 4 blue steel upright columns
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          addMesh(group, new THREE.BoxGeometry(0.1, H, 0.1), MAT_ACCENT_BLUE, sx * (W / 2 - 0.06), H / 2, sz * (D / 2 - 0.06));
        }
      }
      // 3 horizontal orange beam levels + loaded GMP pallets
      const levels = [0.22, H * 0.38, H * 0.72];
      levels.forEach((ly, idx) => {
        addMesh(group, new THREE.BoxGeometry(W, 0.09, 0.08), MAT_ACCENT_AMBER, 0, ly, D / 2 - 0.05);
        addMesh(group, new THREE.BoxGeometry(W, 0.09, 0.08), MAT_ACCENT_AMBER, 0, ly, -D / 2 + 0.05);
        // 2 pallets per tier
        for (const px of [-W * 0.24, W * 0.24]) {
          if (idx === 2 && px > 0) continue; // realistic partial fill on top tier
          addMesh(group, new THREE.BoxGeometry(W * 0.4, 0.12, D * 0.84), MAT_ACCENT_BLUE, px, ly + 0.08, 0);
          addMesh(group, new THREE.BoxGeometry(W * 0.38, H * 0.24, D * 0.78), MAT_PALLET_BOX, px, ly + 0.14 + H * 0.12, 0);
        }
      });
      break;
    }

    case 'forklift': {
      // Counterweight chassis
      addMesh(group, new THREE.BoxGeometry(W * 0.9, H * 0.32, D * 0.58), MAT_ACCENT_AMBER, 0, H * 0.24, -D * 0.16);
      // 4 rubber wheels
      for (const wx of [-W * 0.44, W * 0.44]) {
        for (const wz of [-D * 0.34, D * 0.12]) {
          addMesh(group, new THREE.CylinderGeometry(0.24, 0.24, 0.18, 14), MAT_RUBBER, wx, 0.24, wz, 0, 0, Math.PI / 2);
        }
      }
      // Roll-cage overhead guard
      for (const px of [-W * 0.38, W * 0.38]) {
        for (const pz of [-D * 0.38, D * 0.04]) {
          addMesh(group, new THREE.BoxGeometry(0.06, H * 0.58, 0.06), MAT_DARK_STEEL, px, H * 0.65, pz);
        }
      }
      addMesh(group, new THREE.BoxGeometry(W * 0.84, 0.07, D * 0.48), MAT_DARK_STEEL, 0, H * 0.95, -D * 0.17);
      // Front vertical mast & dual forks
      addMesh(group, new THREE.BoxGeometry(0.1, H * 0.9, 0.1), MAT_DARK_STEEL, -W * 0.28, H * 0.48, D * 0.18);
      addMesh(group, new THREE.BoxGeometry(0.1, H * 0.9, 0.1), MAT_DARK_STEEL, W * 0.28, H * 0.48, D * 0.18);
      addMesh(group, new THREE.BoxGeometry(0.12, 0.05, D * 0.45), MAT_CHROME, -W * 0.22, 0.12, D * 0.36);
      addMesh(group, new THREE.BoxGeometry(0.12, 0.05, D * 0.45), MAT_CHROME, W * 0.22, 0.12, D * 0.36);
      break;
    }

    case 'conveyor': {
      const beltY = Math.min(0.95, H * 0.62);
      addMesh(group, new THREE.BoxGeometry(W, 0.14, D * 0.9), bodyMat, 0, beltY, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.96, 0.04, D * 0.72), MAT_RUBBER, 0, beltY + 0.08, 0);
      for (const lx of [-W * 0.42, 0, W * 0.42]) {
        addMesh(group, new THREE.BoxGeometry(0.08, beltY, D * 0.78), MAT_DARK_STEEL, lx, beltY / 2, 0);
      }
      // Vision / Serialization gantry arch
      addMesh(group, new THREE.BoxGeometry(0.45, H - beltY, D * 0.96), MAT_CHROME, 0, beltY + (H - beltY) / 2, 0);
      addMesh(group, new THREE.BoxGeometry(0.32, 0.22, 0.05), MAT_SCREEN, 0, beltY + (H - beltY) * 0.72, D * 0.5);
      break;
    }

    case 'desk-workstation':
    case 'conference-table': {
      const topH = 0.75;
      addMesh(group, new THREE.BoxGeometry(W, 0.06, D), bodyMat, 0, topH, 0);
      for (const lx of [-W * 0.44, W * 0.44]) {
        for (const lz of [-D * 0.4, D * 0.4]) {
          addMesh(group, new THREE.BoxGeometry(0.06, topH, 0.06), MAT_DARK_STEEL, lx, topH / 2, lz);
        }
      }
      if (archetype === 'desk-workstation') {
        addMesh(group, new THREE.BoxGeometry(0.55, 0.34, 0.04), MAT_SCREEN, -0.32, topH + 0.26, -D * 0.24);
        addMesh(group, new THREE.BoxGeometry(0.55, 0.34, 0.04), MAT_SCREEN, 0.32, topH + 0.26, -D * 0.24);
        addMesh(group, new THREE.BoxGeometry(0.48, 0.44, 0.46), MAT_DARK_STEEL, 0, 0.45, D * 0.58);
      } else {
        const seats = Math.max(2, Math.floor(W / 0.85));
        for (let i = 0; i < seats; i++) {
          const sx = -W * 0.38 + (i / Math.max(1, seats - 1)) * W * 0.76;
          addMesh(group, new THREE.BoxGeometry(0.44, 0.44, 0.42), MAT_DARK_STEEL, sx, 0.42, D * 0.62);
          addMesh(group, new THREE.BoxGeometry(0.44, 0.44, 0.42), MAT_DARK_STEEL, sx, 0.42, -D * 0.62);
        }
      }
      break;
    }

    case 'safety-station': {
      addMesh(group, new THREE.BoxGeometry(W, 0.08, D), MAT_DARK_STEEL, 0, 0.04, 0);
      addMesh(group, new THREE.CylinderGeometry(0.04, 0.04, H * 0.92, 12), MAT_ACCENT_GREEN, 0, H * 0.46, 0);
      addMesh(group, new THREE.CylinderGeometry(0.18, 0.14, 0.12, 16), MAT_CHROME, 0, 1.0, 0.22);
      addMesh(group, new THREE.ConeGeometry(0.18, 0.14, 16), MAT_ACCENT_GREEN, 0, H * 0.88, 0.22);
      // Companion CO2 extinguisher in floor cradle
      addMesh(group, new THREE.CylinderGeometry(0.095, 0.095, 0.56, 16), MAT_ACCENT_RED, W * 0.28, 0.36, 0);
      addMesh(group, new THREE.SphereGeometry(0.095, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT_ACCENT_RED, W * 0.28, 0.64, 0);
      addMesh(group, new THREE.CylinderGeometry(0.025, 0.028, 0.08, 10), MAT_COPPER_FITTING, W * 0.28, 0.74, 0);
      break;
    }

    case 'fire-extinguisher': {
      const r = Math.min(W, D) * 0.34;
      const bodyH = H * 0.64;
      // Stainless floor cradle + black rubber anti-slip base skirt
      addMesh(group, new THREE.CylinderGeometry(r * 1.18, r * 1.24, 0.04, 20), MAT_BRUSHED_STEEL, 0, 0.02, 0);
      addMesh(group, new THREE.CylinderGeometry(r * 1.04, r * 1.06, 0.07, 20), MAT_RUBBER, 0, 0.075, 0);
      // Glossy crimson cylinder + hemispherical dome shoulder
      addMesh(group, new THREE.CylinderGeometry(r, r, bodyH, 24), MAT_ACCENT_RED, 0, 0.09 + bodyH / 2, 0);
      addMesh(group, new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT_ACCENT_RED, 0, 0.09 + bodyH, 0);
      // White/black compliance inspection band around upper torso
      addMesh(group, new THREE.CylinderGeometry(r * 1.015, r * 1.015, bodyH * 0.26, 22), MAT_CHROME, 0, 0.09 + bodyH * 0.62, 0);
      // Brass valve neck + green pressure gauge dial + squeeze lever & carry handle
      const neckY = 0.09 + bodyH + r * 0.92;
      addMesh(group, new THREE.CylinderGeometry(r * 0.28, r * 0.32, 0.09, 14), MAT_COPPER_FITTING, 0, neckY + 0.04, 0);
      addMesh(group, new THREE.CylinderGeometry(0.024, 0.024, 0.018, 14), MAT_ACCENT_GREEN, 0, neckY + 0.045, r * 0.36, Math.PI / 2, 0, 0);
      addMesh(group, new THREE.BoxGeometry(0.024, 0.02, r * 1.45), MAT_DARK_STEEL, 0, neckY + 0.095, -r * 0.45, 0.22, 0, 0);
      addMesh(group, new THREE.BoxGeometry(0.022, 0.016, r * 1.3), MAT_CHROME, 0, neckY + 0.055, -r * 0.42);
      // Yellow safety pull-pin ring
      addMesh(group, new THREE.TorusGeometry(0.018, 0.004, 8, 16), MAT_ACCENT_AMBER, r * 0.28, neckY + 0.06, 0);
      // Black rubber discharge hose + flared CO2 snow horn
      addMesh(group, new THREE.CylinderGeometry(0.016, 0.016, bodyH * 0.62, 10), MAT_RUBBER, r * 0.92, 0.09 + bodyH * 0.68, r * 0.16, 0, 0, -0.14);
      addMesh(group, new THREE.CylinderGeometry(0.042, 0.018, 0.19, 14), MAT_RUBBER, r * 1.02, 0.09 + bodyH * 0.26, r * 0.24, 0.15, 0, 0);
      break;
    }

    case 'firebox-cabinet': {
      // Recessed powder-coated crimson firebox cabinet housing
      addMesh(group, new THREE.BoxGeometry(W, H, D * 0.86), MAT_ACCENT_RED, 0, H / 2, -D * 0.06);
      // Recessed dark interior cavity visible through the viewing glass
      addMesh(group, new THREE.BoxGeometry(W * 0.84, H * 0.78, D * 0.65), MAT_DARK_STEEL, 0, H * 0.47, D * 0.02);
      // Coiled crimson fire hose reel on central brass spindle (upper/left bay)
      const reelR = Math.min(W * 0.28, H * 0.2);
      addMesh(group, new THREE.CylinderGeometry(reelR, reelR, 0.09, 24), MAT_ACCENT_RED, -W * 0.12, H * 0.58, D * 0.08, Math.PI / 2, 0, 0);
      addMesh(group, new THREE.TorusGeometry(reelR * 0.72, 0.032, 10, 24), MAT_RUBBER, -W * 0.12, H * 0.58, D * 0.12);
      addMesh(group, new THREE.CylinderGeometry(0.04, 0.04, 0.14, 14), MAT_COPPER_FITTING, -W * 0.12, H * 0.58, D * 0.13, Math.PI / 2, 0, 0);
      // Brass shutoff valve + chrome fog nozzle clipped on right side
      addMesh(group, new THREE.CylinderGeometry(0.028, 0.036, 0.22, 12), MAT_COPPER_FITTING, W * 0.24, H * 0.64, D * 0.14);
      // Secondary internal extinguisher in lower bay
      addMesh(group, new THREE.CylinderGeometry(0.075, 0.075, H * 0.3, 16), MAT_ACCENT_RED, W * 0.22, H * 0.24, D * 0.08);
      addMesh(group, new THREE.CylinderGeometry(0.02, 0.02, 0.06, 10), MAT_COPPER_FITTING, W * 0.22, H * 0.41, D * 0.08);
      // Beveled front perimeter door frame + clear safety glazing + stainless pull latch
      addMesh(group, new THREE.BoxGeometry(W * 0.96, 0.12, 0.04), MAT_ACCENT_RED, 0, H - 0.08, D * 0.41);
      addMesh(group, new THREE.BoxGeometry(W * 0.96, 0.1, 0.04), MAT_ACCENT_RED, 0, 0.06, D * 0.41);
      addMesh(group, new THREE.BoxGeometry(0.07, H * 0.88, 0.04), MAT_ACCENT_RED, -W * 0.45, H * 0.5, D * 0.41);
      addMesh(group, new THREE.BoxGeometry(0.07, H * 0.88, 0.04), MAT_ACCENT_RED, W * 0.45, H * 0.5, D * 0.41);
      addMesh(group, new THREE.BoxGeometry(W * 0.82, H * 0.78, 0.016), MAT_GLASS, 0, H * 0.48, D * 0.415);
      addMesh(group, new THREE.BoxGeometry(0.035, 0.18, 0.055), MAT_CHROME, W * 0.39, H * 0.5, D * 0.44);
      // Illuminated white/crimson FIRE header plaque
      addMesh(group, new THREE.BoxGeometry(W * 0.56, 0.075, 0.03), MAT_CHROME, 0, H - 0.075, D * 0.435);
      break;
    }

    case 'pass-box': {
      const standH = H * 0.38;
      const boxH = H * 0.46;
      const plenumH = H * 0.16;
      // 4 tubular 316L stainless cleanroom stand legs + cross-brace
      for (const lx of [-W * 0.42, W * 0.42]) {
        for (const lz of [-D * 0.38, D * 0.38]) {
          addMesh(group, new THREE.CylinderGeometry(0.03, 0.03, standH, 12), MAT_BRUSHED_STEEL, lx, standH / 2, lz);
        }
      }
      addMesh(group, new THREE.BoxGeometry(W * 0.86, 0.035, 0.035), MAT_BRUSHED_STEEL, 0, standH * 0.28, -D * 0.36);
      addMesh(group, new THREE.BoxGeometry(W * 0.86, 0.035, 0.035), MAT_BRUSHED_STEEL, 0, standH * 0.28, D * 0.36);
      // Main double-walled 316L transfer chamber shell
      addMesh(group, new THREE.BoxGeometry(W, 0.08, D), MAT_BRUSHED_STEEL, 0, standH + 0.04, 0);
      addMesh(group, new THREE.BoxGeometry(0.09, boxH, D), MAT_BRUSHED_STEEL, -W * 0.455, standH + boxH / 2, 0);
      addMesh(group, new THREE.BoxGeometry(0.09, boxH, D), MAT_BRUSHED_STEEL, W * 0.455, standH + boxH / 2, 0);
      // Perforated internal transfer deck + UV-C germicidal violet bar inside top of chamber
      addMesh(group, new THREE.BoxGeometry(W * 0.8, 0.025, D * 0.82), MAT_CHROME, 0, standH + 0.12, 0);
      addMesh(group, new THREE.CylinderGeometry(0.018, 0.018, W * 0.68, 12), MAT_SCREEN, 0, standH + boxH - 0.06, 0, 0, 0, Math.PI / 2);
      // Top HEPA H14 fan-filter plenum + analog Magnehelic ΔP gauge + interlock status LEDs
      addMesh(group, new THREE.BoxGeometry(W * 1.02, plenumH, D * 1.02), bodyMat, 0, standH + boxH + plenumH / 2, 0);
      addMesh(group, new THREE.CylinderGeometry(0.065, 0.065, 0.03, 18), MAT_CHROME, -W * 0.24, standH + boxH + plenumH * 0.5, D * 0.515, Math.PI / 2, 0, 0);
      addMesh(group, new THREE.BoxGeometry(0.24, 0.09, 0.03), MAT_DARK_STEEL, W * 0.16, standH + boxH + plenumH * 0.5, D * 0.51);
      addMesh(group, new THREE.BoxGeometry(0.06, 0.03, 0.035), MAT_ACCENT_GREEN, W * 0.1, standH + boxH + plenumH * 0.5, D * 0.515);
      addMesh(group, new THREE.BoxGeometry(0.06, 0.03, 0.035), MAT_ACCENT_AMBER, W * 0.22, standH + boxH + plenumH * 0.5, D * 0.515);
      // Front & rear flush-glazed interlocked doors + stainless D-handles
      for (const sz of [-1, 1]) {
        addMesh(group, new THREE.BoxGeometry(W * 0.82, boxH * 0.86, 0.022), MAT_GLASS, 0, standH + boxH / 2, sz * (D * 0.49));
        addMesh(group, new THREE.BoxGeometry(0.03, 0.22, 0.05), MAT_CHROME, W * 0.36, standH + boxH / 2, sz * (D * 0.525));
      }
      break;
    }

    case 'cold-room-unit': {
      // Diamond-plate entry threshold floor + white PIR insulated cam-lock chamber
      addMesh(group, new THREE.BoxGeometry(W * 1.02, 0.07, D * 1.02), MAT_BRUSHED_STEEL, 0, 0.035, 0);
      addMesh(group, new THREE.BoxGeometry(W, H - 0.12, D), bodyMat, 0, 0.07 + (H - 0.12) / 2, 0);
      // Stainless vertical cam-lock corner trim strips
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          addMesh(group, new THREE.BoxGeometry(0.08, H - 0.08, 0.08), MAT_BRUSHED_STEEL, sx * (W / 2 - 0.02), H / 2, sz * (D / 2 - 0.02));
        }
      }
      // Heavy insulated hinged cold-room door + rubber perimeter gasket + heated viewing window
      const doorW = Math.min(1.18, W * 0.38);
      const doorH = Math.min(2.15, H * 0.82);
      const doorX = -W * 0.14;
      addMesh(group, new THREE.BoxGeometry(doorW + 0.06, doorH + 0.06, 0.05), MAT_RUBBER, doorX, 0.07 + doorH / 2, D / 2 + 0.015);
      addMesh(group, new THREE.BoxGeometry(doorW, doorH, 0.07), MAT_CHROME, doorX, 0.07 + doorH / 2, D / 2 + 0.035);
      addMesh(group, new THREE.BoxGeometry(doorW * 0.46, doorH * 0.32, 0.085), MAT_GLASS, doorX, 0.07 + doorH * 0.64, D / 2 + 0.038);
      // Heavy cam-lift chrome lever latch + green illuminated panic release badge
      addMesh(group, new THREE.BoxGeometry(0.06, 0.28, 0.1), MAT_DARK_STEEL, doorX + doorW * 0.38, 0.07 + doorH * 0.48, D / 2 + 0.08);
      addMesh(group, new THREE.BoxGeometry(0.04, 0.16, 0.06), MAT_CHROME, doorX + doorW * 0.38, 0.07 + doorH * 0.48, D / 2 + 0.12);
      // Exterior digital 2–8 °C thermostat controller + alarm beacon on right fascia
      const ctrlX = W * 0.28;
      addMesh(group, new THREE.BoxGeometry(0.38, 0.52, 0.08), MAT_DARK_STEEL, ctrlX, H * 0.62, D / 2 + 0.04);
      addMesh(group, new THREE.BoxGeometry(0.28, 0.16, 0.09), MAT_SCREEN, ctrlX, H * 0.69, D / 2 + 0.045);
      addMesh(group, new THREE.CylinderGeometry(0.035, 0.035, 0.04, 14), MAT_ACCENT_GREEN, ctrlX - 0.08, H * 0.54, D / 2 + 0.08, Math.PI / 2, 0, 0);
      addMesh(group, new THREE.CylinderGeometry(0.035, 0.035, 0.04, 14), MAT_ACCENT_BLUE, ctrlX + 0.08, H * 0.54, D / 2 + 0.08, Math.PI / 2, 0, 0);
      // Roof-mounted monoblock refrigeration condensing unit + axial fan grille + copper lines
      addMesh(group, new THREE.BoxGeometry(W * 0.46, 0.42, D * 0.38), MAT_DARK_STEEL, W * 0.18, H + 0.16, -D * 0.16);
      addMesh(group, new THREE.CylinderGeometry(0.26, 0.26, 0.06, 18), MAT_CHROME, W * 0.18, H + 0.16, -D * 0.16 + D * 0.195, Math.PI / 2, 0, 0);
      addMesh(group, new THREE.CylinderGeometry(0.02, 0.02, 0.42, 10), MAT_COPPER_FITTING, W * 0.44, H + 0.14, -D * 0.1);
      // Entry threshold diamond ramp
      addMesh(group, new THREE.BoxGeometry(doorW * 1.05, 0.04, 0.26), MAT_BRUSHED_STEEL, doorX, 0.02, D / 2 + 0.14, 0.14, 0, 0);
      break;
    }

    case 'sensor-node': {
      addMesh(group, new THREE.CylinderGeometry(0.12, 0.16, 0.06, 12), MAT_DARK_STEEL, 0, 0.03, 0);
      addMesh(group, new THREE.CylinderGeometry(0.03, 0.03, H * 0.82, 8), MAT_CHROME, 0, H * 0.42, 0);
      addMesh(group, new THREE.BoxGeometry(0.24, 0.28, 0.14), bodyMat, 0, H * 0.86, 0);
      addMesh(group, new THREE.BoxGeometry(0.16, 0.1, 0.03), MAT_ACCENT_GREEN, 0, H * 0.88, 0.08);
      break;
    }

    case 'server-rack':
    case 'network-rack':
    case 'patch-cabinet': {
      // Heavy-duty matte charcoal 42U rack chassis + leveling casters
      addMesh(group, new THREE.BoxGeometry(W, 0.08, D), MAT_DARK_STEEL, 0, 0.06, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.96, H - 0.12, D * 0.94), MAT_DARK_STEEL, 0, 0.08 + (H - 0.12) / 2, 0);
      // Side framing rails
      addMesh(group, new THREE.BoxGeometry(0.05, H - 0.12, D * 0.98), bodyMat, -W * 0.47, 0.08 + (H - 0.12) / 2, 0);
      addMesh(group, new THREE.BoxGeometry(0.05, H - 0.12, D * 0.98), bodyMat, W * 0.47, 0.08 + (H - 0.12) / 2, 0);
      // Top cable-entry tray & roof exhaust fan shroud
      addMesh(group, new THREE.BoxGeometry(W * 0.96, 0.07, D * 0.96), MAT_DARK_STEEL, 0, H - 0.035, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.55, 0.06, D * 0.4), MAT_CHROME, 0, H + 0.02, -D * 0.15);
      // Individual rack-mounted blade servers / switches / patch panels with glowing activity LEDs
      const bays = Math.max(5, Math.min(10, Math.round(H * 4.5)));
      const bayH = (H - 0.28) / bays;
      for (let i = 0; i < bays; i++) {
        const by = 0.16 + bayH * (i + 0.5);
        const isSwitch = archetype === 'network-rack' || archetype === 'patch-cabinet' || i >= bays - 2;
        addMesh(
          group,
          new THREE.BoxGeometry(W * 0.84, bayH * 0.78, 0.045),
          isSwitch ? MAT_BRUSHED_STEEL : MAT_DARK_STEEL,
          0,
          by,
          D * 0.475
        );
        // Status & link LED strips (violet for network, emerald for healthy compute, amber for active I/O)
        const ledMat =
          i % 4 === 0 ? MAT_ACCENT_BLUE : i % 3 === 0 ? MAT_ACCENT_AMBER : MAT_ACCENT_GREEN;
        addMesh(group, new THREE.BoxGeometry(0.07, 0.018, 0.02), ledMat, W * 0.32, by, D * 0.502);
        addMesh(group, new THREE.BoxGeometry(W * 0.46, 0.014, 0.02), isSwitch ? MAT_SCREEN : MAT_ACCENT_GREEN, -W * 0.12, by, D * 0.502);
      }
      // Subtle front smoked-glass bezel frame
      addMesh(group, new THREE.BoxGeometry(W * 0.88, H * 0.88, 0.015), MAT_GLASS, 0, H * 0.5, D * 0.51);
      break;
    }

    case 'crac-cooling':
    case 'pdu-cabinet':
    case 'ups-tower': {
      addMesh(group, new THREE.BoxGeometry(W, 0.1, D), MAT_DARK_STEEL, 0, 0.05, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.96, H - 0.1, D * 0.94), bodyMat, 0, 0.1 + (H - 0.1) / 2, 0);
      // Perforated intake grille louvers
      for (let i = 0; i < 6; i++) {
        addMesh(
          group,
          new THREE.BoxGeometry(W * 0.76, 0.06, 0.04),
          MAT_DARK_STEEL,
          0,
          0.32 + i * ((H - 0.75) / 6),
          D * 0.48
        );
      }
      // Top HMI telemetry status screen + indicator beacon
      addMesh(group, new THREE.BoxGeometry(W * 0.58, 0.24, 0.05), MAT_DARK_STEEL, 0, H * 0.84, D * 0.48);
      addMesh(group, new THREE.BoxGeometry(W * 0.48, 0.17, 0.055), MAT_SCREEN, 0, H * 0.84, D * 0.485);
      addMesh(
        group,
        new THREE.BoxGeometry(W * 0.78, 0.03, 0.04),
        archetype === 'crac-cooling' ? MAT_ACCENT_BLUE : archetype === 'ups-tower' ? MAT_ACCENT_GREEN : MAT_ACCENT_AMBER,
        0,
        H * 0.94,
        D * 0.485
      );
      break;
    }

    case 'scada-console': {
      const deskH = 0.78;
      // Curved-style industrial NOC command desk
      addMesh(group, new THREE.BoxGeometry(W, 0.07, D * 0.82), MAT_DARK_STEEL, 0, deskH, D * 0.08);
      addMesh(group, new THREE.BoxGeometry(W * 0.94, deskH - 0.06, D * 0.65), bodyMat, 0, (deskH - 0.06) / 2, D * 0.05);
      // 3-screen panoramic SCADA / Telemetry monitor wall
      const monW = (W * 0.86) / 3 - 0.06;
      for (let i = -1; i <= 1; i++) {
        const mx = i * (monW + 0.06);
        addMesh(group, new THREE.BoxGeometry(monW, 0.44, 0.045), MAT_DARK_STEEL, mx, deskH + 0.36, -D * 0.22, 0, -i * 0.16, 0);
        addMesh(group, new THREE.BoxGeometry(monW * 0.92, 0.37, 0.05), MAT_SCREEN, mx, deskH + 0.36, -D * 0.215, 0, -i * 0.16, 0);
      }
      // Dual ergonomic operator chairs
      for (const cx of [-W * 0.24, W * 0.24]) {
        addMesh(group, new THREE.BoxGeometry(0.46, 0.46, 0.44), MAT_DARK_STEEL, cx, 0.42, D * 0.56);
      }
      break;
    }

    case 'tablet-press': {
      // Stainless base + glass turret compression chamber + overhead hopper
      addMesh(group, new THREE.BoxGeometry(W * 0.92, H * 0.34, D * 0.88), bodyMat, 0, H * 0.17, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.86, H * 0.38, D * 0.82), MAT_GLASS, 0, H * 0.53, 0);
      // Rotary die turret inside glass enclosure
      addMesh(group, new THREE.CylinderGeometry(Math.min(W, D) * 0.28, Math.min(W, D) * 0.28, H * 0.32, 24), MAT_CHROME, 0, H * 0.53, 0);
      // Top head + stainless conical powder hopper
      addMesh(group, new THREE.BoxGeometry(W * 0.9, H * 0.16, D * 0.86), MAT_BRUSHED_STEEL, 0, H * 0.8, 0);
      addMesh(group, new THREE.ConeGeometry(0.28, H * 0.24, 18), MAT_CHROME, 0, H * 0.96, 0, Math.PI, 0, 0);
      // Side HMI pendant
      addMesh(group, new THREE.BoxGeometry(0.44, 0.34, 0.05), MAT_DARK_STEEL, W * 0.46, H * 0.62, D * 0.38);
      addMesh(group, new THREE.BoxGeometry(0.38, 0.28, 0.055), MAT_SCREEN, W * 0.46, H * 0.62, D * 0.385);
      break;
    }

    case 'fluid-bed-dryer':
    case 'granulator': {
      const r = Math.min(W, D) * 0.36;
      addMesh(group, new THREE.BoxGeometry(W * 0.92, 0.16, D * 0.9), MAT_DARK_STEEL, 0, 0.08, 0);
      // Product bowl + conical expansion tower
      addMesh(group, new THREE.CylinderGeometry(r * 0.88, r * 0.72, H * 0.34, 26), bodyMat, -W * 0.12, 0.16 + H * 0.17, 0);
      addMesh(group, new THREE.CylinderGeometry(r * 1.04, r * 0.88, H * 0.38, 26), MAT_BRUSHED_STEEL, -W * 0.12, 0.16 + H * 0.52, 0);
      addMesh(group, new THREE.CylinderGeometry(r * 0.7, r * 1.04, H * 0.2, 24), MAT_CHROME, -W * 0.12, 0.16 + H * 0.8, 0);
      // Sight port & control column
      addMesh(group, new THREE.CylinderGeometry(0.16, 0.16, 0.08, 16), MAT_GLASS, -W * 0.12, H * 0.38, r * 0.86, Math.PI / 2, 0, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.28, H * 0.72, D * 0.55), MAT_BRUSHED_STEEL, W * 0.32, 0.16 + H * 0.36, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.22, 0.32, 0.05), MAT_SCREEN, W * 0.32, H * 0.6, D * 0.29);
      break;
    }

    case 'agv-robot': {
      // Sleek autonomous cleanroom mobile base + LiDAR dome + cargo deck
      addMesh(group, new THREE.BoxGeometry(W * 0.92, H * 0.42, D * 0.94), bodyMat, 0, H * 0.26, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.96, 0.06, D * 0.98), MAT_ACCENT_BLUE, 0, H * 0.12, 0);
      for (const wx of [-W * 0.42, W * 0.42]) {
        for (const wz of [-D * 0.34, D * 0.34]) {
          addMesh(group, new THREE.CylinderGeometry(0.12, 0.12, 0.08, 14), MAT_RUBBER, wx, 0.12, wz, 0, 0, Math.PI / 2);
        }
      }
      // LiDAR safety scanner & status light mast
      addMesh(group, new THREE.CylinderGeometry(0.11, 0.13, 0.14, 16), MAT_DARK_STEEL, 0, H * 0.54, D * 0.34);
      addMesh(group, new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16), MAT_ACCENT_AMBER, 0, H * 0.62, D * 0.34);
      // Top stainless payload rack/tote
      addMesh(group, new THREE.BoxGeometry(W * 0.76, H * 0.36, D * 0.68), MAT_CHROME, 0, H * 0.66, -D * 0.08);
      break;
    }

    default: {
      // Multi-part industrial module fallback
      addMesh(group, new THREE.BoxGeometry(W, 0.12, D), MAT_DARK_STEEL, 0, 0.06, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.94, H * 0.78, D * 0.94), bodyMat, 0, 0.12 + H * 0.39, 0);
      addMesh(group, new THREE.BoxGeometry(W * 0.88, H * 0.1, D * 0.88), MAT_CHROME, 0, H - H * 0.05, 0);
      break;
    }
  }

  // Soft grounded contact shadow plane under asset (zero shadow-map cost, crisp spatial grounding)
  const shadowPlane = new THREE.Mesh(SHARED_SHADOW_GEO, getContactShadowMaterial());
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.008;
  shadowPlane.scale.set(W * 1.24, D * 1.24, 1);
  shadowPlane.renderOrder = 1;
  group.add(shadowPlane);

  // Selection outline ring on floor when selected
  if (isSelected) {
    const ringGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(W + 0.18, H + 0.12, D + 0.18));
    const ringMat = new THREE.LineBasicMaterial({ color: '#8B5CF6' });
    const boxWire = new THREE.LineSegments(ringGeo, ringMat);
    boxWire.position.y = H / 2;
    group.add(boxWire);
  }

  return group;
}
