import  { OrderBook, Side, type IProcessOrder } from "nodejs-order-book";
import type { Simulator, Snapshot } from "./simulator";
import type { Order, OrderBookWrapper } from "./orderBookWrapper";
import { roundPrice } from "./priceGenerator";
import { SeededRandomGenerator } from "./seededRandomGenerator";

export type InventoryConfig = { 
  initialCash: number; 
  initialShares: number
  orderSize?: number
  seed?: number
  cancelSpreadTresholdMultiplier?: number
 };
type SimConfig = {
  minimumSpreadCurrency: number;
}

export abstract class TradingParticipant {
  public id: string;
  public name: string = '';
  private initialCash: number;
  protected _lockedCash: number = 0;
  protected _lockedShares: number = 0;
  protected _availableCash: number;
  protected _shares: number

  tradingDisabled: boolean = false;
  
  public randomGenerator: SeededRandomGenerator;
  static description: string = 'Base Trading Participant';

  constructor(id: string, {initialCash, initialShares,seed}: Partial<InventoryConfig> = {
    initialCash: 10000,
    initialShares: 0,
    seed: 42
  }) {
    this.randomGenerator = new SeededRandomGenerator(seed || 42);
    this.id = id;
    this.name = id;
    this._availableCash = initialCash || 10000;
    this.initialCash = this._availableCash
    this._shares = initialShares || 0;
  }

  toString(){
    return `TradingParticipant - ID: ${this.id}, Cash: $${this.availableCash.toFixed(2)}, Shares: ${this.shares}`;
  }

  random=()=>{
    return this.randomGenerator.next();
  }

  get lockedCash(): number {
    return this._lockedCash;
  }

  get lockedShares(): number {
    return this._lockedShares;
  }

  get availableCash(): number {
    return this._availableCash;
  }

  get shares(): number {
    return this._shares;
  }

  setInitialCash (cash: number) {
    this.initialCash = cash;
  }
  // Calculate total P&L including unrealized gains/losses from shares
  getTotalProfitLoss(currentPrice: number): number {
    const shareValue = this.shares * currentPrice;
    const totalValue = this.availableCash + shareValue;
    return totalValue - this.initialCash;
  }
  set availableCash(value: number) {
    this._availableCash = value;
  }

  set shares(value: number) {
    this._shares = value;
  }

  onPortfolioUpdate: ((portfolio: { id:string, cash: number; shares: number,pnl?: number }, currentPrice?: number) => void) | undefined = undefined;

  onOrderProcessed=(result:{orderId:string, price:number, quantity: number, cost:number})=>{
    if(result.cost > 0){
      // Buy order processed
      this._lockedCash -= result.cost; 
      this.shares += result.quantity;
    }else {
      // Sell order processed
      this.availableCash -= result.cost;
      this._lockedShares -= result.quantity;
    }

    this.onPortfolioUpdate?.(this.portfolio);
  }

  get portfolio(): { id:string, cash: number; shares: number } {
    return { id: this.id, cash: this.availableCash, shares: this.shares };
  }

  // Get portfolio with current market price for accurate P&L
  getPortfolioWithPnL(currentPrice: number): { id:string, pnl: number, cash: number; shares: number } {
    return { 
      id: this.id, 
      pnl: this.getTotalProfitLoss(currentPrice), 
      cash: this.availableCash, 
      shares: this.shares 
    };
  }
}

// Trading Bot Base Class
abstract class TradingBot extends TradingParticipant {
  /**
   * Type of bot
   */
  type: string = 'TradingBot';
  protected debug: boolean;
  protected orderSize: number;
  static override description: string = 'Generic Trading Bot';

  constructor(id: string, {initialCash, initialShares, orderSize,  cancelSpreadTresholdMultiplier}: Partial<InventoryConfig> = {
    initialCash: 10000,
    initialShares: 0,
    orderSize: 10,
    cancelSpreadTresholdMultiplier:2
  }, debug: boolean = false) {
    super(id, {initialCash, initialShares});
    this.orderSize = orderSize || (Math.floor(this.random() * 20) + 5); // Default order size between 5 and 25
    this.debug = debug;
    this._cancelSpreadTresholdMultiplier = cancelSpreadTresholdMultiplier || 2;

    if (debug) {
      console.log(`Bot ${this.id} initialized with $${this.availableCash}`);
    }
    
  }

  override toString(): string {
    return `TradingBot - Type: ${this.type}, ID: ${this.id}, Cash: $${this.availableCash.toFixed(2)}, Shares: ${this.shares}`;
  }

  hasBuyOrders = (snapshot:Snapshot, price?:number) =>{
    if(price){
      const buyOrders = snapshot.bids.filter((c)=>c.orders.find((o)=>o.id.includes(this.id))) // bids
      return buyOrders.find((c)=>c.price===price)
    }else{
      return snapshot.bids.some((c)=>c.orders.some((o)=>o.id.includes(this.id))) // bids
    }
  }

