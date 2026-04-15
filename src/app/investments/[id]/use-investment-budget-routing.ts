import { useCallback, useEffect, useMemo, useState } from "react";

import type { BudgetInitiative, EotpRoutingRow } from "@/app/investments/[id]/investment-detail-types";
import { distinctSortedNumbers } from "@/lib/utils";

export function useInvestmentBudgetRouting(
  investmentIdDecoded: string,
  selectedYear: number,
  initialInitiatives: BudgetInitiative[],
  initialEotpRouting: EotpRoutingRow[]
) {
  const [initiatives, setInitiatives] = useState<BudgetInitiative[]>(() =>
    initialInitiatives.filter((i) => i.initiative_year === selectedYear)
  );
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [yearSummaryLoading, setYearSummaryLoading] = useState(false);
  const [yearSummary, setYearSummary] = useState<{ totalCost: number; totalFte: number } | null>(null);
  const [budgetYearOptions, setBudgetYearOptions] = useState(() =>
    distinctSortedNumbers(initialInitiatives.map((i) => i.initiative_year), "desc")
  );
  const [routingYearOptions, setRoutingYearOptions] = useState(() =>
    distinctSortedNumbers(initialEotpRouting.map((r) => r.year), "desc")
  );

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
      setRoutingYearOptions(distinctSortedNumbers(rows.map((r) => r.year), "desc"));
    } catch {
      setRoutingYearOptions([]);
    }
  }, [investmentIdDecoded]);

  const loadBudget = useCallback(async () => {
    setBudgetLoading(true);
    try {
      const q = `?year=${encodeURIComponent(String(selectedYear))}`;
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
    } finally {
      setBudgetLoading(false);
    }
  }, [investmentIdDecoded, selectedYear]);

  const loadYearSummary = useCallback(async () => {
    setYearSummaryLoading(true);
    try {
      const q = `?year=${encodeURIComponent(String(selectedYear))}`;
      const res = await fetch(
        `/api/allocation-entities/${encodeURIComponent(investmentIdDecoded)}/year-summary${q}`
      );
      if (!res.ok) {
        setYearSummary(null);
        return;
      }
      const j = (await res.json()) as { totalCost?: number; totalFte?: number };
      setYearSummary({
        totalCost: Number(j.totalCost ?? 0),
        totalFte: Number(j.totalFte ?? 0),
      });
    } catch {
      setYearSummary(null);
    } finally {
      setYearSummaryLoading(false);
    }
  }, [investmentIdDecoded, selectedYear]);

  useEffect(() => {
    void loadBudget();
  }, [loadBudget, selectedYear]);

  useEffect(() => {
    void loadYearSummary();
  }, [loadYearSummary, selectedYear]);

  const yearOptions = useMemo(
    () =>
      distinctSortedNumbers([...budgetYearOptions, ...routingYearOptions, selectedYear], "desc"),
    [budgetYearOptions, routingYearOptions, selectedYear]
  );

  const budgetListTotals = useMemo(() => {
    let internal = 0;
    let external = 0;
    let direct = 0;
    let total = 0;
    let revenue = 0;
    for (const ini of initiatives) {
      internal += ini.internal_cost;
      external += ini.external_cost;
      direct += ini.direct_cost;
      total += ini.total_cost;
      revenue += ini.total_revenue;
    }
    return { internal, external, direct, total, revenue };
  }, [initiatives]);

  return {
    initiatives,
    budgetLoading,
    loadBudget,
    loadRoutingYears,
    yearOptions,
    budgetListTotals,
    yearSummary,
    yearSummaryLoading,
    loadYearSummary,
  };
}
