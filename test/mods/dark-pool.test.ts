import { describe, expect, test } from "bun:test";
import { Account } from "../../src/engine/account";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const darkPool = builtinCatalog.powers.get("dark-pool")!;

/** A game with one player and a non-human seller who can rest asks 10% above the guide price. */
function arena() {
    const { game } = makeGame({ startingCash: 10_000, openingPrice: 100, houseLiquidity: false });
    const whale = makePlayer("whale");
    game.addPlayer(whale.player);
    const seller = game.market.add(new Account("seller", 0, 10_000, false));
    const restAsk = () => game.market.limit(seller, "sell", Math.round(game.model.guide * 110) / 100, 1_000);
    return { game, whale, restAsk };
}

describe("dark-pool (mods/powers/dark-pool)", () => {
    test("loads from mods/ with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(darkPool, "X");
        expect(pub).toMatchObject({ id: "dark-pool", title: "Dark Pool", type: "client", isInstant: false, durationTicks: 20 });
        expect(pub.iconUrl).toBe("/assets/powers/dark-pool/iceberg.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("without it, a big buy drags the guide price up", () => {
        const { game, whale, restAsk } = arena();
        restAsk();
        const before = game.model.guide;
        expect(game.market.market(whale.player.account, "buy", 50).ok).toBe(true);
        expect(game.model.guide).toBeGreaterThan(before * 1.05);
    });

    test("while active, the player's trades don't move the guide price; afterwards they do again", () => {
        const { game, whale, restAsk } = arena();
        game.powers.activate(darkPool, whale.player);
        expect(whale.socket.last(MessageType.NOTIFICATION)).toMatchObject({ level: "success", title: "Dark Pool" });

        restAsk();
        const before = game.model.guide;
        expect(game.market.market(whale.player.account, "buy", 50).ok).toBe(true);
        expect(whale.player.account.shares).toBe(50);
        expect(game.model.guide).toBe(before);

        runSeconds(game, 20);
        expect(game.powers.activeCount).toBe(0);
        expect(whale.player.account.impactShields).toBe(0);
        restAsk();
        const after = game.model.guide;
        expect(game.market.market(whale.player.account, "buy", 10).ok).toBe(true);
        expect(game.model.guide).toBeGreaterThan(after);
    });

    test("overlapping activations stack: the shield lifts only after both end", () => {
        const { game, whale } = arena();
        game.powers.activate(darkPool, whale.player);
        runSeconds(game, 10);
        game.powers.activate(darkPool, whale.player);
        runSeconds(game, 10);
        expect(whale.player.account.impactShields).toBe(1);
        runSeconds(game, 10);
        expect(whale.player.account.impactShields).toBe(0);
    });
});
