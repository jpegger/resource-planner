import { afterEach, describe, expect, it } from "vitest";

import { http, KNOWN_INITIATIVE_ID, KNOWN_RESOURCE_ID } from "./helpers";

let createdId = "";

async function cleanupCreated(): Promise<void> {
  if (!createdId) return;
  await http().delete(`/api/allocations/${encodeURIComponent(createdId)}`);
  createdId = "";
}

describe("GET /api/allocations", () => {
  it("returns 200 with an array for a known initiative and includes resource.type", async () => {
    const res = await http()
      .get(`/api/allocations?initiativeId=${encodeURIComponent(KNOWN_INITIATIVE_ID)}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const first = res.body[0];
    expect(first.resource).toBeDefined();
    expect(["INTERNAL", "EXTERNAL", "DIRECT_COST"]).toContain(first.resource.type);
  });

  it("returns 400 when initiativeId is missing", async () => {
    await http().get("/api/allocations").expect(400);
  });
});

describe("POST /api/allocations", () => {
  afterEach(async () => cleanupCreated());

  it("creates an allocation and returns 201", async () => {
    const res = await http()
      .post("/api/allocations")
      .send({ initiativeId: KNOWN_INITIATIVE_ID, resourceId: KNOWN_RESOURCE_ID })
      .expect(201);

    createdId = res.body.id;
    expect(typeof res.body.id).toBe("string");
    expect(res.body.initiativeId).toBe(KNOWN_INITIATIVE_ID);
    expect(res.body.resourceId).toBe(KNOWN_RESOURCE_ID);
    expect(["INTERNAL", "EXTERNAL", "DIRECT_COST"]).toContain(res.body.resource.type);
  });

  it("returns 400 for invalid JSON body", async () => {
    await http()
      .post("/api/allocations")
      .set("Content-Type", "application/json")
      .send("{not-json")
      .expect(400);
  });

  it("returns 400 when initiativeId is missing", async () => {
    await http().post("/api/allocations").send({ resourceId: KNOWN_RESOURCE_ID }).expect(400);
  });

  it("returns 400 when resourceId is missing", async () => {
    await http().post("/api/allocations").send({ initiativeId: KNOWN_INITIATIVE_ID }).expect(400);
  });

  it("returns 404 when initiativeId is unknown", async () => {
    await http()
      .post("/api/allocations")
      .send({ initiativeId: "RI-DOES-NOT-EXIST", resourceId: KNOWN_RESOURCE_ID })
      .expect(404);
  });

  it("returns 404 when resourceId is unknown", async () => {
    await http()
      .post("/api/allocations")
      .send({ initiativeId: KNOWN_INITIATIVE_ID, resourceId: "MAT-DOES-NOT-EXIST" })
      .expect(404);
  });
});

describe("PATCH /api/allocations/[id]", () => {
  afterEach(async () => cleanupCreated());

  it("patch response includes resource.type", async () => {
    const create = await http()
      .post("/api/allocations")
      .send({ initiativeId: KNOWN_INITIATIVE_ID, resourceId: KNOWN_RESOURCE_ID })
      .expect(201);
    createdId = create.body.id;

    const patch = await http()
      .patch(`/api/allocations/${encodeURIComponent(createdId)}`)
      .send({ quantity: 0.6 })
      .expect(200);

    expect(patch.body.resource).toBeDefined();
    expect(["INTERNAL", "EXTERNAL", "DIRECT_COST"]).toContain(patch.body.resource.type);
  });

  it("returns 400 when no valid fields are provided", async () => {
    await http().patch("/api/allocations/ASS-DOES-NOT-MATTER").send({}).expect(400);
  });

  it("returns 400 when quantity is not a number", async () => {
    const create = await http()
      .post("/api/allocations")
      .send({ initiativeId: KNOWN_INITIATIVE_ID, resourceId: KNOWN_RESOURCE_ID })
      .expect(201);
    createdId = create.body.id;

    await http()
      .patch(`/api/allocations/${encodeURIComponent(createdId)}`)
      .send({ quantity: "abc" })
      .expect(400);
  });

  it("returns 404 when allocation does not exist", async () => {
    await http().patch("/api/allocations/ASS-DOES-NOT-EXIST").send({ quantity: 0.1 }).expect(404);
  });
});

describe("DELETE /api/allocations/[id]", () => {
  afterEach(async () => cleanupCreated());

  it("returns 204 and the row is gone", async () => {
    const create = await http()
      .post("/api/allocations")
      .send({ initiativeId: KNOWN_INITIATIVE_ID, resourceId: KNOWN_RESOURCE_ID })
      .expect(201);
    createdId = create.body.id;

    await http()
      .delete(`/api/allocations/${encodeURIComponent(createdId)}`)
      .expect(204);
    createdId = "";

    await http().delete(`/api/allocations/${encodeURIComponent(create.body.id)}`).expect(404);
  });
});

