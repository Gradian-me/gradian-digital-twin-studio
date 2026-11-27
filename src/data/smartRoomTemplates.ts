import type {
  CleanroomGrade,
  HvacAirflowMode,
  HvacHepaClass,
  LightFixtureType,
  OpeningSubtype,
  RoomFireExtinguisher,
  RoomFireSensor,
  SpaceCategory,
} from '../types/twin';

export interface SmartRoomEquipmentPreset {
  templateId: string; // matches OBJECT_LIBRARY id
  labelOverride?: string;
  relX: number; // 0.12..0.88 inside room width
  relZ: number; // 0.12..0.88 inside room depth
  rotationY?: number;
}

export interface SmartRoomLightPreset {
  label: string;
  type: LightFixtureType;
  switchSlot: 'main' | 'aux';
  relX: number;
  relZ: number;
  kelvin: number;
  intensity: number;
}

export interface SmartRoomTemplate {
  id: string;
  name: string;
  codePrefix: string;
  tagline: string;
  badgeColor: string;
  category: SpaceCategory;
  spaceTypeId: string;
  width: number;
  depth: number;
  height: number;
  roomColor: string;
  floorMaterialId: string;
  wallMaterialId: string;
  ceilingMaterialId: string;
  doorSubtype: OpeningSubtype;
  doorWallSide: 'north' | 'south' | 'east' | 'west';
  doorOffsetRatio: number;
  cleanroomGrade: CleanroomGrade;
  pressurePa: number;
  airChangesPerHour: number;
  temperatureC: number;
  humidityPct: number;
  energyKw: number;
  costPerSqm: number;
  occupancyMax: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  hvac: {
    ahuId: string;
    ahuName: string;
    hepaClass: HvacHepaClass;
    airflowMode: HvacAirflowMode;
    supplyTempC: number;
    damperPct: number;
    diffuserCount: number;
    exhaustPct: number;
  };
  fireSensors: Array<Omit<RoomFireSensor, 'id' | 'tag' | 'lastTested' | 'nextTestDue'>>;
  fireExtinguishers: Array<Omit<RoomFireExtinguisher, 'id' | 'tag' | 'lastInspection' | 'nextInspection'>>;
  equipment: SmartRoomEquipmentPreset[];
  switches: Array<{
    slot: 'main' | 'aux';
    label: string;
    wallSide: 'north' | 'south' | 'east' | 'west';
    offsetRatio: number;
  }>;
  lights: SmartRoomLightPreset[];
}

