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
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar flujo" }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = (onSave.mock.calls[0] as unknown as [Flow])[0];
    expect(saved.stopOnReply).toBe(false);
    expect(saved.steps).toHaveLength(1);
    expect(saved.steps[0]).toMatchObject({ type: "condition", yes: [], no: [{ type: "message" }] });
  });
});
