import { NextResponse } from "next/server";
import { z } from "zod";

import { querySnapshotRollup, querySnapshots } from "@/lib/reports/snapshot-report";

export const runtime = "nodejs";

const levelSchema = z.enum(["division", "team", "product", "eotp"]);

const querySchema = z.object({
  snapshotId: z.string().trim().min(1).optional(),
  level: levelSchema.default("division"),
  division: z.string().trim().min(1).optional(),
  team: z.string().trim().min(1).optional(),
  productName: z.string().trim().min(1).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      snapshotId: searchParams.get("snapshotId") ?? undefined,
      level: searchParams.get("level") ?? undefined,
      division: searchParams.get("division") ?? undefined,
      team: searchParams.get("team") ?? undefined,
      productName: searchParams.get("productName") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const snapshots = await querySnapshots();
    const snapshotId = parsed.data.snapshotId;
    if (!snapshotId) {
      return NextResponse.json({ snapshots }, { status: 200 });
    }

    const rows = await querySnapshotRollup({
      snapshotId,
      level: parsed.data.level,
      division: parsed.data.division ?? null,
      team: parsed.data.team ?? null,
      productName: parsed.data.productName ?? null,
    });

    return NextResponse.json(
      {
        snapshots,
        snapshotId,
        rows,
        meta: {
          level: parsed.data.level,
          division: parsed.data.division ?? null,
          team: parsed.data.team ?? null,
          productName: parsed.data.productName ?? null,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/reports/snapshot]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

