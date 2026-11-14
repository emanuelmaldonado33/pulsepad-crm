/**
 * Cifrado de las credenciales de WhatsApp guardadas en la base (access_token, app_secret).
 * Clave: secreto CHANNEL_SECRETS_KEY (32 bytes en base64; se genera con `openssl rand -base64 32`).
 * Formato guardado: "enc:v1:<iv base64>:<texto cifrado base64>" con AES-256-GCM.
 * Un valor sin el prefijo es de antes del cifrado y se lee tal cual; se cifra la próxima vez que
 * se guarde el canal. Sin la clave se sigue guardando en claro, como antes, para no tumbar nada.
 */
const PREFIX = "enc:v1:";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let cached: { raw: string; key: Promise<CryptoKey> } | undefined;

function channelKey(): Promise<CryptoKey> | null {
  const raw = process.env["CHANNEL_SECRETS_KEY"]?.trim();
  if (!raw) return null;
  if (cached?.raw !== raw) {
    const bytes = unb64(raw);
    if (bytes.length !== 32) throw new Error("CHANNEL_SECRETS_KEY debe tener 32 bytes en base64");
    cached = {
      raw,
      key: crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]),
    };
  }
  return cached.key;
}

export const isEncrypted = (v: string | null | undefined) => !!v && v.startsWith(PREFIX);

export async function encryptSecret(plain: string): Promise<string> {
  if (!plain || isEncrypted(plain)) return plain;
  const key = channelKey();
  if (!key) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await key,
      new TextEncoder().encode(plain),
    ),
  );
  return `${PREFIX}${b64(iv)}:${b64(data)}`;
}

export async function decryptSecret(stored: string | null | undefined): Promise<string> {
  if (!stored) return "";
  if (!isEncrypted(stored)) return stored;
  const key = channelKey();
  if (!key) throw new Error("Falta el secreto CHANNEL_SECRETS_KEY para leer las credenciales");
  const [iv, data] = stored.slice(PREFIX.length).split(":");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv ?? "") },
    await key,
    unb64(data ?? ""),
  );
  return new TextDecoder().decode(plain);
}

/** Fila de whatsapp_channels con access_token y app_secret ya legibles. */
export async function openChannel<T extends { access_token: string; app_secret: string }>(
  row: T,
): Promise<T> {
  return {
    ...row,
    access_token: await decryptSecret(row.access_token),
    app_secret: await decryptSecret(row.app_secret),
  };
}
