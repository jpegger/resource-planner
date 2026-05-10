import { NextResponse } from "next/server";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const querySchema = z.object({
  year: z.coerce.number().int().min(1990).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
  division: z.string().trim().min(1).optional(),
  subdivision: z.string().trim().min(1).optional(),
  team: z.string().trim().min(1).optional(),
  owner: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
});

type VRow = {
  year: number;
  month: number;
  cost_type: string;
  allocation_entity_id: string | null;
  product_name: string | null;
  eotp: string | null;
  division: string | null;
  sub_division: string | null;
  team: string | null;
  owner: string | null;
  amount_eur: unknown;
  hours: unknown;
  import_warning: string | null;
};

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: searchParams.get("year"),
      month: searchParams.get("month") ?? undefined,
      division: searchParams.get("division") ?? undefined,
      subdivision: searchParams.get("subdivision") ?? undefined,
      team: searchParams.get("team") ?? undefined,
      owner: searchParams.get("owner") ?? undefined,
      productId: searchParams.get("productId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }
    const { year, month, division, subdivision, team, owner, productId } = parsed.data;

    const monthSql =
      month === undefined ? Prisma.empty : Prisma.sql`AND month = ${month}`;
    const productSql =
      productId === undefined
        ? Prisma.empty
        : Prisma.sql`AND allocation_entity_id = ${productId}`;

    const rows = await prisma.$queryRaw<VRow[]>(Prisma.sql`
      SELECT
        year,
        month,
        cost_type,
        allocation_entity_id,
        product_name,
        eotp,
        division,
        sub_division,
        team,
        owner,
        amount_eur,
        hours,
        import_warning
      FROM v_realized_costs
      WHERE year = ${year}
      ${monthSql}
      ${productSql}
      ORDER BY year, month, cost_type, eotp, product_name
    `);

    const filtered = rows.filter((r) => {
      if (division && r.cost_type !== "INTERNAL" && r.division !== division) return false;
      if (subdivision && r.cost_type !== "INTERNAL" && r.sub_division !== subdivision) return false;
      if (team && r.cost_type !== "INTERNAL" && r.team !== team) return false;
      if (owner && r.cost_type !== "INTERNAL" && r.owner !== owner) return false;
      return true;
    });

    let internal = 0;
    let external = 0;
    let direct = 0;
    for (const r of filtered) {
      const amt = Number(r.amount_eur ?? 0);
      if (!Number.isFinite(amt)) continue;
      if (r.cost_type === "INTERNAL") internal += amt;
      else if (r.cost_type === "DIRECT_COST") direct += amt;
      else external += amt;
    }

    return NextResponse.json({
      totals: {
        internal,
        external,
        direct,
        grand: internal + external + direct,
      },
      rows: filtered.map((r) => ({
        year: r.year,
        month: r.month,
        costType: r.cost_type,
        allocationEntityId: r.allocation_entity_id,
        productName: r.product_name,
        eotp: r.eotp,
        division: r.division,
        subdivision: r.sub_division,
        team: r.team,
        owner: r.owner,
        amountEur: Number(r.amount_eur ?? 0),
        hours: r.hours == null ? null : Number(r.hours),
        importWarning: r.import_warning,
      })),
    });
  } catch (err) {
    console.error("[GET /api/reports/realized-costs]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
