"use client";

import { getComponent } from "@linelab/component-db";
import { buildComponentModel } from "@linelab/three-models";
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { Box3, GridHelper, Mesh, Vector3, type BufferGeometry } from "three";

type Status = "loading" | "ready" | "error" | "no-webgl";

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

/** Interactive 3D preview of one catalog component (mm, Z up). */
export default function ModelViewer({ componentId }: { componentId: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [webgl] = useState(() => (typeof document === "undefined" ? true : hasWebGL()));

  const built = useMemo(() => {
    const c = getComponent(componentId);
    if (c === undefined) return { error: `Unknown component ${componentId}` } as const;
    try {
      const group = buildComponentModel(c);
      let meshes = 0;
      group.traverse((o) => {
        if (o instanceof Mesh) meshes++;
      });
      const box = new Box3().setFromObject(group);
      const size = box.getSize(new Vector3());
      const radius = Math.max(size.x, size.y, size.z, 10);
      const grid = new GridHelper(
        Math.ceil((radius * 2.5) / 10) * 10,
        Math.ceil((radius * 2.5) / 10),
      );
      grid.rotation.x = Math.PI / 2; // GridHelper lies in XZ; LineLab is Z-up.
      return { group, grid, meshes, radius, height: size.z } as const;
    } catch (err) {
      return { error: (err as Error).message } as const;
    }
  }, [componentId]);

  // Free GPU buffers when the component changes. Materials are shared, so only geometries go.
  useEffect(() => {
    if ("error" in built) return;
    return () => {
      built.group.traverse((o) => {
        // `instanceof Mesh` narrows to Mesh<any>; name the geometry type explicitly.
        if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
      });
      built.grid.geometry.dispose();
    };
  }, [built]);

  const shown: Status = !webgl ? "no-webgl" : "error" in built ? "error" : status;

  return (
    <div
      data-testid="model-viewer"
      data-status={shown}
      data-mesh-count={"error" in built ? 0 : built.meshes}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      {"error" in built ? (
        <p role="alert" className="p-4 text-sm text-red-600">
          Could not build the 3D model: {built.error}
        </p>
      ) : !webgl ? (
        <p className="p-4 text-sm text-muted">
          3D preview needs WebGL, which this browser has turned off.
        </p>
      ) : (
        <>
          <Canvas
            aria-label="3D model of the component. Drag to rotate, scroll to zoom."
            camera={{
              up: [0, 0, 1],
              position: [built.radius * 1.4, -built.radius * 1.6, built.radius * 1.2],
              near: 0.1,
              far: built.radius * 50,
              fov: 40,
            }}
            dpr={[1, 2]}
            onCreated={() => {
              setStatus("ready");
            }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[60, -80, 120]} intensity={1.8} />
            <directionalLight position={[-80, 60, 40]} intensity={0.5} />
            <primitive object={built.group} />
            <primitive object={built.grid} />
            <OrbitControls makeDefault target={[0, 0, built.height / 2]} enablePan={false} />
          </Canvas>
          <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted">
            Grid: 10 mm · drag to rotate
          </p>
        </>
      )}
    </div>
  );
}
