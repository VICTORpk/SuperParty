import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  CELL, LEVEL_H, bestBlockPlacement, bestIslandDelta, blockIndex, cellOf, hasSupport, isBlock, islandOf, snapFree, surfaceHeight, typeDef,
  type BlockIndex, type MapDoc, type MapObject,
} from "@jogo/shared";
import { Clouds } from "../scenery";
import { Avatar } from "../Scene";
import { GhostMesh, MapView, freeY, previewColor, type Preview } from "./MapView";
import type { Editor } from "./useEditor";

/** Cena do modo de edição: câmera, grade, encaixe ao soltar/arrastar e movimentação de objetos e ilhas. */

const noAction = () => undefined;
const noEmote = () => undefined;
const still = { current: 0 };

interface GhostState { obj: MapObject; valid: boolean; connected: boolean; error?: string; y: number }

interface Drag {
  id: string;
  kind: "block" | "island" | "free";
  startPt: { x: number; z: number };
  planeY: number;
  moved: boolean;
  /** Ids que andam junto (a ilha inteira, ou o bloco + o que está sobre ele). */
  ids: Set<string>;
  startCell: { ci: number; cj: number };
}

/** Ponto do chão sob o cursor: refina a altura do plano com a superfície do mapa (corrige a perspectiva em blocos altos). */
function pickGround(ray: THREE.Ray, idx: BlockIndex, startY = 0): { x: number; z: number } | null {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const out = new THREE.Vector3();
  let y = startY;
  for (let i = 0; i < 3; i++) {
    plane.constant = -y;
    if (!ray.intersectPlane(plane, out)) return null;
    y = surfaceHeight(idx, out.x, out.z) ?? 0;
  }
  plane.constant = -y;
  return ray.intersectPlane(plane, out) ? { x: out.x, z: out.z } : null;
}

function BotFigure({ x, z, y }: { x: number; z: number; y: number }) {
  return (
    <group position={[x, y, z]}>
      <Avatar color="#64748b" nick="Bot" speed={still} height={still} getEmote={noEmote} getAction={noAction} />
    </group>
  );
}

