import type { Metadata } from "next";
import Link from "next/link";
import { LESSONS } from "../../src/learn/lessons";

export const metadata: Metadata = {
  title: "Learn",
  description: "Guided lessons: build your first line follower and debug the classic failures.",
};

export default function LearnPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Learn</h1>
      <p className="mt-2 text-muted">
        Short lessons that use LineLab&apos;s real tools: build a robot, then break and fix it.
      </p>
      <ul className="mt-6 space-y-3">
        {LESSONS.map((l) => (
          <li key={l.slug}>
            <Link
              href={`/learn/${l.slug}`}
              className="block rounded-lg border border-border bg-card p-4 hover:border-accent"
            >
              <span className="font-medium">{l.title}</span>
              <span className="ml-2 text-sm text-muted">{l.minutes} min</span>
              <span className="mt-1 block text-sm text-muted">{l.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
