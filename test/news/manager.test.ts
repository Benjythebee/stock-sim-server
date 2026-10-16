import { describe, expect, test } from "bun:test";
import { defineNews } from "../../src/news/types";
import { MessageType, type NewsMessage } from "../../src/protocol/messages";
import { catalogWith, makeGame, noBots, runSeconds } from "../helpers";

describe("NewsManager", () => {
    test("random news arrives every 30-45 game seconds", () => {
        const { game, broadcasts } = makeGame({ enableRandomNews: true, gameDuration: 5 });
        runSeconds(game, 29);
        expect(broadcasts.filter((m) => m.type === MessageType.NEWS)).toHaveLength(0);
        runSeconds(game, 271);
        const news = broadcasts.filter((m): m is NewsMessage => m.type === MessageType.NEWS);
        expect(news.length).toBeGreaterThanOrEqual(6);
        expect(news.length).toBeLessThanOrEqual(10);
        expect(news[0]!.timestamp).toBeGreaterThan(game.startClock);
    });

    test("no random news when disabled", () => {
        const { game, broadcasts } = makeGame({ enableRandomNews: false });
        runSeconds(game, 120);
        expect(broadcasts.some((m) => m.type === MessageType.NEWS)).toBe(false);
    });

    test("is deterministic for a seed", () => {
        const titles = (seed: number) => {
            const { game, broadcasts } = makeGame({ enableRandomNews: true, seed });
            runSeconds(game, 200);
            return broadcasts.filter((m): m is NewsMessage => m.type === MessageType.NEWS).map((m) => m.title);
        };
        expect(titles(9)).toEqual(titles(9));
    });

    test("news effects run start, tick and end hooks in game time", () => {
        const calls: string[] = [];
        const { game, broadcasts } = makeGame({}, catalogWith({ bots: noBots }));
        game.news.publish(
            defineNews({
                title: ({ ticker }) => `${ticker} soars`,
                description: "d",
                durationSeconds: 2,
                onStart: () => calls.push("start"),
                onTick: () => calls.push("tick"),
                onEnd: () => calls.push("end"),
            }),
        );
        expect(broadcasts.at(-1)).toMatchObject({ type: MessageType.NEWS, title: `${game.settings.ticketName} soars`, durationTicks: 2 });
        runSeconds(game, 4);
        expect(calls).toEqual(["start", "tick", "tick", "end"]);
    });

    test("catalog shocks move intrinsic value", () => {
        const { game } = makeGame();
        const before = game.model.intrinsic;
        game.news.publish(builtinTechNews());
        expect(game.model.intrinsic).toBeCloseTo(before * 1.1);
    });
});

function builtinTechNews() {
    return catalogWith().news.find((n) => n.title === "Tech Giant Releases New Product")!;
}
