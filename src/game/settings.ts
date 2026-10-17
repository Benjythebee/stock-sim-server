/**
 * Room/game settings. The admin edits them in the lobby; they are fixed once the game starts.
 */
export interface GameSettings {
    startingCash: number;
    openingPrice: number;
    seed: number;
    /** Per-step volatility as a fraction (0.05 = 5%). The admin UI edits it as a percentage. */
    marketVolatility: number;
    /** Minutes. */
    gameDuration: number;
    enableRandomNews: boolean;
    /** Number of AI bots (excluding the house market maker). */
    bots: number;
    /** Ticker symbol shown in the UI (historical name, kept for protocol compatibility). */
    ticketName: string;
    /** Bot strategy ids to draw from. Empty/undefined = every enabled strategy. */
    botSelection?: string[];
    /** Add a house market maker that always quotes around the guide price. */
    houseLiquidity: boolean;
    /**
     * Broadcast the hidden intrinsic value and guide price every second (DEBUG_PRICES).
     * Off by default: it gives away the answer, and anyone can read it off the socket.
     */
    revealPrices: boolean;
    /** Players can only place market orders (bots and the house still quote with limit orders). */
    disableLimitOrders: boolean;
    /**
     * Turn off the random noise in the guide price and the periodic drift of the fair value, so the
     * price only moves on news, powers, trades and mean reversion. Volatility Storm still adds noise.
     */
    disableRandomWalk: boolean;
    /** Briefcases drop during the game. Off = no briefcases at all (a pure trading game). */
    enablePowers: boolean;
    /**
     * Power ids briefcases never offer. A blocklist rather than a pick list, so a power a mod adds
     * later is on by default. Unknown ids are dropped by the sanitizer.
     */
    disabledPowers: string[];
}

/** What clients see (identical today, kept as its own name so the two can diverge). */
export type PublicGameSettings = GameSettings;

export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({
    startingCash: 10_000,
    openingPrice: 1,
    seed: 42,
    marketVolatility: 0.05,
    gameDuration: 5,
    enableRandomNews: true,
    bots: 5,
    ticketName: "AAPL",
    houseLiquidity: true,
    revealPrices: false,
    disableLimitOrders: false,
    disableRandomWalk: false,
    enablePowers: true,
    disabledPowers: [],
});

export const LIMITS = {
    startingCash: [0, 999_999_999],
    openingPrice: [0.01, 10_000],
    marketVolatilityPercent: [0.01, 50],
    gameDuration: [1, 60],
    bots: [0, 50],
    tickerLength: 8,
} as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): number | undefined => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

/**
 * Merge an untrusted partial update (from ADMIN_SETTINGS) into the current settings.
 * Unknown keys and invalid values are ignored; numbers are clamped to sane ranges.
 * Note: `marketVolatility` arrives as a percentage (5 = 5%) and is stored as a fraction.
 */
export function applySettingsUpdate(
    current: GameSettings,
    update: Record<string, unknown>,
    knownBotIds: readonly string[],
    knownPowerIds: readonly string[],
): GameSettings {
    const next: GameSettings = { ...current };

    const startingCash = finite(update.startingCash);
    if (startingCash !== undefined) next.startingCash = Math.round(clamp(startingCash, LIMITS.startingCash));

    const openingPrice = finite(update.openingPrice);
    if (openingPrice !== undefined) next.openingPrice = Math.round(clamp(openingPrice, LIMITS.openingPrice) * 100) / 100;

    const volatility = finite(update.marketVolatility);
    if (volatility !== undefined) next.marketVolatility = clamp(volatility, LIMITS.marketVolatilityPercent) / 100;

    const duration = finite(update.gameDuration);
    if (duration !== undefined) next.gameDuration = clamp(duration, LIMITS.gameDuration);

    const bots = finite(update.bots);
    if (bots !== undefined) next.bots = Math.round(clamp(bots, LIMITS.bots));

    const seed = finite(update.seed);
    if (seed !== undefined) next.seed = Math.trunc(seed) >>> 0;

    if (typeof update.enableRandomNews === "boolean") next.enableRandomNews = update.enableRandomNews;
    if (typeof update.houseLiquidity === "boolean") next.houseLiquidity = update.houseLiquidity;
    if (typeof update.revealPrices === "boolean") next.revealPrices = update.revealPrices;
    if (typeof update.disableLimitOrders === "boolean") next.disableLimitOrders = update.disableLimitOrders;
    if (typeof update.disableRandomWalk === "boolean") next.disableRandomWalk = update.disableRandomWalk;
    if (typeof update.enablePowers === "boolean") next.enablePowers = update.enablePowers;

    if (typeof update.ticketName === "string") {
        const ticker = update.ticketName.replace(/[^A-Za-z0-9.]/g, "").toUpperCase().slice(0, LIMITS.tickerLength);
        if (ticker) next.ticketName = ticker;
    }

    if (Array.isArray(update.botSelection)) {
        const known = new Set(knownBotIds);
        next.botSelection = [...new Set(update.botSelection.filter((id): id is string => typeof id === "string" && known.has(id)))];
    }

    if (Array.isArray(update.disabledPowers)) {
        const known = new Set(knownPowerIds);
        next.disabledPowers = [...new Set(update.disabledPowers.filter((id): id is string => typeof id === "string" && known.has(id)))];
    }

    return next;
}
