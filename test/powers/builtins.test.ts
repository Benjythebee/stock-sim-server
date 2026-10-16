import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const power = (id: string) => builtinCatalog.powers.get(id)!;

function arena() {
    const { game, broadcasts } = makeGame({ startingCash: 10_000 });
    const a = makePlayer("alice");
    const b = makePlayer("bob");
    const c = makePlayer("carol");
    for (const p of [a, b, c]) game.addPlayer(p.player);
    return { game, broadcasts, a, b, c };
}

describe("built-in powers", () => {
    test("cash-heritage credits the initiator between $1,000 and $1,000 + starting cash", () => {
        const { game, a, b } = arena();
        game.powers.activate(power("cash-heritage"), a.player);
        const gained = a.player.account.cash / 100 - 10_000;
        expect(gained).toBeGreaterThanOrEqual(1000);
        expect(gained).toBeLessThanOrEqual(11_000);
        expect(b.player.account.cash).toBe(1_000_000);
        expect(a.socket.last(MessageType.NOTIFICATION)!.level).toBe("success");
        expect(b.socket.last(MessageType.NOTIFICATION)!.level).toBe("info");
    });

    test("the-homeless-gift gives exactly $1", () => {
        const { game, a } = arena();
        game.powers.activate(power("the-homeless-gift"), a.player);
        expect(a.player.account.cash).toBe(1_000_100);
    });

    test("the-hacker-ddos locks everyone else for 15s, then unlocks", () => {
        const { game, a, b, c } = arena();
        game.powers.activate(power("the-hacker-ddos"), a.player);
        expect(a.player.account.tradingDisabled).toBe(false);
        expect(b.player.account.tradingDisabled).toBe(true);
        expect(c.player.account.tradingDisabled).toBe(true);
        expect(b.socket.last(MessageType.CLIENT_STATE)).toEqual({ type: MessageType.CLIENT_STATE, tradingDisabled: true });
        expect(game.market.limit(b.player.account, "buy", 1, 1)).toEqual({ ok: false, reason: "trading-disabled" });
        runSeconds(game, 14);
        expect(b.player.account.tradingDisabled).toBe(true);
        runSeconds(game, 1);
        expect(b.player.account.tradingDisabled).toBe(false);
        expect(b.socket.last(MessageType.CLIENT_STATE)!.tradingDisabled).toBe(false);
    });

    test("overlapping DDoS attacks stack: trading resumes only after both end", () => {
        const { game, a, b, c } = arena();
        game.powers.activate(power("the-hacker-ddos"), a.player);
        runSeconds(game, 10);
        game.powers.activate(power("the-hacker-ddos"), b.player);
        runSeconds(game, 5); // first attack over
        expect(c.player.account.tradingDisabled).toBe(true);
        runSeconds(game, 10);
        expect(c.player.account.tradingDisabled).toBe(false);
    });

    test("volatility-storm boosts volatility 4x for 20s and restores it", () => {
        const { game, a } = arena();
        const base = game.model.volatility;
        game.powers.activate(power("volatility-storm"), a.player);
        expect(game.model.volatility).toBeCloseTo(base * 4);
        runSeconds(game, 20);
        expect(game.model.volatility).toBeCloseTo(base);
    });

    test("two storms in a row restore the base volatility", () => {
        const { game, a, b } = arena();
        const base = game.model.volatility;
        game.powers.activate(power("volatility-storm"), a.player);
        runSeconds(game, 5);
        game.powers.activate(power("volatility-storm"), b.player);
        runSeconds(game, 30);
        expect(game.model.volatility).toBeCloseTo(base);
    });

    test("rumor-mill publishes news and shocks the guide price", () => {
        const { game, broadcasts, a } = arena();
        game.powers.activate(power("rumor-mill"), a.player);
        expect(broadcasts.some((m) => m.type === MessageType.NEWS && m.title === "Market Rumor!")).toBe(true);
        expect(game.model.isShockActive).toBe(true);
    });

    test("insider-tip whispers a value near the intrinsic price to the initiator only", () => {
        const { game, a, b } = arena();
        game.powers.activate(power("insider-tip"), a.player);
        const note = a.socket.last(MessageType.NOTIFICATION)!;
        const tip = Number(/\$(\d+\.\d+)/.exec(note.description!)![1]);
        expect(Math.abs(tip / game.model.intrinsic - 1)).toBeLessThan(0.04);
        expect(b.socket.of(MessageType.NOTIFICATION)).toHaveLength(0);
    });
});
