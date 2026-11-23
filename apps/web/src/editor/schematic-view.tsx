"use client";

import { useRef } from "react";
import { download, slug } from "./files";
import { Schematic, schematicPng, schematicSvgText } from "./schematic";
import { useDesign } from "./store";

export default function SchematicView() {
  const design = useDesign();
  const ref = useRef<SVGSVGElement>(null);
  const base = slug(design.name);
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <span className="text-muted">
          Net-label schematic: pins with the same coloured tag are connected.
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (ref.current)
                download(`${base}-schematic.svg`, schematicSvgText(ref.current), "image/svg+xml");
            }}
            className="rounded-md border border-border px-2 py-1 hover:border-accent"
          >
            SVG
          </button>
          <button
            type="button"
            onClick={() => {
              const svg = ref.current;
              if (!svg) return;
              void schematicPng(svg).then((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${base}-schematic.png`;
                a.click();
                setTimeout(() => {
                  URL.revokeObjectURL(url);
                }, 1000);
              });
            }}
            className="rounded-md border border-border px-2 py-1 hover:border-accent"
          >
            PNG
          </button>
          <button
            type="button"
            onClick={() => {
              const svg = ref.current;
              const w = window.open("", "_blank");
              if (!svg || !w) return;
              w.document.title = `${design.name} schematic`;
              w.document.body.innerHTML = schematicSvgText(svg).replace(/^<\?xml[^>]*>/, "");
              w.document.body.style.margin = "0";
              w.print();
            }}
            className="rounded-md border border-border px-2 py-1 hover:border-accent"
          >
            Print / PDF
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {design.netlist.length === 0 && (
          <p className="mb-2 text-sm text-muted">
            No connections yet: open the Wiring tab and press Auto-wire, or click pins to connect
            them.
          </p>
        )}
        <Schematic ref={ref} />
      </div>
    </div>
  );
}
