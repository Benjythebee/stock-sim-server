import { describe, expect, test } from "bun:test";
import { Room } from "../../src/game/room";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, FakeHost, testConfig } from "../helpers";

const builtinPower = (id: string) => builtinCatalog.powers.get(id)!;

function lobby(config = testConfig) {
    const host = new FakeHost(undefined, config);
    const room = new Room("r1", host, { seed: 1 });
    const join = (name: string, resume: string | null = null) => {
        const socket = host.socket("r1", name, { resume });
        const player = room.join(socket);
        return { socket, player };
    };
    return { host, room, join };
}

const buy = (price: number, quantity = 1) => ({ type: MessageType.STOCK_ACTION, action: "BUY", orderType: "LIMIT", quantity, price }) as const;

describe("Room: joining", () => {
    test("first player is admin and gets the welcome sequence in order", () => {
        const { join } = lobby();
        const { socket, player } = join("alice");
        expect(socket.received.map((m) => m.type)).toEqual([
            MessageType.ID,
            MessageType.CONTENT_MANIFEST,
            MessageType.IS_ADMIN,
            MessageType.ROOM_STATE,
            MessageType.ORDER_BOOK_UPDATE,
            MessageType.PORTFOLIO_UPDATE,
            MessageType.CLIENT_STATE,
            MessageType.POWER_INVENTORY,
        ]);
        expect(socket.last(MessageType.ID)!.id).toBe(`r1-${player.id}`);
        expect(socket.last(MessageType.ROOM_STATE)).toMatchObject({ paused: true, started: false, ended: false, clients: 1, roomId: "r1" });
        expect(socket.last(MessageType.PORTFOLIO_UPDATE)!.value.cash).toBe(10_000);
    });

    test("the content manifest lists every installed power (incl. mods) and the assets to preload", () => {
        const { join } = lobby();
        const manifest = join("alice").socket.last(MessageType.CONTENT_MANIFEST)!;
        const ids = manifest.powers.map((p) => p.id);
        expect(ids).toContain("volatility-storm");
        expect(ids).toContain("siphon");
        expect(manifest.assets).toContain("/assets/powers/siphon/robber-hand.svg");
        expect(manifest.powers.find((p) => p.id === "siphon")!.iconUrl).toBe("/assets/powers/siphon/robber-hand.svg");
    });

    test("others hear JOIN; the second player is not admin", () => {
        const { join } = lobby();
        const a = join("alice");
        const b = join("bob");
        expect(a.socket.last(MessageType.JOIN)).toMatchObject({ username: "bob", id: b.player.id });
        expect(b.socket.of(MessageType.JOIN)).toHaveLength(0);
        expect(b.socket.of(MessageType.IS_ADMIN)).toHaveLength(0);
    });

    test("reconnecting with the session id resumes the seat without a JOIN broadcast", () => {
        const { room, join } = lobby();
        const a = join("alice");
        const b = join("bob");
        room.disconnect(a.socket);
        expect(a.player.connected).toBe(false);
        b.socket.clear();
        const again = join("alice", a.player.id);
        expect(again.player).toBe(a.player);
        expect(b.socket.of(MessageType.JOIN)).toHaveLength(0);
        expect(again.socket.of(MessageType.IS_ADMIN)).toHaveLength(1);
        expect(room.players.size).toBe(2);
    });

    test("resuming from a second tab detaches (without closing) the old socket, whose close is then ignored", () => {
        const { room, join } = lobby();
        const a = join("alice");
        const tab2 = join("alice", a.player.id);
        expect(a.socket.closed).toBeNull();
        expect(a.socket.topics.has("r1")).toBe(false);
        room.disconnect(a.socket);
        expect(tab2.player.connected).toBe(true);
        expect(tab2.player.connection).toBe(tab2.socket);
    });

    test("an unknown session id just creates a new player", () => {
        const { room, join } = lobby();
        join("alice");
        join("mallory", "not-a-real-id");
        expect(room.players.size).toBe(2);
    });

    test("after the grace period the player is removed, admin passes on, empty room is released", async () => {
        const { host, room, join } = lobby();
        const a = join("alice");
        const b = join("bob");
        room.disconnect(a.socket);
        await Bun.sleep(testConfig.reconnectGraceMs + 30);
        expect(room.players.has(a.player.id)).toBe(false);
        expect(room.adminId).toBe(b.player.id);
        expect(b.socket.of(MessageType.IS_ADMIN)).toHaveLength(1);
        expect(b.socket.last(MessageType.LEAVE)!.id).toBe(a.player.id);
        room.disconnect(b.socket);
        await Bun.sleep(testConfig.reconnectGraceMs + 30);
        expect(host.emptied).toEqual(["r1"]);
    });

    test("spectators get state and broadcasts but can't act", () => {
        const { host, room, join } = lobby();
        const a = join("alice");
        const spec = host.socket("r1", "watcher", { spectator: true });
        room.spectate(spec);
        expect(spec.last(MessageType.ROOM_STATE)).toBeDefined();
        expect(spec.last(MessageType.CONTENT_MANIFEST)).toBeDefined();
        room.handle(spec, { type: MessageType.TOGGLE_PAUSE });
        expect(room.phase).toBe("lobby");
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        expect(spec.last(MessageType.TOGGLE_PAUSE)).toEqual({ type: MessageType.TOGGLE_PAUSE, paused: false });
    });
});

