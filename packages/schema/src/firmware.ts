import { z } from "zod";
import { Board } from "./board.js";

/** How a board's firmware is executed in the simulator. */
export const FirmwareTier = z.enum([
  /** Cycle-accurate CPU emulation of the real compiled binary (AVR via avr8js). */
  "emulated",
  /** The sketch compiled to WebAssembly against LineLab's mock Arduino core: timing is approximate. */
  "hal",
]);
export type FirmwareTier = z.infer<typeof FirmwareTier>;

export const CompileDiagnostic = z
  .object({
    file: z.string(),
    line: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    severity: z.enum(["error", "warning", "note"]),
    message: z.string(),
  })
  .strict();
export type CompileDiagnostic = z.infer<typeof CompileDiagnostic>;

/** One row of the DWARF line table: code at `address` (bytes) comes from `file:line`. */
export const LineEntry = z
  .object({
    address: z.number().int().nonnegative(),
    file: z.string(),
    line: z.number().int().nonnegative(),
  })
  .strict();
export type LineEntry = z.infer<typeof LineEntry>;

/** How to decode a variable's bytes (little-endian). */
export const ValueType = z.enum(["u8", "i8", "u16", "i16", "u32", "i32", "float", "bool"]);
export type ValueType = z.infer<typeof ValueType>;

/** A global from the ELF symbol table. Data addresses are SRAM offsets (AVR's 0x800000 removed). */
export const FirmwareSymbol = z
  .object({
    name: z.string(),
    address: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    kind: z.enum(["data", "bss", "function"]),
    /** From the DWARF debug info, when the variable has a scalar type. */
    valueType: ValueType.optional(),
  })
  .strict();
export type FirmwareSymbol = z.infer<typeof FirmwareSymbol>;

/** The result of compiling a sketch: everything the simulator and debugger need. */
export const FirmwareArtifact = z
  .object({
    board: Board,
    tier: FirmwareTier,
    /** Intel HEX (emulated tier). */
    hex: z.string().optional(),
    /** WebAssembly module, base64 (hal tier). */
    wasmBase64: z.string().optional(),
    lines: z.array(LineEntry),
    symbols: z.array(FirmwareSymbol),
    /** sha256 of the sources, so a run can name the firmware it used. */
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    sizes: z
      .object({
        flashBytes: z.number().int().nonnegative(),
        ramBytes: z.number().int().nonnegative(),
      })
      .strict(),
    warnings: z.array(CompileDiagnostic),
  })
  .strict()
  .refine((a) => (a.tier === "emulated" ? a.hex !== undefined : a.wasmBase64 !== undefined), {
    error: "Emulated firmware needs `hex`; HAL firmware needs `wasmBase64`.",
  });
export type FirmwareArtifact = z.infer<typeof FirmwareArtifact>;

export const CompileRequest = z
  .object({
    board: Board,
    /** Sketch files by name; the main file is `<sketch>.ino`. */
    files: z.record(
      z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/),
      z.string().max(256 * 1024),
    ),
  })
  .strict()
  .refine((r) => Object.keys(r.files).some((f) => f.endsWith(".ino")), {
    error: "Include one .ino file.",
  })
  .refine((r) => Object.keys(r.files).length <= 16, { error: "At most 16 files." });
export type CompileRequest = z.infer<typeof CompileRequest>;

export const CompileResponse = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), artifact: FirmwareArtifact, log: z.string() }).strict(),
  z
    .object({ ok: z.literal(false), diagnostics: z.array(CompileDiagnostic), log: z.string() })
    .strict(),
]);
export type CompileResponse = z.infer<typeof CompileResponse>;

/** A static-analysis finding on firmware (LineLab's LFR rules, cppcheck or clang-tidy). */
export const FirmwareFinding = z
  .object({
    tool: z.enum(["linelab", "cppcheck", "clang-tidy"]),
    ruleId: z.string().min(1),
    severity: z.enum(["error", "warning", "info"]),
    file: z.string(),
    line: z.number().int().nonnegative(),
    column: z.number().int().nonnegative().optional(),
    message: z.string(),
    /** Why it matters on a line follower, and what to do. */
    explanation: z.string().optional(),
  })
  .strict();
export type FirmwareFinding = z.infer<typeof FirmwareFinding>;

export const AnalyzeResponse = z
  .object({ findings: z.array(FirmwareFinding), log: z.string() })
  .strict();
export type AnalyzeResponse = z.infer<typeof AnalyzeResponse>;
