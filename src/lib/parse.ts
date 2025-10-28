import { MessageType, type ChatMessage, type ErrorMessage, type JoinMessage, type LeaveMessage, type Message, type PingMessage, type PongMessage, type StockMessage, type StockMovementMessage } from "../types";


export function parseJSON(message: string): any {
    try {
        return JSON.parse(message);
    } catch (error) {
        console.error("Failed to parse JSON:", error);
        return null;
    }
}

export function parseMessageJson(message: string): Message | null {
    try {
        const msg = JSON.parse(message);
        if (!msg || typeof msg !== 'object') {
            return null;
        }

        if(!('type' in msg) || typeof msg.type !== 'number') {
            return null;
        }

        return msg as Message;
    } catch (error) {
        console.error("Failed to parse JSON:", error);
        return null;
    }
}
