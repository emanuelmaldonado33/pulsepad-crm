import type { Account, Appointment, Lead } from "./types";

export type WaitUnit = "min" | "hour" | "day";
export type LeadNumberField = "budget" | "downPayment" | "termMonths";
export type ConditionRule =
  | { kind: "tag"; tag: string }
  | { kind: "stage"; op: "eq" | "gte"; stage: string }
  | { kind: "field"; field: LeadNumberField; op: "set" | "gte" | "lte"; value: number }
  | { kind: "replied" }
  | { kind: "advisor_replied" }
  | { kind: "appointment" };

/** A quién avisa el paso «Avisar al equipo»: el asesor asignado, los administradores o un user_id. */
export type NotifyTarget = "assigned" | "admins" | (string & {});
export type LeadAction =
  | "add_tag"
  | "remove_tag"
  | "set_stage"
  | "bot_on"
  | "bot_off"
  /** Cancela las demás inscripciones activas del lead. */
  | "exit_flows"
  /** Lo da de baja: sale de todos los flujos y no recibe más mensajes automáticos. */
  | "opt_out";

/**
 * Plantilla aprobada por Meta para cuando la ventana de 24 h está cerrada. params lleva un
 * texto (con variables de Pulse) por cada variable del cuerpo, en orden.
 */
export interface TemplateRef {
  name: string;
  language: string;
  params: string[];
}

/** Plantilla sincronizada de WhatsApp Business (whatsapp_templates). */
export interface WaTemplate {
  name: string;
  language: string;
  category: string;
  body: string;
  headerFormat: "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  params: string[];
}

export type FlowStep =
  | {
      id: string;
      type: "message";
      text: string;
      materialId: string | null;
      /** Se usa en lugar del texto si pasaron más de 24 h desde el último mensaje del lead. */
      template?: TemplateRef | null;
      /** Si cae fuera del horario hábil de la subcuenta, espera a la siguiente apertura. */
      businessHours?: boolean;
    }
  | { id: string; type: "wait"; amount: number; unit: WaitUnit }
  | { id: string; type: "wait_appt"; amount: number; unit: WaitUnit }
  | { id: string; type: "action"; action: LeadAction; value: string }
  | { id: string; type: "notify"; to: NotifyTarget[]; text: string; whatsapp: boolean }
  /** userIds vacío = todo el equipo. fixed usa el primero. */
  | { id: string; type: "assign"; mode: "fixed" | "round_robin"; userIds: string[] }
  | { id: string; type: "condition"; rule: ConditionRule; yes: FlowStep[]; no: FlowStep[] }
  | { id: string; type: "end" };

export type TriggerType =
  "new_lead" | "stage" | "tag" | "reply" | "keyword" | "intent" | "ad_lead" | "qualification";

/** Intenciones que la IA detecta en cada mensaje del lead (messages.ai_intent). */
export const MESSAGE_INTENTS = {
  quiere_comprar: "Quiere comprar",
  pide_precio: "Pide precio o cotización",
  pide_cita: "Pide una cita",
  objecion: "Tiene una objeción",
  no_interesado: "No le interesa",
  quiere_humano: "Pide hablar con un humano",
  pide_baja: "Pide no recibir mensajes",
} as const;
export type MessageIntent = keyof typeof MESSAGE_INTENTS;

/** Calificación de IA del lead (leads.intent), la que muestra la ficha. */
export const LEAD_INTENTS: Record<string, string> = {
  informacion: "Pide información",
  calificando: "Calificando",
  listo_para_cita: "Listo para cita",
  quiere_humano: "Quiere humano",
  no_interesado: "No interesado",
  seguimiento: "Seguimiento",
};

/**
 * Opciones del disparador (flows.trigger_config). stage/tag limitan los disparadores de
 * conversación a leads en esa etapa o con esa etiqueta.
 */
export interface TriggerConfig {
  keywords?: string[];
  intents?: MessageIntent[];
  stage?: number;
  tag?: string;
}

/** Disparadores que reaccionan a un mensaje del lead (corren en la base, al guardar el mensaje). */
export const CONVERSATION_TRIGGERS: TriggerType[] = ["reply", "keyword", "intent"];

