import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

export type RevenueRollupLevel = "division" | "team" | "product";

export type RevenueRollupRow = {
  key: string;
  label: string;
  estimatedRevenue: number;
  plannedRevenue: number;
};

export type PlannedArRollupParams = {
  year: number;
  level: RevenueRollupLevel;
  division: string | null;
  team: string | null;
};

function coalesceDivisionSql(): Prisma.Sql {
  return Prisma.sql`COALESCE(ae.division, 'Unassigned')`;
}

function coalesceTeamSql(): Prisma.Sql {
  return Prisma.sql`COALESCE(ae.team, 'Unassigned')`;
}

function coalesceProductSql(): Prisma.Sql {
  return Prisma.sql`COALESCE(ae.name, 'Unassigned')`;
}

function whereDrilldown(division: string | null, team: string | null): Prisma.Sql {
  if (division === null) return Prisma.empty;
  if (team === null) {
    return Prisma.sql`AND COALESCE(ae.division, 'Unassigned') = ${division}`;
  }
  return Prisma.sql`AND COALESCE(ae.division, 'Unassigned') = ${division} AND COALESCE(ae.team, 'Unassigned') = ${team}`;
}

export async function queryPlannedArRevenueRollup(
  params: PlannedArRollupParams
): Promise<Array<{ key: string; label: string; plannedRevenue: number }>> {
  const { year, level, division, team } = params;
  const drill = whereDrilldown(division, team);

  if (level === "division") {
    const rows = await prisma.$queryRaw<{ key: string; label: string; planned: unknown }[]>(Prisma.sql`
      SELECT
        ${coalesceDivisionSql()} AS key,
        ${coalesceDivisionSql()} AS label,
        COALESCE(SUM(ar.amount_eur::numeric), 0)::double precision AS planned
      FROM ar_entry ar
      LEFT JOIN allocation_entity ae ON ae.id = ar.allocation_entity_id
      WHERE ar.year = ${year}
      ${drill}
      GROUP BY ${coalesceDivisionSql()}
      ORDER BY planned DESC NULLS LAST
    `);
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      plannedRevenue: Number(r.planned ?? 0),
    }));
  }

  if (level === "team") {
    const rows = await prisma.$queryRaw<{ key: string; label: string; planned: unknown }[]>(Prisma.sql`
      SELECT
        ${coalesceTeamSql()} AS key,
        ${coalesceTeamSql()} AS label,
        COALESCE(SUM(ar.amount_eur::numeric), 0)::double precision AS planned
      FROM ar_entry ar
      LEFT JOIN allocation_entity ae ON ae.id = ar.allocation_entity_id
      WHERE ar.year = ${year}
      ${drill}
      GROUP BY ${coalesceTeamSql()}
      ORDER BY planned DESC NULLS LAST
    `);
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      plannedRevenue: Number(r.planned ?? 0),
    }));
  }

  const rows = await prisma.$queryRaw<{ key: string; label: string; planned: unknown }[]>(Prisma.sql`
    SELECT
      ${coalesceProductSql()} AS key,
      ${coalesceProductSql()} AS label,
      COALESCE(SUM(ar.amount_eur::numeric), 0)::double precision AS planned
    FROM ar_entry ar
    LEFT JOIN allocation_entity ae ON ae.id = ar.allocation_entity_id
    WHERE ar.year = ${year}
    ${drill}
    GROUP BY ${coalesceProductSql()}
    ORDER BY planned DESC NULLS LAST
  `);
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    plannedRevenue: Number(r.planned ?? 0),
  }));
}

export function mergeEstimatedAndPlanned(
  estimated: Array<{ key: string; label: string; revenue: number }>,
  planned: Array<{ key: string; label: string; plannedRevenue: number }>
): RevenueRollupRow[] {
  const keys = new Set<string>();
  for (const r of estimated) keys.add(r.key);
  for (const r of planned) keys.add(r.key);

  const estMap = new Map(estimated.map((r) => [r.key, r]));
  const planMap = new Map(planned.map((r) => [r.key, r]));

  const merged: RevenueRollupRow[] = [];
  for (const key of keys) {
    const e = estMap.get(key);
    const p = planMap.get(key);
    merged.push({
      key,
      label: e?.label ?? p?.label ?? key,
      estimatedRevenue: e?.revenue ?? 0,
      plannedRevenue: p?.plannedRevenue ?? 0,
    });
  }

  merged.sort(
    (a, b) =>
      b.estimatedRevenue +
      b.plannedRevenue -
      (a.estimatedRevenue + a.plannedRevenue)
  );
  return merged;
}
