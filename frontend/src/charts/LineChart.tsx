import React, { useMemo, useRef } from "react";

import EChartBase, { type EChartOption } from "./EChartBase";
import { compactTick, defaultFieldFormatter, type FieldFormatter, usesFieldFormatter } from "./formatters";
import {
  intentFromBarClick,
  intentFromXAxisBrush,
} from "./selection";
import type { ChartCommonProps, SelectionIntent } from "./types";

/**
 * Per-series config for the LineChart wrapper. This wrapper is intentionally
 * composed-capable — a single chart config can mix `line`, `bar`, and `area`
 * series on the same cartesian grid (matches legacy recharts `ComposedChart`
 * behavior). Pure-line / pure-bar / pure-area charts also flow through here.
 */
export type LineSeriesDef = {
  field: string;
  label: string;
  /** Per-series render type. Defaults to "line". */
  type?: "line" | "bar" | "area";
  color?: string;
  strokeWidth?: number;
  strokeDasharray?: "" | "dashed" | "dotted" | "solid";
  showDot?: boolean;
  dotSize?: number;
  stacked?: boolean;
  /** Legacy alias for `type: "area"` used by the AreaChart convenience wrapper. */
  area?: boolean;
};

export interface LineChartProps extends ChartCommonProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: LineSeriesDef[];
  xLabel?: string;
  formatField?: FieldFormatter;
  /** Forces every series to render as area (convenience AreaChart wrapper). */
  renderAsArea?: boolean;
  /** Disable smooth curves (sharp lines). Default: smooth on. */
  sharp?: boolean;
}

function echartsDashType(kind?: string): "solid" | "dashed" | "dotted" | undefined {
  if (kind === "dashed") return "dashed";
  if (kind === "dotted") return "dotted";
  if (kind === "solid" || kind === "") return "solid";
  return undefined;
}

function effectiveSeriesType(s: LineSeriesDef, renderAsArea?: boolean): "line" | "bar" | "area" {
  if (renderAsArea) return "area";
  if (s.area) return "area";
  if (s.type === "bar") return "bar";
  if (s.type === "area") return "area";
  return "line";
}

