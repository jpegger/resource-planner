/**
 * Display name for resources: Prénom + Nom (given name first), non-empty parts joined by a single space.
 * Matches RESSOURCES.csv import: "Full Name" is derived from Prénom and Nom, not stored independently.
 */
export function resourceFullNameFromParts(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string {
  const parts = [firstName?.trim(), lastName?.trim()].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  return parts.join(" ");
}
