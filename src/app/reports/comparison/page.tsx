import { Suspense } from "react";

import { prisma } from "@/lib/prisma";

import ComparisonClient from "./ComparisonClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ComparisonPage() {
  const [snapshots, baselines] = await Promise.all([
    prisma.allocationSnapshot.findMany({ orderBy: { takenAt: "desc" } }),
    prisma.budgetBaseline.findMany({ orderBy: { importedAt: "desc" } }),
  ]);

  return (
    <Suspense
      fallback={
        <div className="text-muted-foreground mx-auto max-w-6xl p-6 text-sm">Loading comparison…</div>
      }
    >
      <ComparisonClient snapshots={snapshots} baselines={baselines} />
    </Suspense>
  );
}

