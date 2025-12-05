import type { PowerDescription, PowerDescriptionProperties } from "./lib/powers/power";
import type { GameSettings } from "./lib/room";



export enum MessageType {
    ID=-1,
    JOIN = 0,
    LEAVE = 1,
    IS_ADMIN=2,
    TOGGLE_PAUSE=3,
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

    ADMIN_SETTINGS = 30,

    GAME_CONCLUSION = 60,

    POWER_OFFERS=80,
    POWER_SELECT=81,
    POWER_CONSUME=82,
    POWER_INVENTORY=83,

    DEBUG_PRICES=99,
}


export const MessageTypeNames: { [key in MessageType]: string } = {
    [MessageType.ID]: "ID",
    [MessageType.JOIN]: "JOIN",
    [MessageType.LEAVE]: "LEAVE",
    [MessageType.IS_ADMIN]: "IS_ADMIN",
    [MessageType.TOGGLE_PAUSE]: "TOGGLE_PAUSE",
    [MessageType.MESSAGE]: "MESSAGE",
    [MessageType.ERROR]: "ERROR",
    [MessageType.PING]: "PING",
    [MessageType.PONG]: "PONG",
    [MessageType.CLOCK]: "CLOCK",
    [MessageType.ROOM_STATE]: "ROOM_STATE",
    [MessageType.STOCK_ACTION]: "STOCK_ACTION",
    [MessageType.STOCK_MOVEMENT]: "STOCK_MOVEMENT",
    [MessageType.PORTFOLIO_UPDATE]: "PORTFOLIO_UPDATE",
    [MessageType.SHOCK]: "SHOCK",
    [MessageType.NEWS]: "NEWS",
    [MessageType.NOTIFICATION]: "NOTIFICATION",
    [MessageType.CLIENT_STATE]: "CLIENT_STATE",
    // Admin Messages - 30
    [MessageType.ADMIN_SETTINGS]: "ADMIN_SETTINGS",

    [MessageType.GAME_CONCLUSION]: "GAME_CONCLUSION",


    [MessageType.POWER_OFFERS]: "POWER_OFFERS",
    [MessageType.POWER_SELECT]: "POWER_SELECT",
    [MessageType.POWER_CONSUME]: "POWER_CONSUME",
    [MessageType.POWER_INVENTORY]: "POWER_INVENTORY",

    [MessageType.DEBUG_PRICES]: "DEBUG_PRICES"
};

type IDMessage = {
    type: MessageType.ID;
    id: string;
}

type JoinMessage = {
    type: MessageType.JOIN;
    roomId: string;
    username: string;
    id: string;
}

type LeaveMessage = {
    type: MessageType.LEAVE;
    roomId: string;
    id: string;
}

type IsAdminMessage = {
    type: MessageType.IS_ADMIN;
}

type NewsMessage = {
    type: MessageType.NEWS;
    title: string;
    timestamp: number;
    description: string;
    durationTicks: number;
}


type IsShockMessage = {
    type: MessageType.SHOCK;
    target: 'intrinsic' | 'market'
}

type ClientStateMessage = {
    type: MessageType.CLIENT_STATE;
    disabled: boolean;
}

type RoomStateMessage = {
    type: MessageType.ROOM_STATE;
    paused: boolean;
    started: boolean;
    ended: boolean;
    settings: GameSettings;
    roomId: string;
    clock: number;
    clients: number;
}

type TogglePauseMessage = {
    type: MessageType.TOGGLE_PAUSE;
}
type PingMessage = {
    type: MessageType.PING;
}

type PongMessage = {
    type: MessageType.PONG;
}

type ChatMessage = {
    type: MessageType.MESSAGE;
    roomId: string;
    id: string;
    content: string;
}

type NotificationMessage = {
    type: MessageType.NOTIFICATION;
    level: 'info' | 'warning' | 'error' | 'success';
    title: string;
    description?: string;
}

type ErrorMessage = {
    type: MessageType.ERROR;
    message: string;
}

type ClockMessage = {
    type: MessageType.CLOCK;
    timeLeft: number;
    value: number;
}
type AdminSettingMessage = {
    type: MessageType.ADMIN_SETTINGS;
    settings: Partial<GameSettings>;
}

type PortfolioUpdateMessage = {
    type: MessageType.PORTFOLIO_UPDATE;
    id: string;
    value: {
        cash: number;
        shares: number;
        pnl?: number;
    };
}

type StockMessage = {
    type: MessageType.STOCK_ACTION;
    action: 'BUY' | 'SELL';
    orderType: 'LIMIT' | 'MARKET';
    quantity: number;
    price: number;
}

type StockMovementMessage = {
    type: MessageType.STOCK_MOVEMENT;
    price: number;
    depth: [[number, number][], [number, number][]]
}

type DebugPricesMessage = {
    type: MessageType.DEBUG_PRICES;
    intrinsicValue: number;
    guidePrice: number;
}
type ConclusionMessage = {
    type: MessageType.GAME_CONCLUSION;
    players: ({ name: string } & PortfolioUpdateMessage['value'])[];
    bots: ({ name: string, type: string } & PortfolioUpdateMessage['value'])[];
    volumeTraded: number;
    highestPrice: number;
    lowestPrice: number;
}


type PowerOffersMessage = {
    type: MessageType.POWER_OFFERS;
    offers: PowerDescriptionProperties[]
}

type PowerSelectedMessage = {
    type: MessageType.POWER_SELECT;
    index: number;
}

type PowerConsumeMessage = {
    type: MessageType.POWER_CONSUME;
    id: string;
    notification:{
        title: string;
        description?: string;
    }
}

type PowerInventoryMessage = {
    type: MessageType.POWER_INVENTORY;
    inventory: string[]
}


export type Message = IDMessage | JoinMessage | LeaveMessage | IsShockMessage | NotificationMessage | NewsMessage |RoomStateMessage | TogglePauseMessage | PortfolioUpdateMessage| IsAdminMessage | AdminSettingMessage | ClockMessage | PingMessage | PongMessage | ChatMessage | ErrorMessage | StockMessage | StockMovementMessage | DebugPricesMessage | ConclusionMessage |
PowerOffersMessage | PowerSelectedMessage | PowerConsumeMessage | PowerInventoryMessage |ClientStateMessage

export type {
    IDMessage,
    JoinMessage,
    LeaveMessage,
    PingMessage,
    RoomStateMessage,
    TogglePauseMessage,
    IsAdminMessage,
    PongMessage,
    ClockMessage,
    ChatMessage,
    NotificationMessage,
    ErrorMessage,
    StockMessage,
    NewsMessage,
    ClientStateMessage,
    AdminSettingMessage,
    PortfolioUpdateMessage,
    StockMovementMessage,
    DebugPricesMessage,
    IsShockMessage,
    PowerOffersMessage,
    PowerSelectedMessage,
    PowerConsumeMessage,
    PowerInventoryMessage,
    ConclusionMessage
}