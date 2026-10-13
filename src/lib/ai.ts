import {
  DEFAULT_STANDARDS,
  knowledgeBlock,
  managerNoteBlock,
  PRICE_SYSTEM,
  projectSystemPrompt,
  revisionSystemPrompt,
  standardsBlock,
  type CompanyStandards
} from "./prompts";
import { accessToken, supabase } from "./supabase";
import { identityFromSession } from "./identity";
import type { AiPart } from "./files";

async function call<T>(path: string, body: unknown): Promise<T> {
  const token = await accessToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({ error: "Сервер вернул некорректный ответ." }));
  if (!res.ok) throw new Error(json.error || "Ошибка запроса к серверу.");
  return json as T;
}

async function aiSettings(): Promise<{ apiKey: string; model: string }> {
  const { data } = await supabase.from("app_settings").select("anthropic_api_key,ai_model").eq("id", 1).single();
  const apiKey = String(data?.anthropic_api_key ?? "").trim();
  if (!apiKey) throw new Error("Добавьте API-ключ: Настройки → Искусственный интеллект.");
  return { apiKey, model: String(data?.ai_model ?? "claude-sonnet-5-5").trim() || "claude-sonnet-5-5" };
}

async function loadStandards(): Promise<string> {
  const { data } = await supabase.from("app_settings").select("standards").eq("id", 1).single();
  const raw = data?.standards;
  if (!raw || typeof raw !== "object") return standardsBlock(DEFAULT_STANDARDS);
  const merged: CompanyStandards = { ...DEFAULT_STANDARDS, ...(raw as Partial<CompanyStandards>) };
  return standardsBlock(merged);
}

async function loadKnowledge(): Promise<string> {
  const { data } = await supabase.from("ai_knowledge").select("title,content").order("created_at", { ascending: false }).limit(60);
  const entries = (data ?? []).map((x) => ({ title: String(x.title ?? ""), content: String(x.content ?? "") })).filter((x) => x.content.trim());
  return knowledgeBlock(entries);
}

async function loadRules(): Promise<string> {
  const [standards, knowledge] = await Promise.all([loadStandards(), loadKnowledge()]);
  return standards + knowledge;
}

function partsToContent(parts: AiPart[]): any[] {
  const blocks: any[] = [];
  for (const part of parts.slice(0, 240)) {
    if (part.kind === "text" && part.text.trim()) {
      blocks.push({ type: "text", text: part.text.slice(0, 400000) });
    } else if (part.kind === "pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: part.base64 } });
    } else if (part.kind === "image") {
      blocks.push({ type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } });
    }
  }
  if (blocks.length === 0) throw new Error("Не удалось прочитать содержимое файла.");
  return blocks;
}

type ThinkingMode = "adaptive" | "legacy" | "off";

export type AiUsage = { input: number; output: number; thinking: number; cacheRead: number; cacheWrite: number; model: string };
export type AiTrace = { step: string; projectId?: string | null; projectName?: string | null };

function emptyUsage(model: string): AiUsage {
  return { input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0, model };
}

export function applyUsageEvent(acc: AiUsage, event: any): void {
  if (!event) return;
  if (event.type === "message_start") {
    const u = event.message?.usage ?? {};
    if (typeof u.input_tokens === "number") acc.input = u.input_tokens;
    if (typeof u.cache_read_input_tokens === "number") acc.cacheRead = u.cache_read_input_tokens;
    if (typeof u.cache_creation_input_tokens === "number") acc.cacheWrite = u.cache_creation_input_tokens;
    if (typeof u.output_tokens === "number") acc.output = u.output_tokens;
    if (event.message?.model) acc.model = String(event.message.model);
  } else if (event.type === "message_delta") {
    const u = event.usage ?? {};
    if (typeof u.input_tokens === "number") acc.input = u.input_tokens;
    if (typeof u.cache_read_input_tokens === "number") acc.cacheRead = u.cache_read_input_tokens;
    if (typeof u.cache_creation_input_tokens === "number") acc.cacheWrite = u.cache_creation_input_tokens;
    if (typeof u.output_tokens === "number") acc.output = u.output_tokens;
    const t = u.output_tokens_details?.thinking_tokens;
    if (typeof t === "number") acc.thinking = t;
  }
}