export function EditorScene({ ed }: { ed: Editor }) {
  const { gl, camera } = useThree();
  const controls = useRef<{ enabled: boolean; target: THREE.Vector3; update: () => void } | null>(null);
  const idx = useMemo(() => blockIndex(ed.map), [ed.map]);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  // Estado lido pelos ouvintes de DOM (estáveis): evita registrar ouvintes de novo a cada alteração do mapa.
  const live = useRef({ ed, idx });
  live.current = { ed, idx };
  const drag = useRef<Drag | null>(null);
  const pick = useRef<string | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const target = useRef<{ x: number; z: number; ok: boolean; level: number; rot: number; di: number; dj: number } | null>(null);

  const rayAt = (clientX: number, clientY: number) => {
    const r = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    return rc.ray;
  };

  /** Onde cairia o tipo armado (ou o objeto arrastado) com o cursor em (clientX, clientY). */
  const placeAt = (clientX: number, clientY: number): GhostState | null => {
    const { ed, idx } = live.current;
    if (!ed.armed) return null;
    const def = typeDef(ed.armed);
    if (!def) return null;
    const p = pickGround(rayAt(clientX, clientY), idx, ed.hint.level * LEVEL_H);
    if (!p) return null;
    if (def.placement === "block") {
      const pl = bestBlockPlacement(ed.map, def.id, p.x, p.z, ed.hint);
      target.current = { x: pl.x, z: pl.z, ok: pl.valid, level: pl.level, rot: pl.rot, di: 0, dj: 0 };
      return { obj: { id: "ghost", type: def.id, x: pl.x, z: pl.z, level: pl.level, rot: pl.rot, props: {} }, valid: pl.valid, connected: pl.connected, error: pl.error, y: 0 };
    }
    const x = snapFree(p.x), z = snapFree(p.z);
    const ok = hasSupport(idx, x, z);
    target.current = { x, z, ok, level: 0, rot: ed.hint.rot, di: 0, dj: 0 };
    return { obj: { id: "ghost", type: def.id, x, z, level: 0, rot: ed.hint.rot, props: {} }, valid: ok, connected: false, error: ok ? undefined : "Coloque este objeto sobre um bloco.", y: surfaceHeight(idx, x, z) ?? 0 };
  };

  const startDrag = (id: string, clientX: number, clientY: number) => {
    const { ed, idx } = live.current;
    const o = ed.map.objects.find((x) => x.id === id);
    if (!o) return;
    const planeY = isBlock(o) ? o.level * LEVEL_H : freeY(idx, o);
    const p = pickGround(rayAt(clientX, clientY), idx, planeY) ?? { x: o.x, z: o.z };
    const ci = cellOf(o.x), cj = cellOf(o.z);
    const carried = (cells: Set<string>) => ed.map.objects.filter((f) => !isBlock(f) && cells.has(`${cellOf(f.x)},${cellOf(f.z)}`)).map((f) => f.id);
    let ids = new Set([id]);
    let kind: Drag["kind"] = isBlock(o) ? "block" : "free";
    if (isBlock(o) && ed.scope === "island") {
      const group = islandOf(ed.map, id) ?? [id];
      const cells = new Set(ed.map.objects.filter((b) => group.includes(b.id)).map((b) => `${cellOf(b.x)},${cellOf(b.z)}`));
      ids = new Set([...group, ...carried(cells)]);
      kind = "island";
    } else if (isBlock(o)) ids = new Set([id, ...carried(new Set([`${ci},${cj}`]))]);
    drag.current = { id, kind, startPt: p, planeY, moved: false, ids, startCell: { ci, cj } };
  };

  const updateDrag = (clientX: number, clientY: number) => {
    const d = drag.current;
    const { ed, idx } = live.current;
    if (!d) return;
    const o = ed.map.objects.find((x) => x.id === d.id);
    if (!o) return;
    const p = pickGround(rayAt(clientX, clientY), idx, d.planeY);
    if (!p) return;
    if (d.kind === "island") {
      const di = cellOf(p.x) - cellOf(d.startPt.x), dj = cellOf(p.z) - cellOf(d.startPt.z);
      const best = bestIslandDelta(ed.map, d.id, di, dj);
      const use = best ?? { di, dj, connected: false };
      target.current = { x: o.x + use.di * CELL, z: o.z + use.dj * CELL, ok: !!best, level: o.level, rot: o.rot, di: use.di, dj: use.dj };
      setPreview({ ids: d.ids, dx: use.di * CELL, dz: use.dj * CELL, valid: !!best, connected: use.connected });
    } else if (d.kind === "block") {
      const pl = bestBlockPlacement(ed.map, o.type, p.x, p.z, { level: o.level, rot: o.rot }, o.id);
      target.current = { x: pl.x, z: pl.z, ok: pl.valid, level: pl.level, rot: pl.rot, di: 0, dj: 0 };
      setPreview({ ids: d.ids, dx: pl.x - o.x, dz: pl.z - o.z, valid: pl.valid, connected: pl.connected });
    } else {
      const x = snapFree(p.x), z = snapFree(p.z);
      const ok = hasSupport(idx, x, z);
      target.current = { x, z, ok, level: 0, rot: o.rot, di: 0, dj: 0 };
      setPreview({ ids: d.ids, dx: x - o.x, dz: z - o.z, valid: ok, connected: false });
    }
    d.moved = true;
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (controls.current) controls.current.enabled = true;
    setPreview(null);
    if (!d || !d.moved) return;
    const t = target.current;
    const { ed } = live.current;
    if (!t) return;
    if (!t.ok) return ed.say("Não encaixa ali: o objeto voltou para onde estava.", "err");
    if (d.kind === "island") ed.islandMove(d.id, t.di, t.dj);
    else ed.move(d.id, t.x, t.z, { level: t.level, rot: t.rot });
  };

  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      down.current = { x: e.clientX, y: e.clientY };
      const id = pick.current;
      pick.current = null;
      if (id && !live.current.ed.armed) { live.current.ed.setSelectedId(id); startDrag(id, e.clientX, e.clientY); }
    };
    const onMove = (e: PointerEvent) => {
      const { ed } = live.current;
      if (drag.current) {
        const d = drag.current;
        if (!d.moved && down.current && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) < 5) return;
        updateDrag(e.clientX, e.clientY);
      } else if (ed.armed && e.target === el) setGhost(placeAt(e.clientX, e.clientY));
      else if (!ed.armed) setGhost(null);
    };
    const onUp = (e: PointerEvent) => {
      const { ed } = live.current;
      const moved = down.current ? Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) : 99;
      const wasDown = down.current;
      down.current = null;
      if (drag.current) {
        endDrag(); // arrastou: confirma a nova posição; só clicou: o objeto já foi selecionado ao apertar
        ed.paletteDrag.current = false;
        return;
      }
      if (e.button !== 0 || e.target !== el) { ed.paletteDrag.current = false; return; }
      const fromPalette = ed.paletteDrag.current;
      ed.paletteDrag.current = false;
      if (ed.armed && (fromPalette || (wasDown && moved < 5))) {
        const g = placeAt(e.clientX, e.clientY);
        if (g?.valid && target.current) {
          const def = typeDef(ed.armed)!;
          const ok = ed.add({ type: ed.armed, x: target.current.x, z: target.current.z, level: target.current.level, rot: target.current.rot });
          if (ok && def.placement === "block") ed.setHint({ level: target.current.level, rot: target.current.rot });
          if (ok && fromPalette && !e.shiftKey) ed.setArmed(null); // soltar um bloco arrastado da paleta: uma peça por arrasto
        } else if (g) ed.say(g.error ?? "Não é possível colocar aqui.", "err");
        setGhost(null);
      } else if (!ed.armed && wasDown && moved < 5 && !pick.current) ed.setSelectedId(null); // clique no vazio
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  useEffect(() => { if (!ed.armed) setGhost(null); }, [ed.armed]);

  // enquadra o mapa ao abrir/trocar de mapa
  const lastMapId = useRef("");
  useFrame(() => {
    const c = controls.current;
    if (!c || lastMapId.current === ed.map.id) return;
    lastMapId.current = ed.map.id;
    const blocks = ed.map.objects.filter(isBlock);
    let cx = 0, cz = 0, r = 6;
    if (blocks.length) {
      const xs = blocks.map((b) => b.x), zs = blocks.map((b) => b.z);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2; cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      r = Math.max(8, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.8);
    }
    c.target.set(cx, 0, cz);
    camera.position.set(cx + r * 0.9, r * 1.1, cz + r * 1.3);
    c.update();
  });

  const onPick = useMemo(() => (ed.armed ? undefined : (id: string) => { pick.current = id; if (controls.current) controls.current.enabled = false; }), [ed.armed]);
  // reabilita a câmera se o clique não virou arrasto (o ouvinte de DOM cuida do resto)
  useEffect(() => {
    const up = () => { if (controls.current && !drag.current) controls.current.enabled = true; };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  return (
    <>
      <color attach="background" args={["#bfe3f7"]} />
      <hemisphereLight args={["#ffffff", "#8ac56a", 1.1]} />
      <directionalLight position={[20, 40, 15]} intensity={1.3} color="#fff6e0" />
      <OrbitControls ref={controls as never} makeDefault enableDamping={false} maxPolarAngle={Math.PI * 0.49} minDistance={4} maxDistance={140} />
      <gridHelper args={[CELL * 50, 50, "#7aa6c2", "#a7c8de"]} position={[CELL / 2, -1.02, CELL / 2]} />
      <Clouds count={6} radius={90} height={[30, 46]} seed={4} />

      <MapView map={ed.map} selectedId={ed.selectedId} highlightIds={ed.islandIds} preview={preview} showConnections={ed.showConnections} onPick={onPick} />

      {ghost && (
        <group position={[ghost.obj.x, isBlock(ghost.obj) ? 0 : ghost.y, ghost.obj.z]} rotation-y={isBlock(ghost.obj) ? 0 : ghost.obj.rot * (Math.PI / 4)}>
          <GhostMesh o={ghost.obj} color={previewColor(ghost)} />
        </group>
      )}

      {ed.bots.map((b) => <BotFigure key={b.id} x={b.x} z={b.z} y={surfaceHeight(idx, b.x, b.z) ?? 0} />)}
    </>
  );
}

export type { MapDoc };
