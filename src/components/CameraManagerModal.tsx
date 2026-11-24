import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Compass,
  Crosshair,
  Eye,
  KeyRound,
  Lock,
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
import { fetchApiJson } from '../utils/safeJson';
import type { CameraKind, CameraStreamProtocol, SceneCamera } from '../types/twin';

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

const LiveCctvCanvas: React.FC<{
  camera: SceneCamera;
  floorName: string;
  nightVision: boolean;
  ptzZoom: number;
  ptzPan: number;
}> = ({ camera, floorName, nightVision, ptzZoom, ptzPan }) => {
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

      // Industrial surveillance background
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      if (nightVision) {
        grad.addColorStop(0, '#04120c');
        grad.addColorStop(0.55, '#092418');
        grad.addColorStop(1, '#04140d');
      } else {
        grad.addColorStop(0, '#10121a');
        grad.addColorStop(0.55, '#191d29');
        grad.addColorStop(1, '#0e1017');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(w / 2 + ptzPan * 20, h / 2);
      ctx.scale(ptzZoom, ptzZoom);
      ctx.translate(-w / 2, -h / 2);

      // Perspective cleanroom corridor grid lines
      const horizonY = h * 0.42;
      const vanishX = w * 0.5 + Math.sin(sec * 0.25) * 14;
      ctx.strokeStyle = nightVision ? 'rgba(52,211,153,0.18)' : 'rgba(139,92,246,0.22)';
      ctx.lineWidth = 1;
      for (let i = -6; i <= 6; i++) {
        ctx.beginPath();
        ctx.moveTo(vanishX + i * 22, horizonY);
        ctx.lineTo(vanishX + i * 115, h);
        ctx.stroke();
      }
      for (let r = 1; r <= 6; r++) {
        const yy = horizonY + Math.pow(r / 6, 1.8) * (h - horizonY);
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
      }

      // Stylized silhouettes of cleanroom vessels / racks
      const baseColor = nightVision ? 'rgba(16,185,129,0.26)' : 'rgba(148,163,184,0.22)';
      const strokeColor = nightVision ? 'rgba(110,231,183,0.55)' : 'rgba(196,181,253,0.5)';
      const tanks = [
        { x: w * 0.22, y: h * 0.36, rw: 56, rh: 108, label: 'BR-2001' },
        { x: w * 0.44, y: h * 0.34, rw: 62, rh: 118, label: 'BR-2002' },
        { x: w * 0.72, y: h * 0.4, rw: 82, rh: 92, label: 'SKID-301' },
      ];
      tanks.forEach((tk, idx) => {
        ctx.fillStyle = baseColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(tk.x, tk.y, tk.rw, tk.rh, 10);
        ctx.fill();
        ctx.stroke();

        // Blinking telemetry LED
        const ledOn = Math.sin(sec * 3 + idx * 1.4) > -0.2;
        ctx.fillStyle = ledOn ? (nightVision ? '#34D399' : '#22C55E') : '#334155';
        ctx.beginPath();
        ctx.arc(tk.x + tk.rw - 12, tk.y + 14, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = nightVision ? '#A7F3D0' : '#E2E8F0';
        ctx.font = '600 10px monospace';
        ctx.fillText(tk.label, tk.x + 8, tk.y + tk.rh - 10);
      });

      // Moving AI motion detection bounding box (simulated operator / AGV)
      const mx = w * 0.3 + ((sec * 24) % (w * 0.42));
      const my = h * 0.54;
      ctx.strokeStyle = nightVision ? '#34D399' : '#F59E0B';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(mx, my, 46, 78);
      ctx.fillStyle = nightVision ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.18)';
      ctx.fillRect(mx, my - 15, 72, 15);
      ctx.fillStyle = nightVision ? '#A7F3D0' : '#FDE68A';
      ctx.font = '700 9px monospace';
      ctx.fillText('GMP-OP 98%', mx + 3, my - 4);

      ctx.restore();

      // Subtle scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1);
      }

      // Crosshair reticle
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 14, h / 2);
      ctx.lineTo(w / 2 + 14, h / 2);
      ctx.moveTo(w / 2, h / 2 - 14);
      ctx.lineTo(w / 2, h / 2 + 14);
      ctx.stroke();

      // OSD Stamp
      ctx.fillStyle = 'rgba(9,9,11,0.72)';
      ctx.fillRect(10, 10, 260, 22);
      ctx.fillStyle = '#EF4444';
      if (Math.floor(sec * 2) % 2 === 0) {
        ctx.beginPath();
        ctx.arc(21, 21, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#F4F4F5';
      ctx.font = '700 10.5px monospace';
      ctx.fillText(
        `REC · ${camera.name.slice(0, 22).toUpperCase()}`,
        32,
        24.5
      );

      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      ctx.fillStyle = 'rgba(9,9,11,0.72)';
      ctx.fillRect(w - 196, 10, 186, 22);
      ctx.fillStyle = nightVision ? '#6EE7B7' : '#C4B5FD';
      ctx.font = '600 10.5px monospace';
      ctx.fillText(nowStr, w - 188, 24.5);

      ctx.fillStyle = 'rgba(9,9,11,0.72)';
      ctx.fillRect(10, h - 30, w - 20, 20);
      ctx.fillStyle = '#A1A1AA';
      ctx.font = '500 10px monospace';
      const streamInfo = camera.ipAddress
        ? `${camera.protocol ?? 'RTSP'}://${camera.ipAddress}:${camera.port ?? 554}${camera.streamPath ?? '/stream1'}`
        : `LOCAL-TWIN-CAM · ${floorName}`;
      ctx.fillText(
        `${streamInfo}   |   FOV ${camera.fov}°   |   ${camera.resolution ?? '2560×1440'} @ ${camera.fps ?? 30}fps   |   ZOOM ${ptzZoom.toFixed(1)}×`,
        16,
        h - 16.5
      );

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [camera, floorName, nightVision, ptzZoom, ptzPan]);

  // If user configured an http/https MJPEG or image stream, render an overlay fallback
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
      return (
        c.name.toLowerCase().includes(q) ||
        c.kind.toLowerCase().includes(q) ||
        (c.ipAddress ?? '').toLowerCase().includes(q) ||
        (fl?.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [scene.cameras, scene.floors, search]);

  useEffect(() => {
    if (!showCameraManager) return;
    if (activeLiveCameraId && scene.cameras.some((c) => c.id === activeLiveCameraId)) {
      setSelectedId(activeLiveCameraId);
      setViewTab('live');
    } else if (!selectedId || !scene.cameras.some((c) => c.id === selectedId)) {
      setSelectedId(scene.cameras[0]?.id ?? '');
    }
  }, [showCameraManager, activeLiveCameraId, scene.cameras, selectedId]);

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
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = filteredCameras[(idx + 1) % filteredCameras.length];
        setSelectedId(next.id);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = filteredCameras[(idx - 1 + filteredCameras.length) % filteredCameras.length];
        setSelectedId(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCameraManager, filteredCameras, selectedId, setShowCameraManager, openLiveCamera]);

  if (!showCameraManager) return null;

  const activeCam = scene.cameras.find((c) => c.id === selectedId) ?? filteredCameras[0] ?? null;
  const activeFloor = activeCam ? scene.floors.find((f) => f.id === activeCam.floorId) : null;
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

  const handleAddCamera = () => {
    const fl = scene.floors.find((f) => f.id === activeFloorId) ?? scene.floors[0];
    const cx = fl ? Number((fl.width * 0.25).toFixed(1)) : 6;
    const cz = fl ? Number((fl.depth * 0.25).toFixed(1)) : 6;
    const created = addCamera({
      floorId: fl?.id ?? activeFloorId,
      name: `CCTV Security Cam ${scene.cameras.length + 1}`,
      kind: 'security',
      group: 'IP Surveillance',
      position: [cx, 3.2, cz],
      target: [cx + 6, 1.4, cz + 5],
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
    setSelectedId(created.id);
    setViewTab('config');
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
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-6xl h-[88vh] bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
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
            <button
              onClick={handleAddCamera}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Camera
            </button>
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

            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              {filteredCameras.map((cam) => {
                const fl = scene.floors.find((f) => f.id === cam.floorId);
                const isSel = cam.id === activeCam?.id;
                return (
                  <div
                    key={cam.id}
                    onClick={() => {
                      setSelectedId(cam.id);
                      setConnStatus(null);
                    }}
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
                                ? 'bg-rose-500 animate-pulse'
                                : cam.status === 'offline'
                                  ? 'bg-zinc-500'
                                  : 'bg-emerald-500'
                            }`}
                          />
                          {cam.name}
                        </div>
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5 font-mono">
                          {fl?.code ?? cam.floorId} · FOV {cam.fov}° · {cam.ipAddress ?? '3D Viewpoint'}
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
                          setSelectedId(cam.id);
                          setViewTab('live');
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

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleGoTo3D(activeCam)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Jump to 3D Camera
                    </button>
                    <button
                      onClick={() => {
                        deleteCamera(activeCam.id);
                        setSelectedId('');
                      }}
                      className="p-1.5 rounded-xl border border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
                      title="Delete Camera"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  {viewTab === 'live' ? (
                    <div className="space-y-4">
                      <LiveCctvCanvas
                        camera={activeCam}
                        floorName={activeFloor?.name ?? activeCam.floorId}
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
                              value={activeCam.name}
                              onChange={(e) => updateCamera(activeCam.id, { name: e.target.value })}
                              className="w-full px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-zinc-500 block mb-1">Type</label>
                            <select
                              value={activeCam.kind}
                              onChange={(e) => updateCamera(activeCam.id, { kind: e.target.value as CameraKind })}
                              className="w-full px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700"
                            >
                              <option value="security">Security IP CCTV</option>
                              <option value="fixed-industrial">Fixed Industrial</option>
                              <option value="inspection">GMP Inspection</option>
                              <option value="perspective">3D Perspective</option>
                              <option value="first-person">First-Person</option>
                            </select>
                          </div>
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