/** Igual que flow_norm() en la base: sin acentos, minúsculas, sólo letras y números. */
export const normalizeText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Primera palabra clave contenida (como palabra o frase completa) en el mensaje. */
export const matchKeyword = (keywords: string[], body: string) => {
  const text = ` ${normalizeText(body)} `;
  return keywords.find((k) => normalizeText(k) && text.includes(` ${normalizeText(k)} `)) ?? null;
};

export interface Flow {
  id: string;
  accountId: string;
  name: string;
  active: boolean;
  triggerType: TriggerType;
  triggerValue: string;
  triggerConfig: TriggerConfig;
  /** false = un lead que ya pasó por el flujo no vuelve a entrar. */
  allowReentry: boolean;
  steps: FlowStep[];
  stopOnReply: boolean;
}

export interface Enrollment {
  id: string;
  flowId: string;
  leadId: string;
  accountId: string;
  status: "active" | "completed" | "cancelled";
  currentStep: number;
  /** Id del siguiente paso a ejecutar (grafo); null = inscripción anterior, usa currentStep. */
  currentNode: string | null;
  nextRunAt: string;
  replied: boolean;
  cancelReason: string | null;
  /** Por qué entró al flujo (lo escribe el disparador en la base). */
  triggerReason: string | null;
  createdAt: string;
}

export interface Material {
  id: string;
  accountId: string;
  name: string;
  kind: "video" | "pdf" | "image" | "audio";
  url: string;
  storagePath?: string | null;
}

export const sid = () => Math.random().toString(36).slice(2, 10);

const UNIT_MS: Record<WaitUnit, number> = { min: 60_000, hour: 3_600_000, day: 86_400_000 };
export const waitMs = (amount: number, unit: WaitUnit) => Math.max(0, amount) * UNIT_MS[unit];
export const unitLabel = (amount: number, unit: WaitUnit) =>
  `${amount} ${unit === "min" ? (amount === 1 ? "minuto" : "minutos") : unit === "hour" ? (amount === 1 ? "hora" : "horas") : amount === 1 ? "día" : "días"}`;

export const VARIABLES = [
  "nombre",
  "nombre_completo",
  "proyecto",
  "producto",
  "presupuesto",
  "cita",
  "asesor",
] as const;

