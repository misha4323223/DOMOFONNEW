import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ContentEditor } from "@/components/ContentEditor";
import { Home, Inbox, LayoutTemplate, Loader2, Lock, LogOut, RefreshCw } from "lucide-react";
import type { Lead, LeadStatus } from "@shared/schema";

const SERVICE_LABELS: Record<string, string> = {
  install: "Установка домофона",
  repair: "Ремонт / не работает",
  maintenance: "Обслуживание",
  consult: "Консультация",
};

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "Новая" },
  { value: "urgent", label: "Срочно" },
  { value: "done", label: "Выполнена" },
];

type AdminTab = "leads" | "site";

function StatusChips({
  lead,
  onPatch,
}: {
  lead: Lead;
  onPatch: (lead: Lead, status: LeadStatus) => void;
}) {
  const current: LeadStatus = lead.status ?? "new";
  const base =
    "rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors";
  const inactive = "text-muted-foreground border-border/70 hover:bg-muted";
  const active: Record<LeadStatus, string> = {
    new: "text-foreground border-border bg-muted-foreground/10",
    urgent: "text-amber-600 dark:text-amber-400 border-amber-500/50 bg-amber-500/15",
    done: "text-emerald-600 dark:text-emerald-400 border-emerald-500/50 bg-emerald-500/15",
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => current !== opt.value && onPatch(lead, opt.value)}
          className={`${base} ${current === opt.value ? active[opt.value] : inactive}`}
          title={`Отметить: ${opt.label}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "заявка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "заявки";
  return "заявок";
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiRequest("POST", "/api/admin/login", { password });
      onSuccess();
    } catch {
      setError("Неверный пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Вход для администратора</CardTitle>
          <CardDescription>
            Введите пароль, чтобы открыть список заявок и редактор сайта
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Input
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="h-12 text-center"
            />
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full h-12"
              disabled={loading || !password}
            >
              {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
              Войти
            </Button>
          </form>
          <p className="mt-6 text-center text-sm">
            <Link
              href="/"
              className="text-muted-foreground hover:text-primary inline-flex items-center gap-1"
            >
              <Home className="h-4 w-4" /> На сайт
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function LeadsBoard() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/leads");
      setLeads((await res.json()) as Lead[]);
      setError("");
    } catch {
      setError("Не удалось загрузить заявки");
    }
  }, []);

  useEffect(() => {
    load();
    // Автообновление каждые 20 секунд, чтобы новые заявки появлялись сами
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  const setStatus = async (lead: Lead, status: LeadStatus) => {
    try {
      await apiRequest("PATCH", `/api/leads/${lead.id}`, { status });
      setLeads((prev) =>
        prev ? prev.map((l) => (l.id === lead.id ? { ...l, status } : l)) : prev,
      );
      setError("");
    } catch {
      setError("Не удалось обновить статус заявки");
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Заявки</h2>
          <p className="text-sm text-muted-foreground">
            {leads ? `${leads.length} ${plural(leads.length)}` : "Загрузка…"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-1.5 h-4 w-4" /> Обновить
        </Button>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error} — проверьте, что вы вошли.
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {leads === null ? (
            <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Загружаем заявки…
            </div>
          ) : leads.length === 0 ? (
            <div className="py-16 text-center">
              <Inbox className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
              <p className="text-muted-foreground">Заявок пока нет</p>
              <p className="mt-1 text-sm text-muted-foreground/70">
                Новые заявки с сайта появятся здесь автоматически
              </p>
            </div>
          ) : (
            <>
              {/* Мобильная версия: карточки вместо таблицы */}
              <div className="md:hidden divide-y divide-border">
                {leads.map((lead) => (
                  <div key={lead.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium">{lead.name}</span>
                      <Badge variant="secondary" className="shrink-0">
                        {SERVICE_LABELS[lead.service] ?? lead.service}
                      </Badge>
                    </div>
                    <StatusChips lead={lead} onPatch={setStatus} />
                    <a
                      href={`tel:${lead.phone}`}
                      className="text-primary hover:underline block"
                    >
                      {lead.phone}
                    </a>
                    <p className="text-sm">{lead.address}</p>
                    {lead.comment && (
                      <p className="text-sm text-muted-foreground">
                        {lead.comment}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDate(lead.createdAt)}
                    </p>
                  </div>
                ))}
              </div>

              {/* Десктопная версия: таблица с горизонтальным скроллом на всякий случай */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Имя</TableHead>
                      <TableHead>Телефон</TableHead>
                      <TableHead>Услуга</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Адрес</TableHead>
                      <TableHead>Комментарий</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(lead.createdAt)}
                        </TableCell>
                        <TableCell className="font-medium">
                          {lead.name}
                        </TableCell>
                        <TableCell>
                          <a
                            href={`tel:${lead.phone}`}
                            className="text-primary hover:underline whitespace-nowrap"
                          >
                            {lead.phone}
                          </a>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {SERVICE_LABELS[lead.service] ?? lead.service}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <StatusChips lead={lead} onPatch={setStatus} />
                        </TableCell>
                        <TableCell
                          className="max-w-[220px] truncate"
                          title={lead.address}
                        >
                          {lead.address}
                        </TableCell>
                        <TableCell className="max-w-[240px] text-muted-foreground">
                          {lead.comment || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function AdminWorkspace() {
  const [tab, setTab] = useState<AdminTab>(
    () => (localStorage.getItem("admin-tab") === "site" ? "site" : "leads"),
  );

  const switchTab = (next: AdminTab) => {
    setTab(next);
    localStorage.setItem("admin-tab", next);
  };

  const logout = async () => {
    try {
      await apiRequest("POST", "/api/admin/logout");
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex items-center justify-between gap-4 h-16">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Inbox className="h-5 w-5 text-primary" />
              </div>
              <div className="leading-tight">
                <h1 className="font-bold leading-tight">Админка</h1>
                <p className="text-xs text-muted-foreground">
                  Обзор71 · домофонная служба
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <TabButton
                active={tab === "leads"}
                onClick={() => switchTab("leads")}
                icon={<Inbox className="h-4 w-4" />}
              >
                Заявки
              </TabButton>
              <TabButton
                active={tab === "site"}
                onClick={() => switchTab("site")}
                icon={<LayoutTemplate className="h-4 w-4" />}
              >
                Сайт
              </TabButton>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <Home className="h-4 w-4" />
                <span className="hidden sm:inline">На сайт</span>
              </Link>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="mr-1.5 h-4 w-4" /> Выйти
              </Button>
            </div>
          </div>
        </div>
      </header>

      {tab === "leads" ? <LeadsBoard /> : <ContentEditor />}
    </div>
  );
}

export default function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/me", { credentials: "include" });
        const data = (await res.json()) as { authed: boolean };
        if (!cancelled) setAuthed(data.authed);
      } catch {
        if (!cancelled) setAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Проверяем доступ…
      </div>
    );
  }

  return authed ? <AdminWorkspace /> : <LoginForm onSuccess={() => setAuthed(true)} />;
}
