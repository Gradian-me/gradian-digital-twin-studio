export type UnitSystem = 'metric' | 'imperial';

export type WorkspaceMode = 'design' | 'view';

export type FacilityCategoryFilter =
  | 'all'
  | 'IT'
  | 'PRODUCTION'
  | 'LABORATORY'
  | 'VALIDATION'
  | 'UTILITIES'
  | 'SAFETY'
  | 'WAREHOUSE';

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

export type HvacAirflowMode =
  | 'positive-cascade'
  | 'negative-containment'
  | 'laminar-udaf'
  | 'balanced'
  | 'cold-recirc';

export type HvacHepaClass =
  | 'ULPA U15'
  | 'HEPA H14'
  | 'HEPA H13'
  | 'MERV-14'
  | 'MERV-11';

export type HvacSystemStatus = 'online' | 'running' | 'setback' | 'standby' | 'maintenance' | 'alarm';

export interface RoomHvacConfig {
  ahuId: string;
  ahuName: string;
  hepaClass: HvacHepaClass;
  airflowMode: HvacAirflowMode;
  airChangesPerHour: number;
  targetPressurePa: number;
  supplyTempC: number;
  damperPct: number;
  diffuserCount: number;
  exhaustPct: number;
  status: HvacSystemStatus;
  systemStatus: HvacSystemStatus;
  showDucts: boolean;
}

export interface EnvironmentalSpecs {
  cleanroomGrade: CleanroomGrade;
  pressurePa: number;
  airChangesPerHour: number;
  temperatureC: number;
  humidityPct: number;
  monitoringRequired: boolean;
  hvac?: RoomHvacConfig;
}

export interface RoomFireSensor {
  id: string;
  tag: string;
  type: 'Optical Smoke' | 'Thermal Rate-of-Rise' | 'VESDA Aspirating' | 'UV/IR Flame';
  zone: string;
  status: 'normal' | 'test-due' | 'fault';
  lastTested: string;
  nextTestDue: string;
  sensitivity: string;
}

export interface RoomFireExtinguisher {
  id: string;
  tag: string;
  agent: 'CO2 (Carbon Dioxide)' | 'FM-200 Clean Agent' | 'ABC Dry Powder' | 'Water Mist';
  capacityKg: number;
  classRating: string;
  pressureStatus: 'green-nominal' | 'recharge-due';
  locationHint: string;
  lastInspection: string;
  nextInspection: string;
}

export interface RoomFireSafetyConfig {
  sensors: RoomFireSensor[];
  extinguishers: RoomFireExtinguisher[];
}

export type LightFixtureType =
  | 'led-troffer'
  | 'linear-vapor'
  | 'recessed-downlight'
  | 'high-bay'
  | 'emergency-bulkhead'
  | 'uv-c-sterilizer';

export interface RoomLightSwitch {
  id: string;
  label: string;
  wallSide: 'north' | 'south' | 'east' | 'west';
  offsetRatio: number; // 0.08..0.92 along chosen wall
  heightM: number; // default ~1.25m
  isOn: boolean;
  dimmerPct?: number; // 10..100
}

export interface RoomLightFixture {
  id: string;
  label: string;
  type: LightFixtureType;
  switchId: string;
  relX: number; // 0.1..0.9 across room width
  relZ: number; // 0.1..0.9 across room depth
  kelvin: number; // e.g., 3000..6500
  intensity: number; // 0.3..2.5
}

export interface RoomLightingConfig {
  switches: RoomLightSwitch[];
  fixtures: RoomLightFixture[];
}

