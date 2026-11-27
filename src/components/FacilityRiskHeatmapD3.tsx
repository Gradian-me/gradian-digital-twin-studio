import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  Box,
  FileText,
  Flame,
  Layers,
  Map as MapIcon,
  RotateCcw,
  ShieldAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import {
  getRpnPriority,
  useRiskIncidentStore,
  type RiskIncidentRecord,
} from '../store/useRiskIncidentStore';
import type { Floor, Room, SpatialAsset } from '../types/twin';

export interface FacilityRiskHeatmapD3Props {
  initialFloorId?: string | null;
  highlightIncidentId?: string | null;
  onSelectIncident?: (incident: RiskIncidentRecord) => void;
  onNavigate3D?: (incident: RiskIncidentRecord) => void;
  onOpenAssetPdf?: (assetId: string) => void;
}

interface MappedHotspot {
  incident: RiskIncidentRecord;
  floorId: string;
  roomId?: string;
  assetId?: string;
  x: number;
  z: number;
  intensity: number; // Severity * Occurrence (1..100)
}

interface RoomHeatStat {
  room: Room;
  floor: Floor;
  peakIntensity: number; // max S*O
  cumulativeIntensity: number;
  maxRpn: number;
  incidents: RiskIncidentRecord[];
}

function getIntensityBand(intensity: number): { label: string; textClass: string } {
  if (intensity >= 64) return { label: 'Critical', textClass: 'text-rose-500' };
  if (intensity >= 36) return { label: 'High', textClass: 'text-orange-500' };
  if (intensity >= 16) return { label: 'Moderate', textClass: 'text-amber-500' };
  if (intensity > 0) return { label: 'Low', textClass: 'text-yellow-500' };
  return { label: 'Nominal', textClass: 'text-emerald-500' };
}

