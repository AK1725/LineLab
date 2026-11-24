export interface Lesson {
  slug: string;
  title: string;
  summary: string;
  minutes: number;
  /** Opens a prepared robot: the reference Nano robot with this lesson sketch. */
  sketch?: "lesson_oscillation" | "lesson_blocking_delay";
  steps: { title: string; body: string }[];
}

/** Learn mode (BLUEPRINT §2.2 M): short guided lessons on the real tools. */
export const LESSONS: Lesson[] = [
  {
    slug: "first-line-follower",
    title: "Build your first line follower",
    summary: "Pick a chassis, add the five parts every line follower needs, wire it, and run it.",
    minutes: 15,
    steps: [
      {
        title: "Start a design",
        body: "Open Build and pick the Starter 2WD chassis. Your design is saved in this browser as you go.",
      },
      {
        title: "Add the drive",
        body: "In Parts, search “TT motor” and add two (they snap to the wheel mounts), then two “TT wheel”s and a ball caster.",
      },
      {
        title: "Add the brains and power",
        body: "Add an Arduino Nano, a TB6612FNG driver, a 5-channel TCRT5000 sensor (it goes under the nose) and a 2S LiPo or 4×AA pack.",
      },
      {
        title: "Wire it",
        body: "Open Wiring and press Auto-wire. Read each connection, then check the Checks panel: fix anything red before you go on.",
      },
      {
        title: "Run it",
        body: "Open Run, choose the Oval track and press Run. Watch the robot, scrub the timeline, and look at the line position plot.",
      },
      {
        title: "Use real firmware",
        body: "Open Code: the PID example is loaded for your board. Press Compile, then in Run choose “Your sketch” as the controller and run again.",
      },
    ],
  },
  {
    slug: "why-it-oscillates",
    title: "Why your robot oscillates",
    summary:
      "A robot that weaves left and right: see it, measure it, find the gain that causes it, and fix it.",
    minutes: 10,
    sketch: "lesson_oscillation",
    steps: [
      {
        title: "Run the lesson robot",
        body: "Press “Open the lesson robot” below. It opens a Nano robot with a sketch whose proportional gain is too high. Press Run.",
      },
      {
        title: "Read the symptoms",
        body: "The run report flags oscillation. In the plots, the line error swings from side to side instead of settling: each correction overshoots.",
      },
      {
        title: "Find the cause",
        body: "In Code, look at Kp. Proportional steering is Kp × error: too much and the robot overcorrects every time. The report points at the same line.",
      },
      {
        title: "Fix and compare",
        body: "Lower Kp (try 0.08), compile and run again. The previous run stays as a ghost so you can compare. Or press “Debug with AI” and check its verified fix.",
      },
    ],
  },
  {
    slug: "blocking-delays",
    title: "Why delay() breaks control loops",
    summary:
      "A robot that reacts late and overshoots corners, because the loop sleeps between readings.",
    minutes: 10,
    sketch: "lesson_blocking_delay",
    steps: [
      {
        title: "Run the lesson robot",
        body: "Open the lesson robot and run it on the Oval. It wobbles and misses the line on bends.",
      },
      {
        title: "Measure the loop",
        body: "In the firmware panel of the run, the loop period is about 25 ms instead of ~1 ms: the sensors are read 40 times a second.",
      },
      {
        title: "Find the line",
        body: "The report links the problem to a delay() call in loop(). While it sleeps, the robot keeps driving blind.",
      },
      {
        title: "Fix it",
        body: "Remove the delay (or replace timed work with a millis() check), compile and re-run. The loop period drops and the robot stays on the line.",
      },
    ],
  },
];
