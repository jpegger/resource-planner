import { prisma } from "@/lib/prisma";

import ComparisonClient from "./ComparisonClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ComparisonPage() {
  const [snapshots, baselines] = await Promise.all([
    prisma.allocationSnapshot.findMany({ orderBy: { takenAt: "desc" } }),
    prisma.budgetBaseline.findMany({ orderBy: { importedAt: "desc" } }),
  ]);

  return <ComparisonClient snapshots={snapshots} baselines={baselines} />;
}

