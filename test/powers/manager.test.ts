import { describe, expect, test } from "bun:test";
import { log } from "../../src/log";
import { briefcaseSchedule } from "../../src/powers/manager";
import { definePower } from "../../src/powers/types";
import { MessageType } from "../../src/protocol/messages";
import { catalogWith, makeGame, makePlayer, noBots, runSeconds } from "../helpers";

function lifecyclePower(log: string[]) {
    return definePower({
        id: "lifecycle",
        title: "Lifecycle",
        description: "records hooks",
        weight: 1,
        durationSeconds: 3,
        state: () => ({ ticks: 0 }),
        onActivate: (ctx) => log.push(`activate:${ctx.secondsLeft}`),
        onTick: (ctx) => log.push(`tick:${++ctx.state.ticks}`),
        onExpire: (ctx) => log.push(`expire:${ctx.state.ticks}`),
    });
}

describe("briefcaseSchedule", () => {
    test("8 drops for a 5 minute game, none in the last 10s, at least 10s apart", () => {
        const s = briefcaseSchedule(300);
        expect(s.length).toBe(8);
        expect(s.at(-1)!).toBeLessThan(290);
        for (let i = 1; i < s.length; i++) expect(s[i]! - s[i - 1]!).toBeGreaterThanOrEqual(10);
    });

    test("short games still get spaced drops", () => {
        expect(briefcaseSchedule(60)).toEqual([10, 20, 30, 40]);
    });
});

describe("PowerManager", () => {
    test("briefcases open on schedule and offer 3 distinct powers", () => {
        const { game } = makeGame({ gameDuration: 1 });
        const { player, socket } = makePlayer();
        game.addPlayer(player);
        runSeconds(game, 9);
        expect(socket.of(MessageType.POWER_OFFERS)).toHaveLength(0);
        runSeconds(game, 1);
        const offers = socket.last(MessageType.POWER_OFFERS)!.offers;
        expect(offers).toHaveLength(3);
        expect(new Set(offers.map((o) => o.id)).size).toBe(3);
        expect(offers[0]).toHaveProperty("iconSlug");
    });

    test("non-instant pick goes to the inventory exactly once; consuming removes it", () => {
        const log: string[] = [];
        const { game } = makeGame({}, catalogWith({ bots: noBots, powers: [lifecyclePower(log)] }));
        const { player, socket } = makePlayer();
        game.addPlayer(player);
        game.powers.openBriefcases();
        expect(game.powers.select(player, 0)).toBe(true);
        expect(game.powers.inventoryIds(player)).toEqual(["lifecycle"]);
        expect(socket.last(MessageType.POWER_INVENTORY)!.inventory).toEqual(["lifecycle"]);
        expect(game.powers.select(player, 0)).toBe(false); // offers are single-use
        expect(game.powers.consume(player, "lifecycle")).toBe(true);
        expect(game.powers.inventoryIds(player)).toEqual([]);
        expect(game.powers.consume(player, "lifecycle")).toBe(false);
        expect(log).toEqual(["activate:3"]);
    });

    test("duration powers tick every second, then expire exactly once", () => {
        const log: string[] = [];
        const { game } = makeGame({}, catalogWith({ bots: noBots, powers: [lifecyclePower(log)] }));
        const { player } = makePlayer();
        game.addPlayer(player);
        game.powers.activate(game.powers["registry"].get("lifecycle")!, player);
        expect(game.powers.activeCount).toBe(1);
        runSeconds(game, 5);
        expect(log).toEqual(["activate:3", "tick:1", "tick:2", "tick:3", "expire:3"]);
        expect(game.powers.activeCount).toBe(0);
    });

    test("state is fresh per activation", () => {
        const log: string[] = [];
        const def = lifecyclePower(log);
        const { game } = makeGame({}, catalogWith({ bots: noBots, powers: [def] }));
        const { player } = makePlayer();
        game.addPlayer(player);
        game.powers.activate(def, player);
        runSeconds(game, 1);
        game.powers.activate(def, player);
        runSeconds(game, 4);
        expect(log.filter((l) => l.startsWith("expire"))).toEqual(["expire:3", "expire:3"]);
    });

    test("a throwing hook is contained", () => {
        const bad = definePower({
            id: "bad",
            title: "Bad",
            description: "throws",
            weight: 1,
            durationSeconds: 1,
            onActivate() {
                throw new Error("boom");
            },
            onExpire() {
                throw new Error("boom again");
            },
        });
        const { game } = makeGame({}, catalogWith({ bots: noBots, powers: [bad] }));
        const { player } = makePlayer();
        game.addPlayer(player);
        log.setLevel("silent");
        try {
            expect(() => game.powers.activate(bad, player)).not.toThrow();
            expect(() => runSeconds(game, 2)).not.toThrow();
        } finally {
            log.setLevel("warn");
        }
        expect(game.powers.activeCount).toBe(0);
    });

    test("reconnect state resends inventory and pending offers", () => {
        const { game } = makeGame();
        const { player, socket } = makePlayer();
        game.addPlayer(player);
        game.powers.openBriefcases();
        socket.clear();
        game.powers.sendState(player);
        expect(socket.of(MessageType.POWER_INVENTORY)).toHaveLength(1);
        expect(socket.of(MessageType.POWER_OFFERS)).toHaveLength(1);
    });
});
