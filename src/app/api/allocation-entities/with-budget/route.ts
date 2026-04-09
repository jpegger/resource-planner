import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Per-product INT/EXT/DIR totals from v_allocation_costs (all years, all initiatives linked to the product). */
export async function GET() {
  const rows = await prisma.$queryRaw<
    Array<{
      product_id: string;
      product_name: string;
      product_family: unknown;
      total_internal: unknown;
      total_external: unknown;
      total_direct: unknown;
    }>
  >`
    SELECT
      pr.id AS product_id,
      pr.name AS product_name,
      pr."productFamily" AS product_family,
      COALESCE(SUM(v.internal_cost), 0) AS total_internal,
      COALESCE(SUM(v.external_cost), 0) AS total_external,
      COALESCE(SUM(v.direct_cost), 0) AS total_direct
    FROM product pr
    INNER JOIN initiative i ON i."productId" = pr.id
    INNER JOIN v_allocation_costs v ON v.jira_key = i.id
    GROUP BY pr.id, pr.name, pr."productFamily"
    ORDER BY pr.name ASC
  `;

  return Response.json(
    rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      product_family: r.product_family == null ? null : String(r.product_family),
      total_internal: Number(r.total_internal),
      total_external: Number(r.total_external),
      total_direct: Number(r.total_direct),
    }))
  );
}
