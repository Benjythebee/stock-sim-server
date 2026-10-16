# stock-sim-server

Real-time WebSocket server for a multiplayer stock-trading party game. Friends join a room and trade one fictional ticker against each other and AI bots on a real order book. Every so often a briefcase offers them "powers" (Mario Kart-style items).

- Runtime: **Bun ≥ 1.3** + TypeScript 7, no build step. There are **zero runtime dependencies**; the matching engine is our own.
- Frontend: `../stock-sim-ui` (React 19 + Vite + zustand, separate repo). It **duplicates** the wire protocol, so see "Wire protocol" below.

## Commands

```bash
bun install
bun run dev          # watch mode on localhost:3000 (env: PORT, HOST, LOG_LEVEL, ...; see src/config.ts)
bun run check        # typecheck + all tests. Run this before calling anything done.
bun test             # ~140 tests, < 2s
bun test test/engine # one folder
bun run simulate -- --bots 10 --minutes 5   # headless whole-game market sim (tuning bots / price model)
bun run load -- --clients 50 --rate 50      # spawns a server and hammers it over real WebSockets
```

`.claude/launch.json` has `server` and `ui` configs for the browser preview. The UI one runs `bun run --cwd ../stock-sim-ui dev`.

## Architecture

```
src/
  index.ts              boot: load config + catalog, start server
  config.ts             env vars (PORT, HOST, CORS_ORIGIN, RECONNECT_GRACE_MS, ORDER_RATE/BURST, FLUSH_MS, POWER_MODS_DIR, BOT_MODS_DIR, LOG_LEVEL)
  catalog.ts            loads powers + bots + news once (built-ins, then mods/); shared by every room
  mod.ts                the public mod API, imported by mods as "@mod" (tsconfig path alias)
  log.ts                leveled logger. Never log unconditionally in hot paths.
  modules.ts            loadModules(dir): discovers `<name>.ts` and `<name>/index.ts` mods (skips _*, .*, *.test.*)
  engine/               PURE: no I/O, no timers. Unit-tested to the hilt.
    money.ts            cents/ticks <-> dollars, limits
    rng.ts              seeded mulberry32 Rng (+ fork, weightedSample)
    ring-buffer.ts      fixed-size numeric history
    order-book.ts       price-time-priority matching engine (integer ticks, fills reported to the caller)
    account.ts          cash/shares/reserved/tradingLocks per participant
    market.ts           OrderBook + Accounts: validation, reservations, settlement, mark price, dirty flags
    price-model.ts      hidden intrinsic value + GBM guide price, shocks, stackable volatility boosts
  game/
    game.ts             one match: Market, PriceModel, bots, powers, news. Driven by advance() (no timers)
    room.ts             lobby/membership/admin/lifecycle + network side; owns a Game
    room-manager.ts     all rooms + ONE shared 200ms ticker
    player.ts           human player (survives reconnects), RateLimiter, lockTrading()
    settings.ts         GameSettings, defaults, applySettingsUpdate() sanitizer
  protocol/
    messages.ts         MessageType enum + ClientMessage / ServerMessage types (the wire contract)
    parse.ts            validates every inbound frame into a typed ClientMessage (or null)
  server/server.ts      Bun.serve: HTTP routes + WS upgrade + dispatch to rooms
  bots/                 types.ts (defineBot, BotView), bot.ts (runtime), registry.ts, house.ts, strategies/*.ts
  powers/               types.ts (definePower, PowerContext), manager.ts, registry.ts (validation + icon assets), defs/*.ts
mods/                   community/custom content: powers/<id>/index.ts (+ assets) or powers/<id>.ts, bots/... (see mods/README.md)
  news/                 types.ts (defineNews), manager.ts, catalog.ts
test/                   mirrors src/ (+ helpers.ts with FakeSocket/FakeHost/makeGame)
scripts/                load.ts, simulate.ts
```

### Time and the loop

