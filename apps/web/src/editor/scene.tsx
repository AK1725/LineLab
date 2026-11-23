"use client";

import {
  bounds,
  collidingIds,
  designMassProps,
  findCollisions,
  measure,
  yawOf,
} from "@linelab/design-core";
import { buildChassisModel, buildComponentModel, mergeByMaterial } from "@linelab/three-models";
import type { Chassis, Component, Placement } from "@linelab/schema";
import {
  Html,
  Line,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  QuadraticBezierLine,
} from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoxGeometry,
  EdgesGeometry,
  GridHelper,
  type Group,
  Mesh,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type BufferGeometry,
} from "three";
import { netColor, pinAnchor } from "./nets";
import { chassisOf, lookup, newGestureKey, useDesign, useEditor, type View } from "./store";

/** One merged template model per component; instances are cheap clones that share geometry. */
const templates = new Map<string, Group>();
function templateFor(c: Component): Group {
  let t = templates.get(c.id);
  if (!t) {
    t = mergeByMaterial(buildComponentModel(c));
    templates.set(c.id, t);
  }
  return t;
}

declare global {
  interface Window {
    __linelabFrames?: number;
    /** Renderer statistics for the last frame (perf mode only). */
    __linelabRender?: { calls: number; triangles: number; cpuMs: number };
    /** Test hook: page coordinates of a point in the chassis frame (mm). */
    __linelabProject?: (x: number, y: number, z: number) => { x: number; y: number };
  }
}

/** Perf mode: counts frames and records draw calls, triangles and CPU time spent in render(). */
function FrameCounter() {
  useFrame(({ gl, scene, camera }) => {
    const t0 = performance.now();
    gl.render(scene, camera);
    const cpuMs = performance.now() - t0;
    window.__linelabFrames = (window.__linelabFrames ?? 0) + 1;
    window.__linelabRender = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      cpuMs,
    };
  }, 1);
  return null;
}

function ChassisMesh({ chassis }: { chassis: Chassis }) {
  const model = useMemo(() => buildChassisModel(chassis, { opacity: 0.8 }), [chassis]);
  useEffect(
    () => () => {
      model.traverse((o) => {
        if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
      });
    },
    [model],
  );
  return <primitive object={model} />;
}

function Outline({ c, color }: { c: Component; color: string }) {
  const geom = useMemo(() => {
    const d = c.dimensionsMm;
    return new EdgesGeometry(new BoxGeometry(d.x + 1.5, d.y + 1.5, d.z + 1.5));
  }, [c]);
  useEffect(
    () => () => {
      geom.dispose();
    },
    [geom],
  );
  return (
    <lineSegments geometry={geom} position={[0, 0, c.dimensionsMm.z / 2]}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  );
}

function Part({
  placement,
  component,
  selected,
  colliding,
  onDragStart,
}: {
  placement: Placement;
  component: Component;
  selected: boolean;
  colliding: boolean;
  onDragStart: (e: ThreeEvent<PointerEvent>, p: Placement) => void;
}) {
  const object = useMemo(() => templateFor(component).clone(), [component]);
  const { x, y, z } = placement.position;
  return (
    <group
      position={[x, y, z]}
      rotation={[0, 0, yawOf(placement.rotation)]}
      name={placement.instanceId}
      onPointerDown={(e) => {
        onDragStart(e, placement);
      }}
    >
      <primitive object={object} />
      {(selected || colliding) && (
        <Outline c={component} color={colliding ? "#e5484d" : "#0f9d74"} />
      )}
    </group>
  );
}

function Cameras({ view, chassis }: { view: View; chassis: Chassis }) {
  const size = useThree((s) => s.size);
  const b = bounds(chassis.outline);
  const cx = (b.minX + b.maxX) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 120);
  if (view === "orbit") {
    return (
      <>
        <PerspectiveCamera
          key="p"
          makeDefault
          up={[0, 0, 1]}
          position={[cx - span * 0.9, -span * 1.1, span * 0.9]}
          fov={40}
          near={1}
          far={span * 40}
        />
        <OrbitControls key="po" makeDefault target={[cx, 0, 15]} />
      </>
    );
  }
  const zoom = Math.min(size.width, size.height) / (span * 1.5);
  return view === "top" ? (
    <>
      {/* Looking down with +X (the robot's front) pointing up the screen. */}
      <OrthographicCamera
        key="t"
        makeDefault
        up={[1, 0, 0]}
        position={[cx, 0, 1000]}
        zoom={zoom}
        near={1}
        far={5000}
      />
      <OrbitControls key="to" makeDefault target={[cx, 0, 0]} enableRotate={false} />
    </>
  ) : (
    <>
      <OrthographicCamera
        key="s"
        makeDefault
        up={[0, 0, 1]}
        position={[cx, -1000, 30]}
        zoom={zoom}
        near={1}
        far={5000}
      />
      <OrbitControls key="so" makeDefault target={[cx, 0, 30]} enableRotate={false} />
    </>
  );
}

