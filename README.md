# Jogo Social Multiplayer 3D

Veja `PRD.md` (v1.1) para as regras e decisões aprovadas.

## Desenvolvimento
```bash
npm install
npm run dev:server        # servidor Colyseus em ws://localhost:2567
npm run dev:web           # front-end em http://localhost:5173 (copie apps/web/.env.example para .env se mudar a URL)
npm test                  # testes unitários (Vitest)
npx tsx apps/server/scripts/smoke.ts   # teste de fumaça com o servidor rodando
```

## Publicação (gratuita)
- **Front-end:** Cloudflare Pages. Build: `npm run build -w @jogo/web`, saída `apps/web/dist`, variável `VITE_SERVER_URL=wss://<seu-servico>.onrender.com`.
- **Servidor:** Render (Web Service, plano free). Build: `npm install`; Start: `npm run start -w @jogo/server`; health check: `/health`.
  O plano free hiberna após ~15 min sem uso (o primeiro acesso demora ~1 min).

## Testar sozinho
```bash
npx tsx apps/server/scripts/bot.ts CODIGO [apelido] [acerto 0-1]   # bot: vai até a estação, entra na fila do tabuleiro e joga (inclui lutar na arena)
npx tsx apps/server/scripts/board-smoke.ts                          # partida completa com 2 bots (~2 min)
```

Para testar a arena sem esperar um encontro por sorte, suba o servidor com `BOARD_DEBUG_ARENA=1 npm run dev:server` (os dois primeiros jogadores vão para a arena 1,5 s após o início do tabuleiro). Não use em produção.
# SuperParty

## Publicar o front-end no Vercel (Root Directory = `apps/web`)
O `apps/web/vercel.json` instala as dependências na raiz do monorepo (incluindo as de desenvolvimento, necessárias para o `tsc` e o `vite`) e publica `apps/web/dist`.
Defina a variável de ambiente **`VITE_SERVER_URL`** no projeto do Vercel com o endereço do servidor de jogo (`wss://...`). O servidor (Colyseus, WebSocket) **não roda no Vercel**: hospede-o à parte (por exemplo, Render).
