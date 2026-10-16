/**
 * Seeded pseudo-random generator (mulberry32). Every bit of gameplay randomness goes through
 * an Rng derived from the room seed, so a game with the same seed and the same player input
 * replays identically.
 */
export class Rng {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0;
    }

    /** Uniform float in [0, 1). */
    next(): number {
        let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Uniform float in [-1, 1). */
    signed(): number {
        return this.next() * 2 - 1;
    }

    /** Uniform float in [min, max). */
    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    /** Uniform integer in [0, maxExclusive). */
    int(maxExclusive: number): number {
        return Math.floor(this.next() * maxExclusive);
    }

    chance(probability: number): boolean {
        return this.next() < probability;
    }

    /** Standard normal sample (Box-Muller). */
    normal(): number {
        const u1 = 1 - this.next(); // (0, 1] so log() stays finite
        const u2 = this.next();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    pick<T>(items: readonly T[]): T | undefined {
        return items.length ? items[this.int(items.length)] : undefined;
    }

    /** In-place Fisher-Yates shuffle. */
    shuffle<T>(items: T[]): T[] {
        for (let i = items.length - 1; i > 0; i--) {
            const j = this.int(i + 1);
            const tmp = items[i]!;
            items[i] = items[j]!;
            items[j] = tmp;
        }
        return items;
    }

    /**
     * Derive an independent child generator. Use one per subsystem/bot so that adding
     * randomness in one place doesn't shift every other stream.
     */
    fork(salt: number): Rng {
        return new Rng(Math.imul((this.next() * 4294967296) >>> 0, 0x9e3779b1) ^ salt);
    }
}

/**
 * Weighted pick without replacement. Items with weight <= 0 are never picked.
 */
export function weightedSample<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number, count: number): T[] {
    const pool = items.filter((item) => weightOf(item) > 0);
    const picked: T[] = [];
    while (picked.length < count && pool.length > 0) {
        let total = 0;
        for (const item of pool) total += weightOf(item);
        let roll = rng.next() * total;
        let index = pool.length - 1;
        for (let i = 0; i < pool.length; i++) {
            roll -= weightOf(pool[i]!);
            if (roll < 0) {
                index = i;
                break;
            }
        }
        picked.push(pool[index]!);
        pool.splice(index, 1);
    }
    return picked;
}
