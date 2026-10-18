import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { isTouchDevice } from "./platform";

/** Marca o <html> com o tipo de tela para o CSS (toque, compacta, em pé). `?touch=1` força o modo toque (testes). */
function updateEnv() {
  const forced = new URLSearchParams(location.search).get("touch") === "1";
  const touch = forced || isTouchDevice();
  const el = document.documentElement;
  el.toggleAttribute("data-touch", touch);
  el.toggleAttribute("data-compact", touch || window.innerHeight < 520);
  el.toggleAttribute("data-portrait", window.innerHeight > window.innerWidth);
}
updateEnv();
window.addEventListener("resize", updateEnv);
window.addEventListener("orientationchange", updateEnv);

const root = createRoot(document.getElementById("root")!);

// Modo Dev: o editor só existe no servidor de desenvolvimento. Em `vite build` o valor de `import.meta.env.DEV` é
// falso, o bloco inteiro (e o módulo do editor, carregado por import dinâmico) é descartado do pacote final e a rota
// /dev cai no jogo normal. `VITE_DEV_MODE=0` desliga o editor mesmo no desenvolvimento.
if (import.meta.env.DEV && import.meta.env.VITE_DEV_MODE !== "0" && location.pathname.startsWith("/dev")) {
  void import("./dev/DevApp").then(({ default: DevApp }) => root.render(<DevApp />));
} else {
  root.render(<App />);
}
