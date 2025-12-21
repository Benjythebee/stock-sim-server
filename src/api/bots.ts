import { getAllAvailableBots } from "../lib/bot";
import { POWERS_JSON_FRIENDLY } from "../lib/powers/power_constants";
import { ClientResponse } from "../utils/bun-response";
/**
 * API Handler for retrieving available powers /api/powers.json
 */
export const APIAvailableBots = (req: Bun.BunRequest<string>): Response => {
    
    const availableBots = getAllAvailableBots().map(BotClass => {

        return {
            id: BotClass.name,
            name: BotClass.name.replace(/([A-Z])/g, ' $1').trim(),
            //@ts-expect-error @TODO fix type of getAllAvailableBots
            description: BotClass.description,
        }
    });

    return new ClientResponse(JSON.stringify({data:availableBots}), {
        status: 200,
        headers: {
            "Content-Type": "application/json"
        }
    });
}