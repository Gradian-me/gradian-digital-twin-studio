import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Bot,
  CheckCircle2,
  Clock,
  Compass,
  DoorOpen,
  Eye,
  FileText,
  Footprints,
  Home,
  Lightbulb,
  List,
  Loader2,
  MapPin,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Play,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useMayaStore, type MayaLifeNavTarget } from '../store/useMayaStore';
import { useGmpStore } from '../store/useGmpStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useMayaTranscribe } from '../hooks/useMayaTranscribe';
import {
  MARKDOWN_TEMPLATES,
  RichMarkdownRenderer,
} from './RichMarkdownRenderer';
import {
  MAYA_EXPRESSIONS,
  MAYA_STATES,
  MayaController,
  loadMayaGltf,
  type MayaExpressionName,
  type MayaStateName,
} from '../lib/mayaController';
import {
  getDefaultRoomOwner,
  getDepartmentCostCenter,
  getEffectiveRoomFireSafety,
  getSceneDepartments,
} from '../utils/fireSafety';
import { attachCanvasPinchGuard } from '../utils/preventPinchZoom';

function formatWorkflowDuration(ms?: number): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.max(10, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

const QUICK_STATES: { id: MayaStateName; label: string }[] = [
  { id: 'idle', label: 'Idle' },
  { id: 'wave', label: 'Wave' },
  { id: 'thinking', label: 'Think' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'teach', label: 'Teach' },
  { id: 'working', label: 'Work' },
  { id: 'laptop', label: 'Laptop' },
  { id: 'searching', label: 'Search' },
  { id: 'present', label: 'Present' },
  { id: 'chat', label: 'Chat' },
  { id: 'celebrate', label: 'Celebrate' },
  { id: 'sleeping', label: 'Rest' },
];

const QUICK_EXPRESSIONS: MayaExpressionName[] = [
  'neutral',
  'happy',
  'curious',
  'thinking',
  'confident',
  'approval',
  'proud',
  'concerned',
  'surprised',
  'wink',
];

interface SopSampleSummary {
  sopId: string;
  docNumber: string;
  title: string;
  executiveOverview: string;
  requiredGowning: string[];
  requiresFullGown: boolean;
  estimatedMinutes: number;
  cpps: { parameter: string; target: string; actionLimit: string }[];
  checklist: string[];
  qaNote: string;
}

function buildSopSampleSummary(sop: {
  id: string;
  docNumber: string;
  title: string;
  version: string;
  status: string;
  equipmentCategory: string;
  actionType: string;
  markdown: string;
}): SopSampleSummary {
  const hay = `${sop.docNumber} ${sop.title} ${sop.equipmentCategory} ${sop.actionType} ${sop.markdown}`.toLowerCase();
  const isCleanroomSterile =
    /aseptic|grade a|grade b|grade c|bioreactor|steril|filling|lyophil|microbiolog|cleanroom|gown|pal|upstream|downstream|chrom|tff|isolator/.test(
      hay
    );

  // Extract real numbered/bulleted steps from the SOP markdown when present
  const extractedSteps: string[] = [];
  for (const rawLine of sop.markdown.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(/^(?:\d+[.)]|[-*])\s+(.+)$/);
    if (match) {
      const cleaned = match[1].replace(/\*\*/g, '').replace(/`/g, '').trim();
      if (cleaned.length >= 16 && cleaned.length <= 135 && extractedSteps.length < 5) {
        extractedSteps.push(cleaned);
      }
    }
  }

  // Domain-authentic Critical Process Parameters tailored to equipment category
  let cpps: { parameter: string; target: string; actionLimit: string }[];
  if (/bioreactor|cell culture|upstream|ferment/.test(hay)) {
    cpps = [
      { parameter: 'Vessel Temperature', target: '37.0 °C', actionLimit: '± 0.3 °C' },
      { parameter: 'Dissolved Oxygen (DO)', target: '40.0 %', actionLimit: '30 – 50 %' },
      { parameter: 'Culture pH', target: '7.10', actionLimit: '6.95 – 7.25' },
      { parameter: 'SIP Hold Temp / Time', target: '121.5 °C / 30m', actionLimit: '≥ 121.0 °C' },
    ];
  } else if (/filling|aseptic|lyophil|isolator|vial/.test(hay)) {
    cpps = [
      { parameter: 'Grade A Laminar Flow', target: '0.45 m/s', actionLimit: '0.36 – 0.54 m/s' },
      { parameter: 'Viable Particles (≥0.5µm)', target: '0 CFU / <3,520', actionLimit: 'ISO 5 Zero-Alert' },
      { parameter: 'Room Cascade ΔP', target: '+30 Pa', actionLimit: '≥ +15 Pa vs Grade C' },
      { parameter: 'Fill Weight Accuracy', target: '± 1.0 %', actionLimit: '± 2.0 % Reject' },
    ];
  } else if (/hvac|ahu|cleanroom|pressure|airlock|gown/.test(hay)) {
    cpps = [
      { parameter: 'Room Pressure Differential', target: '+15 to +30 Pa', actionLimit: '< +10 Pa Alarm' },
      { parameter: 'Air Changes / Hour (ACH)', target: '≥ 20 ACH', actionLimit: '< 15 ACH Alert' },
      { parameter: 'Room Temp / RH', target: '20 °C / 45 %RH', actionLimit: '18–22 °C / 35–55%' },
      { parameter: 'HEPA H14 Filter ΔP', target: '140 Pa', actionLimit: '> 250 Pa Replace' },
    ];
  } else if (/chrom|tff|purif|filtration|buffer|media/.test(hay)) {
    cpps = [
      { parameter: 'Transmembrane Pressure', target: '1.2 bar', actionLimit: '≤ 2.0 bar Max' },
      { parameter: 'Buffer Conductivity', target: '14.2 mS/cm', actionLimit: '± 0.8 mS/cm' },
      { parameter: 'UV280 Elution Peak', target: '≥ 150 mAU', actionLimit: 'Collect 100–250 mAU' },
      { parameter: 'Bioburden Hold Time', target: '≤ 24 h', actionLimit: '2–8 °C Verified' },
    ];
  } else if (/cold|warehouse|storage|stability|chamber/.test(hay)) {
    cpps = [
      { parameter: 'Storage Temperature', target: '5.0 °C', actionLimit: '2.0 – 8.0 °C' },
      { parameter: 'Relative Humidity', target: '45 %RH', actionLimit: '35 – 60 %RH' },
      { parameter: 'Door-Open Excursion', target: '< 2 min', actionLimit: '> 5 min QA Deviation' },
    ];
  } else {
    cpps = [
      { parameter: 'Calibration Status', target: 'Current Valid', actionLimit: 'Lockout if Overdue' },
      { parameter: 'Pre-Use Integrity Check', target: 'Pass 100%', actionLimit: 'Hold & Notify QA' },
      { parameter: 'Room Environmental Spec', target: 'In-Spec BMS', actionLimit: 'Active Alarm = Pause' },
    ];
  }

  const checklist =
    extractedSteps.length >= 3
      ? extractedSteps
      : [
          `Verify calibration seal, room differential pressure, and clean-hold expiry before starting ${sop.docNumber}.`,
          isCleanroomSterile
            ? 'Complete full EU GMP Annex 1 sterile gowning (bunny suit, hood, anti-fog goggles, mask, nitrile gloves & over-boots) in PAL.'
            : 'Confirm required facility PPE, badge authorization, and active batch record sign-off.',
          `Execute ${sop.actionType.toLowerCase()} sequence for ${sop.equipmentCategory} while monitoring CPPs inside acceptance limits.`,
          'Verify post-operation line clearance, log electronic signature (21 CFR Part 11), and confirm zero active alarms.',
        ];

  const requiredGowning = isCleanroomSterile
    ? ['Full Sterile Coverall', 'Cleanroom Hood', 'Anti-Fog Goggles', 'Sterile Mask', 'Double Nitrile Gloves', 'Over-Boots']
    : ['Facility Coat / Polo', 'Safety Glasses', 'ESD / Clean Footwear', 'Access Badge'];

  return {
    sopId: sop.id,
    docNumber: sop.docNumber,
    title: sop.title,
    executiveOverview: `Standardized GMP ${sop.actionType.toLowerCase()} procedure for ${sop.equipmentCategory} (${sop.docNumber}, v${sop.version}). Ensures reproducible parameter control, environmental compliance, and documented 21 CFR Part 11 verification across every execution cycle.`,
    requiredGowning,
    requiresFullGown: isCleanroomSterile,
    estimatedMinutes: isCleanroomSterile ? 25 : 15,
    cpps,
    checklist,
    qaNote: `Status: ${sop.status.toUpperCase()} · EU GMP Annex 1 & ALCOA+ Data Integrity compliant. Escalate any limit excursion immediately to QA.`,
  };
}

/** Interactive 3D WebGL Studio Stage for MAYA */
const MayaStage3D: React.FC<{
  stateName: MayaStateName;
  expression: MayaExpressionName;
  isThinking: boolean;
  isReadingSop: boolean;
  isGowned: boolean;
  onToggleGown: () => void;
  statusNote: string;
}> = ({ stateName, expression, isThinking, isReadingSop, isGowned, onToggleGown, statusNote }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<MayaController | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    let disposed = false;
    const width = Math.max(240, el.clientWidth);
    const height = Math.max(240, el.clientHeight);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.innerHTML = '';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 40);
    camera.position.set(0.25, 1.15, 4.35);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.85, 0);
    controls.minDistance = 1.8;
    controls.maxDistance = 7.2;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minPolarAngle = 0.35;
    controls.enablePan = false;
    controlsRef.current = controls;

    // Studio Lighting
    const hemi = new THREE.HemisphereLight(0xf5f3ff, 0x1e1b2e, 1.0);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(2.8, 4.8, 3.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xa78bfa, 1.25);
    rimLight.position.set(-3.2, 2.8, -2.5);
    scene.add(rimLight);

    const warmFill = new THREE.PointLight(0xf59e0b, 1.2, 8);
    warmFill.position.set(2.2, 1.6, -1.8);
    scene.add(warmFill);

    // Architectural Studio Pedestal + Subtle Halo Ring
    const pedestalGeo = new THREE.CylinderGeometry(0.92, 1.05, 0.08, 48);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: 0x181822,
      roughness: 0.35,
      metalness: 0.25,
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.y = -0.04;
    pedestal.receiveShadow = true;
    scene.add(pedestal);

    const ringGeo = new THREE.RingGeometry(0.92, 0.96, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    scene.add(ring);

    const grid = new THREE.PolarGridHelper(2.6, 12, 6, 48, 0x4c1d95, 0x27273a);
    grid.position.y = -0.075;
    scene.add(grid);

    loadMayaGltf('/models/maya.glb')
      .then((gltf) => {
        if (disposed) return;
        const ctrl = new MayaController(gltf);
        controllerRef.current = ctrl;
        const mayaRoot = ctrl.scene;
        mayaRoot.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        scene.add(mayaRoot);
        const st = useMayaStore.getState();
        ctrl.setGowned(st.isGowned);
        ctrl.setState(st.isThinking ? 'thinking' : st.currentState, {
          expression: st.currentExpression,
          fade: 0.2,
          restart: true,
        });
        setLoaded(true);
      })
      .catch(() => {
        if (!disposed) setLoaded(true);
      });

    const detachPinch = attachCanvasPinchGuard(el, (deltaY) => {
      const offset = camera.position.clone().sub(controls.target);
      const nextLen = Math.max(1.8, Math.min(7.2, offset.length() * (deltaY > 0 ? 1.08 : 0.92)));
      offset.setLength(nextLen);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    });

    const ro = new ResizeObserver(() => {
      if (!el || disposed) return;
      const w = Math.max(240, el.clientWidth);
      const h = Math.max(240, el.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(el);

    const clock = new THREE.Clock();
    let rafId = 0;
    const animate = () => {
      if (disposed) return;
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      controls.update();
      controllerRef.current?.update(dt);
      const pulse = 0.55 + 0.25 * Math.sin(performance.now() * 0.003);
      ringMat.opacity = useMayaStore.getState().isThinking ? 0.95 : pulse;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      detachPinch();
      controls.dispose();
      envTex.dispose();
      pmrem.dispose();
      pedestalGeo.dispose();
      pedestalMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      controllerRef.current = null;
      controlsRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // Sync MAYA state, expression & sterile cleanroom gown smoothly
  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    const targetState: MayaStateName = isThinking ? 'thinking' : stateName;
    const targetExpr: MayaExpressionName = isThinking ? 'thinking' : expression;
    ctrl.setState(targetState, { expression: targetExpr, fade: 0.28, restart: false });
  }, [stateName, expression, isThinking]);

  useEffect(() => {
    controllerRef.current?.setGowned(isGowned);
  }, [isGowned]);

  const handleResetView = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(0.25, 1.15, 4.35);
    controlsRef.current.target.set(0, 0.85, 0);
    controlsRef.current.update();
  };

  return (
    <div className="relative w-full h-full min-h-[300px] overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-[radial-gradient(ellipse_at_top,_rgba(139,92,246,0.22),_rgba(12,12,18,0.96)_72%)]">
      <div ref={mountRef} className="w-full h-full touch-none cursor-grab active:cursor-grabbing" />

      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0E0E14]/90 text-zinc-300 text-xs">
          <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
          <span>Loading MAYA 3D Companion...</span>
        </div>
      )}

      {/* Top Live Status Banner (Opaque over WebGL) */}
      <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto max-w-[82%] px-3 py-2 rounded-xl bg-zinc-950/95 border border-violet-500/40 text-white shadow-lg">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-violet-300">
            <span
              className={`w-2 h-2 rounded-full ${
                isThinking ? 'bg-amber-400 animate-ping' : isReadingSop ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-400'
              }`}
            />
            <span>{isThinking ? 'Thinking' : isReadingSop ? 'Reading SOP' : stateName}</span>
            <span className="text-zinc-500">·</span>
            <span className="text-amber-300">{expression}</span>
          </div>
          <p className="text-xs text-zinc-100 mt-0.5 line-clamp-2">{statusNote}</p>
        </div>

        <button
          type="button"
          onClick={handleResetView}
          className="pointer-events-auto p-2 rounded-xl bg-zinc-950/75 border border-zinc-700/80 text-zinc-300 hover:text-white hover:border-violet-400 transition-colors cursor-pointer"
          title="Reset 3D Camera"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bottom Orbit Helper + Cleanroom Gown Outfit Switcher */}
      <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between gap-2 text-[10px] text-zinc-400 pointer-events-none">
        <span className="px-2 py-0.5 rounded-md bg-zinc-950/70 border border-zinc-800">
          Drag to orbit 360° · Scroll to zoom
        </span>
        <button
          type="button"
          onClick={onToggleGown}
          className={`pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-semibold transition-colors cursor-pointer ${
            isGowned
              ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 hover:bg-cyan-500/30'
              : 'bg-zinc-950/80 border-zinc-700 text-zinc-200 hover:border-cyan-400/60 hover:text-cyan-200'
          }`}
          title="Toggle MAYA between Standard Polo Uniform and Full Grade A/B Cleanroom Gown"
        >
          <ShieldCheck className="w-3 h-3 text-cyan-400" />
          <span>{isGowned ? 'Full Cleanroom Gown ON' : 'Wear Cleanroom Gown'}</span>
        </button>
      </div>
    </div>
  );
};

export const MayaLifePage: React.FC = () => {
  const scene = useTwinStore((s) => s.scene);
  const theme = useTwinStore((s) => s.theme);
  const setScreen = useTwinStore((s) => s.setScreen);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const walkInsideRoom = useTwinStore((s) => s.walkInsideRoom);
  const openEntityInfo = useTwinStore((s) => s.openEntityInfo);
  const showToast = useTwinStore((s) => s.showToast);

  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const setFirstPersonMode = useTwinStore((s) => s.setFirstPersonMode);
  const setViewMode = useTwinStore((s) => s.setViewMode);

  const sops = useGmpStore((s) => s.sops);
  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);

  const currentState = useMayaStore((s) => s.currentState);
  const currentExpression = useMayaStore((s) => s.currentExpression);
  const statusNote = useMayaStore((s) => s.statusNote);
  const isThinking = useMayaStore((s) => s.isThinking);
  const isReadingSop = useMayaStore((s) => s.isReadingSop);
  const isGowned = useMayaStore((s) => s.isGowned);
  const activeRoomCode = useMayaStore((s) => s.activeRoomCode);
  const activeRoomName = useMayaStore((s) => s.activeRoomName);
  const activeSopId = useMayaStore((s) => s.activeSopId);
  const openDoors = useMayaStore((s) => s.openDoors);
  const roomLights = useMayaStore((s) => s.roomLights);
  const interactions = useMayaStore((s) => s.interactions);
  const workflowEvents = useMayaStore((s) => s.workflowEvents);
  const savedWalkPose = useMayaStore((s) => s.savedWalkPose);
  const lifeThreads = useMayaStore((s) => s.lifeThreads);
  const activeLifeThreadId = useMayaStore((s) => s.activeLifeThreadId);
  const lifeChatMessages = useMayaStore((s) => s.lifeChatMessages);

  const setMood = useMayaStore((s) => s.setMood);
  const setGowned = useMayaStore((s) => s.setGowned);
  const setThinking = useMayaStore((s) => s.setThinking);
  const startReadingSop = useMayaStore((s) => s.startReadingSop);
  const stopReadingSop = useMayaStore((s) => s.stopReadingSop);
  const startWorkflowEvent = useMayaStore((s) => s.startWorkflowEvent);
  const completeWorkflowEvent = useMayaStore((s) => s.completeWorkflowEvent);
  const clearWorkflowEvents = useMayaStore((s) => s.clearWorkflowEvents);
  const requestRestoreWalkPose = useMayaStore((s) => s.requestRestoreWalkPose);
  const addLifeMessage = useMayaStore((s) => s.addLifeMessage);
  const createLifeThread = useMayaStore((s) => s.createLifeThread);
  const selectLifeThread = useMayaStore((s) => s.selectLifeThread);
  const deleteLifeThread = useMayaStore((s) => s.deleteLifeThread);
  const renameLifeThread = useMayaStore((s) => s.renameLifeThread);
  const clearLifeChat = useMayaStore((s) => s.clearLifeChat);
  const logInteraction = useMayaStore((s) => s.logInteraction);

  const [centerTab, setCenterTab] = useState<'workflow' | 'sops' | 'interactions' | 'facility'>('sops');
  const [showThreadList, setShowThreadList] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [sopQuery, setSopQuery] = useState('');
  const [selectedSopId, setSelectedSopId] = useState<string | null>(activeSopId ?? sops[0]?.id ?? null);
  const [sopReadingState, setSopReadingState] = useState<{
    sopId: string;
    progress: number;
    phase: string;
  } | null>(null);
  const [sopSummaries, setSopSummaries] = useState<Record<string, SopSampleSummary>>({});
  const [checkedSopSteps, setCheckedSopSteps] = useState<Record<string, boolean>>({});
  const [acknowledgedSops, setAcknowledgedSops] = useState<Record<string, boolean>>({});
  const sopReadTimersRef = useRef<number[]>([]);
  const [facilityQuery, setFacilityQuery] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const activeLifeThread = useMemo(
    () => lifeThreads.find((t) => t.id === activeLifeThreadId) ?? lifeThreads[0],
    [lifeThreads, activeLifeThreadId]
  );

  // Clean up any active SOP reading animation timers on unmount
  useEffect(() => {
    return () => {
      sopReadTimersRef.current.forEach((id) => window.clearTimeout(id));
      sopReadTimersRef.current = [];
    };
  }, []);

  const triggerSopSampleRead = useCallback(
    (sop: (typeof sops)[number]) => {
      sopReadTimersRef.current.forEach((id) => window.clearTimeout(id));
      sopReadTimersRef.current = [];

      setSelectedSopId(sop.id);
      setCenterTab('sops');
      startReadingSop(sop.id, sop.title, null, sop.docNumber);

      setSopReadingState({
        sopId: sop.id,
        progress: 28,
        phase: `Scanning ${sop.docNumber} sections & scope...`,
      });

      const t1 = window.setTimeout(() => {
        setSopReadingState({
          sopId: sop.id,
          progress: 68,
          phase: 'Extracting Critical Process Parameters & GMP limits...',
        });
      }, 650);

      const t2 = window.setTimeout(() => {
        setSopReadingState({
          sopId: sop.id,
          progress: 94,
          phase: 'Compiling executive sample summary & checklist...',
        });
      }, 1350);

      const t3 = window.setTimeout(() => {
        const summary = buildSopSampleSummary(sop);
        setSopSummaries((prev) => ({ ...prev, [sop.id]: summary }));
        setSopReadingState(null);
        stopReadingSop(`Generated sample summary for ${sop.docNumber} · ${sop.title}`);
        showToast(`MAYA finished reading ${sop.docNumber} — Sample Summary ready`, 'success');
      }, 1950);

      sopReadTimersRef.current = [t1, t2, t3];
    },
    [startReadingSop, stopReadingSop, showToast]
  );

  // Live 1s duration ticker while any workflow event is still running
  useEffect(() => {
    const hasRunning = workflowEvents.some((e) => e.status === 'running');
    if (!hasRunning) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [workflowEvents]);

  const handleResumePreviousGamePos = useCallback(() => {
    if (!savedWalkPose) {
      setScreen('workspace');
      return;
    }
    setActiveFloor(savedWalkPose.floorId);
    setViewMode('3d-perspective');
    requestRestoreWalkPose();
    setFirstPersonMode(true);
    setScreen('workspace');
    showToast(
      `Resumed MAYA at ${savedWalkPose.roomCode ? `${savedWalkPose.roomCode} (${savedWalkPose.x}, ${savedWalkPose.z})` : `(${savedWalkPose.x}, ${savedWalkPose.z})`}`,
      'info'
    );
  }, [savedWalkPose, setActiveFloor, setViewMode, requestRestoreWalkPose, setFirstPersonMode, setScreen, showToast]);

  const departments = useMemo(() => getSceneDepartments(scene), [scene]);

  useEffect(() => {
    if (activeSopId) {
      setSelectedSopId(activeSopId);
      setCenterTab('sops');
      const matched = sops.find((s) => s.id === activeSopId);
      if (matched && !sopSummaries[matched.id]) {
        triggerSopSampleRead(matched);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSopId]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lifeChatMessages, sending]);

  const filteredSops = useMemo(() => {
    const q = sopQuery.trim().toLowerCase();
    if (!q) return sops;
    return sops.filter(
      (sop) =>
        sop.docNumber.toLowerCase().includes(q) ||
        sop.title.toLowerCase().includes(q) ||
        sop.equipmentCategory.toLowerCase().includes(q) ||
        sop.actionType.toLowerCase().includes(q) ||
        (sop.archetypes ?? []).some((a) => a.toLowerCase().includes(q))
    );
  }, [sops, sopQuery]);

  const selectedSop = useMemo(
    () => sops.find((s) => s.id === selectedSopId) ?? filteredSops[0] ?? null,
    [sops, selectedSopId, filteredSops]
  );

  const filteredRooms = useMemo(() => {
    const q = facilityQuery.trim().toLowerCase();
    if (!q) return scene.rooms;
    return scene.rooms.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.environmental.cleanroomGrade.toLowerCase().includes(q) ||
        (r.owner || r.metadata?.owner || '').toLowerCase().includes(q)
    );
  }, [scene.rooms, facilityQuery]);

  const openDoorCount = useMemo(
    () => Object.values(openDoors).filter(Boolean).length,
    [openDoors]
  );
  const lightsOffCount = useMemo(
    () => Object.values(roomLights).filter((v) => v === false).length,
    [roomLights]
  );

  const buildFacilityPayload = useCallback(() => {
    const roomsSummary = scene.rooms.slice(0, 32).map((r) => {
      const dept = departments.find((d) => d.id === r.departmentId);
      const fire = getEffectiveRoomFireSafety(r);
      const eqCount = scene.assets.filter((a) => a.roomId === r.id).length;
      const camCount = scene.cameras.filter((c) => c.roomId === r.id).length;
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        cleanroomGrade: r.environmental.cleanroomGrade,
        owner: getDefaultRoomOwner(r, dept),
        department: dept?.name || 'Operations',
        costCenter: r.costCenter || getDepartmentCostCenter(dept),
        hvac: r.environmental.hvac
          ? {
              ahu: r.environmental.hvac.ahuName,
              ach: r.environmental.hvac.airChangesPerHour,
              dpPa: r.environmental.hvac.targetPressurePa,
              tempC: r.environmental.hvac.supplyTempC,
            }
          : {
              ach: r.environmental.airChangesPerHour,
              dpPa: r.environmental.pressurePa,
              tempC: r.environmental.temperatureC,
            },
        equipmentCount: eqCount,
        cameraCount: camCount,
        fireSensors: fire.sensors.length,
        fireExtinguishers: fire.extinguishers.length,
        lightOn: roomLights[r.id] ?? true,
      };
    });

    const assetsSummary = scene.assets.slice(0, 48).map((a) => {
      const room = scene.rooms.find((r) => r.id === a.roomId);
      return {
        id: a.id,
        code: a.assetId,
        name: a.name,
        archetype: a.archetype,
        category: a.category,
        status: a.operationalStatus,
        roomCode: room?.code ?? 'N/A',
        roomName: room?.name ?? 'Unassigned',
        energyKw: a.energyKw,
      };
    });

    const alarms = sensors
      .filter((s) => {
        const rd = readings[s.id];
        return rd && (rd.status === 'alarm' || rd.status === 'warning');
      })
      .slice(0, 12)
      .map((s) => ({
        tag: s.tag,
        name: s.name,
        value: readings[s.id]?.value,
        unit: s.unit,
        status: readings[s.id]?.status,
      }));

    return {
      facilityName: scene.name,
      buildings: scene.buildings.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      floors: scene.floors.map((f) => ({ id: f.id, code: f.code, name: f.name })),
      rooms: roomsSummary,
      assets: assetsSummary,
      activeAlarms: alarms,
      openDoorCount,
      lightsOffCount,
    };
  }, [scene, departments, sensors, readings, roomLights, openDoorCount, lightsOffCount]);

  const generateAsyncLifeTitle = useCallback(
    async (threadId: string, userMsg: string, assistantMsg?: string) => {
      try {
        const res = await fetch('/api/maya/generate-title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstUserMessage: userMsg,
            firstAssistantReply: assistantMsg?.slice(0, 320),
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.title && typeof data.title === 'string') {
          renameLifeThread(threadId, data.title, true);
        }
      } catch {
        // Non-blocking async title fallback
      }
    },
    [renameLifeThread]
  );

  const sendMessage = useCallback(
    async (text: string, focusSopId?: string | null) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const targetThreadId = useMayaStore.getState().activeLifeThreadId;
      const targetThread = useMayaStore
        .getState()
        .lifeThreads.find((t) => t.id === targetThreadId);
      const shouldGenerateTitle = Boolean(targetThread && !targetThread.titleGenerated);

      addLifeMessage({ role: 'user', content: trimmed }, targetThreadId);
      const wfId = startWorkflowEvent({
        kind: focusSopId ? 'sop' : 'chat',
        action: focusSopId ? 'Explain SOP with MAYA' : 'MAYA AI Query',
        targetCode: focusSopId ? 'SOP-AI' : 'MAYA-AI',
        targetName: trimmed.slice(0, 56),
        toState: 'thinking',
        sopId: focusSopId ?? null,
      });

      logInteraction({
        kind: 'chat',
        targetId: focusSopId || 'maya-chat',
        targetCode: 'MAYA-AI',
        targetName: trimmed.slice(0, 48),
        summary: `Asked MAYA: "${trimmed.slice(0, 64)}"`,
        mayaState: 'chat',
        sopId: focusSopId ?? null,
      });

      setChatInput('');
      setSending(true);
      setThinking(true, 'Analyzing digital twin rooms, telemetry & SOPs...');

      try {
        const activeSop = (focusSopId ? sops.find((s) => s.id === focusSopId) : null) || selectedSop;
        const matchingSops = sops
          .filter((sop) => {
            const hay = `${sop.docNumber} ${sop.title} ${sop.equipmentCategory} ${sop.actionType} ${(sop.archetypes ?? []).join(' ')}`.toLowerCase();
            return trimmed
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.length > 3)
              .some((w) => hay.includes(w));
          })
          .slice(0, 5);

        const sopContext = [
          ...(activeSop ? [activeSop] : []),
          ...matchingSops.filter((m) => m.id !== activeSop?.id),
        ]
          .slice(0, 6)
          .map((s) => ({
            id: s.id,
            code: s.docNumber,
            title: s.title,
            category: s.equipmentCategory,
            actionType: s.actionType,
            content: s.markdown.slice(0, 1400),
          }));

        const history = useMayaStore
          .getState()
          .lifeChatMessages.slice(-8)
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await fetch('/api/maya/life-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            history,
            facilityContext: buildFacilityPayload(),
            mayaContext: {
              activeRoomCode,
              activeRoomName,
              recentInteractions: interactions.slice(0, 10).map((i) => ({
                kind: i.kind,
                code: i.targetCode,
                name: i.targetName,
                summary: i.summary,
              })),
            },
            sopContext,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'MAYA could not respond right now.');
        }

        const nextState = (
          MAYA_STATES[data.mayaState as MayaStateName] ? data.mayaState : 'teach'
        ) as MayaStateName;
        const nextExpr = (
          (MAYA_EXPRESSIONS as readonly string[]).includes(data.mayaExpression)
            ? data.mayaExpression
            : 'confident'
        ) as MayaExpressionName;
        const nextNote = data.statusNote || 'Answered your facility & SOP question';
        const replyText = data.reply || 'I reviewed the facility records for you.';

        setThinking(false);
        completeWorkflowEvent(wfId, {
          status: 'completed',
          finalState: nextState,
          statusNote: nextNote,
        });
        if (focusSopId || useMayaStore.getState().isReadingSop) {
          stopReadingSop(`Finished explaining ${activeSop?.docNumber ?? 'SOP'} — ready for next task`);
        } else {
          // Present the response state briefly, then smoothly return MAYA to idle so she never gets stuck
          setMood(nextState, nextExpr, nextNote, 6500);
        }

        addLifeMessage(
          {
            role: 'assistant',
            content: replyText,
            mayaState: nextState,
            mayaExpression: nextExpr,
            statusNote: nextNote,
            citedSopCodes: Array.isArray(data.citedSopCodes) ? data.citedSopCodes : [],
            navigationTargets: Array.isArray(data.navigationTargets) ? data.navigationTargets : [],
            suggestedPrompts: Array.isArray(data.suggestedPrompts) ? data.suggestedPrompts : [],
            modelUsed: data.modelUsed,
          },
          targetThreadId
        );

        if (shouldGenerateTitle) {
          void generateAsyncLifeTitle(targetThreadId, trimmed, replyText);
        }
      } catch (err: any) {
        setThinking(false);
        completeWorkflowEvent(wfId, {
          status: 'cancelled',
          finalState: 'idle',
          statusNote: 'AI request interrupted',
        });
        setMood('error', 'concerned', 'Temporary connection issue with AI service', 4000);
        addLifeMessage(
          {
            role: 'assistant',
            content: err?.message || 'Unable to reach the MAYA AI service right now. Please retry in a moment.',
            mayaState: 'error',
            mayaExpression: 'concerned',
            statusNote: 'AI request interrupted',
          },
          targetThreadId
        );
      } finally {
        setSending(false);
      }
    },
    [
      sending,
      addLifeMessage,
      startWorkflowEvent,
      completeWorkflowEvent,
      stopReadingSop,
      logInteraction,
      setThinking,
      setMood,
      sops,
      selectedSop,
      buildFacilityPayload,
      activeRoomCode,
      activeRoomName,
      interactions,
      generateAsyncLifeTitle,
    ]
  );

  const transcribe = useMayaTranscribe({
    onTranscript: (text) => {
      setChatInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      setMood('chat', 'happy', 'Transcribed your voice note — ready to respond');
    },
    onError: (msg) => {
      showToast(msg, 'error');
      setMood('idle', 'concerned', msg);
    },
  });

  const handleToggleVoice = async () => {
    if (transcribe.isRecording) {
      setMood('thinking', 'curious', 'Transcribing your voice with Gemini 3.5 Transcribe...');
      await transcribe.stopAndTranscribe();
    } else {
      setMood('chat', 'curious', 'Listening to your microphone... click Stop when finished');
      await transcribe.startRecording();
    }
  };

  const handleStopAndSendVoice = async () => {
    if (!transcribe.isRecording) return;
    setMood('thinking', 'curious', 'Transcribing voice & preparing response...');
    await transcribe.stopAndTranscribe((transcript) => {
      const merged = chatInput.trim() ? `${chatInput.trim()} ${transcript}` : transcript;
      sendMessage(merged);
    });
  };

  const handleNavigateTarget = (target: MayaLifeNavTarget) => {
    if (target.type === 'sop') {
      const matched = sops.find(
        (s) =>
          s.id === target.id ||
          s.docNumber.toLowerCase() === target.code.toLowerCase() ||
          s.title.toLowerCase().includes(target.name.toLowerCase())
      );
      if (matched) {
        setSelectedSopId(matched.id);
        setCenterTab('sops');
        startReadingSop(matched.id, matched.title, null, matched.docNumber);
        return;
      }
    }
    if (target.type === 'room') {
      const room = scene.rooms.find(
        (r) => r.id === target.id || r.code.toLowerCase() === target.code.toLowerCase()
      );
      if (room) {
        setScreen('workspace');
        walkInsideRoom(room.id);
        showToast(`Teleported MAYA into ${room.code} · ${room.name}`, 'info');
        return;
      }
    }
    if (target.type === 'asset') {
      const asset = scene.assets.find(
        (a) => a.id === target.id || a.assetId.toLowerCase() === target.code.toLowerCase()
      );
      if (asset) {
        setScreen('workspace');
        focusEntity({ type: 'asset', id: asset.id });
        openEntityInfo({ type: 'asset', id: asset.id });
        return;
      }
    }
    setScreen('workspace');
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-100 dark:bg-[#09090D] text-zinc-900 dark:text-zinc-100">
      {/* Top Studio Header */}
      <header className="h-14 px-3 sm:px-5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111117] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setScreen('workspace')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181822] hover:border-violet-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">3D Twin</span>
          </button>
          {savedWalkPose && (
            <button
              type="button"
              onClick={handleResumePreviousGamePos}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
              title={`Return MAYA to saved 3D position (${savedWalkPose.x}, ${savedWalkPose.z})`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span className="hidden md:inline">
                Resume Walk{savedWalkPose.roomCode ? ` · ${savedWalkPose.roomCode}` : ''}
              </span>
              <span className="md:hidden">Resume</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setScreen('hub')}
            className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181822] hover:border-violet-500 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
            title="Project Hub"
          >
            <Home className="w-3.5 h-3.5" />
          </button>

          <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl gradian-violet-amber text-white flex items-center justify-center shadow-sm shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                  MAYA Life Studio
                </h1>
                <span className="hidden md:inline px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-600 dark:text-violet-300">
                  Interactive Companion · AI · SOPs
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                {activeRoomCode ? `Last Room: ${activeRoomCode} · ${activeRoomName}` : scene.name}
              </p>
            </div>
          </div>
        </div>

        {/* Live Telemetry Counters */}
        <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono tabular-nums">
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-100 dark:bg-[#181822] border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300">
            <BookOpen className="w-3.5 h-3.5 text-violet-500" />
            <span>{sops.length} SOPs</span>
          </div>
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-100 dark:bg-[#181822] border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300">
            <DoorOpen className="w-3.5 h-3.5 text-cyan-500" />
            <span>{openDoorCount} Doors Open</span>
          </div>
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-100 dark:bg-[#181822] border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300">
            <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
            <span>
              {Math.max(0, scene.rooms.length - lightsOffCount)}/{scene.rooms.length} Lights On
            </span>
          </div>
        </div>
      </header>

      {/* Main 3-Column Studio Grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 overflow-y-auto lg:overflow-hidden">
        {/* Left Column: 3D MAYA Stage + State & Expression Controls */}
        <section className="lg:col-span-4 flex flex-col gap-3 min-h-[440px] lg:min-h-0">
          <div className="flex-1 min-h-[290px]">
            <MayaStage3D
              stateName={currentState}
              expression={currentExpression}
              isThinking={isThinking}
              isReadingSop={isReadingSop}
              isGowned={isGowned}
              onToggleGown={() => setGowned(!isGowned, 'MAYA Life Studio')}
              statusNote={statusNote}
            />
          </div>

          {/* Interactive Mood / Animation Switcher */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121218] p-3 space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                MAYA Animation State
              </span>
              {isReadingSop && (
                <button
                  type="button"
                  onClick={() => stopReadingSop()}
                  className="text-[10px] font-semibold text-violet-500 hover:underline cursor-pointer"
                >
                  Stop SOP Mode
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {QUICK_STATES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() =>
                    setMood(st.id, MAYA_STATES[st.id].expression, `Switched MAYA into ${st.label} state`)
                  }
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                    currentState === st.id && !isThinking
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'bg-zinc-100 dark:bg-[#1A1A24] text-zinc-700 dark:text-zinc-300 hover:bg-violet-500/15 hover:text-violet-600 dark:hover:text-violet-300'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                Facial Expression
              </div>
              <div className="flex flex-wrap gap-1">
                {QUICK_EXPRESSIONS.map((expr) => (
                  <button
                    key={expr}
                    type="button"
                    onClick={() => setMood(currentState, expr, `Expression: ${expr}`)}
                    className={`px-2 py-1 rounded-md text-[10px] capitalize transition-colors cursor-pointer ${
                      currentExpression === expr
                        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 font-semibold'
                        : 'bg-zinc-100 dark:bg-[#1A1A24] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {expr}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Center Column: Comprehensive Equipment SOPs, Interactions Timeline & Facility Explorer */}
        <section className="lg:col-span-4 flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121218] overflow-hidden min-h-[460px] lg:min-h-0">
          {/* Tabs */}
          <div className="flex items-center gap-1 p-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#16161E] shrink-0 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setCenterTab('sops')}
              className={`flex-1 flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                centerTab === 'sops'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>SOPs ({sops.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setCenterTab('workflow')}
              className={`flex-1 flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                centerTab === 'workflow'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Workflow ({workflowEvents.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setCenterTab('interactions')}
              className={`flex-1 flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                centerTab === 'interactions'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Activity ({interactions.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setCenterTab('facility')}
              className={`flex-1 flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                centerTab === 'facility'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Rooms ({scene.rooms.length})</span>
            </button>
          </div>

          {/* Tab: MAYA Workflow Event Log Table with Live & Completed Durations */}
          {centerTab === 'workflow' && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 shrink-0 bg-zinc-50/70 dark:bg-[#15151D]">
                <div>
                  <div className="text-xs font-bold text-zinc-900 dark:text-white">
                    MAYA Actions &amp; State Transition Log
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Tracks live &amp; completed action durations across SOPs, doors, lights, voice &amp; chat
                  </div>
                </div>
                {workflowEvents.length > 0 && (
                  <button
                    type="button"
                    onClick={clearWorkflowEvents}
                    className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[10px] font-semibold text-zinc-500 hover:text-rose-500 hover:border-rose-500/40 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-auto">
                {workflowEvents.length === 0 ? (
                  <div className="text-center py-12 px-4 space-y-2">
                    <Clock className="w-7 h-7 text-violet-400 mx-auto" />
                    <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                      No workflow events recorded yet
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Read an SOP, issue a voice command, chat with MAYA, or toggle doors/lights to inspect durations here.
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="sticky top-0 bg-zinc-100 dark:bg-[#181822] border-b border-zinc-200 dark:border-zinc-800 text-[10px] font-mono uppercase text-zinc-500">
                      <tr>
                        <th className="py-2 px-2.5">Time</th>
                        <th className="py-2 px-2">Action &amp; Target</th>
                        <th className="py-2 px-2">State</th>
                        <th className="py-2 px-2 text-right">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                      {workflowEvents.map((ev) => {
                        const liveMs =
                          ev.status === 'running'
                            ? Math.max(0, nowTick - new Date(ev.startedAt).getTime())
                            : ev.durationMs;
                        return (
                          <tr
                            key={ev.id}
                            className="hover:bg-zinc-50 dark:hover:bg-[#181822]/70 transition-colors"
                          >
                            <td className="py-2 px-2.5 font-mono text-[10px] text-zinc-400 tabular-nums whitespace-nowrap align-top">
                              {new Date(ev.startedAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </td>
                            <td className="py-2 px-2 align-top">
                              <div className="font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
                                {ev.action}
                              </div>
                              <div className="text-[10px] text-zinc-500 truncate max-w-[165px]">
                                <span className="font-mono text-violet-500 dark:text-violet-400">
                                  {ev.targetCode}
                                </span>{' '}
                                · {ev.targetName}
                              </div>
                            </td>
                            <td className="py-2 px-2 align-top whitespace-nowrap">
                              <div className="font-mono text-[9.5px] text-zinc-400">
                                {ev.fromState} → <span className="text-violet-400 font-semibold">{ev.toState}</span>
                              </div>
                              <span
                                className={`inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                  ev.status === 'running'
                                    ? 'bg-amber-500/15 text-amber-500'
                                    : ev.status === 'completed'
                                      ? 'bg-emerald-500/15 text-emerald-500'
                                      : 'bg-rose-500/15 text-rose-400'
                                }`}
                              >
                                {ev.status}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-[10.5px] font-semibold tabular-nums align-top whitespace-nowrap text-zinc-700 dark:text-zinc-200">
                              {formatWorkflowDuration(liveMs)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Tab 1: Comprehensive SOP Library */}
          {centerTab === 'sops' && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="p-2.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={sopQuery}
                    onChange={(e) => setSopQuery(e.target.value)}
                    placeholder="Search any equipment SOP, tag, or doc number..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-800 text-xs focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {/* Compact SOP Selector List */}
              <div className="max-h-44 overflow-y-auto divide-y divide-zinc-200/70 dark:divide-zinc-800/70 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                {filteredSops.map((sop) => {
                  const active = selectedSop?.id === sop.id;
                  return (
                    <button
                      key={sop.id}
                      type="button"
                      onClick={() => triggerSopSampleRead(sop)}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                        active
                          ? 'bg-violet-500/12 border-l-2 border-l-violet-500'
                          : 'hover:bg-zinc-50 dark:hover:bg-[#191922]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold text-violet-600 dark:text-violet-400">
                            {sop.docNumber}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 truncate">
                            {sop.actionType}
                          </span>
                          {sopSummaries[sop.id] && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold">
                              Summary
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-medium text-zinc-900 dark:text-white truncate">
                          {sop.title}
                        </div>
                      </div>
                      <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    </button>
                  );
                })}
              </div>

              {/* Active SOP Full Reader + Sample Summary Panel */}
              {selectedSop ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-[#16161F] border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-mono text-violet-500 font-semibold">
                        {selectedSop.docNumber} · v{selectedSop.version} · {selectedSop.status.toUpperCase()}
                      </div>
                      <div className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                        {selectedSop.title}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => triggerSopSampleRead(selectedSop)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
                        title="Have MAYA read this SOP and generate a live sample summary"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Read SOP</span>
                      </button>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => {
                          startReadingSop(selectedSop.id, selectedSop.title, null, selectedSop.docNumber);
                          sendMessage(
                            `Read and explain ${selectedSop.docNumber} (${selectedSop.title}): highlight critical safety precautions, key operating parameters, alarm response, and preventive maintenance steps.`,
                            selectedSop.id
                          );
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl gradian-violet-amber text-white text-[11px] font-semibold shadow-xs hover:opacity-95 transition-opacity cursor-pointer disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Explain AI</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {/* Live SOP Reading Progress Banner */}
                    {sopReadingState && sopReadingState.sopId === selectedSop.id && (
                      <div className="rounded-xl border border-cyan-500/45 bg-cyan-500/10 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                          <span className="flex items-center gap-1.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            MAYA Reading {selectedSop.docNumber}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums">{sopReadingState.progress}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-cyan-950/30 dark:bg-zinc-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all duration-500"
                            style={{ width: `${sopReadingState.progress}%` }}
                          />
                        </div>
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-300">{sopReadingState.phase}</div>
                      </div>
                    )}

                    {/* Structured Sample Summary Card */}
                    {(() => {
                      const summary = sopSummaries[selectedSop.id];
                      if (!summary) {
                        return (
                          <div className="rounded-xl border border-dashed border-violet-500/35 bg-violet-500/5 px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-zinc-600 dark:text-zinc-300">
                              Click <strong>Read SOP</strong> for MAYA&apos;s quick executive summary, CPP limits &amp; checklist.
                            </span>
                            <button
                              type="button"
                              onClick={() => triggerSopSampleRead(selectedSop)}
                              className="px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold shrink-0 cursor-pointer"
                            >
                              Summarize
                            </button>
                          </div>
                        );
                      }

                      const isAck = Boolean(acknowledgedSops[selectedSop.id]);
                      return (
                        <div className="rounded-xl border border-violet-500/40 bg-violet-500/[0.06] dark:bg-[#171625] p-3 space-y-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>MAYA Sample SOP Summary</span>
                            </div>
                            <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                              ~{summary.estimatedMinutes} min · {summary.docNumber}
                            </span>
                          </div>

                          <p className="text-[11.5px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                            {summary.executiveOverview}
                          </p>

                          {/* Gowning & PPE Requirement Strip */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                Required Gowning &amp; PPE
                              </span>
                              {summary.requiresFullGown && !isGowned && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGowned(true, `${summary.docNumber} Pre-Entry Gowning`);
                                    showToast('MAYA changed into Full Sterile Cleanroom Gown', 'success');
                                  }}
                                  className="px-2 py-0.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-semibold cursor-pointer"
                                >
                                  Put On Full Gown
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {summary.requiredGowning.map((ppe) => (
                                <span
                                  key={ppe}
                                  className="px-1.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-medium text-cyan-800 dark:text-cyan-200"
                                >
                                  {ppe}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Critical Process Parameters & Limits Table */}
                          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-[#111118]">
                            <table className="w-full text-left text-[10.5px] border-collapse">
                              <thead className="bg-zinc-100 dark:bg-[#191924] text-[9.5px] font-mono uppercase text-zinc-500">
                                <tr>
                                  <th className="py-1 px-2">Critical Parameter</th>
                                  <th className="py-1 px-2">Target</th>
                                  <th className="py-1 px-2">Action Limit</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70 font-mono">
                                {summary.cpps.map((row) => (
                                  <tr key={row.parameter}>
                                    <td className="py-1 px-2 font-sans font-medium text-zinc-800 dark:text-zinc-200">
                                      {row.parameter}
                                    </td>
                                    <td className="py-1 px-2 text-emerald-600 dark:text-emerald-400 font-semibold">
                                      {row.target}
                                    </td>
                                    <td className="py-1 px-2 text-amber-600 dark:text-amber-300">
                                      {row.actionLimit}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Interactive Verification Checklist */}
                          <div className="space-y-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                              Key Execution Checklist
                            </div>
                            <div className="space-y-1">
                              {summary.checklist.map((step, idx) => {
                                const stepKey = `${selectedSop.id}-${idx}`;
                                const checked = Boolean(checkedSopSteps[stepKey]);
                                return (
                                  <label
                                    key={stepKey}
                                    className="flex items-start gap-2 text-[11px] text-zinc-700 dark:text-zinc-300 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() =>
                                        setCheckedSopSteps((prev) => ({
                                          ...prev,
                                          [stepKey]: !prev[stepKey],
                                        }))
                                      }
                                      className="mt-0.5 accent-violet-600 rounded"
                                    />
                                    <span className={checked ? 'line-through opacity-60' : ''}>{step}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 border-t border-zinc-200/70 dark:border-zinc-800 pt-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="flex-1 min-w-[160px]">{summary.qaNote}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  const md = [
                                    `### Sample Summary — ${summary.docNumber}: ${summary.title}`,
                                    summary.executiveOverview,
                                    '',
                                    `**Required PPE:** ${summary.requiredGowning.join(', ')}`,
                                    '',
                                    '| Parameter | Target | Action Limit |',
                                    '| --- | --- | --- |',
                                    ...summary.cpps.map((c) => `| ${c.parameter} | ${c.target} | ${c.actionLimit} |`),
                                    '',
                                    '**Key Steps:**',
                                    ...summary.checklist.map((s, i) => `${i + 1}. ${s}`),
                                  ].join('\n');
                                  addLifeMessage({
                                    role: 'assistant',
                                    content: md,
                                    mayaState: 'teach',
                                    mayaExpression: 'confident',
                                    statusNote: `Posted sample summary for ${summary.docNumber}`,
                                    citedSopCodes: [summary.docNumber],
                                  });
                                  setMood('teach', 'confident', `Shared ${summary.docNumber} summary in chat`, 3500);
                                  showToast(`Sent ${summary.docNumber} summary to MAYA Chat`, 'info');
                                }}
                                className="px-2 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-violet-600 hover:text-white text-zinc-800 dark:text-zinc-200 text-[10px] font-semibold transition-colors cursor-pointer"
                              >
                                Send to Chat
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAcknowledgedSops((prev) => ({ ...prev, [selectedSop.id]: true }));
                                  setMood('celebrate', 'joyful', `QA acknowledged ${summary.docNumber}`, 3200);
                                  logInteraction({
                                    kind: 'sop',
                                    targetId: selectedSop.id,
                                    targetCode: selectedSop.docNumber,
                                    targetName: selectedSop.title,
                                    summary: `Acknowledged SOP sample summary & checklist (${selectedSop.docNumber})`,
                                    mayaState: 'approval',
                                    sopId: selectedSop.id,
                                  });
                                  showToast(`Acknowledged ${summary.docNumber}`, 'success');
                                }}
                                className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors cursor-pointer ${
                                  isAck
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35 hover:bg-emerald-600 hover:text-white'
                                }`}
                              >
                                {isAck ? '✓ Acknowledged' : 'Acknowledge'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    <RichMarkdownRenderer
                      markdown={selectedSop.markdown}
                      isDark={theme === 'dark'}
                      compact
                    />
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-zinc-500 p-6">
                  Select an SOP above to read its full procedure.
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Interacted Rooms, Doors, Lights, Equipment & SOPs Timeline */}
          {centerTab === 'interactions' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {interactions.length === 0 ? (
                <div className="text-center py-12 px-4 space-y-2">
                  <Footprints className="w-7 h-7 text-violet-400 mx-auto" />
                  <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    No facility interactions logged yet
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Walk through the 3D facility as MAYA and press Space beside doors, light switches, or equipment to build a live operational trail.
                  </p>
                </div>
              ) : (
                interactions.map((entry) => {
                  const icon =
                    entry.kind === 'door' ? (
                      <DoorOpen className="w-3.5 h-3.5 text-cyan-500" />
                    ) : entry.kind === 'light' ? (
                      <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                    ) : entry.kind === 'sop' ? (
                      <BookOpen className="w-3.5 h-3.5 text-violet-500" />
                    ) : entry.kind === 'equipment' ? (
                      <Wrench className="w-3.5 h-3.5 text-emerald-500" />
                    ) : entry.kind === 'room' ? (
                      <MapPin className="w-3.5 h-3.5 text-sky-500" />
                    ) : (
                      <MessageSquare className="w-3.5 h-3.5 text-pink-500" />
                    );

                  return (
                    <div
                      key={entry.id}
                      className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#171720] flex items-start justify-between gap-2"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="mt-0.5 p-1.5 rounded-lg bg-white dark:bg-[#1F1F2B] border border-zinc-200 dark:border-zinc-800 shrink-0">
                          {icon}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] font-bold text-violet-600 dark:text-violet-400">
                              {entry.targetCode}
                            </span>
                            <span className="text-[10px] text-zinc-400 tabular-nums">
                              {new Date(entry.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="text-xs font-medium text-zinc-900 dark:text-white truncate">
                            {entry.targetName}
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {entry.summary}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {entry.roomId && (
                          <button
                            type="button"
                            onClick={() => {
                              setScreen('workspace');
                              walkInsideRoom(entry.roomId!);
                            }}
                            className="p-1.5 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-300 hover:bg-violet-500/25 transition-colors cursor-pointer"
                            title="Walk inside room in 3D"
                          >
                            <Footprints className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {entry.kind === 'equipment' && (
                          <button
                            type="button"
                            onClick={() => {
                              setScreen('workspace');
                              focusEntity({ type: 'asset', id: entry.targetId });
                              openEntityInfo({ type: 'asset', id: entry.targetId });
                            }}
                            className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                            title="Inspect equipment in 3D"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {entry.sopId && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSopId(entry.sopId!);
                              setCenterTab('sops');
                            }}
                            className="p-1.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer"
                            title="Open SOP"
                          >
                            <BookOpen className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Tab 3: Facility Rooms Quick Jump */}
          {centerTab === 'facility' && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="p-2.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={facilityQuery}
                    onChange={(e) => setFacilityQuery(e.target.value)}
                    placeholder="Filter rooms by code, grade, or owner..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-[#191922] border border-zinc-200 dark:border-zinc-800 text-xs focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                {filteredRooms.map((room) => {
                  const dept = departments.find((d) => d.id === room.departmentId);
                  const owner = getDefaultRoomOwner(room, dept);
                  const cc = room.costCenter || getDepartmentCostCenter(dept);
                  const eqCount = scene.assets.filter((a) => a.roomId === room.id).length;
                  const fire = getEffectiveRoomFireSafety(room);
                  const lightOn = roomLights[room.id] ?? true;

                  return (
                    <div
                      key={room.id}
                      className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#171720] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] font-bold text-violet-600 dark:text-violet-400">
                              {room.code}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                              {room.environmental.cleanroomGrade}
                            </span>
                            <span className={`text-[10px] ${lightOn ? 'text-amber-500' : 'text-zinc-500'}`}>
                              {lightOn ? 'Lights ON' : 'Lights OFF'}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-zinc-900 dark:text-white truncate">
                            {room.name}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setScreen('workspace');
                              walkInsideRoom(room.id);
                            }}
                            className="px-2 py-1 rounded-lg bg-violet-600 text-white text-[10px] font-semibold hover:bg-violet-500 transition-colors cursor-pointer"
                          >
                            Walk
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setScreen('workspace');
                              focusEntity({ type: 'room', id: room.id });
                              openEntityInfo({ type: 'room', id: room.id });
                            }}
                            className="px-2 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-[10px] font-semibold hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
                          >
                            Info
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                        <span>Owner: {owner}</span>
                        <span>CC: {cc}</span>
                        <span>{eqCount} Assets</span>
                        <span>{fire.sensors.length} Fire Sensors</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Right Column: Live Multi-Thread AI Chat with MAYA */}
        <section className="lg:col-span-4 flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121218] overflow-hidden min-h-[460px] lg:min-h-0">
          <div className="px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#16161E] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setShowThreadList((v) => !v)}
                className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer shrink-0 ${
                  showThreadList
                    ? 'bg-violet-600 border-violet-500 text-white'
                    : 'bg-white dark:bg-[#1D1D28] border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-violet-500'
                }`}
                title={`Dedicated Chat Threads (${lifeThreads.length})`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <div className="min-w-0">
                <div className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                  {activeLifeThread?.title || 'Chat with MAYA AI'}
                </div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {lifeThreads.length} chat{lifeThreads.length === 1 ? '' : 's'} · Auto AI Titles · SOPs &amp; Twin
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  createLifeThread();
                  setShowThreadList(false);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10.5px] font-semibold transition-colors cursor-pointer"
                title="Start a new dedicated MAYA chat"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
              <button
                type="button"
                onClick={clearLifeChat}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                title="Clear Current Chat"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Dedicated Multi-Thread Chat Selector Tray */}
          {showThreadList && (
            <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-[#14141C] p-2 space-y-1 max-h-44 overflow-y-auto shrink-0">
              {lifeThreads.map((th) => {
                const isAct = th.id === activeLifeThreadId;
                return (
                  <div
                    key={th.id}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border transition cursor-pointer ${
                      isAct
                        ? 'bg-violet-600/15 border-violet-500/60 text-zinc-900 dark:text-white'
                        : 'bg-white dark:bg-[#191923] border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-violet-500/40'
                    }`}
                    onClick={() => {
                      selectLifeThread(th.id);
                      setShowThreadList(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold truncate">{th.title}</div>
                      <div className="text-[9.5px] text-zinc-400 font-mono tabular-nums">
                        {th.messages.length} msgs ·{' '}
                        {new Date(th.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    {lifeThreads.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteLifeThread(th.id);
                        }}
                        className="p-1 rounded-md text-zinc-400 hover:text-rose-500 cursor-pointer shrink-0"
                        title="Delete chat thread"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Messages */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {lifeChatMessages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-xs ${
                      isUser
                        ? 'bg-violet-600 text-white rounded-br-md'
                        : 'bg-zinc-100 dark:bg-[#191923] border border-zinc-200/80 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-bl-md'
                    }`}
                  >
                    {!isUser && msg.mayaState && (
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-violet-600 dark:text-violet-400 mb-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>MAYA · {msg.mayaState}</span>
                        {msg.citedSopCodes && msg.citedSopCodes.length > 0 && (
                          <span className="text-amber-600 dark:text-amber-400">
                            · {msg.citedSopCodes.join(', ')}
                          </span>
                        )}
                      </div>
                    )}

                    {isUser ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    ) : (
                      <RichMarkdownRenderer
                        markdown={msg.content}
                        isDark={theme === 'dark'}
                        compact
                      />
                    )}

                    {/* Navigation Targets */}
                    {!isUser && msg.navigationTargets && msg.navigationTargets.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-zinc-200/80 dark:border-zinc-800 flex flex-wrap gap-1.5">
                        {msg.navigationTargets.map((tgt, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleNavigateTarget(tgt)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 text-violet-700 dark:text-violet-300 text-[10.5px] font-semibold transition-colors cursor-pointer"
                          >
                            {tgt.type === 'sop' ? (
                              <BookOpen className="w-3 h-3" />
                            ) : tgt.type === 'room' ? (
                              <Footprints className="w-3 h-3" />
                            ) : (
                              <ShieldCheck className="w-3 h-3" />
                            )}
                            <span>{tgt.code || tgt.name}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Suggested Follow-Ups */}
                    {!isUser && msg.suggestedPrompts && msg.suggestedPrompts.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {msg.suggestedPrompts.slice(0, 3).map((prompt, idx) => (
                          <button
                            key={idx}
                            type="button"
                            disabled={sending}
                            onClick={() => sendMessage(prompt)}
                            className="text-left px-2 py-1 rounded-lg bg-white dark:bg-[#121218] border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-[10.5px] text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {sending && (
              <div className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-400 px-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>MAYA is analyzing facility telemetry &amp; SOPs...</span>
              </div>
            )}
          </div>

          {/* Voice Recording / Transcribing Strip */}
          {(transcribe.isRecording || transcribe.isTranscribing) && (
            <div className="px-3 py-2 border-t border-violet-500/30 bg-violet-500/10 flex items-center justify-between gap-2 text-xs shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {transcribe.isTranscribing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500 shrink-0" />
                    <span className="text-violet-700 dark:text-violet-300 font-medium truncate">
                      Transcribing audio (gemini-3.5-transcribe)...
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                    <span className="font-mono text-[11px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                      {String(Math.floor(transcribe.durationSec / 60)).padStart(2, '0')}:
                      {String(transcribe.durationSec % 60).padStart(2, '0')}
                    </span>
                    <div className="flex items-end gap-0.5 h-3.5">
                      {[0.35, 0.7, 1, 0.65, 0.4].map((w, idx) => (
                        <span
                          key={idx}
                          className="w-1 rounded-full bg-violet-500 transition-all duration-75"
                          style={{
                            height: `${Math.max(25, Math.min(100, Math.round((0.2 + transcribe.audioLevel * w) * 100)))}%`,
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              {transcribe.isRecording && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      transcribe.cancelRecording();
                      setMood('idle', 'neutral', 'Voice recording cancelled');
                    }}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800 cursor-pointer"
                    title="Cancel recording"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleVoice}
                    className="px-2 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-[10.5px] font-semibold hover:bg-zinc-300 dark:hover:bg-zinc-700 cursor-pointer"
                    title="Transcribe into input box"
                  >
                    Insert
                  </button>
                  <button
                    type="button"
                    onClick={handleStopAndSendVoice}
                    className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10.5px] font-semibold cursor-pointer"
                    title="Transcribe & Send to MAYA"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Quick Chart & Table Analytics Prompt Strip */}
          <div className="px-2.5 py-1.5 border-t border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-[#13131A] flex items-center gap-1 overflow-x-auto shrink-0">
            <span className="text-[10px] text-zinc-500 whitespace-nowrap mr-0.5">Templates:</span>
            {MARKDOWN_TEMPLATES.slice(0, 6).map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                disabled={sending}
                onClick={() => sendMessage(tpl.chatPrompt)}
                title={tpl.description}
                className="px-2 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-[#1B1C26] text-[10px] font-medium text-zinc-700 dark:text-zinc-300 hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-300 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-45"
              >
                {tpl.shortLabel}
              </button>
            ))}
          </div>

          {/* Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(chatInput);
            }}
            className="p-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#16161E] flex items-center gap-2 shrink-0"
          >
            <button
              type="button"
              disabled={sending || transcribe.isTranscribing}
              onClick={handleToggleVoice}
              className={`p-2.5 rounded-xl border transition-colors shrink-0 cursor-pointer disabled:opacity-45 ${
                transcribe.isRecording
                  ? 'bg-rose-600 border-rose-500 text-white shadow-sm'
                  : 'bg-white dark:bg-[#101016] border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-violet-500 hover:text-violet-500'
              }`}
              title={transcribe.isRecording ? 'Stop & Transcribe Voice' : 'Speak to MAYA (Voice Transcribe)'}
              aria-label={transcribe.isRecording ? 'Stop recording' : 'Start voice transcription'}
            >
              {transcribe.isTranscribing ? (
                <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
              ) : transcribe.isRecording ? (
                <Square className="w-4 h-4 fill-current" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                transcribe.isRecording
                  ? 'Listening... click Insert or Send when finished'
                  : 'Ask MAYA or tap Mic to speak...'
              }
              className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700 text-xs focus:outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              disabled={sending || !chatInput.trim()}
              className="p-2.5 rounded-xl gradian-violet-amber text-white shadow-sm hover:opacity-95 transition-opacity disabled:opacity-45 cursor-pointer"
              aria-label="Send message to MAYA"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
