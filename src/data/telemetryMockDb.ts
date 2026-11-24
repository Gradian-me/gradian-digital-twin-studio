import type { DigitalTwinScene, Room, SpatialAsset } from '../types/twin';
import {
  METRIC_PRESETS,
  type LiveSensorSnapshot,
  type SensorDefinition,
  type SensorReadingPoint,
  type SensorRelationship,
  type SensorStatus,
} from '../types/telemetry';
import { createCinnaGenCampusScene } from './cinnagenDemo';

export function evaluateSensorStatus(sensor: SensorDefinition, value: number): SensorStatus {
  if (value <= sensor.alarmLow || value >= sensor.alarmHigh) return 'alarm';
  if (value <= sensor.warnLow || value >= sensor.warnHigh) return 'warning';
  return 'nominal';
}

function cleanCode(raw: string): string {
  return raw.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8) || 'UNIT';
}

export function generateDefaultSensorsForScene(scene: DigitalTwinScene): {
  sensors: SensorDefinition[];
  relationships: SensorRelationship[];
} {
  const sensors: SensorDefinition[] = [];
  const relationships: SensorRelationship[] = [];

  const floorMap = new Map(scene.floors.map((f) => [f.id, f]));

  // 1. Environmental Sensors (Temperature, Relative Humidity, Differential Pressure) for every Room
  const roomPrimaryPressureIds: Record<string, string> = {};
  const roomPrimaryTempIds: Record<string, string> = {};

  scene.rooms.forEach((room: Room) => {
    const fl = floorMap.get(room.floorId);
    const buildingId = fl?.buildingId ?? 'bldg-a';
    const cx = Number((room.x + room.width / 2).toFixed(2));
    const cz = Number((room.z + room.depth / 2).toFixed(2));
    const code = cleanCode(room.code);

    // Temperature probe
    const tNom = room.environmental.temperatureC;
    const tId = `sens-env-t-${room.id}`;
    roomPrimaryTempIds[room.id] = tId;
    sensors.push({
      id: tId,
      tag: `TT-${code}-01`,
      name: `${room.name} Ambient Temp`,
      metric: 'temperature',
      unit: '°C',
      targetKind: 'room',
      targetId: room.id,
      targetName: room.name,
      targetCode: room.code,
      targetCategory: room.category,
      floorId: room.floorId,
      buildingId,
      x: Number((cx - Math.min(1.1, room.width * 0.16)).toFixed(2)),
      y: 2.2,
      z: Number((cz - Math.min(0.8, room.depth * 0.14)).toFixed(2)),
      nominal: tNom,
      minRange: Math.min(2, tNom - 6),
      maxRange: tNom + 8,
      warnLow: Number((tNom - 1.8).toFixed(1)),
      warnHigh: Number((tNom + 1.8).toFixed(1)),
      alarmLow: Number((tNom - 3.2).toFixed(1)),
      alarmHigh: Number((tNom + 3.2).toFixed(1)),
      precision: 2,
      isMainSensor: true,
      protocol: 'BACnet',
      plcAddress: `EMS.${code}.AI_TEMP_01`,
      samplingHz: 1,
      calibrationDue: '2027-03-15',
      description: `GMP environmental temperature RTD probe (${room.environmental.cleanroomGrade})`,
    });

    // Relative Humidity probe
    const rhNom = room.environmental.humidityPct;
    const rhId = `sens-env-rh-${room.id}`;
    sensors.push({
      id: rhId,
      tag: `RHT-${code}-01`,
      name: `${room.name} Humidity`,
      metric: 'humidity',
      unit: '%RH',
      targetKind: 'room',
      targetId: room.id,
      targetName: room.name,
      targetCode: room.code,
      targetCategory: room.category,
      floorId: room.floorId,
      buildingId,
      x: Number((cx + Math.min(1.1, room.width * 0.16)).toFixed(2)),
      y: 2.2,
      z: cz,
      nominal: rhNom,
      minRange: 15,
      maxRange: 80,
      warnLow: Math.max(15, rhNom - 9),
      warnHigh: Math.min(78, rhNom + 9),
      alarmLow: Math.max(10, rhNom - 15),
      alarmHigh: Math.min(85, rhNom + 15),
      precision: 1,
      isMainSensor: false,
      protocol: 'BACnet',
      plcAddress: `EMS.${code}.AI_RH_01`,
      samplingHz: 1,
      calibrationDue: '2027-03-15',
      description: `Capacitive cleanroom humidity transmitter`,
    });

    // Differential Pressure probe
    const pNom = room.environmental.pressurePa;
    const pId = `sens-env-dp-${room.id}`;
    roomPrimaryPressureIds[room.id] = pId;
    sensors.push({
      id: pId,
      tag: `DPT-${code}-01`,
      name: `${room.name} Diff. Pressure`,
      metric: 'pressure',
      unit: 'Pa',
      targetKind: 'room',
      targetId: room.id,
      targetName: room.name,
      targetCode: room.code,
      targetCategory: room.category,
      floorId: room.floorId,
      buildingId,
      x: cx,
      y: 2.4,
      z: Number((cz + Math.min(0.9, room.depth * 0.16)).toFixed(2)),
      nominal: pNom,
      minRange: -20,
      maxRange: 70,
      warnLow: Number((pNom - 6).toFixed(1)),
      warnHigh: Number((pNom + 10).toFixed(1)),
      alarmLow: Number((pNom - 11).toFixed(1)),
      alarmHigh: Number((pNom + 16).toFixed(1)),
      precision: 1,
      isMainSensor: false,
      protocol: 'BACnet',
      plcAddress: `EMS.${code}.AI_DP_01`,
      samplingHz: 2,
      calibrationDue: '2027-02-01',
      description: `Cleanroom pressure cascade differential pressure sensor`,
    });

    // Add Airborne Particle Counter for Grade A / B rooms
    if (
      room.environmental.cleanroomGrade.includes('Grade A') ||
      room.environmental.cleanroomGrade.includes('Grade B')
    ) {
      sensors.push({
        id: `sens-env-pc-${room.id}`,
        tag: `PC-${code}-01`,
        name: `${room.name} Particle Counter`,
        metric: 'particles',
        unit: 'p/m³',
        targetKind: 'room',
        targetId: room.id,
        targetName: room.name,
        targetCode: room.code,
        targetCategory: room.category,
        floorId: room.floorId,
        buildingId,
        x: cx,
        y: 1.5,
        z: cz,
        nominal: room.environmental.cleanroomGrade.includes('Grade A') ? 480 : 1650,
        minRange: 0,
        maxRange: 4500,
        warnLow: 0,
        warnHigh: room.environmental.cleanroomGrade.includes('Grade A') ? 2200 : 3000,
        alarmLow: 0,
        alarmHigh: 3520,
        precision: 0,
        isMainSensor: false,
        protocol: 'OPC UA',
        plcAddress: `EMS.${code}.OPC_PARTICLE_05`,
        samplingHz: 1,
        calibrationDue: '2027-01-10',
        description: `ISO 14644 continuous 0.5µm laser airborne particle counter`,
      });
    }
  });

  // 2. Equipment Sensors for Bioreactors, HPLCs, Chromatography Skids, Autoclaves, Freezers, AHUs, etc.
  const firstBioreactorSensors: Record<string, string> = {};
  const firstHplcSensors: Record<string, string> = {};
  let firstChillerTempId: string | null = null;

  scene.assets.forEach((asset: SpatialAsset) => {
    const fl = floorMap.get(asset.floorId);
    const buildingId = fl?.buildingId ?? 'bldg-a';
    const code = cleanCode(asset.assetId);
    const topY = Number((asset.y + asset.height + 0.35).toFixed(2));

    const pushAssetSensor = (
      suffix: string,
      metric: SensorDefinition['metric'],
      label: string,
      overrides: Partial<SensorDefinition>
    ) => {
      const preset = METRIC_PRESETS[metric];
      const id = `sens-eq-${asset.id}-${suffix}`;
      sensors.push({
        id,
        tag: `${preset.isaPrefix}-${code}-${suffix.toUpperCase()}`,
        name: `${asset.name} · ${label}`,
        metric,
        unit: overrides.unit ?? preset.unit,
        targetKind: 'asset',
        targetId: asset.id,
        targetName: asset.name,
        targetCode: asset.assetId,
        targetCategory: asset.category,
        floorId: asset.floorId,
        buildingId,
        x: asset.x,
        y: topY,
        z: asset.z,
        nominal: overrides.nominal ?? preset.nominal,
        minRange: overrides.minRange ?? preset.minRange,
        maxRange: overrides.maxRange ?? preset.maxRange,
        warnLow: overrides.warnLow ?? preset.warnLow,
        warnHigh: overrides.warnHigh ?? preset.warnHigh,
        alarmLow: overrides.alarmLow ?? preset.alarmLow,
        alarmHigh: overrides.alarmHigh ?? preset.alarmHigh,
        precision: overrides.precision ?? preset.precision,
        isMainSensor: overrides.isMainSensor ?? false,
        protocol: overrides.protocol ?? (asset.connectivity.protocol === 'None' ? 'OPC UA' : asset.connectivity.protocol),
        plcAddress: `${asset.connectivity.plcTag}.${suffix.toUpperCase()}`,
        samplingHz: overrides.samplingHz ?? 2,
        calibrationDue: '2027-04-20',
        description: overrides.description ?? `${asset.manufacturer} ${asset.model} telemetry channel`,
      });
      return id;
    };

    if (asset.archetype === 'bioreactor-ss' || asset.archetype === 'bioreactor-su') {
      const tId = pushAssetSensor('01', 'temperature', 'Culture Temperature', {
        nominal: 37.0,
        minRange: 30,
        maxRange: 42,
        warnLow: 36.4,
        warnHigh: 37.6,
        alarmLow: 35.8,
        alarmHigh: 38.2,
        isMainSensor: true,
        samplingHz: 5,
        description: 'Jacketed Pt100 bioreactor culture temperature loop',
      });
      const phId = pushAssetSensor('02', 'ph', 'Culture pH', {
        nominal: 7.12,
        warnLow: 6.98,
        warnHigh: 7.26,
        alarmLow: 6.85,
        alarmHigh: 7.4,
        isMainSensor: false,
        description: 'Dual redundant autoclavable pH electrode',
      });
      const doId = pushAssetSensor('03', 'dissolved-o2', 'Dissolved O₂', {
        nominal: 42.5,
        warnLow: 32,
        warnHigh: 54,
        alarmLow: 24,
        alarmHigh: 65,
        isMainSensor: false,
        description: 'Optical luminescence dissolved oxygen sensor',
      });
      const rpmId = pushAssetSensor('04', 'agitation', 'Impeller Speed', {
        nominal: asset.archetype === 'bioreactor-ss' ? 148 : 115,
        warnLow: 80,
        warnHigh: 210,
        alarmLow: 50,
        alarmHigh: 245,
        isMainSensor: false,
        description: 'Magnetic-drive Rushton/pitched-blade agitator tachometer',
      });
      const pId = pushAssetSensor('05', 'vessel-pressure', 'Headspace Pressure', {
        nominal: 0.45,
        warnLow: 0.2,
        warnHigh: 0.85,
        alarmLow: 0.1,
        alarmHigh: 1.25,
        isMainSensor: false,
        description: 'Sanitary diaphragm headspace pressure transmitter',
      });

      // Automatically wire internal Bioreactor control relationships
      relationships.push({
        id: `rel-br-do-rpm-${asset.id}`,
        sourceSensorId: doId,
        targetSensorId: rpmId,
        type: 'controls',
        label: 'DO Cascade → RPM',
        description: 'Dissolved oxygen PID cascade adjusts impeller agitation speed to maintain oxygen transfer rate.',
        active: true,
      });
      relationships.push({
        id: `rel-br-ph-do-${asset.id}`,
        sourceSensorId: phId,
        targetSensorId: doId,
        type: 'correlates_with',
        label: 'Metabolic Coupling',
        description: 'CO₂ sparging for pH control directly correlates with headspace oxygen saturation.',
        active: true,
      });

      if (!firstBioreactorSensors.temp) {
        firstBioreactorSensors.temp = tId;
        firstBioreactorSensors.pressure = pId;
      }
    } else if (asset.archetype === 'hplc-instrument') {
      const barId = pushAssetSensor('01', 'vessel-pressure', 'Pump Backpressure', {
        unit: 'bar',
        nominal: 184.5,
        minRange: 0,
        maxRange: 400,
        warnLow: 120,
        warnHigh: 260,
        alarmLow: 60,
        alarmHigh: 320,
        precision: 1,
        isMainSensor: true,
        samplingHz: 10,
        description: 'Quaternary UHPLC binary pump pressure transducer',
      });
      const uvId = pushAssetSensor('02', 'uv-absorbance', 'UV280 Detector', {
        nominal: 445.0,
        isMainSensor: false,
        samplingHz: 10,
        description: 'Diode array UV absorbance chromatogram channel (280 nm)',
      });
      const colTId = pushAssetSensor('03', 'temperature', 'Column Oven Temp', {
        nominal: 30.0,
        minRange: 15,
        maxRange: 65,
        warnLow: 28.5,
        warnHigh: 31.5,
        alarmLow: 26.0,
        alarmHigh: 34.0,
        isMainSensor: false,
        description: 'Thermostatted C18 analytical column oven sensor',
      });
      const flowId = pushAssetSensor('04', 'flow-rate', 'Eluent Flow Rate', {
        nominal: 1.2,
        warnLow: 1.05,
        warnHigh: 1.35,
        alarmLow: 0.85,
        alarmHigh: 1.55,
        isMainSensor: false,
        description: 'Mass flow meter on mobile phase channel A/B',
      });

      relationships.push({
        id: `rel-hplc-flow-bar-${asset.id}`,
        sourceSensorId: flowId,
        targetSensorId: barId,
        type: 'interlocks',
        label: 'Overpressure Cutoff',
        description: 'Pump pressure alarm triggers automatic mobile phase flow shutoff interlock.',
        active: true,
      });
      relationships.push({
        id: `rel-hplc-temp-uv-${asset.id}`,
        sourceSensorId: colTId,
        targetSensorId: uvId,
        type: 'correlates_with',
        label: 'Retention Stability',
        description: 'Column oven stability governs peak elution time and UV280 baseline drift.',
        active: true,
      });

      if (!firstHplcSensors.bar) {
        firstHplcSensors.bar = barId;
        firstHplcSensors.uv = uvId;
      }
    } else if (asset.archetype === 'chromatography-skid' || asset.archetype === 'filtration-skid') {
      const uvId = pushAssetSensor('01', 'uv-absorbance', 'Process UV280', {
        nominal: 610,
        isMainSensor: true,
        description: 'Inline sanitary UV280 protein elution monitor',
      });
      const condId = pushAssetSensor('02', 'conductivity', 'Buffer Conductivity', {
        nominal: 14.8,
        isMainSensor: false,
        description: 'Toroidal conductivity sensor for gradient verification',
      });
      pushAssetSensor('03', 'vessel-pressure', 'Delta-P / TMP', {
        nominal: 1.15,
        warnLow: 0.4,
        warnHigh: 2.1,
        alarmLow: 0.1,
        alarmHigh: 2.8,
        isMainSensor: false,
        description: 'Transmembrane / resin bed differential pressure',
      });
      relationships.push({
        id: `rel-skid-cond-uv-${asset.id}`,
        sourceSensorId: condId,
        targetSensorId: uvId,
        type: 'feeds_into',
        label: 'Elution Peak Trigger',
        description: 'Conductivity step initiates downstream fraction collection on UV280 rise.',
        active: true,
      });
    } else if (asset.archetype === 'lyophilizer' || asset.archetype === 'autoclave') {
      pushAssetSensor('01', 'temperature', asset.archetype === 'lyophilizer' ? 'Shelf Temperature' : 'Chamber Sterilization Temp', {
        nominal: asset.archetype === 'lyophilizer' ? -38.5 : 121.4,
        minRange: asset.archetype === 'lyophilizer' ? -60 : 20,
        maxRange: asset.archetype === 'lyophilizer' ? 30 : 140,
        warnLow: asset.archetype === 'lyophilizer' ? -44 : 119.5,
        warnHigh: asset.archetype === 'lyophilizer' ? -32 : 123.5,
        alarmLow: asset.archetype === 'lyophilizer' ? -50 : 118.0,
        alarmHigh: asset.archetype === 'lyophilizer' ? -25 : 125.0,
        isMainSensor: true,
      });
      pushAssetSensor('02', 'vessel-pressure', asset.archetype === 'lyophilizer' ? 'Chamber Vacuum' : 'Steam Pressure', {
        unit: asset.archetype === 'lyophilizer' ? 'mbar' : 'bar',
        nominal: asset.archetype === 'lyophilizer' ? 0.12 : 2.1,
        minRange: 0,
        maxRange: asset.archetype === 'lyophilizer' ? 2 : 4,
        warnLow: asset.archetype === 'lyophilizer' ? 0.04 : 1.85,
        warnHigh: asset.archetype === 'lyophilizer' ? 0.3 : 2.35,
        alarmLow: asset.archetype === 'lyophilizer' ? 0.01 : 1.6,
        alarmHigh: asset.archetype === 'lyophilizer' ? 0.55 : 2.7,
        isMainSensor: false,
      });
    } else if (asset.archetype === 'lab-freezer' || asset.archetype === 'stability-chamber') {
      const isFreezer = asset.archetype === 'lab-freezer';
      pushAssetSensor('01', 'temperature', isFreezer ? 'Core Chamber Temp' : 'Stability Temp', {
        nominal: isFreezer ? -79.4 : 25.0,
        minRange: isFreezer ? -90 : 15,
        maxRange: isFreezer ? -55 : 45,
        warnLow: isFreezer ? -84 : 23.5,
        warnHigh: isFreezer ? -74 : 26.5,
        alarmLow: isFreezer ? -87 : 22.0,
        alarmHigh: isFreezer ? -70 : 28.0,
        isMainSensor: true,
      });
      if (!isFreezer) {
        pushAssetSensor('02', 'humidity', 'Stability Humidity', {
          nominal: 60.0,
          warnLow: 55,
          warnHigh: 65,
          alarmLow: 50,
          alarmHigh: 70,
          isMainSensor: false,
        });
      }
    } else if (asset.archetype === 'ahu-unit' || asset.archetype === 'chiller' || asset.archetype === 'wfi-skid') {
      const tId = pushAssetSensor('01', 'temperature', asset.archetype === 'wfi-skid' ? 'WFI Loop Temp' : 'Supply Temp', {
        nominal: asset.archetype === 'wfi-skid' ? 82.4 : asset.archetype === 'chiller' ? 6.5 : 18.2,
        minRange: 0,
        maxRange: 95,
        warnLow: asset.archetype === 'wfi-skid' ? 78 : asset.archetype === 'chiller' ? 4.5 : 15,
        warnHigh: asset.archetype === 'wfi-skid' ? 86 : asset.archetype === 'chiller' ? 8.5 : 21.5,
        alarmLow: asset.archetype === 'wfi-skid' ? 74 : asset.archetype === 'chiller' ? 2.5 : 12,
        alarmHigh: asset.archetype === 'wfi-skid' ? 90 : asset.archetype === 'chiller' ? 11.0 : 24,
        isMainSensor: true,
      });
      pushAssetSensor('02', 'power-kw', 'Active Power', {
        nominal: Math.max(2.5, asset.energyKw * 0.84),
        warnLow: 0.5,
        warnHigh: asset.energyKw * 1.12,
        alarmLow: 0.1,
        alarmHigh: asset.energyKw * 1.28,
        isMainSensor: false,
      });
      if (asset.archetype === 'chiller' && !firstChillerTempId) {
        firstChillerTempId = tId;
      }
    } else if (
      asset.archetype === 'filling-line' ||
      asset.archetype === 'isolator' ||
      asset.archetype === 'biosafety-cabinet' ||
      asset.archetype === 'vessel-tank'
    ) {
      pushAssetSensor('01', 'pressure', 'Enclosure Diff. Pressure', {
        nominal: 38.0,
        warnLow: 25,
        warnHigh: 52,
        alarmLow: 18,
        alarmHigh: 60,
        isMainSensor: true,
      });
      pushAssetSensor('02', 'particles', 'ISO 5 Particle Monitor', {
        nominal: 210,
        warnLow: 0,
        warnHigh: 1500,
        alarmLow: 0,
        alarmHigh: 3520,
        isMainSensor: false,
      });
    } else if (asset.category !== 'Furniture & Workplace') {
      pushAssetSensor('01', 'power-kw', 'Equipment Power', {
        nominal: Math.max(0.8, Number((asset.energyKw * 0.78).toFixed(1))),
        warnLow: 0.1,
        warnHigh: Math.max(3, asset.energyKw * 1.15),
        alarmLow: 0,
        alarmHigh: Math.max(5, asset.energyKw * 1.35),
        isMainSensor: true,
      });
      pushAssetSensor('02', 'vibration', 'Chassis Vibration', {
        nominal: 1.1,
        isMainSensor: false,
      });
    }
  });

  // 3. Cross-Room GMP Pressure Cascade Relationships (rooms on same floor sorted by pressurePa descending)
  const roomsByFloor = new Map<string, Room[]>();
  scene.rooms.forEach((r) => {
    const arr = roomsByFloor.get(r.floorId) ?? [];
    arr.push(r);
    roomsByFloor.set(r.floorId, arr);
  });

  roomsByFloor.forEach((floorRooms, flId) => {
    const sorted = [...floorRooms]
      .filter((r) => r.environmental.pressurePa > 0)
      .sort((a, b) => b.environmental.pressurePa - a.environmental.pressurePa);
    for (let i = 0; i < Math.min(sorted.length - 1, 3); i++) {
      const fromId = roomPrimaryPressureIds[sorted[i].id];
      const toId = roomPrimaryPressureIds[sorted[i + 1].id];
      if (fromId && toId) {
        relationships.push({
          id: `rel-cascade-${flId}-${i}`,
          sourceSensorId: fromId,
          targetSensorId: toId,
          type: 'cascades_to',
          label: `ΔP Cascade (${sorted[i].environmental.pressurePa}→${sorted[i + 1].environmental.pressurePa} Pa)`,
          description: `Positive GMP cleanroom pressure cascade from ${sorted[i].name} toward ${sorted[i + 1].name}.`,
          active: true,
        });
      }
    }
  });

  // Cross-system Chiller -> Bioreactor Jacket Cooling Loop
  if (firstChillerTempId && firstBioreactorSensors.temp) {
    relationships.push({
      id: 'rel-chiller-bioreactor',
      sourceSensorId: firstChillerTempId,
      targetSensorId: firstBioreactorSensors.temp,
      type: 'feeds_into',
      label: 'Chilled Glycol Jacket Loop',
      description: 'Process chiller chilled-water supply feeds the primary bioreactor thermal control jacket.',
      active: true,
    });
  }

  return { sensors, relationships };
}

