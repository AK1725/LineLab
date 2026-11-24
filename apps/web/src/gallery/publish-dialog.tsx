"use client";

import type { Design, GalleryItem } from "@linelab/schema";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "../editor/modal";
import { useSession } from "./session";

const PUBLISHED = (designId: string) => `published:${designId}`;

/** Browser storage can be missing or throw (private mode, blocked site data). */
const readStorage = (get: () => string | null): string | null => {
  try {
    return typeof window === "undefined" ? null : get();
  } catch {
    return null;
  }
};

/** Publish the design to the gallery (or a new version of it), as the signed-in user. */
export function PublishDialog({ design, onClose }: { design: Design; onClose: () => void }) {
  const { user, status, load, providers } = useSession();
  useEffect(() => {
    void load();
  }, [load]);
  const previous = readStorage(() => localStorage.getItem(PUBLISHED(design.id)));
  const forkedFrom = readStorage(() => sessionStorage.getItem(`forkedFrom:${design.id}`));
  const [title, setTitle] = useState(design.name);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted">("public");
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: GalleryItem }>({});

  const publish = async (asNewVersion: boolean) => {
    setState({ busy: true });
    try {
      const r = await fetch(
        asNewVersion && previous ? `/api/gallery/${previous}` : "/api/gallery",
        {
          method: asNewVersion && previous ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            visibility,
            design,
            ...(forkedFrom && !asNewVersion ? { forkedFrom } : {}),
          }),
        },
      );
      const j = (await r.json()) as GalleryItem & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${String(r.status)}`);
      try {
        localStorage.setItem(PUBLISHED(design.id), j.id);
      } catch {
        // storage unavailable: the link is still shown
      }
      setState({ done: j });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Modal title="Publish to the gallery" onClose={onClose}>
      {status !== "ready" ? (
        <p className="text-sm text-muted">Checking your session…</p>
      ) : !user ? (
        <p className="text-sm">
          {providers?.enabled === false
            ? "Publishing needs sign-in, which isn't set up on this server."
            : "Sign in to publish. Your design stays saved in this browser either way."}{" "}
          {providers?.enabled !== false && (
            <Link
              className="text-accent underline"
              href={`/signin?next=${encodeURIComponent(`/build/edit?id=${design.id}`)}`}
            >
              Sign in
            </Link>
          )}
        </p>
      ) : state.done ? (
        <p className="text-sm" role="status">
          Published version {state.done.version}:{" "}
          <Link className="text-accent underline" href={`/gallery/${state.done.id}`}>
            open it in the gallery
          </Link>
          .
        </p>
      ) : (
        <form
          className="space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void publish(false);
          }}
        >
          <label className="block">
            <span className="text-muted">Title</span>
            <input
              required
              maxLength={80}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-muted">Description</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1"
            />
          </label>
          <fieldset className="flex gap-4">
            <legend className="sr-only">Visibility</legend>
            {(["public", "unlisted"] as const).map((v) => (
              <label key={v} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === v}
                  onChange={() => {
                    setVisibility(v);
                  }}
                />
                {v === "public" ? "Public (listed in the gallery)" : "Unlisted (link only)"}
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted">
            Publishes the design (parts, wiring, chassis) as {user.name}. Your sketch and run data
            aren&apos;t included.
          </p>
          <div className="flex gap-2">
            <button
              disabled={state.busy}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-black"
            >
              Publish{previous ? " as a new robot" : ""}
            </button>
            {previous && (
              <button
                type="button"
                disabled={state.busy}
                onClick={() => void publish(true)}
                className="rounded-md border border-border px-3 py-1.5 hover:border-accent disabled:opacity-50"
              >
                Publish a new version
              </button>
            )}
          </div>
          {state.error && (
            <p role="alert" className="text-red-600 dark:text-red-400">
              {state.error}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
