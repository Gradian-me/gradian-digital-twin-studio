import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Box,
  CalendarClock,
  CheckCircle2,
  Compass,
  Download,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useGmpStore } from '../store/useGmpStore';
import { todayIso } from '../data/gmpDemoData';
import type { AssignmentStatus, ShiftWindow } from '../types/gmp';
import type { LiveSensorSnapshot, SensorDefinition } from '../types/telemetry';
import type { Room } from '../types/twin';

const SHIFTS: { id: ShiftWindow; label: string; shortLabel: string; hours: string }[] = [
  { id: 'morning-06-14', label: 'Morning (06:00–14:00)', shortLabel: 'Morning', hours: '06:00–14:00' },
  { id: 'swing-14-22', label: 'Swing (14:00–22:00)', shortLabel: 'Swing', hours: '14:00–22:00' },
  { id: 'night-22-06', label: 'Night (22:00–06:00)', shortLabel: 'Night', hours: '22:00–06:00' },
];

type TelemetryGateStatus = 'nominal' | 'warning' | 'alarm';

interface ZoneTelemetryProfile {
  room: Room;
  floorCode: string;
  floorName: string;
  buildingCode: string;
  status: TelemetryGateStatus;
  tempC: number;
  humidityPct: number;
  pressurePa: number;
  sensors: { def: SensorDefinition; reading?: LiveSensorSnapshot }[];
  alarmSensors: { def: SensorDefinition; reading: LiveSensorSnapshot }[];
  warningSensors: { def: SensorDefinition; reading: LiveSensorSnapshot }[];
  summaryText: string;
  residentAssetCount: number;
}

const STATUS_META: Record<
  TelemetryGateStatus,
  { label: string; textCls: string; subtleBg: string }
> = {
  nominal: {
    label: 'Cleared',
    textCls: 'text-emerald-600 dark:text-emerald-400',
    subtleBg: 'bg-emerald-500/8 border-emerald-500/30',
  },
  warning: {
    label: 'Drift',
    textCls: 'text-amber-600 dark:text-amber-400',
    subtleBg: 'bg-amber-500/8 border-amber-500/30',
  },
  alarm: {
    label: 'Hold',
    textCls: 'text-rose-600 dark:text-rose-400',
    subtleBg: 'bg-rose-500/10 border-rose-500/35',
  },
};

const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, { label: string; cls: string }> = {
  scheduled: { label: 'Scheduled', cls: 'text-violet-600 dark:text-violet-400' },
  active: { label: 'Active', cls: 'text-emerald-600 dark:text-emerald-400' },
  'telemetry-hold': { label: 'Telemetry Hold', cls: 'text-rose-600 dark:text-rose-400' },
  completed: { label: 'Completed', cls: 'text-zinc-500 dark:text-zinc-400' },
};

