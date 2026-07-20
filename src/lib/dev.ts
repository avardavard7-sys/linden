import JSZip from "jszip";
import { devClaude, extractJson } from "./ai";
import { devEditSystem, devFixSystem, devPlanSystem } from "./prompts";
import { validateChanges, type DevIssue } from "./devValidate";
import { accessToken, supabase } from "./supabase";

export type SourceFile = {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  updated_at: string;
};

export type DevChange = { path: string; content: string };

export type DevResult = {
  reply: string;
  changed: string[];
  deleted: string[];
  edited: boolean;
};

const PATH_RE = /^[A-Za-z0-9_@][A-Za-z0-9_@\-./[\]()]*$/;

function validPath(p: string): boolean {
  return PATH_RE.test(p) && !p.includes("..") && !p.startsWith("/") && p.length < 200;
}

export async function fetchSource(): Promise<SourceFile[]> {
  const { data, error } = await supabase.from("linden_source").select("*").order("path");
  if (error) throw new Error("Не удалось загрузить исходники проекта.");
  return (data ?? []) as SourceFile[];
}

export function buildTree(files: SourceFile[]): string {
  return files.map((f) => `${f.path} (${f.encoding === "base64" ? "bin" : `${Math.ceil(f.content.length / 1024)}к`})`).join("\n");
}

export async function devPlan(request: string, tree: string, history: Array<{ role: string; content: string }>) {
  const historyText = history
    .slice(-10)
    .map((m) => `${m.role === "user" ? "Руководитель" : "Linden"}: ${m.content.slice(0, 800)}`)
    .join("\n");
  const content: any[] = [];
  if (historyText) content.push({ type: "text", text: `ИСТОРИЯ ПЕРЕПИСКИ:\n${historyText}` });
  content.push({ type: "text", text: `ЗАПРОС РУКОВОДИТЕЛЯ:\n${request.slice(0, 6000)}\n\nВерни только JSON.` });
  const text = await devClaude({ system: devPlanSystem(tree), content, maxTokens: 3000 });
  const parsed = extractJson<any>(text);
  const mode = parsed?.mode === "answer" ? "answer" : "edit";
  const files: string[] = (Array.isArray(parsed?.files) ? parsed.files : [])
    .map((x: unknown) => String(x))
    .filter(validPath)
    .slice(0, 14);
  return { mode, files, reply: String(parsed?.reply ?? "").slice(0, 8000) };
}

export async function devEdit(
  request: string,
  picked: SourceFile[],
  tree: string,
  history: Array<{ role: string; content: string }>
): Promise<{ reply: string; sql: string; files: DevChange[]; deleted: string[] }> {
  const historyText = history
    .slice(-10)
    .map((m) => `${m.role === "user" ? "Руководитель" : "Linden"}: ${m.content.slice(0, 800)}`)
    .join("\n");
  const content: any[] = [];
  for (const f of picked) {
    content.push({ type: "text", text: `ФАЙЛ ${f.path}:\n${f.content.slice(0, 120000)}` });
  }
  if (historyText) content.push({ type: "text", text: `ИСТОРИЯ ПЕРЕПИСКИ:\n${historyText}` });
  content.push({ type: "text", text: `ЗАПРОС РУКОВОДИТЕЛЯ:\n${request.slice(0, 6000)}\n\nВнеси изменения и верни только JSON.` });
  const text = await devClaude({ system: devEditSystem(tree), content, maxTokens: 50000, thinkingBudget: 16000 });
  const parsed = extractJson<any>(text);
  const files: DevChange[] = (Array.isArray(parsed?.files) ? parsed.files : [])
    .map((f: any) => ({ path: String(f?.path ?? ""), content: String(f?.content ?? "") }))
    .filter((f: DevChange) => validPath(f.path) && f.content.length > 0 && f.content.length < 500000)
    .slice(0, 30);
  const deleted: string[] = (Array.isArray(parsed?.deleted) ? parsed.deleted : [])
    .map((x: unknown) => String(x))
    .filter(validPath)
    .slice(0, 20);
  return {
    reply: String(parsed?.reply ?? "Готово.").slice(0, 12000),
    sql: String(parsed?.sql ?? "").trim().slice(0, 60000),
    files,
    deleted
  };
}

