import type { ChartCrossFilterEntry, SelectionFields, SelectionIntent } from "./types";

/**
 * Pure converters: ECharts event payload → `SelectionIntent`, then intent →
 * `ChartCrossFilterEntry[]` for the hook layer. Kept pure and small so both
 * chart wrappers and unit tests can use them without pulling in echarts.
 */

function toISODateIfMs(v: unknown, kindHint?: "date" | "number"): string {
  if (kindHint !== "date") return String(v ?? "");
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1_000_000_000_000) return String(v ?? "");
  try {
    return new Date(n).toISOString().slice(0, 10);
  } catch {
    return String(v ?? "");
  }
}

/** Click on a bar → equality on categoryField. Multi-select (Ctrl/Cmd) aggregates previous bar values. */
export function intentFromBarClick(params: {
  categoryName: string | number;
  categoryField?: string;
  modifierKey?: boolean;
  previousValues?: Array<string | number>;
}): SelectionIntent | null {
  if (!params.categoryField) return null;
  const name = params.categoryName;
  if (params.modifierKey && params.previousValues?.length) {
    const set = new Set<string | number>(params.previousValues);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    if (set.size === 0) return null;
    if (set.size === 1) {
      return { kind: "equality", field: params.categoryField, value: Array.from(set)[0] };
    }
    return { kind: "multi", field: params.categoryField, values: Array.from(set) };
  }
  return { kind: "equality", field: params.categoryField, value: name };
}

/** Click on a pie slice → equality on categoryField. */
export function intentFromPieClick(categoryField: string | undefined, name: string | number): SelectionIntent | null {
  if (!categoryField) return null;
  return { kind: "equality", field: categoryField, value: name };
}

/** ECharts brush on a time/numeric x-axis → range intent. */
export function intentFromXAxisBrush(
  coordRange: Array<number | string>,
  xField?: string,
  kindHint?: "date" | "number",
): SelectionIntent | null {
  if (!xField || !coordRange || coordRange.length < 2) return null;
  const min = coordRange[0];
  const max = coordRange[1];
  return {
    kind: "range",
    field: xField,
    min: toISODateIfMs(min, kindHint),
    max: toISODateIfMs(max, kindHint),
    kindHint,
  };
}

/** ECharts rect brush on a scatter → composite range on xField + yField. */
export function intentFromScatterBrush(
  rect: { xMin: number; xMax: number; yMin: number; yMax: number },
  xField?: string,
  yField?: string,
): SelectionIntent | null {
  if (!xField || !yField) return null;
  return {
    kind: "composite",
    parts: [
      { kind: "range", field: xField, min: rect.xMin, max: rect.xMax, kindHint: "number" },
      { kind: "range", field: yField, min: rect.yMin, max: rect.yMax, kindHint: "number" },
    ],
  };
}

/** Click on a heatmap cell → composite equality on rowField + colField. */
export function intentFromHeatmapClick(
  rowValue: string | number | undefined,
  colValue: string | number | undefined,
  rowField?: string,
  colField?: string,
): SelectionIntent | null {
  const parts: Array<Exclude<SelectionIntent, { kind: "composite" }>> = [];
  if (colField && colValue != null) parts.push({ kind: "equality", field: colField, value: colValue });
  if (rowField && rowValue != null) parts.push({ kind: "equality", field: rowField, value: rowValue });
  if (!parts.length) return null;
  return { kind: "composite", parts };
}

/**
 * Translate a `SelectionIntent` into 1..N `ChartCrossFilterEntry` rows ready
 * for merging into the hook's `chartCrossFilter[tabId]` slot. Each entry
 * carries the source-chart provenance so `CrossFilterChips` can render them.
 */
export function intentToEntries(
  intent: SelectionIntent,
  chartId: string,
  chartTitle: string,
): ChartCrossFilterEntry[] {
  if (intent.kind === "composite") {
    return intent.parts.flatMap((p) => intentToEntries(p, chartId, chartTitle));
  }
  if (intent.kind === "equality") {
    return [{
      sourceChartId: chartId,
      sourceChartTitle: chartTitle,
      field: intent.field,
      operator: "equals",
      value: String(intent.value),
    }];
  }
  if (intent.kind === "multi") {
    return [{
      sourceChartId: chartId,
      sourceChartTitle: chartTitle,
      field: intent.field,
      operator: "in",
      value: "",
      values: intent.values.map((v) => String(v)),
    }];
  }
  if (intent.kind === "range") {
    return [{
      sourceChartId: chartId,
      sourceChartTitle: chartTitle,
      field: intent.field,
      operator: "between",
      value: String(intent.min),
      secondaryValue: String(intent.max),
    }];
  }
  return [];
}

/** Human-readable chip label derived from an entry's predicate. */
export function describeEntry(entry: ChartCrossFilterEntry): string {
  if (entry.operator === "equals") return String(entry.value);
  if (entry.operator === "in") {
    const vals = entry.values ?? [];
    if (vals.length === 0) return "—";
    if (vals.length === 1) return vals[0];
    return `${vals[0]} +${vals.length - 1}`;
  }
  if (entry.operator === "between") {
    return `${entry.value} – ${entry.secondaryValue ?? ""}`;
  }
  if (entry.operator === "gte") return `≥ ${entry.value}`;
  if (entry.operator === "lte") return `≤ ${entry.value}`;
  return String(entry.value);
}

/** Does the cross-filter touch any of the given fields? Used for dimming mismatched marks in charts/cards. */
export function crossFilterTouchesFields(entries: ChartCrossFilterEntry[] | undefined, fields: Array<string | undefined>): boolean {
  if (!entries?.length) return false;
  const set = new Set(fields.filter((f): f is string => !!f));
  return entries.some((e) => set.has(e.field));
}

/** Is the given row kept by an applicable cross-filter entry? */
export function rowMatchesEntry(row: Record<string, unknown>, entry: ChartCrossFilterEntry): boolean {
  const cell = row[entry.field];
  if (cell == null) return false;
  if (entry.operator === "equals") return String(cell) === String(entry.value);
  if (entry.operator === "in") return (entry.values ?? []).some((v) => String(v) === String(cell));
  if (entry.operator === "between") {
    const num = Number(cell);
    const lo = Number(entry.value);
    const hi = Number(entry.secondaryValue);
    if (Number.isFinite(num) && Number.isFinite(lo) && Number.isFinite(hi)) return num >= lo && num <= hi;
    return String(cell) >= String(entry.value) && String(cell) <= String(entry.secondaryValue ?? "");
  }
  if (entry.operator === "gte") return Number(cell) >= Number(entry.value);
  if (entry.operator === "lte") return Number(cell) <= Number(entry.value);
  return true;
}

export function selectionFieldsOf(selectionFields?: SelectionFields): Array<string | undefined> {
  if (!selectionFields) return [];
  return [
    selectionFields.xField,
    selectionFields.yField,
    selectionFields.seriesField,
    selectionFields.categoryField,
    selectionFields.rowField,
    selectionFields.colField,
  ];
}
