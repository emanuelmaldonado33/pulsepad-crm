import {
  citaRefBody,
  connectionFor,
  connectionForClinic,
  eventToAppointment,
  fechaLarga,
  flattenSlots,
  optionsText,
  parseCitaRef,
  parseConnections,
  parseOffer,
  pickOption,
  quickReply,
  type Dia,
  type VitruvioConnection,
  type VitruvioEvent,
} from "./vitruvio";
import { digits, samePhone } from "./whatsapp.server";

/** Cliente de Vitruvio y reglas de la conversación. Ver vitruvio.ts para la configuración. */

export const vitruvioConnection = (accountId: string) =>
  connectionFor(parseConnections(process.env["VITRUVIO_CONNECTIONS"]), accountId);

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

type Alternativas = Dia[] | string[] | undefined;
/** El webhook de citas nuevas regresa alternativas como ["10:00", …] del mismo día; las demás rutas como días. */
const toDias = (alt: Alternativas, fecha: string): Dia[] =>
  !alt ? [] : typeof alt[0] === "string" ? [{ fecha, horas: alt as string[] }] : (alt as Dia[]);

async function call(
  conn: VitruvioConnection,
  path: string,
  init?: { method: "POST"; body: object },
) {
  const url = `${conn.baseUrl}${path}${path.includes("?") ? "&" : "?"}clinic=${encodeURIComponent(conn.clinicId)}`;
  const r = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      "x-pulsepad-token": conn.token,
      ...(init ? { "Content-Type": "application/json" } : {}),
    },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, body };
}

export async function availability(
  conn: VitruvioConnection,
  dias = 3,
  duracion = 30,
): Promise<Dia[]> {
  const { status, body } = await call(
    conn,
    `/api/public/pulsepad/availability?dias=${dias}&duracion=${duracion}`,
  );
  return status === 200
    ? ((body["dias"] as Dia[] | undefined) ?? []).filter((d) => d.horas.length)
    : [];
}

/**
 * Agenda en Vitruvio probando hasta 3 horarios. Si uno ya se ocupó (409 slot_taken) usa las alternativas que
 * regresa Vitruvio. Devuelve la cita agendada o las opciones que quedan para ofrecerlas al paciente.
 */
export async function bookInVitruvio(
  conn: VitruvioConnection,
  p: { nombre: string; telefono: string; motivo: string },
): Promise<
  | { ok: true; cita: string; fecha: string; hora: string }
  | { ok: false; opciones: { fecha: string; hora: string }[] }
> {
  let candidatos = flattenSlots(await availability(conn), 3);
  for (let intento = 0; intento < 3 && candidatos.length; intento++) {
    const slot = candidatos[0]!;
    const { status, body } = await call(conn, "/api/public/pulsepad/webhook", {
      method: "POST",
      body: {
        nombre: p.nombre,
        telefono: p.telefono,
        motivo: p.motivo,
        fecha: slot.fecha,
        hora: slot.hora,
      },
    });
    if (status === 200 && typeof body["appointmentId"] === "string")
      return { ok: true, cita: body["appointmentId"], ...slot };
    if (status !== 409) break;
    const alt = flattenSlots(toDias(body["alternativas"] as Alternativas, slot.fecha), 3);
    candidatos = alt.length ? alt : candidatos.slice(1);
  }
  return { ok: false, opciones: candidatos };
}

type Lead = { id: string; name: string; phone: string; source: string };

