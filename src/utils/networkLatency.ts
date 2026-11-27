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

export type LatencyGrade = 'optimal' | 'nominal' | 'elevated' | 'down';

export interface PhysicalCableMetrics {
  distanceMeters: number;
  mediaLabel: string;
  speedGbps: number;
  propagationUs: number;
  serializationUs: number;
  switchingUs: number;
  jitterUs: number;
  oneWayUs: number;
  oneWayMs: number;
  rttMs: number;
  hops: number;
  grade: LatencyGrade;
  pathSummary: string;
  shortLatencyLabel: string;
}

/** Propagation velocity delay in nanoseconds per meter by cable media */
function getMediaPropagationNsPerMeter(media: string): number {
  const m = media.toLowerCase();
  if (m.includes('dac') || m.includes('twinax')) return 4.35; // ~0.76c
  if (m.includes('om4') || m.includes('os2') || m.includes('fiber') || m.includes('sfp') || m.includes('qsfp')) {
    return 4.95; // silica fiber ~0.67c (n ≈ 1.48)
  }
  return 5.15; // Cat6A UTP/STP copper ~0.65c
}

/** 1500-byte MTU frame serialization delay in microseconds */
function getSerializationUs(speedGbps: number): number {
  const safeGbps = Math.max(0.1, speedGbps || 1);
  // 1518 bytes * 8 bits = 12,144 bits -> at 1 Gbps = 12.144 µs
  return Number((12.144 / safeGbps).toFixed(2));
}

/** Switching / forwarding latency per active network device in microseconds */
function getDeviceSwitchingUs(device?: Pick<RackDevice, 'kind' | 'tier'>): number {
  if (!device) return 8.0;
  if (device.kind === 'patch-panel') return 0.2;
  if (device.kind === 'firewall') return 58.0; // stateful DPI / zone inspection
  if (device.kind === 'router') return 26.0;
  if (device.kind === 'switch') {
    if (device.tier === 'core') return 3.2; // Nexus cut-through ASIC
    if (device.tier === 'distribution') return 6.5;
    return 11.5; // Access Catalyst store-and-forward
  }
  if (device.kind === 'storage' || device.kind === 'server') return 14.0;
  return 9.0;
}

/** Format latency cleanly with tabular readability (µs under 0.1ms, ms above) */
export function formatLatencyLabel(ms: number, isDown = false): string {
  if (isDown) return 'DOWN';
  if (ms < 0.1) {
    return `${Math.max(1, Math.round(ms * 1000))} µs`;
  }
  if (ms < 1) {
    return `${ms.toFixed(2)} ms`;
  }
  return `${ms.toFixed(1)} ms`;
}

/** Compute real world coordinates (x, y, z in meters) for a rack or user node */
function getWorldPoint(
  floorId: string | undefined,
  x: number,
  z: number,
  floors: Floor[],
  buildings: Building[]
): { wx: number; wy: number; wz: number; floorCode: string; buildingCode: string } {
  const fl = floors.find((f) => f.id === floorId);
  const bldg = fl ? buildings.find((b) => b.id === fl.buildingId) : undefined;
  return {
    wx: (bldg?.originX ?? 0) + x,
    wy: fl?.elevation ?? 0,
    wz: (bldg?.originZ ?? 0) + z,
    floorCode: fl?.code ?? 'FL',
    buildingCode: bldg?.code ?? 'BLDG',
  };
}

