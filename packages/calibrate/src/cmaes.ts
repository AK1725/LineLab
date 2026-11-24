import { Prng } from "@linelab/sim-core";
import { at, dot, set, symmetricEigen, zeros, type Mat } from "./linalg.js";

export interface CmaesOptions {
  /** Start point and initial step size, in the optimiser's (normalised) space. */
  x0: readonly number[];
  sigma0: number;
  /** Box bounds per coordinate (default [0, 1]); candidates are clipped into them. */
  lower?: readonly number[];
  upper?: readonly number[];
  /** Population size λ (default 4 + ⌊3 ln n⌋). */
  popSize?: number;
  maxEvals: number;
  seed: number;
  /** Stop when the step size falls below this. */
  tolSigma?: number;
  onGeneration?: (g: { generation: number; evals: number; bestF: number; sigma: number }) => void;
}

export interface CmaesResult {
  x: number[];
  f: number;
  evals: number;
  generations: number;
  history: { evals: number; bestF: number }[];
}

/**
 * (μ/μ_w, λ)-CMA-ES (Hansen 2016, "The CMA Evolution Strategy: A Tutorial") with rank-one and
 * rank-μ covariance updates and cumulative step-size adaptation. Minimises `f`. Deterministic
 * for a given seed. Bounds are handled by clipping the evaluated point (the unclipped sample
 * drives the update, plus a small penalty on the distance clipped).
 */
export function cmaes(f: (x: number[]) => number, o: CmaesOptions): CmaesResult {
  const n = o.x0.length;
  const lo = o.lower ?? new Array<number>(n).fill(0);
  const hi = o.upper ?? new Array<number>(n).fill(1);
  const rng = new Prng(o.seed);
  const lambda = o.popSize ?? 4 + Math.floor(3 * Math.log(n));
  const mu = Math.floor(lambda / 2);
  const rawW = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const wSum = rawW.reduce((a, b) => a + b, 0);
  const w = rawW.map((x) => x / wSum);
  const mueff = 1 / w.reduce((s, x) => s + x * x, 0);
  const cc = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
  const cs = (mueff + 2) / (n + mueff + 5);
  const c1 = 2 / ((n + 1.3) ** 2 + mueff);
  const cmu = Math.min(1 - c1, (2 * (mueff - 2 + 1 / mueff)) / ((n + 2) ** 2 + mueff));
  const damps = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));

  let mean = [...o.x0];
  let sigma = o.sigma0;
  const pc = new Array<number>(n).fill(0);
  const ps = new Array<number>(n).fill(0);
  let C: Mat = zeros(n, n);
  for (let i = 0; i < n; i++) set(C, i, i, 1);
  let B: Mat = zeros(n, n);
  for (let i = 0; i < n; i++) set(B, i, i, 1);
  let D = new Array<number>(n).fill(1);
  let evals = 0;
  let generation = 0;
  let best = { x: [...o.x0], f: Infinity };
  const history: CmaesResult["history"] = [];

  const clip = (x: number[]) => x.map((v, i) => Math.min(hi[i] ?? 1, Math.max(lo[i] ?? 0, v)));
  const evaluate = (x: number[]) => {
    const c = clip(x);
    const pen = x.reduce((s, v, i) => s + (v - (c[i] ?? 0)) ** 2, 0);
    const fx = f(c);
    evals++;
    if (fx < best.f) best = { x: c, f: fx };
    return fx + pen * 10;
  };

  while (evals + lambda <= o.maxEvals) {
    generation++;
    // Sample λ candidates: x = m + σ B D z.
    const pop = Array.from({ length: lambda }, () => {
      const z = Array.from({ length: n }, () => rng.gaussian());
      const y = Array.from({ length: n }, (_, i) =>
        z.reduce((s, zj, j) => s + at(B, i, j) * (D[j] ?? 1) * zj, 0),
      );
      const x = mean.map((m, i) => m + sigma * (y[i] ?? 0));
      return { x, y, f: evaluate(x) };
    });
    pop.sort((a, b) => a.f - b.f);
    const sel = pop.slice(0, mu);
    const old = mean;
    mean = Array.from({ length: n }, (_, i) =>
      sel.reduce((s, p, k) => s + (w[k] ?? 0) * (p.x[i] ?? 0), 0),
    );
    const yw = mean.map((m, i) => (m - (old[i] ?? 0)) / sigma);

    // C^{-1/2} yw = B D^{-1} Bᵀ yw
    const bty = Array.from({ length: n }, (_, j) => yw.reduce((s, v, i) => s + at(B, i, j) * v, 0));
    const cInvHalfY = Array.from({ length: n }, (_, i) =>
      bty.reduce((s, v, j) => s + (at(B, i, j) * v) / (D[j] ?? 1), 0),
    );
    for (let i = 0; i < n; i++)
      ps[i] = (1 - cs) * (ps[i] ?? 0) + Math.sqrt(cs * (2 - cs) * mueff) * (cInvHalfY[i] ?? 0);
    const psNorm = Math.sqrt(dot(ps, ps));
    const hsig =
      psNorm / Math.sqrt(1 - (1 - cs) ** (2 * generation)) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    for (let i = 0; i < n; i++)
      pc[i] = (1 - cc) * (pc[i] ?? 0) + hsig * Math.sqrt(cc * (2 - cc) * mueff) * (yw[i] ?? 0);

    const next = zeros(n, n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j <= i; j++) {
        let rankMu = 0;
        for (let k = 0; k < mu; k++) {
          const yi = ((sel[k]?.x[i] ?? 0) - (old[i] ?? 0)) / sigma;
          const yj = ((sel[k]?.x[j] ?? 0) - (old[j] ?? 0)) / sigma;
          rankMu += (w[k] ?? 0) * yi * yj;
        }
        const v =
          (1 - c1 - cmu) * at(C, i, j) +
          c1 * ((pc[i] ?? 0) * (pc[j] ?? 0) + (1 - hsig) * cc * (2 - cc) * at(C, i, j)) +
          cmu * rankMu;
        set(next, i, j, v);
        set(next, j, i, v);
      }
    C = next;
    sigma *= Math.exp((cs / damps) * (psNorm / chiN - 1));
    sigma = Math.min(sigma, 1e3);

    const e = symmetricEigen(C);
    B = e.vectors;
    D = e.values.map((v) => Math.sqrt(Math.max(v, 1e-20)));
    history.push({ evals, bestF: best.f });
    o.onGeneration?.({ generation, evals, bestF: best.f, sigma });
    if (sigma * Math.max(...D) < (o.tolSigma ?? 1e-6)) break;
  }
  return { x: best.x, f: best.f, evals, generations: generation, history };
}
