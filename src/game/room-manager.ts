import type { ServerConfig } from "../config";
import { log } from "../log";
import { STEP_MS, type Catalog } from "./game";
import { Room, type RoomHost, type Transport } from "./room";

/** Room ids come from the URL; keep them short and boring. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * All rooms on this server, plus the single shared ticker that drives them. One timer for the
 * whole process, instead of two per room, keeps the event loop calm with many rooms.
 */
export class RoomManager implements RoomHost {
    readonly rooms = new Map<string, Room>();
    private ticker: ReturnType<typeof setInterval> | null = null;

    constructor(
        readonly catalog: Catalog,
        readonly config: ServerConfig,
        readonly transport: Transport,
    ) {}

    get(roomId: string): Room | undefined {
        return this.rooms.get(roomId);
    }

    getOrCreate(roomId: string): Room {
        let room = this.rooms.get(roomId);
        if (!room) {
            room = new Room(roomId, this);
            this.rooms.set(roomId, room);
            log.info(`[${roomId}] created (${this.rooms.size} rooms)`);
            this.ensureTicker();
        }
        return room;
    }

    roomEmpty(room: Room): void {
        this.rooms.delete(room.id);
        room.dispose();
        log.info(`[${room.id}] closed (${this.rooms.size} rooms)`);
        if (this.rooms.size === 0) this.stopTicker();
    }

    /** Advance every running room by one step. Exposed for tests. */
    tickAll(): void {
        for (const room of this.rooms.values()) {
            try {
                room.tick();
            } catch (err) {
                log.error(`[${room.id}] tick failed`, err);
            }
        }
    }

    dispose(): void {
        this.stopTicker();
        for (const room of this.rooms.values()) room.dispose();
        this.rooms.clear();
    }

    private ensureTicker(): void {
        if (!this.ticker) this.ticker = setInterval(() => this.tickAll(), STEP_MS);
    }

    private stopTicker(): void {
        if (this.ticker) clearInterval(this.ticker);
        this.ticker = null;
    }
}
