import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Megaphone, Pause, Play, Plus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCrm } from "@/lib/crm/store";
import { STAGES } from "@/lib/crm/types";
import {
  DEFAULT_SEGMENT,
  LIMIT_LABEL,
  QUALITY_LABEL,
  type BroadcastSegment,
} from "@/lib/crm/broadcasts";
import {
  createBroadcast,
  getBroadcastHealth,
  previewBroadcast,
  setBroadcastStatus,
  type BroadcastHealth,
} from "@/lib/crm/broadcasts.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/difusiones")({
  head: () => ({
    meta: [
      { title: "Difusiones — Nexo CRM" },
      {
        name: "description",
        content:
          "Envía una plantilla de WhatsApp a una lista de clientes, poco a poco y con reporte.",
      },
    ],
  }),
  component: Difusiones,
});

type Row = {
  id: string;
  name: string;
  template_name: string;
  status: string;
  pause_reason: string | null;
  daily_cap: number;
  created_at: string;
};
type Stats = {
  total: number;
  pendientes: number;
  enviados: number;
  entregados: number;
  leidos: number;
  respondieron: number;
  fallidos: number;
  omitidos: number;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  enviando: { label: "Enviando", cls: "bg-primary/15 text-primary" },
  pausada: { label: "Pausada", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  terminada: {
    label: "Terminada",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  cancelada: { label: "Cancelada", cls: "bg-muted text-muted-foreground" },
};
const QUALITY_CLS: Record<string, string> = {
  GREEN: "text-emerald-600 dark:text-emerald-400",
  YELLOW: "text-amber-600 dark:text-amber-400",
  RED: "text-destructive",
};

function Difusiones() {
  const { account, members, me } = useCrm();
  const isAdmin = members.some(
    (m) => m.userId === me && (m.role === "owner" || m.role === "admin"),
  );
  const getHealth = useServerFn(getBroadcastHealth);
  const setStatus = useServerFn(setBroadcastStatus);
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [health, setHealth] = useState<BroadcastHealth | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const [{ data: b }, { data: s }] = await Promise.all([
      supabase
        .from("broadcasts")
        .select("id, name, template_name, status, pause_reason, daily_cap, created_at")
        .eq("account_id", account.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.rpc("broadcast_stats", { p_account_id: account.id }),
    ]);
    setRows(b ?? []);
    setStats(Object.fromEntries((s ?? []).map((r) => [r.broadcast_id, r])));
  }, [account.id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!isAdmin) return;
    getHealth({ data: { accountId: account.id } })
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [account.id, isAdmin, getHealth]);

  const act = async (id: string, action: "pause" | "resume" | "cancel") => {
    try {
      await setStatus({ data: { accountId: account.id, id, action } });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar la difusión");
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 space-y-5 p-4 text-base lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Megaphone className="h-6 w-6 text-primary" /> Difusiones
          </h1>
          <p className="text-muted-foreground">
            Manda una plantilla aprobada a una lista de clientes. Sale poco a poco para cuidar tu
            número, y cuando alguien contesta el bot lo atiende.
          </p>
        </div>
        {isAdmin && (
          <Button
            size="lg"
            onClick={() => setOpen(true)}
            disabled={!health?.connected || !!health.stop}
          >
            <Plus className="mr-1 h-5 w-5" /> Nueva difusión
          </Button>
        )}
      </div>

      {isAdmin && <HealthCard health={health} />}

      {rows.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">
          Aún no has enviado difusiones.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <BroadcastCard
              key={r.id}
              row={r}
              stats={stats[r.id]}
              isAdmin={isAdmin}
              onAction={(a) => act(r.id, a)}
            />
          ))}
        </div>
      )}

      {open && (
        <Composer
          health={health}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function HealthCard({ health }: { health: BroadcastHealth | null }) {
  if (!health) return null;
  if (!health.connected)
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
        Conecta tu número en Configuración › Canal WhatsApp para enviar difusiones.
      </div>
    );
  const q = (health.quality ?? "UNKNOWN").toUpperCase();
  return (
    <div className="space-y-3 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <div className="text-sm text-muted-foreground">Calidad del número</div>
          <div className={`flex items-center gap-1 text-lg font-semibold ${QUALITY_CLS[q] ?? ""}`}>
            <ShieldCheck className="h-5 w-5" /> {QUALITY_LABEL[q] ?? q}
          </div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Límite de Meta</div>
          <div className="text-lg font-semibold">{LIMIT_LABEL(health.limit)}</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Enviados en 24 h</div>
          <div className="text-lg font-semibold">{health.sent24h.toLocaleString("es-MX")}</div>
        </div>
      </div>
      {health.stop ? (
        <p className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-destructive">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          {health.stop}. Las difusiones están pausadas hasta que mejore.
        </p>
      ) : q === "YELLOW" ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          La calidad bajó a media: varias personas bloquearon o reportaron tus mensajes. Envía sólo
          a quien te conoce y revisa el texto de la plantilla.
        </p>
      ) : null}
    </div>
  );
}

