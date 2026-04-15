import { type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { computeEotpBreakdown } from "@/lib/eotp";
import type { EotpRoutingRow } from "@/lib/eotp";
import { queryBudgetRawRows } from "@/lib/investment-detail-budget-query";

export const runtime = "nodejs";

/** Per-initiative cost rollups (from `v_allocation_costs` + `initiative_revenue`). Optional ?year= filters initiatives. */
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

  const rows = await queryBudgetRawRows(productId.trim(), yearFilter);

  const entity = await prisma.allocationEntity.findUnique({
    where: { id: productId.trim() },
    select: { sapEotpCode: true, sapEotpName: true },
  });

  let routings: EotpRoutingRow[] = [];
  if (entity?.sapEotpCode) {
    try {
      routings = await prisma.eotpRouting.findMany({
        where: {
          allocationEntityId: productId.trim(),
          ...(yearFilter === null ? {} : { year: yearFilter }),
        },
      });
    } catch {
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
      total_revenue: Number(r.total_revenue ?? 0),
      revenue_mission: Number(r.revenue_mission ?? 0),
      revenue_subscription: Number(r.revenue_subscription ?? 0),
      eotpBreakdown:
        entity?.sapEotpCode
          ? computeEotpBreakdown(
              entity.sapEotpCode,
              entity.sapEotpName ?? entity.sapEotpCode,
              { internal, external, direct },
              routings.filter((x) => x.year === initiativeYear)
            )
          : [],
    };
  });

  return Response.json(body);
}
