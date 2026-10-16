import { describe, expect, test } from "bun:test";
import { MessageType, MessageTypeNames } from "../../src/protocol/messages";
import { MAX_FRAME_BYTES, parseClientMessage } from "../../src/protocol/parse";

const parse = (v: unknown) => parseClientMessage(JSON.stringify(v));

describe("parseClientMessage", () => {
    test("rejects garbage", () => {
        expect(parseClientMessage("not json")).toBeNull();
        expect(parse(null)).toBeNull();
        expect(parse([1, 2])).toBeNull();
        expect(parse({})).toBeNull();
        expect(parse({ type: "10" })).toBeNull();
        expect(parse({ type: 12345 })).toBeNull();
        expect(parseClientMessage("x".repeat(MAX_FRAME_BYTES + 1))).toBeNull();
    });

    test("ignores server-only message types sent by clients", () => {
        expect(parse({ type: MessageType.PORTFOLIO_UPDATE, value: { cash: 1e9 } })).toBeNull();
        expect(parse({ type: MessageType.IS_ADMIN })).toBeNull();
        expect(parse({ type: MessageType.ORDER_UPDATE, orders: [], reset: true })).toBeNull();
    });

    test("stock action: validates and coerces", () => {
        expect(parse({ type: 10, action: "BUY", orderType: "LIMIT", quantity: "5", price: "1.25" })).toEqual({
            type: MessageType.STOCK_ACTION,
            action: "BUY",
            orderType: "LIMIT",
            quantity: 5,
            price: 1.25,
        });
        expect(parse({ type: 10, action: "SELL", orderType: "MARKET", quantity: 3 })).toMatchObject({ price: 0 });
        expect(parse({ type: 10, action: "HODL", orderType: "LIMIT", quantity: 1, price: 1 })).toBeNull();
        expect(parse({ type: 10, action: "BUY", orderType: "STOP", quantity: 1, price: 1 })).toBeNull();
        expect(parse({ type: 10, action: "BUY", orderType: "LIMIT", quantity: "abc", price: 1 })).toBeNull();
        expect(parse({ type: 10, action: "BUY", orderType: "LIMIT", quantity: 1 })).toBeNull();
    });

    test("powers", () => {
        expect(parse({ type: 81, index: 2 })).toEqual({ type: MessageType.POWER_SELECT, index: 2 });
        expect(parse({ type: 81, index: 1.5 })).toBeNull();
        expect(parse({ type: 81, index: -1 })).toEqual({ type: MessageType.POWER_SELECT, index: -1 }); // skip
        expect(parse({ type: 81, index: -2 })).toBeNull();
        expect(parse({ type: 82, id: "rumor-mill" })).toEqual({ type: MessageType.POWER_CONSUME, id: "rumor-mill" });
        expect(parse({ type: 82, id: 5 })).toBeNull();
    });

    test("order cancel: a positive id or -1 (all)", () => {
        expect(parse({ type: 20, id: 3 })).toEqual({ type: MessageType.ORDER_CANCEL, id: 3 });
        expect(parse({ type: 20, id: "3" })).toEqual({ type: MessageType.ORDER_CANCEL, id: 3 });
        expect(parse({ type: 20, id: -1 })).toEqual({ type: MessageType.ORDER_CANCEL, id: -1 });
        expect(parse({ type: 20, id: 0 })).toBeNull();
        expect(parse({ type: 20, id: -2 })).toBeNull();
        expect(parse({ type: 20, id: 1.5 })).toBeNull();
        expect(parse({ type: 20 })).toBeNull();
    });

    test("admin", () => {
        expect(parse({ type: 3 })).toEqual({ type: MessageType.TOGGLE_PAUSE });
        expect(parse({ type: 13, target: "market" })).toEqual({ type: MessageType.SHOCK, target: "market" });
        expect(parse({ type: 13, target: "moon" })).toBeNull();
        expect(parse({ type: 30, settings: { bots: 3 } })).toEqual({ type: MessageType.ADMIN_SETTINGS, settings: { bots: 3 } });
        expect(parse({ type: 30, settings: [1] })).toBeNull();
    });

    test("ping", () => {
        expect(parse({ type: 6 })).toEqual({ type: MessageType.PING });
    });

    test("MessageTypeNames covers every type", () => {
        expect(MessageTypeNames[MessageType.POWER_OFFERS]).toBe("POWER_OFFERS");
        expect(MessageTypeNames[MessageType.ID]).toBe("ID");
    });
});