  autoCancelOldOrders=(simulator: Simulator, side?: Side, olderThan: number = 10000)=>{
    const orders = simulator.orderBookW.orderByIDs.get(this.id);
    if(!orders) return;
    this.cancelAllOrders(simulator,side,olderThan);
  }


  hasSellOrders = (snapshot:Snapshot, price?:number)=>{
    if(price){
      const sellOrders = snapshot.asks.filter((c)=>c.orders.find((o)=>o.id.includes(this.id))) // asks
      return sellOrders.find((c)=>c.price===price)
    }else{
      /**
       * if we have locked shares we have sell orders
       */
      return this._lockedShares > 0
    }
  }
  abstract makeDecision(
    currentPrice: number, 
    priceHistory: number[], 
    simulator: Simulator,
    snapshot: Snapshot,
    intrinsicPrice?: number,
    guidePrice?: number
  ): boolean;

  protected placeBuyOrder(simulator: Simulator, price: number, quantity: number, type: 'market' | 'limit' = 'limit'): IProcessOrder | null {

    if(this.tradingDisabled) {
      if(this.debug){
        console.log(`Bot ${this.id} trading is disabled. Skipping buy order.`);
      }
      return null;
    }

    const cost = price * quantity;
    if (this.availableCash >= cost) {
        this._lockedCash += cost;
        this.availableCash -= cost;
        const orderId = `${this.id}-$-${Date.now()}`;
        if (type === 'market') {
          return simulator.orderBookW.addMarketOrder(this.id, orderId, Side.BUY, quantity);
        } else {
          return simulator.orderBookW.addLimitOrder(this.id, orderId, Side.BUY, price, quantity);
        }
    }
    return null;
  }


  protected cancelAllOrders(simulator: Simulator, side?: Side, olderThan?: number): ReturnType<OrderBook['cancel']> {
    const orders = simulator.orderBookW.orderByIDs.get(this.id);
    if(!orders) return;


    const cancelSide = (map: Map<number, Order[]>)=>{
      map.forEach((v)=>{
        v.forEach((k)=>{
          let canceled;
          if(olderThan && k.time + olderThan < Date.now()){
            canceled = simulator.orderBookW.orderBook.cancel(k.id);
          }else{
            canceled = simulator.orderBookW.orderBook.cancel(k.id);
          }

          if(canceled){
            this._lockedCash -= canceled.order.price * canceled.order.size;
            this.availableCash += canceled.order.price * canceled.order.size;
            this._lockedShares -= canceled.order.size;
            this.shares += canceled.order.size;
          }
        })
      })
    }

    if(side){
      if(side===Side.BUY){
          cancelSide(orders[0]);
      }else if(side===Side.SELL){
          cancelSide(orders[1]);
      }
      return
    }else{
      cancelSide(orders[0]);
      cancelSide(orders[1]);
    }

    
    orders?.forEach((o)=>{
      cancelSide(o);
    })
  }


  protected placeSellOrder(simulator: Simulator, price: number, quantity: number, type: 'market' | 'limit' = 'limit'): IProcessOrder | null {
    if(this.tradingDisabled) {
      if(this.debug){
        console.log(`Bot ${this.id} trading is disabled. Skipping buy order.`);
      }
      return null;
    }
    if (this.shares >= quantity) {
        this._lockedShares += quantity;
        this.shares -= quantity;
        if(type === 'market'){
          return simulator.orderBookW.addMarketOrder(this.id,`${this.id}-$-${Date.now()}`,Side.SELL,quantity);
        } else {
          return simulator.orderBookW.addLimitOrder(this.id,`${this.id}-$-${Date.now()}`,Side.SELL,price,quantity);
        }
        
      }
      if(this.debug){
        console.log(`Bot ${this.id} placed SELL order: ${quantity} shares at $${price.toFixed(2)}`);
      }
      return null;
  }
  

  getPortfolioValue(currentPrice: number): number {
    return this.availableCash + (this.shares * currentPrice);
  }

  cancelOrder(order:Order,simulator: Simulator): void {
    if(this.tradingDisabled) {
      if(this.debug){
        console.log(`Bot ${this.id} trading is disabled. Skipping buy order.`);
      }
      return;
    }
    let canceled = simulator.orderBookW.orderBook.cancel(order.id);

    if(!canceled) return;
    if(order.side === Side.BUY){
      // Buy order canceled
      this._lockedCash -= canceled.order.price * canceled.order.size;
      this.availableCash += canceled.order.price * canceled.order.size;
    }else {
      // Sell order canceled
      this._lockedShares -= canceled.order.size;
      this.shares += canceled.order.size;
    }
    console.log(`Bot ${this.constructor.name} canceled order: ${order.id}`);
  }

