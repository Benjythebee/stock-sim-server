import { Side } from "nodejs-order-book";
import { MessageType, type IsAdminMessage, type Message, type StockMessage } from "../types";
import { parseMessageJson } from "./parse";
import type { Room } from "./room";
import type { ServerWebSocket } from "./roomManager";
import { TradingParticipant, type InventoryConfig } from "./bot";
import { SeededRandomGenerator } from "./seededRandomGenerator";
import { decimal } from "./math";


export class Client extends TradingParticipant{
    ws: ServerWebSocket;
    disconnectedAt: number | null = null;
    constructor(ws: ServerWebSocket, public room:Room, {initialCash, initialShares,seed}: Partial<InventoryConfig> = {
        initialCash: 10000,
        initialShares: 0,
        seed: 42
    }) {
        super(ws.data.id, {initialCash, initialShares, seed});
        this.ws = ws;
        this.id = ws.data.id;
        this.ws.subscribe(this.room.roomId);
    }

    toggleDisabledTrading = (disable: boolean) => {
        this.tradingDisabled = disable;
        this.sendState();
    }

    sendState=()=> {
        this.send({
            type: MessageType.CLIENT_STATE,
            disabled: this.tradingDisabled
        })
    }

    updateClientInventory = (inventoryConfig: Partial<InventoryConfig>) => {
        this.randomGenerator = new SeededRandomGenerator(inventoryConfig.seed || 42);
        this._availableCash = inventoryConfig.initialCash || 10000;
        this.setInitialCash(this._availableCash);
        this._shares = inventoryConfig.initialShares || 0;
        this.onPortfolioUpdate?.(this.getPortfolioWithPnL(this.room.simulator?.marketPrice || this.room.settings.openingPrice || 0));
    }

    get isWebSocket(){
        return true;
    }

    get roomId() {
        return this.room.roomId;
    }

    handleMessage(message: string) {
        const messageObj = parseMessageJson(message);
        if(!messageObj) {
            console.warn("Invalid message received", message);
            return;
        }
    }

    handleStockAction(message: StockMessage) {
        let order = null;

        const orderId = `${this.id}-$-${Date.now()}`
        if(message.action === 'BUY') {
            const q = Number(message.quantity)>0?Number(message.quantity):0;
            if(message.orderType==='MARKET') {
                const price = this.room.simulator!.orderBookW.orderBook.marketPrice;
                const cost = decimal(price * q, 3);
                if (this.availableCash >= cost) {
                    const onTotalCostComputed = ({totalCost}:{totalCost:number,totalQ:number}) => {
                        this._lockedCash += totalCost;
                        this.availableCash -= totalCost;
                    }
                    order = this.room.simulator?.orderBookW.addMarketOrder(this.id,orderId, Side.BUY,q,onTotalCostComputed);
                }
            }else{
                const cost = decimal(Number(message.price) * q, 3);
                if (this.availableCash >= cost) {
                    this._lockedCash += cost;
                    this.availableCash -= cost;
                    const p = Number(message.price)>0?Number(message.price):0;
                    order = this.room.simulator?.orderBookW.addLimitOrder(this.id,orderId,Side.BUY,p,q);
                }
            }
        }else if(message.action === 'SELL'){
            const q = Number(message.quantity)>0?Number(message.quantity):0;
            console.log("Attempting to sell", q, "shares", "have", this.shares);
            if (this.shares >= q) {
                if(message.orderType==='MARKET') {
                    const onTotalCostComputed = ({totalQ}:{totalCost:number,totalQ:number}) => {
                        this._lockedShares += totalQ;
                        this.shares -= totalQ;
                    }
                    order = this.room.simulator?.orderBookW.addMarketOrder(this.id,orderId, Side.SELL,q,onTotalCostComputed);
                }else{
                    this._lockedShares += q;
                    this.shares -= q;
                    const p = Number(message.price)>0?Number(message.price):0;
                    order = this.room.simulator?.orderBookW.addLimitOrder(this.id,orderId,Side.SELL,p,q);
                }
            }
        }

        const updatedPrice = this.room.simulator!.orderBookW.orderBook.marketPrice;
        if(updatedPrice){
            console.log("Updated market price to", updatedPrice);
            this.room.simulator!.generator.guidePrice = updatedPrice
            this.room.simulator!.onPrice?.(updatedPrice);
        }

        // this.onPortfolioUpdate!(this.portfolio);
    }
    
    send(message: Message) {
        this.ws.send(JSON.stringify(message));
    }

    close() {
        this.ws.unsubscribe(this.roomId);
        this.ws.close();
    }

    isAlive(): boolean {
        return this.ws.isSubscribed(this.roomId);
    }

    _disconnectTimeout:NodeJS.Timeout | null = null;
    markAsDisconnected() {
        this.disconnectedAt = Date.now();
        this._disconnectTimeout = setTimeout(() => {
            console.log("Removing disconnected client", this.id, "from room", this.room.roomId);
            if(this._disconnectTimeout){
                clearTimeout(this._disconnectTimeout);
            }
            this.room.removeClient(this);
            if(this.room.clientMap.size === 0){
                this.room.dispose();
            }
        }, 1 * 60 * 1000); // 1 minute
    }

    reconnect(ws: ServerWebSocket) {
        console.log(`[${this.roomId}]`,"Reconnecting client", this.ws.data.id,'with username', this.name, "in room");

        this.disconnectedAt = null;
        if(this._disconnectTimeout){
            clearTimeout(this._disconnectTimeout);
            this._disconnectTimeout = null;
        }


        this.ws=ws
        this.id = ws.data.id;

        this.room.sendRoomState(this);

        this.ws.subscribe(this.room.roomId);

        if(this.room.adminClient?.id === this.id){
            this.send({type:MessageType.IS_ADMIN} as IsAdminMessage)
        }

        if(this.room.isStarted){
            this.send({
                type:MessageType.PORTFOLIO_UPDATE,
                value: this.getPortfolioWithPnL(this.room.simulator?.marketPrice || 0),
                id: this.id
            })
            this.room.powerFactory?.sendInventoryToClient(this);
        }

        this.sendState();
        
    }
}