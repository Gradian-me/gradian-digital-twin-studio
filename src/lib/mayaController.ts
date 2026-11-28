/**
 * MAYA Cinematic v3 — Three.js controller & GLB loader.
 * Drives native glTF quaternion tracks with smoothstep pose crossfades,
 * per-instance 5x5 facial atlas blending, natural eye blinking, and 4x4 status icons.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

export interface MayaStateConfig {
  duration: number;
  expression: MayaExpressionName;
  once?: boolean;
  returnToIdle?: boolean;
}

export const MAYA_EXPRESSIONS = [
  'neutral',
  'happy',
  'joyful',
  'wink',
  'surprised',
  'thinking',
  'curious',
  'confident',
  'love',
  'proud',
  'concerned',
  'confused',
  'annoyed',
  'tired',
  'sleeping',
  'dizzy',
  'error',
  'finished',
  'approval',
  'searching',
  'yawn',
] as const;

export type MayaExpressionName = (typeof MAYA_EXPRESSIONS)[number];
type MayaFaceTile = MayaExpressionName | 'blink';

export const MAYA_ICONS = [
  'dots',
  'question',
  'alert',
  'check',
  'heart',
  'stars',
  'sleep',
  'search',
  'clock',
  'spiral',
  'thumb',
  'idea',
  'anger',
  'confetti',
  'exclaim',
] as const;

export type MayaIconName = (typeof MAYA_ICONS)[number];

export const MAYA_STATES = Object.freeze({
  idle: { duration: 8, expression: 'neutral' },
  working: { duration: 3, expression: 'neutral' },
  thinking: { duration: 4, expression: 'thinking' },
  searching: { duration: 3.2, expression: 'curious' },
  approval: { duration: 2.6, expression: 'approval' },
  question: { duration: 3.6, expression: 'curious' },
  error: { duration: 2.5, expression: 'error' },
  finished: { duration: 2.2, expression: 'finished', once: true },
  ratelimit: { duration: 4, expression: 'concerned' },
  sleeping: { duration: 7, expression: 'sleeping' },
  dizzy: { duration: 3, expression: 'dizzy' },
  chat: { duration: 3, expression: 'happy' },
  wave: { duration: 2.8, expression: 'happy', once: true, returnToIdle: true },
  analyze: { duration: 4, expression: 'thinking' },
  present: { duration: 3.6, expression: 'confident' },
  create: { duration: 3.4, expression: 'joyful' },
  organize: { duration: 4, expression: 'neutral' },
  teach: { duration: 3.4, expression: 'confident' },
  support: { duration: 3.2, expression: 'happy' },
  celebrate: { duration: 2.6, expression: 'joyful', once: true, returnToIdle: true },
  laptop: { duration: 3.5, expression: 'neutral' },
} satisfies Record<string, MayaStateConfig>);

export type MayaStateName = keyof typeof MAYA_STATES;

export const MAYA_STATE_ICONS: Partial<Record<MayaStateName, MayaIconName>> = Object.freeze({
  working: 'dots',
  chat: 'dots',
  question: 'question',
  searching: 'search',
  approval: 'thumb',
  error: 'alert',
  finished: 'check',
  ratelimit: 'clock',
  sleeping: 'sleep',
  dizzy: 'spiral',
  create: 'idea',
  celebrate: 'confetti',
});

export const MAYA_EXPRESSION_ICONS: Partial<Record<MayaExpressionName, MayaIconName>> = Object.freeze({
  love: 'heart',
  proud: 'stars',
  surprised: 'exclaim',
  confused: 'spiral',
  annoyed: 'anger',
  sleeping: 'sleep',
  dizzy: 'spiral',
  error: 'alert',
  finished: 'check',
  approval: 'thumb',
  searching: 'search',
  curious: 'question',
  yawn: 'sleep',
  joyful: 'stars',
});

const FACE_TILES: readonly MayaFaceTile[] = [...MAYA_EXPRESSIONS, 'blink'];

const NAME_ALIASES: Record<string, string> = {
  work: 'working',
  think: 'thinking',
  rate_limit: 'ratelimit',
  'rate-limit': 'ratelimit',
  none: 'neutral',
};

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export interface MayaControllerOptions {
  fade?: number;
  faceFade?: number;
  reducedMotion?: boolean;
  autoReturn?: boolean;
  onStateChange?: (state: MayaStateName) => void;
  onFinished?: (state: MayaStateName) => void;
}

interface BoundTrack {
  node: THREE.Object3D;
  interpolant: THREE.Interpolant;
}

export class MayaController {
  readonly scene: THREE.Object3D;
  private readonly face: THREE.Mesh;
  private readonly badge: THREE.Object3D;
  private readonly iconMesh: THREE.Mesh;
  private readonly tracks: Map<string, BoundTrack[]>;
  private readonly nodes: THREE.Object3D[];
  private readonly tmp = new THREE.Quaternion();
  private from = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly faceSource: THREE.MeshStandardMaterial;
  private readonly iconSource: THREE.MeshStandardMaterial;
  private readonly atlas: CanvasImageSource & { width: number; height: number };
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map: THREE.CanvasTexture;
  private readonly iconMap: THREE.Texture;

  private readonly fade: number;
  private readonly faceFade: number;
  private reducedMotion: boolean;
  private readonly autoReturn: boolean;
  private readonly onStateChange: (state: MayaStateName) => void;
  private readonly onFinished: (state: MayaStateName) => void;

  current: MayaStateName = 'idle';
  expression: MayaExpressionName = 'neutral';
  private elapsed = 0;
  private currentFade = 0;
  private transition = 1;
  private completed = false;
  private faceFrom: MayaFaceTile = 'neutral';
  private faceTo: MayaFaceTile = 'neutral';
  private faceBlend = 1;
  private lastPaint = '';
  private iconCurrent: MayaIconName | '' = '';
  private iconTarget: MayaIconName | '' = '';
  private iconScale = 0;
  private manualFace = false;
  private disposed = false;

  isGowned = false;
  private gownNodes: THREE.Object3D[] = [];
  private gownDisposables: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } = {
    geometries: [],
    materials: [],
  };
  private origMeshMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private poloHideMeshes: THREE.Object3D[] = [];
  private suitCoverallMeshes: THREE.Mesh[] = [];
  private gloveMeshes: THREE.Mesh[] = [];
  private trouserMeshes: THREE.Mesh[] = [];
  private bootMeshes: THREE.Mesh[] = [];
  private gownCoverallMat: THREE.MeshStandardMaterial | null = null;
  private gownGloveMat: THREE.MeshStandardMaterial | null = null;
  private gownTrouserMat: THREE.MeshStandardMaterial | null = null;
  private gownBootMat: THREE.MeshStandardMaterial | null = null;

  constructor(
    gltf: GLTF,
    {
      fade = 0.52,
      faceFade = 0.18,
      reducedMotion = false,
      autoReturn = true,
      onStateChange = () => {},
      onFinished = () => {},
    }: MayaControllerOptions = {}
  ) {
    this.scene = gltf.scene;
    const faceObj = this.scene.getObjectByName('FaceAtlas') as THREE.Mesh | undefined;
    const badgeObj = this.scene.getObjectByName('StatusIcon');
    const iconObj = this.scene.getObjectByName('StatusIconAtlas') as THREE.Mesh | undefined;

    const faceMat = faceObj?.material as THREE.MeshStandardMaterial | undefined;
    const iconMat = iconObj?.material as THREE.MeshStandardMaterial | undefined;

    if (!faceObj || !faceMat?.map || !iconObj || !iconMat?.map || !badgeObj) {
      throw new Error('Expected MAYA Cinematic v3 GLB');
    }

    this.face = faceObj;
    this.badge = badgeObj;
    this.iconMesh = iconObj;
    this.faceSource = faceMat;
    this.iconSource = iconMat;

    this.tracks = new Map(
      gltf.animations.map((clip) => [
        clip.name,
        clip.tracks.map((track) => {
          const parsed = THREE.PropertyBinding.parseTrackName(track.name);
          const nodeName = parsed.nodeName;
          const node =
            this.scene.getObjectByName(nodeName) ||
            this.scene.getObjectByProperty('uuid', nodeName);
          if (!node || !track.name.endsWith('.quaternion')) {
            throw new Error(`Unrecognized MAYA animation track: ${track.name}`);
          }
          const createInterpolant = (
            track as THREE.KeyframeTrack & {
              createInterpolant: (result?: Float32Array) => THREE.Interpolant;
            }
          ).createInterpolant.bind(track);
          return {
            node,
            interpolant: createInterpolant(new Float32Array(4)),
          };
        }),
      ])
    );

    const uniqueNodes = new Set<THREE.Object3D>();
    this.tracks.forEach((list) => {
      list.forEach((t) => uniqueNodes.add(t.node));
    });
    this.nodes = Array.from(uniqueNodes);

    const image = this.faceSource.map?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
    if (!image?.width || !image?.height) {
      throw new Error('MAYA facial texture not decoded');
    }

    this.atlas = image as CanvasImageSource & { width: number; height: number };
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.round(image.width / 5));
    this.canvas.height = Math.max(1, Math.round(image.height / 5));
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas2D required for MAYA face crossfades');
    }
    this.ctx = ctx;

    const clonedFaceMat = this.faceSource.clone();
    this.map = new THREE.CanvasTexture(this.canvas);
    this.map.colorSpace = this.faceSource.map!.colorSpace;
    this.map.flipY = false;
    this.map.repeat.set(5, 5);
    this.map.minFilter = THREE.LinearFilter;
    this.map.magFilter = THREE.LinearFilter;
    this.map.generateMipmaps = false;
    clonedFaceMat.map = this.map;
    this.face.material = clonedFaceMat;

    const clonedIconMat = this.iconSource.clone();
    this.iconMap = this.iconSource.map!.clone();
    this.iconMap.minFilter = THREE.LinearFilter;
    this.iconMap.generateMipmaps = false;
    this.iconMap.needsUpdate = true;
    clonedIconMat.map = this.iconMap;
    this.iconMesh.material = clonedIconMat;

    this.fade = fade;
    this.faceFade = faceFade;
    this.reducedMotion = reducedMotion;
    this.autoReturn = autoReturn;
    this.onStateChange = onStateChange;
    this.onFinished = onFinished;

    this.buildCleanroomGownRig();
    this.paintFace(true);
    this.setState('idle', { fade: 0 });
  }

  /**
   * Builds a full Grade A/B Sterile Cleanroom Bunny Suit overlay attached directly
   * to MAYA's animated bones (HeadPivot, TorsoPivot, Elbow_L/R, Leg_L/R) so every
   * head turn, wave, walk stride, and jump moves the sterile PPE naturally.
   */
  private buildCleanroomGownRig() {
    this.gownCoverallMat = new THREE.MeshStandardMaterial({
      color: 0xf1f7fe,
      roughness: 0.42,
      metalness: 0.04,
    });
    this.gownTrouserMat = new THREE.MeshStandardMaterial({
      color: 0xeaf4fd,
      roughness: 0.44,
      metalness: 0.04,
    });
    this.gownGloveMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      roughness: 0.28,
      metalness: 0.06,
    });
    this.gownBootMat = new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      roughness: 0.36,
      metalness: 0.08,
    });
    const trimCyanMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.32,
      metalness: 0.12,
    });
    const maskMat = new THREE.MeshStandardMaterial({
      color: 0xbae6fd,
      roughness: 0.55,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const goggleFrameMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
      metalness: 0.08,
    });
    const visorGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x7dd3fc,
      roughness: 0.08,
      metalness: 0.05,
      transparent: true,
      opacity: 0.34,
      transmission: 0.25,
      clearcoat: 1.0,
      depthWrite: false,
    });
    const badgeMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0369a1,
      emissiveIntensity: 0.32,
      roughness: 0.28,
      metalness: 0.15,
    });

    this.gownDisposables.materials.push(
      this.gownCoverallMat,
      this.gownTrouserMat,
      this.gownGloveMat,
      this.gownBootMat,
      trimCyanMat,
      maskMat,
      goggleFrameMat,
      visorGlassMat,
      badgeMat
    );

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.gownDisposables.geometries.push(g);
      return g;
    };

    // Catalog original clothing/limb meshes for clean material toggling
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const n = obj.name;
      if (/^(LongPolo|Sleeve_|CollarStand)/.test(n)) {
        this.origMeshMaterials.set(mesh, mesh.material);
        this.suitCoverallMeshes.push(mesh);
      } else if (/^(PointedCollar|WhiteCollarEdge|RedCollarEdge|Placket|Button|GradianLogo)/.test(n)) {
        this.poloHideMeshes.push(obj);
      } else if (/^ForearmMitten_/.test(n)) {
        this.origMeshMaterials.set(mesh, mesh.material);
        this.gloveMeshes.push(mesh);
      } else if (/^LegShape_/.test(n)) {
        this.origMeshMaterials.set(mesh, mesh.material);
        this.trouserMeshes.push(mesh);
      } else if (/^Foot_/.test(n)) {
        this.origMeshMaterials.set(mesh, mesh.material);
        this.bootMeshes.push(mesh);
      }
    });

    // 1. HeadPivot: Full Sterile Cleanroom Hood + Anti-Fog Goggles + Surgical Face Mask
    const headPivot = this.scene.getObjectByName('HeadPivot');
    if (headPivot) {
      const headGown = new THREE.Group();
      headGown.name = 'MAYA_CleanroomHood';
      headGown.visible = false;

      // Sculpted ellipsoid hood shell wrapping top, back, and sides while keeping front face window clear
      // Maya's head spans x:[-0.62,0.62], y:[0.01,0.99], z:[-0.49,0.49] centered at (0, 0.50, 0)
      const hoodGeo = trackGeo(new THREE.SphereGeometry(1, 32, 24, Math.PI * 0.72, Math.PI * 1.56, 0.02, Math.PI * 0.94));
      const hoodMesh = new THREE.Mesh(hoodGeo, this.gownCoverallMat);
      hoodMesh.scale.set(0.655, 0.525, 0.525);
      hoodMesh.position.set(0, 0.505, -0.015);
      // Rotate so open aperture faces +Z (MAYA's face)
      hoodMesh.rotation.y = Math.PI * 0.5;
      hoodMesh.castShadow = true;
      hoodMesh.receiveShadow = true;
      headGown.add(hoodMesh);

      // Upper crown cap closing top of head seamlessly
      const crownGeo = trackGeo(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.42));
      const crownMesh = new THREE.Mesh(crownGeo, this.gownCoverallMat);
      crownMesh.scale.set(0.65, 0.52, 0.52);
      crownMesh.position.set(0, 0.515, -0.005);
      crownMesh.castShadow = true;
      headGown.add(crownMesh);

      // Cyan elastic hood face-aperture seal ring framing MAYA's face
      const sealGeo = trackGeo(new THREE.TorusGeometry(0.42, 0.028, 12, 36));
      const sealMesh = new THREE.Mesh(sealGeo, trimCyanMat);
      sealMesh.scale.set(1.12, 0.96, 0.65);
      sealMesh.position.set(0, 0.48, 0.35);
      headGown.add(sealMesh);

      // Neck drape connecting hood smoothly down into coverall shoulders
      const drapeGeo = trackGeo(new THREE.CylinderGeometry(0.32, 0.44, 0.24, 24, 1, true));
      const drapeMesh = new THREE.Mesh(drapeGeo, this.gownCoverallMat);
      drapeMesh.scale.set(1.0, 1.0, 0.78);
      drapeMesh.position.set(0, 0.03, -0.02);
      headGown.add(drapeMesh);

      // Sterile Anti-Fog Cleanroom Goggles (curved translucent lens + white silicone rim)
      const visorGeo = trackGeo(
        new THREE.CylinderGeometry(0.545, 0.545, 0.24, 28, 1, true, -Math.PI * 0.34, Math.PI * 0.68)
      );
      const visorMesh = new THREE.Mesh(visorGeo, visorGlassMat);
      visorMesh.scale.set(1.08, 1.0, 0.96);
      visorMesh.position.set(0, 0.57, 0.03);
      headGown.add(visorMesh);

      const goggleTopRimGeo = trackGeo(
        new THREE.TorusGeometry(0.535, 0.022, 10, 28, Math.PI * 0.68)
      );
      const goggleTopRim = new THREE.Mesh(goggleTopRimGeo, goggleFrameMat);
      goggleTopRim.rotation.x = Math.PI / 2;
      goggleTopRim.rotation.z = Math.PI * 0.16;
      goggleTopRim.scale.set(1.08, 0.96, 1.0);
      goggleTopRim.position.set(0, 0.685, 0.03);
      headGown.add(goggleTopRim);

      const goggleBotRim = new THREE.Mesh(goggleTopRimGeo, goggleFrameMat);
      goggleBotRim.rotation.x = Math.PI / 2;
      goggleBotRim.rotation.z = Math.PI * 0.16;
      goggleBotRim.scale.set(1.08, 0.96, 1.0);
      goggleBotRim.position.set(0, 0.455, 0.03);
      headGown.add(goggleBotRim);

      // Elastic goggle strap wrapping behind hood
      const strapGeo = trackGeo(new THREE.TorusGeometry(0.56, 0.022, 8, 32));
      const strapMesh = new THREE.Mesh(strapGeo, trimCyanMat);
      strapMesh.rotation.x = Math.PI / 2;
      strapMesh.scale.set(1.16, 0.94, 1.0);
      strapMesh.position.set(0, 0.57, -0.01);
      headGown.add(strapMesh);

      // Sterile Cleanroom Face Mask covering lower chin/mouth area
      const maskGeo = trackGeo(
        new THREE.CylinderGeometry(0.525, 0.48, 0.21, 24, 1, true, -Math.PI * 0.3, Math.PI * 0.6)
      );
      const maskMesh = new THREE.Mesh(maskGeo, maskMat);
      maskMesh.scale.set(1.08, 1.0, 0.96);
      maskMesh.position.set(0, 0.29, 0.04);
      headGown.add(maskMesh);

      headPivot.add(headGown);
      this.gownNodes.push(headGown);
    }

    // 2. TorsoPivot: Front Sterile Zipper Seam, Waist Seal Belt & Grade A/B Chest Badge
    const torsoPivot = this.scene.getObjectByName('TorsoPivot');
    if (torsoPivot) {
      const torsoGown = new THREE.Group();
      torsoGown.name = 'MAYA_CleanroomTorso';
      torsoGown.visible = false;

      // Vertical sterile front zipper track
      const zipGeo = trackGeo(new THREE.BoxGeometry(0.036, 0.56, 0.024));
      const zipMesh = new THREE.Mesh(zipGeo, trimCyanMat);
      zipMesh.position.set(0, 0.39, 0.258);
      torsoGown.add(zipMesh);

      // Zipper pull tab near collar
      const pullGeo = trackGeo(new THREE.BoxGeometry(0.055, 0.04, 0.032));
      const pullMesh = new THREE.Mesh(pullGeo, goggleFrameMat);
      pullMesh.position.set(0, 0.65, 0.264);
      torsoGown.add(pullMesh);

      // Sterile chest badge (Grade A/B Cleanroom ID)
      const badgeGeo = trackGeo(new THREE.BoxGeometry(0.115, 0.075, 0.02));
      const badgeMesh = new THREE.Mesh(badgeGeo, badgeMat);
      badgeMesh.position.set(0.155, 0.49, 0.245);
      badgeMesh.rotation.y = 0.26;
      torsoGown.add(badgeMesh);

      // Waist elastic seal band
      const waistGeo = trackGeo(new THREE.TorusGeometry(0.32, 0.024, 10, 32));
      const waistMesh = new THREE.Mesh(waistGeo, trimCyanMat);
      waistMesh.rotation.x = Math.PI / 2;
      waistMesh.scale.set(1.13, 0.82, 1.0);
      waistMesh.position.set(0, 0.19, 0);
      torsoGown.add(waistMesh);

      torsoPivot.add(torsoGown);
      this.gownNodes.push(torsoGown);
    }

    // 3. Wrist Elastic Cuff Seals on Elbow_L & Elbow_R
    for (const elbowName of ['Elbow_L', 'Elbow_R']) {
      const elbow = this.scene.getObjectByName(elbowName);
      if (!elbow) continue;
      const cuffGeo = trackGeo(new THREE.TorusGeometry(0.108, 0.018, 10, 20));
      const cuff = new THREE.Mesh(cuffGeo, trimCyanMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, -0.015, 0.005);
      cuff.visible = false;
      elbow.add(cuff);
      this.gownNodes.push(cuff);
    }

    // 4. Cleanroom Boot Cuff Straps on Leg_L & Leg_R
    for (const legName of ['Leg_L', 'Leg_R']) {
      const leg = this.scene.getObjectByName(legName);
      if (!leg) continue;
      const bootStrapGeo = trackGeo(new THREE.TorusGeometry(0.125, 0.02, 10, 20));
      const bootStrap = new THREE.Mesh(bootStrapGeo, trimCyanMat);
      bootStrap.rotation.x = Math.PI / 2;
      bootStrap.position.set(0, -0.21, 0.015);
      bootStrap.visible = false;
      leg.add(bootStrap);
      this.gownNodes.push(bootStrap);
    }
  }

  /**
   * Toggles MAYA between her standard Gradian.me navy polo uniform and a full
   * EU GMP Grade A/B sterile cleanroom gown (bunny suit, hood, goggles, mask, nitrile gloves & over-boots).
   */
  setGowned(gowned: boolean): this {
    if (this.disposed) return this;
    const next = Boolean(gowned);
    if (this.isGowned === next) return this;
    this.isGowned = next;

    for (const node of this.gownNodes) {
      node.visible = next;
    }
    for (const obj of this.poloHideMeshes) {
      obj.visible = !next;
    }

    if (next) {
      if (this.gownCoverallMat) {
        for (const m of this.suitCoverallMeshes) m.material = this.gownCoverallMat;
      }
      if (this.gownGloveMat) {
        for (const m of this.gloveMeshes) m.material = this.gownGloveMat;
      }
      if (this.gownTrouserMat) {
        for (const m of this.trouserMeshes) m.material = this.gownTrouserMat;
      }
      if (this.gownBootMat) {
        for (const m of this.bootMeshes) m.material = this.gownBootMat;
      }
    } else {
      this.origMeshMaterials.forEach((mat, mesh) => {
        mesh.material = mat;
      });
    }
    return this;
  }

  private drawCell(name: MayaFaceTile, alpha: number) {
    const idx = FACE_TILES.indexOf(name);
    if (idx < 0) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.atlas, (idx % 5) * w, Math.floor(idx / 5) * h, w, h, 0, 0, w, h);
  }

  private paintFace(force = false) {
    const key = `${this.faceFrom}/${this.faceTo}/${this.faceBlend.toFixed(3)}`;
    if (!force && this.lastPaint === key) return;
    this.lastPaint = key;
    this.ctx.globalAlpha = 1;
    this.drawCell(this.faceFrom, 1);
    this.drawCell(this.faceTo, smoothstep(this.faceBlend));
    this.ctx.globalAlpha = 1;
    this.map.needsUpdate = true;
  }

  private faceTransition(name: MayaFaceTile) {
    if (this.faceTo === name) return;
    this.faceFrom = this.faceBlend > 0.5 ? this.faceTo : this.faceFrom;
    this.faceTo = name;
    this.faceBlend = this.reducedMotion || this.faceFade <= 0 ? 1 : 0;
    this.paintFace();
  }

  private syncIcon() {
    this.iconTarget =
      this.current === 'question'
        ? 'question'
        : (this.manualFace && MAYA_EXPRESSION_ICONS[this.expression]) ||
          MAYA_STATE_ICONS[this.current] ||
          MAYA_EXPRESSION_ICONS[this.expression] ||
          '';
  }

  setState(
    rawName: string,
    opts: { expression?: MayaExpressionName; fade?: number; restart?: boolean } = {}
  ): this {
    if (this.disposed) return this;
    const resolved = (NAME_ALIASES[rawName] ?? rawName) as MayaStateName;
    const cfg = MAYA_STATES[resolved];
    if (!cfg || !this.tracks.has(resolved)) {
      throw new Error(`Unknown MAYA state: ${rawName}`);
    }

    const fade = opts.fade ?? this.fade;
    if (resolved === this.current && !opts.restart) {
      if (opts.expression) this.setExpression(opts.expression);
      return this;
    }

    this.from = new Map(this.nodes.map((n) => [n, n.quaternion.clone()]));
    this.current = resolved;
    this.elapsed = 0;
    this.currentFade = Math.max(0, fade);
    this.transition = this.reducedMotion || fade <= 0 ? 1 : 0;
    this.completed = false;
    this.manualFace = !!opts.expression;
    this.expression = opts.expression ?? cfg.expression;
    if (!MAYA_EXPRESSIONS.includes(this.expression)) {
      throw new Error(`Unknown MAYA expression: ${this.expression}`);
    }

    this.faceTransition(this.expression);
    this.syncIcon();
    this.pose();
    if (this.reducedMotion) this.update(0);
    this.onStateChange(resolved);
    return this;
  }

  setExpression(rawName: string): this {
    if (this.disposed) return this;
    const resolved = (NAME_ALIASES[rawName] ?? rawName) as MayaExpressionName;
    if (!MAYA_EXPRESSIONS.includes(resolved)) {
      throw new Error(`Unknown MAYA expression: ${rawName}`);
    }
    this.expression = resolved;
    this.manualFace = true;
    this.faceTransition(resolved);
    this.syncIcon();
    return this;
  }

  private pose() {
    const cfg: MayaStateConfig = MAYA_STATES[this.current];
    const duration = cfg.duration;
    const t = this.reducedMotion
      ? this.current === 'idle'
        ? 0
        : duration * 0.5
      : cfg.once
        ? Math.min(this.elapsed, duration)
        : this.elapsed % duration;

    const boundTracks = this.tracks.get(this.current);
    if (!boundTracks) return;

    for (let i = 0; i < boundTracks.length; i++) {
      const tr = boundTracks[i];
      this.tmp.fromArray(tr.interpolant.evaluate(t));
      const from = this.from.get(tr.node);
      if (from && this.transition < 1) {
        tr.node.quaternion.slerpQuaternions(from, this.tmp, smoothstep(this.transition));
      } else {
        tr.node.quaternion.copy(this.tmp);
      }
    }
  }

  setReducedMotion(value: boolean): this {
    this.reducedMotion = !!value;
    this.update(0);
    return this;
  }

  update(dt: number) {
    if (this.disposed) return;
    const step = Math.max(0, Math.min(dt, 0.25));
    if (this.reducedMotion) {
      this.transition = 1;
      this.faceBlend = 1;
      this.iconCurrent = this.iconTarget;
      this.iconScale = this.iconCurrent ? 1 : 0;
    } else {
      this.elapsed += step;
      this.transition = clamp01(this.transition + step / Math.max(0.001, this.currentFade));
      this.faceBlend = clamp01(this.faceBlend + step / Math.max(0.001, this.faceFade));
      if (this.iconTarget !== this.iconCurrent) {
        this.iconScale = Math.max(0, this.iconScale - step * 9);
        if (this.iconScale < 0.001) this.iconCurrent = this.iconTarget;
      } else {
        this.iconScale = clamp01(this.iconScale + step * 6 * (this.iconCurrent ? 1 : 0));
      }
    }

    this.pose();

    if (this.current === 'idle' && this.expression === 'neutral') {
      const cycle = this.elapsed % 8;
      const blink = !this.reducedMotion && cycle > 6.64 && cycle < 6.82;
      this.faceTransition(blink ? 'blink' : 'neutral');
    }

    this.paintFace();

    const iconIdx = Math.max(0, MAYA_ICONS.indexOf(this.iconCurrent as MayaIconName));
    this.iconMap.offset.set((iconIdx % 4) / 4, Math.floor(iconIdx / 4) / 4);
    this.badge.scale.setScalar(this.iconCurrent ? smoothstep(this.iconScale) : 0);
    this.badge.position.y = 1 + (this.reducedMotion ? 0 : 0.012 * Math.sin(this.elapsed * 2.2));

    const cfg: MayaStateConfig = MAYA_STATES[this.current];
    if (!this.reducedMotion && cfg.once && !this.completed && this.elapsed >= cfg.duration) {
      this.completed = true;
      const finishedState = this.current;
      this.onFinished(finishedState);
      if (this.current === finishedState && this.autoReturn && cfg.returnToIdle) {
        this.setState('idle');
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.origMeshMaterials.forEach((mat, mesh) => {
      mesh.material = mat;
    });
    for (const node of this.gownNodes) {
      node.parent?.remove(node);
    }
    this.gownNodes = [];
    for (const geo of this.gownDisposables.geometries) geo.dispose();
    for (const mat of this.gownDisposables.materials) mat.dispose();
    this.gownDisposables.geometries = [];
    this.gownDisposables.materials = [];
    this.map.dispose();
    this.iconMap.dispose();
    (this.face.material as THREE.Material).dispose();
    (this.iconMesh.material as THREE.Material).dispose();
    this.face.material = this.faceSource;
    this.iconMesh.material = this.iconSource;
  }
}

export function loadMayaGltf(url = '/models/maya.glb'): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(url, resolve, undefined, reject);
  });
}
