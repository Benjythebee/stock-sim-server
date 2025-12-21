import { SeededRandomGenerator } from "./seededRandomGenerator";

interface StockPriceConfig {
  initialPrice: number;
  drift: number;              // Overall trend (positive = upward, negative = downward)
  volatility: number;         // Price deviation/volatility (0-1 typically)
  seed: number;
  meanReversionStrength?: number; // How strongly guide price reverts to intrinsic (0-1, default 0.05)
}

interface ShockState {
  intensity: number;
  ticksRemaining: number;
}

class StockPriceGenerator {
  private intrinsicValue: number;  // Fundamental "true" value - stable unless shocked
  guidePrice: number;      // Price from random walk model
  private drift: number;
  volatility: number;
  history: number[] = [];
  private random: SeededRandomGenerator;
  private tickCount: number;
  private shockState: ShockState | null;
  private meanReversionStrength: number;

  constructor(config: StockPriceConfig) {
    this.guidePrice = config.initialPrice;
    this.drift = config.drift;
    this.volatility = config.volatility;
    this.random = new SeededRandomGenerator(config.seed);
    this.intrinsicValue = config.initialPrice*this.random.nextNormal()*0.5 + config.initialPrice;
    this.tickCount = 0;
    this.shockState = null;
    this.meanReversionStrength = config.meanReversionStrength ?? 0.05;
  }

  /**
   * Generate the next tick price using geometric Brownian motion
   * Returns both the stable intrinsic value and the random-walk guide price
   */
  tick(): { intrinsicValue: number; guidePrice: number } {
    this.tickCount++;

    // Calculate total drift: base drift + shock + mean reversion
    let totalDrift = this.drift;

    // Add shock contribution if active
    if (this.shockState && this.shockState.ticksRemaining > 0) {
      totalDrift += this.shockState.intensity;
      this.shockState.ticksRemaining--;
      
      if (this.shockState.ticksRemaining <= 0) {
        this.shockState = null;
      }
    }

    // Add mean reversion toward intrinsic value
    const priceDifference = this.guidePrice - this.intrinsicValue;
    const reversionForce = -(priceDifference / this.intrinsicValue) * this.meanReversionStrength;
    totalDrift += reversionForce;

    // Apply geometric Brownian motion to guide price
    const dt = 1; // Time step
    const randomShock = this.random.nextNormal();
    const priceChange = (totalDrift - 0.5 * this.volatility ** 2) * dt 
                       + this.volatility * Math.sqrt(dt) * randomShock;
    
    this.guidePrice *= Math.exp(priceChange);
    this.guidePrice = Math.max(this.guidePrice, 0.01); // Ensure positive

    this.history.push(this.guidePrice);

    return {
      intrinsicValue: roundPrice(this.intrinsicValue),
      guidePrice: roundPrice(this.guidePrice)
    };
  }

  /**
   * Apply a temporary shock to the guide price generation
   * This creates a temporary drift in the random walk
   * 
   * @param intensity - Drift intensity (positive = upward pressure, negative = downward)
   *                    Typical range: -0.5 to 0.5 for moderate shocks
   * @param duration - How many ticks the shock lasts (default: 10)
   */
  shock(intensity: number, duration: number = 10): void {
    console.log(`Applying market shock: intensity=${intensity.toFixed(3)}, duration=${duration} ticks`);
    
    this.shockState = {
      intensity,
      ticksRemaining: duration
    };
  }

  /**
   * Directly shock the intrinsic value
   * This represents a fundamental change in the asset's value
   * 
   * @param percentageChange - Percentage to change intrinsic value (0.1 = +10%, -0.2 = -20%)
   */
  intrinsicShock(percentageChange: number): void {
    const oldValue = this.intrinsicValue;
    this.intrinsicValue *= (1 + percentageChange);
    this.intrinsicValue = Math.max(this.intrinsicValue, 0.01); // Ensure positive
    
    console.log(`Intrinsic shock: ${oldValue.toFixed(2)} → ${this.intrinsicValue.toFixed(2)} (${(percentageChange * 100).toFixed(1)}%)`);
  }

  /**
   * Gradually drift the intrinsic value (for slow fundamental changes)
   * Call this occasionally (e.g., every 50-100 ticks) for realistic behavior
   * 
   * @param percentageChange - Small percentage drift (e.g., 0.02 = +2%)
   */
  driftIntrinsicValue(percentageChange: number): void {
    const sign = this.random.next() < 0.5 ? -1 : 1;
    percentageChange *= sign
    this.intrinsicValue *= (1 + percentageChange);
    this.intrinsicValue = Math.max(this.intrinsicValue, 0.01);
  }

  // Getters
  getIntrinsicValue(): number {
    return roundPrice(this.intrinsicValue);
  }

  getGuidePrice(): number {
    return roundPrice(this.guidePrice);
  }

  getTickCount(): number {
    return this.tickCount;
  }

  isShockActive(): boolean {
    return this.shockState !== null && this.shockState.ticksRemaining > 0;
  }

  /**
   * Reset the generator to initial state
   */
  reset(newSeed?: number, newInitialPrice?: number): void {
    if (newSeed !== undefined) {
      this.random.setSeed(newSeed);
    }
    if (newInitialPrice !== undefined) {
      this.intrinsicValue = newInitialPrice;
      this.guidePrice = newInitialPrice;
    }
    this.tickCount = 0;
    this.shockState = null;
  }

  dispose(): void {
    this.shockState = null;
  }
}

export { StockPriceGenerator, type StockPriceConfig };

  /**
   * Round price to 2 decimal places (ceiling)
   */
export function roundPrice(price: number): number {
    return Math.ceil(price * 100) / 100;
  }