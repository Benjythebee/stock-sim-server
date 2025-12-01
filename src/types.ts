import type { GameSettings } from "./lib/room";



export enum MessageType {
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
    ADMIN_SETTINGS = 30,
    GAME_CONCLUSION = 60,
    DEBUG_PRICES=99,
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

type IsShockMessage = {
    type: MessageType.SHOCK;
    target: 'intrinsic' | 'market'
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

type ErrorMessage = {
    type: MessageType.ERROR;
    message: string;
}

type ClockMessage = {
    type: MessageType.CLOCK;
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
        pnl: number;
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
    volumeTraded: number;
    highestPrice: number;
    lowestPrice: number;
}



export type Message = JoinMessage | LeaveMessage | IsShockMessage |RoomStateMessage | TogglePauseMessage | PortfolioUpdateMessage| IsAdminMessage | AdminSettingMessage | ClockMessage | PingMessage | PongMessage | ChatMessage | ErrorMessage | StockMessage | StockMovementMessage | DebugPricesMessage | ConclusionMessage;
export type {
    JoinMessage,
    LeaveMessage,
    PingMessage,
    RoomStateMessage,
    TogglePauseMessage,
    IsAdminMessage,
    PongMessage,
    ClockMessage,
    ChatMessage,
    ErrorMessage,
    StockMessage,
    AdminSettingMessage,
    PortfolioUpdateMessage,
    StockMovementMessage,
    DebugPricesMessage,
    IsShockMessage,
    ConclusionMessage
}