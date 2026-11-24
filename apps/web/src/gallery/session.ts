"use client";

import type { SessionUser } from "@linelab/schema";
import { create } from "zustand";

interface SessionState {
  status: "unknown" | "loading" | "ready";
  user: SessionUser | null;
  providers: { enabled: boolean; github: boolean; email: boolean } | null;
  load: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** Who is signed in (server session cookie, via /api/auth). Guests can do everything locally. */
export const useSession = create<SessionState>()((set, get) => ({
  status: "unknown",
  user: null,
  providers: null,
  load: async () => {
    if (get().status !== "unknown") return;
    set({ status: "loading" });
    try {
      const [s, p] = await Promise.all([
        fetch("/api/auth/session").then((r) =>
          r.ok ? (r.json() as Promise<{ user: SessionUser | null }>) : { user: null },
        ),
        fetch("/api/auth/providers").then((r) =>
          r.ok ? (r.json() as Promise<SessionState["providers"]>) : null,
        ),
      ]);
      set({ status: "ready", user: s.user, providers: p });
    } catch {
      set({ status: "ready", user: null, providers: null });
    }
  },
  signOut: async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    set({ user: null });
  },
}));
