# @linelab/design-core

The assembly editor's logic, with no DOM, tested in Node. Frame: mm, origin at the drive-axle midpoint on the ground, +X forward, +Y left, Z up (ADR 0004).

| Module            | What it does                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `mass`            | Plate mass/CoG (cutouts and holes subtracted, every deck) and whole-robot mass/CoG                                    |
| `collision`       | Oriented-box overlap between parts and through deck plates. Motor↔wheel overlap allowed; round parts in cutouts       |
| `measure`         | Track width, wheelbase, sensor look-ahead, sensor height vs its ideal range, caster ground gaps                       |
| `snap`            | Wheel/caster mounts → mounting holes → deck edges → grid                                                              |
| `history`         | Pure commands, undo/redo, drag-gesture coalescing                                                                     |
| `defaults`        | Smart first placement for a new part (wheels on mounts, motors facing them, sensors under the nose, free-spot search) |
| `chassis-builder` | Outline presets (rectangle, T-nose, octagon), rounded corners, hole grids, custom chassis                             |
| `io`              | DXF R12 export/import (polylines, bulges, lines, arcs, circles), SVG import, STL export/import (convex hull)          |
