"use client";

import { buildChassisModel } from "@linelab/three-models";
import type { Chassis, Design } from "@linelab/schema";
import { yawOf } from "@linelab/design-core";
import { Line, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
  type OrthographicCamera as OrthoCam,
  type PerspectiveCamera as PerspCam,
} from "three";
import { templateFor } from "../editor/scene";
import { chassisOf, lookup } from "../editor/store";
import { poseAt, useRun, type CompletedRun } from "./run-store";
import { paintTrack } from "./track-texture";

function Floor({ run }: { run: CompletedRun }) {
  const { texture, cx, cy, w, h } = useMemo(() => {
    const p = paintTrack(run.track);
    const t = new CanvasTexture(p.canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return { texture: t, cx: p.minX + p.wMm / 2, cy: p.minY + p.hMm / 2, w: p.wMm, h: p.hMm };
  }, [run.track]);
  useEffect(
    () => () => {
      texture.dispose();
    },
    [texture],
  );
  return (
    <mesh position={[cx, cy, 0]}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={texture} roughness={0.95} />
    </mesh>
  );
}

/** The robot as designed: chassis plus every part, in the chassis frame. */
function RobotBody({
  design,
  chassis,
  ghost,
}: {
  design: Design;
  chassis: Chassis;
  ghost: boolean;
}) {
  const group = useMemo(() => {
    const g = new Group();
    g.add(buildChassisModel(chassis, { opacity: ghost ? 0.25 : 0.9 }));
    for (const p of design.placements) {
      const c = lookup(p.componentId);
      if (!c) continue;
      const o = templateFor(c).clone();
      o.position.set(p.position.x, p.position.y, p.position.z);
      o.rotation.z = yawOf(p.rotation);
      g.add(o);
    }
    if (ghost) {
      const mat = new MeshStandardMaterial({
        color: "#64748b",
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
      g.traverse((o) => {
        if (o instanceof Mesh) o.material = mat;
      });
    }
    return g;
  }, [design, chassis, ghost]);
  useEffect(
    () => () => {
      group.traverse((o) => {
        if (o instanceof Mesh && ghost) (o.material as Material).dispose();
      });
      group.children[0]?.traverse((o) => {
        if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
      });
    },
    [group, ghost],
  );
  return <primitive object={group} />;
}

function Robot({ run, ghost = false }: { run: CompletedRun; ghost?: boolean }) {
  const chassis = chassisOf(run.design);
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const p = poseAt(run, useRun.getState().tMs);
    g.position.set(p.x, p.y, 0);
    g.rotation.z = p.heading;
  });
  return (
    <group ref={ref} name={ghost ? "ghost-robot" : "robot"}>
      {chassis && <RobotBody design={run.design} chassis={chassis} ghost={ghost} />}
    </group>
  );
}

function Path({ run, color, opacity }: { run: CompletedRun; color: string; opacity: number }) {
  const points = useMemo(() => {
    const { data, stride, count } = run.trace;
    const pts: [number, number, number][] = [];
    const step = Math.max(1, Math.floor(count / 2000));
    for (let i = 0; i < count; i += step)
      pts.push([data[i * stride + 1] ?? 0, data[i * stride + 2] ?? 0, 0.5]);
    return pts.length > 1
      ? pts
      : ([
          [0, 0, 0.5],
          [0, 0, 0.5],
        ] as [number, number, number][]);
  }, [run]);
  return <Line points={points} color={color} lineWidth={2} transparent opacity={opacity} />;
}

function Cameras({ run }: { run: CompletedRun }) {
  const mode = useRun((s) => s.camera);
  const size = useThree((s) => s.size);
  const ortho = useRef<OrthoCam>(null);
  const persp = useRef<PerspCam>(null);
  const fit = useMemo(() => {
    const p = paintTrack(run.track, 120, 64); // cheap: only for the bounds
    return { cx: p.minX + p.wMm / 2, cy: p.minY + p.hMm / 2, w: p.wMm, h: p.hMm };
  }, [run.track]);
  const zoom = Math.min(size.width / fit.w, size.height / fit.h);
  useFrame(() => {
    if (mode !== "follow" || !persp.current) return;
    const p = poseAt(run, useRun.getState().tMs);
    const back = 380;
    persp.current.position.set(
      p.x - back * Math.cos(p.heading),
      p.y - back * Math.sin(p.heading),
      260,
    );
    persp.current.up.set(0, 0, 1);
    persp.current.lookAt(p.x + 120 * Math.cos(p.heading), p.y + 120 * Math.sin(p.heading), 0);
  });
  return mode === "top" ? (
    <OrthographicCamera
      ref={ortho}
      makeDefault
      position={[fit.cx, fit.cy, 2000]}
      zoom={zoom}
      near={1}
      far={5000}
      up={[0, 1, 0]}
    />
  ) : (
    <PerspectiveCamera ref={persp} makeDefault fov={50} near={5} far={20000} />
  );
}

export default function RunScene() {
  const run = useRun((s) => s.current);
  const ghost = useRun((s) => (s.showGhost ? s.ghost : null));
  if (!run) return null;
  return (
    <Canvas dpr={[1, 2]} frameloop="always" aria-label="Simulation replay" data-testid="run-canvas">
      <Cameras run={run} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[300, -400, 900]} intensity={1.6} />
      <Floor run={run} />
      {ghost && (
        <>
          <Path run={ghost} color="#64748b" opacity={0.6} />
          <Robot run={ghost} ghost />
        </>
      )}
      <Path run={run} color="#0f9d74" opacity={0.9} />
      <Robot run={run} />
    </Canvas>
  );
}
