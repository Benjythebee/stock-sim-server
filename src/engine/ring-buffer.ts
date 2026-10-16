/**
 * Fixed-capacity numeric history. Pushing is O(1) and never allocates, so the price model can
 * keep a long-running history without growing memory over an hour-long game.
 */
export class RingBuffer {
    private readonly data: Float64Array;
    private start = 0;
    private count = 0;

    constructor(readonly capacity: number) {
        this.data = new Float64Array(capacity);
    }

    get length(): number {
        return this.count;
    }

    push(value: number): void {
        if (this.count < this.capacity) {
            this.data[(this.start + this.count) % this.capacity] = value;
            this.count++;
        } else {
            this.data[this.start] = value;
            this.start = (this.start + 1) % this.capacity;
        }
    }

    /** Element by age: 0 = oldest, -1 = newest (negative indexes count from the end). */
    at(index: number): number | undefined {
        const i = index < 0 ? this.count + index : index;
        if (i < 0 || i >= this.count) return undefined;
        return this.data[(this.start + i) % this.capacity];
    }

    last(): number | undefined {
        return this.at(-1);
    }

    /** The newest `n` values, oldest first. */
    tail(n: number): number[] {
        const take = Math.min(n, this.count);
        const out = new Array<number>(take);
        for (let k = 0; k < take; k++) out[k] = this.at(this.count - take + k)!;
        return out;
    }

    /** Mean of the newest `n` values. */
    mean(n: number): number {
        const take = Math.min(n, this.count);
        if (take === 0) return NaN;
        let sum = 0;
        for (let k = 1; k <= take; k++) sum += this.at(-k)!;
        return sum / take;
    }

    clear(): void {
        this.start = 0;
        this.count = 0;
    }
}
