import type { Account, Appointment, Lead } from "./types";

export type WaitUnit = "min" | "hour" | "day";
export type FlowStep =
  | { id: string; type: "message"; text: string; materialId: string | null }
  | { id: string; type: "wait"; amount: number; unit: WaitUnit }
  | { id: string; type: "wait_appt"; amount: number; unit: WaitUnit }
  | { id: string; type: "action"; action: "add_tag" | "remove_tag" | "set_stage"; value: string };

export type TriggerType = "new_lead" | "stage" | "tag";

export interface Flow {
  id: string;
  accountId: string;
  name: string;
  active: boolean;
  triggerType: TriggerType;
  triggerValue: string;
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
  nextRunAt: string;
  replied: boolean;
  cancelReason: string | null;
  createdAt: string;
}

export interface Material {
  id: string;
  accountId: string;
  name: string;
  kind: "video" | "pdf" | "image";
  url: string;
  storagePath?: string | null;
}

export const sid = () => Math.random().toString(36).slice(2, 10);

const UNIT_MS: Record<WaitUnit, number> = { min: 60_000, hour: 3_600_000, day: 86_400_000 };
export const waitMs = (amount: number, unit: WaitUnit) => Math.max(0, amount) * UNIT_MS[unit];
export const unitLabel = (amount: number, unit: WaitUnit) =>
  `${amount} ${unit === "min" ? (amount === 1 ? "minuto" : "minutos") : unit === "hour" ? (amount === 1 ? "hora" : "horas") : amount === 1 ? "día" : "días"}`;

export const VARIABLES = ["nombre", "nombre_completo", "proyecto", "producto", "presupuesto", "cita"] as const;

export function renderText(text: string, ctx: { lead: Lead; account: Account; appointment?: Appointment | undefined; material?: Material | undefined }) {
  const { lead, account, appointment } = ctx;
  const vars: Record<string, string> = {
    nombre: lead.name.split(" ")[0] ?? lead.name,
    nombre_completo: lead.name,
    proyecto: account.name,
    producto: account.product,
    presupuesto: lead.budget == null ? "tu presupuesto" : "$" + lead.budget.toLocaleString("es-MX"),
    cita: appointment ? new Date(appointment.at).toLocaleString("es-MX", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "tu cita",
  };
  let out = text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
  if (ctx.material) out += `\n\n${materialIcon(ctx.material.kind)} ${ctx.material.name}: ${ctx.material.url}`;
  return out;
}

/** ¿Qué flujos activos dispara el cambio de lead? prev = undefined significa lead nuevo. */
export function matchTriggers(flows: Flow[], prev: Pick<Lead, "stage" | "tags"> | undefined, next: Lead): Flow[] {
  return flows.filter((f) => {
    if (!f.active || f.accountId !== next.accountId) return false;
    if (f.triggerType === "new_lead") return prev === undefined;
    if (f.triggerType === "stage") return Number(f.triggerValue) === next.stage && (prev === undefined || prev.stage !== next.stage);
    if (f.triggerType === "tag") return next.tags.includes(f.triggerValue) && !(prev?.tags.includes(f.triggerValue) ?? false);
    return false;
  });
}

export const triggerLabel = (f: Pick<Flow, "triggerType" | "triggerValue">, stageName: (n: number) => string) =>
  f.triggerType === "new_lead" ? "Lead nuevo" : f.triggerType === "stage" ? `Entra a ${stageName(Number(f.triggerValue))}` : `Recibe etiqueta #${f.triggerValue}`;

export interface FlowTemplate {
  key: string;
  name: string;
  description: string;
  triggerType: TriggerType;
  triggerValue: string;
  steps: (materials: Material[]) => FlowStep[];
}

const firstOf = (m: Material[], kind: Material["kind"]) => m.find((x) => x.kind === kind)?.id ?? null;

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: "video",
    name: "Entrega de Video y Material",
    description: "Bienvenida, envío de video y PDF, y seguimiento a las 2 horas.",
    triggerType: "new_lead",
    triggerValue: "",
    steps: (m) => [
      { id: sid(), type: "message", text: "¡Hola {{nombre}}! 👋 Gracias por tu interés en {{proyecto}}. Te comparto un video corto para que conozcas el proyecto:", materialId: firstOf(m, "video") },
      { id: sid(), type: "wait", amount: 15, unit: "min" },
      { id: sid(), type: "message", text: "Aquí tienes también el brochure con precios y detalles:", materialId: firstOf(m, "pdf") },
      { id: sid(), type: "action", action: "add_tag", value: "video-enviado" },
      { id: sid(), type: "wait", amount: 2, unit: "hour" },
      { id: sid(), type: "message", text: "{{nombre}}, ¿pudiste ver el video? Cuéntame qué te pareció y si tienes alguna duda 🙂", materialId: null },
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
      { id: sid(), type: "message", text: "Hola {{nombre}}, sigo por aquí 😊 ¿Te gustaría que te ayude a encontrar la mejor opción en {{proyecto}} según tu presupuesto?", materialId: null },
      { id: sid(), type: "action", action: "add_tag", value: "reactivacion" },
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
      { id: sid(), type: "message", text: "Hola {{nombre}}, te recuerdo tu cita de {{proyecto}} el {{cita}}. Revisaremos opciones para {{presupuesto}}. ¿Me confirmas tu asistencia? ✅", materialId: null },
      { id: sid(), type: "wait_appt", amount: 2, unit: "hour" },
      { id: sid(), type: "message", text: "{{nombre}}, nos vemos en 2 horas ({{cita}}). ¡Te esperamos!", materialId: null },
    ],
  },
];

export const materialIcon = (k: Material["kind"]) => (k === "video" ? "🎥" : k === "image" ? "🖼️" : "📄");
