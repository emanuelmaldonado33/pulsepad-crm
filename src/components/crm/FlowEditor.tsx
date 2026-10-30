import { createContext, useContext, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  MessageSquare,
  Paperclip,
  Trash2,
  Zap,
  CalendarClock,
  ShieldCheck,
  GitBranch,
  CircleStop,
  Repeat,
  BellRing,
  UserCheck,
} from "lucide-react";
import { STAGES, type Member } from "@/lib/crm/types";
import { MAX_BRANCH_DEPTH } from "@/lib/crm/flow-io";
import {
  CONVERSATION_TRIGGERS,
  FIELD_LABEL,
  LEAD_INTENTS,
  MESSAGE_INTENTS,
  VARIABLES,
  allSteps,
  triggerProblem,
  materialIcon,
  sid,
  type ConditionRule,
  type Flow,
  type FlowStep,
  type LeadNumberField,
  type Material,
  type MessageIntent,
  type NotifyTarget,
  type TriggerConfig,
  type TriggerType,
} from "@/lib/crm/flows";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

const NEW_STEP: Record<FlowStep["type"], () => FlowStep> = {
  message: () => ({ id: sid(), type: "message", text: "Hola {{nombre}}, ", materialId: null }),
  wait: () => ({ id: sid(), type: "wait", amount: 2, unit: "hour" }),
  wait_appt: () => ({ id: sid(), type: "wait_appt", amount: 24, unit: "hour" }),
  action: () => ({ id: sid(), type: "action", action: "add_tag", value: "" }),
  notify: () => ({
    id: sid(),
    type: "notify",
    to: ["assigned"],
    text: "{{nombre_completo}} necesita atención.",
    whatsapp: true,
  }),
  assign: () => ({ id: sid(), type: "assign", mode: "round_robin", userIds: [] }),
  condition: () => ({
    id: sid(),
    type: "condition",
    rule: { kind: "replied" },
    yes: [],
    no: [],
  }),
  end: () => ({ id: sid(), type: "end" }),
};

/** Equipo de la subcuenta, para elegir a quién avisar o asignar. */
const MembersCtx = createContext<Member[]>([]);

const ICON = {
  message: MessageSquare,
  wait: Clock,
  wait_appt: CalendarClock,
  action: Zap,
  notify: BellRing,
  assign: UserCheck,
  condition: GitBranch,
  end: CircleStop,
};
const TITLE = {
  message: "Mensaje",
  wait: "Espera",
  wait_appt: "Espera antes de la cita",
  action: "Acción",
  notify: "Avisar al equipo",
  assign: "Asignar asesor",
  condition: "Condición sí / no",
  end: "Terminar flujo",
};

const tagInput = (v: string) => v.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");

const NEW_RULE: Record<ConditionRule["kind"], () => ConditionRule> = {
  replied: () => ({ kind: "replied" }),
  advisor_replied: () => ({ kind: "advisor_replied" }),
  tag: () => ({ kind: "tag", tag: "" }),
  stage: () => ({ kind: "stage", op: "gte", stage: "2" }),
  field: () => ({ kind: "field", field: "budget", op: "set", value: 0 }),
  appointment: () => ({ kind: "appointment" }),
};

