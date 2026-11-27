import type {
  AnalyticsMetric,
  DigitalTwinScene,
  Room,
  SpatialAsset,
  UnitSystem,
  ValidationIssue,
} from '../types/twin';

const M_TO_FT = 3.28084;
const SQM_TO_SQFT = 10.7639;

export function formatLength(meters: number, unit: UnitSystem, decimals = 2): string {
  if (unit === 'imperial') {
    return `${(meters * M_TO_FT).toFixed(decimals)} ft`;
  }
  return `${meters.toFixed(decimals)} m`;
}

export function formatArea(sqm: number, unit: UnitSystem): string {
  if (unit === 'imperial') {
    return `${Math.round(sqm * SQM_TO_SQFT).toLocaleString()} ft²`;
  }
  return `${sqm.toFixed(1)} m²`;
}

export function formatVolume(cubicMeters: number, unit: UnitSystem): string {
  if (unit === 'imperial') {
    return `${Math.round(cubicMeters * 35.3147).toLocaleString()} ft³`;
  }
  return `${cubicMeters.toFixed(0)} m³`;
}

export function formatCurrency(usd: number): string {
  if (usd >= 1_000_000) {
    return `$${(usd / 1_000_000).toFixed(2)}M`;
  }
  if (usd >= 1_000) {
    return `$${Math.round(usd / 1_000).toLocaleString()}k`;
  }
  return `$${usd.toLocaleString()}`;
}

export function snapValue(val: number, gridSize: number, enabled: boolean): number {
  if (!enabled || gridSize <= 0) return Number(val.toFixed(3));
  return Number((Math.round(val / gridSize) * gridSize).toFixed(3));
}

export function getRoomColorForAnalytics(room: Room, metric: AnalyticsMetric): string {
  switch (metric) {
    case 'none':
    case 'space-type':
      return room.color;
    case 'cleanroom-grade':
      switch (room.environmental.cleanroomGrade) {
        case 'Grade A / ISO 5':
          return '#06B6D4';
        case 'Grade B / ISO 6':
          return '#0284C7';
        case 'Grade C / ISO 7':
          return '#2563EB';
        case 'Grade D / ISO 8':
          return '#4F46E5';
        case 'CNC (Controlled)':
          return '#10B981';
        default:
          return '#64748B';
      }
    case 'pressure-cascade': {
      const p = room.environmental.pressurePa;
      if (p >= 40) return '#06B6D4';
      if (p >= 25) return '#2563EB';
      if (p >= 10) return '#3B82F6';
      if (p > 0) return '#10B981';
      if (p < 0) return '#DC2626';
      return '#64748B';
    }
    case 'temperature': {
      const t = room.environmental.temperatureC;
      if (t <= 8) return '#0284C7';
      if (t <= 20) return '#10B981';
      if (t <= 23) return '#F59E0B';
      return '#DC2626';
    }
    case 'utilization':
      if (room.utilizationPct >= 85) return '#DC2626';
      if (room.utilizationPct >= 70) return '#D97706';
      if (room.utilizationPct >= 45) return '#16A34A';
      return '#64748B';
    case 'compliance':
      if (room.complianceStatus === 'deviation') return '#DC2626';
      if (room.complianceStatus === 'review-due') return '#D97706';
      return '#16A34A';
    case 'risk':
      if (room.riskLevel === 'critical') return '#DC2626';
      if (room.riskLevel === 'high') return '#EA580C';
      if (room.riskLevel === 'medium') return '#D97706';
      return '#16A34A';
    case 'cost': {
      const total = room.width * room.depth * room.costPerSqm;
      if (total >= 450000) return '#7C3AED';
      if (total >= 250000) return '#2563EB';
      if (total >= 120000) return '#0EA5E9';
      return '#64748B';
    }
    case 'energy':
      if (room.energyKw >= 30) return '#DC2626';
      if (room.energyKw >= 18) return '#D97706';
      return '#16A34A';
    case 'maintenance':
      return room.complianceStatus === 'review-due' ? '#D97706' : '#16A34A';
    default:
      return room.color;
  }
}

