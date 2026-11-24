/* global document, window -- these callbacks run in the browser page (page.evaluate). */
// `pnpm --filter @linelab/e2e lighthouse`: Lighthouse on the home page and the run page (the
// reference robot's design, opened in the Run view), against a running production build
// (BASE_URL, default http://localhost:3100: `next start --port 3100`). Fails below 90 for
// performance, accessibility or best practices, mobile and desktop. LH_SHOTS=dir saves the final
// screenshots, to check what was measured.
//
// The design lives in the browser's IndexedDB, so setup and audit must share one browser context:
// Chrome (Playwright's build) is driven with the puppeteer-core that Lighthouse ships, and
// Lighthouse audits that same page.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";

const fromLighthouse = createRequire(createRequire(import.meta.url).resolve("lighthouse"));
const puppeteer = (await import(fromLighthouse.resolve("puppeteer-core"))).default;

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const MIN = 90;
const reference = JSON.parse(
  readFileSync(
    new URL("../../packages/sim-core/fixtures/reference.design.json", import.meta.url),
    "utf8",
  ),
);

const browser = await puppeteer.launch({
  executablePath: chromium.executablePath(),
  headless: true,
  args: ["--no-sandbox"],
});
const setup = await browser.newPage();
await setup.goto(`${BASE}/build`, { waitUntil: "networkidle0" });
// Save the design exactly as the editor does: open the editor for a new design, load the
// reference into it, wait for "Saved".
// Retry the click until hydration has wired it up and the editor opens.
for (let i = 0; i < 20 && !setup.url().includes("/build/edit"); i++) {
  await setup.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      /PCB racer/.test(x.textContent ?? ""),
    );
    b?.click();
  });
  await new Promise((r) => setTimeout(r, 500));
}
await setup.waitForSelector('[data-testid="scene"]');
const editorId = new URL(setup.url()).searchParams.get("id") ?? "";
await setup.evaluate((d) => window.__linelabEditor.getState().load(d), {
  ...reference,
  id: editorId,
});
await setup.waitForFunction(() => document.body.innerText.includes("Saved"));
await setup.close();

const targets = [
  ["home", `${BASE}/`, (t) => t.includes("Build a robot")],
  [
    "run",
    `${BASE}/build/edit?id=${editorId}&view=run`,
    (t) => t.includes("Result") || t.includes("Run"),
  ],
];
const desktop = {
  extends: "lighthouse:default",
  settings: {
    formFactor: "desktop",
    screenEmulation: {
      mobile: false,
      width: 1350,
      height: 940,
      deviceScaleFactor: 1,
      disabled: false,
    },
    throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1 },
  },
};
let failed = false;
const report = {};
for (const formFactor of ["mobile", "desktop"]) {
  for (const [name, url, looksRight] of targets) {
    const page = await browser.newPage();
    const r = await lighthouse(
      url,
      {
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices"],
        disableStorageReset: true,
      },
      formFactor === "desktop" ? desktop : undefined,
      page,
    );
    if (!r) throw new Error("Lighthouse returned no result");
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes("Design not found") || !looksRight(text))
      throw new Error(`${name}: the page Lighthouse measured isn't the one intended`);
    const scores = Object.fromEntries(
      Object.entries(r.lhr.categories).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)]),
    );
    report[`${name}/${formFactor}`] = scores;
    if (process.env.LH_SHOTS) {
      const shot = r.lhr.audits["final-screenshot"]?.details?.data;
      if (shot)
        writeFileSync(
          `${process.env.LH_SHOTS}/${name}-${formFactor}.jpg`,
          Buffer.from(shot.split(",")[1], "base64"),
        );
    }
    if (process.env.LH_DETAIL)
      for (const a of Object.values(r.lhr.audits))
        if (
          a.score !== null &&
          a.score < 1 &&
          !["informative", "notApplicable", "manual"].includes(a.scoreDisplayMode)
        )
          console.log(
            `   ${name} ${formFactor}: ${a.id} ${String(a.score)} ${JSON.stringify((a.details?.items ?? []).slice(0, 3).map((i) => i.node?.selector ?? i.url ?? ""))}`,
          );
    const low = Object.entries(scores).filter(([, s]) => s < MIN);
    if (low.length) {
      failed = true;
      const audits = Object.values(r.lhr.audits)
        .filter(
          (a) =>
            a.score !== null &&
            a.score < 0.9 &&
            !["informative", "notApplicable", "manual"].includes(a.scoreDisplayMode),
        )
        .map((a) => `${a.id} (${a.displayValue ?? a.score})`)
        .slice(0, 12);
      console.log(`✗ ${name} ${formFactor}: ${JSON.stringify(scores)}\n   ${audits.join("\n   ")}`);
    } else console.log(`✓ ${name} ${formFactor}: ${JSON.stringify(scores)}`);
    await page.close();
  }
}
await browser.close();
console.log(JSON.stringify(report));
process.exitCode = failed ? 1 : 0;
