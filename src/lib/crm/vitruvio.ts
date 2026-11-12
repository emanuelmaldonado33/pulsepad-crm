/**
 * Conexión con Vitruvio Med (expediente clínico). Vitruvio es dueño de la agenda; Pulsepad es dueño de la
 * conversación por WhatsApp. Contrato: docs/integraciones/pulsepad.md en el repo de Vitruvio.
 *
 * Configuración por secretos (sin migración), una entrada por subcuenta conectada:
 *   VITRUVIO_CONNECTIONS = [{"accountId":"…","clinicId":"…","baseUrl":"https://clinic-care-mx.lovable.app","token":"ppin_…"}]
 *   VITRUVIO_SIGNING_SECRET = el mismo valor que PULSEPAD_SIGNING_SECRET en Vitruvio
 * Sin conexión para la subcuenta, el bot sigue como antes.
 *
 * Todo aquí es lógica pura (sin red) para poder probarla.
 */

export interface VitruvioConnection {
  accountId: string;
  clinicId: string;
  baseUrl: string;
  token: string;
}

export function parseConnections(raw: string | undefined): VitruvioConnection[] {
  if (!raw?.trim()) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((c) => {
      const x = c as Partial<VitruvioConnection>;
      if (
        typeof x.accountId !== "string" ||
        typeof x.clinicId !== "string" ||
        typeof x.token !== "string" ||
        typeof x.baseUrl !== "string"
      )
        return [];
      if (
        !/^https:\/\//.test(x.baseUrl) ||
        !/^[0-9a-f-]{36}$/i.test(x.clinicId) ||
        x.token.length < 24
      )
        return [];
      return [
        {
          accountId: x.accountId,
          clinicId: x.clinicId,
          token: x.token,
          baseUrl: x.baseUrl.replace(/\/+$/, ""),
        },
      ];
    });
  } catch {
    return [];
  }
}

export const connectionFor = (list: VitruvioConnection[], accountId: string) =>
  list.find((c) => c.accountId === accountId) ?? null;
export const connectionForClinic = (list: VitruvioConnection[], clinicId: string) =>
  list.find((c) => c.clinicId === clinicId) ?? null;

// ───────────── Eventos que manda Vitruvio ─────────────

export type VitruvioEventName =
  | "appointment.created"
  | "appointment.rescheduled"
  | "appointment.cancelled"
  | "appointment.updated";
export interface VitruvioEvent {
  evento: VitruvioEventName;
  clinicId: string;
  consultorio: string;
  cita: {
    id: string;
    fecha: string;
    hora: string;
    duracion: number;
    motivo: string;
    status: string;
    confirmacion: string | null;
    origen: string;
  };
  antes: { fecha: string; hora: string } | null;
  paciente: { id: string; nombre: string; whatsapp: string | null } | null;
}

export function parseEvent(body: unknown): VitruvioEvent | null {
  const e = body as Partial<VitruvioEvent> | null;
  const names: VitruvioEventName[] = [
    "appointment.created",
    "appointment.rescheduled",
    "appointment.cancelled",
    "appointment.updated",
  ];
  if (!e || !names.includes(e.evento as VitruvioEventName) || typeof e.clinicId !== "string")
    return null;
  const c = e.cita;
  if (
    !c ||
    typeof c.id !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(c.fecha ?? "") ||
    !/^\d{2}:\d{2}$/.test(c.hora ?? "")
  )
    return null;
  return e as VitruvioEvent;
}

/** Firma esperada: HMAC-SHA256 en hex de `${timestamp}.${cuerpo}`. Rechaza firmas de más de 5 minutos. */
export async function verifySignature(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
  nowSec = Math.floor(Date.now() / 1000),
) {
  if (!secret || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSec - Number(timestamp)) > 300) return false;
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex"),
  );
  const got = Buffer.from(signature);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** "2026-11-20" + "10:30" en la Ciudad de México → ISO UTC (México ya no tiene horario de verano: UTC-6). */
export const mxToIso = (fecha: string, hora: string) =>
  new Date(`${fecha}T${hora}:00-06:00`).toISOString();