export function getAnalyticsLegend(metric: AnalyticsMetric): { label: string; color: string }[] {
  switch (metric) {
    case 'cleanroom-grade':
      return [
        { label: 'Grade A / ISO 5', color: '#06B6D4' },
        { label: 'Grade B / ISO 6', color: '#0284C7' },
        { label: 'Grade C / ISO 7', color: '#2563EB' },
        { label: 'Grade D / ISO 8', color: '#4F46E5' },
        { label: 'CNC Controlled', color: '#10B981' },
        { label: 'Unclassified', color: '#64748B' },
      ];
    case 'pressure-cascade':
      return [
        { label: '≥ +40 Pa (Aseptic Core)', color: '#06B6D4' },
        { label: '+25 to +39 Pa', color: '#2563EB' },
        { label: '+10 to +24 Pa', color: '#3B82F6' },
        { label: '+1 to +9 Pa', color: '#10B981' },
        { label: '0 Pa (Neutral)', color: '#64748B' },
        { label: 'Negative Containment', color: '#DC2626' },
      ];
    case 'temperature':
      return [
        { label: 'Cold Chain (≤ 8 °C)', color: '#0284C7' },
        { label: 'GMP Controlled (19–20 °C)', color: '#10B981' },
        { label: 'Ambient (21–23 °C)', color: '#F59E0B' },
        { label: 'Utility / Warm (> 23 °C)', color: '#DC2626' },
      ];
    case 'utilization':
      return [
        { label: 'High Load (≥ 85%)', color: '#DC2626' },
        { label: 'Optimal (70–84%)', color: '#D97706' },
        { label: 'Balanced (45–69%)', color: '#16A34A' },
        { label: 'Underutilized (< 45%)', color: '#64748B' },
      ];
    case 'compliance':
      return [
        { label: 'GMP Compliant', color: '#16A34A' },
        { label: 'Audit / Review Due', color: '#D97706' },
        { label: 'Active Deviation', color: '#DC2626' },
      ];
    case 'risk':
      return [
        { label: 'Critical Risk', color: '#DC2626' },
        { label: 'High Risk', color: '#EA580C' },
        { label: 'Medium Risk', color: '#D97706' },
        { label: 'Low Risk', color: '#16A34A' },
      ];
    case 'cost':
      return [
        { label: '≥ $450k Suite Value', color: '#7C3AED' },
        { label: '$250k – $449k', color: '#2563EB' },
        { label: '$120k – $249k', color: '#0EA5E9' },
        { label: '< $120k', color: '#64748B' },
      ];
    case 'energy':
      return [
        { label: '≥ 30 kW High Draw', color: '#DC2626' },
        { label: '18 – 29 kW Medium', color: '#D97706' },
        { label: '< 18 kW Efficient', color: '#16A34A' },
      ];
    case 'maintenance':
      return [
        { label: 'Maintenance Due', color: '#D97706' },
        { label: 'Nominal Service', color: '#16A34A' },
      ];
    default:
      return [
        { label: 'Pharma Mfg', color: '#2563EB' },
        { label: 'Cleanrooms', color: '#06B6D4' },
        { label: 'QC Labs', color: '#10B981' },
        { label: 'Warehouse', color: '#F59E0B' },
        { label: 'Utilities', color: '#64748B' },
        { label: 'Offices', color: '#8B5CF6' },
      ];
  }
}

export function getAssetBounds(asset: SpatialAsset) {
  const rot = Math.abs(Math.round((asset.rotationY * 180) / Math.PI)) % 180;
  const swap = rot >= 45 && rot <= 135;
  const w = swap ? asset.depth : asset.width;
  const d = swap ? asset.width : asset.depth;
  return {
    minX: asset.x - w / 2,
    maxX: asset.x + w / 2,
    minZ: asset.z - d / 2,
    maxZ: asset.z + d / 2,
  };
}

