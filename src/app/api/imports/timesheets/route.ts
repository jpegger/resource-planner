import type { NextRequest } from "next/server";

import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseSnTimesheetCsv } from "@/lib/sn-timesheet-parser";
import { persistTimesheetRows } from "@/lib/timesheet-import-persist";

export const runtime = "nodejs";

export async function GET() {
  const imports = await prisma.timesheetImport.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Response.json(imports);
}

export async function POST(request: NextRequest) {
  const mode = process.env["SN_IMPORT_MODE"]?.trim().toLowerCase();
  if (mode && mode !== "csv") {
    return Response.json(
      { error: "Timesheet CSV upload is disabled when SN_IMPORT_MODE is not csv" },
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
    return Response.json({ error: "file is required (multipart field \"file\")" }, { status: 400 });
  }

  const text = await file.text();
  const { rows, totalInputRows, skippedByFilter, hasProgrammeEotpColumn } = parseSnTimesheetCsv(text);
  const fileName = file instanceof File ? file.name : "upload.csv";

  const { import: created, skippedAfterFilter, warnCount } = await persistTimesheetRows({
    fileName,
    importYear,
    importedBy: email,
    rows,
  });

  return Response.json(
    {
      import: created,
      summary: {
        fileName,
        importYear,
        totalInputRows,
        skippedByFilter,
        skippedAfterFilter,
        importedRows: created.rowCount,
        warnCount,
        hasProgrammeEotpColumn,
      },
    },
    { status: 201 }
  );
}