export function renderText(
  text: string,
  ctx: {
    lead: Lead;
    account: Account;
    appointment?: Appointment | undefined;
    material?: Material | undefined;
    /** Nombre del asesor asignado. */
    advisor?: string | undefined;
  },
) {
  const { lead, account, appointment } = ctx;
  const vars: Record<string, string> = {
    nombre: lead.name.split(" ")[0] ?? lead.name,
    nombre_completo: lead.name,
    proyecto: account.name,
    producto: account.product,
    presupuesto: lead.budget == null ? "tu presupuesto" : "$" + lead.budget.toLocaleString("es-MX"),
    cita: appointment
      ? new Date(appointment.at).toLocaleString("es-MX", {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "tu cita",
    asesor: ctx.advisor || "un asesor",
  };
  let out = text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
  if (ctx.material)
    out += `\n\n${materialIcon(ctx.material.kind)} ${ctx.material.name}: ${ctx.material.url}`;
  return out;
}

/** Marca de "no queda nada por ejecutar" en flow_enrollments.current_node. */
export const END_NODE = "$end";

export interface FlowNode {
  step: FlowStep;
  /** Paso que sigue al terminar este (o al terminar sus ramas); null = fin del flujo. */
  next: string | null;
}

/**
 * Convierte los pasos (lista con ramas anidadas) en un grafo por id. Al terminar una rama
 * el flujo continúa con el paso que sigue a la condición. Como las ramas se anidan, el grafo
 * no puede tener ciclos.
 */
export function flowGraph(steps: FlowStep[]): Map<string, FlowNode> {
  const g = new Map<string, FlowNode>();
  const walk = (list: FlowStep[], after: string | null) =>
    list.forEach((step, i) => {
      const next = list[i + 1]?.id ?? after;
      g.set(step.id, { step, next });
      if (step.type === "condition") {
        walk(step.yes, next);
        walk(step.no, next);
      }
    });
  walk(steps, null);
  return g;
}

/**
 * Paso donde retoma una inscripción. null = ya no queda nada; undefined = el paso donde iba
 * se borró del flujo. Las inscripciones de antes de las ramas solo tienen currentStep (índice).
 */
export function resumeNode(
  graph: Map<string, FlowNode>,
  steps: FlowStep[],
  e: Pick<Enrollment, "currentNode" | "currentStep">,
): string | null | undefined {
  if (e.currentNode === END_NODE) return null;
  if (e.currentNode) return graph.has(e.currentNode) ? e.currentNode : undefined;
  return steps[e.currentStep]?.id ?? null;
}

/** Siguiente paso tras evaluar una condición: primer paso de la rama, o lo que sigue si está vacía. */
export const branchStart = (
  step: Extract<FlowStep, { type: "condition" }>,
  next: string | null,
  ok: boolean,
) => (ok ? step.yes : step.no)[0]?.id ?? next;

/** Todos los pasos, incluidos los de las ramas. */
export const allSteps = (steps: FlowStep[]): FlowStep[] =>
  steps.flatMap((s) => (s.type === "condition" ? [s, ...allSteps(s.yes), ...allSteps(s.no)] : [s]));

export const FIELD_LABEL: Record<LeadNumberField, string> = {
  budget: "Presupuesto",
  downPayment: "Enganche / monto",
  termMonths: "Plazo (meses)",
};

export function evaluateCondition(
  rule: ConditionRule,
  ctx: {
    lead: Pick<Lead, "tags" | "stage" | LeadNumberField>;
    replied: boolean;
    advisorReplied?: boolean;
    hasAppointment: boolean;
  },
): boolean {
  const { lead } = ctx;
  switch (rule.kind) {
    case "tag":
      return lead.tags.includes(rule.tag);
    case "stage":
      return rule.op === "eq"
        ? lead.stage === Number(rule.stage)
        : lead.stage >= Number(rule.stage);
    case "field": {
      const v = lead[rule.field];
      if (v == null) return false;
      return rule.op === "set" ? true : rule.op === "gte" ? v >= rule.value : v <= rule.value;
    }
    case "replied":
      return ctx.replied;
    case "advisor_replied":
      return ctx.advisorReplied ?? false;
    case "appointment":
      return ctx.hasAppointment;
    default:
      return false;
  }
}

export function conditionLabel(rule: ConditionRule, stageName: (n: number) => string): string {
  switch (rule.kind) {
    case "tag":
      return `¿Tiene la etiqueta #${rule.tag}?`;
    case "stage":
      return rule.op === "eq"
        ? `¿Está en ${stageName(Number(rule.stage))}?`
        : `¿Llegó a ${stageName(Number(rule.stage))} o más?`;
    case "field":
      return rule.op === "set"
        ? `¿Tiene ${FIELD_LABEL[rule.field].toLowerCase()}?`
        : `¿${FIELD_LABEL[rule.field]} ${rule.op === "gte" ? "≥" : "≤"} ${rule.value.toLocaleString("es-MX")}?`;
    case "replied":
      return "¿Respondió desde que entró al flujo?";
    case "advisor_replied":
      return "¿Un asesor le escribió desde que entró al flujo?";
    case "appointment":
      return "¿Tiene cita programada?";
    default:
      return "Condición";
  }
}

/** ¿Qué flujos activos dispara el cambio de lead? prev = undefined significa lead nuevo. */
export function matchTriggers(
  flows: Flow[],
  prev: Pick<Lead, "stage" | "tags"> | undefined,
  next: Lead,
): Flow[] {
  return flows.filter((f) => {
    if (!f.active || f.accountId !== next.accountId) return false;
    if (f.triggerType === "new_lead") return prev === undefined;
    if (f.triggerType === "stage")
      return (
        Number(f.triggerValue) === next.stage && (prev === undefined || prev.stage !== next.stage)
      );
    if (f.triggerType === "tag")
      return next.tags.includes(f.triggerValue) && !(prev?.tags.includes(f.triggerValue) ?? false);
    return false;
  });
}

const filterLabel = (c: TriggerConfig, stageName: (n: number) => string) =>
  [c.stage != null ? `en ${stageName(c.stage)}` : "", c.tag ? `con #${c.tag}` : ""]
    .filter(Boolean)
    .join(" y ");

export function triggerLabel(
  f: Pick<Flow, "triggerType" | "triggerValue"> & { triggerConfig?: TriggerConfig },
  stageName: (n: number) => string,
): string {
  const c = f.triggerConfig ?? {};
  const only = filterLabel(c, stageName);
  const suffix = only ? ` (solo leads ${only})` : "";
  switch (f.triggerType) {
    case "new_lead":
      return "Lead nuevo";
    case "stage":
      return `Entra a ${stageName(Number(f.triggerValue))}`;
    case "tag":
      return `Recibe etiqueta #${f.triggerValue}`;
    case "reply":
      return `El lead responde${suffix}`;
    case "keyword":
      return `El mensaje contiene ${(c.keywords ?? []).map((k) => `«${k}»`).join(", ") || "…"}${suffix}`;
    case "intent":
      return `La IA detecta: ${(c.intents ?? []).map((i) => MESSAGE_INTENTS[i]?.toLowerCase() ?? i).join(", ") || "…"}${suffix}`;
    case "ad_lead":
      return f.triggerValue ? `Lead nuevo de anuncio «${f.triggerValue}»` : "Lead nuevo de anuncio";
    case "qualification":
      return f.triggerValue
        ? `Calificación de IA cambia a «${LEAD_INTENTS[f.triggerValue] ?? f.triggerValue}»`
        : "Cambió la calificación de IA";
    default:
      return "Disparador";
  }
}

/** ¿Falta algo para que el disparador pueda activarse? Devuelve el aviso o null. */
export function triggerProblem(f: Pick<Flow, "triggerType" | "triggerValue" | "triggerConfig">) {
  if (f.triggerType === "tag" && !f.triggerValue) return "Escribe la etiqueta del disparador.";
  if (f.triggerType === "keyword" && !(f.triggerConfig.keywords ?? []).some((k) => k.trim()))
    return "Escribe al menos una palabra o frase.";
  if (f.triggerType === "intent" && !(f.triggerConfig.intents ?? []).length)
    return "Elige al menos una intención.";
  return null;
}

export interface FlowTemplate {
  key: string;
  name: string;
  description: string;
  triggerType: TriggerType;
  triggerValue: string;
  triggerConfig?: TriggerConfig;
  /** Por defecto true. */
  allowReentry?: boolean;
  steps: (materials: Material[]) => FlowStep[];
  /** Por defecto true. Los flujos que preguntan "¿respondió?" necesitan false. */
  stopOnReply?: boolean;
}

const firstOf = (m: Material[], kind: Material["kind"]) =>
  m.find((x) => x.kind === kind)?.id ?? null;

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: "video",
    name: "Entrega de Video y Material",
    description: "Bienvenida, envío de video y PDF, y seguimiento a las 2 horas.",
    triggerType: "new_lead",
    triggerValue: "",
    steps: (m) => [
      {
        id: sid(),
        type: "message",
        text: "¡Hola {{nombre}}! 👋 Gracias por tu interés en {{proyecto}}. Te comparto un video corto para que conozcas el proyecto:",
        materialId: firstOf(m, "video"),
      },
      { id: sid(), type: "wait", amount: 15, unit: "min" },
      {
        id: sid(),
        type: "message",
        text: "Aquí tienes también el brochure con precios y detalles:",
        materialId: firstOf(m, "pdf"),
      },
      { id: sid(), type: "action", action: "add_tag", value: "video-enviado" },
      { id: sid(), type: "wait", amount: 2, unit: "hour" },
      {
        id: sid(),
        type: "message",
        text: "{{nombre}}, ¿pudiste ver el video? Cuéntame qué te pareció y si tienes alguna duda 🙂",
        materialId: null,
      },
    ],
  },
  {
    key: "reactivacion",
    name: "Reactivación de Leads Inactivos",
    description: "Seguimiento a las 24h si el lead no respondió a la calificación.",
    triggerType: "tag",
    triggerValue: "calificando",
    steps: () => [
      { id: sid(), type: "wait", amount: 24, unit: "hour" },
      {
        id: sid(),
        type: "message",
        text: "Hola {{nombre}}, sigo por aquí 😊 ¿Te gustaría que te ayude a encontrar la mejor opción en {{proyecto}} según tu presupuesto?",
        materialId: null,
      },
      { id: sid(), type: "action", action: "add_tag", value: "reactivacion" },
    ],
  },
  {
    key: "sin-respuesta",
    name: "Seguimiento si no responde",
    description:
      "Envía el video; si a las 24h no respondió, insiste; si a los 2 días sigue sin responder, lo marca como frío.",
    triggerType: "new_lead",
    triggerValue: "",
    steps: (m) => [
      {
        id: sid(),
        type: "message",
        text: "¡Hola {{nombre}}! 👋 Gracias por tu interés en {{proyecto}}. Te dejo este video corto, ¿te late que lo revisemos juntos?",
        materialId: firstOf(m, "video"),
      },
      { id: sid(), type: "wait", amount: 24, unit: "hour" },
      {
        id: sid(),
        type: "condition",
        rule: { kind: "replied" },
        yes: [{ id: sid(), type: "end" }],
        no: [
          {
            id: sid(),
            type: "message",
            text: "{{nombre}}, ¿pudiste ver el video? Si me dices tu presupuesto aproximado te muestro la opción que más te conviene 🙂",
            materialId: null,
          },
          { id: sid(), type: "wait", amount: 2, unit: "day" },
          {
            id: sid(),
            type: "condition",
            rule: { kind: "replied" },
            yes: [],
            no: [{ id: sid(), type: "action", action: "add_tag", value: "frio" }],
          },
        ],
      },
    ],
    stopOnReply: false,
  },
  {
    key: "pidio-cotizacion",
    name: "Pidió cotización",
    description:
      "Cuando la IA detecta que el lead pide precio: le confirma, lo etiqueta y, si a las 2 horas no ha respondido, vuelve a escribirle.",
    triggerType: "intent",
    triggerValue: "",
    triggerConfig: { intents: ["pide_precio"] },
    allowReentry: false,
    steps: (m) => [
      { id: sid(), type: "action", action: "add_tag", value: "pidio-cotizacion" },
      {
        id: sid(),
        type: "message",
        text: "¡Con gusto {{nombre}}! 🙌 Te preparo la cotización de {{proyecto}}. Mientras tanto te dejo la información con precios:",
        materialId: firstOf(m, "pdf"),
      },
      { id: sid(), type: "wait", amount: 2, unit: "hour" },
      {
        id: sid(),
        type: "condition",
        rule: { kind: "replied" },
        yes: [],
        no: [
          {
            id: sid(),
            type: "message",
            text: "{{nombre}}, ¿pudiste revisar los precios? Si me dices tu presupuesto aproximado te digo qué opción te conviene más 🙂",
            materialId: null,
          },
        ],
      },
    ],
    stopOnReply: false,
  },
  {
    key: "no-me-interesa",
    name: "No me interesa",
    description:
      "Cuando el lead escribe «no me interesa» o algo parecido: se despide con amabilidad y lo marca como no califica (P7, bot en pausa).",
    triggerType: "keyword",
    triggerValue: "",
    triggerConfig: {
      keywords: ["no me interesa", "no estoy interesado", "no estoy interesada", "ya no gracias"],
    },
    allowReentry: false,
    steps: () => [
      {
        id: sid(),
        type: "message",
        text: "Entiendo {{nombre}}, gracias por avisarme 🙏 Si más adelante quieres retomar lo de {{proyecto}}, aquí estoy.",
        materialId: null,
      },
      { id: sid(), type: "action", action: "add_tag", value: "no-califica" },
    ],
  },
  {
    key: "lead-caliente",
    name: "Lead caliente: avisar y asignar",
    description:
      "Cuando la IA detecta intención de compra: asigna un asesor por turnos, le avisa con resumen, pausa el bot y, si en 10 minutos nadie le escribe, avisa a los administradores.",
    triggerType: "intent",
    triggerValue: "",
    triggerConfig: { intents: ["quiere_comprar"] },
    allowReentry: false,
    steps: () => [
      { id: sid(), type: "assign", mode: "round_robin", userIds: [] },
      {
        id: sid(),
        type: "notify",
        to: ["assigned"],
        text: "🔥 {{nombre_completo}} quiere comprar. Escríbele ya.",
        whatsapp: true,
      },
      { id: sid(), type: "action", action: "bot_off", value: "" },
      {
        id: sid(),
        type: "message",
        text: "¡Excelente {{nombre}}! 🙌 Te comunico con {{asesor}}, que te va a atender personalmente en unos minutos.",
        materialId: null,
      },
      { id: sid(), type: "wait", amount: 10, unit: "min" },
      {
        id: sid(),
        type: "condition",
        rule: { kind: "advisor_replied" },
        yes: [],
        no: [
          {
            id: sid(),
            type: "notify",
            to: ["admins", "assigned"],
            text: "⏰ {{nombre_completo}} lleva 10 minutos esperando a {{asesor}} y nadie le ha escrito.",
            whatsapp: true,
          },
        ],
      },
    ],
    stopOnReply: false,
  },
  {
    key: "catalogo-pdf",
    name: "Enviar catálogo en PDF y dar seguimiento",
    description:
      "Envía el catálogo en horario hábil; si a las 24 h no respondió, insiste (con plantilla si ya cerró la ventana de WhatsApp) y a los 3 días lo marca como frío.",
    triggerType: "keyword",
    triggerValue: "",
    triggerConfig: { keywords: ["catalogo", "catálogo", "brochure", "pdf", "informacion"] },
    allowReentry: false,
    steps: (m) => [
      {
        id: sid(),
        type: "message",
        text: "¡Claro {{nombre}}! Aquí tienes el catálogo de {{proyecto}} con precios y planes 📄",
        materialId: firstOf(m, "pdf"),
        businessHours: true,
      },
      { id: sid(), type: "action", action: "add_tag", value: "catalogo-enviado" },
      { id: sid(), type: "wait", amount: 24, unit: "hour" },
      {
        id: sid(),
        type: "condition",
        rule: { kind: "replied" },
        yes: [{ id: sid(), type: "end" }],
        no: [
          {
            id: sid(),
            type: "message",
            text: "{{nombre}}, ¿pudiste revisar el catálogo? Dime qué opción te llamó la atención y te ayudo con los números 🙂",
            materialId: null,
            template: null,
            businessHours: true,
          },
          { id: sid(), type: "wait", amount: 3, unit: "day" },
          {
            id: sid(),
            type: "condition",
            rule: { kind: "replied" },
            yes: [],
            no: [{ id: sid(), type: "action", action: "add_tag", value: "frio" }],
          },
        ],
      },
    ],
    stopOnReply: false,
  },
  {
    key: "baja",
    name: "Baja: sacar de todos los flujos",
    description:
      "Cuando el lead se marca como no califica: lo saca de todos los demás flujos y le apaga el bot. No lo da de baja de WhatsApp (eso es la acción «Dar de baja»).",
    triggerType: "tag",
    triggerValue: "no-califica",
    steps: () => [
      { id: sid(), type: "action", action: "exit_flows", value: "" },
      { id: sid(), type: "action", action: "bot_off", value: "" },
      { id: sid(), type: "action", action: "add_tag", value: "baja" },
    ],
  },
  {
    key: "recordatorio",
    name: "Recordatorio de Cita",
    description: "Mensajes 24h y 2h antes de la cita con resumen y confirmación.",
    triggerType: "stage",
    triggerValue: "5",
    steps: () => [
      { id: sid(), type: "wait_appt", amount: 24, unit: "hour" },
      {
        id: sid(),
        type: "message",
        text: "Hola {{nombre}}, te recuerdo tu cita de {{proyecto}} el {{cita}}. Revisaremos opciones para {{presupuesto}}. ¿Me confirmas tu asistencia? ✅",
        materialId: null,
      },
      { id: sid(), type: "wait_appt", amount: 2, unit: "hour" },
      {
        id: sid(),
        type: "message",
        text: "{{nombre}}, nos vemos en 2 horas ({{cita}}). ¡Te esperamos!",
        materialId: null,
      },
    ],
  },
];

