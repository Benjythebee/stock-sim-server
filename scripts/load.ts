/**
 * Load generator. Spawns a server (or targets one with --url), connects N players to one room,
 * has the admin start the game, then every player fires random orders at a fixed rate.
 *
 * It only speaks the public wire protocol, so it can benchmark any server version.
 *
 *   bun scripts/load.ts                                   # spawn ./src/index.ts on a free port
 *   bun scripts/load.ts --entry ../old/src/index.ts       # spawn another checkout
 *   bun scripts/load.ts --url ws://localhost:3000         # target an already-running server
 *   options: --clients 25 --rate 20 (orders/s per client) --seconds 15 --bots 10
 */
import { spawn, type Subprocess } from "bun";

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) args.set(Bun.argv[i]!.replace(/^--/, ""), Bun.argv[i + 1] ?? "");

const CLIENTS = Number(args.get("clients") ?? 25);
const RATE = Number(args.get("rate") ?? 20);
const SECONDS = Number(args.get("seconds") ?? 15);
const BOTS = Number(args.get("bots") ?? 10);
const ENTRY = args.get("entry") ?? "src/index.ts";

// Message type numbers from the protocol (kept literal so this works against any version).
const T = { ID: -1, IS_ADMIN: 2, TOGGLE_PAUSE: 3, PING: 6, PONG: 7, STOCK_ACTION: 10, STOCK_MOVEMENT: 11, ADMIN_SETTINGS: 30 } as const;

let server: Subprocess | null = null;
let baseUrl = args.get("url");
if (!baseUrl) {
    const port = 40000 + Math.floor(Math.random() * 10000);
    server = spawn(["bun", "run", ENTRY], {
        env: { ...process.env, PORT: String(port), LOG_LEVEL: "warn" },
        stdout: "ignore",
        stderr: "inherit",
    });
    baseUrl = `ws://localhost:${port}`;
    await waitForServer(`http://localhost:${port}/zhealth`);
}

const roomId = `load${Date.now()}`;
let lastPrice = 1;
const received = new Map<number, number>();
let bytesReceived = 0;
const rtts: number[] = [];
let ordersSent = 0;

type Bench = { ws: WebSocket; pingAt: number };
const clients: Bench[] = [];

for (let i = 0; i < CLIENTS; i++) {
    clients.push(await connect(i));
    if (i === 0) await Bun.sleep(100); // let the room get created by the first (admin) player
}

const admin = clients[0]!;
admin.ws.send(JSON.stringify({ type: T.ADMIN_SETTINGS, settings: { bots: BOTS } }));
admin.ws.send(JSON.stringify({ type: T.ADMIN_SETTINGS, settings: { gameDuration: 10 } }));
await Bun.sleep(300);
admin.ws.send(JSON.stringify({ type: T.TOGGLE_PAUSE }));
await Bun.sleep(500);

const cpuStart = server ? cpuSeconds(server.pid) : 0;
received.clear();
bytesReceived = 0;
const started = performance.now();

const orderTimers = clients.map((c) =>
    setInterval(() => {
        const buy = Math.random() < 0.5;
        const market = Math.random() < 0.3;
        const price = Math.max(0.01, +(lastPrice * (1 + (Math.random() - 0.5) * 0.04)).toFixed(2));
        c.ws.send(JSON.stringify({
            type: T.STOCK_ACTION,
            action: buy ? "BUY" : "SELL",
            orderType: market ? "MARKET" : "LIMIT",
            quantity: 1 + Math.floor(Math.random() * 5),
            price,
        }));
        ordersSent++;
    }, 1000 / RATE),
);
const pingTimer = setInterval(() => {
    for (const c of clients) {
        c.pingAt = performance.now();
        c.ws.send(JSON.stringify({ type: T.PING }));
    }
}, 250);

await Bun.sleep(SECONDS * 1000);
orderTimers.forEach(clearInterval);
clearInterval(pingTimer);
const elapsed = (performance.now() - started) / 1000;
const cpuUsed = server ? cpuSeconds(server.pid) - cpuStart : NaN;

rtts.sort((a, b) => a - b);
const pct = (p: number) => (rtts.length ? rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * p))]!.toFixed(1) : "n/a");
const totalMsgs = [...received.values()].reduce((a, b) => a + b, 0);

console.log(JSON.stringify({
    entry: server ? ENTRY : baseUrl,
    clients: CLIENTS,
    ordersPerSecond: +(ordersSent / elapsed).toFixed(0),
    serverCpuPercent: +((cpuUsed / elapsed) * 100).toFixed(1),
    pingRttMs: { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: pct(1) },
    msgsReceivedPerSecond: +(totalMsgs / elapsed).toFixed(0),
    kbReceivedPerSecond: +(bytesReceived / 1024 / elapsed).toFixed(0),
    byType: Object.fromEntries([...received.entries()].sort((a, b) => b[1] - a[1])),
}, null, 2));

clients.forEach((c) => c.ws.close());
server?.kill();
process.exit(0);

function connect(i: number): Promise<Bench> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${baseUrl}/ws/${roomId}?username=load${i}`);
        const bench: Bench = { ws, pingAt: 0 };
        ws.onopen = () => resolve(bench);
        ws.onerror = (e) => reject(e);
        ws.onmessage = (ev) => {
            const data = String(ev.data);
            bytesReceived += data.length;
            const msg = JSON.parse(data);
            received.set(msg.type, (received.get(msg.type) ?? 0) + 1);
            if (msg.type === T.STOCK_MOVEMENT && typeof msg.price === "number") lastPrice = msg.price;
            if (msg.type === T.PONG && bench.pingAt) {
                rtts.push(performance.now() - bench.pingAt);
                bench.pingAt = 0;
            }
        };
    });
}

async function waitForServer(url: string) {
    for (let i = 0; i < 100; i++) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {}
        await Bun.sleep(100);
    }
    throw new Error(`server did not start: ${url}`);
}

/** Total CPU seconds used by a process (user + kernel). */
function cpuSeconds(pid: number): number {
    if (process.platform === "win32") {
        const out = Bun.spawnSync(["powershell", "-NoProfile", "-Command", `(Get-Process -Id ${pid}).CPU`]).stdout.toString();
        return Number(out.trim().replace(",", ".")) || 0;
    }
    const out = Bun.spawnSync(["ps", "-o", "cputime=", "-p", String(pid)]).stdout.toString().trim();
    const [h, m, s] = out.split(":").map(Number);
    return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
}
