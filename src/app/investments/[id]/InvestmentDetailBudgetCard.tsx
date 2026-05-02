import { Fragment, useMemo } from "react";
import { Layers, Loader2 } from "lucide-react";

import { InvestmentDetailPanelHeading } from "@/app/investments/[id]/InvestmentDetailPanelHeading";
import {
  FINANCIALS_4COL,
  FINANCIALS_PILL,
  TABLE_HEAD_CLASS,
  TABLE_HEAD_ROW_BG,
  TABLE_HEAD_TOTAL_CLASS,
} from "@/app/investments/[id]/investment-detail-layout";
import { formatK, statusClass } from "@/app/investments/[id]/investment-detail-helpers";
import type { BudgetInitiative } from "@/app/investments/[id]/investment-detail-types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

function groupBudgetInitiativesByType(initiatives: BudgetInitiative[]) {
  const byKey = new Map<string, BudgetInitiative[]>();
  for (const ini of initiatives) {
    const key = ini.initiative_type?.trim() ?? "";
    const bucket = byKey.get(key);
    if (bucket) bucket.push(ini);
    else byKey.set(key, [ini]);
  }
  for (const arr of byKey.values()) {
    arr.sort((a, b) => {
      if (b.initiative_year !== a.initiative_year) return b.initiative_year - a.initiative_year;
      return a.summary.localeCompare(b.summary, undefined, { sensitivity: "base" });
    });
  }
  const keys = [...byKey.keys()].sort((a, b) => {
    if (a === "" && b !== "") return 1;
    if (b === "" && a !== "") return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
  return keys.map((key) => ({
    key: key || "__unspecified__",
    label: key || "Unspecified",
    items: byKey.get(key)!,
  }));
}

export function InvestmentDetailBudgetCard({
  budgetLoading,
  initiatives,
  budgetListTotals,
  selectedInitiative,
  onSelectInitiative,
}: {
  budgetLoading: boolean;
  initiatives: BudgetInitiative[];
  budgetListTotals: {
    internal: number;
    external: number;
    direct: number;
    total: number;
    revenue: number;
  };
  selectedInitiative: BudgetInitiative | null;
  onSelectInitiative: (ini: BudgetInitiative) => void | Promise<void>;
}) {
  const initiativeGroups = useMemo(() => groupBudgetInitiativesByType(initiatives), [initiatives]);

  return (
    <Card className={cn(PANEL_CARD_CLASS, "flex min-h-0 flex-1 flex-col")}>
      <CardHeader className="pb-2">
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <InvestmentDetailPanelHeading icon={Layers} title="Budget by initiative" />
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
              {initiativeGroups.map((group) => (
                <Fragment key={group.key}>
                  <li className="bg-muted/5 list-none px-3 py-1.5">
                    <span className="text-muted-foreground text-xs font-medium">{group.label}</span>
                  </li>
                  {group.items.map((ini) => (
                    <li key={`${ini.jira_key}-${ini.initiative_year}`}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => void onSelectInitiative(ini)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void onSelectInitiative(ini);
                          }
                        }}
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
                      </div>
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
