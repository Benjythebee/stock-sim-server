/**
 * Money & price units.
 *
 * Internally every price and every cash amount is an integer number of cents ("ticks").
 * Integer arithmetic keeps order-book keys exact and keeps cash from drifting through
 * floating-point error. Dollars only exist at the edges: the wire protocol, settings and
 * the price model.
 */
export const TICKS_PER_DOLLAR = 100;

/** Smallest and largest accepted limit price, in ticks ($0.01 .. $1,000,000). */
export const MIN_PRICE_TICKS = 1;
export const MAX_PRICE_TICKS = 100_000_000;

/** Largest quantity accepted in a single order. */
export const MAX_ORDER_QTY = 1_000_000;

export function toTicks(dollars: number): number {
    return Math.round(dollars * TICKS_PER_DOLLAR);
}

export function toDollars(ticks: number): number {
    return ticks / TICKS_PER_DOLLAR;
}

/** Round a dollar amount to the nearest cent. */
export function roundCents(dollars: number): number {
    return Math.round(dollars * TICKS_PER_DOLLAR) / TICKS_PER_DOLLAR;
}

export function clampPriceTicks(ticks: number): number {
    return Math.min(MAX_PRICE_TICKS, Math.max(MIN_PRICE_TICKS, ticks));
}

/** Cents as "$1,234.56", for player-facing text. */
export function formatCents(cents: number): string {
    return `$${toDollars(cents).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
