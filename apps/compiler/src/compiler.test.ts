import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, parseClangTidy, parseCppcheck } from "./analyze.js";
import { compile, tierOf } from "./compile.js";
import { configFromEnv } from "./config.js";
import {
  parseDecodedLines,
  parseDwarfVariableTypes,
  parseGccDiagnostics,
  parseNm,
  parseSizes,
  sketchPrototypes,
} from "./parse.js";
import { runJob } from "./sandbox.js";
import { buildServer } from "./server.js";

describe("output parsers", () => {
  it("reads gcc diagnostics with file, line, column and severity", () => {
    const log = [
      "/tmp/job-x/sketch/sketch.ino: In function 'void loop()':",
      "/tmp/job-x/sketch/sketch.ino:12:5: error: 'foo' was not declared in this scope",
      "/tmp/job-x/sketch/sketch.ino:3:9: warning: unused variable 'x' [-Wunused-variable]",
      "sketch.ino:12:5: error: 'foo' was not declared in this scope",
    ].join("\n");
    expect(parseGccDiagnostics(log)).toEqual([
      {
        file: "sketch.ino",
        line: 12,
        column: 5,
        severity: "error",
        message: "'foo' was not declared in this scope",
      },
      {
        file: "sketch.ino",
        line: 3,
        column: 9,
        severity: "warning",
        message: "unused variable 'x' [-Wunused-variable]",
      },
    ]);
  });

  it("reads the decoded DWARF line table", () => {
    const text =
      "File name   Line number   Starting address\nwiring_digital.c   29   0x122\n\ngood_pid.ino   47   0x3a0\ngood_pid.ino   47   0x3a0   x\ngood_pid.ino   0   0x3b0\n";
    expect(parseDecodedLines(text)).toEqual([
      { address: 0x122, file: "wiring_digital.c", line: 29 },
      { address: 0x3a0, file: "good_pid.ino", line: 47 },
    ]);
  });

  it("reads nm symbols and moves AVR data addresses to SRAM offsets", () => {
    const text =
      "00800128 00000004 b lastError\n00800100 00000002 d lo\n000003a0 0000002e T loop\n00800120 B __bss_start\n";
    expect(parseNm(text)).toEqual([
      { name: "lo", address: 0x100, size: 2, kind: "data" },
      { name: "lastError", address: 0x128, size: 4, kind: "bss" },
      { name: "loop", address: 0x3a0, size: 0x2e, kind: "function" },
    ]);
  });

  it("finds variable types in DWARF info, through typedefs", () => {
    const text = `
 <1><7e3>: Abbrev Number: 17 (DW_TAG_base_type)
    <7e4>   DW_AT_byte_size   : 2
    <7e5>   DW_AT_encoding    : 5	(signed)
    <7e6>   DW_AT_name        : int
 <1><800>: Abbrev Number: 9 (DW_TAG_typedef)
    <801>   DW_AT_name        : uint8_t
    <805>   DW_AT_type        : <0x810>
 <1><810>: Abbrev Number: 17 (DW_TAG_base_type)
    <811>   DW_AT_byte_size   : 1
    <812>   DW_AT_encoding    : 8	(unsigned char)
    <813>   DW_AT_name        : unsigned char
 <1><d25>: Abbrev Number: 5 (DW_TAG_base_type)
    <d26>   DW_AT_byte_size   : 4
    <d27>   DW_AT_encoding    : 4	(float)
    <d28>   DW_AT_name        : float
 <1><20bd>: Abbrev Number: 54 (DW_TAG_variable)
    <20be>   DW_AT_name        : (indirect string, offset: 0x7ab): Kp
    <20c4>   DW_AT_type        : <0xd25>
    <20c8>   DW_AT_location    : 5 byte block: 3 28 1 80 0 	(DW_OP_addr: 800128)
 <1><20ce>: Abbrev Number: 61 (DW_TAG_variable)
    <20cf>   DW_AT_name        : lo
    <20d4>   DW_AT_type        : <0x7e3>
    <20d8>   DW_AT_location    : 5 byte block: 3 2c 1 80 0 	(DW_OP_addr: 80012c)
 <1><20de>: Abbrev Number: 61 (DW_TAG_variable)
    <20df>   DW_AT_name        : mode
    <20e4>   DW_AT_type        : <0x800>
    <20e8>   DW_AT_location    : 5 byte block: 3 2e 1 80 0 	(DW_OP_addr: 80012e)
`;
    expect(Object.fromEntries(parseDwarfVariableTypes(text))).toEqual({
      Kp: "float",
      lo: "i16",
      mode: "u8",
    });
  });

  it("reads program and RAM sizes from arduino-cli", () => {
    expect(
      parseSizes(
        "Sketch uses 4726 bytes (15%) of program storage space.\nGlobal variables use 212 bytes (10%) of dynamic memory",
      ),
    ).toEqual({ flashBytes: 4726, ramBytes: 212 });
  });

  it("declares sketch functions so they can be called before their definition", () => {
    const src =
      "int speed = 3;\nvoid setup() {}\nvoid loop() { drive(1); }\nvoid drive(int s, bool fast = false) {\n}\nstatic float avg(const int* v, int n)\n{\n  return 0;\n}\nif (x) {\n";
    expect(sketchPrototypes(src)).toEqual([
      "void drive(int s, bool fast);",
      "static float avg(const int* v, int n);",
    ]);
  });

  it("knows which boards are emulated and which use the HAL", () => {
    expect(tierOf("arduino:avr:nano")).toBe("emulated");
    expect(tierOf("esp32:esp32:esp32")).toBe("hal");
    expect(tierOf("arduino:avr:mega")).toBe("hal");
  });
});

