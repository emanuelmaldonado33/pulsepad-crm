import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Send } from "lucide-react";
import { useCrm } from "@/lib/crm/store";
import { setBot } from "@/lib/crm/automation";
import { ChatThread } from "@/components/crm/ChatThread";
import { LeadFile, stageLabel } from "@/components/crm/LeadFile";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/inbox")({
  validateSearch: (s: Record<string, unknown>): { lead?: string | undefined } => ({ lead: typeof s["lead"] === "string" ? s["lead"] : undefined }),
  head: () => ({
    meta: [
      { title: "Bandeja WhatsApp — Nexo CRM" },
      { name: "description", content: "Bandeja híbrida estilo WhatsApp con control manual del bot de IA y expediente del lead." },
      { property: "og:title", content: "Bandeja WhatsApp — Nexo CRM" },
      { property: "og:description", content: "Bandeja híbrida estilo WhatsApp con control manual del bot de IA y expediente del lead." },
    ],
  }),
  component: Inbox,
});

function Inbox() {
  const { leads, updateLead, addMessage } = useCrm();
  const { lead: leadParam } = Route.useSearch();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const sorted = [...leads].sort((a, b) => (b.messages.at(-1)?.at ?? "").localeCompare(a.messages.at(-1)?.at ?? ""));
  const lead = leads.find((l) => l.id === leadParam) ?? sorted[0];

  const send = () => {
    if (!text.trim() || !lead) return;
    void addMessage(lead.id, "asesor", text.trim());
    setText("");
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_340px]" style={{ height: "calc(100vh - 4rem)" }}>
      <aside className="overflow-y-auto border-r bg-card">
        <div className="px-4 py-3 font-display font-semibold">Conversaciones</div>
        {sorted.map((l) => (
          <button
            key={l.id}
            onClick={() => navigate({ to: "/inbox", search: { lead: l.id } })}
            className={`flex w-full gap-3 border-t px-4 py-3 text-left hover:bg-accent ${lead?.id === l.id ? "bg-primary/10" : ""}`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
              {l.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{l.name}</span>
                <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${l.botActive ? "bg-primary" : "bg-warning"}`} title={l.botActive ? "Bot activo" : "Asesor"} />
              </span>
              <span className="block truncate text-xs text-muted-foreground">{l.messages.at(-1)?.text}</span>
              <span className="text-[10px] text-muted-foreground">{stageLabel(l)}</span>
            </span>
          </button>
        ))}
      </aside>

      {lead ? (
        <section className="flex min-h-0 flex-col">
          <div className="flex items-center gap-3 border-b bg-card px-4 py-3">
            <div>
              <div className="font-semibold">{lead.name}</div>
              <div className="text-xs text-muted-foreground">{lead.phone}</div>
            </div>
            <label className="ml-auto flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
              <span className={lead.botActive ? "font-medium text-primary" : "text-muted-foreground"}>{lead.botActive ? "Bot IA activo" : "Bot en pausa"}</span>
              <Switch checked={lead.botActive} onCheckedChange={(v) => updateLead(lead.id, (l) => setBot(l, v))} aria-label="Bot de IA" />
            </label>
          </div>
          <ChatThread messages={lead.messages} />
          <form
            className="flex gap-2 border-t bg-card p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={lead.botActive ? "Escribe como asesor (el bot sigue activo)…" : "Escribe como asesor…"} />
            <Button type="submit" size="icon" aria-label="Enviar"><Send className="h-4 w-4" /></Button>
          </form>
        </section>
      ) : (
        <div className="flex items-center justify-center text-muted-foreground">Sin conversaciones</div>
      )}

      {lead && (
        <aside className="hidden overflow-y-auto border-l bg-background xl:block">
          <LeadFile key={lead.id} lead={lead} />
        </aside>
      )}
    </div>
  );
}
