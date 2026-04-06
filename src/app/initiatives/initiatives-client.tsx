"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";


import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Subset of Product from GET /api/products/[id] — used to bypass RSC→dynamic prop loss for catalog fields. */
export type ProductCatalogDTO = {
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

export type InitiativeDTO = {
  id: string;
  powerId: string | null;
  summary: string;
  status: string;
  year: number;
  components: string | null;
  productGroup: string | null;
  /** FK to Product.id when linked. */
  productId: string | null;
  /** From linked Product row (productId); not Jira `components`. */
  productName: string | null;
  /** From linked Product.team; not Jira `productGroup`. */
  productTeam: string | null;
  /** Flat catalog fields (must stay top-level — nested objects are dropped in RSC → dynamic client). */
  productFamily: string | null;
  division: string | null;
  subDivision: string | null;
  sapEotpCode: string | null;
  sapEotpName: string | null;
  attractiveness: number | null;
  competitiveness: number | null;
  initiativeType: string | null;
  createdOn: string;
  modifiedOn: string;
};

export type ResourceOption = { id: string; fullName: string };

export type AllocationDTO = {
  id: string;
  initiativeId: string;
  resourceId: string;
  quantity: number | null;
  manDays: number | null;
  resource: ResourceOption;
};

type Props = {
  initiatives: InitiativeDTO[];
  resources: ResourceOption[];
};

const ALL = "all";
/** Filter value for initiatives with no linked Product */
const UNASSIGNED = "__unassigned__";

function parseProductJson(o: Record<string, unknown>): ProductCatalogDTO {
  return {
    id: String(o.id),
    name: typeof o.name === "string" ? o.name : "",
    productFamily: o.productFamily == null ? null : String(o.productFamily),
    division: o.division == null ? null : String(o.division),
    subDivision: o.subDivision == null ? null : String(o.subDivision),
    team: o.team == null ? null : String(o.team),
    sapEotpCode: o.sapEotpCode == null ? null : String(o.sapEotpCode),
    sapEotpName: o.sapEotpName == null ? null : String(o.sapEotpName),
    attractiveness:
      typeof o.attractiveness === "number" && Number.isFinite(o.attractiveness)
        ? o.attractiveness
        : null,
    competitiveness:
      typeof o.competitiveness === "number" && Number.isFinite(o.competitiveness)
        ? o.competitiveness
        : null,
  };
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

function FieldReadonly({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <div className="rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-sm">{value || "—"}</div>
    </div>
  );
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return Number.isInteger(n) ? String(n) : String(n);
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
    return resources.filter((r) =>
      r.fullName.toLowerCase().includes(q)
    );
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
        <span className="truncate">
          {selected?.fullName ?? "Select a resource"}
        </span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search resource..."
            value={search}
            onValueChange={setSearch}
          />
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
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === r.id ? "opacity-100" : "opacity-0"
                    )}
                  />
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

function AllocationEditor({
  row,
  resources,
  onPatched,
  onDeleted,
}: {
  row: AllocationDTO;
  resources: ResourceOption[];
  onPatched: (u: AllocationDTO) => void;
  onDeleted: () => void;
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
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Save failed");
        } finally {
          setSaving(false);
        }
      })();
    }, 450);
  };

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.id}</TableCell>
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
      <TableCell className="min-w-[220px]">
  <ResourceCombobox
    value={row.resourceId}
    resources={resources}
    onSelect={async (resourceId) => {
      setSaving(true);
      setErr(null);
      try {
        const updated = await patchAllocation(row.id, { resourceId });
        onPatched(updated);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    }}
  />
</TableCell>
      <TableCell className="w-36">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {saving ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
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

export function InitiativesPageClient({ initiatives, resources }: Props) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<string>(ALL);
  const [productFilter, setProductFilter] = useState<string>(ALL);
  const [teamFilter, setTeamFilter] = useState<string>(ALL);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<AllocationDTO[]>([]);
  const [allocLoading, setAllocLoading] = useState(false);
  const [catalogProduct, setCatalogProduct] = useState<ProductCatalogDTO | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const years = useMemo(
    () => [...new Set(initiatives.map((i) => i.year))].sort((a, b) => a - b),
    [initiatives]
  );
  const products = useMemo(() => {
    const s = new Set<string>();
    for (const i of initiatives) {
      if (i.productName?.trim()) s.add(i.productName.trim());
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [initiatives]);
  const teams = useMemo(() => {
    const s = new Set<string>();
    for (const i of initiatives) {
      if (i.productTeam?.trim()) s.add(i.productTeam.trim());
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [initiatives]);
  const hasUnassignedProduct = useMemo(
    () => initiatives.some((i) => !i.productName?.trim()),
    [initiatives]
  );
  const hasUnassignedTeam = useMemo(
    () => initiatives.some((i) => !i.productTeam?.trim()),
    [initiatives]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initiatives.filter((i) => {
      if (yearFilter !== ALL && String(i.year) !== yearFilter) return false;
      if (productFilter !== ALL) {
        if (productFilter === UNASSIGNED) {
          if (i.productName?.trim()) return false;
        } else if ((i.productName?.trim() ?? "") !== productFilter) {
          return false;
        }
      }
      if (teamFilter !== ALL) {
        if (teamFilter === UNASSIGNED) {
          if (i.productTeam?.trim()) return false;
        } else if ((i.productTeam?.trim() ?? "") !== teamFilter) {
          return false;
        }
      }
      if (!q) return true;
      const hay = [
        i.id,
        i.summary,
        i.productName ?? "",
        i.productTeam ?? "",
        i.components ?? "",
        i.productGroup ?? "",
        i.initiativeType ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [initiatives, search, yearFilter, productFilter, teamFilter]);

  const selected = useMemo(
    () => (selectedId ? initiatives.find((i) => i.id === selectedId) ?? null : null),
    [initiatives, selectedId]
  );

  useEffect(() => {
    const pid = selected?.productId?.trim();
    const pname = selected?.productName?.trim();
    if (!pid && !pname) {
      setCatalogProduct(null);
      setCatalogLoading(false);
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogProduct(null);

    const loadById = () =>
      fetch(`/api/products/${encodeURIComponent(pid!)}`).then((r) => (r.ok ? r.json() : null));

    const loadByName = () =>
      fetch(`/api/products`)
        .then((r) => (r.ok ? r.json() : null))
        .then((list: unknown) => {
          if (!Array.isArray(list)) return null;
          const row = list.find(
            (x) =>
              x &&
              typeof x === "object" &&
              "name" in x &&
              typeof (x as { name: unknown }).name === "string" &&
              (x as { name: string }).name.trim().toLowerCase() === pname!.toLowerCase()
          );
          return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
        });

    const promise = pid ? loadById() : loadByName();

    promise
      .then((data: unknown) => {
        if (cancelled || data == null || typeof data !== "object" || !("id" in data)) {
          if (!cancelled) setCatalogProduct(null);
          return;
        }
        setCatalogProduct(parseProductJson(data as Record<string, unknown>));
      })
      .catch(() => {
        if (!cancelled) setCatalogProduct(null);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.productId, selected?.productName, selected?.id]);

  const productCardFields = useMemo(() => {
    if (!selected) return null;
    const c = catalogProduct;
    return {
      name: (c?.name ?? selected.productName)?.trim() ?? "",
      productFamily: c?.productFamily ?? selected.productFamily,
      division: c?.division ?? selected.division,
      subDivision: c?.subDivision ?? selected.subDivision,
      team: c?.team ?? selected.productTeam,
      sapEotpCode: c?.sapEotpCode ?? selected.sapEotpCode,
      sapEotpName: c?.sapEotpName ?? selected.sapEotpName,
      attractiveness: c?.attractiveness ?? selected.attractiveness,
      competitiveness: c?.competitiveness ?? selected.competitiveness,
    };
  }, [selected, catalogProduct]);

  useEffect(() => {
    if (!selectedId) {
      setAllocations([]);
      return;
    }
    let cancelled = false;
    setAllocLoading(true);
    fetch(`/api/allocations?initiativeId=${encodeURIComponent(selectedId)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load allocations");
        return r.json();
      })
      .then((data: AllocationDTO[]) => {
        if (!cancelled) setAllocations(data);
      })
      .catch(() => {
        if (!cancelled) setAllocations([]);
      })
      .finally(() => {
        if (!cancelled) setAllocLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const resetFilters = () => {
    setSearch("");
    setYearFilter(ALL);
    setProductFilter(ALL);
    setTeamFilter(ALL);
  };

  const refreshJira = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/jira/sync");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Sync failed");
      }
      router.refresh();
    } finally {
      setSyncing(false);
    }
  };

  const addAllocation = async () => {
    if (!selectedId) return;
    const res = await fetch("/api/allocations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initiativeId: selectedId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert((j as { error?: string }).error ?? "Could not create allocation");
      return;
    }
    const created = (await res.json()) as AllocationDTO;
    setAllocations((prev) => [...prev, created]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-200/80 bg-white px-4 py-3">
        <h1 className="font-heading text-lg font-semibold">Initiatives</h1>
        <p className="text-muted-foreground text-sm">Select an initiative to view assignments.</p>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[520px] shrink-0 flex-col border-r">
          <div className="flex flex-col gap-2 border-b border-neutral-200/80 bg-white p-3">
            <Input
              placeholder="Search key, summary, product, team…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
            <div className="flex flex-wrap gap-2">
              <Select value={yearFilter} onValueChange={(v) => setYearFilter(v ?? ALL)}>
                <SelectTrigger size="sm" className="w-[120px]">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All years</SelectItem>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={productFilter} onValueChange={(v) => setProductFilter(v ?? ALL)}>
                <SelectTrigger size="sm" className="min-w-[140px] max-w-[200px]">
                  <SelectValue placeholder="Product" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All products</SelectItem>
                  {hasUnassignedProduct ? (
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  ) : null}
                  {products.map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className="line-clamp-1">{p}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={teamFilter} onValueChange={(v) => setTeamFilter(v ?? ALL)}>
                <SelectTrigger size="sm" className="min-w-[120px] max-w-[180px]">
                  <SelectValue placeholder="Team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All teams</SelectItem>
                  {hasUnassignedTeam ? (
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  ) : null}
                  {teams.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={syncing}
                onClick={refreshJira}
                className="bg-[#185FA5] text-white hover:bg-[#185FA5]/90"
              >
                {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Refresh
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={resetFilters}>
                <RotateCcw className="size-4" />
                Reset filters
              </Button>
            </div>
          </div>

          {/* Native overflow avoids Base UI ScrollArea SSR/client DOM mismatches (hydration errors). */}
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Key</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="max-w-[100px]">Product</TableHead>
                  <TableHead className="w-14">Year</TableHead>
                  <TableHead className="max-w-[80px]">Type</TableHead>
                  <TableHead className="max-w-[80px]">Team</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((i) => (
                  <TableRow
                    key={i.id}
                    data-state={selectedId === i.id ? "selected" : undefined}
                    className={cn("cursor-pointer", selectedId === i.id && "bg-[#e8f0fa]")}
                    onClick={() => setSelectedId(i.id)}
                  >
                    <TableCell className="font-mono text-xs">{i.id}</TableCell>
                    <TableCell className="max-w-[180px] whitespace-normal">
                      <span className="line-clamp-2" title={i.summary}>
                        {i.summary}
                      </span>
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground max-w-[100px] truncate text-xs"
                      title={i.productName ?? ""}
                    >
                      {i.productName ?? "—"}
                    </TableCell>
                    <TableCell>{i.year}</TableCell>
                    <TableCell className="max-w-[80px] truncate text-xs" title={i.initiativeType ?? ""}>
                      {i.initiativeType ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[80px] truncate text-xs" title={i.productTeam ?? ""}>
                      {i.productTeam ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length === 0 ? (
              <p className="text-muted-foreground p-4 text-center text-sm">No initiatives match.</p>
            ) : null}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-4">
          {!selected ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              Choose an initiative from the list.
            </div>
          ) : (
            <div className="mx-auto max-w-5xl space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{selected.id}</Badge>
              </div>

              <div className="space-y-4">
                <Card className="border-[color:var(--primary-blue)]/20 bg-[color:var(--primary-blue)]/[0.04] ring-[color:var(--primary-blue)]/15">
                  <CardHeader className="border-b border-[color:var(--primary-blue)]/15 pb-3">
                    <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                      Product
                    </p>
                    <CardTitle className="text-base leading-snug sm:text-lg">
                      {productCardFields?.name ? (
                        <span title={productCardFields.name}>{productCardFields.name}</span>
                      ) : (
                        <span className="text-muted-foreground font-normal">No product linked</span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    {catalogLoading &&
                    (selected.productId?.trim() || selected.productName?.trim()) ? (
                      <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Loader2 className="size-4 animate-spin" />
                        Loading product catalog…
                      </div>
                    ) : productCardFields?.name || selected.productId?.trim() ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <FieldReadonly label="Product family" value={productCardFields?.productFamily ?? ""} />
                        <FieldReadonly label="Division" value={productCardFields?.division ?? ""} />
                        <FieldReadonly label="Sub-division" value={productCardFields?.subDivision ?? ""} />
                        <FieldReadonly label="Team" value={productCardFields?.team ?? ""} />
                        <FieldReadonly label="SAP EOTP code" value={productCardFields?.sapEotpCode ?? ""} />
                        <FieldReadonly label="SAP EOTP name" value={productCardFields?.sapEotpName ?? ""} />
                        <FieldReadonly label="Attractiveness" value={fmtNum(productCardFields?.attractiveness)} />
                        <FieldReadonly label="Competitiveness" value={fmtNum(productCardFields?.competitiveness)} />
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        No catalog row linked — sync Jira or seed products to show SAP EOTP and org fields.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="border-b border-neutral-200/90 pb-3">
                    <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                      Initiative
                    </p>
                    <CardTitle className="text-base leading-snug sm:text-lg">
                      <span className="line-clamp-3" title={selected.summary}>
                        {selected.summary}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <FieldReadonly label="Jira identifier" value={selected.id} />
                      <FieldReadonly label="Year" value={String(selected.year)} />
                      <FieldReadonly label="Type of initiative" value={selected.initiativeType ?? ""} />
                      <FieldReadonly label="Status" value={selected.status} />
                      <FieldReadonly label="Jira components (raw)" value={selected.components ?? ""} />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="font-heading text-base font-medium">Resources assigned to initiative</h2>
                  <Button
                    type="button"
                    size="sm"
                    onClick={addAllocation}
                    disabled={resources.length === 0}
                    className="bg-[#185FA5] text-white hover:bg-[#185FA5]/90"
                  >
                    + New
                  </Button>
                </div>
                <Separator className="mb-4" />
                {allocLoading ? (
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="size-4 animate-spin" />
                    Loading allocations…
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Assignment ID</TableHead>
                        <TableHead>Percent</TableHead>
                        <TableHead>Man days</TableHead>
                        <TableHead>Resource</TableHead>
                        <TableHead className="w-28" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allocations.map((row) => (
                        <AllocationEditor
                          key={row.id}
                          row={row}
                          resources={resources}
                          onPatched={(u) =>
                            setAllocations((prev) => prev.map((a) => (a.id === u.id ? u : a)))
                          }
                          onDeleted={() => setAllocations((prev) => prev.filter((a) => a.id !== row.id))}
                        />
                      ))}
                    </TableBody>
                  </Table>
                )}
                {!allocLoading && allocations.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No allocations yet.</p>
                ) : null}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
