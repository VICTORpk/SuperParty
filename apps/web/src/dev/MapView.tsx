import { memo, useMemo } from "react";
import * as THREE from "three";
import {
  CELL, LEVEL_H, blockIndex, cellOf, connections, isBlock, isRamp, rampDir, surfaceHeight, typeDef,
  type BlockIndex, type MapDoc, type MapObject,
} from "@jogo/shared";
import { Flat, GoldStar, Palm, Pine, Rock } from "../scenery";

/** Desenho de um `MapDoc` (editor e execução). Só lê o documento; não tem estado nem regras. */

const DIRT = "#a9794a";
const RAMP_ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI]; // por direção: rampa sobe para +z, +x, −z, −x

export interface Preview {
  /** Objetos que estão sendo arrastados: são desenhados deslocados e translúcidos. */
  ids: ReadonlySet<string>;
  dx: number;
  dz: number;
  valid: boolean;
  connected: boolean;
}

export const previewColor = (p: Pick<Preview, "valid" | "connected">) => (!p.valid ? "#ef4444" : p.connected ? "#22c55e" : "#3b82f6");

const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

// ---------------------------------------------------------------- blocos
const rampGeoCache = new Map<number, THREE.BufferGeometry>();
/** Cunha da rampa no nível `level`: sobe para +x local (a rotação aponta para o lado certo). */
function rampGeometry(level: number): THREE.BufferGeometry {
  let g = rampGeoCache.get(level);
  if (!g) {
    const h = CELL / 2;
    const shape = new THREE.Shape([new THREE.Vector2(-h, -1), new THREE.Vector2(h, -1), new THREE.Vector2(h, (level + 1) * LEVEL_H), new THREE.Vector2(-h, level * LEVEL_H)]);
    g = new THREE.ExtrudeGeometry(shape, { depth: CELL, bevelEnabled: false });
    g.translate(0, 0, -CELL / 2);
    rampGeoCache.set(level, g);
  }
  return g;
}

function BlockShape({ o, color, opacity, emissive }: { o: MapObject; color: string; opacity?: number; emissive?: string }) {
  if (isRamp(o)) {
    return <mesh geometry={rampGeometry(o.level)} rotation-y={RAMP_ANGLE[rampDir(o)]}><Flat color={color} opacity={opacity} emissive={emissive} /></mesh>;
  }
  const top = o.level * LEVEL_H;
  return (
    <>
      <mesh position={[0, (top - 1) / 2 - 0.12, 0]}><boxGeometry args={[CELL * 0.99, top + 1 - 0.24, CELL * 0.99]} /><Flat color={opacity === undefined ? DIRT : color} opacity={opacity} /></mesh>
      <mesh position={[0, top - 0.12, 0]}><boxGeometry args={[CELL, 0.24, CELL]} /><Flat color={color} opacity={opacity} emissive={emissive} /></mesh>
    </>
  );
}

