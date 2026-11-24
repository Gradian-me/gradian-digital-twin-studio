export type HeatmapMetric = 'none' | 'temperature' | 'humidity' | 'pressure';

export type SensorMetricType =
  | 'temperature'
  | 'humidity'
  | 'pressure'
  | 'ph'
  | 'dissolved-o2'
  | 'agitation'
  | 'uv-absorbance'
  | 'flow-rate'
  | 'conductivity'
  | 'vessel-pressure'
  | 'power-kw'
  | 'vibration'
  | 'particles';

export type SensorProtocol =
  | 'OPC UA'
  | 'MQTT'
  | 'Modbus TCP'
  | 'BACnet'
  | 'HART'
  | 'REST API';

export type SensorStatus = 'nominal' | 'warning' | 'alarm';

export type SensorTargetKind = 'room' | 'asset';

export type SensorRelationshipType =
  | 'controls'
  | 'cascades_to'
  | 'redundant_backup'
  | 'interlocks'
  | 'correlates_with'
  | 'feeds_into';

export interface SensorDefinition {
  id: string;
  tag: string; // e.g., TT-BR2001-01, RHT-RM101-01, PT-HPLC01-01
  name: string;
  metric: SensorMetricType;
  unit: string;
  targetKind: SensorTargetKind;
  targetId: string; // room.id or asset.id
  targetName: string;
  targetCode: string;
  targetCategory: string;
  floorId: string;
  buildingId: string;
  // Spatial coordinates on floor (meters)
  x: number;
  y: number;
  z: number;
  // Thresholds & Engineering Specs
  nominal: number;
  minRange: number;
  maxRange: number;
  warnLow: number;
  warnHigh: number;
  alarmLow: number;
  alarmHigh: number;
  precision: number;
  isMainSensor: boolean; // Featured in 3D viewport indicator & primary equipment KPI
  protocol: SensorProtocol;
  plcAddress: string;
  samplingHz: number;
  calibrationDue: string;
  description?: string;
  isCustom?: boolean;
}

export interface SensorReadingPoint {
  ts: number; // epoch ms
  value: number;
  status: SensorStatus;
}

export interface LiveSensorSnapshot {
  sensorId: string;
  value: number;
  previousValue: number;
  delta: number;
  trend: 'rising' | 'falling' | 'stable';
  status: SensorStatus;
  minObserved: number;
  maxObserved: number;
  avgObserved: number;
  updatedAt: number;
  history: SensorReadingPoint[];
}

export interface SensorRelationship {
  id: string;
  sourceSensorId: string;
  targetSensorId: string;
  type: SensorRelationshipType;
  label: string;
  description: string;
  active: boolean;
}

export interface TelemetrySnapshotResponse {
  serverTime: number;
  source: 'mock-db';
  activeScenario: string | null;
  sensors: SensorDefinition[];
  readings: Record<string, LiveSensorSnapshot>;
  relationships: SensorRelationship[];
}

export const METRIC_PRESETS: Record<
  SensorMetricType,
  {
    label: string;
    isaPrefix: string;
    unit: string;
    nominal: number;
    minRange: number;
    maxRange: number;
    warnLow: number;
    warnHigh: number;
    alarmLow: number;
    alarmHigh: number;
    precision: number;
    color: string;
  }
