# PRD — Jogo Social Multiplayer 3D

**Versão:** 1.1
**Estado:** Decisões pendentes da v1.0 resolvidas; pronto para desenvolvimento
**Plataforma:** Web (desktop) · **Idioma:** Português (Brasil) · **Capacidade:** 2 a 10 jogadores por sala
**Restrição de projeto:** usar somente ferramentas e serviços gratuitos.

> Esta versão registra as decisões aprovadas sobre a v1.0. Seções sem alteração mantêm o texto de intenção da v1.0
> (jogo social 3D no navegador, salas privadas por código, lobby, chat, tabuleiro, sinuca clássica, sinuca Impostor,
> cartas como expansão futura). Fora do escopo: voz, progressão permanente, economia, loja, campanha single-player, apps nativos.

## 1. Pilares
Socialização · Acessibilidade (entrada por código) · Variedade de minijogos · Competição casual · Humor visual cartunesco (sem violência realista) · Escopo controlado (MVP primeiro).

## 2. Decisões de arquitetura (aprovadas)

| Tema | Decisão |
|---|---|
| Front-end | **Vite + React + TypeScript + React Three Fiber**, estático no **Cloudflare Pages** (substitui o Next.js da v1.0) |
| Servidor | **Colyseus** (Node + WebSocket), autoritativo, hospedado no **Render free** (migrar para Oracle Always Free se o cold start incomodar) |
| Persistência | **Nenhuma.** Estado em memória do servidor; sem banco, sem login. Supabase removido |
| Identidade | Apelido + cor do avatar; token de reconexão no `localStorage` |
| Repositório | Monorepo (npm workspaces): `apps/web`, `apps/server`, `packages/shared` (regras puras usadas por cliente e servidor) |
| Assets | Modelos CC0 (Kenney, Quaternius, Poly Pizza) e avatares procedurais simples |
| Plataformas | Somente desktop: Chrome, Edge e Firefox atuais. Celular é expansão |
| Testes | Vitest em regras puras e servidor autoritativo; 3D/UI testados manualmente com várias abas |
| Física da sinuca | Motor 2D próprio, **rodando no servidor**; cliente apenas anima o resultado |

Regras de código: lógica de jogo, rede, renderização 3D e UI separadas; resultados competitivos e segredos só no servidor;
segredos enviados por mensagem privada ao cliente certo; toda entrada do cliente é não confiável.

## 3. Salas
- Código único por sala; limite de 10 jogadores; erros claros (código inexistente, sala cheia, partida em andamento).
- O criador é o anfitrião (rótulo no menu; o início dos jogos **não** depende dele). Se ele sair/cair por mais de 60 s, o jogador mais antigo assume.
- **Minijogos nas estações do lobby:** cada jogo tem uma estação física. Ao chegar perto aparece o botão **Jogar** (ou a tecla E). A fila mostra `n/mínimo`; quando atinge o mínimo de jogadores do jogo começa uma **contagem de 10 s** (cancelada se a fila cair abaixo do mínimo; quem se afasta da estação sai da fila). Mínimos: Tabuleiro 2 (até 10), Sinuca 2, Sinuca Impostor 4 (até 10). Só uma partida por vez na sala; quem não está na partida continua no lobby e novos jogadores podem entrar.
- **Reconexão:** 60 s de tolerância com token. Depois, o jogador fica "ausente" e é pulado até voltar. Se o Impostor sair, o papel permanece com ele.
- **Sala vazia** é destruída após 10 minutos. Sem moderação além de "silenciar" (local, por jogador).

## 4. Lobby 3D
- Avatares sincronizados: cliente envia posição/direção a ~10 Hz; servidor valida velocidade máxima e limites; clientes interpolam.
- Controles: WASD + mouse; tecla **V** alterna primeira/terceira pessoa (escolha individual). Sem pulo e sem colisão entre jogadores no MVP.
- Retorno ao lobby ao fim de cada partida.

