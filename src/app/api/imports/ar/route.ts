import type { NextRequest } from "next/server";

import { upsertArEntriesFromLineItems } from "@/lib/ar-import-persist";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseSfArExportCsv } from "@/lib/sf-ar-parser";

export const runtime = "nodejs";

export async function GET() {
  const rows = await prisma.arImport.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Response.json(rows);
}

export async function POST(request: NextRequest) {
  const mode = process.env["SF_IMPORT_MODE"]?.trim().toLowerCase();
  if (mode && mode !== "csv") {
    return Response.json(
      { error: "AR CSV upload is disabled when SF_IMPORT_MODE is not csv" },
      { status: 400 }
    );
  }

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
  const { rows, totalInputRows, skipped, hasMasterProductKeyColumn } = parseSfArExportCsv(
    text,
    importYear
  );
  const fileName = file instanceof File ? file.name : "upload.csv";

  const imp = await prisma.arImport.create({
    data: {
      fileName,
      year: importYear,
      importedBy: email,
      rowCount: 0,
      warnCount: 0,
    },
  });

  const { upserted, warnCount } = await upsertArEntriesFromLineItems({
    importId: imp.id,
    importYear,
    lines: rows,
  });

  await prisma.arImport.update({
    where: { id: imp.id },
    data: { rowCount: upserted, warnCount },
  });

  return Response.json(
    {
      import: await prisma.arImport.findUnique({ where: { id: imp.id } }),
      summary: {
        fileName,
        importYear,
        totalInputRows,
        skipped,
        upsertedRows: upserted,
        warnCount,
        hasMasterProductKeyColumn,
      },
    },
    { status: 201 }
  );
}
