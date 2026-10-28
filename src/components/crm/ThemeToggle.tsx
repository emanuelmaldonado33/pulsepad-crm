import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";
const KEY = "crm-theme";
const OPTIONS: { v: Theme; icon: typeof Sun; label: string }[] = [
  { v: "light", icon: Sun, label: "Claro" },
  { v: "dark", icon: Moon, label: "Oscuro" },
  { v: "system", icon: Monitor, label: "Sistema" },
];

function apply(t: Theme) {
  const dark =
    t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Control segmentado Claro / Oscuro / Sistema con indicador deslizante. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    setTheme((localStorage.getItem(KEY) as Theme) || "system");
  }, []);
  useEffect(() => {
    apply(theme);
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
  const idx = OPTIONS.findIndex((o) => o.v === theme);

  return (
    <div
      role="radiogroup"
      aria-label="Apariencia"
      className={cn(
        "relative flex rounded-full bg-muted p-[3px] ring-[0.5px] ring-hairline",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute top-[3px] bottom-[3px] w-7 rounded-full bg-popover shadow-soft ring-[0.5px] ring-hairline transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ transform: `translateX(${idx * 28}px)` }}
      />
      {OPTIONS.map(({ v, icon: Icon, label }) => (
        <button
          key={v}
          role="radio"
          aria-checked={theme === v}
          aria-label={label}
          title={label}
          onClick={() => {
            localStorage.setItem(KEY, v);
            setTheme(v);
          }}
          className={cn(
            "press relative z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-300",
            theme === v ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
