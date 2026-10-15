import type { Database } from "@/integrations/supabase/types";
import type { Account, Appointment, Lead, Message } from "./types";

type T = Database["public"]["Tables"];
export type AccountRow = T["accounts"]["Row"];
export type LeadRow = T["leads"]["Row"];
export type MessageRow = T["messages"]["Row"];
export type AppointmentRow = T["appointments"]["Row"];

export const toAccount = (r: AccountRow): Account => ({
  id: r.id, name: r.name, initials: r.initials, tagline: r.tagline, brand: r.brand,
  brandForeground: r.brand_foreground, product: r.product, ticketLabel: r.ticket_label,
  setterPrompt: r.setter_prompt, qualificationRules: r.qualification_rules, aiModel: r.ai_model,
});

export const toMessage = (r: MessageRow): Message => ({ id: r.id, from: r.sender as Message["from"], text: r.body, at: r.created_at });

export const toLead = (r: LeadRow, messages: Message[]): Lead => ({
  id: r.id, accountId: r.account_id, name: r.name, phone: r.phone, source: r.source, stage: r.stage,
  outcome: (r.outcome as Lead["outcome"]) ?? null,
  budget: r.budget == null ? null : Number(r.budget),
  downPayment: r.down_payment == null ? null : Number(r.down_payment),
  termMonths: r.term_months, intent: r.intent, tags: r.tags ?? [], notes: r.notes,
  botActive: r.bot_active, messages, createdAt: r.created_at,
});

export const leadPatch = (l: Lead) => ({
  name: l.name, phone: l.phone, source: l.source, stage: l.stage, outcome: l.outcome,
  budget: l.budget, down_payment: l.downPayment, term_months: l.termMonths, intent: l.intent ?? null,
  tags: l.tags, notes: l.notes, bot_active: l.botActive,
});

export const toAppointment = (r: AppointmentRow): Appointment => ({
  id: r.id, accountId: r.account_id, leadId: r.lead_id, at: r.at,
  kind: r.kind as Appointment["kind"], status: r.status as Appointment["status"],
});
