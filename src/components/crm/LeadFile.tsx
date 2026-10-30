import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { money, termLabel, useCrm } from "@/lib/crm/store";
import { STAGES, type Lead } from "@/lib/crm/types";
import { TAG_RULES, applyTag, removeTag } from "@/lib/crm/automation";
import { TagChip } from "./AppShell";
import { LeadFlows } from "./LeadFlows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function stageLabel(l: Lead) {
  if (l.stage === 7) return l.outcome === "no_califica" ? "P7 · No califica" : "P7 · Ganado";
  return `${STAGES[l.stage]!.code} · ${STAGES[l.stage]!.name}`;
}

function NumField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="h-8"
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

export function LeadFile({ lead, readOnly }: { lead: Lead; readOnly?: boolean }) {
  const { updateLead, account, members, assignLead, setOptOut, qrSources } = useCrm();
  const qr = qrSources.find((q) => q.id === lead.qrSourceId);
  const quick = Array.from(new Set([...Object.keys(TAG_RULES), ...account.standardTags])).filter(
    (t) => !lead.tags.includes(t),
  );
  const [newTag, setNewTag] = useState("");
  const set = (patch: Partial<Lead>) => updateLead(lead.id, (l) => ({ ...l, ...patch }));

  const addTag = (t: string) => {
    const tag = t.trim().toLowerCase().replace(/\s+/g, "-");
    if (!tag) return;
    const before = lead;
    const next = applyTag(lead, tag);
    updateLead(lead.id, () => next);
    if (before.stage !== next.stage) toast(`Etiqueta «${tag}» movió a ${stageLabel(next)}`);
    if (before.botActive !== next.botActive)
      toast(`Bot ${next.botActive ? "reactivado" : "pausado"} por etiqueta «${tag}»`);
    setNewTag("");
  };

  return (
    <div className="space-y-5 p-4">
      <div>
        <div className="font-display text-lg font-semibold">{lead.name}</div>
        <div className="text-sm text-muted-foreground">
          {lead.phone} · {lead.source}
        </div>
        {qr && (
          <div className="mt-1 text-sm">
            Llegó por el QR <b>{qr.name}</b>
            {qr.assignedTo && (
              <> · Vendedor: {members.find((m) => m.userId === qr.assignedTo)?.name ?? "—"}</>
            )}
          </div>
        )}
        <div className="mt-2 inline-block rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
          {stageLabel(lead)}
        </div>
      </div>

      {lead.optedOutAt ? (
        <section className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="font-semibold text-destructive">Dado de baja</div>
          <p className="text-xs text-muted-foreground">
            No recibe mensajes automáticos ni entra a flujos
            {lead.optOutReason ? ` (${lead.optOutReason})` : ""}. Un asesor todavía puede escribirle
            a mano si el lead vuelve a escribir.
          </p>
          {!readOnly && (
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-primary hover:underline"
              onClick={() => {
                if (
                  window.confirm(
                    "¿Quitar la baja? El lead podrá volver a recibir mensajes automáticos.",
                  )
                )
                  void setOptOut(lead.id, false);
              }}
            >
              Quitar la baja
            </button>
          )}
        </section>
      ) : (
        !readOnly && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-destructive hover:underline"
            onClick={() => {
              if (
                window.confirm(
                  "¿Dar de baja a este lead? Sale de todos los flujos y el bot se apaga.",
                )
              )
                void setOptOut(lead.id, true);
            }}
          >
            Dar de baja (no enviar mensajes automáticos)
          </button>
        )
      )}

      <section className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-3">
        {readOnly ? (
          <>
            <Kv k="Presupuesto" v={money(lead.budget)} />
            <Kv k="Enganche" v={money(lead.downPayment)} />
            <Kv k="Plazo" v={termLabel(lead.termMonths)} />
            <Kv k="Bot" v={lead.botActive ? "Activo" : "Pausado"} />
          </>
        ) : (
          <>
            <NumField
              label="Presupuesto"
              value={lead.budget}
              onChange={(v) => set({ budget: v })}
            />
            <NumField
              label="Enganche"
              value={lead.downPayment}
              onChange={(v) => set({ downPayment: v })}
            />
            <NumField
              label="Plazo"
              value={lead.termMonths}
              onChange={(v) => set({ termMonths: v })}
              suffix="meses"
            />
            <Kv
              k="Saldo a financiar"
              v={
                lead.budget != null && lead.downPayment != null
                  ? money(lead.budget - lead.downPayment)
                  : "—"
              }
            />
          </>
        )}
      </section>

      <section className="rounded-xl border bg-card p-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Asesor asignado
          </span>
          {readOnly ? (
            <div className="text-sm">
              {members.find((m) => m.userId === lead.assignedTo)?.name ?? "Sin asignar"}
            </div>
          ) : (
            <select
              className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={lead.assignedTo ?? ""}
              onChange={(e) => void assignLead(lead.id, e.target.value || null)}
            >
              <option value="">Sin asignar</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                  {m.available ? "" : " (no disponible)"}
                </option>
              ))}
            </select>
          )}
        </label>
        {lead.aiSummary && (
          <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Resumen IA: </span>
            {lead.aiSummary}
          </p>
        )}
      </section>

      <LeadFlows leadId={lead.id} testMode={!!readOnly} />

      <LeadHistory leadId={lead.id} />

      <section>
        <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          Etiquetas
        </div>
        <div className="flex flex-wrap gap-1.5">
          {lead.tags.length === 0 && (
            <span className="text-xs text-muted-foreground">Sin etiquetas</span>
          )}
          {lead.tags.map((t) => (
            <TagChip
              key={t}
              tag={t}
              {...(readOnly ? {} : { onRemove: () => updateLead(lead.id, (l) => removeTag(l, t)) })}
            />
          ))}
        </div>
        {!readOnly && (
          <>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addTag(newTag);
              }}
            >
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Nueva etiqueta"
                className="h-8"
              />
            </form>
            <div className="mt-2 flex flex-wrap gap-1">
              {quick.map((t) => (
                <button
                  key={t}
                  title={TAG_RULES[t]?.label ?? "Etiqueta descriptiva"}
                  onClick={() => addTag(t)}
                  className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                >
                  +{t}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section>
        <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          Notas del asesor
        </div>
        {readOnly ? (
          <p className="text-sm">{lead.notes || "—"}</p>
        ) : (
          <Textarea
            value={lead.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={4}
            placeholder="Escribe notas internas…"
          />
        )}
      </section>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className="font-display text-sm font-semibold">{v}</div>
    </div>
  );
}

/** Historial del lead: bot pausado, asignaciones y avisos (lead_events). */
function LeadHistory({ leadId }: { leadId: string }) {
  const [events, setEvents] = useState<{ id: string; body: string; created_at: string }[]>([]);
  useEffect(() => {
    let live = true;
    void supabase
      .from("lead_events")
      .select("id, body, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => live && setEvents(data ?? []));
    return () => {
      live = false;
    };
  }, [leadId]);
  if (!events.length) return null;
  return (
    <section>
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Historial
      </div>
      <ul className="space-y-1 text-xs">
        {events.map((e) => (
          <li key={e.id} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground" suppressHydrationWarning>
              {new Date(e.created_at).toLocaleString("es-MX", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span>{e.body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
