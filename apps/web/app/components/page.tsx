import { COMPONENTS } from "@linelab/component-db";
import type { Metadata } from "next";
import { Suspense } from "react";
import ComponentBrowser from "../../src/components/component-browser";

export const metadata: Metadata = {
  title: "Components",
  description: `Search ${COMPONENTS.length} line-follower parts: microcontrollers, line sensors, motor drivers, motors, batteries and more.`,
};

export default function ComponentsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Components</h1>
      <p className="mt-2 text-muted">
        {COMPONENTS.length} parts for building line-following robots, each with pins, electrical
        specs and a 3D model built from its real dimensions.
      </p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-muted">Loading search…</p>}>
          <ComponentBrowser />
        </Suspense>
      </div>
    </main>
  );
}