function finalizeMetrics(params: {
  distanceMeters: number;
  mediaLabel: string;
  speedGbps: number;
  switchingUs: number;
  utilizationPct?: number;
  crcErrors?: number;
  opticalRxDbm?: number;
  isDown?: boolean;
  isDegraded?: boolean;
  hops: number;
  pathSummary: string;
}): PhysicalCableMetrics {
  const dist = Math.max(0.5, Number(params.distanceMeters.toFixed(1)));
  const propNsPerM = getMediaPropagationNsPerMeter(params.mediaLabel);
  const propagationUs = Number(((dist * propNsPerM) / 1000).toFixed(2));
  const serializationUs = getSerializationUs(params.speedGbps);
  const switchingUs = Number(params.switchingUs.toFixed(1));

  // Queueing + CRC retransmission + low-optical-power jitter model
  const util = Math.max(0, Math.min(100, params.utilizationPct ?? 24));
  const utilJitterUs = util > 80 ? (util - 80) * 14 : util > 50 ? (util - 50) * 2.2 : util * 0.35;
  const crcJitterUs = (params.crcErrors ?? 0) > 0 ? Math.min(4500, (params.crcErrors ?? 0) * 22 + 180) : 0;
  const opticalPenaltyUs =
    params.opticalRxDbm !== undefined && params.opticalRxDbm < -9.5 ? 650 : 0;
  const degradedPenaltyUs = params.isDegraded ? 950 : 0;

  const jitterUs = Number((utilJitterUs + crcJitterUs + opticalPenaltyUs + degradedPenaltyUs).toFixed(1));
  const oneWayUs = Number((propagationUs + serializationUs + switchingUs + jitterUs).toFixed(2));
  const oneWayMs = Number((oneWayUs / 1000).toFixed(3));
  const rttMs = Number((oneWayMs * 2).toFixed(3));

  let grade: LatencyGrade = 'optimal';
  if (params.isDown) {
    grade = 'down';
  } else if (params.isDegraded || rttMs > 2.5 || (params.crcErrors ?? 0) > 5) {
    grade = 'elevated';
  } else if (rttMs > 0.35) {
    grade = 'nominal';
  }

  return {
    distanceMeters: dist,
    mediaLabel: params.mediaLabel,
    speedGbps: params.speedGbps,
    propagationUs,
    serializationUs,
    switchingUs,
    jitterUs,
    oneWayUs,
    oneWayMs,
    rttMs,
    hops: params.hops,
    grade,
    pathSummary: params.pathSummary,
    shortLatencyLabel: formatLatencyLabel(rttMs, params.isDown),
  };
}

/** Estimate physical cable length & latency for an intra-rack port-to-port patch cable */
export function estimateIntraRackCableMetrics(
  rack: SpatialAsset,
  cable: Pick<RackPatchCable, 'fromDeviceId' | 'fromPortId' | 'toDeviceId' | 'toPortId' | 'media'>
): PhysicalCableMetrics {
  const devices = rack.rackConfig?.devices ?? [];
  const fromDev = devices.find((d) => d.id === cable.fromDeviceId);
  const toDev = devices.find((d) => d.id === cable.toDeviceId);
  const fromPort = fromDev?.ports.find((p) => p.id === cable.fromPortId);
  const toPort = toDev?.ports.find((p) => p.id === cable.toPortId);

  // 1U = 44.45mm vertical pitch + horizontal vertical-cable-manager routing slack (~0.8m)
  const uDelta = Math.abs((fromDev?.uStart ?? 20) - (toDev?.uStart ?? 20));
  const distanceMeters = Math.max(0.6, uDelta * 0.0445 + 0.85);
  const speedGbps = Math.min(fromPort?.speedGbps ?? 10, toPort?.speedGbps ?? 10) || 1;
  const crcErrors = (fromPort?.crcErrors ?? 0) + (toPort?.crcErrors ?? 0);
  const utilizationPct = Math.max(fromPort?.utilizationPct ?? 18, toPort?.utilizationPct ?? 18);
  const isDown =
    fromDev?.status === 'offline' ||
    toDev?.status === 'offline' ||
    fromPort?.status === 'down' ||
    toPort?.status === 'down';
  const isDegraded =
    fromPort?.status === 'error' || toPort?.status === 'error' || crcErrors > 0;

  return finalizeMetrics({
    distanceMeters,
    mediaLabel: cable.media,
    speedGbps,
    switchingUs: (getDeviceSwitchingUs(fromDev) + getDeviceSwitchingUs(toDev)) * 0.5,
    utilizationPct,
    crcErrors,
    opticalRxDbm: fromPort?.opticalDbm ?? toPort?.opticalDbm,
    isDown,
    isDegraded,
    hops: 1,
    pathSummary: `${rack.assetId} · U${fromDev?.uStart ?? '?'} [${fromPort?.label ?? '?'}] → Vertical Manager → U${toDev?.uStart ?? '?'} [${toPort?.label ?? '?'}]`,
  });
}

