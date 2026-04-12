"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
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
import { cn } from "@/lib/utils";

export function InvestmentDetailEotpRoutingSection({
  investmentId,
  mainSapEotpCode,
  filterYear,
  onChanged,
  initialRows,
  initialMainFromView,
  initialMainViewError,
}: {
  investmentId: string;
  /** Main SAP EOTP code — rows with the same target EOTP are highlighted as the main bucket. */
  mainSapEotpCode: string | null;
  /** Same as budget / investment year filter. */
  filterYear: number;
  onChanged: () => void;
  initialRows: EotpRoutingRow[];
  initialMainFromView: MainEotpFromViewRow[];
  initialMainViewError: string | null;
}) {
  const [rows, setRows] = useState<EotpRoutingRow[]>(initialRows);
  const [mainFromView, setMainFromView] = useState<MainEotpFromViewRow[]>(initialMainFromView);
  const [mainViewError, setMainViewError] = useState<string | null>(initialMainViewError);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<RoutingDraft>(() => emptyDraft(new Date().getFullYear()));

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

  const loadMainFromView = useCallback(async () => {
    setMainViewError(null);
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
  }, [investmentIdDecoded]);

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
    <Card className={PANEL_CARD_CLASS}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Budget Summary {filterYear}</CardTitle>
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
            displayMainFromView.length === 0 &&
            editingId !== "new" ? (
              <p className="text-muted-foreground text-sm">No routing rows for this investment.</p>
            ) : null}
            {rows.length > 0 &&
            displayRows.length === 0 &&
            editingId !== "new" &&
            displayMainFromView.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No routing rows for year {filterYear}. Choose another year in the investment panel.
              </p>
            ) : null}
            {(displayMainFromView.length > 0 || displayRows.length > 0 || editingId === "new") && (
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
                    {displayMainFromView.map((m) => (
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
