import { HttpEmbedder } from "@linelab/agent";
import { describe, expect, it } from "vitest";
import { PgKnowledge } from "./pg-knowledge.js";

// Needs Postgres with pgvector (docker compose up -d postgres): TEST_DATABASE_URL. Skipped
// otherwise. Uses its own throwaway schema-free table contents (truncated first).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PgKnowledge (Postgres + pgvector)", () => {
  it("stores, deduplicates, counts confirmations and retrieves by meaning", async () => {
    const kb = await PgKnowledge.connect(url ?? "");
    try {
      await (kb as unknown as { client: { unsafe(s: string): Promise<unknown> } }).client.unsafe(
        "TRUNCATE fix_cases",
      );
      const delay = {
        symptoms: "robot reacts late and overshoots corners; loop period 25 ms",
        diagnosis: "delay(25) in loop() blocks the controller",
        diff: "-  delay(25);\n+  // no blocking delay\n",
      };
      await kb.add({ ...delay, source: "synthetic", parts: ["mcu.arduino-nano"] });
      await kb.add({
        symptoms: "motor spins backwards, robot drives away from the line",
        diagnosis: "left motor direction pins swapped",
        diff: "-  digitalWrite(AIN1, HIGH);\n+  digitalWrite(AIN1, LOW);\n",
        source: "synthetic",
      });
      expect(await kb.count()).toBe(2);
      const again = await kb.add({ ...delay, source: "user" });
      expect(again).toMatchObject({ confirmations: 1, source: "user" });
      expect(await kb.count()).toBe(2);
      const hits = await kb.search("my loop has a blocking delay and it overshoots", 2);
      expect(hits[0]?.diagnosis).toMatch(/delay\(25\)/);
      expect((await kb.search("wheel turns the wrong direction backwards"))[0]?.diagnosis).toMatch(
        /direction/,
      );
    } finally {
      await kb.close();
    }
  });
});

// Also needs the vision service's /embed (EMBEDDINGS_URL), e.g. `uvicorn app.main:app` in apps/vision.
const embeddings = process.env.EMBEDDINGS_URL;

describe.skipIf(!url || !embeddings)("PgKnowledge with bge-small embeddings", () => {
  it("re-embeds cases stored with another model and finds a paraphrase by meaning", async () => {
    const hashing = await PgKnowledge.connect(url ?? "");
    await (hashing as unknown as { client: { unsafe(s: string): Promise<unknown> } }).client.unsafe(
      "TRUNCATE fix_cases",
    );
    await hashing.add({
      symptoms: "the steering overcorrects on every curve",
      diagnosis: "Kp is too high, so the robot oscillates around the line",
      diff: "-float Kp = 0.4;\n+float Kp = 0.08;\n",
      source: "synthetic",
    });
    await hashing.add({
      symptoms: "never moves",
      diagnosis: "PWMA is defined as pin 6 but wired to D3",
      diff: "-const uint8_t PWMA = 6;\n+const uint8_t PWMA = 3;\n",
      source: "synthetic",
    });
    // No words in common with the Kp case: word matching can't find it.
    const query = "my bot wobbles side to side";
    expect(await hashing.search(query, 1)).toEqual([]);
    await hashing.close();

    const bge = await PgKnowledge.connect(url ?? "", new HttpEmbedder(embeddings ?? ""));
    try {
      expect(await bge.reembed()).toBe(0); // connect already re-embedded both rows
      const [top] = await bge.search(query, 1);
      expect(top?.diagnosis).toMatch(/Kp is too high/);
    } finally {
      await bge.close();
    }
  });
});