- **Personagem:** estilo "escoteiro" cartunesco (pele na cor do jogador, cabeça grande, olhos pretos com brilho, chapéu por cor). **Estilo visual (v1.10/v1.11, a partir de uma referência de cavaleiro "chibi"):** proporção com cabeça bem maior que o corpo, corpo e membros curtos e arredondados, **contorno escuro feito em tela cheia (efeito de pós-processamento por profundidade) e sombreado de desenho em poucos tons aplicados a todo o jogo**, e sombra suave no chão. Só o estilo foi adotado; as roupas continuam as do escoteiro. Em terceira pessoa a câmera é livre e o corpo só vira ao andar; em primeira pessoa as mãos ficam visíveis.
- **Movimento e gestos:** correr com Shift (configurável); **correr + esquerda/direita/trás = esquiva** (teleporte curto de 4,5 unidades, recarga de 0,9 s, com efeito de "transmissão instantânea"; validada no servidor). **Pular** com Espaço (configurável; efeito visual, o servidor só limita a altura a 2,2 u). Menu de gestos na tecla **B** (configurável): Tchau, Apontar, Pare, Soco, Dedo do meio, Joinha, Paz, Vem cá. Os gestos aparecem para todos os jogadores, em 1ª e 3ª pessoa.
- **Configurações:** todas as teclas (movimento, correr, gestos, câmera, chat, slots) podem ser remapeadas e a sensibilidade do mouse ajustada; ficam salvas no navegador.
- **Interface enxuta:** na tela ficam só o **inventário**, o **chat** e um **botão Menu** (Tab). O menu reúne código da sala, jogadores, câmera, gestos, configurações e controles. Os jogos são acessados pelas estações do lobby.
- **Colisões:** pinheiros, pedras, casinha e mesas das estações são sólidos; o lago só se atravessa pela ponte. Escala dos objetos compatível com os personagens (porta da casinha mais alta que eles).
- **Golpes:** soco (J ou botão esquerdo do mouse), chute (K ou botão direito) e empurrão (F), configuráveis. **No lobby os golpes são só animação: ninguém sofre dano.** Na arena causam dano e empurram.
- **Inventário:** 4 slots na parte inferior da tela (teclas 1–4 ou clique; repetir a tecla desmarca). **Os itens ainda não estão definidos** (pendente): os slots começam vazios.

### Interface e plataformas
- **Desktop:** o mouse não é travado; arraste (botão esquerdo ou direito) para girar a câmera. O cursor fica livre para o menu, o chat e o inventário.
- **Celular (v1.11):** ao criar/entrar numa sala o jogo pede tela cheia e orientação **deitada** (Android/Chrome); onde isso não é permitido (ex.: iPhone) aparece um aviso para girar o aparelho. Controles: joystick à esquerda (empurrar até o fim = correr), botões à direita (pular, soco, chute, empurrão, esquiva, gestos), um dedo no mundo gira a câmera; chat atrás de um botão 💬. Sinuca: arraste na mesa para mirar e use a barra de força lateral. Não testado em aparelho real (só em janela com `?touch=1`).

### Direção de arte dos cenários (v1.6)
Estilo "diorama low poly": ilhas flutuantes em camadas (grama/areia, terra, argila, rocha escura), faces planas, água turquesa facetada, pinheiros e pedras simples, mesas do deserto, pontes de madeira, casinhas e nuvens. Referências: imagens de ilhas de hexágonos, ilha nevada, cânion com ponte, casa na ilha e vila no deserto.

