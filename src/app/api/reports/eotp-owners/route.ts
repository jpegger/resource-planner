import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({ year: searchParams.get("year") ?? undefined });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // Note: eotp_definition is not year-specific; year param is kept for future-proofing.
    const rows = await prisma.eotpDefinition.findMany({
      select: { division: true, subDivision: true, team: true, budgetOwner: true },
      distinct: ["division", "subDivision", "team", "budgetOwner"],
      orderBy: [{ division: "asc" }, { subDivision: "asc" }, { team: "asc" }, { budgetOwner: "asc" }],
    });

    const divisions = Array.from(
      new Set(rows.map((r) => (r.division ?? "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    return NextResponse.json(
      {
        rows: rows.map((r) => ({
          division: r.division,
          subDivision: r.subDivision,
          team: r.team,
          owner: r.budgetOwner,
        })),
        divisions,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/reports/eotp-owners]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

