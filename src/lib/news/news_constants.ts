import type { NewsDescription } from "./news";

const CONSTANT_NEWS: NewsDescription[] = [{
    title: "Tech Giant Releases New Product",
    description: "The latest gadget has hit the market, promising to revolutionize the tech industry.",
    durationTicks: 20,
    onStart: (room,simulator)=>{
        if(simulator){
            simulator.generator.intrinsicShock(2, 1);
        }
    }
},{
    title: "Economic Growth Surges",
    description: "Recent reports indicate a significant increase in economic activity across multiple sectors.",
    durationTicks: 20
},{
    title: (room)=> `Breaking News for ticker $${room.settings.ticketName}`,
    description: "A major development has occurred affecting the stock market.",
    durationTicks: 20
},{
    title: "Federal Reserve Announces Interest Rate Decision",
    description: "The central bank's latest monetary policy announcement sends ripples through financial markets.",
    durationTicks: 25,
    onStart: (room,simulator)=>{
        if(simulator){
            simulator.generator.intrinsicShock(-1.5, 0.8);
        }
    }
},{
    title: "Merger & Acquisition Activity Heats Up",
    description: "Several major corporations announce strategic partnerships and acquisition deals this quarter.",
    durationTicks: 30
},{
    title: "Earnings Season Kicks Off",
    description: "Major companies begin reporting quarterly earnings with mixed results across industries.",
    durationTicks: 15
},{
    title: "Regulatory Changes Impact Industry",
    description: "New government regulations are set to reshape business operations in key sectors.",
    durationTicks: 35,
    onStart: (room,simulator)=>{
        if(simulator){
            simulator.generator.intrinsicShock(-2, 1.2);
        }
    }
},{
    title: "Oil Prices Fluctuate on Supply Concerns",
    description: "Energy markets react to geopolitical tensions and supply chain disruptions.",
    durationTicks: 18
},{
    title: "Consumer Confidence Index Released",
    description: "Latest consumer sentiment data reveals changing spending patterns and economic outlook.",
    durationTicks: 22
},{
    title: "Cryptocurrency Market Volatility",
    description: "Digital assets experience significant price movements amid regulatory uncertainty.",
    durationTicks: 12,
    onStart: (room,simulator)=>{
        if(simulator){
            simulator.generator.intrinsicShock(1.8, 2);
        }
    }
},{
    title: "Infrastructure Investment Plan Announced",
    description: "Government unveils major infrastructure spending program affecting construction and materials sectors.",
    durationTicks: 40
},{
    title: "Trade Negotiations Update",
    description: "International trade talks progress as nations work to resolve ongoing commercial disputes.",
    durationTicks: 28
}]

export {CONSTANT_NEWS}