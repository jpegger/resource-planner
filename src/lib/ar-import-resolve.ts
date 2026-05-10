import { prisma } from "@/lib/prisma";

export async function resolveArAllocationEntityId(
  sfMasterProductKey: string | null,
  sfMasterProductName: string | null
): Promise<{ allocationEntityId: string | null; importWarning: string | null }> {
  const key = sfMasterProductKey?.trim();
  if (key) {
    const ae = await prisma.allocationEntity.findFirst({
      where: { jiraKey: key },
      select: { id: true },
    });
    if (ae) return { allocationEntityId: ae.id, importWarning: null };
  }

  const name = sfMasterProductName?.trim();
  if (!name) {
    return {
      allocationEntityId: null,
      importWarning: "No master product name or key — cannot resolve product",
    };
  }

  const map = await prisma.sfMasterProductMapping.findUnique({
    where: { sfMasterProductName: name },
    select: { allocationEntityId: true },
  });
  if (map?.allocationEntityId) {
    return { allocationEntityId: map.allocationEntityId, importWarning: null };
  }
  return {
    allocationEntityId: null,
    importWarning: `Master product not mapped: ${name}`,
  };
}
