



export class SeededRandomGenerator {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed;
    }

    setSeed(newSeed: number) {
        this.seed = newSeed;
    }
    
    next(): number {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }

    nextIdentity(){
        // Between -1 and 1
        return this.next()*2 -1;
    }

  /**
   * Box-Muller transform to generate normal distribution from uniform random
   */
    nextNormal(): number {
        const u1 = this.next();
        const u2 = this.next();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

}
