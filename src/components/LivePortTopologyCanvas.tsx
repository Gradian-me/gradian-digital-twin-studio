import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Cable,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Crosshair,
  Database,
  Eye,
  Frame,
  HardDrive,
  Layers,
  LayoutGrid,
  Lock,
  Maximize2,
  Minus,
  Monitor,
  MousePointer2,
  Network,
  Pencil,
  Plus,
  Power,
  Radio,
  Redo2,
  RotateCcw,
  Route,
  Search,
  Server,
  Shield,
  SlidersHorizontal,
  Square,
  Table2,
  Trash2,
  Type,
  Undo2,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { DataCenter3DViewer } from './DataCenter3DViewer';
import { It3DDetailDialog, type It3DDetailTarget } from './It3DDetailDialog';
import type {
  Building,
  Floor,
  NetworkInterRackLink,
  NetworkUserNode,
  RackDevice,
  RackDeviceDriveBay,
  RackDeviceWorkload,
  RackPort,
  Room,
  SpatialAsset,
  TopologyBox,
  TopologyCustomCable,
  TopologyCustomNode,
  TopologyMapState,
  TopologyTableCard,
  TopologyTextNote,
  TopologyVlan,
  Wall,
} from '../types/twin';

export type LiveMapInspectedTarget =
  | { kind: 'rack'; rackId: string }
  | { kind: 'device'; rackId: string; deviceId: string }
  | { kind: 'port'; rackId: string; deviceId: string; portId: string }
  | { kind: 'user-node'; nodeId: string };

interface LivePortTopologyCanvasProps {
  itAssets: SpatialAsset[];
  userNodes: NetworkUserNode[];
  interRackLinks: NetworkInterRackLink[];
  topologyMap?: TopologyMapState;
  buildings?: Building[];
  rooms?: Room[];
  walls?: Wall[];
  floors?: Floor[];
  viewDim?: '2d' | '3d';
  onViewDimChange?: (dim: '2d' | '3d') => void;
  isReadOnly: boolean;
  inspected: LiveMapInspectedTarget | null;
  onInspect: (target: LiveMapInspectedTarget) => void;
  onJumpTo3D: (opts: { rackId?: string; nodeId?: string; deviceId?: string }) => void;
  onJumpTo2D: (opts: { rackId?: string; nodeId?: string }) => void;
  onTraceNode?: (nodeId: string) => void;
}

type EditorTool =
  | 'select'
  | 'device'
  | 'box'
  | 'frame'
  | 'text'
  | 'table'
  | 'networks'
  | 'legend'
  | 'cable';

interface UnifiedNode {
  key: string; // 'dev:<devId>' | 'un:<nodeId>' | 'custom:<customId>'
  source: 'rack-device' | 'user-node' | 'custom';
  rackId?: string;
  rackCode?: string;
  floorId?: string;
  roomId?: string;
  device?: RackDevice;
  userNode?: NetworkUserNode;
  customNode?: TopologyCustomNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UnifiedEdge {
  id: string;
  sourceKind: 'patch' | 'inter-rack' | 'user-drop' | 'custom';
  fromKey: string;
  fromPortId?: string;
  toKey: string;
  toPortId?: string;
  label: string;
  speedLabel: string;
  vlan: string;
  color: string;
  style: 'solid' | 'dashed';
  baseStatus: 'up' | 'degraded' | 'down';
  rackId?: string;
  interRackId?: string;
  customCableId?: string;
}

const DEFAULT_VLANS: TopologyVlan[] = [
  { id: 'v-10', vlanTag: 'VLAN-10-OT', name: 'GMP Production OT', subnet: '10.42.10.0/24', color: '#10B981', visible: true },
  { id: 'v-20', vlanTag: 'VLAN-20-SCADA', name: 'SCADA & Historian', subnet: '10.42.20.0/24', color: '#8B5CF6', visible: true },
  { id: 'v-30', vlanTag: 'VLAN-30-EMS', name: 'EMS & Vault Storage', subnet: '10.42.30.0/24', color: '#06B6D4', visible: true },
  { id: 'v-31', vlanTag: 'VLAN-31-LAB', name: 'QC Lab & Empower', subnet: '10.42.31.0/24', color: '#3B82F6', visible: true },
  { id: 'v-11', vlanTag: 'VLAN-11-QA', name: 'QA Batch Release', subnet: '10.42.11.0/24', color: '#14B8A6', visible: true },
  { id: 'v-50', vlanTag: 'VLAN-50-WIFI', name: 'Campus Wi-Fi 6E', subnet: '10.42.50.0/24', color: '#F59E0B', visible: true },
  { id: 'v-70', vlanTag: 'VLAN-70-ACS', name: 'Access Control / CCTV', subnet: '10.42.70.0/24', color: '#EC4899', visible: true },
  { id: 'v-99', vlanTag: 'VLAN-99-UPLINK', name: 'Fiber Trunk & DMZ', subnet: '10.42.99.0/24', color: '#38BDF8', visible: true },
];

const EMPTY_MAP: TopologyMapState = {
  diagramName: 'cinnagen-dc-live-map',
  snapToGrid: true,
  showLegend: false,
  vlans: DEFAULT_VLANS,
  nodePositions: {},
  boxes: [],
  texts: [],
  tables: [],
  customNodes: [],
  customCables: [],
};

const GRID_SIZE = 20;

function snapVal(v: number, snap: boolean): number {
  return snap ? Math.round(v / GRID_SIZE) * GRID_SIZE : Math.round(v);
}

function getCardDimensions(node: Pick<UnifiedNode, 'source' | 'device' | 'userNode' | 'customNode'>): {
  width: number;
  height: number;
} {
  if (node.source === 'rack-device' && node.device) {
    const d = node.device;
    if (d.kind === 'switch') return { width: 510, height: 122 };
    if (d.kind === 'firewall' || d.kind === 'router') return { width: 410, height: 102 };
    if (d.kind === 'storage' || (d.driveBays && d.driveBays.length > 0)) return { width: 390, height: 205 };
    if (d.workloads && d.workloads.length > 0) return { width: 540, height: 220 };
    return { width: 270, height: 102 };
  }
  if (node.source === 'custom' && node.customNode) {
    if (node.customNode.kind === 'switch') return { width: 460, height: 118 };
    return { width: 265, height: 96 };
  }
  return { width: 224, height: 94 };
}

function resolveVlanColor(vlan: string | undefined, vlans: TopologyVlan[]): string {
  if (!vlan) return '#10B981';
  const upper = vlan.toUpperCase();
  const exact = vlans.find((v) => v.vlanTag.toUpperCase() === upper);
  if (exact) return exact.color;
  const partial = vlans.find((v) => upper.includes(v.vlanTag.split('-')[1] ?? '___'));
  if (partial) return partial.color;
  if (upper.includes('DMZ') || upper.includes('MGMT')) return '#F59E0B';
  if (upper.includes('TRUNK') || upper.includes('UPLINK')) return '#38BDF8';
  if (upper.includes('SCADA')) return '#8B5CF6';
  if (upper.includes('LAB')) return '#3B82F6';
  if (upper.includes('ACS') || upper.includes('CCTV')) return '#EC4899';
  return '#10B981';
}

function shortDeviceBadge(d: RackDevice): string {
  if (d.vendor && d.kind === 'firewall') return `${d.vendor} FW`;
  if (d.vendor && d.kind === 'switch') return d.vendor;
  if (d.kind === 'storage') return `${d.vendor.split('/')[0].trim()} · NAS`;
  if (d.workloads && d.workloads.length > 0) return `${d.name.split('·')[0].trim()} · Proxmox VE`;
  return d.vendor || d.kind.toUpperCase();
}

/** Build clean orthogonal Manhattan SVG path between two port/card anchors */
function buildOrthogonalPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  laneOffset: number
): { d: string; labelX: number; labelY: number } {
  const dy = by - ay;
  const dx = bx - ax;

  // If horizontally aligned more than vertically (e.g. VPN -> Firewall)
  if (Math.abs(dx) > Math.abs(dy) * 1.35) {
    const midX = ax + dx * 0.5 + laneOffset * 14;
    return {
      d: `M ${ax} ${ay} L ${midX} ${ay} L ${midX} ${by} L ${bx} ${by}`,
      labelX: midX,
      labelY: (ay + by) / 2,
    };
  }

  // Standard top-down vertical drop with orthogonal elbow
  const midY = ay + dy * 0.52 + laneOffset * 12;
  return {
    d: `M ${ax} ${ay} L ${ax} ${midY} L ${bx} ${midY} L ${bx} ${by}`,
    labelX: Math.abs(dx) > 40 ? (ax + bx) / 2 : ax + 18,
    labelY: midY - 6,
  };
}