// ---------------------------------------------------------------- objetos livres
function FreeVisual({ o }: { o: MapObject }) {
  const def = typeDef(o.type)!;
  const kind = String(o.props.tileKind ?? "normal");
  switch (o.type) {
    case "pine": return <Pine scale={0.9} color={def.color} />;
    case "palm": return <Palm scale={0.7} rotation={hash(o.id) % 6} />;
    case "rock": return <Rock scale={0.7} seed={hash(o.id) % 50 + 1} />;
    case "flower": return (
      <group>
        <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.03, 0.04, 0.6, 5]} /><Flat color="#3fae3a" /></mesh>
        <mesh position={[0, 0.7, 0]}><icosahedronGeometry args={[0.24, 0]} /><Flat color={["#ffd54a", "#ff8fa3", "#ffffff", "#c084fc"][hash(o.id) % 4]!} /></mesh>
      </group>
    );
    case "spawn": return (
      <group>
        <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.05, 0.05, 1.8, 6]} /><Flat color="#e5e7eb" /></mesh>
        <mesh position={[0.4, 1.55, 0]}><boxGeometry args={[0.8, 0.5, 0.05]} /><Flat color="#ef4444" /></mesh>
        <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[0.7, 0.7, 0.06, 16]} /><Flat color="#fca5a5" /></mesh>
      </group>
    );
    case "bot-spawn": return (
      <group>
        <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[0.6, 0.6, 0.06, 16]} /><Flat color="#94a3b8" /></mesh>
        <mesh position={[0, 0.6, 0]}><boxGeometry args={[0.55, 0.7, 0.4]} /><Flat color="#64748b" /></mesh>
        <mesh position={[0, 1.15, 0]}><boxGeometry args={[0.45, 0.35, 0.4]} /><Flat color="#cbd5e1" /></mesh>
      </group>
    );
    case "tile": return (
      <group>
        <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[1.25, 1.3, 0.2, 20]} /><Flat color="#f4efe2" /></mesh>
        <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[1.1, 1.1, 0.06, 20]} /><Flat color={{ normal: "#3d8bff", desafio: "#43c75b", vermelha: "#e11d2e", atalho: "#a855f7" }[kind] ?? "#3d8bff"} /></mesh>
      </group>
    );
    case "start": return (
      <group>
        <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[1.35, 1.4, 0.2, 20]} /><Flat color="#f4efe2" /></mesh>
        <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[1.15, 1.15, 0.06, 20]} /><Flat color="#ff5a5f" /></mesh>
        {[-1.2, 1.2].map((x) => <mesh key={x} position={[x, 1.3, 0]}><cylinderGeometry args={[0.1, 0.12, 2.6, 6]} /><Flat color="#8a5a35" /></mesh>)}
        <mesh position={[0, 2.5, 0]}><boxGeometry args={[2.8, 0.45, 0.12]} /><Flat color="#ff5a5f" /></mesh>
      </group>
    );
    case "finish": return (
      <group>
        <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[1.35, 1.4, 0.2, 20]} /><Flat color="#f4efe2" /></mesh>
        <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[1.15, 1.15, 0.06, 20]} /><Flat color="#ffd23f" /></mesh>
        <GoldStar position={[0, 2.2, 0]} scale={0.8} />
      </group>
    );
    case "tee": return (
      <group>
        <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[0.7, 0.7, 0.1, 16]} /><Flat color="#22c55e" /></mesh>
        <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.03, 0.05, 0.25, 6]} /><Flat color="#f8fafc" /></mesh>
      </group>
    );
    case "hole": return (
      <group>
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[0.5, 20]} /><meshBasicMaterial color="#05070a" /></mesh>
        <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.03, 0.03, 1.8, 6]} /><Flat color="#f8fafc" /></mesh>
        <mesh position={[0.3, 1.55, 0]}><boxGeometry args={[0.6, 0.35, 0.04]} /><Flat color="#facc15" /></mesh>
      </group>
    );
    case "wall": return <mesh position={[0, Number(o.props.height ?? 0.8) / 2, 0]}><boxGeometry args={[Number(o.props.length ?? 3), Number(o.props.height ?? 0.8), 0.3]} /><Flat color={def.color} /></mesh>;
    case "bumper": return (
      <group>
        <mesh position={[0, 0.35, 0]}><cylinderGeometry args={[Number(o.props.radius ?? 0.6), Number(o.props.radius ?? 0.6), 0.7, 14]} /><Flat color="#e11d48" /></mesh>
        <mesh position={[0, 0.72, 0]}><cylinderGeometry args={[Number(o.props.radius ?? 0.6) * 0.6, Number(o.props.radius ?? 0.6) * 0.6, 0.06, 14]} /><Flat color="#fff" /></mesh>
      </group>
    );
    default: return <mesh position={[0, 0.4, 0]}><boxGeometry args={[0.8, 0.8, 0.8]} /><Flat color={def.color} /></mesh>;
  }
}

/** Marcador translúcido (arrastar/soltar): caixa da célula para blocos, cilindro para objetos livres. */
export function GhostMesh({ o, color }: { o: MapObject; color: string }) {
  return isBlock(o)
    ? <BlockShape o={o} color={color} opacity={0.55} />
    : <group><mesh position={[0, 0.6, 0]}><cylinderGeometry args={[0.55, 0.55, 1.2, 12]} /><Flat color={color} opacity={0.55} /></mesh></group>;
}

