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
  return Prisma.sql`AND v.initiative_type IN (${Prisma.join(initiativeTypes)})`;
}

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
    const rows = await prisma.$queryRaw<
      {
        key: string | null;
        label: string | null;
        internal: unknown;
        external: unknown;
        direct: unknown;
        total: unknown;
        revenue: unknown;
      }[]
    >(Prisma.sql`
      WITH initiative_totals AS (
        SELECT
          v.jira_key,
          v.division,
          v.team,
          v.product_name,
          v.summary,
          COALESCE(SUM(v.internal_cost), 0)::double precision AS internal,
          COALESCE(SUM(v.external_cost), 0)::double precision AS external,
          COALESCE(SUM(v.direct_cost), 0)::double precision AS direct,
          COALESCE(SUM(v.computed_cost), 0)::double precision AS total,
          COALESCE(r.revenue, 0)::double precision AS revenue
        FROM v_allocation_costs v
        LEFT JOIN (
          SELECT initiative_id, SUM(amount)::double precision AS revenue
          FROM initiative_revenue
          GROUP BY initiative_id
        ) r ON r.initiative_id = v.jira_key
        ${where}
        GROUP BY v.jira_key, v.division, v.team, v.product_name, v.summary, r.revenue
      )
      SELECT
        division AS key,
        division AS label,
        COALESCE(SUM(internal), 0)::double precision AS internal,
        COALESCE(SUM(external), 0)::double precision AS external,
        COALESCE(SUM(direct), 0)::double precision AS direct,
        COALESCE(SUM(total), 0)::double precision AS total,
        COALESCE(SUM(revenue), 0)::double precision AS revenue
      FROM initiative_totals
      GROUP BY division
      ORDER BY total DESC
    `);
    return rows.map((r) => ({
      key: r.key ?? "Unassigned",
      label: r.label ?? "Unassigned",
      internal: Number(r.internal ?? 0),
      external: Number(r.external ?? 0),
      direct: Number(r.direct ?? 0),
      total: Number(r.total ?? 0),
      revenue: Number(r.revenue ?? 0),
    }));
  }

  if (level === "team") {
    const rows = await prisma.$queryRaw<
      {
        key: string | null;
        label: string | null;
        internal: unknown;
        external: unknown;
        direct: unknown;
        total: unknown;
        revenue: unknown;
      }[]
    >(Prisma.sql`
      WITH initiative_totals AS (
        SELECT
          v.jira_key,
          v.division,
          v.team,
          v.product_name,
          v.summary,
          COALESCE(SUM(v.internal_cost), 0)::double precision AS internal,
          COALESCE(SUM(v.external_cost), 0)::double precision AS external,
          COALESCE(SUM(v.direct_cost), 0)::double precision AS direct,
          COALESCE(SUM(v.computed_cost), 0)::double precision AS total,
          COALESCE(r.revenue, 0)::double precision AS revenue
        FROM v_allocation_costs v
        LEFT JOIN (
          SELECT initiative_id, SUM(amount)::double precision AS revenue
          FROM initiative_revenue
          GROUP BY initiative_id
        ) r ON r.initiative_id = v.jira_key
        ${where}
        GROUP BY v.jira_key, v.division, v.team, v.product_name, v.summary, r.revenue
      )
      SELECT
        team AS key,
        team AS label,
        COALESCE(SUM(internal), 0)::double precision AS internal,
        COALESCE(SUM(external), 0)::double precision AS external,
        COALESCE(SUM(direct), 0)::double precision AS direct,
        COALESCE(SUM(total), 0)::double precision AS total,
        COALESCE(SUM(revenue), 0)::double precision AS revenue
      FROM initiative_totals
      GROUP BY team
      ORDER BY total DESC
    `);
    return rows.map((r) => ({
      key: r.key ?? "Unassigned",
      label: r.label ?? "Unassigned",
      internal: Number(r.internal ?? 0),
      external: Number(r.external ?? 0),
      direct: Number(r.direct ?? 0),
      total: Number(r.total ?? 0),
      revenue: Number(r.revenue ?? 0),
    }));
  }

  if (level === "product") {
    const rows = await prisma.$queryRaw<
      {
        key: string | null;
        label: string | null;
        internal: unknown;
        external: unknown;
        direct: unknown;
        total: unknown;
        revenue: unknown;
      }[]
    >(Prisma.sql`
      WITH initiative_totals AS (
        SELECT
          v.jira_key,
          v.division,
          v.team,
          v.product_name,
          v.summary,
          COALESCE(SUM(v.internal_cost), 0)::double precision AS internal,
          COALESCE(SUM(v.external_cost), 0)::double precision AS external,
          COALESCE(SUM(v.direct_cost), 0)::double precision AS direct,
          COALESCE(SUM(v.computed_cost), 0)::double precision AS total,
          COALESCE(r.revenue, 0)::double precision AS revenue
        FROM v_allocation_costs v
        LEFT JOIN (
          SELECT initiative_id, SUM(amount)::double precision AS revenue
          FROM initiative_revenue
          GROUP BY initiative_id
        ) r ON r.initiative_id = v.jira_key
        ${where}
        GROUP BY v.jira_key, v.division, v.team, v.product_name, v.summary, r.revenue
      )
      SELECT
        product_name AS key,
        product_name AS label,
        COALESCE(SUM(internal), 0)::double precision AS internal,
        COALESCE(SUM(external), 0)::double precision AS external,
        COALESCE(SUM(direct), 0)::double precision AS direct,
        COALESCE(SUM(total), 0)::double precision AS total,
        COALESCE(SUM(revenue), 0)::double precision AS revenue
      FROM initiative_totals
      GROUP BY product_name
      ORDER BY total DESC
    `);
    return rows.map((r) => ({
      key: r.key ?? "Unassigned",
      label: r.label ?? "Unassigned",
      internal: Number(r.internal ?? 0),
      external: Number(r.external ?? 0),
      direct: Number(r.direct ?? 0),
      total: Number(r.total ?? 0),
      revenue: Number(r.revenue ?? 0),
    }));
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
      revenue: unknown;
    }[]
  >(Prisma.sql`
    WITH initiative_totals AS (
      SELECT
        v.jira_key,
        v.division,
        v.team,
        v.product_name,
        v.summary,
        COALESCE(SUM(v.internal_cost), 0)::double precision AS internal,
        COALESCE(SUM(v.external_cost), 0)::double precision AS external,
        COALESCE(SUM(v.direct_cost), 0)::double precision AS direct,
        COALESCE(SUM(v.computed_cost), 0)::double precision AS total,
        COALESCE(r.revenue, 0)::double precision AS revenue
      FROM v_allocation_costs v
      LEFT JOIN (
        SELECT initiative_id, SUM(amount)::double precision AS revenue
        FROM initiative_revenue
        GROUP BY initiative_id
      ) r ON r.initiative_id = v.jira_key
      ${where}
      GROUP BY v.jira_key, v.division, v.team, v.product_name, v.summary, r.revenue
    )
    SELECT
      jira_key,
      summary,
      internal,
      external,
      direct,
      total,
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
    revenue: Number(r.revenue ?? 0),
  }));
}

