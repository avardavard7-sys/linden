import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { Settings } from "./types";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getAuthedSettings(req: Request): Promise<Settings> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Требуется вход в систему.");
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: userData, error: userError } = await sb.auth.getUser(token);
  if (userError || !userData?.user) throw new HttpError(401, "Сессия истекла — войдите заново.");
  const { data, error } = await sb.from("app_settings").select("*").eq("id", 1).single();
  if (error || !data) throw new HttpError(500, "Не удалось загрузить настройки системы.");
  return data as Settings;
}

type IncomingPart =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string }
  | { kind: "image"; base64: string; mediaType: string };

export function partsToContent(parts: unknown): any[] {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new HttpError(400, "Файл не передан.");
  }
  const blocks: any[] = [];
  for (const raw of parts.slice(0, 6)) {
    const part = raw as IncomingPart;
    if (part.kind === "text" && typeof part.text === "string" && part.text.trim()) {
      blocks.push({ type: "text", text: part.text.slice(0, 400000) });
    } else if (part.kind === "pdf" && typeof part.base64 === "string") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: part.base64 }
      });
    } else if (part.kind === "image" && typeof part.base64 === "string") {
      const media = ["image/png", "image/jpeg", "image/webp"].includes((part as any).mediaType)
        ? (part as any).mediaType
        : "image/png";
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: media, data: part.base64 }
      });
    }
  }
  if (blocks.length === 0) throw new HttpError(400, "Не удалось прочитать содержимое файла.");
  return blocks;
}

type ClaudeOptions = {
  system: string;
  content: any[];
  maxTokens?: number;
  thinkingBudget?: number;
  useIntegrations?: boolean;
};

export async function callClaude(settings: Settings, opts: ClaudeOptions): Promise<any> {
  const apiKey = (settings.anthropic_api_key || "").trim();
  if (!apiKey) {
    throw new HttpError(400, "Добавьте API-ключ: Настройки → Искусственный интеллект.");
  }
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  };
  const servers = opts.useIntegrations
    ? (settings.integrations || [])
        .filter((i) => i && i.enabled && i.url)
        .map((i) => ({
          type: "url",
          url: i.url,
          name: (i.name || "mcp").replace(/[^a-zA-Z0-9_-]/g, "") || "mcp",
          ...(i.token ? { authorization_token: i.token } : {})
        }))
    : [];
  if (servers.length > 0) headers["anthropic-beta"] = "mcp-client-2025-11-20";
  const body: Record<string, unknown> = {
    model: (settings.ai_model || "claude-fable-5").trim(),
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    messages: [{ role: "user", content: opts.content }]
  };
  if (opts.thinkingBudget && opts.thinkingBudget >= 1024) {
    body.thinking = { type: "adaptive" };
    body.output_config = { effort: "high" };
  }
  if (servers.length > 0) body.mcp_servers = servers;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message || `код ${res.status}`;
    const status = res.status === 401 || res.status === 403 ? 400 : 502;
    throw new HttpError(status, `ИИ-сервис: ${message}`);
  }
  return data;
}

export function textOf(data: any): string {
  const content = Array.isArray(data?.content) ? data.content : [];
  return content
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n");
}

export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart === -1 || objEnd <= objStart) {
    throw new HttpError(502, "ИИ вернул некорректный формат — попробуйте ещё раз.");
  }
  try {
    return JSON.parse(cleaned.slice(objStart, objEnd + 1)) as T;
  } catch {
    throw new HttpError(502, "Не удалось разобрать ответ ИИ — попробуйте ещё раз.");
  }
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  const message = e instanceof Error ? e.message : "Внутренняя ошибка сервера.";
  return NextResponse.json({ error: message }, { status: 500 });
}
