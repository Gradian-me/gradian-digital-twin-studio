import { create } from 'zustand';
import type {
  AnalyticsMetric,
  AuditLogEntry,
  Building,
  DigitalTwinScene,
  EnterpriseNode,
  Floor,
  FlowRoute,
  FlowType,
  LayerDef,
  LocalSnapshot,
  MaterialDef,
  ObjectLibraryItem,
  Opening,
  OpeningSubtype,
  OrthoPreset,
  ProposedAIAction,
  ReferencePlan,
  Room,
  SceneCamera,
  SnapConfig,
  SpaceTypeTemplate,
  SpatialAsset,
  ToolMode,
  TransformMode,
  UnitSystem,
  ValidationIssue,
  ViewMode,
  Wall,
  WallPresetId,
} from '../types/twin';
import {
  createCinnaGenCampusScene,
  createTemplateScene,
  generateWallsForRoom,
} from '../data/cinnagenDemo';
import { DEFAULT_MATERIALS, OPENING_PRESETS, WALL_PRESETS } from '../data/materialsLibrary';
import { OBJECT_LIBRARY } from '../data/objectLibrary';
import { SPACE_TYPE_LIBRARY } from '../data/spaceTypes';
import { runSpatialValidation, snapValue } from '../utils/spatial';

export type SelectedEntity =
  | { type: 'room'; id: string }
  | { type: 'wall'; id: string }
  | { type: 'opening'; id: string }
  | { type: 'asset'; id: string }
  | { type: 'camera'; id: string }
  | { type: 'flow'; id: string }
  | { type: 'reference'; id: string }
  | { type: 'floor'; id: string }
  | { type: 'building'; id: string }
  | { type: 'hierarchy'; id: string };

export type LeftPanelTab = 'hierarchy' | 'spaces' | 'objects' | 'layers' | 'references';
export type RightPanelTab =
  | 'properties'
  | 'materials'
  | 'cameras'
  | 'analytics'
  | 'flows'
  | 'validation'
  | 'copilot'
  | 'schema';

export type DrillLevel = 'campus' | 'building' | 'floor' | 'department' | 'room' | 'asset';
export type RenderStyle = 'realistic' | 'blueprint-split' | 'wireframe';

export interface IsolatedAssetTypeInfo {
  templateId: string;
  archetype: string;
  label: string;
  count: number;
  buildingsCount: number;
  floorsCount: number;
}

export interface GeneratedFloorPlanPayload {
  planName: string;
  summary: string;
  footprintWidth: number;
  footprintDepth: number;
  ceilingHeight: number;
  rooms: {
    code: string;
    name: string;
    spaceTypeId?: string;
    x: number;
    z: number;
    width: number;
    depth: number;
    height?: number;
    cleanroomGrade?: string;
    pressurePa?: number;
    airChangesPerHour?: number;
    temperatureC?: number;
    color?: string;
  }[];
  equipment: {
    name: string;
    templateId: string;
    roomCode?: string;
    x: number;
    z: number;
    rotationDeg?: number;
  }[];
  flows: {
    name: string;
    flowType: string;
    cleanlinessClass?: string;
    points: { x: number; z: number }[];
  }[];
}

export interface ToastNotice {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  canUndo?: boolean;
}

const LOCAL_PROJECTS_KEY = 'gradian_dt_projects_v1';
const LOCAL_SNAPSHOTS_KEY = 'gradian_dt_snapshots_v1';
const LOCAL_AUDIT_KEY = 'gradian_dt_audit_v1';

