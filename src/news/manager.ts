import { weightedSample, type Rng } from "../engine/rng";
import type { Game } from "../game/game";
import { log } from "../log";
import { MessageType } from "../protocol/messages";
import { resolveText } from "../text";
import type { NewsContext, NewsDefinition, UpcomingNews } from "./types";

/** One publication of a headline: its own state and countdown (definitions are shared by every room). */
class Publication implements NewsContext {
    constructor(
        private readonly manager: NewsManager,
        readonly news: NewsDefinition<any>,
        readonly state: unknown,
        public secondsLeft: number,
    ) {}

    get game() {
        return this.manager.game;
    }
    get market() {
        return this.manager.game.market;
    }
    get model() {
        return this.manager.game.model;
    }
    get rng() {
        return this.manager.rng;
    }
    /** An arrow function, so hooks can destructure it: `onEnd: ({ publish }) => ...`. */
    readonly publish = (news: NewsDefinition): void => this.manager.publish(news);
}

/** Random headlines arrive every 30-45 game seconds. */
export const NEWS_INTERVAL_SECONDS: readonly [min: number, max: number] = [30, 45];

/**
 * Publishes headlines (random ones from the catalog, plus any pushed by powers) and runs their
 * effects. Everything is scheduled in game seconds, so pausing the game pauses the news too.
 */
export class NewsManager {
    private live: Publication[] = [];
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

    publish(news: NewsDefinition): void {
        news = this.rollVariant(news);
        const ticker = this.game.settings.ticketName;
        const durationSeconds = news.durationSeconds ?? 0;
        this.published++;
        if (news.fairValueShock) this.game.model.shockIntrinsic(news.fairValueShock);
        this.game.broadcast({
            type: MessageType.NEWS,
            title: resolveText(news.title, ticker),
            description: resolveText(news.description, ticker),
            timestamp: this.game.clock,
            durationTicks: durationSeconds,
        });
        const publication = new Publication(this, news, news.state ? news.state() : {}, durationSeconds);
        this.run(publication, "onStart");
        if (durationSeconds > 0 && (news.onTick || news.onEnd)) this.live.push(publication);
    }

    /**
     * Reveal the next catalog headline and make sure it's published within `withinSeconds` (it
     * stays sooner if it was already due sooner). With random news off, this schedules a one-off
     * headline. Everyone else sees it only when it's published. Null when the catalog is empty.
     */
    upcoming(withinSeconds: number): UpcomingNews | null {
        if (this.catalog.length === 0) return null;
        const now = this.game.elapsedSeconds;
        this.next ??= this.draw();
        this.nextAt = Math.max(now + 1, Math.min(this.nextAt, now + withinSeconds));
        return { news: this.next, inSeconds: this.nextAt - now };
    }

    /** Called once per game second. */
    onSecond(elapsedSeconds: number): void {
        if (this.catalog.length && elapsedSeconds >= this.nextAt) {
            this.publish(this.next ?? this.draw());
            this.next = null;
            const delay = this.randomDelay();
            this.nextAt = this.randomNews ? elapsedSeconds + delay : Infinity;
        }
        if (this.live.length === 0) return;
        // Hooks may publish follow-up headlines, which land in the fresh list (and tick from next second).
        const live = this.live;
        this.live = [];
        for (const item of live) {
            this.run(item, "onTick");
            if (--item.secondsLeft > 0) this.live.push(item);
            else this.run(item, "onEnd");
        }
    }

    dispose(): void {
        this.live = [];
    }

    /** A random catalog headline, with its variant already rolled. */
    private draw(): NewsDefinition {
        return this.rollVariant(this.rng.pick(this.catalog)!);
    }

    /** Settle which version of a headline with `variants` goes out (a no-op for plain headlines). */
    private rollVariant(news: NewsDefinition): NewsDefinition {
        if (!news.variants?.length) return news;
        const [variant] = weightedSample(this.rng, news.variants, (v) => v.weight ?? 1, 1);
        if (!variant) return news;
        const { weight: _, ...fields } = variant;
        return { ...news, ...fields, variants: undefined };
    }

    private randomDelay(): number {
        const [min, max] = NEWS_INTERVAL_SECONDS;
        return min + this.rng.int(max - min + 1);
    }

    private run(publication: Publication, hook: "onStart" | "onTick" | "onEnd"): void {
        try {
            publication.news[hook]?.(publication);
        } catch (err) {
            log.error(`news "${resolveText(publication.news.title, this.game.settings.ticketName)}" ${hook} threw`, err);
        }
    }
}
