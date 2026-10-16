import type { Market } from "../engine/market";
import type { PriceModel } from "../engine/price-model";
import type { Rng } from "../engine/rng";
import type { Game } from "../game/game";
import type { DynamicText } from "../text";

export type NewsText = DynamicText;

export interface NewsContext {
    readonly game: Game;
    readonly market: Market;
    readonly model: PriceModel;
    readonly rng: Rng;
}

/** A headline. Effects (if any) usually move the fair value in onStart. */
export interface NewsDefinition {
    title: NewsText;
    description: NewsText;
    /** How long the headline stays "live" in the UI, in game seconds. */
    durationSeconds?: number;
    onStart?(ctx: NewsContext): void;
    /** Every game second while live. */
    onTick?(ctx: NewsContext): void;
    onEnd?(ctx: NewsContext): void;
}

export function defineNews(news: NewsDefinition): NewsDefinition {
    return news;
}
