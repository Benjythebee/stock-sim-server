import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer } from "../helpers";

// Shelved: the mod lives in mods/powers/_slot-machine/ (ignored by the loader). Rename the folder to
// slot-machine/ to bring it back, and these tests run again.
const slots = builtinCatalog.powers.get("slot-machine")!;

describe.skipIf(!slots)("slot-machine (mods/powers/slot-machine)", () => {
    test("loads from mods/ as an instant power with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(slots, "X");
        expect(pub).toMatchObject({ id: "slot-machine", title: "Slot Machine", type: "client", isInstant: true });
        expect(pub.iconUrl).toBe("/assets/powers/slot-machine/slot-machine.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("pays one of the fixed prizes (or charges the $5 ticket), at roughly the advertised odds", () => {
        const { game } = makeGame({ startingCash: 10_000, houseLiquidity: false });
        const alice = makePlayer("alice");
        const bob = makePlayer("bob");
        game.addPlayer(alice.player);
        game.addPlayer(bob.player);

        const counts = new Map<number, number>();
        for (let i = 0; i < 1_000; i++) {
            const before = alice.player.account.cash;
            game.powers.activate(slots, alice.player);
            const delta = alice.player.account.cash - before;
            counts.set(delta, (counts.get(delta) ?? 0) + 1);
            game.advance(); // a fresh roll each spin
        }
        expect([...counts.keys()].sort((a, b) => a - b)).toEqual([-500, 50_000, 250_000, 1_500_000]);
        expect(counts.get(-500)! / 1_000).toBeCloseTo(0.5, 1);
        expect(counts.get(1_500_000)! / 1_000).toBeCloseTo(0.05, 1);
        // Only jackpots are announced to the room.
        expect(bob.socket.of(MessageType.NOTIFICATION).length).toBe(counts.get(1_500_000)!);
        expect(bob.socket.last(MessageType.NOTIFICATION)!.description).toContain("JACKPOT! alice just won $15,000.00");
    });
});
