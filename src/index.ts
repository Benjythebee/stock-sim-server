import { loadCatalog } from "./catalog";
import { loadConfig } from "./config";
import { log } from "./log";
import { createServer } from "./server/server";

const config = loadConfig();
const catalog = await loadCatalog(config);
const { server, stop } = createServer(config, catalog);

log.info(
    `stock-sim-server listening on http://${server.hostname}:${server.port} ` +
        `(${catalog.powers.all().length} powers, ${catalog.bots.enabled().length} bot strategies)`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
        log.info(`${signal}: shutting down`);
        await stop();
        process.exit(0);
    });
}
