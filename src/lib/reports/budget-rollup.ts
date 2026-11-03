import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

export type BudgetRollupLevel = "division" | "team" | "product" | "initiative";

export type BudgetRollupRow = {
  key: string;
  label: string;
  internal: number;
  external: number;
  direct: number;
  total: number;
  /** Costs on initiatives where `(RI) Type` is not exactly `Run` (→ Build bucket). */
  buildInternal: number;
  buildExternal: number;
  buildDirect: number;
  totalBuild: number;
  revenue: number;
};

export type BudgetRollupParams = {
  year: number;
  level: BudgetRollupLevel;
  initiativeTypes: string[]; // empty = all
  division: string | null;
  team: string | null;
  productName: string | null;
};

function whereInitiativeTypes(initiativeTypes: string[]) {
  if (!initiativeTypes.length) return Prisma.empty;
  const wantsUnassigned = initiativeTypes.some(
    (t) => t === "Unassigned" || t === "__UNASSIGNED__"
  );
  const named = initiativeTypes.filter(
    (t) => t !== "Unassigned" && t !== "__UNASSIGNED__"
  );
  if (wantsUnassigned && named.length === 0) {
    return Prisma.sql`AND (v.initiative_type IS NULL OR BTRIM(v.initiative_type) = '')`;
  }
  if (wantsUnassigned) {
    return Prisma.sql`AND (
      v.initiative_type IN (${Prisma.join(named)})
      OR v.initiative_type IS NULL
      OR BTRIM(v.initiative_type) = ''
    )`;
  }
  return Prisma.sql`AND v.initiative_type IN (${Prisma.join(named)})`;
}

type InitiativeTotalsRaw = {
  key: string | null;
  label: string | null;
  internal: unknown;
  external: unknown;
  direct: unknown;
  total: unknown;
  build_internal: unknown;
  build_external: unknown;
  build_direct: unknown;
  total_build: unknown;
  revenue: unknown;
};

function mapAggRow(r: InitiativeTotalsRaw): BudgetRollupRow {
  return {
    key: r.key ?? "Unassigned",
    label: r.label ?? "Unassigned",
    internal: Number(r.internal ?? 0),
    external: Number(r.external ?? 0),
    direct: Number(r.direct ?? 0),
    total: Number(r.total ?? 0),
    buildInternal: Number(r.build_internal ?? 0),
    buildExternal: Number(r.build_external ?? 0),
    buildDirect: Number(r.build_direct ?? 0),
    totalBuild: Number(r.total_build ?? 0),
    revenue: Number(r.revenue ?? 0),
  };
}

/** Per-initiative costs; Build = any `(RI) Type` other than exact `Run`. */
const initiativeTotalsCte = (where: Prisma.Sql) => Prisma.sql`
  WITH initiative_totals AS (
    SELECT
      v.jira_key,
      v.division,
      v.team,
      v.product_name,
      v.summary,
      v.initiative_type,
      COALESCE(SUM(v.internal_cost), 0)::double precision AS internal,
      COALESCE(SUM(v.external_cost), 0)::double precision AS external,
      COALESCE(SUM(v.direct_cost), 0)::double precision AS direct,
      COALESCE(SUM(v.computed_cost), 0)::double precision AS total,
      CASE
        WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
        THEN COALESCE(SUM(v.internal_cost), 0)::double precision
        ELSE 0::double precision
      END AS build_internal,
      CASE
        WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
        THEN COALESCE(SUM(v.external_cost), 0)::double precision
        ELSE 0::double precision
      END AS build_external,
      CASE
        WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
        THEN COALESCE(SUM(v.direct_cost), 0)::double precision
        ELSE 0::double precision
      END AS build_direct,
      CASE
        WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
        THEN COALESCE(SUM(v.computed_cost), 0)::double precision
        ELSE 0::double precision
      END AS total_build,
      COALESCE(r.revenue, 0)::double precision AS revenue
    FROM v_allocation_costs v
    LEFT JOIN (
      SELECT initiative_id, SUM(amount)::double precision AS revenue
      FROM initiative_revenue
      GROUP BY initiative_id
    ) r ON r.initiative_id = v.jira_key
    ${where}
    GROUP BY v.jira_key, v.division, v.team, v.product_name, v.summary, v.initiative_type, r.revenue
  )
`;

