export type Action =
  | "forward" | "back" | "left" | "right" | "run" | "jump"
  | "emotes" | "camera" | "chat" | "interact" | "punch" | "kick" | "shove"
  | "slot1" | "slot2" | "slot3" | "slot4";

export type Bindings = Record<Action, string>;

export interface Settings {
  bindings: Bindings;
  sensitivity: number;
}

export const ACTIONS: { id: Action; label: string }[] = [
  { id: "forward", label: "Andar para frente" },
  { id: "back", label: "Andar para trás" },
  { id: "left", label: "Andar para a esquerda" },
  { id: "right", label: "Andar para a direita" },
  { id: "run", label: "Correr (+ direção = esquiva)" },
  { id: "jump", label: "Pular" },
  { id: "punch", label: "Soco" },
  { id: "kick", label: "Chute" },
  { id: "shove", label: "Empurrão" },
  { id: "interact", label: "Interagir (jogar na estação)" },
  { id: "emotes", label: "Menu de gestos" },
  { id: "camera", label: "Trocar câmera" },
  { id: "chat", label: "Abrir o chat" },
  { id: "slot1", label: "Inventário: slot 1" },
  { id: "slot2", label: "Inventário: slot 2" },
  { id: "slot3", label: "Inventário: slot 3" },
  { id: "slot4", label: "Inventário: slot 4" },
];

export const DEFAULT_BINDINGS: Bindings = {
  forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD",
  run: "ShiftLeft", jump: "Space", punch: "KeyJ", kick: "KeyK", shove: "KeyF", interact: "KeyE", emotes: "KeyB", camera: "KeyV", chat: "Enter",
  slot1: "Digit1", slot2: "Digit2", slot3: "Digit3", slot4: "Digit4",
};

export const DEFAULT_SETTINGS: Settings = { bindings: DEFAULT_BINDINGS, sensitivity: 1 };

/** Teclas que não podem ser atribuídas (Esc sempre fecha menus e libera o mouse). */
export const RESERVED = new Set(["Escape"]);

const STORAGE_KEY = "jogo:settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const bindings = { ...DEFAULT_BINDINGS };
    for (const a of ACTIONS) {
      const v = parsed.bindings?.[a.id];
      if (typeof v === "string" && v && !RESERVED.has(v)) bindings[a.id] = v;
    }
    const sens = typeof parsed.sensitivity === "number" && Number.isFinite(parsed.sensitivity) ? parsed.sensitivity : 1;
    return { bindings, sensitivity: Math.min(3, Math.max(0.3, sens)) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* storage indisponível */ }
}

/** Teclas modificadoras valem para o lado esquerdo e o direito. */
export function isDown(keys: Set<string>, code: string): boolean {
  if (keys.has(code)) return true;
  const m = /^(Shift|Control|Alt)(Left|Right)$/.exec(code);
  return !!m && (keys.has(`${m[1]}Left`) || keys.has(`${m[1]}Right`));
}

export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  const names: Record<string, string> = {
    ShiftLeft: "Shift (esq.)", ShiftRight: "Shift (dir.)", ControlLeft: "Ctrl (esq.)", ControlRight: "Ctrl (dir.)",
    AltLeft: "Alt (esq.)", AltRight: "Alt (dir.)", Space: "Espaço", Enter: "Enter", Tab: "Tab", Backspace: "Backspace",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", CapsLock: "Caps Lock",
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'",
    Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
  };
  return names[code] ?? code;
}
