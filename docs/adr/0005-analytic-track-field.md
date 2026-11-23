# 0005. Analytic track field, step editor, and synthetic photos for the image pipeline

- Status: accepted
- Date: 2026-11-23

## Context

BLUEPRINT §5.5 says the simulator samples a **rasterised reflectance map** (1 px = 0.5 mm), the track editor edits **spline** segments, and BUILD_PLAN Phase 4 asks for **10 test photos** in `apps/vision/tests/fixtures`.

## Decisions

1. **Analytic `TrackField` instead of a raster.** `packages/sim-core` samples the centreline every ~2 mm into a spatial hash grid. `reflectanceAt(x, y)` finds the distance to the nearest segment and maps it to line/background reflectance, including gaps and inverted bands. Reasons:
   - A 0.5 mm raster of a 4 × 3 m maze is 48 M cells (~48 MB per track as bytes) and has to be rebuilt on every edit. The grid is a few hundred kB and builds in milliseconds.
   - Distance to the centreline is exact, so a sensor footprint integral (Phase 5) has no aliasing at line edges.
   - The same structure answers `closest()` and progress queries, so the sim, the detectors and the UI agree on where the line is.

   A raster can still be produced from the field if the sim ever needs one. The interface (`reflectanceAt`) doesn't change.

2. **The editor is a "turtle" of lines and arcs.** You step forward, turn along arcs and mark gaps or inversions, so the path is G1-continuous by construction, every arc has an explicit radius that can be validated against the line width, and steps are stored with the track so it stays editable. Bézier segments are in the schema and are rendered, simulated and validated, but they have no editing UI yet.
3. **Photos are generated, not checked in.** `apps/vision/tests/trackgen.py` renders each built-in track to a sheet, tilts it with a random perspective, adds an uneven lighting gradient, noise, blur and JPEG compression, and keeps the ground-truth centreline. Ten tracks are reconstructed in the tests and must come within 5 mm of mean path error. This gives exact ground truth (a real photo has no known centreline) and adds no binary blobs to the repo. **Limitation:** the pipeline has not been measured on real phone photos yet. Glare, creases and tape seams will be harder. This is listed in PROGRESS.md.
4. **Calibration** is either four marked corners of a known rectangle (it removes perspective and sets the scale) or a known mm-per-pixel for flat scans. The "this line is 19 mm wide" calibration from the blueprint isn't built yet. Line width is measured from the image instead.

## Consequences

- Sensor sampling in Phase 5 integrates `reflectanceAt` over the footprint. Its cost per call is fixed by the grid cell size, not by the track size.
- Users can't drag control points of imported tracks. They can rename them, change the line width, or redraw them with steps.
