import { describe, expect, it } from "vitest";
import { exportFlow, extractJson, parseFlow } from "./flow-io";
import type { Flow } from "./flows";

const mats = [{ id: "m1", name: "Video de avances" }];

describe("importar/exportar flujos", () => {
  it("ida y vuelta conserva disparador, pasos y adjunto por nombre", () => {
    const f: Flow = { id: "x", accountId: "a", name: "Reactivar", active: true, triggerType: "stage", triggerValue: "2", stopOnReply: true, steps: [
      { id: "1", type: "message", text: "Hola {{nombre}}", materialId: "m1" },
      { id: "2", type: "wait", amount: 1, unit: "day" },
      { id: "3", type: "action", action: "set_stage", value: "5" },
    ] };
    const json = JSON.parse(JSON.stringify(exportFlow(f, (id) => mats.find((m) => m.id === id)?.name ?? null)));
    const back = parseFlow(json, "b", mats);
    expect(back.accountId).toBe("b");
    expect(back.active).toBe(false);
    expect(back.triggerValue).toBe("2");
    expect(back.steps.map((s) => s.type)).toEqual(["message", "wait", "action"]);
    expect(back.steps[0]).toMatchObject({ materialId: "m1" });
  });
  it("acepta etapas como «P5» y unidades en español", () => {
    const f = parseFlow({ trigger: { type: "stage", value: "P5" }, steps: [{ type: "wait", amount: 2, unit: "horas" }] }, "a", []);
    expect(f.triggerValue).toBe("5");
    expect(f.steps[0]).toMatchObject({ unit: "hour", amount: 2 });
  });
  it("rechaza flujos sin pasos o con tipos desconocidos", () => {
    expect(() => parseFlow({ steps: [] }, "a", [])).toThrow();
    expect(() => parseFlow({ steps: [{ type: "email" }] }, "a", [])).toThrow();
  });
  it("extrae JSON de un bloque ```json", () => {
    expect(extractJson('Aquí está:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
