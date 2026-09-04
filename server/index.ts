import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { log } from "./log";
import { serveStatic } from "./serve-static";

const app = express();
// Лимит 12 МБ нужен эндпоинту /api/admin/scan — туда приходит фото
// блокнота в base64 (внутри эндпоинта уже есть своя проверка размера).
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Главный адрес сайта — https://obzor71.ru (без www). Страницы, открытые по
// www.obzor71.ru, отдаём постоянным редиректом 301 на основной домен, чтобы
// поисковики и посетители всегда видели один адрес. API (/api/*) не трогаем:
// на него ходит установленное мобильное приложение, которому адрес менять нельзя.
app.use((req, res, next) => {
  const host = (req.headers.host ?? "").toLowerCase();
  if (host === "www.obzor71.ru" && !req.path.startsWith("/api")) {
    return res.redirect(301, `https://obzor71.ru${req.originalUrl}`);
  }
  next();
});

(async () => {
  const server = await registerRoutes(app);

  // Важно: НЕ бросаем err повторно — в Express 4 ошибка из error-middleware
  // больше никем не ловится и уронит весь процесс (контейнер → 502).
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Ошибка обработки запроса:", err);
    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    // vite подключаем только в dev: статический импорт сломал бы прод-образ,
    // где vite отсутствует (он в devDependencies)
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
