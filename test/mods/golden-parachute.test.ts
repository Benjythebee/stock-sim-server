import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const parachute = builtinCatalog.powers.get("golden-parachute")!;

function arena() {
    const { game } = makeGame({ startingCash: 10_000, houseLiquidity: false });
    const a = makePlayer("alice");
    const b = makePlayer("bob");
    game.addPlayer(a.player);
    game.addPlayer(b.player);
    return { game, a, b };
}

describe("golden-parachute (mods/powers/golden-parachute)", () => {
    test("loads from mods/ with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(parachute, "X");
        expect(pub).toMatchObject({ id: "golden-parachute", title: "Golden Parachute", type: "client", isInstant: false, durationTicks: 30 });
        expect(pub.iconUrl).toBe("/assets/powers/golden-parachute/parachute.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("refunds 75% of a P&L drop when the cover ends, privately", () => {
        const { game, a, b } = arena();
        game.powers.activate(parachute, a.player);
        a.player.account.adjustCash(-100_000); // lose $1,000 during the cover
        runSeconds(game, 29);
        expect(a.player.account.cash).toBe(900_000);
        runSeconds(game, 1);
        expect(a.player.account.cash).toBe(975_000);
        expect(a.socket.last(MessageType.NOTIFICATION)!.description).toBe("Your parachute opened: $750.00 refunded on a $1,000.00 drop.");
        expect(b.socket.of(MessageType.NOTIFICATION)).toHaveLength(0);
        expect(game.powers.activeCount).toBe(0);
    });

    test("pays nothing when the P&L went up", () => {
        const { game, a } = arena();
        game.powers.activate(parachute, a.player);
        a.player.account.adjustCash(50_000);
        runSeconds(game, 30);
        expect(a.player.account.cash).toBe(1_050_000);
        expect(a.socket.last(MessageType.NOTIFICATION)!.level).toBe("info");
    });

    test("the payout is capped at 25% of starting cash", () => {
        const { game, a } = arena();
        game.powers.activate(parachute, a.player);
        a.player.account.adjustCash(-800_000); // lose $8,000
        runSeconds(game, 30);
        expect(a.player.account.cash).toBe(200_000 + 250_000);
    });

    test("losses before activation aren't covered", () => {
        const { game, a } = arena();
        a.player.account.adjustCash(-100_000);
        game.powers.activate(parachute, a.player);
        runSeconds(game, 30);
        expect(a.player.account.cash).toBe(900_000);
    });
});
