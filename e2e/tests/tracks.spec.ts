import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const oval = JSON.parse(
  readFileSync(new URL("../../tracks/track.oval.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test.describe("tracks", () => {
  test("library lists the built-in tracks and opens a detail page", async ({ page }) => {
    await page.goto("/tracks");
    const cards = page.getByTestId("builtin-tracks").getByRole("link");
    await expect(cards).toHaveCount(18);
    await page.getByRole("link", { name: /Figure eight/i }).click();
    await expect(page).toHaveURL(/\/tracks\/track\.figure-eight$/);
    await expect(page.getByTestId("track-details")).toContainText("crossing");
    await expect(page.getByTestId("track-svg")).toBeVisible();
  });

  test("editor builds, validates and saves a track", async ({ page }) => {
    await page.goto("/tracks/edit");
    await expect(page.getByTestId("track-valid")).toBeVisible();
    await expect(page.getByTestId("track-stats")).toContainText("closed loop");

    // An open course: remove the last turn and the loop opens.
    await page.getByRole("button", { name: "Remove step 4" }).click();
    await expect(page.getByTestId("track-stats")).toContainText("open course");

    // A turn tighter than the line is rejected.
    await page.getByLabel("Step 2 type").selectOption("turn");
    await page.locator("[data-testid=steps] li").nth(1).getByRole("spinbutton").nth(1).fill("5");
    await expect(page.getByTestId("track-problems")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.locator("[data-testid=steps] li").nth(1).getByRole("spinbutton").nth(1).fill("150");
    await expect(page.getByTestId("track-valid")).toBeVisible();

    await page.getByLabel("Track name").fill("Test course");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved in this browser.");
    await expect(page).toHaveURL(/id=track\.custom-/);

    // Reload: steps come back from IndexedDB.
    await page.reload();
    await expect(page.getByLabel("Track name")).toHaveValue("Test course");
    await expect(page.locator("[data-testid=steps] li")).toHaveCount(3);

    await page.goto("/tracks");
    await expect(page.getByTestId("saved-tracks")).toContainText("Test course");
  });

  test("photo import sends corners to the vision service and saves the result", async ({
    page,
  }) => {
    let sent = "";
    await page.route("**/api/vision/track-from-image", async (route) => {
      sent = route.request().postData() ?? "";
      await route.fulfill({
        json: {
          track: { ...oval, id: "track.custom-photo", name: "From photo" },
          diagnostics: {
            line_width_mm: 19,
            length_mm: 3570,
            paths: 1,
            confidence: 0.93,
            warnings: [],
          },
        },
      });
    });
    await page.goto("/tracks/import");
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#eee"/></svg>';
    await page
      .getByLabel("Track image")
      .setInputFiles({ name: "track.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
    const img = page.getByAltText("Uploaded track");
    await expect(img).toBeVisible();
    const find = page.getByRole("button", { name: "Find the line" });
    await expect(find).toBeDisabled();
    for (const [x, y] of [
      [10, 10],
      [390, 10],
      [390, 290],
      [10, 290],
    ] as const) {
      const box = await img.boundingBox();
      if (!box) throw new Error("image not laid out");
      await page.mouse.click(box.x + (x / 400) * box.width, box.y + (y / 300) * box.height);
    }
    await expect(page.getByText("All four corners marked.")).toBeVisible();
    await find.click();
    await expect(page.getByTestId("import-diagnostics")).toContainText("confidence 93%");
    expect(sent).toContain('name="corners"');
    expect(sent).toContain('name="width_mm"');

    await page.getByRole("button", { name: "Save and open in editor" }).click();
    await expect(page).toHaveURL(/id=track\.custom-photo/);
    await expect(page.getByText("its shape is fixed here")).toBeVisible();
  });

  test("photo import reports a vision-service error", async ({ page }) => {
    await page.route("**/api/vision/track-from-image", (route) =>
      route.fulfill({ status: 503, json: { detail: "The vision service is not running." } }),
    );
    await page.goto("/tracks/import");
    await page.getByLabel("Known scale").check();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"/>';
    await page
      .getByLabel("Track image")
      .setInputFiles({ name: "t.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
    await page.getByRole("button", { name: "Find the line" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "vision" })).toHaveText(
      "The vision service is not running.",
    );
  });
});
