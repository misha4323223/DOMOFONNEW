import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Check,
  EyeOff,
  Home,
  Inbox,
  LayoutTemplate,
  Loader2,
  Lock,
  LogOut,
  MessageSquareQuote,
  Navigation,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { SERVICE_LABELS } from "@shared/services";
import type { Lead, LeadStatus } from "@shared/schema";

/** Отзыв клиента — модель из API (совпадает с server/ydb.ts). */
interface SiteReview {
  id: string;
  name: string;
  city: string;
  rating: string;
  text: string;
  status: "new" | "published" | "hidden";
  /** Ответ службы на отзыв; пусто — ответа нет. */
  reply: string;
  createdAt: string;
}

/** Города, в которых служба работает постоянно. */
const SERVICE_CITIES = ["Богородицк", "Щёкино", "Ефремов"];

/** Регион обслуживания — подставляется, если города в заявке нет. */
const SERVICE_REGION = "Тульская область";

/** Найти известный город внутри строки адреса («в Щёкине, ул. …»). */
function findCity(text: string): string | null {
  const haystack = text.toLowerCase().replace(/ё/g, "е");
  for (const city of SERVICE_CITIES) {
    const root = city.toLowerCase().replace(/ё/g, "е").slice(0, Math.max(4, city.length - 1));
    if (haystack.includes(root)) return city;
  }
  return null;
}

/**
 * Ссылка на Яндекс Карты с готовым маршрутом до адреса заявки (от текущего
 * местоположения — открывается навигатор, можно сразу ехать).
 *
 * Город берём из имени (у заявок, добавленных вручную, там лежит город) или
 * из самого адреса. Если города нет совсем — ограничиваем поиск регионом,
 * иначе карты могут увести в одноимённую улицу другого города.
 */
function mapsRouteUrl(lead: Lead): string {
  const address = lead.address.trim();
  const city =
    (lead.source === "admin" ? findCity(lead.name) : null) ?? findCity(address);
  const query = city ? address : `${address}, ${SERVICE_REGION}`;
  return `https://yandex.ru/maps/?rtext=~${encodeURIComponent(query)}&rtt=auto`;
}

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "Новая" },
  { value: "urgent", label: "Срочно" },
  { value: "done", label: "Выполнена" },
];

type AdminTab = "leads" | "reviews" | "site";