// ---------------------------------------------------------------- objeto
interface ObjProps {
  o: MapObject;
  y: number;
  selected: boolean;
  /** Parte da ilha do selecionado (contorno azul-claro). */
  island?: boolean;
  ghost?: { color: string; dx: number; dz: number };
  onPick?: (id: string, e: { clientX: number; clientY: number; shiftKey: boolean }) => void;
}

const ObjectMesh = memo(function ObjectMesh({ o, y, selected, island, ghost, onPick }: ObjProps) {
  const block = isBlock(o);
  const px = o.x + (ghost?.dx ?? 0), pz = o.z + (ghost?.dz ?? 0);
  const def = typeDef(o.type)!;
  return (
    <group position={[px, block ? 0 : y, pz]} rotation-y={block ? 0 : o.rot * (Math.PI / 4)}
      onPointerDown={onPick && !ghost ? (e) => { e.stopPropagation(); onPick(o.id, e.nativeEvent); } : undefined}>
      {ghost ? <GhostMesh o={o} color={ghost.color} /> : block ? <BlockShape o={o} color={def.color} emissive={undefined} /> : <FreeVisual o={o} />}
      {(selected || island) && !ghost && <Selection o={o} color={selected ? "#facc15" : "#38bdf8"} />}
    </group>
  );
});

function Selection({ o, color }: { o: MapObject; color: string }) {
  const block = isBlock(o);
  const geo = useMemo(() => {
    const top = o.level * LEVEL_H + (isRamp(o) ? LEVEL_H : 0);
    const box = new THREE.BoxGeometry(CELL * 1.02, top + 1.2, CELL * 1.02);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return { edges, y: (top - 1) / 2 + 0.1 };
  }, [o.level, o.type, o.rot]);
  return block
    ? <lineSegments geometry={geo.edges} position={[0, geo.y, 0]}><lineBasicMaterial color={color} /></lineSegments>
    : <mesh position={[0, 0.06, 0]} rotation-x={-Math.PI / 2}><ringGeometry args={[0.9, 1.1, 24]} /><meshBasicMaterial color={color} side={THREE.DoubleSide} /></mesh>;
}

// ---------------------------------------------------------------- mapa
export interface MapViewProps {
  map: MapDoc;
  selectedId?: string | null;
  /** Blocos da ilha do selecionado (realçados). */
  highlightIds?: ReadonlySet<string>;
  preview?: Preview | null;
  showConnections?: boolean;
  onPick?: ObjProps["onPick"];
}

export function MapView({ map, selectedId, highlightIds, preview, showConnections, onPick }: MapViewProps) {
  const idx = useMemo(() => blockIndex(map), [map]);
  const conns = useMemo(() => (showConnections ? connections(map) : []), [map, showConnections]);
  const byId = useMemo(() => new Map(map.objects.map((o) => [o.id, o])), [map]);
  return (
    <group>
      {map.objects.map((o) => {
        const dragged = preview?.ids.has(o.id);
        return (
          <ObjectMesh key={o.id} o={o} y={freeY(idx, o)} selected={o.id === selectedId} island={!!highlightIds?.has(o.id) && o.id !== selectedId}
            ghost={dragged && preview ? { color: previewColor(preview), dx: preview.dx, dz: preview.dz } : undefined} onPick={onPick} />
        );
      })}
      {conns.map((c) => {
        const a = byId.get(c.a), b = byId.get(c.b);
        if (!a || !b) return null;
        const y = Math.max(a.level, b.level) * LEVEL_H + 0.2;
        const horizontal = a.z === b.z; // vizinhos em x → a costura é perpendicular a x
        return (
          <mesh key={`${c.a}-${c.b}`} position={[(a.x + b.x) / 2, y, (a.z + b.z) / 2]} rotation-y={horizontal ? 0 : Math.PI / 2}>
            <boxGeometry args={[0.35, 0.12, CELL * 0.45]} /><meshBasicMaterial color="#f472b6" />
          </mesh>
        );
      })}
    </group>
  );
}

/** Altura em que um objeto livre fica (sobre a superfície do bloco). */
export function freeY(idx: BlockIndex, o: MapObject): number {
  return isBlock(o) ? 0 : (surfaceHeight(idx, o.x, o.z) ?? 0);
}

export { cellOf };
