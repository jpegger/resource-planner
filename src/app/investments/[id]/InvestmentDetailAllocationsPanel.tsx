"use client";

import { Loader2, Plus, UsersRound } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import {
  ALLOCATION_COST_CELL_INSET,
  GROUP_SUBTOTAL_COST_INSET,
  InvestmentDetailAllocationEditor,
  UNDER_GROUP_INDENT,
} from "@/app/investments/[id]/InvestmentDetailAllocationEditor";
import { InvestmentDetailAllocationPendingRow } from "@/app/investments/[id]/InvestmentDetailAllocationPendingRow";
import { InvestmentDetailPanelHeading } from "@/app/investments/[id]/InvestmentDetailPanelHeading";
import {
  FINANCIALS_4COL,
  TABLE_HEAD_CLASS,
  TABLE_HEAD_ROW_BG,
  TABLE_HEAD_TOTAL_CLASS,
} from "@/app/investments/[id]/investment-detail-layout";
import { formatK, statusClass } from "@/app/investments/[id]/investment-detail-helpers";
import type {
  AllocationCostBreakdown,
  AllocationDTO,
  BudgetInitiative,
  ResourceGroupKey,
} from "@/app/investments/[id]/investment-detail-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ResourceOption } from "@/lib/investment-types";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

type AllocationGroup = { key: ResourceGroupKey; label: string; rows: AllocationDTO[] };

