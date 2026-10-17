import type { Market } from "../engine/market";
import type { PriceModel } from "../engine/price-model";
import type { Rng } from "../engine/rng";
import type { Side } from "../engine/order-book";
import type { OrderOutcome } from "../engine/market";
import type { Game, PlayerTrade } from "../game/game";
import type { Player } from "../game/player";
import type { NewsDefinition, UpcomingNews } from "../news/types";
import type { Notification } from "../protocol/messages";
import type { Presentation } from "./presentation";
import type { DynamicText } from "../text";

/**
 * Who a power affects. Informational, for the UI's card styling; the hooks decide what really
 * happens. Values match the wire protocol.
 */
export type PowerTarget = "client" | "others" | "all" | "market";

/** Static text, or text computed from the game (e.g. using the ticker). */
export type PowerText = DynamicText;

export interface PowerDefinition<S extends object = Record<string, never>> {
    /** Unique kebab-case id. Sent to clients and used to consume from the inventory. */
    id: string;
    title: PowerText;
    description: PowerText;
    /**
     * Either an image shipped with the mod, as a path relative to the mod's folder
     * (`"robber-hand.svg"`, `"assets/icon.png"`; svg/png/webp/jpg/gif), served by the game server,
     * or the name of an icon built into the UI (`"stop"` → ../stock-sim-ui/public/powers/stop.svg).
     * Defaults to "default". A file that can't be found falls back to the "missing" icon.
     */
    icon?: string;
    /** Credit for the icon's author, shown by the UI (required by CC-BY icons such as game-icons.net). */
    iconCredit?: IconCredit;
    /** Defaults to "market". */
    type?: PowerTarget;
    /** true: fires the moment it's picked. false (default): goes to the inventory until used. */
    instant?: boolean;
    /** How long the effect lasts, in game seconds. 0 / omitted = one-shot (no onTick/onExpire). */
    durationSeconds?: number;
    /** Relative odds of appearing in a briefcase. Higher = more common. 0 = never offered. */
    weight: number;
    /**
     * The mod API version this power needs (see MOD_API_VERSION in src/version.ts). Defaults to 1.
     * A server with an older API refuses to load it, with a clear error, instead of failing mid-game.
     */
    apiVersion?: number;
    /** Reserved for a future shop. */
    price?: number;
    /**
     * Whether this game can offer it at all, e.g. `(game) => game.settings.enableBorrowing` for a
     * power about bank loans. Checked when the game is set up and when briefcases open. Omitted =
     * always. Needs `apiVersion: 3`.
     */
    available?(game: Game): boolean;
    /** Fresh per-activation state. Called once each time the power is activated. */
    state?: () => S;

    /** Runs when the power is used. */
    onActivate?(ctx: PowerContext<S>): void;
    /** Runs every game second while active (durationSeconds > 0). */
    onTick?(ctx: PowerContext<S>): void;
    /** Runs once when the duration runs out. Undo temporary effects here. */
    onExpire?(ctx: PowerContext<S>): void;
}

/** Everything a power hook can touch. */
export interface PowerContext<S> {
    /** The resolved public description (title/description already evaluated). */
    readonly power: PublicPower;
    /** Who used the power. */
    readonly player: Player;
    /** Per-activation state from `definition.state()`. */
    readonly state: S;
    readonly game: Game;
    readonly market: Market;
    readonly model: PriceModel;
    /** Seeded generator for this activation. Never use Math.random() in gameplay code. */
    readonly rng: Rng;
    /** Whole game seconds left on this effect (0 for one-shots). */
    readonly secondsLeft: number;
    /** All human players in the game. */
    readonly players: Player[];
    /** All human players except the initiator. */
    readonly others: Player[];

    notify(to: Player | Player[], notification: Notification): void;
    notifyAll(notification: Notification): void;
    /**
     * Play an animation (e.g. a prize wheel) on these players' screens. Decide the outcome first and
     * report it with a notification once the animation is over: UIs that predate the kind skip it.
     * Throws on an invalid presentation. Needs `apiVersion: 2`.
     */
    present(to: Player | Player[], presentation: Presentation): void;
    /** Credit (or, negative, debit) a player's available cash, in dollars. Returns the amount applied. */
    giveCash(player: Player, dollars: number): number;
    /** Push a headline to everyone, optionally with market effects. */
    publishNews(news: NewsDefinition): void;
    /**
     * Peek at the next random headline and bring it forward so it's published within
     * `withinSeconds`. Null if there are no headlines to draw from.
     */
    upcomingNews(withinSeconds: number): UpcomingNews | null;
    /**
     * Listen to human players' trades (see Game.onPlayerTrade). Delivered after matching, so the
     * listener may trade. Unsubscribed automatically when the effect expires.
     */
    onPlayerTrade(listener: (trade: PlayerTrade) => void): void;
    /** A market order on a player's behalf, recorded in their order history. */
    marketOrder(player: Player, side: Side, qty: number): OrderOutcome;
    /** A rogue trader sweeps the bids down to `maxDrop` below the mark (see Game.dumpShares). */
    dumpShares(maxDrop: number): { sold: number; lowPrice: number | null };
    /** Power effects active right now (other activations included), e.g. to find who is spying on you. */
    activeEffects(): readonly ActiveEffect[];
}

/** A running (duration) power, as seen by other powers. */
export interface ActiveEffect {
    powerId: string;
    player: Player;
    /** That activation's state (shape defined by the power). */
    state: unknown;
    secondsLeft: number;
}

export interface IconCredit {
    author: string;
    url?: string;
    license?: string;
}

/** Wire format, as served by /api/powers.json, CONTENT_MANIFEST and POWER_OFFERS. Field names are the UI's. */
export interface PublicPower {
    id: string;
    title: string;
    description: string;
    type: PowerTarget;
    /** Built-in UI icon name (used when `iconUrl` is absent). "missing" when a mod's image wasn't found. */
    iconSlug: string;
    /** Server-relative URL of the mod's own icon, e.g. "/assets/powers/siphon/robber-hand.svg". */
    iconUrl?: string;
    iconCredit?: IconCredit;
    isInstant: boolean;
    /** Same as `weight`: lower = rarer. */
    rarity: number;
    price?: number;
    durationTicks: number;
}

export function definePower<S extends object = Record<string, never>>(definition: PowerDefinition<S>): PowerDefinition<S> {
    return definition;
}

export type AnyPowerDefinition = PowerDefinition<any>;
