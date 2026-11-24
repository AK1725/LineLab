"use client";

import { bomCsv, bomOf, resolveChassis, type Lookup } from "@linelab/design-core";
import { getChassis } from "@linelab/component-db";
import type { Design } from "@linelab/schema";
import { useMemo, useState } from "react";
import { download, slug } from "./files";

const usd = (x: number) => `$${x.toFixed(2)}`;

/** Bill of materials with mass and cost; typical prices from the database, overridable here. */
export function BomTable({ design, lookup }: { design: Design; lookup: Lookup }) {
  const bom = useMemo(
    () => bomOf(design, resolveChassis(design, getChassis), lookup),
    [design, lookup],
  );
  const [prices, setPrices] = useState<Record<string, number>>({});
  const unit = (id: string, typical: number | undefined) => prices[id] ?? typical;
  const total = bom.lines.reduce(
    (s, l) => s + (unit(l.componentId, l.typicalPriceUsd) ?? 0) * l.quantity,
    0,
  );
  const unpriced = bom.lines.filter(
    (l) => unit(l.componentId, l.typicalPriceUsd) === undefined,
  ).length;
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Bill of materials</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th scope="col" className="py-1 pr-2 font-normal">
                Qty
              </th>
              <th scope="col" className="py-1 pr-2 font-normal">
                Part
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-normal">
                Mass
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Unit price
              </th>
            </tr>
          </thead>
          <tbody>
            {bom.lines.map((l) => (
              <tr key={l.componentId} className="border-b border-border/60">
                <td className="py-1 pr-2">{l.quantity}</td>
                <td className="py-1 pr-2">
                  {l.datasheetUrl ? (
                    <a href={l.datasheetUrl} target="_blank" rel="noreferrer" className="underline">
                      {l.name}
                    </a>
                  ) : (
                    l.name
                  )}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{l.massG * l.quantity} g</td>
                <td className="py-1 text-right">
                  <label className="inline-flex items-center gap-1">
                    <span className="sr-only">Unit price of {l.name} in US dollars</span>$
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={unit(l.componentId, l.typicalPriceUsd) ?? ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? undefined : Number(e.target.value);
                        setPrices((p) => {
                          const { [l.componentId]: _drop, ...rest } = p;
                          return v === undefined || Number.isNaN(v)
                            ? rest
                            : { ...rest, [l.componentId]: v };
                        });
                      }}
                      className="w-20 rounded border border-border bg-bg px-1 text-right tabular-nums"
                    />
                  </label>
                </td>
              </tr>
            ))}
            <tr className="border-b border-border/60 text-muted">
              <td />
              <td className="py-1 pr-2">Chassis plate</td>
              <td className="py-1 pr-2 text-right tabular-nums">{bom.chassisMassG.toFixed(0)} g</td>
              <td />
            </tr>
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td />
              <td className="py-1 pr-2">Total</td>
              <td className="py-1 pr-2 text-right tabular-nums">{bom.totalMassG.toFixed(0)} g</td>
              <td className="py-1 text-right tabular-nums" data-testid="bom-total">
                {usd(total)}
                {unpriced > 0 ? ` + ${String(unpriced)} unpriced` : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Typical single-unit prices from LineLab&apos;s database; edit them to match your supplier.
        Wires, screws and solder aren&apos;t included.
      </p>
      <button
        type="button"
        className="mt-2 rounded-md border border-border px-3 py-1 text-sm hover:border-accent"
        onClick={() => {
          download(`${slug(design.name)}-bom.csv`, bomCsv(bom, prices), "text/csv");
        }}
      >
        Download CSV
      </button>
    </div>
  );
}
