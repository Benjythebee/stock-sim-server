---
name: add-power
description: Add or change a briefcase power (Mario Kart-style item) in the stock-sim game. Use when the user asks to create, design, balance or tweak a power/item/ability that players pick from the briefcase.
---

# Adding a power

A power is **one file** in `src/powers/defs/<id>.ts` that default-exports `definePower({...})`. It's auto-discovered at startup and validated (a bad power stops the server with a clear error). Nothing else needs registering: `/api/powers.json`, briefcases, inventory and activation all come from the registry. Operators can also drop powers into any directory listed in `POWER_MODS_DIR`.

## 1. Template

```ts
import { definePower } from "../types";

export default definePower({
    id: "my-power",                 // kebab-case, unique; must match the file name by convention
    title: "My Power",              // or ({ ticker }) => `...$${ticker}...`
    description: "What the card says.",
    icon: "default",                // ../stock-sim-ui/public/powers/<icon>.svg (default, present, stop, talk, volatility-storm)
    type: "market",                 // "client" | "others" | "all" | "market" (UI styling only)
    instant: false,                 // true = fires on pick; false = goes to inventory, used later
    weight: 10,                     // briefcase odds; HIGHER = MORE COMMON; 0 = never offered
    durationSeconds: 15,            // 0/omitted = one-shot (then onTick/onExpire are not allowed)
    state: () => ({ release: null as null | (() => void) }), // fresh per activation

    onActivate(ctx) { /* apply the effect */ },
    onTick(ctx) { /* every game second while active */ },
    onExpire(ctx) { /* undo the effect */ },
});
```

Current weights, for balancing: heritage/homeless/ddos 40, rumor 20, insider-tip 15, storm 5.

## 2. What `ctx` gives you (src/powers/types.ts)

| | |
|---|---|
| `ctx.player` / `ctx.players` / `ctx.others` | the initiator / all humans / all humans but the initiator |
| `ctx.state` | this activation's state (from `state()`) |
| `ctx.power` | resolved public info (`title`, `description`, ...) |
| `ctx.secondsLeft` | seconds left on the effect |
| `ctx.model` | price model: `.boostVolatility(x)` → release fn, `.applyShock(perStep, steps)`, `.shockIntrinsic(fraction)`, `.intrinsic`, `.guide`, `.volatility` |
| `ctx.market` | exchange: `.price` (mark, $), `.book.bestBid()/bestAsk()` (ticks), `.limit/market/cancelAll(account, ...)` |
| `ctx.giveCash(player, dollars)` | credit/debit available cash; the portfolio update is sent automatically |
| `player.lockTrading()` | disables trading; returns a release fn; stacks correctly with other locks |
| `ctx.notify(player \| players, {level, title, description})`, `ctx.notifyAll(...)` | toasts (`success` for the initiator, `warning` for victims, by convention) |
| `ctx.publishNews(defineNews-shaped object)` | headline for everyone, with optional `onStart({ model, market, rng })` effect |
| `ctx.rng` | seeded randomness. **Never `Math.random()`.** |
| `ctx.game` | escape hatch (settings, bots, clock, ...) |

## 3. Rules

- **Anything temporary must be undone in `onExpire`**, through the release functions that `boostVolatility` and `lockTrading` return, stored in `state`. Never save and restore raw values (`prev = model.volatility`): two overlapping activations would restore the wrong value.
- Keep `onTick` cheap. It runs every second for every active power.
- Throwing is contained (logged, then skipped), but don't rely on that.
- Use `ctx.rng` so games stay reproducible from their seed.

## 4. Test it

Add cases to `test/powers/builtins.test.ts` (built-ins) using the `arena()` helper pattern there. It activates the power directly (`game.powers.activate(def, player)`), advances game time with `runSeconds(game, n)`, and asserts on accounts, model and received messages (`socket.last(MessageType.NOTIFICATION)`). For a duration power, always assert that the effect is fully undone after `durationSeconds`, including when two activations overlap.

```bash
bun run check
```

## 5. UI side (`../stock-sim-ui`)

- A new icon needs `public/powers/<icon>.svg` (game-icons.net) plus an attribution entry in `src/components/PowerCards/card.icons.ts`.
- Otherwise nothing changes: the UI reads `/api/powers.json` and `POWER_OFFERS`. If the power needs new client behaviour (a new message), use `/add-message-type`.
