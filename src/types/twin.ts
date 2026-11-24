export type UnitSystem = 'metric' | 'imperial';

export type ViewMode = '2d' | '3d-perspective' | '3d-ortho' | 'split';

export type OrthoPreset =
  | 'isometric'
  | 'top'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'bottom';

export type ToolMode =
  | 'select'
  | 'draw-room'
  | 'draw-wall'
  | 'place-door'
  | 'place-window'
  | 'place-object'
  | 'measure'
  | 'paint-material'
  | 'draw-flow'
  | 'place-camera'
  | 'calibrate-ref';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export type HierarchyLevel =
  | 'enterprise'
  | 'organization'
  | 'company'
  | 'site'
  | 'building'
  | 'section'
  | 'floor'
  | 'department'
  | 'room'
  | 'zone'
  | 'asset';

export type LifecycleStatus =
  | 'planned'
  | 'under-construction'
  | 'installed'
  | 'commissioning'
  | 'operational'
  | 'maintenance'
  | 'decommissioned'
  | 'archived';

export interface SpatialMetadata {
  code: string;
  description: string;
  status: LifecycleStatus;
  tags: string[];
  owner: string;
  department: string;
  accessPermission: 'public' | 'restricted' | 'gmp-authorized' | 'confidential';
  createdAt: string;
  updatedAt: string;
  revision: number;
  customProperties: Record<string, string>;
  linkedDocuments: { id: string; title: string; type: string; ref: string }[];
  relatedSystems: string[];
  relatedProcesses: string[];
}

export interface EnterpriseNode {
  id: string;
  name: string;
  level: HierarchyLevel;
  parentId: string | null;
  metadata: SpatialMetadata;
}

export interface Building {
  id: string;
  siteId: string;
  name: string;
  code: string;
  description: string;
  width: number;
  depth: number;
  originX: number;
  originZ: number;
  color: string;
  metadata: SpatialMetadata;
}

export interface Floor {
  id: string;
  buildingId: string;
  sectionName: string;
  name: string;
  code: string;
  levelIndex: number;
  elevation: number; // meters
  height: number; // floor-to-ceiling meters
  slabThickness: number;
  width: number;
  depth: number;
  slabMaterialId: string;
  metadata: SpatialMetadata;
}

export type CleanroomGrade =
  | 'Grade A / ISO 5'
  | 'Grade B / ISO 6'
  | 'Grade C / ISO 7'
  | 'Grade D / ISO 8'
  | 'CNC (Controlled)'
  | 'Unclassified';

export interface EnvironmentalSpecs {
  cleanroomGrade: CleanroomGrade;
  pressurePa: number;
  airChangesPerHour: number;
  temperatureC: number;
  humidityPct: number;
  monitoringRequired: boolean;
}

export interface Room {
  id: string;
  floorId: string;
  departmentId: string;
  name: string;
  code: string;
  spaceTypeId: string;
  category: SpaceCategory;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  floorMaterialId: string;
  wallMaterialId: string;
  ceilingMaterialId: string;
  layerId: string;
  environmental: EnvironmentalSpecs;
  occupancyMax: number;
  currentOccupancy: number;
  utilizationPct: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  complianceStatus: 'compliant' | 'review-due' | 'deviation';
  energyKw: number;
  costPerSqm: number;
  activeFromDate: string; // YYYY-MM-DD for 5D timeline
  metadata: SpatialMetadata;
}

export interface Zone {
  id: string;
  roomId: string;
  floorId: string;
  name: string;
  code: string;
  zoneType: 'pressure-cascade' | 'aseptic-core' | 'safety' | 'storage' | 'monitoring';
  x: number;
  z: number;
  width: number;
  depth: number;
  color: string;
}

export type WallPresetId =
  | 'interior-standard'
  | 'exterior-structural'
  | 'concrete'
  | 'brick'
  | 'glass-partition'
  | 'cleanroom-panel'
  | 'fire-rated'
  | 'insulated-sandwich'
  | 'industrial-partition'
  | 'temporary-partition';

export interface Wall {
  id: string;
  floorId: string;
  roomId?: string;
  name: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  thickness: number;
  elevation: number;
  presetId: WallPresetId;
  isExterior: boolean;
  isStructural: boolean;
  fireRating: string;
  acousticRatingDb: number;
  materialId: string;
  color: string;
  opacity: number;
  layerId: string;
  activeFromDate: string;
}

export type OpeningKind = 'door' | 'window';

