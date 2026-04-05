import { prisma } from "@/lib/prisma";
import { InitiativesPageClient } from "./initiatives-client";

export const dynamic = "force-dynamic";

export default async function InitiativesPage() {
  const [initiativeRows, resourceRows] = await Promise.all([
    prisma.initiative.findMany({ orderBy: { id: "asc" } }),
    prisma.resource.findMany({
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const initiatives = initiativeRows.map((i) => ({
    id: i.id,
    powerId: i.powerId,
    summary: i.summary,
    status: i.status,
    year: i.year,
    components: i.components,
    productGroup: i.productGroup,
    initiativeType: i.initiativeType,
    createdOn: i.createdOn.toISOString(),
    modifiedOn: i.modifiedOn.toISOString(),
  }));

  return <InitiativesPageClient initiatives={initiatives} resources={resourceRows} />;
}
