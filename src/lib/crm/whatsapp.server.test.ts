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