function RuleEditor({
  rule,
  onChange,
}: {
  rule: ConditionRule;
  onChange: (r: ConditionRule) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <select
        className={sel}
        value={rule.kind}
        onChange={(e) => onChange(NEW_RULE[e.target.value as ConditionRule["kind"]]())}
      >
        <option value="replied">Respondió el mensaje</option>
        <option value="advisor_replied">Un asesor le escribió</option>
        <option value="tag">Tiene etiqueta</option>
        <option value="stage">Etapa del pipeline</option>
        <option value="field">Dato del lead</option>
        <option value="appointment">Tiene cita programada</option>
      </select>
      {rule.kind === "advisor_replied" && (
        <span className="self-center text-xs text-muted-foreground">
          desde que entró al flujo. Pon antes una espera (ej. 10 minutos) para escalar si nadie lo
          atendió.
        </span>
      )}
      {rule.kind === "tag" && (
        <Input
          className="w-48"
          value={rule.tag}
          onChange={(e) => onChange({ ...rule, tag: tagInput(e.target.value) })}
          placeholder="etiqueta"
        />
      )}
      {rule.kind === "stage" && (
        <>
          <select
            className={sel}
            value={rule.op}
            onChange={(e) => onChange({ ...rule, op: e.target.value as "eq" })}
          >
            <option value="gte">llegó a … o más</option>
            <option value="eq">está en</option>
          </select>
          <select
            className={sel}
            value={rule.stage}
            onChange={(e) => onChange({ ...rule, stage: e.target.value })}
          >
            {STAGES.map((s, j) => (
              <option key={s.code} value={j}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </>
      )}
      {rule.kind === "field" && (
        <>
          <select
            className={sel}
            value={rule.field}
            onChange={(e) => onChange({ ...rule, field: e.target.value as LeadNumberField })}
          >
            {(Object.keys(FIELD_LABEL) as LeadNumberField[]).map((k) => (
              <option key={k} value={k}>
                {FIELD_LABEL[k]}
              </option>
            ))}
          </select>
          <select
            className={sel}
            value={rule.op}
            onChange={(e) => onChange({ ...rule, op: e.target.value as "set" })}
          >
            <option value="set">tiene dato</option>
            <option value="gte">es mayor o igual a</option>
            <option value="lte">es menor o igual a</option>
          </select>
          {rule.op !== "set" && (
            <Input
              type="number"
              min={0}
              className="w-36"
              value={rule.value}
              onChange={(e) =>
                onChange({ ...rule, value: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          )}
        </>
      )}
    </div>
  );
}

const TRIGGER_HINT: Partial<Record<TriggerType, string>> = {
  reply: "Se activa con cada mensaje del lead. Los mensajes del asesor y del bot no cuentan.",
  keyword:
    "Sin importar mayúsculas ni acentos. Cuenta palabras o frases completas: «precio» no incluye «precios», escribe las dos si quieres ambas.",
  intent:
    "La IA clasifica cada mensaje que llega mientras el bot está activo y guarda la intención en la conversación.",
  ad_lead: "Cuando el primer mensaje llega desde un anuncio de clic a WhatsApp.",
  qualification: "Cuando la IA cambia la calificación del lead en su ficha.",
};

function TriggerEditor({ f, setF }: { f: Flow; setF: (f: Flow) => void }) {
  const [words, setWords] = useState((f.triggerConfig.keywords ?? []).join(", "));
  const conversation = CONVERSATION_TRIGGERS.includes(f.triggerType);
  const cfg = f.triggerConfig;
  const setCfg = (c: TriggerConfig) => setF({ ...f, triggerConfig: c });
  const intents = cfg.intents ?? [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select
          className={sel}
          aria-label="Tipo de disparador"
          value={f.triggerType}
          onChange={(e) => {
            const t = e.target.value as TriggerType;
            setWords("");
            setF({
              ...f,
              triggerType: t,
              triggerValue: t === "stage" ? "1" : "",
              triggerConfig: {},
              // Un disparador de conversación se repite con cada mensaje: sin reingreso por defecto.
              allowReentry: !CONVERSATION_TRIGGERS.includes(t),
            });
          }}
        >
          <optgroup label="Conversación de WhatsApp">
            <option value="reply">El lead responde</option>
            <option value="keyword">El mensaje contiene…</option>
            <option value="intent">La IA detecta una intención…</option>
          </optgroup>
          <optgroup label="Lead">
            <option value="new_lead">Lead nuevo</option>
            <option value="ad_lead">Lead nuevo de anuncio</option>
            <option value="stage">Cuando entra a etapa…</option>
            <option value="tag">Cuando recibe etiqueta…</option>
            <option value="qualification">Cambió la calificación de IA</option>
          </optgroup>
        </select>
        {f.triggerType === "stage" && (
          <select
            className={sel}
            value={f.triggerValue}
            onChange={(e) => setF({ ...f, triggerValue: e.target.value })}
          >
            {STAGES.map((s, i) => (
              <option key={s.code} value={i}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        )}
        {f.triggerType === "tag" && (
          <Input
            className="w-48"
            value={f.triggerValue}
            onChange={(e) => setF({ ...f, triggerValue: tagInput(e.target.value) })}
            placeholder="ej. calificando"
          />
        )}
        {f.triggerType === "keyword" && (
          <Input
            className="min-w-64 flex-1"
            aria-label="Palabras o frases"
            value={words}
            onChange={(e) => {
              setWords(e.target.value);
              setCfg({
                ...cfg,
                keywords: e.target.value
                  .split(",")
                  .map((w) => w.trim())
                  .filter(Boolean),
              });
            }}
            placeholder="precio, cotización, cuánto cuesta"
          />
        )}
        {f.triggerType === "ad_lead" && (
          <Input
            className="min-w-64 flex-1"
            value={f.triggerValue}
            onChange={(e) => setF({ ...f, triggerValue: e.target.value })}
            placeholder="El nombre del anuncio contiene… (opcional)"
          />
        )}
        {f.triggerType === "qualification" && (
          <select
            className={sel}
            value={f.triggerValue}
            onChange={(e) => setF({ ...f, triggerValue: e.target.value })}
          >
            <option value="">Cualquier cambio</option>
            {Object.entries(LEAD_INTENTS).map(([k, label]) => (
              <option key={k} value={k}>
                Cambia a «{label}»
              </option>
            ))}
          </select>
        )}
      </div>
      {f.triggerType === "intent" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Intenciones">
          {(Object.keys(MESSAGE_INTENTS) as MessageIntent[]).map((k) => {
            const on = intents.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setCfg({ ...cfg, intents: on ? intents.filter((i) => i !== k) : [...intents, k] })
                }
                className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary"}`}
              >
                {MESSAGE_INTENTS[k]}
              </button>
            );
          })}
        </div>
      )}
      {conversation && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Solo si el lead
          <select
            className={`${sel} h-8 text-xs`}
            aria-label="Filtro de etapa"
            value={cfg.stage ?? ""}
            onChange={(e) => {
              const { stage: _stage, ...rest } = cfg;
              setCfg(e.target.value === "" ? rest : { ...rest, stage: Number(e.target.value) });
            }}
          >
            <option value="">está en cualquier etapa</option>
            {STAGES.map((s, i) => (
              <option key={s.code} value={i}>
                está en {s.code} · {s.name}
              </option>
            ))}
          </select>
          y
          <Input
            className="h-8 w-44 text-xs"
            aria-label="Filtro de etiqueta"
            value={cfg.tag ?? ""}
            onChange={(e) => {
              const { tag: _tag, ...rest } = cfg;
              const tag = tagInput(e.target.value);
              setCfg(tag ? { ...rest, tag } : rest);
            }}
            placeholder="tiene la etiqueta (opcional)"
          />
        </div>
      )}
      {TRIGGER_HINT[f.triggerType] && (
        <p className="text-xs text-muted-foreground">{TRIGGER_HINT[f.triggerType]}</p>
      )}
    </div>
  );
}

const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary"}`;

function NotifyEditor({
  st,
  set,
}: {
  st: Extract<FlowStep, { type: "notify" }>;
  set: (st: FlowStep) => void;
}) {
  const members = useContext(MembersCtx);
  const toggle = (t: NotifyTarget) =>
    set({ ...st, to: st.to.includes(t) ? st.to.filter((x) => x !== t) : [...st.to, t] });
  const targets: [NotifyTarget, string][] = [
    ["assigned", "Asesor asignado"],
    ["admins", "Administradores"],
    ...members.map((m): [NotifyTarget, string] => [m.userId, m.name]),
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="A quién avisar">
        {targets.map(([t, label]) => (
          <button
            key={t}
            type="button"
            aria-pressed={st.to.includes(t)}
            onClick={() => toggle(t)}
            className={chip(st.to.includes(t))}
          >
            {label}
          </button>
        ))}
      </div>
      <Textarea
        rows={2}
        aria-label="Texto del aviso"
        value={st.text}
        onChange={(e) => set({ ...st, text: e.target.value })}
      />
      <p className="text-xs text-muted-foreground">
        Se agrega solo el resumen de la IA (3 líneas), los datos del lead y el enlace a su chat.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <Switch
          aria-label="Avisar también por WhatsApp"
          checked={st.whatsapp}
          onCheckedChange={(v) => set({ ...st, whatsapp: v })}
        />
        También por WhatsApp a su número personal (además del aviso en Pulse)
      </label>
      {st.to.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">Elige al menos a quién avisar.</p>
      )}
    </div>
  );
}

function AssignEditor({
  st,
  set,
}: {
  st: Extract<FlowStep, { type: "assign" }>;
  set: (st: FlowStep) => void;
}) {
  const members = useContext(MembersCtx);
  const toggle = (id: string) =>
    set({
      ...st,
      userIds:
        st.mode === "fixed"
          ? [id]
          : st.userIds.includes(id)
            ? st.userIds.filter((x) => x !== id)
            : [...st.userIds, id],
    });
  return (
    <div className="space-y-2">
      <select
        className={sel}
        aria-label="Modo de asignación"
        value={st.mode}
        onChange={(e) =>
          set({ ...st, mode: e.target.value as "fixed", userIds: st.userIds.slice(0, 1) })
        }
      >
        <option value="round_robin">Por turnos</option>
        <option value="fixed">A una persona fija</option>
      </select>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Asesores">
        {members.map((m) => (
          <button
            key={m.userId}
            type="button"
            aria-pressed={st.userIds.includes(m.userId)}
            onClick={() => toggle(m.userId)}
            className={chip(st.userIds.includes(m.userId))}
          >
            {m.name}
            {m.available ? "" : " (no disponible)"}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {st.mode === "fixed"
          ? "Se asigna a esa persona aunque esté marcada como no disponible."
          : st.userIds.length
            ? "Reparte entre las personas elegidas, saltando a quien esté marcado como no disponible."
            : "Sin nadie elegido reparte entre todo el equipo disponible."}{" "}
        La disponibilidad se cambia en Configuración › Equipo.
      </p>
    </div>
  );
}

function StepCard({
  st,
  index,
  depth,
  materials,
  set,
  move,
  remove,
}: {
  st: FlowStep;
  index: number;
  depth: number;
  materials: Material[];
  set: (st: FlowStep) => void;
  move: (d: number) => void;
  remove: () => void;
}) {
  const Icon = ICON[st.type];
  return (
    <li className={`relative rounded-xl border bg-card ${depth > 0 ? "p-2 pl-9" : "p-3 pl-10"}`}>
      <span className="absolute left-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[10px] font-bold">
        {index + 1}
      </span>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" /> {TITLE[st.type]}
        <span className="ml-auto flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => move(-1)}
            aria-label="Subir"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => move(1)}
            aria-label="Bajar"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive"
            onClick={remove}
            aria-label="Eliminar paso"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>
      {st.type === "message" && (
        <div className="space-y-2">
          <Textarea
            rows={3}
            value={st.text}
            onChange={(e) => set({ ...st, text: e.target.value })}
          />
          <div className="flex flex-wrap gap-1">
            {VARIABLES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => set({ ...st, text: st.text + `{{${v}}}` })}
                className="rounded border border-dashed px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
              >{`{{${v}}}`}</button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" /> Adjuntar
            <select
              className={sel}
              value={st.materialId ?? ""}
              onChange={(e) => set({ ...st, materialId: e.target.value || null })}
            >
              <option value="">Sin adjunto</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {materialIcon(m.kind)} {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {(st.type === "wait" || st.type === "wait_appt") && (
        <div className="flex items-center gap-2 text-sm">
          <Input
            type="number"
            min={1}
            className="w-20"
            value={st.amount}
            onChange={(e) => set({ ...st, amount: Math.max(1, Number(e.target.value) || 1) })}
          />
          <select
            className={sel}
            value={st.unit}
            onChange={(e) => set({ ...st, unit: e.target.value as "min" })}
          >
            <option value="min">minutos</option>
            <option value="hour">horas</option>
            <option value="day">días</option>
          </select>
          <span className="text-muted-foreground">
            {st.type === "wait"
              ? "después del paso anterior"
              : "antes de la próxima cita (se omite si ya pasó)"}
          </span>
        </div>
      )}
      {st.type === "action" && (
        <div className="flex flex-wrap gap-2">
          <select
            className={sel}
            value={st.action}
            onChange={(e) =>
              set({
                ...st,
                action: e.target.value as "add_tag",
                value: e.target.value === "set_stage" ? "1" : "",
              })
            }
          >
            <option value="add_tag">Agregar etiqueta</option>
            <option value="remove_tag">Remover etiqueta</option>
            <option value="set_stage">Cambiar etapa</option>
            <option value="bot_off">Apagar el bot para este lead</option>
            <option value="bot_on">Encender el bot para este lead</option>
          </select>
          {st.action === "bot_on" || st.action === "bot_off" ? null : st.action === "set_stage" ? (
            <select
              className={sel}
              value={st.value}
              onChange={(e) => set({ ...st, value: e.target.value })}
            >
              {STAGES.map((s, j) => (
                <option key={s.code} value={j}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          ) : (
            <Input
              className="w-48"
              value={st.value}
              onChange={(e) =>
                set({
                  ...st,
                  value: e.target.value.trim().toLowerCase().replace(/\s+/g, "-"),
                })
              }
              placeholder="etiqueta"
            />
          )}
        </div>
      )}
      {st.type === "notify" && <NotifyEditor st={st} set={set} />}
      {st.type === "assign" && <AssignEditor st={st} set={set} />}
      {st.type === "condition" && (
        <div className="space-y-3">
          <RuleEditor rule={st.rule} onChange={(rule) => set({ ...st, rule })} />
          {(["yes", "no"] as const).map((b) => (
            <div
              key={b}
              className={`border-l-4 pl-3 ${b === "yes" ? "border-emerald-500/60" : "border-rose-500/60"}`}
            >
              <div
                className={`mb-1.5 text-xs font-bold uppercase tracking-wide ${b === "yes" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
              >
                {b === "yes" ? "Sí" : "No"}
              </div>
              <StepList
                steps={st[b]}
                depth={depth + 1}
                materials={materials}
                onChange={(steps) => set({ ...st, [b]: steps })}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Al terminar cualquiera de las dos ramas, el flujo sigue con el paso de abajo. Usa
            «Terminar flujo» para que una rama acabe ahí.
          </p>
        </div>
      )}
      {st.type === "end" && (
        <p className="text-xs text-muted-foreground">El flujo termina aquí para este lead.</p>
      )}
    </li>
  );
}

function StepList({
  steps,
  depth,
  materials,
  onChange,
}: {
  steps: FlowStep[];
  depth: number;
  materials: Material[];
  onChange: (steps: FlowStep[]) => void;
}) {
  const move = (i: number, d: number) => {
    const s = [...steps];
    const j = i + d;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j]!, s[i]!];
    onChange(s);
  };
  const types = (Object.keys(NEW_STEP) as FlowStep["type"][]).filter(
    (t) => t !== "condition" || depth < MAX_BRANCH_DEPTH,
  );
  return (
    <div className="space-y-2">
      {steps.length > 0 && (
        <ol className="space-y-2">
          {steps.map((st, i) => (
            <StepCard
              key={st.id}
              st={st}
              index={i}
              depth={depth}
              materials={materials}
              set={(x) => onChange(steps.map((y, j) => (j === i ? x : y)))}
              move={(d) => move(i, d)}
              remove={() => onChange(steps.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      )}
      {depth > 0 ? (
        <select
          className={`${sel} h-8 w-full text-xs text-muted-foreground`}
          value=""
          aria-label="Agregar paso a la rama"
          onChange={(e) => {
            const t = e.target.value as FlowStep["type"];
            if (t) onChange([...steps, NEW_STEP[t]()]);
          }}
        >
          <option value="">+ Agregar paso…</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TITLE[t]}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => {
            const Icon = ICON[t];
            return (
              <Button
                key={t}
                variant="outline"
                size="sm"
                onClick={() => onChange([...steps, NEW_STEP[t]()])}
              >
                <Icon className="mr-1 h-3.5 w-3.5" /> {TITLE[t]}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FlowEditor({
  flow,
  materials,
  members = [],
  onClose,
  onSave,
}: {
  flow: Flow;
  materials: Material[];
  members?: Member[];
  onClose: () => void;
  onSave: (f: Flow) => Promise<boolean>;
}) {
  const [f, setF] = useState<Flow>(flow);
  const [saving, setSaving] = useState(false);
  const every = allSteps(f.steps);
  const asksReplied = every.some((s) => s.type === "condition" && s.rule.kind === "replied");
  const missingTag = every.some(
    (s) =>
      (s.type === "condition" && s.rule.kind === "tag" && !s.rule.tag) ||
      (s.type === "notify" && (!s.to.length || !s.text.trim())) ||
      (s.type === "assign" && s.mode === "fixed" && !s.userIds.length),
  );
  const asksAdvisor = every.some(
    (s) => s.type === "condition" && s.rule.kind === "advisor_replied",
  );

  return (
    <MembersCtx.Provider value={members}>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Constructor de flujo</DialogTitle>
          </DialogHeader>
          <Input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="Nombre del flujo"
            className="font-semibold"
          />

          <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              <Zap className="h-3.5 w-3.5" /> Disparador
            </div>
            <TriggerEditor f={f} setF={setF} />
          </div>

          <StepList
            steps={f.steps}
            depth={0}
            materials={materials}
            onChange={(steps) => setF((p) => ({ ...p, steps }))}
          />

          <label className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1">
              Regla anti-spam: si el prospecto responde o un asesor interviene, cancelar el flujo
              automáticamente y pasar el control al bot o al asesor.
            </span>
            <Switch
              aria-label="Regla anti-spam"
              checked={f.stopOnReply}
              onCheckedChange={(v) => setF({ ...f, stopOnReply: v })}
            />
          </label>
          <label className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
            <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1">
              Permitir reingreso: un lead que ya terminó este flujo (o se canceló) puede volver a
              entrar si se cumple el disparador otra vez. Nunca entra dos veces al mismo tiempo.
            </span>
            <Switch
              aria-label="Permitir reingreso"
              checked={f.allowReentry}
              onCheckedChange={(v) => setF({ ...f, allowReentry: v })}
            />
          </label>
          {f.allowReentry && CONVERSATION_TRIGGERS.includes(f.triggerType) && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              Con reingreso, este flujo vuelve a empezar cada vez que el lead escriba algo que
              cumpla el disparador. Desactívalo si solo debe correr una vez por lead.
            </p>
          )}
          {asksAdvisor && f.stopOnReply && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              Este flujo pregunta si un asesor le escribió, pero con la regla anti-spam activa el
              flujo se cancela en cuanto el asesor escribe. Desactívala para usar esa condición.
            </p>
          )}
          {asksReplied && f.stopOnReply && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              Este flujo pregunta «¿Respondió?», pero con la regla anti-spam activa el flujo se
              cancela en cuanto el lead responde, así que nunca llegará a la rama «Sí». Desactívala
              para usar esa condición.
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              disabled={saving || !f.name.trim() || triggerProblem(f) != null || missingTag}
              onClick={async () => {
                setSaving(true);
                if (await onSave(f)) onClose();
                setSaving(false);
              }}
            >
              Guardar flujo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MembersCtx.Provider>
  );
}
