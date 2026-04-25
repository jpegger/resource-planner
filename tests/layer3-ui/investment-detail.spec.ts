import { expect, test } from "@playwright/test";

const ENTITY_ID = "PRD-CRM";

test.describe("/investments/[id]", () => {
  test("detail page loads without error boundary", async ({ page }) => {
    await page.goto(`/investments/${encodeURIComponent(ENTITY_ID)}`);
    await expect(page.getByText("Something went wrong.")).not.toBeVisible();
  });

  test("year filter buttons are present", async ({ page }) => {
    await page.goto(`/investments/${encodeURIComponent(ENTITY_ID)}`);
    await expect(page.locator("label").filter({ hasText: /^Year$/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^\d{4}$/ }).first()).toBeVisible();
  });

  test("resource allocations panel and totals headers render", async ({ page }) => {
    await page.goto(`/investments/${encodeURIComponent(ENTITY_ID)}`);

    await expect(page.getByText("Resource allocations")).toBeVisible();
    await expect(page.getByText("Internal", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("External", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Direct", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Total", { exact: true }).first()).toBeVisible();
  });

  test("k-format appears in totals strip or allocation rows", async ({ page }) => {
    await page.goto(`/investments/${encodeURIComponent(ENTITY_ID)}`);
    await expect(page.getByText(/k$/).first()).toBeVisible();
  });
});

