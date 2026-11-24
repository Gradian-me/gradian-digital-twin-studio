import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  Database,
  KeyRound,
  Link2,
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface SchemaColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  isUnique?: boolean;
}

interface SchemaTable {
  name: string;
  description: string;
  columns: SchemaColumn[];
}

interface SchemaRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onDelete: string;
  cardinality: string;
}

interface SchemaPayload {
  source: 'live' | 'blueprint';
  tables: SchemaTable[];
  relations: SchemaRelation[];
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  table: SchemaTable;
  x: number;
  y: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  rel: SchemaRelation;
}

export const SchemaVisualizerD3: React.FC = () => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [schema, setSchema] = useState<SchemaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTableName, setSelectedTableName] = useState<string>('projects');

  const fetchSchema = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/schema');
      if (!res.ok) throw new Error('Unable to load Cloud SQL schema.');
      const data: SchemaPayload = await res.json();
      setSchema(data);
      if (data.tables.length > 0 && !data.tables.some((t) => t.name === selectedTableName)) {
        setSelectedTableName(data.tables[0].name);
      }
    } catch (err: any) {
      setError(err?.message || 'Schema introspection failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchema();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !schema) return;

    const width = svgEl.clientWidth || 292;
    const height = 270;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    // Defs for directional FK arrowheads
    const defs = svg.append('defs');
    defs
      .append('marker')
      .attr('id', 'fk-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 28)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', '#10B981');

    defs
      .append('marker')
      .attr('id', 'fk-arrow-muted')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 28)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', '#52525B');

    const rootG = svg.append('g');

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 2.4])
      .on('zoom', (event) => {
        rootG.attr('transform', event.transform.toString());
      });
    zoomRef.current = zoomBehavior;
    svg.call(zoomBehavior);

    // Deterministic clean architectural initial positions
    const presetPos: Record<string, [number, number]> = {
      users: [width * 0.5, 42],
      projects: [width * 0.28, 136],
      project_snapshots: [width * 0.28, 224],
      custom_templates: [width * 0.74, 136],
      custom_materials: [width * 0.74, 224],
    };

    const nodes: GraphNode[] = schema.tables.map((t, idx) => {
      const preset = presetPos[t.name];
      const angle = (idx / Math.max(1, schema.tables.length)) * Math.PI * 2;
      return {
        id: t.name,
        table: t,
        x: preset ? preset[0] : width / 2 + Math.cos(angle) * 90,
        y: preset ? preset[1] : height / 2 + Math.sin(angle) * 70,
      };
    });

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const links: GraphLink[] = schema.relations
      .filter((r) => nodeById.has(r.fromTable) && nodeById.has(r.toTable))
      .map((r) => ({
        source: r.fromTable,
        target: r.toTable,
        rel: r,
      }));

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(92)
          .strength(0.35)
      )
      .force('charge', d3.forceManyBody().strength(-260))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius(52))
      .alpha(0.35)
      .alphaDecay(0.06);

    const linkGroup = rootG.append('g').attr('class', 'links');
    const linkPaths = linkGroup
      .selectAll('path')
      .data(links)
      .enter()
      .append('path')
      .attr('fill', 'none')
      .attr('stroke-width', (d) => {
        const s = typeof d.source === 'string' ? d.source : d.source.id;
        const t = typeof d.target === 'string' ? d.target : d.target.id;
        return s === selectedTableName || t === selectedTableName ? 2 : 1.25;
      })
      .attr('stroke', (d) => {
        const s = typeof d.source === 'string' ? d.source : d.source.id;
        const t = typeof d.target === 'string' ? d.target : d.target.id;
        return s === selectedTableName || t === selectedTableName ? '#10B981' : '#52525B';
      })
      .attr('stroke-dasharray', (d) => (d.rel.fromColumn === 'owner_uid' ? '4 2' : 'none'))
      .attr('marker-end', (d) => {
        const s = typeof d.source === 'string' ? d.source : d.source.id;
        const t = typeof d.target === 'string' ? d.target : d.target.id;
        return s === selectedTableName || t === selectedTableName
          ? 'url(#fk-arrow)'
          : 'url(#fk-arrow-muted)';
      });

    const linkLabels = linkGroup
      .selectAll('text')
      .data(links)
      .enter()
      .append('text')
      .attr('font-size', 8.5)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('fill', '#A1A1AA')
      .attr('text-anchor', 'middle')
      .text((d) => `${d.rel.cardinality} · ${d.rel.fromColumn}`);

    const nodeW = 118;
    const nodeH = 40;

    const nodeGroups = rootG
      .append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .style('cursor', 'grab')
      .on('click', (_event, d) => {
        setSelectedTableName(d.id);
      })
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Table Card Rectangle
    nodeGroups
      .append('rect')
      .attr('x', -nodeW / 2)
      .attr('y', -nodeH / 2)
      .attr('width', nodeW)
      .attr('height', nodeH)
      .attr('rx', 7)
      .attr('fill', (d) => (d.id === selectedTableName ? '#18181B' : '#111114'))
      .attr('stroke', (d) => (d.id === selectedTableName ? '#10B981' : '#3F3F46'))
      .attr('stroke-width', (d) => (d.id === selectedTableName ? 1.8 : 1));

    // Top accent strip for PK table
    nodeGroups
      .append('rect')
      .attr('x', -nodeW / 2 + 1)
      .attr('y', -nodeH / 2 + 1)
      .attr('width', nodeW - 2)
      .attr('height', 4)
      .attr('rx', 2)
      .attr('fill', (d) => (d.id === 'users' ? '#3B82F6' : d.id === selectedTableName ? '#10B981' : '#27272A'));

    // Table name
    nodeGroups
      .append('text')
      .attr('y', -1)
      .attr('text-anchor', 'middle')
      .attr('font-size', 10)
      .attr('font-weight', 600)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('fill', '#F4F4F5')
      .text((d) => d.id);

    // Column & FK count subtitle
    nodeGroups
      .append('text')
      .attr('y', 12)
      .attr('text-anchor', 'middle')
      .attr('font-size', 8.5)
      .attr('font-family', 'DM Sans, sans-serif')
      .attr('fill', '#A1A1AA')
      .text((d) => {
        const fks = d.table.columns.filter((c) => c.isForeignKey).length;
        return `${d.table.columns.length} cols${fks ? ` · ${fks} FK` : ' · root'}`;
      });

    simulation.on('tick', () => {
      linkPaths.attr('d', (d) => {
        const s = d.source as GraphNode;
        const t = d.target as GraphNode;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dr = Math.hypot(dx, dy) * 1.4;
        return `M${s.x},${s.y}A${dr},${dr} 0 0,1 ${t.x},${t.y}`;
      });

      linkLabels
        .attr('x', (d) => ((d.source as GraphNode).x + (d.target as GraphNode).x) / 2)
        .attr('y', (d) => ((d.source as GraphNode).y + (d.target as GraphNode).y) / 2 - 4);

      nodeGroups.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [schema, selectedTableName]);

  const handleZoom = (factor: number) => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(180).call(zoomRef.current.scaleBy, factor);
  };

  const handleResetZoom = () => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(220)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  };

  const selectedTable = schema?.tables.find((t) => t.name === selectedTableName) ?? null;
  const relatedEdges =
    schema?.relations.filter(
      (r) => r.fromTable === selectedTableName || r.toTable === selectedTableName
    ) ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-emerald-500" />
            Cloud SQL Schema Graph
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {schema ? `${schema.tables.length} tables · ${schema.relations.length} FK relations` : 'Loading schema...'}
          </p>
        </div>
        <button
          onClick={fetchSchema}
          className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
          title="Refresh Cloud SQL schema introspection"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 text-[11px]">
          {error}
        </div>
      )}

      {/* Interactive D3 Force-Directed Relational Diagram */}
      <div className="relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-[#0B0B0D] overflow-hidden charcoal-grid">
        <svg ref={svgRef} className="w-full h-[270px] block" />

        {/* Subtle Zoom / Fit Controls */}
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-[#141417]/90 border border-zinc-800 rounded-md p-0.5">
          <button
            onClick={() => handleZoom(1.25)}
            className="p-1 text-zinc-400 hover:text-white"
            title="Zoom In"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
          <button
            onClick={() => handleZoom(0.8)}
            className="p-1 text-zinc-400 hover:text-white"
            title="Zoom Out"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <button
            onClick={handleResetZoom}
            className="p-1 text-zinc-400 hover:text-white"
            title="Reset View"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>

        <div className="absolute bottom-2 left-2.5 text-[10px] font-mono text-zinc-500 pointer-events-none">
          Drag tables · Scroll to zoom · Click to inspect
        </div>
      </div>

      {/* Table Selector Strip */}
      {schema && (
        <div className="flex flex-wrap gap-1">
          {schema.tables.map((t) => (
            <button
              key={t.name}
              onClick={() => setSelectedTableName(t.name)}
              className={`px-2 py-1 rounded-md font-mono text-[10px] border transition-colors ${
                t.name === selectedTableName
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Selected Table Column & Foreign Key Details */}
      {selectedTable && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#141417] overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
            <div className="font-mono font-semibold text-zinc-900 dark:text-white">
              public.{selectedTable.name}
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              {selectedTable.description}
            </p>
          </div>

          <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
            {selectedTable.columns.map((col) => (
              <div
                key={col.name}
                className="px-3 py-1.5 flex items-center justify-between gap-2 font-mono text-[11px]"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {col.isPrimaryKey ? (
                    <KeyRound className="w-3 h-3 text-amber-500 shrink-0" />
                  ) : col.isForeignKey ? (
                    <Link2 className="w-3 h-3 text-emerald-500 shrink-0" />
                  ) : (
                    <span className="w-3 text-center text-zinc-500">·</span>
                  )}
                  <span className="text-zinc-900 dark:text-zinc-100 truncate">{col.name}</span>
                </div>
                <span className="text-zinc-500 dark:text-zinc-400 shrink-0">
                  {col.dataType}
                  {col.isPrimaryKey ? ' PK' : col.isForeignKey ? ' FK' : ''}
                </span>
              </div>
            ))}
          </div>

          {relatedEdges.length > 0 && (
            <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-100/60 dark:bg-[#0E0E11] space-y-1">
              <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                Foreign Key Relationships
              </div>
              {relatedEdges.map((r, i) => (
                <div
                  key={i}
                  className="font-mono text-[10px] text-zinc-700 dark:text-zinc-300 flex items-center justify-between gap-2"
                >
                  <span className="truncate">
                    {r.fromTable}.{r.fromColumn} → {r.toTable}.{r.toColumn}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 shrink-0">
                    {r.cardinality} · {r.onDelete}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
