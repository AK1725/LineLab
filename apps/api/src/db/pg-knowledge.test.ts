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
