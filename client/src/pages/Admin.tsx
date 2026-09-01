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
import { Home, Inbox, Loader2, Lock, LogOut, RefreshCw } from "lucide-react";
import type { Lead } from "@shared/schema";

const SERVICE_LABELS: Record<string, string> = {
  install: "Установка домофона",
  repair: "Ремонт / не работает",
  maintenance: "Обслуживание",
  consult: "Консультация",
};

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
          <CardDescription>Введите пароль, чтобы открыть список заявок</CardDescription>
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
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button type="submit" className="w-full h-12" disabled={loading || !password}>
              {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
              Войти
            </Button>
          </form>
          <p className="mt-6 text-center text-sm">
            <Link href="/" className="text-muted-foreground hover:text-primary inline-flex items-center gap-1">
              <Home className="h-4 w-4" /> На сайт
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function LeadsTable() {
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

  const logout = async () => {
    try {
      await apiRequest("POST", "/api/admin/logout");
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Inbox className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Заявки</h1>
              <p className="text-xs text-muted-foreground">
                {leads ? `${leads.length} ${plural(leads.length)}` : "Загрузка…"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="mr-1.5 h-4 w-4" /> Обновить
            </Button>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="mr-1.5 h-4 w-4" /> Выйти
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Имя</TableHead>
                    <TableHead>Телефон</TableHead>
                    <TableHead>Услуга</TableHead>
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
                      <TableCell className="font-medium">{lead.name}</TableCell>
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
                      <TableCell className="max-w-[220px] truncate" title={lead.address}>
                        {lead.address}
                      </TableCell>
                      <TableCell className="max-w-[240px] text-muted-foreground">
                        {lead.comment || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "заявка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "заявки";
  return "заявок";
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

  return authed ? <LeadsTable /> : <LoginForm onSuccess={() => setAuthed(true)} />;
}
