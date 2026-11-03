import type { Random } from "effect";

/**
 * cyrb128 hash of `text`, as four 32-bit seeds.
 */
const hash = (text: string): [number, number, number, number] => {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
};

/**
 * A seeded random number generator (sfc32).
 *
 * Each `domain` gives its own stream, so draws from one generator do not shift
 * the draws of another.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string, domain = "") {
    [this.a, this.b, this.c, this.d] = hash(`${seed}:${domain}`);
    for (let i = 0; i < 12; i++) this.next();
  }

  /** A number in [0, 1). */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** An integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** A number in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** `true` with probability `p`. */
  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<const T>(values: readonly T[]): T {
    return values[Math.floor(this.next() * values.length)]!;
  }

  /** Picks a value with probability proportional to its weight. */
  weighted<const T>(values: readonly (readonly [T, number])[]): T {
    const total = values.reduce((sum, [, weight]) => sum + weight, 0);
    let r = this.next() * total;
    for (const [value, weight] of values) {
      r -= weight;
      if (r < 0) return value;
    }
    return values[values.length - 1]![0];
  }

  /** A random subset of `values`, in order, with at least `min` elements. */
  subset<T>(values: readonly T[], min = 0): T[] {
    const result = values.filter(() => this.bool());
    while (result.length < Math.min(min, values.length)) {
      const value = this.pick(values);
      if (result.includes(value) === false) result.push(value);
    }
    return values.filter((value) => result.includes(value));
  }

  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }

  /** A child generator for `domain`. */
  fork(domain: string): Rng {
    return new Rng(`${this.int(0, 2 ** 31)}`, domain);
  }

  /** The generator as the `Random` service of Effect. */
  toRandom(): Random.Random {
    return {
      nextDoubleUnsafe: () => this.next(),
      nextIntUnsafe: () => this.int(0, Number.MAX_SAFE_INTEGER),
    };
  }
}