/** Estimate physical cable length & latency for an inter-rack fiber/copper trunk */
export function estimateInterRackCableMetrics(
  link: NetworkInterRackLink,
  racks: SpatialAsset[],
  floors: Floor[],
  buildings: Building[]
): PhysicalCableMetrics {
  const fromRack = racks.find((r) => r.id === link.fromRackId);
  const toRack = racks.find((r) => r.id === link.toRackId);
  const fromDev = fromRack?.rackConfig?.devices.find((d) => d.id === link.fromDeviceId);
  const toDev = toRack?.rackConfig?.devices.find((d) => d.id === link.toDeviceId);
  const fromPort = fromDev?.ports.find((p) => p.id === link.fromPortId);
  const toPort = toDev?.ports.find((p) => p.id === link.toPortId);

  let distanceMeters = 28;
  let pathSummary = link.label;

  if (fromRack && toRack) {
    const p1 = getWorldPoint(fromRack.floorId, fromRack.x, fromRack.z, floors, buildings);
    const p2 = getWorldPoint(toRack.floorId, toRack.x, toRack.z, floors, buildings);
    // Manhattan overhead cable tray routing + vertical drops into both cabinets (3.6m per cabinet)
    const manhattanHoriz = Math.abs(p2.wx - p1.wx) + Math.abs(p2.wz - p1.wz);
    const verticalRiser = Math.abs(p2.wy - p1.wy) + 4.4;
    distanceMeters = Math.max(3.0, manhattanHoriz + verticalRiser);
    pathSummary = `${fromRack.assetId} (${p1.floorCode}) [${fromPort?.label ?? 'SFP+'}] → Overhead Tray (${distanceMeters.toFixed(0)}m) → ${toRack.assetId} (${p2.floorCode}) [${toPort?.label ?? 'SFP+'}]`;
  }

  const isDown =
    link.status === 'down' ||
    fromDev?.status === 'offline' ||
    toDev?.status === 'offline' ||
    fromPort?.status === 'down' ||
    toPort?.status === 'down';
  const isDegraded =
    link.status === 'degraded' ||
    fromPort?.status === 'error' ||
    toPort?.status === 'error' ||
    link.crcErrors > 0;

  return finalizeMetrics({
    distanceMeters,
    mediaLabel: link.media,
    speedGbps: link.speedGbps,
    switchingUs: getDeviceSwitchingUs(fromDev) + getDeviceSwitchingUs(toDev),
    utilizationPct: link.utilizationPct,
    crcErrors: link.crcErrors + (fromPort?.crcErrors ?? 0) + (toPort?.crcErrors ?? 0),
    opticalRxDbm: link.opticalRxDbm,
    isDown,
    isDegraded,
    hops: fromRack?.floorId !== toRack?.floorId ? 2 : 1,
    pathSummary,
  });
}

/** Estimate physical cable length & latency for an IT User Node wall-jack drop */
export function estimateUserDropMetrics(
  node: NetworkUserNode,
  racks: SpatialAsset[],
  floors: Floor[],
  buildings: Building[]
): PhysicalCableMetrics {
  const rack = racks.find((r) => r.id === node.connectedRackId);
  const dev = rack?.rackConfig?.devices.find((d) => d.id === node.connectedDeviceId);
  const port = dev?.ports.find((p) => p.id === node.connectedPortId);

  let distanceMeters = 18;
  let pathSummary = `${node.wallJackId} → ${rack?.assetId ?? 'IDF'}`;

  if (rack) {
    const p1 = getWorldPoint(node.floorId, node.x, node.z, floors, buildings);
    const p2 = getWorldPoint(rack.floorId, rack.x, rack.z, floors, buildings);
    const manhattanHoriz = Math.abs(p2.wx - p1.wx) + Math.abs(p2.wz - p1.wz);
    const verticalDrop = Math.abs(p2.wy - p1.wy) + 4.8; // wall jack rise + IDF rack drop
    distanceMeters = Math.max(4.5, manhattanHoriz + verticalDrop);
    pathSummary = `${node.code} (${node.wallJackId}) → Ceiling Tray (${distanceMeters.toFixed(0)}m) → ${rack.assetId} [${port?.label ?? 'Access'}]`;
  }

  const speedGbps = port?.speedGbps ?? (node.media.includes('Fiber') ? 10 : 1);
  const isDown = node.status === 'offline' || dev?.status === 'offline' || port?.status === 'down';
  const isDegraded =
    node.status === 'error' ||
    node.status === 'degraded' ||
    port?.status === 'error' ||
    node.crcErrors > 0;

  return finalizeMetrics({
    distanceMeters,
    mediaLabel: node.media,
    speedGbps,
    switchingUs: getDeviceSwitchingUs(dev) + 18, // endpoint NIC stack
    utilizationPct: Math.min(100, Math.round((node.bandwidthMbps / (speedGbps * 1000)) * 100)),
    crcErrors: node.crcErrors + (port?.crcErrors ?? 0),
    isDown,
    isDegraded,
    hops: 1,
    pathSummary,
  });
}

