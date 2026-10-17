import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getGradient } from "./toon";

/** Kit de cenário em estilo "low poly" (faces planas, ilhas em camadas, pinheiros, pedras, mesas do deserto, água facetada). */

/** Gerador pseudoaleatório determinístico (mesmo cenário para todos os jogadores). */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const PALETTE = {
  grass: ["#7bbf4a", "#6aae3f", "#8cd04e"],
  dirt: "#d9a05b",
  sand: "#e8c777",
  clay: "#8b5e3c",
  deep: "#4d3425",
  water: "#2fb5c9",
  pine: ["#6fb33f", "#8cd04e", "#5aa33a"],
  rock: ["#9a8f86", "#b09a8a", "#8a7f78"],
  mesa: ["#d97b3a", "#c96a2c", "#e59a55", "#b85a25"],
  desert: "#e2b061",
  wood: "#8a5a35",
  woodLight: "#a8743f",
  snow: "#f1f5f9",
} as const;

/** O MeshToonMaterial aceita flatShading em tempo de execução, mas os tipos não declaram. */
const FLAT = { flatShading: true } as Record<string, unknown>;

export function Flat({ color, opacity, emissive }: { color: string; opacity?: number; emissive?: string }) {
  return (
    <meshToonMaterial color={color} gradientMap={getGradient()} {...FLAT}
      transparent={opacity !== undefined} opacity={opacity ?? 1} emissive={emissive ?? "#000"} emissiveIntensity={emissive ? 0.4 : 0} />
  );
}

/** Pinheiro de camadas (cones achatados com poucas faces). */
export function Pine({ position = [0, 0, 0], scale = 1, color = PALETTE.pine[0], tiers = 4 }:
  { position?: [number, number, number]; scale?: number; color?: string; tiers?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.35, 0]}><cylinderGeometry args={[0.14, 0.2, 0.7, 5]} /><Flat color={PALETTE.clay} /></mesh>
      {Array.from({ length: tiers }, (_, i) => (
        <mesh key={i} position={[0, 0.9 + i * 0.55, 0]} rotation-y={i * 0.6}>
          <coneGeometry args={[1.05 - i * 0.2, 0.9, 6]} /><Flat color={color} />
        </mesh>
      ))}
    </group>
  );
}

export function Rock({ position = [0, 0, 0], scale = 1, color = PALETTE.rock[0], seed = 1 }:
  { position?: [number, number, number]; scale?: number; color?: string; seed?: number }) {
  const r = seeded(seed);
  return (
    <mesh position={position} scale={[scale * (0.8 + r() * 0.6), scale * (0.6 + r() * 0.5), scale * (0.8 + r() * 0.6)]} rotation={[r(), r() * 6, r()]}>
      <icosahedronGeometry args={[0.6, 0]} /><Flat color={color} />
    </mesh>
  );
}

export function Cactus({ position = [0, 0, 0], scale = 1 }: { position?: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.7, 0]}><capsuleGeometry args={[0.22, 1, 3, 6]} /><Flat color="#4f9d4f" /></mesh>
      <mesh position={[0.4, 0.8, 0]}><capsuleGeometry args={[0.13, 0.4, 3, 6]} /><Flat color="#4f9d4f" /></mesh>
      <mesh position={[0.33, 0.55, 0]} rotation-z={Math.PI / 2}><capsuleGeometry args={[0.1, 0.2, 3, 6]} /><Flat color="#4f9d4f" /></mesh>
    </group>
  );
}

/** Mesa do deserto: cilindros empilhados com anéis de cores de rocha sedimentar. */
export function Mesa({ position = [0, 0, 0], radius = 2.5, height = 5, seed = 1 }:
  { position?: [number, number, number]; radius?: number; height?: number; seed?: number }) {
  const r = seeded(seed);
  const steps = 4 + Math.floor(r() * 3);
  let y = 0;
  const parts = Array.from({ length: steps }, (_, i) => {
    const h = (height / steps) * (0.7 + r() * 0.6);
    const rad = radius * (1 - (i / steps) * 0.35) * (0.85 + r() * 0.3);
    const part = { y: y + h / 2, h, rad, color: PALETTE.mesa[i % PALETTE.mesa.length]!, rot: r() * 3 };
    y += h;
    return part;
  });
  return (
    <group position={position}>
      {parts.map((p, i) => (
        <mesh key={i} position={[0, p.y, 0]} rotation-y={p.rot}>
          <cylinderGeometry args={[p.rad * 0.92, p.rad, p.h, 7]} /><Flat color={p.color} />
        </mesh>
      ))}
    </group>
  );
}