| Cenário | Tema | Estado |
|---|---|---|
| Lobby | Ilha de grama com lago, ponte de madeira, casinha, pinheiros e ilhotas ao redor | **feito** |
| Tabuleiro | **Estilo "tabuleiro de festa" (inspirado em Mario Party Superstars):** ilha tropical colorida com trilha sinuosa de casas redondas (azul = normal, verde com "!" = desafio, vermelha = início, dourada com estrela = chegada), colinas, praia, lagoa, vulcão com fumaça, palmeiras, flores gigantes, portal de partida e portal de chegada com estrela; bloco de dado flutuando sobre a cabeça de quem joga; câmera que acompanha a peça | **feito** |
| Arena de batalha | Plataforma redonda de madeira com postes e corda sobre o mar turquesa, ilhotas com palmeiras ao fundo | **feito** |
| Sinuca clássica | Cabana de madeira com iluminação quente, janela para o mar e a mesa no centro | **feito** |
| Sinuca Impostor | Mesma cabana, jogadores ao redor da mesa e garrafa girando (a versão noturna com luz roxa ficou como ideia futura) | **feito (versão diurna)** |

O kit de cenário (pinheiro, pedra, cacto, mesa, casinha, ponte, ilha em camadas, água facetada, nuvens) fica em `apps/web/src/scenery.tsx` para ser reutilizado.

## 5. Chat
200 caracteres, 1 mensagem/segundo (rate limit no servidor), texto sempre escapado, sem filtro de palavrões no MVP,
balão sobre o avatar por 5 s. Chat de voz fora do escopo (usar Discord etc.).

## 6. Tabuleiro
- Turnos definidos pelo servidor; dado rolado no servidor; percurso de ~40 casas.
- **Vitória:** o primeiro a alcançar a casa final vence; se o dado ultrapassar, para nela e vence (sem número exato).
- **Casa normal:** nada acontece. **Casa de desafio:** desafio de ~10 s, visível a todos.
  - Sucesso: permanece na casa e avança mais 2.
  - **Falha: avança apenas 1 casa** (valor configurável em arquivo de regras).
- **Desafios no MVP (3):** barra de força, sequência de cores, clicar rápido. Pontuação calculada no servidor a partir das entradas/tempos; o cliente nunca envia "venci".
- **Dado:** o dado (com pontos nas faces) gira sobre a cabeça de quem joga e **a peça só anda depois que ele para** (o servidor aguarda 1,7 s entre o sorteio e o movimento).
- **Encontro na mesma casa → arena de combate** (plataforma de madeira sobre o mar). A batalha **substitui** o desafio da casa naquele turno.
  - Regras da luta (servidor autoritativo): 100 de vida cada; movimento, corrida, pulo e esquiva; **soco** (8 de dano), **chute** (12 de dano, lança para cima) e **empurrão** (3 de dano, grande empurrão); golpes atordoam e empurram. Perde quem **zerar a vida** ou **cair da plataforma**.
  - Resultado: **o perdedor volta 1 casa e o vencedor avança 2** (valores em `BOARD_RULES`).
  - Limite de 90 s (proposta minha): vence quem tiver mais vida; empate sorteia. Quem sai da sala no meio da luta perde.

**Implementação da Fase 3 (valores propostos, ajustáveis em `packages/shared/src/board.ts`):**
- Percurso de 40 casas em "S" (8 colunas × 5 linhas); casas de desafio: 3, 7, 10, 14, 18, 21, 25, 29, 33, 36. Casa 0 = início, casa 39 = final.
- O anfitrião inicia o tabuleiro a partir do lobby (mínimo 2 jogadores). Ninguém novo entra com a partida em andamento. A ordem dos turnos é sorteada pelo servidor.
- Tempo para rolar o dado: 20 s (depois disso o servidor rola); jogador ausente joga sozinho após 2,5 s. Se restar menos de 2 jogadores a partida é cancelada.
- Desafios (sorteados pelo servidor, todos assistem ao vivo): **barra de força** (parar o cursor na zona verde, 7 s), **sequência de cores** (memorizar 4 cores e repetir, 9 s) e **cliques rápidos** (20 cliques em 5 s; o servidor conta os cliques, no máximo 14 por segundo).
- Após o desafio: sucesso = +2 casas; falha ou tempo esgotado = +1 casa (`BOARD_RULES.failAdvance`). O movimento de bônus/penalidade **não** dispara novos efeitos (só a vitória); o encontro só vale para o movimento do dado.
- Chegar à casa final (ou ultrapassá-la) vence. Ao fim, volta ao lobby em 30 s ou quando o anfitrião pedir.
- **Arena (Fase 3b): implementada.** Valores de dano, alcance, empurrão, tempo e tamanho da plataforma ficam em `packages/shared/src/arena.ts`.

