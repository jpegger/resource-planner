"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  name: string;
  productFamily: string | null;
  division: string | null;
  team: string | null;
  sapEotpCode: string | null;
  sapEotpName: string | null;
};

type BudgetRow = {
  product_id: string;
  product_name: string;
  product_family: string | null;
  total_internal: number;
  total_external: number;
  total_direct: number;
};

const formatK = (n: number) => {
  if (n === 0) return "—";
  return "\u00a0" + Math.round(n / 1000) + "k";
};

export default function InvestmentsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [budgetById, setBudgetById] = useState<Map<string, BudgetRow>>(new Map());
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prodsRes = await fetch("/api/allocation-entities");
        if (!prodsRes.ok) {
          const raw = await prodsRes.text().catch(() => "");
          let detail = raw.trim();
          try {
            const j = JSON.parse(raw) as { error?: string };
            if (typeof j?.error === "string") detail = j.error;
          } catch {
            /* use raw */
          }
          if (!cancelled) {
            setLoadError(
              `Could not load investments (HTTP ${prodsRes.status}).` +
                (detail && detail.length < 800 ? ` ${detail}` : "") +
                " Check the terminal running next dev and that DATABASE_URL points at a migrated database with data (e.g. npm run db:seed:products)."
            );
            setRows([]);
            setBudgetById(new Map());
          }
          return;
        }

        const prodsJson = await prodsRes.json();
        const prods: Row[] = Array.isArray(prodsJson) ? prodsJson : [];

        let budget: BudgetRow[] = [];
        try {
          const budgetRes = await fetch("/api/allocation-entities/with-budget");
          if (budgetRes.ok) {
            const j = await budgetRes.json();
            budget = Array.isArray(j) ? j : [];
          }
        } catch {
          /* budget is optional for listing */
        }

        if (cancelled) return;
        setLoadError(null);
        setRows(prods);
        const m = new Map<string, BudgetRow>();
        for (const b of budget) m.set(b.product_id, b);
        setBudgetById(m);
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof Error
              ? e.message
              : "Network error loading investments. Is the dev server running?"
          );
          setRows([]);
          setBudgetById(new Map());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const families = useMemo(() => {
    const s = new Set<string>();
    for (const p of rows) {
      if (p.productFamily?.trim()) s.add(p.productFamily.trim());
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.productFamily ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search]);

  const familyFiltered = useMemo(() => {
    if (!familyFilter) return filtered;
    return filtered.filter((p) => (p.productFamily ?? "") === familyFilter);
  }, [filtered, familyFilter]);

  return (
    <div className="p-6" style={{ backgroundColor: "var(--page-background)" }}>
      <h1 className="text-foreground mb-4 text-lg font-semibold">Investments</h1>
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          className="border-input bg-background text-foreground placeholder:text-muted-foreground min-w-[200px] flex-1 rounded-md border px-3 py-2 text-sm"
          placeholder="Search investments…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="border-input bg-background text-foreground rounded-md border px-3 py-2 text-sm"
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value)}
        >
          <option value="">All families</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : loadError ? (
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
              {familyFiltered.map((p) => {
                const b = budgetById.get(p.id);
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
                      {b ? `€${formatK(b.total_internal)}` : "—"}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 text-right text-xs">
                      {b ? `€${formatK(b.total_external)}` : "—"}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 text-right text-xs">
                      {b ? `€${formatK(b.total_direct)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !loadError && rows.length === 0 ? (
        <p className="text-muted-foreground mt-4 max-w-2xl text-sm">
          No allocation entities in this database. Import the catalog with{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">npm run db:seed:products</code>{" "}
          (needs <code className="bg-muted rounded px-1 py-0.5 text-xs">scripts/data-prod/PRODUCTS.csv</code>
          ). Use the same <code className="bg-muted rounded px-1 py-0.5 text-xs">DATABASE_URL</code> as{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">next dev</code>.
        </p>
      ) : null}
      {!loading && !loadError && rows.length > 0 && familyFiltered.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">No investments match your filters.</p>
      ) : null}
    </div>
  );
}
