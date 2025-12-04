import type { PowerDescription, PowerDescriptionProperties } from "./power";

export const CONSTANT_POWERS= [
    createPower({
        id: "volatility-storm",
        rarity: 0.8,
        iconSlug: "volatility-storm",
        type:'market',
        isInstant:false,
        title: "Volatility Storm",
        description: "Increase market volatility for 20 seconds (everyone suffers).",
        durationTicks: 20,
        state:{
            prevVolatility:0
        },
        onConsume: (desc, initiatorClient, room,state)=>{
            if(!room.simulator){
                return 
            }

            state.prevVolatility = room.simulator.generator.volatility;
            if(state.prevVolatility >= 1){
                return room.notify([initiatorClient],{
                    level: 'info',
                    title: 'Volatility Storm',
                    description: `Market volatility has peaked.`,
                });
            }

            room.simulator.generator.volatility = Math.min(1, state.prevVolatility * 4);
            return room.notify([initiatorClient],{
                    level: 'success',
                    title: desc.title,
                    description:`Volatility has increased by 4x to ${room.simulator.generator.volatility.toFixed(2)}%`,
                });
          
        },
        onEnd: (desc,initiatorClient, room,state)=>{
            if(!room.simulator){
                return 
            }
            room.simulator.generator.volatility = state.prevVolatility;
            
            return room.notify([initiatorClient],{
                    level: 'info',
                    title: desc.title,
                    description:`Volatility has returned to ${room.simulator.generator.volatility.toFixed(2)}%`,
                });
        }
    }),
    createPower({
        id: "rumor-mill",
        rarity: 0.2,
        iconSlug: "talk",
        title: "Rumor Mill",
        isInstant:false,
        type:'market',
        description: "Trigger a false rumor that causes a random shock to the market for 20 seconds (everyone suffers).",
        durationTicks:0,
        onConsume: (desc,initiatorClient, room)=>{
            if(!room.simulator){
                return
            }

            room.newsFactory?.addNews({
                title: "Market Rumor!",
                description: "A major event is rumored to be affecting the market. Traders react strongly!",
                durationTicks: 0,
                onStart: (room_, simulator)=>{
                    const rdn = room_.randomGenerator.next()
                    console.log(rdn)
                    const shockMagnitude = rdn * 5; // Random shock between -5 and +5
                    simulator.generator.shock(shockMagnitude);
                    const clients = room_.getClients().filter(c=>c.id !== initiatorClient.id);
                    room.notify(clients,{
                        level: 'warning',
                        title: desc.title,
                        description:'A rumor has been spread in the market.'
                    });
                }})
            return 
        }
    }),
    createPower({
        id: "cash-heritage",
        rarity: 0.1,
        iconSlug: "present",
        title: "Cash Heritage",
        isInstant:true,
        type:'client',
        description: "Instantly receive cash from your ancestors.",
        durationTicks:0,
        onConsume: (desc,initiatorClient, room)=>{
            if(!room.simulator){
                return 
            }
            const initialCash = room.settings.startingCash; // use initial cash for reference so we don't give too much;
            const cashAmount = 1000 + Math.floor(room.randomGenerator.next() * initialCash); // Random cash between 1000 and 1500
            initiatorClient.availableCash += cashAmount;
            initiatorClient.onPortfolioUpdate?.(initiatorClient.portfolio);
            room.notifyAll({
                level: 'success',
                title: desc.title,
                description:`You have received $${cashAmount.toFixed(2)} from your ancestors.`
            });
            return ;
        }
    }),
    createPower({
        id: "the-homeless-gift",
        rarity: 0.1,
        iconSlug: "present",
        title: "The Homeless Man's Gift",
        isInstant:true,
        type:'client',
        description: "A homeless man gives you a gift.",
        durationTicks:0,
        onConsume: (desc,initiatorClient, room_)=>{
            if(!room_.simulator){
                return 
            }
            const cashAmount = 1;
            initiatorClient.availableCash += cashAmount;
            initiatorClient.onPortfolioUpdate?.(initiatorClient.portfolio);

            room_.notify([initiatorClient],{
                level: 'success',
                title: desc.title,
                description:`You have received $${cashAmount.toFixed(2)} from a homeless man. Feel grateful!`
            });

            return 
        }
    }),
    createPower({
        id: "the-hacker-ddos",
        rarity: 0.1,
        iconSlug: "stop",
        title: "The Hacker: DDoS Attack",
        isInstant:false,
        type:'others',
        description: "Launch a DDoS attack on all traders. Disabling their ability to trade for 15 seconds.",
        durationTicks:15,
        onConsume: (desc, initiatorClient, room,state)=>{

            if(!room.simulator){
                return 
            }

            room.getClients().forEach(client => {
                if(client.id === initiatorClient.id){
                    return;
                }
                client.toggleDisabledTrading(true);
            });

            /**
             * Notify the initiator and other clients
             */
            room.notify([initiatorClient],{
                level: 'success',
                title: desc.title,
                description:`You have launched a DDoS attack on your targets.`
            })

            room.notify(room.getClients().filter(client => client.id !== initiatorClient.id),{
                level: 'warning',
                title: desc.title,
                description:`${initiatorClient.name} hired a hackers to block everybody. You cannot trade for 15 seconds.`,
            })

        },
        onEnd: (desc,initiatorClient, room,state)=>{
            room.getClients().forEach(client => {
                if(client.id === initiatorClient.id){
                    return;
                }
                client.toggleDisabledTrading(false);
            });
            room.notify([initiatorClient],{
                level: 'info',
                title: desc.title,
                description:`Your hacker's DDOS ended.`
            })
            room.notify(room.getClients().filter(client => client.id !== initiatorClient.id),{
                level: 'success',
                title: desc.title,
                description:`You can trade again.`,
            })
        }
    })
]

export const POWERS_JSON_FRIENDLY=CONSTANT_POWERS.map(power=>({
        id: power.id,
        title: power.title,
        type: power.type || 'market',
        iconSlug: power.iconSlug,
        isInstant: power.isInstant || false,
        description: power.description,
        rarity: power.rarity,
        price: power.price,
        durationTicks: power.durationTicks
    })) as PowerDescriptionProperties[];

function createPower<TState>(power: PowerDescription<TState>): PowerDescription<TState> {
    return power;
}