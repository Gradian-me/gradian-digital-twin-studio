import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Activity,
  ArrowLeft,
  Building2,
  Camera,
  ChevronRight,
  Compass,
  Droplets,
  ExternalLink,
  Eye,
  EyeOff,
  Focus,
  Footprints,
  Gauge,
  Globe,
  Layers,
  Link2,
  Moon,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Scissors,
  Server,
  Sun,
  Tablet,
  Thermometer,
  Waypoints,
  X,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { useTwinStore, type RenderStyle } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useGmpStore } from '../store/useGmpStore';
import { HEATMAP_SCALES, renderFloorHeatmapCanvas } from '../engine/heatmapGenerator';
import { METRIC_PRESETS, type HeatmapMetric, type SensorDefinition } from '../types/telemetry';
import { MiniSparkline } from './TelemetryDashboard';
import { AssetMini3DViewer } from './AssetMini3DViewer';
import { DEFAULT_MATERIALS } from '../data/materialsLibrary';
import { getProceduralMaterial } from '../engine/proceduralTextures';
import { buildProceduralEquipmentGroup } from '../engine/equipmentBuilder';
import {
  buildFloorNavMesh,
  buildNavMeshVisualGroup,
  type FloorNavMesh,
} from '../engine/navMesh';
import { getRoomColorForAnalytics, snapValue } from '../utils/spatial';
import type { Building, Floor, MaterialDef, Room, Wall } from '../types/twin';

const _projVec = new THREE.Vector3();

const isSoftwareGl = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
})();

function disposeObject3D(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  });
}

function applyBlueprintWireframeToGroup(
  group: THREE.Object3D,
  edgeColor = '#38BDF8',
  fillOpacity = 0.16,
  clipPlanes: THREE.Plane[] = []
) {
  const meshes: THREE.Mesh[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      meshes.push(child as THREE.Mesh);
    }
  });
  meshes.forEach((mesh) => {
    mesh.material = new THREE.MeshBasicMaterial({
      color: '#0284C7',
      transparent: true,
      opacity: fillOpacity,
      depthWrite: false,
      clippingPlanes: clipPlanes,
    });
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 24),
      new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: true,
        opacity: 0.78,
        clippingPlanes: clipPlanes,
      })
    );
    mesh.add(edges);
  });
}

