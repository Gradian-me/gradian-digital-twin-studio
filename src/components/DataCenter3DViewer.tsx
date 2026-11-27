import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RotateCcw } from 'lucide-react';
import type {
  Floor,
  NetworkInterRackLink,
  NetworkUserNode,
  RackDevice,
  SpatialAsset,
} from '../types/twin';

export interface DataCenter3DViewerProps {
  mode: 'single-rack' | 'campus-topology';
  rackAssets: SpatialAsset[];
  activeRackId: string | null;
  userNodes: NetworkUserNode[];
  interRackLinks: NetworkInterRackLink[];
  floors: Floor[];
  selectedItemId: string | null;
  onSelectRack?: (rackId: string) => void;
  onSelectDevice?: (rackId: string, deviceId: string) => void;
  onSelectPort?: (rackId: string, deviceId: string, portId: string) => void;
  onSelectUserNode?: (nodeId: string) => void;
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
  selectedItemId,
  onSelectRack,
  onSelectDevice,
  onSelectPort,
  onSelectUserNode,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  const callbacksRef = useRef({ onSelectRack, onSelectDevice, onSelectPort, onSelectUserNode });
  callbacksRef.current = { onSelectRack, onSelectDevice, onSelectPort, onSelectUserNode };

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
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSwGl = detectSoftwareGl();
    const width = Math.max(240, container.clientWidth);
    const height = Math.max(240, container.clientHeight);

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

    if (mode === 'single-rack') {
      camera.position.set(1.85, 1.5, 2.25);
      controls.target.set(0, 1.15, 0);
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
        chassis.userData = {
          pickType: 'device',
          rackId: activeRack?.id,
          deviceId: dev.id,
          label: `${dev.name} (${dev.vendor} ${dev.model} · U${dev.uStart})`,
        };
        cabinetGroup.add(chassis);
        pickables.push(chassis);

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
            label: `${dev.name} · ${port.label} (${port.kind} ${port.speedGbps}G · ${port.status.toUpperCase()})`,
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
      // CAMPUS 3D IT TOPOLOGY MODE: Core DC -> Floor IDF Distribution -> 2960-X Access -> User Nodes
      camera.position.set(14, 11.5, 14.5);
      controls.target.set(0, 1.4, 0);
      controls.update();

      const floorList = floors.length > 0 ? floors : [{ id: 'fl-default', name: 'Level 0', code: 'L0', elevation: 0, width: 32, depth: 22, height: 4, buildingId: 'b1', order: 0 }];
      const uniqueElevs = Array.from(new Set(floorList.map((f) => f.elevation))).sort((a, b) => a - b);

      // Normalize spatial coordinates into compact centered campus stage (~20x14 units)
      const allPtsX = [
        ...rackAssets.map((a) => a.x),
        ...userNodes.map((n) => n.x),
      ];
      const allPtsZ = [
        ...rackAssets.map((a) => a.z),
        ...userNodes.map((n) => n.z),
      ];
      const minX = allPtsX.length ? Math.min(...allPtsX) : 0;
      const maxX = allPtsX.length ? Math.max(...allPtsX) : 30;
      const minZ = allPtsZ.length ? Math.min(...allPtsZ) : 0;
      const maxZ = allPtsZ.length ? Math.max(...allPtsZ) : 20;
      const spanX = Math.max(12, maxX - minX + 6);
      const spanZ = Math.max(10, maxZ - minZ + 6);
      const scale = Math.min(18 / spanX, 13 / spanZ);
      const midX = (minX + maxX) / 2;
      const midZ = (minZ + maxZ) / 2;

      const toStage = (x: number, z: number, floorId: string) => {
        const fl = floorList.find((f) => f.id === floorId);
        const elevIdx = fl ? Math.max(0, uniqueElevs.indexOf(fl.elevation)) : 0;
        return new THREE.Vector3((x - midX) * scale, elevIdx * 3.4, (z - midZ) * scale);
      };

      // Architectural Floor Plinths
      const plateW = 20;
      const plateD = 14.5;
      uniqueElevs.forEach((elev, idx) => {
        const y = idx * 3.4;
        const plateGeo = trackGeo(new THREE.BoxGeometry(plateW, 0.08, plateD));
        const plateMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: idx === 0 ? 0x111522 : 0x161c2e,
            transparent: true,
            opacity: idx === 0 ? 0.92 : 0.42,
            roughness: 0.75,
            metalness: 0.15,
          })
        );
        const plate = new THREE.Mesh(plateGeo, plateMat);
        plate.position.set(0, y - 0.04, 0);
        plate.receiveShadow = true;
        scene.add(plate);