## 7. Sinuca clássica
Bola 8 americana (lisas × listradas), **2 jogadores**, acessada pela estação do lobby (fila de 2, contagem de 10 s). Os demais jogadores continuam no lobby. Física 2D simulada no servidor.

**Controles (decidido):** o mouse mira (guia de mira com a bola-fantasma no primeiro contato); **segure o clique e arraste para baixo** para dar força (o taco recua e uma barra mostra a porcentagem); **soltar dá a tacada**; Esc ou botão direito cancela. Com **bola na mão**, clique na mesa para posicionar a bola branca.

**Regras implementadas** (`packages/shared/src/poolRules.ts`, puras e testadas):
- Triângulo com 15 bolas (a 8 no centro; um canto de cada grupo); o servidor sorteia quem quebra. Quebra sem regras especiais; a bola 8 que cair na quebra volta à mesa; a quebra não define os grupos.
- Os grupos são definidos pela primeira bola encaçapada numa tacada legal depois da quebra.
- Continua jogando quem encaçapa uma bola do próprio grupo (ou qualquer bola com a mesa aberta); caso contrário passa a vez.
- **Falta** (só as duas do PRD): bola branca encaçapada ou tacada em que a branca não toca em nenhuma bola → **bola na mão para o adversário**. Tocar primeiro numa bola do adversário **não** é falta (simplificação).
- **Bola 8:** vence quem a encaçapa depois de limpar o próprio grupo e sem falta; encaçapá-la antes da hora, com falta ou com a branca perde.
- Tempo: 45 s para tacar e 30 s para posicionar; esgotado, passa a vez com bola na mão (ou o servidor posiciona a branca). Jogador ausente age em 3 s; quem sai da partida perde.

**Física (valores propostos, em `pool.ts`):** mesa 12 × 6 unidades, bola de raio 0,15, 6 caçapas generosas, atrito linear + arrasto, colisões elásticas entre bolas (restituição 0,95) e com as tabelas (0,72), **sem efeito (spin)**. O servidor simula a tacada inteira em passos de 1/240 s e envia a **gravação** (quadros a ~30 Hz + eventos) que os clientes reproduzem; o resultado é sempre o do servidor.

**Cenário:** cabana de madeira (paredes e piso de tábuas, tapete, janela com vista para o mar, arandelas e uma luz quente sobre a mesa), câmera elevada que se ajusta à proporção da tela, os dois jogadores ao lado da mesa.

**Pendente:** efeito de rotação (spin) na bola branca, sons, quem fica assistindo (outros jogadores), faltas adicionais (primeiro contato errado) se você quiser regras mais fiéis.

## 8. Sinuca Impostor
Acessada pela estação do lobby (mínimo **4**, máximo 10 jogadores; fila com contagem de 10 s). Reaproveita a mesa e a física da sinuca clássica (todos os jogadores sentados ao redor da mesa).

