"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type {
  ArInvoicingReportLine,
  ArInvoicingReportResponse,
  ArInvoicingSapRow,
  ArInvoicingUnmatchedBucket,
} from "@/lib/ar-invoicing-report-types";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

const PAGE_LIMIT = 300;

/** Sentinel: no org / product filter sent to the API */
const ORG_ALL = "__ALL__";
/** Sentinel: no year filter sent to the API (cross-year view). */
const YEAR_ALL = "__ALL__";

type AllocationEntityRow = {
  id: string;
  name: string;
  division: string | null;
  subDivision: string | null;
  team: string | null;
};

function uniqSortedStrings(values: Iterable<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const s = v?.trim();
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function yearOptions(): number[] {
  const y = new Date().getFullYear();
  return [y - 1, y, y + 1];
}

function formatEuro(n: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)} €`;
  }
}

type FilterState = {
  /** `null` = "All years" (no `year` query param sent). */
  year: number | null;
  status: string;
  /** `ORG_ALL` = no filter; `"Unassigned"` = API sentinel for null org on AR row */
  division: string;
  subdivision: string;
  team: string;
  /** `ORG_ALL` = no filter; otherwise `allocation_entity.id` */
  productId: string;
  mapped: "all" | "mapped" | "unmapped";
  warningsOnly: boolean;
  client: string;
  masterProduct: string;
  contractNumber: string;
  counterpartReference: string;
  signedFrom: string;
  signedTo: string;
  importId: string;
};

const initialFilters = (): FilterState => ({
  year: null,
  status: "",
  division: ORG_ALL,
  subdivision: ORG_ALL,
  team: ORG_ALL,
  productId: ORG_ALL,
  mapped: "all",
  warningsOnly: false,
  client: "",
  masterProduct: "",
  contractNumber: "",
  counterpartReference: "",
  signedFrom: "",
  signedTo: "",
  importId: "",
});

type LineGroup = {
  /** Stable React key + Map key. */
  key: string;
  /** `null` when the AR rows have no counterpart reference. */
  counterpartReference: string | null;
  /** Distinct client names within the group (usually 1, but the same ref can carry several). */
  clientNames: string[];
  lines: ArInvoicingReportLine[];
  planned: number;
  invoiced: number;
};

function groupByCounterpartReference(lines: ArInvoicingReportLine[]): LineGroup[] {
  const map = new Map<string, LineGroup>();
  for (const line of lines) {
    const key = line.counterpartReference ?? "__no_ref__";
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        counterpartReference: line.counterpartReference,
        clientNames: [],
        lines: [],
        planned: 0,
        invoiced: 0,
      };
      map.set(key, g);
    }
    g.lines.push(line);
    g.planned += line.amountEur;
    g.invoiced += line.invoicedTotalEur;
    if (line.clientName && !g.clientNames.includes(line.clientName)) {
      g.clientNames.push(line.clientName);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.counterpartReference == null) return 1;
    if (b.counterpartReference == null) return -1;
    return a.counterpartReference.localeCompare(b.counterpartReference);
  });
}

/** Stable id for a synthetic "no AR line item" row of a group. */
function unmatchedLineId(
  counterpartReference: string,
  allocationEntityId: string | null
): string {
  return `unmatched::${counterpartReference}::${allocationEntityId ?? "__unmapped__"}`;
}

function isUnmatchedLine(line: ArInvoicingReportLine): boolean {
  return line.id.startsWith("unmatched::");
}

/**
 * Build a synthetic AR line for one `(counterpart_reference, allocation_entity_id)`
 * bucket of SAP rows that match no AR line item. When `allocation_entity_id` is
 * set, the SAP designations were resolved via `sap_designation_mapping` (step 2);
 * when null they were not (step 2 without mapping or step 4).
 */
function makeUnmatchedLine(bucket: ArInvoicingUnmatchedBucket): ArInvoicingReportLine {
  const distinctDesignations = [
    ...new Set(
      bucket.invoices.map((i) => i.sapDesignation).filter((s): s is string => !!s)
    ),
  ];
  const yearMin = bucket.invoices.reduce(
    (acc, i) => (i.year && i.year < acc ? i.year : acc),
    Number.POSITIVE_INFINITY
  );
  return {
    id: unmatchedLineId(bucket.counterpartReference, bucket.allocationEntityId),
    importId: "",
    uniqueArId: "",
    contractNumber: "—",
    contractName: null,
    counterpartReference: bucket.counterpartReference,
    lineItemNumber: "—",
    documentStatus: "",
    signedDate: null,
    clientName: null,
    sfMasterProductName: null,
    sfProductName: bucket.allocationEntityId
      ? "(no AR line item)"
      : "(no AR line item · unmapped)",
    description: distinctDesignations.length > 0 ? distinctDesignations.join(", ") : null,
    sapSoNumber: null,
    quantity: null,
    amountEur: 0,
    year: Number.isFinite(yearMin) ? yearMin : 0,
    allocationEntityId: bucket.allocationEntityId,
    allocationEntityName: bucket.allocationEntityName,
    arDivision: bucket.allocationEntityDivision,
    arSubDivision: bucket.allocationEntitySubDivision,
    arProductFamily: bucket.allocationEntityProductFamily,
    importWarning: null,
    invoices: bucket.invoices,
    invoicedTotalEur: bucket.invoicedTotalEur,
    invoiceRowCount: bucket.invoices.length,
  };
}

function buildSearchParams(state: FilterState, offset: number): URLSearchParams {
  const sp = new URLSearchParams();
  if (state.year != null) sp.set("year", String(state.year));
  sp.set("limit", String(PAGE_LIMIT));
  sp.set("offset", String(offset));
  if (state.status.trim()) sp.set("status", state.status.trim());
  if (state.division !== ORG_ALL) sp.set("division", state.division);
  if (state.subdivision !== ORG_ALL) sp.set("subdivision", state.subdivision);
  if (state.team !== ORG_ALL) sp.set("team", state.team);
  if (state.productId !== ORG_ALL) sp.set("productId", state.productId);
  if (state.mapped === "mapped") sp.set("mapped", "true");
  if (state.mapped === "unmapped") sp.set("mapped", "false");
  if (state.warningsOnly) sp.set("warningsOnly", "true");
  if (state.client.trim()) sp.set("client", state.client.trim());
  if (state.masterProduct.trim()) sp.set("masterProduct", state.masterProduct.trim());
  if (state.contractNumber.trim()) sp.set("contractNumber", state.contractNumber.trim());
  if (state.counterpartReference.trim()) sp.set("counterpartReference", state.counterpartReference.trim());
  if (state.signedFrom.trim()) sp.set("signedFrom", state.signedFrom.trim());
  if (state.signedTo.trim()) sp.set("signedTo", state.signedTo.trim());
  if (state.importId.trim()) sp.set("importId", state.importId.trim());
  return sp;
}

export default function ArInvoicingReportPage() {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ArInvoicingReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<AllocationEntityRow[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const groups = useMemo(() => {
    const list = groupByCounterpartReference(data?.lines ?? []);
    const unmatched = data?.unmatched ?? [];
    if (unmatched.length === 0) return list;

    const byRef = new Map<string, ArInvoicingUnmatchedBucket[]>();
    for (const u of unmatched) {
      const arr = byRef.get(u.counterpartReference) ?? [];
      arr.push(u);
      byRef.set(u.counterpartReference, arr);
    }
    for (const g of list) {
      if (g.counterpartReference == null) continue;
      const buckets = byRef.get(g.counterpartReference);
      if (!buckets || buckets.length === 0) continue;
      const sortedBuckets = [...buckets].sort((a, b) => {
        const an = a.allocationEntityName ?? "\uffff";
        const bn = b.allocationEntityName ?? "\uffff";
        return an.localeCompare(bn);
      });
      for (const bucket of sortedBuckets) {
        const synthetic = makeUnmatchedLine(bucket);
        g.lines.push(synthetic);
        g.invoiced += synthetic.invoicedTotalEur;
      }
    }
    return list;
  }, [data?.lines, data?.unmatched]);

  const years = useMemo(() => {
    const fromApi = data?.meta.availableYears ?? [];
    if (fromApi.length > 0) return [...fromApi].sort((a, b) => b - a);
    return yearOptions();
  }, [data?.meta.availableYears]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/allocation-entities")
      .then(async (r) => {
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<AllocationEntityRow[]>;
      })
      .then((rows) => {
        if (!cancelled) {
          setCatalog(Array.isArray(rows) ? rows : []);
          setCatalogError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setCatalog([]);
          setCatalogError(e instanceof Error ? e.message : "Failed to load products");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const entitiesForDivisionScope = useMemo(() => {
    if (filters.division === ORG_ALL) return catalog;
    if (filters.division === "Unassigned") return catalog.filter((e) => !e.division?.trim());
    return catalog.filter((e) => e.division === filters.division);
  }, [catalog, filters.division]);

  const entitiesForTeamScope = useMemo(() => {
    let rows = entitiesForDivisionScope;
    if (filters.subdivision !== ORG_ALL) {
      rows = rows.filter((e) => (e.subDivision ?? "") === filters.subdivision);
    }
    return rows;
  }, [entitiesForDivisionScope, filters.subdivision]);

  const entitiesForProduct = useMemo(() => {
    let rows = entitiesForTeamScope;
    if (filters.team !== ORG_ALL) {
      if (filters.team === "Unassigned") rows = rows.filter((e) => !e.team?.trim());
      else rows = rows.filter((e) => e.team === filters.team);
    }
    return rows;
  }, [entitiesForTeamScope, filters.team]);

  const divisionChoices = useMemo(() => {
    const u = uniqSortedStrings(catalog.map((e) => e.division));
    const set = new Set<string>(["Unassigned", ...u]);
    return [...set].sort((a, b) => {
      if (a === "Unassigned") return -1;
      if (b === "Unassigned") return 1;
      return a.localeCompare(b);
    });
  }, [catalog]);

  const subdivisionChoices = useMemo(
    () => uniqSortedStrings(entitiesForDivisionScope.map((e) => e.subDivision)),
    [entitiesForDivisionScope]
  );

  const teamChoices = useMemo(() => {
    const u = uniqSortedStrings(entitiesForTeamScope.map((e) => e.team));
    const set = new Set<string>(["Unassigned", ...u]);
    return [...set].sort((a, b) => {
      if (a === "Unassigned") return -1;
      if (b === "Unassigned") return 1;
      return a.localeCompare(b);
    });
  }, [entitiesForTeamScope]);

  const productChoices = useMemo(() => {
    return [...entitiesForProduct].sort((a, b) => a.name.localeCompare(b.name));
  }, [entitiesForProduct]);

  const fetchPage = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const sp = buildSearchParams(filtersRef.current, nextOffset);
      const res = await fetch(`/api/reports/ar-invoicing?${sp.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ArInvoicingReportResponse;
      setData(json);
      setOffset(nextOffset);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage(0);
  }, [fetchPage]);

  const onApply = useCallback(() => {
    void fetchPage(0);
  }, [fetchPage]);

  const total = data?.meta.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + PAGE_LIMIT < total;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <div className="text-sm">
        <Link href="/reports" className="text-primary underline">
          Reports
        </Link>
        <span className="text-muted-foreground"> / AR invoicing follow-up</span>
      </div>

      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">AR invoicing follow-up</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              For each planned revenue line (<code className="text-xs">ar_entry</code>), see linked SAP client
              invoices from <code className="text-xs">revenue_entry</code>: explicit{" "}
              <code className="text-xs">ar_entry_id</code> link when present, otherwise the same SO + product label
              heuristic as the{" "}
              <Link href="/reports/ar" className="text-primary underline">
                AR report
              </Link>
              . Invoiced org columns come from the revenue line&apos;s resolved product when available.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetchPage(offset)} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-2">
              <Label>Year</Label>
              <Select
                value={filters.year == null ? YEAR_ALL : String(filters.year)}
                onValueChange={(v) => {
                  if (v == null) return;
                  setFilters((f) => ({ ...f, year: v === YEAR_ALL ? null : Number(v) }));
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={YEAR_ALL}>All years</SelectItem>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4">
              <Label>Status (comma-separated)</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Signed"
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Mapped</Label>
              <Select
                value={filters.mapped}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, mapped: v as FilterState["mapped"] }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="mapped">Mapped only</SelectItem>
                  <SelectItem value="unmapped">Unmapped only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 flex items-end pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.warningsOnly}
                  onChange={(e) => setFilters((f) => ({ ...f, warningsOnly: e.target.checked }))}
                />
                Warnings only
              </label>
            </div>
            <div className="md:col-span-2 flex items-end">
              <Button type="button" className="w-full" onClick={onApply} disabled={loading}>
                Apply filters
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-3">
              <Label>Division</Label>
              <Select
                value={filters.division}
                onValueChange={(v) => {
                  if (v == null) return;
                  setFilters((f) => ({
                    ...f,
                    division: v,
                    subdivision: ORG_ALL,
                    team: ORG_ALL,
                    productId: ORG_ALL,
                  }));
                }}
              >
                <SelectTrigger className="mt-1 w-full min-w-0">
                  <SelectValue placeholder="All divisions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ORG_ALL}>All divisions</SelectItem>
                  {divisionChoices.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d === "Unassigned" ? "Unassigned (no division on AR product)" : d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Label>Subdivision</Label>
              <Select
                value={filters.subdivision}
                onValueChange={(v) => {
                  if (v == null) return;
                  setFilters((f) => ({
                    ...f,
                    subdivision: v,
                    team: ORG_ALL,
                    productId: ORG_ALL,
                  }));
                }}
              >
                <SelectTrigger className="mt-1 w-full min-w-0">
                  <SelectValue placeholder="All subdivisions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ORG_ALL}>All subdivisions</SelectItem>
                  {subdivisionChoices.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Label>Team</Label>
              <Select
                value={filters.team}
                onValueChange={(v) => {
                  if (v == null) return;
                  setFilters((f) => ({ ...f, team: v, productId: ORG_ALL }));
                }}
              >
                <SelectTrigger className="mt-1 w-full min-w-0">
                  <SelectValue placeholder="All teams" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ORG_ALL}>All teams</SelectItem>
                  {teamChoices.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t === "Unassigned" ? "Unassigned (no team on AR product)" : t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Label>Product</Label>
              <Select
                value={filters.productId}
                onValueChange={(v) => {
                  if (v == null) return;
                  setFilters((f) => ({ ...f, productId: v }));
                }}
              >
                <SelectTrigger className="mt-1 w-full min-w-0">
                  <SelectValue placeholder="All products" />
                </SelectTrigger>
                <SelectContent className="max-h-[min(24rem,70vh)] overflow-y-auto">
                  <SelectItem value={ORG_ALL}>All products</SelectItem>
                  {productChoices.map((p) => (
                    <SelectItem key={p.id} value={p.id} title={p.name}>
                      <span className="truncate">{p.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {catalogError ? (
            <p className="text-muted-foreground text-sm">
              Filter dropdowns: {catalogError} (division / team / product lists unavailable).
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-4">
              <Label>Client (contains)</Label>
              <Input
                className="mt-1"
                value={filters.client}
                onChange={(e) => setFilters((f) => ({ ...f, client: e.target.value }))}
              />
            </div>
            <div className="md:col-span-4">
              <Label>Master product (contains)</Label>
              <Input
                className="mt-1"
                value={filters.masterProduct}
                onChange={(e) => setFilters((f) => ({ ...f, masterProduct: e.target.value }))}
              />
            </div>
            <div className="md:col-span-4">
              <Label>Contract (contains)</Label>
              <Input
                className="mt-1"
                value={filters.contractNumber}
                onChange={(e) => setFilters((f) => ({ ...f, contractNumber: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-3">
              <Label>Counterpart ref (exact)</Label>
              <Input
                className="mt-1"
                value={filters.counterpartReference}
                onChange={(e) => setFilters((f) => ({ ...f, counterpartReference: e.target.value }))}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Signed from</Label>
              <Input
                className="mt-1"
                type="date"
                value={filters.signedFrom}
                onChange={(e) => setFilters((f) => ({ ...f, signedFrom: e.target.value }))}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Signed to</Label>
              <Input
                className="mt-1"
                type="date"
                value={filters.signedTo}
                onChange={(e) => setFilters((f) => ({ ...f, signedTo: e.target.value }))}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Import ID</Label>
              <Input
                className="mt-1"
                value={filters.importId}
                onChange={(e) => setFilters((f) => ({ ...f, importId: e.target.value }))}
              />
            </div>
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          {data ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">AR lines (filtered total)</div>
                <div className="text-lg font-semibold tabular-nums">{data.summary.lineCount}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">Planned AR (sum)</div>
                <div className="text-lg font-semibold tabular-nums">{formatEuro(data.summary.totalArEur)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">Invoiced (matched sum)</div>
                <div className="text-lg font-semibold tabular-nums">
                  {formatEuro(data.summary.totalInvoicedEur)}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">Lines with / without SAP rows</div>
                <div className="text-lg font-semibold tabular-nums">
                  {data.summary.linesWithInvoicing} / {data.summary.linesWithoutInvoicing}
                </div>
              </div>
            </div>
          ) : null}

          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Page {Math.floor(offset / PAGE_LIMIT) + 1} — showing {data?.lines.length ?? 0} of {total} lines
              (limit {PAGE_LIMIT}).
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canPrev || loading}
                onClick={() => void fetchPage(Math.max(0, offset - PAGE_LIMIT))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canNext || loading}
                onClick={() => void fetchPage(offset + PAGE_LIMIT)}
              >
                Next
              </Button>
            </div>
          </div>

          {groups.map((g) => {
            const groupDelta = g.planned - g.invoiced;
            return (
              <div
                key={g.key}
                className="border-border bg-card overflow-hidden rounded-lg border shadow-sm"
              >
                <div className="bg-muted/40 border-b px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {g.counterpartReference ?? "(no counterpart reference)"}
                        {g.clientNames.length > 0 ? (
                          <span className="text-muted-foreground font-normal">
                            {" · "}
                            {g.clientNames.join(" / ")}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        {g.lines.length} AR line{g.lines.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm tabular-nums">
                      <div>
                        <span className="text-muted-foreground">Planned </span>
                        <span className="font-semibold">{formatEuro(g.planned)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Invoiced </span>
                        <span className="font-semibold">{formatEuro(g.invoiced)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Δ </span>
                        <span
                          className={cn(
                            "font-semibold",
                            groupDelta > 0 ? "text-amber-700 dark:text-amber-400" : ""
                          )}
                        >
                          {formatEuro(groupDelta)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-6" />
                        <TableHead>SF product</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Allocation entity</TableHead>
                        <TableHead className="text-right">Planned</TableHead>
                        <TableHead className="text-right">Invoiced</TableHead>
                        <TableHead className="text-right">Δ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.lines.map((line) => {
                        const lineDelta = line.amountEur - line.invoicedTotalEur;
                        const isOpen = expanded.has(line.id);
                        const isUnmatched = isUnmatchedLine(line);
                        return (
                          <Fragment key={line.id}>
                            <TableRow
                              onClick={() => toggleExpand(line.id)}
                              className={cn(
                                "hover:bg-muted/50 cursor-pointer",
                                isUnmatched && "bg-amber-50/60 dark:bg-amber-950/20"
                              )}
                              aria-expanded={isOpen}
                            >
                              <TableCell className="text-muted-foreground select-none">
                                {isOpen ? "▾" : "▸"}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "max-w-[260px] truncate",
                                  isUnmatched && "text-amber-800 italic dark:text-amber-300"
                                )}
                                title={line.sfProductName}
                              >
                                {line.sfProductName}
                              </TableCell>
                              <TableCell
                                className="max-w-[320px] truncate text-xs"
                                title={line.description ?? ""}
                              >
                                {isUnmatched ? (
                                  <span className="text-muted-foreground">
                                    SAP désignations: {line.description ?? "—"}
                                  </span>
                                ) : (
                                  (line.description ?? "—")
                                )}
                              </TableCell>
                              <TableCell
                                className="max-w-[220px] truncate text-xs"
                                title={line.allocationEntityName ?? ""}
                              >
                                {line.allocationEntityName ? (
                                  <>
                                    {line.allocationEntityName}
                                    {isUnmatched ? (
                                      <span
                                        className="text-muted-foreground ml-1"
                                        title={`Mapped via SAP designation (no AR line item) → ${line.allocationEntityId}`}
                                      >
                                        (mapped)
                                      </span>
                                    ) : null}
                                  </>
                                ) : isUnmatched ? (
                                  <span className="text-red-700 dark:text-red-400">
                                    (designation not mapped)
                                  </span>
                                ) : (
                                  "—"
                                )}
                                {line.importWarning ? (
                                  <span
                                    className="ml-1 text-amber-700 dark:text-amber-400"
                                    title={line.importWarning}
                                  >
                                    ⚠
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {isUnmatched ? "—" : formatEuro(line.amountEur)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatEuro(line.invoicedTotalEur)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-right tabular-nums",
                                  lineDelta > 0 ? "text-amber-700 dark:text-amber-400" : "",
                                  isUnmatched && "text-red-700 dark:text-red-400"
                                )}
                              >
                                {formatEuro(lineDelta)}
                              </TableCell>
                            </TableRow>
                            {isOpen ? (
                              <TableRow className="bg-muted/20 hover:bg-muted/20">
                                <TableCell colSpan={7} className="p-0">
                                  <div className="overflow-x-auto px-4 py-3">
                                    <div className="text-muted-foreground mb-2 text-xs">
                                      {isUnmatched ? (
                                        <>
                                          SAP rows with{" "}
                                          <span className="font-mono">
                                            ext_doc_ref = {line.counterpartReference}
                                          </span>{" "}
                                          that match no AR line item (FK or SO + product label)
                                          {" · "}
                                          {line.invoices.length} SAP row
                                          {line.invoices.length === 1 ? "" : "s"}
                                        </>
                                      ) : (
                                        <>
                                          Contract{" "}
                                          <span className="font-mono">{line.contractNumber}</span>
                                          {" · line "}
                                          <span className="font-mono">{line.lineItemNumber}</span>
                                          {line.year ? ` · year ${line.year}` : ""}
                                          {line.invoices.length === 0
                                            ? " · no invoices linked"
                                            : ` · ${line.invoices.length} SAP row${line.invoices.length === 1 ? "" : "s"}`}
                                        </>
                                      )}
                                    </div>
                                    {line.invoices.length === 0 ? (
                                      <p className="text-muted-foreground text-sm">
                                        No SAP client invoice rows linked yet.
                                      </p>
                                    ) : (
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Invoice</TableHead>
                                            <TableHead>Doc. vente</TableHead>
                                            <TableHead>Désignation SAP</TableHead>
                                            <TableHead>Product (invoiced)</TableHead>
                                            <TableHead>Division</TableHead>
                                            <TableHead>Subdiv.</TableHead>
                                            <TableHead>Family</TableHead>
                                            <TableHead className="text-right">Period</TableHead>
                                            <TableHead className="text-right">EUR</TableHead>
                                            <TableHead>Link</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {line.invoices.map((inv, i) => (
                                            <TableRow
                                              key={`${line.id}-${inv.sapInvoiceNr}-${inv.month}-${i}`}
                                            >
                                              <TableCell className="whitespace-nowrap font-mono text-xs">
                                                {inv.sapDocType}
                                              </TableCell>
                                              <TableCell className="whitespace-nowrap font-mono text-xs">
                                                {inv.sapInvoiceNr}
                                              </TableCell>
                                              <TableCell
                                                className="max-w-[140px] truncate text-xs"
                                                title={inv.sapSalesOrder ?? ""}
                                              >
                                                {inv.sapSalesOrder ?? "—"}
                                              </TableCell>
                                              <TableCell
                                                className="max-w-[200px] truncate text-xs"
                                                title={inv.sapDesignation ?? ""}
                                              >
                                                {inv.sapDesignation ?? "—"}
                                              </TableCell>
                                              <TableCell
                                                className="max-w-[180px] truncate text-xs"
                                                title={inv.invoicedProductName ?? ""}
                                              >
                                                {inv.invoicedProductName ?? "—"}
                                              </TableCell>
                                              <TableCell className="text-xs">
                                                {inv.division ?? "—"}
                                              </TableCell>
                                              <TableCell className="text-xs">
                                                {inv.subDivision ?? "—"}
                                              </TableCell>
                                              <TableCell className="text-xs">
                                                {inv.productFamily ?? "—"}
                                              </TableCell>
                                              <TableCell className="text-right tabular-nums text-xs">
                                                {inv.year}-{String(inv.month).padStart(2, "0")}
                                              </TableCell>
                                              <TableCell className="text-right tabular-nums text-xs font-medium">
                                                {formatEuro(inv.amountEur)}
                                              </TableCell>
                                              <TableCell className="text-xs">
                                                {inv.linkSource === "ar_entry_id" ? (
                                                  <span className="text-muted-foreground">AR id</span>
                                                ) : inv.linkSource === "heuristic" ? (
                                                  <span className="text-muted-foreground">Heuristic</span>
                                                ) : (
                                                  <span className="text-amber-700 dark:text-amber-400">
                                                    Unmatched
                                                  </span>
                                                )}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