export type OpeningSubtype =
  | 'single-door'
  | 'double-door'
  | 'sliding-door'
  | 'automatic-door'
  | 'emergency-door'
  | 'fire-door'
  | 'cleanroom-door'
  | 'airlock-door'
  | 'roller-shutter'
  | 'industrial-door'
  | 'warehouse-door'
  | 'glass-door'
  | 'security-door'
  | 'standard-window'
  | 'fixed-window'
  | 'sliding-window'
  | 'industrial-window'
  | 'cleanroom-window'
  | 'observation-window'
  | 'double-glazing'
  | 'skylight';

export interface Opening {
  id: string;
  floorId: string;
  wallId: string;
  kind: OpeningKind;
  subtype: OpeningSubtype;
  name: string;
  offsetRatio: number; // 0..1 along host wall
  width: number;
  height: number;
  sillHeight: number;
  thickness: number;
  swingDirection: 'left' | 'right' | 'both' | 'slide';
  swingAngle: number;
  materialId: string;
  frameColor: string;
  lockType: string;
  accessControl: 'none' | 'badge' | 'biometric' | 'interlock';
  fireRating: string;
  status: 'closed' | 'open' | 'interlocked' | 'alarm';
  layerId: string;
}

export type EquipmentCategory =
  | 'Biopharmaceutical'
  | 'Laboratory'
  | 'HVAC & Utilities'
  | 'Warehouse & Logistics'
  | 'IT & Data Center'
  | 'Furniture & Workplace'
  | 'Building & Safety';

export type EquipmentArchetype =
  | 'bioreactor-ss'
  | 'bioreactor-su'
  | 'vessel-tank'
  | 'chromatography-skid'
  | 'filtration-skid'
  | 'filling-line'
  | 'lyophilizer'
  | 'autoclave'
  | 'isolator'
  | 'biosafety-cabinet'
  | 'fume-hood'
  | 'hplc-instrument'
  | 'stability-chamber'
  | 'lab-freezer'
  | 'lab-bench'
  | 'ahu-unit'
  | 'chiller'
  | 'wfi-skid'
  | 'electrical-panel'
  | 'pallet-rack'
  | 'forklift'
  | 'conveyor'
  | 'desk-workstation'
  | 'conference-table'
  | 'safety-station'
  | 'sensor-node'
  | 'server-rack'
  | 'network-rack'
  | 'ups-tower'
  | 'crac-cooling'
  | 'pdu-cabinet'
  | 'patch-cabinet'
  | 'scada-console'
  | 'tablet-press'
  | 'fluid-bed-dryer'
  | 'granulator'
  | 'agv-robot'
  | 'generic-equipment';

export interface RackPort {
  id: string;
  label: string;
  kind: 'RJ45' | 'SFP+' | 'QSFP28' | 'Fiber-LC' | 'Console' | 'Power-C13';
  speedGbps: number;
  vlan: string;
  status: 'up' | 'down' | 'standby';
}

export interface RackDevice {
  id: string;
  name: string;
  kind: 'server' | 'switch' | 'router' | 'firewall' | 'patch-panel' | 'storage' | 'ups' | 'pdu' | 'scada' | 'kvm';
  uStart: number; // 1..42
  uHeight: number; // 1..6
  powerW: number;
  ipAddress: string;
  vlan: string;
  vendor: string;
  model: string;
  status: 'online' | 'warning' | 'offline';
  ports: RackPort[];
}

export interface RackPatchCable {
  id: string;
  fromDeviceId: string;
  fromPortId: string;
  toDeviceId: string;
  toPortId: string;
  media: 'Cat6A' | 'OM4 Fiber' | 'OS2 Single-Mode' | 'DAC Twinax' | 'Power';
  vlan: string;
  color: string;
  label?: string;
}

export interface RackDesignConfig {
  totalUnits: number; // default 42
  maxPowerKw: number;
  coolingZone: string;
  subnetCidr: string;
  devices: RackDevice[];
  cables: RackPatchCable[];
}

