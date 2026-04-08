/**
 * Exception routing must not target the product’s main SAP EOTP (same rule as v_eotp_costs).
 */

export const EOTP_ROUTING_MAIN_TARGET_ERROR =
  "Routing cannot target the product’s main SAP EOTP code — that amount is the computed remainder. Use other EOTP codes only.";

/** True when target EOTP equals the product main SAP code (trimmed, case-insensitive). */
export function eotpTargetsProductMain(
  targetEotp: string,
  mainSapEotp: string | null | undefined
): boolean {
  const t = targetEotp.trim();
  const m = mainSapEotp?.trim();
  if (!t || !m) return false;
  return t.toLowerCase() === m.toLowerCase();
}
