import { OrderBook, Side } from 'nodejs-order-book'
import { StockPriceGenerator } from './priceGenerator';
import { InformedBot, LiquidityBot, MeanReversionBot, MomentumBot, RandomBot, type TradingBot } from './bot';
import { OrderBookWrapper } from './orderBookWrapper';
import { parseJSON } from './parse';
import type { SeededRandomGenerator } from './seededRandomGenerator';

export type Snapshot = ReturnType<OrderBook['snapshot']>

const botClasses = [LiquidityBot,InformedBot,RandomBot,MomentumBot,MeanReversionBot];

export type SimulatorSettings = {
        initialPrice: number,
        seed: number,
        gameDuration: number,
        marketInfluence: number,
        meanReversion: number,
    }

export class Simulator {

    orderBookW: OrderBookWrapper;
    generator: StockPriceGenerator;
    /**
     * Total time elapsed in milliseconds
     */
    private totalTime = 0;
    clock: number = Date.now();
    tickInterval: NodeJS.Timeout | null = null;
    clockInterval: NodeJS.Timeout | null = null;
    _paused: boolean = true;
    bots: TradingBot[] = [];
    private settings : SimulatorSettings;

    constructor(settings: Partial<SimulatorSettings> = {}) {

        this.settings = {
            initialPrice: 10,
            seed: 42,
            gameDuration: 5,
            marketInfluence: 0.02,
            meanReversion: 0.05,
            ...settings
        };
    
        
        this.orderBookW = new OrderBookWrapper();
        const generator = new StockPriceGenerator({
            initialPrice: this.settings.initialPrice,
            drift: 0.0005,        // Slight upward trend
            volatility: 0.02,     // 2% volatility
            seed: this.settings.seed,
            marketInfluence: this.settings.marketInfluence,
            meanReversion: this.settings.meanReversion
        });
        this.generator = generator;
        
        this.clockInterval = setInterval(() => this.clockTick(), 5000);
        this.tickInterval = setInterval(() => this.tick(), 1000);
    }

    onPrice = undefined as ((price: number) => void) | undefined;
    onDebugPrices = undefined as ((prices: {intrinsicValue: number; guidePrice: number}) => void) | undefined;
    onClockTick = undefined as ((clock: number) => void) | undefined;
    onEnd = undefined as (() => void) | undefined;

    pause = () => {
        this._paused = true;
    }

    resume = () => {
        this._paused = false;
    }

    ended = () => {
        return this.totalTime >= this.settings.gameDuration * 60 * 1000;
    }

    private clockTick() {
        if(this._paused) return;
        this.clock += 1000;
        this.totalTime += 1000;
        this.onClockTick?.(this.clock);

        if(this.ended()) {
            this.pause();
        }
    }

    snapshot: Snapshot = {bids: [], asks: []} as any
    generateCachedSnapshot(){
        this.snapshot = this.orderBookW.orderBook.snapshot();
    }

    createBots(count:number,randomGenerator: SeededRandomGenerator) {
        const random = randomGenerator.next.bind(randomGenerator);
        for(let i=0;i<count;i++){
            const BotClass = botClasses[Math.floor(random() * random() * botClasses.length)]!;
            const bot = new BotClass(`Bot${i}`, {
                initialCash: Infinity, // inifinite cash for bots
                initialShares: Math.floor(random()*10000),
                orderSize: Math.floor(random()*10) + 1,
                seed:this.settings.seed
            });
            this.bots.push(bot);
        }
        return this.bots;
    }

    get marketPrice() {
        return this.orderBookW.orderBook.marketPrice || this.settings.initialPrice;
    }


