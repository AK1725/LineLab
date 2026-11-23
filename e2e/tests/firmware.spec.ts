import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const fixture = (f: string) =>
  JSON.parse(
    readFileSync(new URL(`../../packages/sim-core/fixtures/${f}`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;

type Hook = { getState(): { load(d: unknown): void } };

async function openDesign(page: Page, design: Record<string, unknown>) {
  await page.goto("/build");
  await page.getByRole("button", { name: /PCB racer/ }).click();
  await expect(page).toHaveURL(/\/build\/edit\?id=d-/);
  await expect(page.getByTestId("scene")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("id");
  await page.evaluate(
    (d) => {
      (window as unknown as { __linelabEditor: Hook }).__linelabEditor.getState().load(d);
    },
    { ...design, id },
  );
}

test.describe("firmware", () => {
  test("the Nano's PID sketch runs cycle-accurately and reports serial, loop timing, profile and variables", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await openDesign(page, fixture("reference.design.json"));

    await page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(page.getByTestId("code-editor").locator(".monaco-editor")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("code-editor")).toContainText("good_pid.ino");
    await expect(page.getByTestId("build-status")).toHaveText(/Prebuilt example: ready to run/);
    await expect(page.getByText("Emulated · cycle-accurate")).toBeVisible();

    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByLabel("Controller").selectOption("firmware");
    await page.getByTestId("run-start").click();
    await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-outcome", "finished", {
      timeout: 60_000,
    });
    const report = page.getByTestId("firmware-report");
    await expect(report.getByTestId("serial-output")).toContainText("good_pid ready");
    await expect(report.getByTestId("loop-period")).toHaveText(/^1\.\d\d ms/);
    await expect(report.getByTestId("hot-lines")).toContainText("wiring_analog.c");
    await expect(page.getByTestId("watch")).toContainText("lastError (i32)");
    expect(errors).toEqual([]);
  });

  test("compile errors point at lines; editing invalidates the build", async ({ page }) => {
    await openDesign(page, fixture("reference.design.json"));
    let sent: { board?: string; files?: Record<string, string> } = {};
    await page.route("**/api/compile", async (route) => {
      sent = JSON.parse(route.request().postData() ?? "{}") as typeof sent;
      await route.fulfill({
        json: {
          ok: false,
          log: "sketch.ino:3:1: error: 'foo' was not declared in this scope",
          diagnostics: [
            {
              file: "sketch.ino",
              line: 3,
              column: 1,
              severity: "error",
              message: "'foo' was not declared in this scope",
            },
          ],
        },
      });
    });
    await page.getByRole("button", { name: "Code", exact: true }).click();
    const editor = page.getByTestId("code-editor").locator(".monaco-editor");
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.type("foo();\n");
    await expect(page.getByTestId("build-status")).toHaveText(/Not compiled yet/);

    await page.getByRole("button", { name: "Compile" }).click();
    await expect(page.getByTestId("diagnostics")).toContainText(
      "sketch.ino:3: 'foo' was not declared in this scope",
    );
    await expect(page.getByTestId("build-status")).toHaveAttribute("data-status", "error");
    expect(sent.board).toBe("arduino:avr:nano");
    expect(sent.files?.["sketch.ino"]).toContain("foo();");
    await expect(editor.locator(".squiggly-error").first()).toBeVisible();

    await page.getByRole("button", { name: "Run", exact: true }).click();
    const option = page.getByLabel("Controller").locator("option[value=firmware]");
    await expect(option).toHaveAttribute("disabled", "");
    await expect(option).toHaveText(/compile it in Code/);
  });

  test("an ESP32 sketch runs on the HAL with an approximate badge", async ({ page }) => {
    await openDesign(page, fixture("esp32.design.json"));
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(page.getByTestId("approximate-badge")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("build-status")).toHaveText(/Prebuilt example/);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByLabel("Controller").selectOption("firmware");
    await expect(page.getByTestId("approximate-badge")).toBeVisible();
    await page.getByTestId("run-start").click();
    await expect(page.getByTestId("run-outcome")).toHaveAttribute("data-outcome", "finished", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("serial-output")).toContainText("esp32_pid ready");
  });

  test("the compile proxy says when the compiler isn't running", async ({ request }) => {
    const res = await request.post("/api/compile", {
      data: { board: "arduino:avr:nano", files: { "a.ino": "void setup(){}\nvoid loop(){}" } },
    });
    expect(res.status()).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /compiler service isn't running/,
    );
  });
});
