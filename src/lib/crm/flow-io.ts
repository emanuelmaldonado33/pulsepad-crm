import {
  FIELD_LABEL,
  sid,
  type ConditionRule,
  type Flow,
  type FlowStep,
  type LeadNumberField,
  type TriggerType,
  type WaitUnit,
} from "./flows";

export const FLOW_FILE_VERSION = 1;
export const MAX_BRANCH_DEPTH = 3;

/** Formato portátil (sin ids de subcuenta). Los adjuntos viajan por nombre de material. */
export function exportFlow(f: Flow, materialName: (id: string | null) => string | null) {
  const out = (steps: FlowStep[]): unknown[] =>
    steps.map(({ id: _id, ...s }) =>
      s.type === "message"
        ? { type: s.type, text: s.text, material: materialName(s.materialId) }
        : s.type === "condition"
          ? { type: s.type, rule: s.rule, yes: out(s.yes), no: out(s.no) }
          : s,
    );
  return {
    format: "nexo-crm-flow",
    version: FLOW_FILE_VERSION,
    name: f.name,
    trigger: { type: f.triggerType, value: f.triggerValue },
    stopOnReply: f.stopOnReply,
    steps: out(f.steps),
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
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) throw new Error("El flujo no tiene pasos");
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

  let count = 0;
  const parseRule = (v: unknown, at: string): ConditionRule => {
    const r = (v ?? {}) as Record<string, unknown>;
    const kind = str(r["kind"], 20);
    if (kind === "replied" || kind === "appointment") return { kind };
    if (kind === "tag") {
      const tag = tagify(r["tag"] ?? r["value"]);
      if (!tag) throw new Error(`La condición ${at} no indica la etiqueta`);
      return { kind, tag };
    }
    if (kind === "stage") {
      const stage = stageOf(r["stage"] ?? r["value"]);
      if (stage == null) throw new Error(`La condición ${at} usa una etapa inválida`);
      return { kind, op: r["op"] === "eq" ? "eq" : "gte", stage };
    }
    if (kind === "field") {
      const field = str(r["field"], 20) as LeadNumberField;
      if (!(field in FIELD_LABEL)) throw new Error(`La condición ${at} usa un dato desconocido`);
      const op = r["op"] === "gte" || r["op"] === "lte" ? r["op"] : "set";
      const value = Math.max(0, Number(r["value"]) || 0);
      return { kind, field, op, value };
    }
    throw new Error(`La condición ${at} es de un tipo desconocido («${kind}»)`);
  };
  const parseSteps = (list: unknown, depth: number, prefix: string): FlowStep[] => {
    if (list == null) return [];
    if (!Array.isArray(list)) throw new Error(`Las ramas del paso ${prefix} deben ser listas`);
    return list.map((r, idx) => {
      const at = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
      if (++count > 50) throw new Error("Máximo 50 pasos por flujo");
      const s = (r ?? {}) as Record<string, unknown>;
      const type = str(s["type"], 20);
      if (type === "message") {
        const text = str(s["text"], 4000).trim();
        if (!text) throw new Error(`El paso ${at} es un mensaje vacío`);
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
          if (v == null) throw new Error(`El paso ${at} cambia a una etapa inválida`);
          return { id: sid(), type, action, value: v };
        }
        if (action === "add_tag" || action === "remove_tag") {
          const v = tagify(s["value"]);
          if (!v) throw new Error(`El paso ${at} no indica la etiqueta`);
          return { id: sid(), type, action, value: v };
        }
        throw new Error(`El paso ${at} tiene una acción desconocida`);
      }
      if (type === "condition") {
        if (depth >= MAX_BRANCH_DEPTH)
          throw new Error(`Máximo ${MAX_BRANCH_DEPTH} condiciones una dentro de otra`);
        return {
          id: sid(),
          type,
          rule: parseRule(s["rule"] ?? s["if"], at),
          yes: parseSteps(s["yes"], depth + 1, `${at}.sí`),
          no: parseSteps(s["no"], depth + 1, `${at}.no`),
        };
      }
      if (type === "end") return { id: sid(), type };
      throw new Error(`El paso ${at} tiene un tipo desconocido («${type}»)`);
    });
  };
  const steps = parseSteps(rawSteps, 0, "");

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
