import type { EquipmentCategory, SpatialAsset } from '../types/twin';
import type { EquipmentComplianceRecord } from '../types/gmp';
import {
  METRIC_PRESETS,
  type LiveSensorSnapshot,
  type SensorDefinition,
} from '../types/telemetry';

export type MaintenanceSeverity = 'critical' | 'warning' | 'advisory' | 'healthy';

export interface MaintenanceMilestone {
  id: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  floorId: string;
  buildingId: string;
  category: EquipmentCategory;
  predictedFailureDate: string; // YYYY-MM-DD
  recommendedServiceDate: string; // YYYY-MM-DD
  daysUntilFailure: number;
  severity: MaintenanceSeverity;
  confidencePct: number;
  healthScore: number; // 0-100
  driverSensorId: string;
  driverSensorTag: string;
  driverMetricLabel: string;
  currentValue: number;
  nominalValue: number;
  alarmThreshold: number;
  boundDirection: 'high' | 'low';
  unit: string;
  precision: number;
  driftPerDay: number;
  rSquared: number;
  sampleCount: number;
  recommendedAction: string;
}

export interface ForecastSeriesPoint {
  dayOffset: number; // negative = historical normalized window, 0 = now, positive = projected days
  value: number;
  kind: 'history' | 'forecast';
  dateLabel: string;
}

/** Deterministic small hash in [0, 1) to anchor stable baseline wear for nominal equipment */
function stableUnitHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function addDaysIso(baseDate: Date, days: number): string {
  const ts = baseDate.getTime() + Math.round(days) * 86_400_000;
  return new Date(ts).toISOString().slice(0, 10);
}

/** Ordinary Least Squares regression over sensor reading history */
function computeOlsStats(points: { ts: number; value: number }[]): {
  slopePerHour: number;
  rSquared: number;
  stdDev: number;
  mean: number;
} {
  const n = points.length;
  if (n < 2) {
    return {
      slopePerHour: 0,
      rSquared: 0,
      stdDev: 0,
      mean: points[0]?.value ?? 0,
    };
  }

  const t0 = points[0].ts;
  // Convert sample index/timestamps into normalized hours so short live streams still yield meaningful rates
  const xs = points.map((p, idx) => {
    const dtHours = (p.ts - t0) / 3_600_000;
    return dtHours > 0.0001 ? dtHours : idx * 0.05;
  });
  const ys = points.map((p) => p.value);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  const slope = sxx > 1e-9 ? sxy / sxx : 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = meanY + slope * (xs[i] - meanX);
    const err = ys[i] - pred;
    ssRes += err * err;
  }

  const rSquared = syy > 1e-9 ? Math.max(0, Math.min(1, 1 - ssRes / syy)) : 0;
  const stdDev = Math.sqrt(syy / n);

  return { slopePerHour: slope, rSquared, stdDev, mean: meanY };
}

function recommendedActionForSensor(sensor: SensorDefinition, severity: MaintenanceSeverity): string {
  const metric = sensor.metric;
  if (metric === 'temperature') {
    return severity === 'critical'
      ? 'Inspect jacket glycol/heating loop, recalibrate RTD probe & verify PID tuning immediately.'
      : 'Schedule thermal loop PM, check heat exchanger fouling & verify RTD zero-point drift.';
  }
  if (metric === 'vessel-pressure' || metric === 'pressure') {
    return severity === 'critical'
      ? 'Inspect pump seals, relief valve & HEPA/filter differential pressure; plan immediate shutoff window.'
      : 'Schedule seal & filter replacement and verify pressure transducer calibration.';
  }
  if (metric === 'vibration') {
    return severity === 'critical'
      ? 'Perform shaft alignment & bearing replacement before mechanical seizure.'
      : 'Schedule tribology/lubrication service and laser shaft alignment check.';
  }
  if (metric === 'humidity') {
    return severity === 'critical'
      ? 'Inspect AHU dehumidification coil, chilled water valve & chilled bypass damper.'
      : 'Schedule AHU coil service and capacitive RH probe recalibration.';
  }
  if (metric === 'ph' || metric === 'dissolved-o2' || metric === 'conductivity') {
    return severity === 'critical'
      ? 'Replace aging inline electrochemical sensor membrane & re-buffer two-point calibration.'
      : 'Schedule probe electrolyte replenishment and 2-point GMP buffer verification.';
  }
  if (metric === 'particles') {
    return severity === 'critical'
      ? 'Conduct immediate HEPA integrity DOP/PAO scan and inspect room airlock seals.'
      : 'Schedule HEPA pre-filter changeout and particle counter flow verification.';
  }
  if (metric === 'power-kw') {
    return severity === 'critical'
      ? 'Inspect compressor/VFD current draw, phase balance & thermal breaker contacts.'
      : 'Schedule electrical thermography inspection and load-balance check.';
  }
  return severity === 'critical'
    ? 'Execute corrective maintenance & sensor recalibration prior to GMP batch release.'
    : 'Include in upcoming preventive maintenance window and verify instrument drift.';
}