export const LivePortTopologyCanvas: React.FC<LivePortTopologyCanvasProps> = ({
  itAssets,
  userNodes,
  interRackLinks,
  topologyMap,
  buildings = [],
  rooms = [],
  walls = [],
  floors = [],
  viewDim,
  onViewDimChange,
  isReadOnly,
  inspected,
  onInspect,
  onJumpTo3D,
  onJumpTo2D,
  onTraceNode,
}) => {
  const updateAsset = useTwinStore((s) => s.updateAsset);
  const updateInterRackLink = useTwinStore((s) => s.updateInterRackLink);
  const updateNetworkUserNode = useTwinStore((s) => s.updateNetworkUserNode);
  const updateTopologyMap = useTwinStore((s) => s.updateTopologyMap);
  const undo = useTwinStore((s) => s.undo);
  const redo = useTwinStore((s) => s.redo);
  const canUndo = useTwinStore((s) => s.past.length > 0);
  const canRedo = useTwinStore((s) => s.future.length > 0);
  const showToast = useTwinStore((s) => s.showToast);

  const mapState: TopologyMapState = useMemo(
    () => ({
      ...EMPTY_MAP,
      ...(topologyMap ?? {}),
      vlans: topologyMap?.vlans?.length ? topologyMap.vlans : DEFAULT_VLANS,
      nodePositions: topologyMap?.nodePositions ?? {},
      boxes: topologyMap?.boxes ?? [],
      texts: topologyMap?.texts ?? [],
      tables: topologyMap?.tables ?? [],
      customNodes: topologyMap?.customNodes ?? [],
      customCables: topologyMap?.customCables ?? [],
    }),
    [topologyMap]
  );

  // Canvas interaction state — default to viewing on narrow touch devices for effortless panning
  const [editorMode, setEditorMode] = useState<'viewing' | 'editing'>(() => {
    if (isReadOnly) return 'viewing';
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 'viewing';
    return 'editing';
  });
  const [internalDim, setInternalDim] = useState<'2d' | '3d'>('2d');
  const effectiveDim = viewDim ?? internalDim;
  const setEffectiveDim = useCallback(
    (d: '2d' | '3d') => {
      if (onViewDimChange) onViewDimChange(d);
      else setInternalDim(d);
    },
    [onViewDimChange]
  );

  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [zoom, setZoom] = useState<number>(0.78);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 24, y: 18 });
  const [rackFilter, setRackFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showVlanPanel, setShowVlanPanel] = useState(false);
  const [highlightVlan, setHighlightVlan] = useState<string | null>(null);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [showOutageList, setShowOutageList] = useState(false);
  const [outageFilter, setOutageFilter] = useState<'all' | 'down' | 'unreachable'>('all');
  const [outageSearch, setOutageSearch] = useState('');
  const [detail3DTarget, setDetail3DTarget] = useState<It3DDetailTarget | null>(null);

  // Cable drawing state
  const [cableStart, setCableStart] = useState<{
    nodeKey: string;
    portId?: string;
    x: number;
    y: number;
    label: string;
  } | null>(null);
  const [cableMouse, setCableMouse] = useState<{ x: number; y: number } | null>(null);
  const [newCableSpeed, setNewCableSpeed] = useState<string>('10G');
  const [newCableVlan, setNewCableVlan] = useState<string>('VLAN-10-OT');
  const [newCableStyle, setNewCableStyle] = useState<'solid' | 'dashed'>('solid');

  // New VLAN quick form
  const [newVlanTag, setNewVlanTag] = useState('');
  const [newVlanName, setNewVlanName] = useState('');
  const [newVlanColor, setNewVlanColor] = useState('#22D3EE');

  // Dragging state (node / box / text / table / canvas pan)
  const [dragState, setDragState] = useState<
    | null
    | { kind: 'pan'; startClientX: number; startClientY: number; origX: number; origY: number; pointerId?: number }
    | { kind: 'node'; key: string; startClientX: number; startClientY: number; origX: number; origY: number; curX: number; curY: number }
    | { kind: 'box'; id: string; startClientX: number; startClientY: number; origX: number; origY: number; curX: number; curY: number }
    | { kind: 'text'; id: string; startClientX: number; startClientY: number; origX: number; origY: number; curX: number; curY: number }
    | { kind: 'table'; id: string; startClientX: number; startClientY: number; origX: number; origY: number; curX: number; curY: number }
  >(null);

  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  // Multi-touch pointer tracking for 2-finger pinch-to-zoom & smooth mobile pan
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    dist: number;
    midX: number;
    midY: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    if (isReadOnly) setEditorMode('viewing');
  }, [isReadOnly]);

  const canEdit = !isReadOnly && editorMode === 'editing';

  // Helper to mutate TopologyMapState cleanly
  const patchMap = useCallback(
    (fn: (prev: TopologyMapState) => TopologyMapState, label?: string) => {
      updateTopologyMap((prev) => fn({ ...EMPTY_MAP, ...(prev ?? mapState) }), label);
    },
    [updateTopologyMap, mapState]
  );

  // Build unified list of all devices (real rack devices + user nodes + custom VPN/tunnel nodes)
  const nodes: UnifiedNode[] = useMemo(() => {
    const list: UnifiedNode[] = [];
    let autoIdx = 0;

    // 1. Custom VPN/Tunnel/External devices
    mapState.customNodes.forEach((cn) => {
      const key = `custom:${cn.id}`;
      const pos = mapState.nodePositions[key] ?? { x: cn.x, y: cn.y };
      const dim = getCardDimensions({ source: 'custom', customNode: cn });
      list.push({
        key,
        source: 'custom',
        customNode: cn,
        x: dragState?.kind === 'node' && dragState.key === key ? dragState.curX : pos.x,
        y: dragState?.kind === 'node' && dragState.key === key ? dragState.curY : pos.y,
        width: dim.width,
        height: dim.height,
      });
    });

    // 2. Real IT Rack Devices across all Core DC & IDF Racks
    itAssets.forEach((rack, rIdx) => {
      if (rackFilter !== 'all' && rack.id !== rackFilter) return;
      const devices = rack.rackConfig?.devices ?? [];
      devices.forEach((dev, dIdx) => {
        if (dev.kind === 'patch-panel' && devices.length > 3) return; // keep map focused on active devices unless dedicated
        const key = `dev:${dev.id}`;
        const fallbackX = 80 + ((rIdx * 360 + dIdx * 280) % 1100);
        const fallbackY = 90 + Math.floor((autoIdx++) / 3) * 210;
        const pos = mapState.nodePositions[key] ?? { x: fallbackX, y: fallbackY };
        const dim = getCardDimensions({ source: 'rack-device', device: dev });
        list.push({
          key,
          source: 'rack-device',
          rackId: rack.id,
          rackCode: rack.assetId,
          floorId: rack.floorId,
          roomId: rack.roomId,
          device: dev,
          x: dragState?.kind === 'node' && dragState.key === key ? dragState.curX : pos.x,
          y: dragState?.kind === 'node' && dragState.key === key ? dragState.curY : pos.y,
          width: dim.width,
          height: dim.height,
        });
      });
    });

    // 3. All Connected User Nodes (APs, HMIs, HPLC drops, IoT gateways, Badge readers)
    // Place unpositioned endpoints cleanly in non-overlapping rows below rack hardware
    const visibleRackIds = new Set(
      rackFilter === 'all' ? itAssets.map((a) => a.id) : [rackFilter]
    );
    const featuredNodes = userNodes.filter((n) => visibleRackIds.has(n.connectedRackId));
    let unpositionedIdx = 0;
    const baseUserRowY = 1120;
    featuredNodes.forEach((un) => {
      const key = `un:${un.id}`;
      const saved = mapState.nodePositions[key];
      let pos = saved;
      if (!pos) {
        const col = unpositionedIdx % 6;
        const row = Math.floor(unpositionedIdx / 6);
        pos = { x: 40 + col * 260, y: baseUserRowY + row * 135 };
        unpositionedIdx += 1;
      }
      const dim = getCardDimensions({ source: 'user-node', userNode: un });
      list.push({
        key,
        source: 'user-node',
        rackId: un.connectedRackId,
        floorId: un.floorId,
        roomId: un.roomId,
        userNode: un,
        x: dragState?.kind === 'node' && dragState.key === key ? dragState.curX : pos.x,
        y: dragState?.kind === 'node' && dragState.key === key ? dragState.curY : pos.y,
        width: dim.width,
        height: dim.height,
      });
    });

    return list;
  }, [itAssets, userNodes, mapState.customNodes, mapState.nodePositions, rackFilter, dragState]);

  const nodeByKey = useMemo(() => {
    const m = new Map<string, UnifiedNode>();
    nodes.forEach((n) => m.set(n.key, n));
    return m;
  }, [nodes]);

  // Build unified edges from: intra-rack patch cables + inter-rack fiber trunks + user node drops + custom cables
  const edges: UnifiedEdge[] = useMemo(() => {
    const list: UnifiedEdge[] = [];

    // 1. Intra-rack patch cables
    itAssets.forEach((rack) => {
      if (rackFilter !== 'all' && rack.id !== rackFilter) return;
      (rack.rackConfig?.cables ?? []).forEach((cab) => {
        const fromKey = `dev:${cab.fromDeviceId}`;
        const toKey = `dev:${cab.toDeviceId}`;
        if (!nodeByKey.has(fromKey) || !nodeByKey.has(toKey)) return;
        const fromDev = nodeByKey.get(fromKey)?.device;
        const fromPort = fromDev?.ports.find((p) => p.id === cab.fromPortId);
        const toDev = nodeByKey.get(toKey)?.device;
        const toPort = toDev?.ports.find((p) => p.id === cab.toPortId);
        const speedGbps = fromPort?.speedGbps ?? toPort?.speedGbps ?? 1;
        const portDown =
          fromPort?.status === 'down' ||
          toPort?.status === 'down' ||
          fromPort?.status === 'error' ||
          toPort?.status === 'error';
        list.push({
          id: `patch:${rack.id}:${cab.id}`,
          sourceKind: 'patch',
          rackId: rack.id,
          fromKey,
          fromPortId: cab.fromPortId,
          toKey,
          toPortId: cab.toPortId,
          label: cab.label || cab.media,
          speedLabel: `${speedGbps}G`,
          vlan: cab.vlan,
          color: resolveVlanColor(cab.vlan, mapState.vlans),
          style: 'solid',
          baseStatus: portDown ? 'down' : 'up',
        });
      });
    });

    // 2. Inter-rack fiber trunks
    interRackLinks.forEach((lnk) => {
      const fromKey = `dev:${lnk.fromDeviceId}`;
      const toKey = `dev:${lnk.toDeviceId}`;
      if (!nodeByKey.has(fromKey) || !nodeByKey.has(toKey)) return;
      list.push({
        id: `irl:${lnk.id}`,
        sourceKind: 'inter-rack',
        interRackId: lnk.id,
        fromKey,
        fromPortId: lnk.fromPortId,
        toKey,
        toPortId: lnk.toPortId,
        label: lnk.label,
        speedLabel: `${lnk.speedGbps}G`,
        vlan: 'VLAN-99-UPLINK',
        color: resolveVlanColor('VLAN-99-UPLINK', mapState.vlans),
        style: 'solid',
        baseStatus: lnk.status === 'down' ? 'down' : lnk.status === 'degraded' ? 'degraded' : 'up',
      });
    });

    // 3. User node horizontal Cat6A/PoE drops
    userNodes.forEach((un) => {
      const fromKey = `dev:${un.connectedDeviceId}`;
      const toKey = `un:${un.id}`;
      if (!nodeByKey.has(fromKey) || !nodeByKey.has(toKey)) return;
      const swPort = nodeByKey.get(fromKey)?.device?.ports.find((p) => p.id === un.connectedPortId);
      const isDown = un.status === 'offline' || swPort?.status === 'down';
      const isErr = un.status === 'error' || un.status === 'degraded' || swPort?.status === 'error';
      list.push({
        id: `drop:${un.id}`,
        sourceKind: 'user-drop',
        fromKey,
        fromPortId: un.connectedPortId,
        toKey,
        label: un.wallJackId,
        speedLabel: un.poeWatts > 0 ? `1G PoE` : `1G`,
        vlan: un.vlan,
        color: resolveVlanColor(un.vlan, mapState.vlans),
        style: un.nodeKind === 'wifi-ap' ? 'solid' : 'solid',
        baseStatus: isDown ? 'down' : isErr ? 'degraded' : 'up',
      });
    });

    // 4. Custom drawn cables (VPN tunnels, user-drawn cables)
    mapState.customCables.forEach((cc) => {
      if (!nodeByKey.has(cc.fromNodeId) || !nodeByKey.has(cc.toNodeId)) return;
      list.push({
        id: `cc:${cc.id}`,
        sourceKind: 'custom',
        customCableId: cc.id,
        fromKey: cc.fromNodeId,
        fromPortId: cc.fromPortId,
        toKey: cc.toNodeId,
        toPortId: cc.toPortId,
        label: cc.label,
        speedLabel: cc.speedLabel,
        vlan: cc.vlan,
        color: cc.color || resolveVlanColor(cc.vlan, mapState.vlans),
        style: cc.style,
        baseStatus: cc.status,
      });
    });

    return list;
  }, [itAssets, interRackLinks, userNodes, mapState.customCables, mapState.vlans, nodeByKey, rackFilter]);

  // Room & Floor lookups for recursive graph search
  const roomById = useMemo(() => {
    const m = new Map<string, Room>();
    rooms.forEach((r) => m.set(r.id, r));
    return m;
  }, [rooms]);
  const floorById = useMemo(() => {
    const m = new Map<string, Floor>();
    floors.forEach((f) => m.set(f.id, f));
    return m;
  }, [floors]);

  // RECURSIVE GRAPH TRAVERSAL SEARCH ENGINE
  // Searching any device, port, IP, VLAN, room, or user node finds all direct matches
  // and recursively traverses upstream & downstream connected edges (BFS) so ONLY the
  // related connected subgraph is displayed.
  const graphSearch = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return {
        active: false,
        seedKeys: new Set<string>(),
        connectedKeys: null as Set<string> | null,
        connectedEdgeIds: null as Set<string> | null,
        highlighted3DIds: null as Set<string> | null,
      };
    }

    const seedKeys = new Set<string>();
    nodes.forEach((n) => {
      const rm = n.roomId ? roomById.get(n.roomId) : undefined;
      const fl = n.floorId ? floorById.get(n.floorId) : undefined;
      const tokens: string[] = [
        n.key,
        n.rackCode ?? '',
        rm?.code ?? '',
        rm?.name ?? '',
        fl?.code ?? '',
        fl?.name ?? '',
      ];
      if (n.device) {
        tokens.push(
          n.device.name,
          n.device.model,
          n.device.vendor,
          n.device.ipAddress,
          n.device.vlan,
          n.device.kind,
          n.device.tier ?? ''
        );
        n.device.ports.forEach((p) => {
          tokens.push(p.label, p.kind, p.vlan, p.connectedToLabel ?? '', `${p.speedGbps}g`);
        });
        (n.device.workloads ?? []).forEach((w) => tokens.push(w.name, w.vmid, w.hostTag));
      }
      if (n.userNode) {
        tokens.push(
          n.userNode.code,
          n.userNode.name,
          n.userNode.ipAddress,
          n.userNode.macAddress,
          n.userNode.wallJackId,
          n.userNode.vlan,
          n.userNode.nodeKind
        );
      }
      if (n.customNode) {
        tokens.push(n.customNode.name, n.customNode.badge, n.customNode.ipAddress, n.customNode.vlan, n.customNode.kind);
      }
      if (tokens.some((t) => t && t.toLowerCase().includes(q))) {
        seedKeys.add(n.key);
      }
    });

    // Also match directly on edges (cable labels, VLANs, speeds)
    edges.forEach((e) => {
      const hay = `${e.label} ${e.speedLabel} ${e.vlan} ${e.fromPortId ?? ''} ${e.toPortId ?? ''}`.toLowerCase();
      if (hay.includes(q)) {
        seedKeys.add(e.fromKey);
        seedKeys.add(e.toKey);
      }
    });

    // Build full undirected adjacency list
    const adj = new Map<string, Array<{ neighbor: string; edgeId: string }>>();
    nodes.forEach((n) => adj.set(n.key, []));
    edges.forEach((e) => {
      adj.get(e.fromKey)?.push({ neighbor: e.toKey, edgeId: e.id });
      adj.get(e.toKey)?.push({ neighbor: e.fromKey, edgeId: e.id });
    });

    // Recursive BFS traversal across all connected hops from matched seeds
    const connectedKeys = new Set<string>(seedKeys);
    const connectedEdgeIds = new Set<string>();
    const queue = Array.from(seedKeys);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const link of adj.get(cur) ?? []) {
        connectedEdgeIds.add(link.edgeId);
        if (!connectedKeys.has(link.neighbor)) {
          connectedKeys.add(link.neighbor);
          queue.push(link.neighbor);
        }
      }
    }

    // Build 3D highlight IDs for synchronized 3D Map mode
    const highlighted3DIds = new Set<string>();
    connectedKeys.forEach((k) => {
      const n = nodeByKey.get(k);
      if (!n) return;
      if (n.rackId) highlighted3DIds.add(n.rackId);
      if (n.device) highlighted3DIds.add(n.device.id);
      if (n.userNode) highlighted3DIds.add(n.userNode.id);
      if (n.roomId) highlighted3DIds.add(n.roomId);
    });

    return { active: true, seedKeys, connectedKeys, connectedEdgeIds, highlighted3DIds };
  }, [searchQuery, nodes, edges, nodeByKey, roomById, floorById]);

  const visibleNodes = useMemo(
    () => (graphSearch.active && graphSearch.connectedKeys ? nodes.filter((n) => graphSearch.connectedKeys!.has(n.key)) : nodes),
    [nodes, graphSearch]
  );

  const visibleEdges = useMemo(
    () =>
      graphSearch.active && graphSearch.connectedEdgeIds
        ? edges.filter((e) => graphSearch.connectedEdgeIds!.has(e.id))
        : edges,
    [edges, graphSearch]
  );

  // LIVE OUTAGE CASCADE ENGINE ("Switch down? Red")
  // Computes directly offline devices + downstream nodes unreachable from Core Switch/Firewall
  const outageImpact = useMemo(() => {
    const directlyDown = new Set<string>();
    nodes.forEach((n) => {
      if (n.source === 'rack-device' && n.device?.status === 'offline') directlyDown.add(n.key);
      if (n.source === 'user-node' && n.userNode?.status === 'offline') directlyDown.add(n.key);
      if (n.source === 'custom' && n.customNode?.status === 'offline') directlyDown.add(n.key);
    });

    // Build adjacency of UP edges between non-down nodes
    const adj = new Map<string, Set<string>>();
    nodes.forEach((n) => adj.set(n.key, new Set()));
    edges.forEach((e) => {
      if (e.baseStatus === 'down') return;
      if (directlyDown.has(e.fromKey) || directlyDown.has(e.toKey)) return;
      adj.get(e.fromKey)?.add(e.toKey);
      adj.get(e.toKey)?.add(e.fromKey);
    });

    // Determine core root (Firewall or Core Switch)
    const rootNode =
      nodes.find((n) => n.device?.kind === 'firewall' && !directlyDown.has(n.key)) ??
      nodes.find((n) => n.device?.tier === 'core' && !directlyDown.has(n.key)) ??
      nodes.find((n) => n.source === 'rack-device' && !directlyDown.has(n.key));

    const reachable = new Set<string>();
    if (rootNode) {
      const queue: string[] = [rootNode.key];
      reachable.add(rootNode.key);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const nb of adj.get(cur) ?? []) {
          if (!reachable.has(nb)) {
            reachable.add(nb);
            queue.push(nb);
          }
        }
      }
    }

    const cascadedUnreachable = new Set<string>();
    // Only mark as cascaded unreachable if there IS an outage/down link somewhere
    const hasAnyFault = directlyDown.size > 0 || edges.some((e) => e.baseStatus === 'down');
    if (hasAnyFault) {
      nodes.forEach((n) => {
        if (!directlyDown.has(n.key) && !reachable.has(n.key)) {
          // Only mark unreachable if the node actually has at least one edge in the topology
          const hasEdge = edges.some((e) => e.fromKey === n.key || e.toKey === n.key);
          if (hasEdge) cascadedUnreachable.add(n.key);
        }
      });
    }

    return { directlyDown, cascadedUnreachable };
  }, [nodes, edges]);

  // Toggle device UP / DOWN in real twin store ("Switch down? Red")
  const handleToggleNodePower = useCallback(
    (node: UnifiedNode) => {
      if (node.source === 'rack-device' && node.rackId && node.device) {
        const rack = itAssets.find((a) => a.id === node.rackId);
        const cfg = rack?.rackConfig;
        if (!cfg) return;
        const goingOffline = node.device.status !== 'offline';
        const nextStatus: RackDevice['status'] = goingOffline ? 'offline' : 'online';
        updateAsset(node.rackId, {
          rackConfig: {
            ...cfg,
            devices: cfg.devices.map((d) => (d.id === node.device!.id ? { ...d, status: nextStatus } : d)),
          },
        });
        showToast(
          goingOffline
            ? `${node.device.name} set DOWN — live outage cascade active`
            : `${node.device.name} restored UP`,
          goingOffline ? 'error' : 'success'
        );
      } else if (node.source === 'user-node' && node.userNode) {
        const goingOffline = node.userNode.status !== 'offline';
        updateNetworkUserNode(node.userNode.id, { status: goingOffline ? 'offline' : 'online' });
      } else if (node.source === 'custom' && node.customNode) {
        const goingOffline = node.customNode.status !== 'offline';
        patchMap(
          (prev) => ({
            ...prev,
            customNodes: prev.customNodes.map((c) =>
              c.id === node.customNode!.id ? { ...c, status: goingOffline ? 'offline' : 'online' } : c
            ),
          }),
          `${goingOffline ? 'Downed' : 'Restored'} ${node.customNode.name}`
        );
      }
    },
    [itAssets, updateAsset, updateNetworkUserNode, patchMap, showToast]
  );

  // Toggle individual port UP / DOWN / ERROR
  const handleTogglePortState = useCallback(
    (rackId: string, deviceId: string, port: RackPort) => {
      const rack = itAssets.find((a) => a.id === rackId);
      const cfg = rack?.rackConfig;
      if (!cfg) return;
      const nextStatus: RackPort['status'] =
        port.status === 'up' ? 'down' : port.status === 'down' ? 'error' : 'up';
      updateAsset(rackId, {
        rackConfig: {
          ...cfg,
          devices: cfg.devices.map((d) =>
            d.id !== deviceId
              ? d
              : {
                  ...d,
                  ports: d.ports.map((p) => (p.id === port.id ? { ...p, status: nextStatus } : p)),
                }
          ),
        },
      });
      showToast(`Port ${port.label} → ${nextStatus.toUpperCase()}`, nextStatus === 'up' ? 'success' : 'warning');
    },
    [itAssets, updateAsset, showToast]
  );

  // Toggle VM / CT workload status inside a Hypervisor card
  const handleToggleWorkload = useCallback(
    (rackId: string, deviceId: string, wl: RackDeviceWorkload) => {
      const rack = itAssets.find((a) => a.id === rackId);
      const cfg = rack?.rackConfig;
      if (!cfg) return;
      const nextStatus: RackDeviceWorkload['status'] = wl.status === 'up' ? 'stopped' : 'up';
      updateAsset(rackId, {
        rackConfig: {
          ...cfg,
          devices: cfg.devices.map((d) =>
            d.id !== deviceId
              ? d
              : {
                  ...d,
                  workloads: (d.workloads ?? []).map((w) =>
                    w.id === wl.id
                      ? {
                          ...w,
                          status: nextStatus,
                          cpuPct: nextStatus === 'up' ? Math.max(18, w.cpuPct || 26) : 0,
                          memPct: nextStatus === 'up' ? Math.max(35, w.memPct || 48) : 0,
                        }
                      : w
                  ),
                }
          ),
        },
      });
    },
    [itAssets, updateAsset]
  );

  // Cycle NAS drive bay health (healthy -> warning -> failed -> healthy)
  const handleCycleDriveBay = useCallback(
    (rackId: string, deviceId: string, bay: RackDeviceDriveBay) => {
      const rack = itAssets.find((a) => a.id === rackId);
      const cfg = rack?.rackConfig;
      if (!cfg) return;
      const nextHealth: RackDeviceDriveBay['health'] =
        bay.health === 'healthy' ? 'warning' : bay.health === 'warning' ? 'failed' : 'healthy';
      const nextTemp = nextHealth === 'failed' ? 61 : nextHealth === 'warning' ? 52 : 39;
      updateAsset(rackId, {
        rackConfig: {
          ...cfg,
          devices: cfg.devices.map((d) =>
            d.id !== deviceId
              ? d
              : {
                  ...d,
                  driveBays: (d.driveBays ?? []).map((b) =>
                    b.id === bay.id ? { ...b, health: nextHealth, tempC: nextTemp } : b
                  ),
                }
          ),
        },
      });
      showToast(`NAS Drive Bay #${bay.slot} (${bay.label}): ${nextHealth.toUpperCase()}`, nextHealth === 'healthy' ? 'success' : 'warning');
    },
    [itAssets, updateAsset, showToast]
  );

  // Restore all switches, ports, links, and nodes UP
  const handleRestoreAllUp = useCallback(() => {
    itAssets.forEach((rack) => {
      const cfg = rack.rackConfig;
      if (!cfg) return;
      const needsFix = cfg.devices.some(
        (d) =>
          d.status === 'offline' ||
          d.ports.some((p) => p.status === 'down' || p.status === 'error') ||
          (d.driveBays ?? []).some((b) => b.health !== 'healthy')
      );
      if (needsFix) {
        updateAsset(rack.id, {
          rackConfig: {
            ...cfg,
            devices: cfg.devices.map((d) => ({
              ...d,
              status: 'online',
              ports: d.ports.map((p) => (p.status === 'down' || p.status === 'error' ? { ...p, status: 'up' } : p)),
              driveBays: d.driveBays?.map((b) => ({ ...b, health: 'healthy', tempC: Math.min(b.tempC, 42) })),
            })),
          },
        });
      }
    });
    interRackLinks.forEach((l) => {
      if (l.status !== 'up') updateInterRackLink(l.id, { status: 'up', crcErrors: 0 });
    });
    userNodes.forEach((u) => {
      if (u.status !== 'online') updateNetworkUserNode(u.id, { status: 'online', crcErrors: 0, packetLossPct: 0 });
    });
    if (mapState.customNodes.some((c) => c.status !== 'online') || mapState.customCables.some((c) => c.status !== 'up')) {
      patchMap(
        (prev) => ({
          ...prev,
          customNodes: prev.customNodes.map((c) => ({ ...c, status: 'online' })),
          customCables: prev.customCables.map((c) => ({ ...c, status: 'up' })),
        }),
        'Restored all IT links UP'
      );
    }
    showToast('All Data Center switches, ports, NAS drives, and trunks restored UP', 'success');
  }, [itAssets, interRackLinks, userNodes, mapState, updateAsset, updateInterRackLink, updateNetworkUserNode, patchMap, showToast]);

  // Simulate Core Switch Outage 1-click demo button ("Switch down? Red")
  const handleSimulateSwitchOutage = useCallback(() => {
    const target =
      nodes.find((n) => n.device?.id === 'dev-sw-1') ??
      nodes.find((n) => n.device?.kind === 'switch');
    if (target) handleToggleNodePower(target);
  }, [nodes, handleToggleNodePower]);

  // Calculate exact anchor coordinate for a node + optional portId
  const getAnchorPoint = useCallback(
    (node: UnifiedNode, portId: string | undefined, targetNode: UnifiedNode): { x: number; y: number } => {
      const targetBelow = targetNode.y + targetNode.height / 2 >= node.y + node.height / 2;
      const targetRight = targetNode.x + targetNode.width / 2 >= node.x + node.width / 2;
      const mostlyHorizontal =
        Math.abs(targetNode.x + targetNode.width / 2 - (node.x + node.width / 2)) >
        Math.abs(targetNode.y + targetNode.height / 2 - (node.y + node.height / 2)) * 1.4;

      // Exact port slot coordinate on switches & firewalls
      if (node.source === 'rack-device' && node.device && portId) {
        const pIdx = node.device.ports.findIndex((p) => p.id === portId);
        if (pIdx >= 0) {
          if (node.device.kind === 'switch') {
            // Switch port bank sits in the right half of the 510px card: x=[196..490]
            const portX = node.x + 210 + (pIdx % 8) * 34;
            const portY = targetBelow ? node.y + node.height : node.y;
            return { x: Math.min(node.x + node.width - 24, portX), y: portY };
          }
          if (node.device.kind === 'firewall' || node.device.kind === 'router') {
            const portX = node.x + 210 + (pIdx % 4) * 44;
            const portY = targetBelow ? node.y + node.height : node.y;
            return { x: Math.min(node.x + node.width - 24, portX), y: portY };
          }
        }
      }

      if (mostlyHorizontal) {
        return {
          x: targetRight ? node.x + node.width : node.x,
          y: node.y + node.height / 2,
        };
      }
      return {
        x: node.x + node.width / 2,
        y: targetBelow ? node.y + node.height : node.y,
      };
    },
    []
  );

  // Mouse coordinate conversion to canvas space
  const clientToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasViewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 200, y: 200 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  // Cursor-anchored wheel zoom via non-passive listener (smooth desktop zoom without page scroll)
  useEffect(() => {
    const el = canvasViewportRef.current;
    if (!el || effectiveDim !== '2d') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const oldZoom = zoomRef.current;
      const factor = e.deltaY > 0 ? 0.91 : 1.09;
      const nextZoom = Math.max(0.28, Math.min(1.8, Number((oldZoom * factor).toFixed(3))));
      if (nextZoom === oldZoom) return;
      const worldX = (cursorX - panRef.current.x) / oldZoom;
      const worldY = (cursorY - panRef.current.y) / oldZoom;
      setZoom(nextZoom);
      setPan({
        x: Math.round(cursorX - worldX * nextZoom),
        y: Math.round(cursorY - worldY * nextZoom),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [effectiveDim]);

  // Global pointer move/up handlers for smooth dragging (mouse & touch)
  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: PointerEvent) => {
      if (pinchStateRef.current) return;
      const dx = (e.clientX - dragState.startClientX) / zoom;
      const dy = (e.clientY - dragState.startClientY) / zoom;
      if (dragState.kind === 'pan') {
        setPan({
          x: dragState.origX + (e.clientX - dragState.startClientX),
          y: dragState.origY + (e.clientY - dragState.startClientY),
        });
      } else {
        setDragState({
          ...dragState,
          curX: snapVal(dragState.origX + dx, mapState.snapToGrid),
          curY: snapVal(dragState.origY + dy, mapState.snapToGrid),
        });
      }
    };
    const onUp = () => {
      if (dragState.kind === 'node') {
        const moved = dragState.curX !== dragState.origX || dragState.curY !== dragState.origY;
        if (moved) {
          patchMap(
            (prev) => ({
              ...prev,
              nodePositions: {
                ...prev.nodePositions,
                [dragState.key]: { x: dragState.curX, y: dragState.curY },
              },
            }),
            'Moved network map node'
          );
        }
      } else if (dragState.kind === 'box') {
        patchMap(
          (prev) => ({
            ...prev,
            boxes: prev.boxes.map((b) =>
              b.id === dragState.id ? { ...b, x: dragState.curX, y: dragState.curY } : b
            ),
          }),
          'Moved topology zone box'
        );
      } else if (dragState.kind === 'text') {
        patchMap(
          (prev) => ({
            ...prev,
            texts: prev.texts.map((t) =>
              t.id === dragState.id ? { ...t, x: dragState.curX, y: dragState.curY } : t
            ),
          }),
          'Moved canvas annotation'
        );
      } else if (dragState.kind === 'table') {
        patchMap(
          (prev) => ({
            ...prev,
            tables: prev.tables.map((t) =>
              t.id === dragState.id ? { ...t, x: dragState.curX, y: dragState.curY } : t
            ),
          }),
          'Moved canvas table'
        );
      }
      setDragState(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragState, zoom, mapState.snapToGrid, patchMap]);

  // Add elements from the Left Editor Palette
  const handleAddCustomDevice = (preset: TopologyCustomNode['kind']) => {
    const center = { x: snapVal((320 - pan.x) / zoom, mapState.snapToGrid), y: snapVal((180 - pan.y) / zoom, mapState.snapToGrid) };
    const id = `cn-${Date.now()}`;
    const presets: Record<TopologyCustomNode['kind'], Omit<TopologyCustomNode, 'id' | 'x' | 'y'>> = {
      vpn: {
        kind: 'vpn',
        badge: 'Wireguard',
        name: 'Site-to-Site VPN Peer',
        ipAddress: '10.42.99.20',
        vlan: 'VLAN-99-UPLINK',
        status: 'online',
        latencyMs: 0.6,
        packetLossPct: 0,
        uptimeLabel: '14d 2h',
      },
      tunnel: {
        kind: 'tunnel',
        badge: 'Cloudflare',
        name: 'Zero-Trust Edge Tunnel',
        ipAddress: '198.51.100.42',
        vlan: 'VLAN-99-UPLINK',
        status: 'online',
        latencyMs: 3.4,
        packetLossPct: 0,
        uptimeLabel: '22d 9h',
      },
      wan: {
        kind: 'wan',
        badge: 'ISP Fiber',
        name: 'Primary Dual-WAN Gateway',
        ipAddress: '203.0.113.1',
        vlan: 'VLAN-99-UPLINK',
        status: 'online',
        latencyMs: 1.8,
        packetLossPct: 0,
        uptimeLabel: '91d 12h',
      },
      ap: {
        kind: 'ap',
        badge: 'Nano HD',
        name: 'Cleanroom Wi-Fi 6E AP',
        ipAddress: '10.42.50.32',
        vlan: 'VLAN-50-WIFI',
        status: 'online',
        latencyMs: 1.1,
        packetLossPct: 0,
        uptimeLabel: '18d 5h',
      },
      controller: {
        kind: 'controller',
        badge: 'CloudKey',
        name: 'Network Controller Gen2+',
        ipAddress: '10.42.99.15',
        vlan: 'VLAN-99-UPLINK',
        status: 'online',
        latencyMs: 1.9,
        packetLossPct: 0,
        uptimeLabel: '45d 7h',
      },
      switch: {
        kind: 'switch',
        badge: 'MikroTik',
        name: 'CRS328-24P-4S+ Edge SW',
        ipAddress: '10.42.10.48',
        vlan: 'VLAN-10-OT',
        status: 'online',
        uptimeLabel: '12d 18h',
        ports: [
          { id: `${id}-p1`, label: 'eth1', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-10-OT', status: 'up' },
          { id: `${id}-p2`, label: 'eth2', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-20-SCADA', status: 'up' },
          { id: `${id}-p3`, label: 'sfp1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-99-UPLINK', status: 'up', isUplink: true },
        ],
      },
      nas: {
        kind: 'nas',
        badge: 'TrueNAS · NAS',
        name: 'Replica Backup Vault',
        ipAddress: '10.42.30.45',
        vlan: 'VLAN-30-EMS',
        status: 'online',
        cpuPct: 12,
        memPct: 38,
        diskPct: 54,
        uptimeLabel: '29d 1h',
      },
      hypervisor: {
        kind: 'hypervisor',
        badge: 'pve-02 · Proxmox',
        name: 'DR Compute Node 02',
        ipAddress: '10.42.10.29',
        vlan: 'VLAN-20-SCADA',
        status: 'online',
        cpuPct: 29,
        memPct: 51,
        uptimeLabel: '17d 14h',
      },
    };
    const created: TopologyCustomNode = { id, ...presets[preset], x: center.x, y: center.y };
    patchMap(
      (prev) => ({
        ...prev,
        customNodes: [...prev.customNodes, created],
        nodePositions: { ...prev.nodePositions, [`custom:${id}`]: { x: center.x, y: center.y } },
      }),
      `Added ${created.name} to Live Map`
    );
    setShowDevicePicker(false);
    setActiveTool('select');
    showToast(`Added ${created.name} onto canvas — drag to position or use Cable tool to connect`, 'success');
  };

  const handleAddZoneBox = (kind: 'box' | 'frame') => {
    const pos = { x: snapVal((220 - pan.x) / zoom, mapState.snapToGrid), y: snapVal((140 - pan.y) / zoom, mapState.snapToGrid) };
    const created: TopologyBox = {
      id: `box-${Date.now()}`,
      kind,
      title: kind === 'frame' ? 'IT Closet / IDF Zone' : 'Security Group',
      subtitle: kind === 'frame' ? 'Managed Enclosure' : undefined,
      x: pos.x,
      y: pos.y,
      width: 340,
      height: 220,
      color: kind === 'frame' ? '#38BDF8' : '#8B5CF6',
    };
    patchMap((prev) => ({ ...prev, boxes: [...prev.boxes, created] }), `Added ${kind} to map`);
    setSelectedBoxId(created.id);
    setActiveTool('select');
  };

  const handleAddTextNote = () => {
    const pos = { x: snapVal((280 - pan.x) / zoom, mapState.snapToGrid), y: snapVal((220 - pan.y) / zoom, mapState.snapToGrid) };
    const created: TopologyTextNote = {
      id: `txt-${Date.now()}`,
      text: 'Redundant 10G OM4 Fiber Path · GMP Validated',
      x: pos.x,
      y: pos.y,
      color: '#CBD5E1',
      fontSize: 12,
    };
    patchMap((prev) => ({ ...prev, texts: [...prev.texts, created] }), 'Added map text note');
    setSelectedTextId(created.id);
    setActiveTool('select');
  };

  const handleAddVlanTable = () => {
    const pos = { x: snapVal((300 - pan.x) / zoom, mapState.snapToGrid), y: snapVal((260 - pan.y) / zoom, mapState.snapToGrid) };
    const created: TopologyTableCard = {
      id: `tbl-${Date.now()}`,
      title: 'Facility VLAN & Subnet Allocation',
      x: pos.x,
      y: pos.y,
      tableKind: 'vlans',
      headers: ['VLAN', 'Segment', 'Subnet'],
      rows: mapState.vlans.map((v) => [v.vlanTag, v.name, v.subnet]),
    };
    patchMap((prev) => ({ ...prev, tables: [...prev.tables, created] }), 'Added VLAN summary table');
    setActiveTool('select');
  };

  // Interactive Cable Tool: click source port/device -> click destination port/device
  const handleCableClickTarget = (node: UnifiedNode, portId?: string, portLabel?: string) => {
    const anchorX = node.x + node.width / 2;
    const anchorY = node.y + node.height / 2;
    if (!cableStart) {
      setCableStart({
        nodeKey: node.key,
        portId,
        x: anchorX,
        y: anchorY,
        label: portLabel ? `${node.device?.name ?? node.customNode?.name ?? 'Node'} [${portLabel}]` : node.device?.name ?? node.userNode?.code ?? node.customNode?.name ?? 'Node',
      });
      return;
    }
    if (cableStart.nodeKey === node.key) {
      setCableStart(null);
      return;
    }
    const created: TopologyCustomCable = {
      id: `cc-${Date.now()}`,
      fromNodeId: cableStart.nodeKey,
      fromPortId: cableStart.portId,
      toNodeId: node.key,
      toPortId: portId,
      label: `${newCableSpeed} ${newCableVlan}`,
      speedLabel: newCableSpeed,
      vlan: newCableVlan,
      color: resolveVlanColor(newCableVlan, mapState.vlans),
      style: newCableStyle,
      status: 'up',
    };
    patchMap((prev) => ({ ...prev, customCables: [...prev.customCables, created] }), `Connected cable ${created.label}`);
    setCableStart(null);
    setCableMouse(null);
    showToast(`Connected ${created.speedLabel} cable (${created.vlan})`, 'success');
  };

  // Fit a specific set of nodes smoothly inside viewport
  const fitNodesToViewport = useCallback((targetNodes: UnifiedNode[]) => {
    if (!canvasViewportRef.current || targetNodes.length === 0) {
      setZoom(0.78);
      setPan({ x: 24, y: 18 });
      return;
    }
    const rect = canvasViewportRef.current.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    targetNodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    });
    const contentW = Math.max(360, maxX - minX + 96);
    const contentH = Math.max(260, maxY - minY + 96);
    const nextZoom = Math.max(0.32, Math.min(1.08, Math.min(rect.width / contentW, rect.height / contentH)));
    setZoom(Number(nextZoom.toFixed(2)));
    setPan({
      x: Math.round((rect.width - contentW * nextZoom) / 2 - (minX - 48) * nextZoom),
      y: Math.round((rect.height - contentH * nextZoom) / 2 - (minY - 48) * nextZoom),
    });
  }, []);

  const handleFitView = useCallback(() => {
    fitNodesToViewport(visibleNodes);
  }, [fitNodesToViewport, visibleNodes]);

  // Auto-fit filtered subgraph when searching
  useEffect(() => {
    if (effectiveDim === '2d' && graphSearch.active && visibleNodes.length > 0) {
      const t = window.setTimeout(() => fitNodesToViewport(visibleNodes), 40);
      return () => window.clearTimeout(t);
    }
  }, [searchQuery, effectiveDim, graphSearch.active, visibleNodes, fitNodesToViewport]);

  // Auto-Arrange all cards into clean non-overlapping tiers (Perimeter -> Core -> Distribution/IDF -> Endpoints)
  const handleAutoArrange = useCallback(() => {
    const nextPositions: Record<string, { x: number; y: number }> = {};
    const tier0: UnifiedNode[] = [];
    const tier1: UnifiedNode[] = [];
    const tier2: UnifiedNode[] = [];
    const tier3: UnifiedNode[] = [];

    nodes.forEach((n) => {
      if (n.source === 'custom' || n.device?.kind === 'firewall' || n.device?.kind === 'router') {
        tier0.push(n);
      } else if (n.source === 'rack-device' && (n.device?.tier === 'core' || n.device?.kind === 'storage' || n.device?.kind === 'ups' || n.device?.kind === 'server')) {
        tier1.push(n);
      } else if (n.source === 'rack-device') {
        tier2.push(n);
      } else {
        tier3.push(n);
      }
    });

    const placeRow = (items: UnifiedNode[], startY: number, maxRowW: number) => {
      let curX = 40;
      let curY = startY;
      let rowH = 0;
      items.forEach((item) => {
        if (curX > 40 && curX + item.width > maxRowW) {
          curX = 40;
          curY += rowH + 54;
          rowH = 0;
        }
        nextPositions[item.key] = { x: snapVal(curX, mapState.snapToGrid), y: snapVal(curY, mapState.snapToGrid) };
        curX += item.width + 44;
        rowH = Math.max(rowH, item.height);
      });
      return items.length > 0 ? curY + rowH + 72 : startY;
    };

    let y = 40;
    y = placeRow(tier0, y, 1680);
    y = placeRow(tier1, y, 1780);
    y = placeRow(tier2, y, 1780);
    placeRow(tier3, y, 1780);

    patchMap((prev) => ({ ...prev, nodePositions: { ...prev.nodePositions, ...nextPositions } }), 'Auto-arranged live port map');
    showToast('Auto-arranged topology into clean non-overlapping tiers', 'success');
    window.setTimeout(() => {
      const updated = nodes.map((n) => ({ ...n, ...(nextPositions[n.key] ?? {}) }));
      fitNodesToViewport(updated);
    }, 60);
  }, [nodes, mapState.snapToGrid, patchMap, showToast, fitNodesToViewport]);

  // Visible VLAN tags lookup
  const hiddenVlans = useMemo(
    () => new Set(mapState.vlans.filter((v) => !v.visible).map((v) => v.vlanTag.toUpperCase())),
    [mapState.vlans]
  );

  // Count active alerts/outages for top strip
  const downDeviceCount = outageImpact.directlyDown.size;
  const affectedDownstreamCount = outageImpact.cascadedUnreachable.size;
  const prevDownCountRef = useRef(0);
  useEffect(() => {
    if (downDeviceCount > prevDownCountRef.current) {
      setShowOutageList(true);
    } else if (downDeviceCount === 0 && affectedDownstreamCount === 0) {
      setShowOutageList(false);
      setOutageSearch('');
      setOutageFilter('all');
    }
    prevDownCountRef.current = downDeviceCount;
  }, [downDeviceCount, affectedDownstreamCount]);

  // Build structured list of DOWN root devices & unreachable downstream equipment/user nodes
  const outageEntries = useMemo(() => {
    const rackById = new Map(itAssets.map((r) => [r.id, r]));
    const roomById = new Map(rooms.map((rm) => [rm.id, rm]));
    const floorById = new Map(floors.map((fl) => [fl.id, fl]));

    const buildEntry = (node: UnifiedNode, severity: 'down' | 'unreachable') => {
      if (node.source === 'rack-device' && node.device) {
        const rack = node.rackId ? rackById.get(node.rackId) : undefined;
        const rm = rack?.roomId ? roomById.get(rack.roomId) : undefined;
        const fl = rack?.floorId ? floorById.get(rack.floorId) : undefined;
        return {
          key: node.key,
          severity,
          node,
          code: rack?.assetId ?? `U${node.device.uStart}`,
          name: node.device.name,
          sublabel: `${node.device.vendor} ${node.device.model}`,
          kindLabel: node.device.kind.toUpperCase(),
          roomLabel: rm ? `${rm.code} · ${rm.name}` : rack?.rackConfig?.locationZone ?? 'Data Center',
          floorCode: fl?.code ?? '',
          ip: node.device.ipAddress,
          vlan: node.device.vlan,
          rackId: node.rackId,
          deviceId: node.device.id,
        };
      }
      if (node.source === 'user-node' && node.userNode) {
        const un = node.userNode;
        const rm = un.roomId ? roomById.get(un.roomId) : undefined;
        const fl = floorById.get(un.floorId);
        return {
          key: node.key,
          severity,
          node,
          code: un.code,
          name: un.name,
          sublabel: `Jack ${un.wallJackId} · ${un.media}`,
          kindLabel: un.nodeKind.replace('-', ' ').toUpperCase(),
          roomLabel: rm ? `${rm.code} · ${rm.name}` : 'Floor Area',
          floorCode: fl?.code ?? '',
          ip: un.ipAddress,
          vlan: un.vlan,
          nodeId: un.id,
        };
      }
      return {
        key: node.key,
        severity,
        node,
        code: node.customNode?.badge ?? 'NODE',
        name: node.customNode?.name ?? node.key,
        sublabel: node.customNode?.subtitle ?? 'Custom Node',
        kindLabel: (node.customNode?.kind ?? 'custom').toUpperCase(),
        roomLabel: 'Perimeter / Logical',
        floorCode: '',
        ip: node.customNode?.ipAddress ?? '',
        vlan: '',
      };
    };

    const downItems = nodes
      .filter((n) => outageImpact.directlyDown.has(n.key))
      .map((n) => buildEntry(n, 'down'));
    const unreachableItems = nodes
      .filter((n) => outageImpact.cascadedUnreachable.has(n.key))
      .map((n) => buildEntry(n, 'unreachable'));
    return [...downItems, ...unreachableItems];
  }, [nodes, outageImpact, itAssets, rooms, floors]);

  const filteredOutageEntries = useMemo(() => {
    const q = outageSearch.trim().toLowerCase();
    return outageEntries.filter((item) => {
      if (outageFilter === 'down' && item.severity !== 'down') return false;
      if (outageFilter === 'unreachable' && item.severity !== 'unreachable') return false;
      if (!q) return true;
      return (
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.roomLabel.toLowerCase().includes(q) ||
        item.ip.toLowerCase().includes(q) ||
        item.vlan.toLowerCase().includes(q) ||
        item.kindLabel.toLowerCase().includes(q)
      );
    });
  }, [outageEntries, outageFilter, outageSearch]);

  const handleFocusOutageNode = useCallback(
    (node: UnifiedNode) => {
      if (node.source === 'rack-device' && node.rackId && node.device) {
        onInspect({ kind: 'device', rackId: node.rackId, deviceId: node.device.id });
      } else if (node.source === 'user-node' && node.userNode) {
        onInspect({ kind: 'user-node', nodeId: node.userNode.id });
      }
      if (effectiveDim === '2d') {
        fitNodesToViewport([node]);
      }
    },
    [onInspect, effectiveDim, fitNodesToViewport]
  );

  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#080B12] text-zinc-100 select-none overflow-hidden">
      {/* ==================== COMPACT NON-OVERLAPPING RESPONSIVE TOP BAR ==================== */}
      <div className="px-2.5 sm:px-3 py-1.5 border-b border-zinc-800/90 bg-[#0C101A] flex flex-wrap items-center gap-1.5 shrink-0 z-20">
        {/* 2D / 3D Toggle */}
        <div className="inline-flex items-center p-0.5 rounded-lg bg-[#141926] border border-zinc-800 shrink-0">
          {(['2d', '3d'] as const).map((dim) => (
            <button
              key={dim}
              type="button"
              onClick={() => setEffectiveDim(dim)}
              className={`px-2 py-1 rounded-md text-[10.5px] font-bold uppercase transition-colors cursor-pointer whitespace-nowrap ${
                effectiveDim === dim
                  ? 'bg-cyan-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
              title={dim === '2d' ? '2D Interactive Port & Cable Schematic' : '3D Multi-Floor Facility Topology Map'}
            >
              {dim}
            </button>
          ))}
        </div>

        {/* Recursive Graph Search Bar */}
        <div className="relative flex-1 min-w-[140px] max-w-[260px]">
          <Search className="w-3.5 h-3.5 text-cyan-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search node, port, room…"
            className="w-full pl-7 pr-14 py-1 rounded-lg bg-[#121725] border border-zinc-800 focus:border-cyan-500 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          {searchQuery && (
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <span className="px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[9.5px] font-semibold tabular-nums">
                {visibleNodes.length}
              </span>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="p-0.5 rounded text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Pan / Edit segmented control (2D only) */}
        {effectiveDim === '2d' && (
          <div className="inline-flex items-center p-0.5 rounded-lg bg-[#141926] border border-zinc-800 shrink-0">
            <button
              type="button"
              onClick={() => {
                setEditorMode('viewing');
                setActiveTool('select');
                setCableStart(null);
                setMobileToolsOpen(false);
              }}
              className={`px-2 py-1 rounded-md text-[10.5px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                editorMode === 'viewing'
                  ? 'bg-zinc-200 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
              title="Pan / View Mode — drag anywhere to pan, pinch/wheel to zoom"
            >
              Pan
            </button>
            <button
              type="button"
              disabled={isReadOnly}
              onClick={() => setEditorMode('editing')}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold transition-colors whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer ${
                editorMode === 'editing'
                  ? 'bg-emerald-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
              title={
                isReadOnly
                  ? 'Read-Only / ACL locked — switch to Design Mode with edit permission to modify topology'
                  : 'Edit Mode — drag cards, add devices, and draw cables'
              }
            >
              {isReadOnly && <Lock className="w-2.5 h-2.5" />}
              <span>Edit</span>
            </button>
          </div>
        )}

        {/* Mobile Edit Tools Drawer Toggle */}
        {effectiveDim === '2d' && canEdit && (
          <button
            type="button"
            onClick={() => setMobileToolsOpen((v) => !v)}
            className={`sm:hidden p-1.5 rounded-lg border cursor-pointer shrink-0 ${
              mobileToolsOpen
                ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200'
                : 'border-zinc-800 bg-[#121723] text-zinc-300'
            }`}
            title="Toggle Edit Palette"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Undo / Redo / Arrange / VLAN / Rack / Fault / Zoom (cleanly aligned right when space permits) */}
        <div className="flex items-center gap-1 flex-wrap ml-auto shrink-0">
          {effectiveDim === '2d' && (
            <>
              <div className="hidden xl:inline-flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  disabled={!canUndo || isReadOnly}
                  onClick={undo}
                  className="p-1.5 rounded-md border border-zinc-800 bg-[#121723] hover:border-zinc-600 text-zinc-300 disabled:opacity-35 cursor-pointer"
                  title="Undo last topology edit"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={!canRedo || isReadOnly}
                  onClick={redo}
                  className="p-1.5 rounded-md border border-zinc-800 bg-[#121723] hover:border-zinc-600 text-zinc-300 disabled:opacity-35 cursor-pointer"
                  title="Redo last topology edit"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleAutoArrange}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-800 bg-[#121723] hover:border-cyan-500/70 text-[10.5px] font-medium text-zinc-200 cursor-pointer whitespace-nowrap shrink-0"
                title="Auto-arrange cards cleanly with zero overlaps"
              >
                <LayoutGrid className="w-3 h-3 text-cyan-400" />
                <span className="hidden 2xl:inline">Arrange</span>
              </button>

              <button
                type="button"
                onClick={() => setShowVlanPanel((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10.5px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  showVlanPanel || highlightVlan
                    ? 'border-cyan-500/70 bg-cyan-500/15 text-cyan-300'
                    : 'border-zinc-800 bg-[#121723] text-zinc-300 hover:border-zinc-600'
                }`}
                title="Filter & highlight VLANs"
              >
                <Layers className="w-3 h-3" />
                <span className="hidden sm:inline">VLAN{highlightVlan ? `: ${highlightVlan}` : ''}</span>
              </button>

              <select
                aria-label="Filter by Rack"
                value={rackFilter}
                onChange={(e) => setRackFilter(e.target.value)}
                className="hidden md:block px-1.5 py-1 rounded-md bg-[#121723] border border-zinc-800 text-[10.5px] text-zinc-200 cursor-pointer max-w-[122px] shrink-0"
              >
                <option value="all">Racks ({itAssets.length})</option>
                {itAssets.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.assetId} · {r.name.slice(0, 14)}
                  </option>
                ))}
              </select>
            </>
          )}

          {downDeviceCount > 0 || affectedDownstreamCount > 0 ? (
            <button
              type="button"
              onClick={handleRestoreAllUp}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-500/60 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[10.5px] font-semibold cursor-pointer whitespace-nowrap shrink-0"
              title="Restore all simulated offline switches"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Restore</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSimulateSwitchOutage}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-rose-500/50 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-[10.5px] font-semibold cursor-pointer whitespace-nowrap shrink-0"
              title="Simulate Core Switch Outage cascade"
            >
              <Zap className="w-3 h-3" />
              <span className="hidden sm:inline">Fault</span>
            </button>
          )}

          {/* Zoom cluster (2D only) */}
          {effectiveDim === '2d' && (
            <div className="inline-flex items-center rounded-md border border-zinc-800 bg-[#121723] overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.28, Number((z - 0.1).toFixed(2))))}
                className="px-1.5 py-1 text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                aria-label="Zoom out"
                title="Zoom out"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="px-1 text-[10px] font-mono tabular-nums text-zinc-300">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.1).toFixed(2))))}
                className="px-1.5 py-1 text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                aria-label="Zoom in"
                title="Zoom in"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={handleFitView}
                className="px-1.5 py-1 border-l border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                title="Fit visible topology to screen"
              >
                <Maximize2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Recursive Graph Search Active Banner */}
      {graphSearch.active && (
        <div className="px-3 py-1 bg-cyan-950/60 border-b border-cyan-500/35 flex items-center justify-between gap-2 text-[10.5px] shrink-0">
          <div className="flex items-center gap-2 text-cyan-200 truncate">
            <Route className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">
              Recursive graph trace for <strong className="text-white font-mono">"{searchQuery.trim()}"</strong>:{' '}
              <strong className="text-emerald-300 font-mono tabular-nums">{graphSearch.seedKeys.size}</strong> direct match
              {graphSearch.seedKeys.size === 1 ? '' : 'es'} →{' '}
              <strong className="text-cyan-300 font-mono tabular-nums">{visibleNodes.length}</strong> connected node
              {visibleNodes.length === 1 ? '' : 's'} &amp;{' '}
              <strong className="text-cyan-300 font-mono tabular-nums">{visibleEdges.length}</strong> link
              {visibleEdges.length === 1 ? '' : 's'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="text-[10.5px] font-semibold text-cyan-300 hover:text-white underline cursor-pointer shrink-0"
          >
            Reset Filter
          </button>
        </div>
      )}

      {/* Outage Impact Banner when any switch/device is DOWN — Clickable to inspect full affected list */}
      {(downDeviceCount > 0 || affectedDownstreamCount > 0) && (
        <div className="border-b border-rose-500/50 bg-rose-950/80 shrink-0 z-20">
          <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setShowOutageList((v) => !v)}
              className="flex items-center gap-2 text-rose-100 hover:text-white font-medium cursor-pointer text-left group"
              title="Click to view all offline devices and unreachable downstream equipment/user nodes"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>
                <strong className="text-rose-300 font-mono tabular-nums">{downDeviceCount}</strong> device{downDeviceCount === 1 ? '' : 's'} DOWN
                {affectedDownstreamCount > 0 && (
                  <>
                    {' '}· <strong className="text-rose-300 font-mono tabular-nums">{affectedDownstreamCount}</strong> downstream equipment/user node{affectedDownstreamCount === 1 ? '' : 's'} unreachable
                  </>
                )}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/20 border border-rose-400/40 group-hover:bg-rose-500/35 text-[10px] font-semibold text-rose-200 transition-colors">
                {showOutageList ? 'Hide Affected List' : `View Affected List (${outageEntries.length})`}
                {showOutageList ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </span>
            </button>
            <button
              type="button"
              onClick={handleRestoreAllUp}
              className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-400/40 hover:bg-emerald-500/30 text-[10.5px] font-semibold text-emerald-300 hover:text-emerald-100 cursor-pointer transition-colors"
            >
              Bring All Devices Online
            </button>
          </div>

          {/* Interactive Affected Outage Cascade List */}
          {showOutageList && (
            <div className="border-t border-rose-500/35 bg-[#12090D] flex flex-col max-h-[260px]">
              {/* Filter Tabs + Search */}
              <div className="px-3 py-1.5 border-b border-rose-900/60 flex flex-wrap items-center justify-between gap-2 text-[10.5px] shrink-0">
                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 'all', label: `All Affected (${outageEntries.length})` },
                      { id: 'down', label: `Offline Root (${downDeviceCount})` },
                      { id: 'unreachable', label: `Unreachable (${affectedDownstreamCount})` },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setOutageFilter(f.id)}
                      className={`px-2 py-0.5 rounded-md font-semibold transition-colors cursor-pointer ${
                        outageFilter === f.id
                          ? f.id === 'down'
                            ? 'bg-rose-600 text-white'
                            : f.id === 'unreachable'
                              ? 'bg-amber-600 text-white'
                              : 'bg-rose-500/30 text-white border border-rose-400/50'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="relative">
                    <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      value={outageSearch}
                      onChange={(e) => setOutageSearch(e.target.value)}
                      placeholder="Filter device, room, IP..."
                      className="pl-6 pr-2 py-0.5 w-44 sm:w-52 rounded-md bg-[#0B0609] border border-rose-900/70 focus:border-rose-400 text-[10.5px] text-zinc-100 placeholder-zinc-500 outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowOutageList(false)}
                    className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
                    title="Close Affected List"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Scrollable Rows */}
              <div className="overflow-y-auto overscroll-contain touch-pan-y divide-y divide-rose-950/70">
                {filteredOutageEntries.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[11px] text-zinc-400">
                    No affected devices match &ldquo;{outageSearch}&rdquo;.
                  </div>
                ) : (
                  filteredOutageEntries.map((item) => (
                    <div
                      key={item.key}
                      onClick={() => handleFocusOutageNode(item.node)}
                      className="px-3 py-1.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 hover:bg-rose-500/10 cursor-pointer transition-colors text-[11px]"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className={`px-1.5 py-0.5 rounded font-mono text-[9.5px] font-bold uppercase shrink-0 ${
                            item.severity === 'down'
                              ? 'bg-rose-600 text-white'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          }`}
                        >
                          {item.severity === 'down' ? 'DOWN' : 'UNREACHABLE'}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 font-mono text-[10px] font-bold text-cyan-300 shrink-0">
                          {item.code}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-100 truncate">
                            {item.name}
                            <span className="ml-1.5 text-[9.5px] font-mono text-zinc-500">{item.kindLabel}</span>
                          </div>
                          <div className="text-[10px] font-mono text-zinc-400 truncate">
                            {item.floorCode ? `${item.floorCode} · ` : ''}
                            {item.roomLabel}
                            {item.ip ? ` · ${item.ip}` : ''}
                            {item.vlan ? ` · ${item.vlan}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFocusOutageNode(item.node);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-700 hover:border-cyan-400 text-[10px] font-semibold text-zinc-200 hover:text-cyan-300 cursor-pointer"
                          title="Focus & inspect this device"
                        >
                          <Crosshair className="w-3 h-3" />
                          Inspect
                        </button>
                        {(item.rackId || item.nodeId) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onJumpTo3D({
                                rackId: item.rackId,
                                deviceId: item.deviceId,
                                nodeId: item.nodeId,
                              });
                            }}
                            className="px-1.5 py-0.5 rounded-md bg-cyan-950/70 border border-cyan-500/40 hover:bg-cyan-600 text-[10px] font-mono font-semibold text-cyan-200 hover:text-white cursor-pointer"
                            title="Locate in 3D Digital Twin"
                          >
                            3D
                          </button>
                        )}
                        {item.severity === 'down' && !isReadOnly && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleNodePower(item.node);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold cursor-pointer"
                            title="Power this device back UP"
                          >
                            <Power className="w-3 h-3" />
                            Bring UP
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cable Drawing Active Helper Strip */}
      {activeTool === 'cable' && canEdit && (
        <div className="px-3 py-1.5 bg-cyan-950/60 border-b border-cyan-500/40 flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0">
          <div className="flex items-center gap-2 text-cyan-200">
            <Cable className="w-3.5 h-3.5 text-cyan-400" />
            {cableStart ? (
              <span>
                Source locked: <strong className="text-white">{cableStart.label}</strong> — click destination port or device to connect.
              </span>
            ) : (
              <span>Cable Tool active — click any physical port socket or device card to start routing an orthogonal link.</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={newCableSpeed}
              onChange={(e) => setNewCableSpeed(e.target.value)}
              className="px-1.5 py-0.5 rounded bg-[#0C101A] border border-cyan-700 text-cyan-100 text-[11px]"
            >
              <option value="1G">1G Cat6A</option>
              <option value="2.5G">2.5G</option>
              <option value="10G">10G SFP+</option>
              <option value="40G">40G QSFP+</option>
              <option value="100G">100G QSFP28</option>
              <option value="VPN">VPN Tunnel</option>
            </select>
            <select
              value={newCableVlan}
              onChange={(e) => setNewCableVlan(e.target.value)}
              className="px-1.5 py-0.5 rounded bg-[#0C101A] border border-cyan-700 text-cyan-100 text-[11px]"
            >
              {mapState.vlans.map((v) => (
                <option key={v.id} value={v.vlanTag}>{v.vlanTag}</option>
              ))}
            </select>
            <select
              value={newCableStyle}
              onChange={(e) => setNewCableStyle(e.target.value as 'solid' | 'dashed')}
              className="px-1.5 py-0.5 rounded bg-[#0C101A] border border-cyan-700 text-cyan-100 text-[11px]"
            >
              <option value="solid">Solid (Physical)</option>
              <option value="dashed">Dashed (Logical/VPN)</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setCableStart(null);
                setActiveTool('select');
              }}
              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* ==================== MAIN CANVAS (3D OR 2D) + LEFT TOOL RAIL ==================== */}
      {effectiveDim === '3d' ? (
        <div className="flex-1 min-h-[340px] relative overflow-hidden">
          <DataCenter3DViewer
            mode="campus-topology"
            rackAssets={itAssets}
            activeRackId={
              inspected?.kind === 'rack' || inspected?.kind === 'device' || inspected?.kind === 'port'
                ? inspected.rackId
                : null
            }
            userNodes={userNodes}
            interRackLinks={interRackLinks}
            floors={floors}
            buildings={buildings}
            rooms={rooms}
            walls={walls}
            highlightedIds={graphSearch.highlighted3DIds}
            selectedItemId={
              inspected?.kind === 'user-node'
                ? inspected.nodeId
                : inspected?.kind === 'device'
                  ? inspected.deviceId
                  : inspected?.kind === 'port'
                    ? inspected.portId
                    : inspected?.kind === 'rack'
                      ? inspected.rackId
                      : null
            }
            onSelectRack={(rId) => {
              onInspect({ kind: 'rack', rackId: rId });
              setDetail3DTarget({ kind: 'rack', rackId: rId });
            }}
            onSelectDevice={(rId, dId) => {
              onInspect({ kind: 'device', rackId: rId, deviceId: dId });
              setDetail3DTarget({ kind: 'device', rackId: rId, deviceId: dId });
            }}
            onSelectPort={(rId, dId, pId) => {
              onInspect({ kind: 'port', rackId: rId, deviceId: dId, portId: pId });
              setDetail3DTarget({ kind: 'port', rackId: rId, deviceId: dId, portId: pId });
            }}
            onSelectUserNode={(nId) => {
              onInspect({ kind: 'user-node', nodeId: nId });
              setDetail3DTarget({ kind: 'user-node', nodeId: nId });
            }}
            onSelectRoom={(rmId, flId) => {
              setDetail3DTarget({ kind: 'room', roomId: rmId, floorId: flId });
            }}
          />
        </div>
      ) : (
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* LEFT VERTICAL TOOL PALETTE (collapsed on mobile unless toggled) */}
        {canEdit && (
          <div
            className={`${
              mobileToolsOpen ? 'flex absolute left-0 top-0 bottom-0 z-30 shadow-2xl' : 'hidden sm:flex'
            } w-[88px] sm:w-[92px] shrink-0 bg-[#0B0F19] border-r border-zinc-800/90 p-2 flex-col gap-1.5 overflow-y-auto z-20`}
          >
            {(
              [
                { id: 'select', label: 'Select', icon: <MousePointer2 className="w-3.5 h-3.5" /> },
                { id: 'device', label: 'Device', icon: <Server className="w-3.5 h-3.5" /> },
                { id: 'box', label: 'Box', icon: <Square className="w-3.5 h-3.5" /> },
                { id: 'frame', label: 'Frame', icon: <Frame className="w-3.5 h-3.5" /> },
                { id: 'text', label: 'Text', icon: <Type className="w-3.5 h-3.5" /> },
                { id: 'table', label: 'Table', icon: <Table2 className="w-3.5 h-3.5" /> },
                { id: 'networks', label: 'Networks', icon: <Network className="w-3.5 h-3.5" /> },
                { id: 'legend', label: 'Legend', icon: <Layers className="w-3.5 h-3.5" /> },
                { id: 'cable', label: 'Cable', icon: <Cable className="w-3.5 h-3.5" /> },
              ] as const
            ).map((item) => {
              const isActive =
                activeTool === item.id ||
                (item.id === 'networks' && showVlanPanel) ||
                (item.id === 'legend' && mapState.showLegend) ||
                (item.id === 'device' && showDevicePicker);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'device') {
                      setShowDevicePicker((v) => !v);
                      setActiveTool('device');
                    } else if (item.id === 'box') {
                      handleAddZoneBox('box');
                    } else if (item.id === 'frame') {
                      handleAddZoneBox('frame');
                    } else if (item.id === 'text') {
                      handleAddTextNote();
                    } else if (item.id === 'table') {
                      handleAddVlanTable();
                    } else if (item.id === 'networks') {
                      setShowVlanPanel((v) => !v);
                    } else if (item.id === 'legend') {
                      patchMap((p) => ({ ...p, showLegend: !p.showLegend }));
                    } else if (item.id === 'cable') {
                      setShowDevicePicker(false);
                      setActiveTool((t) => (t === 'cable' ? 'select' : 'cable'));
                      setCableStart(null);
                    } else {
                      setShowDevicePicker(false);
                      setCableStart(null);
                      setActiveTool('select');
                    }
                  }}
                  className={`w-full px-2 py-2 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-[#172133] border-cyan-500/70 text-cyan-200'
                      : 'bg-[#101522] border-zinc-800/90 text-zinc-300 hover:border-zinc-600 hover:text-white'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Device Add Picker Popover */}
        {showDevicePicker && canEdit && (
          <div className="absolute left-[104px] top-3 z-30 w-64 rounded-xl bg-[#0F1422] border border-zinc-700/90 shadow-2xl p-2.5 space-y-1.5">
            <div className="flex items-center justify-between pb-1 border-b border-zinc-800">
              <span className="text-[11px] font-semibold text-zinc-200">Add Network / IT Node</span>
              <button
                type="button"
                onClick={() => {
                  setShowDevicePicker(false);
                  setActiveTool('select');
                }}
                className="text-zinc-500 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {(
              [
                { kind: 'vpn', label: 'Wireguard VPN Peer', sub: 'Remote Mgmt Tunnel' },
                { kind: 'tunnel', label: 'Cloudflare Tunnel', sub: 'Zero-Trust Edge' },
                { kind: 'wan', label: 'Dual-WAN ISP Gateway', sub: 'Fiber Internet Uplink' },
                { kind: 'switch', label: 'MikroTik / Edge Switch', sub: '24P RJ45 + 4SFP+' },
                { kind: 'ap', label: 'Wi-Fi 6E Access Point', sub: 'Cleanroom / Office AP' },
                { kind: 'controller', label: 'CloudKey Controller', sub: 'SDN Management' },
                { kind: 'nas', label: 'TrueNAS / Storage Vault', sub: 'Backup NAS Appliance' },
                { kind: 'hypervisor', label: 'Proxmox Compute Host', sub: 'VM / CT Cluster Node' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.kind}
                type="button"
                onClick={() => handleAddCustomDevice(opt.kind)}
                className="w-full text-left px-2.5 py-1.5 rounded-lg bg-[#141A2B] hover:bg-[#1B243B] border border-zinc-800 hover:border-cyan-500/60 transition-colors cursor-pointer"
              >
                <div className="text-[11.5px] font-semibold text-zinc-100">{opt.label}</div>
                <div className="text-[10px] text-zinc-400">{opt.sub}</div>
              </button>
            ))}
          </div>
        )}

        {/* VLANs & Subnets Floating Popover */}
        {showVlanPanel && (
          <div className="absolute right-3 top-3 z-30 w-72 rounded-xl bg-[#0F1422]/98 border border-zinc-700/90 shadow-2xl p-3 space-y-2.5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
              <span className="text-xs font-semibold text-zinc-100">VLANs &amp; Segments</span>
              <div className="flex items-center gap-2">
                {highlightVlan && (
                  <button
                    type="button"
                    onClick={() => setHighlightVlan(null)}
                    className="text-[10px] text-cyan-400 hover:underline cursor-pointer"
                  >
                    Show All
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowVlanPanel(false)}
                  className="text-zinc-500 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
              {mapState.vlans.map((v) => {
                const isHighlighted = highlightVlan === v.vlanTag;
                return (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border text-[11px] transition-colors ${
                      isHighlighted
                        ? 'bg-[#192338] border-cyan-500/70'
                        : 'bg-[#131929] border-zinc-800/80 hover:border-zinc-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setHighlightVlan(isHighlighted ? null : v.vlanTag)}
                      className="flex items-center gap-2 min-w-0 text-left cursor-pointer flex-1"
                    >
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: v.color }} />
                      <div className="min-w-0">
                        <div className="font-mono font-semibold text-zinc-100 truncate">{v.vlanTag}</div>
                        <div className="text-[10px] text-zinc-400 truncate">
                          {v.name} · {v.subnet}
                        </div>
                      </div>
                    </button>
                    <input
                      type="checkbox"
                      checked={v.visible}
                      onChange={(e) =>
                        patchMap((p) => ({
                          ...p,
                          vlans: p.vlans.map((x) => (x.id === v.id ? { ...x, visible: e.target.checked } : x)),
                        }))
                      }
                      title="Toggle VLAN visibility"
                      className="accent-cyan-500 cursor-pointer"
                    />
                  </div>
                );
              })}
            </div>
            {canEdit && (
              <div className="pt-2 border-t border-zinc-800 space-y-1.5">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="VLAN-80-IOT"
                    value={newVlanTag}
                    onChange={(e) => setNewVlanTag(e.target.value)}
                    className="flex-1 px-2 py-1 rounded bg-[#090D16] border border-zinc-700 text-[11px] font-mono text-zinc-100"
                  />
                  <input
                    type="color"
                    value={newVlanColor}
                    onChange={(e) => setNewVlanColor(e.target.value)}
                    className="w-7 h-7 rounded bg-transparent border border-zinc-700 cursor-pointer"
                  />
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Segment name"
                    value={newVlanName}
                    onChange={(e) => setNewVlanName(e.target.value)}
                    className="flex-1 px-2 py-1 rounded bg-[#090D16] border border-zinc-700 text-[11px] text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newVlanTag.trim()) return;
                      patchMap(
                        (p) => ({
                          ...p,
                          vlans: [
                            ...p.vlans,
                            {
                              id: `v-${Date.now()}`,
                              vlanTag: newVlanTag.trim().toUpperCase(),
                              name: newVlanName.trim() || 'Custom Segment',
                              subnet: `10.42.${80 + p.vlans.length}.0/24`,
                              color: newVlanColor,
                              visible: true,
                            },
                          ],
                        }),
                        `Added VLAN ${newVlanTag}`
                      );
                      setNewVlanTag('');
                      setNewVlanName('');
                    }}
                    className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== INFINITE DOT-GRID TOUCH-ENABLED VIEWPORT ==================== */}
        <div
          ref={canvasViewportRef}
          onPointerDown={(e) => {
            activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

            // 2-finger pinch-to-zoom initialization
            if (activePointersRef.current.size === 2) {
              const pts = Array.from(activePointersRef.current.values());
              const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
              const midX = (pts[0].x + pts[1].x) / 2;
              const midY = (pts[0].y + pts[1].y) / 2;
              pinchStateRef.current = {
                dist: Math.max(10, dist),
                midX,
                midY,
                startZoom: zoomRef.current,
                startPanX: panRef.current.x,
                startPanY: panRef.current.y,
              };
              setDragState(null);
              return;
            }

            const isBg =
              e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvasBg === 'true';
            // In PAN/VIEWING mode, dragging anywhere smoothly pans (mobile friendly!); in EDITING mode, pan on background
            if (isBg || editorMode === 'viewing') {
              if (isBg) {
                setSelectedEdgeId(null);
                setSelectedBoxId(null);
                setSelectedTextId(null);
              }
              setDragState({
                kind: 'pan',
                startClientX: e.clientX,
                startClientY: e.clientY,
                origX: panRef.current.x,
                origY: panRef.current.y,
                pointerId: e.pointerId,
              });
            }
          }}
          onPointerMove={(e) => {
            if (activePointersRef.current.has(e.pointerId)) {
              activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }
            if (pinchStateRef.current && activePointersRef.current.size >= 2) {
              const rect = canvasViewportRef.current?.getBoundingClientRect();
              const pts = Array.from(activePointersRef.current.values());
              const curDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
              const curMidX = (pts[0].x + pts[1].x) / 2;
              const curMidY = (pts[0].y + pts[1].y) / 2;
              const base = pinchStateRef.current;
              const ratio = curDist / base.dist;
              const nextZoom = Math.max(0.28, Math.min(1.8, Number((base.startZoom * ratio).toFixed(3))));
              if (rect) {
                const localStartMidX = base.midX - rect.left;
                const localStartMidY = base.midY - rect.top;
                const localCurMidX = curMidX - rect.left;
                const localCurMidY = curMidY - rect.top;
                const worldX = (localStartMidX - base.startPanX) / base.startZoom;
                const worldY = (localStartMidY - base.startPanY) / base.startZoom;
                setZoom(nextZoom);
                setPan({
                  x: Math.round(localCurMidX - worldX * nextZoom),
                  y: Math.round(localCurMidY - worldY * nextZoom),
                });
              }
              return;
            }
            if (activeTool === 'cable' && cableStart) {
              setCableMouse(clientToCanvas(e.clientX, e.clientY));
            }
          }}
          onPointerUp={(e) => {
            activePointersRef.current.delete(e.pointerId);
            if (activePointersRef.current.size < 2) {
              pinchStateRef.current = null;
            }
          }}
          onPointerCancel={(e) => {
            activePointersRef.current.delete(e.pointerId);
            if (activePointersRef.current.size < 2) {
              pinchStateRef.current = null;
            }
            setDragState(null);
          }}
          className={`flex-1 relative overflow-hidden touch-none ${
            activeTool === 'cable' ? 'cursor-crosshair' : dragState?.kind === 'pan' ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            backgroundColor: '#070A11',
            backgroundImage: 'radial-gradient(rgba(148, 163, 184, 0.22) 1px, transparent 1px)',
            backgroundSize: `${Math.max(12, 22 * zoom)}px ${Math.max(12, 22 * zoom)}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
          data-canvas-bg="true"
        >
          {/* Transformed World Layer */}
          <div
            data-canvas-bg="true"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              width: 2600,
              height: 2200,
              position: 'relative',
            }}
          >
            {/* LAYER 1: IT ROOM FRAMES & GROUP BOXES (hidden when recursive search isolates subgraph) */}
            {!graphSearch.active && mapState.boxes.map((bx) => {
              const curX = dragState?.kind === 'box' && dragState.id === bx.id ? dragState.curX : bx.x;
              const curY = dragState?.kind === 'box' && dragState.id === bx.id ? dragState.curY : bx.y;
              const isSelected = selectedBoxId === bx.id;
              return (
                <div
                  key={bx.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedBoxId(bx.id);
                    if (canEdit && activeTool === 'select') {
                      setDragState({
                        kind: 'box',
                        id: bx.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        origX: bx.x,
                        origY: bx.y,
                        curX: bx.x,
                        curY: bx.y,
                      });
                    }
                  }}
                  style={{
                    left: curX,
                    top: curY,
                    width: bx.width,
                    height: bx.height,
                    borderColor: isSelected ? '#22D3EE' : `${bx.color}44`,
                    backgroundColor: bx.kind === 'frame' ? `${bx.color}07` : `${bx.color}0C`,
                  }}
                  className={`absolute rounded-xl border ${
                    bx.kind === 'box' ? 'border-dashed' : 'border-solid'
                  } transition-colors`}
                >
                  <div
                    className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-md text-[10.5px] font-semibold absolute -top-3 left-3 bg-[#0C101B] border"
                    style={{ borderColor: `${bx.color}66`, color: bx.color }}
                  >
                    <span>{bx.title}</span>
                    {bx.subtitle && <span className="text-zinc-500 font-mono font-normal">· {bx.subtitle}</span>}
                    {canEdit && isSelected && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          patchMap((p) => ({ ...p, boxes: p.boxes.filter((x) => x.id !== bx.id) }), 'Removed box');
                        }}
                        className="text-rose-400 hover:text-rose-300 cursor-pointer ml-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* LAYER 2: ORTHOGONAL LIVE PORT CABLES (SVG) */}
            <svg
              className="absolute inset-0 pointer-events-none overflow-visible"
              width={2600}
              height={2200}
            >
              {visibleEdges.map((edge, idx) => {
                const fromNode = nodeByKey.get(edge.fromKey);
                const toNode = nodeByKey.get(edge.toKey);
                if (!fromNode || !toNode) return null;
                if (hiddenVlans.has(edge.vlan.toUpperCase())) return null;

                const a = getAnchorPoint(fromNode, edge.fromPortId, toNode);
                const b = getAnchorPoint(toNode, edge.toPortId, fromNode);
                const laneOffset = ((idx % 5) - 2) * 0.7;
                const { d, labelX, labelY } = buildOrthogonalPath(a.x, a.y, b.x, b.y, laneOffset);

                const endpointDown =
                  outageImpact.directlyDown.has(edge.fromKey) ||
                  outageImpact.directlyDown.has(edge.toKey) ||
                  outageImpact.cascadedUnreachable.has(edge.fromKey) ||
                  outageImpact.cascadedUnreachable.has(edge.toKey);

                const isDown = edge.baseStatus === 'down' || endpointDown;
                const isDegraded = !isDown && edge.baseStatus === 'degraded';
                const isVlanDimmed = Boolean(highlightVlan && edge.vlan.toUpperCase() !== highlightVlan.toUpperCase());
                const isSelected = selectedEdgeId === edge.id;

                const strokeColor = isDown
                  ? '#EF4444'
                  : isDegraded
                  ? '#F59E0B'
                  : edge.color;

                return (
                  <g
                    key={edge.id}
                    className="pointer-events-auto cursor-pointer"
                    opacity={isVlanDimmed ? 0.14 : 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEdgeId(edge.id);
                    }}
                  >
                    {/* Wide invisible hit target */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                    {/* Subtle under-glow for active/fault links */}
                    <path
                      d={d}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 5 : isDown ? 4 : 3.5}
                      strokeOpacity={isDown ? 0.25 : 0.15}
                      strokeLinejoin="round"
                    />
                    {/* Crisp main orthogonal cable */}
                    <path
                      d={d}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 2.6 : 1.8}
                      strokeDasharray={isDown ? '6 4' : edge.style === 'dashed' ? '4 4' : undefined}
                      strokeLinejoin="round"
                    />
                    {/* Port socket terminal dots */}
                    <circle cx={a.x} cy={a.y} r={3} fill={strokeColor} />
                    <circle cx={b.x} cy={b.y} r={3} fill={strokeColor} />

                    {/* Inline Speed / Fault label */}
                    <g transform={`translate(${labelX}, ${labelY})`}>
                      <rect
                        x={-22}
                        y={-9}
                        width={44}
                        height={15}
                        rx={3}
                        fill="#090D16"
                        stroke={isDown ? '#EF444488' : '#1E293B'}
                        strokeWidth={0.9}
                      />
                      <text
                        x={0}
                        y={2}
                        textAnchor="middle"
                        fill={isDown ? '#FCA5A5' : '#94A3B8'}
                        fontSize={9}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fontWeight={600}
                      >
                        {isDown ? 'DOWN' : edge.speedLabel}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* Rubber-band preview while drawing a new cable */}
              {activeTool === 'cable' && cableStart && cableMouse && (
                <path
                  d={buildOrthogonalPath(cableStart.x, cableStart.y, cableMouse.x, cableMouse.y, 0).d}
                  fill="none"
                  stroke="#22D3EE"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              )}
            </svg>

            {/* LAYER 3: TEXT ANNOTATIONS */}
            {!graphSearch.active && mapState.texts.map((tn) => {
              const curX = dragState?.kind === 'text' && dragState.id === tn.id ? dragState.curX : tn.x;
              const curY = dragState?.kind === 'text' && dragState.id === tn.id ? dragState.curY : tn.y;
              const isSel = selectedTextId === tn.id;
              return (
                <div
                  key={tn.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedTextId(tn.id);
                    if (canEdit && activeTool === 'select') {
                      setDragState({
                        kind: 'text',
                        id: tn.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        origX: tn.x,
                        origY: tn.y,
                        curX: tn.x,
                        curY: tn.y,
                      });
                    }
                  }}
                  style={{ left: curX, top: curY, color: tn.color, fontSize: tn.fontSize }}
                  className={`absolute px-2 py-0.5 rounded font-mono whitespace-nowrap ${
                    isSel ? 'ring-1 ring-cyan-500 bg-[#0F1422]/90' : ''
                  }`}
                >
                  {isSel && canEdit ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={tn.text}
                        onChange={(e) =>
                          patchMap((p) => ({
                            ...p,
                            texts: p.texts.map((x) => (x.id === tn.id ? { ...x, text: e.target.value } : x)),
                          }))
                        }
                        onPointerDown={(e) => e.stopPropagation()}
                        className="bg-transparent focus:outline-none text-zinc-100 min-w-[260px]"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          patchMap((p) => ({ ...p, texts: p.texts.filter((x) => x.id !== tn.id) }), 'Deleted note')
                        }
                        className="text-rose-400 hover:text-rose-300 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    tn.text
                  )}
                </div>
              );
            })}

            {/* LAYER 4: CANVAS VLAN / PORT TABLES */}
            {!graphSearch.active && mapState.tables.map((tbl) => {
              const curX = dragState?.kind === 'table' && dragState.id === tbl.id ? dragState.curX : tbl.x;
              const curY = dragState?.kind === 'table' && dragState.id === tbl.id ? dragState.curY : tbl.y;
              return (
                <div
                  key={tbl.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (canEdit && activeTool === 'select') {
                      setDragState({
                        kind: 'table',
                        id: tbl.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        origX: tbl.x,
                        origY: tbl.y,
                        curX: tbl.x,
                        curY: tbl.y,
                      });
                    }
                  }}
                  style={{ left: curX, top: curY }}
                  className="absolute w-[340px] rounded-xl bg-[#0D121E]/95 border border-zinc-700/80 shadow-xl overflow-hidden"
                >
                  <div className="px-3 py-1.5 bg-[#121829] border-b border-zinc-800 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-zinc-200">{tbl.title}</span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          patchMap((p) => ({ ...p, tables: p.tables.filter((x) => x.id !== tbl.id) }), 'Removed table')
                        }
                        className="text-zinc-500 hover:text-rose-400 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <table className="w-full text-[10px] font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-zinc-800/80 text-zinc-400">
                        {tbl.headers.map((h) => (
                          <th key={h} className="text-left px-2.5 py-1 font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tbl.rows.slice(0, 7).map((row, rIdx) => (
                        <tr key={rIdx} className="border-b border-zinc-800/40 text-zinc-300">
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-2.5 py-1 truncate max-w-[115px]">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}

            {/* LAYER 5: HARDWARE DEVICE CARDS WITH LIVE PORTS, DRIVE BAYS & HYPERVISOR VMs */}
            {visibleNodes.map((node) => {
              const isDirectlyDown = outageImpact.directlyDown.has(node.key);
              const isUnreachable = outageImpact.cascadedUnreachable.has(node.key);
              const isRedAlert = isDirectlyDown || isUnreachable;
              const isWarning =
                !isRedAlert &&
                (node.device?.status === 'warning' ||
                  node.userNode?.status === 'error' ||
                  node.userNode?.status === 'degraded');

              const isSearchSeed = graphSearch.active && graphSearch.seedKeys.has(node.key);
              const isInspected =
                (inspected?.kind === 'device' && node.device?.id === inspected.deviceId) ||
                (inspected?.kind === 'port' && node.device?.id === inspected.deviceId) ||
                (inspected?.kind === 'user-node' && node.userNode?.id === inspected.nodeId);

              const borderClass = isRedAlert
                ? 'border-rose-500/85 bg-[#190D14]/95 shadow-[0_0_24px_rgba(239,68,68,0.18)]'
                : isSearchSeed
                  ? 'border-amber-400 bg-[#18160F]/95 ring-2 ring-amber-400/45 shadow-[0_0_24px_rgba(245,158,11,0.22)]'
                  : isInspected
                    ? 'border-cyan-400/90 bg-[#101726]/95 shadow-[0_0_22px_rgba(34,211,238,0.14)]'
                    : isWarning
                      ? 'border-amber-500/70 bg-[#15141C]/95'
                      : 'border-zinc-700/80 hover:border-zinc-500/80 bg-[#0E1320]/95';

              const topBadgeTitle =
                node.source === 'rack-device' && node.device
                  ? shortDeviceBadge(node.device)
                  : node.source === 'custom' && node.customNode
                  ? node.customNode.badge
                  : node.userNode?.code ?? 'Endpoint';

              const statusLabel = isDirectlyDown
                ? 'DOWN'
                : isUnreachable
                ? 'NO UPLINK'
                : isWarning
                ? 'WARN'
                : 'UP';

              const startNodeDrag = (e: React.PointerEvent) => {
                // In PAN/VIEWING mode allow bubble up to viewport for seamless 1-finger panning & 2-finger pinch!
                if (editorMode === 'viewing') {
                  if (node.source === 'rack-device' && node.rackId && node.device) {
                    onInspect({ kind: 'device', rackId: node.rackId, deviceId: node.device.id });
                  } else if (node.source === 'user-node' && node.userNode) {
                    onInspect({ kind: 'user-node', nodeId: node.userNode.id });
                  }
                  return;
                }
                e.stopPropagation();
                if (activeTool === 'cable' && canEdit) {
                  handleCableClickTarget(node);
                  return;
                }
                // Sync with right-hand Inspector & Trace
                if (node.source === 'rack-device' && node.rackId && node.device) {
                  onInspect({ kind: 'device', rackId: node.rackId, deviceId: node.device.id });
                } else if (node.source === 'user-node' && node.userNode) {
                  onInspect({ kind: 'user-node', nodeId: node.userNode.id });
                }

                if (canEdit && activeTool === 'select') {
                  setDragState({
                    kind: 'node',
                    key: node.key,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    origX: node.x,
                    origY: node.y,
                    curX: node.x,
                    curY: node.y,
                  });
                }
              };

              return (
                <div
                  key={node.key}
                  onPointerDown={startNodeDrag}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    minHeight: node.height,
                  }}
                  className={`group absolute rounded-xl border transition-colors ${borderClass}`}
                >
                  {/* Top-Left Floating Status Tab Badge */}
                  <div
                    className={`absolute -top-3 left-3.5 px-2.5 py-0.5 rounded-md border text-[10.5px] font-semibold flex items-center gap-1.5 whitespace-nowrap ${
                      isRedAlert
                        ? 'bg-[#220E16] border-rose-500/75 text-zinc-200'
                        : isSearchSeed
                          ? 'bg-[#241B0B] border-amber-400/80 text-amber-200'
                          : 'bg-[#0C101C] border-zinc-700/90 text-zinc-200'
                    }`}
                  >
                    <span>{topBadgeTitle}</span>
                    {isSearchSeed && (
                      <span className="px-1 rounded bg-amber-400 text-zinc-950 font-mono text-[9px] font-bold">
                        MATCH
                      </span>
                    )}
                    <span
                      className={`font-mono text-[10px] font-bold ${
                        isRedAlert
                          ? 'text-rose-400'
                          : isWarning
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  {/* Top-Right Quick Actions (Power Fault Toggle + 3D/2D Jump + Delete Custom) */}
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute -top-3 right-2.5 flex items-center gap-1 opacity-85 group-hover:opacity-100 transition-opacity"
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleNodePower(node)}
                      title={isDirectlyDown ? 'Restore device UP' : 'Toggle device DOWN (simulate outage)'}
                      className={`p-1 rounded-md border text-[10px] cursor-pointer transition-colors ${
                        isDirectlyDown
                          ? 'bg-emerald-950 border-emerald-500/70 text-emerald-300 hover:bg-emerald-900'
                          : 'bg-[#0C101C] border-zinc-700 text-zinc-400 hover:text-rose-400 hover:border-rose-500/60'
                      }`}
                    >
                      <Power className="w-3 h-3" />
                    </button>
                    {(node.rackId || node.userNode) && (
                      <button
                        type="button"
                        onClick={() =>
                          onJumpTo3D({
                            rackId: node.rackId,
                            deviceId: node.device?.id,
                            nodeId: node.userNode?.id,
                          })
                        }
                        title="Locate in 3D Digital Twin"
                        className="px-1.5 py-0.5 rounded-md border border-zinc-700 bg-[#0C101C] hover:border-cyan-500/70 text-[9.5px] font-mono text-cyan-300 cursor-pointer"
                      >
                        3D
                      </button>
                    )}
                    {node.userNode && onTraceNode && (
                      <button
                        type="button"
                        onClick={() => onTraceNode(node.userNode!.id)}
                        title="Trace 3-tier cable path to Core DC"
                        className="p-1 rounded-md border border-zinc-700 bg-[#0C101C] hover:border-violet-500/70 text-violet-300 cursor-pointer"
                      >
                        <Route className="w-3 h-3" />
                      </button>
                    )}
                    {node.source === 'custom' && canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          patchMap(
                            (p) => ({
                              ...p,
                              customNodes: p.customNodes.filter((c) => c.id !== node.customNode!.id),
                              customCables: p.customCables.filter(
                                (cb) => cb.fromNodeId !== node.key && cb.toNodeId !== node.key
                              ),
                            }),
                            'Removed custom node'
                          )
                        }
                        title="Remove custom node"
                        className="p-1 rounded-md border border-zinc-700 bg-[#0C101C] hover:border-rose-500 text-zinc-400 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* ==================== CARD BODY BY HARDWARE TYPE ==================== */}
                  {/* 1. SWITCH CARD (2-row physical RJ45 faceplate + SFP+ cages) */}
                  {node.source === 'rack-device' && node.device?.kind === 'switch' && (
                    <div className="p-3 pt-4 flex items-center justify-between gap-3">
                      <div className="min-w-0 w-[168px] shrink-0 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                              isRedAlert
                                ? 'bg-rose-950/60 border-rose-500/50 text-rose-400'
                                : 'bg-[#161E31] border-zinc-700 text-cyan-300'
                            }`}
                          >
                            <Network className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[12px] font-bold text-white truncate">{node.device.model}</div>
                            <div className="text-[10.5px] font-mono text-amber-400/90 tabular-nums">
                              {node.device.ipAddress}
                            </div>
                          </div>
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-zinc-400 flex items-center gap-1.5">
                          <span>
                            Ports up{' '}
                            <strong className={isRedAlert ? 'line-through text-rose-400' : 'text-cyan-300'}>
                              {node.device.ports.filter((p) => p.status === 'up').length}
                            </strong>
                          </span>
                          <span>·</span>
                          <span className={isRedAlert ? 'line-through text-rose-400/80' : 'text-zinc-300'}>
                            {node.device.uptimeLabel ?? '21d 38m'}
                          </span>
                        </div>
                        <div className="text-[9.5px] font-mono text-zinc-500 truncate">
                          {node.rackCode} · U{node.device.uStart}
                        </div>
                      </div>

                      {/* Physical RJ45 Port Matrix + Right SFP+/QSFP Cages */}
                      <div
                        onPointerDown={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[#090C14] border border-zinc-800/90 shrink-0"
                      >
                        {/* 2-row RJ45 bank (16 slots: real ports + chassis reserve ports) */}
                        <div className="grid grid-cols-8 gap-1">
                          {Array.from({ length: 16 }).map((_, slotIdx) => {
                            const copperPorts = node.device!.ports.filter((p) => p.kind === 'RJ45');
                            const realPort = copperPorts[slotIdx];
                            const pColor = realPort
                              ? isRedAlert || realPort.status === 'down' || realPort.status === 'error'
                                ? '#EF4444'
                                : realPort.status === 'standby'
                                ? '#475569'
                                : resolveVlanColor(realPort.vlan, mapState.vlans)
                              : '#272F42';
                            const isPortSelected =
                              inspected?.kind === 'port' &&
                              inspected.deviceId === node.device!.id &&
                              realPort &&
                              inspected.portId === realPort.id;

                            return (
                              <button
                                key={slotIdx}
                                type="button"
                                disabled={!realPort}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!realPort) return;
                                  if (activeTool === 'cable' && canEdit) {
                                    handleCableClickTarget(node, realPort.id, realPort.label);
                                    return;
                                  }
                                  if (e.shiftKey && node.rackId) {
                                    handleTogglePortState(node.rackId, node.device!.id, realPort);
                                    return;
                                  }
                                  if (node.rackId) {
                                    onInspect({
                                      kind: 'port',
                                      rackId: node.rackId,
                                      deviceId: node.device!.id,
                                      portId: realPort.id,
                                    });
                                  }
                                }}
                                title={
                                  realPort
                                    ? `${realPort.label} (${realPort.kind} · ${realPort.speedGbps}G · ${realPort.vlan} · ${realPort.status.toUpperCase()})${
                                        realPort.connectedToLabel ? ` → ${realPort.connectedToLabel}` : ''
                                      }\nClick to inspect · Shift+Click to toggle UP/DOWN`
                                    : `Port ${slotIdx + 1} (Unpatched)`
                                }
                                style={{
                                  borderColor: isPortSelected ? '#FFFFFF' : pColor,
                                  boxShadow:
                                    realPort && !isRedAlert && realPort.status === 'up'
                                      ? `0 0 6px ${pColor}55`
                                      : undefined,
                                }}
                                className={`w-[22px] h-[20px] rounded-[3px] border bg-[#0E1320] flex flex-col items-center justify-between p-[2px] transition-transform ${
                                  realPort ? 'cursor-pointer hover:scale-110' : 'opacity-45 cursor-default'
                                }`}
                              >
                                <span className="w-2.5 h-[2px] rounded-full bg-zinc-700/90" />
                                <span
                                  className="w-3 h-[3px] rounded-full"
                                  style={{ backgroundColor: realPort ? pColor : '#1E293B' }}
                                />
                              </button>
                            );
                          })}
                        </div>

                        {/* Right-side SFP+ / QSFP28 Fiber Cages (4 cages) */}
                        <div className="pl-2 border-l border-zinc-800 grid grid-cols-2 gap-1">
                          {Array.from({ length: 4 }).map((_, sIdx) => {
                            const fiberPorts = node.device!.ports.filter((p) => p.kind !== 'RJ45');
                            const realPort = fiberPorts[sIdx];
                            const fColor = realPort
                              ? isRedAlert || realPort.status === 'down' || realPort.status === 'error'
                                ? '#EF4444'
                                : realPort.speedGbps >= 40
                                ? '#EC4899'
                                : '#A855F7'
                              : '#334155';
                            const isPortSelected =
                              inspected?.kind === 'port' &&
                              inspected.deviceId === node.device!.id &&
                              realPort &&
                              inspected.portId === realPort.id;

                            return (
                              <button
                                key={sIdx}
                                type="button"
                                disabled={!realPort}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!realPort) return;
                                  if (activeTool === 'cable' && canEdit) {
                                    handleCableClickTarget(node, realPort.id, realPort.label);
                                    return;
                                  }
                                  if (e.shiftKey && node.rackId) {
                                    handleTogglePortState(node.rackId, node.device!.id, realPort);
                                    return;
                                  }
                                  if (node.rackId) {
                                    onInspect({
                                      kind: 'port',
                                      rackId: node.rackId,
                                      deviceId: node.device!.id,
                                      portId: realPort.id,
                                    });
                                  }
                                }}
                                title={
                                  realPort
                                    ? `${realPort.label} (${realPort.kind} · ${realPort.speedGbps}G Fiber · ${realPort.status.toUpperCase()})\nClick to inspect · Shift+Click to toggle UP/DOWN`
                                    : `SFP+ Cage ${sIdx + 1} (Empty)`
                                }
                                style={{
                                  borderColor: isPortSelected ? '#FFFFFF' : fColor,
                                  boxShadow:
                                    realPort && !isRedAlert && realPort.status === 'up'
                                      ? `0 0 7px ${fColor}66`
                                      : undefined,
                                }}
                                className={`w-[24px] h-[20px] rounded-[3px] border bg-[#111526] flex items-center justify-center ${
                                  realPort ? 'cursor-pointer hover:scale-110' : 'opacity-40 cursor-default'
                                }`}
                              >
                                <span
                                  className="w-2.5 h-1.5 rounded-[1px]"
                                  style={{ backgroundColor: realPort ? `${fColor}88` : '#1E293B' }}
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 2. FIREWALL / ROUTER CARD (CPU/Mem/Uptime + Inline Labeled Port Strip) */}
                  {node.source === 'rack-device' &&
                    (node.device?.kind === 'firewall' || node.device?.kind === 'router') && (
                      <div className="p-3 pt-4 flex items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                                isRedAlert
                                  ? 'bg-rose-950/60 border-rose-500/60 text-rose-400'
                                  : 'bg-[#171C2D] border-zinc-700 text-amber-400'
                              }`}
                            >
                              <Shield className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[12px] font-bold text-white truncate">{node.device.model}</div>
                              <div className="text-[10.5px] font-mono text-amber-400/90 tabular-nums">
                                {node.device.ipAddress}
                              </div>
                            </div>
                          </div>
                          <div className="text-[10px] font-mono tabular-nums text-zinc-400 whitespace-nowrap">
                            CPU <strong className="text-sky-300">{node.device.cpuPct ?? 12}%</strong> · Mem{' '}
                            <strong className="text-violet-300">{node.device.memPct ?? 24}%</strong> ·{' '}
                            <span className={isRedAlert ? 'line-through text-rose-400' : 'text-zinc-300'}>
                              {node.device.uptimeLabel ?? '48d 14h'}
                            </span>
                          </div>
                        </div>

                        {/* Inline labeled physical port strip (like pfSense card in Screenshot 1) */}
                        <div
                          onPointerDown={(e) => e.stopPropagation()}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#090C14] border border-zinc-800 shrink-0"
                        >
                          {node.device.ports.slice(0, 4).map((p) => {
                            const pColor =
                              isRedAlert || p.status === 'down' || p.status === 'error'
                                ? '#EF4444'
                                : p.status === 'standby'
                                ? '#475569'
                                : resolveVlanColor(p.vlan, mapState.vlans);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (activeTool === 'cable' && canEdit) {
                                    handleCableClickTarget(node, p.id, p.label);
                                    return;
                                  }
                                  if (e.shiftKey && node.rackId) {
                                    handleTogglePortState(node.rackId, node.device!.id, p);
                                    return;
                                  }
                                  if (node.rackId) {
                                    onInspect({
                                      kind: 'port',
                                      rackId: node.rackId,
                                      deviceId: node.device!.id,
                                      portId: p.id,
                                    });
                                  }
                                }}
                                title={`${p.label} (${p.speedGbps}G · ${p.vlan} · ${p.status.toUpperCase()})\nShift+Click to toggle UP/DOWN`}
                                className="flex flex-col items-center gap-1 cursor-pointer group/port"
                              >
                                <span
                                  style={{ borderColor: pColor }}
                                  className="w-7 h-5 rounded-[3px] border bg-[#101626] flex items-center justify-center group-hover/port:scale-105 transition-transform"
                                >
                                  <span className="w-3 h-[3px] rounded-full" style={{ backgroundColor: pColor }} />
                                </span>
                                <span className="text-[8.5px] font-mono text-zinc-400 max-w-[38px] truncate">
                                  {p.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  {/* 3. NAS / STORAGE ARRAY CARD (Visual 4-Bay Drive Rack with Live Temps) */}
                  {node.source === 'rack-device' &&
                    (node.device?.kind === 'storage' || (node.device?.driveBays && node.device.driveBays.length > 0)) && (
                      <div className="p-3.5 pt-5 flex items-center justify-between gap-4">
                        {/* 4-Bay Visual Drive Schematic */}
                        <div
                          onPointerDown={(e) => e.stopPropagation()}
                          className="grid grid-cols-4 gap-1.5 p-2 rounded-lg bg-[#080B12] border border-zinc-800/90 shrink-0"
                        >
                          {(node.device.driveBays ?? []).map((bay) => {
                            const bayLed =
                              isRedAlert || bay.health === 'failed'
                                ? '#EF4444'
                                : bay.health === 'warning'
                                ? '#F59E0B'
                                : '#10B981';
                            return (
                              <button
                                key={bay.id}
                                type="button"
                                onClick={() => node.rackId && handleCycleDriveBay(node.rackId, node.device!.id, bay)}
                                title={`Bay ${bay.slot} (${bay.label}) · ${bay.capacityLabel} · ${bay.tempC}°C · ${bay.health.toUpperCase()}\nClick to cycle drive health state`}
                                className="flex flex-col items-center gap-1 cursor-pointer group/bay"
                              >
                                <div
                                  style={{ borderColor: `${bayLed}55` }}
                                  className="w-[34px] h-[94px] rounded-[5px] border bg-[#101624] p-1 flex flex-col justify-between group-hover/bay:border-cyan-400/70 transition-colors"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: bayLed }} />
                                    <span className="w-3 h-[2px] rounded-full bg-zinc-700" />
                                  </div>
                                  {/* Drive ventilation slots */}
                                  <div className="space-y-1">
                                    {[0, 1, 2, 3, 4].map((slot) => (
                                      <div key={slot} className="h-[2px] rounded-full bg-zinc-800" />
                                    ))}
                                  </div>
                                  <div className="h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                                    <div
                                      className="h-full"
                                      style={{ width: `${bay.usedPct ?? 72}%`, backgroundColor: bayLed }}
                                    />
                                  </div>
                                </div>
                                <div className="text-[9px] font-mono text-zinc-500 leading-none">{bay.slot}</div>
                                <div className="text-[8.5px] font-mono text-zinc-400 leading-none tabular-nums">
                                  {bay.capacityLabel}
                                </div>
                                <div
                                  className={`text-[8.5px] font-mono leading-none tabular-nums ${
                                    bay.tempC >= 55
                                      ? 'text-rose-400 font-bold'
                                      : bay.tempC >= 48
                                      ? 'text-amber-400'
                                      : 'text-zinc-500'
                                  }`}
                                >
                                  {bay.tempC} °C
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* Right NAS Telemetry */}
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-[#161E31] border border-zinc-700 flex items-center justify-center text-indigo-300 shrink-0">
                              <HardDrive className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[12.5px] font-bold text-white truncate">{node.device.model}</div>
                              <div className="text-[10.5px] font-mono text-amber-400/90 tabular-nums">
                                {node.device.ipAddress}
                              </div>
                            </div>
                          </div>
                          <div className="text-[10.5px] font-mono tabular-nums text-zinc-400 space-y-1">
                            <div>
                              CPU <strong className="text-sky-300">{node.device.cpuPct ?? 10}%</strong> · Mem{' '}
                              <strong className="text-violet-300">{node.device.memPct ?? 34}%</strong>
                            </div>
                            <div>
                              Disk <strong className="text-cyan-300">{node.device.diskPct ?? 73}%</strong> ·{' '}
                              <span className="text-zinc-400">{node.device.uptimeLabel ?? '64d 11h'}</span>
                            </div>
                          </div>
                          <div className="text-[9.5px] text-zinc-500">
                            Click any drive bay to test thermal / SMART alert
                          </div>
                        </div>
                      </div>
                    )}

                  {/* 4. HYPERVISOR / PROXMOX COMPUTE CARD (Nested VM / CT Grid) */}
                  {node.source === 'rack-device' &&
                    node.device?.workloads &&
                    node.device.workloads.length > 0 && (
                      <div className="p-3.5 pt-5 flex items-start gap-3.5">
                        {/* Left Host Info */}
                        <div className="w-[138px] shrink-0 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-[#142030] border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0">
                              <Database className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[12px] font-bold text-white truncate">Proxmox VE</div>
                              <div className="text-[10px] font-mono text-amber-400/90 tabular-nums">
                                {node.device.ipAddress}
                              </div>
                            </div>
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500">
                            {node.device.hypervisorVersion ?? 'VE 9.2.24'}
                          </div>
                          <div className="text-[10px] font-mono tabular-nums text-zinc-400 space-y-0.5 pt-1 border-t border-zinc-800/80">
                            <div>
                              CPU <strong className="text-sky-300">{node.device.cpuPct ?? 44}%</strong>
                            </div>
                            <div>
                              MEM <strong className="text-violet-300">{node.device.memPct ?? 62}%</strong>
                            </div>
                            <div className="text-zinc-500">{node.rackCode} · U{node.device.uStart}</div>
                          </div>
                        </div>

                        {/* Right 2-Column Live VM & Container Grid */}
                        <div
                          onPointerDown={(e) => e.stopPropagation()}
                          className="flex-1 grid grid-cols-2 gap-1.5"
                        >
                          {node.device.workloads.map((wl) => {
                            const wlDown = isRedAlert || wl.status === 'stopped';
                            return (
                              <button
                                key={wl.id}
                                type="button"
                                onClick={() => node.rackId && handleToggleWorkload(node.rackId, node.device!.id, wl)}
                                title={`Click to ${wl.status === 'up' ? 'stop' : 'start'} ${wl.name} (${wl.vmid})`}
                                className={`text-left p-2 rounded-lg border transition-colors cursor-pointer ${
                                  isRedAlert
                                    ? 'bg-rose-950/35 border-rose-500/45'
                                    : wl.status === 'stopped'
                                    ? 'bg-[#0A0D16] border-zinc-800/80 opacity-65 hover:opacity-95'
                                    : 'bg-[#0A0E19] border-zinc-800 hover:border-cyan-500/60'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1 text-[10.5px]">
                                  <span className="font-semibold text-zinc-100 truncate">{wl.name}</span>
                                  <span className="font-mono text-[9.5px] text-zinc-500 shrink-0">{wl.vmid}</span>
                                </div>
                                <div className="flex items-center justify-between text-[9.5px] mt-0.5">
                                  <span
                                    className={`font-mono font-bold ${
                                      isRedAlert
                                        ? 'text-rose-400'
                                        : wl.status === 'up'
                                        ? 'text-emerald-400'
                                        : 'text-zinc-500'
                                    }`}
                                  >
                                    {isRedAlert ? 'UNREACH' : wl.status === 'up' ? 'UP' : 'Stopped'}
                                  </span>
                                  <span className="text-zinc-500 font-mono">{wl.hostTag}</span>
                                </div>
                                {/* Micro CPU / MEM Bars */}
                                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                                  <div>
                                    <div className="text-[8px] font-mono text-zinc-500">CPU</div>
                                    <div className="h-1 rounded-full bg-zinc-800 overflow-hidden mt-0.5">
                                      <div
                                        className="h-full bg-sky-400"
                                        style={{ width: `${wlDown ? 0 : wl.cpuPct}%` }}
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[8px] font-mono text-zinc-500">MEM</div>
                                    <div className="h-1 rounded-full bg-zinc-800 overflow-hidden mt-0.5">
                                      <div
                                        className="h-full bg-emerald-400"
                                        style={{ width: `${wlDown ? 0 : wl.memPct}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  {/* 5. GENERIC RACK SERVER / UPS / PATCH PANEL CARD */}
                  {node.source === 'rack-device' &&
                    node.device &&
                    node.device.kind !== 'switch' &&
                    node.device.kind !== 'firewall' &&
                    node.device.kind !== 'router' &&
                    node.device.kind !== 'storage' &&
                    (!node.device.driveBays || node.device.driveBays.length === 0) &&
                    (!node.device.workloads || node.device.workloads.length === 0) && (
                      <div className="p-3 pt-4 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-[#161D2F] border border-zinc-700 flex items-center justify-center text-sky-300 shrink-0">
                            {node.device.kind === 'ups' ? <Zap className="w-4 h-4 text-amber-400" /> : <Server className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11.5px] font-bold text-white truncate">{node.device.name}</div>
                            <div className="text-[10px] font-mono text-amber-400/90 tabular-nums">
                              {node.device.ipAddress}
                            </div>
                          </div>
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-zinc-400">
                          CPU <strong className="text-sky-300">{node.device.cpuPct ?? 18}%</strong> · Temp{' '}
                          <strong className="text-emerald-300">{node.device.tempC ?? 36}°C</strong> ·{' '}
                          <span>{node.device.uptimeLabel ?? '33d 9h'}</span>
                        </div>
                      </div>
                    )}

                  {/* 6. USER ENDPOINT / AP / HMI / HPLC DROP CARD */}
                  {node.source === 'user-node' && node.userNode && (
                    <div className="p-3 pt-4 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                            isRedAlert
                              ? 'bg-rose-950/60 border-rose-500/60 text-rose-400'
                              : 'bg-[#151D2F] border-zinc-700 text-teal-300'
                          }`}
                        >
                          {node.userNode.nodeKind === 'wifi-ap' ? (
                            <Wifi className="w-4 h-4 text-sky-400" />
                          ) : (
                            <Monitor className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11.5px] font-bold text-white truncate">{node.userNode.name}</div>
                          <div className="text-[10px] font-mono text-amber-400/90 tabular-nums">
                            {node.userNode.ipAddress}
                          </div>
                        </div>
                      </div>
                      <div className="text-[10px] font-mono tabular-nums text-zinc-400">
                        Latency{' '}
                        <strong className={isRedAlert ? 'text-rose-400' : 'text-sky-300'}>
                          {isRedAlert ? '∞' : `${node.userNode.latencyMs.toFixed(1)} ms`}
                        </strong>{' '}
                        · Loss{' '}
                        <strong className={node.userNode.packetLossPct > 0 || isRedAlert ? 'text-rose-400' : 'text-emerald-400'}>
                          {isRedAlert ? '100%' : `${node.userNode.packetLossPct.toFixed(1)}%`}
                        </strong>
                      </div>
                    </div>
                  )}

                  {/* 7. CUSTOM VPN / TUNNEL / EDGE CARD (Wireguard, Cloudflare, Custom Switch) */}
                  {node.source === 'custom' && node.customNode && (
                    <div className="p-3 pt-4 space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                            node.customNode.kind === 'vpn'
                              ? 'bg-rose-950/50 border-rose-500/40 text-rose-400'
                              : node.customNode.kind === 'tunnel'
                              ? 'bg-amber-950/50 border-amber-500/40 text-amber-400'
                              : 'bg-[#151D2F] border-zinc-700 text-cyan-300'
                          }`}
                        >
                          {node.customNode.kind === 'vpn' ? (
                            <Shield className="w-4 h-4" />
                          ) : node.customNode.kind === 'tunnel' ? (
                            <Radio className="w-4 h-4" />
                          ) : (
                            <Cpu className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[12px] font-bold text-white truncate">{node.customNode.name}</div>
                          <div className="text-[10px] font-mono text-zinc-400 truncate">
                            {node.customNode.ipAddress}
                          </div>
                        </div>
                      </div>
                      <div className="text-[10px] font-mono tabular-nums text-zinc-400">
                        {node.customNode.latencyMs !== undefined ? (
                          <>
                            Latency <strong className="text-sky-300">{node.customNode.latencyMs} ms</strong> · Loss{' '}
                            <strong className="text-emerald-400">{(node.customNode.packetLossPct ?? 0).toFixed(1)}%</strong>
                          </>
                        ) : (
                          <>Uptime {node.customNode.uptimeLabel ?? '14d 2h'}</>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* FLOATING SELECTED CABLE ACTION BAR */}
          {selectedEdge && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 px-3 py-2 rounded-xl bg-[#0F1422]/98 border border-zinc-700 shadow-2xl flex flex-wrap items-center gap-3 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedEdge.color }} />
                <span className="font-semibold text-zinc-100">{selectedEdge.label}</span>
                <span className="font-mono text-zinc-400">
                  {selectedEdge.speedLabel} · {selectedEdge.vlan}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {selectedEdge.sourceKind === 'inter-rack' && selectedEdge.interRackId && (
                  <button
                    type="button"
                    onClick={() =>
                      updateInterRackLink(selectedEdge.interRackId!, {
                        status: selectedEdge.baseStatus === 'down' ? 'up' : 'down',
                      })
                    }
                    className="px-2 py-1 rounded-md border border-zinc-700 bg-[#171E30] hover:border-rose-500 text-zinc-200 cursor-pointer"
                  >
                    {selectedEdge.baseStatus === 'down' ? 'Bring Link UP' : 'Cut Fiber Link'}
                  </button>
                )}
                {selectedEdge.sourceKind === 'custom' && selectedEdge.customCableId && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        patchMap((p) => ({
                          ...p,
                          customCables: p.customCables.map((c) =>
                            c.id === selectedEdge.customCableId
                              ? { ...c, status: c.status === 'down' ? 'up' : 'down' }
                              : c
                          ),
                        }))
                      }
                      className="px-2 py-1 rounded-md border border-zinc-700 bg-[#171E30] hover:border-rose-500 text-zinc-200 cursor-pointer"
                    >
                      {selectedEdge.baseStatus === 'down' ? 'Restore UP' : 'Set DOWN'}
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          patchMap(
                            (p) => ({
                              ...p,
                              customCables: p.customCables.filter((c) => c.id !== selectedEdge.customCableId),
                            }),
                            'Deleted cable'
                          );
                          setSelectedEdgeId(null);
                        }}
                        className="px-2 py-1 rounded-md border border-rose-500/50 bg-rose-950/50 text-rose-300 hover:bg-rose-900/50 cursor-pointer"
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedEdgeId(null)}
                  className="text-zinc-500 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* FLOATING LEGEND CARD (toggleable via Left Rail 'Legend' tool) */}
          {mapState.showLegend && (
            <div className="absolute bottom-3 left-3 z-20 rounded-xl bg-[#0D121F]/95 border border-zinc-800 px-3 py-2 text-[10px] space-y-1.5 max-w-[235px]">
              <div className="flex items-center justify-between gap-2 text-zinc-300 font-semibold">
                <span>Live Port Legend</span>
                <button
                  type="button"
                  onClick={() => patchMap((p) => ({ ...p, showLegend: false }))}
                  className="text-zinc-500 hover:text-zinc-200 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-zinc-400 font-mono">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2 rounded-[2px] border border-emerald-400 bg-emerald-500/20" />
                  RJ45 Up
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2 rounded-[2px] border border-fuchsia-400 bg-fuchsia-500/20" />
                  SFP+ / QSFP
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2 rounded-[2px] border border-rose-500 bg-rose-500/25" />
                  Down / Fault
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 border-t border-dashed border-amber-400" />
                  VPN / Tunnel
                </span>
              </div>
              <div className="text-[9.5px] text-zinc-500 pt-1 border-t border-zinc-800/80">
                Click port to inspect · Shift+Click port to toggle · Drag cards in Editing mode
              </div>
            </div>
          )}

          {/* EMPTY SEARCH RESULT OVERLAY */}
          {graphSearch.active && visibleNodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 p-4">
              <div className="pointer-events-auto rounded-xl bg-[#0D121F]/95 border border-zinc-700 px-5 py-4 text-center space-y-2 max-w-sm">
                <div className="text-xs font-semibold text-zinc-100">
                  No devices, ports, rooms, or nodes match "{searchQuery.trim()}"
                </div>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold cursor-pointer"
                >
                  Clear Search Filter
                </button>
              </div>
            </div>
          )}

          {/* BOTTOM-RIGHT MINIMAL STATUS (Desktop only — zero clutter on mobile) */}
          <div className="absolute bottom-2.5 right-2.5 z-20 hidden md:flex items-center gap-2.5 px-2.5 py-1 rounded-lg bg-[#0D121F]/85 border border-zinc-800/80 text-[10px] font-mono tabular-nums text-zinc-400 pointer-events-none">
            <span>{visibleNodes.length} nodes</span>
            <span>·</span>
            <span>{visibleEdges.length} links</span>
            <span>·</span>
            <span className={downDeviceCount > 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400'}>
              {downDeviceCount > 0 ? `${downDeviceCount} DOWN` : 'All UP'}
            </span>
          </div>
        </div>
      </div>
      )}

      {/* Detailed IT 3D Equipment & Room Modal (3D preview, live telemetry, history & Go to 3D Model) */}
      <It3DDetailDialog
        target={detail3DTarget}
        onClose={() => setDetail3DTarget(null)}
        onChangeTarget={setDetail3DTarget}
        onFilterToRoom={(roomCode) => setSearchQuery(roomCode)}
      />
    </div>
  );
};
