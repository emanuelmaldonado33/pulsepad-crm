import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted, openChannel } from "./secrets.server";

const KEY = Buffer.alloc(32, 7).toString("base64");
afterEach(() => {
  delete process.env["CHANNEL_SECRETS_KEY"];
});

describe("credenciales de WhatsApp cifradas", () => {
  it("cifra y descifra con CHANNEL_SECRETS_KEY", async () => {
    process.env["CHANNEL_SECRETS_KEY"] = KEY;
    const enc = await encryptSecret("EAAtoken");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("EAAtoken");
    expect(await decryptSecret(enc)).toBe("EAAtoken");
  });
  it("lee en claro lo que se guardó antes del cifrado", async () => {
    process.env["CHANNEL_SECRETS_KEY"] = KEY;
    const ch = await openChannel({ access_token: "EAAviejo", app_secret: "" });
    expect(ch.access_token).toBe("EAAviejo");
  });
  it("sin la clave guarda en claro como antes, pero no puede leer lo cifrado", async () => {
    process.env["CHANNEL_SECRETS_KEY"] = KEY;
    const enc = await encryptSecret("x");
    delete process.env["CHANNEL_SECRETS_KEY"];
    expect(await encryptSecret("plano")).toBe("plano");
    await expect(decryptSecret(enc)).rejects.toThrow(/CHANNEL_SECRETS_KEY/);
  });
});