export default function LineChart({
  chartId,
  data,
  xKey,
  series,
  xLabel,
  height = 280,
  loading,
  empty,
  emptyLabel,
  ariaLabel,
  formatField = defaultFieldFormatter,
  renderAsArea,
  sharp,
  selectionFields,
  onSelectionChange,
}: LineChartProps) {
  const lastSelectedRef = useRef<Array<string | number>>([]);

  const option = useMemo<EChartOption>(() => {
    const xData = data.map((r) => r[xKey]);
    const yAnchor = series[0]?.field ?? "";
    const yUsesFmt = usesFieldFormatter(yAnchor, formatField);

    const echartsSeries = series.map((s, i) => {
      const effType = effectiveSeriesType(s, renderAsArea);
      const isBar = effType === "bar";
      const isArea = effType === "area";
      const seriesType: "line" | "bar" = isBar ? "bar" : "line";

      const common = {
        id: `${chartId}_${s.field}_${i}`,
        name: s.label,
        type: seriesType,
        stack: s.stacked ? "stack" : undefined,
        itemStyle: s.color ? { color: s.color } : undefined,
        data: data.map((r) => r[s.field]),
        emphasis: { focus: "series" },
      } as Record<string, unknown>;

      if (isBar) {
        return {
          ...common,
          barMaxWidth: 36,
          itemStyle: { ...(s.color ? { color: s.color } : {}), borderRadius: [2, 2, 0, 0] },
        };
      }

      return {
        ...common,
        smooth: !sharp,
        smoothMonotone: "x",
        showSymbol: s.showDot !== false,
        symbolSize: (s.dotSize ?? 4) + 2,
        symbol: "circle",
        lineStyle: {
          width: s.strokeWidth ?? 2,
          type: echartsDashType(s.strokeDasharray ?? "solid"),
          ...(s.color ? { color: s.color } : {}),
        },
        ...(isArea
          ? {
              areaStyle: {
                opacity: 0.25,
                ...(s.color ? { color: s.color } : {}),
              },
            }
          : {}),
      };
    });

    const hasBrush = !!(selectionFields?.xField && onSelectionChange);

    return {
      grid: { left: 56, right: 24, top: 24, bottom: 48, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (v: unknown) => (yAnchor ? formatField(yAnchor, v) : String(v ?? "")),
      },
      legend: {
        bottom: 0,
        type: "scroll",
        textStyle: { fontSize: 10 },
      },
      xAxis: {
        type: "category",
        data: xData,
        name: xLabel,
        nameLocation: "middle",
        nameGap: 30,
        boundaryGap: echartsSeries.some((s) => (s as { type?: string }).type === "bar"),
        axisLabel: { formatter: (v: unknown) => formatField(xKey, v) },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          formatter: (v: unknown) => (yUsesFmt ? formatField(yAnchor, v) : compactTick(v)),
        },
      },
      brush: hasBrush
        ? {
            xAxisIndex: 0,
            brushType: "lineX",
            throttleType: "debounce",
            throttleDelay: 120,
            brushMode: "single",
          }
        : undefined,
      toolbox: hasBrush
        ? { feature: { brush: { type: ["lineX", "clear"] } }, right: 8, top: 0, itemSize: 12 }
        : undefined,
      series: echartsSeries,
    };
  }, [chartId, data, xKey, series, xLabel, formatField, renderAsArea, sharp, selectionFields, onSelectionChange]);

  const onEvents = useMemo(() => {
    if (!onSelectionChange) return undefined;
    const handlers: Record<string, (p: unknown) => void> = {};
    if (selectionFields?.xField) {
      // `brush` fires on every brush-state change, including the toolbox
      // "clear" button (which `brushEnd` does NOT fire for). Watch for empty
      // areas here and translate into a cross-filter clear.
      handlers.brush = (p: unknown) => {
        const params = p as { areas?: unknown[] };
        if (!params.areas || params.areas.length === 0) {
          // eslint-disable-next-line no-console
          console.info("[chart:brush-clear]", chartId);
          onSelectionChange(null);
        }
      };
      handlers.brushEnd = (p: unknown) => {
        const params = p as { areas?: Array<{ coordRange?: Array<number | string> }> };
        const area = params.areas?.[0];
        // ECharts fires brushEnd with empty `areas` when the toolbox "clear"
        // button is pressed — translate to `null` so the hook removes this
        // chart's contribution from the cross-filter.
        if (!area?.coordRange || area.coordRange.length < 2) {
          // eslint-disable-next-line no-console
          console.info("[chart:brush-clear]", chartId);
          onSelectionChange(null);
          return;
        }
        // ECharts returns coordRange as category INDICES for a category x-axis.
        // Translate back to the underlying row values so the backend receives the
        // real date / numeric bounds rather than array positions.
        const xData = data.map((r) => r[xKey]);
        const resolveBound = (v: number | string): number | string => {
          if (typeof v === "number" && Number.isInteger(v) && xData[v] != null) {
            return xData[v] as number | string;
          }
          if (typeof v === "string" && /^\d+$/.test(v)) {
            const idx = Number(v);
            if (xData[idx] != null) return xData[idx] as number | string;
          }
          return v;
        };
        const minVal = resolveBound(area.coordRange[0]);
        const maxVal = resolveBound(area.coordRange[1]);
        // Detect whether the x-axis holds date strings so we can tag the intent.
        const sample = xData.find((v) => v != null);
        const isDateLike = typeof sample === "string" && /^\d{4}-\d{2}-\d{2}/.test(sample);
        const kindHint: "date" | "number" = isDateLike ? "date" : "number";
        const intent: SelectionIntent | null = intentFromXAxisBrush([minVal, maxVal], selectionFields.xField, kindHint);
        // eslint-disable-next-line no-console
        console.info("[chart:brush]", chartId, intent);
        onSelectionChange(intent);
      };
    }
    if (selectionFields?.categoryField || selectionFields?.xField) {
      const categoryField = selectionFields.categoryField ?? selectionFields.xField!;
      handlers.click = (p: unknown) => {
        const params = p as { name?: string | number; event?: { event?: MouseEvent } };
        if (params?.name == null || params.name === "") return;
        const modifier = !!(params.event?.event && (params.event.event.ctrlKey || params.event.event.metaKey));
        const intent = intentFromBarClick({
          categoryName: params.name,
          categoryField,
          modifierKey: modifier,
          previousValues: lastSelectedRef.current,
        });
        if (intent?.kind === "multi") lastSelectedRef.current = intent.values;
        else if (intent?.kind === "equality") lastSelectedRef.current = [intent.value];
        else lastSelectedRef.current = [];
        // eslint-disable-next-line no-console
        console.info("[chart:click]", chartId, intent);
        onSelectionChange(intent);
      };
    }
    return handlers;
  }, [chartId, onSelectionChange, selectionFields]);

  return (
    <EChartBase
      option={option}
      height={height}
      loading={loading}
      empty={empty || data.length === 0}
      emptyLabel={emptyLabel}
      ariaLabel={ariaLabel}
      onEvents={onEvents}
    />
  );
}
