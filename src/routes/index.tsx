import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bot, BotOff, Search } from "lucide-react";
import { money, useCrm } from "@/lib/crm/store";
import { STAGES, type Lead } from "@/lib/crm/types";
import { moveToStage } from "@/lib/crm/automation";
import { Input } from "@/components/ui/input";
import { TagChip } from "@/components/crm/AppShell";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pipeline de ventas — Nexo CRM" },
      { name: "description", content: "Pipeline Kanban P0–P7 con filtros rápidos y valor total por etapa." },
      { property: "og:title", content: "Pipeline de ventas — Nexo CRM" },
      { property: "og:description", content: "Pipeline Kanban P0–P7 con filtros rápidos y valor total por etapa." },
    ],
  }),
  component: Pipeline,
});

type Filter = "todos" | "bot" | "humano" | "vip" | "hoy";

function Pipeline() {
  const { leads, updateLead } = useCrm();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      leads.filter((l) => {
        if (q && !`${l.name} ${l.phone} ${l.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())) return false;
        if (filter === "bot") return l.botActive;
        if (filter === "humano") return !l.botActive;
        if (filter === "vip") return l.tags.includes("vip");
        if (filter === "hoy") return l.stage <= 1;
        return true;
      }),
    [leads, q, filter],
  );

  const open = filtered.filter((l) => !(l.stage === 7 && l.outcome === "no_califica"));
  const total = open.filter((l) => l.outcome !== "ganado").reduce((s, l) => s + (l.budget ?? 0), 0);
  const won = filtered.filter((l) => l.outcome === "ganado").reduce((s, l) => s + (l.budget ?? 0), 0);

  const drop = (zone: string) => {
    if (!dragId) return;
    const [st, oc] = zone.split(":");
    const lead = leads.find((l) => l.id === dragId)!;
    const next = moveToStage(lead, Number(st), (oc as Lead["outcome"]) ?? null);
    updateLead(dragId, () => next);
    if (next.botActive !== lead.botActive) toast(`${lead.name}: bot ${next.botActive ? "reactivado" : "pausado"} automáticamente`);
    setDragId(null);
    setOver(null);
  };

  const FILTERS: [Filter, string][] = [["todos", "Todos"], ["bot", "Bot activo"], ["humano", "Con asesor"], ["vip", "VIP"], ["hoy", "Por contactar"]];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-4 px-4 pb-3 pt-5 lg:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground">Arrastra los leads entre etapas. Las etiquetas y el bot se sincronizan solos.</p>
        </div>
        <div className="ml-auto flex gap-3">
          <Stat label="Valor en pipeline" value={money(total)} />
          <Stat label="Ganado" value={money(won)} accent />
          <Stat label="Leads" value={String(filtered.length)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 lg:px-6">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, teléfono, etiqueta" className="pl-8" />
        </div>
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${filter === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-6 lg:px-6">
        {STAGES.map((s, i) => {
          const zones = i === 7 ? (["7:ganado", "7:no_califica"] as const) : ([`${i}:`] as const);
          const col = filtered.filter((l) => l.stage === i);
          const value = col.filter((l) => l.outcome !== "no_califica").reduce((a, l) => a + (l.budget ?? 0), 0);
          return (
            <div key={s.code} className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/70">
              <div className="border-b border-border/70 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 font-display text-[11px] font-bold text-primary">{s.code}</span>
                  <span className="truncate text-sm font-semibold">{s.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{col.length}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{money(value)}</div>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {zones.map((z) => {
                  const items = i === 7 ? col.filter((l) => l.outcome === z.split(":")[1]) : col;
                  return (
                    <div
                      key={z}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setOver(z);
                      }}
                      onDragLeave={() => setOver(null)}
                      onDrop={() => drop(z)}
                      className={`flex min-h-24 flex-1 flex-col gap-2 rounded-lg p-1 transition-colors ${over === z ? "bg-primary/10 ring-2 ring-primary/40" : ""}`}
                    >
                      {i === 7 && (
                        <div className={`px-1 text-[11px] font-semibold uppercase tracking-wide ${z.endsWith("ganado") ? "text-success" : "text-destructive"}`}>
                          {z.endsWith("ganado") ? "Ganado" : "No califica"}
                        </div>
                      )}
                      {items.map((l) => (
                        <button
                          key={l.id}
                          draggable
                          onDragStart={() => setDragId(l.id)}
                          onClick={() => navigate({ to: "/inbox", search: { lead: l.id } })}
                          className={`rounded-lg border bg-card p-3 text-left shadow-sm transition hover:shadow-md ${dragId === l.id ? "opacity-50" : ""}`}
                        >
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold">{l.name}</div>
                              <div className="text-xs text-muted-foreground">{l.source}</div>
                            </div>
                            {l.botActive ? <Bot className="h-4 w-4 text-primary" aria-label="Bot activo" /> : <BotOff className="h-4 w-4 text-muted-foreground" aria-label="Bot pausado" />}
                          </div>
                          <div className="mt-2 font-display text-sm font-semibold">{money(l.budget)}</div>
                          {l.tags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {l.tags.slice(0, 3).map((t) => (
                                <TagChip key={t} tag={t} />
                              ))}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-display text-lg font-semibold ${accent ? "text-success" : ""}`}>{value}</div>
    </div>
  );
}
