import { ProductDetailTestClient } from "./product-detail-client";

export default async function ProductTestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductDetailTestClient productId={id} />;
}
