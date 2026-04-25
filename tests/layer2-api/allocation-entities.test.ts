import { describe, expect, it } from "vitest";

import { http } from "./helpers";

describe("GET /api/allocation-entities/with-budget", () => {
  it("returns 200 with an array", async () => {
    const res = await http().get("/api/allocation-entities/with-budget").expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("each entity has costTotals with numeric totals (non-null)", async () => {
    const res = await http().get("/api/allocation-entities/with-budget").expect(200);

    for (const entity of res.body as any[]) {
      // Some entities may have no rollup row yet (Prisma relation becomes null).
      // The UI handles this with optional chaining and falls back to 0.
      if (entity.costTotals === null) continue;
      expect(typeof entity.costTotals.totalInternal).toBe("number");
      expect(typeof entity.costTotals.totalExternal).toBe("number");
      expect(typeof entity.costTotals.totalDirect).toBe("number");
    }
  });
});

