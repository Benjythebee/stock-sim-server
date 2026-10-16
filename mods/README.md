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
    iconCredit: { author: "Lorc", url: "https://game-icons.net/...", license: "CC BY 3.0" },
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
- Full reference: `.claude/skills/add-power/SKILL.md` and `.claude/skills/add-bot/SKILL.md`.

Mods outside this repo can be loaded with `POWER_MODS_DIR` / `BOT_MODS_DIR`. The `@mod` alias only
resolves inside this repo, so external mods should import by relative path (or export a plain
object).
