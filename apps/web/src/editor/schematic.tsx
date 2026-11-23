"use client";

import type { Component, Design, Net, Placement } from "@linelab/schema";
import { forwardRef, useMemo } from "react";
import { netColor } from "./nets";
import { lookup, useDesign } from "./store";

const COLUMN: Partial<Record<Component["category"], number>> = {
  battery: 0,
  input: 0,
  regulator: 0,
  mcu: 1,
  motor_driver: 2,
  esc: 2,
  motor: 3,
  line_sensor: 3,
  sensor: 3,
  communication: 3,
  display: 3,
  indicator: 3,
  fan: 3,
};
const BOX_W = 170;
const ROW = 16;
const GAP_X = 240;
const MAX_TAG = 18;
const tagText = (name: string) => (name.length > MAX_TAG ? `${name.slice(0, MAX_TAG - 1)}…` : name);
const GAP_Y = 28;

interface Block {
  p: Placement;
  c: Component;
  x: number;
  y: number;
  h: number;
  /** Pins on the left (true) or right side of the box. */
  side: (i: number) => "left" | "right";
}

/** Places parts in four columns (power · MCU · drivers · loads) with pins facing the MCU. */
export function layoutSchematic(design: Design): {
  blocks: Block[];
  width: number;
  height: number;
} {
  const cols: Block[][] = [[], [], [], []];
  for (const p of design.placements) {
    const c = lookup(p.componentId);
    if (!c || c.pins.length === 0) continue;
    const col = COLUMN[c.category] ?? 3;
    const rows = col === 1 ? Math.ceil(c.pins.length / 2) : c.pins.length;
    const h = 30 + rows * ROW;
    const half = Math.ceil(c.pins.length / 2);
    cols[col]?.push({
      p,
      c,
      x: 40 + col * (BOX_W + GAP_X),
      y: 0,
      h,
      side: (i) => (col === 0 ? "right" : col === 1 ? (i < half ? "left" : "right") : "left"),
    });
  }
  let height = 0;
  for (const col of cols) {
    let y = 40;
    for (const b of col) {
      b.y = y;
      y += b.h + GAP_Y;
    }
    height = Math.max(height, y);
  }
  return { blocks: cols.flat(), width: 40 + 4 * (BOX_W + GAP_X), height: Math.max(height, 200) };
}

function pinPos(b: Block, i: number): { x: number; y: number; side: "left" | "right" } {
  const side = b.side(i);
  const half = Math.ceil(b.c.pins.length / 2);
  const row = COLUMN[b.c.category] === 1 ? (i < half ? i : i - half) : i;
  return { x: side === "left" ? b.x : b.x + BOX_W, y: b.y + 30 + row * ROW + ROW / 2, side };
}

/** Net-label schematic: each connected pin carries a coloured tag with its net name. */
export const Schematic = forwardRef<SVGSVGElement, { design?: Design }>(
  function Schematic(props, ref) {
    const fromStore = useDesign();
    const design = props.design ?? fromStore;
    const { blocks, width, height } = useMemo(() => layoutSchematic(design), [design]);
    const netOf = useMemo(() => {
      const m = new Map<string, Net>();
      for (const n of design.netlist)
        for (const c of n.connections) m.set(`${c.instanceId}/${c.pinId}`, n);
      return m;
    }, [design]);

    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Schematic of ${design.name}`}
        data-testid="schematic"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        <rect width={width} height={height} fill="#ffffff" />
        <text x={40} y={24} fontSize={14} fontWeight={600} fill="#111827">
          {design.name} — net-label schematic
        </text>
        {blocks.map((b) => (
          <g key={b.p.instanceId}>
            <rect
              x={b.x}
              y={b.y}
              width={BOX_W}
              height={b.h}
              rx={4}
              fill="#f8fafc"
              stroke="#334155"
            />
            <text x={b.x + 6} y={b.y + 13} fontSize={10} fontWeight={700} fill="#0f172a">
              {b.p.instanceId}
            </text>
            <text x={b.x + 6} y={b.y + 24} fontSize={8} fill="#475569">
              {b.c.name.length > 34 ? `${b.c.name.slice(0, 33)}…` : b.c.name}
            </text>
            {b.c.pins.map((pin, i) => {
              const pos = pinPos(b, i);
              const net = netOf.get(`${b.p.instanceId}/${pin.id}`);
              const dir = pos.side === "left" ? -1 : 1;
              const tagX = pos.x + dir * 18;
              const tagW = net ? Math.max(28, tagText(net.name).length * 5.4 + 8) : 0;
              return (
                <g key={pin.id}>
                  <line
                    x1={pos.x}
                    y1={pos.y}
                    x2={pos.x + dir * 16}
                    y2={pos.y}
                    stroke={net ? netColor(net) : "#cbd5e1"}
                    strokeWidth={1.5}
                  />
                  <text
                    x={pos.side === "left" ? b.x + 6 : b.x + BOX_W - 6}
                    y={pos.y + 3}
                    fontSize={9}
                    textAnchor={pos.side === "left" ? "start" : "end"}
                    fill={net ? "#0f172a" : "#94a3b8"}
                    fontFamily="ui-monospace, monospace"
                  >
                    {pin.id}
                  </text>
                  {net && (
                    <g>
                      <rect
                        x={dir === -1 ? tagX - tagW : tagX}
                        y={pos.y - 6}
                        width={tagW}
                        height={12}
                        rx={6}
                        fill={netColor(net)}
                      />
                      <text
                        x={dir === -1 ? tagX - tagW / 2 : tagX + tagW / 2}
                        y={pos.y + 3}
                        fontSize={8}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontWeight={600}
                      >
                        {tagText(net.name)}
                        <title>{net.name}</title>
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    );
  },
);

export function schematicSvgText(svg: SVGSVGElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

/** Renders the schematic SVG to a PNG data URL at 2× resolution. */
export async function schematicPng(svg: SVGSVGElement): Promise<Blob> {
  const w = Number(svg.getAttribute("width"));
  const h = Number(svg.getAttribute("height"));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([schematicSvgText(svg)], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        resolve();
      };
      img.onerror = () => {
        reject(new Error("Could not render the schematic"));
      };
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas");
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("PNG export failed"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