export interface Room {
  id: string;
  floorId: string;
  departmentId: string;
  owner?: string;
  costCenter?: string;
  fireSafety?: RoomFireSafetyConfig;
  lighting?: RoomLightingConfig;
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
  | 'full-glass-wall'
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
  | 'fire-extinguisher'
  | 'firebox-cabinet'
  | 'pass-box'
  | 'cold-room-unit'
  | 'generic-equipment';

export interface RackPort {
  id: string;
  label: string;
  kind: 'RJ45' | 'SFP+' | 'QSFP28' | 'Fiber-LC' | 'Console' | 'Power-C13';
  speedGbps: number;
  vlan: string;
  status: 'up' | 'down' | 'standby' | 'error';
  isUplink?: boolean;
  poeWatts?: number;
  utilizationPct?: number;
  crcErrors?: number;
  opticalDbm?: number;
  connectedToLabel?: string;
}

export interface RackDeviceDriveBay {
  id: string;
  slot: number;
  label: string;
  capacityLabel: string;
  tempC: number;
  health: 'healthy' | 'warning' | 'failed';
  usedPct?: number;
}

export interface RackDeviceWorkload {
  id: string;
  vmid: string;
  name: string;
  kind: 'VM' | 'CT';
  hostTag: string;
  status: 'up' | 'stopped' | 'degraded';
  cpuPct: number;
  memPct: number;
}

export interface RackDevice {
  id: string;
  name: string;
  kind: 'server' | 'switch' | 'router' | 'firewall' | 'patch-panel' | 'storage' | 'ups' | 'pdu' | 'scada' | 'kvm';
  tier?: 'core' | 'distribution' | 'access' | 'compute' | 'security' | 'power';
  uStart: number; // 1..42
  uHeight: number; // 1..6
  powerW: number;
  ipAddress: string;
  macAddress?: string;
  serialNumber?: string;
  vlan: string;
  vendor: string;
  model: string;
  status: 'online' | 'warning' | 'offline';
  cpuPct?: number;
  memPct?: number;
  diskPct?: number;
  tempC?: number;
  uptimeLabel?: string;
  latencyMs?: number;
  packetLossPct?: number;
  hypervisorVersion?: string;
  driveBays?: RackDeviceDriveBay[];
  workloads?: RackDeviceWorkload[];
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
  rackRole?: 'core-dc' | 'distribution-idf' | 'access-closet' | 'server-compute';
  locationZone?: string;
  maxPowerKw: number;
  coolingZone: string;
  subnetCidr: string;
  devices: RackDevice[];
  cables: RackPatchCable[];
}

export type NetworkUserNodeKind =
  | 'workstation'
  | 'hmi-panel'
  | 'hplc-drop'
  | 'wifi-ap'
  | 'ip-phone'
  | 'cctv-cam'
  | 'badge-reader'
  | 'iot-gateway';

export interface NetworkUserNode {
  id: string;
  code: string;
  name: string;
  nodeKind: NetworkUserNodeKind;
  floorId: string;
  roomId?: string;
  x: number;
  z: number;
  wallJackId: string;
  ipAddress: string;
  macAddress: string;
  vlan: string;
  poeWatts: number;
  connectedRackId: string;
  connectedDeviceId: string;
  connectedPortId: string;
  media: 'Cat6A' | 'OM4 Fiber' | 'PoE++ Cat6A';
  status: 'online' | 'degraded' | 'error' | 'offline';
  bandwidthMbps: number;
  latencyMs: number;
  packetLossPct: number;
  crcErrors: number;
  notes?: string;
}

export interface NetworkInterRackLink {
  id: string;
  label: string;
  tier: 'access-to-dist' | 'dist-to-core' | 'core-to-core';
  fromRackId: string;
  fromDeviceId: string;
  fromPortId: string;
  toRackId: string;
  toDeviceId: string;
  toPortId: string;
  media: 'OM4 Fiber' | 'OS2 Single-Mode' | 'DAC Twinax' | 'Cat6A';
  speedGbps: number;
  vlanTrunk: string;
  status: 'up' | 'degraded' | 'down';
  utilizationPct: number;
  opticalRxDbm: number;
  crcErrors: number;
}

export interface MonitoringApiConnector {
  id: string;
  name: string;
  provider: 'SNMPv3' | 'Prometheus' | 'Zabbix' | 'NetBox' | 'Cisco Catalyst Center' | 'Custom REST';
  endpointUrl: string;
  authType: 'bearer' | 'api-key' | 'snmp-v3' | 'none';
  pollIntervalSec: number;
  enabled: boolean;
  lastStatus: 'idle' | 'connected' | 'error';
  lastCheckedAt?: string;
  mappedMetrics: string[];
}

export interface TopologyVlan {
  id: string;
  vlanTag: string;
  name: string;
  subnet: string;
  color: string;
  visible: boolean;
}

export interface TopologyBox {
  id: string;
  kind: 'box' | 'frame';
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  roomId?: string;
}

export interface TopologyTextNote {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
}

export interface TopologyTableCard {
  id: string;
  title: string;
  x: number;
  y: number;
  tableKind: 'vlans' | 'ports' | 'custom';
  headers: string[];
  rows: string[][];
}

export interface TopologyCustomNode {
  id: string;
  kind: 'vpn' | 'tunnel' | 'wan' | 'ap' | 'controller' | 'switch' | 'nas' | 'hypervisor';
  badge: string;
  name: string;
  subtitle?: string;
  ipAddress: string;
  vlan: string;
  status: 'online' | 'warning' | 'offline';
  x: number;
  y: number;
  latencyMs?: number;
  packetLossPct?: number;
  uptimeLabel?: string;
  cpuPct?: number;
  memPct?: number;
  diskPct?: number;
  ports?: RackPort[];
}

export interface TopologyCustomCable {
  id: string;
  fromNodeId: string;
  fromPortId?: string;
  toNodeId: string;
  toPortId?: string;
  label: string;
  speedLabel: string;
  vlan: string;
  color: string;
  style: 'solid' | 'dashed';
  status: 'up' | 'degraded' | 'down';
}

export interface TopologyMapState {
  diagramName: string;
  snapToGrid: boolean;
  showLegend: boolean;
  vlans: TopologyVlan[];
  nodePositions: Record<string, { x: number; y: number }>;
  boxes: TopologyBox[];
  texts: TopologyTextNote[];
  tables: TopologyTableCard[];
  customNodes: TopologyCustomNode[];
  customCables: TopologyCustomCable[];
}

export interface NetworkArchitectureState {
  userNodes: NetworkUserNode[];
  interRackLinks: NetworkInterRackLink[];
  monitoringApis: MonitoringApiConnector[];
  topologyMap?: TopologyMapState;
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
  // Identification, SOP & Governance History
  costCenter?: string;
  sopIds?: string[];
  vendorHistory?: {
    id: string;
    date: string;
    vendor: string;
    action: string;
    costUsd?: number;
    reference?: string;
    note: string;
  }[];
  ownerHistory?: {
    id: string;
    date: string;
    owner: string;
    department: string;
    costCenter: string;
    note: string;
  }[];
  // Optional IT / Data Center Rack & Network Design configuration
  rackConfig?: RackDesignConfig;
}

export type EntityInfoTarget = { type: 'asset' | 'room'; id: string } | null;

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
  roomId?: string;
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
  networkArchitecture?: NetworkArchitectureState;
}

export interface NetworkTraceHop {
  id: string;
  label: string;
  sublabel: string;
  kind: 'user-node' | 'port' | 'switch' | 'access-switch' | 'rack' | 'core' | 'core-switch';
  x: number;
  z: number;
  floorId: string;
  elevation: number;
  roomId?: string;
  assetId?: string;
  rackId?: string;
  nodeId?: string;
  portLabel?: string;
  vlan?: string;
  speedLabel?: string;
  status?: 'ok' | 'warn' | 'error';
}

export interface NetworkTraceOverlay {
  id: string;
  title: string;
  subtitle: string;
  floorId: string;
  buildingId: string;
  targetAssetId?: string;
  targetNodeId?: string;
  sourcePortLabel?: string;
  vlan?: string;
  media?: string;
  status: 'nominal' | 'warning' | 'degraded' | 'error';
  hops: NetworkTraceHop[];
}

