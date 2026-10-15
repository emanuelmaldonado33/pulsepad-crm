import type { Lead, Message, Outcome } from "./types";

/** Reglas de etiqueta → efecto en pipeline y bot. */
export interface TagRule {
  stage?: number;
  outcome?: Outcome;
  bot?: boolean;
  label: string;
}

export const TAG_RULES: Record<string, TagRule> = {
  contactado: { stage: 1, label: "Mueve a P1" },
  calificando: { stage: 2, label: "Mueve a P2" },
  "video-enviado": { stage: 3, label: "Mueve a P3" },
  perfilado: { stage: 4, label: "Mueve a P4" },
  "cita-agendada": { stage: 5, bot: false, label: "Mueve a P5 y pausa bot" },
  seguimiento: { stage: 6, bot: false, label: "Mueve a P6 y pausa bot" },
  ganado: { stage: 7, outcome: "ganado", bot: false, label: "Ganado, pausa bot" },
  "no-califica": { stage: 7, outcome: "no_califica", bot: false, label: "No califica, pausa bot" },
  humano: { bot: false, label: "Pausa bot (pide asesor)" },
  "reactivar-bot": { bot: true, label: "Reactiva bot" },
};

/** Etiqueta canónica de cada etapa (para sincronizar etapa → etiqueta). */
export const STAGE_TAG: Record<number, string | null> = {
  0: null,
  1: "contactado",
  2: "calificando",
  3: "video-enviado",
  4: "perfilado",
  5: "cita-agendada",
  6: "seguimiento",
  7: null,
};

const STAGE_TAGS = new Set(["contactado", "calificando", "video-enviado", "perfilado", "cita-agendada", "seguimiento", "ganado", "no-califica"]);

/** Aplica una etiqueta y sus efectos automáticos. */
export function applyTag(lead: Lead, tag: string): Lead {
  const rule = TAG_RULES[tag];
  let tags = lead.tags.includes(tag) ? lead.tags : [...lead.tags, tag];
  let next: Lead = { ...lead, tags };
  if (rule?.stage !== undefined) {
    tags = tags.filter((t) => t === tag || !STAGE_TAGS.has(t));
    next = { ...next, tags, stage: rule.stage, outcome: rule.outcome ?? null };
  }
  if (rule?.bot !== undefined) next.botActive = rule.bot;
  if (tag === "reactivar-bot") next.tags = next.tags.filter((t) => t !== "humano" && t !== "reactivar-bot");
  if (tag === "humano") next.tags = next.tags.filter((t) => t !== "reactivar-bot");
  return next;
}

export function removeTag(lead: Lead, tag: string): Lead {
  const next = { ...lead, tags: lead.tags.filter((t) => t !== tag) };
  if (tag === "humano") next.botActive = true;
  return next;
}

/** Mover etapa en el pipeline sincroniza la etiqueta y el bot (bidireccional). */
export function moveToStage(lead: Lead, stage: number, outcome: Outcome = null): Lead {
  if (stage === 7) return applyTag(lead, outcome === "no_califica" ? "no-califica" : "ganado");
  const tag = STAGE_TAG[stage];
  if (tag) return applyTag(lead, tag);
  return { ...lead, stage: 0, outcome: null, botActive: true, tags: lead.tags.filter((t) => !STAGE_TAGS.has(t)) };
}

export function setBot(lead: Lead, active: boolean): Lead {
  return active ? applyTag(lead, "reactivar-bot") : applyTag(lead, "humano");
}

/* ---------- Extracción de datos de mensajes ---------- */

function parseAmount(raw: string, unit?: string): number {
  const n = parseFloat(raw.replace(/,/g, ""));
  const u = (unit || "").toLowerCase();
  if (u.startsWith("m") && u !== "mil") return Math.round(n * 1_000_000);
  if (u === "mil" || u === "k") return Math.round(n * 1_000);
  return Math.round(n);
}

const AMOUNT = String.raw`\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(millones|millón|millon|mdp|mil|k|m)?\b`;

export interface Extraction {
  budget?: number;
  downPayment?: number;
  downPaymentPct?: number;
  termMonths?: number;
  wantsAppointment?: boolean;
  wantsHuman?: boolean;
  notInterested?: boolean;
}

export function extractData(text: string): Extraction {
  const t = text.toLowerCase();
  const out: Extraction = {};

  const down = t.match(new RegExp(String.raw`enganche[^\d$]{0,20}` + AMOUNT));
  const downPct = t.match(/enganche[^\d]{0,20}(\d{1,2})\s*%/);
  if (downPct) out.downPaymentPct = parseInt(downPct[1], 10);
  else if (down) out.downPayment = parseAmount(down[1], down[2]);

  const budget = t.match(new RegExp(String.raw`(?:presupuesto|invertir|inversi[oó]n|gastar|tengo|hasta|alrededor de|como)[^\d$]{0,20}` + AMOUNT));
  if (budget && !(down && budget.index === down.index)) {
    const v = parseAmount(budget[1], budget[2]);
    if (v >= 1000) out.budget = v;
  }

  const months = t.match(/(\d{1,3})\s*(meses|mes)\b/);
  const years = t.match(/(\d{1,2})\s*(años|año|anos)\b/);
  if (months) out.termMonths = parseInt(months[1], 10);
  else if (years) out.termMonths = parseInt(years[1], 10) * 12;
  else if (/de contado|contado/.test(t)) out.termMonths = 0;

  if (/(agendar|agenda|cita|llamada|reuni[oó]n|visita|videollamada)/.test(t)) out.wantsAppointment = true;
  if (/(asesor|humano|una persona|hablar con alguien|ejecutivo)/.test(t)) out.wantsHuman = true;
  if (/(no me interesa|muy caro|no tengo dinero|no califico|ya no|d[eé]jame de escribir)/.test(t)) out.notInterested = true;
  return out;
}

