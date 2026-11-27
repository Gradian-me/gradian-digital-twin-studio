import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Building2,
  CalendarClock,
  CheckCircle2,
  Cloud,
  Compass,
  ExternalLink,
  FileText,
  FileUp,
  Flame,
  FolderOpen,
  Layers,
  LayoutGrid,
  Moon,
  Plus,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  Upload,
  Wand2,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useGmpStore } from '../store/useGmpStore';
import { getRpnPriority, useRiskIncidentStore } from '../store/useRiskIncidentStore';
import { navigateToRiskTarget } from './RiskFmeaCenter';
import { useAuth } from '../context/AuthContext';
import { MiniSparkline } from './TelemetryDashboard';
import { UserAvatarMenu } from './UserAvatarMenu';
import { METRIC_PRESETS, type SensorDefinition } from '../types/telemetry';
import type { DigitalTwinScene } from '../types/twin';
import {
  normalizeVectorsToPlan,
  parseAsciiDxf,
  parseSvgPlan,
} from '../utils/cadPlanParser';

const HERO_IMG = '/src/assets/images/cinnagen_campus_aerial_1795410615873.jpg';
const CLEANROOM_IMG = '/src/assets/images/aseptic_cleanroom_suite_1795410616007.jpg';
const QCLAB_IMG = '/src/assets/images/qc_biotech_laboratory_1795410617054.jpg';

interface CloudProjectSummary {
  id: string;
  name: string;
  code: string;
  description: string;
  industry: string;
  unitSystem: string;
  revision: number;
  updatedAt: string;
}

/**
 * Semicircular SVG Risk & GMP Compliance Gauge (Charcoal + Violet + Amber)
 */
const ComplianceRadialGauge: React.FC<{ score: number; alarms: number; warnings: number }> = ({
  score,
  alarms,
  warnings,
}) => {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const r = 68;
  const cx = 90;
  const cy = 84;
  const circumference = Math.PI * r;
  const dashOffset = circumference * (1 - clamped / 100);
  const statusLabel = alarms > 0 ? 'Attention Required' : warnings > 0 ? 'Minor Drift' : 'GMP Nominal';
  const statusColor = alarms > 0 ? 'text-rose-400' : warnings > 0 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg viewBox="0 0 180 104" className="w-48 h-28 overflow-visible">
        <defs>
          <linearGradient id="hubGaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="65%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
        </defs>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="currentColor"
          className="text-zinc-200 dark:text-zinc-800"
          strokeWidth={12}
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="url(#hubGaugeGrad)"
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="-mt-11 text-center">
        <div className="font-mono tabular-nums text-3xl font-bold text-zinc-900 dark:text-white leading-none">
          {clamped}%
        </div>
        <div className={`text-[11px] font-semibold mt-1 ${statusColor}`}>{statusLabel}</div>
      </div>
    </div>
  );
};