export const SMART_ROOM_TEMPLATES: SmartRoomTemplate[] = [
  {
    id: 'srt-cold-storage',
    name: 'Cold Storage Vault (2–8 °C)',
    codePrefix: 'CLD',
    tagline: '2–8 °C GMP biologic vault with cold recirc AHU, vapor-tight LEDs & thermal fire sensing',
    badgeColor: '#0EA5E9',
    category: 'Warehouse & Cold Chain',
    spaceTypeId: 'cold-storage',
    width: 7.5,
    depth: 5.5,
    height: 3.6,
    roomColor: '#0EA5E9',
    floorMaterialId: 'epoxy-grey',
    wallMaterialId: 'cleanroom-panel',
    ceilingMaterialId: 'ceiling-acoustic',
    doorSubtype: 'sliding-door',
    doorWallSide: 'south',
    doorOffsetRatio: 0.5,
    cleanroomGrade: 'Grade D / ISO 8',
    pressurePa: 5,
    airChangesPerHour: 14,
    temperatureC: 4.5,
    humidityPct: 45,
    energyKw: 24,
    costPerSqm: 2650,
    occupancyMax: 4,
    riskLevel: 'high',
    hvac: {
      ahuId: 'AHU-CLD-01',
      ahuName: 'Cold Chain Redundant Recirc AHU',
      hepaClass: 'HEPA H13',
      airflowMode: 'cold-recirc',
      supplyTempC: 3.5,
      damperPct: 68,
      diffuserCount: 4,
      exhaustPct: 18,
    },
    fireSensors: [
      { type: 'Thermal Rate-of-Rise', zone: 'Vault Ceiling Zone A', status: 'normal', sensitivity: '57°C / 8°C·min' },
      { type: 'Optical Smoke', zone: 'Evaporator Return Plenum', status: 'normal', sensitivity: '0.15 %/ft obs' },
    ],
    fireExtinguishers: [
      {
        agent: 'CO2 (Carbon Dioxide)',
        capacityKg: 5,
        classRating: 'Class B / Electrical',
        pressureStatus: 'green-nominal',
        locationHint: 'Inside Sliding Door Jamb',
      },
    ],
    equipment: [
      { templateId: 'cold-room-unit', labelOverride: 'Glycol Evaporator Unit A', relX: 0.22, relZ: 0.22 },
      { templateId: 'lab-freezer', labelOverride: 'ULT -80°C Biologics Freezer', relX: 0.78, relZ: 0.24 },
      { templateId: 'pallet-rack', labelOverride: 'Cold Chain Biologic Rack 01', relX: 0.3, relZ: 0.65 },
      { templateId: 'sensor-node', labelOverride: 'EMS 2-8°C Mapping Node', relX: 0.82, relZ: 0.72 },
    ],
    switches: [
      { slot: 'main', label: 'Cold Vault Vapor LEDs', wallSide: 'south', offsetRatio: 0.28 },
    ],
    lights: [
      { label: 'Vapor Strip North', type: 'linear-vapor', switchSlot: 'main', relX: 0.5, relZ: 0.28, kelvin: 4800, intensity: 1.35 },
      { label: 'Vapor Strip South', type: 'linear-vapor', switchSlot: 'main', relX: 0.5, relZ: 0.72, kelvin: 4800, intensity: 1.35 },
      { label: 'Exit Bulkhead', type: 'emergency-bulkhead', switchSlot: 'main', relX: 0.5, relZ: 0.9, kelvin: 6000, intensity: 0.55 },
    ],
  },
  {
    id: 'srt-fermentation-suite',
    name: 'Fermentation Suite (Grade C)',
    codePrefix: 'FRM',
    tagline: 'Upstream mAb bioreactor hall with dual 2000L SS vessels, HEPA H14 cascade & VESDA',
    badgeColor: '#8B5CF6',
    category: 'Upstream Bioprocessing',
    spaceTypeId: 'upstream-bioprocess',
    width: 10.0,
    depth: 7.0,
    height: 4.2,
    roomColor: '#8B5CF6',
    floorMaterialId: 'epoxy-cleanroom',
    wallMaterialId: 'cleanroom-panel',
    ceilingMaterialId: 'ceiling-cleanroom',
    doorSubtype: 'airlock-door',
    doorWallSide: 'south',
    doorOffsetRatio: 0.25,
    cleanroomGrade: 'Grade C / ISO 7',
    pressurePa: 20,
    airChangesPerHour: 28,
    temperatureC: 20.5,
    humidityPct: 45,
    energyKw: 68,
    costPerSqm: 5400,
    occupancyMax: 8,
    riskLevel: 'critical',
    hvac: {
      ahuId: 'AHU-USP-01',
      ahuName: 'Upstream Grade C Cleanroom AHU',
      hepaClass: 'HEPA H14',
      airflowMode: 'positive-cascade',
      supplyTempC: 18.0,
      damperPct: 82,
      diffuserCount: 6,
      exhaustPct: 24,
    },
    fireSensors: [
      { type: 'VESDA Aspirating', zone: 'Fermentation Ceiling Grid', status: 'normal', sensitivity: '0.02 %/m obs' },
      { type: 'Optical Smoke', zone: 'Bioreactor Control Skid Bay', status: 'normal', sensitivity: '0.12 %/ft obs' },
      { type: 'Thermal Rate-of-Rise', zone: 'SIP Steam Manifold Zone', status: 'normal', sensitivity: '68°C fixed' },
    ],
    fireExtinguishers: [
      {
        agent: 'CO2 (Carbon Dioxide)',
        capacityKg: 6,
        classRating: 'Class B / SCADA Panel',
        pressureStatus: 'green-nominal',
        locationHint: 'Adjacent to Airlock Entry',
      },
      {
        agent: 'Water Mist',
        capacityKg: 9,
        classRating: 'Class A/C Cleanroom Safe',
        pressureStatus: 'green-nominal',
        locationHint: 'East Process Column',
      },
    ],
    equipment: [
      { templateId: 'bioreactor-ss', labelOverride: '2000L Production Bioreactor A', relX: 0.26, relZ: 0.34 },
      { templateId: 'bioreactor-ss', labelOverride: '2000L Production Bioreactor B', relX: 0.56, relZ: 0.34 },
      { templateId: 'vessel-tank', labelOverride: 'Media Prep & Hold Tank', relX: 0.84, relZ: 0.34 },
      { templateId: 'scada-console', labelOverride: 'DeltaV Upstream HMI Console', relX: 0.78, relZ: 0.76 },
      { templateId: 'sensor-node', labelOverride: 'EMS Cleanroom ΔP / Particle Node', relX: 0.16, relZ: 0.78 },
    ],
    switches: [
      { slot: 'main', label: 'Suite Primary LED Array', wallSide: 'south', offsetRatio: 0.42 },
      { slot: 'aux', label: 'UV-C Sanitization Interlock', wallSide: 'south', offsetRatio: 0.52 },
    ],
    lights: [
      { label: 'Cleanroom Troffer NW', type: 'led-troffer', switchSlot: 'main', relX: 0.25, relZ: 0.3, kelvin: 5000, intensity: 1.5 },
      { label: 'Cleanroom Troffer NE', type: 'led-troffer', switchSlot: 'main', relX: 0.75, relZ: 0.3, kelvin: 5000, intensity: 1.5 },
      { label: 'Cleanroom Troffer SW', type: 'led-troffer', switchSlot: 'main', relX: 0.25, relZ: 0.72, kelvin: 5000, intensity: 1.5 },
      { label: 'Cleanroom Troffer SE', type: 'led-troffer', switchSlot: 'main', relX: 0.75, relZ: 0.72, kelvin: 5000, intensity: 1.5 },
      { label: 'UV-C Turnover Bar', type: 'uv-c-sterilizer', switchSlot: 'aux', relX: 0.5, relZ: 0.5, kelvin: 9000, intensity: 0.9 },
    ],
  },
  {
    id: 'srt-chromatography-suite',
    name: 'Chromatography & TFF Suite',
    codePrefix: 'DSP',
    tagline: 'Downstream purification suite with Protein A Chrom Skid, TFF UF/DF & HEPA H14',
    badgeColor: '#10B981',
    category: 'Downstream Purification',
    spaceTypeId: 'downstream-purification',
    width: 8.5,
    depth: 6.0,
    height: 3.8,
    roomColor: '#10B981',
    floorMaterialId: 'epoxy-cleanroom',
    wallMaterialId: 'cleanroom-panel',
    ceilingMaterialId: 'ceiling-cleanroom',
    doorSubtype: 'cleanroom-door',
    doorWallSide: 'south',
    doorOffsetRatio: 0.3,
    cleanroomGrade: 'Grade C / ISO 7',
    pressurePa: 25,
    airChangesPerHour: 30,
    temperatureC: 19.5,
    humidityPct: 45,
    energyKw: 44,
    costPerSqm: 5100,
    occupancyMax: 6,
    riskLevel: 'high',
    hvac: {
      ahuId: 'AHU-DSP-02',
      ahuName: 'Downstream Purification HEPA AHU',
      hepaClass: 'HEPA H14',
      airflowMode: 'positive-cascade',
      supplyTempC: 17.5,
      damperPct: 78,
      diffuserCount: 4,
      exhaustPct: 22,
    },
    fireSensors: [
      { type: 'Optical Smoke', zone: 'Purification Skid Overhead', status: 'normal', sensitivity: '0.12 %/ft obs' },
      { type: 'VESDA Aspirating', zone: 'Solvent Buffer Manifold', status: 'normal', sensitivity: '0.02 %/m obs' },
    ],
    fireExtinguishers: [
      {
        agent: 'CO2 (Carbon Dioxide)',
        capacityKg: 5,
        classRating: 'Class B/C Cleanroom',
        pressureStatus: 'green-nominal',
        locationHint: 'Next to Entry Airlock',
      },
    ],
    equipment: [
      { templateId: 'chromatography-skid', labelOverride: 'Protein A Capture Chrom Skid', relX: 0.28, relZ: 0.35 },
      { templateId: 'filtration-skid', labelOverride: 'TFF Ultrafiltration Skid', relX: 0.65, relZ: 0.35 },
      { templateId: 'vessel-tank', labelOverride: 'Elution Pool Hold Vessel', relX: 0.84, relZ: 0.7 },
      { templateId: 'pass-box', labelOverride: 'Active HEPA Material Pass-Box', relX: 0.14, relZ: 0.72 },
    ],
    switches: [
      { slot: 'main', label: 'Purification LED Troffers', wallSide: 'south', offsetRatio: 0.48 },
    ],
    lights: [
      { label: 'Cleanroom Troffer W', type: 'led-troffer', switchSlot: 'main', relX: 0.3, relZ: 0.48, kelvin: 5000, intensity: 1.45 },
      { label: 'Cleanroom Troffer E', type: 'led-troffer', switchSlot: 'main', relX: 0.7, relZ: 0.48, kelvin: 5000, intensity: 1.45 },
    ],
  },
  {
    id: 'srt-aseptic-fill',
    name: 'ISO-5 Aseptic Fill-Finish Core',
    codePrefix: 'ASP',
    tagline: 'Grade A/B laminar UDAF aseptic isolator, vial filler, lyophilizer & ULPA U15',
    badgeColor: '#F59E0B',
    category: 'Fill-Finish & Packaging',
    spaceTypeId: 'aseptic-filling',
    width: 9.5,
    depth: 6.5,
    height: 4.0,
    roomColor: '#F59E0B',
    floorMaterialId: 'terrazzo-white',
    wallMaterialId: 'cleanroom-panel',
    ceilingMaterialId: 'ceiling-cleanroom',
    doorSubtype: 'airlock-door',
    doorWallSide: 'west',
    doorOffsetRatio: 0.5,
    cleanroomGrade: 'Grade A / ISO 5',
    pressurePa: 45,
    airChangesPerHour: 60,
    temperatureC: 19.0,
    humidityPct: 40,
    energyKw: 76,
    costPerSqm: 7800,
    occupancyMax: 4,
    riskLevel: 'critical',
    hvac: {
      ahuId: 'AHU-ASP-03',
      ahuName: 'Grade A Laminar UDAF ULPA Plant',
      hepaClass: 'ULPA U15',
      airflowMode: 'laminar-udaf',
      supplyTempC: 17.0,
      damperPct: 92,
      diffuserCount: 8,
      exhaustPct: 16,
    },
    fireSensors: [
      { type: 'VESDA Aspirating', zone: 'Grade A UDAF Plenum', status: 'normal', sensitivity: '0.005 %/m obs' },
      { type: 'Optical Smoke', zone: 'Lyophilizer Compressor Bay', status: 'normal', sensitivity: '0.10 %/ft obs' },
    ],
    fireExtinguishers: [
      {
        agent: 'FM-200 Clean Agent',
        capacityKg: 10,
        classRating: 'Clean Agent A/B/C',
        pressureStatus: 'green-nominal',
        locationHint: 'Outside Aseptic Interlock',
      },
    ],
    equipment: [
      { templateId: 'isolator', labelOverride: 'Grade A Aseptic Isolator', relX: 0.32, relZ: 0.42 },
      { templateId: 'filling-line', labelOverride: 'Robotic Vial Filling Line', relX: 0.65, relZ: 0.42 },
      { templateId: 'lyophilizer', labelOverride: 'Production Freeze Dryer', relX: 0.78, relZ: 0.78 },
      { templateId: 'sensor-node', labelOverride: 'Continuous Viable/Particle EMS', relX: 0.18, relZ: 0.78 },
    ],
    switches: [
      { slot: 'main', label: 'Aseptic UDAF LED Grid', wallSide: 'west', offsetRatio: 0.3 },
      { slot: 'aux', label: 'Aseptic UV-C Interlock', wallSide: 'west', offsetRatio: 0.72 },
    ],
    lights: [
      { label: 'UDAF Troffer 1', type: 'led-troffer', switchSlot: 'main', relX: 0.28, relZ: 0.32, kelvin: 5500, intensity: 1.6 },
      { label: 'UDAF Troffer 2', type: 'led-troffer', switchSlot: 'main', relX: 0.72, relZ: 0.32, kelvin: 5500, intensity: 1.6 },
      { label: 'UDAF Troffer 3', type: 'led-troffer', switchSlot: 'main', relX: 0.5, relZ: 0.74, kelvin: 5500, intensity: 1.5 },
      { label: 'UV-C Sterilizer Bar', type: 'uv-c-sterilizer', switchSlot: 'aux', relX: 0.5, relZ: 0.45, kelvin: 9000, intensity: 1.0 },
    ],
  },
  {
    id: 'srt-qc-lab',
    name: 'QC Analytical Laboratory',
    codePrefix: 'QCL',
    tagline: 'HPLC/UPLC analytical lab with fume hood, BSC, benchwork & negative containment',
    badgeColor: '#06B6D4',
    category: 'QC / QA Laboratories',
    spaceTypeId: 'qc-analytical-lab',
    width: 8.0,
    depth: 5.5,
    height: 3.4,
    roomColor: '#06B6D4',
    floorMaterialId: 'vinyl-lab',
    wallMaterialId: 'gypsum-white',
    ceilingMaterialId: 'ceiling-acoustic',
    doorSubtype: 'glass-door',
    doorWallSide: 'south',
    doorOffsetRatio: 0.25,
    cleanroomGrade: 'CNC (Controlled)',
    pressurePa: -5,
    airChangesPerHour: 15,
    temperatureC: 21.5,
    humidityPct: 48,
    energyKw: 22,
    costPerSqm: 3400,
    occupancyMax: 6,
    riskLevel: 'medium',
    hvac: {
      ahuId: 'AHU-LAB-04',
      ahuName: 'QC Lab Once-Through Exhaust AHU',
      hepaClass: 'MERV-14',
      airflowMode: 'negative-containment',
      supplyTempC: 19.5,
      damperPct: 74,
      diffuserCount: 4,
      exhaustPct: 85,
    },
    fireSensors: [
      { type: 'Optical Smoke', zone: 'Analytical Bench Zone', status: 'normal', sensitivity: '0.14 %/ft obs' },
      { type: 'Thermal Rate-of-Rise', zone: 'Chemical Fume Hood Exhaust', status: 'normal', sensitivity: '57°C / 8°C·min' },
    ],
    fireExtinguishers: [
      {
        agent: 'CO2 (Carbon Dioxide)',
        capacityKg: 5,
        classRating: 'Class B/C Instruments',
        pressureStatus: 'green-nominal',
        locationHint: 'Lab Exit Column',
      },
      {
        agent: 'ABC Dry Powder',
        capacityKg: 6,
        classRating: 'Multi-Purpose Solvent',
        pressureStatus: 'green-nominal',
        locationHint: 'Fume Hood Side Wall',
      },
    ],
    equipment: [
      { templateId: 'fume-hood', labelOverride: 'Chemical Fume Hood FH-01', relX: 0.22, relZ: 0.22 },
      { templateId: 'biosafety-cabinet', labelOverride: 'Class II Biosafety Cabinet', relX: 0.78, relZ: 0.22 },
      { templateId: 'hplc-instrument', labelOverride: 'Waters UPLC / HPLC Stack', relX: 0.35, relZ: 0.68 },
      { templateId: 'lab-bench', labelOverride: 'Analytical Prep Island Bench', relX: 0.72, relZ: 0.68 },
    ],
    switches: [
      { slot: 'main', label: 'QC Lab Ceiling Downlights', wallSide: 'south', offsetRatio: 0.44 },
    ],
    lights: [
      { label: 'Lab Downlight NW', type: 'recessed-downlight', switchSlot: 'main', relX: 0.28, relZ: 0.32, kelvin: 4200, intensity: 1.3 },
      { label: 'Lab Downlight NE', type: 'recessed-downlight', switchSlot: 'main', relX: 0.72, relZ: 0.32, kelvin: 4200, intensity: 1.3 },
      { label: 'Lab Downlight S', type: 'recessed-downlight', switchSlot: 'main', relX: 0.5, relZ: 0.72, kelvin: 4200, intensity: 1.3 },
    ],
  },
  {
    id: 'srt-data-center',
    name: 'GMP Data Center / MDF Vault',
    codePrefix: 'MDF',
    tagline: 'Hot/cold aisle IT vault with 42U racks, CRAC cooling, UPS, VESDA & FM-200 clean agent',
    badgeColor: '#6366F1',
    category: 'IT & Data Center',
    spaceTypeId: 'server-room',
    width: 7.5,
    depth: 5.5,
    height: 3.6,
    roomColor: '#6366F1',
    floorMaterialId: 'raised-access-floor',
    wallMaterialId: 'fire-rated-panel',
    ceilingMaterialId: 'ceiling-acoustic',
    doorSubtype: 'security-door',
    doorWallSide: 'south',
    doorOffsetRatio: 0.5,
    cleanroomGrade: 'CNC (Controlled)',
    pressurePa: 10,
    airChangesPerHour: 18,
    temperatureC: 19.0,
    humidityPct: 45,
    energyKw: 52,
    costPerSqm: 4900,
    occupancyMax: 3,
    riskLevel: 'critical',
    hvac: {
      ahuId: 'AHU-IT-CRAC',
      ahuName: 'Precision CRAC Redundant Cooling',
      hepaClass: 'MERV-14',
      airflowMode: 'cold-recirc',
      supplyTempC: 16.5,
      damperPct: 86,
      diffuserCount: 4,
      exhaustPct: 12,
    },
    fireSensors: [
      { type: 'VESDA Aspirating', zone: 'Hot Aisle Containment Grid', status: 'normal', sensitivity: '0.01 %/m obs' },
      { type: 'Optical Smoke', zone: 'Sub-Floor Cable Plenum', status: 'normal', sensitivity: '0.08 %/ft obs' },
    ],
    fireExtinguishers: [
      {
        agent: 'FM-200 Clean Agent',
        capacityKg: 12,
        classRating: 'Clean Agent Server Vault',
        pressureStatus: 'green-nominal',
        locationHint: 'Biometric Security Door',
      },
    ],
    equipment: [
      { templateId: 'server-rack', labelOverride: '42U Core Compute Rack A', relX: 0.25, relZ: 0.35 },
      { templateId: 'network-rack', labelOverride: '42U Core Switch & Patch Rack', relX: 0.5, relZ: 0.35 },
      { templateId: 'crac-cooling', labelOverride: 'Precision CRAC Cooling Unit', relX: 0.82, relZ: 0.35 },
      { templateId: 'ups-tower', labelOverride: 'Dual-Conversion Online UPS', relX: 0.22, relZ: 0.74 },
    ],
    switches: [
      { slot: 'main', label: 'Aisle Linear LED Strip', wallSide: 'south', offsetRatio: 0.3 },
    ],
    lights: [
      { label: 'Cold Aisle Linear 1', type: 'linear-vapor', switchSlot: 'main', relX: 0.32, relZ: 0.52, kelvin: 5000, intensity: 1.3 },
      { label: 'Hot Aisle Linear 2', type: 'linear-vapor', switchSlot: 'main', relX: 0.72, relZ: 0.52, kelvin: 5000, intensity: 1.3 },
      { label: 'Security Exit Bulkhead', type: 'emergency-bulkhead', switchSlot: 'main', relX: 0.5, relZ: 0.9, kelvin: 6000, intensity: 0.6 },
    ],
  },
];
