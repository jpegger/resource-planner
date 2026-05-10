/** First three slash segments, e.g. `7/D/0056/001.02.02` → `7/D/0056`. */
export function extractEotpRoot(fullPath: string | null | undefined): string | null {
  if (!fullPath) return null;
  const cleaned = fullPath.replace(/[, ]+$/g, "").trim();
  if (!cleaned) return null;
  const parts = cleaned.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const root = parts.slice(0, 3).join("/");
  return root || null;
}
