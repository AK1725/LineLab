# 0011. Photo → design: Claude vision behind a detector interface, deterministic layout, confirmed wiring

- Status: accepted
- Date: 2026-11-24

## Context

BLUEPRINT §5.10 asks for:

- guided multi-photo upload;
- part detection: a YOLO model once a labelled dataset exists, bootstrapped with Claude vision until then;
- database matching with top-3 choices;
- a scale and placement estimate;
- a chassis outline;
- a pre-filled netlist the user confirms net by net.

Build-plan acceptance: on 5 fixture photo sets, at least 80 % of major components are in the top 3, and the user can reach a valid design with only confirmations and drags.

## Decisions

1. **Detection runs in `apps/api` (TypeScript), not in `apps/vision`.** It calls the official `@anthropic-ai/sdk`, as the rest of LineLab's LLM code does (CLAUDE.md), and reuses the API's key handling:
   - the server key, or the user's own key per request, never stored;
   - per-IP limits;
   - a scripted replay for tests and demos.

   `PhotoDetector` is the seam where a trained YOLO detector will plug in. Its result type already has `detector: "yolo"`.

2. **The model returns structured JSON** (`output_config.format` with a JSON schema) with adaptive thinking. Model and effort come from env (`LINELAB_VISION_MODEL`, default `claude-opus-5-5`; `LINELAB_VISION_EFFORT`, default `medium`). The answer is validated again with Zod and clamped. Refusals, truncation and invalid JSON become errors, never detections. Photos are untrusted: the prompt says to ignore instructions written in them.
3. **The model describes, the database decides.** The model reports category, description, _readable_ markings, count and a top-view box. It never names a database id. Matching (`matchDetections`) is deterministic search over LineLab's own index, so improving the index improves every detector:
   - markings count most;
   - then part-number-like words;
   - then word pairs;
   - if nothing matches, the category's parts are offered.
4. **Geometry is deterministic and explained** (`proposeDesign`):
   - **Scale**: the median over parts of known size of long-side and short-side ratios.
   - **Origin**: the axle midpoint, taken from the wheels.
   - **Chassis**: the silhouette from `apps/vision` (OpenCV), clipped inside the wheels. Without a silhouette or scale, the nearest template is used.
   - **Mounted parts** (wheels, motors, caster, line sensor) go on their mounts by LineLab's rules.
   - **Other parts** go where the top photo shows them, unless that collides or overhangs.

   Each step leaves a note for the user.

5. **Wiring is proposed, never inferred.** LineLab auto-wires the confirmed parts (the existing `autoWire`). The wizard lists each net with Confirm or Skip and shows live rule-check errors. Nothing is wired until the user confirms it.
6. **Fixtures are LineLab renders, labelled as such.** There is no labelled set of real robot photos. The five fixture robots use real database parts and pass the rules engine. Their "photos" are top-view drawings (the plate in its material colour, labelled "LineLab render (not a photo)") with exact geometry. They test matching, layout, the vision outline and the wizard. They cannot measure detection on real photos, and the eval reports the two kinds separately.

## Consequences

- **The detection half of the acceptance metric has not been measured.** It needs real photo sets and an API key. `pnpm eval:photos` measures it once both exist, and fails below 80 %.
- What is measured, using the scripted descriptions written from each part's real appearance, is the matching half: 39 of 39 major components are in the top 3. Valid designs are reached from both a perfect overhead view and the vision service's actual silhouette.
- Silhouette extraction assumes a plain, contrasting background. A pale plate on a pale table needs the parts on it to stand out.
- The top view must be taken with the robot's front up (the guided capture says so), or the model must report `frontInTop` correctly.
