import type { PowerDescription, PowerDescriptionProperties } from "./power";

export const CONSTANT_POWERS= [
    createPower({
        rarity: 0.8,
        iconSlug: "volatility-storm",
        title: "Volatility Storm",
        description: "Increase market volatility for 20 seconds (everyone suffers).",
        durationTicks: 20,
        state:{
            prevVolatility:0
        },
        onConsume: (initiatorClient, room,state)=>{
            if(!room.simulator){
                return false;
            }

            state.prevVolatility = room.simulator.generator.volatility;

            if(state.prevVolatility >= 1){
                return true;
            }

            room.simulator.generator.volatility = Math.min(1, state.prevVolatility * 4);
            return true;
          
        },
        onEnd: (initiatorClient, room,state)=>{
            if(!room.simulator){
                return false
            }
            room.simulator.generator.volatility = state.prevVolatility;
            
        }
    }),
    createPower({
        rarity: 0.8,
        iconSlug: "rumor-mill",
        title: "Rumor Mill",
        description: "Trigger a false rumor that causes either a positive or negative shock to the market for 20 seconds (everyone suffers).",
        durationTicks:0,
        onConsume: (initiatorClient, room_)=>{
            if(!room_.simulator){
                return false;
            }

            room_.newsFactory?.addNews({
                title: "Market Rumor!",
                description: "A major event is rumored to be affecting the market. Traders react strongly!",
                durationTicks: 0,
                onStart: (room, simulator)=>{
                    const shockMagnitude = room.randomGenerator.nextNormal() * 5; // Random shock between -5 and +5
                    simulator.generator.shock(shockMagnitude);
                }})
            return true;
        }
    })
]

export const POWERS_JSON_FRIENDLY=CONSTANT_POWERS.map(power=>({
        title: power.title,
        iconSlug: power.iconSlug,
        description: power.description,
        rarity: power.rarity,
        price: power.price,
        durationTicks: power.durationTicks
    })) as PowerDescriptionProperties[];

function createPower<TState>(power: PowerDescription<TState>): PowerDescription<TState> {
    return power;
}