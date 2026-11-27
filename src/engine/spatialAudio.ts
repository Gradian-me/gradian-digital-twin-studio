/**
 * Procedural 3D Spatial Audio Engine for First-Person & Third-Person MAYA Walkthrough.
 *
 * Synthesizes realistic, non-fatiguing facility soundscapes 100% via Web Audio API
 * (zero external audio files / zero 404s) with HRTF binaural panning and user-configurable
 * rolloff distance and falloff curves (linear, inverse, exponential) independently
 * for Machinery and Ventilation / HVAC sources.
 */
import type { Room, SpatialAsset } from '../types/twin';

export type SoundSourceCategory = 'hvac' | 'bioprocess' | 'chiller' | 'server' | 'lab' | 'utility';

export type SpatialDistanceModel = 'linear' | 'inverse' | 'exponential';

export interface SpatialAudioChannelConfig {
  /** Channel gain multiplier (0.0 – 1.5) */
  volume: number;
  /** Reference distance in meters where source plays at nominal full level (0.5 – 8.0m) */
  refDistance: number;
  /** Maximum rolloff distance in meters where source attenuates to floor (4 – 35m) */
  maxDistance: number;
  /** Attenuation steepness factor (0.2 – 4.0) */
  rolloffFactor: number;
  /** Web Audio distance falloff curve */
  distanceModel: SpatialDistanceModel;
}

export interface SpatialAudioSettings {
  masterVolume: number;
  machinery: SpatialAudioChannelConfig;
  ventilation: SpatialAudioChannelConfig;
}

export const DEFAULT_SPATIAL_AUDIO_SETTINGS: SpatialAudioSettings = {
  masterVolume: 0.68,
  machinery: {
    volume: 1.0,
    refDistance: 2.0,
    maxDistance: 14.0,
    rolloffFactor: 1.65,
    distanceModel: 'exponential',
  },
  ventilation: {
    volume: 0.9,
    refDistance: 3.2,
    maxDistance: 16.0,
    rolloffFactor: 1.35,
    distanceModel: 'inverse',
  },
};

/**
 * Exact Web Audio API attenuation curve evaluator (0..1) for a given distance in meters.
 * Used both for real-time voice scoring / acoustic dB estimation and for the live
 * falloff curve preview graph in the Spatial Audio Settings menu.
 */
export function computeSpatialAttenuation(
  distance: number,
  cfg: SpatialAudioChannelConfig
): number {
  const ref = Math.max(0.25, cfg.refDistance);
  const max = Math.max(ref + 0.5, cfg.maxDistance);
  const roll = Math.max(0.05, cfg.rolloffFactor);
  const d = Math.max(0, distance);

  if (cfg.distanceModel === 'linear') {
    const clamped = Math.min(Math.max(d, ref), max);
    return Math.max(0, 1 - roll * ((clamped - ref) / (max - ref)));
  }

  if (cfg.distanceModel === 'inverse') {
    if (d >= max) return 0;
    const clamped = Math.max(d, ref);
    const val = ref / (ref + roll * (clamped - ref));
    // Smooth taper into maxDistance so distant rooms silence cleanly
    const edgeFade = d > max * 0.85 ? Math.max(0, (max - d) / (max * 0.15)) : 1;
    return Math.max(0, Math.min(1, val * edgeFade));
  }

  // Exponential
  if (d >= max) return 0;
  const clamped = Math.max(d, ref);
  const val = Math.pow(clamped / ref, -roll);
  const edgeFade = d > max * 0.85 ? Math.max(0, (max - d) / (max * 0.15)) : 1;
  return Math.max(0, Math.min(1, val * edgeFade));
}

export interface SpatialSoundDescriptor {
  id: string;
  label: string;
  code: string;
  category: SoundSourceCategory;
  channel: 'machinery' | 'ventilation';
  x: number;
  y: number;
  z: number;
  baseGain: number;
  /** Relative distance multiplier for this specific asset/room */
  distanceScale: number;
  baseFreq: number;
  filterFreq: number;
}

export interface NearbyAudioTelemetry {
  active: boolean;
  dominantLabel: string;
  dominantCategory: SoundSourceCategory | null;
  dominantDistanceM: number | null;
  estimatedDb: number;
  activeSources: number;
  machinerySources: number;
  ventilationSources: number;
}

interface PooledSpatialVoice {
  assignedId: string | null;
  category: SoundSourceCategory;
  panner: PannerNode;
  gain: GainNode;
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  oscGain: GainNode;
  noiseSrc: AudioBufferSourceNode;
  noiseFilter: BiquadFilterNode;
  noiseGain: GainNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
}