    tick() {
        if(this._paused) return;
        this.generateCachedSnapshot();

        const {intrinsicValue,guidePrice} = this.generator.tick();
        // console.log(`New guide price: ${guidePrice.toFixed(2)} ${guidePrice < intrinsicValue ? '<' : '>'} ${intrinsicValue.toFixed(2)}`);

        let lastPrice = this.marketPrice;
        let updatedPrice = guidePrice;
        this.bots.forEach(bot => {
            // Should the bot cancel existing orders?
            // bot.shouldCancelOrders(this.marketPrice,this,this.snapshot,guidePrice,intrinsicValue);

            if(bot.makeDecision(this.marketPrice,this.generator.history,this,this.snapshot,intrinsicValue,guidePrice)){
                updatedPrice = this.marketPrice;
                // console.log('updated price:',updatedPrice);
                // this.generator.setMarketPrice(updatedPrice)
                if(updatedPrice !== lastPrice){
                    this.onPrice?.(updatedPrice);
                    lastPrice = updatedPrice;
                }
            }
        });


        this.onDebugPrices?.({
            intrinsicValue,
            guidePrice,
        })
    }

}

// const bots = [
//     new LiquidityBot('LiquidityBot2',{
//         initialCash:15000,
//         initialShares:0,
//         orderSize: 10
//     }),
//     // new MomentumBot('MomentumBot1',{
//     //     initialCash:1800,
//     //     initialShares:500,
//     //     orderSize: 5
//     // }),
//     // new MomentumBot('MomentumBot2',{
//     //     initialCash:1200,
//     //     initialShares:0,
//     //     orderSize: 20
//     // }),
//     new InformedBot('InformedBot1',{
//         initialCash:10000,
//         initialShares:100
//     }),
//     // // new RandomBot('RandomBot1',{
//     // //     initialCash:5000,
//     // //     initialShares:10
//     // // }),
//     // new RandomBot('RandomBot2',{
//     //     initialCash:8000,
//     //     initialShares:0
//     // }),
//     new RandomBot('RandomBot3',{
//         initialCash:3000,
//         initialShares:2000,
//         orderSize: 2
//     }),
//     // new MeanReversionBot('MeanReversionBot1',{
//     //     initialCash:5000,
//     //     initialShares:0
//     // }),
//     // new MeanReversionBot('MeanReversionBot2',{
//     //     initialCash:7000,
//     //     initialShares:100
//     // }),
//     // new InformedBot('InformedBot2',{
//     //     initialCash:10000,
//     //     initialShares:20
//     // }),
//     // new LiquidityBot('LiquidityBot1',{
//     //     initialCash:20000,
//     //     initialShares:1000
//     // }),


// ]


const websocketTest = ()=>{
    const p = new Simulator()
    const server = Bun.serve<{id: string}>({
        port: 3001,
        fetch(req, server) {
            // upgrade the request to a WebSocket
            if (server.upgrade(req,{
                data: {id:crypto.randomUUID()}
            })) {
            return; // do not return a Response
            }
            return new Response("Upgrade failed", { status: 500 });
        },
        websocket: {
            message(ws, message) {
                // console.log("WebSocket message received:", message);
                // console.log("Echoing back:", message);
                const msg = parseJSON(String(message));
                if (msg.type === 'shock') {
                    p.generator.shock(Math.random()*2-1)
                }
                ws.send(message);

            }, // a message is received
            open(ws) {
                console.log("WebSocket opened");
                ws.subscribe("data");
                server.publish("data",JSON.stringify({type: "clock", value: p.clock}));

                // bots.forEach(bot=>{
                //     server.publish("data",JSON.stringify({type: "portfolio", id:bot.id, value: bot.portfolio}));
                // })
            }, // a socket is opened
            close(ws, code, message) {
                console.log("WebSocket closed:", code, message);
            }, // a socket is closed
            drain(ws) {
                console.log("WebSocket drain event");
            }, // the socket is ready to receive more data
        },
    })
    

    p.onPrice = (price)=>{
        const depth = p.orderBookW.orderBook.depth();
        server.publish("data",JSON.stringify({type: "price", value: price, depth}));
    }
    p.onClockTick = (clock)=>{
        server.publish("data",JSON.stringify({type: "clock", value: clock}));
    }
    // p.bots = bots;

    // bots.forEach(bot=>{ 
    //     p.orderBookW.registerClientObserver(bot)
        // bot.onPortfolioUpdate = (portfolio)=>{
        //     server.publish("data",JSON.stringify({type: "portfolio", id:bot.id, value: portfolio}));
        // }
    // })

    p.resume();
    console.log("Simulator started");
}

// websocketTest();
