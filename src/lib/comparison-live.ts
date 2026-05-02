import { prisma } from "@/lib/prisma";

import { computeAllocationBreakdownForYear } from "@/lib/snapshot";

export type LiveComparisonFilters = {
  division?: string;
  subdivision?: string;
  team?: string;
  owner?: string;
};

export type LiveComparisonRow = {
  eotp: string;
  label: string;
  division: string | null;
  subdivision: string | null;
  team: string | null;
  owner: string | null;
  snapInternal: number;
  snapExternal: number;
  snapDirect: number;
  snapCashOut: number;
  baselineAmount: number;
  gap: number;
};

export async function fetchLivePlanningVsBaselineComparison(
  year: number,
  baselineId: string,
  filters: LiveComparisonFilters
): Promise<{ ok: true; rows: LiveComparisonRow[] } | { ok: false; error: string }> {
  const baseline = await prisma.budgetBaseline.findUnique({ where: { id: baselineId } });
  if (!baseline) return { ok: false, error: "Baseline not found" };
  if (baseline.year !== year) return { ok: false, error: "Baseline does not match selected year" };

  const breakdown = await computeAllocationBreakdownForYear(year);

  const byEotp = new Map<
    string,
    { internal: number; external: number; direct: number; cashOut: number }
  >();
  for (const r of breakdown) {
    const cur = byEotp.get(r.eotp) ?? { internal: 0, external: 0, direct: 0, cashOut: 0 };
    cur.internal += r.internal;
    cur.external += r.external;
    cur.direct += r.direct;
    cur.cashOut += r.external + r.direct;
    byEotp.set(r.eotp, cur);
  }

  const baselineRows = await prisma.budgetBaselineRow.groupBy({
    by: ["eotp"],
    where: { baselineId },
    _sum: { amount: true },
  });
  const baseByEotp = new Map(
    baselineRows.map((b) => [b.eotp, Number(b._sum.amount ?? 0)] as const)
  );

  const definitions = await prisma.eotpDefinition.findMany({
    where: {
      ...(filters.division ? { division: filters.division } : {}),
      ...(filters.subdivision ? { subDivision: filters.subdivision } : {}),
      ...(filters.team ? { team: filters.team } : {}),
      ...(filters.owner ? { budgetOwner: filters.owner } : {}),
    },
    orderBy: [
      { division: "asc" },
      { subDivision: "asc" },
      { team: "asc" },
      { budgetOwner: "asc" },
      { sapEotpCode: "asc" },
    ],
  });

  const rows: LiveComparisonRow[] = definitions.map((ed) => {
    const snap = byEotp.get(ed.sapEotpCode) ?? {
      internal: 0,
      external: 0,
      direct: 0,
      cashOut: 0,
    };
    const baselineAmount = baseByEotp.get(ed.sapEotpCode) ?? 0;
    const gap = baselineAmount - snap.cashOut;
    return {
      eotp: ed.sapEotpCode,
      label: ed.label,
      division: ed.division,
      subdivision: ed.subDivision,
      team: ed.team,
      owner: ed.budgetOwner,
      snapInternal: snap.internal,
      snapExternal: snap.external,
      snapDirect: snap.direct,
      snapCashOut: snap.cashOut,
      baselineAmount,
      gap,
    };
  });

  return { ok: true, rows };
}
