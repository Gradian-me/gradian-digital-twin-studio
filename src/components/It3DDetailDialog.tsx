import React, { useMemo, useState } from 'react';
import {
  Activity,
  Box,
  Building2,
  Cable,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Filter,
  History,
  Info,
  Layers,
  Monitor,
  Network,
  QrCode,
  Radio,
  Server,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react';
import type {
  EquipmentArchetype,
  NetworkInterRackLink,
  NetworkUserNode,
  RackDevice,
  RackPort,
  Room,
  SpatialAsset,
} from '../types/twin';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useGmpStore } from '../store/useGmpStore';
import { useRiskIncidentStore } from '../store/useRiskIncidentStore';
import { enrichAssetHistory } from '../data/cinnagenDemo';
import { computeAssetFailurePredictions } from '../utils/predictiveMaintenance';
import { AssetMini3DViewer } from './AssetMini3DViewer';
import { DataCenter3DViewer } from './DataCenter3DViewer';

export type It3DDetailTarget =
  | { kind: 'room'; roomId: string; floorId?: string }
  | { kind: 'rack'; rackId: string }
  | { kind: 'device'; rackId: string; deviceId: string }
  | { kind: 'port'; rackId: string; deviceId: string; portId: string }
  | { kind: 'user-node'; nodeId: string };

interface It3DDetailDialogProps {
  target: It3DDetailTarget | null;
  onClose: () => void;
  onChangeTarget: (next: It3DDetailTarget) => void;
  onFilterToRoom?: (roomCode: string) => void;
  onOpenInRackTab?: (rackId: string, deviceId?: string) => void;
}

function synthesizeEndpointPreviewAsset(node: NetworkUserNode): SpatialAsset {
  const archetypeMap: Record<NetworkUserNode['nodeKind'], EquipmentArchetype> = {
    workstation: 'scada-console',
    'hmi-panel': 'scada-console',
    'hplc-drop': 'scada-console',
    'wifi-ap': 'patch-cabinet',
    'ip-phone': 'scada-console',
    'cctv-cam': 'patch-cabinet',
    'badge-reader': 'patch-cabinet',
    'iot-gateway': 'network-rack',
  };
  const dimMap: Record<NetworkUserNode['nodeKind'], [number, number, number]> = {
    workstation: [1.2, 0.75, 1.3],
    'hmi-panel': [0.9, 0.5, 1.5],
    'hplc-drop': [1.1, 0.8, 1.3],
    'wifi-ap': [0.6, 0.6, 0.45],
    'ip-phone': [0.55, 0.45, 0.45],
    'cctv-cam': [0.5, 0.5, 0.65],
    'badge-reader': [0.45, 0.3, 0.7],
    'iot-gateway': [0.7, 0.6, 0.9],
  };
  const [w, d, h] = dimMap[node.nodeKind] ?? [0.8, 0.6, 1.1];
  return {
    id: `preview-${node.id}`,
    floorId: node.floorId,
    roomId: node.roomId,
    templateId: 'it-endpoint',
    archetype: archetypeMap[node.nodeKind] ?? 'scada-console',
    name: node.name,
    assetId: node.code,
    equipmentId: node.wallJackId,
    category: 'IT & Data Center',
    manufacturer: 'Enterprise OT/IT',
    model: node.nodeKind.toUpperCase(),
    serialNumber: node.macAddress,
    description: node.notes || `${node.nodeKind} endpoint at ${node.wallJackId}`,
    tags: [node.vlan, node.media],
    criticality: 'medium',
    owner: 'IT Infrastructure',
    department: 'OT/IT Network',
    responsiblePerson: 'Network Engineering',
    x: node.x,
    y: 0,
    z: node.z,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    width: w,
    depth: d,
    height: h,
    weightKg: 12,
    clearanceM: 0.5,
    color: '#22D3EE',
    materialId: 'mat-powder-dark',
    layerId: 'layer-it',
    operationalStatus: node.status === 'online' ? 'running' : 'offline',
    installationDate: '2024-09-01',
    commissioningDate: '2024-09-15',
    warrantyUntil: '2028-09-01',
    maintenanceSchedule: 'Annual',
    lastMaintenance: '2026-06-01',
    nextMaintenance: '2027-06-01',
    capacityLabel: `${node.bandwidthMbps} Mbps`,
    utilizationPct: 24,
    availabilityPct: 99.9,
    conditionScore: 96,
    lifecycle: node.status === 'online' ? 'operational' : 'maintenance',
    capexUsd: 4200,
    annualOpexUsd: 350,
    energyKw: Math.max(0.02, node.poeWatts / 1000),
    connectivity: {
      protocol: 'REST API',
      endpoint: node.ipAddress,
      plcTag: node.wallJackId,
      scadaNode: node.code,
      historianId: node.id,
      liveMetrics: [],
    },
    documents: [],
    qrCode: node.code,
    relatedSystems: [node.vlan],
    relatedProcesses: [],
  };
}

