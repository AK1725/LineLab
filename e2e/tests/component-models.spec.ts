import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const dataDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packages",
  "component-db",
  "data",
  "components",
);
const ids = readdirSync(dataDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -".json".length))
  .sort();

test.describe.configure({ mode: "parallel" });

test("the catalog has at least 120 components", () => {
  expect(ids.length).toBeGreaterThanOrEqual(120);
});

for (const id of ids) {
  test(`3D model renders: ${id}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`/components/${id}`);
    const viewer = page.getByTestId("model-viewer");
    await expect(viewer).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
    expect(Number(await viewer.getAttribute("data-mesh-count"))).toBeGreaterThan(0);
    await expect(viewer.locator("canvas")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();

    expect(errors).toEqual([]);
  });
}
