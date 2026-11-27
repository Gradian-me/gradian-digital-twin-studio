import React, { useMemo, useRef, useState } from 'react';
import {
  Box,
  Building2,
  Camera,
  ChevronDown,
  ChevronRight,
  Compass,
  Crosshair,
  DoorOpen,
  Eye,
  EyeOff,
  FileImage,
  Focus,
  FolderTree,
  Grid2X2,
  Info,
  Layers,
  Link2,
  Lock,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Star,
  Trash2,
  Unlock,
  Upload,
  Wind,
  X,
} from 'lucide-react';
import { useTwinStore, type LeftPanelTab, type SelectedEntity } from '../store/useTwinStore';
import { useRiskIncidentStore, getTargetFmeaSummary } from '../store/useRiskIncidentStore';
import { useGmpStore } from '../store/useGmpStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { SPACE_CATEGORIES, SPACE_TYPE_LIBRARY } from '../data/spaceTypes';
import { EQUIPMENT_CATEGORIES, OBJECT_LIBRARY } from '../data/objectLibrary';
import { formatArea, formatLength } from '../utils/spatial';
import type { EquipmentCategory, SpaceCategory } from '../types/twin';

type AssetPanelMode = 'placed' | 'catalog';
type ElementTypeFilter = 'all' | 'asset' | 'room' | 'wall' | 'opening' | 'camera';
type ElementStatusFilter = 'all' | 'operational' | 'standby' | 'maintenance' | 'flagged';

interface IndexedSceneElement {
  key: string;
  entity: SelectedEntity;
  kind: 'asset' | 'room' | 'wall' | 'opening' | 'camera';
  kindLabel: string;
  name: string;
  code: string;
  floorId: string;
  floorCode: string;
  categoryLabel: string;
  statusBucket: Exclude<ElementStatusFilter, 'all'>;
  statusLabel: string;
  statusTone: 'emerald' | 'amber' | 'rose' | 'zinc';
  flagged: boolean;
  fmeaShortLabel?: string;
  fmeaLevel?: 'critical' | 'high' | 'medium' | 'mitigated' | 'clear';
  fmeaIncidentId?: string;
  searchBlob: string;
  metaText: string;
}

