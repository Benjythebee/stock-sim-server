import { describe, expect, test } from "bun:test";
import { log } from "../../src/log";
import { briefcaseSchedule } from "../../src/powers/manager";
import { presentationProblems, type WheelSegment } from "../../src/powers/presentation";
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

    test("present() sends a validated, trimmed animation to the chosen players only", () => {
        const spinner = definePower({
            id: "spinner",
            title: "Spinner",
            description: "spins",
            weight: 1,
            apiVersion: 2,
            onActivate(ctx) {
                const segments = [{ label: "A", color: "#f00", extra: "dropped" }, { label: "B", weight: 3 }] as WheelSegment[];
                ctx.present(ctx.player, { kind: "wheel", segments, result: 1 });
            },
        });
        const { game } = makeGame({}, catalogWith({ bots: noBots, powers: [spinner] }));
        const alice = makePlayer("alice");
        const bob = makePlayer("bob");
        game.addPlayer(alice.player);
        game.addPlayer(bob.player);
        game.powers.activate(spinner, alice.player);
        expect(alice.socket.last(MessageType.POWER_PRESENT)).toEqual({
            type: MessageType.POWER_PRESENT,
            powerId: "spinner",
            title: "Spinner",
            presentation: { kind: "wheel", segments: [{ label: "A", color: "#f00" }, { label: "B", weight: 3 }], result: 1, durationMs: 4000 },
        });
        expect(bob.socket.of(MessageType.POWER_PRESENT)).toEqual([]);
    });

    test("present() refuses an invalid presentation (and the throw is contained)", () => {
        expect(presentationProblems({ kind: "wheel", segments: [{ label: "only one" }], result: 0 })).toEqual(["a wheel needs 2-24 segments"]);
        expect(presentationProblems({ kind: "wheel", segments: [{ label: "A" }, { label: "B" }], result: 2 })).toEqual(["result must be the index of a segment"]);
        expect(presentationProblems({ kind: "wheel", segments: [{ label: "" }, { label: "B", weight: 0 }], result: 0, durationMs: 60_000 })).toEqual([
            "durationMs must be between 1000 and 10000",
            "segment 0 needs a label",
            "segment 1 weight must be > 0",
        ]);
        expect(presentationProblems({ kind: "confetti" } as never)).toEqual(["kind must be one of wheel"]);

        const broken = definePower({
            id: "broken",
            title: "Broken",
            description: "bad wheel",
            weight: 1,
            onActivate: (ctx) => ctx.present(ctx.player, { kind: "wheel", segments: [], result: 0 }),
        });
        const { game } = makeGame({}, catalogWith({ bots: noBots, powers: [broken] }));
        const { player, socket } = makePlayer();
        game.addPlayer(player);
        log.setLevel("silent");
        try {
            expect(() => game.powers.activate(broken, player)).not.toThrow();
        } finally {
            log.setLevel("warn");
        }
        expect(socket.of(MessageType.POWER_PRESENT)).toEqual([]);
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

    test("a declined briefcase is gone: not selectable and not re-sent on reconnect", () => {
        const { game } = makeGame();
        const { player, socket } = makePlayer();
        game.addPlayer(player);
        game.powers.openBriefcases();
        expect(game.powers.decline(player)).toBe(true);
        expect(game.powers.decline(player)).toBe(false);
        expect(game.powers.select(player, 0)).toBe(false);
        socket.clear();
        game.powers.sendState(player);
        expect(socket.of(MessageType.POWER_OFFERS)).toHaveLength(0);
        expect(game.powers.inventoryIds(player)).toEqual([]);
    });
});
