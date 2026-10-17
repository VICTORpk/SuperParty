import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./GameRoom";

const port = Number(process.env.PORT ?? 2567);

// Endpoint simples para health check (Render) e para "acordar" o servidor antes de conectar.
const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
    res.end("ok");
    return;
  }
});

const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define("game", GameRoom);

httpServer.listen(port, () => console.log(`[server] ouvindo na porta ${port}`));
