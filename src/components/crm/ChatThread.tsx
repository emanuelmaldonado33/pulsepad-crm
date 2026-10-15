import { useEffect, useRef } from "react";
import type { Message } from "@/lib/crm/types";

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

export function ChatThread({ messages, typing }: { messages: Message[]; typing?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [messages.length, typing]);
  return (
    <div className="flex-1 space-y-2 overflow-y-auto bg-chat p-4">
      {messages.map((m) => {
        const mine = m.from !== "lead";
        return (
          <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${mine ? "rounded-br-sm bg-bubble-out" : "rounded-bl-sm bg-bubble-in"}`}>
              {mine && <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{m.from === "bot" ? "🤖 Bot IA" : "👤 Asesor"}</div>}
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
              <div className="mt-0.5 text-right text-[10px] text-muted-foreground" suppressHydrationWarning>{time(m.at)}</div>
            </div>
          </div>
        );
      })}
      {typing && (
        <div className="flex justify-end">
          <div className="rounded-2xl bg-bubble-out px-3 py-2 text-sm text-muted-foreground">El bot está escribiendo…</div>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
