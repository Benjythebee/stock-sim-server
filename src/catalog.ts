import { loadBotRegistry } from "./bots/registry";
import { DEFAULT_MOD_DIRS, type ServerConfig } from "./config";
import type { Catalog } from "./game/game";
import { NEWS_CATALOG } from "./news/catalog";
import { loadPowerRegistry } from "./powers/registry";

/**
 * Load every power, bot strategy and news item: built-ins, then `mods/`, then any extra
 * directories from config. Fails loudly on a bad mod.
 */
export async function loadCatalog(config: Pick<ServerConfig, "powerModDirs" | "botModDirs"> = DEFAULT_MOD_DIRS): Promise<Catalog> {
    const [powers, bots] = await Promise.all([loadPowerRegistry(config.powerModDirs), loadBotRegistry(config.botModDirs)]);
    return { powers, bots, news: NEWS_CATALOG };
}
