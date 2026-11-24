import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Cable,
  Cpu,
  HardDrive,
  Network,
  Plus,
  Server,
  Shield,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import type {
  RackDesignConfig,
  RackDevice,
  RackPatchCable,
  RackPort,
} from '../types/twin';

const DEFAULT_RACK_CONFIG: RackDesignConfig = {
  totalUnits: 42,
  maxPowerKw: 12,
  coolingZone: 'Cold Aisle A1',
  subnetCidr: '10.42.10.0/24',
  devices: [
    {
      id: 'dev-sw-init',
      name: 'Core Top-of-Rack Switch',
      kind: 'switch',
      uStart: 41,
      uHeight: 2,
      powerW: 520,
      ipAddress: '10.42.10.1',
      vlan: 'VLAN-10-OT',
      vendor: 'Cisco',
      model: 'Nexus 9336C',
      status: 'online',
      ports: [
        { id: 'p-1', label: 'Eth1/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-10-OT', status: 'up' },
        { id: 'p-2', label: 'Eth1/2', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up' },
        { id: 'p-3', label: 'Eth1/3', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-30-EMS', status: 'up' },
        { id: 'p-4', label: 'Eth1/4', kind: 'QSFP28', speedGbps: 100, vlan: 'VLAN-99-UPLINK', status: 'up' },
      ],
    },
    {
      id: 'dev-srv-init',
      name: 'GMP Historian Server 01',
      kind: 'server',
      uStart: 35,
      uHeight: 2,
      powerW: 780,
      ipAddress: '10.42.10.21',
      vlan: 'VLAN-20-SCADA',
      vendor: 'Dell EMC',
      model: 'PowerEdge R760',
      status: 'online',
      ports: [
        { id: 's-1', label: 'NIC1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up' },
        { id: 's-2', label: 'iDRAC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up' },
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
      color: '#8B5CF6',
      label: 'HIST-10G-PRIMARY',
    },
  ],
};

const DEVICE_PRESETS: {
  kind: RackDevice['kind'];
  label: string;
  uHeight: number;
  powerW: number;
  vendor: string;
  model: string;
  color: string;
  defaultPorts: Omit<RackPort, 'id'>[];
}[] = [
  {
    kind: 'server',
    label: '2U Compute Server',
    uHeight: 2,
    powerW: 820,
    vendor: 'Dell EMC',
    model: 'PowerEdge R760',
    color: '#3B82F6',
    defaultPorts: [
      { label: 'NIC1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up' },
      { label: 'NIC2', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'standby' },
      { label: 'iDRAC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up' },
    ],
  },
  {
    kind: 'switch',
    label: '1U Core Switch (48P)',
    uHeight: 1,
    powerW: 480,
    vendor: 'Cisco',
    model: 'Catalyst 9300-48UXM',
    color: '#8B5CF6',
    defaultPorts: [
      { label: 'Gi1/0/1', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-10-OT', status: 'up' },
      { label: 'Gi1/0/2', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-10-OT', status: 'up' },
      { label: 'Te1/1/1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-99-UPLINK', status: 'up' },
      { label: 'Te1/1/2', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-99-UPLINK', status: 'up' },
    ],
  },
  {
    kind: 'firewall',
    label: '2U OT Firewall',
    uHeight: 2,
    powerW: 390,
    vendor: 'Palo Alto',
    model: 'PA-3420',
    color: '#F59E0B',
    defaultPorts: [
      { label: 'WAN-1', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-99-DMZ', status: 'up' },
      { label: 'LAN-OT', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-10-OT', status: 'up' },
    ],
  },
  {
    kind: 'patch-panel',
    label: '1U Fiber Patch Panel',
    uHeight: 1,
    powerW: 0,
    vendor: 'Panduit',
    model: 'Opticom 24-LC',
    color: '#06B6D4',
    defaultPorts: [
      { label: 'LC-01', kind: 'Fiber-LC', speedGbps: 25, vlan: 'VLAN-10-OT', status: 'up' },
      { label: 'LC-02', kind: 'Fiber-LC', speedGbps: 25, vlan: 'VLAN-20-SCADA', status: 'up' },
      { label: 'LC-03', kind: 'Fiber-LC', speedGbps: 25, vlan: 'VLAN-30-EMS', status: 'up' },
    ],
  },
  {
    kind: 'storage',
    label: '4U SAN Storage Array',
    uHeight: 4,
    powerW: 1150,
    vendor: 'NetApp',
    model: 'AFF A400',
    color: '#10B981',
    defaultPorts: [
      { label: 'e0a', kind: 'QSFP28', speedGbps: 100, vlan: 'VLAN-40-SAN', status: 'up' },
      { label: 'e0b', kind: 'QSFP28', speedGbps: 100, vlan: 'VLAN-40-SAN', status: 'up' },
    ],
  },
  {
    kind: 'ups',
    label: '4U Rack UPS (6 kVA)',
    uHeight: 4,
    powerW: 320,
    vendor: 'APC',
    model: 'Smart-UPS SRT6KRM',
    color: '#EF4444',
    defaultPorts: [{ label: 'NMC', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-99-MGMT', status: 'up' }],
  },
  {
    kind: 'scada',
    label: '2U SCADA PLC Gateway',
    uHeight: 2,
    powerW: 260,
    vendor: 'Siemens',
    model: 'SIMATIC IPC647E',
    color: '#EC4899',
    defaultPorts: [
      { label: 'PROFINET-1', kind: 'RJ45', speedGbps: 1, vlan: 'VLAN-10-OT', status: 'up' },
      { label: 'OPC-UA', kind: 'SFP+', speedGbps: 10, vlan: 'VLAN-20-SCADA', status: 'up' },
    ],
  },
];

const KIND_COLOR: Record<RackDevice['kind'], string> = {
  server: '#3B82F6',
  switch: '#8B5CF6',
  router: '#6366F1',
  firewall: '#F59E0B',
  'patch-panel': '#06B6D4',
  storage: '#10B981',
  ups: '#EF4444',
  pdu: '#F97316',
  scada: '#EC4899',
  kvm: '#64748B',
};

export const NetworkRackDesignerModal: React.FC = () => {
  const showNetworkRackModal = useTwinStore((s) => s.showNetworkRackModal);
  const closeRackDesigner = useTwinStore((s) => s.closeRackDesigner);
  const activeRackAssetId = useTwinStore((s) => s.activeRackAssetId);
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const updateAsset = useTwinStore((s) => s.updateAsset);
  const addAsset = useTwinStore((s) => s.addAsset);
  const showToast = useTwinStore((s) => s.showToast);

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

  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [rackFace, setRackFace] = useState<'front' | 'rear'>('front');

  // New cable state
  const [cableFromDev, setCableFromDev] = useState('');
  const [cableFromPort, setCableFromPort] = useState('');
  const [cableToDev, setCableToDev] = useState('');
  const [cableToPort, setCableToPort] = useState('');
  const [cableMedia, setCableMedia] = useState<RackPatchCable['media']>('OM4 Fiber');
  const [cableVlan, setCableVlan] = useState('VLAN-10-OT');

  useEffect(() => {
    if (!showNetworkRackModal) return;
    if (activeRackAssetId && itAssets.some((a) => a.id === activeRackAssetId)) {
      setSelectedAssetId(activeRackAssetId);
    } else if (!selectedAssetId || !itAssets.some((a) => a.id === selectedAssetId)) {
      setSelectedAssetId(itAssets[0]?.id ?? '');
    }
  }, [showNetworkRackModal, activeRackAssetId, itAssets, selectedAssetId]);

  const activeAsset = itAssets.find((a) => a.id === selectedAssetId) ?? itAssets[0] ?? null;

  const rackConfig: RackDesignConfig = useMemo(() => {
    if (!activeAsset) return DEFAULT_RACK_CONFIG;
    return activeAsset.rackConfig ?? structuredClone(DEFAULT_RACK_CONFIG);
  }, [activeAsset]);

  useEffect(() => {
    if (!selectedDeviceId || !rackConfig.devices.some((d) => d.id === selectedDeviceId)) {
      setSelectedDeviceId(rackConfig.devices[0]?.id ?? '');
    }
  }, [rackConfig.devices, selectedDeviceId]);

  if (!showNetworkRackModal) return null;

  const commitRackConfig = (nextConfig: RackDesignConfig) => {
    if (!activeAsset) return;
    updateAsset(activeAsset.id, { rackConfig: nextConfig });
  };

  const handleSpawnRackAsset = () => {
    const fl = scene.floors.find((f) => f.id === activeFloorId) ?? scene.floors[0];
    const created = addAsset(
      'eq-server-rack-42u',
      fl ? Number((fl.width * 0.5).toFixed(1)) : 8,
      fl ? Number((fl.depth * 0.5).toFixed(1)) : 8,
      {
        name: `Data Center 42U Rack DC-${String(itAssets.length + 1).padStart(2, '0')}`,
        rackConfig: structuredClone(DEFAULT_RACK_CONFIG),
      }
    );
    setSelectedAssetId(created.id);
    showToast('Added new 42U IT/Data Center Rack to active floor', 'success');
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
    const uStart = findFreeUSlot(preset.uHeight);
    const id = `dev-${Date.now()}`;
    const newDev: RackDevice = {
      id,
      name: `${preset.label} #${rackConfig.devices.length + 1}`,
      kind: preset.kind,
      uStart,
      uHeight: preset.uHeight,
      powerW: preset.powerW,
      ipAddress: `10.42.10.${30 + rackConfig.devices.length}`,
      vlan: 'VLAN-10-OT',
      vendor: preset.vendor,
      model: preset.model,
      status: 'online',
      ports: preset.defaultPorts.map((p, i) => ({ ...p, id: `${id}-p${i + 1}` })),
    };
    commitRackConfig({ ...rackConfig, devices: [...rackConfig.devices, newDev] });
    setSelectedDeviceId(id);
  };

  const handleMoveDeviceU = (devId: string, delta: number) => {
    const nextDevs = rackConfig.devices.map((d) => {
      if (d.id !== devId) return d;
      const nextU = Math.max(1, Math.min(rackConfig.totalUnits - d.uHeight + 1, d.uStart + delta));
      return { ...d, uStart: nextU };
    });
    commitRackConfig({ ...rackConfig, devices: nextDevs });
  };

  const handleDeleteDevice = (devId: string) => {
    commitRackConfig({
      ...rackConfig,
      devices: rackConfig.devices.filter((d) => d.id !== devId),
      cables: rackConfig.cables.filter((c) => c.fromDeviceId !== devId && c.toDeviceId !== devId),
    });
  };

  const handleAddPort = (devId: string) => {
    const nextDevs = rackConfig.devices.map((d) => {
      if (d.id !== devId) return d;
      const idx = d.ports.length + 1;
      const newPort: RackPort = {
        id: `${devId}-p-${Date.now()}`,
        label: `Port-${idx}`,
        kind: d.kind === 'patch-panel' ? 'Fiber-LC' : 'SFP+',
        speedGbps: 10,
        vlan: d.vlan,
        status: 'up',
      };
      return { ...d, ports: [...d.ports, newPort] };
    });
    commitRackConfig({ ...rackConfig, devices: nextDevs });
  };

  const handleTogglePortStatus = (devId: string, portId: string) => {
    const nextDevs = rackConfig.devices.map((d) => {
      if (d.id !== devId) return d;
      return {
        ...d,
        ports: d.ports.map((p) =>
          p.id === portId
            ? { ...p, status: p.status === 'up' ? ('down' as const) : ('up' as const) }
            : p
        ),
      };
    });
    commitRackConfig({ ...rackConfig, devices: nextDevs });
  };

  const handleAddPatchCable = () => {
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
      vlan: cableVlan,
      color: mediaColor[cableMedia],
      label: `${cableMedia.split(' ')[0].toUpperCase()}-${rackConfig.cables.length + 1}`,
    };
    commitRackConfig({ ...rackConfig, cables: [...rackConfig.cables, cable] });
    showToast('Connected patch cable in rack matrix', 'success');
  };

  const totalPowerKw = rackConfig.devices.reduce((s, d) => s + (d.powerW || 0), 0) / 1000;
  const powerPct = Math.min(100, Math.round((totalPowerKw / Math.max(1, rackConfig.maxPowerKw)) * 100));
  const usedUnits = rackConfig.devices.reduce((s, d) => s + d.uHeight, 0);
  const thermalBtu = Math.round(totalPowerKw * 3412.14);

  const selectedDev = rackConfig.devices.find((d) => d.id === selectedDeviceId) ?? null;

  // Build U-slot map (42 down to 1)
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

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-7xl h-[90vh] bg-white dark:bg-[#101015] border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-[#0C0C10] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={closeRackDesigner}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
              Back
            </button>
            <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
              <Server className="w-4 h-4 text-violet-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white truncate">
                IT &amp; Data Center Rack &amp; Network Port Designer
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                42U cabinet elevation, active ports (RJ45/SFP+/QSFP28/Fiber), VLANs, patch cable matrix &amp; PDU thermal load
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSpawnRackAsset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add 42U Rack to Floor
            </button>
            <button
              onClick={closeRackDesigner}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body 3-Column Studio */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Col 1: IT/OT Rack Assets + Hardware Catalog */}
          <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0 bg-zinc-50/50 dark:bg-[#0E0E13] overflow-y-auto p-3.5 space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Facility IT / Network Racks ({itAssets.length})
              </div>
              {itAssets.length === 0 ? (
                <div className="p-3 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 text-xs text-zinc-500 text-center space-y-2">
                  <div>No IT racks placed yet.</div>
                  <button
                    onClick={handleSpawnRackAsset}
                    className="px-3 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-semibold"
                  >
                    Place 42U Compute Rack
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {itAssets.map((a) => {
                    const isSel = a.id === activeAsset?.id;
                    const devCount = a.rackConfig?.devices.length ?? 0;
                    return (
                      <button
                        key={a.id}
                        onClick={() => setSelectedAssetId(a.id)}
                        className={`w-full text-left p-2.5 rounded-xl border transition-colors ${
                          isSel
                            ? 'border-violet-500 bg-violet-500/12 text-zinc-900 dark:text-white'
                            : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#15151C] text-zinc-700 dark:text-zinc-300 hover:border-zinc-400'
                        }`}
                      >
                        <div className="text-xs font-semibold truncate">{a.name}</div>
                        <div className="text-[10px] font-mono text-zinc-500 flex justify-between mt-0.5">
                          <span>{a.assetId}</span>
                          <span>{devCount} units</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {activeAsset && (
              <>
                {/* Rack Power & Thermal Gauges */}
                <div className="p-3 rounded-2xl bg-white dark:bg-[#15151C] border border-zinc-200 dark:border-zinc-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="flex items-center gap-1.5 text-amber-500">
                      <Zap className="w-3.5 h-3.5" /> PDU Load
                    </span>
                    <span className={`font-mono ${totalPowerKw > rackConfig.maxPowerKw ? 'text-rose-500' : 'text-zinc-900 dark:text-white'}`}>
                      {totalPowerKw.toFixed(2)} / {rackConfig.maxPowerKw} kW
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        powerPct > 90 ? 'bg-rose-500' : powerPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${powerPct}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10.5px] font-mono text-zinc-500">
                    <div>Space: {usedUnits}/{rackConfig.totalUnits}U</div>
                    <div className="text-right">{thermalBtu.toLocaleString()} BTU/h</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="text-[9.5px] text-zinc-500 block">Subnet CIDR</label>
                      <input
                        value={rackConfig.subnetCidr}
                        onChange={(e) => commitRackConfig({ ...rackConfig, subnetCidr: e.target.value })}
                        className="w-full px-2 py-1 text-[11px] font-mono rounded-lg bg-zinc-50 dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700"
                      />
                    </div>
                    <div>
                      <label className="text-[9.5px] text-zinc-500 block">Max PDU (kW)</label>
                      <input
                        type="number"
                        step={1}
                        min={2}
                        max={40}
                        value={rackConfig.maxPowerKw}
                        onChange={(e) =>
                          commitRackConfig({ ...rackConfig, maxPowerKw: Number(e.target.value) || 12 })
                        }
                        className="w-full px-2 py-1 text-[11px] font-mono rounded-lg bg-zinc-50 dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700"
                      />
                    </div>
                  </div>
                </div>

                {/* Add Rack-Mount Hardware */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Mount Hardware Into Rack
                  </div>
                  {DEVICE_PRESETS.map((preset) => (
                    <button
                      key={preset.kind}
                      onClick={() => handleAddDevice(preset)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#15151C] border border-zinc-200 dark:border-zinc-800 hover:border-violet-500 text-xs transition-colors"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: preset.color }}
                        />
                        <span className="truncate font-medium">{preset.label}</span>
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                        {preset.uHeight}U · {preset.powerW}W
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Col 2: Interactive 42U Cabinet Elevation */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0 bg-[#0A0A0E] text-zinc-100">
            <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <div className="text-xs font-mono font-semibold text-zinc-200">
                {activeAsset ? `${activeAsset.assetId} · 42U Elevation` : '42U Cabinet'}
              </div>
              <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
                {(['front', 'rear'] as const).map((face) => (
                  <button
                    key={face}
                    onClick={() => setRackFace(face)}
                    className={`px-2.5 py-1 rounded-md text-[10.5px] font-semibold capitalize ${
                      rackFace === face ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {face}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <div className="mx-auto max-w-[340px] rounded-xl border-2 border-zinc-700 bg-[#121218] p-2 shadow-2xl">
                <div className="space-y-0.5">
                  {Array.from({ length: rackConfig.totalUnits }, (_, idx) => {
                    const u = rackConfig.totalUnits - idx;
                    const owners = slotOwnerMap.get(u) ?? [];
                    const collision = owners.length > 1;
                    const topOwner = owners.find((d) => d.uStart + d.uHeight - 1 === u);
                    const continuing = owners.length > 0 && !topOwner;

                    if (continuing) return null;

                    if (topOwner) {
                      const isSel = topOwner.id === selectedDeviceId;
                      const bg = KIND_COLOR[topOwner.kind] ?? '#3B82F6';
                      return (
                        <div
                          key={u}
                          onClick={() => setSelectedDeviceId(topOwner.id)}
                          style={{
                            height: `${Math.max(24, topOwner.uHeight * 22)}px`,
                            borderColor: collision ? '#EF4444' : isSel ? '#F59E0B' : bg,
                          }}
                          className={`flex items-center gap-2 px-2 rounded-lg border cursor-pointer transition-all ${
                            collision
                              ? 'bg-rose-950/80'
                              : isSel
                                ? 'bg-violet-950/90 ring-1 ring-amber-400'
                                : 'bg-[#1A1A24] hover:bg-[#222230]'
                          }`}
                        >
                          <span className="w-7 text-[9.5px] font-mono text-zinc-400 shrink-0">
                            U{topOwner.uStart}
                            {topOwner.uHeight > 1 ? `-${topOwner.uStart + topOwner.uHeight - 1}` : ''}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold text-white truncate flex items-center gap-1.5">
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  topOwner.status === 'online' ? 'bg-emerald-400' : 'bg-amber-400'
                                }`}
                              />
                              {topOwner.name}
                            </div>
                            <div className="text-[9.5px] font-mono text-zinc-400 truncate">
                              {rackFace === 'front'
                                ? `${topOwner.vendor} ${topOwner.model} · ${topOwner.ipAddress}`
                                : `Ports: ${topOwner.ports.length} · ${topOwner.powerW}W · ${topOwner.vlan}`}
                            </div>
                          </div>
                          {/* Mini Port LED Strip */}
                          <div className="flex gap-0.5 shrink-0">
                            {topOwner.ports.slice(0, 6).map((p) => (
                              <span
                                key={p.id}
                                title={`${p.label} (${p.kind} ${p.speedGbps}G)`}
                                className={`w-1.5 h-2.5 rounded-[2px] ${
                                  p.status === 'up' ? 'bg-emerald-400' : 'bg-zinc-600'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={u}
                        className="h-[18px] flex items-center gap-2 px-2 rounded bg-[#0E0E13] border border-zinc-800/60 text-[9px] font-mono text-zinc-600"
                      >
                        <span className="w-7">U{u}</span>
                        <span className="flex-1 border-b border-dashed border-zinc-800" />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Col 3: Selected Device Port Matrix & Patch Cable Matrix */}
          <div className="lg:col-span-5 flex flex-col min-h-0 overflow-y-auto p-4 space-y-5 bg-white dark:bg-[#121218]">
            {selectedDev ? (
              <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800 space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono uppercase text-violet-500">
                      U{selectedDev.uStart}–U{selectedDev.uStart + selectedDev.uHeight - 1} · {selectedDev.kind}
                    </div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                      {selectedDev.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleMoveDeviceU(selectedDev.id, 1)}
                      className="p-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-violet-600 hover:text-white"
                      title="Move Up 1U"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMoveDeviceU(selectedDev.id, -1)}
                      className="p-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-violet-600 hover:text-white"
                      title="Move Down 1U"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteDevice(selectedDev.id)}
                      className="p-1.5 rounded-lg border border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
                      title="Remove from Rack"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5 text-xs">
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-0.5">IP Address</label>
                    <input
                      value={selectedDev.ipAddress}
                      onChange={(e) =>
                        commitRackConfig({
                          ...rackConfig,
                          devices: rackConfig.devices.map((d) =>
                            d.id === selectedDev.id ? { ...d, ipAddress: e.target.value } : d
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1 text-xs font-mono rounded-lg bg-white dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-0.5">Primary VLAN</label>
                    <input
                      value={selectedDev.vlan}
                      onChange={(e) =>
                        commitRackConfig({
                          ...rackConfig,
                          devices: rackConfig.devices.map((d) =>
                            d.id === selectedDev.id ? { ...d, vlan: e.target.value } : d
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1 text-xs font-mono rounded-lg bg-white dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-0.5">Power (Watts)</label>
                    <input
                      type="number"
                      step={25}
                      value={selectedDev.powerW}
                      onChange={(e) =>
                        commitRackConfig({
                          ...rackConfig,
                          devices: rackConfig.devices.map((d) =>
                            d.id === selectedDev.id ? { ...d, powerW: Number(e.target.value) || 0 } : d
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1 text-xs font-mono rounded-lg bg-white dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700"
                    />
                  </div>
                </div>

                {/* Ports Grid */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
                      <Network className="w-3.5 h-3.5 text-violet-500" />
                      Active Interfaces &amp; Ports ({selectedDev.ports.length})
                    </span>
                    <button
                      onClick={() => handleAddPort(selectedDev.id)}
                      className="px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10.5px] font-semibold flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add Port
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {selectedDev.ports.map((port) => (
                      <button
                        key={port.id}
                        onClick={() => handleTogglePortStatus(selectedDev.id, port.id)}
                        className={`p-2 rounded-xl border text-left transition-colors ${
                          port.status === 'up'
                            ? 'border-emerald-500/40 bg-emerald-500/8'
                            : 'border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-[#111116]'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono font-semibold">
                          <span>{port.label}</span>
                          <span
                            className={`w-2 h-2 rounded-full ${
                              port.status === 'up' ? 'bg-emerald-500' : 'bg-zinc-500'
                            }`}
                          />
                        </div>
                        <div className="text-[9.5px] font-mono text-zinc-500 mt-0.5">
                          {port.kind} · {port.speedGbps}G · {port.vlan}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-zinc-500 border border-dashed border-zinc-700 rounded-2xl">
                Select a rack device to inspect its IP, VLAN, and port matrix.
              </div>
            )}

            {/* Patch Cable Matrix */}
            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800 space-y-3.5">
              <div className="text-xs font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                <Cable className="w-4 h-4 text-amber-500" />
                Structured Patch Cable &amp; Fiber Matrix ({rackConfig.cables.length} links)
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <select
                  value={cableFromDev}
                  onChange={(e) => {
                    setCableFromDev(e.target.value);
                    setCableFromPort('');
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700"
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
                  className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700"
                >
                  <option value="">Source Port…</option>
                  {(fromDeviceObj?.ports ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.kind} {p.speedGbps}G)
                    </option>
                  ))}
                </select>

                <select
                  value={cableToDev}
                  onChange={(e) => {
                    setCableToDev(e.target.value);
                    setCableToPort('');
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700"
                >
                  <option value="">Destination Device…</option>
                  {rackConfig.devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      U{d.uStart} · {d.name}
                    </option>
                  ))}
                </select>
                <select
                  value={cableToPort}
                  onChange={(e) => setCableToPort(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700"
                >
                  <option value="">Destination Port…</option>
                  {(toDeviceObj?.ports ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.kind} {p.speedGbps}G)
                    </option>
                  ))}
                </select>

                <select
                  value={cableMedia}
                  onChange={(e) => setCableMedia(e.target.value as RackPatchCable['media'])}
                  className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#101016] border border-zinc-200 dark:border-zinc-700"
                >
                  <option value="OM4 Fiber">OM4 Fiber (Aqua)</option>
                  <option value="OS2 Single-Mode">OS2 Single-Mode (Yellow)</option>
                  <option value="DAC Twinax">DAC Twinax 10G/25G (Violet)</option>
                  <option value="Cat6A">Cat6A Copper (Amber)</option>
                  <option value="Power">Redundant Power C13 (Red)</option>
                </select>
                <button
                  onClick={handleAddPatchCable}
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold transition-colors"
                >
                  + Patch Link
                </button>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {rackConfig.cables.map((c) => {
                  const fd = rackConfig.devices.find((d) => d.id === c.fromDeviceId);
                  const fp = fd?.ports.find((p) => p.id === c.fromPortId);
                  const td = rackConfig.devices.find((d) => d.id === c.toDeviceId);
                  const tp = td?.ports.find((p) => p.id === c.toPortId);
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-800 text-[11px]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: c.color }}
                        />
                        <div className="truncate">
                          <span className="font-semibold">{fd?.name?.slice(0, 18) ?? c.fromDeviceId}</span>{' '}
                          <span className="font-mono text-violet-500">[{fp?.label ?? c.fromPortId}]</span>
                          <span className="mx-1.5 text-zinc-400">→</span>
                          <span className="font-semibold">{td?.name?.slice(0, 18) ?? c.toDeviceId}</span>{' '}
                          <span className="font-mono text-amber-500">[{tp?.label ?? c.toPortId}]</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[10px] text-zinc-500">{c.media}</span>
                        <button
                          onClick={() =>
                            commitRackConfig({
                              ...rackConfig,
                              cables: rackConfig.cables.filter((x) => x.id !== c.id),
                            })
                          }
                          className="text-zinc-400 hover:text-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