/** Estimate preview metrics between ANY two arbitrary endpoints before patching */
export function estimatePreviewConnectionMetrics(params: {
  fromRack: SpatialAsset;
  fromDevice: RackDevice;
  fromPort?: RackPort;
  toRack?: SpatialAsset;
  toDevice?: RackDevice;
  toPort?: RackPort;
  toUserNode?: NetworkUserNode;
  media: string;
  floors: Floor[];
  buildings: Building[];
}): PhysicalCableMetrics {
  const { fromRack, fromDevice, fromPort, toRack, toDevice, toPort, toUserNode, media, floors, buildings } = params;

  if (toUserNode) {
    const p1 = getWorldPoint(fromRack.floorId, fromRack.x, fromRack.z, floors, buildings);
    const p2 = getWorldPoint(toUserNode.floorId, toUserNode.x, toUserNode.z, floors, buildings);
    const dist = Math.max(4.5, Math.abs(p2.wx - p1.wx) + Math.abs(p2.wz - p1.wz) + Math.abs(p2.wy - p1.wy) + 4.8);
    const speedGbps = fromPort?.speedGbps ?? 1;
    return finalizeMetrics({
      distanceMeters: dist,
      mediaLabel: media,
      speedGbps,
      switchingUs: getDeviceSwitchingUs(fromDevice) + 18,
      hops: 1,
      pathSummary: `${fromRack.assetId}[${fromPort?.label ?? 'Port'}] → ${toUserNode.code} (${dist.toFixed(0)}m)`,
    });
  }

  if (toRack && toRack.id === fromRack.id) {
    const uDelta = Math.abs(fromDevice.uStart - (toDevice?.uStart ?? fromDevice.uStart));
    const dist = Math.max(0.6, uDelta * 0.0445 + 0.85);
    const speedGbps = Math.min(fromPort?.speedGbps ?? 10, toPort?.speedGbps ?? 10) || 1;
    return finalizeMetrics({
      distanceMeters: dist,
      mediaLabel: media,
      speedGbps,
      switchingUs: (getDeviceSwitchingUs(fromDevice) + getDeviceSwitchingUs(toDevice)) * 0.5,
      hops: 1,
      pathSummary: `Intra-Rack ${fromRack.assetId} · U${fromDevice.uStart} → U${toDevice?.uStart ?? '?'} (${dist.toFixed(1)}m)`,
    });
  }

  if (toRack) {
    const p1 = getWorldPoint(fromRack.floorId, fromRack.x, fromRack.z, floors, buildings);
    const p2 = getWorldPoint(toRack.floorId, toRack.x, toRack.z, floors, buildings);
    const dist = Math.max(3.0, Math.abs(p2.wx - p1.wx) + Math.abs(p2.wz - p1.wz) + Math.abs(p2.wy - p1.wy) + 4.4);
    const speedGbps = Math.min(fromPort?.speedGbps ?? 10, toPort?.speedGbps ?? 10) || 10;
    return finalizeMetrics({
      distanceMeters: dist,
      mediaLabel: media,
      speedGbps,
      switchingUs: getDeviceSwitchingUs(fromDevice) + getDeviceSwitchingUs(toDevice),
      hops: fromRack.floorId !== toRack.floorId ? 2 : 1,
      pathSummary: `${fromRack.assetId} (${p1.floorCode}) → ${toRack.assetId} (${p2.floorCode}) (${dist.toFixed(0)}m)`,
    });
  }

  return finalizeMetrics({
    distanceMeters: 1.5,
    mediaLabel: media,
    speedGbps: fromPort?.speedGbps ?? 1,
    switchingUs: getDeviceSwitchingUs(fromDevice),
    hops: 1,
    pathSummary: `${fromRack.assetId} [${fromPort?.label ?? 'Port'}]`,
  });
}
