import type { ServerConfig } from "../config";
import type { OrderRejection } from "../engine/market";
import { log } from "../log";
import { MessageType, POWER_SKIP_INDEX, type ClientMessage, type Notification, type ServerMessage } from "../protocol/messages";
import { Game, type Catalog } from "./game";
import { Player, RateLimiter, type Connection } from "./player";
import { applySettingsUpdate, DEFAULT_SETTINGS, type GameSettings } from "./settings";

export interface SocketData {
    roomId: string;
    username: string;
    spectator: boolean;
    /** Player id to resume (from the `prevSessionData` query param). */
    resume: string | null;
    /** Set once the socket is attached to a player. */
    playerId: string | null;
}

/** The parts of Bun's ServerWebSocket the room uses. */
export interface RoomSocket extends Connection {
    readonly data: SocketData;
    subscribe(topic: string): void;
    unsubscribe(topic: string): void;
}

/** Room-wide fan-out (Bun pub/sub: the payload is serialized once for every subscriber). */
export interface Transport {
    publish(topic: string, data: string): unknown;
}

export type RoomPhase = "lobby" | "running" | "paused" | "ended";

export interface RoomHost {
    readonly catalog: Catalog;
    readonly config: ServerConfig;
    readonly transport: Transport;
    /** Called when the last player is gone for good. */
    roomEmpty(room: Room): void;
}

const REJECTION_TEXT: Record<OrderRejection, string> = {
    "trading-disabled": "Your trading is disabled right now.",
    "invalid-quantity": "Quantity must be a whole number of shares.",
    "invalid-price": "That price is not valid.",
    "insufficient-cash": "Not enough cash for that order.",
    "insufficient-shares": "Not enough shares for that order.",
    "no-liquidity": "Nobody is on the other side of the book right now.",
    "unknown-account": "You are not part of this game.",
};

/**
 * A lobby + its current game. Owns membership (players, spectators, admin), lifecycle
 * (lobby, running, paused, ended) and the network side. Game logic lives in Game.
 */
export class Room {
    readonly players = new Map<string, Player>();
    readonly spectators = new Set<RoomSocket>();
    adminId: string | null = null;
    phase: RoomPhase = "lobby";
    settings: GameSettings;
    game: Game;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;

    constructor(
        readonly id: string,
        private readonly host: RoomHost,
        settings: Partial<GameSettings> = {},
    ) {
        this.settings = { ...DEFAULT_SETTINGS, seed: Math.floor(Math.random() * 100_000), ...settings };
        this.game = this.createGame();
    }

    get started(): boolean {
        return this.phase !== "lobby";
    }

    get paused(): boolean {
        return this.phase !== "running";
    }

    // ---- membership --------------------------------------------------------------------

    /** Attach a player socket: resumes the seat in `socket.data.resume` if it exists. */
    join(socket: RoomSocket): Player {
        const resumeId = socket.data.resume;
        let player = resumeId ? this.players.get(resumeId) : undefined;

        if (player) {
            const previous = player.connection as RoomSocket | null;
            if (previous && previous !== socket) {
                // Detach the old socket quietly: no more room traffic, and its eventual close event
                // is ignored. Don't close it: the UI reconnects whenever a socket closes, so closing
                // here would start a reconnect ping-pong between two tabs (or React StrictMode).
                previous.data.playerId = null;
                previous.unsubscribe(this.id);
            }
            if (player.removalTimer) clearTimeout(player.removalTimer);
            player.removalTimer = null;
            player.disconnectedAt = null;
            if (socket.data.username) player.name = socket.data.username;
        } else {
            player = new Player(crypto.randomUUID(), socket.data.username, new RateLimiter(this.host.config.orderBurst, this.host.config.orderRate));
            this.players.set(player.id, player);
            this.game.addPlayer(player);
            // Others hear about the newcomer; the newcomer isn't subscribed yet, so doesn't.
            this.broadcast({ type: MessageType.JOIN, roomId: this.id, id: player.id, username: player.name });
        }

        player.connection = socket;
        socket.data.playerId = player.id;
        if (!this.adminId) this.adminId = player.id;
        socket.subscribe(this.id);
        this.sendWelcome(player);
        return player;
    }

