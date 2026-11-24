import type { HeatmapMetric, LiveSensorSnapshot, SensorDefinition } from '../types/telemetry';
import type { Floor, Room } from '../types/twin';

export interface HeatmapScaleSpec {
  metric: Exclude<HeatmapMetric, 'none'>;
  label: string;
  unit: string;
  min: number;
  mid: number;
  max: number;
  stops: { t: number; rgb: [number, number, number]; hex: string }[];
}

export const HEATMAP_SCALES: Record<Exclude<HeatmapMetric, 'none'>, HeatmapScaleSpec> = {
  temperature: {
    metric: 'temperature',
    label: 'Temperature',
    unit: '°C',
    min: 15,
    mid: 21,
    max: 28,
    stops: [
      { t: 0.0, rgb: [30, 64, 175], hex: '#1E40AF' },   // Cold Blue
      { t: 0.25, rgb: [14, 165, 233], hex: '#0EA5E9' }, // Cool Cyan
      { t: 0.5, rgb: [16, 185, 129], hex: '#10B981' },  // Nominal Emerald
      { t: 0.75, rgb: [245, 158, 11], hex: '#F59E0B' }, // Warm Amber
      { t: 1.0, rgb: [239, 68, 68], hex: '#EF4444' },   // Hot Crimson
    ],
  },
  humidity: {
    metric: 'humidity',
    label: 'Relative Humidity',
    unit: '%RH',
    min: 25,
    mid: 45,
    max: 70,
    stops: [
      { t: 0.0, rgb: [217, 119, 6], hex: '#D97706' },   // Dry Ochre
      { t: 0.3, rgb: [16, 185, 129], hex: '#10B981' },  // Optimal GMP
      { t: 0.6, rgb: [6, 182, 212], hex: '#06B6D4' },   // Moist Cyan
      { t: 0.82, rgb: [37, 99, 235], hex: '#2563EB' },  // High Cobalt
      { t: 1.0, rgb: [124, 58, 237], hex: '#7C3AED' },  // Saturated Violet
    ],
  },
  pressure: {
    metric: 'pressure',
    label: 'Differential Pressure',
    unit: 'Pa',
    min: -5,
    mid: 20,
    max: 50,
    stops: [
      { t: 0.0, rgb: [220, 38, 38], hex: '#DC2626' },   // Negative / Containment
      { t: 0.25, rgb: [245, 158, 11], hex: '#F59E0B' }, // Low Cascade
      { t: 0.55, rgb: [16, 185, 129], hex: '#10B981' }, // Grade C/D Positive
      { t: 0.8, rgb: [14, 165, 233], hex: '#0EA5E9' },  // Grade B High Positive
      { t: 1.0, rgb: [99, 102, 241], hex: '#6366F1' },  // Grade A Core Cascade
    ],
  },
};

function sampleColorRamp(
  t: number,
  stops: HeatmapScaleSpec['stops']
): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const f = (clamped - a.t) / Math.max(0.0001, b.t - a.t);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1].rgb;
}

interface ProbePoint {
  x: number;
  z: number;
  value: number;
  tag: string;
  status: 'nominal' | 'warning' | 'alarm';
}

/**
 * Renders a smooth, room-aware Inverse Distance Weighting (IDW) environmental heatmap
 * with subtle iso-contour lines and probe reticles onto a reusable HTML5 Canvas.
 */
