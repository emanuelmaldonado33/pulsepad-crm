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
        </TabsList>
        <TabsContent value="ia">
          <AiConfig />
        </TabsContent>
        <TabsContent value="whatsapp" className="mt-4">
          <WhatsAppChannel key={account.id} accountId={account.id} />
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
