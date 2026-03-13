export type FilterJoinMode = "and" | "or";
export type ColumnType = "text" | "number" | "date";
export type FilterOperator =
  | "contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "in"
  | "not_in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after"
  | "between"
  | "on";

export interface FilterCondition {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
  secondaryValue: string;
  values?: string[];
}

export interface FilterFieldOption {
  key: string;
  label: string;
  type: ColumnType;
  suggestions?: string[];
  operators?: FilterOperator[];
}

export interface FilterState {
  joinMode: FilterJoinMode;
  conditions: FilterCondition[];
}

export const EMPTY_FILTER_STATE: FilterState = {
  joinMode: "and",
  conditions: [],
};

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: unknown): Date | null {
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function operatorOptionsForType(type: ColumnType) {
  if (type === "number") {
    return [
      { value: "equals", label: "Equals" },
      { value: "gt", label: "Greater than" },
      { value: "gte", label: "Greater or equal" },
      { value: "lt", label: "Less than" },
      { value: "lte", label: "Less or equal" },
      { value: "between", label: "Between" },
    ] as const;
  }
  if (type === "date") {
    return [
      { value: "on", label: "On" },
      { value: "before", label: "Before" },
      { value: "after", label: "After" },
      { value: "between", label: "Between" },
    ] as const;
  }
  return [
    { value: "contains", label: "Contains" },
    { value: "equals", label: "Equals" },
    { value: "starts_with", label: "Starts with" },
    { value: "ends_with", label: "Ends with" },
    { value: "in", label: "In" },
  ] as const;
}

export function defaultOperatorForType(type: ColumnType): FilterOperator {
  return operatorOptionsForType(type)[0].value;
}

export function createFilterCondition(column: string, type: ColumnType): FilterCondition {
  const operator = defaultOperatorForType(type);
  return { id: createId(), column, operator, value: "", secondaryValue: "", values: operator === "in" ? [] : undefined };
}

export function isMultiValueOperator(operator: FilterOperator) {
  return operator === "in" || operator === "not_in";
}

export function requiresSecondaryValue(operator: FilterOperator) {
  return operator === "between";
}

export function isConditionComplete(condition: FilterCondition) {
  if (!condition.column || !condition.operator) return false;
  if (isMultiValueOperator(condition.operator)) return Boolean(condition.values?.length);
  if (!condition.value.trim()) return false;
  if (requiresSecondaryValue(condition.operator)) return Boolean(condition.secondaryValue.trim());
  return true;
}

export function evaluateFilterCondition(rowValue: unknown, condition: FilterCondition, columnType: ColumnType) {
  if (!isConditionComplete(condition)) return true;
  if (columnType === "number") {
    const left = parseNumber(rowValue);
    const right = parseNumber(condition.value);
    const right2 = parseNumber(condition.secondaryValue);
    if (left === null || right === null) return false;
    switch (condition.operator) {
      case "equals": return left === right;
      case "gt": return left > right;
      case "gte": return left >= right;
      case "lt": return left < right;
      case "lte": return left <= right;
      case "between": return right2 !== null && left >= Math.min(right, right2) && left <= Math.max(right, right2);
      default: return false;
    }
  }
  if (columnType === "date") {
    const left = parseDate(rowValue)?.getTime();
    const right = parseDate(condition.value)?.getTime();
    const right2 = parseDate(condition.secondaryValue)?.getTime();
    if (!left || !right) return false;
    switch (condition.operator) {
      case "on": return left === right;
      case "before": return left < right;
      case "after": return left > right;
      case "between": return right2 !== undefined && right2 !== null && left >= Math.min(right, right2) && left <= Math.max(right, right2);
      default: return false;
    }
  }
  const left = String(rowValue ?? "").toLowerCase();
  const value = condition.value.toLowerCase();
  switch (condition.operator) {
    case "contains": return left.includes(value);
    case "equals": return left === value;
    case "starts_with": return left.startsWith(value);
    case "ends_with": return left.endsWith(value);
    case "in": return (condition.values ?? []).map((item) => item.toLowerCase()).includes(left);
    default: return false;
  }
}

export function applyFilterState<T>(rows: T[], fields: FilterFieldOption[], filterState: FilterState) {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const completeConditions = filterState.conditions.filter(isConditionComplete);
  if (!completeConditions.length) return rows;
  return rows.filter((row) => {
    const evaluations = completeConditions.map((condition) => {
      const field = fieldsByKey.get(condition.column);
      if (!field) return true;
      return evaluateFilterCondition((row as Record<string, unknown>)[condition.column], condition, field.type);
    });
    return filterState.joinMode === "and" ? evaluations.every(Boolean) : evaluations.some(Boolean);
  });
}
