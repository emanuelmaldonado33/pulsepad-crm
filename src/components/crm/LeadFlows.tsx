import { useState } from "react";
import { Play, Workflow, X } from "lucide-react";
import { useCrm } from "@/lib/crm/store";
import { unitLabel } from "@/lib/crm/flows";
import { Button } from "@/components/ui/button";

/** Flujo activo del lead + controles para probarlo. */
export function LeadFlows({ leadId, testMode }: { leadId: string; testMode?: boolean }) {
  const { flows, enrollments, enroll, cancelEnrollment, runEnrollment } = useCrm();
  const [pick, setPick] = useState("");
  const mine = enrollments.filter((e) => e.leadId === leadId);
  const active = mine.filter((e) => e.status === "active");
  const last = mine.find((e) => e.status !== "active");

  return (
    <section className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Workflow className="h-3.5 w-3.5" /> Flujo activo
      </div>
      {active.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Ninguno
          {last
            ? ` · último: «${flows.find((f) => f.id === last.flowId)?.name ?? "flujo"}» ${last.status === "completed" ? "completado" : `cancelado (${last.cancelReason ?? ""})`}`
            : ""}
        </p>
      )}
      {active.map((e) => {
        const f = flows.find((x) => x.id === e.flowId);
        const prev = f?.steps[e.currentStep - 1];
        const waiting =
          prev && (prev.type === "wait" || prev.type === "wait_appt")
            ? unitLabel(prev.amount, prev.unit)
            : null;
        return (
          <div key={e.id} className="mb-2 rounded-lg bg-primary/5 p-2 text-xs">
            <div className="font-semibold text-primary">{f?.name ?? "Flujo"}</div>
            <div className="text-muted-foreground">
              Paso {Math.min(e.currentStep + 1, f?.steps.length ?? 0)} de {f?.steps.length ?? 0}
              {waiting && ` · esperando ${waiting}`} · siguiente:{" "}
              {new Date(e.nextRunAt).toLocaleString("es-MX", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <div className="mt-1.5 flex gap-1">
              {testMode && (
                <Button size="sm" className="h-7" onClick={() => void runEnrollment(e.id, true)}>
                  <Play className="mr-1 h-3 w-3" /> Ejecutar siguiente paso ahora
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => void cancelEnrollment(e.id, "Cancelado manualmente")}
              >
                <X className="mr-1 h-3 w-3" /> Cancelar
              </Button>
            </div>
          </div>
        );
      })}
      {flows.length > 0 && (
        <div className="mt-1 flex gap-1">
          <select
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">Inscribir en flujo…</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.active ? "" : " (inactivo)"}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={!pick}
            onClick={() => {
              void enroll(pick, leadId);
              setPick("");
            }}
          >
            Iniciar
          </Button>
        </div>
      )}
    </section>
  );
}
