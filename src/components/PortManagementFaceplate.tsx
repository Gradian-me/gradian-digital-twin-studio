import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Cable,
  CheckCircle2,
  Cpu,
  Link2,
  Plus,
  Route,
  Sliders,
  Trash2,
  Unlink,
  Zap,
} from 'lucide-react';
import type {
  Building,
  Floor,
  NetworkInterRackLink,
  NetworkUserNode,
  RackDevice,
  RackPatchCable,
  RackPort,
  SpatialAsset,
} from '../types/twin';
import {
  estimateInterRackCableMetrics,
  estimateIntraRackCableMetrics,
  estimatePreviewConnectionMetrics,
  estimateUserDropMetrics,
  type PhysicalCableMetrics,
} from '../utils/networkLatency';

interface PortManagementFaceplateProps {
  activeRack: SpatialAsset;
  device: RackDevice;
  allRacks: SpatialAsset[];
  userNodes: NetworkUserNode[];
  interRackLinks: NetworkInterRackLink[];
  floors: Floor[];
  buildings: Building[];
  selectedPortId: string | null;
  blinkTick: number;
  isReadOnly: boolean;
  onSelectPort: (portId: string) => void;
  onUpdateDevicePorts: (nextPorts: RackPort[]) => void;
  onCreateIntraRackPatch: (params: {
    fromDeviceId: string;
    fromPortId: string;
    toDeviceId: string;
    toPortId: string;
    media: RackPatchCable['media'];
    vlan: string;
  }) => void;
  onCreateInterRackTrunk: (params: {
    fromRackId: string;
    fromDeviceId: string;
    fromPortId: string;
    toRackId: string;
    toDeviceId: string;
    toPortId: string;
    media: NetworkInterRackLink['media'];
    speedGbps: number;
    vlanTrunk: string;
  }) => void;
  onAssignUserNodeToPort: (params: {
    nodeId: string;
    rackId: string;
    deviceId: string;
    portId: string;
    portLabel: string;
  }) => void;
  onDisconnectPort: (portId: string) => void;
  onTracePort?: (portId: string) => void;
}

type PortFilter = 'all' | 'up' | 'fault' | 'poe' | 'uplink' | 'free';

const VLAN_OPTIONS = [
  'VLAN-10-OT',
  'VLAN-20-SCADA',
  'VLAN-30-EMS',
  'VLAN-31-LAB',
  'VLAN-11-QA',
  'VLAN-50-WIFI',
  'VLAN-70-ACS',
  'VLAN-99-UPLINK',
  'VLAN-MGMT',
  'VLAN-DMZ',
];

function getVlanAccent(vlan: string): string {
  const v = vlan.toUpperCase();
  if (v.includes('99') || v.includes('UPLINK') || v.includes('TRUNK')) return '#38BDF8';
  if (v.includes('20') || v.includes('SCADA')) return '#A855F7';
  if (v.includes('30') || v.includes('EMS')) return '#06B6D4';
  if (v.includes('31') || v.includes('LAB')) return '#3B82F6';
  if (v.includes('50') || v.includes('WIFI')) return '#F59E0B';
  if (v.includes('70') || v.includes('ACS') || v.includes('CCTV')) return '#EC4899';
  if (v.includes('DMZ') || v.includes('MGMT')) return '#F97316';
  return '#10B981';
}

