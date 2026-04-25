import { afterEach, describe, expect, it } from "vitest";

import {
  ENTITY_MAIN_EOTP,
  ENTITY_WITH_EXCEPTIONS,
  http,
  TEST_YEAR,
  VALID_EOTP,
} from "./helpers";

let createdRoutingId = "";

async function cleanupCreated(): Promise<void> {
  if (!createdRoutingId) return;
  await http().delete(
    `/api/allocation-entities/${encodeURIComponent(ENTITY_WITH_EXCEPTIONS)}/eotp-routing/${encodeURIComponent(createdRoutingId)}`
  );
  createdRoutingId = "";
}

describe("EOTP routing routes", () => {
  afterEach(async () => cleanupCreated());

  it("GET /api/allocation-entities/[id]/eotp-routing returns 200 with an array", async () => {
    const res = await http()
      .get(`/api/allocation-entities/${encodeURIComponent(ENTITY_WITH_EXCEPTIONS)}/eotp-routing`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/allocation-entities/[id]/eotp-routing accepts a valid exception row and returns 201", async () => {
    const res = await http()
      .post(`/api/allocation-entities/${encodeURIComponent(ENTITY_WITH_EXCEPTIONS)}/eotp-routing`)
      .send({
        year: TEST_YEAR,
        eotp: VALID_EOTP,
        internalAmount: 5000,
        externalAmount: 2000,
        directAmount: 0,
      })
      .expect(201);

    createdRoutingId = res.body.id;
    expect(typeof res.body.id).toBe("string");
    expect(res.body.year).toBe(TEST_YEAR);
    expect(res.body.eotp).toBe(VALID_EOTP);
  });

  it("POST rejects eotp equal to sapEotpCode (main bucket guard)", async () => {
    const res = await http()
      .post(`/api/allocation-entities/${encodeURIComponent(ENTITY_WITH_EXCEPTIONS)}/eotp-routing`)
      .send({
        year: TEST_YEAR,
        eotp: ENTITY_MAIN_EOTP,
        internalAmount: 1000,
        externalAmount: 0,
        directAmount: 0,
      })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it("POST rejects missing year", async () => {
    await http()
      .post(`/api/allocation-entities/${encodeURIComponent(ENTITY_WITH_EXCEPTIONS)}/eotp-routing`)
      .send({ eotp: VALID_EOTP, internalAmount: 1000, externalAmount: 0, directAmount: 0 })
      .expect(400);
  });

  it("GET /api/allocation-entities/[id]/eotp-main-from-view returns rows and supports year filter", async () => {
    const all = await http()
      .get(`/api/allocation-entities/${encodeURIComponent(ENTITY_WITH_EXCEPTIONS)}/eotp-main-from-view`)
      .expect((r) => {
        // 200 when views exist, 503 when missing. Both are acceptable integration outcomes.
        if (![200, 503].includes(r.status)) throw new Error(`Unexpected status ${r.status}`);
      });

    if (all.status === 503) {
      expect(all.body.code).toBe("V_EOTP_COSTS_MISSING");
      return;
    }

    expect(Array.isArray(all.body)).toBe(true);

    const year = 2026;
    const filtered = await http()
      .get(
        `/api/allocation-entities/${encodeURIComponent(ENTITY_WITH_EXCEPTIONS)}/eotp-main-from-view?year=${year}`
      )
      .expect(200);

    expect(Array.isArray(filtered.body)).toBe(true);
    for (const row of filtered.body as any[]) {
      expect(row.year).toBe(year);
    }
  });
});

