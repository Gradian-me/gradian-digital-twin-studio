import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MapPin, RotateCcw, Tag } from 'lucide-react';
import type {
  Building,
  Floor,
  NetworkInterRackLink,
  NetworkUserNode,
  RackDevice,
  Room,
  SpatialAsset,
  Wall,
} from '../types/twin';

export interface DataCenter3DViewerProps {
  mode: 'single-rack' | 'campus-topology';
  rackAssets: SpatialAsset[];
  activeRackId: string | null;
  userNodes: NetworkUserNode[];
  interRackLinks: NetworkInterRackLink[];
  floors: Floor[];
  buildings?: Building[];
  rooms?: Room[];
  walls?: Wall[];
  highlightedIds?: Set<string> | null;
  selectedItemId: string | null;
  onSelectRack?: (rackId: string) => void;
  onSelectDevice?: (rackId: string, deviceId: string) => void;
  onSelectPort?: (rackId: string, deviceId: string, portId: string) => void;
  onSelectUserNode?: (nodeId: string) => void;
  onSelectRoom?: (roomId: string, floorId: string) => void;
}

interface BlinkingLedEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  baseColor: THREE.Color;
  status: 'up' | 'down' | 'standby' | 'error';
  isUplink: boolean;
  phase: number;
  speed: number;
}

interface PulsePacketEntry {
  mesh: THREE.Mesh;
  curve: THREE.Curve<THREE.Vector3>;
  speed: number;
  offset: number;
}

interface ProjectedBadgeItem {
  id: string;
  kind: 'room' | 'rack' | 'userNode' | 'device';
  code: string;
  title: string;
  subtitle: string;
  meta: string;
  status?: 'up' | 'warn' | 'error' | 'offline' | 'core' | 'idf';
  worldPos: [number, number, number];
  roomId?: string;
  floorId?: string;
  rackId?: string;
  deviceId?: string;
  nodeId?: string;
}

interface HoverCardInfo {
  code: string;
  title: string;
  subtitle: string;
  meta?: string;
  accent?: 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose';
}

const DEVICE_TIER_HEX: Record<string, number> = {
  core: 0x06b6d4,
  distribution: 0x3b82f6,
  access: 0x14b8a6,
  security: 0xf59e0b,
  compute: 0x6366f1,
  power: 0xef4444,
};

const KIND_HEX: Record<RackDevice['kind'], number> = {
  switch: 0x14b8a6,
  router: 0x6366f1,
  firewall: 0xf59e0b,
  server: 0x3b82f6,
  storage: 0x10b981,
  'patch-panel': 0x06b6d4,
  ups: 0xef4444,
  pdu: 0xf97316,
  scada: 0xec4899,
  kvm: 0x64748b,
};

