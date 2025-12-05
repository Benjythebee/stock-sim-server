import { MessageType, type IsAdminMessage, type Message, type NotificationMessage } from "../types";
import { Client } from "./client";
import { parseMessageJson } from "./parse";
import type { RoomManager } from "./roomManager";
import { OrderBook } from 'nodejs-order-book'
import { Simulator } from "./simulator";
import { SeededRandomGenerator } from "./seededRandomGenerator";
import { NewsFactory } from "./news/news";
import { PowerFactory } from "./powers/power";
import { SpectatorClientManager } from "./spectatorClient";

export type WebSocketWithRoomData = Bun.ServerWebSocket<{
        roomId: string;
        id: string;
        username: string;
        spectator?: boolean;
    }>;

export type GameSettings = {
    startingCash: number;
    openingPrice: number;
    seed: number;
    marketVolatility: number; // percentage from 1 to 100
    gameDuration: number; // in minutes
    enableRandomNews: boolean;
    bots: number;
    ticketName: string;
}
export class Room {
    roomId: string;
    clientMap: Map<string, Client> = new Map();
    orderBook: OrderBook;
    randomGenerator: SeededRandomGenerator
    simulator: Simulator | null = null;
    spectatorManager:SpectatorClientManager
    newsFactory: NewsFactory | null = null;
    powerFactory: PowerFactory | null = null;
    time: number = 0;
    settings: GameSettings = {
        startingCash: 10000,
        marketVolatility: 0.05,
        seed: 42,
        enableRandomNews: true,
        openingPrice: 1,
        gameDuration: 5,
        bots: 0,
        ticketName: 'AAPL',
    }
    state: {
        started: boolean;
        ended: boolean;
    }

    adminClient: Client | null = null;

    constructor(public roomManager: RoomManager, roomId: string) {
        this.roomId = roomId;
        this.clientMap = new Map();
        this.orderBook = new OrderBook();
        this.state = {
            started: false,
            ended: false,
        }

        this.randomGenerator = new SeededRandomGenerator(this.settings.seed);

        this.spectatorManager = new SpectatorClientManager(this);
    }

    get server(){
        return this.roomManager.server;
    }

    setup=()=> {

        if(this.simulator) {
            this.simulator.dispose()
            this.simulator = null;
        }; // already set up
        this.randomGenerator = new SeededRandomGenerator(this.settings.seed);
        this.simulator = new Simulator({
            initialPrice: this.settings.openingPrice,
            seed: this.settings.seed,
            marketInfluence: 0.02,
            marketVolatility: this.settings.marketVolatility,
            gameDuration: this.settings.gameDuration,
            meanReversion: 0.03,
        });

        this.simulator!.onPrice = (price)=>{
            if(!price || typeof price !== 'number'){
                console.warn("No price generated in room", this.roomId,price);
                return;
            }
            const depth = this.simulator!.orderBookW.orderBook.depth();
            this.sendToAll({type: MessageType.STOCK_MOVEMENT, price, depth});
        }
        this.simulator.onDebugPrices = (prices)=>{
            if(!prices || typeof prices !== 'object'){
                console.warn("No prices generated in room", this.roomId,prices);
                return;
            }
            this.sendToAll({type: MessageType.DEBUG_PRICES, intrinsicValue: prices.intrinsicValue, guidePrice: prices.guidePrice});
        }

        this.simulator.onClockTick = (clock)=>{
            const timeLeft = Math.max(0, (this.settings.gameDuration * 60 * 1000) - (this.simulator!.totalTime));
            this.sendToAll({type: MessageType.CLOCK, value: clock, timeLeft});
        }

        this.simulator.onEnd = ()=>{
            console.log("Game ended in room", this.roomId);
            this.setState({ended:true});
            this.sendToAll({
                type: MessageType.GAME_CONCLUSION, 
                players: this.getClients().map(c=>({ name: c.name, ...c.getPortfolioWithPnL(this.simulator?.marketPrice || 0)})), 
                bots: this.simulator!.bots.map((c)=>({ name:c.name, type: c.type, ...c.getPortfolioWithPnL(this.simulator?.marketPrice || 0)})),
                volumeTraded: this.simulator!.orderBookW.totalValueProcessed,
                highestPrice: this.simulator!.orderBookW.highestPrice,
                lowestPrice: this.simulator!.orderBookW.lowestPrice
            });
        }

        if(this.settings.bots > 0){
            this.simulator.createBots(this.settings.bots, this.randomGenerator);
            this.simulator.bots.forEach(bot=>{
                this.simulator!.orderBookW.registerClientObserver(bot)
            })

            console.log(`Created ${this.settings.bots} bots in room`, this.simulator.bots.map(b=>b.id));
        }

        this.newsFactory = new NewsFactory(this, this.simulator!, this.settings.enableRandomNews);
        this.simulator.onClockObservable.add(this.newsFactory.tick);
        this.powerFactory = new PowerFactory(this, this.simulator!);
        this.simulator.onClockObservable.add(this.powerFactory.tick);

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
        return !!this.simulator?.isPaused;
    }
    get isStarted() {
        return this.state.started;
    }
    get isEnded() {
        return this.state.ended;
    }
    /**
     * Sends a "NOTIFICATION" message to specific clients in the room
     */
    notify(clients: Client[], message: Omit<NotificationMessage, 'type'>) {
        clients.forEach(client=>{
            client.send({
                type: MessageType.NOTIFICATION,
                ...message
            });
        });
    }
    /**
     * Sends a "NOTIFICATION" message to all clients in the room
     */
    notifyAll(message: Omit<NotificationMessage, 'type'>) {
        this.sendToAll({
            type: MessageType.NOTIFICATION,
            ...message
        });
    }

