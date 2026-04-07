"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ResourceType = "INTERNAL" | "EXTERNAL" | "DIRECT_COST";

type ResourceOption = { id: string; fullName: string; type: ResourceType };

type Product = {
  id: string;
  name: string;
  productFamily: string | null;
  division: string | null;
  subDivision: string | null;
  team: string | null;
  sapEotpCode: string | null;
  sapEotpName: string | null;
  attractiveness: number | null;
  competitiveness: number | null;
};

type BudgetInitiative = {
  jira_key: string;
  summary: string;
  status: string;
  initiative_year: number;
  internal_cost: number;
  external_cost: number;
  direct_cost: number;
  total_cost: number;
};

type AllocationDTO = {
  id: string;
  initiativeId: string;
  resourceId: string;
  quantity: number | null;
  manDays: number | null;
  resource: ResourceOption;
};

type AllocationCostBreakdown = {
  internal: number;
  external: number;
  direct: number;
  total: number;
};

const formatK = (n: number) => {
  if (n === 0) return "—";
  return "€\u00a0" + Math.round(n / 1000) + "k";
};

/** Shared fixed columns (~20% narrower than 4.25/3.5rem) so amounts align across rows. */
const FINANCIALS_4COL =
  "grid grid-cols-[3.4rem_3.4rem_3.4rem_2.8rem] items-baseline justify-items-end gap-x-2 text-xs tabular-nums sm:gap-x-3";

/** Bold figures in a soft grey–blue pill (budget header, assignment costs, footer). */
const FINANCIALS_PILL =
  "rounded-lg border border-[color:var(--primary-blue)]/20 bg-[color:var(--primary-blue)]/[0.06] px-2.5 py-1.5 font-bold text-foreground shadow-sm dark:border-[color:var(--primary-blue)]/30 dark:bg-[color:var(--primary-blue)]/[0.12]";

const RESOURCE_GROUP_ORDER = ["INTERNAL", "EXTERNAL", "DIRECT_COST"] as const;
type ResourceGroupKey = (typeof RESOURCE_GROUP_ORDER)[number];

const RESOURCE_GROUP_LABEL: Record<ResourceGroupKey, string> = {
  INTERNAL: "Internal",
  EXTERNAL: "External",
  DIRECT_COST: "Direct",
};

function groupAllocationsByResourceType(allocations: AllocationDTO[]) {
  const buckets: Record<ResourceGroupKey, AllocationDTO[]> = {
    INTERNAL: [],
    EXTERNAL: [],
    DIRECT_COST: [],
  };
  for (const a of allocations) {
    const t = a.resource.type;
    const key: ResourceGroupKey =
      t === "EXTERNAL" || t === "DIRECT_COST" ? t : "INTERNAL";
    buckets[key].push(a);
  }
  return RESOURCE_GROUP_ORDER.map((key) => ({
    key,
    label: RESOURCE_GROUP_LABEL[key],
    rows: buckets[key],
  }));
}

/** Cost amount for the allocation’s resource type (single column in assignment grid). */
function costAmountForResourceType(
  type: ResourceType,
  c: AllocationCostBreakdown | undefined
): number | undefined {
  if (!c) return undefined;
  switch (type) {
    case "INTERNAL":
      return c.internal;
    case "EXTERNAL":
      return c.external;
    case "DIRECT_COST":
      return c.direct;
    default:
      return c.total;
  }
}

function statusClass(status: string): string {
  const u = status.toLowerCase();
  if (u.includes("done") || u.includes("closed") || u.includes("resolved")) {
    return "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100";
  }
  if (u.includes("progress")) {
    return "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100";
  }
  return "bg-muted text-muted-foreground";
}

async function patchAllocation(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/allocations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return (await res.json()) as AllocationDTO;
}

