import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { MessageCircle, Search, Upload } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { LeadFile } from "@/components/crm/LeadFile";
import { ImportLeadsDialog } from "@/components/crm/ImportLeadsDialog";
import { money, useCrm } from "@/lib/crm/store";
import { STAGES, type Lead } from "@/lib/crm/types";
import { moveToStage } from "@/lib/crm/automation";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pipeline de ventas — Nexo CRM" },
      {
        name: "description",
        content: "Pipeline Kanban P0–P7 con filtros rápidos y valor total por etapa.",
      },
      { property: "og:title", content: "Pipeline de ventas — Nexo CRM" },
      {
        property: "og:description",
        content: "Pipeline Kanban P0–P7 con filtros rápidos y valor total por etapa.",
      },
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const openLead = leads.find((l) => l.id === openId);

  const filtered = useMemo(
    () =>
      leads.filter((l) => {
        if (
          q &&
          !`${l.name} ${l.phone} ${l.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())
        )
          return false;
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
  const won = filtered
    .filter((l) => l.outcome === "ganado")
    .reduce((s, l) => s + (l.budget ?? 0), 0);

  const drop = (zone: string) => {
    if (!dragId) return;
    const [st, oc] = zone.split(":");
    const lead = leads.find((l) => l.id === dragId)!;
    const next = moveToStage(lead, Number(st), (oc as Lead["outcome"]) ?? null);
    updateLead(dragId, () => next);
    if (next.botActive !== lead.botActive)
      toast(`${lead.name}: bot ${next.botActive ? "reactivado" : "pausado"} automáticamente`);
    setDragId(null);
    setOver(null);
  };

  const FILTERS: [Filter, string][] = [
    ["todos", "Todos"],
    ["bot", "Bot activo"],
    ["humano", "Con asesor"],
    ["vip", "VIP"],
    ["hoy", "Por contactar"],
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-4 px-4 pb-5 pt-7 lg:px-8">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight">Pipeline</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Arrastra entre etapas; etiquetas y bot se sincronizan solos.
          </p>
        </div>
        <div className="ml-auto flex items-end gap-8">
          <Stat label="Valor en pipeline" value={money(total)} />
          <Stat label="Ganado" value={money(won)} accent />
          <Stat label="Leads" value={String(filtered.length)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-5 lg:px-8">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar"
            className="h-8 rounded-full border-0 bg-muted pl-8 text-[13px] shadow-none"
          />
        </div>
        <Segmented value={filter} onChange={setFilter} options={FILTERS} />
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" /> Importar CSV
        </Button>
      </div>
      <ImportLeadsDialog open={importOpen} onOpenChange={setImportOpen} />
      <Sheet open={!!openLead} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-md">
          <SheetHeader className="px-4 pt-4">
            <SheetTitle>Expediente del lead</SheetTitle>
          </SheetHeader>
          {openLead && (
            <>
              <div className="px-4 pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate({ to: "/inbox", search: { lead: openLead.id } })}
                >
                  <MessageCircle className="mr-2 h-4 w-4" /> Abrir chat
                </Button>
              </div>
              <LeadFile key={openLead.id} lead={openLead} />
            </>
          )}
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 pb-8 lg:px-8">
        {STAGES.map((s, i) => {
          const zones = i === 7 ? (["7:ganado", "7:no_califica"] as const) : ([`${i}:`] as const);
          const col = filtered.filter((l) => l.stage === i);
          const value = col
            .filter((l) => l.outcome !== "no_califica")
            .reduce((a, l) => a + (l.budget ?? 0), 0);
          return (
            <div
              key={s.code}
              className="flex w-[17rem] shrink-0 flex-col rounded-[18px] bg-foreground/[0.025] ring-[0.5px] ring-hairline"
            >
              <div className="px-3.5 pb-2 pt-3">
                <div className="flex items-baseline gap-2">
                  <span className="tabular text-[11px] font-medium text-muted-foreground">
                    {s.code}
                  </span>
                  <span className="truncate text-[13px] font-semibold">{s.name}</span>
                  <span className="tabular ml-auto text-[12px] text-muted-foreground">
                    {col.length}
                  </span>
                </div>
                <div className="tabular mt-0.5 text-[12px] text-muted-foreground">
                  {money(value)}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
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
                      className={`flex min-h-24 flex-1 flex-col gap-1.5 rounded-[14px] p-0.5 transition-colors duration-300 ${over === z ? "bg-primary/[0.06] ring-1 ring-primary/30" : ""}`}
                    >
                      {i === 7 && (
                        <div className="flex items-center gap-1.5 px-1.5 pt-1 text-[11px] font-medium text-muted-foreground">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${z.endsWith("ganado") ? "bg-success" : "bg-destructive"}`}
                          />
                          {z.endsWith("ganado") ? "Ganado" : "No califica"}
                        </div>
                      )}
                      {items.map((l) => (
                        <button
                          key={l.id}
                          draggable
                          onDragStart={() => setDragId(l.id)}
                          onClick={() => setOpenId(l.id)}
                          className={`group press rounded-[12px] bg-card px-3 py-2.5 text-left lift ${dragId === l.id ? "opacity-40" : ""}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                              {l.name}
                            </span>
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.botActive ? "bg-primary" : "bg-muted-foreground/40"}`}
                              title={l.botActive ? "Bot activo" : "Con asesor"}
                              aria-label={l.botActive ? "Bot activo" : "Con asesor"}
                            />
                          </div>
                          <div className="mt-1 flex items-baseline justify-between gap-2">
                            <span
                              className={`tabular text-[15px] font-semibold ${l.budget == null ? "text-muted-foreground/50" : ""}`}
                            >
                              {money(l.budget)}
                            </span>
                            <span className="truncate text-[11px] text-muted-foreground">
                              {l.source}
                            </span>
                          </div>
                          {l.tags.length > 0 && (
                            <div className="mt-1.5 truncate text-[11px] text-muted-foreground">
                              {l.tags
                                .slice(0, 3)
                                .map((t) => `#${t}`)
                                .join("  ")}
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
    <div className="text-right">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={`tabular font-display text-[22px] font-semibold leading-tight ${accent ? "text-success" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex rounded-full bg-muted p-[3px] ring-[0.5px] ring-hairline"
    >
      {options.map(([k, label]) => (
        <button
          key={k}
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={`press rounded-full px-3 py-1 text-[12px] font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${value === k ? "bg-popover text-foreground shadow-soft ring-[0.5px] ring-hairline" : "text-muted-foreground hover:text-foreground"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
