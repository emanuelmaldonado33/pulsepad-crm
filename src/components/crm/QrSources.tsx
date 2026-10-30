import { useEffect, useMemo, useState } from "react";
import { Copy, Download, QrCode, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { money, useCrm } from "@/lib/crm/store";
import type { QrSource } from "@/lib/crm/types";
import { qrLink, qrPng } from "@/lib/crm/qr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "__none__";

/** Lonas y QR: cada QR abre WhatsApp con un código y el lead llega con su origen y vendedor. */
export function QrSources() {
  const {
    account,
    updateAccount,
    members,
    me,
    leads,
    qrSources,
    addQrSource,
    updateQrSource,
    deleteQrSource,
  } = useCrm();
  const isAdmin = members.some(
    (m) => m.userId === me && (m.role === "owner" || m.role === "admin"),
  );
  const [phone, setPhone] = useState(account.publicWhatsapp ?? "");
  const [name, setName] = useState("");
  const [seller, setSeller] = useState(NONE);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPhone(account.publicWhatsapp ?? ""), [account.publicWhatsapp]);

  const digits = phone.replace(/\D/g, "");
  const savedPhone = account.publicWhatsapp ?? "";
  const phoneOk = digits.length >= 11 && digits.length <= 15;

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await addQrSource(name, seller === NONE ? null : seller);
    setBusy(false);
    if (ok) {
      setName("");
      setSeller(NONE);
      toast.success("QR creado. Ya lo puedes descargar para imprimir.");
    }
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <QrCode className="h-5 w-5 text-primary" /> Lonas y QR
        </h2>
        <p className="text-sm text-muted-foreground">
          Imprime un QR distinto en cada lona, volante o tarjeta de vendedor. Cuando alguien lo
          escanea y escribe, Pulse anota de dónde llegó y se lo pasa al vendedor que elijas.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-60 flex-1 space-y-1">
            <span className="text-sm font-medium">Número de WhatsApp del negocio</span>
            <Input
              value={phone}
              disabled={!isAdmin}
              inputMode="tel"
              placeholder="52 33 1234 5678"
              onChange={(e) => setPhone(e.target.value)}
            />
            <span className="block text-xs text-muted-foreground">
              Con lada del país (52 para México). Es el número al que llegan los mensajes.
            </span>
          </label>
          <Button
            disabled={!isAdmin || !phoneOk || digits === savedPhone}
            onClick={() => void updateAccount(account.id, { publicWhatsapp: digits })}
          >
            Guardar número
          </Button>
        </div>
      </section>

      {isAdmin && (
        <section className="space-y-3 rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">Nuevo QR</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-60 flex-1 space-y-1">
              <span className="text-sm font-medium">¿Dónde lo vas a poner?</span>
              <Input
                value={name}
                maxLength={80}
                placeholder="Ej. Lona Av. Vallarta"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void create()}
              />
            </label>
            <label className="min-w-52 space-y-1">
              <span className="text-sm font-medium">¿Quién atiende a esos clientes?</span>
              <Select value={seller} onValueChange={setSeller}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nadie en especial</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button disabled={busy || !name.trim()} onClick={() => void create()}>
              <QrCode /> Crear QR
            </Button>
          </div>
        </section>
      )}

      {qrSources.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay QR. Crea el primero con el nombre de la lona o del vendedor.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {qrSources.map((q) => (
            <QrCard
              key={q.id}
              qr={q}
              phone={savedPhone}
              editable={isAdmin}
              leads={leads.filter((l) => l.qrSourceId === q.id)}
              members={members}
              onChange={(patch) => updateQrSource(q.id, patch)}
              onDelete={() => deleteQrSource(q.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QrCard({
  qr,
  phone,
  editable,
  leads,
  members,
  onChange,
  onDelete,
}: {
  qr: QrSource;
  phone: string;
  editable: boolean;
  leads: ReturnType<typeof useCrm>["leads"];
  members: ReturnType<typeof useCrm>["members"];
  onChange: (patch: Partial<Pick<QrSource, "name" | "assignedTo" | "active">>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const link = phone ? qrLink(phone, qr.code) : "";
  // El PNG se dibuja en el navegador; en el servidor no hay canvas.
  const [png, setPng] = useState("");
  useEffect(() => setPng(link ? qrPng(link, qr.name) : ""), [link, qr.name]);
  const won = useMemo(() => leads.filter((l) => l.outcome === "ganado"), [leads]);
  const value = won.reduce((s, l) => s + (l.budget ?? 0), 0);
  const file = `QR ${qr.name}`.replace(/[^\p{L}\p{N} .-]/gu, "").trim() + ".png";

  return (
    <article
      className={`space-y-3 rounded-2xl border bg-card p-4 ${qr.active ? "" : "opacity-60"}`}
    >
      <div className="flex items-start gap-3">
        {png ? (
          <img
            src={png}
            alt={`QR de ${qr.name}`}
            className="h-28 w-28 shrink-0 rounded-lg border bg-white"
          />
        ) : (
          <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed p-2 text-center text-xs text-muted-foreground">
            Guarda el número del negocio para ver el QR
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="truncate text-base font-semibold">{qr.name}</div>
          <div className="text-sm text-muted-foreground">Código {qr.code}</div>
          <div className="text-sm">
            <b>{leads.length}</b> {leads.length === 1 ? "cliente" : "clientes"} ·{" "}
            <b>{won.length}</b> {won.length === 1 ? "venta" : "ventas"}
            {value > 0 && <> · {money(value)}</>}
          </div>
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Atiende</span>
        <Select
          value={qr.assignedTo ?? NONE}
          disabled={!editable}
          onValueChange={(v) => void onChange({ assignedTo: v === NONE ? null : v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Nadie en especial</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild={!!png} disabled={!png}>
          {png ? (
            <a href={png} download={file}>
              <Download /> Descargar para imprimir
            </a>
          ) : (
            <span>
              <Download /> Descargar para imprimir
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          disabled={!link}
          onClick={() =>
            void navigator.clipboard.writeText(link).then(() => toast.success("Enlace copiado"))
          }
        >
          <Copy /> Copiar enlace
        </Button>
      </div>

      {editable && (
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              aria-label="QR activo"
              checked={qr.active}
              onCheckedChange={(v) => void onChange({ active: v })}
            />
            {qr.active ? "Activo" : "Pausado: los clientes entran sin origen"}
          </label>
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => {
              if (
                window.confirm(
                  `¿Borrar el QR «${qr.name}»? Los clientes que ya llegaron se quedan, pero las lonas impresas dejan de contar.`,
                )
              )
                void onDelete();
            }}
          >
            <Trash2 /> Borrar
          </Button>
        </div>
      )}
    </article>
  );
}
