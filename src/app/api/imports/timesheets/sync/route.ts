import type { NextRequest } from "next/server";

import { getUserFromRequest } from "@/lib/auth";
import { fetchServicenowTimesheetRecords } from "@/lib/sn-client";
import { mapSnApiRecordsToTimesheetRows } from "@/lib/sn-timesheet-parser";
import { persistTimesheetRows } from "@/lib/timesheet-import-persist";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const mode = process.env["SN_IMPORT_MODE"]?.trim().toLowerCase();
  if (mode !== "api") {
    return Response.json(
      { error: "SN API sync requires SN_IMPORT_MODE=api and SN credentials in .env" },
      { status: 400 }
    );
  }

  let body: { year?: number };
  try {
    body = (await request.json()) as { year?: number };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const year = typeof body.year === "number" ? Math.trunc(body.year) : NaN;
  if (!Number.isFinite(year) || year < 1990 || year > 2100) {
    return Response.json({ error: "year must be a valid integer" }, { status: 400 });
  }

  const { email } = getUserFromRequest(request);

  let records: Record<string, unknown>[];
  try {
    records = await fetchServicenowTimesheetRecords(year);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "SN fetch failed";
    return Response.json({ error: msg }, { status: 502 });
  }

  const { rows, totalInputRows, skippedByFilter, hasProgrammeEotpColumn } =
    mapSnApiRecordsToTimesheetRows(records);

  const fileName = `api-sync-${year}-${Date.now()}`;
  const { import: created, skippedAfterFilter, warnCount } = await persistTimesheetRows({
    fileName,
    importYear: year,
    importedBy: email,
    rows,
  });

  return Response.json(
    {
      import: created,
      summary: {
        fileName,
        importYear: year,
        snApiRowCount: records.length,
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