export function renderFloorHeatmapCanvas(
  canvas: HTMLCanvasElement,
  floor: Floor,
  rooms: Room[],
  sensors: SensorDefinition[],
  readings: Record<string, LiveSensorSnapshot>,
  metric: Exclude<HeatmapMetric, 'none'>
) {
  const resW = 192;
  const resH = Math.max(96, Math.round((floor.depth / Math.max(1, floor.width)) * resW));
  if (canvas.width !== resW || canvas.height !== resH) {
    canvas.width = resW;
    canvas.height = resH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const scale = HEATMAP_SCALES[metric];
  const floorRooms = rooms.filter((r) => r.floorId === floor.id);

  // Gather live sensor probes for this floor + metric (environmental probes + matching equipment thermal probes)
  const probes: ProbePoint[] = [];
  sensors
    .filter((s) => s.floorId === floor.id && s.metric === metric)
    .forEach((s) => {
      const snap = readings[s.id];
      const val = snap ? snap.value : s.nominal;
      // Exclude extreme sub-zero freezers or 121C autoclaves from skewing ambient room field unless zoomed
      if (metric === 'temperature' && (val < 0 || val > 55)) return;
      probes.push({
        x: s.x,
        z: s.z,
        value: val,
        tag: s.tag,
        status: snap?.status ?? 'nominal',
      });
    });

  // Fallback to room environmental specs if no live probes exist on a custom floor
  if (probes.length === 0) {
    floorRooms.forEach((r) => {
      const val =
        metric === 'temperature'
          ? r.environmental.temperatureC
          : metric === 'humidity'
            ? r.environmental.humidityPct
            : r.environmental.pressurePa;
      probes.push({
        x: r.x + r.width / 2,
        z: r.z + r.depth / 2,
        value: val,
        tag: r.code,
        status: 'nominal',
      });
    });
  }

  const imgData = ctx.createImageData(resW, resH);
  const data = imgData.data;
  const range = Math.max(0.001, scale.max - scale.min);

  // Precompute room bounds for slight boundary contrast
  const roomBounds = floorRooms.map((r) => ({
    x1: r.x,
    x2: r.x + r.width,
    z1: r.z,
    z2: r.z + r.depth,
    baseVal:
      metric === 'temperature'
        ? r.environmental.temperatureC
        : metric === 'humidity'
          ? r.environmental.humidityPct
          : r.environmental.pressurePa,
  }));

  for (let py = 0; py < resH; py++) {
    const wz = (py / (resH - 1)) * floor.depth;
    for (let px = 0; px < resW; px++) {
      const wx = (px / (resW - 1)) * floor.width;

      // Find enclosing room if any
      let insideRoom = false;
      for (let r = 0; r < roomBounds.length; r++) {
        const rb = roomBounds[r];
        if (wx >= rb.x1 && wx <= rb.x2 && wz >= rb.z1 && wz <= rb.z2) {
          insideRoom = true;
          break;
        }
      }

      // Smooth IDW interpolation across all live probes
      let weightedSum = 0;
      let weightTotal = 0;
      for (let i = 0; i < probes.length; i++) {
        const p = probes[i];
        const dx = wx - p.x;
        const dz = wz - p.z;
        const d2 = dx * dx + dz * dz + 1.45; // smoothing kernel radius
        const w = 1 / (d2 * Math.sqrt(d2));
        weightedSum += p.value * w;
        weightTotal += w;
      }

      const val = weightTotal > 0 ? weightedSum / weightTotal : scale.mid;
      const t = (val - scale.min) / range;
      const [r, g, b] = sampleColorRamp(t, scale.stops);

      // Subtle scientific iso-contour banding
      const contourLevels = 10;
      const frac = (Math.max(0, Math.min(1, t)) * contourLevels) % 1;
      const isContour = frac < 0.045 || frac > 0.955;

      const idx = (py * resW + px) * 4;
      data[idx] = isContour ? Math.min(255, r + 42) : r;
      data[idx + 1] = isContour ? Math.min(255, g + 42) : g;
      data[idx + 2] = isContour ? Math.min(255, b + 42) : b;
      data[idx + 3] = insideRoom ? 220 : 125;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Draw subtle crisp sensor probe reticles directly into the floor heatmap
  probes.forEach((p) => {
    const cx = (p.x / Math.max(1, floor.width)) * resW;
    const cz = (p.z / Math.max(1, floor.depth)) * resH;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cz, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = p.status === 'alarm' ? '#EF4444' : p.status === 'warning' ? '#F59E0B' : '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#09090B';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cz, 6.2, 0, Math.PI * 2);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
    ctx.restore();
  });
}
