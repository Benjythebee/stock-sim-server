import { defineNews, type NewsDefinition } from "./types";

/**
 * Follow-up headlines. They aren't drawn at random: catalog headlines publish them when they end,
 * so the first headline (which Embargoed Press Release can preview) doesn't give the twist away.
 */
export const FOLLOW_UPS = {
    analystRetraction: defineNews({
        title: ({ ticker }) => `Correction: Analyst Meant a Different $${ticker}`,
        description: "The 'Strong Buy' call was for a similarly named company. The upgrade has been withdrawn.",
        durationSeconds: 15,
        // Undoes the +10% of the upgrade exactly: 1.1 * (1 - 1/11) = 1.
        fairValueShock: -1 / 11,
    }),
    bubblePops: defineNews({
        title: "The Bubble Pops",
        description: "The forum moved on to the next meme. Late buyers rush for the exits all at once.",
        durationSeconds: 10,
        onStart: ({ model }) => model.applyShock(-0.03, 10),
    }),
    takeoverApproved: defineNews({
        title: "Takeover Approved",
        description: "Shareholders and regulators sign off. The buyer even sweetened the offer.",
        durationSeconds: 15,
        fairValueShock: 0.05,
    }),
    takeoverBlocked: defineNews({
        title: "Regulators Block the Takeover",
        description: "Antitrust authorities kill the deal. Merger arbitrageurs are left holding the bag.",
        durationSeconds: 15,
        fairValueShock: -0.15,
        onStart: ({ model }) => model.applyShock(-0.01, 10),
    }),
};

