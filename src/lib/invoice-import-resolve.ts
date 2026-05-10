import { prisma } from "@/lib/prisma";
import { extractEotpRoot } from "@/lib/eotp-root";

export async function resolveInvoiceEotpDefinitionId(
  eotpFullPath: string
): Promise<{ eotpDefinitionId: string | null; importWarning: string | null }> {
  const root = extractEotpRoot(eotpFullPath);
  if (!root) {
    return { eotpDefinitionId: null, importWarning: "Invalid EOTP path on row" };
  }
  const ed = await prisma.eotpDefinition.findFirst({
    where: { sapEotpCode: root },
    select: { id: true },
  });
  if (!ed) {
    return { eotpDefinitionId: null, importWarning: `EOTP not found: ${root}` };
  }
  return { eotpDefinitionId: ed.id, importWarning: null };
}
