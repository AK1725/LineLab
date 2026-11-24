"use client";

import type { AgentEvent, AgentResult, Attempt, VerifiedPatch } from "@linelab/agent";
import type { Design, Track } from "@linelab/schema";
import { create } from "zustand";

export interface AgentActivity {
  id: string;
  name: string;
  summary?: string;
  isError?: boolean;
}

interface AgentState {
  status: "idle" | "starting" | "running" | "done" | "error";
  sessionId: string | null;
  /** Sessions in this conversation (a failed real-world test starts a new one). */
  round: number;
  text: string;
  thinking: string;
  activity: AgentActivity[];
  attempts: Attempt[];
  verified: VerifiedPatch | null;
  result: AgentResult | null;
  error: string | null;
  /** The user's own Anthropic key, kept in memory only (never stored). */
  apiKey: string;
  setApiKey: (k: string) => void;
  start: (args: {
    design: Design;
    track: Track;
    source: string;
    seeds: number[];
    request: string;
  }) => Promise<void>;
  feedback: (f: {
    worked: boolean;
    where?: string;
    symptoms: string[];
    notes?: string;
    /** Opt-in: share the confirmed fix with the knowledge base. */
    share?: boolean;
  }) => Promise<"stored" | "kept" | "restarted" | "error">;
  reset: () => void;
}

let source: EventSource | undefined;

export const useAgent = create<AgentState>()((set, get) => {
  const listen = (id: string) => {
    source?.close();
    set({
      sessionId: id,
      status: "running",
      text: "",
      thinking: "",
      activity: [],
      attempts: [],
      verified: null,
      result: null,
      error: null,
    });
    const es = new EventSource(`/api/agent/sessions/${id}/events`);
    source = es;
    es.onmessage = (m: MessageEvent<string>) => {
      const e = JSON.parse(m.data) as AgentEvent;
      const s = get();
      switch (e.type) {
        case "text":
          set({ text: s.text + e.delta });
          break;
        case "thinking":
          set({ thinking: s.thinking + e.delta });
          break;
        case "tool_call":
          set({ activity: [...s.activity, { id: e.id, name: e.name }] });
          break;
        case "tool_result":
          set({
            activity: s.activity.map((a) =>
              a.id === e.id ? { ...a, summary: e.summary, isError: e.isError } : a,
            ),
          });
          break;
        case "attempt":
          set({ attempts: [...s.attempts, e.attempt] });
          break;
        case "verified":
          set({ verified: e.patch });
          break;
        case "status":
          break;
        case "done":
          es.close();
          set({ status: "done", result: e.result, verified: e.result.verified ?? null });
          break;
      }
    };
    es.onerror = () => {
      if (get().status === "running")
        set({ status: "error", error: "The connection to the debugger was lost." });
      es.close();
    };
  };
  const post = async (url: string, body: unknown) => {
    const key = get().apiKey.trim();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { "x-anthropic-api-key": key } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { id?: string; error?: string; stored?: boolean };
    return { res, json };
  };
  return {
    status: "idle",
    sessionId: null,
    round: 0,
    text: "",
    thinking: "",
    activity: [],
    attempts: [],
    verified: null,
    result: null,
    error: null,
    apiKey: "",
    setApiKey: (apiKey) => {
      set({ apiKey });
    },
    start: async (args) => {
      set({ status: "starting", error: null, round: 1 });
      try {
        const { res, json } = await post("/api/agent/sessions", args);
        if (!res.ok || !json.id) {
          set({ status: "error", error: json.error ?? `The API returned ${String(res.status)}.` });
          return;
        }
        listen(json.id);
      } catch {
        set({ status: "error", error: "Couldn't reach the LineLab API." });
      }
    },
    feedback: async (f) => {
      const id = get().sessionId;
      if (!id) return "error";
      try {
        const { res, json } = await post(`/api/agent/sessions/${id}/feedback`, f);
        if (!res.ok) {
          set({ error: json.error ?? `The API returned ${String(res.status)}.` });
          return "error";
        }
        if (json.id) {
          set({ round: get().round + 1 });
          listen(json.id);
          return "restarted";
        }
        return json.stored ? "stored" : "kept";
      } catch {
        set({ error: "Couldn't reach the LineLab API." });
        return "error";
      }
    },
    reset: () => {
      source?.close();
      set({
        status: "idle",
        sessionId: null,
        round: 0,
        text: "",
        thinking: "",
        activity: [],
        attempts: [],
        verified: null,
        result: null,
        error: null,
      });
    },
  };
});
