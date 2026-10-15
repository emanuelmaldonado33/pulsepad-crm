import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import "@lovable.dev/cloud-auth-js/styles.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Cargando…</div>;
  if (!session) return <AuthScreen />;
  return <>{children}</>;
}

function AuthScreen() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const { error, data } =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (mode === "up" && !data.session) toast.success("Revisa tu correo para confirmar la cuenta.");
  };

  const oauth = async (p: "google" | "lovable") => {
    const r = await lovable.auth.signInWithOAuth(p, { redirect_uri: window.location.origin });
    if (r.error) toast.error(String(r.error.message ?? r.error));
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-7 shadow-sm">
        <h1 className="text-2xl font-semibold">Nexo CRM</h1>
        <p className="mt-1 text-sm text-muted-foreground">{mode === "in" ? "Inicia sesión para entrar a tu equipo." : "Crea tu cuenta de asesor."}</p>
        <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Input type="email" required placeholder="correo@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input type="password" required minLength={6} placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button className="w-full" disabled={busy}>{mode === "in" ? "Entrar" : "Crear cuenta"}</Button>
        </form>
        <div className="my-4 text-center text-xs text-muted-foreground">o</div>
        <div className="space-y-2">
          <Button variant="outline" className="w-full" onClick={() => oauth("google")}>Continuar con Google</Button>
          <button type="button" className="lovable-auth-button w-full" onClick={() => oauth("lovable")}>Continue with Lovable</button>
        </div>
        <button className="mt-5 w-full text-center text-sm text-primary hover:underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </div>
    </div>
  );
}
