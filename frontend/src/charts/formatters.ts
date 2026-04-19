export type FieldFormatter = (field: string, value: unknown) => string;

export const defaultFieldFormatter: FieldFormatter = (_field, value) => {
  if (value == null || value === "") return "";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(value);
};

/** Compact axis tick (1.2M, 350K, 5.1B). Matches PipelineChartsPanel's prior logic. */
export function compactTick(value: unknown): string {
  if (value == null) return "";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);
  const abs = Math.abs(num);
  if (abs >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(num / 1_000).toFixed(0)}K`;
  if (abs >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  if (Number.isInteger(num)) return num.toLocaleString();
  return num.toFixed(2);
}

/** Does the configured field formatter produce percentage / currency output for this field? */
export function usesFieldFormatter(field: string, formatField: FieldFormatter): boolean {
  if (!field) return false;
  const sample = formatField(field, 0.123);
  return sample.includes("%") || sample.includes("$");
}
