import { openPdf, pageHasText, renderPageJpeg, type PdfDoc } from "./pdf";

export type AiPart =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string }
  | { kind: "image"; base64: string; mediaType: string };

export type SourceDoc = {
  index: number;
  name: string;
  file: File;
  kind: "pdf" | "image" | "other";
  pages: number;
};

const MAX_SINGLE_FILE = 220 * 1024 * 1024;
const NATIVE_PDF_LIMIT = 15 * 1024 * 1024;
const BASE64_BUDGET = 24_000_000;
const MAX_IMAGE_PARTS = 88;
const MAX_PAGES_PER_PDF = 70;

function ext(name: string): string {
  return (name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "").slice(1);
}

export function zipEntryEligible(name: string): boolean {
  if (!name || name.endsWith("/")) return false;
  const parts = name.split("/");
  if (parts.some((p) => p.startsWith(".") || p === "__MACOSX")) return false;
  const e = ext(name);
  return ["pdf", "png", "jpg", "jpeg", "webp", "xlsx", "xls", "csv", "docx", "txt", "md"].includes(e);
}

export async function flattenInputFiles(files: File[]): Promise<{ docs: File[]; skipped: string[] }> {
  const docs: File[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (file.size > MAX_SINGLE_FILE) {
      skipped.push(`${file.name} — больше 220 МБ`);
      continue;
    }
    if (ext(file.name) === "zip") {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const names = Object.keys(zip.files).sort();
      for (const name of names) {
        const entry = zip.files[name];
        if (entry.dir) continue;
        if (!zipEntryEligible(name)) {
          if (ext(name) === "zip") skipped.push(`${name} — вложенный архив, распакуйте отдельно`);
          continue;
        }
        const blob = await entry.async("blob");
        if (blob.size > MAX_SINGLE_FILE) {
          skipped.push(`${name} — больше 220 МБ`);
          continue;
        }
        const short = name.split("/").pop() || name;
        docs.push(new File([blob], short, { type: blob.type }));
      }
    } else {
      docs.push(file);
    }
  }
  return { docs, skipped };
}

async function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (comma === -1) reject(new Error("Не удалось прочитать файл."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.readAsDataURL(file);
  });
}

async function imageToJpegBase64(file: File, maxSide = 1568, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`Не удалось прочитать изображение «${file.name}».`);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось обработать изображение.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Не удалось обработать изображение.");
  return toBase64(blob);
}

async function textParts(file: File, index: number): Promise<AiPart[]> {
  const e = ext(file.name);
  if (["xlsx", "xls", "csv"].includes(e)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
    const chunks: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
      if (csv.trim()) chunks.push(`=== Лист: ${sheetName} ===\n${csv}`);
    }
    const text = chunks.join("\n\n").slice(0, 350000);
    if (!text.trim()) throw new Error(`Файл Excel «${file.name}» пустой.`);
    return [{ kind: "text", text: `=== ФАЙЛ ${index}: «${file.name}» (таблица) ===\n${text}` }];
  }
  if (e === "docx") {
    const m: any = await import("mammoth");
    const extract = m.extractRawText ?? m.default?.extractRawText;
    const result = await extract({ arrayBuffer: await file.arrayBuffer() });
    const text = String(result?.value ?? "").slice(0, 350000);
    if (!text.trim()) throw new Error(`Не удалось прочитать текст из «${file.name}».`);
    return [{ kind: "text", text: `=== ФАЙЛ ${index}: «${file.name}» (документ) ===\n${text}` }];
  }
  const text = (await file.text()).slice(0, 350000);
  if (!text.trim()) throw new Error(`Файл «${file.name}» пустой.`);
  return [{ kind: "text", text: `=== ФАЙЛ ${index}: «${file.name}» ===\n${text}` }];
}

