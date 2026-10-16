/**
 * The public API for mods. Import it as `@mod` (tsconfig path alias):
 *
 *   import { definePower } from "@mod";
 *
 * Mods should only depend on what's exported here, so internals can change without breaking them.
 */
export { definePower } from "./powers/types";
export type { ActiveEffect, PowerContext, PowerDefinition, PowerTarget, IconCredit, PublicPower } from "./powers/types";
export type { PlayerTrade } from "./game/game";
export type { Presentation, WheelPresentation, WheelSegment } from "./powers/presentation";
export { MOD_API_VERSION } from "./version";

export { defineBot, sharesWorth, referenceCash } from "./bots/types";
export type { BotDefinition, BotStrategy, BotView } from "./bots/types";
export { ceilCents, floorCents, quotePair, momentum } from "./bots/helpers";

export { defineNews } from "./news/types";
export type { NewsContext, NewsDefinition, NewsVariant, UpcomingNews } from "./news/types";

export type { Player } from "./game/player";
export type { Notification } from "./protocol/messages";
export { MAX_VOLATILITY } from "./engine/price-model";
export { toDollars, toTicks } from "./engine/money";
export { resolveText, type DynamicText } from "./text";
