/**
 * The wire protocol. JSON objects `{ type: MessageType, ...fields }` over one WebSocket per player.
 *
 * KEEP IN SYNC with ../stock-sim-ui/src/types/messages.ts (copied by hand). Never renumber an
 * existing type. Ranges: 0-29 core, 30-59 admin, 60-79 lifecycle, 80-89 powers, 99 debug.
 */
import type { PublicGameSettings } from "../game/settings";
import type { Presentation } from "../powers/presentation";
import type { PublicPower } from "../powers/types";

export enum MessageType {
    ID = -1,
    JOIN = 0,
    LEAVE = 1,
    IS_ADMIN = 2,
    TOGGLE_PAUSE = 3,
    MESSAGE = 4,
    ERROR = 5,
    PING = 6,
    PONG = 7,
    CLOCK = 8,
    ROOM_STATE = 9,
    STOCK_ACTION = 10,
    STOCK_MOVEMENT = 11,
    PORTFOLIO_UPDATE = 12,
    SHOCK = 13,
    NEWS = 14,
    NOTIFICATION = 15,
    CLIENT_STATE = 16,
    ORDER_BOOK_UPDATE = 17,
    CONTENT_MANIFEST = 18,
    ORDER_UPDATE = 19,
    ORDER_CANCEL = 20,
    RENAME = 21,
    PLAYERS = 22,

    ADMIN_SETTINGS = 30,
    RESET_GAME = 31,

    GAME_CONCLUSION = 60,

    POWER_OFFERS = 80,
    POWER_SELECT = 81,
    POWER_CONSUME = 82,
    POWER_INVENTORY = 83,
    POWER_PRESENT = 84,

    DEBUG_PRICES = 99,
}

export const MessageTypeNames: Record<MessageType, string> = Object.fromEntries(
    Object.entries(MessageType)
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => [v, k]),
) as Record<MessageType, string>;

export type NotificationLevel = "info" | "warning" | "error" | "success";
export type Depth = [asks: [price: number, qty: number][], bids: [price: number, qty: number][]];

export interface Portfolio {
    cash: number;
    shares: number;
    pnl: number;
    reservedCash: number;
    reservedShares: number;
}

/** "partial": a market order that couldn't fill completely (the rest was dropped, IOC). */
export type OrderStatus = "open" | "filled" | "partial" | "cancelled";

/** One of the player's own orders, as shown in "Current orders" (open) and "Order history" (the rest). */
export interface OrderInfo {
    /** Unique per player and game. */
    id: number;
    action: "BUY" | "SELL";
    orderType: "LIMIT" | "MARKET";
    /** Limit price in dollars; null for market orders. */
    price: number | null;
    quantity: number;
    filled: number;
    /** Average execution price in dollars; null until something fills. */
    avgPrice: number | null;
    status: OrderStatus;
    /** Game clock (epoch ms) when the order was placed, and when it last changed. */
    time: number;
    updated: number;
}

// ---- client -> server --------------------------------------------------------------------

export type PingMessage = { type: MessageType.PING };
export type TogglePauseRequest = { type: MessageType.TOGGLE_PAUSE };
export type StockActionMessage = {
    type: MessageType.STOCK_ACTION;
    action: "BUY" | "SELL";
    orderType: "LIMIT" | "MARKET";
    quantity: number;
    price: number;
};
export type ShockMessage = { type: MessageType.SHOCK; target: "intrinsic" | "market" };
export type AdminSettingsMessage = { type: MessageType.ADMIN_SETTINGS; settings: Record<string, unknown> };
/** Host only, after the game ended: back to the lobby with the same settings (and a new seed). */
export type ResetGameRequest = { type: MessageType.RESET_GAME };
/** Index into the current offers, or POWER_SKIP_INDEX (-1) to decline the whole briefcase. */
export type PowerSelectMessage = { type: MessageType.POWER_SELECT; index: number };
export const POWER_SKIP_INDEX = -1;
export type PowerConsumeRequest = { type: MessageType.POWER_CONSUME; id: string };
/** Cancel one of your open orders by OrderInfo.id, or all of them with ORDER_CANCEL_ALL (-1). */
export type OrderCancelRequest = { type: MessageType.ORDER_CANCEL; id: number };
export const ORDER_CANCEL_ALL = -1;
/** Change your display name (any phase). `username` is already cleaned by the parser (see cleanName). */
export type RenameRequest = { type: MessageType.RENAME; username: string };

export type ClientMessage =
    | PingMessage
    | TogglePauseRequest
    | StockActionMessage
    | ShockMessage
    | AdminSettingsMessage
    | ResetGameRequest
    | PowerSelectMessage
    | PowerConsumeRequest
    | OrderCancelRequest
    | RenameRequest;

// ---- server -> client --------------------------------------------------------------------

