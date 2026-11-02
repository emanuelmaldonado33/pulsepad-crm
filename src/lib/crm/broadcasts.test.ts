import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENT,
  batchSize,
  estimateCostMxn,
  planAudience,
  qualityStop,
  tierLimit,
  tooManyFailures,
  type SegmentLead,
} from "./broadcasts";

const lead = (id: string, o: Partial<SegmentLead> = {}): SegmentLead => ({
  id,
  stage: 1,
  tags: [],
  source: "WhatsApp",
  phone: "+5213312345678",
  opted_out_at: null,
  ...o,
});

describe("planAudience", () => {
  const ctx = { engaged: new Set(["a", "b", "c", "d", "e"]), recent: new Set(["e"]) };

  it("filtra por etiqueta, etapa y origen y excluye bajas, simulador y recientes", () => {
    const leads = [
      lead("a", { tags: ["preventa"] }),
      lead("b", { tags: ["preventa"], opted_out_at: "2026-11-01T00:00:00Z" }),
      lead("c", { tags: ["preventa"], source: "Simulador" }),
      lead("d", { tags: ["otro"] }),
      lead("e", { tags: ["preventa"] }),
      lead("f", { tags: ["preventa"] }),
    ];
    const r = planAudience(leads, { ...DEFAULT_SEGMENT, tags: ["preventa"] }, ctx);
    expect(r.recipients).toEqual(["a"]);
    expect(r.matched).toBe(5);
    expect(r.excluded).toEqual({ baja: 1, simulador: 1, reciente: 1, nunca_escribio: 1 });
  });

  it("sin «sólo quien escribió» incluye contactos importados", () => {
    const r = planAudience(
      [lead("x", { source: "Importado" })],
      { ...DEFAULT_SEGMENT, onlyEngaged: false },
      { engaged: new Set(), recent: new Set() },
    );
    expect(r.recipients).toEqual(["x"]);
  });

  it("descarta teléfonos inválidos y filtra por etapa", () => {
    const r = planAudience(
      [lead("a", { phone: "123" }), lead("b", { stage: 5 }), lead("c", { stage: 2 })],
      { ...DEFAULT_SEGMENT, stages: [5, 1], onlyEngaged: false, skipRecentDays: 0 },
      { engaged: new Set(), recent: new Set() },
    );
    expect(r.recipients).toEqual(["b"]);
    expect(r.excluded).toEqual({ sin_telefono: 1 });
  });
});

describe("límites", () => {
  it("lee el nivel de Meta y asume 250 sin dato", () => {
    expect(tierLimit("TIER_1K")).toBe(1000);
    expect(tierLimit(null)).toBe(250);
    expect(tierLimit("TIER_UNLIMITED")).toBe(Infinity);
  });

  it("no pasa el tope propio, el de Meta (con margen) ni el lote por minuto", () => {
    expect(
      batchSize({ dailyCap: 200, tier: null, sentByBroadcast24h: 0, sentByAccount24h: 0 }),
    ).toBe(30);
    expect(
      batchSize({ dailyCap: 200, tier: null, sentByBroadcast24h: 190, sentByAccount24h: 190 }),
    ).toBe(10);
    expect(
      batchSize({ dailyCap: 1000, tier: null, sentByBroadcast24h: 0, sentByAccount24h: 220 }),
    ).toBe(5);
    expect(
      batchSize({ dailyCap: 1000, tier: null, sentByBroadcast24h: 0, sentByAccount24h: 300 }),
    ).toBe(0);
  });
});

describe("cuándo frenar", () => {
  it("pausa con muchos fallos sólo si ya hay muestra", () => {
    expect(tooManyFailures(10, 9)).toBe(false);
    expect(tooManyFailures(20, 6)).toBe(true);
    expect(tooManyFailures(40, 5)).toBe(false);
  });

  it("pausa con calidad roja o número marcado", () => {
    expect(qualityStop("RED", null)).toMatch(/rojo/);
    expect(qualityStop("GREEN", "FLAGGED")).toMatch(/marcó/);
    expect(qualityStop("YELLOW", "UNFLAGGED")).toBeNull();
  });

  it("estima el costo por categoría", () => {
    expect(estimateCostMxn("MARKETING", 100)).toBe(80);
    expect(estimateCostMxn("UTILITY", 100)).toBe(20);
  });
});
