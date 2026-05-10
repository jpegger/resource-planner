import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveArAllocationEntityId } from "@/lib/ar-import-resolve";
import type { ArLineItem } from "@/lib/sf-ar-parser";

function toDateUtc(parts: { year: number; month: number; day: number } | null): Date | null {
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function parseQty(raw: string | null): Prisma.Decimal | null {
  if (!raw?.trim()) return null;
  const s = raw.replace(",", ".").trim();
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}

function parseAmountAr(raw: string): Prisma.Decimal | null {
  const s = raw.replace(/\s/g, "").replace(",", ".").trim();
  if (!s) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return new Prisma.Decimal(s);
}

export async function upsertArEntriesFromLineItems(params: {
  importId: string;
  importYear: number;
  lines: ArLineItem[];
}): Promise<{ upserted: number; warnCount: number }> {
  const { importId, importYear, lines } = params;
  let upserted = 0;
  let warnCount = 0;

  for (const row of lines) {
    const amount = parseAmountAr(row.amountEur);
    if (!amount) continue;

    const { allocationEntityId, importWarning } = await resolveArAllocationEntityId(
      row.sfMasterProductKey,
      row.sfMasterProductName
    );
    if (importWarning) warnCount++;

    await prisma.arEntry.upsert({
      where: {
        uniqueArId_year: { uniqueArId: row.uniqueArId, year: importYear },
      },
      create: {
        importId,
        uniqueArId: row.uniqueArId,
        contractNumber: row.contractNumber,
        contractName: row.contractName,
        counterpartReference: row.counterpartReference,
        lineItemNumber: row.lineItemNumber,
        documentStatus: row.documentStatus,
        signedDate: toDateUtc(row.signedDate),
        clientName: row.clientName,
        sfMasterProductName: row.sfMasterProductName,
        sfMasterProductKey: row.sfMasterProductKey,
        sfProductName: row.sfProductName,
        description: row.description,
        sapProductCode: row.sapProductCode,
        sapSoNumber: row.sapSoNumber,
        wbs: row.wbs,
        endDate: toDateUtc(row.endDate),
        quantity: parseQty(row.quantity),
        amountEur: amount,
        year: importYear,
        allocationEntityId,
        importWarning,
      },
      update: {
        importId,
        contractNumber: row.contractNumber,
        contractName: row.contractName,
        counterpartReference: row.counterpartReference,
        lineItemNumber: row.lineItemNumber,
        documentStatus: row.documentStatus,
        signedDate: toDateUtc(row.signedDate),
        clientName: row.clientName,
        sfMasterProductName: row.sfMasterProductName,
        sfMasterProductKey: row.sfMasterProductKey,
        sfProductName: row.sfProductName,
        description: row.description,
        sapProductCode: row.sapProductCode,
        sapSoNumber: row.sapSoNumber,
        wbs: row.wbs,
        endDate: toDateUtc(row.endDate),
        quantity: parseQty(row.quantity),
        amountEur: amount,
        allocationEntityId,
        importWarning,
      },
    });
    upserted++;
  }

  return { upserted, warnCount };
}
