import { expect, test } from "@playwright/test";

test.describe("/investments", () => {
  test("page loads", async ({ page }) => {
    await page.goto("/investments");
    await expect(page.getByText("Something went wrong.")).not.toBeVisible();
  });

  test("investments table is visible", async ({ page }) => {
    await page.goto("/investments");
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("table headers match current UI", async ({ page }) => {
    await page.goto("/investments");

    await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Family" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Division" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Team" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "SAP EOTP" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "INT" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "EXT" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "DIR" })).toBeVisible();
  });

  test("monetary cells are formatted with k or —", async ({ page }) => {
    await page.goto("/investments");

    const kCells = page.getByRole("cell").filter({ hasText: /\d+k$/ });
    const dashCells = page.getByRole("cell").filter({ hasText: /^—$/ });

    // Use counts to avoid strict-mode collisions.
    const kCount = await kCells.count();
    const dashCount = await dashCells.count();
    expect(kCount + dashCount).toBeGreaterThan(0);
  });
});

