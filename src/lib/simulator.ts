import { OrderBook, Side } from 'nodejs-order-book'
import { StockPriceGenerator } from './priceGenerator';
import { InformedBot,PartiallyInformedBot, LiquidityBot, MeanReversionBot, MomentumBot, RandomBot, type TradingBot, getAllAvailableBots } from './bot';
import { OrderBookWrapper } from './orderBookWrapper';
import { parseJSON } from './parse';
import type { SeededRandomGenerator } from './seededRandomGenerator';
import { Observable } from './observable';

export type Snapshot = ReturnType<OrderBook['snapshot']>

const botClasses = getAllAvailableBots()

export type SimulatorSettings = {
        initialPrice: number,
        seed: number,
        gameDuration: number,
        marketVolatility: number,
        marketInfluence: number,
        meanReversion: number,
        botSelection?: string[],
    }

export class Simulator {
    uuid: string = crypto.randomUUID();
    orderBookW: OrderBookWrapper;
    generator: StockPriceGenerator;
    /**
     * Total time elapsed in milliseconds
     */
    public totalTime = 0;
    clock: number = Date.now();
    onClockObservable:Observable<number> = new Observable<number>();
    tickInterval: NodeJS.Timeout | null = null;
    clockInterval: NodeJS.Timeout | null = null;
    private _paused: boolean = true;
    bots: TradingBot[] = [];
    private settings : SimulatorSettings;
    private timestampsForIntrinsicChanges: number[] = [];

    constructor(settings: Partial<SimulatorSettings> = {}) {

        const {botSelection, ...restSettings} = settings;

        this.settings = {
            initialPrice: 10,
            seed: 42,
            gameDuration: 5,
            marketInfluence: 0.02,
            marketVolatility: 0.05,
            meanReversion: 0.05,
            botSelection:botSelection??botClasses.map(ClassName=>ClassName.name),
            ...restSettings
        };

        if(this.settings.botSelection && this.settings.botSelection.length > 0){
            this.settings.botSelection = this.settings.botSelection.filter((botType)=>botClasses.map(c=>c.name).includes(botType));
        }

        this.orderBookW = new OrderBookWrapper();
        const generator = new StockPriceGenerator({
            initialPrice: this.settings.initialPrice,
            drift: 0.0005,        // Slight upward trend
            volatility: this.settings.marketVolatility,     // 2% volatility
            seed: this.settings.seed,
            meanReversionStrength: this.settings.meanReversion,
        });
        this.generator = generator;

        const clockTime = 1000; // 1 second
        
        const endTime = Date.now() + this.settings.gameDuration*60*1000;
        // 8 seconds (arbitrary buffer) or divide remaining time into 10 segments
        const interval = Math.max(8000, (endTime - Date.now() - 8000) / 10);

        let nextTimestamp = Date.now() + interval;
        while(nextTimestamp < endTime - 8000) {
            this.timestampsForIntrinsicChanges.push(nextTimestamp);
            nextTimestamp += interval;
        }

        this.clockInterval = setInterval(() => this.clockTick(clockTime), clockTime);
        this.tickInterval = setInterval(() => this.tick(), 200);


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

    get isPaused() {
        return this._paused;
    }

    ended = () => {
        return this.totalTime >= this.settings.gameDuration * 60 * 1000;
    }

    private clockTick(clockTime: number = 1000) {
        if(this._paused) return;
        this.clock += clockTime;
        this.totalTime += clockTime;
        this.onClockTick?.(this.clock);
        
        if(this.timestampsForIntrinsicChanges.length >0 && this.clock >= this.timestampsForIntrinsicChanges[0]!) {
            this.generator.driftIntrinsicValue(0.05)
            this.timestampsForIntrinsicChanges.shift();
        }

        this.onClockObservable.notifyObservers(this.clock);
        this.onDebugPrices?.({
            intrinsicValue: this.intrinsicValue,
            guidePrice: this.guidePrice,
        })

        if(this.ended()) {
            this.pause();
            this.onEnd?.();
        }
    }

    snapshot: Snapshot = {bids: [], asks: []} as any
    generateCachedSnapshot(){
        this.snapshot = this.orderBookW.orderBook.snapshot();
    }

    createBots(count:number,randomGenerator: SeededRandomGenerator) {
        const allowedSelection = new Set(this.settings.botSelection);
        const filteredBotClasses = botClasses.filter(botClass => allowedSelection.has(botClass.name));
        const random = randomGenerator.next.bind(randomGenerator);
        for(let i=0;i<count;i++){
            const BotClass = filteredBotClasses[Math.floor(random() * random() * filteredBotClasses.length)]!;
            const bot = new BotClass(`${BotClass.name}${i}`, {
                initialCash: this.settings.initialPrice*1000+100000, // inifinite cash for bots
                initialShares: BotClass.name ==='LiquidityBot' ? 10 : Math.floor(random()*1000),
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

    private _intrinsicValue: number | null = null;
    get intrinsicValue(): number {
        return this._intrinsicValue || this.settings.initialPrice;
    }
    private _guidePrice: number | null = null;
    get guidePrice(): number {
        return this._guidePrice || this.settings.initialPrice;
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

            if(bot.makeDecision(this.marketPrice,this.generator.history,this,this.snapshot,intrinsicValue,this.marketPrice)){
                updatedPrice = this.marketPrice;
                // console.log('updated price:',updatedPrice);
                // this.generator.setMarketPrice(updatedPrice)
                if(updatedPrice !== lastPrice){
                    this.onPrice?.(updatedPrice);
                    lastPrice = updatedPrice;
                }
            }
        });
            // this.onPrice?.(updatedPrice);
        this._intrinsicValue = intrinsicValue;
        this._guidePrice = guidePrice;
    }


    dispose() {
        if(this.tickInterval){
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
        if(this.clockInterval){
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }

        this.bots = [];
        this.pause();
        if(this.onEnd){
            this.onEnd = undefined;
        }
        if(this.onPrice){
            this.onPrice = undefined;
        }
        if(this.onClockTick){
            this.onClockTick = undefined;
        }
        if(this.onDebugPrices){
            this.onDebugPrices = undefined;
        }
        if(this.orderBookW){
            this.orderBookW.dispose();
            this.orderBookW = null!;
        }
        this.onClockObservable.clear()

        if(this.generator){
            this.generator.dispose();
            this.generator = null!;
        }
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
