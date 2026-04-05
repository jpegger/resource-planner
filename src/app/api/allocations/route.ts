import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const initiativeId = new URL(request.url).searchParams.get("initiativeId");
  if (!initiativeId) {
    return Response.json({ error: "initiativeId query parameter is required" }, { status: 400 });
  }

  const rows = await prisma.allocation.findMany({
    where: { initiativeId },
    include: { resource: { select: { id: true, fullName: true } } },
    orderBy: { id: "asc" },
  });

  return Response.json(rows);
}

export async function POST(request: Request) {
  let body: { initiativeId?: string; resourceId?: string };
  try {
    body = (await request.json()) as { initiativeId?: string; resourceId?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const initiativeId = body.initiativeId?.trim();
  if (!initiativeId) {
    return Response.json({ error: "initiativeId is required" }, { status: 400 });
  }

  const initiative = await prisma.initiative.findUnique({
    where: { id: initiativeId },
    select: { id: true },
  });
  if (!initiative) {
    return Response.json({ error: "Initiative not found" }, { status: 404 });
  }

  let resourceId = body.resourceId?.trim();
  if (!resourceId) {
    const first = await prisma.resource.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
    if (!first) {
      return Response.json({ error: "No resources exist — seed the database first" }, { status: 400 });
    }
    resourceId = first.id;
  } else {
    const res = await prisma.resource.findUnique({ where: { id: resourceId }, select: { id: true } });
    if (!res) {
      return Response.json({ error: "Resource not found" }, { status: 404 });
    }
  }

  const id = `ASS-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date();

  const allocation = await prisma.allocation.create({
    data: {
      id,
      initiativeId,
      resourceId,
      quantity: 0,
      manDays: null,
      createdOn: now,
      modifiedOn: now,
    },
    include: { resource: { select: { id: true, fullName: true } } },
  });

  return Response.json(allocation, { status: 201 });
}
