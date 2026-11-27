import type {
  LightFixtureType,
  Opening,
  Room,
  RoomLightFixture,
  RoomLightSwitch,
  RoomLightingConfig,
  Wall,
} from '../types/twin';

export interface LightFixtureCatalogEntry {
  type: LightFixtureType;
  name: string;
  shortName: string;
  defaultKelvin: number;
  defaultIntensity: number;
  colorHex: string;
  emissiveHex: string;
  watts: number;
  description: string;
  /** True if fixture counts as primary room illumination (turning off all primary lights triggers dark room effect) */
  isPrimaryLight: boolean;
}

export const LIGHT_FIXTURE_CATALOG: LightFixtureCatalogEntry[] = [
  {
    type: 'led-troffer',
    name: 'Cleanroom LED Troffer (IP65)',
    shortName: 'LED Troffer',
    defaultKelvin: 5000,
    defaultIntensity: 1.4,
    colorHex: '#E0F2FE',
    emissiveHex: '#BAE6FD',
    watts: 42,
    description: 'Flush gasketed 1200×600mm GMP cleanroom ceiling panel.',
    isPrimaryLight: true,
  },
  {
    type: 'linear-vapor',
    name: 'Linear Vapor-Tight Strip',
    shortName: 'Vapor-Tight',
    defaultKelvin: 4500,
    defaultIntensity: 1.25,
    colorHex: '#F0F9FF',
    emissiveHex: '#7DD3FC',
    watts: 36,
    description: 'Sealed polycarbonate linear bar for cold rooms, corridors, and washdown zones.',
    isPrimaryLight: true,
  },
  {
    type: 'recessed-downlight',
    name: 'Architectural Recessed Downlight',
    shortName: 'Downlight',
    defaultKelvin: 3500,
    defaultIntensity: 1.15,
    colorHex: '#FEF3C7',
    emissiveHex: '#FDE68A',
    watts: 18,
    description: 'Warm-neutral circular recessed spot for labs, offices, and airlocks.',
    isPrimaryLight: true,
  },
  {
    type: 'high-bay',
    name: 'Industrial High-Bay Pendant',
    shortName: 'High-Bay',
    defaultKelvin: 5500,
    defaultIntensity: 1.85,
    colorHex: '#FFFFFF',
    emissiveHex: '#E0F2FE',
    watts: 150,
    description: 'High-lumen UFO luminaire for fermentation halls, utility plants, and warehouses.',
    isPrimaryLight: true,
  },
  {
    type: 'emergency-bulkhead',
    name: 'Emergency Exit / Bulkhead',
    shortName: 'Emergency',
    defaultKelvin: 6000,
    defaultIntensity: 0.55,
    colorHex: '#D1FAE5',
    emissiveHex: '#10B981',
    watts: 8,
    description: 'Battery-backed egress luminaire that remains softly illuminated in blackout.',
    isPrimaryLight: false,
  },
  {
    type: 'uv-c-sterilizer',
    name: 'UV-C 254nm Sterilization Bar',
    shortName: 'UV-C Sterilizer',
    defaultKelvin: 9000,
    defaultIntensity: 0.9,
    colorHex: '#DDD6FE',
    emissiveHex: '#8B5CF6',
    watts: 65,
    description: 'Interlocked germicidal UV-C decontamination luminaire for aseptic turnover.',
    isPrimaryLight: false,
  },
];

export function getFixtureCatalogItem(type: LightFixtureType): LightFixtureCatalogEntry {
  return LIGHT_FIXTURE_CATALOG.find((c) => c.type === type) ?? LIGHT_FIXTURE_CATALOG[0];
}

export function kelvinToHex(kelvin: number, fallbackHex = '#E0F2FE'): string {
  if (kelvin >= 8000) return '#A78BFA'; // UV-C violet tint
  if (kelvin >= 5400) return '#E0F2FE'; // crisp cool daylight
  if (kelvin >= 4400) return '#F0F9FF'; // neutral cleanroom white
  if (kelvin >= 3600) return '#FEF9C3'; // warm neutral
  if (kelvin > 0) return '#FDE68A'; // warm architectural
  return fallbackHex;
}

/**
 * Finds the best wall side and offset ratio for a default wall switch,
 * preferring placement right next to an entry door along that room's perimeter.
 */