  protected _cancelSpreadTresholdMultiplier=5;
  shouldCancelOrders(currentPrice: number, simulator: Simulator, snapshot?:Snapshot, guidePrice?: number,intrinsicValue?: number): void {
    if(!currentPrice) return ;
    if(!guidePrice) return ;

    const orders = simulator.orderBookW.orderByIDs.get(this.id);

    const threshold = 0.1 *this._cancelSpreadTresholdMultiplier

    if(!orders) return;
    orders.forEach((orderList)=>{
      orderList.forEach((orderArray)=>{
        orderArray.forEach((order)=>{
          const spread = Math.abs(currentPrice - order.price);
          console.log(currentPrice,order.price,spread,threshold)
          if(spread > threshold){
            this.cancelOrder(order,simulator);
          }
        })
      })
    })

  }
}

// Momentum Bot - buys when price is rising, sells when falling
class MomentumBot extends TradingBot {
  /**
   * Type of bot
   */
  override type: string = 'MomentumBot';
  private lookbackPeriod: number;
  static override description: string = 'Follows the momentum of the market. Buys when price is rising, sells when falling';

  constructor(id: string,  inventoryParams:InventoryConfig, lookbackPeriod = 5) {
    super(id, inventoryParams);
    this.lookbackPeriod = lookbackPeriod;
    this._cancelSpreadTresholdMultiplier = inventoryParams.cancelSpreadTresholdMultiplier || 10;
  }

  makeDecision(currentPrice: number, priceHistory: number[], simulator: Simulator, snapshot:Snapshot,intrinsicPrice?: number,guidePrice?: number): boolean {
    if(!currentPrice) return false;
    if(priceHistory.length < 2) return false;
    if (priceHistory.length < this.lookbackPeriod + 1) return false;
    const recentPrices = priceHistory.slice(-this.lookbackPeriod - 1);
    const pastPriceTMinus1 = recentPrices[recentPrices.length - 1]
    const currentPriceT0 = recentPrices[0]
    if(typeof pastPriceTMinus1 !== 'number' || typeof currentPriceT0 !== 'number') return false;
    const momentum = (pastPriceTMinus1 - currentPriceT0) / currentPriceT0

    const priceChange = computePriceChange(guidePrice||currentPrice,0.01,0.001,0.001)
    const priceBuy = priceChange.upPrice;
    const priceSell = priceChange.downPrice;
    
    if (momentum > 0.01 && this.random() > 0.7) {
      // Positive momentum - buy
      const quantity = Math.floor(this.orderSize / (guidePrice||currentPrice));
      // cleanup old orders
      this.autoCancelOldOrders(simulator, Side.BUY, 5000);
      if (quantity > 0) {
        if(this.hasBuyOrders(snapshot,priceBuy)) return false;

        this.placeBuyOrder(simulator, priceBuy, quantity);
        return true;
      }
    } else if (momentum < -0.01 && this.shares > 0 && this.random() > 0.7) {
      // Negative momentum - sell
      // cleanup old orders
      this.autoCancelOldOrders(simulator, Side.SELL, 5000);
      const quantity = this.orderSize
      if (quantity > 0) {
        if(this.hasSellOrders(snapshot,priceSell)) return false;
        this.placeSellOrder(simulator, priceSell, quantity);
        return true;
      }
    }
    return false;
  }
}

// Mean Reversion Bot - buys when price is low, sells when high
class MeanReversionBot extends TradingBot {
  /**
   * Type of bot
   */
  override type: string = 'MeanReversionBot';
  private lookbackPeriod: number;
  static override description: string = 'Buys when price is low compared to recent average, sells when high';

  constructor(id: string, inventoryParams: InventoryConfig, lookbackPeriod = 20) {
    super(id, inventoryParams);
    this.lookbackPeriod = lookbackPeriod;
  }

  makeDecision(currentPrice: number, priceHistory: number[], simulator: Simulator, snapshot:Snapshot,intrinsicPrice?:number,guidePrice?: number): boolean {
    if(!currentPrice) return false;
    if(priceHistory.length < 2) return false;
    if (priceHistory.length < this.lookbackPeriod) return false;

    const average = priceHistory.slice(-this.lookbackPeriod).reduce((sum, price) => sum + price, 0) / this.lookbackPeriod;

    const priceChange = computePriceChange((guidePrice||currentPrice),0.01,0.005,0.005)

    // Use guide price to adjust mean reversion threshold
    if ((guidePrice||currentPrice) < average * 0.98 && this.random() > 0.5) {
      // Price significantly below guide - buy
      const quantity = Math.floor(this.orderSize / (guidePrice||currentPrice));
            // cleanup old orders
      this.autoCancelOldOrders(simulator, Side.BUY, 5000);
      if (quantity > 0) {
        if(this.hasBuyOrders(snapshot,priceChange.upPrice)) return false;
        this.placeBuyOrder(simulator, priceChange.upPrice, quantity);
        return true;
      }
    } else if (currentPrice > average * 1.02 && this.shares > 0 && this.random() > 0.5) {
      // cleanup old orders
      this.autoCancelOldOrders(simulator, Side.SELL, 5000);
      // Price significantly above guide - sell
      const quantity = this.orderSize;
      if (quantity > 0) {
        if(this.hasSellOrders(snapshot,priceChange.downPrice)) return false;
        this.placeSellOrder(simulator, priceChange.downPrice, quantity);
        return true;
      }
    }
    return false;
  }
}

