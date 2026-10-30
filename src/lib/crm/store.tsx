import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Account, AppNotification, Appointment, Lead, Member, Message } from "./types";
import { applyTag } from "./automation";
import type { Enrollment, Flow, Material, WaTemplate } from "./flows";
import { useServerFn } from "@tanstack/react-start";
import { runFlowNow } from "./flows.functions";
import {
  leadPatch,
  toAccount,
  toAppointment,
  toEnrollment,
  toFlow,
  toLead,
  toMember,
  toMessage,
} from "./db";
import type { Json } from "@/integrations/supabase/types";

interface State {
  accounts: Account[];
  leads: Lead[];
  appointments: Appointment[];
  flows: Flow[];
  enrollments: Enrollment[];
  materials: Material[];
  members: Member[];
  notifications: AppNotification[];
  templates: (WaTemplate & { accountId: string })[];
  me: string | null;
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
  uploadMaterial: (file: File, name: string) => Promise<boolean>;
  importLeads: (
    rows: { name: string; phone: string; budget: number | null; tag: string | null }[],
  ) => Promise<number>;
  /** Equipo de la subcuenta activa. */
  members: Member[];
  /** user_id de quien tiene la sesión abierta. */
  me: string | null;
  /** Avisos de quien tiene la sesión, de todas sus subcuentas. */
  notifications: AppNotification[];
  markNotificationsRead: (ids: string[]) => Promise<void>;
  updateMember: (
    userId: string,
    patch: Partial<Pick<Member, "name" | "whatsappPhone" | "available">>,
  ) => Promise<void>;
  assignLead: (leadId: string, userId: string | null) => Promise<void>;
  /** Plantillas de WhatsApp aprobadas de la subcuenta activa (se sincronizan desde Meta). */
  templates: WaTemplate[];
  /** Dar de baja (sale de todos los flujos, bot apagado) o quitar la baja. */
  setOptOut: (leadId: string, on: boolean) => Promise<void>;
}

const CrmContext = createContext<Ctx | null>(null);
const ACTIVE_KEY = "crm-active-account";

const fail = (what: string, e: { message: string } | null) => {
  if (e) {
    console.error(what, e);
    toast.error(`No se pudo ${what}`);
  }
};

const PLACEHOLDER: Account = {
  id: "",
  name: "Cargando…",
  initials: "··",
  tagline: "",
  brand: "oklch(0.5 0.02 260)",
  brandForeground: "oklch(0.98 0 0)",
  product: "",
  ticketLabel: "",
  setterPrompt: "",
  qualificationRules: "",
  aiModel: "",
  template: "",
  standardTags: [],
};

