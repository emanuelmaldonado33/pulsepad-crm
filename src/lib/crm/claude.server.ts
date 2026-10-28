import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { qualificationSchema, type Qualification } from "./ai.server";

/** Los modelos de Claude se guardan en accounts.ai_model como "anthropic/<id del modelo>". */
export const CLAUDE_PREFIX = "anthropic/";
export const isClaudeModel = (model: string) => model.startsWith(CLAUDE_PREFIX);

type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * La API de Claude exige que la conversación empiece con el usuario. En WhatsApp a veces
 * escribe primero el bot (un flujo de seguimiento), así que se antepone un turno neutro.
 */
export function toClaudeMessages(turns: ChatTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const clean = turns.filter((t) => t.content.trim());
  if (clean[0]?.role !== "user") {
    clean.unshift({ role: "user", content: "(Conversación iniciada por nuestro equipo)" });
  }
  return clean.map((t) => ({ role: t.role, content: t.content }));
}

const fail = (message: string, statusCode?: number) =>
  Object.assign(new Error(message), statusCode ? { statusCode } : {});

/** Califica con Claude usando la API key propia de Anthropic (secreto ANTHROPIC_API_KEY). */
export async function runClaudeQualifier(opts: {
  model: string;
  system: string;
  messages: ChatTurn[];
}): Promise<{ output: Qualification; usage: { input: number; output: number; total: number } }> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw fail("Falta el secreto ANTHROPIC_API_KEY para usar Claude.", 401);
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 });

  let res;
  try {
    res = await client.beta.messages.parse({
      model: opts.model.slice(CLAUDE_PREFIX.length),
      max_tokens: 16000,
      system: opts.system,
      messages: toClaudeMessages(opts.messages),
      // Respuestas cortas de chat: esfuerzo bajo para responder rápido y barato.
      output_config: { effort: "low", format: betaZodOutputFormat(qualificationSchema) },
      // Si el modelo declina por políticas, Anthropic reintenta con su modelo de respaldo.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw fail("Demasiadas solicitudes a Claude.", 429);
    if (
      e instanceof Anthropic.AuthenticationError ||
      e instanceof Anthropic.PermissionDeniedError
    ) {
      throw fail("La API key de Anthropic no es válida o no tiene permisos.", 401);
    }
    if (e instanceof Anthropic.APIError)
      throw fail(`Claude respondió ${e.status ?? "un error"}.`, e.status);
    throw e;
  }
  if (res.stop_reason === "refusal") throw fail("Claude declinó responder este mensaje.");
  if (!res.parsed_output) throw fail("Claude no devolvió una respuesta con el formato esperado.");
  const input = res.usage.input_tokens;
  const output = res.usage.output_tokens;
  return { output: res.parsed_output, usage: { input, output, total: input + output } };
}
