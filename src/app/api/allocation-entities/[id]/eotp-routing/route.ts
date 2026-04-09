import { type NextRequest } from "next/server";

import { resolveEotpRoutingDbError } from "@/lib/eotp-routing-errors";
import {
  EOTP_ROUTING_MAIN_TARGET_ERROR,
  eotpTargetsProductMain,
} from "@/lib/eotp-routing-validation";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: productId } = await context.params;
  if (!productId?.trim()) {
    return Response.json({ error: "Missing product id" }, { status: 400 });
  }

  const yearParam = request.nextUrl.searchParams.get("year");
  let yearFilter: number | null = null;
  if (yearParam !== null && yearParam !== "") {
    const y = Number.parseInt(yearParam, 10);
    if (!Number.isNaN(y)) yearFilter = y;
  }

  try {
    const routings = await prisma.eotpRouting.findMany({
      where: {
        allocationEntityId: productId.trim(),
        ...(yearFilter === null ? {} : { year: yearFilter }),
      },
      orderBy: [{ year: "asc" }, { eotp: "asc" }],
    });

    return Response.json(routings);
  } catch (e) {
    const resolved = resolveEotpRoutingDbError(e);
    if (resolved) {
      console.warn("[GET /api/allocation-entities/.../eotp-routing] schema:", e);
      return resolved;
    }
    console.error("[GET /api/allocation-entities/.../eotp-routing]", e);
    return Response.json({ error: "Internal error loading EOTP routing" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: productId } = await context.params;
  if (!productId?.trim()) {
    return Response.json({ error: "Missing product id" }, { status: 400 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const year = Number(body["year"]);
  const eotp = typeof body["eotp"] === "string" ? body["eotp"].trim() : "";
  const internalAmount = parseAmount(body["internalAmount"]) ?? 0;
  const externalAmount = parseAmount(body["externalAmount"]) ?? 0;
  const directAmount = parseAmount(body["directAmount"]) ?? 0;

  if (!Number.isFinite(year) || !eotp) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const entity = await prisma.allocationEntity.findUnique({
    where: { id: productId.trim() },
    select: { sapEotpCode: true },
  });
  if (!entity) {
    return Response.json({ error: "Allocation entity not found" }, { status: 404 });
  }
  if (eotpTargetsProductMain(eotp, entity.sapEotpCode)) {
    return Response.json({ error: EOTP_ROUTING_MAIN_TARGET_ERROR }, { status: 400 });
  }

  try {
    const routing = await prisma.eotpRouting.create({
      data: {
        allocationEntityId: productId.trim(),
        year,
        eotp,
        eopLabel:
          body["eopLabel"] === null || typeof body["eopLabel"] === "string"
            ? (body["eopLabel"] as string | null)
            : null,
        internalAmount,
        externalAmount,
        directAmount,
        comment:
          body["comment"] === null || typeof body["comment"] === "string"
            ? (body["comment"] as string | null)
            : null,
      },
    });

    return Response.json(routing, { status: 201 });
  } catch (e) {
    const resolved = resolveEotpRoutingDbError(e);
    if (resolved) {
      console.warn("[POST /api/allocation-entities/.../eotp-routing] schema:", e);
      return resolved;
    }
    console.error("[POST /api/allocation-entities/.../eotp-routing]", e);
    return Response.json({ error: "Internal error creating EOTP routing" }, { status: 500 });
  }
}
