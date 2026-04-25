import { NextResponse } from "next/server";
import { z } from "zod";

import { queryBaselineByCellule, queryBaselineByEotp, queryBaselines } from "@/lib/reports/baseline-report";

export const runtime = "nodejs";

const querySchema = z.object({
  baselineId: z.string().trim().min(1).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      baselineId: searchParams.get("baselineId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const baselines = await queryBaselines();
    const baselineId = parsed.data.baselineId;
    if (!baselineId) {
      return NextResponse.json({ baselines }, { status: 200 });
    }

    const [byEotp, byCellule] = await Promise.all([
      queryBaselineByEotp(baselineId),
      queryBaselineByCellule(baselineId),
    ]);

    return NextResponse.json({ baselines, baselineId, byEotp, byCellule }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/reports/baseline]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

