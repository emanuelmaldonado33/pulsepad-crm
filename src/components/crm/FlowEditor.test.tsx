import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FlowEditor } from "./FlowEditor";
import type { Flow } from "@/lib/crm/flows";

const flow: Flow = {
  id: "f",
  accountId: "a",
  name: "Seguimiento",
  active: true,
  triggerType: "new_lead",
  triggerValue: "",
  triggerConfig: {},
  allowReentry: true,
  steps: [],
  stopOnReply: true,
};

describe("editor de flujos", () => {
  it("agrega una condición con pasos en la rama «No» y la guarda anidada", async () => {
    const onSave = vi.fn(async () => true);
    render(<FlowEditor flow={flow} materials={[]} onClose={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /Condición sí \/ no/ }));
    // La condición por defecto es «¿Respondió?»: con anti-spam activo avisa que no sirve.
    expect(screen.getByText(/nunca llegará a la rama «Sí»/)).toBeTruthy();
    const no = screen.getByText("No").parentElement!;
    fireEvent.change(within(no).getByLabelText("Agregar paso a la rama"), {
      target: { value: "message" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Regla anti-spam" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar flujo" }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = (onSave.mock.calls[0] as unknown as [Flow])[0];
    expect(saved.stopOnReply).toBe(false);
    expect(saved.steps).toHaveLength(1);
    expect(saved.steps[0]).toMatchObject({ type: "condition", yes: [], no: [{ type: "message" }] });
  });

  it("arma un disparador por palabras clave con filtro de etapa y sin reingreso", async () => {
    const onSave = vi.fn(async () => true);
    render(<FlowEditor flow={flow} materials={[]} onClose={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Tipo de disparador"), { target: { value: "keyword" } });
    const save = screen.getByRole("button", { name: "Guardar flujo" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Palabras o frases"), {
      target: { value: "precio, cuánto cuesta," },
    });
    fireEvent.change(screen.getByLabelText("Filtro de etapa"), { target: { value: "2" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = (onSave.mock.calls[0] as unknown as [Flow])[0];
    expect(saved.triggerType).toBe("keyword");
    expect(saved.triggerConfig).toEqual({ keywords: ["precio", "cuánto cuesta"], stage: 2 });
    expect(saved.allowReentry).toBe(false);
  });

  it("la intención se elige con botones y avisa si se deja el reingreso", () => {
    render(<FlowEditor flow={flow} materials={[]} onClose={() => {}} onSave={async () => true} />);
    fireEvent.change(screen.getByLabelText("Tipo de disparador"), { target: { value: "intent" } });
    const btn = screen.getByRole("button", { name: "Pide precio o cotización" });
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/vuelve a empezar cada vez/)).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Permitir reingreso" }));
    expect(screen.getByText(/vuelve a empezar cada vez/)).toBeTruthy();
  });
});
