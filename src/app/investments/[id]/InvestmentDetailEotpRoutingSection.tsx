"use client";

import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  Waypoints,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { InvestmentDetailEotpTargetCombobox } from "@/app/investments/[id]/InvestmentDetailEotpTargetCombobox";
import {
  TABLE_HEAD_CLASS,
  TABLE_HEAD_ROW_BG,
  TABLE_HEAD_TOTAL_CLASS,
} from "@/app/investments/[id]/investment-detail-layout";
import {
  emptyDraft,
  eotpCashOut,
  eotpIsMainSapCode,
  eotpTotal,
  formatK,
} from "@/app/investments/[id]/investment-detail-helpers";
import type { EotpRoutingRow, MainEotpFromViewRow, RoutingDraft } from "@/app/investments/[id]/investment-detail-types";
import { useInvestmentIdParam } from "@/app/investments/[id]/use-investment-detail-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EotpTargetOption } from "@/lib/eotp-target-options";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

function routingDraftFromRow(r: EotpRoutingRow): RoutingDraft {
  return {
    year: String(r.year),
    eotp: r.eotp,
    eopLabel: r.eopLabel ?? "",
    internal: String(r.internalAmount),
    external: String(r.externalAmount),
    direct: String(r.directAmount),
    comment: r.comment ?? "",
  };
}

