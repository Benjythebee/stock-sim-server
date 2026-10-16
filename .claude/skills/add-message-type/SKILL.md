---
name: add-message-type
description: Add or change a WebSocket message in the stock-sim protocol, keeping server and ../stock-sim-ui in sync. Use whenever a feature needs a new server->client or client->server message, or changes an existing message's fields.
---

# Adding / changing a protocol message

The protocol is defined twice, by hand: `src/protocol/messages.ts` (server) and `../stock-sim-ui/src/types/messages.ts` (UI). They must agree on numbers, names and field shapes.

1. **Pick a number** in the right range of `MessageType`: 0-29 core, 30-59 admin, 60-79 lifecycle, 80-89 powers, 99 debug. Never renumber existing values. (`MessageTypeNames` is derived automatically.)
2. **Server types** (`src/protocol/messages.ts`): add the `XMessage` type and put it in `ClientMessage` (inbound) or `ServerMessage` (outbound).
3. **Inbound**: add a `case` to `parseClientMessage` in `src/protocol/parse.ts` that validates and coerces every field (input is untrusted), then handle it in `Room.handle` (`src/game/room.ts`). Player messages go above the admin check; admin-only ones go in the second `switch`. Add tests in `test/protocol/parse.test.ts` and `test/game/room.test.ts`.
4. **Outbound**: room-wide → `room.broadcast(msg)` / `game.broadcast(msg)` (pub/sub, serialized once). Private → `player.send(msg)`. High-frequency data should be emitted from `Game.flush()` through a dirty flag, never once per event.
5. **Reconnects**: if a (re)joining client needs the state, send it in `Room.sendWelcome`. Remember the UI resets cash on `ROOM_STATE`, so the portfolio must come after it.
6. **UI** (`../stock-sim-ui`): mirror the type in `src/types/messages.ts` and handle it in `src/context/game.context.ts` (`handleGameMessage`). Send through `useWebsocketContext().sendMessage`.
7. **Verify**:
   - `bun run check` here
   - `npx tsc -b` in `../stock-sim-ui` (one pre-existing error in `power-settings.tsx` is known)
   - the enums match: `diff <(grep -oE '^\s+[A-Z_]+ = -?[0-9]+' src/protocol/messages.ts | tr -d ' ') <(grep -oE '^\s+[A-Z_]+ ?= ?-?[0-9]+' ../stock-sim-ui/src/types/messages.ts | tr -d ' ')`
