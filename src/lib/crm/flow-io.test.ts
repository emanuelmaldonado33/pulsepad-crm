import { describe, expect, it } from "vitest";
import { exportFlow, extractJson, parseFlow, parseTriggerConfig } from "./flow-io";
import type { Flow, FlowStep } from "./flows";

const mats = [{ id: "m1", name: "Video de avances" }];

describe("importar/exportar flujos", () => {
  it("ida y vuelta conserva disparador, pasos y adjunto por nombre", () => {
    const f: Flow = {
      id: "x",
      accountId: "a",
      name: "Reactivar",
      active: true,
      triggerType: "stage",
      triggerValue: "2",
      triggerConfig: {},
      allowReentry: true,
      stopOnReply: true,
      steps: [
        { id: "1", type: "message", text: "Hola {{nombre}}", materialId: "m1" },
        { id: "2", type: "wait", amount: 1, unit: "day" },
        { id: "3", type: "action", action: "set_stage", value: "5" },
      ],
    };
    const json = JSON.parse(
      JSON.stringify(exportFlow(f, (id) => mats.find((m) => m.id === id)?.name ?? null)),
    );
    const back = parseFlow(json, "b", mats);
    expect(back.accountId).toBe("b");
    expect(back.active).toBe(false);
    expect(back.triggerValue).toBe("2");
    expect(back.steps.map((s) => s.type)).toEqual(["message", "wait", "action"]);
    expect(back.steps[0]).toMatchObject({ materialId: "m1" });
  });
  it("acepta etapas como «P5» y unidades en español", () => {
    const f = parseFlow(
      {
        trigger: { type: "stage", value: "P5" },
        steps: [{ type: "wait", amount: 2, unit: "horas" }],
      },
      "a",
      [],
    );
    expect(f.triggerValue).toBe("5");
    expect(f.steps[0]).toMatchObject({ unit: "hour", amount: 2 });
  });
  it("rechaza flujos sin pasos o con tipos desconocidos", () => {
    expect(() => parseFlow({ steps: [] }, "a", [])).toThrow();
    expect(() => parseFlow({ steps: [{ type: "email" }] }, "a", [])).toThrow();
  });
  it("ida y vuelta conserva condiciones y ramas", () => {
    const f = parseFlow(
      {
        stopOnReply: false,
        steps: [
          {
            type: "condition",
            rule: { kind: "replied" },
            yes: [{ type: "end" }],
            no: [
              { type: "message", text: "¿Sigues ahí?", material: "Video de avances" },
              {
                type: "condition",
                rule: { kind: "stage", op: "gte", stage: "P4" },
                yes: [],
                no: [{ type: "action", action: "add_tag", value: "#Frío" }],
              },
            ],
          },
        ],
      },
      "a",
      mats,
    );
    expect(f.stopOnReply).toBe(false);
    const back = parseFlow(
      JSON.parse(
        JSON.stringify(exportFlow(f, (id) => mats.find((m) => m.id === id)?.name ?? null)),
      ),
      "a",
      mats,
    );
    const c = back.steps[0] as Extract<FlowStep, { type: "condition" }>;
    expect(c.yes.map((s) => s.type)).toEqual(["end"]);
    expect(c.no[0]).toMatchObject({ materialId: "m1" });
    expect(c.no[1]).toMatchObject({ rule: { kind: "stage", op: "gte", stage: "4" } });
    expect((c.no[1] as typeof c).no[0]).toMatchObject({ value: "frío" });
  });
  it("rechaza condiciones inválidas o demasiado anidadas", () => {
    const cond = (rule: unknown, no: unknown[] = []) => ({ type: "condition", rule, yes: [], no });
    expect(() => parseFlow({ steps: [cond({ kind: "tag", tag: "" })] }, "a", [])).toThrow(
      /etiqueta/,
    );
    expect(() => parseFlow({ steps: [cond({ kind: "clima" })] }, "a", [])).toThrow(/desconocido/);
    const r = { kind: "replied" };
    expect(() => parseFlow({ steps: [cond(r, [cond(r, [cond(r, [cond(r)])])])] }, "a", [])).toThrow(
      /Máximo 3/,
    );
  });
  it("el límite de 50 pasos cuenta los de las ramas", () => {
    const many = Array.from({ length: 30 }, () => ({ type: "wait", amount: 1, unit: "h" }));
    expect(() =>
      parseFlow(
        { steps: [{ type: "condition", rule: { kind: "replied" }, yes: many, no: many }] },
        "a",
        [],
      ),
    ).toThrow(/50/);
  });
  it("extrae JSON de un bloque ```json", () => {
    expect(extractJson('Aquí está:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe("disparadores de conversación en JSON", () => {
  it("ida y vuelta conserva palabras clave, filtro y reingreso", () => {
    const f = parseFlow(
      {
        trigger: {
          type: "keyword",
          config: { keywords: [" precio ", "precio", "cotización", ""], stage: "P2", tag: "#VIP" },
        },
        allowReentry: false,
        steps: [{ type: "end" }],
      },
      "a",
      [],
    );
    expect(f.triggerType).toBe("keyword");
    expect(f.triggerConfig).toEqual({ keywords: ["precio", "cotización"], stage: 2, tag: "vip" });
    expect(f.allowReentry).toBe(false);
    const back = parseFlow(JSON.parse(JSON.stringify(exportFlow(f, () => null))), "b", []);
    expect(back.triggerConfig).toEqual(f.triggerConfig);
    expect(back.allowReentry).toBe(false);
  });
  it("descarta intenciones desconocidas y exige al menos una", () => {
    const f = parseFlow(
      {
        trigger: { type: "intent", config: { intents: ["pide_precio", "hackear"] } },
        steps: [{ type: "end" }],
      },
      "a",
      [],
    );
    expect(f.triggerConfig).toEqual({ intents: ["pide_precio"] });
    expect(() =>
      parseFlow(
        { trigger: { type: "intent", config: { intents: ["x"] } }, steps: [{ type: "end" }] },
        "a",
        [],
      ),
    ).toThrow(/intención/);
    expect(() =>
      parseFlow({ trigger: { type: "keyword" }, steps: [{ type: "end" }] }, "a", []),
    ).toThrow(/palabras/);
  });
  it("los disparadores de lead no guardan filtros de conversación", () => {
    expect(parseTriggerConfig("new_lead", { stage: 2, keywords: ["x"] })).toEqual({});
    expect(parseTriggerConfig("reply", { stage: 9, tag: "" })).toEqual({});
  });
  it("valida la calificación de IA y conserva el nombre del anuncio", () => {
    expect(
      parseFlow(
        { trigger: { type: "ad_lead", value: " Preventa " }, steps: [{ type: "end" }] },
        "a",
        [],
      ).triggerValue,
    ).toBe("Preventa");
    expect(() =>
      parseFlow(
        { trigger: { type: "qualification", value: "magia" }, steps: [{ type: "end" }] },
        "a",
        [],
      ),
    ).toThrow();
  });
});
