import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Account, Appointment, Lead, Message } from "./types";
import { applyTag, moveToStage, removeTag } from "./automation";
import { matchTriggers, renderText, waitMs, type Enrollment, type Flow, type FlowStep, type Material } from "./flows";
import { leadPatch, toAccount, toAppointment, toEnrollment, toFlow, toLead, toMessage } from "./db";
import type { Json } from "@/integrations/supabase/types";

interface State {
  accounts: Account[];
  leads: Lead[];
  appointments: Appointment[];
  flows: Flow[];
  enrollments: Enrollment[];
  materials: Material[];
}

interface Ctx {
  loading: boolean;
  accounts: Account[];
  account: Account;
  setAccount: (id: string) => void;
  updateAccount: (id: string, patch: Partial<Account>) => Promise<void>;
  leads: Lead[];
  appointments: Appointment[];
  getLead: (id: string) => Lead | undefined;
  updateLead: (id: string, fn: (l: Lead) => Lead) => void;
  addMessage: (leadId: string, from: Message["from"], text: string) => Promise<void>;
  createLead: (l: Omit<Lead, "id" | "messages" | "createdAt">) => Promise<Lead | null>;
  addAppointment: (a: Omit<Appointment, "id">) => Promise<void>;
  updateAppointment: (id: string, patch: Partial<Appointment>) => void;
  reload: () => Promise<void>;
  createAccount: (a: Account) => Promise<boolean>;
  flows: Flow[];
  enrollments: Enrollment[];
  materials: Material[];
  saveFlow: (f: Flow, isNew?: boolean) => Promise<boolean>;
  deleteFlow: (id: string) => Promise<void>;
  enroll: (flowId: string, leadId: string) => Promise<void>;
  cancelEnrollment: (id: string, reason: string) => Promise<void>;
  runEnrollment: (id: string, force?: boolean) => Promise<void>;
  addMaterial: (m: Omit<Material, "id">) => Promise<void>;
  deleteMaterial: (id: string) => Promise<void>;
  importLeads: (rows: { name: string; phone: string; budget: number | null; tag: string | null }[]) => Promise<number>;
}

const CrmContext = createContext<Ctx | null>(null);
const ACTIVE_KEY = "crm-active-account";

const fail = (what: string, e: { message: string } | null) => {
  if (e) {
    console.error(what, e);
    toast.error(`No se pudo ${what}`);
  }
};

const PLACEHOLDER: Account = { id: "", name: "Cargando…", initials: "··", tagline: "", brand: "oklch(0.5 0.02 260)", brandForeground: "oklch(0.98 0 0)", product: "", ticketLabel: "", setterPrompt: "", qualificationRules: "", aiModel: "", template: "", standardTags: [] };

