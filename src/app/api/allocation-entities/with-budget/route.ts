import { getAllocationEntitiesWithBudget } from "@/lib/investments-list";

export const runtime = "nodejs";

/** Every allocation entity with INT/EXT/DIR rollups on `costTotals` (from `v_allocation_entity_cost_totals`). */
export async function GET() {
  const { rows, error } = await getAllocationEntitiesWithBudget();
  if (error) {
    console.error("[GET /api/allocation-entities/with-budget]", error);
    return Response.json({ error }, { status: 500 });
  }
  return Response.json(rows);
}