export function InvestmentDetailEotpRoutingSection({
  investmentId,
  mainSapEotpCode,
  filterYear,
  onChanged,
  initialRows,
  mainFromView,
  mainViewError,
  onMainFromViewChange,
}: {
  investmentId: string;
  mainSapEotpCode: string | null;
  filterYear: number;
  onChanged: () => void;
  initialRows: EotpRoutingRow[];
  mainFromView: MainEotpFromViewRow[];
  mainViewError: string | null;
  onMainFromViewChange: (rows: MainEotpFromViewRow[], error: string | null) => void;
}) {
  const [rows, setRows] = useState<EotpRoutingRow[]>(initialRows);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingNewRow, setSavingNewRow] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingRouting, setEditingRouting] = useState(false);
  const [routingEdits, setRoutingEdits] = useState<Record<string, RoutingDraft>>({});
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<RoutingDraft>(() => emptyDraft(new Date().getFullYear()));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  /** Expand/collapse detail (INT/EXT/DIR) for main EOTP rows from v_eotp_costs. */
  const [expandedMainKeys, setExpandedMainKeys] = useState<Set<string>>(() => new Set());
  const [eotpTargetOptions, setEotpTargetOptions] = useState<EotpTargetOption[]>([]);
  const [eotpTargetsLoading, setEotpTargetsLoading] = useState(false);
  const [eotpTargetsError, setEotpTargetsError] = useState<string | null>(null);
  const [pendingDeleteRoutingId, setPendingDeleteRoutingId] = useState<string | null>(null);

  const routingEditsRef = useRef(routingEdits);
  routingEditsRef.current = routingEdits;
  const patchTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const investmentIdDecoded = useInvestmentIdParam(investmentId);

  const displayRows = useMemo(
    () => rows.filter((r) => r.year === filterYear),
    [rows, filterYear]
  );

  const displayMainFromView = useMemo(
    () => mainFromView.filter((m) => m.year === filterYear),
    [mainFromView, filterYear]
  );

  const defaultYear = filterYear;

  useEffect(() => {
    return () => {
      for (const t of patchTimersRef.current.values()) clearTimeout(t);
      patchTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!editingRouting) {
      setEotpTargetOptions([]);
      setEotpTargetsError(null);
      return;
    }
    let cancelled = false;
    setEotpTargetsLoading(true);
    setEotpTargetsError(null);
    void (async () => {
      try {
        const q =
          mainSapEotpCode != null && mainSapEotpCode.trim() !== ""
            ? `?mainSapEotp=${encodeURIComponent(mainSapEotpCode.trim())}`
            : "";
        const res = await fetch(`/api/eotp-routing-target-options${q}`);
        const payload = (await res.json().catch(() => null)) as unknown;
        if (cancelled) return;
        if (!res.ok) {
          const msg =
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof (payload as { error: unknown }).error === "string"
              ? (payload as { error: string }).error
              : `Could not load EOTP targets (${res.status}).`;
          setEotpTargetOptions([]);
          setEotpTargetsError(msg);
          return;
        }
        if (!Array.isArray(payload)) {
          setEotpTargetOptions([]);
          setEotpTargetsError("Invalid response from EOTP targets API.");
          return;
        }
        setEotpTargetOptions(payload);
        setEotpTargetsError(null);
      } catch (e) {
        if (!cancelled) {
          setEotpTargetOptions([]);
          setEotpTargetsError(e instanceof Error ? e.message : "Network error loading EOTP targets.");
        }
      } finally {
        if (!cancelled) setEotpTargetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editingRouting, mainSapEotpCode]);

  useEffect(() => {
    if (!editingRouting) setPendingDeleteRoutingId(null);
  }, [editingRouting]);

  const pendingDeleteRow = useMemo(
    () =>
      pendingDeleteRoutingId
        ? (rows.find((r) => r.id === pendingDeleteRoutingId) ?? null)
        : null,
    [pendingDeleteRoutingId, rows]
  );

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMainExpanded = (key: string) => {
    setExpandedMainKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const loadMainFromView = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/eotp-main-from-view`
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        const msg =
          typeof errBody?.message === "string"
            ? errBody.message
            : typeof errBody?.error === "string"
              ? errBody.error
              : null;
        if (res.status === 503 && msg) {
          onMainFromViewChange([], msg);
        } else if (!msg) {
          onMainFromViewChange([], `Could not load main EOTP from view (${res.status}).`);
        } else {
          onMainFromViewChange([], msg);
        }
        return;
      }
      const data = (await res.json()) as unknown;
      onMainFromViewChange(Array.isArray(data) ? (data as MainEotpFromViewRow[]) : [], null);
    } catch {
      onMainFromViewChange([], "Network error loading v_eotp_costs main row.");
    }
  }, [investmentIdDecoded, onMainFromViewChange]);

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

  const beginEditRouting = () => {
    const init: Record<string, RoutingDraft> = {};
    for (const r of displayRows) {
      init[r.id] = routingDraftFromRow(r);
    }
    setRoutingEdits(init);
    setNewDraft(emptyDraft(defaultYear));
    setAddingNew(false);
    setEditingRouting(true);
  };

  const cancelEditRouting = () => {
    for (const t of patchTimersRef.current.values()) clearTimeout(t);
    patchTimersRef.current.clear();
    setEditingRouting(false);
    setRoutingEdits({});
    setAddingNew(false);
    setNewDraft(emptyDraft(defaultYear));
  };

  const mergeRowFromServer = useCallback((updated: EotpRoutingRow) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setRoutingEdits((prev) => ({
      ...prev,
      [updated.id]: routingDraftFromRow(updated),
    }));
  }, []);

  const flushPatchRow = useCallback(
    async (id: string) => {
      const edit = routingEditsRef.current[id];
      if (!edit) return;
      const internalAmount = Number.parseFloat(String(edit.internal).replace(",", "."));
      const externalAmount = Number.parseFloat(String(edit.external).replace(",", "."));
      const directAmount = Number.parseFloat(String(edit.direct).replace(",", "."));
      if (
        !edit.eotp.trim() ||
        !Number.isFinite(internalAmount) ||
        !Number.isFinite(externalAmount) ||
        !Number.isFinite(directAmount)
      ) {
        return;
      }
      setSaving(true);
      try {
        const res = await fetch(
          `/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/eotp-routing/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eotp: edit.eotp.trim(),
              eopLabel: edit.eopLabel.trim() || null,
              internalAmount,
              externalAmount,
              directAmount,
              comment: edit.comment.trim() || null,
            }),
          }
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert((j as { error?: string }).error ?? "Could not save routing");
          return;
        }
        const updated = (await res.json()) as EotpRoutingRow;
        mergeRowFromServer(updated);
        await loadMainFromView();
        onChanged();
      } finally {
        setSaving(false);
      }
    },
    [investmentIdDecoded, mergeRowFromServer, onChanged, loadMainFromView]
  );

  const schedulePatchRow = useCallback(
    (id: string) => {
      const existing = patchTimersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        patchTimersRef.current.delete(id);
        void flushPatchRow(id);
      }, 450);
      patchTimersRef.current.set(id, t);
    },
    [flushPatchRow]
  );

  const updateRoutingEdit = useCallback(
    (id: string, patch: Partial<RoutingDraft>) => {
      setRoutingEdits((prev) => {
        const cur = prev[id];
        if (!cur) return prev;
        return { ...prev, [id]: { ...cur, ...patch } };
      });
      schedulePatchRow(id);
    },
    [schedulePatchRow]
  );

  const saveNewRow = async () => {
    const year = Number.parseInt(newDraft.year, 10);
    const internalAmount = Number.parseFloat(String(newDraft.internal).replace(",", "."));
    const externalAmount = Number.parseFloat(String(newDraft.external).replace(",", "."));
    const directAmount = Number.parseFloat(String(newDraft.direct).replace(",", "."));
    if (
      !Number.isFinite(year) ||
      !newDraft.eotp.trim() ||
      !Number.isFinite(internalAmount) ||
      !Number.isFinite(externalAmount) ||
      !Number.isFinite(directAmount)
    ) {
      alert("Year, EOTP code and internal / external / direct amounts (EUR) are required.");
      return;
    }
    setSavingNewRow(true);
    try {
      const res = await fetch(`/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/eotp-routing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          eotp: newDraft.eotp.trim(),
          eopLabel: newDraft.eopLabel.trim() || null,
          internalAmount,
          externalAmount,
          directAmount,
          comment: newDraft.comment.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "Could not create routing");
        return;
      }
      const created = (await res.json()) as EotpRoutingRow;
      setRows((prev) => [...prev, created]);
      setRoutingEdits((prev) => ({ ...prev, [created.id]: routingDraftFromRow(created) }));
      setAddingNew(false);
      setNewDraft(emptyDraft(defaultYear));
      await loadMainFromView();
      onChanged();
    } finally {
      setSavingNewRow(false);
    }
  };

  const executeDeleteRouting = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(
        `/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/eotp-routing/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        alert("Could not delete");
        return;
      }
      setPendingDeleteRoutingId(null);
      setRoutingEdits((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
      await loadMainFromView();
      onChanged();
    } finally {
      setDeletingId(null);
    }
  };

  const detailBlock = (
    internal: number,
    external: number,
    direct: number,
    comment: string | null,
    extra?: ReactNode
  ) => (
    <div className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
      <span>
        Internal <span className="text-foreground tabular-nums">{formatK(internal)}</span>
      </span>
      <span>
        External <span className="text-foreground tabular-nums">{formatK(external)}</span>
      </span>
      <span>
        Direct <span className="text-foreground tabular-nums">{formatK(direct)}</span>
      </span>
      <span>
        Cash out{" "}
        <span className="text-foreground tabular-nums">{formatK(eotpCashOut(external, direct))}</span>
      </span>
      {comment?.trim() ? (
        <span className="col-span-2 sm:col-span-4">
          Comment: <span className="text-foreground">{comment}</span>
        </span>
      ) : null}
      {extra}
    </div>
  );

  const viewColCount = 5;
  /** Edit mode: EOTP, Internal, External, Direct, Total, Cash out, Actions (no Label column). */
  const editColCount = 7;

  const showRoutingTable =
    !loadError && (editingRouting || displayRows.length > 0 || addingNew);

  /** Read-only: show when there are no exception lines for this year, without duplicating other empty states. */
  const showNoExceptionRoutingHint =
    !loadError &&
    !loading &&
    !editingRouting &&
    displayRows.length === 0 &&
    !(rows.length === 0 && displayMainFromView.length === 0) &&
    !(rows.length > 0 && displayRows.length === 0 && displayMainFromView.length === 0);

  return (
    <>
    <Card className={PANEL_CARD_CLASS}>
      <CardHeader className="pb-2">
        <div className="flex min-w-0 gap-2">
          <Waypoints
            className="text-muted-foreground mt-0.5 size-5 shrink-0 stroke-[1.5]"
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-foreground text-base font-semibold leading-tight">
                EOTP routing
              </span>
              {mainSapEotpCode?.trim() ? (
                <span
                  className="inline-flex shrink-0 items-center rounded-full border border-[color:var(--primary-blue)]/30 bg-[color:var(--primary-blue)]/[0.08] px-2.5 py-0.5 font-mono text-sm tabular-nums dark:bg-[color:var(--primary-blue)]/[0.14]"
                  title="Investment main SAP EOTP"
                >
                  {mainSapEotpCode.trim()}
                </span>
              ) : (
                <span className="text-muted-foreground text-sm">—</span>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? (
          <p className="text-destructive text-sm">{loadError}</p>
        ) : null}
        {mainViewError ? (
          <p className="text-amber-700 dark:text-amber-500/90 text-sm">{mainViewError}</p>
        ) : null}

        {displayMainFromView.length > 0 ? (
          <div className="border-border bg-muted/30 text-muted-foreground rounded-lg border shadow-sm">
            <div className="overflow-x-auto px-1 pb-1 pt-1">
              <Table>
                <TableHeader
                  className={cn(
                    "bg-muted/50 [&_tr]:border-border/60 text-muted-foreground",
                    TABLE_HEAD_ROW_BG
                  )}
                >
                  <TableRow>
                    <TableHead className={cn(TABLE_HEAD_CLASS, "min-w-[100px]")}>EOTP</TableHead>
                    <TableHead
                      className={cn(TABLE_HEAD_CLASS, "min-w-[120px]")}
                      title="SAP EOTP label from the view"
                    >
                      Label
                    </TableHead>
                    <TableHead className={cn(TABLE_HEAD_TOTAL_CLASS, "w-[88px] text-right")}>
                      Total
                    </TableHead>
                    <TableHead className={cn(TABLE_HEAD_TOTAL_CLASS, "w-[88px] text-right")}>
                      Cash out
                    </TableHead>
                    <TableHead className={cn(TABLE_HEAD_CLASS, "w-[72px] text-right")} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayMainFromView.map((m) => {
                    const rowKey = `main-${m.year}-${m.eotp ?? "x"}`;
                    const total = eotpTotal(m.internalCost, m.externalCost, m.directCost);
                    const cashOut = eotpCashOut(m.externalCost, m.directCost);
                    const mainOpen = expandedMainKeys.has(rowKey);
                    return (
                      <Fragment key={rowKey}>
                        <TableRow className="hover:bg-muted/40 border-border/50 border-b-0">
                          <TableCell className="text-xs">
                            {m.eotp && eotpIsMainSapCode(m.eotp, mainSapEotpCode) ? (
                              <span
                                className="inline-block rounded-full border border-[color:var(--primary-blue)]/25 bg-[color:var(--primary-blue)]/[0.06] px-2.5 py-0.5 font-mono tabular-nums dark:bg-[color:var(--primary-blue)]/[0.12]"
                                title="Main SAP EOTP (v_eotp_costs)"
                              >
                                {m.eotp}
                              </span>
                            ) : (
                              <span className="font-mono text-foreground/90">{m.eotp ?? "—"}</span>
                            )}
                          </TableCell>
                          <TableCell
                            className="max-w-[220px] truncate text-xs text-foreground/85"
                            title={m.eopLabel ?? ""}
                          >
                            {m.eopLabel ?? "—"}
                          </TableCell>
                          <TableCell className="text-foreground/90 text-right text-sm font-medium tabular-nums text-[color:var(--primary-blue)]">
                            {formatK(total)}
                          </TableCell>
                          <TableCell className="text-foreground/90 text-right text-sm tabular-nums">
                            {formatK(cashOut)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-muted-foreground"
                              onClick={() => toggleMainExpanded(rowKey)}
                              aria-expanded={mainOpen}
                            >
                              {mainOpen ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                              <span className="sr-only">Internal, external, direct</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                        {mainOpen ? (
                          <TableRow className="bg-muted/35 hover:bg-muted/35 border-border/40 border-t-0">
                            <TableCell colSpan={viewColCount} className="py-3">
                              {detailBlock(
                                m.internalCost,
                                m.externalCost,
                                m.directCost,
                                null
                              )}
                              <p className="text-muted-foreground mt-2 text-[11px]">
                                Remainder on the main SAP line after exception routing (same buckets as
                                routing detail rows).
                              </p>
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
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-foreground text-sm font-semibold tracking-tight">Exception Routing</h3>
          {!loadError ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {!editingRouting ? (
                <Button type="button" size="sm" variant="outline" onClick={beginEditRouting}>
                  Edit routing
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={cancelEditRouting}>
                  Cancel
                </Button>
              )}
            </div>
          ) : null}
        </div>

        {showNoExceptionRoutingHint ? (
          <p className="text-muted-foreground text-xs">
            No exception routing for {filterYear}. Spend stays on the main SAP EOTP line above.
          </p>
        ) : null}

        {editingRouting && eotpTargetsError ? (
          <p className="text-destructive text-xs">{eotpTargetsError}</p>
        ) : null}
        {editingRouting &&
        !eotpTargetsLoading &&
        !eotpTargetsError &&
        eotpTargetOptions.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No EOTP lines to choose from. Run{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">npm run db:seed:eotp</code>{" "}
            to load <span className="font-mono">eotp_definition</span>.
          </p>
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
            displayMainFromView.length === 0 &&
            !editingRouting ? (
              <p className="text-muted-foreground text-sm">No routing rows for this investment.</p>
            ) : null}
            {rows.length > 0 &&
            displayRows.length === 0 &&
            !editingRouting &&
            displayMainFromView.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No routing rows for year {filterYear}. Choose another year in the investment panel.
              </p>
            ) : null}
            {showRoutingTable ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className={cn("bg-muted/40 [&_tr]:border-border", TABLE_HEAD_ROW_BG)}>
                    <TableRow>
                      <TableHead className={cn(TABLE_HEAD_CLASS, "min-w-[100px]")}>EOTP</TableHead>
                      {!editingRouting ? (
                        <TableHead
                          className={cn(TABLE_HEAD_CLASS, "min-w-[120px]")}
                          title="SAP EOTP name from the allocation entity"
                        >
                          Label
                        </TableHead>
                      ) : null}
                      {editingRouting ? (
                        <>
                          <TableHead className={cn(TABLE_HEAD_CLASS, "w-[88px] text-right")}>
                            Internal
                          </TableHead>
                          <TableHead className={cn(TABLE_HEAD_CLASS, "w-[88px] text-right")}>
                            External
                          </TableHead>
                          <TableHead className={cn(TABLE_HEAD_CLASS, "w-[88px] text-right")}>
                            Direct
                          </TableHead>
                        </>
                      ) : null}
                      <TableHead className={cn(TABLE_HEAD_TOTAL_CLASS, "w-[88px] text-right")}>
                        Total
                      </TableHead>
                      <TableHead className={cn(TABLE_HEAD_TOTAL_CLASS, "w-[88px] text-right")}>
                        Cash out
                      </TableHead>
                      {editingRouting ? (
                        <TableHead className={cn(TABLE_HEAD_CLASS, "w-[100px] min-w-[100px] text-right")} />
                      ) : (
                        <TableHead className={cn(TABLE_HEAD_CLASS, "w-[72px] text-right")} />
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {editingRouting && !addingNew ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell className="py-2" colSpan={editColCount - 1} />
                        <TableCell className="py-2 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={saving || savingNewRow}
                            onClick={() => {
                              setNewDraft(emptyDraft(defaultYear));
                              setAddingNew(true);
                            }}
                          >
                            <Plus className="size-3.5" />
                            Add routing line
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {editingRouting && addingNew ? (
                      <>
                        <TableRow className="border-border/80 bg-muted/45 hover:bg-muted/45 border-y border-dashed shadow-[inset_0_1px_0_0_hsl(var(--border))]">
                          <TableCell className="py-2.5 align-middle">
                            <InvestmentDetailEotpTargetCombobox
                              valueEotp={newDraft.eotp}
                              valueLabel={newDraft.eopLabel}
                              options={eotpTargetOptions}
                              loading={eotpTargetsLoading}
                              disabled={savingNewRow}
                              onSelect={(code, label) =>
                                setNewDraft((d) => ({ ...d, eotp: code, eopLabel: label }))
                              }
                            />
                          </TableCell>
                          <TableCell className="py-2.5 align-middle">
                            <div className="flex justify-end">
                              <Input
                                className="h-8 max-w-[100px] text-right text-sm tabular-nums"
                                inputMode="decimal"
                                placeholder="Internal"
                                value={newDraft.internal}
                                disabled={savingNewRow}
                                onChange={(e) => setNewDraft((d) => ({ ...d, internal: e.target.value }))}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 align-middle">
                            <div className="flex justify-end">
                              <Input
                                className="h-8 max-w-[100px] text-right text-sm tabular-nums"
                                inputMode="decimal"
                                placeholder="External"
                                value={newDraft.external}
                                disabled={savingNewRow}
                                onChange={(e) => setNewDraft((d) => ({ ...d, external: e.target.value }))}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 align-middle">
                            <div className="flex justify-end">
                              <Input
                                className="h-8 max-w-[100px] text-right text-sm tabular-nums"
                                inputMode="decimal"
                                placeholder="Direct"
                                value={newDraft.direct}
                                disabled={savingNewRow}
                                onChange={(e) => setNewDraft((d) => ({ ...d, direct: e.target.value }))}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground py-2.5 text-right text-sm tabular-nums">
                            {formatK(
                              eotpTotal(
                                Number.parseFloat(newDraft.internal.replace(",", ".")) || 0,
                                Number.parseFloat(newDraft.external.replace(",", ".")) || 0,
                                Number.parseFloat(newDraft.direct.replace(",", ".")) || 0
                              )
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground py-2.5 text-right text-sm tabular-nums">
                            {formatK(
                              eotpCashOut(
                                Number.parseFloat(newDraft.external.replace(",", ".")) || 0,
                                Number.parseFloat(newDraft.direct.replace(",", ".")) || 0
                              )
                            )}
                          </TableCell>
                          <TableCell className="py-2.5 text-right align-middle">
                            <div className="flex flex-nowrap items-center justify-end gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-muted-foreground shrink-0"
                                disabled={savingNewRow}
                                onClick={() => {
                                  setNewDraft(emptyDraft(defaultYear));
                                  setAddingNew(false);
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                className="shrink-0"
                                disabled={savingNewRow}
                                onClick={() => void saveNewRow()}
                              >
                                {savingNewRow ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-border/80 bg-muted/45 hover:bg-muted/45 border-dashed shadow-[inset_0_1px_0_0_hsl(var(--border))]">
                          <TableCell colSpan={editColCount} className="pt-0 pb-3">
                            <div className="space-y-1.5">
                              <Label className="text-muted-foreground text-xs">Comment</Label>
                              <Textarea
                                className="min-h-[52px] text-sm"
                                placeholder="Optional"
                                value={newDraft.comment}
                                disabled={savingNewRow}
                                onChange={(e) => setNewDraft((d) => ({ ...d, comment: e.target.value }))}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      </>
                    ) : null}
                    {displayRows.map((r) => {
                      const rowId = r.id;
                      const edit = routingEdits[r.id];
                      const total = eotpTotal(r.internalAmount, r.externalAmount, r.directAmount);
                      const cashOut = eotpCashOut(r.externalAmount, r.directAmount);
                      const open = expandedIds.has(rowId);
                      const intVal = edit
                        ? Number.parseFloat(edit.internal.replace(",", ".")) || 0
                        : r.internalAmount;
                      const extVal = edit
                        ? Number.parseFloat(edit.external.replace(",", ".")) || 0
                        : r.externalAmount;
                      const dirVal = edit
                        ? Number.parseFloat(edit.direct.replace(",", ".")) || 0
                        : r.directAmount;
                      const totalLive = eotpTotal(intVal, extVal, dirVal);
                      const cashLive = eotpCashOut(extVal, dirVal);

                      return (
                        <Fragment key={r.id}>
                          <TableRow>
                            {!editingRouting ? (
                              <>
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
                                <TableCell className="max-w-[200px] truncate text-xs" title={r.eopLabel ?? ""}>
                                  {r.eopLabel ?? "—"}
                                </TableCell>
                                <TableCell className="text-right text-sm font-medium tabular-nums text-[color:var(--primary-blue)]">
                                  {formatK(total)}
                                </TableCell>
                                <TableCell className="text-right text-sm tabular-nums">{formatK(cashOut)}</TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => toggleExpanded(rowId)}
                                    aria-expanded={open}
                                  >
                                    {open ? (
                                      <ChevronDown className="size-4" />
                                    ) : (
                                      <ChevronRight className="size-4" />
                                    )}
                                    <span className="sr-only">Details</span>
                                  </Button>
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="align-middle">
                                  <InvestmentDetailEotpTargetCombobox
                                    valueEotp={edit?.eotp ?? ""}
                                    valueLabel={edit?.eopLabel ?? ""}
                                    options={eotpTargetOptions}
                                    loading={eotpTargetsLoading}
                                    disabled={saving}
                                    onSelect={(code, label) =>
                                      updateRoutingEdit(r.id, { eotp: code, eopLabel: label })
                                    }
                                  />
                                </TableCell>
                                <TableCell className="align-middle">
                                  <div className="flex justify-end">
                                    <Input
                                      className="h-8 max-w-[100px] text-right text-sm tabular-nums"
                                      inputMode="decimal"
                                      value={edit?.internal ?? ""}
                                      disabled={saving}
                                      onChange={(e) =>
                                        updateRoutingEdit(r.id, { internal: e.target.value })
                                      }
                                    />
                                  </div>
                                </TableCell>
                                <TableCell className="align-middle">
                                  <div className="flex justify-end">
                                    <Input
                                      className="h-8 max-w-[100px] text-right text-sm tabular-nums"
                                      inputMode="decimal"
                                      value={edit?.external ?? ""}
                                      disabled={saving}
                                      onChange={(e) =>
                                        updateRoutingEdit(r.id, { external: e.target.value })
                                      }
                                    />
                                  </div>
                                </TableCell>
                                <TableCell className="align-middle">
                                  <div className="flex justify-end">
                                    <Input
                                      className="h-8 max-w-[100px] text-right text-sm tabular-nums"
                                      inputMode="decimal"
                                      value={edit?.direct ?? ""}
                                      disabled={saving}
                                      onChange={(e) =>
                                        updateRoutingEdit(r.id, { direct: e.target.value })
                                      }
                                    />
                                  </div>
                                </TableCell>
                                <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                                  {formatK(totalLive)}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                                  {formatK(cashLive)}
                                </TableCell>
                                <TableCell className="text-right align-middle">
                                  <div className="flex flex-nowrap items-center justify-end gap-0.5">
                                    {saving ? (
                                      <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                                    ) : null}
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2"
                                      onClick={() => toggleExpanded(rowId)}
                                      aria-expanded={expandedIds.has(rowId)}
                                      aria-label="Comment"
                                    >
                                      {expandedIds.has(rowId) ? (
                                        <ChevronDown className="size-4" />
                                      ) : (
                                        <ChevronRight className="size-4" />
                                      )}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2"
                                      disabled={deletingId === r.id || saving}
                                      onClick={() => setPendingDeleteRoutingId(r.id)}
                                      aria-label="Delete routing row"
                                    >
                                      {deletingId === r.id ? (
                                        <Loader2 className="size-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="size-4" />
                                      )}
                                    </Button>
                                  </div>
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                          {open && !editingRouting ? (
                            <TableRow key={`${r.id}-detail`} className="bg-muted/25 hover:bg-muted/25">
                              <TableCell colSpan={viewColCount} className="py-3">
                                {detailBlock(
                                  r.internalAmount,
                                  r.externalAmount,
                                  r.directAmount,
                                  r.comment
                                )}
                              </TableCell>
                            </TableRow>
                          ) : null}
                          {editingRouting && expandedIds.has(rowId) ? (
                            <TableRow className="bg-muted/25 hover:bg-muted/25">
                              <TableCell colSpan={editColCount} className="py-3">
                                <div className="space-y-1.5">
                                  <Label className="text-muted-foreground text-xs">Comment</Label>
                                  <Textarea
                                    className="min-h-[52px] text-sm"
                                    value={edit?.comment ?? ""}
                                    disabled={saving}
                                    onChange={(e) => updateRoutingEdit(r.id, { comment: e.target.value })}
                                  />
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
            ) : null}
            {!loading &&
            editingRouting &&
            displayRows.length === 0 &&
            !addingNew &&
            !loadError ? (
              <p className="text-muted-foreground text-sm">
                No exception lines for this year. Use Add routing line to create one.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>

    <Dialog
      open={pendingDeleteRoutingId !== null}
      onOpenChange={(open) => {
        if (!open) setPendingDeleteRoutingId(null);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Delete this routing row?</DialogTitle>
          <DialogDescription>
            {pendingDeleteRow
              ? `This will remove the exception line for EOTP ${pendingDeleteRow.eotp} (${pendingDeleteRow.year}). This cannot be undone.`
              : "This will remove this routing row. This cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={
              pendingDeleteRoutingId !== null && deletingId === pendingDeleteRoutingId
            }
            onClick={() => setPendingDeleteRoutingId(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={
              pendingDeleteRoutingId !== null && deletingId === pendingDeleteRoutingId
            }
            onClick={() => {
              const id = pendingDeleteRoutingId;
              if (!id) return;
              void executeDeleteRouting(id);
            }}
          >
            {pendingDeleteRoutingId !== null && deletingId === pendingDeleteRoutingId ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
