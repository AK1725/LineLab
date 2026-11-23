/**
 * Seeded PRNG (xoshiro128**, seeded with splitmix32). Every random number in the simulator comes
 * from here, so the same seed gives a bit-identical run. Never use Math.random in sim-core.
 */
export class Prng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spare: number | undefined;

  constructor(seed: number) {
    let x = seed >>> 0;
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Uniform 32-bit unsigned integer. */
  nextU32(): number {
    const rotl = (v: number, k: number) => ((v << k) | (v >>> (32 - k))) >>> 0;
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Standard normal (Box–Muller; the second value is kept for the next call). */
  gaussian(): number {
    if (this.spare !== undefined) {
      const v = this.spare;
      this.spare = undefined;
      return v;
    }
    let u = this.next();
    while (u <= Number.EPSILON) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** An independent stream derived from this one (e.g. one per noise source). */
  fork(): Prng {
    return new Prng(this.nextU32() ^ 0x5bd1e995);
  }
}
