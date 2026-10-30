import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Cpu, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCrm } from "@/lib/crm/store";
import type { Account } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsAppChannel } from "@/components/crm/WhatsAppChannel";
import { Switch } from "@/components/ui/switch";
import type { Member } from "@/lib/crm/types";
import { DEFAULT_TZ, WEEKDAYS, hoursConfigured, type BusinessHours } from "@/lib/crm/flows";

export const Route = createFileRoute("/configuracion")({
  head: () => ({
    meta: [
      { title: "Configuración de IA — Nexo CRM" },
      {
        name: "description",
        content:
          "Edita el prompt del setter, las reglas de calificación y revisa el consumo de tokens por subcuenta.",
      },
      { property: "og:title", content: "Configuración de IA — Nexo CRM" },
      {
        property: "og:description",
        content:
          "Edita el prompt del setter, las reglas de calificación y revisa el consumo de tokens por subcuenta.",
      },
    ],
  }),
  component: Config,
});

const MODELS = [
  ["openai/gpt-6-astra", "Máxima calidad"],
  ["openai/gpt-6-sol", "Equilibrado"],
  ["openai/gpt-6-luna", "Rápido y económico"],
  // Claude usa tu propia API key de Anthropic (secreto ANTHROPIC_API_KEY).
  ["anthropic/claude-opus-5-5", "Claude Opus 5.5 · máxima calidad"],
  ["anthropic/claude-sonnet-5-5", "Claude Sonnet 5.5 · equilibrado"],
  ["anthropic/claude-haiku-5-5", "Claude Haiku 5.5 · rápido y económico"],
] as const;

interface UsageRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  created_at: string;
}

