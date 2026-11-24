import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const reference = JSON.parse(
  readFileSync(
    new URL("../../packages/sim-core/fixtures/reference.design.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

type Hook = { getState(): { load(d: unknown): void } };

test("BOM → sign in by email → publish → gallery → fork", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (m) => {
    // The session probe before sign-in answers 200 with user null; nothing should error.
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/build");
  await page.getByRole("button", { name: /PCB racer/ }).click();
  await expect(page.getByTestId("scene")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("id") ?? "";
  const title = `E2E racer ${String(Date.now())}`;
  await page.evaluate(
    (d) => {
      (window as unknown as { __linelabEditor: Hook }).__linelabEditor.getState().load(d);
    },
    { ...reference, id, name: title },
  );

  // Bill of materials: real parts, typical prices from the database.
  await page.getByRole("button", { name: "Bill of materials: parts, mass and cost" }).click();
  const bom = page.getByRole("dialog", { name: "Bill of materials" });
  await expect(
    bom.getByRole("cell", { name: "Arduino Nano (ATmega328P)", exact: true }),
  ).toBeVisible();
  await expect(bom.getByTestId("bom-total")).toHaveText(/^\$\d+\.\d\d$/);
  await bom.getByRole("button", { name: "Close" }).click();

  // Publishing needs an account: sign in with an emailed link (returned directly in dev).
  await page.getByRole("button", { name: "Publish this robot to the gallery" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("link", { name: "open the sign-in link" }).click();
  await expect(page).toHaveURL(new RegExp(`/build/edit\\?id=${id}`));
  await expect(page.getByText("e2e", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Publish this robot to the gallery" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish to the gallery" });
  await expect(dialog.getByLabel("Title")).toHaveValue(title);
  await dialog.getByLabel("Description").fill("Published by the e2e test.");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog.getByText("Published version 1")).toBeVisible();
  await dialog.getByRole("link", { name: "open it in the gallery" }).click();

  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/by e2e · version 1 · 0 forks/)).toBeVisible();
  const itemUrl = page.url();
  await page.getByRole("link", { name: "Gallery" }).click();
  await page.getByRole("searchbox", { name: "Search the gallery" }).fill(title);
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();

  await page.goto(itemUrl);
  await page.getByRole("button", { name: "Fork this robot" }).click();
  await expect(page).toHaveURL(/\/build\/edit\?id=d-/);
  const forked = await page.evaluate(
    () =>
      (
        window as unknown as {
          __linelabEditor: {
            getState(): {
              history: { present: { id: string; name: string; placements: unknown[] } };
            };
          };
        }
      ).__linelabEditor.getState().history.present,
  );
  expect(forked.name).toBe(`${title} (fork)`);
  expect(forked.id).not.toBe(id);
  expect(forked.placements).toHaveLength((reference.placements as unknown[]).length);
  await page.goto(itemUrl);
  await expect(page.getByText(/1 fork\b/)).toBeVisible();
  expect(errors).toEqual([]);
});
