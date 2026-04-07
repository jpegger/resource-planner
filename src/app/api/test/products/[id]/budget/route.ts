import { type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type BudgetRow = {
  jira_key: string;
  summary: string;
  status: string;
  initiative_year: unknown;
  internal_cost: unknown;
  external_cost: unknown;
  direct_cost: unknown;
  total_cost: unknown;
};

/** Per-initiative cost rollups for a product (from v_allocation_costs). Optional ?year= filters initiatives. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: productId } = await context.params;
  if (!productId?.trim()) {
    return Response.json({ error: "Missing product id" }, { status: 400 });
  }

  const yearParam = request.nextUrl.searchParams.get("year");
  let yearFilter: number | null = null;
  if (yearParam !== null && yearParam !== "") {
    const y = Number.parseInt(yearParam, 10);
    if (!Number.isNaN(y)) yearFilter = y;
  }

  const rows =
    yearFilter === null
      ? await prisma.$queryRaw<BudgetRow[]>`
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
          WHERE i."productId" = ${productId.trim()}
          GROUP BY i.id, i.summary, i.status, i.year
          ORDER BY i.year DESC, i.summary ASC
        `
      : await prisma.$queryRaw<BudgetRow[]>`
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
          WHERE i."productId" = ${productId.trim()}
            AND i.year = ${yearFilter}
          GROUP BY i.id, i.summary, i.status, i.year
          ORDER BY i.year DESC, i.summary ASC
        `;

  const body = rows.map((r) => ({
    jira_key: r.jira_key,
    summary: r.summary,
    status: r.status,
    initiative_year: Number(r.initiative_year),
    internal_cost: Number(r.internal_cost),
    external_cost: Number(r.external_cost),
    direct_cost: Number(r.direct_cost),
    total_cost: Number(r.total_cost),
  }));

  return Response.json(body);
}
