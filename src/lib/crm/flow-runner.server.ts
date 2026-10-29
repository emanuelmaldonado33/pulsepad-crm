import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { applyTag, moveToStage, removeTag } from "./automation";
import { leadPatch, toAccount, toAppointment, toFlow, toLead } from "./db";
import { dispatchMessage, sendInternalWhatsApp } from "./whatsapp.server";
import {
  END_NODE,
  branchStart,
  evaluateCondition,
  flowGraph,
  renderText,
  resumeNode,
  waitMs,
  type FlowNode,
  type FlowStep,
  type Material,
  type NotifyTarget,
} from "./flows";
import type { Account, Lead } from "./types";

type Sb = SupabaseClient<Database>;
type MemberRow = { user_id: string; role: string; display_name: string; whatsapp_phone: string };
const MAX_STEPS = 20;

/** Enlace directo al chat del lead, si la app conoce su URL pública (secreto PUBLIC_APP_URL). */
export const chatLink = (leadId: string) => {
  const base = process.env["PUBLIC_APP_URL"]?.replace(/\/+$/, "");
  return base ? `${base}/inbox?lead=${encodeURIComponent(leadId)}` : null;
};

/** Destinatarios del aviso, sin repetidos y sólo del equipo de la subcuenta. */
export function notifyRecipients(
  to: NotifyTarget[],
  members: MemberRow[],
  assignedTo: string | null,
) {
  const ids = new Set<string>();
  for (const t of to) {
    if (t === "assigned") {
      if (assignedTo) ids.add(assignedTo);
    } else if (t === "admins") {
      members
        .filter((m) => m.role === "owner" || m.role === "admin")
        .forEach((m) => ids.add(m.user_id));
    } else ids.add(t);
  }
  return members.filter((m) => ids.has(m.user_id));
}