export function CrmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({
    accounts: [],
    leads: [],
    appointments: [],
    flows: [],
    enrollments: [],
    materials: [],
    members: [],
    notifications: [],
    templates: [],
    me: null,
  });
  const [activeId, setActiveId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const apiRef = useRef<Ctx | null>(null);
  const runNow = useServerFn(runFlowNow);
  const runRef = useRef<(id: string, force: boolean) => Promise<void>>(async () => {});
  runRef.current = async (id, force) => {
    try {
      await runNow({ data: { id, force } });
    } catch (e) {
      console.error(e);
      toast.error("No se pudo ejecutar el flujo");
    }
    await reload();
  };
  const stateRef = useRef(state);
  stateRef.current = state;

  const reload = useCallback(async () => {
    const [a, l, m, ap, fl, en, ma, mb, no, wt, se] = await Promise.all([
      supabase.from("accounts").select("*").order("created_at"),
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("messages").select("*").order("created_at").limit(5000),
      supabase.from("appointments").select("*").order("at"),
      supabase.from("flows").select("*").order("created_at"),
      supabase
        .from("flow_enrollments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase.from("materials").select("*").order("created_at"),
      supabase.from("account_memberships").select("*").order("created_at"),
      supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("whatsapp_templates").select("*").order("name"),
      supabase.auth.getSession(),
    ]);
    const err =
      a.error || l.error || m.error || ap.error || fl.error || en.error || ma.error || mb.error;
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
      materials: (ma.data ?? []).map((r) => ({
        id: r.id,
        accountId: r.account_id,
        name: r.name,
        kind: r.kind as Material["kind"],
        url: r.url,
        storagePath: r.storage_path,
      })),
      members: (mb.data ?? []).map(toMember),
      // Si la migración 0013 aún no está aplicada, la bandeja de avisos queda vacía.
      notifications: (no.data ?? []).map((r) => ({
        id: r.id,
        accountId: r.account_id,
        leadId: r.lead_id,
        title: r.title,
        body: r.body,
        waStatus: r.wa_status,
        readAt: r.read_at,
        createdAt: r.created_at,
      })),
      // Sin la migración 0014 no hay plantillas: los pasos simplemente no las ofrecen.
      templates: (wt.data ?? []).map((r) => ({
        accountId: r.account_id,
        name: r.name,
        language: r.language,
        category: r.category,
        body: r.body,
        headerFormat: r.header_format as WaTemplate["headerFormat"],
        params: r.params ?? [],
      })),
      me: se.data.session?.user.id ?? null,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    setActiveId(localStorage.getItem(ACTIVE_KEY) ?? "");
    void reload();
  }, [reload]);

  const value = useMemo<Ctx>(() => {
    const account =
      state.accounts.find((a) => a.id === activeId) ?? state.accounts[0] ?? PLACEHOLDER;
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
        const { error } = await supabase
          .from("accounts")
          .update({
            name: next.name,
            initials: next.initials,
            tagline: next.tagline,
            brand: next.brand,
            brand_foreground: next.brandForeground,
            product: next.product,
            ticket_label: next.ticketLabel,
            setter_prompt: next.setterPrompt,
            qualification_rules: next.qualificationRules,
            ai_model: next.aiModel,
            auto_pause_bot: next.autoPauseBot ?? true,
            ...(patch.businessHours
              ? { business_hours: patch.businessHours as unknown as Json }
              : {}),
          })
          .eq("id", id);
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
        void supabase
          .from("leads")
          .update(leadPatch(next))
          .eq("id", id)
          .then(({ error }) => fail("guardar el lead", error));
      },
      addMessage: async (leadId, from, text) => {
        const { data, error } = await supabase
          .from("messages")
          .insert({ lead_id: leadId, sender: from, body: text })
          .select()
          .single();
        if (error || !data) return fail("enviar el mensaje", error);
        setState((s) => ({
          ...s,
          leads: s.leads.map((l) =>
            l.id === leadId ? { ...l, messages: [...l.messages, toMessage(data)] } : l,
          ),
        }));
      },
      createLead: async (l) => {
        const { data, error } = await supabase
          .from("leads")
          .insert({
            account_id: l.accountId,
            ...leadPatch({ ...l, id: "", messages: [], createdAt: "" }),
          })
          .select()
          .single();
        if (error || !data) {
          fail("crear el lead", error);
          return null;
        }
        const lead = toLead(data, []);
        setState((s) => ({ ...s, leads: [lead, ...s.leads] }));
        return lead;
      },
      addAppointment: async (a) => {
        const { data, error } = await supabase
          .from("appointments")
          .insert({
            account_id: a.accountId,
            lead_id: a.leadId,
            at: a.at,
            kind: a.kind,
            status: a.status,
          })
          .select()
          .single();
        if (error || !data) return fail("crear la cita", error);
        setState((s) => ({ ...s, appointments: [...s.appointments, toAppointment(data)] }));
      },
      updateAppointment: (id, patch) => {
        setState((s) => ({
          ...s,
          appointments: s.appointments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }));
        void supabase
          .from("appointments")
          .update({
            ...(patch.status ? { status: patch.status } : {}),
            ...(patch.at ? { at: patch.at } : {}),
          })
          .eq("id", id)
          .then(({ error }) => fail("actualizar la cita", error));
      },
      reload,
      flows: state.flows.filter((f) => f.accountId === account.id),
      enrollments: state.enrollments.filter((e) => e.accountId === account.id),
      materials: state.materials.filter((m) => m.accountId === account.id),
      saveFlow: async (f, isNew) => {
        const row = {
          account_id: f.accountId,
          name: f.name,
          active: f.active,
          trigger_type: f.triggerType,
          trigger_value: f.triggerValue,
          trigger_config: f.triggerConfig as unknown as Json,
          allow_reentry: f.allowReentry,
          steps: f.steps as unknown as Json,
          stop_on_reply: f.stopOnReply,
        };
        if (isNew) {
          const { data, error } = await supabase.from("flows").insert(row).select().single();
          if (error || !data) {
            fail("crear el flujo", error);
            return false;
          }
          setState((s) => ({ ...s, flows: [...s.flows, toFlow(data)] }));
          return true;
        }
        setState((s) => ({ ...s, flows: s.flows.map((x) => (x.id === f.id ? f : x)) }));
        const { error } = await supabase.from("flows").update(row).eq("id", f.id);
        fail("guardar el flujo", error);
        return !error;
      },
      deleteFlow: async (id) => {
        setState((s) => ({
          ...s,
          flows: s.flows.filter((f) => f.id !== id),
          enrollments: s.enrollments.filter((e) => e.flowId !== id),
        }));
        fail("eliminar el flujo", (await supabase.from("flows").delete().eq("id", id)).error);
      },
      enroll: async (flowId, leadId) => {
        const lead = stateRef.current.leads.find((l) => l.id === leadId);
        if (!lead) return;
        const { data, error } = await supabase
          .from("flow_enrollments")
          .insert({ flow_id: flowId, lead_id: leadId, account_id: lead.accountId })
          .select()
          .single();
        if (error || !data) return; // ya inscrito (índice único) u otro error
        const enr = toEnrollment(data);
        stateRef.current = {
          ...stateRef.current,
          enrollments: [enr, ...stateRef.current.enrollments],
        };
        setState((s) => ({ ...s, enrollments: [enr, ...s.enrollments] }));
        await runRef.current(enr.id, false);
      },
      cancelEnrollment: async (id, reason) => {
        setState((s) => ({
          ...s,
          enrollments: s.enrollments.map((e) =>
            e.id === id ? { ...e, status: "cancelled", cancelReason: reason } : e,
          ),
        }));
        fail(
          "cancelar el flujo",
          (
            await supabase
              .from("flow_enrollments")
              .update({ status: "cancelled", cancel_reason: reason })
              .eq("id", id)
          ).error,
        );
      },
      runEnrollment: (id, force) => runRef.current(id, !!force),
      addMaterial: async (m) => {
        const { data, error } = await supabase
          .from("materials")
          .insert({ account_id: m.accountId, name: m.name, kind: m.kind, url: m.url })
          .select()
          .single();
        if (error || !data) return fail("guardar el material", error);
        setState((s) => ({ ...s, materials: [...s.materials, { ...m, id: data.id }] }));
      },
      uploadMaterial: async (file, name) => {
        const kind: Material["kind"] =
          file.type === "application/pdf"
            ? "pdf"
            : file.type.startsWith("image/")
              ? "image"
              : file.type.startsWith("video/")
                ? "video"
                : file.type.startsWith("audio/")
                  ? "audio"
                  : "pdf";
        const path = `${account.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
        const up = await supabase.storage
          .from("materials")
          .upload(path, file, file.type ? { contentType: file.type } : {});
        if (up.error) {
          fail("subir el archivo", up.error);
          return false;
        }
        const sig = await supabase.storage
          .from("materials")
          .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
        if (sig.error || !sig.data) {
          fail("generar el enlace", sig.error);
          return false;
        }
        const { data, error } = await supabase
          .from("materials")
          .insert({
            account_id: account.id,
            name,
            kind,
            url: sig.data.signedUrl,
            storage_path: path,
          })
          .select()
          .single();
        if (error || !data) {
          fail("guardar el material", error);
          return false;
        }
        setState((s) => ({
          ...s,
          materials: [
            ...s.materials,
            { id: data.id, accountId: account.id, name, kind, url: data.url, storagePath: path },
          ],
        }));
        return true;
      },
      deleteMaterial: async (id) => {
        const m = stateRef.current.materials.find((x) => x.id === id);
        if (m?.storagePath) await supabase.storage.from("materials").remove([m.storagePath]);
        setState((s) => ({ ...s, materials: s.materials.filter((m) => m.id !== id) }));
        fail(
          "eliminar el material",
          (await supabase.from("materials").delete().eq("id", id)).error,
        );
      },
      createAccount: async (a) => {
        const { error } = await supabase.from("accounts").insert({
          id: a.id,
          name: a.name,
          initials: a.initials,
          tagline: a.tagline,
          brand: a.brand,
          brand_foreground: a.brandForeground,
          product: a.product,
          ticket_label: a.ticketLabel,
          setter_prompt: a.setterPrompt,
          qualification_rules: a.qualificationRules,
          ai_model: a.aiModel,
          template: a.template,
          standard_tags: a.standardTags,
        });
        if (error) {
          fail("crear la subcuenta", error);
          return false;
        }
        setState((s) => ({ ...s, accounts: [...s.accounts, a] }));
        localStorage.setItem(ACTIVE_KEY, a.id);
        setActiveId(a.id);
        return true;
      },
      importLeads: async (rows) => {
        const base = {
          id: "",
          accountId: account.id,
          name: "",
          phone: "",
          source: "Importación CSV",
          stage: 0,
          outcome: null,
          budget: null,
          downPayment: null,
          termMonths: null,
          intent: null,
          tags: [] as string[],
          notes: "",
          botActive: true,
          messages: [],
          createdAt: "",
        };
        const payload = rows.map((r) => {
          let l: Lead = {
            ...base,
            name: r.name.slice(0, 120),
            phone: r.phone.slice(0, 40),
            budget: r.budget,
          };
          if (r.tag) l = applyTag(l, r.tag.slice(0, 40));
          return { account_id: account.id, ...leadPatch(l) };
        });
        let n = 0;
        for (let i = 0; i < payload.length; i += 500) {
          const { data, error } = await supabase
            .from("leads")
            .insert(payload.slice(i, i + 500))
            .select();
          if (error) {
            fail("importar los leads", error);
            break;
          }
          n += data?.length ?? 0;
        }
        await reload();
        return n;
      },
      members: state.members.filter((m) => m.accountId === account.id),
      me: state.me,
      notifications: state.notifications,
      markNotificationsRead: async (ids) => {
        if (!ids.length) return;
        const at = new Date().toISOString();
        setState((s) => ({
          ...s,
          notifications: s.notifications.map((n) =>
            ids.includes(n.id) && !n.readAt ? { ...n, readAt: at } : n,
          ),
        }));
        fail(
          "marcar los avisos",
          (await supabase.from("notifications").update({ read_at: at }).in("id", ids)).error,
        );
      },
      updateMember: async (userId, patch) => {
        setState((s) => ({
          ...s,
          members: s.members.map((m) =>
            m.userId === userId && m.accountId === account.id ? { ...m, ...patch } : m,
          ),
        }));
        const { error } = await supabase
          .from("account_memberships")
          .update({
            ...(patch.name !== undefined ? { display_name: patch.name.slice(0, 80) } : {}),
            ...(patch.whatsappPhone !== undefined ? { whatsapp_phone: patch.whatsappPhone } : {}),
            ...(patch.available !== undefined ? { available: patch.available } : {}),
          })
          .eq("account_id", account.id)
          .eq("user_id", userId);
        fail("guardar los datos del equipo", error);
      },
      templates: state.templates.filter((t) => t.accountId === account.id),
      setOptOut: async (leadId, on) => {
        const at = on ? new Date().toISOString() : null;
        setState((s) => ({
          ...s,
          leads: s.leads.map((l) =>
            l.id === leadId
              ? {
                  ...l,
                  optedOutAt: at,
                  optOutReason: on ? "Marcado a mano" : null,
                  botActive: on ? false : l.botActive,
                }
              : l,
          ),
        }));
        fail(
          on ? "dar de baja al lead" : "quitar la baja",
          (
            await supabase
              .from("leads")
              .update({ opted_out_at: at, opt_out_reason: on ? "Marcado a mano" : null })
              .eq("id", leadId)
          ).error,
        );
        await reload();
      },
      assignLead: async (leadId, userId) => {
        setState((s) => ({
          ...s,
          leads: s.leads.map((l) => (l.id === leadId ? { ...l, assignedTo: userId } : l)),
        }));
        fail(
          "asignar el lead",
          (await supabase.from("leads").update({ assigned_to: userId }).eq("id", leadId)).error,
        );
      },
    };
  }, [state, activeId, loading, reload]);
  apiRef.current = value;

  // Los flujos corren en el servidor 24/7; aquí solo refrescamos para ver su avance.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 20_000);
    return () => clearInterval(t);
  }, [reload]);

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm() {
  const c = useContext(CrmContext);
  if (!c) throw new Error("useCrm fuera de CrmProvider");
  return c;
}

export const money = (n: number | null | undefined) =>
  n == null ? "—" : "$" + n.toLocaleString("es-MX");
export const termLabel = (m: number | null) =>
  m == null ? "—" : m === 0 ? "Contado" : `${m} meses`;
