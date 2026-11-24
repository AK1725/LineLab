import { readFileSync } from "node:fs";
import { Design } from "@linelab/schema";
import { expect, test, type Page } from "@playwright/test";

/** The subset of the editor store the tests poke at through `window.__linelabEditor`. */
interface EditorHandle {
  getState(): {
    history: {
      present: {
        placements: {
          instanceId: string;
          componentId: string;
          position: { x: number; y: number; z: number };
          rotation: { z: number; w: number };
        }[];
      };
    };
    selection: string[];
    addComponent(id: string): string | undefined;
    select(ids: string[]): void;
    setView(v: "orbit" | "top" | "side"): void;
    setPerfMode(on: boolean): void;
    setGrid(mm: number): void;
  };
}
declare global {
  interface Window {
    __linelabEditor?: EditorHandle;
    __linelabFrames?: number;
    __linelabRender?: { calls: number; triangles: number; cpuMs: number };
    __linelabProject?: (x: number, y: number, z: number) => { x: number; y: number };
  }
}

const scene = (page: Page) => page.getByTestId("scene");

async function startFrom(page: Page, template: RegExp) {
  await page.goto("/build");
  await page.getByRole("button", { name: template }).click();
  await expect(page).toHaveURL(/\/build\/edit\?id=d-/);
  await expect(scene(page).locator("canvas")).toBeVisible();
}

async function addPart(page: Page, query: string, name: string) {
  await page.getByLabel("Search parts to add").fill(query);
  await page.getByRole("button", { name: `Add ${name}`, exact: true }).click();
}

const placements = (page: Page) =>
  page.evaluate(() => window.__linelabEditor?.getState().history.present.placements ?? []);

