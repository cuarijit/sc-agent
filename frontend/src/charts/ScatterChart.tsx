import React, { useMemo } from "react";

import EChartBase, { type EChartOption } from "./EChartBase";
import { compactTick, defaultFieldFormatter, type FieldFormatter, usesFieldFormatter } from "./formatters";
import { intentFromScatterBrush } from "./selection";
import type { ChartCommonProps } from "./types";

export interface ScatterChartProps extends ChartCommonProps {
  data: Array<Record<string, unknown>>;
  xField: string;
  yField: string;
  sizeField?: string;
  xLabel?: string;
  yLabel?: string;
  /** Default point color when no per-point color rule matches. */
  defaultColor?: string;
  /** Per-point color override key stored on the row (e.g. "__bubbleColor"). */
  colorKey?: string;
  /** Tooltip fields (extras beyond xField/yField/sizeField). */
  tooltipFields?: string[];
  aliasOf?: (field: string) => string;
  formatField?: FieldFormatter;
  /** Min bubble radius (px) when sizing by field. If unset, density-aware default is used. */
  bubbleSizeMin?: number;
  /** Max bubble radius (px) when sizing by field. If unset, density-aware default is used. */
  bubbleSizeMax?: number;
  /** Fixed bubble radius (px) when no sizeField is provided. If unset, density-aware default is used. */
  bubbleSizeFixed?: number;
}

/**
 * Density-aware default max radius — shrinks as point count grows so dense
 * scatter plots don't turn into overlapping blobs.
 */
function autoMaxSize(n: number): number {
  if (n <= 50) return 26;
  if (n <= 150) return 20;
  if (n <= 400) return 14;
  if (n <= 1000) return 10;
  return 7;
}