class InformedBot extends TradingBot {
  /**
   * Type of bot
   */
  override type: string = 'InformedBot';
  private lookbackPeriod: number;
  static override description: string = 'Has knowledge of the intrinsic value of the asset and trades accordingly';

  constructor(id: string, inventoryParams: InventoryConfig, lookbackPeriod = 20) {
    super(id, inventoryParams);
    this.lookbackPeriod = lookbackPeriod;
    this._cancelSpreadTresholdMultiplier = inventoryParams.cancelSpreadTresholdMultiplier || 10;
  }

  override shouldCancelOrders(currentPrice: number, simulator: Simulator, snapshot?: Snapshot, guidePrice?: number,intrinsicValue?: number): void {
    // Informed bot does not cancel orders if it has an advantage
    if(!currentPrice) return ;
    if(!guidePrice) return ;
    if(!intrinsicValue) return ;

    const orders = simulator.orderBookW.orderByIDs.get(this.id);

    if(!orders) return;
    orders.forEach((orderList)=>{
      orderList.forEach((orderArray)=>{
        orderArray.forEach((order)=>{

          if( (intrinsicValue > currentPrice && order.side === Side.BUY) ||
              (intrinsicValue < currentPrice && order.side === Side.SELL)
          ){
            // Advantageous order - do not cancel
            return;
          }

          this.cancelOrder(order,simulator);
        })
      })
    })
  }

  makeDecision(currentPrice: number, priceHistory: number[], simulator: Simulator,snapshot:Snapshot, intrinsicValue?: number): boolean {
    if(!currentPrice) return false;
    if(priceHistory.length < 2) return false;
    if (priceHistory.length < this.lookbackPeriod) return false;

    if (typeof intrinsicValue !== 'number') {
      return false;
    }
    
    if(currentPrice < (intrinsicValue * 0.95)){
      this.autoCancelOldOrders(simulator, Side.BUY, 60000);
      // cleanup old orders
      if (this.availableCash > currentPrice * this.orderSize) {
        if(this.hasBuyOrders(snapshot,currentPrice)) return false;
        const processed = this.placeBuyOrder(simulator, currentPrice, this.orderSize,'market');

        if(processed?.partialQuantityProcessed){
          // Create a limit order to sell the processed quantity at a higher price;
          const sellPrice = roundPrice(intrinsicValue * 1.05);
          this.placeSellOrder(simulator, sellPrice, processed.partialQuantityProcessed,'limit');
        }
        return true;
      }
    }


    if(currentPrice > (intrinsicValue * 1.10)){
      this.autoCancelOldOrders(simulator, Side.SELL, 60000);

      if (this.shares >= this.orderSize) {
        if(this.hasSellOrders(snapshot,currentPrice)) return false;
        this.placeSellOrder(simulator, currentPrice, this.orderSize,'market');
        return true;
      }
    }
    return false;
  }
}
/**
 * Partially Informed Bot - has some knowledge of intrinsic value but less accurate
 * if the intrinsic value is $1.5 they may think it's between $1.4 and $1.6
 */
class PartiallyInformedBot extends TradingBot {
  /**
   * Type of bot
   */
  override type: string = 'PartiallyInformedBot';
  private lookbackPeriod: number;
  static override description: string = 'Has imperfect knowledge of the intrinsic value of the asset and trades accordingly';

  originalLastIntrinsicValue: number | null = null;
  lastIntrinsicValue: number | null = null;

  constructor(id: string, inventoryParams: InventoryConfig, lookbackPeriod = 20) {
    super(id, inventoryParams);
    this.lookbackPeriod = lookbackPeriod;
    this._cancelSpreadTresholdMultiplier = inventoryParams.cancelSpreadTresholdMultiplier || 10;
  }

  override shouldCancelOrders(currentPrice: number, simulator: Simulator, snapshot?: Snapshot, guidePrice?: number,intrinsicValue?: number): void {
    // Informed bot does not cancel orders if it has an advantage
    if(!currentPrice) return ;
    if(!guidePrice) return ;
    if(!intrinsicValue) return ;

    const orders = simulator.orderBookW.orderByIDs.get(this.id);

    if(!orders) return;
    orders.forEach((orderList)=>{
      orderList.forEach((orderArray)=>{
        orderArray.forEach((order)=>{

          if( (intrinsicValue > currentPrice && order.side === Side.BUY) ||
              (intrinsicValue < currentPrice && order.side === Side.SELL)
          ){
            // Advantageous order - do not cancel
            return;
          }

          this.cancelOrder(order,simulator);
        })
      })
    })
  }

