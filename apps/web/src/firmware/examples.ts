import { Board, FirmwareArtifact } from "@linelab/schema";
import { z } from "zod";
import { EXAMPLES_JSON } from "./examples.generated";

export const Example = z.object({
  id: z.string(),
  name: z.string(),
  board: Board,
  source: z.string(),
  artifact: FirmwareArtifact.nullable(),
});
export type Example = z.infer<typeof Example>;

/** The sketches in examples/firmware, with artifacts prebuilt by the real compiler. */
export const EXAMPLES: Example[] = z.array(Example).parse(JSON.parse(EXAMPLES_JSON));

/** A prebuilt artifact for exactly this source and board, if one exists. */
export function prebuiltFor(source: string, board: Board): FirmwareArtifact | undefined {
  return EXAMPLES.find((e) => e.board === board && e.source === source)?.artifact ?? undefined;
}

export function starterFor(board: Board): string {
  const ex = board.startsWith("arduino:avr")
    ? EXAMPLES.find((e) => e.id === "good_pid")
    : board.startsWith("esp32")
      ? EXAMPLES.find((e) => e.id === "esp32_pid")
      : undefined;
  return (
    ex?.source ??
    `// Your line follower. LineLab runs this board on its simulated Arduino core (approximate timing).\n\nvoid setup() {\n  Serial.begin(115200);\n}\n\nvoid loop() {\n}\n`
  );
}
