import { expect, test } from "@playwright/test";

test("home page shows the product name and roadmap without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page).toHaveTitle("LineLab");
  await expect(page.getByRole("heading", { level: 1, name: "LineLab" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(12);

  expect(errors).toEqual([]);
});

test("home page fits a phone screen without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
