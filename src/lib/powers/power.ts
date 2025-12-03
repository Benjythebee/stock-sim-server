import { randomUUIDv7 } from "bun";
import type { TradingParticipant } from "../bot"
import type { Room } from "../room"
import type { Simulator } from "../simulator";
import { MessageType } from "../../types";
import { CONSTANT_POWERS, POWERS_JSON_FRIENDLY } from "./power_constants";

export type PowerDescriptionProperties = {
        /**
     * Rarity of the power for briefcase generation (lower is more rare)
     * 0 = never used for briefcases
     */
    rarity: number
    /**
     * Unused for now, but could be used to target specific users or all users or the market
     */
    targetUserId?: string | 'all' | 'market';
    /**
     * Optional icon slug for the power (for UI display purposes only)
     */
    iconSlug?: string;
    /**
     * Title of the power
     */
    title: string | ((room: Room) => string);
    /**
     * Description of the power
     */
    description: string | ((room: Room) => string);
    /**
     * Price of the power in the shop (no price = never in the shop)
     */
    price?: number;
    /**
     * Duration of the power in Clock ticks (generally 1 tick = 1 second)
     */
    durationTicks: number;
}

export type PowerDescription<TState = Record<string, any>> = PowerDescriptionProperties &{
  
    /**
     * Optional state object to hold any custom state for the power;
     */
    state?: TState;
    /**
     * Callback when the power is consumed/activated
     */
    onConsume?: (initiatorClient: TradingParticipant, room: Room, state: TState) => boolean;
    /**
     * Callback on each Clock tick while the power is active
     */
    onTick?: (initiatorClient: TradingParticipant, room: Room, clock: number, state: TState) => void;
    /**
     * Callback when the power ends
     * NOTE: This will not be called if durationTicks is 0
     */
    onEnd?: (initiatorClient: TradingParticipant, room: Room, state: TState) => void;
}

export class PowerFactory {
    
    exhaustedPowers: Map<string, Power> = new Map();
    activePowers: Map<string, Power> = new Map();

    clientActiveOffers: Map<string, PowerDescription[]> = new Map();

    timestampsForBriefcaseGeneration: number[] = [];

    constructor(public room: Room, public simulator: Simulator) {

        const endTime = Date.now() + this.room.settings.gameDuration*60*1000;

        /**
         * Let's split the game duration into 6 equal intervals and generate a power briefcase at each interval
         * but we want a minimum time of 30 seconds between briefcases
         * we also don't want to generate briefcases in the last 30 seconds of the game
         */
        const interval = Math.max(30000, (endTime - Date.now() - 30000) / 6);

        let nextTimestamp = Date.now() + interval;
        while(nextTimestamp < endTime - 30000) {
            this.timestampsForBriefcaseGeneration.push(nextTimestamp);
            nextTimestamp += interval;
        }
    }

    generateBriefcaseRandomChoices(count: number): PowerDescription[] {
        const availablePowers = POWERS_JSON_FRIENDLY.filter(power => power.rarity > 0);
        const totalRarity = availablePowers.reduce((sum, power) => sum + (1 / power.rarity), 0);
        const choices: PowerDescription<any>[] = [];
        while (choices.length < count && availablePowers.length > 0) {
            const rand = this.room.randomGenerator.nextNormal() * totalRarity;
            let cumulative = 0;
            for (let i = 0; i < availablePowers.length; i++) {
                if(!availablePowers[i]) continue;
                cumulative += 1 / availablePowers[i]!.rarity;
                if (rand <= cumulative) {
                    choices.push(availablePowers[i]!);
                    availablePowers.splice(i, 1);
                    break;
                }
            }
        }
        return choices;
    }

    addPower(powerDescription: PowerDescription, initiatorClient: TradingParticipant) {
        const power = new Power(powerDescription, this, initiatorClient);
        if(power.exhausted) {
            this.exhaustedPowers.set(power.id, power);
        } else {
            this.activePowers.set(power.id, power);
        }
        return power;
    }

    removePower(powerId: string) {
        this.activePowers.delete(powerId);
        this.exhaustedPowers.delete(powerId);
    }

    private generatePowerForClients(){
        this.room.clientMap.forEach((client)=>{
            const powerDescription = this.generateBriefcaseRandomChoices(3)
            this.clientActiveOffers.set(client.id, powerDescription);
            client.send({
                type: MessageType.POWER_OFFERS,
                offers: powerDescription
            });
        });
    }

