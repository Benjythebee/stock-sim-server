import { describe, expect, test } from "bun:test";
import { defineNews, type NewsDefinition } from "../../src/news/types";
import { MessageType, type NewsMessage } from "../../src/protocol/messages";
import { builtinCatalog, catalogWith, makeGame, makePlayer, noBots, runSeconds } from "../helpers";

const pressRelease = builtinCatalog.powers.get("embargoed-press-release")!;
const bullish = defineNews({ title: ({ ticker }) => `${ticker} wins big contract`, description: "d", fairValueShock: 0.2 });
const noise = defineNews({ title: "Analysts shrug", description: "d" });

function arena(news: NewsDefinition[] = [bullish], enableRandomNews = true) {
    const { game, broadcasts } = makeGame({ enableRandomNews, ticketName: "STNK" }, catalogWith({ bots: noBots, news }));
    const a = makePlayer("alice");
    const b = makePlayer("bob");
    game.addPlayer(a.player);
    game.addPlayer(b.player);
    const headlines = () => broadcasts.filter((m): m is NewsMessage => m.type === MessageType.NEWS);
    return { game, a, b, headlines };
}

describe("embargoed-press-release (mods/powers/embargoed-press-release)", () => {
    test("loads from mods/ as an instant power with its own icon", () => {
        const pub = builtinCatalog.powers.publicOf(pressRelease, "X");
        expect(pub).toMatchObject({ id: "embargoed-press-release", type: "client", isInstant: true });
        expect(pub.iconUrl).toBe("/assets/powers/embargoed-press-release/newspaper.svg");
        expect(builtinCatalog.powers.assets.has(pub.iconUrl!)).toBe(true);
    });

    test("tells only the initiator the next headline and its effect, then publishes it 10s later", () => {
        const { game, a, b, headlines } = arena();
        runSeconds(game, 2);
        game.powers.activate(pressRelease, a.player);
        expect(a.socket.last(MessageType.NOTIFICATION)!.description).toBe(
            `"STNK wins big contract" goes out in 10s. Bullish: the fair value should jump about 20%.`,
        );
        expect(b.socket.of(MessageType.NOTIFICATION)).toHaveLength(0);

        const intrinsic = game.model.intrinsic;
        runSeconds(game, 9);
        expect(headlines()).toHaveLength(0);
        runSeconds(game, 1);
        expect(headlines().map((n) => n.title)).toEqual(["STNK wins big contract"]);
        expect(game.model.intrinsic).toBeCloseTo(intrinsic * 1.2);
    });

    test("a headline already due sooner keeps its time", () => {
        const { game, a } = arena();
        runSeconds(game, 2);
        game.powers.activate(pressRelease, a.player);
        runSeconds(game, 6);
        game.powers.activate(pressRelease, a.player);
        expect(a.socket.last(MessageType.NOTIFICATION)!.description).toContain("goes out in 4s");
    });

    test("works with random news off (a one-off headline) and calls out noise", () => {
        const { game, a, headlines } = arena([noise], false);
        game.powers.activate(pressRelease, a.player);
        expect(a.socket.last(MessageType.NOTIFICATION)!.description).toContain("won't change the fair value");
        runSeconds(game, 10);
        expect(headlines()).toHaveLength(1);
        runSeconds(game, 120);
        expect(headlines()).toHaveLength(1);
    });

    test("with no headlines at all it just says so", () => {
        const { game, a, headlines } = arena([], true);
        game.powers.activate(pressRelease, a.player);
        expect(a.socket.last(MessageType.NOTIFICATION)!.description).toContain("Nothing's on the wire");
        runSeconds(game, 60);
        expect(headlines()).toHaveLength(0);
    });
    test("a headline with variants is rolled before the preview, so the preview matches what goes out", () => {
        const mixed = defineNews({
            title: "Survey released",
            description: "d",
            variants: [
                { title: "Survey: boom", fairValueShock: 0.1 },
                { title: "Survey: bust", fairValueShock: -0.1 },
            ],
        });
        for (let i = 0; i < 6; i++) {
            const { game, a, headlines } = arena([mixed]);
            runSeconds(game, 2 + i);
            game.powers.activate(pressRelease, a.player);
            const preview = a.socket.last(MessageType.NOTIFICATION)!.description;
            const intrinsic = game.model.intrinsic;
            runSeconds(game, 10);
            const published = headlines()[0]!.title;
            expect(preview).toStartWith(`"${published}"`);
            expect(preview).toContain(published === "Survey: boom" ? "Bullish" : "Bearish");
            expect(game.model.intrinsic).toBeCloseTo(intrinsic * (published === "Survey: boom" ? 1.1 : 0.9));
        }
    });
});