test.describe("assembly editor", () => {
  test("builds a complete 2WD robot from a template in under 3 minutes", async ({ page }) => {
    const started = Date.now();
    await startFrom(page, /Starter 2WD/);

    await addPart(page, "nano", "Arduino Nano (ATmega328P)");
    await addPart(page, "tb6612", "TB6612FNG dual motor driver carrier");
    await addPart(page, "qtr8", "Pololu QTR-8A reflectance sensor array (analog)");
    await addPart(page, "tt 1:48", "TT gearmotor 1:48 (yellow, 3–6 V)");
    await addPart(page, "tt 1:48", "TT gearmotor 1:48 (yellow, 3–6 V)");
    await addPart(page, "tt wheel", "TT motor wheel 65 mm");
    await addPart(page, "tt wheel", "TT motor wheel 65 mm");
    await addPart(page, "caster 3/4", 'Pololu ball caster, 3/4" metal ball');
    await addPart(page, "2s lipo", "LiPo 2S 450 mAh 30C");

    await expect(scene(page)).toHaveAttribute("data-parts", "9");
    await expect(scene(page)).toHaveAttribute("data-collisions", "0");
    await expect(page.getByTestId("collision-count")).toHaveText("0");
    await expect(page.getByTestId("track-width")).toHaveText("132.0 mm");
    await expect(page.getByTestId("mass-total")).toHaveText(/^\d+\.\d g$/);
    await expect(page.getByTestId("lookahead")).toHaveText(/mm$/);
    await expect(page.getByTestId("label-cog")).toBeVisible();

    // Lower the sensor array onto spacers until it sits in its ideal 3–6 mm band.
    const sensor = (await placements(page)).find((p) => p.componentId === "sensor.pololu-qtr-8a");
    expect(sensor).toBeDefined();
    await page.evaluate(
      (id) => window.__linelabEditor?.getState().select([id]),
      sensor?.instanceId ?? "",
    );
    await page.getByLabel("Spacer above, mm").fill("36");
    await page.getByLabel("Spacer above, mm").press("Enter");
    await expect(page.getByTestId("sensor-height")).toContainText("in range");

    // Export the design and check it is a valid LineLab document.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export JSON (download the design)" }).click(),
    ]);
    const file = await download.path();
    const parsed = Design.safeParse(JSON.parse(readFileSync(file, "utf8")));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.placements).toHaveLength(9);

    expect(Date.now() - started).toBeLessThan(180_000);

    // It survives a reload (saved in the browser).
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
    await page.reload();
    await expect(scene(page)).toHaveAttribute("data-parts", "9");
  });

  test("dragging a part moves it and snaps to the grid; one undo puts it back", async ({
    page,
  }) => {
    await startFrom(page, /PCB racer/);
    await addPart(page, "tb6612", "TB6612FNG dual motor driver carrier");
    await page.getByRole("button", { name: "Top", exact: true }).click();
    await expect(scene(page)).toHaveAttribute("data-view", "top");
    await page.waitForTimeout(300);

    const before = (await placements(page))[0];
    if (!before) throw new Error("no part");
    const from = await page.evaluate(
      (p) => window.__linelabProject?.(p.x, p.y, p.z + 2),
      before.position,
    );
    const to = await page.evaluate(
      (p) => window.__linelabProject?.(p.x + 23, p.y - 12, p.z + 2),
      before.position,
    );
    if (!from || !to) throw new Error("projection hook missing");

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++)
      await page.mouse.move(
        from.x + ((to.x - from.x) * i) / 10,
        from.y + ((to.y - from.y) * i) / 10,
      );
    await page.mouse.up();

    const after = (await placements(page))[0];
    if (!after) throw new Error("part vanished");
    expect(after.position.x).toBeGreaterThan(before.position.x + 15);
    expect(after.position.y).toBeLessThan(before.position.y - 5);
    expect(after.position.x % 5).toBeCloseTo(0, 6);
    expect(after.position.y % 5).toBeCloseTo(0, 6);
    expect(await page.evaluate(() => window.__linelabEditor?.getState().selection)).toEqual([
      after.instanceId,
    ]);

    await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
    expect((await placements(page))[0]?.position).toEqual(before.position);
  });

  test("keyboard: rotate, nudge, duplicate, delete, undo and redo", async ({ page }) => {
    await startFrom(page, /Starter 2WD/);
    await addPart(page, "nano", "Arduino Nano (ATmega328P)");
    const id = (await placements(page))[0]?.instanceId ?? "";
    await page.getByTestId("scene").click({ position: { x: 5, y: 5 } }); // focus the page, not the search box
    await page.evaluate((i) => window.__linelabEditor?.getState().select([i]), id);

    await page.keyboard.press("r");
    const yaw = (q: { z: number; w: number }) => (2 * Math.atan2(q.z, q.w) * 180) / Math.PI;
    expect(yaw((await placements(page))[0]?.rotation ?? { z: 0, w: 1 })).toBeCloseTo(90, 6);

    const x0 = (await placements(page))[0]?.position.x ?? 0;
    await page.keyboard.press("ArrowUp");
    expect((await placements(page))[0]?.position.x).toBeCloseTo(x0 + 5, 6);

    await page.keyboard.press("Control+d");
    expect(await placements(page)).toHaveLength(2);
    await page.keyboard.press("Delete");
    expect(await placements(page)).toHaveLength(1);
    await page.keyboard.press("Control+z");
    expect(await placements(page)).toHaveLength(2);
    await page.keyboard.press("Control+Shift+z");
    expect(await placements(page)).toHaveLength(1);
  });

  test("custom chassis: preset shape, live plate mass, DXF and STL export", async ({ page }) => {
    await startFrom(page, /Starter 2WD/);
    await page.getByRole("button", { name: "Chassis…" }).click();
    await page.getByRole("tab", { name: "Custom" }).click();
    const mass = page.getByTestId("custom-chassis-mass");
    const before = await mass.innerText();
    await page.getByLabel("Outline preset").selectOption("t-nose");
    await page.getByRole("button", { name: "Use this shape" }).click();
    await expect(mass).not.toHaveText(before);
    await expect(page.getByTestId("outline-vertex").first()).toBeVisible();
    await page.getByRole("button", { name: "Apply custom chassis" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const [dxf] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /as DXF/ }).click(),
    ]);
    expect(readFileSync(await dxf.path(), "utf8")).toMatch(/AC1009[\s\S]*POLYLINE[\s\S]*EOF/);
    const [stl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /as STL/ }).click(),
    ]);
    expect(readFileSync(await stl.path(), "utf8")).toMatch(/^solid linelab_chassis/);
  });

  test("switching templates keeps parts and re-seats them on the new deck", async ({ page }) => {
    await startFrom(page, /Starter 2WD/);
    await addPart(page, "nano", "Arduino Nano (ATmega328P)");
    const z0 = (await placements(page))[0]?.position.z ?? 0;
    await page.getByRole("button", { name: "Chassis…" }).click();
    await page.getByRole("button", { name: /PCB racer/ }).click();
    const z1 = (await placements(page))[0]?.position.z ?? 0;
    expect(z0).toBeCloseTo(46.75, 6);
    expect(z1).toBeCloseTo(22.6, 6);
    await page.keyboard.press("Control+z");
    expect((await placements(page))[0]?.position.z).toBeCloseTo(46.75, 6);
  });

  test("imports an exported design as a new design", async ({ page }) => {
    await startFrom(page, /maze solver/i);
    await addPart(page, "nano", "Arduino Nano (ATmega328P)");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export JSON (download the design)" }).click(),
    ]);
    const path = await download.path();
    await page.goto("/build");
    await page.getByLabel("Import design JSON").setInputFiles(path);
    await expect(page).toHaveURL(/\/build\/edit\?id=d-/);
    await expect(scene(page)).toHaveAttribute("data-parts", "1");
    await page.goto("/build");
    await expect(page.getByTestId("saved-designs").locator("li")).toHaveCount(2);
  });

  test("60 parts stay inside the rendering budget", async ({ page }) => {
    await startFrom(page, /4WD robust/);
    const ids = [
      "mcu.arduino-uno-r3",
      "driver.l298n-module",
      "sensor.pololu-qtr-8a",
      "motor.tt-1-48",
      "wheel.tt-65mm",
      "battery.18650-2s-holder",
      "regulator.lm2596-module",
      "mech.standoff-m3-20-brass",
      "display.ssd1306-0-96",
      "sensor.hc-sr04",
      "indicator.led-5mm-red",
      "mcu.esp32-devkitc",
    ];
    await page.evaluate((list) => {
      const st = window.__linelabEditor?.getState();
      for (let i = 0; i < 60; i++) st?.addComponent(list[i % list.length] ?? "");
    }, ids);
    await expect(scene(page)).toHaveAttribute("data-parts", "60");
    await page.evaluate(() => window.__linelabEditor?.getState().setPerfMode(true));
    await page.waitForTimeout(1500);
    const result = await page.evaluate(async () => {
      const f0 = window.__linelabFrames ?? 0;
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 2000));
      return {
        fps: ((window.__linelabFrames ?? 0) - f0) / ((performance.now() - t0) / 1000),
        ...window.__linelabRender,
      };
    });
    test.info().annotations.push({ type: "perf", description: JSON.stringify(result) });
    // Budgets that let a real GPU hold 60 fps. (CI and the dev container render on the CPU via
    // SwiftShader, so raw fps there is not meaningful; see docs/PROGRESS.md.)
    expect(result.calls).toBeLessThanOrEqual(300);
    expect(result.triangles).toBeLessThanOrEqual(100_000);
    expect(result.cpuMs).toBeLessThan(8);
    expect(result.fps).toBeGreaterThan(0);
  });
});