/**
 * Computes predicted asset failure dates and Maintenance Milestones from live sensor history.
 * Uses OLS drift regression + proximity to alarm thresholds + excursion ratio + compliance pressure.
 */
export function computeAssetFailurePredictions(
  sensors: SensorDefinition[],
  readings: Record<string, LiveSensorSnapshot>,
  assets: SpatialAsset[],
  complianceByAssetId?: Record<string, EquipmentComplianceRecord>,
  referenceDate: Date = new Date()
): MaintenanceMilestone[] {
  const milestones: MaintenanceMilestone[] = [];
  const assetById = new Map(assets.map((a) => [a.id, a]));

  // Group sensors by asset (direct asset sensors; if an asset has none, skip unless room-linked sensors don't apply)
  const sensorsByAssetId = new Map<string, SensorDefinition[]>();
  for (const s of sensors) {
    if (s.targetKind !== 'asset') continue;
    const arr = sensorsByAssetId.get(s.targetId) ?? [];
    arr.push(s);
    sensorsByAssetId.set(s.targetId, arr);
  }

  for (const [assetId, assetSensors] of sensorsByAssetId.entries()) {
    const asset = assetById.get(assetId);
    if (!asset || assetSensors.length === 0) continue;

    const comp = complianceByAssetId?.[asset.id];
    const hasOverdueCompliance =
      comp?.calibration.status === 'overdue' ||
      comp?.qualification.status === 'overdue' ||
      comp?.maintenance.status === 'overdue';
    const hasDueSoonCompliance =
      comp?.calibration.status === 'due-soon' ||
      comp?.qualification.status === 'due-soon' ||
      comp?.maintenance.status === 'due-soon';

    // Evaluate each sensor on this asset and pick the earliest / highest-risk failure driver
    let worstCandidate: MaintenanceMilestone | null = null;

    for (const sensor of assetSensors) {
      const snap = readings[sensor.id];
      const history = snap?.history ?? [];
      const currentValue = snap?.value ?? sensor.nominal;

      const { slopePerHour, rSquared, stdDev, mean } = computeOlsStats(history);

      // Compute normalized margin to high and low alarm limits
      const highSpan = Math.max(0.01, sensor.alarmHigh - sensor.nominal);
      const lowSpan = Math.max(0.01, sensor.nominal - sensor.alarmLow);

      const distToHigh = sensor.alarmHigh - currentValue;
      const distToLow = currentValue - sensor.alarmLow;
      const ratioHigh = Math.max(0, (currentValue - sensor.nominal) / highSpan);
      const ratioLow = Math.max(0, (sensor.nominal - currentValue) / lowSpan);

      const boundDirection: 'high' | 'low' =
        slopePerHour > 0.0001
          ? 'high'
          : slopePerHour < -0.0001
            ? 'low'
            : ratioHigh >= ratioLow
              ? 'high'
              : 'low';

      const alarmThreshold = boundDirection === 'high' ? sensor.alarmHigh : sensor.alarmLow;
      const activeSpan = boundDirection === 'high' ? highSpan : lowSpan;
      const remainingMargin =
        boundDirection === 'high' ? Math.max(0, distToHigh) : Math.max(0, distToLow);
      const marginPct = Math.max(0, Math.min(1, remainingMargin / activeSpan));

      // Count historical warning/alarm excursions
      const excursionCount = history.filter((pt) => pt.status !== 'nominal').length;
      const excursionRatio = history.length > 0 ? excursionCount / history.length : 0;

      // Convert short-window OLS slope into an annualized/daily engineering degradation rate
      // (dampened so normal random noise stays calm while real sustained drift accelerates failure)
      const signedSlope = boundDirection === 'high' ? slopePerHour : -slopePerHour;
      const effectiveSlopeMagnitude = Math.max(0, signedSlope);
      const normalizedVolatility = stdDev / Math.max(0.01, activeSpan);
      const seedOffset = stableUnitHash(`${asset.id}:${sensor.id}`);

      // Compute days until predicted failure
      let daysUntilFailure: number;
      const status = snap?.status ?? 'nominal';

      if (status === 'alarm' || remainingMargin <= activeSpan * 0.04) {
        // Active alarm or virtually at threshold: imminent failure within 2–6 days
        daysUntilFailure = Math.round(2 + seedOffset * 4);
      } else if (status === 'warning' || excursionRatio >= 0.25) {
        // Active drift / warning zone: 7–24 days based on remaining margin & slope
        const slopeAccel = Math.min(1, effectiveSlopeMagnitude * 0.8 + excursionRatio * 0.6);
        daysUntilFailure = Math.round(7 + marginPct * 16 * (1 - slopeAccel * 0.45));
      } else {
        // Combine baseline wear rate + observed sensor drift + volatility + compliance pressure
        // Scale daily drift realistically relative to active engineering span
        const baselineDailyFraction = 0.0045 + seedOffset * 0.0085 + normalizedVolatility * 0.035;
        const observedDailyFraction = Math.min(
          0.08,
          (effectiveSlopeMagnitude / Math.max(0.01, activeSpan)) * 0.14
        );
        const totalDailyFraction = Math.max(0.004, baselineDailyFraction + observedDailyFraction);
        let rawDays = marginPct / totalDailyFraction;

        if (hasOverdueCompliance) rawDays *= 0.48;
        else if (hasDueSoonCompliance) rawDays *= 0.76;

        // Quantize to nearest 2 days for calm visual stability across live polling ticks
        daysUntilFailure = Math.max(10, Math.min(220, Math.round(rawDays / 2) * 2));
      }

      // Apply compliance pull-in even for warning sensors
      if (hasOverdueCompliance && daysUntilFailure > 35) {
        daysUntilFailure = Math.round(daysUntilFailure * 0.6);
      }

      const driftPerDay = Number(
        (
          ((boundDirection === 'high' ? 1 : -1) * Math.max(remainingMargin, activeSpan * 0.06)) /
          Math.max(1, daysUntilFailure)
        ).toFixed(Math.min(4, sensor.precision + 2))
      );

      const severity: MaintenanceSeverity =
        daysUntilFailure <= 14
          ? 'critical'
          : daysUntilFailure <= 45
            ? 'warning'
            : daysUntilFailure <= 105
              ? 'advisory'
              : 'healthy';

      const healthScore = Math.max(
        12,
        Math.min(
          99,
          Math.round(
            marginPct * 58 +
              (1 - excursionRatio) * 24 +
              Math.min(1, daysUntilFailure / 150) * 18 -
              (status === 'alarm' ? 30 : status === 'warning' ? 14 : 0)
          )
        )
      );

      // Confidence increases with sample count, R², and clear signal deviation
      const sampleFactor = Math.min(1, history.length / 28);
      const signalClarity =
        status === 'alarm'
          ? 0.94
          : status === 'warning'
            ? 0.85
            : Math.min(0.88, 0.58 + rSquared * 0.28 + normalizedVolatility * 0.12);
      const confidencePct = Math.max(
        62,
        Math.min(97, Math.round((0.45 + sampleFactor * 0.55) * signalClarity * 100))
      );

      const serviceLeadDays = Math.max(1, Math.min(14, Math.round(daysUntilFailure * 0.25)));
      const predictedFailureDate = addDaysIso(referenceDate, daysUntilFailure);
      const recommendedServiceDate = addDaysIso(
        referenceDate,
        Math.max(1, daysUntilFailure - serviceLeadDays)
      );

      const metricLabel = METRIC_PRESETS[sensor.metric]?.label ?? sensor.metric;
      const candidate: MaintenanceMilestone = {
        id: `maint-${asset.id}`,
        assetId: asset.id,
        assetCode: asset.assetId || asset.equipmentId,
        assetName: asset.name,
        floorId: asset.floorId,
        buildingId: sensor.buildingId,
        category: asset.category,
        predictedFailureDate,
        recommendedServiceDate,
        daysUntilFailure,
        severity,
        confidencePct,
        healthScore,
        driverSensorId: sensor.id,
        driverSensorTag: sensor.tag,
        driverMetricLabel: metricLabel,
        currentValue: Number(currentValue.toFixed(sensor.precision)),
        nominalValue: Number(mean.toFixed(sensor.precision)),
        alarmThreshold,
        boundDirection,
        unit: sensor.unit,
        precision: sensor.precision,
        driftPerDay,
        rSquared: Number(rSquared.toFixed(2)),
        sampleCount: history.length,
        recommendedAction: recommendedActionForSensor(sensor, severity),
      };

      if (
        !worstCandidate ||
        candidate.daysUntilFailure < worstCandidate.daysUntilFailure ||
        (candidate.daysUntilFailure === worstCandidate.daysUntilFailure &&
          candidate.healthScore < worstCandidate.healthScore)
      ) {
        worstCandidate = candidate;
      }
    }

    if (worstCandidate) {
      milestones.push(worstCandidate);
    }
  }

  return milestones.sort((a, b) => a.daysUntilFailure - b.daysUntilFailure);
}

