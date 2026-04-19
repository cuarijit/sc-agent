import React, { useMemo, useRef } from "react";

import EChartBase, { type EChartOption } from "./EChartBase";
import { compactTick, defaultFieldFormatter, type FieldFormatter, usesFieldFormatter } from "./formatters";
import { intentFromBarClick } from "./selection";
import type { ChartCommonProps, SelectionIntent } from "./types";

export type BarSeriesDef = {
  field: string;
  label: string;
  color?: string;
  stacked?: boolean;
};

export interface BarChartProps extends ChartCommonProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: BarSeriesDef[];
  xLabel?: string;
  horizontal?: boolean;
  formatField?: FieldFormatter;
}

export default function BarChart({
  chartId,
  data,
  xKey,
  series,
  xLabel,
  horizontal = false,
  height = 280,
  loading,
  empty,
  emptyLabel,
  ariaLabel,
  formatField = defaultFieldFormatter,
  selectionFields,
  onSelectionChange,
}: BarChartProps) {
  const lastSelectedRef = useRef<Array<string | number>>([]);

  const option = useMemo<EChartOption>(() => {
    const xData = data.map((r) => r[xKey]);
    const yAnchor = series[0]?.field ?? "";
    const yUsesFmt = usesFieldFormatter(yAnchor, formatField);
    const labelAxis: EChartOption = {
      type: "category",
      data: xData,
      name: xLabel,
      nameLocation: "middle",
      nameGap: 30,
      axisLabel: { formatter: (v: unknown) => formatField(xKey, v) },
    };
    const valueAxis: EChartOption = {
      type: "value",
      axisLabel: {
        formatter: (v: unknown) => (yUsesFmt ? formatField(yAnchor, v) : compactTick(v)),
      },
    };

    return {
      grid: { left: horizontal ? 96 : 56, right: 24, top: 24, bottom: 48, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v: unknown) => (yAnchor ? formatField(yAnchor, v) : String(v ?? "")),
      },
      legend: { bottom: 0, type: "scroll", textStyle: { fontSize: 10 } },
      xAxis: horizontal ? valueAxis : labelAxis,
      yAxis: horizontal ? labelAxis : valueAxis,
      series: series.map((s, i) => ({
        id: `${chartId}_${s.field}_${i}`,
        name: s.label,
        type: "bar",
        stack: s.stacked ? "stack" : undefined,
        itemStyle: s.color ? { color: s.color } : undefined,
        data: data.map((r) => r[s.field]),
        emphasis: { focus: "series" },
      })),
    };
  }, [chartId, data, xKey, series, xLabel, horizontal, formatField]);

  const onEvents = useMemo(() => {
    if (!onSelectionChange || !selectionFields?.categoryField) return undefined;
    return {
      click: (p: unknown) => {
        const params = p as { name?: string | number; event?: { event?: MouseEvent } };
        if (params?.name == null) return;
        const modifier = !!(params.event?.event && (params.event.event.ctrlKey || params.event.event.metaKey));
        const intent: SelectionIntent | null = intentFromBarClick({
          categoryName: params.name,
          categoryField: selectionFields.categoryField,
          modifierKey: modifier,
          previousValues: lastSelectedRef.current,
        });
        if (intent?.kind === "multi") lastSelectedRef.current = intent.values;
        else if (intent?.kind === "equality") lastSelectedRef.current = [intent.value];
        else lastSelectedRef.current = [];
        onSelectionChange(intent);
      },
    };
  }, [onSelectionChange, selectionFields]);

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
