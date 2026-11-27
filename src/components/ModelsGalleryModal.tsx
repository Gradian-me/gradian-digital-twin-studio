import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ArrowLeft,
  Box,
  Grid,
  Lightbulb,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { EQUIPMENT_CATEGORIES, OBJECT_LIBRARY } from '../data/objectLibrary';
import { DEFAULT_MATERIALS } from '../data/materialsLibrary';
import { getProceduralMaterial } from '../engine/proceduralTextures';
import { buildProceduralEquipmentGroup } from '../engine/equipmentBuilder';
import { formatCurrency } from '../utils/spatial';
import { attachCanvasPinchGuard } from '../utils/preventPinchZoom';
import { LightingDesignerPanel } from './LightingDesignerPanel';
import type { EquipmentCategory, ObjectLibraryItem, SpatialAsset } from '../types/twin';

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

function makePreviewAsset(item: ObjectLibraryItem): SpatialAsset {
  return {
    id: `preview-${item.id}`,
    floorId: 'preview',
    templateId: item.id,
    archetype: item.archetype,
    name: item.name,
    assetId: item.id.toUpperCase(),
    equipmentId: item.id.toUpperCase(),
    category: item.category,
    manufacturer: item.manufacturer,
    model: item.model,
    serialNumber: 'PREVIEW',
    description: item.description,
    tags: [],
    criticality: 'medium',
    owner: '',
    department: '',
    responsiblePerson: '',
    x: 0,
    y: 0,
    z: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    width: item.width,
    depth: item.depth,
    height: item.height,
    weightKg: item.weightKg,
    clearanceM: item.clearanceM,
    materialId: item.defaultMaterialId,
    color: item.defaultColor,
    layerId: 'layer-equipment',
    operationalStatus: 'running',
    installationDate: '2026-01-01',
    commissioningDate: '2026-01-01',
    warrantyUntil: '2030-01-01',
    maintenanceSchedule: '',
    lastMaintenance: '2026-01-01',
    nextMaintenance: '2027-01-01',
    capacityLabel: '',
    utilizationPct: 80,
    availabilityPct: 99,
    conditionScore: 100,
    lifecycle: 'operational',
    capexUsd: item.capexUsd,
    annualOpexUsd: item.annualOpexUsd,
    energyKw: item.energyKw,
    connectivity: {
      protocol: 'OPC UA',
      endpoint: '',
      plcTag: '',
      scadaNode: '',
      historianId: '',
      liveMetrics: [],
    },
    documents: [],
    qrCode: '',
    relatedSystems: [],
    relatedProcesses: [],
  };
}

