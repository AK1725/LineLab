"use client";

import {
  CHASSIS,
  COMPONENTS,
  createSearchIndex,
  getChassis,
  getComponent,
} from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import {
  matchDetections,
  proposeDesign,
  type DetectionMatch,
  type Pick,
  type Proposal,
} from "@linelab/photo-design";
import { runRules } from "@linelab/rules-engine";
import { DetectionResult, PhotoView, type Net, type Vec2 } from "@linelab/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { OutlineSvg } from "../editor/outline-svg";
import { newDesignId, saveDesign } from "../editor/persistence";

const index = createSearchIndex(COMPONENTS);
/** Long edge sent to the model (larger photos are downscaled; the model sees ~1.5 MP at most). */
const MAX_EDGE = 1568;
const VIEWS = PhotoView.options;

interface Photo {
  file: File;
  url: string;
  view: PhotoView;
}

interface Outline {
  polygon: [number, number][];
  width_px: number;
  height_px: number;
}

const btn =
  "rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent disabled:cursor-not-allowed disabled:opacity-50";
const primary =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:text-black";

/** JPEG, long edge ≤ MAX_EDGE, as base64 (no prefix), plus its size. */
async function encode(file: File): Promise<{ data: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { data: url.slice(url.indexOf(",") + 1), w, h };
}

