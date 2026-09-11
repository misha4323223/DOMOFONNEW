import { useCallback, useEffect, useState } from "react";
import { Loader2, Quote, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewsContent } from "@shared/content";

/** Отзыв из API (сервер хранит в YDB, на сайте только опубликованные). */
export interface SiteReview {
  id: string;
  name: string;
  /** Оценка от 1 до 5 (строка из БД). */
  rating: string;
  text: string;
  /** Ответ службы на отзыв; пусто — ответа нет. */
  reply?: string;
  createdAt: string;
}

/** Ряд звёзд: rating — число 1..5. */
function Stars({
  rating,
  className,
  size = "h-4 w-4",
}: {
  rating: number;
  className?: string;
  size?: string;
}) {
  const value = Math.max(0, Math.min(5, rating));
  const full = Math.round(value);
  return (
    <div
      className={`flex items-center gap-0.5 ${className ?? ""}`}
      role="img"
      aria-label={`Оценка ${value.toFixed(1)} из 5`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          aria-hidden
          className={`${size} ${
            i < full ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

/** Выбор оценки в форме: звёзды, по которым кликают. */
function StarPicker({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium leading-snug">{label}</Label>
      <div
        className="flex items-center gap-1"
        role="radiogroup"
        aria-label={label}
      >
        {Array.from({ length: 5 }).map((_, i) => {
          const star = i + 1;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={value === star}
              aria-label={`${star} из 5`}
              className="p-0.5 -m-0.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onChange(star)}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
            >
              <Star
                className={`h-7 w-7 transition-colors ${
                  star <= shown
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground/30"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Reviews({ content }: { content: ReviewsContent }) {
  const [reviews, setReviews] = useState<SiteReview[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Форма отзыва
  const [name, setName] = useState("");
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reviews", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReviews((await res.json()) as SiteReview[]);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const published = reviews ?? [];
  const average = published.length
    ? published.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) /
      published.length
    : 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rating: String(rating), text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(data?.message ?? "Не удалось отправить отзыв");
      }
      setSubmitted(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось отправить отзыв");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="py-20 bg-background" id="reviews">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold" data-testid="text-reviews-title">
            {content.title}
          </h2>
        </div>

        {/* Сводка рейтинга из реальных опубликованных отзывов */}
        {published.length > 0 && (
          <div className="flex items-center justify-center gap-4 mb-12">
            <span className="text-5xl font-bold leading-none">
              {average.toFixed(1)}
            </span>
            <div className="text-left">
              <Stars rating={average} size="h-5 w-5" />
              <p className="text-sm text-muted-foreground mt-1">
                на основе {published.length}{" "}
                {pluralReviews(published.length)}
              </p>
            </div>
          </div>
        )}

        {loadError && (
          <p className="text-center text-sm text-muted-foreground mb-10">
            Не удалось загрузить отзывы — попробуйте обновить страницу.
          </p>
        )}

        {/* Карточки отзывов */}
        {published.length > 0 && (
          <div className="grid md:grid-cols-2 gap-6 mb-14">
            {published.slice(0, 6).map((review) => (
              <Card
                key={review.id}
                className="hover-elevate transition-all duration-300"
                data-testid={`card-review-${review.id}`}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <Stars rating={Number(review.rating) || 0} />
                    <Quote className="h-6 w-6 text-primary/30 shrink-0" aria-hidden />
                  </div>
                  <p className="text-muted-foreground leading-relaxed mb-4">
                    {review.text}
                  </p>
                  {review.reply?.trim() ? (
                    <div className="mb-4 rounded-md border-l-2 border-primary/40 bg-muted/50 px-3 py-2">
                      <p className="text-xs font-semibold text-primary mb-0.5">
                        Ответ службы
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {review.reply}
                      </p>
                    </div>
                  ) : null}
                  <p className="font-semibold">{review.name}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Форма «Оставить отзыв» */}
        <div className="max-w-xl mx-auto">
          <Card className="border-primary/20">
            <CardContent className="pt-6">
              {submitted ? (
                <div className="text-center py-6">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                    <Star className="h-6 w-6 fill-emerald-500 text-emerald-500" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{content.successTitle}</h3>
                  <p className="text-muted-foreground">{content.successText}</p>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <h3 className="text-xl font-bold">{content.formTitle}</h3>
                  <StarPicker
                    value={rating}
                    onChange={setRating}
                    label={content.ratingLabel}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="review-name" className="text-sm font-medium">
                      Имя
                    </Label>
                    <Input
                      id="review-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={content.namePlaceholder}
                      required
                      maxLength={60}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="review-text" className="text-sm font-medium">
                      Отзыв
                    </Label>
                    <Textarea
                      id="review-text"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={content.textPlaceholder}
                      required
                      maxLength={2000}
                      rows={4}
                      className="resize-y"
                    />
                  </div>
                  {formError && (
                    <p className="text-sm text-destructive">{formError}</p>
                  )}
                  <Button
                    type="submit"
                    className="w-full sm:w-auto"
                    disabled={submitting}
                  >
                    {submitting && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {submitting ? content.submittingLabel : content.submitLabel}
                  </Button>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    {content.moderationNote}
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function pluralReviews(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "отзыв";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "отзыва";
  return "отзывов";
}