import {
  convexHull,
  deckOf,
  deckOutline,
  designMassProps,
  distanceToEdges,
  findCollisions,
  footprint,
  footprintCorners,
  measure,
  placementZ,
  pointInPolygon,
} from "@linelab/design-core";
import type { Finding, FindingRef, Placement } from "@linelab/schema";
import type { Circuit, PartRef } from "../circuit.js";
import type { Rule } from "../rule.js";

const r = (id: string, severity: Rule["severity"], title: string, check: Rule["check"]): Rule => ({
  id,
  severity,
  category: "mechanical",
  title,
  check,
});
const mm = (x: number) => `${Number(x.toFixed(1))} mm`;
const partRef = (id: string): FindingRef => ({ kind: "placement", ref: id });
const placed = (c: Circuit) =>
  c.design.placements.flatMap((p) => {
    const part = c.partById.get(p.instanceId);
    return part ? [{ p, part }] : [];
  });
const byCat = (c: Circuit, cat: string) => placed(c).filter((x) => x.part.c.category === cat);

/** A spacer change that moves a bottom-mounted part's underside to height `targetZ`. */
function spacerFix(c: Circuit, p: Placement, part: PartRef, targetZ: number) {
  if (p.mount !== "bottom") return undefined;
  const standoffMm = Math.round((p.standoffMm + (p.position.z - targetZ)) * 10) / 10;
  if (standoffMm < 0) return undefined;
  const z = placementZ(c.chassis, part.c, p.deck, "bottom", standoffMm);
  return {
    label: `Set spacer to ${mm(standoffMm)}`,
    operations: [
      {
        type: "update" as const,
        changes: [{ id: p.instanceId, patch: { standoffMm, position: { ...p.position, z } } }],
      },
    ],
  };
}

function f(
  rule: Pick<Rule, "id" | "severity">,
  message: string,
  explanation: string,
  affected: FindingRef[],
  fix?: Finding["fix"],
): Finding {
  const out: Finding = { id: rule.id, severity: rule.severity, message, explanation, affected };
  if (fix) out.fix = fix;
  return out;
}

/** Ground-contact points: wheel centres and casters. */
function supports(c: Circuit) {
  return [...byCat(c, "wheel"), ...byCat(c, "caster")].map((x) => ({
    x: x.p.position.x,
    y: x.p.position.y,
  }));
}

