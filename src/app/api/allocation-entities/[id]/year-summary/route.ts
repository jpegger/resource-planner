import { type NextRequest } from "next/server";

import { queryYearSummaryForAllocationEntity } from "@/lib/investment-year-summary";

export const runtime = "nodejs";

/** GET `?year=` — total cost (EUR) and summed FTE from `v_allocation_costs` for the entity × year. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return Response.json({ error: "Missing allocation entity id" }, { status: 400 });
  }
  const yearParam = request.nextUrl.searchParams.get("year");
  const y = yearParam !== null && yearParam !== "" ? Number.parseInt(yearParam, 10) : NaN;
  if (!Number.isFinite(y)) {
    return Response.json({ error: "year query parameter is required" }, { status: 400 });
  }

  try {
    const { totalCost, totalFte } = await queryYearSummaryForAllocationEntity(id.trim(), y);
    return Response.json({ year: y, totalCost, totalFte });
  } catch {
    return Response.json({ error: "Could not load year summary" }, { status: 503 });
  }
}
