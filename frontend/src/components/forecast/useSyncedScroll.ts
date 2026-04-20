import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps an ECharts `dataZoom` viewport and a horizontally-scrollable grid in
 * lockstep. The source of truth is a [startPct, endPct] window expressed as
 * a percentage of the total buckets. Either side can push updates; the
 * `isUserDrivenRef` guard prevents feedback loops where the apply effect
 * re-fires the onChange handlers.
 */
export interface SyncedScrollApi {
  /** Percentage window [start, end] in 0..100 space. */
  window: [number, number];
  /** Attach to the grid scroll container. */
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** Register the ECharts instance (call from onInstanceReady). */
  setChartInstance: (instance: unknown | null) => void;
  /** Invoke when the chart dataZoom event fires. */
  onChartZoom: (start: number, end: number) => void;
  /** Invoke when the grid scrolls. */
  onGridScroll: (scrollLeft: number, scrollWidth: number, clientWidth: number) => void;
}

export function useSyncedScroll(bucketCount: number): SyncedScrollApi {
  const [window, setWindow] = useState<[number, number]>([0, 100]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<unknown | null>(null);
  const isUserDrivenRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  // Clamp window when bucket count shrinks below visible range
  useEffect(() => {
    if (bucketCount <= 0) return;
    setWindow(([s, e]) => {
      const clampedE = Math.min(100, Math.max(5, e));
      const clampedS = Math.max(0, Math.min(clampedE - 5, s));
      if (clampedS === s && clampedE === e) return [s, e];
      return [clampedS, clampedE];
    });
  }, [bucketCount]);

  // Apply window to chart + grid whenever it changes (unless the change
  // originated from user scroll/zoom — those already have the UI in the
  // target state).
  useEffect(() => {
    if (isUserDrivenRef.current) {
      isUserDrivenRef.current = false;
      return;
    }
    const chart = chartInstanceRef.current as
      | { dispatchAction?: (a: Record<string, unknown>) => void }
      | null;
    if (chart?.dispatchAction) {
      chart.dispatchAction({ type: "dataZoom", start: window[0], end: window[1] });
    }
    const grid = gridRef.current;
    if (grid) {
      const max = grid.scrollWidth - grid.clientWidth;
      if (max > 0) {
        const target = (window[0] / 100) * max;
        if (Math.abs(grid.scrollLeft - target) > 2) grid.scrollLeft = target;
      }
    }
  }, [window]);

  const onChartZoom = useCallback((start: number, end: number) => {
    isUserDrivenRef.current = true;
    setWindow([start, end]);
  }, []);

  const onGridScroll = useCallback(
    (scrollLeft: number, scrollWidth: number, clientWidth: number) => {
      const max = scrollWidth - clientWidth;
      if (max <= 0) return;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const startPct = (scrollLeft / max) * 100;
        const span = window[1] - window[0];
        const endPct = Math.min(100, startPct + span);
        isUserDrivenRef.current = true;
        setWindow([startPct, endPct]);
      });
    },
    [window],
  );

  const setChartInstance = useCallback((instance: unknown | null) => {
    chartInstanceRef.current = instance;
  }, []);

  return { window, gridRef, setChartInstance, onChartZoom, onGridScroll };
}
