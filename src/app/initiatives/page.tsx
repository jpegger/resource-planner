import type { Product } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

import { InitiativesDynamicShell } from "./initiatives-dynamic-shell";

export const dynamic = "force-dynamic";

export default async function InitiativesPage() {
  const [initiativeRows, resourceRows] = await Promise.all([
    prisma.initiative.findMany({
      orderBy: { id: "asc" },
      include: {
        product: true,
      },
    }),
    prisma.resource.findMany({
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  /** When productId is set but `include.product` is null, resolve by id. */
  const idsNeedingProduct = new Set<string>();
  for (const i of initiativeRows) {
    const pid = i.productId?.trim();
    if (pid && !i.product) idsNeedingProduct.add(pid);
  }
  const extraProducts: Product[] =
    idsNeedingProduct.size > 0
      ? await prisma.product.findMany({
          where: { id: { in: [...idsNeedingProduct] } },
        })
      : [];
  const productById = new Map<string, Product>(extraProducts.map((p) => [p.id, p]));

  const initiatives = initiativeRows.map((i) => {
    const pid = i.productId?.trim() ?? null;
    const p = i.product ?? (pid ? productById.get(pid) : undefined) ?? null;
    return {
      id: i.id,
      powerId: i.powerId,
      summary: i.summary,
      status: i.status,
      year: i.year,
      components: i.components,
      productGroup: i.productGroup,
      productId: pid,
      productName: p?.name ?? null,
      productTeam: p?.team ?? null,
      productFamily: p?.productFamily ?? null,
      division: p?.division ?? null,
      subDivision: p?.subDivision ?? null,
      sapEotpCode: p?.sapEotpCode ?? null,
      sapEotpName: p?.sapEotpName ?? null,
      attractiveness:
        p && p.attractiveness != null && Number.isFinite(p.attractiveness) ? p.attractiveness : null,
      competitiveness:
        p && p.competitiveness != null && Number.isFinite(p.competitiveness) ? p.competitiveness : null,
      initiativeType: i.initiativeType,
      createdOn: i.createdOn.toISOString(),
      modifiedOn: i.modifiedOn.toISOString(),
    };
  });

  /** Plain JSON so RSC → dynamic(ssr:false) preserves a consistent shape for every initiative. */
  const initiativesPlain = JSON.parse(JSON.stringify(initiatives)) as typeof initiatives;

  return <InitiativesDynamicShell initiatives={initiativesPlain} resources={resourceRows} />;
}
