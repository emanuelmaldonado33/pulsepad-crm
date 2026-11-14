import { describe, expect, it } from "vitest";
import { parseLeadsTable, parseMoney } from "./tools";

describe("importador CSV", () => {
  it("lee encabezados en español y montos", () => {
    const { rows } = parseLeadsTable(
      'Nombre,Teléfono,Presupuesto,Etiqueta inicial\nAna Ruiz,5512345678,"$1,200,000",VIP',
    );
    expect(rows[0]).toEqual({
      name: "Ana Ruiz",
      phone: "+525512345678",
      budget: 1_200_000,
      tag: "vip",
    });
  });
  it("acepta tabla pegada con tabuladores y sin encabezado", () => {
    const { rows } = parseLeadsTable("Luis\t\t850 mil\twebinar");
    expect(rows[0]!.budget).toBe(850_000);
  });
  it("reporta filas sin nombre", () => {
    expect(parseLeadsTable("nombre,telefono\n,555").errors).toHaveLength(1);
  });
  it("pone lada 52 a celulares de 10 dígitos y quita 044", () => {
    const { rows } = parseLeadsTable("nombre,telefono\nAna,55 1234 5678\nLuis,044 33 1234 5678");
    expect(rows.map((r) => r.phone)).toEqual(["+525512345678", "+523312345678"]);
  });
  it("rechaza teléfonos incompletos y repetidos", () => {
    const { rows, errors } = parseLeadsTable(
      "nombre,telefono\nAna,555\nLuis,+52 55 1234 5678\nLuisa,5512345678",
    );
    expect(rows.map((r) => r.name)).toEqual(["Luis"]);
    expect(errors).toHaveLength(2);
  });
  it("1.5M = 1,500,000", () => expect(parseMoney("1.5M")).toBe(1_500_000));
});
