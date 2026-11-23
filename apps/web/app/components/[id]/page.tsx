import { COMPONENTS, categoryLabel, getComponent } from "@linelab/component-db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ModelViewer from "../../../src/components/model-viewer-lazy";
import { specRows } from "../../../src/lib/specs";

export const dynamicParams = false;

export function generateStaticParams() {
  return COMPONENTS.map((c) => ({ id: c.id }));
}

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = getComponent((await params).id);
  return c ? { title: c.name, description: `${c.name}: pins, specs and 3D model.` } : {};
}

const fmt = (n: number) => Number(n.toFixed(2)).toString();

export default async function ComponentPage({ params }: Props) {
  const c = getComponent((await params).id);
  if (c === undefined) notFound();

  const rows: (readonly [string, string])[] = [
    ...specRows(c.electrical),
    [
      "Dimensions",
      `${fmt(c.dimensionsMm.x)} × ${fmt(c.dimensionsMm.y)} × ${fmt(c.dimensionsMm.z)} mm`,
    ],
    ["Mass", `${fmt(c.massG)} g`],
  ];
  if (c.typicalPriceUsd !== undefined)
    rows.push(["Typical price", `≈ US$${fmt(c.typicalPriceUsd)}`]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link href="/components" className="text-muted hover:text-fg">
          ← All components
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{c.name}</h1>
      <p className="mt-1 text-muted">
        {categoryLabel(c.category)}
        {c.manufacturer ? ` · ${c.manufacturer}` : ""}
      </p>
      {c.specStatus === "needs-review" && (
        <p
          data-testid="needs-review"
          className="mt-3 inline-block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm"
        >
          Specs not yet reviewed against the datasheet. Check critical values before you rely on
          them.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ModelViewer componentId={c.id} />
        <section aria-labelledby="specs">
          <h2 id="specs" className="text-lg font-semibold">
            Specifications
          </h2>
          <dl className="mt-2 divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-2 gap-2 px-3 py-2">
                <dt className="text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {c.notes && <p className="mt-3 text-sm">{c.notes}</p>}
        </section>
      </div>

      {c.pins.length > 0 && (
        <section aria-labelledby="pins" className="mt-8">
          <h2 id="pins" className="text-lg font-semibold">
            Pins <span className="text-sm font-normal text-muted">({c.pins.length})</span>
          </h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Pin</th>
                  <th className="px-3 py-2 font-medium">Label</th>
                  <th className="px-3 py-2 font-medium">Functions</th>
                  <th className="px-3 py-2 font-medium">In code</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {c.pins.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-1.5 font-mono">{p.id}</td>
                    <td className="px-3 py-1.5">{p.label}</td>
                    <td className="px-3 py-1.5 text-muted">
                      {p.functions.join(", ")}
                      {p.adcUnit !== undefined ? ` · ADC${p.adcUnit}` : ""}
                      {p.adcChannel !== undefined ? ` ch${p.adcChannel}` : ""}
                      {p.inputOnly === true ? " · input only" : ""}
                    </td>
                    <td className="px-3 py-1.5 font-mono">{p.arduinoPin ?? ""}</td>
                    <td className="px-3 py-1.5 text-muted">{p.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="sources" className="mt-8 text-sm">
        <h2 id="sources" className="text-lg font-semibold">
          Sources
        </h2>
        <ul className="mt-2 list-disc pl-5">
          {c.sources.map((s) => (
            <li key={s} className="break-all">
              <a
                href={s}
                rel="noreferrer"
                target="_blank"
                className="text-accent underline-offset-2 hover:underline"
              >
                {s}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-muted">
          Data: <code className="break-all">packages/component-db/data/components/{c.id}.json</code>{" "}
          · CC-BY-SA-4.0
        </p>
      </section>
    </main>
  );
}
