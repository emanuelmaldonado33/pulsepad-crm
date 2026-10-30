import { describe, expect, it } from "vitest";
import { parseStageEvents, RECOMMENDED_STAGE_EVENTS, stageEventKey } from "./meta";
import { exportFlow, parseFlow } from "./flow-io";
import type { Flow } from "./flows";

describe("eventos de Meta por etapa", () => {
  it("sólo guarda momentos y eventos que Meta acepta para WhatsApp", () => {
    expect(
      parseStageEvents({
        nuevo: "LeadSubmitted",
        "4": "Lead",
        "9": "Purchase",
        ganado: "Purchase",
      }),
    ).toEqual({ nuevo: "LeadSubmitted", ganado: "Purchase" });
    expect(parseStageEvents("x")).toEqual({});
    expect(parseStageEvents(RECOMMENDED_STAGE_EVENTS)).toEqual(RECOMMENDED_STAGE_EVENTS);
  });
  it("P7 sólo cuenta como venta si se ganó", () => {
    expect(stageEventKey(4, null)).toBe("4");
    expect(stageEventKey(7, "ganado")).toBe("ganado");
    expect(stageEventKey(7, "no_califica")).toBeNull();
    expect(stageEventKey(0, null)).toBeNull();
  });
});

describe("paso «Enviar evento a Meta» en archivos de flujo", () => {
  const flow = (steps: Flow["steps"]): Flow => ({
    id: "f",
    accountId: "a",
    name: "Venta",
    active: true,
    triggerType: "stage",
    triggerValue: "7",
    triggerConfig: {},
    allowReentry: true,
    stopOnReply: true,
    steps,
  });
  it("sobrevive exportar e importar", () => {
    const f = flow([{ id: "1", type: "meta_event", event: "Purchase", value: 2500000 }]);
    const back = parseFlow(JSON.parse(JSON.stringify(exportFlow(f, () => null))), "a", []);
    expect(back.steps[0]).toMatchObject({ type: "meta_event", event: "Purchase", value: 2500000 });
  });
  it("monto vacío o negativo usa el presupuesto; evento desconocido se rechaza", () => {
    const f = parseFlow(
      { steps: [{ type: "meta_event", event: "QualifiedLead", value: -3 }] },
      "a",
      [],
    );
    expect(f.steps[0]).toMatchObject({ value: null });
    expect(() => parseFlow({ steps: [{ type: "meta_event", event: "Lead" }] }, "a", [])).toThrow(
      /evento de Meta desconocido/,
    );
  });
});