export interface SpatialAsset {
  id: string;
  floorId: string;
  roomId?: string;
  templateId: string;
  archetype: EquipmentArchetype;
  name: string;
  assetId: string;
  equipmentId: string;
  category: EquipmentCategory;
  manufacturer: string;
  model: string;
  serialNumber: string;
  description: string;
  tags: string[];
  criticality: 'low' | 'medium' | 'high' | 'gmp-critical';
  owner: string;
  department: string;
  responsiblePerson: string;
  // Spatial
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  width: number;
  depth: number;
  height: number;
  weightKg: number;
  clearanceM: number;
  materialId: string;
  color: string;
  layerId: string;
  locked?: boolean;
  hidden?: boolean;
  // Operational & 5D
  operationalStatus:
    | 'running'
    | 'standby'
    | 'maintenance-due'
    | 'offline'
    | 'planned'
    | 'commissioning';
  installationDate: string;
  commissioningDate: string;
  warrantyUntil: string;
  maintenanceSchedule: string;
  lastMaintenance: string;
  nextMaintenance: string;
  capacityLabel: string;
  utilizationPct: number;
  availabilityPct: number;
  conditionScore: number; // 0-100
  lifecycle: LifecycleStatus;
  capexUsd: number;
  annualOpexUsd: number;
  energyKw: number;
  // Digital connectivity
  connectivity: {
    protocol: 'OPC UA' | 'MQTT' | 'Modbus TCP' | 'REST API' | 'BACnet' | 'None';
    endpoint: string;
    plcTag: string;
    scadaNode: string;
    historianId: string;
    liveMetrics: { label: string; value: string; unit: string; status: 'ok' | 'warn' | 'alert' }[];
  };
  // Documents & Relationships
  documents: { id: string; title: string; kind: string; code: string }[];
  qrCode: string;
  relatedSystems: string[];
  relatedProcesses: string[];
  // Optional IT / Data Center Rack & Network Design configuration
  rackConfig?: RackDesignConfig;
}

export type SpaceCategory =
  | 'Pharmaceutical Manufacturing'
  | 'Cleanrooms'
  | 'Quality & Laboratories'
  | 'Warehouses & Logistics'
  | 'Utilities'
  | 'Offices & Administration'
  | 'Other Industrial';

export interface SpaceTypeTemplate {
  id: string;
  name: string;
  category: SpaceCategory;
  color: string;
  defaultWidth: number;
  defaultDepth: number;
  defaultHeight: number;
  defaultWallPreset: WallPresetId;
  defaultFloorMaterialId: string;
  defaultWallMaterialId: string;
  defaultCeilingMaterialId: string;
  environmental: EnvironmentalSpecs;
  safetyClass: string;
  complianceStandard: string;
  recommendedEquipment: string[];
  costPerSqm: number;
  isCustom?: boolean;
}

export interface ObjectLibraryItem {
  id: string;
  name: string;
  category: EquipmentCategory;
  archetype: EquipmentArchetype;
  manufacturer: string;
  model: string;
  width: number;
  depth: number;
  height: number;
  weightKg: number;
  clearanceM: number;
  defaultColor: string;
  defaultMaterialId: string;
  recommendedSpaces: SpaceCategory[];
  capexUsd: number;
  annualOpexUsd: number;
  energyKw: number;
  description: string;
  isCustom?: boolean;
}

export interface MaterialDef {
  id: string;
  name: string;
  category:
    | 'Flooring'
    | 'Walls & Partitions'
    | 'Metals'
    | 'Glass'
    | 'Masonry & Stone'
    | 'Wood & Interior'
    | 'Industrial Coatings'
    | 'Custom';
  baseColor: string;
  roughness: number;
  metalness: number;
  opacity: number;
  reflectivity: number;
  pattern:
    | 'solid'
    | 'epoxy-speckle'
    | 'cleanroom-panel'
    | 'brushed-metal'
    | 'concrete'
    | 'tile-grid'
    | 'brick'
    | 'wood-grain'
    | 'glass'
    | 'industrial-coat';
  uvScale: number;
  textureRotation: number;
  customTextureDataUrl?: string;
  isCustom?: boolean;
}

export interface ReferencePlan {
  id: string;
  floorId: string;
  name: string;
  layerCategory:
    | 'reference-plan'
    | 'existing-building'
    | 'proposed-design'
    | 'construction'
    | 'equipment-layout'
    | 'utility';
  dataUrl: string;
  fileType: string;
  x: number;
  z: number;
  elevation: number;
  width: number;
  depth: number;
  rotationDeg: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  calibrated: boolean;
  layerId: string;
}

export type CameraKind =
  | 'perspective'
  | 'orthographic'
  | 'first-person'
  | 'security'
  | 'fixed-industrial'
  | 'inspection';

export type CameraStreamProtocol = 'RTSP' | 'HLS' | 'MJPEG' | 'ONVIF' | 'WebRTC';

export interface SceneCamera {
  id: string;
  floorId: string;
  name: string;
  kind: CameraKind;
  group: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  focalLengthMm: number;
  coverageRadius: number;
  visibleCone: boolean;
  layerId: string;
  // IP CCTV & Security Credentials (password hashed via Argon2id on server)
  ipAddress?: string;
  port?: number;
  protocol?: CameraStreamProtocol;
  streamPath?: string;
  username?: string;
  passwordHash?: string; // PHC $argon2id$... hash (never plaintext)
  hasCredentials?: boolean;
  resolution?: string;
  fps?: number;
  nightVision?: boolean;
  status?: 'online' | 'recording' | 'offline';
}

