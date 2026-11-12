import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  connectionFor,
  eventToAppointment,
  flattenSlots,
  mxToIso,
  optionsText,
  parseCitaRef,
  parseConnections,
  parseEvent,
  parseOffer,
  pickOption,
  quickReply,
  verifySignature,
} from "./vitruvio";

const CLINIC = "11111111-2222-3333-4444-555555555555";
const conn = {
  accountId: "acc1",
  clinicId: CLINIC,
  baseUrl: "https://clinic-care-mx.lovable.app/",
  token: "ppin_" + "a".repeat(40),
};

describe("conexión con Vitruvio", () => {
  it("lee las conexiones de los secretos y descarta las inválidas", () => {
    const list = parseConnections(
      JSON.stringify([
        conn,
        { ...conn, accountId: "x", baseUrl: "http://inseguro" },
        { accountId: "y" },
      ]),
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.baseUrl).toBe("https://clinic-care-mx.lovable.app");
    expect(connectionFor(list, "acc1")?.clinicId).toBe(CLINIC);
    expect(connectionFor(list, "otra")).toBeNull();
    expect(parseConnections("no es json")).toEqual([]);
    expect(parseConnections(undefined)).toEqual([]);
  });

  it("verifica la firma de Vitruvio y rechaza firmas viejas o alteradas", async () => {
    const body = '{"evento":"appointment.created"}';
    const sig = createHmac("sha256", "secreto").update(`1700000000.${body}`).digest("hex");
    expect(await verifySignature("secreto", "1700000000", sig, body, 1700000100)).toBe(true);
    expect(await verifySignature("secreto", "1700000000", sig, body + " ", 1700000100)).toBe(false);
    expect(await verifySignature("secreto", "1700000000", sig, body, 1700001000)).toBe(false);
    expect(await verifySignature("", "1700000000", sig, body, 1700000100)).toBe(false);
  });

  it("interpreta eventos y los lleva a la agenda de Pulsepad", () => {
    const ev = parseEvent({
      evento: "appointment.rescheduled",
      clinicId: CLINIC,
      consultorio: "C",
      cita: {
        id: "a1",
        fecha: "2026-11-20",
        hora: "12:30",
        duracion: 30,
        motivo: "x",
        status: "Programada",
        confirmacion: null,
        origen: "Recepción",
      },
      antes: { fecha: "2026-11-20", hora: "10:00" },
      paciente: { id: "p1", nombre: "Ana", whatsapp: "525512345678" },
    });
    expect(ev).not.toBeNull();
    const a = eventToAppointment(ev!);
    expect(a.at).toBe("2026-11-20T18:30:00.000Z");
    expect(a.buscarEn).toBe(mxToIso("2026-11-20", "10:00"));
    expect(a.status).toBe("programada");
    expect(eventToAppointment({ ...ev!, cita: { ...ev!.cita, status: "Cancelada" } }).status).toBe(
      "cancelada",
    );
    expect(parseEvent({ evento: "otra.cosa", clinicId: CLINIC })).toBeNull();
    expect(
      parseEvent({
        evento: "appointment.created",
        clinicId: CLINIC,
        cita: { id: "a1", fecha: "mañana", hora: "10:00" },
      }),
    ).toBeNull();
  });
});

describe("conversación sobre la cita", () => {
  it("reconoce los botones y respuestas cortas", () => {
    expect(quickReply("Confirmar")).toBe("confirmar");
    expect(quickReply("Sí, confirmo")).toBe("confirmar");
    expect(quickReply("Reagendar")).toBe("reagendar");
    expect(quickReply("cancelar mi cita")).toBe("cancelar");
    expect(
      quickReply("quiero confirmar si tienen estacionamiento cerca del consultorio"),
    ).toBeNull();
    expect(quickReply("hola")).toBeNull();
  });

  it("ofrece hasta 3 horarios repartidos entre días y entiende la opción elegida", () => {
    const slots = flattenSlots([
      { fecha: "2026-11-20", horas: ["09:00", "09:30", "10:00"] },
      { fecha: "2026-11-21", horas: ["11:00"] },
    ]);
    expect(slots).toEqual([
      { fecha: "2026-11-20", hora: "09:00" },
      { fecha: "2026-11-20", hora: "09:30" },
      { fecha: "2026-11-21", hora: "11:00" },
    ]);
    expect(optionsText("Elige:", slots)).toContain("1. viernes 20 de noviembre a las 09:00");
    expect(optionsText("Elige:", [])).toContain("no vemos horarios libres");
    expect(pickOption("2", 3)).toBe(1);
    expect(pickOption("la 3", 3)).toBe(2);
    expect(pickOption("Opción 1", 3)).toBe(0);
    expect(pickOption("4", 3)).toBeNull();
    expect(pickOption("tengo 2 hijos", 3)).toBeNull();
  });

  it("las opciones ofrecidas caducan a las 24 h", () => {
    const body = JSON.stringify({ cita: "a1", opciones: [{ fecha: "2026-11-20", hora: "09:00" }] });
    const now = Date.parse("2026-11-12T12:00:00Z");
    expect(parseOffer(body, "2026-11-12T08:00:00Z", now)?.cita).toBe("a1");
    expect(parseOffer(body, "2026-11-10T08:00:00Z", now)).toBeNull();
    expect(
      parseCitaRef(
        JSON.stringify({ cita: "a1", fecha: "2026-11-20", hora: "09:00", status: "Programada" }),
      )?.cita,
    ).toBe("a1");
    expect(parseCitaRef("roto")).toBeNull();
  });
});
