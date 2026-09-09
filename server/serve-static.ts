import express, { type Express, type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import path from "path";
import { renderIndexHtml } from "./seo";

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const indexPath = path.resolve(distPath, "index.html");
  let indexHtml: string | null = null;

  /**
   * Сайт — SPA: без этой обработки поисковые роботы получали бы пустую
   * оболочку (весь текст рисует JavaScript). Здесь отдаём HTML с
   * SEO-пререндером — текстом сайта, вставленным на сервере.
   * Отдаём пререндер для всех путей без расширения (страницы, якоря),
   * файлы с точкой (assets и т.п.) — обычной статикой ниже.
   */
  const serveIndex = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (!indexHtml) {
        indexHtml = fs.readFileSync(indexPath, "utf8");
      }
      const html = await renderIndexHtml(indexHtml);
      res.type("html").send(html);
    } catch (err) {
      next(err);
    }
  };

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();
    const pathname = req.path;
    // Файлы (с расширением в последнем сегменте) отдаём статикой ниже.
    if (pathname.split("/").pop()?.includes(".")) return next();
    return serveIndex(req, res, next);
  });

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", serveIndex);
}