/** Random headlines drawn by the news manager (when settings.enableRandomNews is on). */
export const NEWS_CATALOG: NewsDefinition[] = [
    defineNews({
        title: "Tech Giant Releases New Product",
        description: "The latest gadget has hit the market, promising to revolutionize the tech industry.",
        durationSeconds: 20,
        fairValueShock: 0.1,
    }),
    defineNews({
        title: "Economic Growth Surges",
        description: "Recent reports indicate a significant increase in economic activity across multiple sectors.",
        durationSeconds: 20,
    }),
    defineNews({
        title: ({ ticker }) => `Breaking News for ticker $${ticker}`,
        description: "A major development has occurred affecting the stock market.",
        durationSeconds: 20,
    }),
    defineNews({
        title: "Federal Reserve Announces Interest Rate Decision",
        description: "The central bank's latest monetary policy announcement sends ripples through financial markets.",
        durationSeconds: 25,
        fairValueShock: -0.05,
    }),
    defineNews({
        title: "Merger & Acquisition Activity Heats Up",
        description: "Several major corporations announce strategic partnerships and acquisition deals this quarter.",
        durationSeconds: 30,
    }),
    defineNews({
        title: "Earnings Season Kicks Off",
        description: "Major companies begin reporting quarterly earnings with mixed results across industries.",
        durationSeconds: 15,
    }),
    defineNews({
        title: "Regulatory Changes Impact Industry",
        description: "New government regulations are set to reshape business operations in key sectors.",
        durationSeconds: 35,
        fairValueShock: -0.1,
    }),
    defineNews({
        title: "Oil Prices Fluctuate on Supply Concerns",
        description: "Energy markets react to geopolitical tensions and supply chain disruptions.",
        durationSeconds: 18,
    }),
    defineNews({
        title: "Consumer Confidence Index Released",
        description: "Latest consumer sentiment data reveals changing spending patterns and economic outlook.",
        durationSeconds: 22,
    }),
    defineNews({
        title: "Cryptocurrency Market Volatility",
        description: "Digital assets experience significant price movements amid regulatory uncertainty.",
        durationSeconds: 12,
        fairValueShock: 0.5,
    }),
    defineNews({
        title: "Infrastructure Investment Plan Announced",
        description: "Government unveils major infrastructure spending program affecting construction and materials sectors.",
        durationSeconds: 40,
    }),
    defineNews({
        title: "Trade Negotiations Update",
        description: "International trade talks progress as nations work to resolve ongoing commercial disputes.",
        durationSeconds: 28,
    }),

    // --- Headlines with effects beyond a fair-value move ---

    // Pure noise: twice as wild, but the fair value doesn't move. Patient traders fade the swings.
    defineNews({
        title: ({ ticker }) => `$${ticker} CEO Live-Tweets Through the Earnings Call`,
        description: "Half the posts are emojis. Nobody can tell whether the quarter was great or a disaster.",
        durationSeconds: 20,
        state: () => ({ release: null as (() => void) | null }),
        onStart: ({ model, state }) => {
            state.release = model.boostVolatility(2.5);
        },
        onEnd: ({ state }) => state.release?.(),
    }),
    // The opposite: a calm stretch where tight ranges reward market makers over gamblers.
    defineNews({
        title: "Traders Leave Early for the Long Weekend",
        description: "Desks are empty and volumes are thin. Expect a sleepy market for a while.",
        durationSeconds: 30,
        state: () => ({ release: null as (() => void) | null }),
        onStart: ({ model, state }) => {
            state.release = model.boostVolatility(0.4);
        },
        onEnd: ({ state }) => state.release?.(),
    }),
    // Everyone is frozen while the price keeps moving, so trading reopens on a gap.
    defineNews({
        title: "Exchange Servers Down",
        description: "Order entry is offline for every participant. The price will reopen wherever the bots left it.",
        durationSeconds: 6,
        state: () => ({ unlocks: [] as (() => void)[] }),
        onStart: ({ game, model, rng, state }) => {
            for (const player of game.players()) state.unlocks.push(player.lockTrading());
            const direction = rng.chance(0.5) ? 1 : -1;
            model.applyShock(direction * rng.range(0.004, 0.01), 6 * 5);
        },
        onEnd: ({ state }) => {
            for (const unlock of state.unlocks) unlock();
        },
    }),
    // Bad news, but the crowd overreacts: the price undershoots the new fair value, then recovers.
    defineNews({
        title: ({ ticker }) => `Short Seller Publishes Scathing Report on $${ticker}`,
        description: "A 90-page report alleges 'aggressive accounting'. Some of it might even be true.",
        durationSeconds: 20,
        fairValueShock: -0.08,
        onStart: ({ model }) => model.applyShock(-0.015, 10),
    }),
    // A pump with no fundamentals behind it, followed by the dump.
    defineNews({
        title: ({ ticker }) => `$${ticker} Goes Viral on Retail Forums`,
        description: "Rocket emojis everywhere. Retail traders pile in, fundamentals be damned.",
        durationSeconds: 20,
        state: () => ({ release: null as (() => void) | null }),
        onStart: ({ model, state }) => {
            state.release = model.boostVolatility(1.5);
        },
        onTick: ({ model }) => model.applyShock(0.008, 5),
        onEnd: ({ state, publish }) => {
            state.release?.();
            publish(FOLLOW_UPS.bubblePops);
        },
    }),
    // Looks bullish (and Embargoed Press Release will say so), until the correction comes out.
    defineNews({
        title: ({ ticker }) => `Star Analyst Upgrades $${ticker} to Strong Buy`,
        description: "A famous analyst slaps a bold price target on the stock.",
        durationSeconds: 20,
        fairValueShock: 0.1,
        onEnd: ({ publish }) => publish(FOLLOW_UPS.analystRetraction),
    }),
    // Real buying: the company lifts the offers every second, so sellers get filled at a premium.
    defineNews({
        title: "Company Announces Share Buyback",
        description: "The board authorizes buying back shares on the open market, starting right now.",
        durationSeconds: 15,
        fairValueShock: 0.04,
        onTick: ({ game }) => {
            game.sweep("buy", 0.01);
        },
    }),
    // A bet on the outcome: the bid lifts the fair value, but the deal can still be blocked.
    defineNews({
        title: ({ ticker }) => `Rival Bids for $${ticker} at a Premium`,
        description: "A competitor launches a takeover offer. Regulators will rule on it shortly.",
        durationSeconds: 25,
        fairValueShock: 0.12,
        onEnd: ({ rng, publish }) => publish(rng.chance(0.55) ? FOLLOW_UPS.takeoverApproved : FOLLOW_UPS.takeoverBlocked),
    }),
    // Ties the news into the power system: everyone gets a bonus briefcase.
    defineNews({
        title: "Unclaimed Briefcase Found on the Trading Floor",
        description: "Security found a briefcase with no owner. Finders keepers: everyone gets to look inside.",
        durationSeconds: 10,
        onStart: ({ game }) => game.powers.openBriefcases(),
    }),
];
