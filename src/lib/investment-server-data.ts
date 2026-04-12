import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import type { Investment, ResourceOption } from "@/lib/investment-types";

/** Scalar card fields only — JSON-safe for RSC → Client (same pattern as investments list). */
const investmentDetailSelect = {
  id: true,
  name: true,
  productFamily: true,
  division: true,
  subDivision: true,
  team: true,
  sapEotpCode: true,
  sapEotpName: true,
  attractiveness: true,
  competitiveness: true,
} satisfies Prisma.AllocationEntitySelect;

const resourcePickerSelect = {
  id: true,
  fullName: true,
  type: true,
} satisfies Prisma.ResourceSelect;

export async function getInvestmentEntityForDetail(id: string): Promise<Investment | null> {
  const row = await prisma.allocationEntity.findUnique({
    where: { id },
    select: investmentDetailSelect,
  });
  if (!row) return null;
  return row as Investment;
}

export async function getResourcesForPicker(): Promise<ResourceOption[]> {
  const rows = await prisma.resource.findMany({
    select: resourcePickerSelect,
    orderBy: { fullName: "asc" },
  });
  return rows;
}