export const ProjectHub: React.FC = () => {
  const scene = useTwinStore((s) => s.scene);
  const validationIssues = useTwinStore((s) => s.validationIssues);
  const theme = useTwinStore((s) => s.theme);
  const toggleTheme = useTwinStore((s) => s.toggleTheme);
  const savedProjects = useTwinStore((s) => s.savedProjects);
  const openProject = useTwinStore((s) => s.openProject);
  const openCinnaGenDemo = useTwinStore((s) => s.openCinnaGenDemo);
  const createNewProject = useTwinStore((s) => s.createNewProject);
  const deleteSavedProject = useTwinStore((s) => s.deleteSavedProject);
  const importProjectJSON = useTwinStore((s) => s.importProjectJSON);
  const addReferencePlan = useTwinStore((s) => s.addReferencePlan);
  const importCadOcrPlan = useTwinStore((s) => s.importCadOcrPlan);
  const openCadOcrForReference = useTwinStore((s) => s.openCadOcrForReference);
  const setShowCadOcrModal = useTwinStore((s) => s.setShowCadOcrModal);
  const setLeftTab = useTwinStore((s) => s.setLeftTab);
  const setRightTab = useTwinStore((s) => s.setRightTab);
  const setRightPanelOpen = useTwinStore((s) => s.setRightPanelOpen);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const setShowOnboarding = useTwinStore((s) => s.setShowOnboarding);
  const setShowAIPlannerModal = useTwinStore((s) => s.setShowAIPlannerModal);
  const setShowModelsGallery = useTwinStore((s) => s.setShowModelsGallery);
  const setShowQuickSearch = useTwinStore((s) => s.setShowQuickSearch);
  const setShowMayaChat = useTwinStore((s) => s.setShowMayaChat);
  const setScreen = useTwinStore((s) => s.setScreen);
  const openDataCenterPage = useTwinStore((s) => s.openDataCenterPage);
  const drillInto = useTwinStore((s) => s.drillInto);
  const showToast = useTwinStore((s) => s.showToast);

  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const streamRunning = useTelemetryStore((s) => s.streamRunning);
  const openDashboard = useTelemetryStore((s) => s.openDashboard);
  const buildTelemetryTabUrl = useTelemetryStore((s) => s.buildTelemetryTabUrl);
  const openResourceSchedulingModal = useGmpStore((s) => s.openResourceSchedulingModal);

  const riskIncidents = useRiskIncidentStore((s) => s.incidents);
  const autoLogEnabled = useRiskIncidentStore((s) => s.autoLogEnabled);
  const setAutoLogEnabled = useRiskIncidentStore((s) => s.setAutoLogEnabled);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);
  const openAssetPdfModal = useRiskIncidentStore((s) => s.openAssetPdfModal);

  const { user, signInWithGoogle, signOut, getIdToken, error: authError } = useAuth();
  const [cloudProjects, setCloudProjects] = useState<CloudProjectSummary[]>([]);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [activeSection, setActiveSection] = useState<'overview' | 'projects' | 'templates'>('overview');
  const [riskFilter, setRiskFilter] = useState<'all' | 'alarm' | 'drift' | 'critical-fmea' | 'auto'>('all');
  const [trendChannelIdx, setTrendChannelIdx] = useState(0);
  const [newName, setNewName] = useState('');
  const [showBlankForm, setShowBlankForm] = useState(false);

  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const planInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user) {
      setCloudProjects([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingCloud(true);
      try {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch('/api/projects', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.projects)) {
          setCloudProjects(data.projects);
        }
      } catch {
        // non-blocking fallback to local workspace
      } finally {
        if (!cancelled) setLoadingCloud(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getIdToken]);

  // Live Executive Intelligence Metrics (computed from real scene + live telemetry store)
  const overviewMetrics = useMemo(() => {
    const roomTemp = sensors.filter((s) => s.targetKind === 'room' && s.metric === 'temperature');
    const roomRh = sensors.filter((s) => s.targetKind === 'room' && s.metric === 'humidity');
    const roomDp = sensors.filter((s) => s.targetKind === 'room' && s.metric === 'pressure');
    const avg = (list: SensorDefinition[]) => {
      if (!list.length) return 0;
      return list.reduce((acc, s) => acc + (readings[s.id]?.value ?? s.nominal), 0) / list.length;
    };

    const alarmSensors: SensorDefinition[] = [];
    const warnSensors: SensorDefinition[] = [];
    sensors.forEach((s) => {
      const st = readings[s.id]?.status ?? 'nominal';
      if (st === 'alarm') alarmSensors.push(s);
      else if (st === 'warning') warnSensors.push(s);
    });

    const criticalValidation = validationIssues.filter((v) => v.severity === 'error').length;
    const warnValidation = validationIssues.filter((v) => v.severity === 'warning').length;

    const openAlarmsCount =
      alarmSensors.length +
      riskIncidents.filter((i) => i.kind === 'alarm' && (i.status === 'open' || i.status === 'investigating')).length;
    const openDriftsCount =
      warnSensors.length +
      riskIncidents.filter((i) => i.kind === 'drift' && (i.status === 'open' || i.status === 'investigating')).length;
    const criticalFmeaCount = riskIncidents.filter(
      (i) => i.rpn >= 200 && (i.status === 'open' || i.status === 'investigating')
    ).length;

    const penalty =
      openAlarmsCount * 8 +
      openDriftsCount * 3 +
      criticalFmeaCount * 4 +
      criticalValidation * 5 +
      warnValidation * 2;
    const complianceScore = Math.max(46, Math.min(100, 100 - penalty));

    // Featured key equipment sensors (Bioreactors + HPLC + Cleanroom)
    const keyEquipmentSensors: SensorDefinition[] = [];
    const bio = sensors.find((s) => s.isMainSensor && s.targetName.toLowerCase().includes('bioreactor'));
    const hplc = sensors.find((s) => s.isMainSensor && s.targetName.toLowerCase().includes('hplc'));
    const filling = sensors.find((s) => s.isMainSensor && (s.targetName.toLowerCase().includes('filling') || s.targetName.toLowerCase().includes('autoclave')));
    const cleanroomDp = roomDp[0];
    [bio, hplc, filling, cleanroomDp].forEach((item) => {
      if (item && !keyEquipmentSensors.some((x) => x.id === item.id)) keyEquipmentSensors.push(item);
    });
    if (keyEquipmentSensors.length < 3) {
      sensors.slice(0, 4).forEach((s) => {
        if (!keyEquipmentSensors.some((x) => x.id === s.id)) keyEquipmentSensors.push(s);
      });
    }

    return {
      avgTemp: avg(roomTemp),
      avgRh: avg(roomRh),
      avgDp: avg(roomDp),
      alarmSensors,
      warnSensors,
      openAlarmsCount,
      openDriftsCount,
      criticalFmeaCount,
      criticalValidation,
      warnValidation,
      complianceScore,
      keyEquipmentSensors,
    };
  }, [sensors, readings, validationIssues, riskIncidents]);

  const filteredRiskIncidents = useMemo(() => {
    return riskIncidents
      .filter((inc) => {
        if (riskFilter === 'alarm') return inc.kind === 'alarm';
        if (riskFilter === 'drift') return inc.kind === 'drift';
        if (riskFilter === 'critical-fmea') return inc.rpn >= 200;
        if (riskFilter === 'auto') return inc.source === 'auto-telemetry';
        return true;
      })
      .sort((a, b) => {
        const openA = a.status === 'open' || a.status === 'investigating' ? 1 : 0;
        const openB = b.status === 'open' || b.status === 'investigating' ? 1 : 0;
        if (openA !== openB) return openB - openA;
        return b.rpn - a.rpn;
      });
  }, [riskIncidents, riskFilter]);

  const featuredTrendSensor =
    overviewMetrics.keyEquipmentSensors[trendChannelIdx % Math.max(1, overviewMetrics.keyEquipmentSensors.length)] ??
    sensors[0] ??
    null;

  const featuredTrendHistory = featuredTrendSensor ? readings[featuredTrendSensor.id]?.history ?? [] : [];

  const handleOpenCloudProject = async (id: string) => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Unable to load project');
      const data = await res.json();
      if (data.project?.sceneData) {
        openProject(data.project.sceneData as DigitalTwinScene);
        showToast(`Opened "${data.project.name}"`, 'success');
      }
    } catch {
      showToast('Unable to load saved project right now.', 'error');
    }
  };

  const handleDeleteCloudProject = async (id: string) => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setCloudProjects((prev) => prev.filter((p) => p.id !== id));
        showToast('Project removed from cloud workspace', 'info');
      }
    } catch {
      showToast('Could not delete project', 'error');
    }
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed.floors || !parsed.buildings) {
          throw new Error('Missing spatial structure');
        }
        importProjectJSON(parsed as DigitalTwinScene);
      } catch {
        showToast('Invalid Digital Twin JSON file.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportFloorPlan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const baseName = file.name.replace(/\.[^.]+$/, '');

    // 1. SVG vector floorplan → preserve aspect ratio, overlay reference, AND build real 3D walls immediately
    if (ext === 'svg' || file.type === 'image/svg+xml') {
      try {
        const svgText = await file.text();
        const parsed = parseSvgPlan(svgText);
        const vb = parsed.viewBox;
        const aspect = vb && vb.height > 0 ? vb.width / vb.height : 1.5;
        const planW = aspect >= 1 ? 28 : Math.max(12, Number((28 * aspect).toFixed(1)));
        const planD = aspect >= 1 ? Math.max(12, Number((28 / aspect).toFixed(1))) : 28;
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

        createNewProject('blank', baseName);
        const flId = useTwinStore.getState().activeFloorId;
        const ref = addReferencePlan({
          floorId: flId,
          name: file.name,
          layerCategory: 'reference-plan',
          dataUrl,
          fileType: 'image/svg+xml',
          x: 1,
          z: 1,
          elevation: 0,
          width: planW,
          depth: planD,
          rotationDeg: 0,
          opacity: 0.38,
          visible: true,
          locked: false,
          calibrated: true,
          layerId: 'layer-references',
        });

        const extracted = normalizeVectorsToPlan(parsed.segments, parsed.labels, planW, planD, {
          viewBox: vb,
          alignBox: { x: 1, z: 1, width: planW, depth: planD },
        });

        if (extracted.walls.length > 0) {
          importCadOcrPlan(
            {
              sourceName: file.name,
              replaceExisting: true,
              footprintWidthM: Math.ceil(planW + 2),
              footprintDepthM: Math.ceil(planD + 2),
              wallHeightM: 3.6,
              walls: extracted.walls,
              rooms: extracted.rooms,
              openings: extracted.openings,
            },
            { switchToViewMode: '3d-perspective' }
          );
          showToast(
            `Built ${extracted.walls.length} 3D walls, ${extracted.rooms.length} zones & ${extracted.openings.length} doors directly from "${file.name}".`,
            'success'
          );
        } else {
          setViewMode('2d');
          setLeftTab('references');
          openCadOcrForReference(ref.id);
          showToast(
            'SVG contains raster/non-vector paths — opened AI Vision OCR to convert into 3D walls.',
            'info'
          );
        }
      } catch {
        showToast('Could not parse SVG file.', 'error');
      }
      return;
    }

    // 2. CAD DXF / DWG → extract ASCII DXF geometry directly into 3D walls, or open OCR modal for binary DWG
    if (ext === 'dxf' || ext === 'dwg') {
      try {
        const buf = await file.arrayBuffer();
        const head = new TextDecoder('ascii').decode(buf.slice(0, 12));
        const isBinaryDwg = /^AC10\d\d/.test(head);
        createNewProject('blank', baseName);

        if (isBinaryDwg) {
          setShowCadOcrModal(true);
          showToast(
            `Detected binary AutoCAD DWG (${head.slice(0, 6)}). Export as ASCII .DXF or .SVG/.PNG and run CAD OCR to build 3D walls.`,
            'warning'
          );
          return;
        }

        const dxfText = new TextDecoder('utf-8').decode(buf);
        const parsed = parseAsciiDxf(dxfText);
        const extracted = normalizeVectorsToPlan(parsed.segments, parsed.labels, 28, 18, {
          alignBox: { x: 1, z: 1, width: 28, depth: 18 },
        });

        if (extracted.walls.length > 0) {
          importCadOcrPlan(
            {
              sourceName: file.name,
              replaceExisting: true,
              footprintWidthM: 30,
              footprintDepthM: 20,
              wallHeightM: 3.6,
              walls: extracted.walls,
              rooms: extracted.rooms,
              openings: extracted.openings,
            },
            { switchToViewMode: '3d-perspective' }
          );
          showToast(
            `Built ${extracted.walls.length} 3D walls & ${extracted.rooms.length} rooms directly from DXF "${file.name}".`,
            'success'
          );
        } else {
          setShowCadOcrModal(true);
          showToast('No ASCII LINE/POLYLINE wall entities detected — try CAD OCR modal.', 'warning');
        }
      } catch {
        showToast('Could not parse CAD file.', 'error');
      }
      return;
    }

    // 3. Raster blueprint (PNG / JPG / WEBP) → preserve natural aspect ratio and launch Vision OCR
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const probe = new Image();
      const finalizeRaster = (natW: number, natH: number) => {
        const aspect = natH > 0 ? natW / natH : 1.5;
        const planW = aspect >= 1 ? 28 : Math.max(12, Number((28 * aspect).toFixed(1)));
        const planD = aspect >= 1 ? Math.max(12, Number((28 / aspect).toFixed(1))) : 28;
        createNewProject('blank', baseName);
        const flId = useTwinStore.getState().activeFloorId;
        const ref = addReferencePlan({
          floorId: flId,
          name: file.name,
          layerCategory: 'reference-plan',
          dataUrl,
          fileType: file.type || 'image/png',
          x: 1,
          z: 1,
          elevation: 0,
          width: planW,
          depth: planD,
          rotationDeg: 0,
          opacity: 0.6,
          visible: true,
          locked: false,
          calibrated: false,
          layerId: 'layer-references',
        });
        setViewMode('2d');
        setLeftTab('references');
        openCadOcrForReference(ref.id);
        showToast('Blueprint loaded — click "Run AI Vision OCR" to extrude real 3D walls & rooms.', 'info');
      };
      probe.onload = () => finalizeRaster(probe.naturalWidth || 28, probe.naturalHeight || 18);
      probe.onerror = () => finalizeRaster(28, 18);
      probe.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const startGuidedWorkflow = () => {
    createNewProject('blank', 'Guided Digital Twin Facility');
    setShowOnboarding(true);
  };

  const telemetryNewTabHref = buildTelemetryTabUrl({ tab: 'trends' });

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-[#0A0A0D] dark:text-zinc-100 flex flex-col">
      {/* Clean Responsive 3-Zone Header */}
      <header className="h-16 border-b border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] px-4 sm:px-6 lg:px-10 flex items-center justify-between gap-4 shrink-0 sticky top-0 z-30">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('overview');
          }}
          className="flex items-center gap-2.5 shrink-0"
        >
          <span className="w-8 h-8 rounded-xl gradian-violet-amber text-white flex items-center justify-center font-bold text-xs shadow-sm">
            G
          </span>
          <span className="text-sm sm:text-base font-bold tracking-tight text-zinc-900 dark:text-white whitespace-nowrap font-[var(--font-display)]">
            Gradian Digital Twin Studio
          </span>
        </a>

        <nav className="hidden lg:flex items-center gap-1 p-1 rounded-2xl bg-zinc-100 dark:bg-[#191920] border border-zinc-200 dark:border-zinc-800/80 text-xs font-medium">
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'projects', label: 'Projects' },
              { id: 'templates', label: 'Templates' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`px-3.5 py-1.5 rounded-xl whitespace-nowrap transition-colors ${
                activeSection === item.id
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
          <button
            onClick={() => openDataCenterPage()}
            className="px-3.5 py-1.5 rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-violet-600 dark:hover:text-violet-300 whitespace-nowrap transition-colors flex items-center gap-1.5"
          >
            <Server className="w-3.5 h-3.5 text-violet-500" />
            Data Center &amp; IT
          </button>
          <button
            onClick={() => setShowModelsGallery(true)}
            className="px-3.5 py-1.5 rounded-xl text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white whitespace-nowrap transition-colors"
          >
            3D Gallery
          </button>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowQuickSearch(true)}
            className="flex items-center gap-2 h-9 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#191922] hover:border-violet-500/50 text-xs text-zinc-500 dark:text-zinc-400 transition-colors"
            title="Command Search (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5 text-violet-500" />
            <span className="hidden sm:inline">Search...</span>
            <kbd className="hidden md:inline px-1.5 py-0.5 rounded bg-zinc-200/80 dark:bg-[#242430] font-mono text-[10px] text-zinc-600 dark:text-zinc-300">
              ⌘K
            </kbd>
          </button>

          <button
            onClick={() => {
              openCinnaGenDemo();
              setShowMayaChat(true);
            }}
            className="hidden sm:flex items-center gap-1.5 h-9 px-3.5 rounded-xl gradian-violet-amber text-white text-xs font-semibold shadow-sm hover:opacity-95 transition-opacity whitespace-nowrap cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Maya AI
          </button>

          <button
            onClick={() => setScreen('maya-life')}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-violet-500/40 bg-violet-500/12 hover:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            title="Open MAYA Life 3D Companion & SOP Studio"
          >
            <Bot className="w-3.5 h-3.5" />
            <span className="hidden md:inline">MAYA Life</span>
          </button>

          <button
            onClick={toggleTheme}
            className="h-9 w-9 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#191922] text-zinc-600 dark:text-zinc-300 hover:border-violet-500/50 flex items-center justify-center transition-colors"
            title={theme === 'dark' ? 'Switch to Light Workspace' : 'Switch to Dark Workspace'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-violet-600" />}
          </button>

          <UserAvatarMenu />
        </div>
      </header>

      {/* Mobile Section Tabs */}
      <div className="flex lg:hidden items-center gap-1.5 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] overflow-x-auto">
        {(['overview', 'projects', 'templates'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium capitalize whitespace-nowrap ${
              activeSection === s
                ? 'bg-violet-600 text-white'
                : 'bg-zinc-100 dark:bg-[#191922] text-zinc-600 dark:text-zinc-300'
            }`}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => openDataCenterPage()}
          className="px-3 py-1.5 rounded-xl text-xs font-medium bg-zinc-100 dark:bg-[#191922] text-violet-500 whitespace-nowrap shrink-0 flex items-center gap-1"
        >
          <Server className="w-3.5 h-3.5" />
          Data Center &amp; IT
        </button>
        <button
          onClick={() => openDashboard({ tab: 'trends' })}
          className="px-3 py-1.5 rounded-xl text-xs font-medium bg-zinc-100 dark:bg-[#191922] text-amber-500 whitespace-nowrap shrink-0"
        >
          Live Telemetry
        </button>
      </div>

      {authError && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 px-6 py-2 text-xs text-amber-800 dark:text-amber-200">
          {authError}
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-8">
        {activeSection === 'overview' && (
          <>
            {/* EXECUTIVE INTELLIGENCE BENTO DASHBOARD: Risks, Live Sensors, Dashboards & Trends */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-violet-600 dark:text-violet-400">
                    <span className={`w-2 h-2 rounded-full ${streamRunning ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span>Enterprise Command Overview · {scene.name}</span>
                  </div>
                  <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-zinc-900 dark:text-white mt-0.5">
                    Risks, Live Sensors &amp; Facility Trends
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => openResourceSchedulingModal(null)}
                    className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#15151C] hover:border-violet-500 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer"
                  >
                    <CalendarClock className="w-3.5 h-3.5 text-violet-500" />
                    Resource Scheduling
                  </button>
                  <button
                    onClick={() => openDataCenterPage()}
                    className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#15151C] hover:border-violet-500 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer"
                  >
                    <Server className="w-3.5 h-3.5 text-violet-500" />
                    Data Center &amp; IT Network
                  </button>
                  <button
                    onClick={() => openDashboard({ tab: 'trends' })}
                    className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#15151C] hover:border-violet-500 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer"
                  >
                    <Activity className="w-3.5 h-3.5 text-amber-500" />
                    Telemetry Console
                  </button>
                  <button
                    onClick={openCinnaGenDemo}
                    className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold whitespace-nowrap transition-colors shadow-sm cursor-pointer"
                  >
                    Launch 3D Studio
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                {/* CARD 1: Risk & GMP Compliance Gauge */}
                <div className="lg:col-span-4 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] p-5 flex flex-col justify-between gap-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                        GMP Compliance &amp; Risk Index
                      </h2>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Live telemetry alarms + spatial clash audit
                      </p>
                    </div>
                    <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                  </div>

                  <div className="py-1">
                    <ComplianceRadialGauge
                      score={overviewMetrics.complianceScore}
                      alarms={overviewMetrics.openAlarmsCount}
                      warnings={overviewMetrics.openDriftsCount + overviewMetrics.warnValidation}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-2xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200/70 dark:border-zinc-800/70">
                      <div className="font-mono tabular-nums text-base font-bold text-rose-500">
                        {overviewMetrics.openAlarmsCount}
                      </div>
                      <div className="text-[10.5px] text-zinc-500">Alarms</div>
                    </div>
                    <div className="p-2.5 rounded-2xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200/70 dark:border-zinc-800/70">
                      <div className="font-mono tabular-nums text-base font-bold text-amber-500">
                        {overviewMetrics.openDriftsCount}
                      </div>
                      <div className="text-[10.5px] text-zinc-500">Drifts</div>
                    </div>
                    <div className="p-2.5 rounded-2xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200/70 dark:border-zinc-800/70">
                      <div className="font-mono tabular-nums text-base font-bold text-violet-500">
                        {overviewMetrics.criticalFmeaCount}
                      </div>
                      <div className="text-[10.5px] text-zinc-500">FMEA ≥200</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => openRiskModal({ mode: 'create' })}
                      className="h-9 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-violet-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer"
                    >
                      + Log FMEA Risk
                    </button>
                    <button
                      onClick={() => {
                        openCinnaGenDemo();
                        setShowMayaChat(true);
                      }}
                      className="h-9 px-3 rounded-xl bg-violet-500/15 hover:bg-violet-600 text-violet-600 dark:text-violet-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Ask Maya AI
                    </button>
                  </div>
                </div>

                {/* CARD 2: Live Facility Sensors & Critical Equipment */}
                <div className="lg:col-span-4 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] p-5 flex flex-col justify-between gap-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                        Live Sensors &amp; Equipment
                      </h2>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {sensors.length} live tags streaming at 1.5s
                      </p>
                    </div>
                    <a
                      href={telemetryNewTabHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:underline"
                    >
                      New Tab
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  {/* Facility Environmental Means */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2.5 rounded-2xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200/70 dark:border-zinc-800/70">
                      <div className="text-[10px] text-zinc-500">Temp Mean</div>
                      <div className="font-mono tabular-nums text-sm font-bold text-zinc-900 dark:text-white mt-0.5">
                        {overviewMetrics.avgTemp.toFixed(1)}<span className="text-[10px] text-zinc-400 font-normal"> °C</span>
                      </div>
                    </div>
                    <div className="p-2.5 rounded-2xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200/70 dark:border-zinc-800/70">
                      <div className="text-[10px] text-zinc-500">Humidity</div>
                      <div className="font-mono tabular-nums text-sm font-bold text-zinc-900 dark:text-white mt-0.5">
                        {overviewMetrics.avgRh.toFixed(0)}<span className="text-[10px] text-zinc-400 font-normal"> %RH</span>
                      </div>
                    </div>
                    <div className="p-2.5 rounded-2xl bg-zinc-50 dark:bg-[#191922] border border-zinc-200/70 dark:border-zinc-800/70">
                      <div className="text-[10px] text-zinc-500">Cascade ΔP</div>
                      <div className="font-mono tabular-nums text-sm font-bold text-amber-500 mt-0.5">
                        +{overviewMetrics.avgDp.toFixed(1)}<span className="text-[10px] text-zinc-400 font-normal"> Pa</span>
                      </div>
                    </div>
                  </div>

                  {/* Key Equipment Live Rows */}
                  <div className="space-y-2">
                    {overviewMetrics.keyEquipmentSensors.slice(0, 3).map((s) => {
                      const snap = readings[s.id];
                      const color = METRIC_PRESETS[s.metric]?.color ?? '#8B5CF6';
                      return (
                        <button
                          key={s.id}
                          onClick={() =>
                            openDashboard({
                              tab: 'trends',
                              assetId: s.targetKind === 'asset' ? s.targetId : null,
                              roomId: s.targetKind === 'room' ? s.targetId : null,
                              sensorId: s.id,
                            })
                          }
                          className="w-full p-2.5 rounded-2xl bg-zinc-50 dark:bg-[#171720] hover:bg-violet-500/10 border border-zinc-200/70 dark:border-zinc-800/80 hover:border-violet-500/50 flex items-center justify-between gap-2 text-left transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-900 dark:text-white truncate">
                              {s.targetName}
                            </div>
                            <div className="text-[10.5px] font-mono text-zinc-500 truncate">
                              {s.tag} · {s.targetCode}
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <MiniSparkline points={snap?.history ?? []} color={color} width={54} height={20} />
                            <div className="text-right font-mono tabular-nums">
                              <div className="text-xs font-bold text-zinc-900 dark:text-white">
                                {(snap?.value ?? s.nominal).toFixed(s.precision)}
                              </div>
                              <div className="text-[10px] text-zinc-400">{s.unit}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* CARD 3: Live Trends Curve & Active Alerts */}
                <div className="lg:col-span-4 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] p-5 flex flex-col justify-between gap-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                        <TrendingUp className="w-4 h-4 text-violet-500" />
                        Live Process Trend &amp; Alerts
                      </h2>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {featuredTrendSensor ? `${featuredTrendSensor.tag} · ${featuredTrendSensor.targetName}` : 'Live facility stream'}
                      </p>
                    </div>
                    <button
                      onClick={() => setTrendChannelIdx((i) => i + 1)}
                      className="px-2.5 py-1 rounded-xl bg-zinc-100 dark:bg-[#1B1B24] hover:bg-violet-600 hover:text-white text-[10.5px] font-medium transition-colors shrink-0"
                    >
                      Next Sensor
                    </button>
                  </div>

                  {/* Crisp Mini Area Chart */}
                  <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-[#0D0D12] border border-zinc-200/70 dark:border-zinc-800/80">
                    {featuredTrendSensor && (
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="font-mono tabular-nums text-xl font-bold text-zinc-900 dark:text-white">
                          {(readings[featuredTrendSensor.id]?.value ?? featuredTrendSensor.nominal).toFixed(
                            featuredTrendSensor.precision
                          )}{' '}
                          <span className="text-xs font-normal text-zinc-400">{featuredTrendSensor.unit}</span>
                        </span>
                        <span className="text-[10.5px] font-mono text-amber-500">
                          SP {featuredTrendSensor.nominal} {featuredTrendSensor.unit}
                        </span>
                      </div>
                    )}
                    <MiniSparkline
                      points={featuredTrendHistory}
                      color={featuredTrendSensor ? METRIC_PRESETS[featuredTrendSensor.metric]?.color ?? '#8B5CF6' : '#8B5CF6'}
                      width={310}
                      height={58}
                    />
                  </div>

                  {/* Active Deviations / Risks List */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      Active Risk &amp; Deviation Feed
                    </div>
                    {overviewMetrics.alarmSensors.length === 0 &&
                    overviewMetrics.warnSensors.length === 0 &&
                    validationIssues.length === 0 ? (
                      <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>All {sensors.length} sensors and spatial checks nominal.</span>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-[104px] overflow-y-auto">
                        {[...overviewMetrics.alarmSensors, ...overviewMetrics.warnSensors].slice(0, 2).map((s) => (
                          <button
                            key={s.id}
                            onClick={() =>
                              openDashboard({
                                tab: 'trends',
                                assetId: s.targetKind === 'asset' ? s.targetId : null,
                                roomId: s.targetKind === 'room' ? s.targetId : null,
                                sensorId: s.id,
                              })
                            }
                            className="w-full px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-2 text-left text-[11px]"
                          >
                            <span className="flex items-center gap-1.5 truncate font-medium text-amber-600 dark:text-amber-300">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              {s.tag} · {s.targetName}
                            </span>
                            <span className="font-mono font-bold text-amber-500 shrink-0">
                              {(readings[s.id]?.value ?? s.nominal).toFixed(s.precision)} {s.unit}
                            </span>
                          </button>
                        ))}
                        {validationIssues.slice(0, 2).map((issue) => (
                          <button
                            key={issue.id}
                            onClick={() => {
                              openCinnaGenDemo();
                              const firstId = issue.entityIds?.[0];
                              if (firstId && issue.entityType === 'asset') drillInto('asset', firstId);
                              else if (firstId && issue.entityType === 'room') drillInto('room', firstId);
                              setRightTab('validation');
                              setRightPanelOpen(true);
                            }}
                            className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-[#191922] hover:bg-violet-500/10 flex items-center justify-between gap-2 text-left text-[11px] transition-colors"
                          >
                            <span className="truncate text-zinc-700 dark:text-zinc-300">{issue.title}</span>
                            <span className="text-[10px] font-mono text-violet-500 shrink-0">3D →</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* LIVE ALARMS, DRIFTS & FMEA RISK PRIORITY REGISTER */}
            <section className="rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#121216] overflow-hidden">
              <div className="px-5 sm:px-6 py-4 border-b border-zinc-200 dark:border-zinc-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>Automated Incident Logging · FMEA Risk Priority (RPN = S × O × D)</span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white mt-0.5">
                    Active Alarms, Live Drifts &amp; FMEA Register
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#181821] text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoLogEnabled}
                      onChange={(e) => setAutoLogEnabled(e.target.checked)}
                      className="accent-violet-600 rounded"
                    />
                    <span>Auto-Log Telemetry</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => openRiskModal({ mode: 'heatmap' })}
                    className="h-9 px-3 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Flame className="w-3.5 h-3.5" />
                    Risk Heatmap (S×O)
                  </button>
                  <button
                    type="button"
                    onClick={() => openAssetPdfModal(null)}
                    className="h-9 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#181821] hover:border-violet-500 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-violet-500" />
                    Asset PDF Report
                  </button>
                  <button
                    type="button"
                    onClick={() => openRiskModal({ mode: 'create' })}
                    className="h-9 px-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Risk / FMEA
                  </button>
                </div>
              </div>

              {/* Filter Strip */}
              <div className="px-5 sm:px-6 py-2.5 border-b border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/70 dark:bg-[#15151C] flex items-center gap-2 overflow-x-auto">
                {(
                  [
                    { id: 'all', label: `All (${riskIncidents.length})` },
                    { id: 'alarm', label: `Alarms (${riskIncidents.filter((i) => i.kind === 'alarm').length})` },
                    { id: 'drift', label: `Drifts (${riskIncidents.filter((i) => i.kind === 'drift').length})` },
                    { id: 'critical-fmea', label: `Critical RPN ≥200 (${riskIncidents.filter((i) => i.rpn >= 200).length})` },
                    { id: 'auto', label: `Auto-Logged (${riskIncidents.filter((i) => i.source === 'auto-telemetry').length})` },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setRiskFilter(f.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      riskFilter === f.id
                        ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Ranked Incident & FMEA Rows */}
              <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                {filteredRiskIncidents.length === 0 ? (
                  <div className="px-6 py-8 text-center text-sm text-zinc-500">
                    No matching alarms, drifts, or FMEA risks in this view.
                  </div>
                ) : (
                  filteredRiskIncidents.map((inc) => {
                    const prio = getRpnPriority(inc.rpn);
                    return (
                      <div
                        key={inc.id}
                        className="px-5 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-zinc-50/70 dark:hover:bg-[#171720] transition-colors"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{inc.code}</span>
                            <span>·</span>
                            <span
                              className={
                                inc.kind === 'alarm'
                                  ? 'text-rose-500 font-semibold'
                                  : inc.kind === 'drift'
                                    ? 'text-amber-500 font-semibold'
                                    : 'text-violet-500 font-semibold'
                              }
                            >
                              {inc.kind === 'alarm' ? 'ALARM' : inc.kind === 'drift' ? 'DRIFT' : inc.kind === 'fmea-risk' ? 'FMEA RISK' : 'GMP DEV'}
                            </span>
                            <span>·</span>
                            <span className="capitalize">{inc.status}</span>
                            <span>·</span>
                            <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                              {inc.targetCode} · {inc.targetName}
                            </span>
                            {inc.source === 'auto-telemetry' && (
                              <>
                                <span>·</span>
                                <span className="text-emerald-600 dark:text-emerald-400">Auto-Logged</span>
                              </>
                            )}
                          </div>

                          <div className="text-sm font-semibold text-zinc-900 dark:text-white leading-snug">
                            {inc.title}
                          </div>

                          <div className="text-xs text-zinc-600 dark:text-zinc-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {inc.currentValueLabel && (
                              <span className="font-mono font-medium text-amber-600 dark:text-amber-400">
                                {inc.currentValueLabel}
                              </span>
                            )}
                            <span className="truncate max-w-xl">{inc.failureMode}</span>
                            {inc.linkedWorkOrderId && (
                              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                                CAPA {inc.linkedWorkOrderId}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* FMEA RPN Score + Navigation & AI Resolve Actions */}
                        <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 shrink-0">
                          <div className="text-left lg:text-right pr-1">
                            <div className={`font-mono tabular-nums text-base font-bold leading-none ${prio.textClass}`}>
                              RPN {inc.rpn}
                            </div>
                            <div className="font-mono tabular-nums text-[10.5px] text-zinc-500 mt-1">
                              S:{inc.severity} · O:{inc.occurrence} · D:{inc.detection} ({prio.label})
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => navigateToRiskTarget(inc, '3d')}
                              className="min-h-[36px] px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-xs font-medium text-zinc-800 dark:text-zinc-100 cursor-pointer"
                              title="Focus target in 3D Digital Twin"
                            >
                              3D
                            </button>
                            <button
                              type="button"
                              onClick={() => navigateToRiskTarget(inc, '2d')}
                              className="min-h-[36px] px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-xs font-medium text-zinc-800 dark:text-zinc-100 cursor-pointer"
                              title="Focus target in 2D Floor Plan"
                            >
                              2D
                            </button>
                            {(inc.sensorId || inc.targetKind === 'asset' || inc.targetKind === 'room') && (
                              <button
                                type="button"
                                onClick={() => navigateToRiskTarget(inc, 'telemetry')}
                                className="min-h-[36px] px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 text-xs font-medium text-zinc-800 dark:text-zinc-100 cursor-pointer"
                                title="Open live telemetry trends"
                              >
                                Trends
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openRiskModal({ mode: 'resolve', incidentId: inc.id })}
                              className="min-h-[36px] px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              {inc.aiResolution ? 'AI CAPA' : 'AI Resolve'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* FEATURED DIGITAL TWIN CAMPUS LAUNCH CARD */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              <div className="lg:col-span-5 flex flex-col justify-between bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 rounded-3xl p-6">
                <div className="space-y-3.5">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
                    <Sparkles className="w-3.5 h-3.5" />
                    Featured Digital Twin · EU GMP Annex 1 Ready
                  </div>
                  <h2 className="text-xl lg:text-2xl font-bold tracking-tight text-zinc-900 dark:text-white leading-tight [text-wrap:balance]">
                    CinnaGen Biopharmaceutical Manufacturing Campus
                  </h2>
                  <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    Multi-building biopharma campus with Grade A–D cleanrooms, 2000L bioreactors, aseptic vial fill-finish, QC UHPLC labs, live 3D thermal/ΔP heatmaps, org-wide isolation, and Maya AI conversational map design.
                  </p>
                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-zinc-200 dark:border-zinc-800/80">
                    <div>
                      <div className="font-mono tabular-nums text-lg font-bold text-zinc-900 dark:text-white">
                        {scene.buildings.length} / {scene.floors.length}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Bldgs · Floors</div>
                    </div>
                    <div>
                      <div className="font-mono tabular-nums text-lg font-bold text-violet-500">
                        {scene.rooms.length}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">GMP Rooms</div>
                    </div>
                    <div>
                      <div className="font-mono tabular-nums text-lg font-bold text-amber-500">
                        {scene.assets.length}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Smart Assets</div>
                    </div>
                  </div>
                </div>

                <div className="pt-5 flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={openCinnaGenDemo}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap"
                  >
                    Open CinnaGen 3D Twin
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setShowBlankForm((v) => !v)}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl border border-zinc-300 dark:border-zinc-700 hover:border-violet-500 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    New Blank Site
                  </button>
                </div>

                {showBlankForm && (
                  <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Facility or campus name..."
                      className="flex-1 px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-[#191922] border border-zinc-300 dark:border-zinc-700 focus:outline-none focus:border-violet-500"
                    />
                    <button
                      onClick={() => createNewProject('blank', newName.trim() || 'New Industrial Facility')}
                      className="px-4 py-2 text-xs font-semibold rounded-xl bg-violet-600 hover:bg-violet-500 text-white whitespace-nowrap"
                    >
                      Create
                    </button>
                  </div>
                )}
              </div>

              <div className="lg:col-span-7 relative rounded-3xl overflow-hidden border border-zinc-200 dark:border-zinc-800/80 bg-[#121216] min-h-[290px]">
                <img
                  src={HERO_IMG}
                  alt="CinnaGen Biopharmaceutical Manufacturing Campus 3D isometric visualization"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0D]/95 via-[#0A0A0D]/30 to-transparent" />
                <div className="absolute bottom-5 left-6 right-6 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xs text-amber-400 font-mono">SITE-ALBZ · Rev 4 · Metric (m)</p>
                    <p className="text-base font-semibold text-white mt-0.5">
                      Full 2D Floor Plan, 3D Studio PBR, Live Heatmap &amp; Maya AI Map Designer
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      openCinnaGenDemo();
                      setShowMayaChat(true);
                    }}
                    className="px-4 py-2 rounded-xl gradian-violet-amber text-white text-xs font-semibold whitespace-nowrap shrink-0 shadow-md hover:opacity-95 transition-opacity flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Design Map with Maya AI
                  </button>
                </div>
              </div>
            </section>
          </>
        )}

        {/* Quick Dashboards & Launchers Strip */}
        <section className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3.5">
          <button
            onClick={() => openResourceSchedulingModal(null)}
            className="text-left p-4 rounded-2xl bg-white dark:bg-[#121216] border border-violet-500/35 hover:border-violet-500 transition-colors cursor-pointer"
          >
            <CalendarClock className="w-5 h-5 text-violet-500 mb-2.5" />
            <div className="text-sm font-semibold text-zinc-900 dark:text-white">Zone Scheduling</div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              Assign personnel &amp; GMP assets to zones gated by live telemetry.
            </p>
          </button>

          <button
            onClick={() => openDataCenterPage()}
            className="text-left p-4 rounded-2xl bg-white dark:bg-[#121216] border border-violet-500/35 hover:border-violet-500 transition-colors cursor-pointer"
          >
            <Server className="w-5 h-5 text-violet-500 mb-2.5" />
            <div className="text-sm font-semibold text-zinc-900 dark:text-white">Data Center &amp; IT</div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              Dedicated 42U rack, fiber/copper port, VLAN &amp; PDU designer.
            </p>
          </button>

          <button
            onClick={() => {
              openCinnaGenDemo();
              setShowMayaChat(true);
            }}
            className="text-left p-4 rounded-2xl bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 hover:border-violet-500 transition-colors"
          >
            <Sparkles className="w-5 h-5 text-violet-500 mb-2.5" />
            <div className="text-sm font-semibold text-zinc-900 dark:text-white">Maya AI Designer</div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              Modify 2D/3D maps via chat with inline charts &amp; 1-click apply.
            </p>
          </button>

          <button
            onClick={() => openDashboard({ tab: 'trends' })}
            className="text-left p-4 rounded-2xl bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 hover:border-amber-500 transition-colors"
          >
            <Activity className="w-5 h-5 text-amber-500 mb-2.5" />
            <div className="text-sm font-semibold text-zinc-900 dark:text-white">Live Telemetry</div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              Bioreactors, HPLCs, cleanroom trends, tags &amp; control loops.
            </p>
          </button>

          <button
            onClick={() => {
              openCinnaGenDemo();
              setShowAIPlannerModal(true);
            }}
            className="text-left p-4 rounded-2xl bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 hover:border-violet-500 transition-colors"
          >
            <Wand2 className="w-5 h-5 text-violet-400 mb-2.5" />
            <div className="text-sm font-semibold text-zinc-900 dark:text-white">AI Floor Planner</div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              Generate &amp; optimize LLM floor plans and attach to any parent.
            </p>
          </button>

          <button
            onClick={() => setShowModelsGallery(true)}
            className="text-left p-4 rounded-2xl bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 hover:border-amber-500 transition-colors"
          >
            <LayoutGrid className="w-5 h-5 text-amber-400 mb-2.5" />
            <div className="text-sm font-semibold text-zinc-900 dark:text-white">3D Models Gallery</div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              Inspect 60+ interactive PBR biopharma, safety &amp; cold-room models.
            </p>
          </button>

          <button
            onClick={() => planInputRef.current?.click()}
            className="text-left p-4 rounded-2xl bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 hover:border-violet-500 transition-colors"
          >
            <Upload className="w-5 h-5 text-zinc-500 dark:text-zinc-300 mb-2.5" />
            <div className="text-sm font-semibold text-zinc-900 dark:text-white">Import SVG / DWG Plan</div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              Build real 3D walls &amp; rooms directly from SVG, DXF, DWG, or blueprint image.
            </p>
          </button>

          <button
            onClick={() => jsonInputRef.current?.click()}
            className="text-left p-4 rounded-2xl bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 hover:border-violet-500 transition-colors"
          >
            <FileUp className="w-5 h-5 text-zinc-500 dark:text-zinc-300 mb-2.5" />
            <div className="text-sm font-semibold text-zinc-900 dark:text-white">Import JSON</div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              Load an exported Gradian digital twin with full metadata.
            </p>
          </button>

          <input ref={jsonInputRef} type="file" accept=".json" className="hidden" onChange={handleImportJSON} />
          <input ref={planInputRef} type="file" accept=".svg,.dxf,.dwg,image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleImportFloorPlan} />
        </section>

        {/* Industry Templates */}
        {(activeSection === 'overview' || activeSection === 'templates') && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                  Industry Digital Twin Templates
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Pre-engineered spatial layouts with GMP room classifications and intelligent equipment.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => createNewProject('blank', 'New Blank Industrial Site')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-violet-500 text-xs font-medium"
                >
                  <Building2 className="w-3.5 h-3.5 text-violet-500" />
                  Blank Site
                </button>
                <button
                  onClick={startGuidedWorkflow}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-amber-500 text-xs font-medium"
                >
                  <Compass className="w-3.5 h-3.5 text-amber-500" />
                  Guided Start
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 rounded-3xl overflow-hidden flex flex-col">
                <div className="h-44 bg-[#17171F] overflow-hidden">
                  <img
                    src={CLEANROOM_IMG}
                    alt="Aseptic Fill-Finish Cleanroom Suite"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Aseptic Fill-Finish Suite
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      Grade A/B/C · 5 rooms · Vial filler, lyophilizer, barrier autoclave &amp; interlocked airlocks
                    </p>
                  </div>
                  <button
                    onClick={() => createNewProject('aseptic-suite')}
                    className="w-full py-2.5 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-violet-600 hover:text-white hover:border-violet-600 text-xs font-semibold transition-colors"
                  >
                    Create from Template
                  </button>
                </div>
              </div>

              <div className="bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 rounded-3xl overflow-hidden flex flex-col">
                <div className="h-44 bg-[#17171F] overflow-hidden">
                  <img
                    src={QCLAB_IMG}
                    alt="QC Analytical and Microbiology Laboratory"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      QC Analytical &amp; Micro Laboratory
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      ISO 17025 · 4 rooms · UHPLC, LC-MS/MS, Class II BSC, sterility isolator &amp; stability chambers
                    </p>
                  </div>
                  <button
                    onClick={() => createNewProject('qc-lab')}
                    className="w-full py-2.5 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-violet-600 hover:text-white hover:border-violet-600 text-xs font-semibold transition-colors"
                  >
                    Create from Template
                  </button>
                </div>
              </div>

              <div className="bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 rounded-3xl overflow-hidden flex flex-col">
                <div className="h-44 bg-gradient-to-br from-[#1C1629] via-[#15151D] to-[#231B12] flex items-center justify-center p-6">
                  <div className="text-center space-y-2">
                    <Layers className="w-9 h-9 text-amber-400 mx-auto" />
                    <div className="text-xs font-mono text-zinc-300">2–8 °C Cold Chain · GDP Mapped</div>
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      GDP Cold-Chain Distribution Hub
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      Controlled Ambient &amp; 2–8 °C · Pallet racking, reach forklift, staging conveyors &amp; dock bays
                    </p>
                  </div>
                  <button
                    onClick={() => createNewProject('cold-warehouse')}
                    className="w-full py-2.5 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-violet-600 hover:text-white hover:border-violet-600 text-xs font-semibold transition-colors"
                  >
                    Create from Template
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Recent & Cloud Projects */}
        {(activeSection === 'overview' || activeSection === 'projects') && (
          <section className="space-y-4 pb-6">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                Recent &amp; Cloud Projects
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {user
                  ? `Signed in as ${user.email} — cloud projects synchronize across sessions.`
                  : 'Projects autosave locally in this browser. Sign in with Google to synchronize to Cloud SQL.'}
              </p>
            </div>

            {user && (
              <div className="bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 rounded-3xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800/80 flex items-center justify-between text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  <span className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-violet-500" />
                    Cloud Saved Projects ({cloudProjects.length})
                  </span>
                  {loadingCloud && <span className="font-normal text-zinc-400">Syncing...</span>}
                </div>
                {cloudProjects.length === 0 ? (
                  <div className="p-5 text-xs text-zinc-500 dark:text-zinc-400">
                    No cloud projects saved yet. Open any digital twin and click Save to Cloud in the workspace menu.
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800/70">
                    {cloudProjects.map((p) => (
                      <div
                        key={p.id}
                        className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-[#181820] transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                            {p.name}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                            {p.code} · {p.industry} · Rev {p.revision} · Updated {new Date(p.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleOpenCloudProject(p.id)}
                            className="px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold whitespace-nowrap"
                          >
                            Open
                          </button>
                          <button
                            onClick={() => handleDeleteCloudProject(p.id)}
                            className="p-1.5 rounded-xl text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Delete Cloud Project"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="bg-white dark:bg-[#121216] border border-zinc-200 dark:border-zinc-800/80 rounded-3xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800/80 flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                <FolderOpen className="w-4 h-4 text-amber-500" />
                Local Workspace Projects ({savedProjects.length})
              </div>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800/70">
                {savedProjects.map((proj) => (
                  <div
                    key={proj.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-[#181820] transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                        {proj.name}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                        {proj.code} · {proj.buildings.length} bldgs · {proj.floors.length} floors · {proj.rooms.length} rooms · {proj.assets.length} assets
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openProject(proj)}
                        className="px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-violet-600 hover:text-white hover:border-violet-600 text-xs font-semibold whitespace-nowrap transition-colors"
                      >
                        Open Workspace
                      </button>
                      {proj.id !== 'proj-cinnagen-campus' && (
                        <button
                          onClick={() => deleteSavedProject(proj.id)}
                          className="p-1.5 rounded-xl text-zinc-400 hover:text-rose-500"
                          title="Delete local project"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
