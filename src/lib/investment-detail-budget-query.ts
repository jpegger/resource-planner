import type { BudgetInitiative } from "@/app/investments/[id]/investment-detail-types";
import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

export type BudgetRawRow = {
  jira_key: string;
  summary: string;
  status: string;
  initiative_year: unknown;
  internal_cost: unknown;
  external_cost: unknown;
  direct_cost: unknown;
  total_cost: unknown;
};

/** Initiative cost rollups from `initiative` + `v_allocation_costs` (same source as GET …/budget). */
export async function queryBudgetRawRows(
  productId: string,
  yearFilter: number | null
): Promise<BudgetRawRow[]> {
  const id = productId.trim();
  return prisma.$queryRaw<BudgetRawRow[]>(
    Prisma.sql`
      SELECT
        i.id AS jira_key,
        i.summary,
        i.status,
        i.year AS initiative_year,
        COALESCE(SUM(v.internal_cost), 0) AS internal_cost,
        COALESCE(SUM(v.external_cost), 0) AS external_cost,
        COALESCE(SUM(v.direct_cost), 0) AS direct_cost,
        COALESCE(SUM(v.computed_cost), 0) AS total_cost
      FROM initiative i
      LEFT JOIN v_allocation_costs v ON v.jira_key = i.id
      WHERE i."allocation_entity_id" = ${id}
      ${yearFilter === null ? Prisma.empty : Prisma.sql`AND i.year = ${yearFilter}`}
      GROUP BY i.id, i.summary, i.status, i.year
      ORDER BY i.year DESC, i.summary ASC
    `
  );
}

export function mapBudgetRawRowsToInitiatives(rows: BudgetRawRow[]): BudgetInitiative[] {
  return rows.map((r) => {
    const initiativeYear = Number(r.initiative_year);
    return {
      jira_key: r.jira_key,
      summary: r.summary,
      status: r.status,
      initiative_year: initiativeYear,
      internal_cost: Number(r.internal_cost),
      external_cost: Number(r.external_cost),
      direct_cost: Number(r.direct_cost),
      total_cost: Number(r.total_cost),
    };
  });
}

export async function getBudgetInitiativesForEntity(
  productId: string,
  yearFilter: number | null
): Promise<BudgetInitiative[]> {
  const rows = await queryBudgetRawRows(productId, yearFilter);
  return mapBudgetRawRowsToInitiatives(rows);
}
