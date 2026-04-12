import type { InvestmentDetailServerPayload } from "@/app/investments/[id]/investment-detail-types";
import { getBudgetInitiativesForEntity } from "@/lib/investment-detail-budget-query";
import {
  getEotpMainFromViewForEntity,
  getEotpRoutingRowsForEntity,
} from "@/lib/investment-detail-eotp-queries";
import { getInvestmentEntityForDetail, getResourcesForPicker } from "@/lib/investment-server-data";

/** Server-only bundle for [`/investments/[id]/page.tsx`](src/app/investments/[id]/page.tsx). */
export async function getInvestmentDetailPageData(
  decodedEntityId: string
): Promise<InvestmentDetailServerPayload> {
  const investment = await getInvestmentEntityForDetail(decodedEntityId);
  if (!investment) {
    return {
      investment: null,
      resources: [],
      initiatives: [],
      eotpRouting: [],
      mainEotpFromView: [],
      mainEotpFromViewError: null,
    };
  }

  const [resources, initiatives, eotpRouting, mainView] = await Promise.all([
    getResourcesForPicker(),
    getBudgetInitiativesForEntity(decodedEntityId, null),
    getEotpRoutingRowsForEntity(decodedEntityId),
    getEotpMainFromViewForEntity(decodedEntityId, null),
  ]);

  return {
    investment,
    resources,
    initiatives,
    eotpRouting,
    mainEotpFromView: mainView.rows,
    mainEotpFromViewError: mainView.error,
  };
}