export const materialIcon = (k: Material["kind"]) =>
  k === "video" ? "🎥" : k === "image" ? "🖼️" : k === "audio" ? "🎙️" : "📄";

// ===== Reglas de WhatsApp Business =====

/** Meta sólo deja enviar texto libre hasta 24 h después del último mensaje del lead. */
export const WINDOW_MS = 24 * 3_600_000;

/** ¿Se puede enviar texto libre? Sin mensajes del lead la ventana nunca se abrió. */
export const windowOpen = (lastLeadMessageAt: string | null | undefined, now = Date.now()) =>
  lastLeadMessageAt != null && now - new Date(lastLeadMessageAt).getTime() < WINDOW_MS;

/**
 * Mensajes sin plantilla que pueden llegar con la ventana cerrada: los que van después de
 * esperas que suman 24 h o más, o de una espera antes de la cita. Es una estimación para
 * avisar en el editor; el motor revisa la ventana real al enviar.
 */
export function stepsAtRiskOfClosedWindow(steps: FlowStep[]): Set<string> {
  const risky = new Set<string>();
  const walk = (list: FlowStep[], waited: number): number => {
    for (const s of list) {
      if (s.type === "wait") waited += waitMs(s.amount, s.unit);
      else if (s.type === "wait_appt") waited = Math.max(waited, WINDOW_MS);
      else if (s.type === "message" && !s.template && waited >= WINDOW_MS) risky.add(s.id);
      else if (s.type === "condition") waited = Math.max(walk(s.yes, waited), walk(s.no, waited));
    }
    return waited;
  };
  walk(steps, 0);
  return risky;
}