  makeDecision(currentPrice: number, priceHistory: number[], simulator: Simulator,snapshot:Snapshot, intrinsicValue?: number): boolean {
    if(!currentPrice) return false;
    if(priceHistory.length < 2) return false;
    if (priceHistory.length < this.lookbackPeriod) return false;
    if (typeof intrinsicValue !== 'number') {
      return false;
    }
    if(!this.lastIntrinsicValue){
      this.lastIntrinsicValue = intrinsicValue * (1 + (this.random()-0.05)*0.2); // 2% noise
    }
    
    if(this.originalLastIntrinsicValue !== intrinsicValue){
      this.originalLastIntrinsicValue = intrinsicValue;
      const lastNudgevalue = (1 + (this.random()-0.05)*0.2); // 2% noise
      this.lastIntrinsicValue = intrinsicValue *lastNudgevalue
    }

    if(currentPrice < (intrinsicValue * 0.96)){
      this.autoCancelOldOrders(simulator, Side.BUY, 60000);
      // cleanup old orders
      if (this.availableCash > currentPrice * this.orderSize) {
        if(this.hasBuyOrders(snapshot,currentPrice)) return false;
        // No asks - market order will be useless, make a limit order instead
        const orderType  = snapshot.asks.length === 0 ? 'limit' : 'market';
        const processed = this.placeBuyOrder(simulator, currentPrice, this.orderSize, orderType);

        if(processed?.partialQuantityProcessed){
          // Create a limit order to sell the processed quantity at a higher price;
          const sellPrice = roundPrice(intrinsicValue * 1.04);
          this.placeSellOrder(simulator, sellPrice, processed.partialQuantityProcessed,'limit');
        }
        return true;
      }
    }


    if(currentPrice > (this.lastIntrinsicValue * 1.08)){
      this.autoCancelOldOrders(simulator, Side.SELL, 60000);

      if (this.shares >= this.orderSize) {
        if(this.hasSellOrders(snapshot,currentPrice)) return false;
        const orderType  = snapshot.bids.length === 0 ? 'limit' : 'market';
        this.placeSellOrder(simulator, currentPrice, this.orderSize, orderType);
        return true;
      }
    }
    return false;
  }
}

interface LiquidityBotConfig {
  baseSpread: number;           // Base spread (e.g., 0.005 = 0.5%)
  maxSpread: number;            // Maximum spread during high volatility
  targetInventory: number;      // Desired share inventory (can be 0 for neutral)
  maxInventoryDeviation: number; // Max shares to deviate from target
  inventorySkewFactor: number;  // How much to skew prices per share deviation
  volatilityWindow: number;     // Periods to calculate volatility
  minOrderValue: number;        // Minimum order value to place
  rebalanceThreshold: number;   // When to aggressively rebalance (% of max deviation)
}
// Liquidity Bot - acts as a market maker by maintaining bid/ask spread
class LiquidityBot extends TradingBot {
  /**
   * Type of bot
   */
  override type: string = 'LiquidityBot';
  static override description: string = 'Provides liquidity by maintaining a bid/ask spread and managing inventory risk';

  private config: LiquidityBotConfig;
  private recentVolatility: number = 0;

  constructor(id: string, inventoryParams: InventoryConfig, botConfig: Partial<LiquidityBotConfig> = {}) {
    super(id, inventoryParams);
    this.config = {
      baseSpread: 0.02,
      maxSpread: 0.1,
      targetInventory: 0,
      maxInventoryDeviation: 100,
      inventorySkewFactor: 0.0001, // 0.01% price adjustment per share
      volatilityWindow: 20,
      minOrderValue: 10,
      rebalanceThreshold: 0.7,
      ...botConfig
    };
    this._cancelSpreadTresholdMultiplier = inventoryParams.cancelSpreadTresholdMultiplier || 5;

  }

  private updateVolatility(priceHistory: number[]): void {
    if (priceHistory.length < 2) {
      this.recentVolatility = 0;
      return;
    }

    const window = Math.min(this.config.volatilityWindow, priceHistory.length);
    const recentPrices = priceHistory.slice(-window);

    // Calculate returns
    const returns = recentPrices.slice(1).map((price, i) => {
      const pastPrice = recentPrices[i];
      if(!pastPrice) return 0;
      return (price - pastPrice) / pastPrice;
    });
    
    // Standard deviation of returns
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    this.recentVolatility = Math.sqrt(variance);
  }

