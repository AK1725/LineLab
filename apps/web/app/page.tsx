import Link from "next/link";

const phases = [
  ["0", "Foundation: monorepo, CI, schemas", true],
  ["1", "Component database, search, procedural 3D models", true],
  ["2", "3D assembly and chassis designer", true],
  ["3", "Wiring and live rules engine", true],
  ["4", "Tracks: library, editor, image import", true],
  ["5", "Deterministic simulation and run viewer", true],
  ["6", "Run your real firmware (emulated MCU)", false],
  ["7", "Failure detection and static analysis", false],
  ["8", "AI debug agent with verified fixes", false],
  ["9", "Real-robot telemetry, flashing, calibration", false],
  ["10", "Photo to virtual design", false],
  ["11", "Knowledge base, gallery, launch", false],
] as const;

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-accent">
        Open source · early build
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">LineLab</h1>
      <p className="mt-4 text-lg text-muted">
        Design, wire, simulate and debug line-following robots — run your real firmware on a virtual
        track and see exactly where and why it fails.
      </p>
      <p className="mt-6">
        <Link
          href="/build"
          className="inline-block rounded-lg bg-accent px-4 py-2 font-medium text-white dark:text-black"
        >
          Build a robot
        </Link>{" "}
        <Link
          href="/components"
          className="ml-2 inline-block rounded-lg border border-border px-4 py-2 font-medium"
        >
          Browse components
        </Link>
      </p>

      <section aria-labelledby="roadmap" className="mt-12">
        <h2 id="roadmap" className="text-xl font-semibold">
          Roadmap
        </h2>
        <ol className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
          {phases.map(([n, label, done]) => (
            <li key={n} className="flex items-center gap-3 px-4 py-3">
              <span className="w-8 shrink-0 font-mono text-sm text-muted">P{n}</span>
              <span className="flex-1">{label}</span>
              <span className={done ? "text-sm font-medium text-accent" : "text-sm text-muted"}>
                {done ? "Done" : "Planned"}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