/** Texto que verá el lead con la plantilla: el cuerpo con cada variable reemplazada. */
export function templatePreview(t: Pick<WaTemplate, "body" | "params">, values: string[]) {
  return t.params.reduce(
    (body, key, i) =>
      body.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), () => values[i] ?? ""),
    t.body,
  );
}

/** days[0] = domingo; cada día es [apertura, cierre] en "HH:MM" o null si está cerrado. */
export interface BusinessHours {
  tz?: string;
  days?: readonly (readonly [string, string] | null)[];
}
export const DEFAULT_TZ = "America/Mexico_City";
export const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const minutesOf = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v <= 24 * 60 ? v : null;
};
const daySpan = (h: BusinessHours, day: number) => {
  const d = h.days?.[day];
  if (!d) return null;
  const open = minutesOf(d[0]),
    close = minutesOf(d[1]);
  return open != null && close != null && close > open ? { open, close } : null;
};

/** ¿Hay al menos un día con horario válido? Sin horario los mensajes salen a cualquier hora. */
export const hoursConfigured = (h: BusinessHours | null | undefined): h is BusinessHours =>
  !!h && [0, 1, 2, 3, 4, 5, 6].some((d) => daySpan(h, d) != null);

/** Fecha, día de la semana y minuto del día de un instante en una zona horaria. */
function zoned(t: number, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
    })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts["year"]),
    mo = Number(parts["month"]),
    d = Number(parts["day"]);
  const min = Number(parts["hour"]) * 60 + Number(parts["minute"]);
  return { y, mo, d, min, wd: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

/** Instante en que la zona horaria marca ese día (d puede pasarse del mes) y minuto. */
function zonedInstant(y: number, mo: number, d: number, min: number, tz: string) {
  const wall = Date.UTC(y, mo - 1, d, 0, min);
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const z = zoned(t, tz);
    t += wall - Date.UTC(z.y, z.mo - 1, z.d, 0, z.min);
  }
  return t;
}

/** Siguiente apertura del negocio, o null si está abierto ahora (o no hay horario). */
export function nextOpening(h: BusinessHours | null | undefined, now: Date): Date | null {
  if (!hoursConfigured(h)) return null;
  let tz = h.tz || DEFAULT_TZ;
  try {
    zoned(0, tz);
  } catch {
    tz = DEFAULT_TZ;
  }
  const z = zoned(now.getTime(), tz);
  for (let k = 0; k <= 7; k++) {
    const span = daySpan(h, (z.wd + k) % 7);
    if (!span) continue;
    if (k === 0 && z.min >= span.open && z.min < span.close) return null;
    if (k === 0 && z.min >= span.close) continue;
    return new Date(zonedInstant(z.y, z.mo, z.d + k, span.open, tz));
  }
  return null;
}