/** Texto del aviso: mensaje del paso, resumen de la IA (o lo último que escribió el lead) y enlace. */
export function notifyBody(
  text: string,
  lead: Lead,
  account: Account,
  advisor: string | undefined,
  lastLeadMessages: string[],
) {
  const summary =
    lead.aiSummary?.trim() ||
    (lastLeadMessages.length
      ? lastLeadMessages.map((m) => `«${m.slice(0, 160)}»`).join("\n")
      : "Aún no hay conversación.");
  const link = chatLink(lead.id);
  return [
    renderText(text, { lead, account, advisor }),
    `Resumen IA:\n${summary}`,
    `${lead.name} · ${lead.phone} · P${lead.stage}`,
    link ? `Abrir chat: ${link}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Hora a la que termina una espera; null = se omite (sin cita o la hora ya pasó). */
export function waitTarget(
  st: Extract<FlowStep, { type: "wait" | "wait_appt" }>,
  appt: { at: string } | undefined,
  now: Date,
): number | null {
  if (st.type === "wait") return now.getTime() + waitMs(st.amount, st.unit);
  if (!appt) return null;
  const target = new Date(appt.at).getTime() - waitMs(st.amount, st.unit);
  return target <= Date.now() ? null : target;
}

/** Ejecuta un enrollment hasta la siguiente espera. Reclama un candado para evitar dobles envíos. */
export async function runEnrollment(sb: Sb, id: string, force = false): Promise<"ran" | "skipped"> {
  const now = new Date();
  let claim = sb
    .from("flow_enrollments")
    .update({ locked_until: new Date(now.getTime() + 120_000).toISOString() })
    .eq("id", id)
    .eq("status", "active")
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`);
  if (!force) claim = claim.lte("next_run_at", now.toISOString());
  const { data: enr } = await claim.select().maybeSingle();
  if (!enr) return "skipped";

  const done = (patch: Database["public"]["Tables"]["flow_enrollments"]["Update"]) =>
    sb
      .from("flow_enrollments")
      .update({ ...patch, locked_until: null })
      .eq("id", id);

  try {
    const [{ data: fr }, { data: lr }, { data: ar }, { data: apr }, { data: mr }] =
      await Promise.all([
        sb.from("flows").select("*").eq("id", enr.flow_id).maybeSingle(),
        sb.from("leads").select("*").eq("id", enr.lead_id).maybeSingle(),
        sb.from("accounts").select("*").eq("id", enr.account_id).maybeSingle(),
        sb
          .from("appointments")
          .select("*")
          .eq("lead_id", enr.lead_id)
          .eq("status", "programada")
          .gt("at", now.toISOString())
          .order("at")
          .limit(1),
        sb.from("materials").select("*").eq("account_id", enr.account_id),
      ]);
    const { data: memberRows } = await sb
      .from("account_memberships")
      .select("user_id, role, display_name, whatsapp_phone")
      .eq("account_id", enr.account_id);
    const members: MemberRow[] = memberRows ?? [];
    const nameOf = (userId: string | null | undefined) =>
      members.find((m) => m.user_id === userId)?.display_name || undefined;

    if (!fr || !lr || !ar) {
      await done({ status: "cancelled", cancel_reason: "Flujo o lead eliminado" });
      return "ran";
    }
    const flow = toFlow(fr);
    const account = toAccount(ar);
    let lead = toLead(lr, []);
    const event = async (kind: string, body: string) => {
      const { error } = await sb
        .from("lead_events")
        .insert({ account_id: account.id, lead_id: lead.id, kind, body: body.slice(0, 500) });
      if (error) console.error("lead event failed", error.message);
    };
    const appt = apr?.[0] ? toAppointment(apr[0]) : undefined;
    const materials: Material[] = (mr ?? []).map((m) => ({
      id: m.id,
      accountId: m.account_id,
      name: m.name,
      kind: m.kind as Material["kind"],
      url: m.url,
    }));

    const graph = flowGraph(flow.steps);
    let nodeId = resumeNode(graph, flow.steps, {
      currentNode: enr.current_node,
      currentStep: enr.current_step,
    });
    if (nodeId === undefined) {
      await done({ status: "cancelled", cancel_reason: "El paso donde iba se eliminó del flujo" });
      return "ran";
    }
    let executed = enr.current_step;
    const advance = (next: string | null, patch: Record<string, unknown> = {}) =>
      sb
        .from("flow_enrollments")
        .update({ current_node: next ?? END_NODE, current_step: ++executed, ...patch })
        .eq("id", id);

    for (let n = 0; nodeId && n < MAX_STEPS; n++) {
      const { step: st, next }: FlowNode = graph.get(nodeId)!;
      // Anti-spam: si un trigger lo canceló mientras corría, parar.
      const { data: cur } = await sb
        .from("flow_enrollments")
        .select("status, replied, advisor_replied")
        .eq("id", id)
        .single();
      if (cur?.status !== "active") return "ran";
      if (st.type === "message") {
        const material = materials.find((m) => m.id === st.materialId);
        const { data: msg, error } = await sb
          .from("messages")
          .insert({
            lead_id: lead.id,
            sender: "bot",
            body: renderText(st.text, {
              lead,
              account,
              appointment: appt,
              material,
              advisor: nameOf(lead.assignedTo),
            }),
          })
          .select("id")
          .single();
        if (error || !msg) throw error ?? new Error("insert failed");
        await dispatchMessage({
          accountId: account.id,
          phone: lead.phone,
          source: lead.source,
          messageId: msg.id,
          text: renderText(st.text, {
            lead,
            account,
            appointment: appt,
            advisor: nameOf(lead.assignedTo),
          }),
          material,
        });
      } else if (st.type === "action") {
        const botBefore = lead.botActive;
        lead =
          st.action === "add_tag"
            ? applyTag(lead, st.value)
            : st.action === "remove_tag"
              ? removeTag(lead, st.value)
              : st.action === "bot_on" || st.action === "bot_off"
                ? { ...lead, botActive: st.action === "bot_on" }
                : moveToStage(lead, Number(st.value));
        const { error } = await sb.from("leads").update(leadPatch(lead)).eq("id", lead.id);
        if (error) throw error;
        if (botBefore !== lead.botActive)
          await event(
            "bot",
            lead.botActive ? "Bot encendido por un flujo" : "Bot apagado por un flujo",
          );
      } else if (st.type === "assign") {
        const { data: who, error } = await sb.rpc("assign_lead", {
          p_lead_id: lead.id,
          p_user_ids: st.userIds,
          p_round_robin: st.mode === "round_robin",
        });
        if (error) throw error;
        if (who) {
          lead = { ...lead, assignedTo: who };
          await event("asignacion", `Asignado a ${nameOf(who) ?? "un asesor"} por un flujo`);
        } else await event("asignacion", "Nadie del equipo estaba disponible para asignar");
      } else if (st.type === "notify") {
        const recipients = notifyRecipients(st.to, members, lead.assignedTo ?? null);
        if (recipients.length) {
          const { data: recent } = await sb
            .from("messages")
            .select("body")
            .eq("lead_id", lead.id)
            .eq("sender", "lead")
            .order("created_at", { ascending: false })
            .limit(3);
          const body = notifyBody(
            st.text,
            lead,
            account,
            nameOf(lead.assignedTo),
            (recent ?? []).map((m) => m.body).reverse(),
          );
          const { data: created, error } = await sb
            .from("notifications")
            .insert(
              recipients.map((r) => ({
                account_id: account.id,
                user_id: r.user_id,
                lead_id: lead.id,
                title: `Lead ${lead.name}`,
                body,
                wa_status: st.whatsapp ? "pendiente" : null,
              })),
            )
            .select("id, user_id");
          if (error) throw error;
          if (st.whatsapp)
            for (const n of created ?? []) {
              const phone = recipients.find((r) => r.user_id === n.user_id)?.whatsapp_phone ?? "";
              const status = await sendInternalWhatsApp(account.id, phone, body);
              await sb.from("notifications").update({ wa_status: status }).eq("id", n.id);
            }
          await event(
            "aviso",
            `Aviso a ${recipients.map((r) => r.display_name || "un asesor").join(", ")}`,
          );
        } else
          await event("aviso", "Aviso sin destinatarios (nadie asignado o sin administradores)");
      } else if (st.type === "condition") {
        const ok = evaluateCondition(st.rule, {
          lead,
          replied: cur.replied,
          advisorReplied: cur.advisor_replied,
          hasAppointment: appt !== undefined,
        });
        nodeId = branchStart(st, next, ok);
        await advance(nodeId);
        continue;
      } else if (st.type === "end") {
        nodeId = null;
        break;
      } else {
        const target = waitTarget(st, appt, now);
        if (target != null && !(force && n === 0 && st.type === "wait")) {
          await done({
            current_node: next ?? END_NODE,
            current_step: executed + 1,
            next_run_at: new Date(target).toISOString(),
          });
          return "ran";
        }
      }
      nodeId = next;
      await advance(nodeId);
    }
    if (nodeId) {
      // Quedan pasos sin esperas de por medio: seguir en el próximo tick.
      await done({ next_run_at: new Date().toISOString() });
      return "ran";
    }
    await done({ status: "completed", current_node: END_NODE });
    return "ran";
  } catch (e) {
    console.error("flow step failed", id, e);
    // Reintento en 5 minutos; no bloquear el resto de la cola.
    await done({ next_run_at: new Date(Date.now() + 300_000).toISOString() });
    return "ran";
  }
}

