export type CostBreakdown = {
  internal: number;
  external: number;
  direct: number;
};

export type EotpRoutingRow = {
  id: string;
  eotp: string;
  eopLabel: string | null;
  year: number;
  internalAmount: number;
  externalAmount: number;
  directAmount: number;
  comment: string | null;
};

export type EotpAmount = {
  eotp: string;
  eopLabel: string | null;
  internal: number;
  external: number;
  direct: number;
  total: number;
  isMainEotp: boolean;
};

type Acc = { label: string | null; internal: number; external: number; direct: number };

function clamp0(n: number): number {
  return n < 0 ? 0 : n;
}

/**
 * Compute per-EOTP EUR amounts for a product × year.
 *
 * Rules:
 * - Each routing row lists EUR routed to a target EOTP for internal / external / direct buckets.
 * - The main EOTP receives the remainder of each bucket after subtracting non-main targets.
 * - Remainder is clamped to 0 — negative means misconfigured routing.
 */
export function computeEotpBreakdown(
  mainEotp: string,
  mainEotpLabel: string | null,
  costs: CostBreakdown,
  routings: EotpRoutingRow[]
): EotpAmount[] {
  const main = mainEotp.trim();
  const acc = new Map<string, Acc>();

  const get = (eotp: string, label: string | null) => {
    const key = eotp.trim();
    const existing = acc.get(key);
    if (existing) return existing;
    const created: Acc = { label, internal: 0, external: 0, direct: 0 };
    acc.set(key, created);
    return created;
  };

  for (const row of routings) {
    const entry = get(row.eotp, row.eopLabel);
    entry.internal += row.internalAmount;
    entry.external += row.externalAmount;
    entry.direct += row.directAmount;
  }

  let remInternal = costs.internal;
  let remExternal = costs.external;
  let remDirect = costs.direct;

  for (const [eotp, amounts] of acc.entries()) {
    if (eotp !== main) {
      remInternal -= amounts.internal;
      remExternal -= amounts.external;
      remDirect -= amounts.direct;
    }
  }

  const mainInternal = clamp0(remInternal);
  const mainExternal = clamp0(remExternal);
  const mainDirect = clamp0(remDirect);

  const result: EotpAmount[] = [
    {
      eotp: main,
      eopLabel: mainEotpLabel,
      internal: mainInternal,
      external: mainExternal,
      direct: mainDirect,
      total: mainInternal + mainExternal + mainDirect,
      isMainEotp: true,
    },
  ];

  for (const [eotp, amounts] of acc.entries()) {
    if (eotp === main) continue;
    result.push({
      eotp,
      eopLabel: amounts.label,
      internal: amounts.internal,
      external: amounts.external,
      direct: amounts.direct,
      total: amounts.internal + amounts.external + amounts.direct,
      isMainEotp: false,
    });
  }

  return result;
}