function autoFixedSize(n: number): number {
  if (n <= 50) return 10;
  if (n <= 200) return 7;
  if (n <= 800) return 5;
  return 3.5;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function axisDomain(rows: Array<Record<string, unknown>>, field: string, p = 0.95): [number, number] {
  const vals = rows.map((r) => Number(r[field])).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return [0, 1];
  const lo = vals[0];
  const hi = percentile(vals, p);
  const range = hi - lo || 1;
  return [Math.min(0, lo), hi + range * 0.1];
}

export default function ScatterChart({
  chartId,
  data,
  xField,
  yField,
  sizeField,
  xLabel,
  yLabel,
  defaultColor = "#6366f1",
  colorKey = "__bubbleColor",
  tooltipFields = [],
  aliasOf = (f) => f,
  formatField = defaultFieldFormatter,
  height = 280,
  loading,
  empty,
  emptyLabel,
  ariaLabel,
  selectionFields,
  onSelectionChange,
  bubbleSizeMin,
  bubbleSizeMax,
  bubbleSizeFixed,
}: ScatterChartProps) {
  const option = useMemo<EChartOption>(() => {
    const xDomain = axisDomain(data, xField);
    const yDomain = axisDomain(data, yField);
    const sizes = sizeField ? data.map((r) => Number(r[sizeField])).filter((v) => Number.isFinite(v)) : [];
    const sizeMin = sizes.length ? Math.min(...sizes) : 0;
    const sizeMax = sizes.length ? Math.max(...sizes) : 1;
    const sizeRange = sizeMax - sizeMin || 1;
    const xUsesFmt = usesFieldFormatter(xField, formatField);
    const yUsesFmt = usesFieldFormatter(yField, formatField);

    const autoMax = autoMaxSize(data.length);
    const resolvedMax = Number.isFinite(bubbleSizeMax) && (bubbleSizeMax as number) > 0 ? (bubbleSizeMax as number) : autoMax;
    const defaultMin = Math.max(3, Math.round(autoMax * 0.3));
    const resolvedMin = Number.isFinite(bubbleSizeMin) && (bubbleSizeMin as number) > 0
      ? Math.min(bubbleSizeMin as number, resolvedMax)
      : Math.min(defaultMin, resolvedMax);
    const resolvedFixed = Number.isFinite(bubbleSizeFixed) && (bubbleSizeFixed as number) > 0
      ? (bubbleSizeFixed as number)
      : autoFixedSize(data.length);

    const seriesData = data.map((row) => {
      let size: number;
      if (sizeField) {
        const raw = Number(row[sizeField]);
        if (Number.isFinite(raw)) {
          const t = (raw - sizeMin) / sizeRange;
          size = resolvedMin + t * (resolvedMax - resolvedMin);
        } else {
          size = resolvedMin;
        }
      } else {
        size = resolvedFixed;
      }
      return {
        value: [row[xField], row[yField], sizeField ? row[sizeField] : null],
        itemStyle: { color: String(row[colorKey] ?? defaultColor) },
        symbolSize: size,
        __row: row,
      };
    });

    const tooltipFormatter = (params: { data: { __row: Record<string, unknown> } }) => {
      const row = params.data.__row;
      const fields = [...tooltipFields, xField, yField, ...(sizeField ? [sizeField] : [])].filter(Boolean);
      const rows = fields.map((f) => {
        const v = row[f];
        const fmt = v == null ? "–" : formatField(f, v);
        return `<div style="margin:2px 0;"><span style="opacity:0.7;margin-right:6px;">${aliasOf(f)}:</span><span>${fmt}</span></div>`;
      });
      return rows.join("");
    };

    return {
      grid: { left: 56, right: 24, top: 24, bottom: 40, containLabel: true },
      tooltip: { trigger: "item", formatter: tooltipFormatter },
      xAxis: {
        type: "value",
        name: xLabel ?? aliasOf(xField),
        nameLocation: "middle",
        nameGap: 28,
        min: xDomain[0],
        max: xDomain[1],
        axisLabel: { formatter: (v: unknown) => (xUsesFmt ? formatField(xField, v) : compactTick(v)) },
      },
      yAxis: {
        type: "value",
        name: yLabel ?? aliasOf(yField),
        nameLocation: "middle",
        nameGap: 44,
        min: yDomain[0],
        max: yDomain[1],
        axisLabel: { formatter: (v: unknown) => (yUsesFmt ? formatField(yField, v) : compactTick(v)) },
      },
      brush: onSelectionChange
        ? { xAxisIndex: 0, yAxisIndex: 0, brushType: "rect", throttleType: "debounce", throttleDelay: 120, brushMode: "single" }
        : undefined,
      toolbox: onSelectionChange
        ? { feature: { brush: { type: ["rect", "clear"] } }, right: 8, top: 0, itemSize: 12 }
        : undefined,
      series: [
        {
          id: `${chartId}_scatter`,
          type: "scatter",
          data: seriesData,
          emphasis: { focus: "series", scale: 1.2 },
        },
      ],
    };
  }, [chartId, data, xField, yField, sizeField, xLabel, yLabel, defaultColor, colorKey, tooltipFields, aliasOf, formatField, onSelectionChange, bubbleSizeMin, bubbleSizeMax, bubbleSizeFixed]);

  const onEvents = useMemo(() => {
    if (!onSelectionChange) return undefined;
    return {
      // `brush` fires on every brush state change including toolbox clear.
      brush: (p: unknown) => {
        const params = p as { areas?: unknown[] };
        if (!params.areas || params.areas.length === 0) {
          // eslint-disable-next-line no-console
          console.info("[chart:brush-clear]", chartId);
          onSelectionChange(null);
        }
      },
      brushEnd: (p: unknown) => {
        const params = p as { areas?: Array<{ coordRange?: number[][] }> };
        const area = params.areas?.[0];
        if (!area?.coordRange || area.coordRange.length < 2) {
          // eslint-disable-next-line no-console
          console.info("[chart:brush-clear]", chartId);
          onSelectionChange(null);
          return;
        }
        const [xr, yr] = area.coordRange;
        if (!xr || !yr) return;
        const intent = intentFromScatterBrush(
          { xMin: xr[0], xMax: xr[1], yMin: yr[0], yMax: yr[1] },
          selectionFields?.xField ?? xField,
          selectionFields?.yField ?? yField,
        );
        // eslint-disable-next-line no-console
        console.info("[chart:brush]", chartId, intent);
        onSelectionChange(intent);
      },
    };
  }, [chartId, onSelectionChange, selectionFields, xField, yField]);

  // Activate rect brush on mount so the user can just drag — no need to click
  // the toolbox button first. Scatter has no useful single-click gesture so
  // always-on brush is the primary interaction.
  const onInstanceReady = React.useCallback(
    (instance: unknown) => {
      if (!onSelectionChange) return;
      const echartsInstance = instance as { dispatchAction?: (action: Record<string, unknown>) => void };
      echartsInstance.dispatchAction?.({
        type: "takeGlobalCursor",
        key: "brush",
        brushOption: { brushType: "rect", brushMode: "single" },
      });
    },
    [onSelectionChange],
  );

  return (
    <EChartBase
      option={option}
      height={height}
      loading={loading}
      empty={empty || data.length === 0}
      emptyLabel={emptyLabel}
      ariaLabel={ariaLabel}
      onEvents={onEvents}
      onInstanceReady={onInstanceReady}
    />
  );
}
