import { prisma } from "@/lib/prisma";
import { computeEotpBreakdown } from "@/lib/eotp";
import type { EotpRoutingRow } from "@/lib/eotp";

export type AllocationBreakdownRow = {
  eotp: string;
  eopLabel: string | null;
  productId: string;
  productName: string;
  internal: number;
  external: number;
  direct: number;
};

/**
 * Same cost attribution as a snapshot, from current `v_allocation_costs` and routing — not persisted.
 */
export async function computeAllocationBreakdownForYear(year: number): Promise<AllocationBreakdownRow[]> {
  const entities = await prisma.allocationEntity.findMany({
    include: {
      eotpRoutings: { where: { year } },
    },
  });

  const costs = await prisma.$queryRaw<
    Array<{
      product_name: string;
      internal_cost: unknown;
      external_cost: unknown;
      direct_cost: unknown;
    }>
  >`
    SELECT
      product_name,
      SUM(internal_cost) AS internal_cost,
      SUM(external_cost) AS external_cost,
      SUM(direct_cost) AS direct_cost
    FROM v_allocation_costs
    WHERE initiative_year = ${year}
      AND product_name IS NOT NULL
      AND product_name <> 'Unassigned'
    GROUP BY product_name
  `;

  const costMap = new Map(
    costs.map((c) => [
      c.product_name,
      {
        internal: Number(c.internal_cost),
        external: Number(c.external_cost),
        direct: Number(c.direct_cost),
      },
    ])
  );

  const rowPayloads: AllocationBreakdownRow[] = [];

  for (const entity of entities) {
    if (!entity.sapEotpCode?.trim()) continue;

    const c = costMap.get(entity.name);
    if (!c) continue;

    const routings: EotpRoutingRow[] = entity.eotpRoutings.map((r) => ({
      id: r.id,
      eotp: r.eotp,
      eopLabel: r.eopLabel,
      year: r.year,
      internalAmount: r.internalAmount,
      externalAmount: r.externalAmount,
      directAmount: r.directAmount,
      comment: r.comment,
    }));

    const breakdown = computeEotpBreakdown(
      entity.sapEotpCode,
      entity.sapEotpName ?? entity.sapEotpCode,
      c,
      routings
    );

    for (const row of breakdown) {
      rowPayloads.push({
        eotp: row.eotp,
        eopLabel: row.eopLabel,
        productId: entity.id,
        productName: entity.name,
        internal: row.internal,
        external: row.external,
        direct: row.direct,
      });
    }
  }

  return rowPayloads;
}

/**
 * Compute and persist an allocation snapshot for a given year.
 * Aggregates `v_allocation_costs` per product name, applies `computeEotpBreakdown`, writes frozen rows.
 */
export async function takeSnapshot(
  name: string,
  year: number,
  takenBy: string
): Promise<{ snapshotId: string; rowCount: number }> {
  const rowPayloads = await computeAllocationBreakdownForYear(year);

  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.allocationSnapshot.create({
      data: { name, year, takenBy },
    });

    if (rowPayloads.length > 0) {
      await tx.allocationSnapshotRow.createMany({
        data: rowPayloads.map((r) => ({
          ...r,
          snapshotId: snapshot.id,
        })),
      });
    }

    return { snapshotId: snapshot.id, rowCount: rowPayloads.length };
  });
}
