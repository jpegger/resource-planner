import { NextResponse } from "next/server";
import { z } from "zod";

import { queryBudgetRollup } from "@/lib/reports/budget-rollup";

export const runtime = "nodejs";

const levelSchema = z.enum(["division", "team", "product", "initiative"]);

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  level: levelSchema.default("division"),
  division: z.string().trim().min(1).optional(),
  team: z.string().trim().min(1).optional(),
  productName: z.string().trim().min(1).optional(),
  initiativeTypes: z.string().trim().optional(), // comma-separated
});

function parseInitiativeTypes(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: searchParams.get("year"),
      level: searchParams.get("level") ?? undefined,
      division: searchParams.get("division") ?? undefined,
      team: searchParams.get("team") ?? undefined,
      productName: searchParams.get("productName") ?? undefined,
      initiativeTypes: searchParams.get("initiativeTypes") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const { year, level, division, team, productName, initiativeTypes } = parsed.data;

    const rows = await queryBudgetRollup({
      year,
      level,
      initiativeTypes: parseInitiativeTypes(initiativeTypes),
      division: division ?? null,
      team: team ?? null,
      productName: productName ?? null,
    });

    return NextResponse.json(
      {
        rows,
        meta: {
          year,
          level,
          division: division ?? null,
          team: team ?? null,
          productName: productName ?? null,
          initiativeTypes: parseInitiativeTypes(initiativeTypes),
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/reports/budget-rollup]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

