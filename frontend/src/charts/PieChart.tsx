import React, { useMemo } from "react";

import { CHART_COLOR_PALETTE } from "./chartColors";

import EChartBase, { type EChartOption } from "./EChartBase";
import { defaultFieldFormatter, type FieldFormatter } from "./formatters";
import { intentFromPieClick } from "./selection";
import type { ChartCommonProps } from "./types";

export interface PieChartProps extends ChartCommonProps {
  data: Array<Record<string, unknown>>;
  nameKey: string;
  valueKey: string;
  innerRadius?: number;
  outerRadius?: number;
  /** "true" | "false" | "percent" */
  showLabels?: string;
  formatField?: FieldFormatter;
}

export default function PieChart({
  chartId,
  data,
  nameKey,
  valueKey,
  innerRadius = 0,
  outerRadius = 100,
  showLabels = "true",
  height = 280,
  loading,
  empty,
  emptyLabel,
  ariaLabel,
  formatField = defaultFieldFormatter,
  selectionFields,
  onSelectionChange,
}: PieChartProps) {
  const option = useMemo<EChartOption>(() => {
    const showLabelsOn = showLabels !== "false";
    const seriesData = data.map((row, i) => ({
      name: String(row[nameKey] ?? ""),
      value: row[valueKey],
      itemStyle: { color: CHART_COLOR_PALETTE[i % CHART_COLOR_PALETTE.length] },
    }));
    const labelFormatter = showLabels === "percent"
      ? "{d}%"
      : (params: { value: unknown }) => (valueKey ? formatField(valueKey, params.value) : String(params.value ?? ""));

    return {
      tooltip: {
        trigger: "item",
        formatter: (params: { name: string; value: unknown; percent: number }) => {
          const formatted = valueKey ? formatField(valueKey, params.value) : String(params.value ?? "");
          return `<strong>${params.name}</strong><br/>${formatted} (${params.percent.toFixed(1)}%)`;
        },
      },
      legend: {
        bottom: 0,
        type: "scroll",
        textStyle: { fontSize: 10 },
      },
      series: [
        {
          id: `${chartId}_pie`,
          type: "pie",
          radius: [innerRadius, outerRadius],
          center: ["50%", "45%"],
          avoidLabelOverlap: true,
          label: showLabelsOn ? { formatter: labelFormatter, fontSize: 11 } : { show: false },
          labelLine: { show: showLabelsOn },
          emphasis: { label: { fontWeight: 600 } },
          data: seriesData,
        },
      ],
    };
  }, [chartId, data, nameKey, valueKey, innerRadius, outerRadius, showLabels, formatField]);

  const onEvents = useMemo(() => {
    if (!onSelectionChange || !selectionFields?.categoryField) return undefined;
    return {
      click: (p: unknown) => {
        const params = p as { name?: string };
        if (params?.name == null || params.name === "") return;
        const intent = intentFromPieClick(selectionFields.categoryField, params.name);
        // eslint-disable-next-line no-console
        console.info("[chart:click]", chartId, intent);
        onSelectionChange(intent);
      },
    };
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
