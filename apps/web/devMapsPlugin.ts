import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * Armazenamento dos mapas do Modo Dev: arquivos JSON em `<raiz do repositório>/maps/`.
 *
 * Só existe no servidor de desenvolvimento (`vite`): o plugin é registrado apenas com `command === "serve"` e usa
 * `configureServer` (não há `configurePreviewServer`), então `vite build`/`vite preview` e qualquer hospedagem de produção
 * nunca têm estas rotas. Mesmo no dev, recusa conexões que não venham do próprio computador e exige o cabeçalho
 * `x-dev-editor` nas escritas (um site qualquer aberto no navegador não consegue enviá-lo sem ser barrado pelo CORS).
 */

const MAPS_DIR = fileURLToPath(new URL("../../maps", import.meta.url));
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const PREFIX = "/__dev/maps";

const isLoopback = (addr?: string) => addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) { fail(new Error("Mapa grande demais.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

const fileOf = (id: string) => resolve(MAPS_DIR, `${id}.json`);

export function devMapsPlugin(): Plugin {
  return {
    name: "jogo-dev-maps",
    apply: "serve",
    configureServer(server) {
      mkdirSync(MAPS_DIR, { recursive: true });
      server.middlewares.use(PREFIX, async (req, res) => {
        try {
          if (!isLoopback(req.socket.remoteAddress)) return send(res, 403, { error: "Somente local." });
          const id = (req.url ?? "/").split("?")[0]!.replace(/^\//, "");
          const write = req.method === "PUT" || req.method === "DELETE";
          if (write && req.headers["x-dev-editor"] !== "1") return send(res, 403, { error: "Cabeçalho ausente." });

          if (req.method === "GET" && id === "") {
            const list = readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json")).flatMap((f) => {
              try {
                const m = JSON.parse(readFileSync(resolve(MAPS_DIR, f), "utf8")) as { id?: unknown; name?: unknown; kind?: unknown; updatedAt?: unknown; objects?: unknown };
                if (typeof m.id !== "string" || !ID_RE.test(m.id)) return [];
                return [{ id: m.id, name: String(m.name ?? m.id), kind: String(m.kind ?? ""), updatedAt: Number(m.updatedAt) || 0, objects: Array.isArray(m.objects) ? m.objects.length : 0 }];
              } catch { return []; } // arquivo corrompido: some da lista, não derruba o editor
            });
            return send(res, 200, list.sort((a, b) => b.updatedAt - a.updatedAt));
          }
          if (!ID_RE.test(id)) return send(res, 400, { error: "Identificador inválido." });

          if (req.method === "GET") {
            try { return send(res, 200, JSON.parse(readFileSync(fileOf(id), "utf8"))); }
            catch { return send(res, 404, { error: "Mapa não encontrado ou corrompido." }); }
          }
          if (req.method === "PUT") {
            let doc: unknown;
            try { doc = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: e instanceof Error ? e.message : "JSON inválido." }); }
            const d = doc as { id?: unknown; kind?: unknown; objects?: unknown };
            if (typeof doc !== "object" || doc === null || d.id !== id || typeof d.kind !== "string" || !Array.isArray(d.objects)) return send(res, 400, { error: "Documento de mapa inválido." });
            const tmp = `${fileOf(id)}.tmp`;
            writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`); // grava e renomeia: nunca deixa um arquivo pela metade
            renameSync(tmp, fileOf(id));
            return send(res, 200, { ok: true });
          }
          if (req.method === "DELETE") {
            rmSync(fileOf(id), { force: true });
            return send(res, 200, { ok: true });
          }
          return send(res, 405, { error: "Método não permitido." });
        } catch (e) {
          console.error("[dev-maps]", e);
          send(res, 500, { error: "Erro interno ao acessar os mapas." });
        }
      });
    },
  };
}
