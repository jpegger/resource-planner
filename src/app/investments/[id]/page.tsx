import { InvestmentDetailClient } from "./investment-detail-client";

export default async function InvestmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InvestmentDetailClient investmentId={id} />;
}