  private calculatePrices(currentPrice: number, inventoryRatio: number): {
    bidPrice: number;
    askPrice: number;
    effectiveSpread: number;
  } {
    // Dynamic spread based on volatility (wider in volatile markets)
    const volatilityMultiplier = 1 + (this.recentVolatility * 100); // Scale volatility impact
    let effectiveSpread = Math.min(
      this.config.baseSpread * volatilityMultiplier,
      this.config.maxSpread
    );

    // Inventory skew: shift both bid and ask in the same direction
    // If we have too many shares (positive inventoryRatio), we want to:
    // - Lower both bid and ask to encourage selling
    // If we have too few shares (negative inventoryRatio), we want to:
    // - Raise both bid and ask to encourage buying
    const skew = -inventoryRatio * this.config.inventorySkewFactor * currentPrice;

    // Calculate bid/ask with skew
    const halfSpread = (effectiveSpread * currentPrice) / 2;
    let bidPrice = currentPrice - halfSpread + skew;
    let askPrice = currentPrice + halfSpread + skew;

    // Ensure minimum spread
    const minSpread = this.config.baseSpread
    if (askPrice - bidPrice < minSpread) {
      const midpoint = (bidPrice + askPrice) / 2;
      bidPrice = midpoint - minSpread / 2;
      askPrice = midpoint + minSpread / 2;
    }

    return { bidPrice, askPrice, effectiveSpread };
  }

  private manageOrders(
    bidPrice: number,
    askPrice: number,
    snapshot: Snapshot,
    simulator: Simulator,
    inventoryRatio: number
  ): void {
    // Adjust order sizes based on inventory
    // If we're long (positive ratio), place smaller buys and larger sells
    // If we're short (negative ratio), place larger buys and smaller sells
    const buySize = this.orderSize * (1 - inventoryRatio * 0.5);
    const sellSize = this.orderSize * (1 + inventoryRatio * 0.5);

    // Place buy orders if we have capacity
    const hasBuyOrders = this.hasBuyOrders(snapshot, bidPrice);
    const canBuy = this.availableCash >= bidPrice * buySize + this.config.minOrderValue;
    
    if (!hasBuyOrders && canBuy && buySize > 0) {
      this.placeBuyOrder(simulator, bidPrice, Math.floor(buySize));
    }

    // Place sell orders if we have shares
    const hasSellOrders = this.hasSellOrders(snapshot, askPrice);
    const canSell = this.shares >= sellSize;
    
    if (!hasSellOrders && canSell && sellSize > 0) {
      this.placeSellOrder(simulator, askPrice, Math.floor(sellSize));
    }
  }

  private handleInventoryRisk(
    currentPrice: number,
    inventoryDeviation: number,
    simulator: Simulator,
    snapshot: Snapshot
  ): void {
    // Aggressive rebalancing when inventory is too extreme
    if (inventoryDeviation > 0) {
      // Too many shares - aggressively sell
      const sellPrice = currentPrice * (1 - this.config.baseSpread * 2); // Wider discount
      const sellQuantity = Math.min(this.shares, Math.floor(Math.abs(inventoryDeviation) / 2));
      
      if (!this.hasSellOrders(snapshot, sellPrice) && sellQuantity > 0) {
        this.placeSellOrder(simulator, sellPrice, sellQuantity);
      }
    } else {
      // Too few shares - aggressively buy
      const buyPrice = currentPrice * (1 + this.config.baseSpread * 2); // Willing to pay more
      const buyQuantity = Math.floor(Math.abs(inventoryDeviation) / 2);
      const buyValue = buyPrice * buyQuantity;
      
      if (!this.hasBuyOrders(snapshot, buyPrice) && this.availableCash >= buyValue) {
        this.placeBuyOrder(simulator, buyPrice, buyQuantity);
      }
    }
  }

  private shouldTrade(currentPrice: number): boolean {
    // Add any pre-trade checks here
    // For example, don't trade if price is too low/high, or if we're in a bad state
    return currentPrice > 0 && (this.availableCash > 0 || this.shares > 0);
  }

  // Helper method for debugging/monitoring
  getStatus(): {
    inventoryDeviation: number;
    inventoryRatio: number;
    volatility: number;
    isAtRisk: boolean;
  } {
    const inventoryDeviation = this.shares - this.config.targetInventory;
    const inventoryRatio = inventoryDeviation / this.config.maxInventoryDeviation;
    
    return {
      inventoryDeviation,
      inventoryRatio,
      volatility: this.recentVolatility,
      isAtRisk: Math.abs(inventoryDeviation) > this.config.maxInventoryDeviation
    };
  }
  makeDecision(currentPrice: number, priceHistory: number[], simulator: Simulator, snapshot: Snapshot, intrinsicValue?: number,guidePrice?: number): boolean {
    if (!currentPrice || !this.shouldTrade(currentPrice)) return false;

    // Update market conditions
    this.updateVolatility(priceHistory);
    
    // Calculate inventory position
    const inventoryDeviation = this.shares - this.config.targetInventory;
    const inventoryRatio = inventoryDeviation / this.config.maxInventoryDeviation;
    
    // Check if we're in dangerous inventory territory
    if (Math.abs(inventoryDeviation) > this.config.maxInventoryDeviation) {
      this.handleInventoryRisk(currentPrice, inventoryDeviation, simulator, snapshot);
      return false;
    }

    // Calculate dynamic spread and skewed prices
    const { bidPrice, askPrice, effectiveSpread } = this.calculatePrices(
      currentPrice, 
      inventoryRatio
    );

    // Place orders with inventory awareness
    this.manageOrders(bidPrice, askPrice, snapshot, simulator, inventoryRatio);
    return true;
  }
}

