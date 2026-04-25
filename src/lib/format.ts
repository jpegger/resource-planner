export function formatK(eur: number): string {
  const v = Number(eur);
  if (!Number.isFinite(v)) return "—";
  return `€ ${(v / 1000).toFixed(1)}k`;
}

