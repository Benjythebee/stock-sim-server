import { RingBuffer } from "./ring-buffer";
import { roundCents } from "./money";
import type { Rng } from "./rng";

export interface PriceModelConfig {
    initialPrice: number;
    /** Per-step trend (positive = upward). */
    drift: number;
    /** Per-step standard deviation of log returns, e.g. 0.05. */
    volatility: number;
    /** 0..1, how strongly the guide price is pulled toward the intrinsic value each step. */
    meanReversion: number;
    /** False = no random noise in the guide price unless a volatility boost is active. Default true. */
    randomWalk?: boolean;
    /** Steps of guide-price history to keep for bots. */
    historySize?: number;
}

/** Hard cap so stacked volatility effects can't blow the price up to infinity. */
export const MAX_VOLATILITY = 0.5;

/**
 * Hidden "fundamentals" of the stock.
 *
 * - `intrinsic`: the fair value. Only moves on news, powers and slow periodic drift.
 * - `guide`: a geometric Brownian motion that mean-reverts toward `intrinsic`. Liquidity bots
 *   quote around it, which makes the traded price follow it.
 *
 * Effects are stackable and reversible: every boost returns a `release` function, so two
 * overlapping Volatility Storms restore the base volatility correctly in any order.
 */
export class PriceModel {
    guide: number;
    intrinsic: number;
    baseVolatility: number;
    drift: number;
    meanReversion: number;
    randomWalk: boolean;
    readonly history: RingBuffer;
    steps = 0;

    private shock: { intensity: number; remaining: number } | null = null;
    private readonly volatilityBoosts = new Set<{ factor: number }>();

    constructor(config: PriceModelConfig, private readonly rng: Rng) {
        this.guide = config.initialPrice;
        this.baseVolatility = config.volatility;
        this.drift = config.drift;
        this.meanReversion = config.meanReversion;
        this.randomWalk = config.randomWalk ?? true;
        // Start the fair value somewhere around the opening price (never below 20% of it).
        this.intrinsic = Math.max(config.initialPrice * 0.2, config.initialPrice * (1 + rng.normal() * 0.25));
        this.history = new RingBuffer(config.historySize ?? 512);
        this.history.push(this.guide);
    }

    get volatility(): number {
        let v = this.baseVolatility;
        for (const boost of this.volatilityBoosts) v *= boost.factor;
        return Math.min(MAX_VOLATILITY, v);
    }

    get isShockActive(): boolean {
        return this.shock !== null;
    }

    /** Advance one market step. */
    step(): void {
        this.steps++;
        let totalDrift = this.drift;
        if (this.shock) {
            totalDrift += this.shock.intensity;
            if (--this.shock.remaining <= 0) this.shock = null;
        }
        totalDrift += -((this.guide - this.intrinsic) / this.intrinsic) * this.meanReversion;

        // Without the random walk the guide only follows drift, shocks and mean reversion, but a
        // volatility boost (Volatility Storm) still shakes it.
        const sigma = this.randomWalk || this.volatilityBoosts.size > 0 ? this.volatility : 0;
        const change = totalDrift - 0.5 * sigma * sigma + sigma * this.rng.normal();
        this.guide = Math.max(0.01, this.guide * Math.exp(change));
        this.history.push(this.guide);
    }

    /** Guide price rounded to cents. */
    get guidePrice(): number {
        return roundCents(this.guide);
    }

    get intrinsicValue(): number {
        return roundCents(this.intrinsic);
    }

    /** Temporary extra drift on the guide price: intensity per step for `steps` steps. */
    applyShock(intensity: number, steps = 10): void {
        this.shock = { intensity, remaining: steps };
    }

    /** Permanently move the fair value by a fraction (0.1 = +10%). */
    shockIntrinsic(fraction: number): void {
        this.intrinsic = Math.max(0.01, this.intrinsic * (1 + fraction));
    }

    /** Random-direction drift of the fair value by `fraction`. */
    driftIntrinsic(fraction: number): void {
        this.shockIntrinsic(this.rng.chance(0.5) ? fraction : -fraction);
    }

    /** Multiply volatility until the returned function is called. */
    boostVolatility(factor: number): () => void {
        const boost = { factor };
        this.volatilityBoosts.add(boost);
        return () => {
            this.volatilityBoosts.delete(boost);
        };
    }

    /** Pull the guide toward an observed trade price (human market impact). */
    absorbTrade(priceDollars: number, weight: number): void {
        this.guide = Math.max(0.01, this.guide + (priceDollars - this.guide) * weight);
    }
}
