import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updates: unknown[] = [];
const channel = { enabled: true, phone_number_id: "PNID", access_token: "tok" };
vi.mock("@/integrations/supabase/client.server", () => {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: channel }),
    update: (v: unknown) => {
      updates.push(v);
      return { eq: async () => ({}) };
    },
  };
  return { supabaseAdmin: { from: () => q } };
});

const { dispatchMessage, dispatchTemplate, sendInternalWhatsApp } =
  await import("./whatsapp.server");

const sentTo = () =>
  fetchMock.mock.calls.map(
    (c) => (JSON.parse((c[1] as RequestInit).body as string) as { to: string }).to,
  );
const fetchMock = vi.fn(
  async (..._: unknown[]) => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] })),
);

beforeEach(() => {
  fetchMock.mockClear();
  updates.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("envíos a México con 521", () => {
  const lead = { accountId: "acc", source: "WhatsApp", messageId: "m1" };

  it("el bot, los flujos y el asesor mandan a 52 + 10 dígitos", async () => {
    await dispatchMessage({ ...lead, phone: "5215512345678", text: "Hola" });
    expect(sentTo()).toEqual(["525512345678"]);
    expect(updates).toContainEqual({ wa_status: "enviado", wa_message_id: "wamid.1" });
  });

  it("las plantillas mandan a 52 + 10 dígitos", async () => {
    await dispatchTemplate({
      ...lead,
      phone: "+52 1 55 1234 5678",
      template: {
        name: "hola",
        language: "es_MX",
        category: "",
        body: "",
        headerFormat: null,
        params: [],
      },
      values: [],
    });
    expect(sentTo()).toEqual(["525512345678"]);
  });

  it("los avisos internos al asesor mandan a 52 + 10 dígitos", async () => {
    await sendInternalWhatsApp("acc", "5215598765432", "Nuevo lead");
    expect(sentTo()).toEqual(["525598765432"]);
  });

  it("otros países salen sin cambio", async () => {
    await dispatchMessage({ ...lead, phone: "+1 415 555 0123", text: "Hi" });
    expect(sentTo()).toEqual(["14155550123"]);
  });
});
