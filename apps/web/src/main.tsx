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

createRoot(document.getElementById("root")!).render(<App />);