export interface LayerDef {
  id: string;
  name: string;
  group: 'Architecture' | 'MEP & Process' | 'Intelligence' | 'References';
  visible: boolean;
  locked: boolean;
  selectable: boolean;
  opacity: number;
  color: string;
}

export type FlowType =
  | 'personnel'
  | 'material'
  | 'product'
  | 'waste'
  | 'utility'
  | 'evacuation'
  | 'maintenance'
  | 'airflow';

export interface FlowRoute {
  id: string;
  floorId: string;
  name: string;
  flowType: FlowType;
  points: { x: number; z: number }[];
  color: string;
  flowRateLabel: string;
  capacityLabel: string;
  cleanlinessClass: 'clean' | 'dirty' | 'bidirectional' | 'emergency';
  restrictions: string;
  layerId: string;
  animated?: boolean;
}

export interface TimelineEvent {
  id: string;
  date: string; // YYYY-MM-DD
  phase: 'construction' | 'installation' | 'commissioning' | 'operation' | 'maintenance';
  title: string;
  description: string;
  costDeltaUsd: number;
}

export type AnalyticsMetric =
  | 'none'
  | 'space-type'
  | 'cleanroom-grade'
  | 'pressure-cascade'
  | 'temperature'
  | 'utilization'
  | 'compliance'
  | 'risk'
  | 'cost'
  | 'energy'
  | 'maintenance';

export interface ValidationIssue {
  id: string;
  severity: 'critical' | 'error' | 'warning' | 'info';
  code: string;
  title: string;
  description: string;
  floorId: string;
  entityIds: string[];
  entityType: 'asset' | 'room' | 'wall' | 'opening' | 'flow' | 'camera';
  focusPoint?: [number, number, number];
  autoFixHint?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  category:
    | 'spatial'
    | 'asset'
    | 'wall-opening'
    | 'flow'
    | 'camera'
    | 'network-rack'
    | 'floor-building'
    | 'settings'
    | 'validation-ai'
    | 'save';
  action: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface SnapConfig {
  enabled: boolean;
  showGrid: boolean;
  gridSize: number; // meters
  majorGridEvery: number;
  gridOpacity: number;
  snapToGrid: boolean;
  snapToWall: boolean;
  snapToObject: boolean;
  snapToCenter: boolean;
  angleStepDeg: number;
}

export interface ProposedAIAction {
  type:
    | 'create_room'
    | 'place_equipment'
    | 'update_wall_height'
    | 'apply_floor_material'
    | 'add_door'
    | 'create_camera'
    | 'create_flow'
    | 'set_analytics_mode'
    | 'select_entities'
    | 'run_validation'
    | 'query_report'
    | 'highlight_production_line'
    | 'create_work_order';
  title: string;
  details: string;
  roomName?: string;
  spaceTypeId?: string;
  roomId?: string;
  x?: number;
  z?: number;
  width?: number;
  depth?: number;
  height?: number;
  equipmentTemplateId?: string;
  count?: number;
  clearance?: number;
  materialId?: string;
  analyticsMetric?: AnalyticsMetric;
  flowType?: FlowType;
  cameraName?: string;
  cameraType?: CameraKind;
  entityIds?: string[];
  lineId?: string;
  serviceType?: string;
  priority?: string;
  dueDate?: string;
}

export interface LocalSnapshot {
  id: string;
  versionTag: string;
  label: string;
  summary: string;
  createdAt: string;
  roomCount: number;
  assetCount: number;
  wallCount: number;
  sceneData: DigitalTwinScene;
}

export interface DigitalTwinScene {
  id: string;
  name: string;
  code: string;
  description: string;
  industry: string;
  unitSystem: UnitSystem;
  revision: number;
  updatedAt: string;
  hierarchy: EnterpriseNode[];
  buildings: Building[];
  floors: Floor[];
  rooms: Room[];
  zones: Zone[];
  walls: Wall[];
  openings: Opening[];
  assets: SpatialAsset[];
  cameras: SceneCamera[];
  references: ReferencePlan[];
  layers: LayerDef[];
  flows: FlowRoute[];
  timelineEvents: TimelineEvent[];
  customMaterials: MaterialDef[];
  customSpaceTypes: SpaceTypeTemplate[];
  customObjects: ObjectLibraryItem[];
}
