import { supabase } from "./supabase";

const BUCKET = "project-images";
const MAX_SIZE = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export async function uploadItemImage(projectId: string, itemId: string, file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new Error("Поддерживаются JPG, PNG и WebP.");
  if (file.size > MAX_SIZE) throw new Error("Изображение больше 8 МБ — уменьшите разрешение.");
  const jpeg = await toJpeg(file);
  const path = `${projectId}/${itemId}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, jpeg, { upsert: true, contentType: "image/jpeg" });
  if (error) throw new Error("Не удалось загрузить изображение.");
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Не удалось прочитать изображение.");
  const maxSide = 1600;
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
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Не удалось обработать изображение.");
  return blob;
}

export async function fetchImageBytes(url: string): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const size = await imageSize(buffer, res.headers.get("content-type") ?? "image/jpeg");
    if (!size) return null;
    return { data: new Uint8Array(buffer), width: size.width, height: size.height };
  } catch {
    return null;
  }
}

function imageSize(buffer: ArrayBuffer, type: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const blob = new Blob([buffer], { type });
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}