export const MECHANICAL_RULES: Rule[] = [
  r("mech.collision", "error", "Parts overlap", (c) =>
    findCollisions(c.design, c.chassis, c.lookup).map((col) =>
      f(
        { id: "mech.collision", severity: "error" },
        col.b.startsWith("chassis:")
          ? `${col.a} passes through deck ${col.b.slice(8)}.`
          : `${col.a} overlaps ${col.b}.`,
        "Two solid parts can't occupy the same space. Move one, rotate it, or mount it on the other side of the deck.",
        col.b.startsWith("chassis:") ? [partRef(col.a)] : [partRef(col.a), partRef(col.b)],
      ),
    ),
  ),

  r("mech.wheels-missing", "error", "No drive wheel on one side", (c) => {
    const wheels = byCat(c, "wheel");
    if (c.design.placements.length === 0) return [];
    const left = wheels.some((w) => w.p.position.y > 0);
    const right = wheels.some((w) => w.p.position.y < 0);
    return left && right
      ? []
      : [
          f(
            { id: "mech.wheels-missing", severity: "error" },
            `Missing a ${left ? "right" : right ? "left" : "left and right"} drive wheel.`,
            "A differential-drive robot steers by turning a left and a right wheel at different speeds.",
            [{ kind: "design", ref: c.design.id }],
          ),
        ];
  }),

  r("mech.motors-missing", "warning", "Fewer motors than drive wheels", (c) => {
    const wheels = byCat(c, "wheel").length;
    const motors = byCat(c, "motor").filter(
      (x) => x.part.c.model.kind === "procedural" && x.part.c.model.generator !== "edf_fan",
    ).length;
    return wheels >= 2 && motors < 2
      ? [
          f(
            { id: "mech.motors-missing", severity: "warning" },
            `${wheels} wheels but only ${motors} motor${motors === 1 ? "" : "s"}.`,
            "Each side needs its own motor for differential steering.",
            [{ kind: "design", ref: c.design.id }],
          ),
        ]
      : [];
  }),

  r("mech.no-third-support", "warning", "Only two contact points", (c) => {
    const wheels = byCat(c, "wheel");
    return wheels.length === 2 && byCat(c, "caster").length === 0
      ? [
          f(
            { id: "mech.no-third-support", severity: "warning" },
            "Two wheels and no caster or skid.",
            "With only two contact points the robot rocks onto its nose or tail, scraping the sensor bar. Add a ball caster or skid on the side the centre of gravity leans to.",
            [{ kind: "design", ref: c.design.id }],
          ),
        ]
      : [];
  }),

  r("mech.cog-outside-support", "error", "Centre of gravity outside the support area", (c) => {
    const pts = supports(c);
    if (pts.length < 3) return [];
    const hull = convexHull(pts);
    const cog = designMassProps(c.design, c.chassis, c.lookup).cog;
    return pointInPolygon(cog, hull)
      ? []
      : [
          f(
            { id: "mech.cog-outside-support", severity: "error" },
            `The centre of gravity (${mm(cog.x)}, ${mm(cog.y)}) lies outside the wheels and casters.`,
            "The robot will tip over at rest. Move heavy parts (battery) toward the middle of the support area or move the caster.",
            [{ kind: "design", ref: c.design.id }],
          ),
        ];
  }),

  r("mech.cog-near-edge", "warning", "Centre of gravity close to tipping", (c) => {
    const pts = supports(c);
    if (pts.length < 3) return [];
    const hull = convexHull(pts);
    const cog = designMassProps(c.design, c.chassis, c.lookup).cog;
    if (!pointInPolygon(cog, hull)) return [];
    const d = distanceToEdges(cog, hull);
    const xs = hull.map((p) => p.x);
    const size = Math.max(...xs) - Math.min(...xs);
    return d < size * 0.08
      ? [
          f(
            { id: "mech.cog-near-edge", severity: "warning" },
            `The centre of gravity is only ${mm(d)} inside the support area.`,
            "Hard braking or turning will lift a wheel. Shift the battery toward the middle.",
            [{ kind: "design", ref: c.design.id }],
          ),
        ]
      : [];
  }),

  r("mech.sensor-height", "warning", "Line sensor at the wrong height", (c) =>
    byCat(c, "line_sensor").flatMap(({ p, part }) => {
      const e = part.c.electrical;
      if (e.kind !== "line_sensor" || p.position.z < 0.2) return [];
      const { min, max } = e.optimalHeightMm;
      if (p.position.z >= min && p.position.z <= max) return [];
      const target = Math.min((min + max) / 2, min + 3);
      return [
        f(
          { id: "mech.sensor-height", severity: "warning" },
          `${p.instanceId} reads the track from ${mm(p.position.z)}; ${part.c.name} works best at ${min}–${max} mm.`,
          p.position.z > max
            ? "Too high: the IR spot spreads, contrast between line and floor drops, and ambient light gets in."
            : "Too low: the sensor can't see enough reflected light and may catch on track seams.",
          [partRef(p.instanceId)],
          spacerFix(c, p, part, target),
        ),
      ];
    }),
  ),

  r("mech.sensor-touching", "error", "Line sensor touches the ground", (c) =>
    byCat(c, "line_sensor")
      .filter(({ p }) => p.position.z < 0.2)
      .map(({ p, part }) => {
        const e = part.c.electrical;
        const target =
          e.kind === "line_sensor"
            ? Math.min(
                (e.optimalHeightMm.min + e.optimalHeightMm.max) / 2,
                e.optimalHeightMm.min + 3,
              )
            : 3;
        return f(
          { id: "mech.sensor-touching", severity: "error" },
          `${p.instanceId} sits at ${mm(p.position.z)}: on or below the track.`,
          "The sensor will drag on the track and can't read it. Raise it with a thinner spacer.",
          [partRef(p.instanceId)],
          spacerFix(c, p, part, target),
        );
      }),
  ),

  r("mech.lookahead-short", "warning", "Sensors too close to the axle", (c) => {
    const m = measure(c.design, c.chassis, c.lookup);
    return m.lookaheadMm !== undefined && m.lookaheadMm < 25
      ? [
          f(
            { id: "mech.lookahead-short", severity: "warning" },
            `The line sensor is only ${mm(m.lookaheadMm)} ahead of the drive axle.`,
            "Close to the axle the sensor barely moves when the robot turns, so the controller gets little warning before a curve. 40–150 mm is typical.",
            [{ kind: "design", ref: c.design.id }],
          ),
        ]
      : [];
  }),

  r("mech.lookahead-long", "tip", "Sensors very far ahead of the axle", (c) => {
    const m = measure(c.design, c.chassis, c.lookup);
    return m.lookaheadMm !== undefined && m.lookaheadMm > 200
      ? [
          f(
            { id: "mech.lookahead-long", severity: "tip" },
            `The line sensor is ${mm(m.lookaheadMm)} ahead of the axle.`,
            "A long nose sees curves early but swings wide in tight turns and adds inertia. Check the track's minimum radius.",
            [{ kind: "design", ref: c.design.id }],
          ),
        ]
      : [];
  }),

  r("mech.single-sensor", "error", "Not enough sensor channels to steer", (c) => {
    const sensors = byCat(c, "line_sensor");
    const channels = sensors.reduce(
      (s, x) => s + (x.part.c.electrical.kind === "line_sensor" ? x.part.c.electrical.channels : 0),
      0,
    );
    return sensors.length > 0 && channels < 2
      ? [
          f(
            { id: "mech.single-sensor", severity: "error" },
            "Only one line-sensor channel.",
            "With one channel the robot only knows on/off the line, not which side it drifted to. Use at least 2 (ideally 5–8) channels across the line.",
            [{ kind: "design", ref: c.design.id }],
          ),
        ]
      : [];
  }),

  r("mech.sensor-span-narrow", "warning", "Sensor array narrower than needed", (c) =>
    byCat(c, "line_sensor").flatMap(({ p, part }) => {
      const e = part.c.electrical;
      if (e.kind !== "line_sensor" || e.channels < 2) return [];
      const span = (e.channels - 1) * e.channelPitchMm;
      return span < 30
        ? [
            f(
              { id: "mech.sensor-span-narrow", severity: "warning" },
              `${p.instanceId} spans only ${mm(span)}.`,
              "A narrow array loses the line as soon as the robot drifts a little on a curve. Aim for at least 30–40 mm across.",
              [partRef(p.instanceId)],
            ),
          ]
        : [];
    }),
  ),

  r("mech.caster-gap", "warning", "Caster doesn't meet the ground", (c) =>
    byCat(c, "caster").flatMap(({ p, part }) => {
      if (Math.abs(p.position.z) <= 1) return [];
      return [
        f(
          { id: "mech.caster-gap", severity: "warning" },
          p.position.z > 0
            ? `${p.instanceId} hangs ${mm(p.position.z)} above the ground.`
            : `${p.instanceId} is ${mm(-p.position.z)} too tall: it lifts the drive wheels.`,
          p.position.z > 0
            ? "The robot tilts until something else (often the sensor bar) touches down."
            : "Wheels lose traction and the robot can't drive straight.",
          [partRef(p.instanceId)],
          spacerFix(c, p, part, 0),
        ),
      ];
    }),
  ),

  r("mech.overhang", "tip", "Part overhangs the deck", (c) =>
    placed(c)
      .filter(({ part }) => !["wheel", "caster", "motor"].includes(part.c.category))
      .flatMap(({ p, part }) => {
        const deck = deckOf(c.chassis, p.deck) ?? c.chassis.decks[0];
        if (!deck) return [];
        const outline = deckOutline(c.chassis, deck);
        const out = footprintCorners(footprint(p, part.c)).filter(
          (q) => !pointInPolygon(q, outline),
        );
        return out.length > 0
          ? [
              f(
                { id: "mech.overhang", severity: "tip" },
                `${p.instanceId} sticks out past the edge of deck ${deck.index}.`,
                "Overhanging parts snag on track edges and are easily knocked off. Fine for sensor bars that are meant to stick out.",
                [partRef(p.instanceId)],
              ),
            ]
          : [];
      }),
  ),

  r("mech.weak-motors", "warning", "Motors weak for the robot's weight", (c) => {
    const motors = byCat(c, "motor").filter(
      (x) => x.part.c.electrical.kind === "motor" && x.part.c.electrical.gearRatio > 1,
    );
    const wheel = byCat(c, "wheel")[0];
    if (motors.length < 2 || !wheel || wheel.part.c.electrical.kind !== "wheel") return [];
    const rM = wheel.part.c.electrical.diameterMm / 2000;
    const force =
      motors.reduce(
        (s, x) =>
          s +
          (x.part.c.electrical.kind === "motor"
            ? (x.part.c.electrical.stallTorqueKgCm * 0.0980665) / rM
            : 0),
        0,
      ) * 0.3;
    const massKg = designMassProps(c.design, c.chassis, c.lookup).massG / 1000;
    const a = force / Math.max(massKg, 0.001);
    return a < 2
      ? [
          f(
            { id: "mech.weak-motors", severity: "warning" },
            `At a usable ~30% of stall torque the motors accelerate this ${Math.round(massKg * 1000)} g robot at only ${a.toFixed(1)} m/s².`,
            "Sluggish acceleration makes the robot run wide on curves. Use lower gear ratios with more torque, smaller wheels, or a lighter build.",
            [{ kind: "design", ref: c.design.id }],
          ),
        ]
      : [];
  }),
];
