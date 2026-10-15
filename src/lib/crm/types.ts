export type Sender = "lead" | "bot" | "asesor";

export interface Message {
  id: string;
  from: Sender;
  text: string;
  at: string; // ISO
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
  tags: string[];
  notes: string;
  botActive: boolean;
  messages: Message[];
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
