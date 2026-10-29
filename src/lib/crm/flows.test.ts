import { describe, expect, it } from "vitest";
import { exportFlow, parseFlow } from "./flow-io";
import {
  END_NODE,
  FLOW_TEMPLATES,
  matchKeyword,
  normalizeText,
  triggerLabel,
  triggerProblem,
  allSteps,
  branchStart,
  evaluateCondition,
  flowGraph,
  matchTriggers,
  renderText,
  resumeNode,
  waitMs,
  type Flow,
  type FlowStep,
} from "./flows";
import type { Account, Lead } from "./types";

const lead = {
  id: "l",
  accountId: "a",
  name: "Ana López",
  stage: 2,
  tags: ["calificando"],
  budget: 1200000,
} as Lead;
const account = { name: "Espacio FX", product: "Fondo" } as Account;
const flow = (p: Partial<Flow>): Flow => ({
  id: "f",
  accountId: "a",
  name: "",
  active: true,
  triggerType: "new_lead",
  triggerValue: "",
  triggerConfig: {},
  allowReentry: true,
  steps: [],
  stopOnReply: true,
  ...p,
});

describe("flujos", () => {
  it("reemplaza variables dinámicas", () => {
    expect(renderText("Hola {{nombre}} de {{proyecto}}", { lead, account })).toBe(
      "Hola Ana de Espacio FX",
    );
  });
  it("2 horas de espera = 7,200,000 ms", () => expect(waitMs(2, "hour")).toBe(7_200_000));
  it("lead nuevo dispara solo flujos de lead nuevo", () => {
    expect(matchTriggers([flow({})], undefined, lead)).toHaveLength(1);
    expect(matchTriggers([flow({})], { stage: 1, tags: [] }, lead)).toHaveLength(0);
  });
  it("entrar a etapa dispara una sola vez", () => {
    const f = flow({ triggerType: "stage", triggerValue: "2" });
    expect(matchTriggers([f], { stage: 1, tags: [] }, lead)).toHaveLength(1);
    expect(matchTriggers([f], { stage: 2, tags: [] }, lead)).toHaveLength(0);
  });
  it("recibir etiqueta dispara; flujo apagado no", () => {
    const f = flow({ triggerType: "tag", triggerValue: "calificando" });
    expect(matchTriggers([f], { stage: 1, tags: [] }, lead)).toHaveLength(1);
    expect(matchTriggers([{ ...f, active: false }], { stage: 1, tags: [] }, lead)).toHaveLength(0);
  });
});

describe("ramas sí/no", () => {
  const steps: FlowStep[] = [
    { id: "a", type: "message", text: "", materialId: null },
    {
      id: "c",
      type: "condition",
      rule: { kind: "tag", tag: "caliente" },
      yes: [{ id: "y", type: "end" }],
      no: [],
    },
    { id: "z", type: "wait", amount: 1, unit: "day" },
  ];
  const g = flowGraph(steps);

  it("al terminar una rama sigue el paso de después de la condición", () => {
    expect(g.get("a")!.next).toBe("c");
    expect(g.get("y")!.next).toBe("z");
    expect(g.get("z")!.next).toBeNull();
  });
  it("una rama vacía salta directo al siguiente paso", () => {
    const c = steps[1] as Extract<FlowStep, { type: "condition" }>;
    expect(branchStart(c, "z", true)).toBe("y");
    expect(branchStart(c, "z", false)).toBe("z");
  });
  it("cuenta los pasos de las ramas", () => expect(allSteps(steps)).toHaveLength(4));
  it("retoma por id, por índice (inscripciones viejas) o detecta pasos borrados", () => {
    expect(resumeNode(g, steps, { currentNode: "z", currentStep: 9 })).toBe("z");
    expect(resumeNode(g, steps, { currentNode: null, currentStep: 1 })).toBe("c");
    expect(resumeNode(g, steps, { currentNode: END_NODE, currentStep: 0 })).toBeNull();
    expect(resumeNode(g, steps, { currentNode: "borrado", currentStep: 0 })).toBeUndefined();
  });
  it("evalúa etiqueta, etapa, datos, respuesta y cita", () => {
    const ctx = { lead, replied: false, hasAppointment: true };
    expect(evaluateCondition({ kind: "tag", tag: "calificando" }, ctx)).toBe(true);
    expect(evaluateCondition({ kind: "tag", tag: "caliente" }, ctx)).toBe(false);
    expect(evaluateCondition({ kind: "stage", op: "eq", stage: "2" }, ctx)).toBe(true);
    expect(evaluateCondition({ kind: "stage", op: "gte", stage: "3" }, ctx)).toBe(false);
    expect(
      evaluateCondition({ kind: "field", field: "budget", op: "gte", value: 1_000_000 }, ctx),
    ).toBe(true);
    expect(
      evaluateCondition({ kind: "field", field: "termMonths", op: "set", value: 0 }, ctx),
    ).toBe(false);
    expect(evaluateCondition({ kind: "replied" }, ctx)).toBe(false);
    expect(evaluateCondition({ kind: "appointment" }, ctx)).toBe(true);
  });
});

describe("disparadores de conversación", () => {
  it("normaliza como flow_norm() de la base", () => {
    expect(normalizeText("¿CUÁNTO   cuesta?")).toBe("cuanto cuesta");
    expect(normalizeText("Ñandú, señor")).toBe("nandu senor");
  });
  it("palabras clave como palabra o frase completa", () => {
    expect(matchKeyword(["cuanto cuesta"], "Hola, ¿cuánto cuesta?")).toBe("cuanto cuesta");
    expect(matchKeyword(["no"], "una nota de noche")).toBeNull();
    expect(matchKeyword(["no"], "No, gracias")).toBe("no");
    expect(matchKeyword(["", " "], "hola")).toBeNull();
  });
  it("describe el disparador en español", () => {
    const stageName = (n: number) => `P${n}`;
    expect(
      triggerLabel(
        {
          triggerType: "keyword",
          triggerValue: "",
          triggerConfig: { keywords: ["precio"], stage: 2 },
        },
        stageName,
      ),
    ).toBe("El mensaje contiene «precio» (solo leads en P2)");
    expect(
      triggerLabel(
        { triggerType: "intent", triggerValue: "", triggerConfig: { intents: ["pide_cita"] } },
        stageName,
      ),
    ).toBe("La IA detecta: pide una cita");
  });
  it("avisa cuando al disparador le falta algo", () => {
    expect(
      triggerProblem(flow({ triggerType: "keyword", triggerConfig: { keywords: [" "] } })),
    ).toMatch(/palabra/);
    expect(triggerProblem(flow({ triggerType: "intent" }))).toMatch(/intención/);
    expect(triggerProblem(flow({ triggerType: "reply" }))).toBeNull();
  });
  it("las plantillas nuevas son válidas al exportar e importar", () => {
    for (const key of ["pidio-cotizacion", "no-me-interesa"]) {
      const t = FLOW_TEMPLATES.find((x) => x.key === key)!;
      const f = flow({
        triggerType: t.triggerType,
        triggerValue: t.triggerValue,
        triggerConfig: t.triggerConfig ?? {},
        allowReentry: t.allowReentry ?? true,
        steps: t.steps([]),
      });
      expect(triggerProblem(f)).toBeNull();
      expect(f.allowReentry).toBe(false);
      const back = parseFlow(JSON.parse(JSON.stringify(exportFlow(f, () => null))), "a", []);
      expect(back.triggerConfig).toEqual(f.triggerConfig);
    }
  });
});
