import { describe, expect, it } from "vitest";
import { computeQuote, parseLeadsTable, parseMoney } from "./tools";

describe("cotizador", () => {
  it("enganche 20% de 1,000,000 a 24 meses sin interés", () => {
    const q = computeQuote(1_000_000, 20, 24);
    expect(q.downAmount).toBe(200_000);
    expect(q.monthly).toBe(33_333);
  });
  it("con tasa anual aplica amortización", () => {
    expect(computeQuote(100_000, 0, 12, 12).monthly).toBe(8_885);
  });
  it("de contado no tiene mensualidad", () => {
    expect(computeQuote(500_000, 100, 0).monthly).toBe(0);
  });
});

describe("importador CSV", () => {
  it("lee encabezados en español y montos", () => {
    const { rows } = parseLeadsTable("Nombre,Teléfono,Presupuesto,Etiqueta inicial\nAna Ruiz,5512345678,\"$1,200,000\",VIP");
    expect(rows[0]).toEqual({ name: "Ana Ruiz", phone: "5512345678", budget: 1_200_000, tag: "vip" });
  });
  it("acepta tabla pegada con tabuladores y sin encabezado", () => {
    const { rows } = parseLeadsTable("Luis\t555\t850 mil\twebinar");
    expect(rows[0]!.budget).toBe(850_000);
  });
  it("reporta filas sin nombre", () => {
    expect(parseLeadsTable("nombre,telefono\n,555").errors).toHaveLength(1);
  });
  it("1.5M = 1,500,000", () => expect(parseMoney("1.5M")).toBe(1_500_000));
});
