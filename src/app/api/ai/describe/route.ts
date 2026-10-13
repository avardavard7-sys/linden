import { NextResponse } from "next/server";
import { callClaude, errorResponse, getAuthedSettings, HttpError, textOf } from "@/lib/serverAi";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `Ты — коммерческий директор мебельного производства премиум-класса.
По составу проекта напиши для клиента обоснование стоимости: 2–3 абзаца.
Объясни, из чего складывается цена: качество материалов и брендов, фурнитура, точность производства, монтаж, гарантия.
Пиши уверенно, профессионально и уважительно. Без упоминания наценки, себестоимости и внутренних терминов. Без списков — связным текстом. Верни только текст без заголовков.`;

export async function POST(req: Request) {
  try {
    const settings = await getAuthedSettings(req);
    const body = await req.json();
    const brief = String(body?.projectBrief ?? "").trim().slice(0, 30000);
    if (!brief) throw new HttpError(400, "Нет данных проекта.");
    const data = await callClaude(settings, {
      system: SYSTEM,
      content: [{ type: "text", text: brief }],
      maxTokens: 1500
    });
    return NextResponse.json({ summary: textOf(data).trim() });
  } catch (e) {
    return errorResponse(e);
  }
}
