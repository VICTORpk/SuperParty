import { Suspense, lazy } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, SMAA } from "@react-three/postprocessing";
import { Ink } from "./InkEffect";
import { isTouchDevice } from "./platform";
import type { SceneProps } from "./Scene";
import type { BoardSceneProps } from "./BoardScene";
import type { ArenaSceneProps } from "./ArenaScene";
import type { PoolSceneProps } from "./PoolScene";

const LobbyContent = lazy(() => import("./Scene").then((m) => ({ default: m.LobbyContent })));
const BoardContent = lazy(() => import("./BoardScene").then((m) => ({ default: m.BoardContent })));
const ArenaContent = lazy(() => import("./ArenaScene").then((m) => ({ default: m.ArenaContent })));
const PoolContent = lazy(() => import("./PoolScene").then((m) => ({ default: m.PoolContent })));

export type GameMode = "lobby" | "board" | "arena" | "pool";

/**
 * Um único canvas 3D para o jogo todo: ao trocar entre lobby, tabuleiro e arena só o conteúdo muda.
 * (Criar e destruir canvas a cada fase causava telas em branco e recarregava o WebGL.)
 */
const touch = isTouchDevice();

export default function GameCanvas({ mode, lobby, board, arena, pool }: { mode: GameMode; lobby: SceneProps; board: BoardSceneProps | null; arena: ArenaSceneProps; pool: PoolSceneProps }) {
  return (
    <Canvas camera={{ fov: 70, near: 0.05, far: 400, position: [0, 6, 12] }} dpr={touch ? [1, 1.25] : [1, 1.5]} style={{ touchAction: "none" }}>
      <EffectComposer multisampling={touch ? 0 : 4} enableNormalPass={false}>
        <Ink thickness={1.5} threshold={0.05} />
        {touch ? <></> : <SMAA />}
      </EffectComposer>
      <Suspense fallback={null}>
        {mode === "arena" ? <ArenaContent {...arena} /> : mode === "pool" ? <PoolContent {...pool} /> : mode === "board" && board ? <BoardContent {...board} /> : <LobbyContent {...lobby} />}
      </Suspense>
    </Canvas>
  );
}
