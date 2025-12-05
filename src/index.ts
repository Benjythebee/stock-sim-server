import { APIPowerHandler } from "./api/powers";
import { parseMessageJson } from "./lib/parse";
import roomManager from "./lib/roomManager";
import { MessageType, MessageTypeNames } from "./types";

const server = Bun.serve<{roomId:string,id:string,username:string,spectator?:boolean}>({
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
            // get roomID from params
            const roomId = (req.params as any).roomId
            const searchParams = new URL(req.url).searchParams

            // get userId from cookie
            const userId = cookies ? cookies : crypto.randomUUID();
            const spectator = typeof searchParams.get("spectator") === "string";
            const username = searchParams.get("username") || crypto.randomUUID();
            const prevSessionData = searchParams.get("prevSessionData")

            const upgrade = ({room,id,username,spectator}:{
                room:string,
                id:string,
                username:string,
                spectator?:boolean
            })=>{
                req.cookies.set("x-room-ws-id", id, {httpOnly:true, sameSite:"lax"});

                return server.upgrade(req,{
                    data:{roomId:room,id,username,spectator}
                })
            }

            /**
             * If no userId cookie, try to extract from socketId param from URL (used when reconnecting )
             */
            if(typeof prevSessionData === "string"){
                const splitted = prevSessionData.split("-")
                const room = splitted[0];
                const id = splitted.slice(1).join("-")

                // Check that roomId from URL matches room from params
                if(room && roomId === room && id){

                    if(upgrade({room, id, username, spectator})){
                        return;
                    }
                }
            }

            if(upgrade({room:(req.params as any).roomId, id:userId, username, spectator})){
                return;
            }

            return new Response('Upgrade failed', { status: 500 });
        }
    },
    websocket: {
        data: {} as {roomId:string,id:string,username:string,spectator?:boolean},
        open: (ws) => {
            if(!ws.data) {
                ws.data = {
                    roomId: crypto.randomUUID(),
                    id: crypto.randomUUID(),
                    username: crypto.randomUUID(),
                    spectator:false
                };
            }

            if(!ws.data.roomId) {
                ws.data.roomId = crypto.randomUUID();
            }

            let room = roomManager.getRoom(ws.data.roomId)

            if(!room){
                if(ws.data.spectator){
                    // Room does not exist, cannot join as spectator
                    ws.send(JSON.stringify({type:MessageType.ERROR,message:"Room does not exist"}));
                    ws.close();
                    return;
                }
                room = roomManager.createRoom(ws.data.roomId);
            }

            if(ws.data.spectator){
                room.addSpectatorClient(ws);
                console.log(`Spectator ${ws.data.username} connected to room ${ws.data.roomId} `);
            }else{
                room.addClient(ws);
                console.log(`Client ${ws.data.username} connected to room ${ws.data.roomId} `);
            }

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
            console.log(`[MSG:${MessageTypeNames[msg.type]}]`, msg);

            if(msg.type === MessageType.STOCK_ACTION){
                const client = room.getClient(ws.data.id)
                if(!client) return;
                client.handleStockAction(msg);
                return;
            }

            if(msg.type === MessageType.POWER_SELECT){
                const client = room.getClient(ws.data.id)
                if(!client) return;
                room.powerFactory?.handleSelection(client, msg.index);
                return;
            }

            if(msg.type === MessageType.POWER_CONSUME){
                const client = room.getClient(ws.data.id)
                if(!client) return;
                room.powerFactory?.handleConsumption(client, msg.id);
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
                        room.simulator?.generator.intrinsicShock(room.randomGenerator.nextNormal()*0.8 );
                        return;
                    }
                    room.simulator?.generator.shock(room.randomGenerator.nextNormal()*0.5)
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
                    room.spectatorManager.sendRoomState()
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
                    client.markAsDisconnected();
                }else {
                    room.spectatorManager.removeSpectator(ws);
                }
            }
        },
    }, // handlers
});

roomManager.setServer(server);

console.log(`Server started on port ${server.port}`);