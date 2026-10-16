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
            MessageType.ORDER_UPDATE,
            MessageType.CLIENT_STATE,
            MessageType.POWER_INVENTORY,
        ]);
        expect(socket.last(MessageType.ORDER_UPDATE)).toMatchObject({ orders: [], reset: true });
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

    test("players who reconnect and spectators who arrive after the end still get the leaderboard", () => {
        const { host, room, join } = lobby();
        const a = join("alice");
        const b = join("bob");
        room.handle(a.socket, { type: MessageType.ADMIN_SETTINGS, settings: { gameDuration: 1 } });
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        for (let i = 0; i < 300; i++) room.tick();
        expect(room.phase).toBe("ended");
        const final = a.socket.last(MessageType.GAME_CONCLUSION)!;
        expect(final.players.map((p) => p.name).sort()).toEqual(["alice", "bob"]);

        // bob refreshes: the resumed seat gets ROOM_STATE ended=true *and* the conclusion, after its portfolio.
        room.disconnect(b.socket);
        const again = join("bob", b.player.id);
        const types = again.socket.received.map((m) => m.type);
        expect(again.socket.last(MessageType.ROOM_STATE)!.ended).toBe(true);
        expect(again.socket.of(MessageType.GAME_CONCLUSION)).toEqual([final]);
        expect(types.indexOf(MessageType.GAME_CONCLUSION)).toBeGreaterThan(types.indexOf(MessageType.PORTFOLIO_UPDATE));

        // A late spectator gets it too.
        const spec = host.socket("r1", "watcher", { spectator: true });
        room.spectate(spec);
        expect(spec.of(MessageType.GAME_CONCLUSION)).toEqual([final]);
    });

    test("no conclusion is sent to anyone joining before the game has ended", () => {
        const { host, room, join } = lobby();
        const a = join("alice");
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        room.tick();
        const late = join("bob");
        const spec = host.socket("r1", "watcher", { spectator: true });
        room.spectate(spec);
        expect(late.socket.of(MessageType.GAME_CONCLUSION)).toHaveLength(0);
        expect(spec.of(MessageType.GAME_CONCLUSION)).toHaveLength(0);
    });

    test("skipping a briefcase (POWER_SELECT -1) drops the offers so a refresh doesn't bring them back", () => {
        const { room, join } = lobby();
        const a = join("alice");
        room.game.powers.openBriefcases();
        expect(room.game.powers.offersFor(a.player)).toHaveLength(3);
        room.handle(a.socket, { type: MessageType.POWER_SELECT, index: -1 });
        expect(room.game.powers.offersFor(a.player)).toEqual([]);
        expect(room.game.powers.inventoryIds(a.player)).toEqual([]);

        room.disconnect(a.socket);
        const again = join("alice", a.player.id);
        expect(again.socket.of(MessageType.POWER_OFFERS)).toHaveLength(0);
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

    test("players see their own orders and can cancel them; a reconnect gets the full list back", async () => {
        const { room, join } = lobby();
        const a = join("alice");
        const b = join("bob");
        room.handle(a.socket, { type: MessageType.ADMIN_SETTINGS, settings: { houseLiquidity: false } });
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        room.handle(a.socket, buy(0.5, 10));
        room.handle(a.socket, buy(0.4, 10));
        await Bun.sleep(5);
        const open = a.socket.last(MessageType.ORDER_UPDATE)!.orders;
        expect(open.map((o) => [o.price, o.status])).toEqual([[0.5, "open"], [0.4, "open"]]);
        expect(b.socket.of(MessageType.ORDER_UPDATE).flatMap((m) => m.orders)).toEqual([]); // private

        room.handle(b.socket, { type: MessageType.ORDER_CANCEL, id: open[0]!.id }); // not bob's: no effect
        expect(room.game.market.book.size).toBe(2);
        room.handle(a.socket, { type: MessageType.ORDER_CANCEL, id: open[0]!.id });
        await Bun.sleep(5);
        expect(room.game.market.book.size).toBe(1);
        expect(a.socket.last(MessageType.ORDER_UPDATE)!.orders).toEqual([expect.objectContaining({ id: open[0]!.id, status: "cancelled" })]);
        expect(a.socket.last(MessageType.PORTFOLIO_UPDATE)!.value.reservedCash).toBe(4);

        const again = join("alice", a.player.id).socket.last(MessageType.ORDER_UPDATE)!;
        expect(again.reset).toBe(true);
        expect(again.orders.map((o) => o.status)).toEqual(["open", "cancelled"]);
    });

    test("cancels are refused while paused or while trading is locked", () => {
        const { room, join } = lobby();
        const a = join("alice");
        room.handle(a.socket, { type: MessageType.ADMIN_SETTINGS, settings: { houseLiquidity: false } });
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        room.handle(a.socket, buy(0.5, 10));
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        room.handle(a.socket, { type: MessageType.ORDER_CANCEL, id: -1 });
        expect(a.socket.last(MessageType.NOTIFICATION)).toMatchObject({ title: "Market closed" });
        room.handle(a.socket, { type: MessageType.TOGGLE_PAUSE });
        const release = a.player.lockTrading();
        room.handle(a.socket, { type: MessageType.ORDER_CANCEL, id: -1 });
        expect(a.socket.last(MessageType.NOTIFICATION)).toMatchObject({ title: "Cancel rejected" });
        expect(room.game.market.book.size).toBe(1);
        release();
        room.handle(a.socket, { type: MessageType.ORDER_CANCEL, id: -1 });
        expect(room.game.market.book.size).toBe(0);
    });

    test("lobby settings changes clear everyone's order list", () => {
        const { room, join } = lobby();
        const a = join("alice");
        a.socket.clear();
        room.handle(a.socket, { type: MessageType.ADMIN_SETTINGS, settings: { bots: 2 } });
        expect(a.socket.last(MessageType.ORDER_UPDATE)).toMatchObject({ orders: [], reset: true });
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
