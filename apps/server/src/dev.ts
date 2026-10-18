/**
 * Ferramentas de desenvolvimento do servidor (bots de teste). Ficam desligadas por padrão e **nunca** ligam
 * com NODE_ENV=production, mesmo que DEV_MODE esteja definido. O script `npm run dev:server` define DEV_MODE=1;
 * `npm run start -w @jogo/server` (produção/Render) não define.
 */
export function isDevEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEV_MODE === "1" && env.NODE_ENV !== "production";
}
