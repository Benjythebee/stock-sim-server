/**
 * The wire protocol. JSON objects `{ type: MessageType, ...fields }` over one WebSocket per player.
 *
 * KEEP IN SYNC with ../stock-sim-ui/src/types/messages.ts (copied by hand). Never renumber an
 * existing type. Ranges: 0-29 core, 30-59 admin, 60-79 lifecycle, 80-89 powers, 99 debug.
 */
import type { PublicGameSettings } from "../game/settings";
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

    ADMIN_SETTINGS = 30,

    GAME_CONCLUSION = 60,

    POWER_OFFERS = 80,
    POWER_SELECT = 81,
    POWER_CONSUME = 82,
    POWER_INVENTORY = 83,

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
export type PowerSelectMessage = { type: MessageType.POWER_SELECT; index: number };
export type PowerConsumeRequest = { type: MessageType.POWER_CONSUME; id: string };

export type ClientMessage =
    | PingMessage
    | TogglePauseRequest
    | StockActionMessage
    | ShockMessage
    | AdminSettingsMessage
    | PowerSelectMessage
    | PowerConsumeRequest;

// ---- server -> client --------------------------------------------------------------------

export type IdMessage = { type: MessageType.ID; id: string };
export type JoinMessage = { type: MessageType.JOIN; roomId: string; id: string; username: string };
export type LeaveMessage = { type: MessageType.LEAVE; roomId: string; id: string };
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
    | ConclusionMessage
    | PowerOffersMessage
    | PowerInventoryMessage
    | ContentManifestMessage
    | DebugPricesMessage;

export type Notification = Omit<NotificationMessage, "type">;
