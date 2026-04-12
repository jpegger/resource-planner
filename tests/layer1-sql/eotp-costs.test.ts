import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCsv, toBool, toNum } from "../fixtures/load-csv";
import { prisma } from "./test-prisma";

type CostFixtureRow = {
  product_id: string;
  year: string;
  total_internal: string;
  total_external: string;
  total_direct: string;
  total_cost: string;
};

type EotpFixtureRow = {
  scenario: string;
  product_id: string;
  year: string;
  eotp: string;
  is_main_eotp: string;
  internal_cost: string;
  external_cost: string;
  direct_cost: string;
  cash_out: string;
  total_cost: string;
  notes: string;
};

describe("v_eotp_costs — fixture CSV", () => {
  const eotpFixtures = loadCsv<EotpFixtureRow>("expected-eotp.csv");

  it.each(eotpFixtures)(
    "row matches expected-eotp.csv — $scenario $product_id $year $eotp",
    async (fx) => {
      const rows = await prisma.$queryRaw<
        {
          internal_cost: number;
          external_cost: number;
          direct_cost: number;
          cash_out: number;
          total_cost: number;
          is_main_eotp: boolean;
        }[]
      >`
        SELECT internal_cost::float, external_cost::float, direct_cost::float,
               cash_out::float, total_cost::float, is_main_eotp
        FROM v_eotp_costs
        WHERE product_id = ${fx.product_id}
          AND year = ${toNum(fx.year)}
          AND eotp = ${fx.eotp}
          AND is_main_eotp = ${toBool(fx.is_main_eotp)}
      `;

      expect(rows.length).toBe(1);
      const [row] = rows;
      expect(row.internal_cost).toBeCloseTo(toNum(fx.internal_cost), 2);
      expect(row.external_cost).toBeCloseTo(toNum(fx.external_cost), 2);
      expect(row.direct_cost).toBeCloseTo(toNum(fx.direct_cost), 2);
      expect(row.cash_out).toBeCloseTo(toNum(fx.cash_out), 2);
      expect(row.total_cost).toBeCloseTo(toNum(fx.total_cost), 2);
    }
  );

  it("filter by scenario label B returns HMS 2025 exception + main", () => {
    const b = eotpFixtures.filter((r) => r.scenario === "B");
    expect(b).toHaveLength(2);
    expect(b.map((r) => r.eotp).sort()).toEqual(["7D0034001", "7D0079001"]);
  });
});

describe("v_eotp_costs — cost vs EOTP reconciliation (fixture entity×year)", () => {
  const costFixtures = loadCsv<CostFixtureRow>("expected-costs.csv");
  const eotpFixtures = loadCsv<EotpFixtureRow>("expected-eotp.csv");

  const costKeys = new Set(
    costFixtures.map((r) => `${r.product_id}\t${r.year}`)
  );
  const eotpKeys = new Set(
    eotpFixtures.map((r) => `${r.product_id}\t${r.year}`)
  );
  const commonKeys = [...costKeys].filter((k) => eotpKeys.has(k));

  it.each(commonKeys)("SUM(eotp.total_cost) = allocation total for %s", async (key) => {
    const [product_id, yearStr] = key.split("\t");
    const year = toNum(yearStr);

    const [alloc] = await prisma.$queryRaw<{ tc: number }[]>`
      SELECT COALESCE(SUM(v.computed_cost), 0)::float AS tc
      FROM v_allocation_costs v
      JOIN initiative i ON i.id = v.jira_key
      WHERE i.allocation_entity_id = ${product_id}
        AND i.year = ${year}
    `;

    const [eotp] = await prisma.$queryRaw<{ te: number }[]>`
      SELECT COALESCE(SUM(total_cost), 0)::float AS te
      FROM v_eotp_costs
      WHERE product_id = ${product_id}
        AND year = ${year}
    `;

    expect(eotp.te).toBeCloseTo(alloc.tc, 2);
  });
});

