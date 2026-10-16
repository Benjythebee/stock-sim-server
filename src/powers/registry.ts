import { join } from "node:path";
import { loadModules } from "../modules";
import { resolveText } from "../text";
import type { AnyPowerDefinition, PublicPower } from "./types";

const TARGETS = new Set(["client", "others", "all", "market"]);

/** Check a power definition. Returns a list of problems (empty = valid). */
export function powerProblems(def: AnyPowerDefinition): string[] {
    const problems: string[] = [];
    if (!def || typeof def !== "object") return ["default export must be definePower({...})"];
    if (typeof def.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(def.id)) problems.push("id must be kebab-case");
    if (!def.title) problems.push("title is required");
    if (!def.description) problems.push("description is required");
    if (typeof def.weight !== "number" || !(def.weight >= 0)) problems.push("weight must be a number >= 0");
    if (def.type !== undefined && !TARGETS.has(def.type)) problems.push(`type must be one of ${[...TARGETS].join(", ")}`);
    const duration = def.durationSeconds ?? 0;
    if (!Number.isInteger(duration) || duration < 0) problems.push("durationSeconds must be an integer >= 0");
    if (duration === 0 && (def.onTick || def.onExpire)) problems.push("onTick/onExpire never run when durationSeconds is 0");
    if (!def.onActivate && !def.onTick && !def.onExpire) problems.push("a power needs at least one hook");
    if (def.state !== undefined && typeof def.state !== "function") problems.push("state must be a function returning fresh state");
    return problems;
}

export function toPublicPower(def: AnyPowerDefinition, ticker: string): PublicPower {
    return {
        id: def.id,
        title: resolveText(def.title, ticker),
        description: resolveText(def.description, ticker),
        type: def.type ?? "market",
        iconSlug: def.icon ?? "default",
        isInstant: def.instant ?? false,
        rarity: def.weight,
        price: def.price,
        durationTicks: def.durationSeconds ?? 0,
    };
}

export class PowerRegistry {
    private readonly byId = new Map<string, AnyPowerDefinition>();

    constructor(definitions: AnyPowerDefinition[]) {
        for (const def of definitions) {
            const problems = powerProblems(def);
            if (problems.length) throw new Error(`invalid power "${def?.id}": ${problems.join("; ")}`);
            if (this.byId.has(def.id)) throw new Error(`duplicate power id "${def.id}"`);
            this.byId.set(def.id, def);
        }
    }

    get(id: string): AnyPowerDefinition | undefined {
        return this.byId.get(id);
    }

    all(): AnyPowerDefinition[] {
        return [...this.byId.values()];
    }

    /** Powers that can appear in briefcases. */
    offerable(): AnyPowerDefinition[] {
        return this.all().filter((d) => d.weight > 0);
    }

    publicList(ticker: string): PublicPower[] {
        return this.all().map((d) => toPublicPower(d, ticker));
    }
}

export const BUILTIN_POWERS_DIR = join(import.meta.dir, "defs");

/** Load built-in powers plus any extra mod directories (e.g. POWER_MODS_DIR). */
export async function loadPowerRegistry(extraDirs: string[] = []): Promise<PowerRegistry> {
    const defs: AnyPowerDefinition[] = [];
    for (const dir of [BUILTIN_POWERS_DIR, ...extraDirs]) {
        defs.push(
            ...(await loadModules(dir, (value, file) => {
                const problems = powerProblems(value as AnyPowerDefinition);
                if (problems.length) throw new Error(`${join(dir, file)}: ${problems.join("; ")}`);
                return value as AnyPowerDefinition;
            })),
        );
    }
    return new PowerRegistry(defs);
}
