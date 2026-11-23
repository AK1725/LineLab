import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const reference = JSON.parse(
  readFileSync(
    new URL("../../packages/sim-core/fixtures/reference.design.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

type Hook = { getState(): { load(d: unknown): void; setView(v: string): void } };

/** Open a new design from a template; optionally replace it with the reference robot. */
async function openDesign(page: Page, withReference: boolean) {
  await page.goto("/build");
  await page.getByRole("button", { name: /PCB racer/ }).click();
  await expect(page).toHaveURL(/\/build\/edit\?id=d-/);
  await expect(page.getByTestId("scene")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("id");
  if (withReference) {
    await page.evaluate(
      (d) => {
        (window as unknown as { __linelabEditor: Hook }).__linelabEditor.getState().load(d);
      },
      { ...reference, id },
    );
  }
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("run-start")).toBeVisible();
}

test.describe("run tab", () => {
  test("simulates the reference robot, replays it, and compares runs", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await openDesign(page, true);

    await page.getByLabel("Track").selectOption("track.oval");
    await page.getByTestId("run-start").click();
    await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-outcome", "finished", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("run-metrics")).toContainText(/Lap time\s*4\.\d\d s/);
    await expect(page.getByTestId("run-plots").getByRole("img")).toHaveCount(4);
    await expect(page.getByTestId("run-canvas").locator("canvas")).toBeVisible();

    // Playback runs at the chosen speed; scrubbing and events seek.
    await page.getByLabel("Playback speed").selectOption("4");
    const time = page.getByTestId("replay-time");
    const t0 = await time.textContent();
    await expect(time).not.toHaveText(t0 ?? "");
    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByLabel("Replay time").fill("2000");
    await expect(time).toHaveText(/^2\.00 \//);
    await page
      .getByTestId("run-events")
      .getByRole("button", { name: /lap complete/ })
      .click();
    await expect(time).toHaveText(/^4\.\d\d \//);
    await page.getByLabel("Camera").selectOption("follow");

    // A second run with other gains: the first becomes the ghost.
    await page.getByLabel("Kp").fill("0.6");
    await page.getByTestId("run-start").click();
    await expect(page.getByText(/Ghost: seed 0, Kp 1\.1/)).toBeVisible({ timeout: 30_000 });

    // Monte Carlo over 10 seeds reports robustness.
    await page.getByLabel("Monte Carlo runs").selectOption("10");
    await page.getByTestId("run-start").click();
    await expect(page.getByTestId("monte-carlo")).toContainText(/Robustness: \d+ %/, {
      timeout: 60_000,
    });
    await expect(page.getByTestId("monte-carlo").locator("tbody tr")).toHaveCount(10);

    expect(errors).toEqual([]);
  });

  test("explains what a design needs before it can be simulated", async ({ page }) => {
    await openDesign(page, false);
    await page.getByTestId("run-start").click();
    const alert = page.getByRole("alert").filter({ hasText: "simulate" });
    await expect(alert).toContainText("Add a wheel on each side.");
    await expect(alert).toContainText("Add a line sensor.");
  });

  test("a hard track fails plausibly", async ({ page }) => {
    await openDesign(page, true);
    await page.getByLabel("Track").selectOption("track.acute-angles");
    await page.getByTestId("run-start").click();
    await expect(page.getByTestId("run-outcome")).not.toHaveAttribute("data-outcome", "finished", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("run-events")).toContainText(/off track|stuck/);
  });
});
