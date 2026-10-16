# Stock Market Simulation Server

Real-time multiplayer server for a stock-trading party game. Friends join a room, trade a fictional ticker against each other and AI bots on a real limit order book, and grab Mario Kart-style **powers** from briefcases during the session.

Frontend: [stock-sim-ui](https://github.com/Benjythebee/stock-sim-ui)

## Features

- 🏢 **Rooms**: any number of rooms per server, with lobby settings (starting cash, opening price, volatility, duration, bots, ticker, news)
- 📈 **Real exchange**: price-time-priority matching engine with limit and market orders, cash/share reservations and exact integer-cent accounting
- 🤖 **Bots**: liquidity providers, momentum, mean reversion, informed, partially informed, random and spread traders, plus an always-on house market maker
- 🎁 **Powers as mods**: drop a file in `src/powers/defs/` (or a `POWER_MODS_DIR`) and it shows up in briefcases
- 📰 **News** that moves the stock's fair value
- 🔁 **Reconnects**: refresh the page and you keep your seat, cash and shares
- 🎲 **Deterministic**: the same seed and the same inputs give the same game
- ⚡ **Fast**: one shared ticker, coalesced broadcasts and Bun pub/sub. 200 players × 25 orders/s run at ~15% of one core.

## Quick start

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
bun install
bun run dev        # http://localhost:3000, WebSocket at ws://localhost:3000/ws/<roomId>
```

| Script | |
|---|---|
| `bun run dev` | watch mode |
| `bun run start` | run without watch |
| `bun run check` | typecheck + tests |
| `bun test` | tests only |
| `bun run simulate -- --bots 10 --minutes 5` | headless market simulation report |
| `bun run load -- --clients 50 --rate 50` | load test over real WebSockets |

## Configuration (environment)

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `HOST` | `localhost` | use `0.0.0.0` to accept remote connections |
| `CORS_ORIGIN` | `*` | for the JSON API |
| `LOG_LEVEL` | `info` | `debug` logs every inbound message |
| `RECONNECT_GRACE_MS` | `60000` | how long a disconnected player keeps their seat |
| `ORDER_RATE` / `ORDER_BURST` | `20` / `40` | per-player order rate limit (per second / burst) |
| `FLUSH_MS` | `50` | max delay before price/depth/portfolio updates go out after an order |
| `POWER_MODS_DIR` / `BOT_MODS_DIR` | none | extra directories of power / bot modules (`;` or `,` separated) |

## API

- `GET /zhealth`: `{ ok, rooms }`
- `GET /api/powers.json`: the power catalog
- `GET /api/bots.json`: selectable bot strategies
- `WS /ws/:roomId?username=…[&spectator][&prevSessionData=<id from the ID message>]`

The message protocol (numeric `type` + fields) is documented in [`src/protocol/messages.ts`](src/protocol/messages.ts).

## Writing a power

```ts
// src/powers/defs/margin-call.ts
import { definePower } from "../types";

export default definePower({
    id: "margin-call",
    title: "Margin Call",
    description: "Freeze everyone else's trading for 10 seconds.",
    icon: "stop",
    type: "others",
    weight: 10, // higher = more common in briefcases
    durationSeconds: 10,
    state: () => ({ releases: [] as (() => void)[] }),
    onActivate: (ctx) => {
        ctx.state.releases = ctx.others.map((p) => p.lockTrading());
    },
    onExpire: (ctx) => ctx.state.releases.forEach((release) => release()),
});
```

Restart the server and it's in the game. See [`.claude/skills/add-power/SKILL.md`](.claude/skills/add-power/SKILL.md) for the full API. Bots work the same way ([`add-bot`](.claude/skills/add-bot/SKILL.md)).

## Architecture

See [CLAUDE.md](CLAUDE.md). In short: a pure, unit-tested `engine/` (order book, accounts, market, price model, RNG); `game/` (Game = one match driven step by step, Room = lobby/network, RoomManager = shared ticker); `protocol/`; `server/`; and the mod folders `bots/`, `powers/` and `news/`.

## License

MIT