/**
 * Stateful Mock Telemetry Database engine.
 * Can be instantiated in Express (`server.ts`) and also used as a local fallback in the browser.
 */
export class MockTelemetryDatabase {
  public sensors: SensorDefinition[] = [];
  public readings: Record<string, LiveSensorSnapshot> = {};
  public relationships: SensorRelationship[] = [];
  public activeScenario: string | null = null;
  private phaseMap: Record<string, number> = {};
  private tickCount = 0;

  constructor(initialScene?: DigitalTwinScene) {
    const scene = initialScene ?? createCinnaGenCampusScene();
    const { sensors, relationships } = generateDefaultSensorsForScene(scene);
    this.sensors = sensors;
    this.relationships = relationships;
    this.seedInitialHistory();
  }

  private seedInitialHistory() {
    const now = Date.now();
    const points = 32;
    this.sensors.forEach((s, idx) => {
      const phase = (idx * 1.37) % (Math.PI * 2);
      this.phaseMap[s.id] = phase;
      const history: SensorReadingPoint[] = [];
      const span = Math.max(0.05, (s.warnHigh - s.warnLow) * 0.14);

      for (let i = points - 1; i >= 0; i--) {
        const ts = now - i * 1500;
        const wave = Math.sin(phase + (points - i) * 0.24) * span * 0.55;
        const jitter = (Math.cos(phase * 2.1 + i * 1.7) * 0.25) * span;
        const rawVal = s.nominal + wave + jitter;
        const value = Number(rawVal.toFixed(s.precision));
        history.push({
          ts,
          value,
          status: evaluateSensorStatus(s, value),
        });
      }

      this.readings[s.id] = this.computeSnapshot(s, history);
    });
  }

