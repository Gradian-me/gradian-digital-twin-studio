import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Cable,
  CheckCircle2,
  Cpu,
  Layers,
  Monitor,
  Plus,
  Search,
  Server,
  Sparkles,
  Zap,
} from 'lucide-react';
import type {
  Building,
  Floor,
  NetworkInterRackLink,
  NetworkUserNode,
  NetworkUserNodeKind,
  RackDesignConfig,
  RackDevice,
  RackPatchCable,
  RackPort,
  Room,
  SpatialAsset,
} from '../types/twin';

export interface ItArchitectureQuickBuilderProps {
  buildings: Building[];
  floors: Floor[];
  rooms: Room[];
  itAssets: SpatialAsset[];
  userNodes: NetworkUserNode[];
  interRackLinks: NetworkInterRackLink[];
  isReadOnly: boolean;
  onAddRack: (
    floorId: string,
    roomId: string | undefined,
    name: string,
    role: 'core-dc' | 'distribution-idf' | 'access-closet'
  ) => SpatialAsset | null;
  onUpdateRackAsset: (rackId: string, patch: Partial<SpatialAsset>) => void;
  onAddUserNode: (node: NetworkUserNode) => void;
  onAddInterRackLink: (link: NetworkInterRackLink) => void;
  onInspectTarget: (
    target:
      | { kind: 'rack'; rackId: string }
      | { kind: 'device'; rackId: string; deviceId: string }
      | { kind: 'user-node'; nodeId: string }
  ) => void;
  onOpenRackPorts: (rackId: string) => void;
  onLocateIn3D: (opts: { rackId?: string; floorId?: string }) => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

type BuilderMode = 'rack' | 'device' | 'endpoints' | 'link';

const HARDWARE_TEMPLATES: {
  id: string;
  label: string;
  vendor: string;
  model: string;
  kind: RackDevice['kind'];
  tier: NonNullable<RackDevice['tier']>;
  uHeight: number;
  powerW: number;
  portCount: number;
  portKind: RackPort['kind'];
  speedGbps: number;
  vlan: string;
}[] = [
  {
    id: 'access-48',
    label: 'Access Switch (48-Port PoE+)',
    vendor: 'Cisco / Aruba',
    model: 'Catalyst 9200L-48P',
    kind: 'switch',
    tier: 'access',
    uHeight: 1,
    powerW: 370,
    portCount: 24,
    portKind: 'RJ45',
    speedGbps: 1,
    vlan: 'VLAN-40-CORP',
  },
  {
    id: 'dist-24',
    label: 'Distribution L3 Switch (24x 10G)',
    vendor: 'Cisco',
    model: 'Catalyst 9300X-24Y',
    kind: 'switch',
    tier: 'distribution',
    uHeight: 1,
    powerW: 410,
    portCount: 16,
    portKind: 'SFP+',
    speedGbps: 10,
    vlan: 'TRUNK-IDF',
  },
  {
    id: 'core-qsfp',
    label: 'Core Fabric Switch (40G/100G)',
    vendor: 'Cisco',
    model: 'Nexus 9336C-FX2',
    kind: 'switch',
    tier: 'core',
    uHeight: 2,
    powerW: 540,
    portCount: 12,
    portKind: 'QSFP28',
    speedGbps: 100,
    vlan: 'VLAN-10-OT',
  },
  {
    id: 'ngfw',
    label: 'Next-Gen OT/IT Firewall',
    vendor: 'Palo Alto',
    model: 'PA-3420 NGFW',
    kind: 'firewall',
    tier: 'security',
    uHeight: 1,
    powerW: 260,
    portCount: 8,
    portKind: 'SFP+',
    speedGbps: 10,
    vlan: 'VLAN-99-DMZ',
  },
  {
    id: 'hypervisor',
    label: '2U Virtualization Host',
    vendor: 'Dell EMC',
    model: 'PowerEdge R760 (Proxmox)',
    kind: 'server',
    tier: 'compute',
    uHeight: 2,
    powerW: 720,
    portCount: 4,
    portKind: 'SFP+',
    speedGbps: 10,
    vlan: 'VLAN-20-SCADA',
  },
  {
    id: 'nas-vault',
    label: '2U NAS / Historian Storage',
    vendor: 'Synology / TrueNAS',
    model: 'RS2423RP+ Vault',
    kind: 'storage',
    tier: 'compute',
    uHeight: 2,
    powerW: 310,
    portCount: 4,
    portKind: 'RJ45',
    speedGbps: 10,
    vlan: 'VLAN-30-EMS',
  },
  {
    id: 'fiber-patch',
    label: '1U Fiber Patch Panel (24-LC)',
    vendor: 'Panduit',
    model: 'Opticom 24-LC',
    kind: 'patch-panel',
    tier: 'distribution',
    uHeight: 1,
    powerW: 0,
    portCount: 12,
    portKind: 'Fiber-LC',
    speedGbps: 40,
    vlan: 'TRUNK-IDF',
  },
  {
    id: 'rack-ups',
    label: '3U Online Rack UPS (6 kVA)',
    vendor: 'APC',
    model: 'Smart-UPS SRT6KRM',
    kind: 'ups',
    tier: 'power',
    uHeight: 3,
    powerW: 240,
    portCount: 2,
    portKind: 'RJ45',
    speedGbps: 1,
    vlan: 'VLAN-99-MGMT',
  },
];

const ENDPOINT_OPTIONS: {
  kind: NetworkUserNodeKind;
  label: string;
  prefix: string;
  vlan: string;
  media: NetworkUserNode['media'];
  poeWatts: number;
}[] = [
  { kind: 'workstation', label: 'Workstation / PC', prefix: 'WS', vlan: 'VLAN-40-CORP', media: 'Cat6A', poeWatts: 0 },
  { kind: 'hmi-panel', label: 'Cleanroom HMI Panel', prefix: 'HMI', vlan: 'VLAN-10-OT', media: 'PoE++ Cat6A', poeWatts: 15.4 },
  { kind: 'hplc-drop', label: 'HPLC / Analytical Instrument', prefix: 'LAB', vlan: 'VLAN-30-QC', media: 'Cat6A', poeWatts: 0 },
  { kind: 'wifi-ap', label: 'Wi-Fi 6E Access Point', prefix: 'AP', vlan: 'VLAN-60-WLAN', media: 'PoE++ Cat6A', poeWatts: 24.5 },
  { kind: 'cctv-cam', label: 'CCTV PoE Camera', prefix: 'CAM', vlan: 'VLAN-50-CCTV', media: 'PoE++ Cat6A', poeWatts: 18.6 },
  { kind: 'badge-reader', label: 'Access Control Reader', prefix: 'ACS', vlan: 'VLAN-55-ACS', media: 'PoE++ Cat6A', poeWatts: 11.8 },
  { kind: 'iot-gateway', label: 'BMS / IoT Telemetry Gateway', prefix: 'IOT', vlan: 'VLAN-20-SCADA', media: 'Cat6A', poeWatts: 12 },
  { kind: 'ip-phone', label: 'VoIP Desk Phone', prefix: 'VOIP', vlan: 'VLAN-45-VOICE', media: 'Cat6A', poeWatts: 7.2 },
];

function findFreeSlotInConfig(cfg: RackDesignConfig, uHeight: number): number {
  const occupied = new Set<number>();
  cfg.devices.forEach((d) => {
    for (let u = d.uStart; u < d.uStart + d.uHeight; u++) occupied.add(u);
  });
  for (let u = cfg.totalUnits - uHeight + 1; u >= 1; u--) {
    let fits = true;
    for (let k = u; k < u + uHeight; k++) {
      if (occupied.has(k)) {
        fits = false;
        break;
      }
    }
    if (fits) return u;
  }
  return 1;
}

function buildPorts(
  prefix: string,
  count: number,
  kind: RackPort['kind'],
  speedGbps: number,
  vlan: string,
  isUplinkDefault: boolean
): RackPort[] {
  const safeCount = Math.max(2, Math.min(48, count));
  return Array.from({ length: safeCount }, (_, idx) => {
    const isUp = isUplinkDefault || idx >= safeCount - 2;
    return {
      id: `p-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
      label: isUp && kind === 'RJ45' ? `Te1/1/${idx + 1}` : `${prefix}${idx + 1}`,
      kind: isUp && kind === 'RJ45' ? 'SFP+' : kind,
      speedGbps: isUp && kind === 'RJ45' ? 10 : speedGbps,
      vlan: isUp ? 'TRUNK-IDF' : vlan,
      status: idx < Math.min(4, safeCount) ? 'up' : 'standby',
      isUplink: isUp,
      utilizationPct: idx < 4 ? 18 + idx * 7 : 0,
      crcErrors: 0,
    };
  });
}

export const ItArchitectureQuickBuilder: React.FC<ItArchitectureQuickBuilderProps> = ({
  buildings,
  floors,
  rooms,
  itAssets,
  userNodes,
  interRackLinks,
  isReadOnly,
  onAddRack,
  onUpdateRackAsset,
  onAddUserNode,
  onAddInterRackLink,
  onInspectTarget,
  onOpenRackPorts,
  onLocateIn3D,
  showToast,
}) => {
  const [builderMode, setBuilderMode] = useState<BuilderMode>('rack');
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryFloorFilter, setInventoryFloorFilter] = useState<string>('all');

  // --- Mode 1: Quick Add Rack ---
  const [rackFloorId, setRackFloorId] = useState(floors[0]?.id ?? '');
  const rackFloorRooms = useMemo(
    () => rooms.filter((r) => r.floorId === rackFloorId),
    [rooms, rackFloorId]
  );
  const [rackRoomId, setRackRoomId] = useState('');
  const [rackName, setRackName] = useState('Floor IDF Distribution Rack');
  const [rackRole, setRackRole] = useState<'core-dc' | 'distribution-idf' | 'access-closet'>('distribution-idf');
  const [rackUnits, setRackUnits] = useState<number>(42);
  const [rackSubnet, setRackSubnet] = useState('10.42.45.0/24');
  const [rackKit, setRackKit] = useState<'default' | 'empty' | 'idf-full' | 'core-stack'>('idf-full');
  const [autoWireCore, setAutoWireCore] = useState(true);

  useEffect(() => {
    if (!rackFloorId && floors[0]) setRackFloorId(floors[0].id);
  }, [floors, rackFloorId]);

  useEffect(() => {
    if (rackFloorRooms.length > 0 && !rackFloorRooms.some((r) => r.id === rackRoomId)) {
      setRackRoomId(rackFloorRooms[0].id);
    }
  }, [rackFloorRooms, rackRoomId]);

  // --- Mode 2: Mount Device ---
  const [devRackId, setDevRackId] = useState(itAssets[0]?.id ?? '');
  const [devTemplateId, setDevTemplateId] = useState(HARDWARE_TEMPLATES[0].id);
  const [devName, setDevName] = useState('SW-ACCESS-NEW');
  const [devVendor, setDevVendor] = useState(HARDWARE_TEMPLATES[0].vendor);
  const [devModel, setDevModel] = useState(HARDWARE_TEMPLATES[0].model);
  const [devIp, setDevIp] = useState('10.42.25.10');
  const [devVlan, setDevVlan] = useState(HARDWARE_TEMPLATES[0].vlan);
  const [devPortCount, setDevPortCount] = useState(HARDWARE_TEMPLATES[0].portCount);
  const [devSpeed, setDevSpeed] = useState(HARDWARE_TEMPLATES[0].speedGbps);
  const [devPowerW, setDevPowerW] = useState(HARDWARE_TEMPLATES[0].powerW);

  useEffect(() => {
    if (!devRackId && itAssets[0]) setDevRackId(itAssets[0].id);
  }, [itAssets, devRackId]);

  const applyTemplate = (tplId: string) => {
    setDevTemplateId(tplId);
    const tpl = HARDWARE_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    setDevVendor(tpl.vendor);
    setDevModel(tpl.model);
    setDevVlan(tpl.vlan);
    setDevPortCount(tpl.portCount);
    setDevSpeed(tpl.speedGbps);
    setDevPowerW(tpl.powerW);
    setDevName(`${tpl.tier.toUpperCase()}-${tpl.kind.toUpperCase()}-${itAssets.length + 1}`);
  };

  // --- Mode 3: Batch Room Endpoints ---
  const [epFloorId, setEpFloorId] = useState(floors[0]?.id ?? '');
  const epFloorRooms = useMemo(
    () => rooms.filter((r) => r.floorId === epFloorId),
    [rooms, epFloorId]
  );
  const [epRoomId, setEpRoomId] = useState('');
  const [epKind, setEpKind] = useState<NetworkUserNodeKind>('workstation');
  const [epCount, setEpCount] = useState<number>(2);
  const [epRackId, setEpRackId] = useState<string>('');
  const [epVlan, setEpVlan] = useState('VLAN-40-CORP');
  const [epSubnetPrefix, setEpSubnetPrefix] = useState('10.42.40');
  const [epMedia, setEpMedia] = useState<NetworkUserNode['media']>('Cat6A');

  useEffect(() => {
    if (!epFloorId && floors[0]) setEpFloorId(floors[0].id);
  }, [floors, epFloorId]);

  useEffect(() => {
    if (epFloorRooms.length > 0 && !epFloorRooms.some((r) => r.id === epRoomId)) {
      setEpRoomId(epFloorRooms[0].id);
    }
  }, [epFloorRooms, epRoomId]);

  useEffect(() => {
    const floorRack =
      itAssets.find((r) => r.floorId === epFloorId && r.rackConfig?.rackRole !== 'core-dc') ??
      itAssets.find((r) => r.floorId === epFloorId) ??
      itAssets[0];
    if (floorRack) setEpRackId(floorRack.id);
  }, [epFloorId, itAssets]);

  // --- Mode 4: Link / Patch Ports ---
  const [linkFromRackId, setLinkFromRackId] = useState(itAssets[0]?.id ?? '');
  const [linkFromDevId, setLinkFromDevId] = useState('');
  const [linkFromPortId, setLinkFromPortId] = useState('');
  const [linkToRackId, setLinkToRackId] = useState(itAssets[1]?.id ?? itAssets[0]?.id ?? '');
  const [linkToDevId, setLinkToDevId] = useState('');
  const [linkToPortId, setLinkToPortId] = useState('');
  const [linkMedia, setLinkMedia] = useState<NetworkInterRackLink['media']>('OM4 Fiber');
  const [linkSpeed, setLinkSpeed] = useState<number>(40);
  const [linkVlanTrunk, setLinkVlanTrunk] = useState('VLAN 10,20,30,40');

  const fromRackObj = itAssets.find((r) => r.id === linkFromRackId);
  const toRackObj = itAssets.find((r) => r.id === linkToRackId);
  const fromDevObj = fromRackObj?.rackConfig?.devices.find((d) => d.id === linkFromDevId) ?? fromRackObj?.rackConfig?.devices[0];
  const toDevObj = toRackObj?.rackConfig?.devices.find((d) => d.id === linkToDevId) ?? toRackObj?.rackConfig?.devices[0];

  useEffect(() => {
    if (fromRackObj?.rackConfig?.devices[0] && !fromRackObj.rackConfig.devices.some((d) => d.id === linkFromDevId)) {
      setLinkFromDevId(fromRackObj.rackConfig.devices[0].id);
    }
  }, [fromRackObj, linkFromDevId]);

  useEffect(() => {
    if (fromDevObj?.ports[0] && !fromDevObj.ports.some((p) => p.id === linkFromPortId)) {
      setLinkFromPortId(fromDevObj.ports[0].id);
    }
  }, [fromDevObj, linkFromPortId]);

  useEffect(() => {
    if (toRackObj?.rackConfig?.devices[0] && !toRackObj.rackConfig.devices.some((d) => d.id === linkToDevId)) {
      setLinkToDevId(toRackObj.rackConfig.devices[0].id);
    }
  }, [toRackObj, linkToDevId]);

  useEffect(() => {
    if (toDevObj?.ports[0] && !toDevObj.ports.some((p) => p.id === linkToPortId)) {
      setLinkToPortId(toDevObj.ports[0].id);
    }
  }, [toDevObj, linkToPortId]);

  // --- Handlers ---
  const handleCreateRack = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    const created = onAddRack(
      rackFloorId || floors[0]?.id,
      rackRoomId || undefined,
      rackName.trim() || 'Distribution IDF Rack',
      rackRole
    );
    if (!created) return;

    const existingCfg = created.rackConfig ?? {
      totalUnits: rackUnits,
      rackRole,
      locationZone: rooms.find((r) => r.id === rackRoomId)?.name ?? 'IT Room',
      maxPowerKw: rackRole === 'core-dc' ? 12 : 6,
      coolingZone: 'Dedicated Cold Aisle',
      subnetCidr: rackSubnet,
      devices: [],
      cables: [],
    };

    const nextDevices = rackKit === 'empty' ? [] : [...existingCfg.devices];
    if (rackKit === 'idf-full' && nextDevices.length < 3) {
      nextDevices.push({
        id: `dev-ups-${Date.now()}`,
        name: `UPS-${created.assetId}`,
        kind: 'ups',
        tier: 'power',
        uStart: 1,
        uHeight: 3,
        powerW: 240,
        ipAddress: rackSubnet.replace('.0/24', '.90'),
        macAddress: '00:C0:B7:99:11:01',
        serialNumber: `UPS-${Date.now().toString().slice(-5)}`,
        vlan: 'VLAN-99-MGMT',
        vendor: 'APC',
        model: 'Smart-UPS SRT6KRM',
        status: 'online',
        cpuPct: 8,
        tempC: 29,
        ports: buildPorts('NMC', 2, 'RJ45', 1, 'VLAN-99-MGMT', false),
      });
    } else if (rackKit === 'core-stack') {
      nextDevices.push({
        id: `dev-fw-${Date.now()}`,
        name: `NGFW-${created.assetId}`,
        kind: 'firewall',
        tier: 'security',
        uStart: Math.max(1, rackUnits - 4),
        uHeight: 1,
        powerW: 260,
        ipAddress: rackSubnet.replace('.0/24', '.254'),
        macAddress: '00:1B:17:44:22:01',
        serialNumber: `PA-${Date.now().toString().slice(-5)}`,
        vlan: 'VLAN-99-DMZ',
        vendor: 'Palo Alto',
        model: 'PA-3420 NGFW',
        status: 'online',
        cpuPct: 16,
        tempC: 34,
        ports: buildPorts('Eth1/', 8, 'SFP+', 10, 'VLAN-99-DMZ', true),
      });
    }

    onUpdateRackAsset(created.id, {
      rackConfig: {
        ...existingCfg,
        totalUnits: rackUnits,
        subnetCidr: rackSubnet,
        devices: nextDevices,
      },
    });

    // Optional auto-wire fiber trunk to Core DC
    const coreRack = itAssets.find((r) => r.rackConfig?.rackRole === 'core-dc' && r.id !== created.id);
    if (autoWireCore && rackRole !== 'core-dc' && coreRack && nextDevices[0] && coreRack.rackConfig?.devices[0]) {
      const fromDev = nextDevices[0];
      const toDev = coreRack.rackConfig.devices[0];
      onAddInterRackLink({
        id: `lnk-${Date.now()}`,
        label: `${created.assetId} ⇄ ${coreRack.assetId} (40G OM4)`,
        tier: rackRole === 'access-closet' ? 'access-to-dist' : 'dist-to-core',
        fromRackId: created.id,
        fromDeviceId: fromDev.id,
        fromPortId: fromDev.ports[0]?.id ?? 'p-up',
        toRackId: coreRack.id,
        toDeviceId: toDev.id,
        toPortId: toDev.ports[0]?.id ?? 'p-core',
        media: 'OM4 Fiber',
        speedGbps: 40,
        vlanTrunk: 'ALL-VLAN-TRUNK',
        status: 'up',
        utilizationPct: 14,
        opticalRxDbm: -2.1,
        crcErrors: 0,
      });
    }

    setDevRackId(created.id);
    onInspectTarget({ kind: 'rack', rackId: created.id });
    showToast(`Created ${created.assetId} (${rackUnits}U) in ${rooms.find((r) => r.id === rackRoomId)?.code ?? 'floor'}`, 'success');
  };

  const handleMountDevice = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    const rack = itAssets.find((r) => r.id === devRackId);
    if (!rack?.rackConfig) {
      showToast('Select a valid rack first.', 'warning');
      return;
    }
    const tpl = HARDWARE_TEMPLATES.find((t) => t.id === devTemplateId) ?? HARDWARE_TEMPLATES[0];
    const uStart = findFreeSlotInConfig(rack.rackConfig, tpl.uHeight);
    const portPrefix = tpl.portKind === 'Fiber-LC' ? 'LC-' : tpl.kind === 'switch' ? 'Gi1/0/' : 'Eth';
    const newDev: RackDevice = {
      id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: devName.trim() || tpl.label,
      kind: tpl.kind,
      tier: tpl.tier,
      uStart,
      uHeight: tpl.uHeight,
      powerW: devPowerW,
      ipAddress: devIp.trim() || '10.42.25.20',
      macAddress: `00:1B:54:${Math.floor(10 + Math.random() * 89)}:${Math.floor(10 + Math.random() * 89)}:01`,
      serialNumber: `SN-${Date.now().toString().slice(-6)}`,
      vlan: devVlan.trim() || tpl.vlan,
      vendor: devVendor.trim() || tpl.vendor,
      model: devModel.trim() || tpl.model,
      status: 'online',
      cpuPct: 14,
      tempC: 33,
      ports: buildPorts(
        portPrefix,
        devPortCount,
        tpl.portKind,
        devSpeed,
        devVlan.trim() || tpl.vlan,
        tpl.tier === 'core' || tpl.tier === 'distribution'
      ),
    };

    onUpdateRackAsset(rack.id, {
      rackConfig: {
        ...rack.rackConfig,
        devices: [...rack.rackConfig.devices, newDev],
      },
    });
    onInspectTarget({ kind: 'device', rackId: rack.id, deviceId: newDev.id });
    showToast(`Mounted ${newDev.name} at U${uStart} in ${rack.assetId} (${newDev.ports.length} ports)`, 'success');
  };

  const handleDeployEndpoints = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    const rm = rooms.find((r) => r.id === epRoomId);
    const fl = floors.find((f) => f.id === epFloorId);
    const rack = itAssets.find((r) => r.id === epRackId) ?? itAssets[0];
    if (!rm || !fl || !rack?.rackConfig) {
      showToast('Select a floor, room, and uplink rack first.', 'warning');
      return;
    }

    const opt = ENDPOINT_OPTIONS.find((o) => o.kind === epKind) ?? ENDPOINT_OPTIONS[0];
    const accessSwitch =
      rack.rackConfig.devices.find((d) => d.tier === 'access') ??
      rack.rackConfig.devices.find((d) => d.kind === 'switch') ??
      rack.rackConfig.devices[0];
    if (!accessSwitch) {
      showToast(`${rack.assetId} has no switch mounted yet. Mount a switch first.`, 'warning');
      return;
    }

    const usedPortIds = new Set(userNodes.map((n) => n.connectedPortId));
    const safeCount = Math.max(1, Math.min(12, epCount));
    const updatedPorts = [...accessSwitch.ports];
    const createdNodes: NetworkUserNode[] = [];
    const existingInRoom = userNodes.filter((n) => n.roomId === rm.id).length;

    const cols = Math.ceil(Math.sqrt(safeCount));
    const rows = Math.ceil(safeCount / cols);

    for (let i = 0; i < safeCount; i++) {
      let port = updatedPorts.find((p) => !p.isUplink && !usedPortIds.has(p.id));
      if (!port) {
        const nextIdx = updatedPorts.length + 1;
        port = {
          id: `p-auto-${Date.now()}-${i}`,
          label: `Gi1/0/${nextIdx}`,
          kind: 'RJ45',
          speedGbps: 1,
          vlan: epVlan,
          status: 'up',
          utilizationPct: 12,
          crcErrors: 0,
        };
        updatedPorts.push(port);
      }
      usedPortIds.add(port.id);

      const seq = existingInRoom + i + 1;
      const code = `${opt.prefix}-${rm.code}-${String(seq).padStart(2, '0')}`;
      const colIdx = i % cols;
      const rowIdx = Math.floor(i / cols);
      const nx = Number((rm.x + ((colIdx + 0.5) / cols) * rm.width).toFixed(2));
      const nz = Number((rm.z + ((rowIdx + 0.5) / rows) * rm.depth).toFixed(2));

      port.status = 'up';
      port.vlan = epVlan;
      port.connectedToLabel = `${code} (${rm.code})`;

      const node: NetworkUserNode = {
        id: `unode-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        name: `${opt.label} #${seq}`,
        code,
        nodeKind: epKind,
        floorId: fl.id,
        roomId: rm.id,
        x: nx,
        z: nz,
        wallJackId: `WJ-${rm.code}-${String(seq).padStart(2, '0')}`,
        ipAddress: `${epSubnetPrefix}.${Math.min(250, 30 + userNodes.length + i)}`,
        macAddress: `3C:22:FB:${String((userNodes.length + i) % 99).padStart(2, '0')}:${String(10 + i * 7).padStart(2, '0')}:A1`,
        vlan: epVlan,
        connectedRackId: rack.id,
        connectedDeviceId: accessSwitch.id,
        connectedPortId: port.id,
        media: epMedia,
        poeWatts: opt.poeWatts,
        status: 'online',
        bandwidthMbps: 42 + i * 18,
        latencyMs: 0.7,
        packetLossPct: 0,
        crcErrors: 0,
        notes: `Batch deployed to ${rm.code} (${rm.name}) via ${accessSwitch.name} [${port.label}]`,
      };
      createdNodes.push(node);
    }

    onUpdateRackAsset(rack.id, {
      rackConfig: {
        ...rack.rackConfig,
        devices: rack.rackConfig.devices.map((d) =>
          d.id === accessSwitch.id ? { ...d, ports: updatedPorts } : d
        ),
      },
    });
    createdNodes.forEach((n) => onAddUserNode(n));
    if (createdNodes[0]) {
      onInspectTarget({ kind: 'user-node', nodeId: createdNodes[0].id });
    }
    showToast(`Deployed & wired ${createdNodes.length} endpoint${createdNodes.length === 1 ? '' : 's'} into ${rm.code}`, 'success');
  };

  const handleCreateLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly || !fromRackObj || !toRackObj || !fromDevObj || !toDevObj) return;
    const pFrom = fromDevObj.ports.find((p) => p.id === linkFromPortId) ?? fromDevObj.ports[0];
    const pTo = toDevObj.ports.find((p) => p.id === linkToPortId) ?? toDevObj.ports[0];
    if (!pFrom || !pTo) {
      showToast('Both devices must have at least one port.', 'warning');
      return;
    }

