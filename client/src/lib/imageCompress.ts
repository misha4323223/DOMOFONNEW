/**
 * Сжатие загружаемого фото в webp — одно на все редакторы админки.
 *
 * У записи в YDB лимит ~400 КБ, поэтому фото уменьшается до ~1920 px по
 * большей стороне и, если этого мало, постепенно снижается качество, а затем
 * и размер. Результат возвращается как data-url — в таком виде его принимает
 * сервер (/api/admin/content/image, /api/admin/pages/image).
 */

/** Целевой размер data-url: держим запас до лимита записи YDB (~400 КБ). */
export const MAX_IMAGE_LENGTH = 370_000;

async function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };
    image.src = url;
  });
}

/** Фото из файла → data-url webp не больше MAX_IMAGE_LENGTH символов. */
export async function compressToWebpDataUrl(file: File): Promise<string> {
  const source = await fileToImage(file);
  const maxSide = 1920;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  let width = Math.max(1, Math.round(source.width * scale));
  let height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Браузер не поддерживает сжатие фото");

  let dataUrl = "";
  // Крутим цикл: сначала снижаем качество webp, затем уменьшаем само фото.
  outer: for (let attempt = 0; attempt < 20; attempt++) {
    canvas.width = width;
    canvas.height = height;
    context.drawImage(source, 0, 0, width, height);
    for (let quality = 0.85; quality >= 0.4; quality -= 0.12) {
      dataUrl = canvas.toDataURL("image/webp", quality);
      if (dataUrl.length <= MAX_IMAGE_LENGTH) break outer;
    }
    width = Math.max(1, Math.round(width * 0.8));
    height = Math.max(1, Math.round(height * 0.8));
  }
  if (!dataUrl) throw new Error("Не удалось сжать фото");
  return dataUrl;
}
