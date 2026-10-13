// ─── Совместимость со старыми браузерами ────────────────────────────────────
// pdf.js 6.x использует новейшие JS API (Map.getOrInsertComputed, Promise.try,
// Promise.withResolvers, Uint8Array.toBase64 / fromBase64 / toHex), которых нет
// в Safari до 26.x и Chrome до ~140–144. Без них загрузка PDF у клиента падает
// с ошибкой «getOrInsertComputed is not a function». Полифиллы ставятся ТОЛЬКО
// если нативного метода нет — современные браузеры работают на нативных
// реализациях. Зеркальная копия стоит в начале public/pdf.worker.min.mjs,
// потому что воркер исполняется в отдельном контексте.

function patchMapUpsert(ctor: any): void {
  if (!ctor || !ctor.prototype) return;
  const proto = ctor.prototype;
  if (typeof proto.getOrInsert !== "function") {
    Object.defineProperty(proto, "getOrInsert", {
      value: function getOrInsert(this: any, key: any, defaultValue: any) {
        if (!this.has(key)) this.set(key, defaultValue);
        return this.get(key);
      },
      writable: true,
      configurable: true
    });
  }
  if (typeof proto.getOrInsertComputed !== "function") {
    Object.defineProperty(proto, "getOrInsertComputed", {
      value: function getOrInsertComputed(this: any, key: any, callback: (k: any) => any) {
        if (!this.has(key)) this.set(key, callback(key));
        return this.get(key);
      },
      writable: true,
      configurable: true
    });
  }
}

function installPdfCompat(): void {
  try {
    patchMapUpsert(typeof Map !== "undefined" ? Map : null);
    patchMapUpsert(typeof WeakMap !== "undefined" ? WeakMap : null);

    const P: any = Promise;
    if (typeof P.withResolvers !== "function") {
      P.withResolvers = function withResolvers() {
        let resolve: any;
        let reject: any;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      };
    }
    if (typeof P.try !== "function") {
      P.try = function promiseTry(fn: any, ...args: any[]) {
        return new Promise((resolve) => resolve(fn.apply(undefined, args)));
      };
    }

    const U: any = typeof Uint8Array !== "undefined" ? Uint8Array : null;
    if (U) {
      if (typeof U.prototype.toBase64 !== "function") {
        Object.defineProperty(U.prototype, "toBase64", {
          value: function toBase64(this: Uint8Array) {
            let bin = "";
            const CHUNK = 0x8000;
            for (let i = 0; i < this.length; i += CHUNK) {
              bin += String.fromCharCode.apply(null, this.subarray(i, i + CHUNK) as any);
            }
            return btoa(bin);
          },
          writable: true,
          configurable: true
        });
      }
      if (typeof U.prototype.toHex !== "function") {
        Object.defineProperty(U.prototype, "toHex", {
          value: function toHex(this: Uint8Array) {
            let out = "";
            for (let i = 0; i < this.length; i++) out += this[i].toString(16).padStart(2, "0");
            return out;
          },
          writable: true,
          configurable: true
        });
      }
      if (typeof U.fromBase64 !== "function") {
        Object.defineProperty(U, "fromBase64", {
          value: function fromBase64(text: string) {
            const bin = atob(String(text).replace(/\s+/g, ""));
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
          },
          writable: true,
          configurable: true
        });
      }
    }
  } catch {
    return;
  }
}

installPdfCompat();

let libPromise: Promise<any> | null = null;

function lib(): Promise<any> {
  if (!libPromise) {
    installPdfCompat();
    libPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return m;
    });
  }
  return libPromise;
}

export type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any>; destroy: () => Promise<void> };

export async function openPdf(file: File): Promise<PdfDoc> {
  const pdfjs = await lib();
  const data = await file.arrayBuffer();
  const task = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: false });
  const doc = await task.promise;
  return {
    numPages: doc.numPages,
    getPage: (n: number) => doc.getPage(n),
    destroy: async () => {
      try {
        if (typeof task.destroy === "function") await task.destroy();
        else if (typeof doc.destroy === "function") await doc.destroy();
      } catch {
        return;
      }
    }
  };
}

export async function pageHasText(doc: PdfDoc, pageNumber: number): Promise<boolean> {
  try {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const chars = (content.items ?? []).reduce((acc: number, it: any) => acc + String(it?.str ?? "").trim().length, 0);
    return chars > 120;
  } catch {
    return true;
  }
}

export async function renderPageJpeg(
  doc: PdfDoc,
  pageNumber: number,
  maxSide = 1400,
  quality = 0.8
): Promise<{ base64: string; blob: Blob }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxSide / Math.max(base.width, base.height), 4);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось подготовить изображение страницы.");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Не удалось сохранить страницу как изображение.");
  const base64 = await blobToBase64(blob);
  canvas.width = 0;
  canvas.height = 0;
  return { base64, blob };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (comma === -1) reject(new Error("Не удалось прочитать изображение."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
    reader.readAsDataURL(blob);
  });
}
