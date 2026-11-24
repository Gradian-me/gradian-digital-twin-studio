import { create } from 'zustand';
import type { DigitalTwinScene } from '../types/twin';
import type {
  HeatmapMetric,
  LiveSensorSnapshot,
  SensorDefinition,
  SensorRelationship,
} from '../types/telemetry';
import { MockTelemetryDatabase } from '../data/telemetryMockDb';

const CUSTOM_SENSORS_KEY = 'gradian_dt_custom_sensors_v1';
const CUSTOM_RELS_KEY = 'gradian_dt_custom_sensor_rels_v1';

// Local fallback engine if backend endpoint is temporarily unreachable
let localFallbackDb: MockTelemetryDatabase | null = null;
function getFallbackDb(scene?: DigitalTwinScene): MockTelemetryDatabase {
  if (!localFallbackDb) {
    localFallbackDb = new MockTelemetryDatabase(scene);
    // Rehydrate any custom local sensors
    try {
      const rawS = localStorage.getItem(CUSTOM_SENSORS_KEY);
      if (rawS) {
        const parsed: SensorDefinition[] = JSON.parse(rawS);
        parsed.forEach((s) => localFallbackDb?.addSensor(s));
      }
      const rawR = localStorage.getItem(CUSTOM_RELS_KEY);
      if (rawR) {
        const parsedR: SensorRelationship[] = JSON.parse(rawR);
        parsedR.forEach((r) => localFallbackDb?.addRelationship(r));
      }
    } catch {
      // ignore storage errors
    }
  }
  return localFallbackDb;
}

function persistCustomLocal(sensors: SensorDefinition[], relationships: SensorRelationship[]) {
  try {
    localStorage.setItem(
      CUSTOM_SENSORS_KEY,
      JSON.stringify(sensors.filter((s) => s.isCustom))
    );
    localStorage.setItem(CUSTOM_RELS_KEY, JSON.stringify(relationships));
  } catch {
    // ignore quota errors
  }
}

interface TelemetryState {
  // 3D Overlay controls
  heatmapMetric: HeatmapMetric;
  heatmapOpacity: number;
  show3DSensorPins: boolean;
  streamRunning: boolean;

  // Live telemetry data from Mock DB
  sensors: SensorDefinition[];
  readings: Record<string, LiveSensorSnapshot>;
  relationships: SensorRelationship[];
  activeScenario: string | null;
  serverTime: number;
  dataSource: 'mock-db-api' | 'local-fallback';
  loading: boolean;
  initialized: boolean;

  // Detailed Dashboard view state (in-app overlay or standalone new tab)
  dashboardOpen: boolean;
  dashboardTab: 'trends' | 'equipment' | 'define' | 'relationships';
  dashboardFocusAssetId: string | null;
  dashboardFocusSensorId: string | null;
  dashboardFocusRoomId: string | null;

  // Actions
  setHeatmapMetric: (metric: HeatmapMetric) => void;
  setHeatmapOpacity: (opacity: number) => void;
  setShow3DSensorPins: (show: boolean) => void;
  toggleStream: () => void;

  fetchLiveSnapshot: (scene?: DigitalTwinScene) => Promise<void>;
  createSensor: (sensor: SensorDefinition) => Promise<SensorDefinition>;
  updateSensor: (id: string, patch: Partial<SensorDefinition>) => Promise<void>;
  deleteSensor: (id: string) => Promise<void>;
  createRelationship: (rel: SensorRelationship) => Promise<SensorRelationship>;
  deleteRelationship: (id: string) => Promise<void>;
  triggerScenario: (scenario: string | null) => Promise<void>;

  openDashboard: (opts?: {
    assetId?: string | null;
    sensorId?: string | null;
    roomId?: string | null;
    tab?: TelemetryState['dashboardTab'];
  }) => void;
  closeDashboard: () => void;
  setDashboardTab: (tab: TelemetryState['dashboardTab']) => void;
  setDashboardFocus: (opts: {
    assetId?: string | null;
    sensorId?: string | null;
    roomId?: string | null;
  }) => void;
  buildTelemetryTabUrl: (opts?: {
    assetId?: string | null;
    sensorId?: string | null;
    roomId?: string | null;
    tab?: TelemetryState['dashboardTab'];
  }) => string;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  heatmapMetric: 'none',
  heatmapOpacity: 0.72,
  show3DSensorPins: true,
  streamRunning: true,

  sensors: [],
  readings: {},
  relationships: [],
  activeScenario: null,
  serverTime: Date.now(),
  dataSource: 'mock-db-api',
  loading: false,
  initialized: false,

  dashboardOpen: false,
  dashboardTab: 'trends',
  dashboardFocusAssetId: null,
  dashboardFocusSensorId: null,
  dashboardFocusRoomId: null,

  setHeatmapMetric: (metric) =>
    set((s) => ({
      heatmapMetric: metric,
      // Auto-enable 3D sensor indicators when user turns on a heatmap overlay
      show3DSensorPins: metric !== 'none' ? true : s.show3DSensorPins,
    })),

  setHeatmapOpacity: (opacity) =>
    set({ heatmapOpacity: Math.max(0.15, Math.min(0.95, opacity)) }),

  setShow3DSensorPins: (show) => set({ show3DSensorPins: show }),

  toggleStream: () => set((s) => ({ streamRunning: !s.streamRunning })),

