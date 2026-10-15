import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FlaskConical, Send, UserPlus } from "lucide-react";
import { useCrm } from "@/lib/crm/store";
import { processLeadMessage, uid, type BotEvent } from "@/lib/crm/automation";
import { STAGES, type Lead } from "@/lib/crm/types";
import { ChatThread } from "@/components/crm/ChatThread";
import { LeadFile } from "@/components/crm/LeadFile";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { msg } from "@/lib/crm/automation";

export const Route = createFileRoute("/simulador")({
  head: () => ({
    meta: [
      { title: "Simulador de WhatsApp — Nexo CRM" },
      { name: "description", content: "Prueba la conversación del bot de IA en tiempo real y observa extracción de datos, etiquetas y etapas." },
      { property: "og:title", content: "Simulador de WhatsApp — Nexo CRM" },
      { property: "og:description", content: "Prueba la conversación del bot de IA en tiempo real y observa extracción de datos, etiquetas y etapas." },
    ],
  }),
  component: Simulator,
});

const SUGGESTIONS = [
  "Hola, quiero información",
  "Tengo un presupuesto de 1.2 millones",
  "Puedo dar un enganche del 20%",
  "A 24 meses",
  "Sí, quiero agendar una llamada",
  "Prefiero hablar con un asesor",
  "No me interesa, muy caro",
];

interface LogItem extends BotEvent { id: string }

function Simulator() {
  const { account, getLead, addLead, updateLead, addAppointment } = useCrm();
  const [leadId, setLeadId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [log, setLog] = useState<LogItem[]>([]);
  const lead = leadId ? getLead(leadId) : undefined;
  const active = lead && lead.accountId === account.id ? lead : undefined;

  const newTestLead = () => {
    const l: Lead = {
      id: uid("sim"), accountId: account.id, name: "Lead de Prueba", phone: "+52 55 0000 0000", source: "Simulador",
      stage: 0, outcome: null, budget: null, downPayment: null, termMonths: null, tags: ["prueba"], notes: "",
      botActive: true, messages: [], createdAt: new Date().toISOString(),
    };
    addLead(l);
    setLeadId(l.id);
    setLog([{ id: uid("e"), kind: "etapa", text: "Nuevo lead creado en P0" }]);
  };

  const send = (t: string) => {
    if (!active || !t.trim() || typing) return;
    const res = processLeadMessage(active, t.trim(), account.product);
    updateLead(active.id, () => res.lead);
    setLog((p) => [...p, { id: uid("e"), kind: "dato", text: `📥 «${t.trim()}»` }, ...res.events.map((e) => ({ ...e, id: uid("e") }))]);
    setText("");
    if (res.bookAppointment) {
      const at = new Date(Date.now() + 24 * 3600_000);
      at.setHours(11, 0, 0, 0);
      addAppointment({ id: uid("a"), accountId: account.id, leadId: active.id, at: at.toISOString(), kind: "Llamada", status: "programada" });
    }
    if (res.reply) {
      setTyping(true);
      const reply = res.reply;
      setTimeout(() => {
        updateLead(active.id, (l) => ({ ...l, messages: [...l.messages, msg("bot", reply)] }));
        setTyping(false);
      }, 900);
    }
  };

  if (!active) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <FlaskConical className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-3 text-2xl font-semibold">Playground de WhatsApp</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Escribe como si fueras un prospecto de <b>{account.name}</b> y observa cómo el bot extrae presupuesto, enganche y plazo, asigna etiquetas y mueve la etapa.
          </p>
          <Button className="mt-5" onClick={newTestLead}><UserPlus className="mr-2 h-4 w-4" /> Iniciar conversación de prueba</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_380px_320px] lg:p-6" style={{ height: "calc(100vh - 4rem)" }}>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <div className="font-semibold">Simulación · {account.name}</div>
          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {STAGES[active.stage]!.code}
          </span>
          <span className={`text-xs ${active.botActive ? "text-primary" : "text-warning"}`}>{active.botActive ? "Bot activo" : "Bot en pausa"}</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={newTestLead}>Reiniciar</Button>
        </div>
        <ChatThread messages={active.messages} typing={typing} />
        <div className="flex flex-wrap gap-1.5 border-t px-3 pt-3">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} className="rounded-full border px-2.5 py-1 text-xs hover:border-primary hover:text-primary">{s}</button>
          ))}
        </div>
        <form className="flex gap-2 p-3" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe como el prospecto…" />
          <Button type="submit" size="icon" aria-label="Enviar"><Send className="h-4 w-4" /></Button>
        </form>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-2xl border bg-card">
        <div className="sticky top-0 border-b bg-card px-4 py-3 font-semibold">Registro de la IA</div>
        <ol className="space-y-1.5 p-3">
          {log.map((e) => (
            <li key={e.id} className="flex gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs">
              <span className={`w-14 shrink-0 font-semibold uppercase ${e.kind === "etapa" ? "text-primary" : e.kind === "bot" ? "text-warning" : e.kind === "cita" ? "text-success" : "text-muted-foreground"}`}>{e.kind}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-2xl border bg-background">
        <LeadFile lead={active} readOnly />
      </div>
    </div>
  );
}
