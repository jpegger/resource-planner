/** Shared investment / resource picker shapes — safe for server and client. */

import type { ResourceType } from "@/generated/prisma/client";

export type { ResourceType };

export type ResourceOption = { id: string; fullName: string; type: ResourceType };

export type Investment = {
  id: string;
  name: string;
  productFamily: string | null;
  division: string | null;
  subDivision: string | null;
  team: string | null;
  sapEotpCode: string | null;
  sapEotpName: string | null;
  attractiveness: number | null;
  competitiveness: number | null;
};
