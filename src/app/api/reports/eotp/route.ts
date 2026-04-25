import { NextResponse } from "next/server";
import { z } from "zod";

import {
  queryEotpProducts,
  queryEotpRowsForProduct,
  queryInitiativeCostsForProduct,
  queryRoutingRows,
} from "@/lib/reports/eotp-report";

export const runtime = "nodejs";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  productId: z.string().trim().min(1).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: searchParams.get("year"),
      productId: searchParams.get("productId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const { year, productId } = parsed.data;

    const products = await queryEotpProducts(year);
    if (!productId) {
      return NextResponse.json({ products }, { status: 200 });
    }

    const [eotpRows, routingRows, initiatives] = await Promise.all([
      queryEotpRowsForProduct(year, productId),
      queryRoutingRows(year, productId),
      queryInitiativeCostsForProduct(year, productId),
    ]);

    return NextResponse.json(
      { products, productId, eotpRows, routingRows, initiatives },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/reports/eotp]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

