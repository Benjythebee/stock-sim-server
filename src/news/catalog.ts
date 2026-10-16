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

    // Headlines with `variants` roll their direction when drawn, and the tone matches the move.
    // A 0 variant keeps a headline as noise that only spooks the crowd.
    defineNews({
        title: "GDP Figures Released",
        description: "The latest quarterly growth numbers are out.",
        durationSeconds: 20,
        variants: [
            {
                title: "Economic Growth Surges",
                description: "GDP blows past forecasts, with activity up across almost every sector.",
                fairValueShock: 0.05,
            },
            {
                title: "Economy Grows in Line With Forecasts",
                description: "Steady, unspectacular growth. Economists call it 'fine'.",
                fairValueShock: 0,
            },
            {
                title: "Economy Unexpectedly Shrinks",
                description: "GDP contracts for the quarter, and the word 'recession' is suddenly everywhere.",
                fairValueShock: -0.05,
            },
        ],
    }),
    defineNews({
        title: ({ ticker }) => `Breaking News for ticker $${ticker}`,
        description: "A major development has occurred affecting the stock market.",
        durationSeconds: 20,
        variants: [
            {
                title: ({ ticker }) => `Breaking: $${ticker} Lands a Huge Government Contract`,
                description: "A multi-year deal that analysts say could double next year's revenue.",
                fairValueShock: 0.08,
            },
            {
                title: ({ ticker }) => `Breaking: $${ticker} Unveils a New Logo`,
                description: "It's the old logo, but slightly bluer. The internet has opinions.",
                fairValueShock: 0,
            },
            {
                title: ({ ticker }) => `Breaking: $${ticker} Recalls Its Flagship Product`,
                description: "Reports of units overheating force a costly worldwide recall.",
                fairValueShock: -0.08,
            },
        ],
    }),
    defineNews({
        title: "Federal Reserve Announces Interest Rate Decision",
        description: "The central bank's latest monetary policy announcement sends ripples through financial markets.",
        durationSeconds: 25,
        variants: [
            {
                title: "Fed Surprises Markets With a Rate Cut",
                description: "Cheaper money is on the way, and investors are already celebrating.",
                fairValueShock: 0.05,
            },
            {
                title: "Fed Holds Rates Steady",
                description: "No change, exactly as expected. The press conference was mostly about the weather.",
                fairValueShock: 0,
            },
            {
                title: "Fed Hikes Rates to Fight Inflation",
                description: "Borrowing just got more expensive, and growth stocks feel it first.",
                fairValueShock: -0.05,
                weight: 2,
            },
        ],
    }),
    defineNews({
        title: "Merger & Acquisition Activity",
        description: "Corporations announce partnerships and acquisition deals this quarter.",
        durationSeconds: 30,
        variants: [
            {
                title: "Merger & Acquisition Activity Heats Up",
                description: "Buyers are paying fat premiums, and every stock in the sector suddenly looks like a target.",
                fairValueShock: 0.04,
            },
            {
                title: "Merger Wave Fizzles as Deals Fall Through",
                description: "Several high-profile acquisitions collapse, and the takeover premium leaks out of the sector.",
                fairValueShock: -0.04,
            },
        ],
    }),
    defineNews({
        title: "Earnings Season Kicks Off",
        description: "Major companies begin reporting quarterly earnings with mixed results across industries.",
        durationSeconds: 15,
        variants: [
            {
                title: "Earnings Season Opens With a Wave of Beats",
                description: "Company after company tops expectations, and guidance is being raised across the board.",
                fairValueShock: 0.04,
            },
            {
                title: "Earnings Season Kicks Off With Mixed Results",
                description: "Some beats, some misses. Nobody can agree on what it means.",
                fairValueShock: 0,
            },
            {
                title: "Earnings Season Opens With a String of Misses",
                description: "Profit warnings pile up as companies blame costs, the weather and 'macro headwinds'.",
                fairValueShock: -0.04,
            },
        ],
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
        variants: [
            {
                title: "Oil Prices Tumble as Supply Fears Ease",
                description: "Cheaper energy means lower costs and fatter margins for almost everyone.",
                fairValueShock: 0.03,
            },
            {
                title: "Oil Spikes on Supply Disruption",
                description: "A pipeline outage sends crude soaring, and companies brace for higher costs.",
                fairValueShock: -0.04,
            },
        ],
    }),
    defineNews({
        title: "Consumer Confidence Index Released",
        description: "Latest consumer sentiment data reveals changing spending patterns and economic outlook.",
        durationSeconds: 22,
        variants: [
            {
                title: "Consumer Confidence Hits Record High",
                description: "Shoppers are in a spending mood: the latest survey shows the strongest sentiment in years.",
                fairValueShock: 0.06,
            },
            {
                title: "Consumer Sentiment Edges Into Positive Territory",
                description: "The latest report shows households cautiously optimistic about the months ahead.",
                fairValueShock: 0.02,
                weight: 2,
            },
            {
                title: "Consumer Sentiment Slips, Latest Report Shows",
                description: "Households are tightening their belts as worries about the economy creep back in.",
                fairValueShock: -0.02,
                weight: 2,
            },
            {
                title: "Consumer Confidence Plunges to Multi-Year Low",
                description: "Shoppers are spooked: the latest survey shows sentiment collapsing across every income group.",
                fairValueShock: -0.06,
            },
        ],
    }),
    defineNews({
        title: "Cryptocurrency Market Volatility",
        description: "Digital assets experience significant price movements amid regulatory uncertainty.",
        durationSeconds: 12,
        fairValueShock: 0.5,
    }),
    defineNews({
        title: "Infrastructure Investment Plan",
        description: "Lawmakers vote on a major infrastructure spending program.",
        durationSeconds: 40,
        variants: [
            {
                title: "Infrastructure Investment Plan Passes",
                description: "Billions in new spending on roads, grids and broadband. Suppliers are already hiring.",
                fairValueShock: 0.05,
            },
            {
                title: "Infrastructure Bill Stalls in Committee",
                description: "The spending plan is stuck in a partisan fight, and the projects it promised are on hold.",
                fairValueShock: -0.03,
            },
        ],
    }),
    defineNews({
        title: "Trade Negotiations Update",
        description: "International trade talks progress as nations work to resolve ongoing commercial disputes.",
        durationSeconds: 28,
        variants: [
            {
                title: "Breakthrough in Trade Talks: Tariffs to Be Lifted",
                description: "Negotiators shake hands on a deal that reopens key export markets.",
                fairValueShock: 0.05,
            },
            {
                title: "Trade Talks Drag On With No Deal in Sight",
                description: "Another round of meetings, another round of 'constructive discussions'.",
                fairValueShock: 0,
            },
            {
                title: "Trade Talks Collapse, New Tariffs Announced",
                description: "Retaliatory tariffs hit next month, and supply chains are scrambling.",
                fairValueShock: -0.06,
            },
        ],
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
