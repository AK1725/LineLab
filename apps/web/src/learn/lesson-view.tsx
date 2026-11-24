"use client";

import { Design } from "@linelab/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { newDesignId, saveDesign } from "../editor/persistence";
import { EXAMPLES } from "../firmware/examples";
import { REFERENCE_DESIGN_JSON } from "../firmware/examples.generated";
import { saveSketchFor } from "../firmware/store";
import { LESSONS } from "./lessons";

const KEY = (slug: string) => `lesson:${slug}`;

export default function LessonView({ slug }: { slug: string }) {
  const router = useRouter();
  const lesson = LESSONS.find((l) => l.slug === slug);
  const [done, setDone] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY(slug));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring saved progress once
      if (raw) setDone(JSON.parse(raw) as boolean[]);
    } catch {
      // progress just isn't remembered
    }
  }, [slug]);
  if (!lesson) return null;
  const toggle = (i: number) => {
    const next = lesson.steps.map((_, k) => (k === i ? !done[k] : Boolean(done[k])));
    setDone(next);
    try {
      localStorage.setItem(KEY(slug), JSON.stringify(next));
    } catch {
      // ignore
    }
  };
  const openRobot = async () => {
    const ex = EXAMPLES.find((e) => e.id === lesson.sketch);
    if (!ex) return;
    setBusy(true);
    const design = {
      ...Design.parse(JSON.parse(REFERENCE_DESIGN_JSON)),
      id: newDesignId(),
      name: lesson.title,
    };
    await saveDesign(design);
    await saveSketchFor(design.id, ex.board, ex.source, ex.artifact ?? undefined);
    router.push(`/build/edit?id=${design.id}&view=run&controller=firmware`);
  };
  const count = done.filter(Boolean).length;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-sm">
        <Link href="/learn" className="text-muted underline">
          Learn
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{lesson.title}</h1>
      <p className="mt-2 text-muted">{lesson.summary}</p>
      {lesson.sketch && (
        <button
          disabled={busy}
          onClick={() => void openRobot()}
          className="mt-6 rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-50 dark:text-black"
        >
          Open the lesson robot
        </button>
      )}
      {!lesson.sketch && (
        <Link
          href="/build"
          className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 font-medium text-white dark:text-black"
        >
          Start building
        </Link>
      )}
      <p className="mt-6 text-sm text-muted" aria-live="polite">
        {count} of {lesson.steps.length} steps done
      </p>
      <ol className="mt-2 space-y-3">
        {lesson.steps.map((s, i) => (
          <li key={s.title} className="rounded-lg border border-border bg-card p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1.5"
                checked={Boolean(done[i])}
                onChange={() => {
                  toggle(i);
                }}
              />
              <span>
                <span className="font-medium">
                  {i + 1}. {s.title}
                </span>
                <span className="mt-1 block text-sm">{s.body}</span>
              </span>
            </label>
          </li>
        ))}
      </ol>
    </main>
  );
}
