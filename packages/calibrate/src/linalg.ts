/** Small dense linear algebra for the optimisers (n ≤ ~50). Matrices are arrays of rows. */
export type Mat = number[][];

export const zeros = (r: number, c: number): Mat =>
  Array.from({ length: r }, () => new Array<number>(c).fill(0));
export const identity = (n: number): Mat =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
export const at = (m: Mat, i: number, j: number): number => m[i]?.[j] ?? 0;
export function set(m: Mat, i: number, j: number, v: number): void {
  const row = m[i];
  if (row) row[j] = v;
}
export const dot = (a: readonly number[], b: readonly number[]): number =>
  a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

/**
 * Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations.
 * Returns eigenvalues and eigenvectors as the columns of `vectors`.
 */
export function symmetricEigen(a: Mat): { values: number[]; vectors: Mat } {
  const n = a.length;
  const m = a.map((r) => [...r]);
  const v = identity(n);
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += at(m, i, j) ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = at(m, p, q);
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (at(m, q, q) - at(m, p, p)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = at(m, k, p);
          const mkq = at(m, k, q);
          set(m, k, p, c * mkp - s * mkq);
          set(m, k, q, s * mkp + c * mkq);
        }
        for (let k = 0; k < n; k++) {
          const mpk = at(m, p, k);
          const mqk = at(m, q, k);
          set(m, p, k, c * mpk - s * mqk);
          set(m, q, k, s * mpk + c * mqk);
        }
        for (let k = 0; k < n; k++) {
          const vkp = at(v, k, p);
          const vkq = at(v, k, q);
          set(v, k, p, c * vkp - s * vkq);
          set(v, k, q, s * vkp + c * vkq);
        }
      }
  }
  return { values: m.map((_, i) => at(m, i, i)), vectors: v };
}

/** Cholesky factor L (lower) of a symmetric positive-definite matrix; throws if not SPD. */
export function cholesky(a: Mat): Mat {
  const n = a.length;
  const l = zeros(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = at(a, i, j);
      for (let k = 0; k < j; k++) s -= at(l, i, k) * at(l, j, k);
      if (i === j) {
        if (s <= 0) throw new Error("matrix is not positive definite");
        set(l, i, i, Math.sqrt(s));
      } else set(l, i, j, s / at(l, j, j));
    }
  return l;
}

/** Solve L y = b (forward) for lower-triangular L. */
export function forwardSub(l: Mat, b: readonly number[]): number[] {
  const y: number[] = [];
  for (let i = 0; i < b.length; i++) {
    let s = b[i] ?? 0;
    for (let k = 0; k < i; k++) s -= at(l, i, k) * (y[k] ?? 0);
    y.push(s / at(l, i, i));
  }
  return y;
}

/** Solve Lᵀ x = y (backward) for lower-triangular L. */
export function backSub(l: Mat, y: readonly number[]): number[] {
  const n = y.length;
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i] ?? 0;
    for (let k = i + 1; k < n; k++) s -= at(l, k, i) * (x[k] ?? 0);
    x[i] = s / at(l, i, i);
  }
  return x;
}
