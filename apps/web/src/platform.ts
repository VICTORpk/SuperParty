/** Utilidades de plataforma: detecção de toque, tela cheia e orientação deitada (celular). */

export const isTouchDevice = (): boolean =>
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).get("touch") === "1" || window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window);

/**
 * Entra em tela cheia e trava a orientação deitada. Precisa ser chamado dentro de um gesto do usuário
 * (por exemplo, no clique de "Criar sala"/"Entrar"). Onde o navegador não permite (ex.: iPhone), o jogo
 * mostra um aviso pedindo para deitar o aparelho.
 */
export async function enterLandscape(): Promise<void> {
  if (!isTouchDevice()) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
  } catch { /* tela cheia indisponível */ }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
  } catch { /* o navegador não permite travar a orientação */ }
}

export function leaveLandscape() {
  if (!isTouchDevice()) return;
  try { (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.(); } catch { /* ignore */ }
  try { if (document.fullscreenElement) void document.exitFullscreen?.(); } catch { /* ignore */ }
}

/** Estado dos controles de toque, lido pelo jogo a cada quadro. */
export interface TouchState {
  /** Joystick: -1..1 (y negativo = para frente). */
  moveX: number;
  moveY: number;
  jump: boolean;
  /** Golpe pedido (consumido pelo jogo). */
  attack: "punch" | "kick" | "shove" | null;
  /** Esquiva pedida (consumida pelo jogo). */
  dodge: boolean;
}

export const newTouchState = (): TouchState => ({ moveX: 0, moveY: 0, jump: false, attack: null, dodge: false });