export const PortManagementFaceplate: React.FC<PortManagementFaceplateProps> = ({
  activeRack,
  device,
  allRacks,
  userNodes,
  interRackLinks,
  floors,
  buildings,
  selectedPortId,
  blinkTick,
  isReadOnly,
  onSelectPort,
  onUpdateDevicePorts,
  onCreateIntraRackPatch,
  onCreateInterRackTrunk,
  onAssignUserNodeToPort,
  onDisconnectPort,
  onTracePort,
}) => {
  const [filter, setFilter] = useState<PortFilter>('all');
  const [showPatchWizard, setShowPatchWizard] = useState(false);
  const [patchTargetMode, setPatchTargetMode] = useState<'same-rack' | 'cross-rack' | 'user-node'>('same-rack');
  const [targetRackId, setTargetRackId] = useState<string>(() => {
    const other = allRacks.find((r) => r.id !== activeRack.id);
    return other?.id ?? activeRack.id;
  });
  const [targetDeviceId, setTargetDeviceId] = useState<string>('');
  const [targetPortId, setTargetPortId] = useState<string>('');
  const [targetNodeId, setTargetNodeId] = useState<string>(userNodes[0]?.id ?? '');
  const [patchMedia, setPatchMedia] = useState<'Cat6A' | 'OM4 Fiber' | 'OS2 Single-Mode' | 'DAC Twinax'>('OM4 Fiber');

  // Map every port on this device to its physical cable connection & latency metrics
  const portLinkInfo = useMemo(() => {
    const map = new Map<
      string,
      {
        kind: 'intra-rack' | 'inter-rack' | 'user-node';
        peerLabel: string;
        media: string;
        metrics: PhysicalCableMetrics;
      }
    >();

    const intraCables = activeRack.rackConfig?.cables ?? [];
    intraCables.forEach((cab) => {
      if (cab.fromDeviceId === device.id) {
        const peerDev = activeRack.rackConfig?.devices.find((d) => d.id === cab.toDeviceId);
        const peerPort = peerDev?.ports.find((p) => p.id === cab.toPortId);
        map.set(cab.fromPortId, {
          kind: 'intra-rack',
          peerLabel: `${peerDev?.name ?? cab.toDeviceId} [${peerPort?.label ?? '?'}]`,
          media: cab.media,
          metrics: estimateIntraRackCableMetrics(activeRack, cab),
        });
      } else if (cab.toDeviceId === device.id) {
        const peerDev = activeRack.rackConfig?.devices.find((d) => d.id === cab.fromDeviceId);
        const peerPort = peerDev?.ports.find((p) => p.id === cab.fromPortId);
        map.set(cab.toPortId, {
          kind: 'intra-rack',
          peerLabel: `${peerDev?.name ?? cab.fromDeviceId} [${peerPort?.label ?? '?'}]`,
          media: cab.media,
          metrics: estimateIntraRackCableMetrics(activeRack, cab),
        });
      }
    });

    interRackLinks.forEach((lnk) => {
      if (lnk.fromDeviceId === device.id || lnk.toDeviceId === device.id) {
        const isFrom = lnk.fromDeviceId === device.id;
        const portId = isFrom ? lnk.fromPortId : lnk.toPortId;
        const peerRack = allRacks.find((r) => r.id === (isFrom ? lnk.toRackId : lnk.fromRackId));
        const peerDev = peerRack?.rackConfig?.devices.find(
          (d) => d.id === (isFrom ? lnk.toDeviceId : lnk.fromDeviceId)
        );
        const peerPort = peerDev?.ports.find(
          (p) => p.id === (isFrom ? lnk.toPortId : lnk.fromPortId)
        );
        map.set(portId, {
          kind: 'inter-rack',
          peerLabel: `${peerRack?.assetId ?? 'Rack'} · ${peerDev?.name ?? 'Switch'} [${peerPort?.label ?? 'Trunk'}]`,
          media: lnk.media,
          metrics: estimateInterRackCableMetrics(lnk, allRacks, floors, buildings),
        });
      }
    });

    userNodes.forEach((un) => {
      if (un.connectedDeviceId === device.id) {
        map.set(un.connectedPortId, {
          kind: 'user-node',
          peerLabel: `${un.code} (${un.wallJackId}) · ${un.name}`,
          media: un.media,
          metrics: estimateUserDropMetrics(un, allRacks, floors, buildings),
        });
      }
    });

    return map;
  }, [activeRack, device.id, interRackLinks, userNodes, allRacks, floors, buildings]);

  const activePort = useMemo(() => {
    if (selectedPortId) {
      const found = device.ports.find((p) => p.id === selectedPortId);
      if (found) return found;
    }
    return device.ports[0] ?? null;
  }, [device.ports, selectedPortId]);

  const copperPorts = useMemo(
    () => device.ports.filter((p) => p.kind === 'RJ45' || p.kind === 'Console' || p.kind === 'Power-C13'),
    [device.ports]
  );
  const opticalPorts = useMemo(
    () => device.ports.filter((p) => p.kind === 'SFP+' || p.kind === 'QSFP28' || p.kind === 'Fiber-LC'),
    [device.ports]
  );

  const matchesFilter = (p: RackPort): boolean => {
    const linked = portLinkInfo.has(p.id) || Boolean(p.connectedToLabel);
    if (filter === 'up') return p.status === 'up';
    if (filter === 'fault') return p.status === 'error' || p.status === 'down' || (p.crcErrors ?? 0) > 0;
    if (filter === 'poe') return (p.poeWatts ?? 0) > 0;
    if (filter === 'uplink') return Boolean(p.isUplink || p.kind === 'SFP+' || p.kind === 'QSFP28' || p.kind === 'Fiber-LC');
    if (filter === 'free') return !linked && p.status !== 'error';
    return true;
  };

  // Stats summary
  const stats = useMemo(() => {
    const up = device.ports.filter((p) => p.status === 'up').length;
    const fault = device.ports.filter((p) => p.status === 'error' || p.status === 'down' || (p.crcErrors ?? 0) > 0).length;
    const totalPoeW = device.ports.reduce((s, p) => s + (p.poeWatts ?? 0), 0);
    const totalBandwidthGbps = device.ports.reduce((s, p) => s + (p.status === 'up' ? p.speedGbps : 0), 0);
    return { up, fault, totalPoeW, totalBandwidthGbps };
  }, [device.ports]);

  const updateActivePort = (patch: Partial<RackPort>) => {
    if (!activePort || isReadOnly) return;
    onUpdateDevicePorts(device.ports.map((p) => (p.id === activePort.id ? { ...p, ...patch } : p)));
  };

  const handleAddPortBank = (kind: 'RJ45' | 'SFP+' | 'QSFP28', count: number) => {
    if (isReadOnly) return;
    const existingCount = device.ports.filter((p) => p.kind === kind).length;
    const prefix = kind === 'RJ45' ? 'Gi1/0/' : kind === 'QSFP28' ? 'Hu1/1/' : 'Te1/1/';
    const speedGbps = kind === 'RJ45' ? 1 : kind === 'QSFP28' ? 100 : 10;
    const created: RackPort[] = Array.from({ length: count }, (_, idx) => ({
      id: `p-${device.id}-${Date.now()}-${idx}`,
      label: `${prefix}${existingCount + idx + 1}`,
      kind,
      speedGbps,
      vlan: kind === 'RJ45' ? device.vlan || 'VLAN-10-OT' : 'VLAN-99-UPLINK',
      status: 'standby',
      isUplink: kind !== 'RJ45',
      poeWatts: 0,
      utilizationPct: 0,
      crcErrors: 0,
      opticalDbm: kind !== 'RJ45' ? -2.4 : undefined,
    }));
    onUpdateDevicePorts([...device.ports, ...created]);
    onSelectPort(created[0].id);
  };

  const handleDeleteActivePort = () => {
    if (!activePort || isReadOnly || device.ports.length <= 1) return;
    const remaining = device.ports.filter((p) => p.id !== activePort.id);
    onUpdateDevicePorts(remaining);
    if (remaining[0]) onSelectPort(remaining[0].id);
  };

  // Destination selectors for Patch Wizard
  const destRack = useMemo(
    () =>
      patchTargetMode === 'same-rack'
        ? activeRack
        : allRacks.find((r) => r.id === targetRackId) ?? allRacks.find((r) => r.id !== activeRack.id) ?? activeRack,
    [patchTargetMode, activeRack, allRacks, targetRackId]
  );

  const destDevices = useMemo(
    () =>
      (destRack?.rackConfig?.devices ?? []).filter((d) =>
        patchTargetMode === 'same-rack' ? d.id !== device.id : true
      ),
    [destRack, patchTargetMode, device.id]
  );

  const destDeviceObj = useMemo(
    () => destDevices.find((d) => d.id === targetDeviceId) ?? destDevices[0] ?? null,
    [destDevices, targetDeviceId]
  );

  const destPortObj = useMemo(
    () => destDeviceObj?.ports.find((p) => p.id === targetPortId) ?? destDeviceObj?.ports[0] ?? null,
    [destDeviceObj, targetPortId]
  );

  const destUserNodeObj = useMemo(
    () => userNodes.find((n) => n.id === targetNodeId) ?? userNodes[0] ?? null,
    [userNodes, targetNodeId]
  );

  // Live preview of physical cable length & latency BEFORE user clicks Patch!
  const previewMetrics = useMemo(() => {
    if (!activePort) return null;
    return estimatePreviewConnectionMetrics({
      fromRack: activeRack,
      fromDevice: device,
      fromPort: activePort,
      toRack: patchTargetMode === 'user-node' ? undefined : destRack,
      toDevice: patchTargetMode === 'user-node' ? undefined : destDeviceObj ?? undefined,
      toPort: patchTargetMode === 'user-node' ? undefined : destPortObj ?? undefined,
      toUserNode: patchTargetMode === 'user-node' ? destUserNodeObj ?? undefined : undefined,
      media: patchMedia,
      floors,
      buildings,
    });
  }, [
    activePort,
    activeRack,
    device,
    patchTargetMode,
    destRack,
    destDeviceObj,
    destPortObj,
    destUserNodeObj,
    patchMedia,
    floors,
    buildings,
  ]);

  const handleCommitPatch = () => {
    if (!activePort || isReadOnly) return;
    if (patchTargetMode === 'same-rack' && destDeviceObj && destPortObj) {
      onCreateIntraRackPatch({
        fromDeviceId: device.id,
        fromPortId: activePort.id,
        toDeviceId: destDeviceObj.id,
        toPortId: destPortObj.id,
        media: patchMedia,
        vlan: activePort.vlan,
      });
      setShowPatchWizard(false);
    } else if (patchTargetMode === 'cross-rack' && destRack && destDeviceObj && destPortObj) {
      onCreateInterRackTrunk({
        fromRackId: activeRack.id,
        fromDeviceId: device.id,
        fromPortId: activePort.id,
        toRackId: destRack.id,
        toDeviceId: destDeviceObj.id,
        toPortId: destPortObj.id,
        media: patchMedia,
        speedGbps: Math.min(activePort.speedGbps, destPortObj.speedGbps) || 10,
        vlanTrunk: activePort.vlan,
      });
      setShowPatchWizard(false);
    } else if (patchTargetMode === 'user-node' && destUserNodeObj) {
      onAssignUserNodeToPort({
        nodeId: destUserNodeObj.id,
        rackId: activeRack.id,
        deviceId: device.id,
        portId: activePort.id,
        portLabel: activePort.label,
      });
      setShowPatchWizard(false);
    }
  };

  const activePortLink = activePort ? portLinkInfo.get(activePort.id) : undefined;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-[#0D1018] overflow-hidden shadow-xl">
      {/* Hardware Chassis Top Strip */}
      <div className="px-3.5 py-2.5 bg-gradient-to-r from-[#141826] via-[#111521] to-[#141826] border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#0A0D15] border border-cyan-500/40 flex items-center justify-center shrink-0">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-zinc-100 truncate flex items-center gap-1.5">
              <span>{device.name}</span>
              <span className="text-[10px] font-mono text-zinc-400 font-normal">
                · U{device.uStart} · {device.vendor} {device.model}
              </span>
            </div>
            <div className="text-[10px] font-mono tabular-nums text-zinc-400 flex items-center gap-2">
              <span className="text-amber-400">{device.ipAddress}</span>
              <span>·</span>
              <span className="text-emerald-400">{stats.up}/{device.ports.length} UP</span>
              <span>·</span>
              <span className="text-cyan-300">{stats.totalBandwidthGbps}G Agg</span>
              {stats.totalPoeW > 0 && (
                <>
                  <span>·</span>
                  <span className="text-amber-300">{stats.totalPoeW}W PoE</span>
                </>
              )}
              {stats.fault > 0 && (
                <>
                  <span>·</span>
                  <span className="text-rose-400 font-bold">{stats.fault} FAULT</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Port Filter & Bank Provisioning */}
        <div className="flex items-center gap-1 flex-wrap">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'up', label: 'Up' },
              { id: 'fault', label: 'Fault' },
              { id: 'poe', label: 'PoE' },
              { id: 'uplink', label: 'Fiber' },
              { id: 'free', label: 'Free' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                filter === f.id
                  ? 'bg-cyan-500 text-zinc-950'
                  : 'bg-[#171C2B] text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {f.label}
            </button>
          ))}
          {!isReadOnly && (
            <div className="flex items-center gap-1 ml-1 pl-1.5 border-l border-zinc-800">
              <button
                type="button"
                onClick={() => handleAddPortBank('RJ45', 4)}
                className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-[#182032] hover:bg-emerald-600/30 border border-zinc-700 hover:border-emerald-500/60 text-[10px] font-mono text-emerald-300 cursor-pointer"
                title="Add 4-port 1G RJ45 copper bank"
              >
                <Plus className="w-2.5 h-2.5" /> 4×RJ45
              </button>
              <button
                type="button"
                onClick={() => handleAddPortBank('SFP+', 2)}
                className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-[#1C1630] hover:bg-violet-600/30 border border-zinc-700 hover:border-violet-500/60 text-[10px] font-mono text-violet-300 cursor-pointer"
                title="Add 2-port 10G SFP+ fiber cage module"
              >
                <Plus className="w-2.5 h-2.5" /> 2×SFP+
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ==================== REALISTIC HARDWARE FRONT FACEPLATE GRAPHIC ==================== */}
      <div className="p-3 bg-[#090B11]">
        <div className="relative rounded-xl border-2 border-zinc-700/80 bg-gradient-to-b from-[#1B1F2E] via-[#131724] to-[#0E111B] p-2.5 shadow-inner flex items-stretch gap-2.5 overflow-x-auto">
          {/* Left Rack Mounting Ear */}
          <div className="w-3 shrink-0 rounded bg-[#0A0C12] border border-zinc-800 flex flex-col items-center justify-around py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 border border-zinc-600" />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 border border-zinc-600" />
          </div>

          {/* Status LED Column (PWR / SYS / ALM) */}
          <div className="w-11 shrink-0 rounded-lg bg-[#0B0E17] border border-zinc-800/90 p-1.5 flex flex-col justify-between text-[8px] font-mono text-zinc-500">
            <div className="flex items-center justify-between">
              <span>PWR</span>
              <span className={`w-1.5 h-1.5 rounded-full ${device.status === 'offline' ? 'bg-rose-500' : 'bg-emerald-400 shadow-[0_0_5px_#34d399]'}`} />
            </div>
            <div className="flex items-center justify-between">
              <span>SYS</span>
              <span className={`w-1.5 h-1.5 rounded-full ${device.status === 'online' ? 'bg-cyan-400' : 'bg-amber-400'}`} />
            </div>
            <div className="flex items-center justify-between">
              <span>ALM</span>
              <span className={`w-1.5 h-1.5 rounded-full ${stats.fault > 0 ? 'bg-rose-500 shadow-[0_0_6px_#f43f5e]' : 'bg-zinc-800'}`} />
            </div>
            <div className="text-[7.5px] text-zinc-600 text-center border-t border-zinc-800 pt-1">
              {activeRack.assetId}
            </div>
          </div>

          {/* Copper RJ45 Socket Bank (Graphical Metallic Sockets with Pin Teeth & Dual LEDs) */}
          {copperPorts.length > 0 && (
            <div className="flex flex-col gap-1 shrink-0">
              <div className="text-[8.5px] font-mono uppercase tracking-wider text-zinc-500 flex items-center justify-between px-0.5">
                <span>RJ45 Copper / PoE Matrix ({copperPorts.length})</span>
                <span className="text-zinc-600">1G / 2.5G / 10GBASE-T</span>
              </div>
              <div className="grid grid-flow-col grid-rows-2 gap-1.5 p-1.5 rounded-lg bg-[#090C13] border border-zinc-800">
                {copperPorts.map((p, idx) => {
                  const visible = matchesFilter(p);
                  const isSel = activePort?.id === p.id;
                  const link = portLinkInfo.get(p.id);
                  const vlanColor = getVlanAccent(p.vlan);
                  const isErr = p.status === 'error' || (p.crcErrors ?? 0) > 0;
                  const isUp = p.status === 'up' && device.status !== 'offline';
                  const actBlink = isUp && (blinkTick + idx) % 2 === 0;
                  const util = Math.min(100, Math.max(0, p.utilizationPct ?? (isUp ? 22 : 0)));

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectPort(p.id)}
                      title={`${p.label} · ${p.speedGbps}G ${p.kind} · ${p.vlan} · ${p.status.toUpperCase()}${
                        link ? `\nLinked → ${link.peerLabel} (${link.metrics.distanceMeters}m · ${link.metrics.shortLatencyLabel})` : '\nUnpatched'
                      }`}
                      style={{
                        borderColor: isSel
                          ? '#F59E0B'
                          : isErr
                            ? '#EF4444'
                            : isUp
                              ? `${vlanColor}AA`
                              : '#272C3D',
                      }}
                      className={`relative w-[44px] h-[38px] rounded-[5px] border bg-[#0E1320] p-1 flex flex-col justify-between transition-all cursor-pointer ${
                        visible ? 'opacity-100' : 'opacity-25'
                      } ${isSel ? 'ring-2 ring-amber-400/70 scale-105 z-10' : 'hover:scale-105'}`}
                    >
                      {/* Top LED Pair (Link LED + Activity/PoE LED) */}
                      <div className="flex items-center justify-between w-full px-0.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor: isErr
                              ? '#F43F5E'
                              : isUp
                                ? '#10B981'
                                : p.status === 'standby'
                                  ? '#475569'
                                  : '#27272A',
                            boxShadow: isUp ? '0 0 5px #10B981' : isErr ? '0 0 5px #F43F5E' : undefined,
                          }}
                        />
                        <span className="text-[7px] font-mono font-bold text-zinc-400 truncate max-w-[20px]">
                          {p.label.split('/').pop()}
                        </span>
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              (p.poeWatts ?? 0) > 0
                                ? '#F59E0B'
                                : actBlink
                                  ? vlanColor
                                  : '#1E293B',
                          }}
                        />
                      </div>

                      {/* Recessed RJ45 Socket Cavity + 8 Gold Pins SVG */}
                      <svg viewBox="0 0 32 14" className="w-full h-[13px]">
                        <rect
                          x="2"
                          y="1"
                          width="28"
                          height="12"
                          rx="1.5"
                          fill="#05070C"
                          stroke={link ? vlanColor : '#334155'}
                          strokeWidth="1"
                        />
                        {/* Clip notch */}
                        <rect x="11" y="1" width="10" height="3" fill="#0B101C" />
                        {/* 8 Gold Contact Pins */}
                        {[6, 9, 12, 15, 18, 21, 24, 26].map((px) => (
                          <line
                            key={px}
                            x1={px}
                            y1="8"
                            x2={px}
                            y2="12"
                            stroke={isUp ? '#FBBF24' : '#52525B'}
                            strokeWidth="1"
                          />
                        ))}
                      </svg>

                      {/* Utilization Micro-Bar */}
                      <div className="w-full h-[2.5px] rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${util}%`,
                            backgroundColor: isErr ? '#F43F5E' : vlanColor,
                          }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optical SFP+ / QSFP28 High-Speed Uplink Cages */}
          {opticalPorts.length > 0 && (
            <div className="flex flex-col gap-1 shrink-0 pl-2 border-l border-zinc-800/90">
              <div className="text-[8.5px] font-mono uppercase tracking-wider text-cyan-400/90 flex items-center justify-between px-0.5">
                <span>SFP+ / QSFP28 Optical ({opticalPorts.length})</span>
              </div>
              <div className="grid grid-flow-col grid-rows-2 gap-1.5 p-1.5 rounded-lg bg-[#0A0D18] border border-cyan-900/40">
                {opticalPorts.map((p, idx) => {
                  const visible = matchesFilter(p);
                  const isSel = activePort?.id === p.id;
                  const link = portLinkInfo.get(p.id);
                  const isQsfp = p.kind === 'QSFP28' || p.speedGbps >= 40;
                  const cageColor = isQsfp ? '#EC4899' : '#38BDF8';
                  const isErr = p.status === 'error' || (p.crcErrors ?? 0) > 0;
                  const isUp = p.status === 'up' && device.status !== 'offline';
                  const actBlink = isUp && (blinkTick + idx) % 2 === 0;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectPort(p.id)}
                      title={`${p.label} · ${p.speedGbps}G ${p.kind} · Rx ${p.opticalDbm ?? -2.4} dBm${
                        link ? `\nTrunk → ${link.peerLabel} (${link.metrics.distanceMeters}m · ${link.metrics.shortLatencyLabel})` : '\nOpen SFP Cage'
                      }`}
                      style={{
                        borderColor: isSel
                          ? '#F59E0B'
                          : isErr
                            ? '#EF4444'
                            : isUp
                              ? cageColor
                              : '#334155',
                      }}
                      className={`w-[54px] h-[38px] rounded-[5px] border bg-[#101528] p-1 flex flex-col justify-between transition-all cursor-pointer ${
                        visible ? 'opacity-100' : 'opacity-25'
                      } ${isSel ? 'ring-2 ring-amber-400/70 scale-105 z-10' : 'hover:scale-105'}`}
                    >
                      <div className="flex items-center justify-between w-full px-0.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor: isErr ? '#F43F5E' : isUp ? cageColor : '#334155',
                            boxShadow: isUp ? `0 0 6px ${cageColor}` : undefined,
                          }}
                        />
                        <span className="text-[7.5px] font-mono font-bold text-cyan-200 tabular-nums">
                          {p.speedGbps}G
                        </span>
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: actBlink ? '#34D399' : '#1E293B' }}
                        />
                      </div>

                      {/* Dual-LC Optical Transceiver Graphic */}
                      <svg viewBox="0 0 42 14" className="w-full h-[13px]">
                        <rect
                          x="1.5"
                          y="1"
                          width="39"
                          height="12"
                          rx="1.5"
                          fill="#050811"
                          stroke={isUp ? cageColor : '#475569'}
                          strokeWidth="1"
                        />
                        {/* Twin LC Ferrule Openings */}
                        <rect x="6" y="3.5" width="12" height="7" rx="1" fill="#0F172A" stroke={isUp ? '#22D3EE' : '#334155'} strokeWidth="0.8" />
                        <rect x="24" y="3.5" width="12" height="7" rx="1" fill="#0F172A" stroke={isUp ? '#22D3EE' : '#334155'} strokeWidth="0.8" />
                        <circle cx="12" cy="7" r="1.7" fill={isUp ? cageColor : '#1E293B'} />
                        <circle cx="30" cy="7" r="1.7" fill={isUp ? '#34D399' : '#1E293B'} />
                      </svg>

                      <div className="text-[7px] font-mono text-zinc-400 truncate w-full text-center leading-none">
                        {p.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Right Rack Mounting Ear */}
          <div className="w-3 shrink-0 ml-auto rounded bg-[#0A0C12] border border-zinc-800 flex flex-col items-center justify-around py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 border border-zinc-600" />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 border border-zinc-600" />
          </div>
        </div>
      </div>

      {/* ==================== SELECTED PORT MANAGEMENT & LATENCY CONSOLE ==================== */}
      {activePort && (
        <div className="px-3.5 py-3 border-t border-zinc-800/90 bg-[#10131E] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Sliders className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="text-xs font-mono font-bold text-white">{activePort.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase ${
                  activePort.status === 'up'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : activePort.status === 'error'
                      ? 'bg-rose-500/25 text-rose-300'
                      : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {activePort.status}
              </span>
              <span className="text-[10.5px] font-mono text-zinc-400">
                {activePort.kind} · {activePort.speedGbps}G · {activePort.vlan}
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {onTracePort && (
                <button
                  type="button"
                  onClick={() => onTracePort(activePort.id)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-cyan-300 text-[10.5px] font-semibold cursor-pointer"
                >
                  <Route className="w-3 h-3" /> Trace Path
                </button>
              )}
              {!isReadOnly && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowPatchWizard((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-semibold transition-colors cursor-pointer ${
                      showPatchWizard
                        ? 'bg-amber-500 text-zinc-950'
                        : 'bg-violet-600 hover:bg-violet-500 text-white'
                    }`}
                  >
                    <Link2 className="w-3 h-3" /> {activePortLink ? 'Re-Patch Port' : 'Patch Port →'}
                  </button>
                  {activePortLink && (
                    <button
                      type="button"
                      onClick={() => onDisconnectPort(activePort.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-rose-950 border border-zinc-700 hover:border-rose-500/60 text-zinc-300 hover:text-rose-300 text-[10.5px] font-semibold cursor-pointer"
                      title="Unplug physical cable from this port"
                    >
                      <Unlink className="w-3 h-3" /> Unplug
                    </button>
                  )}
                  {device.ports.length > 1 && (
                    <button
                      type="button"
                      onClick={handleDeleteActivePort}
                      className="p-1 rounded-lg bg-zinc-900 hover:bg-rose-950 border border-zinc-800 hover:border-rose-500/60 text-zinc-500 hover:text-rose-400 cursor-pointer"
                      title="Remove port from device"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Active Physical Cable & Latency Telemetry Banner */}
          {activePortLink ? (
            <div className="p-2.5 rounded-xl bg-[#0A0E18] border border-cyan-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[10.5px]">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5 text-cyan-300 font-semibold">
                  <Cable className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{activePortLink.peerLabel}</span>
                </div>
                <div className="text-[10px] font-mono text-zinc-400 truncate">
                  {activePortLink.metrics.pathSummary}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200">
                  {activePortLink.metrics.distanceMeters}m · {activePortLink.media}
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-bold border ${
                    activePortLink.metrics.grade === 'down'
                      ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                      : activePortLink.metrics.grade === 'elevated'
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                        : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  }`}
                >
                  RTT {activePortLink.metrics.shortLatencyLabel}
                </span>
                <span className="hidden xl:inline text-[9.5px] text-zinc-500">
                  Prop {activePortLink.metrics.propagationUs}µs · Sw {activePortLink.metrics.switchingUs}µs
                </span>
              </div>
            </div>
          ) : (
            <div className="px-2.5 py-1.5 rounded-xl bg-[#0B0E16] border border-dashed border-zinc-800 text-[10.5px] text-zinc-500 flex items-center justify-between">
              <span>No physical patch cable terminated on {activePort.label}.</span>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => setShowPatchWizard(true)}
                  className="text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer"
                >
                  + Connect to Rack Port or IT Node
                </button>
              )}
            </div>
          )}

          {/* Direct Port-to-Port & IT-Node Patch Wizard with Real-Time Latency Estimate */}
          {showPatchWizard && !isReadOnly && (
            <div className="p-3 rounded-xl bg-[#0B0F1B] border border-violet-500/50 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-violet-300 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5" />
                  Connect {device.name} [{activePort.label}] → Destination
                </span>
                <div className="flex items-center gap-1 bg-[#141929] p-0.5 rounded-lg border border-zinc-800 text-[10px]">
                  {(
                    [
                      { id: 'same-rack', label: 'Same Rack Port' },
                      { id: 'cross-rack', label: 'Cross-Rack Trunk' },
                      { id: 'user-node', label: 'IT User Node' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPatchTargetMode(m.id)}
                      className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                        patchTargetMode === m.id
                          ? 'bg-violet-600 text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                {patchTargetMode === 'cross-rack' && (
                  <select
                    value={destRack?.id ?? ''}
                    onChange={(e) => {
                      setTargetRackId(e.target.value);
                      setTargetDeviceId('');
                      setTargetPortId('');
                    }}
                    className="px-2 py-1.5 rounded-lg bg-[#141927] border border-zinc-700 text-zinc-100"
                  >
                    {allRacks
                      .filter((r) => r.id !== activeRack.id)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.assetId} · {r.name}
                        </option>
                      ))}
                  </select>
                )}

                {patchTargetMode !== 'user-node' ? (
                  <>
                    <select
                      value={destDeviceObj?.id ?? ''}
                      onChange={(e) => {
                        setTargetDeviceId(e.target.value);
                        setTargetPortId('');
                      }}
                      className="px-2 py-1.5 rounded-lg bg-[#141927] border border-zinc-700 text-zinc-100"
                    >
                      {destDevices.map((d) => (
                        <option key={d.id} value={d.id}>
                          U{d.uStart} · {d.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={destPortObj?.id ?? ''}
                      onChange={(e) => setTargetPortId(e.target.value)}
                      className="px-2 py-1.5 rounded-lg bg-[#141927] border border-zinc-700 text-zinc-100"
                    >
                      {(destDeviceObj?.ports ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} ({p.speedGbps}G {p.kind} · {p.status})
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <select
                    value={destUserNodeObj?.id ?? ''}
                    onChange={(e) => setTargetNodeId(e.target.value)}
                    className="sm:col-span-2 px-2 py-1.5 rounded-lg bg-[#141927] border border-zinc-700 text-zinc-100"
                  >
                    {userNodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.code} ({n.wallJackId}) · {n.name} · {n.vlan}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  value={patchMedia}
                  onChange={(e) => setPatchMedia(e.target.value as typeof patchMedia)}
                  className="px-2 py-1.5 rounded-lg bg-[#141927] border border-zinc-700 text-zinc-100"
                >
                  <option value="OM4 Fiber">OM4 Multimode Fiber</option>
                  <option value="OS2 Single-Mode">OS2 Single-Mode Fiber</option>
                  <option value="DAC Twinax">DAC Twinax Copper</option>
                  <option value="Cat6A">Cat6A Shielded Copper</option>
                </select>
              </div>

              {/* Live Cable Path & Latency Preview before committing */}
              {previewMetrics && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#080B12] border border-zinc-800 text-[10.5px] font-mono tabular-nums">
                  <div className="flex items-center gap-2 text-zinc-300 flex-wrap">
                    <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Est. Run: <strong className="text-white">{previewMetrics.distanceMeters} m</strong></span>
                    <span className="text-zinc-600">·</span>
                    <span>Est. RTT: <strong className="text-emerald-400">{previewMetrics.shortLatencyLabel}</strong></span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-400">
                      Prop {previewMetrics.propagationUs}µs + Ser {previewMetrics.serializationUs}µs + Sw {previewMetrics.switchingUs}µs
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCommitPatch}
                    className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-sans text-[11px] font-bold cursor-pointer"
                  >
                    Commit Patch Link
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Inline Port Parameter Editor Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[10.5px]">
            <label className="space-y-0.5">
              <span className="text-[9.5px] text-zinc-500 uppercase font-mono">Port Label</span>
              <input
                type="text"
                disabled={isReadOnly}
                value={activePort.label}
                onChange={(e) => updateActivePort({ label: e.target.value })}
                className="w-full px-2 py-1 rounded-lg bg-[#090C14] border border-zinc-800 text-zinc-100 font-mono disabled:opacity-50"
              />
            </label>

            <label className="space-y-0.5">
              <span className="text-[9.5px] text-zinc-500 uppercase font-mono">Interface</span>
              <select
                disabled={isReadOnly}
                value={activePort.kind}
                onChange={(e) =>
                  updateActivePort({
                    kind: e.target.value as RackPort['kind'],
                    isUplink: e.target.value !== 'RJ45' && e.target.value !== 'Console',
                  })
                }
                className="w-full px-2 py-1 rounded-lg bg-[#090C14] border border-zinc-800 text-zinc-100 font-mono disabled:opacity-50"
              >
                <option value="RJ45">RJ45 Copper</option>
                <option value="SFP+">SFP+ 10G</option>
                <option value="QSFP28">QSFP28 100G</option>
                <option value="Fiber-LC">Fiber-LC</option>
                <option value="Console">Console</option>
                <option value="Power-C13">Power-C13</option>
              </select>
            </label>

            <label className="space-y-0.5">
              <span className="text-[9.5px] text-zinc-500 uppercase font-mono">Speed</span>
              <select
                disabled={isReadOnly}
                value={activePort.speedGbps}
                onChange={(e) => updateActivePort({ speedGbps: Number(e.target.value) })}
                className="w-full px-2 py-1 rounded-lg bg-[#090C14] border border-zinc-800 text-zinc-100 font-mono disabled:opacity-50"
              >
                {[1, 2.5, 10, 25, 40, 100].map((sp) => (
                  <option key={sp} value={sp}>
                    {sp} Gbps
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-0.5">
              <span className="text-[9.5px] text-zinc-500 uppercase font-mono">VLAN</span>
              <select
                disabled={isReadOnly}
                value={VLAN_OPTIONS.includes(activePort.vlan) ? activePort.vlan : VLAN_OPTIONS[0]}
                onChange={(e) => updateActivePort({ vlan: e.target.value })}
                className="w-full px-2 py-1 rounded-lg bg-[#090C14] border border-zinc-800 text-zinc-100 font-mono disabled:opacity-50"
              >
                {VLAN_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-0.5">
              <span className="text-[9.5px] text-zinc-500 uppercase font-mono">Link State</span>
              <select
                disabled={isReadOnly}
                value={activePort.status}
                onChange={(e) => updateActivePort({ status: e.target.value as RackPort['status'] })}
                className="w-full px-2 py-1 rounded-lg bg-[#090C14] border border-zinc-800 text-zinc-100 font-mono disabled:opacity-50"
              >
                <option value="up">UP (Active)</option>
                <option value="standby">STANDBY</option>
                <option value="down">ADMIN DOWN</option>
                <option value="error">CRC / ERR</option>
              </select>
            </label>

            <label className="space-y-0.5">
              <span className="text-[9.5px] text-zinc-500 uppercase font-mono flex items-center gap-1">
                <Zap className="w-2.5 h-2.5 text-amber-400" /> PoE (W)
              </span>
              <input
                type="number"
                min={0}
                max={90}
                step={5}
                disabled={isReadOnly || activePort.kind !== 'RJ45'}
                value={activePort.poeWatts ?? 0}
                onChange={(e) => updateActivePort({ poeWatts: Math.max(0, Number(e.target.value)) })}
                className="w-full px-2 py-1 rounded-lg bg-[#090C14] border border-zinc-800 text-zinc-100 font-mono tabular-nums disabled:opacity-40"
              />
            </label>
          </div>

          {/* Live Diagnostics Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-zinc-800/70 text-[10px] font-mono tabular-nums text-zinc-400">
            <div className="flex items-center gap-3 flex-wrap">
              <span>
                Util: <strong className="text-cyan-300">{activePort.utilizationPct ?? 18}%</strong>
              </span>
              <span>
                CRC Errors:{' '}
                <strong className={(activePort.crcErrors ?? 0) > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                  {activePort.crcErrors ?? 0}
                </strong>
              </span>
              {activePort.opticalDbm !== undefined && (
                <span>
                  Optical Rx:{' '}
                  <strong className={activePort.opticalDbm < -9 ? 'text-amber-400' : 'text-emerald-400'}>
                    {activePort.opticalDbm.toFixed(1)} dBm
                  </strong>
                </span>
              )}
            </div>
            <span className="flex items-center gap-1 text-zinc-500">
              {(activePort.crcErrors ?? 0) > 0 || activePort.status === 'error' ? (
                <>
                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                  <span className="text-rose-400">Signal integrity alert</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>PHY nominal</span>
                </>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
