import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

/** Rollup of cost and FTE from `v_allocation_costs` for one allocation entity × planning year. */
export async function queryYearSummaryForAllocationEntity(
  allocationEntityId: string,
  year: number
): Promise<{ totalCost: number; totalFte: number }> {
  const id = allocationEntityId.trim();
  const rows = await prisma.$queryRaw<{ total_cost: unknown; total_fte: unknown }[]>(
    Prisma.sql`
      SELECT
        COALESCE(SUM(v.computed_cost), 0)::double precision AS total_cost,
        COALESCE(SUM(v.fte_decimal), 0)::double precision AS total_fte
      FROM v_allocation_costs v
      INNER JOIN initiative i ON i.id = v.jira_key
      WHERE i."allocation_entity_id" = ${id}
        AND i.year = ${year}
    `
  );
  const r = rows[0];
  return {
    totalCost: Number(r?.total_cost ?? 0),
    totalFte: Number(r?.total_fte ?? 0),
  };
}
