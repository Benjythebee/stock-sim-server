import { defineNews, type NewsDefinition } from "./types";

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
];