/** Бейдж источника заявки: «Вручную» — добавил админ, иначе «С сайта». */
function SourceBadge({ source }: { source?: string }) {
  if (source === "admin") {
    return (
      <Badge className="shrink-0 border-violet-500/40 bg-violet-500/15 text-violet-600 dark:text-violet-400">
        ✍️ Вручную
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="shrink-0">
      С сайта
    </Badge>
  );
}

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

  // Активные заявки — без ушедших в архив (архивируются из мобильного приложения)
  const activeLeads = (leads ?? []).filter((l) => l.archived !== "1");

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
            {leads
              ? `${activeLeads.length} ${plural(activeLeads.length)}`
              : "Загрузка…"}
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
          ) : activeLeads.length === 0 ? (
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
                {activeLeads.map((lead) => (
                  <div key={lead.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium">{lead.name}</span>
                      <SourceBadge source={lead.source} />
                    </div>
                    <div className="flex items-start justify-between gap-3">
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
                    {lead.address ? (
                      <a
                        href={mapsRouteUrl(lead)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm flex items-start gap-1.5 text-primary hover:underline"
                        title={`Маршрут: ${lead.address}`}
                      >
                        <Navigation className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        {lead.address}
                      </a>
                    ) : (
                      <p className="text-sm">{lead.address}</p>
                    )}
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
                      <TableHead>Имя / Город</TableHead>
                      <TableHead>Телефон</TableHead>
                      <TableHead>Услуга</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Адрес</TableHead>
                      <TableHead>Комментарий</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeLeads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(lead.createdAt)}
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {lead.name}
                            <SourceBadge source={lead.source} />
                          </div>
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
                        <TableCell className="max-w-[220px]">
                          {lead.address ? (
                            <a
                              href={mapsRouteUrl(lead)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline flex items-center gap-1.5"
                              title={`Маршрут: ${lead.address}`}
                            >
                              <Navigation className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{lead.address}</span>
                            </a>
                          ) : null}
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

function ReviewStars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Оценка ${rating} из 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/25"
          }`}
        />
      ))}
    </span>
  );
}

const REVIEW_STATUS_LABELS: Record<SiteReview["status"], string> = {
  new: "На модерации",
  published: "Опубликован",
  hidden: "Скрыт",
};

function ReviewsBoard() {
  const [reviews, setReviews] = useState<SiteReview[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Карточка, в которой сейчас открыта форма ответа (id) и черновик текста
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [savingReply, setSavingReply] = useState(false);
  // Развёрнутые отзывы (по умолчанию текст показываем компактно)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const openReply = (review: SiteReview) => {
    setReplyFor(review.id);
    setReplyDraft(review.reply ?? "");
  };

  /** Сохранить ответ службы на отзыв (поддерживает и очистку ответа). */
  const saveReply = async (review: SiteReview, value: string) => {
    if (savingReply) return;
    const reply = value.trim();
    setSavingReply(true);
    try {
      await apiRequest("PATCH", `/api/admin/reviews/${review.id}`, { reply });
      setReviews((prev) =>
        prev ? prev.map((r) => (r.id === review.id ? { ...r, reply } : r)) : prev,
      );
      setReplyFor(null);
      setReplyDraft("");
      setError("");
    } catch {
      setError("Не удалось сохранить ответ на отзыв");
    } finally {
      setSavingReply(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/admin/reviews");
      setReviews((await res.json()) as SiteReview[]);
      setError("");
    } catch {
      setError("Не удалось загрузить отзывы");
    }
  }, []);

  useEffect(() => {
    load();
    // Автообновление, чтобы новые отзывы с сайта появлялись сами
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  const setStatus = async (review: SiteReview, status: SiteReview["status"]) => {
    if (busyId) return;
    setBusyId(review.id);
    try {
      await apiRequest("PATCH", `/api/admin/reviews/${review.id}`, { status });
      setReviews((prev) =>
        prev ? prev.map((r) => (r.id === review.id ? { ...r, status } : r)) : prev,
      );
      setError("");
    } catch {
      setError("Не удалось обновить статус отзыва");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (review: SiteReview) => {
    if (busyId) return;
    if (!window.confirm("Удалить отзыв безвозвратно?")) return;
    setBusyId(review.id);
    try {
      await apiRequest("DELETE", `/api/admin/reviews/${review.id}`);
      setReviews((prev) => (prev ? prev.filter((r) => r.id !== review.id) : prev));
      setError("");
    } catch {
      setError("Не удалось удалить отзыв");
    } finally {
      setBusyId(null);
    }
  };

  const pending = reviews?.filter((r) => r.status === "new").length ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Отзывы клиентов</h2>
          <p className="text-sm text-muted-foreground">
            {reviews ? `${reviews.length} всего` : "Загрузка…"}
            {pending > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                {pending} ждут проверки
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-1.5 h-4 w-4" /> Обновить
        </Button>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {reviews === null ? (
        <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Загружаем отзывы…
        </div>
      ) : reviews.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <MessageSquareQuote className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground">Отзывов пока нет</p>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Клиенты оставляют их прямо на сайте — в блоке «Отзывы»
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => {
            const isExpanded = Boolean(expanded[review.id]);
            const hasReply = Boolean(review.reply?.trim());
            const replyOpen = replyFor === review.id;
            return (
              <Card key={review.id}>
                <CardContent className="p-4">
                  {/* Всё в одну строку: имя, звёзды, город, дата и действия */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="text-sm font-semibold">{review.name}</span>
                    <ReviewStars rating={Number(review.rating) || 0} />
                    {review.city && (
                      <span className="text-xs text-muted-foreground">{review.city}</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground/70">
                      {formatDate(review.createdAt)}
                    </span>
                    <Badge
                      variant="secondary"
                      className={
                        review.status === "published"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : review.status === "new"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : ""
                      }
                    >
                      {REVIEW_STATUS_LABELS[review.status]}
                    </Badge>
                    {busyId === review.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        {review.status !== "published" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setStatus(review, "published")}
                            title="Опубликовать на сайте"
                          >
                            <Check className="mr-1 h-3.5 w-3.5" />
                            Опубликовать
                          </Button>
                        )}
                        {review.status !== "hidden" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground"
                            onClick={() => setStatus(review, "hidden")}
                            title="Скрыть с сайта"
                          >
                            <EyeOff className="mr-1 h-3.5 w-3.5" />
                            Скрыть
                          </Button>
                        )}
                        <Button
                          variant={hasReply ? "ghost" : "outline"}
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => openReply(review)}
                          title={hasReply ? "Изменить ответ" : "Ответить клиенту"}
                        >
                          <MessageSquareQuote className="mr-1 h-3.5 w-3.5" />
                          {hasReply ? "Изменить ответ" : "Ответить"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive"
                          onClick={() => remove(review)}
                          title="Удалить навсегда"
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Удалить
                        </Button>
                      </>
                    )}
                  </div>

                  <p
                    className={`mt-2 text-sm leading-relaxed text-muted-foreground ${
                      isExpanded ? "" : "line-clamp-3"
                    }`}
                  >
                    {review.text}
                  </p>
                  {review.text.length > 180 && (
                    <button
                      type="button"
                      className="mt-1 text-xs font-semibold text-primary hover:underline"
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [review.id]: !prev[review.id],
                        }))
                      }
                    >
                      {isExpanded ? "Свернуть" : "Читать полностью"}
                    </button>
                  )}

                  {hasReply && !replyOpen && (
                    <div className="mt-2.5 rounded-md border-l-2 border-primary/40 bg-muted/50 px-3 py-2">
                      <p className="mb-0.5 text-[11px] font-semibold text-primary">
                        Ответ службы
                      </p>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {review.reply}
                      </p>
                    </div>
                  )}

                  {replyOpen && (
                    <div className="mt-3 space-y-2">
                      <Textarea
                        value={replyDraft}
                        onChange={(e) => setReplyDraft(e.target.value)}
                        placeholder="Ответ клиенту — он появится под отзывом на сайте"
                        rows={3}
                        maxLength={1000}
                        autoFocus
                        className="text-sm"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          className="h-7 px-3 text-xs"
                          disabled={savingReply}
                          onClick={() => saveReply(review, replyDraft)}
                        >
                          {savingReply ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="mr-1 h-3.5 w-3.5" />
                          )}
                          Сохранить ответ
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setReplyFor(null);
                            setReplyDraft("");
                          }}
                        >
                          Отмена
                        </Button>
                        {hasReply && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive"
                            disabled={savingReply}
                            onClick={() => saveReply(review, "")}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Убрать ответ
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
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
  const [tab, setTab] = useState<AdminTab>(() => {
    const saved = localStorage.getItem("admin-tab");
    return saved === "site" || saved === "reviews" ? saved : "leads";
  });

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
                active={tab === "reviews"}
                onClick={() => switchTab("reviews")}
                icon={<MessageSquareQuote className="h-4 w-4" />}
              >
                Отзывы
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

      {tab === "leads" ? (
        <LeadsBoard />
      ) : tab === "reviews" ? (
        <ReviewsBoard />
      ) : (
        <ContentEditor />
      )}
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