function BroadcastCard({
  row,
  stats,
  isAdmin,
  onAction,
}: {
  row: Row;
  stats: Stats | undefined;
  isAdmin: boolean;
  onAction: (a: "pause" | "resume" | "cancel") => void;
}) {
  const s = stats ?? {
    total: 0,
    pendientes: 0,
    enviados: 0,
    entregados: 0,
    leidos: 0,
    respondieron: 0,
    fallidos: 0,
    omitidos: 0,
  };
  const done = s.total - s.pendientes;
  const st = STATUS[row.status] ?? STATUS["cancelada"]!;
  const pct = (n: number) => (s.enviados ? ` (${Math.round((n / s.enviados) * 100)}%)` : "");
  return (
    <div className="space-y-3 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-lg font-semibold">{row.name}</div>
          <div className="text-sm text-muted-foreground">
            Plantilla «{row.template_name}» ·{" "}
            {new Date(row.created_at).toLocaleDateString("es-MX", {
              day: "numeric",
              month: "long",
            })}{" "}
            · hasta {row.daily_cap.toLocaleString("es-MX")} al día
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${st.cls}`}>{st.label}</span>
      </div>
      <Progress value={s.total ? (done / s.total) * 100 : 0} />
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="En la lista" value={s.total} />
        <Stat label="Enviados" value={s.enviados} />
        <Stat label="Entregados" value={s.entregados} extra={pct(s.entregados)} />
        <Stat label="Leídos" value={s.leidos} extra={pct(s.leidos)} />
        <Stat label="Respondieron" value={s.respondieron} extra={pct(s.respondieron)} />
        <Stat label="Fallidos" value={s.fallidos} warn={s.fallidos > 0} />
      </div>
      {row.pause_reason && row.status === "pausada" && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> {row.pause_reason}
        </p>
      )}
      {isAdmin && (row.status === "enviando" || row.status === "pausada") && (
        <div className="flex flex-wrap gap-2">
          {row.status === "enviando" ? (
            <Button variant="outline" onClick={() => onAction("pause")}>
              <Pause className="mr-1 h-4 w-4" /> Pausar
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onAction("resume")}>
              <Play className="mr-1 h-4 w-4" /> Reanudar
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => {
              if (confirm("¿Cancelar la difusión? Los que faltan ya no la recibirán."))
                onAction("cancel");
            }}
          >
            <X className="mr-1 h-4 w-4" /> Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  extra,
  warn,
}: {
  label: string;
  value: number;
  extra?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl bg-muted/50 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${warn ? "text-destructive" : ""}`}>
        {value.toLocaleString("es-MX")}
        <span className="text-sm font-normal text-muted-foreground">{extra}</span>
      </div>
    </div>
  );
}

const NONE = "__none__";
type Preview = Awaited<ReturnType<typeof previewBroadcast>>;

