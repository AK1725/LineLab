import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const fixture = (f: string) =>
  new URL(`../../packages/photo-design/fixtures/nano-tb6612-qtr8a/${f}`, import.meta.url);
const truth = JSON.parse(readFileSync(fixture("truth.json"), "utf8")) as {
  components: { componentId: string; count: number }[];
};
const nameOf = new Map(
  readdirSync(new URL("../../packages/component-db/data/components/", import.meta.url))
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const c = JSON.parse(
        readFileSync(
          new URL(`../../packages/component-db/data/components/${f}`, import.meta.url),
          "utf8",
        ),
      ) as { id: string; name: string };
      return [c.id, c.name];
    }),
);

// The API runs the scripted detector (LINELAB_PHOTO_SCRIPT: hand-written descriptions of the
// fixture robot, with boxes in its render). The vision service isn't running in e2e, so its
// answer for this render is replayed from fixtures (recorded from the real service).
test("photos → parts (top 3) → chassis from the silhouette → confirm wiring → valid design", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route("**/api/vision/robot-outline", (route) =>
    route.fulfill({
      json: JSON.parse(readFileSync(fixture("outline.vision.json"), "utf8")) as unknown,
    }),
  );
  await page.goto("/build");
  await page.getByRole("link", { name: /start from photos/ }).click();
  await expect(page.getByRole("heading", { name: "Robot from photos" })).toBeVisible();
  await page.getByLabel("Add photos").setInputFiles(fixture("top.png").pathname);
  await expect(page.getByLabel("View of photo 1")).toHaveValue("top");
  await page.getByRole("button", { name: "Analyse photos" }).click();

  // Parts: every real part is among the 3 choices; pick it where the first guess is wrong.
  const detections = page.getByTestId("detection");
  await expect(detections).toHaveCount(truth.components.length);
  await expect(page.getByText(/scripted replay/)).toBeVisible();
  let corrected = 0;
  for (let i = 0; i < truth.components.length; i++) {
    const row = detections.nth(i);
    // Three database candidates plus "not on my robot".
    await expect(row.getByRole("radio")).toHaveCount(4);
    const radio = row.getByRole("radio", {
      name: nameOf.get(truth.components[i]?.componentId ?? ""),
      exact: true,
    });
    if (!(await radio.isChecked())) {
      corrected++;
      await radio.check();
    }
    await expect(radio).toBeChecked();
  }
  test.info().annotations.push({ type: "first-guess corrections", description: String(corrected) });
  await page.getByRole("button", { name: "Next: chassis & layout" }).click();
  await expect(page.getByLabel("Chassis", { exact: true })).toHaveValue("photo");
  await expect(page.getByTestId("proposal-notes")).toContainText(
    "Chassis from the top-photo silhouette",
  );
  await expect(page.getByTestId("proposal-notes")).toContainText("10 parts placed");
  await page.getByRole("button", { name: "Next: wiring" }).click();

  const nets = page.getByTestId("proposed-net");
  const n = await nets.count();
  expect(n).toBeGreaterThan(10);
  for (let i = 0; i < n; i++)
    await nets
      .nth(i)
      .getByRole("button", { name: /^Confirm/ })
      .click();
  await expect(page.getByTestId("wiring-status")).toContainText(
    `${n} of ${n} connections confirmed · no errors`,
  );
  await page.getByRole("button", { name: "Create design" }).click();

  await expect(page).toHaveURL(/\/build\/edit\?id=d-/);
  await expect(page.getByTestId("scene")).toBeVisible();
  const d = await page.evaluate(() => {
    const s = (
      window as unknown as {
        __linelabEditor: {
          getState(): {
            history: {
              present: {
                placements: { componentId: string }[];
                netlist: unknown[];
                chassis: { kind: string };
              };
            };
          };
        };
      }
    ).__linelabEditor.getState().history.present;
    return {
      parts: s.placements.map((p) => p.componentId).sort(),
      nets: s.netlist.length,
      chassis: s.chassis.kind,
    };
  });
  expect(d.parts).toEqual(
    truth.components.flatMap((c) => Array<string>(c.count).fill(c.componentId)).sort(),
  );
  expect(d.nets).toBe(n);
  expect(d.chassis).toBe("custom");
  expect(errors).toEqual([]);
});
