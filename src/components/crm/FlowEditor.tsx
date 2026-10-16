import { useState } from "react";
import { ArrowDown, ArrowUp, Clock, MessageSquare, Paperclip, Trash2, Zap, CalendarClock, ShieldCheck } from "lucide-react";
import { STAGES } from "@/lib/crm/types";
import { VARIABLES, sid, type Flow, type FlowStep, type Material } from "@/lib/crm/flows";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
};

const ICON = { message: MessageSquare, wait: Clock, wait_appt: CalendarClock, action: Zap };
const TITLE = { message: "Mensaje", wait: "Espera", wait_appt: "Espera antes de la cita", action: "Acción" };

export function FlowEditor({ flow, materials, onClose, onSave }: { flow: Flow; materials: Material[]; onClose: () => void; onSave: (f: Flow) => Promise<boolean> }) {
  const [f, setF] = useState<Flow>(flow);
  const [saving, setSaving] = useState(false);
  const setStep = (i: number, st: FlowStep) => setF((p) => ({ ...p, steps: p.steps.map((x, j) => (j === i ? st : x)) }));
  const move = (i: number, d: number) =>
    setF((p) => {
      const s = [...p.steps];
      const j = i + d;
      if (j < 0 || j >= s.length) return p;
      [s[i], s[j]] = [s[j]!, s[i]!];
      return { ...p, steps: s };
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Constructor de flujo</DialogTitle></DialogHeader>
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nombre del flujo" className="font-semibold" />

        <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><Zap className="h-3.5 w-3.5" /> Disparador</div>
          <div className="flex flex-wrap gap-2">
            <select className={sel} value={f.triggerType} onChange={(e) => setF({ ...f, triggerType: e.target.value as Flow["triggerType"], triggerValue: e.target.value === "stage" ? "1" : "" })}>
              <option value="new_lead">Lead nuevo</option>
              <option value="stage">Cuando entra a etapa…</option>
              <option value="tag">Cuando recibe etiqueta…</option>
            </select>
            {f.triggerType === "stage" && (
              <select className={sel} value={f.triggerValue} onChange={(e) => setF({ ...f, triggerValue: e.target.value })}>
                {STAGES.map((s, i) => <option key={s.code} value={i}>{s.code} · {s.name}</option>)}
              </select>
            )}
            {f.triggerType === "tag" && <Input className="w-48" value={f.triggerValue} onChange={(e) => setF({ ...f, triggerValue: e.target.value.trim().toLowerCase().replace(/\s+/g, "-") })} placeholder="ej. calificando" />}
          </div>
        </div>

        <ol className="space-y-2">
          {f.steps.map((st, i) => {
            const Icon = ICON[st.type];
            return (
              <li key={st.id} className="relative rounded-xl border bg-card p-3 pl-10">
                <span className="absolute left-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[10px] font-bold">{i + 1}</span>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Icon className="h-4 w-4 text-primary" /> {TITLE[st.type]}
                  <span className="ml-auto flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(i, -1)} aria-label="Subir"><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(i, 1)} aria-label="Bajar"><ArrowDown className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setF({ ...f, steps: f.steps.filter((_, j) => j !== i) })} aria-label="Eliminar paso"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </span>
                </div>
                {st.type === "message" && (
                  <div className="space-y-2">
                    <Textarea rows={3} value={st.text} onChange={(e) => setStep(i, { ...st, text: e.target.value })} />
                    <div className="flex flex-wrap gap-1">
                      {VARIABLES.map((v) => (
                        <button key={v} type="button" onClick={() => setStep(i, { ...st, text: st.text + `{{${v}}}` })} className="rounded border border-dashed px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary">{`{{${v}}}`}</button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Paperclip className="h-3.5 w-3.5" /> Adjuntar
                      <select className={sel} value={st.materialId ?? ""} onChange={(e) => setStep(i, { ...st, materialId: e.target.value || null })}>
                        <option value="">Sin adjunto</option>
                        {materials.map((m) => <option key={m.id} value={m.id}>{m.kind === "video" ? "🎥" : "📄"} {m.name}</option>)}
                      </select>
                    </label>
                  </div>
                )}
                {(st.type === "wait" || st.type === "wait_appt") && (
                  <div className="flex items-center gap-2 text-sm">
                    <Input type="number" min={1} className="w-20" value={st.amount} onChange={(e) => setStep(i, { ...st, amount: Math.max(1, Number(e.target.value) || 1) })} />
                    <select className={sel} value={st.unit} onChange={(e) => setStep(i, { ...st, unit: e.target.value as "min" })}>
                      <option value="min">minutos</option><option value="hour">horas</option><option value="day">días</option>
                    </select>
                    <span className="text-muted-foreground">{st.type === "wait" ? "después del paso anterior" : "antes de la próxima cita (se omite si ya pasó)"}</span>
                  </div>
                )}
                {st.type === "action" && (
                  <div className="flex flex-wrap gap-2">
                    <select className={sel} value={st.action} onChange={(e) => setStep(i, { ...st, action: e.target.value as "add_tag", value: e.target.value === "set_stage" ? "1" : "" })}>
                      <option value="add_tag">Agregar etiqueta</option><option value="remove_tag">Remover etiqueta</option><option value="set_stage">Cambiar etapa</option>
                    </select>
                    {st.action === "set_stage" ? (
                      <select className={sel} value={st.value} onChange={(e) => setStep(i, { ...st, value: e.target.value })}>
                        {STAGES.map((s, j) => <option key={s.code} value={j}>{s.code} · {s.name}</option>)}
                      </select>
                    ) : (
                      <Input className="w-48" value={st.value} onChange={(e) => setStep(i, { ...st, value: e.target.value.trim().toLowerCase().replace(/\s+/g, "-") })} placeholder="etiqueta" />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(NEW_STEP) as FlowStep["type"][]).map((t) => {
            const Icon = ICON[t];
            return <Button key={t} variant="outline" size="sm" onClick={() => setF({ ...f, steps: [...f.steps, NEW_STEP[t]()] })}><Icon className="mr-1 h-3.5 w-3.5" /> {TITLE[t]}</Button>;
          })}
        </div>

        <label className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">Regla anti-spam: si el prospecto responde o un asesor interviene, cancelar el flujo automáticamente y pasar el control al bot o al asesor.</span>
          <Switch checked={f.stopOnReply} onCheckedChange={(v) => setF({ ...f, stopOnReply: v })} />
        </label>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={saving || !f.name.trim() || (f.triggerType === "tag" && !f.triggerValue)}
            onClick={async () => { setSaving(true); if (await onSave(f)) onClose(); setSaving(false); }}
          >Guardar flujo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
