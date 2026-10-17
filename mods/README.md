# Mods

Custom powers and bot strategies live here, separate from the built-ins in `src/`. Everything in
`mods/powers/` and `mods/bots/` is loaded at startup and validated (a broken mod stops the server
with a message naming the file). Restart the server after adding or changing a mod.

## Layout

A mod is either a single file or a folder with an `index.ts`. Use a folder when the mod ships
files of its own, such as an icon:

```
mods/
  powers/
    siphon/                 folder mod
      index.ts              export default definePower({ ... icon: "robber-hand.svg" })
      robber-hand.svg       served to players at /assets/powers/siphon/robber-hand.svg
    quick-cash.ts           single-file mod (icon: "present", a built-in UI icon)
  bots/
    my-bot.ts               export default defineBot({ ... })
```

Names starting with `_` (e.g. `_wip/`) are ignored, which is handy for disabling a mod.

## Writing a power

```ts
import { definePower } from "@mod";

export default definePower({
    id: "siphon",                       // unique, kebab-case
    title: "Siphon",
    description: "Drains money from another player.",
    icon: "robber-hand.svg",            // file in this folder, or a built-in UI icon name like "stop"
    iconCredit: { author: "DarkZaitzev", url: "https://game-icons.net/1x1/darkzaitzev/robber-hand.html", license: "CC BY 3.0" },
    type: "others",
    weight: 15,                         // briefcase odds, higher = more common
    durationSeconds: 10,
    onActivate(ctx) { /* ... */ },
    onTick(ctx) { /* ... */ },
    onExpire(ctx) { /* ... */ },
});
```

- `@mod` (see `src/mod.ts`) is the stable API for mods: `definePower`, `defineBot`, `defineNews`,
  the bot helpers and the types. Don't import from deeper inside `src/`.
- Icons: svg, png, webp, jpg or gif, referenced relative to the mod's folder (subfolders are fine).
  Only files a power references are served. If the file is missing, or points outside the folder,
  the power still loads with a "missing" icon and the server logs a warning.
- Players' browsers get the list of installed powers and preload every mod icon when they connect
  (the `CONTENT_MANIFEST` message), so nothing needs to change in the UI to add a power.
- `available: (game) => boolean` (mod API 3) keeps a power out of a game's briefcases, e.g. a
  power about bank loans when the room turned borrowing off (see `powers/too-big-to-fail/`).
- Full reference: `.claude/skills/add-power/SKILL.md` and `.claude/skills/add-bot/SKILL.md`.

## Animations

A power can ask players' screens to play an animation the UI has built in. Mods never send
front-end code: they pick a `kind` and fill in its data, and the server decides the outcome.

```ts
ctx.present(ctx.player, { kind: "wheel", segments: [{ label: "Bust" }, { label: "+$500", color: "#16a34a" }], result: 1 });
```

Only `"wheel"` exists so far (see `spin-the-wheel/`). Report the outcome with a normal notification
once the animation is over (pay out in `onExpire`): apps that don't know a kind skip the animation,
but the toast still reaches them.

## Versions

`MOD_API_VERSION` (exported by `@mod`, defined in `src/version.ts`) counts what mods can use. Set
`apiVersion` on a power to the version it needs (2 for `ctx.present()`; default 1). A server with an
older API refuses to start with that mod and says why, rather than failing mid-game. The app's
footer shows the server's version, the app's, and the mods API version the app supports.

Mods outside this repo can be loaded with `POWER_MODS_DIR` / `BOT_MODS_DIR`. The `@mod` alias only
resolves inside this repo, so external mods should import by relative path (or export a plain
object).
