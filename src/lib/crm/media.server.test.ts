import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      // jsdom parece un navegador; en el Worker real no aplica.
      super({ ...opts, dangerouslyAllowBrowser: true });
      (this.messages as unknown as { create: typeof create }).create = create;
    }
  }
  return { ...actual, default: FakeAnthropic };
});

const { mediaOf, mediaToText } = await import("./media.server");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Meta responde la URL temporal y luego el archivo; OpenAI responde la transcripción. */
function fakeNet(opts: { mime: string; size?: number; transcript?: Response }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://graph.facebook.com/"))
      return json({
        url: "https://lookaside.fbsbx.com/f",
        mime_type: opts.mime,
        file_size: opts.size,
      });
    if (url === "https://lookaside.fbsbx.com/f") return new Response(new Uint8Array([1, 2, 3]));
    if (url === "https://api.openai.com/v1/audio/transcriptions")
      return opts.transcript ?? json({ text: "  Hola, quiero\n informes " });
    throw new Error(`fetch inesperado: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mediaOf", () => {
  it("reconoce notas de voz, fotos con texto y documentos", () => {
    expect(mediaOf({ type: "audio", audio: { id: "a" } })).toEqual({ kind: "audio", id: "a" });
    expect(mediaOf({ type: "image", image: { id: "i", caption: "¿precio?" } })).toEqual({
      kind: "image",
      id: "i",
      caption: "¿precio?",
    });
    expect(mediaOf({ type: "document", document: { id: "d", filename: "INE.pdf" } })).toMatchObject(
      { kind: "document", filename: "INE.pdf" },
    );
    expect(mediaOf({ type: "text" })).toBeNull();
  });
});

describe("mediaToText", () => {
  it("transcribe la nota de voz con el token del canal", async () => {
    const f = fakeNet({ mime: "audio/ogg; codecs=opus" });
    const text = await mediaToText({ kind: "audio", id: "a1" }, "tok");
    expect(text).toBe("🎤 (nota de voz) Hola, quiero informes");
    const graphCall = f.mock.calls[0]!;
    expect(String(graphCall[0])).toMatch(/\/a1$/);
    expect(graphCall[1]!.headers).toEqual({ Authorization: "Bearer tok" });
    const form = f.mock.calls[2]![1]!.body as FormData;
    expect(form.get("language")).toBe("es");
    expect((form.get("file") as File).name).toBe("nota.ogg");
  });

  it("sin OPENAI_API_KEY no se cae: avisa que no se pudo transcribir", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    fakeNet({ mime: "audio/ogg" });
    expect(await mediaToText({ kind: "audio", id: "a" }, "tok")).toBe(
      "🎤 (nota de voz que no se pudo transcribir)",
    );
  });

  it("si OpenAI falla deja el aviso en lugar de perder el mensaje", async () => {
    fakeNet({ mime: "audio/ogg", transcript: json({ error: { message: "quota" } }, 429) });
    expect(await mediaToText({ kind: "audio", id: "a" }, "tok")).toBe(
      "🎤 (nota de voz que no se pudo transcribir)",
    );
  });

  it("no descarga audios más grandes de lo que WhatsApp permite", async () => {
    const f = fakeNet({ mime: "audio/ogg", size: 30 * 1024 * 1024 });
    expect(await mediaToText({ kind: "audio", id: "a" }, "tok")).toContain("no se pudo");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("describe la foto con Claude y conserva lo que escribió el lead", async () => {
    fakeNet({ mime: "image/jpeg" });
    create.mockResolvedValue({
      content: [{ type: "text", text: "Captura de un anuncio:\n«Preventa desde $1.2 MDP»" }],
    });
    const text = await mediaToText({ kind: "image", id: "i", caption: "¿sigue?" }, "tok");
    expect(text).toBe("🖼️ (imagen: Captura de un anuncio: «Preventa desde $1.2 MDP») ¿sigue?");
    const req = create.mock.calls[0]![0];
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.messages[0].content[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AQID" },
    });
  });

  it("si no puede leer la foto deja el aviso y el texto del lead", async () => {
    fakeNet({ mime: "image/heic" });
    expect(await mediaToText({ kind: "image", id: "i", caption: "esta" }, "tok")).toBe(
      "🖼️ (imagen que no se pudo leer) esta",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("videos y documentos no se descargan: se anotan con su texto", async () => {
    const f = fakeNet({ mime: "video/mp4" });
    expect(await mediaToText({ kind: "video", id: "v", caption: "mira" }, "tok")).toBe(
      "🎬 (video) mira",
    );
    expect(await mediaToText({ kind: "document", id: "d", filename: "INE.pdf" }, "tok")).toBe(
      "📄 (documento «INE.pdf»)",
    );
    expect(f).not.toHaveBeenCalled();
  });
});
