import { InvestmentsListClient } from "@/app/investments/InvestmentsListClient";
import { getAllocationEntitiesWithBudget } from "@/lib/investments-list";

export default async function InvestmentsPage() {
  const { rows, error } = await getAllocationEntitiesWithBudget();
  return <InvestmentsListClient rows={rows} loadError={error} />;
}
