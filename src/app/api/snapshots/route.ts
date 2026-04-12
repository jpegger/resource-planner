import type { NextRequest } from "next/server";

import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { takeSnapshot } from "@/lib/snapshot";

export const runtime = "nodejs";

export async function GET() {
  const snapshots = await prisma.allocationSnapshot.findMany({
    orderBy: { takenAt: "desc" },
    include: { _count: { select: { rows: true } } },
  });
  return Response.json(snapshots);
}

export async function POST(request: NextRequest) {
  let body: { name?: unknown; year?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; year?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const year = typeof body.year === "number" ? body.year : Number(body.year);

  if (!name || !Number.isFinite(year)) {
    return Response.json({ error: "name and year are required" }, { status: 400 });
  }

  const { email } = getUserFromRequest(request);
  const result = await takeSnapshot(name, Math.trunc(year), email);
  return Response.json(result, { status: 201 });
}
