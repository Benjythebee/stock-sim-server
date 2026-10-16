import type { Rng } from "../engine/rng";
import type { Game } from "../game/game";
import { log } from "../log";
import { MessageType } from "../protocol/messages";
import { resolveText } from "../text";
import type { NewsContext, NewsDefinition, UpcomingNews } from "./types";

/** Random headlines arrive every 30-45 game seconds. */
export const NEWS_INTERVAL_SECONDS: readonly [min: number, max: number] = [30, 45];

/**
 * Publishes headlines (random ones from the catalog, plus any pushed by powers) and runs their
 * effects. Everything is scheduled in game seconds, so pausing the game pauses the news too.
 */
export class NewsManager implements NewsContext {
    private live: { news: NewsDefinition; secondsLeft: number }[] = [];
    /** The next catalog headline, picked early once a power has revealed it. */
    private next: NewsDefinition | null = null;
    /** Game second the next catalog headline is due (Infinity: none, random news is off). */
    private nextAt: number;
    published = 0;

    constructor(
        readonly game: Game,
        private readonly catalog: readonly NewsDefinition[],
        readonly rng: Rng,
        private readonly randomNews: boolean,
    ) {
        const delay = this.randomDelay();
        this.nextAt = randomNews ? delay : Infinity;
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
        if (news.fairValueShock) this.model.shockIntrinsic(news.fairValueShock);
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

    /**
     * Reveal the next catalog headline and make sure it's published within `withinSeconds` (it
     * stays sooner if it was already due sooner). With random news off, this schedules a one-off
     * headline. Everyone else sees it only when it's published. Null when the catalog is empty.
     */
    upcoming(withinSeconds: number): UpcomingNews | null {
        if (this.catalog.length === 0) return null;
        const now = this.game.elapsedSeconds;
        this.next ??= this.rng.pick(this.catalog)!;
        this.nextAt = Math.max(now + 1, Math.min(this.nextAt, now + withinSeconds));
        return { news: this.next, inSeconds: this.nextAt - now };
    }

    /** Called once per game second. */
    onSecond(elapsedSeconds: number): void {
        if (this.catalog.length && elapsedSeconds >= this.nextAt) {
            this.publish(this.next ?? this.rng.pick(this.catalog)!);
            this.next = null;
            const delay = this.randomDelay();
            this.nextAt = this.randomNews ? elapsedSeconds + delay : Infinity;
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
