# Contexto do projeto (para retomar o trabalho)

Última atualização: 2026-10-17 · PRD na versão 1.12 (`PRD.md`) · Idioma da conversa e da interface: português (Brasil).

## O que é
Jogo social multiplayer 3D no navegador, salas privadas por código (até 10 jogadores), lobby 3D, chat, tabuleiro com arena de combate, sinuca clássica e sinuca Impostor. Restrição do dono: **só ferramentas/serviços gratuitos**; trabalha sozinho.

## Arquitetura (decidida)
- Monorepo npm workspaces: `apps/web` (Vite + React + React Three Fiber), `apps/server` (Colyseus 0.16, servidor autoritativo, sem banco), `packages/shared` (regras puras, tipos, protocolo).
- Hospedagem prevista: front no Cloudflare Pages, servidor no Render free (ou Oracle Always Free se o cold start incomodar). Ainda **não publicado**.
- Sem login: apelido + cor; token de reconexão em `sessionStorage`.

## Como rodar
```bash
npm install
npm run dev:server      # ws://localhost:2567  (BOARD_DEBUG_ARENA=1 manda os 2 primeiros jogadores direto para a arena)
npm run dev:web         # http://localhost:5173
npm test                # testes unitários (shared, física/regras da sinuca, arena, servidor, colisões)
npx tsx apps/server/scripts/smoke.ts          # teste de fumaça do lobby
npx tsx apps/server/scripts/board-smoke.ts    # partida completa do tabuleiro com 2 bots (~2-3 min)
npx tsx apps/server/scripts/pool-smoke.ts     # sinuca com 2 bots (~1 min, tempo real)
npx tsx apps/server/scripts/bot.ts CODIGO [apelido] [acerto] [--game=board|pool]   # bot que entra, vai à estação e joga
```
Ganchos só de desenvolvimento no navegador: `window.__emote`, `__ctl`, `__camDist`, `__lockLook`, `__freeze`, `__freezeAct`, `__tp`.

## Estado atual (feito)
Sinuca Impostor: `packages/shared/src/impostor.ts` (regras puras), `apps/server/src/ImpostorGame.ts`, `apps/web/src/ImpostorHUD.tsx` e a cena da mesa em `PoolScene.tsx` (jogadores ao redor + garrafa). Script de teste: `apps/server/scripts/impostor-smoke.ts` (5 bots).
Modo celular, contorno de desenho em tela cheia e mouse sem travar: ver PRD v1.11.
Sinuca clássica (bola 8): `packages/shared/src/pool.ts` (física/mira), `poolRules.ts` (regras), `apps/server/src/PoolGame.ts`, `apps/web/src/PoolScene.tsx` e `PoolHUD.tsx`.
Salas, chat, lobby 3D (ilha low poly, colisões, lago com ponte), personagem estilo Peak (gestos, corrida, pulo, esquiva-teleporte, golpes), configurações com teclas remapeáveis, inventário de 4 slots (sem itens definidos), HUD enxuto (inventário + chat + Menu), estações com fila e contagem de 10 s, tabuleiro (40 casas, ilha tropical, dado texturizado, 3 desafios, vitória), arena de combate (vida, soco/chute/empurrão, queda; perdedor −1, vencedor +2).

## Decisões-chave do dono
- Estilo visual: diorama low poly; tabuleiro inspirado em Mario Party Superstars (só visual; regras de corrida mantidas).
- Gestos: Tchau, Apontar, Pare, Soco, Dedo do meio, Joinha, Paz, Vem cá (menu na tecla B).
- Golpes só causam dano na arena; no lobby são só animação.
- Menu: só inventário, chat e botão Menu; jogos pelas estações do lobby.

## Pendente / próximos passos
1. Testar com amigos de verdade (publicar: Cloudflare Pages + Render) e ajustar ritmo/equilíbrio.
2. Sinuca: spin, sons, faltas extras e espectadores; versão noturna da cabana para a Impostor.
3. Definir itens do inventário e se a arena usa armas/itens.
4. Cenário noturno da cabana para a Impostor.
5. Publicar (Cloudflare Pages + Render) e testar com amigos; reavaliar cold start.
6. Ajustes finos de equilíbrio da arena (`packages/shared/src/arena.ts`) e dos valores propostos no PRD.
7. Perguntas abertas no PRD: estrelas/moedas/caminhos bifurcados no tabuleiro (mudaria regras; não pedido).

## Observações técnicas
- Um único `<Canvas>` (`GameCanvas.tsx`) troca o conteúdo entre lobby/tabuleiro/arena (evita telas em branco).
- Pontos de atenção: desempenho em PCs fracos (muitos objetos), números das casas não giram com a câmera.

## Estado ao encerrar a sessão (2026-10-17)
- **Os 4 modos do PRD estão implementados:** lobby, tabuleiro (com arena de combate), sinuca clássica e sinuca Impostor. PRD v1.12.
- Verificações no fim: typecheck sem erros, 102 testes unitários, build do front-end, smokes (`smoke.ts`, `board-smoke.ts`, `pool-smoke.ts`, `impostor-smoke.ts`) passando.
- Visual: personagem "chibi" com contorno de desenho em tela cheia (`InkEffect.tsx`) e materiais cel (`toon.ts`); mouse sem travar (arrastar para olhar); modo celular (tela cheia deitada, joystick e botões em `TouchControls.tsx`; teste em janela com `?touch=1`).
- **Não testado em aparelho real:** celular (tela cheia/trava de orientação, toque na sinuca) e a tela do autor da garrafa (Atacar/Poupar) no navegador.
- Servidores de desenvolvimento ficaram rodando no momento do salvamento; para parar: encerrar `npm run dev:server` e `npm run dev:web` (e qualquer `bot.ts`).

### Próximos passos sugeridos
1. Publicar para testar com amigos: front no Cloudflare Pages (`npm run build -w @jogo/web`, variável `VITE_SERVER_URL=wss://...`) e servidor Colyseus no Render free (ver README); avaliar o cold start.
2. Testar no celular de verdade e ajustar controles/desempenho.
3. Definir itens do inventário (hoje 4 slots vazios) e se a arena usa itens/armas.
4. Opcionais: spin e sons na sinuca, versão noturna da cabana, estrelas/moedas no tabuleiro (mudaria regras: perguntar antes).