export async function queryBudgetRollup(params: BudgetRollupParams): Promise<BudgetRollupRow[]> {
  const { year, level, initiativeTypes, division, team, productName } = params;

  const where = Prisma.sql`
    WHERE v.initiative_year = ${year}
    ${whereInitiativeTypes(initiativeTypes)}
    ${division === null ? Prisma.empty : Prisma.sql`AND v.division = ${division}`}
    ${team === null ? Prisma.empty : Prisma.sql`AND v.team = ${team}`}
    ${productName === null ? Prisma.empty : Prisma.sql`AND v.product_name = ${productName}`}
  `;

  if (level === "division") {
    const rows = await prisma.$queryRaw<InitiativeTotalsRaw[]>(Prisma.sql`
      ${initiativeTotalsCte(where)}
      SELECT
        division AS key,
        division AS label,
        COALESCE(SUM(internal), 0)::double precision AS internal,
        COALESCE(SUM(external), 0)::double precision AS external,
        COALESCE(SUM(direct), 0)::double precision AS direct,
        COALESCE(SUM(total), 0)::double precision AS total,
        COALESCE(SUM(build_internal), 0)::double precision AS build_internal,
        COALESCE(SUM(build_external), 0)::double precision AS build_external,
        COALESCE(SUM(build_direct), 0)::double precision AS build_direct,
        COALESCE(SUM(total_build), 0)::double precision AS total_build,
        COALESCE(SUM(revenue), 0)::double precision AS revenue
      FROM initiative_totals
      GROUP BY division
      ORDER BY total DESC
    `);
    return rows.map(mapAggRow);
  }

  if (level === "team") {
    const rows = await prisma.$queryRaw<InitiativeTotalsRaw[]>(Prisma.sql`
      ${initiativeTotalsCte(where)}
      SELECT
        team AS key,
        team AS label,
        COALESCE(SUM(internal), 0)::double precision AS internal,
        COALESCE(SUM(external), 0)::double precision AS external,
        COALESCE(SUM(direct), 0)::double precision AS direct,
        COALESCE(SUM(total), 0)::double precision AS total,
        COALESCE(SUM(build_internal), 0)::double precision AS build_internal,
        COALESCE(SUM(build_external), 0)::double precision AS build_external,
        COALESCE(SUM(build_direct), 0)::double precision AS build_direct,
        COALESCE(SUM(total_build), 0)::double precision AS total_build,
        COALESCE(SUM(revenue), 0)::double precision AS revenue
      FROM initiative_totals
      GROUP BY team
      ORDER BY total DESC
    `);
    return rows.map(mapAggRow);
  }

  if (level === "product") {
    const rows = await prisma.$queryRaw<InitiativeTotalsRaw[]>(Prisma.sql`
      ${initiativeTotalsCte(where)}
      SELECT
        product_name AS key,
        product_name AS label,
        COALESCE(SUM(internal), 0)::double precision AS internal,
        COALESCE(SUM(external), 0)::double precision AS external,
        COALESCE(SUM(direct), 0)::double precision AS direct,
        COALESCE(SUM(total), 0)::double precision AS total,
        COALESCE(SUM(build_internal), 0)::double precision AS build_internal,
        COALESCE(SUM(build_external), 0)::double precision AS build_external,
        COALESCE(SUM(build_direct), 0)::double precision AS build_direct,
        COALESCE(SUM(total_build), 0)::double precision AS total_build,
        COALESCE(SUM(revenue), 0)::double precision AS revenue
      FROM initiative_totals
      GROUP BY product_name
      ORDER BY total DESC
    `);
    return rows.map(mapAggRow);
  }

  // initiative
  const rows = await prisma.$queryRaw<
    {
      jira_key: string;
      summary: string;
      internal: unknown;
      external: unknown;
      direct: unknown;
      total: unknown;
      build_internal: unknown;
      build_external: unknown;
      build_direct: unknown;
      total_build: unknown;
      revenue: unknown;
    }[]
  >(Prisma.sql`
    ${initiativeTotalsCte(where)}
    SELECT
      jira_key,
      summary,
      internal,
      external,
      direct,
      total,
      build_internal,
      build_external,
      build_direct,
      total_build,
      revenue
    FROM initiative_totals
    ORDER BY total DESC
  `);

  return rows.map((r) => ({
    key: r.jira_key,
    label: `${r.jira_key} — ${r.summary}`,
    internal: Number(r.internal ?? 0),
    external: Number(r.external ?? 0),
    direct: Number(r.direct ?? 0),
    total: Number(r.total ?? 0),
    buildInternal: Number(r.build_internal ?? 0),
    buildExternal: Number(r.build_external ?? 0),
    buildDirect: Number(r.build_direct ?? 0),
    totalBuild: Number(r.total_build ?? 0),
    revenue: Number(r.revenue ?? 0),
  }));
}