/* ---------- Motor conversacional (bot) ---------- */

export interface BotEvent {
  kind: "dato" | "etiqueta" | "etapa" | "bot" | "cita";
  text: string;
}

export interface BotResult {
  lead: Lead;
  reply: string | null;
  events: BotEvent[];
  bookAppointment: boolean;
}

const money = (n: number) => "$" + n.toLocaleString("es-MX");

let seq = 0;
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export function msg(from: Message["from"], text: string, at = new Date().toISOString()): Message {
  return { id: uid("m"), from, text, at };
}

/** Procesa un mensaje entrante del lead: extrae datos, aplica etiquetas y genera respuesta. */
export function processLeadMessage(input: Lead, text: string, product: string): BotResult {
  const events: BotEvent[] = [];
  let lead: Lead = { ...input, messages: [...input.messages, msg("lead", text)] };
  const tag = (t: string) => {
    if (lead.tags.includes(t) && TAG_RULES[t]?.stage === lead.stage) return;
    const before = lead;
    lead = applyTag(lead, t);
    events.push({ kind: "etiqueta", text: `Etiqueta «${t}» asignada` });
    if (before.stage !== lead.stage) events.push({ kind: "etapa", text: `Etapa P${before.stage} → P${lead.stage}` });
    if (before.botActive !== lead.botActive) events.push({ kind: "bot", text: lead.botActive ? "Bot reactivado" : "Bot pausado" });
  };

  if (!input.botActive) {
    events.push({ kind: "bot", text: "Bot en pausa: mensaje para el asesor" });
    return { lead, reply: null, events, bookAppointment: false };
  }

  if (lead.stage === 0) tag("contactado");

  const ex = extractData(text);
  if (ex.budget) {
    lead = { ...lead, budget: ex.budget };
    events.push({ kind: "dato", text: `Presupuesto: ${money(ex.budget)}` });
  }
  if (ex.downPaymentPct && (ex.budget ?? lead.budget)) {
    const v = Math.round(((ex.budget ?? lead.budget)! * ex.downPaymentPct) / 100);
    lead = { ...lead, downPayment: v };
    events.push({ kind: "dato", text: `Enganche: ${ex.downPaymentPct}% (${money(v)})` });
  } else if (ex.downPayment) {
    lead = { ...lead, downPayment: ex.downPayment };
    events.push({ kind: "dato", text: `Enganche: ${money(ex.downPayment)}` });
  }
  if (ex.termMonths !== undefined) {
    lead = { ...lead, termMonths: ex.termMonths };
    events.push({ kind: "dato", text: `Plazo: ${ex.termMonths === 0 ? "contado" : ex.termMonths + " meses"}` });
  }

  if (ex.notInterested) {
    tag("no-califica");
    return { lead, reply: "Entiendo, gracias por tu tiempo. Si en el futuro te interesa, aquí estaremos. 🙌", events, bookAppointment: false };
  }
  if (ex.wantsHuman) {
    tag("humano");
    return { lead, reply: "Claro, te comunico con un asesor. En breve te escribe personalmente. 👤", events, bookAppointment: false };
  }

  const gotData = ex.budget || ex.downPayment || ex.downPaymentPct || ex.termMonths !== undefined;
  if (gotData && lead.stage < 2) tag("calificando");

  const profiled = lead.budget != null && lead.downPayment != null && lead.termMonths != null;

  if (profiled && lead.stage < 4) {
    if (lead.stage < 3) tag("video-enviado");
    tag("perfilado");
  }

  if (ex.wantsAppointment && lead.stage >= 3) {
    tag("cita-agendada");
    events.push({ kind: "cita", text: "Cita creada en la agenda" });
    return { lead, reply: "¡Listo! Agendé tu llamada con un asesor para mañana a las 11:00. Te enviaremos recordatorio. 📅", events, bookAppointment: true };
  }

  let reply: string;
  if (lead.budget == null) {
    reply = lead.stage <= 1 && !gotData
      ? `¡Hola ${lead.name.split(" ")[0]}! Gracias por tu interés en ${product}. Para orientarte mejor, ¿qué presupuesto aproximado tienes en mente?`
      : "Perfecto. ¿Con qué presupuesto aproximado te gustaría invertir?";
  } else if (lead.stage < 3) {
    tag("video-enviado");
    reply = `Excelente, con ${money(lead.budget)} tenemos opciones para ti. Te comparto este video con los detalles 🎥 https://demo.video/${lead.accountId}. ¿Cuánto podrías dar de enganche?`;
  } else if (lead.downPayment == null) {
    reply = "¿Cuánto podrías destinar como enganche o pago inicial?";
  } else if (lead.termMonths == null) {
    reply = "¿En qué plazo te gustaría liquidarlo? (por ejemplo 12, 24 o 36 meses, o de contado)";
  } else {
    reply = "¡Tu perfil está completo! ✅ ¿Te gustaría agendar una llamada con un asesor para revisar opciones?";
  }
  return { lead, reply, events, bookAppointment: false };
}
