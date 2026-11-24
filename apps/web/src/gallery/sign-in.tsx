"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "./session";

export default function SignIn() {
  const next = useSearchParams().get("next") ?? "/gallery";
  const { providers, user, load } = useSession();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{
    kind: "idle" | "sent" | "error";
    text?: string;
    devLink?: string;
  }>({
    kind: "idle",
  });
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted">
        You only need an account to publish robots to the gallery. Everything else works without
        one, saved in this browser.
      </p>
      {user && <p className="mt-4 text-sm">You&apos;re signed in as {user.name}.</p>}
      {providers && !providers.enabled && (
        <p className="mt-4 text-sm">Sign-in isn&apos;t set up on this server (no AUTH_SECRET).</p>
      )}
      {providers?.github && (
        <a
          href={`/api/auth/github/start?next=${encodeURIComponent(next)}`}
          className="mt-6 block rounded-md bg-fg px-4 py-2 text-center text-sm font-medium text-bg"
        >
          Continue with GitHub
        </a>
      )}
      {providers?.email && (
        <form
          className="mt-6 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void fetch("/api/auth/email/start", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email, next }),
            })
              .then(async (r) => {
                const j = (await r.json()) as { error?: string; devLink?: string };
                setState(
                  r.ok
                    ? { kind: "sent", ...(j.devLink ? { devLink: j.devLink } : {}) }
                    : { kind: "error", text: j.error ?? `HTTP ${String(r.status)}` },
                );
              })
              .catch(() => {
                setState({ kind: "error", text: "Couldn't reach the server." });
              });
          }}
        >
          <label className="block text-sm">
            <span className="text-muted">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5"
            />
          </label>
          <button className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-black">
            Email me a sign-in link
          </button>
        </form>
      )}
      {state.kind === "sent" && (
        <p role="status" className="mt-4 text-sm">
          Check your inbox for the link (valid for 15 minutes).
          {state.devLink && (
            <>
              {" "}
              Development server:{" "}
              <a className="text-accent underline" href={state.devLink}>
                open the sign-in link
              </a>
              .
            </>
          )}
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {state.text}
        </p>
      )}
    </main>
  );
}
