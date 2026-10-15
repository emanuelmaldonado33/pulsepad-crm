import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarCheck, Phone, Video, MapPin } from "lucide-react";
import { money, termLabel, useCrm } from "@/lib/crm/store";
import { stageLabel } from "@/components/crm/LeadFile";
import { TagChip } from "@/components/crm/AppShell";
import { QuoteCalculator } from "@/components/crm/QuoteCalculator";
import { Button } from "@/components/ui/button";
import { applyTag } from "@/lib/crm/automation";
import type { Lead } from "@/lib/crm/types";

export const Route = createFileRoute("/citas")({
  head: () => ({
    meta: [
      { title: "Citas y agenda — Nexo CRM" },
      { name: "description", content: "Agenda de citas con resumen previo de la llamada para el asesor." },
      { property: "og:title", content: "Citas y agenda — Nexo CRM" },
      { property: "og:description", content: "Agenda de citas con resumen previo de la llamada para el asesor." },
    ],
  }),
  component: Citas,
});

const ICON = { Llamada: Phone, Videollamada: Video, Visita: MapPin };
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

function talkingPoints(l: Lead, product: string): string[] {
  const p: string[] = [];
  if (l.budget && l.downPayment != null && l.termMonths) {
    const monthly = Math.round((l.budget - l.downPayment) / l.termMonths);
    p.push(`Mensualidad estimada: ${money(monthly)} durante ${l.termMonths} meses.`);
  } else if (l.termMonths === 0) p.push("Quiere pagar de contado: ofrece descuento por pago único.");
  if (l.downPayment == null) p.push("Falta confirmar enganche.");
  if (l.budget && l.downPayment && l.downPayment / l.budget >= 0.3) p.push("Enganche alto (≥30%): perfil fuerte de cierre.");
  if (l.tags.includes("vip")) p.push("Lead VIP: prioriza atención personalizada.");
  if (l.tags.includes("inversionista")) p.push("Perfil inversionista: habla de plusvalía y retorno.");
  p.push(`Objetivo: cerrar ${product} o definir siguiente paso con fecha.`);
  return p;
}

function Citas() {
  const { appointments, getLead, account, updateAppointment, updateLead } = useCrm();
  const list = [...appointments].sort((a, b) => a.at.localeCompare(b.at));
  const [sel, setSel] = useState<string | null>(null);
  const current = list.find((a) => a.id === sel) ?? list.find((a) => a.status === "programada") ?? list[0];
  const lead = current ? getLead(current.leadId) : undefined;

  const groups = list.reduce<Record<string, typeof list>>((g, a) => {
    const k = fmtDay(a.at);
    (g[k] ||= []).push(a);
    return g;
  }, {});

  return (
    <div className="grid flex-1 grid-cols-1 gap-6 p-4 lg:grid-cols-[380px_1fr] lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
        <p className="mb-4 text-sm text-muted-foreground">{list.filter((a) => a.status === "programada").length} citas programadas</p>
        <div className="space-y-5">
          {Object.entries(groups).map(([day, items]) => (
            <div key={day}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground" suppressHydrationWarning>{day}</div>
              <div className="space-y-2">
                {items.map((a) => {
                  const l = getLead(a.leadId);
                  const Icon = ICON[a.kind];
                  return (
                    <button key={a.id} onClick={() => setSel(a.id)} className={`flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition hover:shadow ${current?.id === a.id ? "ring-2 ring-primary" : ""} ${a.status !== "programada" ? "opacity-60" : ""}`}>
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{l?.name ?? "Lead eliminado"}</span>
                        <span className="text-xs text-muted-foreground" suppressHydrationWarning>{fmtTime(a.at)} · {a.kind} · {a.status}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {list.length === 0 && <p className="text-sm text-muted-foreground">Sin citas todavía.</p>}
        </div>
      </div>

      {current && lead && (
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-primary">Resumen previo a la llamada</div>
              <h2 className="mt-1 text-2xl font-semibold">{lead.name}</h2>
              <div className="text-sm text-muted-foreground" suppressHydrationWarning>{fmtDay(current.at)} · {fmtTime(current.at)} · {current.kind} · {lead.phone}</div>
            </div>
            <div className="ml-auto flex gap-2">
              <Button asChild variant="outline" size="sm"><Link to="/inbox" search={{ lead: lead.id }}>Ver chat</Link></Button>
              {current.status === "programada" && (
                <Button size="sm" onClick={() => { updateAppointment(current.id, { status: "realizada" }); updateLead(lead.id, (l) => applyTag(l, "seguimiento")); }}>
                  <CalendarCheck className="mr-1 h-4 w-4" /> Marcar realizada
                </Button>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[["Presupuesto", money(lead.budget)], ["Enganche", money(lead.downPayment)], ["Plazo", termLabel(lead.termMonths)], ["Etapa", stageLabel(lead)]].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-muted/70 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div>
                <div className="font-display text-base font-semibold">{v}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-semibold">Puntos clave para la conversación</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {talkingPoints(lead, account.product).map((t) => <li key={t}>{t}</li>)}
              </ul>
              <h3 className="mb-2 mt-5 text-sm font-semibold">Notas del asesor</h3>
              <p className="text-sm text-muted-foreground">{lead.notes || "Sin notas."}</p>
              <div className="mt-4 flex flex-wrap gap-1">{lead.tags.map((t) => <TagChip key={t} tag={t} />)}</div>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Últimos mensajes</h3>
              <div className="space-y-2">
                {lead.messages.slice(-4).map((m) => (
                  <div key={m.id} className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                    <span className="mr-1 text-[10px] font-semibold uppercase text-muted-foreground">{m.from}</span>{m.text}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">Origen: {lead.source}</div>
              <div className="mt-5"><QuoteCalculator key={lead.id} lead={lead} /></div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
