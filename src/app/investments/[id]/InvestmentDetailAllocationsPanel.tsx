"use client";

import { Loader2, UsersRound } from "lucide-react";
import { Fragment } from "react";

import { InvestmentDetailAllocationEditor } from "@/app/investments/[id]/InvestmentDetailAllocationEditor";
import { InvestmentDetailPanelHeading } from "@/app/investments/[id]/InvestmentDetailPanelHeading";
import {
  FINANCIALS_4COL,
  FINANCIALS_PILL,
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
  onPatchedAllocation: (u: AllocationDTO) => void;
  onDeletedAllocation: (id: string) => void;
  onCostsStale: () => void;
}) {
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
          Select an initiative to edit allocations.
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto p-4">
          <div className="mb-4 space-y-1">
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

          <div className="min-h-0 flex-1">
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-4 sm:gap-6">
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
                onClick={() => void onAddAllocation()}
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
                    <TableHead className={TABLE_HEAD_CLASS}>FTE % / units</TableHead>
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
                          <InvestmentDetailAllocationEditor
                            key={row.id}
                            row={row}
                            resources={resources}
                            costBreakdown={costByAllocId[row.id]}
                            onPatched={onPatchedAllocation}
                            onDeleted={() => onDeletedAllocation(row.id)}
                            onCostsStale={onCostsStale}
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
  );
}
