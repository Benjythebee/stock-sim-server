import { describe, expect, test } from "bun:test";
import { RingBuffer } from "../../src/engine/ring-buffer";

describe("RingBuffer", () => {
    test("keeps insertion order below capacity", () => {
        const rb = new RingBuffer(4);
        rb.push(1);
        rb.push(2);
        expect(rb.length).toBe(2);
        expect(rb.at(0)).toBe(1);
        expect(rb.at(-1)).toBe(2);
        expect(rb.last()).toBe(2);
    });

    test("overwrites the oldest value when full", () => {
        const rb = new RingBuffer(3);
        for (const v of [1, 2, 3, 4, 5]) rb.push(v);
        expect(rb.length).toBe(3);
        expect(rb.tail(3)).toEqual([3, 4, 5]);
        expect(rb.at(0)).toBe(3);
        expect(rb.at(-1)).toBe(5);
    });

    test("out-of-range access returns undefined", () => {
        const rb = new RingBuffer(3);
        rb.push(1);
        expect(rb.at(1)).toBeUndefined();
        expect(rb.at(-2)).toBeUndefined();
    });

    test("tail() and mean() clamp to available data", () => {
        const rb = new RingBuffer(10);
        for (const v of [2, 4, 6]) rb.push(v);
        expect(rb.tail(10)).toEqual([2, 4, 6]);
        expect(rb.mean(2)).toBe(5);
        expect(rb.mean(100)).toBe(4);
        expect(new RingBuffer(2).mean(1)).toBeNaN();
    });

    test("clear()", () => {
        const rb = new RingBuffer(2);
        rb.push(1);
        rb.clear();
        expect(rb.length).toBe(0);
        expect(rb.last()).toBeUndefined();
    });
});
