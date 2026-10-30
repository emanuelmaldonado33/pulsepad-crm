import { Link, useLocation } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { NewAccountDialog } from "./NewAccountDialog";
import { NotificationBell } from "./NotificationBell";
import {
  CalendarDays,
  FlaskConical,
  KanbanSquare,
  LogOut,
  MessageCircle,
  Plus,
  MoreHorizontal,
  Settings2,
  Workflow,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCrm } from "@/lib/crm/store";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PRIMARY_NAV = [
  { to: "/", label: "Clientes", icon: KanbanSquare },
  { to: "/inbox", label: "Mensajes", icon: MessageCircle },
  { to: "/citas", label: "Agenda", icon: CalendarDays },
] as const;

const MORE_NAV = [
  { to: "/simulador", label: "Probar el bot", icon: FlaskConical },
  { to: "/flujos", label: "Seguimientos", icon: Workflow },
  { to: "/configuracion", label: "Configuración", icon: Settings2 },
] as const;

export function BrandMark({ initials, size = 36 }: { initials: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-[28%] bg-primary font-display font-semibold tracking-tight text-primary-foreground shadow-soft ring-1 ring-hairline"
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
      <header className="liquid-glass sticky top-0 z-30 !rounded-none !border-x-0 !border-t-0">
        <div className="flex h-14 items-center gap-2 px-3 sm:h-16 sm:gap-4 sm:px-4 lg:px-6">
          <Select value={account.id} onValueChange={setAccount}>
            <SelectTrigger
              className="press h-10 w-[min(54vw,15rem)] rounded-xl border-0 bg-transparent px-1.5 shadow-none hover:bg-accent focus:ring-0 sm:h-11 sm:w-64"
              aria-label="Subcuenta"
            >
              <div className="flex min-w-0 items-center gap-3 text-left">
                <BrandMark initials={account.initials} size={32} />
                <div className="min-w-0 leading-tight">
                  <div className="truncate font-display text-sm font-semibold tracking-tight">
                    {account.name}
                  </div>
                  <div className="hidden text-xs text-muted-foreground sm:block">
                    {account.tagline}
                  </div>
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
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={() => setNewOpen(true)}
            aria-label="Nueva subcuenta"
            title="Nueva subcuenta"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <NewAccountDialog open={newOpen} onOpenChange={setNewOpen} />

          <nav
            ref={navRef}
            aria-label="Navegación principal"
            className="relative ml-2 hidden items-center gap-0.5 rounded-full bg-muted p-[3px] ring-1 ring-hairline md:flex"
          >
            {pill && (
              <span
                aria-hidden
                className="absolute top-[3px] bottom-[3px] rounded-full bg-popover shadow-soft ring-1 ring-hairline transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                style={{ left: pill.left, width: pill.width }}
              />
            )}
            {PRIMARY_NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="press relative z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-300 hover:text-foreground"
                activeProps={{ className: "!text-foreground" }}
              >
                <Icon className="h-4 w-4 [[data-status=active]_&]:text-primary" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

          <div className="hidden md:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={
                    MORE_NAV.some((item) => pathname.startsWith(item.to)) ? "secondary" : "ghost"
                  }
                  size="sm"
                  aria-label="Más secciones"
                >
                  <MoreHorizontal className="mr-1 h-4 w-4" /> Más
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {MORE_NAV.map(({ to, label, icon: Icon }) => (
                  <DropdownMenuItem key={to} asChild>
                    <Link to={to} className="flex items-center gap-2">
                      <Icon className="h-4 w-4" /> {label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <span aria-hidden className="ml-auto" />
          <NotificationBell />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-muted-foreground md:w-auto md:px-3"
            onClick={() => supabase.auth.signOut()}
            aria-label="Salir"
            title="Salir"
          >
            <LogOut className="h-4 w-4 md:mr-1" />
            <span className="hidden md:inline">Salir</span>
          </Button>
        </div>
      </header>
      <nav
        aria-label="Navegación móvil"
        className="liquid-glass fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-40 grid grid-cols-4 gap-1 rounded-[30px] p-1.5 md:hidden"
      >
        {PRIMARY_NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-[24px] px-1 text-xs font-semibold text-muted-foreground transition-colors duration-300"
            activeProps={{ className: "!text-primary bg-primary/12" }}
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </Link>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Más secciones"
              className={`flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-[24px] px-1 text-xs font-semibold ${MORE_NAV.some((item) => pathname.startsWith(item.to)) ? "bg-primary/12 text-primary" : "text-muted-foreground"}`}
            >
              <MoreHorizontal className="h-5 w-5" />
              <span>Más</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="mb-2 w-56">
            {MORE_NAV.map(({ to, label, icon: Icon }) => (
              <DropdownMenuItem key={to} asChild>
                <Link to={to} className="flex items-center gap-2">
                  <Icon className="h-4 w-4" /> {label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <main className="flex min-h-0 flex-1 flex-col pb-28 md:pb-0">
        {loading ? (
          <div className="p-8 text-sm text-muted-foreground">Cargando datos…</div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground ring-1 ring-hairline transition-colors">
      #{tag}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 text-muted-foreground hover:text-destructive"
          aria-label={`Quitar ${tag}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
