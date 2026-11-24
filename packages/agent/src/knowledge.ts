/**
 * Confirmed fixes: cases where a user reported that a verified patch worked on their real robot.
 * This in-memory store with keyword ranking is the interface the agent uses; Phase 11 backs it
 * with pgvector embeddings. It starts empty: no examples are invented.
 */
export interface KnowledgeCase {
  id: string;
  symptoms: string;
  diagnosis: string;
  diff: string;
  /** How many users confirmed this fix. */
  confirmations: number;
}

export interface FixKnowledge {
  search(query: string, k?: number): Promise<KnowledgeCase[]>;
  add(c: Omit<KnowledgeCase, "id" | "confirmations">): Promise<KnowledgeCase>;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []);

export class MemoryKnowledge implements FixKnowledge {
  private readonly cases: KnowledgeCase[] = [];
  search(query: string, k = 3): Promise<KnowledgeCase[]> {
    const q = words(query);
    const scored = this.cases
      .map((c) => {
        const w = words(`${c.symptoms} ${c.diagnosis}`);
        let hits = 0;
        for (const t of q) if (w.has(t)) hits++;
        return { c, score: hits === 0 ? 0 : hits * (1 + Math.log2(1 + c.confirmations)) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return Promise.resolve(scored.slice(0, k).map((x) => x.c));
  }
  add(c: Omit<KnowledgeCase, "id" | "confirmations">): Promise<KnowledgeCase> {
    const existing = this.cases.find((x) => x.diff === c.diff);
    if (existing) {
      existing.confirmations++;
      return Promise.resolve(existing);
    }
    const added = { ...c, id: `case-${String(this.cases.length + 1)}`, confirmations: 1 };
    this.cases.push(added);
    return Promise.resolve(added);
  }
}
