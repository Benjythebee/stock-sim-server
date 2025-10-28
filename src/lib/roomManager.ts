import { Room } from "./room";

export type WSParams = {
    roomId: string;
    id: string;
}

export type ServerWebSocket = Bun.ServerWebSocket<WSParams>

export type BunServer = Bun.Server<WSParams>


export class RoomManager {
    rooms: Map<string, Room>;
    server?: BunServer;
    reservedRoomIds: Set<string> = new Set();
    constructor() {
        this.rooms = new Map();
    }

    getRoom(roomId: string): Room | undefined {
        return this.rooms.get(roomId);
    }

    setServer(server: BunServer) {
        this.server = server;
    }

    createRoom(roomId: string): Room {
        const room = new Room(this,roomId);
        this.rooms.set(roomId, room);
        room.setup();

        return room;
    }

    deleteRoom(roomId: string): boolean {
        return this.rooms.delete(roomId);
    }

    listRooms(): string[] {
        return Array.from(this.rooms.keys());
    }

    clearRooms(): void {
        this.rooms.clear();
    }

    roomCount(): number {
        return this.rooms.size;
    }
}

const roomManager = new RoomManager();
export default roomManager;



function parseJSON(message: string): any {
    try {
        return JSON.parse(message);
    } catch (error) {
        console.error("Failed to parse JSON:", error);
        return null;
    }
}