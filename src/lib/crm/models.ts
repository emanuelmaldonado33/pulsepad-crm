/** Modelos que una subcuenta puede usar para el bot. El servidor ignora cualquier otro valor. */
export const AI_MODELS = [
  ["openai/gpt-6-astra", "Máxima calidad"],
  ["openai/gpt-6-sol", "Equilibrado"],
  ["openai/gpt-6-luna", "Rápido y económico"],
  // Claude usa tu propia API key de Anthropic (secreto ANTHROPIC_API_KEY).
  ["anthropic/claude-opus-5-5", "Claude Opus 5.5 · máxima calidad"],
  ["anthropic/claude-sonnet-5-5", "Claude Sonnet 5.5 · equilibrado"],
  ["anthropic/claude-haiku-5-5", "Claude Haiku 5.5 · rápido y económico"],
] as const;

export type AiModel = (typeof AI_MODELS)[number][0];

/** Modelo de las subcuentas nuevas: el económico, que es con el que se calculó el precio del plan. */
export const DEFAULT_AI_MODEL: AiModel = "openai/gpt-6-luna";

/** El modelo guardado si está permitido; si no (texto cambiado a mano), el económico. */
export const allowedModel = (model: string | null | undefined): AiModel =>
  AI_MODELS.find(([id]) => id === model)?.[0] ?? DEFAULT_AI_MODEL;
