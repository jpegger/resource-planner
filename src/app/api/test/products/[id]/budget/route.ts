import { type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { computeEotpBreakdown } from "@/lib/eotp";
import type { EotpRoutingRow } from "@/lib/eotp";

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

  const product = await prisma.product.findUnique({
    where: { id: productId.trim() },
    select: { sapEotpCode: true, sapEotpName: true },
  });

  let routings: EotpRoutingRow[] = [];
  if (product?.sapEotpCode) {
    try {
      routings = await prisma.eotpRouting.findMany({
        where: {
          productId: productId.trim(),
          ...(yearFilter === null ? {} : { year: yearFilter }),
        },
      });
    } catch {
      // e.g. migration not applied yet (`eotp_routing` missing) — still return budget rows without EOTP breakdown
      routings = [];
    }
  }

  const body = rows.map((r) => {
    const initiativeYear = Number(r.initiative_year);
    const internal = Number(r.internal_cost);
    const external = Number(r.external_cost);
    const direct = Number(r.direct_cost);

    return {
      jira_key: r.jira_key,
      summary: r.summary,
      status: r.status,
      initiative_year: initiativeYear,
      internal_cost: internal,
      external_cost: external,
      direct_cost: direct,
      total_cost: Number(r.total_cost),
      eotpBreakdown:
        product?.sapEotpCode
          ? computeEotpBreakdown(
              product.sapEotpCode,
              product.sapEotpName ?? product.sapEotpCode,
              { internal, external, direct },
              routings.filter((x) => x.year === initiativeYear)
            )
          : [],
    };
  });

  return Response.json(body);
}
