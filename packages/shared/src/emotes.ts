export const EMOTES = [
  { id: "wave", label: "Tchau", icon: "👋", duration: 2.4 },
  { id: "point", label: "Apontar", icon: "👉", duration: 2.2 },
  { id: "stop", label: "Pare", icon: "✋", duration: 2.2 },
  { id: "punch", label: "Soco", icon: "👊", duration: 1.8 },
  { id: "middle", label: "Dedo do meio", icon: "🖕", duration: 2.2 },
  { id: "thumbs", label: "Joinha", icon: "👍", duration: 2.2 },
  { id: "peace", label: "Paz", icon: "✌️", duration: 2.2 },
  { id: "come", label: "Vem cá", icon: "🤙", duration: 2.4 },
] as const;

export type EmoteId = (typeof EMOTES)[number]["id"];

export function isEmote(value: unknown): value is EmoteId {
  return typeof value === "string" && EMOTES.some((e) => e.id === value);
}

export function emoteDuration(id: EmoteId): number {
  return EMOTES.find((e) => e.id === id)!.duration;
}
