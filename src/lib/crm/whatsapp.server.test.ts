import { describe, expect, it, vi } from "vitest";
import { planChannelSave } from "./whatsapp.server";

const base = {
  phoneNumberId: "",
  clearAccessToken: false,
  clearAppSecret: false,
  enabled: false,
};
const ok = async () => ({ ok: true as const, name: "Pulse", phone: "+52 55" });
const rejected = async () => ({ ok: false as const, error: "Invalid OAuth access token" });

describe("planChannelSave (phone_number_id de otra cuenta)", () => {
  it("no guarda un Phone Number ID que Meta no confirma con el token de la cuenta", async () => {
    const r = await planChannelSave(
      { ...base, phoneNumberId: "1000001", accessToken: "token-ajeno" },
      null,
      rejected,
    );
    expect(r).toEqual({ ok: false, error: "Invalid OAuth access token" });
  });

  it("no permite reservar un Phone Number ID sin token, ni deshabilitado", async () => {
    const check = vi.fn(ok);
    const r = await planChannelSave({ ...base, phoneNumberId: "1000001" }, null, check);
    expect(r.ok).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it("no habilita el canal sin credenciales", async () => {
    const r = await planChannelSave({ ...base, enabled: true }, null, ok);
    expect(r).toEqual({ ok: false, error: "Faltan Phone Number ID o Access Token" });
  });

  it("guarda cuando Meta confirma el número", async () => {
    const r = await planChannelSave(
      { ...base, phoneNumberId: "1000001", accessToken: "t", appSecret: "s", enabled: true },
      null,
      ok,
    );
    expect(r).toEqual({ ok: true, token: "t", appSecret: "s", info: "Pulse +52 55" });
  });

  it("permite apagar o borrar el token de un número ya verificado sin volver a validar", async () => {
    const check = vi.fn(rejected);
    const cur = { phone_number_id: "1000001", access_token: "viejo", app_secret: "s" };
    const r = await planChannelSave(
      { ...base, phoneNumberId: "1000001", clearAccessToken: true },
      cur,
      check,
    );
    expect(r).toEqual({ ok: true, token: "", appSecret: "s", info: "" });
    expect(check).not.toHaveBeenCalled();
  });

  it("vuelve a validar si cambia el número aunque el canal esté apagado", async () => {
    const check = vi.fn(rejected);
    const cur = { phone_number_id: "1000001", access_token: "t", app_secret: "" };
    const r = await planChannelSave({ ...base, phoneNumberId: "2000002" }, cur, check);
    expect(r.ok).toBe(false);
    expect(check).toHaveBeenCalledWith("2000002", "t");
  });
});

describe("plantillas y archivos de WhatsApp", async () => {
  const { mediaType, parseMetaTemplates, templatePayload } = await import("./whatsapp.server");
  const pdf = {
    id: "m",
    accountId: "a",
    name: "Catálogo",
    kind: "pdf" as const,
    url: "https://x/c.pdf",
  };

  it("solo guarda plantillas aprobadas que Pulse sabe llenar", () => {
    const { rows, skipped } = parseMetaTemplates([
      {
        name: "seguimiento",
        language: "es_MX",
        status: "APPROVED",
        category: "MARKETING",
        components: [{ type: "BODY", text: "Hola {{1}}, ¿viste {{2}}? {{1}}" }],
      },
      {
        name: "catalogo",
        language: "es_MX",
        status: "APPROVED",
        components: [
          { type: "HEADER", format: "DOCUMENT" },
          { type: "BODY", text: "Hola {{nombre}}" },
        ],
      },
      { name: "pendiente", language: "es", status: "PENDING", components: [] },
      {
        name: "con_variable_arriba",
        language: "es",
        status: "APPROVED",
        components: [{ type: "HEADER", format: "TEXT", text: "Hola {{1}}" }],
      },
      {
        name: "boton_variable",
        language: "es",
        status: "APPROVED",
        components: [{ type: "BUTTONS", buttons: [{ type: "URL", url: "https://x/{{1}}" }] }],
      },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ name: "seguimiento", params: ["1", "2"], headerFormat: null }),
      expect.objectContaining({ name: "catalogo", params: ["nombre"], headerFormat: "DOCUMENT" }),
    ]);
    expect(skipped).toEqual(["con_variable_arriba", "boton_variable"]);
  });

  it("arma el envío con variables por posición o por nombre y el archivo del encabezado", () => {
    expect(
      templatePayload({ name: "t", language: "es_MX", headerFormat: null, params: ["1"] }, [""]),
    ).toEqual({
      type: "template",
      template: {
        name: "t",
        language: { code: "es_MX" },
        components: [{ type: "body", parameters: [{ type: "text", text: "-" }] }],
      },
    });
    const p = templatePayload(
      { name: "c", language: "es", headerFormat: "DOCUMENT", params: ["nombre"] },
      ["Ana"],
      pdf,
    );
    expect(p.template.components).toEqual([
      {
        type: "header",
        parameters: [
          {
            type: "document",
            document: { link: pdf.url, caption: "Catálogo", filename: "Catálogo.pdf" },
          },
        ],
      },
      { type: "body", parameters: [{ type: "text", parameter_name: "nombre", text: "Ana" }] },
    ]);
  });

  it("exige el archivo cuando la plantilla lo lleva en el encabezado", () => {
    expect(() =>
      templatePayload({ name: "c", language: "es", headerFormat: "VIDEO", params: [] }, [], pdf),
    ).toThrow(/video/);
  });

  it("las notas de voz van como audio y los videos de YouTube como enlace", () => {
    expect(mediaType({ ...pdf, kind: "audio", url: "https://x/n.ogg" })).toBe("audio");
    expect(mediaType({ ...pdf, kind: "video", url: "https://youtu.be/abc" })).toBeNull();
    expect(mediaType(pdf)).toBe("document");
  });
});
