// Regenerates the built-in tracks in /tracks. Run: pnpm --filter @linelab/sim-core tracks:generate
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pose, Track } from "@linelab/schema";
import { TrackBuilder } from "../src/track/builder.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tracks");
const deg = (d: number) => (d * Math.PI) / 180;
const tracks: Track[] = [];

/** Start pose `s` mm along the first (straight) segment. */
const startOn = (b: TrackBuilder, s: number): Pose => {
  const seg = b.segments[0];
  if (seg?.type !== "line") throw new Error("first segment must be a line");
  const len = Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
  const f = s / len;
  return {
    x: seg.from.x + (seg.to.x - seg.from.x) * f,
    y: seg.from.y + (seg.to.y - seg.from.y) * f,
    headingRad: Math.atan2(seg.to.y - seg.from.y, seg.to.x - seg.from.x),
  };
};
const add = (t: Track, finish = false, b?: TrackBuilder) => {
  if (finish && b) t.finish = b.pose;
  tracks.push(t);
};

{
  const b = new TrackBuilder().forward(1200).left(180, 300).forward(1200).left(180, 300);
  add(
    b.build(
      {
        id: "track.oval",
        name: "Oval",
        difficulty: "easy",
        description: "Two straights and two gentle half-circles: the first track to try.",
      },
      startOn(b, 100),
    ),
  );
}
{
  const b = new TrackBuilder({ x: 0, y: -500, headingRad: 0 }).left(360, 500);
  add(
    b.build(
      {
        id: "track.circle",
        name: "Circle",
        difficulty: "easy",
        description: "A constant 500 mm radius: good for tuning steady-state cornering.",
      },
      { x: 0, y: -500, headingRad: 0 },
    ),
  );
}
{
  const b = new TrackBuilder({ x: 0, y: 0, headingRad: deg(45) });
  b.forward(300)
    .left(270, 300)
    .forward(300)
    .crossingHere()
    .forward(300)
    .right(270, 300)
    .forward(300);
  add(
    b.build(
      {
        id: "track.figure-eight",
        name: "Figure eight",
        difficulty: "medium",
        description: "Two loops joined by a crossing: the robot must drive straight over it.",
      },
      startOn(b, 150),
    ),
  );
}
{
  const b = new TrackBuilder().forward(300);
  for (let i = 0; i < 4; i++) b.turn(i % 2 === 0 ? 120 : -120, 200);
  b.forward(300);
  add(
    b.build(
      {
        id: "track.s-curves",
        name: "S-curves",
        difficulty: "medium",
        description: "Alternating 120° curves (200 mm radius) that punish slow D-terms.",
      },
      startOn(b, 50),
    ),
    true,
    b,
  );
}
{
  const b = new TrackBuilder();
  for (let i = 0; i < 2; i++) b.forward(1000).left(90, 20).forward(600).left(90, 20);
  add(
    b.build(
      {
        id: "track.right-angles",
        name: "Right angles",
        difficulty: "hard",
        description: "A rectangle with sharp 90° corners: needs turn detection, not just PID.",
      },
      startOn(b, 100),
    ),
  );
}
{
  const b = new TrackBuilder()
    .forward(400)
    .right(135, 20)
    .forward(400)
    .left(135, 20)
    .forward(400)
    .right(135, 20)
    .forward(400);
  add(
    b.build(
      {
        id: "track.acute-angles",
        name: "Acute angles",
        difficulty: "expert",
        description: "Three 135° hairpin corners: the line doubles back at 45°.",
      },
      startOn(b, 50),
    ),
    true,
    b,
  );
}
{
  const b = new TrackBuilder()
    .forward(400)
    .gapNext(40)
    .forward(400)
    .gapNext(40)
    .forward(400)
    .left(180, 300)
    .forward(200)
    .gapNext(40)
    .forward(600)
    .gapNext(40)
    .forward(400)
    .left(180, 300);
  add(
    b.build(
      {
        id: "track.dashed",
        name: "Dashed line",
        difficulty: "hard",
        description: "40 mm gaps in the line: the robot has to hold its heading across them.",
      },
      startOn(b, 100),
    ),
  );
}
{
  const b = new TrackBuilder()
    .forward(300)
    .invertNext(500)
    .forward(900)
    .left(180, 300)
    .forward(1200)
    .left(180, 300);
  add(
    b.build(
      {
        id: "track.inverted",
        name: "Inverted section",
        difficulty: "hard",
        description: "500 mm of white line on black: the robot must detect the swap.",
      },
      startOn(b, 100),
    ),
  );
}
{
  const b = new TrackBuilder().forward(1000).left(180, 250).forward(1000).left(180, 250);
  add(
    b.build(
      {
        id: "track.thin-line",
        name: "Thin line oval",
        difficulty: "medium",
        lineWidthMm: 12,
        description: "A 12 mm line: sensor spacing matters.",
      },
      startOn(b, 100),
    ),
  );
}
{
  const b = new TrackBuilder().forward(1500).left(180, 500).forward(1500).left(180, 500);
  add(
    b.build(
      {
        id: "track.wide-gentle",
        name: "Wide and gentle",
        difficulty: "easy",
        lineWidthMm: 25,
        description: "A wide 25 mm line with 500 mm curves: beginner friendly.",
      },
      startOn(b, 100),
    ),
  );
}
{
  const b = new TrackBuilder().forward(3000);
  add(
    b.build(
      {
        id: "track.long-straight",
        name: "Long straight",
        difficulty: "easy",
        description: "Three metres straight: top speed and straight-line stability.",
      },
      startOn(b, 50),
    ),
    true,
    b,
  );
}
{
  const b = new TrackBuilder()
    .forward(400)
    .left(180, 60)
    .forward(400)
    .right(180, 60)
    .forward(400)
    .left(180, 60)
    .forward(400);
  add(
    b.build(
      {
        id: "track.hairpins",
        name: "Hairpins",
        difficulty: "hard",
        description: "Three 60 mm-radius U-turns.",
      },
      startOn(b, 50),
    ),
    true,
    b,
  );
}
{
  const b = new TrackBuilder().forward(600).left(45, 200).right(90, 200).left(45, 200).forward(600);
  add(
    b.build(
      {
        id: "track.chicane",
        name: "Chicane",
        difficulty: "medium",
        description: "A quick left-right-left kink between two straights.",
      },
      startOn(b, 50),
    ),
    true,
    b,
  );
}
{
  const b = new TrackBuilder().forward(200);
  for (let i = 0; i < 6; i++) b.turn(i % 2 === 0 ? 60 : -60, 100);
  b.forward(200);
  add(
    b.build(
      {
        id: "track.zigzag",
        name: "Zigzag",
        difficulty: "medium",
        description: "Six alternating 60° curves at 100 mm radius.",
      },
      startOn(b, 50),
    ),
    true,
    b,
  );
}
{
  const b = new TrackBuilder()
    .forward(200)
    .left(360, 500)
    .left(360, 380)
    .left(360, 260)
    .left(270, 150)
    .forward(200);
  add(
    b.build(
      {
        id: "track.spiral",
        name: "Spiral",
        difficulty: "hard",
        description: "Ever-tighter loops (500 → 150 mm radius): finds the cornering limit.",
      },
      startOn(b, 50),
    ),
    true,
    b,
  );
}
{
  const b = new TrackBuilder()
    .forward(800)
    .right(90, 150)
    .forward(300)
    .right(60, 30)
    .forward(250)
    .left(150, 90)
    .forward(350)
    .gapNext(30)
    .forward(300)
    .right(90, 200)
    .forward(400);
  add(
    b.build(
      {
        id: "track.sprint",
        name: "Competition-style sprint",
        difficulty: "expert",
        description:
          "A mixed course: long straight, sharp corner, hairpin, a gap and a fast sweeper.",
      },
      startOn(b, 50),
    ),
    true,
    b,
  );
}
{
  // Seeded random course (mulberry32) so it is reproducible.
  let a = 20251123;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const b = new TrackBuilder().forward(200);
  for (let i = 0; i < 10; i++) {
    if (rnd() < 0.3) b.forward(150 + rnd() * 250);
    else b.turn((rnd() < 0.5 ? -1 : 1) * (30 + rnd() * 90), 120 + rnd() * 280);
  }
  b.forward(200);
  add(
    b.build(
      {
        id: "track.random-curvy",
        name: "Random curvy",
        difficulty: "medium",
        description: "A reproducible random mix of straights and curves (seeded).",
      },
      startOn(b, 50),
    ),
    true,
    b,
  );
}
{
  // 3 × 3 cell maze grid, 300 mm cells: separate straight lines that meet at junctions.
  const cell = 300;
  const segments: Track["segments"] = [];
  const features: Track["features"] = [];
  for (let i = 0; i <= 3; i++) {
    segments.push({ type: "line", from: { x: 0, y: i * cell }, to: { x: 3 * cell, y: i * cell } });
    segments.push({ type: "line", from: { x: i * cell, y: 0 }, to: { x: i * cell, y: 3 * cell } });
  }
  for (let i = 0; i <= 3; i++) {
    for (let j = 0; j <= 3; j++) {
      const edgeX = i === 0 || i === 3;
      const edgeY = j === 0 || j === 3;
      if (edgeX && edgeY) continue; // corners are plain turns
      features.push({
        type: "junction",
        position: { x: i * cell, y: j * cell },
        branches: edgeX || edgeY ? 3 : 4,
      });
    }
  }
  tracks.push({
    id: "track.maze-grid",
    name: "Maze grid",
    difficulty: "expert",
    description:
      "A 3 × 3 grid of 300 mm cells with T- and cross-junctions, for maze-solving robots.",
    units: "mm",
    surface: {
      lineColor: "#111111",
      backgroundColor: "#f5f5f0",
      lineReflectance: 0.05,
      backgroundReflectance: 0.85,
    },
    lineWidthMm: 19,
    segments,
    features,
    start: { x: 50, y: 0, headingRad: 0 },
  });
}

mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith(".json")) rmSync(join(out, f));
for (const t of tracks) {
  writeFileSync(
    join(out, `${t.id}.json`),
    `${JSON.stringify({ $schema: "../packages/schema/json-schema/track.schema.json", ...t }, null, 2)}\n`,
  );
}
console.log(`wrote ${tracks.length} tracks`);