/** Casinha de madeira com telhado em pirâmide. */
export function Hut({ position = [0, 0, 0], scale = 1, rotation = 0 }: { position?: [number, number, number]; scale?: number; rotation?: number }) {
  return (
    <group position={position} scale={scale} rotation-y={rotation}>
      <mesh position={[0, 0.9, 0]}><boxGeometry args={[2.6, 1.8, 2.2]} /><Flat color="#e9c98f" /></mesh>
      <mesh position={[0, 2.35, 0]} rotation-y={Math.PI / 4}><coneGeometry args={[2.4, 1.5, 4]} /><Flat color="#9c4f35" /></mesh>
      <mesh position={[0, 0.65, 1.12]}><boxGeometry args={[0.6, 1.2, 0.08]} /><Flat color={PALETTE.wood} /></mesh>
      {[-0.85, 0.85].map((x) => <mesh key={x} position={[x, 1.1, 1.12]}><boxGeometry args={[0.5, 0.5, 0.08]} /><Flat color="#5fb4e8" /></mesh>)}
      <mesh position={[0.8, 2.9, -0.2]}><boxGeometry args={[0.4, 0.9, 0.4]} /><Flat color="#a8a29e" /></mesh>
    </group>
  );
}

/** Ponte de tábuas de madeira ao longo do eixo X local. */
export function Bridge({ position = [0, 0, 0], length = 6, rotation = 0, width = 1.7 }: { position?: [number, number, number]; length?: number; rotation?: number; width?: number }) {
  const planks = Math.round(length / 0.55);
  return (
    <group position={position} rotation-y={rotation}>
      {Array.from({ length: planks }, (_, i) => (
        <mesh key={i} position={[(i - (planks - 1) / 2) * 0.55, 0, 0]} rotation-y={(i % 3 - 1) * 0.04}>
          <boxGeometry args={[0.46, 0.14, width]} /><Flat color={i % 2 ? PALETTE.wood : PALETTE.woodLight} />
        </mesh>
      ))}
      {[-width / 2, width / 2].map((z) => (
        <mesh key={z} position={[0, 0.45, z]}><boxGeometry args={[length, 0.1, 0.1]} /><Flat color={PALETTE.wood} /></mesh>
      ))}
      {[-1, 1].flatMap((sx) => [-width / 2, width / 2].map((z) => (
        <mesh key={`${sx}${z}`} position={[sx * (length / 2 - 0.1), 0.25, z]}><boxGeometry args={[0.12, 0.6, 0.12]} /><Flat color={PALETTE.wood} /></mesh>
      )))}
    </group>
  );
}

/** Ilha flutuante em camadas (grama/areia no topo, terra, argila e rocha escura) com base pontiaguda. */
export function Island({ radius, scaleZ = 1, top = PALETTE.grass[0], layers = [PALETTE.dirt, PALETTE.sand, PALETTE.clay, PALETTE.deep], underside = true }:
  { radius: number; scaleZ?: number; top?: string; layers?: string[]; underside?: boolean }) {
  const layerH = 0.5;
  return (
    <group scale={[1, 1, scaleZ]}>
      <mesh position={[0, -0.25, 0]}><cylinderGeometry args={[radius, radius * 0.97, 0.5, 14]} /><Flat color={top} /></mesh>
      {layers.map((c, i) => (
        <mesh key={i} position={[0, -0.5 - layerH * (i + 0.5), 0]} rotation-y={i * 0.25}>
          <cylinderGeometry args={[radius * (0.97 - i * 0.025), radius * (0.94 - i * 0.03), layerH, 14]} /><Flat color={c} />
        </mesh>
      ))}
      {underside && (
        <mesh position={[0, -0.5 - layerH * layers.length - radius * 0.45, 0]} rotation-x={Math.PI}>
          <coneGeometry args={[radius * 0.86, radius * 0.9, 9]} /><Flat color={PALETTE.deep} />
        </mesh>
      )}
    </group>
  );
}

/** Água de baixa contagem de polígonos: plano com vértices levemente deslocados e sombreamento facetado. */
export function FacetedWater({ width, depth, position = [0, 0, 0], color = PALETTE.water, segments = 22, opacity = 0.92, round = false }:
  { width: number; depth: number; position?: [number, number, number]; color?: string; segments?: number; opacity?: number; round?: boolean }) {
  const geo = useMemo(() => {
    const g = round ? new THREE.CircleGeometry(width / 2, 14) : new THREE.PlaneGeometry(width, depth, segments, segments);
    const r = seeded(7);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, (r() - 0.5) * 0.16);
    g.computeVertexNormals();
    return g;
  }, [width, depth, segments, round]);
  return (
    <mesh geometry={geo} position={position} rotation-x={-Math.PI / 2}>
      <meshStandardMaterial color={color} flatShading roughness={0.35} metalness={0.1} transparent opacity={opacity} />
    </mesh>
  );
}

