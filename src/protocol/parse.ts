import { MessageType, ORDER_CANCEL_ALL, POWER_SKIP_INDEX, type ClientMessage } from "./messages";

/** Inbound frames larger than this are dropped without parsing. */
export const MAX_FRAME_BYTES = 8 * 1024;

/** Longest display name kept, in characters. */
export const MAX_NAME_LENGTH = 32;

/** A display name without control characters or surrounding spaces, cut to MAX_NAME_LENGTH. May be empty. */
export const cleanName = (raw: string): string => raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/**
 * Parse and validate one inbound frame. Returns a well-typed message or null. Everything that
 * comes off the socket is untrusted, so every field is checked and coerced here, once, and the
 * rest of the server can rely on the types.
 */
export function parseClientMessage(raw: string | Buffer): ClientMessage | null {
    if (raw.length > MAX_FRAME_BYTES) return null;
    let msg: unknown;
    try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
    } catch {
        return null;
    }
    if (!msg || typeof msg !== "object") return null;
    const m = msg as Record<string, unknown>;

    switch (m.type) {
        case MessageType.PING:
            return { type: MessageType.PING };
        case MessageType.TOGGLE_PAUSE:
            return { type: MessageType.TOGGLE_PAUSE };
        case MessageType.STOCK_ACTION: {
            const action = m.action === "BUY" || m.action === "SELL" ? m.action : null;
            const orderType = m.orderType === "LIMIT" || m.orderType === "MARKET" ? m.orderType : null;
            const quantity = num(m.quantity);
            const price = orderType === "MARKET" ? 0 : num(m.price);
            if (!action || !orderType || !Number.isFinite(quantity) || !Number.isFinite(price)) return null;
            return { type: MessageType.STOCK_ACTION, action, orderType, quantity, price };
        }
        case MessageType.SHOCK:
            return m.target === "intrinsic" || m.target === "market" ? { type: MessageType.SHOCK, target: m.target } : null;
        case MessageType.ADMIN_SETTINGS:
            return m.settings && typeof m.settings === "object" && !Array.isArray(m.settings)
                ? { type: MessageType.ADMIN_SETTINGS, settings: m.settings as Record<string, unknown> }
                : null;
        case MessageType.RESET_GAME:
            return { type: MessageType.RESET_GAME };
        case MessageType.POWER_SELECT: {
            const index = num(m.index);
            return Number.isInteger(index) && index >= POWER_SKIP_INDEX ? { type: MessageType.POWER_SELECT, index } : null;
        }
        case MessageType.POWER_CONSUME:
            return typeof m.id === "string" && m.id.length <= 64 ? { type: MessageType.POWER_CONSUME, id: m.id } : null;
        case MessageType.ORDER_CANCEL: {
            const id = num(m.id);
            return Number.isSafeInteger(id) && (id > 0 || id === ORDER_CANCEL_ALL) ? { type: MessageType.ORDER_CANCEL, id } : null;
        }
        case MessageType.RENAME: {
            const username = typeof m.username === "string" ? cleanName(m.username) : "";
            return username ? { type: MessageType.RENAME, username } : null;
        }
        case MessageType.LOAN_BORROW:
            return { type: MessageType.LOAN_BORROW };
        case MessageType.LOAN_REPAY:
            if (m.portion === undefined || m.portion === "all") return { type: MessageType.LOAN_REPAY, portion: "all" };
            return m.portion === "half" ? { type: MessageType.LOAN_REPAY, portion: "half" } : null;
        default:
            return null;
    }
}
