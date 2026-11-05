import type { Usage } from "./llm";

export interface HistoryMsg {
  author: "client" | "ai" | "human" | "system";
  kind: string;
  /** Texto del mensaje o, si es un audio, su transcripción. */
  text: string | null;
  at: string;
}

export interface Rule { topic: string; description: string; handoff_phrase: string }
export interface BusinessInfo { key: string; title: string; body: string }

/** Ficha que ve el modelo. Sale de properties_public (lista blanca); nunca lleva dirección. */
export interface PropertyFact {
  codigo: string;
  operacion: "venta" | "alquiler" | null;
  tipo: string | null;
  titulo: string | null;
  zona: string | null;
  precio: string | null;
  expensas: string | null;
  ambientes: number | null;
  dormitorios: number | null;
  banos: number | null;
  superficie_total_m2: number | null;
  superficie_cubierta_m2: number | null;
  mascotas: "sí" | "no" | "sin dato";
  caracteristicas: string[];
  link: string | null;
  descripcion: string | null;
}

export interface TurnInput {
  /** Últimos mensajes del chat, del más viejo al más nuevo. */
  history: HistoryMsg[];
  /** Operación del canal (ventas → sale). */
  channelOperation: "sale" | "rent";
  rules: Rule[];
  businessInfo: BusinessInfo[];
  /** Fichas que el bot ya mostró en este chat (para "¿y la casa de antes?"). */
  recentlyShown: PropertyFact[];
}

export interface TraceEntry { event: string; summary: string; details?: Record<string, unknown> }

export type Decision =
  | { action: "reply"; body: string; propertyCodes: string[]; trace: TraceEntry[]; usage: Usage }
  | { action: "handoff"; body: string | null; reason: string; propertyCodes: string[]; trace: TraceEntry[]; usage: Usage }
  | { action: "ignore"; reason: string; trace: TraceEntry[]; usage: Usage };
