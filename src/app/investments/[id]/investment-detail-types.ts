import type { Investment, ResourceOption } from "@/lib/investment-types";

export type { Investment, ResourceOption, ResourceType } from "@/lib/investment-types";

export type BudgetInitiative = {
  jira_key: string;
  summary: string;
  status: string;
  initiative_year: number;
  internal_cost: number;
  external_cost: number;
  direct_cost: number;
  total_cost: number;
};

export type AllocationDTO = {
  id: string;
  initiativeId: string;
  resourceId: string;
  quantity: number | null;
  manDays: number | null;
  resource: ResourceOption;
};

export type AllocationCostBreakdown = {
  internal: number;
  external: number;
  direct: number;
  total: number;
};

export const RESOURCE_GROUP_ORDER = ["INTERNAL", "EXTERNAL", "DIRECT_COST"] as const;
export type ResourceGroupKey = (typeof RESOURCE_GROUP_ORDER)[number];

export const RESOURCE_GROUP_LABEL: Record<ResourceGroupKey, string> = {
  INTERNAL: "Internal",
  EXTERNAL: "External",
  DIRECT_COST: "Direct",
};

export type EotpRoutingRow = {
  id: string;
  allocationEntityId?: string;
  year: number;
  eotp: string;
  eopLabel: string | null;
  internalAmount: number;
  externalAmount: number;
  directAmount: number;
  comment: string | null;
};

export type RoutingDraft = {
  year: string;
  eotp: string;
  eopLabel: string;
  internal: string;
  external: string;
  direct: string;
  comment: string;
};

/** One row from v_eotp_costs where is_main_eotp = true (remainder on main SAP EOTP). */
export type MainEotpFromViewRow = {
  year: number;
  eotp: string | null;
  eopLabel: string | null;
  internalCost: number;
  externalCost: number;
  directCost: number;
};

/** RSC → client bundle for `/investments/[id]` (allocation rows load on user action only). */
export type InvestmentDetailServerPayload = {
  investment: Investment | null;
  resources: ResourceOption[];
  initiatives: BudgetInitiative[];
  eotpRouting: EotpRoutingRow[];
  mainEotpFromView: MainEotpFromViewRow[];
  mainEotpFromViewError: string | null;
};