function Label({
  at,
  children,
  testId,
}: {
  at: [number, number, number];
  children: string;
  testId: string;
}) {
  return (
    <Html position={at} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <span
        data-testid={testId}
        className="whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white"
      >
        {children}
      </span>
    </Html>
  );
}

function Overlays({ chassis }: { chassis: Chassis }) {
  const design = useDesign();
  // HTML labels position themselves inside a frame; with on-demand rendering, ask for one (and a
  // follow-up once they have mounted) whenever the design changes.
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
    const raf = requestAnimationFrame(() => {
      invalidate();
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [design, invalidate]);
  const m = useMemo(() => measure(design, chassis, lookup), [design, chassis]);
  const mass = useMemo(() => designMassProps(design, chassis, lookup), [design, chassis]);
  const wheels = design.placements.filter((p) => lookup(p.componentId)?.category === "wheel");
  const left = wheels
    .filter((w) => w.position.y > 0)
    .sort((a, b) => b.position.y - a.position.y)[0];
  const right = wheels
    .filter((w) => w.position.y < 0)
    .sort((a, b) => a.position.y - b.position.y)[0];
  const sensors = design.placements.filter(
    (p) => lookup(p.componentId)?.category === "line_sensor",
  );
  const front = sensors.sort((a, b) => b.position.x - a.position.x)[0];
  const z = 1;
  return (
    <group>
      <mesh position={[mass.cog.x, mass.cog.y, mass.cog.z]}>
        <sphereGeometry args={[3, 16, 12]} />
        <meshBasicMaterial color="#f59e0b" depthTest={false} />
      </mesh>
      <Line
        points={[
          [mass.cog.x, mass.cog.y, mass.cog.z],
          [mass.cog.x, mass.cog.y, 0],
        ]}
        color="#f59e0b"
        lineWidth={1.5}
        dashed
        dashSize={3}
        gapSize={2}
      />
      <Label at={[mass.cog.x, mass.cog.y, mass.cog.z + 10]} testId="label-cog">
        CoG
      </Label>
      {left && right && m.trackWidthMm !== undefined && (
        <>
          <Line
            points={[
              [left.position.x, left.position.y, z],
              [right.position.x, right.position.y, z],
            ]}
            color="#3b82f6"
            lineWidth={1.5}
          />
          <Label
            at={[left.position.x, 0, z + 4]}
            testId="label-track"
          >{`Track ${m.trackWidthMm.toFixed(1)} mm`}</Label>
        </>
      )}
      {front && m.driveAxleX !== undefined && m.lookaheadMm !== undefined && (
        <>
          <Line
            points={[
              [m.driveAxleX, 0, z],
              [front.position.x, 0, z],
            ]}
            color="#a855f7"
            lineWidth={1.5}
          />
          <Label
            at={[(m.driveAxleX + front.position.x) / 2, 0, z + 4]}
            testId="label-lookahead"
          >{`Look-ahead ${m.lookaheadMm.toFixed(1)} mm`}</Label>
        </>
      )}
      {front && m.sensorClearanceMm !== undefined && (
        <>
          <Line
            points={[
              [front.position.x, -12, 0],
              [front.position.x, -12, Math.max(0.01, m.sensorClearanceMm)],
            ]}
            color="#ef4444"
            lineWidth={2}
          />
          <Label
            at={[front.position.x, -20, m.sensorClearanceMm / 2 + 4]}
            testId="label-clearance"
          >{`Sensor ${m.sensorClearanceMm.toFixed(1)} mm up`}</Label>
        </>
      )}
    </group>
  );
}

/** Drags selected parts on a horizontal plane through the grabbed part's base. */
function useDrag() {
  // Read camera/renderer/controls at event time; they are not render-time values.
  const get = useThree((s) => s.get);
  return (e: ThreeEvent<PointerEvent>, p: Placement) => {
    const { camera, gl, controls } = get();
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useEditor.getState();
    if (e.shiftKey) {
      st.select([p.instanceId], "toggle");
      return;
    }
    if (!st.selection.includes(p.instanceId)) st.select([p.instanceId]);
    const ids = useEditor.getState().selection;
    const design = st.history.present;
    const start = new Map(
      design.placements
        .filter((q) => ids.includes(q.instanceId))
        .map((q) => [q.instanceId, { x: q.position.x, y: q.position.y }]),
    );
    const plane = new Plane(new Vector3(0, 0, 1), -p.position.z);
    const ray = new Raycaster();
    const hit = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new Vector2(
          ((ev.clientX - r.left) / r.width) * 2 - 1,
          -((ev.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const v = new Vector3();
      return ray.ray.intersectPlane(plane, v) ? v : undefined;
    };
    const origin = hit(e.nativeEvent);
    if (!origin) return;
    const key = newGestureKey("drag");
    const ctl = controls as { enabled?: boolean } | null;
    if (ctl) ctl.enabled = false;
    const move = (ev: PointerEvent) => {
      const now = hit(ev);
      if (!now) return;
      const dx = now.x - origin.x;
      const dy = now.y - origin.y;
      useEditor.getState().moveTo(
        [...start].map(([id, s]) => ({ id, x: s.x + dx, y: s.y + dy })),
        key,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (ctl) ctl.enabled = true;
      useEditor.getState().endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

function ProjectHook() {
  const { camera, gl } = useThree();
  useEffect(() => {
    window.__linelabProject = (x, y, z) => {
      const v = new Vector3(x, y, z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
  }, [camera, gl]);
  return null;
}

/** Wires: a gentle arc from each net's first pin to every other pin, coloured by net. */
function Wires() {
  const design = useDesign();
  const segments = useMemo(() => {
    const byId = new Map(design.placements.map((p) => [p.instanceId, p]));
    const out: {
      key: string;
      a: [number, number, number];
      b: [number, number, number];
      color: string;
    }[] = [];
    for (const n of design.netlist) {
      const pts = n.connections.flatMap((e) => {
        const p = byId.get(e.instanceId);
        const c = p && lookup(p.componentId);
        return p && c ? [pinAnchor(p, c, e.pinId)] : [];
      });
      const first = pts[0];
      if (!first) continue;
      pts.slice(1).forEach((b, i) => {
        out.push({ key: `${n.id}-${i}`, a: first, b, color: netColor(n) });
      });
    }
    return out;
  }, [design]);
  return (
    <group>
      {segments.map((s) => {
        const mid: [number, number, number] = [
          (s.a[0] + s.b[0]) / 2,
          (s.a[1] + s.b[1]) / 2,
          Math.max(s.a[2], s.b[2]) + 12,
        ];
        return (
          <QuadraticBezierLine
            key={s.key}
            start={s.a}
            end={s.b}
            mid={mid}
            color={s.color}
            lineWidth={1.6}
          />
        );
      })}
    </group>
  );
}

function SceneContent({ chassis }: { chassis: Chassis }) {
  const design = useDesign();
  const selection = useEditor((s) => s.selection);
  const showMeasurements = useEditor((s) => s.showMeasurements);
  const perf = useEditor((s) => s.perfMode);
  const view = useEditor((s) => s.view);
  const colliding = useMemo(
    () => collidingIds(findCollisions(design, chassis, lookup)),
    [design, chassis],
  );
  const startDrag = useDrag();
  // drei <Html> labels mounted during the canvas's very first render pass come out empty, so the
  // overlays mount one animation frame later.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setMounted(true);
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);
  const grid = useMemo(() => {
    const g = new GridHelper(600, 60, 0x8b95a5, 0xc7ccd4);
    g.rotation.x = Math.PI / 2;
    return g;
  }, []);
  return (
    <>
      <Cameras view={view} chassis={chassis} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[120, -160, 260]} intensity={1.7} />
      <directionalLight position={[-160, 120, 80]} intensity={0.5} />
      <primitive object={grid} />
      <ChassisMesh chassis={chassis} />
      {design.placements.map((p) => {
        const c = lookup(p.componentId);
        return c ? (
          <Part
            key={p.instanceId}
            placement={p}
            component={c}
            selected={selection.includes(p.instanceId)}
            colliding={colliding.has(p.instanceId)}
            onDragStart={startDrag}
          />
        ) : null;
      })}
      {showMeasurements && mounted && <Overlays chassis={chassis} />}
      <Wires />
      {perf && <FrameCounter />}
      <ProjectHook />
    </>
  );
}

export default function Scene() {
  const design = useDesign();
  const chassis = chassisOf(design);
  const perf = useEditor((s) => s.perfMode);
  const view = useEditor((s) => s.view);
  const collisions = useMemo(
    () => (chassis ? findCollisions(design, chassis, lookup).length : 0),
    [design, chassis],
  );
  const ref = useRef<HTMLDivElement>(null);
  if (!chassis) return <p className="p-4 text-sm text-red-600">Unknown chassis.</p>;
  return (
    <div
      ref={ref}
      data-testid="scene"
      data-view={view}
      data-parts={design.placements.length}
      data-collisions={collisions}
      className="relative h-full min-h-[320px] w-full overflow-hidden bg-card"
    >
      <Canvas
        frameloop={perf ? "always" : "demand"}
        dpr={[1, 2]}
        onPointerMissed={(e) => {
          if (e.button === 0 && !e.shiftKey) useEditor.getState().select([]);
        }}
        aria-label="3D assembly view. Drag parts to move them; drag empty space to orbit."
      >
        <SceneContent chassis={chassis} />
      </Canvas>
    </div>
  );
}
