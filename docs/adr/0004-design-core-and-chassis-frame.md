# 0004. `design-core` package, chassis frame, spacers and the frame-rate budget

- Status: accepted
- Date: 2026-11-23

## Context

Phase 2 needs a lot of editor logic: mass and centre of gravity, collisions, snapping, measurements, undo/redo, and chassis import/export. The blueprint's layout (§3.1) has no package for it. The blueprint also leaves open where the chassis origin is, how parts on spacers are modelled, and how to verify "60 fps with 60 parts" in a container without a GPU.

## Decisions

1. **New package `packages/design-core`.** Pure TypeScript with no DOM, unit-tested in Node. The web editor is a thin UI over it, so the same code can later run in the API, the simulator and the AI agent.
2. **Chassis frame.** Millimetres. The origin is the **drive-axle midpoint on the ground**, +X forward, +Y left, Z up. Then look-ahead is simply the sensor's X, and wheel mounts sit on X = 0.
3. **A placement's position is the bottom-centre of its part.** Wheels stand on the ground (z = 0). Other parts sit on a deck face (`mount: top | bottom`), optionally on spacers (`standoffMm`, a new optional Placement field defaulting to 0). Without spacers, an under-plate line sensor on a typical N20 racer sits about 18 mm above the track, far outside its 3–6 mm range.
4. **Collisions** use oriented boxes (separating-axis test) plus deck-plate checks. Two deliberate exceptions: motor↔wheel overlaps are allowed (the shaft goes into the hub), and round parts (fans, standoffs) use their inscribed circle when tested against cutouts.
5. **Undo/redo stores whole designs**, not inverse operations. Designs are small, every command is a pure `apply(design, cmd)`, and a drag gesture coalesces into one step. This makes undo correct by construction, and three seeded 150-step random runs test it.
6. **Frame-rate acceptance.** The dev container and GitHub runners render with SwiftShader (CPU rasterisation). There, fps scales with pixel count (8 fps at 1440×900, 20 fps at 1100×500 for the same scene), so raw fps measures the CPU, not LineLab. The e2e test instead enforces the budgets that decide frame rate on a real GPU: **≤ 300 draw calls, ≤ 100k triangles, < 8 ms CPU time per frame** with 60 parts. Measured: 193 calls, about 18k triangles, 0.6–1.6 ms. Meshes are merged per material (`mergeByMaterial`) to keep draw calls low.

## Consequences

- `CLAUDE.md`'s stack is unchanged. `design-core` joins the package list in the README.
- A real-GPU 60 fps run is still to be done on a physical machine (tracked in PROGRESS.md).
