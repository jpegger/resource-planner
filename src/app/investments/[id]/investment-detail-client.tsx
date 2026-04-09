"use client";

import { Check, ChevronsUpDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
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

type Investment = {
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

/** external + direct (matches v_eotp_costs.cash_out). */
function eotpCashOut(ext: number, dir: number) {
  return ext + dir;
}

/** internal + external + direct (matches v_eotp_costs.total_cost). */
function eotpTotal(int: number, ext: number, dir: number) {
  return int + ext + dir;
}

/** Shared fixed columns so amounts align; wide enough for INTERNAL / EXTERNAL / DIRECT / TOTAL labels. */
const FINANCIALS_4COL =
  "grid grid-cols-[4.75rem_4.75rem_4.75rem_3.75rem] items-baseline justify-items-end gap-x-2 text-xs tabular-nums sm:gap-x-3";

/** Bold figures in a soft grey–blue pill (budget header, assignment costs, footer). */
const FINANCIALS_PILL =
  "rounded-lg border border-[color:var(--primary-blue)]/20 bg-[color:var(--primary-blue)]/[0.06] px-2.5 py-1.5 font-bold text-foreground shadow-sm dark:border-[color:var(--primary-blue)]/30 dark:bg-[color:var(--primary-blue)]/[0.12]";

/** Column headers: same family as product field labels, slightly pronounced (uppercase / tracking). */
const TABLE_HEAD_CLASS =
  "text-muted-foreground text-xs font-medium uppercase tracking-wider";
const TABLE_HEAD_TOTAL_CLASS =
  "text-xs font-medium uppercase tracking-wider text-[color:var(--primary-blue)]";
/** Subtle band behind header rows so labels read like form field labels. */
const TABLE_HEAD_ROW_BG = "";

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

type EotpRoutingRow = {
  id: string;
  allocationEntityId?: string;
  year: number;
  eotp: string;
  eopLabel: string | null;
  internalAmount: number;
  externalAmount: number;
  directAmount: number;
  comment: string | null;
};

type RoutingDraft = {
  year: string;
  eotp: string;
  eopLabel: string;
  internal: string;
  external: string;
  direct: string;
  comment: string;
};

function emptyDraft(defaultYear: number): RoutingDraft {
  return {
    year: String(defaultYear),
    eotp: "",
    eopLabel: "",
    internal: "0",
    external: "0",
    direct: "0",
    comment: "",
  };
}

/** One row from v_eotp_costs where is_main_eotp = true (remainder on main SAP EOTP). */
type MainEotpFromViewRow = {
  year: number;
  eotp: string | null;
  eopLabel: string | null;
  internalCost: number;
  externalCost: number;
  directCost: number;
};

function eotpIsMainSapCode(rowEotp: string, mainSapEotp: string | null): boolean {
  if (!mainSapEotp?.trim()) return false;
  return rowEotp.trim().toLowerCase() === mainSapEotp.trim().toLowerCase();
}

function EotpRoutingSection({
  investmentId,
  mainSapEotpCode,
  filterYear,
  onChanged,
}: {
  investmentId: string;
  /** Main SAP EOTP code — rows with the same target EOTP are highlighted as the main bucket. */
  mainSapEotpCode: string | null;
  /** Same as budget / investment year filter — null = show all routing years. */
  filterYear: number | null;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<EotpRoutingRow[]>([]);
  const [mainFromView, setMainFromView] = useState<MainEotpFromViewRow[]>([]);
  const [mainViewError, setMainViewError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<RoutingDraft>(() => emptyDraft(new Date().getFullYear()));

  const investmentIdDecoded = useMemo(() => decodeURIComponent(investmentId.trim()), [investmentId]);

  const yearsInData = useMemo(
    () => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a),
    [rows]
  );

  const displayRows = useMemo(() => {
    if (filterYear === null) return rows;
    return rows.filter((r) => r.year === filterYear);
  }, [rows, filterYear]);

  const defaultYear = filterYear ?? yearsInData[0] ?? new Date().getFullYear();

  const loadMainFromView = useCallback(async () => {
    setMainViewError(null);
    try {
      const q =
        filterYear === null
          ? ""
          : `?year=${encodeURIComponent(String(filterYear))}`;
      const res = await fetch(
        `/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/eotp-main-from-view${q}`
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        const msg =
          typeof errBody?.message === "string"
            ? errBody.message
            : typeof errBody?.error === "string"
              ? errBody.error
              : null;
        setMainFromView([]);
        if (res.status === 503 && msg) {
          setMainViewError(msg);
        } else if (!msg) {
          setMainViewError(`Could not load main EOTP from view (${res.status}).`);
        } else {
          setMainViewError(msg);
        }
        return;
      }
      const data = (await res.json()) as unknown;
      setMainFromView(Array.isArray(data) ? (data as MainEotpFromViewRow[]) : []);
    } catch {
      setMainFromView([]);
      setMainViewError("Network error loading v_eotp_costs main row.");
    }
  }, [investmentIdDecoded, filterYear]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/eotp-routing`
      );
      if (!res.ok) {
        setRows([]);
        const errBody = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        const msg =
          typeof errBody?.message === "string"
            ? errBody.message
            : typeof errBody?.error === "string"
              ? errBody.error
              : null;
        setLoadError(
          msg ??
            (res.status === 404
              ? "Investment not found."
              : `Could not load routing (${res.status}).`)
        );
        return;
      }
      const data = (await res.json()) as unknown;
      setRows(Array.isArray(data) ? (data as EotpRoutingRow[]) : []);
    } catch {
      setRows([]);
      setLoadError("Network error loading routing.");
    } finally {
      setLoading(false);
    }
  }, [investmentIdDecoded]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadMainFromView();
  }, [loadMainFromView]);

  const startNew = () => {
    setEditingId("new");
    setDraft(emptyDraft(defaultYear));
  };

  const startEdit = (r: EotpRoutingRow) => {
    setEditingId(r.id);
    setDraft({
      year: String(r.year),
      eotp: r.eotp,
      eopLabel: r.eopLabel ?? "",
      internal: String(r.internalAmount),
      external: String(r.externalAmount),
      direct: String(r.directAmount),
      comment: r.comment ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const save = async () => {
    const year = Number.parseInt(draft.year, 10);
    const internalAmount = Number.parseFloat(String(draft.internal).replace(",", "."));
    const externalAmount = Number.parseFloat(String(draft.external).replace(",", "."));
    const directAmount = Number.parseFloat(String(draft.direct).replace(",", "."));
    if (
      !Number.isFinite(year) ||
      !draft.eotp.trim() ||
      !Number.isFinite(internalAmount) ||
      !Number.isFinite(externalAmount) ||
      !Number.isFinite(directAmount)
    ) {
      alert("Year, EOTP code and internal / external / direct amounts (EUR) are required.");
      return;
    }
    setSaving(true);
    try {
      if (editingId === "new") {
        const res = await fetch(`/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/eotp-routing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            year,
            eotp: draft.eotp.trim(),
            eopLabel: draft.eopLabel.trim() || null,
            internalAmount,
            externalAmount,
            directAmount,
            comment: draft.comment.trim() || null,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert((j as { error?: string }).error ?? "Could not create routing");
          return;
        }
      } else if (editingId) {
        const res = await fetch(
          `/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/eotp-routing/${encodeURIComponent(editingId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eotp: draft.eotp.trim(),
              eopLabel: draft.eopLabel.trim() || null,
              internalAmount,
              externalAmount,
              directAmount,
              comment: draft.comment.trim() || null,
            }),
          }
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert((j as { error?: string }).error ?? "Could not save routing");
          return;
        }
      }
      setEditingId(null);
      await load();
      await loadMainFromView();
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this routing row?")) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/eotp-routing/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        alert("Could not delete");
        return;
      }
      if (editingId === id) setEditingId(null);
      await load();
      await loadMainFromView();
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const draftForm = (opts: { isNew: boolean }) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className="space-y-1.5">
        <Label className="text-xs">Year</Label>
        <Input
          className="h-8 text-sm"
          type="number"
          value={draft.year}
          disabled={!opts.isNew || saving}
          onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5 lg:col-span-2">
        <Label className="text-xs">EOTP code</Label>
        <Input
          className="h-8 font-mono text-sm"
          value={draft.eotp}
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, eotp: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5 lg:col-span-3">
        <Label className="text-xs">Label</Label>
        <Input
          className="h-8 text-sm"
          value={draft.eopLabel}
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, eopLabel: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Internal (EUR)</Label>
        <Input
          className="h-8 text-sm"
          inputMode="decimal"
          value={draft.internal}
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, internal: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">External (EUR)</Label>
        <Input
          className="h-8 text-sm"
          inputMode="decimal"
          value={draft.external}
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, external: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Direct (EUR)</Label>
        <Input
          className="h-8 text-sm"
          inputMode="decimal"
          value={draft.direct}
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, direct: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-6">
        <Label className="text-xs">Comment</Label>
        <Textarea
          className="min-h-[52px] text-sm"
          value={draft.comment}
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
        />
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-6">
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">EOTP routing</CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={startNew}
            disabled={saving || editingId !== null}
          >
            <Plus className="mr-1 size-3.5" />
            Add row
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadError ? (
          <p className="text-destructive text-sm">{loadError}</p>
        ) : null}
        {mainViewError ? (
          <p className="text-amber-700 dark:text-amber-500/90 text-sm">{mainViewError}</p>
        ) : null}
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading routing…
          </div>
        ) : (
          <>
            {!loadError &&
            !loading &&
            rows.length === 0 &&
            mainFromView.length === 0 &&
            editingId !== "new" ? (
              <p className="text-muted-foreground text-sm">No routing rows for this investment.</p>
            ) : null}
            {rows.length > 0 &&
            displayRows.length === 0 &&
            editingId !== "new" &&
            mainFromView.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No routing rows for year {filterYear}. Choose &quot;All&quot; or another year in the investment
                panel.
              </p>
            ) : null}
            {(mainFromView.length > 0 || displayRows.length > 0 || editingId === "new") && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className={cn(TABLE_HEAD_ROW_BG, "[&_tr]:border-border")}>
                    <TableRow>
                      <TableHead className={cn(TABLE_HEAD_CLASS, "w-[72px]")}>Year</TableHead>
                      <TableHead className={cn(TABLE_HEAD_CLASS, "min-w-[100px]")}>EOTP</TableHead>
                      <TableHead className={cn(TABLE_HEAD_CLASS, "min-w-[120px]")}>Label</TableHead>
                      <TableHead className={cn(TABLE_HEAD_CLASS, "w-[88px] text-right")}>
                        Internal
                      </TableHead>
                      <TableHead className={cn(TABLE_HEAD_CLASS, "w-[88px] text-right")}>
                        External
                      </TableHead>
                      <TableHead className={cn(TABLE_HEAD_CLASS, "w-[88px] text-right")}>
                        Direct
                      </TableHead>
                      <TableHead className={cn(TABLE_HEAD_TOTAL_CLASS, "w-[88px] text-right")}>
                        Total
                      </TableHead>
                      <TableHead className={cn(TABLE_HEAD_CLASS, "w-[88px] text-right")}>
                        Cash out
                      </TableHead>
                      <TableHead className={cn(TABLE_HEAD_CLASS, "min-w-[100px]")}>Comment</TableHead>
                      <TableHead className={cn(TABLE_HEAD_CLASS, "w-[96px] text-right")}>
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mainFromView.map((m) => (
                      <TableRow
                        key={`main-view-${m.year}`}
                        className="bg-muted/40 text-muted-foreground"
                      >
                        <TableCell className="tabular-nums">{m.year}</TableCell>
                        <TableCell className="text-xs">
                          {m.eotp && eotpIsMainSapCode(m.eotp, mainSapEotpCode) ? (
                            <span
                              className="inline-block rounded-full border border-[color:var(--primary-blue)]/30 bg-[color:var(--primary-blue)]/[0.08] px-2.5 py-0.5 font-mono tabular-nums dark:bg-[color:var(--primary-blue)]/[0.14]"
                              title="Main SAP EOTP"
                            >
                              {m.eotp}
                            </span>
                          ) : (
                            <span className="font-mono">{m.eotp ?? "—"}</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate text-xs" title={m.eopLabel ?? ""}>
                          {m.eopLabel ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-foreground">
                          {formatK(m.internalCost)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-foreground">
                          {formatK(m.externalCost)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-foreground">
                          {formatK(m.directCost)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums font-medium text-[color:var(--primary-blue)]">
                          {formatK(eotpTotal(m.internalCost, m.externalCost, m.directCost))}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-foreground">
                          {formatK(eotpCashOut(m.externalCost, m.directCost))}
                        </TableCell>
                        <TableCell className="max-w-[200px] text-xs italic">
                          Remainder from <span className="font-mono">v_eotp_costs</span> (not editable)
                        </TableCell>
                        <TableCell className="text-right text-xs">—</TableCell>
                      </TableRow>
                    ))}
                    {displayRows.map((r) =>
                      editingId === r.id ? (
                        <TableRow key={r.id}>
                          <TableCell colSpan={10} className="bg-muted/30 p-3">
                            {draftForm({ isNew: false })}
                          </TableCell>
                        </TableRow>
                      ) : (
                        <TableRow key={r.id}>
                          <TableCell className="tabular-nums">{r.year}</TableCell>
                          <TableCell className="text-xs">
                            {eotpIsMainSapCode(r.eotp, mainSapEotpCode) ? (
                              <span
                                className="inline-block rounded-full border border-[color:var(--primary-blue)]/30 bg-[color:var(--primary-blue)]/[0.08] px-2.5 py-0.5 font-mono tabular-nums dark:bg-[color:var(--primary-blue)]/[0.14]"
                                title="Main SAP EOTP"
                              >
                                {r.eotp}
                              </span>
                            ) : (
                              <span className="font-mono">{r.eotp}</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate text-xs" title={r.eopLabel ?? ""}>
                            {r.eopLabel ?? "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatK(r.internalAmount)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatK(r.externalAmount)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatK(r.directAmount)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums font-medium text-[color:var(--primary-blue)]">
                            {formatK(eotpTotal(r.internalAmount, r.externalAmount, r.directAmount))}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatK(eotpCashOut(r.externalAmount, r.directAmount))}
                          </TableCell>
                          
                          <TableCell className="max-w-[160px] truncate text-xs" title={r.comment ?? ""}>
                            {r.comment ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              onClick={() => startEdit(r)}
                              disabled={saving || editingId !== null}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-destructive"
                              onClick={() => void remove(r.id)}
                              disabled={saving || editingId !== null}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    )}
                    {editingId === "new" ? (
                      <TableRow>
                        <TableCell colSpan={10} className="bg-muted/30 p-3">
                          {draftForm({ isNew: true })}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
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

export function InvestmentDetailClient({ investmentId }: { investmentId: string }) {
  const [investment, setInvestment] = useState<Investment | null>(null);
  const [initiatives, setInitiatives] = useState<BudgetInitiative[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedInitiative, setSelectedInitiative] = useState<BudgetInitiative | null>(null);
  const [allocations, setAllocations] = useState<AllocationDTO[]>([]);
  const [allocLoading, setAllocLoading] = useState(false);
  const [costByAllocId, setCostByAllocId] = useState<Record<string, AllocationCostBreakdown>>({});
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetYearOptions, setBudgetYearOptions] = useState<number[]>([]);
  const [routingYearOptions, setRoutingYearOptions] = useState<number[]>([]);

  const investmentIdDecoded = useMemo(() => decodeURIComponent(investmentId.trim()), [investmentId]);

  const loadRoutingYears = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/eotp-routing`
      );
      if (!res.ok) {
        setRoutingYearOptions([]);
        return;
      }
      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data) ? (data as { year: number }[]) : [];
      const ys = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
      setRoutingYearOptions(ys);
    } catch {
      setRoutingYearOptions([]);
    }
  }, [investmentIdDecoded]);

  const yearOptions = useMemo(() => {
    const s = new Set([...budgetYearOptions, ...routingYearOptions]);
    return [...s].sort((a, b) => b - a);
  }, [budgetYearOptions, routingYearOptions]);

  const loadBudget = useCallback(async () => {
    setBudgetLoading(true);
    try {
      const q =
        selectedYear === null
          ? ""
          : `?year=${encodeURIComponent(String(selectedYear))}`;
      const res = await fetch(`/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/budget${q}`);
      if (!res.ok) {
        setInitiatives([]);
        return;
      }
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        setInitiatives([]);
        return;
      }
      const list = Array.isArray(data) ? (data as BudgetInitiative[]) : [];
      setInitiatives(list);
      if (selectedYear === null) {
        const ys = [...new Set(list.map((i) => i.initiative_year))].sort((a, b) => b - a);
        setBudgetYearOptions(ys);
      }
    } finally {
      setBudgetLoading(false);
    }
  }, [investmentIdDecoded, selectedYear]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prodsRes = await fetch(`/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}`);
        const p = prodsRes.ok ? await prodsRes.json() : null;

        let resList: ResourceOption[] = [];
        try {
          const rRes = await fetch("/api/resources");
          if (rRes.ok) {
            const j = await rRes.json();
            resList = Array.isArray(j) ? j : [];
          }
        } catch {
          /* resources optional */
        }

        if (cancelled) return;
        setInvestment(p && typeof p === "object" && "id" in p ? (p as Investment) : null);
        setResources(resList);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [investmentIdDecoded]);

  useEffect(() => {
    void loadBudget();
  }, [loadBudget]);

  useEffect(() => {
    void loadRoutingYears();
  }, [loadRoutingYears]);

  useEffect(() => {
    setSelectedInitiative(null);
    setAllocations([]);
    setCostByAllocId({});
  }, [selectedYear]);

  const loadCostsForInitiative = useCallback(async (jiraKey: string) => {
    const res = await fetch(
      `/api/initiative-allocation-costs?initiativeId=${encodeURIComponent(jiraKey)}`
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

  if (!investment) {
    return (
      <div className="p-6">
        <Link href="/investments" className="text-primary text-sm underline">
          ← Back to investments
        </Link>
        <p className="text-muted-foreground mt-4 text-sm">Investment not found.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div>
        <Link
          href="/investments"
          className="text-primary inline-flex text-sm font-medium underline-offset-4 hover:underline"
        >
          ← Back to investments
        </Link>
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <CardTitle className="text-base">{investment.name}</CardTitle>
                {investment.productFamily ? (
                  <Badge variant="secondary">{investment.productFamily}</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <FieldReadonly label="Division" value={investment.division ?? ""} />
              <FieldReadonly label="Sub-division" value={investment.subDivision ?? ""} />
              <FieldReadonly label="Team" value={investment.team ?? ""} />
              <FieldReadonly label="SAP EOTP code" value={investment.sapEotpCode ?? ""} />
              <FieldReadonly label="SAP EOTP name" value={investment.sapEotpName ?? ""} />
              {investment.attractiveness != null ? (
                <FieldReadonly label="Attractiveness" value={String(investment.attractiveness)} />
              ) : null}
              {investment.competitiveness != null ? (
                <FieldReadonly label="Competitiveness" value={String(investment.competitiveness)} />
              ) : null}
            </CardContent>
          </Card>

          <div className="mt-5 flex w-full justify-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Label className="text-muted-foreground shrink-0 text-xs">Year</Label>
              <div className="flex flex-wrap justify-end gap-1.5">
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
          </div>

          <EotpRoutingSection
            investmentId={investmentId}
            mainSapEotpCode={investment.sapEotpCode}
            filterYear={selectedYear}
            onChanged={() => {
              void loadBudget();
              void loadRoutingYears();
            }}
          />

          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="pb-2">
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="min-w-0">
                  <CardTitle className="text-base">Budget by initiative</CardTitle>
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
                <p className="text-muted-foreground text-sm">No allocation costs for this investment.</p>
              ) : (
                <div className="flex min-h-0 flex-col">
                  <div
                    className={cn(
                      "border-border mb-1 grid w-full grid-cols-1 gap-3 border-b px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end",
                      TABLE_HEAD_ROW_BG
                    )}
                  >
                    <div className={cn(TABLE_HEAD_CLASS, "min-w-0")}>Initiative</div>
                    <div className={`${FINANCIALS_4COL} min-w-0 overflow-x-auto`}>
                      <span className={TABLE_HEAD_CLASS}>Internal</span>
                      <span className={TABLE_HEAD_CLASS}>External</span>
                      <span className={TABLE_HEAD_CLASS}>Direct</span>
                      <span className={TABLE_HEAD_TOTAL_CLASS}>Total</span>
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
                <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-end gap-4 sm:gap-6">
                    <h3 className="text-foreground shrink-0 text-sm font-medium">Allocations</h3>
                    <div className="flex min-w-0 flex-col gap-1 sm:items-end">
                      <div className={cn(FINANCIALS_4COL, "min-w-0 justify-items-end")}>
                        <span className={TABLE_HEAD_CLASS}>Internal</span>
                        <span className={TABLE_HEAD_CLASS}>External</span>
                        <span className={TABLE_HEAD_CLASS}>Direct</span>
                        <span className={TABLE_HEAD_TOTAL_CLASS}>Total</span>
                      </div>
                      {allocLoading ? (
                        <div className="text-muted-foreground flex min-h-[2.25rem] items-center justify-end gap-2 text-xs">
                          <Loader2 className="size-4 shrink-0 animate-spin" />
                          <span className="sm:hidden">Totals…</span>
                        </div>
                      ) : (
                        <div className={cn(FINANCIALS_4COL, FINANCIALS_PILL, "min-w-0 justify-items-end")}>
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
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void addAllocation()}
                    disabled={resources.length === 0}
                    className="bg-[#185FA5] shrink-0 text-white hover:bg-[#185FA5]/90"
                  >
                    + New
                  </Button>
                </div>
                <div className="border-border mt-5 border-t pt-5">
                  <Table>
                    <TableHeader className={cn(TABLE_HEAD_ROW_BG, "[&_tr]:border-border")}>
                      <TableRow>
                        <TableHead className={TABLE_HEAD_CLASS}>Percent</TableHead>
                        <TableHead className={TABLE_HEAD_CLASS}>Man days</TableHead>
                        <TableHead className={TABLE_HEAD_CLASS}>Resource</TableHead>
                        <TableHead className={cn(TABLE_HEAD_CLASS, "min-w-[7rem] text-right")}>
                          Cost
                        </TableHead>
                        <TableHead className={cn(TABLE_HEAD_CLASS, "w-28")} aria-label="Actions" />
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
                    <p className="text-muted-foreground mt-3 text-sm">No allocations yet.</p>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
