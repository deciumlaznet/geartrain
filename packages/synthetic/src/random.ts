// Seeded randomness so every run of the generator produces the same data.

export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32: small, fast and good enough for test data. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("pick from empty list");
    return item;
  }

  /** Roughly normal around `mean` (sum of three uniforms), never below `floor`. */
  around(mean: number, spread: number, floor = 0): number {
    const z = (this.next() + this.next() + this.next() - 1.5) / 1.5;
    return Math.max(floor, Math.round(mean + z * spread));
  }

  /** A child generator, so adding data to one stream does not shift another. */
  fork(label: string): Random {
    let h = this.state;
    for (const ch of label) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0;
    return new Random(h);
  }
}
