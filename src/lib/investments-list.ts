import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Only fields needed for the investments list + API list. Keeps the payload strictly
 * scalar / nested scalars so RSC → Client serialization matches Prisma’s plain JSON shape
 * (avoids hydration drift from unused columns like `Date`s on the entity).
 */
const investmentsListSelect = {
  id: true,
  name: true,
  productFamily: true,
  division: true,
  team: true,
  sapEotpCode: true,
  sapEotpName: true,
  costTotals: {
    select: {
      allocationEntityId: true,
      totalInternal: true,
      totalExternal: true,
      totalDirect: true,
    },
  },
} satisfies Prisma.AllocationEntitySelect;

/** Allocation entities for the investments table / with-budget API — typed from the `select` above. */
export type InvestmentsListRow = Prisma.AllocationEntityGetPayload<{
  select: typeof investmentsListSelect;
}>;

async function queryAllocationEntitiesWithBudget(): Promise<InvestmentsListRow[]> {
  return prisma.allocationEntity.findMany({
    orderBy: { name: "asc" },
    select: investmentsListSelect,
  });
}

/** Entities with `costTotals` for list UI and `GET /api/allocation-entities/with-budget`. */
export async function getAllocationEntitiesWithBudget(): Promise<{
  rows: InvestmentsListRow[];
  error: string | null;
}> {
  try {
    const rows = await queryAllocationEntitiesWithBudget();
    return { rows, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[getAllocationEntitiesWithBudget]", message);
    return { rows: [], error: message };
  }
}