function Composer({
  health,
  onClose,
  onCreated,
}: {
  health: BroadcastHealth | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { account, leads, templates, materials } = useCrm();
  const preview = useServerFn(previewBroadcast);
  const create = useServerFn(createBroadcast);
  const [name, setName] = useState("");
  const [tplKey, setTplKey] = useState(NONE);
  const [params, setParams] = useState<string[]>([]);
  const [materialId, setMaterialId] = useState(NONE);
  const [segment, setSegment] = useState<BroadcastSegment>(DEFAULT_SEGMENT);
  const [dailyCap, setDailyCap] = useState(200);
  const [plan, setPlan] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const tpl = templates.find((t) => `${t.name}|${t.language}` === tplKey);
  const allTags = useMemo(() => [...new Set(leads.flatMap((l) => l.tags))].sort(), [leads]);
  const allSources = useMemo(
    () => [...new Set(leads.map((l) => l.source))].filter((s) => s !== "Simulador").sort(),
    [leads],
  );
  const fileKind = tpl?.headerFormat
    ? { IMAGE: "image", VIDEO: "video", DOCUMENT: "pdf" }[tpl.headerFormat]
    : null;
  const files = materials.filter((m) => m.kind === fileKind);

  // Cualquier cambio en la lista obliga a volver a calcular.
  useEffect(() => setPlan(null), [segment, tplKey]);

  const toggle = <K extends "tags" | "sources" | "stages">(k: K, v: BroadcastSegment[K][number]) =>
    setSegment((s) => {
      const list = s[k] as (typeof v)[];
      return { ...s, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] };
    });

  const calc = async () => {
    setBusy(true);
    try {
      setPlan(
        await preview({
          data: { accountId: account.id, segment, category: tpl?.category || "MARKETING" },
        }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo calcular");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!tpl || !plan) return;
    if (
      !confirm(
        `¿Enviar «${tpl.name}» a ${plan.count} personas? Costo aproximado: $${plan.costMxn} MXN.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await create({
        data: {
          accountId: account.id,
          name: name.trim() || tpl.name,
          templateName: tpl.name,
          templateLanguage: tpl.language,
          params,
          materialId: materialId === NONE ? null : materialId,
          segment,
          dailyCap,
          startsAt: null,
        },
      });
      toast.success(`Difusión creada para ${r.count} personas. Empieza a salir en un minuto.`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear la difusión");
    } finally {
      setBusy(false);
    }
  };

  const days = plan && dailyCap > 0 ? Math.ceil(plan.count / dailyCap) : 0;
  const ready = !!tpl && (!fileKind || materialId !== NONE);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto text-base sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nueva difusión</DialogTitle>
          <DialogDescription>
            Sólo a personas que te dieron su número. Mandar a listas compradas hace que te reporten
            y Meta bloquee el número.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <label className="block space-y-1">
            <span className="font-medium">Nombre (sólo para ti)</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Preventa noviembre"
            />
          </label>

          <div className="space-y-2">
            <span className="font-medium">1. Plantilla aprobada</span>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay plantillas. Créalas en Meta y sincronízalas en Configuración › Canal
                WhatsApp.
              </p>
            ) : (
              <Select
                value={tplKey}
                onValueChange={(v) => {
                  setTplKey(v);
                  const t = templates.find((x) => `${x.name}|${x.language}` === v);
                  setParams(
                    t
                      ? t.params.map((p, i) =>
                          i === 0 && /nombre|name|1/.test(p) ? "{{nombre}}" : "",
                        )
                      : [],
                  );
                  setMaterialId(NONE);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Elige una plantilla" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                      {t.name} · {t.language} {t.category ? `· ${t.category.toLowerCase()}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {tpl && (
              <div className="space-y-2 rounded-xl bg-muted/50 p-3">
                <p className="whitespace-pre-wrap text-sm">{tpl.body}</p>
                {tpl.params.map((p, i) => (
                  <label key={p} className="block space-y-1">
                    <span className="text-sm">
                      Variable {`{{${p}}}`} — puedes usar {"{{nombre}}"}, {"{{proyecto}}"} o{" "}
                      {"{{producto}}"}
                    </span>
                    <Input
                      value={params[i] ?? ""}
                      onChange={(e) =>
                        setParams((ps) => ps.map((x, j) => (j === i ? e.target.value : x)))
                      }
                    />
                  </label>
                ))}
                {fileKind && (
                  <Select value={materialId} onValueChange={setMaterialId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Archivo del encabezado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Elige el archivo</SelectItem>
                      {files.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <span className="font-medium">2. ¿A quién? (si no eliges nada, van todos)</span>
            <ChipGroup
              label="Etiquetas"
              options={allTags.map((t) => [t, t])}
              selected={segment.tags}
              onToggle={(v) => toggle("tags", v)}
            />
            <ChipGroup
              label="Etapas"
              options={STAGES.map((s, i) => [String(i), `${s.code} ${s.name}`])}
              selected={segment.stages.map(String)}
              onToggle={(v) => toggle("stages", Number(v))}
            />
            <ChipGroup
              label="Origen"
              options={allSources.map((s) => [s, s])}
              selected={segment.sources}
              onToggle={(v) => toggle("sources", v)}
            />
            <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3">
              <span>
                Sólo quien ya me escribió por WhatsApp
                <span className="block text-sm text-muted-foreground">
                  Recomendado. Los contactos importados que nunca te escribieron reportan más.
                </span>
              </span>
              <Switch
                checked={segment.onlyEngaged}
                onCheckedChange={(v) => setSegment((s) => ({ ...s, onlyEngaged: v }))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3">
              <span>No repetir a quien recibió otra difusión en los últimos 7 días</span>
              <Switch
                checked={segment.skipRecentDays > 0}
                onCheckedChange={(v) => setSegment((s) => ({ ...s, skipRecentDays: v ? 7 : 0 }))}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="font-medium">3. Máximo por día</span>
            <Input
              type="number"
              min={1}
              value={dailyCap}
              onChange={(e) => setDailyCap(Math.max(1, Number(e.target.value) || 1))}
            />
            <span className="block text-sm text-muted-foreground">
              Tu número permite {LIMIT_LABEL(health?.limit).toLowerCase()}. Pulse nunca pasa de ahí,
              aunque pongas más.
            </span>
          </label>

          {plan && (
            <div className="space-y-1 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="text-lg font-semibold">
                Llegará a {plan.count.toLocaleString("es-MX")} personas
              </div>
              <div>
                Costo aproximado: ${plan.costMxn.toLocaleString("es-MX")} MXN (lo cobra Meta) ·{" "}
                {days <= 1 ? "sale hoy" : `tarda unos ${days} días`}
              </div>
              {plan.excluded.map((x) => (
                <div key={x.reason} className="text-sm text-muted-foreground">
                  {x.count} se quedan fuera porque {x.reason}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={calc} disabled={busy}>
            Calcular
          </Button>
          <Button onClick={send} disabled={busy || !ready || !plan || plan.count === 0}>
            {plan ? `Enviar a ${plan.count.toLocaleString("es-MX")}` : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: [string, string][];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, text]) => {
          const on = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              className={`min-h-10 rounded-full border px-3 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