export function CrmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ accounts: [], leads: [], appointments: [], flows: [], enrollments: [], materials: [] });
  const [activeId, setActiveId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const apiRef = useRef<Ctx | null>(null);
  const runRef = useRef<(id: string, force?: boolean) => Promise<void>>(async () => {});
  const stateRef = useRef(state);
  stateRef.current = state;

  const reload = useCallback(async () => {
    const [a, l, m, ap, fl, en, ma] = await Promise.all([
      supabase.from("accounts").select("*").order("created_at"),
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("messages").select("*").order("created_at").limit(5000),
      supabase.from("appointments").select("*").order("at"),
      supabase.from("flows").select("*").order("created_at"),
      supabase.from("flow_enrollments").select("*").order("created_at", { ascending: false }).limit(5000),
      supabase.from("materials").select("*").order("created_at"),
    ]);
    const err = a.error || l.error || m.error || ap.error || fl.error || en.error || ma.error;
    if (err) return fail("cargar los datos", err);
    const byLead = new Map<string, Message[]>();
    for (const r of m.data ?? []) {
      const arr = byLead.get(r.lead_id) ?? [];
      arr.push(toMessage(r));
      byLead.set(r.lead_id, arr);
    }
    setState({
      accounts: (a.data ?? []).map(toAccount),
      leads: (l.data ?? []).map((r) => toLead(r, byLead.get(r.id) ?? [])),
      appointments: (ap.data ?? []).map(toAppointment),
      flows: (fl.data ?? []).map(toFlow),
      enrollments: (en.data ?? []).map(toEnrollment),
      materials: (ma.data ?? []).map((r) => ({ id: r.id, accountId: r.account_id, name: r.name, kind: r.kind as Material["kind"], url: r.url })),
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    setActiveId(localStorage.getItem(ACTIVE_KEY) ?? "");
    void reload();
  }, [reload]);

  const value = useMemo<Ctx>(() => {
    const account = state.accounts.find((a) => a.id === activeId) ?? state.accounts[0] ?? PLACEHOLDER;
    return {
      loading,
      accounts: state.accounts,
      account,
      setAccount: (id) => {
        localStorage.setItem(ACTIVE_KEY, id);
        setActiveId(id);
      },
      updateAccount: async (id, patch) => {
        const cur = stateRef.current.accounts.find((a) => a.id === id);
        if (!cur) return;
        const next = { ...cur, ...patch };
        setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? next : a)) }));
        const { error } = await supabase.from("accounts").update({
          name: next.name, initials: next.initials, tagline: next.tagline, brand: next.brand,
          brand_foreground: next.brandForeground, product: next.product, ticket_label: next.ticketLabel,
          setter_prompt: next.setterPrompt, qualification_rules: next.qualificationRules, ai_model: next.aiModel,
        }).eq("id", id);
        fail("guardar la subcuenta", error);
      },
      leads: state.leads.filter((l) => l.accountId === account.id),
      appointments: state.appointments.filter((a) => a.accountId === account.id),
      getLead: (id) => state.leads.find((l) => l.id === id),
      updateLead: (id, fn) => {
        const cur = stateRef.current.leads.find((l) => l.id === id);
        if (!cur) return;
        const next = fn(cur);
        setState((s) => ({ ...s, leads: s.leads.map((l) => (l.id === id ? next : l)) }));
        void supabase.from("leads").update(leadPatch(next)).eq("id", id).then(({ error }) => fail("guardar el lead", error));
      },
      addMessage: async (leadId, from, text) => {
        const { data, error } = await supabase.from("messages").insert({ lead_id: leadId, sender: from, body: text }).select().single();
        if (error || !data) return fail("enviar el mensaje", error);
        setState((s) => ({ ...s, leads: s.leads.map((l) => (l.id === leadId ? { ...l, messages: [...l.messages, toMessage(data)] } : l)) }));
      },
      createLead: async (l) => {
        const { data, error } = await supabase.from("leads").insert({ account_id: l.accountId, ...leadPatch({ ...l, id: "", messages: [], createdAt: "" }) }).select().single();
        if (error || !data) {
          fail("crear el lead", error);
          return null;
        }
        const lead = toLead(data, []);
        setState((s) => ({ ...s, leads: [lead, ...s.leads] }));
        return lead;
      },
      addAppointment: async (a) => {
        const { data, error } = await supabase.from("appointments").insert({ account_id: a.accountId, lead_id: a.leadId, at: a.at, kind: a.kind, status: a.status }).select().single();
        if (error || !data) return fail("crear la cita", error);
        setState((s) => ({ ...s, appointments: [...s.appointments, toAppointment(data)] }));
      },
      updateAppointment: (id, patch) => {
        setState((s) => ({ ...s, appointments: s.appointments.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
        void supabase.from("appointments").update({ ...(patch.status ? { status: patch.status } : {}), ...(patch.at ? { at: patch.at } : {}) }).eq("id", id).then(({ error }) => fail("actualizar la cita", error));
      },
      reload,
      flows: state.flows.filter((f) => f.accountId === account.id),
      enrollments: state.enrollments.filter((e) => e.accountId === account.id),
      materials: state.materials.filter((m) => m.accountId === account.id),
      saveFlow: async (f, isNew) => {
        const row = { account_id: f.accountId, name: f.name, active: f.active, trigger_type: f.triggerType, trigger_value: f.triggerValue, steps: f.steps as unknown as Json, stop_on_reply: f.stopOnReply };
        if (isNew) {
          const { data, error } = await supabase.from("flows").insert(row).select().single();
          if (error || !data) { fail("crear el flujo", error); return false; }
          setState((s) => ({ ...s, flows: [...s.flows, toFlow(data)] }));
          return true;
        }
        setState((s) => ({ ...s, flows: s.flows.map((x) => (x.id === f.id ? f : x)) }));
        const { error } = await supabase.from("flows").update(row).eq("id", f.id);
        fail("guardar el flujo", error);
        return !error;
      },
      deleteFlow: async (id) => {
        setState((s) => ({ ...s, flows: s.flows.filter((f) => f.id !== id), enrollments: s.enrollments.filter((e) => e.flowId !== id) }));
        fail("eliminar el flujo", (await supabase.from("flows").delete().eq("id", id)).error);
      },
      enroll: async (flowId, leadId) => {
        const lead = stateRef.current.leads.find((l) => l.id === leadId);
        if (!lead) return;
        const { data, error } = await supabase.from("flow_enrollments").insert({ flow_id: flowId, lead_id: leadId, account_id: lead.accountId }).select().single();
        if (error || !data) return; // ya inscrito (índice único) u otro error
        const enr = toEnrollment(data);
        stateRef.current = { ...stateRef.current, enrollments: [enr, ...stateRef.current.enrollments] };
        setState((s) => ({ ...s, enrollments: [enr, ...s.enrollments] }));
        await runRef.current(enr.id);
      },
      cancelEnrollment: async (id, reason) => {
        setState((s) => ({ ...s, enrollments: s.enrollments.map((e) => (e.id === id ? { ...e, status: "cancelled", cancelReason: reason } : e)) }));
        fail("cancelar el flujo", (await supabase.from("flow_enrollments").update({ status: "cancelled", cancel_reason: reason }).eq("id", id)).error);
      },
      runEnrollment: (id, force) => runRef.current(id, force),
      addMaterial: async (m) => {
        const { data, error } = await supabase.from("materials").insert({ account_id: m.accountId, name: m.name, kind: m.kind, url: m.url }).select().single();
        if (error || !data) return fail("guardar el material", error);
        setState((s) => ({ ...s, materials: [...s.materials, { ...m, id: data.id }] }));
      },
      deleteMaterial: async (id) => {
        setState((s) => ({ ...s, materials: s.materials.filter((m) => m.id !== id) }));
        fail("eliminar el material", (await supabase.from("materials").delete().eq("id", id)).error);
      },
      createAccount: async (a) => {
        const { error } = await supabase.from("accounts").insert({
          id: a.id, name: a.name, initials: a.initials, tagline: a.tagline, brand: a.brand, brand_foreground: a.brandForeground,
          product: a.product, ticket_label: a.ticketLabel, setter_prompt: a.setterPrompt, qualification_rules: a.qualificationRules,
          ai_model: a.aiModel, template: a.template, standard_tags: a.standardTags,
        });
        if (error) { fail("crear la subcuenta", error); return false; }
        setState((s) => ({ ...s, accounts: [...s.accounts, a] }));
        localStorage.setItem(ACTIVE_KEY, a.id);
        setActiveId(a.id);
        return true;
      },
      importLeads: async (rows) => {
        const base = { id: "", accountId: account.id, name: "", phone: "", source: "Importación CSV", stage: 0, outcome: null, budget: null, downPayment: null, termMonths: null, intent: null, tags: [] as string[], notes: "", botActive: true, messages: [], createdAt: "" };
        const payload = rows.map((r) => {
          let l: Lead = { ...base, name: r.name.slice(0, 120), phone: r.phone.slice(0, 40), budget: r.budget };
          if (r.tag) l = applyTag(l, r.tag.slice(0, 40));
          return { account_id: account.id, ...leadPatch(l) };
        });
        let n = 0;
        for (let i = 0; i < payload.length; i += 500) {
          const { data, error } = await supabase.from("leads").insert(payload.slice(i, i + 500)).select();
          if (error) { fail("importar los leads", error); break; }
          n += data?.length ?? 0;
        }
        await reload();
        return n;
      },
    };
  }, [state, activeId, loading, reload]);
  apiRef.current = value;

  /* ---------- Motor de flujos ---------- */
  const running = useRef(new Set<string>());
  const patchEnr = async (id: string, patch: Partial<Enrollment>) => {
    setState((s) => ({ ...s, enrollments: s.enrollments.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    const row: { status?: string; current_step?: number; next_run_at?: string; replied?: boolean; cancel_reason?: string | null } = {};
    if (patch.status) row.status = patch.status;
    if (patch.currentStep !== undefined) row.current_step = patch.currentStep;
    if (patch.nextRunAt) row.next_run_at = patch.nextRunAt;
    if (patch.replied !== undefined) row.replied = patch.replied;
    if (patch.cancelReason !== undefined) row.cancel_reason = patch.cancelReason;
    await supabase.from("flow_enrollments").update(row).eq("id", id);
  };

  runRef.current = async (id, force) => {
    if (running.current.has(id)) return;
    const s0 = stateRef.current;
    const enr = s0.enrollments.find((e) => e.id === id);
    if (!enr || enr.status !== "active") return;
    if (!force && new Date(enr.nextRunAt).getTime() > Date.now()) return;
    const flow = s0.flows.find((f) => f.id === enr.flowId);
    if (!flow) return void patchEnr(id, { status: "cancelled", cancelReason: "Flujo eliminado" });
    running.current.add(id);
    try {
      const api = apiRef.current!;
      for (let i = enr.currentStep; i < flow.steps.length; i++) {
        const st: FlowStep = flow.steps[i]!;
        const lead = stateRef.current.leads.find((l) => l.id === enr.leadId);
        const cur = stateRef.current.enrollments.find((e) => e.id === id);
        if (!lead || cur?.status !== "active") return;
        const appt = stateRef.current.appointments.filter((a) => a.leadId === lead.id && a.status === "programada" && new Date(a.at).getTime() > Date.now()).sort((a, b) => a.at.localeCompare(b.at))[0];
        const account = stateRef.current.accounts.find((a) => a.id === lead.accountId)!;
        if (st.type === "message") {
          const material = stateRef.current.materials.find((m) => m.id === st.materialId);
          await api.addMessage(lead.id, "bot", renderText(st.text, { lead, account, appointment: appt, material }));
        } else if (st.type === "action") {
          api.updateLead(lead.id, (l) => (st.action === "add_tag" ? applyTag(l, st.value) : st.action === "remove_tag" ? removeTag(l, st.value) : moveToStage(l, Number(st.value))));
        } else {
          let target = Date.now() + waitMs(st.amount, st.unit);
          if (st.type === "wait_appt") {
            if (!appt) continue;
            target = new Date(appt.at).getTime() - waitMs(st.amount, st.unit);
            if (target <= Date.now()) continue;
          }
          if (force && i === enr.currentStep && st.type === "wait") continue; // "ejecutar ahora" salta la espera actual
          return void (await patchEnr(id, { currentStep: i + 1, nextRunAt: new Date(target).toISOString() }));
        }
      }
      await patchEnr(id, { status: "completed", currentStep: flow.steps.length });
    } finally {
      running.current.delete(id);
    }
  };

  // Disparadores + regla anti-spam: compara cada lead con su última foto.
  const snap = useRef<Map<string, { stage: number; tags: string[]; msgs: number }> | null>(null);
  useEffect(() => {
    if (loading) return;
    const cur = new Map(state.leads.map((l) => [l.id, { stage: l.stage, tags: l.tags, msgs: l.messages.length }]));
    const prevSnap = snap.current;
    snap.current = cur;
    if (!prevSnap) return;
    const api = apiRef.current!;
    for (const l of state.leads) {
      const prev = prevSnap.get(l.id);
      for (const f of matchTriggers(state.flows, prev, l)) void api.enroll(f.id, l.id);
      if (!prev) continue;
      const fresh = l.messages.slice(prev.msgs).filter((m) => m.from !== "bot");
      if (!fresh.length) continue;
      const who = fresh.some((m) => m.from === "asesor") ? "Intervino un asesor" : "Respondió el prospecto";
      for (const e of state.enrollments) {
        if (e.leadId !== l.id || e.status !== "active") continue;
        const flow = state.flows.find((f) => f.id === e.flowId);
        if (flow?.stopOnReply) {
          void patchEnr(e.id, { replied: true, status: "cancelled", cancelReason: who });
          toast(`Flujo «${flow.name}» cancelado: ${who.toLowerCase()}`);
        } else if (!e.replied) void patchEnr(e.id, { replied: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.leads, loading]);

  useEffect(() => {
    const t = setInterval(() => {
      for (const e of stateRef.current.enrollments) if (e.status === "active" && new Date(e.nextRunAt).getTime() <= Date.now()) void runRef.current(e.id);
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm() {
  const c = useContext(CrmContext);
  if (!c) throw new Error("useCrm fuera de CrmProvider");
  return c;
}

export const money = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toLocaleString("es-MX"));
export const termLabel = (m: number | null) => (m == null ? "—" : m === 0 ? "Contado" : `${m} meses`);
