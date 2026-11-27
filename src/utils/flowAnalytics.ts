import type { FlowRoute, Room } from '../types/twin';

export interface FlowRoomStep {
  stepOrder: number;
  roomId: string;
  roomCode: string;
  roomName: string;
  cleanroomGrade: Room['environmental']['cleanroomGrade'];
  category: Room['category'];
  areaSqm: number;
  areaSqft: number;
  pressurePa: number;
  temperatureC: number;
  humidityPct: number;
  segmentDistanceM: number;
  entryDistanceM: number;
  exitDistanceM: number;
  centerX: number;
  centerZ: number;
  pressureDeltaFromPrevPa: number | null;
  revisit: boolean;
}

export interface FlowAnalyticsResult {
  flow: FlowRoute;
  totalLengthM: number;
  estimatedTransitSeconds: number;
  steps: FlowRoomStep[];
  uniqueRoomIds: string[];
  totalTraversedAreaSqm: number;
  totalTraversedAreaSqft: number;
  pressureWarnings: string[];
}

const SQM_TO_SQFT = 10.7639;

function findRoomAtPoint(x: number, z: number, rooms: Room[]): Room | null {
  // Prefer exact interior hit first
  for (const r of rooms) {
    if (x >= r.x && x <= r.x + r.width && z >= r.z && z <= r.z + r.depth) {
      return r;
    }
  }
  // Small 0.25m tolerance for points lying directly on shared partition walls
  let best: Room | null = null;
  let bestDist = 0.28;
  for (const r of rooms) {
    const cx = Math.max(r.x, Math.min(x, r.x + r.width));
    const cz = Math.max(r.z, Math.min(z, r.z + r.depth));
    const d = Math.hypot(x - cx, z - cz);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  return best;
}

/**
 * Computes the exact ordered room sequence traversed by a flow route by sampling
 * along every polyline segment in 0.22m increments.
 */
export function computeFlowRoomSequence(flow: FlowRoute, allRooms: Room[]): FlowAnalyticsResult {
  const floorRooms = allRooms.filter((r) => r.floorId === flow.floorId);
  const pts = flow.points ?? [];
  if (pts.length < 2) {
    return {
      flow,
      totalLengthM: 0,
      estimatedTransitSeconds: 0,
      steps: [],
      uniqueRoomIds: [],
      totalTraversedAreaSqm: 0,
      totalTraversedAreaSqft: 0,
      pressureWarnings: [],
    };
  }

  let totalLengthM = 0;
  const rawSteps: {
    room: Room;
    entryDistanceM: number;
    exitDistanceM: number;
    segmentDistanceM: number;
  }[] = [];

  let currentStep: (typeof rawSteps)[number] | null = null;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen < 0.001) continue;

    const samples = Math.max(2, Math.ceil(segLen / 0.22));
    const stepLen = segLen / samples;

    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      const distAtSample = totalLengthM + segLen * t;
      const room = findRoomAtPoint(px, pz, floorRooms);

      if (room) {
        if (!currentStep || currentStep.room.id !== room.id) {
          currentStep = {
            room,
            entryDistanceM: distAtSample,
            exitDistanceM: distAtSample + (s < samples ? stepLen : 0),
            segmentDistanceM: s < samples ? stepLen : 0,
          };
          rawSteps.push(currentStep);
        } else {
          currentStep.exitDistanceM = distAtSample;
          if (s < samples) {
            currentStep.segmentDistanceM += stepLen;
          }
        }
      }
    }

    totalLengthM += segLen;
  }

  const seenIds = new Set<string>();
  const steps: FlowRoomStep[] = [];
  const pressureWarnings: string[] = [];

  for (let i = 0; i < rawSteps.length; i++) {
    const item = rawSteps[i];
    const r = item.room;
    const areaSqm = Number((r.width * r.depth).toFixed(1));
    const areaSqft = Number((areaSqm * SQM_TO_SQFT).toFixed(0));
    const prev = i > 0 ? rawSteps[i - 1].room : null;
    const pressureDelta = prev ? r.environmental.pressurePa - prev.environmental.pressurePa : null;
    const revisit = seenIds.has(r.id);
    seenIds.add(r.id);

    if (prev && flow.flowType === 'waste' && r.environmental.pressurePa > prev.environmental.pressurePa + 10) {
      pressureWarnings.push(
        `Waste flow moves from lower pressure (${prev.code}: ${prev.environmental.pressurePa} Pa) into higher-grade positive zone (${r.code}: ${r.environmental.pressurePa} Pa).`
      );
    }
    if (
      prev &&
      (flow.flowType === 'personnel' || flow.flowType === 'material') &&
      Math.abs(r.environmental.pressurePa - prev.environmental.pressurePa) >= 25
    ) {
      pressureWarnings.push(
        `Large pressure step (${prev.environmental.pressurePa} Pa -> ${r.environmental.pressurePa} Pa) between ${prev.code} and ${r.code}; verify airlock interlock.`
      );
    }

    steps.push({
      stepOrder: i + 1,
      roomId: r.id,
      roomCode: r.code || `RM-${String(i + 1).padStart(2, '0')}`,
      roomName: r.name,
      cleanroomGrade: r.environmental.cleanroomGrade,
      category: r.category,
      areaSqm,
      areaSqft,
      pressurePa: r.environmental.pressurePa,
      temperatureC: r.environmental.temperatureC,
      humidityPct: r.environmental.humidityPct,
      segmentDistanceM: Number(Math.max(0.2, item.segmentDistanceM).toFixed(1)),
      entryDistanceM: Number(item.entryDistanceM.toFixed(1)),
      exitDistanceM: Number(item.exitDistanceM.toFixed(1)),
      centerX: Number((r.x + r.width / 2).toFixed(2)),
      centerZ: Number((r.z + r.depth / 2).toFixed(2)),
      pressureDeltaFromPrevPa: pressureDelta,
      revisit,
    });
  }

  const uniqueRoomIds = Array.from(seenIds);
  const totalTraversedAreaSqm = Number(
    uniqueRoomIds
      .reduce((acc, rid) => {
        const rm = floorRooms.find((r) => r.id === rid);
        return acc + (rm ? rm.width * rm.depth : 0);
      }, 0)
      .toFixed(1)
  );
  const totalTraversedAreaSqft = Math.round(totalTraversedAreaSqm * SQM_TO_SQFT);

  // Typical walking/material transit speed in cleanrooms ~ 0.95 m/s (+ airlock transitions)
  const speedMps =
    flow.flowType === 'evacuation'
      ? 1.5
      : flow.flowType === 'airflow'
        ? 0.45
        : flow.flowType === 'material'
          ? 0.75
          : 1.05;
  const estimatedTransitSeconds = Math.round(totalLengthM / speedMps + Math.max(0, steps.length - 1) * 4);

  return {
    flow,
    totalLengthM: Number(totalLengthM.toFixed(1)),
    estimatedTransitSeconds,
    steps,
    uniqueRoomIds,
    totalTraversedAreaSqm,
    totalTraversedAreaSqft,
    pressureWarnings,
  };
}