function ResourceCombobox({
  value,
  resources,
  onSelect,
}: {
  value: string;
  resources: ResourceOption[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return resources;
    const q = search.trim().toLowerCase();
    return resources.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [resources, search]);

  const selected = resources.find((r) => r.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "w-full min-w-[200px] justify-between font-normal"
        )}
        role="combobox"
      >
        <span className="truncate">{selected?.fullName ?? "Select a resource"}</span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search resource..." value={search} onValueChange={setSearch} />
          <CommandList>
            {filtered.length === 0 ? (
              <CommandEmpty>No resource found.</CommandEmpty>
            ) : (
              filtered.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.id}
                  onSelect={() => {
                    onSelect(r.id);
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 size-4", value === r.id ? "opacity-100" : "opacity-0")} />
                  {r.fullName}
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FieldReadonly({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <div className="bg-muted/40 border-input rounded-md border px-2.5 py-1.5 text-sm">{value || "—"}</div>
    </div>
  );
}

function AllocationEditor({
  row,
  resources,
  costBreakdown,
  onPatched,
  onDeleted,
  onCostsStale,
}: {
  row: AllocationDTO;
  resources: ResourceOption[];
  costBreakdown: AllocationCostBreakdown | undefined;
  onPatched: (u: AllocationDTO) => void;
  onDeleted: () => void;
  onCostsStale: () => void;
}) {
  const [qty, setQty] = useState<string>(() =>
    row.quantity === null || row.quantity === undefined ? "" : String(row.quantity)
  );
  const [days, setDays] = useState<string>(() =>
    row.manDays === null || row.manDays === undefined ? "" : String(row.manDays)
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setQty(row.quantity === null || row.quantity === undefined ? "" : String(row.quantity));
    setDays(row.manDays === null || row.manDays === undefined ? "" : String(row.manDays));
  }, [row.id, row.quantity, row.manDays]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const schedulePatch = (patch: Record<string, unknown>) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void (async () => {
        setSaving(true);
        setErr(null);
        try {
          const updated = await patchAllocation(row.id, patch);
          onPatched(updated);
          onCostsStale();
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Save failed");
        } finally {
          setSaving(false);
        }
      })();
    }, 450);
  };

  const typeCost = costAmountForResourceType(row.resource.type, costBreakdown);

  return (
    <TableRow>
      <TableCell className="w-28">
        <Input
          type="number"
          step="0.01"
          min={0}
          className="h-8"
          value={qty}
          onChange={(e) => {
            const v = e.target.value;
            setQty(v);
            const n = v === "" ? null : parseFloat(v);
            if (v !== "" && Number.isNaN(n!)) return;
            schedulePatch({ quantity: n });
          }}
        />
      </TableCell>
      <TableCell className="w-28">
        <Input
          type="number"
          step="0.1"
          min={0}
          className="h-8"
          value={days}
          onChange={(e) => {
            const v = e.target.value;
            setDays(v);
            const n = v === "" ? null : parseFloat(v);
            if (v !== "" && Number.isNaN(n!)) return;
            schedulePatch({ manDays: n });
          }}
        />
      </TableCell>
      <TableCell className="min-w-[200px]">
        <ResourceCombobox
          value={row.resourceId}
          resources={resources}
          onSelect={async (resourceId) => {
            setSaving(true);
            setErr(null);
            try {
              const updated = await patchAllocation(row.id, { resourceId });
              onPatched(updated);
              onCostsStale();
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Save failed");
            } finally {
              setSaving(false);
            }
          }}
        />
      </TableCell>
      <TableCell className="min-w-[7rem] align-top text-right">
        <div
          className={cn(
            FINANCIALS_PILL,
            "inline-flex min-w-[6.5rem] justify-end tabular-nums text-[color:var(--primary-blue)]"
          )}
        >
          {typeCost !== undefined ? formatK(typeCost) : "—"}
        </div>
      </TableCell>
      <TableCell className="w-36 align-top">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {saving ? <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" /> : null}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                setErr(null);
                try {
                  const res = await fetch(`/api/allocations/${encodeURIComponent(row.id)}`, {
                    method: "DELETE",
                  });
                  if (!res.ok) throw new Error("Delete failed");
                  onDeleted();
                  onCostsStale();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Delete failed");
                } finally {
                  setDeleting(false);
                }
              }}
            >
              Delete
            </Button>
          </div>
          {err ? <p className="text-destructive max-w-[140px] text-xs leading-tight">{err}</p> : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ProductDetailTestClient({ productId }: { productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [initiatives, setInitiatives] = useState<BudgetInitiative[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedInitiative, setSelectedInitiative] = useState<BudgetInitiative | null>(null);
  const [allocations, setAllocations] = useState<AllocationDTO[]>([]);
  const [allocLoading, setAllocLoading] = useState(false);
  const [costByAllocId, setCostByAllocId] = useState<Record<string, AllocationCostBreakdown>>({});
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [yearOptions, setYearOptions] = useState<number[]>([]);

  const loadBudget = useCallback(async () => {
    setBudgetLoading(true);
    try {
      const q =
        selectedYear === null
          ? ""
          : `?year=${encodeURIComponent(String(selectedYear))}`;
      const res = await fetch(`/api/test/products/${encodeURIComponent(productId)}/budget${q}`);
      const data = (await res.json()) as BudgetInitiative[];
      const list = Array.isArray(data) ? data : [];
      setInitiatives(list);
      if (selectedYear === null) {
        const ys = [...new Set(list.map((i) => i.initiative_year))].sort((a, b) => b - a);
        setYearOptions(ys);
      }
    } finally {
      setBudgetLoading(false);
    }
  }, [productId, selectedYear]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prodsRes = await fetch(`/api/products/${encodeURIComponent(productId)}`);
        const p = prodsRes.ok ? await prodsRes.json() : null;

        let resList: ResourceOption[] = [];
        try {
          const rRes = await fetch("/api/test/resources");
          if (rRes.ok) {
            const j = await rRes.json();
            resList = Array.isArray(j) ? j : [];
          }
        } catch {
          /* resources optional */
        }

        if (cancelled) return;
        setProduct(p && typeof p === "object" && "id" in p ? (p as Product) : null);
        setResources(resList);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  useEffect(() => {
    void loadBudget();
  }, [loadBudget]);

  useEffect(() => {
    setSelectedInitiative(null);
    setAllocations([]);
    setCostByAllocId({});
  }, [selectedYear]);

  const loadCostsForInitiative = useCallback(async (jiraKey: string) => {
    const res = await fetch(
      `/api/test/initiative-allocation-costs?initiativeId=${encodeURIComponent(jiraKey)}`
    );
    if (!res.ok) {
      setCostByAllocId({});
      return;
    }
    const rows = (await res.json()) as Array<{
      allocation_id: string;
      internal_cost: number;
      external_cost: number;
      direct_cost: number;
      computed_cost: number;
    }>;
    const map: Record<string, AllocationCostBreakdown> = {};
    for (const r of rows) {
      map[r.allocation_id] = {
        internal: r.internal_cost,
        external: r.external_cost,
        direct: r.direct_cost,
        total: r.computed_cost,
      };
    }
    setCostByAllocId(map);
  }, []);

  const handleSelectInitiative = useCallback(
    async (ini: BudgetInitiative) => {
      setSelectedInitiative(ini);
      setAllocLoading(true);
      setAllocations([]);
      setCostByAllocId({});
      try {
        const allocRes = await fetch(
          `/api/allocations?initiativeId=${encodeURIComponent(ini.jira_key)}`
        );
        if (!allocRes.ok) throw new Error("allocations");
        const list = (await allocRes.json()) as AllocationDTO[];
        setAllocations(Array.isArray(list) ? list : []);
        await loadCostsForInitiative(ini.jira_key);
      } catch {
        setAllocations([]);
      } finally {
        setAllocLoading(false);
      }
    },
    [loadCostsForInitiative]
  );

  const refreshCosts = useCallback(() => {
    if (selectedInitiative) void loadCostsForInitiative(selectedInitiative.jira_key);
  }, [selectedInitiative, loadCostsForInitiative]);

  const allocationTotals = useMemo(() => {
    let internal = 0;
    let external = 0;
    let direct = 0;
    let total = 0;
    for (const row of allocations) {
      const c = costByAllocId[row.id];
      if (c) {
        internal += c.internal;
        external += c.external;
        direct += c.direct;
        total += c.total;
      }
    }
    return { internal, external, direct, total };
  }, [allocations, costByAllocId]);

  const allocationGroupsWithRows = useMemo(
    () => groupAllocationsByResourceType(allocations).filter((g) => g.rows.length > 0),
    [allocations]
  );

  /** Per resource-type sum for assignment section headers (matches single cost column). */
  const allocationTotalsByGroup = useMemo(() => {
    const sums: Record<ResourceGroupKey, number> = {
      INTERNAL: 0,
      EXTERNAL: 0,
      DIRECT_COST: 0,
    };
    for (const row of allocations) {
      const c = costByAllocId[row.id];
      if (!c) continue;
      const t = row.resource.type;
      const key: ResourceGroupKey =
        t === "EXTERNAL" || t === "DIRECT_COST" ? t : "INTERNAL";
      if (key === "INTERNAL") sums.INTERNAL += c.internal;
      else if (key === "EXTERNAL") sums.EXTERNAL += c.external;
      else sums.DIRECT_COST += c.direct;
    }
    return sums;
  }, [allocations, costByAllocId]);

  /** Sum of visible initiative rows (already filtered by year via API). */
  const budgetListTotals = useMemo(() => {
    let internal = 0;
    let external = 0;
    let direct = 0;
    let total = 0;
    for (const ini of initiatives) {
      internal += ini.internal_cost;
      external += ini.external_cost;
      direct += ini.direct_cost;
      total += ini.total_cost;
    }
    return { internal, external, direct, total };
  }, [initiatives]);

  const addAllocation = async () => {
    if (!selectedInitiative) return;
    const res = await fetch("/api/allocations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initiativeId: selectedInitiative.jira_key }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert((j as { error?: string }).error ?? "Could not create allocation");
      return;
    }
    const created = (await res.json()) as AllocationDTO;
    setAllocations((prev) => [...prev, created]);
    void loadCostsForInitiative(selectedInitiative.jira_key);
  };

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-6">
        <Link href="/test/products" className="text-primary text-sm underline">
          ← Back to products
        </Link>
        <p className="text-muted-foreground mt-4 text-sm">Product not found.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div>
        <Link
          href="/test/products"
          className="text-primary inline-flex text-sm font-medium underline-offset-4 hover:underline"
        >
          ← Back to products
        </Link>
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{product.name}</CardTitle>
                {product.productFamily ? (
                  <Badge variant="secondary">{product.productFamily}</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <FieldReadonly label="Division" value={product.division ?? ""} />
              <FieldReadonly label="Sub-division" value={product.subDivision ?? ""} />
              <FieldReadonly label="Team" value={product.team ?? ""} />
              <FieldReadonly label="SAP EOTP code" value={product.sapEotpCode ?? ""} />
              <FieldReadonly label="SAP EOTP name" value={product.sapEotpName ?? ""} />
              {product.attractiveness != null ? (
                <FieldReadonly label="Attractiveness" value={String(product.attractiveness)} />
              ) : null}
              {product.competitiveness != null ? (
                <FieldReadonly label="Competitiveness" value={String(product.competitiveness)} />
              ) : null}
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="pb-2">
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="min-w-0">
                  <CardTitle className="text-base">Budget by initiative</CardTitle>
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    <button
                      type="button"
                      onClick={() => setSelectedYear(null)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs",
                        selectedYear === null
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background"
                      )}
                    >
                      All
                    </button>
                    {yearOptions.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setSelectedYear(y)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs",
                          selectedYear === y
                            ? "border-primary bg-primary/10"
                            : "border-border bg-background"
                        )}
                      >
                        {y}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-foreground min-w-0 shrink-0 overflow-x-auto sm:w-auto">
                  {budgetLoading ? (
                    <div className="text-muted-foreground flex h-8 items-center justify-end gap-2 text-xs sm:h-auto sm:min-h-[2.25rem] sm:items-end sm:pb-0.5">
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                      <span className="sm:hidden">Loading…</span>
                    </div>
                  ) : (
                    <div className={cn(FINANCIALS_4COL, FINANCIALS_PILL)}>
                      <span className="block text-right">{formatK(budgetListTotals.internal)}</span>
                      <span className="block text-right">{formatK(budgetListTotals.external)}</span>
                      <span className="block text-right">{formatK(budgetListTotals.direct)}</span>
                      <span className="block text-right font-bold text-[color:var(--primary-blue)]">
                        {formatK(budgetListTotals.total)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto">
              {budgetLoading ? (
                <p className="text-muted-foreground text-sm">Loading initiatives…</p>
              ) : initiatives.length === 0 ? (
                <p className="text-muted-foreground text-sm">No allocation costs for this product.</p>
              ) : (
                <div className="flex min-h-0 flex-col">
                  <div className="border-border text-muted-foreground mb-1 grid w-full grid-cols-1 gap-3 border-b px-3 pb-2 text-xs font-medium sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div className="min-w-0">Initiative</div>
                    <div className={`${FINANCIALS_4COL} min-w-0 overflow-x-auto`}>
                      <span>INT</span>
                      <span>EXT</span>
                      <span>DIR</span>
                      <span className="font-medium text-[color:var(--primary-blue)]">Tot</span>
                    </div>
                  </div>
                  <ul className="space-y-0 divide-y divide-border">
                    {initiatives.map((ini) => (
                      <li key={`${ini.jira_key}-${ini.initiative_year}`}>
                        <button
                          type="button"
                          onClick={() => void handleSelectInitiative(ini)}
                          className={cn(
                            "hover:bg-muted/50 w-full rounded-md px-3 py-2.5 text-left transition-colors",
                            selectedInitiative?.jira_key === ini.jira_key &&
                              selectedInitiative?.initiative_year === ini.initiative_year
                              ? "bg-[color:var(--primary-blue)]/10"
                              : ""
                          )}
                        >
                          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-baseline gap-2">
                                <span className="shrink-0 font-mono text-sm font-medium">
                                  {ini.jira_key}
                                </span>
                                <span
                                  className="text-foreground min-w-0 flex-1 truncate text-sm"
                                  title={ini.summary}
                                >
                                  {ini.summary}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <span className="text-muted-foreground text-xs tabular-nums">
                                  {ini.initiative_year}
                                </span>
                                <span
                                  className={cn(
                                    "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
                                    statusClass(ini.status)
                                  )}
                                >
                                  {ini.status}
                                </span>
                              </div>
                            </div>
                            <div className="text-foreground min-w-0 shrink-0 overflow-x-auto sm:w-auto">
                              <div className={FINANCIALS_4COL}>
                                <span className="block text-right">{formatK(ini.internal_cost)}</span>
                                <span className="block text-right">{formatK(ini.external_cost)}</span>
                                <span className="block text-right">{formatK(ini.direct_cost)}</span>
                                <span className="block text-right font-medium text-[color:var(--primary-blue)]">
                                  {formatK(ini.total_cost)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div
          className={cn(
            "bg-card min-h-[320px] min-w-0 overflow-hidden rounded-lg border border-border transition-opacity duration-200",
            selectedInitiative ? "opacity-100" : "opacity-90"
          )}
        >
          {!selectedInitiative ? (
            <div className="text-muted-foreground flex h-full min-h-[240px] items-center justify-center p-6 text-sm">
              Select an initiative to edit allocations.
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-auto p-4">
              <div className="mb-4 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold leading-snug">{selectedInitiative.summary}</h2>
                  <Badge variant="secondary">{selectedInitiative.jira_key}</Badge>
                  <span className={cn("rounded px-2 py-0.5 text-xs", statusClass(selectedInitiative.status))}>
                    {selectedInitiative.status}
                  </span>
                  <span className="text-muted-foreground text-sm">{selectedInitiative.initiative_year}</span>
                </div>
              </div>

              <div className="min-h-0 flex-1">
                <div className="mb-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-foreground text-sm font-medium">Allocations</h3>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void addAllocation()}
                      disabled={resources.length === 0}
                      className="bg-[#185FA5] text-white hover:bg-[#185FA5]/90"
                    >
                      + New
                    </Button>
                  </div>
                  <div className="flex w-full flex-col items-stretch gap-1 sm:items-end">
                    <div
                      className={`${FINANCIALS_4COL} text-muted-foreground w-full min-w-0 justify-items-end text-xs font-medium sm:w-auto`}
                    >
                      <span>INT</span>
                      <span>EXT</span>
                      <span>DIR</span>
                      <span className="font-medium text-[color:var(--primary-blue)]">Tot</span>
                    </div>
                    {allocLoading ? (
                      <div className="text-muted-foreground flex min-h-[2.25rem] w-full items-center justify-end gap-2 text-xs sm:w-auto">
                        <Loader2 className="size-4 shrink-0 animate-spin" />
                        <span className="sm:hidden">Totals…</span>
                      </div>
                    ) : (
                      <div className={cn(FINANCIALS_4COL, FINANCIALS_PILL, "w-full min-w-0 justify-items-end sm:w-auto")}>
                        <span className="block text-right">{formatK(allocationTotals.internal)}</span>
                        <span className="block text-right">{formatK(allocationTotals.external)}</span>
                        <span className="block text-right">{formatK(allocationTotals.direct)}</span>
                        <span className="block text-right font-bold text-[color:var(--primary-blue)]">
                          {formatK(allocationTotals.total)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Percent</TableHead>
                      <TableHead>Man days</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead className="min-w-[7rem] text-right">Cost</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground py-8 text-center text-sm">
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="size-4 animate-spin" /> Loading allocations…
                          </span>
                        </TableCell>
                      </TableRow>
                    ) : (
                      allocationGroupsWithRows.map((group, groupIndex) => (
                        <Fragment key={group.key}>
                          <TableRow className="hover:bg-transparent">
                            <TableCell
                              colSpan={5}
                              className={cn(
                                "bg-muted/25 px-3 py-2.5",
                                groupIndex > 0 && "border-t border-border pt-5"
                              )}
                            >
                              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                                <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                                  {group.label}
                                </span>
                                <div
                                  className={cn(
                                    FINANCIALS_PILL,
                                    "inline-flex min-w-[6.5rem] justify-end tabular-nums text-[color:var(--primary-blue)]"
                                  )}
                                >
                                  {formatK(allocationTotalsByGroup[group.key])}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                          {group.rows.map((row) => (
                            <AllocationEditor
                              key={row.id}
                              row={row}
                              resources={resources}
                              costBreakdown={costByAllocId[row.id]}
                              onPatched={(u) =>
                                setAllocations((prev) => prev.map((a) => (a.id === u.id ? u : a)))
                              }
                              onDeleted={() =>
                                setAllocations((prev) => prev.filter((a) => a.id !== row.id))
                              }
                              onCostsStale={refreshCosts}
                            />
                          ))}
                        </Fragment>
                      ))
                    )}
                  </TableBody>
                </Table>
                {!allocLoading && allocations.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No allocations yet.</p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