/** Nuvens de baixa contagem de polígonos que derivam devagar. */
export function Clouds({ count = 8, radius = 55, height = [14, 26] as [number, number], seed = 3 }: { count?: number; radius?: number; height?: [number, number]; seed?: number }) {
  const group = useRef<THREE.Group>(null);
  const clouds = useMemo(() => {
    const r = seeded(seed);
    return Array.from({ length: count }, () => ({
      a: r() * Math.PI * 2, d: radius * (0.7 + r() * 0.5), y: height[0] + r() * (height[1] - height[0]), s: 2 + r() * 2.5,
    }));
  }, [count, radius, height, seed]);
  useFrame((_, dt) => { if (group.current) group.current.rotation.y += dt * 0.01; });
  return (
    <group ref={group}>
      {clouds.map((c, i) => (
        <group key={i} position={[Math.cos(c.a) * c.d, c.y, Math.sin(c.a) * c.d]} scale={c.s}>
          {[[0, 0, 0, 1], [1, -0.1, 0.2, 0.75], [-1, -0.15, -0.1, 0.8], [0.4, 0.4, 0, 0.7]].map(([x, y, z, k], j) => (
            <mesh key={j} position={[x!, y!, z!]} scale={k}><icosahedronGeometry args={[0.9, 0]} /><meshStandardMaterial color="#fff" flatShading roughness={1} /></mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Espalha elementos em um anel (determinístico). */
export function ringPoints(count: number, rMin: number, rMax: number, seed: number, zScale = 1) {
  const r = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.4;
    const d = rMin + r() * (rMax - rMin);
    return { x: Math.cos(a) * d, z: Math.sin(a) * d * zScale, k: r(), seed: i + seed * 17 };
  });
}

/** Palmeira curvada com folhas e cocos. */
export function Palm({ position = [0, 0, 0], scale = 1, lean = 0.25, rotation = 0 }:
  { position?: [number, number, number]; scale?: number; lean?: number; rotation?: number }) {
  const segs = 5;
  const top = { x: 0, y: 0 };
  const trunk = Array.from({ length: segs }, (_, i) => {
    const x = lean * i * i * 0.16;
    const y = 0.4 + i * 0.72;
    top.x = x; top.y = y + 0.4;
    return { x, y, rz: -lean * i * 0.17, r: 0.2 - i * 0.02 };
  });
  return (
    <group position={position} scale={scale} rotation-y={rotation}>
      {trunk.map((t, i) => (
        <mesh key={i} position={[t.x, t.y, 0]} rotation-z={t.rz}><cylinderGeometry args={[t.r * 0.85, t.r, 0.78, 6]} /><Flat color={i % 2 ? "#a8743f" : "#8a5a35"} /></mesh>
      ))}
      <group position={[top.x, top.y, 0]}>
        {Array.from({ length: 7 }, (_, i) => (
          <group key={i} rotation-y={(i / 7) * Math.PI * 2}>
            <mesh position={[0.95, -0.1, 0]} rotation-z={-0.45} scale={[1, 1, 1]}><boxGeometry args={[1.9, 0.06, 0.55]} /><Flat color={i % 2 ? "#3fae3a" : "#58c24a"} /></mesh>
          </group>
        ))}
        {[[0.2, -0.25, 0.1], [-0.15, -0.28, -0.1], [0.05, -0.3, -0.2]].map(([x, y, z], i) => (
          <mesh key={i} position={[x!, y!, z!]}><icosahedronGeometry args={[0.16, 0]} /><Flat color="#6b4328" /></mesh>
        ))}
      </group>
    </group>
  );
}

/** Flor gigante decorativa. */
export function GiantFlower({ position = [0, 0, 0], scale = 1, color = "#ff6fa5" }: { position?: [number, number, number]; scale?: number; color?: string }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1, 0]}><cylinderGeometry args={[0.1, 0.14, 2, 5]} /><Flat color="#3fae3a" /></mesh>
      <mesh position={[0.5, 0.8, 0]} rotation-z={-0.6}><boxGeometry args={[0.9, 0.05, 0.4]} /><Flat color="#58c24a" /></mesh>
      <group position={[0, 2.05, 0]} rotation-x={0.2}>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i} position={[Math.cos((i / 6) * 6.283) * 0.55, 0, Math.sin((i / 6) * 6.283) * 0.55]} rotation-y={-(i / 6) * 6.283} scale={[0.9, 0.22, 0.5]}>
            <icosahedronGeometry args={[0.55, 0]} /><Flat color={color} />
          </mesh>
        ))}
        <mesh position={[0, 0.08, 0]}><icosahedronGeometry args={[0.32, 0]} /><Flat color="#ffd54a" /></mesh>
      </group>
    </group>
  );
}

/** Estrela dourada giratória (portal de chegada). */
export function GoldStar({ position = [0, 0, 0], scale = 1 }: { position?: [number, number, number]; scale?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 1 : 0.46;
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 });
  }, []);
  useFrame((s) => {
    if (!ref.current) return;
    ref.current.rotation.y = s.clock.elapsedTime * 1.4;
    ref.current.position.y = Math.sin(s.clock.elapsedTime * 2) * 0.15;
  });
  return (
    <group position={position} scale={scale}>
      <mesh ref={ref} geometry={geo} position={[0, 0, -0.17]}>
        <meshStandardMaterial color="#ffd23f" emissive="#ffb300" emissiveIntensity={0.55} flatShading roughness={0.4} />
      </mesh>
    </group>
  );
}
