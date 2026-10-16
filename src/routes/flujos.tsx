import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, FileUp, Sparkles, Copy, FileText, Image as ImageIcon, Upload, Pencil, Plus, Trash2, Video, Workflow } from "lucide-react";
import { toast } from "sonner";
import { useCrm } from "@/lib/crm/store";
import { STAGES } from "@/lib/crm/types";
import { FLOW_TEMPLATES, triggerLabel, type Flow, type Material } from "@/lib/crm/flows";
import { FlowEditor } from "@/components/crm/FlowEditor";
import { AiFlowDialog, ImportFlowDialog } from "@/components/crm/FlowAiImport";
import { exportFlow } from "@/lib/crm/flow-io";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/flujos")({
  head: () => ({
    meta: [
      { title: "Flujos de seguimiento — Nexo CRM" },
      { name: "description", content: "Automatizaciones de seguimiento paso a paso por subcuenta, con plantillas y biblioteca de materiales." },
      { property: "og:title", content: "Flujos de seguimiento — Nexo CRM" },
      { property: "og:description", content: "Automatizaciones de seguimiento paso a paso por subcuenta, con plantillas y biblioteca de materiales." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Flows,
});

const stageName = (n: number) => `${STAGES[n]?.code ?? "P?"} ${STAGES[n]?.name ?? ""}`;

function Flows() {
  const { account, flows, enrollments, materials, saveFlow, deleteFlow, addMaterial, deleteMaterial, uploadMaterial } = useCrm();
  const [editing, setEditing] = useState<{ flow: Flow; isNew: boolean } | null>(null);
  const [dialog, setDialog] = useState<"ai" | "import" | null>(null);
  const download = (f: Flow) => {
    const data = exportFlow(f, (id) => materials.find((m) => m.id === id)?.name ?? null);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${f.name.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "flujo"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const blank = (): Flow => ({ id: "", accountId: account.id, name: "Nuevo flujo", active: false, triggerType: "new_lead", triggerValue: "", steps: [], stopOnReply: true });

  return (
    <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Workflow className="h-6 w-6 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold">Flujos · {account.name}</h1>
          <p className="text-sm text-muted-foreground">Seguimientos automáticos paso a paso. Se ejecutan en el servidor 24/7, aunque nadie tenga el CRM abierto.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog("import")}><FileUp className="mr-1 h-4 w-4" /> Importar flujo</Button>
          <Button variant="outline" onClick={() => setDialog("ai")}><Sparkles className="mr-1 h-4 w-4" /> Crear flujo con IA</Button>
          <Button onClick={() => setEditing({ flow: blank(), isNew: true })}><Plus className="mr-1 h-4 w-4" /> Nuevo flujo</Button>
        </div>
      </div>

      <Tabs defaultValue="flujos">
        <TabsList>
          <TabsTrigger value="flujos">Mis flujos ({flows.length})</TabsTrigger>
          <TabsTrigger value="plantillas">Plantillas</TabsTrigger>
          <TabsTrigger value="biblioteca">Biblioteca de materiales</TabsTrigger>
        </TabsList>

        <TabsContent value="flujos" className="mt-4 space-y-2">
          {flows.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Aún no hay flujos. Empieza con una plantilla.</p>}
          {flows.map((f) => {
            const all = enrollments.filter((e) => e.flowId === f.id);
            const active = all.filter((e) => e.status === "active").length;
            const rate = all.length ? Math.round((all.filter((e) => e.replied).length / all.length) * 100) : null;
            return (
              <div key={f.id} className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4">
                <Switch checked={f.active} onCheckedChange={(v) => void saveFlow({ ...f, active: v })} aria-label="Activar flujo" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{f.name}</div>
                  <div className="text-xs text-muted-foreground">{triggerLabel(f, stageName)} · {f.steps.length} pasos{f.stopOnReply ? " · anti-spam" : ""}</div>
                </div>
                <Stat k="Inscritos ahora" v={String(active)} />
                <Stat k="Total" v={String(all.length)} />
                <Stat k="Tasa de respuesta" v={rate == null ? "—" : `${rate}%`} />
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{f.active ? "Activo" : "Inactivo"}</span>
                <Button size="icon" variant="ghost" onClick={() => download(f)} aria-label="Descargar flujo" title="Descargar .json"><Download className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => setEditing({ flow: f, isNew: false })} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => confirm(`¿Eliminar «${f.name}»?`) && void deleteFlow(f.id)} aria-label="Eliminar"><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="plantillas" className="mt-4 grid gap-3 md:grid-cols-3">
          {FLOW_TEMPLATES.map((t) => (
            <div key={t.key} className="flex flex-col rounded-xl border bg-card p-4">
              <div className="font-semibold">{t.name}</div>
              <div className="mt-1 text-xs text-primary">{triggerLabel(t, stageName)}</div>
              <p className="mt-2 flex-1 text-sm text-muted-foreground">{t.description}</p>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => setEditing({ flow: { ...blank(), name: `${t.name} (${account.name})`, triggerType: t.triggerType, triggerValue: t.triggerValue, steps: t.steps(materials), active: true }, isNew: true })}
              >Usar plantilla</Button>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="biblioteca" className="mt-4">
          <Library materials={materials} onUpload={uploadMaterial} onAdd={(m) => addMaterial({ ...m, accountId: account.id })} onDelete={deleteMaterial} />
        </TabsContent>
      </Tabs>

      {dialog === "ai" && (
        <AiFlowDialog accountId={account.id} materials={materials} onClose={() => setDialog(null)} onDraft={(f) => { setDialog(null); setEditing({ flow: f, isNew: true }); toast.success("Flujo generado: revísalo y guárdalo"); }} />
      )}
      {dialog === "import" && (
        <ImportFlowDialog accountId={account.id} materials={materials} onClose={() => setDialog(null)} onImport={async (f) => { const ok = await saveFlow(f, true); if (ok) toast.success(`«${f.name}» importado (inactivo)`); return ok; }} />
      )}
      {editing && (
        <FlowEditor flow={editing.flow} materials={materials} onClose={() => setEditing(null)} onSave={(f) => saveFlow(f, editing.isNew)} />
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="text-center">
      <div className="font-display text-lg font-semibold">{v}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
    </div>
  );
}

function Library({ materials, onAdd, onDelete, onUpload }: { materials: Material[]; onUpload: (f: File, name: string) => Promise<boolean>; onAdd: (m: Omit<Material, "id" | "accountId">) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Material["kind"]>("pdf");
  const valid = name.trim() && /^https?:\/\//.test(url.trim());
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      if (f.size > 50 * 1024 * 1024) { toast.error(`«${f.name}» pesa más de 50 MB`); continue; }
      if (await onUpload(f, f.name.replace(/\.[^.]+$/, ""))) toast.success(`«${f.name}» subido`);
    }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <label className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed bg-card p-6 text-center hover:border-primary ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <Upload className="h-6 w-6 text-primary" />
        <span className="text-sm font-semibold">{busy ? "Subiendo…" : "Subir archivos"}</span>
        <span className="text-xs text-muted-foreground">PDF, imágenes o videos cortos · máx. 50 MB</span>
        <input type="file" multiple accept="application/pdf,image/*,video/*" className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      </label>
      <div className="text-xs text-muted-foreground">O agrega un enlace externo:</div>
      <form
        className="flex flex-wrap gap-2 rounded-xl border bg-card p-3"
        onSubmit={async (e) => { e.preventDefault(); if (!valid) return; await onAdd({ name: name.trim(), url: url.trim(), kind }); setName(""); setUrl(""); }}
      >
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as Material["kind"])}>
          <option value="pdf">Documento PDF</option><option value="video">Video</option><option value="image">Imagen</option>
        </select>
        <Input className="w-56" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej. Brochure oficial)" />
        <Input className="min-w-64 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Enlace https://…" />
        <Button type="submit" disabled={!valid}><Plus className="mr-1 h-4 w-4" /> Agregar</Button>
      </form>
      {materials.map((m) => (
        <div key={m.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
          {m.kind === "video" ? <Video className="h-5 w-5 text-primary" /> : m.kind === "image" ? <ImageIcon className="h-5 w-5 text-primary" /> : <FileText className="h-5 w-5 text-primary" />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{m.name} {m.storagePath && <span className="ml-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">Subido</span>}</div>
            <a href={m.url} target="_blank" rel="noreferrer" className="block max-w-xl truncate text-xs text-muted-foreground hover:text-primary">{m.url}</a>
          </div>
          <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(m.url); toast.success("Enlace copiado"); }}><Copy className="mr-1 h-3.5 w-3.5" /> Copiar enlace</Button>
          <Button size="icon" variant="ghost" className="text-destructive" onClick={() => void onDelete(m.id)} aria-label="Eliminar"><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      {materials.length === 0 && <p className="text-sm text-muted-foreground">Sin materiales todavía.</p>}
    </div>
  );
}
