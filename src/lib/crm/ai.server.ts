import { createOpenAI } from "@ai-sdk/openai";
import { Output, streamText, type ModelMessage } from "ai";
import { z } from "zod";

const RUN_ID = "X-Lovable-AIG-Run-ID";

function createRunIdFetch() {
  let runId: string | undefined;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (runId && !headers.has(RUN_ID)) headers.set(RUN_ID, runId);
    const res = await fetch(input, { ...init, headers });
    runId ??= res.headers.get(RUN_ID)?.trim() || undefined;
    return res;
  };
}

export const qualificationSchema = z.object({
  reply: z
    .string()
    .describe(
      "Respuesta de WhatsApp para el prospecto. Vacío si se transfiere a humano sin respuesta.",
    ),
  budget: z
    .number()
    .nullable()
    .describe("Presupuesto total en MXN si se conoce (acumulado), si no null"),
  down_payment: z
    .number()
    .nullable()
    .describe("Enganche en MXN (convierte porcentajes a monto), si no null"),
  term_months: z.number().nullable().describe("Plazo en meses; 0 = contado; null si se desconoce"),
  intent: z.enum([
    "informacion",
    "calificando",
    "listo_para_cita",
    "quiere_humano",
    "no_interesado",
    "seguimiento",
  ]),
  message_intent: z
    .enum([
      "quiere_comprar",
      "pide_precio",
      "pide_cita",
      "objecion",
      "no_interesado",
      "quiere_humano",
      "otro",
    ])
    .describe("Intención del ÚLTIMO mensaje del prospecto, sin contar el resto del historial"),
  tags_to_add: z.array(z.string()).describe("Etiquetas en minúsculas-con-guiones"),
  appointment_requested: z.boolean(),
  summary: z.string().describe("Resumen de una línea del estado del lead para el asesor"),
});
export type Qualification = z.infer<typeof qualificationSchema>;

export async function runQualifier(opts: {
  model: string;
  system: string;
  messages: ModelMessage[];
}) {
  const { isClaudeModel, runClaudeQualifier } = await import("./claude.server");
  if (isClaudeModel(opts.model)) {
    return runClaudeQualifier({
      model: opts.model,
      system: opts.system,
      messages: opts.messages.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: typeof m.content === "string" ? m.content : "",
      })),
    });
  }
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("La IA no está configurada (falta la clave).");
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: createRunIdFetch(),
  });
  const result = streamText({
    model: provider.responses(opts.model),
    system: opts.system,
    messages: opts.messages,
    output: Output.object({ schema: qualificationSchema }),
    maxRetries: 0,
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  const output = (await result.output) as Qualification;
  const usage = await result.totalUsage;
  return {
    output,
    usage: {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
      total: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    },
  };
}
