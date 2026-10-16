/**
 * Headless market simulation: runs a whole game with bots only (no sockets, no timers) and
 * prints how the market behaved. Use it to tune bot strategies or the price model.
 *
 *   bun scripts/simulate.ts --bots 10 --minutes 5 --seed 42 --volatility 5 [--only MomentumBot,RandomBot] [--no-house]
 */
import { loadCatalog } from "../src/catalog";
import { Game } from "../src/game/game";
import { DEFAULT_SETTINGS, applySettingsUpdate } from "../src/game/settings";
import { MessageType, type ServerMessage } from "../src/protocol/messages";

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i++) {
    const key = Bun.argv[i]!.replace(/^--/, "");
    const next = Bun.argv[i + 1];
    if (next && !next.startsWith("--")) {
        args.set(key, next);
        i++;
    } else args.set(key, "true");
}

const catalog = await loadCatalog();
const settings = applySettingsUpdate(
    DEFAULT_SETTINGS,
    {
        bots: Number(args.get("bots") ?? 10),
        gameDuration: Number(args.get("minutes") ?? 5),
        seed: Number(args.get("seed") ?? 42),
        marketVolatility: Number(args.get("volatility") ?? 5),
        enableRandomNews: true,
        houseLiquidity: !args.has("no-house"),
        botSelection: args.get("only")?.split(","),
    },
    catalog.bots.enabledIds(),
);

const counts = new Map<string, number>();
let lastDepthLevels = [0, 0];
const game = new Game(settings, catalog, {
    broadcast(msg: ServerMessage) {
        counts.set(MessageType[msg.type], (counts.get(MessageType[msg.type]) ?? 0) + 1);
        if (msg.type === MessageType.ORDER_BOOK_UPDATE) lastDepthLevels = [msg.depth[0].length, msg.depth[1].length];
    },
});

let absGap = 0;
let samples = 0;
let oneSided = 0;
const started = performance.now();
while (!game.ended) {
    game.advance();
    absGap += Math.abs(game.market.price - game.model.guide) / game.model.guide;
    samples++;
    if (game.market.book.bestBid() === null || game.market.book.bestAsk() === null) oneSided++;
}
const ms = performance.now() - started;

const conclusion = game.conclusion();
const negative = game.bots.filter((b) => b.account.cash < 0 || b.account.shares < 0 || b.account.reservedCash < 0 || b.account.reservedShares < 0);

console.log(
    JSON.stringify(
        {
            settings: { bots: settings.bots, minutes: settings.gameDuration, seed: settings.seed, vol: settings.marketVolatility, house: settings.houseLiquidity },
            simulatedSteps: game.step,
            wallMs: +ms.toFixed(0),
            usPerStep: +((ms * 1000) / game.step).toFixed(1),
            trades: game.market.tradeCount,
            volume: conclusion.volumeTraded,
            price: { open: settings.openingPrice, close: game.market.price, high: conclusion.highestPrice, low: conclusion.lowestPrice },
            guideTracking: { meanAbsGapPct: +((absGap / samples) * 100).toFixed(2), oneSidedBookPct: +((oneSided / samples) * 100).toFixed(1) },
            finalDepthLevels: { asks: lastDepthLevels[0], bids: lastDepthLevels[1] },
            restingOrders: game.market.book.size,
            accountsWithNegativeBalances: negative.map((b) => b.id),
            messages: Object.fromEntries(counts),
            bots: conclusion.bots.map((b) => `${b.name}: pnl ${b.pnl.toFixed(0)}`),
        },
        null,
        2,
    ),
);