function Config() {
  const { account } = useCrm();
  return (
    <div className="mx-auto w-full max-w-5xl p-4 lg:p-6">
      <Tabs defaultValue="ia">
        <TabsList>
          <TabsTrigger value="ia">IA y marca</TabsTrigger>
          <TabsTrigger value="whatsapp">Canal WhatsApp</TabsTrigger>
          <TabsTrigger value="equipo">Equipo</TabsTrigger>
          <TabsTrigger value="horario">Horario hábil</TabsTrigger>
        </TabsList>
        <TabsContent value="ia">
          <AiConfig />
        </TabsContent>
        <TabsContent value="whatsapp" className="mt-4">
          <WhatsAppChannel key={account.id} accountId={account.id} />
        </TabsContent>
        <TabsContent value="equipo" className="mt-4">
          <TeamConfig key={account.id} />
        </TabsContent>
        <TabsContent value="horario" className="mt-4">
          <HoursConfig key={account.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AiConfig() {
  const { account, updateAccount } = useCrm();
  const [draft, setDraft] = useState<Account>(account);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  useEffect(() => {
    setDraft(account);
  }, [account]);
  useEffect(() => {
    if (!account.id) return;
    supabase
      .from("ai_usage")
      .select("model,input_tokens,output_tokens,total_tokens,created_at")
      .eq("account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) toast.error("No se pudo cargar el consumo");
        else setUsage(data ?? []);
      });
  }, [account.id]);

  const set = (p: Partial<Account>) => setDraft((d) => ({ ...d, ...p }));
  const save = async () => {
    await updateAccount(account.id, draft);
    toast.success("Configuración guardada");
  };

  const sum = (k: keyof UsageRow, rows = usage) => rows.reduce((a, r) => a + Number(r[k]), 0);
  const since = Date.now() - 24 * 3600_000;
  const today = usage.filter((u) => new Date(u.created_at).getTime() > since);

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Configuración de IA · {account.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Cada subcuenta tiene su propio setter, reglas y marca.
          </p>
        </div>
        <Button className="ml-auto" onClick={save}>
          <Save className="mr-2 h-4 w-4" /> Guardar
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Conversaciones IA", usage.length.toLocaleString("es-MX")],
          ["Tokens totales", sum("total_tokens").toLocaleString("es-MX")],
          ["Tokens últimas 24 h", sum("total_tokens", today).toLocaleString("es-MX")],
          [
            "Promedio por respuesta",
            usage.length
              ? Math.round(sum("total_tokens") / usage.length).toLocaleString("es-MX")
              : "—",
          ],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div>
            <div className="font-display text-xl font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <section className="space-y-2 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Prompt del setter</h2>
        <p className="text-sm text-muted-foreground">
          Personalidad, tono y objetivo del bot en WhatsApp.
        </p>
        <Textarea
          rows={7}
          value={draft.setterPrompt}
          onChange={(e) => set({ setterPrompt: e.target.value })}
        />
      </section>

      <section className="space-y-2 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Reglas de calificación</h2>
        <p className="text-sm text-muted-foreground">
          Montos mínimos, plazos aceptados y cuándo asignar etiquetas (humano, no-califica, vip…).
          La IA las aplica en cada mensaje.
        </p>
        <Textarea
          rows={7}
          value={draft.qualificationRules}
          onChange={(e) => set({ qualificationRules: e.target.value })}
        />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-3 rounded-2xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Cpu className="h-4 w-4" /> Modelo de IA
          </h2>
          <Select value={draft.aiModel} onValueChange={(v) => set({ aiModel: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="block text-sm">
            Producto que vende el bot
            <Input
              className="mt-1"
              value={draft.product}
              onChange={(e) => set({ product: e.target.value })}
            />
          </label>
        </section>
        <section className="space-y-3 rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">Marca blanca</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Nombre
              <Input
                className="mt-1"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Iniciales del logo
              <Input
                className="mt-1"
                maxLength={3}
                value={draft.initials}
                onChange={(e) => set({ initials: e.target.value })}
              />
            </label>
            <label className="col-span-2 text-sm">
              Lema
              <Input
                className="mt-1"
                value={draft.tagline}
                onChange={(e) => set({ tagline: e.target.value })}
              />
            </label>
            <label className="col-span-2 text-sm">
              Color de marca
              <div className="mt-1 flex gap-2">
                {[
                  "oklch(0.52 0.13 160)",
                  "oklch(0.58 0.15 45)",
                  "oklch(0.5 0.15 255)",
                  "oklch(0.45 0.12 300)",
                  "oklch(0.55 0.18 25)",
                  "oklch(0.3 0.03 260)",
                ].map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => set({ brand: c })}
                    className={`h-8 w-8 rounded-full border-2 ${draft.brand === c ? "border-foreground" : "border-transparent"}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </label>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">Últimas respuestas de la IA</h2>
        <div className="max-h-72 overflow-y-auto text-sm">
          <table className="w-full">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Fecha</th>
                <th>Modelo</th>
                <th className="text-right">Entrada</th>
                <th className="text-right">Salida</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {usage.slice(0, 50).map((u, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1.5">{new Date(u.created_at).toLocaleString("es-MX")}</td>
                  <td>{u.model.replace("openai/", "")}</td>
                  <td className="text-right">{u.input_tokens.toLocaleString("es-MX")}</td>
                  <td className="text-right">{u.output_tokens.toLocaleString("es-MX")}</td>
                  <td className="text-right font-medium">
                    {u.total_tokens.toLocaleString("es-MX")}
                  </td>
                </tr>
              ))}
              {usage.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground">
                    Aún no hay consumo. Prueba el bot en el Simulador.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const ROLE_LABEL: Record<Member["role"], string> = {
  owner: "Propietario",
  admin: "Administrador",
  member: "Asesor",
};

/** Equipo: nombre, WhatsApp personal para avisos y disponibilidad para los turnos. */
function TeamConfig() {
  const { account, updateAccount, members, me, updateMember } = useCrm();
  const isAdmin = members.some(
    (m) => m.userId === me && (m.role === "owner" || m.role === "admin"),
  );
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Equipo de {account.name}</h2>
        <p className="text-sm text-muted-foreground">
          Los flujos usan estos datos en «Avisar al equipo» y «Asignar asesor». Quien esté marcado
          como no disponible no recibe leads por turnos. Cada quien edita sus datos; propietarios y
          administradores, los de todo el equipo.
        </p>
        <div className="divide-y">
          {members.map((m) => (
            <MemberRow
              key={m.userId}
              m={m}
              editable={m.userId === me || isAdmin}
              onSave={(patch) => updateMember(m.userId, patch)}
            />
          ))}
        </div>
      </section>
      <section className="flex items-start gap-3 rounded-2xl border bg-card p-5">
        <div className="flex-1">
          <h2 className="font-semibold">Pausar el bot cuando un asesor escribe</h2>
          <p className="text-sm text-muted-foreground">
            Si un asesor manda un mensaje manual a un lead, el bot deja de responderle y queda
            anotado en su historial. Se vuelve a encender desde la bandeja o con un flujo.
          </p>
        </div>
        <Switch
          aria-label="Pausar el bot cuando un asesor escribe"
          disabled={!isAdmin}
          checked={account.autoPauseBot ?? true}
          onCheckedChange={(v) => void updateAccount(account.id, { autoPauseBot: v })}
        />
      </section>
    </div>
  );
}

function MemberRow({
  m,
  editable,
  onSave,
}: {
  m: Member;
  editable: boolean;
  onSave: (patch: Partial<Pick<Member, "name" | "whatsappPhone" | "available">>) => Promise<void>;
}) {
  const [name, setName] = useState(m.name);
  const [phone, setPhone] = useState(m.whatsappPhone);
  const validPhone = /^\+?[0-9 ()-]{0,25}$/.test(phone);
  const dirty = name !== m.name || phone !== m.whatsappPhone;
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-40 flex-1">
        <Input
          aria-label="Nombre"
          value={name}
          disabled={!editable}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="mt-1 text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</div>
      </div>
      <div className="min-w-48 flex-1">
        <Input
          aria-label="WhatsApp personal"
          value={phone}
          disabled={!editable}
          placeholder="+52 55 1234 5678"
          onChange={(e) => setPhone(e.target.value)}
        />
        {!validPhone && <div className="mt-1 text-xs text-destructive">Sólo números</div>}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          aria-label="Disponible"
          disabled={!editable}
          checked={m.available}
          onCheckedChange={(v) => void onSave({ available: v })}
        />
        Disponible
      </label>
      {editable && (
        <Button
          size="sm"
          disabled={!dirty || !validPhone || !name.trim()}
          onClick={() => void onSave({ name: name.trim(), whatsappPhone: phone.trim() })}
        >
          <Save className="mr-1 h-3.5 w-3.5" /> Guardar
        </Button>
      )}
    </div>
  );
}

const TIMEZONES = [
  ["America/Mexico_City", "Ciudad de México"],
  ["America/Monterrey", "Monterrey"],
  ["America/Cancun", "Cancún"],
  ["America/Chihuahua", "Chihuahua"],
  ["America/Hermosillo", "Hermosillo"],
  ["America/Tijuana", "Tijuana"],
  ["America/Bogota", "Bogotá"],
  ["America/Lima", "Lima"],
  ["America/Santiago", "Santiago"],
  ["America/Argentina/Buenos_Aires", "Buenos Aires"],
  ["America/New_York", "Nueva York"],
  ["Europe/Madrid", "Madrid"],
] as const;

const WEEKDAY_HOURS: BusinessHours = {
  tz: DEFAULT_TZ,
  days: [
    null,
    ["09:00", "19:00"],
    ["09:00", "19:00"],
    ["09:00", "19:00"],
    ["09:00", "19:00"],
    ["09:00", "19:00"],
    ["10:00", "14:00"],
  ],
};

/** Días y horas en que los flujos pueden enviar los mensajes marcados «solo en horario hábil». */
function HoursConfig() {
  const { account, updateAccount, members, me } = useCrm();
  const isAdmin = members.some(
    (m) => m.userId === me && (m.role === "owner" || m.role === "admin"),
  );
  const [h, setH] = useState<BusinessHours>(
    hoursConfigured(account.businessHours) ? account.businessHours : WEEKDAY_HOURS,
  );
  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => h.days?.[d] ?? null);
  const setDay = (d: number, v: readonly [string, string] | null) =>
    setH({ ...h, days: days.map((x, i) => (i === d ? v : x)) });
  const invalid = days.some((d) => d && d[1] <= d[0]);
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <div>
        <h2 className="font-semibold">Horario hábil de {account.name}</h2>
        <p className="text-sm text-muted-foreground">
          Los mensajes de un flujo marcados «solo en horario hábil» que caigan fuera de este horario
          esperan a la siguiente apertura.{" "}
          {hoursConfigured(account.businessHours)
            ? ""
            : "Aún no está guardado: mientras tanto esos mensajes salen a cualquier hora."}
        </p>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Zona horaria
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={h.tz ?? DEFAULT_TZ}
          disabled={!isAdmin}
          onChange={(e) => setH({ ...h, tz: e.target.value })}
        >
          {TIMEZONES.map(([tz, label]) => (
            <option key={tz} value={tz}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="divide-y">
        {WEEKDAYS.map((name, d) => {
          const span = days[d];
          return (
            <div key={name} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Switch
                aria-label={`Abierto el ${name.toLowerCase()}`}
                disabled={!isAdmin}
                checked={!!span}
                onCheckedChange={(v) => setDay(d, v ? ["09:00", "19:00"] : null)}
              />
              <span className="w-24">{name}</span>
              {span ? (
                <>
                  <Input
                    type="time"
                    aria-label={`Abre el ${name.toLowerCase()}`}
                    className="w-32"
                    disabled={!isAdmin}
                    value={span[0]}
                    onChange={(e) => setDay(d, [e.target.value, span[1]])}
                  />
                  a
                  <Input
                    type="time"
                    aria-label={`Cierra el ${name.toLowerCase()}`}
                    className="w-32"
                    disabled={!isAdmin}
                    value={span[1]}
                    onChange={(e) => setDay(d, [span[0], e.target.value])}
                  />
                </>
              ) : (
                <span className="text-muted-foreground">Cerrado</span>
              )}
            </div>
          );
        })}
      </div>
      {invalid && (
        <p className="text-xs text-destructive">
          La hora de cierre debe ser después de la apertura.
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          disabled={!isAdmin || invalid || !days.some(Boolean)}
          onClick={async () => {
            await updateAccount(account.id, { businessHours: { tz: h.tz ?? DEFAULT_TZ, days } });
            toast.success("Horario guardado");
          }}
        >
          <Save className="mr-2 h-4 w-4" /> Guardar horario
        </Button>
        {!isAdmin && (
          <span className="text-xs text-muted-foreground">
            Solo propietarios y administradores cambian el horario.
          </span>
        )}
      </div>
    </section>
  );
}
