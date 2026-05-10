import type { NextRequest } from "next/server";

import { upsertArEntriesFromLineItems } from "@/lib/ar-import-persist";
import { getUserFromRequest } from "@/lib/auth";
import { buildArLineSoql, sfQueryAll } from "@/lib/sf-client";
import { flattenSalesforceArParentsToLineItems } from "@/lib/sf-ar-parser";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const mode = process.env["SF_IMPORT_MODE"]?.trim().toLowerCase();
  if (mode !== "api") {
    return Response.json(
      { error: "SF API sync requires SF_IMPORT_MODE=api and SF credentials in .env" },
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

  let parents: Record<string, unknown>[];
  try {
    const soql = buildArLineSoql(year);
    parents = await sfQueryAll<Record<string, unknown>>(soql);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "SF query failed";
    return Response.json({ error: msg }, { status: 502 });
  }

  const lines = flattenSalesforceArParentsToLineItems(parents, year);

  const imp = await prisma.arImport.create({
    data: {
      fileName: `api-sync-${year}-${Date.now()}`,
      year,
      importedBy: email,
      rowCount: 0,
      warnCount: 0,
    },
  });

  const { upserted, warnCount } = await upsertArEntriesFromLineItems({
    importId: imp.id,
    importYear: year,
    lines,
  });

  await prisma.arImport.update({
    where: { id: imp.id },
    data: { rowCount: upserted, warnCount },
  });

  return Response.json(
    {
      import: await prisma.arImport.findUnique({ where: { id: imp.id } }),
      summary: {
        sfParentCount: parents.length,
        flattenedLines: lines.length,
        upsertedRows: upserted,
        warnCount,
      },
    },
    { status: 201 }
  );
}
