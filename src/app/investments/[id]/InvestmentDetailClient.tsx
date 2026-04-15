"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { InvestmentDetailAllocationsPanel } from "@/app/investments/[id]/InvestmentDetailAllocationsPanel";
import { InvestmentDetailBudgetCard } from "@/app/investments/[id]/InvestmentDetailBudgetCard";
import { InvestmentDetailRevenuePanel } from "@/app/investments/[id]/InvestmentDetailRevenuePanel";
import { InvestmentDetailBudgetKeyFigures } from "@/app/investments/[id]/InvestmentDetailBudgetKeyFigures";
import { InvestmentDetailEotpRoutingSection } from "@/app/investments/[id]/InvestmentDetailEotpRoutingSection";
import { InvestmentDetailSummaryCard } from "@/app/investments/[id]/InvestmentDetailSummaryCard";
import { InvestmentDetailYearFilter } from "@/app/investments/[id]/InvestmentDetailYearFilter";
import { defaultInvestmentDetailYear } from "@/app/investments/[id]/investment-detail-helpers";
import type {
  InvestmentDetailServerPayload,
  MainEotpFromViewRow,
} from "@/app/investments/[id]/investment-detail-types";

import { useInvestmentBudgetRouting } from "@/app/investments/[id]/use-investment-budget-routing";
import { useInitiativeAllocations } from "@/app/investments/[id]/use-investment-initiative-allocations";
import { useInvestmentIdParam } from "@/app/investments/[id]/use-investment-detail-shell";
import { Separator } from "@/components/ui/separator";

type InvestmentDetailClientProps = { investmentId: string } & InvestmentDetailServerPayload;

export function InvestmentDetailClient({
  investmentId,
  investment,
  resources,
  initiatives: initialInitiatives,
  eotpRouting: initialEotpRouting,
  mainEotpFromView,
  mainEotpFromViewError,
}: InvestmentDetailClientProps) {
  const investmentIdDecoded = useInvestmentIdParam(investmentId);

  const [selectedYear, setSelectedYear] = useState<number>(() =>
    defaultInvestmentDetailYear(initialInitiatives, initialEotpRouting)
  );
  const [mainFromView, setMainFromView] = useState<MainEotpFromViewRow[]>(() => mainEotpFromView);
  const [mainViewError, setMainViewError] = useState<string | null>(() => mainEotpFromViewError);

  const onMainFromViewChange = useCallback((rows: MainEotpFromViewRow[], error: string | null) => {
    setMainFromView(rows);
    setMainViewError(error);
  }, []);
  const {
    initiatives,
    budgetLoading,
    loadBudget,
    loadRoutingYears,
    yearOptions,
    budgetListTotals,
    yearSummary,
    yearSummaryLoading,
    loadYearSummary,
  } = useInvestmentBudgetRouting(
    investmentIdDecoded,
    selectedYear,
    initialInitiatives,
    initialEotpRouting
  );
  const {
    selectedInitiative,
    allocations,
    allocLoading,
    costByAllocId,
    handleSelectInitiative,
    refreshCosts,
    addAllocation,
    pendingAllocationDraftIds,
    removePendingAllocationDraft,
    discardPendingAllocationDrafts,
    confirmPendingAllocationDraft,
    confirmingPendingDraftId,
    allocationTotals,
    allocationGroupsWithRows,
    allocationTotalsByGroup,
    onPatchedAllocation,
    onDeletedAllocation,
  } = useInitiativeAllocations(selectedYear);

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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <div className="min-w-0 space-y-3 lg:col-span-2">
            <Link
              href="/investments"
              className="text-primary inline-flex text-sm font-medium underline-offset-4 hover:underline"
            >
              ← Back to investments
            </Link>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <h1 className="text-foreground min-w-0 flex-1 text-lg font-semibold leading-snug sm:pt-0.5">
                <span className="break-words">{investment.name}</span>
                <span className="text-muted-foreground font-normal"> · {selectedYear}</span>
              </h1>
              <div className="flex w-full shrink-0 justify-end sm:w-auto">
                <InvestmentDetailYearFilter
                  selectedYear={selectedYear}
                  yearOptions={yearOptions}
                  onSelectYear={setSelectedYear}
                />
              </div>
            </div>
          </div>

            <InvestmentDetailBudgetKeyFigures
            className="lg:col-span-2"
            filterYear={selectedYear}
            mainSapEotpCode={investment.sapEotpCode}
            mainFromView={mainFromView}
            mainViewError={mainViewError}
            budgetListTotals={budgetListTotals}
            budgetLoading={budgetLoading}
            yearSummary={yearSummary}
            yearSummaryLoading={yearSummaryLoading}
          />

          <InvestmentDetailSummaryCard investment={investment} />

          <InvestmentDetailEotpRoutingSection
            investmentId={investmentId}
            mainSapEotpCode={investment.sapEotpCode}
            filterYear={selectedYear}
            initialRows={initialEotpRouting}
            mainFromView={mainFromView}
            mainViewError={mainViewError}
            onMainFromViewChange={onMainFromViewChange}
            onChanged={() => {
              void loadBudget();
              void loadRoutingYears();
              void loadYearSummary();
            }}
          />
        </div>

        <Separator className="shrink-0" />

        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex min-h-0 min-w-0 flex-col overflow-auto">
            <InvestmentDetailBudgetCard
              budgetLoading={budgetLoading}
              initiatives={initiatives}
              budgetListTotals={budgetListTotals}
              selectedInitiative={selectedInitiative}
              onSelectInitiative={handleSelectInitiative}
            />
          </div>

          <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto">
            <InvestmentDetailAllocationsPanel
              key={selectedInitiative?.jira_key ?? "no-initiative"}
              selectedInitiative={selectedInitiative}
              resources={resources}
              allocations={allocations}
              allocLoading={allocLoading}
              costByAllocId={costByAllocId}
              allocationTotals={allocationTotals}
              allocationGroupsWithRows={allocationGroupsWithRows}
              allocationTotalsByGroup={allocationTotalsByGroup}
              onAddAllocation={addAllocation}
              pendingAllocationDraftIds={pendingAllocationDraftIds}
              onRemovePendingAllocationDraft={removePendingAllocationDraft}
              onDiscardPendingAllocationDrafts={discardPendingAllocationDrafts}
              onConfirmPendingAllocationDraft={confirmPendingAllocationDraft}
              confirmingPendingDraftId={confirmingPendingDraftId}
              onPatchedAllocation={onPatchedAllocation}
              onDeletedAllocation={onDeletedAllocation}
              onCostsStale={refreshCosts}
            />
            <InvestmentDetailRevenuePanel
              initiativeId={selectedInitiative?.jira_key ?? null}
              year={selectedYear}
              onRevenueChanged={() => {
                void loadBudget();
                void loadYearSummary();
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
