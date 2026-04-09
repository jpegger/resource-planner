import { type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type ViewRow = {
  year: unknown;
  eotp: unknown;
  eop_label: unknown;
  internal_cost: unknown;
  external_cost: unknown;
  direct_cost: unknown;
};

function isViewMissing(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /v_eotp_costs|does not exist|n'existe pas/i.test(msg);
}

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
    const raw =
      yearFilter === null
        ? await prisma.$queryRaw<ViewRow[]>`
            SELECT
              v.year,
              v.eotp,
              v.eop_label,
              v.internal_cost,
              v.external_cost,
              v.direct_cost
            FROM v_eotp_costs v
            WHERE v.product_id = ${id}
              AND v.is_main_eotp = true
            ORDER BY v.year DESC
          `
        : await prisma.$queryRaw<ViewRow[]>`
            SELECT
              v.year,
              v.eotp,
              v.eop_label,
              v.internal_cost,
              v.external_cost,
              v.direct_cost
            FROM v_eotp_costs v
            WHERE v.product_id = ${id}
              AND v.is_main_eotp = true
              AND v.year = ${yearFilter}
          `;

    const rows = raw.map((r) => ({
      year: Number(r.year),
      eotp: r.eotp == null ? null : String(r.eotp),
      eopLabel: r.eop_label == null ? null : String(r.eop_label),
      internalCost: Number(r.internal_cost),
      externalCost: Number(r.external_cost),
      directCost: Number(r.direct_cost),
    }));

    return Response.json(rows);
  } catch (e) {
    if (isViewMissing(e)) {
      return Response.json(
        {
          code: "V_EOTP_COSTS_MISSING",
          message:
            "View v_eotp_costs is missing. Recreate it after v_allocation_costs exists: npm run db:recreate:eotp-costs (or SEED_VIEW_ONLY=1 npm run db:seed:prod).",
        },
        { status: 503 }
      );
    }
    console.error("[GET /api/allocation-entities/.../eotp-main-from-view]", e);
    return Response.json({ error: "Could not load EOTP main row from view" }, { status: 500 });
  }
}
