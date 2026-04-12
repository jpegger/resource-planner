import type {
  EotpRoutingRow,
  MainEotpFromViewRow,
} from "@/app/investments/[id]/investment-detail-types";
import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

const eotpRoutingDetailSelect = {
  id: true,
  year: true,
  eotp: true,
  eopLabel: true,
  internalAmount: true,
  externalAmount: true,
  directAmount: true,
  comment: true,
} as const;

/** All routing rows for the entity (all years) — JSON-safe for RSC. */
export async function getEotpRoutingRowsForEntity(productId: string): Promise<EotpRoutingRow[]> {
  try {
    const rows = await prisma.eotpRouting.findMany({
      where: { allocationEntityId: productId.trim() },
      select: eotpRoutingDetailSelect,
      orderBy: [{ year: "asc" }, { eotp: "asc" }],
    });
    return rows as EotpRoutingRow[];
  } catch {
    return [];
  }
}

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

const V_EOTP_COSTS_MISSING_MSG =
  "View v_eotp_costs is missing. Recreate it after v_allocation_costs exists: npm run db:recreate:eotp-costs (or SEED_VIEW_ONLY=1 npm run db:seed:prod).";

/**
 * Main EOTP remainder rows from `v_eotp_costs` (`is_main_eotp = true`).
 * The view is defined in SQL (`scripts/eotp-views.ts`), not as a Prisma model — use `$queryRaw`.
 * `yearFilter === null` returns all years for the product.
 */
export async function getEotpMainFromViewForEntity(
  productId: string,
  yearFilter: number | null
): Promise<{ rows: MainEotpFromViewRow[]; error: string | null }> {
  const id = productId.trim();
  try {
    const raw = await prisma.$queryRaw<ViewRow[]>(
      Prisma.sql`
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
          ${yearFilter === null ? Prisma.empty : Prisma.sql`AND v.year = ${yearFilter}`}
        ORDER BY v.year DESC
      `
    );

    const rows: MainEotpFromViewRow[] = raw.map((r) => ({
      year: Number(r.year),
      eotp: r.eotp == null ? null : String(r.eotp),
      eopLabel: r.eop_label == null ? null : String(r.eop_label),
      internalCost: Number(r.internal_cost),
      externalCost: Number(r.external_cost),
      directCost: Number(r.direct_cost),
    }));

    return { rows, error: null };
  } catch (e) {
    if (isViewMissing(e)) {
      return { rows: [], error: V_EOTP_COSTS_MISSING_MSG };
    }
    throw e;
  }
}
