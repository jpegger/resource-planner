import { NextResponse } from "next/server";
import { z } from "zod";

import {
  queryEotpLinesFilters,
  queryEotpTotals,
  queryProductsForEotp,
} from "@/lib/reports/eotp-report";

export const runtime = "nodejs";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  eotp: z.string().trim().min(1).optional(),
  division: z.string().trim().min(1).optional(),
  subDivision: z.string().trim().min(1).optional(),
  team: z.string().trim().min(1).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: searchParams.get("year"),
      eotp: searchParams.get("eotp") ?? undefined,
      division: searchParams.get("division") ?? undefined,
      subDivision: searchParams.get("subDivision") ?? undefined,
      team: searchParams.get("team") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const { year, eotp, division, subDivision, team } = parsed.data;
    const filters = await queryEotpLinesFilters(year);
    const eotps = await queryEotpTotals(year, { division, subDivision, team });
    if (!eotp) {
      return NextResponse.json({ eotps, filters }, { status: 200 });
    }

    const products = await queryProductsForEotp(year, eotp, { division, subDivision, team });
    return NextResponse.json(
      { eotps, filters, eotp, products, applied: { division, subDivision, team } },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/reports/eotp-lines]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

