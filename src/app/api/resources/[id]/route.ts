import { prisma } from "@/lib/prisma";
import { parseResourceDirectionBody } from "@/lib/resource-direction";
import { resourceFullNameFromParts } from "@/lib/resource-display-name";
import type { ResourceType } from "@/generated/prisma/client";

export const runtime = "nodejs";

const RESOURCE_TYPES: ResourceType[] = ["INTERNAL", "EXTERNAL", "DIRECT_COST"];

function isResourceType(v: unknown): v is ResourceType {
  return typeof v === "string" && (RESOURCE_TYPES as string[]).includes(v);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const hasUpdate =
    "fullName" in body ||
    "firstName" in body ||
    "lastName" in body ||
    "function" in body ||
    "cellule" in body ||
    "direction" in body ||
    "type" in body;
  if (!hasUpdate) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const data: {
    modifiedOn: Date;
    fullName?: string;
    firstName?: string | null;
    lastName?: string | null;
    function?: string | null;
    cellule?: string | null;
    direction?: string | null;
    type?: ResourceType;
  } = { modifiedOn: new Date() };

  if ("function" in body) {
    const v = body.function;
    data.function = v === null || v === undefined ? null : String(v).trim() || null;
  }
  if ("cellule" in body) {
    const v = body.cellule;
    data.cellule = v === null || v === undefined ? null : String(v).trim() || null;
  }
  if ("direction" in body) {
    const parsed = parseResourceDirectionBody(body.direction);
    if (parsed === undefined) {
      return Response.json(
        { error: 'direction must be "CRPS", "PDS", or null' },
        { status: 400 }
      );
    }
    data.direction = parsed;
  }
  if ("type" in body) {
    if (!isResourceType(body.type)) {
      return Response.json({ error: "type must be INTERNAL, EXTERNAL, or DIRECT_COST" }, { status: 400 });
    }
    data.type = body.type;
  }

  const nameInBody = "firstName" in body || "lastName" in body;
  if (nameInBody) {
    const existing = await prisma.resource.findUnique({
      where: { id },
      select: { firstName: true, lastName: true },
    });
    if (!existing) {
      return Response.json({ error: "Resource not found" }, { status: 404 });
    }
    if ("firstName" in body) {
      const v = body.firstName;
      data.firstName = v === null || v === undefined ? null : String(v).trim() || null;
    }
    if ("lastName" in body) {
      const v = body.lastName;
      data.lastName = v === null || v === undefined ? null : String(v).trim() || null;
    }
    const mergedFn = "firstName" in body ? data.firstName : existing.firstName;
    const mergedLn = "lastName" in body ? data.lastName : existing.lastName;
    const computed = resourceFullNameFromParts(mergedFn, mergedLn);
    if (!computed) {
      return Response.json(
        { error: "Display name cannot be empty — set at least first name or last name" },
        { status: 400 }
      );
    }
    data.fullName = computed;
  } else if ("fullName" in body) {
    const v = body.fullName;
    if (typeof v !== "string" || !v.trim()) {
      return Response.json({ error: "fullName must be a non-empty string" }, { status: 400 });
    }
    data.fullName = v.trim();
  }

  try {
    const updated = await prisma.resource.update({
      where: { id },
      data,
      include: { rates: { orderBy: { year: "desc" } } },
    });
    return Response.json(updated);
  } catch {
    return Response.json({ error: "Resource not found" }, { status: 404 });
  }
}