describe("Room: lifecycle", () => {
    test("TOGGLE_PAUSE broadcasts the absolute state exactly once to everyone", () => {
        const { room, join } = lobby();
        const a = join("alice");
        const b = join("bob");
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        expect(room.phase).toBe("running");
        expect(a.socket.of(MessageType.TOGGLE_PAUSE)).toEqual([{ type: MessageType.TOGGLE_PAUSE, paused: false }]);
        expect(b.socket.of(MessageType.TOGGLE_PAUSE)).toEqual([{ type: MessageType.TOGGLE_PAUSE, paused: false }]);
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        expect(room.phase).toBe("paused");
        expect(b.socket.last(MessageType.TOGGLE_PAUSE)!.paused).toBe(true);
    });

    test("only the admin can pause, shock or change settings", () => {
        const { room, join } = lobby();
        join("alice");
        const b = join("bob");
        room.handle(b.socket, { type: MessageType.TOGGLE_PAUSE });
        room.handle(b.socket, { type: MessageType.ADMIN_SETTINGS, settings: { bots: 9 } });
        expect(room.phase).toBe("lobby");
        expect(room.settings.bots).not.toBe(9);
        expect(b.socket.last(MessageType.NOTIFICATION)).toMatchObject({ level: "error", title: "Host only" });
    });

    test("lobby settings rebuild the game and reset every portfolio", () => {
        const { room, join } = lobby();
        const a = join("alice");
        const b = join("bob");
        b.socket.clear();
        room.handle(a.socket, { type: MessageType.ADMIN_SETTINGS, settings: { startingCash: 2_500, marketVolatility: 10 } });
        expect(room.settings.startingCash).toBe(2_500);
        expect(room.settings.marketVolatility).toBeCloseTo(0.1);
        expect(b.socket.last(MessageType.ROOM_STATE)!.settings.startingCash).toBe(2_500);
        expect(b.socket.last(MessageType.PORTFOLIO_UPDATE)!.value.cash).toBe(2_500);
        expect(room.game.players()).toHaveLength(2);
    });

    test("settings are locked once the game has started", () => {
        const { room, join } = lobby();
        const a = join("alice");
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE }); // paused mid-game
        const game = room.game;
        room.handle(a.socket, { type: MessageType.ADMIN_SETTINGS, settings: { bots: 3 } });
        expect(room.game).toBe(game);
        expect(a.socket.last(MessageType.NOTIFICATION)).toMatchObject({ title: "Game in progress" });
    });

    test("the game only advances while running and the room ends with the game", () => {
        const { room, join } = lobby();
        const a = join("alice");
        room.handle(a.socket, { type: MessageType.ADMIN_SETTINGS, settings: { gameDuration: 1 } });
        room.tick();
        expect(room.game.step).toBe(0);
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        for (let i = 0; i < 300; i++) room.tick();
        expect(room.phase).toBe("ended");
        expect(a.socket.of(MessageType.GAME_CONCLUSION)).toHaveLength(1);
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        expect(room.phase).toBe("ended");
    });

    test("briefcases, power use and news never pause the game", () => {
        const { room, join } = lobby();
        const a = join("alice");
        const b = join("bob");
        room.handle(a.socket, { type: MessageType.ADMIN_SETTINGS, settings: { enableRandomNews: true } });
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        a.socket.clear();
        b.socket.clear();

        // Play through a whole minute: random news and the first briefcases arrive on their own.
        for (let i = 0; i < 5 * 60; i++) room.tick();
        expect(b.socket.of(MessageType.NEWS).length).toBeGreaterThan(0);
        expect(b.socket.of(MessageType.POWER_OFFERS).length).toBeGreaterThan(0);

        // Both players pick and use whatever they were offered, including a duration power.
        room.game.powers.activate(builtinPower("volatility-storm"), b.player);
        for (const p of [a, b]) {
            room.handle(p.socket, { type: MessageType.POWER_SELECT, index: 0 });
            for (const id of room.game.powers.inventoryIds(p.player)) room.handle(p.socket, { type: MessageType.POWER_CONSUME, id });
        }
        const step = room.game.step;
        for (let i = 0; i < 5 * 30; i++) room.tick();

        expect(room.phase).toBe("running");
        expect(room.game.step).toBe(step + 150);
        expect(a.socket.of(MessageType.TOGGLE_PAUSE)).toHaveLength(0);
        expect(b.socket.of(MessageType.TOGGLE_PAUSE)).toHaveLength(0);
    });
});

describe("Room: trading", () => {
    test("orders are refused unless the game is running", () => {
        const { room, join } = lobby();
        const a = join("alice");
        room.handle(a.socket, buy(1));
        expect(room.game.market.book.size).toBe(0);
        expect(a.socket.last(MessageType.NOTIFICATION)).toMatchObject({ title: "Market closed" });
    });

    test("orders while running hit the book; rejections are explained", async () => {
        const { room, join } = lobby();
        const a = join("alice");
        room.handle(a.socket, { type: MessageType.ADMIN_SETTINGS, settings: { houseLiquidity: false } });
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        room.handle(a.socket, buy(0.5, 10));
        expect(room.game.market.book.size).toBe(1);
        room.handle(a.socket, buy(1, 1_000_000));
        expect(a.socket.last(MessageType.NOTIFICATION)).toMatchObject({ title: "Order rejected", description: "Not enough cash for that order." });
        await Bun.sleep(5); // flush timer
        expect(a.socket.last(MessageType.PORTFOLIO_UPDATE)!.value).toMatchObject({ cash: 9_995, reservedCash: 5 });
    });

    test("per-player rate limit drops floods", () => {
        const { room, join } = lobby({ ...testConfig, orderBurst: 5, orderRate: 1 });
        const a = join("alice");
        room.handle(a.socket, { type: MessageType.ADMIN_SETTINGS, settings: { houseLiquidity: false } });
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        for (let i = 0; i < 50; i++) room.handle(a.socket, buy(0.5));
        expect(room.game.market.book.size).toBe(5);
        expect(a.socket.of(MessageType.NOTIFICATION).filter((n) => n.title === "Slow down")).toHaveLength(1);
    });
});
