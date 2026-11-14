/**
 * Difusiones: reglas puras (segmento, topes, costo y cuándo frenar). Sin base ni red, para
 * poder probarlas; el envío está en broadcasts.server.ts.
 */

export interface BroadcastSegment {
  /** Con cualquiera de estas etiquetas. Vacío = cualquier etiqueta. */
  tags: string[];
  /** En cualquiera de estas etapas (0–7). Vacío = cualquier etapa. */
  stages: number[];
  /** Con cualquiera de estos orígenes (WhatsApp, Importado, una lona…). Vacío = cualquiera. */
  sources: string[];
  /** Sólo leads que alguna vez escribieron al número: dieron su número por WhatsApp. */
  onlyEngaged: boolean;
  /** No repetir a quien recibió otra difusión en estos días (0 = sin límite). */
  skipRecentDays: number;
}

export const DEFAULT_SEGMENT: BroadcastSegment = {
  tags: [],
  stages: [],
  sources: [],
  onlyEngaged: true,
  skipRecentDays: 7,
};

export type SegmentLead = {
  id: string;
  stage: number;
  tags: string[];
  source: string;
  phone: string;
  opted_out_at: string | null;
};

export type Exclusion = "baja" | "simulador" | "sin_telefono" | "nunca_escribio" | "reciente";

export const EXCLUSION_LABEL: Record<Exclusion, string> = {
  baja: "pidieron no recibir mensajes",
  simulador: "son del simulador",
  sin_telefono: "no tienen un teléfono válido",
  nunca_escribio: "nunca han escrito al número",
  reciente: "recibieron otra difusión hace poco",
};

const digits = (p: string) => p.replace(/\D/g, "");

/** ¿El lead entra en los filtros? (sin contar exclusiones de seguridad). */
export function inSegment(l: SegmentLead, s: BroadcastSegment) {
  if (s.tags.length && !s.tags.some((t) => l.tags.includes(t))) return false;
  if (s.stages.length && !s.stages.includes(l.stage)) return false;
  if (s.sources.length && !s.sources.includes(l.source)) return false;
  return true;
}

/** Motivo para no enviarle aunque esté en el segmento; null = sí se le envía. */
export function exclusionOf(
  l: SegmentLead,
  s: BroadcastSegment,
  ctx: { engaged: Set<string>; recent: Set<string> },
): Exclusion | null {
  if (l.opted_out_at) return "baja";
  if (l.source === "Simulador") return "simulador";
  if (digits(l.phone).length < 10) return "sin_telefono";
  if (s.onlyEngaged && !ctx.engaged.has(l.id)) return "nunca_escribio";
  if (s.skipRecentDays > 0 && ctx.recent.has(l.id)) return "reciente";
  return null;
}

/** Arma la lista: quién recibe y cuántos se quedan fuera por cada motivo. */
export function planAudience(
  leads: SegmentLead[],
  s: BroadcastSegment,
  ctx: { engaged: Set<string>; recent: Set<string> },
) {
  const recipients: string[] = [];
  const excluded: Partial<Record<Exclusion, number>> = {};
  let matched = 0;
  for (const l of leads) {
    if (!inSegment(l, s)) continue;
    matched++;
    const why = exclusionOf(l, s, ctx);
    if (why) excluded[why] = (excluded[why] ?? 0) + 1;
    else recipients.push(l.id);
  }
  return { matched, recipients, excluded };
}

/**
 * Conversaciones nuevas que el número puede abrir en 24 h según Meta. Sin dato se asume el
 * mínimo (250), que es el de un negocio sin verificar.
 */
export function tierLimit(tier: string | null | undefined): number {
  switch ((tier ?? "").toUpperCase()) {
    case "TIER_50":
      return 50;
    case "TIER_1K":
      return 1_000;
    case "TIER_2K":
      return 2_000;
    case "TIER_10K":
      return 10_000;
    case "TIER_100K":
      return 100_000;
    case "TIER_UNLIMITED":
      return Number.POSITIVE_INFINITY;
    default:
      return 250;
  }
}

/** Margen bajo el límite de Meta: los flujos y el bot también abren conversaciones. */
export const TIER_MARGIN = 0.9;
/** Mensajes por corrida del cron (una por minuto): escalonado y sin ráfagas. */
export const PER_TICK = 30;

/** Cuántos mandar en esta corrida sin pasar el tope de la difusión ni el del número. */
export function batchSize(o: {
  dailyCap: number;
  tier: string | null | undefined;
  sentByBroadcast24h: number;
  sentByAccount24h: number;
  perTick?: number;
}) {
  const own = o.dailyCap - o.sentByBroadcast24h;
  const meta = Math.floor(tierLimit(o.tier) * TIER_MARGIN) - o.sentByAccount24h;
  return Math.max(0, Math.min(o.perTick ?? PER_TICK, own, meta));
}

/** Costo aproximado por mensaje en México (MXN). Meta cobra por plantilla entregada. */
export const COST_MXN: Record<string, number> = {
  MARKETING: 0.8,
  UTILITY: 0.2,
  AUTHENTICATION: 0.2,
};

export function estimateCostMxn(category: string, count: number) {
  return Math.round((COST_MXN[category.toUpperCase()] ?? COST_MXN["MARKETING"]!) * count);
}

/**
 * Errores de Meta que significan «para ya»: seguir enviando arriesga el número. Los demás
 * (número sin WhatsApp, tope de marketing por persona) sólo fallan ese envío.
 */
export const STOP_CODES: Record<number, string> = {
  131048: "Meta frenó los envíos porque muchos usuarios los marcaron como spam",
  131056: "Meta frenó los envíos por exceso de mensajes al mismo tiempo",
  130429: "Meta frenó los envíos por exceso de velocidad",
  131031: "Meta bloqueó la cuenta de WhatsApp Business",
  368: "Meta bloqueó temporalmente el número por incumplir sus políticas",
  132015: "Meta pausó la plantilla por baja calidad",
  132016: "Meta desactivó la plantilla por baja calidad",
  190: "El token de WhatsApp venció o ya no es válido",
};

/** Pausa si fallan demasiados: a partir de 20 intentos, más de 1 de cada 4. */
export function tooManyFailures(attempted: number, failed: number) {
  return attempted >= 20 && failed / attempted > 0.25;
}

/** Calidad del número que obliga a pausar. */
export function qualityStop(quality: string | null | undefined, event: string | null | undefined) {
  if ((quality ?? "").toUpperCase() === "RED")
    return "La calidad del número está en rojo: Meta puede bajar tu límite o bloquear el número";
  if ((event ?? "").toUpperCase() === "FLAGGED") return "Meta marcó el número por baja calidad";
  return null;
}

export const QUALITY_LABEL: Record<string, string> = {
  GREEN: "Alta",
  YELLOW: "Media",
  RED: "Baja",
  UNKNOWN: "Sin dato",
};

export const LIMIT_LABEL = (tier: string | null | undefined) => {
  const n = tierLimit(tier);
  return Number.isFinite(n)
    ? `${n.toLocaleString("es-MX")} contactos nuevos al día`
    : "Sin límite diario";
};