  fetchLiveSnapshot: async (scene) => {
    try {
      const res = await fetch('/api/telemetry/snapshot');
      if (!res.ok) throw new Error('Telemetry API unavailable');
      const data = await res.json();
      set({
        sensors: data.sensors ?? [],
        readings: data.readings ?? {},
        relationships: data.relationships ?? [],
        activeScenario: data.activeScenario ?? null,
        serverTime: data.serverTime ?? Date.now(),
        dataSource: 'mock-db-api',
        initialized: true,
        loading: false,
      });
    } catch {
      const fb = getFallbackDb(scene);
      fb.tick();
      const snap = fb.getSnapshot();
      set({
        sensors: [...snap.sensors],
        readings: { ...snap.readings },
        relationships: [...snap.relationships],
        activeScenario: snap.activeScenario,
        serverTime: snap.serverTime,
        dataSource: 'local-fallback',
        initialized: true,
        loading: false,
      });
    }
  },

  createSensor: async (sensor) => {
    const newSensor: SensorDefinition = { ...sensor, isCustom: true };
    try {
      const res = await fetch('/api/telemetry/sensors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSensor),
      });
      if (!res.ok) throw new Error('Failed to create sensor');
      await get().fetchLiveSnapshot();
      persistCustomLocal(get().sensors, get().relationships);
      return newSensor;
    } catch {
      const fb = getFallbackDb();
      fb.addSensor(newSensor);
      const snap = fb.getSnapshot();
      set({
        sensors: [...snap.sensors],
        readings: { ...snap.readings },
      });
      persistCustomLocal(snap.sensors, snap.relationships);
      return newSensor;
    }
  },

  updateSensor: async (id, patch) => {
    try {
      const res = await fetch(`/api/telemetry/sensors/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update sensor');
      await get().fetchLiveSnapshot();
      persistCustomLocal(get().sensors, get().relationships);
    } catch {
      const fb = getFallbackDb();
      fb.updateSensor(id, patch);
      const snap = fb.getSnapshot();
      set({ sensors: [...snap.sensors], readings: { ...snap.readings } });
      persistCustomLocal(snap.sensors, snap.relationships);
    }
  },

  deleteSensor: async (id) => {
    try {
      const res = await fetch(`/api/telemetry/sensors/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete sensor');
      await get().fetchLiveSnapshot();
      persistCustomLocal(get().sensors, get().relationships);
    } catch {
      const fb = getFallbackDb();
      fb.deleteSensor(id);
      const snap = fb.getSnapshot();
      set({
        sensors: [...snap.sensors],
        readings: { ...snap.readings },
        relationships: [...snap.relationships],
      });
      persistCustomLocal(snap.sensors, snap.relationships);
    }
  },

  createRelationship: async (rel) => {
    try {
      const res = await fetch('/api/telemetry/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rel),
      });
      if (!res.ok) throw new Error('Failed to create relationship');
      await get().fetchLiveSnapshot();
      persistCustomLocal(get().sensors, get().relationships);
      return rel;
    } catch {
      const fb = getFallbackDb();
      fb.addRelationship(rel);
      const snap = fb.getSnapshot();
      set({ relationships: [...snap.relationships] });
      persistCustomLocal(snap.sensors, snap.relationships);
      return rel;
    }
  },

  deleteRelationship: async (id) => {
    try {
      const res = await fetch(`/api/telemetry/relationships/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete relationship');
      await get().fetchLiveSnapshot();
      persistCustomLocal(get().sensors, get().relationships);
    } catch {
      const fb = getFallbackDb();
      fb.deleteRelationship(id);
      const snap = fb.getSnapshot();
      set({ relationships: [...snap.relationships] });
      persistCustomLocal(snap.sensors, snap.relationships);
    }
  },

  triggerScenario: async (scenario) => {
    try {
      const res = await fetch('/api/telemetry/simulate-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      if (!res.ok) throw new Error('Failed to trigger scenario');
      await get().fetchLiveSnapshot();
    } catch {
      const fb = getFallbackDb();
      fb.setScenario(scenario);
      const snap = fb.getSnapshot();
      set({
        activeScenario: snap.activeScenario,
        readings: { ...snap.readings },
      });
    }
  },

  openDashboard: (opts) =>
    set({
      dashboardOpen: true,
      dashboardTab: opts?.tab ?? 'trends',
      dashboardFocusAssetId: opts?.assetId ?? null,
      dashboardFocusSensorId: opts?.sensorId ?? null,
      dashboardFocusRoomId: opts?.roomId ?? null,
    }),

  closeDashboard: () => set({ dashboardOpen: false }),

  setDashboardTab: (tab) => set({ dashboardTab: tab }),

  setDashboardFocus: (opts) =>
    set((s) => ({
      dashboardFocusAssetId: opts.assetId !== undefined ? opts.assetId : s.dashboardFocusAssetId,
      dashboardFocusSensorId: opts.sensorId !== undefined ? opts.sensorId : s.dashboardFocusSensorId,
      dashboardFocusRoomId: opts.roomId !== undefined ? opts.roomId : s.dashboardFocusRoomId,
    })),

  buildTelemetryTabUrl: (opts) => {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('mode', 'telemetry');
    if (opts?.tab) url.searchParams.set('tab', opts.tab);
    if (opts?.assetId) url.searchParams.set('assetId', opts.assetId);
    if (opts?.sensorId) url.searchParams.set('sensorId', opts.sensorId);
    if (opts?.roomId) url.searchParams.set('roomId', opts.roomId);
    return url.toString();
  },
}));