export async function logAiUsage(trace: AiTrace, usage: AiUsage): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const identity = data.session ? identityFromSession(data.session) : null;
    await supabase.rpc("log_ai_usage", {
      p_step: trace.step,
      p_model: usage.model,
      p_input: usage.input,
      p_output: usage.output,
      p_thinking: usage.thinking,
      p_cache_read: usage.cacheRead,
      p_cache_write: usage.cacheWrite,
      p_project_id: trace.projectId ?? null,
      p_project_name: trace.projectName ?? null,
      p_author_name: identity?.name ?? ""
    });
  } catch {
    return;
  }
}

type DirectOpts = {
  system: string;
  content: any[];
  maxTokens: number;
  thinkingBudget?: number;
  modelOverride?: string;
  trace?: AiTrace;
};

async function directClaudeFull(opts: DirectOpts): Promise<{ text: string; usage: AiUsage }> {
  const { apiKey, model: settingsModel } = await aiSettings();
  const model = opts.modelOverride || settingsModel;
  const wantThinking = Boolean(opts.thinkingBudget && opts.thinkingBudget >= 1024);
  const first: ThinkingMode = wantThinking ? "adaptive" : "off";
  let result: { text: string; usage: AiUsage };
  try {
    result = await streamOnce(apiKey, model, opts, first);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (wantThinking && /thinking\.type|output_config|adaptive/i.test(msg)) {
      try {
        result = await streamOnce(apiKey, model, opts, "legacy");
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : "";
        if (/thinking/i.test(msg2)) result = await streamOnce(apiKey, model, opts, "off");
        else throw e2;
      }
    } else {
      throw e;
    }
  }
  if (opts.trace) void logAiUsage(opts.trace, result.usage);
  return result;
}

async function directClaude(opts: DirectOpts): Promise<string> {
  const r = await directClaudeFull(opts);
  return r.text;
}

