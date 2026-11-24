import { Prng } from "@linelab/sim-core";
import { describe, expect, it } from "vitest";
import { GaussianProcess, bayesOpt, expectedImprovement, latinHypercube } from "./bayesopt.js";
import { cmaes } from "./cmaes.js";
import { cholesky, symmetricEigen } from "./linalg.js";

describe("linear algebra", () => {
  it("diagonalises a symmetric matrix", () => {
    const a = [
      [4, 1, 0.5],
      [1, 3, 0.2],
      [0.5, 0.2, 1],
    ];
    const { values, vectors } = symmetricEigen(a);
    for (let k = 0; k < 3; k++) {
      const v = vectors.map((r) => r[k] ?? 0);
      const av = a.map((r) => r.reduce((s, x, j) => s + x * (v[j] ?? 0), 0));
      av.forEach((x, i) => {
        expect(x).toBeCloseTo((values[k] ?? 0) * (v[i] ?? 0), 9);
      });
    }
  });
  it("rejects a matrix that is not positive definite", () => {
    expect(() =>
      cholesky([
        [1, 2],
        [2, 1],
      ]),
    ).toThrow(/positive definite/);
  });
});

describe("CMA-ES", () => {
  it("finds the minimum of a rotated, badly scaled quadratic in the unit box", () => {
    const target = [0.3, 0.7, 0.55, 0.2, 0.8, 0.45];
    const f = (x: number[]) =>
      x.reduce(
        (s, v, i) =>
          s +
          10 ** (i / 2) *
            (v - (target[i] ?? 0) + 0.3 * ((x[(i + 1) % 6] ?? 0) - (target[(i + 1) % 6] ?? 0))) **
              2,
        0,
      );
    const r = cmaes(f, {
      x0: new Array<number>(6).fill(0.5),
      sigma0: 0.3,
      maxEvals: 3000,
      seed: 7,
    });
    expect(r.f).toBeLessThan(1e-8);
    r.x.forEach((v, i) => {
      expect(v).toBeCloseTo(target[i] ?? 0, 3);
    });
  });
  it("is deterministic for a seed and stops at the evaluation budget", () => {
    const f = (x: number[]) => (x[0] ?? 0) ** 2 + ((x[1] ?? 0) - 0.4) ** 2;
    const a = cmaes(f, { x0: [0.9, 0.9], sigma0: 0.2, maxEvals: 60, seed: 3 });
    const b = cmaes(f, { x0: [0.9, 0.9], sigma0: 0.2, maxEvals: 60, seed: 3 });
    expect(a).toEqual(b);
    expect(a.evals).toBeLessThanOrEqual(60);
  });
  it("respects the box: the optimum on a bound is returned on the bound", () => {
    const r = cmaes((x) => -(x[0] ?? 0) + ((x[1] ?? 0) - 0.5) ** 2, {
      x0: [0.5, 0.5],
      sigma0: 0.3,
      maxEvals: 400,
      seed: 1,
    });
    expect(r.x[0]).toBe(1);
  });
});

describe("Bayesian optimisation", () => {
  it("fits a GP that interpolates its data", () => {
    const xs = [[0.1], [0.4], [0.6], [0.9]];
    const ys = xs.map(([x]) => Math.sin(6 * (x ?? 0)));
    const gp = new GaussianProcess(xs, ys);
    xs.forEach((x, i) => {
      expect(gp.predict(x).mean).toBeCloseTo(ys[i] ?? 0, 2);
    });
    expect(gp.predict([0.25]).sd).toBeGreaterThan(gp.predict([0.4]).sd);
  });
  it("has zero expected improvement with no uncertainty and positive below the best", () => {
    expect(expectedImprovement(1, 0, 0.5)).toBe(0);
    expect(expectedImprovement(0.4, 0.1, 0.5)).toBeGreaterThan(0.05);
  });
  it("covers each axis evenly with a Latin hypercube", () => {
    const pts = latinHypercube(10, 2, new Prng(1));
    for (const d of [0, 1]) {
      const bins = new Set(pts.map((p) => Math.floor((p[d] ?? 0) * 10)));
      expect(bins.size).toBe(10);
    }
  });
  it("beats random search on a 2-D Branin-like function with the same budget", () => {
    const branin = ([u = 0, v = 0]: number[]) => {
      const x = u * 15 - 5;
      const y = v * 15;
      return (
        (y - (5.1 / (4 * Math.PI ** 2)) * x * x + (5 / Math.PI) * x - 6) ** 2 +
        10 * (1 - 1 / (8 * Math.PI)) * Math.cos(x) +
        10
      );
    };
    // Global minimum 0.398. Averaged over seeds so one lucky random draw can't decide it.
    const seeds = [1, 2, 3, 4, 5];
    const bo = seeds.map((seed) => bayesOpt(branin, { dim: 2, iterations: 24, seed }));
    expect(bo[0]?.history).toHaveLength(30);
    const random = seeds.map((seed) => {
      const rng = new Prng(seed + 100);
      return Math.min(...Array.from({ length: 30 }, () => branin([rng.next(), rng.next()])));
    });
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.max(...bo.map((r) => r.f))).toBeLessThan(1);
    expect(mean(bo.map((r) => r.f))).toBeLessThan(mean(random));
  });
});
