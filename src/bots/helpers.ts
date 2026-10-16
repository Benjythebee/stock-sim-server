/** Price helpers for strategies (dollars in, dollars out, always on the cent grid). */

/** Highest cent price <= p (min $0.01). */
export const floorCents = (p: number) => Math.max(0.01, Math.floor(p * 100 + 1e-9) / 100);

/** Lowest cent price >= p (min $0.01). */
export const ceilCents = (p: number) => Math.max(0.01, Math.ceil(p * 100 - 1e-9) / 100);

/** A bid/ask pair around `mid`, at least one cent apart. */
export function quotePair(mid: number, halfSpread: number): { bid: number; ask: number } {
    const bid = floorCents(mid * (1 - halfSpread));
    let ask = ceilCents(mid * (1 + halfSpread));
    if (ask <= bid) ask = Math.round((bid + 0.01) * 100) / 100;
    return { bid, ask };
}

/** Relative change between the newest value and the value `lookback` entries earlier. */
export function momentum(values: { at(i: number): number | undefined; length: number }, lookback: number): number | null {
    if (values.length <= lookback) return null;
    const now = values.at(-1)!;
    const then = values.at(-1 - lookback)!;
    return then > 0 ? (now - then) / then : null;
}
