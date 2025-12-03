import { APIPowerHandler } from "./api/powers";
import { parseJSON, parseMessageJson } from "./lib/parse";
import roomManager from "./lib/roomManager";
import { MessageType } from "./types";

const server = Bun.serve<{roomId:string,id:string,username:string}>({
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    hostname:'localhost',
    // fetch(req) {
    //     const res = new Response('hello world');
    //     res.headers.set('Access-Control-Allow-Origin', '*');
    //     res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    //     // add Access-Control-Allow-Headers if needed
    //     return res;
    // },
    // `routes` requires Bun v1.2.3+
    routes: {
        // Static routes
        "/": new Response("OK"),
        "/zhealth": new Response("OK"),
        "/api/powers.json": APIPowerHandler,
        '/ws/:roomId': (req) => {
            const cookies = req.headers.get("x-room-ws-id");
            const searchParams = new URL(req.url).searchParams
            const userId = cookies ? cookies : crypto.randomUUID();
            const username = searchParams.get("username") || crypto.randomUUID();
            req.cookies.set("x-room-ws-id", userId, {httpOnly:true, sameSite:"lax"});
            req.cookies.set("x-room-ws-username", username, {httpOnly:true, sameSite:"lax"});
            if (server.upgrade(req,{
                data:{roomId:(req.params as any).roomId,id:userId,username}
            })) {
                return; 
            }
            return new Response('Upgrade failed', { status: 500 });
        }
    },
    websocket: {
        data: {} as {roomId:string,id:string,username:string},
        open: (ws) => {

            if(!ws.data) {
                ws.data = {
                    roomId: crypto.randomUUID(),
                    id: crypto.randomUUID(),
                    username: crypto.randomUUID()
                };
            }

            if(!ws.data.roomId) {
                ws.data.roomId = crypto.randomUUID();
            }

            let room = roomManager.getRoom(ws.data.roomId)

            if(!room){
                room = roomManager.createRoom(ws.data.roomId);
            }
            room.addClient(ws);


        console.log("Client connected");
        },
        message: (ws, message) => {
            const msg = parseMessageJson(String(message));
            if(!msg) return;
            // handle ping-pong directly here
            if(msg.type === MessageType.PING){
                ws.send(JSON.stringify({type:MessageType.PONG}));
                return;
            }

            const room = roomManager.getRoom(ws.data.roomId)
            if(!room) return;
            console.log("Received message:", msg);

            if(msg.type === MessageType.STOCK_ACTION){
                const client = room.getClient(ws.data.id)
                if(!client) return;
                client.handleStockAction(msg);
                return;
            }

            const isAdmin = ws.data.id === room.adminClient?.id

            if(isAdmin){
                if(msg.type === MessageType.TOGGLE_PAUSE){
                    room.togglePause();
                    return;
                }

                if(msg.type === MessageType.SHOCK){
                    if(msg.target === 'intrinsic'){
                        room.simulator?.generator.intrinsicShock(room.randomGenerator.nextNormal()*3, 1);
                        return;
                    }
                    room.simulator?.generator.shock(room.randomGenerator.nextNormal()*50)
                    return;
                }

                if(msg.type === MessageType.ADMIN_SETTINGS){
                    if(!room.simulator || !room.isPaused){
                        room.adminClient?.send({type:MessageType.ERROR,message:"Game is not paused"});
                        return;
                    }
                    room.setSettings(msg.settings);
                    room.setup()
                    
                    room.clientMap.forEach(client=>{
                        room.sendRoomState(client);
                    })
                    return;
                }
            }else{
                
                if(msg.type === MessageType.TOGGLE_PAUSE){
                    ws.send(JSON.stringify(msg))
                    return;
                }

            }


        },
        close: (ws) => {
            const room = roomManager.getRoom(ws.data.roomId)
            if(room){
                console.log("Client disconnected for room", room.roomId);
                const client = room.clientMap.get(ws.data.id)
                if(client){
                    room.removeClient(client)
                }
                if(room.clientMap.size === 0){
                    room.dispose();
                    roomManager.deleteRoom(room.roomId)
                }
            }
        },
    }, // handlers
});

roomManager.setServer(server);

console.log(`Server started on port ${server.port}`);