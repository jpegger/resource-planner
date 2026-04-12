"use client";

import { BarChart3, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { InvestmentDetailPanelHeading } from "@/app/investments/[id]/InvestmentDetailPanelHeading";
import { eotpTotal, formatK } from "@/app/investments/[id]/investment-detail-helpers";
import type { MainEotpFromViewRow } from "@/app/investments/[id]/investment-detail-types";
import { cn } from "@/lib/utils";

type BudgetTotals = { internal: number; external: number; direct: number; total: number };

export function InvestmentDetailBudgetKeyFigures({
  className,
  filterYear,
  mainSapEotpCode,
  mainFromView,
  mainViewError,
  budgetListTotals,
  budgetLoading,
  yearSummary,
  yearSummaryLoading,
}: {
  className?: string;
  filterYear: number;
  mainSapEotpCode: string | null;
  mainFromView: MainEotpFromViewRow[];
  mainViewError: string | null;
  budgetListTotals: BudgetTotals;
  budgetLoading: boolean;
  yearSummary: { totalCost: number; totalFte: number } | null;
  yearSummaryLoading: boolean;
}) {
  const referenceBudget = yearSummary?.totalCost ?? budgetListTotals.total;

  const displayMainFromView = useMemo(
    () => mainFromView.filter((m) => m.year === filterYear),
    [mainFromView, filterYear]
  );

  const mainEotpKeyFigure = useMemo(() => {
    let total = 0;
    for (const m of displayMainFromView) {
      total += eotpTotal(m.internalCost, m.externalCost, m.directCost);
    }
    const eotpLabel =
      displayMainFromView.find((m) => m.eotp?.trim())?.eotp?.trim() ??
      mainSapEotpCode?.trim() ??
      null;
    return { total, eotpLabel };
  }, [displayMainFromView, mainSapEotpCode]);

  return (
    <div
      className={cn(
        "bg-card flex min-w-0 overflow-hidden rounded-xl border border-border shadow-sm",
        className
      )}
    >
      <div className="w-1 shrink-0 bg-[color:var(--primary-blue)]" aria-hidden />
      <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-5">
        <InvestmentDetailPanelHeading icon={BarChart3} title="Budget overview" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          <div className="bg-muted/50 flex min-h-[5.5rem] flex-col items-center justify-center rounded-lg px-3 py-4 text-center">
            <p className="text-foreground text-2xl font-bold tabular-nums tracking-tight">{filterYear}</p>
            <p className="text-muted-foreground mt-1.5 text-xs">Year</p>
          </div>
          <div className="bg-muted/50 flex min-h-[5.5rem] flex-col items-center justify-center rounded-lg px-3 py-4 text-center">
            {budgetLoading || yearSummaryLoading ? (
              <Loader2 className="text-muted-foreground size-7 animate-spin" />
            ) : (
              <>
                <p className="text-2xl font-bold tabular-nums tracking-tight text-[color:var(--primary-blue)]">
                  {formatK(referenceBudget)}
                </p>
                <p className="text-muted-foreground mt-1.5 text-xs">Actual budget</p>
              </>
            )}
          </div>
          <div className="bg-muted/50 flex min-h-[5.5rem] flex-col items-center justify-center rounded-lg px-3 py-4 text-center">
            {yearSummaryLoading ? (
              <Loader2 className="text-muted-foreground size-7 animate-spin" />
            ) : (
              <>
                <p className="text-foreground text-2xl font-bold tabular-nums tracking-tight">
                  {yearSummary ? (
                    yearSummary.totalFte === 0 ? (
                      "—"
                    ) : (
                      yearSummary.totalFte.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })
                    )
                  ) : (
                    "—"
                  )}
                </p>
                <p className="text-muted-foreground mt-1.5 text-xs">FTE (sum)</p>
              </>
            )}
          </div>
          <div className="bg-muted/50 flex min-h-[5.5rem] flex-col items-center justify-center rounded-lg px-3 py-4 text-center">
            {mainViewError ? (
              <>
                <p className="text-muted-foreground text-2xl font-bold">—</p>
                <p
                  className="text-muted-foreground mt-1.5 max-w-full break-all px-1 font-mono text-[10px] leading-tight"
                  title={mainEotpKeyFigure.eotpLabel ?? undefined}
                >
                  {mainEotpKeyFigure.eotpLabel ?? "—"}
                </p>
              </>
            ) : (
              <>
                <p className="text-foreground text-2xl font-bold tabular-nums tracking-tight">
                  {formatK(mainEotpKeyFigure.total)}
                </p>
                <p
                  className="text-muted-foreground mt-1.5 max-w-full break-all px-1 font-mono text-[10px] leading-tight"
                  title={
                    mainEotpKeyFigure.eotpLabel
                      ? `Main EOTP total (${mainEotpKeyFigure.eotpLabel})`
                      : "Main EOTP total from v_eotp_costs"
                  }
                >
                  {mainEotpKeyFigure.eotpLabel ?? "—"}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
