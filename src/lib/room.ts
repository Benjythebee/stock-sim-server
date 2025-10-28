import { MessageType, type IsAdminMessage, type Message } from "../types";
import { Client } from "./client";
import { parseMessageJson } from "./parse";
import { StockPriceGenerator } from "./priceGenerator";
import type { RoomManager, ServerWebSocket } from "./roomManager";
import { OrderBook } from 'nodejs-order-book'
import { Simulator } from "./simulator";
import { SeededRandomGenerator } from "./seededRandomGenerator";

export type GameSettings = {
    startingCash: number;
    openingPrice: number;
    seed: number;
    marketVolatility: number; // percentage from 1 to 100
    gameDuration: number; // in minutes
    bots: number;
    ticketName: string;
}
export class Room {
    roomId: string;
    clientMap: Map<string, Client> = new Map();
    orderBook: OrderBook;
    randomGenerator: SeededRandomGenerator
    simulator: Simulator | null = null;
    time: number = 0;
    settings: GameSettings = {
        startingCash: 10000,
        marketVolatility: 5,
        seed: 42,
        openingPrice: 1,
        gameDuration: 5,
        bots: 0,
        ticketName: 'AAPL',
    }
    state: {
        paused: boolean;
    }

    adminClient: Client | null = null;

    constructor(public roomManager: RoomManager, roomId: string) {
        this.roomId = roomId;
        this.clientMap = new Map();
        this.orderBook = new OrderBook();
        this.state = {
            paused: true,
        }

        this.randomGenerator = new SeededRandomGenerator(this.settings.seed);
    }

    get server(){
        return this.roomManager.server;
    }

    setup() {

        if(this.simulator) {
            this.simulator = null;
        }; // already set up
        this.randomGenerator = new SeededRandomGenerator(this.settings.seed);
        this.simulator = new Simulator({
            initialPrice: this.settings.openingPrice,
            seed: this.settings.seed,
            marketInfluence: 0.02,
            gameDuration: this.settings.gameDuration,
            meanReversion: 0.05,
        });

        this.simulator!.onPrice = (price)=>{
            const depth = this.simulator!.orderBookW.orderBook.depth();
            this.sendToAll({type: MessageType.STOCK_MOVEMENT, price, depth});
        }
        this.simulator.onClockTick = (clock)=>{
            this.sendToAll({type: MessageType.CLOCK, value: clock});
        }

        this.simulator.onEnd = ()=>{
            console.log("Game ended in room", this.roomId);
        }

        if(this.settings.bots > 0){
            this.simulator.createBots(this.settings.bots, this.randomGenerator);
            this.simulator.bots.forEach(bot=>{
                this.simulator!.orderBookW.registerClientObserver(bot)
            })
        }

        this.clientMap.forEach(client=>{
            client.updateClientInventory({
                initialCash: this.settings.startingCash,
                initialShares: 0,
                seed: this.settings.seed,
            });
            client.onPortfolioUpdate = (portfolio)=>{
                console.log("Sending portfolio update to client", client.id, portfolio);
                client.send({type: MessageType.PORTFOLIO_UPDATE, id:client.id, value: portfolio});
            }
            this.simulator!.orderBookW.registerClientObserver(client);
        });

    }

    get isPaused() {
        return this.state.paused;
    }

    togglePause= () => {
        if(!this.simulator) return;
        if(this.isPaused){
            this.simulator.resume()
        }else if (!this.isPaused){
            this.simulator.pause()
        }
        this.adminClient?.send({type:MessageType.TOGGLE_PAUSE})
        this.server?.publish(this.roomId, JSON.stringify({type:MessageType.TOGGLE_PAUSE}));
    }

    setSettings = (settings: Partial<GameSettings>) => {

        if('bots' in settings && settings.bots! < 0) {
            settings.bots = 0;
        }

        if('bots' in settings && settings.bots! > 50) {
            settings.bots = 50;
        }

        this.settings = {...this.settings, ...settings};
    }

    getClients(): Client[] {
        return Array.from(this.clientMap.values());
    }

    getClient(id: string): Client | undefined {
        return this.clientMap.get(id);
    }

    handleAdminMessage(client: Client, message: string) {
        const msg = parseMessageJson(message);
        if(!msg) return;
    }

    removeClient(client: Client) {
        if(this.adminClient?.id === client.id){
            if(this.clientMap.size > 1){
                const nextAdmin = Array.from(this.clientMap.values()).find(c=>c.id!==client.id)!
                this.adminClient = nextAdmin
                nextAdmin.send({type:MessageType.IS_ADMIN})
            }
        }
        this.sendToAll({type:MessageType.LEAVE, id:client.id, roomId:this.roomId})
        client.close()
        this.clientMap.delete(client.id);
    }

    sendToAll(message: Message) {
        this.server?.publish(this.roomId, JSON.stringify(message));
    }

    sendToAdmin(message: Message) {
        this.adminClient?.send(message);
    }

    dispose() {
        this.clientMap.forEach(client=>{
            client.close();
        });
        this.clientMap.clear();
        if(this.simulator){
            this.simulator.bots = []
            this.simulator?.pause();
            this.simulator = null;
        }
    }

    addClient(ws: ServerWebSocket) {
        this.sendToAll({type:MessageType.JOIN, id:ws.data.id, roomId:this.roomId})
        const client = new Client(ws, this);
        this.clientMap.set(client.id, client);
        if(this.clientMap.size === 1){
            this.adminClient = client;
            client.send({type:MessageType.IS_ADMIN} as IsAdminMessage)
        }

        this.sendRoomState(client);
    }

    sendRoomState = (client:Client)=>{
        
        const roomState = {
            paused: this.isPaused,
            settings: this.settings,
            roomId: this.roomId,
            clock: this.simulator ? this.simulator.clock : 0,
            clients: this.clientMap.size,
        }

        client.send({type:MessageType.ROOM_STATE, ...roomState} );
    }
}