import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveInvoiceEotpDefinitionId } from "@/lib/invoice-import-resolve";
import { parseSapVimInvoiceCsv } from "@/lib/sap-invoice-parser";

export const runtime = "nodejs";

function parseAmountEur(raw: string): Prisma.Decimal | null {
  const s = raw.replace(/\s/g, "").replace(",", ".").trim();
  if (!s) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}

export async function GET() {
  const rows = await prisma.invoiceImport.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const { email } = getUserFromRequest(request);
  const formData = await request.formData();
  const yearRaw = formData.get("year");
  const file = formData.get("file");
  const importYear =
    typeof yearRaw === "string"
      ? Number.parseInt(yearRaw, 10)
      : typeof yearRaw === "number"
        ? Math.trunc(yearRaw)
        : NaN;
  if (!Number.isFinite(importYear) || importYear < 1990 || importYear > 2100) {
    return Response.json({ error: "year must be a valid integer" }, { status: 400 });
  }
  if (!(file instanceof Blob)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  const text = await file.text();
  const { rows, totalLines, skipped } = parseSapVimInvoiceCsv(text);
  const fileName = file instanceof File ? file.name : "upload.csv";

  type ERow = {
    sapVimDocId: string;
    sapReservationNr: string | null;
    sapVendorCode: string | null;
    vendorName: string | null;
    eotpFullPath: string;
    invoiceDate: Date;
    year: number;
    month: number;
    amountEur: Prisma.Decimal;
    compteBudgetaire: string;
    costType: string;
    eotpDefinitionId: string | null;
    importWarning: string | null;
  };

  const toInsert: ERow[] = [];
  let warnCount = 0;

  for (const row of rows) {
    const amt = parseAmountEur(row.amountEur);
    if (!amt) continue;
    const { eotpDefinitionId, importWarning } = await resolveInvoiceEotpDefinitionId(row.eotpFullPath);
    if (importWarning) warnCount++;

    const d = row.invoiceDate;
    toInsert.push({
      sapVimDocId: row.sapVimDocId,
      sapReservationNr: row.sapReservationNr,
      sapVendorCode: row.sapVendorCode,
      vendorName: row.vendorName,
      eotpFullPath: row.eotpFullPath,
      invoiceDate: new Date(Date.UTC(d.year, d.month - 1, d.day)),
      year: d.year,
      month: d.month,
      amountEur: amt,
      compteBudgetaire: row.compteBudgetaire,
      costType: "EXTERNAL",
      eotpDefinitionId,
      importWarning,
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const imp = await tx.invoiceImport.create({
      data: {
        fileName,
        year: importYear,
        importedBy: email,
        rowCount: toInsert.length,
        warnCount,
      },
    });
    if (toInsert.length > 0) {
      await tx.invoiceEntry.createMany({
        data: toInsert.map((r) => ({ ...r, importId: imp.id })),
      });
    }
    return imp;
  });

  return Response.json(
    {
      import: created,
      summary: { fileName, importYear, totalLines, skipped, importedRows: toInsert.length, warnCount },
    },
    { status: 201 }
  );
}
