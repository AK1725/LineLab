import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function addPart(page: Page, query: string, name: string) {
  await page.getByLabel("Search parts to add").fill(query);
  await page.getByRole("button", { name: `Add ${name}`, exact: true }).click();
}

async function referenceRobot(page: Page) {
  await page.goto("/build");
  await page.getByRole("button", { name: /PCB racer/ }).click();
  await expect(page).toHaveURL(/\/build\/edit\?id=d-/);
  await addPart(page, "nano", "Arduino Nano (ATmega328P)");
  await addPart(page, "tb6612", "TB6612FNG dual motor driver carrier");
  await addPart(page, "qtr8", "Pololu QTR-8A reflectance sensor array (analog)");
  await addPart(page, "hp 30:1", "Pololu micro metal gearmotor HP 6V 30:1");
  await addPart(page, "hp 30:1", "Pololu micro metal gearmotor HP 6V 30:1");
  await addPart(page, "pololu wheel 32", "Pololu wheel 32×7 mm");
  await addPart(page, "pololu wheel 32", "Pololu wheel 32×7 mm");
  await addPart(page, "skid", "Nylon skid pad (low-friction glide)");
  await addPart(page, "d24v10f5", "Pololu D24V10F5 5 V 1 A step-down regulator");
  await addPart(page, "2s 300", "LiPo 2S 300 mAh 25C");
}

const finding = (page: Page, rule: string) =>
  page.locator(`[data-testid=finding][data-rule="${rule}"]`);

test.describe("wiring and checks", () => {
  test("auto-wire, then one-click fixes take the reference robot to zero problems", async ({
    page,
  }) => {
    await referenceRobot(page);
    // Unwired, the robot already shows problems (e.g. no sensor outputs read).
    await expect(page.getByTestId("finding").first()).toBeVisible();

    await page.getByRole("tab", { name: "Wiring" }).click();
    await page.getByRole("button", { name: "Auto-wire" }).click();
    await expect(page.getByTestId("net-count")).not.toHaveText("0 nets");

    // Remaining issues are geometric and come with fixes.
    await expect(finding(page, "mech.sensor-height")).toBeVisible();
    await finding(page, "mech.sensor-height").getByRole("button", { name: /^Fix:/ }).click();
    await expect(finding(page, "mech.sensor-height")).toHaveCount(0);
    await finding(page, "mech.caster-gap").getByRole("button", { name: /^Fix:/ }).click();
    await expect(page.getByTestId("checks")).toContainText("No problems found.");

    // Break the driver standby pin by hand; the rule catches it and its fix restores it.
    await page.getByRole("button", { name: /motor-driver1 TB6612FNG/ }).click();
    await page.getByRole("button", { name: "Disconnect motor-driver1.STBY" }).click();
    await expect(finding(page, "elec.standby-unconnected")).toBeVisible();
    await finding(page, "elec.standby-unconnected").getByRole("button", { name: /^Fix:/ }).click();
    await expect(page.getByTestId("checks")).toContainText("No problems found.");

    // A fix is one undo step.
    await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
    await expect(finding(page, "elec.standby-unconnected")).toBeVisible();
  });

  test("connect two pins by clicking them", async ({ page }) => {
    await page.goto("/build");
    await page.getByRole("button", { name: /Starter 2WD/ }).click();
    await addPart(page, "nano", "Arduino Nano (ATmega328P)");
    await addPart(page, "led", "5 mm red LED");
    await page.getByRole("tab", { name: "Wiring" }).click();
    await page.getByRole("button", { name: "Pin mcu1.D13, unconnected" }).click();
    await page.getByRole("button", { name: /indicator1 5 mm red LED/ }).click();
    await page.getByRole("button", { name: "Pin indicator1.A, unconnected" }).click();
    await expect(page.getByTestId("net-count")).toHaveText("1 nets");
    await expect(page.getByRole("button", { name: /Pin indicator1\.A, on net/ })).toBeVisible();
  });

  test("schematic view and KiCad export", async ({ page }) => {
    await referenceRobot(page);
    await page.getByRole("tab", { name: "Wiring" }).click();
    await page.getByRole("button", { name: "Auto-wire" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    const svg = page.getByTestId("schematic");
    await expect(svg).toBeVisible();
    await expect(svg).toContainText("GND");
    await expect(svg).toContainText("VBAT");
    await expect(svg).toContainText("PWMA");

    const [net] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "KiCad netlist (download)" }).click(),
    ]);
    const text = readFileSync(await net.path(), "utf8");
    expect(text).toMatch(/^\(export \(version "E"\)/);
    expect(text).toContain('(name "GND")');
    const [svgFile] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "SVG", exact: true }).click(),
    ]);
    expect(readFileSync(await svgFile.path(), "utf8")).toContain("<svg");
  });
});
