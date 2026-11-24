import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const reference = JSON.parse(
  readFileSync(
    new URL("../../packages/sim-core/fixtures/reference.design.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

/** axe-core WCAG 2.1 A/AA checks; the acceptance bar is no critical issues (serious ones too). */
async function audit(page: Page, label: string) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // The WebGL canvas has no DOM content to check.
    .exclude("canvas")
    .analyze();
  const bad = r.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map(
      (v) =>
        `${label}: ${v.id} (${v.impact ?? ""}) ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(" | ")}`,
    );
  expect(bad).toEqual([]);
}

for (const [path, label] of [
  ["/", "home"],
  ["/build", "build"],
  ["/build/from-photos", "photos"],
  ["/tracks", "tracks"],
  ["/components", "components"],
  ["/gallery", "gallery"],
  ["/learn", "learn"],
  ["/learn/why-it-oscillates", "lesson"],
  ["/signin", "sign in"],
] as const) {
  test(`axe: ${label}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await audit(page, label);
  });
}

test("axe: editor and a finished run", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/build");
  await page.getByRole("button", { name: /PCB racer/ }).click();
  await expect(page.getByTestId("scene")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("id");
  await page.evaluate(
    (d) => {
      (
        window as unknown as { __linelabEditor: { getState(): { load(x: unknown): void } } }
      ).__linelabEditor
        .getState()
        .load(d);
    },
    { ...reference, id },
  );
  await audit(page, "editor");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByTestId("run-start").click();
  await expect(page.getByTestId("run-outcome")).toBeVisible({ timeout: 60_000 });
  await audit(page, "run (after)");
});

test("axe: home and editor in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await audit(page, "home (dark)");
  await page.goto("/build");
  await page.getByRole("button", { name: /Starter 2WD/ }).click();
  await expect(page.getByTestId("scene")).toBeVisible();
  await audit(page, "editor (dark)");
});
