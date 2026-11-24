import { Prng } from "@linelab/sim-core";
import { backSub, cholesky, forwardSub, type Mat } from "./linalg.js";

/** Standard normal pdf and cdf (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
const pdf = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
function cdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * Gaussian-process regression with a squared-exponential kernel on [0, 1]^d inputs, constant
 * mean and observation noise. Targets are standardised internally. The length scale is picked by
 * maximum marginal likelihood from a small grid.
 */
export class GaussianProcess {
  private l: Mat = [];
  private alpha: number[] = [];
  private ymean = 0;
  private yscale = 1;
  lengthScale = 0.3;

  constructor(
    private readonly xs: number[][],
    ys: readonly number[],
    private readonly noise = 1e-4,
  ) {
    const n = ys.length;
    this.ymean = ys.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const sd = Math.sqrt(ys.reduce((s, y) => s + (y - this.ymean) ** 2, 0) / Math.max(1, n));
    this.yscale = sd > 1e-12 ? sd : 1;
    const y = ys.map((v) => (v - this.ymean) / this.yscale);
    let bestLl = -Infinity;
    for (const ls of [0.08, 0.12, 0.18, 0.25, 0.35, 0.5, 0.7, 1]) {
      const fit = this.fit(ls, y);
      if (fit && fit.ll > bestLl) {
        bestLl = fit.ll;
        this.lengthScale = ls;
        this.l = fit.l;
        this.alpha = fit.alpha;
      }
    }
  }

  private k(a: readonly number[], b: readonly number[], ls: number): number {
    let d2 = 0;
    for (let i = 0; i < a.length; i++) d2 += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
    return Math.exp((-0.5 * d2) / (ls * ls));
  }

  private fit(ls: number, y: number[]) {
    const n = y.length;
    const K = this.xs.map((a, i) =>
      this.xs.map((b, j) => this.k(a, b, ls) + (i === j ? this.noise + 1e-8 : 0)),
    );
    try {
      const l = cholesky(K);
      const alpha = backSub(l, forwardSub(l, y));
      let logDet = 0;
      for (let i = 0; i < n; i++) logDet += Math.log(l[i]?.[i] ?? 1);
      const ll = -0.5 * y.reduce((s, v, i) => s + v * (alpha[i] ?? 0), 0) - logDet;
      return { l, alpha, ll };
    } catch {
      return undefined;
    }
  }

  /** Posterior mean and standard deviation at x, in the original units. */
  predict(x: readonly number[]): { mean: number; sd: number } {
    const ks = this.xs.map((a) => this.k(a, x, this.lengthScale));
    const m = ks.reduce((s, v, i) => s + v * (this.alpha[i] ?? 0), 0);
    const v = forwardSub(this.l, ks);
    const varN = Math.max(1e-12, 1 - v.reduce((s, x2) => s + x2 * x2, 0));
    return { mean: this.ymean + m * this.yscale, sd: Math.sqrt(varN) * this.yscale };
  }
}

/** Expected improvement below `best` (minimisation). */
export function expectedImprovement(mean: number, sd: number, best: number, xi = 0.01): number {
  if (sd <= 1e-12) return 0;
  const z = (best - mean - xi) / sd;
  return (best - mean - xi) * cdf(z) + sd * pdf(z);
}

export interface BayesOptOptions {
  dim: number;
  /** Points evaluated before the GP takes over (default: a Latin hypercube of 2·dim + 2). */
  initial?: number[][];
  iterations: number;
  seed: number;
  onEval?: (e: { index: number; x: number[]; f: number; best: number }) => void;
}

export interface BayesOptResult {
  x: number[];
  f: number;
  history: { x: number[]; f: number }[];
}

/** Latin hypercube sample of n points in [0, 1]^d. */
export function latinHypercube(n: number, d: number, rng: Prng): number[][] {
  const cols = Array.from({ length: d }, () => {
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [perm[i], perm[j]] = [perm[j] ?? 0, perm[i] ?? 0];
    }
    return perm.map((p) => (p + rng.next()) / n);
  });
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i] ?? 0));
}

/**
 * Bayesian optimisation on [0, 1]^dim: GP surrogate + expected improvement, maximised over
 * random candidates plus perturbations of the best points. Minimises `f`. Deterministic per seed.
 */
export function bayesOpt(f: (x: number[]) => number, o: BayesOptOptions): BayesOptResult {
  const rng = new Prng(o.seed);
  const history: { x: number[]; f: number }[] = [];
  const add = (x: number[]) => {
    const fx = f(x);
    history.push({ x, f: fx });
    const best = Math.min(...history.map((h) => h.f));
    o.onEval?.({ index: history.length - 1, x, f: fx, best });
  };
  for (const x of o.initial ?? latinHypercube(2 * o.dim + 2, o.dim, rng)) add(x);
  for (let it = 0; it < o.iterations; it++) {
    const gp = new GaussianProcess(
      history.map((h) => h.x),
      history.map((h) => h.f),
    );
    const best = Math.min(...history.map((h) => h.f));
    const elite = [...history].sort((a, b) => a.f - b.f).slice(0, 3);
    const candidates: number[][] = [];
    for (let i = 0; i < 600; i++) candidates.push(Array.from({ length: o.dim }, () => rng.next()));
    for (const e of elite)
      for (let i = 0; i < 100; i++)
        candidates.push(
          e.x.map((v) => Math.min(1, Math.max(0, v + rng.gaussian() * gp.lengthScale * 0.3))),
        );
    let pick = candidates[0] ?? [];
    let bestEi = -1;
    for (const c of candidates) {
      const p = gp.predict(c);
      const ei = expectedImprovement(p.mean, p.sd, best);
      if (ei > bestEi) {
        bestEi = ei;
        pick = c;
      }
    }
    add(pick);
  }
  const b = history.reduce((a, h) => (h.f < a.f ? h : a));
  return { x: b.x, f: b.f, history };
}
