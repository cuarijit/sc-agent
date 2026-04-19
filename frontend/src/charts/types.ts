/**
 * Public type surface for the puls8 chart wrappers.
 *
 * Every feature component that renders a chart imports from `src/charts` —
 * NOT from `echarts` / `echarts-for-react` directly. The barrel enforces the
 * boundary so we can swap underlying libraries without touching call sites.
 */

export type SelectionFields = {
  xField?: string;
  yField?: string;
  seriesField?: string;
  categoryField?: string;
  rowField?: string;
  colField?: string;
};

export type SelectionIntent =
  | { kind: "equality"; field: string; value: string | number; label?: string }
  | { kind: "multi"; field: string; values: Array<string | number>; label?: string }
  | { kind: "range"; field: string; min: number | string; max: number | string; kindHint?: "date" | "number" }
  | { kind: "composite"; parts: Array<Exclude<SelectionIntent, { kind: "composite" }>> };

/**
 * A single cross-chart filter entry produced by translating a
 * `SelectionIntent`. Shape is intentionally a superset of `TabFilterValue`
 * so `mapFilterConditionsForTab` can consume cross-filter entries with the
 * same translation logic used for tab filters.
 */
export type ChartCrossFilterEntry = {
  sourceChartId: string;
  sourceChartTitle: string;
  field: string;
  operator: "equals" | "in" | "between" | "gte" | "lte";
  value: string;
  secondaryValue?: string;
  values?: string[];
};

export type ChartCommonProps = {
  chartId: string;
  title?: string;
  height?: number | string;
  loading?: boolean;
  empty?: boolean;
  emptyLabel?: string;
  ariaLabel?: string;
  selectionFields?: SelectionFields;
  onSelectionChange?: (intent: SelectionIntent | null) => void;
  activeCrossFilter?: ChartCrossFilterEntry[];
};
