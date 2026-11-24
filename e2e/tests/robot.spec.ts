import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { installFakeSerial } from "./fake-nano.js";

const repo = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const reference = JSON.parse(repo("packages/sim-core/fixtures/reference.design.json")) as Record<
  string,
  unknown
>;
const artifact = JSON.parse(
  repo("examples/firmware/telemetry_pid/telemetry_pid.nano.artifact.json"),
) as { hex: string };

type Hook = { getState(): { load(d: unknown): void } };

async function openReference(page: Page) {
  await page.goto("/build");
  await page.getByRole("button", { name: /PCB racer/ }).click();
  await expect(page).toHaveURL(/\/build\/edit\?id=d-/);
  await expect(page.getByTestId("scene")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("id");
  await page.evaluate(
    (d) => {
      (window as unknown as { __linelabEditor: Hook }).__linelabEditor.getState().load(d);
    },
    { ...reference, id },
  );
}

test("robot tab: connect over (fake) Web Serial, live telemetry, record, flash with STK500", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.addInitScript(installFakeSerial);
  await page.route("**/api/compile", (route) =>
    route.fulfill({ json: { ok: true, artifact, log: "" } }),
  );
  await page.route("**/api/analyze", (route) => route.fulfill({ json: { findings: [], log: "" } }));
  await openReference(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByTestId("code-editor").locator(".monaco-editor")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Compile" }).click();
  await expect(page.getByTestId("build-status")).toHaveAttribute("data-status", "ok");

  await page.getByRole("button", { name: "Robot", exact: true }).click();
  await page.getByRole("button", { name: "USB serial…" }).click();
  await expect(page.getByText(/Connected: USB serial 1a86:7523 @ 115200/)).toBeVisible();
  await expect(page.getByText(/Sketch "fake_nano", 8 sensors every 10 ms/)).toBeVisible();
  await expect(page.getByTestId("live-telemetry")).toBeVisible();
  await expect(page.getByRole("img", { name: "Variables plot" })).toBeVisible();

  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByTestId("recording-summary")).toContainText(/fake_nano: \d{2,3} samples/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recording" }).click();
  expect((await download).suggestedFilename()).toBe("fake_nano.recording.json");

  await page.getByRole("button", { name: "Flash", exact: true }).click();
  await expect(page.getByText(/Flashed and verified \d+ bytes \(\d+ pages\)/)).toBeVisible({
    timeout: 30_000,
  });
  // The fake bootloader holds exactly the compiled image, and the sketch is back streaming.
  const flashed = await page.evaluate(() => {
    const f = (window as unknown as { __fakeNano: { flash: Uint8Array; stats: unknown } })
      .__fakeNano;
    return { stats: f.stats, head: [...f.flash.subarray(0, 64)] };
  });
  expect(flashed.stats).toMatchObject({ resets: 1, bootBaud: 115200, left: true });
  const firstLine = (artifact.hex.split("\n")[0] ?? "").trim();
  const firstBytes = (firstLine.slice(9, -2).match(/../g) ?? []).map((h) => parseInt(h, 16));
  expect(flashed.head.slice(0, firstBytes.length)).toEqual(firstBytes);
  const before = await page.getByText(/samples, \d+ bad frames/).textContent();
  await expect(page.getByText(/samples, \d+ bad frames/)).not.toHaveText(before ?? "");
  expect(errors).toEqual([]);
});

test("robot tab: calibrate the twin from the synthetic demo, apply, auto-tune", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openReference(page);
  await page.getByRole("button", { name: "Robot", exact: true }).click();
  await page.getByRole("button", { name: "Load synthetic demo" }).click();
  await expect(page.getByTestId("recording-summary")).toContainText(
    "Synthetic, not real robot data",
  );
  await page.getByRole("button", { name: "Calibrate twin" }).click();
  const result = page.getByTestId("calibration-result");
  await expect(result).toBeVisible({ timeout: 180_000 });
  const pct = Number(/\((\d+) % lower\)/.exec((await result.textContent()) ?? "")?.[1]);
  expect(pct).toBeGreaterThanOrEqual(40);
  await page.getByRole("button", { name: "Apply to design" }).click();
  await expect(page.getByText(/This design is calibrated/)).toBeVisible();
  const cal = await page.evaluate(
    () =>
      (
        window as unknown as {
          __linelabEditor: { getState(): { history: { present: { calibration?: object } } } };
        }
      ).__linelabEditor.getState().history.present.calibration,
  );
  expect(cal).toHaveProperty("sensorGain");

  await page.getByRole("button", { name: "Auto-tune PID" }).click();
  await expect(page.getByTestId("autotune-result")).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Use in simulator" }).click();
  await expect(page.getByTestId("run-start")).toBeVisible();
});
