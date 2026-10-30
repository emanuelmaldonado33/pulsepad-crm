import { useEffect, useRef } from "react";
import type { Message } from "@/lib/crm/types";
import { MESSAGE_INTENTS, type MessageIntent } from "@/lib/crm/flows";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
const GAP = 10 * 60_000;

/** Hilo estilo Apple Messages: grupos por remitente, cola sólo en la última burbuja, horas discretas. */
export function ChatThread({ messages, typing }: { messages: Message[]; typing?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typing]);

  return (
    <div className="flex-1 overflow-y-auto bg-chat px-4 py-5 sm:px-8">
      <div className="mx-auto flex max-w-2xl flex-col">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const mine = m.from !== "lead";
          const t = new Date(m.at).getTime();
          const newBlock = !prev || t - new Date(prev.at).getTime() > GAP;
          const startGroup = newBlock || prev.from !== m.from;
          const endGroup = !next || next.from !== m.from || new Date(next.at).getTime() - t > GAP;
          const failed = m.waStatus === "fallido";
          return (
            <div key={m.id} className={startGroup ? "mt-3" : "mt-[2px]"}>
              {newBlock && (
                <div
                  className="mb-3 mt-2 text-center text-[11px] font-medium text-muted-foreground"
                  suppressHydrationWarning
                >
                  <span className="inline-block first-letter:uppercase">{day(m.at)}</span> ·{" "}
                  {time(m.at)}
                </div>
              )}
              {startGroup && mine && (
                <div className="mb-1 pr-3 text-right text-[11px] text-muted-foreground">
                  {m.from === "bot" ? "Bot IA" : "Asesor"}
                </div>
              )}
              <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  title={time(m.at)}
                  className={`max-w-[72%] whitespace-pre-wrap break-words px-3.5 py-[7px] text-[15px] leading-[1.35] tracking-[-0.01em] ${
                    mine
                      ? `rounded-[20px] bg-bubble-out text-bubble-out-foreground ${endGroup ? "rounded-br-[6px]" : ""} ${m.from === "asesor" ? "opacity-95 saturate-[0.8]" : ""}`
                      : `rounded-[20px] bg-bubble-in text-foreground ${endGroup ? "rounded-bl-[6px]" : ""}`
                  }`}
                >
                  {m.text}
                </div>
              </div>
              {!mine && m.intent && m.intent in MESSAGE_INTENTS && (
                <div className="mt-1 pl-1 text-[11px] text-muted-foreground">
                  IA: {MESSAGE_INTENTS[m.intent as MessageIntent].toLowerCase()}
                </div>
              )}
              {endGroup && mine && m.waStatus && (
                <div
                  className={`mt-1 pr-1 text-right text-[11px] ${failed ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {m.waStatus === "enviado" ? "Entregado" : failed ? "No enviado" : "Simulado"}
                </div>
              )}
            </div>
          );
        })}
        {typing && (
          <div className="mt-3 flex justify-end">
            <div
              className="flex gap-1 rounded-[20px] rounded-br-[6px] bg-bubble-in px-4 py-3"
              aria-label="Escribiendo"
            >
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
    </div>
  );
}
