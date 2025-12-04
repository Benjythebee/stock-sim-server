import { OrderBook, OrderType, Side, type ICancelOrder, type IProcessOrder } from 'nodejs-order-book'
import type { TradingParticipant } from './bot';
import { decimal } from './math';
import type { IMarketOrder } from 'nodejs-order-book/dist/types/types';

export type Order ={id:string,side: Side, price: number, quantity: number, time: number}
type NonUndefined<T> = T extends undefined ? never : T;

export type IOrder = ICancelOrder['order'] | NonUndefined<ICancelOrder['stopOrder']>
export type ILimitOrder = NonUndefined<IProcessOrder['partial']>
export type IStopOrder = NonUndefined<ICancelOrder['stopOrder']>
export enum TimeInForce {
    GTC = "GTC",
    IOC = "IOC",
    FOK = "FOK"
}
export class OrderBookWrapper {
    orderBook: OrderBook;

    orderByIDs: Map<string, [Map<number, Order[]>, Map<number, Order[]>]> = new Map();
     
    observerMap: Map<string, (x: {orderId:string, price:number, quantity: number, cost:number}) => void> = new Map();

    lastOrderProcessed: {orderId:string, quantity: number, cost:number} | null = null;

    totalValueProcessed: number = 0;
    highestPrice: number = 0;
    lowestPrice: number = 0;

    constructor() {
        this.orderBook = new OrderBook();

        // this.orderBook.limit({
        //     id: 'dummy-sell',
        //     side: Side.SELL,
        //     price: 1,
        //     size: 5
        // })
    }

    registerClientObserver(participant:TradingParticipant) {
        // console.log("Registering observer for client", participant.id);
        this.observerMap.set(participant.id,participant.onOrderProcessed);
    }

    getOrderByID(id:string) {
        return this.orderByIDs.get(id);
    }

    private _computeprocessedCash(order:IOrder|ILimitOrder, partialQuantityProcessed?:number) {
        if(!order) return null!
        // console.log("Computing: ", order.size, partialQuantityProcessed, 'price' in order ? order.price : null, 'stopPrice' in order ? order.stopPrice : null);
        const quantity = partialQuantityProcessed?partialQuantityProcessed:order.size
        // console.log("Computed quantity:", order.type, quantity);
        if(order?.type === 'limit') {
            const o = (order as ILimitOrder)!
            const cost = o.price * quantity
            return {orderId:o.id, price: o.price, cost: order.side==Side.BUY ? cost : -cost, quantity: order.side==Side.BUY ? quantity : -quantity};
        }else{
            const o = (order as IStopOrder)!
            const cost = o.stopPrice * quantity
            return {orderId:o.id, price: o.stopPrice, cost: o.side==Side.BUY ? cost : -cost, quantity: order.side==Side.BUY ? quantity : -quantity};
        }
    }

    getBookForClient(id:string) {
        const clientOrders = this.getOrderByID(id);
        if(!clientOrders) {
            return {[Side.BUY]:[],[Side.SELL]:[]}
        }
        return [Array.from(clientOrders[0].entries()),Array.from(clientOrders[1].entries())]
    }

    private processDoneOrders=(order: IOrder) =>{
        const clientId = order.id.split('-$-')[0]!;
        const o = this.orderByIDs.get(clientId);
        if(!o) {
            return
        }
        const oSide = order.side==Side.BUY ? o[0] : o[1];

        const oPrice = 'price' in order? order.price : 'stopPrice' in order? order.stopPrice : 0;
        let p = priceFn(oPrice)

        this.totalValueProcessed += order.size*oPrice
        
        if(oPrice > this.highestPrice) {
            this.highestPrice = oPrice;
        }
        if(oPrice < this.lowestPrice) {
            this.lowestPrice = oPrice;
        }

        const handler = (orders: Order[],price:number)=>{
            const clientId = order.id.split('-$-')[0];
            const onOrderProcessed = this.observerMap.get(clientId!);

            orders.splice(orders.findIndex(v=>v.id==order.id),1);
            if(orders.length==0) {
                oSide.delete(price as unknown as number);
            }
            onOrderProcessed && onOrderProcessed(this._computeprocessedCash(order))
        }
        const orders = oSide.get(p);
        
        if(orders) {
            handler(orders,p);
        }
    }

    private processPartialOrder=(order: ILimitOrder|null, partialQuantityProcessed: number|null) =>{
        if(!order) return;
        // get client id from order id
        const cliendId = order.id.split('-$-')[0]!;
        // console.log("Processing partial order for client", cliendId, order,partialQuantityProcessed);
        if(typeof partialQuantityProcessed !== 'number') return;
        const o = this.orderByIDs.get(cliendId);
        if(!o) {
            return
        }
        const oSide = order.side==Side.BUY ? o[0] : o[1];
        let p = priceFn(order.price)

        this.totalValueProcessed += partialQuantityProcessed * order.price

        if(order.price > this.highestPrice) {
            this.highestPrice = order.price;
        }
        if(order.price < this.lowestPrice) {
            this.lowestPrice = order.price;
        }

        const handler = (orders: Order[])=>{
            const clientId = order.id.split('-$-')[0];
            const onOrderProcessed = this.observerMap.get(clientId!);
            const idx = orders.findIndex(v=>v.id==order.id);
            if(idx!=-1) {
                orders[idx]!.quantity = order.size-partialQuantityProcessed;
            }else{
                orders.push({id:order.id,side:order.side,price:order.price,quantity:order.size-partialQuantityProcessed,time: Date.now()})
            }
            onOrderProcessed && onOrderProcessed(this._computeprocessedCash(order,partialQuantityProcessed))
    }

        const orders = oSide.get(p);
        if(orders) {
            handler(orders);
        }else{
            const orders = oSide.get('market' as unknown as number);
            if(orders && orders.length > 0) {
                handler(orders);
            }
        }
    }