- `RoomManager` runs one `setInterval(200ms)` and calls `room.tick()` on every room. A running room calls `game.advance()`.
- `Game.advance()` is **one market step**: the price model steps, every bot takes a turn (starting at a rotating index), then the step counter increments. Every 5th step is a **game second** (`onSecond`): `CLOCK`, `DEBUG_PRICES`, intrinsic drift, news, powers, end-of-game check. Then `flush()`.
- All scheduling (briefcases, news, power durations, game end) is counted in **game seconds**, which only advance while the game is running. So when the *admin* pauses, a 15s DDoS doesn't silently expire during the break, and the next briefcase doesn't arrive while nobody can play. Briefcases, news and powers never pause the game themselves; they are live gameplay, and only `TOGGLE_PAUSE` from the admin changes the phase (tested in `room.test.ts`). Never use `setTimeout`/`Date.now()` for gameplay timing.
- The UI's clock is `game.clock` = `startClock + elapsedSeconds * 1000` (epoch ms; candles are keyed on it).

### Output and performance model

- `game.flush()` sends **only what changed**: `STOCK_MOVEMENT` if the mark price changed, `ORDER_BOOK_UPDATE` if the book version changed, `PORTFOLIO_UPDATE` per dirty account. It runs at the end of every step and, after player actions, through `room.scheduleFlush()` (a ≤ `FLUSH_MS` coalescing timer). So 1,000 orders in a burst produce one depth broadcast, not 1,000.
- Room-wide messages go through `room.broadcast()` → Bun pub/sub (`server.publish`), serialized once. Private messages use `player.send()`.
- Depth is capped at 25 levels per side; `game.depthMessageJson()` caches the serialized depth per book version.
- Measured (scripts/load.ts, 50 clients × 50 orders/s): ~4% CPU, p99 ping 1.7ms, 0.45 MB/s out. The old server at the same load: 36% CPU, p99 85ms, 24 MB/s. 200 clients × 25 orders/s: 15% CPU, p99 10ms.
- Hot paths: `Game.advance`, `Bot.turn`, `Market.limit/market`, `OrderBook.match`, `Room.handle`, `parseClientMessage`. Avoid allocation and logging there. `Bot` reuses itself as its `BotView`.

### Trading model (engine/market.ts)

- Prices are **integer ticks (cents)** internally, and cash is integer cents. Dollars exist only at the edges (wire, settings, price model, bot/power APIs).
- Placing an order **reserves** what it could cost: cash at the limit price for buys, shares for sells. Fills settle both accounts (the maker's price wins, and the taker's surplus reservation is released). Cancels release. Market buys are budget-capped to available cash. Market orders are IOC.
- Invariants (tested by randomized property tests): total cash and shares are conserved, no available/reserved balance is ever negative, and reserved amounts equal what's resting on the book.
- **Mark price** = last trade clamped inside the best bid/ask. It is "the price" everywhere (UI, P&L, bots), so it follows the quotes even when nobody trades.
- Human takers move the guide price (`Game.onTrade` → `model.absorbTrade`), weighted by trade size. That's the players' market impact.
- The **house market maker** (`bots/house.ts`, `settings.houseLiquidity`, default on) quotes a 5-level ladder around the guide every step, so the market is always two-sided and tracks the model. It isn't selectable and isn't listed in results.

### Rooms (game/room.ts)

- Phases: `lobby` → `running` ⇄ `paused` → `ended`. Settings are editable **only in the lobby**; each update rebuilds the Game (fresh accounts for everyone).
- The first player is admin. Admin passes to the next player when the admin is *removed* (after the reconnect grace period, default 60s), not on a brief disconnect.
- Reconnect: the `ID` message carries `<roomId>-<playerId>`. The UI sends it back as `?prevSessionData=` and gets the same seat back. A newer socket for the same player **detaches the old one without closing it**. Closing it makes the UI reconnect in a loop.
- Orders are only accepted while running, and are rate-limited per player (token bucket, `ORDER_RATE`/`ORDER_BURST`).
- The room is disposed once its last player is removed.

## Wire protocol (keep both repos in sync)

