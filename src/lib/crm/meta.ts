/**
 * Eventos que Pulse manda a Meta (Conversions API para WhatsApp). Meta sólo acepta estos
 * nombres cuando el evento viene de una conversación de WhatsApp; «Lead» o eventos propios
 * los rechaza.
 */
export const META_EVENTS = {
  LeadSubmitted: "Nuevo prospecto",
  ViewContent: "Vio información o material",
  QualifiedLead: "Prospecto calificado",
  InitiateCheckout: "Pidió cotización",
  AddToCart: "Apartó o reservó",
  Purchase: "Compró (venta cerrada)",
} as const;
export type MetaEventName = keyof typeof META_EVENTS;
export const META_EVENT_NAMES = Object.keys(META_EVENTS) as MetaEventName[];
export const isMetaEvent = (v: unknown): v is MetaEventName =>
  typeof v === "string" && v in META_EVENTS;

/** Momentos del pipeline que pueden avisar a Meta: lead nuevo, P1–P6 y P7 ganado. */
export const STAGE_EVENT_KEYS = ["nuevo", "1", "2", "3", "4", "5", "6", "ganado"] as const;
export type StageEventKey = (typeof STAGE_EVENT_KEYS)[number];
export type StageEvents = Partial<Record<StageEventKey, MetaEventName>>;

/** Lo que recomendamos para empezar: Meta aprende con pocos eventos claros. */
export const RECOMMENDED_STAGE_EVENTS: StageEvents = {
  nuevo: "LeadSubmitted",
  "4": "QualifiedLead",
  ganado: "Purchase",
};

/** Igual que meta_stage_events_ok() en la base: sólo llaves y eventos conocidos. */
export function parseStageEvents(raw: unknown): StageEvents {
  const o = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: StageEvents = {};
  for (const k of STAGE_EVENT_KEYS) if (isMetaEvent(o[k])) out[k] = o[k];
  return out;
}

/** Momento del pipeline de un lead (igual que el trigger de la base). null = no aplica. */
export function stageEventKey(stage: number, outcome: string | null): StageEventKey | null {
  if (stage >= 1 && stage <= 6) return String(stage) as StageEventKey;
  if (stage === 7 && outcome === "ganado") return "ganado";
  return null;
}

/** Estado de cada evento en la cola (meta_events.status), en palabras simples. */
export const META_STATUS_LABEL: Record<string, string> = {
  pendiente: "Por enviar",
  enviando: "Enviando",
  enviado: "Enviado",
  omitido: "No se envió",
  fallido: "Falló",
};
