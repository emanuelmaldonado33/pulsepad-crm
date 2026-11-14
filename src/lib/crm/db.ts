import type { Database } from "@/integrations/supabase/types";
import type { BusinessHours, Enrollment, Flow } from "./flows";
import { parseStageEvents } from "./meta";
import type { Account, Appointment, Lead, Member, Message, QrSource } from "./types";

type T = Database["public"]["Tables"];
export type AccountRow = T["accounts"]["Row"];
export type LeadRow = T["leads"]["Row"];
export type MessageRow = T["messages"]["Row"];
export type AppointmentRow = T["appointments"]["Row"];

export const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.name,
  initials: r.initials,
  tagline: r.tagline,
  brand: r.brand,
  brandForeground: r.brand_foreground,
  product: r.product,
  ticketLabel: r.ticket_label,
  setterPrompt: r.setter_prompt,
  qualificationRules: r.qualification_rules,
  aiModel: r.ai_model,
  template: r.template,
  standardTags: r.standard_tags ?? [],
  autoPauseBot: r.auto_pause_bot ?? true,
  businessHours: (r.business_hours &&
  typeof r.business_hours === "object" &&
  !Array.isArray(r.business_hours)
    ? r.business_hours
    : {}) as BusinessHours,
  publicWhatsapp: r.public_whatsapp ?? "",
  metaEventsEnabled: r.meta_events_enabled ?? false,
  metaStageEvents: parseStageEvents(r.meta_stage_events),
});

export const toMember = (r: T["account_memberships"]["Row"]): Member => ({
  accountId: r.account_id,
  userId: r.user_id,
  role: r.role as Member["role"],
  name: r.display_name || "Sin nombre",
  whatsappPhone: r.whatsapp_phone ?? "",
  available: r.available ?? true,
});

export const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  from: r.sender as Message["from"],
  text: r.body,
  at: r.created_at,
  waStatus: r.wa_status,
  intent: r.ai_intent ?? null,
});

export const toLead = (r: LeadRow, messages: Message[]): Lead => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  phone: r.phone,
  source: r.source,
  stage: r.stage,
  outcome: (r.outcome as Lead["outcome"]) ?? null,
  budget: r.budget == null ? null : Number(r.budget),
  downPayment: r.down_payment == null ? null : Number(r.down_payment),
  termMonths: r.term_months,
  intent: r.intent,
  tags: r.tags ?? [],
  notes: r.notes,
  botActive: r.bot_active,
  assignedTo: r.assigned_to ?? null,
  aiSummary: r.ai_summary ?? null,
  optedOutAt: r.opted_out_at ?? null,
  optOutReason: r.opt_out_reason ?? null,
  qrSourceId: r.qr_source_id ?? null,
  messages,
  createdAt: r.created_at,
});

/** Columnas que guarda una edición del lead. La baja va aparte (no se pisa por carreras). */
export const leadPatch = (l: Lead) => ({
  name: l.name,
  phone: l.phone,
  source: l.source,
  stage: l.stage,
  outcome: l.outcome,
  budget: l.budget,
  down_payment: l.downPayment,
  term_months: l.termMonths,
  intent: l.intent ?? null,
  tags: l.tags,
  notes: l.notes,
  bot_active: l.botActive,
});

export const toQrSource = (r: T["qr_sources"]["Row"]): QrSource => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  code: r.code,
  assignedTo: r.assigned_to,
  active: r.active,
  createdAt: r.created_at,
});

export const toAppointment = (r: AppointmentRow): Appointment => ({
  id: r.id,
  accountId: r.account_id,
  leadId: r.lead_id,
  at: r.at,
  kind: r.kind as Appointment["kind"],
  status: r.status as Appointment["status"],
});

export const toFlow = (r: T["flows"]["Row"]): Flow => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  active: r.active,
  triggerType: r.trigger_type as Flow["triggerType"],
  triggerValue: r.trigger_value,
  triggerConfig: (r.trigger_config &&
  typeof r.trigger_config === "object" &&
  !Array.isArray(r.trigger_config)
    ? r.trigger_config
    : {}) as unknown as Flow["triggerConfig"],
  allowReentry: r.allow_reentry ?? true,
  steps: (Array.isArray(r.steps) ? r.steps : []) as unknown as Flow["steps"],
  stopOnReply: r.stop_on_reply,
});

export const toEnrollment = (r: T["flow_enrollments"]["Row"]): Enrollment => ({
  id: r.id,
  flowId: r.flow_id,
  leadId: r.lead_id,
  accountId: r.account_id,
  status: r.status as Enrollment["status"],
  currentStep: r.current_step,
  currentNode: r.current_node,
  nextRunAt: r.next_run_at,
  replied: r.replied,
  cancelReason: r.cancel_reason,
  triggerReason: r.trigger_reason ?? null,
  createdAt: r.created_at,
});