        const edgeGeo = trackGeo(new THREE.EdgesGeometry(plateGeo));
        const edgeMat = trackMat(
          new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.65 })
        );
        const wire = new THREE.LineSegments(edgeGeo, edgeMat);
        wire.position.copy(plate.position);
        scene.add(wire);

        if (idx === 0) {
          const grid = new THREE.GridHelper(22, 22, 0x1e293b, 0x131a29);
          grid.position.y = 0.005;
          scene.add(grid);
        }
      });

      const rackPosMap = new Map<string, THREE.Vector3>();

      // Render 3D Racks (Core DC vs Distribution IDF)
      rackAssets.forEach((rack, rIdx) => {
        const pos = toStage(rack.x, rack.z, rack.floorId);
        rackPosMap.set(rack.id, pos);
        const isCore = rack.rackConfig?.rackRole === 'core-dc';
        const isSelected = selectedItemId === rack.id || activeRackId === rack.id;
        const h = isCore ? 1.85 : 1.35;
        const w = isCore ? 0.95 : 0.72;
        const d = isCore ? 0.95 : 0.72;
        const col = isCore ? 0x06b6d4 : 0x3b82f6;

        const boxGeo = trackGeo(new THREE.BoxGeometry(w, h, d));
        const boxMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: isSelected ? 0x2a2448 : 0x171b27,
            metalness: 0.75,
            roughness: 0.3,
            emissive: col,
            emissiveIntensity: isSelected ? 0.35 : 0.12,
          })
        );
        const mesh = new THREE.Mesh(boxGeo, boxMat);
        mesh.position.set(pos.x, pos.y + h / 2, pos.z);
        mesh.castShadow = true;
        mesh.userData = {
          pickType: 'rack',
          rackId: rack.id,
          label: `${rack.assetId} · ${rack.name} (${isCore ? 'Core DC MDF' : 'Distribution IDF'})`,
        };
        scene.add(mesh);
        pickables.push(mesh);

        // Glowing top crown + blinking uplink LEDs on rack front
        const crownGeo = trackGeo(new THREE.BoxGeometry(w + 0.04, 0.07, d + 0.04));
        const crownMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: col,
            emissive: col,
            emissiveIntensity: 1.4,
            roughness: 0.2,
          })
        );
        const crown = new THREE.Mesh(crownGeo, crownMat);
        crown.position.set(pos.x, pos.y + h + 0.035, pos.z);
        scene.add(crown);

        for (let b = 0; b < 4; b++) {
          const ledGeo = trackGeo(new THREE.SphereGeometry(0.042, 8, 8));
          const ledColor = b === 0 ? 0x22d3ee : 0x10b981;
          const ledMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: ledColor,
              emissive: ledColor,
              emissiveIntensity: 1.8,
            })
          );
          const led = new THREE.Mesh(ledGeo, ledMat);
          led.position.set(pos.x - 0.18 + b * 0.12, pos.y + h * 0.72, pos.z + d / 2 + 0.025);
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

      // Inter-Rack Fiber Trunks (IDF Distribution <-> Core DC) with Animated Traffic Pulses
      interRackLinks.forEach((link, lIdx) => {
        const pFrom = rackPosMap.get(link.fromRackId);
        const pTo = rackPosMap.get(link.toRackId);
        if (!pFrom || !pTo) return;
        const start = new THREE.Vector3(pFrom.x, pFrom.y + 1.1, pFrom.z);
        const end = new THREE.Vector3(pTo.x, pTo.y + 1.5, pTo.z);
        const mid = start.clone().lerp(end, 0.5);
        mid.y = Math.max(start.y, end.y) + 1.35 + (lIdx % 3) * 0.25;

        const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
        const col =
          link.status === 'down'
            ? 0xef4444
            : link.status === 'degraded'
              ? 0xf59e0b
              : link.media === 'OS2 Single-Mode'
                ? 0xfacc15
                : 0x06b6d4;
        const tubeGeo = trackGeo(new THREE.TubeGeometry(curve, 32, 0.042, 8, false));
        const tubeMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: col,
            emissive: col,
            emissiveIntensity: 0.7,
            roughness: 0.25,
          })
        );
        scene.add(new THREE.Mesh(tubeGeo, tubeMat));

        if (link.status !== 'down') {
          const pulseGeo = trackGeo(new THREE.SphereGeometry(0.095, 10, 10));
          const pulseMat = trackMat(
            new THREE.MeshBasicMaterial({ color: 0xffffff })
          );
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

      // Render 3D User Nodes + Access Drops to Floor 2960-X / IDF Switches
      userNodes.forEach((node, nIdx) => {
        const pos = toStage(node.x, node.z, node.floorId);
        const isSelected = selectedItemId === node.id;
        const statusHex =
          node.status === 'error'
            ? 0xef4444
            : node.status === 'degraded'
              ? 0xf59e0b
              : node.status === 'offline'
                ? 0x64748b
                : 0x10b981;

        const cylGeo = trackGeo(new THREE.CylinderGeometry(0.22, 0.28, 0.42, 16));
        const cylMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: isSelected ? 0x8b5cf6 : 0x1e2436,
            metalness: 0.55,
            roughness: 0.35,
            emissive: statusHex,
            emissiveIntensity: isSelected ? 0.65 : 0.24,
          })
        );
        const ped = new THREE.Mesh(cylGeo, cylMat);
        ped.position.set(pos.x, pos.y + 0.21, pos.z);
        ped.castShadow = true;
        ped.userData = {
          pickType: 'userNode',
          nodeId: node.id,
          label: `${node.code} · ${node.name} (${node.wallJackId} · ${node.ipAddress})`,
        };
        scene.add(ped);
        pickables.push(ped);

        // Top blinking status orb
        const orbGeo = trackGeo(new THREE.SphereGeometry(0.085, 10, 10));
        const orbMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: statusHex,
            emissive: statusHex,
            emissiveIntensity: 1.6,
          })
        );
        const orb = new THREE.Mesh(orbGeo, orbMat);
        orb.position.set(pos.x, pos.y + 0.5, pos.z);
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

        // Cat6A / Fiber Drop Line to Connected Switch Rack
        const targetRackPos = rackPosMap.get(node.connectedRackId);
        if (targetRackPos) {
          const start = new THREE.Vector3(pos.x, pos.y + 0.32, pos.z);
          const end = new THREE.Vector3(targetRackPos.x, targetRackPos.y + 0.65, targetRackPos.z);
          const mid = start.clone().lerp(end, 0.5);
          mid.y = Math.max(start.y, end.y) + 0.45;
          const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
          const dropColor = node.status === 'error' ? 0xef4444 : 0x14b8a6;
          const tubeGeo = trackGeo(new THREE.TubeGeometry(curve, 20, 0.018, 6, false));
          const tubeMat = trackMat(
            new THREE.MeshStandardMaterial({
              color: dropColor,
              emissive: dropColor,
              emissiveIntensity: 0.45,
              transparent: true,
              opacity: 0.85,
            })
          );
          scene.add(new THREE.Mesh(tubeGeo, tubeMat));

          if (node.status !== 'offline') {
            const pGeo = trackGeo(new THREE.SphereGeometry(0.055, 8, 8));
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

    // Raycasting for Click Selection & Hover Label
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
      if (obj?.userData?.label) {
        renderer.domElement.style.cursor = 'pointer';
        setHoverLabel(String(obj.userData.label));
      } else {
        renderer.domElement.style.cursor = 'grab';
        setHoverLabel(null);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      const obj = getHit(e);
      if (!obj) return;
      const ud = obj.userData;
      if (ud.pickType === 'port' && ud.rackId && ud.deviceId && ud.portId) {
        callbacksRef.current.onSelectPort?.(ud.rackId, ud.deviceId, ud.portId);
      } else if (ud.pickType === 'device' && ud.rackId && ud.deviceId) {
        callbacksRef.current.onSelectDevice?.(ud.rackId, ud.deviceId);
      } else if (ud.pickType === 'rack' && ud.rackId) {
        callbacksRef.current.onSelectRack?.(ud.rackId);
      } else if (ud.pickType === 'userNode' && ud.nodeId) {
        callbacksRef.current.onSelectUserNode?.(ud.nodeId);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Responsive ResizeObserver
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 10 || rect.height < 10) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
    });
    ro.observe(container);

    // Zero-GC Render Loop with Live Blinking Port/Uplink LEDs & Packet Pulses
    const clock = new THREE.Clock();
    const tmpPoint = new THREE.Vector3();
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
          // Realistic Ethernet/SFP activity blink bursts
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
      disposed = true;
      cancelAnimationFrame(rafId);
      if (timerId !== null) window.clearTimeout(timerId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      envRT.dispose();
      pmrem.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, [mode, rackAssets, activeRackId, userNodes, interRackLinks, floors, selectedItemId]);

  return (
    <div className="relative w-full h-full min-h-[380px] bg-[#090A10] overflow-hidden select-none">
      <div ref={mountRef} className="w-full h-full" />

      {/* Camera Orbit Presets */}
      <div className="absolute top-3 left-3 flex items-center gap-1 p-1 rounded-xl bg-[#11131D] border border-zinc-800 shadow-lg text-[10.5px]">
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

      {/* Live Status Legend */}
      <div className="absolute top-3 right-3 flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl bg-[#11131D] border border-zinc-800 text-[10px] font-mono text-zinc-300">
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

      {/* Interactive Hover Callout */}
      {hoverLabel && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-xl bg-[#141724] border border-violet-500/60 text-[11px] font-mono text-zinc-100 shadow-2xl pointer-events-none max-w-[90%] truncate">
          {hoverLabel}
        </div>
      )}
    </div>
  );
};
