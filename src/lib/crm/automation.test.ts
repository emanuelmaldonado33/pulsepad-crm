import { describe, expect, it } from "vitest";
import { applyTag, extractData, moveToStage, processLeadMessage } from "./automation";
import type { Lead } from "./types";

const base: Lead = {
  id: "t",
  accountId: "a",
  name: "Ana Prueba",
  phone: "",
  source: "",
  stage: 0,
  outcome: null,
  budget: null,
  downPayment: null,
  termMonths: null,
  tags: [],
  notes: "",
  botActive: true,
  messages: [],
  createdAt: "",
};

describe("automatización de etiquetas", () => {
  it("cita-agendada mueve a P5 y pausa el bot", () => {
    const l = applyTag(base, "cita-agendada");
    expect(l.stage).toBe(5);
    expect(l.botActive).toBe(false);
  });
  it("reactivar-bot reactiva el bot", () => {
    expect(applyTag(applyTag(base, "humano"), "reactivar-bot").botActive).toBe(true);
  });
  it("mover a P7 no califica asigna etiqueta no-califica", () => {
    const l = moveToStage(base, 7, "no_califica");
    expect(l.tags).toContain("no-califica");
    expect(l.outcome).toBe("no_califica");
  });
  it("mover etapa reemplaza la etiqueta de etapa anterior", () => {
    const l = moveToStage(moveToStage(base, 2), 4);
    expect(l.tags).toEqual(["perfilado"]);
  });
});

describe("extracción", () => {
  it("lee millones, enganche y plazo", () => {
    expect(extractData("tengo un presupuesto de 1.2 millones").budget).toBe(1_200_000);
    expect(extractData("enganche de 300 mil").downPayment).toBe(300_000);
    expect(extractData("a 3 años").termMonths).toBe(36);
  });
  it("perfil completo lleva a P4", () => {
    let l = processLeadMessage(base, "presupuesto de 1 millón", "x").lead;
    l = processLeadMessage(l, "enganche del 20%", "x").lead;
    l = processLeadMessage(l, "a 24 meses", "x").lead;
    expect(l.downPayment).toBe(200_000);
    expect(l.stage).toBe(4);
  });
});
