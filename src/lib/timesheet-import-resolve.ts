import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export function parseTimesheetHours(raw: string): Prisma.Decimal | null {
  const s = raw.replace(",", ".").trim();
  if (!s) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}

export async function resolveTimesheetAllocationEntityId(
  programmeName: string | null,
  programmeEotp: string | null
): Promise<{ allocationEntityId: string | null; importWarning: string | null }> {
  const eotpRaw = programmeEotp?.trim();
  if (eotpRaw) {
    const ed = await prisma.eotpDefinition.findFirst({
      where: { sapEotpCode: eotpRaw },
      select: { id: true },
    });
    if (ed) {
      const ae = await prisma.allocationEntity.findFirst({
        where: { eotpDefinitionId: ed.id },
        select: { id: true },
      });
      if (ae) return { allocationEntityId: ae.id, importWarning: null };
      const aeByCode = await prisma.allocationEntity.findFirst({
        where: { sapEotpCode: eotpRaw },
        select: { id: true },
      });
      if (aeByCode) return { allocationEntityId: aeByCode.id, importWarning: null };
    } else {
      const aeByCode = await prisma.allocationEntity.findFirst({
        where: { sapEotpCode: eotpRaw },
        select: { id: true },
      });
      if (aeByCode) return { allocationEntityId: aeByCode.id, importWarning: null };
    }
    return {
      allocationEntityId: null,
      importWarning: `EOTP not resolved from programme EOTP: ${eotpRaw}`,
    };
  }

  const name = programmeName?.trim();
  if (!name) {
    return {
      allocationEntityId: null,
      importWarning: "No programme name or EOTP — cannot resolve product",
    };
  }

  const map = await prisma.snProgrammeMapping.findUnique({
    where: { snProgrammeName: name },
    select: { allocationEntityId: true },
  });
  if (map?.allocationEntityId) {
    return { allocationEntityId: map.allocationEntityId, importWarning: null };
  }
  return {
    allocationEntityId: null,
    importWarning: `Programme not mapped: ${name}`,
  };
}

export async function resolveTimesheetInitiativeId(
  snProjectNr: string | null,
  rowYear: number
): Promise<string | null> {
  if (!snProjectNr?.trim()) return null;
  const nr = snProjectNr.trim();
  const mappings = await prisma.snProjectMapping.findMany({
    where: {
      snProjectNr: nr,
      OR: [{ year: rowYear }, { year: null }],
    },
    select: { initiativeId: true, year: true },
  });
  if (mappings.length === 0) return null;
  const exact = mappings.find((m) => m.year === rowYear);
  if (exact?.initiativeId) return exact.initiativeId;
  const fallback = mappings.find((m) => m.year === null);
  return fallback?.initiativeId ?? mappings[0]?.initiativeId ?? null;
}

export async function resolveTimesheetResourceId(fullName: string): Promise<string | null> {
  const r = await prisma.resource.findFirst({
    where: { fullName: { equals: fullName.trim(), mode: Prisma.QueryMode.insensitive } },
    select: { id: true },
  });
  return r?.id ?? null;
}
