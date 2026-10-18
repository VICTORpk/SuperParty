import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { devMapsPlugin } from "./devMapsPlugin";

// O armazenamento de mapas do Modo Dev só é registrado no servidor de desenvolvimento (`vite`), nunca no build.
export default defineConfig(({ command }) => ({
  plugins: [react(), ...(command === "serve" ? [devMapsPlugin()] : [])],
  server: { port: 5173 },
}));
