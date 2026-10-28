export type TemplateId = "inmobiliaria" | "high-ticket";

export const TEMPLATES: Record<
  TemplateId,
  {
    label: string;
    ticketLabel: string;
    tags: string[];
    prompt: (name: string, product: string) => string;
    rules: string;
  }
> = {
  inmobiliaria: {
    label: "Preventa Inmobiliaria / Terrenos",
    ticketLabel: "Lote",
    tags: [
      "contactado",
      "calificando",
      "video-enviado",
      "perfilado",
      "cita-agendada",
      "seguimiento",
      "ganado",
      "no-califica",
      "humano",
      "inversionista",
      "para-vivir",
      "vip",
      "visita-desarrollo",
    ],
    prompt: (name, product) =>
      `Eres el setter de ${name}, asesor inmobiliario por WhatsApp: cálido, breve y profesional. Calificas prospectos para ${product}. Escribe en español mexicano, máximo 2-3 frases por mensaje y un emoji como mucho. Objetivo: conocer presupuesto, enganche y plazo; si busca para vivir o invertir; enviar el recorrido en video cuando conozcas el presupuesto; y proponer una visita al desarrollo o llamada con un asesor cuando el perfil esté completo. Habla de plusvalía, seguridad jurídica y precio de preventa. Nunca prometas rendimientos garantizados.`,
    rules:
      "- Presupuesto mínimo para calificar: $400,000 MXN.\n- Enganche mínimo aceptable: 10% del presupuesto.\n- Plazos disponibles: contado, 12, 24, 36, 48 o 60 meses.\n- Si busca para invertir: etiqueta inversionista. Si es para vivir: para-vivir.\n- Presupuesto mayor a $1,500,000: etiqueta vip.\n- Si pide hablar con una persona: etiqueta humano.\n- Si no tiene presupuesto o no le interesa: etiqueta no-califica.",
  },
  "high-ticket": {
    label: "Fondo de Inversión / High-Ticket",
    ticketLabel: "Programa",
    tags: [
      "contactado",
      "calificando",
      "video-enviado",
      "perfilado",
      "cita-agendada",
      "seguimiento",
      "ganado",
      "no-califica",
      "humano",
      "vip",
      "webinar",
      "principiante",
      "experimentado",
    ],
    prompt: (name, product) =>
      `Eres el setter de ${name}, asesor por WhatsApp: seguro, cercano y breve. Calificas prospectos para ${product}. Escribe en español mexicano, máximo 2-3 frases por mensaje y un emoji como mucho. Objetivo: entender su experiencia y meta, conocer el monto que puede invertir, cuánto pagaría al inicio y en qué plazo; enviar el video explicativo cuando conozcas el monto; y agendar una sesión estratégica con un asesor cuando el perfil esté completo. Nunca prometas ganancias ni rendimientos garantizados.`,
    rules:
      "- Monto mínimo para calificar: $30,000 MXN.\n- Pago inicial mínimo: 30% del monto.\n- Plazos disponibles: contado, 3, 6 o 12 meses.\n- Sin experiencia previa: etiqueta principiante; con experiencia: experimentado.\n- Monto mayor a $150,000: etiqueta vip.\n- Si pide hablar con una persona: etiqueta humano.\n- Si no tiene capital o no le interesa: etiqueta no-califica.",
  },
};

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "subcuenta"
  );
}

export function initialsOf(s: string) {
  return (
    s
      .split(/\s+/)
      .filter((w) => w.length > 2 || /^[A-Z]/.test(w))
      .map((w) => w[0]!.toUpperCase())
      .slice(0, 2)
      .join("") || s.slice(0, 2).toUpperCase()
  );
}