export const ModelsGalleryModal: React.FC = () => {
  const showModelsGallery = useTwinStore((s) => s.showModelsGallery);
  const setShowModelsGallery = useTwinStore((s) => s.setShowModelsGallery);
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const addAsset = useTwinStore((s) => s.addAsset);
  const setSelectedObjectTemplateId = useTwinStore((s) => s.setSelectedObjectTemplateId);
  const setActiveTool = useTwinStore((s) => s.setActiveTool);

  const [galleryTab, setGalleryTab] = useState<'models' | 'lighting'>('models');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<EquipmentCategory | 'All'>('All');
  const [selectedId, setSelectedId] = useState<string>(OBJECT_LIBRARY[0].id);
  const [wireframeOverlay, setWireframeOverlay] = useState(false);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const allModels = useMemo(
    () => [...scene.customObjects, ...OBJECT_LIBRARY],
    [scene.customObjects]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allModels.filter((o) => {
      if (cat !== 'All' && o.category !== cat) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        o.manufacturer.toLowerCase().includes(q) ||
        o.model.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q)
      );
    });
  }, [allModels, search, cat]);

  const activeModel = useMemo(
    () => filtered.find((m) => m.id === selectedId) ?? filtered[0] ?? allModels[0],
    [filtered, allModels, selectedId]
  );

  // Sync selected model when filter changes
  useEffect(() => {
    if (!showModelsGallery) return;
    if (filtered.length > 0 && !filtered.some((m) => m.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [showModelsGallery, filtered, selectedId]);

  // Arrow-key 2D grid navigation + Enter to place + Escape to close
  useEffect(() => {
    if (!showModelsGallery) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowModelsGallery(false);
        return;
      }
      if (filtered.length === 0) return;

      const isInputFocused = document.activeElement === searchInputRef.current;
      if (isInputFocused && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        return;
      }

      const curIdx = Math.max(
        0,
        filtered.findIndex((m) => m.id === activeModel?.id)
      );
      const cols = window.innerWidth >= 640 ? 3 : 2;
      let nextIdx: number | null = null;

      if (e.key === 'ArrowRight') nextIdx = Math.min(filtered.length - 1, curIdx + 1);
      else if (e.key === 'ArrowLeft') nextIdx = Math.max(0, curIdx - 1);
      else if (e.key === 'ArrowDown') nextIdx = Math.min(filtered.length - 1, curIdx + cols);
      else if (e.key === 'ArrowUp') nextIdx = Math.max(0, curIdx - cols);
      else if (e.key === 'Enter' && !isInputFocused && activeModel) {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag !== 'BUTTON' || cardRefs.current.get(activeModel.id) === document.activeElement) {
          e.preventDefault();
          const fl = scene.floors.find((f) => f.id === activeFloorId);
          addAsset(activeModel.id, fl ? fl.width / 2 : 12, fl ? fl.depth / 2 : 10);
          setShowModelsGallery(false);
        }
        return;
      }

      if (nextIdx !== null && nextIdx !== curIdx) {
        e.preventDefault();
        const nextModel = filtered[nextIdx];
        if (nextModel) {
          setSelectedId(nextModel.id);
          requestAnimationFrame(() => {
            cardRefs.current.get(nextModel.id)?.scrollIntoView({
              block: 'nearest',
              behavior: 'smooth',
            });
          });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showModelsGallery, filtered, activeModel, scene.floors, activeFloorId, addAsset, setShowModelsGallery]);

  // Live Interactive 3D Turntable Preview
  useEffect(() => {
    if (!showModelsGallery || !mountRef.current || !activeModel) return;
    const container = mountRef.current;
    const w = container.clientWidth || 460;
    const h = container.clientHeight || 360;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color('#0B0B0D');
    threeScene.fog = new THREE.Fog('#0B0B0D', 12, 32);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    threeScene.environment = envTex;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight('#E0F2FE', '#27272A', 0.9);
    threeScene.add(hemi);

    const key = new THREE.DirectionalLight('#FFF7ED', 1.6);
    key.position.set(6, 9, 7);
    key.castShadow = !isSoftwareGl;
    threeScene.add(key);

    const rim = new THREE.DirectionalLight('#38BDF8', 0.75);
    rim.position.set(-6, 5, -5);
    threeScene.add(rim);

    // Charcoal Studio Pedestal Disc & Subtle Grid
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.6, 0.14, 48),
      new THREE.MeshStandardMaterial({ color: '#141417', roughness: 0.72, metalness: 0.25 })
    );
    pedestal.position.y = -0.07;
    pedestal.receiveShadow = true;
    threeScene.add(pedestal);

    const grid = new THREE.GridHelper(10, 20, 0x3f3f46, 0x1f1f24);
    grid.position.y = 0.004;
    threeScene.add(grid);

    const matDef =
      DEFAULT_MATERIALS.find((m) => m.id === activeModel.defaultMaterialId) ??
      DEFAULT_MATERIALS[0];
    const pbrMat = getProceduralMaterial(
      matDef,
      activeModel.defaultColor,
      renderer.capabilities.getMaxAnisotropy(),
      isSoftwareGl
    );
    const previewGroup = buildProceduralEquipmentGroup(
      makePreviewAsset(activeModel),
      pbrMat,
      false,
      null
    );

    if (wireframeOverlay) {
      previewGroup.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          const edgeLines = new THREE.LineSegments(
            new THREE.EdgesGeometry(mesh.geometry, 25),
            new THREE.LineBasicMaterial({ color: '#38BDF8', transparent: true, opacity: 0.75 })
          );
          mesh.add(edgeLines);
        }
      });
    }

    threeScene.add(previewGroup);

    const maxDim = Math.max(activeModel.width, activeModel.depth, activeModel.height, 1.4);
    const cam = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    cam.position.set(maxDim * 1.45, maxDim * 1.15, maxDim * 1.65);

    const controls = new OrbitControls(cam, renderer.domElement);
    controls.target.set(0, activeModel.height * 0.45, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.autoRotate = !isSoftwareGl;
    controls.autoRotateSpeed = 1.2;
    controls.update();

    let disposed = false;
    let frameId = 0;
    let busy = false;
    let dirty = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const st = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (st === gl.UNSIGNALED) frameId = window.setTimeout(poll, 5);
        else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const requestRender = () => {
      if (disposed) return;
      if (busy) {
        dirty = true;
        return;
      }
      busy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        dirty = false;
        controls.update();
        renderer.render(threeScene, cam);
        const done = () => {
          busy = false;
          if (dirty || (!isSoftwareGl && controls.autoRotate)) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    controls.addEventListener('change', requestRender);
    requestRender();

    const ro = new ResizeObserver(() => {
      if (disposed) return;
      const nw = container.clientWidth || 460;
      const nh = container.clientHeight || 360;
      cam.aspect = nw / nh;
      cam.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      requestRender();
    });
    ro.observe(container);

    const detachPinch = attachCanvasPinchGuard(container, (deltaY) => {
      const factor = deltaY > 0 ? 1.06 : 0.94;
      const offset = cam.position.clone().sub(controls.target);
      offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, 0.8, 40));
      cam.position.copy(controls.target).add(offset);
      controls.update();
      requestRender();
    });

    return () => {
      disposed = true;
      detachPinch();
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      controls.dispose();
      envTex.dispose();
      renderer.dispose();
    };
  }, [showModelsGallery, activeModel, wireframeOverlay, galleryTab]);

  if (!showModelsGallery) return null;

  const handlePlaceNow = () => {
    const fl = scene.floors.find((f) => f.id === activeFloorId);
    const cx = fl ? fl.width / 2 : 12;
    const cz = fl ? fl.depth / 2 : 10;
    addAsset(activeModel.id, cx, cz);
    setShowModelsGallery(false);
  };

  const handleSelectPlacementTool = () => {
    setSelectedObjectTemplateId(activeModel.id);
    setActiveTool('place-object');
    setShowModelsGallery(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-6xl h-[100dvh] sm:h-[88vh] bg-white dark:bg-[#111114] border-0 sm:border border-zinc-200 dark:border-zinc-800 rounded-none sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-4 bg-zinc-50 dark:bg-[#0D0D10] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setShowModelsGallery(false)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 shrink-0 transition-colors"
              title="Back"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
              <span className="hidden sm:inline">Back</span>
            </button>
            <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
              <Box className="w-4 h-4 text-violet-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white truncate">
                3D Industrial &amp; Biopharma Asset Gallery ({allModels.length} Models)
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                Inspect every parametric PBR equipment assembly in 360° real-time 3D before placing into your digital twin
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center p-0.5 rounded-xl bg-zinc-200/70 dark:bg-[#171720] border border-zinc-300 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setGalleryTab('models')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  galleryTab === 'models'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                3D Equipment ({allModels.length})
              </button>
              <button
                type="button"
                onClick={() => setGalleryTab('lighting')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  galleryTab === 'lighting'
                    ? 'bg-amber-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5" />
                Light &amp; Switch Designer
              </button>
            </div>
            <button
              onClick={() => setShowModelsGallery(false)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {galleryTab === 'lighting' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 bg-white dark:bg-[#111116]">
            <div className="max-w-4xl mx-auto">
              <LightingDesignerPanel />
            </div>
          </div>
        ) : (
        /* Body Split: Left Catalog Grid + Right Live 3D Inspector Stage */
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left Model Grid */}
          <div className="lg:col-span-7 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-zinc-200 dark:border-zinc-800">
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2 shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search 3D models by equipment name, manufacturer, or model..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
                />
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                {(['All', ...EQUIPMENT_CATEGORIES] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCat(c)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                      cat === c
                        ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                        : 'bg-zinc-100 dark:bg-[#18181C] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5 content-start">
              {filtered.map((item) => {
                const isSelected = item.id === activeModel?.id;
                return (
                  <button
                    key={item.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(item.id, el);
                      else cardRefs.current.delete(item.id);
                    }}
                    onClick={() => setSelectedId(item.id)}
                    className={`text-left p-3 rounded-xl border transition-colors flex flex-col justify-between gap-2 ${
                      isSelected
                        ? 'border-violet-500 ring-1 ring-violet-500/40 bg-violet-500/10 dark:bg-violet-500/15'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#161619] hover:border-zinc-400 dark:hover:border-zinc-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className="w-3 h-3 rounded-sm shrink-0 mt-0.5 border border-black/15"
                        style={{ backgroundColor: item.defaultColor }}
                      />
                      <span className="font-mono text-[10px] text-zinc-500">
                        {item.width}×{item.depth}m
                      </span>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-zinc-900 dark:text-white line-clamp-2">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                        {item.manufacturer} · {item.model}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Live 3D Turntable Stage & Spec Sheet */}
          <div className="lg:col-span-5 flex flex-col min-h-0 bg-[#0B0B0D] text-zinc-100">
            <div className="relative flex-1 min-h-[240px]">
              <div ref={mountRef} className="w-full h-full" />
              <div className="absolute top-3 left-3 flex items-center gap-1.5">
                <button
                  onClick={() => setWireframeOverlay((v) => !v)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                    wireframeOverlay
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                      : 'bg-[#141417]/90 border-zinc-700 text-zinc-300 hover:text-white'
                  }`}
                >
                  <Grid className="w-3 h-3" />
                  {wireframeOverlay ? 'CAD Blueprint Edges On' : 'Overlay CAD Edges'}
                </button>
              </div>
              <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-[10px] font-mono text-zinc-400 pointer-events-none">
                <span>Drag to orbit 360° · Scroll to zoom</span>
                <span>← ↑ ↓ → Browse · Enter Place · Esc Close</span>
              </div>
            </div>

            {activeModel && (
              <div className="p-4 border-t border-zinc-800 bg-[#111114] space-y-3 shrink-0">
                <div>
                  <div className="text-[10px] font-mono text-emerald-400">
                    {activeModel.category} · {activeModel.manufacturer} {activeModel.model}
                  </div>
                  <h3 className="text-sm font-semibold text-white mt-0.5">{activeModel.name}</h3>
                  <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                    {activeModel.description}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-[11px]">
                  <div className="p-2 rounded-lg bg-[#18181C] border border-zinc-800">
                    <div className="text-[10px] text-zinc-500">Dimensions</div>
                    <div className="text-white font-semibold">
                      {activeModel.width}×{activeModel.depth}×{activeModel.height}m
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#18181C] border border-zinc-800">
                    <div className="text-[10px] text-zinc-500">CapEx / Power</div>
                    <div className="text-white font-semibold">
                      {formatCurrency(activeModel.capexUsd)} · {activeModel.energyKw}kW
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-[#18181C] border border-zinc-800">
                    <div className="text-[10px] text-zinc-500">Mass / Clear</div>
                    <div className="text-white font-semibold">
                      {activeModel.weightKg}kg · {activeModel.clearanceM}m
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePlaceNow}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Place at Floor Center
                  </button>
                  <button
                    onClick={handleSelectPlacementTool}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 text-xs font-medium whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                    Pick Placement Tool
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
