import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Cable,
  CheckCircle2,
  Cpu,
  Eye,
  GitBranch,
  HardDrive,
  Layers,
  Lock,
  Map as MapIcon,
  Monitor,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  PlugZap,
  Plus,
  Power,
  Printer,
  QrCode,
  Radio,
  RefreshCw,
  Route,
  Server,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTwinStore } from '../store/useTwinStore';
import { useAclStore, computeEffectivePermissions, getActiveAclUser } from '../store/useAclStore';
import { useGmpStore } from '../store/useGmpStore';
import { DataCenter3DViewer } from './DataCenter3DViewer';
import { LivePortTopologyCanvas } from './LivePortTopologyCanvas';
import { ItLabelPrintModal, type ItLabelPayload } from './ItLabelPrintModal';
import { ItArchitectureQuickBuilder } from './ItArchitectureQuickBuilder';
import { It3DDetailDialog, type It3DDetailTarget } from './It3DDetailDialog';
import type {
  MonitoringApiConnector,
  NetworkInterRackLink,
  NetworkTraceHop,
  NetworkTraceOverlay,
  NetworkUserNode,
  NetworkUserNodeKind,
  RackDesignConfig,
  RackDevice,
  RackPatchCable,
  RackPort,
  SpatialAsset,
} from '../types/twin';

type DesignerTab = 'live-map' | 'racks' | 'user-nodes' | 'topology' | 'builder' | 'monitoring';

type InspectedTarget =
  | { kind: 'rack'; rackId: string }
  | { kind: 'device'; rackId: string; deviceId: string }
  | { kind: 'port'; rackId: string; deviceId: string; portId: string }
  | { kind: 'user-node'; nodeId: string };

