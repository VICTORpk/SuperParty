/** Histórico de desfazer/refazer: guarda documentos inteiros (imutáveis), então voltar nunca corrompe o mapa. */
export interface History<T> { past: T[]; present: T; future: T[] }

export const newHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function commit<T>(h: History<T>, next: T, limit = 100): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past.slice(-(limit - 1)), h.present], present: next, future: [] };
}
export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  return prev === undefined ? h : { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}
export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  return next === undefined ? h : { past: [...h.past, h.present], present: next, future: rest };
}