    if (fromRackObj.id === toRackObj.id && fromRackObj.rackConfig) {
      const cable: RackPatchCable = {
        id: `cab-${Date.now()}`,
        fromDeviceId: fromDevObj.id,
        fromPortId: pFrom.id,
        toDeviceId: toDevObj.id,
        toPortId: pTo.id,
        media: linkMedia === 'OM4 Fiber' || linkMedia === 'OS2 Single-Mode' ? 'OM4 Fiber' : linkMedia === 'DAC Twinax' ? 'DAC Twinax' : 'Cat6A',
        color: linkMedia.includes('Fiber') ? '#06B6D4' : '#3B82F6',
        label: `${fromDevObj.name} [${pFrom.label}] ⇄ ${toDevObj.name} [${pTo.label}] (${linkSpeed}G)`,
        vlan: linkVlanTrunk,
      };
      onUpdateRackAsset(fromRackObj.id, {
        rackConfig: {
          ...fromRackObj.rackConfig,
          cables: [...fromRackObj.rackConfig.cables, cable],
        },
      });
      showToast(`Patched intra-rack cable inside ${fromRackObj.assetId}`, 'success');
    } else {
      const linkTier: NetworkInterRackLink['tier'] =
        fromRackObj.rackConfig?.rackRole === 'core-dc' && toRackObj.rackConfig?.rackRole === 'core-dc'
          ? 'core-to-core'
          : fromRackObj.rackConfig?.rackRole === 'access-closet' || toRackObj.rackConfig?.rackRole === 'access-closet'
            ? 'access-to-dist'
            : 'dist-to-core';
      onAddInterRackLink({
        id: `lnk-${Date.now()}`,
        label: `${fromRackObj.assetId} ⇄ ${toRackObj.assetId} (${linkSpeed}G ${linkMedia})`,
        tier: linkTier,
        fromRackId: fromRackObj.id,
        fromDeviceId: fromDevObj.id,
        fromPortId: pFrom.id,
        toRackId: toRackObj.id,
        toDeviceId: toDevObj.id,
        toPortId: pTo.id,
        media: linkMedia,
        speedGbps: linkSpeed,
        vlanTrunk: linkVlanTrunk,
        status: 'up',
        utilizationPct: 18,
        opticalRxDbm: -2.3,
        crcErrors: 0,
      });
      showToast(`Created ${linkSpeed}G ${linkMedia} trunk: ${fromRackObj.assetId} ⇄ ${toRackObj.assetId}`, 'success');
    }
  };

  // Filtered Room-by-Room Inventory Matrix
  const filteredRooms = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    return rooms.filter((rm) => {
      if (inventoryFloorFilter !== 'all' && rm.floorId !== inventoryFloorFilter) return false;
      if (!q) return true;
      const roomRacks = itAssets.filter((a) => a.roomId === rm.id);
      const roomNodes = userNodes.filter((n) => n.roomId === rm.id);
      return (
        rm.code.toLowerCase().includes(q) ||
        rm.name.toLowerCase().includes(q) ||
        roomRacks.some((r) => r.assetId.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) ||
        roomNodes.some((n) => n.code.toLowerCase().includes(q) || n.name.toLowerCase().includes(q) || n.ipAddress.includes(q))
      );
    });
  }, [rooms, inventoryFloorFilter, inventorySearch, itAssets, userNodes]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0B0C12] text-zinc-100 overflow-hidden">
      {/* Top Quick-Entry Mode Bar */}
      <div className="px-3.5 py-2.5 border-b border-zinc-800 bg-[#10121B] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(
            [
              { id: 'rack', label: '1. Add Rack / Closet', icon: <Server className="w-3.5 h-3.5" /> },
              { id: 'device', label: '2. Mount Switch / Server', icon: <Cpu className="w-3.5 h-3.5" /> },
              { id: 'endpoints', label: '3. Batch Room Drops', icon: <Monitor className="w-3.5 h-3.5" /> },
              { id: 'link', label: '4. Wire Fiber / Patch', icon: <Cable className="w-3.5 h-3.5" /> },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setBuilderMode(m.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                builderMode === m.id
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'bg-[#171A26] text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>
        <div className="text-[11px] font-mono text-zinc-400 tabular-nums hidden sm:flex items-center gap-2">
          <span>{itAssets.length} racks</span>
          <span>·</span>
          <span>{userNodes.length} endpoints</span>
          <span>·</span>
          <span>{interRackLinks.length} trunks</span>
        </div>
      </div>

      {/* Main Split: Fast Entry Form (Left) + Live Room-by-Room IT Inventory (Right) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 overflow-y-auto xl:overflow-hidden">
        {/* Left: Active Quick Entry Form */}
        <div className="xl:col-span-5 border-b xl:border-b-0 xl:border-r border-zinc-800 p-4 overflow-y-auto overscroll-contain space-y-4 bg-[#0D0F17]">
          {isReadOnly && (
            <div className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs">
              Switch to <strong>Design</strong> mode in the header to add racks, devices, room drops, or fiber links.
            </div>
          )}

          {builderMode === 'rack' && (
            <form onSubmit={handleCreateRack} className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Server className="w-4 h-4 text-cyan-400" />
                  Provision Rack or Closet in Any Room
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Places the cabinet inside the selected room with starter switches and optional Core DC fiber uplink.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Floor</span>
                  <select
                    value={rackFloorId}
                    onChange={(e) => setRackFloorId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  >
                    {floors.map((fl) => {
                      const b = buildings.find((x) => x.id === fl.buildingId);
                      return (
                        <option key={fl.id} value={fl.id}>
                          {b ? `${b.code} · ` : ''}{fl.code} — {fl.name}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Target Room</span>
                  <select
                    value={rackRoomId}
                    onChange={(e) => setRackRoomId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  >
                    {rackFloorRooms.map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        {rm.code} · {rm.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Rack / Cabinet Name</span>
                  <input
                    value={rackName}
                    onChange={(e) => setRackName(e.target.value)}
                    placeholder="e.g. Cleanroom West IDF-02"
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Architecture Tier</span>
                  <select
                    value={rackRole}
                    onChange={(e) => setRackRole(e.target.value as any)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  >
                    <option value="core-dc">Core Data Center (MDF)</option>
                    <option value="distribution-idf">Floor Distribution (IDF)</option>
                    <option value="access-closet">Room Access Closet</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Cabinet Height</span>
                  <select
                    value={rackUnits}
                    onChange={(e) => setRackUnits(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                  >
                    <option value={12}>12U Wall Cabinet</option>
                    <option value={24}>24U Half Rack</option>
                    <option value={42}>42U Standard Rack</option>
                    <option value={48}>48U Tall DC Rack</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Subnet CIDR</span>
                  <input
                    value={rackSubnet}
                    onChange={(e) => setRackSubnet(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Starter Equipment Kit</span>
                  <select
                    value={rackKit}
                    onChange={(e) => setRackKit(e.target.value as any)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  >
                    <option value="idf-full">IDF Starter (Switches + UPS)</option>
                    <option value="core-stack">Core Stack (Core Switch + NGFW)</option>
                    <option value="default">Standard Switch Only</option>
                    <option value="empty">Empty Cabinet</option>
                  </select>
                </label>
              </div>

              {rackRole !== 'core-dc' && (
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={autoWireCore}
                    onChange={(e) => setAutoWireCore(e.target.checked)}
                    className="accent-cyan-500 w-4 h-4"
                  />
                  <span>Auto-wire 40G OM4 fiber uplink trunk to Core Data Center</span>
                </label>
              )}

              <button
                type="submit"
                disabled={isReadOnly}
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-45 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Rack &amp; Place in Room
              </button>
            </form>
          )}

          {builderMode === 'device' && (
            <form onSubmit={handleMountDevice} className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-violet-400" />
                  Mount Switch, Firewall, Server, or UPS
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Automatically selects the next free rack U slot and generates ready-to-patch ports.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Target Rack</span>
                  <select
                    value={devRackId}
                    onChange={(e) => setDevRackId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  >
                    {itAssets.map((r) => {
                      const fl = floors.find((f) => f.id === r.floorId);
                      const rm = rooms.find((x) => x.id === r.roomId);
                      return (
                        <option key={r.id} value={r.id}>
                          {r.assetId} · {r.name} ({fl?.code}{rm ? ` / ${rm.code}` : ''})
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Hardware Template</span>
                  <select
                    value={devTemplateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  >
                    {HARDWARE_TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} ({t.uHeight}U · {t.powerW}W)
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Device Hostname / Label</span>
                  <input
                    value={devName}
                    onChange={(e) => setDevName(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Vendor</span>
                  <input
                    value={devVendor}
                    onChange={(e) => setDevVendor(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Model</span>
                  <input
                    value={devModel}
                    onChange={(e) => setDevModel(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Management IP</span>
                  <input
                    value={devIp}
                    onChange={(e) => setDevIp(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Default VLAN</span>
                  <input
                    value={devVlan}
                    onChange={(e) => setDevVlan(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Ports</span>
                  <input
                    type="number"
                    min={2}
                    max={48}
                    value={devPortCount}
                    onChange={(e) => setDevPortCount(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Port Speed (Gbps)</span>
                  <select
                    value={devSpeed}
                    onChange={(e) => setDevSpeed(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                  >
                    <option value={1}>1G</option>
                    <option value={2.5}>2.5G</option>
                    <option value={10}>10G</option>
                    <option value={25}>25G</option>
                    <option value={40}>40G</option>
                    <option value={100}>100G</option>
                  </select>
                </label>
              </div>

              <button
                type="submit"
                disabled={isReadOnly}
                className="w-full py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Auto-Slot &amp; Mount Device
              </button>
            </form>
          )}

          {builderMode === 'endpoints' && (
            <form onSubmit={handleDeployEndpoints} className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-emerald-400" />
                  Batch Deploy Room Equipment &amp; Drops
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Deploy 1 to 12 room endpoints at once with auto-assigned wall jacks, IPs, and switch port bindings.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Floor</span>
                  <select
                    value={epFloorId}
                    onChange={(e) => setEpFloorId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  >
                    {floors.map((fl) => (
                      <option key={fl.id} value={fl.id}>
                        {fl.code} · {fl.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Room</span>
                  <select
                    value={epRoomId}
                    onChange={(e) => setEpRoomId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  >
                    {epFloorRooms.map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        {rm.code} · {rm.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Equipment / Drop Type</span>
                  <select
                    value={epKind}
                    onChange={(e) => {
                      const nextKind = e.target.value as NetworkUserNodeKind;
                      setEpKind(nextKind);
                      const opt = ENDPOINT_OPTIONS.find((o) => o.kind === nextKind);
                      if (opt) {
                        setEpVlan(opt.vlan);
                        setEpMedia(opt.media);
                      }
                    }}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  >
                    {ENDPOINT_OPTIONS.map((o) => (
                      <option key={o.kind} value={o.kind}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Quantity (1–12)</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={epCount}
                    onChange={(e) => setEpCount(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[10.5px] text-zinc-400 font-medium">Upstream Access Rack</span>
                  <select
                    value={epRackId}
                    onChange={(e) => setEpRackId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100"
                  >
                    {itAssets.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.assetId} · {r.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">VLAN</span>
                  <input
                    value={epVlan}
                    onChange={(e) => setEpVlan(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10.5px] text-zinc-400 font-medium">IP Subnet Prefix</span>
                  <input
                    value={epSubnetPrefix}
                    onChange={(e) => setEpSubnetPrefix(e.target.value)}
                    placeholder="10.42.40"
                    className="w-full px-2.5 py-2 rounded-xl bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={isReadOnly}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Zap className="w-4 h-4" />
                Deploy &amp; Auto-Wire {epCount} Endpoint{epCount === 1 ? '' : 's'}
              </button>
            </form>
          )}

          {builderMode === 'link' && (
            <form onSubmit={handleCreateLink} className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Cable className="w-4 h-4 text-amber-400" />
                  Connect Fiber Trunk or Patch Cable
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Automatically creates an inter-rack fiber trunk across different racks, or an intra-rack patch cable within the same rack.
                </p>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="p-2.5 rounded-xl bg-[#121521] border border-zinc-800 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Source Endpoint</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={linkFromRackId}
                      onChange={(e) => setLinkFromRackId(e.target.value)}
                      className="px-2 py-1.5 rounded-lg bg-[#0A0C12] border border-zinc-700 text-zinc-100"
                    >
                      {itAssets.map((r) => (
                        <option key={r.id} value={r.id}>{r.assetId}</option>
                      ))}
                    </select>
                    <select
                      value={fromDevObj?.id ?? ''}
                      onChange={(e) => setLinkFromDevId(e.target.value)}
                      className="px-2 py-1.5 rounded-lg bg-[#0A0C12] border border-zinc-700 text-zinc-100"
                    >
                      {(fromRackObj?.rackConfig?.devices ?? []).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <select
                      value={linkFromPortId}
                      onChange={(e) => setLinkFromPortId(e.target.value)}
                      className="px-2 py-1.5 rounded-lg bg-[#0A0C12] border border-zinc-700 text-zinc-100 font-mono"
                    >
                      {(fromDevObj?.ports ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.label} ({p.speedGbps}G)</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[#121521] border border-zinc-800 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-violet-400">Destination Endpoint</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={linkToRackId}
                      onChange={(e) => setLinkToRackId(e.target.value)}
                      className="px-2 py-1.5 rounded-lg bg-[#0A0C12] border border-zinc-700 text-zinc-100"
                    >
                      {itAssets.map((r) => (
                        <option key={r.id} value={r.id}>{r.assetId}</option>
                      ))}
                    </select>
                    <select
                      value={toDevObj?.id ?? ''}
                      onChange={(e) => setLinkToDevId(e.target.value)}
                      className="px-2 py-1.5 rounded-lg bg-[#0A0C12] border border-zinc-700 text-zinc-100"
                    >
                      {(toRackObj?.rackConfig?.devices ?? []).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <select
                      value={linkToPortId}
                      onChange={(e) => setLinkToPortId(e.target.value)}
                      className="px-2 py-1.5 rounded-lg bg-[#0A0C12] border border-zinc-700 text-zinc-100 font-mono"
                    >
                      {(toDevObj?.ports ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.label} ({p.speedGbps}G)</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] text-zinc-400">Media</span>
                    <select
                      value={linkMedia}
                      onChange={(e) => setLinkMedia(e.target.value as any)}
                      className="w-full px-2 py-1.5 rounded-lg bg-[#151824] border border-zinc-700 text-zinc-100"
                    >
                      <option value="OM4 Fiber">OM4 Fiber</option>
                      <option value="OS2 Single-Mode">OS2 Fiber</option>
                      <option value="DAC Twinax">DAC Twinax</option>
                      <option value="Cat6A">Cat6A</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-zinc-400">Speed</span>
                    <select
                      value={linkSpeed}
                      onChange={(e) => setLinkSpeed(Number(e.target.value))}
                      className="w-full px-2 py-1.5 rounded-lg bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                    >
                      <option value={1}>1G</option>
                      <option value={10}>10G</option>
                      <option value={25}>25G</option>
                      <option value={40}>40G</option>
                      <option value={100}>100G</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-zinc-400">VLANs</span>
                    <input
                      value={linkVlanTrunk}
                      onChange={(e) => setLinkVlanTrunk(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg bg-[#151824] border border-zinc-700 text-zinc-100 font-mono"
                    />
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={isReadOnly}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-45 text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                {linkFromRackId === linkToRackId ? 'Create Intra-Rack Patch Cable' : 'Create Inter-Rack Fiber Trunk'}
              </button>
            </form>
          )}
        </div>

        {/* Right: Live Room-by-Room IT Architecture Inventory Matrix */}
        <div className="xl:col-span-7 flex flex-col min-h-0 overflow-hidden bg-[#090A10]">
          <div className="px-4 py-2.5 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-200">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Facility Room IT Matrix ({filteredRooms.length} rooms)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  placeholder="Filter room, rack, IP..."
                  className="pl-7 pr-2.5 py-1 rounded-lg bg-[#141722] border border-zinc-700 text-[11px] text-zinc-100 w-40 sm:w-48 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <select
                value={inventoryFloorFilter}
                onChange={(e) => setInventoryFloorFilter(e.target.value)}
                className="px-2 py-1 rounded-lg bg-[#141722] border border-zinc-700 text-[11px] text-zinc-200"
              >
                <option value="all">All Floors</option>
                {floors.map((fl) => (
                  <option key={fl.id} value={fl.id}>{fl.code}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3.5 space-y-2.5">
            {filteredRooms.map((rm) => {
              const fl = floors.find((f) => f.id === rm.floorId);
              const rmRacks = itAssets.filter((a) => a.roomId === rm.id);
              const rmNodes = userNodes.filter((n) => n.roomId === rm.id);
              return (
                <div
                  key={rm.id}
                  className="p-3 rounded-xl bg-[#11131D] border border-zinc-800 hover:border-zinc-700 transition-colors space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-cyan-300">{rm.code}</span>
                        <span className="text-xs font-semibold text-white truncate">{rm.name}</span>
                      </div>
                      <div className="text-[10.5px] text-zinc-400 font-mono">
                        {fl?.code} · {rm.environmental?.cleanroomGrade ?? 'Standard'} · {rmRacks.length} rack{rmRacks.length === 1 ? '' : 's'} · {rmNodes.length} drop{rmNodes.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEpFloorId(rm.floorId);
                          setEpRoomId(rm.id);
                          setBuilderMode('endpoints');
                        }}
                        className="px-2 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white text-[10px] font-semibold cursor-pointer transition-colors"
                      >
                        + Drop
                      </button>
                      <button
                        type="button"
                        onClick={() => onLocateIn3D({ floorId: rm.floorId })}
                        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-cyan-600 text-zinc-300 hover:text-white cursor-pointer transition-colors"
                        title="View floor in 3D Digital Twin"
                      >
                        <Box className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {(rmRacks.length > 0 || rmNodes.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-zinc-800/80">
                      {rmRacks.map((rk) => (
                        <button
                          key={rk.id}
                          type="button"
                          onClick={() => onOpenRackPorts(rk.id)}
                          title={`${rk.assetId} · ${rk.name} · ${(rk.rackConfig?.devices ?? []).length} devices · Click to open Racks & Ports`}
                          className="px-2 py-0.5 rounded-lg bg-cyan-950/60 border border-cyan-500/40 hover:border-cyan-300 text-[10px] font-mono text-cyan-200 cursor-pointer"
                        >
                          {rk.assetId} ({(rk.rackConfig?.devices ?? []).length} dev)
                        </button>
                      ))}
                      {rmNodes.map((nd) => (
                        <button
                          key={nd.id}
                          type="button"
                          onClick={() => onInspectTarget({ kind: 'user-node', nodeId: nd.id })}
                          title={`${nd.code} · ${nd.name} · ${nd.ipAddress} · ${nd.vlan} · ${nd.wallJackId}`}
                          className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono cursor-pointer ${
                            nd.status === 'error'
                              ? 'bg-rose-950/50 border-rose-500/60 text-rose-300'
                              : 'bg-zinc-900 border-zinc-700 hover:border-violet-400 text-zinc-200'
                          }`}
                        >
                          {nd.code} · {nd.ipAddress}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
