import { type NextRequest } from "next/server";

import { getEotpMainFromViewForEntity } from "@/lib/investment-detail-eotp-queries";

export const runtime = "nodejs";

/**
 * Main EOTP remainder rows from v_eotp_costs (calculated after non-main routing).
 * Optional ?year= filters to one planning year; omit year to return all main rows for the product.
 */
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

  const id = productId.trim();

  try {
    const { rows, error } = await getEotpMainFromViewForEntity(id, yearFilter);
    if (error) {
      return Response.json(
        {
          code: "V_EOTP_COSTS_MISSING",
          message: error,
        },
        { status: 503 }
      );
    }
    return Response.json(rows);
  } catch (e) {
    console.error("[GET /api/allocation-entities/.../eotp-main-from-view]", e);
    return Response.json({ error: "Could not load EOTP main row from view" }, { status: 500 });
  }
}
