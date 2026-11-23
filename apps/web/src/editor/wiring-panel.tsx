"use client";

import type { NetEndpoint } from "@linelab/schema";
import { useMemo, useState } from "react";
import { netColor } from "./nets";
import { lookup, useDesign, useEditor } from "./store";

const same = (a: NetEndpoint | null, b: NetEndpoint) =>
  a !== null && a.instanceId === b.instanceId && a.pinId === b.pinId;

export default function WiringPanel() {
  const design = useDesign();
  const pending = useEditor((s) => s.pendingPin);
  const st = useEditor.getState();
  const [open, setOpen] = useState<string | null>(null);
  const netOf = useMemo(() => {
    const m = new Map<string, (typeof design.netlist)[number]>();
    for (const n of design.netlist)
      for (const c of n.connections) m.set(`${c.instanceId}/${c.pinId}`, n);
    return m;
  }, [design]);
  const electrical = design.placements.filter((p) => (lookup(p.componentId)?.pins.length ?? 0) > 0);

  return (
    <section aria-labelledby="wiring-heading" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <h2 id="wiring-heading" className="text-sm font-semibold">
          Wiring
        </h2>
        <span className="text-xs text-muted" data-testid="net-count">
          {design.netlist.length} nets
        </span>
      </div>
      <div className="flex flex-wrap gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            st.autoWire();
          }}
          className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-white dark:text-black"
        >
          Auto-wire
        </button>
        <button
          type="button"
          onClick={() => {
            if (design.netlist.length === 0 || confirm("Remove every connection?"))
              st.clearWiring();
          }}
          className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent"
        >
          Clear
        </button>
      </div>
      <p className="px-3 pb-2 text-xs text-muted" role="status">
        {pending
          ? `Now click the pin to connect ${pending.instanceId}.${pending.pinId} to (or the same pin to cancel).`
          : "Click a pin, then another pin, to connect them."}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {electrical.length === 0 && <p className="px-1 text-sm text-muted">Add parts first.</p>}
        {electrical.map((p) => {
          const c = lookup(p.componentId);
          if (!c) return null;
          const isOpen = open === p.instanceId || (open === null && electrical[0] === p);
          return (
            <div key={p.instanceId} className="mb-1 rounded-md border border-border">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => {
                  setOpen(isOpen ? "" : p.instanceId);
                }}
                className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm"
              >
                <span className="truncate">
                  <span className="font-mono text-xs text-muted">{p.instanceId}</span> {c.name}
                </span>
                <span className="text-xs text-muted">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <ul className="grid grid-cols-2 gap-1 px-2 pb-2">
                  {c.pins.map((pin) => {
                    const ep = { instanceId: p.instanceId, pinId: pin.id };
                    const net = netOf.get(`${p.instanceId}/${pin.id}`);
                    const picked = same(pending, ep);
                    return (
                      <li key={pin.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-pressed={picked}
                          aria-label={`Pin ${p.instanceId}.${pin.id}${net ? `, on net ${net.name}` : ", unconnected"}`}
                          title={`${pin.label} · ${pin.functions.join(", ")}`}
                          onClick={() => {
                            st.clickPin(ep);
                          }}
                          className={`flex min-w-0 flex-1 items-center gap-1 rounded border px-1.5 py-0.5 text-left text-xs ${picked ? "border-accent bg-accent/15" : "border-border hover:border-accent"}`}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{
                              background: net ? netColor(net) : "transparent",
                              border: net ? "none" : "1px solid currentColor",
                            }}
                          />
                          <span className="font-mono">{pin.id}</span>
                          {net && <span className="truncate text-muted">{net.name}</span>}
                        </button>
                        {net && (
                          <button
                            type="button"
                            aria-label={`Disconnect ${p.instanceId}.${pin.id}`}
                            onClick={() => {
                              st.disconnectPin(ep);
                            }}
                            className="px-1 text-xs text-muted hover:text-red-600"
                          >
                            ×
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}

        {design.netlist.length > 0 && (
          <div className="mt-3">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Nets</h3>
            <ul className="mt-1 space-y-1" data-testid="net-list">
              {design.netlist.map((n) => (
                <li key={n.id} className="rounded-md border border-border px-2 py-1 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ background: netColor(n) }} />
                    <input
                      aria-label={`Name of net ${n.name}`}
                      defaultValue={n.name}
                      key={n.name}
                      onBlur={(e) => {
                        if (e.target.value !== n.name) st.renameNet(n.id, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="min-w-0 flex-1 bg-transparent font-medium"
                    />
                  </div>
                  <p className="mt-0.5 break-words font-mono text-muted">
                    {n.connections.map((c) => `${c.instanceId}.${c.pinId}`).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