export const FacilityRiskHeatmapD3: React.FC<FacilityRiskHeatmapD3Props> = ({
  initialFloorId,
  highlightIncidentId,
  onSelectIncident,
  onNavigate3D,
  onOpenAssetPdf,
}) => {
  const scene = useTwinStore((s) => s.scene);
  const activeFloorId = useTwinStore((s) => s.activeFloorId);
  const theme = useTwinStore((s) => s.theme);
  const incidents = useRiskIncidentStore((s) => s.incidents);
  const productionLines = useGmpStore((s) => s.productionLines);

  const isDark = theme === 'dark';

  const [floorFilter, setFloorFilter] = useState<'all' | string>(
    initialFloorId || 'all'
  );
  const [onlyActive, setOnlyActive] = useState(true);
  const [showThermalField, setShowThermalField] = useState(true);
  const [hoveredHotspot, setHoveredHotspot] = useState<MappedHotspot | null>(null);
  const [hoveredRoom, setHoveredRoom] = useState<RoomHeatStat | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const legendRef = useRef<SVGSVGElement | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Filter incidents based on Active vs All History
  const visibleIncidents = useMemo(() => {
    return incidents.filter((inc) =>
      onlyActive ? inc.status === 'open' || inc.status === 'investigating' : true
    );
  }, [incidents, onlyActive]);

  // Map every incident to concrete (floorId, roomId, x, z) spatial coordinates on the floor plan
  const mappedHotspots = useMemo<MappedHotspot[]>(() => {
    const out: MappedHotspot[] = [];
    const fallbackFloor = scene.floors[0];

    visibleIncidents.forEach((inc) => {
      const intensity = Math.max(1, Math.min(100, inc.severity * inc.occurrence));

      if (inc.targetKind === 'asset' || inc.targetKind === 'network') {
        const asset = scene.assets.find(
          (a) =>
            a.id === inc.targetId ||
            (inc.targetCode && a.assetId.toLowerCase() === inc.targetCode.toLowerCase())
        );
        if (asset) {
          out.push({
            incident: inc,
            floorId: asset.floorId,
            roomId: asset.roomId,
            assetId: asset.id,
            x: asset.x,
            z: asset.z,
            intensity,
          });
          return;
        }
      }

      if (inc.targetKind === 'room') {
        const room = scene.rooms.find(
          (r) =>
            r.id === inc.targetId ||
            (inc.targetCode && r.code.toLowerCase() === inc.targetCode.toLowerCase())
        );
        if (room) {
          out.push({
            incident: inc,
            floorId: room.floorId,
            roomId: room.id,
            x: room.x + room.width / 2,
            z: room.z + room.depth / 2,
            intensity,
          });
          return;
        }
      }

      if (inc.targetKind === 'line') {
        const line = productionLines.find(
          (l) =>
            l.id === inc.targetId ||
            (inc.targetCode && l.code.toLowerCase() === inc.targetCode.toLowerCase())
        );
        if (line && line.roomIds.length > 0) {
          line.roomIds.forEach((rmId) => {
            const rm = scene.rooms.find((r) => r.id === rmId);
            if (rm) {
              out.push({
                incident: inc,
                floorId: rm.floorId,
                roomId: rm.id,
                x: rm.x + rm.width / 2,
                z: rm.z + rm.depth / 2,
                intensity,
              });
            }
          });
          return;
        }
      }

      // Fallback using incident.roomId or incident.floorId
      if (inc.roomId) {
        const rm = scene.rooms.find((r) => r.id === inc.roomId);
        if (rm) {
          out.push({
            incident: inc,
            floorId: rm.floorId,
            roomId: rm.id,
            x: rm.x + rm.width / 2,
            z: rm.z + rm.depth / 2,
            intensity,
          });
          return;
        }
      }

      if (fallbackFloor) {
        const fl = scene.floors.find((f) => f.id === inc.floorId) ?? fallbackFloor;
        out.push({
          incident: inc,
          floorId: fl.id,
          x: fl.width / 2,
          z: fl.depth / 2,
          intensity,
        });
      }
    });

    return out;
  }, [visibleIncidents, scene.assets, scene.rooms, scene.floors, productionLines]);

  // Floors displayed in the D3 canvas
  const floorsToRender = useMemo<Floor[]>(() => {
    if (floorFilter === 'all') return scene.floors;
    const found = scene.floors.find((f) => f.id === floorFilter);
    return found ? [found] : scene.floors.slice(0, 1);
  }, [scene.floors, floorFilter]);

  // Room-level risk aggregation across rendered floors
  const roomHeatStats = useMemo<RoomHeatStat[]>(() => {
    const floorMap = new Map(scene.floors.map((f) => [f.id, f]));
    const stats: RoomHeatStat[] = [];

    floorsToRender.forEach((fl) => {
      const flRooms = scene.rooms.filter((r) => r.floorId === fl.id);
      flRooms.forEach((rm) => {
        const matching = mappedHotspots.filter(
          (h) =>
            h.floorId === fl.id &&
            (h.roomId === rm.id ||
              (h.x >= rm.x && h.x <= rm.x + rm.width && h.z >= rm.z && h.z <= rm.z + rm.depth))
        );
        // Deduplicate incidents per room
        const uniqueIncidents = Array.from(
          new Map(matching.map((m) => [m.incident.id, m.incident])).values()
        );
        const peakIntensity = matching.reduce((m, h) => Math.max(m, h.intensity), 0);
        const cumulativeIntensity = uniqueIncidents.reduce(
          (sum, inc) => sum + inc.severity * inc.occurrence,
          0
        );
        const maxRpn = uniqueIncidents.reduce((m, inc) => Math.max(m, inc.rpn), 0);
        stats.push({
          room: rm,
          floor: floorMap.get(rm.floorId) ?? fl,
          peakIntensity,
          cumulativeIntensity,
          maxRpn,
          incidents: uniqueIncidents,
        });
      });
    });

    return stats.sort(
      (a, b) => b.peakIntensity - a.peakIntensity || b.maxRpn - a.maxRpn
    );
  }, [floorsToRender, scene.rooms, scene.floors, mappedHotspots]);

  const floorIncidentCount = useMemo(() => {
    const counts = new Map<string, number>();
    mappedHotspots.forEach((h) => {
      counts.set(h.floorId, (counts.get(h.floorId) ?? 0) + 1);
    });
    return counts;
  }, [mappedHotspots]);

  const summaryKpis = useMemo(() => {
    const renderedIds = new Set(floorsToRender.map((f) => f.id));
    const scopedSpots = mappedHotspots.filter((h) => renderedIds.has(h.floorId));
    const uniqueInc = Array.from(
      new Map(scopedSpots.map((h) => [h.incident.id, h.incident])).values()
    );
    const peakSo = uniqueInc.reduce((m, i) => Math.max(m, i.severity * i.occurrence), 0);
    const avgSo =
      uniqueInc.length > 0
        ? uniqueInc.reduce((s, i) => s + i.severity * i.occurrence, 0) / uniqueInc.length
        : 0;
    const criticalRooms = roomHeatStats.filter((r) => r.peakIntensity >= 36).length;
    return {
      incidentCount: uniqueInc.length,
      peakSo,
      avgSo,
      criticalRooms,
      totalRooms: roomHeatStats.length,
    };
  }, [floorsToRender, mappedHotspots, roomHeatStats]);

  // Render D3 Floor Plan Risk Intensity Heatmap
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || floorsToRender.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const cols = floorsToRender.length > 1 ? 2 : 1;
    const rows = Math.ceil(floorsToRender.length / cols);
    const cellW = cols === 1 ? 820 : 440;
    const cellH = cols === 1 ? 460 : 285;
    const outerPad = 18;
    const gap = 18;
    const headerH = 26;

    const totalW = outerPad * 2 + cols * cellW + (cols - 1) * gap;
    const totalH = outerPad * 2 + rows * cellH + (rows - 1) * gap;

    svg.attr('viewBox', `0 0 ${totalW} ${totalH}`);

    const defs = svg.append('defs');

    // D3 Sequential Color Scale for Severity × Occurrence (0..100)
    const colorScale = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, 100]);

    // Soft blur filter for thermal heat plumes
    const blur = defs
      .append('filter')
      .attr('id', 'fmea-heat-blur')
      .attr('x', '-40%')
      .attr('y', '-40%')
      .attr('width', '180%')
      .attr('height', '180%');
    blur.append('feGaussianBlur').attr('stdDeviation', cols === 1 ? 14 : 9);

    const rootG = svg.append('g').attr('class', 'heatmap-root');

    // Attach D3 Zoom & Pan
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.65, 4.5])
      .on('zoom', (event) => {
        rootG.attr('transform', event.transform.toString());
      });
    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    const bldgById = new Map(scene.buildings.map((b) => [b.id, b]));
    const roomStatMap = new Map(roomHeatStats.map((s) => [s.room.id, s]));

    floorsToRender.forEach((fl, flIdx) => {
      const col = flIdx % cols;
      const row = Math.floor(flIdx / cols);
      const panelX = outerPad + col * (cellW + gap);
      const panelY = outerPad + row * (cellH + gap);

      const panelG = rootG
        .append('g')
        .attr('transform', `translate(${panelX}, ${panelY})`);

      // Floor Card Frame
      panelG
        .append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', cellW)
        .attr('height', cellH)
        .attr('rx', 12)
        .attr('fill', isDark ? '#101016' : '#f8fafc')
        .attr('stroke', isDark ? '#27272a' : '#e2e8f0')
        .attr('stroke-width', 1);

      const bldg = bldgById.get(fl.buildingId);
      const flHotspots = mappedHotspots.filter((h) => h.floorId === fl.id);
      const flPeak = flHotspots.reduce((m, h) => Math.max(m, h.intensity), 0);

      // Floor Header Label
      panelG
        .append('text')
        .attr('x', 12)
        .attr('y', 17)
        .attr('fill', isDark ? '#e4e4e7' : '#18181b')
        .attr('font-size', 11)
        .attr('font-weight', 700)
        .text(`${bldg ? `${bldg.code} · ` : ''}${fl.code} — ${fl.name}`);

      panelG
        .append('text')
        .attr('x', cellW - 12)
        .attr('y', 17)
        .attr('text-anchor', 'end')
        .attr('font-family', 'ui-monospace, SFMono-Regular, monospace')
        .attr('font-size', 10)
        .attr('font-weight', 700)
        .attr(
          'fill',
          flPeak >= 64
            ? '#f43f5e'
            : flPeak >= 36
              ? '#f97316'
              : flPeak > 0
                ? '#f59e0b'
                : '#10b981'
        )
        .text(
          flPeak > 0
            ? `Peak S×O ${flPeak} · ${flHotspots.length} risk${flHotspots.length === 1 ? '' : 's'}`
            : 'Nominal (0 risks)'
        );

      // Compute uniform aspect-preserving D3 linear scales for floor meter coordinates
      const innerPad = 14;
      const drawW = cellW - innerPad * 2;
      const drawH = cellH - headerH - innerPad * 2;
      const flW = Math.max(10, fl.width);
      const flD = Math.max(8, fl.depth);
      const pxPerMeter = Math.min(drawW / flW, drawH / flD);
      const mapW = flW * pxPerMeter;
      const mapH = flD * pxPerMeter;
      const offsetX = innerPad + (drawW - mapW) / 2;
      const offsetY = headerH + innerPad + (drawH - mapH) / 2;

      const xScale = d3.scaleLinear().domain([0, flW]).range([offsetX, offsetX + mapW]);
      const zScale = d3.scaleLinear().domain([0, flD]).range([offsetY, offsetY + mapH]);

      // Clip floor plan interior so thermal plumes never bleed outside the slab
      const clipId = `clip-floor-${fl.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
      defs
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', xScale(0))
        .attr('y', zScale(0))
        .attr('width', mapW)
        .attr('height', mapH)
        .attr('rx', 6);

      // Floor Slab Base
      panelG
        .append('rect')
        .attr('x', xScale(0))
        .attr('y', zScale(0))
        .attr('width', mapW)
        .attr('height', mapH)
        .attr('rx', 6)
        .attr('fill', isDark ? '#16161f' : '#ffffff')
        .attr('stroke', isDark ? '#3f3f46' : '#cbd5e1')
        .attr('stroke-width', 1.2);

      // Subtle architectural meter gridlines
      const gridG = panelG.append('g').attr('opacity', isDark ? 0.16 : 0.25);
      const step = flW > 30 ? 5 : 4;
      for (let gx = step; gx < flW; gx += step) {
        gridG
          .append('line')
          .attr('x1', xScale(gx))
          .attr('y1', zScale(0))
          .attr('x2', xScale(gx))
          .attr('y2', zScale(flD))
          .attr('stroke', isDark ? '#52525b' : '#cbd5e1')
          .attr('stroke-width', 0.6);
      }
      for (let gz = step; gz < flD; gz += step) {
        gridG
          .append('line')
          .attr('x1', xScale(0))
          .attr('y1', zScale(gz))
          .attr('x2', xScale(flW))
          .attr('y2', zScale(gz))
          .attr('stroke', isDark ? '#52525b' : '#cbd5e1')
          .attr('stroke-width', 0.6);
      }

      // Layer 1: Architectural Rooms shaded by Peak (S × O) Intensity
      const flRooms = scene.rooms.filter((r) => r.floorId === fl.id);
      const roomsG = panelG.append('g').attr('clip-path', `url(#${clipId})`);

      flRooms.forEach((rm) => {
        const stat = roomStatMap.get(rm.id);
        const peak = stat?.peakIntensity ?? 0;
        const fillCol =
          peak > 0
            ? colorScale(Math.max(12, peak))
            : isDark
              ? '#1b1d26'
              : '#f1f5f9';
        const fillOpacity = peak > 0 ? (isDark ? 0.32 : 0.28) : 0.85;
        const strokeCol =
          peak >= 64
            ? '#f43f5e'
            : peak >= 36
              ? '#f97316'
              : peak > 0
                ? '#f59e0b'
                : isDark
                  ? '#3f3f46'
                  : '#94a3b8';

        const rx = xScale(rm.x);
        const ry = zScale(rm.z);
        const rw = Math.max(4, xScale(rm.x + rm.width) - rx);
        const rh = Math.max(4, zScale(rm.z + rm.depth) - ry);

        const rmGroup = roomsG
          .append('g')
          .style('cursor', stat && stat.incidents.length > 0 ? 'pointer' : 'default')
          .on('mouseenter', () => {
            if (stat) setHoveredRoom(stat);
          })
          .on('mouseleave', () => setHoveredRoom(null))
          .on('click', () => {
            if (stat && stat.incidents.length > 0 && onSelectIncident) {
              const top = [...stat.incidents].sort(
                (a, b) => b.severity * b.occurrence - a.severity * a.occurrence
              )[0];
              if (top) onSelectIncident(top);
            }
          });

        rmGroup
          .append('rect')
          .attr('x', rx)
          .attr('y', ry)
          .attr('width', rw)
          .attr('height', rh)
          .attr('fill', fillCol)
          .attr('fill-opacity', fillOpacity)
          .attr('stroke', strokeCol)
          .attr('stroke-width', peak >= 36 ? 1.6 : 1);

        // Room Code + Peak S×O label when space allows
        if (rw >= 34 && rh >= 20) {
          rmGroup
            .append('text')
            .attr('x', rx + 4)
            .attr('y', ry + 11)
            .attr('font-family', 'ui-monospace, SFMono-Regular, monospace')
            .attr('font-size', cols === 1 ? 9 : 7.5)
            .attr('font-weight', 700)
            .attr('fill', isDark ? '#e4e4e7' : '#1e293b')
            .text(rm.code);

          if (peak > 0 && rh >= 30) {
            rmGroup
              .append('text')
              .attr('x', rx + 4)
              .attr('y', ry + 22)
              .attr('font-family', 'ui-monospace, SFMono-Regular, monospace')
              .attr('font-size', cols === 1 ? 8.5 : 7)
              .attr('font-weight', 700)
              .attr('fill', peak >= 64 ? '#f43f5e' : '#f59e0b')
              .text(`S×O ${peak}`);
          }
        }
      });

      // Layer 2: Continuous D3 Thermal Field (Gaussian / Radial Intensity Plumes)
      if (showThermalField && flHotspots.length > 0) {
        const heatG = panelG
          .append('g')
          .attr('clip-path', `url(#${clipId})`)
          .attr('filter', 'url(#fmea-heat-blur)')
          .style('pointer-events', 'none');

        flHotspots.forEach((h, hIdx) => {
          const cx = xScale(h.x);
          const cy = zScale(h.z);
          const radiusMeters = 2.6 + (h.intensity / 100) * 4.4;
          const rPx = Math.max(18, radiusMeters * pxPerMeter);
          const gradId = `rad-${flIdx}-${hIdx}`;
          const coreColor = colorScale(Math.max(20, h.intensity));
          const midColor = colorScale(Math.max(10, h.intensity * 0.6));

          const rg = defs
            .append('radialGradient')
            .attr('id', gradId)
            .attr('cx', '50%')
            .attr('cy', '50%')
            .attr('r', '50%');
          rg.append('stop').attr('offset', '0%').attr('stop-color', coreColor).attr('stop-opacity', 0.82);
          rg.append('stop').attr('offset', '52%').attr('stop-color', midColor).attr('stop-opacity', 0.42);
          rg.append('stop').attr('offset', '100%').attr('stop-color', midColor).attr('stop-opacity', 0);

          heatG
            .append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', rPx)
            .attr('fill', `url(#${gradId})`);
        });
      }

      // Layer 3: Architectural Walls & Placed Equipment Footprints
      const flWalls = scene.walls.filter((w) => w.floorId === fl.id);
      const wallsG = panelG
        .append('g')
        .attr('clip-path', `url(#${clipId})`)
        .style('pointer-events', 'none');

      flWalls.forEach((w) => {
        wallsG
          .append('line')
          .attr('x1', xScale(w.x1))
          .attr('y1', zScale(w.z1))
          .attr('x2', xScale(w.x2))
          .attr('y2', zScale(w.z2))
          .attr('stroke', isDark ? '#52525b' : '#475569')
          .attr('stroke-width', w.isExterior ? 1.8 : 1.1)
          .attr('stroke-linecap', 'round');
      });

      const flAssets: SpatialAsset[] = scene.assets.filter((a) => a.floorId === fl.id);
      const assetsG = panelG
        .append('g')
        .attr('clip-path', `url(#${clipId})`)
        .style('pointer-events', 'none');

      flAssets.forEach((a) => {
        const aw = Math.max(4, a.width * pxPerMeter);
        const ad = Math.max(4, a.depth * pxPerMeter);
        assetsG
          .append('rect')
          .attr('x', xScale(a.x) - aw / 2)
          .attr('y', zScale(a.z) - ad / 2)
          .attr('width', aw)
          .attr('height', ad)
          .attr('rx', 1.5)
          .attr('fill', isDark ? '#27272a' : '#cbd5e1')
          .attr('fill-opacity', 0.72)
          .attr('stroke', isDark ? '#71717a' : '#64748b')
          .attr('stroke-width', 0.7);
      });

      // Layer 4: Interactive Risk Intensity Hotspot Markers (S × O)
      const spotsG = panelG.append('g');
      flHotspots.forEach((h) => {
        const cx = xScale(h.x);
        const cy = zScale(h.z);
        const isHighlighted = highlightIncidentId === h.incident.id;
        const r = (cols === 1 ? 6.5 : 5) + (h.intensity / 100) * (cols === 1 ? 7 : 4.5);
        const fill = colorScale(Math.max(18, h.intensity));

        const g = spotsG
          .append('g')
          .style('cursor', 'pointer')
          .on('mouseenter', () => {
            setHoveredHotspot(h);
            setHoveredRoom(null);
          })
          .on('mouseleave', () => setHoveredHotspot(null))
          .on('click', (ev) => {
            ev.stopPropagation();
            if (onSelectIncident) onSelectIncident(h.incident);
          });

        // Outer iso-ring for highlighted or critical hotspots
        if (isHighlighted || h.intensity >= 49) {
          g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', r + 4.5)
            .attr('fill', 'none')
            .attr('stroke', isHighlighted ? '#8b5cf6' : '#f43f5e')
            .attr('stroke-width', isHighlighted ? 2.2 : 1.2)
            .attr('stroke-dasharray', isHighlighted ? 'none' : '3,2');
        }

        g.append('circle')
          .attr('cx', cx)
          .attr('cy', cy)
          .attr('r', r)
          .attr('fill', fill)
          .attr('stroke', isDark ? '#09090b' : '#ffffff')
          .attr('stroke-width', 1.8);

        g.append('text')
          .attr('x', cx)
          .attr('y', cy + 3)
          .attr('text-anchor', 'middle')
          .attr('font-family', 'ui-monospace, SFMono-Regular, monospace')
          .attr('font-size', cols === 1 ? 8.5 : 7)
          .attr('font-weight', 800)
          .attr('fill', h.intensity >= 45 ? '#ffffff' : '#18181b')
          .text(String(h.intensity));
      });
    });
  }, [
    floorsToRender,
    scene.buildings,
    scene.rooms,
    scene.walls,
    scene.assets,
    mappedHotspots,
    roomHeatStats,
    showThermalField,
    highlightIncidentId,
    isDark,
    onSelectIncident,
  ]);

  // Render D3 Continuous Color Scale Legend (0..100 Severity × Occurrence)
  useEffect(() => {
    const el = legendRef.current;
    if (!el) return;
    const svg = d3.select(el);
    svg.selectAll('*').remove();

    const w = 260;
    const h = 34;
    const padX = 12;
    const barW = w - padX * 2;
    const barH = 10;

    svg.attr('viewBox', `0 0 ${w} ${h}`);
    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id', 'fmea-so-legend-grad');
    const colorScale = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, 100]);

    d3.range(0, 101, 10).forEach((v) => {
      grad
        .append('stop')
        .attr('offset', `${v}%`)
        .attr('stop-color', colorScale(v));
    });

    svg
      .append('rect')
      .attr('x', padX)
      .attr('y', 4)
      .attr('width', barW)
      .attr('height', barH)
      .attr('rx', 4)
      .attr('fill', 'url(#fmea-so-legend-grad)')
      .attr('stroke', isDark ? '#3f3f46' : '#cbd5e1')
      .attr('stroke-width', 0.8);

    const axisScale = d3.scaleLinear().domain([0, 100]).range([padX, padX + barW]);
    const axis = d3
      .axisBottom(axisScale)
      .tickValues([0, 25, 50, 75, 100])
      .tickSize(4)
      .tickFormat((d) => String(d));

    const axisG = svg
      .append('g')
      .attr('transform', `translate(0, ${4 + barH})`)
      .call(axis);

    axisG.select('.domain').remove();
    axisG.selectAll('line').attr('stroke', isDark ? '#71717a' : '#94a3b8');
    axisG
      .selectAll('text')
      .attr('fill', isDark ? '#a1a1aa' : '#475569')
      .attr('font-family', 'ui-monospace, SFMono-Regular, monospace')
      .attr('font-size', 9);
  }, [isDark]);

  const handleZoomStep = (factor: number) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(220).call(zoomBehaviorRef.current.scaleBy, factor);
  };

  const handleZoomReset = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(220).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
  };

  return (
    <div className="space-y-4">
      {/* Control Bar: Floor Selector + Active/All Toggle + Thermal Layer + Zoom */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFloorFilter('all')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              floorFilter === 'all'
                ? 'bg-violet-600 text-white'
                : 'border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-violet-500'
            }`}
          >
            All Floors ({scene.floors.length})
          </button>
          {scene.floors.map((fl) => {
            const cnt = floorIncidentCount.get(fl.id) ?? 0;
            const active = floorFilter === fl.id;
            return (
              <button
                key={fl.id}
                type="button"
                onClick={() => setFloorFilter(fl.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                  active
                    ? 'bg-violet-600 text-white font-semibold'
                    : 'border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-violet-500'
                }`}
              >
                {fl.code}
                {cnt > 0 ? ` (${cnt})` : ''}
              </button>
            );
          })}
          {activeFloorId && floorFilter !== activeFloorId && (
            <button
              type="button"
              onClick={() => setFloorFilter(activeFloorId)}
              className="px-2 py-1.5 rounded-lg text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:underline whitespace-nowrap cursor-pointer"
            >
              Active Floor
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOnlyActive((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              onlyActive
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
            }`}
          >
            {onlyActive ? 'Open Risks Only' : 'All History (Incl. Mitigated)'}
          </button>
          <button
            type="button"
            onClick={() => setShowThermalField((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
              showThermalField
                ? 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-300'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            Thermal Field
          </button>
        </div>
      </div>

      {/* KPI Strip + D3 Continuous Legend */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 items-center">
        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#15151E]">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Peak Intensity (S×O)</div>
          <div
            className={`mt-0.5 text-lg font-bold font-mono tabular-nums ${getIntensityBand(summaryKpis.peakSo).textClass}`}
          >
            {summaryKpis.peakSo}
            <span className="text-[11px] font-sans font-semibold ml-1.5">
              {getIntensityBand(summaryKpis.peakSo).label}
            </span>
          </div>
        </div>

        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#15151E]">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Mean Intensity</div>
          <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {summaryKpis.avgSo.toFixed(1)}
            <span className="text-[11px] font-normal text-zinc-400 ml-1">/ 100</span>
          </div>
        </div>

        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#15151E]">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Mapped Risks</div>
          <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {summaryKpis.incidentCount}
          </div>
        </div>

        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#15151E]">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Elevated Zones (≥36)</div>
          <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {summaryKpis.criticalRooms}
            <span className="text-[11px] font-normal text-zinc-400 ml-1">
              / {summaryKpis.totalRooms}
            </span>
          </div>
        </div>

        <div className="col-span-2 lg:col-span-1 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#15151E] flex flex-col justify-center">
          <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 px-1">
            Risk Intensity Scale (S × O)
          </div>
          <svg ref={legendRef} className="w-full h-8" />
        </div>
      </div>

      {/* Main D3 Interactive Floor Plan Heatmap Viewport */}
      <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-[#0B0B10] overflow-hidden">
        {/* Zoom Controls */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 p-1 rounded-xl bg-white/95 dark:bg-[#16161F]/95 border border-zinc-200 dark:border-zinc-700 shadow-sm">
          <button
            type="button"
            onClick={() => handleZoomStep(1.25)}
            className="p-1.5 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleZoomStep(0.8)}
            className="p-1.5 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleZoomReset}
            className="p-1.5 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            title="Reset Pan & Zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Live Hover Inspector Overlay */}
        {(hoveredHotspot || hoveredRoom) && (
          <div className="absolute bottom-3 left-3 z-10 max-w-xs sm:max-w-sm p-3 rounded-xl bg-white/95 dark:bg-[#14141D]/95 border border-zinc-200 dark:border-zinc-700 shadow-lg text-xs pointer-events-none space-y-1">
            {hoveredHotspot ? (
              <>
                <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="font-bold text-violet-600 dark:text-violet-300">
                    {hoveredHotspot.incident.code} · {hoveredHotspot.incident.targetCode}
                  </span>
                  <span
                    className={`font-bold tabular-nums ${getIntensityBand(hoveredHotspot.intensity).textClass}`}
                  >
                    S×O {hoveredHotspot.intensity} (S:{hoveredHotspot.incident.severity} × O:
                    {hoveredHotspot.incident.occurrence})
                  </span>
                </div>
                <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {hoveredHotspot.incident.title}
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {hoveredHotspot.incident.targetName} · RPN {hoveredHotspot.incident.rpn} · Click to inspect &amp; resolve
                </div>
              </>
            ) : (
              hoveredRoom && (
                <>
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">
                      {hoveredRoom.room.code} · {hoveredRoom.floor.code}
                    </span>
                    <span
                      className={`font-bold tabular-nums ${getIntensityBand(hoveredRoom.peakIntensity).textClass}`}
                    >
                      Peak S×O {hoveredRoom.peakIntensity}
                    </span>
                  </div>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {hoveredRoom.room.name}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {hoveredRoom.room.environmental.cleanroomGrade} · {hoveredRoom.incidents.length}{' '}
                    risk{hoveredRoom.incidents.length === 1 ? '' : 's'}
                    {hoveredRoom.maxRpn > 0 ? ` · Max RPN ${hoveredRoom.maxRpn}` : ''}
                  </div>
                </>
              )
            )}
          </div>
        )}

        <svg
          ref={svgRef}
          className="w-full h-[360px] sm:h-[430px] block select-none cursor-grab active:cursor-grabbing"
        />
      </div>

      {/* Ranked Risk Intensity Table across Facility Zones */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-500" />
            Facility Risk Hotspots Ranked by Intensity (Severity × Occurrence)
          </div>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Click any risk to open FMEA &amp; CAPA
          </span>
        </div>

        {mappedHotspots.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 text-center">
            No risk incidents match the active filter. Toggle &ldquo;All History&rdquo; to inspect mitigated records.
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-x-auto bg-white dark:bg-[#14141B]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#191922] text-[11px] text-zinc-500 dark:text-zinc-400">
                  <th className="px-3 py-2 font-semibold">Incident &amp; Target</th>
                  <th className="px-3 py-2 font-semibold">Floor</th>
                  <th className="px-3 py-2 font-semibold text-right">S × O</th>
                  <th className="px-3 py-2 font-semibold text-right">RPN</th>
                  <th className="px-3 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {Array.from(
                  new Map(
                    mappedHotspots
                      .filter((h) => floorsToRender.some((f) => f.id === h.floorId))
                      .map((h) => [h.incident.id, h])
                  ).values()
                )
                  .sort((a, b) => b.intensity - a.intensity || b.incident.rpn - a.incident.rpn)
                  .slice(0, 12)
                  .map((spot) => {
                    const fl = scene.floors.find((f) => f.id === spot.floorId);
                    const band = getIntensityBand(spot.intensity);
                    const prio = getRpnPriority(spot.incident.rpn);
                    return (
                      <tr
                        key={spot.incident.id}
                        onClick={() => onSelectIncident?.(spot.incident)}
                        className="hover:bg-violet-500/5 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2">
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {spot.incident.title}
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                            {spot.incident.code} · {spot.incident.targetCode} · {spot.incident.targetName}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                          {fl?.code ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <span className={`font-bold ${band.textClass}`}>{spot.intensity}</span>
                          <span className="text-[10px] text-zinc-400 ml-1">
                            ({spot.incident.severity}×{spot.incident.occurrence})
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <span className={`font-bold ${prio.textClass}`}>{spot.incident.rpn}</span>
                        </td>
                        <td
                          className="px-3 py-2 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1">
                            {onNavigate3D && (
                              <button
                                type="button"
                                onClick={() => onNavigate3D(spot.incident)}
                                className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-violet-500 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1 cursor-pointer"
                                title="Focus in 3D"
                              >
                                <Box className="w-3 h-3" />
                                3D
                              </button>
                            )}
                            {spot.assetId && onOpenAssetPdf && (
                              <button
                                type="button"
                                onClick={() => onOpenAssetPdf(spot.assetId!)}
                                className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1 cursor-pointer"
                                title="Generate Asset FMEA & GMP PDF Report"
                              >
                                <FileText className="w-3 h-3 text-emerald-500" />
                                PDF
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
