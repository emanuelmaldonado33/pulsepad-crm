import qrcode from "qrcode-generator";

/** Sin 0/O, 1/I/L ni 5/S: el cliente nunca teclea el código, pero el asesor sí lo lee. */
const ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

export function newQrCode(length = 4): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Mensaje que el cliente ve escrito al escanear; el código va al final para no estorbar. */
export const qrMessage = (code: string) => `Hola, quiero información (ref ${code})`;

/** Enlace wa.me del QR. `phone` son sólo dígitos con lada (52 + 10 dígitos en México). */
export function qrLink(phone: string, code: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(qrMessage(code))}`;
}

/** Código del QR dentro del primer mensaje, o null. Tolera que el cliente edite el texto. */
export function parseQrRef(text: string): string | null {
  const m = /\bref\W{1,3}([A-Z0-9]{4,8})\b/i.exec(text);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Dibuja el QR listo para imprimir (cuadrado blanco con el nombre debajo) y devuelve un PNG.
 * Corrección de errores alta: la lona aguanta sol, lluvia y una esquina doblada.
 */
export function qrPng(link: string, label: string, size = 1200): string {
  const qr = qrcode(0, "H");
  qr.addData(link);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.floor(size / (n + quiet * 2));
  const side = cell * (n + quiet * 2);
  const labelH = Math.round(side * 0.14);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side + labelH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
  ctx.font = `600 ${Math.round(labelH * 0.42)}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, side / 2, side + labelH * 0.35, side * 0.9);
  return canvas.toDataURL("image/png");
}
