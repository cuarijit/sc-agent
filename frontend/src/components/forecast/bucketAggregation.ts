/**
 * Time-bucket aggregation for the forecast workbench. Source data is always
 * weekly (one row per ISO week_start). The chart + grid re-bucket to
 * Day | Week | Month | Quarter on demand.
 *
 * "Day" is only meaningful when a daily profile is supplied by the caller
 * (DBF synthesizes daily values from weekday patterns). When no daily data
 * exists we surface the toggle as disabled upstream.
 */

export type BucketKind = "day" | "week" | "month" | "quarter";

export type AggregationMethod = "sum" | "avg" | "last";

export interface WeeklyRow {
  /** ISO week_start (YYYY-MM-DD, Monday). */
  week: string;
  /** Numeric values keyed by series field name. */
  values: Record<string, number | null>;
}

export interface BucketedRow {
  /** Stable bucket key (e.g. 2026-W12, 2026-03, 2026-Q1, 2026-04-18). */
  bucket: string;
  /** Short human label for chart/grid headers. */
  bucketLabel: string;
  /** Underlying sort key (first date in bucket, YYYY-MM-DD). */
  sortKey: string;
  /** Whether this bucket contains today's date. */
  isCurrent: boolean;
  values: Record<string, number | null>;
}

const WEEKDAY_PROFILE = [0.12, 0.14, 0.15, 0.16, 0.17, 0.14, 0.12]; // Mon..Sun

function parseISO(date: string): Date {
  // YYYY-MM-DD → Date in local time (all our data is date-only)
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function fmt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoWeek(date: Date): { year: number; week: number } {
  // ISO week number (week starts Monday, week 1 contains first Thursday)
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: tmp.getUTCFullYear(), week };
}

function quarterOf(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1;
}

export function aggregateToBuckets(
  rows: WeeklyRow[],
  bucket: BucketKind,
  methods: Record<string, AggregationMethod> = {},
  now: Date = new Date(),
): BucketedRow[] {
  if (rows.length === 0) return [];
  const today = fmt(now);

  if (bucket === "week") {
    return rows
      .slice()
      .sort((a, b) => a.week.localeCompare(b.week))
      .map((r) => {
        const d = parseISO(r.week);
        const end = new Date(d);
        end.setDate(end.getDate() + 6);
        const endStr = fmt(end);
        return {
          bucket: r.week,
          bucketLabel: r.week.slice(5),
          sortKey: r.week,
          isCurrent: today >= r.week && today <= endStr,
          values: { ...r.values },
        };
      });
  }

  if (bucket === "day") {
    // Expand each weekly row into 7 daily rows using a fixed weekday
    // profile so quantities still sum to the week total. Non-quantity
    // series (prices, percentages) repeat week-constant.
    const out: BucketedRow[] = [];
    for (const r of rows) {
      const start = parseISO(r.week);
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const dateStr = fmt(d);
        const values: Record<string, number | null> = {};
        for (const [k, v] of Object.entries(r.values)) {
          if (v == null) {
            values[k] = null;
            continue;
          }
          const method = methods[k] ?? "sum";
          values[k] = method === "avg" || method === "last" ? v : v * WEEKDAY_PROFILE[i];
        }
        out.push({
          bucket: dateStr,
          bucketLabel: dateStr.slice(5),
          sortKey: dateStr,
          isCurrent: dateStr === today,
          values,
        });
      }
    }
    return out.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }

  // month | quarter: group rows by key
  const groups = new Map<string, { sortKey: string; label: string; rows: WeeklyRow[] }>();
  for (const r of rows) {
    const d = parseISO(r.week);
    let key: string;
    let label: string;
    let sortKey: string;
    if (bucket === "month") {
      const month = String(d.getMonth() + 1).padStart(2, "0");
      key = `${d.getFullYear()}-${month}`;
      label = `${d.toLocaleString("en-US", { month: "short" })} ${String(d.getFullYear()).slice(2)}`;
      sortKey = `${d.getFullYear()}-${month}-01`;
    } else {
      const q = quarterOf(d);
      key = `${d.getFullYear()}-Q${q}`;
      label = `Q${q} ${String(d.getFullYear()).slice(2)}`;
      sortKey = `${d.getFullYear()}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
    }
    const bucketRef = groups.get(key) ?? { sortKey, label, rows: [] };
    bucketRef.rows.push(r);
    groups.set(key, bucketRef);
  }

  const out: BucketedRow[] = [];
  for (const [key, g] of groups) {
    const values: Record<string, number | null> = {};
    const fields = new Set<string>();
    for (const r of g.rows) Object.keys(r.values).forEach((k) => fields.add(k));
    for (const f of fields) {
      const method = methods[f] ?? "sum";
      const nums: number[] = [];
      for (const r of g.rows) {
        const v = r.values[f];
        if (v != null && !Number.isNaN(v)) nums.push(v);
      }
      if (nums.length === 0) {
        values[f] = null;
        continue;
      }
      if (method === "avg") values[f] = nums.reduce((a, b) => a + b, 0) / nums.length;
      else if (method === "last") values[f] = nums[nums.length - 1];
      else values[f] = nums.reduce((a, b) => a + b, 0);
    }

    // Determine current-bucket: if today is within the span of this group
    const sortedRows = g.rows.slice().sort((a, b) => a.week.localeCompare(b.week));
    const first = sortedRows[0].week;
    const lastDate = parseISO(sortedRows[sortedRows.length - 1].week);
    lastDate.setDate(lastDate.getDate() + 6);
    const last = fmt(lastDate);
    out.push({
      bucket: key,
      bucketLabel: g.label,
      sortKey: g.sortKey,
      isCurrent: today >= first && today <= last,
      values,
    });
  }

  return out.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/**
 * Horizon cap: set the series value to null for any bucket whose sortKey is
 * beyond `currentSortKey + horizonWeeks`. Works in week/month/quarter space
 * because we convert horizonWeeks to a cutoff date.
 */
export function applyHorizonCap(
  rows: BucketedRow[],
  field: string,
  horizonWeeks: number,
  now: Date = new Date(),
): BucketedRow[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + horizonWeeks * 7);
  const cutoffStr = fmt(cutoff);
  return rows.map((r) => {
    if (r.sortKey <= cutoffStr) return r;
    if (r.values[field] == null) return r;
    return { ...r, values: { ...r.values, [field]: null } };
  });
}