**Regras (decididas):**
- Um **Impostor** é sorteado no servidor; **só ele recebe o papel**, por mensagem privada. Os inocentes não recebem nada (sabem apenas que não são o Impostor). O estado público nunca traz a identidade antes do fim, e a identidade só é revelada na **eliminação** (do eliminado) ou **no fim da partida** (de todos).
- **Turnos:** rodízio entre os jogadores ativos, **20 s por tacada** (estourou, a vez passa).
- **Tacada válida:** a branca toca em alguma bola, encaçapa ao menos uma bola que não seja a branca e a branca não cai. Com falta, não há garrafa e a vez passa.
- **Garrafa:** depois de uma tacada válida a garrafa gira sobre a mesa (3,8 s) e sorteia, no servidor, um jogador **ativo** entre os demais (o **autor nunca é sorteado**). O autor decide **atacar** ou **poupar** (10 s; sem resposta, poupa). Poupar não tem penalidade e é visível a todos.
- **Acertos:** 1º e 2º acertos mantêm o jogador; o **3º elimina**. O eliminado vira espectador, tem o papel (Impostor ou inocente) revelado a todos e pode jogar a próxima partida.
- **Vitória:** os **inocentes** vencem se o Impostor for eliminado; o **Impostor** vence quando restam **2 jogadores ativos**.
- **Chat:** os eliminados têm um canal próprio e leem o chat dos vivos; os vivos não veem o chat dos eliminados.

**Complementos que defini (ajustáveis):**
- A branca que cai volta à posição inicial (sem "bola na mão" neste modo); todas as bolas valem igual (sem regra especial da bola 8); mesa limpa = novo triângulo.
- Quem sai da partida: se for o Impostor, os inocentes vencem; se for inocente, conta como eliminado (sem revelar o papel) e o jogo segue.
- Constantes em `packages/shared/src/impostor.ts` (`IMPOSTOR_RULES`); lógica no servidor em `apps/server/src/ImpostorGame.ts`.

**Apresentação:** a garrafa de vidro gira flutuando no centro da mesa e para apontando para o alvo; o ataque é uma animação de soco no alvo; uma faixa no topo mostra cada jogador com seus acertos (🥊), quem está na vez e o papel dos eliminados; uma faixa avisa o seu próprio papel.

## 9. Jogo de cartas
Expansão futura; sem regras definidas. Não iniciar sem nova decisão.

## 10. Requisitos funcionais
RF-01 Criar sala · RF-02 Entrar por código · RF-03 Limite de 10 · RF-04 Jogadores conectados · RF-05 Chat · RF-06 Lobby 3D ·
RF-07 Câmera 1ª/3ª pessoa · RF-08 Tabuleiro por turnos · RF-09 Dado e movimento · RF-10 Casas de desafio · RF-11 Sinuca clássica ·
RF-12 Papéis secretos · RF-13 Garrafa, acertos e eliminações · RF-14 Espectador · RF-15 Cartas (futura).

## 11. Requisitos não funcionais
Desempenho em computadores modestos, assets leves · estados coerentes, eventos idempotentes · resultados validados no servidor,
papéis nunca enviados a quem não deve · mensagens de erro acionáveis e regras explicadas na primeira utilização.

## 12. Fases
1. **Fundação + salas + chat** (monorepo, servidor Colyseus, criar/entrar por código, presença, chat). *Critério:* vários jogadores na mesma sala trocando mensagens.
2. **Lobby 3D** (ambiente, avatares, movimento, sincronização, câmera). *Marco 1: validar com amigos.*
3. **Tabuleiro** completo. 4. **Sinuca clássica.** 5. **Sinuca Impostor.** 6. Testes e refinamento (desconexão, carga, segurança). 7. Expansões (cartas etc.).

## 13. Critérios de aceitação do MVP
Sala privada com máx. 10 · sincronização de participantes · chat · lobby 3D e troca de câmera · tabuleiro com turnos e desafios nas regras acima ·
sinuca clássica concluível · Impostor exige 4+ jogadores, protege o papel, garrafa/acertos/eliminação/revelação/vitória conforme seção 8 ·
todos os resultados competitivos validados no servidor.