const DEFAULT_RACK_CONFIG: RackDesignConfig = {
  totalUnits: 42,
  rackRole: 'core-dc',
  locationZone: 'Main Data Center (MDF)',
  maxPowerKw: 12,
  coolingZone: 'Cold Aisle A1',
  subnetCidr: '10.42.10.0/24',
  devices: [
    {
      id: 'dev-sw-init',
      name: 'Core Nexus 9336C-FX2',
      kind: 'switch',
      tier: 'core',
      uStart: 41,
      uHeight: 2,
      powerW: 520,
      ipAddress: '10.42.10.1',
      macAddress: '00:1B:54:A1:00:01',
      serialNumber: 'FDO26180A9C',
      vlan: 'VLAN-10-OT',
      vendor: 'Cisco',
      model: 'Nexus 9336C-FX2',
      status: 'online',
      cpuPct: 24,
      tempC: 36,
      ports: [
        { id: 'p-1', label: 'Eth1/1', kind: 'QSFP28', speedGbps: 40, vlan: 'TRUNK-IDF', status: 'up', isUplink: true, utilizationPct: 48, crcErrors: 0, opticalDbm: -2.1 },
        { id: 'p-2', label: 'Eth1/2', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up', isUplink: true, utilizationPct: 32, crcErrors: 0, opticalDbm: -2.8 },
        { id: 'p-3', label: 'Eth1/3', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-30-EMS', status: 'up', utilizationPct: 18, crcErrors: 0 },
        { id: 'p-4', label: 'Eth1/4', kind: 'QSFP28', speedGbps: 100, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true, utilizationPct: 55, crcErrors: 0, opticalDbm: -1.9 },
      ],
    },
    {
      id: 'dev-srv-init',
      name: 'GMP Historian Server 01',
      kind: 'server',
      tier: 'compute',
      uStart: 35,
      uHeight: 2,
      powerW: 780,
      ipAddress: '10.42.10.21',
      macAddress: 'D0:94:66:4B:11:20',
      serialNumber: 'CN-R760-001',
      vlan: 'VLAN-20-SCADA',
      vendor: 'Dell EMC',
      model: 'PowerEdge R760',
      status: 'online',
      cpuPct: 42,
      tempC: 41,
      ports: [
        { id: 's-1', label: 'NIC1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up', utilizationPct: 37, crcErrors: 0 },
        { id: 's-2', label: 'iDRAC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up', utilizationPct: 4, crcErrors: 0 },
      ],
    },
  ],
  cables: [
    {
      id: 'cab-init-1',
      fromDeviceId: 'dev-sw-init',
      fromPortId: 'p-2',
      toDeviceId: 'dev-srv-init',
      toPortId: 's-1',
      media: 'OM4 Fiber',
      vlan: 'VLAN-20-SCADA',
      color: '#06B6D4',
      label: 'HIST-10G-PRIMARY',
    },
  ],
};

const DEVICE_PRESETS: {
  key: string;
  kind: RackDevice['kind'];
  tier: NonNullable<RackDevice['tier']>;
  label: string;
  uHeight: number;
  powerW: number;
  vendor: string;
  model: string;
  color: string;
  defaultPorts: Omit<RackPort, 'id'>[];
}[] = [
  {
    key: 'cisco-2960x',
    kind: 'switch',
    tier: 'access',
    label: 'Cisco Catalyst 2960-X (Access)',
    uHeight: 1,
    powerW: 370,
    vendor: 'Cisco',
    model: 'Catalyst 2960-X 48FPS-L',
    color: '#14B8A6',
    defaultPorts: [
      { label: 'Gi1/0/1', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-10-OT', status: 'up', poeWatts: 15.4, utilizationPct: 24, crcErrors: 0 },
      { label: 'Gi1/0/2', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-10-OT', status: 'up', poeWatts: 12.2, utilizationPct: 19, crcErrors: 0 },
      { label: 'Gi1/0/3', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-40-CORP', status: 'up', poeWatts: 8.5, utilizationPct: 15, crcErrors: 0 },
      { label: 'Gi1/0/4', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-50-CCTV', status: 'standby', poeWatts: 0, utilizationPct: 0, crcErrors: 0 },
      { label: 'Te1/1/1', kind: 'SFP+', speedGbps: 10, vlan: 'TRUNK-DIST', status: 'up', isUplink: true, utilizationPct: 44, crcErrors: 0, opticalDbm: -2.4 },
      { label: 'Te1/1/2', kind: 'SFP+', speedGbps: 10, vlan: 'TRUNK-DIST', status: 'standby', isUplink: true, utilizationPct: 2, crcErrors: 0, opticalDbm: -3.1 },
    ],
  },
  {
    key: 'cisco-9300-dist',
    kind: 'switch',
    tier: 'distribution',
    label: 'Catalyst 9300-24S (Distribution)',
    uHeight: 1,
    powerW: 480,
    vendor: 'Cisco',
    model: 'Catalyst 9300-24S',
    color: '#3B82F6',
    defaultPorts: [
      { label: 'Te1/0/1', kind: 'SFP+', speedGbps: 10, vlan: 'TRUNK-2960', status: 'up', isUplink: false, utilizationPct: 38, crcErrors: 0, opticalDbm: -2.6 },
      { label: 'Te1/0/2', kind: 'SFP+', speedGbps: 10, vlan: 'TRUNK-2960', status: 'up', isUplink: false, utilizationPct: 28, crcErrors: 0, opticalDbm: -2.9 },
      { label: 'Fo1/1/1', kind: 'QSFP28', speedGbps: 40, vlan: 'TRUNK-CORE', status: 'up', isUplink: true, utilizationPct: 52, crcErrors: 0, opticalDbm: -2.0 },
      { label: 'Fo1/1/2', kind: 'QSFP28', speedGbps: 40, vlan: 'TRUNK-CORE', status: 'standby', isUplink: true, utilizationPct: 4, crcErrors: 0, opticalDbm: -2.3 },
    ],
  },
  {
    key: 'cisco-nexus-core',
    kind: 'switch',
    tier: 'core',
    label: 'Nexus 9336C-FX2 (Core Switch)',
    uHeight: 2,
    powerW: 620,
    vendor: 'Cisco',
    model: 'Nexus 9336C-FX2',
    color: '#06B6D4',
    defaultPorts: [
      { label: 'Eth1/1', kind: 'QSFP28', speedGbps: 40, vlan: 'TRUNK-IDF', status: 'up', isUplink: true, utilizationPct: 58, crcErrors: 0, opticalDbm: -1.8 },
      { label: 'Eth1/2', kind: 'QSFP28', speedGbps: 40, vlan: 'TRUNK-IDF', status: 'up', isUplink: true, utilizationPct: 44, crcErrors: 0, opticalDbm: -2.2 },
      { label: 'Eth1/3', kind: 'QSFP28', speedGbps: 100, vlan: 'CORE-FABRIC', status: 'up', isUplink: true, utilizationPct: 62, crcErrors: 0, opticalDbm: -1.5 },
      { label: 'Eth1/4', kind: 'QSFP28', speedGbps: 100, vlan: 'CORE-FABRIC', status: 'up', isUplink: true, utilizationPct: 47, crcErrors: 0, opticalDbm: -1.9 },
    ],
  },
  {
    key: 'dell-server',
    kind: 'server',
    tier: 'compute',
    label: '2U Compute Server',
    uHeight: 2,
    powerW: 820,
    vendor: 'Dell EMC',
    model: 'PowerEdge R760',
    color: '#6366F1',
    defaultPorts: [
      { label: 'NIC1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up', utilizationPct: 41, crcErrors: 0 },
      { label: 'NIC2', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'standby', utilizationPct: 2, crcErrors: 0 },
      { label: 'iDRAC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up', utilizationPct: 5, crcErrors: 0 },
    ],
  },
  {
    key: 'pa-firewall',
    kind: 'firewall',
    tier: 'security',
    label: '2U OT/IT Firewall',
    uHeight: 2,
    powerW: 390,
    vendor: 'Palo Alto',
    model: 'PA-3420',
    color: '#F59E0B',
    defaultPorts: [
      { label: 'WAN-1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-99-DMZ', status: 'up', isUplink: true, utilizationPct: 35, crcErrors: 0 },
      { label: 'LAN-OT', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-10-OT', status: 'up', isUplink: true, utilizationPct: 42, crcErrors: 0 },
    ],
  },
  {
    key: 'fiber-patch',
    kind: 'patch-panel',
    tier: 'distribution',
    label: '1U Fiber Patch Panel',
    uHeight: 1,
    powerW: 0,
    vendor: 'Panduit',
    model: 'Opticom 24-LC',
    color: '#0EA5E9',
    defaultPorts: [
      { label: 'LC-01', kind: 'Fiber-LC', speedGbps: 25, vlan: 'TRUNK-IDF', status: 'up', isUplink: true, utilizationPct: 30, crcErrors: 0, opticalDbm: -2.4 },
      { label: 'LC-02', kind: 'Fiber-LC', speedGbps: 25, vlan: 'TRUNK-IDF', status: 'up', isUplink: true, utilizationPct: 26, crcErrors: 0, opticalDbm: -2.7 },
    ],
  },
  {
    key: 'ugreen-nas',
    kind: 'storage',
    tier: 'compute',
    label: '2U 4-Bay NAS Vault (DXP4800)',
    uHeight: 2,
    powerW: 340,
    vendor: 'UGREEN / TrueNAS',
    model: 'DXP4800 Enterprise',
    color: '#10B981',
    defaultPorts: [
      { label: '10G-ETH0', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-30-EMS', status: 'up', utilizationPct: 41, crcErrors: 0 },
      { label: '2.5G-MGMT', kind: 'RJ45', speedGbps: 2.5, vlan: 'VLAN-99-MGMT', status: 'up', utilizationPct: 9, crcErrors: 0 },
    ],
  },
  {
    key: 'proxmox-host',
    kind: 'server',
    tier: 'compute',
    label: '2U Proxmox VE Hypervisor',
    uHeight: 2,
    powerW: 760,
    vendor: 'Dell EMC',
    model: 'PowerEdge R760 (Proxmox)',
    color: '#06B6D4',
    defaultPorts: [
      { label: 'NIC1-10G', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up', utilizationPct: 48, crcErrors: 0 },
      { label: 'iDRAC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up', utilizationPct: 4, crcErrors: 0 },
    ],
  },
  {
    key: 'apc-ups',
    kind: 'ups',
    tier: 'power',
    label: '4U Rack UPS (6 kVA)',
    uHeight: 4,
    powerW: 320,
    vendor: 'APC',
    model: 'Smart-UPS SRT6KRM',
    color: '#EF4444',
    defaultPorts: [{ label: 'NMC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up', utilizationPct: 3, crcErrors: 0 }],
  },
];

const USER_NODE_PALETTE: {
  kind: NetworkUserNodeKind;
  label: string;
  short: string;
  color: string;
  defaultVlan: string;
  defaultPoe: number;
  defaultMedia: NetworkUserNode['media'];
}[] = [
  { kind: 'workstation', label: 'Workstation', short: 'WS', color: '#38BDF8', defaultVlan: 'VLAN-40-CORP', defaultPoe: 0, defaultMedia: 'Cat6A' },
  { kind: 'hmi-panel', label: 'Cleanroom HMI', short: 'HMI', color: '#8B5CF6', defaultVlan: 'VLAN-10-OT', defaultPoe: 15.4, defaultMedia: 'PoE++ Cat6A' },
  { kind: 'hplc-drop', label: 'HPLC / Lab Drop', short: 'LAB', color: '#10B981', defaultVlan: 'VLAN-30-QC', defaultPoe: 0, defaultMedia: 'Cat6A' },
  { kind: 'wifi-ap', label: 'Wi-Fi 6E AP', short: 'AP', color: '#06B6D4', defaultVlan: 'VLAN-60-WLAN', defaultPoe: 24.5, defaultMedia: 'PoE++ Cat6A' },
  { kind: 'ip-phone', label: 'IP Phone', short: 'VOIP', color: '#6366F1', defaultVlan: 'VLAN-45-VOICE', defaultPoe: 7.2, defaultMedia: 'Cat6A' },
  { kind: 'cctv-cam', label: 'CCTV PoE Cam', short: 'CAM', color: '#F59E0B', defaultVlan: 'VLAN-50-CCTV', defaultPoe: 18.6, defaultMedia: 'PoE++ Cat6A' },
  { kind: 'badge-reader', label: 'Badge Reader', short: 'ACS', color: '#EC4899', defaultVlan: 'VLAN-55-ACS', defaultPoe: 11.8, defaultMedia: 'PoE++ Cat6A' },
  { kind: 'iot-gateway', label: 'IoT Gateway', short: 'IOT', color: '#14B8A6', defaultVlan: 'VLAN-20-SCADA', defaultPoe: 12.0, defaultMedia: 'Cat6A' },
];

const KIND_COLOR: Record<RackDevice['kind'], string> = {
  server: '#6366F1',
  switch: '#14B8A6',
  router: '#3B82F6',
  firewall: '#F59E0B',
  'patch-panel': '#06B6D4',
  storage: '#10B981',
  ups: '#EF4444',
  pdu: '#F97316',
  scada: '#EC4899',
  kvm: '#64748B',
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function buildTrendSeries(
  seedKey: string,
  baseMbps: number,
  baseLatencyMs: number,
  baseErrors: number,
  tick: number
) {
  const h = hashSeed(seedKey);
  return Array.from({ length: 12 }, (_, idx) => {
    const wave = Math.sin((idx + tick * 0.45 + (h % 13)) * 0.72);
    const wave2 = Math.cos((idx + tick * 0.25 + (h % 7)) * 1.1);
    const mbps = Math.max(1, Math.round(baseMbps * (0.82 + wave * 0.16 + wave2 * 0.08)));
    const latency = Number(Math.max(0.2, baseLatencyMs * (0.9 + Math.abs(wave2) * 0.25)).toFixed(1));
    const errors =
      baseErrors > 0
        ? Math.max(0, Math.round((baseErrors / 6) * (0.4 + Math.max(0, wave))))
        : 0;
    return {
      t: `T-${(11 - idx) * 5}s`,
      mbps,
      latency,
      errors,
    };
  });
}

function getLedVisual(status: RackPort['status'], isUplink?: boolean, blinkPhase?: number) {
  const on = blinkPhase === undefined ? true : blinkPhase % 2 === 0;
  if (status === 'error') {
    return on ? 'bg-rose-500 shadow-[0_0_8px_#EF4444]' : 'bg-rose-950';
  }
  if (status === 'standby') {
    return 'bg-amber-400 shadow-[0_0_5px_#F59E0B]';
  }
  if (status === 'down') {
    return 'bg-zinc-600';
  }
  if (isUplink) {
    return on ? 'bg-cyan-400 shadow-[0_0_8px_#22D3EE]' : 'bg-cyan-700';
  }
  return on ? 'bg-emerald-400 shadow-[0_0_6px_#10B981]' : 'bg-emerald-700';
}

const NetworkRackDesignerView: React.FC<{ mode: 'modal' | 'page' }> = ({ mode }) => {
  const showNetworkRackModal = useTwinStore((s) => s.showNetworkRackModal);
  const closeRackDesigner = useTwinStore((s) => s.closeRackDesigner);
  const setScreen = useTwinStore((s) => s.setScreen);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const setCategoryFilter = useTwinStore((s) => s.setCategoryFilter);
  const drillInto = useTwinStore((s) => s.drillInto);
  const activeRackAssetId = useTwinStore((s) => s.activeRackAssetId);
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const workspaceMode = useTwinStore((s) => s.workspaceMode);
  const setWorkspaceMode = useTwinStore((s) => s.setWorkspaceMode);
  const updateAsset = useTwinStore((s) => s.updateAsset);
  const addNetworkUserNode = useTwinStore((s) => s.addNetworkUserNode);
  const updateNetworkUserNode = useTwinStore((s) => s.updateNetworkUserNode);
  const deleteNetworkUserNode = useTwinStore((s) => s.deleteNetworkUserNode);
  const addInterRackLink = useTwinStore((s) => s.addInterRackLink);
  const deleteInterRackLink = useTwinStore((s) => s.deleteInterRackLink);
  const upsertMonitoringConnector = useTwinStore((s) => s.upsertMonitoringConnector);
  const deleteMonitoringConnector = useTwinStore((s) => s.deleteMonitoringConnector);
  const addDistributionRackToRoom = useTwinStore((s) => s.addDistributionRackToRoom);
  const startNetworkTrace = useTwinStore((s) => s.startNetworkTrace);
  const showToast = useTwinStore((s) => s.showToast);

  const openQrLabelModal = useGmpStore((s) => s.openQrLabelModal);

  const aclUsers = useAclStore((s) => s.users);
  const aclRoles = useAclStore((s) => s.roles);
  const aclGroups = useAclStore((s) => s.groups);
  const activeAclUserId = useAclStore((s) => s.activeAclUserId);

  const aclCanEdit = useMemo(() => {
    const u = getActiveAclUser({ users: aclUsers, activeAclUserId });
    if (!u) return true;
    if (u.status === 'suspended') return false;
    return computeEffectivePermissions(u, aclRoles, aclGroups).includes('spatial.edit');
  }, [aclUsers, aclRoles, aclGroups, activeAclUserId]);

  const isReadOnly = workspaceMode === 'view' || !aclCanEdit;
  const isVisible = mode === 'page' ? true : showNetworkRackModal;

  const itAssets = useMemo(
    () =>
      scene.assets.filter(
        (a) =>
          a.category === 'IT & Data Center' ||
          a.rackConfig ||
          ['server-rack', 'network-rack', 'patch-cabinet', 'pdu-cabinet', 'ups-tower', 'scada-console'].includes(
            a.archetype
          )
      ),
    [scene.assets]
  );

  const coreRacks = useMemo(
    () => itAssets.filter((a) => a.rackConfig?.rackRole === 'core-dc'),
    [itAssets]
  );
  const idfRacks = useMemo(
    () => itAssets.filter((a) => a.rackConfig?.rackRole !== 'core-dc'),
    [itAssets]
  );

  const netArch = scene.networkArchitecture ?? {
    userNodes: [],
    interRackLinks: [],
    monitoringApis: [],
  };

  // UI Navigation State
  const [activeTab, setActiveTab] = useState<DesignerTab>('live-map');
  const [showInspectorPane, setShowInspectorPane] = useState<boolean>(true);
  const [viewDim, setViewDim] = useState<'2d' | '3d'>('2d');
  const [rackFace, setRackFace] = useState<'front' | 'rear'>('front');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [inspected, setInspected] = useState<InspectedTarget | null>(null);
  const [mobilePane, setMobilePane] = useState<'workspace' | 'inspector'>('workspace');
  const [labelToPrint, setLabelToPrint] = useState<ItLabelPayload | null>(null);
  const [detail3DTarget, setDetail3DTarget] = useState<It3DDetailTarget | null>(null);
  const [blinkTick, setBlinkTick] = useState(0);
  const [hoverTip, setHoverTip] = useState<{
    x: number;
    y: number;
    title: string;
    badge: string;
    badgeTone: 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose' | 'blue';
    subtitle?: string;
    rows: { label: string; value: string }[];
    hint?: string;
  } | null>(null);

  useEffect(() => {
    setHoverTip(null);
  }, [activeTab, viewDim]);

  // Provision IDF / Core Rack Modal
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [provFloorId, setProvFloorId] = useState<string>(activeFloorId || scene.floors[0]?.id || '');
  const [provRoomId, setProvRoomId] = useState<string>('');
  const [provRackName, setProvRackName] = useState('Floor IDF Distribution Rack');
  const [provRole, setProvRole] = useState<'distribution-idf' | 'core-dc' | 'access-closet'>('distribution-idf');

  // Patch Cable Creator
  const [cableFromDev, setCableFromDev] = useState('');
  const [cableFromPort, setCableFromPort] = useState('');
  const [cableToDev, setCableToDev] = useState('');
  const [cableToPort, setCableToPort] = useState('');
  const [cableMedia, setCableMedia] = useState<RackPatchCable['media']>('OM4 Fiber');

  // User Node Floor Designer State
  const [nodeFloorId, setNodeFloorId] = useState<string>(activeFloorId || scene.floors[0]?.id || '');
  const [placingNodeKind, setPlacingNodeKind] = useState<NetworkUserNodeKind | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const floorSvgRef = useRef<SVGSVGElement | null>(null);

  // Inter-Rack Uplink Creator State
  const [uplinkFromRack, setUplinkFromRack] = useState('');
  const [uplinkToRack, setUplinkToRack] = useState('');
  const [uplinkMedia, setUplinkMedia] = useState<NetworkInterRackLink['media']>('OM4 Fiber');
  const [uplinkSpeed, setUplinkSpeed] = useState<number>(40);

  // Monitoring API Form State
  const [newApiName, setNewApiName] = useState('');
  const [newApiProvider, setNewApiProvider] = useState<MonitoringApiConnector['provider']>('Prometheus');
  const [newApiUrl, setNewApiUrl] = useState('https://monitor.facility.local/api/v1');
  const [testingApiId, setTestingApiId] = useState<string | null>(null);

  // Live blinking activity ticker (450ms realistic switch LED blink cadence)
  useEffect(() => {
    if (!isVisible) return;
    const id = window.setInterval(() => setBlinkTick((t) => (t + 1) % 60), 450);
    return () => window.clearInterval(id);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    if (activeRackAssetId && itAssets.some((a) => a.id === activeRackAssetId)) {
      setSelectedAssetId(activeRackAssetId);
    } else if (!selectedAssetId || !itAssets.some((a) => a.id === selectedAssetId)) {
      setSelectedAssetId(itAssets[0]?.id ?? '');
    }
  }, [isVisible, activeRackAssetId, itAssets, selectedAssetId]);

  useEffect(() => {
    if (!nodeFloorId || !scene.floors.some((f) => f.id === nodeFloorId)) {
      setNodeFloorId(activeFloorId || scene.floors[0]?.id || '');
    }
  }, [scene.floors, activeFloorId, nodeFloorId]);

  const activeAsset = itAssets.find((a) => a.id === selectedAssetId) ?? itAssets[0] ?? null;

  const rackConfig: RackDesignConfig = useMemo(() => {
    if (!activeAsset) return DEFAULT_RACK_CONFIG;
    return activeAsset.rackConfig ?? structuredClone(DEFAULT_RACK_CONFIG);
  }, [activeAsset]);

  // Default inspector target when rack changes
  useEffect(() => {
    if (!inspected && activeAsset) {
      const firstDev = activeAsset.rackConfig?.devices[0];
      if (firstDev) {
        setInspected({ kind: 'device', rackId: activeAsset.id, deviceId: firstDev.id });
      } else {
        setInspected({ kind: 'rack', rackId: activeAsset.id });
      }
    }
  }, [activeAsset, inspected]);

  // Helper lookups
  const getFloorById = (fid?: string) => scene.floors.find((f) => f.id === fid);
  const getRoomById = (rid?: string) => scene.rooms.find((r) => r.id === rid);
  const getRackById = (rid?: string) => itAssets.find((a) => a.id === rid);

  // Unified inspect + reveal helper so clicking any object in 3-Tier, 3D, or 2D always navigates cleanly
  const [topologyBuildingFilter, setTopologyBuildingFilter] = useState<string>('all');
  const handleInspectAndReveal = (target: InspectedTarget, openMobileInspector = true) => {
    setInspected(target);
    if (target.kind === 'rack' || target.kind === 'device' || target.kind === 'port') {
      setSelectedAssetId(target.rackId);
    }
    setShowInspectorPane(true);
    if (openMobileInspector && typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobilePane('inspector');
    }
  };

  const handleLocateObjectIn3DTwin = (opts: { buildingId?: string; floorId?: string; rackId?: string; nodeId?: string }) => {
    setCategoryFilter('IT');
    setViewMode('3d-perspective');
    setScreen('workspace');
    closeRackDesigner();
    const twin = useTwinStore.getState();
    if (opts.rackId) {
      drillInto('asset', opts.rackId);
      twin.selectEntity({ type: 'asset', id: opts.rackId });
      showToast('Focused IT rack in 3D Digital Twin', 'info');
    } else if (opts.floorId) {
      twin.setShowAllFloors(false);
      twin.setActiveFloor(opts.floorId);
      drillInto('floor', opts.floorId);
      showToast('Navigated to floor in 3D Digital Twin', 'info');
    } else if (opts.buildingId) {
      drillInto('building', opts.buildingId);
      twin.setShowAllFloors(true);
      showToast('Navigated to building in 3D Digital Twin', 'info');
    }
  };

  // Resolve full 3-tier uplink path for any User Node: User Node -> 2960 Access -> IDF Dist -> Core DC
  const resolveNodePath = (node: NetworkUserNode) => {
    const accessRack = getRackById(node.connectedRackId);
    const accessDev = accessRack?.rackConfig?.devices.find((d) => d.id === node.connectedDeviceId);
    const accessPort = accessDev?.ports.find((p) => p.id === node.connectedPortId);
    const distDev =
      accessRack?.rackConfig?.devices.find((d) => d.tier === 'distribution' && d.id !== accessDev?.id) ??
      accessRack?.rackConfig?.devices.find((d) => d.tier === 'distribution');
    const trunkToCore = netArch.interRackLinks.find(
      (l) => l.fromRackId === node.connectedRackId || l.toRackId === node.connectedRackId
    );
    const coreRackId = trunkToCore
      ? trunkToCore.fromRackId === node.connectedRackId
        ? trunkToCore.toRackId
        : trunkToCore.fromRackId
      : coreRacks[0]?.id;
    const coreRack = getRackById(coreRackId);
    const coreDev =
      coreRack?.rackConfig?.devices.find((d) => d.tier === 'core') ?? coreRack?.rackConfig?.devices[0];

    return {
      accessRack,
      accessDev,
      accessPort,
      distDev,
      trunkToCore,
      coreRack,
      coreDev,
      summary: `${node.wallJackId} → ${accessDev?.model ?? 'Catalyst 2960-X'} [${accessPort?.label ?? 'Gi1/0/1'}] → ${distDev?.name ?? accessRack?.assetId ?? 'IDF'} → ${coreDev?.name ?? coreRack?.assetId ?? 'DC-Core'}`,
    };
  };

  if (!isVisible) return null;

  const commitRackConfig = (nextConfig: RackDesignConfig, targetRackId?: string) => {
    if (isReadOnly) {
      showToast('Editing locked in View Mode / Read-Only ACL.', 'warning');
      return;
    }
    const id = targetRackId ?? activeAsset?.id;
    if (!id) return;
    updateAsset(id, { rackConfig: nextConfig });
  };

  const handleProvisionRack = () => {
    if (isReadOnly) return;
    const created = addDistributionRackToRoom(
      provFloorId || scene.floors[0]?.id,
      provRoomId || undefined,
      provRackName.trim() || 'Distribution IDF Rack',
      provRole
    );
    if (created) {
      setSelectedAssetId(created.id);
      setInspected({ kind: 'rack', rackId: created.id });
      setShowProvisionModal(false);
    }
  };

  const findFreeUSlot = (uHeight: number): number => {
    const occupied = new Set<number>();
    rackConfig.devices.forEach((d) => {
      for (let u = d.uStart; u < d.uStart + d.uHeight; u++) occupied.add(u);
    });
    for (let u = rackConfig.totalUnits - uHeight + 1; u >= 1; u--) {
      let ok = true;
      for (let k = u; k < u + uHeight; k++) {
        if (occupied.has(k)) {
          ok = false;
          break;
        }
      }
      if (ok) return u;
    }
    return 1;
  };

  const handleAddDevice = (preset: (typeof DEVICE_PRESETS)[number]) => {
    if (isReadOnly || !activeAsset) return;
    const uStart = findFreeUSlot(preset.uHeight);
    const id = `dev-${Date.now()}`;
    const oct = 30 + rackConfig.devices.length;
    const newDev: RackDevice = {
      id,
      name: `${preset.label.split(' (')[0]} #${rackConfig.devices.length + 1}`,
      kind: preset.kind,
      tier: preset.tier,
      uStart,
      uHeight: preset.uHeight,
      powerW: preset.powerW,
      ipAddress: `10.42.10.${oct}`,
      macAddress: `00:1B:54:${String(oct).padStart(2, '0')}:4C:A1`,
      serialNumber: `SN-${preset.vendor.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}`,
      vlan: 'VLAN-10-OT',
      vendor: preset.vendor,
      model: preset.model,
      status: 'online',
      cpuPct: 18,
      memPct: 34,
      diskPct: preset.kind === 'storage' ? 62 : undefined,
      tempC: 34,
      uptimeLabel: '0d 1h',
      hypervisorVersion: preset.key === 'proxmox-host' ? 'Proxmox VE 9.2.24' : undefined,
      driveBays:
        preset.kind === 'storage'
          ? [
              { id: `${id}-b1`, slot: 1, label: 'NVMe-01', capacityLabel: '3.6 TiB', tempC: 39, health: 'healthy', usedPct: 62 },
              { id: `${id}-b2`, slot: 2, label: 'NVMe-02', capacityLabel: '3.6 TiB', tempC: 38, health: 'healthy', usedPct: 60 },
              { id: `${id}-b3`, slot: 3, label: 'NVMe-03', capacityLabel: '3.6 TiB', tempC: 40, health: 'healthy', usedPct: 64 },
              { id: `${id}-b4`, slot: 4, label: 'NVMe-04', capacityLabel: '3.6 TiB', tempC: 37, health: 'healthy', usedPct: 61 },
            ]
          : undefined,
      workloads:
        preset.key === 'proxmox-host'
          ? [
              { id: `${id}-w1`, vmid: 'VM 201', name: 'gmp-app-node', kind: 'VM', hostTag: 'GMP-OT', status: 'up', cpuPct: 32, memPct: 54 },
              { id: `${id}-w2`, vmid: 'CT 202', name: 'telemetry-gw', kind: 'CT', hostTag: 'SCADA', status: 'up', cpuPct: 18, memPct: 36 },
            ]
          : undefined,
      ports: preset.defaultPorts.map((p, i) => ({ ...p, id: `${id}-p${i + 1}` })),
    };
    commitRackConfig({ ...rackConfig, devices: [...rackConfig.devices, newDev] });
    setInspected({ kind: 'device', rackId: activeAsset.id, deviceId: id });
  };

  const handleMoveDeviceU = (rackId: string, devId: string, delta: number) => {
    const rack = getRackById(rackId);
    const cfg = rack?.rackConfig;
    if (!cfg || isReadOnly) return;
    const nextDevs = cfg.devices.map((d) => {
      if (d.id !== devId) return d;
      const nextU = Math.max(1, Math.min(cfg.totalUnits - d.uHeight + 1, d.uStart + delta));
      return { ...d, uStart: nextU };
    });
    commitRackConfig({ ...cfg, devices: nextDevs }, rackId);
  };

  const handleDeleteDevice = (rackId: string, devId: string) => {
    const rack = getRackById(rackId);
    const cfg = rack?.rackConfig;
    if (!cfg || isReadOnly) return;
    commitRackConfig(
      {
        ...cfg,
        devices: cfg.devices.filter((d) => d.id !== devId),
        cables: cfg.cables.filter((c) => c.fromDeviceId !== devId && c.toDeviceId !== devId),
      },
      rackId
    );
    setInspected({ kind: 'rack', rackId });
  };

  const handleAddPort = (rackId: string, devId: string) => {
    const rack = getRackById(rackId);
    const cfg = rack?.rackConfig;
    if (!cfg || isReadOnly) return;
    const nextDevs = cfg.devices.map((d) => {
      if (d.id !== devId) return d;
      const idx = d.ports.length + 1;
      const newPort: RackPort = {
        id: `${devId}-p-${Date.now()}`,
        label: d.kind === 'switch' ? `Gi1/0/${idx}` : `Port-${idx}`,
        kind: d.kind === 'patch-panel' ? 'Fiber-LC' : d.tier === 'access' ? 'RJ45' : 'SFP+',
        speedGbps: d.tier === 'access' ? 1 : 10,
        vlan: d.vlan,
        status: 'up',
        utilizationPct: 12,
        crcErrors: 0,
      };
      return { ...d, ports: [...d.ports, newPort] };
    });
    commitRackConfig({ ...cfg, devices: nextDevs }, rackId);
  };

  const handleUpdatePort = (rackId: string, devId: string, portId: string, patch: Partial<RackPort>) => {
    const rack = getRackById(rackId);
    const cfg = rack?.rackConfig;
    if (!cfg || isReadOnly) return;
    commitRackConfig(
      {
        ...cfg,
        devices: cfg.devices.map((d) =>
          d.id !== devId
            ? d
            : { ...d, ports: d.ports.map((p) => (p.id === portId ? { ...p, ...patch } : p)) }
        ),
      },
      rackId
    );
  };

  const handleAddPatchCable = () => {
    if (isReadOnly) return;
    if (!cableFromDev || !cableFromPort || !cableToDev || !cableToPort) {
      showToast('Select both source and destination device + port.', 'warning');
      return;
    }
    const mediaColor: Record<RackPatchCable['media'], string> = {
      Cat6A: '#F59E0B',
      'OM4 Fiber': '#06B6D4',
      'OS2 Single-Mode': '#EAB308',
      'DAC Twinax': '#8B5CF6',
      Power: '#EF4444',
    };
    const cable: RackPatchCable = {
      id: `cab-${Date.now()}`,
      fromDeviceId: cableFromDev,
      fromPortId: cableFromPort,
      toDeviceId: cableToDev,
      toPortId: cableToPort,
      media: cableMedia,
      vlan: 'TRUNK',
      color: mediaColor[cableMedia],
      label: `${cableMedia.split(' ')[0].toUpperCase()}-${rackConfig.cables.length + 1}`,
    };
    commitRackConfig({ ...rackConfig, cables: [...rackConfig.cables, cable] });
    showToast('Connected patch cable in rack matrix', 'success');
  };

  const handleAddInterRackUplink = () => {
    if (isReadOnly) return;
    if (!uplinkFromRack || !uplinkToRack || uplinkFromRack === uplinkToRack) {
      showToast('Choose two different racks to connect an uplink fiber trunk.', 'warning');
      return;
    }
    const rFrom = getRackById(uplinkFromRack);
    const rTo = getRackById(uplinkToRack);
    if (!rFrom || !rTo) return;
    const fromDev =
      rFrom.rackConfig?.devices.find((d) => d.tier === 'distribution' || d.kind === 'switch') ??
      rFrom.rackConfig?.devices[0];
    const toDev =
      rTo.rackConfig?.devices.find((d) => d.tier === 'core' || d.kind === 'switch') ??
      rTo.rackConfig?.devices[0];
    const fromPort = fromDev?.ports.find((p) => p.isUplink) ?? fromDev?.ports[0];
    const toPort = toDev?.ports.find((p) => p.isUplink) ?? toDev?.ports[0];
    addInterRackLink({
      label: `${rFrom.assetId} ⇄ ${rTo.assetId} (${uplinkSpeed}G)`,
      tier: rTo.rackConfig?.rackRole === 'core-dc' ? 'dist-to-core' : 'access-to-dist',
      fromRackId: rFrom.id,
      fromDeviceId: fromDev?.id ?? 'dev-from',
      fromPortId: fromPort?.id ?? 'p-from',
      toRackId: rTo.id,
      toDeviceId: toDev?.id ?? 'dev-to',
      toPortId: toPort?.id ?? 'p-to',
      media: uplinkMedia,
      speedGbps: uplinkSpeed,
      vlanTrunk: 'VLAN 10,20,30,40,50,99',
      status: 'up',
      utilizationPct: 34,
      opticalRxDbm: -2.1,
      crcErrors: 0,
    });
  };

  const handleGoTo3DTwin = () => {
    setCategoryFilter('IT');
    setViewMode('3d-perspective');
    setScreen('workspace');
    closeRackDesigner();
    if (activeAsset) {
      drillInto('asset', activeAsset.id);
    }
    showToast('Switched to 3D Digital Twin with IT X-Ray Focus active', 'info');
  };

  const handleBackAction = () => {
    if (mode === 'page') setScreen('hub');
    else closeRackDesigner();
  };

  // Floor Plan User Node placement & drag helpers
  const activeNodeFloor = getFloorById(nodeFloorId) ?? scene.floors[0];
  const floorRooms = scene.rooms.filter((r) => r.floorId === activeNodeFloor?.id);
  const floorRacks = itAssets.filter((a) => a.floorId === activeNodeFloor?.id);
  const floorUserNodes = netArch.userNodes.filter((n) => n.floorId === activeNodeFloor?.id);

  const clientToFloorMeters = (clientX: number, clientY: number) => {
    const svg = floorSvgRef.current;
    if (!svg || !activeNodeFloor) return { x: 4, z: 4 };
    const rect = svg.getBoundingClientRect();
    const vbW = activeNodeFloor.width + 4;
    const vbH = activeNodeFloor.depth + 4;
    const mx = ((clientX - rect.left) / Math.max(1, rect.width)) * vbW - 2;
    const mz = ((clientY - rect.top) / Math.max(1, rect.height)) * vbH - 2;
    return {
      x: Number(Math.max(0.5, Math.min(activeNodeFloor.width - 0.5, mx)).toFixed(2)),
      z: Number(Math.max(0.5, Math.min(activeNodeFloor.depth - 0.5, mz)).toFixed(2)),
    };
  };

  const handleFloorPlanClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isReadOnly || !placingNodeKind || !activeNodeFloor) return;
    const pt = clientToFloorMeters(e.clientX, e.clientY);
    const containingRoom = floorRooms.find(
      (r) => pt.x >= r.x && pt.x <= r.x + r.width && pt.z >= r.z && pt.z <= r.z + r.depth
    );
    const pal = USER_NODE_PALETTE.find((p) => p.kind === placingNodeKind) ?? USER_NODE_PALETTE[0];
    // Pick nearest rack on this floor (preferring IDF with a 2960-X / access switch) or fallback to any IDF/IT rack
    const candidateRack =
      floorRacks.find((r) => r.rackConfig?.devices.some((d) => d.tier === 'access')) ??
      floorRacks[0] ??
      idfRacks[0] ??
      itAssets[0];
    const accessSwitch =
      candidateRack?.rackConfig?.devices.find((d) => d.tier === 'access') ??
      candidateRack?.rackConfig?.devices.find((d) => d.kind === 'switch') ??
      candidateRack?.rackConfig?.devices[0];
    const usedPortIds = new Set(netArch.userNodes.map((n) => n.connectedPortId));
    const freePort =
      accessSwitch?.ports.find((p) => !p.isUplink && !usedPortIds.has(p.id)) ??
      accessSwitch?.ports[0];

    const idxNum = netArch.userNodes.length + 1;
    const created = addNetworkUserNode({
      code: `${pal.short}-${activeNodeFloor.code.replace('-', '')}-${String(idxNum).padStart(2, '0')}`,
      name: `${pal.label} (${containingRoom?.code ?? activeNodeFloor.code})`,
      nodeKind: placingNodeKind,
      floorId: activeNodeFloor.id,
      roomId: containingRoom?.id,
      x: pt.x,
      z: pt.z,
      wallJackId: `WJ-${activeNodeFloor.code}-${String(idxNum).padStart(2, '0')}A`,
      ipAddress: `10.42.${40 + (idxNum % 20)}.${100 + idxNum}`,
      macAddress: `3C:22:FB:18:${String((idxNum * 7) % 90 + 10)}:${String((idxNum * 13) % 89 + 10)}`,
      vlan: pal.defaultVlan,
      poeWatts: pal.defaultPoe,
      connectedRackId: candidateRack?.id ?? '',
      connectedDeviceId: accessSwitch?.id ?? '',
      connectedPortId: freePort?.id ?? '',
      media: pal.defaultMedia,
      status: 'online',
      bandwidthMbps: pal.kind === 'wifi-ap' ? 680 : pal.kind === 'workstation' ? 320 : 120,
      latencyMs: 0.9,
      packetLossPct: 0,
      crcErrors: 0,
      notes: `Wired to ${accessSwitch?.model ?? 'Cisco Catalyst 2960-X'} in ${candidateRack?.assetId ?? 'IDF'}`,
    });
    if (created) {
      setInspected({ kind: 'user-node', nodeId: created.id });
      setPlacingNodeKind(null);
    }
  };

  // KPIs & Alert Counters
  const totalPowerKw = rackConfig.devices.reduce((s, d) => s + (d.powerW || 0), 0) / 1000;
  const powerPct = Math.min(100, Math.round((totalPowerKw / Math.max(1, rackConfig.maxPowerKw)) * 100));
  const usedUnits = rackConfig.devices.reduce((s, d) => s + d.uHeight, 0);
  const thermalBtu = Math.round(totalPowerKw * 3412.14);

  const totalFacilityKw = itAssets.reduce(
    (sum, a) => sum + (a.rackConfig?.devices.reduce((s, d) => s + (d.powerW || 0), 0) ?? a.energyKw * 1000) / 1000,
    0
  );
  const totalLivePorts = useMemo(() => {
    let count = 0;
    itAssets.forEach((r) => r.rackConfig?.devices.forEach((d) => (count += d.ports.length)));
    return count;
  }, [itAssets]);

  const totalErrors = useMemo(() => {
    let errs = 0;
    itAssets.forEach((r) =>
      r.rackConfig?.devices.forEach((d) => {
        if (d.status === 'offline') errs++;
        d.ports.forEach((p) => {
          if (p.status === 'error' || p.status === 'down' || (p.crcErrors ?? 0) > 0) errs++;
        });
      })
    );
    netArch.userNodes.forEach((n) => {
      if (n.status === 'error' || n.status === 'degraded' || n.crcErrors > 0) errs++;
    });
    netArch.interRackLinks.forEach((l) => {
      if (l.status !== 'up' || l.crcErrors > 0) errs++;
    });
    return errs;
  }, [itAssets, netArch]);

  // Build U-slot map for active rack
  const slotOwnerMap = new Map<number, RackDevice[]>();
  rackConfig.devices.forEach((d) => {
    for (let u = d.uStart; u < d.uStart + d.uHeight; u++) {
      const arr = slotOwnerMap.get(u) ?? [];
      arr.push(d);
      slotOwnerMap.set(u, arr);
    }
  });

  const fromDeviceObj = rackConfig.devices.find((d) => d.id === cableFromDev);
  const toDeviceObj = rackConfig.devices.find((d) => d.id === cableToDev);

  // Build Universal Inspector Data + Label Payload for currently clicked object (Rack / Device / Port / User Node)
  const inspectedContext = useMemo(() => {
    if (!inspected) return null;

    if (inspected.kind === 'user-node') {
      const node = netArch.userNodes.find((n) => n.id === inspected.nodeId);
      if (!node) return null;
      const fl = getFloorById(node.floorId);
      const rm = getRoomById(node.roomId);
      const path = resolveNodePath(node);
      const trend = buildTrendSeries(node.id, node.bandwidthMbps || 140, node.latencyMs || 1.2, node.crcErrors, blinkTick);
      const labelPayload: ItLabelPayload = {
        kind: 'user-node',
        code: node.code,
        title: node.name,
        subtitle: `${node.nodeKind.toUpperCase()} · ${node.media} · PoE ${node.poeWatts}W`,
        location: `${fl?.code ?? 'FL'} · ${rm ? `${rm.code} ${rm.name}` : 'Open Area'} · ${node.wallJackId}`,
        ipOrVlan: `${node.ipAddress} · ${node.vlan}`,
        uplinkPath: path.summary,
        serialOrMac: `MAC ${node.macAddress}`,
        statusLabel: node.status,
        rackAssetId: node.connectedRackId || undefined,
      };
      return { kind: 'user-node' as const, node, floor: fl, room: rm, path, trend, labelPayload };
    }

    if (inspected.kind === 'port') {
      const rack = getRackById(inspected.rackId);
      const dev = rack?.rackConfig?.devices.find((d) => d.id === inspected.deviceId);
      const port = dev?.ports.find((p) => p.id === inspected.portId);
      if (!rack || !dev || !port) return null;
      const fl = getFloorById(rack.floorId);
      const rm = getRoomById(rack.roomId);
      const connectedNode = netArch.userNodes.find((n) => n.connectedPortId === port.id);
      const connectedTrunk = netArch.interRackLinks.find(
        (l) => l.fromPortId === port.id || l.toPortId === port.id
      );
      const mbps = Math.max(20, Math.round((port.utilizationPct ?? 24) * port.speedGbps * 10));
      const trend = buildTrendSeries(port.id, mbps, port.status === 'error' ? 18.4 : 0.7, port.crcErrors ?? 0, blinkTick);
      const uplinkPath = connectedNode
        ? `Access Port → ${connectedNode.code} (${connectedNode.wallJackId})`
        : connectedTrunk
          ? `Fiber Trunk → ${connectedTrunk.label}`
          : port.connectedToLabel || `${rack.assetId} / U${dev.uStart} ${dev.name}`;
      const labelPayload: ItLabelPayload = {
        kind: 'port',
        code: `${rack.assetId}-${port.label}`,
        title: `${dev.name} · ${port.label}`,
        subtitle: `${port.kind} ${port.speedGbps}G${port.isUplink ? ' UPLINK' : ' ACCESS'}`,
        location: `${fl?.code ?? 'FL'} · ${rm?.code ?? rack.rackConfig?.locationZone ?? 'IDF'} · U${dev.uStart}`,
        ipOrVlan: `${dev.ipAddress} · ${port.vlan}`,
        uplinkPath,
        serialOrMac: `${dev.vendor} ${dev.model}`,
        statusLabel: port.status,
        rackAssetId: rack.id,
      };
      return {
        kind: 'port' as const,
        rack,
        dev,
        port,
        floor: fl,
        room: rm,
        connectedNode,
        connectedTrunk,
        trend,
        labelPayload,
      };
    }

    if (inspected.kind === 'device') {
      const rack = getRackById(inspected.rackId);
      const dev = rack?.rackConfig?.devices.find((d) => d.id === inspected.deviceId);
      if (!rack || !dev) return null;
      const fl = getFloorById(rack.floorId);
      const rm = getRoomById(rack.roomId);
      const crcSum = dev.ports.reduce((s, p) => s + (p.crcErrors ?? 0), 0);
      const errPorts = dev.ports.filter((p) => p.status === 'error' || (p.crcErrors ?? 0) > 0);
      const avgUtil = dev.ports.length
        ? Math.round(dev.ports.reduce((s, p) => s + (p.utilizationPct ?? 20), 0) / dev.ports.length)
        : 22;
      const trend = buildTrendSeries(dev.id, Math.max(80, avgUtil * 45), errPorts.length > 0 ? 4.8 : 0.6, crcSum, blinkTick);
      const trunk = netArch.interRackLinks.find((l) => l.fromRackId === rack.id || l.toRackId === rack.id);
      const labelPayload: ItLabelPayload = {
        kind: 'device',
        code: `${rack.assetId}-U${dev.uStart}`,
        title: dev.name,
        subtitle: `${dev.vendor} ${dev.model} · ${(dev.tier ?? dev.kind).toUpperCase()}`,
        location: `${fl?.code ?? 'FL'} · ${rm?.code ?? rack.rackConfig?.locationZone ?? 'DC'} · ${rack.assetId} U${dev.uStart}`,
        ipOrVlan: `${dev.ipAddress} · ${dev.vlan}`,
        uplinkPath: trunk ? trunk.label : `${rack.assetId} (${rack.rackConfig?.subnetCidr ?? '10.42.0.0/16'})`,
        serialOrMac: `${dev.serialNumber ?? 'SN-N/A'} · ${dev.macAddress ?? ''}`,
        statusLabel: dev.status,
        rackAssetId: rack.id,
      };
      return { kind: 'device' as const, rack, dev, floor: fl, room: rm, crcSum, errPorts, trend, labelPayload };
    }

    // Rack target
    const rack = getRackById(inspected.rackId);
    if (!rack) return null;
    const fl = getFloorById(rack.floorId);
    const rm = getRoomById(rack.roomId);
    const cfg = rack.rackConfig ?? DEFAULT_RACK_CONFIG;
    const crcSum = cfg.devices.reduce(
      (s, d) => s + d.ports.reduce((ps, p) => ps + (p.crcErrors ?? 0), 0),
      0
    );
    const trend = buildTrendSeries(rack.id, 1850, 0.8, crcSum, blinkTick);
    const labelPayload: ItLabelPayload = {
      kind: 'rack',
      code: rack.assetId,
      title: rack.name,
      subtitle: `${cfg.totalUnits}U · ${cfg.rackRole === 'core-dc' ? 'CORE DATA CENTER MDF' : 'FLOOR DISTRIBUTION IDF'}`,
      location: `${fl?.code ?? 'FL'} · ${rm ? `${rm.code} ${rm.name}` : cfg.locationZone ?? 'Telecom Room'}`,
      ipOrVlan: `${cfg.subnetCidr} · ${cfg.coolingZone}`,
      uplinkPath: `${cfg.devices.length} Mounted Devices · ${cfg.cables.length} Patch Cables`,
      serialOrMac: rack.serialNumber,
      statusLabel: rack.operationalStatus,
      rackAssetId: rack.id,
    };
    return { kind: 'rack' as const, rack, cfg, floor: fl, room: rm, crcSum, trend, labelPayload };
  }, [inspected, itAssets, netArch, scene.floors, scene.rooms, blinkTick]);

  // Build spatial End-to-End Cable & Port Trace payload for 2D & 3D Viewport visualization
  const inspectedTrace = useMemo<NetworkTraceOverlay | null>(() => {
    if (!inspectedContext) return null;

    const getFloorElev = (floorId?: string) => getFloorById(floorId)?.elevation ?? 0;

    if (inspectedContext.kind === 'user-node') {
      const { node, path } = inspectedContext;
      const fl = getFloorById(node.floorId) ?? scene.floors[0];
      if (!fl) return null;
      const hops: NetworkTraceHop[] = [
        {
          id: `hop-node-${node.id}`,
          label: `${node.code} (${node.wallJackId})`,
          sublabel: `${node.ipAddress} · ${node.vlan}`,
          kind: 'user-node',
          x: node.x,
          z: node.z,
          elevation: fl.elevation,
          floorId: node.floorId,
          roomId: node.roomId,
        },
      ];
      if (path.accessRack) {
        hops.push({
          id: `hop-acc-${path.accessRack.id}`,
          label: `${path.accessRack.assetId} · ${path.accessPort?.label ?? 'Access Port'}`,
          sublabel: path.accessDev ? `${path.accessDev.name} (${path.accessDev.model})` : path.accessRack.name,
          kind: 'access-switch',
          x: path.accessRack.x,
          z: path.accessRack.z,
          elevation: getFloorElev(path.accessRack.floorId),
          floorId: path.accessRack.floorId,
          roomId: path.accessRack.roomId,
          assetId: path.accessRack.id,
        });
      }
      if (path.coreRack && path.coreRack.id !== path.accessRack?.id) {
        hops.push({
          id: `hop-core-${path.coreRack.id}`,
          label: `${path.coreRack.assetId} · Core DC`,
          sublabel: path.trunkToCore ? `${path.trunkToCore.speedGbps}G ${path.trunkToCore.media}` : path.coreRack.name,
          kind: 'core-switch',
          x: path.coreRack.x,
          z: path.coreRack.z,
          elevation: getFloorElev(path.coreRack.floorId),
          floorId: path.coreRack.floorId,
          roomId: path.coreRack.roomId,
          assetId: path.coreRack.id,
        });
      }
      return {
        id: `trace-${node.id}`,
        title: `${node.code} → ${path.accessRack?.assetId ?? 'IDF'} → ${path.coreRack?.assetId ?? 'Core'}`,
        subtitle: `${node.media} · ${node.vlan} · ${node.status.toUpperCase()}`,
        buildingId: fl.buildingId,
        floorId: fl.id,
        targetAssetId: path.accessRack?.id,
        media: node.media,
        vlan: node.vlan,
        status: node.status === 'error' ? 'error' : node.status === 'degraded' ? 'warning' : 'nominal',
        hops,
      };
    }

    if (inspectedContext.kind === 'port') {
      const { rack, dev, port, connectedNode, connectedTrunk } = inspectedContext;
      const fl = getFloorById(rack.floorId) ?? scene.floors[0];
      if (!fl) return null;
      const hops: NetworkTraceHop[] = [];

      if (connectedNode) {
        hops.push({
          id: `hop-pnode-${connectedNode.id}`,
          label: `${connectedNode.code} (${connectedNode.wallJackId})`,
          sublabel: `${connectedNode.ipAddress} · ${connectedNode.media}`,
          kind: 'user-node',
          x: connectedNode.x,
          z: connectedNode.z,
          elevation: getFloorElev(connectedNode.floorId),
          floorId: connectedNode.floorId,
          roomId: connectedNode.roomId,
        });
      }

      hops.push({
        id: `hop-port-${port.id}`,
        label: `${rack.assetId} · ${port.label}`,
        sublabel: `${dev.name} (U${dev.uStart}) · ${port.speedGbps}G ${port.kind}`,
        kind: rack.rackConfig?.rackRole === 'core-dc' ? 'core-switch' : 'access-switch',
        x: rack.x,
        z: rack.z,
        elevation: fl.elevation,
        floorId: rack.floorId,
        roomId: rack.roomId,
        assetId: rack.id,
      });

      const trunkLink =
        connectedTrunk ??
        netArch.interRackLinks.find((l) => l.fromRackId === rack.id || l.toRackId === rack.id);
      if (trunkLink) {
        const peerRackId = trunkLink.fromRackId === rack.id ? trunkLink.toRackId : trunkLink.fromRackId;
        const peerRack = getRackById(peerRackId);
        if (peerRack) {
          hops.push({
            id: `hop-peer-${peerRack.id}`,
            label: `${peerRack.assetId} · ${peerRack.rackConfig?.rackRole === 'core-dc' ? 'Core MDF' : 'IDF Peer'}`,
            sublabel: `${trunkLink.speedGbps}G ${trunkLink.media} · ${trunkLink.label}`,
            kind: peerRack.rackConfig?.rackRole === 'core-dc' ? 'core-switch' : 'rack',
            x: peerRack.x,
            z: peerRack.z,
            elevation: getFloorElev(peerRack.floorId),
            floorId: peerRack.floorId,
            roomId: peerRack.roomId,
            assetId: peerRack.id,
          });
        }
      }

      return {
        id: `trace-port-${port.id}`,
        title: `${rack.assetId} [${port.label}] End-to-End Trace`,
        subtitle: `${dev.model} · ${port.vlan} · ${port.speedGbps}G ${port.kind}`,
        buildingId: fl.buildingId,
        floorId: fl.id,
        targetAssetId: rack.id,
        media: port.kind,
        vlan: port.vlan,
        status: port.status === 'error' ? 'error' : (port.crcErrors ?? 0) > 0 ? 'warning' : 'nominal',
        hops,
      };
    }

    // Device or Rack target
    const rack = inspectedContext.rack;
    const fl = getFloorById(rack.floorId) ?? scene.floors[0];
    if (!fl) return null;
    const hops: NetworkTraceHop[] = [];
    const sampleNode = netArch.userNodes.find((n) => n.connectedRackId === rack.id);
    if (sampleNode) {
      hops.push({
        id: `hop-rn-${sampleNode.id}`,
        label: `${sampleNode.code} (${sampleNode.wallJackId})`,
        sublabel: `${sampleNode.vlan} · ${sampleNode.media}`,
        kind: 'user-node',
        x: sampleNode.x,
        z: sampleNode.z,
        elevation: getFloorElev(sampleNode.floorId),
        floorId: sampleNode.floorId,
        roomId: sampleNode.roomId,
      });
    }
    hops.push({
      id: `hop-rk-${rack.id}`,
      label:
        inspectedContext.kind === 'device'
          ? `${rack.assetId} · U${inspectedContext.dev.uStart} ${inspectedContext.dev.name}`
          : `${rack.assetId} · ${rack.name}`,
      sublabel: inspectedContext.labelPayload.ipOrVlan,
      kind: rack.rackConfig?.rackRole === 'core-dc' ? 'core-switch' : 'rack',
      x: rack.x,
      z: rack.z,
      elevation: fl.elevation,
      floorId: rack.floorId,
      roomId: rack.roomId,
      assetId: rack.id,
    });
    const trunk = netArch.interRackLinks.find((l) => l.fromRackId === rack.id || l.toRackId === rack.id);
    if (trunk) {
      const peerId = trunk.fromRackId === rack.id ? trunk.toRackId : trunk.fromRackId;
      const peer = getRackById(peerId);
      if (peer) {
        hops.push({
          id: `hop-rk-peer-${peer.id}`,
          label: `${peer.assetId} · ${peer.name}`,
          sublabel: `${trunk.speedGbps}G ${trunk.media}`,
          kind: peer.rackConfig?.rackRole === 'core-dc' ? 'core-switch' : 'rack',
          x: peer.x,
          z: peer.z,
          elevation: getFloorElev(peer.floorId),
          floorId: peer.floorId,
          roomId: peer.roomId,
          assetId: peer.id,
        });
      }
    }

    return {
      id: `trace-${inspectedContext.kind}-${rack.id}`,
      title: `${inspectedContext.labelPayload.code} · ${inspectedContext.labelPayload.title}`,
      subtitle: inspectedContext.labelPayload.uplinkPath,
      buildingId: fl.buildingId,
      floorId: fl.id,
      targetAssetId: rack.id,
      media: trunk?.media ?? 'OM4 Fiber / Cat6A',
      vlan: inspectedContext.labelPayload.ipOrVlan,
      status: inspectedContext.crcSum > 0 ? 'warning' : 'nominal',
      hops,
    };
  }, [inspectedContext, scene.floors, netArch, itAssets]);

  const selected3DItemId =
    inspected?.kind === 'port'
      ? inspected.portId
      : inspected?.kind === 'device'
        ? inspected.deviceId
        : inspected?.kind === 'user-node'
          ? inspected.nodeId
          : inspected?.kind === 'rack'
            ? inspected.rackId
            : activeAsset?.id ?? null;

  const renderRackListButton = (a: SpatialAsset) => {
    const isSel = a.id === activeAsset?.id;
    const cfg = a.rackConfig;
    const fl = getFloorById(a.floorId);
    const rm = getRoomById(a.roomId);
    const devCount = cfg?.devices.length ?? 0;
    const rackErrs =
      cfg?.devices.reduce(
        (sum, d) => sum + d.ports.filter((p) => p.status === 'error' || (p.crcErrors ?? 0) > 0).length,
        0
      ) ?? 0;
    const nodeCount = netArch.userNodes.filter((n) => n.connectedRackId === a.id).length;

    return (
      <button
        key={a.id}
        type="button"
        onClick={() => {
          setSelectedAssetId(a.id);
          setInspected({ kind: 'rack', rackId: a.id });
        }}
        className={`w-full text-left p-2.5 rounded-xl border transition-colors cursor-pointer ${
          isSel
            ? 'border-violet-500 bg-violet-500/12 text-zinc-900 dark:text-white'
            : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#15151C] text-zinc-700 dark:text-zinc-300 hover:border-zinc-400'
        }`}
      >
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-xs font-semibold truncate">{a.name}</span>
          {rackErrs > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-mono text-[9px] font-bold shrink-0">
              {rackErrs} ERR
            </span>
          )}
        </div>
        <div className="text-[10px] font-mono text-zinc-500 flex items-center justify-between mt-0.5">
          <span className="truncate">
            {a.assetId} · {fl?.code ?? 'FL'}
            {rm ? ` (${rm.code})` : ''}
          </span>
          <span className="shrink-0">
            {devCount}U-dev · {nodeCount} drops
          </span>
        </div>
      </button>
    );
  };

  return (
    <div
      className={
        mode === 'page'
          ? 'h-[100dvh] w-screen bg-zinc-50 dark:bg-[#0A0A0D] text-zinc-900 dark:text-zinc-100 flex flex-col overflow-hidden'
          : 'fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-0 sm:p-4'
      }
    >
      <div
        className={
          mode === 'page'
            ? 'w-full flex-1 min-h-0 bg-white dark:bg-[#101015] flex flex-col overflow-hidden'
            : 'w-full max-w-[1440px] h-[100dvh] sm:h-[92vh] bg-white dark:bg-[#101015] border-0 sm:border border-zinc-200 dark:border-zinc-800 rounded-none sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden'
        }
      >
        {/* Responsive Header — never clips off right edge on mobile */}
        <div className="px-3 sm:px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex flex-col lg:flex-row lg:items-center justify-between gap-2 bg-zinc-50 dark:bg-[#0C0C10] shrink-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={handleBackAction}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium whitespace-nowrap cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
                <span>{mode === 'page' ? 'Home' : 'Back'}</span>
              </button>
              <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center shrink-0">
                <Server className="w-4 h-4 text-cyan-500" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white truncate">
                  IT &amp; Data Center
                </h2>
                <p className="hidden xl:block text-[10.5px] text-zinc-500 dark:text-zinc-400 truncate">
                  MDF Core · Floor IDFs · Endpoints · 3-Tier Topology &amp; 3D Studio
                </p>
              </div>
            </div>

            {mode === 'modal' && (
              <button
                type="button"
                onClick={closeRackDesigner}
                aria-label="Close Data Center Designer"
                className="lg:hidden p-2 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap lg:flex-nowrap shrink-0">
            {/* Design / View Mode Switcher (ACL-locked if role lacks spatial.edit) */}
            <div className="flex items-center p-0.5 rounded-xl bg-zinc-200/70 dark:bg-[#171720] border border-zinc-300/70 dark:border-zinc-800">
              <button
                type="button"
                disabled={!aclCanEdit}
                onClick={() => setWorkspaceMode('design')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  !isReadOnly
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'
                }`}
                title={aclCanEdit ? 'Design Mode — Edit Racks, Ports, Nodes & Links' : 'ACL role is Read-Only'}
              >
                <Pencil className="w-3 h-3" />
                <span>Edit</span>
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceMode('view')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  isReadOnly
                    ? 'bg-amber-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {aclCanEdit ? <Eye className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                <span>{aclCanEdit ? 'View' : 'Locked'}</span>
              </button>
            </div>

            {/* 2D / 3D Switcher across Live Map, Racks & Ports, User Nodes, and 3-Tier Architecture */}
            {(activeTab === 'live-map' || activeTab === 'racks' || activeTab === 'user-nodes' || activeTab === 'topology') && (
              <div className="flex items-center p-0.5 rounded-xl bg-zinc-200/70 dark:bg-[#171720] border border-zinc-300/70 dark:border-zinc-800">
                {(['2d', '3d'] as const).map((dim) => (
                  <button
                    key={dim}
                    type="button"
                    onClick={() => setViewDim(dim)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-bold uppercase transition-colors cursor-pointer ${
                      viewDim === dim
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {dim}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleGoTo3DTwin}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 text-xs font-semibold whitespace-nowrap cursor-pointer"
              title="Open 3D Digital Twin with IT X-Ray Focus"
            >
              <Box className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">3D Twin</span>
            </button>

            {!isReadOnly && (
              <button
                type="button"
                onClick={() => {
                  setProvFloorId(activeFloorId || scene.floors[0]?.id || '');
                  setShowProvisionModal(true);
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                title="Provision a new MDF or Floor IDF Rack"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Rack</span>
              </button>
            )}

            {mode === 'modal' && (
              <button
                type="button"
                onClick={closeRackDesigner}
                aria-label="Close Data Center Designer"
                className="hidden lg:inline-flex p-1.5 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Sub-Bar: Compact Responsive Studio Tabs + Live KPIs */}
        <div className="px-2.5 sm:px-4 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111117] flex items-center justify-between gap-2 overflow-x-auto no-scrollbar shrink-0">
          <div className="flex items-center gap-1 shrink-0">
            {(
              [
                { id: 'live-map', label: 'Port Map', title: 'Live Port & Cable Topology Map', icon: <Network className="w-3.5 h-3.5" />, badge: totalLivePorts },
                { id: 'racks', label: 'Racks', title: 'Racks, Cabinets & Port Elevation', icon: <Server className="w-3.5 h-3.5" />, badge: itAssets.length },
                { id: 'user-nodes', label: 'Endpoints', title: 'Room Endpoints & Wall Drops', icon: <Monitor className="w-3.5 h-3.5" />, badge: netArch.userNodes.length },
                { id: 'topology', label: '3-Tier', title: '3-Tier Campus Architecture', icon: <GitBranch className="w-3.5 h-3.5" />, badge: netArch.interRackLinks.length },
                { id: 'builder', label: 'Builder', title: 'Quick IT Architecture Builder', icon: <Sparkles className="w-3.5 h-3.5" />, badge: scene.rooms.length },
                { id: 'monitoring', label: 'APIs', title: 'SNMP / Monitoring Connectors', icon: <PlugZap className="w-3.5 h-3.5" />, badge: netArch.monitoringApis.length },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                title={tab.title}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/70'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                <span
                  className={`px-1 py-0.2 rounded font-mono text-[9.5px] tabular-nums ${
                    activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {tab.badge}
                </span>
              </button>
            ))}
          </div>

          <div className="hidden xl:flex items-center gap-2.5 text-[11px] font-mono tabular-nums shrink-0">
            <span className="text-zinc-500">
              <strong className="text-amber-500">{totalFacilityKw.toFixed(1)} kW</strong>
            </span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-500">
              <strong className="text-cyan-400">{coreRacks.length}/{idfRacks.length}</strong> MDF/IDF
            </span>
            <span className="text-zinc-700">·</span>
            <span className={totalErrors > 0 ? 'text-rose-400 font-bold flex items-center gap-1' : 'text-emerald-500 flex items-center gap-1'}>
              {totalErrors > 0 ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
              {totalErrors > 0 ? `${totalErrors} Alerts` : 'Nominal'}
            </span>
            <button
              type="button"
              onClick={() => setShowInspectorPane((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-cyan-500/60 cursor-pointer"
              title={showInspectorPane ? 'Expand workspace canvas (hide right inspector)' : 'Show Inspector & Trace sidebar'}
            >
              {showInspectorPane ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
              <span className="font-sans text-[10.5px] font-semibold">{showInspectorPane ? 'Wide' : 'Inspect'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Workspace vs Inspector & Trace Switcher (eliminates cramped double scroll on phones) */}
        <div className="flex lg:hidden items-center gap-1.5 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0D0E14] shrink-0">
          <button
            type="button"
            onClick={() => setMobilePane('workspace')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              mobilePane === 'workspace'
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Canvas &amp; Racks
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('inspector')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
              mobilePane === 'inspector'
                ? 'bg-cyan-600 text-white'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Route className="w-3.5 h-3.5" />
            <span>
              Inspector &amp; Trace{inspectedContext ? ` (${inspectedContext.labelPayload.code})` : ''}
            </span>
          </button>
        </div>

        {/* MAIN WORKSPACE BODY */}
        <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-12 overflow-hidden">
          {/* LEFT + CENTER AREA (8 cols on lg, or 12 cols when inspector collapsed) */}
          <div
            className={`${
              mobilePane === 'inspector' ? 'hidden lg:flex' : 'flex'
            } flex-1 min-h-0 ${
              showInspectorPane ? 'lg:col-span-8 lg:border-r' : 'lg:col-span-12'
            } flex-col border-zinc-200 dark:border-zinc-800 overflow-y-auto overscroll-contain touch-pan-y lg:overflow-hidden`}
          >
            {/* ==================== TAB 0: LIVE PORT MAP & VISUAL EDITOR (2D & 3D) ==================== */}
            {activeTab === 'live-map' && (
              <LivePortTopologyCanvas
                itAssets={itAssets}
                userNodes={netArch.userNodes}
                interRackLinks={netArch.interRackLinks}
                topologyMap={netArch.topologyMap}
                buildings={scene.buildings}
                rooms={scene.rooms}
                walls={scene.walls}
                floors={scene.floors}
                viewDim={viewDim}
                onViewDimChange={setViewDim}
                isReadOnly={isReadOnly}
                inspected={inspected}
                onInspect={(target) => handleInspectAndReveal(target, false)}
                onJumpTo3D={({ rackId, nodeId }) => {
                  if (nodeId) {
                    setInspected({ kind: 'user-node', nodeId });
                  } else if (rackId) {
                    setSelectedAssetId(rackId);
                  }
                  setCategoryFilter('IT');
                  setViewMode('3d-perspective');
                  setScreen('workspace');
                  closeRackDesigner();
                  if (rackId) {
                    drillInto('asset', rackId);
                  }
                  showToast('Located IT equipment in 3D Digital Twin', 'info');
                }}
                onJumpTo2D={({ rackId }) => {
                  setCategoryFilter('IT');
                  setViewMode('2d');
                  setScreen('workspace');
                  closeRackDesigner();
                  if (rackId) {
                    const rk = getRackById(rackId);
                    if (rk) {
                      const twin = useTwinStore.getState();
                      twin.setActiveFloor(rk.floorId);
                      twin.selectEntity({ type: 'asset', id: rk.id });
                    }
                  }
                }}
                onTraceNode={(nodeId) => {
                  setInspected({ kind: 'user-node', nodeId });
                  setShowInspectorPane(true);
                  setMobilePane('inspector');
                }}
              />
            )}

            {/* ==================== TAB 1: RACKS & PORTS (2D / 3D) ==================== */}
            {activeTab === 'racks' && (
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 lg:overflow-hidden">
                {/* Sub-col A: Core DC + Floor IDF Distribution Racks + Hardware Catalog */}
                <div className="md:col-span-5 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0E0E13] md:overflow-y-auto p-3 space-y-4">
                  {/* Core Data Center Racks */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-500 flex items-center justify-between">
                      <span>Core Data Center (MDF)</span>
                      <span className="font-mono">{coreRacks.length}</span>
                    </div>
                    {coreRacks.map(renderRackListButton)}
                  </div>

                  {/* Floor & Room Distribution Racks (IDF) */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-500 flex items-center justify-between">
                      <span>Floor / Room Distribution (IDF)</span>
                      <span className="font-mono">{idfRacks.length}</span>
                    </div>
                    {idfRacks.map(renderRackListButton)}
                  </div>

                  {activeAsset && (
                    <>
                      {/* Power & Thermal Gauge */}
                      <div className="p-3 rounded-2xl bg-white dark:bg-[#15151C] border border-zinc-200 dark:border-zinc-800 space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className="flex items-center gap-1.5 text-amber-500">
                            <Zap className="w-3.5 h-3.5" /> PDU &amp; Thermal
                          </span>
                          <span className={`font-mono tabular-nums ${totalPowerKw > rackConfig.maxPowerKw ? 'text-rose-500' : ''}`}>
                            {totalPowerKw.toFixed(2)} / {rackConfig.maxPowerKw} kW
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              powerPct > 90 ? 'bg-rose-500' : powerPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${powerPct}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] font-mono text-zinc-500 tabular-nums">
                          <span>{usedUnits}/{rackConfig.totalUnits}U used</span>
                          <span>{thermalBtu.toLocaleString()} BTU/h</span>
                        </div>
                      </div>

                      {/* Mount Hardware Catalog (disabled in read-only) */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-between">
                          <span>Mount Hardware Into Rack</span>
                          {isReadOnly && <Lock className="w-3 h-3 text-amber-500" />}
                        </div>
                        {DEVICE_PRESETS.map((preset) => (
                          <button
                            key={preset.key}
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => handleAddDevice(preset)}
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#15151C] border border-zinc-200 dark:border-zinc-800 hover:border-violet-500 disabled:opacity-45 disabled:cursor-not-allowed text-[11px] transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-2 truncate">
                              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: preset.color }} />
                              <span className="truncate font-medium">{preset.label}</span>
                            </span>
                            <span className="text-[9.5px] font-mono text-zinc-400 shrink-0">
                              {preset.uHeight}U · {preset.powerW}W
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Sub-col B: 2D Interactive 42U Elevation OR 3D Rack Viewer + Patch Cable Matrix */}
                <div className="md:col-span-7 flex flex-col min-h-0 bg-[#0A0A0F] text-zinc-100">
                  <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2 shrink-0">
                    <div className="text-xs font-mono font-semibold text-zinc-200 truncate">
                      {activeAsset ? `${activeAsset.assetId} · ${rackConfig.totalUnits}U (${viewDim.toUpperCase()})` : 'Rack Cabinet'}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {viewDim === '2d' && (
                        <div className="flex items-center gap-0.5 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
                          {(['front', 'rear'] as const).map((face) => (
                            <button
                              key={face}
                              type="button"
                              onClick={() => setRackFace(face)}
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold capitalize cursor-pointer ${
                                rackFace === face ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
                              }`}
                            >
                              {face}
                            </button>
                          ))}
                        </div>
                      )}
                      {activeAsset && (
                        <button
                          type="button"
                          onClick={() => setInspected({ kind: 'rack', rackId: activeAsset.id })}
                          className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[10px] font-mono text-cyan-300 cursor-pointer"
                        >
                          Inspect Rack
                        </button>
                      )}
                    </div>
                  </div>

                  {viewDim === '3d' ? (
                    <div className="flex-1 min-h-[380px]">
                      <DataCenter3DViewer
                        mode="single-rack"
                        rackAssets={itAssets}
                        activeRackId={activeAsset?.id ?? null}
                        userNodes={netArch.userNodes}
                        interRackLinks={netArch.interRackLinks}
                        floors={scene.floors}
                        buildings={scene.buildings}
                        rooms={scene.rooms}
                        walls={scene.walls}
                        selectedItemId={selected3DItemId}
                        onSelectRack={(rId) => handleInspectAndReveal({ kind: 'rack', rackId: rId })}
                        onSelectDevice={(rId, dId) => handleInspectAndReveal({ kind: 'device', rackId: rId, deviceId: dId })}
                        onSelectPort={(rId, dId, pId) =>
                          handleInspectAndReveal({ kind: 'port', rackId: rId, deviceId: dId, portId: pId })
                        }
                      />
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-3 space-y-4">
                      {/* 42U Cabinet Elevation with Live Blinking Port & Uplink LEDs */}
                      <div className="mx-auto max-w-[440px] rounded-xl border-2 border-zinc-700 bg-[#12121A] p-2 shadow-2xl space-y-0.5">
                        {Array.from({ length: rackConfig.totalUnits }, (_, idx) => {
                          const u = rackConfig.totalUnits - idx;
                          const owners = slotOwnerMap.get(u) ?? [];
                          const collision = owners.length > 1;
                          const topOwner = owners.find((d) => d.uStart + d.uHeight - 1 === u);
                          const continuing = owners.length > 0 && !topOwner;

                          if (continuing) return null;

                          if (topOwner && activeAsset) {
                            const isSel =
                              (inspected?.kind === 'device' && inspected.deviceId === topOwner.id) ||
                              (inspected?.kind === 'port' && inspected.deviceId === topOwner.id);
                            const bg = KIND_COLOR[topOwner.kind] ?? '#3B82F6';
                            const hasPortErr = topOwner.ports.some((p) => p.status === 'error' || (p.crcErrors ?? 0) > 0);
                            return (
                              <div
                                key={u}
                                onClick={() =>
                                  setInspected({ kind: 'device', rackId: activeAsset.id, deviceId: topOwner.id })
                                }
                                style={{
                                  minHeight: `${Math.max(30, topOwner.uHeight * 24)}px`,
                                  borderColor: collision || hasPortErr ? '#EF4444' : isSel ? '#F59E0B' : bg,
                                }}
                                className={`flex items-center gap-2 px-2 py-1 rounded-lg border cursor-pointer transition-all ${
                                  collision
                                    ? 'bg-rose-950/80'
                                    : isSel
                                      ? 'bg-violet-950/90 ring-1 ring-amber-400'
                                      : 'bg-[#191B26] hover:bg-[#222534]'
                                }`}
                              >
                                <span className="w-8 text-[9px] font-mono text-zinc-400 shrink-0">
                                  U{topOwner.uStart}
                                  {topOwner.uHeight > 1 ? `-${topOwner.uStart + topOwner.uHeight - 1}` : ''}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] font-semibold text-white truncate flex items-center gap-1.5">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        topOwner.status === 'online'
                                          ? 'bg-emerald-400'
                                          : topOwner.status === 'warning'
                                            ? 'bg-amber-400'
                                            : 'bg-rose-500'
                                      }`}
                                    />
                                    <span className="truncate">{topOwner.name}</span>
                                    {topOwner.tier && (
                                      <span className="px-1 py-0.2 rounded bg-white/10 text-[8.5px] font-mono uppercase text-cyan-300 shrink-0">
                                        {topOwner.tier}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[9.5px] font-mono text-zinc-400 truncate">
                                    {rackFace === 'front'
                                      ? `${topOwner.vendor} ${topOwner.model} · ${topOwner.ipAddress}`
                                      : `${topOwner.ports.length} ports · ${topOwner.powerW}W · ${topOwner.vlan}`}
                                  </div>
                                </div>

                                {/* Clickable Live Blinking Port & Uplink LED Bank */}
                                <div className="flex items-center gap-1 shrink-0">
                                  {topOwner.ports.slice(0, 8).map((p, pIdx) => {
                                    const portSel = inspected?.kind === 'port' && inspected.portId === p.id;
                                    const ledCls = getLedVisual(
                                      p.status,
                                      p.isUplink,
                                      blinkTick + pIdx + u
                                    );
                                    return (
                                      <button
                                        key={p.id}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setInspected({
                                            kind: 'port',
                                            rackId: activeAsset.id,
                                            deviceId: topOwner.id,
                                            portId: p.id,
                                          });
                                        }}
                                        title={`${p.label} (${p.kind} ${p.speedGbps}G${p.isUplink ? ' UPLINK' : ''}) — ${p.status.toUpperCase()}`}
                                        className={`w-2.5 h-4 rounded-[3px] flex flex-col items-center justify-between p-[2px] bg-[#0D0F17] border transition-transform hover:scale-125 cursor-pointer ${
                                          portSel
                                            ? 'border-amber-400 ring-1 ring-amber-400'
                                            : p.isUplink
                                              ? 'border-cyan-500/70'
                                              : 'border-zinc-700'
                                        }`}
                                      >
                                        <span className={`w-1.5 h-1.5 rounded-full ${ledCls}`} />
                                        <span className="w-1.5 h-1 rounded-[1px] bg-zinc-700" />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={u}
                              className="h-[15px] flex items-center gap-2 px-2 rounded bg-[#0E0E14] border border-zinc-800/50 text-[8.5px] font-mono text-zinc-600"
                            >
                              <span className="w-8">U{u}</span>
                              <span className="flex-1 border-b border-dashed border-zinc-800/80" />
                            </div>
                          );
                        })}
                      </div>

                      {/* Structured Patch Cable Matrix inside Active Rack */}
                      <div className="mx-auto max-w-[440px] p-3 rounded-xl bg-[#13141E] border border-zinc-800 space-y-2.5">
                        <div className="text-[11px] font-semibold text-zinc-200 flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Cable className="w-3.5 h-3.5 text-amber-400" />
                            Internal Rack Patch Cables ({rackConfig.cables.length})
                          </span>
                          {isReadOnly && <span className="text-[9.5px] text-amber-400">Read-Only</span>}
                        </div>

                        {!isReadOnly && (
                          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                            <select
                              value={cableFromDev}
                              onChange={(e) => {
                                setCableFromDev(e.target.value);
                                setCableFromPort('');
                              }}
                              className="px-2 py-1 rounded-lg bg-[#0B0C12] border border-zinc-700 text-zinc-200"
                            >
                              <option value="">Source Device…</option>
                              {rackConfig.devices.map((d) => (
                                <option key={d.id} value={d.id}>
                                  U{d.uStart} · {d.name}
                                </option>
                              ))}
                            </select>
                            <select
                              value={cableFromPort}
                              onChange={(e) => setCableFromPort(e.target.value)}
                              className="px-2 py-1 rounded-lg bg-[#0B0C12] border border-zinc-700 text-zinc-200"
                            >
                              <option value="">Source Port…</option>
                              {(fromDeviceObj?.ports ?? []).map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.label} ({p.speedGbps}G)
                                </option>
                              ))}
                            </select>
                            <select
                              value={cableToDev}
                              onChange={(e) => {
                                setCableToDev(e.target.value);
                                setCableToPort('');
                              }}
                              className="px-2 py-1 rounded-lg bg-[#0B0C12] border border-zinc-700 text-zinc-200"
                            >
                              <option value="">Target Device…</option>
                              {rackConfig.devices.map((d) => (
                                <option key={d.id} value={d.id}>
                                  U{d.uStart} · {d.name}
                                </option>
                              ))}
                            </select>
                            <select
                              value={cableToPort}
                              onChange={(e) => setCableToPort(e.target.value)}
                              className="px-2 py-1 rounded-lg bg-[#0B0C12] border border-zinc-700 text-zinc-200"
                            >
                              <option value="">Target Port…</option>
                              {(toDeviceObj?.ports ?? []).map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.label} ({p.speedGbps}G)
                                </option>
                              ))}
                            </select>
                            <select
                              value={cableMedia}
                              onChange={(e) => setCableMedia(e.target.value as RackPatchCable['media'])}
                              className="px-2 py-1 rounded-lg bg-[#0B0C12] border border-zinc-700 text-zinc-200"
                            >
                              <option value="OM4 Fiber">OM4 Fiber</option>
                              <option value="OS2 Single-Mode">OS2 Single-Mode</option>
                              <option value="DAC Twinax">DAC Twinax</option>
                              <option value="Cat6A">Cat6A Copper</option>
                            </select>
                            <button
                              type="button"
                              onClick={handleAddPatchCable}
                              className="px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold cursor-pointer"
                            >
                              + Patch Link
                            </button>
                          </div>
                        )}

                        <div className="space-y-1 max-h-36 overflow-y-auto">
                          {rackConfig.cables.map((c) => {
                            const fd = rackConfig.devices.find((d) => d.id === c.fromDeviceId);
                            const fp = fd?.ports.find((p) => p.id === c.fromPortId);
                            const td = rackConfig.devices.find((d) => d.id === c.toDeviceId);
                            const tp = td?.ports.find((p) => p.id === c.toPortId);
                            return (
                              <div
                                key={c.id}
                                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#0B0C12] border border-zinc-800 text-[10.5px]"
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                                  <span className="truncate font-mono">
                                    {fd?.name?.slice(0, 14) ?? c.fromDeviceId}[{fp?.label ?? '?'}] →{' '}
                                    {td?.name?.slice(0, 14) ?? c.toDeviceId}[{tp?.label ?? '?'}]
                                  </span>
                                </div>
                                {!isReadOnly && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      commitRackConfig({
                                        ...rackConfig,
                                        cables: rackConfig.cables.filter((x) => x.id !== c.id),
                                      })
                                    }
                                    className="text-zinc-500 hover:text-rose-400 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ==================== TAB 2: USER NODE DESIGNER (2960-X -> DIST -> CORE) ==================== */}
            {activeTab === 'user-nodes' && (
              <div className="flex-1 min-h-0 flex flex-col bg-[#0A0B10] text-zinc-100">
                {/* Floor Selector & Node Placement Palette — responsive & never squashes counters */}
                <div className="p-3 border-b border-zinc-800 bg-[#0F1018] flex flex-col gap-2.5 shrink-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <select
                        value={nodeFloorId}
                        onChange={(e) => setNodeFloorId(e.target.value)}
                        className="w-full sm:w-auto sm:max-w-xs min-w-0 px-2.5 py-1.5 rounded-lg bg-[#181A26] border border-zinc-700 text-xs font-mono text-zinc-100"
                      >
                        {scene.floors.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.code} · {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="text-[11px] font-mono text-zinc-400 whitespace-nowrap shrink-0">
                      {floorRacks.length} racks · {floorUserNodes.length} user drops
                    </span>
                  </div>

                  {!isReadOnly ? (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                      <span className="text-[10px] font-semibold text-zinc-400 mr-0.5 whitespace-nowrap shrink-0">Place:</span>
                      {USER_NODE_PALETTE.map((pal) => (
                        <button
                          key={pal.kind}
                          type="button"
                          onClick={() =>
                            setPlacingNodeKind((cur) => (cur === pal.kind ? null : pal.kind))
                          }
                          className={`px-2.5 py-1 rounded-lg text-[10.5px] font-semibold border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                            placingNodeKind === pal.kind
                              ? 'bg-violet-600 border-violet-400 text-white'
                              : 'bg-[#171925] border-zinc-800 text-zinc-300 hover:border-zinc-600'
                          }`}
                        >
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full mr-1"
                            style={{ backgroundColor: pal.color }}
                          />
                          {pal.short}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-amber-400 flex items-center gap-1 font-medium">
                      <Lock className="w-3 h-3 shrink-0" /> Switch to Design mode to place or drag user nodes
                    </span>
                  )}
                </div>

                {/* Interactive Scaled Floor Plan SVG (2D) OR Real 3D Floor Map (3D) */}
                {viewDim === '3d' ? (
                  <div className="flex-1 min-h-[320px] relative overflow-hidden">
                    <DataCenter3DViewer
                      mode="campus-topology"
                      rackAssets={floorRacks.length > 0 ? floorRacks : itAssets}
                      activeRackId={activeAsset?.id ?? null}
                      userNodes={floorUserNodes}
                      interRackLinks={netArch.interRackLinks}
                      floors={activeNodeFloor ? [activeNodeFloor] : scene.floors}
                      buildings={scene.buildings}
                      rooms={floorRooms}
                      walls={scene.walls.filter((w) => w.floorId === activeNodeFloor?.id)}
                      selectedItemId={selected3DItemId}
                      onSelectRack={(rId) => {
                        handleInspectAndReveal({ kind: 'rack', rackId: rId });
                        setDetail3DTarget({ kind: 'rack', rackId: rId });
                      }}
                      onSelectDevice={(rId, dId) => {
                        handleInspectAndReveal({ kind: 'device', rackId: rId, deviceId: dId });
                        setDetail3DTarget({ kind: 'device', rackId: rId, deviceId: dId });
                      }}
                      onSelectUserNode={(nId) => {
                        handleInspectAndReveal({ kind: 'user-node', nodeId: nId });
                        setDetail3DTarget({ kind: 'user-node', nodeId: nId });
                      }}
                      onSelectRoom={(rmId, flId) => {
                        setDetail3DTarget({ kind: 'room', roomId: rmId, floorId: flId });
                      }}
                    />
                  </div>
                ) : (
                <div className="flex-1 min-h-[260px] sm:min-h-[340px] relative p-2.5 sm:p-3 overflow-hidden flex items-center justify-center">
                  {placingNodeKind && !isReadOnly && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-xl bg-violet-600 text-white text-xs font-semibold shadow-xl max-w-[92%] text-center">
                      Tap inside any room to place {USER_NODE_PALETTE.find((p) => p.kind === placingNodeKind)?.label} &amp; wire to Floor Access Switch
                    </div>
                  )}

                  {activeNodeFloor && (
                    <svg
                      ref={floorSvgRef}
                      viewBox={`-2 -2 ${activeNodeFloor.width + 4} ${activeNodeFloor.depth + 4}`}
                      preserveAspectRatio="xMidYMid meet"
                      className={`w-full aspect-[16/11] sm:aspect-auto sm:h-full max-h-[520px] rounded-2xl bg-[#0D0F18] border border-zinc-800 ${
                        placingNodeKind && !isReadOnly ? 'cursor-crosshair' : 'cursor-default'
                      }`}
                      onClick={handleFloorPlanClick}
                      onPointerMove={(e) => {
                        if (!draggingNodeId || isReadOnly) return;
                        const pt = clientToFloorMeters(e.clientX, e.clientY);
                        const rm = floorRooms.find(
                          (r) => pt.x >= r.x && pt.x <= r.x + r.width && pt.z >= r.z && pt.z <= r.z + r.depth
                        );
                        updateNetworkUserNode(draggingNodeId, { x: pt.x, z: pt.z, roomId: rm?.id });
                      }}
                      onPointerUp={() => setDraggingNodeId(null)}
                      onPointerLeave={() => {
                        setDraggingNodeId(null);
                        setHoverTip(null);
                      }}
                    >
                      {/* Floor Slab */}
                      <rect
                        x={0}
                        y={0}
                        width={activeNodeFloor.width}
                        height={activeNodeFloor.depth}
                        rx={0.4}
                        fill="#121521"
                        stroke="#2A3147"
                        strokeWidth={0.14}
                      />

                      {/* Rooms with interactive hover tooltips */}
                      {floorRooms.map((rm) => {
                        const rmRacks = floorRacks.filter((r) => r.roomId === rm.id);
                        const rmNodes = floorUserNodes.filter((n) => n.roomId === rm.id);
                        const showRoomTip = (e: React.MouseEvent) => {
                          setHoverTip({
                            x: e.clientX,
                            y: e.clientY,
                            title: `${rm.code} · ${rm.name}`,
                            badge: rm.environmental?.cleanroomGrade ?? rm.category,
                            badgeTone: 'blue',
                            subtitle: `${activeNodeFloor.code} · ${activeNodeFloor.name}`,
                            rows: [
                              { label: 'Footprint', value: `${rm.width.toFixed(1)}m × ${rm.depth.toFixed(1)}m (${Math.round(rm.width * rm.depth)} m²)` },
                              { label: 'IT Racks', value: rmRacks.length > 0 ? rmRacks.map((r) => r.assetId).join(', ') : 'None' },
                              { label: 'Endpoints', value: `${rmNodes.length} connected drop${rmNodes.length === 1 ? '' : 's'}` },
                            ],
                            hint: placingNodeKind ? 'Click to place endpoint in this room' : 'Hover racks/endpoints for port details',
                          });
                        };
                        return (
                          <g
                            key={rm.id}
                            onMouseEnter={showRoomTip}
                            onMouseMove={showRoomTip}
                            onMouseLeave={() => setHoverTip(null)}
                          >
                            <rect
                              x={rm.x}
                              y={rm.z}
                              width={rm.width}
                              height={rm.depth}
                              fill="#181D2E"
                              stroke="#334155"
                              strokeWidth={0.1}
                            />
                            <text
                              x={rm.x + 0.4}
                              y={rm.z + 0.85}
                              fontSize={0.62}
                              fill="#94A3B8"
                              fontFamily="ui-monospace, monospace"
                              fontWeight="600"
                            >
                              {rm.code} · {rm.name.slice(0, 18)}
                            </text>
                          </g>
                        );
                      })}

                      {/* Structured Cat6A / Fiber Drop Lines from User Nodes -> Floor IDF / Access Racks */}
                      {floorUserNodes.map((node) => {
                        const targetRack = floorRacks.find((r) => r.id === node.connectedRackId);
                        if (!targetRack) return null;
                        const isSel = inspected?.kind === 'user-node' && inspected.nodeId === node.id;
                        const stroke =
                          node.status === 'error'
                            ? '#EF4444'
                            : node.status === 'degraded'
                              ? '#F59E0B'
                              : isSel
                                ? '#F59E0B'
                                : '#14B8A6';
                        return (
                          <g key={`wire-${node.id}`}>
                            <line
                              x1={node.x}
                              y1={node.z}
                              x2={targetRack.x}
                              y2={targetRack.z}
                              stroke={stroke}
                              strokeWidth={isSel ? 0.2 : 0.11}
                              strokeDasharray={node.status === 'error' ? '0.4 0.25' : undefined}
                              strokeOpacity={isSel ? 1 : 0.78}
                            />
                          </g>
                        );
                      })}

                      {/* Racks on this Floor (Core DC & IDF Distribution) */}
                      {floorRacks.map((rack) => {
                        const isCore = rack.rackConfig?.rackRole === 'core-dc';
                        const isSel = inspected?.kind === 'rack' && inspected.rackId === rack.id;
                        const rm = getRoomById(rack.roomId);
                        const devs = rack.rackConfig?.devices ?? [];
                        const dropsCount = floorUserNodes.filter((n) => n.connectedRackId === rack.id).length;
                        const showRackTip = (e: React.MouseEvent) => {
                          e.stopPropagation();
                          setHoverTip({
                            x: e.clientX,
                            y: e.clientY,
                            title: `${rack.assetId} · ${rack.name}`,
                            badge: isCore ? 'CORE MDF' : 'IDF RACK',
                            badgeTone: isCore ? 'cyan' : 'blue',
                            subtitle: rm ? `${rm.code} · ${rm.name}` : activeNodeFloor.name,
                            rows: [
                              { label: 'Mounted Gear', value: `${devs.length} device${devs.length === 1 ? '' : 's'}` },
                              { label: 'Room Drops', value: `${dropsCount} endpoint${dropsCount === 1 ? '' : 's'}` },
                              { label: 'Subnet', value: rack.rackConfig?.subnetCidr ?? '—' },
                            ],
                            hint: 'Click to inspect rack & devices',
                          });
                        };
                        return (
                          <g
                            key={rack.id}
                            transform={`translate(${rack.x}, ${rack.z})`}
                            className="cursor-pointer"
                            onMouseEnter={showRackTip}
                            onMouseMove={showRackTip}
                            onMouseLeave={() => setHoverTip(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAssetId(rack.id);
                              setInspected({ kind: 'rack', rackId: rack.id });
                            }}
                          >
                            <rect
                              x={-0.65}
                              y={-0.65}
                              width={1.3}
                              height={1.3}
                              rx={0.2}
                              fill={isCore ? '#0E7490' : '#1D4ED8'}
                              stroke={isSel ? '#F59E0B' : '#E2E8F0'}
                              strokeWidth={isSel ? 0.16 : 0.08}
                            />
                            <circle
                              cx={0.42}
                              cy={-0.42}
                              r={0.14}
                              fill={blinkTick % 2 === 0 ? '#22D3EE' : '#0891B2'}
                            />
                            <text
                              x={0}
                              y={1.25}
                              textAnchor="middle"
                              fontSize={0.58}
                              fill="#F8FAFC"
                              fontFamily="ui-monospace, monospace"
                              fontWeight="700"
                            >
                              {rack.assetId}
                            </text>
                          </g>
                        );
                      })}

                      {/* Interactive User Nodes */}
                      {floorUserNodes.map((node) => {
                        const pal = USER_NODE_PALETTE.find((p) => p.kind === node.nodeKind) ?? USER_NODE_PALETTE[0];
                        const isSel = inspected?.kind === 'user-node' && inspected.nodeId === node.id;
                        const statusColor =
                          node.status === 'error'
                            ? '#EF4444'
                            : node.status === 'degraded'
                              ? '#F59E0B'
                              : pal.color;
                        const rm = getRoomById(node.roomId);
                        const pathInfo = resolveNodePath(node);
                        const showNodeTip = (e: React.MouseEvent) => {
                          e.stopPropagation();
                          setHoverTip({
                            x: e.clientX,
                            y: e.clientY,
                            title: `${node.code} · ${node.name}`,
                            badge: node.status.toUpperCase(),
                            badgeTone: node.status === 'error' || node.status === 'offline' ? 'rose' : node.status === 'degraded' ? 'amber' : 'emerald',
                            subtitle: rm ? `${rm.code} · ${rm.name}` : activeNodeFloor.name,
                            rows: [
                              { label: 'Type / Jack', value: `${pal.label} · ${node.wallJackId}` },
                              { label: 'IP / VLAN', value: `${node.ipAddress} · ${node.vlan}` },
                              { label: 'Uplink', value: `${pathInfo.accessDev?.name ?? 'Access SW'} [${pathInfo.accessPort?.label ?? 'Gi1'}]` },
                              { label: 'Media / PoE', value: `${node.media}${node.poeWatts > 0 ? ` · ${node.poeWatts}W` : ''}` },
                            ],
                            hint: isReadOnly ? 'Click to inspect endpoint' : 'Click to inspect · Drag to relocate',
                          });
                        };
                        return (
                          <g
                            key={node.id}
                            transform={`translate(${node.x}, ${node.z})`}
                            className={isReadOnly ? 'cursor-pointer' : 'cursor-move'}
                            onMouseEnter={showNodeTip}
                            onMouseMove={showNodeTip}
                            onMouseLeave={() => setHoverTip(null)}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setInspected({ kind: 'user-node', nodeId: node.id });
                              if (!isReadOnly && !placingNodeKind) {
                                setDraggingNodeId(node.id);
                              }
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspected({ kind: 'user-node', nodeId: node.id });
                            }}
                          >
                            {isSel && (
                              <circle
                                r={0.82}
                                fill="none"
                                stroke="#F59E0B"
                                strokeWidth={0.11}
                                strokeDasharray="0.25 0.15"
                              />
                            )}
                            <circle
                              r={0.52}
                              fill="#0F172A"
                              stroke={statusColor}
                              strokeWidth={0.14}
                            />
                            <circle
                              cx={0.35}
                              cy={-0.35}
                              r={0.14}
                              fill={
                                node.status === 'error'
                                  ? blinkTick % 2 === 0
                                    ? '#EF4444'
                                    : '#450A0A'
                                  : blinkTick % 2 === 0
                                    ? '#10B981'
                                    : '#065F46'
                              }
                            />
                            <text
                              x={0}
                              y={0.18}
                              textAnchor="middle"
                              fontSize={0.34}
                              fill="#FFFFFF"
                              fontFamily="ui-monospace, monospace"
                              fontWeight="700"
                            >
                              {pal.short}
                            </text>
                            <text
                              x={0}
                              y={1.08}
                              textAnchor="middle"
                              fontSize={0.48}
                              fill="#CBD5E1"
                              fontFamily="ui-monospace, monospace"
                              fontWeight="600"
                            >
                              {node.code}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  )}
                </div>
                )}

                {/* Bottom User Node Connection Strip (3-Tier Summary) */}
                <div className="px-3 py-2 border-t border-zinc-800 bg-[#0F1018] flex items-center gap-2 overflow-x-auto shrink-0">
                  {floorUserNodes.length === 0 ? (
                    <span className="text-[11px] text-zinc-500">
                      No endpoints placed on this floor yet. Select a node type above and click inside any room, or use IT Builder for batch drops.
                    </span>
                  ) : (
                    floorUserNodes.map((n) => {
                      const isSel = inspected?.kind === 'user-node' && inspected.nodeId === n.id;
                      const p = resolveNodePath(n);
                      const rm = getRoomById(n.roomId);
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => setInspected({ kind: 'user-node', nodeId: n.id })}
                          onMouseEnter={(e) =>
                            setHoverTip({
                              x: e.clientX,
                              y: e.clientY,
                              title: `${n.code} · ${n.name}`,
                              badge: n.status.toUpperCase(),
                              badgeTone: n.status === 'error' || n.status === 'offline' ? 'rose' : n.status === 'degraded' ? 'amber' : 'emerald',
                              subtitle: rm ? `${rm.code} · ${rm.name}` : activeNodeFloor?.name,
                              rows: [
                                { label: 'Wall Jack / IP', value: `${n.wallJackId} · ${n.ipAddress}` },
                                { label: 'Switch Port', value: `${p.accessDev?.name ?? 'Access SW'} [${p.accessPort?.label ?? 'Gi1'}]` },
                                { label: 'VLAN', value: n.vlan },
                              ],
                            })
                          }
                          onMouseLeave={() => setHoverTip(null)}
                          className={`px-2.5 py-1.5 rounded-xl border text-left text-[10.5px] shrink-0 transition-colors cursor-pointer ${
                            isSel
                              ? 'border-amber-400 bg-violet-950/60 text-white'
                              : n.status === 'error'
                                ? 'border-rose-500/60 bg-rose-950/30 text-rose-200'
                                : 'border-zinc-800 bg-[#161824] text-zinc-300 hover:border-zinc-600'
                          }`}
                        >
                          <div className="font-mono font-bold flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                n.status === 'error'
                                  ? 'bg-rose-500'
                                  : n.status === 'degraded'
                                    ? 'bg-amber-400'
                                    : 'bg-emerald-400'
                              }`}
                            />
                            {n.code} ({n.wallJackId})
                          </div>
                          <div className="text-[9.5px] font-mono text-zinc-400">
                            {p.accessDev?.model?.slice(0, 15) ?? 'Access SW'} [{p.accessPort?.label ?? 'Gi1'}] → {p.coreRack?.assetId ?? 'DC-R01'}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ==================== TAB 3: 3-TIER IT ARCHITECTURE & UPLINKS (2D / 3D) ==================== */}
            {activeTab === 'topology' && (
              <div className="flex-1 min-h-0 flex flex-col bg-[#090A10] text-zinc-100 overflow-hidden">
                {viewDim === '3d' ? (
                  <div className="flex-1 min-h-[380px]">
                    <DataCenter3DViewer
                      mode="campus-topology"
                      rackAssets={itAssets}
                      activeRackId={activeAsset?.id ?? null}
                      userNodes={netArch.userNodes}
                      interRackLinks={netArch.interRackLinks}
                      floors={scene.floors}
                      buildings={scene.buildings}
                      rooms={scene.rooms}
                      walls={scene.walls}
                      selectedItemId={selected3DItemId}
                      onSelectRack={(rId) => {
                        handleInspectAndReveal({ kind: 'rack', rackId: rId });
                        setDetail3DTarget({ kind: 'rack', rackId: rId });
                      }}
                      onSelectDevice={(rId, dId) => {
                        handleInspectAndReveal({ kind: 'device', rackId: rId, deviceId: dId });
                        setDetail3DTarget({ kind: 'device', rackId: rId, deviceId: dId });
                      }}
                      onSelectUserNode={(nId) => {
                        handleInspectAndReveal({ kind: 'user-node', nodeId: nId });
                        setDetail3DTarget({ kind: 'user-node', nodeId: nId });
                      }}
                      onSelectRoom={(rmId, flId) => {
                        setDetail3DTarget({ kind: 'room', roomId: rmId, floorId: flId });
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-3.5 sm:p-4 space-y-5"
                    onScroll={() => setHoverTip(null)}
                  >
                    {/* Interactive Campus Buildings & Floors Navigator */}
                    {scene.buildings.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                            <Layers className="w-3.5 h-3.5 text-cyan-400" />
                            Campus Buildings &amp; Floors — Hover for Room/Equipment Summary · Click to Filter or Jump to 3D Twin
                          </div>
                          {topologyBuildingFilter !== 'all' && (
                            <button
                              type="button"
                              onClick={() => setTopologyBuildingFilter('all')}
                              className="text-[10.5px] text-cyan-400 hover:underline cursor-pointer"
                            >
                              Show All Buildings
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                          {scene.buildings.map((bldg) => {
                            const bFloors = scene.floors.filter((f) => f.buildingId === bldg.id);
                            const bFloorIds = new Set(bFloors.map((f) => f.id));
                            const bRooms = scene.rooms.filter((rm) => bFloorIds.has(rm.floorId));
                            const bRacks = itAssets.filter((r) => bFloorIds.has(r.floorId));
                            const bNodes = netArch.userNodes.filter((n) => bFloorIds.has(n.floorId));
                            const isFiltered = topologyBuildingFilter === bldg.id;
                            const bPowerW = bRacks.reduce(
                              (sum, rk) => sum + (rk.rackConfig?.devices ?? []).reduce((ds, d) => ds + d.powerW, 0),
                              0
                            );
                            const showBldgTip = (e: React.MouseEvent) => {
                              setHoverTip({
                                x: e.clientX,
                                y: e.clientY,
                                title: `${bldg.code} · ${bldg.name}`,
                                badge: 'BUILDING',
                                badgeTone: 'cyan',
                                subtitle: `${bFloors.length} floor${bFloors.length === 1 ? '' : 's'} · ${bRooms.length} rooms`,
                                rows: [
                                  { label: 'IT Racks', value: `${bRacks.length} (${bRacks.map((r) => r.assetId).slice(0, 4).join(', ') || 'None'})` },
                                  { label: 'Endpoints', value: `${bNodes.length} active room drops` },
                                  { label: 'IT Power Load', value: `${(bPowerW / 1000).toFixed(2)} kW` },
                                ],
                                hint: 'Click to filter 3-Tier topology by this building',
                              });
                            };
                            return (
                              <div
                                key={bldg.id}
                                onMouseEnter={showBldgTip}
                                onMouseMove={showBldgTip}
                                onMouseLeave={() => setHoverTip(null)}
                                onClick={() => {
                                  setTopologyBuildingFilter((cur) => (cur === bldg.id ? 'all' : bldg.id));
                                  if (bRacks[0]) {
                                    handleInspectAndReveal({ kind: 'rack', rackId: bRacks[0].id }, false);
                                  }
                                }}
                                className={`p-2.5 rounded-xl border transition-colors cursor-pointer space-y-1.5 ${
                                  isFiltered
                                    ? 'bg-cyan-950/35 border-cyan-400 ring-1 ring-cyan-400/40'
                                    : 'bg-[#10131F] border-zinc-800 hover:border-cyan-500/60'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold text-white truncate">
                                      {bldg.code} · {bldg.name}
                                    </div>
                                    <div className="text-[10px] font-mono text-zinc-400 tabular-nums">
                                      {bFloors.length} floors · {bRooms.length} rooms · {bRacks.length} racks · {bNodes.length} endpoints
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleLocateObjectIn3DTwin({ buildingId: bldg.id });
                                    }}
                                    className="px-2 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/40 hover:bg-cyan-500/30 text-[10px] font-mono font-semibold text-cyan-300 shrink-0 cursor-pointer"
                                    title="Open this building in 3D Digital Twin"
                                  >
                                    3D Twin
                                  </button>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {bFloors.map((fl) => {
                                    const flRooms = scene.rooms.filter((rm) => rm.floorId === fl.id);
                                    const flRacks = itAssets.filter((r) => r.floorId === fl.id);
                                    const flNodes = netArch.userNodes.filter((n) => n.floorId === fl.id);
                                    return (
                                      <button
                                        key={fl.id}
                                        type="button"
                                        onMouseEnter={(e) => {
                                          e.stopPropagation();
                                          setHoverTip({
                                            x: e.clientX,
                                            y: e.clientY,
                                            title: `${fl.code} · ${fl.name}`,
                                            badge: `LEVEL ${fl.levelIndex}`,
                                            badgeTone: 'violet',
                                            subtitle: `${bldg.code} · ${bldg.name}`,
                                            rows: [
                                              { label: 'Rooms', value: `${flRooms.length} (${flRooms.slice(0, 4).map((r) => r.code).join(', ')})` },
                                              { label: 'Racks', value: `${flRacks.length}` },
                                              { label: 'Endpoints', value: `${flNodes.length}` },
                                            ],
                                            hint: 'Click to open Endpoints & Drops floor plan',
                                          });
                                        }}
                                        onMouseMove={(e) => {
                                          e.stopPropagation();
                                          setHoverTip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
                                        }}
                                        onMouseLeave={() => setHoverTip(null)}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setNodeFloorId(fl.id);
                                          setActiveTab('user-nodes');
                                          showToast(`Opened ${fl.code} · ${fl.name} Endpoints & Drops map`, 'info');
                                        }}
                                        className="px-1.5 py-0.5 rounded bg-[#181D2E] border border-zinc-700/80 hover:border-cyan-400 text-[9.5px] font-mono text-zinc-300 cursor-pointer"
                                      >
                                        {fl.code}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Tier 1: Core Data Center (MDF) */}
                    {(() => {
                      const matchesBuilding = (floorId: string) => {
                        if (topologyBuildingFilter === 'all') return true;
                        const fl = getFloorById(floorId);
                        return fl?.buildingId === topologyBuildingFilter;
                      };
                      const filteredCoreRacks = coreRacks.filter((r) => matchesBuilding(r.floorId));
                      const filteredIdfRacks = idfRacks.filter((r) => matchesBuilding(r.floorId));
                      return (
                        <>
                          <div className="space-y-2">
                            <div className="text-[10.5px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-cyan-400" />
                              Tier 1 · Core Data Center Layer (MDF · 40G/100G Core Fabric · {filteredCoreRacks.length})
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {filteredCoreRacks.map((rack) => {
                                const fl = getFloorById(rack.floorId);
                                const rm = getRoomById(rack.roomId);
                                const devs = rack.rackConfig?.devices ?? [];
                                const totalPorts = devs.reduce((s, d) => s + d.ports.length, 0);
                                const upPorts = devs.reduce((s, d) => s + d.ports.filter((p) => p.status === 'up').length, 0);
                                const isRackSelected =
                                  (inspected?.kind === 'rack' || inspected?.kind === 'device' || inspected?.kind === 'port') &&
                                  inspected.rackId === rack.id;
                                const showCoreRackTip = (e: React.MouseEvent) => {
                                  setHoverTip({
                                    x: e.clientX,
                                    y: e.clientY,
                                    title: `${rack.assetId} · ${rack.name}`,
                                    badge: 'CORE MDF',
                                    badgeTone: 'cyan',
                                    subtitle: `${fl?.code ?? ''}${rm ? ` · ${rm.code} ${rm.name}` : ''}`,
                                    rows: [
                                      { label: 'Room & Zone', value: rm ? `${rm.code} · ${rm.name}` : rack.rackConfig?.locationZone ?? 'MDF' },
                                      { label: 'Subnet / Cooling', value: `${rack.rackConfig?.subnetCidr ?? '—'} · ${rack.rackConfig?.coolingZone ?? 'Aisle A1'}` },
                                      { label: 'Gear & Ports', value: `${devs.length} devices · ${upPorts}/${totalPorts} ports UP` },
                                    ],
                                    hint: 'Click to inspect rack details in side inspector',
                                  });
                                };
                                return (
                                  <div
                                    key={rack.id}
                                    onMouseEnter={showCoreRackTip}
                                    onMouseMove={showCoreRackTip}
                                    onMouseLeave={() => setHoverTip(null)}
                                    onClick={() => handleInspectAndReveal({ kind: 'rack', rackId: rack.id })}
                                    className={`p-3 rounded-2xl bg-[#111522] border transition-all cursor-pointer space-y-2 ${
                                      isRackSelected
                                        ? 'border-amber-400 ring-1 ring-amber-400/50'
                                        : 'border-cyan-500/45 hover:border-cyan-400'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-xs font-bold text-white truncate">{rack.name}</div>
                                        <div className="text-[10px] font-mono text-cyan-300 truncate">
                                          {rack.assetId} · {fl?.code} {rm ? `(${rm.code} · ${rm.name})` : ''} · {rack.rackConfig?.subnetCidr}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedAssetId(rack.id);
                                            setInspected({ kind: 'rack', rackId: rack.id });
                                            setActiveTab('racks');
                                          }}
                                          className="px-1.5 py-0.5 rounded-md bg-zinc-800 hover:bg-violet-600 text-[9.5px] font-mono text-zinc-200 hover:text-white cursor-pointer"
                                          title="Open 42U Rack & Ports Designer"
                                        >
                                          Ports
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleLocateObjectIn3DTwin({ rackId: rack.id });
                                          }}
                                          className="px-1.5 py-0.5 rounded-md bg-cyan-950/70 border border-cyan-500/40 hover:bg-cyan-600 text-[9.5px] font-mono text-cyan-200 hover:text-white cursor-pointer"
                                          title="Locate in 3D Digital Twin"
                                        >
                                          3D
                                        </button>
                                        <span className={`w-2.5 h-2.5 rounded-full ml-0.5 ${getLedVisual('up', true, blinkTick)}`} />
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {devs.map((d) => {
                                        const isDevSel =
                                          (inspected?.kind === 'device' || inspected?.kind === 'port') &&
                                          inspected.deviceId === d.id;
                                        const dUp = d.ports.filter((p) => p.status === 'up').length;
                                        return (
                                          <button
                                            key={d.id}
                                            type="button"
                                            onMouseEnter={(e) => {
                                              e.stopPropagation();
                                              setHoverTip({
                                                x: e.clientX,
                                                y: e.clientY,
                                                title: d.name,
                                                badge: d.status.toUpperCase(),
                                                badgeTone: d.status === 'offline' ? 'rose' : d.status === 'warning' ? 'amber' : 'emerald',
                                                subtitle: `${rack.assetId} · U${d.uStart}${rm ? ` · ${rm.code} ${rm.name}` : ''}`,
                                                rows: [
                                                  { label: 'Model', value: `${d.vendor} ${d.model}` },
                                                  { label: 'IP / VLAN', value: `${d.ipAddress} · ${d.vlan}` },
                                                  { label: 'Ports / Power', value: `${dUp}/${d.ports.length} UP · ${d.powerW}W` },
                                                ],
                                                hint: 'Click to inspect device & ports',
                                              });
                                            }}
                                            onMouseMove={(e) => {
                                              e.stopPropagation();
                                              setHoverTip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
                                            }}
                                            onMouseLeave={() => setHoverTip(null)}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleInspectAndReveal({ kind: 'device', rackId: rack.id, deviceId: d.id });
                                            }}
                                            className={`px-2 py-1 rounded-lg border text-[10px] font-mono cursor-pointer transition-colors ${
                                              isDevSel
                                                ? 'bg-cyan-500/20 border-amber-400 text-white'
                                                : 'bg-[#1A2033] border-zinc-700 hover:border-cyan-400 text-zinc-200'
                                            }`}
                                          >
                                            {d.name} ({d.ipAddress})
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Active Inter-Rack Fiber Trunks */}
                          <div className="p-3 rounded-2xl bg-[#121420] border border-zinc-800 space-y-2.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="text-[10.5px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                                <Cable className="w-3.5 h-3.5" />
                                Inter-Rack Fiber Uplinks (IDF Distribution ⇄ Core DC · {netArch.interRackLinks.length})
                              </div>
                              {!isReadOnly && (
                                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                  <select
                                    value={uplinkFromRack}
                                    onChange={(e) => setUplinkFromRack(e.target.value)}
                                    className="px-2 py-1 rounded-lg bg-[#0A0B11] border border-zinc-700 text-zinc-200"
                                  >
                                    <option value="">From IDF Rack…</option>
                                    {itAssets.map((r) => (
                                      <option key={r.id} value={r.id}>{r.assetId} · {r.name.slice(0, 18)}</option>
                                    ))}
                                  </select>
                                  <ArrowRight className="w-3 h-3 text-zinc-500" />
                                  <select
                                    value={uplinkToRack}
                                    onChange={(e) => setUplinkToRack(e.target.value)}
                                    className="px-2 py-1 rounded-lg bg-[#0A0B11] border border-zinc-700 text-zinc-200"
                                  >
                                    <option value="">To Core/Dist Rack…</option>
                                    {itAssets.map((r) => (
                                      <option key={r.id} value={r.id}>{r.assetId} · {r.name.slice(0, 18)}</option>
                                    ))}
                                  </select>
                                  <select
                                    value={uplinkSpeed}
                                    onChange={(e) => setUplinkSpeed(Number(e.target.value))}
                                    className="px-2 py-1 rounded-lg bg-[#0A0B11] border border-zinc-700 text-zinc-200"
                                  >
                                    <option value={10}>10G SFP+</option>
                                    <option value={40}>40G QSFP+</option>
                                    <option value={100}>100G QSFP28</option>
                                  </select>
                                  <select
                                    value={uplinkMedia}
                                    onChange={(e) => setUplinkMedia(e.target.value as NetworkInterRackLink['media'])}
                                    className="px-2 py-1 rounded-lg bg-[#0A0B11] border border-zinc-700 text-zinc-200"
                                  >
                                    <option value="OM4 Fiber">OM4 Fiber</option>
                                    <option value="OS2 Single-Mode">OS2 Fiber</option>
                                    <option value="DAC Twinax">DAC Twinax</option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={handleAddInterRackUplink}
                                    className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold cursor-pointer"
                                  >
                                    + Add Trunk
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {netArch.interRackLinks.map((lnk, lIdx) => {
                                const rFrom = getRackById(lnk.fromRackId);
                                const rTo = getRackById(lnk.toRackId);
                                const rmFrom = rFrom ? getRoomById(rFrom.roomId) : undefined;
                                const rmTo = rTo ? getRoomById(rTo.roomId) : undefined;
                                const showLinkTip = (e: React.MouseEvent) => {
                                  setHoverTip({
                                    x: e.clientX,
                                    y: e.clientY,
                                    title: `${rFrom?.assetId ?? lnk.fromRackId} ⇄ ${rTo?.assetId ?? lnk.toRackId}`,
                                    badge: `${lnk.speedGbps}G ${lnk.status.toUpperCase()}`,
                                    badgeTone: lnk.status === 'down' ? 'rose' : lnk.status === 'degraded' ? 'amber' : 'cyan',
                                    subtitle: `${lnk.media} · ${lnk.vlanTrunk}`,
                                    rows: [
                                      { label: 'Source Room', value: rmFrom ? `${rmFrom.code} · ${rmFrom.name}` : rFrom?.name ?? '—' },
                                      { label: 'Target Room', value: rmTo ? `${rmTo.code} · ${rmTo.name}` : rTo?.name ?? '—' },
                                      { label: 'Telemetry', value: `Util ${lnk.utilizationPct}% · Rx ${lnk.opticalRxDbm} dBm · CRC ${lnk.crcErrors}` },
                                    ],
                                    hint: 'Click to inspect uplink transceiver port',
                                  });
                                };
                                return (
                                  <div
                                    key={lnk.id}
                                    onMouseEnter={showLinkTip}
                                    onMouseMove={showLinkTip}
                                    onMouseLeave={() => setHoverTip(null)}
                                    onClick={() => {
                                      if (rFrom) {
                                        handleInspectAndReveal({
                                          kind: 'port',
                                          rackId: rFrom.id,
                                          deviceId: lnk.fromDeviceId,
                                          portId: lnk.fromPortId,
                                        });
                                      }
                                    }}
                                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#0B0D15] border border-zinc-800 hover:border-amber-400/70 text-[11px] cursor-pointer transition-colors"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span
                                        className={`w-2 h-2 rounded-full shrink-0 ${getLedVisual(
                                          lnk.status === 'down' ? 'down' : lnk.status === 'degraded' ? 'error' : 'up',
                                          true,
                                          blinkTick + lIdx
                                        )}`}
                                      />
                                      <div className="min-w-0">
                                        <div className="font-semibold text-zinc-100 truncate">
                                          {rFrom?.assetId ?? lnk.fromRackId} ── {lnk.speedGbps}G {lnk.media} ──▶ {rTo?.assetId ?? lnk.toRackId}
                                        </div>
                                        <div className="text-[10px] font-mono text-zinc-400">
                                          {lnk.vlanTrunk} · Util {lnk.utilizationPct}% · Rx {lnk.opticalRxDbm} dBm · CRC {lnk.crcErrors}
                                        </div>
                                      </div>
                                    </div>
                                    {!isReadOnly && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          deleteInterRackLink(lnk.id);
                                        }}
                                        className="text-zinc-500 hover:text-rose-400 cursor-pointer shrink-0"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Tier 2 & 3: Floor Distribution IDF Racks -> Access Switches -> Endpoints */}
                          <div className="space-y-2">
                            <div className="text-[10.5px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-blue-400" />
                              Tier 2 &amp; 3 · Floor Distribution IDF Racks → Access Switches → Room Endpoints ({filteredIdfRacks.length})
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {filteredIdfRacks.map((rack) => {
                                const fl = getFloorById(rack.floorId);
                                const rm = getRoomById(rack.roomId);
                                const connectedNodes = netArch.userNodes.filter((n) => n.connectedRackId === rack.id);
                                const devs = rack.rackConfig?.devices ?? [];
                                const isRackSelected =
                                  (inspected?.kind === 'rack' || inspected?.kind === 'device' || inspected?.kind === 'port') &&
                                  inspected.rackId === rack.id;
                                const showIdfRackTip = (e: React.MouseEvent) => {
                                  setHoverTip({
                                    x: e.clientX,
                                    y: e.clientY,
                                    title: `${rack.assetId} · ${rack.name}`,
                                    badge: rack.rackConfig?.rackRole === 'access-closet' ? 'ACCESS CLOSET' : 'FLOOR IDF',
                                    badgeTone: 'blue',
                                    subtitle: `${fl?.code ?? ''}${rm ? ` · ${rm.code} ${rm.name}` : ''}`,
                                    rows: [
                                      { label: 'Room', value: rm ? `${rm.code} · ${rm.name}` : 'Floor Closet' },
                                      { label: 'Mounted Switches', value: `${devs.length} unit${devs.length === 1 ? '' : 's'}` },
                                      { label: 'Room Endpoints', value: `${connectedNodes.length} active drop${connectedNodes.length === 1 ? '' : 's'}` },
                                    ],
                                    hint: 'Click to inspect rack · Use Ports or 3D buttons to jump',
                                  });
                                };
                                return (
                                  <div
                                    key={rack.id}
                                    onMouseEnter={showIdfRackTip}
                                    onMouseMove={showIdfRackTip}
                                    onMouseLeave={() => setHoverTip(null)}
                                    className={`p-3 rounded-2xl bg-[#111420] border transition-all space-y-2.5 ${
                                      isRackSelected
                                        ? 'border-amber-400 ring-1 ring-amber-400/50'
                                        : 'border-blue-500/35 hover:border-blue-400/70'
                                    }`}
                                  >
                                    <div
                                      className="flex items-start justify-between gap-2 cursor-pointer"
                                      onClick={() => handleInspectAndReveal({ kind: 'rack', rackId: rack.id })}
                                    >
                                      <div className="min-w-0">
                                        <div className="text-xs font-bold text-white truncate">{rack.name}</div>
                                        <div className="text-[10px] font-mono text-blue-300 truncate">
                                          {rack.assetId} · {fl?.code} {rm ? `(${rm.code} ${rm.name})` : ''}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        <span className="text-[9.5px] font-mono text-zinc-400 mr-1">
                                          {connectedNodes.length} drops
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedAssetId(rack.id);
                                            setInspected({ kind: 'rack', rackId: rack.id });
                                            setActiveTab('racks');
                                          }}
                                          className="px-1.5 py-0.5 rounded-md bg-zinc-800 hover:bg-violet-600 text-[9.5px] font-mono text-zinc-200 hover:text-white cursor-pointer"
                                        >
                                          Ports
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleLocateObjectIn3DTwin({ rackId: rack.id });
                                          }}
                                          className="px-1.5 py-0.5 rounded-md bg-cyan-950/70 border border-cyan-500/40 hover:bg-cyan-600 text-[9.5px] font-mono text-cyan-200 hover:text-white cursor-pointer"
                                        >
                                          3D
                                        </button>
                                      </div>
                                    </div>

                                    {/* Distribution & Access Switches inside this IDF */}
                                    <div className="space-y-1">
                                      {devs.map((dev) => {
                                        const isDevSel =
                                          (inspected?.kind === 'device' || inspected?.kind === 'port') &&
                                          inspected.deviceId === dev.id;
                                        const dUp = dev.ports.filter((p) => p.status === 'up').length;
                                        return (
                                          <button
                                            key={dev.id}
                                            type="button"
                                            onMouseEnter={(e) => {
                                              e.stopPropagation();
                                              setHoverTip({
                                                x: e.clientX,
                                                y: e.clientY,
                                                title: dev.name,
                                                badge: dev.status.toUpperCase(),
                                                badgeTone: dev.status === 'offline' ? 'rose' : dev.status === 'warning' ? 'amber' : 'emerald',
                                                subtitle: `${rack.assetId} · U${dev.uStart}${rm ? ` · ${rm.code} ${rm.name}` : ''}`,
                                                rows: [
                                                  { label: 'Model', value: `${dev.vendor} ${dev.model}` },
                                                  { label: 'IP / VLAN', value: `${dev.ipAddress} · ${dev.vlan}` },
                                                  { label: 'Ports / Power', value: `${dUp}/${dev.ports.length} UP · ${dev.powerW}W` },
                                                ],
                                                hint: 'Click to inspect switch ports & telemetry',
                                              });
                                            }}
                                            onMouseMove={(e) => {
                                              e.stopPropagation();
                                              setHoverTip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
                                            }}
                                            onMouseLeave={() => setHoverTip(null)}
                                            onClick={() => handleInspectAndReveal({ kind: 'device', rackId: rack.id, deviceId: dev.id })}
                                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl border text-left text-[10.5px] cursor-pointer transition-colors ${
                                              isDevSel
                                                ? 'bg-cyan-500/15 border-amber-400 text-white'
                                                : 'bg-[#181C2C] border-zinc-800 hover:border-teal-400 text-zinc-100'
                                            }`}
                                          >
                                            <span className="truncate font-semibold">
                                              {dev.name} <span className="font-mono text-zinc-400">({dev.model})</span>
                                            </span>
                                            <span className="flex items-center gap-1 shrink-0">
                                              {dev.ports.slice(0, 5).map((p, idx) => (
                                                <span
                                                  key={p.id}
                                                  className={`w-1.5 h-1.5 rounded-full ${getLedVisual(p.status, p.isUplink, blinkTick + idx)}`}
                                                />
                                              ))}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>

                                    {/* Connected User Nodes */}
                                    {connectedNodes.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-zinc-800/80">
                                        {connectedNodes.map((n) => {
                                          const isNodeSel = inspected?.kind === 'user-node' && inspected.nodeId === n.id;
                                          const nRm = getRoomById(n.roomId);
                                          const nFl = getFloorById(n.floorId);
                                          return (
                                            <button
                                              key={n.id}
                                              type="button"
                                              onMouseEnter={(e) => {
                                                e.stopPropagation();
                                                setHoverTip({
                                                  x: e.clientX,
                                                  y: e.clientY,
                                                  title: `${n.code} · ${n.name}`,
                                                  badge: n.status.toUpperCase(),
                                                  badgeTone: n.status === 'error' || n.status === 'offline' ? 'rose' : n.status === 'degraded' ? 'amber' : 'emerald',
                                                  subtitle: `${nFl?.code ?? ''}${nRm ? ` · ${nRm.code} ${nRm.name}` : ''}`,
                                                  rows: [
                                                    { label: 'Room & Jack', value: `${nRm ? `${nRm.code} · ${nRm.name}` : 'Floor'} (${n.wallJackId})` },
                                                    { label: 'IP / VLAN', value: `${n.ipAddress} · ${n.vlan}` },
                                                    { label: 'Media / PoE', value: `${n.media}${n.poeWatts > 0 ? ` · ${n.poeWatts}W` : ''}` },
                                                  ],
                                                  hint: 'Click to inspect endpoint & trace path',
                                                });
                                              }}
                                              onMouseMove={(e) => {
                                                e.stopPropagation();
                                                setHoverTip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
                                              }}
                                              onMouseLeave={() => setHoverTip(null)}
                                              onClick={() => handleInspectAndReveal({ kind: 'user-node', nodeId: n.id })}
                                              className={`px-2 py-0.5 rounded-lg text-[10px] font-mono border cursor-pointer transition-colors ${
                                                isNodeSel
                                                  ? 'border-amber-400 bg-amber-500/20 text-white ring-1 ring-amber-400/50'
                                                  : n.status === 'error'
                                                    ? 'border-rose-500/70 bg-rose-950/50 text-rose-300'
                                                    : 'border-teal-500/40 bg-teal-950/30 text-teal-200 hover:border-teal-400'
                                              }`}
                                            >
                                              {n.code} · {nRm?.code ?? n.wallJackId}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* ==================== TAB 4: QUICK IT ARCHITECTURE DESIGNER (FAST DATA ENTRY) ==================== */}
            {activeTab === 'builder' && (
              <ItArchitectureQuickBuilder
                buildings={scene.buildings}
                floors={scene.floors}
                rooms={scene.rooms}
                itAssets={itAssets}
                userNodes={netArch.userNodes}
                interRackLinks={netArch.interRackLinks}
                isReadOnly={isReadOnly}
                onAddRack={addDistributionRackToRoom}
                onUpdateRackAsset={updateAsset}
                onAddUserNode={addNetworkUserNode}
                onAddInterRackLink={addInterRackLink}
                onInspectTarget={(target) => handleInspectAndReveal(target)}
                onOpenRackPorts={(rackId) => {
                  setSelectedAssetId(rackId);
                  setInspected({ kind: 'rack', rackId });
                  setActiveTab('racks');
                }}
                onLocateIn3D={({ rackId, floorId }) =>
                  handleLocateObjectIn3DTwin({ rackId, floorId })
                }
                showToast={showToast}
              />
            )}

            {/* ==================== TAB 4: MONITORING API CONNECTORS ==================== */}
            {activeTab === 'monitoring' && (
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 space-y-4 bg-zinc-50 dark:bg-[#0D0E14]">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                      <Radio className="w-4 h-4 text-emerald-500" />
                      External Network &amp; Infrastructure Monitoring Connectors
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Bind live SNMPv3 traps, Prometheus exporters, Zabbix, NetBox DCIM, or Cisco Catalyst Center telemetry endpoints directly to racks, switches, ports, and user drops.
                    </p>
                  </div>
                </div>

                {/* Add Connector Form */}
                {!isReadOnly && (
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-[#141620] border border-zinc-200 dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-3">
                      <label className="text-[10px] text-zinc-500 block mb-1">Connector Name</label>
                      <input
                        value={newApiName}
                        onChange={(e) => setNewApiName(e.target.value)}
                        placeholder="e.g. Campus Zabbix NOC"
                        className="w-full px-2.5 py-1.5 rounded-xl bg-zinc-50 dark:bg-[#0D0E14] border border-zinc-200 dark:border-zinc-700 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="text-[10px] text-zinc-500 block mb-1">Provider Protocol</label>
                      <select
                        value={newApiProvider}
                        onChange={(e) => setNewApiProvider(e.target.value as MonitoringApiConnector['provider'])}
                        className="w-full px-2.5 py-1.5 rounded-xl bg-zinc-50 dark:bg-[#0D0E14] border border-zinc-200 dark:border-zinc-700 text-xs"
                      >
                        <option value="SNMPv3">SNMPv3 Polling &amp; Traps</option>
                        <option value="Prometheus">Prometheus HTTP API</option>
                        <option value="Zabbix">Zabbix JSON-RPC</option>
                        <option value="NetBox">NetBox DCIM REST</option>
                        <option value="Cisco Catalyst Center">Cisco Catalyst Center</option>
                        <option value="Custom REST">Custom REST Webhook</option>
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <label className="text-[10px] text-zinc-500 block mb-1">Endpoint URL</label>
                      <input
                        value={newApiUrl}
                        onChange={(e) => setNewApiUrl(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-xl bg-zinc-50 dark:bg-[#0D0E14] border border-zinc-200 dark:border-zinc-700 text-xs font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!newApiName.trim()) {
                            showToast('Enter a connector name first.', 'warning');
                            return;
                          }
                          upsertMonitoringConnector({
                            id: `mon-${Date.now()}`,
                            name: newApiName.trim(),
                            provider: newApiProvider,
                            endpointUrl: newApiUrl.trim() || 'https://monitor.facility.local/api',
                            authType: newApiProvider === 'SNMPv3' ? 'snmp-v3' : 'bearer',
                            pollIntervalSec: 15,
                            enabled: true,
                            lastStatus: 'idle',
                            mappedMetrics: ['ifHCInOctets', 'ifInErrors', 'poeWatts', 'opticalRxDbm', 'deviceTempC'],
                          });
                          setNewApiName('');
                        }}
                        className="w-full py-1.5 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
                      >
                        + Add API
                      </button>
                    </div>
                  </div>
                )}

                {/* Connectors List */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {netArch.monitoringApis.map((api) => (
                    <div
                      key={api.id}
                      className="p-3.5 rounded-2xl bg-white dark:bg-[#141620] border border-zinc-200 dark:border-zinc-800 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                api.lastStatus === 'connected'
                                  ? 'bg-emerald-500'
                                  : api.lastStatus === 'error'
                                    ? 'bg-rose-500'
                                    : 'bg-zinc-400'
                              }`}
                            />
                            <span className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                              {api.name}
                            </span>
                          </div>
                          <div className="text-[10.5px] font-mono text-cyan-600 dark:text-cyan-400 mt-0.5">
                            {api.provider} · Auth: {api.authType} · Poll {api.pollIntervalSec}s
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => upsertMonitoringConnector({ ...api, enabled: !api.enabled })}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-50 ${
                              api.enabled
                                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/40'
                                : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
                            }`}
                          >
                            {api.enabled ? 'ENABLED' : 'PAUSED'}
                          </button>
                          {!isReadOnly && (
                            <button
                              type="button"
                              onClick={() => deleteMonitoringConnector(api.id)}
                              className="p-1 rounded-lg text-zinc-400 hover:text-rose-500 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <input
                        value={api.endpointUrl}
                        disabled={isReadOnly}
                        onChange={(e) => upsertMonitoringConnector({ ...api, endpointUrl: e.target.value })}
                        className="w-full px-2.5 py-1.5 rounded-xl bg-zinc-50 dark:bg-[#0C0D14] border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono disabled:opacity-75"
                      />

                      <div className="flex flex-wrap gap-1">
                        {api.mappedMetrics.map((m) => (
                          <span
                            key={m}
                            className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[9.5px] font-mono text-zinc-600 dark:text-zinc-300"
                          >
                            {m}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-zinc-200 dark:border-zinc-800 text-[10.5px]">
                        <span className="font-mono text-zinc-500">
                          {api.lastCheckedAt
                            ? `Checked ${new Date(api.lastCheckedAt).toLocaleTimeString()}`
                            : 'Ready for live API key / proxy handshake'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setTestingApiId(api.id);
                            window.setTimeout(() => {
                              const validUrl = /^https?:\/\/|^snmp:\/\/|^udp:\/\//i.test(api.endpointUrl);
                              upsertMonitoringConnector({
                                ...api,
                                lastStatus: validUrl ? 'connected' : 'error',
                                lastCheckedAt: new Date().toISOString(),
                              });
                              setTestingApiId(null);
                              showToast(
                                validUrl
                                  ? `Verified ${api.provider} connector schema (${api.mappedMetrics.length} metrics bound)`
                                  : `Invalid endpoint URI on ${api.name}`,
                                validUrl ? 'success' : 'warning'
                              );
                            }, 350);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold cursor-pointer"
                        >
                          <RefreshCw className={`w-3 h-3 ${testingApiId === api.id ? 'animate-spin' : ''}`} />
                          Test Handshake
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN (4 cols): UNIVERSAL DEEP INSPECTOR — ID, PORT/CABLE TRACE TO 3D & 2D, ERRORS & LABEL */}
          <div
            className={`${
              mobilePane === 'workspace'
                ? showInspectorPane
                  ? 'hidden lg:flex'
                  : 'hidden'
                : showInspectorPane
                  ? 'flex'
                  : 'flex lg:hidden'
            } flex-1 min-h-0 lg:col-span-4 flex-col overflow-y-auto overscroll-contain touch-pan-y bg-white dark:bg-[#11121A] p-4 space-y-4`}
          >
            {!inspectedContext ? (
              <div className="p-6 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 text-center text-xs text-zinc-500">
                Click any Rack, Switch, Port, or User Node to inspect its full IT identification, end-to-end 3D/2D cable trace, live error telemetry, and printable barcode/QR label.
              </div>
            ) : (
              <>
                {/* Identification Header + Prominent Print Label CTA */}
                <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#171924] border border-zinc-200 dark:border-zinc-800 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
                        {inspectedContext.labelPayload.kind.replace('-', ' ')} · {inspectedContext.labelPayload.code}
                      </div>
                      <h3 className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                        {inspectedContext.labelPayload.title}
                      </h3>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {inspectedContext.labelPayload.subtitle}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLabelToPrint(inspectedContext.labelPayload)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-[11px] font-bold shrink-0 shadow-sm cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print Label
                    </button>
                  </div>

                  {/* Identification Metadata Grid */}
                  <div className="grid grid-cols-2 gap-1.5 text-[10.5px] font-mono bg-white dark:bg-[#10121B] p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <div className="col-span-2 truncate">
                      <span className="text-zinc-400">Location:</span> {inspectedContext.labelPayload.location}
                    </div>
                    <div className="col-span-2 truncate text-violet-600 dark:text-violet-400">
                      <span className="text-zinc-400">Network:</span> {inspectedContext.labelPayload.ipOrVlan}
                    </div>
                    <div className="col-span-2 truncate text-cyan-600 dark:text-cyan-400">
                      <span className="text-zinc-400">Uplink Path:</span> {inspectedContext.labelPayload.uplinkPath}
                    </div>
                    <div className="col-span-2 truncate text-zinc-500">
                      <span className="text-zinc-400">ID / MAC:</span> {inspectedContext.labelPayload.serialOrMac}
                    </div>
                  </div>
                </div>

                {/* End-to-End Port & Cable Path Trace → Direct Jump to 3D & 2D Floor Plan */}
                {inspectedTrace && (
                  <div className="p-3.5 rounded-2xl bg-cyan-500/[0.06] dark:bg-cyan-500/[0.08] border border-cyan-500/35 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Route className="w-4 h-4 text-cyan-500 shrink-0" />
                        <span className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                          End-to-End Signal &amp; Cable Trace
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-600 dark:text-cyan-300 shrink-0">
                        {inspectedTrace.hops.length} hops
                      </span>
                    </div>

                    {/* Hop-by-hop schematic chain */}
                    <ol className="space-y-1.5">
                      {inspectedTrace.hops.map((hop, idx) => (
                        <li
                          key={hop.id}
                          className="flex items-start gap-2 text-[11px] bg-white/80 dark:bg-[#10131D] px-2.5 py-1.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800"
                        >
                          <span className="w-4 h-4 rounded-full bg-cyan-600 text-white font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                              {hop.label}
                            </div>
                            <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                              {hop.sublabel}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>

                    {/* Prominent 3D & 2D Trace Navigation Buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => startNetworkTrace(inspectedTrace, '3d')}
                        className="min-h-[40px] px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <Box className="w-3.5 h-3.5" />
                        Trace in 3D
                      </button>
                      <button
                        type="button"
                        onClick={() => startNetworkTrace(inspectedTrace, '2d')}
                        className="min-h-[40px] px-3 rounded-xl border border-cyan-500/50 bg-white dark:bg-[#111522] hover:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <MapIcon className="w-3.5 h-3.5" />
                        Trace in 2D
                      </button>
                    </div>
                  </div>
                )}

                {/* Errors & Health Callout */}
                {(() => {
                  const errCount =
                    inspectedContext.kind === 'user-node'
                      ? inspectedContext.node.crcErrors
                      : inspectedContext.kind === 'port'
                        ? inspectedContext.port.crcErrors ?? 0
                        : inspectedContext.crcSum;
                  const isBad =
                    errCount > 0 ||
                    (inspectedContext.kind === 'device' && inspectedContext.dev.status === 'offline') ||
                    (inspectedContext.kind === 'user-node' &&
                      (inspectedContext.node.status === 'error' ||
                        inspectedContext.node.status === 'degraded' ||
                        inspectedContext.node.status === 'offline')) ||
                    (inspectedContext.kind === 'port' &&
                      (inspectedContext.port.status === 'error' || inspectedContext.port.status === 'down'));

                  return (
                    <div
                      className={`p-3 rounded-2xl border space-y-2 ${
                        isBad
                          ? 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-200'
                          : 'bg-emerald-500/8 border-emerald-500/30 text-emerald-700 dark:text-emerald-200'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="flex items-center gap-1.5">
                          {isBad ? <ShieldAlert className="w-4 h-4 text-rose-500" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                          {inspectedContext.kind === 'device' && inspectedContext.dev.status === 'offline'
                            ? 'Device Offline — Red Outage Active'
                            : isBad
                              ? 'Active Link / CRC Error Detected'
                              : 'Diagnostics & Link Health Nominal'}
                        </span>
                        <span className="font-mono tabular-nums text-[11px]">
                          CRC: {errCount}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-[10.5px]">
                        {inspectedContext.kind === 'user-node' && (
                          <>
                            <div>BW: {inspectedContext.node.bandwidthMbps} Mbps</div>
                            <div>Lat: {inspectedContext.node.latencyMs} ms</div>
                            <div>Loss: {inspectedContext.node.packetLossPct}%</div>
                          </>
                        )}
                        {inspectedContext.kind === 'port' && (
                          <>
                            <div>Util: {inspectedContext.port.utilizationPct ?? 20}%</div>
                            <div>PoE: {inspectedContext.port.poeWatts ?? 0}W</div>
                            <div>Rx: {inspectedContext.port.opticalDbm ?? -2.4} dBm</div>
                          </>
                        )}
                        {inspectedContext.kind === 'device' && (
                          <>
                            <div>CPU: {inspectedContext.dev.cpuPct ?? 24}%</div>
                            <div>Temp: {inspectedContext.dev.tempC ?? 36}°C</div>
                            <div>Load: {inspectedContext.dev.powerW}W</div>
                          </>
                        )}
                        {inspectedContext.kind === 'rack' && (
                          <>
                            <div>Devs: {inspectedContext.cfg.devices.length}</div>
                            <div>Cables: {inspectedContext.cfg.cables.length}</div>
                            <div>PDU: {inspectedContext.cfg.maxPowerKw}kW</div>
                          </>
                        )}
                      </div>

                      {/* Quick Live Power / Outage Toggle for Inspected Rack Device */}
                      {inspectedContext.kind === 'device' && (
                        <div className="pt-2 border-t border-current/15 flex items-center justify-between gap-2">
                          <span className="text-[10.5px] font-mono">
                            State:{' '}
                            <strong className={inspectedContext.dev.status === 'offline' ? 'text-rose-400' : 'text-emerald-400'}>
                              {inspectedContext.dev.status === 'offline' ? 'DOWN (OUTAGE)' : 'UP · ONLINE'}
                            </strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const rk = inspectedContext.rack;
                              const cfg = rk.rackConfig;
                              if (!cfg) return;
                              const nextStatus: RackDevice['status'] =
                                inspectedContext.dev.status === 'offline' ? 'online' : 'offline';
                              updateAsset(rk.id, {
                                rackConfig: {
                                  ...cfg,
                                  devices: cfg.devices.map((d) =>
                                    d.id === inspectedContext.dev.id ? { ...d, status: nextStatus } : d
                                  ),
                                },
                              });
                              showToast(
                                nextStatus === 'offline'
                                  ? `${inspectedContext.dev.name} toggled DOWN — red fault active on Live Map`
                                  : `${inspectedContext.dev.name} restored UP`,
                                nextStatus === 'offline' ? 'error' : 'success'
                              );
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-semibold cursor-pointer ${
                              inspectedContext.dev.status === 'offline'
                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                : 'bg-rose-600/90 hover:bg-rose-500 text-white'
                            }`}
                          >
                            <Power className="w-3 h-3" />
                            {inspectedContext.dev.status === 'offline' ? 'Restore UP' : 'Simulate Down'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* NAS Drive Bays Inspector Block */}
                {inspectedContext.kind === 'device' &&
                  inspectedContext.dev.driveBays &&
                  inspectedContext.dev.driveBays.length > 0 && (
                    <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-[#171924] border border-zinc-200 dark:border-zinc-800 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-zinc-800 dark:text-zinc-200">
                        <span className="flex items-center gap-1.5">
                          <HardDrive className="w-3.5 h-3.5 text-cyan-500" />
                          NAS Drive Bays ({inspectedContext.dev.driveBays.length})
                        </span>
                        <span className="font-mono text-[10px] text-zinc-500">
                          Disk {inspectedContext.dev.diskPct ?? 73}%
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {inspectedContext.dev.driveBays.map((bay) => (
                          <div
                            key={bay.id}
                            className={`p-2 rounded-xl border text-[10.5px] font-mono tabular-nums ${
                              bay.health === 'failed'
                                ? 'border-rose-500/60 bg-rose-500/10 text-rose-300'
                                : bay.health === 'warning'
                                ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#10131C] text-zinc-700 dark:text-zinc-300'
                            }`}
                          >
                            <div className="flex items-center justify-between font-bold">
                              <span>Bay {bay.slot}</span>
                              <span>{bay.tempC}°C</span>
                            </div>
                            <div className="text-[9.5px] text-zinc-500 flex items-center justify-between mt-0.5">
                              <span>{bay.capacityLabel}</span>
                              <span className="uppercase">{bay.health}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Hypervisor / Proxmox VM & Container Workloads Inspector Block */}
                {inspectedContext.kind === 'device' &&
                  inspectedContext.dev.workloads &&
                  inspectedContext.dev.workloads.length > 0 && (
                    <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-[#171924] border border-zinc-200 dark:border-zinc-800 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-zinc-800 dark:text-zinc-200">
                        <span className="flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-violet-500" />
                          Hosted VMs &amp; Containers ({inspectedContext.dev.workloads.length})
                        </span>
                        <span className="font-mono text-[10px] text-zinc-500">
                          {inspectedContext.dev.hypervisorVersion ?? 'Proxmox VE'}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {inspectedContext.dev.workloads.map((wl) => (
                          <div
                            key={wl.id}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#10131C] text-[10.5px] font-mono"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                {wl.name} <span className="text-zinc-500">({wl.vmid})</span>
                              </div>
                              <div className="text-[9.5px] text-zinc-500">
                                CPU {wl.cpuPct}% · MEM {wl.memPct}% · {wl.hostTag}
                              </div>
                            </div>
                            <span
                              className={`text-[10px] font-bold shrink-0 ${
                                wl.status === 'up' ? 'text-emerald-500' : 'text-zinc-500'
                              }`}
                            >
                              {wl.status === 'up' ? 'UP' : 'STOPPED'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Live Telemetry Trends Chart (Recharts) */}
                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-[#171924] border border-zinc-200 dark:border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-cyan-500" />
                      Live Traffic &amp; Error Trend
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">Mbps · Latency · CRC</span>
                  </div>
                  <div className="h-36 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={inspectedContext.trend} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                        <defs>
                          <linearGradient id="itBwGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.45} />
                            <stop offset="95%" stopColor="#06B6D4" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="itErrGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#EF4444" stopOpacity={0.5} />
                            <stop offset="95%" stopColor="#EF4444" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272A" opacity={0.35} />
                        <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#71717A' }} />
                        <YAxis tick={{ fontSize: 9, fill: '#71717A' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#11121A',
                            borderColor: '#27272A',
                            borderRadius: '10px',
                            fontSize: '11px',
                          }}
                        />
                        <Area type="monotone" dataKey="mbps" name="Throughput (Mbps)" stroke="#06B6D4" fill="url(#itBwGrad)" strokeWidth={2} />
                        <Area type="monotone" dataKey="errors" name="CRC Errors" stroke="#EF4444" fill="url(#itErrGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Contextual Editable Controls (locked in View Mode / Read-Only ACL) */}
                {inspectedContext.kind === 'user-node' && (() => {
                  const n = inspectedContext.node;
                  const selRack = getRackById(n.connectedRackId);
                  const selSwitch = selRack?.rackConfig?.devices.find((d) => d.id === n.connectedDeviceId);
                  return (
                    <fieldset
                      disabled={isReadOnly}
                      className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#171924] border border-zinc-200 dark:border-zinc-800 space-y-2.5 text-xs disabled:opacity-75"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                          <Wifi className="w-3.5 h-3.5 text-teal-500" />
                          Endpoint Wiring (Access Switch Port Binding)
                        </span>
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => {
                              deleteNetworkUserNode(n.id);
                              setInspected(null);
                            }}
                            className="p-1 rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                            title="Delete User Node"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">Node Code</span>
                          <input
                            value={n.code}
                            onChange={(e) => updateNetworkUserNode(n.id, { code: e.target.value })}
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700 font-mono"
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">Wall Jack ID</span>
                          <input
                            value={n.wallJackId}
                            onChange={(e) => updateNetworkUserNode(n.id, { wallJackId: e.target.value })}
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700 font-mono"
                          />
                        </label>
                        <label className="space-y-0.5 col-span-2">
                          <span className="text-[10px] text-zinc-500">Connected Distribution / IDF Rack</span>
                          <select
                            value={n.connectedRackId}
                            onChange={(e) => {
                              const nextR = getRackById(e.target.value);
                              const nextSw =
                                nextR?.rackConfig?.devices.find((d) => d.tier === 'access' || d.kind === 'switch') ??
                                nextR?.rackConfig?.devices[0];
                              updateNetworkUserNode(n.id, {
                                connectedRackId: e.target.value,
                                connectedDeviceId: nextSw?.id ?? '',
                                connectedPortId: nextSw?.ports[0]?.id ?? '',
                              });
                            }}
                            className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700"
                          >
                            {itAssets.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.assetId} · {r.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">Access Switch</span>
                          <select
                            value={n.connectedDeviceId}
                            onChange={(e) => {
                              const nextSw = selRack?.rackConfig?.devices.find((d) => d.id === e.target.value);
                              updateNetworkUserNode(n.id, {
                                connectedDeviceId: e.target.value,
                                connectedPortId: nextSw?.ports[0]?.id ?? '',
                              });
                            }}
                            className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700"
                          >
                            {(selRack?.rackConfig?.devices ?? []).map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">Switch Port</span>
                          <select
                            value={n.connectedPortId}
                            onChange={(e) => updateNetworkUserNode(n.id, { connectedPortId: e.target.value })}
                            className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700 font-mono"
                          >
                            {(selSwitch?.ports ?? []).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label} ({p.kind} {p.speedGbps}G)
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">IP Address</span>
                          <input
                            value={n.ipAddress}
                            onChange={(e) => updateNetworkUserNode(n.id, { ipAddress: e.target.value })}
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700 font-mono"
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">Link Status</span>
                          <select
                            value={n.status}
                            onChange={(e) =>
                              updateNetworkUserNode(n.id, {
                                status: e.target.value as NetworkUserNode['status'],
                                crcErrors: e.target.value === 'error' ? Math.max(12, n.crcErrors) : 0,
                              })
                            }
                            className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700"
                          >
                            <option value="online">Online · Nominal</option>
                            <option value="degraded">Degraded (Latency)</option>
                            <option value="error">CRC / Link Error</option>
                            <option value="offline">Offline</option>
                          </select>
                        </label>
                      </div>
                    </fieldset>
                  );
                })()}

                {inspectedContext.kind === 'port' && (() => {
                  const { rack, dev, port } = inspectedContext;
                  return (
                    <fieldset
                      disabled={isReadOnly}
                      className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#171924] border border-zinc-200 dark:border-zinc-800 space-y-2.5 text-xs disabled:opacity-75"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                          <Network className="w-3.5 h-3.5 text-cyan-500" />
                          Port Configuration · {port.label}
                        </span>
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${getLedVisual(port.status, port.isUplink, blinkTick)}`}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">Port State</span>
                          <select
                            value={port.status}
                            onChange={(e) =>
                              handleUpdatePort(rack.id, dev.id, port.id, {
                                status: e.target.value as RackPort['status'],
                                crcErrors: e.target.value === 'error' ? Math.max(18, port.crcErrors ?? 0) : 0,
                              })
                            }
                            className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700"
                          >
                            <option value="up">UP (Active Blink)</option>
                            <option value="standby">STANDBY (Redundant)</option>
                            <option value="error">ERROR (CRC Alert)</option>
                            <option value="down">DOWN (Admin Shut)</option>
                          </select>
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">VLAN / Trunk</span>
                          <input
                            value={port.vlan}
                            onChange={(e) => handleUpdatePort(rack.id, dev.id, port.id, { vlan: e.target.value })}
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700 font-mono"
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">Speed (Gbps)</span>
                          <input
                            type="number"
                            value={port.speedGbps}
                            onChange={(e) =>
                              handleUpdatePort(rack.id, dev.id, port.id, { speedGbps: Number(e.target.value) || 1 })
                            }
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700 font-mono"
                          />
                        </label>
                        <label className="space-y-0.5 flex items-center gap-2 pt-4">
                          <input
                            type="checkbox"
                            checked={Boolean(port.isUplink)}
                            onChange={(e) =>
                              handleUpdatePort(rack.id, dev.id, port.id, { isUplink: e.target.checked })
                            }
                            className="accent-cyan-500"
                          />
                          <span className="text-[11px] font-medium">Designated Uplink</span>
                        </label>
                      </div>
                    </fieldset>
                  );
                })()}

                {inspectedContext.kind === 'device' && (() => {
                  const { rack, dev } = inspectedContext;
                  const cfg = rack.rackConfig ?? DEFAULT_RACK_CONFIG;
                  return (
                    <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#171924] border border-zinc-200 dark:border-zinc-800 space-y-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-violet-500" />
                          Device &amp; Port Matrix ({dev.ports.length})
                        </span>
                        {!isReadOnly && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMoveDeviceU(rack.id, dev.id, 1)}
                              className="p-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-violet-600 hover:text-white cursor-pointer"
                              title="Move Up 1U"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveDeviceU(rack.id, dev.id, -1)}
                              className="p-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-violet-600 hover:text-white cursor-pointer"
                              title="Move Down 1U"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddPort(rack.id, dev.id)}
                              className="px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold cursor-pointer"
                            >
                              + Port
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDevice(rack.id, dev.id)}
                              className="p-1 rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                              title="Remove Device"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      <fieldset disabled={isReadOnly} className="grid grid-cols-2 gap-2 disabled:opacity-75">
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">Management IP</span>
                          <input
                            value={dev.ipAddress}
                            onChange={(e) =>
                              commitRackConfig(
                                {
                                  ...cfg,
                                  devices: cfg.devices.map((d) =>
                                    d.id === dev.id ? { ...d, ipAddress: e.target.value } : d
                                  ),
                                },
                                rack.id
                              )
                            }
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700 font-mono"
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-zinc-500">VLAN</span>
                          <input
                            value={dev.vlan}
                            onChange={(e) =>
                              commitRackConfig(
                                {
                                  ...cfg,
                                  devices: cfg.devices.map((d) =>
                                    d.id === dev.id ? { ...d, vlan: e.target.value } : d
                                  ),
                                },
                                rack.id
                              )
                            }
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#10121B] border border-zinc-200 dark:border-zinc-700 font-mono"
                          />
                        </label>
                      </fieldset>

                      {/* Clickable Port Cards with Live Blinking LEDs */}
                      <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                        {dev.ports.map((port, idx) => (
                          <button
                            key={port.id}
                            type="button"
                            onClick={() =>
                              setInspected({ kind: 'port', rackId: rack.id, deviceId: dev.id, portId: port.id })
                            }
                            className={`p-2 rounded-xl border text-left transition-colors cursor-pointer ${
                              port.status === 'error'
                                ? 'border-rose-500/60 bg-rose-500/10'
                                : port.isUplink
                                  ? 'border-cyan-500/45 bg-cyan-500/8'
                                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11121A] hover:border-violet-500'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[10.5px] font-mono font-bold">
                              <span className="truncate">{port.label}</span>
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${getLedVisual(
                                  port.status,
                                  port.isUplink,
                                  blinkTick + idx
                                )}`}
                              />
                            </div>
                            <div className="text-[9.5px] font-mono text-zinc-500 truncate mt-0.5">
                              {port.kind} {port.speedGbps}G · {port.vlan}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Full Label Studio Deep Link */}
                {inspectedContext.labelPayload.rackAssetId && (
                  <button
                    type="button"
                    onClick={() => {
                      openQrLabelModal('designer', [`asset:${inspectedContext.labelPayload.rackAssetId}`]);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#171924] hover:border-amber-500 text-xs font-semibold text-zinc-700 dark:text-zinc-200 cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5 text-amber-500" />
                    Open Rack Asset in Full QR Label Studio
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Provision New Floor IDF / Core DC Rack Modal */}
      {showProvisionModal && !isReadOnly && (
        <div
          className="fixed inset-0 z-[65] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowProvisionModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#13141E] border border-zinc-200 dark:border-zinc-800 shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                Provision Distribution IDF or Core DC Rack
              </h3>
              <button
                type="button"
                onClick={() => setShowProvisionModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-zinc-500">Rack Name</span>
                <input
                  value={provRackName}
                  onChange={(e) => setProvRackName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-[#0C0D14] border border-zinc-200 dark:border-zinc-700"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-zinc-500">Network Architecture Role</span>
                <select
                  value={provRole}
                  onChange={(e) => setProvRole(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-[#0C0D14] border border-zinc-200 dark:border-zinc-700"
                >
                  <option value="distribution-idf">Floor Distribution Rack (IDF · Dist + Access SW)</option>
                  <option value="access-closet">Room Access Closet (24U · Edge Access Switch)</option>
                  <option value="core-dc">Core Data Center Rack (MDF · Core Fabric)</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-zinc-500">Target Floor</span>
                  <select
                    value={provFloorId}
                    onChange={(e) => {
                      setProvFloorId(e.target.value);
                      setProvRoomId('');
                    }}
                    className="w-full px-2.5 py-2 rounded-xl bg-zinc-50 dark:bg-[#0C0D14] border border-zinc-200 dark:border-zinc-700"
                  >
                    {scene.floors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code} · {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-zinc-500">Target Room</span>
                  <select
                    value={provRoomId}
                    onChange={(e) => setProvRoomId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-zinc-50 dark:bg-[#0C0D14] border border-zinc-200 dark:border-zinc-700"
                  >
                    <option value="">Auto / Floor Center</option>
                    {scene.rooms
                      .filter((r) => r.floorId === provFloorId)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code} · {r.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowProvisionModal(false)}
                className="px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProvisionRack}
                className="px-4 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
              >
                Provision &amp; Auto-Uplink to Core
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Room & Equipment Hover Tooltip (Endpoints & Drops + 3-Tier Architecture) */}
      {hoverTip && (() => {
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        const cardW = 280;
        const cardH = 160;
        const left = Math.min(Math.max(12, hoverTip.x + 14), Math.max(12, vw - cardW - 14));
        const top = Math.min(Math.max(12, hoverTip.y + 14), Math.max(12, vh - cardH - 14));
        const badgeClass =
          hoverTip.badgeTone === 'cyan'
            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
            : hoverTip.badgeTone === 'violet'
              ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
              : hoverTip.badgeTone === 'emerald'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : hoverTip.badgeTone === 'amber'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : hoverTip.badgeTone === 'rose'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-blue-500/20 text-blue-300 border-blue-500/40';
        return (
          <div
            className="fixed z-[95] pointer-events-none w-[276px] rounded-xl bg-[#0D101B]/95 border border-zinc-700/90 shadow-2xl p-2.5 text-[11px] text-zinc-100"
            style={{ left, top }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-bold text-white leading-tight truncate">{hoverTip.title}</div>
              <span className={`px-1.5 py-0.5 rounded border font-mono text-[9px] font-bold uppercase shrink-0 ${badgeClass}`}>
                {hoverTip.badge}
              </span>
            </div>
            {hoverTip.subtitle && (
              <div className="text-[10px] font-mono text-zinc-400 truncate mt-0.5">
                {hoverTip.subtitle}
              </div>
            )}
            <div className="mt-2 pt-1.5 border-t border-zinc-800 space-y-1">
              {hoverTip.rows.map((r) => (
                <div key={r.label} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-zinc-400 shrink-0">{r.label}</span>
                  <span className="font-mono text-zinc-200 truncate text-right">{r.value}</span>
                </div>
              ))}
            </div>
            {hoverTip.hint && (
              <div className="mt-1.5 pt-1 border-t border-zinc-800/80 text-[9.5px] text-cyan-300/90">
                {hoverTip.hint}
              </div>
            )}
          </div>
        );
      })()}

      {/* Printable Industrial IT Identification Label Modal */}
      <ItLabelPrintModal
        label={labelToPrint}
        onClose={() => setLabelToPrint(null)}
        onOpenLabelStudio={(assetId) => openQrLabelModal('designer', [`asset:${assetId}`])}
      />

      {/* Detailed IT 3D Equipment & Room Modal (3D preview, live telemetry, history & Go to 3D Model) */}
      <It3DDetailDialog
        target={detail3DTarget}
        onClose={() => setDetail3DTarget(null)}
        onChangeTarget={setDetail3DTarget}
        onOpenInRackTab={(rackId, deviceId) => {
          setSelectedAssetId(rackId);
          setActiveTab('racks');
          if (deviceId) {
            setInspected({ kind: 'device', rackId, deviceId });
          } else {
            setInspected({ kind: 'rack', rackId });
          }
        }}
      />
    </div>
  );
};

export const NetworkRackDesignerModal: React.FC = () => (
  <NetworkRackDesignerView mode="modal" />
);

export const DataCenterDesignerPage: React.FC = () => (
  <NetworkRackDesignerView mode="page" />
);
