import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Per-allocation cost breakdown from v_allocation_costs for the allocation grid. */
export async function GET(req: NextRequest) {
  const initiativeId = new URL(req.url).searchParams.get("initiativeId");
  if (!initiativeId?.trim()) {
    return NextResponse.json({ error: "initiativeId query parameter is required" }, { status: 400 });
  }

  const rows = await prisma.$queryRaw<
    Array<{
      allocation_id: string;
      internal_cost: unknown;
      external_cost: unknown;
      direct_cost: unknown;
      computed_cost: unknown;
    }>
  >`
    SELECT
      allocation_id,
      internal_cost,
      external_cost,
      direct_cost,
      computed_cost
    FROM v_allocation_costs
    WHERE jira_key = ${initiativeId.trim()}
  `;

  const body = rows.map((r) => ({
    allocation_id: r.allocation_id,
    internal_cost: Number(r.internal_cost),
    external_cost: Number(r.external_cost),
    direct_cost: Number(r.direct_cost),
    computed_cost: Number(r.computed_cost),
  }));

  return NextResponse.json(body);
}
