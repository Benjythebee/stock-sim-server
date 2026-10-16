import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const siphon = builtinCatalog.powers.get("siphon")!;
const cents = (p: { player: { account: { cash: number } } }) => p.player.account.cash;

function arena() {
    const { game } = makeGame({ startingCash: 10_000, houseLiquidity: false });
    const thief = makePlayer("thief");
    const rich = makePlayer("rich");
    const poor = makePlayer("poor");
    for (const p of [thief, rich, poor]) game.addPlayer(p.player);
    rich.player.account.adjustCash(500_000); // +$5,000: the clear leader
    return { game, thief, rich, poor };
}

describe("siphon (mods/powers/siphon)", () => {
    test("loads from mods/ as a folder mod with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(siphon, "X");
        expect(pub).toMatchObject({ id: "siphon", title: "Siphon", description: "Drains money from another player.", type: "others" });
        expect(pub.iconUrl).toBe("/assets/powers/siphon/robber-hand.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
        expect(siphon.weight).toBeGreaterThan(0);
    });

    test("drains ~18% of the richest rival's available cash over 10 seconds, conserving money", () => {
        const { game, thief, rich, poor } = arena();
        const before = cents(thief) + cents(rich) + cents(poor);
        const richStart = cents(rich);

        game.powers.activate(siphon, thief.player);
        expect(rich.socket.last(MessageType.NOTIFICATION)).toMatchObject({ level: "warning", title: "Siphon" });
        runSeconds(game, 10);

        const lost = richStart - cents(rich);
        expect(lost / richStart).toBeGreaterThan(0.17);
        expect(lost / richStart).toBeLessThan(0.19);
        expect(cents(thief)).toBe(1_000_000 + lost);
        expect(cents(poor)).toBe(1_000_000);
        expect(cents(thief) + cents(rich) + cents(poor)).toBe(before);
        expect(thief.socket.last(MessageType.NOTIFICATION)!.description).toContain("You siphoned $");
        expect(game.powers.activeCount).toBe(0);
    });

    test("cash locked in open orders is safe", () => {
        const { game, thief, rich } = arena();
        game.market.limit(rich.player.account, "buy", 0.5, 30_000); // reserves $15,000 of $15,000
        game.powers.activate(siphon, thief.player);
        runSeconds(game, 10);
        expect(thief.player.account.cash).toBe(1_000_000);
        expect(rich.player.account.reservedCash).toBe(1_500_000);
    });

    test("with nobody else around it just says so", () => {
        const { game } = makeGame();
        const solo = makePlayer("solo");
        game.addPlayer(solo.player);
        game.powers.activate(siphon, solo.player);
        runSeconds(game, 11);
        expect(solo.player.account.cash).toBe(1_000_000);
        expect(solo.socket.of(MessageType.NOTIFICATION).map((n) => n.description)).toEqual(["There's nobody to rob."]);
    });
});