export const Viewport3D: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const storeRef = useRef(useTwinStore.getState());

  // Reactive subscriptions
  const sceneData = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const activeBuildingId = useTwinStore((s) => s.activeBuildingId);
  const activeDepartmentId = useTwinStore((s) => s.activeDepartmentId);
  const activeRoomId = useTwinStore((s) => s.activeRoomId);
  const drillLevel = useTwinStore((s) => s.drillLevel);
  const showAllFloors = useTwinStore((s) => s.showAllFloors);
  const renderStyle = useTwinStore((s) => s.renderStyle);
  const viewMode = useTwinStore((s) => s.viewMode);
  const orthoPreset = useTwinStore((s) => s.orthoPreset);
  const activeTool = useTwinStore((s) => s.activeTool);
  const transformMode = useTwinStore((s) => s.transformMode);
  const selected = useTwinStore((s) => s.selected);
  const isolatedIds = useTwinStore((s) => s.isolatedIds);
  const isolatedAssetType = useTwinStore((s) => s.isolatedAssetType);
  const snap = useTwinStore((s) => s.snap);
  const analyticsMetric = useTwinStore((s) => s.analyticsMetric);
  const sectionCutEnabled = useTwinStore((s) => s.sectionCutEnabled);
  const sectionCutHeight = useTwinStore((s) => s.sectionCutHeight);
  const sectionCutAxis = useTwinStore((s) => s.sectionCutAxis);
  const sectionCutFlipped = useTwinStore((s) => s.sectionCutFlipped);
  const explodedFactor = useTwinStore((s) => s.explodedFactor);
  const firstPersonMode = useTwinStore((s) => s.firstPersonMode);
  const firstPersonTabletVisible = useTwinStore((s) => s.firstPersonTabletVisible);
  const showNavMesh = useTwinStore((s) => s.showNavMesh);
  const lightingMode = useTwinStore((s) => s.lightingMode);
  const animateFlows = useTwinStore((s) => s.animateFlows);
  const showFlowLegend = useTwinStore((s) => s.showFlowLegend);
  const timelineDate = useTwinStore((s) => s.timelineDate);
  const canvasBackdrop = useTwinStore((s) => s.canvasBackdrop);
  const cameraCommand = useTwinStore((s) => s.cameraCommand);
  const pendingAIActions = useTwinStore((s) => s.pendingAIActions);
  const measurePoints = useTwinStore((s) => s.measurePoints);

  const drillInto = useTwinStore((s) => s.drillInto);
  const setRenderStyle = useTwinStore((s) => s.setRenderStyle);
  const clearIsolation = useTwinStore((s) => s.clearIsolation);
  const flyToCamera = useTwinStore((s) => s.flyToCamera);
  const buildDirectUrl = useTwinStore((s) => s.buildDirectUrl);
  const showToast = useTwinStore((s) => s.showToast);
  const setSectionCut = useTwinStore((s) => s.setSectionCut);
  const resetSectionCut = useTwinStore((s) => s.resetSectionCut);
  const setFirstPersonMode = useTwinStore((s) => s.setFirstPersonMode);
  const setFirstPersonTabletVisible = useTwinStore((s) => s.setFirstPersonTabletVisible);
  const setShowNavMesh = useTwinStore((s) => s.setShowNavMesh);
  const toggleLightingMode = useTwinStore((s) => s.toggleLightingMode);
  const setAnimateFlows = useTwinStore((s) => s.setAnimateFlows);
  const setShowFlowLegend = useTwinStore((s) => s.setShowFlowLegend);
  const openLiveCamera = useTwinStore((s) => s.openLiveCamera);
  const openRackDesigner = useTwinStore((s) => s.openRackDesigner);

  // Real-Time Telemetry & Heatmap Store Subscriptions
  const heatmapMetric = useTelemetryStore((s) => s.heatmapMetric);
  const heatmapOpacity = useTelemetryStore((s) => s.heatmapOpacity);
  const show3DSensorPins = useTelemetryStore((s) => s.show3DSensorPins);
  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const setHeatmapMetric = useTelemetryStore((s) => s.setHeatmapMetric);
  const setHeatmapOpacity = useTelemetryStore((s) => s.setHeatmapOpacity);
  const setShow3DSensorPins = useTelemetryStore((s) => s.setShow3DSensorPins);
  const openDashboard = useTelemetryStore((s) => s.openDashboard);
  const buildTelemetryTabUrl = useTelemetryStore((s) => s.buildTelemetryTabUrl);
  const activeLineHighlight = useGmpStore((s) => s.activeLineHighlight);
  const clearLineHighlight = useGmpStore((s) => s.clearLineHighlight);
  const openGmpModal = useGmpStore((s) => s.openGmpModal);

  const [sensorOverlayCollapsed, setSensorOverlayCollapsed] = useState(true);
  const [inspectedPinKey, setInspectedPinKey] = useState<string | null>(null);
  const [fpState, setFpState] = useState<{ x: number; z: number; jumpHeight: number; walkablePct: number }>({
    x: 10,
    z: 8,
    jumpHeight: 0,
    walkablePct: 82,
  });

  storeRef.current = useTwinStore.getState();

  const pinDomRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const projectPinsRef = useRef<() => void>(() => {});

  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    hemi: THREE.HemisphereLight;
    keyLight: THREE.DirectionalLight;
    rimLight: THREE.DirectionalLight;
    nightLightsGroup: THREE.Group;
    navMeshGroup: THREE.Group;
    navMesh: FloorNavMesh | null;
    flowPulses: { mesh: THREE.Mesh; curve: THREE.CatmullRomCurve3; phase: number; speed: number }[];
    fpVelY: number;
    fpOnGround: boolean;
    lastFpUiSync: number;
    perspCamera: THREE.PerspectiveCamera;
    orthoCamera: THREE.OrthographicCamera;
    activeCamera: THREE.Camera;
    orbit: OrbitControls;
    transform: TransformControls;
    contentGroup: THREE.Group;
    heatmapGroup: THREE.Group;
    heatmapCache: Map<
      string,
      { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh }
    >;
    gridHelper: THREE.Group;
    assetGroupMap: Map<string, THREE.Object3D>;
    clippingPlane: THREE.Plane;
    camTargetPos: THREE.Vector3 | null;
    camTargetLook: THREE.Vector3 | null;
    requestRender: () => void;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    keys: Set<string>;
    dispose: () => void;
  } | null>(null);

  // Initialize Three.js renderer, matte-charcoal studio RoomEnvironment, lights, and controls ONCE
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 560;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Calibrated exposure so cleanroom white/epoxy surfaces have crisp contrast instead of washing out
    renderer.toneMappingExposure = 0.88;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color('#0A0A0D');
    threeScene.fog = new THREE.Fog('#0A0A0D', 85, 240);

    // Calibrated Studio PBR reflections (prevents blown-out whites)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    threeScene.environment = envTex;
    (threeScene as any).environmentIntensity = 0.44;
    pmrem.dispose();

    // Balanced Architectural 3-Point Lighting Rig
    const hemi = new THREE.HemisphereLight('#DCE7F5', '#1F1F26', 0.42);
    threeScene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#FFF6E8', 0.92);
    keyLight.position.set(36, 48, 30);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -65;
    keyLight.shadow.camera.right = 65;
    keyLight.shadow.camera.top = 65;
    keyLight.shadow.camera.bottom = -65;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 160;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    threeScene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#93C5FD', 0.28);
    rimLight.position.set(-34, 26, -28);
    threeScene.add(rimLight);

    const nightLightsGroup = new THREE.Group();
    threeScene.add(nightLightsGroup);

    const perspCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 450);
    perspCamera.position.set(18, 23, 35);

    const aspect = width / height;
    const frustum = 32;
    const orthoCamera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      -150,
      450
    );
    orthoCamera.position.set(38, 34, 38);

    const orbit = new OrbitControls(perspCamera, renderer.domElement);
    orbit.target.set(18, 1.2, 11);
    orbit.enableDamping = !isSoftwareGl;
    orbit.dampingFactor = 0.08;
    orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    orbit.minDistance = 0.6;
    orbit.maxDistance = 190;
    orbit.update();

    const transform = new TransformControls(perspCamera, renderer.domElement);
    transform.setSize(0.75);
    threeScene.add(transform.getHelper());

    const contentGroup = new THREE.Group();
    threeScene.add(contentGroup);

    const navMeshGroup = new THREE.Group();
    threeScene.add(navMeshGroup);

    const heatmapGroup = new THREE.Group();
    threeScene.add(heatmapGroup);
    const heatmapCache = new Map<
      string,
      { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; mesh: THREE.Mesh }
    >();

    const gridHelper = new THREE.Group();
    threeScene.add(gridHelper);

    const clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
    const assetGroupMap = new Map<string, THREE.Object3D>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const keys = new Set<string>();

    // Coalesced on-demand renderer with software-WebGL fence pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;
    let lastTickTime = performance.now();

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 75);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastTickTime) / 1000);
        lastTickTime = now;

        const eng = engineRef.current;
        let needsAnother = false;

        if (eng) {
          if (eng.camTargetPos && eng.camTargetLook && eng.activeCamera === eng.perspCamera) {
            const k = 6.5;
            eng.perspCamera.position.x = THREE.MathUtils.damp(eng.perspCamera.position.x, eng.camTargetPos.x, k, dt);
            eng.perspCamera.position.y = THREE.MathUtils.damp(eng.perspCamera.position.y, eng.camTargetPos.y, k, dt);
            eng.perspCamera.position.z = THREE.MathUtils.damp(eng.perspCamera.position.z, eng.camTargetPos.z, k, dt);
            eng.orbit.target.x = THREE.MathUtils.damp(eng.orbit.target.x, eng.camTargetLook.x, k, dt);
            eng.orbit.target.y = THREE.MathUtils.damp(eng.orbit.target.y, eng.camTargetLook.y, k, dt);
            eng.orbit.target.z = THREE.MathUtils.damp(eng.orbit.target.z, eng.camTargetLook.z, k, dt);
            if (
              eng.perspCamera.position.distanceTo(eng.camTargetPos) < 0.08 &&
              eng.orbit.target.distanceTo(eng.camTargetLook) < 0.08
            ) {
              eng.perspCamera.position.copy(eng.camTargetPos);
              eng.orbit.target.copy(eng.camTargetLook);
              eng.camTargetPos = null;
              eng.camTargetLook = null;
            } else {
              needsAnother = true;
            }
          }

          // First-Person Character Walkthrough: NavMesh wall-sliding collision + Space Jump physics
          if (storeRef.current.firstPersonMode) {
            const activeFl = storeRef.current.scene.floors.find(
              (f) => f.id === storeRef.current.activeFloorId
            );
            const eyeBaseY = (activeFl?.elevation ?? 0) + 1.68;

            if (eng.keys.size > 0) {
              const speed = (eng.keys.has('ShiftLeft') || eng.keys.has('ShiftRight') ? 9.5 : 5.8) * dt;
              const forward = new THREE.Vector3();
              eng.perspCamera.getWorldDirection(forward);
              forward.y = 0;
              if (forward.lengthSq() > 0.0001) forward.normalize();
              const right = new THREE.Vector3()
                .crossVectors(forward, new THREE.Vector3(0, 1, 0))
                .normalize();
              const move = new THREE.Vector3();
              if (eng.keys.has('KeyW') || eng.keys.has('ArrowUp')) move.add(forward);
              if (eng.keys.has('KeyS') || eng.keys.has('ArrowDown')) move.sub(forward);
              if (eng.keys.has('KeyD') || eng.keys.has('ArrowRight')) move.add(right);
              if (eng.keys.has('KeyA') || eng.keys.has('ArrowLeft')) move.sub(right);
              if (move.lengthSq() > 0) {
                move.normalize().multiplyScalar(speed);
                const curX = eng.perspCamera.position.x;
                const curZ = eng.perspCamera.position.z;
                const desiredX = curX + move.x;
                const desiredZ = curZ + move.z;
                const resolved = eng.navMesh
                  ? eng.navMesh.resolveMove(curX, curZ, desiredX, desiredZ)
                  : { x: desiredX, z: desiredZ };
                const dx = resolved.x - curX;
                const dz = resolved.z - curZ;
                eng.perspCamera.position.x += dx;
                eng.perspCamera.position.z += dz;
                eng.orbit.target.x += dx;
                eng.orbit.target.z += dz;
                needsAnother = true;
              }
            }

            // Vertical Jump Physics (Spacebar)
            if (!eng.fpOnGround || Math.abs(eng.fpVelY) > 0.001) {
              eng.fpVelY -= 14.2 * dt;
              const nextY = eng.perspCamera.position.y + eng.fpVelY * dt;
              if (nextY <= eyeBaseY) {
                const dy = eyeBaseY - eng.perspCamera.position.y;
                eng.perspCamera.position.y = eyeBaseY;
                eng.orbit.target.y += dy;
                eng.fpVelY = 0;
                eng.fpOnGround = true;
              } else {
                const dy = nextY - eng.perspCamera.position.y;
                eng.perspCamera.position.y = nextY;
                eng.orbit.target.y += dy;
                needsAnother = true;
              }
            }

            // Throttled live sync for the handheld character tablet
            if (now - eng.lastFpUiSync > 160) {
              eng.lastFpUiSync = now;
              const cx = Number(eng.perspCamera.position.x.toFixed(1));
              const cz = Number(eng.perspCamera.position.z.toFixed(1));
              const jh = Math.max(0, Number((eng.perspCamera.position.y - eyeBaseY).toFixed(2)));
              const wp = eng.navMesh?.walkablePercent ?? 82;
              setFpState((prev) =>
                prev.x === cx && prev.z === cz && prev.jumpHeight === jh && prev.walkablePct === wp
                  ? prev
                  : { x: cx, z: cz, jumpHeight: jh, walkablePct: wp }
              );
            }
          }

          // Animated 3D Flow Pulse Beads
          if (storeRef.current.animateFlows && eng.flowPulses.length > 0) {
            for (const fp of eng.flowPulses) {
              fp.phase = (fp.phase + dt * fp.speed) % 1;
              const pt = fp.curve.getPointAt(fp.phase);
              fp.mesh.position.copy(pt);
            }
            if (!isSoftwareGl) needsAnother = true;
          }

          eng.orbit.update();
          renderer.render(threeScene, eng.activeCamera);
          projectPinsRef.current();
        }

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsAnother) requestRender();
        };

        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    orbit.addEventListener('start', () => {
      if (engineRef.current) {
        engineRef.current.camTargetPos = null;
        engineRef.current.camTargetLook = null;
      }
    });
    orbit.addEventListener('change', requestRender);

    transform.addEventListener('dragging-changed', (event: any) => {
      orbit.enabled = !event.value;
      if (!event.value && transform.object) {
        const assetId = transform.object.userData?.entityId;
        if (assetId && transform.object.userData?.entityType === 'asset') {
          const st = storeRef.current;
          const obj = transform.object;
          const nx = snapValue(obj.position.x, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid);
          const nz = snapValue(obj.position.z, st.snap.gridSize, st.snap.enabled && st.snap.snapToGrid);
          const asset = st.scene.assets.find((a) => a.id === assetId);
          if (asset) {
            st.updateAsset(
              assetId,
              {
                x: nx,
                z: nz,
                rotationY: Number(obj.rotation.y.toFixed(3)),
                width: Math.max(0.3, Number((asset.width * obj.scale.x).toFixed(2))),
                height: Math.max(0.3, Number((asset.height * obj.scale.y).toFixed(2))),
                depth: Math.max(0.3, Number((asset.depth * obj.scale.z).toFixed(2))),
              },
              true
            );
          }
        }
      }
      requestRender();
    });
    transform.addEventListener('change', requestRender);

    let pointerDownPos = { x: 0, y: 0 };
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();

    const getPointerNDC = (e: PointerEvent | MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const pickEntityAtEvent = (e: PointerEvent | MouseEvent) => {
      const eng = engineRef.current;
      if (!eng) return null;
      getPointerNDC(e);
      raycaster.setFromCamera(pointer, eng.activeCamera);
      const intersects = raycaster.intersectObjects(contentGroup.children, true);
      for (const hit of intersects) {
        let node: THREE.Object3D | null = hit.object;
        while (node && node !== contentGroup) {
          if (node.userData?.entityType && node.userData?.entityId) {
            return {
              entityType: String(node.userData.entityType),
              entityId: String(node.userData.entityId),
              buildingId: node.userData.buildingId ? String(node.userData.buildingId) : undefined,
            };
          }
          node = node.parent;
        }
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    let lastMoveRaycast = 0;
    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastMoveRaycast < 60) return;
      lastMoveRaycast = now;
      const eng = engineRef.current;
      if (!eng) return;
      getPointerNDC(e);
      raycaster.setFromCamera(pointer, eng.activeCamera);
      const activeFl = storeRef.current.scene.floors.find((f) => f.id === storeRef.current.activeFloorId);
      groundPlane.constant = -(activeFl?.elevation ?? 0);
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        storeRef.current.setCursorCoords({
          x: Number(hitPoint.x.toFixed(2)),
          y: Number((activeFl?.elevation ?? 0).toFixed(2)),
          z: Number(hitPoint.z.toFixed(2)),
        });
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (moved > 5) return;
      const eng = engineRef.current;
      if (!eng || transform.dragging) return;

      const st = storeRef.current;
      getPointerNDC(e);
      raycaster.setFromCamera(pointer, eng.activeCamera);

      const activeFl = st.scene.floors.find((f) => f.id === st.activeFloorId);
      const flElev = activeFl?.elevation ?? 0;
      groundPlane.constant = -flElev;

      if (st.activeTool === 'place-object') {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          st.addAsset(st.selectedObjectTemplateId, hitPoint.x, hitPoint.z);
          st.setActiveTool('select');
        }
        return;
      }

      if (st.activeTool === 'place-camera') {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          st.addCamera({
            floorId: st.activeFloorId,
            name: `Camera ${st.scene.cameras.length + 1}`,
            kind: 'security',
            group: 'Custom Cameras',
            position: [Number(hitPoint.x.toFixed(2)), 3.0, Number(hitPoint.z.toFixed(2))],
            target: [Number((hitPoint.x + 5).toFixed(2)), 1.3, Number((hitPoint.z + 3).toFixed(2))],
            fov: 60,
            focalLengthMm: 28,
            coverageRadius: 10,
            visibleCone: true,
            layerId: 'layer-cameras',
          });
          st.setActiveTool('select');
        }
        return;
      }

      if (st.activeTool === 'measure') {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          st.addMeasurePoint({
            x: snapValue(hitPoint.x, st.snap.gridSize, st.snap.enabled),
            z: snapValue(hitPoint.z, st.snap.gridSize, st.snap.enabled),
          });
        }
        return;
      }

      const picked = pickEntityAtEvent(e);

      if (st.activeTool === 'paint-material' && picked) {
        if (picked.entityType === 'room' || picked.entityType === 'wall' || picked.entityType === 'asset') {
          st.paintSurfaceWithMaterial(picked.entityType, picked.entityId, st.selectedMaterialId);
        }
        return;
      }

      if (st.activeTool === 'place-door' || st.activeTool === 'place-window') {
        if (picked?.entityType === 'wall') {
          st.addOpeningOnWall(picked.entityId, 0.5, st.selectedOpeningSubtype);
          st.setActiveTool('select');
        }
        return;
      }

      if (picked) {
        st.selectEntity({ type: picked.entityType as any, id: picked.entityId }, e.shiftKey);
      } else if (!e.shiftKey) {
        st.clearSelection();
      }
    };

    // Double-click 3D Spatial Drill-Down (Campus → Building → Floor → Room → Asset)
    const onDoubleClick = (e: MouseEvent) => {
      const st = storeRef.current;
      if (st.activeTool !== 'select') return;
      const picked = pickEntityAtEvent(e);
      if (!picked) return;

      if (st.drillLevel === 'campus') {
        if (picked.buildingId) {
          st.drillInto('building', picked.buildingId);
          return;
        }
        if (picked.entityType === 'floor') {
          const fl = st.scene.floors.find((f) => f.id === picked.entityId);
          if (fl) st.drillInto('building', fl.buildingId);
          return;
        }
      }
      if (picked.entityType === 'camera') {
        st.openLiveCamera(picked.entityId);
        return;
      }
      if (picked.entityType === 'asset') {
        const ast = st.scene.assets.find((a) => a.id === picked.entityId);
        if (ast && (ast.category === 'IT & Data Center' || ast.rackConfig)) {
          st.openRackDesigner(ast.id);
          return;
        }
        st.drillInto('asset', picked.entityId);
      } else if (picked.entityType === 'room') {
        st.drillInto('room', picked.entityId);
      } else if (picked.entityType === 'floor') {
        st.drillInto('floor', picked.entityId);
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const templateId = e.dataTransfer?.getData('application/x-gradian-object');
      const materialId = e.dataTransfer?.getData('application/x-gradian-material');
      const eng = engineRef.current;
      if (!eng) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, eng.activeCamera);

      const st = storeRef.current;
      const activeFl = st.scene.floors.find((f) => f.id === st.activeFloorId);
      groundPlane.constant = -(activeFl?.elevation ?? 0);

      if (templateId) {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          st.addAsset(templateId, hitPoint.x, hitPoint.z);
        }
      } else if (materialId) {
        const intersects = raycaster.intersectObjects(contentGroup.children, true);
        for (const hit of intersects) {
          let node: THREE.Object3D | null = hit.object;
          while (node && node !== contentGroup) {
            if (node.userData?.entityType === 'room' || node.userData?.entityType === 'wall' || node.userData?.entityType === 'asset') {
              st.paintSurfaceWithMaterial(node.userData.entityType, node.userData.entityId, materialId);
              return;
            }
            node = node.parent;
          }
        }
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      if (storeRef.current.firstPersonMode) {
        if (e.code === 'Space') {
          e.preventDefault();
          const eng = engineRef.current;
          if (eng && eng.fpOnGround) {
            eng.fpVelY = 4.9;
            eng.fpOnGround = false;
            requestRender();
          }
          return;
        }
        keys.add(e.code);
        requestRender();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);
    renderer.domElement.addEventListener('dragover', onDragOver);
    renderer.domElement.addEventListener('drop', onDrop);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const resizeObserver = new ResizeObserver(() => {
      if (!container || disposed) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 560;
      perspCamera.aspect = w / h;
      perspCamera.updateProjectionMatrix();
      const asp = w / h;
      orthoCamera.left = (-frustum * asp) / 2;
      orthoCamera.right = (frustum * asp) / 2;
      orthoCamera.top = frustum / 2;
      orthoCamera.bottom = -frustum / 2;
      orthoCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(container);

    (window as any).__gradianCapture3D = () => {
      if (!engineRef.current) return null;
      renderer.render(threeScene, engineRef.current.activeCamera);
      return renderer.domElement.toDataURL('image/png');
    };

    engineRef.current = {
      renderer,
      scene: threeScene,
      hemi,
      keyLight,
      rimLight,
      nightLightsGroup,
      navMeshGroup,
      navMesh: null,
      flowPulses: [],
      fpVelY: 0,
      fpOnGround: true,
      lastFpUiSync: 0,
      perspCamera,
      orthoCamera,
      activeCamera: perspCamera,
      orbit,
      transform,
      contentGroup,
      gridHelper,
      assetGroupMap,
      clippingPlane,
      camTargetPos: null,
      camTargetLook: null,
      heatmapGroup,
      heatmapCache,
      requestRender,
      raycaster,
      pointer,
      keys,
      dispose: () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        resizeObserver.disconnect();
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        renderer.domElement.removeEventListener('dblclick', onDoubleClick);
        renderer.domElement.removeEventListener('dragover', onDragOver);
        renderer.domElement.removeEventListener('drop', onDrop);
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        orbit.dispose();
        transform.dispose();
        heatmapCache.forEach((entry) => {
          entry.texture.dispose();
          entry.mesh.geometry.dispose();
          (entry.mesh.material as THREE.Material).dispose();
        });
        heatmapCache.clear();
        disposeObject3D(contentGroup);
        disposeObject3D(navMeshGroup);
        disposeObject3D(nightLightsGroup);
        disposeObject3D(gridHelper);
        envTex.dispose();
        renderer.dispose();
        delete (window as any).__gradianCapture3D;
      },
    };

    requestRender();

    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Update matte-charcoal / daylight / Night Mode architectural spotlights & exposure
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    disposeObject3D(eng.nightLightsGroup);
    eng.nightLightsGroup.clear();

    const isNight = lightingMode === 'night';
    const isDarkCanvas = canvasBackdrop === 'dark';
    const bg =
      renderStyle === 'wireframe'
        ? '#07090F'
        : isNight
          ? '#050508'
          : isDarkCanvas
            ? '#0B0B10'
            : '#E6E8EE';
    eng.scene.background = new THREE.Color(bg);
    eng.scene.fog = new THREE.Fog(bg, isNight ? 55 : 85, isNight ? 185 : 240);

    if (isNight) {
      eng.renderer.toneMappingExposure = 0.84;
      (eng.scene as any).environmentIntensity = 0.14;
      eng.hemi.intensity = 0.14;
      eng.hemi.color.set('#7C83B8');
      eng.hemi.groundColor.set('#09090D');
      eng.keyLight.intensity = 0.22;
      eng.keyLight.color.set('#A5B4FC');
      eng.rimLight.intensity = 0.16;
      eng.rimLight.color.set('#8B5CF6');

      // Minimal high-performance architectural SpotLights & ceiling LED pools (zero extra shadow maps)
      const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
      const flRooms = sceneData.rooms.filter((r) => r.floorId === activeFloorId);
      const elev = activeFl?.elevation ?? 0;
      const ceilY = elev + (activeFl?.height ?? 3.8) - 0.15;

      const lightTargets =
        flRooms.length > 0
          ? flRooms.slice(0, 5).map((r, i) => ({
              x: r.x + r.width / 2,
              z: r.z + r.depth / 2,
              color:
                i % 3 === 0 ? '#FDE68A' : i % 3 === 1 ? '#C4B5FD' : '#7DD3FC',
            }))
          : [
              { x: (activeFl?.width ?? 28) * 0.3, z: (activeFl?.depth ?? 18) * 0.5, color: '#FDE68A' },
              { x: (activeFl?.width ?? 28) * 0.7, z: (activeFl?.depth ?? 18) * 0.5, color: '#C4B5FD' },
            ];

      lightTargets.forEach((lt) => {
        const spot = new THREE.SpotLight(lt.color, 18, 26, Math.PI / 3.1, 0.58, 1.4);
        spot.position.set(lt.x, ceilY + 0.6, lt.z);
        spot.castShadow = false;
        const tgt = new THREE.Object3D();
        tgt.position.set(lt.x, elev, lt.z);
        eng.nightLightsGroup.add(tgt);
        spot.target = tgt;
        eng.nightLightsGroup.add(spot);

        // Sleek glowing architectural ceiling luminaire disc
        const disc = new THREE.Mesh(
          new THREE.CylinderGeometry(0.32, 0.36, 0.06, 16),
          new THREE.MeshBasicMaterial({ color: lt.color })
        );
        disc.position.set(lt.x, ceilY, lt.z);
        eng.nightLightsGroup.add(disc);
      });
    } else if (isDarkCanvas) {
      // Refined Charcoal Dark Studio Lighting (crisp silhouettes, zero overexposure)
      eng.renderer.toneMappingExposure = 0.9;
      (eng.scene as any).environmentIntensity = 0.45;
      eng.hemi.intensity = 0.44;
      eng.hemi.color.set('#E2E8F0');
      eng.hemi.groundColor.set('#181820');
      eng.keyLight.intensity = 0.96;
      eng.keyLight.color.set('#FFF7ED');
      eng.rimLight.intensity = 0.34;
      eng.rimLight.color.set('#A78BFA');
    } else {
      // Clean Bright Architectural Daylight Studio
      eng.renderer.toneMappingExposure = 0.92;
      (eng.scene as any).environmentIntensity = 0.52;
      eng.hemi.intensity = 0.58;
      eng.hemi.color.set('#F8FAFC');
      eng.hemi.groundColor.set('#CBD5E1');
      eng.keyLight.intensity = 0.95;
      eng.keyLight.color.set('#FFF9F0');
      eng.rimLight.intensity = 0.24;
      eng.rimLight.color.set('#93C5FD');
    }

    eng.requestRender();
  }, [canvasBackdrop, renderStyle, lightingMode, activeFloorId, sceneData.rooms, sceneData.floors]);

  // Automatic NavMesh Generation from Walls, Doors (carved passages), and Equipment Footprints
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
    disposeObject3D(eng.navMeshGroup);
    eng.navMeshGroup.clear();

    if (!activeFl) {
      eng.navMesh = null;
      return;
    }
    const flWalls = sceneData.walls.filter((w) => w.floorId === activeFl.id);
    const flOpenings = sceneData.openings.filter((o) => o.floorId === activeFl.id);
    const flAssets = sceneData.assets.filter((a) => a.floorId === activeFl.id && !a.hidden);

    const nm = buildFloorNavMesh(activeFl, flWalls, flOpenings, flAssets);
    eng.navMesh = nm;
    setFpState((prev) => ({ ...prev, walkablePct: nm.walkablePercent }));

    if (showNavMesh) {
      const vis = buildNavMeshVisualGroup(nm, activeFl.elevation + 0.06);
      eng.navMeshGroup.add(vis);
    }
    eng.requestRender();
  }, [
    activeFloorId,
    sceneData.floors,
    sceneData.walls,
    sceneData.openings,
    sceneData.assets,
    showNavMesh,
  ]);

  // Kick flow pulse animation loop whenever animateFlows toggles on
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !animateFlows) return;
    eng.requestRender();
    if (isSoftwareGl) {
      const id = window.setInterval(() => {
        engineRef.current?.requestRender();
      }, 220);
      return () => window.clearInterval(id);
    }
  }, [animateFlows]);

  // Switch Perspective / Orthographic / First-Person camera & preset angles
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
    const cx = activeFl ? activeFl.width / 2 : 16;
    const cz = activeFl ? activeFl.depth / 2 : 10;
    const cy = activeFl ? activeFl.elevation + 1.4 : 1.4;

    if (viewMode === '3d-ortho') {
      eng.activeCamera = eng.orthoCamera;
      eng.orbit.object = eng.orthoCamera;
      eng.transform.camera = eng.orthoCamera;

      const dist = 44;
      const map: Record<string, [number, number, number]> = {
        isometric: [cx + dist * 0.72, cy + dist * 0.68, cz + dist * 0.72],
        top: [cx, cy + dist, cz + 0.01],
        bottom: [cx, cy - dist, cz + 0.01],
        front: [cx, cy, cz + dist],
        back: [cx, cy, cz - dist],
        left: [cx - dist, cy, cz],
        right: [cx + dist, cy, cz],
      };
      const pos = map[orthoPreset] ?? map.isometric;
      eng.orthoCamera.position.set(pos[0], pos[1], pos[2]);
      eng.orbit.target.set(cx, cy, cz);
      eng.orthoCamera.zoom = 1.0;
      eng.orthoCamera.updateProjectionMatrix();
      eng.orbit.update();
    } else {
      eng.activeCamera = eng.perspCamera;
      eng.orbit.object = eng.perspCamera;
      eng.transform.camera = eng.perspCamera;
      if (firstPersonMode) {
        const spawn = eng.navMesh
          ? eng.navMesh.findNearestWalkable(cx - 4, cz + 2)
          : { x: cx - 4, z: cz + 2 };
        const eyeY = (activeFl?.elevation ?? 0) + 1.68;
        eng.fpVelY = 0;
        eng.fpOnGround = true;
        eng.camTargetPos = new THREE.Vector3(spawn.x, eyeY, spawn.z);
        eng.camTargetLook = new THREE.Vector3(spawn.x + 4, eyeY - 0.1, spawn.z);
        setFpState((prev) => ({ ...prev, x: Number(spawn.x.toFixed(1)), z: Number(spawn.z.toFixed(1)), jumpHeight: 0 }));
      }
    }
    eng.requestRender();
  }, [viewMode, orthoPreset, firstPersonMode, activeFloorId]);

  // Execute camera viewpoint flight commands
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !cameraCommand) return;
    if (cameraCommand.fov) {
      eng.perspCamera.fov = cameraCommand.fov;
      eng.perspCamera.updateProjectionMatrix();
    }
    eng.camTargetPos = new THREE.Vector3(...cameraCommand.position);
    eng.camTargetLook = new THREE.Vector3(...cameraCommand.target);
    eng.requestRender();
  }, [cameraCommand]);

  // Update TransformControls mode
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.transform.setMode(transformMode);
    eng.requestRender();
  }, [transformMode]);

  // Rebuild architectural floor grid
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    disposeObject3D(eng.gridHelper);
    eng.gridHelper.clear();

    if (snap.showGrid) {
      const isCampusOrOrgIso = drillLevel === 'campus' || isolatedAssetType !== null;
      const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
      const campusSpan = isCampusOrOrgIso
        ? Math.max(90, ...sceneData.buildings.map((b) => b.originX + b.width + 24))
        : Math.max(activeFl?.width ?? 40, activeFl?.depth ?? 40) + 20;
      const divisions = Math.max(16, Math.min(120, Math.round(campusSpan / Math.max(1, snap.gridSize * (isCampusOrOrgIso ? 2 : 1)))));
      const grid = new THREE.GridHelper(
        campusSpan,
        divisions,
        renderStyle === 'wireframe' ? 0x0ea5e9 : canvasBackdrop === 'dark' ? 0x27272a : 0xa1a1aa,
        renderStyle === 'wireframe' ? 0x0c4a6e : canvasBackdrop === 'dark' ? 0x18181b : 0xd4d4d8
      );
      grid.position.set(
        isCampusOrOrgIso ? campusSpan * 0.35 : (activeFl?.width ?? 36) / 2,
        isCampusOrOrgIso ? -0.06 : (activeFl?.elevation ?? 0) - 0.04,
        (activeFl?.depth ?? 22) / 2
      );
      const mat = grid.material as THREE.Material;
      mat.transparent = true;
      mat.opacity = Math.min(0.65, snap.gridOpacity + 0.1);
      eng.gridHelper.add(grid);
    }
    eng.requestRender();
  }, [snap.showGrid, snap.gridSize, snap.gridOpacity, activeFloorId, canvasBackdrop, drillLevel, isolatedAssetType, renderStyle, sceneData.buildings]);

  // Rebuild 3D Spatial Scene Graph cleanly whenever geometry/drill/isolation/renderStyle changes
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    eng.transform.detach();
    disposeObject3D(eng.contentGroup);
    eng.contentGroup.clear();
    eng.assetGroupMap.clear();
    eng.flowPulses = [];

    const maxAniso = eng.renderer.capabilities.getMaxAnisotropy();
    const allMats: MaterialDef[] = [...DEFAULT_MATERIALS, ...sceneData.customMaterials];
    const getMat = (id: string, tint?: string) => {
      const def = allMats.find((m) => m.id === id) ?? DEFAULT_MATERIALS[0];
      return getProceduralMaterial(def, tint, maxAniso, isSoftwareGl);
    };

    const isLayerVisible = (layerId: string) => {
      const l = sceneData.layers.find((x) => x.id === layerId);
      return l ? l.visible : true;
    };

    const isOrgIsolation = isolatedAssetType !== null;
    const isMultiBuilding = drillLevel === 'campus' || isOrgIsolation;
    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);

    const buildingsToRender: Building[] = isMultiBuilding
      ? sceneData.buildings
      : sceneData.buildings.filter((b) => b.id === activeBuildingId);

    // Global Multi-Axis Section Cut Clipping Plane (clips ALL meshes including procedural sub-meshes)
    const clipPlanes: THREE.Plane[] = [];
    if (sectionCutEnabled) {
      const sign = sectionCutFlipped ? 1 : -1;
      if (sectionCutAxis === 'y') {
        const cutPos = (activeFl?.elevation ?? 0) + sectionCutHeight;
        eng.clippingPlane.normal.set(0, sign, 0);
        eng.clippingPlane.constant = -sign * cutPos;
      } else if (sectionCutAxis === 'x') {
        eng.clippingPlane.normal.set(sign, 0, 0);
        eng.clippingPlane.constant = -sign * sectionCutHeight;
      } else {
        eng.clippingPlane.normal.set(0, 0, sign);
        eng.clippingPlane.constant = -sign * sectionCutHeight;
      }
      clipPlanes.push(eng.clippingPlane);
      eng.renderer.clippingPlanes = [eng.clippingPlane];
    } else {
      eng.renderer.clippingPlanes = [];
    }

    const selectedSet = new Set(selected.map((s) => `${s.type}:${s.id}`));

    buildingsToRender.forEach((bldg) => {
      const bldgGroup = new THREE.Group();
      if (isMultiBuilding) {
        bldgGroup.position.set(bldg.originX, 0, bldg.originZ);
      }
      bldgGroup.userData = { entityType: 'building', entityId: bldg.id, buildingId: bldg.id };
      eng.contentGroup.add(bldgGroup);

      const bldgFloors: Floor[] =
        isMultiBuilding || showAllFloors || drillLevel === 'building'
          ? sceneData.floors.filter((f) => f.buildingId === bldg.id)
          : activeFl && activeFl.buildingId === bldg.id
            ? [activeFl]
            : [];

      bldgFloors.forEach((floor) => {
        const floorGroup = new THREE.Group();
        const explodedOffset = explodedFactor * floor.levelIndex * 5.2;
        floorGroup.position.y = floor.elevation + explodedOffset;
        floorGroup.userData = { entityType: 'floor', entityId: floor.id, buildingId: bldg.id };
        bldgGroup.add(floorGroup);

        const splitMidX = floor.width * 0.5;
        const isWireframeAtX = (xVal: number) =>
          renderStyle === 'wireframe' || (renderStyle === 'blueprint-split' && xVal >= splitMidX);

        // Twin-Split Glowing Vertical Holographic Divider Plane
        if (renderStyle === 'blueprint-split' && !isOrgIsolation) {
          const scanPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(floor.depth + 2.4, floor.height + 1.4),
            new THREE.MeshBasicMaterial({
              color: '#38BDF8',
              transparent: true,
              opacity: 0.14,
              side: THREE.DoubleSide,
              depthWrite: false,
            })
          );
          scanPlane.rotation.y = Math.PI / 2;
          scanPlane.position.set(splitMidX, floor.height / 2, floor.depth / 2);
          floorGroup.add(scanPlane);

          const scanRim = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(floor.depth + 2.4, floor.height + 1.4)),
            new THREE.LineBasicMaterial({ color: '#38BDF8', transparent: true, opacity: 0.85 })
          );
          scanRim.rotation.y = Math.PI / 2;
          scanRim.position.copy(scanPlane.position);
          floorGroup.add(scanRim);
        }

        // 1. Floor Slab + Perimeter Architectural Columns (hyper-realistic detailing)
        if (isLayerVisible('layer-architecture')) {
          if (isOrgIsolation || renderStyle === 'wireframe') {
            const ghostSlab = new THREE.Mesh(
              new THREE.BoxGeometry(floor.width, floor.slabThickness, floor.depth),
              new THREE.MeshBasicMaterial({
                color: '#0EA5E9',
                transparent: true,
                opacity: isOrgIsolation ? 0.08 : 0.12,
                depthWrite: false,
              })
            );
            ghostSlab.position.set(floor.width / 2, -floor.slabThickness / 2, floor.depth / 2);
            ghostSlab.userData = { entityType: 'floor', entityId: floor.id, buildingId: bldg.id };
            floorGroup.add(ghostSlab);

            const slabEdge = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(floor.width, floor.slabThickness, floor.depth)),
              new THREE.LineBasicMaterial({
                color: isOrgIsolation ? '#38BDF8' : '#0EA5E9',
                transparent: true,
                opacity: isOrgIsolation ? 0.45 : 0.72,
              })
            );
            slabEdge.position.copy(ghostSlab.position);
            floorGroup.add(slabEdge);
          } else {
            const slabMat = getMat(floor.slabMaterialId);
            slabMat.clippingPlanes = clipPlanes;
            const slab = new THREE.Mesh(
              new THREE.BoxGeometry(floor.width, floor.slabThickness, floor.depth),
              slabMat
            );
            slab.position.set(floor.width / 2, -floor.slabThickness / 2, floor.depth / 2);
            slab.receiveShadow = true;
            slab.userData = { entityType: 'floor', entityId: floor.id, buildingId: bldg.id };
            floorGroup.add(slab);

            const slabEdge = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(floor.width, floor.slabThickness, floor.depth)),
              new THREE.LineBasicMaterial({ color: renderStyle === 'blueprint-split' ? '#38BDF8' : '#3F3F46' })
            );
            slabEdge.position.copy(slab.position);
            floorGroup.add(slabEdge);

            // Structural corner & perimeter columns for hyper-realistic architectural grounding
            const colMat = new THREE.MeshStandardMaterial({
              color: '#52525B',
              roughness: 0.42,
              metalness: 0.55,
              clippingPlanes: clipPlanes,
            });
            const colPositions: [number, number][] = [
              [0.2, 0.2],
              [floor.width - 0.2, 0.2],
              [0.2, floor.depth - 0.2],
              [floor.width - 0.2, floor.depth - 0.2],
              [floor.width / 2, 0.2],
              [floor.width / 2, floor.depth - 0.2],
            ];
            colPositions.forEach(([cx, cz]) => {
              const wire = isWireframeAtX(cx);
              const colGeo = new THREE.BoxGeometry(0.32, floor.height, 0.32);
              const col = new THREE.Mesh(
                colGeo,
                wire
                  ? new THREE.MeshBasicMaterial({ color: '#0284C7', transparent: true, opacity: 0.14, depthWrite: false })
                  : colMat
              );
              col.position.set(cx, floor.height / 2, cz);
              if (!wire) {
                col.castShadow = true;
                col.receiveShadow = true;
              } else {
                col.add(
                  new THREE.LineSegments(
                    new THREE.EdgesGeometry(colGeo),
                    new THREE.LineBasicMaterial({ color: '#38BDF8', transparent: true, opacity: 0.8 })
                  )
                );
              }
              floorGroup.add(col);
            });
          }
        }

        // 2. Reference Blueprint Overlays
        if (isLayerVisible('layer-references') && !isOrgIsolation) {
          sceneData.references
            .filter((r) => r.floorId === floor.id && r.visible)
            .forEach((refPlan) => {
              const tex = new THREE.TextureLoader().load(refPlan.dataUrl, () => eng.requestRender());
              tex.colorSpace = THREE.SRGBColorSpace;
              const refMesh = new THREE.Mesh(
                new THREE.PlaneGeometry(refPlan.width, refPlan.depth),
                new THREE.MeshBasicMaterial({
                  map: tex,
                  transparent: true,
                  opacity: refPlan.opacity,
                  depthWrite: false,
                  side: THREE.DoubleSide,
                })
              );
              refMesh.rotation.x = -Math.PI / 2;
              refMesh.rotation.z = -(refPlan.rotationDeg * Math.PI) / 180;
              refMesh.position.set(refPlan.x + refPlan.width / 2, refPlan.elevation + 0.015, refPlan.z + refPlan.depth / 2);
              refMesh.userData = { entityType: 'reference', entityId: refPlan.id, buildingId: bldg.id };
              floorGroup.add(refMesh);
            });
        }

        // 3. Rooms (Floor Finish Surfaces + Drill Focus Highlight + Blueprint Wireframe)
        if (isLayerVisible('layer-architecture')) {
          sceneData.rooms
            .filter((r) => r.floorId === floor.id && r.activeFromDate <= timelineDate)
            .forEach((room: Room) => {
              if (!isOrgIsolation && isolatedIds.length > 0 && !isolatedIds.includes(room.id)) return;
              const isSel = selectedSet.has(`room:${room.id}`);
              const isRoomDrilled = drillLevel === 'room' && activeRoomId === room.id;
              const isDimmedByRoomDrill = drillLevel === 'room' && activeRoomId && activeRoomId !== room.id;
              const roomCenterX = room.x + room.width / 2;
              const wireMode = isWireframeAtX(roomCenterX);

              if (isOrgIsolation || wireMode) {
                const rmGeo = new THREE.BoxGeometry(room.width, 0.04, room.depth);
                const rmMesh = new THREE.Mesh(
                  rmGeo,
                  new THREE.MeshBasicMaterial({
                    color: '#0EA5E9',
                    transparent: true,
                    opacity: isOrgIsolation ? 0.06 : 0.14,
                    depthWrite: false,
                  })
                );
                rmMesh.position.set(roomCenterX, 0.02, room.z + room.depth / 2);
                rmMesh.userData = { entityType: 'room', entityId: room.id, buildingId: bldg.id };
                floorGroup.add(rmMesh);

                const rmEdge = new THREE.LineSegments(
                  new THREE.EdgesGeometry(rmGeo),
                  new THREE.LineBasicMaterial({
                    color: isSel ? '#10B981' : '#38BDF8',
                    transparent: true,
                    opacity: isOrgIsolation ? 0.3 : 0.72,
                  })
                );
                rmEdge.position.copy(rmMesh.position);
                floorGroup.add(rmEdge);
              } else {
                const isLineFailRoom = activeLineHighlight?.failingRoomIds.includes(room.id) ?? false;
                const isLineOkRoom = activeLineHighlight?.compliantRoomIds.includes(room.id) ?? false;
                const useTint = isLineFailRoom
                  ? '#EF4444'
                  : isLineOkRoom
                    ? activeLineHighlight?.eligible
                      ? '#10B981'
                      : '#34D399'
                    : analyticsMetric !== 'none'
                      ? getRoomColorForAnalytics(room, analyticsMetric)
                      : undefined;
                const floorMat = getMat(room.floorMaterialId, useTint);
                floorMat.polygonOffset = true;
                floorMat.polygonOffsetFactor = -1;
                floorMat.polygonOffsetUnits = -1;
                floorMat.clippingPlanes = clipPlanes;
                if (isDimmedByRoomDrill) {
                  floorMat.transparent = true;
                  floorMat.opacity = 0.25;
                }

                const rmMesh = new THREE.Mesh(new THREE.BoxGeometry(room.width, 0.04, room.depth), floorMat);
                rmMesh.position.set(roomCenterX, 0.02, room.z + room.depth / 2);
                rmMesh.receiveShadow = true;
                rmMesh.userData = { entityType: 'room', entityId: room.id, buildingId: bldg.id };
                floorGroup.add(rmMesh);

                if (isSel || isRoomDrilled) {
                  const selOutline = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.BoxGeometry(room.width, 0.09, room.depth)),
                    new THREE.LineBasicMaterial({ color: isRoomDrilled ? '#10B981' : '#3B82F6' })
                  );
                  selOutline.position.set(roomCenterX, 0.06, room.z + room.depth / 2);
                  floorGroup.add(selOutline);
                }
              }
            });
        }

        // 4. Walls with Automatic Door & Window Opening Cuts + Wireframe/Ghost Support
        if (isLayerVisible('layer-walls')) {
          const floorOpenings = isLayerVisible('layer-openings')
            ? sceneData.openings.filter((o) => o.floorId === floor.id)
            : [];

          sceneData.walls
            .filter((w) => w.floorId === floor.id && w.activeFromDate <= timelineDate)
            .forEach((wall: Wall) => {
              const dx = wall.x2 - wall.x1;
              const dz = wall.z2 - wall.z1;
              const len = Math.hypot(dx, dz);
              if (len < 0.05) return;

              const midX = (wall.x1 + wall.x2) / 2;
              const wireMode = isWireframeAtX(midX);
              const angle = Math.atan2(dz, dx);
              const wallGroup = new THREE.Group();
              wallGroup.position.set(wall.x1, wall.elevation, wall.z1);
              wallGroup.rotation.y = -angle;
              wallGroup.userData = { entityType: 'wall', entityId: wall.id, buildingId: bldg.id };

              if (isOrgIsolation) {
                // Ultra-clean ghost architectural wall outline so isolated assets pop cleanly
                const ghostGeo = new THREE.BoxGeometry(len, wall.height, wall.thickness);
                const ghostEdge = new THREE.LineSegments(
                  new THREE.EdgesGeometry(ghostGeo),
                  new THREE.LineBasicMaterial({
                    color: '#38BDF8',
                    transparent: true,
                    opacity: 0.16,
                  })
                );
                ghostEdge.position.set(len / 2, wall.height / 2, 0);
                wallGroup.add(ghostEdge);
                floorGroup.add(wallGroup);
                return;
              }

              const isSel = selectedSet.has(`wall:${wall.id}`);
              const wallMat = wireMode
                ? new THREE.MeshBasicMaterial({
                    color: '#0284C7',
                    transparent: true,
                    opacity: 0.12,
                    depthWrite: false,
                    clippingPlanes: clipPlanes,
                  })
                : getMat(wall.materialId, isSel ? '#60A5FA' : undefined);

              if (!wireMode) {
                wallMat.opacity = drillLevel === 'room' && activeRoomId && wall.roomId !== activeRoomId ? 0.18 : wall.opacity;
                wallMat.transparent = wallMat.opacity < 0.98;
                wallMat.clippingPlanes = clipPlanes;
              }

              const addWallSeg = (segW: number, segH: number, posX: number, posY: number) => {
                const segGeo = new THREE.BoxGeometry(segW, segH, wall.thickness);
                const seg = new THREE.Mesh(segGeo, wallMat);
                seg.position.set(posX, posY, 0);
                if (!wireMode) {
                  seg.castShadow = true;
                  seg.receiveShadow = true;
                  // Crisp architectural seam edge lines so light cleanroom walls never visually bleed together
                  seg.add(
                    new THREE.LineSegments(
                      new THREE.EdgesGeometry(segGeo, 28),
                      new THREE.LineBasicMaterial({
                        color: isSel ? '#8B5CF6' : '#3F3F46',
                        transparent: true,
                        opacity: isSel ? 0.85 : 0.34,
                      })
                    )
                  );
                } else {
                  seg.add(
                    new THREE.LineSegments(
                      new THREE.EdgesGeometry(segGeo),
                      new THREE.LineBasicMaterial({
                        color: isSel ? '#10B981' : '#38BDF8',
                        transparent: true,
                        opacity: 0.72,
                        clippingPlanes: clipPlanes,
                      })
                    )
                  );
                }
                wallGroup.add(seg);
              };

              const hostOpenings = floorOpenings
                .filter((o) => o.wallId === wall.id)
                .sort((a, b) => a.offsetRatio - b.offsetRatio);

              let cursor = 0;
              hostOpenings.forEach((op) => {
                const centerDist = op.offsetRatio * len;
                const start = Math.max(cursor, centerDist - op.width / 2);
                const end = Math.min(len, centerDist + op.width / 2);

                if (start - cursor > 0.04) {
                  addWallSeg(start - cursor, wall.height, cursor + (start - cursor) / 2, wall.height / 2);
                }

                const opW = Math.max(0.2, end - start);
                const opCenter = start + opW / 2;

                if (op.sillHeight > 0.04) {
                  addWallSeg(opW, op.sillHeight, opCenter, op.sillHeight / 2);
                }

                const topY = op.sillHeight + op.height;
                if (wall.height - topY > 0.04) {
                  const hdrH = wall.height - topY;
                  addWallSeg(opW, hdrH, opCenter, topY + hdrH / 2);
                }

                if (!wireMode) {
                  const opGroup = new THREE.Group();
                  opGroup.position.set(opCenter, op.sillHeight, 0);
                  opGroup.userData = { entityType: 'opening', entityId: op.id, buildingId: bldg.id };
                  const opSelected = selectedSet.has(`opening:${op.id}`);
                  const frameMat = new THREE.MeshStandardMaterial({
                    color: opSelected ? '#3B82F6' : op.frameColor,
                    roughness: 0.35,
                    metalness: 0.6,
                    clippingPlanes: clipPlanes,
                  });

                  const jambT = 0.06;
                  const leftJ = new THREE.Mesh(new THREE.BoxGeometry(jambT, op.height, wall.thickness + 0.04), frameMat);
                  leftJ.position.set(-opW / 2 + jambT / 2, op.height / 2, 0);
                  opGroup.add(leftJ);

                  const rightJ = new THREE.Mesh(new THREE.BoxGeometry(jambT, op.height, wall.thickness + 0.04), frameMat);
                  rightJ.position.set(opW / 2 - jambT / 2, op.height / 2, 0);
                  opGroup.add(rightJ);

                  const topJ = new THREE.Mesh(new THREE.BoxGeometry(opW, jambT, wall.thickness + 0.04), frameMat);
                  topJ.position.set(0, op.height - jambT / 2, 0);
                  opGroup.add(topJ);

                  if (op.kind === 'window') {
                    const paneMat = new THREE.MeshStandardMaterial({
                      color: '#BAE6FD',
                      roughness: 0.08,
                      metalness: 0.15,
                      transparent: true,
                      opacity: 0.38,
                      depthWrite: false,
                      clippingPlanes: clipPlanes,
                    });
                    const pane = new THREE.Mesh(new THREE.BoxGeometry(opW - jambT * 2, op.height - jambT * 2, 0.03), paneMat);
                    pane.position.set(0, op.height / 2, 0);
                    opGroup.add(pane);
                  } else {
                    const leafMat = new THREE.MeshStandardMaterial({
                      color: op.subtype === 'glass-door' ? '#BAE6FD' : '#E2E8F0',
                      roughness: 0.32,
                      metalness: 0.25,
                      transparent: op.subtype === 'glass-door',
                      opacity: op.subtype === 'glass-door' ? 0.45 : 1,
                      clippingPlanes: clipPlanes,
                    });
                    const leaf = new THREE.Mesh(new THREE.BoxGeometry(opW - jambT * 2, op.height - jambT, 0.05), leafMat);
                    leaf.position.set(0, op.height / 2, 0);
                    if (op.status === 'open') {
                      leaf.rotation.y = Math.PI / 4;
                      leaf.position.z = opW * 0.28;
                    }
                    opGroup.add(leaf);
                  }
                  wallGroup.add(opGroup);
                }
                cursor = end;
              });

              if (len - cursor > 0.04) {
                addWallSeg(len - cursor, wall.height, cursor + (len - cursor) / 2, wall.height / 2);
              }

              floorGroup.add(wallGroup);
            });
        }

        // 5. Intelligent 3D Industrial & Lab Equipment Assets
        sceneData.assets
          .filter((a) => a.floorId === floor.id && !a.hidden && a.installationDate <= timelineDate)
          .forEach((asset) => {
            if (!isLayerVisible(asset.layerId)) return;
            if (isOrgIsolation) {
              const matchesIsolatedType =
                asset.templateId === isolatedAssetType.templateId ||
                asset.archetype === isolatedAssetType.archetype;
              if (!matchesIsolatedType) return;
            } else if (isolatedIds.length > 0 && !isolatedIds.includes(asset.id)) {
              return;
            }

            const isLineFailAsset = activeLineHighlight?.failingAssetIds.includes(asset.id) ?? false;
            const isLineOkAsset = activeLineHighlight?.compliantAssetIds.includes(asset.id) ?? false;
            const isSel = selectedSet.has(`asset:${asset.id}`);
            let statusTint: string | null = null;
            if (isLineFailAsset) {
              statusTint = '#EF4444';
            } else if (isLineOkAsset) {
              statusTint = '#10B981';
            } else if (analyticsMetric === 'maintenance') {
              statusTint = asset.operationalStatus === 'maintenance-due' ? '#F59E0B' : '#16A34A';
            } else if (analyticsMetric === 'utilization') {
              statusTint = asset.utilizationPct >= 85 ? '#DC2626' : asset.utilizationPct >= 70 ? '#D97706' : '#16A34A';
            } else if (analyticsMetric === 'risk') {
              statusTint = asset.criticality === 'gmp-critical' ? '#DC2626' : asset.criticality === 'high' ? '#EA580C' : '#16A34A';
            }

            const mat = getMat(asset.materialId, asset.color);
            mat.clippingPlanes = clipPlanes;

            const assetGroup = buildProceduralEquipmentGroup(asset, mat, isSel, statusTint);
            assetGroup.position.set(asset.x, asset.y + 0.04, asset.z);
            assetGroup.rotation.set(asset.rotationX, asset.rotationY, asset.rotationZ);
            assetGroup.userData = { entityType: 'asset', entityId: asset.id, buildingId: bldg.id };

            if (!isOrgIsolation && isWireframeAtX(asset.x)) {
              applyBlueprintWireframeToGroup(assetGroup, '#38BDF8', 0.16, clipPlanes);
            }

            // Glowing emerald/crimson beacon ring around matched assets during Org-Wide Isolation OR Production Line Eligibility Check
            if (isOrgIsolation || isLineFailAsset || isLineOkAsset) {
              const beaconHex = isLineFailAsset ? '#EF4444' : '#10B981';
              const ringR = Math.max(asset.width, asset.depth) * 0.68 + 0.35;
              const ring = new THREE.Mesh(
                new THREE.RingGeometry(ringR - 0.14, ringR, 36),
                new THREE.MeshBasicMaterial({
                  color: beaconHex,
                  side: THREE.DoubleSide,
                  transparent: true,
                  opacity: 0.94,
                })
              );
              ring.rotation.x = -Math.PI / 2;
              ring.position.y = 0.04;
              assetGroup.add(ring);

              // Subtle vertical locator line above the asset
              const beaconPts = [
                new THREE.Vector3(0, asset.height + 0.15, 0),
                new THREE.Vector3(0, asset.height + 1.85, 0),
              ];
              const beaconLine = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(beaconPts),
                new THREE.LineBasicMaterial({ color: beaconHex, transparent: true, opacity: 0.82 })
              );
              assetGroup.add(beaconLine);

              const beaconDot = new THREE.Mesh(
                new THREE.SphereGeometry(0.16, 12, 12),
                new THREE.MeshBasicMaterial({ color: '#34D399' })
              );
              beaconDot.position.set(0, asset.height + 1.9, 0);
              assetGroup.add(beaconDot);
            }

            floorGroup.add(assetGroup);
            eng.assetGroupMap.set(asset.id, assetGroup);
          });

        // 6. 3D Cameras & FOV Cones
        if (isLayerVisible('layer-cameras') && !isOrgIsolation) {
          sceneData.cameras
            .filter((c) => c.floorId === floor.id)
            .forEach((cam) => {
              const camGrp = new THREE.Group();
              camGrp.position.set(cam.position[0], cam.position[1], cam.position[2]);
              camGrp.lookAt(cam.target[0], cam.target[1], cam.target[2]);
              camGrp.userData = { entityType: 'camera', entityId: cam.id, buildingId: bldg.id };

              const isSel = selectedSet.has(`camera:${cam.id}`);
              const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.32, 0.22, 0.42),
                new THREE.MeshStandardMaterial({
                  color: isSel ? '#3B82F6' : '#10B981',
                  roughness: 0.3,
                  metalness: 0.5,
                })
              );
              camGrp.add(body);

              if (cam.visibleCone) {
                const coneLen = Math.min(8, cam.coverageRadius * 0.55);
                const coneR = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * coneLen * 0.55;
                const cone = new THREE.Mesh(
                  new THREE.ConeGeometry(coneR, coneLen, 16, 1, true),
                  new THREE.MeshBasicMaterial({
                    color: isSel ? '#3B82F6' : '#10B981',
                    transparent: true,
                    opacity: 0.14,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                  })
                );
                cone.rotation.x = -Math.PI / 2;
                cone.position.z = coneLen / 2;
                camGrp.add(cone);
              }
              floorGroup.add(camGrp);
            });
        }

        // 7. 3D Flow & Connectivity Ribbons + Animated Pulse Beads
        if (isLayerVisible('layer-flows') && !isOrgIsolation) {
          sceneData.flows
            .filter((f) => f.floorId === floor.id && f.points.length >= 2)
            .forEach((flow) => {
              const pts = flow.points.map((p) => new THREE.Vector3(p.x, 0.24, p.z));
              const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
              const tubeGeo = new THREE.TubeGeometry(curve, Math.max(14, pts.length * 10), 0.085, 8, false);
              const isSel = selectedSet.has(`flow:${flow.id}`);
              const tubeMat = new THREE.MeshStandardMaterial({
                color: isSel ? '#FFFFFF' : flow.color,
                emissive: flow.color,
                emissiveIntensity: lightingMode === 'night' ? 0.85 : 0.42,
                roughness: 0.3,
                metalness: 0.2,
              });
              const mesh = new THREE.Mesh(tubeGeo, tubeMat);
              mesh.userData = { entityType: 'flow', entityId: flow.id, buildingId: bldg.id };
              floorGroup.add(mesh);

              // Animated glowing flow packets traveling along the route
              if (animateFlows && flow.animated !== false) {
                const pulseCount = Math.min(4, Math.max(2, Math.round(curve.getLength() / 6)));
                for (let pIdx = 0; pIdx < pulseCount; pIdx++) {
                  const bead = new THREE.Mesh(
                    new THREE.SphereGeometry(0.17, 10, 10),
                    new THREE.MeshBasicMaterial({ color: '#FFFFFF' })
                  );
                  const halo = new THREE.Mesh(
                    new THREE.SphereGeometry(0.28, 10, 10),
                    new THREE.MeshBasicMaterial({
                      color: flow.color,
                      transparent: true,
                      opacity: 0.45,
                      depthWrite: false,
                    })
                  );
                  bead.add(halo);
                  const phase = pIdx / pulseCount;
                  bead.position.copy(curve.getPointAt(phase));
                  floorGroup.add(bead);
                  eng.flowPulses.push({
                    mesh: bead,
                    curve,
                    phase,
                    speed: 0.18 + (pIdx % 2) * 0.03,
                  });
                }
              }

              const last = pts[pts.length - 1];
              const prev = pts[pts.length - 2];
              const dir = new THREE.Vector3().subVectors(last, prev).normalize();
              const arrow = new THREE.Mesh(
                new THREE.ConeGeometry(0.24, 0.52, 10),
                new THREE.MeshStandardMaterial({
                  color: flow.color,
                  emissive: flow.color,
                  emissiveIntensity: lightingMode === 'night' ? 0.9 : 0.45,
                })
              );
              arrow.position.copy(last);
              arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
              floorGroup.add(arrow);
            });
        }

        // 8. Measurement Tape Line in 3D
        if (measurePoints.length === 2 && floor.id === activeFloorId) {
          const p1 = new THREE.Vector3(measurePoints[0].x, 0.2, measurePoints[0].z);
          const p2 = new THREE.Vector3(measurePoints[1].x, 0.2, measurePoints[1].z);
          const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
          const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#F59E0B' }));
          floorGroup.add(line);
        }

        // 9. AI Copilot Proposed Action Ghost Previews
        if (floor.id === activeFloorId && pendingAIActions.length > 0) {
          pendingAIActions.forEach((act) => {
            if (act.type === 'create_room') {
              const w = act.width ?? 10;
              const d = act.depth ?? 8;
              const h = act.height ?? 3.6;
              const ghost = new THREE.Mesh(
                new THREE.BoxGeometry(w, h, d),
                new THREE.MeshBasicMaterial({ color: '#38BDF8', transparent: true, opacity: 0.24, depthWrite: false })
              );
              ghost.position.set((act.x ?? 4) + w / 2, h / 2, (act.z ?? 4) + d / 2);
              floorGroup.add(ghost);
            } else if (act.type === 'place_equipment') {
              const count = Math.min(6, Math.max(1, act.count ?? 1));
              for (let i = 0; i < count; i++) {
                const gx = (act.x ?? 6) + i * ((act.clearance ?? 1.2) + 1.8);
                const gz = act.z ?? 6;
                const ghost = new THREE.Mesh(
                  new THREE.BoxGeometry(1.8, 2.4, 1.8),
                  new THREE.MeshBasicMaterial({ color: '#38BDF8', wireframe: true })
                );
                ghost.position.set(gx, 1.2, gz);
                floorGroup.add(ghost);
              }
            }
          });
        }
      });
    });

    // Attach TransformControls to single selected asset (when not in multi-building isolation)
    if (!isMultiBuilding && selected.length === 1 && selected[0].type === 'asset' && activeTool === 'select') {
      const targetObj = eng.assetGroupMap.get(selected[0].id);
      if (targetObj) {
        eng.transform.attach(targetObj);
      }
    }

    eng.requestRender();
  }, [
    sceneData,
    activeFloorId,
    activeBuildingId,
    activeRoomId,
    drillLevel,
    showAllFloors,
    renderStyle,
    selected,
    isolatedIds,
    isolatedAssetType,
    analyticsMetric,
    sectionCutEnabled,
    sectionCutHeight,
    sectionCutAxis,
    sectionCutFlipped,
    lightingMode,
    animateFlows,
    explodedFactor,
    timelineDate,
    activeTool,
    pendingAIActions,
    measurePoints,
    activeLineHighlight,
  ]);

  // Real-Time 3D Environmental Heatmap Overlay (Updates CanvasTexture in-place without rebuilding geometry)
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;

    if (heatmapMetric === 'none') {
      eng.heatmapGroup.visible = false;
      eng.requestRender();
      return;
    }

    eng.heatmapGroup.visible = true;
    const isOrgIsolation = isolatedAssetType !== null;
    const isMultiBuilding = drillLevel === 'campus' || isOrgIsolation;
    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);
    const buildingsToRender = isMultiBuilding
      ? sceneData.buildings
      : sceneData.buildings.filter((b) => b.id === activeBuildingId);

    const visibleFloorIds = new Set<string>();

    buildingsToRender.forEach((bldg) => {
      const bldgFloors =
        isMultiBuilding || showAllFloors || drillLevel === 'building'
          ? sceneData.floors.filter((f) => f.buildingId === bldg.id)
          : activeFl && activeFl.buildingId === bldg.id
            ? [activeFl]
            : [];

      bldgFloors.forEach((floor) => {
        visibleFloorIds.add(floor.id);
        let entry = eng.heatmapCache.get(floor.id);
        if (!entry) {
          const canvas = document.createElement('canvas');
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;

          const geo = new THREE.PlaneGeometry(floor.width, floor.depth);
          const mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: heatmapOpacity,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.renderOrder = 12;
          eng.heatmapGroup.add(mesh);
          entry = { canvas, texture, mesh };
          eng.heatmapCache.set(floor.id, entry);
        }

        renderFloorHeatmapCanvas(
          entry.canvas,
          floor,
          sceneData.rooms,
          sensors,
          readings,
          heatmapMetric
        );
        entry.texture.needsUpdate = true;
        const mat = entry.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = heatmapOpacity;
        entry.mesh.visible = true;

        const ox = isMultiBuilding ? bldg.originX : 0;
        const oz = isMultiBuilding ? bldg.originZ : 0;
        const explodedOffset = explodedFactor * floor.levelIndex * 5.2;
        entry.mesh.position.set(
          ox + floor.width / 2,
          floor.elevation + explodedOffset + 0.085,
          oz + floor.depth / 2
        );
      });
    });

    eng.heatmapCache.forEach((entry, flId) => {
      if (!visibleFloorIds.has(flId)) {
        entry.mesh.visible = false;
      }
    });

    eng.requestRender();
  }, [
    heatmapMetric,
    heatmapOpacity,
    sensors,
    readings,
    sceneData.buildings,
    sceneData.floors,
    sceneData.rooms,
    activeFloorId,
    activeBuildingId,
    drillLevel,
    showAllFloors,
    explodedFactor,
    isolatedAssetType,
  ]);

  // Compute Visible 3D Equipment & Room Sensor Indicator Anchors (Bioreactors, HPLCs, Skids, Rooms)
  const visibleSensorPins = useMemo(() => {
    if (!show3DSensorPins || sensors.length === 0) return [];
    const isOrgIsolation = isolatedAssetType !== null;
    const isMultiBuilding = drillLevel === 'campus' || isOrgIsolation;
    const activeFl = sceneData.floors.find((f) => f.id === activeFloorId);

    const floorSet = new Set<string>();
    const bldgMap = new Map(sceneData.buildings.map((b) => [b.id, b]));
    const floorMap = new Map(sceneData.floors.map((f) => [f.id, f]));

    if (isMultiBuilding) {
      sceneData.floors.forEach((f) => floorSet.add(f.id));
    } else if (showAllFloors || drillLevel === 'building') {
      sceneData.floors
        .filter((f) => f.buildingId === activeBuildingId)
        .forEach((f) => floorSet.add(f.id));
    } else if (activeFl) {
      floorSet.add(activeFl.id);
    }

    // Group sensors by host target on visible floors
    const grouped = new Map<
      string,
      {
        key: string;
        targetKind: 'asset' | 'room';
        targetId: string;
        targetName: string;
        targetCode: string;
        mainSensor: SensorDefinition;
        secondarySensors: SensorDefinition[];
        wx: number;
        wy: number;
        wz: number;
        priority: number;
      }
    >();

    sensors.forEach((s) => {
      if (!floorSet.has(s.floorId)) return;
      // Show equipment indicators always when pins enabled; show room indicators when environmental heatmap is active
      if (s.targetKind === 'room' && heatmapMetric === 'none') return;
      if (s.targetKind === 'room' && heatmapMetric !== 'none' && s.metric !== heatmapMetric) return;

      const key = `${s.targetKind}:${s.targetId}`;
      const fl = floorMap.get(s.floorId);
      const bldg = fl ? bldgMap.get(fl.buildingId) : null;
      const ox = isMultiBuilding ? bldg?.originX ?? 0 : 0;
      const oz = isMultiBuilding ? bldg?.originZ ?? 0 : 0;
      const explodedOffset = explodedFactor * (fl?.levelIndex ?? 0) * 5.2;
      const wy = (fl?.elevation ?? 0) + explodedOffset + s.y;

      const existing = grouped.get(key);
      if (!existing) {
        const lower = s.targetName.toLowerCase();
        const priority = lower.includes('bioreactor')
          ? 100
          : lower.includes('hplc')
            ? 95
            : lower.includes('chrom') || lower.includes('lyoph') || lower.includes('autoclave')
              ? 80
              : s.targetKind === 'asset'
                ? 60
                : 40;

        grouped.set(key, {
          key,
          targetKind: s.targetKind,
          targetId: s.targetId,
          targetName: s.targetName,
          targetCode: s.targetCode,
          mainSensor: s,
          secondarySensors: [],
          wx: ox + s.x,
          wy,
          wz: oz + s.z,
          priority,
        });
      } else {
        if (s.isMainSensor) {
          existing.secondarySensors.push(existing.mainSensor);
          existing.mainSensor = s;
        } else {
          existing.secondarySensors.push(s);
        }
      }
    });

    // Limit total simultaneous pins so viewport stays uncluttered and readable
    return Array.from(grouped.values())
      .sort((a, b) => b.priority - a.priority)
      .slice(0, isMultiBuilding ? 10 : 12);
  }, [
    show3DSensorPins,
    sensors,
    heatmapMetric,
    isolatedAssetType,
    drillLevel,
    showAllFloors,
    activeFloorId,
    activeBuildingId,
    sceneData.buildings,
    sceneData.floors,
    explodedFactor,
  ]);

  // Project 3D sensor indicator coordinates directly onto DOM elements (zero React re-renders during orbit)
  useEffect(() => {
    const projectAll = () => {
      const eng = engineRef.current;
      const container = mountRef.current;
      if (!eng || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;

      visibleSensorPins.forEach((pin) => {
        const el = pinDomRefs.current.get(pin.key);
        if (!el) return;
        _projVec.set(pin.wx, pin.wy, pin.wz).project(eng.activeCamera);
        const visible = _projVec.z >= -1 && _projVec.z <= 1;
        if (!visible) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          return;
        }
        const px = (_projVec.x * 0.5 + 0.5) * w;
        const py = (-_projVec.y * 0.5 + 0.5) * h;
        const inBounds = px > 40 && px < w - 40 && py > 54 && py < h - 60;
        el.style.opacity = inBounds ? '1' : '0';
        el.style.pointerEvents = inBounds ? 'auto' : 'none';
        el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%)`;
      });
    };

    projectPinsRef.current = projectAll;
    projectAll();
  }, [visibleSensorPins, readings]);

  // Derived breadcrumbs for Spatial Drill-Down HUD
  const activeBuilding = sceneData.buildings.find((b) => b.id === activeBuildingId);
  const activeFloor = sceneData.floors.find((f) => f.id === activeFloorId);
  const activeDept = activeDepartmentId
    ? sceneData.hierarchy.find((h) => h.id === activeDepartmentId)
    : null;
  const activeRoom = activeRoomId ? sceneData.rooms.find((r) => r.id === activeRoomId) : null;
  const activeAsset =
    selected.length === 1 && selected[0].type === 'asset'
      ? sceneData.assets.find((a) => a.id === selected[0].id)
      : null;

  const isolatedMatches = useMemo(() => {
    if (!isolatedAssetType) return [];
    return sceneData.assets.filter(
      (a) =>
        a.templateId === isolatedAssetType.templateId ||
        a.archetype === isolatedAssetType.archetype
    );
  }, [sceneData.assets, isolatedAssetType]);

  const jumpToIsolatedInstance = (assetId: string) => {
    const asset = sceneData.assets.find((a) => a.id === assetId);
    if (!asset) return;
    const fl = sceneData.floors.find((f) => f.id === asset.floorId);
    const bldg = fl ? sceneData.buildings.find((b) => b.id === fl.buildingId) : null;
    const ox = bldg?.originX ?? 0;
    const oz = bldg?.originZ ?? 0;
    const ey = (fl?.elevation ?? 0) + asset.y;
    flyToCamera(
      [ox + asset.x + 4.8, ey + Math.max(3.6, asset.height + 2.2), oz + asset.z + 4.8],
      [ox + asset.x, ey + asset.height / 2, oz + asset.z],
      42
    );
  };

  const renderStyleOptions: { id: RenderStyle; label: string }[] = [
    { id: 'realistic', label: 'Studio PBR' },
    { id: 'blueprint-split', label: 'Twin Split' },
    { id: 'wireframe', label: 'X-Ray CAD' },
  ];

  const inspectedPin = useMemo(
    () => (inspectedPinKey ? visibleSensorPins.find((p) => p.key === inspectedPinKey) ?? null : null),
    [inspectedPinKey, visibleSensorPins]
  );

  const inspectedAssetObj = useMemo(
    () =>
      inspectedPin?.targetKind === 'asset'
        ? sceneData.assets.find((a) => a.id === inspectedPin.targetId) ?? null
        : null,
    [inspectedPin, sceneData.assets]
  );

  const inspectedRoomObj = useMemo(
    () =>
      inspectedPin?.targetKind === 'room'
        ? sceneData.rooms.find((r) => r.id === inspectedPin.targetId) ?? null
        : null,
    [inspectedPin, sceneData.rooms]
  );

  const handleDrillStepBack = () => {
    if (drillLevel === 'asset') {
      if (activeRoom) drillInto('room', activeRoom.id);
      else if (activeFloor) drillInto('floor', activeFloor.id);
      else drillInto('campus');
    } else if (drillLevel === 'room') {
      if (activeFloor) drillInto('floor', activeFloor.id);
      else drillInto('campus');
    } else if (drillLevel === 'department') {
      if (activeFloor) drillInto('floor', activeFloor.id);
      else drillInto('campus');
    } else if (drillLevel === 'floor') {
      if (activeBuilding) drillInto('building', activeBuilding.id);
      else drillInto('campus');
    } else if (drillLevel === 'building') {
      drillInto('campus');
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      <div ref={mountRef} className="w-full h-full" />

      {/* Top-Left: Spatial 3D Drill-Down Breadcrumb HUD with explicit Step Back (Opaque Charcoal) */}
      <div className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1.5 rounded-2xl bg-white dark:bg-[#131319] border border-zinc-200 dark:border-zinc-800 shadow-xl text-[11px] max-w-[calc(100%-260px)] overflow-x-auto z-20">
        {drillLevel !== 'campus' && (
          <button
            onClick={handleDrillStepBack}
            className="flex items-center gap-1 px-2 py-1 rounded-xl bg-zinc-100 dark:bg-[#1C1C26] text-zinc-700 dark:text-zinc-200 hover:bg-violet-600 hover:text-white transition-colors shrink-0 mr-0.5"
            title="Step Back Up One Spatial Level"
          >
            <ArrowLeft className="w-3 h-3" />
          </button>
        )}

        <button
          onClick={() => drillInto('campus')}
          className={`flex items-center gap-1 px-2 py-1 rounded-xl whitespace-nowrap transition-colors ${
            drillLevel === 'campus'
              ? 'bg-violet-600 text-white font-semibold'
              : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
          title="Zoom out to Full Campus"
        >
          <Globe className="w-3 h-3" />
          Campus
        </button>

        {activeBuilding && (
          <>
            <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
            <button
              onClick={() => drillInto('building', activeBuilding.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded-xl whitespace-nowrap transition-colors ${
                drillLevel === 'building'
                  ? 'bg-violet-600 text-white font-semibold'
                  : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Building2 className="w-3 h-3" />
              {activeBuilding.code}
            </button>
          </>
        )}

        {activeFloor && (
          <>
            <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
            <button
              onClick={() => drillInto('floor', activeFloor.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded-xl whitespace-nowrap transition-colors ${
                drillLevel === 'floor'
                  ? 'bg-violet-600 text-white font-semibold'
                  : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Layers className="w-3 h-3" />
              {activeFloor.code}
            </button>
          </>
        )}

        {activeDept && (
          <>
            <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
            <button
              onClick={() => drillInto('department', activeDept.id)}
              className={`px-2 py-1 rounded-xl whitespace-nowrap transition-colors ${
                drillLevel === 'department'
                  ? 'bg-violet-600 text-white font-semibold'
                  : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {activeDept.name}
            </button>
          </>
        )}

        {activeRoom && (
          <>
            <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
            <button
              onClick={() => drillInto('room', activeRoom.id)}
              className={`px-2 py-1 rounded-xl whitespace-nowrap transition-colors ${
                drillLevel === 'room'
                  ? 'bg-violet-600 text-white font-semibold'
                  : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {activeRoom.code}
            </button>
          </>
        )}

        {activeAsset && drillLevel === 'asset' && (
          <>
            <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
            <span className="px-2 py-1 rounded-xl bg-amber-500 text-zinc-950 font-mono font-semibold whitespace-nowrap">
              {activeAsset.assetId}
            </span>
          </>
        )}

        <button
          onClick={() => {
            const url = buildDirectUrl();
            navigator.clipboard?.writeText(url).catch(() => {});
            showToast('Direct deep-link URL copied to clipboard', 'success');
          }}
          className="ml-1 pl-1.5 border-l border-zinc-200 dark:border-zinc-800 p-1 text-zinc-500 hover:text-violet-500 shrink-0"
          title="Copy Direct URL to current 3D view & layer"
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Top-Right: Photorealistic PBR / Twin Split / X-Ray + Quick Night Mode Switcher */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
        <button
          onClick={toggleLightingMode}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-2xl border shadow-xl text-[11px] font-semibold transition-colors ${
            lightingMode === 'night'
              ? 'bg-[#151520] border-amber-500/60 text-amber-300'
              : 'bg-white dark:bg-[#131319] border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-violet-500'
          }`}
          title="Toggle Day / Night Mode Architectural Spotlights"
        >
          {lightingMode === 'night' ? (
            <>
              <Moon className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Night</span>
            </>
          ) : (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span className="hidden sm:inline">Day</span>
            </>
          )}
        </button>

        <div className="flex items-center gap-0.5 p-1 rounded-2xl bg-white dark:bg-[#131319] border border-zinc-200 dark:border-zinc-800 shadow-xl text-[11px]">
          {renderStyleOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setRenderStyle(opt.id)}
              className={`px-2.5 py-1 rounded-xl font-medium whitespace-nowrap transition-colors ${
                renderStyle === opt.id
                  ? opt.id === 'realistic'
                    ? 'bg-violet-600 text-white'
                    : 'bg-amber-500 text-zinc-950 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Floating Multi-Axis Section Cut Bar with Instant Reset */}
      {sectionCutEnabled && (
        <div className="absolute top-16 right-3 z-20 px-3 py-2.5 rounded-2xl bg-white dark:bg-[#131319] border border-violet-500/50 shadow-2xl flex flex-col gap-2 w-64 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5 text-violet-500" />
              Section Cut ({sectionCutAxis.toUpperCase()})
            </span>
            <button
              onClick={resetSectionCut}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-[#1E1E28] hover:bg-violet-600 hover:text-white text-zinc-700 dark:text-zinc-200 font-medium transition-colors"
              title="Reset & Disable Section Cut"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
          <div className="flex items-center gap-1">
            {(['y', 'x', 'z'] as const).map((ax) => (
              <button
                key={ax}
                onClick={() => {
                  const defaultVal =
                    ax === 'y'
                      ? Number(((activeFloor?.height ?? 4) * 0.55).toFixed(1))
                      : ax === 'x'
                        ? Number(((activeFloor?.width ?? 30) * 0.5).toFixed(1))
                        : Number(((activeFloor?.depth ?? 20) * 0.5).toFixed(1));
                  setSectionCut(true, defaultVal, ax, sectionCutFlipped);
                }}
                className={`flex-1 py-1 rounded-lg font-mono uppercase font-semibold transition-colors ${
                  sectionCutAxis === ax
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-100 dark:bg-[#1C1C26] text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {ax} Axis
              </button>
            ))}
            <button
              onClick={() => setSectionCut(true, sectionCutHeight, sectionCutAxis, !sectionCutFlipped)}
              className={`px-2 py-1 rounded-lg font-medium transition-colors ${
                sectionCutFlipped
                  ? 'bg-amber-500 text-zinc-950 font-semibold'
                  : 'bg-zinc-100 dark:bg-[#1C1C26] text-zinc-600 dark:text-zinc-300'
              }`}
              title="Flip Clipping Direction"
            >
              Flip
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.2}
              max={
                sectionCutAxis === 'y'
                  ? Math.max(6, (activeFloor?.height ?? 4) + 1)
                  : sectionCutAxis === 'x'
                    ? activeFloor?.width ?? 36
                    : activeFloor?.depth ?? 24
              }
              step={0.1}
              value={sectionCutHeight}
              onChange={(e) => setSectionCut(true, Number(e.target.value), sectionCutAxis, sectionCutFlipped)}
              className="flex-1 accent-violet-500"
            />
            <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-300 w-11 text-right">
              {sectionCutHeight.toFixed(1)}m
            </span>
          </div>
        </div>
      )}

      {/* Org-Wide Same-Type Object Isolation Banner */}
      {isolatedAssetType && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 max-w-[92%] px-4 py-2 rounded-2xl bg-[#131319] text-zinc-100 border border-violet-500/60 shadow-2xl flex flex-wrap items-center gap-2.5 text-xs z-20">
          <div className="flex items-center gap-2">
            <Focus className="w-4 h-4 text-violet-400 shrink-0" />
            <span className="font-semibold text-violet-400">Org-Wide Isolation:</span>
            <span className="font-medium text-white">{isolatedAssetType.label}</span>
            <span className="font-mono text-[11px] text-zinc-400">
              {isolatedAssetType.count} units · {isolatedAssetType.buildingsCount} bldg · {isolatedAssetType.floorsCount} fl
            </span>
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {isolatedMatches.slice(0, 6).map((m) => (
              <button
                key={m.id}
                onClick={() => jumpToIsolatedInstance(m.id)}
                className="px-2 py-0.5 rounded-lg bg-[#1D1D26] border border-zinc-700 hover:border-amber-400 font-mono text-[10px] text-zinc-200 transition-colors"
                title={`Fly to ${m.name} (${m.assetId})`}
              >
                {m.assetId}
              </button>
            ))}
            {isolatedMatches.length > 6 && (
              <span className="text-[10px] font-mono text-zinc-400">+{isolatedMatches.length - 6}</span>
            )}
          </div>

          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => {
                const url = buildDirectUrl({ isolateType: isolatedAssetType.templateId });
                navigator.clipboard?.writeText(url).catch(() => {});
                showToast('Copied direct URL for this org-wide isolation view', 'success');
              }}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-violet-400"
              title="Copy Direct Isolation URL"
            >
              <Link2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={clearIsolation}
              className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] font-medium"
            >
              <X className="w-3 h-3" /> Exit
            </button>
          </div>
        </div>
      )}

      {/* 3D Projected Compact Non-Overlapping Sensor Beacon Chips (Click to open Focused 3D Equipment Dialog) */}
      {show3DSensorPins && visibleSensorPins.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {visibleSensorPins.map((pin) => {
            const snap = readings[pin.mainSensor.id];
            const val = snap?.value ?? pin.mainSensor.nominal;
            const status = snap?.status ?? 'nominal';
            const isInspected = inspectedPinKey === pin.key;
            const dotCls =
              status === 'alarm'
                ? 'bg-rose-500'
                : status === 'warning'
                  ? 'bg-amber-400'
                  : 'bg-emerald-400';
            const borderCls = isInspected
              ? 'border-violet-400 ring-2 ring-violet-500/40'
              : status === 'alarm'
                ? 'border-rose-500/90'
                : status === 'warning'
                  ? 'border-amber-500/80'
                  : 'border-zinc-700/90 hover:border-violet-400';

            return (
              <div
                key={pin.key}
                ref={(el) => {
                  if (el) pinDomRefs.current.set(pin.key, el);
                  else pinDomRefs.current.delete(pin.key);
                }}
                style={{ opacity: 0, willChange: 'transform' }}
                className="absolute top-0 left-0 transition-opacity duration-150"
              >
                <button
                  type="button"
                  onClick={() => setInspectedPinKey(isInspected ? null : pin.key)}
                  className={`group flex items-center gap-1.5 rounded-full bg-[#131319] text-zinc-100 border ${borderCls} shadow-lg px-2.5 py-1 text-[10.5px] font-mono tabular-nums whitespace-nowrap transition-colors`}
                  title={`${pin.targetName} — Click to inspect 3D model & live sensors`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
                  <span className="font-semibold text-zinc-100">{pin.targetCode}</span>
                  <span className="text-zinc-500">·</span>
                  <span className="text-amber-300 font-semibold">
                    {val.toFixed(pin.mainSensor.precision)}
                    <span className="text-zinc-400 font-normal ml-0.5">{pin.mainSensor.unit}</span>
                  </span>
                </button>
                <div className="mx-auto w-px h-2.5 bg-violet-500/60" />
              </div>
            );
          })}
        </div>
      )}

      {/* Focused Single-Object 3D & Live Telemetry Inspection Dialog (Opaque Charcoal, Zero WebGL Blur) */}
      {inspectedPin && (
        <div className="absolute top-16 left-3 z-30 w-[356px] max-w-[calc(100%-24px)] rounded-3xl bg-white dark:bg-[#13131A] border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181822] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setInspectedPinKey(null)}
                className="p-1.5 rounded-xl bg-white dark:bg-[#22222F] border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-violet-500 hover:text-violet-500 transition-colors shrink-0"
                title="Back to 3D Floor View"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <div className="min-w-0">
                <div className="text-[10.5px] font-mono text-violet-600 dark:text-violet-400 truncate">
                  {inspectedPin.targetCode} · Focused 3D Inspector
                </div>
                <div className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                  {inspectedPin.targetName}
                </div>
              </div>
            </div>
            <button
              onClick={() => setInspectedPinKey(null)}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
              title="Close Inspector"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3.5 space-y-3">
            {/* Dedicated Focused 3D Turntable Viewer for THIS Specific Object */}
            <AssetMini3DViewer
              asset={inspectedAssetObj}
              room={inspectedRoomObj}
              height={186}
              statusAccent={readings[inspectedPin.mainSensor.id]?.status ?? 'nominal'}
            />

            {/* Primary & Secondary Live Sensors */}
            {(() => {
              const allCh = [inspectedPin.mainSensor, ...inspectedPin.secondarySensors];
              return (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                  {allCh.map((s) => {
                    const snap = readings[s.id];
                    const v = snap?.value ?? s.nominal;
                    const st = snap?.status ?? 'nominal';
                    const color =
                      st === 'alarm'
                        ? '#F43F5E'
                        : st === 'warning'
                          ? '#F59E0B'
                          : METRIC_PRESETS[s.metric]?.color ?? '#8B5CF6';
                    return (
                      <div
                        key={s.id}
                        className="px-3 py-2 rounded-2xl bg-zinc-50 dark:bg-[#191923] border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                            {s.tag} {s.isMainSensor ? '★' : ''}
                          </div>
                          <div className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200 truncate">
                            {s.name.split('·').pop()?.trim() || s.name}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <MiniSparkline points={snap?.history ?? []} color={color} width={48} height={18} />
                          <span className="font-mono tabular-nums text-xs font-bold text-zinc-900 dark:text-white">
                            {v.toFixed(s.precision)}
                            <span className="text-[10px] font-normal text-zinc-400 ml-0.5">{s.unit}</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => {
                  openDashboard({
                    tab: 'trends',
                    assetId: inspectedPin.targetKind === 'asset' ? inspectedPin.targetId : null,
                    roomId: inspectedPin.targetKind === 'room' ? inspectedPin.targetId : null,
                    sensorId: inspectedPin.mainSensor.id,
                  });
                  setInspectedPinKey(null);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
              >
                <Activity className="w-3.5 h-3.5" />
                Live Trends &amp; Tags
              </button>
              <a
                href={buildTelemetryTabUrl({
                  tab: 'trends',
                  assetId: inspectedPin.targetKind === 'asset' ? inspectedPin.targetId : undefined,
                  roomId: inspectedPin.targetKind === 'room' ? inspectedPin.targetId : undefined,
                  sensorId: inspectedPin.mainSensor.id,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-[#1C1C26] hover:border-amber-500 text-zinc-700 dark:text-zinc-200 text-xs font-medium transition-colors"
                title="Open Detailed Telemetry in New Tab"
              >
                <ExternalLink className="w-3.5 h-3.5 text-amber-500" />
                New Tab
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Bottom-Right: Hover/Click Collapsible Environmental Heatmap & Sensor Overlay Dock */}
      <div
        className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-1.5 max-w-[calc(100%-24px)]"
        onMouseEnter={() => setSensorOverlayCollapsed(false)}
        onMouseLeave={() => {
          if (heatmapMetric === 'none') setSensorOverlayCollapsed(true);
        }}
      >
        {heatmapMetric !== 'none' && !sensorOverlayCollapsed && (
          <div className="px-3.5 py-2.5 rounded-2xl bg-white dark:bg-[#131319] border border-zinc-200 dark:border-zinc-800 shadow-xl text-[11px] w-72 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                Live {HEATMAP_SCALES[heatmapMetric].label} Field ({HEATMAP_SCALES[heatmapMetric].unit})
              </span>
              <span className="font-mono text-[10px] text-amber-500">Live · 1.5s</span>
            </div>
            <div
              className="h-2.5 w-full rounded-full"
              style={{
                background: `linear-gradient(to right, ${HEATMAP_SCALES[heatmapMetric].stops
                  .map((s) => `${s.hex} ${Math.round(s.t * 100)}%`)
                  .join(', ')})`,
              }}
            />
            <div className="flex items-center justify-between font-mono tabular-nums text-[10px] text-zinc-500 dark:text-zinc-400">
              <span>
                {HEATMAP_SCALES[heatmapMetric].min} {HEATMAP_SCALES[heatmapMetric].unit}
              </span>
              <span>
                {HEATMAP_SCALES[heatmapMetric].mid} {HEATMAP_SCALES[heatmapMetric].unit}
              </span>
              <span>
                {HEATMAP_SCALES[heatmapMetric].max} {HEATMAP_SCALES[heatmapMetric].unit}
              </span>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-zinc-200 dark:border-zinc-800">
              <span className="text-[10px] text-zinc-500 shrink-0">Opacity</span>
              <input
                type="range"
                min={0.2}
                max={0.95}
                step={0.05}
                value={heatmapOpacity}
                onChange={(e) => setHeatmapOpacity(Number(e.target.value))}
                className="flex-1 accent-violet-500"
              />
              <span className="font-mono text-[10px] tabular-nums text-zinc-400 w-7 text-right">
                {Math.round(heatmapOpacity * 100)}%
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1 p-1.5 rounded-2xl bg-white dark:bg-[#131319] border border-zinc-200 dark:border-zinc-800 shadow-xl text-[11px]">
          <button
            onClick={() => setSensorOverlayCollapsed((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-xl text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium"
            title={sensorOverlayCollapsed ? 'Expand Sensor & Heatmap Controls' : 'Collapse Controls'}
          >
            <Radio className={`w-3.5 h-3.5 ${heatmapMetric !== 'none' || show3DSensorPins ? 'text-violet-500' : 'text-zinc-400'}`} />
            {sensorOverlayCollapsed && <span>Sensors &amp; Map</span>}
          </button>

          {!sensorOverlayCollapsed && (
            <>
              {(
                [
                  { id: 'none', label: 'Off', icon: null },
                  { id: 'temperature', label: 'Temp', icon: <Thermometer className="w-3 h-3" /> },
                  { id: 'humidity', label: 'RH%', icon: <Droplets className="w-3 h-3" /> },
                  { id: 'pressure', label: 'ΔP Pa', icon: <Gauge className="w-3 h-3" /> },
                ] as { id: HeatmapMetric; label: string; icon: React.ReactNode }[]
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setHeatmapMetric(m.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-xl font-medium whitespace-nowrap transition-colors ${
                    heatmapMetric === m.id
                      ? m.id === 'none'
                        ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                        : 'bg-amber-500 text-zinc-950 font-semibold'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  {m.icon}
                  <span>{m.label}</span>
                </button>
              ))}

              <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-800 mx-0.5" />

              <button
                onClick={() => setShow3DSensorPins(!show3DSensorPins)}
                className={`px-2.5 py-1 rounded-xl font-medium whitespace-nowrap transition-colors ${
                  show3DSensorPins
                    ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border border-violet-500/40'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
                title="Toggle Compact 3D Equipment Sensor Beacons"
              >
                3D Tags
              </button>

              <button
                onClick={() => openDashboard({ tab: 'trends' })}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium whitespace-nowrap transition-colors"
                title="Open Detailed Live Sensor & Telemetry Console"
              >
                <Activity className="w-3 h-3" />
                <span className="hidden sm:inline">Telemetry</span>
              </button>

              <a
                href={buildTelemetryTabUrl({ tab: 'trends' })}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-xl text-zinc-500 hover:text-amber-500"
                title="Open Detailed Telemetry Dashboard in a New Browser Tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </>
          )}
        </div>
      </div>

      {/* Toggleable Flow Legend & Animation Control (Bottom-Left above hint) */}
      {(() => {
        const floorFlows = sceneData.flows.filter((f) => f.floorId === activeFloorId);
        const flowsLayerOn = sceneData.layers.find((l) => l.id === 'layer-flows')?.visible ?? true;
        if (!flowsLayerOn || floorFlows.length === 0 || firstPersonMode) return null;

        return showFlowLegend ? (
          <div className="absolute bottom-14 left-3 z-20 w-56 rounded-2xl bg-white dark:bg-[#131319] border border-zinc-200 dark:border-zinc-800 shadow-xl p-2.5 text-[11px] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                <Waypoints className="w-3.5 h-3.5 text-violet-500" />
                Flow Legend
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setAnimateFlows(!animateFlows)}
                  className={`px-1.5 py-0.5 rounded-lg flex items-center gap-1 text-[10px] font-medium ${
                    animateFlows
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                  }`}
                  title={animateFlows ? 'Pause Flow Animations' : 'Play Flow Animations'}
                >
                  {animateFlows ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                  {animateFlows ? 'Anim' : 'Static'}
                </button>
                <button
                  onClick={() => setShowFlowLegend(false)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                  title="Hide Flow Legend"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {floorFlows.map((fl) => (
                <div key={fl.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fl.color }} />
                    <span className="text-zinc-700 dark:text-zinc-300 truncate">{fl.name}</span>
                  </div>
                  <span className="font-mono text-[9.5px] uppercase text-zinc-400 shrink-0">{fl.flowType}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowFlowLegend(true)}
            className="absolute bottom-14 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#131319] border border-zinc-200 dark:border-zinc-800 shadow-lg text-[11px] text-zinc-600 dark:text-zinc-300 hover:border-violet-500"
            title="Show Flow Legend"
          >
            <Waypoints className="w-3.5 h-3.5 text-violet-500" />
            Flows
          </button>
        );
      })()}

      {/* Selected Camera or IT Rack Contextual Quick Launch Pill */}
      {!firstPersonMode && selected.length === 1 && selected[0].type === 'camera' && (
        <button
          onClick={() => openLiveCamera(selected[0].id)}
          className="absolute bottom-3 left-3 z-20 flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-xl transition-colors"
        >
          <Camera className="w-3.5 h-3.5" />
          Open LiveCam &amp; Credentials
        </button>
      )}
      {!firstPersonMode &&
        activeAsset &&
        (activeAsset.category === 'IT & Data Center' || activeAsset.rackConfig) && (
          <button
            onClick={() => openRackDesigner(activeAsset.id)}
            className="absolute bottom-3 left-3 z-20 flex items-center gap-2 px-3.5 py-2 rounded-2xl gradian-violet-amber text-white text-xs font-semibold shadow-xl hover:opacity-95 transition-opacity"
          >
            <Server className="w-3.5 h-3.5" />
            Open 42U Rack &amp; Network Designer
          </button>
        )}

      {/* Bottom-Left Subtle 3D Interaction Hint */}
      {!firstPersonMode &&
        activeTool === 'select' &&
        !isolatedAssetType &&
        !(selected.length === 1 && selected[0].type === 'camera') &&
        !(activeAsset && (activeAsset.category === 'IT & Data Center' || activeAsset.rackConfig)) && (
          <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-2xl bg-white dark:bg-[#131319] border border-zinc-200 dark:border-zinc-800 text-[10.5px] text-zinc-500 dark:text-zinc-400 pointer-events-none hidden lg:flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-violet-500" />
            Double-click to drill down · Double-click Camera for LiveCam · IT Rack for 42U Designer
          </div>
        )}

      {/* FIRST-PERSON CHARACTER MODE: Hands Holding Modern Ruggedized Area Details Tablet + Hide Button */}
      {firstPersonMode && (() => {
        const curRoom = sceneData.rooms.find(
          (r) =>
            r.floorId === activeFloorId &&
            fpState.x >= r.x &&
            fpState.x <= r.x + r.width &&
            fpState.z >= r.z &&
            fpState.z <= r.z + r.depth
        );
        const nearbyAssets = sceneData.assets
          .filter((a) => a.floorId === activeFloorId && !a.hidden)
          .map((a) => ({ asset: a, dist: Math.hypot(a.x - fpState.x, a.z - fpState.z) }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 3);
        const roomSensors = curRoom
          ? sensors.filter((s) => s.targetKind === 'room' && s.targetId === curRoom.id)
          : [];
        const tempSnap = roomSensors.find((s) => s.metric === 'temperature');
        const rhSnap = roomSensors.find((s) => s.metric === 'humidity');
        const dpSnap = roomSensors.find((s) => s.metric === 'pressure');

        return (
          <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none flex flex-col items-center">
            {/* Compact Top Walkthrough Control Strip */}
            <div className="pointer-events-auto mb-2 flex flex-wrap items-center justify-center gap-1.5 px-3 py-1.5 rounded-2xl bg-[#111116]/95 border border-violet-500/50 text-zinc-100 text-[11px] shadow-2xl">
              <span className="flex items-center gap-1.5 font-semibold text-violet-300">
                <Footprints className="w-3.5 h-3.5" />
                Walkthrough
              </span>
              <span className="text-zinc-500">|</span>
              <span className="font-mono text-[10px] text-zinc-300">
                WASD Move · Shift Sprint · Space Jump · Drag Look
              </span>
              <span className="text-zinc-500">|</span>
              <button
                onClick={() => setShowNavMesh(!showNavMesh)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-colors ${
                  showNavMesh
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {showNavMesh ? 'NavMesh On' : 'NavMesh Off'}
              </button>
              <button
                onClick={() => setFirstPersonTabletVisible(!firstPersonTabletVisible)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 text-zinc-200 text-[10px] font-semibold transition-colors"
              >
                {firstPersonTabletVisible ? <EyeOff className="w-3 h-3" /> : <Tablet className="w-3 h-3" />}
                {firstPersonTabletVisible ? 'Hide Tablet' : 'Show Tablet'}
              </button>
              <button
                onClick={() => setFirstPersonMode(false)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold transition-colors"
              >
                <X className="w-3 h-3" /> Exit
              </button>
            </div>

            {/* First-Person Character Gloved Hands Holding Modern Ruggedized Field Tablet */}
            {firstPersonTabletVisible && (
              <div
                className="pointer-events-auto relative flex items-end justify-center pb-0 transition-transform duration-150"
                style={{ transform: `translateY(${Math.min(18, fpState.jumpHeight * 14)}px)` }}
              >
                {/* Left Character Forearm & Cleanroom Gloved Hand */}
                <svg
                  width="92"
                  height="154"
                  viewBox="0 0 92 154"
                  className="-mr-5 z-20 drop-shadow-2xl hidden sm:block select-none pointer-events-none"
                >
                  <defs>
                    <linearGradient id="fpSleeveL" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#27272A" />
                      <stop offset="100%" stopColor="#121216" />
                    </linearGradient>
                    <linearGradient id="fpGloveL" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#E4E4E7" />
                      <stop offset="100%" stopColor="#A1A1AA" />
                    </linearGradient>
                  </defs>
                  {/* Sleeve */}
                  <path d="M 8 154 L 30 92 L 66 102 L 46 154 Z" fill="url(#fpSleeveL)" stroke="#3F3F46" strokeWidth="1.5" />
                  {/* Violet cleanroom cuff */}
                  <path d="M 28 92 L 67 101 L 64 111 L 25 102 Z" fill="#7C3AED" />
                  {/* Palm & Thumb gripping tablet bezel */}
                  <path d="M 32 90 C 30 62, 54 44, 78 50 C 89 53, 88 67, 74 71 L 68 98 Z" fill="url(#fpGloveL)" stroke="#71717A" strokeWidth="1.2" />
                  <ellipse cx="77" cy="60" rx="11" ry="7" fill="#F4F4F5" stroke="#71717A" strokeWidth="1" />
                </svg>

                {/* Ruggedized Field Tablet Bezel + Live Room Telemetry Display */}
                <div className="w-[340px] sm:w-[430px] rounded-t-3xl bg-[#101015] border-t-4 border-x-4 border-zinc-700 shadow-[0_-14px_50px_rgba(0,0,0,0.75)] overflow-hidden">
                  {/* Tablet Top Camera / Status Bezel */}
                  <div className="px-4 py-1.5 bg-[#09090D] border-b border-zinc-800 flex items-center justify-between text-[10px] font-mono">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-violet-400 font-semibold">GRADIAN FIELD PAD</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-400">
                      <span>X:{fpState.x} Z:{fpState.z}</span>
                      <span>·</span>
                      <span className="text-amber-400">NavMesh {fpState.walkablePct}%</span>
                      <button
                        onClick={() => setFirstPersonTabletVisible(false)}
                        className="ml-1 p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                        title="Hide Tablet"
                      >
                        <EyeOff className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Tablet Screen Content: Current Area Live Details */}
                  <div className="p-3.5 bg-gradient-to-b from-[#14141D] to-[#0D0D13] space-y-2.5 text-zinc-100">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-mono text-violet-400 uppercase tracking-wider">
                          {curRoom ? `${curRoom.code} · CURRENT ZONE` : `${activeFloor?.code ?? 'FLOOR'} · CORRIDOR / OPEN AREA`}
                        </div>
                        <div className="text-sm font-bold text-white truncate">
                          {curRoom ? curRoom.name : `${activeFloor?.name ?? 'Facility Floor'}`}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 font-mono text-[10px] font-semibold shrink-0">
                        {curRoom ? curRoom.environmental.cleanroomGrade : 'Navigable'}
                      </span>
                    </div>

                    {/* Live Environmental Telemetry Row */}
                    <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
                      <div className="p-2 rounded-xl bg-[#1A1A25] border border-zinc-800">
                        <div className="text-[9.5px] text-zinc-400 flex items-center gap-1">
                          <Thermometer className="w-3 h-3 text-amber-400" /> Temp
                        </div>
                        <div className="text-xs font-bold text-white mt-0.5">
                          {(tempSnap ? readings[tempSnap.id]?.value ?? tempSnap.nominal : curRoom?.environmental.temperatureC ?? 21.0).toFixed(1)} °C
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-[#1A1A25] border border-zinc-800">
                        <div className="text-[9.5px] text-zinc-400 flex items-center gap-1">
                          <Droplets className="w-3 h-3 text-cyan-400" /> Humidity
                        </div>
                        <div className="text-xs font-bold text-white mt-0.5">
                          {(rhSnap ? readings[rhSnap.id]?.value ?? rhSnap.nominal : curRoom?.environmental.humidityPct ?? 45).toFixed(0)} %RH
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-[#1A1A25] border border-zinc-800">
                        <div className="text-[9.5px] text-zinc-400 flex items-center gap-1">
                          <Gauge className="w-3 h-3 text-emerald-400" /> Pressure
                        </div>
                        <div className="text-xs font-bold text-emerald-400 mt-0.5">
                          {(dpSnap ? readings[dpSnap.id]?.value ?? dpSnap.nominal : curRoom?.environmental.pressurePa ?? 15) >= 0 ? '+' : ''}
                          {(dpSnap ? readings[dpSnap.id]?.value ?? dpSnap.nominal : curRoom?.environmental.pressurePa ?? 15).toFixed(0)} Pa
                        </div>
                      </div>
                    </div>

                    {/* Nearby Equipment Radar on Tablet */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/80 text-[10.5px]">
                      <span className="text-zinc-400 shrink-0">Nearby:</span>
                      <div className="flex items-center gap-1.5 overflow-x-auto">
                        {nearbyAssets.map(({ asset, dist }) => (
                          <button
                            key={asset.id}
                            onClick={() => openDashboard({ tab: 'trends', assetId: asset.id })}
                            className="px-2 py-0.5 rounded-lg bg-[#1C1C28] border border-zinc-700/80 hover:border-violet-400 font-mono text-[10px] text-zinc-200 whitespace-nowrap"
                          >
                            {asset.assetId} ({dist.toFixed(1)}m)
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Character Forearm & Cleanroom Gloved Hand */}
                <svg
                  width="92"
                  height="154"
                  viewBox="0 0 92 154"
                  className="-ml-5 z-20 drop-shadow-2xl hidden sm:block select-none pointer-events-none"
                >
                  <defs>
                    <linearGradient id="fpSleeveR" x1="1" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#27272A" />
                      <stop offset="100%" stopColor="#121216" />
                    </linearGradient>
                    <linearGradient id="fpGloveR" x1="1" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E4E4E7" />
                      <stop offset="100%" stopColor="#A1A1AA" />
                    </linearGradient>
                  </defs>
                  <path d="M 84 154 L 62 92 L 26 102 L 46 154 Z" fill="url(#fpSleeveR)" stroke="#3F3F46" strokeWidth="1.5" />
                  <path d="M 64 92 L 25 101 L 28 111 L 67 102 Z" fill="#7C3AED" />
                  <path d="M 60 90 C 62 62, 38 44, 14 50 C 3 53, 4 67, 18 71 L 24 98 Z" fill="url(#fpGloveR)" stroke="#71717A" strokeWidth="1.2" />
                  <ellipse cx="15" cy="60" rx="11" ry="7" fill="#F4F4F5" stroke="#71717A" strokeWidth="1" />
                </svg>
              </div>
            )}
          </div>
        );
      })()}

      {activeTool !== 'select' && (
        <div className="absolute bottom-3 left-3 px-3.5 py-2 rounded-2xl bg-violet-600 text-white text-xs font-medium shadow-lg pointer-events-none">
          {activeTool === 'place-object' && 'Click floor in 3D to place selected equipment'}
          {activeTool === 'paint-material' && 'Click any room floor, wall, or equipment to paint material'}
          {activeTool === 'place-camera' && 'Click floor to place new camera'}
          {activeTool === 'place-door' && 'Click any wall to insert door opening'}
          {activeTool === 'place-window' && 'Click any wall to insert observation window'}
          {activeTool === 'measure' && 'Click two points on the floor to measure distance'}
          {(activeTool === 'draw-room' || activeTool === 'draw-wall' || activeTool === 'draw-flow') &&
            'Switch to 2D or Split View to draft rooms, walls, and routes with precision'}
        </div>
      )}
      {activeLineHighlight && (
        <div
          className={`absolute top-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-3.5 py-2 rounded-2xl border shadow-2xl text-xs max-w-[92%] ${
            activeLineHighlight.eligible
              ? 'bg-emerald-950/95 border-emerald-500/70 text-emerald-100'
              : 'bg-rose-950/95 border-rose-500/70 text-rose-100'
          }`}
        >
          {activeLineHighlight.eligible ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <div className="min-w-0">
            <span className="font-extrabold uppercase tracking-wide mr-1.5">
              {activeLineHighlight.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}
            </span>
            <span className="font-semibold truncate">{activeLineHighlight.lineName}</span>
            {!activeLineHighlight.eligible && (
              <span className="ml-1.5 text-[11px] opacity-85">
                ({activeLineHighlight.blockingCount} blocking)
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => openGmpModal({ tab: 'lines', lineId: activeLineHighlight.lineId })}
            className="rounded-xl bg-white/15 hover:bg-white/25 px-2.5 py-1 text-[11px] font-bold shrink-0 cursor-pointer"
          >
            Details
          </button>
          <button
            type="button"
            onClick={clearLineHighlight}
            className="p-1 rounded-lg hover:bg-white/15 shrink-0 cursor-pointer"
            title="Clear Eligibility Highlight"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
