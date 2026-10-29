import { useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCrm } from "@/lib/crm/store";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

const WA_LABEL: Record<string, string> = {
  enviado: "también por WhatsApp",
  fallido: "WhatsApp no entregado",
  sin_numero: "sin número de WhatsApp",
};

/** Avisos internos de los flujos («Avisar al equipo») para quien tiene la sesión. */
export function NotificationBell() {
  const { notifications, accounts, account, setAccount, markNotificationsRead } = useCrm();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const unread = notifications.filter((n) => !n.readAt);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative ml-auto h-9 w-9"
          aria-label={unread.length ? `Avisos (${unread.length} sin leer)` : "Avisos"}
        >
          <Bell className="h-4 w-4" />
          {unread.length > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Avisos</span>
          {unread.length > 0 && (
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => void markNotificationsRead(unread.map((n) => n.id))}
            >
              Marcar todo como leído
            </button>
          )}
        </div>
        <ul className="max-h-[60vh] overflow-y-auto">
          {notifications.length === 0 && (
            <li className="p-4 text-center text-xs text-muted-foreground">Sin avisos</li>
          )}
          {notifications.map((n) => (
            <li key={n.id} className={`border-b last:border-0 ${n.readAt ? "" : "bg-primary/5"}`}>
              <button
                className="w-full px-3 py-2 text-left hover:bg-accent"
                onClick={() => {
                  void markNotificationsRead([n.id]);
                  setOpen(false);
                  if (n.accountId !== account.id) setAccount(n.accountId);
                  if (n.leadId) void navigate({ to: "/inbox", search: { lead: n.leadId } });
                }}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">{n.title}</span>
                  <span className="ml-auto text-muted-foreground" suppressHydrationWarning>
                    {new Date(n.createdAt).toLocaleString("es-MX", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">
                  {n.body}
                </p>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {accounts.length > 1 && (accounts.find((a) => a.id === n.accountId)?.name ?? "")}
                  {n.waStatus && WA_LABEL[n.waStatus] ? ` · ${WA_LABEL[n.waStatus]}` : ""}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