function loadLocalAudit(projectId: string): AuditLogEntry[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_AUDIT_KEY}_${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalAudit(projectId: string, entries: AuditLogEntry[]) {
  try {
    localStorage.setItem(`${LOCAL_AUDIT_KEY}_${projectId}`, JSON.stringify(entries.slice(0, 300)));
  } catch {
    // ignore storage quota
  }
}

function loadLocalProjects(): DigitalTwinScene[] {
  try {
    const raw = localStorage.getItem(LOCAL_PROJECTS_KEY);
    if (!raw) return [createCinnaGenCampusScene()];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return [createCinnaGenCampusScene()];
  } catch {
    return [createCinnaGenCampusScene()];
  }
}

function saveLocalProjects(list: DigitalTwinScene[]) {
  try {
    localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    // ignore storage quota errors
  }
}

function loadLocalSnapshots(projectId: string): LocalSnapshot[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_SNAPSHOTS_KEY}_${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalSnapshots(projectId: string, list: LocalSnapshot[]) {
  try {
    localStorage.setItem(`${LOCAL_SNAPSHOTS_KEY}_${projectId}`, JSON.stringify(list.slice(0, 20)));
  } catch {
    // ignore
  }
}

export interface SplitLayoutState {
  orientation: 'horizontal' | 'vertical';
  flipped: boolean;
  ratio: number; // 0.2 .. 0.8
}

interface TwinState {
  // App-level mode
  screen: 'hub' | 'workspace';
  theme: 'dark' | 'light';
  canvasBackdrop: 'dark' | 'light';
  savedProjects: DigitalTwinScene[];

  // Active scene & history
  scene: DigitalTwinScene;
  past: DigitalTwinScene[];
  future: DigitalTwinScene[];
  snapshots: LocalSnapshot[];
  dirty: boolean;

  // Active spatial navigation & 3D Drill-Down
  activeBuildingId: string;
  activeFloorId: string;
  activeDepartmentId: string | null;
  activeRoomId: string | null;
  drillLevel: DrillLevel;
  showAllFloors: boolean;
  renderStyle: RenderStyle;

  // View & tool controls
  viewMode: ViewMode;
  orthoPreset: OrthoPreset;
  activeTool: ToolMode;
  transformMode: TransformMode;
  selectedSpaceTypeId: string;
  selectedObjectTemplateId: string;
  selectedWallPresetId: WallPresetId;
  selectedOpeningSubtype: OpeningSubtype;
  selectedMaterialId: string;
  selectedFlowType: FlowType;
  sectionCutEnabled: boolean;
  sectionCutAxis: 'y' | 'x' | 'z';
  sectionCutHeight: number;
  sectionCutFlipped: boolean;
  explodedFactor: number;
  firstPersonMode: boolean;
  firstPersonTabletVisible: boolean;
  showNavMesh: boolean;
  lightingMode: 'day' | 'night';
  splitLayout: SplitLayoutState;
  animateFlows: boolean;
  showFlowLegend: boolean;
  editingFlowId: string | null;

  // Panels & UI
  leftTab: LeftPanelTab;
  rightTab: RightPanelTab;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  bottomTimelineOpen: boolean;
  canvasMaximized: boolean;
  showExportModal: boolean;
  showXRModal: boolean;
  showOnboarding: boolean;
  showAIPlannerModal: boolean;
  showModelsGallery: boolean;
  showQuickSearch: boolean;
  showMayaChat: boolean;
  showCameraManager: boolean;
  activeLiveCameraId: string | null;
  showNetworkRackModal: boolean;
  activeRackAssetId: string | null;
  showSaveValidationModal: boolean;
  autoSaveEnabled: boolean;
  autoSaveSecondsLeft: number;
  showAuditTrailModal: boolean;
  auditLog: AuditLogEntry[];
  completedOnboardingSteps: number[];

  // Selection, Organization-Wide Isolation & hover
  selected: SelectedEntity[];
  isolatedIds: string[];
  isolatedAssetType: IsolatedAssetTypeInfo | null;
  activeLayerFocusId: string | null;
  cursorCoords: { x: number; y: number; z: number };
  measurePoints: { x: number; z: number }[];

  // Calibration state for Reference Images
  calibratingRefId: string | null;
  calibrationPoints: { x: number; z: number }[];

  // Snapping & Grid
  snap: SnapConfig;

  // 5D Timeline & Analytics
  timelineDate: string; // YYYY-MM-DD
  compareDate: string | null;
  timelinePlaying: boolean;
  timelineSpeed: number;
  analyticsMetric: AnalyticsMetric;
  validationIssues: ValidationIssue[];

  // Camera flight signal
  cameraCommand: {
    id: number;
    position: [number, number, number];
    target: [number, number, number];
    fov?: number;
  } | null;

  // Favorites
  favoriteSpaceTypes: string[];
  favoriteObjects: string[];
  favoriteMaterials: string[];

  // AI Copilot preview state
  pendingAIActions: ProposedAIAction[];
  aiPreviewMessage: string | null;

  // Toast
  toast: ToastNotice | null;

  // Actions
  setScreen: (screen: 'hub' | 'workspace') => void;
  toggleTheme: () => void;
  toggleCanvasBackdrop: () => void;
  openProject: (project: DigitalTwinScene) => void;
  openCinnaGenDemo: () => void;
  createNewProject: (template: 'blank' | 'aseptic-suite' | 'qc-lab' | 'cold-warehouse', name?: string) => void;
  deleteSavedProject: (projectId: string) => void;
  importProjectJSON: (scene: DigitalTwinScene) => void;
  saveProjectToLocal: () => void;
  setActiveBuilding: (buildingId: string) => void;
  setActiveFloor: (floorId: string) => void;
  setShowAllFloors: (show: boolean) => void;
  setRenderStyle: (style: RenderStyle) => void;
  drillInto: (level: DrillLevel, entityId?: string) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;

  // Tools & Views
  setViewMode: (mode: ViewMode) => void;
  setOrthoPreset: (preset: OrthoPreset) => void;
  setActiveTool: (tool: ToolMode) => void;
  setTransformMode: (mode: TransformMode) => void;
  setSelectedSpaceTypeId: (id: string) => void;
  setSelectedObjectTemplateId: (id: string) => void;
  setSelectedWallPresetId: (id: WallPresetId) => void;
  setSelectedOpeningSubtype: (id: OpeningSubtype) => void;
  setSelectedMaterialId: (id: string) => void;
  setSelectedFlowType: (type: FlowType) => void;
  setSectionCut: (enabled: boolean, height?: number, axis?: 'y' | 'x' | 'z', flipped?: boolean) => void;
  resetSectionCut: () => void;
  setExplodedFactor: (factor: number) => void;
  setFirstPersonMode: (enabled: boolean) => void;
  setFirstPersonTabletVisible: (visible: boolean) => void;
  setShowNavMesh: (show: boolean) => void;
  setLightingMode: (mode: 'day' | 'night') => void;
  toggleLightingMode: () => void;
  updateSplitLayout: (patch: Partial<SplitLayoutState>) => void;
  setAnimateFlows: (animate: boolean) => void;
  setShowFlowLegend: (show: boolean) => void;
  setEditingFlowId: (flowId: string | null) => void;
  setUnitSystem: (unit: UnitSystem) => void;
  updateSnap: (patch: Partial<SnapConfig>) => void;

  // Panels & Modals
  setLeftTab: (tab: LeftPanelTab) => void;
  setRightTab: (tab: RightPanelTab) => void;
  setLeftPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setBottomTimelineOpen: (open: boolean) => void;
  toggleMaximizeCanvas: () => void;
  setShowExportModal: (open: boolean) => void;
  setShowXRModal: (open: boolean) => void;
  setShowOnboarding: (open: boolean) => void;
  setShowAIPlannerModal: (open: boolean) => void;
  setShowModelsGallery: (open: boolean) => void;
  setShowQuickSearch: (open: boolean) => void;
  setShowMayaChat: (open: boolean) => void;
  setShowCameraManager: (open: boolean) => void;
  openLiveCamera: (cameraId: string | null) => void;
  openRackDesigner: (assetId?: string | null) => void;
  closeRackDesigner: () => void;
  setShowSaveValidationModal: (open: boolean) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  setAutoSaveSecondsLeft: (seconds: number) => void;
  setShowAuditTrailModal: (open: boolean) => void;
  recordAudit: (entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'actor'>) => void;
  clearAuditLog: () => void;
  applyValidationAutoFixes: (fixes: { action: string; entityId?: string; title?: string }[]) => number;
  completeOnboardingStep: (step: number) => void;

  // Selection, Organization-Wide Isolation, Direct URL & Cursor
  selectEntity: (entity: SelectedEntity | null, additive?: boolean) => void;
  clearSelection: () => void;
  setIsolatedIds: (ids: string[]) => void;
  isolateSameTypeOrgWide: (assetId: string) => void;
  isolateLayerDirect: (layerId: string) => void;
  clearIsolation: () => void;
  buildDirectUrl: (overrides?: {
    layerId?: string;
    buildingId?: string;
    floorId?: string;
    roomId?: string;
    assetId?: string;
    drillLevel?: DrillLevel;
    isolateType?: string;
  }) => string;
  applyUrlDeepLink: () => void;
  applyAIGeneratedFloorPlan: (
    plan: GeneratedFloorPlanPayload,
    parentTarget: {
      mode: 'new-floor' | 'replace-floor' | 'new-building';
      buildingId?: string;
      floorId?: string;
      departmentId?: string;
      newBuildingName?: string;
      newFloorName?: string;
    }
  ) => void;
  setCursorCoords: (coords: { x: number; y: number; z: number }) => void;
  addMeasurePoint: (pt: { x: number; z: number }) => void;
  clearMeasure: () => void;

  // Spatial CRUD
  addFloor: (input: { buildingId: string; name: string; height: number; width: number; depth: number; duplicateFromFloorId?: string }) => void;
  addBuilding: (name: string) => void;
  renameHierarchyEntity: (type: SelectedEntity['type'], id: string, name: string) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;

  addRoom: (x: number, z: number, width: number, depth: number, spaceTypeId?: string, customName?: string) => Room;
  updateRoom: (id: string, patch: Partial<Room>) => void;

  addWall: (x1: number, z1: number, x2: number, z2: number, presetId?: WallPresetId) => Wall;
  updateWall: (id: string, patch: Partial<Wall>) => void;
  splitWall: (id: string) => void;

  addOpeningOnWall: (wallId: string, offsetRatio: number, subtype?: OpeningSubtype) => Opening | null;
  updateOpening: (id: string, patch: Partial<Opening>) => void;

  addAsset: (templateId: string, x: number, z: number, opts?: Partial<SpatialAsset>) => SpatialAsset;
  updateAsset: (id: string, patch: Partial<SpatialAsset>, recordHistory?: boolean) => void;
  alignSelectedAssets: (mode: 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-z' | 'distribute-x' | 'distribute-z') => void;

  paintSurfaceWithMaterial: (targetType: 'room' | 'wall' | 'asset', id: string, materialId: string) => void;
  addCustomMaterial: (mat: MaterialDef) => void;
  addCustomSpaceType: (tpl: SpaceTypeTemplate) => void;
  addCustomObjectTemplate: (obj: ObjectLibraryItem) => void;

  addCamera: (cam: Omit<SceneCamera, 'id'>) => SceneCamera;
  updateCamera: (id: string, patch: Partial<SceneCamera>) => void;
  deleteCamera: (id: string) => void;
  flyToCamera: (position: [number, number, number], target: [number, number, number], fov?: number) => void;
  focusEntity: (entity: SelectedEntity) => void;

  addReferencePlan: (ref: Omit<ReferencePlan, 'id'>) => ReferencePlan;
  updateReferencePlan: (id: string, patch: Partial<ReferencePlan>) => void;
  deleteReferencePlan: (id: string) => void;
  startCalibratingRef: (refId: string) => void;
  addCalibrationPoint: (pt: { x: number; z: number }) => void;
  applyReferenceCalibration: (realDistanceMeters: number) => void;
  cancelCalibration: () => void;

  updateLayer: (id: string, patch: Partial<LayerDef>) => void;
  addLayer: (name: string, group: LayerDef['group'], color: string) => void;

  addFlowRoute: (flow: Omit<FlowRoute, 'id'>) => FlowRoute;
  updateFlowRoute: (id: string, patch: Partial<FlowRoute>) => void;
  deleteFlowRoute: (id: string) => void;

  // 5D & Analytics
  setTimelineDate: (date: string) => void;
  setCompareDate: (date: string | null) => void;
  setTimelinePlaying: (playing: boolean) => void;
  setTimelineSpeed: (speed: number) => void;
  setAnalyticsMetric: (metric: AnalyticsMetric) => void;
  refreshValidation: () => void;

  // Snapshots
  createSnapshot: (label: string, summary?: string) => LocalSnapshot;
  restoreSnapshot: (snapshot: LocalSnapshot) => void;

  // Favorites
  toggleFavorite: (kind: 'space' | 'object' | 'material', id: string) => void;

  // AI Copilot
  setPendingAIActions: (actions: ProposedAIAction[], message: string | null) => void;
  applyPendingAIActions: () => void;
  clearPendingAIActions: () => void;

  // Toasts
  showToast: (message: string, tone?: ToastNotice['tone'], canUndo?: boolean) => void;
  dismissToast: () => void;
}

const initialScene = createCinnaGenCampusScene();
const initialProjects = loadLocalProjects();

export const useTwinStore = create<TwinState>((set, get) => {
  const appendAudit = (
    currentLog: AuditLogEntry[],
    projectId: string,
    entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'actor'>
  ): AuditLogEntry[] => {
    const nextEntry: AuditLogEntry = {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      actor: 'Facility Engineer',
      ...entry,
    };
    const next = [nextEntry, ...currentLog].slice(0, 300);
    saveLocalAudit(projectId, next);
    return next;
  };

  const commit = (
    updater: (draft: DigitalTwinScene) => DigitalTwinScene,
    toastMsg?: string,
    auditMeta?: Omit<AuditLogEntry, 'id' | 'timestamp' | 'actor'>
  ) => {
    const prev = get().scene;
    const next = updater(structuredClone(prev));
    next.updatedAt = new Date().toISOString();
    const validationIssues = runSpatialValidation(next);
    const savedProjects = get().savedProjects.some((p) => p.id === next.id)
      ? get().savedProjects.map((p) => (p.id === next.id ? next : p))
      : [next, ...get().savedProjects];
    saveLocalProjects(savedProjects);

    const nextAudit = appendAudit(
      get().auditLog,
      next.id,
      auditMeta ?? {
        category: 'spatial',
        action: toastMsg || 'Updated Digital Twin Model',
        summary: toastMsg || `Modified digital twin revision ${next.revision}`,
      }
    );

    set((state) => ({
      scene: next,
      savedProjects,
      past: [...state.past.slice(-49), prev],
      future: [],
      dirty: true,
      validationIssues,
      auditLog: nextAudit,
      toast: toastMsg
        ? { id: `t-${Date.now()}`, message: toastMsg, tone: 'success', canUndo: true }
        : state.toast,
    }));
  };

  return {
    screen: 'hub',
    theme: 'dark',
    canvasBackdrop: 'dark',
    savedProjects: initialProjects,

    scene: initialScene,
    past: [],
    future: [],
    snapshots: loadLocalSnapshots(initialScene.id),
    dirty: false,

    activeBuildingId: initialScene.buildings[0].id,
    activeFloorId: initialScene.floors[0].id,
    activeDepartmentId: null,
    activeRoomId: null,
    drillLevel: 'floor',
    showAllFloors: false,
    renderStyle: 'realistic',

    viewMode: '3d-perspective',
    orthoPreset: 'isometric',
    activeTool: 'select',
    transformMode: 'translate',
    selectedSpaceTypeId: 'st-cell-culture',
    selectedObjectTemplateId: 'eq-bioreactor-ss',
    selectedWallPresetId: 'cleanroom-panel',
    selectedOpeningSubtype: 'cleanroom-door',
    selectedMaterialId: 'mat-epoxy-clean-blue',
    selectedFlowType: 'personnel',
    sectionCutEnabled: false,
    sectionCutAxis: 'y',
    sectionCutHeight: 2.4,
    sectionCutFlipped: false,
    explodedFactor: 0,
    firstPersonMode: false,
    firstPersonTabletVisible: true,
    showNavMesh: false,
    lightingMode: 'day',
    splitLayout: { orientation: 'horizontal', flipped: false, ratio: 0.48 },
    animateFlows: true,
    showFlowLegend: true,
    editingFlowId: null,

    leftTab: 'hierarchy',
    rightTab: 'properties',
    leftPanelOpen: true,
    rightPanelOpen: true,
    bottomTimelineOpen: false,
    canvasMaximized: false,
    showExportModal: false,
    showXRModal: false,
    showOnboarding: false,
    showAIPlannerModal: false,
    showModelsGallery: false,
    showQuickSearch: false,
    showMayaChat: false,
    showCameraManager: false,
    activeLiveCameraId: null,
    showNetworkRackModal: false,
    activeRackAssetId: null,
    showSaveValidationModal: false,
    autoSaveEnabled: (() => {
      try {
        return localStorage.getItem('gradian_autosave_v1') === 'true';
      } catch {
        return false;
      }
    })(),
    autoSaveSecondsLeft: 60,
    showAuditTrailModal: false,
    auditLog: loadLocalAudit(initialScene.id),
    completedOnboardingSteps: [],

    selected: [],
    isolatedIds: [],
    isolatedAssetType: null,
    activeLayerFocusId: null,
    cursorCoords: { x: 0, y: 0, z: 0 },
    measurePoints: [],

    calibratingRefId: null,
    calibrationPoints: [],

    snap: {
      enabled: true,
      showGrid: true,
      gridSize: 0.5,
      majorGridEvery: 4,
      gridOpacity: 0.45,
      snapToGrid: true,
      snapToWall: true,
      snapToObject: true,
      snapToCenter: true,
      angleStepDeg: 15,
    },

    timelineDate: '2026-11-22',
    compareDate: null,
    timelinePlaying: false,
    timelineSpeed: 1,
    analyticsMetric: 'none',
    validationIssues: runSpatialValidation(initialScene),

    cameraCommand: null,

    favoriteSpaceTypes: ['st-cell-culture', 'st-aseptic-filling', 'st-qc-analytical', 'st-cold-storage'],
    favoriteObjects: ['eq-bioreactor-ss', 'eq-chrom-skid', 'eq-vial-filler', 'eq-hplc', 'eq-biosafety-cab', 'eq-pallet-rack'],
    favoriteMaterials: ['mat-epoxy-clean-blue', 'mat-cleanroom-panel', 'mat-stainless-316l', 'mat-glass-cleanroom'],

    pendingAIActions: [],
    aiPreviewMessage: null,
    toast: null,

    setScreen: (screen) => set({ screen }),

    toggleTheme: () =>
      set((state) => {
        const next = state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.classList.toggle('dark', next === 'dark');
        return { theme: next, canvasBackdrop: next };
      }),

    toggleCanvasBackdrop: () =>
      set((state) => ({ canvasBackdrop: state.canvasBackdrop === 'dark' ? 'light' : 'dark' })),

    openProject: (project) => {
      const cloned = structuredClone(project);
      const bldgId = cloned.buildings[0]?.id ?? '';
      const flId = cloned.floors[0]?.id ?? '';
      set({
        screen: 'workspace',
        scene: cloned,
        past: [],
        future: [],
        snapshots: loadLocalSnapshots(cloned.id),
        activeBuildingId: bldgId,
        activeFloorId: flId,
        selected: [],
        isolatedIds: [],
        analyticsMetric: 'none',
        validationIssues: runSpatialValidation(cloned),
        pendingAIActions: [],
        dirty: false,
      });
    },

    openCinnaGenDemo: () => {
      const demo = createCinnaGenCampusScene();
      get().openProject(demo);
      get().showToast('Loaded CinnaGen Biopharmaceutical Manufacturing Campus', 'info');
    },

    createNewProject: (template, name) => {
      const next = createTemplateScene(template, name);
      const saved = [next, ...get().savedProjects];
      saveLocalProjects(saved);
      set({ savedProjects: saved });
      get().openProject(next);
      get().showToast(`Created "${next.name}"`, 'success');
    },

    deleteSavedProject: (projectId) =>
      set((state) => {
        const next = state.savedProjects.filter((p) => p.id !== projectId);
        saveLocalProjects(next);
        return { savedProjects: next };
      }),

    importProjectJSON: (imported) => {
      const saved = [imported, ...get().savedProjects.filter((p) => p.id !== imported.id)];
      saveLocalProjects(saved);
      set({ savedProjects: saved });
      get().openProject(imported);
      get().showToast(`Imported digital twin "${imported.name}"`, 'success');
    },

    saveProjectToLocal: () => {
      const { scene, savedProjects, auditLog } = get();
      const updated = savedProjects.some((p) => p.id === scene.id)
        ? savedProjects.map((p) => (p.id === scene.id ? scene : p))
        : [scene, ...savedProjects];
      saveLocalProjects(updated);
      const nextAudit = appendAudit(auditLog, scene.id, {
        category: 'save',
        action: 'Saved Digital Twin Revision',
        entityType: 'project',
        entityId: scene.id,
        entityName: scene.name,
        summary: `Saved "${scene.name}" rev.${scene.revision} (${scene.rooms.length} rooms, ${scene.assets.length} assets, ${scene.flows.length} flows)`,
      });
      set({ savedProjects: updated, dirty: false, auditLog: nextAudit });
      get().showToast('Project saved & recorded in Audit Trail', 'success');
    },

    setActiveBuilding: (buildingId) => {
      const floor = get().scene.floors.find((f) => f.buildingId === buildingId);
      set({
        activeBuildingId: buildingId,
        activeFloorId: floor?.id ?? get().activeFloorId,
        selected: [],
      });
    },

    setActiveFloor: (floorId) => {
      const floor = get().scene.floors.find((f) => f.id === floorId);
      if (!floor) return;
      set({
        activeFloorId: floorId,
        activeBuildingId: floor.buildingId,
        selected: [],
      });
    },

    setShowAllFloors: (showAllFloors) => set({ showAllFloors }),
    setRenderStyle: (renderStyle) => set({ renderStyle }),

    drillInto: (level, entityId) => {
      const { scene, activeBuildingId, activeFloorId } = get();
      if (level === 'campus') {
        set({
          drillLevel: 'campus',
          showAllFloors: true,
          activeDepartmentId: null,
          activeRoomId: null,
          isolatedIds: [],
          isolatedAssetType: null,
          selected: [],
        });
        const maxX = Math.max(44, ...scene.buildings.map((b) => b.originX + b.width));
        get().flyToCamera([maxX * 0.55, 44, 58], [maxX * 0.45, 2, 12], 46);
      } else if (level === 'building') {
        const bldg = scene.buildings.find((b) => b.id === (entityId ?? activeBuildingId)) ?? scene.buildings[0];
        if (!bldg) return;
        const firstFloor = scene.floors.find((f) => f.buildingId === bldg.id);
        set({
          drillLevel: 'building',
          activeBuildingId: bldg.id,
          activeFloorId: firstFloor?.id ?? activeFloorId,
          activeDepartmentId: null,
          activeRoomId: null,
          showAllFloors: true,
          isolatedIds: [],
          isolatedAssetType: null,
          selected: [{ type: 'building', id: bldg.id }],
        });
        const cx = bldg.width / 2;
        const cz = bldg.depth / 2;
        get().flyToCamera([cx + bldg.width * 0.65, 26, cz + bldg.depth * 1.4], [cx, 3.5, cz], 45);
      } else if (level === 'floor') {
        const fl = scene.floors.find((f) => f.id === (entityId ?? activeFloorId)) ?? scene.floors[0];
        if (!fl) return;
        set({
          drillLevel: 'floor',
          activeBuildingId: fl.buildingId,
          activeFloorId: fl.id,
          activeDepartmentId: null,
          activeRoomId: null,
          showAllFloors: false,
          isolatedIds: [],
          isolatedAssetType: null,
          selected: [{ type: 'floor', id: fl.id }],
        });
        get().flyToCamera([fl.width / 2, 22, fl.depth * 1.48], [fl.width / 2, fl.elevation + 1.2, fl.depth / 2], 45);
      } else if (level === 'department') {
        const deptId = entityId ?? get().activeDepartmentId;
        if (!deptId) return;
        const deptRooms = scene.rooms.filter((r) => r.departmentId === deptId);
        const firstRoom = deptRooms[0];
        if (firstRoom) {
          const fl = scene.floors.find((f) => f.id === firstRoom.floorId);
          const minX = Math.min(...deptRooms.map((r) => r.x));
          const maxX = Math.max(...deptRooms.map((r) => r.x + r.width));
          const minZ = Math.min(...deptRooms.map((r) => r.z));
          const maxZ = Math.max(...deptRooms.map((r) => r.z + r.depth));
          const cx = (minX + maxX) / 2;
          const cz = (minZ + maxZ) / 2;
          const deptAssetIds = scene.assets
            .filter((a) => deptRooms.some((r) => r.id === a.roomId))
            .map((a) => a.id);
          set({
            drillLevel: 'department',
            activeBuildingId: fl?.buildingId ?? activeBuildingId,
            activeFloorId: firstRoom.floorId,
            activeDepartmentId: deptId,
            activeRoomId: null,
            showAllFloors: false,
            isolatedAssetType: null,
            isolatedIds: [...deptRooms.map((r) => r.id), ...deptAssetIds],
          });
          get().flyToCamera([cx + 12, 16, cz + 15], [cx, (fl?.elevation ?? 0) + 1.2, cz], 45);
        }
      } else if (level === 'room') {
        const rm = scene.rooms.find((r) => r.id === (entityId ?? get().activeRoomId));
        if (!rm) return;
        const fl = scene.floors.find((f) => f.id === rm.floorId);
        set({
          drillLevel: 'room',
          activeBuildingId: fl?.buildingId ?? activeBuildingId,
          activeFloorId: rm.floorId,
          activeDepartmentId: rm.departmentId,
          activeRoomId: rm.id,
          showAllFloors: false,
          isolatedIds: [],
          isolatedAssetType: null,
          selected: [{ type: 'room', id: rm.id }],
        });
        const cx = rm.x + rm.width / 2;
        const cz = rm.z + rm.depth / 2;
        const elev = fl?.elevation ?? 0;
        get().flyToCamera(
          [cx + rm.width * 0.62, elev + Math.max(6.5, rm.width * 0.65), cz + rm.depth * 0.95],
          [cx, elev + 1.2, cz],
          44
        );
      } else if (level === 'asset') {
        const a = scene.assets.find((x) => x.id === entityId);
        if (!a) return;
        const fl = scene.floors.find((f) => f.id === a.floorId);
        const rm = a.roomId ? scene.rooms.find((r) => r.id === a.roomId) : undefined;
        set({
          drillLevel: 'asset',
          activeBuildingId: fl?.buildingId ?? activeBuildingId,
          activeFloorId: a.floorId,
          activeDepartmentId: rm?.departmentId ?? null,
          activeRoomId: rm?.id ?? null,
          showAllFloors: false,
          selected: [{ type: 'asset', id: a.id }],
        });
        const elev = fl?.elevation ?? 0;
        get().flyToCamera([a.x + 4.4, elev + Math.max(3.4, a.height + 1.8), a.z + 4.4], [a.x, elev + a.height / 2, a.z], 42);
      }
    },

    undo: () => {
      const { past, scene, future } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        scene: previous,
        past: past.slice(0, -1),
        future: [scene, ...future.slice(0, 49)],
        validationIssues: runSpatialValidation(previous),
        toast: { id: `t-${Date.now()}`, message: 'Undid last action', tone: 'info' },
      });
    },

    redo: () => {
      const { past, scene, future } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        scene: next,
        past: [...past, scene],
        future: future.slice(1),
        validationIssues: runSpatialValidation(next),
        toast: { id: `t-${Date.now()}`, message: 'Redid action', tone: 'info' },
      });
    },

    setViewMode: (viewMode) => set({ viewMode, firstPersonMode: false }),
    setOrthoPreset: (orthoPreset) => set({ orthoPreset, viewMode: '3d-ortho', firstPersonMode: false }),
    setActiveTool: (activeTool) =>
      set({
        activeTool,
        measurePoints: activeTool === 'measure' ? [] : get().measurePoints,
      }),
    setTransformMode: (transformMode) => set({ transformMode }),
    setSelectedSpaceTypeId: (selectedSpaceTypeId) => set({ selectedSpaceTypeId }),
    setSelectedObjectTemplateId: (selectedObjectTemplateId) => set({ selectedObjectTemplateId }),
    setSelectedWallPresetId: (selectedWallPresetId) => set({ selectedWallPresetId }),
    setSelectedOpeningSubtype: (selectedOpeningSubtype) => set({ selectedOpeningSubtype }),
    setSelectedMaterialId: (selectedMaterialId) => set({ selectedMaterialId }),
    setSelectedFlowType: (selectedFlowType) => set({ selectedFlowType }),
    setSectionCut: (sectionCutEnabled, height, axis, flipped) =>
      set((s) => {
        const nextAxis = axis ?? s.sectionCutAxis;
        const nextHeight = height !== undefined ? height : s.sectionCutHeight;
        const nextFlipped = flipped !== undefined ? flipped : s.sectionCutFlipped;
        const nextAudit = appendAudit(s.auditLog, s.scene.id, {
          category: 'settings',
          action: sectionCutEnabled ? 'Updated Section Cut' : 'Disabled Section Cut',
          summary: sectionCutEnabled
            ? `Section cut ${nextAxis.toUpperCase()} = ${nextHeight.toFixed(1)}m (${nextFlipped ? 'inverted' : 'standard'})`
            : 'Turned off 3D section clipping',
        });
        return {
          sectionCutEnabled,
          sectionCutHeight: nextHeight,
          sectionCutAxis: nextAxis,
          sectionCutFlipped: nextFlipped,
          auditLog: nextAudit,
        };
      }),
    resetSectionCut: () =>
      set((s) => {
        const activeFloor = s.scene.floors.find((f) => f.id === s.activeFloorId);
        const defaultHeight = activeFloor ? Number((activeFloor.height * 0.6).toFixed(1)) : 2.4;
        const nextAudit = appendAudit(s.auditLog, s.scene.id, {
          category: 'settings',
          action: 'Reset Section Cut',
          summary: 'Reset section cut plane to default elevation and disabled clipping',
        });
        return {
          sectionCutEnabled: false,
          sectionCutAxis: 'y',
          sectionCutHeight: defaultHeight,
          sectionCutFlipped: false,
          auditLog: nextAudit,
        };
      }),
    setExplodedFactor: (explodedFactor) =>
      set({ explodedFactor, showAllFloors: explodedFactor > 0.01 ? true : get().showAllFloors }),
    setFirstPersonMode: (firstPersonMode) =>
      set((s) => ({
        firstPersonMode,
        firstPersonTabletVisible: firstPersonMode ? true : s.firstPersonTabletVisible,
        viewMode: firstPersonMode ? '3d-perspective' : s.viewMode,
      })),
    setFirstPersonTabletVisible: (firstPersonTabletVisible) => set({ firstPersonTabletVisible }),
    setShowNavMesh: (showNavMesh) => set({ showNavMesh }),
    setLightingMode: (lightingMode) =>
      set((s) => ({
        lightingMode,
        auditLog: appendAudit(s.auditLog, s.scene.id, {
          category: 'settings',
          action: `Switched 3D Lighting to ${lightingMode === 'night' ? 'Night Mode' : 'Daylight Mode'}`,
          summary: `Viewport illumination set to ${lightingMode} lighting rig`,
        }),
      })),
    toggleLightingMode: () => {
      const next = get().lightingMode === 'day' ? 'night' : 'day';
      get().setLightingMode(next);
    },
    updateSplitLayout: (patch) =>
      set((s) => ({
        splitLayout: { ...s.splitLayout, ...patch },
      })),
    setAnimateFlows: (animateFlows) => set({ animateFlows }),
    setShowFlowLegend: (showFlowLegend) => set({ showFlowLegend }),
    setEditingFlowId: (editingFlowId) => set({ editingFlowId }),
    setUnitSystem: (unitSystem) =>
      commit(
        (draft) => {
          draft.unitSystem = unitSystem;
          return draft;
        },
        `Switched units to ${unitSystem === 'metric' ? 'Metric (m)' : 'Imperial (ft)'}`,
        {
          category: 'settings',
          action: 'Changed Unit System',
          summary: `Switched project measurement units to ${unitSystem}`,
        }
      ),
    updateSnap: (patch) =>
      set((s) => ({
        snap: { ...s.snap, ...patch },
        auditLog: appendAudit(s.auditLog, s.scene.id, {
          category: 'settings',
          action: 'Updated Grid/Snap Settings',
          summary: `Modified snap settings: ${Object.keys(patch).join(', ')}`,
          after: patch as Record<string, unknown>,
        }),
      })),

    setLeftTab: (leftTab) => set({ leftTab, leftPanelOpen: true }),
    setRightTab: (rightTab) => set({ rightTab, rightPanelOpen: true }),
    setLeftPanelOpen: (leftPanelOpen) => set({ leftPanelOpen }),
    setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
    setBottomTimelineOpen: (bottomTimelineOpen) => set({ bottomTimelineOpen }),
    toggleMaximizeCanvas: () =>
      set((s) => {
        const next = !s.canvasMaximized;
        return {
          canvasMaximized: next,
          leftPanelOpen: !next,
          rightPanelOpen: !next,
        };
      }),
    setShowExportModal: (showExportModal) => set({ showExportModal }),
    setShowXRModal: (showXRModal) => set({ showXRModal }),
    setShowOnboarding: (showOnboarding) => set({ showOnboarding }),
    setShowAIPlannerModal: (showAIPlannerModal) => set({ showAIPlannerModal }),
    setShowModelsGallery: (showModelsGallery) => set({ showModelsGallery }),
    setShowQuickSearch: (showQuickSearch) => set({ showQuickSearch }),
    setShowMayaChat: (showMayaChat) => set({ showMayaChat }),
    setShowCameraManager: (showCameraManager) => set({ showCameraManager }),
    openLiveCamera: (activeLiveCameraId) =>
      set({
        activeLiveCameraId,
        showCameraManager: activeLiveCameraId ? true : get().showCameraManager,
      }),
    openRackDesigner: (assetId) => {
      const { scene } = get();
      const target =
        (assetId ? scene.assets.find((a) => a.id === assetId) : null) ??
        scene.assets.find(
          (a) =>
            a.category === 'IT & Data Center' ||
            a.rackConfig ||
            ['server-rack', 'network-rack', 'patch-cabinet', 'pdu-cabinet', 'ups-tower'].includes(a.archetype)
        );
      set({
        showNetworkRackModal: true,
        activeRackAssetId: target?.id ?? null,
      });
    },
    closeRackDesigner: () => set({ showNetworkRackModal: false }),
    setShowSaveValidationModal: (showSaveValidationModal) => {
      if (showSaveValidationModal) get().refreshValidation();
      set({ showSaveValidationModal });
    },
    setAutoSaveEnabled: (autoSaveEnabled) => {
      try {
        localStorage.setItem('gradian_autosave_v1', String(autoSaveEnabled));
      } catch {
        // ignore storage errors
      }
      set({ autoSaveEnabled, autoSaveSecondsLeft: 60 });
      get().recordAudit({
        category: 'settings',
        action: autoSaveEnabled ? 'Enabled Auto-save (60s Inactivity)' : 'Disabled Auto-save',
        entityType: 'project',
        entityId: get().scene.id,
        entityName: get().scene.name,
        summary: autoSaveEnabled
          ? 'Auto-save will automatically launch Save & Validation after 60 seconds of inactivity.'
          : 'Auto-save inactivity timer turned off.',
      });
      get().showToast(
        autoSaveEnabled
          ? 'Auto-save enabled: Save & Validation triggers after 60s of inactivity'
          : 'Auto-save disabled',
        'info'
      );
    },
    setAutoSaveSecondsLeft: (autoSaveSecondsLeft) => set({ autoSaveSecondsLeft }),
    setShowAuditTrailModal: (showAuditTrailModal) => set({ showAuditTrailModal }),
    recordAudit: (entry) =>
      set((s) => ({
        auditLog: appendAudit(s.auditLog, s.scene.id, entry),
      })),
    clearAuditLog: () =>
      set((s) => {
        saveLocalAudit(s.scene.id, []);
        return { auditLog: [] };
      }),
    applyValidationAutoFixes: (fixes) => {
      if (!fixes || fixes.length === 0) return 0;
      let fixedCount = 0;
      commit(
        (draft) => {
          const gradeMinPa: Record<string, number> = {
            'Grade A / ISO 5': 40,
            'Grade B / ISO 6': 30,
            'Grade C / ISO 7': 15,
            'Grade D / ISO 8': 5,
          };
          for (const fix of fixes) {
            if (fix.action === 'reposition_asset' && fix.entityId) {
              const a = draft.assets.find((x) => x.id === fix.entityId);
              if (a) {
                const rm = draft.rooms.find((r) => r.id === a.roomId);
                const fl = draft.floors.find((f) => f.id === a.floorId);
                a.x = Number((a.x + 1.25).toFixed(2));
                if (rm) {
                  a.x = Math.min(rm.x + rm.width - a.width / 2 - 0.35, Math.max(rm.x + a.width / 2 + 0.35, a.x));
                  a.z = Math.min(rm.z + rm.depth - a.depth / 2 - 0.35, Math.max(rm.z + a.depth / 2 + 0.35, a.z));
                } else if (fl) {
                  a.x = Math.min(fl.width - a.width / 2 - 0.5, Math.max(a.width / 2 + 0.5, a.x));
                }
                fixedCount++;
              }
            } else if (fix.action === 'clamp_asset_in_room' && fix.entityId) {
              const a = draft.assets.find((x) => x.id === fix.entityId);
              if (a) {
                const fl = draft.floors.find((f) => f.id === a.floorId);
                const rm =
                  draft.rooms.find((r) => r.id === a.roomId) ??
                  draft.rooms.find((r) => r.floorId === a.floorId);
                if (rm) {
                  a.roomId = rm.id;
                  a.x = Number(
                    Math.min(rm.x + rm.width - a.width / 2 - 0.4, Math.max(rm.x + a.width / 2 + 0.4, a.x)).toFixed(2)
                  );
                  a.z = Number(
                    Math.min(rm.z + rm.depth - a.depth / 2 - 0.4, Math.max(rm.z + a.depth / 2 + 0.4, a.z)).toFixed(2)
                  );
                  fixedCount++;
                } else if (fl) {
                  a.x = Number(Math.min(fl.width - a.width / 2 - 0.5, Math.max(a.width / 2 + 0.5, a.x)).toFixed(2));
                  a.z = Number(Math.min(fl.depth - a.depth / 2 - 0.5, Math.max(a.depth / 2 + 0.5, a.z)).toFixed(2));
                  fixedCount++;
                }
              }
            } else if (fix.action === 'deduplicate_asset_id' && fix.entityId) {
              const a = draft.assets.find((x) => x.id === fix.entityId);
              if (a) {
                a.assetId = `${a.assetId}-${Math.floor(10 + Math.random() * 89)}`;
                fixedCount++;
              }
            } else if (fix.action === 'add_room_door' && fix.entityId) {
              const rm = draft.rooms.find((r) => r.id === fix.entityId);
              const targetWall = draft.walls.find((w) => w.roomId === fix.entityId);
              if (rm && targetWall) {
                draft.openings.push({
                  id: `op-fix-${Date.now()}-${fixedCount}`,
                  floorId: rm.floorId,
                  wallId: targetWall.id,
                  kind: 'door',
                  subtype: 'cleanroom-door',
                  name: `${rm.code} Interlocked Access Door`,
                  offsetRatio: 0.5,
                  width: 1.3,
                  height: Math.min(2.2, targetWall.height - 0.2),
                  sillHeight: 0,
                  thickness: targetWall.thickness + 0.04,
                  swingDirection: 'right',
                  swingAngle: 90,
                  materialId: 'mat-cleanroom-panel',
                  frameColor: '#2563EB',
                  lockType: 'GMP Interlock',
                  accessControl: 'badge',
                  fireRating: '60 min',
                  status: 'closed',
                  layerId: 'layer-openings',
                });
                fixedCount++;
              }
            } else if (fix.action === 'fix_pressure_cascade' && fix.entityId) {
              const rm = draft.rooms.find((r) => r.id === fix.entityId);
              if (rm) {
                const reqPa = gradeMinPa[rm.environmental.cleanroomGrade];
                if (reqPa !== undefined) {
                  rm.environmental.pressurePa = reqPa;
                  fixedCount++;
                }
              }
            } else if (fix.action === 'reroute_dirty_flow' && fix.entityId) {
              const flw = draft.flows.find((f) => f.id === fix.entityId);
              if (flw && flw.points.length >= 2) {
                flw.points = flw.points.map((pt) => ({
                  x: Number(Math.max(1, pt.x - 1.5).toFixed(2)),
                  z: Number((pt.z + 2.5).toFixed(2)),
                }));
                fixedCount++;
              }
            } else if (fix.action === 'fix_camera_config' && fix.entityId) {
              const cam = draft.cameras.find((c) => c.id === fix.entityId);
              if (cam) {
                cam.fov = Math.max(25, Math.min(110, cam.fov || 68));
                if (!cam.ipAddress) cam.ipAddress = `10.42.20.${110 + fixedCount}`;
                if (!cam.port) cam.port = 554;
                if (!cam.protocol) cam.protocol = 'RTSP';
                if (!cam.streamPath) cam.streamPath = '/h265/ch01/main';
                fixedCount++;
              }
            } else if (fix.action === 'rebalance_rack' && fix.entityId) {
              const a = draft.assets.find((x) => x.id === fix.entityId);
              if (a && a.rackConfig) {
                let cursorU = a.rackConfig.totalUnits;
                for (const dev of a.rackConfig.devices) {
                  cursorU = Math.max(1, cursorU - dev.uHeight);
                  dev.uStart = cursorU + 1;
                }
                const totalKw = a.rackConfig.devices.reduce((s, d) => s + d.powerW, 0) / 1000;
                if (totalKw > a.rackConfig.maxPowerKw) {
                  a.rackConfig.maxPowerKw = Math.ceil(totalKw + 4);
                }
                fixedCount++;
              }
            }
          }
          return draft;
        },
        `Applied ${fixes.length} AI validation fix${fixes.length > 1 ? 'es' : ''}`,
        {
          category: 'validation-ai',
          action: 'Applied AI Validation Auto-Fixes',
          summary: `Automatically remediated ${fixes.length} validation findings prior to save`,
        }
      );
      return fixedCount;
    },
    completeOnboardingStep: (step) =>
      set((s) => ({
        completedOnboardingSteps: s.completedOnboardingSteps.includes(step)
          ? s.completedOnboardingSteps
          : [...s.completedOnboardingSteps, step],
      })),

    selectEntity: (entity, additive = false) => {
      if (!entity) {
        set({ selected: [] });
        return;
      }
      set((s) => {
        const shouldShowProperties = ['asset', 'wall', 'opening', 'room', 'flow', 'camera'].includes(entity.type);
        const inspectorPatch = shouldShowProperties
          ? { rightPanelOpen: true, rightTab: 'properties' as RightPanelTab }
          : {};
        if (!additive) return { selected: [entity], ...inspectorPatch };
        const exists = s.selected.some((e) => e.type === entity.type && e.id === entity.id);
        return {
          selected: exists
            ? s.selected.filter((e) => !(e.type === entity.type && e.id === entity.id))
            : [...s.selected, entity],
          ...inspectorPatch,
        };
      });
    },
    clearSelection: () => set({ selected: [] }),
    setIsolatedIds: (isolatedIds) => set({ isolatedIds }),

    isolateSameTypeOrgWide: (assetId) => {
      const { scene } = get();
      const target = scene.assets.find((a) => a.id === assetId);
      if (!target) return;
      const matches = scene.assets.filter(
        (a) => a.templateId === target.templateId || a.archetype === target.archetype
      );
      const floorIds = new Set(matches.map((m) => m.floorId));
      const buildingIds = new Set(
        matches
          .map((m) => scene.floors.find((f) => f.id === m.floorId)?.buildingId)
          .filter(Boolean) as string[]
      );
      const tpl = OBJECT_LIBRARY.find((o) => o.id === target.templateId);
      const label = tpl?.name ?? target.name;
      set({
        isolatedAssetType: {
          templateId: target.templateId,
          archetype: target.archetype,
          label,
          count: matches.length,
          buildingsCount: buildingIds.size,
          floorsCount: floorIds.size,
        },
        isolatedIds: matches.map((m) => m.id),
        drillLevel: buildingIds.size > 1 ? 'campus' : 'building',
        showAllFloors: true,
        viewMode: get().viewMode === '2d' ? '3d-perspective' : get().viewMode,
        selected: matches.map((m) => ({ type: 'asset' as const, id: m.id })),
        toast: {
          id: `t-${Date.now()}`,
          message: `Isolated ${matches.length} × ${label} across ${buildingIds.size} building${buildingIds.size !== 1 ? 's' : ''} (${floorIds.size} floor${floorIds.size !== 1 ? 's' : ''})`,
          tone: 'info',
        },
      });
      const maxX = Math.max(40, ...scene.buildings.map((b) => b.originX + b.width));
      get().flyToCamera([maxX * 0.55, 36, 48], [maxX * 0.4, 2.5, 12], 46);
    },

    isolateLayerDirect: (layerId) => {
      const { scene } = get();
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      commit((draft) => {
        draft.layers.forEach((l) => {
          l.visible = l.id === layerId || l.id === 'layer-architecture';
        });
        return draft;
      }, `Focused layer "${layer.name}"`);
      set({ activeLayerFocusId: layerId });
    },

    clearIsolation: () =>
      set({
        isolatedIds: [],
        isolatedAssetType: null,
        activeLayerFocusId: null,
        showAllFloors: false,
        drillLevel: 'floor',
      }),

    buildDirectUrl: (overrides = {}) => {
      const state = get();
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('project', state.scene.id);
      url.searchParams.set('view', state.viewMode);
      url.searchParams.set('drill', overrides.drillLevel ?? state.drillLevel);
      const bId = overrides.buildingId ?? state.activeBuildingId;
      const fId = overrides.floorId ?? state.activeFloorId;
      if (bId) url.searchParams.set('building', bId);
      if (fId) url.searchParams.set('floor', fId);
      if (overrides.roomId ?? state.activeRoomId) {
        url.searchParams.set('room', (overrides.roomId ?? state.activeRoomId)!);
      }
      if (overrides.assetId) url.searchParams.set('asset', overrides.assetId);
      if (overrides.layerId ?? state.activeLayerFocusId) {
        url.searchParams.set('layer', (overrides.layerId ?? state.activeLayerFocusId)!);
      }
      if (overrides.isolateType ?? state.isolatedAssetType?.templateId) {
        url.searchParams.set(
          'isolateType',
          (overrides.isolateType ?? state.isolatedAssetType?.templateId)!
        );
      }
      return url.toString();
    },

    applyUrlDeepLink: () => {
      const params = new URLSearchParams(window.location.search);
      const projectId = params.get('project');
      const layerId = params.get('layer');
      const buildingId = params.get('building');
      const floorId = params.get('floor');
      const roomId = params.get('room');
      const assetId = params.get('asset');
      const isolateType = params.get('isolateType');
      const drill = params.get('drill') as DrillLevel | null;
      const view = params.get('view') as ViewMode | null;

      if (!projectId && !layerId && !buildingId && !floorId && !roomId && !assetId && !isolateType) {
        return;
      }

      const { savedProjects, openProject, openCinnaGenDemo } = get();
      if (projectId) {
        const found = savedProjects.find((p) => p.id === projectId);
        if (found) openProject(found);
        else openCinnaGenDemo();
      } else {
        set({ screen: 'workspace' });
      }

      if (view && ['2d', '3d-perspective', '3d-ortho', 'split'].includes(view)) {
        set({ viewMode: view });
      }

      const st = get();
      if (buildingId && st.scene.buildings.some((b) => b.id === buildingId)) {
        set({ activeBuildingId: buildingId });
      }
      if (floorId && st.scene.floors.some((f) => f.id === floorId)) {
        set({ activeFloorId: floorId });
      }
      if (layerId && st.scene.layers.some((l) => l.id === layerId)) {
        st.isolateLayerDirect(layerId);
      }
      if (isolateType) {
        const sample = st.scene.assets.find(
          (a) => a.templateId === isolateType || a.archetype === isolateType
        );
        if (sample) st.isolateSameTypeOrgWide(sample.id);
      } else if (assetId && st.scene.assets.some((a) => a.id === assetId)) {
        st.drillInto('asset', assetId);
      } else if (roomId && st.scene.rooms.some((r) => r.id === roomId)) {
        st.drillInto('room', roomId);
      } else if (drill && ['campus', 'building', 'floor'].includes(drill)) {
        st.drillInto(drill, drill === 'building' ? buildingId ?? undefined : floorId ?? undefined);
      }
    },

    applyAIGeneratedFloorPlan: (plan, parentTarget) => {
      const now = Date.now();
      let finalBuildingId = parentTarget.buildingId ?? get().activeBuildingId;
      let finalFloorId = parentTarget.floorId ?? get().activeFloorId;

      commit((draft) => {
        if (parentTarget.mode === 'new-building') {
          const bId = `bldg-ai-${now}`;
          const fId = `fl-ai-${now}`;
          const offsetX = draft.buildings.length * 42;
          const bName = parentTarget.newBuildingName?.trim() || `${plan.planName} Building`;
          const newBldg: Building = {
            id: bId,
            siteId: draft.hierarchy.find((h) => h.level === 'site')?.id ?? 'site-1',
            name: bName,
            code: `BLDG-AI-${draft.buildings.length + 1}`,
            description: plan.summary,
            width: plan.footprintWidth,
            depth: plan.footprintDepth,
            originX: offsetX,
            originZ: 0,
            color: '#10B981',
            metadata: {
              code: `BLDG-AI-${draft.buildings.length + 1}`,
              description: plan.summary,
              status: 'planned',
              tags: ['AI Generated', 'Playground'],
              owner: 'AI Floor Planner',
              department: 'Facility Engineering',
              accessPermission: 'gmp-authorized',
              createdAt: new Date().toISOString().slice(0, 10),
              updatedAt: new Date().toISOString().slice(0, 10),
              revision: 1,
              customProperties: {},
              linkedDocuments: [],
              relatedSystems: [],
              relatedProcesses: [],
            },
          };
          draft.buildings.push(newBldg);
          draft.floors.push({
            id: fId,
            buildingId: bId,
            sectionName: 'AI Generated Wing',
            name: parentTarget.newFloorName?.trim() || `${plan.planName} · Ground`,
            code: `AI-L0`,
            levelIndex: 0,
            elevation: 0,
            height: plan.ceilingHeight,
            slabThickness: 0.35,
            width: plan.footprintWidth,
            depth: plan.footprintDepth,
            slabMaterialId: 'mat-epoxy-gray',
            metadata: newBldg.metadata,
          });
          finalBuildingId = bId;
          finalFloorId = fId;
        } else if (parentTarget.mode === 'new-floor') {
          const bldgId = parentTarget.buildingId ?? draft.buildings[0]?.id ?? finalBuildingId;
          const bldgFloors = draft.floors.filter((f) => f.buildingId === bldgId);
          const topFl = bldgFloors.reduce<Floor | null>(
            (acc, f) => (!acc || f.elevation > acc.elevation ? f : acc),
            null
          );
          const fId = `fl-ai-${now}`;
          draft.floors.push({
            id: fId,
            buildingId: bldgId,
            sectionName: 'AI Generated Level',
            name: parentTarget.newFloorName?.trim() || plan.planName,
            code: `L${bldgFloors.length}`,
            levelIndex: bldgFloors.length,
            elevation: topFl ? topFl.elevation + topFl.height + topFl.slabThickness : 0,
            height: plan.ceilingHeight,
            slabThickness: 0.3,
            width: plan.footprintWidth,
            depth: plan.footprintDepth,
            slabMaterialId: 'mat-epoxy-gray',
            metadata: {
              code: `L${bldgFloors.length}`,
              description: plan.summary,
              status: 'planned',
              tags: ['AI Generated'],
              owner: 'AI Floor Planner',
              department: 'Facility Engineering',
              accessPermission: 'gmp-authorized',
              createdAt: new Date().toISOString().slice(0, 10),
              updatedAt: new Date().toISOString().slice(0, 10),
              revision: 1,
              customProperties: {},
              linkedDocuments: [],
              relatedSystems: [],
              relatedProcesses: [],
            },
          });
          finalBuildingId = bldgId;
          finalFloorId = fId;
        } else {
          // replace-floor
          const targetFl = draft.floors.find((f) => f.id === finalFloorId);
          if (targetFl) {
            targetFl.width = plan.footprintWidth;
            targetFl.depth = plan.footprintDepth;
            targetFl.height = plan.ceilingHeight;
            finalBuildingId = targetFl.buildingId;
          }
          draft.rooms = draft.rooms.filter((r) => r.floorId !== finalFloorId);
          draft.walls = draft.walls.filter((w) => w.floorId !== finalFloorId);
          draft.openings = draft.openings.filter((o) => o.floorId !== finalFloorId);
          draft.assets = draft.assets.filter((a) => a.floorId !== finalFloorId);
          draft.flows = draft.flows.filter((f) => f.floorId !== finalFloorId);
        }

        const deptId =
          parentTarget.departmentId ||
          draft.hierarchy.find((h) => h.level === 'department')?.id ||
          'dept-1';
        const roomCodeToId = new Map<string, string>();

        plan.rooms.forEach((rm, idx) => {
          const tpl =
            SPACE_TYPE_LIBRARY.find((s) => s.id === rm.spaceTypeId) ??
            SPACE_TYPE_LIBRARY.find((s) =>
              s.name.toLowerCase().includes(rm.name.toLowerCase().split(' ')[0])
            ) ??
            SPACE_TYPE_LIBRARY[0];
          const id = `rm-ai-${now}-${idx}`;
          roomCodeToId.set(rm.code, id);
          const roomObj: Room = {
            id,
            floorId: finalFloorId,
            departmentId: deptId,
            name: rm.name,
            code: rm.code || `AI-${idx + 1}`,
            spaceTypeId: tpl.id,
            category: tpl.category,
            x: Number(rm.x.toFixed(2)),
            z: Number(rm.z.toFixed(2)),
            width: Math.max(2, Number(rm.width.toFixed(2))),
            depth: Math.max(2, Number(rm.depth.toFixed(2))),
            height: rm.height ?? plan.ceilingHeight,
            color: rm.color || tpl.color,
            floorMaterialId: tpl.defaultFloorMaterialId,
            wallMaterialId: tpl.defaultWallMaterialId,
            ceilingMaterialId: tpl.defaultCeilingMaterialId,
            layerId: 'layer-architecture',
            environmental: {
              ...tpl.environmental,
              cleanroomGrade: (rm.cleanroomGrade as any) || tpl.environmental.cleanroomGrade,
              pressurePa: rm.pressurePa ?? tpl.environmental.pressurePa,
              airChangesPerHour: rm.airChangesPerHour ?? tpl.environmental.airChangesPerHour,
              temperatureC: rm.temperatureC ?? tpl.environmental.temperatureC,
            },
            occupancyMax: Math.max(2, Math.round((rm.width * rm.depth) / 14)),
            currentOccupancy: 2,
            utilizationPct: 72,
            riskLevel: 'medium',
            complianceStatus: 'compliant',
            energyKw: Number((rm.width * rm.depth * 0.24).toFixed(1)),
            costPerSqm: tpl.costPerSqm,
            activeFromDate: get().timelineDate,
            metadata: {
              code: rm.code || `AI-${idx + 1}`,
              description: `Generated by AI Floor Planner (${plan.planName})`,
              status: 'planned',
              tags: ['AI Planner', tpl.category],
              owner: 'AI Floor Planner',
              department: deptId,
              accessPermission: 'gmp-authorized',
              createdAt: new Date().toISOString().slice(0, 10),
              updatedAt: new Date().toISOString().slice(0, 10),
              revision: 1,
              customProperties: {},
              linkedDocuments: [],
              relatedSystems: ['HVAC'],
              relatedProcesses: [],
            },
          };
          draft.rooms.push(roomObj);
          const createdWalls = generateWallsForRoom(roomObj, id);
          draft.walls.push(...createdWalls);
          // Add an intelligent access door on the south wall of every generated room
          if (createdWalls[2]) {
            draft.openings.push({
              id: `op-ai-${now}-${idx}`,
              floorId: finalFloorId,
              wallId: createdWalls[2].id,
              kind: 'door',
              subtype: 'cleanroom-door',
              name: `${roomObj.code} Access Door`,
              offsetRatio: 0.5,
              width: 1.15,
              height: 2.2,
              sillHeight: 0,
              thickness: createdWalls[2].thickness + 0.04,
              swingDirection: 'right',
              swingAngle: 90,
              materialId: 'mat-cleanroom-panel',
              frameColor: '#10B981',
              lockType: 'GMP Interlock',
              accessControl: 'badge',
              fireRating: '60 min',
              status: 'closed',
              layerId: 'layer-openings',
            });
          }
        });

        plan.equipment.forEach((eq, idx) => {
          const tpl =
            OBJECT_LIBRARY.find((o) => o.id === eq.templateId) ??
            OBJECT_LIBRARY.find((o) =>
              o.name.toLowerCase().includes(eq.name.toLowerCase().split(' ')[0])
            ) ??
            OBJECT_LIBRARY[0];
          const seq = draft.assets.length + 1;
          const code = `${tpl.archetype.slice(0, 3).toUpperCase()}-${String(seq).padStart(3, '0')}`;
          const roomId = eq.roomCode ? roomCodeToId.get(eq.roomCode) : undefined;
          draft.assets.push({
            id: `ast-ai-${now}-${idx}`,
            floorId: finalFloorId,
            roomId,
            templateId: tpl.id,
            archetype: tpl.archetype,
            name: eq.name || tpl.name,
            assetId: code,
            equipmentId: `EQ-${code}`,
            category: tpl.category,
            manufacturer: tpl.manufacturer,
            model: tpl.model,
            serialNumber: `SN-AI-${seq}`,
            description: tpl.description,
            tags: ['AI Planner', tpl.category],
            criticality: tpl.category === 'Biopharmaceutical' ? 'gmp-critical' : 'medium',
            owner: 'Facility Engineering',
            department: deptId,
            responsiblePerson: 'Assigned Engineer',
            x: Number(eq.x.toFixed(2)),
            y: 0,
            z: Number(eq.z.toFixed(2)),
            rotationX: 0,
            rotationY: ((eq.rotationDeg ?? 0) * Math.PI) / 180,
            rotationZ: 0,
            width: tpl.width,
            depth: tpl.depth,
            height: tpl.height,
            weightKg: tpl.weightKg,
            clearanceM: tpl.clearanceM,
            materialId: tpl.defaultMaterialId,
            color: tpl.defaultColor,
            layerId: 'layer-equipment',
            operationalStatus: 'planned',
            installationDate: get().timelineDate,
            commissioningDate: get().timelineDate,
            warrantyUntil: '2030-01-01',
            maintenanceSchedule: 'Semi-Annual Calibration',
            lastMaintenance: get().timelineDate,
            nextMaintenance: '2027-06-01',
            capacityLabel: 'Nominal 100%',
            utilizationPct: 76,
            availabilityPct: 99.4,
            conditionScore: 100,
            lifecycle: 'planned',
            capexUsd: tpl.capexUsd,
            annualOpexUsd: tpl.annualOpexUsd,
            energyKw: tpl.energyKw,
            connectivity: {
              protocol: 'OPC UA',
              endpoint: `opc.tcp://scada.local:4840/${code}`,
              plcTag: `PLC.${code}`,
              scadaNode: `SCADA-${code}`,
              historianId: `HIST_${code}`,
              liveMetrics: [{ label: 'Power', value: String(tpl.energyKw), unit: 'kW', status: 'ok' }],
            },
            documents: [],
            qrCode: `GRADIAN://ASSET/${code}`,
            relatedSystems: ['SCADA', 'MES'],
            relatedProcesses: [],
          });
        });

        plan.flows.forEach((flw, idx) => {
          if (!Array.isArray(flw.points) || flw.points.length < 2) return;
          const fType = (['personnel', 'material', 'product', 'waste', 'utility', 'airflow', 'evacuation'].includes(flw.flowType)
            ? flw.flowType
            : 'personnel') as FlowType;
          draft.flows.push({
            id: `flw-ai-${now}-${idx}`,
            floorId: finalFloorId,
            name: flw.name || `AI Route ${idx + 1}`,
            flowType: fType,
            points: flw.points.map((p) => ({ x: Number(p.x.toFixed(2)), z: Number(p.z.toFixed(2)) })),
            color:
              fType === 'waste'
                ? '#EF4444'
                : fType === 'material'
                  ? '#3B82F6'
                  : fType === 'product'
                    ? '#8B5CF6'
                    : '#10B981',
            flowRateLabel: 'AI Optimized',
            capacityLabel: 'GMP Segregated',
            cleanlinessClass: flw.cleanlinessClass === 'dirty' ? 'dirty' : 'clean',
            restrictions: 'Generated via AI Floor Plan Optimizer',
            layerId: 'layer-flows',
          });
        });

        return draft;
      }, `Saved AI Floor Plan "${plan.planName}" into hierarchy`);

      set({
        activeBuildingId: finalBuildingId,
        activeFloorId: finalFloorId,
        drillLevel: 'floor',
        showAllFloors: false,
        showAIPlannerModal: false,
        screen: 'workspace',
      });
      get().drillInto('floor', finalFloorId);
    },

    setCursorCoords: (cursorCoords) => set({ cursorCoords }),
    addMeasurePoint: (pt) =>
      set((s) => ({
        measurePoints: s.measurePoints.length >= 2 ? [pt] : [...s.measurePoints, pt],
      })),
    clearMeasure: () => set({ measurePoints: [] }),

    addFloor: ({ buildingId, name, height, width, depth, duplicateFromFloorId }) => {
      const newId = `fl-${Date.now()}`;
      commit((draft) => {
        const bldgFloors = draft.floors.filter((f) => f.buildingId === buildingId);
        const topFloor = bldgFloors.reduce<Floor | null>(
          (acc, f) => (!acc || f.elevation > acc.elevation ? f : acc),
          null
        );
        const elevation = topFloor ? topFloor.elevation + topFloor.height + topFloor.slabThickness : 0;
        const levelIndex = bldgFloors.length;
        const newFloor: Floor = {
          id: newId,
          buildingId,
          sectionName: 'Standard Wing',
          name,
          code: `L${levelIndex}`,
          levelIndex,
          elevation,
          height,
          slabThickness: 0.3,
          width,
          depth,
          slabMaterialId: 'mat-epoxy-gray',
          metadata: {
            code: `L${levelIndex}`,
            description: `${name} created in Digital Twin Studio`,
            status: 'planned',
            tags: ['Floor'],
            owner: 'Facility Architect',
            department: 'Facilities',
            accessPermission: 'restricted',
            createdAt: new Date().toISOString().slice(0, 10),
            updatedAt: new Date().toISOString().slice(0, 10),
            revision: 1,
            customProperties: {},
            linkedDocuments: [],
            relatedSystems: [],
            relatedProcesses: [],
          },
        };
        draft.floors.push(newFloor);

        if (duplicateFromFloorId) {
          const roomMap = new Map<string, string>();
          draft.rooms
            .filter((r) => r.floorId === duplicateFromFloorId)
            .forEach((r) => {
              const nrId = `${r.id}-dup-${Date.now().toString().slice(-4)}`;
              roomMap.set(r.id, nrId);
              draft.rooms.push({ ...structuredClone(r), id: nrId, floorId: newId });
            });
          draft.walls
            .filter((w) => w.floorId === duplicateFromFloorId)
            .forEach((w, idx) => {
              draft.walls.push({
                ...structuredClone(w),
                id: `${newId}-w-${idx}`,
                floorId: newId,
                roomId: w.roomId ? roomMap.get(w.roomId) : undefined,
              });
            });
        }
        return draft;
      }, `Created floor "${name}"`);
      set({ activeFloorId: newId, activeBuildingId: buildingId });
    },

    addBuilding: (name) => {
      const bId = `bldg-${Date.now()}`;
      const fId = `fl-${Date.now() + 1}`;
      commit((draft) => {
        const offsetX = draft.buildings.length * 40;
        const newBldg: Building = {
          id: bId,
          siteId: draft.hierarchy.find((h) => h.level === 'site')?.id ?? 'site-1',
          name,
          code: `BLDG-${draft.buildings.length + 1}`,
          description: 'New campus building structure',
          width: 30,
          depth: 20,
          originX: offsetX,
          originZ: 0,
          color: '#0284C7',
          metadata: {
            code: `BLDG-${draft.buildings.length + 1}`,
            description: 'Campus building',
            status: 'planned',
            tags: ['Building'],
            owner: 'Campus Architect',
            department: 'Engineering',
            accessPermission: 'restricted',
            createdAt: new Date().toISOString().slice(0, 10),
            updatedAt: new Date().toISOString().slice(0, 10),
            revision: 1,
            customProperties: {},
            linkedDocuments: [],
            relatedSystems: [],
            relatedProcesses: [],
          },
        };
        draft.buildings.push(newBldg);
        draft.floors.push({
          id: fId,
          buildingId: bId,
          sectionName: 'Main Block',
          name: `${name} · Ground Floor`,
          code: `B${draft.buildings.length}-L0`,
          levelIndex: 0,
          elevation: 0,
          height: 4.0,
          slabThickness: 0.35,
          width: 30,
          depth: 20,
          slabMaterialId: 'mat-concrete-sealed',
          metadata: newBldg.metadata,
        });
        return draft;
      }, `Added building "${name}"`);
      set({ activeBuildingId: bId, activeFloorId: fId });
    },

    renameHierarchyEntity: (type, id, name) => {
      commit((draft) => {
        if (type === 'building') {
          const b = draft.buildings.find((x) => x.id === id);
          if (b) b.name = name;
        } else if (type === 'floor') {
          const f = draft.floors.find((x) => x.id === id);
          if (f) f.name = name;
        } else if (type === 'room') {
          const r = draft.rooms.find((x) => x.id === id);
          if (r) r.name = name;
        } else if (type === 'asset') {
          const a = draft.assets.find((x) => x.id === id);
          if (a) a.name = name;
        } else if (type === 'hierarchy') {
          const h = draft.hierarchy.find((x) => x.id === id);
          if (h) h.name = name;
        }
        return draft;
      }, `Renamed to "${name}"`);
    },

    deleteSelected: () => {
      const sel = get().selected;
      if (sel.length === 0) return;
      commit((draft) => {
        for (const item of sel) {
          if (item.type === 'asset') {
            draft.assets = draft.assets.filter((a) => a.id !== item.id);
          } else if (item.type === 'room') {
            draft.rooms = draft.rooms.filter((r) => r.id !== item.id);
            draft.walls = draft.walls.filter((w) => w.roomId !== item.id);
          } else if (item.type === 'wall') {
            draft.walls = draft.walls.filter((w) => w.id !== item.id);
            draft.openings = draft.openings.filter((o) => o.wallId !== item.id);
          } else if (item.type === 'opening') {
            draft.openings = draft.openings.filter((o) => o.id !== item.id);
          } else if (item.type === 'camera') {
            draft.cameras = draft.cameras.filter((c) => c.id !== item.id);
          } else if (item.type === 'flow') {
            draft.flows = draft.flows.filter((f) => f.id !== item.id);
          } else if (item.type === 'reference') {
            draft.references = draft.references.filter((r) => r.id !== item.id);
          }
        }
        return draft;
      }, `Deleted ${sel.length} selected item${sel.length > 1 ? 's' : ''}`);
      set({ selected: [] });
    },

    duplicateSelected: () => {
      const sel = get().selected;
      if (sel.length === 0) return;
      const newSelection: SelectedEntity[] = [];
      commit((draft) => {
        for (const item of sel) {
          if (item.type === 'asset') {
            const orig = draft.assets.find((a) => a.id === item.id);
            if (orig) {
              const dupId = `ast-${Date.now()}-${Math.floor(Math.random() * 999)}`;
              const dup: SpatialAsset = {
                ...structuredClone(orig),
                id: dupId,
                assetId: `${orig.assetId}-COPY`,
                x: Number((orig.x + 1.5).toFixed(2)),
                z: Number((orig.z + 1.0).toFixed(2)),
              };
              draft.assets.push(dup);
              newSelection.push({ type: 'asset', id: dupId });
            }
          } else if (item.type === 'room') {
            const orig = draft.rooms.find((r) => r.id === item.id);
            if (orig) {
              const dupId = `rm-${Date.now()}`;
              const dup: Room = {
                ...structuredClone(orig),
                id: dupId,
                name: `${orig.name} (Copy)`,
                code: `${orig.code}-B`,
                x: Number((orig.x + orig.width + 0.5).toFixed(2)),
              };
              draft.rooms.push(dup);
              draft.walls.push(...generateWallsForRoom(dup, dupId));
              newSelection.push({ type: 'room', id: dupId });
            }
          }
        }
        return draft;
      }, 'Duplicated selection');
      if (newSelection.length > 0) set({ selected: newSelection });
    },

    addRoom: (x, z, width, depth, spaceTypeId, customName) => {
      const { activeFloorId, selectedSpaceTypeId, scene } = get();
      const allSpaceTypes = [...SPACE_TYPE_LIBRARY, ...scene.customSpaceTypes];
      const tpl =
        allSpaceTypes.find((s) => s.id === (spaceTypeId ?? selectedSpaceTypeId)) ??
        allSpaceTypes[0];
      const id = `rm-${Date.now()}`;
      const roomCount = scene.rooms.filter((r) => r.floorId === activeFloorId).length + 1;
      const code = `RM-${String(roomCount).padStart(3, '0')}`;

      const newRoom: Room = {
        id,
        floorId: activeFloorId,
        departmentId: scene.hierarchy.find((h) => h.level === 'department')?.id ?? 'dept-1',
        name: customName || `${tpl.name} ${roomCount}`,
        code,
        spaceTypeId: tpl.id,
        category: tpl.category,
        x: Number(x.toFixed(2)),
        z: Number(z.toFixed(2)),
        width: Math.max(2, Number(width.toFixed(2))),
        depth: Math.max(2, Number(depth.toFixed(2))),
        height: tpl.defaultHeight,
        color: tpl.color,
        floorMaterialId: tpl.defaultFloorMaterialId,
        wallMaterialId: tpl.defaultWallMaterialId,
        ceilingMaterialId: tpl.defaultCeilingMaterialId,
        layerId: 'layer-architecture',
        environmental: { ...tpl.environmental },
        occupancyMax: Math.max(2, Math.round((width * depth) / 14)),
        currentOccupancy: 2,
        utilizationPct: 65,
        riskLevel: tpl.environmental.cleanroomGrade.includes('Grade A') ? 'critical' : 'medium',
        complianceStatus: 'compliant',
        energyKw: Number((width * depth * 0.25).toFixed(1)),
        costPerSqm: tpl.costPerSqm,
        activeFromDate: get().timelineDate,
        metadata: {
          code,
          description: `${tpl.name} (${tpl.complianceStandard})`,
          status: 'operational',
          tags: [tpl.category, tpl.environmental.cleanroomGrade],
          owner: 'Facility Architect',
          department: 'Production',
          accessPermission: 'gmp-authorized',
          createdAt: new Date().toISOString().slice(0, 10),
          updatedAt: new Date().toISOString().slice(0, 10),
          revision: 1,
          customProperties: { Standard: tpl.complianceStandard },
          linkedDocuments: [],
          relatedSystems: ['HVAC'],
          relatedProcesses: [],
        },
      };

      commit((draft) => {
        draft.rooms.push(newRoom);
        draft.walls.push(...generateWallsForRoom(newRoom, id));
        return draft;
      }, `Created room "${newRoom.name}" (${newRoom.width}×${newRoom.depth} m)`);

      set({ selected: [{ type: 'room', id }] });
      get().completeOnboardingStep(4);
      return newRoom;
    },

    updateRoom: (id, patch) => {
      commit((draft) => {
        const rm = draft.rooms.find((r) => r.id === id);
        if (!rm) return draft;
        const geomChanged =
          patch.x !== undefined ||
          patch.z !== undefined ||
          patch.width !== undefined ||
          patch.depth !== undefined ||
          patch.height !== undefined;
        Object.assign(rm, patch);
        if (geomChanged) {
          // Update walls linked to this room
          const existingWalls = draft.walls.filter((w) => w.roomId === id);
          if (existingWalls.length === 4) {
            const x1 = rm.x, z1 = rm.z, x2 = rm.x + rm.width, z2 = rm.z + rm.depth;
            const coords: [number, number, number, number][] = [
              [x1, z1, x2, z1],
              [x2, z1, x2, z2],
              [x2, z2, x1, z2],
              [x1, z2, x1, z1],
            ];
            existingWalls.forEach((w, idx) => {
              [w.x1, w.z1, w.x2, w.z2] = coords[idx];
              w.height = rm.height;
              if (patch.wallMaterialId) w.materialId = patch.wallMaterialId;
            });
          }
        }
        return draft;
      });
    },

    addWall: (x1, z1, x2, z2, presetId) => {
      const { activeFloorId, selectedWallPresetId } = get();
      const preset =
        WALL_PRESETS.find((p) => p.id === (presetId ?? selectedWallPresetId)) ?? WALL_PRESETS[0];
      const wall: Wall = {
        id: `w-${Date.now()}`,
        floorId: activeFloorId,
        name: `${preset.name}`,
        x1: Number(x1.toFixed(2)),
        z1: Number(z1.toFixed(2)),
        x2: Number(x2.toFixed(2)),
        z2: Number(z2.toFixed(2)),
        height: preset.height,
        thickness: preset.thickness,
        elevation: 0,
        presetId: preset.id,
        isExterior: preset.isExterior,
        isStructural: preset.isStructural,
        fireRating: preset.fireRating,
        acousticRatingDb: preset.acousticRatingDb,
        materialId: preset.materialId,
        color: preset.color,
        opacity: preset.opacity,
        layerId: 'layer-walls',
        activeFromDate: get().timelineDate,
      };
      commit((draft) => {
        draft.walls.push(wall);
        return draft;
      }, `Added ${preset.name}`);
      set({ selected: [{ type: 'wall', id: wall.id }] });
      get().completeOnboardingStep(5);
      return wall;
    },

    updateWall: (id, patch) => {
      const prevWall = get().scene.walls.find((x) => x.id === id);
      commit(
        (draft) => {
          const w = draft.walls.find((x) => x.id === id);
          if (w) Object.assign(w, patch);
          return draft;
        },
        undefined,
        {
          category: 'wall-opening',
          action: 'Updated Wall',
          entityType: 'wall',
          entityId: id,
          entityName: prevWall?.name ?? id,
          summary: `Modified wall "${prevWall?.name ?? id}": ${Object.keys(patch).join(', ')}`,
          before: prevWall ? { height: prevWall.height, thickness: prevWall.thickness, presetId: prevWall.presetId } : null,
          after: patch as Record<string, unknown>,
        }
      );
    },

    splitWall: (id) => {
      commit((draft) => {
        const idx = draft.walls.findIndex((w) => w.id === id);
        if (idx === -1) return draft;
        const w = draft.walls[idx];
        const mx = Number(((w.x1 + w.x2) / 2).toFixed(2));
        const mz = Number(((w.z1 + w.z2) / 2).toFixed(2));
        const w1: Wall = { ...structuredClone(w), x2: mx, z2: mz, name: `${w.name} (A)` };
        const w2: Wall = {
          ...structuredClone(w),
          id: `${w.id}-split-${Date.now().toString().slice(-4)}`,
          x1: mx,
          z1: mz,
          name: `${w.name} (B)`,
        };
        draft.walls.splice(idx, 1, w1, w2);
        return draft;
      }, 'Split wall at midpoint');
    },

    addOpeningOnWall: (wallId, offsetRatio, subtype) => {
      const { scene, selectedOpeningSubtype } = get();
      const wall = scene.walls.find((w) => w.id === wallId);
      if (!wall) return null;
      const preset =
        OPENING_PRESETS.find((p) => p.subtype === (subtype ?? selectedOpeningSubtype)) ??
        OPENING_PRESETS[0];
      const clampedOffset = Math.max(0.15, Math.min(0.85, offsetRatio));
      const opening: Opening = {
        id: `op-${Date.now()}`,
        floorId: wall.floorId,
        wallId: wall.id,
        kind: preset.kind,
        subtype: preset.subtype,
        name: preset.name,
        offsetRatio: Number(clampedOffset.toFixed(3)),
        width: preset.width,
        height: Math.min(preset.height, wall.height - 0.15),
        sillHeight: preset.sillHeight,
        thickness: wall.thickness + 0.04,
        swingDirection: preset.swingDirection,
        swingAngle: preset.kind === 'door' ? 90 : 0,
        materialId: preset.kind === 'window' ? 'mat-glass-cleanroom' : 'mat-cleanroom-panel',
        frameColor: preset.frameColor,
        lockType: preset.accessControl === 'interlock' ? 'GMP Interlock' : 'Standard Latch',
        accessControl: preset.accessControl,
        fireRating: preset.fireRating,
        status: 'closed',
        layerId: 'layer-openings',
      };
      commit((draft) => {
        draft.openings.push(opening);
        return draft;
      }, `Placed ${preset.name}`);
      set({ selected: [{ type: 'opening', id: opening.id }] });
      return opening;
    },

    updateOpening: (id, patch) => {
      const prevOp = get().scene.openings.find((x) => x.id === id);
      commit(
        (draft) => {
          const op = draft.openings.find((x) => x.id === id);
          if (op) Object.assign(op, patch);
          return draft;
        },
        undefined,
        {
          category: 'wall-opening',
          action: `Updated ${prevOp?.kind === 'window' ? 'Window' : 'Door'}`,
          entityType: 'opening',
          entityId: id,
          entityName: prevOp?.name ?? id,
          summary: `Modified ${prevOp?.name ?? id}: ${Object.keys(patch).join(', ')}`,
          before: prevOp ? { width: prevOp.width, height: prevOp.height, status: prevOp.status } : null,
          after: patch as Record<string, unknown>,
        }
      );
    },

    addAsset: (templateId, rawX, rawZ, opts) => {
      const { activeFloorId, scene, snap } = get();
      const allObjs = [...OBJECT_LIBRARY, ...scene.customObjects];
      const tpl = allObjs.find((o) => o.id === templateId) ?? allObjs[0];
      const x = snapValue(rawX, snap.gridSize, snap.enabled && snap.snapToGrid);
      const z = snapValue(rawZ, snap.gridSize, snap.enabled && snap.snapToGrid);

      const hostRoom = scene.rooms.find(
        (r) =>
          r.floorId === activeFloorId &&
          x >= r.x &&
          x <= r.x + r.width &&
          z >= r.z &&
          z <= r.z + r.depth
      );

      const seq = scene.assets.length + 1;
      const code = `${tpl.archetype.slice(0, 3).toUpperCase()}-${String(seq).padStart(3, '0')}`;
      const id = `ast-${Date.now()}-${seq}`;
      const layerId =
        tpl.category === 'HVAC & Utilities'
          ? 'layer-utilities'
          : tpl.category === 'Warehouse & Logistics'
            ? 'layer-logistics'
            : tpl.category === 'Furniture & Workplace'
              ? 'layer-furniture'
              : tpl.category === 'Building & Safety'
                ? 'layer-safety'
                : 'layer-equipment';

      const newAsset: SpatialAsset = {
        id,
        floorId: activeFloorId,
        roomId: hostRoom?.id,
        templateId: tpl.id,
        archetype: tpl.archetype,
        name: opts?.name ?? tpl.name,
        assetId: opts?.assetId ?? code,
        equipmentId: `EQ-${code}`,
        category: tpl.category,
        manufacturer: tpl.manufacturer,
        model: tpl.model,
        serialNumber: `SN-2026-${seq}`,
        description: tpl.description,
        tags: [tpl.category, tpl.manufacturer],
        criticality: tpl.category === 'Biopharmaceutical' ? 'gmp-critical' : 'medium',
        owner: 'Facility Engineering',
        department: hostRoom?.departmentId ?? 'Production',
        responsiblePerson: 'Assigned Engineer',
        x,
        y: opts?.y ?? 0,
        z,
        rotationX: 0,
        rotationY: opts?.rotationY ?? 0,
        rotationZ: 0,
        width: opts?.width ?? tpl.width,
        depth: opts?.depth ?? tpl.depth,
        height: opts?.height ?? tpl.height,
        weightKg: tpl.weightKg,
        clearanceM: tpl.clearanceM,
        materialId: opts?.materialId ?? tpl.defaultMaterialId,
        color: opts?.color ?? tpl.defaultColor,
        layerId,
        operationalStatus: 'running',
        installationDate: get().timelineDate,
        commissioningDate: get().timelineDate,
        warrantyUntil: '2029-11-22',
        maintenanceSchedule: 'Semi-Annual Calibration',
        lastMaintenance: get().timelineDate,
        nextMaintenance: '2027-05-22',
        capacityLabel: 'Nominal 100%',
        utilizationPct: 75,
        availabilityPct: 99.1,
        conditionScore: 98,
        lifecycle: 'operational',
        capexUsd: tpl.capexUsd,
        annualOpexUsd: tpl.annualOpexUsd,
        energyKw: tpl.energyKw,
        connectivity: {
          protocol: 'OPC UA',
          endpoint: `opc.tcp://scada.local:4840/${code}`,
          plcTag: `PLC.${code.replace(/-/g, '_')}`,
          scadaNode: `SCADA-${code}`,
          historianId: `HIST_${code}`,
          liveMetrics: [
            { label: 'Power', value: String(tpl.energyKw), unit: 'kW', status: 'ok' },
            { label: 'State', value: 'Nominal', unit: '', status: 'ok' },
          ],
        },
        documents: [
          { id: `doc-${id}`, title: `${tpl.manufacturer} ${tpl.model} Manual`, kind: 'Manual', code: `MAN-${code}` },
        ],
        qrCode: `GRADIAN://ASSET/${code}`,
        relatedSystems: ['SCADA', 'MES'],
        relatedProcesses: [],
        ...opts,
      };

      commit((draft) => {
        draft.assets.push(newAsset);
        return draft;
      }, `Placed ${newAsset.name}`);
      set({ selected: [{ type: 'asset', id }] });
      get().completeOnboardingStep(6);
      return newAsset;
    },

    updateAsset: (id, patch, recordHistory = true) => {
      if (!recordHistory) {
        set((s) => {
          const next = structuredClone(s.scene);
          const a = next.assets.find((x) => x.id === id);
          if (a) Object.assign(a, patch);
          return { scene: next, validationIssues: runSpatialValidation(next) };
        });
        return;
      }
      const prevAsset = get().scene.assets.find((x) => x.id === id);
      const isRackChange = patch.rackConfig !== undefined;
      commit(
        (draft) => {
          const a = draft.assets.find((x) => x.id === id);
          if (a) {
            Object.assign(a, patch);
            // Re-assign host room if moved
            if (patch.x !== undefined || patch.z !== undefined) {
              const room = draft.rooms.find(
                (r) =>
                  r.floorId === a.floorId &&
                  a.x >= r.x &&
                  a.x <= r.x + r.width &&
                  a.z >= r.z &&
                  a.z <= r.z + r.depth
              );
              a.roomId = room?.id;
            }
          }
          return draft;
        },
        undefined,
        {
          category: isRackChange ? 'network-rack' : 'asset',
          action: isRackChange ? 'Updated Rack & Port Layout' : 'Updated Equipment Asset',
          entityType: 'asset',
          entityId: id,
          entityName: prevAsset?.name ?? id,
          summary: isRackChange
            ? `Updated IT/Network rack "${prevAsset?.name ?? id}" (${patch.rackConfig?.devices.length ?? 0} devices, ${patch.rackConfig?.cables.length ?? 0} cables)`
            : `Updated "${prevAsset?.name ?? id}": ${Object.keys(patch).join(', ')}`,
          before: prevAsset ? { x: prevAsset.x, z: prevAsset.z, rotationY: prevAsset.rotationY, status: prevAsset.operationalStatus } : null,
          after: isRackChange
            ? { devices: patch.rackConfig?.devices.length, cables: patch.rackConfig?.cables.length }
            : (patch as Record<string, unknown>),
        }
      );
    },

    alignSelectedAssets: (mode) => {
      const assetIds = get()
        .selected.filter((s) => s.type === 'asset')
        .map((s) => s.id);
      if (assetIds.length < 2) return;
      commit((draft) => {
        const list = draft.assets.filter((a) => assetIds.includes(a.id));
        if (list.length < 2) return draft;
        if (mode === 'left') {
          const minX = Math.min(...list.map((a) => a.x));
          list.forEach((a) => (a.x = minX));
        } else if (mode === 'right') {
          const maxX = Math.max(...list.map((a) => a.x));
          list.forEach((a) => (a.x = maxX));
        } else if (mode === 'top') {
          const minZ = Math.min(...list.map((a) => a.z));
          list.forEach((a) => (a.z = minZ));
        } else if (mode === 'bottom') {
          const maxZ = Math.max(...list.map((a) => a.z));
          list.forEach((a) => (a.z = maxZ));
        } else if (mode === 'center-x') {
          const avg = list.reduce((s, a) => s + a.x, 0) / list.length;
          list.forEach((a) => (a.x = Number(avg.toFixed(2))));
        } else if (mode === 'center-z') {
          const avg = list.reduce((s, a) => s + a.z, 0) / list.length;
          list.forEach((a) => (a.z = Number(avg.toFixed(2))));
        } else if (mode === 'distribute-x') {
          const sorted = [...list].sort((a, b) => a.x - b.x);
          const min = sorted[0].x;
          const max = sorted[sorted.length - 1].x;
          const step = (max - min) / (sorted.length - 1);
          sorted.forEach((a, i) => (a.x = Number((min + step * i).toFixed(2))));
        } else if (mode === 'distribute-z') {
          const sorted = [...list].sort((a, b) => a.z - b.z);
          const min = sorted[0].z;
          const max = sorted[sorted.length - 1].z;
          const step = (max - min) / (sorted.length - 1);
          sorted.forEach((a, i) => (a.z = Number((min + step * i).toFixed(2))));
        }
        return draft;
      }, `Aligned ${assetIds.length} objects (${mode})`);
    },

    paintSurfaceWithMaterial: (targetType, id, materialId) => {
      const allMats = [...DEFAULT_MATERIALS, ...get().scene.customMaterials];
      const mat = allMats.find((m) => m.id === materialId);
      if (!mat) return;
      commit((draft) => {
        if (targetType === 'room') {
          const rm = draft.rooms.find((r) => r.id === id);
          if (rm) rm.floorMaterialId = materialId;
        } else if (targetType === 'wall') {
          const w = draft.walls.find((x) => x.id === id);
          if (w) {
            w.materialId = materialId;
            w.color = mat.baseColor;
            w.opacity = mat.opacity;
          }
        } else if (targetType === 'asset') {
          const a = draft.assets.find((x) => x.id === id);
          if (a) {
            a.materialId = materialId;
            a.color = mat.baseColor;
          }
        }
        return draft;
      }, `Applied ${mat.name}`);
      get().completeOnboardingStep(7);
    },

    addCustomMaterial: (mat) =>
      commit((draft) => {
        draft.customMaterials = [mat, ...draft.customMaterials.filter((m) => m.id !== mat.id)];
        return draft;
      }, `Saved custom material "${mat.name}"`),

    addCustomSpaceType: (tpl) =>
      commit((draft) => {
        draft.customSpaceTypes = [tpl, ...draft.customSpaceTypes.filter((t) => t.id !== tpl.id)];
        return draft;
      }, `Saved space template "${tpl.name}"`),

    addCustomObjectTemplate: (obj) =>
      commit((draft) => {
        draft.customObjects = [obj, ...draft.customObjects.filter((o) => o.id !== obj.id)];
        return draft;
      }, `Saved custom object "${obj.name}"`),

    addCamera: (cam) => {
      const created: SceneCamera = { ...cam, id: `cam-${Date.now()}` };
      commit((draft) => {
        draft.cameras.push(created);
        return draft;
      }, `Added camera "${created.name}"`);
      set({ selected: [{ type: 'camera', id: created.id }] });
      get().completeOnboardingStep(8);
      return created;
    },

    updateCamera: (id, patch) => {
      const prevCam = get().scene.cameras.find((x) => x.id === id);
      const safePatchForAudit = { ...patch };
      if ('passwordHash' in safePatchForAudit) {
        safePatchForAudit.passwordHash = '[ARGON2ID_HASH_UPDATED]';
      }
      commit(
        (draft) => {
          const c = draft.cameras.find((x) => x.id === id);
          if (c) Object.assign(c, patch);
          return draft;
        },
        undefined,
        {
          category: 'camera',
          action: 'Updated Camera Configuration',
          entityType: 'camera',
          entityId: id,
          entityName: prevCam?.name ?? id,
          summary: `Modified camera "${prevCam?.name ?? id}": ${Object.keys(patch).join(', ')}`,
          before: prevCam ? { position: prevCam.position, target: prevCam.target, fov: prevCam.fov, ipAddress: prevCam.ipAddress } : null,
          after: safePatchForAudit as Record<string, unknown>,
        }
      );
    },

    deleteCamera: (id) =>
      commit((draft) => {
        draft.cameras = draft.cameras.filter((c) => c.id !== id);
        return draft;
      }, 'Deleted camera'),

    flyToCamera: (position, target, fov) =>
      set({
        cameraCommand: { id: Date.now(), position, target, fov },
      }),

    focusEntity: (entity) => {
      const { scene } = get();
      set({ selected: [entity] });
      if (entity.type === 'room') {
        const r = scene.rooms.find((x) => x.id === entity.id);
        if (r) {
          set({ activeFloorId: r.floorId });
          const cx = r.x + r.width / 2;
          const cz = r.z + r.depth / 2;
          get().flyToCamera([cx + r.width * 0.7, Math.max(8, r.width * 0.8), cz + r.depth * 1.1], [cx, 1.2, cz]);
        }
      } else if (entity.type === 'asset') {
        const a = scene.assets.find((x) => x.id === entity.id);
        if (a) {
          set({ activeFloorId: a.floorId });
          get().flyToCamera([a.x + 5.5, 4.8, a.z + 5.5], [a.x, a.height / 2, a.z]);
        }
      } else if (entity.type === 'wall') {
        const w = scene.walls.find((x) => x.id === entity.id);
        if (w) {
          set({ activeFloorId: w.floorId });
          const cx = (w.x1 + w.x2) / 2;
          const cz = (w.z1 + w.z2) / 2;
          get().flyToCamera([cx + 6, 5.5, cz + 6], [cx, w.height / 2, cz]);
        }
      } else if (entity.type === 'camera') {
        const c = scene.cameras.find((x) => x.id === entity.id);
        if (c) {
          set({ activeFloorId: c.floorId });
          get().flyToCamera(c.position, c.target, c.fov);
        }
      } else if (entity.type === 'floor') {
        const f = scene.floors.find((x) => x.id === entity.id);
        if (f) {
          set({ activeFloorId: f.id, activeBuildingId: f.buildingId });
          get().flyToCamera([f.width / 2, 24, f.depth * 1.55], [f.width / 2, 1, f.depth / 2]);
        }
      }
    },

    addReferencePlan: (ref) => {
      const created: ReferencePlan = { ...ref, id: `ref-${Date.now()}` };
      commit((draft) => {
        draft.references.push(created);
        return draft;
      }, `Imported reference plan "${created.name}"`);
      set({ selected: [{ type: 'reference', id: created.id }] });
      return created;
    },

    updateReferencePlan: (id, patch) =>
      commit((draft) => {
        const r = draft.references.find((x) => x.id === id);
        if (r) Object.assign(r, patch);
        return draft;
      }),

    deleteReferencePlan: (id) =>
      commit((draft) => {
        draft.references = draft.references.filter((r) => r.id !== id);
        return draft;
      }, 'Removed reference plan'),

    startCalibratingRef: (refId) =>
      set({
        calibratingRefId: refId,
        calibrationPoints: [],
        activeTool: 'calibrate-ref',
        viewMode: get().viewMode === '3d-perspective' ? '2d' : get().viewMode,
        toast: {
          id: `t-${Date.now()}`,
          message: 'Click two known reference points on the 2D floor plan to calibrate scale.',
          tone: 'info',
        },
      }),

    addCalibrationPoint: (pt) =>
      set((s) => ({
        calibrationPoints: s.calibrationPoints.length >= 2 ? [pt] : [...s.calibrationPoints, pt],
      })),

    applyReferenceCalibration: (realDistanceMeters) => {
      const { calibratingRefId, calibrationPoints, scene } = get();
      if (!calibratingRefId || calibrationPoints.length < 2 || realDistanceMeters <= 0) return;
      const [p1, p2] = calibrationPoints;
      const measured = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      if (measured < 0.05) return;
      const scaleFactor = realDistanceMeters / measured;
      const ref = scene.references.find((r) => r.id === calibratingRefId);
      if (!ref) return;
      commit((draft) => {
        const target = draft.references.find((r) => r.id === calibratingRefId);
        if (target) {
          target.width = Number((target.width * scaleFactor).toFixed(2));
          target.depth = Number((target.depth * scaleFactor).toFixed(2));
          target.calibrated = true;
        }
        return draft;
      }, `Calibrated reference plan scale (${scaleFactor.toFixed(2)}×)`);
      set({ calibratingRefId: null, calibrationPoints: [], activeTool: 'select' });
    },

    cancelCalibration: () =>
      set({ calibratingRefId: null, calibrationPoints: [], activeTool: 'select' }),

    updateLayer: (id, patch) =>
      commit((draft) => {
        const l = draft.layers.find((x) => x.id === id);
        if (l) Object.assign(l, patch);
        return draft;
      }),

    addLayer: (name, group, color) =>
      commit((draft) => {
        draft.layers.push({
          id: `layer-${Date.now()}`,
          name,
          group,
          visible: true,
          locked: false,
          selectable: true,
          opacity: 1,
          color,
        });
        return draft;
      }, `Added layer "${name}"`),

    addFlowRoute: (flow) => {
      const created: FlowRoute = { ...flow, id: `flw-${Date.now()}` };
      commit((draft) => {
        draft.flows.push(created);
        return draft;
      }, `Created ${created.flowType} route "${created.name}"`);
      set({ selected: [{ type: 'flow', id: created.id }] });
      return created;
    },

    updateFlowRoute: (id, patch) => {
      const prevFlow = get().scene.flows.find((x) => x.id === id);
      commit(
        (draft) => {
          const f = draft.flows.find((x) => x.id === id);
          if (f) Object.assign(f, patch);
          return draft;
        },
        undefined,
        {
          category: 'flow',
          action: 'Modified Flow Path',
          entityType: 'flow',
          entityId: id,
          entityName: prevFlow?.name ?? id,
          summary: `Updated flow "${prevFlow?.name ?? id}": ${patch.points ? `${patch.points.length} waypoints` : Object.keys(patch).join(', ')}`,
          before: prevFlow ? { pointsCount: prevFlow.points.length, flowType: prevFlow.flowType } : null,
          after: patch.points ? { pointsCount: patch.points.length } : (patch as Record<string, unknown>),
        }
      );
    },

    deleteFlowRoute: (id) =>
      commit((draft) => {
        draft.flows = draft.flows.filter((f) => f.id !== id);
        return draft;
      }, 'Deleted flow route'),

    setTimelineDate: (timelineDate) => set({ timelineDate }),
    setCompareDate: (compareDate) => set({ compareDate }),
    setTimelinePlaying: (timelinePlaying) => set({ timelinePlaying }),
    setTimelineSpeed: (timelineSpeed) => set({ timelineSpeed }),
    setAnalyticsMetric: (analyticsMetric) => set({ analyticsMetric }),
    refreshValidation: () => set((s) => ({ validationIssues: runSpatialValidation(s.scene) })),

    createSnapshot: (label, summary = '') => {
      const { scene, snapshots } = get();
      const snap: LocalSnapshot = {
        id: `snap-${Date.now()}`,
        versionTag: `v${scene.revision}.${snapshots.length + 1}`,
        label,
        summary: summary || `${scene.rooms.length} rooms, ${scene.assets.length} assets`,
        createdAt: new Date().toISOString(),
        roomCount: scene.rooms.length,
        assetCount: scene.assets.length,
        wallCount: scene.walls.length,
        sceneData: structuredClone(scene),
      };
      const updated = [snap, ...snapshots];
      saveLocalSnapshots(scene.id, updated);
      set({ snapshots: updated });
      get().showToast(`Saved snapshot ${snap.versionTag} — "${label}"`, 'success');
      return snap;
    },

    restoreSnapshot: (snapshot) => {
      commit(() => structuredClone(snapshot.sceneData), `Restored snapshot ${snapshot.versionTag}`);
    },

    toggleFavorite: (kind, id) =>
      set((s) => {
        const key =
          kind === 'space'
            ? 'favoriteSpaceTypes'
            : kind === 'object'
              ? 'favoriteObjects'
              : 'favoriteMaterials';
        const cur = s[key];
        return {
          [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
        } as Partial<TwinState>;
      }),

    setPendingAIActions: (pendingAIActions, aiPreviewMessage) =>
      set({ pendingAIActions, aiPreviewMessage }),

    applyPendingAIActions: () => {
      const actions = get().pendingAIActions;
      if (actions.length === 0) return;

      const { activeFloorId } = get();
      let appliedCount = 0;

      commit((draft) => {
        for (const act of actions) {
          if (act.type === 'create_room') {
            const tpl =
              SPACE_TYPE_LIBRARY.find((s) => s.id === act.spaceTypeId) ??
              SPACE_TYPE_LIBRARY.find((s) =>
                s.name.toLowerCase().includes((act.roomName ?? '').toLowerCase())
              ) ??
              SPACE_TYPE_LIBRARY[0];
            const id = `rm-ai-${Date.now()}-${appliedCount}`;
            const w = Math.max(3, act.width ?? tpl.defaultWidth);
            const d = Math.max(3, act.depth ?? tpl.defaultDepth);
            const newRm: Room = {
              id,
              floorId: activeFloorId,
              departmentId: draft.hierarchy.find((h) => h.level === 'department')?.id ?? 'dept-1',
              name: act.roomName || tpl.name,
              code: `AI-${draft.rooms.length + 1}`,
              spaceTypeId: tpl.id,
              category: tpl.category,
              x: act.x ?? 2,
              z: act.z ?? 2,
              width: w,
              depth: d,
              height: act.height ?? tpl.defaultHeight,
              color: tpl.color,
              floorMaterialId: tpl.defaultFloorMaterialId,
              wallMaterialId: tpl.defaultWallMaterialId,
              ceilingMaterialId: tpl.defaultCeilingMaterialId,
              layerId: 'layer-architecture',
              environmental: { ...tpl.environmental },
              occupancyMax: Math.max(2, Math.round((w * d) / 14)),
              currentOccupancy: 2,
              utilizationPct: 70,
              riskLevel: 'medium',
              complianceStatus: 'compliant',
              energyKw: Number((w * d * 0.25).toFixed(1)),
              costPerSqm: tpl.costPerSqm,
              activeFromDate: get().timelineDate,
              metadata: {
                code: `AI-${draft.rooms.length + 1}`,
                description: `Created via AI Copilot: ${act.details}`,
                status: 'planned',
                tags: ['AI Generated', tpl.category],
                owner: 'AI Copilot Proposal',
                department: 'Engineering',
                accessPermission: 'gmp-authorized',
                createdAt: new Date().toISOString().slice(0, 10),
                updatedAt: new Date().toISOString().slice(0, 10),
                revision: 1,
                customProperties: {},
                linkedDocuments: [],
                relatedSystems: [],
                relatedProcesses: [],
              },
            };
            draft.rooms.push(newRm);
            draft.walls.push(...generateWallsForRoom(newRm, id));
            appliedCount++;
          } else if (act.type === 'place_equipment') {
            const tpl =
              OBJECT_LIBRARY.find((o) => o.id === act.equipmentTemplateId) ??
              OBJECT_LIBRARY[0];
            const targetRoom =
              draft.rooms.find((r) => r.id === act.roomId) ??
              draft.rooms.find(
                (r) =>
                  r.floorId === activeFloorId &&
                  act.roomName &&
                  r.name.toLowerCase().includes(act.roomName.toLowerCase())
              ) ??
              draft.rooms.find((r) => r.floorId === activeFloorId);
            const count = Math.min(8, Math.max(1, act.count ?? 1));
            const spacing = (act.clearance ?? tpl.clearanceM) + tpl.width;
            const baseX = act.x ?? (targetRoom ? targetRoom.x + 2.2 : 5);
            const baseZ = act.z ?? (targetRoom ? targetRoom.z + targetRoom.depth / 2 : 5);
            for (let i = 0; i < count; i++) {
              const seq = draft.assets.length + 1;
              const code = `${tpl.archetype.slice(0, 3).toUpperCase()}-${String(seq).padStart(3, '0')}`;
              const px = Number((baseX + i * spacing).toFixed(2));
              draft.assets.push({
                id: `ast-ai-${Date.now()}-${i}-${seq}`,
                floorId: activeFloorId,
                roomId: targetRoom?.id,
                templateId: tpl.id,
                archetype: tpl.archetype,
                name: `${tpl.name} #${i + 1}`,
                assetId: code,
                equipmentId: `EQ-${code}`,
                category: tpl.category,
                manufacturer: tpl.manufacturer,
                model: tpl.model,
                serialNumber: `SN-AI-${seq}`,
                description: tpl.description,
                tags: ['AI Placed', tpl.category],
                criticality: tpl.category === 'Biopharmaceutical' ? 'gmp-critical' : 'medium',
                owner: 'Engineering',
                department: 'Production',
                responsiblePerson: 'Lead Engineer',
                x: px,
                y: 0,
                z: baseZ,
                rotationX: 0,
                rotationY: 0,
                rotationZ: 0,
                width: tpl.width,
                depth: tpl.depth,
                height: tpl.height,
                weightKg: tpl.weightKg,
                clearanceM: act.clearance ?? tpl.clearanceM,
                materialId: tpl.defaultMaterialId,
                color: tpl.defaultColor,
                layerId: 'layer-equipment',
                operationalStatus: 'planned',
                installationDate: get().timelineDate,
                commissioningDate: get().timelineDate,
                warrantyUntil: '2029-01-01',
                maintenanceSchedule: 'Quarterly Calibration',
                lastMaintenance: get().timelineDate,
                nextMaintenance: '2027-03-01',
                capacityLabel: 'Nominal 100%',
                utilizationPct: 75,
                availabilityPct: 99,
                conditionScore: 100,
                lifecycle: 'planned',
                capexUsd: tpl.capexUsd,
                annualOpexUsd: tpl.annualOpexUsd,
                energyKw: tpl.energyKw,
                connectivity: {
                  protocol: 'OPC UA',
                  endpoint: `opc.tcp://scada.local:4840/${code}`,
                  plcTag: `PLC.${code}`,
                  scadaNode: `SCADA-${code}`,
                  historianId: `HIST_${code}`,
                  liveMetrics: [{ label: 'Power', value: String(tpl.energyKw), unit: 'kW', status: 'ok' }],
                },
                documents: [],
                qrCode: `GRADIAN://ASSET/${code}`,
                relatedSystems: ['SCADA'],
                relatedProcesses: [],
              });
            }
            appliedCount++;
          } else if (act.type === 'update_wall_height' && act.height) {
            const h = Math.max(2.2, Math.min(8, act.height));
            draft.walls
              .filter((w) => w.floorId === activeFloorId && (!act.roomId || w.roomId === act.roomId))
              .forEach((w) => (w.height = h));
            draft.rooms
              .filter((r) => r.floorId === activeFloorId && (!act.roomId || r.id === act.roomId))
              .forEach((r) => (r.height = h));
            appliedCount++;
          } else if (act.type === 'apply_floor_material' && act.materialId) {
            draft.rooms
              .filter((r) => r.floorId === activeFloorId && (!act.roomId || r.id === act.roomId))
              .forEach((r) => (r.floorMaterialId = act.materialId!));
            appliedCount++;
          } else if (act.type === 'add_door') {
            const targetWall =
              draft.walls.find((w) => w.floorId === activeFloorId && (!act.roomId || w.roomId === act.roomId)) ??
              draft.walls.find((w) => w.floorId === activeFloorId);
            if (targetWall) {
              const count = Math.min(3, Math.max(1, act.count ?? 1));
              for (let i = 0; i < count; i++) {
                draft.openings.push({
                  id: `op-ai-${Date.now()}-${i}`,
                  floorId: activeFloorId,
                  wallId: targetWall.id,
                  kind: 'door',
                  subtype: 'cleanroom-door',
                  name: `Cleanroom Door ${i + 1}`,
                  offsetRatio: count === 1 ? 0.5 : 0.28 + i * 0.42,
                  width: 1.2,
                  height: 2.2,
                  sillHeight: 0,
                  thickness: targetWall.thickness + 0.04,
                  swingDirection: 'right',
                  swingAngle: 90,
                  materialId: 'mat-cleanroom-panel',
                  frameColor: '#2563EB',
                  lockType: 'GMP Interlock',
                  accessControl: 'badge',
                  fireRating: '60 min',
                  status: 'closed',
                  layerId: 'layer-openings',
                });
              }
              appliedCount++;
            }
          } else if (act.type === 'create_camera') {
            const floor = draft.floors.find((f) => f.id === activeFloorId);
            const cx = act.x ?? (floor ? floor.width / 2 : 12);
            const cz = act.z ?? (floor ? floor.depth - 2 : 12);
            draft.cameras.push({
              id: `cam-ai-${Date.now()}`,
              floorId: activeFloorId,
              name: act.cameraName || 'AI Entrance Viewpoint',
              kind: act.cameraType || 'security',
              group: 'AI Cameras',
              position: [cx, act.height ?? 3.2, cz],
              target: [cx, 1.4, Math.max(2, cz - 7)],
              fov: 60,
              focalLengthMm: 28,
              coverageRadius: 10,
              visibleCone: true,
              layerId: 'layer-cameras',
            });
            appliedCount++;
          } else if (act.type === 'create_flow') {
            draft.flows.push({
              id: `flw-ai-${Date.now()}`,
              floorId: activeFloorId,
              name: act.title || 'AI Personnel Route',
              flowType: act.flowType || 'personnel',
              points: [
                { x: 4, z: 18 },
                { x: 14, z: 12 },
                { x: 24, z: 6 },
              ],
              color: act.flowType === 'waste' ? '#EF4444' : act.flowType === 'material' ? '#2563EB' : '#10B981',
              flowRateLabel: 'Standard Shift',
              capacityLabel: 'GMP Compliant',
              cleanlinessClass: act.flowType === 'waste' ? 'dirty' : 'clean',
              restrictions: 'Proposed via AI Copilot',
              layerId: 'layer-flows',
            });
            appliedCount++;
          }
        }
        return draft;
      }, appliedCount > 0 ? `Applied ${appliedCount} AI Copilot spatial action${appliedCount > 1 ? 's' : ''}` : undefined);

      // Handle non-mutating view/selection actions
      for (const act of actions) {
        if (act.type === 'set_analytics_mode' && act.analyticsMetric) {
          set({ analyticsMetric: act.analyticsMetric, rightTab: 'analytics' });
        } else if (act.type === 'run_validation') {
          get().refreshValidation();
          set({ rightTab: 'validation' });
        } else if (act.type === 'select_entities' && act.entityIds && act.entityIds.length > 0) {
          const { scene } = get();
          const matched: SelectedEntity[] = [];
          for (const eid of act.entityIds) {
            if (scene.assets.some((a) => a.id === eid || a.assetId === eid)) {
              const a = scene.assets.find((x) => x.id === eid || x.assetId === eid)!;
              matched.push({ type: 'asset', id: a.id });
            } else if (scene.rooms.some((r) => r.id === eid || r.code === eid)) {
              const r = scene.rooms.find((x) => x.id === eid || x.code === eid)!;
              matched.push({ type: 'room', id: r.id });
            }
          }
          if (matched.length > 0) {
            set({ selected: matched });
            get().focusEntity(matched[0]);
          }
        }
      }

      set({ pendingAIActions: [], aiPreviewMessage: null });
    },

    clearPendingAIActions: () => set({ pendingAIActions: [], aiPreviewMessage: null }),

    showToast: (message, tone = 'info', canUndo = false) =>
      set({ toast: { id: `t-${Date.now()}`, message, tone, canUndo } }),

    dismissToast: () => set({ toast: null }),
  };
});
