import { expect, test, type Page } from "@playwright/test";

const firstResult = (page: Page) => page.getByTestId("results").locator("li").first();

test.describe("component search", () => {
  for (const [query, expected] of [
    ["l298", "L298N dual H-bridge module"],
    ["qtr8", "Pololu QTR-8A reflectance sensor array (analog)"],
    ["n20 1000", "N20 6V 1000 RPM gearmotor (generic)"],
    ["esp32 s3", "ESP32-S3-DevKitC-1"],
    ["tb6612", "TB6612FNG dual motor driver carrier"],
  ] as const) {
    test(`"${query}" lists ${expected} first`, async ({ page }) => {
      await page.goto("/components");
      await page.getByLabel("Search components").fill(query);
      await expect(firstResult(page)).toContainText(expected);
    });
  }

  test("search and filters are kept in the URL and restored on reload", async ({ page }) => {
    await page.goto("/components");
    await page.getByLabel("Search components").fill("pololu");
    await page.getByRole("button", { name: /^Line sensors/ }).click();
    await expect(page).toHaveURL(/q=pololu/);
    await expect(page).toHaveURL(/cat=line_sensor/);

    await page.reload();
    await expect(page.getByLabel("Search components")).toHaveValue("pololu");
    await expect(page.getByRole("button", { name: /^Line sensors/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const items = page.getByTestId("results").locator("li");
    await expect(items.first()).toContainText("Line sensor");
    for (const text of await items.allInnerTexts()) expect(text).toContain("Line sensor");
  });

  test("shows close spellings for a typo", async ({ page }) => {
    await page.goto("/components?q=tb6621");
    await expect(firstResult(page)).toContainText("TB6612FNG");
    await expect(page.getByTestId("result-count")).toContainText("close spellings");
  });

  test("opens a component page with specs, pins and a review warning", async ({ page }) => {
    await page.goto("/components?q=tb6612");
    await firstResult(page).getByRole("link").click();
    await expect(page).toHaveURL(/\/components\/driver\.tb6612fng$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "TB6612FNG dual motor driver carrier",
    );
    await expect(page.getByRole("definition").filter({ hasText: "4.5–13.5 V" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "STBY", exact: true })).toBeVisible();
    await expect(page.getByTestId("needs-review")).toBeVisible();
  });

  test("unknown component ids are a 404", async ({ page }) => {
    const res = await page.goto("/components/driver.does-not-exist");
    expect(res?.status()).toBe(404);
  });

  test("component page fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto("/components/mcu.esp32-devkitc");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