    spectate(socket: RoomSocket): void {
        this.spectators.add(socket);
        socket.subscribe(this.id);
        socket.send(JSON.stringify(this.contentManifest()));
        socket.send(JSON.stringify(this.roomState()));
        socket.send(this.game.depthMessageJson());
        // Late spectators of a finished game still get the leaderboard.
        if (this.game.result) socket.send(JSON.stringify(this.game.result));
    }

    /** Socket closed. Players keep their seat for the reconnect grace period. */
    disconnect(socket: RoomSocket): void {
        if (socket.data.spectator) {
            this.spectators.delete(socket);
            return;
        }
        const player = socket.data.playerId ? this.players.get(socket.data.playerId) : undefined;
        if (!player || player.connection !== socket) return;
        player.connection = null;
        player.disconnectedAt = Date.now();
        player.removalTimer = setTimeout(() => this.remove(player), this.host.config.reconnectGraceMs);
    }

    remove(player: Player): void {
        if (player.removalTimer) clearTimeout(player.removalTimer);
        player.removalTimer = null;
        if (!this.players.delete(player.id)) return;
        this.game.removePlayer(player);
        this.broadcast({ type: MessageType.LEAVE, roomId: this.id, id: player.id });

        if (this.adminId === player.id) {
            const next = [...this.players.values()].find((p) => p.connected) ?? this.players.values().next().value;
            this.adminId = next?.id ?? null;
            next?.send({ type: MessageType.IS_ADMIN });
        }
        if (this.players.size === 0) this.host.roomEmpty(this);
    }

    // ---- messages ----------------------------------------------------------------------

    handle(socket: RoomSocket, msg: ClientMessage): void {
        const player = socket.data.playerId ? this.players.get(socket.data.playerId) : undefined;
        if (!player) return; // spectators can only ping (handled by the server)

        switch (msg.type) {
            case MessageType.STOCK_ACTION: {
                if (this.phase !== "running") return this.tell(player, "warning", "Market closed", "Orders open when the game is running.");
                if (!player.orderLimiter.take()) {
                    const now = Date.now();
                    if (now - player.rateLimitedNotified > 2000) {
                        player.rateLimitedNotified = now;
                        this.tell(player, "warning", "Slow down", "Too many orders; some were dropped.");
                    }
                    return;
                }
                const outcome = this.game.placeOrder(player, msg);
                if (!outcome.ok) this.tell(player, "error", "Order rejected", REJECTION_TEXT[outcome.reason]);
                this.scheduleFlush();
                return;
            }
            case MessageType.ORDER_CANCEL:
                if (this.phase !== "running") return this.tell(player, "warning", "Market closed", "Orders can only be cancelled while the game is running.");
                if (player.account.tradingDisabled) return this.tell(player, "error", "Cancel rejected", REJECTION_TEXT["trading-disabled"]);
                if (!player.orderLimiter.take()) return;
                if (this.game.cancelOrder(player, msg.id) > 0) this.scheduleFlush();
                return;
            case MessageType.POWER_SELECT:
                if (msg.index === POWER_SKIP_INDEX) {
                    this.game.powers.decline(player);
                    return;
                }
                if (this.phase === "ended") return;
                if (this.game.powers.select(player, msg.index)) this.scheduleFlush();
                return;
            case MessageType.POWER_CONSUME:
                if (this.phase !== "running") return this.tell(player, "warning", "Not now", "Powers can only be used while the game is running.");
                if (this.game.powers.consume(player, msg.id)) this.scheduleFlush();
                return;
        }

        if (player.id !== this.adminId) return this.tell(player, "error", "Host only", "Only the host can do that.");

        switch (msg.type) {
            case MessageType.TOGGLE_PAUSE:
                return this.togglePause();
            case MessageType.ADMIN_SETTINGS:
                return this.updateSettings(player, msg.settings);
            case MessageType.SHOCK:
                if (this.phase !== "running") return;
                if (msg.target === "intrinsic") this.game.model.shockIntrinsic(this.game.rng.signed() * 0.8);
                else this.game.model.applyShock(this.game.rng.signed() * 0.5);
                return;
        }
    }

