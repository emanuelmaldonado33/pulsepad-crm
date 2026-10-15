import type { Account, Appointment, Lead, Message } from "./types";

export const ACCOUNTS: Account[] = [
  {
    id: "espacio-fx",
    name: "Espacio FX",
    initials: "FX",
    tagline: "Mentoría de trading high-ticket",
    brand: "oklch(0.52 0.13 160)",
    brandForeground: "oklch(0.98 0.01 160)",
    product: "el programa Espacio FX Elite",
    ticketLabel: "Programa",
  },
  {
    id: "preventa-terrenos",
    name: "Preventa de Terrenos",
    initials: "PT",
    tagline: "Lotes residenciales en preventa",
    brand: "oklch(0.58 0.15 45)",
    brandForeground: "oklch(0.98 0.01 45)",
    product: "nuestros terrenos en preventa",
    ticketLabel: "Lote",
  },
];

const BASE = new Date("2026-10-15T15:00:00Z").getTime();
const h = (hours: number) => new Date(BASE + hours * 3600_000).toISOString();

let n = 0;
const conv = (startH: number, lines: [Message["from"], string][]): Message[] =>
  lines.map(([from, text], i) => ({ id: `seed_m${n++}`, from, text, at: h(startH + i * 0.05) }));

type L = Omit<Lead, "messages" | "createdAt" | "outcome"> & { outcome?: Lead["outcome"]; msgs: [Message["from"], string][]; ago: number };

