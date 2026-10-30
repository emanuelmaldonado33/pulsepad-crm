import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { sendAdvisorMessage } from "@/lib/crm/whatsapp.functions";
import { ArrowLeft, ArrowUp, Plus, Search } from "lucide-react";
import { useCrm } from "@/lib/crm/store";
import { setBot } from "@/lib/crm/automation";
import { materialIcon } from "@/lib/crm/flows";
import { ChatThread } from "@/components/crm/ChatThread";
import { LeadFile, stageLabel } from "@/components/crm/LeadFile";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/inbox")({
  validateSearch: (s: Record<string, unknown>): { lead?: string | undefined } => ({
    lead: typeof s["lead"] === "string" ? s["lead"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Bandeja WhatsApp — Pulse" },
      {
        name: "description",
        content:
          "Bandeja híbrida estilo WhatsApp con control manual del bot de IA y expediente del lead.",
      },
      { property: "og:title", content: "Bandeja WhatsApp — Pulse" },
      {
        property: "og:description",
        content:
          "Bandeja híbrida estilo WhatsApp con control manual del bot de IA y expediente del lead.",
      },
    ],
  }),
  component: Inbox,
});

function Inbox() {
  const { leads, updateLead, materials, reload } = useCrm();
  const { lead: leadParam } = Route.useSearch();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "reply" | "advisor">("all");
  const sorted = [...leads].sort((a, b) =>
    (b.messages.at(-1)?.at ?? "").localeCompare(a.messages.at(-1)?.at ?? ""),
  );
  const needsReplyCount = sorted.filter((l) => l.messages.at(-1)?.from === "lead").length;
  const advisorCount = sorted.filter((l) => !l.botActive).length;
  const visibleLeads = sorted.filter((l) => {
    const last = l.messages.at(-1);
    const matchesQuery =
      !query ||
      `${l.name} ${l.phone} ${l.tags.join(" ")} ${last?.text ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase());
    if (!matchesQuery) return false;
    if (filter === "reply") return last?.from === "lead";
    if (filter === "advisor") return !l.botActive;
    return true;
  });
  const lead = leads.find((l) => l.id === leadParam) ?? visibleLeads[0];
  const mobileShowThread = Boolean(leadParam);

  const sendFn = useServerFn(sendAdvisorMessage);
  const send = async () => {
    const body = text.trim();
    if (!body || !lead) return;
    setText("");
    try {
      const r = await sendFn({ data: { leadId: lead.id, text: body } });
      if (r.status === "fallido") toast.error("Guardado, pero WhatsApp rechazó el envío");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
      setText(body);
    }
    await reload();
  };

  const ago = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso),
      now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  };
  const initials = (n: string) =>
    n
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

  return (
    <div className="grid h-[calc(100dvh-8rem)] min-h-0 flex-1 grid-cols-1 md:h-[calc(100dvh-4rem)] md:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_340px]">
      <aside
        className={`overflow-y-auto border-r-[0.5px] border-hairline ${mobileShowThread ? "hidden md:block" : ""}`}
      >
        <div className="px-4 pb-3 pt-4 sm:px-5">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-xl font-semibold">Mensajes</h1>
            <span className="text-xs text-muted-foreground">{sorted.length} conversaciones</span>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar persona, teléfono o mensaje"
              aria-label="Buscar conversaciones"
              className="h-10 rounded-xl bg-muted pl-9 text-sm"
            />
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar conversaciones">
            {(
              [
                ["all", "Todas", sorted.length],
                ["reply", "Por responder", needsReplyCount],
                ["advisor", "Con asesor", advisorCount],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-medium transition-colors ${filter === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              >
                {label}
                <span
                  className={`tabular rounded-full px-1.5 py-0.5 text-xs ${filter === value ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background"}`}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="px-2 pb-4">
          {visibleLeads.map((l) => {
            const active = lead?.id === l.id;
            return (
              <button
                key={l.id}
                onClick={() => navigate({ to: "/inbox", search: { lead: l.id } })}
                className={`press flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors duration-200 ${active ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${active ? "bg-primary-foreground/20" : "bg-linear-to-b from-muted-foreground/40 to-muted-foreground/60 text-background"}`}
                >
                  {initials(l.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-base font-semibold">{l.name}</span>
                    <span
                      className={`tabular ml-auto shrink-0 text-xs ${active ? "text-primary-foreground/75" : "text-muted-foreground"}`}
                      suppressHydrationWarning
                    >
                      {ago(l.messages.at(-1)?.at)}
                    </span>
                  </span>
                  <span
                    className={`flex items-center gap-1.5 text-sm ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                  >
                    {!l.botActive && (
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-primary-foreground" : "bg-warning"}`}
                        title="Con asesor"
                      />
                    )}
                    <span className="truncate">{l.messages.at(-1)?.text ?? stageLabel(l)}</span>
                  </span>
                </span>
              </button>
            );
          })}
          {visibleLeads.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {query
                ? "No hay coincidencias. Prueba otra búsqueda."
                : "No hay conversaciones en esta vista."}
            </p>
          )}
        </div>
      </aside>

      {lead ? (
        <section className={`min-h-0 flex-col ${mobileShowThread ? "flex" : "hidden md:flex"}`}>
          <div className="glass flex items-center gap-2 !border-x-0 !border-t-0 px-3 py-2.5 !shadow-none sm:gap-3 sm:px-5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 md:hidden"
              aria-label="Volver a conversaciones"
              onClick={() => navigate({ to: "/inbox" })}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-b from-muted-foreground/40 to-muted-foreground/60 text-xs font-semibold text-background">
              {initials(lead.name)}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold">{lead.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {lead.phone} · {stageLabel(lead)}
              </div>
            </div>
            <label className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {lead.botActive ? "Bot IA" : "Asesor"}
              <Switch
                checked={lead.botActive}
                onCheckedChange={(v) => updateLead(lead.id, (l) => setBot(l, v))}
                aria-label="Bot de IA"
              />
            </label>
          </div>
          <ChatThread messages={lead.messages} />
          <form
            className="mx-auto flex w-full max-w-2xl items-end gap-2 px-4 pb-4 pt-2 sm:px-8"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {materials.length > 0 && (
              <label
                className="press relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
                title="Adjuntar material"
              >
                <Plus className="h-4 w-4" />
                <select
                  aria-label="Adjuntar material"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value=""
                  onChange={(e) => {
                    const m = materials.find((x) => x.id === e.target.value);
                    if (m)
                      setText(
                        (t) => `${t}${t ? " " : ""}${materialIcon(m.kind)} ${m.name}: ${m.url}`,
                      );
                  }}
                >
                  <option value="">Adjuntar…</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {materialIcon(m.kind)} {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex min-h-9 flex-1 items-center rounded-[18px] border-[0.5px] border-input bg-card/60 pl-4 pr-1 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={lead.botActive ? "Mensaje (el bot sigue activo)" : "Mensaje"}
                className="h-11 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                aria-label="Enviar"
                disabled={!text.trim()}
                className="press flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              >
                <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
          </form>
        </section>
      ) : (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          Sin conversaciones
        </div>
      )}

      {lead && (
        <aside className="hidden overflow-y-auto border-l-[0.5px] border-hairline xl:block">
          <LeadFile key={lead.id} lead={lead} />
        </aside>
      )}
    </div>
  );
}