- JSON `{ type: MessageType, ...fields }`, with a **numeric** `type`. Defined in `src/protocol/messages.ts`, mirrored by hand in `../stock-sim-ui/src/types/messages.ts`; the UI's handler is `src/context/game.context.ts`. Use the `/add-message-type` skill.
- Every inbound message is validated in `protocol/parse.ts`. Unknown or server-only types are dropped. Add a case there for every new client message.
- Notable semantics: `TOGGLE_PAUSE` server→client carries the absolute `paused` boolean. `CLIENT_STATE` is `{ tradingDisabled }`. `PORTFOLIO_UPDATE.value` has `cash`/`shares` = *available*, plus `pnl`, `reservedCash` and `reservedShares`. `ORDER_BOOK_UPDATE.depth` = `[asks, bids]` in dollars. `ADMIN_SETTINGS.marketVolatility` arrives as a percentage and is stored as a fraction. `DEBUG_PRICES` (hidden fair value + guide) is only broadcast when the lobby setting `revealPrices` is on (default off), because anyone can read it off the socket.
- After `ROOM_STATE` the UI assumes starting cash, so a real `PORTFOLIO_UPDATE` must always follow it. `Room.sendWelcome` and `updateSettings` do this.
- `CONTENT_MANIFEST` (18) is sent right after `ID` on every connect: all installed powers (built-ins + mods, as PublicPower) and the server-hosted asset URLs to preload. The UI uses it as its power catalog. PublicPower has `iconUrl` (server-relative, for mod-shipped icons) which wins over `iconSlug` (built-in UI icon), plus optional `iconCredit`. The UI falls back to `/powers/missing.svg` when an icon fails to load.
- HTTP: `/api/powers.json` (PublicPower[]), `/api/bots.json` (`{data:[{id,name,description}]}`), `/assets/powers/<id>/<file>` (only files a power references; routes built at startup), `/zhealth`.

## Extending the game (the "mod" surface)

- **Where**: built-ins live in `src/powers/defs/` and `src/bots/strategies/`; new/custom content goes in `mods/powers/` and `mods/bots/` (plus any `POWER_MODS_DIR` / `BOT_MODS_DIR`). Load order: built-ins, `mods/`, env dirs. Ids must be unique across all of them.
- **Shape**: a mod is a single file or a folder with `index.ts`. Folders can ship assets: `icon: "robber-hand.svg"` resolves inside the mod folder and is served at `/assets/powers/<id>/...`; a missing or out-of-folder file degrades to the "missing" icon with a warning (it doesn't fail startup). Mods import from `"@mod"` only. Example: `mods/powers/siphon/`.
- **Powers**: default-export `definePower({...})`. Use the `/add-power` skill.
- **Bots**: default-export `defineBot({...})`. Use the `/add-bot` skill. Check behaviour with `bun run simulate -- --only YourBot`.
- **News**: add a `defineNews({...})` to `src/news/catalog.ts`.
- Hooks from mods run inside try/catch: a throwing power is logged and skipped, and a bot that throws 3 times is benched for the game.

## Conventions

- 4-space indent, double quotes, `type` imports (`verbatimModuleSyntax`), `strict` + `noUncheckedIndexedAccess` (indexing yields `T | undefined`).
- Gameplay randomness comes **only** from seeded `Rng`s forked off the game seed (`rng.fork(salt)`), never `Math.random()`. A game with the same seed and inputs replays exactly (tested).
- Temporary effects must be **reversible and stackable**: `model.boostVolatility(x)` and `player.lockTrading()` return a release function. Store it in the power's `state` and call it in `onExpire`.
- Keep `engine/` free of game/network imports. New logic should be testable without sockets: the tests drive `Game` and `Room` directly via `test/helpers.ts`.
- Every bug fix gets a regression test. Every new module gets a test file mirroring its path.

## Known gaps / ideas

- There's no persistence. Rooms live in memory, and a restart drops games.
- `Bun 1.3`: `server.stop(true)` hangs if the server just closed sockets itself. `GameServer.stop()` works around this (graceful stop first). Re-check on Bun upgrades.
- UI side (`../stock-sim-ui`): the server URL comes from `VITE_SERVER_URL` (default: same host as the page, port 3000, so LAN play works). `useAutoConnect` reconnects with backoff and respects an intentional Disconnect. `?debug` turns on console logging of every message.
