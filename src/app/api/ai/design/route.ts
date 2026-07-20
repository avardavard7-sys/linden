import { NextResponse } from "next/server";
import { callClaude, errorResponse, getAuthedSettings, HttpError } from "@/lib/serverAi";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `Ты — арт-директор мебельной студии премиум-класса и 3D-визуализатор.
По описанию создай концепт мебели или интерьера.
ЕСЛИ тебе подключены инструменты генерации изображений — ОБЯЗАТЕЛЬНО сгенерируй ими фотореалистичную 3D-визуализацию: составь детальный английский промпт с материалами, текстурами, освещением (мягкий дневной свет + акцентная подсветка), ракурсом (three-quarter view) и стилем рендера (photorealistic 3D render, interior magazine quality), вызови инструмент и дождись ссылок на изображения.
Затем дай структурированный концепт на русском:
1. Композиция и габариты (в мм).
2. Материалы и декоры — конкретные, с брендами и артикулами (Egger, Kronospan, Blum), где уместно.
3. Фурнитура и механизмы.
4. Цветовая палитра — 4–5 значений hex.
5. Свет и сценарии освещения.
6. 2–3 идеи, как сделать решение дороже и выразительнее.
Пиши профессионально и вдохновляюще, без воды.`;

const URL_RE = /https?:\/\/[^\s"'<>\\)\]}]+/g;

function collectImages(data: any): string[] {
  const urls = new Set<string>();
  const content = Array.isArray(data?.content) ? data.content : [];
  for (const block of content) {
    if (block?.type === "mcp_tool_result") {
      const raw = JSON.stringify(block.content ?? "");
      for (const m of raw.match(URL_RE) ?? []) {
        urls.add(m.replace(/\\+$/, "").replace(/[",]+$/, ""));
      }
    }
    if (block?.type === "text" && typeof block.text === "string") {
      for (const m of block.text.match(URL_RE) ?? []) {
        if (/\.(png|jpe?g|webp)(\?|$)/i.test(m)) urls.add(m);
      }
    }
  }
  return Array.from(urls)
    .map((u) => u.replace(/[.,;)\]]+$/, ""))
    .filter((u) => u.startsWith("http"))
    .slice(0, 8);
}

function collectTools(data: any): string[] {
  const content = Array.isArray(data?.content) ? data.content : [];
  const names: string[] = content.filter((b: any) => b?.type === "mcp_tool_use").map((b: any) => String(b.name ?? ""));
  return Array.from(new Set(names)).filter(Boolean);
}

export async function POST(req: Request) {
  try {
    const settings = await getAuthedSettings(req);
    const body = await req.json();
    const prompt = String(body?.prompt ?? "").trim().slice(0, 4000);
    if (!prompt) throw new HttpError(400, "Опишите, что нужно спроектировать.");
    const data = await callClaude(settings, {
      system: SYSTEM,
      content: [{ type: "text", text: prompt }],
      maxTokens: 5000,
      useIntegrations: true
    });
    const content = Array.isArray(data?.content) ? data.content : [];
    const text = content
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return NextResponse.json({
      text: text || "Концепт не получен — попробуйте переформулировать запрос.",
      images: collectImages(data),
      usedTools: collectTools(data)
    });
  } catch (e) {
    return errorResponse(e);
  }
}