    tick = (clock: number) => {

        if(this.timestampsForBriefcaseGeneration.length > 0 && clock >= (this.timestampsForBriefcaseGeneration[0]||0)) {
            this.generatePowerForClients();
            this.timestampsForBriefcaseGeneration.shift();
        }


        for(const power of this.activePowers.values()) {
            power.onTick(clock);
        }
    }

    dispose() { 
        this.activePowers.clear();
        this.exhaustedPowers.clear();
        this.room = null as any;
        this.simulator = null as any;
    }
}

export class Power<Tstate = Record<string, any>> {
    id: string = randomUUIDv7();
    title: string;
    description: string;
    rarity: number;
    targetUserId: string | 'market' | 'all';
    private durationTicks: number;

    exhausted: boolean = false;
    private ticksElapsed: number = 0;

    private state:Tstate = {} as Tstate;

    /**
     * Customizable callbacks that are run on top of the default behavior
     */
    onBonusConsume?: (initiatorClient: TradingParticipant, room: Room, state: Tstate) => boolean;
    onBonusTick?: (initiatorClient: TradingParticipant, room: Room, clock: number, state: Tstate) => void;
    onBonusEnd?: (initiatorClient: TradingParticipant, room: Room, state: Tstate) => void;

    constructor(powerDescription: PowerDescription<Tstate>, public factory: PowerFactory, public initiatorClient: TradingParticipant) {
        
        this.title = typeof powerDescription.title === "string" ? powerDescription.title : powerDescription.title(factory.room);
        this.description = typeof powerDescription.description === "string" ? powerDescription.description : powerDescription.description(factory.room);
        this.rarity = powerDescription.rarity;
        this.targetUserId = powerDescription.targetUserId || 'market';
        this.durationTicks = powerDescription.durationTicks;
        this.exhausted = false;
        this.ticksElapsed = 0;
        this.state = powerDescription.state || {} as Tstate;
        this.onBonusConsume = powerDescription.onConsume;
        this.onBonusTick = powerDescription.onTick;
        this.onBonusEnd = powerDescription.onEnd;
        const validated = Power.validate(powerDescription);
        if(validated.length > 0) {
            throw new Error(`Invalid PowerDescription: ${validated.join(", ")}`);
        }
    }

    get room() {
        return this.factory.room;
    }
    
    get simulator() {
        return this.factory.simulator;
    }

    consumePower = () => {
        if(this.onBonusConsume){

            const consumed = this.onBonusConsume(this.initiatorClient, this.room, this.state);
            if (consumed) {
                // Send power notification to relevant clients
                const message = {
                    type: MessageType.NEWS, // Using NEWS type as there's no POWER type defined
                    title: `🔥 ${this.title}`,
                    description: this.description,
                    timestamp: Date.now(),
                    durationTicks: this.durationTicks
                };
    
                // if (this.targetUserId === 'all') {
                //     this.room.sendToAll(message);
                // } else if (this.targetClient) {
                //     this.room.sendToClient(this.targetClient.id, message);
                // }
            }
        }
    };

    onTick = (clock: number) => {
        if(this.exhausted) return;
        
        this.ticksElapsed++;
        
        if(this.onBonusTick) {
            this.onBonusTick(this.initiatorClient, this.room, clock, this.state);
        }

        
        if(this.ticksElapsed >= this.durationTicks) {
            this.exhausted = true;
            this.factory.exhaustedPowers.set(this.id, this as any);
            this.factory.activePowers.delete(this.id);
            this.onBonusEnd?.(this.initiatorClient, this.room,this.state);
        }
    }

    
    static validate(powerDescription: PowerDescription<any>): string[] {
        const error=[]
        if(powerDescription.durationTicks <= 0){
            error.push("durationTicks must be greater than 0");
        };
        if(!powerDescription.title) {
            error.push("title is required");
        };
        if(!powerDescription.description) {
            error.push("description is required");
        };
        if(powerDescription.rarity < 0) {
            error.push("rarity must be non-negative");
        };
        if(powerDescription.onEnd && powerDescription.durationTicks === 0) {
            error.push("onEnd callback will never be called if durationTicks is 0");
        };
        return error;
    }

}

