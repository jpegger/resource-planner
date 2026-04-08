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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; routingId: string }> }
) {
  const { id: productId, routingId } = await context.params;
  if (!productId?.trim() || !routingId?.trim()) {
    return Response.json({ error: "Missing product or routing id" }, { status: 400 });
  }

  const body = (await request.json()) as Record<string, unknown>;

  const data: {
    eotp?: string;
    eopLabel?: string | null;
    internalAmount?: number;
    externalAmount?: number;
    directAmount?: number;
    comment?: string | null;
  } = {};
  if (typeof body["eotp"] === "string") data.eotp = body["eotp"].trim();
  if (body["eopLabel"] === null || typeof body["eopLabel"] === "string") {
    data.eopLabel = body["eopLabel"] === null ? null : String(body["eopLabel"]);
  }
  const ia = parseAmount(body["internalAmount"]);
  const ea = parseAmount(body["externalAmount"]);
  const da = parseAmount(body["directAmount"]);
  if (ia !== null) data.internalAmount = ia;
  if (ea !== null) data.externalAmount = ea;
  if (da !== null) data.directAmount = da;
  if (body["comment"] === null || typeof body["comment"] === "string") {
    data.comment = body["comment"] === null ? null : String(body["comment"]);
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  const existing = await prisma.eotpRouting.findFirst({
    where: { id: routingId.trim(), productId: productId.trim() },
  });
  if (!existing) {
    return Response.json({ error: "Routing row not found" }, { status: 404 });
  }

  const product = await prisma.product.findUnique({
    where: { id: productId.trim() },
    select: { sapEotpCode: true },
  });
  if (!product) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }

  const nextEotp = data.eotp !== undefined ? data.eotp : existing.eotp;
  if (eotpTargetsProductMain(nextEotp, product.sapEotpCode)) {
    return Response.json({ error: EOTP_ROUTING_MAIN_TARGET_ERROR }, { status: 400 });
  }

  try {
    const routing = await prisma.eotpRouting.update({
      where: { id: routingId.trim() },
      data,
    });

    return Response.json(routing);
  } catch (e) {
    const resolved = resolveEotpRoutingDbError(e);
    if (resolved) {
      console.warn("[PATCH /api/products/.../eotp-routing/...] schema:", e);
      return resolved;
    }
    console.error("[PATCH /api/products/.../eotp-routing/...]", e);
    return Response.json({ error: "Internal error updating EOTP routing" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; routingId: string }> }
) {
  const { routingId } = await context.params;
  if (!routingId?.trim()) {
    return Response.json({ error: "Missing routing id" }, { status: 400 });
  }

  try {
    await prisma.eotpRouting.delete({ where: { id: routingId.trim() } });
    return Response.json({ deleted: true });
  } catch (e) {
    const resolved = resolveEotpRoutingDbError(e);
    if (resolved) {
      console.warn("[DELETE /api/products/.../eotp-routing/...] schema:", e);
      return resolved;
    }
    console.error("[DELETE /api/products/.../eotp-routing/...]", e);
    return Response.json({ error: "Internal error deleting EOTP routing" }, { status: 500 });
  }
}