    addLimitOrder(clientID:string, id:string, side: Side, price: number, quantity: number ) {
        const nPrice = priceFn(price)

        let clientOrders = side==Side.BUY ? this.getOrderByID(clientID)?.[0] : this.getOrderByID(clientID)?.[1];
        if(!clientOrders) {
            clientOrders = new Map()
            this.orderByIDs.set(clientID, side==Side.BUY ? [clientOrders,new Map()] : [new Map(),clientOrders]);
        }
        let i = clientOrders.get(nPrice);
        if(i) {
            i.push({id,side,price,quantity,time: Date.now()});
        }else {
            i = [{id,side,price,quantity,time: Date.now()}];
            clientOrders.set(nPrice,i);
        }

        const processed = this.orderBook.limit({
            id,
            side,
            price: nPrice,
            size: quantity
        });

        processed.done.forEach(this.processDoneOrders)
        this.processPartialOrder(processed.partial,processed.partialQuantityProcessed)
        // console.log(this.orderByIDs)
    }

    addMarketOrder(clientID:string,id:string, side: Side, quantity: number, onTotalCostComputed?: (X:{totalCost:number,totalQ:number})=>void) {

        const processed = this.orderBook.market({
            id,
            side,
            size: quantity
        });


        // console.log(processed.done)

        let totalQ = 0
        let totalCost = 0

        const orderByPrice = new Map<number, number>();

        processed.done.forEach((order)=>{
            const price = 'price' in order? priceFn(order.price) : undefined;
            const stopPrice = 'stopPrice' in order? priceFn(order.stopPrice) : undefined;
            const oldSize = orderByPrice.get(price!==undefined ? price : stopPrice!==undefined ? stopPrice : 0) || 0;
            orderByPrice.set(price!==undefined ? price : stopPrice!==undefined ? stopPrice : 0, oldSize+order.size);
            totalQ += order.size;
            totalCost += decimal(order.size * (price!==undefined ? price : stopPrice!==undefined ? stopPrice : 0), 3);
        })
        const doneOrders:ILimitOrder[] = []
        // Contatenate all prices;
        orderByPrice.entries().forEach(([price,quantity],index)=>{
            doneOrders.push({
                id: clientID+'-$-'+Date.now()+index,
                side,
                price,
                size:quantity,
                time: Date.now(),
                type:OrderType.LIMIT,
                timeInForce: TimeInForce.GTC,
                origSize: quantity, takerQty:0, makerQty: 0
            })
        })


        let clientOrders = side==Side.BUY ? this.getOrderByID(clientID)?.[0] : this.getOrderByID(clientID)?.[1];
        if(!clientOrders) {
            clientOrders = new Map()
            this.orderByIDs.set(clientID, side==Side.BUY ? [clientOrders,new Map()] : [new Map(),clientOrders]);
        }

        if(processed.partial && processed.partialQuantityProcessed){
            doneOrders.push({
                id: clientID+'-$-'+Date.now()+'-01',
                side,
                price:processed.partial.price,
                size:processed.partialQuantityProcessed,
                time: Date.now(),
                type:OrderType.LIMIT,
                timeInForce: TimeInForce.GTC,
                origSize: processed.partialQuantityProcessed, takerQty:0, makerQty: 0
            })

            totalCost += decimal((processed.partial.price * processed.partialQuantityProcessed), 3);
            totalQ += processed.partialQuantityProcessed;
        }
        
        doneOrders.forEach((order)=>{
            let i = clientOrders.get(order!.price);
            if(i) {
                i.push({id,side,price:order!.price,quantity,time: Date.now()});
            }else {
                i = [{id,side,price:order!.price,quantity,time: Date.now()}];
                clientOrders.set(order!.price as number,i);
            }
        })

        onTotalCostComputed && onTotalCostComputed({totalCost,totalQ})

        processed.done.forEach(this.processDoneOrders);

        (doneOrders as IOrder[]).forEach(this.processDoneOrders)
        this.processPartialOrder(processed.partial,processed.partialQuantityProcessed)

        return processed.quantityLeft
        // console.log(this.orderByIDs)
    }

    cancelOrder(id:string) {
        this.orderBook.cancel(id);
    }

    dispose() {
        this.orderByIDs.clear();
        this.observerMap.clear();
        this.orderBook=null!
    }
}


const priceFn= (price_:number)=>{
    return parseFloat(price_.toFixed(2));
}
