import { MessageType } from "../types";
import type { Room } from "./room";
import type { ServerWebSocket } from "./roomManager";


export class SpectatorClientManager {
    map: Map<string, ServerWebSocket> = new Map();
    constructor(public room:Room) {
    }

    sendPortfolioUpdate = () => {
        const spectators = Array.from(this.map.values());
        const portfolioStates = this.room.getClients().map(client => client.getPortfolioWithPnL(this.room.simulator?.marketPrice || this.room.settings.openingPrice || 0));
        const message = JSON.stringify({
            type: 'SPECTATOR_PORTFOLIO_UPDATE',
            portfolios: portfolioStates
        });
        spectators.forEach(ws => ws.send(message));
    }

    sendRoomState() {
        const spectators = Array.from(this.map.values());
        const roomState = this.room.roomState;
        const message = JSON.stringify({
            type: MessageType.ROOM_STATE,
            ...roomState
        });
        spectators.forEach(ws => ws.send(message));
    }

    addSpectator(ws: ServerWebSocket) {
        this.map.set(ws.data.id, ws);
        if(this.room.isStarted){
            this.room.spectatorManager.sendRoomState()
        }
        ws.subscribe(this.room.roomId);
    }

    removeSpectator(ws: ServerWebSocket) {
        this.map.delete(ws.data.id);
        ws.unsubscribe(this.room.roomId);
    }

    get roomId() {
        return this.room.roomId;
    }

}