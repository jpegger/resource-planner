import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const products = await prisma.product.findMany({
    orderBy: [{ productFamily: "asc" }, { name: "asc" }],
  });
  return Response.json(products);
}
