import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type GameServer } from "../../src/server/server";
import { MessageType } from "../../src/protocol/messages";
import { builtinCatalog, testConfig } from "../helpers";

let app: GameServer;
let base: string;

beforeAll(() => {
    app = createServer({ ...testConfig, port: 0, reconnectGraceMs: 200 }, builtinCatalog);
    base = `127.0.0.1:${app.server.port}`;
});

afterAll(async () => {
    await app.stop();
});

/** A WebSocket client that buffers messages and can wait for a given type. */
async function client(path: string) {
    const ws = new WebSocket(`ws://${base}${path}`);
    const inbox: any[] = [];
    const waiters: { type: number; resolve: (m: any) => void }[] = [];
    ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        const i = waiters.findIndex((w) => w.type === msg.type);
        if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg);
        else inbox.push(msg);
    };
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });
    return {
        ws,
        inbox,
        send: (m: unknown) => ws.send(JSON.stringify(m)),
        next(type: number, timeout = 2000): Promise<any> {
            const i = inbox.findIndex((m) => m.type === type);
            if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
            return new Promise((resolve, reject) => {
                waiters.push({ type, resolve });
                setTimeout(() => reject(new Error(`timed out waiting for ${MessageType[type]}`)), timeout);
            });
        },
    };
}

describe("HTTP", () => {
    test("health and catalog endpoints", async () => {
        expect(await (await fetch(`http://${base}/`)).text()).toBe("OK");
        expect(await (await fetch(`http://${base}/zhealth`)).json()).toMatchObject({ ok: true });

        const powers = await fetch(`http://${base}/api/powers.json`);
        expect(powers.headers.get("access-control-allow-origin")).toBe("*");
        const list = (await powers.json()) as any[];
        expect(list.map((p) => p.id)).toContain("volatility-storm");
        expect(list[0]).toHaveProperty("iconSlug");

        const bots = (await (await fetch(`http://${base}/api/bots.json`)).json()) as any;
        expect(bots.data.map((b: any) => b.id)).toContain("LiquidityBot");
        expect(bots.data.map((b: any) => b.id)).not.toContain("HouseMarketMaker");

        const icon = await fetch(`http://${base}/assets/powers/siphon/robber-hand.svg`);
        expect(icon.status).toBe(200);
        expect(icon.headers.get("content-type")).toContain("image/svg+xml");
        expect(await icon.text()).toStartWith("<svg");
        expect((await fetch(`http://${base}/assets/powers/siphon/index.ts`)).status).toBe(404); // only referenced files are served
        expect((await fetch(`http://${base}/assets/powers/siphon/../../../package.json`)).status).toBe(404);

        expect((await fetch(`http://${base}/nope`)).status).toBe(404);
        expect((await fetch(`http://${base}/ws/bad%20room`)).status).toBe(400);
    });
});

describe("WebSocket game flow", () => {
    test("join, start, trade, receive portfolio, ping", async () => {
        const alice = await client("/ws/itest?username=alice");
        const id = await alice.next(MessageType.ID);
        expect(id.id).toStartWith("itest-");
        await alice.next(MessageType.IS_ADMIN);
        expect(await alice.next(MessageType.ROOM_STATE)).toMatchObject({ roomId: "itest", paused: true });

        alice.send({ type: MessageType.PING });
        await alice.next(MessageType.PONG);

        alice.send({ type: MessageType.TOGGLE_PAUSE });
        expect(await alice.next(MessageType.TOGGLE_PAUSE)).toEqual({ type: MessageType.TOGGLE_PAUSE, paused: false });
        let book = await alice.next(MessageType.ORDER_BOOK_UPDATE);
        while (book.depth[0].length === 0) book = await alice.next(MessageType.ORDER_BOOK_UPDATE); // house quotes on the first step

        alice.inbox.length = 0;
        alice.send({ type: MessageType.STOCK_ACTION, action: "BUY", orderType: "MARKET", quantity: 5, price: 0 });
        let portfolio = await alice.next(MessageType.PORTFOLIO_UPDATE);
        while (portfolio.value.shares === 0) portfolio = await alice.next(MessageType.PORTFOLIO_UPDATE);
        expect(portfolio.value.shares).toBe(5);
        expect(portfolio.value.cash).toBeLessThan(10_000);

        await alice.next(MessageType.CLOCK, 3000);
        alice.ws.close();
    });

    test("reconnect with prevSessionData resumes the same player", async () => {
        const first = await client("/ws/resume?username=bob");
        const { id } = await first.next(MessageType.ID);
        first.ws.close();
        await Bun.sleep(50);
        const second = await client(`/ws/resume?username=bob&prevSessionData=${id}`);
        expect((await second.next(MessageType.ID)).id).toBe(id);
        await second.next(MessageType.IS_ADMIN);
        second.ws.close();
    });

    test("spectating a missing room is refused", async () => {
        const spec = await client("/ws/ghost-room?spectator");
        expect(await spec.next(MessageType.ERROR)).toMatchObject({ message: "Room does not exist" });
    });

    test("malformed frames are ignored", async () => {
        const c = await client("/ws/garbage?username=x");
        await c.next(MessageType.ROOM_STATE);
        c.ws.send("{not json");
        c.ws.send(JSON.stringify({ type: MessageType.PORTFOLIO_UPDATE, value: { cash: 1e9 } }));
        c.send({ type: MessageType.PING });
        await c.next(MessageType.PONG);
        c.ws.close();
    });
});
