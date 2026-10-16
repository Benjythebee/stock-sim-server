import type { Market } from "../engine/market";
import type { PriceModel } from "../engine/price-model";
import type { Rng } from "../engine/rng";
import type { Game } from "../game/game";
import type { Player } from "../game/player";
import type { NewsDefinition } from "../news/types";
import type { Notification } from "../protocol/messages";
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
    /** Reserved for a future shop. */
    price?: number;
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
    /** Credit (or, negative, debit) a player's available cash, in dollars. Returns the amount applied. */
    giveCash(player: Player, dollars: number): number;
    /** Push a headline to everyone, optionally with market effects. */
    publishNews(news: NewsDefinition): void;
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
