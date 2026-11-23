"use client";

import { bounds } from "@linelab/design-core";
import type { Chassis, Polygon, Vec2 } from "@linelab/schema";
import { useRef, useState } from "react";

/**
 * Top view of a chassis with the robot's front pointing up the page (screen x = −y, screen y = −x),
 * matching the editor's top camera. With `onChange`, outline vertices can be dragged (1 mm steps),
 * a double-click on an edge inserts a vertex, and the selected vertex can be deleted.
 */
export function OutlineSvg({
  chassis,
  onChange,
  className,
  title,
}: {
  chassis: Pick<Chassis, "outline" | "cutouts" | "mountPoints" | "wheelMounts" | "casterMounts">;
  onChange?: (outline: Polygon) => void;
  className?: string;
  title?: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const b = bounds([...chassis.outline, ...chassis.wheelMounts.map((w) => w.position)]);
  const pad = 14;
  const vb = `${-b.maxY - pad} ${-b.maxX - pad} ${b.maxY - b.minY + 2 * pad} ${b.maxX - b.minX + 2 * pad}`;
  const pts = (poly: readonly Vec2[]) => poly.map((p) => `${-p.y},${-p.x}`).join(" ");

  const toChassis = (clientX: number, clientY: number): Vec2 | undefined => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return undefined;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: Math.round(-p.y), y: Math.round(-p.x) };
  };

  const editable = onChange !== undefined;
  return (
    <svg
      ref={svg}
      viewBox={vb}
      role="img"
      aria-label={title ?? "Chassis outline, top view, front up"}
      className={className}
      onPointerMove={(e) => {
        if (dragging === null || !onChange) return;
        const p = toChassis(e.clientX, e.clientY);
        if (p) onChange(chassis.outline.map((q, i) => (i === dragging ? p : q)));
      }}
      onPointerUp={() => {
        setDragging(null);
      }}
      onKeyDown={(e) => {
        if (!onChange || active === null) return;
        if ((e.key === "Delete" || e.key === "Backspace") && chassis.outline.length > 3) {
          onChange(chassis.outline.filter((_, i) => i !== active));
          setActive(null);
        }
      }}
      tabIndex={editable ? 0 : undefined}
    >
      <polygon
        points={pts(chassis.outline)}
        className="fill-accent/15 stroke-accent"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {(chassis.cutouts ?? []).map((c, i) => (
        <polygon
          key={i}
          points={pts(c)}
          className="fill-bg stroke-accent"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {chassis.mountPoints.map((m, i) => (
        <circle key={i} cx={-m.y} cy={-m.x} r={1.6} className="fill-muted/60" />
      ))}
      {chassis.wheelMounts.map((w, i) => (
        <rect
          key={i}
          x={-w.position.y - 4}
          y={-w.position.x - w.axleHeightMm}
          width={8}
          height={w.axleHeightMm * 2}
          rx={2}
          className="fill-fg/70"
        />
      ))}
      {chassis.casterMounts.map((c, i) => (
        <circle
          key={i}
          cx={-c.y}
          cy={-c.x}
          r={4}
          className="fill-none stroke-fg/70"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {editable && (
        <>
          {chassis.outline.map((p, i) => {
            const q = chassis.outline[(i + 1) % chassis.outline.length] as Vec2;
            return (
              <line
                key={`e${i}`}
                x1={-p.y}
                y1={-p.x}
                x2={-q.y}
                y2={-q.x}
                stroke="transparent"
                strokeWidth={8}
                className="cursor-copy"
                onDoubleClick={() => {
                  const mid = { x: Math.round((p.x + q.x) / 2), y: Math.round((p.y + q.y) / 2) };
                  onChange([
                    ...chassis.outline.slice(0, i + 1),
                    mid,
                    ...chassis.outline.slice(i + 1),
                  ]);
                  setActive(i + 1);
                }}
              />
            );
          })}
          {chassis.outline.map((p, i) => (
            <circle
              key={`v${i}`}
              data-testid="outline-vertex"
              cx={-p.y}
              cy={-p.x}
              r={3}
              className={`cursor-move ${active === i ? "fill-accent" : "fill-card stroke-accent"}`}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture(e.pointerId);
                setDragging(i);
                setActive(i);
              }}
            />
          ))}
        </>
      )}
    </svg>
  );
}
