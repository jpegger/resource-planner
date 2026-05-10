import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveRevenueEntry } from "@/lib/revenue-import-resolve";
import { parseSapClientInvoiceCsv } from "@/lib/sap-revenue-parser";

export const runtime = "nodejs";

function parseAmountRev(raw: string): Prisma.Decimal | null {
  const s = raw.replace(/\s/g, "").trim();
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
  const rows = await prisma.revenueImport.findMany({
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
  const { rows, totalLines, skipped: parseSkipped } = parseSapClientInvoiceCsv(text);
  const fileName = file instanceof File ? file.name : "upload.csv";

  let warnCount = 0;
  let upserted = 0;
  let skippedYear = 0;
  let step1Count = 0;
  let step2Count = 0;
  let step3Count = 0;
  let step4Count = 0;

  const imp = await prisma.revenueImport.create({
    data: {
      fileName,
      year: importYear,
      importedBy: email,
      rowCount: 0,
      warnCount: 0,
    },
  });

  for (const row of rows) {
    if (row.accountingYear !== importYear) {
      skippedYear++;
      continue;
    }
    const amt = parseAmountRev(row.amountEur);
    if (!amt) continue;

    const { arEntryId, allocationEntityId, importWarning, step } = await resolveRevenueEntry({
      extDocRef: row.extDocRef,
      designation: row.productLabel,
      eotpFull: row.eotpFull,
    });
    if (importWarning) warnCount++;
    if (step === 1) step1Count++;
    else if (step === 2) step2Count++;
    else if (step === 3) step3Count++;
    else step4Count++;

    const d = row.invoiceDate;
    await prisma.revenueEntry.upsert({
      where: {
        sapInvoiceNr_year_sapInvoiceItem: {
          sapInvoiceNr: row.sapInvoiceNr,
          year: row.accountingYear,
          sapInvoiceItem: row.sapInvoiceItem,
        },
      },
      create: {
        importId: imp.id,
        sapDocType: row.sapDocType,
        sapInvoiceNr: row.sapInvoiceNr,
        sapInvoiceItem: row.sapInvoiceItem,
        sapSalesOrder: row.sapSalesOrder,
        extDocRef: row.extDocRef,
        clientName: row.clientName,
        sapArticleCode: row.sapArticleCode,
        productLabel: row.productLabel,
        eotpFull: row.eotpFull,
        year: row.accountingYear,
        month: d.month,
        amountEur: amt,
        arEntryId,
        allocationEntityId,
        importWarning,
      },
      update: {
        importId: imp.id,
        sapDocType: row.sapDocType,
        sapSalesOrder: row.sapSalesOrder,
        extDocRef: row.extDocRef,
        clientName: row.clientName,
        sapArticleCode: row.sapArticleCode,
        productLabel: row.productLabel,
        eotpFull: row.eotpFull,
        month: d.month,
        amountEur: amt,
        arEntryId,
        allocationEntityId,
        importWarning,
      },
    });
    upserted++;
  }

  await prisma.revenueImport.update({
    where: { id: imp.id },
    data: { rowCount: upserted, warnCount },
  });

  return Response.json(
    {
      import: await prisma.revenueImport.findUnique({ where: { id: imp.id } }),
      summary: {
        fileName,
        importYear,
        totalLines,
        parseSkipped,
        skippedYearMismatch: skippedYear,
        upsertedRows: upserted,
        step1Count,
        step2Count,
        step3Count,
        step4Count,
        warnCount,
      },
    },
    { status: 201 }
  );
}
