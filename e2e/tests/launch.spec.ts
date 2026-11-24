import { expect, test } from "@playwright/test";

test("learn mode: the oscillation lesson opens a robot whose run shows the oscillation", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/learn");
  await page.getByRole("link", { name: /Why your robot oscillates/ }).click();
  await expect(page.getByText("0 of 4 steps done")).toBeVisible();
  await page.getByRole("checkbox", { name: /Run the lesson robot/ }).check();
  await expect(page.getByText("1 of 4 steps done")).toBeVisible();
  await page.getByRole("button", { name: "Open the lesson robot" }).click();
  await expect(page).toHaveURL(/view=run/);
  await expect(page.getByLabel("Controller")).toHaveValue("firmware");
  await page.getByTestId("run-start").click();
  await expect(
    page.getByTestId("run-events").locator('[data-type="oscillation"]').first(),
  ).toBeVisible({
    timeout: 60_000,
  });
  // Progress is remembered.
  await page.goto("/learn/why-it-oscillates");
  await expect(page.getByText("1 of 4 steps done")).toBeVisible();
});

test("i18n scaffolding: switch to Spanish, and it sticks", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("es");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Construir" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.reload();
  await expect(page.getByRole("link", { name: "Construir un robot" })).toBeVisible();
  await page.getByLabel("Idioma").selectOption("en");
  await expect(page.getByRole("link", { name: "Build a robot" })).toBeVisible();
});

test("offline: after one visit the studio loads and edits designs without a network", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Visit the builder and open a design online, so the editor's code is cached too.
  await page.goto("/build");
  await page.getByRole("button", { name: /PCB racer/ }).click();
  await expect(page.getByTestId("scene")).toBeVisible();
  const url = page.url();

  await context.setOffline(true);
  await page.goto("/build");
  await expect(page.getByRole("heading", { name: "Build a robot" })).toBeVisible();
  await page.goto(url);
  await expect(page.getByTestId("scene")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Saved")).toBeVisible();
  await context.setOffline(false);
});
