import { InvestmentDetailClient } from "@/app/investments/[id]/InvestmentDetailClient";
import type { InvestmentDetailServerPayload } from "@/app/investments/[id]/investment-detail-types";
import { getInvestmentDetailPageData } from "@/lib/investment-detail-page-data";

export default async function InvestmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id.trim());
  const serverPayload: InvestmentDetailServerPayload = await getInvestmentDetailPageData(decodedId);
  const {
    investment,
    resources,
    initiatives,
    eotpRouting,
    mainEotpFromView,
    mainEotpFromViewError,
  } = serverPayload;

  return (
    <InvestmentDetailClient
      investmentId={id}
      investment={investment}
      resources={resources}
      initiatives={initiatives}
      eotpRouting={eotpRouting}
      mainEotpFromView={mainEotpFromView}
      mainEotpFromViewError={mainEotpFromViewError}
    />
  );
}