function inferDefaultSwitchPlacement(
  room: Room,
  floorOpenings: Opening[],
  floorWalls: Wall[]
): { wallSide: 'north' | 'south' | 'east' | 'west'; offsetRatio: number } {
  const eps = 0.55;
  for (const op of floorOpenings) {
    if (op.kind !== 'door') continue;
    const w = floorWalls.find((wl) => wl.id === op.wallId);
    if (!w) continue;
    const dx = w.x2 - w.x1;
    const dz = w.z2 - w.z1;
    const doorX = w.x1 + dx * op.offsetRatio;
    const doorZ = w.z1 + dz * op.offsetRatio;

    // North wall (z ~= room.z)
    if (
      Math.abs(doorZ - room.z) < eps &&
      doorX >= room.x - 0.3 &&
      doorX <= room.x + room.width + 0.3
    ) {
      const rel = (doorX - room.x) / Math.max(1, room.width);
      const offsetRatio = Math.min(0.88, Math.max(0.12, rel + (rel < 0.72 ? 0.14 : -0.14)));
      return { wallSide: 'north', offsetRatio };
    }
    // South wall (z ~= room.z + room.depth)
    if (
      Math.abs(doorZ - (room.z + room.depth)) < eps &&
      doorX >= room.x - 0.3 &&
      doorX <= room.x + room.width + 0.3
    ) {
      const rel = (doorX - room.x) / Math.max(1, room.width);
      const offsetRatio = Math.min(0.88, Math.max(0.12, rel + (rel < 0.72 ? 0.14 : -0.14)));
      return { wallSide: 'south', offsetRatio };
    }
    // West wall (x ~= room.x)
    if (
      Math.abs(doorX - room.x) < eps &&
      doorZ >= room.z - 0.3 &&
      doorZ <= room.z + room.depth + 0.3
    ) {
      const rel = (doorZ - room.z) / Math.max(1, room.depth);
      const offsetRatio = Math.min(0.88, Math.max(0.12, rel + (rel < 0.72 ? 0.14 : -0.14)));
      return { wallSide: 'west', offsetRatio };
    }
    // East wall (x ~= room.x + room.width)
    if (
      Math.abs(doorX - (room.x + room.width)) < eps &&
      doorZ >= room.z - 0.3 &&
      doorZ <= room.z + room.depth + 0.3
    ) {
      const rel = (doorZ - room.z) / Math.max(1, room.depth);
      const offsetRatio = Math.min(0.88, Math.max(0.12, rel + (rel < 0.72 ? 0.14 : -0.14)));
      return { wallSide: 'east', offsetRatio };
    }
  }

  return { wallSide: 'north', offsetRatio: 0.25 };
}

/**
 * Returns the room's explicit lighting config, or deterministically derives a realistic
 * wall switch + ceiling fixture grid tailored to the room's cleanroom grade & dimensions.
 */
export function getEffectiveRoomLighting(
  room: Room,
  floorOpenings: Opening[] = [],
  floorWalls: Wall[] = []
): RoomLightingConfig {
  if (
    room.lighting &&
    Array.isArray(room.lighting.switches) &&
    room.lighting.switches.length > 0 &&
    Array.isArray(room.lighting.fixtures)
  ) {
    return room.lighting;
  }

  const placement = inferDefaultSwitchPlacement(room, floorOpenings, floorWalls);
  const mainSwitchId = `sw-${room.id}-main`;

  const switches: RoomLightSwitch[] = [
    {
      id: mainSwitchId,
      label: `${room.code} Main Lighting`,
      wallSide: placement.wallSide,
      offsetRatio: placement.offsetRatio,
      heightM: 1.28,
      isOn: true,
      dimmerPct: 100,
    },
  ];

  // Choose primary fixture archetype by room category/grade
  const lower = `${room.name} ${room.category}`.toLowerCase();
  let primaryType: LightFixtureType = 'led-troffer';
  if (lower.includes('cold') || lower.includes('corridor') || lower.includes('wash')) {
    primaryType = 'linear-vapor';
  } else if (lower.includes('warehouse') || lower.includes('ferment') || lower.includes('utility')) {
    primaryType = 'high-bay';
  } else if (lower.includes('office') || lower.includes('admin') || lower.includes('lab')) {
    primaryType = 'recessed-downlight';
  }

  const cat = getFixtureCatalogItem(primaryType);
  const cols = room.width >= 9 ? 3 : room.width >= 5 ? 2 : 1;
  const rows = room.depth >= 8 ? 2 : 1;
  const fixtures: RoomLightFixture[] = [];
  let idx = 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      fixtures.push({
        id: `fix-${room.id}-${idx}`,
        label: `${cat.shortName} ${idx}`,
        type: primaryType,
        switchId: mainSwitchId,
        relX: (c + 0.5) / cols,
        relZ: (r + 0.5) / rows,
        kelvin: cat.defaultKelvin,
        intensity: cat.defaultIntensity,
      });
      idx++;
    }
  }

  return { switches, fixtures };
}

/**
 * Computes exact interior wall-surface 3D position + rotationY so the wall switch plate
 * sits proudly on the visible interior wall face (never hidden inside wall thickness).
 */
export function computeSwitchLocalTransform(
  room: Room,
  sw: RoomLightSwitch,
  wallInset = 0.16
): { x: number; y: number; z: number; rotY: number } {
  const ratio = Math.min(0.92, Math.max(0.08, sw.offsetRatio));
  const y = Math.min(Math.max(0.95, sw.heightM || 1.28), Math.max(1.5, room.height - 0.6));

  switch (sw.wallSide) {
    case 'north':
      return {
        x: room.x + room.width * ratio,
        y,
        z: room.z + wallInset,
        rotY: 0, // faces +Z (into room)
      };
    case 'south':
      return {
        x: room.x + room.width * ratio,
        y,
        z: room.z + room.depth - wallInset,
        rotY: Math.PI, // faces -Z (into room)
      };
    case 'west':
      return {
        x: room.x + wallInset,
        y,
        z: room.z + room.depth * ratio,
        rotY: Math.PI / 2, // faces +X (into room)
      };
    case 'east':
      return {
        x: room.x + room.width - wallInset,
        y,
        z: room.z + room.depth * ratio,
        rotY: -Math.PI / 2, // faces -X (into room)
      };
  }
}