export async function expandFiles(files: File[]): Promise<{ parts: AiPart[]; sources: SourceDoc[]; skipped: string[] }> {
  if (files.length === 0) throw new Error("Добавьте хотя бы один файл.");
  const { docs, skipped } = await flattenInputFiles(files);
  if (docs.length === 0) throw new Error("В загруженном не нашлось подходящих файлов (PDF, изображения, Excel, Word, текст).");

  const parts: AiPart[] = [];
  const sources: SourceDoc[] = [];
  let budget = BASE64_BUDGET;
  let imageParts = 0;

  for (let i = 0; i < docs.length; i++) {
    const file = docs[i];
    const index = i + 1;
    const e = ext(file.name);

    if (e === "pdf") {
      let doc: PdfDoc | null = null;
      try {
        doc = await openPdf(file);
      } catch {
        throw new Error(`Не удалось открыть PDF «${file.name}» — файл повреждён или защищён паролем.`);
      }
      const pages = doc.numPages;
      sources.push({ index, name: file.name, file, kind: "pdf", pages });

      const wantNative = file.size <= NATIVE_PDF_LIMIT && pages <= 95;
      if (wantNative) {
        const b64 = await toBase64(file);
        if (b64.length <= budget) {
          parts.push({ kind: "text", text: `=== ФАЙЛ ${index}: «${file.name}» (PDF, страниц: ${pages}) ===` });
          parts.push({ kind: "pdf", base64: b64 });
          budget -= b64.length;
          await doc.destroy().catch(() => undefined);
          continue;
        }
      }

      const toSend = Math.min(pages, MAX_PAGES_PER_PDF, MAX_IMAGE_PARTS - imageParts);
      if (toSend <= 0) {
        skipped.push(`${file.name} — лимит изображений в запросе исчерпан`);
        await doc.destroy().catch(() => undefined);
        continue;
      }
      parts.push({
        kind: "text",
        text: `=== ФАЙЛ ${index}: «${file.name}» (PDF, страниц: ${pages}${toSend < pages ? `, переданы первые ${toSend}` : ""}) ===`
      });
      for (let p = 1; p <= toSend; p++) {
        const drawing = await pageHasText(doc, p);
        let maxSide = drawing ? 1600 : 1100;
        let quality = drawing ? 0.82 : 0.78;
        let { base64 } = await renderPageJpeg(doc, p, maxSide, quality);
        if (base64.length > budget && maxSide > 950) {
          maxSide = 950;
          quality = 0.7;
          base64 = (await renderPageJpeg(doc, p, maxSide, quality)).base64;
        }
        if (base64.length > budget) {
          skipped.push(`${file.name} — страницы с ${p} по ${toSend} не переданы: превышен объём запроса`);
          break;
        }
        parts.push({ kind: "text", text: `ФАЙЛ ${index}, страница ${p} из ${pages}:` });
        parts.push({ kind: "image", base64, mediaType: "image/jpeg" });
        budget -= base64.length;
        imageParts++;
      }
      await doc.destroy().catch(() => undefined);
      continue;
    }

    if (["png", "jpg", "jpeg", "webp"].includes(e)) {
      if (imageParts >= MAX_IMAGE_PARTS) {
        skipped.push(`${file.name} — лимит изображений в запросе исчерпан`);
        continue;
      }
      const base64 = await imageToJpegBase64(file);
      if (base64.length > budget) {
        skipped.push(`${file.name} — превышен объём запроса`);
        continue;
      }
      sources.push({ index, name: file.name, file, kind: "image", pages: 1 });
      parts.push({ kind: "text", text: `=== ФАЙЛ ${index}: «${file.name}» (изображение) ===` });
      parts.push({ kind: "image", base64, mediaType: "image/jpeg" });
      budget -= base64.length;
      imageParts++;
      continue;
    }

    if (["xlsx", "xls", "csv", "docx", "txt", "md"].includes(e)) {
      sources.push({ index, name: file.name, file, kind: "other", pages: 0 });
      parts.push(...(await textParts(file, index)));
      continue;
    }

    if (e === "doc") {
      throw new Error(`Старый формат .doc не поддерживается — пересохраните «${file.name}» как .docx или .pdf.`);
    }
    skipped.push(`${file.name} — формат не поддерживается`);
  }

  if (!parts.some((p) => p.kind !== "text")) {
    const hasText = parts.some((p) => p.kind === "text" && p.text.length > 80);
    if (!hasText) throw new Error("Не удалось получить содержимое файлов.");
  }
  return { parts, sources, skipped };
}

export async function fileToParts(file: File): Promise<AiPart[]> {
  const e = ext(file.name);
  if (["xlsx", "xls", "csv", "docx", "txt", "md"].includes(e)) {
    const parts = await textParts(file, 1);
    return parts.map((p) => (p.kind === "text" ? { kind: "text", text: p.text.replace(/^=== ФАЙЛ 1: /, "Содержимое файла ") } : p));
  }
  if (e === "pdf") {
    if (file.size > NATIVE_PDF_LIMIT) throw new Error("Для этого раздела подходит PDF до 15 МБ.");
    return [{ kind: "pdf", base64: await toBase64(file) }];
  }
  if (["png", "jpg", "jpeg", "webp"].includes(e)) {
    return [{ kind: "image", base64: await imageToJpegBase64(file), mediaType: "image/jpeg" }];
  }
  throw new Error("Поддерживаются форматы: Excel (.xlsx, .csv), Word (.docx), PDF, изображения и текст.");
}