async function streamOnce(
  apiKey: string,
  model: string,
  opts: { system: string; content: any[]; maxTokens: number; thinkingBudget?: number },
  mode: ThinkingMode
): Promise<{ text: string; usage: AiUsage }> {
  const usage = emptyUsage(model);
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.content }]
  };
  if (mode === "adaptive") {
    body.thinking = { type: "adaptive" };
    body.output_config = { effort: "medium" };
  } else if (mode === "legacy") {
    body.thinking = { type: "enabled", budget_tokens: opts.thinkingBudget };
  }
  body.stream = true;

  const controller = new AbortController();
  const FIRST_BYTE_MS = 600_000;
  const INACTIVITY_MS = 240_000;
  const HARD_CAP_MS = 30 * 60_000;
  let gotFirstByte = false;
  let aborted: "silence" | "hardcap" | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  const armSilence = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(
      () => {
        aborted = "silence";
        controller.abort();
      },
      gotFirstByte ? INACTIVITY_MS : FIRST_BYTE_MS
    );
  };
  const hardTimer = setTimeout(() => {
    aborted = "hardcap";
    controller.abort();
  }, HARD_CAP_MS);
  const cleanup = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    clearTimeout(hardTimer);
  };
  const timeoutMessage = () =>
    "Анализ прервался: связь с ИИ-сервисом оборвалась или заняла слишком долго. Попробуйте ещё раз или загрузите файл меньшего размера (меньше страниц).";

  armSilence();
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    cleanup();
    if (aborted || (e instanceof Error && e.name === "AbortError")) throw new Error(timeoutMessage());
    throw new Error("Не удалось связаться с ИИ-сервисом — проверьте подключение к интернету.");
  }
  if (!res.ok || !res.body) {
    cleanup();
    const data = await res.json().catch(() => null);
    const message = data?.error?.message || `код ${res.status}`;
    throw new Error(`ИИ-сервис: ${message}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let blockIsText = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      gotFirstByte = true;
      armSilence();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let event: any;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        applyUsageEvent(usage, event);
        if (event.type === "content_block_start") {
          blockIsText = event.content_block?.type === "text";
        } else if (event.type === "content_block_delta") {
          if (blockIsText && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
            text += event.delta.text;
          }
        } else if (event.type === "error") {
          throw new Error(`ИИ-сервис: ${event.error?.message || "ошибка потока"}`);
        }
      }
    }
  } catch (e) {
    cleanup();
    if (aborted || (e instanceof Error && e.name === "AbortError")) throw new Error(timeoutMessage());
    throw e;
  }
  cleanup();
  if (!text.trim()) throw new Error("ИИ вернул пустой ответ — попробуйте ещё раз.");
  return { text, usage };
}

function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart === -1 || objEnd <= objStart) {
    throw new Error("ИИ вернул некорректный формат — попробуйте ещё раз.");
  }
  try {
    return JSON.parse(cleaned.slice(objStart, objEnd + 1)) as T;
  } catch {
    throw new Error("Не удалось разобрать ответ ИИ — попробуйте ещё раз.");
  }
}

export type ParsedPriceItem = {
  name: string;
  category: string;
  item_type: "material" | "fitting" | "labor";
  unit: string;
  price: number;
  note: string;
};

export async function parsePriceFile(parts: AiPart[]): Promise<{ items: ParsedPriceItem[] }> {
  const content = partsToContent(parts);
  content.push({ type: "text", text: "Извлеки все позиции прайс-листа и верни только JSON." });
  const text = await directClaude({ system: PRICE_SYSTEM, content, maxTokens: 40000, thinkingBudget: 6000, trace: { step: "Разбор прайс-листа" } });
  const parsed = extractJson<{ items: any[] }>(text);
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((raw) => ({
      name: String(raw?.name ?? "").trim().slice(0, 200),
      category: String(raw?.category ?? "").trim().slice(0, 80) || "Материалы",
      item_type: (["material", "fitting", "labor"].includes(raw?.item_type) ? raw.item_type : "material") as ParsedPriceItem["item_type"],
      unit: String(raw?.unit ?? "шт").trim().slice(0, 20) || "шт",
      price: Math.max(0, Number(raw?.price) || 0),
      note: String(raw?.note ?? "").trim().slice(0, 200)
    }))
    .filter((i) => i.name && i.price > 0);
  return { items };
}

export type ParsedComponent = {
  priceItemId: string | null;
  name: string;
  type: "material" | "fitting" | "labor";
  unit: string;
  qty: number;
  price: number;
  note: string;
};

export type ParsedProjectItem = {
  name: string;
  room: string;
  width: number;
  height: number;
  depth: number;
  qty: number;
  spec?: string;
  image_ref: { file: number; page: number } | null;
  components: ParsedComponent[];
};

export type ParsedProject = {
  name: string;
  area: number | null;
  client: { name: string; phone: string; email: string; company: string };
  items: ParsedProjectItem[];
  assumptions: string;
  summary: string;
};

function sanitizeParsedProject(parsed: any): ParsedProject {
  const items: ParsedProjectItem[] = (Array.isArray(parsed?.items) ? parsed.items : []).map((it: any) => ({
    name: String(it?.name ?? "Позиция").slice(0, 200),
    room: String(it?.room ?? "").slice(0, 80),
    width: Math.max(0, Number(it?.width) || 0),
    height: Math.max(0, Number(it?.height) || 0),
    depth: Math.max(0, Number(it?.depth) || 0),
    qty: Math.max(1, Number(it?.qty) || 1),
    spec: String(it?.spec ?? "").slice(0, 1500),
    image_ref:
      it?.image_ref && Number.isFinite(Number(it.image_ref.file)) && Number.isFinite(Number(it.image_ref.page))
        ? { file: Math.max(1, Math.min(50, Math.round(Number(it.image_ref.file)))), page: Math.max(1, Math.min(500, Math.round(Number(it.image_ref.page)))) }
        : null,
    components: (Array.isArray(it?.components) ? it.components : [])
      .map((c: any) => ({
        priceItemId: typeof c?.priceItemId === "string" && c.priceItemId.length > 10 ? c.priceItemId : null,
        name: String(c?.name ?? "").slice(0, 200),
        type: (["material", "fitting", "labor"].includes(c?.type) ? c.type : "material") as ParsedComponent["type"],
        unit: String(c?.unit ?? "шт").slice(0, 20) || "шт",
        qty: Math.max(0, Number(c?.qty) || 0),
        price: Math.max(0, Number(c?.price) || 0),
        note: String(c?.note ?? "").slice(0, 300)
      }))
      .filter((c: ParsedComponent) => c.name && c.qty > 0)
  }));
  return {
    name: String(parsed?.name ?? "Новый проект").slice(0, 200),
    area: Number(parsed?.area) > 0 ? Number(parsed.area) : null,
    client: {
      name: String(parsed?.client?.name ?? "").slice(0, 120),
      phone: String(parsed?.client?.phone ?? "").slice(0, 40),
      email: String(parsed?.client?.email ?? "").slice(0, 120),
      company: String(parsed?.client?.company ?? "").slice(0, 120)
    },
    items,
    assumptions: String(parsed?.assumptions ?? "").slice(0, 8000),
    summary: String(parsed?.summary ?? "").slice(0, 8000)
  };
}

export async function parseProjectFile(parts: AiPart[], priceList: string, managerNote = ""): Promise<ParsedProject> {
  const knowledge = await loadRules();
  const content = partsToContent(parts);
  content.push({ type: "text", text: "Составь детальный расчёт корпусной мебели по этому проекту и верни только JSON." });
  const { text, usage } = await directClaudeFull({
    system: projectSystemPrompt(priceList.slice(0, 120000), knowledge + managerNoteBlock(managerNote)),
    content,
    maxTokens: 64000,
    thinkingBudget: 12000
  });
  const parsed = sanitizeParsedProject(extractJson<any>(text));
  void logAiUsage({ step: "Анализ чертежей и расчёт", projectName: parsed.name || "Новый расчёт" }, usage);
  return parsed;
}

export type RevisionResult = ParsedProject & { reply: string };

export async function reviseProject(args: {
  project: unknown;
  priceList: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  instruction: string;
  trace?: { projectId?: string | null; projectName?: string | null };
}): Promise<RevisionResult> {
  const knowledge = await loadRules();
  const historyText = args.history
    .slice(-14)
    .map((m) => `${m.role === "user" ? "Менеджер" : "Система"}: ${m.content}`)
    .join("\n");
  const content: any[] = [
    { type: "text", text: `ТЕКУЩИЙ ПРОЕКТ (JSON):\n${JSON.stringify(args.project).slice(0, 180000)}` }
  ];
  if (historyText) content.push({ type: "text", text: `ИСТОРИЯ ПЕРЕПИСКИ ПО ПРОЕКТУ:\n${historyText.slice(0, 20000)}` });
  content.push({ type: "text", text: `НОВОЕ УКАЗАНИЕ МЕНЕДЖЕРА:\n${args.instruction.slice(0, 6000)}\n\nИсправь расчёт и верни только JSON.` });
  const text = await directClaude({
    system: revisionSystemPrompt(args.priceList.slice(0, 120000), knowledge),
    content,
    maxTokens: 40000,
    thinkingBudget: 10000,
    trace: { step: "Правка расчёта в чате", projectId: args.trace?.projectId ?? null, projectName: args.trace?.projectName ?? null }
  });
  const parsed = extractJson<any>(text);
  const clean = sanitizeParsedProject(parsed);
  return { ...clean, reply: String(parsed?.reply ?? "Расчёт обновлён.").slice(0, 4000) };
}

export function generateDesign(prompt: string) {
  return call<{ text: string; images: string[]; usedTools: string[] }>("/api/ai/design", { prompt });
}

export function devClaude(opts: { system: string; content: any[]; maxTokens: number; thinkingBudget?: number }) {
  return directClaude({ ...opts, modelOverride: "claude-fable-5", trace: { step: "Разработчик (генерация кода)" } });
}

export { extractJson };

export function describeProject(projectBrief: string) {
  return call<{ summary: string }>("/api/ai/describe", { projectBrief });
}
