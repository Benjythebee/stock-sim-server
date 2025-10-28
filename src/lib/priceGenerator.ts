import { SeededRandomGenerator } from "./seededRandomGenerator";

interface StockPriceConfig {
  initialPrice: number;
  drift: number;          // Overall trend (positive = upward, negative = downward)
  volatility: number;     // Price deviation/volatility (0-1 typically)
  seed: number;
  marketInfluence?: number; // How much market price affects guide price (0-1, default 0.3)
  meanReversion?: number;   // Strength of mean reversion (0-1, default 0.1)
}

interface ShockState {
  intensity: number;
  duration: number;
  ticksRemaining: number;
}

class StockPriceGenerator {
  private intrinsicValue: number;  // Pure fundamental price (no pressure/shock)
  private guidePrice: number;      // Price from random walk model (with pressure/shock)
  private marketPrice: number;     // Actual price after agent trading
  private drift: number;
  private volatility: number;
  private random: SeededRandomGenerator;
  private tickCount: number;
  private shockState: ShockState | null;
  private marketInfluence: number;
  private meanReversion: number;
  private priceHistory: number[];  // Track recent market prices

  constructor(config: StockPriceConfig) {
    this.intrinsicValue = config.initialPrice;
    this.guidePrice = config.initialPrice;
    this.marketPrice = config.initialPrice;
    this.drift = config.drift;
    this.volatility = config.volatility;
    this.random = new SeededRandomGenerator(config.seed);
    this.tickCount = 0;
    this.shockState = null;
    this.marketInfluence = config.marketInfluence ?? 0.3;
    this.meanReversion = config.meanReversion ?? 0.1;
    this.priceHistory = [config.initialPrice];
  }

  get history(): number[] {
    return this.priceHistory;
  }

  /**
   * Generate the next tick prices
   * Returns both intrinsic value (pure fundamental) and guide price (with pressure/shocks)
   */
  tick(): { intrinsicValue: number; guidePrice: number } {
    this.tickCount++;

    // First, calculate INTRINSIC VALUE - pure random walk with base drift only
    const dt = 1; // Time step
    const randomShock = this.random.nextNormal();
    const intrinsicPriceChange = (this.drift - 0.5 * this.volatility ** 2) * dt 
                                + this.volatility * Math.sqrt(dt) * randomShock;
    
    this.intrinsicValue *= Math.exp(intrinsicPriceChange);
    this.intrinsicValue = Math.max(this.intrinsicValue, 0.01);

    // Now calculate GUIDE PRICE - intrinsic value + market pressure + shocks
    const marketPressure = this.calculateMarketPressure();
    
    let additionalDrift = marketPressure;
    if (this.shockState && this.shockState.ticksRemaining > 0) {
      // Shock intensity decays linearly over its duration
      const decayFactor = this.shockState.ticksRemaining / this.shockState.duration;
      additionalDrift += this.shockState.intensity * decayFactor;
      this.shockState.ticksRemaining--;
      
      if (this.shockState.ticksRemaining <= 0) {
        this.shockState = null;
      }
    }

    // Apply additional drift to intrinsic value to get guide price
    const guidePriceChange = (additionalDrift - 0.5 * this.volatility ** 2) * dt 
                            + this.volatility * Math.sqrt(dt) * this.random.nextNormal();
    
    this.guidePrice = this.intrinsicValue * Math.exp(guidePriceChange);
    this.guidePrice = Math.max(this.guidePrice, 0.01);
    
    // If no market price was set from previous tick, use guide price
    if (this.marketPrice === this.priceHistory[this.priceHistory.length - 1]) {
      this.marketPrice = this.guidePrice;
    }

    return {
      intrinsicValue: priceTwoDecimal(this.intrinsicValue,true),
      guidePrice: priceTwoDecimal(this.guidePrice,true)
    };
  }

