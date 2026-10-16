import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { getWhatsAppStatus, saveWhatsApp, type WhatsAppStatus } from "@/lib/crm/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const BADGE: Record<WhatsAppStatus["mode"], [string, string]> = {
  conectado: ["Conectado", "bg-success/15 text-success"],
  desconectado: ["Desconectado", "bg-destructive/15 text-destructive"],
  simulacion: ["Modo Simulación", "bg-warning/15 text-warning"],
};

export function WhatsAppChannel({ accountId }: { accountId: string }) {
  const getStatus = useServerFn(getWhatsAppStatus);
  const save = useServerFn(saveWhatsApp);
  const [st, setSt] = useState<WhatsAppStatus | null>(null);
  const [form, setForm] = useState({ phoneNumberId: "", wabaId: "", accessToken: "", appSecret: "", verifyToken: "", enabled: false });
  const [busy, setBusy] = useState(false);
  const webhookUrl = typeof window === "undefined" ? "" : `${window.location.origin}/api/public/whatsapp/webhook`;

  const load = useCallback(async () => {
    const s = await getStatus({ data: { accountId } });
    setSt(s);
    setForm({ phoneNumberId: s.phoneNumberId, wabaId: s.wabaId, accessToken: "", appSecret: "", verifyToken: s.verifyToken || crypto.randomUUID().replace(/-/g, ""), enabled: s.enabled });
  }, [accountId, getStatus]);
  useEffect(() => { if (accountId) void load().catch(() => toast.error("No se pudo cargar el canal")); }, [accountId, load]);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await save({ data: { accountId, ...form, ...(form.accessToken ? {} : { accessToken: undefined }), ...(form.appSecret ? {} : { appSecret: undefined }) } });
      if (r.ok) toast.success(form.enabled ? `WhatsApp conectado${r.info ? ` · ${r.info}` : ""}` : "Guardado en modo simulación");
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
            {st.mode === "simulacion" ? "Sin credenciales activas: los mensajes se guardan en la Bandeja pero no salen a WhatsApp." : st.mode === "conectado" ? "Los flujos, el bot y la Bandeja envían desde tu número real." : `Error: ${st.lastError}`}
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>{label}</span>
      </section>

      <section className="grid gap-3 rounded-2xl border bg-card p-5 sm:grid-cols-2">
        <Field label="Phone Number ID"><Input value={form.phoneNumberId} onChange={(e) => set({ phoneNumberId: e.target.value.trim() })} placeholder="1234567890" /></Field>
        <Field label="WhatsApp Business Account ID (WABA)"><Input value={form.wabaId} onChange={(e) => set({ wabaId: e.target.value.trim() })} placeholder="1234567890" /></Field>
        <Field label="Access Token" hint={st.hasToken ? "Guardado. Déjalo vacío para conservarlo." : "Token permanente de usuario del sistema."}>
          <Input type="password" value={form.accessToken} onChange={(e) => set({ accessToken: e.target.value })} placeholder={st.hasToken ? "••••••••" : "EAAG…"} />
        </Field>
        <Field label="App Secret" hint={st.hasAppSecret ? "Guardado. Déjalo vacío para conservarlo." : "Necesario para aceptar mensajes entrantes (firma de Meta)."}>
          <Input type="password" value={form.appSecret} onChange={(e) => set({ appSecret: e.target.value })} placeholder={st.hasAppSecret ? "••••••••" : "App Dashboard → Configuración → Básica"} />
        </Field>
        <Field label="URL del webhook (pégala en Meta)">
          <div className="flex gap-1"><Input readOnly value={webhookUrl} /><Button size="icon" variant="outline" onClick={() => copy(webhookUrl)} aria-label="Copiar URL"><Copy className="h-4 w-4" /></Button></div>
        </Field>
        <Field label="Webhook Verify Token (pégalo en Meta)">
          <div className="flex gap-1"><Input value={form.verifyToken} onChange={(e) => set({ verifyToken: e.target.value.trim() })} /><Button size="icon" variant="outline" onClick={() => copy(form.verifyToken)} aria-label="Copiar token"><Copy className="h-4 w-4" /></Button></div>
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
