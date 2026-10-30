import { useState } from "react";
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
} from "lucide-react";
import { STAGES } from "@/lib/crm/types";
import { MAX_BRANCH_DEPTH } from "@/lib/crm/flow-io";
import {
  FIELD_LABEL,
  VARIABLES,
  allSteps,
  materialIcon,
  sid,
  type ConditionRule,
  type Flow,
  type FlowStep,
  type LeadNumberField,
  type Material,
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
  condition: () => ({
    id: sid(),
    type: "condition",
    rule: { kind: "replied" },
    yes: [],
    no: [],
  }),
  end: () => ({ id: sid(), type: "end" }),
};

const ICON = {
  message: MessageSquare,
  wait: Clock,
  wait_appt: CalendarClock,
  action: Zap,
  condition: GitBranch,
  end: CircleStop,
};
const TITLE = {
  message: "Mensaje",
  wait: "Espera",
  wait_appt: "Espera antes de la cita",
  action: "Acción",
  condition: "Condición sí / no",
  end: "Terminar flujo",
};

const tagInput = (v: string) => v.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");

const NEW_RULE: Record<ConditionRule["kind"], () => ConditionRule> = {
  replied: () => ({ kind: "replied" }),
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
        <option value="tag">Tiene etiqueta</option>
        <option value="stage">Etapa del pipeline</option>
        <option value="field">Dato del lead</option>
        <option value="appointment">Tiene cita programada</option>
      </select>
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
          </select>
          {st.action === "set_stage" ? (
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
  onClose,
  onSave,
}: {
  flow: Flow;
  materials: Material[];
  onClose: () => void;
  onSave: (f: Flow) => Promise<boolean>;
}) {
  const [f, setF] = useState<Flow>(flow);
  const [saving, setSaving] = useState(false);
  const every = allSteps(f.steps);
  const asksReplied = every.some((s) => s.type === "condition" && s.rule.kind === "replied");
  const missingTag = every.some(
    (s) => s.type === "condition" && s.rule.kind === "tag" && !s.rule.tag,
  );

  return (
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
          <div className="flex flex-wrap gap-2">
            <select
              className={sel}
              value={f.triggerType}
              onChange={(e) =>
                setF({
                  ...f,
                  triggerType: e.target.value as Flow["triggerType"],
                  triggerValue: e.target.value === "stage" ? "1" : "",
                })
              }
            >
              <option value="new_lead">Lead nuevo</option>
              <option value="stage">Cuando entra a etapa…</option>
              <option value="tag">Cuando recibe etiqueta…</option>
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
                onChange={(e) =>
                  setF({
                    ...f,
                    triggerValue: e.target.value.trim().toLowerCase().replace(/\s+/g, "-"),
                  })
                }
                placeholder="ej. calificando"
              />
            )}
          </div>
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
          <Switch checked={f.stopOnReply} onCheckedChange={(v) => setF({ ...f, stopOnReply: v })} />
        </label>
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
            disabled={
              saving || !f.name.trim() || (f.triggerType === "tag" && !f.triggerValue) || missingTag
            }
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
  );
}
