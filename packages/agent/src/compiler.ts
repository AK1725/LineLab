import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CompileResponse, type CompileRequest } from "@linelab/schema";

/** Anything that can compile a sketch: the sandboxed service over HTTP, or a cache in front of it. */
export interface Compiler {
  compile(req: CompileRequest): Promise<CompileResponse>;
}

/** The compiler service (apps/compiler) over HTTP. */
export class HttpCompiler implements Compiler {
  constructor(private readonly baseUrl: string) {}
  async compile(req: CompileRequest): Promise<CompileResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/compile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      return {
        ok: false,
        log: "",
        diagnostics: [
          {
            file: "",
            line: 0,
            column: 0,
            severity: "error",
            message: `The compiler service at ${this.baseUrl} isn't reachable.`,
          },
        ],
      };
    }
    const body: unknown = await res.json();
    const parsed = CompileResponse.safeParse(body);
    if (!parsed.success)
      throw new Error(
        `Compiler returned ${String(res.status)}: ${JSON.stringify(body).slice(0, 200)}`,
      );
    return parsed.data;
  }
}

/** Stable key for a compile request: board + files, sorted. */
export function compileKey(req: CompileRequest): string {
  const files = Object.keys(req.files)
    .sort()
    .map((k) => [k, req.files[k] ?? ""]);
  return createHash("sha256")
    .update(JSON.stringify([req.board, files]))
    .digest("hex");
}

/**
 * A directory of real compiler outputs keyed by request, in front of an optional compiler. Lets
 * tests, the offline eval and the e2e path run firmware that was compiled earlier by the real
 * toolchain; with no inner compiler, an unknown sketch is reported as "not compiled", never faked.
 */
export class CachedCompiler implements Compiler {
  constructor(
    private readonly dir: string,
    private readonly inner?: Compiler,
  ) {}
  async compile(req: CompileRequest): Promise<CompileResponse> {
    const file = join(this.dir, `${compileKey(req)}.json`);
    if (existsSync(file)) return CompileResponse.parse(JSON.parse(readFileSync(file, "utf8")));
    if (!this.inner) {
      return {
        ok: false,
        log: "",
        diagnostics: [
          {
            file: "",
            line: 0,
            column: 0,
            severity: "error",
            message:
              "The compiler service isn't available, and this exact sketch hasn't been compiled before.",
          },
        ],
      };
    }
    const r = await this.inner.compile(req);
    // Cache real results only (an unreachable service isn't a compile result).
    if (r.ok || r.log !== "") {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(file, `${JSON.stringify(r)}\n`);
    }
    return r;
  }
}