function classifyAssetSound(asset: SpatialAsset): {
  category: SoundSourceCategory;
  baseFreq: number;
  filterFreq: number;
  baseGain: number;
  distanceScale: number;
} {
  const arch = asset.archetype;
  if (
    arch === 'chiller' ||
    arch === 'ahu-unit' ||
    arch === 'wfi-skid' ||
    arch === 'cold-room-unit' ||
    arch === 'lyophilizer' ||
    arch === 'lab-freezer'
  ) {
    return {
      category: 'chiller',
      baseFreq: 52,
      filterFreq: 260,
      baseGain: 0.25,
      distanceScale: 1.12,
    };
  }
  if (asset.category === 'IT & Data Center' || arch === 'electrical-panel') {
    return {
      category: 'server',
      baseFreq: 120,
      filterFreq: 1250,
      baseGain: 0.22,
      distanceScale: 0.92,
    };
  }
  if (
    arch === 'bioreactor-ss' ||
    arch === 'bioreactor-su' ||
    arch === 'filling-line' ||
    arch === 'autoclave' ||
    arch === 'vessel-tank' ||
    arch === 'conveyor'
  ) {
    return {
      category: 'bioprocess',
      baseFreq: 64,
      filterFreq: 420,
      baseGain: 0.23,
      distanceScale: 1.05,
    };
  }
  if (
    arch === 'biosafety-cabinet' ||
    arch === 'fume-hood' ||
    arch === 'isolator' ||
    arch === 'chromatography-skid' ||
    arch === 'filtration-skid' ||
    arch === 'hplc-instrument'
  ) {
    return {
      category: 'lab',
      baseFreq: 96,
      filterFreq: 760,
      baseGain: 0.18,
      distanceScale: 0.85,
    };
  }
  return {
    category: 'utility',
    baseFreq: 78,
    filterFreq: 380,
    baseGain: 0.15,
    distanceScale: 0.78,
  };
}

function createPinkNoiseBuffer(ctx: AudioContext, seconds = 3): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const out = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
    b6 = white * 0.115926;
  }
  return buffer;
}