/** Cuentas con propietario. Una cuenta sin propietario no envía seguimientos: nadie podría ver esas conversaciones. */
async function ownedAccounts(sb: Sb, accountIds: string[]) {
  const ids = [...new Set(accountIds)];
  const { data: owners } = ids.length
    ? await sb
        .from("account_memberships")
        .select("account_id")
        .eq("role", "owner")
        .in("account_id", ids)
    : { data: [] as { account_id: string }[] };
  return new Set((owners ?? []).map((o) => o.account_id));
}

/** Procesa un lote acotado de pasos vencidos. */
export async function processDue(sb: Sb, limit = 50) {
  const { data } = await sb
    .from("flow_enrollments")
    .select("id, account_id")
    .eq("status", "active")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at")
    .limit(limit);
  const owned = await ownedAccounts(
    sb,
    (data ?? []).map((r) => r.account_id),
  );
  let ran = 0;
  for (const r of data ?? []) {
    if (!owned.has(r.account_id)) continue;
    if ((await runEnrollment(sb, r.id)) === "ran") ran++;
  }
  return { due: data?.length ?? 0, ran };
}

/**
 * Corre ya los flujos que un mensaje del lead acaba de disparar, sin esperar al cron:
 * en WhatsApp la respuesta vale en el momento en que el lead escribe.
 */
export async function runDueForLead(sb: Sb, leadId: string) {
  const { data } = await sb
    .from("flow_enrollments")
    .select("id, account_id")
    .eq("lead_id", leadId)
    .eq("status", "active")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at")
    .limit(10);
  const owned = await ownedAccounts(
    sb,
    (data ?? []).map((r) => r.account_id),
  );
  let ran = 0;
  for (const r of data ?? []) {
    if (!owned.has(r.account_id)) continue;
    if ((await runEnrollment(sb, r.id)) === "ran") ran++;
  }
  return ran;
}
