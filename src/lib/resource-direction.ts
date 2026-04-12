/** Allowed values for Resource.direction (Pôle / direction in the app). */
export const RESOURCE_DIRECTION_VALUES = ["CRPS", "PDS"] as const;
export type ResourceDirectionValue = (typeof RESOURCE_DIRECTION_VALUES)[number];

export function isResourceDirection(s: string): s is ResourceDirectionValue {
  return (RESOURCE_DIRECTION_VALUES as readonly string[]).includes(s);
}

/**
 * PATCH body: `null` / missing clears; empty string clears; CRPS/PDS accepted.
 * Returns `undefined` if the value is not allowed (caller should respond 400).
 */
export function parseResourceDirectionBody(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  if (isResourceDirection(t)) return t;
  return undefined;
}