export async function devFix(files: DevChange[], issues: DevIssue[]): Promise<DevChange[]> {
  const byPath = new Map<string, string[]>();
  for (const it of issues) {
    if (!byPath.has(it.path)) byPath.set(it.path, []);
    byPath.get(it.path)!.push(it.message);
  }
  const content: any[] = [];
  for (const f of files) {
    const errs = byPath.get(f.path);
    if (!errs) continue;
    content.push({ type: "text", text: `ФАЙЛ ${f.path}\nНАЙДЕННЫЕ ОШИБКИ: ${errs.join("; ")}\nСОДЕРЖИМОЕ:\n${f.content.slice(0, 120000)}` });
  }
  if (content.length === 0) return [];
  content.push({ type: "text", text: "Исправь синтаксис в перечисленных файлах и верни только JSON с полными файлами." });
  const text = await devClaude({ system: devFixSystem(), content, maxTokens: 50000, thinkingBudget: 8000 });
  const parsed = extractJson<any>(text);
  return (Array.isArray(parsed?.files) ? parsed.files : [])
    .map((f: any) => ({ path: String(f?.path ?? ""), content: String(f?.content ?? "") }))
    .filter((f: DevChange) => validPath(f.path) && f.content.length > 20 && f.content.length < 500000)
    .slice(0, 30);
}

export async function applyChanges(files: DevChange[], deleted: string[]): Promise<void> {
  if (files.length) {
    const rows = files.map((f) => ({ path: f.path, content: f.content, encoding: "utf8", updated_at: new Date().toISOString() }));
    const { error } = await supabase.from("linden_source").upsert(rows, { onConflict: "path" });
    if (error) throw new Error("Не удалось сохранить изменённые файлы.");
  }
  for (const path of deleted) {
    await supabase.from("linden_source").delete().eq("path", path);
  }
}

const SKIP_RE = /^(node_modules\/|\.next\/|\.git\/)|(^|\/)(package-lock\.json|\.DS_Store)$/;
const BINARY_RE = /\.(png|jpg|jpeg|webp|gif|ico|woff2?|ttf|eot)$/i;

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function uploadSourceZip(file: File): Promise<number> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const rows: Array<{ path: string; content: string; encoding: "utf8" | "base64"; updated_at: string }> = [];
  const now = new Date().toISOString();
  const names = Object.keys(zip.files);
  const rootPrefix = names.length > 0 && names.every((n) => n.startsWith(names[0].split("/")[0] + "/")) && names[0].includes("/")
    ? names[0].split("/")[0] + "/"
    : "";
  for (const name of names) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const path = (rootPrefix && name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name).trim();
    if (!path || SKIP_RE.test(path) || !validPath(path)) continue;
    if (BINARY_RE.test(path)) {
      const bytes = await entry.async("uint8array");
      if (bytes.length > 2_000_000) continue;
      rows.push({ path, content: bytesToB64(bytes), encoding: "base64", updated_at: now });
    } else {
      const text = await entry.async("string");
      if (text.length > 2_600_000) continue;
      rows.push({ path, content: text, encoding: "utf8", updated_at: now });
    }
  }
  if (rows.length === 0) throw new Error("В архиве не найдено файлов проекта.");
  const { error: delErr } = await supabase.from("linden_source").delete().neq("path", "");
  if (delErr) throw new Error("Не удалось очистить старые исходники.");
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const { error } = await supabase.from("linden_source").upsert(batch, { onConflict: "path" });
    if (error) throw new Error("Не удалось сохранить исходники в базу.");
  }
  return rows.length;
}

