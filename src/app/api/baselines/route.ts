import type { NextRequest } from "next/server";

import { getUserFromRequest } from "@/lib/auth";
import { parseBaselineExcel } from "@/lib/baseline-parser";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const baselines = await prisma.budgetBaseline.findMany({
    orderBy: { importedAt: "desc" },
    include: { _count: { select: { rows: true } } },
  });
  return Response.json(baselines);
}

export async function POST(request: NextRequest) {
  const { email } = getUserFromRequest(request);
  const formData = await request.formData();

  const name = String(formData.get("name") ?? "").trim();
  const version = String(formData.get("version") ?? "").trim();
  const yearRaw = formData.get("year");
  const file = formData.get("file");

  const year =
    typeof yearRaw === "string"
      ? Number.parseInt(yearRaw, 10)
      : typeof yearRaw === "number"
        ? yearRaw
        : NaN;

  if (!name || !version || !Number.isFinite(year) || !(file instanceof Blob)) {
    return Response.json({ error: "name, version, year and file are required" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const { rows, warnings } = parseBaselineExcel(buffer);

  if (rows.length === 0) {
    return Response.json({ error: "No valid rows found in file", warnings }, { status: 422 });
  }

  const baseline = await prisma.budgetBaseline.create({
    data: {
      name,
      version,
      year: Math.trunc(year),
      importedBy: email,
      rows: {
        create: rows.map((r) => ({
          eotp: r.eotp,
          eopLabel: r.eopLabel || null,
          cellule: r.cellule || null,
          amount: r.amount,
        })),
      },
    },
    include: { _count: { select: { rows: true } } },
  });

  return Response.json({ baseline, warnings }, { status: 201 });
}
