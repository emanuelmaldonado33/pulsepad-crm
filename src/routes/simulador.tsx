import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Send, UserPlus } from "lucide-react";
import { useCrm } from "@/lib/crm/store";
import { uid, msg, type BotEvent } from "@/lib/crm/automation";
import { qualifyMessage } from "@/lib/crm/ai.functions";
import { STAGES } from "@/lib/crm/types";
import { ChatThread } from "@/components/crm/ChatThread";
import { LeadFile } from "@/components/crm/LeadFile";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/simulador")({
  head: () => ({
    meta: [
      { title: "Simulador de WhatsApp — Pulse" },
      {
        name: "description",
        content:
          "Prueba la conversación del bot de IA en tiempo real y observa extracción de datos, etiquetas y etapas.",
      },
      { property: "og:title", content: "Simulador de WhatsApp — Pulse" },
      {
        property: "og:description",
        content:
          "Prueba la conversación del bot de IA en tiempo real y observa extracción de datos, etiquetas y etapas.",
      },
    ],
  }),
  component: Simulator,
});

const SUGGESTIONS = [
  "Hola, quiero información",
  "Ando buscando algo de un millón doscientos más o menos",
  "Podría dar como el 20% al inicio",
  "Lo pagaría en un par de años",
  "Va, ¿me pueden marcar mañana?",
  "Prefiero hablar con una persona",
  "La verdad está fuera de mi alcance",
];

interface LogItem extends BotEvent {
  id: string;
}

function Simulator() {
  const { account, getLead, createLead, reload } = useCrm();
  const qualify = useServerFn(qualifyMessage);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [log, setLog] = useState<LogItem[]>([]);
  const lead = leadId ? getLead(leadId) : undefined;
  const active = lead && lead.accountId === account.id ? lead : undefined;

  const newTestLead = async () => {
    const l = await createLead({
      accountId: account.id,
      name: "Lead de Prueba",
      phone: "+52 55 0000 0000",
      source: "Simulador",
      stage: 0,
      outcome: null,
      budget: null,
      downPayment: null,
      termMonths: null,
      intent: null,
      tags: ["prueba"],
      notes: "",
      botActive: true,
    });
    if (!l) return;
    setLeadId(l.id);
    setLog([{ id: uid("e"), kind: "etapa", text: "Nuevo lead creado en P0" }]);
  };

  const send = async (t: string) => {
    const body = t.trim();
    if (!active || !body || typing) return;
    setText("");
    setPending(body);
    setTyping(true);
    setLog((p) => [...p, { id: uid("e"), kind: "dato", text: `Mensaje: «${body}»` }]);
    try {
      const res = await qualify({ data: { leadId: active.id, text: body } });
      setLog((p) => [
        ...p,
        ...res.events.map((e) => ({ ...e, id: uid("e") })),
        ...(res.summary
          ? [{ id: uid("e"), kind: "dato" as const, text: `Resumen IA: ${res.summary}` }]
          : []),
      ]);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "La IA no respondió");
      await reload();
    } finally {
      setPending(null);
      setTyping(false);
    }
  };

  if (!active) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <FlaskConical className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-3 text-2xl font-semibold">Playground de WhatsApp</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Escribe como un prospecto de <b>{account.name}</b> con tus propias palabras. La IA
            entiende lenguaje natural, extrae presupuesto, enganche, plazo e intención, y mueve
            etiquetas y etapas en tiempo real.
          </p>
          <Button className="mt-5" onClick={newTestLead}>
            <UserPlus className="mr-2 h-4 w-4" /> Iniciar conversación de prueba
          </Button>
        </div>
      </div>
    );
  }

  const shown = pending ? [...active.messages, msg("lead", pending)] : active.messages;

  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_380px_320px] lg:p-6"
      style={{ height: "calc(100vh - 4rem)" }}
    >
      <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <div className="font-semibold">Simulación · {account.name}</div>
          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {STAGES[active.stage]!.code}
          </span>
          <span className={`text-xs ${active.botActive ? "text-primary" : "text-warning"}`}>
            {active.botActive ? "Bot activo" : "Bot en pausa"}
          </span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={newTestLead}>
            Reiniciar
          </Button>
        </div>
        <ChatThread messages={shown} typing={typing} />
        <div className="flex flex-wrap gap-1.5 border-t px-3 pt-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              disabled={typing}
              onClick={() => send(s)}
              className="rounded-full border px-2.5 py-1 text-xs hover:border-primary hover:text-primary disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe como el prospecto…"
          />
          <Button type="submit" size="icon" disabled={typing} aria-label="Enviar">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-2xl border bg-card">
        <div className="sticky top-0 border-b bg-card px-4 py-3 font-semibold">
          Registro de la IA
        </div>
        <ol className="space-y-1.5 p-3">
          {log.map((e) => (
            <li key={e.id} className="flex gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs">
              <span
                className={`w-14 shrink-0 font-semibold uppercase ${e.kind === "etapa" ? "text-primary" : e.kind === "bot" ? "text-warning" : e.kind === "cita" ? "text-success" : "text-muted-foreground"}`}
              >
                {e.kind}
              </span>
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