const raw: L[] = [
  // ---------- Espacio FX ----------
  { id: "fx1", accountId: "espacio-fx", name: "Andrea Salinas", phone: "+52 55 1234 8890", source: "Meta Ads", stage: 0, budget: null, downPayment: null, termMonths: null, tags: [], notes: "", botActive: true, ago: -2, msgs: [["lead", "Hola, vi el anuncio del programa, ¿me das info?"]] },
  { id: "fx2", accountId: "espacio-fx", name: "Ricardo Fuentes", phone: "+52 33 9876 1122", source: "Instagram", stage: 1, budget: null, downPayment: null, termMonths: null, tags: ["contactado"], notes: "", botActive: true, ago: -6, msgs: [["lead", "Buenas, me interesa aprender trading"], ["bot", "¡Hola Ricardo! ¿Qué presupuesto aproximado tienes en mente?"]] },
  { id: "fx3", accountId: "espacio-fx", name: "Mónica Treviño", phone: "+52 81 4455 7788", source: "Webinar", stage: 2, budget: 85000, downPayment: null, termMonths: null, tags: ["calificando", "webinar"], notes: "Asistió al webinar del martes.", botActive: true, ago: -20, msgs: [["lead", "Tengo como 85 mil para invertir en mi formación"], ["bot", "Excelente, ¿cuánto podrías dar de enganche?"]] },
  { id: "fx4", accountId: "espacio-fx", name: "Jorge Castañeda", phone: "+52 55 2211 3344", source: "Meta Ads", stage: 3, budget: 120000, downPayment: null, termMonths: null, tags: ["video-enviado"], notes: "", botActive: true, ago: -30, msgs: [["lead", "Mi presupuesto es de 120 mil"], ["bot", "Te comparto el video del programa 🎥 ¿Cuánto de enganche?"]] },
  { id: "fx5", accountId: "espacio-fx", name: "Lucía Herrera", phone: "+52 55 7788 9900", source: "Referido", stage: 4, budget: 150000, downPayment: 50000, termMonths: 6, tags: ["perfilado", "vip"], notes: "Trader principiante, muy motivada.", botActive: true, ago: -48, msgs: [["lead", "Puedo dar 50 mil de enganche y el resto a 6 meses"], ["bot", "¡Perfil completo! ¿Agendamos llamada?"]] },
  { id: "fx6", accountId: "espacio-fx", name: "Fernando Ibarra", phone: "+52 22 3344 5566", source: "YouTube", stage: 5, budget: 180000, downPayment: 90000, termMonths: 3, tags: ["cita-agendada"], notes: "Ya opera en demo, quiere pasar a real.", botActive: false, ago: -72, msgs: [["lead", "Sí, agendemos la llamada"], ["bot", "¡Listo! Agendé tu llamada."]] },
  { id: "fx7", accountId: "espacio-fx", name: "Paola Rendón", phone: "+52 55 6677 1100", source: "Webinar", stage: 6, budget: 200000, downPayment: 100000, termMonths: 0, tags: ["seguimiento", "vip"], notes: "Pidió hablar con su esposo. Seguimiento viernes.", botActive: false, ago: -100, msgs: [["asesor", "Paola, ¿pudiste platicarlo con tu esposo?"], ["lead", "El viernes te confirmo 🙏"]] },
  { id: "fx8", accountId: "espacio-fx", name: "Diego Montes", phone: "+52 55 1100 2233", source: "Referido", stage: 7, outcome: "ganado", budget: 160000, downPayment: 160000, termMonths: 0, tags: ["ganado"], notes: "Pagó de contado. Onboarding el lunes.", botActive: false, ago: -150, msgs: [["lead", "Listo, ya hice la transferencia"], ["asesor", "¡Bienvenido a Elite, Diego!"]] },
  { id: "fx9", accountId: "espacio-fx", name: "Carlos Peña", phone: "+52 66 4433 2211", source: "Meta Ads", stage: 7, outcome: "no_califica", budget: 5000, downPayment: null, termMonths: null, tags: ["no-califica"], notes: "Presupuesto insuficiente.", botActive: false, ago: -90, msgs: [["lead", "Solo tengo 5 mil, muy caro"], ["bot", "Entiendo, gracias por tu tiempo."]] },

  // ---------- Preventa de Terrenos ----------
  { id: "pt1", accountId: "preventa-terrenos", name: "Mariana López", phone: "+52 998 123 4567", source: "Google Ads", stage: 0, budget: null, downPayment: null, termMonths: null, tags: [], notes: "", botActive: true, ago: -1, msgs: [["lead", "Hola, ¿todavía tienen lotes disponibles?"]] },
  { id: "pt2", accountId: "preventa-terrenos", name: "Héctor Ramírez", phone: "+52 984 222 3311", source: "Facebook", stage: 1, budget: null, downPayment: null, termMonths: null, tags: ["contactado"], notes: "", botActive: true, ago: -5, msgs: [["lead", "Info de los terrenos por favor"], ["bot", "¡Hola Héctor! ¿Qué presupuesto tienes en mente?"]] },
  { id: "pt3", accountId: "preventa-terrenos", name: "Sofía Aguilar", phone: "+52 999 555 8822", source: "Portal inmobiliario", stage: 2, budget: 650000, downPayment: null, termMonths: null, tags: ["calificando", "inversionista"], notes: "", botActive: true, ago: -18, msgs: [["lead", "Mi presupuesto es de 650 mil"], ["bot", "Perfecto, ¿cuánto de enganche?"]] },
  { id: "pt4", accountId: "preventa-terrenos", name: "Alberto Núñez", phone: "+52 998 777 4411", source: "Google Ads", stage: 3, budget: 900000, downPayment: null, termMonths: null, tags: ["video-enviado"], notes: "", botActive: true, ago: -26, msgs: [["lead", "Busco algo hasta 900 mil"], ["bot", "Te comparto el recorrido en video 🎥"]] },
  { id: "pt5", accountId: "preventa-terrenos", name: "Gabriela Ortiz", phone: "+52 984 888 1199", source: "Referido", stage: 4, budget: 1200000, downPayment: 240000, termMonths: 36, tags: ["perfilado", "vip"], notes: "Busca lote esquina.", botActive: true, ago: -40, msgs: [["lead", "Enganche de 240 mil y a 36 meses"], ["bot", "¡Perfil completo! ¿Agendamos?"]] },
  { id: "pt6", accountId: "preventa-terrenos", name: "Raúl Medina", phone: "+52 999 333 6677", source: "Facebook", stage: 5, budget: 800000, downPayment: 160000, termMonths: 24, tags: ["cita-agendada"], notes: "Quiere visitar el desarrollo con su familia.", botActive: false, ago: -60, msgs: [["lead", "Quiero agendar una visita"], ["bot", "¡Listo! Visita agendada."]] },
  { id: "pt7", accountId: "preventa-terrenos", name: "Valeria Cruz", phone: "+52 998 444 2200", source: "Expo", stage: 6, budget: 1500000, downPayment: 500000, termMonths: 12, tags: ["seguimiento", "inversionista"], notes: "Compara con otro desarrollo en Tulum.", botActive: false, ago: -110, msgs: [["asesor", "Valeria, te envié la comparativa de plusvalía."], ["lead", "Gracias, la reviso hoy"]] },
  { id: "pt8", accountId: "preventa-terrenos", name: "Tomás Villarreal", phone: "+52 984 999 0011", source: "Referido", stage: 7, outcome: "ganado", budget: 1100000, downPayment: 330000, termMonths: 24, tags: ["ganado"], notes: "Firmó contrato lote 14-B.", botActive: false, ago: -200, msgs: [["lead", "Ya firmé, gracias!"], ["asesor", "¡Felicidades por tu patrimonio, Tomás!"]] },
];

export const SEED_LEADS: Lead[] = raw.map(({ msgs, ago, ...l }) => ({
  ...l,
  outcome: l.outcome ?? null,
  createdAt: h(ago),
  messages: conv(ago, msgs),
}));

export const SEED_APPOINTMENTS: Appointment[] = [
  { id: "a1", accountId: "espacio-fx", leadId: "fx6", at: h(20), kind: "Videollamada", status: "programada" },
  { id: "a2", accountId: "espacio-fx", leadId: "fx7", at: h(44), kind: "Llamada", status: "programada" },
  { id: "a3", accountId: "espacio-fx", leadId: "fx8", at: h(-80), kind: "Videollamada", status: "realizada" },
  { id: "a4", accountId: "preventa-terrenos", leadId: "pt6", at: h(22), kind: "Visita", status: "programada" },
  { id: "a5", accountId: "preventa-terrenos", leadId: "pt7", at: h(46), kind: "Llamada", status: "programada" },
  { id: "a6", accountId: "preventa-terrenos", leadId: "pt8", at: h(-150), kind: "Visita", status: "realizada" },
];
