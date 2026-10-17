import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { log } from "../log";
import { loadModules, type ModuleSource } from "../modules";
import { resolveText } from "../text";
import { MOD_API_VERSION } from "../version";
import type { AnyPowerDefinition, PublicPower } from "./types";

const TARGETS = new Set(["client", "others", "all", "market"]);

/** Image types a mod may ship as its icon. */
export const IMAGE_EXTENSIONS = /\.(svg|png|webp|jpe?g|gif)$/i;

/** URL prefix under which mod assets are served. */
export const POWER_ASSET_PREFIX = "/assets/powers";

/** Icon slug the UI shows when a mod's image can't be found. */
export const MISSING_ICON = "missing";

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
    if (def.icon !== undefined && typeof def.icon !== "string") problems.push("icon must be a string");
    if (def.iconCredit !== undefined && typeof def.iconCredit?.author !== "string") problems.push("iconCredit needs an author");
    if (def.apiVersion !== undefined && !(Number.isInteger(def.apiVersion) && def.apiVersion >= 1)) problems.push("apiVersion must be an integer >= 1");
    else if ((def.apiVersion ?? 1) > MOD_API_VERSION) problems.push(`needs mod API v${def.apiVersion}, but this server only has v${MOD_API_VERSION}: update the server`);
    return problems;
}

/** Resolved icon for a power: a served file, or a built-in UI slug. */
interface ResolvedIcon {
    slug: string;
    url?: string;
}

export function toPublicPower(def: AnyPowerDefinition, ticker: string, icon: ResolvedIcon = { slug: def.icon ?? "default" }): PublicPower {
    return {
        id: def.id,
        title: resolveText(def.title, ticker),
        description: resolveText(def.description, ticker),
        type: def.type ?? "market",
        iconSlug: icon.slug,
        ...(icon.url ? { iconUrl: icon.url } : {}),
        ...(def.iconCredit ? { iconCredit: def.iconCredit } : {}),
        isInstant: def.instant ?? false,
        rarity: def.weight,
        price: def.price,
        durationTicks: def.durationSeconds ?? 0,
    };
}

/** A power plus the folder its files live in (for resolving its icon). */
export interface PowerEntry {
    definition: AnyPowerDefinition;
    /** The mod's folder. Without it, `icon` can only name a built-in UI icon. */
    dir?: string;
}

export class PowerRegistry {
    private readonly byId = new Map<string, AnyPowerDefinition>();
    private readonly icons = new Map<string, ResolvedIcon>();
    /** Served mod files: URL path → absolute file path. */
    readonly assets = new Map<string, string>();

    constructor(entries: (AnyPowerDefinition | PowerEntry)[]) {
        for (const entry of entries) {
            const { definition: def, dir } = "definition" in entry ? entry : { definition: entry, dir: undefined };
            const problems = powerProblems(def);
            if (problems.length) throw new Error(`invalid power "${def?.id}": ${problems.join("; ")}`);
            if (this.byId.has(def.id)) throw new Error(`duplicate power id "${def.id}"`);
            this.byId.set(def.id, def);
            this.icons.set(def.id, this.resolveIcon(def, dir));
        }
    }

    get(id: string): AnyPowerDefinition | undefined {
        return this.byId.get(id);
    }

    all(): AnyPowerDefinition[] {
        return [...this.byId.values()];
    }

    ids(): string[] {
        return [...this.byId.keys()];
    }

    /** Powers that can appear in briefcases, minus the ids a room switched off. */
    offerable(disabled: readonly string[] = []): AnyPowerDefinition[] {
        return this.all().filter((d) => d.weight > 0 && !disabled.includes(d.id));
    }

    publicOf(def: AnyPowerDefinition, ticker: string): PublicPower {
        return toPublicPower(def, ticker, this.icons.get(def.id));
    }

    publicList(ticker: string): PublicPower[] {
        return this.all().map((d) => this.publicOf(d, ticker));
    }

    /**
     * `icon: "stop"` is a built-in UI icon. `icon: "robber-hand.svg"` is a file inside the mod's
     * folder: it must exist and must not escape the folder, otherwise the power gets the
     * "missing" icon (with a warning) rather than failing the whole server.
     */
    private resolveIcon(def: AnyPowerDefinition, dir: string | undefined): ResolvedIcon {
        const icon = def.icon ?? "default";
        if (!IMAGE_EXTENSIONS.test(icon)) return { slug: icon };

        const problem = (why: string): ResolvedIcon => {
            log.warn(`power "${def.id}": icon "${icon}" ${why}; using the "${MISSING_ICON}" icon`);
            return { slug: MISSING_ICON };
        };
        if (!dir) return problem("is a file but the power has no mod folder");
        const root = resolve(dir);
        const file = resolve(root, icon);
        const rel = relative(root, file);
        if (!rel || rel.startsWith("..") || isAbsolute(rel)) return problem("points outside the mod folder");
        if (!existsSync(file) || !statSync(file).isFile()) return problem(`was not found in ${root}`);

        const url = `${POWER_ASSET_PREFIX}/${def.id}/${rel.split(sep).map(encodeURIComponent).join("/")}`;
        this.assets.set(url, file);
        return { slug: "default", url }; // the slug is only a fallback for UIs that predate iconUrl
    }
}

export const BUILTIN_POWERS_DIR = join(import.meta.dir, "defs");

function acceptPower(value: unknown, source: ModuleSource): PowerEntry {
    const definition = value as AnyPowerDefinition;
    const problems = powerProblems(definition);
    if (problems.length) throw new Error(`${source.path}: ${problems.join("; ")}`);
    return { definition, dir: source.dir };
}

/** Load built-in powers plus every mod directory (single files or folders with their own assets). */
export async function loadPowerRegistry(extraDirs: string[] = []): Promise<PowerRegistry> {
    const entries: PowerEntry[] = [];
    for (const dir of [BUILTIN_POWERS_DIR, ...extraDirs]) {
        entries.push(...(await loadModules(dir, acceptPower)));
    }
    return new PowerRegistry(entries);
}
