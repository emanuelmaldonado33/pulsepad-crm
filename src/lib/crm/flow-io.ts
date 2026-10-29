import { sid, type Flow, type FlowStep, type TriggerType, type WaitUnit } from "./flows";

export const FLOW_FILE_VERSION = 1;

/** Formato portátil (sin ids de subcuenta). Los adjuntos viajan por nombre de material. */
export function exportFlow(f: Flow, materialName: (id: string | null) => string | null) {
  return {
    format: "nexo-crm-flow",
    version: FLOW_FILE_VERSION,
    name: f.name,
    trigger: { type: f.triggerType, value: f.triggerValue },
    stopOnReply: f.stopOnReply,
    steps: f.steps.map(({ id: _id, ...s }) =>
      s.type === "message"
        ? { type: s.type, text: s.text, material: materialName(s.materialId) }
        : s,
    ),
  };
}

const UNITS: WaitUnit[] = ["min", "hour", "day"];
const unitOf = (u: unknown): WaitUnit => {
  const s = String(u ?? "").toLowerCase();
  if (UNITS.includes(s as WaitUnit)) return s as WaitUnit;
  if (/^(m|mins?|minutos?|minutes?)$/.test(s)) return "min";
  if (/^(h|hrs?|horas?|hours?)$/.test(s)) return "hour";
  if (/^(d|días?|dias?|days?)$/.test(s)) return "day";
  return "hour";
};
const str = (v: unknown, max: number) =>
  (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
const tagify = (v: unknown) =>
  str(v, 40).trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
const stageOf = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/^p/i, ""));
  return Number.isInteger(n) && n >= 0 && n <= 7 ? String(n) : null;
};

/**
 * Valida y normaliza un flujo desde JSON (archivo importado, código pegado o salida de la IA).
 * Lanza Error con mensaje en español si no es utilizable.
 */
export function parseFlow(
  input: unknown,
  accountId: string,
  materials: { id: string; name: string }[],
): Flow {
  const o = (typeof input === "object" && input !== null ? input : null) as Record<
    string,
    unknown
  > | null;
  if (!o) throw new Error("El contenido no es un objeto JSON de flujo");
  const trig = (o["trigger"] ?? {}) as Record<string, unknown>;
  const rawType = str(trig["type"] ?? o["triggerType"] ?? o["trigger_type"], 20);
  const triggerType: TriggerType = rawType === "stage" || rawType === "tag" ? rawType : "new_lead";
  let triggerValue = str(trig["value"] ?? o["triggerValue"] ?? o["trigger_value"], 40);
  if (triggerType === "stage") {
    const s = stageOf(triggerValue);
    if (s == null) throw new Error("El disparador de etapa debe ser P0–P7");
    triggerValue = s;
  } else if (triggerType === "tag") {
    triggerValue = tagify(triggerValue);
    if (!triggerValue) throw new Error("El disparador de etiqueta no tiene etiqueta");
  } else triggerValue = "";

  const rawSteps = o["steps"];
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    if (Array.isArray(o["actions"]) && Array.isArray(o["edges"]) && Array.isArray(o["triggers"])) {
      throw new Error(
        "Este archivo parece una definición de GoHighLevel. Pulse aún no convierte sus disparadores, acciones y ramas automáticamente; crea una versión compatible y revísala antes de activarla.",
      );
    }
    throw new Error("El flujo no tiene pasos compatibles con Pulse");
  }
  if (rawSteps.length > 50) throw new Error("Máximo 50 pasos por flujo");
  const findMat = (v: unknown) => {
    const s = str(v, 200).trim().toLowerCase();
    if (!s) return null;
    return (
      materials.find((m) => m.id === s || m.name.toLowerCase() === s)?.id ??
      materials.find((m) => m.name.toLowerCase().includes(s) || s.includes(m.name.toLowerCase()))
        ?.id ??
      null
    );
  };

  const steps: FlowStep[] = rawSteps.map((r, i) => {
    const s = (r ?? {}) as Record<string, unknown>;
    const type = str(s["type"], 20);
    if (type === "message") {
      const text = str(s["text"], 4000).trim();
      if (!text) throw new Error(`El paso ${i + 1} es un mensaje vacío`);
      return { id: sid(), type, text, materialId: findMat(s["material"] ?? s["materialId"]) };
    }
    if (type === "wait" || type === "wait_appt") {
      const amount = Math.max(1, Math.min(10_000, Math.round(Number(s["amount"]) || 1)));
      return { id: sid(), type, amount, unit: unitOf(s["unit"]) };
    }
    if (type === "action") {
      const action = str(s["action"], 20);
      if (action === "set_stage") {
        const v = stageOf(s["value"]);
        if (v == null) throw new Error(`El paso ${i + 1} cambia a una etapa inválida`);
        return { id: sid(), type, action, value: v };
      }
      if (action === "add_tag" || action === "remove_tag") {
        const v = tagify(s["value"]);
        if (!v) throw new Error(`El paso ${i + 1} no indica la etiqueta`);
        return { id: sid(), type, action, value: v };
      }
      throw new Error(`El paso ${i + 1} tiene una acción desconocida`);
    }
    throw new Error(`El paso ${i + 1} tiene un tipo desconocido («${type}»)`);
  });

  return {
    id: "",
    accountId,
    name: str(o["name"], 120).trim() || "Flujo importado",
    active: false,
    triggerType,
    triggerValue,
    steps,
    stopOnReply: o["stopOnReply"] !== false && o["stop_on_reply"] !== false,
  };
}

/** Extrae el primer objeto JSON de un texto (acepta bloques ```json). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const src = fenced ?? text;
  const a = src.indexOf("{"),
    b = src.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("No se encontró un JSON de flujo");
  try {
    return JSON.parse(src.slice(a, b + 1));
  } catch {
    throw new Error("El JSON del flujo no es válido");
  }
}
