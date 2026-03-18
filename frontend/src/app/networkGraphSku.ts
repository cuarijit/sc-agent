export type NetworkGraphSkuResolution = {
  sku: string | null;
  canOpenGraph: boolean;
  reason: "ok" | "missing" | "multiple";
};

export function resolveImpactedSkuForNetworkGraph(value: unknown): NetworkGraphSkuResolution {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { sku: null, canOpenGraph: false, reason: "missing" };
  }
  const hasMultipleToken = /[;,|/]/.test(raw) || /\bmultiple\b/i.test(raw);
  if (hasMultipleToken) {
    return { sku: null, canOpenGraph: false, reason: "multiple" };
  }
  return { sku: raw, canOpenGraph: true, reason: "ok" };
}