async function saveRef(
  accountId: string,
  leadId: string,
  ref: { cita: string; fecha: string; hora: string; status: string },
) {
  const sb = await admin();
  await sb.from("lead_events").insert({
    account_id: accountId,
    lead_id: leadId,
    kind: "vitruvio_cita",
    body: citaRefBody(ref),
  });
}
async function saveOffer(
  accountId: string,
  leadId: string,
  cita: string | null,
  opciones: { fecha: string; hora: string }[],
) {
  const sb = await admin();
  await sb.from("lead_events").insert({
    account_id: accountId,
    lead_id: leadId,
    kind: "vitruvio_opciones",
    body: JSON.stringify({ cita, opciones }),
  });
}
async function lastEvent(leadId: string, kind: string) {
  const sb = await admin();
  const { data } = await sb
    .from("lead_events")
    .select("body, created_at")
    .eq("lead_id", leadId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

/**
 * El bot quiere agendar: en lugar de prometer un horario fijo, agenda en Vitruvio el primer horario libre real.
 * Regresa el texto para el paciente, o null si la subcuenta no está conectada a Vitruvio (o es el simulador).
 */
export async function bookForLead(
  accountId: string,
  lead: Lead,
  motivo: string,
): Promise<{ reply: string; booked: { at: string } | null } | null> {
  const conn = vitruvioConnection(accountId);
  if (!conn || lead.source === "Simulador") return null;
  const r = await bookInVitruvio(conn, {
    nombre: lead.name,
    telefono: digits(lead.phone).slice(-10),
    motivo,
  });
  if (r.ok) {
    await saveRef(accountId, lead.id, {
      cita: r.cita,
      fecha: r.fecha,
      hora: r.hora,
      status: "Programada",
    });
    return {
      reply: `¡Listo! Tu cita quedó para el ${fechaLarga(r.fecha)} a las ${r.hora}. Te mandaremos un recordatorio. 📅`,
      booked: { at: new Date(`${r.fecha}T${r.hora}:00-06:00`).toISOString() },
    };
  }
  await saveOffer(accountId, lead.id, null, r.opciones);
  return {
    reply: optionsText("Con gusto te agendo. Estos horarios siguen libres:", r.opciones),
    booked: null,
  };
}

/**
 * Respuestas del paciente sobre su cita de Vitruvio: Confirmar, Reagendar, Cancelar o el número de una opción.
 * Regresa el texto a contestar, o null si el mensaje no es para esto (entonces lo atiende la IA como siempre).
 */
export async function handleVitruvioReply(
  accountId: string,
  lead: Lead,
  text: string,
): Promise<string | null> {
  const conn = vitruvioConnection(accountId);
  if (!conn || lead.source === "Simulador") return null;
  const telefono = digits(lead.phone).slice(-10);
  const ref = parseCitaRef((await lastEvent(lead.id, "vitruvio_cita"))?.body);

  // ¿Eligió una de las opciones que se le mandaron?
  const offerRow = await lastEvent(lead.id, "vitruvio_opciones");
  const offer = parseOffer(offerRow?.body, offerRow?.created_at);
  const pick = offer ? pickOption(text, offer.opciones.length) : null;
  if (offer && pick !== null) {
    const slot = offer.opciones[pick]!;
    if (offer.cita) {
      const { status, body } = await call(conn, "/api/public/pulsepad/appointment", {
        method: "POST",
        body: {
          cita: offer.cita,
          telefono,
          accion: "reagendar",
          fecha: slot.fecha,
          hora: slot.hora,
        },
      });
      if (status === 200) {
        await saveRef(accountId, lead.id, {
          cita: offer.cita,
          fecha: slot.fecha,
          hora: slot.hora,
          status: "Programada",
        });
        await moveAppointment(accountId, lead.id, ref, slot);
        return `Listo, tu cita quedó para el ${fechaLarga(slot.fecha)} a las ${slot.hora}. ✅`;
      }
      if (status === 409 || status === 422) {
        const opciones = flattenSlots(toDias(body["alternativas"] as Alternativas, slot.fecha), 3);
        await saveOffer(accountId, lead.id, offer.cita, opciones);
        return optionsText("Ese horario se acaba de ocupar 😕. Estos siguen libres:", opciones);
      }
      return "No pudimos mover tu cita en este momento. En breve el consultorio te escribe.";
    }
    // Opción para una cita nueva.
    const { status, body } = await call(conn, "/api/public/pulsepad/webhook", {
      method: "POST",
      body: {
        nombre: lead.name,
        telefono,
        motivo: "Cita agendada por WhatsApp",
        fecha: slot.fecha,
        hora: slot.hora,
      },
    });
    if (status === 200 && typeof body["appointmentId"] === "string") {
      await saveRef(accountId, lead.id, {
        cita: body["appointmentId"],
        fecha: slot.fecha,
        hora: slot.hora,
        status: "Programada",
      });
      const sb = await admin();
      await sb.from("appointments").insert({
        account_id: accountId,
        lead_id: lead.id,
        at: new Date(`${slot.fecha}T${slot.hora}:00-06:00`).toISOString(),
        kind: "Visita",
      });
      return `¡Listo! Tu cita quedó para el ${fechaLarga(slot.fecha)} a las ${slot.hora}. 📅`;
    }
    if (status === 409) {
      const opciones = flattenSlots(toDias(body["alternativas"] as Alternativas, slot.fecha), 3);
      await saveOffer(accountId, lead.id, null, opciones);
      return optionsText("Ese horario se acaba de ocupar 😕. Estos siguen libres:", opciones);
    }
    return null;
  }

  const accion = quickReply(text);
  if (!accion || !ref || ref.status !== "Programada") return null;
  const { status, body } = await call(conn, "/api/public/pulsepad/appointment", {
    method: "POST",
    body: { cita: ref.cita, telefono, accion },
  });
  if (status === 409 && body["error"] === "inactive")
    return "Esta cita ya no está activa. Si quieres, te ayudo a agendar una nueva.";
  if (status !== 200) return null; // que la IA o el asesor lo atiendan
  if (accion === "confirmar")
    return `¡Gracias, ${lead.name.split(" ")[0]}! Tu cita del ${fechaLarga(ref.fecha)} a las ${ref.hora} quedó confirmada. ✅`;
  if (accion === "cancelar") {
    await saveRef(accountId, lead.id, { ...ref, status: "Cancelada" });
    await moveAppointment(accountId, lead.id, ref, null);
    return "Listo, cancelamos tu cita. Cuando quieras agendar otra, aquí estamos.";
  }
  const opciones = flattenSlots((body["alternativas"] as Dia[] | undefined) ?? [], 3);
  await saveOffer(accountId, lead.id, ref.cita, opciones);
  return optionsText("Claro, elige el horario que mejor te quede:", opciones);
}

/** Refleja en la agenda de Pulsepad el cambio (slot null = cancelada). */
async function moveAppointment(
  accountId: string,
  leadId: string,
  ref: { fecha: string; hora: string } | null,
  slot: { fecha: string; hora: string } | null,
) {
  if (!ref) return;
  const sb = await admin();
  const before = new Date(`${ref.fecha}T${ref.hora}:00-06:00`).toISOString();
  const patch = slot
    ? { at: new Date(`${slot.fecha}T${slot.hora}:00-06:00`).toISOString(), status: "programada" }
    : { status: "cancelada" };
  await sb
    .from("appointments")
    .update(patch)
    .eq("account_id", accountId)
    .eq("lead_id", leadId)
    .eq("at", before);
}

/**
 * Evento firmado que manda Vitruvio (cita creada, movida, cancelada o con otro estado). Idempotente por cita:
 * un reintento no duplica nada. Si el paciente aún no es lead de la subcuenta, se crea con su WhatsApp.
 */
export async function applyVitruvioEvent(
  e: VitruvioEvent,
): Promise<"ok" | "unknown_clinic" | "no_phone"> {
  const conn = connectionForClinic(
    parseConnections(process.env["VITRUVIO_CONNECTIONS"]),
    e.clinicId,
  );
  if (!conn) return "unknown_clinic";
  const phone = e.paciente?.whatsapp;
  if (!phone) return "no_phone";
  const sb = await admin();
  const accountId = conn.accountId;

  const { data: candidates } = await sb
    .from("leads")
    .select("id, phone")
    .eq("account_id", accountId)
    .ilike("phone", `%${digits(phone).slice(-10)}`)
    .limit(20);
  let leadId = (candidates ?? []).find((l) => samePhone(l.phone, phone))?.id;
  if (!leadId) {
    if (e.evento !== "appointment.created") return "ok"; // no se crean leads por cambios de citas que nunca conocimos
    const { data: created } = await sb
      .from("leads")
      .insert({
        account_id: accountId,
        name: e.paciente!.nombre,
        phone,
        source: "Vitruvio",
        stage: 5,
        tags: ["cita-agendada"],
      })
      .select("id")
      .single();
    if (!created) return "ok";
    leadId = created.id;
  }

  const appt = eventToAppointment(e);
  const { data: existing } = await sb
    .from("appointments")
    .select("id")
    .eq("account_id", accountId)
    .eq("lead_id", leadId)
    .in("at", [...new Set([appt.buscarEn, appt.at].filter(Boolean) as string[])])
    .limit(1);
  if (existing?.[0])
    await sb
      .from("appointments")
      .update({ at: appt.at, status: appt.status })
      .eq("id", existing[0].id);
  else if (appt.status === "programada")
    await sb.from("appointments").insert({
      account_id: accountId,
      lead_id: leadId,
      at: appt.at,
      kind: "Visita",
      status: appt.status,
    });

  await saveRef(accountId, leadId, {
    cita: e.cita.id,
    fecha: e.cita.fecha,
    hora: e.cita.hora,
    status: e.cita.status,
  });
  const texto = {
    "appointment.created": `Cita agendada en Vitruvio: ${fechaLarga(e.cita.fecha)} ${e.cita.hora}`,
    "appointment.rescheduled": `Cita movida en Vitruvio a ${fechaLarga(e.cita.fecha)} ${e.cita.hora}`,
    "appointment.cancelled": `Cita cancelada en Vitruvio (${fechaLarga(e.cita.fecha)} ${e.cita.hora})`,
    "appointment.updated": `Cita en Vitruvio: ${e.cita.status}`,
  }[e.evento];
  await sb
    .from("lead_events")
    .insert({ account_id: accountId, lead_id: leadId, kind: "cita", body: texto });
  return "ok";
}