export function runSpatialValidation(scene: DigitalTwinScene): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const floor of scene.floors) {
    const floorRooms = scene.rooms.filter((r) => r.floorId === floor.id);
    const floorAssets = scene.assets.filter((a) => a.floorId === floor.id && !a.hidden);

    // 1. Overlapping rooms check
    for (let i = 0; i < floorRooms.length; i++) {
      for (let j = i + 1; j < floorRooms.length; j++) {
        const a = floorRooms[i];
        const b = floorRooms[j];
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapZ = Math.min(a.z + a.depth, b.z + b.depth) - Math.max(a.z, b.z);
        if (overlapX > 0.15 && overlapZ > 0.15) {
          issues.push({
            id: `val-rm-ov-${a.id}-${b.id}`,
            severity: 'error',
            code: 'SPACE-OVL',
            title: `Overlapping rooms: ${a.name} & ${b.name}`,
            description: `Room footprints intersect by ${(overlapX * overlapZ).toFixed(1)} m² on ${floor.code}.`,
            floorId: floor.id,
            entityIds: [a.id, b.id],
            entityType: 'room',
            focusPoint: [(a.x + b.x) / 2, 1.5, (a.z + b.z) / 2],
          });
        }
      }
    }

    // 2. Asset-to-asset collision & insufficient maintenance clearance
    for (let i = 0; i < floorAssets.length; i++) {
      const a = floorAssets[i];
      const ba = getAssetBounds(a);

      // Out of slab boundary check
      if (ba.minX < 0 || ba.minZ < 0 || ba.maxX > floor.width || ba.maxZ > floor.depth) {
        issues.push({
          id: `val-oob-${a.id}`,
          severity: 'error',
          code: 'BOUNDS-OUT',
          title: `${a.name} extends outside floor slab`,
          description: `Asset ${a.assetId} is positioned outside the ${floor.width}×${floor.depth}m slab boundary.`,
          floorId: floor.id,
          entityIds: [a.id],
          entityType: 'asset',
          focusPoint: [a.x, 1.2, a.z],
        });
      }

      // Check if asset is inside any room
      const hostRoom = floorRooms.find(
        (r) => a.x >= r.x && a.x <= r.x + r.width && a.z >= r.z && a.z <= r.z + r.depth
      );
      if (!hostRoom && floorRooms.length > 0) {
        issues.push({
          id: `val-unassigned-${a.id}`,
          severity: 'warning',
          code: 'ROOM-UNASSIGNED',
          title: `${a.name} is outside assigned room boundaries`,
          description: `Move ${a.assetId} inside a defined space or expand the target room.`,
          floorId: floor.id,
          entityIds: [a.id],
          entityType: 'asset',
          focusPoint: [a.x, 1.2, a.z],
        });
      } else if (hostRoom) {
        // Wall overlap check
        if (
          ba.minX < hostRoom.x + 0.08 ||
          ba.maxX > hostRoom.x + hostRoom.width - 0.08 ||
          ba.minZ < hostRoom.z + 0.08 ||
          ba.maxZ > hostRoom.z + hostRoom.depth - 0.08
        ) {
          issues.push({
            id: `val-wall-ov-${a.id}`,
            severity: 'warning',
            code: 'WALL-CLASH',
            title: `${a.name} encroaches on room wall`,
            description: `Footprint of ${a.assetId} is within 8 cm of ${hostRoom.name} perimeter wall.`,
            floorId: floor.id,
            entityIds: [a.id],
            entityType: 'asset',
            focusPoint: [a.x, 1.2, a.z],
          });
        }
      }

      // Maintenance due alert
      if (a.operationalStatus === 'maintenance-due') {
        issues.push({
          id: `val-pm-${a.id}`,
          severity: 'info',
          code: 'GMP-PM-DUE',
          title: `Preventive maintenance due: ${a.name}`,
          description: `Next scheduled calibration / PM on ${a.nextMaintenance} (${a.maintenanceSchedule}).`,
          floorId: floor.id,
          entityIds: [a.id],
          entityType: 'asset',
          focusPoint: [a.x, 1.2, a.z],
        });
      }

      for (let j = i + 1; j < floorAssets.length; j++) {
        const b = floorAssets[j];
        const bb = getAssetBounds(b);
        const dx = Math.max(0, Math.max(ba.minX - bb.maxX, bb.minX - ba.maxX));
        const dz = Math.max(0, Math.max(ba.minZ - bb.maxZ, bb.minZ - ba.maxZ));
        const dist = Math.hypot(dx, dz);

        if (dx === 0 && dz === 0) {
          issues.push({
            id: `val-col-${a.id}-${b.id}`,
            severity: 'critical',
            code: 'ASSET-CLASH',
            title: `Equipment collision: ${a.assetId} & ${b.assetId}`,
            description: `${a.name} physically overlaps ${b.name}. Reposition to resolve clash.`,
            floorId: floor.id,
            entityIds: [a.id, b.id],
            entityType: 'asset',
            focusPoint: [(a.x + b.x) / 2, 1.2, (a.z + b.z) / 2],
          });
        } else if (dist < Math.min(a.clearanceM, b.clearanceM) * 0.45 && a.roomId === b.roomId) {
          issues.push({
            id: `val-clr-${a.id}-${b.id}`,
            severity: 'warning',
            code: 'CLEARANCE-LOW',
            title: `Tight maintenance clearance (${dist.toFixed(2)} m)`,
            description: `${a.assetId} and ${b.assetId} have less than recommended service clearance.`,
            floorId: floor.id,
            entityIds: [a.id, b.id],
            entityType: 'asset',
            focusPoint: [(a.x + b.x) / 2, 1.2, (a.z + b.z) / 2],
          });
        }
      }
    }

    // 3. Flow cross-contamination check (clean vs dirty intersection)
    const floorFlows = scene.flows.filter((f) => f.floorId === floor.id);
    const cleanFlows = floorFlows.filter((f) => f.cleanlinessClass === 'clean');
    const dirtyFlows = floorFlows.filter((f) => f.cleanlinessClass === 'dirty');
    for (const cf of cleanFlows) {
      for (const df of dirtyFlows) {
        if (flowsIntersect(cf.points, df.points)) {
          issues.push({
            id: `val-flow-${cf.id}-${df.id}`,
            severity: 'error',
            code: 'GMP-FLOW-X',
            title: `Clean/Dirty Flow Intersection`,
            description: `${cf.name} crosses ${df.name}. Separate paths or route through dedicated airlock.`,
            floorId: floor.id,
            entityIds: [cf.id, df.id],
            entityType: 'flow',
            focusPoint: [df.points[0]?.x ?? 10, 1.5, df.points[0]?.z ?? 10],
            autoFixHint: 'Reroute dirty/waste flow around perimeter corridor',
          });
        }
      }
    }

    // 4. Cleanroom Pressure Cascade & Room Egress Door Checks
    const floorWalls = scene.walls.filter((w) => w.floorId === floor.id);
    const floorOpenings = scene.openings.filter((o) => o.floorId === floor.id && o.kind === 'door');
    const gradeMinPa: Record<string, number> = {
      'Grade A / ISO 5': 40,
      'Grade B / ISO 6': 30,
      'Grade C / ISO 7': 15,
      'Grade D / ISO 8': 5,
    };

    for (const rm of floorRooms) {
      const expectedPa = gradeMinPa[rm.environmental.cleanroomGrade];
      if (expectedPa !== undefined && rm.environmental.pressurePa < expectedPa) {
        issues.push({
          id: `val-pa-${rm.id}`,
          severity: 'error',
          code: 'GMP-PRESSURE-CASCADE',
          title: `Pressure cascade deficit in ${rm.name}`,
          description: `${rm.environmental.cleanroomGrade} requires ≥ +${expectedPa} Pa, currently set to ${rm.environmental.pressurePa} Pa.`,
          floorId: floor.id,
          entityIds: [rm.id],
          entityType: 'room',
          focusPoint: [rm.x + rm.width / 2, 1.5, rm.z + rm.depth / 2],
          autoFixHint: `Raise pressure setpoint to +${expectedPa} Pa`,
        });
      }

      // Check enclosed room has at least one door on its walls
      const rmWallIds = new Set(floorWalls.filter((w) => w.roomId === rm.id).map((w) => w.id));
      const hasDoor = floorOpenings.some((op) => rmWallIds.has(op.wallId));
      const isCorridor = /corridor|spine|hall|dock/i.test(rm.name);
      if (rmWallIds.size >= 4 && !hasDoor && !isCorridor) {
        issues.push({
          id: `val-door-${rm.id}`,
          severity: 'warning',
          code: 'ROOM-NO-DOOR',
          title: `No egress/access door on ${rm.name}`,
          description: `Enclosed room ${rm.code} has 4 walls without a door opening for personnel/egress access.`,
          floorId: floor.id,
          entityIds: [rm.id],
          entityType: 'room',
          focusPoint: [rm.x + rm.width / 2, 1.5, rm.z + rm.depth],
          autoFixHint: 'Install 1.3m interlocked cleanroom door',
        });
      }
    }

    // 5. IT / Data Center Rack Power & U-Slot Integrity Checks
    for (const a of floorAssets) {
      if (a.rackConfig) {
        const totalW = a.rackConfig.devices.reduce((sum, d) => sum + (d.powerW || 0), 0);
        const totalKw = totalW / 1000;
        if (totalKw > a.rackConfig.maxPowerKw) {
          issues.push({
            id: `val-rack-pwr-${a.id}`,
            severity: 'critical',
            code: 'RACK-POWER-OVERLOAD',
            title: `Rack PDU Overload: ${a.name} (${totalKw.toFixed(1)} / ${a.rackConfig.maxPowerKw} kW)`,
            description: `Installed servers/switches exceed rated dual-bus PDU capacity on ${a.assetId}.`,
            floorId: floor.id,
            entityIds: [a.id],
            entityType: 'asset',
            focusPoint: [a.x, 1.2, a.z],
            autoFixHint: 'Upgrade rack PDU capacity & rebalance load',
          });
        }
        // Check U-slot overlaps
        const occupied = new Set<number>();
        let uCollision = false;
        for (const dev of a.rackConfig.devices) {
          for (let u = dev.uStart; u < dev.uStart + dev.uHeight; u++) {
            if (occupied.has(u) || u < 1 || u > a.rackConfig.totalUnits) {
              uCollision = true;
            }
            occupied.add(u);
          }
        }
        if (uCollision) {
          issues.push({
            id: `val-rack-u-${a.id}`,
            severity: 'error',
            code: 'RACK-U-COLLISION',
            title: `Rack U-Slot Collision on ${a.name}`,
            description: `Two or more network/server units overlap U-slots inside ${a.assetId}.`,
            floorId: floor.id,
            entityIds: [a.id],
            entityType: 'asset',
            focusPoint: [a.x, 1.2, a.z],
            autoFixHint: 'Auto-pack rack devices into non-overlapping U-slots',
          });
        }
      }
    }

    // 6. Security & Industrial Camera Configuration Checks
    const floorCameras = scene.cameras.filter((c) => c.floorId === floor.id);
    for (const cam of floorCameras) {
      if (cam.fov < 20 || cam.fov > 130) {
        issues.push({
          id: `val-cam-fov-${cam.id}`,
          severity: 'warning',
          code: 'CAM-INVALID-FOV',
          title: `Out-of-range camera FOV (${cam.fov}°): ${cam.name}`,
          description: `Camera FOV should be between 25° and 120° for accurate optical coverage cone.`,
          floorId: floor.id,
          entityIds: [cam.id],
          entityType: 'camera',
          focusPoint: cam.position,
          autoFixHint: 'Reset FOV to 68° wide industrial lens',
        });
      }
      if ((cam.kind === 'security' || cam.kind === 'fixed-industrial') && !cam.hasCredentials && !cam.ipAddress) {
        issues.push({
          id: `val-cam-auth-${cam.id}`,
          severity: 'info',
          code: 'CAM-NO-AUTH',
          title: `Unlinked IP CCTV stream: ${cam.name}`,
          description: `Configure IP/RTSP endpoint and Argon2id credentials to enable authenticated live feed.`,
          floorId: floor.id,
          entityIds: [cam.id],
          entityType: 'camera',
          focusPoint: cam.position,
          autoFixHint: 'Assign default RTSP stream profile',
        });
      }
    }
  }

  // 7. Duplicate Asset IDs
  const seenCodes = new Map<string, SpatialAsset>();
  for (const a of scene.assets) {
    if (seenCodes.has(a.assetId)) {
      issues.push({
        id: `val-dup-${a.id}`,
        severity: 'error',
        code: 'ASSET-DUP-ID',
        title: `Duplicate Asset ID: ${a.assetId}`,
        description: `Multiple equipment items share code ${a.assetId}. Assign a unique GMP asset tag.`,
        floorId: a.floorId,
        entityIds: [a.id, seenCodes.get(a.assetId)!.id],
        entityType: 'asset',
        focusPoint: [a.x, 1.2, a.z],
        autoFixHint: 'Append unique sequential asset tag suffix',
      });
    } else {
      seenCodes.set(a.assetId, a);
    }
  }

  // 8. GMP Room Compliance, Critical Contamination Risk & Qualification Notices
  for (const rm of scene.rooms) {
    if (rm.complianceStatus === 'deviation') {
      issues.push({
        id: `val-gmp-dev-${rm.id}`,
        severity: 'critical',
        code: 'GMP-ROOM-DEV',
        title: `Active GMP Deviation in ${rm.code} (${rm.name})`,
        description: `Room ${rm.code} is flagged in active deviation status. CAPA review & QA release required before batch start.`,
        floorId: rm.floorId,
        entityIds: [rm.id],
        entityType: 'room',
        focusPoint: [rm.x + rm.width / 2, 1.5, rm.z + rm.depth / 2],
        autoFixHint: 'Launch QA Deviation CAPA & verify room eligibility',
      });
    } else if (rm.complianceStatus === 'review-due') {
      issues.push({
        id: `val-gmp-rev-${rm.id}`,
        severity: 'warning',
        code: 'GMP-QUAL-REVIEW',
        title: `Qualification Review Due: ${rm.code} · ${rm.name}`,
        description: `Periodic EU GMP Annex 15 requalification & HEPA integrity review scheduled for ${rm.code}.`,
        floorId: rm.floorId,
        entityIds: [rm.id],
        entityType: 'room',
        focusPoint: [rm.x + rm.width / 2, 1.5, rm.z + rm.depth / 2],
        autoFixHint: 'Schedule requalification inspection work order',
      });
    } else if (rm.riskLevel === 'critical') {
      issues.push({
        id: `val-gmp-risk-${rm.id}`,
        severity: 'warning',
        code: 'ANNEX1-CONTAM-RISK',
        title: `Grade A/B Contamination Control Watch: ${rm.code}`,
        description: `${rm.name} is classified Critical Contamination Risk (${rm.environmental.cleanroomGrade}, +${rm.environmental.pressurePa} Pa). Verify continuous viable/non-viable monitoring.`,
        floorId: rm.floorId,
        entityIds: [rm.id],
        entityType: 'room',
        focusPoint: [rm.x + rm.width / 2, 1.5, rm.z + rm.depth / 2],
      });
    }
  }

  // 9. Equipment Commissioning & High-Utilization Risk Notices
  for (const a of scene.assets) {
    if (a.operationalStatus === 'commissioning') {
      issues.push({
        id: `val-comm-${a.id}`,
        severity: 'warning',
        code: 'GMP-IQ-OQ-OPEN',
        title: `Commissioning Pending PQ Sign-Off: ${a.assetId}`,
        description: `${a.name} is currently in commissioning phase. Complete PQ protocol before assigning to commercial batches.`,
        floorId: a.floorId,
        entityIds: [a.id],
        entityType: 'asset',
        focusPoint: [a.x, 1.2, a.z],
      });
    }
  }

  // 10. IT / OT Network Uplink Degradation & Switch Port CRC Alerts
  if (scene.networkArchitecture) {
    for (const node of scene.networkArchitecture.userNodes) {
      if (node.status === 'error' || node.status === 'degraded' || (node.crcErrors ?? 0) > 5) {
        issues.push({
          id: `val-net-node-${node.id}`,
          severity: node.status === 'error' ? 'error' : 'warning',
          code: 'OT-NET-PORT-ERR',
          title: `IT/OT Port CRC Burst on ${node.code} (${node.crcErrors} errors)`,
          description: node.notes || `${node.name} (${node.ipAddress}) experiencing packet loss (${node.packetLossPct}%) on wall jack ${node.wallJackId}.`,
          floorId: node.floorId,
          entityIds: [node.connectedRackId],
          entityType: 'asset',
          focusPoint: [node.x, 1.2, node.z],
          autoFixHint: 'Inspect RJ45/OM4 patch termination in Rack Designer',
        });
      }
    }
    for (const link of scene.networkArchitecture.interRackLinks) {
      if (link.status === 'degraded' || link.status === 'down') {
        const fromRack = scene.assets.find((a) => a.id === link.fromRackId);
        issues.push({
          id: `val-net-link-${link.id}`,
          severity: link.status === 'down' ? 'critical' : 'warning',
          code: 'OT-FIBER-DEGRADED',
          title: `Degraded Fiber Trunk: ${link.label}`,
          description: `Optical Rx ${link.opticalRxDbm} dBm · ${link.crcErrors} CRC errors (${link.speedGbps}G ${link.media}). Clean LC/MPO transceivers.`,
          floorId: fromRack?.floorId ?? scene.floors[0]?.id ?? 'fl-a0',
          entityIds: [link.fromRackId, link.toRackId],
          entityType: 'asset',
          focusPoint: fromRack ? [fromRack.x, 1.4, fromRack.z] : [10, 1.4, 10],
        });
      }
    }
  }

  return issues;
}