/** Cómo cambia la cita del lead en Pulsepad con cada evento. */
export function eventToAppointment(e: VitruvioEvent): {
  buscarEn: string | null;
  at: string;
  status: "programada" | "realizada" | "cancelada";
} {
  const at = mxToIso(e.cita.fecha, e.cita.hora);
  const buscarEn = e.antes ? mxToIso(e.antes.fecha, e.antes.hora) : at;
  const status =
    e.cita.status === "Cancelada"
      ? "cancelada"
      : e.cita.status === "Atendida"
        ? "realizada"
        : "programada";
  return { buscarEn, at, status };
}

/** Lo que se guarda en lead_events (kind "vitruvio_cita") para saber a qué cita de Vitruvio responde el paciente. */
export type CitaRef = { cita: string; fecha: string; hora: string; status: string };
export const citaRefBody = (r: CitaRef) => JSON.stringify(r);
export function parseCitaRef(body: string | null | undefined): CitaRef | null {
  try {
    const r = JSON.parse(body ?? "") as Partial<CitaRef>;
    return typeof r.cita === "string" && typeof r.fecha === "string" && typeof r.hora === "string"
      ? { cita: r.cita, fecha: r.fecha, hora: r.hora, status: r.status ?? "Programada" }
      : null;
  } catch {
    return null;
  }
}

// ───────────── Respuestas del paciente ─────────────

const norm = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Botón o respuesta corta del paciente sobre su cita (los botones de las plantillas llegan como texto). */
export function quickReply(text: string): "confirmar" | "reagendar" | "cancelar" | null {
  const t = norm(text);
  if (!t || t.split(" ").length > 4) return null;
  if (/^(confirmar|confirmo|si confirmo|confirmada|si asistire|ahi estare)$/.test(t))
    return "confirmar";
  if (/^(reagendar|reprogramar|cambiar (mi )?cita|otro horario|cambiar horario)$/.test(t))
    return "reagendar";
  if (/^(cancelar|cancelo|cancelar (mi )?cita)$/.test(t)) return "cancelar";
  return null;
}

export type Dia = { fecha: string; horas: string[] };
/** Hasta `max` horarios repartidos entre los días (primero uno por día, para dar variedad). */
export function flattenSlots(dias: Dia[], max = 3): { fecha: string; hora: string }[] {
  const out: { fecha: string; hora: string }[] = [];
  for (let i = 0; out.length < max && dias.some((d) => d.horas[i]); i++)
    for (const d of dias)
      if (d.horas[i] && out.length < max) out.push({ fecha: d.fecha, hora: d.horas[i]! });
  return out.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
export function fechaLarga(fecha: string) {
  const d = new Date(`${fecha}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

export function optionsText(intro: string, slots: { fecha: string; hora: string }[]) {
  if (!slots.length)
    return `${intro}\n\nPor ahora no vemos horarios libres en los próximos días. En breve el consultorio te escribe para darte opciones.`;
  return `${intro}\n\n${slots.map((s, i) => `${i + 1}. ${fechaLarga(s.fecha)} a las ${s.hora}`).join("\n")}\n\nResponde con el número de la opción.`;
}

/** El paciente eligió "1", "la 2", "opción 3"… de la lista que se le mandó. */
export function pickOption(text: string, n: number): number | null {
  const m = /^(?:la |el |opcion |numero )?([1-9])$/.exec(norm(text));
  const i = m ? Number(m[1]) - 1 : -1;
  return i >= 0 && i < n ? i : null;
}

/** Opciones ofrecidas (lead_events kind "vitruvio_opciones"). Valen 24 h. */
export type Offer = { cita: string | null; opciones: { fecha: string; hora: string }[] };
export function parseOffer(
  body: string | null | undefined,
  createdAt: string | null | undefined,
  now = Date.now(),
): Offer | null {
  if (!createdAt || now - Date.parse(createdAt) > 24 * 3600_000) return null;
  try {
    const o = JSON.parse(body ?? "") as Partial<Offer>;
    return Array.isArray(o.opciones)
      ? { cita: typeof o.cita === "string" ? o.cita : null, opciones: o.opciones }
      : null;
  } catch {
    return null;
  }
}
