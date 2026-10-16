import { useState } from "react";
import { money, termLabel, useCrm } from "@/lib/crm/store";
import { STAGES, type Lead } from "@/lib/crm/types";
import { TAG_RULES, applyTag, removeTag } from "@/lib/crm/automation";
import { TagChip } from "./AppShell";
import { QuoteCalculator } from "./QuoteCalculator";
import { LeadFlows } from "./LeadFlows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function stageLabel(l: Lead) {
  if (l.stage === 7) return l.outcome === "no_califica" ? "P7 · No califica" : "P7 · Ganado";
  return `${STAGES[l.stage]!.code} · ${STAGES[l.stage]!.name}`;
}

function NumField({ label, value, onChange, suffix }: { label: string; value: number | null; onChange: (v: number | null) => void; suffix?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="h-8"
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

export function LeadFile({ lead, readOnly }: { lead: Lead; readOnly?: boolean }) {
  const { updateLead, account } = useCrm();
  const quick = Array.from(new Set([...Object.keys(TAG_RULES), ...account.standardTags])).filter((t) => !lead.tags.includes(t));
  const [newTag, setNewTag] = useState("");
  const set = (patch: Partial<Lead>) => updateLead(lead.id, (l) => ({ ...l, ...patch }));

  const addTag = (t: string) => {
    const tag = t.trim().toLowerCase().replace(/\s+/g, "-");
    if (!tag) return;
    const before = lead;
    const next = applyTag(lead, tag);
    updateLead(lead.id, () => next);
    if (before.stage !== next.stage) toast(`Etiqueta «${tag}» movió a ${stageLabel(next)}`);
    if (before.botActive !== next.botActive) toast(`Bot ${next.botActive ? "reactivado" : "pausado"} por etiqueta «${tag}»`);
    setNewTag("");
  };

  return (
    <div className="space-y-5 p-4">
      <div>
        <div className="font-display text-lg font-semibold">{lead.name}</div>
        <div className="text-sm text-muted-foreground">{lead.phone} · {lead.source}</div>
        <div className="mt-2 inline-block rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{stageLabel(lead)}</div>
      </div>

      <section className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-3">
        {readOnly ? (
          <>
            <Kv k="Presupuesto" v={money(lead.budget)} />
            <Kv k="Enganche" v={money(lead.downPayment)} />
            <Kv k="Plazo" v={termLabel(lead.termMonths)} />
            <Kv k="Bot" v={lead.botActive ? "Activo" : "Pausado"} />
          </>
        ) : (
          <>
            <NumField label="Presupuesto" value={lead.budget} onChange={(v) => set({ budget: v })} />
            <NumField label="Enganche" value={lead.downPayment} onChange={(v) => set({ downPayment: v })} />
            <NumField label="Plazo" value={lead.termMonths} onChange={(v) => set({ termMonths: v })} suffix="meses" />
            <Kv k="Saldo a financiar" v={lead.budget != null && lead.downPayment != null ? money(lead.budget - lead.downPayment) : "—"} />
          </>
        )}
      </section>

      <LeadFlows leadId={lead.id} testMode={readOnly} />

      <section>
        <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Etiquetas</div>
        <div className="flex flex-wrap gap-1.5">
          {lead.tags.length === 0 && <span className="text-xs text-muted-foreground">Sin etiquetas</span>}
          {lead.tags.map((t) => (
            <TagChip key={t} tag={t} {...(readOnly ? {} : { onRemove: () => updateLead(lead.id, (l) => removeTag(l, t)) })} />
          ))}
        </div>
        {!readOnly && (
          <>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addTag(newTag);
              }}
            >
              <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nueva etiqueta" className="h-8" />
            </form>
            <div className="mt-2 flex flex-wrap gap-1">
              {quick.map((t) => (
                <button key={t} title={TAG_RULES[t]?.label ?? "Etiqueta descriptiva"} onClick={() => addTag(t)} className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary">
                  +{t}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {!readOnly && <QuoteCalculator key={lead.id} lead={lead} />}

      <section>
        <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Notas del asesor</div>
        {readOnly ? (
          <p className="text-sm">{lead.notes || "—"}</p>
        ) : (
          <Textarea value={lead.notes} onChange={(e) => set({ notes: e.target.value })} rows={4} placeholder="Escribe notas internas…" />
        )}
      </section>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className="font-display text-sm font-semibold">{v}</div>
    </div>
  );
}
