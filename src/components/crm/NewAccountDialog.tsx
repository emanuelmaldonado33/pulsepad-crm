import { useState } from "react";
import { z } from "zod";
import { useCrm } from "@/lib/crm/store";
import { TEMPLATES, initialsOf, slugify, type TemplateId } from "@/lib/crm/templates";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BrandMark } from "./AppShell";
import { toast } from "sonner";

const COLORS = [
  "oklch(0.52 0.13 160)",
  "oklch(0.58 0.15 45)",
  "oklch(0.5 0.15 255)",
  "oklch(0.45 0.12 300)",
  "oklch(0.55 0.18 25)",
  "oklch(0.6 0.12 200)",
  "oklch(0.3 0.03 260)",
];

const schema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre").max(60),
  initials: z.string().trim().min(1).max(3),
  product: z.string().trim().min(2, "Escribe el producto").max(120),
});

export function NewAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { createAccount } = useCrm();
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [brand, setBrand] = useState(COLORS[2]!);
  const [product, setProduct] = useState("");
  const [tpl, setTpl] = useState<TemplateId>("inmobiliaria");
  const [busy, setBusy] = useState(false);
  const ini = initials || initialsOf(name || "Nueva");

  const submit = async () => {
    const v = schema.safeParse({ name, initials: ini, product });
    if (!v.success) return void toast.error(v.error.issues[0]!.message);
    // Sufijo aleatorio siempre: el navegador sólo ve sus cuentas, así que no puede saber
    // si otra empresa ya usa el mismo nombre.
    const id = `${slugify(v.data.name) || "cuenta"}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const t = TEMPLATES[tpl];
    setBusy(true);
    const ok = await createAccount({
      id,
      name: v.data.name,
      initials: v.data.initials.toUpperCase(),
      tagline: t.label,
      brand,
      brandForeground: "oklch(0.98 0.01 90)",
      product: v.data.product,
      ticketLabel: t.ticketLabel,
      setterPrompt: t.prompt(v.data.name, v.data.product),
      qualificationRules: t.rules,
      aiModel: "openai/gpt-6-astra",
      template: tpl,
      standardTags: t.tags,
    });
    setBusy(false);
    if (ok) {
      toast.success(`Subcuenta «${v.data.name}» creada`);
      onOpenChange(false);
      setName("");
      setInitials("");
      setProduct("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva subcuenta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div
            className="flex items-center gap-3 rounded-xl border p-3"
            style={{ ["--primary" as string]: brand }}
          >
            <BrandMark initials={ini} size={44} />
            <div>
              <div className="font-display font-semibold">{name || "Nombre del cliente"}</div>
              <div className="text-xs text-muted-foreground">{TEMPLATES[tpl].label}</div>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <label className="text-sm">
              Nombre del cliente / desarrollo
              <Input
                className="mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Residencial Las Palmas"
              />
            </label>
            <label className="text-sm">
              Iniciales
              <Input
                className="mt-1"
                maxLength={3}
                value={initials}
                onChange={(e) => setInitials(e.target.value)}
                placeholder={ini}
              />
            </label>
          </div>
          <label className="block text-sm">
            Producto a vender
            <Input
              className="mt-1"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="lotes residenciales con amenidades"
            />
          </label>
          <div className="text-sm">
            Color de marca
            <div className="mt-1 flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setBrand(c)}
                  className={`h-8 w-8 rounded-full border-2 ${brand === c ? "border-foreground" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <div className="text-sm">
            Plantilla base
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(Object.keys(TEMPLATES) as TemplateId[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTpl(k)}
                  className={`rounded-xl border p-3 text-left text-sm ${tpl === k ? "border-primary ring-2 ring-primary/30" : "hover:bg-accent"}`}
                >
                  <div className="font-semibold">{TEMPLATES[k].label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Etapas P0–P7, {TEMPLATES[k].tags.length} etiquetas y prompt de setter calibrado.
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Creando…" : "Crear subcuenta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