// Random Bot - makes random trades
class RandomBot extends TradingBot {
    /**
   * Type of bot
   */
  override type: string = 'RandomBot';
  static override description: string = 'Makes random buy/sell decisions without market analysis';

  override shouldCancelOrders(currentPrice: number, simulator: Simulator, snapshot?: Snapshot, intrinsicPrice?: number): void {
    if(this.random() > 0.97){
      const map =simulator.orderBookW.orderByIDs.get(this.id)
      if(!map) return;
      const orderList = map[this.random() > 0.5 ? 0 : 1]?.get(this.random() * map[0].size);
      if(!orderList) return;
      const order = orderList[Math.floor(this.random() * orderList.length)];
      if(!order) return;
      this.cancelOrder(order,simulator);
    }
  }

  makeDecision(currentPrice: number, priceHistory: number[], simulator: Simulator, snapshot:Snapshot): boolean {
    const action = this.random();

    if(!currentPrice) return false;
    
    const purchaseType = this.random() > 0.5 ? 'market' : 'limit';
    const priceVariance = 0.96 + this.random() * 0.08; // 96% to 104%

    const map =simulator.orderBookW.orderByIDs.get(this.id)
    const orderList = priceVariance < 1 ? map?.[1] : map?.[0];
    const orderLength = orderList?.size || 0;
    if(orderLength>10){
      // console.log(`RandomBot ${this.id} skipping trade - too many orders (${orderLength}) on this side`);
      return false; // too many orders on this side
    }
    let price = 0
    if(purchaseType === 'limit'){
      if(priceVariance < 100){
        if(currentPrice * priceVariance > currentPrice - 0.01){
          price = currentPrice * priceVariance
        }else{
          price = currentPrice - 0.01
        }
      }else{
        if(currentPrice * priceVariance < currentPrice + 0.01){
          price = currentPrice * priceVariance
        }else{
          price = currentPrice + 0.01
        }
      }
    }else {
      price = currentPrice;
    }

    if (action > 0.9) {
      // Random buy
      const quantity = this.orderSize
      if (quantity > 0) {
        this.placeBuyOrder(simulator, price, quantity,purchaseType);
        return true;
      }
    } else if (action < 0.1 && this.shares > 0) {
      // Random sell
      const quantity = this.shares > this.orderSize ? this.orderSize : this.shares;
      if (quantity > 0) {
        this.placeSellOrder(simulator, price, quantity,purchaseType);
        return true;
      }
    }
    return false;
  }
}

class SpreadTradingBot extends TradingBot {
  override type: string = 'SpreadTradingBot';
  static override description: string = 'Trades based on bid-ask spread analysis';
  
  private minSpreadPercentage: number;
  private orderRefreshRate: number;
  private lastOrderTime: number = 0;
  
  constructor(
    id: string, 
    config: Partial<InventoryConfig> & { 
      minSpreadPercentage?: number;
      orderRefreshRate?: number;
    } = {
      initialCash: 10000,
      initialShares: 0,
      orderSize: 10,
      minSpreadPercentage: 0.5, // 0.5% minimum spread
      orderRefreshRate: 5000 // Refresh orders every 5 seconds
    }, 
    debug: boolean = false
  ) {
    super(id, config, debug);
    this.minSpreadPercentage = config.minSpreadPercentage || 0.5;
    this.orderRefreshRate = config.orderRefreshRate || 5000;
  }

