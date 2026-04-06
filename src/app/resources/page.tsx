import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";

import { ResourcesPageClient } from "./resources-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resources — Initiative Resource Planner",
};

export default async function ResourcesPage() {
  const resources = await prisma.resource.findMany({
    orderBy: { fullName: "asc" },
    include: {
      rates: { orderBy: { year: "desc" } },
    },
  });

  const rows = resources.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    firstName: r.firstName,
    lastName: r.lastName,
    function: r.function,
    cellule: r.cellule,
    direction: r.direction,
    type: r.type,
    rates: r.rates.map((rate) => ({
      id: rate.id,
      year: rate.year,
      dailyRate: rate.dailyRate,
      nbrDaysPerYear: rate.nbrDaysPerYear,
    })),
  }));

  return <ResourcesPageClient resources={rows} />;
}
