import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const repo = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const reference = JSON.parse(repo("packages/sim-core/fixtures/reference.design.json")) as Record<
  string,
  unknown
>;
const buggySource = repo("examples/firmware/buggy/blocking_delay/blocking_delay.ino");
// Real arduino-cli output for that sketch (committed fixture), served in place of a compiler.
const buggyArtifact = JSON.parse(
  repo("examples/firmware/buggy/blocking_delay/blocking_delay.nano.artifact.json"),
) as unknown;

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

test.describe("run report", () => {
  test("a blocking delay is found statically and at runtime, linked to its line", async ({
    page,
  }) => {
    await page.route("**/api/compile", (route) =>
      route.fulfill({ json: { ok: true, artifact: buggyArtifact, log: "" } }),
    );
    await page.route("**/api/analyze", (route) =>
      route.fulfill({
        json: {
          findings: [
            {
              tool: "cppcheck",
              ruleId: "cppcheck.variableScope",
              severity: "info",
              file: "sketch.ino",
              line: 22,
              message: "The scope of the variable can be reduced.",
            },
          ],
          log: "",
        },
      }),
    );
    await openReference(page);
    await page.getByRole("button", { name: "Code", exact: true }).click();
    const editor = page.getByTestId("code-editor").locator(".monaco-editor");
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("analysis-clean")).toBeVisible();

    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(buggySource);
    // LineLab's rules run as you type.
    const analysis = page.getByTestId("analysis");
    await expect(analysis.locator('[data-rule="lfr.delay-in-loop"]')).toContainText(
      "Line 69: delay(25) in loop()",
    );

    await page.getByRole("button", { name: "Compile" }).click();
    await expect(page.getByTestId("build-status")).toHaveAttribute("data-status", "ok");
    await expect(analysis.locator('[data-rule="cppcheck.variableScope"]')).toContainText("Line 22");

    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByLabel("Controller").selectOption("firmware");
    await page.getByTestId("run-start").click();
    await expect(page.getByTestId("run-outcome")).toBeVisible({ timeout: 60_000 });
    const blocking = page.getByTestId("run-events").locator('[data-type="blocking_delay"]');
    await expect(blocking).toHaveAttribute("data-severity", "error");
    await expect(blocking).toContainText("blocks for 25 ms");
    await expect(page.getByTestId("report-lint")).toContainText("delay(25) in loop()");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download report (Markdown)" }).click();
    const md = readFileSync(await (await downloadPromise).path(), "utf8");
    expect(md).toContain("**blocking delay** (error)");
    expect(md).toContain("sketch.ino:69");

    // The event's line link opens the Code tab at that line.
    await blocking.getByTestId("source-link").click();
    await expect(page.getByRole("button", { name: "Code", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByTestId("code-editor").getByText('delay(25);  // "give the motors time to react"'),
    ).toBeVisible();
  });

  test("reference runs get explained events too", async ({ page }) => {
    await openReference(page);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByLabel("Track").selectOption("track.acute-angles");
    await page.getByTestId("run-start").click();
    await expect(page.getByTestId("run-outcome")).not.toHaveAttribute("data-outcome", "finished", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("report-counts")).toContainText(/[1-9]\d* error/);
    await expect(
      page.getByTestId("run-events").locator('[data-severity="error"]').first(),
    ).toBeVisible();
    await expect(page.getByTestId("run-events")).toContainText(/turn|line/);
  });
});
