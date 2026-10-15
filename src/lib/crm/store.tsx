import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Account, Appointment, Lead, Message } from "./types";
import { leadPatch, toAccount, toAppointment, toLead, toMessage } from "./db";

interface State {
  accounts: Account[];
  leads: Lead[];
  appointments: Appointment[];
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
}

const CrmContext = createContext<Ctx | null>(null);
const ACTIVE_KEY = "crm-active-account";

const fail = (what: string, e: { message: string } | null) => {
  if (e) {
    console.error(what, e);
    toast.error(`No se pudo ${what}`);
  }
};

const PLACEHOLDER: Account = { id: "", name: "Cargando…", initials: "··", tagline: "", brand: "oklch(0.5 0.02 260)", brandForeground: "oklch(0.98 0 0)", product: "", ticketLabel: "", setterPrompt: "", qualificationRules: "", aiModel: "" };

export function CrmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ accounts: [], leads: [], appointments: [] });
  const [activeId, setActiveId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const stateRef = useRef(state);
  stateRef.current = state;

  const reload = useCallback(async () => {
    const [a, l, m, ap] = await Promise.all([
      supabase.from("accounts").select("*").order("created_at"),
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("messages").select("*").order("created_at").limit(5000),
      supabase.from("appointments").select("*").order("at"),
    ]);
    const err = a.error || l.error || m.error || ap.error;
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
    };
  }, [state, activeId, loading, reload]);

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm() {
  const c = useContext(CrmContext);
  if (!c) throw new Error("useCrm fuera de CrmProvider");
  return c;
}

export const money = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toLocaleString("es-MX"));
export const termLabel = (m: number | null) => (m == null ? "—" : m === 0 ? "Contado" : `${m} meses`);
