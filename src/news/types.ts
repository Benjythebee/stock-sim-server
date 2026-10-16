import type { Market } from "../engine/market";
import type { PriceModel } from "../engine/price-model";
import type { Rng } from "../engine/rng";
import type { Game } from "../game/game";
import type { DynamicText } from "../text";

export type NewsText = DynamicText;

export interface NewsContext<S = unknown> {
    readonly game: Game;
    readonly market: Market;
    readonly model: PriceModel;
    readonly rng: Rng;
    /** Per-publication state from `definition.state()` (headlines are shared by every room). */
    readonly state: S;
    /** Publish another headline right now, e.g. a follow-up when this one ends. */
    publish(news: NewsDefinition): void;
}

/** A headline. Effects (if any) usually move the fair value in onStart. */
export interface NewsDefinition<S extends object = Record<string, never>> {
    title: NewsText;
    description: NewsText;
    /** How long the headline stays "live" in the UI, in game seconds. */
    durationSeconds?: number;
    /**
     * Permanent move of the hidden fair value when published (0.1 = +10%), applied before onStart.
     * Declared as data (rather than inside onStart) so powers can tell what a headline will do.
     */
    fairValueShock?: number;
    /**
     * Alternative versions of the headline. One is rolled when the headline is drawn (before
     * Embargoed Press Release can peek at it) and overrides the fields above, so the wording and
     * the fair-value move always agree: "Consumer confidence plunges" comes with the drop.
     */
    variants?: readonly NewsVariant[];
    /**
     * Fresh state for each publication. Store temporary effects' release functions here (e.g.
     * `model.boostVolatility()`) and call them in onEnd.
     */
    state?: () => S;
    onStart?(ctx: NewsContext<S>): void;
    /** Every game second while live. */
    onTick?(ctx: NewsContext<S>): void;
    /** When the duration runs out. */
    onEnd?(ctx: NewsContext<S>): void;
}

/** One version of a headline with `variants`. Omitted fields come from the headline itself. */
export interface NewsVariant {
    title?: NewsText;
    description?: NewsText;
    fairValueShock?: number;
    /** Relative odds of this version. Defaults to 1. */
    weight?: number;
}

/** A headline that's coming soon, as revealed by NewsManager.upcoming(). */
export interface UpcomingNews {
    news: NewsDefinition;
    /** Game seconds until it's published. */
    inSeconds: number;
}

export function defineNews<S extends object = Record<string, never>>(news: NewsDefinition<S>): NewsDefinition {
    return news as NewsDefinition;
}