function detectSoftwareGl(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl =
      (c.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (c.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
    return /SwiftShader|llvmpipe|Software|Mesa OffScreen/i.test(rendererStr);
  } catch {
    return true;
  }
}

export const DataCenter3DViewer: React.FC<DataCenter3DViewerProps> = ({
  mode,
  rackAssets,
  activeRackId,
  userNodes,
  interRackLinks,
  floors,
  buildings = [],
  rooms = [],
  walls = [],
  highlightedIds = null,
  selectedItemId,
  onSelectRack,
  onSelectDevice,
  onSelectPort,
  onSelectUserNode,
  onSelectRoom,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const savedCamRef = useRef<{
    key: string;
    pos: [number, number, number];
    target: [number, number, number];
  } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverCardInfo | null>(null);
  const [floorFilterId, setFloorFilterId] = useState<string>('all');
  const [showRoomTags, setShowRoomTags] = useState<boolean>(true);
  const [showEquipBadges, setShowEquipBadges] = useState<boolean>(true);
  const [badges, setBadges] = useState<ProjectedBadgeItem[]>([]);
  const badgesRef = useRef<ProjectedBadgeItem[]>([]);
  const badgeDomMapRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const showRoomTagsRef = useRef(showRoomTags);
  showRoomTagsRef.current = showRoomTags;
  const showEquipBadgesRef = useRef(showEquipBadges);
  showEquipBadgesRef.current = showEquipBadges;

  const callbacksRef = useRef({
    onSelectRack,
    onSelectDevice,
    onSelectPort,
    onSelectUserNode,
    onSelectRoom,
  });
  callbacksRef.current = {
    onSelectRack,
    onSelectDevice,
    onSelectPort,
    onSelectUserNode,
    onSelectRoom,
  };

  const setCameraPreset = (preset: 'iso' | 'front' | 'rear' | 'top') => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    if (mode === 'single-rack') {
      ctrl.target.set(0, 1.15, 0);
      if (preset === 'front') cam.position.set(0, 1.25, 2.75);
      else if (preset === 'rear') cam.position.set(0, 1.25, -2.75);
      else if (preset === 'top') cam.position.set(0.01, 3.6, 0.9);
      else cam.position.set(1.9, 1.55, 2.25);
    } else {
      ctrl.target.set(0, 1.2, 0);
      if (preset === 'top') cam.position.set(0, 20, 4);
      else if (preset === 'front') cam.position.set(0, 6, 17);
      else if (preset === 'rear') cam.position.set(0, 6, -17);
      else cam.position.set(14, 11.5, 14.5);
    }
    ctrl.update();
    const camKey = mode === 'single-rack' ? `rack:${activeRackId ?? ''}` : `campus:${floorFilterId}`;
    savedCamRef.current = {
      key: camKey,
      pos: [cam.position.x, cam.position.y, cam.position.z],
      target: [ctrl.target.x, ctrl.target.y, ctrl.target.z],
    };
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSwGl = detectSoftwareGl();
    const width = Math.max(240, container.clientWidth);
    const height = Math.max(240, container.clientHeight);
    const camKey = mode === 'single-rack' ? `rack:${activeRackId ?? ''}` : `campus:${floorFilterId}`;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090a10);
    scene.fog = new THREE.FogExp2(0x090a10, mode === 'single-rack' ? 0.045 : 0.016);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.08, 160);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSwGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setPixelRatio(isSwGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = !isSwGl;
    if (!isSwGl) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = mode === 'single-rack' ? 0.9 : 4;
    controls.maxDistance = mode === 'single-rack' ? 7 : 55;
    controlsRef.current = controls;

    // Studio Lighting
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.7);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xf8fafc, 1.65);
    keyLight.position.set(6, 12, 8);
    if (!isSwGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
    rimLight.position.set(-7, 6, -6);
    scene.add(rimLight);

    const warmAccent = new THREE.PointLight(0xf59e0b, 0.45, 18);
    warmAccent.position.set(3, 2.8, 3);
    scene.add(warmAccent);

    const disposables: { dispose: () => void }[] = [];
    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      disposables.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      disposables.push(m);
      return m;
    };

    const pickables: THREE.Object3D[] = [];
    const blinkingLeds: BlinkingLedEntry[] = [];
    const pulsePackets: PulsePacketEntry[] = [];
    const nextBadges: ProjectedBadgeItem[] = [];

    if (mode === 'single-rack') {
      if (savedCamRef.current?.key === camKey) {
        camera.position.set(...savedCamRef.current.pos);
        controls.target.set(...savedCamRef.current.target);
      } else {
        camera.position.set(1.85, 1.5, 2.25);
        controls.target.set(0, 1.15, 0);
      }
      controls.update();

      // Raised Data Center Floor Plinth & Subtle Grid
      const floorGeo = trackGeo(new THREE.CircleGeometry(4.5, 48));
      const floorMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x0f111a,
          roughness: 0.72,
          metalness: 0.18,
        })
      );
      const floorMesh = new THREE.Mesh(floorGeo, floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.receiveShadow = true;
      scene.add(floorMesh);

      const grid = new THREE.GridHelper(6, 18, 0x262c40, 0x171b28);
      grid.position.y = 0.002;
      scene.add(grid);

      const activeRack = rackAssets.find((a) => a.id === activeRackId) ?? rackAssets[0];
      const cfg = activeRack?.rackConfig;
      const totalU = cfg?.totalUnits ?? 42;
      const rackW = 0.74;
      const rackD = 1.02;
      const uH = 0.046;
      const rackH = Math.max(1.5, totalU * uH + 0.24);

      const cabinetGroup = new THREE.Group();
      scene.add(cabinetGroup);

      // Cabinet Chassis Frame (brushed dark steel)
      const frameMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x161822,
          metalness: 0.78,
          roughness: 0.34,
        })
      );
      const railMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x3f4759,
          metalness: 0.85,
          roughness: 0.28,
        })
      );
      const sideGlassMat = trackMat(
        new THREE.MeshPhysicalMaterial({
          color: 0x1e293b,
          transparent: true,
          opacity: 0.24,
          roughness: 0.14,
          metalness: 0.1,
          transmission: 0.25,
        })
      );

      // Top & Base plinth
      const plinthGeo = trackGeo(new THREE.BoxGeometry(rackW + 0.06, 0.09, rackD + 0.04));
      const baseMesh = new THREE.Mesh(plinthGeo, frameMat);
      baseMesh.position.y = 0.045;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      cabinetGroup.add(baseMesh);

      const topMesh = new THREE.Mesh(plinthGeo, frameMat);
      topMesh.position.y = rackH - 0.045;
      topMesh.castShadow = true;
      cabinetGroup.add(topMesh);

      // 4 Vertical Structural Posts
      const postGeo = trackGeo(new THREE.BoxGeometry(0.055, rackH, 0.055));
      const postCoords: [number, number][] = [
        [-rackW / 2, -rackD / 2],
        [rackW / 2, -rackD / 2],
        [-rackW / 2, rackD / 2],
        [rackW / 2, rackD / 2],
      ];
      postCoords.forEach(([px, pz]) => {
        const post = new THREE.Mesh(postGeo, frameMat);
        post.position.set(px, rackH / 2, pz);
        post.castShadow = true;
        cabinetGroup.add(post);
      });

      // Vertical 19-inch mounting rails
      const vRailGeo = trackGeo(new THREE.BoxGeometry(0.028, rackH - 0.18, 0.02));
      [-rackW / 2 + 0.05, rackW / 2 - 0.05].forEach((rx) => {
        const rail = new THREE.Mesh(vRailGeo, railMat);
        rail.position.set(rx, rackH / 2, rackD / 2 - 0.04);
        cabinetGroup.add(rail);
      });

      // Side perforated translucent panels
      const sidePanelGeo = trackGeo(new THREE.BoxGeometry(0.014, rackH - 0.16, rackD - 0.08));
      [-rackW / 2 - 0.015, rackW / 2 + 0.015].forEach((sx) => {
        const sp = new THREE.Mesh(sidePanelGeo, sideGlassMat);
        sp.position.set(sx, rackH / 2, 0);
        cabinetGroup.add(sp);
      });

      // Top status beacon bar (role color)
      const roleColor =
        cfg?.rackRole === 'core-dc'
          ? 0x06b6d4
          : cfg?.rackRole === 'distribution-idf'
            ? 0x3b82f6
            : 0x8b5cf6;
      const beaconGeo = trackGeo(new THREE.BoxGeometry(rackW - 0.08, 0.018, 0.025));
      const beaconMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: roleColor,
          emissive: roleColor,
          emissiveIntensity: 1.6,
          roughness: 0.2,
        })
      );
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(0, rackH - 0.015, rackD / 2 + 0.015);
      cabinetGroup.add(beacon);

      // Mounted Rack Devices + Port Blocks + Blinking Activity LEDs
      const devices = cfg?.devices ?? [];
      const deviceCenterY = new Map<string, number>();

      devices.forEach((dev, devIdx) => {
        const h = Math.max(0.038, dev.uHeight * uH - 0.005);
        const yBottom = 0.11 + (dev.uStart - 1) * uH;
        const yCenter = yBottom + h / 2;
        deviceCenterY.set(dev.id, yCenter);

        const isSelected = selectedItemId === dev.id;
        const accentHex =
          (dev.tier && DEVICE_TIER_HEX[dev.tier]) || KIND_HEX[dev.kind] || 0x3b82f6;

        const chassisGeo = trackGeo(new THREE.BoxGeometry(rackW - 0.12, h, rackD - 0.14));
        const chassisMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: isSelected ? 0x262140 : 0x1d212e,
            metalness: 0.72,
            roughness: 0.32,
            emissive: isSelected ? 0x4c1d95 : 0x000000,
            emissiveIntensity: isSelected ? 0.35 : 0,
          })
        );
        const chassis = new THREE.Mesh(chassisGeo, chassisMat);
        chassis.position.set(0, yCenter, 0);
        chassis.castShadow = true;
        chassis.receiveShadow = true;
        const upPorts = dev.ports.filter((p) => p.status === 'up').length;
        chassis.userData = {
          pickType: 'device',
          rackId: activeRack?.id,
          deviceId: dev.id,
          hoverCard: {
            code: `U${dev.uStart}${dev.uHeight > 1 ? `-U${dev.uStart + dev.uHeight - 1}` : ''}`,
            title: dev.name,
            subtitle: `${dev.vendor} ${dev.model} · ${dev.ipAddress}`,
            meta: `${upPorts}/${dev.ports.length} ports UP · ${dev.powerW}W · ${dev.vlan}`,
            accent: dev.status === 'offline' ? 'rose' : dev.status === 'warning' ? 'amber' : 'cyan',
          } satisfies HoverCardInfo,
        };
        cabinetGroup.add(chassis);
        pickables.push(chassis);

        if (activeRack) {
          nextBadges.push({
            id: `dev:${dev.id}`,
            kind: 'device',
            code: `U${dev.uStart} · ${dev.name.slice(0, 14)}`,
            title: dev.name,
            subtitle: `${dev.vendor} ${dev.model} · ${dev.ipAddress}`,
            meta: `${upPorts}/${dev.ports.length} ports UP · ${dev.powerW}W · ${dev.vlan}`,
            status: dev.status === 'offline' ? 'offline' : dev.status === 'warning' ? 'warn' : 'up',
            worldPos: [rackW / 2 + 0.16, yCenter, rackD / 2 - 0.1],
            rackId: activeRack.id,
            deviceId: dev.id,
          });
        }

        // Front faceplate bezel strip
        const bezelGeo = trackGeo(new THREE.BoxGeometry(0.032, h - 0.008, 0.012));
        const bezelMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: accentHex,
            emissive: accentHex,
            emissiveIntensity: isSelected ? 1.1 : 0.45,
            roughness: 0.25,
          })
        );
        const bezel = new THREE.Mesh(bezelGeo, bezelMat);
        bezel.position.set(-(rackW - 0.12) / 2 + 0.022, yCenter, (rackD - 0.14) / 2 + 0.004);
        cabinetGroup.add(bezel);

        // Selection outline frame
        if (isSelected) {
          const edges = trackGeo(new THREE.EdgesGeometry(chassisGeo));
          const lineMat = trackMat(new THREE.LineBasicMaterial({ color: 0xf59e0b }));
          const outline = new THREE.LineSegments(edges, lineMat);
          outline.position.copy(chassis.position);
          cabinetGroup.add(outline);
        }

        // Front Ports & Blinking Activity LEDs
        const ports = dev.ports.slice(0, 14);
        const portCount = Math.max(1, ports.length);
        const usableW = rackW - 0.24;
        const stepX = Math.min(0.036, usableW / Math.max(6, portCount));
        const startX = -usableW / 2 + 0.04;

        ports.forEach((port, pIdx) => {
          const px = startX + pIdx * stepX;
          const pz = (rackD - 0.14) / 2 + 0.008;
          const isPortSelected = selectedItemId === port.id;

          // Port Socket (RJ45 / SFP+ / QSFP)
          const sockGeo = trackGeo(
            new THREE.BoxGeometry(port.isUplink ? 0.022 : 0.018, 0.015, 0.012)
          );
          const sockMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: isPortSelected ? 0xf59e0b : port.isUplink ? 0x0e7490 : 0x0f172a,
              metalness: 0.6,
              roughness: 0.4,
            })
          );
          const sock = new THREE.Mesh(sockGeo, sockMat);
          sock.position.set(px, yCenter - 0.004, pz);
          sock.userData = {
            pickType: 'port',
            rackId: activeRack?.id,
            deviceId: dev.id,
            portId: port.id,
            hoverCard: {
              code: port.label,
              title: `${dev.name} · ${port.label}`,
              subtitle: `${port.kind} ${port.speedGbps}G · ${port.vlan} · ${port.status.toUpperCase()}`,
              meta: port.connectedToLabel ? `Peer: ${port.connectedToLabel}` : `Util ${port.utilizationPct ?? 0}%`,
              accent: port.status === 'error' ? 'rose' : port.isUplink ? 'cyan' : 'emerald',
            } satisfies HoverCardInfo,
          };
          cabinetGroup.add(sock);
          pickables.push(sock);

          // Blinking Activity LED right above the socket
          const ledColorHex =
            port.status === 'error'
              ? 0xef4444
              : port.status === 'standby'
                ? 0xf59e0b
                : port.status === 'down'
                  ? 0x334155
                  : port.isUplink
                    ? 0x22d3ee
                    : 0x10b981;
          const ledGeo = trackGeo(new THREE.SphereGeometry(0.0045, 8, 8));
          const ledMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: ledColorHex,
              emissive: ledColorHex,
              emissiveIntensity: port.status === 'down' ? 0.08 : 1.5,
              roughness: 0.2,
            })
          );
          const led = new THREE.Mesh(ledGeo, ledMat);
          led.position.set(px, yCenter + 0.009, pz + 0.004);
          cabinetGroup.add(led);

          blinkingLeds.push({
            mesh: led,
            material: ledMat,
            baseColor: new THREE.Color(ledColorHex),
            status: port.status,
            isUplink: Boolean(port.isUplink),
            phase: devIdx * 1.7 + pIdx * 0.93,
            speed: port.status === 'error' ? 11.5 : port.isUplink ? 6.4 : 4.2 + (pIdx % 3) * 1.1,
          });
        });
      });

      // Curved 3D Patch Cables routed cleanly along side cable manager
      (cfg?.cables ?? []).forEach((cab, idx) => {
        const y1 = deviceCenterY.get(cab.fromDeviceId);
        const y2 = deviceCenterY.get(cab.toDeviceId);
        if (y1 === undefined || y2 === undefined) return;
        const side = idx % 2 === 0 ? 1 : -1;
        const xBase = side * (rackW / 2 - 0.09);
        const xArc = side * (rackW / 2 + 0.04 + (idx % 3) * 0.018);
        const zFront = rackD / 2 - 0.02;

        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(xBase - side * 0.08, y1, zFront),
          new THREE.Vector3(xArc, y1, zFront + 0.06),
          new THREE.Vector3(xArc, (y1 + y2) / 2, zFront + 0.08),
          new THREE.Vector3(xArc, y2, zFront + 0.06),
          new THREE.Vector3(xBase - side * 0.08, y2, zFront),
        ]);
        const tubeGeo = trackGeo(new THREE.TubeGeometry(curve, 24, 0.0055, 6, false));
        const tubeMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: cab.color || '#06B6D4',
            emissive: cab.color || '#06B6D4',
            emissiveIntensity: 0.35,
            roughness: 0.38,
          })
        );
        cabinetGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
      });
    } else {
      // CAMPUS 3D IT FLOOR-PLAN TOPOLOGY MODE: Real Buildings, Real Floors, Rooms, Translucent Walls, Racks & User Nodes
      if (savedCamRef.current?.key === camKey) {
        camera.position.set(...savedCamRef.current.pos);
        controls.target.set(...savedCamRef.current.target);
      } else {
        camera.position.set(16, 13.5, 17);
        controls.target.set(0, 1.6, 0);
      }
      controls.update();

      const allFloors =
        floors.length > 0
          ? floors
          : [
              {
                id: 'fl-default',
                name: 'Level 0',
                code: 'L0',
                elevation: 0,
                levelIndex: 0,
                width: 32,
                depth: 22,
                height: 4,
                buildingId: 'b1',
              },
            ];
      const visibleFloors =
        floorFilterId === 'all' ? allFloors : allFloors.filter((f) => f.id === floorFilterId);
      const visibleFloorSet = new Set(visibleFloors.map((f) => f.id));

      // Resolve building world offsets so multi-building campuses lay out accurately without overlapping
      const bldgOffsetMap = new Map<string, { ox: number; oz: number; name: string }>();
      buildings.forEach((b, idx) => {
        bldgOffsetMap.set(b.id, {
          ox: typeof b.originX === 'number' ? b.originX : idx * 42,
          oz: typeof b.originZ === 'number' ? b.originZ : 0,
          name: b.name,
        });
      });

      const getBldgOffset = (bldgId?: string) => {
        if (bldgId && bldgOffsetMap.has(bldgId)) return bldgOffsetMap.get(bldgId)!;
        return { ox: 0, oz: 0, name: 'Building' };
      };

      // Compute true world bounding box across visible floors, rooms, racks, and nodes
      let minWX = Infinity;
      let maxWX = -Infinity;
      let minWZ = Infinity;
      let maxWZ = -Infinity;
      const expandBounds = (wx: number, wz: number) => {
        if (wx < minWX) minWX = wx;
        if (wx > maxWX) maxWX = wx;
        if (wz < minWZ) minWZ = wz;
        if (wz > maxWZ) maxWZ = wz;
      };

      visibleFloors.forEach((fl) => {
        const bo = getBldgOffset(fl.buildingId);
        expandBounds(bo.ox, bo.oz);
        expandBounds(bo.ox + (fl.width || 30), bo.oz + (fl.depth || 20));
      });
      if (!Number.isFinite(minWX)) {
        minWX = 0;
        maxWX = 32;
        minWZ = 0;
        maxWZ = 22;
      }

      const spanX = Math.max(14, maxWX - minWX);
      const spanZ = Math.max(12, maxWZ - minWZ);
      const scale = Math.min(24 / spanX, 16 / spanZ);
      const midX = (minWX + maxWX) / 2;
      const midZ = (minWZ + maxWZ) / 2;

      const uniqueElevs = Array.from(new Set(visibleFloors.map((f) => f.elevation))).sort(
        (a, b) => a - b
      );
      const levelGap = 4.2;

      const toStage = (localX: number, localZ: number, floorId: string) => {
        const fl = allFloors.find((f) => f.id === floorId);
        const bo = getBldgOffset(fl?.buildingId);
        const elevIdx = fl ? Math.max(0, uniqueElevs.indexOf(fl.elevation)) : 0;
        return new THREE.Vector3(
          (bo.ox + localX - midX) * scale,
          elevIdx * levelGap,
          (bo.oz + localZ - midZ) * scale
        );
      };

      // Ground reference grid
      const grid = new THREE.GridHelper(32, 32, 0x1e293b, 0x111726);
      grid.position.y = -0.04;
      scene.add(grid);

      // 1. Render Real Architectural Floor Slabs, Room Zones & Translucent Walls
      const wallMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x334155,
          transparent: true,
          opacity: 0.32,
          roughness: 0.55,
          metalness: 0.15,
          depthWrite: false,
        })
      );
      const wallEdgeMat = trackMat(
        new THREE.LineBasicMaterial({
          color: 0x64748b,
          transparent: true,
          opacity: 0.48,
        })
      );

      visibleFloors.forEach((fl) => {
        const bo = getBldgOffset(fl.buildingId);
        const elevIdx = Math.max(0, uniqueElevs.indexOf(fl.elevation));
        const y = elevIdx * levelGap;
        const flW = (fl.width || 30) * scale;
        const flD = (fl.depth || 20) * scale;
        const flCenterX = (bo.ox + (fl.width || 30) / 2 - midX) * scale;
        const flCenterZ = (bo.oz + (fl.depth || 20) / 2 - midZ) * scale;

        const slabGeo = trackGeo(new THREE.BoxGeometry(flW, 0.08, flD));
        const slabMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: elevIdx === 0 ? 0x101522 : 0x151d30,
            transparent: true,
            opacity: elevIdx === 0 ? 0.92 : 0.52,
            roughness: 0.78,
            metalness: 0.14,
          })
        );
        const slab = new THREE.Mesh(slabGeo, slabMat);
        slab.position.set(flCenterX, y - 0.04, flCenterZ);
        slab.receiveShadow = true;
        scene.add(slab);

        const slabEdge = new THREE.LineSegments(
          trackGeo(new THREE.EdgesGeometry(slabGeo)),
          trackMat(
            new THREE.LineBasicMaterial({
              color: 0x38bdf8,
              transparent: true,
              opacity: 0.45,
            })
          )
        );
        slabEdge.position.copy(slab.position);
        scene.add(slabEdge);

        // Real Room Footprints on this Floor
        const floorRooms = rooms.filter((r) => r.floorId === fl.id);
        floorRooms.forEach((rm) => {
          const rw = Math.max(0.2, rm.width * scale);
          const rd = Math.max(0.2, rm.depth * scale);
          const rx = (bo.ox + rm.x + rm.width / 2 - midX) * scale;
          const rz = (bo.oz + rm.z + rm.depth / 2 - midZ) * scale;
          const roomColor = new THREE.Color(rm.color || '#1E293B');
          const rGeo = trackGeo(new THREE.PlaneGeometry(rw - 0.04, rd - 0.04));
          const rMat = trackMat(
            new THREE.MeshBasicMaterial({
              color: roomColor,
              transparent: true,
              opacity: 0.16,
              side: THREE.DoubleSide,
              depthWrite: false,
            })
          );
          const rMesh = new THREE.Mesh(rGeo, rMat);
          rMesh.rotation.x = -Math.PI / 2;
          rMesh.position.set(rx, y + 0.012, rz);
          const rmRacksCount = rackAssets.filter((a) => a.roomId === rm.id).length;
          const rmNodesCount = userNodes.filter((n) => n.roomId === rm.id).length;
          rMesh.userData = {
            pickType: 'room',
            roomId: rm.id,
            floorId: fl.id,
            hoverCard: {
              code: rm.code || rm.name.slice(0, 6),
              title: rm.name,
              subtitle: `${fl.code} · ${rm.environmental?.cleanroomGrade ?? 'Facility Zone'}`,
              meta: `${rmRacksCount} rack${rmRacksCount === 1 ? '' : 's'} · ${rmNodesCount} endpoint${rmNodesCount === 1 ? '' : 's'}`,
              accent: 'violet',
            } satisfies HoverCardInfo,
          };
          scene.add(rMesh);
          pickables.push(rMesh);

          nextBadges.push({
            id: `room:${rm.id}`,
            kind: 'room',
            code: rm.code || rm.name.slice(0, 6),
            title: rm.name,
            subtitle: `${fl.code} · ${rm.environmental?.cleanroomGrade ?? 'Facility Zone'}`,
            meta: `${rmRacksCount} rack${rmRacksCount === 1 ? '' : 's'} · ${rmNodesCount} endpoint${rmNodesCount === 1 ? '' : 's'}`,
            worldPos: [rx, y + 0.14, rz],
            roomId: rm.id,
            floorId: fl.id,
          });

          const rOutline = new THREE.LineSegments(
            trackGeo(new THREE.EdgesGeometry(new THREE.BoxGeometry(rw, 0.02, rd))),
            trackMat(
              new THREE.LineBasicMaterial({
                color: roomColor,
                transparent: true,
                opacity: 0.45,
              })
            )
          );
          rOutline.position.set(rx, y + 0.015, rz);
          scene.add(rOutline);
        });

        // Real Architectural Walls (low translucent profile so racks & cables stay crystal clear)
        const floorWalls = walls.filter((w) => w.floorId === fl.id);
        const wallH = Math.min(1.5, Math.max(0.75, (fl.height || 3.8) * scale * 0.65));
        floorWalls.forEach((w) => {
          const dx = (w.x2 - w.x1) * scale;
          const dz = (w.z2 - w.z1) * scale;
          const len = Math.hypot(dx, dz);
          if (len < 0.05) return;
          const cx = (bo.ox + (w.x1 + w.x2) / 2 - midX) * scale;
          const cz = (bo.oz + (w.z1 + w.z2) / 2 - midZ) * scale;
          const wGeo = trackGeo(new THREE.BoxGeometry(len, wallH, Math.max(0.03, (w.thickness || 0.15) * scale)));
          const wMesh = new THREE.Mesh(wGeo, wallMat);
          wMesh.position.set(cx, y + wallH / 2, cz);
          wMesh.rotation.y = -Math.atan2(dz, dx);
          scene.add(wMesh);

          const wEdge = new THREE.LineSegments(trackGeo(new THREE.EdgesGeometry(wGeo)), wallEdgeMat);
          wEdge.position.copy(wMesh.position);
          wEdge.rotation.copy(wMesh.rotation);
          scene.add(wEdge);
        });
      });

      const rackPosMap = new Map<string, THREE.Vector3>();
      const visibleRacks = rackAssets.filter((r) => visibleFloorSet.has(r.floorId));
      const visibleNodes = userNodes.filter((n) => visibleFloorSet.has(n.floorId));

      // 2. Render 3D Racks (Core DC vs Distribution IDF) at true floor/room coordinates
      visibleRacks.forEach((rack, rIdx) => {
        const pos = toStage(rack.x, rack.z, rack.floorId);
        rackPosMap.set(rack.id, pos);
        const isCore = rack.rackConfig?.rackRole === 'core-dc';
        const isSelected = selectedItemId === rack.id || activeRackId === rack.id;
        const isDimmed =
          highlightedIds && highlightedIds.size > 0 && !highlightedIds.has(rack.id);
        const h = isCore ? 1.85 : 1.35;
        const w = isCore ? 0.92 : 0.7;
        const d = isCore ? 0.92 : 0.7;
        const col = isCore ? 0x06b6d4 : 0x3b82f6;

        const boxGeo = trackGeo(new THREE.BoxGeometry(w, h, d));
        const boxMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: isSelected ? 0x2e2258 : 0x171b27,
            metalness: 0.75,
            roughness: 0.3,
            emissive: col,
            emissiveIntensity: isSelected ? 0.55 : isDimmed ? 0.03 : 0.16,
            transparent: Boolean(isDimmed),
            opacity: isDimmed ? 0.25 : 1,
          })
        );
        const mesh = new THREE.Mesh(boxGeo, boxMat);
        mesh.position.set(pos.x, pos.y + h / 2, pos.z);
        mesh.castShadow = !isDimmed;
        const rackFl = allFloors.find((f) => f.id === rack.floorId);
        const rackRm = rooms.find((r) => r.id === rack.roomId);
        const rackDevs = rack.rackConfig?.devices ?? [];
        const hasRackErr = rackDevs.some(
          (d) => d.status === 'offline' || d.ports.some((p) => p.status === 'error')
        );
        mesh.userData = {
          pickType: 'rack',
          rackId: rack.id,
          hoverCard: {
            code: rack.assetId,
            title: rack.name,
            subtitle: `${isCore ? 'Core DC MDF' : 'Distribution IDF'} · ${rackFl?.code ?? ''}${rackRm ? ` · ${rackRm.code}` : ''}`,
            meta: `${rackDevs.length} devices · ${rack.rackConfig?.subnetCidr ?? ''}`,
            accent: hasRackErr ? 'rose' : isCore ? 'cyan' : 'violet',
          } satisfies HoverCardInfo,
        };
        scene.add(mesh);
        pickables.push(mesh);

        if (!isDimmed) {
          nextBadges.push({
            id: `rack:${rack.id}`,
            kind: 'rack',
            code: rack.assetId,
            title: rack.name,
            subtitle: `${isCore ? 'Core DC MDF' : 'Floor IDF'} · ${rackFl?.code ?? ''}${rackRm ? ` · ${rackRm.code}` : ''}`,
            meta: `${rackDevs.length} mounted devices · ${rack.rackConfig?.subnetCidr ?? ''}`,
            status: hasRackErr ? 'error' : isCore ? 'core' : 'idf',
            worldPos: [pos.x, pos.y + h + 0.34, pos.z],
            rackId: rack.id,
            floorId: rack.floorId,
          });
        }

        // Glowing top crown + blinking uplink LEDs on rack front
        const crownGeo = trackGeo(new THREE.BoxGeometry(w + 0.05, 0.07, d + 0.05));
        const crownMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: col,
            emissive: col,
            emissiveIntensity: isDimmed ? 0.2 : 1.5,
            roughness: 0.2,
          })
        );
        const crown = new THREE.Mesh(crownGeo, crownMat);
        crown.position.set(pos.x, pos.y + h + 0.035, pos.z);
        scene.add(crown);

        for (let b = 0; b < 4; b++) {
          const ledGeo = trackGeo(new THREE.SphereGeometry(0.04, 8, 8));
          const ledColor = b === 0 ? 0x22d3ee : 0x10b981;
          const ledMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: ledColor,
              emissive: ledColor,
              emissiveIntensity: isDimmed ? 0.2 : 1.8,
            })
          );
          const led = new THREE.Mesh(ledGeo, ledMat);
          led.position.set(pos.x - 0.16 + b * 0.11, pos.y + h * 0.72, pos.z + d / 2 + 0.025);
          scene.add(led);
          blinkingLeds.push({
            mesh: led,
            material: ledMat,
            baseColor: new THREE.Color(ledColor),
            status: 'up',
            isUplink: b === 0,
            phase: rIdx * 2.1 + b * 0.8,
            speed: 5.2 + b * 0.9,
          });
        }
      });

      // 3. Inter-Rack Fiber Trunks (IDF Distribution <-> Core DC) with Animated Traffic Pulses
      interRackLinks.forEach((link, lIdx) => {
        const pFrom = rackPosMap.get(link.fromRackId);
        const pTo = rackPosMap.get(link.toRackId);
        if (!pFrom || !pTo) return;
        const isDimmed =
          highlightedIds &&
          highlightedIds.size > 0 &&
          (!highlightedIds.has(link.fromRackId) || !highlightedIds.has(link.toRackId));
        const start = new THREE.Vector3(pFrom.x, pFrom.y + 1.15, pFrom.z);
        const end = new THREE.Vector3(pTo.x, pTo.y + 1.5, pTo.z);
        const mid = start.clone().lerp(end, 0.5);
        mid.y = Math.max(start.y, end.y) + 1.45 + (lIdx % 3) * 0.25;

        const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
        const col =
          link.status === 'down'
            ? 0xef4444
            : link.status === 'degraded'
              ? 0xf59e0b
              : link.media === 'OS2 Single-Mode'
                ? 0xfacc15
                : 0x06b6d4;
        const tubeGeo = trackGeo(new THREE.TubeGeometry(curve, 30, isDimmed ? 0.018 : 0.042, 8, false));
        const tubeMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: col,
            emissive: col,
            emissiveIntensity: isDimmed ? 0.12 : 0.75,
            transparent: Boolean(isDimmed),
            opacity: isDimmed ? 0.2 : 0.95,
            roughness: 0.25,
          })
        );
        scene.add(new THREE.Mesh(tubeGeo, tubeMat));

        if (link.status !== 'down' && !isDimmed) {
          const pulseGeo = trackGeo(new THREE.SphereGeometry(0.095, 10, 10));
          const pulseMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
          const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
          scene.add(pulseMesh);
          pulsePackets.push({
            mesh: pulseMesh,
            curve,
            speed: 0.42 + (lIdx % 3) * 0.1,
            offset: (lIdx * 0.31) % 1,
          });
        }
      });

      // 4. Render 3D User Nodes across ALL Rooms + Cat6A / Fiber Drop Arcs
      visibleNodes.forEach((node, nIdx) => {
        const pos = toStage(node.x, node.z, node.floorId);
        const isSelected = selectedItemId === node.id;
        const isDimmed =
          highlightedIds && highlightedIds.size > 0 && !highlightedIds.has(node.id);
        const statusHex =
          node.status === 'error'
            ? 0xef4444
            : node.status === 'degraded'
              ? 0xf59e0b
              : node.status === 'offline'
                ? 0x64748b
                : 0x10b981;

        const cylGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.24, 0.36, 14));
        const cylMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: isSelected ? 0x8b5cf6 : 0x1e2436,
            metalness: 0.55,
            roughness: 0.35,
            emissive: statusHex,
            emissiveIntensity: isSelected ? 0.75 : isDimmed ? 0.04 : 0.28,
            transparent: Boolean(isDimmed),
            opacity: isDimmed ? 0.2 : 1,
          })
        );
        const ped = new THREE.Mesh(cylGeo, cylMat);
        ped.position.set(pos.x, pos.y + 0.18, pos.z);
        ped.castShadow = !isDimmed;
        const nodeFl = allFloors.find((f) => f.id === node.floorId);
        const nodeRm = rooms.find((r) => r.id === node.roomId);
        ped.userData = {
          pickType: 'userNode',
          nodeId: node.id,
          hoverCard: {
            code: node.code,
            title: node.name,
            subtitle: `${nodeRm ? `${nodeRm.code} ${nodeRm.name}` : nodeFl?.code ?? ''} · ${node.wallJackId}`,
            meta: `${node.ipAddress} · ${node.vlan} · ${node.status.toUpperCase()}`,
            accent: node.status === 'error' ? 'rose' : node.status === 'degraded' ? 'amber' : 'emerald',
          } satisfies HoverCardInfo,
        };
        scene.add(ped);
        pickables.push(ped);

        if (!isDimmed) {
          nextBadges.push({
            id: `node:${node.id}`,
            kind: 'userNode',
            code: node.code,
            title: node.name,
            subtitle: `${nodeRm ? `${nodeRm.code} · ` : ''}${node.wallJackId} · ${node.ipAddress}`,
            meta: `${node.vlan} · ${node.media} · ${node.status.toUpperCase()}`,
            status:
              node.status === 'error'
                ? 'error'
                : node.status === 'degraded'
                  ? 'warn'
                  : node.status === 'offline'
                    ? 'offline'
                    : 'up',
            worldPos: [pos.x, pos.y + 0.62, pos.z],
            nodeId: node.id,
            floorId: node.floorId,
          });
        }

        const orbGeo = trackGeo(new THREE.SphereGeometry(0.075, 10, 10));
        const orbMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: statusHex,
            emissive: statusHex,
            emissiveIntensity: isDimmed ? 0.15 : 1.6,
          })
        );
        const orb = new THREE.Mesh(orbGeo, orbMat);
        orb.position.set(pos.x, pos.y + 0.44, pos.z);
        scene.add(orb);
        blinkingLeds.push({
          mesh: orb,
          material: orbMat,
          baseColor: new THREE.Color(statusHex),
          status:
            node.status === 'error'
              ? 'error'
              : node.status === 'degraded'
                ? 'standby'
                : node.status === 'offline'
                  ? 'down'
                  : 'up',
          isUplink: false,
          phase: nIdx * 1.3,
          speed: node.status === 'error' ? 11 : 4.5,
        });

        const targetRackPos = rackPosMap.get(node.connectedRackId);
        if (targetRackPos) {
          const start = new THREE.Vector3(pos.x, pos.y + 0.28, pos.z);
          const end = new THREE.Vector3(targetRackPos.x, targetRackPos.y + 0.65, targetRackPos.z);
          const mid = start.clone().lerp(end, 0.5);
          mid.y = Math.max(start.y, end.y) + 0.42;
          const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
          const dropColor = node.status === 'error' ? 0xef4444 : 0x14b8a6;
          const tubeGeo = trackGeo(new THREE.TubeGeometry(curve, 18, isDimmed ? 0.008 : 0.018, 6, false));
          const tubeMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: dropColor,
              emissive: dropColor,
              emissiveIntensity: isDimmed ? 0.08 : 0.48,
              transparent: true,
              opacity: isDimmed ? 0.14 : 0.85,
            })
          );
          scene.add(new THREE.Mesh(tubeGeo, tubeMat));

          if (node.status !== 'offline' && !isDimmed) {
            const pGeo = trackGeo(new THREE.SphereGeometry(0.05, 8, 8));
            const pMat = trackMat(new THREE.MeshBasicMaterial({ color: dropColor }));
            const pMesh = new THREE.Mesh(pGeo, pMat);
            scene.add(pMesh);
            pulsePackets.push({
              mesh: pMesh,
              curve,
              speed: 0.55 + (nIdx % 4) * 0.08,
              offset: (nIdx * 0.23) % 1,
            });
          }
        }
      });
    }

    badgesRef.current = nextBadges;
    setBadges(nextBadges);

    // Save camera state continuously so clicking devices NEVER resets the user's orbit viewpoint
    const persistCamera = () => {
      savedCamRef.current = {
        key: camKey,
        pos: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
    };
    controls.addEventListener('change', persistCamera);

    // Raycasting for Click Selection & Hover Tooltip Card
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const getHit = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      return hits[0]?.object ?? null;
    };

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      const obj = getHit(e);
      if (obj?.userData?.hoverCard) {
        renderer.domElement.style.cursor = 'pointer';
        setHoverInfo(obj.userData.hoverCard as HoverCardInfo);
      } else {
        renderer.domElement.style.cursor = 'grab';
        setHoverInfo(null);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const obj = getHit(e);
      if (!obj) return;
      persistCamera();
      const ud = obj.userData;
      if (ud.pickType === 'port' && ud.rackId && ud.deviceId && ud.portId) {
        callbacksRef.current.onSelectPort?.(ud.rackId, ud.deviceId, ud.portId);
      } else if (ud.pickType === 'device' && ud.rackId && ud.deviceId) {
        callbacksRef.current.onSelectDevice?.(ud.rackId, ud.deviceId);
      } else if (ud.pickType === 'rack' && ud.rackId) {
        callbacksRef.current.onSelectRack?.(ud.rackId);
      } else if (ud.pickType === 'userNode' && ud.nodeId) {
        callbacksRef.current.onSelectUserNode?.(ud.nodeId);
      } else if (ud.pickType === 'room' && ud.roomId && ud.floorId) {
        callbacksRef.current.onSelectRoom?.(ud.roomId, ud.floorId);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Responsive ResizeObserver
    let viewW = width;
    let viewH = height;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 10 || rect.height < 10) return;
      viewW = rect.width;
      viewH = rect.height;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
    });
    ro.observe(container);

    // Zero-GC Render Loop with Live Blinking LEDs, Packet Pulses & Direct-DOM 3D Badge Projection
    const clock = new THREE.Clock();
    const tmpPoint = new THREE.Vector3();
    const projPoint = new THREE.Vector3();
    let rafId = 0;
    let timerId: number | null = null;
    let disposed = false;

    const animate = () => {
      if (disposed) return;
      const t = clock.getElapsedTime();

      for (let i = 0; i < blinkingLeds.length; i++) {
        const entry = blinkingLeds[i];
        if (entry.status === 'down') {
          entry.material.emissiveIntensity = 0.08;
        } else if (entry.status === 'error') {
          const flash = Math.sin(t * entry.speed + entry.phase) > 0 ? 2.4 : 0.15;
          entry.material.emissiveIntensity = flash;
        } else if (entry.status === 'standby') {
          entry.material.emissiveIntensity = 0.55 + 0.45 * Math.sin(t * 2.4 + entry.phase);
        } else {
          const burst = Math.sin(t * entry.speed + entry.phase) * Math.sin(t * (entry.speed * 0.37) + entry.phase * 1.7);
          entry.material.emissiveIntensity = burst > -0.1 ? (entry.isUplink ? 2.2 : 1.75) : 0.25;
        }
      }

      for (let i = 0; i < pulsePackets.length; i++) {
        const p = pulsePackets[i];
        const u = (t * p.speed + p.offset) % 1;
        p.curve.getPointAt(u, tmpPoint);
        p.mesh.position.copy(tmpPoint);
      }

      controls.update();
      renderer.render(scene, camera);

      // Project 3D Room Number Tags & Equipment Code Badges directly via GPU transform (zero React re-renders)
      const list = badgesRef.current;
      const domMap = badgeDomMapRef.current;
      const roomsVis = showRoomTagsRef.current;
      const equipVis = showEquipBadgesRef.current;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const el = domMap.get(b.id);
        if (!el) continue;
        const allowed = b.kind === 'room' ? roomsVis : equipVis;
        if (!allowed) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          continue;
        }
        projPoint.set(b.worldPos[0], b.worldPos[1], b.worldPos[2]).project(camera);
        if (projPoint.z > 1 || projPoint.z < -1) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          continue;
        }
        const sx = (projPoint.x * 0.5 + 0.5) * viewW;
        const sy = (-projPoint.y * 0.5 + 0.5) * viewH;
        if (sx < -40 || sx > viewW + 40 || sy < -20 || sy > viewH + 20) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          continue;
        }
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
        el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%)`;
      }

      if (isSwGl) {
        timerId = window.setTimeout(() => {
          if (!disposed) rafId = requestAnimationFrame(animate);
        }, 42);
      } else {
        rafId = requestAnimationFrame(animate);
      }
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      persistCamera();
      disposed = true;
      cancelAnimationFrame(rafId);
      if (timerId !== null) window.clearTimeout(timerId);
      ro.disconnect();
      controls.removeEventListener('change', persistCamera);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      envRT.dispose();
      pmrem.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, [
    mode,
    rackAssets,
    activeRackId,
    userNodes,
    interRackLinks,
    floors,
    buildings,
    rooms,
    walls,
    highlightedIds,
    selectedItemId,
    floorFilterId,
  ]);

  return (
    <div className="relative w-full h-full min-h-[380px] bg-[#090A10] overflow-hidden select-none touch-none">
      <div ref={mountRef} className="w-full h-full" />

      {/* 3D-Projected Clickable Room Number Tags & Equipment Code Badges */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
        {badges.map((b) => {
          const isSelected =
            (b.kind === 'rack' && (selectedItemId === b.rackId || activeRackId === b.rackId)) ||
            (b.kind === 'device' && selectedItemId === b.deviceId) ||
            (b.kind === 'userNode' && selectedItemId === b.nodeId);

          const styleCls =
            b.kind === 'room'
              ? 'bg-[#0F1320]/90 border-zinc-600/75 text-zinc-200 hover:border-violet-400 hover:text-white text-[9.5px] px-1.5 py-0.5 rounded-md'
              : b.kind === 'rack'
                ? isSelected
                  ? 'bg-amber-500 border-amber-300 text-zinc-950 font-extrabold text-[10px] px-2 py-0.5 rounded-lg shadow-lg'
                  : b.status === 'error'
                    ? 'bg-rose-950/95 border-rose-400 text-rose-100 text-[10px] px-2 py-0.5 rounded-lg'
                    : b.status === 'core'
                      ? 'bg-cyan-950/95 border-cyan-400/85 text-cyan-100 hover:bg-cyan-600 hover:text-white text-[10px] px-2 py-0.5 rounded-lg'
                      : 'bg-blue-950/95 border-blue-400/80 text-blue-100 hover:bg-blue-600 hover:text-white text-[10px] px-2 py-0.5 rounded-lg'
                : b.kind === 'device'
                  ? isSelected
                    ? 'bg-amber-500 border-amber-200 text-zinc-950 font-extrabold text-[9.5px] px-2 py-0.5 rounded-md shadow-lg'
                    : 'bg-[#121626]/95 border-cyan-500/50 text-cyan-100 hover:border-amber-400 text-[9.5px] px-2 py-0.5 rounded-md'
                  : isSelected
                    ? 'bg-amber-500 border-amber-200 text-zinc-950 font-extrabold text-[9.5px] px-1.5 py-0.5 rounded-md shadow-lg'
                    : b.status === 'error'
                      ? 'bg-rose-950/95 border-rose-400 text-rose-200 text-[9.5px] px-1.5 py-0.5 rounded-md'
                      : b.status === 'warn'
                        ? 'bg-amber-950/95 border-amber-400 text-amber-200 text-[9.5px] px-1.5 py-0.5 rounded-md'
                        : 'bg-emerald-950/95 border-emerald-500/70 text-emerald-100 hover:border-cyan-300 text-[9.5px] px-1.5 py-0.5 rounded-md';

          return (
            <button
              key={b.id}
              ref={(el) => {
                if (el) badgeDomMapRef.current.set(b.id, el);
                else badgeDomMapRef.current.delete(b.id);
              }}
              type="button"
              style={{ opacity: 0, willChange: 'transform' }}
              onMouseEnter={() =>
                setHoverInfo({
                  code: b.code,
                  title: b.title,
                  subtitle: b.subtitle,
                  meta: b.meta,
                  accent:
                    b.status === 'error'
                      ? 'rose'
                      : b.status === 'warn'
                        ? 'amber'
                        : b.kind === 'room'
                          ? 'violet'
                          : b.kind === 'userNode'
                            ? 'emerald'
                            : 'cyan',
                })
              }
              onMouseLeave={() => setHoverInfo(null)}
              onClick={(e) => {
                e.stopPropagation();
                if (b.kind === 'room' && b.roomId && b.floorId) {
                  callbacksRef.current.onSelectRoom?.(b.roomId, b.floorId);
                } else if (b.kind === 'rack' && b.rackId) {
                  callbacksRef.current.onSelectRack?.(b.rackId);
                } else if (b.kind === 'device' && b.rackId && b.deviceId) {
                  callbacksRef.current.onSelectDevice?.(b.rackId, b.deviceId);
                } else if (b.kind === 'userNode' && b.nodeId) {
                  callbacksRef.current.onSelectUserNode?.(b.nodeId);
                }
              }}
              className={`absolute top-0 left-0 font-mono font-bold border shadow-md whitespace-nowrap cursor-pointer transition-colors ${styleCls}`}
            >
              {b.code}
            </button>
          );
        })}
      </div>

      {/* Camera Orbit Presets + Room/Equipment Badge Toggles */}
      <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-1.5 max-w-[calc(100%-24px)]">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#11131D]/95 border border-zinc-800 shadow-lg text-[10.5px]">
          {(['iso', 'front', 'rear', 'top'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setCameraPreset(preset)}
              className="px-2 py-1 rounded-lg text-zinc-300 hover:bg-violet-600 hover:text-white font-semibold uppercase tracking-wider transition-colors cursor-pointer"
            >
              {preset}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCameraPreset('iso')}
            className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
            title="Reset 3D View"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#11131D]/95 border border-zinc-800 shadow-lg text-[10px]">
          {mode === 'campus-topology' && (
            <button
              type="button"
              onClick={() => setShowRoomTags((v) => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${
                showRoomTags ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
              title="Toggle 3D Room Number Tags"
            >
              <MapPin className="w-3 h-3" />
              Rooms
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowEquipBadges((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${
              showEquipBadges ? 'bg-cyan-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
            title="Toggle 3D Equipment & Rack Code Badges"
          >
            <Tag className="w-3 h-3" />
            Codes
          </button>
        </div>
      </div>

      {/* Floor Filter Strip in Campus 3D Map Mode */}
      {mode === 'campus-topology' && floors.length > 1 && (
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1 p-1 rounded-xl bg-[#11131D]/95 border border-zinc-800 shadow-lg text-[10.5px] max-w-[calc(100%-24px)] overflow-x-auto">
          <button
            type="button"
            onClick={() => setFloorFilterId('all')}
            className={`px-2 py-1 rounded-lg font-mono font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              floorFilterId === 'all'
                ? 'bg-cyan-600 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            All Floors ({floors.length})
          </button>
          {floors.map((fl) => (
            <button
              key={fl.id}
              type="button"
              onClick={() => setFloorFilterId(fl.id)}
              className={`px-2 py-1 rounded-lg font-mono font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                floorFilterId === fl.id
                  ? 'bg-violet-600 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {fl.code}
            </button>
          ))}
        </div>
      )}

      {/* Live Status Legend (compact, desktop-only) */}
      <div className="hidden md:flex absolute top-3 right-3 z-20 items-center gap-2.5 px-2.5 py-1.5 rounded-xl bg-[#11131D]/95 border border-zinc-800 text-[10px] font-mono text-zinc-300">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-cyan-400" /> Uplink
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> Active
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-rose-500" /> Error
        </span>
      </div>

      {/* Rich Floating Hover Tooltip Card (Room, Rack, Switch, Port, or Endpoint) */}
      {hoverInfo && (
        <div
          className={`absolute bottom-14 sm:bottom-3 right-3 z-30 w-72 max-w-[calc(100%-24px)] px-3 py-2 rounded-xl bg-[#111420]/95 border shadow-2xl pointer-events-none ${
            hoverInfo.accent === 'rose'
              ? 'border-rose-500/70'
              : hoverInfo.accent === 'amber'
                ? 'border-amber-400/70'
                : hoverInfo.accent === 'emerald'
                  ? 'border-emerald-500/70'
                  : hoverInfo.accent === 'violet'
                    ? 'border-violet-500/70'
                    : 'border-cyan-500/70'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10.5px] font-bold text-cyan-300 truncate">{hoverInfo.code}</span>
            <span className="text-[9.5px] text-zinc-400 shrink-0">Click for details</span>
          </div>
          <div className="text-xs font-bold text-white truncate mt-0.5">{hoverInfo.title}</div>
          <div className="text-[10.5px] text-zinc-300 truncate mt-0.5">{hoverInfo.subtitle}</div>
          {hoverInfo.meta && (
            <div className="text-[10px] font-mono text-zinc-400 truncate mt-1 pt-1 border-t border-zinc-800">
              {hoverInfo.meta}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