    setState = (state: Partial<typeof this.state>) => {
        this.state = {...this.state, ...state};
    }

    togglePause= () => {
        if(!this.simulator) return;
        if(this.isEnded) {
            console.warn("Cannot toggle pause, game has ended in room", this.roomId);
            return;
        }
        if(this.isPaused){
            if(!this.isStarted){
                this.setState({started:true});
                // set clock to now on game start
                this.simulator.clock = Date.now();
            }
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
        /**
         * Transform market volatility from percentage to decimal
         */
        if(settings.marketVolatility !== undefined){
            if(!settings.marketVolatility || isNaN(settings.marketVolatility)) settings.marketVolatility = 0.05;
            if(settings.marketVolatility < 0.001) settings.marketVolatility = 0.001;
            if(settings.marketVolatility > 100) settings.marketVolatility = 1;
            settings.marketVolatility = settings.marketVolatility/100;
        }

        /**
         * Clean other settings
         */
        if(settings.startingCash !== undefined){
            if(!settings.startingCash || isNaN(settings.startingCash)) settings.startingCash = 10000;
            if(settings.startingCash < 0) settings.startingCash = 0;
            if(settings.startingCash > 999_999_999) settings.startingCash = 999_999_999;
        }
        
        if(settings.gameDuration !== undefined){
            if(!settings.gameDuration || isNaN(settings.gameDuration)) settings.gameDuration = 5;
            if(settings.gameDuration < 1) settings.gameDuration = 1;
            if(settings.gameDuration > 60) settings.gameDuration = 60;
        }

        if(settings.openingPrice !== undefined){
            if(!settings.openingPrice || isNaN(settings.openingPrice)) settings.openingPrice = 1;
            if(settings.openingPrice < 0.01) settings.openingPrice = 0.01;
            if(settings.openingPrice > 10_000) settings.openingPrice = 10_000;
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

    addSpectatorClient(ws: WebSocketWithRoomData){
        this.spectatorManager.addSpectator(ws);
    }

    addClient(ws: WebSocketWithRoomData) {
        const existingClient = this.clientMap.get(ws.data.id);
        if(existingClient){
            existingClient.reconnect(ws)
            return
        }else{
            this.sendToAll({type:MessageType.JOIN, id:ws.data.id, username: ws.data.username, roomId:this.roomId})
        }

        const client = new Client(ws, this);
        client.name = ws.data.username || ws.data.id;
        this.clientMap.set(client.id, client);
        
        //@FIX ME; this sends ID to the client to handle re-connects; a bit of an awkward hack tbh
        client.send({type:MessageType.ID, id:this.roomId+'-'+client.id});

        if(this.clientMap.size === 1){
            this.adminClient = client;
            client.send({type:MessageType.IS_ADMIN})
        }

        this.sendRoomState(client);
    }

    get roomState() {
        return {
            paused: this.isPaused,
            started: this.isStarted,
            ended: this.isEnded,
            settings: this.settings,
            roomId: this.roomId,
            clock: this.simulator ? this.simulator.clock : 0,
            clients: this.clientMap.size,
            price: this.simulator ? this.simulator.marketPrice : this.settings.openingPrice,
        }
    }

    sendRoomState = (client:Client)=>{
    
        client.send({type:MessageType.ROOM_STATE, ...this.roomState} );
    }
}