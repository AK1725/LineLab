"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Design } from "@linelab/schema";
import { useEffect, useRef, useState } from "react";
import ChassisDialog from "./chassis-dialog";
import Inspector from "./inspector";
import PartsPanel from "./parts-panel";
import SchematicView from "./schematic-view";

const CodeView = dynamic(() => import("../firmware/code-view"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted">Loading code editor…</p>,
});
const RobotView = dynamic(() => import("../robot/robot-view"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted">Loading robot tools…</p>,
});
const RunView = dynamic(() => import("../sim/run-view"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted">Loading simulator…</p>,
});
import WiringPanel from "./wiring-panel";
import { loadDesign, saveDesign } from "./persistence";
import { useEditor } from "./store";
import Toolbar from "./toolbar";

const Scene = dynamic(() => import("./scene"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-card" />,
});

declare global {
  interface Window {
    __linelabEditor?: typeof useEditor;
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return (
    t !== null &&
    (t.tagName === "INPUT" ||
      t.tagName === "SELECT" ||
      t.tagName === "TEXTAREA" ||
      t.isContentEditable)
  );
}

function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || document.querySelector("[role=dialog]")) return;
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const step = st.gridMm || 1;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        st.redo();
      } else if (mod && k === "d") {
        e.preventDefault();
        st.duplicateSelected();
      } else if (mod && k === "a") {
        e.preventDefault();
        st.select(st.history.present.placements.map((p) => p.instanceId));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        st.removeSelected();
      } else if (e.key === "Escape") {
        st.select([]);
      } else if (k === "r") {
        st.rotateSelected(e.shiftKey ? -Math.PI / 2 : Math.PI / 2);
      } else if (k === "q" || k === "e") {
        st.rotateSelected(((k === "q" ? 1 : -1) * Math.PI) / 12);
      } else if (e.key.startsWith("Arrow") && st.selection.length > 0) {
        e.preventDefault();
        // Arrow keys follow the top view: up = forward (+x), left = +y.
        const d = {
          ArrowUp: [step, 0],
          ArrowDown: [-step, 0],
          ArrowLeft: [0, step],
          ArrowRight: [0, -step],
        }[e.key] as [number, number];
        st.nudge(d[0], d[1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled]);
}

function LeftTabs() {
  const panel = useEditor((s) => s.leftPanel);
  return (
    <div role="tablist" aria-label="Left panel" className="flex border-b border-border">
      {(["parts", "wiring"] as const).map((p) => (
        <button
          key={p}
          role="tab"
          aria-selected={panel === p}
          onClick={() => {
            useEditor.getState().setLeftPanel(p);
          }}
          className={`flex-1 py-2 text-sm ${panel === p ? "border-b-2 border-accent font-medium" : "text-muted hover:text-fg"}`}
        >
          {p === "parts" ? "Parts" : "Wiring"}
        </button>
      ))}
    </div>
  );
}

export default function Editor() {
  const params = useSearchParams();
  const id = params.get("id");
  const initialView = params.get("view");
  // Which id finished loading, and whether it existed. Status is derived, never set in an effect.
  const [loaded, setLoaded] = useState<{ id: string; found: boolean } | null>(null);
  const status: "loading" | "ready" | "missing" =
    id === null ? "missing" : loaded?.id !== id ? "loading" : loaded.found ? "ready" : "missing";
  // The last design object written to storage (or a failure), to derive "Saving…" / "Saved".
  const [saved, setSaved] = useState<{ design: unknown; ok: boolean } | null>(null);
  const [chassisOpen, setChassisOpen] = useState(false);
  const design = useEditor((s) => s.history.present);
  const leftPanel = useEditor((s) => s.leftPanel);
  const view = useEditor((s) => s.view);

  useEffect(() => {
    window.__linelabEditor = useEditor; // test & debugging hook
    if (id === null) return;
    let cancelled = false;
    void loadDesign(id).then((found) => {
      if (cancelled) return;
      if (found) {
        useEditor.getState().load(found.design);
        // Deep links (learn mode, gallery) can open a specific view.
        if (initialView === "run" || initialView === "code" || initialView === "robot")
          useEditor.getState().setView(initialView);
      }
      setLoaded({ id, found: found !== undefined });
    });
    return () => {
      cancelled = true;
    };
  }, [id, initialView]);

  // Autosave (debounced) whenever the design changes. A change still waiting for its save is
  // written immediately when the editor unmounts (a link to another page) or the page is hidden
  // (reload, tab close), so leaving right after an edit never loses it.
  const pending = useRef<Design | null>(null);
  useEffect(() => {
    if (status !== "ready" || design.id !== id) return;
    pending.current = design;
    const t = setTimeout(() => {
      pending.current = null;
      saveDesign(design).then(
        () => {
          setSaved({ design, ok: true });
        },
        () => {
          setSaved({ design, ok: false });
        },
      );
    }, 400);
    return () => {
      clearTimeout(t);
    };
  }, [design, status, id]);
  useEffect(() => {
    const flush = () => {
      const d = pending.current;
      pending.current = null;
      if (d) void saveDesign(d).catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const saveState =
    saved?.ok === false
      ? "Not saved: browser storage is unavailable"
      : saved?.design === design
        ? "Saved"
        : "Saving…";

  useShortcuts(status === "ready");

  if (status === "missing") {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Design not found</h1>
        <p className="mt-2 text-muted">
          It may have been deleted, or it was saved in another browser.
        </p>
        <Link
          href="/build"
          className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 font-medium text-white dark:text-black"
        >
          Back to designs
        </Link>
      </main>
    );
  }
  if (status === "loading") return <p className="p-6 text-sm text-muted">Loading design…</p>;

  return (
    <main className="flex h-[calc(100dvh-49px)] flex-col">
      <Toolbar
        saveState={saveState}
        onChassis={() => {
          setChassisOpen(true);
        }}
      />
      {view === "run" || view === "code" || view === "robot" ? (
        <div className="min-h-0 flex-1">
          {view === "run" ? <RunView /> : view === "robot" ? <RobotView /> : <CodeView />}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(300px,1fr)_auto] lg:grid-cols-[17rem_1fr_19rem] lg:grid-rows-1">
          <aside className="order-2 flex max-h-80 min-h-0 flex-col border-t border-border lg:order-1 lg:max-h-none lg:border-r lg:border-t-0">
            <LeftTabs />
            <div className="min-h-0 flex-1">
              {leftPanel === "parts" ? <PartsPanel /> : <WiringPanel />}
            </div>
          </aside>
          <div className="order-1 min-h-0 lg:order-2">
            {view === "schematic" ? <SchematicView /> : <Scene />}
          </div>
          <aside className="order-3 min-h-0 overflow-y-auto border-t border-border lg:border-l lg:border-t-0">
            <Inspector />
          </aside>
        </div>
      )}
      {chassisOpen && (
        <ChassisDialog
          onClose={() => {
            setChassisOpen(false);
          }}
        />
      )}
    </main>
  );
}
