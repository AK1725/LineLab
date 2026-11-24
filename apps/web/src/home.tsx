"use client";

import Link from "next/link";
import { useT } from "./i18n/use-t";

const FEATURES = [
  [
    "Real parts",
    "124 components with datasheet pinouts and specs, procedural 3D models, search by part number.",
  ],
  [
    "Assemble and wire",
    "3D assembly on chassis templates or your own outline; auto-wiring and 50 live electrical and mechanical checks.",
  ],
  [
    "Your firmware, emulated",
    "Compile your Arduino sketch and run the binary on an emulated ATmega328P (or the HAL tier for ESP32, RP2040, STM32).",
  ],
  [
    "Physics and failures",
    "1 kHz simulation with datasheet motors, batteries, tyres and IR sensors; failures tied to the line of code that caused them.",
  ],
  [
    "AI debugging, verified",
    "Claude proposes a fix; LineLab compiles it and checks it in simulation before you see it.",
  ],
  [
    "Your real robot",
    "Live telemetry over USB or Bluetooth, browser flashing, digital-twin calibration and PID auto-tuning.",
  ],
  [
    "From photos",
    "Photograph your robot: LineLab suggests parts, layout and wiring for you to confirm.",
  ],
  [
    "Share and learn",
    "Publish to the gallery, fork other robots, follow guided lessons. Works offline.",
  ],
] as const;

const PHASES = [
  "Foundation: monorepo, CI, schemas",
  "Component database, search, procedural 3D models",
  "3D assembly and chassis designer",
  "Wiring and live rules engine",
  "Tracks: library, editor, image import",
  "Deterministic simulation and run viewer",
  "Run your real firmware (emulated MCU)",
  "Failure detection and static analysis",
  "AI debug agent with verified fixes",
  "Real-robot telemetry, flashing, calibration",
  "Photo to virtual design",
  "Knowledge base, gallery, launch",
];

export default function HomeContent() {
  const t = useT();
  return (
    <main className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-accent">{t("home.kicker")}</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">LineLab</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">{t("home.tagline")}</p>
      <p className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/build"
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white dark:text-black"
        >
          {t("home.build")}
        </Link>
        <Link
          href="/build/from-photos"
          className="rounded-lg border border-border px-4 py-2 font-medium"
        >
          {t("home.fromPhotos")}
        </Link>
        <Link href="/gallery" className="rounded-lg border border-border px-4 py-2 font-medium">
          {t("home.gallery")}
        </Link>
        <Link href="/learn" className="rounded-lg border border-border px-4 py-2 font-medium">
          {t("home.learn")}
        </Link>
      </p>

      <section aria-labelledby="features" className="mt-12">
        <h2 id="features" className="text-xl font-semibold">
          {t("home.features")}
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {FEATURES.map(([title, body]) => (
            <li key={title} className="rounded-lg border border-border bg-card p-4">
              <h3 className="font-medium">{title}</h3>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="roadmap" className="mt-12">
        <h2 id="roadmap" className="text-xl font-semibold">
          {t("home.roadmap")}
        </h2>
        <ol className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
          {PHASES.map((label, n) => (
            <li key={label} className="flex items-center gap-3 px-4 py-3">
              <span className="w-8 shrink-0 font-mono text-sm text-muted">P{n}</span>
              <span className="flex-1">{label}</span>
              <span className="text-sm font-medium text-accent">{t("home.done")}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
