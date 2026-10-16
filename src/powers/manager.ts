import { weightedSample, type Rng } from "../engine/rng";
import { toTicks } from "../engine/money";
import type { Game } from "../game/game";
import type { Player } from "../game/player";
import { log } from "../log";
import type { NewsDefinition } from "../news/types";
import { MessageType, type Notification } from "../protocol/messages";
import { toPublicPower, type PowerRegistry } from "./registry";
import type { AnyPowerDefinition, PowerContext, PublicPower } from "./types";

/** Offers per briefcase. */
export const OFFERS_PER_BRIEFCASE = 3;

/**
 * Game seconds at which briefcases open: 8 evenly spaced drops, at least 10s apart, none in the
 * last 10 seconds.
 */
export function briefcaseSchedule(durationSeconds: number): number[] {
    const interval = Math.max(10, (durationSeconds - 10) / 9);
    const out: number[] = [];
    for (let t = interval; t < durationSeconds - 10; t += interval) out.push(Math.round(t));
    return out;
}

class Activation implements PowerContext<any> {
    secondsLeft: number;

    constructor(
        readonly definition: AnyPowerDefinition,
        readonly power: PublicPower,
        readonly player: Player,
        readonly game: Game,
        readonly rng: Rng,
        readonly state: any,
    ) {
        this.secondsLeft = definition.durationSeconds ?? 0;
    }

    get market() {
        return this.game.market;
    }
    get model() {
        return this.game.model;
    }
    get players() {
        return this.game.players();
    }
    get others() {
        return this.game.players().filter((p) => p !== this.player);
    }
    notify(to: Player | Player[], notification: Notification) {
        this.game.notify(Array.isArray(to) ? to : [to], notification);
    }
    notifyAll(notification: Notification) {
        this.game.notifyAll(notification);
    }
    giveCash(player: Player, dollars: number) {
        return player.account.adjustCash(toTicks(dollars)) / 100;
    }
    publishNews(news: NewsDefinition) {
        this.game.news.publish(news);
    }
}

/**
 * Briefcases, inventories and active power effects for one game. Hooks from power mods run
 * inside try/catch so a buggy power can never take a room down.
 */
export class PowerManager {
    private readonly offers = new Map<string, AnyPowerDefinition[]>();
    private readonly inventories = new Map<string, AnyPowerDefinition[]>();
    private active: Activation[] = [];
    private readonly schedule: number[];

    constructor(
        private readonly game: Game,
        private readonly registry: PowerRegistry,
        private readonly rng: Rng,
    ) {
        this.schedule = briefcaseSchedule(game.durationSeconds);
    }

    get activeCount(): number {
        return this.active.length;
    }

    get upcomingBriefcases(): readonly number[] {
        return this.schedule;
    }

    /** Called once per game second. */
    onSecond(elapsedSeconds: number): void {
        while (this.schedule.length && this.schedule[0]! <= elapsedSeconds) {
            this.schedule.shift();
            this.openBriefcases();
        }

        if (this.active.length === 0) return;
        const stillActive: Activation[] = [];
        for (const activation of this.active) {
            this.run(activation, "onTick");
            activation.secondsLeft--;
            if (activation.secondsLeft <= 0) this.run(activation, "onExpire");
            else stillActive.push(activation);
        }
        this.active = stillActive;
    }

    openBriefcases(): void {
        const pool = this.registry.offerable();
        for (const player of this.game.players()) {
            const picks = weightedSample(this.rng, pool, (d) => d.weight, OFFERS_PER_BRIEFCASE);
            if (picks.length === 0) continue;
            this.offers.set(player.id, picks);
            this.sendOffers(player);
        }
    }

    /** Player picked offer #index from their briefcase. */
    select(player: Player, index: number): boolean {
        const offers = this.offers.get(player.id);
        const def = offers?.[index];
        if (!def) return false;
        this.offers.delete(player.id);
        if (def.instant) {
            this.activate(def, player);
        } else {
            const inventory = this.inventories.get(player.id) ?? [];
            inventory.push(def);
            this.inventories.set(player.id, inventory);
            this.sendInventory(player);
        }
        return true;
    }

    /** Player used a power from their inventory. */
    consume(player: Player, powerId: string): boolean {
        const inventory = this.inventories.get(player.id);
        const index = inventory?.findIndex((d) => d.id === powerId) ?? -1;
        if (!inventory || index < 0) return false;
        const [def] = inventory.splice(index, 1);
        this.sendInventory(player);
        this.activate(def!, player);
        return true;
    }

    /** Activate a power for a player right now (also used by tests and admin tooling). */
    activate(def: AnyPowerDefinition, player: Player): void {
        const activation = new Activation(
            def,
            toPublicPower(def, this.game.settings.ticketName),
            player,
            this.game,
            this.rng.fork(this.game.step),
            def.state ? def.state() : {},
        );
        this.run(activation, "onActivate");
        if (activation.secondsLeft > 0) this.active.push(activation);
    }

    inventoryIds(player: Player): string[] {
        return (this.inventories.get(player.id) ?? []).map((d) => d.id);
    }

    offersFor(player: Player): PublicPower[] {
        return (this.offers.get(player.id) ?? []).map((d) => toPublicPower(d, this.game.settings.ticketName));
    }

    /** Re-send inventory and pending offers (after a reconnect). */
    sendState(player: Player): void {
        this.sendInventory(player);
        if (this.offers.has(player.id)) this.sendOffers(player);
    }

    forgetPlayer(player: Player): void {
        this.offers.delete(player.id);
        this.inventories.delete(player.id);
    }

    dispose(): void {
        this.active = [];
        this.offers.clear();
        this.inventories.clear();
    }

    private sendOffers(player: Player): void {
        player.send({ type: MessageType.POWER_OFFERS, offers: this.offersFor(player) });
    }

    private sendInventory(player: Player): void {
        player.send({ type: MessageType.POWER_INVENTORY, inventory: this.inventoryIds(player) });
    }

    private run(activation: Activation, hook: "onActivate" | "onTick" | "onExpire"): void {
        const fn = activation.definition[hook];
        if (!fn) return;
        try {
            fn.call(activation.definition, activation);
        } catch (err) {
            log.error(`power "${activation.definition.id}" ${hook} threw`, err);
        }
    }
}
