import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crosshair,
  Eye,
  KeyRound,
  Lock,
  MapPin,
  Moon,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Video,
  Wifi,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useAclStore, computeEffectivePermissions, getActiveAclUser } from '../store/useAclStore';
import { fetchApiJson } from '../utils/safeJson';
import type { CameraKind, CameraStreamProtocol, Room, SceneCamera, SpatialAsset } from '../types/twin';

function calcYawPitchFromVec(pos: [number, number, number], target: [number, number, number]) {
  const dx = target[0] - pos[0];
  const dy = target[1] - pos[1];
  const dz = target[2] - pos[2];
  const horiz = Math.max(0.001, Math.hypot(dx, dz));
  const yawDeg = Math.round(((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360);
  const pitchDeg = Math.round((Math.atan2(dy, horiz) * 180) / Math.PI);
  const dist = Number(Math.max(2, Math.hypot(dx, dy, dz)).toFixed(1));
  return { yawDeg, pitchDeg, dist };
}

function targetFromYawPitch(
  pos: [number, number, number],
  yawDeg: number,
  pitchDeg: number,
  dist: number
): [number, number, number] {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (Math.max(-80, Math.min(80, pitchDeg)) * Math.PI) / 180;
  const horiz = Math.cos(pitch) * dist;
  return [
    Number((pos[0] + Math.sin(yaw) * horiz).toFixed(2)),
    Number((pos[1] + Math.sin(pitch) * dist).toFixed(2)),
    Number((pos[2] + Math.cos(yaw) * horiz).toFixed(2)),
  ];
}

export const LiveCctvCanvas: React.FC<{
  camera: SceneCamera;
  floorName: string;
  room: Room | null;
  roomAssets: SpatialAsset[];
  nightVision: boolean;
  ptzZoom: number;
  ptzPan: number;
}> = ({ camera, floorName, room, roomAssets, nightVision, ptzZoom, ptzPan }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = (t: number) => {
      const w = canvas.width;
      const h = canvas.height;
      const sec = t * 0.001;

      // Industrial surveillance background tinted by room environment
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      if (nightVision) {
        grad.addColorStop(0, '#04120c');
        grad.addColorStop(0.55, '#092418');
        grad.addColorStop(1, '#04140d');
      } else {
        grad.addColorStop(0, '#0e111a');
        grad.addColorStop(0.52, '#181e2c');
        grad.addColorStop(1, '#0c0f17');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(w / 2 + ptzPan * 22, h / 2);
      ctx.scale(ptzZoom, ptzZoom);
      ctx.translate(-w / 2, -h / 2);

      // Perspective room floor & walls based on mounted room dimensions
      const horizonY = h * 0.4;
      const vanishX = w * 0.5 + Math.sin(sec * 0.22) * 10;
      ctx.strokeStyle = nightVision ? 'rgba(52,211,153,0.18)' : 'rgba(139,92,246,0.24)';
      ctx.lineWidth = 1;
      for (let i = -6; i <= 6; i++) {
        ctx.beginPath();
        ctx.moveTo(vanishX + i * 24, horizonY);
        ctx.lineTo(vanishX + i * 115, h);
        ctx.stroke();
      }
      for (let r = 1; r <= 6; r++) {
        const yy = horizonY + Math.pow(r / 6, 1.75) * (h - horizonY);
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
      }

      // Back room wall header & cleanroom lighting strip
      ctx.fillStyle = nightVision ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(w * 0.08, h * 0.14, w * 0.84, horizonY - h * 0.14);
      ctx.strokeStyle = nightVision ? 'rgba(52,211,153,0.28)' : 'rgba(148,163,184,0.24)';
      ctx.strokeRect(w * 0.08, h * 0.14, w * 0.84, horizonY - h * 0.14);

      // Overhead cleanroom LED troffer bars
      ctx.fillStyle = nightVision ? 'rgba(110,231,183,0.28)' : 'rgba(224,242,254,0.35)';
      ctx.fillRect(w * 0.22, h * 0.16, w * 0.18, 4);
      ctx.fillRect(w * 0.6, h * 0.16, w * 0.18, 4);

      // Render REAL equipment inside the camera's mounted room
      const baseColor = nightVision ? 'rgba(16,185,129,0.25)' : 'rgba(148,163,184,0.20)';
      const strokeColor = nightVision ? 'rgba(110,231,183,0.6)' : 'rgba(196,181,253,0.58)';
      const itemsToRender =
        roomAssets.length > 0
          ? roomAssets.slice(0, 6).map((a, idx, arr) => {
              const frac = arr.length === 1 ? 0.5 : (idx + 0.6) / (arr.length + 0.2);
              const rw = Math.max(54, Math.min(104, a.width * 34));
              const rh = Math.max(66, Math.min(126, a.height * 46));
              return {
                x: w * 0.1 + frac * (w * 0.72) - rw / 2,
                y: horizonY + 18 + (idx % 2) * 18 - rh * 0.45,
                rw,
                rh,
                label: a.assetId || a.name.slice(0, 10),
                sub: a.operationalStatus.toUpperCase(),
                isAlarm: a.operationalStatus === 'maintenance-due' || a.operationalStatus === 'offline',
                isRack: Boolean(a.rackConfig) || a.archetype === 'server-rack' || a.archetype === 'network-rack',
              };
            })
          : [
              {
                x: w * 0.26,
                y: h * 0.38,
                rw: 90,
                rh: 94,
                label: room?.code ?? 'ZONE',
                sub: room?.environmental?.cleanroomGrade?.split(' ')[0] ?? 'GMP',
                isAlarm: false,
                isRack: false,
              },
              {
                x: w * 0.58,
                y: h * 0.4,
                rw: 86,
                rh: 86,
                label: 'HVAC-MON',
                sub: 'ONLINE',
                isAlarm: false,
                isRack: false,
              },
            ];

      itemsToRender.forEach((tk, idx) => {
        ctx.fillStyle = baseColor;
        ctx.strokeStyle = tk.isAlarm ? '#F59E0B' : strokeColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(tk.x, tk.y, tk.rw, tk.rh, 8);
        ctx.fill();
        ctx.stroke();

        // If IT Rack, draw blinking switch LEDs!
        if (tk.isRack) {
          for (let row = 0; row < 5; row++) {
            const ledBlink = Math.sin(sec * 7 + row * 1.9 + idx) > -0.15;
            ctx.fillStyle = ledBlink ? '#06B6D4' : '#22C55E';
            ctx.fillRect(tk.x + 10, tk.y + 16 + row * 12, tk.rw - 24, 5);
            ctx.fillStyle = ledBlink ? '#34D399' : '#1E293B';
            ctx.beginPath();
            ctx.arc(tk.x + tk.rw - 9, tk.y + 18.5 + row * 12, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Equipment status LED
          const ledOn = Math.sin(sec * 3 + idx * 1.4) > -0.2;
          ctx.fillStyle = tk.isAlarm
            ? '#F59E0B'
            : ledOn
              ? nightVision
                ? '#34D399'
                : '#22C55E'
              : '#334155';
          ctx.beginPath();
          ctx.arc(tk.x + tk.rw - 11, tk.y + 13, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = nightVision ? '#A7F3D0' : '#F1F5F9';
        ctx.font = '700 9.5px monospace';
        ctx.fillText(tk.label.slice(0, 11), tk.x + 7, tk.y + tk.rh - 18);
        ctx.fillStyle = tk.isAlarm ? '#FBBF24' : '#94A3B8';
        ctx.font = '600 8px monospace';
        ctx.fillText(tk.sub.slice(0, 11), tk.x + 7, tk.y + tk.rh - 7);
      });

      // Moving AI vision bounding box
      const mx = w * 0.24 + ((sec * 20) % (w * 0.48));
      const my = h * 0.56;
      ctx.strokeStyle = nightVision ? '#34D399' : '#F59E0B';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(mx, my, 44, 72);
      ctx.fillStyle = nightVision ? 'rgba(16,185,129,0.22)' : 'rgba(245,158,11,0.2)';
      ctx.fillRect(mx, my - 14, 76, 14);
      ctx.fillStyle = nightVision ? '#A7F3D0' : '#FDE68A';
      ctx.font = '700 8.5px monospace';
      ctx.fillText('GMP-OP 98%', mx + 3, my - 4);

      ctx.restore();

      // Subtle scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1);
      }

      // Crosshair reticle
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 14, h / 2);
      ctx.lineTo(w / 2 + 14, h / 2);
      ctx.moveTo(w / 2, h / 2 - 14);
      ctx.lineTo(w / 2, h / 2 + 14);
      ctx.stroke();

      // Top-Left OSD Stamp with Mounted Room Code
      ctx.fillStyle = 'rgba(9,9,11,0.78)';
      ctx.fillRect(10, 10, 310, 22);
      ctx.fillStyle = '#EF4444';
      if (Math.floor(sec * 2) % 2 === 0) {
        ctx.beginPath();
        ctx.arc(21, 21, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#F4F4F5';
      ctx.font = '700 10px monospace';
      const roomTag = room ? `[${room.code}] ` : '';
      ctx.fillText(
        `REC · ${roomTag}${camera.name.slice(0, 24).toUpperCase()}`,
        32,
        24.5
      );

      // Top-Right Timestamp + Room Environmental Telemetry
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      ctx.fillStyle = 'rgba(9,9,11,0.78)';
      ctx.fillRect(w - 204, 10, 194, 22);
      ctx.fillStyle = nightVision ? '#6EE7B7' : '#C4B5FD';
      ctx.font = '600 10px monospace';
      ctx.fillText(nowStr, w - 196, 24.5);

      if (room?.environmental) {
        ctx.fillStyle = 'rgba(9,9,11,0.76)';
        ctx.fillRect(10, 36, 275, 19);
        ctx.fillStyle = '#34D399';
        ctx.font = '600 9.5px monospace';
        ctx.fillText(
          `${room.name.slice(0, 18)} · ${room.environmental.temperatureC}°C · ${room.environmental.humidityPct}%RH · ${room.environmental.pressurePa >= 0 ? '+' : ''}${room.environmental.pressurePa}Pa`,
          16,
          49
        );
      }

      // Bottom Stream Bar
      ctx.fillStyle = 'rgba(9,9,11,0.78)';
      ctx.fillRect(10, h - 30, w - 20, 20);
      ctx.fillStyle = '#A1A1AA';
      ctx.font = '500 10px monospace';
      const streamInfo = camera.ipAddress
        ? `${camera.protocol ?? 'RTSP'}://${camera.ipAddress}:${camera.port ?? 554}${camera.streamPath ?? '/stream1'}`
        : `LOCAL-TWIN-CAM · ${floorName}`;
      ctx.fillText(
        `${streamInfo}   |   ${roomAssets.length} ASSETS   |   FOV ${camera.fov}°   |   ZOOM ${ptzZoom.toFixed(1)}×`,
        16,
        h - 16.5
      );

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [camera, floorName, room, roomAssets, nightVision, ptzZoom, ptzPan]);

  const isDirectHttpStream =
    camera.ipAddress &&
    (camera.protocol === 'MJPEG' || camera.protocol === 'HLS') &&
    /^https?:\/\//i.test(camera.ipAddress);

  return (
    <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-inner">
      {isDirectHttpStream ? (
        <img
          src={`${camera.ipAddress}${camera.streamPath ?? ''}`}
          alt={camera.name}
          className="w-full h-full object-cover"
        />
      ) : (
        <canvas ref={canvasRef} width={640} height={360} className="w-full h-full block" />
      )}
    </div>
  );
};

export const CameraManagerModal: React.FC = () => {
  const showCameraManager = useTwinStore((s) => s.showCameraManager);
  const setShowCameraManager = useTwinStore((s) => s.setShowCameraManager);
  const activeLiveCameraId = useTwinStore((s) => s.activeLiveCameraId);
  const openLiveCamera = useTwinStore((s) => s.openLiveCamera);
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const addCamera = useTwinStore((s) => s.addCamera);
  const updateCamera = useTwinStore((s) => s.updateCamera);
  const deleteCamera = useTwinStore((s) => s.deleteCamera);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const showToast = useTwinStore((s) => s.showToast);

  const workspaceMode = useTwinStore((s) => s.workspaceMode);
  const aclUsers = useAclStore((s) => s.users);
  const aclRoles = useAclStore((s) => s.roles);
  const aclGroups = useAclStore((s) => s.groups);
  const activeAclUserId = useAclStore((s) => s.activeAclUserId);

  const canEdit = useMemo(() => {
    if (workspaceMode === 'view') return false;
    const activeUser = getActiveAclUser({ users: aclUsers, activeAclUserId });
    if (!activeUser) return true;
    if (activeUser.status === 'suspended') return false;
    return computeEffectivePermissions(activeUser, aclRoles, aclGroups).includes('spatial.edit');
  }, [workspaceMode, aclUsers, aclRoles, aclGroups, activeAclUserId]);

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [viewTab, setViewTab] = useState<'live' | 'config'>('live');
  const [ptzZoom, setPtzZoom] = useState(1);
  const [ptzPan, setPtzPan] = useState(0);

  // Credential inputs (plaintext password never persisted in store!)
  const [plainPassword, setPlainPassword] = useState('');
  const [hashingPwd, setHashingPwd] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [connStatus, setConnStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const filteredCameras = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scene.cameras.filter((c) => {
      if (!q) return true;
      const fl = scene.floors.find((f) => f.id === c.floorId);
      const rm = c.roomId ? scene.rooms.find((r) => r.id === c.roomId) : undefined;
      return (
        c.name.toLowerCase().includes(q) ||
        c.kind.toLowerCase().includes(q) ||
        (c.ipAddress ?? '').toLowerCase().includes(q) ||
        (fl?.name ?? '').toLowerCase().includes(q) ||
        (rm?.name ?? '').toLowerCase().includes(q) ||
        (rm?.code ?? '').toLowerCase().includes(q)
      );
    });
  }, [scene.cameras, scene.floors, scene.rooms, search]);

  const selectCamera = (camId: string, nextTab?: 'live' | 'config') => {
    setSelectedId(camId);
    openLiveCamera(camId);
    setConnStatus(null);
    setPtzZoom(1);
    setPtzPan(0);
    if (nextTab) setViewTab(nextTab);
  };

  // Sync only when modal opens or external activeLiveCameraId changes (NOT when local selectedId changes!)
  useEffect(() => {
    if (!showCameraManager) return;
    if (activeLiveCameraId && scene.cameras.some((c) => c.id === activeLiveCameraId)) {
      setSelectedId(activeLiveCameraId);
    } else if (scene.cameras.length > 0) {
      setSelectedId((prev) =>
        prev && scene.cameras.some((c) => c.id === prev) ? prev : scene.cameras[0].id
      );
    }
  }, [showCameraManager, activeLiveCameraId, scene.cameras]);

  // ArrowUp / ArrowDown keyboard navigation across camera list
  useEffect(() => {
    if (!showCameraManager) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        setShowCameraManager(false);
        openLiveCamera(null);
        return;
      }
      if (filteredCameras.length === 0) return;
      const idx = filteredCameras.findIndex((c) => c.id === selectedId);
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = filteredCameras[(idx + 1) % filteredCameras.length];
        selectCamera(next.id);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = filteredCameras[(idx - 1 + filteredCameras.length) % filteredCameras.length];
        selectCamera(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCameraManager, filteredCameras, selectedId, setShowCameraManager, openLiveCamera]);

  if (!showCameraManager) return null;

  const activeCam = scene.cameras.find((c) => c.id === selectedId) ?? filteredCameras[0] ?? null;
  const activeCamIndex = activeCam ? filteredCameras.findIndex((c) => c.id === activeCam.id) : -1;
  const activeFloor = activeCam ? scene.floors.find((f) => f.id === activeCam.floorId) : null;
  const activeRoom = activeCam
    ? (activeCam.roomId ? scene.rooms.find((r) => r.id === activeCam.roomId) : undefined) ??
      scene.rooms.find(
        (r) =>
          r.floorId === activeCam.floorId &&
          activeCam.target[0] >= r.x &&
          activeCam.target[0] <= r.x + r.width &&
          activeCam.target[2] >= r.z &&
          activeCam.target[2] <= r.z + r.depth
      ) ??
      null
    : null;
  const activeRoomAssets = activeRoom
    ? scene.assets.filter(
        (a) =>
          a.floorId === activeRoom.floorId &&
          (a.roomId === activeRoom.id ||
            (a.x >= activeRoom.x &&
              a.x <= activeRoom.x + activeRoom.width &&
              a.z >= activeRoom.z &&
              a.z <= activeRoom.z + activeRoom.depth))
      )
    : [];

  const orient = activeCam
    ? calcYawPitchFromVec(activeCam.position, activeCam.target)
    : { yawDeg: 0, pitchDeg: -15, dist: 10 };

  const handleClose = () => {
    setShowCameraManager(false);
    openLiveCamera(null);
    setPlainPassword('');
    setConnStatus(null);
  };

  const handleGoTo3D = (cam: SceneCamera) => {
    setViewMode('3d-perspective');
    focusEntity({ type: 'camera', id: cam.id });
    handleClose();
  };

  const snapCameraToRoom = (camId: string, roomId: string) => {
    const rm = scene.rooms.find((r) => r.id === roomId);
    if (!rm) return;
    const fl = scene.floors.find((f) => f.id === rm.floorId);
    const elev = fl?.elevation ?? 0;
    const px = Number((rm.x + Math.min(0.85, rm.width * 0.14)).toFixed(2));
    const pz = Number((rm.z + Math.min(0.85, rm.depth * 0.14)).toFixed(2));
    const py = Number((elev + Math.min(2.9, rm.height - 0.55)).toFixed(2));
    const tx = Number((rm.x + rm.width * 0.56).toFixed(2));
    const tz = Number((rm.z + rm.depth * 0.56).toFixed(2));
    const ty = Number((elev + 1.25).toFixed(2));
    updateCamera(camId, {
      floorId: rm.floorId,
      roomId: rm.id,
      position: [px, py, pz],
      target: [tx, ty, tz],
    });
  };

  const handleAddCamera = () => {
    if (!canEdit) {
      showToast('Read-only mode: switch to Design Mode to add cameras.', 'warning');
      return;
    }
    const floorRooms = scene.rooms.filter((r) => r.floorId === activeFloorId);
    const targetRoom = floorRooms[scene.cameras.length % Math.max(1, floorRooms.length)] ?? scene.rooms[0];
    const fl = scene.floors.find((f) => f.id === (targetRoom?.floorId ?? activeFloorId)) ?? scene.floors[0];
    const elev = fl?.elevation ?? 0;
    const px = targetRoom ? Number((targetRoom.x + Math.min(0.85, targetRoom.width * 0.14)).toFixed(2)) : 4;
    const pz = targetRoom ? Number((targetRoom.z + Math.min(0.85, targetRoom.depth * 0.14)).toFixed(2)) : 4;
    const tx = targetRoom ? Number((targetRoom.x + targetRoom.width * 0.55).toFixed(2)) : 9;
    const tz = targetRoom ? Number((targetRoom.z + targetRoom.depth * 0.55).toFixed(2)) : 9;
    const created = addCamera({
      floorId: fl?.id ?? activeFloorId,
      roomId: targetRoom?.id,
      name: targetRoom
        ? `${targetRoom.code} ${targetRoom.name.slice(0, 18)} Cam`
        : `CCTV Security Cam ${scene.cameras.length + 1}`,
      kind: 'security',
      group: 'IP Surveillance',
      position: [px, Number((elev + 2.85).toFixed(2)), pz],
      target: [tx, Number((elev + 1.25).toFixed(2)), tz],
      fov: 68,
      focalLengthMm: 24,
      coverageRadius: 11,
      visibleCone: true,
      layerId: 'layer-cameras',
      ipAddress: `10.42.20.${102 + scene.cameras.length}`,
      port: 554,
      protocol: 'RTSP',
      streamPath: '/h265/ch01/main',
      username: 'gmp_cctv_op',
      resolution: '2560×1440',
      fps: 30,
      nightVision: false,
      status: 'online',
    });
    selectCamera(created.id, 'config');
  };

  const handleSaveArgon2Password = async () => {
    if (!activeCam || plainPassword.length < 4) {
      showToast('Enter at least 4 characters to hash with Argon2id.', 'warning');
      return;
    }
    setHashingPwd(true);
    try {
      const data = await fetchApiJson<any>(
        '/api/cameras/hash-password',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: plainPassword }),
        },
        'Failed to hash camera password.'
      );
      if (!data.hash) throw new Error(data.error || 'Hashing failed');
      updateCamera(activeCam.id, {
        passwordHash: data.hash,
        hasCredentials: true,
      });
      setPlainPassword('');
      showToast('Camera password hashed with Argon2id (PHC) and bound securely.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Failed to hash camera password.', 'error');
    } finally {
      setHashingPwd(false);
    }
  };

  const handleTestConnection = async () => {
    if (!activeCam) return;
    setTestingConn(true);
    setConnStatus(null);
    try {
      const data = await fetchApiJson<any>(
        '/api/cameras/test-connection',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ipAddress: activeCam.ipAddress || '10.42.20.101',
            port: activeCam.port || 554,
            protocol: activeCam.protocol || 'RTSP',
            streamPath: activeCam.streamPath || '/stream1',
          }),
        },
        'Connection check failed'
      );
      setConnStatus({
        ok: true,
        text: `Connected (${data.latencyMs}ms · ${data.codec}) → ${data.endpoint}`,
      });
      updateCamera(activeCam.id, { status: 'recording' });
    } catch (err: any) {
      setConnStatus({ ok: false, text: err?.message || 'Network error verifying camera endpoint' });
    } finally {
      setTestingConn(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-6xl h-[100dvh] sm:h-[88vh] bg-white dark:bg-[#111116] border-0 sm:border border-zinc-200 dark:border-zinc-800 rounded-none sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-[#0E0E12] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={handleClose}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#18181F] hover:border-violet-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
              Back
            </button>
            <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
              <Video className="w-4 h-4 text-violet-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white truncate">
                Camera Command Center &amp; IP CCTV Live Feeds ({scene.cameras.length})
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                Position, direction (yaw/pitch), FOV optical cone, Argon2id-protected IP streams &amp; instant Go-to-3D
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canEdit ? (
              <button
                onClick={handleAddCamera}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New Camera
              </button>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-500 text-[11px] font-semibold">
                <Lock className="w-3 h-3" />
                View Only
              </span>
            )}
            <button
              onClick={handleClose}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left Camera List + Search */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0 bg-zinc-50/50 dark:bg-[#0F0F14]">
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2 shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search cameras by name, IP, or floor..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-white dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1">
                <span>{filteredCameras.length} cameras visible</span>
                <span className="font-mono">↑ / ↓ Arrow Navigate</span>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-2.5 space-y-1.5">
              {filteredCameras.map((cam) => {
                const fl = scene.floors.find((f) => f.id === cam.floorId);
                const rm = cam.roomId ? scene.rooms.find((r) => r.id === cam.roomId) : undefined;
                const isSel = cam.id === activeCam?.id;
                return (
                  <div
                    key={cam.id}
                    onClick={() => selectCamera(cam.id)}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all space-y-2 ${
                      isSel
                        ? 'border-violet-500 bg-violet-500/10 dark:bg-violet-500/12 shadow-xs'
                        : 'border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-[#15151C] hover:border-zinc-400 dark:hover:border-zinc-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-900 dark:text-white truncate flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              cam.status === 'recording'
                                ? 'bg-rose-500'
                                : cam.status === 'offline'
                                  ? 'bg-zinc-500'
                                  : 'bg-emerald-500'
                            }`}
                          />
                          {cam.name}
                        </div>
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5 font-mono">
                          {fl?.code ?? cam.floorId} {rm ? `· ${rm.code} ${rm.name}` : '· Unassigned'}
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate font-mono">
                          FOV {cam.fov}° · {cam.ipAddress ?? '3D Viewpoint'}
                        </div>
                      </div>
                      {cam.hasCredentials && (
                        <span
                          title="Argon2id Protected Credentials"
                          className="p-1 rounded-lg bg-emerald-500/15 text-emerald-500 shrink-0"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          selectCamera(cam.id, 'live');
                        }}
                        className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-zinc-100 dark:bg-[#1E1E28] hover:bg-violet-600 hover:text-white text-[10.5px] font-medium transition-colors"
                      >
                        <Radio className="w-3 h-3 text-rose-400" />
                        LiveCam
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGoTo3D(cam);
                        }}
                        className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-zinc-100 dark:bg-[#1E1E28] hover:bg-amber-500 hover:text-zinc-950 text-[10.5px] font-medium transition-colors"
                      >
                        <Crosshair className="w-3 h-3 text-amber-500" />
                        Go to 3D
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right LiveCam & Precision Config Stage */}
          <div className="lg:col-span-8 flex flex-col min-h-0 overflow-hidden bg-white dark:bg-[#121218]">
            {activeCam ? (
              <>
                <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setViewTab('live')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                        viewTab === 'live'
                          ? 'bg-violet-600 text-white'
                          : 'bg-zinc-100 dark:bg-[#1B1B24] text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      <Radio className="w-3.5 h-3.5" />
                      LiveCam Preview
                    </button>
                    <button
                      onClick={() => setViewTab('config')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                        viewTab === 'config'
                          ? 'bg-violet-600 text-white'
                          : 'bg-zinc-100 dark:bg-[#1B1B24] text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      <Compass className="w-3.5 h-3.5" />
                      Position, FOV &amp; IP Credentials
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {filteredCameras.length > 1 && (
                      <div className="flex items-center gap-1 mr-1 bg-zinc-100 dark:bg-[#1B1B24] rounded-xl p-0.5 border border-zinc-200 dark:border-zinc-800">
                        <button
                          onClick={() => {
                            const prevIdx =
                              (activeCamIndex - 1 + filteredCameras.length) % filteredCameras.length;
                            selectCamera(filteredCameras[prevIdx].id);
                          }}
                          className="p-1.5 rounded-lg hover:bg-violet-600 hover:text-white text-zinc-600 dark:text-zinc-300 transition-colors"
                          title="Previous Camera (← / ↑)"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-1.5 text-[10.5px] font-mono tabular-nums text-zinc-500">
                          {activeCamIndex + 1}/{filteredCameras.length}
                        </span>
                        <button
                          onClick={() => {
                            const nextIdx = (activeCamIndex + 1) % filteredCameras.length;
                            selectCamera(filteredCameras[nextIdx].id);
                          }}
                          className="p-1.5 rounded-lg hover:bg-violet-600 hover:text-white text-zinc-600 dark:text-zinc-300 transition-colors"
                          title="Next Camera (→ / ↓)"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => handleGoTo3D(activeCam)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Jump to 3D Camera
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => {
                          deleteCamera(activeCam.id);
                          setSelectedId('');
                          openLiveCamera(null);
                        }}
                        className="p-1.5 rounded-xl border border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
                        title="Delete Camera"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div key={viewTab} className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 sm:p-5 space-y-5">
                  {viewTab === 'live' ? (
                    <div className="space-y-4">
                      <LiveCctvCanvas
                        camera={activeCam}
                        floorName={activeFloor?.name ?? activeCam.floorId}
                        room={activeRoom}
                        roomAssets={activeRoomAssets}
                        nightVision={Boolean(activeCam.nightVision)}
                        ptzZoom={ptzZoom}
                        ptzPan={ptzPan}
                      />

                      {/* PTZ & IR Controls */}
                      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                            PTZ Optical Control
                          </span>
                          <button
                            onClick={() => setPtzPan((p) => Math.max(-4, p - 1))}
                            className="px-2.5 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-xs font-mono"
                          >
                            ◀ Pan
                          </button>
                          <button
                            onClick={() => setPtzPan(0)}
                            className="px-2.5 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-xs font-mono"
                          >
                            Center
                          </button>
                          <button
                            onClick={() => setPtzPan((p) => Math.min(4, p + 1))}
                            className="px-2.5 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-xs font-mono"
                          >
                            Pan ▶
                          </button>
                          <button
                            onClick={() => setPtzZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
                            className="p-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800"
                            title="Zoom Out"
                          >
                            <ZoomOut className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-xs font-mono text-violet-500 font-semibold">
                            {ptzZoom.toFixed(1)}×
                          </span>
                          <button
                            onClick={() => setPtzZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                            className="p-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800"
                            title="Zoom In"
                          >
                            <ZoomIn className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <button
                          onClick={() =>
                            updateCamera(activeCam.id, { nightVision: !activeCam.nightVision })
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                            activeCam.nightVision
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                              : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          <Moon className="w-3.5 h-3.5" />
                          IR Night Vision: {activeCam.nightVision ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      {/* Quick Optical Spec Strip */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800">
                          <div className="text-[10px] text-zinc-500">Mount Position</div>
                          <div className="font-mono font-semibold text-zinc-900 dark:text-white mt-0.5">
                            {activeCam.position.map((v) => v.toFixed(1)).join(', ')} m
                          </div>
                        </div>
                        <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800">
                          <div className="text-[10px] text-zinc-500">Direction (Yaw / Pitch)</div>
                          <div className="font-mono font-semibold text-violet-500 mt-0.5">
                            {orient.yawDeg}° / {orient.pitchDeg}°
                          </div>
                        </div>
                        <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800">
                          <div className="text-[10px] text-zinc-500">Optical FOV / Range</div>
                          <div className="font-mono font-semibold text-amber-500 mt-0.5">
                            {activeCam.fov}° · {activeCam.coverageRadius} m
                          </div>
                        </div>
                        <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800">
                          <div className="text-[10px] text-zinc-500">Security Credential</div>
                          <div className="font-mono font-semibold text-emerald-500 mt-0.5">
                            {activeCam.passwordHash
                              ? 'Argon2id Verified'
                              : activeCam.hasCredentials
                                ? 'Auth Bound'
                                : 'Unconfigured'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {/* Identity & Optical Geometry */}
                      <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800 space-y-4">
                        <div className="text-xs font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                          <Compass className="w-4 h-4 text-violet-500" />
                          3D Position, Aim Direction &amp; Optical Cone
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="sm:col-span-2">
                            <label className="text-[10px] font-medium text-zinc-500 block mb-1">Camera Name</label>
                            <input
                              disabled={!canEdit}
                              value={activeCam.name}
                              onChange={(e) => updateCamera(activeCam.id, { name: e.target.value })}
                              className="w-full px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700 disabled:opacity-60"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-zinc-500 block mb-1">Type</label>
                            <select
                              disabled={!canEdit}
                              value={activeCam.kind}
                              onChange={(e) => updateCamera(activeCam.id, { kind: e.target.value as CameraKind })}
                              className="w-full px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700 disabled:opacity-60"
                            >
                              <option value="security">Security IP CCTV</option>
                              <option value="fixed-industrial">Fixed Industrial</option>
                              <option value="inspection">GMP Inspection</option>
                              <option value="perspective">3D Perspective</option>
                              <option value="first-person">First-Person</option>
                            </select>
                          </div>
                        </div>

                        {/* Mounted Room Auto-Snap Selector */}
                        <div className="flex flex-col sm:flex-row sm:items-end gap-2.5 p-3 rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-800">
                          <div className="flex-1 min-w-0">
                            <label className="text-[10px] font-medium text-zinc-500 flex items-center gap-1 mb-1">
                              <MapPin className="w-3 h-3 text-violet-500" />
                              Mounted Room (Auto-Positions Camera Inside Room)
                            </label>
                            <select
                              disabled={!canEdit}
                              value={activeRoom?.id ?? ''}
                              onChange={(e) => {
                                if (e.target.value) snapCameraToRoom(activeCam.id, e.target.value);
                              }}
                              className="w-full px-3 py-1.5 text-xs rounded-xl bg-zinc-50 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-700 disabled:opacity-60"
                            >
                              {scene.rooms.map((rm) => {
                                const fl = scene.floors.find((f) => f.id === rm.floorId);
                                return (
                                  <option key={rm.id} value={rm.id}>
                                    {fl?.code ?? rm.floorId} · {rm.code} — {rm.name}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                          {activeRoom && canEdit && (
                            <button
                              type="button"
                              onClick={() => snapCameraToRoom(activeCam.id, activeRoom.id)}
                              className="px-3 py-1.5 rounded-xl bg-violet-600/15 hover:bg-violet-600 hover:text-white text-violet-500 text-[11px] font-semibold whitespace-nowrap transition-colors"
                            >
                              Re-Center Aim
                            </button>
                          )}
                        </div>

                        {/* X, Y, Z Mount Coordinates */}
                        <div className="grid grid-cols-3 gap-3">
                          {(['X (m)', 'Y Height (m)', 'Z (m)'] as const).map((label, idx) => (
                            <div key={label}>
                              <label className="text-[10px] font-medium text-zinc-500 block mb-1">{label}</label>
                              <input
                                type="number"
                                step={0.2}
                                value={activeCam.position[idx]}
                                onChange={(e) => {
                                  const nextPos: [number, number, number] = [...activeCam.position];
                                  nextPos[idx] = Number(e.target.value);
                                  const nextTarget = targetFromYawPitch(
                                    nextPos,
                                    orient.yawDeg,
                                    orient.pitchDeg,
                                    orient.dist
                                  );
                                  updateCamera(activeCam.id, { position: nextPos, target: nextTarget });
                                }}
                                className="w-full px-3 py-1.5 text-xs font-mono rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700"
                              />
                            </div>
                          ))}
                        </div>

                        {/* Intuitive Yaw, Pitch, FOV, Coverage Radius Sliders */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                          <div>
                            <div className="flex justify-between text-[11px] mb-1">
                              <span className="text-zinc-500">Direction Yaw (Azimuth)</span>
                              <span className="font-mono font-semibold text-violet-500">{orient.yawDeg}°</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={359}
                              step={1}
                              value={orient.yawDeg}
                              onChange={(e) => {
                                const nextYaw = Number(e.target.value);
                                updateCamera(activeCam.id, {
                                  target: targetFromYawPitch(activeCam.position, nextYaw, orient.pitchDeg, orient.dist),
                                });
                              }}
                              className="w-full accent-violet-500"
                            />
                          </div>

                          <div>
                            <div className="flex justify-between text-[11px] mb-1">
                              <span className="text-zinc-500">Tilt Pitch Angle</span>
                              <span className="font-mono font-semibold text-violet-500">{orient.pitchDeg}°</span>
                            </div>
                            <input
                              type="range"
                              min={-75}
                              max={35}
                              step={1}
                              value={orient.pitchDeg}
                              onChange={(e) => {
                                const nextPitch = Number(e.target.value);
                                updateCamera(activeCam.id, {
                                  target: targetFromYawPitch(activeCam.position, orient.yawDeg, nextPitch, orient.dist),
                                });
                              }}
                              className="w-full accent-violet-500"
                            />
                          </div>

                          <div>
                            <div className="flex justify-between text-[11px] mb-1">
                              <span className="text-zinc-500">Field of View (FOV Angle)</span>
                              <span className="font-mono font-semibold text-amber-500">{activeCam.fov}°</span>
                            </div>
                            <input
                              type="range"
                              min={25}
                              max={120}
                              step={1}
                              value={activeCam.fov}
                              onChange={(e) => updateCamera(activeCam.id, { fov: Number(e.target.value) })}
                              className="w-full accent-amber-500"
                            />
                          </div>

                          <div>
                            <div className="flex justify-between text-[11px] mb-1">
                              <span className="text-zinc-500">Optical Coverage Depth</span>
                              <span className="font-mono font-semibold text-amber-500">{activeCam.coverageRadius} m</span>
                            </div>
                            <input
                              type="range"
                              min={3}
                              max={28}
                              step={0.5}
                              value={activeCam.coverageRadius}
                              onChange={(e) =>
                                updateCamera(activeCam.id, { coverageRadius: Number(e.target.value) })
                              }
                              className="w-full accent-amber-500"
                            />
                          </div>
                        </div>

                        <label className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={activeCam.visibleCone}
                            onChange={(e) => updateCamera(activeCam.id, { visibleCone: e.target.checked })}
                            className="accent-violet-500"
                          />
                          Show 3D FOV Frustum Coverage Cone in Viewport
                        </label>
                      </div>

                      {/* Real IP Stream & Argon2id Security Credentials */}
                      <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-[#17171F] border border-zinc-200 dark:border-zinc-800 space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                            <Lock className="w-4 h-4 text-emerald-500" />
                            Real IP Stream Connection &amp; Argon2id Credentials
                          </div>
                          {activeCam.passwordHash && (
                            <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-500 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Argon2id Hashed
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                          <div className="sm:col-span-3">
                            <label className="text-[10px] font-medium text-zinc-500 block mb-1">Protocol</label>
                            <select
                              value={activeCam.protocol ?? 'RTSP'}
                              onChange={(e) =>
                                updateCamera(activeCam.id, {
                                  protocol: e.target.value as CameraStreamProtocol,
                                })
                              }
                              className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700"
                            >
                              <option value="RTSP">RTSP</option>
                              <option value="ONVIF">ONVIF</option>
                              <option value="HLS">HLS (HTTP)</option>
                              <option value="MJPEG">MJPEG (HTTP)</option>
                              <option value="WebRTC">WebRTC</option>
                            </select>
                          </div>
                          <div className="sm:col-span-5">
                            <label className="text-[10px] font-medium text-zinc-500 block mb-1">IP Address / Host</label>
                            <input
                              value={activeCam.ipAddress ?? ''}
                              onChange={(e) => updateCamera(activeCam.id, { ipAddress: e.target.value })}
                              placeholder="10.42.20.101"
                              className="w-full px-3 py-1.5 text-xs font-mono rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="text-[10px] font-medium text-zinc-500 block mb-1">Port</label>
                            <input
                              type="number"
                              value={activeCam.port ?? 554}
                              onChange={(e) => updateCamera(activeCam.id, { port: Number(e.target.value) })}
                              className="w-full px-2.5 py-1.5 text-xs font-mono rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="text-[10px] font-medium text-zinc-500 block mb-1">Stream Path</label>
                            <input
                              value={activeCam.streamPath ?? '/stream1'}
                              onChange={(e) => updateCamera(activeCam.id, { streamPath: e.target.value })}
                              className="w-full px-2.5 py-1.5 text-xs font-mono rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                          <div className="sm:col-span-4">
                            <label className="text-[10px] font-medium text-zinc-500 block mb-1">Camera Username</label>
                            <input
                              value={activeCam.username ?? ''}
                              onChange={(e) => updateCamera(activeCam.id, { username: e.target.value })}
                              placeholder="gmp_cctv_op"
                              className="w-full px-3 py-1.5 text-xs font-mono rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700"
                            />
                          </div>
                          <div className="sm:col-span-5">
                            <label className="text-[10px] font-medium text-zinc-500 block mb-1">
                              Camera Password (Hashed via Server Argon2id)
                            </label>
                            <input
                              type="password"
                              value={plainPassword}
                              onChange={(e) => setPlainPassword(e.target.value)}
                              placeholder={activeCam.passwordHash ? '•••••••• (Saved as Argon2id)' : 'Enter camera password'}
                              className="w-full px-3 py-1.5 text-xs font-mono rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <button
                              onClick={handleSaveArgon2Password}
                              disabled={hashingPwd || plainPassword.length < 4}
                              className="w-full h-[34px] flex items-center justify-center gap-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              {hashingPwd ? 'Hashing...' : 'Save Argon2'}
                            </button>
                          </div>
                        </div>

                        {activeCam.passwordHash && (
                          <div className="p-2.5 rounded-xl bg-zinc-900 text-emerald-400 font-mono text-[10px] break-all border border-emerald-500/30">
                            PHC Digest: {activeCam.passwordHash.slice(0, 62)}…
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <button
                            onClick={handleTestConnection}
                            disabled={testingConn}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                          >
                            {testingConn ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Wifi className="w-3.5 h-3.5" />
                            )}
                            Test IP Stream Connection
                          </button>

                          {connStatus && (
                            <span
                              className={`text-xs font-mono px-3 py-1.5 rounded-xl border ${
                                connStatus.ok
                                  ? 'bg-emerald-500/12 border-emerald-500/30 text-emerald-500'
                                  : 'bg-rose-500/12 border-rose-500/30 text-rose-500'
                              }`}
                            >
                              {connStatus.text}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500 space-y-3">
                <Camera className="w-10 h-10 opacity-40" />
                <div className="text-sm font-medium">No cameras configured yet</div>
                <button
                  onClick={handleAddCamera}
                  className="px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold"
                >
                  Create First IP Camera
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
