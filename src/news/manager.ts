import type { Rng } from "../engine/rng";
import type { Game } from "../game/game";
import { log } from "../log";
import { MessageType } from "../protocol/messages";
import { resolveText } from "../text";
import type { NewsContext, NewsDefinition } from "./types";

/** Random headlines arrive every 30-45 game seconds. */
export const NEWS_INTERVAL_SECONDS: readonly [min: number, max: number] = [30, 45];

/**
 * Publishes headlines (random ones from the catalog, plus any pushed by powers) and runs their
 * effects. Everything is scheduled in game seconds, so pausing the game pauses the news too.
 */
export class NewsManager implements NewsContext {
    private live: { news: NewsDefinition; secondsLeft: number }[] = [];
    private nextRandomAt: number;
    published = 0;

    constructor(
        readonly game: Game,
        private readonly catalog: readonly NewsDefinition[],
        readonly rng: Rng,
        private readonly randomNews: boolean,
    ) {
        this.nextRandomAt = this.randomDelay();
    }

    get market() {
        return this.game.market;
    }

    get model() {
        return this.game.model;
    }

    publish(news: NewsDefinition): void {
        const ticker = this.game.settings.ticketName;
        const durationSeconds = news.durationSeconds ?? 0;
        this.published++;
        this.game.broadcast({
            type: MessageType.NEWS,
            title: resolveText(news.title, ticker),
            description: resolveText(news.description, ticker),
            timestamp: this.game.clock,
            durationTicks: durationSeconds,
        });
        this.run(news, "onStart");
        if (durationSeconds > 0 && (news.onTick || news.onEnd)) this.live.push({ news, secondsLeft: durationSeconds });
    }

    /** Called once per game second. */
    onSecond(elapsedSeconds: number): void {
        if (this.randomNews && this.catalog.length && elapsedSeconds >= this.nextRandomAt) {
            this.publish(this.rng.pick(this.catalog)!);
            this.nextRandomAt = elapsedSeconds + this.randomDelay();
        }
        if (this.live.length === 0) return;
        this.live = this.live.filter((item) => {
            this.run(item.news, "onTick");
            if (--item.secondsLeft > 0) return true;
            this.run(item.news, "onEnd");
            return false;
        });
    }

    dispose(): void {
        this.live = [];
    }

    private randomDelay(): number {
        const [min, max] = NEWS_INTERVAL_SECONDS;
        return min + this.rng.int(max - min + 1);
    }

    private run(news: NewsDefinition, hook: "onStart" | "onTick" | "onEnd"): void {
        try {
            news[hook]?.(this);
        } catch (err) {
            log.error(`news "${resolveText(news.title, this.game.settings.ticketName)}" ${hook} threw`, err);
        }
    }
}