  override makeDecision(
    currentPrice: number,
    priceHistory: number[],
    simulator: Simulator,
    snapshot: Snapshot,
    intrinsicPrice?: number,
    guidePrice?: number
  ): boolean {
    // Auto-cancel old orders periodically
    this.autoCancelOldOrders(simulator,undefined, this.orderRefreshRate);
    console.log(snapshot.bids.map((b)=>b.price),snapshot.asks.map((a)=>a.price))
    // Get best bid and ask from snapshot
    const bestBid = snapshot.bids[0]; // Highest bid
    const bestAsk = snapshot.asks[0]; // Lowest ask
    
    if (!bestBid || !bestAsk) {
      if (this.debug) {
        console.log(`${this.id}: No sufficient market data`);
      }
      return false;
    }

    const bidPrice = bestBid.price;
    const askPrice = bestAsk.price;
    const spread = askPrice - bidPrice;
    const spreadPercentage = (spread / currentPrice) * 100;

    if (this.debug) {
      console.log(`${this.id}: Bid: $${bidPrice}, Ask: $${askPrice}, Spread: ${spreadPercentage.toFixed(2)}%`);
    }

    // Calculate our target prices (place orders inside the spread)
    const targetBuyPrice = bidPrice + (spread * 0.3); // 30% into the spread from bid
    const targetSellPrice = askPrice - (spread * 0.3); // 30% into the spread from ask

    let madeDecision = false;

    // Only trade if spread is wide enough
    if (spreadPercentage >= this.minSpreadPercentage) {
      
      // Place buy order if we have available cash and don't already have a buy at this price
      if (this.availableCash >= targetBuyPrice * this.orderSize) {
        if (!this.hasBuyOrders(snapshot, targetBuyPrice)) {
          const buyResult = this.placeBuyOrder(
            simulator,
            targetBuyPrice,
            this.orderSize,
            'limit'
          );
          
          if (buyResult && this.debug) {
            console.log(`${this.id}: Placed BUY order at $${targetBuyPrice.toFixed(2)} for ${this.orderSize} shares`);
          }
          madeDecision = true;
        }
      }

      // Place sell order if we have shares and don't already have a sell at this price
      if (this.shares >= this.orderSize) {
        if (!this.hasSellOrders(snapshot, targetSellPrice)) {
          const sellResult = this.placeSellOrder(
            simulator,
            targetSellPrice,
            this.orderSize,
            'limit'
          );
          
          if (sellResult && this.debug) {
            console.log(`${this.id}: Placed SELL order at $${targetSellPrice.toFixed(2)} for ${this.orderSize} shares`);
          }
          madeDecision = true;
        }
      }
    } else if (this.debug) {
      console.log(`${this.id}: Spread too narrow (${spreadPercentage.toFixed(2)}% < ${this.minSpreadPercentage}%)`);
    }

    // Opportunistic market orders when price diverges significantly
    // if (guidePrice && Math.abs(currentPrice - guidePrice) / guidePrice > 0.02) {
    //   // If current price is much lower than guide price, buy
    //   if (currentPrice < guidePrice * 0.98 && this.availableCash >= currentPrice * this.orderSize) {
    //     this.placeBuyOrder(simulator, currentPrice, this.orderSize, 'market');
    //     if (this.debug) {
    //       console.log(`${this.id}: Market BUY - price undervalued`);
    //     }
    //     madeDecision = true;
    //   }
    //   // If current price is much higher than guide price, sell
    //   else if (currentPrice > guidePrice * 1.02 && this.shares >= this.orderSize) {
    //     this.placeSellOrder(simulator, currentPrice, this.orderSize, 'market');
    //     if (this.debug) {
    //       console.log(`${this.id}: Market SELL - price overvalued`);
    //     }
    //     madeDecision = true;
    //   }
    // }

    return madeDecision;
  }

  override toString(): string {
    return `SpreadTradingBot - ID: ${this.id}, Cash: $${this.availableCash.toFixed(2)}, Shares: ${this.shares}, Min Spread: ${this.minSpreadPercentage}%`;
  }
}

export { TradingBot, SpreadTradingBot,PartiallyInformedBot, InformedBot,LiquidityBot, MomentumBot, MeanReversionBot, RandomBot };

/**
 * List of activated (available) bots
 * set to false to disable a bot
 */
export const AVAILABLE_BOTS = new Map<new (...args: any[]) => TradingBot, boolean>([
  [MomentumBot, true],
  [MeanReversionBot, false],
  [InformedBot, true],
  [PartiallyInformedBot, true],
  [SpreadTradingBot, true],
  [LiquidityBot, false],
  [RandomBot, true],
]);

export const getAllAvailableBots = () => {
  return Array.from(AVAILABLE_BOTS.entries()).filter(([_, isActive]) => isActive).map(([botClass, _]) => botClass);
}

const computePriceChange = (currentPrice:number, minStep:number, changeUp:number, changeDown:number) => {
    const upChange = roundPrice(currentPrice * (1+changeUp));
    const downChange = roundPrice(currentPrice * (1-changeDown));

    const minPriceUp = currentPrice + (minStep || 0);
    const minPriceDown = currentPrice - (minStep || 0);
    const upPrice: number = upChange < minPriceUp ? minPriceUp : upChange
    const downPrice: number = downChange > minPriceDown ? minPriceDown : downChange
  // console.log(`Price change computed: Up to $${upPrice.toFixed(2)}, Down to $${downPrice.toFixed(2)} ${changeDown}`);
    return {upPrice, downPrice};
}

