import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { CalendarDays, FlaskConical, KanbanSquare, MessageCircle, RotateCcw } from "lucide-react";
import { useCrm } from "@/lib/crm/store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/", label: "Pipeline", icon: KanbanSquare },
  { to: "/inbox", label: "Bandeja", icon: MessageCircle },
  { to: "/simulador", label: "Simulador", icon: FlaskConical },
  { to: "/citas", label: "Citas", icon: CalendarDays },
] as const;

export function BrandMark({ initials, size = 36 }: { initials: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg bg-primary font-display font-bold text-primary-foreground"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { accounts, account, setAccount, resetDemo } = useCrm();
  const brandVars = {
    "--primary": account.brand,
    "--ring": account.brand,
    "--primary-foreground": account.brandForeground,
  } as CSSProperties;

  return (
    <div style={brandVars} className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur">
        <div className="flex h-16 items-center gap-4 px-4 lg:px-6">
          <Select value={account.id} onValueChange={setAccount}>
            <SelectTrigger className="h-11 w-64 border-0 bg-transparent px-1 shadow-none focus:ring-0" aria-label="Subcuenta">
              <div className="flex items-center gap-3 text-left">
                <BrandMark initials={account.initials} />
                <div className="leading-tight">
                  <div className="font-display text-sm font-semibold">{account.name}</div>
                  <div className="text-xs text-muted-foreground">{account.tagline}</div>
                </div>
              </div>
              <SelectValue className="sr-only" />
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

          <nav className="ml-2 flex items-center gap-1 overflow-x-auto">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                activeProps={{ className: "bg-primary/10 !text-primary" }}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>

          <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={resetDemo}>
            <RotateCcw className="mr-1 h-4 w-4" /> Restaurar demo
          </Button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
      #{tag}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 text-muted-foreground hover:text-destructive" aria-label={`Quitar ${tag}`}>
          ×
        </button>
      )}
    </span>
  );
}
