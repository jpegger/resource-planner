import type { PrismaClient } from "@/generated/prisma/client";

import type { EotpDefinitionOptionRow } from "@/lib/eotp-target-options";

/** All rows from `eotp_definition` for the EOTP routing combobox. */
export async function loadEotpDefinitionOptionRows(
  prisma: PrismaClient
): Promise<EotpDefinitionOptionRow[]> {
  return prisma.eotpDefinition.findMany({
    orderBy: [{ label: "asc" }, { sapEotpCode: "asc" }],
    select: {
      id: true,
      sapEotpCode: true,
      label: true,
      team: true,
      budgetOwner: true,
      division: true,
    },
  });
}
