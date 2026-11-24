import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Box,
  Building2,
  Calendar,
  Camera,
  CornerDownLeft,
  Filter,
  FolderTree,
  Footprints,
  GitBranch,
  History,
  Layers,
  LayoutGrid,
  Link2,
  Map as MapIcon,
  Moon,
  QrCode,
  Radio,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Square,
  Tag,
  Thermometer,
  Wand2,
  Waypoints,
  Wrench,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useGmpStore } from '../store/useGmpStore';
import { OBJECT_LIBRARY } from '../data/objectLibrary';

interface SearchResultItem {
  id: string;
  kind: 'command' | 'sensor' | 'building' | 'floor' | 'department' | 'room' | 'asset' | 'layer' | 'camera' | 'flow';
  title: string;
  subtitle: string;
  code: string;
  onJump: () => void;
  onIsolateType?: () => void;
  onCopyUrl?: () => void;
}

export const GlobalQuickSearch: React.FC = () => {
  const showQuickSearch = useTwinStore((s) => s.showQuickSearch);
  const setShowQuickSearch = useTwinStore((s) => s.setShowQuickSearch);
  const screen = useTwinStore((s) => s.screen);
  const openCinnaGenDemo = useTwinStore((s) => s.openCinnaGenDemo);
  const scene = useTwinStore((s) => s.scene);
  const drillInto = useTwinStore((s) => s.drillInto);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const isolateSameTypeOrgWide = useTwinStore((s) => s.isolateSameTypeOrgWide);
  const isolateLayerDirect = useTwinStore((s) => s.isolateLayerDirect);
  const buildDirectUrl = useTwinStore((s) => s.buildDirectUrl);
  const setShowMayaChat = useTwinStore((s) => s.setShowMayaChat);
  const setShowAIPlannerModal = useTwinStore((s) => s.setShowAIPlannerModal);
  const setShowModelsGallery = useTwinStore((s) => s.setShowModelsGallery);
  const setShowCameraManager = useTwinStore((s) => s.setShowCameraManager);
  const openRackDesigner = useTwinStore((s) => s.openRackDesigner);
  const setShowAuditTrailModal = useTwinStore((s) => s.setShowAuditTrailModal);
  const setShowSaveValidationModal = useTwinStore((s) => s.setShowSaveValidationModal);
  const setFirstPersonMode = useTwinStore((s) => s.setFirstPersonMode);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const lightingMode = useTwinStore((s) => s.lightingMode);
  const setLightingMode = useTwinStore((s) => s.setLightingMode);
  const showToast = useTwinStore((s) => s.showToast);

  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const openDashboard = useTelemetryStore((s) => s.openDashboard);
  const setHeatmapMetric = useTelemetryStore((s) => s.setHeatmapMetric);

  const openGmpModal = useGmpStore((s) => s.openGmpModal);
  const openQrLabelModal = useGmpStore((s) => s.openQrLabelModal);
  const showMiniMap = useGmpStore((s) => s.showMiniMap);
  const setShowMiniMap = useGmpStore((s) => s.setShowMiniMap);

  const [query, setQuery] = useState('');
  const [filterKind, setFilterKind] = useState<'all' | 'command' | 'asset' | 'sensor' | 'room' | 'layer'>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (showQuickSearch) {
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    } else {
      setQuery('');
    }
  }, [showQuickSearch]);

  const ensureWorkspace = () => {
    if (screen === 'hub') openCinnaGenDemo();
  };

  const copyLink = (url: string, label: string) => {
    navigator.clipboard?.writeText(url).catch(() => {});
    window.history.replaceState(null, '', url);
    showToast(`Copied direct link to ${label}`, 'success');
  };

  const results = useMemo<SearchResultItem[]>(() => {
    const items: SearchResultItem[] = [
      {
        id: 'cmd-maya',
        kind: 'command',
        title: 'Ask Maya AI Map Designer',
        subtitle: 'Design or modify 2D/3D rooms, bioreactors, HPLCs & charts via chat',
        code: 'AI CHAT',
        onJump: () => {
          setShowQuickSearch(false);
          setShowMayaChat(true);
        },
      },
      {
        id: 'cmd-telemetry',
        kind: 'command',
        title: 'Open Live Telemetry & Sensor Console',
        subtitle: 'Inspect real-time Bioreactor & HPLC trends, 3D models & relationships',
        code: 'SCADA',
        onJump: () => {
          setShowQuickSearch(false);
          openDashboard({ tab: 'trends' });
        },
      },
      {
        id: 'cmd-heatmap-temp',
        kind: 'command',
        title: 'Toggle 3D Temperature Heatmap Overlay',
        subtitle: 'Project live thermal telemetry across 3D cleanrooms',
        code: 'HEATMAP',
        onJump: () => {
          ensureWorkspace();
          setHeatmapMetric('temperature');
          setShowQuickSearch(false);
        },
      },
      {
        id: 'cmd-planner',
        kind: 'command',
        title: 'Launch AI Floor Planner Playground',
        subtitle: 'Generate & optimize full GMP floor layouts with LLM',
        code: 'PLANNER',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          setShowAIPlannerModal(true);
        },
      },
      {
        id: 'cmd-gallery',
        kind: 'command',
        title: 'Open 3D Models Gallery',
        subtitle: `Browse ${OBJECT_LIBRARY.length + scene.customObjects.length} interactive PBR pharma, industrial & IT/data-center 3D assets`,
        code: '3D LIB',
        onJump: () => {
          setShowQuickSearch(false);
          setShowModelsGallery(true);
        },
      },
      {
        id: 'cmd-walkthrough',
        kind: 'command',
        title: 'Start First-Person Character Walkthrough',
        subtitle: 'WASD + Space jump with gloved hands holding a live area telemetry tablet',
        code: 'WALK',
        onJump: () => {
          ensureWorkspace();
          setViewMode('3d-perspective');
          setFirstPersonMode(true);
          setShowQuickSearch(false);
        },
      },
      {
        id: 'cmd-cameras',
        kind: 'command',
        title: 'Open Camera Command Panel & LiveCam',
        subtitle: 'Configure FOV, yaw/pitch, RTSP/IP credentials (Argon2id) & live feeds',
        code: 'CCTV',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          setShowCameraManager(true);
        },
      },
      {
        id: 'cmd-rack',
        kind: 'command',
        title: 'Open 42U IT / Network Rack Designer',
        subtitle: 'Design 42U server racks, switch ports, VLANs, patch cables & PDU load',
        code: '42U IT',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          openRackDesigner();
        },
      },
      {
        id: 'cmd-night',
        kind: 'command',
        title: lightingMode === 'night' ? 'Switch 3D Viewport to Studio Day Mode' : 'Switch 3D Viewport to Night Spotlights Mode',
        subtitle: 'Toggle minimal high-performance overhead spotlights & architectural lighting',
        code: lightingMode === 'night' ? 'DAY' : 'NIGHT',
        onJump: () => {
          ensureWorkspace();
          setLightingMode(lightingMode === 'night' ? 'day' : 'night');
          setShowQuickSearch(false);
        },
      },
      {
        id: 'cmd-save-validate',
        kind: 'command',
        title: 'Validate GMP Twin, Fix with AI & Save',
        subtitle: 'Run full cleanroom, egress, rack & camera validation gate before saving',
        code: 'CTRL+S',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          setShowSaveValidationModal(true);
        },
      },
      {
        id: 'cmd-audit',
        kind: 'command',
        title: 'Open 21 CFR Part 11 Audit Trail',
        subtitle: 'Inspect every position, setting, flow, camera & floor change with JSON diffs',
        code: 'AUDIT',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          setShowAuditTrailModal(true);
        },
      },
      {
        id: 'cmd-prod-lines',
        kind: 'command',
        title: 'Production Line Master Data & Eligibility Checker',
        subtitle: 'Build multi-room & equipment lines, verify Cal/Qual/PM dates & highlight Green/Red on 2D/3D',
        code: 'LINES',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          openGmpModal({ tab: 'lines' });
        },
      },
      {
        id: 'cmd-work-orders',
        kind: 'command',
        title: 'Work Order Task Inbox & Recurring Cron Scheduler',
        subtitle: 'Create WOs with certified eligible personnel, run Cron jobs & auto-roll compliance dates',
        code: 'WO/CRON',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          openGmpModal({ tab: 'workorders' });
        },
      },
      {
        id: 'cmd-gmp-calendar',
        kind: 'command',
        title: 'GMP Compliance & Maintenance Due Calendar',
        subtitle: 'Interactive monthly calendar filterable by Facility, Production Line, or Equipment',
        code: 'CAL',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          openGmpModal({ tab: 'calendar' });
        },
      },
      {
        id: 'cmd-sops-wiki',
        kind: 'command',
        title: 'SOP Repository, Records & Troubleshooting Wiki',
        subtitle: 'Browse & edit Markdown SOPs per equipment/action type and fault-tree troubleshooting guides',
        code: 'SOPS',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          openGmpModal({ tab: 'sops' });
        },
      },
      {
        id: 'cmd-qr-scanner',
        kind: 'command',
        title: 'QR / Barcode / DataMatrix Live Camera Scanner',
        subtitle: 'Scan physical equipment, room, or sensor tags to fly straight to 3D & matching SOPs',
        code: 'SCAN QR',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          openQrLabelModal('scanner');
        },
      },
      {
        id: 'cmd-label-designer',
        kind: 'command',
        title: 'Industrial Label Designer (Iron Room Signs, Plaques & Micro Tags)',
        subtitle: 'Multi-select equipment, rooms & sensors · custom logos, rounded borders, SVG & print sheets',
        code: 'LABELS',
        onJump: () => {
          ensureWorkspace();
          setShowQuickSearch(false);
          openQrLabelModal('designer');
        },
      },
      {
        id: 'cmd-minimap',
        kind: 'command',
        title: showMiniMap ? 'Hide Draggable Birds-Eye Mini-Map' : 'Show Draggable Birds-Eye Mini-Map',
        subtitle: 'Toggle the corner spatial overview widget for fast zoomed-in 2D/3D navigation',
        code: 'MINIMAP',
        onJump: () => {
          ensureWorkspace();
          setShowMiniMap(!showMiniMap);
          setShowQuickSearch(false);
        },
      },
    ];

    // Live Sensors (Bioreactors, HPLCs, Rooms)
    sensors.slice(0, 60).forEach((s) => {
      const snap = readings[s.id];
      const val = snap?.value ?? s.nominal;
      items.push({
        id: `sens-${s.id}`,
        kind: 'sensor',
        title: `${s.tag} · ${s.name}`,
        subtitle: `${s.targetName} · Live: ${val.toFixed(s.precision)} ${s.unit} · ${s.protocol}`,
        code: `${val.toFixed(s.precision)}${s.unit}`,
        onJump: () => {
          setShowQuickSearch(false);
          openDashboard({
            tab: 'trends',
            assetId: s.targetKind === 'asset' ? s.targetId : null,
            roomId: s.targetKind === 'room' ? s.targetId : null,
            sensorId: s.id,
          });
        },
      });
    });

    scene.assets.forEach((a) => {
      const fl = scene.floors.find((f) => f.id === a.floorId);
      const rm = scene.rooms.find((r) => r.id === a.roomId);
      items.push({
        id: `ast-${a.id}`,
        kind: 'asset',
        title: a.name,
        subtitle: `${fl?.code ?? ''}${rm ? ` / ${rm.name}` : ''} · ${a.manufacturer} ${a.model} · ${a.connectivity.plcTag}`,
        code: a.assetId,
        onJump: () => {
          ensureWorkspace();
          drillInto('asset', a.id);
          setShowQuickSearch(false);
        },
        onIsolateType: () => {
          ensureWorkspace();
          isolateSameTypeOrgWide(a.id);
          setShowQuickSearch(false);
        },
        onCopyUrl: () =>
          copyLink(
            buildDirectUrl({ floorId: a.floorId, assetId: a.id, drillLevel: 'asset' }),
            a.name
          ),
      });
    });

    scene.rooms.forEach((r) => {
      const fl = scene.floors.find((f) => f.id === r.floorId);
      items.push({
        id: `rm-${r.id}`,
        kind: 'room',
        title: r.name,
        subtitle: `${fl?.code ?? ''} · ${r.environmental.cleanroomGrade} · ${r.width}×${r.depth}m`,
        code: r.code,
        onJump: () => {
          ensureWorkspace();
          drillInto('room', r.id);
          setShowQuickSearch(false);
        },
        onCopyUrl: () =>
          copyLink(
            buildDirectUrl({ floorId: r.floorId, roomId: r.id, drillLevel: 'room' }),
            r.name
          ),
      });
    });

    scene.buildings.forEach((b) => {
      items.push({
        id: `b-${b.id}`,
        kind: 'building',
        title: b.name,
        subtitle: `Building · ${scene.floors.filter((f) => f.buildingId === b.id).length} floors`,
        code: b.code,
        onJump: () => {
          ensureWorkspace();
          drillInto('building', b.id);
          setShowQuickSearch(false);
        },
        onCopyUrl: () =>
          copyLink(buildDirectUrl({ buildingId: b.id, drillLevel: 'building' }), b.name),
      });
    });

    scene.floors.forEach((fl) => {
      const b = scene.buildings.find((x) => x.id === fl.buildingId);
      items.push({
        id: `fl-${fl.id}`,
        kind: 'floor',
        title: fl.name,
        subtitle: `${b?.name ?? 'Building'} · Elev ${fl.elevation.toFixed(1)}m`,
        code: fl.code,
        onJump: () => {
          ensureWorkspace();
          drillInto('floor', fl.id);
          setShowQuickSearch(false);
        },
        onCopyUrl: () =>
          copyLink(
            buildDirectUrl({ buildingId: fl.buildingId, floorId: fl.id, drillLevel: 'floor' }),
            fl.name
          ),
      });
    });

    scene.hierarchy
      .filter((h) => h.level === 'department')
      .forEach((dept) => {
        const count = scene.rooms.filter((r) => r.departmentId === dept.id).length;
        items.push({
          id: `dept-${dept.id}`,
          kind: 'department',
          title: dept.name,
          subtitle: `Department · ${count} spaces`,
          code: dept.metadata?.code || dept.id,
          onJump: () => {
            ensureWorkspace();
            drillInto('department', dept.id);
            setShowQuickSearch(false);
          },
          onCopyUrl: () => copyLink(buildDirectUrl({ drillLevel: 'department' }), dept.name),
        });
      });

    scene.layers.forEach((l) => {
      items.push({
        id: `lyr-${l.id}`,
        kind: 'layer',
        title: l.name,
        subtitle: `Layer · ${l.group} · ${l.visible ? 'Visible' : 'Hidden'}`,
        code: l.id.replace('layer-', '').toUpperCase(),
        onJump: () => {
          ensureWorkspace();
          isolateLayerDirect(l.id);
          setShowQuickSearch(false);
        },
        onCopyUrl: () => copyLink(buildDirectUrl({ layerId: l.id }), `Layer: ${l.name}`),
      });
    });

    scene.cameras.forEach((c) => {
      items.push({
        id: `cam-${c.id}`,
        kind: 'camera',
        title: c.name,
        subtitle: `Camera Viewpoint · FOV ${c.fov}°`,
        code: 'CAM',
        onJump: () => {
          ensureWorkspace();
          focusEntity({ type: 'camera', id: c.id });
          setShowQuickSearch(false);
        },
        onCopyUrl: () => copyLink(buildDirectUrl({ floorId: c.floorId }), c.name),
      });
    });

    scene.flows.forEach((f) => {
      items.push({
        id: `flw-${f.id}`,
        kind: 'flow',
        title: f.name,
        subtitle: `${f.flowType} flow · ${f.cleanlinessClass}`,
        code: 'FLOW',
        onJump: () => {
          ensureWorkspace();
          drillInto('floor', f.floorId);
          setShowQuickSearch(false);
        },
        onCopyUrl: () => copyLink(buildDirectUrl({ floorId: f.floorId, layerId: 'layer-flows' }), f.name),
      });
    });

    const q = query.trim().toLowerCase();
    return items
      .filter((item) => {
        if (filterKind === 'command' && item.kind !== 'command') return false;
        if (filterKind === 'asset' && item.kind !== 'asset') return false;
        if (filterKind === 'sensor' && item.kind !== 'sensor') return false;
        if (filterKind === 'room' && item.kind !== 'room') return false;
        if (filterKind === 'layer' && item.kind !== 'layer') return false;
        if (!q) return true;
        return (
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q)
        );
      })
      .slice(0, 42);
  }, [scene, sensors, readings, query, filterKind, screen, lightingMode, showMiniMap]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, filterKind]);

  useEffect(() => {
    if (!showQuickSearch) return;
    itemRefs.current.get(activeIndex)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex, showQuickSearch]);

  if (!showQuickSearch) return null;

  const FILTER_ORDER = ['all', 'command', 'asset', 'sensor', 'room', 'layer'] as const;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setShowQuickSearch(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && (query === '' || e.altKey)) {
      e.preventDefault();
      const idx = FILTER_ORDER.indexOf(filterKind);
      const next =
        e.key === 'ArrowRight'
          ? (idx + 1) % FILTER_ORDER.length
          : (idx - 1 + FILTER_ORDER.length) % FILTER_ORDER.length;
      setFilterKind(FILTER_ORDER[next]);
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      results[activeIndex].onJump();
    }
  };

  const iconFor = (item: SearchResultItem) => {
    if (item.id === 'cmd-maya') return <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />;
    if (item.id === 'cmd-telemetry') return <Activity className="w-4 h-4 text-amber-400 shrink-0" />;
    if (item.id === 'cmd-heatmap-temp') return <Thermometer className="w-4 h-4 text-amber-400 shrink-0" />;
    if (item.id === 'cmd-planner') return <Wand2 className="w-4 h-4 text-violet-400 shrink-0" />;
    if (item.id === 'cmd-gallery') return <LayoutGrid className="w-4 h-4 text-violet-400 shrink-0" />;
    if (item.id === 'cmd-walkthrough') return <Footprints className="w-4 h-4 text-emerald-400 shrink-0" />;
    if (item.id === 'cmd-cameras') return <Camera className="w-4 h-4 text-violet-400 shrink-0" />;
    if (item.id === 'cmd-rack') return <Server className="w-4 h-4 text-cyan-400 shrink-0" />;
    if (item.id === 'cmd-night') return <Moon className="w-4 h-4 text-amber-400 shrink-0" />;
    if (item.id === 'cmd-save-validate') return <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />;
    if (item.id === 'cmd-audit') return <History className="w-4 h-4 text-amber-400 shrink-0" />;
    if (item.id === 'cmd-prod-lines') return <GitBranch className="w-4 h-4 text-emerald-400 shrink-0" />;
    if (item.id === 'cmd-work-orders') return <Wrench className="w-4 h-4 text-violet-400 shrink-0" />;
    if (item.id === 'cmd-gmp-calendar') return <Calendar className="w-4 h-4 text-amber-400 shrink-0" />;
    if (item.id === 'cmd-sops-wiki') return <BookOpen className="w-4 h-4 text-cyan-400 shrink-0" />;
    if (item.id === 'cmd-qr-scanner') return <QrCode className="w-4 h-4 text-violet-400 shrink-0" />;
    if (item.id === 'cmd-label-designer') return <Tag className="w-4 h-4 text-amber-400 shrink-0" />;
    if (item.id === 'cmd-minimap') return <MapIcon className="w-4 h-4 text-emerald-400 shrink-0" />;
    switch (item.kind) {
      case 'sensor':
        return <Radio className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case 'building':
      case 'floor':
        return <Building2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />;
      case 'department':
        return <FolderTree className="w-3.5 h-3.5 text-violet-400 shrink-0" />;
      case 'room':
        return <Square className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
      case 'asset':
        return <Box className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'layer':
        return <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case 'camera':
        return <Camera className="w-3.5 h-3.5 text-violet-300 shrink-0" />;
      case 'flow':
        return <Waypoints className="w-3.5 h-3.5 text-amber-300 shrink-0" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-start justify-center pt-[9vh] p-4"
      onClick={() => setShowQuickSearch(false)}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-[#13131A] border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[78vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Modern Command Palette Search Header */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3 bg-zinc-50 dark:bg-[#171720]">
          <div className="w-8 h-8 rounded-xl gradian-violet-amber text-white flex items-center justify-center shrink-0">
            <Search className="w-4 h-4" />
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, bioreactor, HPLC, sensor tag, room, or layer..."
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none"
          />
          <kbd className="hidden sm:inline px-2 py-1 text-[10px] font-mono rounded-lg bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700 text-zinc-400">
            ESC
          </kbd>
          <button
            onClick={() => setShowQuickSearch(false)}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modern Rounded Filter Pills */}
        <div className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-1.5 bg-white dark:bg-[#101016] overflow-x-auto">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'command', label: 'Quick Actions' },
              { id: 'asset', label: 'Equipment' },
              { id: 'sensor', label: 'Live Sensors' },
              { id: 'room', label: 'Rooms & Areas' },
              { id: 'layer', label: 'Layers' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterKind(f.id)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                filterKind === f.id
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#1A1A24] hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {results.length === 0 ? (
            <div className="p-10 text-center text-xs text-zinc-500">
              No matching commands, equipment, sensors, or areas found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            results.map((item, idx) => {
              const isSelected = idx === activeIndex;
              return (
                <div
                  key={item.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(idx, el);
                    else itemRefs.current.delete(idx);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`px-3.5 py-2.5 rounded-2xl flex items-center justify-between gap-3 transition-colors ${
                    isSelected
                      ? 'bg-violet-500/12 border border-violet-500/40'
                      : 'border border-transparent hover:bg-zinc-100 dark:hover:bg-[#1A1A24]'
                  }`}
                >
                  <button
                    onClick={item.onJump}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-[#1C1C26] flex items-center justify-center shrink-0">
                      {iconFor(item)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-900 dark:text-white truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-[#1C1C26] font-mono text-[10px] text-amber-600 dark:text-amber-400 hidden sm:inline">
                      {item.code}
                    </span>
                    {item.onIsolateType && (
                      <button
                        onClick={item.onIsolateType}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-xl border border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300 hover:bg-violet-600 hover:text-white text-[10px] font-semibold transition-colors whitespace-nowrap"
                        title="Isolate all equipment of this exact type across the entire organization"
                      >
                        <Filter className="w-3 h-3" />
                        Isolate
                      </button>
                    )}
                    {item.onCopyUrl && (
                      <button
                        onClick={item.onCopyUrl}
                        className="p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-violet-500 hover:border-violet-500"
                        title="Copy Direct URL"
                      >
                        <Link2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Hints */}
        <div className="px-5 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#101016] flex items-center justify-between text-[10.5px] text-zinc-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <CornerDownLeft className="w-3 h-3 text-violet-500" /> Enter to open
            </span>
            <span>↑ ↓ navigate · ← → switch filter</span>
          </div>
          <span className="font-mono text-zinc-400">{results.length} results</span>
        </div>
      </div>
    </div>
  );
};
