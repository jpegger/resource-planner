import "dotenv/config";
import { describe, expect, it } from "vitest";
import { loadCsv, toNum } from "../fixtures/load-csv";
import { prisma } from "./test-prisma";

type CostFixtureRow = {
  product_id: string;
  year: string;
  total_internal: string;
  total_external: string;
  total_direct: string;
  total_cost: string;
  notes: string;
};

describe("v_allocation_costs — fixture CSV (entity × year)", () => {
  const costFixtures = loadCsv<CostFixtureRow>("expected-costs.csv");

  it.each(costFixtures)(
    "matches expected-costs.csv for $product_id × $year ($notes)",
    async (fx) => {
      const [row] = await prisma.$queryRaw<
        {
          total_internal: number;
          total_external: number;
          total_direct: number;
          total_cost: number;
        }[]
      >`
        SELECT
          COALESCE(SUM(v.internal_cost), 0)::float AS total_internal,
          COALESCE(SUM(v.external_cost), 0)::float AS total_external,
          COALESCE(SUM(v.direct_cost), 0)::float AS total_direct,
          COALESCE(SUM(v.computed_cost), 0)::float AS total_cost
        FROM v_allocation_costs v
        JOIN initiative i ON i.id = v.jira_key
        WHERE i.allocation_entity_id = ${fx.product_id}
          AND i.year = ${toNum(fx.year)}
      `;

      expect(row.total_internal).toBeCloseTo(toNum(fx.total_internal), 2);
      expect(row.total_external).toBeCloseTo(toNum(fx.total_external), 2);
      expect(row.total_direct).toBeCloseTo(toNum(fx.total_direct), 2);
      expect(row.total_cost).toBeCloseTo(toNum(fx.total_cost), 2);
    }
  );
});

describe("v_allocation_costs — full-view invariants", () => {
  it("internal + external + direct = computed_cost on every row", async () => {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM v_allocation_costs
      WHERE ABS(
        internal_cost + external_cost + direct_cost - computed_cost
      ) > 0.0001
    `;
    expect(n).toBe(0);
  });

  it("fte_decimal = 0 for every DIRECT_COST row", async () => {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM v_allocation_costs
      WHERE resource_type = 'DIRECT_COST'
        AND fte_decimal <> 0
    `;
    expect(n).toBe(0);
  });

  it("resource_type is INTERNAL, EXTERNAL, or DIRECT_COST", async () => {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM v_allocation_costs
      WHERE resource_type::text NOT IN ('INTERNAL', 'EXTERNAL', 'DIRECT_COST')
    `;
    expect(n).toBe(0);
  });

  it("computed_cost >= 0 on every row", async () => {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM v_allocation_costs
      WHERE computed_cost < 0
    `;
    expect(n).toBe(0);
  });
});