/**
 * Generates a unified history + projected degradation series for the Predictive Failure chart.
 */
export function buildSensorForecastSeries(
  sensor: SensorDefinition,
  snapshot: LiveSensorSnapshot | undefined,
  milestone: MaintenanceMilestone,
  referenceDate: Date = new Date()
): ForecastSeriesPoint[] {
  const history = snapshot?.history ?? [];
  const points: ForecastSeriesPoint[] = [];

  // Map recent sensor history across a normalized past window (-14d .. 0d)
  const histSlice = history.slice(-16);
  const histCount = Math.max(1, histSlice.length);
  histSlice.forEach((pt, idx) => {
    const ratio = histCount > 1 ? idx / (histCount - 1) : 1;
    const dayOffset = -Math.round((1 - ratio) * 14);
    points.push({
      dayOffset,
      value: pt.value,
      kind: 'history',
      dateLabel: addDaysIso(referenceDate, dayOffset),
    });
  });

  const startVal = snapshot?.value ?? milestone.currentValue;
  const horizonDays = Math.max(7, milestone.daysUntilFailure);
  const forecastSteps = 8;

  for (let step = 1; step <= forecastSteps; step++) {
    const frac = step / forecastSteps;
    const dayOffset = Math.round(horizonDays * frac);
    // Mild convex wear acceleration curve approaching the alarm threshold
    const curveFrac = 0.65 * frac + 0.35 * frac * frac;
    const projectedVal =
      startVal + (milestone.alarmThreshold - startVal) * curveFrac;
    points.push({
      dayOffset,
      value: Number(projectedVal.toFixed(sensor.precision + 1)),
      kind: 'forecast',
      dateLabel: addDaysIso(referenceDate, dayOffset),
    });
  }

  return points;
}
