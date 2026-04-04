type BillingGranularity = "per_minute" | "per_second";

interface UnitPricing {
  ratePerHour: number;
  billing: BillingGranularity;
  minimumSeconds: number;
  perSessionCreationFee: number;
}

const PRICING: Record<string, { unit: UnitPricing }> = {
  NOTTE: {
    unit: { ratePerHour: 0.05, billing: "per_minute", minimumSeconds: 60, perSessionCreationFee: 0 },
  },
  STEEL: {
    unit: { ratePerHour: 0.1, billing: "per_minute", minimumSeconds: 60, perSessionCreationFee: 0 },
  },
  BROWSERBASE: {
    unit: { ratePerHour: 0.12, billing: "per_minute", minimumSeconds: 60, perSessionCreationFee: 0 },
  },
  ANCHORBROWSER: {
    unit: { ratePerHour: 0.05, billing: "per_minute", minimumSeconds: 60, perSessionCreationFee: 0.01 },
  },
  HYPERBROWSER: {
    unit: { ratePerHour: 0.1, billing: "per_second", minimumSeconds: 0, perSessionCreationFee: 0 },
  },
  KERNEL: {
    unit: { ratePerHour: 0.06, billing: "per_second", minimumSeconds: 0, perSessionCreationFee: 0 },
  },
  KERNEL_HEADFUL: {
    unit: { ratePerHour: 0.48, billing: "per_second", minimumSeconds: 0, perSessionCreationFee: 0 },
  },
  BROWSER_USE: {
    unit: { ratePerHour: 0.06, billing: "per_minute", minimumSeconds: 60, perSessionCreationFee: 0 },
  },
};

function computeUnitCost(pricing: UnitPricing, durationSeconds: number): number {
  let billedSeconds: number;
  if (pricing.billing === "per_minute") {
    billedSeconds = Math.max(
      pricing.minimumSeconds,
      Math.ceil(durationSeconds / 60) * 60
    );
  } else {
    billedSeconds = Math.max(pricing.minimumSeconds, durationSeconds);
  }
  const usageCost = (billedSeconds / 3600) * pricing.ratePerHour;
  return Math.round((pricing.perSessionCreationFee + usageCost) * 1e8) / 1e8;
}

export function getMedianCostUsd(
  provider: string,
  durationsMs: number[]
): number | null {
  const pricing = PRICING[provider];
  if (!pricing || durationsMs.length === 0) return null;
  const costs = durationsMs.map((ms) =>
    computeUnitCost(pricing.unit, ms / 1000)
  );
  const sorted = [...costs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function getPricePerHour(provider: string): number | null {
  const pricing = PRICING[provider];
  if (!pricing) return null;
  return pricing.unit.ratePerHour;
}

export function getPerSessionFee(provider: string): number | null {
  const pricing = PRICING[provider];
  if (!pricing) return null;
  return pricing.unit.perSessionCreationFee || null;
}
