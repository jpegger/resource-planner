import type { NextRequest } from "next/server";

const FALLBACK_EMAIL = "planner@local";

/** Identity for audit fields — prefer reverse-proxy header when auth is added. */
export function getUserFromRequest(request: NextRequest): { email: string } {
  const raw = request.headers.get("x-auth-request-email");
  const email = raw?.trim() || FALLBACK_EMAIL;
  return { email };
}
