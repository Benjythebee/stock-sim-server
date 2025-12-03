import { POWERS_JSON_FRIENDLY } from "../lib/powers/power_constants";
import { ClientResponse } from "../utils/bun-response";
/**
 * API Handler for retrieving available powers /api/powers.json
 */
export const APIPowerHandler = (req: Bun.BunRequest<string>): Response => {
    
    return new ClientResponse(JSON.stringify(POWERS_JSON_FRIENDLY), {
        status: 200,
        headers: {
            "Content-Type": "application/json"
        }
    });
}