const errorOf = async (res: Response) => {
  try {
    const j = (await res.json()) as { error?: string; detail?: string };
    return j.error ?? j.detail ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
};

export default function PhotoWizard() {
  const router = useRouter();
  const [step, setStep] = useState<"photos" | "parts" | "chassis" | "wiring">("photos");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [top, setTop] = useState<{
    w: number;
    h: number;
    outline?: Vec2[];
    outlineNote?: string;
  } | null>(null);
  const [picks, setPicks] = useState<Record<string, { componentId: string | null; count: number }>>(
    {},
  );
  const [chassisChoice, setChassisChoice] = useState<string>("photo");
  const [decided, setDecided] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("My robot");

  const matches: DetectionMatch[] = useMemo(
    () => (result ? matchDetections(result.detections, index, COMPONENTS) : []),
    [result],
  );
  const pickList: Pick[] = useMemo(
    () =>
      Object.entries(picks).flatMap(([detectionId, p]) =>
        p.componentId ? [{ detectionId, componentId: p.componentId, count: p.count }] : [],
      ),
    [picks],
  );
  const proposal: Proposal | { error: string } | null = useMemo(() => {
    if (!result || step === "photos" || step === "parts") return null;
    try {
      return proposeDesign({
        id: "draft",
        name,
        detections: result.detections,
        picks: pickList,
        ...(top
          ? {
              top: {
                widthPx: top.w,
                heightPx: top.h,
                ...(top.outline ? { outline: top.outline } : {}),
              },
            }
          : {}),
        frontInTop: result.frontInTop,
        chassis:
          chassisChoice === "photo"
            ? { kind: "photo" }
            : { kind: "template", chassisId: chassisChoice },
        lookup: getComponent,
        getChassis,
        templates: CHASSIS,
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [result, step, name, pickList, top, chassisChoice]);
  const okProposal = proposal && !("error" in proposal) ? proposal : null;
  const confirmedNets: Net[] = useMemo(
    () => (okProposal ? okProposal.proposedNets.filter((n) => decided[n.id]) : []),
    [okProposal, decided],
  );
  const findings = useMemo(() => {
    if (!okProposal) return [];
    const d = { ...okProposal.design, netlist: confirmedNets };
    const ch = resolveChassis(d, getChassis);
    return ch ? runRules(d, ch, getComponent) : [];
  }, [okProposal, confirmedNets]);
  const errors = findings.filter((f) => f.severity === "error");

  async function analyse() {
    const topPhoto = photos.find((p) => p.view === "top");
    if (!topPhoto) return;
    setBusy(true);
    setError(null);
    try {
      const encoded = await Promise.all(photos.map((p) => encode(p.file)));
      const topEnc = encoded[photos.indexOf(topPhoto)];
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (key.trim()) headers["x-anthropic-api-key"] = key.trim();
      const form = new FormData();
      form.append("file", topPhoto.file);
      const [det, out] = await Promise.all([
        fetch("/api/photo/detect", {
          method: "POST",
          headers,
          body: JSON.stringify({
            photos: photos.map((p, i) => ({
              view: p.view,
              mediaType: "image/jpeg",
              data: encoded[i]?.data ?? "",
            })),
          }),
        }),
        fetch("/api/vision/robot-outline", { method: "POST", body: form }).catch(() => undefined),
      ]);
      if (!det.ok) throw new Error(await errorOf(det));
      const r = DetectionResult.parse(await det.json());
      let outline: Vec2[] | undefined;
      let outlineNote: string | undefined;
      if (out?.ok) {
        const o = (await out.json()) as Outline;
        outline = o.polygon.map(([x, y]) => ({ x, y }));
      } else outlineNote = out ? await errorOf(out) : "The vision service didn't answer.";
      setResult(r);
      setTop({
        w: topEnc?.w ?? 1000,
        h: topEnc?.h ?? 1000,
        ...(outline ? { outline } : {}),
        ...(outlineNote ? { outlineNote } : {}),
      });
      const m = matchDetections(r.detections, index, COMPONENTS);
      setPicks(
        Object.fromEntries(
          r.detections.map((d, i) => [
            d.id,
            { componentId: m[i]?.candidates[0]?.componentId ?? null, count: d.count },
          ]),
        ),
      );
      setChassisChoice(outline ? "photo" : (CHASSIS[0]?.id ?? "photo"));
      setStep("parts");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!okProposal) return;
    const d = { ...okProposal.design, id: newDesignId(), name, netlist: confirmedNets };
    await saveDesign(d);
    router.push(`/build/edit?id=${d.id}`);
  }

  const topPhoto = photos.find((p) => p.view === "top");
  const steps = ["photos", "parts", "chassis", "wiring"] as const;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Robot from photos</h1>
      <p className="mt-2 text-muted">
        LineLab suggests the parts, layout and wiring of your real robot from photos. You confirm
        every part and every connection; nothing is assumed. Photo import assists, it doesn&apos;t
        replace checking.
      </p>
      <ol className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Steps">
        {steps.map((s, i) => (
          <li
            key={s}
            aria-current={step === s ? "step" : undefined}
            className={`rounded-full border px-3 py-1 ${step === s ? "border-accent font-medium" : "border-border text-muted"}`}
          >
            {i + 1}.{" "}
            {s === "photos"
              ? "Photos"
              : s === "parts"
                ? "Parts"
                : s === "chassis"
                  ? "Chassis & layout"
                  : "Wiring"}
          </li>
        ))}
      </ol>

      {step === "photos" && (
        <section className="mt-6 space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>
              <b>Top view</b> (required): straight down, the robot&apos;s <b>front pointing up</b>,
              on a plain floor or table that contrasts with it, filling most of the frame.
            </li>
            <li>Bottom, front and side views help identify motors, sensors and wheels.</li>
            <li>Close-ups of boards with readable chip markings help the most.</li>
          </ul>
          <label className={`${btn} inline-block cursor-pointer`}>
            Add photos…
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              aria-label="Add photos"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])].slice(0, 8 - photos.length);
                setPhotos((ps) => [
                  ...ps,
                  ...files.map((file, i) => ({
                    file,
                    url: URL.createObjectURL(file),
                    view: VIEWS[ps.length + i] ?? ("other" as const),
                  })),
                ]);
                e.target.value = "";
              }}
            />
          </label>
          <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Photos">
            {photos.map((p, i) => (
              <li key={p.url} className="rounded-lg border border-border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img
                  src={p.url}
                  alt={`${p.view} view`}
                  className="h-32 w-full rounded object-contain"
                />
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <select
                    aria-label={`View of photo ${i + 1}`}
                    value={p.view}
                    onChange={(e) => {
                      const view = e.target.value as PhotoView;
                      setPhotos((ps) => ps.map((x, k) => (k === i ? { ...x, view } : x)));
                    }}
                    className="rounded-md border border-border bg-bg px-1 py-1"
                  >
                    {VIEWS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button
                    className="ml-auto text-muted hover:text-fg"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => {
                      setPhotos((ps) => ps.filter((_, k) => k !== i));
                    }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Use your own Anthropic API key</summary>
            <input
              type="password"
              aria-label="Anthropic API key"
              value={key}
              autoComplete="off"
              onChange={(e) => {
                setKey(e.target.value);
              }}
              placeholder="sk-ant-…"
              className="mt-2 w-full max-w-md rounded-md border border-border bg-bg px-2 py-1"
            />
            <p className="mt-1 text-xs text-muted">Sent with this request only; never stored.</p>
          </details>
          <div className="flex items-center gap-3">
            <button className={primary} disabled={!topPhoto || busy} onClick={() => void analyse()}>
              {busy ? "Analysing…" : "Analyse photos"}
            </button>
            {!topPhoto && photos.length > 0 && (
              <span className="text-sm text-muted">Mark one photo as the top view.</span>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </section>
      )}

      {step === "parts" && result && (
        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-3">
            {result.detector !== "claude-vision" && (
              <p className="rounded bg-amber-500/15 px-2 py-1 text-sm text-amber-700 dark:text-amber-400">
                {result.detector === "scripted"
                  ? "Detections from a scripted replay (demo/test), not a model."
                  : `Detections from the ${result.detector} detector.`}
              </p>
            )}
            <p className="text-sm text-muted">
              For each part LineLab found, pick the matching database part (best guess first) or say
              it isn&apos;t there. Fix the count if needed.
            </p>
            <ul className="space-y-3" aria-label="Detected parts">
              {result.detections.map((d, i) => {
                const m = matches[i];
                const p = picks[d.id];
                return (
                  <li
                    key={d.id}
                    className="rounded-lg border border-border p-3"
                    data-testid="detection"
                  >
                    <p className="text-sm">
                      <span className="font-medium">{d.description}</span>{" "}
                      {d.markings.length > 0 && (
                        <span className="text-muted">· reads “{d.markings.join("”, “")}”</span>
                      )}{" "}
                      <span className="text-muted">· {Math.round(d.confidence * 100)} % sure</span>
                    </p>
                    <fieldset className="mt-2 space-y-1 text-sm">
                      <legend className="sr-only">Part for {d.description}</legend>
                      {m?.candidates.map((c) => (
                        <label key={c.componentId} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`pick-${d.id}`}
                            checked={p?.componentId === c.componentId}
                            onChange={() => {
                              setPicks((x) => ({
                                ...x,
                                [d.id]: { componentId: c.componentId, count: p?.count ?? d.count },
                              }));
                            }}
                          />
                          {c.name}
                        </label>
                      ))}
                      <label className="flex items-center gap-2 text-muted">
                        <input
                          type="radio"
                          name={`pick-${d.id}`}
                          checked={p?.componentId === null}
                          onChange={() => {
                            setPicks((x) => ({
                              ...x,
                              [d.id]: { componentId: null, count: p?.count ?? d.count },
                            }));
                          }}
                        />
                        Not on my robot / none of these
                      </label>
                    </fieldset>
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <span className="text-muted">How many</span>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={p?.count ?? d.count}
                        aria-label={`How many of ${d.description}`}
                        onChange={(e) => {
                          const count = Math.min(8, Math.max(1, Number(e.target.value) || 1));
                          setPicks((x) => ({
                            ...x,
                            [d.id]: { componentId: p?.componentId ?? null, count },
                          }));
                        }}
                        className="w-16 rounded-md border border-border bg-bg px-1 py-0.5"
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-2">
              <button
                className={btn}
                onClick={() => {
                  setStep("photos");
                }}
              >
                Back
              </button>
              <button
                className={primary}
                disabled={pickList.length === 0}
                onClick={() => {
                  setStep("chassis");
                }}
              >
                Next: chassis & layout
              </button>
            </div>
          </div>
          {topPhoto && top && (
            <figure className="relative self-start">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img
                src={topPhoto.url}
                alt="Top view with detected parts"
                className="w-full rounded"
              />
              <svg
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
                aria-hidden
              >
                {top.outline && (
                  <polygon
                    points={top.outline.map((q) => `${q.x},${q.y}`).join(" ")}
                    fill="none"
                    stroke="#0f9d74"
                    strokeWidth={0.006}
                  />
                )}
                {result.detections.map((d) =>
                  d.topBox ? (
                    <rect
                      key={d.id}
                      x={d.topBox.x}
                      y={d.topBox.y}
                      width={d.topBox.w}
                      height={d.topBox.h}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth={0.005}
                    />
                  ) : null,
                )}
              </svg>
              <figcaption className="mt-1 text-xs text-muted">
                Green: robot outline{top.outlineNote ? ` (not found: ${top.outlineNote})` : ""}.
                Orange: parts found in the top view. Front: {result.frontInTop}.
              </figcaption>
            </figure>
          )}
        </section>
      )}

      {step === "chassis" && (
        <section className="mt-6 space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Name</span>
            <input
              value={name}
              aria-label="Design name"
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="rounded-md border border-border bg-bg px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Chassis</span>
            <select
              aria-label="Chassis"
              value={chassisChoice}
              onChange={(e) => {
                setChassisChoice(e.target.value);
              }}
              className="rounded-md border border-border bg-bg px-1 py-1"
            >
              <option value="photo" disabled={!top?.outline}>
                From the photo{top?.outline ? "" : " (no outline found)"}
              </option>
              {CHASSIS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {proposal && "error" in proposal && (
            <p className="text-sm text-red-600">{proposal.error}</p>
          )}
          {okProposal && (
            <div className="grid gap-4 sm:grid-cols-[16rem_1fr]">
              {(() => {
                const ch = resolveChassis(okProposal.design, getChassis);
                return ch ? (
                  <OutlineSvg
                    chassis={ch}
                    className="h-56 w-full"
                    title="Proposed chassis outline"
                  />
                ) : null;
              })()}
              <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="proposal-notes">
                {okProposal.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
                <li>
                  {okProposal.design.placements.length} parts placed. You can drag any of them in
                  the editor afterwards.
                </li>
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button
              className={btn}
              onClick={() => {
                setStep("parts");
              }}
            >
              Back
            </button>
            <button
              className={primary}
              disabled={!okProposal}
              onClick={() => {
                setStep("wiring");
              }}
            >
              Next: wiring
            </button>
          </div>
        </section>
      )}

      {step === "wiring" && okProposal && (
        <section className="mt-6 space-y-4">
          <p className="text-sm text-muted">
            Wiring can&apos;t be read reliably from photos. These are the usual connections for this
            combination of parts: confirm each one that matches your robot and skip the rest. You
            can change any of them later in the Wiring panel.
          </p>
          <ul className="space-y-2" aria-label="Proposed connections">
            {okProposal.proposedNets.map((n) => {
              const state = decided[n.id];
              return (
                <li
                  key={n.id}
                  data-testid="proposed-net"
                  className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm ${state === true ? "border-accent" : "border-border"} ${state === false ? "opacity-60" : ""}`}
                >
                  <span className="font-medium">{n.name}</span>
                  <span className="text-muted">
                    {n.connections.map((c) => `${c.instanceId}.${c.pinId}`).join(" — ")}
                  </span>
                  <span className="ml-auto flex gap-1">
                    <button
                      className={state === true ? primary : btn}
                      aria-pressed={state === true}
                      aria-label={`Confirm ${n.name}`}
                      onClick={() => {
                        setDecided((x) => ({ ...x, [n.id]: true }));
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      className={btn}
                      aria-pressed={state === false}
                      aria-label={`Skip ${n.name}`}
                      onClick={() => {
                        setDecided((x) => ({ ...x, [n.id]: false }));
                      }}
                    >
                      Skip
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-sm" aria-live="polite" data-testid="wiring-status">
            {confirmedNets.length} of {okProposal.proposedNets.length} connections confirmed ·{" "}
            {errors.length === 0
              ? "no errors"
              : `${errors.length} error${errors.length === 1 ? "" : "s"}`}{" "}
            from the checks
            {errors.length > 0 &&
              `: ${errors
                .slice(0, 3)
                .map((e) => e.message)
                .join(" ")}`}
          </p>
          <div className="flex gap-2">
            <button
              className={btn}
              onClick={() => {
                setStep("chassis");
              }}
            >
              Back
            </button>
            <button className={primary} onClick={() => void create()}>
              Create design
            </button>
          </div>
        </section>
      )}

      <p className="mt-10 text-sm">
        <Link href="/build" className="text-muted underline">
          Back to designs
        </Link>
      </p>
    </main>
  );
}
