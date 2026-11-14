/* Teléfonos de leads capturados a mano o importados. Funciones puras (navegador y servidor). */

/** Últimos 10 dígitos: así se reconoce al mismo cliente con o sin 52/521. */
export const phoneKey = (phone: string) => phone.replace(/\D/g, "").slice(-10);

/**
 * Número listo para WhatsApp con lada de país, o null si no se puede saber a dónde mandarlo.
 * - 10 dígitos = celular de México → +52.
 * - Prefijos viejos de México (044, 045, 01) se quitan.
 * - 11 a 15 dígitos se toman como número internacional que ya trae su lada.
 * Sin esto, "55 1234 5678" se mandaba a 5512345678, que Meta lee como Brasil (+55).
 */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^(044|045)\d{10}$/.test(d)) d = d.slice(3);
  if (/^01\d{10}$/.test(d)) d = d.slice(2);
  if (d.length === 10) return `+52${d}`;
  if (d.length >= 11 && d.length <= 15) return `+${d}`;
  return null;
}
