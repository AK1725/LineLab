// `node dist/selfcheck.js`: proves the sandbox inside the running container.
// 1. a job cannot reach the internet; 2. a job is killed at the time limit;
// 3. a job is killed above the memory limit; 4. the bundled toolchain compiles offline.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "./compile.js";
import { configFromEnv } from "./config.js";
import { runJob } from "./sandbox.js";

const cwd = mkdtempSync(join(tmpdir(), "selfcheck-"));
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd };
const node = process.execPath;
const results: [string, boolean, string][] = [];

// node:https rather than fetch: fetch's WebAssembly parser can't reserve memory under the 1 GB
// address-space limit, which would make this check pass for the wrong reason.
const probe =
  "const r=require('https').get('https://example.com',{timeout:8000},s=>{console.log('reached',s.statusCode);process.exit(0)});r.on('timeout',()=>{console.log('blocked: timeout');process.exit(3)});r.on('error',e=>{console.log('blocked:',e.code);process.exit(3)})";
const net = await runJob(node, ["-e", probe], {
  cwd,
  env: { ...env, HTTPS_PROXY: "", https_proxy: "" },
});
results.push([
  "network is unreachable from a job",
  net.code === 3,
  `${net.stdout.trim()} ${net.stderr.trim().slice(0, 200)}`,
]);

const slow = await runJob(node, ["-e", "for(;;){}"], {
  cwd,
  env,
  limits: { timeoutMs: 2000, memoryMb: 1024, maxOutputBytes: 1024 },
});
results.push([
  "a job is killed at its time limit",
  slow.timedOut,
  `timedOut=${String(slow.timedOut)}`,
]);

const big = await runJob(
  node,
  [
    "--max-old-space-size=4096",
    "-e",
    "const a=[];for(let i=0;i<40;i++)a.push(Buffer.alloc(64*1024*1024,1));console.log('allocated 2.5 GB')",
  ],
  { cwd, env, limits: { timeoutMs: 30000, memoryMb: 1024, maxOutputBytes: 1024 } },
);
results.push([
  "a job is killed above 1 GB",
  big.code !== 0 && !big.stdout.includes("allocated"),
  `code=${String(big.code)} signal=${String(big.signal)}`,
]);

const ok = await compile(
  {
    board: "arduino:avr:nano",
    files: {
      "blink.ino":
        "void setup(){pinMode(13,OUTPUT);}\nvoid loop(){digitalWrite(13,!digitalRead(13));delay(500);}\n",
    },
  },
  configFromEnv(),
);
results.push([
  "arduino:avr compiles offline",
  ok.ok,
  ok.ok ? `${ok.artifact.sizes.flashBytes} bytes` : ok.log.slice(0, 400),
]);

const hal = await compile(
  {
    board: "esp32:esp32:esp32",
    files: {
      "t.ino":
        "void setup(){Serial.begin(115200);}\nvoid loop(){Serial.println(analogRead(34));delay(10);}\n",
    },
  },
  configFromEnv(),
);
results.push([
  "HAL (clang → wasm32) compiles offline",
  hal.ok,
  hal.ok ? `${hal.artifact.sizes.flashBytes} bytes` : hal.log.slice(0, 400),
]);

for (const [name, pass, detail] of results) console.log(`${pass ? "✓" : "✗"} ${name} (${detail})`);
process.exitCode = results.every((r) => r[1]) ? 0 : 1;