export async function sourceCount(): Promise<number> {
  const { count } = await supabase.from("linden_source").select("path", { count: "exact", head: true });
  return count ?? 0;
}

async function execSql(sql: string): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await accessToken();
    const res = await fetch("/api/db/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sql })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: String(json.error ?? "Ошибка выполнения SQL.") };
    const commands = (json.results ?? []).map((r: any) => r.command).filter(Boolean).join(", ");
    return { ok: true, message: commands || "выполнено" };
  } catch {
    return { ok: false, message: "Сервер выполнения SQL недоступен." };
  }
}

export async function runDevRequest(
  request: string,
  history: Array<{ role: string; content: string }>
): Promise<DevResult> {
  const source = await fetchSource();
  if (source.length === 0) throw new Error("Исходники проекта не загружены в систему.");
  const tree = buildTree(source);
  const plan = await devPlan(request, tree, history);
  if (plan.mode === "answer") {
    return { reply: plan.reply || "Готов помочь - уточните задачу.", changed: [], deleted: [], edited: false };
  }
  const byPath = new Map(source.map((f) => [f.path, f]));
  const picked = plan.files.map((p) => byPath.get(p)).filter(Boolean) as SourceFile[];
  const guaranteed = ["src/lib/types.ts", "tailwind.config.ts"];
  for (const g of guaranteed) {
    if (!picked.some((f) => f.path === g) && byPath.has(g) && picked.length < 16) picked.push(byPath.get(g)!);
  }
  const result = await devEdit(request, picked, tree, history);
  let safeFiles = result.files.filter((f) => byPath.get(f.path)?.encoding !== "base64");

  let issues = await validateChanges(safeFiles);
  if (issues.length) {
    try {
      const fixed = await devFix(safeFiles, issues);
      if (fixed.length) {
        const fixedByPath = new Map(fixed.map((f) => [f.path, f]));
        safeFiles = safeFiles.map((f) => fixedByPath.get(f.path) ?? f);
        issues = await validateChanges(safeFiles);
      }
    } catch {
      /* авто-фикс недоступен - отдадим отчёт как есть */
    }
  }

  await applyChanges(safeFiles, result.deleted);
  let reply = result.reply;
  if (result.sql) {
    const outcome = await execSql(result.sql);
    if (outcome.ok) {
      reply += `\n\nБаза данных обновлена автоматически (${outcome.message}).`;
    } else {
      reply += `\n\nБаза данных не обновлена: ${outcome.message}\nВыполните SQL вручную в Supabase:\n${result.sql}`;
    }
  }
  if (safeFiles.length > 0) {
    if (issues.length === 0) {
      reply += "\n\n✓ Самопроверка кода пройдена: синтаксис изменённых файлов корректен.";
    } else {
      const list = issues.slice(0, 4).map((i) => `• ${i.path}: ${i.message}`).join("\n");
      reply += `\n\n⚠ Самопроверка нашла возможные проблемы — перепроверьте эти файлы перед деплоем:\n${list}`;
    }
  }
  return { reply, changed: safeFiles.map((f) => f.path), deleted: result.deleted, edited: true };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function downloadProjectZip(): Promise<number> {
  const source = await fetchSource();
  if (source.length === 0) throw new Error("Исходники проекта пусты.");
  const zip = new JSZip();
  for (const f of source) {
    if (f.encoding === "base64") zip.file(f.path, b64ToBytes(f.content));
    else zip.file(f.path, f.content);
  }
  const paths = new Set(source.map((f) => f.path));
  if (!paths.has(".gitignore")) {
    zip.file(".gitignore", ["node_modules", ".next", "out", "build", ".vercel", "*.log", ".DS_Store", ".env*", ""].join("\n"));
  }
  if (!paths.has(".npmrc")) {
    zip.file(".npmrc", "legacy-peer-deps=true\n");
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "linden.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return source.length;
}
