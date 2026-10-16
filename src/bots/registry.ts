import { join } from "node:path";
import { loadModules } from "../modules";
import type { BotDefinition } from "./types";

export class BotRegistry {
    private readonly byId = new Map<string, BotDefinition>();

    constructor(definitions: BotDefinition[]) {
        for (const def of definitions) {
            if (this.byId.has(def.id)) throw new Error(`duplicate bot id "${def.id}"`);
            this.byId.set(def.id, def);
        }
    }

    get(id: string): BotDefinition | undefined {
        return this.byId.get(id);
    }

    /** Strategies that can be spawned / shown in the admin UI. */
    enabled(): BotDefinition[] {
        return [...this.byId.values()].filter((d) => d.enabled);
    }

    enabledIds(): string[] {
        return this.enabled().map((d) => d.id);
    }
}

export function validateBotDefinition(value: unknown, file: string): BotDefinition {
    const def = value as BotDefinition;
    const problems: string[] = [];
    if (!def || typeof def !== "object") throw new Error(`${file}: default export must be defineBot({...})`);
    if (typeof def.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(def.id)) problems.push("id must be an identifier-like string");
    if (typeof def.name !== "string" || !def.name) problems.push("name is required");
    if (typeof def.description !== "string") problems.push("description is required");
    if (typeof def.enabled !== "boolean") problems.push("enabled must be a boolean");
    if (typeof def.create !== "function") problems.push("create(rng, settings) is required");
    if (problems.length) throw new Error(`${file}: invalid bot definition: ${problems.join("; ")}`);
    return def;
}

export const BUILTIN_STRATEGIES_DIR = join(import.meta.dir, "strategies");

/** Load built-in strategies plus any extra mod directories (e.g. BOT_MODS_DIR). */
export async function loadBotRegistry(extraDirs: string[] = []): Promise<BotRegistry> {
    const defs: BotDefinition[] = [];
    for (const dir of [BUILTIN_STRATEGIES_DIR, ...extraDirs]) {
        defs.push(...(await loadModules(dir, validateBotDefinition)));
    }
    return new BotRegistry(defs);
}
