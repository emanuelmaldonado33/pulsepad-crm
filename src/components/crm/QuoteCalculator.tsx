import { useState } from "react";
import { Calculator, Copy } from "lucide-react";
import { computeQuote, quoteText } from "@/lib/crm/tools";
import { money, useCrm } from "@/lib/crm/store";
import type { Lead } from "@/lib/crm/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const TERMS = [12, 24, 36, 48, 60];

export function QuoteCalculator({ lead }: { lead: Lead }) {
  const { account } = useCrm();
  const initPct = lead.budget && lead.downPayment ? Math.round((lead.downPayment / lead.budget) * 100) : 20;
  const [price, setPrice] = useState<number>(lead.budget ?? 0);
  const [pct, setPct] = useState<number>(initPct);
  const [months, setMonths] = useState<number>(lead.termMonths && lead.termMonths > 0 ? lead.termMonths : 24);
  const [custom, setCustom] = useState(!TERMS.includes(months));
  const [rate, setRate] = useState<number>(0);
  const q = computeQuote(price, pct, months, rate);

  const copy = async () => {
    const txt = quoteText(q, { leadName: lead.name, product: account.product, brand: account.name });
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("Cotización copiada. Pégala en WhatsApp.");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <section className="rounded-xl border bg-card p-3">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Calculator className="h-3.5 w-3.5" /> Cotizador rápido
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs">Precio total
          <Input type="number" min={0} className="mt-1 h-8" value={price || ""} onChange={(e) => setPrice(Number(e.target.value))} />
        </label>
        <label className="text-xs">Enganche %
          <Input type="number" min={0} max={100} className="mt-1 h-8" value={pct} onChange={(e) => setPct(Number(e.target.value))} />
        </label>
        <div className="text-xs">Monto enganche
          <div className="mt-1 flex h-8 items-center font-display text-sm font-semibold">{money(q.downAmount)}</div>
        </div>
      </div>
      <div className="mt-2 text-xs">Plazo</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {TERMS.map((t) => (
          <button key={t} type="button" onClick={() => { setMonths(t); setCustom(false); }}
            className={`rounded-md border px-2 py-1 text-xs ${!custom && months === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{t}</button>
        ))}
        <button type="button" onClick={() => setCustom(true)} className={`rounded-md border px-2 py-1 text-xs ${custom ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Otro</button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {custom && (
          <label className="text-xs">Meses
            <Input type="number" min={0} className="mt-1 h-8" value={months} onChange={(e) => setMonths(Number(e.target.value))} />
          </label>
        )}
        <label className="text-xs">Tasa anual % (opcional)
          <Input type="number" min={0} step="0.1" className="mt-1 h-8" value={rate || ""} placeholder="0" onChange={(e) => setRate(Number(e.target.value))} />
        </label>
      </div>
      <div className="mt-3 rounded-lg bg-primary/10 p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Mensualidad estimada</div>
        <div className="font-display text-xl font-bold text-primary">{q.months > 0 ? money(q.monthly) : "Contado"}</div>
        <div className="text-xs text-muted-foreground">Saldo a financiar {money(q.financed)}</div>
      </div>
      <Button size="sm" className="mt-3 w-full" onClick={copy} disabled={!price}><Copy className="mr-2 h-4 w-4" /> Copiar cotización</Button>
    </section>
  );
}
