---
name: add-power
description: Add or change a briefcase power (Mario Kart-style item) in the stock-sim game. Use when the user asks to create, design, balance or tweak a power/item/ability that players pick from the briefcase.
---

# Adding a power

New powers are **mods**: `mods/powers/<id>/index.ts` (a folder, when the power ships its own icon or other files) or `mods/powers/<id>.ts` (a single file). Each default-exports `definePower({...})` and imports only from `"@mod"`. They're auto-discovered at startup and validated (a bad power stops the server with a clear error naming the file). Nothing else needs registering: `/api/powers.json`, the `CONTENT_MANIFEST` sent to every client on connect (which preloads icons), briefcases, inventory and activation all come from the registry. Built-in powers live in `src/powers/defs/` (same format, importing `../types`). See `mods/README.md` and the example `mods/powers/siphon/`.

## 1. Template

```ts
// mods/powers/my-power/index.ts   (+ mods/powers/my-power/icon.svg)
import { definePower } from "@mod";

export default definePower({
    id: "my-power",                 // kebab-case, unique across built-ins and mods; match the folder name
    title: "My Power",              // or ({ ticker }) => `...$${ticker}...`
    description: "What the card says.",
    icon: "icon.svg",               // a file in the mod folder (svg/png/webp/jpg/gif, subfolders ok), served by the server,
                                    // OR a built-in UI icon name: default, present, stop, talk, volatility-storm
    iconCredit: { author: "...", url: "...", license: "CC BY 3.0" }, // required for CC-BY packs like game-icons.net
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

Current weights, for balancing: heritage/homeless/ddos 40, rumor 20, insider-tip 15, siphon 15, dark-pool 15, golden-parachute 15, embargoed-press-release 15, wiretap 15, burner-phone 15, special-dividend 15, copycat 10, fat-finger 10, hot-potato 10, bullet-bill 10, pump-and-dump 10, influencer 10, loan-shark 10, storm 5.

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
| `player.concealTrades()` | hides the player from `onPlayerTrade` listeners (Wiretap, Copycat); returns a release fn; stacks |
| `player.hideMarketImpact()` | the player's taker trades stop moving the guide price; returns a release fn; stacks |
| `ctx.notify(player \| players, {level, title, description})`, `ctx.notifyAll(...)` | toasts (`success` for the initiator, `warning` for victims, by convention) |
| `ctx.publishNews(defineNews-shaped object)` | headline for everyone, with optional `fairValueShock` and `onStart({ model, market, rng })` effect |
| `ctx.onPlayerTrade(fn)` | human players' fills, aggregated per player/side, delivered at the next flush (safe to trade inside); `trade.automatic` marks trades a power made in reaction (skip those to avoid loops); players with `concealTrades()` are left out; unsubscribed when the effect ends |
| `ctx.marketOrder(player, side, qty)` | market order on a player's behalf, recorded in their order history |
| `ctx.dumpShares(maxDrop)` | a rogue non-human trader sweeps the bids down to `maxDrop` below the mark |
| `ctx.activeEffects()` | running power effects (`powerId`, `player`, `state`), e.g. to find who is spying on someone |
| `ctx.upcomingNews(withinSeconds)` | peek at the next catalog headline (`{ news, inSeconds }`) and bring it forward to within that many seconds |
| `ctx.rng` | seeded randomness. **Never `Math.random()`.** |
| `ctx.game` | escape hatch (settings, bots, clock, ...) |

## 3. Rules

- **Anything temporary must be undone in `onExpire`**, through the release functions that `boostVolatility` and `lockTrading` return, stored in `state`. Never save and restore raw values (`prev = model.volatility`): two overlapping activations would restore the wrong value.
- Keep `onTick` cheap. It runs every second for every active power.
- Throwing is contained (logged, then skipped), but don't rely on that.
- Use `ctx.rng` so games stay reproducible from their seed.

## 4. Test it

Add a test file: `test/mods/<id>.test.ts` for mods (see `test/mods/siphon.test.ts`), or cases in `test/powers/builtins.test.ts` for built-ins. `builtinCatalog` in `test/helpers.ts` already includes `mods/`. It activates the power directly (`game.powers.activate(def, player)`), advances game time with `runSeconds(game, n)`, and asserts on accounts, model and received messages (`socket.last(MessageType.NOTIFICATION)`). For a duration power, always assert that the effect is fully undone after `durationSeconds`, including when two activations overlap.

```bash
bun run check
```

## 5. UI side (`../stock-sim-ui`)

Nothing to do for a mod: icons shipped in the mod folder are served by the game server and preloaded by every client on connect. A missing or broken icon shows the "missing" icon automatically. Only a *new built-in* icon name (no file) needs `public/powers/<name>.svg` in the UI plus attribution in `src/components/PowerCards/card.icons.ts`. If the power needs new client behaviour (a new message), use `/add-message-type`.
