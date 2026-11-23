// Regenerates fixtures/*.design.json (the Phase 3 acceptance designs) from the test kit.
// Run: pnpm --filter @linelab/rules-engine exec tsx scripts/make-fixtures.ts
// Then review the printed findings and update fixtures/expected.json by hand.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOOD_PARTS,
  apply,
  connect,
  disconnect,
  findings,
  robot,
  type Robot,
} from "../src/__tests__/kit.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const swap = (from: string, to: string) => GOOD_PARTS.map((p) => (p === from ? to : p));

const pico = robot({
  parts: ["mcu.raspberry-pi-pico", ...GOOD_PARTS.filter((p) => p !== "mcu.arduino-nano")],
});
const fixtures: Record<string, Robot> = {
  good_nano_tb6612_qtr8: robot(),
  bad_no_common_ground: apply(robot(), disconnect("motor-driver1.GND")),
  bad_esp32_adc2_wifi: robot({
    parts: ["mcu.esp32-devkitc", ...GOOD_PARTS.filter((p) => p !== "mcu.arduino-nano")],
  }),
  bad_9v_battery: robot({ parts: swap("battery.lipo-2s-300mah", "battery.9v-alkaline") }),
  // The sensor array is moved from the Pico's 3.3 V rail to the 5 V regulator output.
  bad_5v_into_pico: apply(
    pico,
    disconnect("line-sensor1.VCC"),
    connect("line-sensor1.VCC", "regulator1.VOUT"),
  ),
};

for (const [name, r] of Object.entries(fixtures)) {
  const design = {
    $schema: "../../schema/json-schema/design.schema.json",
    ...r.design,
    id: name.replace(/_/g, "-"),
    name,
  };
  writeFileSync(join(dir, `${name}.design.json`), `${JSON.stringify(design, null, 2)}\n`);
  console.log(`\n${name}`);
  for (const f of findings(r)) console.log(`  ${f.severity.padEnd(7)} ${f.id}  ${f.message}`);
}
