import type { BusinessHours } from "./flows";
import type { StageEvents } from "./meta";

export type Sender = "lead" | "bot" | "asesor";

export interface Message {
  id: string;
  from: Sender;
  text: string;
  at: string; // ISO
  waStatus?: string | null;
  /** Intención detectada por la IA en un mensaje del lead (ver MESSAGE_INTENTS). */
  intent?: string | null;
}

export interface Account {
  id: string;
  name: string;
  initials: string;
  tagline: string;
  brand: string; // oklch color
  brandForeground: string;
  product: string;
  ticketLabel: string;
  setterPrompt: string;
  qualificationRules: string;
  aiModel: string;
  template: string;
  standardTags: string[];
  /** Pausar el bot cuando un asesor escribe a mano (por defecto sí). */
  autoPauseBot?: boolean;
  /** Horario hábil para los mensajes «solo en horario hábil» de los flujos. */
  businessHours?: BusinessHours;
  /** Número público del negocio (dígitos con lada) para los QR de lonas. */
  publicWhatsapp?: string;
  /** Mandar eventos a Meta (Conversions API) de los leads que llegan por anuncio. */
  metaEventsEnabled?: boolean;
  /** Qué evento de Meta manda cada etapa del pipeline. */
  metaStageEvents?: StageEvents;
}

/** Aviso interno para una persona del equipo (notifications). */
export interface AppNotification {
  id: string;
  accountId: string;
  leadId: string | null;
  title: string;
  body: string;
  waStatus: string | null;
  readAt: string | null;
  createdAt: string;
}

export type MemberRole = "owner" | "admin" | "member";

/** Persona del equipo de una subcuenta (account_memberships). */
export interface Member {
  accountId: string;
  userId: string;
  role: MemberRole;
  name: string;
  whatsappPhone: string;
  available: boolean;
}

export type Outcome = "ganado" | "no_califica" | null;

export interface Lead {
  id: string;
  accountId: string;
  name: string;
  phone: string;
  source: string;
  stage: number; // 0..7
  outcome: Outcome;
  budget: number | null;
  downPayment: number | null; // monto
  termMonths: number | null;
  intent?: string | null;
  tags: string[];
  notes: string;
  botActive: boolean;
  /** Asesor asignado (user_id de account_memberships). */
  assignedTo?: string | null;
  /** Resumen de la conversación que deja la IA para el asesor. */
  aiSummary?: string | null;
  /** Dado de baja: no recibe mensajes automáticos ni entra a flujos. */
  optedOutAt?: string | null;
  optOutReason?: string | null;
  /** QR (lona o vendedor) por el que llegó el lead. */
  qrSourceId?: string | null;
  messages: Message[];
  createdAt: string;
}

/** QR impreso en una lona o entregado a un vendedor. */
export interface QrSource {
  id: string;
  accountId: string;
  name: string;
  code: string;
  /** Vendedor que recibe a los clientes de este QR (user_id del equipo). */
  assignedTo: string | null;
  active: boolean;
  createdAt: string;
}

export interface Appointment {
  id: string;
  accountId: string;
  leadId: string;
  at: string; // ISO
  kind: "Llamada" | "Videollamada" | "Visita";
  status: "programada" | "realizada" | "cancelada";
}

export const STAGES = [
  { code: "P0", name: "Nuevo Lead" },
  { code: "P1", name: "Contactado" },
  { code: "P2", name: "En Calificación" },
  { code: "P3", name: "Material/Video Enviado" },
  { code: "P4", name: "Perfilado (Monto/Plazo)" },
  { code: "P5", name: "Cita Agendada" },
  { code: "P6", name: "Sesión/Seguimiento" },
  { code: "P7", name: "Ganado / No Califica" },
] as const;
