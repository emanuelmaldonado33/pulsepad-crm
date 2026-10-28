import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { sendAdvisorMessage } from "@/lib/crm/whatsapp.functions";
import { ArrowUp, Plus } from "lucide-react";
import { useCrm } from "@/lib/crm/store";
import { setBot } from "@/lib/crm/automation";
import { materialIcon } from "@/lib/crm/flows";
import { ChatThread } from "@/components/crm/ChatThread";
import { LeadFile, stageLabel } from "@/components/crm/LeadFile";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/inbox")({
  validateSearch: (s: Record<string, unknown>): { lead?: string | undefined } => ({
    lead: typeof s["lead"] === "string" ? s["lead"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Bandeja WhatsApp — Nexo CRM" },
      {
        name: "description",
        content:
          "Bandeja híbrida estilo WhatsApp con control manual del bot de IA y expediente del lead.",
      },
      { property: "og:title", content: "Bandeja WhatsApp — Nexo CRM" },
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
  const sorted = [...leads].sort((a, b) =>
    (b.messages.at(-1)?.at ?? "").localeCompare(a.messages.at(-1)?.at ?? ""),
  );
  const lead = leads.find((l) => l.id === leadParam) ?? sorted[0];

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
    <div
      className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_340px]"
      style={{ height: "calc(100vh - 4rem)" }}
    >
      <aside className="overflow-y-auto border-r-[0.5px] border-hairline">
        <div className="px-5 pb-2 pt-5 font-display text-[22px] font-semibold">Mensajes</div>
        <div className="px-2 pb-4">
          {sorted.map((l) => {
            const active = lead?.id === l.id;
            return (
              <button
                key={l.id}
                onClick={() => navigate({ to: "/inbox", search: { lead: l.id } })}
                className={`press flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors duration-200 ${active ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${active ? "bg-primary-foreground/20" : "bg-linear-to-b from-muted-foreground/40 to-muted-foreground/60 text-background"}`}
                >
                  {initials(l.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[14px] font-semibold">{l.name}</span>
                    <span
                      className={`tabular ml-auto shrink-0 text-[11px] ${active ? "text-primary-foreground/75" : "text-muted-foreground"}`}
                      suppressHydrationWarning
                    >
                      {ago(l.messages.at(-1)?.at)}
                    </span>
                  </span>
                  <span
                    className={`flex items-center gap-1.5 text-[13px] ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}
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
        </div>
      </aside>

      {lead ? (
        <section className="flex min-h-0 flex-col">
          <div className="glass flex items-center gap-3 !border-x-0 !border-t-0 px-5 py-2.5 !shadow-none">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-b from-muted-foreground/40 to-muted-foreground/60 text-[11px] font-semibold text-background">
              {initials(lead.name)}
            </span>
            <div className="leading-tight">
              <div className="text-[14px] font-semibold">{lead.name}</div>
              <div className="tabular text-[11px] text-muted-foreground">
                {lead.phone} · {stageLabel(lead)}
              </div>
            </div>
            <label className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
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
                className="h-9 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                aria-label="Enviar"
                disabled={!text.trim()}
                className="press flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-0"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </form>
        </section>
      ) : (
        <div className="flex items-center justify-center text-[13px] text-muted-foreground">
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
