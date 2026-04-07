"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Product = {
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

export default function ProductsTestPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [budgetById, setBudgetById] = useState<Map<string, BudgetRow>>(new Map());
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prodsRes = await fetch("/api/products");
        const prodsJson = prodsRes.ok ? await prodsRes.json() : [];
        const prods: Product[] = Array.isArray(prodsJson) ? prodsJson : [];

        let budget: BudgetRow[] = [];
        try {
          const budgetRes = await fetch("/api/test/products-with-budget");
          if (budgetRes.ok) {
            const j = await budgetRes.json();
            budget = Array.isArray(j) ? j : [];
          }
        } catch {
          /* budget is optional for listing */
        }

        if (cancelled) return;
        setProducts(prods);
        const m = new Map<string, BudgetRow>();
        for (const b of budget) m.set(b.product_id, b);
        setBudgetById(m);
      } catch {
        if (!cancelled) {
          setProducts([]);
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
    for (const p of products) {
      if (p.productFamily?.trim()) s.add(p.productFamily.trim());
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.productFamily ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, search]);

  const familyFiltered = useMemo(() => {
    if (!familyFilter) return filtered;
    return filtered.filter((p) => (p.productFamily ?? "") === familyFilter);
  }, [filtered, familyFilter]);

  return (
    <div className="p-6" style={{ backgroundColor: "var(--page-background)" }}>
      <h1 className="text-foreground mb-4 text-lg font-semibold">Products (prototype)</h1>
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          className="border-input bg-background text-foreground placeholder:text-muted-foreground min-w-[200px] flex-1 rounded-md border px-3 py-2 text-sm"
          placeholder="Search products…"
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
                    onClick={() => router.push(`/test/products/${encodeURIComponent(p.id)}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        router.push(`/test/products/${encodeURIComponent(p.id)}`);
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
      {!loading && familyFiltered.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">No products match.</p>
      ) : null}
    </div>
  );
}
