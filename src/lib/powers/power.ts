import { randomUUIDv7 } from "bun";
import type { TradingParticipant } from "../bot"
import type { Room } from "../room"
import type { Simulator } from "../simulator";
import { MessageType, type PowerConsumeMessage } from "../../types";
import { CONSTANT_POWERS, POWERS_JSON_FRIENDLY } from "./power_constants";
import type { Client } from "../client";

export type PowerDescriptionProperties = {
    id: string;
        /**
     * Rarity of the power for briefcase generation (lower is more rare)
     * 0 = never used for briefcases
     */
    rarity: number
    /**
     * Type of power - 'all' = affects all players, 'market' = affects market only, 'client' = affects only the client who used it
     * Default: 'market'
     */
    type?: 'client' | 'all' | 'market' | 'others';
    /**
     * Is the power instant - Instant means it's consumed on selection, otherwise it is kept in "inventory" until consumed
     */
    isInstant?: boolean;
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

export type PowerStringDesc = Pick<Power,'title'|'id'|'description'|'isInstant'|'price'|'rarity'|'type'>

export type PowerDescription<TState = Record<string, any>> = PowerDescriptionProperties &{
    /**
     * Optional state object to hold any custom state for the power;
     */
    state?: TState;
    /**
     * Callback when the power is consumed/activated
     */
    onConsume?: (description:PowerStringDesc, initiatorClient: Client, room: Room, state: TState) => void;
    /**
     * Callback on each Clock tick while the power is active
     */
    onTick?: (description:PowerStringDesc, initiatorClient: Client, room: Room, clock: number, state: TState) => void;
    /**
     * Callback when the power ends
     * NOTE: This will not be called if durationTicks is 0
     */
    onEnd?: (description:PowerStringDesc, initiatorClient: Client, room: Room, state: TState) => void;
}

export class PowerFactory {
    
    activePowers: Map<string, Power> = new Map();

    clientActiveOffers: Map<string, PowerDescription[]> = new Map();
    clientInventories: Map<string, Power[]> = new Map();

    timestampsForBriefcaseGeneration: number[] = [];

    constructor(public room: Room, public simulator: Simulator) {

        const endTime = Date.now() + this.room.settings.gameDuration*60*1000;

        /**
         * Let's split the game duration into 6 equal intervals and generate a power briefcase at each interval
         * but we want a minimum time of 30 seconds between briefcases
         * we also don't want to generate briefcases in the last 30 seconds of the game
         */
        // const interval = Math.max(30000, (endTime - Date.now() - 30000) / 6);
        const interval = Math.max(10000, (endTime - Date.now() - 10000) / 8);

        let nextTimestamp = Date.now() + interval;
        while(nextTimestamp < endTime - 10000) {
            this.timestampsForBriefcaseGeneration.push(nextTimestamp);
            nextTimestamp += interval;
        }

        console.log(`[${room.roomId}] Power briefcase generation timestamps:`, this.timestampsForBriefcaseGeneration);
    }

    // sendConsumePowerNotification = (power:Power, msg:{
    //     title: string;
    //     description?: string;
    // }) => {
    //     const message:PowerConsumeMessage = {
    //             type: MessageType.POWER_CONSUME, // Using NEWS type as there's no POWER type defined
    //             id: power.id,
    //             notification:msg
    //         }
    //     if(power.type ==='all' || power.type === 'others' || power.type === 'market'){
    //         this.room.sendToAll(message);
    //         return;
    //     }

    //     power.initiatorClient.send(message);
    // }

    private generateBriefcaseRandomChoices(count: number): PowerDescription[] {
        const availablePowers = POWERS_JSON_FRIENDLY.filter(power => power.rarity > 0);
        const totalRarity = availablePowers.reduce((sum, power) => sum + (1 / power.rarity), 0);
        const choices: PowerDescription<any>[] = [];
        while (choices.length < count && availablePowers.length > 0) {
            const rand = this.room.randomGenerator.next() * totalRarity;
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
    /**
     * Called when a client selects a power from their briefcase offers
     * @param client The client who selected the power
     */
    handleSelection(client: Client, selectedIndex: number) {
        const offers = this.clientActiveOffers.get(client.id);
        if(!offers) {
            return false;
        }
        const selectedPowerDesc = CONSTANT_POWERS.find(power => power.id === offers[selectedIndex]?.id);
        if(!selectedPowerDesc) {
            return false;
        }

        this.clientActiveOffers.delete(client.id);
        const power = this.addPower(selectedPowerDesc as PowerDescription, client)
        if(power.isInstant){
            power.consumePower();
        }else{
            this.clientInventories.set(client.id, [...(this.clientInventories.get(client.id)||[]), power]);
            // send updated inventory to client
            this.sendInventoryToClient(client);
        }
    }

    handleConsumption(client: Client, powerId: string) {
        const inventory = this.clientInventories.get(client.id);
        if(!inventory) {
            return false;
        }
        const power = inventory.find((power) => power.id === powerId);
        if(!power) {
            return false;
        }
        power.consumePower();
        this.clientInventories.set(client.id, inventory.filter((p) => p.uuid !== power.uuid));
        // send updated inventory to client
        this.sendInventoryToClient(client);
    }

    sendInventoryToClient(client: Client) {

        const inventory = this.clientInventories.get(client.id) || [];
        client.send({
            type: MessageType.POWER_INVENTORY,
            inventory: inventory.map(power=>(power.id)),
        });
    }

    /**
     * Only called when the user selected a power from their briefcase offers (not when consuming from inventory)
     */
    private addPower(powerDescription: PowerDescription, initiatorClient: Client) {
        const power = new Power(powerDescription, this, initiatorClient);

        if(!power.isInstant){
            this.clientInventories.set(initiatorClient.id, [...(this.clientInventories.get(initiatorClient.id)||[]), power]);
        }
        
        return power;
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
        this.clientInventories.clear();
        this.clientActiveOffers.clear();
        this.timestampsForBriefcaseGeneration = [];
        this.activePowers.clear();
        this.room = null as any;
        this.simulator = null as any;
    }
}

export class Power<Tstate = Record<string, any>> {
    id:string;
    uuid: string = randomUUIDv7();
    title: string;
    description: string;
    rarity: number;
    isInstant: boolean = false;
    price: number = 0;
    type: 'client' | 'market' | 'all' | 'others';
    private durationTicks: number;

    exhausted: boolean = false;
    private ticksElapsed: number = 0;

    private state:Tstate = {} as Tstate;

    /**
     * Customizable callbacks that are run on top of the default behavior
     */
    onConsume?: (description: PowerStringDesc, initiatorClient: Client, room: Room, state: Tstate) => void;
    onBonusTick?: (description: PowerStringDesc, initiatorClient: Client, room: Room, clock: number, state: Tstate) => void;
    onBonusEnd?: (description: PowerStringDesc, initiatorClient: Client, room: Room, state: Tstate) => void;

    constructor(powerDescription: PowerDescription<Tstate>, public factory: PowerFactory, public initiatorClient: Client) {
        this.id = powerDescription.id;
        this.title = typeof powerDescription.title === "string" ? powerDescription.title : powerDescription.title(factory.room);
        this.description = typeof powerDescription.description === "string" ? powerDescription.description : powerDescription.description(factory.room);
        this.rarity = powerDescription.rarity;
        this.type = powerDescription.type || 'market';
        this.durationTicks = powerDescription.durationTicks || 0;
        this.isInstant = powerDescription.isInstant ?? false;
        this.price = powerDescription.price || 0;
        this.exhausted = false;
        this.ticksElapsed = 0;
        this.state = powerDescription.state || {} as Tstate;

        this.onConsume = powerDescription.onConsume;
        this.onBonusTick = powerDescription.onTick;
        this.onBonusEnd = powerDescription.onEnd;
        const validated = Power.validate(powerDescription);
        if(validated.length > 0) {
            throw new Error(`Invalid PowerDescription: ${validated.join(", ")}`);
        }

    }

    toJSON = () => ({
        id: this.id,
        title: this.title,
        description: this.description,
        rarity: this.rarity,
        type: this.type,
        isInstant: this.isInstant,
        price: this.price,
        durationTicks: this.durationTicks
    })

    get room() {
        return this.factory.room;
    }
    
    get simulator() {
        return this.factory.simulator;
    }

    consumePower = () => {
        if(!this.onConsume){
            return;
        }
        this.onConsume(this.toJSON(), this.initiatorClient, this.room, this.state);

    };

    onTick = (clock: number) => {
        if(this.exhausted) return;
        
        this.ticksElapsed++;
        
        if(this.onBonusTick) {
            this.onBonusTick(this.toJSON(), this.initiatorClient, this.room, clock, this.state);
        }

        
        if(this.ticksElapsed >= this.durationTicks) {
            this.exhausted = true;
            this.factory.activePowers.delete(this.id);
            this.onBonusEnd?.(this.toJSON(), this.initiatorClient, this.room, this.state);
        }
    }

    onEnd = () => {
        this.exhausted = true;

        this.onBonusEnd?.(this.toJSON(), this.initiatorClient, this.room, this.state);
    }

    
    static validate(powerDescription: PowerDescription<any>): string[] {
        const error=[]
        if(powerDescription.durationTicks && powerDescription.durationTicks <= 0){
            error.push("durationTicks must be greater or equal than 0");
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

