import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Room, SpatialAsset } from '../types/twin';
import { buildProceduralEquipmentGroup } from '../engine/equipmentBuilder';
import { DEFAULT_MATERIALS } from '../data/materialsLibrary';
import { attachCanvasPinchGuard } from '../utils/preventPinchZoom';

interface AssetMini3DViewerProps {
  asset?: SpatialAsset | null;
  room?: Room | null;
  height?: number;
  statusAccent?: 'nominal' | 'warning' | 'alarm';
  badgeText?: string;
}

/**
 * Dedicated interactive Three.js PBR studio viewer for inspecting a SINGLE equipment asset or room
 * inside telemetry detail dialogs, trend panels, and equipment inspection popovers.
 */
export const AssetMini3DViewer: React.FC<AssetMini3DViewerProps> = ({
  asset,
  room,
  height = 220,
  statusAccent = 'nominal',
  badgeText,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [autoSpin, setAutoSpin] = useState(true);
  const autoSpinRef = useRef(true);
  const resetFnRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    autoSpinRef.current = autoSpin;
  }, [autoSpin]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const w = Math.max(240, el.clientWidth || 320);
    const h = Math.max(160, height);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.innerHTML = '';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0E0E13');

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 18;
    controls.maxPolarAngle = Math.PI * 0.49;

    // Charcoal Studio Lighting: Soft Violet Key + Warm Amber Rim + Overhead Fill
    const hemi = new THREE.HemisphereLight('#EDE9FE', '#18181B', 0.95);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#FFFFFF', 1.8);
    keyLight.position.set(5, 8, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(512, 512);
    scene.add(keyLight);

    const rimViolet = new THREE.DirectionalLight('#8B5CF6', 0.9);
    rimViolet.position.set(-5, 4, -5);
    scene.add(rimViolet);

    const rimAmber = new THREE.DirectionalLight('#F59E0B', 0.65);
    rimAmber.position.set(4, 2.5, -5);
    scene.add(rimAmber);

    // Sleek circular studio plinth + accent ring
    const ringHex =
      statusAccent === 'alarm' ? '#F43F5E' : statusAccent === 'warning' ? '#F59E0B' : '#8B5CF6';

    const pedestalGroup = new THREE.Group();
    const floorDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.75, 0.06, 48),
      new THREE.MeshStandardMaterial({ color: '#16161D', roughness: 0.72, metalness: 0.25 })
    );
    floorDisc.position.y = -0.03;
    floorDisc.receiveShadow = true;
    pedestalGroup.add(floorDisc);

    const glowRing = new THREE.Mesh(
      new THREE.RingGeometry(2.48, 2.58, 64),
      new THREE.MeshBasicMaterial({ color: ringHex, side: THREE.DoubleSide, transparent: true, opacity: 0.82 })
    );
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.y = 0.004;
    pedestalGroup.add(glowRing);
    scene.add(pedestalGroup);

    // Build subject mesh (Specific Equipment Asset or Architectural Cleanroom Cutaway)
    const subjectGroup = new THREE.Group();
    if (asset) {
      const matDef = DEFAULT_MATERIALS.find((m) => m.id === asset.materialId);
      const baseMat = new THREE.MeshStandardMaterial({
        color: matDef?.baseColor ?? asset.color ?? '#D4D4D8',
        roughness: matDef?.roughness ?? 0.26,
        metalness: matDef?.metalness ?? 0.78,
      });
      const eq = buildProceduralEquipmentGroup(asset, baseMat, false);
      subjectGroup.add(eq);
    } else if (room) {
      const rw = Math.min(4.2, Math.max(2.0, room.width * 0.24));
      const rd = Math.min(3.4, Math.max(1.8, room.depth * 0.24));
      const rh = Math.min(1.6, Math.max(0.95, room.height * 0.28));
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(rw, 0.08, rd),
        new THREE.MeshStandardMaterial({ color: room.color || '#6D28D9', roughness: 0.45, metalness: 0.2 })
      );
      slab.position.y = 0.04;
      subjectGroup.add(slab);

      const wallMat = new THREE.MeshStandardMaterial({
        color: '#27272F',
        roughness: 0.55,
        metalness: 0.25,
        transparent: true,
        opacity: 0.65,
      });
      const backWall = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, 0.07), wallMat);
      backWall.position.set(0, rh / 2 + 0.04, -rd / 2 + 0.035);
      subjectGroup.add(backWall);

      const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.07, rh, rd), wallMat);
      leftWall.position.set(-rw / 2 + 0.035, rh / 2 + 0.04, 0);
      subjectGroup.add(leftWall);

      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(rw, rh, rd)),
        new THREE.LineBasicMaterial({ color: '#A78BFA', transparent: true, opacity: 0.75 })
      );
      wire.position.y = rh / 2 + 0.04;
      subjectGroup.add(wire);
    }

    // Center & auto-scale subject nicely onto plinth
    const box = new THREE.Box3().setFromObject(subjectGroup);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(0.5, size.x, size.y, size.z);
    const scale = 2.65 / maxDim;
    subjectGroup.scale.setScalar(scale);

    const scaledBox = new THREE.Box3().setFromObject(subjectGroup);
    const scaledCenter = new THREE.Vector3();
    scaledBox.getCenter(scaledCenter);
    subjectGroup.position.x -= scaledCenter.x;
    subjectGroup.position.z -= scaledCenter.z;
    subjectGroup.position.y -= scaledBox.min.y;
    scene.add(subjectGroup);

    const finalBox = new THREE.Box3().setFromObject(subjectGroup);
    const finalCenter = new THREE.Vector3();
    finalBox.getCenter(finalCenter);

    const resetCamera = () => {
      camera.position.set(3.5, Math.max(2.1, finalCenter.y + 1.45), 3.9);
      controls.target.set(0, finalCenter.y, 0);
      controls.update();
    };
    resetFnRef.current = resetCamera;
    resetCamera();

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (autoSpinRef.current) {
        subjectGroup.rotation.y += 0.0055;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const detachPinchGuard = attachCanvasPinchGuard(el, (deltaY) => {
      const factor = deltaY > 0 ? 1.06 : 0.94;
      const offset = camera.position.clone().sub(controls.target);
      const nextLen = THREE.MathUtils.clamp(
        offset.length() * factor,
        controls.minDistance,
        controls.maxDistance
      );
      offset.setLength(nextLen);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    });

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nw = Math.max(200, Math.floor(entry.contentRect.width));
        const nh = Math.max(160, height);
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
    });
    ro.observe(el);

    return () => {
      detachPinchGuard();
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      envTex.dispose();
      pmrem.dispose();
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry?.dispose();
        }
      });
      renderer.dispose();
    };
  }, [asset?.id, asset?.archetype, asset?.width, asset?.depth, asset?.height, room?.id, height, statusAccent]);

  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-[#0E0E13] select-none"
      style={{ height }}
    >
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top-Left Live Asset Spec Badge */}
      <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-xl bg-[#16161D] border border-zinc-700/80 text-[10.5px] font-mono text-zinc-200 flex items-center gap-1.5 pointer-events-none">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            statusAccent === 'alarm'
              ? 'bg-rose-500'
              : statusAccent === 'warning'
                ? 'bg-amber-400'
                : 'bg-violet-400'
          }`}
        />
        <span>
          {badgeText ??
            (asset
              ? `${asset.assetId} · ${asset.width.toFixed(1)}×${asset.depth.toFixed(1)}×${asset.height.toFixed(1)}m`
              : room
                ? `${room.code} · ${room.environmental.cleanroomGrade}`
                : '3D Object Inspector')}
        </span>
      </div>

      {/* Bottom-Right Micro Turntable Controls */}
      <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setAutoSpin((s) => !s)}
          className="p-1.5 rounded-xl bg-[#16161D] border border-zinc-700/80 text-zinc-300 hover:text-white hover:border-violet-500 transition-colors"
          title={autoSpin ? 'Pause turntable rotation' : 'Resume turntable rotation'}
        >
          {autoSpin ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => resetFnRef.current?.()}
          className="p-1.5 rounded-xl bg-[#16161D] border border-zinc-700/80 text-zinc-300 hover:text-white hover:border-violet-500 transition-colors"
          title="Reset 3D camera angle"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="absolute bottom-2.5 left-2.5 text-[10px] text-zinc-400 pointer-events-none">
        Drag to orbit · Scroll to zoom
      </div>
    </div>
  );
};
