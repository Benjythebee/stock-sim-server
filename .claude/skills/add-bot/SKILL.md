---
name: add-bot
description: Add or tune an AI trading bot strategy for the stock-sim market. Use when the user wants a new kind of bot, wants to change how bots trade, or wants the market to feel different (more volatile, more liquid, more trendy).
---

# Adding a bot strategy

A strategy is a mod: `mods/bots/<name>.ts` (or a `mods/bots/<name>/index.ts` folder) that default-exports `defineBot({...})` and imports from `"@mod"`. Built-ins live in `src/bots/strategies/` (importing `../types` / `../helpers`). It's auto-discovered. Its `id` is what the admin UI stores in `settings.botSelection` and what `/api/bots.json` lists. Operators can add more through `BOT_MODS_DIR`.

```ts
import { ceilCents, defineBot, floorCents, sharesWorth } from "@mod";

export default defineBot({
    id: "MyBot",                       // identifier-like, stable (saved in settings)
    name: "My Bot",
    description: "Shown in the admin UI",
    enabled: true,                     // false = hidden + never spawned
    // inventory: (settings, rng) => ({ cash, shares }),   // dollars/shares; default ≈ 10x starting cash
    create: (rng, settings) => {
        // Per-bot parameters: draw them from rng so bots of the same type differ.
        const size = sharesWorth(settings, rng.range(0.002, 0.01));
        return {
            decide(bot) {                  // every 200ms market step
                bot.cancelAll({ olderThanMs: 5_000 });          // expire stale quotes
                if (!bot.rng.chance(0.3)) return;               // throttle activity
                if (bot.price < bot.guide * 0.98) bot.buy(ceilCents(bot.price * 1.001), size);
            },
        };
    },
});
```

## BotView (src/bots/types.ts)

- **Read**: `price` (mark), `guide`, `intrinsic` (honor system: only "informed" bots should use it), `priceHistory` (traded price per step, a RingBuffer with `.at(-1)`, `.mean(n)`, `.tail(n)`), `step`, `now`, `account` (`availableCash` in cents, `availableShares`, `openOrders`), `bestBid()/bestAsk()` ($ or null), `model.volatility`, `settings`.
- **Act**: `buy/sell(price$, qty)`, `marketBuy/marketSell(qty)`, `cancelAll({ side?, olderThanMs? })`, `orders(side?)`. Every call returns an `OrderOutcome` (`ok` or a rejection `reason`). Invalid orders are rejected safely, never thrown.
- Helpers: `floorCents`/`ceilCents`/`quotePair`/`momentum` in `src/bots/helpers.ts`. Size orders with `sharesWorth(settings, fraction)` so bots scale with starting cash and opening price.

## Rules

- `decide` runs for every bot every 200ms, so keep it O(1)-ish: no book scans and no logging.
- Use `bot.rng` / the `rng` given to `create`, never `Math.random()` (seeded replays).
- Always expire your own orders (`cancelAll({ olderThanMs })`) or cap them (`account.openOrders.size`), or the book fills with stale quotes.
- A bot that throws 3 times is benched for the rest of the game.

## Check it

```bash
bun run simulate -- --bots 6 --only MyBot              # with the house market maker
bun run simulate -- --bots 6 --only MyBot --no-house   # alone with itself
bun run check                                          # test/bots/strategies.test.ts runs every enabled strategy automatically
```

Look at `guideTracking.meanAbsGapPct` (does the market still follow the model?), `oneSidedBookPct`, `restingOrders` (leaks?), `accountsWithNegativeBalances` (must be empty) and the bot P&L list.