function ccw(A: { x: number; z: number }, B: { x: number; z: number }, C: { x: number; z: number }) {
  return (C.z - A.z) * (B.x - A.x) > (B.z - A.z) * (C.x - A.x);
}

function segmentsIntersect(
  A: { x: number; z: number },
  B: { x: number; z: number },
  C: { x: number; z: number },
  D: { x: number; z: number }
) {
  return ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D);
}

function flowsIntersect(p1: { x: number; z: number }[], p2: { x: number; z: number }[]) {
  for (let i = 0; i < p1.length - 1; i++) {
    for (let j = 0; j < p2.length - 1; j++) {
      if (segmentsIntersect(p1[i], p1[i + 1], p2[j], p2[j + 1])) return true;
    }
  }
  return false;
}

export function exportAssetsToCSV(scene: DigitalTwinScene): string {
  const headers = [
    'Asset ID',
    'Name',
    'Category',
    'Floor',
    'Room',
    'Manufacturer',
    'Model',
    'Status',
    'Criticality',
    'Width (m)',
    'Depth (m)',
    'Height (m)',
    'CapEx (USD)',
    'Annual OpEx (USD)',
    'Energy (kW)',
    'Next Maintenance',
    'Protocol',
    'PLC Tag',
  ];
  const rows = scene.assets.map((a) => {
    const fl = scene.floors.find((f) => f.id === a.floorId)?.code ?? a.floorId;
    const rm = scene.rooms.find((r) => r.id === a.roomId)?.name ?? 'Unassigned';
    return [
      a.assetId,
      `"${a.name.replace(/"/g, '""')}"`,
      `"${a.category}"`,
      fl,
      `"${rm.replace(/"/g, '""')}"`,
      `"${a.manufacturer}"`,
      `"${a.model}"`,
      a.operationalStatus,
      a.criticality,
      a.width,
      a.depth,
      a.height,
      a.capexUsd,
      a.annualOpexUsd,
      a.energyKw,
      a.nextMaintenance,
      a.connectivity.protocol,
      a.connectivity.plcTag,
    ].join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

export function exportRoomScheduleCSV(scene: DigitalTwinScene): string {
  const headers = [
    'Room Code',
    'Name',
    'Floor',
    'Category',
    'Cleanroom Grade',
    'Pressure (Pa)',
    'ACH',
    'Temp (C)',
    'RH (%)',
    'Area (m2)',
    'Volume (m3)',
    'Utilization (%)',
    'Compliance',
    'Estimated Value (USD)',
  ];
  const rows = scene.rooms.map((r) => {
    const fl = scene.floors.find((f) => f.id === r.floorId)?.code ?? r.floorId;
    const area = r.width * r.depth;
    return [
      r.code,
      `"${r.name.replace(/"/g, '""')}"`,
      fl,
      `"${r.category}"`,
      `"${r.environmental.cleanroomGrade}"`,
      r.environmental.pressurePa,
      r.environmental.airChangesPerHour,
      r.environmental.temperatureC,
      r.environmental.humidityPct,
      area.toFixed(1),
      (area * r.height).toFixed(1),
      r.utilizationPct,
      r.complianceStatus,
      Math.round(area * r.costPerSqm),
    ].join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

export function exportSceneToOBJ(scene: DigitalTwinScene, floorId: string): string {
  const lines: string[] = [`# Gradian Digital Twin Studio OBJ Export`, `# Project: ${scene.name}`];
  let vertexOffset = 1;

  const appendBox = (
    name: string,
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number
  ) => {
    lines.push(`o ${name.replace(/\s+/g, '_')}`);
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const y0 = cy, y1 = cy + h;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const verts = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    verts.forEach((v) => lines.push(`v ${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2].toFixed(3)}`));
    const faces = [
      [1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [5, 1, 4, 8],
    ];
    faces.forEach((f) => lines.push(`f ${f.map((idx) => idx + vertexOffset - 1).join(' ')}`));
    vertexOffset += 8;
  };

  scene.rooms
    .filter((r) => r.floorId === floorId)
    .forEach((r) => appendBox(`Room_${r.code}`, r.x + r.width / 2, 0, r.z + r.depth / 2, r.width, 0.12, r.depth));

  scene.assets
    .filter((a) => a.floorId === floorId)
    .forEach((a) => appendBox(`Asset_${a.assetId}`, a.x, a.y, a.z, a.width, a.height, a.depth));

  return lines.join('\n');
}

export function triggerFileDownload(filename: string, content: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
