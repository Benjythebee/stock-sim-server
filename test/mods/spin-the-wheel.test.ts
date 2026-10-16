import { describe, expect, test } from "bun:test";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, makeGame, makePlayer, runSeconds } from "../helpers";

const wheel = builtinCatalog.powers.get("spin-the-wheel")!;

/** Cash prize per segment label, in cents, with $10,000 starting cash. */
const PRIZES: Record<string, number> = { Bust: -500, "+$500": 50_000, "+$2,500": 250_000, "💎 $15,000": 1_500_000 };

function arena(gameDuration = 5) {
    const { game } = makeGame({ startingCash: 10_000, houseLiquidity: false, gameDuration });
    const alice = makePlayer("alice");
    const bob = makePlayer("bob");
    game.addPlayer(alice.player);
    game.addPlayer(bob.player);
    return { game, alice, bob };
}

describe("spin-the-wheel (mods/powers/spin-the-wheel)", () => {
    test("loads from mods/ as an instant power with its own icon, needing mod API v2", () => {
        const pub = builtinCatalog.powers.publicOf(wheel, "X");
        expect(pub).toMatchObject({ id: "spin-the-wheel", title: "Spin the Wheel", type: "client", isInstant: true });
        expect(pub.iconUrl).toBe("/assets/powers/spin-the-wheel/wheel-of-fortune.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
        expect(wheel.apiVersion).toBe(2);
    });

    test("spins a wheel on the player's screen only, and pays the segment it lands on once it stops", () => {
        const { game, alice, bob } = arena();
        game.powers.activate(wheel, alice.player);

        const spin = alice.socket.last(MessageType.POWER_PRESENT)!;
        expect(spin).toMatchObject({ powerId: "spin-the-wheel", title: "Spin the Wheel", presentation: { kind: "wheel", durationMs: 4000 } });
        const { segments, result } = spin.presentation;
        expect(segments.map((s) => s.label)).toEqual(["Bust", "+$500", "Bust", "+$2,500", "+$500", "Bust", "💎 $15,000", "+$500", "Bust", "+$2,500", "+$500"]);
        expect(segments.reduce((sum, s) => sum + s.weight!, 0)).toBe(100);
        expect(bob.socket.of(MessageType.POWER_PRESENT)).toEqual([]);

        // Nothing is paid (or announced) while the wheel is spinning.
        runSeconds(game, 4);
        expect(alice.player.account.cash).toBe(1_000_000);
        expect(alice.socket.of(MessageType.NOTIFICATION)).toEqual([]);
        runSeconds(game, 1);
        expect(alice.player.account.cash).toBe(1_000_000 + PRIZES[segments[result]!.label]!);
        expect(alice.socket.of(MessageType.NOTIFICATION).length).toBe(1);
        expect(game.powers.activeCount).toBe(0);
    });

    test("lands on each prize at the odds its slice shows, and only jackpots are announced", () => {
        const { game, alice, bob } = arena(100); // 1,000 spins x 5s
        const counts = new Map<string, number>();
        for (let i = 0; i < 1_000; i++) {
            const before = alice.player.account.cash;
            game.powers.activate(wheel, alice.player);
            const { segments, result } = alice.socket.last(MessageType.POWER_PRESENT)!.presentation;
            const label = segments[result]!.label;
            runSeconds(game, 5);
            expect(alice.player.account.cash - before).toBe(PRIZES[label]!);
            counts.set(label, (counts.get(label) ?? 0) + 1);
        }
        expect(counts.get("Bust")! / 1_000).toBeCloseTo(0.5, 1);
        expect(counts.get("+$500")! / 1_000).toBeCloseTo(0.3, 1);
        expect(counts.get("+$2,500")! / 1_000).toBeCloseTo(0.15, 1);
        expect(counts.get("💎 $15,000")! / 1_000).toBeCloseTo(0.05, 1);
        expect(bob.socket.of(MessageType.NOTIFICATION).length).toBe(counts.get("💎 $15,000")!);
        expect(bob.socket.last(MessageType.NOTIFICATION)!.description).toBe("💎 JACKPOT! alice just won $15,000.00 on the wheel.");
    });
});