/** `id` is `<roomId>-<resumeToken>`: the seat's secret, sent back as `prevSessionData` to resume it. */
export type IdMessage = { type: MessageType.ID; id: string };
/** Broadcasts carry no player id: nothing on the client needs one. */
export type JoinMessage = { type: MessageType.JOIN; roomId: string; username: string };
export type LeaveMessage = { type: MessageType.LEAVE; roomId: string };
/** One human in the room. No id on purpose (see JoinMessage). */
export interface PlayerInfo {
    name: string;
    /** False while their seat is held for a reconnect. */
    connected: boolean;
    host: boolean;
}
/** Everyone in the room, re-sent whole on any change (join, leave, rename, new host). `you` is the recipient's index, -1 for spectators. */
export type PlayersMessage = { type: MessageType.PLAYERS; players: PlayerInfo[]; you: number };
export type IsAdminMessage = { type: MessageType.IS_ADMIN };
/** `paused` is the new absolute state; clients must set it rather than toggle. */
export type TogglePauseMessage = { type: MessageType.TOGGLE_PAUSE; paused: boolean };
export type ErrorMessage = { type: MessageType.ERROR; message: string };
export type PongMessage = { type: MessageType.PONG };
/** `value`: game clock as epoch ms (advances 1000 per game second). `timeLeft`: ms. */
export type ClockMessage = { type: MessageType.CLOCK; value: number; timeLeft: number };
export type RoomStateMessage = {
    type: MessageType.ROOM_STATE;
    paused: boolean;
    started: boolean;
    ended: boolean;
    settings: PublicGameSettings;
    roomId: string;
    clock: number;
    clients: number;
    price: number;
};
export type StockMovementMessage = { type: MessageType.STOCK_MOVEMENT; price: number };
export type PortfolioUpdateMessage = { type: MessageType.PORTFOLIO_UPDATE; id: string; value: Portfolio };
export type NewsMessage = {
    type: MessageType.NEWS;
    title: string;
    description: string;
    timestamp: number;
    durationTicks: number;
};
export type NotificationMessage = {
    type: MessageType.NOTIFICATION;
    level: NotificationLevel;
    title: string;
    description?: string;
};
export type ClientStateMessage = { type: MessageType.CLIENT_STATE; tradingDisabled: boolean };
export type OrderBookUpdateMessage = { type: MessageType.ORDER_BOOK_UPDATE; depth: Depth };
/**
 * Private. The player's orders that changed, to upsert by id (status "open" = current orders).
 * `reset: true` carries the full list (open + recent history) and replaces what the client has.
 */
export type OrderUpdateMessage = { type: MessageType.ORDER_UPDATE; orders: OrderInfo[]; reset: boolean };
export type ConclusionEntry = { name: string } & Portfolio;
export type ConclusionMessage = {
    type: MessageType.GAME_CONCLUSION;
    players: ConclusionEntry[];
    bots: (ConclusionEntry & { type: string })[];
    volumeTraded: number;
    highestPrice: number;
    lowestPrice: number;
};
export type PowerOffersMessage = { type: MessageType.POWER_OFFERS; offers: PublicPower[] };
export type PowerInventoryMessage = { type: MessageType.POWER_INVENTORY; inventory: string[] };
/**
 * Private. Play an animation for a power (a prize wheel, ...). The outcome is already decided; the
 * power reports it with a normal NOTIFICATION once the animation is over. UIs that don't know the
 * `presentation.kind` ignore it.
 */
export type PowerPresentMessage = { type: MessageType.POWER_PRESENT; powerId: string; title: string; presentation: Presentation };
/** Only sent when settings.revealPrices is on. */
/**
 * Sent right after connecting: every installed power (built-ins + mods) and the server-hosted
 * assets (mod icons, ...) the client should preload. URLs are relative to the server origin.
 */
export type ContentManifestMessage = { type: MessageType.CONTENT_MANIFEST; powers: PublicPower[]; assets: string[] };
export type DebugPricesMessage = { type: MessageType.DEBUG_PRICES; intrinsicValue: number; guidePrice: number };

export type ServerMessage =
    | IdMessage
    | JoinMessage
    | LeaveMessage
    | PlayersMessage
    | IsAdminMessage
    | TogglePauseMessage
    | ErrorMessage
    | PongMessage
    | ClockMessage
    | RoomStateMessage
    | StockMovementMessage
    | PortfolioUpdateMessage
    | NewsMessage
    | NotificationMessage
    | ClientStateMessage
    | OrderBookUpdateMessage
    | OrderUpdateMessage
    | ConclusionMessage
    | PowerOffersMessage
    | PowerInventoryMessage
    | ContentManifestMessage
    | PowerPresentMessage
    | DebugPricesMessage;

export type Notification = Omit<NotificationMessage, "type">;
