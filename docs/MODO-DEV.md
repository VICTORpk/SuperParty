# Modo Dev: editor de mapas, ilhas e minijogos

Ferramenta **só de desenvolvimento local** para montar mapas arrastando e soltando blocos, testar executando o mapa e
adicionar bots. Nada disto existe no build de produção.

## Como usar
```bash
npm run dev:server   # servidor com DEV_MODE=1 (bots de teste habilitados)
npm run dev:web      # http://localhost:5173
```
- **Editor:** abra `http://localhost:5173/dev` (também há links na tela inicial e no menu do jogo, no modo dev).
- **Bots no jogo:** dentro de uma sala, Menu → "🛠 Modo Dev" → ＋ Adicionar bot / － Remover bot (até 6). Os bots andam até
  você e acenam; entram na fila do jogo junto com você e, em partida, o servidor joga por eles (como jogador ausente).
- **Mapas** ficam em `maps/*.json` (versionáveis no git). Abrir o editor continua do mapa editado mais recentemente.

## Segurança: por que não existe em produção
| Camada | Garantia |
|---|---|
| Front-end | `main.tsx` só importa o editor se `import.meta.env.DEV` for verdadeiro. No `vite build` esse valor é `false`: o bloco e o módulo do editor são removidos do pacote (verificado: nenhum texto do editor aparece em `apps/web/dist`). A rota `/dev` cai no jogo normal. |
| Armazenamento | As rotas `/__dev/maps` são um plugin do Vite (`apps/web/devMapsPlugin.ts`) registrado só com `command === "serve"` e só em `configureServer`; `vite preview` e hospedagens estáticas não as têm (devolvem a página do jogo / 404). No dev ainda recusa conexões que não sejam do próprio computador, valida o id (`^[a-z0-9-]{1,48}$`, sem `..`), limita o tamanho (2 MB), grava de forma atômica e exige o cabeçalho `x-dev-editor` nas escritas. |
| Servidor de jogo | Os comandos `dev-add-bot`/`dev-remove-bot` só são registrados se `DEV_MODE=1` **e** `NODE_ENV !== "production"` (`apps/server/src/dev.ts`). O `npm run start -w @jogo/server` (Render) não define `DEV_MODE`. |
| Desligar | `VITE_DEV_MODE=0` esconde o editor mesmo no dev; sem `DEV_MODE=1` o servidor ignora os bots. O jogo normal não muda. |

## Como o editor funciona
- **Blocos** (grama, areia, neve, pedra, rampa) ocupam uma célula da grade (4×4) e **encaixam nas laterais** dos vizinhos.
  Regras (`packages/shared/src/maps/grid.ts`): blocos planos só se ligam no **mesmo nível**; a rampa só se liga pelas **pontas**
  (pé no nível N, topo no nível N+1), nunca pelas laterais. Uma colocação incompatível é **recusada** (ghost vermelho, nada muda).
  A rampa gira sozinha para encaixar. Ghost verde = encaixa, azul = fica solta (nova ilha), vermelho = inválido.
- **Conexões e ilhas não são gravadas**: derivam da vizinhança na grade; por isso nunca ficam inconsistentes com as posições.
  Ilha = conjunto de blocos conectados. "Ilha inteira" (Arrastar) move a ilha toda com o cenário em cima; "🔗 Conectar ilha"
  leva a ilha ao encaixe mais próximo; "✂ Desconectar bloco" tira um bloco da ilha.
- **Objetos livres** (árvores, casas do tabuleiro, tee, buraco, paredes…) só ficam sobre blocos e acompanham o bloco quando ele se move.
- **Desfazer/refazer** guarda documentos inteiros imutáveis (Ctrl+Z / Ctrl+Shift+Z). Toda operação inválida devolve um erro e não altera o mapa.
- **Salvar** (Ctrl+S) grava `maps/<id>.json`; "● não salvo" aparece na barra e a aba avisa antes de fechar. **Duplicar mapa** cria uma
  cópia com id novo (o original não muda). Excluir remove o arquivo.
- **Executar** (P): minigolfe = bola com física (Espaço segura/solta para bater no sentido da câmera, R reinicia, penalidade ao sair do mapa);
  ilhas/tabuleiro = personagem andando (WASD, Shift, Espaço). Bots da sessão e objetos 🤖 do mapa vêm até você. A execução nunca altera o mapa.

## Formato do mapa (`version: 1`)
```json
{ "version": 1, "id": "meu-mapa-ab12", "name": "Meu mapa", "kind": "islands|board|minigolf",
  "createdAt": 0, "updatedAt": 0,
  "objects": [ { "id": "o1", "type": "grass", "x": 0, "z": 0, "level": 0, "rot": 0, "props": {} } ] }
```
Blocos: `x`,`z` = centro da célula (múltiplos de 4), `level` 0–3, `rot` em passos de 45° (rampas: 0/2/4/6). Ao carregar,
`parseMap` nunca confia no arquivo: descarta objetos inválidos (avisando), corrige limites e migra versões antigas
(`MIGRATIONS` em `ops.ts`); arquivos de versão futura são recusados com mensagem.
Limites: 600 objetos, coordenadas ±200, 6 bots no editor.

## Como estender
- **Novo objeto:** uma entrada em `OBJECT_TYPES` (`packages/shared/src/maps/registry.ts`: tipo, ícone, categoria, em quais mapas aparece,
  propriedades) + um `case` no desenho (`apps/web/src/dev/MapView.tsx`). A paleta e o inspetor aparecem sozinhos.
- **Novo tipo de mapa:** acrescente em `MAP_KINDS` e `MAP_KIND_DEFS` (descrição + verificações). O editor não muda.
- **Novo minijogo/regra de execução:** crie um componente como `Playtest.tsx` que leia o `MapDoc`; a física pura de golfe está em
  `packages/shared/src/maps/golf.ts` e o comportamento dos bots em `packages/shared/src/botBrain.ts` (os mesmos usados no servidor).

## Limitações desta primeira versão
- Os mapas do editor ainda **não alimentam** o tabuleiro/lobby do jogo multiplayer: servem para criar e testar (execução local).
  Ligar um mapa a uma partida online é o próximo passo natural (o formato já tem o necessário).
- Minigolfe: bola, rampas (inclinação), paredes, pinos e buraco; sem placar por jogador nem várias bolas.
- Os bots do servidor são do lobby; nas partidas jogam como "ausentes" (rolam o dado/passam a vez), não com estratégia.
