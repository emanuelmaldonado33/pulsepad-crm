import { Link, useLocation } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { NewAccountDialog } from "./NewAccountDialog";
import { CalendarDays, FlaskConical, KanbanSquare, LogOut, MessageCircle, Plus, Settings2, Workflow } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCrm } from "@/lib/crm/store";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/", label: "Pipeline", icon: KanbanSquare },
  { to: "/inbox", label: "Bandeja", icon: MessageCircle },
  { to: "/simulador", label: "Simulador", icon: FlaskConical },
  { to: "/citas", label: "Citas", icon: CalendarDays },
  { to: "/flujos", label: "Flujos", icon: Workflow },
  { to: "/configuracion", label: "Configuración IA", icon: Settings2 },
] as const;

export function BrandMark({ initials, size = 36 }: { initials: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-[28%] bg-primary font-display font-semibold tracking-tight text-primary-foreground shadow-soft ring-[0.5px] ring-hairline"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { accounts, account, setAccount, loading } = useCrm();
  const [newOpen, setNewOpen] = useState(false);
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>("[data-status=active]");
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [pathname, loading]);
  const brandVars = {
    "--primary": account.brand,
    "--ring": account.brand,
    "--primary-foreground": account.brandForeground,
  } as CSSProperties;

  return (
    <div style={brandVars} className="flex min-h-screen flex-col">
      <header className="glass sticky top-0 z-30 border-x-0 border-t-0">
        <div className="flex h-16 items-center gap-4 px-4 lg:px-6">
          <Select value={account.id} onValueChange={setAccount}>
            <SelectTrigger className="press h-11 w-64 rounded-xl border-0 bg-transparent px-1.5 shadow-none hover:bg-accent focus:ring-0" aria-label="Subcuenta">
              <div className="flex items-center gap-3 text-left">
                <BrandMark initials={account.initials} />
                <div className="leading-tight">
                  <div className="font-display text-[13px] font-semibold tracking-tight">{account.name}</div>
                  <div className="text-[11px] text-muted-foreground">{account.tagline}</div>
                </div>
              </div>
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: a.brand }} />
                    {a.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setNewOpen(true)} aria-label="Nueva subcuenta" title="Nueva subcuenta">
            <Plus className="h-4 w-4" />
          </Button>
          <NewAccountDialog open={newOpen} onOpenChange={setNewOpen} />

          <nav ref={navRef} className="relative ml-2 flex items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-[3px] ring-[0.5px] ring-hairline">
            {pill && <span aria-hidden className="absolute top-[3px] bottom-[3px] rounded-full bg-popover shadow-soft ring-[0.5px] ring-hairline transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ left: pill.left, width: pill.width }} />}
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="press relative z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors duration-300 hover:text-foreground"
                activeProps={{ className: "!text-foreground" }}
              >
                <Icon className="h-4 w-4 [[data-status=active]_&]:text-primary" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>

          <ThemeToggle className="ml-auto" />
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => supabase.auth.signOut()}>
            <LogOut className="mr-1 h-4 w-4" /> Salir
          </Button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{loading ? <div className="p-8 text-sm text-muted-foreground">Cargando datos…</div> : children}</main>
    </div>
  );
}

export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground ring-[0.5px] ring-hairline transition-colors">
      #{tag}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 text-muted-foreground hover:text-destructive" aria-label={`Quitar ${tag}`}>
          ×
        </button>
      )}
    </span>
  );
}
