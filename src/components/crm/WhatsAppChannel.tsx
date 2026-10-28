import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { getWhatsAppStatus, saveWhatsApp, type WhatsAppStatus } from "@/lib/crm/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const BADGE: Record<WhatsAppStatus["mode"], [string, string]> = {
  conectado: ["Envío conectado", "bg-success/15 text-success"],
  desconectado: ["Desconectado", "bg-destructive/15 text-destructive"],
  simulacion: ["Modo Simulación", "bg-warning/15 text-warning"],
};

export function WhatsAppChannel({ accountId }: { accountId: string }) {
  const getStatus = useServerFn(getWhatsAppStatus);
  const save = useServerFn(saveWhatsApp);
  const [st, setSt] = useState<WhatsAppStatus | null>(null);
  const [form, setForm] = useState({
    phoneNumberId: "", wabaId: "", accessToken: "", appSecret: "", verifyToken: "",
    clearAccessToken: false, clearAppSecret: false, enabled: false,
  });
  const [busy, setBusy] = useState(false);
  const webhookUrl = typeof window === "undefined" ? "" : `${window.location.origin}/api/public/whatsapp/webhook`;

  const load = useCallback(async () => {
    const s = await getStatus({ data: { accountId } });
    setSt(s);
    setForm({
      phoneNumberId: s.phoneNumberId, wabaId: s.wabaId, accessToken: "", appSecret: "",
      verifyToken: s.verifyToken || crypto.randomUUID().replace(/-/g, ""),
      clearAccessToken: false, clearAppSecret: false, enabled: s.enabled,
    });
  }, [accountId, getStatus]);
  useEffect(() => { if (accountId) void load().catch(() => toast.error("No se pudo cargar el canal")); }, [accountId, load]);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await save({ data: { accountId, ...form } });
      if (r.ok) toast.success(form.enabled ? `WhatsApp guardado${r.info ? ` · ${r.info}` : ""}` : "Guardado en modo simulación");
      else toast.error(`Meta rechazó la conexión: ${r.error}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally { setBusy(false); }
  };

  const copy = (v: string) => { void navigator.clipboard.writeText(v); toast.success("Copiado"); };
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  if (!st) return <div className="p-6 text-sm text-muted-foreground">Cargando canal…</div>;
  const [label, cls] = BADGE[st.mode];

  return (
    <div className="space-y-4">
      <section className="flex items-center gap-3 rounded-2xl border bg-card p-5">
        <MessageCircle className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <div className="font-semibold">Canal WhatsApp (Meta Cloud API)</div>
          <div className="text-sm text-muted-foreground">
            {st.mode === "desconectado"
              ? `Meta reportó un error: ${st.lastError ?? "revisa tus credenciales"}`
              : st.outgoingReady
                ? "La configuración de envío está lista."
                : "Faltan credenciales de envío; los mensajes quedan en modo simulación."}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {st.incomingReady
              ? "La configuración de recepción está completa; confirma también el webhook en Meta."
              : "La recepción entrante requiere App Secret y Verify Token guardados."}
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>{label}</span>
      </section>

      <section className="grid gap-3 rounded-2xl border bg-card p-5 sm:grid-cols-2">
        <Field id="wa-phone-number-id" label="Phone Number ID"><Input id="wa-phone-number-id" value={form.phoneNumberId} onChange={(e) => set({ phoneNumberId: e.target.value.trim() })} placeholder="1234567890" /></Field>
        <Field id="wa-waba-id" label="WhatsApp Business Account ID (WABA)"><Input id="wa-waba-id" value={form.wabaId} onChange={(e) => set({ wabaId: e.target.value.trim() })} placeholder="1234567890" /></Field>
        <Field id="wa-access-token" label="Access Token" hint={st.hasToken ? "Guardado. Déjalo vacío para conservarlo." : "Token permanente de usuario del sistema."}>
          <Input id="wa-access-token" type="password" disabled={form.clearAccessToken} value={form.accessToken} onChange={(e) => set({ accessToken: e.target.value, clearAccessToken: false })} placeholder={st.hasToken ? "••••••••" : "EAAG…"} />
          {st.hasToken && <button type="button" className="text-xs text-destructive hover:underline" onClick={() => set({ clearAccessToken: !form.clearAccessToken, accessToken: "" })}>{form.clearAccessToken ? "Se eliminará el token al guardar · Cancelar" : "Eliminar token guardado"}</button>}
        </Field>
        <Field id="wa-app-secret" label="App Secret" hint={st.hasAppSecret ? "Guardado. Déjalo vacío para conservarlo." : "Necesario para aceptar mensajes entrantes (firma de Meta)."}>
          <Input id="wa-app-secret" type="password" disabled={form.clearAppSecret} value={form.appSecret} onChange={(e) => set({ appSecret: e.target.value, clearAppSecret: false })} placeholder={st.hasAppSecret ? "••••••••" : "App Dashboard → Configuración → Básica"} />
          {st.hasAppSecret && <button type="button" className="text-xs text-destructive hover:underline" onClick={() => set({ clearAppSecret: !form.clearAppSecret, appSecret: "" })}>{form.clearAppSecret ? "Se eliminará el App Secret al guardar · Cancelar" : "Eliminar App Secret guardado"}</button>}
        </Field>
        <Field id="wa-webhook-url" label="URL del webhook (pégala en Meta)">
          <div className="flex gap-1"><Input id="wa-webhook-url" readOnly value={webhookUrl} /><Button size="icon" variant="outline" onClick={() => copy(webhookUrl)} aria-label="Copiar URL"><Copy className="h-4 w-4" /></Button></div>
        </Field>
        <Field id="wa-verify-token" label="Webhook Verify Token (pégalo en Meta)">
          <div className="flex gap-1"><Input id="wa-verify-token" value={form.verifyToken} onChange={(e) => set({ verifyToken: e.target.value.trim() })} /><Button size="icon" variant="outline" onClick={() => copy(form.verifyToken)} aria-label="Copiar token"><Copy className="h-4 w-4" /></Button></div>
        </Field>
        <label className="flex items-center gap-3 sm:col-span-2">
          <Switch checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })} />
          <span className="text-sm">Enviar mensajes reales por WhatsApp (apagado = modo simulación)</span>
          <Button className="ml-auto" disabled={busy} onClick={submit}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar y probar conexión</Button>
        </label>
        <p className="text-xs text-muted-foreground sm:col-span-2">En Meta, suscribe el webhook al campo <b>messages</b>. Fuera de la ventana de 24 h desde el último mensaje del prospecto, Meta sólo permite plantillas aprobadas.</p>
      </section>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="block space-y-1">
      <label htmlFor={id} className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}
