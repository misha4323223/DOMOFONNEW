import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, PhoneCall, Send, CheckCircle2 } from "lucide-react";
import { useState } from "react";

const requestSchema = z.object({
  name: z.string().min(2, "Укажите имя"),
  phone: z
    .string()
    .min(10, "Укажите корректный номер телефона")
    .regex(/^[+\d][\d\s\-()]{9,}$/, "Номер телефона выглядит неверно"),
  service: z.string().min(1, "Выберите тип заявки"),
  address: z.string().min(5, "Укажите адрес: город, улица, дом, квартира"),
  comment: z.string().optional(),
});

type RequestValues = z.infer<typeof requestSchema>;

export function RequestForm() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      name: "",
      phone: "",
      service: "",
      address: "",
      comment: "",
    },
  });

  const onSubmit = async (values: RequestValues) => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/leads", values);
      setSubmitted(true);
      toast({
        title: "Заявка отправлена!",
        description: "Перезвоним в рабочее время: будни с 10:00 до 16:00.",
        variant: "default",
      });
      form.reset();
      window.setTimeout(() => setSubmitted(false), 4000);
    } catch (err) {
      toast({
        title: "Не получилось отправить",
        description: err instanceof Error ? err.message : "Попробуйте ещё раз",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="py-20 bg-background relative overflow-hidden" id="request-form">
      {/* декоративные пятна света */}
      <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-72 w-[42rem] rounded-full bg-primary/10 blur-3xl" />
      <div className="max-w-4xl mx-auto px-6 relative">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-4" data-testid="text-form-title">
            Заявка на обслуживание
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto" data-testid="text-form-subtitle">
            Заполните форму — и мы вам перезвоним. Отвечаем в рабочие дни, с 10:00 до 16:00. Заявки, оставленные после 16:00, обработаем на следующий день.
          </p>
        </div>

        <Card className="overflow-hidden shadow-xl shadow-primary/5 border-border/60">
          <CardContent className="p-6 md:p-10">
            {submitted ? (
              <div className="py-16 text-center">
                <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-6" />
                <h3 className="text-2xl font-bold mb-2">Спасибо, заявка принята!</h3>
                <p className="text-muted-foreground">
                  Мы уже получили её и перезвоним в рабочее время: будни с 10:00 до 16:00.
                </p>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Ваше имя</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Иван"
                              className="h-12"
                              autoComplete="name"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Телефон</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <PhoneCall className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                              <Input
                                placeholder="+7 (___) ___-__-__"
                                className="h-12 pl-11"
                                autoComplete="tel"
                                inputMode="tel"
                                {...field}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="service"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Тип заявки</FormLabel>
                          <FormControl>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger className="h-12">
                                <SelectValue placeholder="Выберите услугу" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="install">Установка домофона</SelectItem>
                                <SelectItem value="repair">Ремонт / не работает</SelectItem>
                                <SelectItem value="maintenance">Обслуживание</SelectItem>
                                <SelectItem value="consult">Консультация</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Адрес</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="г. Город, ул. Название, д. 1, кв. 1"
                              className="h-12"
                              autoComplete="street-address"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="comment"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Комментарий (необязательно)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Опишите проблему или пожелания — так мы приедем подготовленными"
                            className="min-h-28 resize-y"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                    <p className="text-sm text-muted-foreground">
                      Или позвоните напрямую:{" "}
                      <a href="tel:+7XXXXXXXXXX" className="font-medium text-primary hover:underline">
                        +7 (XXX) XXX-XX-XX
                      </a>
                    </p>
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full sm:w-auto text-base px-8 py-6 h-auto"
                      disabled={isSubmitting}
                      data-testid="button-request-submit"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Отправляем…
                        </>
                      ) : (
                        <>
                          <Send className="mr-2 h-5 w-5" />
                          Отправить заявку
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}