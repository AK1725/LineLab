import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export interface JobLimits {
  timeoutMs: number;
  /** Address-space limit per job process (prlimit --as). The container's cgroup limit applies too. */
  memoryMb: number;
  maxOutputBytes: number;
}

export const DEFAULT_LIMITS: JobLimits = {
  timeoutMs: 60_000,
  memoryMb: 1024,
  maxOutputBytes: 2 * 1024 * 1024,
};

export interface JobResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const PRLIMIT = ["/usr/bin/prlimit", "/bin/prlimit"].find((p) => existsSync(p));

/**
 * Run one untrusted build step: a fresh process group, a clean environment, address-space and
 * file-size limits (prlimit), a wall-clock timeout that kills the whole group, and capped output.
 * Network isolation comes from the container (internal network only), not from this function.
 */
export function runJob(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; limits?: JobLimits },
): Promise<JobResult> {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const [file, argv] = PRLIMIT
    ? [
        PRLIMIT,
        [
          `--as=${limits.memoryMb * 1024 * 1024}`,
          `--fsize=${256 * 1024 * 1024}`,
          "--core=0",
          "--",
          cmd,
          ...args,
        ],
      ]
    : [cmd, args];
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = (s: string, chunk: Buffer) =>
      s.length < limits.maxOutputBytes ? s + chunk.toString("utf8") : s;
    child.stdout.on("data", (c: Buffer) => (stdout = cap(stdout, c)));
    child.stderr.on("data", (c: Buffer) => (stderr = cap(stderr, c)));
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, limits.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}
