import { NextResponse } from "next/server";
import { z } from "zod";

import { queryBudgetRollup } from "@/lib/reports/budget-rollup";
import {
  mergeEstimatedAndPlanned,
  queryPlannedArRevenueRollup,
} from "@/lib/reports/revenue-rollup";

export const runtime = "nodejs";

const levelSchema = z.enum(["division", "team", "product"]);

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  level: levelSchema.default("division"),
  division: z.string().trim().min(1).optional(),
  team: z.string().trim().min(1).optional(),
  initiativeTypes: z.string().trim().optional(),
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
      initiativeTypes: searchParams.get("initiativeTypes") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const { year, level, division, team, initiativeTypes } = parsed.data;
    const initiativeTypesArr = parseInitiativeTypes(initiativeTypes);

    const div = division ?? null;
    const tm = team ?? null;

    const [budgetRows, plannedRows] = await Promise.all([
      queryBudgetRollup({
        year,
        level,
        initiativeTypes: initiativeTypesArr,
        division: div,
        team: tm,
        productName: null,
      }),
      queryPlannedArRevenueRollup({
        year,
        level,
        division: div,
        team: tm,
      }),
    ]);

    const estimatedSlice = budgetRows.map((r) => ({
      key: r.key,
      label: r.label,
      revenue: r.revenue,
    }));

    const rows = mergeEstimatedAndPlanned(estimatedSlice, plannedRows);

    return NextResponse.json(
      {
        rows,
        meta: {
          year,
          level,
          division: div,
          team: tm,
          initiativeTypes: initiativeTypesArr,
        },
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err) {
    console.error("[GET /api/reports/revenue-rollup]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
