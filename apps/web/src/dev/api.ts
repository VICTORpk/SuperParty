import { parseMap, type MapDoc, type MapKind } from "@jogo/shared";

/** Cliente das rotas `/__dev/maps` (plugin do Vite, só no servidor de desenvolvimento). */

export interface MapMeta { id: string; name: string; kind: MapKind; updatedAt: number; objects: number }

const BASE = "/__dev/maps";
const WRITE = { "content-type": "application/json", "x-dev-editor": "1" };

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(body.error ?? `Erro ${res.status} ao acessar os mapas.`);
  return body;
}

export async function listMaps(): Promise<MapMeta[]> {
  return json<MapMeta[]>(await fetch(BASE, { cache: "no-store" }));
}

/** Carrega e valida um mapa; dados inválidos viram erro/aviso, nunca exceção não tratada no editor. */
export async function loadMap(id: string): Promise<{ map: MapDoc; warnings: string[] }> {
  const raw = await json<unknown>(await fetch(`${BASE}/${id}`, { cache: "no-store" }));
  const parsed = parseMap(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return { map: parsed.map, warnings: parsed.warnings };
}

export async function saveMap(map: MapDoc): Promise<void> {
  await json(await fetch(`${BASE}/${map.id}`, { method: "PUT", headers: WRITE, body: JSON.stringify(map) }));
}

export async function deleteMap(id: string): Promise<void> {
  await json(await fetch(`${BASE}/${id}`, { method: "DELETE", headers: WRITE }));
}
