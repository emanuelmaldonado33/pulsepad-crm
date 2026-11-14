import { describe, expect, it, vi } from "vitest";
import { withFreshUrls } from "./materials.server";

describe("withFreshUrls", () => {
  it("firma de nuevo por 7 días los archivos subidos y deja los enlaces externos", async () => {
    const createSignedUrl = vi.fn(async (path: string) => ({
      data: { signedUrl: `https://x/${path}?nuevo` },
      error: null,
    }));
    const sb = { storage: { from: () => ({ createSignedUrl }) } };
    const out = await withFreshUrls(sb as never, [
      { url: "https://viejo", storage_path: "acc/precios.pdf" },
      { url: "https://youtu.be/abc", storage_path: null },
    ]);
    expect(out.map((m) => m.url)).toEqual([
      "https://x/acc/precios.pdf?nuevo",
      "https://youtu.be/abc",
    ]);
    expect(createSignedUrl).toHaveBeenCalledWith("acc/precios.pdf", 7 * 86_400);
  });
  it("si Storage falla usa el enlace guardado", async () => {
    const sb = {
      storage: {
        from: () => ({
          createSignedUrl: async () => {
            throw new Error("down");
          },
        }),
      },
    };
    const [m] = await withFreshUrls(sb as never, [{ url: "https://viejo", storage_path: "p" }]);
    expect(m!.url).toBe("https://viejo");
  });
});
