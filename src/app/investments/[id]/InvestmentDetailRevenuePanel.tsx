"use client";

import { Banknote, Loader2, Plus, Trash2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import { InvestmentDetailPanelHeading } from "@/app/investments/[id]/InvestmentDetailPanelHeading";
import {
  ALLOCATION_COST_CELL_INSET,
  GROUP_SUBTOTAL_COST_INSET,
  UNDER_GROUP_INDENT,
} from "@/app/investments/[id]/InvestmentDetailAllocationEditor";
import {
  TABLE_HEAD_CLASS,
  TABLE_HEAD_ROW_BG,
} from "@/app/investments/[id]/investment-detail-layout";
import { formatK } from "@/app/investments/[id]/investment-detail-helpers";
import type { InitiativeRevenueRowDTO } from "@/app/investments/[id]/investment-detail-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

const GROUP_ORDER = ["Mission", "Subscription"] as const;
type RevenueGroup = (typeof GROUP_ORDER)[number];

function isRevenueGroup(s: string): s is RevenueGroup {
  return (GROUP_ORDER as readonly string[]).includes(s);
}

type DraftRevenue = {
  clientId: string;
  type: RevenueGroup;
  amount: string;
  comment: string;
};

export function InvestmentDetailRevenuePanel({
  initiativeId,
  year: _year,
  onRevenueChanged,
}: {
  initiativeId: string | null;
  year: number;
  onRevenueChanged: () => void | Promise<void>;
}) {
  void _year;
  const [revenues, setRevenues] = useState<InitiativeRevenueRowDTO[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<DraftRevenue[]>([]);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRevenues = useCallback(async () => {
    if (!initiativeId) {
      setRevenues([]);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/revenues?initiativeId=${encodeURIComponent(initiativeId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        setRevenues([]);
        let errMsg = `Could not load revenue (${res.status})`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) errMsg = j.error;
        } catch {
          /* ignore */
        }
        setLoadError(errMsg);
        return;
      }
      const data = (await res.json()) as unknown;
      const list = Array.isArray(data) ? data : [];
      setRevenues(
        list.map((r) => {
          const row = r as Record<string, unknown>;
          const initiativeFromRow = row.initiativeId ?? row.initiative_id;
          return {
            id: String(row.id),
            initiativeId: String(initiativeFromRow ?? ""),
            type: row.type === "Subscription" ? "Subscription" : "Mission",
            amount: Number(row.amount ?? 0),
            comment: row.comment == null ? null : String(row.comment),
            createdOn:
              row.createdOn instanceof Date
                ? row.createdOn.toISOString()
                : String(row.createdOn ?? row.created_on ?? ""),
            modifiedOn:
              row.modifiedOn instanceof Date
                ? row.modifiedOn.toISOString()
                : String(row.modifiedOn ?? row.modified_on ?? ""),
          };
        })
      );
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    void loadRevenues();
  }, [loadRevenues]);

  useEffect(() => {
    setDrafts([]);
    setEditMode(false);
  }, [initiativeId, _year]);

  const patchImmediate = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      const res = await fetch(`/api/revenues/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        cache: "no-store",
      });
      if (res.ok) {
        await loadRevenues();
        onRevenueChanged();
      }
    },
    [loadRevenues, onRevenueChanged]
  );

  const totalEur = revenues.reduce((s, r) => s + r.amount, 0);
  const subtitle =
    revenues.length === 0
      ? "No lines"
      : `${revenues.length} line${revenues.length === 1 ? "" : "s"} · ${formatK(totalEur)}`;

  const subtotal = (g: RevenueGroup) =>
    revenues.filter((r) => r.type === g).reduce((s, r) => s + r.amount, 0);

  const addDraft = () => {
    setDrafts((d) => [
      ...d,
      {
        clientId: crypto.randomUUID(),
        type: "Mission",
        amount: "",
        comment: "",
      },
    ]);
    setEditMode(true);
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/revenues/${encodeURIComponent(deleteTargetId)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      if (res.ok) {
        setDeleteTargetId(null);
        await loadRevenues();
        onRevenueChanged();
      }
    } finally {
      setDeleting(false);
    }
  };

  const saveDraft = async (d: DraftRevenue) => {
    if (!initiativeId) return;
    const amount =
      d.amount.trim() === "" ? 0 : Number.parseFloat(d.amount.replace(",", "."));
    if (Number.isNaN(amount) || amount < 0) return;
    const res = await fetch("/api/revenues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initiativeId,
        type: d.type,
        amount,
        comment: d.comment.trim() || null,
      }),
      cache: "no-store",
    });
    if (res.ok) {
      setDrafts((prev) => prev.filter((x) => x.clientId !== d.clientId));
      await loadRevenues();
      onRevenueChanged();
    }
  };

  if (!initiativeId) {
    return (
      <div
        className={cn(
          PANEL_CARD_CLASS,
          "flex min-h-[200px] min-w-0 flex-col overflow-hidden rounded-xl p-6"
        )}
      >
        <InvestmentDetailPanelHeading icon={Banknote} title="Revenue" />
        <p className="text-muted-foreground mt-4 text-sm">
          Select an initiative to view and edit its revenue lines.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        PANEL_CARD_CLASS,
        "flex min-h-[280px] min-w-0 flex-col overflow-hidden rounded-xl transition-opacity duration-200"
      )}
    >
      <div className="border-border shrink-0 border-b px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <InvestmentDetailPanelHeading icon={Banknote} title="Revenue" />
            <p className="text-muted-foreground mt-1 text-xs">{subtitle}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!editMode && revenues.length === 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setEditMode(true)}>
                Edit revenues
              </Button>
            ) : !editMode ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setEditMode(true)}>
                Edit revenues
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setDrafts([]);
                  setEditMode(false);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto p-4">
        {loading ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 py-8 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading revenue…
          </div>
        ) : loadError ? (
          <p className="text-destructive text-sm">{loadError}</p>
        ) : (
          <>
            {!editMode && revenues.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No revenue lines. Click Edit revenues to add one.
              </p>
            ) : (
              <div className="border-border/60 mt-1 border-t pt-4">
                <Table>
                  <TableHeader
                    className={cn(
                      "bg-muted/40 [&_th]:bg-muted/40 [&_tr]:border-border/60",
                      TABLE_HEAD_ROW_BG
                    )}
                  >
                    <TableRow>
                      <TableHead className={TABLE_HEAD_CLASS}>Type</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>Comment</TableHead>
                      <TableHead
                        className={cn(
                          TABLE_HEAD_CLASS,
                          "min-w-[6rem] text-right",
                          ALLOCATION_COST_CELL_INSET
                        )}
                      >
                        Amount
                      </TableHead>
                      {editMode ? (
                        <TableHead className={cn(TABLE_HEAD_CLASS, "w-12")} aria-label="Actions" />
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {editMode
                      ? drafts.map((d) => (
                          <TableRow key={d.clientId} className={UNDER_GROUP_INDENT}>
                            <TableCell className="w-36">
                              <Select
                                value={d.type}
                                onValueChange={(v) => {
                                  if (!v || !isRevenueGroup(v)) return;
                                  setDrafts((prev) =>
                                    prev.map((x) =>
                                      x.clientId === d.clientId ? { ...x, type: v } : x
                                    )
                                  );
                                }}
                              >
                                <SelectTrigger size="sm" className="h-8 w-full min-w-[7rem]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Mission">Mission</SelectItem>
                                  <SelectItem value="Subscription">Subscription</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="min-w-[140px]">
                              <Input
                                className="h-8"
                                placeholder="Customer / note"
                                value={d.comment}
                                onChange={(e) =>
                                  setDrafts((prev) =>
                                    prev.map((x) =>
                                      x.clientId === d.clientId
                                        ? { ...x, comment: e.target.value }
                                        : x
                                    )
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right tabular-nums",
                                ALLOCATION_COST_CELL_INSET
                              )}
                            >
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                className="h-8 text-right"
                                placeholder="EUR"
                                value={d.amount}
                                onChange={(e) =>
                                  setDrafts((prev) =>
                                    prev.map((x) =>
                                      x.clientId === d.clientId
                                        ? { ...x, amount: e.target.value }
                                        : x
                                    )
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="w-28 text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="default"
                                  onClick={() => void saveDraft(d)}
                                >
                                  Save
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-8"
                                  aria-label="Discard draft"
                                  onClick={() =>
                                    setDrafts((prev) =>
                                      prev.filter((x) => x.clientId !== d.clientId)
                                    )
                                  }
                                >
                                  <X className="size-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      : null}

                    {editMode ? (
                      <TableRow className={cn("hover:bg-transparent", UNDER_GROUP_INDENT)}>
                        <TableCell className="py-2" colSpan={3} />
                        <TableCell className="py-2 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={addDraft}
                          >
                            <Plus className="size-3.5" />
                            Add revenue
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : null}

                    {GROUP_ORDER.map((group) => {
                      const groupRows = revenues.filter((r) => r.type === group);
                      return (
                      <Fragment key={group}>
                          <TableRow className="hover:bg-transparent">
                            <TableCell
                              colSpan={editMode ? 4 : 3}
                              className={cn(
                                "bg-muted/5 px-2 py-1.5",
                                group === "Subscription" && "border-t border-border/40"
                              )}
                            >
                              <div className="flex w-full flex-wrap items-center justify-between gap-3">
                                <span className="text-muted-foreground text-xs font-medium">
                                  {group}
                                </span>
                                <span
                                  className={cn(
                                    "min-w-[4.5rem] text-right text-sm font-medium tabular-nums text-[color:var(--primary-blue)]",
                                    GROUP_SUBTOTAL_COST_INSET
                                  )}
                                >
                                  {formatK(subtotal(group))}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>

                        {groupRows.map((row) => (
                          <TableRow key={row.id} className={cn("hover:bg-muted/30", UNDER_GROUP_INDENT)}>
                            <TableCell className="w-36">
                              {!editMode ? (
                                <span
                                  className={cn(
                                    "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                                    row.type === "Mission"
                                      ? "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200"
                                      : "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-200"
                                  )}
                                >
                                  {row.type}
                                </span>
                              ) : (
                                <Select
                                  value={row.type}
                                  onValueChange={(v) => {
                                    if (!v || !isRevenueGroup(v)) return;
                                    void patchImmediate(row.id, { type: v });
                                  }}
                                >
                                  <SelectTrigger size="sm" className="h-8 w-full min-w-[7rem]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Mission">Mission</SelectItem>
                                    <SelectItem value="Subscription">Subscription</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            </TableCell>
                            <TableCell className="min-w-[140px] text-sm">
                              {!editMode ? (
                                <span className="text-foreground">
                                  {row.comment?.trim() ? row.comment : "—"}
                                </span>
                              ) : (
                                <Input
                                  className="h-8"
                                  defaultValue={row.comment ?? ""}
                                  key={`${row.id}-comment`}
                                  onBlur={(e) => {
                                    const v = e.target.value;
                                    if (v === (row.comment ?? "")) return;
                                    void patchImmediate(row.id, { comment: v || null });
                                  }}
                                />
                              )}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right text-sm tabular-nums",
                                ALLOCATION_COST_CELL_INSET
                              )}
                            >
                              {!editMode ? (
                                formatK(row.amount)
                              ) : (
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className="h-8 text-right"
                                  defaultValue={row.amount === 0 ? "" : String(row.amount)}
                                  key={`${row.id}-amt`}
                                  onBlur={(e) => {
                                    const n =
                                      e.target.value.trim() === ""
                                        ? 0
                                        : Number.parseFloat(e.target.value);
                                    if (Number.isNaN(n) || n < 0) return;
                                    if (n === row.amount) return;
                                    void patchImmediate(row.id, { amount: n });
                                  }}
                                />
                              )}
                            </TableCell>
                            {editMode ? (
                              <TableCell className="text-right">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  className="size-8"
                                  aria-label="Delete revenue line"
                                  onClick={() => setDeleteTargetId(row.id)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </Fragment>
                    );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={deleteTargetId !== null} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete revenue line?</DialogTitle>
            <DialogDescription>
              This removes the revenue row for this initiative. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTargetId(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
