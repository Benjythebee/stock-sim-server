import type { ServerConfig } from "../src/config";
import { loadCatalog } from "../src/catalog";
import { BotRegistry } from "../src/bots/registry";
import { Game, type Catalog } from "../src/game/game";
import { Player, RateLimiter } from "../src/game/player";
import type { RoomHost, RoomSocket, SocketData } from "../src/game/room";
import { DEFAULT_SETTINGS, type GameSettings } from "../src/game/settings";
import { PowerRegistry } from "../src/powers/registry";
import type { AnyPowerDefinition } from "../src/powers/types";
import { MessageType, type ServerMessage } from "../src/protocol/messages";

export const builtinCatalog = await loadCatalog();

export function catalogWith(overrides: Partial<{ powers: AnyPowerDefinition[]; bots: Catalog["bots"]; news: Catalog["news"] }> = {}): Catalog {
    return {
        powers: overrides.powers ? new PowerRegistry(overrides.powers) : builtinCatalog.powers,
        bots: overrides.bots ?? builtinCatalog.bots,
        news: overrides.news ?? builtinCatalog.news,
    };
}

export const noBots = new BotRegistry([]);

/** A connection that records every message it receives. */
export class FakeSocket implements RoomSocket {
    readonly received: ServerMessage[] = [];
    readonly topics = new Set<string>();
    closed: { code?: number; reason?: string } | null = null;

    constructor(readonly data: SocketData) {}

    send(data: string) {
        this.received.push(JSON.parse(data));
    }
    close(code?: number, reason?: string) {
        this.closed = { code, reason };
    }
    subscribe(topic: string) {
        this.topics.add(topic);
    }
    unsubscribe(topic: string) {
        this.topics.delete(topic);
    }

    of<T extends MessageType>(type: T): Extract<ServerMessage, { type: T }>[] {
        return this.received.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
    }
    last<T extends MessageType>(type: T): Extract<ServerMessage, { type: T }> | undefined {
        return this.of(type).at(-1);
    }
    clear() {
        this.received.length = 0;
    }
}

export const testConfig: ServerConfig = {
    port: 0,
    hostname: "127.0.0.1",
    corsOrigin: "*",
    reconnectGraceMs: 50,
    orderRate: 1000,
    orderBurst: 1000,
    flushMs: 0,
    powerModDirs: [],
    botModDirs: [],
};

/** RoomHost whose transport delivers publishes to every subscribed FakeSocket. */
export class FakeHost implements RoomHost {
    readonly sockets = new Set<FakeSocket>();
    emptied: string[] = [];

    constructor(
        readonly catalog: Catalog = catalogWith({ bots: noBots }),
        readonly config: ServerConfig = testConfig,
    ) {}

    readonly transport = {
        publish: (topic: string, data: string) => {
            for (const s of this.sockets) if (s.topics.has(topic) && !s.closed) s.send(data);
        },
    };

    socket(roomId: string, username: string, opts: Partial<SocketData> = {}): FakeSocket {
        const s = new FakeSocket({ roomId, username, spectator: false, resume: null, playerId: null, ...opts });
        this.sockets.add(s);
        return s;
    }

    roomEmpty(room: { id: string }) {
        this.emptied.push(room.id);
    }
}

/** A game with collected broadcasts and no timers. */
export function makeGame(settings: Partial<GameSettings> = {}, catalog: Catalog = catalogWith({ bots: noBots })) {
    const broadcasts: ServerMessage[] = [];
    const game = new Game({ ...DEFAULT_SETTINGS, bots: 0, enableRandomNews: false, ...settings }, catalog, {
        broadcast: (m) => broadcasts.push(m),
    }, 1_700_000_000_000);
    return { game, broadcasts };
}

export function makePlayer(name = "alice"): { player: Player; socket: FakeSocket } {
    const socket = new FakeSocket({ roomId: "r", username: name, spectator: false, resume: null, playerId: null });
    const player = new Player(`${name}-id`, name, new RateLimiter(1000, 1000));
    player.connection = socket;
    return { player, socket };
}

/** Advance a game by N whole game seconds. */
export function runSeconds(game: Game, seconds: number) {
    for (let i = 0; i < seconds * 5; i++) game.advance();
}
