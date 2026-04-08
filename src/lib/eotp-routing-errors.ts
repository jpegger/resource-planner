import { Prisma } from "@/generated/prisma/client";

/** P2021: table missing — narrow to eotp_routing. */
function isEotpRoutingTableMissing(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2021") {
    return false;
  }
  const meta = e.meta as { modelName?: string; table?: string } | undefined;
  if (meta?.modelName === "EotpRouting") return true;
  if (String(meta?.table ?? "").toLowerCase().includes("eotp_routing")) return true;
  return /eotp_routing/i.test(e.message);
}

function isEotpRoutingColumnMismatch(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2022";
}

/**
 * Map Prisma schema errors to 503 + JSON. Returns null if the error should be handled as generic 500.
 */
export function resolveEotpRoutingDbError(e: unknown): Response | null {
  if (isEotpRoutingColumnMismatch(e)) {
    const meta = e.meta as { column?: string } | undefined;
    const col = meta?.column ?? "";
    return Response.json(
      {
        code: "EOTP_ROUTING_SCHEMA_MISMATCH",
        message: `The eotp_routing table is out of date (column ${col || "…"} missing). Run: npx prisma migrate deploy on the database this app uses, then npx prisma generate and restart the dev server.`,
      },
      { status: 503 }
    );
  }
  if (isEotpRoutingTableMissing(e)) {
    return Response.json(
      {
        code: "EOTP_ROUTING_SCHEMA_MISSING",
        message:
          "The eotp_routing table is missing. Run: npx prisma migrate deploy (same DATABASE_URL as this app). Then optionally: npm run db:seed:routing. If migrate reports nothing pending but this persists, your app may be using a different DATABASE_URL than the terminal where you ran migrate.",
      },
      { status: 503 }
    );
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/eotp_routing/i.test(msg) && /does not exist|n'existe pas/i.test(msg)) {
    return Response.json(
      {
        code: "EOTP_ROUTING_SCHEMA_MISSING",
        message:
          "The eotp_routing relation is missing. Run: npx prisma migrate deploy on the database this app uses (check .env DATABASE_URL).",
      },
      { status: 503 }
    );
  }
  return null;
}
