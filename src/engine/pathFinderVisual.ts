import * as THREE from 'three';
import type { NoGoZone, PathRoutingAlgorithm } from './navMesh';

export interface PathFinderVisualRig {
  group: THREE.Group;
  curve: THREE.CatmullRomCurve3 | null;
  totalDistanceM: number;
  chevrons: THREE.Mesh[];
  beaconRing: THREE.Mesh | null;
  beaconCore: THREE.Mesh | null;
}

const _pfPos = new THREE.Vector3();
const _pfTan = new THREE.Vector3();
const _pfUp = new THREE.Vector3(0, 1, 0);

let _hazardStripeTex: THREE.CanvasTexture | null = null;

function getHazardStripeTexture(): THREE.CanvasTexture | null {
  if (_hazardStripeTex) return _hazardStripeTex;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = 'rgba(225, 29, 72, 0.24)';
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = 'rgba(251, 113, 133, 0.72)';
  ctx.lineWidth = 14;
  for (let i = -128; i < 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 128, 128);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  _hazardStripeTex = tex;
  return tex;
}

/**
 * Computes total walking distance (meters) along a 2D waypoint polyline.
 */
export function computePathLengthMeters(points: { x: number; z: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}

/**
 * Builds a high-contrast, floor-hugging 3D Path Finder navigation ribbon with
 * directional gliding chevrons and a destination beacon for First-Person / Walk mode.
 * Color adapts by routing algorithm: Cyan/Emerald for Shortest, Mint/Emerald for Least Congested.
 */
export function populatePathFinderVisual(
  targetGroup: THREE.Group,
  points: { x: number; z: number }[],
  floorElev: number,
  disposeFn: (obj: THREE.Object3D) => void,
  algorithm: PathRoutingAlgorithm = 'shortest'
): PathFinderVisualRig {
  disposeFn(targetGroup);
  targetGroup.clear();

  if (points.length < 2) {
    targetGroup.visible = false;
    return {
      group: targetGroup,
      curve: null,
      totalDistanceM: 0,
      chevrons: [],
      beaconRing: null,
      beaconCore: null,
    };
  }

  const isLeastCongested = algorithm === 'least-congested';
  const primaryColor = isLeastCongested ? '#10B981' : '#22D3EE';
  const accentColor = isLeastCongested ? '#6EE7B7' : '#34D399';
  const glowColor = isLeastCongested ? '#059669' : '#0891B2';

  // Deduplicate closely spaced points so CatmullRomCurve3 tangents stay clean
  const cleanPts: THREE.Vector3[] = [];
  const y = floorElev + 0.085;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (
      cleanPts.length === 0 ||
      Math.hypot(
        p.x - cleanPts[cleanPts.length - 1].x,
        p.z - cleanPts[cleanPts.length - 1].z
      ) > 0.12
    ) {
      cleanPts.push(new THREE.Vector3(p.x, y, p.z));
    }
  }
  if (cleanPts.length < 2) {
    const last = points[points.length - 1];
    cleanPts.push(new THREE.Vector3(last.x, y, last.z));
  }

  const curve = new THREE.CatmullRomCurve3(cleanPts, false, 'catmullrom', 0.18);
  const totalDistanceM = computePathLengthMeters(points);
  const segs = Math.min(180, Math.max(20, Math.round(totalDistanceM * 5)));

  // 1. Core glowing navigation tube
  const coreGeo = new THREE.TubeGeometry(curve, segs, 0.075, 8, false);
  const coreMat = new THREE.MeshBasicMaterial({
    color: primaryColor,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.renderOrder = 14;
  targetGroup.add(coreMesh);

  // 2. Soft wide floor halo around the ribbon
  const haloGeo = new THREE.TubeGeometry(curve, segs, 0.2, 8, false);
  const haloMat = new THREE.MeshBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.scale.y = 0.25;
  haloMesh.position.y = floorElev + 0.05 - y * 0.25;
  haloMesh.renderOrder = 13;
  targetGroup.add(haloMesh);

  // 3. Gliding directional chevron arrows along the route
  const chevronCount = Math.min(18, Math.max(3, Math.floor(totalDistanceM / 1.45)));
  const chevronGeo = new THREE.ConeGeometry(0.16, 0.34, 3);
  chevronGeo.rotateX(Math.PI / 2);
  chevronGeo.scale(1, 0.32, 1);
  const chevronMat = new THREE.MeshBasicMaterial({
    color: accentColor,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
  });

  const chevrons: THREE.Mesh[] = [];
  for (let i = 0; i < chevronCount; i++) {
    const m = new THREE.Mesh(chevronGeo, chevronMat);
    m.renderOrder = 16;
    targetGroup.add(m);
    chevrons.push(m);
  }

  // 4. Destination vertical beacon + concentric pulse ring
  const dest = cleanPts[cleanPts.length - 1];
  const ringGeo = new THREE.RingGeometry(0.32, 0.52, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: primaryColor,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beaconRing = new THREE.Mesh(ringGeo, ringMat);
  beaconRing.position.set(dest.x, floorElev + 0.06, dest.z);
  beaconRing.renderOrder = 15;
  targetGroup.add(beaconRing);

  const colGeo = new THREE.CylinderGeometry(0.05, 0.18, 1.55, 16, 1, true);
  const colMat = new THREE.MeshBasicMaterial({
    color: accentColor,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beaconCore = new THREE.Mesh(colGeo, colMat);
  beaconCore.position.set(dest.x, floorElev + 0.82, dest.z);
  beaconCore.renderOrder = 15;
  targetGroup.add(beaconCore);

  targetGroup.visible = true;
  const rig: PathFinderVisualRig = {
    group: targetGroup,
    curve,
    totalDistanceM,
    chevrons,
    beaconRing,
    beaconCore,
  };
  animatePathFinderVisual(rig, 0);
  return rig;
}

/**
 * Populates 3D floor hazard overlays for user-defined Path Finder 'No-Go' exclusion zones.
 * Uses procedural diagonal hazard striping (zero external textures) with polygonOffset to avoid Z-fighting.
 */
export function populateNoGoZonesVisual(
  targetGroup: THREE.Group,
  zones: NoGoZone[],
  floorElev: number,
  disposeFn: (obj: THREE.Object3D) => void
): void {
  disposeFn(targetGroup);
  targetGroup.clear();

  if (zones.length === 0) {
    targetGroup.visible = false;
    return;
  }

  const tex = getHazardStripeTexture();
  const baseY = floorElev + 0.045;

  const fillMat = new THREE.MeshBasicMaterial({
    color: '#F43F5E',
    map: tex ?? undefined,
    transparent: true,
    opacity: tex ? 0.68 : 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const rimMat = new THREE.MeshBasicMaterial({
    color: '#FB7185',
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const postMat = new THREE.MeshStandardMaterial({
    color: '#E11D48',
    roughness: 0.35,
    metalness: 0.4,
    emissive: '#9F1239',
    emissiveIntensity: 0.4,
  });

  const postGeo = new THREE.CylinderGeometry(0.055, 0.07, 0.9, 12);

  for (const zone of zones) {
    if (zone.kind === 'room' && zone.width && zone.depth) {
      const cx = zone.x + zone.width * 0.5;
      const cz = zone.z + zone.depth * 0.5;
      const planeGeo = new THREE.PlaneGeometry(zone.width, zone.depth);
      planeGeo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(planeGeo, fillMat);
      mesh.position.set(cx, baseY, cz);
      mesh.renderOrder = 11;
      targetGroup.add(mesh);

      // Perimeter glowing border frame
      const borderPts = [
        new THREE.Vector3(zone.x, baseY + 0.03, zone.z),
        new THREE.Vector3(zone.x + zone.width, baseY + 0.03, zone.z),
        new THREE.Vector3(zone.x + zone.width, baseY + 0.03, zone.z + zone.depth),
        new THREE.Vector3(zone.x, baseY + 0.03, zone.z + zone.depth),
        new THREE.Vector3(zone.x, baseY + 0.03, zone.z),
      ];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
      const borderLine = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({ color: '#FB7185', transparent: true, opacity: 0.95 })
      );
      borderLine.renderOrder = 12;
      targetGroup.add(borderLine);

      // Corner hazard bollards
      const corners = [
        [zone.x + 0.18, zone.z + 0.18],
        [zone.x + zone.width - 0.18, zone.z + 0.18],
        [zone.x + zone.width - 0.18, zone.z + zone.depth - 0.18],
        [zone.x + 0.18, zone.z + zone.depth - 0.18],
      ];
      for (const [px, pz] of corners) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(px, floorElev + 0.45, pz);
        targetGroup.add(post);
      }
    } else {
      const r = Math.max(0.8, zone.radius ?? 2.2);
      const discGeo = new THREE.CircleGeometry(r, 40);
      discGeo.rotateX(-Math.PI / 2);
      const disc = new THREE.Mesh(discGeo, fillMat);
      disc.position.set(zone.x, baseY, zone.z);
      disc.renderOrder = 11;
      targetGroup.add(disc);

      const ringGeo = new THREE.RingGeometry(Math.max(0.1, r - 0.12), r + 0.04, 40);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, rimMat);
      ring.position.set(zone.x, baseY + 0.02, zone.z);
      ring.renderOrder = 12;
      targetGroup.add(ring);

      // 4 perimeter hazard bollards around circular No-Go zone
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2 + Math.PI / 4;
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(
          zone.x + Math.cos(ang) * (r - 0.12),
          floorElev + 0.45,
          zone.z + Math.sin(ang) * (r - 0.12)
        );
        targetGroup.add(post);
      }
    }
  }

  targetGroup.visible = true;
}

/**
 * Zero-GC per-frame animation for Path Finder gliding chevrons & destination beacon.
 */
export function animatePathFinderVisual(rig: PathFinderVisualRig | null, elapsedSec: number): void {
  if (!rig || !rig.curve || !rig.group.visible) return;
  const n = rig.chevrons.length;
  const speed = Math.min(0.42, 2.2 / Math.max(2.5, rig.totalDistanceM));

  for (let i = 0; i < n; i++) {
    const t = (i / n + elapsedSec * speed) % 1;
    rig.curve.getPointAt(t, _pfPos);
    rig.curve.getTangentAt(t, _pfTan).normalize();
    const m = rig.chevrons[i];
    m.position.set(_pfPos.x, _pfPos.y + 0.065, _pfPos.z);
    const yaw = Math.atan2(_pfTan.x, _pfTan.z);
    m.quaternion.setFromAxisAngle(_pfUp, yaw);
  }

  if (rig.beaconRing) {
    const pulse = 0.88 + Math.sin(elapsedSec * 4.5) * 0.16;
    rig.beaconRing.scale.setScalar(pulse);
  }
  if (rig.beaconCore) {
    rig.beaconCore.rotation.y = elapsedSec * 1.4;
  }
}
