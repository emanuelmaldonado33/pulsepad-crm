import { describe, expect, it } from "vitest";
import { newQrCode, parseQrRef, qrLink, qrMessage } from "./qr";

describe("QR por lona", () => {
  it("arma el enlace de WhatsApp con el código en el mensaje", () => {
    const link = qrLink("+52 33 1234 5678", "AB12");
    expect(link.startsWith("https://wa.me/523312345678?text=")).toBe(true);
    expect(decodeURIComponent(link.split("text=")[1]!)).toBe(qrMessage("AB12"));
  });

  it("lee el código del primer mensaje aunque el cliente lo edite", () => {
    expect(parseQrRef(qrMessage("AB12"))).toBe("AB12");
    expect(parseQrRef("hola!! precio? ref: x7k9")).toBe("X7K9");
    expect(parseQrRef("Ref #MN34PQ")).toBe("MN34PQ");
  });

  it("no confunde palabras normales con un código", () => {
    expect(parseQrRef("¿Tienen referencias de otros clientes?")).toBeNull();
    expect(parseQrRef("Hola, quiero información")).toBeNull();
    expect(parseQrRef("ref ab")).toBeNull();
  });

  it("genera códigos legibles que pasan la validación de la base", () => {
    for (let i = 0; i < 50; i++) expect(newQrCode()).toMatch(/^[A-HJKMNPQR-Z2346-9]{4}$/);
  });
});