export const LeftBrowser: React.FC = () => {
  const scene = useTwinStore((s) => s.scene);
  const leftTab = useTwinStore((s) => s.leftTab);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const activeBuildingId = useTwinStore((s) => s.activeBuildingId);
  const selected = useTwinStore((s) => s.selected);
  const selectedSpaceTypeId = useTwinStore((s) => s.selectedSpaceTypeId);
  const selectedObjectTemplateId = useTwinStore((s) => s.selectedObjectTemplateId);
  const favoriteSpaceTypes = useTwinStore((s) => s.favoriteSpaceTypes);
  const favoriteObjects = useTwinStore((s) => s.favoriteObjects);
  const calibratingRefId = useTwinStore((s) => s.calibratingRefId);
  const calibrationPoints = useTwinStore((s) => s.calibrationPoints);

  const setLeftTab = useTwinStore((s) => s.setLeftTab);
  const setActiveFloor = useTwinStore((s) => s.setActiveFloor);
  const setActiveBuilding = useTwinStore((s) => s.setActiveBuilding);
  const setActiveTool = useTwinStore((s) => s.setActiveTool);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const setSelectedSpaceTypeId = useTwinStore((s) => s.setSelectedSpaceTypeId);
  const setSelectedObjectTemplateId = useTwinStore((s) => s.setSelectedObjectTemplateId);
  const focusEntity = useTwinStore((s) => s.focusEntity);
  const addFloor = useTwinStore((s) => s.addFloor);
  const addBuilding = useTwinStore((s) => s.addBuilding);
  const addRoom = useTwinStore((s) => s.addRoom);
  const addAsset = useTwinStore((s) => s.addAsset);
  const updateLayer = useTwinStore((s) => s.updateLayer);
  const addLayer = useTwinStore((s) => s.addLayer);
  const addReferencePlan = useTwinStore((s) => s.addReferencePlan);
  const updateReferencePlan = useTwinStore((s) => s.updateReferencePlan);
  const openCadOcrForReference = useTwinStore((s) => s.openCadOcrForReference);
  const setShowCadOcrModal = useTwinStore((s) => s.setShowCadOcrModal);
  const deleteReferencePlan = useTwinStore((s) => s.deleteReferencePlan);
  const startCalibratingRef = useTwinStore((s) => s.startCalibratingRef);
  const applyReferenceCalibration = useTwinStore((s) => s.applyReferenceCalibration);
  const cancelCalibration = useTwinStore((s) => s.cancelCalibration);
  const toggleFavorite = useTwinStore((s) => s.toggleFavorite);
  const addCustomSpaceType = useTwinStore((s) => s.addCustomSpaceType);
  const addCustomObjectTemplate = useTwinStore((s) => s.addCustomObjectTemplate);
  const drillInto = useTwinStore((s) => s.drillInto);
  const isolateLayerDirect = useTwinStore((s) => s.isolateLayerDirect);
  const activeLayerFocusId = useTwinStore((s) => s.activeLayerFocusId);
  const clearIsolation = useTwinStore((s) => s.clearIsolation);
  const buildDirectUrl = useTwinStore((s) => s.buildDirectUrl);
  const setShowModelsGallery = useTwinStore((s) => s.setShowModelsGallery);
  const showToast = useTwinStore((s) => s.showToast);
  const showHvacOverlay = useTwinStore((s) => s.showHvacOverlay);
  const setShowHvacOverlay = useTwinStore((s) => s.setShowHvacOverlay);
  const showFmeaIndicators = useTwinStore((s) => s.showFmeaIndicators);
  const openEntityInfo = useTwinStore((s) => s.openEntityInfo);

  const riskIncidents = useRiskIncidentStore((s) => s.incidents);
  const openRiskModal = useRiskIncidentStore((s) => s.openRiskModal);
  const complianceByAssetId = useGmpStore((s) => s.complianceByAssetId);
  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);

  const [search, setSearch] = useState('');
  const [spaceCat, setSpaceCat] = useState<'All' | 'Favorites' | SpaceCategory>('All');
  const [objCat, setObjCat] = useState<'All' | 'Favorites' | EquipmentCategory>('All');
  // Assets tab: Scene Elements locator vs Equipment Catalog
  const [assetPanelMode, setAssetPanelMode] = useState<AssetPanelMode>('placed');
  const [assetScope, setAssetScope] = useState<'floor' | 'all'>('floor');
  const [elementTypeFilter, setElementTypeFilter] = useState<ElementTypeFilter>('all');
  const [elementStatusFilter, setElementStatusFilter] = useState<ElementStatusFilter>('all');
  const [placedEqCat, setPlacedEqCat] = useState<'All' | EquipmentCategory>('All');
  // Exclusive single-subject accordion state for Tree (one building + one floor expanded at a time)
  const [expandedBuildingId, setExpandedBuildingId] = useState<string | null>(
    activeBuildingId || scene.buildings[0]?.id || null
  );
  const [expandedFloorId, setExpandedFloorId] = useState<string | null>(
    activeFloorId || scene.floors[0]?.id || null
  );
  // Exclusive single-subject accordion state for Layers tab groups
  const [openLayerGroup, setOpenLayerGroup] = useState<string>('Architecture');

  // Quick Add Floor / Building forms
  const [showAddFloor, setShowAddFloor] = useState(false);
  const [newFloorName, setNewFloorName] = useState('Level 2 — Expansion Suite');
  const [newFloorHeight, setNewFloorHeight] = useState(3.8);
  const [dupFloorId, setDupFloorId] = useState('');
  const [newBldgName, setNewBldgName] = useState('');
  const [showAddBldg, setShowAddBldg] = useState(false);

  // Reference calibration input
  const [calibDistance, setCalibDistance] = useState('10');
  const refFileInput = useRef<HTMLInputElement | null>(null);

  // Custom space / object form
  const [showCustomSpace, setShowCustomSpace] = useState(false);
  const [customSpaceName, setCustomSpaceName] = useState('');
  const [showCustomObj, setShowCustomObj] = useState(false);
  const [customObjName, setCustomObjName] = useState('');

  // Custom Layer form
  const [newLayerName, setNewLayerName] = useState('');

  // Arrow-key navigation across Tree, Spaces, and Assets
  const [kbdNavId, setKbdNavId] = useState<string | null>(null);
  const navItemRefs = useRef<Map<string, HTMLElement>>(new Map());

  const allSpaceTypes = useMemo(
    () => [...scene.customSpaceTypes, ...SPACE_TYPE_LIBRARY],
    [scene.customSpaceTypes]
  );

  const filteredSpaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSpaceTypes.filter((s) => {
      if (spaceCat === 'Favorites' && !favoriteSpaceTypes.includes(s.id)) return false;
      if (spaceCat !== 'All' && spaceCat !== 'Favorites' && s.category !== spaceCat) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.environmental.cleanroomGrade.toLowerCase().includes(q)
      );
    });
  }, [allSpaceTypes, spaceCat, favoriteSpaceTypes, search]);

  const allObjects = useMemo(
    () => [...scene.customObjects, ...OBJECT_LIBRARY],
    [scene.customObjects]
  );

  const filteredObjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allObjects.filter((o) => {
      if (objCat === 'Favorites' && !favoriteObjects.includes(o.id)) return false;
      if (objCat !== 'All' && objCat !== 'Favorites' && o.category !== objCat) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        o.manufacturer.toLowerCase().includes(q) ||
        o.model.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q)
      );
    });
  }, [allObjects, objCat, favoriteObjects, search]);

  // Unified index of placed Equipment & Architectural Elements (Rooms, Walls, Openings, Cameras)
  const indexedSceneElements = useMemo<IndexedSceneElement[]>(() => {
    const floorCodeById = new Map(scene.floors.map((f) => [f.id, f.code]));
    const roomNameById = new Map(scene.rooms.map((r) => [r.id, `${r.code} ${r.name}`]));

    // Build quick lookup of telemetry alarms/warnings by targetId
    const sensorAlertByTarget = new Map<string, 'alarm' | 'warning'>();
    sensors.forEach((sn) => {
      const st = readings[sn.id]?.status;
      if (st === 'alarm' || st === 'warning') {
        const prev = sensorAlertByTarget.get(sn.targetId);
        if (st === 'alarm' || !prev) sensorAlertByTarget.set(sn.targetId, st);
      }
    });

    const items: IndexedSceneElement[] = [];

    // 1. Placed Equipment Assets
    scene.assets.forEach((a) => {
      const fmea = getTargetFmeaSummary(riskIncidents, 'asset', a.id);
      const comp = complianceByAssetId[a.id];
      const hasOverdueGmp =
        comp &&
        (comp.calibration.status === 'overdue' ||
          comp.qualification.status === 'overdue' ||
          comp.maintenance.status === 'overdue');
      const hasSensorIssue = sensorAlertByTarget.has(a.id);
      const hasOpenFmea = fmea.openCount > 0;
      const flagged = Boolean(hasOpenFmea || hasOverdueGmp || hasSensorIssue);

      let statusBucket: Exclude<ElementStatusFilter, 'all'> = 'operational';
      let statusLabel = 'Running';
      let statusTone: 'emerald' | 'amber' | 'rose' | 'zinc' = 'emerald';

      if (a.operationalStatus === 'offline') {
        statusBucket = 'maintenance';
        statusLabel = 'Offline';
        statusTone = 'rose';
      } else if (a.operationalStatus === 'maintenance-due') {
        statusBucket = 'maintenance';
        statusLabel = 'Maint Due';
        statusTone = 'amber';
      } else if (
        a.operationalStatus === 'standby' ||
        a.operationalStatus === 'planned' ||
        a.operationalStatus === 'commissioning'
      ) {
        statusBucket = 'standby';
        statusLabel =
          a.operationalStatus === 'standby'
            ? 'Standby'
            : a.operationalStatus === 'commissioning'
              ? 'Commissioning'
              : 'Planned';
        statusTone = 'amber';
      }

      if (hasOverdueGmp && statusTone === 'emerald') {
        statusLabel = 'GMP Overdue';
        statusTone = 'rose';
      }

      const flCode = floorCodeById.get(a.floorId) ?? 'FL';
      const rmLabel = a.roomId ? roomNameById.get(a.roomId) ?? '' : '';

      items.push({
        key: `idx-asset-${a.id}`,
        entity: { type: 'asset', id: a.id },
        kind: 'asset',
        kindLabel: 'Equipment',
        name: a.name,
        code: a.assetId,
        floorId: a.floorId,
        floorCode: flCode,
        categoryLabel: a.category,
        statusBucket,
        statusLabel,
        statusTone,
        flagged,
        fmeaShortLabel: showFmeaIndicators ? fmea.shortLabel : undefined,
        fmeaLevel: fmea.level,
        fmeaIncidentId: fmea.worstIncident?.id,
        metaText: `${a.category} · ${flCode}`,
        searchBlob: `${a.name} ${a.assetId} ${a.manufacturer} ${a.model} ${a.category} ${a.operationalStatus} ${statusLabel} ${rmLabel} ${flCode} ${a.criticality}`.toLowerCase(),
      });
    });

    // 2. Architectural Rooms
    scene.rooms.forEach((r) => {
      const fmea = getTargetFmeaSummary(riskIncidents, 'room', r.id, false);
      const hasSensorIssue = sensorAlertByTarget.has(r.id);
      const hvacCfg = r.environmental.hvac;
      const hvacAlert = hvacCfg?.status === 'alarm' || hvacCfg?.status === 'maintenance';
      const compDeviation = r.complianceStatus === 'deviation';
      const flagged = Boolean(fmea.openCount > 0 || hasSensorIssue || hvacAlert || compDeviation);
      const lifecycle = r.metadata?.status ?? 'operational';

      let statusBucket: Exclude<ElementStatusFilter, 'all'> = 'operational';
      let statusLabel: string = r.environmental.cleanroomGrade;
      let statusTone: 'emerald' | 'amber' | 'rose' | 'zinc' = 'emerald';

      if (lifecycle === 'maintenance' || lifecycle === 'decommissioned' || hvacAlert || compDeviation) {
        statusBucket = 'maintenance';
        statusLabel = hvacAlert ? 'HVAC Alert' : compDeviation ? 'Deviation' : 'Maintenance';
        statusTone = hvacAlert || compDeviation ? 'rose' : 'amber';
      } else if (
        lifecycle === 'planned' ||
        lifecycle === 'commissioning' ||
        lifecycle === 'under-construction' ||
        r.complianceStatus === 'review-due'
      ) {
        statusBucket = 'standby';
        statusLabel =
          r.complianceStatus === 'review-due'
            ? 'Review Due'
            : lifecycle === 'planned'
              ? 'Planned'
              : 'Commissioning';
        statusTone = 'amber';
      }

      const flCode = floorCodeById.get(r.floorId) ?? 'FL';
      const pa = r.environmental.pressurePa >= 0 ? `+${r.environmental.pressurePa} Pa` : `${r.environmental.pressurePa} Pa`;

      items.push({
        key: `idx-room-${r.id}`,
        entity: { type: 'room', id: r.id },
        kind: 'room',
        kindLabel: 'Room',
        name: r.name,
        code: r.code,
        floorId: r.floorId,
        floorCode: flCode,
        categoryLabel: r.category,
        statusBucket,
        statusLabel,
        statusTone,
        flagged,
        fmeaShortLabel: showFmeaIndicators ? fmea.shortLabel : undefined,
        fmeaLevel: fmea.level,
        fmeaIncidentId: fmea.worstIncident?.id,
        metaText: `${formatArea(r.width * r.depth, scene.unitSystem)} · ${pa} · ${flCode}`,
        searchBlob: `${r.name} ${r.code} ${r.category} ${r.environmental.cleanroomGrade} ${pa} ${hvacCfg?.ahuId ?? ''} ${hvacCfg?.hepaClass ?? ''} ${r.complianceStatus} ${lifecycle} ${flCode} room`.toLowerCase(),
      });
    });

    // 3. Architectural Openings (Doors & Windows)
    scene.openings.forEach((op) => {
      const flCode = floorCodeById.get(op.floorId) ?? 'FL';
      const isAlarm = op.status === 'alarm';
      const isInterlocked = op.status === 'interlocked';
      const statusBucket: Exclude<ElementStatusFilter, 'all'> = isAlarm
        ? 'maintenance'
        : isInterlocked
          ? 'standby'
          : 'operational';
      const statusLabel =
        op.status === 'alarm'
          ? 'Door Alarm'
          : op.status === 'interlocked'
            ? 'Interlocked'
            : op.status === 'open'
              ? 'Open'
              : 'Closed';
      const statusTone: 'emerald' | 'amber' | 'rose' | 'zinc' = isAlarm
        ? 'rose'
        : isInterlocked
          ? 'amber'
          : 'emerald';

      items.push({
        key: `idx-opening-${op.id}`,
        entity: { type: 'opening', id: op.id },
        kind: 'opening',
        kindLabel: op.kind === 'door' ? 'Door' : 'Window',
        name: op.name || op.subtype.replace(/-/g, ' '),
        code: op.kind === 'door' ? 'DOOR' : 'WIN',
        floorId: op.floorId,
        floorCode: flCode,
        categoryLabel: op.subtype.replace(/-/g, ' '),
        statusBucket,
        statusLabel,
        statusTone,
        flagged: isAlarm,
        metaText: `${op.accessControl !== 'none' ? op.accessControl : op.subtype.replace(/-/g, ' ')} · ${flCode}`,
        searchBlob: `${op.name} ${op.kind} ${op.subtype} ${op.status} ${op.accessControl} ${op.fireRating} ${flCode} door window opening`.toLowerCase(),
      });
    });

    // 4. Architectural Walls
    scene.walls.forEach((w, idx) => {
      const flCode = floorCodeById.get(w.floorId) ?? 'FL';
      const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
      items.push({
        key: `idx-wall-${w.id}`,
        entity: { type: 'wall', id: w.id },
        kind: 'wall',
        kindLabel: 'Wall',
        name: w.name || `${w.isExterior ? 'Exterior' : 'Partition'} Wall ${idx + 1}`,
        code: w.isExterior ? 'EXT' : 'INT',
        floorId: w.floorId,
        floorCode: flCode,
        categoryLabel: w.presetId.replace(/-/g, ' '),
        statusBucket: 'operational',
        statusLabel: w.isStructural ? 'Structural' : 'Partition',
        statusTone: 'zinc',
        flagged: false,
        metaText: `${formatLength(len, scene.unitSystem, 1)} × ${formatLength(w.height, scene.unitSystem, 1)} · ${flCode}`,
        searchBlob: `${w.name} ${w.presetId} ${w.fireRating} ${w.isExterior ? 'exterior' : 'interior'} ${w.isStructural ? 'structural' : 'partition'} ${flCode} wall`.toLowerCase(),
      });
    });

    // 5. Cameras
    scene.cameras.forEach((c) => {
      const flCode = floorCodeById.get(c.floorId) ?? 'FL';
      const st = c.status ?? 'online';
      const statusBucket: Exclude<ElementStatusFilter, 'all'> =
        st === 'offline' ? 'maintenance' : 'operational';
      items.push({
        key: `idx-camera-${c.id}`,
        entity: { type: 'camera', id: c.id },
        kind: 'camera',
        kindLabel: 'Camera',
        name: c.name,
        code: c.group || 'CAM',
        floorId: c.floorId,
        floorCode: flCode,
        categoryLabel: c.kind,
        statusBucket,
        statusLabel: st === 'recording' ? 'Recording' : st === 'offline' ? 'Offline' : 'Online',
        statusTone: st === 'offline' ? 'rose' : 'emerald',
        flagged: st === 'offline',
        metaText: `${c.kind} · ${flCode}`,
        searchBlob: `${c.name} ${c.kind} ${c.group} ${st} ${c.ipAddress ?? ''} ${flCode} camera cctv`.toLowerCase(),
      });
    });

    return items;
  }, [
    scene.assets,
    scene.rooms,
    scene.openings,
    scene.walls,
    scene.cameras,
    scene.floors,
    scene.unitSystem,
    riskIncidents,
    complianceByAssetId,
    sensors,
    readings,
    showFmeaIndicators,
  ]);

  const scopedSceneElements = useMemo(
    () =>
      assetScope === 'floor'
        ? indexedSceneElements.filter((el) => el.floorId === activeFloorId)
        : indexedSceneElements,
    [indexedSceneElements, assetScope, activeFloorId]
  );

  const filteredSceneElements = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedSceneElements.filter((el) => {
      if (elementTypeFilter !== 'all' && el.kind !== elementTypeFilter) return false;
      if (elementTypeFilter === 'asset' && placedEqCat !== 'All' && el.categoryLabel !== placedEqCat) {
        return false;
      }
      if (elementStatusFilter === 'flagged') {
        if (!el.flagged) return false;
      } else if (elementStatusFilter !== 'all' && el.statusBucket !== elementStatusFilter) {
        return false;
      }
      if (q && !el.searchBlob.includes(q)) return false;
      return true;
    });
  }, [scopedSceneElements, elementTypeFilter, placedEqCat, elementStatusFilter, search]);

  const hasActiveElementFilters =
    search.trim().length > 0 ||
    elementTypeFilter !== 'all' ||
    elementStatusFilter !== 'all' ||
    placedEqCat !== 'All';

  const resetElementFilters = () => {
    setSearch('');
    setElementTypeFilter('all');
    setElementStatusFilter('all');
    setPlacedEqCat('All');
  };

  const handleUploadReference = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const fl = scene.floors.find((f) => f.id === activeFloorId);
      addReferencePlan({
        floorId: activeFloorId,
        name: file.name,
        layerCategory: 'reference-plan',
        dataUrl: String(reader.result),
        fileType: file.type || 'image/png',
        x: 0.5,
        z: 0.5,
        elevation: 0,
        width: fl ? fl.width - 1 : 28,
        depth: fl ? fl.depth - 1 : 18,
        rotationDeg: 0,
        opacity: 0.65,
        visible: true,
        locked: false,
        calibrated: false,
        layerId: 'layer-references',
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const tabs: { id: LeftPanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'hierarchy', label: 'Tree', icon: <FolderTree className="w-3.5 h-3.5" /> },
    { id: 'spaces', label: 'Spaces', icon: <Grid2X2 className="w-3.5 h-3.5" /> },
    { id: 'objects', label: 'Assets', icon: <Box className="w-3.5 h-3.5" /> },
    { id: 'layers', label: 'Layers', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'references', label: 'Plans', icon: <FileImage className="w-3.5 h-3.5" /> },
  ];

  const toggleBuildingAccordion = (bldgId: string) => {
    setExpandedBuildingId((prev) => {
      if (prev === bldgId) return null;
      const firstFl = scene.floors.find((f) => f.buildingId === bldgId);
      if (firstFl) setExpandedFloorId(firstFl.id);
      return bldgId;
    });
  };

  const toggleFloorAccordion = (floorId: string) => {
    setExpandedFloorId((prev) => (prev === floorId ? null : floorId));
  };

  // Build flat keyboard-navigable item list for the active LeftBrowser tab
  const navItems = useMemo<{ key: string; onSelect: () => void }[]>(() => {
    if (leftTab === 'spaces') {
      return filteredSpaces.map((sp) => ({
        key: `sp-${sp.id}`,
        onSelect: () => {
          setSelectedSpaceTypeId(sp.id);
          setActiveTool('draw-room');
        },
      }));
    }
    if (leftTab === 'objects') {
      if (assetPanelMode === 'placed') {
        return filteredSceneElements.map((el) => ({
          key: el.key,
          onSelect: () => focusEntity(el.entity),
        }));
      }
      return filteredObjects.map((obj) => ({
        key: `obj-${obj.id}`,
        onSelect: () => {
          setSelectedObjectTemplateId(obj.id);
          setActiveTool('place-object');
        },
      }));
    }
    if (leftTab === 'hierarchy') {
      const q = search.trim().toLowerCase();
      const out: { key: string; onSelect: () => void }[] = [];
      scene.buildings.forEach((bldg) => {
        out.push({ key: `b-${bldg.id}`, onSelect: () => drillInto('building', bldg.id) });
        if (q || expandedBuildingId === bldg.id) {
          scene.floors
            .filter((f) => f.buildingId === bldg.id)
            .forEach((fl) => {
              out.push({ key: `fl-${fl.id}`, onSelect: () => drillInto('floor', fl.id) });
              if (q || expandedFloorId === fl.id) {
                const fRooms = scene.rooms.filter(
                  (r) =>
                    r.floorId === fl.id &&
                    (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
                );
                const fAssets = scene.assets.filter(
                  (a) =>
                    a.floorId === fl.id &&
                    (!q || a.name.toLowerCase().includes(q) || a.assetId.toLowerCase().includes(q))
                );
                fRooms.forEach((rm) => {
                  out.push({ key: `rm-${rm.id}`, onSelect: () => drillInto('room', rm.id) });
                  fAssets
                    .filter((a) => a.roomId === rm.id)
                    .forEach((a) => {
                      out.push({ key: `ast-${a.id}`, onSelect: () => drillInto('asset', a.id) });
                    });
                });
              }
            });
        }
      });
      return out;
    }
    return [];
  }, [
    leftTab,
    assetPanelMode,
    filteredSpaces,
    filteredObjects,
    filteredSceneElements,
    scene.buildings,
    scene.floors,
    scene.rooms,
    scene.assets,
    expandedBuildingId,
    expandedFloorId,
    search,
    drillInto,
    focusEntity,
    setSelectedSpaceTypeId,
    setSelectedObjectTemplateId,
    setActiveTool,
  ]);

  const handleSidebarKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const idx = tabs.findIndex((t) => t.id === leftTab);
      const next =
        e.key === 'ArrowRight'
          ? (idx + 1) % tabs.length
          : (idx - 1 + tabs.length) % tabs.length;
      setLeftTab(tabs[next].id);
      setSearch('');
      setKbdNavId(null);
      return;
    }
    if (navItems.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const curIdx = kbdNavId ? navItems.findIndex((n) => n.key === kbdNavId) : -1;
      const nextIdx =
        e.key === 'ArrowDown'
          ? Math.min(navItems.length - 1, curIdx + 1)
          : Math.max(0, curIdx <= 0 ? 0 : curIdx - 1);
      const next = navItems[nextIdx];
      if (next) {
        setKbdNavId(next.key);
        next.onSelect();
        requestAnimationFrame(() => {
          navItemRefs.current.get(next.key)?.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth',
          });
        });
      }
    } else if (e.key === 'Enter' && kbdNavId) {
      const item = navItems.find((n) => n.key === kbdNavId);
      if (item) {
        e.preventDefault();
        item.onSelect();
      }
    }
  };

  return (
    <aside
      tabIndex={0}
      onKeyDown={handleSidebarKeyDown}
      className="w-72 bg-white dark:bg-[#111114] border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-full shrink-0 select-none focus:outline-none"
    >
      {/* Tab Bar */}
      <div className="grid grid-cols-5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0D0D10]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setLeftTab(t.id);
              setSearch('');
            }}
            className={`py-2.5 flex flex-col items-center gap-1 text-[10px] font-medium border-b-2 transition-colors ${
              leftTab === t.id
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-[#111114]'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Search Bar (for Tree, Spaces, Objects) */}
      {(leftTab === 'hierarchy' || leftTab === 'spaces' || leftTab === 'objects') && (
        <div className="p-2.5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                leftTab === 'hierarchy'
                  ? 'Filter buildings, rooms, assets...'
                  : leftTab === 'spaces'
                    ? 'Search 60+ GMP space types...'
                    : assetPanelMode === 'placed'
                      ? 'Locate equipment, rooms, walls, doors...'
                      : 'Search catalog bioreactors, HPLC, racks...'
              }
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md bg-zinc-100 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            {search.length > 0 && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-400 px-0.5">
            <span>↑ ↓ Arrow keys to navigate</span>
            <span className="font-mono">Alt+←/→ Tabs</span>
          </div>
        </div>
      )}

      {/* TAB 1: ENTERPRISE SPATIAL HIERARCHY */}
      {leftTab === 'hierarchy' && (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2 text-xs">
          {/* Enterprise Breadcrumb Root with Campus 3D Drill */}
          <div className="px-2.5 py-2 rounded-lg bg-zinc-50 dark:bg-[#161619] border border-zinc-200 dark:border-zinc-800 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-zinc-400 font-medium">Enterprise Spatial Root</span>
              <button
                onClick={() => drillInto('campus')}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-medium"
                title="View entire multi-building campus in 3D"
              >
                <Compass className="w-3 h-3" /> Campus 3D
              </button>
            </div>
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {scene.hierarchy.find((h) => h.level === 'site')?.name ?? scene.name}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
              {scene.buildings.length} Bldgs · {scene.floors.length} Floors · {scene.rooms.length} Rooms · {scene.assets.length} Assets
            </div>
          </div>

          {/* Quick Add Building / Floor */}
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowAddFloor((v) => !v)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C] font-medium"
            >
              <Plus className="w-3 h-3" /> Add Floor
            </button>
            <button
              onClick={() => setShowAddBldg((v) => !v)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C] font-medium"
            >
              <Building2 className="w-3 h-3" /> Add Bldg
            </button>
          </div>

          {showAddBldg && (
            <div className="p-2.5 rounded-md bg-slate-50 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700 space-y-2">
              <input
                value={newBldgName}
                onChange={(e) => setNewBldgName(e.target.value)}
                placeholder="Building C — Formulation Annex"
                className="w-full px-2 py-1 text-xs rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
              />
              <button
                onClick={() => {
                  addBuilding(newBldgName.trim() || `Building ${scene.buildings.length + 1}`);
                  setNewBldgName('');
                  setShowAddBldg(false);
                }}
                className="w-full py-1 rounded bg-violet-600 text-white font-medium"
              >
                Create Building
              </button>
            </div>
          )}

          {showAddFloor && (
            <div className="p-2.5 rounded-md bg-slate-50 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700 space-y-2">
              <input
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
                placeholder="Floor Name"
                className="w-full px-2 py-1 text-xs rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
              />
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-500">Height (m)</label>
                <input
                  type="number"
                  step={0.2}
                  value={newFloorHeight}
                  onChange={(e) => setNewFloorHeight(Number(e.target.value))}
                  className="w-16 px-1.5 py-1 text-xs rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700 font-mono"
                />
              </div>
              <select
                value={dupFloorId}
                onChange={(e) => setDupFloorId(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
              >
                <option value="">Blank floor slab</option>
                {scene.floors.map((fl) => (
                  <option key={fl.id} value={fl.id}>
                    Duplicate layout from {fl.code}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const baseFl = scene.floors.find((f) => f.buildingId === activeBuildingId);
                  addFloor({
                    buildingId: activeBuildingId,
                    name: newFloorName.trim() || 'New Floor',
                    height: newFloorHeight,
                    width: baseFl?.width ?? 34,
                    depth: baseFl?.depth ?? 22,
                    duplicateFromFloorId: dupFloorId || undefined,
                  });
                  setShowAddFloor(false);
                }}
                className="w-full py-1 rounded bg-violet-600 text-white font-medium"
              >
                Stack Floor
              </button>
            </div>
          )}

          {/* Building → Floor → Room → Asset Tree (Exclusive Single-Subject Accordion + FMEA Indicators) */}
          <div className="space-y-1">
            {scene.buildings.map((bldg) => {
              const q = search.trim().toLowerCase();
              const bExpanded = q.length > 0 || expandedBuildingId === bldg.id;
              const bFloors = scene.floors.filter((f) => f.buildingId === bldg.id);
              return (
                <div key={bldg.id}>
                  <div
                    onClick={() => {
                      toggleBuildingAccordion(bldg.id);
                      setActiveBuilding(bldg.id);
                    }}
                    className={`group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-md cursor-pointer ${
                      activeBuildingId === bldg.id
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {bExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                      <Building2 className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{bldg.name}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        drillInto('building', bldg.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded bg-zinc-200/80 dark:bg-zinc-800 text-[10px] font-medium hover:text-emerald-400 shrink-0"
                      title="Drill 3D into Building"
                    >
                      3D
                    </button>
                  </div>

                  {bExpanded && (
                    <div className="ml-3 pl-2 border-l border-zinc-200 dark:border-zinc-800 space-y-1 mt-1">
                      {bFloors.map((fl) => {
                        const fExpanded = q.length > 0 || expandedFloorId === fl.id;
                        const fRooms = scene.rooms.filter(
                          (r) =>
                            r.floorId === fl.id &&
                            (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
                        );
                        const fAssets = scene.assets.filter(
                          (a) =>
                            a.floorId === fl.id &&
                            (!q || a.name.toLowerCase().includes(q) || a.assetId.toLowerCase().includes(q))
                        );

                        return (
                          <div key={fl.id}>
                            <div
                              onClick={() => {
                                toggleFloorAccordion(fl.id);
                                drillInto('floor', fl.id);
                              }}
                              className={`flex items-center justify-between gap-1 px-2 py-1 rounded cursor-pointer ${
                                activeFloorId === fl.id
                                  ? 'bg-zinc-100 dark:bg-[#1C1C21] font-semibold text-zinc-900 dark:text-white'
                                  : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                              }`}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                {fExpanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                                <span className="truncate">{fl.code} · {fl.name}</span>
                              </div>
                              <span className="font-mono text-[10px] text-zinc-400 shrink-0 tabular-nums">
                                +{fl.elevation.toFixed(1)}m
                              </span>
                            </div>

                            {fExpanded && (
                              <div className="ml-3 pl-2 border-l border-zinc-200 dark:border-zinc-800 space-y-0.5 mt-0.5">
                                {fRooms.map((rm) => {
                                  const isSel = selected.some((s) => s.type === 'room' && s.id === rm.id);
                                  const rmAssets = fAssets.filter((a) => a.roomId === rm.id);
                                  const rmFmea = showFmeaIndicators
                                    ? getTargetFmeaSummary(riskIncidents, 'room', rm.id, false)
                                    : null;
                                  return (
                                    <div key={rm.id}>
                                      <div className="flex items-center gap-1">
                                        <button
                                          ref={(el) => {
                                            if (el) navItemRefs.current.set(`rm-${rm.id}`, el);
                                            else navItemRefs.current.delete(`rm-${rm.id}`);
                                          }}
                                          onClick={() => {
                                            setKbdNavId(`rm-${rm.id}`);
                                            drillInto('room', rm.id);
                                          }}
                                          className={`flex-1 min-w-0 text-left flex items-center justify-between gap-1 px-2 py-1 rounded text-[11px] ${
                                            isSel || kbdNavId === `rm-${rm.id}`
                                              ? 'bg-violet-600 text-white'
                                              : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                          }`}
                                        >
                                          <span className="truncate">{rm.code} · {rm.name}</span>
                                          <span className={`font-mono text-[10px] shrink-0 tabular-nums ${isSel || kbdNavId === `rm-${rm.id}` ? 'text-violet-100' : 'text-zinc-400'}`}>
                                            {formatArea(rm.width * rm.depth, scene.unitSystem)}
                                          </span>
                                        </button>
                                        {rmFmea && rmFmea.shortLabel && rmFmea.worstIncident && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openRiskModal({ mode: 'resolve', incidentId: rmFmea.worstIncident!.id });
                                            }}
                                            title={`FMEA: ${rmFmea.worstIncident.title}`}
                                            className={`px-1 py-0.5 rounded font-mono text-[9px] font-bold tabular-nums shrink-0 cursor-pointer ${
                                              rmFmea.level === 'critical'
                                                ? 'text-rose-500 bg-rose-500/12'
                                                : rmFmea.level === 'high'
                                                  ? 'text-amber-500 bg-amber-500/12'
                                                  : rmFmea.level === 'mitigated'
                                                    ? 'text-emerald-500 bg-emerald-500/12'
                                                    : 'text-violet-400 bg-violet-500/12'
                                            }`}
                                          >
                                            {rmFmea.shortLabel}
                                          </button>
                                        )}
                                      </div>
                                      {rmAssets.length > 0 && (
                                        <div className="ml-3 space-y-0.5">
                                          {rmAssets.map((a) => {
                                            const aSel = selected.some((s) => s.type === 'asset' && s.id === a.id);
                                            const aFmea = showFmeaIndicators
                                              ? getTargetFmeaSummary(riskIncidents, 'asset', a.id)
                                              : null;
                                            return (
                                              <div key={a.id} className="flex items-center gap-1">
                                                <button
                                                  ref={(el) => {
                                                    if (el) navItemRefs.current.set(`ast-${a.id}`, el);
                                                    else navItemRefs.current.delete(`ast-${a.id}`);
                                                  }}
                                                  onClick={() => {
                                                    setKbdNavId(`ast-${a.id}`);
                                                    drillInto('asset', a.id);
                                                  }}
                                                  className={`flex-1 min-w-0 text-left flex items-center justify-between gap-1 px-2 py-0.5 rounded text-[11px] ${
                                                    aSel || kbdNavId === `ast-${a.id}`
                                                      ? 'bg-violet-500/20 text-violet-600 dark:text-violet-300 font-medium'
                                                      : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                                  }`}
                                                >
                                                  <span className="truncate">{a.name}</span>
                                                  <span className="font-mono text-[10px] shrink-0">{a.assetId}</span>
                                                </button>
                                                {aFmea && aFmea.shortLabel && aFmea.worstIncident && (
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      openRiskModal({ mode: 'resolve', incidentId: aFmea.worstIncident!.id });
                                                    }}
                                                    title={`FMEA: ${aFmea.worstIncident.title}`}
                                                    className={`px-1 py-0.5 rounded font-mono text-[8.5px] font-bold tabular-nums shrink-0 cursor-pointer ${
                                                      aFmea.level === 'critical'
                                                        ? 'text-rose-500 bg-rose-500/12'
                                                        : aFmea.level === 'high'
                                                          ? 'text-amber-500 bg-amber-500/12'
                                                          : aFmea.level === 'mitigated'
                                                            ? 'text-emerald-500 bg-emerald-500/12'
                                                            : 'text-violet-400 bg-violet-500/12'
                                                    }`}
                                                  >
                                                    {aFmea.shortLabel}
                                                  </button>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: SPACE TYPE LIBRARY */}
      {leftTab === 'spaces' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-2.5 py-2 border-b border-slate-200 dark:border-zinc-800 flex items-center gap-1.5">
            <select
              value={spaceCat}
              onChange={(e) => setSpaceCat(e.target.value as any)}
              className="flex-1 px-2 py-1 text-xs rounded bg-slate-100 dark:bg-[#14141A] border border-slate-200 dark:border-zinc-700"
            >
              <option value="All">All Categories ({allSpaceTypes.length})</option>
              <option value="Favorites">Favorites ({favoriteSpaceTypes.length})</option>
              {SPACE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={() => setShowCustomSpace((v) => !v)}
              className="p-1.5 rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C]"
              title="Save Custom Space Template"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {showCustomSpace && (
            <div className="p-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#14141A] space-y-2 text-xs">
              <input
                value={customSpaceName}
                onChange={(e) => setCustomSpaceName(e.target.value)}
                placeholder="Custom space type name..."
                className="w-full px-2 py-1 rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
              />
              <button
                onClick={() => {
                  if (!customSpaceName.trim()) return;
                  const base = SPACE_TYPE_LIBRARY[0];
                  addCustomSpaceType({
                    ...base,
                    id: `st-custom-${Date.now()}`,
                    name: customSpaceName.trim(),
                    isCustom: true,
                  });
                  setCustomSpaceName('');
                  setShowCustomSpace(false);
                }}
                className="w-full py-1 rounded bg-violet-600 text-white font-medium"
              >
                Save Space Template
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {filteredSpaces.map((sp) => {
              const active = selectedSpaceTypeId === sp.id;
              const isFav = favoriteSpaceTypes.includes(sp.id);
              return (
                <div
                  key={sp.id}
                  ref={(el) => {
                    if (el) navItemRefs.current.set(`sp-${sp.id}`, el);
                    else navItemRefs.current.delete(`sp-${sp.id}`);
                  }}
                  className={`p-2.5 rounded-lg border transition-colors ${
                    active || kbdNavId === `sp-${sp.id}`
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => {
                        setSelectedSpaceTypeId(sp.id);
                        setActiveTool('draw-room');
                        setViewMode('split');
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: sp.color }}
                        />
                        <span className="text-xs font-medium text-slate-900 dark:text-white truncate">
                          {sp.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                        {sp.environmental.cleanroomGrade} · {sp.environmental.pressurePa >= 0 ? `+${sp.environmental.pressurePa}` : sp.environmental.pressurePa} Pa · {sp.defaultWidth}×{sp.defaultDepth}m
                      </div>
                    </div>
                    <button
                      onClick={() => toggleFavorite('space', sp.id)}
                      className={`p-1 rounded ${isFav ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <button
                      onClick={() => {
                        setSelectedSpaceTypeId(sp.id);
                        setActiveTool('draw-room');
                        setViewMode('split');
                      }}
                      className="flex-1 py-1 text-[11px] font-medium rounded bg-slate-100 dark:bg-[#1C1C24] hover:bg-violet-600 hover:text-white transition-colors"
                    >
                      Draw in 2D
                    </button>
                    <button
                      onClick={() => {
                        addRoom(2, 2, sp.defaultWidth, sp.defaultDepth, sp.id, sp.name);
                      }}
                      className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C]"
                      title="Insert room with default dimensions"
                    >
                      Quick Add
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: ASSET & ARCHITECTURAL ELEMENT LOCATOR + 3D EQUIPMENT CATALOG */}
      {leftTab === 'objects' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mode Switcher: Placed Scene Elements vs Equipment Catalog */}
          <div className="px-2.5 pt-2 pb-2 border-b border-zinc-200 dark:border-zinc-800 space-y-2 bg-zinc-50/70 dark:bg-[#0E0E12]">
            <div className="grid grid-cols-2 p-0.5 rounded-md bg-zinc-200/70 dark:bg-[#18181D] text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setAssetPanelMode('placed')}
                className={`py-1 rounded text-center transition-colors whitespace-nowrap tabular-nums ${
                  assetPanelMode === 'placed'
                    ? 'bg-white dark:bg-[#23232C] text-zinc-900 dark:text-white shadow-2xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                Scene ({scopedSceneElements.length})
              </button>
              <button
                type="button"
                onClick={() => setAssetPanelMode('catalog')}
                className={`py-1 rounded text-center transition-colors whitespace-nowrap tabular-nums ${
                  assetPanelMode === 'catalog'
                    ? 'bg-white dark:bg-[#23232C] text-zinc-900 dark:text-white shadow-2xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                Catalog ({allObjects.length})
              </button>
            </div>

            {/* SCENE LOCATOR FILTER BAR (Type, Status, Floor Scope) */}
            {assetPanelMode === 'placed' && (
              <div className="space-y-1.5">
                {/* Type & Status Filter Dropdowns */}
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    aria-label="Filter by element type"
                    value={elementTypeFilter}
                    onChange={(e) => {
                      const next = e.target.value as ElementTypeFilter;
                      setElementTypeFilter(next);
                      if (next !== 'asset') setPlacedEqCat('All');
                    }}
                    className="w-full px-2 py-1 text-[11px] rounded bg-white dark:bg-[#16161C] border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  >
                    <option value="all">All Types</option>
                    <option value="asset">Equipment</option>
                    <option value="room">Rooms</option>
                    <option value="opening">Doors &amp; Windows</option>
                    <option value="wall">Walls</option>
                    <option value="camera">Cameras</option>
                  </select>

                  <select
                    aria-label="Filter by operational or compliance status"
                    value={elementStatusFilter}
                    onChange={(e) => setElementStatusFilter(e.target.value as ElementStatusFilter)}
                    className="w-full px-2 py-1 text-[11px] rounded bg-white dark:bg-[#16161C] border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  >
                    <option value="all">All Statuses</option>
                    <option value="operational">Operational / Active</option>
                    <option value="standby">Standby / Interlocked</option>
                    <option value="maintenance">Maint / Offline / Alarm</option>
                    <option value="flagged">GMP / FMEA Flagged</option>
                  </select>
                </div>

                {/* Equipment sub-category filter when Equipment type is focused */}
                {elementTypeFilter === 'asset' && (
                  <select
                    aria-label="Filter equipment category"
                    value={placedEqCat}
                    onChange={(e) => setPlacedEqCat(e.target.value as 'All' | EquipmentCategory)}
                    className="w-full px-2 py-1 text-[11px] rounded bg-white dark:bg-[#16161C] border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  >
                    <option value="All">All Equipment Categories</option>
                    {EQUIPMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}

                {/* Quick Type Filter Strip + Floor Scope + Count/Reset */}
                <div className="flex items-center justify-between gap-1 text-[10.5px]">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setAssetScope('floor')}
                      className={`px-1.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap ${
                        assetScope === 'floor'
                          ? 'bg-violet-600 text-white'
                          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
                      }`}
                    >
                      Floor
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssetScope('all')}
                      className={`px-1.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap ${
                        assetScope === 'all'
                          ? 'bg-violet-600 text-white'
                          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
                      }`}
                    >
                      All Floors
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="font-mono tabular-nums text-[10px] text-zinc-500 dark:text-zinc-400">
                      {filteredSceneElements.length}/{scopedSceneElements.length}
                    </span>
                    {hasActiveElementFilters && (
                      <button
                        type="button"
                        onClick={resetElementFilters}
                        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400 hover:underline whitespace-nowrap"
                        title="Reset all filters"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* CATALOG CATEGORY FILTER BAR */}
            {assetPanelMode === 'catalog' && (
              <div className="flex items-center gap-1.5">
                <select
                  value={objCat}
                  onChange={(e) => setObjCat(e.target.value as any)}
                  className="flex-1 px-2 py-1 text-xs rounded bg-white dark:bg-[#16161C] border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100"
                >
                  <option value="All">All Equipment ({allObjects.length})</option>
                  <option value="Favorites">Favorites ({favoriteObjects.length})</option>
                  {EQUIPMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button
                  onClick={() => setShowCustomObj((v) => !v)}
                  className="p-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-[#22222C]"
                  title="Save Custom Equipment Template"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* SCENE ELEMENTS RESULTS LIST */}
          {assetPanelMode === 'placed' && (
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {filteredSceneElements.length === 0 ? (
                <div className="p-5 text-center space-y-2.5">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    No matching elements found
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Try switching to All Floors or clearing the type/status filter.
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    {hasActiveElementFilters && (
                      <button
                        type="button"
                        onClick={resetElementFilters}
                        className="px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-medium"
                      >
                        Reset Filters
                      </button>
                    )}
                    {assetScope === 'floor' && (
                      <button
                        type="button"
                        onClick={() => setAssetScope('all')}
                        className="px-2.5 py-1 rounded-md border border-zinc-300 dark:border-zinc-700 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        Search All Floors
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                filteredSceneElements.map((el) => {
                  const isSel = selected.some(
                    (s) => s.type === el.entity.type && s.id === el.entity.id
                  );
                  const statusColorCls =
                    el.statusTone === 'emerald'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : el.statusTone === 'amber'
                        ? 'text-amber-600 dark:text-amber-400'
                        : el.statusTone === 'rose'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-zinc-500 dark:text-zinc-400';

                  const KindIcon =
                    el.kind === 'asset'
                      ? Box
                      : el.kind === 'room'
                        ? Grid2X2
                        : el.kind === 'opening'
                          ? DoorOpen
                          : el.kind === 'camera'
                            ? Camera
                            : Square;

                  return (
                    <div
                      key={el.key}
                      ref={(node) => {
                        if (node) navItemRefs.current.set(el.key, node);
                        else navItemRefs.current.delete(el.key);
                      }}
                      onClick={() => {
                        setKbdNavId(el.key);
                        focusEntity(el.entity);
                      }}
                      className={`group px-2.5 py-2 cursor-pointer transition-colors ${
                        isSel || kbdNavId === el.key
                          ? 'bg-violet-500/12 dark:bg-violet-500/15'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <KindIcon
                            className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                              isSel
                                ? 'text-violet-600 dark:text-violet-400'
                                : 'text-zinc-400 dark:text-zinc-500'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1.5">
                              <span
                                className={`text-xs font-medium truncate ${
                                  isSel
                                    ? 'text-violet-700 dark:text-violet-300'
                                    : 'text-zinc-900 dark:text-zinc-100'
                                }`}
                              >
                                {el.name}
                              </span>
                              <span className="font-mono text-[10px] text-zinc-400 shrink-0 tabular-nums">
                                {el.code}
                              </span>
                            </div>

                            <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-zinc-500 dark:text-zinc-400 truncate">
                              <span className="shrink-0">{el.kindLabel}</span>
                              <span>·</span>
                              <span className={`font-medium shrink-0 ${statusColorCls}`}>
                                {el.statusLabel}
                              </span>
                              <span>·</span>
                              <span className="truncate font-mono tabular-nums text-[10px]">
                                {el.metaText}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0">
                          {el.fmeaShortLabel && el.fmeaIncidentId && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openRiskModal({ mode: 'resolve', incidentId: el.fmeaIncidentId! });
                              }}
                              title="Open FMEA Risk Incident"
                              className={`px-1 py-0.5 rounded font-mono text-[9px] font-bold tabular-nums cursor-pointer ${
                                el.fmeaLevel === 'critical'
                                  ? 'text-rose-500 bg-rose-500/12'
                                  : el.fmeaLevel === 'high'
                                    ? 'text-amber-500 bg-amber-500/12'
                                    : el.fmeaLevel === 'mitigated'
                                      ? 'text-emerald-500 bg-emerald-500/12'
                                      : 'text-violet-400 bg-violet-500/12'
                              }`}
                            >
                              {el.fmeaShortLabel}
                            </button>
                          )}
                          {(el.kind === 'asset' || el.kind === 'room') && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEntityInfo({ type: el.kind as 'asset' | 'room', id: el.entity.id });
                              }}
                              className="p-1 rounded text-zinc-400 hover:text-violet-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                              title="View full specs, SOP & history"
                            >
                              <Info className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewMode('3d-perspective');
                              focusEntity(el.entity);
                            }}
                            className="p-1 rounded text-zinc-400 hover:text-emerald-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                            title="Fly directly to element in 3D"
                          >
                            <Focus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* EQUIPMENT CATALOG VIEW */}
          {assetPanelMode === 'catalog' && (
            <>
              {showCustomObj && (
                <div className="p-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#14141A] space-y-2 text-xs">
                  <input
                    value={customObjName}
                    onChange={(e) => setCustomObjName(e.target.value)}
                    placeholder="Custom equipment name..."
                    className="w-full px-2 py-1 rounded bg-white dark:bg-[#1C1C24] border border-slate-300 dark:border-zinc-700"
                  />
                  <button
                    onClick={() => {
                      if (!customObjName.trim()) return;
                      const base = OBJECT_LIBRARY[0];
                      addCustomObjectTemplate({
                        ...base,
                        id: `eq-custom-${Date.now()}`,
                        name: customObjName.trim(),
                        manufacturer: 'Custom Template',
                        isCustom: true,
                      });
                      setCustomObjName('');
                      setShowCustomObj(false);
                    }}
                    className="w-full py-1 rounded bg-violet-600 text-white font-medium"
                  >
                    Save Object Template
                  </button>
                </div>
              )}

              <div className="px-2.5 py-2 border-b border-zinc-200 dark:border-zinc-800 space-y-1.5">
                <button
                  onClick={() => setShowModelsGallery(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Open 3D Models Gallery ({allObjects.length})
                </button>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Drag any item onto the 2D or 3D canvas, or inspect in 3D Gallery.
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {filteredObjects.map((obj) => {
                  const active = selectedObjectTemplateId === obj.id;
                  const isFav = favoriteObjects.includes(obj.id);
                  return (
                    <div
                      key={obj.id}
                      ref={(el) => {
                        if (el) navItemRefs.current.set(`obj-${obj.id}`, el);
                        else navItemRefs.current.delete(`obj-${obj.id}`);
                      }}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-gradian-object', obj.id);
                        setSelectedObjectTemplateId(obj.id);
                      }}
                      className={`p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
                        active || kbdNavId === `obj-${obj.id}`
                          ? 'border-violet-500 bg-violet-500/10'
                          : 'border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                            {obj.name}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {obj.manufacturer} · {obj.model}
                          </div>
                          <div className="text-[10px] font-mono tabular-nums text-slate-400 mt-0.5">
                            {formatLength(obj.width, scene.unitSystem, 1)} × {formatLength(obj.depth, scene.unitSystem, 1)} × {formatLength(obj.height, scene.unitSystem, 1)} · {obj.energyKw} kW
                          </div>
                        </div>
                        <button
                          onClick={() => toggleFavorite('object', obj.id)}
                          className={`p-1 rounded ${isFav ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                      <div className="flex gap-1.5 mt-2">
                        <button
                          onClick={() => {
                            setSelectedObjectTemplateId(obj.id);
                            setActiveTool('place-object');
                          }}
                          className="flex-1 py-1 text-[11px] font-medium rounded bg-slate-100 dark:bg-[#1C1C24] hover:bg-violet-600 hover:text-white transition-colors"
                        >
                          Click to Place
                        </button>
                        <button
                          onClick={() => {
                            const fl = scene.floors.find((f) => f.id === activeFloorId);
                            addAsset(obj.id, (fl?.width ?? 20) / 2, (fl?.depth ?? 14) / 2);
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-[#22222C]"
                        >
                          Drop Center
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 4: LAYER MANAGER (Exclusive Single-Group Accordion + HVAC Overlay Shortcut) */}
      {leftTab === 'layers' && (() => {
        const groupedLayers = Array.from(
          scene.layers.reduce((acc, layer) => {
            const grp = layer.group || 'General';
            if (!acc.has(grp)) acc.set(grp, []);
            acc.get(grp)!.push(layer);
            return acc;
          }, new Map<string, typeof scene.layers>())
        );
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-2.5 border-b border-zinc-200 dark:border-zinc-800 space-y-2">
              <div className="flex gap-1.5">
                <input
                  value={newLayerName}
                  onChange={(e) => setNewLayerName(e.target.value)}
                  placeholder="New layer name..."
                  className="flex-1 px-2 py-1 text-xs rounded bg-zinc-100 dark:bg-[#18181C] border border-zinc-200 dark:border-zinc-700"
                />
                <button
                  onClick={() => {
                    if (!newLayerName.trim()) return;
                    addLayer(newLayerName.trim(), 'MEP & Process', '#0EA5E9');
                    setNewLayerName('');
                    setOpenLayerGroup('MEP & Process');
                  }}
                  className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                >
                  Add
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowHvacOverlay(!showHvacOverlay)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                  showHvacOverlay
                    ? 'bg-sky-500/15 border-sky-500/40 text-sky-500'
                    : 'bg-zinc-100 dark:bg-[#18181C] border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Wind className="w-3.5 h-3.5" />
                  HVAC Ducts &amp; HEPA Overlay
                </span>
                <span className="font-mono text-[10px]">{showHvacOverlay ? 'ON' : 'OFF'}</span>
              </button>
              {activeLayerFocusId && (
                <button
                  onClick={() => {
                    scene.layers.forEach((l) => updateLayer(l.id, { visible: true }));
                    clearIsolation();
                  }}
                  className="w-full py-1 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
                >
                  Show All Layers (Clear Layer Focus)
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {groupedLayers.map(([groupName, groupLayers]) => {
                const isOpen = openLayerGroup === groupName;
                const visCount = groupLayers.filter((l) => l.visible).length;
                return (
                  <div
                    key={groupName}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141418] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenLayerGroup(isOpen ? '' : groupName)}
                      className="w-full px-2.5 py-2 flex items-center justify-between gap-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        )}
                        <span className="truncate">{groupName}</span>
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400 tabular-nums shrink-0">
                        {visCount}/{groupLayers.length}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="p-1.5 pt-0 space-y-1.5 border-t border-zinc-100 dark:border-zinc-800/80">
                        {groupLayers.map((layer) => {
                          const isFocused = activeLayerFocusId === layer.id;
                          return (
                            <div
                              key={layer.id}
                              className={`p-2 rounded-lg border space-y-1 transition-colors ${
                                isFocused
                                  ? 'border-emerald-500 bg-emerald-500/5'
                                  : 'border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-[#18181E]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: layer.color }} />
                                  <span className="text-xs font-medium truncate">{layer.name}</span>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button
                                    onClick={() => isolateLayerDirect(layer.id)}
                                    className={`p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                                      isFocused ? 'text-emerald-500' : 'text-zinc-400 hover:text-emerald-400'
                                    }`}
                                    title="Isolate / Focus this Layer"
                                  >
                                    <Focus className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      const url = buildDirectUrl({ layerId: layer.id });
                                      navigator.clipboard?.writeText(url).catch(() => {});
                                      showToast(`Copied direct URL for layer "${layer.name}"`, 'success');
                                    }}
                                    className="p-1 rounded text-zinc-400 hover:text-cyan-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                    title="Copy Direct URL to this Layer"
                                  >
                                    <Link2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                                    className={`p-1 rounded ${layer.visible ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-400'}`}
                                    title="Toggle Visibility"
                                  >
                                    {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                  </button>
                                  <button
                                    onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                                    className={`p-1 rounded ${layer.locked ? 'text-amber-500' : 'text-zinc-400'}`}
                                    title="Toggle Lock"
                                  >
                                    {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* TAB 5: REFERENCE PLANS & 2-POINT SCALE CALIBRATION */}
      {leftTab === 'references' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-2.5 border-b border-slate-200 dark:border-zinc-800 space-y-2">
            <button
              onClick={() => refFileInput.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" /> Import Blueprint (PNG/JPG/SVG)
            </button>
            <button
              onClick={() => setShowCadOcrModal(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-600 dark:text-amber-300 text-[11px] font-semibold cursor-pointer transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" /> CAD / SVG to 3D Walls (OCR)
            </button>
            <input
              ref={refFileInput}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={handleUploadReference}
            />
          </div>

          {calibratingRefId && (
            <div className="p-3 border-b border-indigo-500/30 bg-indigo-500/10 space-y-2 text-xs">
              <div className="font-semibold text-indigo-600 dark:text-indigo-300">
                2-Point Scale Calibration ({calibrationPoints.length}/2 pts)
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                Click two points with a known real-world span on the 2D floor plan, then enter the true distance below.
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={calibDistance}
                  onChange={(e) => setCalibDistance(e.target.value)}
                  className="w-20 px-2 py-1 rounded bg-white dark:bg-[#14141A] border border-slate-300 dark:border-zinc-700 font-mono"
                />
                <span className="text-slate-500">meters</span>
              </div>
              <div className="flex gap-1.5">
                <button
                  disabled={calibrationPoints.length < 2}
                  onClick={() => applyReferenceCalibration(Number(calibDistance))}
                  className="flex-1 py-1 rounded bg-indigo-600 text-white font-medium disabled:opacity-40"
                >
                  Apply Scale
                </button>
                <button
                  onClick={cancelCalibration}
                  className="px-2.5 py-1 rounded border border-slate-300 dark:border-zinc-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {scene.references.filter((r) => r.floorId === activeFloorId).length === 0 ? (
              <div className="text-center py-8 px-3 text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <FileImage className="w-7 h-7 mx-auto text-slate-400" />
                <p>No reference floor plans on this level yet.</p>
                <p className="text-[11px]">
                  Import an architectural drawing to overlay, calibrate with two known points, and trace walls &amp; rooms directly over it.
                </p>
              </div>
            ) : (
              scene.references
                .filter((r) => r.floorId === activeFloorId)
                .map((refPlan) => (
                  <div
                    key={refPlan.id}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-zinc-800 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{refPlan.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateReferencePlan(refPlan.id, { visible: !refPlan.visible })}
                          className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        >
                          {refPlan.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => deleteReferencePlan(refPlan.id)}
                          className="p-1 text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span>Opacity</span>
                        <span className="font-mono">{Math.round(refPlan.opacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={refPlan.opacity}
                        onChange={(e) => updateReferencePlan(refPlan.id, { opacity: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>{refPlan.width}×{refPlan.depth} m</span>
                      <span>{refPlan.calibrated ? 'Calibrated' : 'Uncalibrated'}</span>
                    </div>
                    <button
                      onClick={() => openCadOcrForReference(refPlan.id)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold transition-colors cursor-pointer"
                    >
                      <Box className="w-3.5 h-3.5" />
                      {refPlan.fileType.includes('svg') || refPlan.name.toLowerCase().endsWith('.svg')
                        ? 'Turn SVG into 3D Model'
                        : 'Convert Plan to 3D Model (OCR)'}
                    </button>
                    <button
                      onClick={() => startCalibratingRef(refPlan.id)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-slate-100 dark:bg-[#1C1C24] hover:bg-indigo-600 hover:text-white font-medium transition-colors cursor-pointer"
                    >
                      <Crosshair className="w-3.5 h-3.5" /> 2-Point Scale Calibration
                    </button>
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
