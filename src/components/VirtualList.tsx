import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface VirtualListProps<T> {
  items: readonly T[];
  itemHeight: number;
  overscan?: number;
  gap?: number;
  className?: string;
  innerClassName?: string;
  getKey?: (item: T, index: number) => React.Key;
  renderItem: (item: T, index: number) => React.ReactNode;
  emptyState?: React.ReactNode;
  resetScrollKey?: string | number;
  maxHeight?: number | string;
}

/**
 * Lightweight, zero-dependency windowed list backed by ResizeObserver + rAF scroll coalescing.
 * Renders only visible rows plus overscan buffer so hundreds/thousands of tags, assets, and flows stay 60fps.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  overscan = 6,
  gap = 0,
  className = '',
  innerClassName = '',
  getKey,
  renderItem,
  emptyState = null,
  resetScrollKey,
  maxHeight,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  const stride = Math.max(1, itemHeight + gap);
  const totalHeight = items.length > 0 ? items.length * stride - gap : 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const h = el.clientHeight;
      if (h > 0) setViewportHeight(h);
    };
    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setScrollTop(0);
  }, [resetScrollKey]);

  // Clamp scrollTop if list shrinks significantly
  useEffect(() => {
    const maxScroll = Math.max(0, totalHeight - viewportHeight);
    if (scrollTop > maxScroll && containerRef.current) {
      containerRef.current.scrollTop = maxScroll;
      setScrollTop(maxScroll);
    }
  }, [totalHeight, viewportHeight, scrollTop]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const nextTop = e.currentTarget.scrollTop;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setScrollTop(nextTop);
    });
  }, []);

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    if (items.length === 0) {
      return { startIndex: 0, endIndex: -1, offsetY: 0 };
    }
    const rawStart = Math.floor(scrollTop / stride);
    const visibleCount = Math.ceil(viewportHeight / stride);
    const start = Math.max(0, rawStart - overscan);
    const end = Math.min(items.length - 1, rawStart + visibleCount + overscan);
    return {
      startIndex: start,
      endIndex: end,
      offsetY: start * stride,
    };
  }, [items.length, scrollTop, stride, viewportHeight, overscan]);

  if (items.length === 0) {
    return (
      <div
        ref={containerRef}
        className={`overflow-y-auto overscroll-contain touch-pan-y ${className}`}
        style={maxHeight !== undefined ? { maxHeight } : undefined}
      >
        {emptyState}
      </div>
    );
  }

  const visibleSlice: React.ReactNode[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const item = items[i];
    const key = getKey ? getKey(item, i) : i;
    visibleSlice.push(
      <div
        key={key}
        style={{
          height: itemHeight,
          marginBottom: i < items.length - 1 ? gap : 0,
          boxSizing: 'border-box',
        }}
      >
        {renderItem(item, i)}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`overflow-y-auto overscroll-contain touch-pan-y ${className}`}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <div
        className={`relative w-full ${innerClassName}`}
        style={{ height: totalHeight }}
      >
        <div
          className="absolute inset-x-0 top-0 will-change-transform"
          style={{ transform: `translate3d(0, ${offsetY}px, 0)` }}
        >
          {visibleSlice}
        </div>
      </div>
    </div>
  );
}

export interface VirtualGridProps<T> {
  items: readonly T[];
  rowHeight: number;
  minColumnWidth?: number;
  maxColumns?: number;
  gap?: number;
  overscanRows?: number;
  className?: string;
  paddingClassName?: string;
  getKey?: (item: T, index: number) => React.Key;
  renderItem: (item: T, index: number) => React.ReactNode;
  emptyState?: React.ReactNode;
  resetScrollKey?: string | number;
}

/**
 * Windowed responsive grid for high-density equipment matrices and asset card directories.
 */
export function VirtualGrid<T>({
  items,
  rowHeight,
  minColumnWidth = 280,
  maxColumns = 4,
  gap = 12,
  overscanRows = 3,
  className = '',
  paddingClassName = '',
  getKey,
  renderItem,
  emptyState = null,
  resetScrollKey,
}: VirtualGridProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [size, setSize] = useState({ width: 960, height: 520 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }
    };
    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setScrollTop(0);
  }, [resetScrollKey]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const nextTop = e.currentTarget.scrollTop;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setScrollTop(nextTop);
    });
  }, []);

  const columns = useMemo(() => {
    const usableWidth = Math.max(240, size.width - 32);
    const computed = Math.floor((usableWidth + gap) / (minColumnWidth + gap));
    return Math.max(1, Math.min(maxColumns, computed));
  }, [size.width, minColumnWidth, maxColumns, gap]);

  const rowCount = Math.ceil(items.length / columns);
  const stride = Math.max(1, rowHeight + gap);
  const totalHeight = rowCount > 0 ? rowCount * stride - gap : 0;

  const { startRow, endRow, offsetY } = useMemo(() => {
    if (rowCount === 0) return { startRow: 0, endRow: -1, offsetY: 0 };
    const rawStart = Math.floor(scrollTop / stride);
    const visibleRows = Math.ceil(size.height / stride);
    const start = Math.max(0, rawStart - overscanRows);
    const end = Math.min(rowCount - 1, rawStart + visibleRows + overscanRows);
    return { startRow: start, endRow: end, offsetY: start * stride };
  }, [rowCount, scrollTop, stride, size.height, overscanRows]);

  if (items.length === 0) {
    return (
      <div ref={containerRef} className={`overflow-y-auto overscroll-contain touch-pan-y ${className}`}>
        {emptyState}
      </div>
    );
  }

  const rows: React.ReactNode[] = [];
  for (let r = startRow; r <= endRow; r++) {
    const rowCells: React.ReactNode[] = [];
    const baseIdx = r * columns;
    for (let c = 0; c < columns; c++) {
      const idx = baseIdx + c;
      if (idx >= items.length) break;
      const item = items[idx];
      const key = getKey ? getKey(item, idx) : idx;
      rowCells.push(
        <div key={key} className="min-w-0 h-full">
          {renderItem(item, idx)}
        </div>
      );
    }
    rows.push(
      <div
        key={`row-${r}`}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap,
          height: rowHeight,
          marginBottom: r < rowCount - 1 ? gap : 0,
        }}
      >
        {rowCells}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`overflow-y-auto overscroll-contain touch-pan-y ${className}`}
    >
      <div className={paddingClassName}>
        <div className="relative w-full" style={{ height: totalHeight }}>
          <div
            className="absolute inset-x-0 top-0 will-change-transform"
            style={{ transform: `translate3d(0, ${offsetY}px, 0)` }}
          >
            {rows}
          </div>
        </div>
      </div>
    </div>
  );
}