export class FacilitySpatialAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voices: PooledSpatialVoice[] = [];
  private descriptors: SpatialSoundDescriptor[] = [];
  private enabled = false;
  private settings: SpatialAudioSettings = {
    masterVolume: DEFAULT_SPATIAL_AUDIO_SETTINGS.masterVolume,
    machinery: { ...DEFAULT_SPATIAL_AUDIO_SETTINGS.machinery },
    ventilation: { ...DEFAULT_SPATIAL_AUDIO_SETTINGS.ventilation },
  };
  private lastListenerX = 0;
  private lastListenerY = 1.66;
  private lastListenerZ = 0;
  private lastListenerYaw = 0;
  private lastListenerPitch = 0;
  private lastTelemetry: NearbyAudioTelemetry = {
    active: false,
    dominantLabel: 'Ambient Quiet',
    dominantCategory: null,
    dominantDistanceM: null,
    estimatedDb: 38,
    activeSources: 0,
    machinerySources: 0,
    ventilationSources: 0,
  };

  private readonly MAX_VOICES = 10;

  private ensureContext(): boolean {
    if (this.ctx) return true;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return false;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
      this.masterGain = master;

      this.noiseBuffer = createPinkNoiseBuffer(ctx, 3);

      // Build reusable HRTF spatial voice pool (prevents GC or oscillator leaks)
      for (let i = 0; i < this.MAX_VOICES; i++) {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = this.settings.machinery.distanceModel;
        panner.refDistance = this.settings.machinery.refDistance;
        panner.maxDistance = this.settings.machinery.maxDistance;
        panner.rolloffFactor = this.settings.machinery.rolloffFactor;
        panner.coneInnerAngle = 360;
        panner.coneOuterAngle = 360;

        const gain = ctx.createGain();
        gain.gain.value = 0.0001;

        const osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.value = 60;

        const osc2 = ctx.createOscillator();
        osc2.type = 'triangle';
        osc2.frequency.value = 120;

        const oscGain = ctx.createGain();
        oscGain.gain.value = 0.12;

        const noiseSrc = ctx.createBufferSource();
        noiseSrc.buffer = this.noiseBuffer;
        noiseSrc.loop = true;

        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 480;
        noiseFilter.Q.value = 1.1;

        const noiseGain = ctx.createGain();
        noiseGain.gain.value = 0.28;

        // Subtle organic LFO modulation for mechanical thrum / airflow shimmer
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.45 + (i % 4) * 0.18;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 1.8;
        lfo.connect(lfoGain);
        lfoGain.connect(osc1.frequency);

        osc1.connect(oscGain);
        osc2.connect(oscGain);
        oscGain.connect(gain);

        noiseSrc.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(gain);

        gain.connect(panner);
        panner.connect(master);

        osc1.start();
        osc2.start();
        noiseSrc.start();
        lfo.start();

        this.voices.push({
          assignedId: null,
          category: 'hvac',
          panner,
          gain,
          osc1,
          osc2,
          oscGain,
          noiseSrc,
          noiseFilter,
          noiseGain,
          lfo,
          lfoGain,
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  public getSettings(): SpatialAudioSettings {
    return {
      masterVolume: this.settings.masterVolume,
      machinery: { ...this.settings.machinery },
      ventilation: { ...this.settings.ventilation },
    };
  }

  public updateSettings(next: Partial<SpatialAudioSettings>): void {
    if (typeof next.masterVolume === 'number') {
      this.settings.masterVolume = Math.max(0, Math.min(1, next.masterVolume));
    }
    if (next.machinery) {
      this.settings.machinery = { ...this.settings.machinery, ...next.machinery };
    }
    if (next.ventilation) {
      this.settings.ventilation = { ...this.settings.ventilation, ...next.ventilation };
    }

    if (this.enabled && this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        Math.max(0.0001, this.settings.masterVolume),
        this.ctx.currentTime,
        0.06
      );
      // Immediately recompute voice panners & attenuation from last listener pose
      this.updateListener(
        this.lastListenerX,
        this.lastListenerY,
        this.lastListenerZ,
        this.lastListenerYaw,
        this.lastListenerPitch
      );
    }
  }

  public setEnabled(next: boolean): void {
    this.enabled = next;
    if (next) {
      if (!this.ensureContext() || !this.ctx || !this.masterGain) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const now = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(Math.max(0.001, this.settings.masterVolume), now, 0.12);
    } else if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(0.0001, now, 0.08);
      this.lastTelemetry = {
        ...this.lastTelemetry,
        active: false,
      };
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setMasterVolume(vol: number): void {
    this.updateSettings({ masterVolume: vol });
  }

  public syncFloorSources(rooms: Room[], assets: SpatialAsset[], floorElev: number): void {
    const next: SpatialSoundDescriptor[] = [];

    // 1. Room ventilation / cleanroom HVAC laminar airflow sources
    for (const room of rooms) {
      const ach =
        room.environmental.hvac?.airChangesPerHour ?? room.environmental.airChangesPerHour ?? 15;
      const isHighGrade =
        room.environmental.cleanroomGrade.includes('Grade A') ||
        room.environmental.cleanroomGrade.includes('Grade B');
      const achFactor = Math.min(1.4, Math.max(0.45, ach / 24));
      const roomSpan = Math.max(room.width, room.depth);
      next.push({
        id: `hvac-${room.id}`,
        label: `${room.code} Ventilation (${ach} ACH)`,
        code: room.code,
        category: 'hvac',
        channel: 'ventilation',
        x: room.x + room.width * 0.5,
        y: floorElev + Math.min(3.2, room.height - 0.35),
        z: room.z + room.depth * 0.5,
        baseGain: (isHighGrade ? 0.25 : 0.17) * achFactor,
        distanceScale: Math.max(0.75, Math.min(1.35, roomSpan / 10)),
        baseFreq: isHighGrade ? 105 : 74,
        filterFreq: isHighGrade ? 680 : 340,
      });
    }

    // 2. Active equipment acoustic emitters
    for (const asset of assets) {
      if (
        asset.hidden ||
        asset.operationalStatus === 'offline' ||
        asset.operationalStatus === 'planned'
      ) {
        continue;
      }
      if (
        asset.archetype === 'fire-extinguisher' ||
        asset.archetype === 'firebox-cabinet' ||
        asset.archetype === 'pallet-rack' ||
        asset.archetype === 'lab-bench' ||
        asset.archetype === 'pass-box'
      ) {
        continue;
      }
      const profile = classifyAssetSound(asset);
      const powerBoost = Math.min(1.35, 0.78 + Math.sqrt(Math.max(0.5, asset.energyKw || 1)) * 0.12);
      const standbyScale = asset.operationalStatus === 'standby' ? 0.55 : 1.0;

      next.push({
        id: `asset-${asset.id}`,
        label: `${asset.assetId} · ${asset.name}`,
        code: asset.assetId,
        category: profile.category,
        channel: 'machinery',
        x: asset.x,
        y: floorElev + asset.y + Math.min(1.6, asset.height * 0.55),
        z: asset.z,
        baseGain: profile.baseGain * powerBoost * standbyScale,
        distanceScale: profile.distanceScale,
        baseFreq: profile.baseFreq + ((asset.id.charCodeAt(asset.id.length - 1) % 7) - 3) * 1.4,
        filterFreq: profile.filterFreq,
      });
    }

    this.descriptors = next;
  }

  public updateListener(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.lastListenerX = x;
    this.lastListenerY = y;
    this.lastListenerZ = z;
    this.lastListenerYaw = yaw;
    this.lastListenerPitch = pitch;

    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const listener = this.ctx.listener;

    // Three.js camera forward vector for YXZ rotation (pitch, yaw, 0)
    const cosP = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cosP;
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * cosP;

    if (listener.positionX) {
      listener.positionX.setTargetAtTime(x, now, 0.04);
      listener.positionY.setTargetAtTime(y, now, 0.04);
      listener.positionZ.setTargetAtTime(z, now, 0.04);
      listener.forwardX.setTargetAtTime(fx, now, 0.04);
      listener.forwardY.setTargetAtTime(fy, now, 0.04);
      listener.forwardZ.setTargetAtTime(fz, now, 0.04);
      listener.upX.setTargetAtTime(0, now, 0.04);
      listener.upY.setTargetAtTime(1, now, 0.04);
      listener.upZ.setTargetAtTime(0, now, 0.04);
    } else {
      listener.setPosition(x, y, z);
      listener.setOrientation(fx, fy, fz, 0, 1, 0);
    }

    // Score descriptors using exact user-configured rolloff distance & falloff curve per channel
    const scored: Array<{
      d: SpatialSoundDescriptor;
      dist: number;
      attenuation: number;
      effectiveGain: number;
      effRef: number;
      effMax: number;
      rolloff: number;
      model: SpatialDistanceModel;
    }> = [];

    for (let i = 0; i < this.descriptors.length; i++) {
      const d = this.descriptors[i];
      const cfg =
        d.channel === 'ventilation' ? this.settings.ventilation : this.settings.machinery;
      if (cfg.volume <= 0.01) continue;

      const effRef = Math.max(0.4, cfg.refDistance * d.distanceScale);
      const effMax = Math.max(effRef + 1.0, cfg.maxDistance * d.distanceScale);
      const dist = Math.hypot(d.x - x, (d.y - y) * 0.6, d.z - z);
      if (dist > effMax) continue;

      const attenuation = computeSpatialAttenuation(dist, {
        ...cfg,
        refDistance: effRef,
        maxDistance: effMax,
      });
      const effectiveGain = d.baseGain * cfg.volume * attenuation;
      if (effectiveGain > 0.0025) {
        scored.push({
          d,
          dist,
          attenuation,
          effectiveGain,
          effRef,
          effMax,
          rolloff: cfg.rolloffFactor,
          model: cfg.distanceModel,
        });
      }
    }

    scored.sort((a, b) => b.effectiveGain - a.effectiveGain);
    const activeList = scored.slice(0, this.MAX_VOICES);

    let totalEnergy = 0;
    let machinerySources = 0;
    let ventilationSources = 0;

    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      const item = activeList[i];
      if (!item) {
        v.assignedId = null;
        v.gain.gain.setTargetAtTime(0.0001, now, 0.14);
        continue;
      }

      const { d, effectiveGain, effRef, effMax, rolloff, model } = item;
      const cfg =
        d.channel === 'ventilation' ? this.settings.ventilation : this.settings.machinery;
      totalEnergy += effectiveGain;
      if (d.channel === 'ventilation') ventilationSources++;
      else machinerySources++;

      if (v.panner.positionX) {
        v.panner.positionX.setTargetAtTime(d.x, now, 0.05);
        v.panner.positionY.setTargetAtTime(d.y, now, 0.05);
        v.panner.positionZ.setTargetAtTime(d.z, now, 0.05);
      } else {
        v.panner.setPosition(d.x, d.y, d.z);
      }
      // Apply user's exact distance falloff curve & rolloff parameters directly to the Web Audio HRTF PannerNode
      if (v.panner.distanceModel !== model) {
        v.panner.distanceModel = model;
      }
      v.panner.refDistance = effRef;
      v.panner.maxDistance = effMax;
      v.panner.rolloffFactor = rolloff;

      if (v.assignedId !== d.id) {
        v.assignedId = d.id;
        v.category = d.category;
        v.osc1.frequency.setTargetAtTime(d.baseFreq, now, 0.12);
        v.osc2.frequency.setTargetAtTime(d.baseFreq * 2.01, now, 0.12);
        v.noiseFilter.frequency.setTargetAtTime(d.filterFreq, now, 0.12);

        if (d.category === 'hvac') {
          v.oscGain.gain.setTargetAtTime(0.04, now, 0.12);
          v.noiseGain.gain.setTargetAtTime(0.56, now, 0.12);
          v.noiseFilter.Q.setTargetAtTime(0.75, now, 0.12);
        } else if (d.category === 'server') {
          v.oscGain.gain.setTargetAtTime(0.12, now, 0.12);
          v.noiseGain.gain.setTargetAtTime(0.42, now, 0.12);
          v.noiseFilter.Q.setTargetAtTime(1.8, now, 0.12);
        } else if (d.category === 'chiller') {
          v.oscGain.gain.setTargetAtTime(0.28, now, 0.12);
          v.noiseGain.gain.setTargetAtTime(0.22, now, 0.12);
          v.noiseFilter.Q.setTargetAtTime(1.2, now, 0.12);
        } else {
          v.oscGain.gain.setTargetAtTime(0.21, now, 0.12);
          v.noiseGain.gain.setTargetAtTime(0.24, now, 0.12);
          v.noiseFilter.Q.setTargetAtTime(1.1, now, 0.12);
        }
      }

      // Feed pre-panner source amplitude (PannerNode performs true 3D HRTF distance rolloff + binaural ITD/ILD)
      const prePannerGain = Math.min(0.65, d.baseGain * cfg.volume * 1.15);
      v.gain.gain.setTargetAtTime(Math.max(0.0001, prePannerGain), now, 0.1);
    }

    const top = activeList[0];
    this.lastTelemetry = {
      active: true,
      dominantLabel: top ? top.d.label : 'Corridor Ambient',
      dominantCategory: top ? top.d.category : null,
      dominantDistanceM: top ? Number(top.dist.toFixed(1)) : null,
      estimatedDb: Math.min(86, Math.round(38 + Math.sqrt(totalEnergy) * 32)),
      activeSources: activeList.length,
      machinerySources,
      ventilationSources,
    };
  }

  /** Audition a brief stereo spatialized test sound for Machinery or Ventilation in the Settings menu */
  public playTestCue(channel: 'machinery' | 'ventilation'): void {
    if (!this.ensureContext() || !this.ctx || !this.masterGain) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    const now = this.ctx.currentTime;
    const cfg =
      channel === 'ventilation' ? this.settings.ventilation : this.settings.machinery;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(Math.min(0.32, 0.18 * cfg.volume), now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
    g.connect(this.masterGain);

    if (channel === 'ventilation' && this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'bandpass';
      flt.frequency.setValueAtTime(520, now);
      flt.Q.setValueAtTime(0.8, now);
      src.connect(flt);
      flt.connect(g);
      src.start(now);
      src.stop(now + 0.75);
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(68, now);
      osc.frequency.exponentialRampToValueAtTime(92, now + 0.35);
      osc.frequency.exponentialRampToValueAtTime(64, now + 0.7);
      osc.connect(g);
      osc.start(now);
      osc.stop(now + 0.75);
    }
  }

  public playDoorCue(isOpen: boolean): void {
    if (!this.enabled || !this.ctx || !this.masterGain || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isOpen ? 210 : 320, now);
    osc.frequency.exponentialRampToValueAtTime(isOpen ? 360 : 170, now + 0.18);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  public playSwitchCue(isOn: boolean): void {
    if (!this.enabled || !this.ctx || !this.masterGain || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isOn ? 880 : 620, now);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.12, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.065);
  }

  public getTelemetry(): NearbyAudioTelemetry {
    return this.lastTelemetry;
  }

  public getListenerPosition(): { x: number; y: number; z: number } {
    return { x: this.lastListenerX, y: this.lastListenerY, z: this.lastListenerZ };
  }

  public dispose(): void {
    this.enabled = false;
    this.voices = [];
    this.descriptors = [];
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.masterGain = null;
    this.noiseBuffer = null;
  }
}