> = {
  temperature: {
    label: 'Temperature',
    isaPrefix: 'TT',
    unit: '°C',
    nominal: 20.5,
    minRange: 14,
    maxRange: 30,
    warnLow: 18.0,
    warnHigh: 23.0,
    alarmLow: 16.5,
    alarmHigh: 25.0,
    precision: 2,
    color: '#F59E0B',
  },
  humidity: {
    label: 'Relative Humidity',
    isaPrefix: 'RHT',
    unit: '%RH',
    nominal: 45.0,
    minRange: 20,
    maxRange: 75,
    warnLow: 35.0,
    warnHigh: 55.0,
    alarmLow: 30.0,
    alarmHigh: 62.0,
    precision: 1,
    color: '#38BDF8',
  },
  pressure: {
    label: 'Differential Pressure',
    isaPrefix: 'DPT',
    unit: 'Pa',
    nominal: 30.0,
    minRange: -15,
    maxRange: 65,
    warnLow: 15.0,
    warnHigh: 50.0,
    alarmLow: 8.0,
    alarmHigh: 58.0,
    precision: 1,
    color: '#10B981',
  },
  ph: {
    label: 'Culture pH',
    isaPrefix: 'AIT',
    unit: 'pH',
    nominal: 7.12,
    minRange: 6.2,
    maxRange: 7.9,
    warnLow: 6.95,
    warnHigh: 7.3,
    alarmLow: 6.8,
    alarmHigh: 7.45,
    precision: 2,
    color: '#A78BFA',
  },
  'dissolved-o2': {
    label: 'Dissolved Oxygen',
    isaPrefix: 'DO',
    unit: '%sat',
    nominal: 42.0,
    minRange: 10,
    maxRange: 85,
    warnLow: 30.0,
    warnHigh: 55.0,
    alarmLow: 22.0,
    alarmHigh: 68.0,
    precision: 1,
    color: '#22D3EE',
  },
  agitation: {
    label: 'Impeller Agitation',
    isaPrefix: 'ST',
    unit: 'RPM',
    nominal: 145,
    minRange: 0,
    maxRange: 300,
    warnLow: 100,
    warnHigh: 195,
    alarmLow: 60,
    alarmHigh: 230,
    precision: 0,
    color: '#FB923C',
  },
  'uv-absorbance': {
    label: 'UV280 Absorbance',
    isaPrefix: 'UVT',
    unit: 'mAU',
    nominal: 420,
    minRange: 0,
    maxRange: 1200,
    warnLow: 100,
    warnHigh: 850,
    alarmLow: 30,
    alarmHigh: 1020,
    precision: 1,
    color: '#34D399',
  },
  'flow-rate': {
    label: 'Mobile Phase Flow',
    isaPrefix: 'FT',
    unit: 'mL/min',
    nominal: 1.25,
    minRange: 0,
    maxRange: 3.5,
    warnLow: 0.9,
    warnHigh: 1.65,
    alarmLow: 0.5,
    alarmHigh: 2.2,
    precision: 2,
    color: '#60A5FA',
  },
  conductivity: {
    label: 'Conductivity',
    isaPrefix: 'CT',
    unit: 'mS/cm',
    nominal: 14.2,
    minRange: 0,
    maxRange: 35,
    warnLow: 10.5,
    warnHigh: 18.0,
    alarmLow: 8.0,
    alarmHigh: 22.0,
    precision: 2,
    color: '#F472B6',
  },
  'vessel-pressure': {
    label: 'System Pressure',
    isaPrefix: 'PT',
    unit: 'bar',
    nominal: 0.45,
    minRange: 0,
    maxRange: 2.5,
    warnLow: 0.15,
    warnHigh: 0.9,
    alarmLow: 0.05,
    alarmHigh: 1.4,
    precision: 2,
    color: '#FBBF24',
  },
  'power-kw': {
    label: 'Electrical Load',
    isaPrefix: 'ET',
    unit: 'kW',
    nominal: 12.4,
    minRange: 0,
    maxRange: 45,
    warnLow: 1.0,
    warnHigh: 28.0,
    alarmLow: 0.2,
    alarmHigh: 36.0,
    precision: 1,
    color: '#F87171',
  },
  vibration: {
    label: 'Bearing Vibration',
    isaPrefix: 'VT',
    unit: 'mm/s',
    nominal: 1.15,
    minRange: 0,
    maxRange: 8,
    warnLow: 0,
    warnHigh: 3.2,
    alarmLow: 0,
    alarmHigh: 5.0,
    precision: 2,
    color: '#C084FC',
  },
  particles: {
    label: 'Airborne Particles ≥0.5µm',
    isaPrefix: 'PC',
    unit: 'p/m³',
    nominal: 1240,
    minRange: 0,
    maxRange: 5000,
    warnLow: 0,
    warnHigh: 2800,
    alarmLow: 0,
    alarmHigh: 3520,
    precision: 0,
    color: '#2DD4BF',
  },
};
