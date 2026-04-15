import { InvestmentsListClient } from "@/app/investments/InvestmentsListClient";
import { getAllocationEntitiesWithBudget } from "@/lib/investments-list";

/** Avoid DB access during `next build` (no Postgres in Docker build stage). */
export const dynamic = "force-dynamic";

export default async function InvestmentsPage() {
  const { rows, error } = await getAllocationEntitiesWithBudget();
  return <InvestmentsListClient rows={rows} loadError={error} />;
}
