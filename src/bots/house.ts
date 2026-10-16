import { marketMaker } from "./strategies/liquidity";
import { defineBot, referenceCash, sharesWorth } from "./types";

/**
 * The house market maker (settings.houseLiquidity). Not selectable in the admin UI and not
 * listed in the results. It re-quotes every step with deep pockets, so players can always trade
 * and the price never freezes, even with zero bots.
 */
export const houseMarketMaker = defineBot({
    id: "HouseMarketMaker",
    name: "House",
    description: "Always-on liquidity provider",
    enabled: false,
    create: (rng, settings) =>
        marketMaker({
            levels: 5,
            halfSpread: 0.005,
            levelGap: 0.004,
            size: sharesWorth(settings, 0.01),
            requoteEvery: 1,
            phase: 0,
            targetShares: sharesWorth(settings, 1000),
            maxDeviation: sharesWorth(settings, 1000),
        }),
    inventory: (settings) => ({
        cash: referenceCash(settings) * 1000,
        shares: sharesWorth(settings, 1000),
    }),
});
