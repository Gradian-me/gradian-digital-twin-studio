import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Check,
  Cpu,
  Layers,
  Loader2,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { useTwinStore, type GeneratedFloorPlanPayload } from '../store/useTwinStore';
import { SPACE_TYPE_LIBRARY } from '../data/spaceTypes';
import { OBJECT_LIBRARY } from '../data/objectLibrary';
import { fetchApiJson } from '../utils/safeJson';

interface AIPlanResult extends GeneratedFloorPlanPayload {
  optimizationNotes?: string[];
  estimatedEfficiencyPct?: number;
  complianceScorePct?: number;
}

const INDUSTRY_PRESETS = [
  {
    industry: 'Biopharmaceutical',
    label: 'mAb Biomanufacturing Suite',
    prompt:
      'Design a GMP monoclonal antibody manufacturing floor with Grade C Cell Culture bioreactor suite, Grade C Downstream Purification chromatography room, Personnel & Material Airlocks, Media/Buffer Prep room, central Clean Corridor, and QC In-Process Lab.',
    width: 38,
    depth: 24,
    height: 4.2,
  },
  {
    industry: 'Aseptic Fill-Finish',
    label: 'Sterile Vial Fill-Finish Line',
    prompt:
      'Design an EU GMP Annex 1 sterile fill-finish suite with Grade A/B Aseptic Filling room (isolator + lyophilizer), Grade C Compounding & Component Prep, Gowning/Degowning Airlocks, Pass-Through Autoclave room, and Visual Inspection & Packaging.',
    width: 34,
    depth: 22,
    height: 3.8,
  },
  {
    industry: 'Quality Control Laboratory',
    label: 'ISO 17025 Analytical & Micro Lab',
    prompt:
      'Design a pharmaceutical Quality Control laboratory floor with Analytical HPLC/LC-MS Instrument Lab, Wet Chemistry Lab, Sterility/Microbiology Biosafety Lab, Stability Chambers room, Sample Receiving & LIMS Office, and Gowning Vestibule.',
    width: 32,
    depth: 20,
    height: 3.6,
  },
  {
    industry: 'GDP Cold-Chain Warehouse',
    label: 'GDP 2–8°C Distribution Hub',
    prompt:
      'Design a GDP cold-chain biopharma warehouse with High-Bay Ambient Racking, 2-8C Cold Storage Chamber, -20C Frozen Vault, Quarantine Hold Zone, Inbound/Outbound Staging Docks, and Shipping Control Office.',
    width: 44,
    depth: 26,
    height: 6.0,
  },
];