## 14. Pendências remanescentes (não bloqueiam a Fase 1)
- Hospedagem definitiva do servidor (Render × Oracle) após medir o cold start.
- Lista final de desafios além dos 3 do MVP; layout exato do tabuleiro e da arena.
- Domínio personalizado (opcional).
- Quer elementos de "party game" além da corrida (estrelas, moedas, loja, casas de evento, caminhos bifurcados)? Isso mudaria as regras do tabuleiro; não foi pedido.
- Ajustes finos da arena (equilíbrio de dano, tamanho, objetos como luvas/espadas de espuma) e se vale armas/itens do inventário.
- Valores de corrida (9 u/s), esquiva (4,5 u, 0,9 s) e a lista de gestos são propostas minhas e podem ser ajustados.
- Definir quais itens existem, como são obtidos/usados e se o inventário é sincronizado com o servidor.

## 15. Diretrizes para assistentes de código
Ler este PRD antes de implementar; não inventar regras fora das decisões aprovadas (perguntar); manter regras de cada minijogo isoladas;
separar lógica, rede, renderização e UI; validar no servidor; não vazar segredos; implementar uma funcionalidade pequena e testável por vez;
atualizar este PRD quando uma decisão mudar.

## 16. Registro de mudanças
- **1.12** — Sinuca Impostor: fila (mín. 4), papel secreto, rodízio, garrafa, acertos/eliminação, vitórias, chat dos eliminados, mesa com jogadores ao redor.
- **1.11** — Mouse sem travar o cursor (arrastar para olhar); contorno de desenho em tela cheia para todo o jogo (personagem, cenários, mesa) e materiais de desenho (cel) em todo o cenário; membros do personagem contínuos (sem linhas entre as partes); escala dos objetos revisada em relação ao personagem; **modo celular**: entra em tela cheia e deitada ao entrar na sala (aviso para girar onde o navegador não permite travar), controles de toque (joystick, pular, golpes, esquiva, gestos, arrastar para olhar), sinuca por toque (arrastar para mirar + barra de força), HUD compacto, menos custo gráfico.
- **1.10** — Personagem com estilo "chibi" (cabeça maior, corpo menor, contorno e sombreado de desenho, sombra no chão). Correção: o contorno nunca aparecia porque a espessura é em pixels.
- **1.9** — Sinuca clássica (bola 8): física 2D no servidor, regras, controles por mouse (mirar, arrastar para dar força), cabana 3D, estação ativa no lobby.
- **1.8** — Fila de jogos nas estações com contagem de 10 s; arena de combate (vida, socos, chutes, empurrões, queda); perdedor −1 e vencedor +2; dado com textura e peça só anda quando ele para; HUD enxuto (inventário, chat, menu); colisões no lobby; golpes sem dano no lobby; escala dos objetos; animação de pulo corrigida; um único canvas 3D.
- **1.7** — Tabuleiro refeito no estilo "tabuleiro de festa": ilha tropical, trilha sinuosa, bloco de dado, câmera que segue a peça. As regras da corrida não mudaram.
- **1.6** — Direção de arte "diorama low poly" aplicada ao lobby e ao tabuleiro; kit de cenário reutilizável.
- **1.5** — Fase 3: tabuleiro completo (servidor autoritativo, dado, turnos, 3 desafios, vitória, volta ao lobby); arena provisória.
- **1.4** — Pulo; correção da orientação das palmas nos gestos; mãos em 1ª pessoa ajustadas à proporção da tela.
- **1.3** — Correr, esquiva (teleporte), gestos com as mãos, menu de gestos (B) e painel de configurações com teclas remapeáveis.
- **1.2** — Personagem estilo Peak, câmera livre, mãos em primeira pessoa e inventário de 4 slots (sem itens definidos).
- **1.1** — Decisões da rodada de definição: Vite em vez de Next.js; Colyseus em vez de Supabase Realtime; sem banco; regras de tabuleiro, sinuca e Impostor fechadas;
  gerenciador de pacotes: npm workspaces (pnpm não está instalado no ambiente de desenvolvimento).
