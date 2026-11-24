import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HashingEmbedder, cosine, tokens } from "./embed.js";
import { MemoryKnowledge, type NewCase } from "./knowledge.js";

const seed = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "..", "..", "examples", "knowledge", "seed.json"),
    "utf8",
  ),
) as NewCase[];

describe("embeddings", () => {
  const e = new HashingEmbedder();
  it("splits identifiers and is normalised", () => {
    expect(tokens("lastError PWM_A delay(25)")).toEqual(
      expect.arrayContaining(["lasterror", "last", "error", "pwm_a", "pwm", "delay", "25"]),
    );
    expect(cosine(e.embed("motor runs backwards"), e.embed("motor runs backwards"))).toBeCloseTo(
      1,
      9,
    );
  });
  it("puts related text closer than unrelated text", () => {
    const q = e.embed("the loop is blocked by a delay");
    expect(cosine(q, e.embed("delay(30) in loop blocks the controller"))).toBeGreaterThan(
      cosine(q, e.embed("left motor direction pins swapped")),
    );
  });
});

describe("knowledge base with the synthetic seed", () => {
  it("has labelled synthetic cases from the bug-injection generator", () => {
    expect(seed.length).toBeGreaterThanOrEqual(8);
    // One case per fix: the same diff never appears twice.
    expect(new Set(seed.map((c) => c.diff)).size).toBe(seed.length);
    expect(seed.every((c) => c.source === "synthetic" && c.diff.includes("@@"))).toBe(true);
  });

  it("retrieves the right bug class for a symptom description", async () => {
    const kb = new MemoryKnowledge();
    for (const c of seed) await kb.add(c);
    const top = async (q: string) => (await kb.search(q, 1))[0]?.diagnosis ?? "";
    expect(await top("blocking delay in loop, reacts late")).toMatch(/delay\(/);
    expect(await top("the left motor drives backwards")).toMatch(/left motor/);
    expect(await top("robot never moves, stuck, no PWM on the left motor")).toMatch(/PWMA/);
    expect(await top("sensor order reversed, steering inverted")).toMatch(/reverse order/);
  });

  it("counts a user confirmation on an existing synthetic case and ranks user cases higher", async () => {
    const kb = new MemoryKnowledge();
    const c = seed[0];
    if (!c) throw new Error("empty seed");
    await kb.add(c);
    const again = await kb.add({ ...c, source: "user" });
    expect(again.confirmations).toBe(1);
  });
});