    togglePause(): void {
        if (this.phase === "ended") return;
        this.phase = this.phase === "running" ? "paused" : "running";
        this.broadcast({ type: MessageType.TOGGLE_PAUSE, paused: this.paused });
        log.info(`[${this.id}] ${this.phase}`);
    }

    updateSettings(admin: Player, update: Record<string, unknown>): void {
        if (this.phase !== "lobby") return this.tell(admin, "error", "Game in progress", "Settings can only be changed before the game starts.");
        this.settings = applySettingsUpdate(this.settings, update, this.host.catalog.bots.enabledIds());
        this.game.dispose();
        this.game = this.createGame();
        for (const player of this.players.values()) {
            this.game.addPlayer(player);
        }
        const state = JSON.stringify(this.roomState());
        const depth = this.game.depthMessageJson();
        for (const player of this.players.values()) {
            player.sendRaw(state);
            player.sendRaw(depth);
        }
        for (const s of this.spectators) s.send(state);
        this.game.flush(); // fresh accounts are dirty: sends everyone's reset portfolio
    }

    // ---- loop & output -----------------------------------------------------------------

    /** Called every STEP_MS by the room manager. */
    tick(): void {
        if (this.phase !== "running") return;
        this.game.advance();
        if (this.game.ended) {
            this.phase = "ended";
            log.info(`[${this.id}] game over`);
        }
    }

    broadcast(message: ServerMessage): void {
        if (!this.disposed) this.host.transport.publish(this.id, JSON.stringify(message));
    }

    /** Coalesce bursts of player activity into one price/depth/portfolio push. */
    scheduleFlush(): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            if (!this.disposed) this.game.flush();
        }, this.host.config.flushMs);
    }

    roomState(): ServerMessage {
        return {
            type: MessageType.ROOM_STATE,
            paused: this.paused,
            started: this.started,
            ended: this.phase === "ended",
            settings: this.settings,
            roomId: this.id,
            clock: this.game.clock,
            clients: this.players.size,
            price: this.game.market.price,
        };
    }

    /** Installed content (all powers incl. mods) and the assets the client should preload. */
    contentManifest(): ServerMessage {
        const powers = this.host.catalog.powers;
        return { type: MessageType.CONTENT_MANIFEST, powers: powers.publicList(this.settings.ticketName), assets: [...powers.assets.keys()] };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.flushTimer) clearTimeout(this.flushTimer);
        for (const player of this.players.values()) {
            if (player.removalTimer) clearTimeout(player.removalTimer);
            player.connection?.close(1001, "Room closed");
        }
        for (const s of this.spectators) s.close(1001, "Room closed");
        this.players.clear();
        this.spectators.clear();
        this.game.dispose();
    }

    private createGame(): Game {
        return new Game(this.settings, this.host.catalog, this);
    }

    /** Everything a (re)joining player needs, in the order the UI expects. */
    private sendWelcome(player: Player): void {
        player.send({ type: MessageType.ID, id: `${this.id}-${player.id}` });
        player.send(this.contentManifest());
        if (player.id === this.adminId) player.send({ type: MessageType.IS_ADMIN });
        player.send(this.roomState());
        player.sendRaw(this.game.depthMessageJson());
        // ROOM_STATE makes the UI assume starting cash, so the real portfolio must follow it.
        player.account.dirty = false;
        player.send({ type: MessageType.PORTFOLIO_UPDATE, id: player.id, value: player.portfolio(this.game.market.markTicks) });
        player.orders.requestReset();
        const orders = player.orders.takeUpdate();
        if (orders) player.send({ type: MessageType.ORDER_UPDATE, ...orders });
        player.sendTradingState();
        this.game.powers.sendState(player);
        // GAME_CONCLUSION is broadcast once; anyone (re)joining a finished game needs it again.
        if (this.game.result) player.send(this.game.result);
    }

    private tell(player: Player, level: Notification["level"], title: string, description: string): void {
        player.send({ type: MessageType.NOTIFICATION, level, title, description });
    }
}
