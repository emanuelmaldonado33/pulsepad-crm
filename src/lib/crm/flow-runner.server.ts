import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { applyTag, moveToStage, removeTag } from "./automation";
import { leadPatch, toAccount, toAppointment, toFlow, toLead } from "./db";
import { renderText, waitMs, type FlowStep, type Material } from "./flows";

type Sb = SupabaseClient<Database>;
const MAX_STEPS = 20;

/** Ejecuta un enrollment hasta la siguiente espera. Reclama un candado para evitar dobles envíos. */
export async function runEnrollment(sb: Sb, id: string, force = false): Promise<"ran" | "skipped"> {
  const now = new Date();
  let claim = sb.from("flow_enrollments")
    .update({ locked_until: new Date(now.getTime() + 120_000).toISOString() })
    .eq("id", id).eq("status", "active")
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`);
  if (!force) claim = claim.lte("next_run_at", now.toISOString());
  const { data: enr } = await claim.select().maybeSingle();
  if (!enr) return "skipped";

  const done = (patch: Database["public"]["Tables"]["flow_enrollments"]["Update"]) =>
    sb.from("flow_enrollments").update({ ...patch, locked_until: null }).eq("id", id);

  try {
    const [{ data: fr }, { data: lr }, { data: ar }, { data: apr }, { data: mr }] = await Promise.all([
      sb.from("flows").select("*").eq("id", enr.flow_id).maybeSingle(),
      sb.from("leads").select("*").eq("id", enr.lead_id).maybeSingle(),
      sb.from("accounts").select("*").eq("id", enr.account_id).maybeSingle(),
      sb.from("appointments").select("*").eq("lead_id", enr.lead_id).eq("status", "programada").gt("at", now.toISOString()).order("at").limit(1),
      sb.from("materials").select("*").eq("account_id", enr.account_id),
    ]);
    if (!fr || !lr || !ar) { await done({ status: "cancelled", cancel_reason: "Flujo o lead eliminado" }); return "ran"; }
    const flow = toFlow(fr);
    const account = toAccount(ar);
    let lead = toLead(lr, []);
    const appt = apr?.[0] ? toAppointment(apr[0]) : undefined;
    const materials: Material[] = (mr ?? []).map((m) => ({ id: m.id, accountId: m.account_id, name: m.name, kind: m.kind as Material["kind"], url: m.url }));

    for (let i = enr.current_step, n = 0; i < flow.steps.length && n < MAX_STEPS; i++, n++) {
      const st: FlowStep = flow.steps[i]!;
      // Anti-spam: si un trigger lo canceló mientras corría, parar.
      const { data: cur } = await sb.from("flow_enrollments").select("status").eq("id", id).single();
      if (cur?.status !== "active") return "ran";
      if (st.type === "message") {
        const material = materials.find((m) => m.id === st.materialId);
        const { error } = await sb.from("messages").insert({ lead_id: lead.id, sender: "bot", body: renderText(st.text, { lead, account, appointment: appt, material }) });
        if (error) throw error;
      } else if (st.type === "action") {
        lead = st.action === "add_tag" ? applyTag(lead, st.value) : st.action === "remove_tag" ? removeTag(lead, st.value) : moveToStage(lead, Number(st.value));
        const { error } = await sb.from("leads").update(leadPatch(lead)).eq("id", lead.id);
        if (error) throw error;
      } else {
        if (force && i === enr.current_step && st.type === "wait") continue;
        let target = now.getTime() + waitMs(st.amount, st.unit);
        if (st.type === "wait_appt") {
          if (!appt) continue;
          target = new Date(appt.at).getTime() - waitMs(st.amount, st.unit);
          if (target <= Date.now()) continue;
        }
        await done({ current_step: i + 1, next_run_at: new Date(target).toISOString() });
        return "ran";
      }
      await sb.from("flow_enrollments").update({ current_step: i + 1 }).eq("id", id);
    }
    await done({ status: "completed", current_step: flow.steps.length });
    return "ran";
  } catch (e) {
    console.error("flow step failed", id, e);
    // Reintento en 5 minutos; no bloquear el resto de la cola.
    await done({ next_run_at: new Date(Date.now() + 300_000).toISOString() });
    return "ran";
  }
}

/** Procesa un lote acotado de pasos vencidos. */
export async function processDue(sb: Sb, limit = 50) {
  const { data } = await sb.from("flow_enrollments").select("id").eq("status", "active")
    .lte("next_run_at", new Date().toISOString()).order("next_run_at").limit(limit);
  let ran = 0;
  for (const r of data ?? []) if ((await runEnrollment(sb, r.id)) === "ran") ran++;
  return { due: data?.length ?? 0, ran };
}