describe("v_eotp_costs — full-view invariants", () => {
  it("internal + external + direct = total_cost on every row", async () => {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM v_eotp_costs
      WHERE ABS(internal_cost + external_cost + direct_cost - total_cost) > 0.0001
    `;
    expect(n).toBe(0);
  });

  it("external + direct = cash_out on every row", async () => {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM v_eotp_costs
      WHERE ABS(external_cost + direct_cost - cash_out) > 0.0001
    `;
    expect(n).toBe(0);
  });

  it("exactly one main row per product × year present in v_eotp_costs", async () => {
    const bad = await prisma.$queryRaw<
      { product_id: string; year: number; mains: number }[]
    >`
      SELECT product_id, year,
        COUNT(*) FILTER (WHERE is_main_eotp)::int AS mains
      FROM v_eotp_costs
      GROUP BY product_id, year
      HAVING COUNT(*) FILTER (WHERE is_main_eotp) <> 1
    `;
    expect(bad).toEqual([]);
  });

  it("SUM(v_eotp_costs.total_cost) = allocation rollup per product × year", async () => {
    const bad = await prisma.$queryRaw<
      { product_id: string; year: number; tc: number; te: number }[]
    >`
      WITH alloc AS (
        SELECT i.allocation_entity_id AS product_id, i.year,
          SUM(v.computed_cost)::float AS tc
        FROM v_allocation_costs v
        JOIN initiative i ON i.id = v.jira_key
        WHERE i.allocation_entity_id IS NOT NULL
        GROUP BY i.allocation_entity_id, i.year
      ),
      eotp AS (
        SELECT product_id, year, SUM(total_cost)::float AS te
        FROM v_eotp_costs
        GROUP BY product_id, year
      )
      SELECT COALESCE(a.product_id, e.product_id) AS product_id,
             COALESCE(a.year, e.year) AS year,
             a.tc, e.te
      FROM alloc a
      FULL OUTER JOIN eotp e
        ON e.product_id = a.product_id AND e.year = a.year
      WHERE a.tc IS NULL
         OR e.te IS NULL
         OR ABS(COALESCE(a.tc, 0) - COALESCE(e.te, 0)) > 0.01
    `;
    expect(bad).toEqual([]);
  });
});

/** Scenario E — synthetic over-routing: exceptions exceed bucket; sums must still tie out. */
describe("v_eotp_costs — scenario E (synthetic over-routing)", () => {
  const productId = "PRD-AXON";
  const year = 2024;
  const exceptionEotp = "7D0079001";
  let routingId: string | undefined;

  beforeAll(async () => {
    const row = await prisma.eotpRouting.create({
      data: {
        allocationEntityId: productId,
        year,
        eotp: exceptionEotp,
        eopLabel: "layer1 test — synthetic over-route",
        internalAmount: 100_000,
        externalAmount: 0,
        directAmount: 0,
      },
    });
    routingId = row.id;
  });

  afterAll(async () => {
    if (routingId) {
      await prisma.eotpRouting.deleteMany({ where: { id: routingId } });
    }
  });

  it("main row can go negative while SUM(total_cost) still matches allocation total", async () => {
    const [alloc] = await prisma.$queryRaw<{ tc: number }[]>`
      SELECT COALESCE(SUM(v.computed_cost), 0)::float AS tc
      FROM v_allocation_costs v
      JOIN initiative i ON i.id = v.jira_key
      WHERE i.allocation_entity_id = ${productId}
        AND i.year = ${year}
    `;

    const [eotpSum] = await prisma.$queryRaw<{ te: number }[]>`
      SELECT COALESCE(SUM(total_cost), 0)::float AS te
      FROM v_eotp_costs
      WHERE product_id = ${productId}
        AND year = ${year}
    `;

    expect(eotpSum.te).toBeCloseTo(alloc.tc, 2);

    const mains = await prisma.$queryRaw<{ internal_cost: number }[]>`
      SELECT internal_cost::float
      FROM v_eotp_costs
      WHERE product_id = ${productId}
        AND year = ${year}
        AND is_main_eotp = true
    `;
    expect(mains.length).toBe(1);
    expect(mains[0].internal_cost).toBeLessThan(0);
  });
});
