import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      // jsdom parece un navegador; en el Worker real no aplica.
      super({ ...opts, dangerouslyAllowBrowser: true });
      (this.beta.messages as unknown as { parse: typeof parse }).parse = parse;
    }
  }
  return { ...actual, default: FakeAnthropic };
});

const { runClaudeQualifier, toClaudeMessages, isClaudeModel } = await import("./claude.server");

const output = {
  reply: "Hola",
  budget: null,
  down_payment: null,
  term_months: null,
  intent: "informacion",
  tags_to_add: [],
  appointment_requested: false,
  summary: "",
};

beforeEach(() => {
  parse.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toClaudeMessages", () => {
  it("empieza siempre con el usuario aunque el bot escribiera primero", () => {
    const m = toClaudeMessages([
      { role: "assistant", content: "Hola, ¿sigues interesado?" },
      { role: "user", content: "Sí" },
    ]);
    expect(m[0]!.role).toBe("user");
    expect(m).toHaveLength(3);
  });

  it("descarta mensajes vacíos", () => {
    expect(
      toClaudeMessages([
        { role: "user", content: "  " },
        { role: "user", content: "hola" },
      ]),
    ).toEqual([{ role: "user", content: "hola" }]);
  });
});

describe("runClaudeQualifier", () => {
  it("reconoce los modelos de Claude por su prefijo", () => {
    expect(isClaudeModel("anthropic/claude-opus-5-5")).toBe(true);
    expect(isClaudeModel("openai/gpt-6-astra")).toBe(false);
  });

  it("usa la API key propia, el id del modelo sin prefijo, salida estructurada y respaldo", async () => {
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: output,
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    const r = await runClaudeQualifier({
      model: "anthropic/claude-sonnet-5-5",
      system: "Eres el setter",
      messages: [{ role: "user", content: "hola" }],
    });
    expect(r).toEqual({ output, usage: { input: 100, output: 20, total: 120 } });
    const params = parse.mock.calls[0]![0];
    expect(params).toMatchObject({
      model: "claude-sonnet-5-5",
      system: "Eres el setter",
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
      output_config: { effort: "low" },
    });
    expect(params.output_config.format).toBeDefined();
  });

  it("sin ANTHROPIC_API_KEY falla con un mensaje claro", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(
      runClaudeQualifier({ model: "anthropic/claude-opus-5-5", system: "", messages: [] }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(parse).not.toHaveBeenCalled();
  });

  it("traduce el límite de tasa a 429", async () => {
    parse.mockRejectedValue(
      new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers()),
    );
    await expect(
      runClaudeQualifier({ model: "anthropic/claude-opus-5-5", system: "", messages: [] }),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("una negativa de Claude es un error, no una respuesta vacía", async () => {
    parse.mockResolvedValue({
      stop_reason: "refusal",
      parsed_output: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    await expect(
      runClaudeQualifier({ model: "anthropic/claude-opus-5-5", system: "", messages: [] }),
    ).rejects.toThrow("declinó");
  });
});