describe("static analysis parsers", () => {
  it("reads cppcheck's template output and keeps only the sketch", () => {
    const out =
      "t.ino:5:3:error:arrayIndexOutOfBounds:Array 'v[3]' accessed at index 3\nArduino.h:10:1:style:foo:bar\n";
    expect(parseCppcheck(out, "t.ino")).toEqual([
      {
        tool: "cppcheck",
        ruleId: "cppcheck.arrayIndexOutOfBounds",
        severity: "error",
        file: "t.ino",
        line: 5,
        column: 3,
        message: "Array 'v[3]' accessed at index 3",
      },
    ]);
  });
  it("maps clang-tidy's .cpp line numbers back to the sketch", () => {
    const out =
      "/tmp/a/t.ino.cpp:9:13: warning: result of integer division used in a floating point context [bugprone-integer-division]\n/x/Arduino.h:3:1: warning: y [z]\n";
    expect(parseClangTidy(out, "t.ino", 3)).toEqual([
      {
        tool: "clang-tidy",
        ruleId: "clang-tidy.bugprone-integer-division",
        severity: "warning",
        file: "t.ino",
        line: 6,
        column: 13,
        message: "result of integer division used in a floating point context",
      },
    ]);
  });
});

describe("sandboxed jobs", () => {
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/tmp" };
  it("kills a job at its time limit", async () => {
    const r = await runJob(process.execPath, ["-e", "for(;;){}"], {
      cwd: "/tmp",
      env,
      limits: { timeoutMs: 1000, memoryMb: 1024, maxOutputBytes: 1024 },
    });
    expect(r.timedOut).toBe(true);
  });
  it.runIf(existsSync("/usr/bin/prlimit"))(
    "stops a job that allocates past its memory limit",
    async () => {
      const r = await runJob(
        process.execPath,
        [
          "--max-old-space-size=4096",
          "-e",
          "const a=[];for(let i=0;i<40;i++)a.push(Buffer.alloc(64*1024*1024,1));console.log('allocated')",
        ],
        { cwd: "/tmp", env, limits: { timeoutMs: 30_000, memoryMb: 1024, maxOutputBytes: 1024 } },
      );
      expect(r.code).not.toBe(0);
      expect(r.stdout).not.toContain("allocated");
    },
  );
  it("passes only the environment it is given", async () => {
    const r = await runJob(
      process.execPath,
      ["-e", "console.log(Object.keys(process.env).sort().join(','))"],
      { cwd: "/tmp", env },
    );
    expect(r.stdout.trim()).toBe("HOME,PATH");
  });
});

