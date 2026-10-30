import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Megaphone } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCrm } from "@/lib/crm/store";
import { STAGES } from "@/lib/crm/types";
import {
  META_EVENTS,
  META_EVENT_NAMES,
  META_STATUS_LABEL,
  RECOMMENDED_STAGE_EVENTS,
  STAGE_EVENT_KEYS,
  type MetaEventName,
  type StageEventKey,
  type StageEvents,
} from "@/lib/crm/meta";
import { getMetaStatus, type MetaStatus } from "@/lib/crm/meta.functions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const sel = "h-11 min-w-56 rounded-md border border-input bg-background px-3 text-base";

const KEY_LABEL: Record<StageEventKey, string> = {
  nuevo: "Llega un cliente nuevo de un anuncio",
  ganado: `Llega a ${STAGES[7].code} y se gana la venta`,
  ...(Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((n) => [String(n), `Llega a ${STAGES[n]!.code} · ${STAGES[n]!.name}`]),
  ) as Record<"1" | "2" | "3" | "4" | "5" | "6", string>),
};

type EventRow = {
  id: string;
  lead_id: string;
  event_name: string;
  detail: string;
  status: string;
  last_error: string | null;
  created_at: string;
};

const sameEvents = (a: StageEvents, b: StageEvents) => STAGE_EVENT_KEYS.every((k) => a[k] === b[k]);

/** Configuración › Meta (anuncios): avisos a Meta de los clientes que llegan por anuncio. */
export function MetaEvents() {
  const { account, updateAccount, members, me, leads } = useCrm();
  const isAdmin = members.some(
    (m) => m.userId === me && (m.role === "owner" || m.role === "admin"),
  );
  const fetchStatus = useServerFn(getMetaStatus);
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const saved = account.metaStageEvents ?? {};
  const [draft, setDraft] = useState<StageEvents>(saved);
  const [rows, setRows] = useState<EventRow[]>([]);

  useEffect(() => setDraft(account.metaStageEvents ?? {}), [account.metaStageEvents]);
  useEffect(() => {
    let live = true;
    fetchStatus({ data: { accountId: account.id } })
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus(null));
    void supabase
      .from("meta_events")
      .select("id, lead_id, event_name, detail, status, last_error, created_at")
      .eq("account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => live && setRows(data ?? []));
    return () => {
      live = false;
    };
  }, [account.id, fetchStatus]);

  const enabled = account.metaEventsEnabled ?? false;
  const changed = !sameEvents(draft, saved);
  const leadName = (id: string) => leads.find((l) => l.id === id)?.name ?? "Cliente";

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Megaphone className="h-5 w-5 text-primary" /> Avisar a Meta qué clientes avanzan
        </h2>
        <p className="text-sm text-muted-foreground">
          Cuando un cliente que llegó por un anuncio de WhatsApp avanza o compra, Pulse se lo avisa
          a Meta. Así Meta aprende quién sí compra y le muestra tus anuncios a más personas
          parecidas. Los clientes que no vinieron de un anuncio no se envían.
        </p>
        <ul className="space-y-1.5 text-sm">
          <Check ok={!!status?.configured}>
            {status?.configured
              ? `Conexión con Meta lista${status.testMode ? " (modo de prueba)" : ""}`
              : "Falta la conexión con Meta: pide que pongan META_DATASET_ID y META_CAPI_TOKEN en los secretos de Lovable Cloud"}
          </Check>
          <Check ok={!!status?.hasWaba}>
            {status?.hasWaba
              ? "Tu número de WhatsApp tiene su WABA ID"
              : "Falta el WABA ID en Configuración › Canal WhatsApp"}
          </Check>
        </ul>
        <label className="flex items-center gap-3 text-base font-medium">
          <Switch
            aria-label="Enviar eventos a Meta"
            checked={enabled}
            disabled={!isAdmin}
            onCheckedChange={(v) => {
              void updateAccount(account.id, {
                metaEventsEnabled: v,
                // Al prenderlo por primera vez, empezar con lo recomendado.
                ...(v && !Object.keys(saved).length
                  ? { metaStageEvents: RECOMMENDED_STAGE_EVENTS }
                  : {}),
              });
              toast.success(v ? "Listo: Pulse avisará a Meta" : "Ya no se avisará a Meta");
            }}
          />
          {enabled ? "Prendido: Pulse avisa a Meta" : "Apagado: no se avisa a Meta"}
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">¿Qué le avisamos a Meta en cada momento?</h2>
        <p className="text-sm text-muted-foreground">
          Se manda solo, sin que hagas nada, una vez por cliente. También puedes avisar desde un
          seguimiento con el paso «Enviar evento a Meta».
        </p>
        <div className="divide-y">
          {STAGE_EVENT_KEYS.map((k) => (
            <label key={k} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="text-base">{KEY_LABEL[k]}</span>
              <select
                className={sel}
                aria-label={KEY_LABEL[k]}
                disabled={!isAdmin}
                value={draft[k] ?? ""}
                onChange={(e) => {
                  const next = { ...draft };
                  if (e.target.value) next[k] = e.target.value as MetaEventName;
                  else delete next[k];
                  setDraft(next);
                }}
              >
                <option value="">No avisar</option>
                {META_EVENT_NAMES.map((ev) => (
                  <option key={ev} value={ev}>
                    {META_EVENTS[ev]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!changed}
              onClick={() => {
                void updateAccount(account.id, { metaStageEvents: draft });
                toast.success("Guardado");
              }}
            >
              Guardar
            </Button>
            <Button
              variant="outline"
              disabled={sameEvents(draft, RECOMMENDED_STAGE_EVENTS)}
              onClick={() => setDraft(RECOMMENDED_STAGE_EVENTS)}
            >
              Usar lo recomendado
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Recomendado: cliente nuevo, prospecto calificado al llegar a {STAGES[4].code} y compra al
          ganar la venta (con el presupuesto del cliente como monto).
        </p>
      </section>

      <section className="space-y-2 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Últimos avisos a Meta</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no se ha avisado nada.</p>
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((r) => (
              <li key={r.id} className="space-y-0.5 py-2">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{leadName(r.lead_id)}</span>
                  <span>· {META_EVENTS[r.event_name as MetaEventName] ?? r.event_name}</span>
                  <span
                    className={`ml-auto font-medium ${r.status === "enviado" ? "text-emerald-700 dark:text-emerald-400" : r.status === "fallido" ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {META_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.detail} ·{" "}
                  {new Date(r.created_at).toLocaleString("es-MX", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {r.last_error ? ` · ${r.last_error}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : CircleAlert;
  return (
    <li className="flex items-start gap-2">
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? "text-emerald-600" : "text-amber-600"}`}
        aria-hidden
      />
      <span>{children}</span>
    </li>
  );
}
