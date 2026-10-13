"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileCode2, SendHorizonal, Upload, Wrench } from "lucide-react";
import LindenDev, { type LindenMood } from "@/components/LindenDev";
import PageTitle from "@/components/PageTitle";
import { useToast } from "@/components/Toast";
import { downloadProjectZip, fetchSource, runDevRequest, uploadSourceZip } from "@/lib/dev";
import { identityFromSession } from "@/lib/identity";
import { supabase } from "@/lib/supabase";

type DevMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  files: string[];
  author_name: string;
  created_at: string;
};

const PHRASES = ["Изучаю проект…", "Читаю нужные файлы…", "Пишу код…", "Проверяю, чтобы ничего не сломалось…", "Собираю архив…"];

export default function DeveloperPage() {
  const toast = useToast();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [messages, setMessages] = useState<DevMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState(PHRASES[0]);
  const [filesCount, setFilesCount] = useState(0);
  const [mood, setMood] = useState<LindenMood>("idle");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      const session = data.session;
      if (!session || identityFromSession(session).role !== "owner") {
        router.replace("/");
        return;
      }
      setReady(true);
      const [{ data: msgs }, source] = await Promise.all([
        supabase.from("dev_messages").select("*").order("created_at", { ascending: true }).limit(200),
        fetchSource().catch(() => [])
      ]);
      if (!alive) return;
      setMessages(
        ((msgs ?? []) as any[]).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          files: Array.isArray(m.files) ? m.files : [],
          author_name: m.author_name ?? "",
          created_at: m.created_at
        }))
      );
      setFilesCount(source.length);
    });
    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!busy) return;
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % PHRASES.length;
      setPhrase(PHRASES[i]);
    }, 3200);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (busy) {
      setMood("think");
      return;
    }
    if (input.trim()) {
      setMood("surprised");
      return;
    }
    setMood("idle");
  }, [busy, input]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput("");
    setPhrase(PHRASES[0]);
    const { data: sess } = await supabase.auth.getSession();
    const identity = sess.session ? identityFromSession(sess.session) : null;
    const { data: userMsg } = await supabase
      .from("dev_messages")
      .insert({ role: "user", content: text, author_name: identity?.name ?? "" })
      .select("*")
      .single();
    if (userMsg) setMessages((prev) => [...prev, { ...(userMsg as any), files: [] }]);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const result = await runDevRequest(text, history);
      let reply = result.reply;
      if (result.edited) {
        const count = await downloadProjectZip();
        setFilesCount(count);
        reply += `\n\nАрхив linden.zip (${count} файлов) скачан — внутри уже есть .gitignore и .npmrc, node_modules в git не попадут.\n\nРаспакуйте поверх папки проекта и выполните по порядку:\n\n1) Проверка сборки (обязательно перед деплоем):\nnpm install --legacy-peer-deps\nnpm run build\n\n2) Если сборка прошла без ошибок — деплой:\ngit add . ; git commit -m "update" ; git push origin main --force\n\nЕсли git ругается на прошлый большой коммит: сначала Remove-Item -Recurse -Force .git, затем git init ; git add . ; git commit -m "update" ; git branch -M main ; git remote add origin https://github.com/avardavard7-sys/linden.git ; git push -u origin main --force`;
        setMood("happy");
        setTimeout(() => setMood("idle"), 2500);
      }
      const { data: botMsg } = await supabase
        .from("dev_messages")
        .insert({ role: "assistant", content: reply, files: result.changed, author_name: "Linden" })
        .select("*")
        .single();
      if (botMsg) setMessages((prev) => [...prev, { ...(botMsg as any), files: result.changed }]);
      toast(result.edited ? `Готово: изменено файлов - ${result.changed.length}.` : "Ответ готов.", "ok");
    } catch (e) {
      const errText = e instanceof Error ? e.message : "Не удалось выполнить задачу.";
      const { data: botMsg } = await supabase
        .from("dev_messages")
        .insert({ role: "assistant", content: `Не получилось: ${errText}`, author_name: "Linden" })
        .select("*")
        .single();
      if (botMsg) setMessages((prev) => [...prev, { ...(botMsg as any), files: [] }]);
      toast(errText, "error");
    } finally {
      setBusy(false);
    }
  }

  async function manualZip() {
    try {
      const count = await downloadProjectZip();
      toast(`Архив скачан: ${count} файлов.`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось собрать архив.", "error");
    }
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-32">
        <span className="spinner" />
      </div>
    );
  }

  async function pickSourceZip(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSeeding(true);
    try {
      const count = await uploadSourceZip(file);
      setFilesCount(count);
      toast(`Исходники загружены: ${count} файлов. Linden выучил проект.`, "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Не удалось загрузить архив.", "error");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="fade-up">
      <PageTitle
        title="Разработчик"
        subtitle="Linden - штатный инженер платформы. Опишите функцию словами: он изучит проект, внесёт изменения в код и отдаст готовый архив для деплоя."
        right={
          <div className="flex gap-2">
            <label className="btn cursor-pointer">
              {seeding ? <span className="spinner" /> : <Upload size={15} />}
              Загрузить исходники
              <input type="file" className="hidden" accept=".zip" onChange={pickSourceZip} />
            </label>
            <button className="btn" onClick={manualZip}>
              <Download size={15} />
              Скачать проект
            </button>
          </div>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-4 border-b border-line bg-lacquer">
          <LindenDev size={86} mood={mood} />
          <div className="min-w-0">
            <p className="font-display text-xl text-oaklight leading-tight">Linden</p>
            <p className="text-xs text-oaklight/60">штатный инженер · исходников в системе: <span className="num">{filesCount}</span></p>
            {busy && <p className="text-xs text-oak mt-1 flex items-center gap-1.5"><span className="spinner" />{phrase}</p>}
          </div>
        </div>

        <div className="max-h-[52vh] min-h-[280px] overflow-y-auto p-4 sm:p-5 space-y-3 bg-paper/50">
          {messages.length === 0 && (
            <div className="text-center py-10 text-sm text-dim max-w-md mx-auto">
              <Wrench size={22} className="mx-auto mb-3 text-oak" />
              Напишите, какую функцию добавить или что изменить - например: «добавь на страницу проектов фильтр по сотруднику» или «сделай кнопку дублирования проекта». Linden внесёт правки и скачает готовый ZIP для деплоя.
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "user" ? "bg-lacquer text-oaklight rounded-br-md" : "bg-card border border-line rounded-bl-md"
                }`}
              >
                {m.content}
                {m.files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-line/60">
                    {m.files.map((f) => (
                      <span key={f} className="inline-flex items-center gap-1 rounded-md bg-oaklight/60 border border-oak/40 px-1.5 py-0.5 text-[10px] num text-oakdark">
                        <FileCode2 size={10} />
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                <div className={`text-[10px] mt-1.5 ${m.role === "user" ? "text-oaklight/50" : "text-dim"}`}>
                  {m.role === "user" ? m.author_name || "Руководитель" : "Linden"} ·{" "}
                  {new Date(m.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 sm:p-4 border-t border-line flex items-end gap-2">
          <textarea
            className="input !min-h-[48px] max-h-36 text-[13px] flex-1"
            rows={1}
            placeholder="Опишите задачу: какую функцию добавить, что поменять…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy}
          />
          <button className="btn-primary !px-4" onClick={send} disabled={busy || !input.trim()}>
            <SendHorizonal size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
