import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { Eye, EyeOff, Sun } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/crm/ThemeToggle";
import { toast } from "sonner";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined)
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  if (!session) return <AuthScreen />;
  return <>{children}</>;
}

function AuthScreen() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const { error, data } =
        mode === "in"
          ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
          : await supabase.auth.signUp({
              email: email.trim(),
              password,
              options: { emailRedirectTo: window.location.origin },
            });
      if (error) {
        toast.error("No se pudo iniciar sesión. Revisa tu correo y contraseña.");
        return;
      }
      if (mode === "up" && !data.session)
        toast.success("Revisa tu correo para confirmar la cuenta.");
    } catch {
      toast.error("No se pudo completar la solicitud. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) {
      toast.error("Escribe tu correo para enviarte el enlace.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) {
        toast.error("No se pudo enviar el enlace. Verifica el correo e intenta de nuevo.");
        return;
      }
      toast.success("Si el correo tiene una cuenta, recibirás un enlace para cambiar la contraseña.");
    } catch {
      toast.error("No se pudo enviar el enlace. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = async () => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) toast.error("No se pudo continuar con Google. Intenta de nuevo.");
    } catch {
      toast.error("No se pudo continuar con Google. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm sm:p-7">
        <div className="mb-6">
          <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft">
            <Sun className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold">Pulse</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "in" ? "Inicia sesión para entrar a tu equipo." : "Crea tu cuenta de asesor."}
          </p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="auth-email" className="text-sm font-medium">Correo electrónico</label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              placeholder="correo@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="auth-password" className="text-sm font-medium">Contraseña</label>
            <div className="relative">
              <Input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                required
                minLength={6}
                placeholder="Escribe tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                className="pr-11"
              />
              <button
                type="button"
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={busy}
                className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {mode === "in" && (
            <div className="text-right">
              <button
                type="button"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
                onClick={() => void resetPassword()}
                disabled={busy}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          )}
          <Button className="w-full" disabled={busy}>
            {busy ? "Procesando…" : mode === "in" ? "Entrar" : "Crear cuenta"}
          </Button>
        </form>
        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>o</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void googleSignIn()}
          disabled={busy}
        >
          Continuar con Google
        </Button>
        <button
          type="button"
          className="mt-5 w-full text-center text-sm text-primary hover:underline"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          disabled={busy}
        >
          {mode === "in" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </div>
    </div>
  );
}
