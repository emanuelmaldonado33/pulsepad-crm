import { describe, expect, it } from "vitest";
import { matchTriggers, renderText, waitMs, type Flow } from "./flows";
import type { Account, Lead } from "./types";

const lead = { id: "l", accountId: "a", name: "Ana López", stage: 2, tags: ["calificando"], budget: 1200000 } as Lead;
const account = { name: "Espacio FX", product: "Fondo" } as Account;
const flow = (p: Partial<Flow>): Flow => ({ id: "f", accountId: "a", name: "", active: true, triggerType: "new_lead", triggerValue: "", steps: [], stopOnReply: true, ...p });

describe("flujos", () => {
  it("reemplaza variables dinámicas", () => {
    expect(renderText("Hola {{nombre}} de {{proyecto}}", { lead, account })).toBe("Hola Ana de Espacio FX");
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