export const AIPlannerPlaygroundModal: React.FC = () => {
  const showAIPlannerModal = useTwinStore((s) => s.showAIPlannerModal);
  const setShowAIPlannerModal = useTwinStore((s) => s.setShowAIPlannerModal);
  const scene = useTwinStore((s) => s.scene);
  const activeBuildingId = useTwinStore((s) => s.activeBuildingId);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const applyAIGeneratedFloorPlan = useTwinStore((s) => s.applyAIGeneratedFloorPlan);

  const [industry, setIndustry] = useState('Biopharmaceutical');
  const [prompt, setPrompt] = useState(INDUSTRY_PRESETS[0].prompt);
  const [optimizationGoal, setOptimizationGoal] = useState(
    'Minimize operator travel distance, enforce unidirectional clean-to-dirty GMP flow, preserve >= 1.5m service clearance, and maximize usable area.'
  );
  const [footprintWidth, setFootprintWidth] = useState(38);
  const [footprintDepth, setFootprintDepth] = useState(24);
  const [ceilingHeight, setCeilingHeight] = useState(4.2);

  // Parent target hierarchy configuration
  const [parentMode, setParentMode] = useState<'new-floor' | 'replace-floor' | 'new-building'>('new-floor');
  const [targetBuildingId, setTargetBuildingId] = useState(activeBuildingId || scene.buildings[0]?.id || '');
  const [targetFloorId, setTargetFloorId] = useState(activeFloorId || scene.floors[0]?.id || '');
  const [targetDepartmentId, setTargetDepartmentId] = useState(
    scene.hierarchy.find((h) => h.level === 'department')?.id || ''
  );
  const [newBuildingName, setNewBuildingName] = useState('AI Generated Bioprocess Wing');
  const [newFloorName, setNewFloorName] = useState('AI Optimized Production Level');

  const [loadingMode, setLoadingMode] = useState<'generate' | 'optimize' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<AIPlanResult | null>(null);

  const departments = useMemo(
    () => scene.hierarchy.filter((h) => h.level === 'department'),
    [scene.hierarchy]
  );

  if (!showAIPlannerModal) return null;

  const loadActiveFloorIntoPlayground = () => {
    const fl = scene.floors.find((f) => f.id === activeFloorId);
    if (!fl) return;
    const flRooms = scene.rooms.filter((r) => r.floorId === fl.id);
    const flAssets = scene.assets.filter((a) => a.floorId === fl.id);
    const flFlows = scene.flows.filter((f) => f.floorId === fl.id);
    setFootprintWidth(fl.width);
    setFootprintDepth(fl.depth);
    setCeilingHeight(fl.height);
    setPlan({
      planName: `${fl.name} (Loaded Baseline)`,
      summary: `Imported ${flRooms.length} rooms and ${flAssets.length} equipment assets from active floor for AI optimization.`,
      footprintWidth: fl.width,
      footprintDepth: fl.depth,
      ceilingHeight: fl.height,
      rooms: flRooms.map((r) => ({
        code: r.code,
        name: r.name,
        spaceTypeId: r.spaceTypeId,
        x: r.x,
        z: r.z,
        width: r.width,
        depth: r.depth,
        height: r.height,
        cleanroomGrade: r.environmental.cleanroomGrade,
        pressurePa: r.environmental.pressurePa,
        airChangesPerHour: r.environmental.airChangesPerHour,
        temperatureC: r.environmental.temperatureC,
        color: r.color,
      })),
      equipment: flAssets.map((a) => ({
        name: a.name,
        templateId: a.templateId,
        roomCode: flRooms.find((r) => r.id === a.roomId)?.code,
        x: a.x,
        z: a.z,
        rotationDeg: Math.round((a.rotationY * 180) / Math.PI),
      })),
      flows: flFlows.map((f) => ({
        name: f.name,
        flowType: f.flowType,
        cleanlinessClass: f.cleanlinessClass,
        points: f.points,
      })),
    });
  };

  const runPlanner = async (mode: 'generate' | 'optimize') => {
    setLoadingMode(mode);
    setError(null);
    try {
      const data = await fetchApiJson<any>(
        '/api/floor-planner',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            prompt,
            industry,
            footprintWidth,
            footprintDepth,
            ceilingHeight,
            optimizationGoal,
            currentPlan: mode === 'optimize' ? plan : undefined,
            availableSpaceTypes: SPACE_TYPE_LIBRARY.slice(0, 28).map((s) => ({
              id: s.id,
              name: s.name,
              grade: s.environmental.cleanroomGrade,
            })),
            availableEquipment: OBJECT_LIBRARY.slice(0, 32).map((o) => ({
              id: o.id,
              name: o.name,
              width: o.width,
              depth: o.depth,
            })),
          }),
        },
        'AI Floor Planner failed. Please retry.'
      );
      setPlan({
        ...data,
        footprintWidth,
        footprintDepth,
        ceilingHeight,
      });
      if (data.planName) {
        setNewFloorName(data.planName);
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to generate floor plan.');
    } finally {
      setLoadingMode(null);
    }
  };

  const handleSaveToParent = () => {
    if (!plan) return;
    applyAIGeneratedFloorPlan(plan, {
      mode: parentMode,
      buildingId: targetBuildingId || scene.buildings[0]?.id,
      floorId: targetFloorId || activeFloorId,
      departmentId: targetDepartmentId || undefined,
      newBuildingName,
      newFloorName,
    });
  };

  const totalRoomArea = plan
    ? plan.rooms.reduce((sum, r) => sum + r.width * r.depth, 0)
    : 0;
  const footprintArea = footprintWidth * footprintDepth;
  const computedEfficiency = plan
    ? Math.min(100, Math.round((totalRoomArea / Math.max(1, footprintArea)) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-6xl h-[90vh] bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-4 shrink-0 bg-zinc-50 dark:bg-[#0D0D10]">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setShowAIPlannerModal(false)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#17171F] hover:border-violet-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 shrink-0 transition-colors"
              title="Back to Studio"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-violet-500" />
              <span className="hidden sm:inline">Back</span>
            </button>
            <div className="w-8 h-8 rounded-xl gradian-violet-amber text-white flex items-center justify-center shrink-0">
              <Wand2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white truncate">
                AI Map Generator, Floor Planner &amp; Spatial Optimizer Playground
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                Generate clash-free GMP &amp; industrial layouts with Gemini AI, iteratively optimize flows, then commit under any Building or Floor
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAIPlannerModal(false)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Split Workspace */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left Controls Column */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto p-4 space-y-4 text-xs bg-white dark:bg-[#111114]">
            {/* Quick Presets */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">Facility Brief Presets</span>
                <button
                  onClick={loadActiveFloorIntoPlayground}
                  className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                >
                  Import Active Floor to Optimize
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {INDUSTRY_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      setIndustry(preset.industry);
                      setPrompt(preset.prompt);
                      setFootprintWidth(preset.width);
                      setFootprintDepth(preset.depth);
                      setCeilingHeight(preset.height);
                    }}
                    className={`text-left px-2.5 py-2 rounded-lg border transition-colors ${
                      industry === preset.industry
                        ? 'border-emerald-500 bg-emerald-500/10 text-zinc-900 dark:text-white'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-600'
                    }`}
                  >
                    <div className="font-medium truncate">{preset.label}</div>
                    <div className="text-[10px] font-mono text-zinc-500">
                      {preset.width}×{preset.depth}m
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt Brief */}
            <label className="block space-y-1.5">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">Architectural &amp; Process Prompt</span>
              <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe rooms, cleanroom grades, equipment lines, corridors, and flow rules..."
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-emerald-500 resize-none"
              />
            </label>

            {/* Dimensions */}
            <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
              <label className="space-y-1">
                <span className="text-[10px] text-zinc-500">Width (m)</span>
                <input
                  type="number"
                  min={14}
                  max={80}
                  value={footprintWidth}
                  onChange={(e) => setFootprintWidth(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-zinc-500">Depth (m)</span>
                <input
                  type="number"
                  min={10}
                  max={60}
                  value={footprintDepth}
                  onChange={(e) => setFootprintDepth(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-zinc-500">Height (m)</span>
                <input
                  type="number"
                  step={0.2}
                  min={2.8}
                  max={10}
                  value={ceilingHeight}
                  onChange={(e) => setCeilingHeight(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
                />
              </label>
            </div>

            {/* Optimizer Objective */}
            <label className="block space-y-1">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">LLM Optimization Objective</span>
              <input
                value={optimizationGoal}
                onChange={(e) => setOptimizationGoal(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
              />
            </label>

            {/* Generate / Optimize Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => runPlanner('generate')}
                disabled={loadingMode !== null || !prompt.trim()}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-45 transition-colors whitespace-nowrap"
              >
                {loadingMode === 'generate' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {loadingMode === 'generate' ? 'Generating...' : 'Generate Map'}
              </button>

              <button
                onClick={() => runPlanner('optimize')}
                disabled={loadingMode !== null || !plan}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-zinc-900 dark:bg-zinc-800 hover:bg-zinc-800 dark:hover:bg-zinc-700 text-white border border-zinc-700 font-semibold disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {loadingMode === 'optimize' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                )}
                {loadingMode === 'optimize' ? 'Optimizing...' : 'Optimize Plan'}
              </button>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 text-[11px]">
                {error}
              </div>
            )}

            {/* Hierarchy Parent Assignment Panel */}
            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
              <div className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-violet-500" />
                Save &amp; Assign Parent in Hierarchy
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-[#18181C]">
                {(
                  [
                    { id: 'new-floor', label: 'New Floor' },
                    { id: 'replace-floor', label: 'Replace Floor' },
                    { id: 'new-building', label: 'New Building' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setParentMode(opt.id)}
                    className={`py-1.5 px-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                      parentMode === opt.id
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs'
                        : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {parentMode === 'new-floor' && (
                <div className="space-y-2">
                  <label className="block space-y-1">
                    <span className="text-[10px] text-zinc-500">Parent Building</span>
                    <select
                      value={targetBuildingId}
                      onChange={(e) => setTargetBuildingId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
                    >
                      {scene.buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] text-zinc-500">New Floor Name</span>
                    <input
                      value={newFloorName}
                      onChange={(e) => setNewFloorName(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
                    />
                  </label>
                </div>
              )}

              {parentMode === 'replace-floor' && (
                <label className="block space-y-1">
                  <span className="text-[10px] text-zinc-500">Target Floor to Replace</span>
                  <select
                    value={targetFloorId}
                    onChange={(e) => setTargetFloorId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
                  >
                    {scene.floors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code} — {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {parentMode === 'new-building' && (
                <div className="space-y-2">
                  <label className="block space-y-1">
                    <span className="text-[10px] text-zinc-500">New Building Name (under Active Site)</span>
                    <input
                      value={newBuildingName}
                      onChange={(e) => setNewBuildingName(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] text-zinc-500">Ground Floor Name</span>
                    <input
                      value={newFloorName}
                      onChange={(e) => setNewFloorName(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
                    />
                  </label>
                </div>
              )}

              {departments.length > 0 && (
                <label className="block space-y-1">
                  <span className="text-[10px] text-zinc-500">Assign Functional Department / Area</span>
                  <select
                    value={targetDepartmentId}
                    onChange={(e) => setTargetDepartmentId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.metadata?.code || d.id} — {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>

          {/* Right Live Interactive Blueprint Preview */}
          <div className="lg:col-span-8 flex flex-col min-h-0 bg-[#09090B] text-zinc-100">
            {/* Top Preview Metrics Strip */}
            <div className="px-4 py-2.5 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
              <div className="font-semibold text-white truncate">
                {plan ? plan.planName : 'Interactive Floor Plan Playground Preview'}
              </div>
              <div className="flex items-center gap-4 font-mono tabular-nums text-[11px] text-zinc-400">
                <span>Rooms: <strong className="text-white">{plan?.rooms.length ?? 0}</strong></span>
                <span>Assets: <strong className="text-white">{plan?.equipment.length ?? 0}</strong></span>
                <span>Flows: <strong className="text-white">{plan?.flows.length ?? 0}</strong></span>
                <span>
                  Efficiency:{' '}
                  <strong className="text-emerald-400">
                    {plan?.estimatedEfficiencyPct ?? computedEfficiency}%
                  </strong>
                </span>
              </div>
            </div>

            {/* Interactive SVG Architectural Preview */}
            <div className="flex-1 min-h-0 relative p-4 flex items-center justify-center charcoal-grid overflow-hidden">
              {!plan ? (
                <div className="text-center max-w-md space-y-3">
                  <Layers className="w-10 h-10 text-emerald-500/80 mx-auto" />
                  <h3 className="text-base font-semibold text-white">
                    Ready to Synthesize a 2D/3D Facility Plan
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Click <strong>Generate Map</strong> to build a complete non-overlapping room layout, pressure cascade, smart equipment plan, and unidirectional routes—or import your active floor and run <strong>Optimize Plan</strong>.
                  </p>
                </div>
              ) : (
                <svg
                  viewBox={`-2 -2 ${footprintWidth + 4} ${footprintDepth + 4}`}
                  className="w-full h-full max-h-full"
                >
                  {/* Footprint Boundary */}
                  <rect
                    x={0}
                    y={0}
                    width={footprintWidth}
                    height={footprintDepth}
                    fill="#111114"
                    stroke="#3F3F46"
                    strokeWidth={0.22}
                    rx={0.4}
                  />

                  {/* Rooms */}
                  {plan.rooms.map((rm, idx) => (
                    <g key={`${rm.code}-${idx}`}>
                      <rect
                        x={rm.x}
                        y={rm.z}
                        width={rm.width}
                        height={rm.depth}
                        fill={rm.color || '#1D4ED8'}
                        fillOpacity={0.22}
                        stroke={rm.color || '#38BDF8'}
                        strokeWidth={0.14}
                      />
                      <text
                        x={rm.x + rm.width / 2}
                        y={rm.z + rm.depth / 2 - 0.3}
                        textAnchor="middle"
                        fill="#FAFAFA"
                        fontSize={0.95}
                        fontWeight={600}
                      >
                        {rm.name}
                      </text>
                      <text
                        x={rm.x + rm.width / 2}
                        y={rm.z + rm.depth / 2 + 0.85}
                        textAnchor="middle"
                        fill="#A1A1AA"
                        fontSize={0.68}
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {rm.code} · {rm.width.toFixed(1)}×{rm.depth.toFixed(1)}m
                        {rm.pressurePa !== undefined ? ` · +${rm.pressurePa}Pa` : ''}
                      </text>
                    </g>
                  ))}

                  {/* Flow Routes */}
                  {plan.flows.map((flw, idx) => {
                    const pts = flw.points.map((p) => `${p.x},${p.z}`).join(' ');
                    const stroke =
                      flw.flowType === 'waste'
                        ? '#EF4444'
                        : flw.flowType === 'material'
                          ? '#3B82F6'
                          : '#10B981';
                    return (
                      <polyline
                        key={`flw-${idx}`}
                        points={pts}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={0.22}
                        strokeDasharray="0.7 0.45"
                        opacity={0.9}
                      />
                    );
                  })}

                  {/* Equipment Footprints */}
                  {plan.equipment.map((eq, idx) => (
                    <g key={`eq-${idx}`} transform={`translate(${eq.x}, ${eq.z})`}>
                      <rect
                        x={-0.75}
                        y={-0.55}
                        width={1.5}
                        height={1.1}
                        rx={0.18}
                        fill="#18181B"
                        stroke="#10B981"
                        strokeWidth={0.12}
                      />
                      <circle cx={0} cy={0} r={0.18} fill="#10B981" />
                      <title>{eq.name}</title>
                    </g>
                  ))}
                </svg>
              )}
            </div>

            {/* AI Summary & Optimization Notes Footer */}
            {plan && (
              <div className="px-4 py-3 border-t border-zinc-800 bg-[#111114] space-y-2 shrink-0">
                <p className="text-xs text-zinc-300 leading-relaxed">{plan.summary}</p>
                {plan.optimizationNotes && plan.optimizationNotes.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-emerald-400">
                    {plan.optimizationNotes.slice(0, 4).map((note, i) => (
                      <span key={i}>• {note}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Action Footer */}
        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0D0D10] flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Saving commits rooms, walls, interlocked doors, 3D equipment, and flow routes directly into your 2D/3D model (Undoable via Ctrl+Z).
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowAIPlannerModal(false)}
              className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveToParent}
              disabled={!plan}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-40 whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              Save &amp; Apply to Parent
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
