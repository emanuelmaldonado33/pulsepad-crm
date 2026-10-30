import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { completeEmbeddedSignup, getEmbeddedSignupConfig } from "@/lib/crm/whatsapp.functions";
import { Button } from "@/components/ui/button";

type Config = { appId: string; configId: string; graphVersion: string };
type LoginResponse = { authResponse?: { code?: string } | null };
type FacebookSdk = {
  init: (o: Record<string, unknown>) => void;
  login: (cb: (r: LoginResponse) => void, o: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

/** Lo que Meta avisa por postMessage al terminar el registro. */
type Session = {
  wabaId?: string | undefined;
  phoneNumberId?: string | undefined;
  coexistence: boolean;
};

let sdk: Promise<FacebookSdk> | null = null;
function loadSdk(cfg: Config) {
  sdk ??= new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({
        appId: cfg.appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: cfg.graphVersion,
      });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => {
      sdk = null;
      reject(new Error("No se pudo cargar el SDK de Facebook"));
    };
    document.body.appendChild(s);
  });
  return sdk;
}

const fromFacebook = (origin: string) => {
  try {
    return /(^|\.)facebook\.com$/.test(new URL(origin).hostname);
  } catch {
    return false;
  }
};

/**
 * Registro integrado de Meta. Ofrece conectar un número nuevo o el número que ya usan en la
 * app WhatsApp Business (coexistencia): la app sigue funcionando y Pulse ve todo.
 */
export function EmbeddedSignupButton({
  accountId,
  onDone,
}: {
  accountId: string;
  onDone: () => Promise<void>;
}) {
  const getConfig = useServerFn(getEmbeddedSignupConfig);
  const complete = useServerFn(completeEmbeddedSignup);
  const [cfg, setCfg] = useState<Config | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const session = useRef<Session>({ coexistence: false });

  useEffect(() => {
    void getConfig()
      .then(setCfg)
      .catch(() => setCfg(null));
  }, [getConfig]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!fromFacebook(e.origin)) return;
      let d: { type?: string; event?: string; data?: Record<string, unknown> };
      try {
        d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (d?.type !== "WA_EMBEDDED_SIGNUP" || !d.event?.startsWith("FINISH")) return;
      session.current = {
        wabaId: typeof d.data?.["waba_id"] === "string" ? d.data["waba_id"] : undefined,
        phoneNumberId:
          typeof d.data?.["phone_number_id"] === "string" ? d.data["phone_number_id"] : undefined,
        coexistence: d.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      };
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const finish = async (code: string) => {
    // El aviso con la cuenta suele llegar antes que el código; si no, se espera un poco.
    for (let i = 0; i < 20 && !session.current.wabaId; i++)
      await new Promise((r) => setTimeout(r, 150));
    const { wabaId, phoneNumberId, coexistence } = session.current;
    if (!wabaId) {
      toast.error("Meta no devolvió la cuenta de WhatsApp. Intenta de nuevo.");
      return;
    }
    const r = await complete({ data: { accountId, code, wabaId, phoneNumberId, coexistence } });
    if (!r.ok) {
      toast.error(`No se conectó: ${r.error}`);
      return;
    }
    toast.success(
      `WhatsApp conectado${r.info ? ` · ${r.info}` : ""}` +
        (coexistence ? " · importando historial de la app" : ""),
    );
    await onDone();
  };

  const start = async () => {
    if (!cfg) return;
    setBusy(true);
    session.current = { coexistence: false };
    try {
      const FB = await loadSdk(cfg);
      FB.login(
        (resp) => {
          const code = resp.authResponse?.code;
          if (!code) {
            setBusy(false);
            return;
          }
          void finish(code)
            .catch((e: unknown) =>
              toast.error(e instanceof Error ? e.message : "No se pudo conectar"),
            )
            .finally(() => setBusy(false));
        },
        {
          config_id: cfg.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: "whatsapp_business_app_onboarding",
            sessionInfoVersion: "3",
          },
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir Facebook");
      setBusy(false);
    }
  };

  if (cfg === undefined) return null;
  if (cfg === null)
    return (
      <p className="text-xs text-muted-foreground">
        La conexión con Facebook aún no está configurada en Pulse (faltan META_APP_ID,
        META_APP_SECRET y META_ES_CONFIG_ID). Mientras tanto usa la conexión manual.
      </p>
    );
  return (
    <Button onClick={start} disabled={busy}>
      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Conectar con Facebook
    </Button>
  );
}
