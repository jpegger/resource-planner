import { describe, expect, it } from "vitest";

import { http, initiativeIdWithNoAllocations, KNOWN_INITIATIVE_ID } from "./helpers";

describe("GET /api/initiative-allocation-costs", () => {
  it("returns 200 with an array for a known initiative", async () => {
    const res = await http()
      .get(`/api/initiative-allocation-costs?initiativeId=${encodeURIComponent(KNOWN_INITIATIVE_ID)}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("each row has numeric bucket fields and the sum invariant holds", async () => {
    const res = await http()
      .get(`/api/initiative-allocation-costs?initiativeId=${encodeURIComponent(KNOWN_INITIATIVE_ID)}`)
      .expect(200);

    for (const row of res.body as any[]) {
      expect(typeof row.allocation_id).toBe("string");
      expect(typeof row.internal_cost).toBe("number");
      expect(typeof row.external_cost).toBe("number");
      expect(typeof row.direct_cost).toBe("number");
      expect(typeof row.computed_cost).toBe("number");

      const sum = row.internal_cost + row.external_cost + row.direct_cost;
      expect(sum).toBeCloseTo(row.computed_cost, 2);
    }
  });

  it("returns 400 when initiativeId is missing", async () => {
    await http().get("/api/initiative-allocation-costs").expect(400);
  });

  it("returns an empty array for an initiative with no allocations", async () => {
    const id = initiativeIdWithNoAllocations();
    const res = await http()
      .get(`/api/initiative-allocation-costs?initiativeId=${encodeURIComponent(id)}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });
});