export const It3DDetailDialog: React.FC<It3DDetailDialogProps> = ({
  target,
  onClose,
  onChangeTarget,
  onFilterToRoom,
  onOpenInRackTab,
}) => {
  const scene = useTwinStore((s) => s.scene);
  const auditLog = useTwinStore((s) => s.auditLog);
  const setScreen = useTwinStore((s) => s.setScreen);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const drillInto = useTwinStore((s) => s.drillInto);
  const selectEntity = useTwinStore((s) => s.selectEntity);
  const openEntityInfo = useTwinStore((s) => s.openEntityInfo);
  const closeRackDesigner = useTwinStore((s) => s.closeRackDesigner);
  const setCategoryFilter = useTwinStore((s) => s.setCategoryFilter);

  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const openDashboard = useTelemetryStore((s) => s.openDashboard);

  const complianceByAssetId = useGmpStore((s) => s.complianceByAssetId);
  const workOrders = useGmpStore((s) => s.workOrders);
  const openQrLabelModal = useGmpStore((s) => s.openQrLabelModal);

  const riskIncidents = useRiskIncidentStore((s) => s.incidents);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);

  const [tab, setTab] = useState<'overview' | 'components' | 'history'>('overview');
  const [previewMode, setPreviewMode] = useState<'pbr' | 'rack-3d'>('pbr');
  const [roomPreviewAssetId, setRoomPreviewAssetId] = useState<string | null>(null);

  const netArch = scene.networkArchitecture ?? {
    userNodes: [],
    interRackLinks: [],
    monitoringApis: [],
  };

  const itAssets = useMemo(
    () =>
      scene.assets.filter(
        (a) =>
          a.category === 'IT & Data Center' ||
          Boolean(a.rackConfig) ||
          ['server-rack', 'network-rack', 'patch-cabinet', 'pdu-cabinet', 'ups-tower', 'scada-console'].includes(
            a.archetype
          )
      ),
    [scene.assets]
  );

  // Resolve target entities
  const resolved = useMemo(() => {
    if (!target) return null;
    if (target.kind === 'room') {
      const room = scene.rooms.find((r) => r.id === target.roomId) ?? null;
      if (!room) return null;
      const floor = scene.floors.find((f) => f.id === room.floorId) ?? null;
      const building = floor ? scene.buildings.find((b) => b.id === floor.buildingId) ?? null : null;
      const roomAssets = scene.assets.filter((a) => a.roomId === room.id);
      const roomRacks = itAssets.filter((a) => a.roomId === room.id);
      const roomNodes = netArch.userNodes.filter((n) => n.roomId === room.id);
      return { kind: 'room' as const, room, floor, building, roomAssets, roomRacks, roomNodes };
    }
    if (target.kind === 'user-node') {
      const node = netArch.userNodes.find((n) => n.id === target.nodeId) ?? null;
      if (!node) return null;
      const floor = scene.floors.find((f) => f.id === node.floorId) ?? null;
      const building = floor ? scene.buildings.find((b) => b.id === floor.buildingId) ?? null : null;
      const room = node.roomId ? scene.rooms.find((r) => r.id === node.roomId) ?? null : null;
      const upstreamRack = scene.assets.find((a) => a.id === node.connectedRackId) ?? null;
      const upstreamDevice =
        upstreamRack?.rackConfig?.devices.find((d) => d.id === node.connectedDeviceId) ?? null;
      const upstreamPort =
        upstreamDevice?.ports.find((p) => p.id === node.connectedPortId) ?? null;
      // See if a nearby/linked spatial asset exists in the room for richer 3D preview
      const linkedSpatialAsset =
        scene.assets.find(
          (a) =>
            a.roomId === node.roomId &&
            (a.assetId.toLowerCase() === node.code.toLowerCase() ||
              Math.hypot(a.x - node.x, a.z - node.z) < 2.2)
        ) ?? null;
      return {
        kind: 'user-node' as const,
        node,
        floor,
        building,
        room,
        upstreamRack,
        upstreamDevice,
        upstreamPort,
        linkedSpatialAsset,
      };
    }
    // rack | device | port
    const rack = scene.assets.find((a) => a.id === target.rackId) ?? null;
    if (!rack) return null;
    const enrichedRack = enrichAssetHistory(rack);
    const floor = scene.floors.find((f) => f.id === rack.floorId) ?? null;
    const building = floor ? scene.buildings.find((b) => b.id === floor.buildingId) ?? null : null;
    const room = rack.roomId ? scene.rooms.find((r) => r.id === rack.roomId) ?? null : null;
    const device: RackDevice | null =
      target.kind === 'device' || target.kind === 'port'
        ? rack.rackConfig?.devices.find((d) => d.id === target.deviceId) ?? null
        : null;
    const port: RackPort | null =
      target.kind === 'port' && device
        ? device.ports.find((p) => p.id === target.portId) ?? null
        : null;
    const rackLinks: NetworkInterRackLink[] = netArch.interRackLinks.filter(
      (l) => l.fromRackId === rack.id || l.toRackId === rack.id
    );
    const connectedNodes = netArch.userNodes.filter((u) => u.connectedRackId === rack.id);
    return {
      kind: target.kind,
      rack: enrichedRack,
      device,
      port,
      floor,
      building,
      room,
      rackLinks,
      connectedNodes,
    };
  }, [target, scene, itAssets, netArch]);

  const predictions = useMemo(
    () => computeAssetFailurePredictions(sensors, readings, scene.assets, complianceByAssetId),
    [sensors, readings, scene.assets, complianceByAssetId]
  );

  if (!target || !resolved) return null;

  // Derived entity metadata for sensors, compliance, work orders, risks & audit history
  const primaryAssetId =
    resolved.kind === 'room'
      ? roomPreviewAssetId ?? resolved.roomRacks[0]?.id ?? resolved.roomAssets[0]?.id ?? null
      : resolved.kind === 'user-node'
        ? resolved.linkedSpatialAsset?.id ?? resolved.upstreamRack?.id ?? null
        : resolved.rack.id;

  const primaryRoomId = resolved.room?.id ?? null;

  const relatedSensors = sensors.filter((s) =>
    resolved.kind === 'room'
      ? (s.targetKind === 'room' && s.targetId === resolved.room.id) ||
        (s.targetKind === 'asset' && resolved.roomAssets.some((a) => a.id === s.targetId))
      : (primaryAssetId && s.targetKind === 'asset' && s.targetId === primaryAssetId) ||
        (primaryRoomId && s.targetKind === 'room' && s.targetId === primaryRoomId)
  );

  const primaryCompliance = primaryAssetId ? complianceByAssetId[primaryAssetId] : undefined;

  const relatedWorkOrders = workOrders.filter((wo) => {
    if (resolved.kind === 'room') {
      return (
        wo.targetId === resolved.room.id ||
        resolved.roomAssets.some((a) => a.id === wo.targetId)
      );
    }
    return (
      (primaryAssetId && wo.targetId === primaryAssetId) ||
      (primaryRoomId && wo.targetId === primaryRoomId)
    );
  });

  const relatedRisks = riskIncidents.filter((inc) => {
    if (resolved.kind === 'room') {
      return (
        inc.targetId === resolved.room.id ||
        resolved.roomAssets.some((a) => a.id === inc.targetId)
      );
    }
    return (
      (primaryAssetId && inc.targetId === primaryAssetId) ||
      (primaryRoomId && inc.targetId === primaryRoomId)
    );
  });

  const assetPrediction = primaryAssetId
    ? predictions.find((p) => p.assetId === primaryAssetId) ?? null
    : null;

  const searchTerms: string[] = [];
  if (resolved.kind === 'room') {
    searchTerms.push(resolved.room.code.toLowerCase(), resolved.room.name.toLowerCase());
  } else if (resolved.kind === 'user-node') {
    searchTerms.push(resolved.node.code.toLowerCase(), resolved.node.name.toLowerCase());
  } else {
    searchTerms.push(resolved.rack.assetId.toLowerCase(), resolved.rack.name.toLowerCase());
    if (resolved.device) searchTerms.push(resolved.device.name.toLowerCase());
  }

  const relatedAudit = auditLog
    .filter((entry) => {
      const hay = `${entry.action} ${entry.summary}`.toLowerCase();
      return searchTerms.some((t) => t.length > 2 && hay.includes(t));
    })
    .slice(0, 12);

  // Header display values
  let title = '';
  let codeBadge = '';
  let subtitle = '';
  let statusTone: 'nominal' | 'warning' | 'alarm' = 'nominal';
  let statusLabel = 'ONLINE';

  if (resolved.kind === 'room') {
    title = resolved.room.name;
    codeBadge = resolved.room.code;
    subtitle = `${resolved.building?.code ?? 'Site'} · ${resolved.floor?.code ?? ''} · ${resolved.room.environmental.cleanroomGrade}`;
    statusTone =
      resolved.room.complianceStatus === 'deviation'
        ? 'alarm'
        : resolved.room.complianceStatus === 'review-due'
          ? 'warning'
          : 'nominal';
    statusLabel = resolved.room.complianceStatus.toUpperCase();
  } else if (resolved.kind === 'user-node') {
    title = resolved.node.name;
    codeBadge = resolved.node.code;
    subtitle = `${resolved.node.nodeKind.toUpperCase()} · Jack ${resolved.node.wallJackId} · ${resolved.node.ipAddress}`;
    statusTone =
      resolved.node.status === 'error' || resolved.node.status === 'offline'
        ? 'alarm'
        : resolved.node.status === 'degraded'
          ? 'warning'
          : 'nominal';
    statusLabel = resolved.node.status.toUpperCase();
  } else if (resolved.kind === 'port' && resolved.device && resolved.port) {
    title = `${resolved.device.name} · Port ${resolved.port.label}`;
    codeBadge = `${resolved.rack.assetId}:${resolved.port.label}`;
    subtitle = `${resolved.device.vendor} ${resolved.device.model} · ${resolved.port.speedGbps}G · ${resolved.port.vlan}`;
    statusTone =
      resolved.port.status === 'error'
        ? 'alarm'
        : resolved.port.status === 'down' || resolved.port.status === 'standby'
          ? 'warning'
          : 'nominal';
    statusLabel = resolved.port.status.toUpperCase();
  } else if (resolved.kind === 'device' && resolved.device) {
    title = resolved.device.name;
    codeBadge = `${resolved.rack.assetId} · U${resolved.device.uStart}`;
    subtitle = `${resolved.device.vendor} ${resolved.device.model} · ${resolved.device.ipAddress}`;
    statusTone =
      resolved.device.status === 'offline'
        ? 'alarm'
        : resolved.device.status === 'warning'
          ? 'warning'
          : 'nominal';
    statusLabel = resolved.device.status.toUpperCase();
  } else if (resolved.kind === 'rack' || resolved.kind === 'device' || resolved.kind === 'port') {
    title = resolved.rack.name;
    codeBadge = resolved.rack.assetId;
    subtitle = `${resolved.rack.manufacturer} ${resolved.rack.model} · ${resolved.room?.code ?? resolved.floor?.code ?? ''}`;
    statusTone =
      resolved.rack.lifecycle === 'decommissioned' || resolved.rack.operationalStatus === 'offline'
        ? 'alarm'
        : resolved.rack.lifecycle === 'maintenance' || resolved.rack.operationalStatus === 'maintenance-due'
          ? 'warning'
          : 'nominal';
    statusLabel = resolved.rack.lifecycle.toUpperCase();
  }

  // Navigate directly to the 3D Digital Twin facility model for this room or asset
  const handleGoTo3DModel = () => {
    setCategoryFilter('all');
    setViewMode('3d-perspective');
    setScreen('workspace');
    closeRackDesigner();
    onClose();

    if (resolved.kind === 'room') {
      setActiveFloor(resolved.room.floorId);
      selectEntity({ type: 'room', id: resolved.room.id });
      drillInto('room', resolved.room.id);
    } else if (resolved.kind === 'user-node') {
      setActiveFloor(resolved.node.floorId);
      if (resolved.linkedSpatialAsset) {
        selectEntity({ type: 'asset', id: resolved.linkedSpatialAsset.id });
        drillInto('asset', resolved.linkedSpatialAsset.id);
      } else if (resolved.room) {
        selectEntity({ type: 'room', id: resolved.room.id });
        drillInto('room', resolved.room.id);
      } else if (resolved.upstreamRack) {
        selectEntity({ type: 'asset', id: resolved.upstreamRack.id });
        drillInto('asset', resolved.upstreamRack.id);
      }
    } else {
      setActiveFloor(resolved.rack.floorId);
      selectEntity({ type: 'asset', id: resolved.rack.id });
      drillInto('asset', resolved.rack.id);
    }
  };

  // Open Full EntityInfoModal (GMP, SOPs, History, FMEA)
  const handleOpenFullEntityModal = () => {
    onClose();
    if (resolved.kind === 'room') {
      openEntityInfo({ type: 'room', id: resolved.room.id });
    } else if (resolved.kind === 'user-node') {
      if (resolved.linkedSpatialAsset) {
        openEntityInfo({ type: 'asset', id: resolved.linkedSpatialAsset.id });
      } else if (resolved.room) {
        openEntityInfo({ type: 'room', id: resolved.room.id });
      } else if (resolved.upstreamRack) {
        openEntityInfo({ type: 'asset', id: resolved.upstreamRack.id });
      }
    } else {
      openEntityInfo({ type: 'asset', id: resolved.rack.id });
    }
  };

  // Determine 3D model subject for the left PBR studio viewer
  const pbrAsset: SpatialAsset | null =
    resolved.kind === 'room'
      ? roomPreviewAssetId
        ? resolved.roomAssets.find((a) => a.id === roomPreviewAssetId) ?? null
        : null
      : resolved.kind === 'user-node'
        ? resolved.linkedSpatialAsset ?? synthesizeEndpointPreviewAsset(resolved.node)
        : resolved.rack;

  const pbrRoom: Room | null = resolved.kind === 'room' && !pbrAsset ? resolved.room : null;

  const isRackTarget =
    resolved.kind === 'rack' || resolved.kind === 'device' || resolved.kind === 'port';

  const statusColorCls =
    statusTone === 'alarm'
      ? 'text-rose-400 border-rose-500/40 bg-rose-500/10'
      : statusTone === 'warning'
        ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
        : 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] rounded-2xl bg-[#10121A] border border-zinc-800 shadow-2xl text-zinc-100 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="px-4 py-3 border-b border-zinc-800 bg-[#141723] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center text-cyan-400 shrink-0">
              {resolved.kind === 'room' ? (
                <Building2 className="w-4 h-4" />
              ) : resolved.kind === 'user-node' ? (
                <Monitor className="w-4 h-4" />
              ) : resolved.kind === 'port' ? (
                <Cable className="w-4 h-4" />
              ) : (
                <Server className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[11px] font-bold text-cyan-300">{codeBadge}</span>
                <span className="text-zinc-600">·</span>
                <h3 className="text-sm font-bold text-white truncate">{title}</h3>
                <span
                  className={`px-1.5 py-0.5 rounded-md border text-[9.5px] font-mono font-bold ${statusColorCls}`}
                >
                  {statusLabel}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleGoTo3DModel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              title="Navigate directly to this room or equipment inside the main 3D Facility Digital Twin"
            >
              <Box className="w-3.5 h-3.5" />
              <span>Go to 3D Model</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail dialog"
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main 2-Column Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-y-auto lg:overflow-hidden">
          {/* LEFT COLUMN: Interactive Detailed 3D Model Viewer */}
          <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-zinc-800 bg-[#0B0D14] p-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Box className="w-3.5 h-3.5 text-cyan-400" />
                Detailed 3D Model
              </span>

              {isRackTarget && (
                <div className="flex items-center p-0.5 rounded-lg bg-[#161926] border border-zinc-800 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('pbr')}
                    className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer ${
                      previewMode === 'pbr' ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Cabinet PBR
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('rack-3d')}
                    className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer ${
                      previewMode === 'rack-3d' ? 'bg-cyan-500 text-zinc-950' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Live 3D Rack
                  </button>
                </div>
              )}

              {resolved.kind === 'room' && roomPreviewAssetId && (
                <button
                  type="button"
                  onClick={() => setRoomPreviewAssetId(null)}
                  className="text-[10.5px] text-cyan-400 hover:text-cyan-300 cursor-pointer"
                >
                  Show Room Cutaway
                </button>
              )}
            </div>

            {/* Interactive 3D Canvas */}
            <div className="w-full">
              {isRackTarget && previewMode === 'rack-3d' ? (
                <div className="h-[260px] rounded-2xl overflow-hidden border border-zinc-800 bg-[#090B12]">
                  <DataCenter3DViewer
                    mode="single-rack"
                    rackAssets={itAssets}
                    activeRackId={resolved.rack.id}
                    userNodes={netArch.userNodes}
                    interRackLinks={netArch.interRackLinks}
                    floors={scene.floors}
                    buildings={scene.buildings}
                    rooms={scene.rooms}
                    walls={scene.walls}
                    selectedItemId={
                      resolved.port?.id ?? resolved.device?.id ?? resolved.rack.id
                    }
                    onSelectDevice={(rId, dId) =>
                      onChangeTarget({ kind: 'device', rackId: rId, deviceId: dId })
                    }
                    onSelectPort={(rId, dId, pId) =>
                      onChangeTarget({ kind: 'port', rackId: rId, deviceId: dId, portId: pId })
                    }
                  />
                </div>
              ) : (
                <AssetMini3DViewer
                  asset={pbrAsset}
                  room={pbrRoom}
                  height={260}
                  statusAccent={statusTone}
                  badgeText={codeBadge}
                />
              )}
            </div>

            {/* Room Quick Equipment Preview Strip */}
            {resolved.kind === 'room' && resolved.roomAssets.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                  Preview Equipment in {resolved.room.code} ({resolved.roomAssets.length})
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                  <button
                    type="button"
                    onClick={() => setRoomPreviewAssetId(null)}
                    className={`px-2 py-1 rounded-lg border text-[10.5px] whitespace-nowrap shrink-0 cursor-pointer ${
                      !roomPreviewAssetId
                        ? 'border-violet-500 bg-violet-500/20 text-violet-200 font-semibold'
                        : 'border-zinc-800 bg-[#141724] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Room Cutaway
                  </button>
                  {resolved.roomAssets.slice(0, 8).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setRoomPreviewAssetId(a.id)}
                      className={`px-2 py-1 rounded-lg border text-[10.5px] font-mono whitespace-nowrap shrink-0 cursor-pointer ${
                        roomPreviewAssetId === a.id
                          ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200 font-semibold'
                          : 'border-zinc-800 bg-[#141724] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {a.assetId}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Action Tiles */}
            <div className="grid grid-cols-2 gap-1.5 mt-auto pt-1">
              <button
                type="button"
                onClick={handleOpenFullEntityModal}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border border-zinc-800 bg-[#151824] hover:border-violet-500/70 text-[11px] font-semibold text-zinc-200 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5 text-violet-400" />
                <span>Full Twin Details</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  openDashboard({
                    tab: 'trends',
                    assetId: primaryAssetId,
                    roomId: primaryRoomId,
                  });
                }}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border border-zinc-800 bg-[#151824] hover:border-cyan-500/70 text-[11px] font-semibold text-zinc-200 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span>Live Telemetry</span>
              </button>

              {resolved.kind === 'room' && onFilterToRoom && (
                <button
                  type="button"
                  onClick={() => {
                    onFilterToRoom(resolved.room.code);
                    onClose();
                  }}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-[11px] font-semibold text-cyan-300 cursor-pointer"
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>Filter IT Map</span>
                </button>
              )}

              {isRackTarget && onOpenInRackTab && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenInRackTab(resolved.rack.id, resolved.device?.id);
                    onClose();
                  }}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-[11px] font-semibold text-cyan-300 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Rack Elevation</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  onClose();
                  const preselect = primaryAssetId
                    ? [`asset:${primaryAssetId}`]
                    : primaryRoomId
                      ? [`room:${primaryRoomId}`]
                      : undefined;
                  openQrLabelModal('designer', preselect);
                }}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border border-zinc-800 bg-[#151824] hover:border-amber-500/60 text-[11px] font-semibold text-zinc-200 cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5 text-amber-400" />
                <span>QR Asset Tag</span>
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN: Tabbed Detailed Information, Equipment/Ports & History */}
          <div className="lg:col-span-7 flex flex-col min-h-0">
            {/* Sub-Navigation Tabs */}
            <div className="px-4 py-2 border-b border-zinc-800 bg-[#131622] flex items-center gap-1 shrink-0">
              {(
                [
                  { id: 'overview', label: 'Overview & Live Data', icon: <Info className="w-3.5 h-3.5" /> },
                  {
                    id: 'components',
                    label: resolved.kind === 'room' ? 'Equipment & Nodes' : 'Ports & Links',
                    icon: <Network className="w-3.5 h-3.5" />,
                  },
                  {
                    id: 'history',
                    label: 'History, GMP & FMEA',
                    icon: <History className="w-3.5 h-3.5" />,
                  },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    tab === t.id
                      ? 'bg-violet-600 text-white'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70'
                  }`}
                >
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            {/* Scrollable Tab Content */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-4 text-xs">
              {/* TAB 1: OVERVIEW & TELEMETRY */}
              {tab === 'overview' && (
                <>
                  {/* Specification Key-Value Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {resolved.kind === 'room' && (
                      <>
                        <SpecCard label="Room Code" value={resolved.room.code} mono />
                        <SpecCard label="Cleanroom Grade" value={resolved.room.environmental.cleanroomGrade} />
                        <SpecCard
                          label="Footprint"
                          value={`${resolved.room.width.toFixed(1)}×${resolved.room.depth.toFixed(1)}m (${(resolved.room.width * resolved.room.depth).toFixed(0)} m²)`}
                          mono
                        />
                        <SpecCard
                          label="IT Racks / Nodes"
                          value={`${resolved.roomRacks.length} racks · ${resolved.roomNodes.length} drops`}
                          mono
                        />
                        <SpecCard
                          label="Temp / RH Target"
                          value={`${resolved.room.environmental.temperatureC}°C · ${resolved.room.environmental.humidityPct}%`}
                          mono
                        />
                        <SpecCard
                          label="Pressure / ACH"
                          value={`${resolved.room.environmental.pressurePa >= 0 ? '+' : ''}${resolved.room.environmental.pressurePa} Pa · ${resolved.room.environmental.airChangesPerHour} ACH`}
                          mono
                        />
                      </>
                    )}

                    {resolved.kind === 'user-node' && (
                      <>
                        <SpecCard label="IP Address" value={resolved.node.ipAddress} mono />
                        <SpecCard label="MAC Address" value={resolved.node.macAddress} mono />
                        <SpecCard label="VLAN / Media" value={`${resolved.node.vlan} · ${resolved.node.media}`} mono />
                        <SpecCard label="Wall Jack" value={resolved.node.wallJackId} mono />
                        <SpecCard
                          label="Latency / Loss"
                          value={`${resolved.node.latencyMs.toFixed(1)} ms · ${resolved.node.packetLossPct.toFixed(2)}%`}
                          mono
                        />
                        <SpecCard
                          label="Bandwidth / PoE"
                          value={`${resolved.node.bandwidthMbps} Mbps · ${resolved.node.poeWatts}W`}
                          mono
                        />
                      </>
                    )}

                    {isRackTarget && (
                      <>
                        <SpecCard
                          label="Location"
                          value={`${resolved.building?.code ?? ''} · ${resolved.floor?.code ?? ''} · ${resolved.room?.code ?? 'Unassigned'}`}
                          mono
                        />
                        <SpecCard
                          label="Hardware"
                          value={
                            resolved.device
                              ? `${resolved.device.vendor} ${resolved.device.model}`
                              : `${resolved.rack.manufacturer} ${resolved.rack.model}`
                          }
                        />
                        <SpecCard
                          label={resolved.device ? 'Management IP' : 'Subnet CIDR'}
                          value={
                            resolved.device
                              ? resolved.device.ipAddress
                              : resolved.rack.rackConfig?.subnetCidr ?? '—'
                          }
                          mono
                        />
                        <SpecCard
                          label={resolved.device ? 'VLAN / Tier' : 'Rack Role'}
                          value={
                            resolved.device
                              ? `${resolved.device.vlan} · ${resolved.device.tier ?? resolved.device.kind}`
                              : resolved.rack.rackConfig?.rackRole ?? 'IT Cabinet'
                          }
                          mono
                        />
                        <SpecCard
                          label="Power / Thermal"
                          value={
                            resolved.device
                              ? `${resolved.device.powerW} W · ${resolved.device.tempC ?? 36}°C`
                              : `${resolved.rack.energyKw.toFixed(2)} kW · ${resolved.rack.rackConfig?.coolingZone ?? 'Cold Aisle'}`
                          }
                          mono
                        />
                        <SpecCard
                          label="Serial / U-Slot"
                          value={
                            resolved.device
                              ? `U${resolved.device.uStart} (${resolved.device.uHeight}U) · ${resolved.device.serialNumber ?? '—'}`
                              : resolved.rack.serialNumber || '—'
                          }
                          mono
                        />
                      </>
                    )}
                  </div>

                  {/* Upstream Switch Card for Endpoints */}
                  {resolved.kind === 'user-node' && resolved.upstreamRack && (
                    <div className="rounded-xl border border-zinc-800 bg-[#141724] p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Upstream Switch Connection
                        </div>
                        <div className="text-xs font-semibold text-white truncate mt-0.5">
                          {resolved.upstreamRack.assetId} → {resolved.upstreamDevice?.name ?? 'Access Switch'}
                          {resolved.upstreamPort ? ` [${resolved.upstreamPort.label}]` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          resolved.upstreamDevice
                            ? onChangeTarget({
                                kind: 'device',
                                rackId: resolved.upstreamRack!.id,
                                deviceId: resolved.upstreamDevice.id,
                              })
                            : onChangeTarget({ kind: 'rack', rackId: resolved.upstreamRack!.id })
                        }
                        className="px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-[11px] font-semibold hover:bg-cyan-500/25 shrink-0 cursor-pointer"
                      >
                        Inspect Switch
                      </button>
                    </div>
                  )}

                  {/* Predictive Failure Forecast Banner if present */}
                  {assetPrediction && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1">
                          <Wrench className="w-3 h-3" />
                          Predictive Maintenance Forecast
                        </div>
                        <div className="text-xs text-zinc-100 mt-0.5">
                          Predicted service threshold on{' '}
                          <span className="font-mono font-bold text-amber-300">
                            {assetPrediction.predictedFailureDate} ({assetPrediction.daysUntilFailure}d)
                          </span>{' '}
                          · {assetPrediction.driverSensorTag} ({assetPrediction.confidencePct}% confidence)
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          openDashboard({
                            tab: 'predictive',
                            assetId: assetPrediction.assetId,
                            sensorId: assetPrediction.driverSensorId,
                          });
                        }}
                        className="px-2.5 py-1 rounded-lg bg-amber-500 text-zinc-950 text-[11px] font-bold shrink-0 cursor-pointer"
                      >
                        Forecast
                      </button>
                    </div>
                  )}

                  {/* Live Telemetry Sensors */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5 text-emerald-400" />
                        Live Telemetry Sensors ({relatedSensors.length})
                      </span>
                    </div>
                    {relatedSensors.length === 0 ? (
                      <div className="rounded-xl border border-zinc-800/80 bg-[#131622] px-3 py-2.5 text-[11px] text-zinc-500">
                        No dedicated IoT sensors bound directly to this item yet.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {relatedSensors.slice(0, 6).map((s) => {
                          const r = readings[s.id];
                          const val = r ? r.value.toFixed(2) : '—';
                          const tone =
                            r?.status === 'alarm'
                              ? 'border-rose-500/50 text-rose-300'
                              : r?.status === 'warning'
                                ? 'border-amber-500/50 text-amber-300'
                                : 'border-zinc-800 text-emerald-300';
                          return (
                            <div
                              key={s.id}
                              className={`rounded-xl border bg-[#141724] px-3 py-2 flex items-center justify-between gap-2 ${tone}`}
                            >
                              <div className="min-w-0">
                                <div className="font-mono text-[10px] text-zinc-400 truncate">
                                  {s.tag}
                                </div>
                                <div className="text-[11px] text-zinc-200 truncate">{s.name}</div>
                              </div>
                              <div className="font-mono text-sm font-bold tabular-nums shrink-0">
                                {val}{' '}
                                <span className="text-[10px] font-normal text-zinc-400">
                                  {s.unit}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* TAB 2: EQUIPMENT & NODES (Room) OR PORTS & LINKS (Rack/Device/Node) */}
              {tab === 'components' && (
                <div className="space-y-4">
                  {resolved.kind === 'room' ? (
                    <>
                      {/* IT Racks inside Room */}
                      <div className="space-y-1.5">
                        <div className="text-[10.5px] font-bold uppercase tracking-wider text-cyan-400">
                          IT Racks &amp; Cabinets ({resolved.roomRacks.length})
                        </div>
                        {resolved.roomRacks.length === 0 ? (
                          <div className="text-[11px] text-zinc-500">No IT racks installed in this room.</div>
                        ) : (
                          <div className="space-y-1.5">
                            {resolved.roomRacks.map((rk) => (
                              <button
                                key={rk.id}
                                type="button"
                                onClick={() => onChangeTarget({ kind: 'rack', rackId: rk.id })}
                                className="w-full text-left px-3 py-2 rounded-xl border border-zinc-800 bg-[#141724] hover:border-cyan-500/60 flex items-center justify-between gap-2 cursor-pointer"
                              >
                                <div className="min-w-0">
                                  <div className="font-mono text-[11px] font-bold text-cyan-300">
                                    {rk.assetId}{' '}
                                    <span className="font-sans font-semibold text-white">
                                      · {rk.name}
                                    </span>
                                  </div>
                                  <div className="text-[10.5px] text-zinc-400">
                                    {rk.rackConfig?.devices.length ?? 0} devices ·{' '}
                                    {rk.energyKw.toFixed(2)} kW
                                  </div>
                                </div>
                                <span className="text-[10.5px] text-cyan-400 font-semibold shrink-0">
                                  Inspect →
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* IT Endpoints / Drops inside Room */}
                      <div className="space-y-1.5">
                        <div className="text-[10.5px] font-bold uppercase tracking-wider text-emerald-400">
                          Connected IT Endpoints &amp; Wall Drops ({resolved.roomNodes.length})
                        </div>
                        {resolved.roomNodes.length === 0 ? (
                          <div className="text-[11px] text-zinc-500">No IT user drops mapped in this room.</div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {resolved.roomNodes.map((n) => (
                              <button
                                key={n.id}
                                type="button"
                                onClick={() => onChangeTarget({ kind: 'user-node', nodeId: n.id })}
                                className="text-left px-3 py-2 rounded-xl border border-zinc-800 bg-[#141724] hover:border-emerald-500/60 cursor-pointer"
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-mono text-[11px] font-bold text-white truncate">
                                    {n.code}
                                  </span>
                                  <span
                                    className={`text-[9.5px] font-mono uppercase ${
                                      n.status === 'online'
                                        ? 'text-emerald-400'
                                        : n.status === 'degraded'
                                          ? 'text-amber-300'
                                          : 'text-rose-400'
                                    }`}
                                  >
                                    {n.status}
                                  </span>
                                </div>
                                <div className="text-[10.5px] text-zinc-400 truncate">
                                  {n.name} · {n.ipAddress}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* All Process / Facility Equipment inside Room */}
                      <div className="space-y-1.5">
                        <div className="text-[10.5px] font-bold uppercase tracking-wider text-violet-400">
                          Facility Equipment in Room ({resolved.roomAssets.length})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {resolved.roomAssets.map((a) => (
                            <div
                              key={a.id}
                              className="px-3 py-2 rounded-xl border border-zinc-800 bg-[#141724] flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="font-mono text-[11px] font-bold text-zinc-100 truncate">
                                  {a.assetId} · {a.name}
                                </div>
                                <div className="text-[10px] text-zinc-400 truncate">
                                  {a.category} · {a.manufacturer}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setCategoryFilter('all');
                                  setViewMode('3d-perspective');
                                  setScreen('workspace');
                                  closeRackDesigner();
                                  onClose();
                                  setActiveFloor(a.floorId);
                                  selectEntity({ type: 'asset', id: a.id });
                                  drillInto('asset', a.id);
                                }}
                                className="px-2 py-1 rounded-lg bg-violet-600/20 border border-violet-500/40 text-violet-300 text-[10px] font-semibold hover:bg-violet-600 hover:text-white shrink-0 cursor-pointer"
                              >
                                3D
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : isRackTarget ? (
                    <>
                      {/* Mounted Devices in Rack */}
                      {resolved.rack.rackConfig && (
                        <div className="space-y-1.5">
                          <div className="text-[10.5px] font-bold uppercase tracking-wider text-cyan-400">
                            Rack Mounted Devices ({resolved.rack.rackConfig.devices.length})
                          </div>
                          <div className="space-y-1.5">
                            {resolved.rack.rackConfig.devices.map((dev) => {
                              const isCurrent = resolved.device?.id === dev.id;
                              const upPorts = dev.ports.filter((p) => p.status === 'up').length;
                              return (
                                <button
                                  key={dev.id}
                                  type="button"
                                  onClick={() =>
                                    onChangeTarget({
                                      kind: 'device',
                                      rackId: resolved.rack.id,
                                      deviceId: dev.id,
                                    })
                                  }
                                  className={`w-full text-left px-3 py-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer ${
                                    isCurrent
                                      ? 'border-cyan-500 bg-cyan-500/15'
                                      : 'border-zinc-800 bg-[#141724] hover:border-zinc-600'
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-[10px] text-cyan-300">
                                        U{dev.uStart}
                                      </span>
                                      <span className="font-semibold text-white truncate">
                                        {dev.name}
                                      </span>
                                    </div>
                                    <div className="text-[10px] font-mono text-zinc-400 truncate">
                                      {dev.vendor} {dev.model} · {dev.ipAddress} · {upPorts}/{dev.ports.length} ports UP
                                    </div>
                                  </div>
                                  <span
                                    className={`text-[10px] font-mono uppercase shrink-0 ${
                                      dev.status === 'online'
                                        ? 'text-emerald-400'
                                        : dev.status === 'warning'
                                          ? 'text-amber-300'
                                          : 'text-rose-400'
                                    }`}
                                  >
                                    {dev.status}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Live Ports of Focused Device */}
                      {resolved.device && (
                        <div className="space-y-1.5">
                          <div className="text-[10.5px] font-bold uppercase tracking-wider text-violet-400">
                            Ports on {resolved.device.name} ({resolved.device.ports.length})
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {resolved.device.ports.map((p) => {
                              const isSelPort = resolved.port?.id === p.id;
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() =>
                                    onChangeTarget({
                                      kind: 'port',
                                      rackId: resolved.rack.id,
                                      deviceId: resolved.device!.id,
                                      portId: p.id,
                                    })
                                  }
                                  className={`text-left px-2.5 py-2 rounded-xl border font-mono text-[10.5px] cursor-pointer ${
                                    isSelPort
                                      ? 'border-violet-500 bg-violet-500/20'
                                      : 'border-zinc-800 bg-[#141724] hover:border-zinc-600'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-bold text-white">{p.label}</span>
                                    <span
                                      className={
                                        p.status === 'up'
                                          ? 'text-emerald-400'
                                          : p.status === 'error'
                                            ? 'text-rose-400'
                                            : 'text-zinc-500'
                                      }
                                    >
                                      {p.status.toUpperCase()} · {p.speedGbps}G
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                                    {p.vlan}
                                    {p.connectedToLabel ? ` → ${p.connectedToLabel}` : ''}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Inter-Rack Fiber Uplinks */}
                      {resolved.rackLinks.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[10.5px] font-bold uppercase tracking-wider text-amber-400">
                            Inter-Rack Backbone Links ({resolved.rackLinks.length})
                          </div>
                          <div className="space-y-1">
                            {resolved.rackLinks.map((lnk) => (
                              <div
                                key={lnk.id}
                                className="px-3 py-2 rounded-xl border border-zinc-800 bg-[#141724] flex items-center justify-between gap-2 font-mono text-[10.5px]"
                              >
                                <span className="text-zinc-200 truncate">{lnk.label}</span>
                                <span className="text-cyan-300 shrink-0">
                                  {lnk.speedGbps}G · {lnk.media} · {lnk.utilizationPct}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : resolved.kind === 'user-node' ? (
                    <div className="space-y-2">
                      <div className="text-[10.5px] font-bold uppercase tracking-wider text-cyan-400">
                        Endpoint Network Path
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-[#141724] p-3 space-y-1.5 font-mono text-[11px]">
                        <div>
                          Endpoint: <strong className="text-white">{resolved.node.code}</strong> ({resolved.node.ipAddress})
                        </div>
                        <div>
                          Wall Jack: <strong className="text-cyan-300">{resolved.node.wallJackId}</strong> · {resolved.node.media}
                        </div>
                        <div>
                          Upstream Rack:{' '}
                          <strong className="text-violet-300">
                            {resolved.upstreamRack?.assetId ?? resolved.node.connectedRackId}
                          </strong>
                          {resolved.upstreamDevice ? ` / ${resolved.upstreamDevice.name}` : ''}
                          {resolved.upstreamPort ? ` [${resolved.upstreamPort.label}]` : ''}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* TAB 3: HISTORY, GMP COMPLIANCE, WORK ORDERS & FMEA */}
              {tab === 'history' && (
                <div className="space-y-4">
                  {/* GMP Qualification & Calibration Status */}
                  {primaryCompliance && (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-zinc-800 bg-[#141724] p-2.5">
                        <div className="text-[10px] uppercase text-zinc-500">Calibration</div>
                        <div className="text-xs font-bold capitalize text-emerald-400 mt-0.5">
                          {primaryCompliance.calibration.status}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                          Due {primaryCompliance.calibration.nextDueDate}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-[#141724] p-2.5">
                        <div className="text-[10px] uppercase text-zinc-500">Qualification</div>
                        <div className="text-xs font-bold uppercase text-cyan-400 mt-0.5">
                          {primaryCompliance.qualification.stage} · {primaryCompliance.qualification.status}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                          Next {primaryCompliance.qualification.nextDueDate}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-[#141724] p-2.5">
                        <div className="text-[10px] uppercase text-zinc-500">PM Status</div>
                        <div className="text-xs font-bold capitalize text-violet-300 mt-0.5">
                          {primaryCompliance.maintenance.status}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                          Due {primaryCompliance.maintenance.nextDueDate}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Work Orders */}
                  <div className="space-y-1.5">
                    <div className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                      <ClipboardCheck className="w-3.5 h-3.5 text-cyan-400" />
                      Maintenance &amp; Work Orders ({relatedWorkOrders.length})
                    </div>
                    {relatedWorkOrders.length === 0 ? (
                      <div className="rounded-xl border border-zinc-800/80 bg-[#131622] px-3 py-2 text-[11px] text-zinc-500 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        No open maintenance work orders for this item.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {relatedWorkOrders.slice(0, 6).map((wo) => (
                          <div
                            key={wo.id}
                            className="rounded-xl border border-zinc-800 bg-[#141724] px-3 py-2 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-zinc-100 truncate">
                                <span className="font-mono text-cyan-300 mr-1.5">{wo.woNumber}</span>
                                {wo.title}
                              </div>
                              <div className="text-[10px] text-zinc-400">
                                {wo.assigneeName} · Due {wo.dueDate} · Priority {wo.priority}
                              </div>
                            </div>
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono uppercase text-zinc-300 shrink-0">
                              {wo.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* FMEA Risks */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                        FMEA Risks &amp; Incidents ({relatedRisks.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          openRiskModal({
                            mode: 'create',
                            targetKind: resolved.kind === 'room' ? 'room' : 'asset',
                            targetId:
                              resolved.kind === 'room'
                                ? resolved.room.id
                                : primaryAssetId ?? undefined,
                            targetCode: codeBadge,
                            targetName: title,
                          });
                        }}
                        className="text-[10.5px] text-violet-400 hover:text-violet-300 font-semibold cursor-pointer"
                      >
                        Open Risk Center →
                      </button>
                    </div>
                    {relatedRisks.length === 0 ? (
                      <div className="rounded-xl border border-zinc-800/80 bg-[#131622] px-3 py-2 text-[11px] text-zinc-500">
                        No open FMEA risk incidents linked to this entity.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {relatedRisks.slice(0, 5).map((inc) => (
                          <div
                            key={inc.id}
                            className="rounded-xl border border-zinc-800 bg-[#141724] px-3 py-2 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-zinc-100 truncate">
                                <span className="font-mono text-amber-300 mr-1.5">{inc.code}</span>
                                {inc.title}
                              </div>
                              <div className="text-[10px] text-zinc-400 truncate">
                                {inc.failureMode} · Status {inc.status}
                              </div>
                            </div>
                            <span className="font-mono text-[10.5px] font-bold text-rose-300 shrink-0">
                              RPN {inc.rpn}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Lifecycle & Audit Trail History */}
                  <div className="space-y-1.5">
                    <div className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-violet-400" />
                      Lifecycle &amp; Change History
                    </div>
                    {primaryCompliance && primaryCompliance.lifecycleEvents.length > 0 ? (
                      <div className="space-y-1.5">
                        {primaryCompliance.lifecycleEvents.slice(0, 6).map((h) => (
                          <div
                            key={h.id}
                            className="rounded-xl border border-zinc-800 bg-[#141724] px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-zinc-100">{h.title}</span>
                              <span className="font-mono text-[10px] text-zinc-400">{h.date}</span>
                            </div>
                            <p className="text-[10.5px] text-zinc-400 mt-0.5">
                              {h.performedBy} · {h.notes}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : isRackTarget && resolved.rack.vendorHistory && resolved.rack.vendorHistory.length > 0 ? (
                      <div className="space-y-1.5">
                        {resolved.rack.vendorHistory.slice(0, 6).map((vh) => (
                          <div
                            key={vh.id}
                            className="rounded-xl border border-zinc-800 bg-[#141724] px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-zinc-100">{vh.action}</span>
                              <span className="font-mono text-[10px] text-zinc-400">{vh.date}</span>
                            </div>
                            <p className="text-[10.5px] text-zinc-400 mt-0.5">
                              {vh.vendor} · {vh.note}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : relatedAudit.length > 0 ? (
                      <div className="space-y-1.5">
                        {relatedAudit.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-xl border border-zinc-800 bg-[#141724] px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-zinc-100">{entry.action}</span>
                              <span className="font-mono text-[10px] text-zinc-400">
                                {entry.timestamp.slice(0, 16).replace('T', ' ')}
                              </span>
                            </div>
                            <p className="text-[10.5px] text-zinc-400 mt-0.5">
                              {entry.actor} · {entry.summary}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-zinc-800/80 bg-[#131622] px-3 py-2 text-[11px] text-zinc-500">
                        Commissioned in baseline digital twin · All configuration checks passed.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SpecCard: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div className="rounded-xl border border-zinc-800 bg-[#141724] px-2.5 py-2 min-w-0">
    <div className="text-[9.5px] uppercase tracking-wider text-zinc-500 truncate">{label}</div>
    <div
      className={`text-[11px] font-semibold text-zinc-100 truncate mt-0.5 ${
        mono ? 'font-mono tabular-nums' : ''
      }`}
      title={value}
    >
      {value}
    </div>
  </div>
);
