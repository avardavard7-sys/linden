import type { DevChange } from "./dev";

export type DevIssue = { path: string; message: string };

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const CONFLICT_RE = /^(<{7})|(={7}\s*$)|(>{7})/m;

function scanBalance(src: string): string | null {
  const n = src.length;
  const stack: string[] = [];
  const closeToOpen: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let state: "code" | "sq" | "dq" | "tpl" | "line" | "block" = "code";
  let line = 1;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    if (c === "\n") line++;
    if (state === "line") {
      if (c === "\n") state = "code";
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") {
        state = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (state === "sq") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "'") state = "code";
      i++;
      continue;
    }
    if (state === "dq") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') state = "code";
      i++;
      continue;
    }
    if (state === "tpl") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        state = "code";
        i++;
        continue;
      }
      if (c === "$" && c2 === "{") {
        stack.push("`{");
        state = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (c === "/" && c2 === "/") {
      state = "line";
      i += 2;
      continue;
    }
    if (c === "/" && c2 === "*") {
      state = "block";
      i += 2;
      continue;
    }
    if (c === "'") {
      state = "sq";
      i++;
      continue;
    }
    if (c === '"') {
      state = "dq";
      i++;
      continue;
    }
    if (c === "`") {
      state = "tpl";
      i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      stack.push(c);
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      const top = stack[stack.length - 1];
      if (c === "}" && top === "`{") {
        stack.pop();
        state = "tpl";
        i++;
        continue;
      }
      if (!top || top !== closeToOpen[c]) {
        return `лишняя или несогласованная скобка «${c}» (строка ~${line})`;
      }
      stack.pop();
      i++;
      continue;
    }
    i++;
  }
  if (state === "block") return "незакрытый комментарий /* … */ — файл, похоже, обрывается";
  if (state === "sq" || state === "dq") return "незакрытая кавычка — файл, похоже, обрывается";
  if (state === "tpl") return "незакрытый шаблонный литерал ` — файл, похоже, обрывается";
  const opens = stack.filter((s) => s !== "`{");
  if (opens.length) return `не закрыто скобок: ${opens.length} (последняя «${opens[opens.length - 1]}») — файл, похоже, обрывается`;
  return null;
}

const runtimeImport = (u: string) =>
  (new Function("u", "return import(u)") as (u: string) => Promise<any>)(u);

let tsPromise: Promise<any> | null = null;

async function loadTS(): Promise<any | null> {
  if (!tsPromise) {
    tsPromise = (async () => {
      const urls = [
        "https://esm.sh/typescript@5.6.3",
        "https://cdn.jsdelivr.net/npm/typescript@5.6.3/+esm"
      ];
      for (const u of urls) {
        try {
          const mod = await runtimeImport(u);
          const ts = mod?.default ?? mod;
          if (ts && typeof ts.transpileModule === "function") return ts;
        } catch {
          /* пробуем следующий источник */
        }
      }
      return null;
    })();
  }
  return tsPromise.catch(() => null);
}

function tsSyntax(ts: any, path: string, content: string): DevIssue[] {
  const out: DevIssue[] = [];
  let res: any;
  try {
    res = ts.transpileModule(content, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: /\.tsx$/i.test(path) ? ts.JsxEmit.Preserve : ts.JsxEmit.None,
        isolatedModules: false,
        allowJs: true,
        noEmitOnError: false
      }
    });
  } catch {
    return out;
  }
  for (const d of res?.diagnostics ?? []) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    let where = "";
    if (typeof d.start === "number" && d.file?.getLineAndCharacterOfPosition) {
      const lc = d.file.getLineAndCharacterOfPosition(d.start);
      where = ` (строка ${lc.line + 1})`;
    }
    out.push({ path, message: `${msg}${where}` });
    if (out.length >= 3) break;
  }
  return out;
}

export async function validateChanges(files: DevChange[]): Promise<DevIssue[]> {
  const issues: DevIssue[] = [];
  const code = files.filter((f) => CODE_EXT.test(f.path));

  for (const f of files) {
    if (CONFLICT_RE.test(f.content)) {
      issues.push({ path: f.path, message: "остались маркеры конфликта слияния (<<<<<<< / =======  / >>>>>>>)" });
    }
    if (f.content.trim().length === 0) {
      issues.push({ path: f.path, message: "файл получился пустым" });
    }
  }

  const flagged = new Set(issues.map((i) => i.path));
  for (const f of code) {
    if (flagged.has(f.path)) continue;
    const bal = scanBalance(f.content);
    if (bal) {
      issues.push({ path: f.path, message: bal });
      flagged.add(f.path);
    }
  }

  const ts = await loadTS();
  if (ts) {
    for (const f of code) {
      if (flagged.has(f.path)) continue;
      const found = tsSyntax(ts, f.path, f.content);
      if (found.length) {
        issues.push(...found);
        flagged.add(f.path);
      }
    }
  }

  return issues.slice(0, 8);
}