export const ResourceSchedulingModal: React.FC = () => {
  const scene = useTwinStore((s) => s.scene);
  const theme = useTwinStore((s) => s.theme);
  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const selectEntity = useTwinStore((s) => s.selectEntity);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const flyToCamera = useTwinStore((s) => s.flyToCamera);
  const showToast = useTwinStore((s) => s.showToast);

  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const streamRunning = useTelemetryStore((s) => s.streamRunning);
  const openDashboard = useTelemetryStore((s) => s.openDashboard);

  const showModal = useGmpStore((s) => s.showResourceSchedulingModal);
  const focusedScheduleRoomId = useGmpStore((s) => s.focusedScheduleRoomId);
  const closeModal = useGmpStore((s) => s.closeResourceSchedulingModal);
  const personnel = useGmpStore((s) => s.personnel);
  const complianceByAssetId = useGmpStore((s) => s.complianceByAssetId);
  const resourceAssignments = useGmpStore((s) => s.resourceAssignments);
  const assignResourceToZone = useGmpStore((s) => s.assignResourceToZone);
  const updateResourceAssignmentStatus = useGmpStore((s) => s.updateResourceAssignmentStatus);
  const removeResourceAssignment = useGmpStore((s) => s.removeResourceAssignment);
  const autoBalanceAssignmentsForTelemetry = useGmpStore(
    (s) => s.autoBalanceAssignmentsForTelemetry
  );

  const isDark = theme === 'dark';

  const [selectedDate, setSelectedDate] = useState<string>(todayIso());
  const [selectedShift, setSelectedShift] = useState<ShiftWindow>('morning-06-14');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [zoneSearch, setZoneSearch] = useState('');
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [telemetryFilter, setTelemetryFilter] = useState<'all' | TelemetryGateStatus>('all');

  // Right pane controls
  const [workspaceTab, setWorkspaceTab] = useState<'dispatch' | 'matrix'>('dispatch');
  const [mobilePane, setMobilePane] = useState<'zones' | 'detail'>('zones');
  const [assignKind, setAssignKind] = useState<'personnel' | 'equipment'>('personnel');
  const [resourceSearch, setResourceSearch] = useState('');
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [relocateEquipment, setRelocateEquipment] = useState(false);
  const [matrixKindFilter, setMatrixKindFilter] = useState<'all' | 'personnel' | 'equipment'>('all');

  // Compute live telemetry profile for every facility zone
  const zoneProfiles = useMemo<ZoneTelemetryProfile[]>(() => {
    const floorMap = new Map(scene.floors.map((f) => [f.id, f]));
    const bldgMap = new Map(scene.buildings.map((b) => [b.id, b]));
    const assetsByRoom = new Map<string, string[]>();
    scene.assets.forEach((a) => {
      if (!a.roomId) return;
      const arr = assetsByRoom.get(a.roomId) ?? [];
      arr.push(a.id);
      assetsByRoom.set(a.roomId, arr);
    });

    return scene.rooms.map((room) => {
      const fl = floorMap.get(room.floorId);
      const bldg = fl ? bldgMap.get(fl.buildingId) : undefined;
      const roomAssetIds = new Set(assetsByRoom.get(room.id) ?? []);

      const matchedSensors = sensors
        .filter(
          (s) =>
            (s.targetKind === 'room' && s.targetId === room.id) ||
            (s.targetKind === 'asset' && roomAssetIds.has(s.targetId))
        )
        .map((def) => ({ def, reading: readings[def.id] }));

      const alarmSensors = matchedSensors.filter(
        (x): x is { def: SensorDefinition; reading: LiveSensorSnapshot } =>
          x.reading?.status === 'alarm'
      );
      const warningSensors = matchedSensors.filter(
        (x): x is { def: SensorDefinition; reading: LiveSensorSnapshot } =>
          x.reading?.status === 'warning'
      );

      const tempSensor = matchedSensors.find(
        (x) => x.def.targetKind === 'room' && x.def.metric === 'temperature'
      );
      const rhSensor = matchedSensors.find(
        (x) => x.def.targetKind === 'room' && x.def.metric === 'humidity'
      );
      const dpSensor = matchedSensors.find(
        (x) => x.def.targetKind === 'room' && x.def.metric === 'pressure'
      );

      const tempC = tempSensor?.reading?.value ?? room.environmental.temperatureC;
      const humidityPct = rhSensor?.reading?.value ?? room.environmental.humidityPct;
      const pressurePa = dpSensor?.reading?.value ?? room.environmental.pressurePa;

      let status: TelemetryGateStatus = 'nominal';
      if (alarmSensors.length > 0 || room.complianceStatus === 'deviation') {
        status = 'alarm';
      } else if (warningSensors.length > 0 || room.complianceStatus === 'review-due') {
        status = 'warning';
      }

      const summaryText = `${tempC.toFixed(1)}°C · ${humidityPct.toFixed(0)}% RH · ${
        pressurePa >= 0 ? '+' : ''
      }${pressurePa.toFixed(0)} Pa`;

      return {
        room,
        floorCode: fl?.code ?? 'FL',
        floorName: fl?.name ?? 'Floor',
        buildingCode: bldg?.code ?? 'BLDG',
        status,
        tempC,
        humidityPct,
        pressurePa,
        sensors: matchedSensors,
        alarmSensors,
        warningSensors,
        summaryText,
        residentAssetCount: roomAssetIds.size,
      };
    });
  }, [scene.rooms, scene.floors, scene.buildings, scene.assets, sensors, readings]);

  const zoneById = useMemo(
    () => new Map(zoneProfiles.map((zp) => [zp.room.id, zp])),
    [zoneProfiles]
  );

  // Sync focused room when modal opens
  useEffect(() => {
    if (!showModal) return;
    if (focusedScheduleRoomId && zoneById.has(focusedScheduleRoomId)) {
      setSelectedRoomId(focusedScheduleRoomId);
      setMobilePane('detail');
    } else if (!selectedRoomId || !zoneById.has(selectedRoomId)) {
      const firstId = zoneProfiles[0]?.room.id ?? '';
      setSelectedRoomId(firstId);
      setMobilePane('zones');
    }
  }, [showModal, focusedScheduleRoomId, zoneById, zoneProfiles, selectedRoomId]);

  // Reset override fields when switching rooms
  useEffect(() => {
    setOverrideEnabled(false);
    setOverrideReason('');
    setSelectedResourceId('');
  }, [selectedRoomId, assignKind]);

  const activeZone = useMemo(
    () => zoneById.get(selectedRoomId) ?? zoneProfiles[0] ?? null,
    [zoneById, selectedRoomId, zoneProfiles]
  );

  const filteredZones = useMemo(() => {
    const q = zoneSearch.trim().toLowerCase();
    return zoneProfiles.filter((zp) => {
      if (floorFilter !== 'all' && zp.room.floorId !== floorFilter) return false;
      if (telemetryFilter !== 'all' && zp.status !== telemetryFilter) return false;
      if (!q) return true;
      return (
        zp.room.code.toLowerCase().includes(q) ||
        zp.room.name.toLowerCase().includes(q) ||
        zp.room.environmental.cleanroomGrade.toLowerCase().includes(q) ||
        zp.floorCode.toLowerCase().includes(q)
      );
    });
  }, [zoneProfiles, zoneSearch, floorFilter, telemetryFilter]);

  const shiftAssignments = useMemo(
    () =>
      resourceAssignments.filter(
        (a) => a.date === selectedDate && a.shift === selectedShift
      ),
    [resourceAssignments, selectedDate, selectedShift]
  );

  const assignmentsByRoomId = useMemo(() => {
    const map = new Map<string, typeof shiftAssignments>();
    shiftAssignments.forEach((a) => {
      const arr = map.get(a.roomId) ?? [];
      arr.push(a);
      map.set(a.roomId, arr);
    });
    return map;
  }, [shiftAssignments]);

  const activeZoneAssignments = useMemo(
    () => (activeZone ? assignmentsByRoomId.get(activeZone.room.id) ?? [] : []),
    [activeZone, assignmentsByRoomId]
  );

  const dayAssignments = useMemo(
    () =>
      resourceAssignments.filter((a) => {
        if (a.date !== selectedDate) return false;
        if (matrixKindFilter !== 'all' && a.resourceKind !== matrixKindFilter) return false;
        return true;
      }),
    [resourceAssignments, selectedDate, matrixKindFilter]
  );

  // Conflict lookup for selected date + shift
  const shiftConflictByResourceKey = useMemo(() => {
    const map = new Map<string, { roomId: string; roomCode: string; roomName: string }>();
    shiftAssignments.forEach((a) => {
      if (a.status === 'completed') return;
      map.set(`${a.resourceKind}:${a.resourceId}`, {
        roomId: a.roomId,
        roomCode: a.roomCode,
        roomName: a.roomName,
      });
    });
    return map;
  }, [shiftAssignments]);

  // Filtered candidate personnel & equipment
  const candidatePersonnel = useMemo(() => {
    const q = resourceSearch.trim().toLowerCase();
    return personnel.filter((p) => {
      if (!p.active) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        p.badgeId.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q)
      );
    });
  }, [personnel, resourceSearch]);

  const candidateAssets = useMemo(() => {
    const q = resourceSearch.trim().toLowerCase();
    return scene.assets.filter((a) => {
      if (a.hidden) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.assetId.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
      );
    });
  }, [scene.assets, resourceSearch]);

  // Executive KPIs for current date + shift
  const kpis = useMemo(() => {
    const clearedZones = zoneProfiles.filter((z) => z.status === 'nominal').length;
    const holdZones = zoneProfiles.filter((z) => z.status === 'alarm').length;
    const staffCount = shiftAssignments.filter((a) => a.resourceKind === 'personnel').length;
    const equipCount = shiftAssignments.filter((a) => a.resourceKind === 'equipment').length;
    return { clearedZones, holdZones, totalZones: zoneProfiles.length, staffCount, equipCount };
  }, [zoneProfiles, shiftAssignments]);

  if (!showModal) return null;

  const handleSyncTelemetryGates = () => {
    const telemetryMap: Record<string, { status: TelemetryGateStatus; summary: string }> = {};
    zoneProfiles.forEach((zp) => {
      telemetryMap[zp.room.id] = { status: zp.status, summary: zp.summaryText };
    });
    const { held, resumed } = autoBalanceAssignmentsForTelemetry(telemetryMap);
    if (held === 0 && resumed === 0) {
      showToast('All scheduled assignments align with live zone telemetry gates', 'info');
    } else {
      showToast(
        `Telemetry gate sync complete: ${held} placed on hold, ${resumed} cleared to resume`,
        held > 0 ? 'warning' : 'success'
      );
    }
  };

  const handleAssignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeZone || !selectedResourceId) return;

    const isAlarmZone = activeZone.status === 'alarm';
    if (isAlarmZone && (!overrideEnabled || !overrideReason.trim())) {
      showToast(
        'Zone is under Telemetry Hold — enable Remediation Override and state justification',
        'error'
      );
      return;
    }

    const existingConflict = shiftConflictByResourceKey.get(`${assignKind}:${selectedResourceId}`);
    if (existingConflict && existingConflict.roomId === activeZone.room.id) {
      showToast('This resource is already assigned to this zone on the selected shift', 'warning');
      return;
    }

    if (assignKind === 'personnel') {
      const tech = personnel.find((p) => p.id === selectedResourceId);
      if (!tech) return;
      assignResourceToZone({
        roomId: activeZone.room.id,
        roomCode: activeZone.room.code,
        roomName: activeZone.room.name,
        floorId: activeZone.room.floorId,
        date: selectedDate,
        shift: selectedShift,
        resourceKind: 'personnel',
        resourceId: tech.id,
        resourceCode: tech.badgeId,
        resourceName: tech.name,
        roleOrCategory: tech.role,
        status: isAlarmZone ? 'active' : 'scheduled',
        telemetryGatePassed: !isAlarmZone,
        telemetrySnapshotNote: activeZone.summaryText,
        overrideReason: isAlarmZone ? overrideReason.trim() : undefined,
        notes: shiftNotes.trim() || undefined,
        assignedBy: 'Operations Manager',
      });
    } else {
      const asset = scene.assets.find((a) => a.id === selectedResourceId);
      if (!asset) return;
      assignResourceToZone(
        {
          roomId: activeZone.room.id,
          roomCode: activeZone.room.code,
          roomName: activeZone.room.name,
          floorId: activeZone.room.floorId,
          date: selectedDate,
          shift: selectedShift,
          resourceKind: 'equipment',
          resourceId: asset.id,
          resourceCode: asset.assetId,
          resourceName: asset.name,
          roleOrCategory: asset.category,
          status: isAlarmZone ? 'active' : 'scheduled',
          telemetryGatePassed: !isAlarmZone,
          telemetrySnapshotNote: activeZone.summaryText,
          overrideReason: isAlarmZone ? overrideReason.trim() : undefined,
          notes: shiftNotes.trim() || undefined,
          assignedBy: 'Operations Manager',
        },
        relocateEquipment
      );
    }

    setSelectedResourceId('');
    setShiftNotes('');
    setOverrideEnabled(false);
    setOverrideReason('');
    setRelocateEquipment(false);
  };

  const handleLocateZoneIn3D = (room: Room) => {
    setActiveFloor(room.floorId);
    selectEntity({ type: 'room', id: room.id });
    setViewMode('3d-perspective');
    const fl = scene.floors.find((f) => f.id === room.floorId);
    const elev = fl?.elevation ?? 0;
    const cx = room.x + room.width * 0.5;
    const cz = room.z + room.depth * 0.5;
    flyToCamera([cx + 6.5, elev + 6.2, cz + 6.8], [cx, elev + 1.0, cz]);
    closeModal();
  };

  const handleExportCsv = () => {
    const header = [
      'Date',
      'Shift',
      'Zone Code',
      'Zone Name',
      'Resource Type',
      'Code',
      'Resource Name',
      'Role / Category',
      'Status',
      'Telemetry Gate',
      'Telemetry Snapshot',
      'Override Reason',
      'Notes',
    ];
    const escapeCsv = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
    const rows = dayAssignments.map((a) =>
      [
        a.date,
        SHIFTS.find((s) => s.id === a.shift)?.label ?? a.shift,
        a.roomCode,
        a.roomName,
        a.resourceKind,
        a.resourceCode,
        a.resourceName,
        a.roleOrCategory,
        a.status,
        a.telemetryGatePassed ? 'PASSED' : 'OVERRIDE / HOLD',
        a.telemetrySnapshotNote,
        a.overrideReason ?? '',
        a.notes ?? '',
      ]
        .map(escapeCsv)
        .join(',')
    );
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resource-schedule-${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${dayAssignments.length} scheduled assignments to CSV`, 'success');
  };

  const isSelectedZoneAlarm = activeZone?.status === 'alarm';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Resource Scheduling and Zone Dispatch"
    >
      <div
        className={`w-full max-w-7xl h-[100dvh] sm:h-[92vh] flex flex-col rounded-none sm:rounded-3xl border-0 sm:border shadow-2xl overflow-hidden ${
          isDark
            ? 'bg-[#111116] border-zinc-800 text-zinc-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Single-Row Non-Wrapping Header Bar */}
        <div
          className={`flex items-center justify-between gap-2 px-3 sm:px-5 py-2.5 sm:py-3 border-b shrink-0 ${
            isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={closeModal}
              className={`flex items-center gap-1.5 rounded-xl px-2.5 sm:px-3 py-1.5 text-xs font-semibold border transition cursor-pointer shrink-0 ${
                isDark
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center text-white shrink-0">
              <CalendarClock className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xs sm:text-sm font-bold truncate">
                Resource Scheduling &amp; Zone Dispatch
              </h2>
              <p
                className={`hidden sm:block text-[11px] truncate ${
                  isDark ? 'text-zinc-400' : 'text-slate-500'
                }`}
              >
                Assign certified personnel and GMP equipment to facility zones gated by live telemetry
                {streamRunning ? ' · Live stream 1.5s' : ' · Telemetry paused'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleSyncTelemetryGates}
              className={`hidden md:flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition cursor-pointer whitespace-nowrap shrink-0 ${
                isDark
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-violet-500 hover:text-violet-300'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-violet-500 hover:text-violet-700'
              }`}
              title="Re-evaluate all active assignments against live room telemetry"
            >
              <RefreshCw className="w-3.5 h-3.5 text-violet-500" />
              <span>Sync Telemetry Gates</span>
            </button>
            <button
              type="button"
              onClick={closeModal}
              aria-label="Close"
              className={`p-1.5 rounded-xl transition cursor-pointer shrink-0 ${
                isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Control & Executive Summary Strip */}
        <div
          className={`px-3 sm:px-5 py-2.5 border-b flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 shrink-0 ${
            isDark ? 'bg-[#13131A] border-zinc-800' : 'bg-white border-slate-200'
          }`}
        >
          {/* Date + Shift Window + Primary Mode Switch */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 lg:pb-0">
            <input
              type="date"
              aria-label="Schedule Date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className={`h-8 rounded-lg border px-2.5 text-xs font-mono tabular-nums shrink-0 ${
                isDark
                  ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100'
                  : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            />

            <div
              className={`flex items-center gap-0.5 p-0.5 rounded-lg border shrink-0 ${
                isDark ? 'bg-[#0E0E13] border-zinc-800' : 'bg-slate-100 border-slate-200'
              }`}
            >
              {SHIFTS.map((sh) => (
                <button
                  key={sh.id}
                  type="button"
                  onClick={() => setSelectedShift(sh.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                    selectedShift === sh.id
                      ? 'bg-violet-600 text-white'
                      : isDark
                        ? 'text-zinc-400 hover:text-zinc-100'
                        : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sh.shortLabel} <span className="hidden sm:inline opacity-75 font-mono text-[10px]">{sh.hours}</span>
                </button>
              ))}
            </div>

            <div
              className={`flex items-center gap-0.5 p-0.5 rounded-lg border shrink-0 ${
                isDark ? 'bg-[#0E0E13] border-zinc-800' : 'bg-slate-100 border-slate-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setWorkspaceTab('dispatch')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                  workspaceTab === 'dispatch'
                    ? isDark
                      ? 'bg-zinc-800 text-white'
                      : 'bg-white text-slate-900 shadow-xs'
                    : isDark
                      ? 'text-zinc-400 hover:text-zinc-200'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Zone Dispatch
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceTab('matrix')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                  workspaceTab === 'matrix'
                    ? isDark
                      ? 'bg-zinc-800 text-white'
                      : 'bg-white text-slate-900 shadow-xs'
                    : isDark
                      ? 'text-zinc-400 hover:text-zinc-200'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Shift Matrix ({dayAssignments.length})
              </button>
            </div>
          </div>

          {/* Unboxed Tabular KPI Summary Row (Zero Pill Clutter) */}
          <div className="flex items-center gap-4 text-xs font-mono tabular-nums overflow-x-auto">
            <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
              <span className={isDark ? 'text-zinc-400' : 'text-slate-500'}>Cleared</span>
              <span className="font-bold text-emerald-500">
                {kpis.clearedZones}/{kpis.totalZones}
              </span>
            </div>
            <span className="text-zinc-600" aria-hidden="true">
              ·
            </span>
            <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
              <span className={isDark ? 'text-zinc-400' : 'text-slate-500'}>Telemetry Hold</span>
              <span className={`font-bold ${kpis.holdZones > 0 ? 'text-rose-500' : 'text-zinc-400'}`}>
                {kpis.holdZones}
              </span>
            </div>
            <span className="text-zinc-600" aria-hidden="true">
              ·
            </span>
            <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
              <span className={isDark ? 'text-zinc-400' : 'text-slate-500'}>Staff</span>
              <span className="font-bold">{kpis.staffCount}</span>
            </div>
            <span className="text-zinc-600" aria-hidden="true">
              ·
            </span>
            <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
              <span className={isDark ? 'text-zinc-400' : 'text-slate-500'}>Equipment</span>
              <span className="font-bold">{kpis.equipCount}</span>
            </div>
          </div>
        </div>

        {/* ==================== VIEW 1: LIVE ZONE TELEMETRY & DISPATCH ==================== */}
        {workspaceTab === 'dispatch' && (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col lg:grid lg:grid-cols-12">
            {/* LEFT COLUMN: Facility Zones Directory */}
            <div
              className={`${
                mobilePane === 'detail' ? 'hidden lg:flex' : 'flex'
              } flex-1 lg:flex-none min-h-0 lg:col-span-4 lg:border-r flex-col overflow-hidden ${
                isDark ? 'border-zinc-800 bg-[#14141A]' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="p-3 border-b border-zinc-800/40 space-y-2 shrink-0">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={zoneSearch}
                    onChange={(e) => setZoneSearch(e.target.value)}
                    placeholder="Filter zones by code, name, ISO grade..."
                    className={`w-full rounded-xl border pl-8 pr-3 py-1.5 text-xs outline-none ${
                      isDark
                        ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100 focus:border-violet-500'
                        : 'bg-white border-slate-300 text-slate-900 focus:border-violet-500'
                    }`}
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <select
                    aria-label="Filter by floor"
                    value={floorFilter}
                    onChange={(e) => setFloorFilter(e.target.value)}
                    className={`flex-1 rounded-lg border px-2 py-1 text-[11px] cursor-pointer ${
                      isDark
                        ? 'bg-[#0E0E13] border-zinc-700 text-zinc-200'
                        : 'bg-white border-slate-300 text-slate-800'
                    }`}
                  >
                    <option value="all">All Floors ({scene.floors.length})</option>
                    {scene.floors.map((fl) => (
                      <option key={fl.id} value={fl.id}>
                        {fl.code} — {fl.name}
                      </option>
                    ))}
                  </select>

                  <div
                    className={`flex items-center gap-0.5 p-0.5 rounded-lg border shrink-0 ${
                      isDark ? 'bg-[#0E0E13] border-zinc-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    {(
                      [
                        { id: 'all', label: 'All' },
                        { id: 'nominal', label: 'Cleared' },
                        { id: 'warning', label: 'Drift' },
                        { id: 'alarm', label: 'Hold' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setTelemetryFilter(f.id)}
                        className={`px-2 py-0.5 rounded text-[10.5px] font-medium whitespace-nowrap cursor-pointer transition ${
                          telemetryFilter === f.id
                            ? 'bg-violet-600 text-white'
                            : isDark
                              ? 'text-zinc-400 hover:text-zinc-200'
                              : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                {filteredZones.length === 0 ? (
                  <div className="p-6 text-center text-xs text-zinc-500">
                    No facility zones match the active filters.
                  </div>
                ) : (
                  filteredZones.map((zp) => {
                    const isSelected = activeZone?.room.id === zp.room.id;
                    const zoneRoster = assignmentsByRoomId.get(zp.room.id) ?? [];
                    const staffCnt = zoneRoster.filter((a) => a.resourceKind === 'personnel').length;
                    const eqCnt = zoneRoster.filter((a) => a.resourceKind === 'equipment').length;
                    const meta = STATUS_META[zp.status];

                    return (
                      <button
                        key={zp.room.id}
                        type="button"
                        onClick={() => {
                          setSelectedRoomId(zp.room.id);
                          setMobilePane('detail');
                        }}
                        className={`w-full text-left px-3.5 py-3 transition cursor-pointer ${
                          isSelected
                            ? isDark
                              ? 'bg-violet-600/14'
                              : 'bg-violet-50'
                            : isDark
                              ? 'hover:bg-zinc-800/45'
                              : 'hover:bg-slate-100/80'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-xs font-bold text-violet-500 dark:text-violet-400 shrink-0">
                              {zp.room.code}
                            </span>
                            <span className="text-xs font-semibold truncate">{zp.room.name}</span>
                          </div>
                          <span
                            className={`text-[11px] font-semibold whitespace-nowrap shrink-0 ${meta.textCls}`}
                          >
                            {meta.label}
                          </span>
                        </div>

                        <div
                          className={`mt-1 flex items-center justify-between gap-2 text-[11px] ${
                            isDark ? 'text-zinc-400' : 'text-slate-500'
                          }`}
                        >
                          <span className="truncate">
                            {zp.floorCode} · {zp.room.environmental.cleanroomGrade}
                          </span>
                          <span className="font-mono tabular-nums shrink-0">
                            {staffCnt} staff · {eqCnt} eq
                          </span>
                        </div>

                        <div
                          className={`mt-1.5 font-mono tabular-nums text-[11px] ${
                            zp.status === 'alarm'
                              ? 'text-rose-500 dark:text-rose-400'
                              : zp.status === 'warning'
                                ? 'text-amber-600 dark:text-amber-400'
                                : isDark
                                  ? 'text-zinc-300'
                                  : 'text-slate-700'
                          }`}
                        >
                          {zp.summaryText}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: Selected Zone Telemetry + Active Shift Roster + Assign Form */}
            <div
              className={`${
                mobilePane === 'zones' ? 'hidden lg:block' : 'block'
              } flex-1 lg:flex-none min-h-0 lg:col-span-8 overflow-y-auto overscroll-contain touch-pan-y p-4 sm:p-5 space-y-5`}
            >
              {/* Mobile Back-to-Zones Header */}
              <div className="lg:hidden flex items-center justify-between pb-2.5 border-b border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setMobilePane('zones')}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold border cursor-pointer ${
                    isDark
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-200'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  All Zones
                </button>
                {activeZone && (
                  <span className="font-mono text-xs font-bold text-violet-500">
                    {activeZone.room.code}
                  </span>
                )}
              </div>

              {!activeZone ? (
                <div className="py-16 text-center text-sm text-zinc-500">
                  Select a facility zone to review live telemetry and schedule resources.
                </div>
              ) : (
                <>
                  {/* Zone Header + Quick Spatial & Telemetry Actions */}
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <span className="font-mono font-bold text-violet-500 dark:text-violet-400">
                          {activeZone.room.code}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{activeZone.buildingCode} / {activeZone.floorCode}</span>
                        <span aria-hidden="true">·</span>
                        <span>{activeZone.room.environmental.cleanroomGrade}</span>
                        <span aria-hidden="true">·</span>
                        <span className={`font-semibold ${STATUS_META[activeZone.status].textCls}`}>
                          Telemetry {STATUS_META[activeZone.status].label}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold tracking-tight mt-0.5">
                        {activeZone.room.name}
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono tabular-nums">
                        Area {(activeZone.room.width * activeZone.room.depth).toFixed(1)} m² ·{' '}
                        {activeZone.residentAssetCount} installed assets · {activeZone.sensors.length} live sensors
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLocateZoneIn3D(activeZone.room)}
                        className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition cursor-pointer whitespace-nowrap ${
                          isDark
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-violet-500'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-violet-500'
                        }`}
                      >
                        <Compass className="w-3.5 h-3.5 text-violet-500" />
                        Locate in 3D
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          closeModal();
                          openDashboard({ tab: 'trends', roomId: activeZone.room.id });
                        }}
                        className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition cursor-pointer whitespace-nowrap ${
                          isDark
                            ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-amber-500'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-amber-500'
                        }`}
                      >
                        <Activity className="w-3.5 h-3.5 text-amber-500" />
                        Live Trends
                      </button>
                    </div>
                  </div>

                  {/* Live Environmental & Equipment Telemetry Readout Table */}
                  <section className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                        Live Zone Telemetry Snapshot
                      </h4>
                      <span className="font-mono tabular-nums text-[11px] text-zinc-500">
                        {activeZone.summaryText}
                      </span>
                    </div>

                    <div
                      className={`rounded-xl border overflow-hidden ${
                        isDark ? 'border-zinc-800 bg-[#15151C]' : 'border-slate-200 bg-slate-50/70'
                      }`}
                    >
                      {activeZone.sensors.length === 0 ? (
                        <div className="grid grid-cols-3 divide-x divide-zinc-200 dark:divide-zinc-800 text-xs">
                          <div className="p-3">
                            <div className="text-[11px] text-zinc-500">Temperature</div>
                            <div className="font-mono tabular-nums text-sm font-bold mt-0.5">
                              {activeZone.tempC.toFixed(1)} °C
                            </div>
                          </div>
                          <div className="p-3">
                            <div className="text-[11px] text-zinc-500">Relative Humidity</div>
                            <div className="font-mono tabular-nums text-sm font-bold mt-0.5">
                              {activeZone.humidityPct.toFixed(0)} %RH
                            </div>
                          </div>
                          <div className="p-3">
                            <div className="text-[11px] text-zinc-500">Diff. Pressure</div>
                            <div className="font-mono tabular-nums text-sm font-bold mt-0.5">
                              {activeZone.pressurePa >= 0 ? '+' : ''}
                              {activeZone.pressurePa.toFixed(0)} Pa
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr
                                className={`border-b text-left text-[11px] ${
                                  isDark
                                    ? 'border-zinc-800 text-zinc-400'
                                    : 'border-slate-200 text-slate-500'
                                }`}
                              >
                                <th className="py-2 px-3 font-medium">Sensor Tag</th>
                                <th className="py-2 px-3 font-medium">Channel</th>
                                <th className="py-2 px-3 font-medium text-right">Live Value</th>
                                <th className="py-2 px-3 font-medium text-right">Safe Envelope</th>
                                <th className="py-2 px-3 font-medium text-right">Gate State</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                              {activeZone.sensors.slice(0, 6).map(({ def, reading }) => {
                                const val = reading?.value ?? def.nominal;
                                const st = reading?.status ?? 'nominal';
                                const stLabel =
                                  st === 'alarm'
                                    ? 'Alarm'
                                    : st === 'warning'
                                      ? 'Warning'
                                      : 'Nominal';
                                const stCls =
                                  st === 'alarm'
                                    ? 'text-rose-500 font-bold'
                                    : st === 'warning'
                                      ? 'text-amber-500 font-semibold'
                                      : 'text-emerald-500 font-medium';
                                return (
                                  <tr key={def.id} className="h-9">
                                    <td className="px-3 font-mono text-[11px] text-zinc-400 whitespace-nowrap">
                                      {def.tag}
                                    </td>
                                    <td className="px-3 font-medium truncate max-w-[200px]">
                                      {def.name}
                                    </td>
                                    <td className="px-3 text-right font-mono tabular-nums font-bold whitespace-nowrap">
                                      {val.toFixed(def.precision)} {def.unit}
                                    </td>
                                    <td className="px-3 text-right font-mono tabular-nums text-zinc-500 whitespace-nowrap">
                                      {def.warnLow}–{def.warnHigh} {def.unit}
                                    </td>
                                    <td className={`px-3 text-right whitespace-nowrap ${stCls}`}>
                                      {stLabel}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Environmental Hold Alert Banner */}
                    {isSelectedZoneAlarm && (
                      <div className="rounded-xl border border-rose-500/40 bg-rose-500/8 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 text-xs">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="font-semibold text-rose-600 dark:text-rose-300">
                              Environmental Telemetry Hold Active
                            </div>
                            <p className="text-zinc-600 dark:text-zinc-300 mt-0.5">
                              {activeZone.alarmSensors.length > 0
                                ? activeZone.alarmSensors
                                    .map(
                                      (s) =>
                                        `${s.def.tag} reading ${s.reading.value.toFixed(s.def.precision)} ${s.def.unit}`
                                    )
                                    .join(' · ')
                                : 'Zone has an active GMP compliance deviation.'}{' '}
                              Routine batch staffing is blocked unless Remediation Override is logged.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Current Shift Roster for Selected Zone */}
                  <section className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                        Scheduled Roster · {selectedDate} ·{' '}
                        {SHIFTS.find((s) => s.id === selectedShift)?.shortLabel} Shift (
                        {activeZoneAssignments.length})
                      </h4>
                    </div>

                    {activeZoneAssignments.length === 0 ? (
                      <div
                        className={`rounded-xl border border-dashed p-5 text-center text-xs ${
                          isDark
                            ? 'border-zinc-800 text-zinc-400'
                            : 'border-slate-300 text-slate-500'
                        }`}
                      >
                        No personnel or equipment assigned to {activeZone.room.code} for this shift yet.
                        Use the dispatch form below to schedule resources.
                      </div>
                    ) : (
                      <div
                        className={`rounded-xl border overflow-hidden divide-y ${
                          isDark
                            ? 'border-zinc-800 divide-zinc-800/80 bg-[#15151C]'
                            : 'border-slate-200 divide-slate-200 bg-white'
                        }`}
                      >
                        {activeZoneAssignments.map((item) => {
                          const stMeta = ASSIGNMENT_STATUS_LABELS[item.status];
                          return (
                            <div
                              key={item.id}
                              className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-xs">
                                  {item.resourceKind === 'personnel' ? (
                                    <Users className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                                  ) : (
                                    <Box className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  )}
                                  <span className="font-mono font-bold text-zinc-400 shrink-0">
                                    {item.resourceCode}
                                  </span>
                                  <span className="font-semibold truncate">{item.resourceName}</span>
                                  <span aria-hidden="true" className="text-zinc-500">
                                    ·
                                  </span>
                                  <span className="text-zinc-500 dark:text-zinc-400 truncate">
                                    {item.roleOrCategory}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                  <span className={`font-semibold ${stMeta.cls}`}>
                                    {stMeta.label}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    Gate: {item.telemetrySnapshotNote}
                                  </span>
                                  {item.overrideReason && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-amber-500">
                                        Override: {item.overrideReason}
                                      </span>
                                    </>
                                  )}
                                  {item.notes && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>{item.notes}</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <select
                                  aria-label={`Status for ${item.resourceName}`}
                                  value={item.status}
                                  onChange={(e) =>
                                    updateResourceAssignmentStatus(
                                      item.id,
                                      e.target.value as AssignmentStatus
                                    )
                                  }
                                  className={`rounded-lg border px-2 py-1 text-[11px] font-medium cursor-pointer ${
                                    isDark
                                      ? 'bg-[#0E0E13] border-zinc-700 text-zinc-200'
                                      : 'bg-slate-50 border-slate-300 text-slate-800'
                                  }`}
                                >
                                  <option value="scheduled">Scheduled</option>
                                  <option value="active">Active</option>
                                  <option value="telemetry-hold">Telemetry Hold</option>
                                  <option value="completed">Completed</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => removeResourceAssignment(item.id)}
                                  className={`p-1.5 rounded-lg transition cursor-pointer ${
                                    isDark
                                      ? 'text-zinc-400 hover:bg-rose-500/15 hover:text-rose-400'
                                      : 'text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                                  }`}
                                  title="Remove assignment"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* Assign Personnel or Equipment Form */}
                  <section
                    className={`rounded-2xl border p-4 space-y-3.5 ${
                      isDark ? 'border-zinc-800 bg-[#15151C]' : 'border-slate-200 bg-slate-50/70'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold">
                          Assign Resource to {activeZone.room.code}
                        </h4>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          Conflict detection and GMP compliance checks run automatically before dispatch.
                        </p>
                      </div>

                      <div
                        className={`flex items-center gap-0.5 p-0.5 rounded-lg border self-start sm:self-auto ${
                          isDark ? 'bg-[#0E0E13] border-zinc-800' : 'bg-white border-slate-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setAssignKind('personnel')}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                            assignKind === 'personnel'
                              ? 'bg-violet-600 text-white'
                              : isDark
                                ? 'text-zinc-400 hover:text-zinc-200'
                                : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          Personnel
                        </button>
                        <button
                          type="button"
                          onClick={() => setAssignKind('equipment')}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                            assignKind === 'equipment'
                              ? 'bg-violet-600 text-white'
                              : isDark
                                ? 'text-zinc-400 hover:text-zinc-200'
                                : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Box className="w-3.5 h-3.5" />
                          Equipment
                        </button>
                      </div>
                    </div>

                    <form onSubmit={handleAssignSubmit} className="space-y-3">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input
                          value={resourceSearch}
                          onChange={(e) => setResourceSearch(e.target.value)}
                          placeholder={
                            assignKind === 'personnel'
                              ? 'Search technicians by name, role, badge ID...'
                              : 'Search equipment by tag, name, category...'
                          }
                          className={`w-full rounded-xl border pl-8 pr-3 py-1.5 text-xs outline-none ${
                            isDark
                              ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100 focus:border-violet-500'
                              : 'bg-white border-slate-300 text-slate-900 focus:border-violet-500'
                          }`}
                        />
                      </div>

                      {/* Candidate Selection List */}
                      <div
                        className={`max-h-52 overflow-y-auto rounded-xl border divide-y ${
                          isDark
                            ? 'border-zinc-800 divide-zinc-800/70 bg-[#101016]'
                            : 'border-slate-200 divide-slate-200 bg-white'
                        }`}
                      >
                        {assignKind === 'personnel' ? (
                          candidatePersonnel.length === 0 ? (
                            <div className="p-4 text-center text-xs text-zinc-500">
                              No matching active personnel found.
                            </div>
                          ) : (
                            candidatePersonnel.map((tech) => {
                              const conflict = shiftConflictByResourceKey.get(
                                `personnel:${tech.id}`
                              );
                              const alreadyHere = conflict?.roomId === activeZone.room.id;
                              const isPicked = selectedResourceId === tech.id;
                              return (
                                <button
                                  key={tech.id}
                                  type="button"
                                  disabled={alreadyHere}
                                  onClick={() => setSelectedResourceId(tech.id)}
                                  className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs transition ${
                                    alreadyHere
                                      ? 'opacity-45 cursor-not-allowed'
                                      : isPicked
                                        ? isDark
                                          ? 'bg-violet-600/20 cursor-pointer'
                                          : 'bg-violet-50 cursor-pointer'
                                        : isDark
                                          ? 'hover:bg-zinc-800/50 cursor-pointer'
                                          : 'hover:bg-slate-50 cursor-pointer'
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-[11px] font-bold text-violet-500">
                                        {tech.badgeId}
                                      </span>
                                      <span className="font-semibold truncate">{tech.name}</span>
                                    </div>
                                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                                      {tech.role} · {tech.department} · Cert exp {tech.certExpiry}
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0 text-[11px]">
                                    {alreadyHere ? (
                                      <span className="text-emerald-500 font-semibold">
                                        Assigned here
                                      </span>
                                    ) : conflict ? (
                                      <span className="text-amber-500 font-medium">
                                        In {conflict.roomCode}
                                      </span>
                                    ) : (
                                      <span className="text-zinc-400">Available</span>
                                    )}
                                  </div>
                                </button>
                              );
                            })
                          )
                        ) : candidateAssets.length === 0 ? (
                          <div className="p-4 text-center text-xs text-zinc-500">
                            No matching facility equipment found.
                          </div>
                        ) : (
                          candidateAssets.slice(0, 40).map((asset) => {
                            const conflict = shiftConflictByResourceKey.get(
                              `equipment:${asset.id}`
                            );
                            const alreadyHere = conflict?.roomId === activeZone.room.id;
                            const isPicked = selectedResourceId === asset.id;
                            const comp = complianceByAssetId[asset.id];
                            const overdue =
                              comp?.calibration.status === 'overdue' ||
                              comp?.qualification.status === 'overdue' ||
                              comp?.maintenance.status === 'overdue';
                            const currentRoom = scene.rooms.find((r) => r.id === asset.roomId);

                            return (
                              <button
                                key={asset.id}
                                type="button"
                                disabled={alreadyHere}
                                onClick={() => setSelectedResourceId(asset.id)}
                                className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs transition ${
                                  alreadyHere
                                    ? 'opacity-45 cursor-not-allowed'
                                    : isPicked
                                      ? isDark
                                        ? 'bg-violet-600/20 cursor-pointer'
                                        : 'bg-violet-50 cursor-pointer'
                                      : isDark
                                        ? 'hover:bg-zinc-800/50 cursor-pointer'
                                        : 'hover:bg-slate-50 cursor-pointer'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-[11px] font-bold text-amber-500">
                                      {asset.assetId}
                                    </span>
                                    <span className="font-semibold truncate">{asset.name}</span>
                                  </div>
                                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                                    {asset.category} · Located in {currentRoom?.code ?? 'Unassigned'}
                                  </div>
                                </div>
                                <div className="text-right shrink-0 text-[11px]">
                                  {alreadyHere ? (
                                    <span className="text-emerald-500 font-semibold">
                                      Assigned here
                                    </span>
                                  ) : overdue ? (
                                    <span className="text-rose-500 font-semibold">
                                      GMP Overdue
                                    </span>
                                  ) : conflict ? (
                                    <span className="text-amber-500 font-medium">
                                      Scheduled {conflict.roomCode}
                                    </span>
                                  ) : (
                                    <span className="text-emerald-500">Compliant</span>
                                  )}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>

                      {/* Optional Relocate Checkbox for Equipment */}
                      {assignKind === 'equipment' && (
                        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={relocateEquipment}
                            onChange={(e) => setRelocateEquipment(e.target.checked)}
                            className="accent-violet-600"
                          />
                          <span>
                            Also relocate selected equipment into {activeZone.room.code} on the 2D/3D floor plan
                          </span>
                        </label>
                      )}

                      {/* Mandatory Remediation Override when Zone is under Telemetry Hold */}
                      {isSelectedZoneAlarm && (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 space-y-2 text-xs">
                          <label className="flex items-center gap-2 font-semibold text-amber-600 dark:text-amber-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={overrideEnabled}
                              onChange={(e) => setOverrideEnabled(e.target.checked)}
                              className="accent-amber-500"
                            />
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>Authorize Remediation / Emergency Override for Hold Zone</span>
                          </label>
                          {overrideEnabled && (
                            <input
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              placeholder="Required justification (e.g. HVAC remediation crew restoring +15 Pa cascade)"
                              className={`w-full rounded-lg border px-3 py-1.5 text-xs outline-none ${
                                isDark
                                  ? 'bg-[#0E0E13] border-amber-500/50 text-zinc-100'
                                  : 'bg-white border-amber-400 text-slate-900'
                              }`}
                            />
                          )}
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <input
                          value={shiftNotes}
                          onChange={(e) => setShiftNotes(e.target.value)}
                          placeholder="Optional shift task note (e.g. CIP verification, batch run #42)..."
                          className={`flex-1 rounded-xl border px-3 py-2 text-xs outline-none ${
                            isDark
                              ? 'bg-[#0E0E13] border-zinc-700 text-zinc-100 focus:border-violet-500'
                              : 'bg-white border-slate-300 text-slate-900 focus:border-violet-500'
                          }`}
                        />
                        <button
                          type="submit"
                          disabled={
                            !selectedResourceId ||
                            (isSelectedZoneAlarm && (!overrideEnabled || !overrideReason.trim()))
                          }
                          className="flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0"
                        >
                          {isSelectedZoneAlarm ? (
                            <ShieldAlert className="w-3.5 h-3.5" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {isSelectedZoneAlarm ? 'Dispatch with Override' : 'Assign to Zone'}
                          </span>
                        </button>
                      </div>
                    </form>
                  </section>
                </>
              )}
            </div>
          </div>
        )}

        {/* ==================== VIEW 2: FACILITY SHIFT SCHEDULE MATRIX ==================== */}
        {workspaceTab === 'matrix' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div
              className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 shrink-0 ${
                isDark ? 'border-zinc-800 bg-[#14141A]' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: 'All Resources' },
                    { id: 'personnel', label: 'Personnel Only' },
                    { id: 'equipment', label: 'Equipment Only' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setMatrixKindFilter(f.id)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      matrixKindFilter === f.id
                        ? 'bg-violet-600 text-white'
                        : isDark
                          ? 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                          : 'bg-white border border-slate-200 text-slate-600'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={dayAssignments.length === 0}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition cursor-pointer disabled:opacity-40 ${
                  isDark
                    ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-violet-500'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-violet-500'
                }`}
              >
                <Download className="w-3.5 h-3.5 text-violet-500" />
                Download CSV
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {dayAssignments.length === 0 ? (
                <div className="py-16 text-center space-y-2 text-xs text-zinc-500">
                  <p>No resources are scheduled for {selectedDate}.</p>
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab('dispatch')}
                    className="rounded-xl bg-violet-600 text-white px-4 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Open Zone Dispatch
                  </button>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead
                    className={`sticky top-0 z-10 border-b text-left text-[11px] ${
                      isDark
                        ? 'bg-[#17171F] border-zinc-800 text-zinc-400'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Shift</th>
                      <th className="py-2.5 px-3 font-medium">Zone</th>
                      <th className="py-2.5 px-3 font-medium">Resource</th>
                      <th className="py-2.5 px-3 font-medium">Live Zone Telemetry</th>
                      <th className="py-2.5 px-3 font-medium">Status</th>
                      <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                    {dayAssignments.map((item) => {
                      const liveZone = zoneById.get(item.roomId);
                      const liveMeta = liveZone ? STATUS_META[liveZone.status] : STATUS_META.nominal;
                      const shiftMeta = SHIFTS.find((s) => s.id === item.shift);
                      const stMeta = ASSIGNMENT_STATUS_LABELS[item.status];
                      return (
                        <tr
                          key={item.id}
                          className={
                            isDark ? 'hover:bg-zinc-900/50' : 'hover:bg-slate-50'
                          }
                        >
                          <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap text-zinc-400">
                            {shiftMeta?.shortLabel ?? item.shift}
                          </td>
                          <td className="py-2.5 px-3">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRoomId(item.roomId);
                                setSelectedShift(item.shift);
                                setWorkspaceTab('dispatch');
                                setMobilePane('detail');
                              }}
                              className="text-left hover:underline cursor-pointer"
                            >
                              <span className="font-mono font-bold text-violet-500 mr-1.5">
                                {item.roomCode}
                              </span>
                              <span className="font-medium">{item.roomName}</span>
                            </button>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1.5">
                              {item.resourceKind === 'personnel' ? (
                                <Users className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                              ) : (
                                <Box className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              )}
                              <span className="font-mono text-zinc-400">{item.resourceCode}</span>
                              <span className="font-semibold">{item.resourceName}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">
                            <span className={`font-semibold mr-1.5 ${liveMeta.textCls}`}>
                              {liveMeta.label}
                            </span>
                            <span className="text-zinc-500">
                              {liveZone?.summaryText ?? item.telemetrySnapshotNote}
                            </span>
                          </td>
                          <td className={`py-2.5 px-3 font-semibold whitespace-nowrap ${stMeta.cls}`}>
                            {stMeta.label}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {item.status !== 'completed' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateResourceAssignmentStatus(item.id, 'completed')
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[11px] font-medium hover:border-emerald-500 hover:text-emerald-500 transition cursor-pointer"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  Complete
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => removeResourceAssignment(item.id)}
                                className="p-1 rounded-lg text-zinc-400 hover:text-rose-500 transition cursor-pointer"
                                title="Remove assignment"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
