import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const repo = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const reference = JSON.parse(repo("packages/sim-core/fixtures/reference.design.json")) as Record<
  string,
  unknown
>;
const buggySource = repo("examples/firmware/buggy/blocking_delay/blocking_delay.ino");
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

// The model's side is a scripted transcript (examples/agent); the API, compiler outputs, simulator
// and verification gate are real.
test("build → code → run → fail → AI fix (verified) → re-run → real-world feedback", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.route("**/api/compile", (route) =>
    route.fulfill({ json: { ok: true, artifact: buggyArtifact, log: "" } }),
  );
  await page.route("**/api/analyze", (route) => route.fulfill({ json: { findings: [], log: "" } }));
  await openReference(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const editor = page.getByTestId("code-editor").locator(".monaco-editor");
  await expect(editor).toBeVisible({ timeout: 20_000 });
  // Set the sketch exactly (typing would let Monaco's auto-indent add whitespace).
  await page.evaluate((t) => {
    (
      window as unknown as { __linelabFirmware: { getState(): { setSource(s: string): void } } }
    ).__linelabFirmware
      .getState()
      .setSource(t);
  }, buggySource);
  await expect(editor).toContainText("BUGGY on purpose");
  await page.getByRole("button", { name: "Compile" }).click();
  await expect(page.getByTestId("build-status")).toHaveAttribute("data-status", "ok");

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByLabel("Controller").selectOption("firmware");
  await page.getByTestId("run-start").click();
  await expect(page.getByTestId("run-events").locator('[data-type="blocking_delay"]')).toBeVisible({
    timeout: 60_000,
  });

  // Ask the debugger. The sketch it gets is exactly the one in the editor.
  let sent = "";
  await page.route("**/api/agent/sessions", async (route) => {
    sent = (JSON.parse(route.request().postData() ?? "{}") as { source?: string }).source ?? "";
    await route.continue();
  });
  await page.getByTestId("agent-start").click();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(sent).toBe(buggySource);
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-status", "fixed", {
    timeout: 120_000,
  });
  await expect(page.getByTestId("agent-status")).toContainText("scripted demo transcript");
  await expect(page.getByTestId("agent-diagnosis")).toContainText("line 69");
  await expect(page.getByTestId("agent-diagnosis")).not.toContainText("```");
  await expect(page.getByTestId("agent-activity")).toContainText(
    "Submitted a fix to the gate: ACCEPTED",
  );
  const verified = page.getByTestId("agent-verified");
  await expect(verified.getByTestId("agent-diff")).toContainText(
    '-  delay(25);  // "give the motors time to react"',
  );
  await expect(verified.getByTestId("agent-before-after")).toContainText("Error events");
  await expect(verified.getByTestId("agent-full-file")).not.toContainText("delay(25)");

  // Use it: the fixed firmware runs and the old run becomes the ghost.
  await verified.getByRole("button", { name: "Use this version and re-run" }).click();
  await expect(page.getByText(/Ghost: firmware, seed 0/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("report-counts")).toContainText("0 error(s)");
  await expect(page.getByTestId("run-events").locator('[data-type="blocking_delay"]')).toHaveCount(
    0,
  );

  // Feedback: it didn't work on the real track → another round, honestly reported.
  await page.getByTestId("agent-feedback").getByLabel("It didn't work").check();
  await page.getByTestId("agent-feedback").getByLabel("Wobbles across the line").check();
  await page.getByTestId("agent-feedback").getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("round 2")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-status", "not_fixed", {
    timeout: 120_000,
  });
  await expect(page.getByTestId("agent-rejected")).toContainText("doesn't apply");
  await expect(page.getByTestId("agent-verified")).toHaveCount(0);
});
