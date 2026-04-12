import type {
  AllocationCostBreakdown,
  AllocationDTO,
  BudgetInitiative,
  EotpRoutingRow,
  ResourceGroupKey,
  ResourceType,
  RoutingDraft,
} from "@/app/investments/[id]/investment-detail-types";
import { RESOURCE_GROUP_LABEL, RESOURCE_GROUP_ORDER } from "@/app/investments/[id]/investment-detail-types";
import { distinctSortedNumbers } from "@/lib/utils";

export const formatK = (n: number) => {
  if (n === 0) return "—";
  return "€\u00a0" + Math.round(n / 1000) + "k";
};

/** Most recent year present in initiatives or EOTP routing; falls back to calendar year when empty. */
export function defaultInvestmentDetailYear(
  initiatives: BudgetInitiative[],
  eotpRouting: EotpRoutingRow[]
): number {
  const merged = distinctSortedNumbers(
    [...initiatives.map((i) => i.initiative_year), ...eotpRouting.map((r) => r.year)],
    "desc"
  );
  return merged[0] ?? new Date().getFullYear();
}

/** external + direct (matches v_eotp_costs.cash_out). */
export function eotpCashOut(ext: number, dir: number) {
  return ext + dir;
}

/** internal + external + direct (matches v_eotp_costs.total_cost). */
export function eotpTotal(int: number, ext: number, dir: number) {
  return int + ext + dir;
}

export function eotpIsMainSapCode(rowEotp: string, mainSapEotp: string | null): boolean {
  if (!mainSapEotp?.trim()) return false;
  return rowEotp.trim().toLowerCase() === mainSapEotp.trim().toLowerCase();
}

export function groupAllocationsByResourceType(allocations: AllocationDTO[]) {
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
export function costAmountForResourceType(
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

export function statusClass(status: string): string {
  const u = status.toLowerCase();
  if (u.includes("done") || u.includes("closed") || u.includes("resolved")) {
    return "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100";
  }
  if (u.includes("progress")) {
    return "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100";
  }
  return "bg-muted text-muted-foreground";
}

export function emptyDraft(defaultYear: number): RoutingDraft {
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

export async function patchAllocation(id: string, body: Record<string, unknown>) {
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
