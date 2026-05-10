import { NextResponse } from "next/server";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const querySchema = z.object({
  year: z.coerce.number().int().min(1990).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
  productId: z.string().trim().min(1).optional(),
});

type PlannedRow = {
  year: number;
  allocation_entity_id: string | null;
  product_name: string | null;
  eotp: string | null;
  activity_sector: string | null;
  sf_product_name: string | null;
  client_name: string | null;
  amount_eur: unknown;
  line_count: unknown;
};

type RealizedRow = {
  year: number;
  month: number;
  allocation_entity_id: string | null;
  product_name: string | null;
  eotp: string | null;
  sap_article_code: string | null;
  product_label: string | null;
  client_name: string | null;
  amount_eur: unknown;
  invoice_count: unknown;
};

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: searchParams.get("year"),
      month: searchParams.get("month") ?? undefined,
      productId: searchParams.get("productId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }
    const { year, month, productId } = parsed.data;

    const productSql =
      productId === undefined
        ? Prisma.empty
        : Prisma.sql`AND allocation_entity_id = ${productId}`;

    const planned = await prisma.$queryRaw<PlannedRow[]>(Prisma.sql`
      SELECT * FROM v_planned_revenue WHERE year = ${year} ${productSql}
    `);

    const monthSql =
      month === undefined ? Prisma.empty : Prisma.sql`AND month = ${month}`;
    const realized = await prisma.$queryRaw<RealizedRow[]>(Prisma.sql`
      SELECT * FROM v_realized_revenue WHERE year = ${year} ${monthSql} ${productSql}
    `);

    const plannedTotal = planned.reduce((a, r) => a + Number(r.amount_eur ?? 0), 0);
    const realizedTotal = realized.reduce((a, r) => a + Number(r.amount_eur ?? 0), 0);
    const gap = plannedTotal - realizedTotal;
    const coveragePct = plannedTotal > 0 ? (realizedTotal / plannedTotal) * 100 : null;

    return NextResponse.json({
      summary: {
        plannedTotal,
        realizedTotal,
        gap,
        coveragePct,
      },
      planned: planned.map((r) => ({
        year: r.year,
        allocationEntityId: r.allocation_entity_id,
        productName: r.product_name,
        eotp: r.eotp,
        activitySector: r.activity_sector,
        sfProductName: r.sf_product_name,
        clientName: r.client_name,
        amountEur: Number(r.amount_eur ?? 0),
        lineCount: Number(r.line_count ?? 0),
      })),
      realized: realized.map((r) => ({
        year: r.year,
        month: r.month,
        allocationEntityId: r.allocation_entity_id,
        productName: r.product_name,
        eotp: r.eotp,
        sapArticleCode: r.sap_article_code,
        productLabel: r.product_label,
        clientName: r.client_name,
        amountEur: Number(r.amount_eur ?? 0),
        invoiceCount: Number(r.invoice_count ?? 0),
      })),
    });
  } catch (err) {
    console.error("[GET /api/reports/revenue]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
