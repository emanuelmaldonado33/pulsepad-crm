import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles, Upload } from "lucide-react";
import { generateFlowDraft } from "@/lib/crm/flow-ai.functions";
import { extractJson, parseFlow } from "@/lib/crm/flow-io";
import type { Flow, Material } from "@/lib/crm/flows";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const EXAMPLE = "Flujo de 3 días para reactivar prospectos de preventa de terrenos: día 1 video de avances, día 2 preguntar por enganche, día 3 ofrecer llamada con asesor.";

export function AiFlowDialog({ accountId, materials, onClose, onDraft }: { accountId: string; materials: Material[]; onClose: () => void; onDraft: (f: Flow) => void }) {
  const gen = useServerFn(generateFlowDraft);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await gen({ data: { accountId, prompt } });
      if ("error" in r && r.error) return setError(r.error);
      if (!("draft" in r) || !r.draft) return setError("La IA no devolvió un flujo.");
      onDraft(parseFlow(r.draft, accountId, materials));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el flujo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Crear flujo con IA</DialogTitle>
          <DialogDescription>Describe el seguimiento que necesitas. Claude arma el disparador, los mensajes, las esperas y las acciones; tú lo revisas antes de guardar.</DialogDescription>
        </DialogHeader>
        <Textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={EXAMPLE} disabled={busy} />
        {!prompt && <button type="button" className="text-left text-xs text-primary hover:underline" onClick={() => setPrompt(EXAMPLE)}>Usar ejemplo</button>}
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={run} disabled={busy || prompt.trim().length < 10}>
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generando…</> : <><Sparkles className="mr-2 h-4 w-4" /> Generar flujo</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportFlowDialog({ accountId, materials, onClose, onImport }: { accountId: string; materials: Material[]; onClose: () => void; onImport: (f: Flow) => Promise<boolean> }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (raw: string) => {
    setError(null);
    let flow: Flow;
    try {
      flow = parseFlow(extractJson(raw), accountId, materials);
    } catch (e) {
      return setError(e instanceof Error ? e.message : "Archivo inválido");
    }
    setBusy(true);
    if (await onImport(flow)) onClose();
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar flujo</DialogTitle>
          <DialogDescription>Sube un archivo .json descargado de otra subcuenta o pega el código del flujo. Se crea inactivo para que lo revises.</DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-sm hover:border-primary">
          <Upload className="h-4 w-4 text-primary" /> Elegir archivo .json
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > 500_000) return setError("El archivo pesa más de 500 KB");
              await submit(await f.text());
            }}
          />
        </label>
        <Textarea rows={8} className="font-mono text-xs" value={code} onChange={(e) => setCode(e.target.value)} placeholder='{ "name": "…", "trigger": { "type": "new_lead", "value": "" }, "steps": [ … ] }' />
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !code.trim()} onClick={() => submit(code)}>Importar código</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