  /**
   * Calculate market pressure based on difference between market and intrinsic value
   * This creates momentum and mean reversion effects
   */
  private calculateMarketPressure(): number {
    if (this.priceHistory.length < 2) return 0;
    
    const lastMarketPrice = this.priceHistory[this.priceHistory.length - 1];
    if (typeof lastMarketPrice !== 'number') return 0;
    const priceDifference = lastMarketPrice - this.intrinsicValue;
    const percentageDiff = priceDifference / this.intrinsicValue;

    // Market influence creates momentum (if market price > intrinsic, push guide up)
    const momentum = percentageDiff * this.marketInfluence;

    // Mean reversion pulls back toward intrinsic value
    const reversion = -percentageDiff * this.meanReversion;

    return momentum + reversion;
  }

  /**
   * Set the actual market price after agent interactions
   * This should be called after agents buy/sell at the current tick
   * @param price - The price determined by agent trading
   */
  setMarketPrice(price: number): void {
    this.marketPrice = Math.max(price, 0.01); // Ensure positive
    this.priceHistory.push(this.marketPrice);
    
    // Keep only recent history (last 20 prices)
    if (this.priceHistory.length > 20) {
      this.priceHistory.shift();
    }

    // Adjust volatility based on price movement
    this.adjustVolatility();
  }

  /**
   * Adjust volatility based on recent price movements
   * Large movements increase volatility (market instability)
   */
  private adjustVolatility(): void {
    if (this.priceHistory.length < 3) return;

    const recentPrices = this.priceHistory.slice(-5);
    let totalChange = 0;
    
    for (let i = 1; i < recentPrices.length; i++) {
      const lastPrice = recentPrices[i]
      const prevPrice = recentPrices[i - 1]
      if(typeof lastPrice !== 'number' || typeof prevPrice !== 'number' || prevPrice === 0) continue;

      const change = Math.abs((lastPrice - prevPrice) / prevPrice);
      totalChange += change;
    }
    
    const avgChange = totalChange / (recentPrices.length - 1);
    
    // If market is volatile, slightly increase volatility (up to 50% increase)
    if (avgChange > 0.05) {
      this.volatility = Math.min(this.volatility * 1.05, this.volatility * 1.5);
    } else {
      // Gradually decay volatility back toward baseline during calm periods
      this.volatility *= 0.99;
    }
  }

  /**
   * Apply a shock to the price generation
   * @param size - Magnitude of shock (positive = upward shock, negative = downward)
   *               Typical range: -1 to 1, but can be larger for extreme shocks
   */
  shock(size: number): void {
    // Duration scales with shock size (larger shocks last longer)
    const duration = Math.max(5, Math.floor(Math.abs(size) * 100));
    console.log(`Applying shock: size=${size}, duration=${duration} ticks`);
    this.shockState = {
      intensity: size,
      duration: duration,
      ticksRemaining: duration
    };
  }

  /**
   * Get the current intrinsic value (pure fundamental, no pressure/shock)
   */
  getIntrinsicValue(): number {
    return this.intrinsicValue;
  }

  /**
   * Get the current guide price (from random walk model with pressure/shock)
   */
  getGuidePrice(): number {
    return this.guidePrice;
  }

  /**
   * Get the current market price (after agent trading)
   */
  getMarketPrice(): number {
    return this.marketPrice;
  }

  /**
   * Get the current price without generating a new tick
   * Returns market price if set, otherwise guide price
   */
  getCurrentPrice(): number {
    return this.marketPrice;
  }

  /**
   * Get the current tick count
   */
  getTickCount(): number {
    return this.tickCount;
  }

  /**
   * Check if a shock is currently active
   */
  isShockActive(): boolean {
    return this.shockState !== null && this.shockState.ticksRemaining > 0;
  }

  /**
   * Reset the generator to initial state with a new seed
   */
  reset(newSeed?: number, newInitialPrice?: number): void {
    if (newSeed !== undefined) {
      this.random.setSeed(newSeed);
    }
    if (newInitialPrice !== undefined) {
      this.intrinsicValue = newInitialPrice;
      this.guidePrice = newInitialPrice;
      this.marketPrice = newInitialPrice;
      this.priceHistory = [newInitialPrice];
    }
    this.tickCount = 0;
    this.shockState = null;
  }
}

export { StockPriceGenerator, type StockPriceConfig };



export const priceTwoDecimal = (price:number, roundUp:boolean)=>{
  return roundUp ? Math.ceil(price * 100) / 100 : Math.floor(price * 100) / 100;
}