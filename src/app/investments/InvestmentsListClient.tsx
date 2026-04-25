"use client";

import { useRouter } from "next/navigation";

import { useInvestmentTableFilters } from "@/app/investments/use-investment-table-filters";
import type { InvestmentsListRow } from "@/lib/investments-list";

const formatK = (n: number) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  return "\u00a0" + Math.round(v / 1000) + "k";
};

export function InvestmentsListClient({
  rows,
  loadError,
}: {
  rows: InvestmentsListRow[];
  loadError: string | null;
}) {
  const router = useRouter();
  const {
    search,
    setSearch,
    familyFilter,
    setFamilyFilter,
    divisionFilter,
    setDivisionFilter,
    teamFilter,
    setTeamFilter,
    filterOptions,
    visibleRows,
  } = useInvestmentTableFilters(rows);

  return (
    <div className="p-6" style={{ backgroundColor: "var(--page-background)" }}>
      <h1 className="text-foreground mb-4 text-lg font-semibold">Investments</h1>
      <div className="mb-4 flex flex-wrap items-center justify-start gap-3">
        <input
          className="border-input bg-background text-foreground placeholder:text-muted-foreground h-9 w-[200px] max-w-full shrink-0 rounded-md border px-3 text-sm"
          placeholder="Search investments…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="border-input bg-background text-foreground h-9 w-[200px] max-w-full shrink-0 rounded-md border px-3 text-sm"
          value={divisionFilter}
          onChange={(e) => setDivisionFilter(e.target.value)}
          aria-label="Filter by division"
        >
          <option value="">All divisions</option>
          {filterOptions.divisions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          className="border-input bg-background text-foreground h-9 w-[200px] max-w-full shrink-0 rounded-md border px-3 text-sm"
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          aria-label="Filter by team"
        >
          <option value="">All teams</option>
          {filterOptions.teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          className="border-input bg-background text-foreground h-9 w-[200px] max-w-full shrink-0 rounded-md border px-3 text-sm"
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value)}
          aria-label="Filter by family"
        >
          <option value="">All families</option>
          {filterOptions.families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      {loadError ? (
        <p className="text-destructive max-w-2xl text-sm whitespace-pre-wrap">{loadError}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Family</th>
                <th className="px-3 py-2 text-left font-medium">Division</th>
                <th className="px-3 py-2 text-left font-medium">Team</th>
                <th className="px-3 py-2 text-left font-medium">SAP EOTP</th>
                <th className="px-3 py-2 text-right font-medium">INT</th>
                <th className="px-3 py-2 text-right font-medium">EXT</th>
                <th className="px-3 py-2 text-right font-medium">DIR</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((p) => {
                const sap =
                  [p.sapEotpCode, p.sapEotpName].filter(Boolean).join(" — ") || "—";
                return (
                  <tr
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/investments/${encodeURIComponent(p.id)}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        router.push(`/investments/${encodeURIComponent(p.id)}`);
                    }}
                    className="hover:bg-muted/50 border-b border-border cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 font-medium">{p.name}</td>
                    <td className="text-muted-foreground px-3 py-2.5">{p.productFamily ?? "—"}</td>
                    <td className="text-muted-foreground px-3 py-2.5">{p.division ?? "—"}</td>
                    <td className="text-muted-foreground px-3 py-2.5">{p.team ?? "—"}</td>
                    <td className="text-muted-foreground max-w-[220px] truncate px-3 py-2.5 text-xs" title={sap}>
                      {sap}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 text-right text-xs">
                      €{formatK(p.costTotals?.totalInternal ?? 0)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 text-right text-xs">
                      €{formatK(p.costTotals?.totalExternal ?? 0)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 text-right text-xs">
                      €{formatK(p.costTotals?.totalDirect ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loadError && rows.length === 0 ? (
        <p className="text-muted-foreground mt-4 max-w-2xl text-sm">
          No allocation entities in this database. Import the catalog with{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">npm run db:seed:products</code>{" "}
          (needs <code className="bg-muted rounded px-1 py-0.5 text-xs">scripts/datasets/dev/PRODUCTS.csv</code>
          ). Use the same <code className="bg-muted rounded px-1 py-0.5 text-xs">DATABASE_URL</code> as{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">next dev</code>.
        </p>
      ) : null}
      {!loadError && rows.length > 0 && visibleRows.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">No investments match your filters.</p>
      ) : null}
    </div>
  );
}
