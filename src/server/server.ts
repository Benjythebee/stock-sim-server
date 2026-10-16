import type { Server, ServerWebSocket } from "bun";
import type { ServerConfig } from "../config";
import type { Catalog } from "../game/game";
import { ROOM_ID_PATTERN, RoomManager } from "../game/room-manager";
import type { SocketData } from "../game/room";
import { DEFAULT_SETTINGS } from "../game/settings";
import { log } from "../log";
import { MessageType, MessageTypeNames } from "../protocol/messages";
import { cleanName, MAX_FRAME_BYTES, parseClientMessage } from "../protocol/parse";
import { versionInfo } from "../version";

const PONG = JSON.stringify({ type: MessageType.PONG });

const usernameOrDefault = (raw: string | null) => cleanName(raw ?? "") || `Trader-${Math.floor(Math.random() * 9000 + 1000)}`;

export interface GameServer {
    server: Server<SocketData>;
    rooms: RoomManager;
    stop(): Promise<void>;
}

/**
 * HTTP + WebSocket front door. Routes:
 *   GET /, /zhealth           health checks
 *   GET /api/powers.json      power catalog (UI cards)
 *   GET /api/bots.json        selectable bot strategies (admin UI)
 *   GET /api/version.json     server version, deployed commit and mod API version (UI footer)
 *   GET /assets/powers/...    files shipped by power mods (icons)
 *   GET /ws/:roomId           WebSocket upgrade. Query: username, spectator, prevSessionData=<roomId>-<playerId>
 */
export function createServer(config: ServerConfig, catalog: Catalog): GameServer {
    let rooms: RoomManager;

    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
            status,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": config.corsOrigin,
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });

    // Catalog responses never change at runtime, so serialize them once.
    const powersBody = catalog.powers.publicList(DEFAULT_SETTINGS.ticketName);
    const botsBody = { data: catalog.bots.enabled().map((d) => ({ id: d.id, name: d.name, description: d.description })) };

    // Files shipped by mods (e.g. power icons). Only files a power explicitly references are served.
    const assetRoutes: Record<string, () => Response> = {};
    for (const [url, file] of catalog.powers.assets) {
        assetRoutes[url] = () =>
            new Response(Bun.file(file), {
                headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": config.corsOrigin },
            });
    }

    const server = Bun.serve<SocketData>({
        port: config.port,
        hostname: config.hostname,
        routes: {
            "/": new Response("OK"),
            "/zhealth": () => json({ ok: true, rooms: rooms.rooms.size }),
            "/api/powers.json": () => json(powersBody),
            "/api/bots.json": () => json(botsBody),
            "/api/version.json": () => json(versionInfo()),
            ...assetRoutes,
            "/ws/:roomId": (req, srv) => {
                const roomId = (req.params as { roomId: string }).roomId;
                if (!ROOM_ID_PATTERN.test(roomId)) return new Response("Invalid room id", { status: 400 });
                const url = new URL(req.url);
                const spectator = url.searchParams.has("spectator");
                // prevSessionData is the ID message we sent earlier: "<roomId>-<playerId>".
                const prev = url.searchParams.get("prevSessionData");
                const resume = prev?.startsWith(`${roomId}-`) ? prev.slice(roomId.length + 1) : null;
                const data: SocketData = { roomId, username: usernameOrDefault(url.searchParams.get("username")), spectator, resume, playerId: null };
                if (srv.upgrade(req, { data })) return undefined;
                return new Response("Upgrade failed", { status: 400 });
            },
        },
        fetch: () => new Response("Not found", { status: 404 }),
        websocket: {
            maxPayloadLength: MAX_FRAME_BYTES,
            idleTimeout: 120,
            backpressureLimit: 1024 * 1024,
            closeOnBackpressureLimit: true,
            open(ws) {
                const { roomId, spectator } = ws.data;
                if (spectator) {
                    const room = rooms.get(roomId);
                    if (!room) {
                        ws.send(JSON.stringify({ type: MessageType.ERROR, message: "Room does not exist" }));
                        ws.close(4004, "Room does not exist");
                        return;
                    }
                    room.spectate(ws);
                    return;
                }
                const player = rooms.getOrCreate(roomId).join(ws);
                log.info(`[${roomId}] ${player.name} connected`);
            },
            message(ws, raw) {
                const msg = parseClientMessage(raw);
                if (!msg) return;
                if (msg.type === MessageType.PING) {
                    ws.send(PONG);
                    return;
                }
                if (log.debugEnabled) log.debug(`[${ws.data.roomId}] ${MessageTypeNames[msg.type]}`, msg);
                rooms.get(ws.data.roomId)?.handle(ws, msg);
            },
            close(ws) {
                rooms.get(ws.data.roomId)?.disconnect(ws);
            },
        },
    });

    rooms = new RoomManager(catalog, config, {
        publish: (topic, data) => server.publish(topic, data),
    });

    return {
        server,
        rooms,
        async stop() {
            rooms.dispose();
            // Bun 1.3: awaiting stop(true) alone hangs if the server just closed sockets itself
            // (rooms.dispose does). Stopping gracefully first, then forcing, resolves promptly.
            void server.stop(false);
            await server.stop(true);
        },
    };
}

export type GameSocket = ServerWebSocket<SocketData>;
