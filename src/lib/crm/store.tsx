import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Account, Appointment, Lead } from "./types";
import { ACCOUNTS, SEED_APPOINTMENTS, SEED_LEADS } from "./seed";

interface State {
  activeAccountId: string;
  leads: Lead[];
  appointments: Appointment[];
}

const KEY = "crm-ht-v1";
const initial: State = { activeAccountId: ACCOUNTS[0]!.id, leads: SEED_LEADS, appointments: SEED_APPOINTMENTS };

interface Ctx {
  accounts: Account[];
  account: Account;
  setAccount: (id: string) => void;
  leads: Lead[]; // de la subcuenta activa
  appointments: Appointment[];
  getLead: (id: string) => Lead | undefined;
  updateLead: (id: string, fn: (l: Lead) => Lead) => void;
  addLead: (l: Lead) => void;
  removeLead: (id: string) => void;
  addAppointment: (a: Appointment) => void;
  updateAppointment: (id: string, patch: Partial<Appointment>) => void;
  resetDemo: () => void;
}

const CrmContext = createContext<Ctx | null>(null);

export function CrmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      if (s) setState(JSON.parse(s));
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify(state));
  }, [state, loaded]);

  const updateLead = useCallback((id: string, fn: (l: Lead) => Lead) => {
    setState((s) => ({ ...s, leads: s.leads.map((l) => (l.id === id ? fn(l) : l)) }));
  }, []);

  const value = useMemo<Ctx>(() => {
    const account = ACCOUNTS.find((a) => a.id === state.activeAccountId) ?? ACCOUNTS[0]!;
    return {
      accounts: ACCOUNTS,
      account,
      setAccount: (id) => setState((s) => ({ ...s, activeAccountId: id })),
      leads: state.leads.filter((l) => l.accountId === account.id),
      appointments: state.appointments.filter((a) => a.accountId === account.id),
      getLead: (id) => state.leads.find((l) => l.id === id),
      updateLead,
      addLead: (l) => setState((s) => ({ ...s, leads: [l, ...s.leads] })),
      removeLead: (id) => setState((s) => ({ ...s, leads: s.leads.filter((l) => l.id !== id), appointments: s.appointments.filter((a) => a.leadId !== id) })),
      addAppointment: (a) => setState((s) => ({ ...s, appointments: [...s.appointments, a] })),
      updateAppointment: (id, patch) => setState((s) => ({ ...s, appointments: s.appointments.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      resetDemo: () => setState({ ...initial, activeAccountId: state.activeAccountId }),
    };
  }, [state, updateLead]);

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm() {
  const c = useContext(CrmContext);
  if (!c) throw new Error("useCrm fuera de CrmProvider");
  return c;
}

export const money = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toLocaleString("es-MX"));
export const termLabel = (m: number | null) => (m == null ? "—" : m === 0 ? "Contado" : `${m} meses`);