describe("server", () => {
  it("rejects malformed requests and reports health", async () => {
    const app = buildServer();
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toMatchObject({
      ok: true,
    });
    const bad = await app.inject({
      method: "POST",
      url: "/compile",
      payload: { board: "arduino:avr:nano", files: { "../evil.ino": "x" } },
    });
    expect(bad.statusCode).toBe(400);
    const none = await app.inject({
      method: "POST",
      url: "/compile",
      payload: { board: "arduino:avr:nano", files: { "a.h": "x" } },
    });
    expect(none.statusCode).toBe(400);
  });
});

// Real toolchains: run when they're installed (CI's docker job runs the same compile inside the
// image via selfcheck.ts).
const cfg = configFromEnv();
const hasArduino = (() => {
  try {
    execFileSync(cfg.arduinoCli, ["version"], { stdio: "ignore" });
    return cfg.avrToolsBin !== "";
  } catch {
    return false;
  }
})();
const hasClangWasm = (() => {
  try {
    return (
      execFileSync(cfg.clang, ["--print-targets"], { encoding: "utf8" }).includes("wasm32") &&
      existsSync("/usr/bin/wasm-ld")
    );
  } catch {
    return false;
  }
})();

const hasAnalyzers = (() => {
  try {
    execFileSync(cfg.cppcheck, ["--version"], { stdio: "ignore" });
    execFileSync(cfg.clangTidy, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("real toolchains", () => {
  it.runIf(hasAnalyzers)(
    "cppcheck and clang-tidy find bugs at sketch lines",
    async () => {
      const r = await analyze(
        {
          board: "arduino:avr:nano",
          files: {
            "t.ino":
              "int v[3];\nvoid setup() {}\nvoid loop() {\n  v[3] = 1;\n  float h = 1 / 2;\n  v[0] = (int)h;\n}\n",
          },
        },
        cfg,
      );
      expect(r.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tool: "cppcheck",
            ruleId: "cppcheck.arrayIndexOutOfBounds",
            line: 4,
          }),
          expect.objectContaining({
            tool: "clang-tidy",
            ruleId: "clang-tidy.bugprone-integer-division",
            line: 5,
          }),
        ]),
      );
    },
    120_000,
  );

  it.runIf(hasArduino)(
    "compiles an AVR sketch, with line table and typed symbols, and maps errors to lines",
    async () => {
      const ok = await compile(
        {
          board: "arduino:avr:nano",
          files: {
            "t.ino":
              "long total = 0;\nvoid setup() { Serial.begin(9600); }\nvoid loop() { total += analogRead(A0); }\n",
          },
        },
        cfg,
      );
      expect(ok.ok).toBe(true);
      if (!ok.ok) return;
      expect(ok.artifact.hex).toMatch(/^:/);
      expect(ok.artifact.lines.some((l) => l.file === "t.ino" && l.line === 3)).toBe(true);
      expect(ok.artifact.symbols.find((s) => s.name === "total")).toMatchObject({
        size: 4,
        valueType: "i32",
      });
      const bad = await compile(
        {
          board: "arduino:avr:nano",
          files: { "t.ino": "void setup() {}\nvoid loop() {\n  undefinedThing();\n}\n" },
        },
        cfg,
      );
      expect(bad.ok).toBe(false);
      if (!bad.ok)
        expect(bad.diagnostics[0]).toMatchObject({ file: "t.ino", line: 3, severity: "error" });
    },
    120_000,
  );

  it.runIf(hasClangWasm)(
    "compiles a sketch for the HAL and names functions the HAL lacks",
    async () => {
      const ok = await compile(
        {
          board: "esp32:esp32:esp32",
          files: {
            "t.ino":
              "void setup() { Serial.begin(115200); }\nvoid loop() { Serial.println(analogRead(34)); delay(5); helper(); }\nvoid helper() {}\n",
          },
        },
        cfg,
      );
      expect(ok.ok).toBe(true);
      const bad = await compile(
        {
          board: "esp32:esp32:esp32",
          files: {
            "t.ino":
              "void isr() {}\nvoid setup() { attachInterrupt(2, isr, RISING); }\nvoid loop() {}\n",
          },
        },
        cfg,
      );
      expect(bad.ok).toBe(false);
      if (!bad.ok)
        expect(bad.diagnostics.map((d) => d.message).join(" ")).toMatch(
          /attachInterrupt\(\) isn't available/,
        );
    },
    120_000,
  );
});
