import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { parseLeadsTable } from "@/lib/crm/tools";
import { money, useCrm } from "@/lib/crm/store";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function ImportLeadsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { account, importLeads } = useCrm();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseLeadsTable(text), [text]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) return void toast.error("El archivo es muy grande (máx. 2 MB)");
    setText(await f.text());
  };

  const submit = async () => {
    if (!parsed.rows.length) return;
    if (parsed.rows.length > 2000) return void toast.error("Máximo 2,000 leads por importación");
    setBusy(true);
    const n = await importLeads(parsed.rows);
    setBusy(false);
    if (n) {
      toast.success(`${n} leads importados a ${account.name}`);
      setText("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Importar leads a {account.name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Columnas: <b>Nombre, Teléfono, Presupuesto, Etiqueta inicial</b>. Sube un CSV o pega una tabla desde Excel o Google Sheets. La etiqueta inicial aplica su automatización (p. ej. «calificando» los pone en P2).</p>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" /> Elegir archivo CSV
          <input type="file" accept=".csv,.txt,.tsv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Nombre,Teléfono,Presupuesto,Etiqueta inicial\nAna Ruiz,+52 55 1234 5678,1200000,vip"} className="font-mono text-xs" />
        {parsed.rows.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border text-sm">
            <table className="w-full">
              <thead className="bg-muted text-left text-xs"><tr><th className="px-2 py-1">Nombre</th><th>Teléfono</th><th>Presupuesto</th><th>Etiqueta</th></tr></thead>
              <tbody>
                {parsed.rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t"><td className="px-2 py-1">{r.name}</td><td>{r.phone}</td><td>{money(r.budget)}</td><td>{r.tag ? `#${r.tag}` : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {parsed.errors.length > 0 && <p className="text-xs text-destructive">{parsed.errors.slice(0, 3).join(" · ")}{parsed.errors.length > 3 ? ` y ${parsed.errors.length - 3} más` : ""}</p>}
        <DialogFooter>
          <span className="mr-auto self-center text-sm text-muted-foreground">{parsed.rows.length} leads listos</span>
          <Button onClick={submit} disabled={busy || !parsed.rows.length}>{busy ? "Importando…" : `Importar ${parsed.rows.length}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
