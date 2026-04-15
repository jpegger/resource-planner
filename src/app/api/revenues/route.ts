import { RevenueType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveInitiativeForApi } from "@/lib/resolve-initiative-for-api";

export const runtime = "nodejs";

const REVENUE_TYPES = new Set<string>(Object.values(RevenueType));

/** GET ?initiativeId= — all revenue rows for the initiative (RI-xxx PK). */
export async function GET(request: Request) {
  const initiativeId = new URL(request.url).searchParams.get("initiativeId");
  if (!initiativeId?.trim()) {
    return Response.json({ error: "initiativeId query parameter is required" }, { status: 400 });
  }

  const initiative = await resolveInitiativeForApi(initiativeId);
  if (!initiative) {
    return Response.json({ error: "Initiative not found" }, { status: 404 });
  }

  const revenues = await prisma.initiativeRevenue.findMany({
    where: { initiativeId: initiative.id },
    orderBy: [{ type: "asc" }, { createdOn: "asc" }],
  });

  return Response.json(revenues);
}

type PostBody = {
  initiativeId?: string;
  type?: string;
  amount?: number;
  comment?: string | null;
};

/** POST — create one revenue line. */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const initiative = await resolveInitiativeForApi(body.initiativeId ?? "");
  if (!initiative) {
    return Response.json({ error: "Initiative not found" }, { status: 404 });
  }

  const typeStr = body.type?.trim() ?? "Mission";
  if (!REVENUE_TYPES.has(typeStr)) {
    return Response.json({ error: "type must be Mission or Subscription" }, { status: 400 });
  }

  const amount =
    body.amount === null || body.amount === undefined ? 0 : Number(body.amount);
  if (Number.isNaN(amount)) {
    return Response.json({ error: "amount must be a number" }, { status: 400 });
  }

  const comment =
    body.comment === undefined ? null : body.comment === null ? null : String(body.comment);

  const revenue = await prisma.initiativeRevenue.create({
    data: {
      initiativeId: initiative.id,
      type: typeStr as RevenueType,
      amount,
      comment,
    },
  });

  return Response.json(revenue, { status: 201 });
}