  private computeSnapshot(sensor: SensorDefinition, history: SensorReadingPoint[]): LiveSensorSnapshot {
    const latest = history[history.length - 1];
    const prev = history[Math.max(0, history.length - 2)];
    const delta = Number((latest.value - prev.value).toFixed(sensor.precision + 1));
    const vals = history.map((h) => h.value);
    const minObserved = Math.min(...vals);
    const maxObserved = Math.max(...vals);
    const avgObserved = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(sensor.precision));
    const threshold = Math.max(0.005, (sensor.warnHigh - sensor.warnLow) * 0.008);
    const trend: LiveSensorSnapshot['trend'] =
      delta > threshold ? 'rising' : delta < -threshold ? 'falling' : 'stable';

    return {
      sensorId: sensor.id,
      value: latest.value,
      previousValue: prev.value,
      delta,
      trend,
      status: latest.status,
      minObserved,
      maxObserved,
      avgObserved,
      updatedAt: latest.ts,
      history,
    };
  }

  public tick() {
    this.tickCount += 1;
    const now = Date.now();

    this.sensors.forEach((s) => {
      const snap = this.readings[s.id];
      const phase = (this.phaseMap[s.id] ?? 0) + 0.22;
      this.phaseMap[s.id] = phase;

      const span = Math.max(0.04, (s.warnHigh - s.warnLow) * 0.16);
      let targetCenter = s.nominal;

      // Apply live simulated excursion scenarios if triggered
      if (this.activeScenario === 'bioreactor-thermal-excursion') {
        if (s.metric === 'temperature' && s.targetName.toLowerCase().includes('bioreactor')) {
          targetCenter = s.alarmHigh + 0.55;
        } else if (s.metric === 'dissolved-o2' && s.targetName.toLowerCase().includes('bioreactor')) {
          targetCenter = s.warnLow - 3.5;
        }
      } else if (this.activeScenario === 'cleanroom-pressure-drop') {
        if (s.metric === 'pressure' && s.targetKind === 'room' && s.nominal >= 20) {
          targetCenter = s.alarmLow - 3.0;
        }
      } else if (this.activeScenario === 'hplc-overpressure') {
        if (s.metric === 'vessel-pressure' && s.targetName.toLowerCase().includes('hplc')) {
          targetCenter = s.alarmHigh + 24;
        }
      } else if (this.activeScenario === 'humidity-spike') {
        if (s.metric === 'humidity' && s.targetKind === 'room') {
          targetCenter = s.warnHigh + 7.5;
        }
      }

      const prevVal = snap ? snap.value : s.nominal;
      const wave = Math.sin(phase) * span * 0.45 + (Math.random() - 0.5) * span * 0.35;
      // Smoothly ease toward targetCenter
      const nextRaw = prevVal + (targetCenter + wave - prevVal) * 0.38;
      const clamped = Math.max(s.minRange - 10, Math.min(s.maxRange + 40, nextRaw));
      const value = Number(clamped.toFixed(s.precision));
      const status = evaluateSensorStatus(s, value);

      const history = snap ? [...snap.history.slice(-47), { ts: now, value, status }] : [{ ts: now, value, status }];
      this.readings[s.id] = this.computeSnapshot(s, history);
    });
  }

  public addSensor(sensor: SensorDefinition): SensorDefinition {
    const exists = this.sensors.find((s) => s.id === sensor.id);
    if (exists) {
      return this.updateSensor(sensor.id, sensor) ?? sensor;
    }
    this.sensors.push(sensor);
    const now = Date.now();
    this.phaseMap[sensor.id] = Math.random() * Math.PI * 2;
    const history: SensorReadingPoint[] = [];
    for (let i = 19; i >= 0; i--) {
      const jitter = (Math.random() - 0.5) * Math.max(0.05, (sensor.warnHigh - sensor.warnLow) * 0.08);
      const val = Number((sensor.nominal + jitter).toFixed(sensor.precision));
      history.push({ ts: now - i * 1500, value: val, status: evaluateSensorStatus(sensor, val) });
    }
    this.readings[sensor.id] = this.computeSnapshot(sensor, history);
    return sensor;
  }

  public updateSensor(id: string, patch: Partial<SensorDefinition>): SensorDefinition | null {
    const idx = this.sensors.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const updated = { ...this.sensors[idx], ...patch, id };
    this.sensors[idx] = updated;
    if (this.readings[id]) {
      const updatedHist = this.readings[id].history.map((pt) => ({
        ...pt,
        status: evaluateSensorStatus(updated, pt.value),
      }));
      this.readings[id] = this.computeSnapshot(updated, updatedHist);
    }
    return updated;
  }

  public deleteSensor(id: string): boolean {
    const before = this.sensors.length;
    this.sensors = this.sensors.filter((s) => s.id !== id);
    delete this.readings[id];
    this.relationships = this.relationships.filter(
      (r) => r.sourceSensorId !== id && r.targetSensorId !== id
    );
    return this.sensors.length < before;
  }

  public addRelationship(rel: SensorRelationship): SensorRelationship {
    this.relationships = [...this.relationships.filter((r) => r.id !== rel.id), rel];
    return rel;
  }

  public deleteRelationship(id: string): boolean {
    const before = this.relationships.length;
    this.relationships = this.relationships.filter((r) => r.id !== id);
    return this.relationships.length < before;
  }

  public setScenario(scenario: string | null) {
    this.activeScenario = scenario;
    // Advance 3 ticks immediately so the user sees immediate response on heatmap & charts
    this.tick();
    this.tick();
  }

  public getSnapshot() {
    return {
      serverTime: Date.now(),
      source: 'mock-db' as const,
      activeScenario: this.activeScenario,
      sensors: this.sensors,
      readings: this.readings,
      relationships: this.relationships,
    };
  }
}