export function InvestmentDetailAllocationsPanel({
  selectedInitiative,
  resources,
  allocations,
  allocLoading,
  costByAllocId,
  allocationTotals,
  allocationGroupsWithRows,
  allocationTotalsByGroup,
  onAddAllocation,
  pendingAllocationDraftIds,
  onRemovePendingAllocationDraft,
  onDiscardPendingAllocationDrafts,
  onConfirmPendingAllocationDraft,
  confirmingPendingDraftId,
  onPatchedAllocation,
  onDeletedAllocation,
  onCostsStale,
}: {
  selectedInitiative: BudgetInitiative | null;
  resources: ResourceOption[];
  allocations: AllocationDTO[];
  allocLoading: boolean;
  costByAllocId: Record<string, AllocationCostBreakdown>;
  allocationTotals: { internal: number; external: number; direct: number; total: number };
  allocationGroupsWithRows: AllocationGroup[];
  allocationTotalsByGroup: Record<ResourceGroupKey, number>;
  onAddAllocation: () => void | Promise<void>;
  pendingAllocationDraftIds: string[];
  onRemovePendingAllocationDraft: (clientId: string) => void;
  onDiscardPendingAllocationDrafts: () => void;
  onConfirmPendingAllocationDraft: (clientId: string, resourceId: string) => void | Promise<void>;
  confirmingPendingDraftId: string | null;
  onPatchedAllocation: (u: AllocationDTO) => void;
  onDeletedAllocation: (id: string) => void;
  onCostsStale: () => void;
}) {
  const [editingAllocations, setEditingAllocations] = useState(false);

  useEffect(() => {
    setEditingAllocations(false);
  }, [selectedInitiative?.jira_key]);

  const colSpan = editingAllocations ? 5 : 4;

  return (
    <div
      className={cn(
        PANEL_CARD_CLASS,
        "flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-xl transition-opacity duration-200",
        selectedInitiative ? "opacity-100" : "opacity-90"
      )}
    >
      <div className="border-border shrink-0 border-b px-4 py-3">
        <InvestmentDetailPanelHeading icon={UsersRound} title="Resource allocations" />
      </div>
      {!selectedInitiative ? (
        <div className="text-muted-foreground flex h-full min-h-[200px] flex-1 items-center justify-center p-6 text-sm">
          Select an initiative to view allocations.
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto p-4">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold leading-snug">{selectedInitiative.summary}</h2>
                <Badge variant="secondary">{selectedInitiative.jira_key}</Badge>
                <span
                  className={cn("rounded px-2 py-0.5 text-xs", statusClass(selectedInitiative.status))}
                >
                  {selectedInitiative.status}
                </span>
                <span className="text-muted-foreground text-sm">{selectedInitiative.initiative_year}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-end justify-end gap-2 sm:justify-end">
              <div className="min-w-0 overflow-x-auto">
                <div className="border-border/60 rounded-md border">
                  <div
                    className={cn(
                      FINANCIALS_4COL,
                      "bg-muted/40 justify-items-end px-2 py-1.5"
                    )}
                  >
                    <span className={TABLE_HEAD_CLASS}>Internal</span>
                    <span className={TABLE_HEAD_CLASS}>External</span>
                    <span className={TABLE_HEAD_CLASS}>Direct</span>
                    <span className={TABLE_HEAD_TOTAL_CLASS}>Total</span>
                  </div>
                  {allocLoading ? (
                    <div className="text-muted-foreground flex min-h-[2.25rem] items-center justify-end gap-2 border-t border-border/60 px-2 py-2 text-xs">
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                      <span className="sm:hidden">Totals…</span>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        FINANCIALS_4COL,
                        "border-t border-border/60 justify-items-end px-2 py-1.5 text-sm tabular-nums text-foreground"
                      )}
                    >
                      <span className="block text-right">{formatK(allocationTotals.internal)}</span>
                      <span className="block text-right">{formatK(allocationTotals.external)}</span>
                      <span className="block text-right">{formatK(allocationTotals.direct)}</span>
                      <span className="block text-right font-semibold text-[color:var(--primary-blue)]">
                        {formatK(allocationTotals.total)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {!editingAllocations ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setEditingAllocations(true)}
                >
                  Edit allocations
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    onDiscardPendingAllocationDrafts();
                    setEditingAllocations(false);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <div className="border-border/60 mt-1 border-t pt-4">
              <Table>
                <TableHeader
                  className={cn(
                    "bg-muted/40 [&_th]:bg-muted/40 [&_tr]:border-border/60",
                    TABLE_HEAD_ROW_BG
                  )}
                >
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>FTE % / units</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>Man days</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>Resource</TableHead>
                    <TableHead
                      className={cn(
                        TABLE_HEAD_CLASS,
                        "min-w-[10rem] text-right",
                        ALLOCATION_COST_CELL_INSET
                      )}
                    >
                      Cost
                    </TableHead>
                    {editingAllocations ? (
                      <TableHead className={cn(TABLE_HEAD_CLASS, "w-28")} aria-label="Actions" />
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocLoading ? (
                    <TableRow>
                      <TableCell colSpan={colSpan} className="text-muted-foreground py-8 text-center text-sm">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="size-4 animate-spin" /> Loading allocations…
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {editingAllocations
                        ? pendingAllocationDraftIds.map((draftId) => (
                            <InvestmentDetailAllocationPendingRow
                              key={draftId}
                              resources={resources}
                              isConfirming={confirmingPendingDraftId === draftId}
                              onSelectResource={(resourceId) =>
                                void onConfirmPendingAllocationDraft(draftId, resourceId)
                              }
                              onDiscard={() => onRemovePendingAllocationDraft(draftId)}
                            />
                          ))
                        : null}
                      {editingAllocations ? (
                        <TableRow className={cn("hover:bg-transparent", UNDER_GROUP_INDENT)}>
                          <TableCell className="py-2" colSpan={4} />
                          <TableCell className="py-2 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={resources.length === 0}
                              onClick={() => void onAddAllocation()}
                            >
                              <Plus className="size-3.5" />
                              Add allocation
                            </Button>
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {allocationGroupsWithRows.map((group, groupIndex) => (
                        <Fragment key={group.key}>
                          <TableRow className="hover:bg-transparent">
                            <TableCell
                              colSpan={colSpan}
                              className={cn(
                                "bg-muted/5 px-2 py-1.5",
                                groupIndex > 0 && "border-t border-border/40"
                              )}
                            >
                              <div className="flex w-full flex-wrap items-center justify-between gap-3">
                                <span className="text-muted-foreground text-xs font-medium">
                                  {group.label}
                                </span>
                                <span
                                  className={cn(
                                    "min-w-[4.5rem] text-right text-sm font-medium tabular-nums text-[color:var(--primary-blue)]",
                                    GROUP_SUBTOTAL_COST_INSET
                                  )}
                                >
                                  {formatK(allocationTotalsByGroup[group.key])}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                          {group.rows.map((row) => (
                            <InvestmentDetailAllocationEditor
                              key={row.id}
                              row={row}
                              resources={resources}
                              costBreakdown={costByAllocId[row.id]}
                              editing={editingAllocations}
                              onPatched={onPatchedAllocation}
                              onDeleted={() => onDeletedAllocation(row.id)}
                              onCostsStale={onCostsStale}
                            />
                          ))}
                        </Fragment>
                      ))}
                    </>
                  )}
                </TableBody>
              </Table>
              {!allocLoading && allocations.length === 0 && pendingAllocationDraftIds.length === 0 ? (
                <p className="text-muted-foreground mt-3 text-sm">
                  {editingAllocations
                    ? "No allocations yet. Use Add allocation to create one."
                    : "No allocations yet. Choose Edit allocations to add rows."}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
