"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ImageIcon, Link2, Send, Settings2, Sparkles, Trash2 } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import { useToast } from "@/components/Toast";
import { generateDesign } from "@/lib/ai";
import { fmtDate } from "@/lib/calc";
import { supabase } from "@/lib/supabase";
import type { DesignRecord, Integration } from "@/lib/types";

const STYLES = [
  "современный минимализм",
  "неоклассика",
  "джапанди",
  "сканди",
  "лофт",
  "тёмный шпон и латунь",
  "светлый дуб",
  "матовая эмаль"
];

type ProjectRef = { id: string; name: string; number: number };

export default function DesignPage() {
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultText, setResultText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [history, setHistory] = useState<DesignRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [projectId, setProjectId] = useState("");
  const [mcpOn, setMcpOn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      const [{ data: d }, { data: p }, { data: s }] = await Promise.all([
        supabase.from("designs").select("*").order("created_at", { ascending: false }).limit(30),
        supabase.from("projects").select("id,name,number").order("created_at", { ascending: false }).limit(100),
        supabase.from("app_settings").select("integrations").eq("id", 1).single()
      ]);
      if (!alive) return;
      setHistory((d ?? []) as DesignRecord[]);
      setProjects((p ?? []) as ProjectRef[]);
      const ints = ((s?.integrations ?? []) as Integration[]).filter((i) => i.enabled && i.url);
      setMcpOn(ints.length > 0);
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  const projectName = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  function addStyle(s: string) {
    setPrompt((prev) => (prev.trim() ? `${prev.trim()}, ${s}` : `Кухня, ${s}`));
  }

  async function run() {
    const text = prompt.trim();
    if (!text) {
      toast("Опишите, что нужно визуализировать.", "info");
      return;
    }
    setBusy(true);
    setResultText("");
    setImages([]);
    try {
      const full = projectName ? `${text}\n\nКонтекст: проект «${projectName.name}» (расчёт №${projectName.number}).` : text;
      const res = await generateDesign(full);
      setResultText(res.text);
      setImages(res.images);
      const { data } = await supabase
        .from("designs")
        .insert({ project_id: projectId || null, prompt: text, result_text: res.text, image_urls: res.images })
        .select("*")
        .single();
      if (data) setHistory((prev) => [data as DesignRecord, ...prev]);
      toast(res.images.length ? `Готово: ${res.images.length} рендер(а).` : "Концепция готова.", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось сгенерировать дизайн.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeRecord(r: DesignRecord) {
    await supabase.from("designs").delete().eq("id", r.id);
    setHistory((prev) => prev.filter((x) => x.id !== r.id));
  }

  return (
    <div className="fade-up">
      <PageTitle
        title="Дизайн‑студия"
        subtitle="Опишите изделие или интерьер — получите концепцию и фотореалистичные рендеры с материалами и светом."
      />

      {mcpOn === false && (
        <div className="card p-4 mb-6 flex items-start gap-3 text-sm">
          <Settings2 size={16} className="text-oak shrink-0 mt-0.5" />
          <p className="text-dim">
            Сейчас доступна только текстовая концепция. Чтобы получать фотореалистичные картинки, включите Higgsfield в разделе{" "}
            <Link href="/settings" className="text-oak underline underline-offset-2">
              Настройки → Интеграции
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6 min-w-0">
          <div className="card p-5">
            <label className="label">Что визуализируем</label>
            <textarea
              className="input min-h-[110px] text-sm leading-relaxed"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Например: угловая кухня 3,2 × 2,4 м, фасады — матовая эмаль цвета шалфея, столешница из светлого кварца, латунные ручки, тёплый вечерний свет…"
            />
            <div className="flex flex-wrap gap-1.5 mt-3">
              {STYLES.map((s) => (
                <button key={s} className="pill hover:border-oak hover:text-oak transition-colors" onClick={() => addStyle(s)}>
                  {s}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <div className="flex items-center gap-2 text-sm">
                <Link2 size={14} className="text-dim" />
                <select className="input py-1.5 text-sm max-w-[16rem]" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Без привязки к проекту</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      №{p.number} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn-primary ml-auto" onClick={run} disabled={busy}>
                {busy ? <span className="spinner" /> : <Send size={15} />}
                {busy ? "Генерирую…" : "Сгенерировать"}
              </button>
            </div>
          </div>

          {(resultText || images.length > 0) && (
            <div className="card p-5">
              <h3 className="font-display text-xl mb-3 flex items-center gap-2">
                <Sparkles size={16} className="text-oak" />
                Результат
              </h3>
              {images.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 mb-4">
                  {images.map((src, i) => (
                    <a key={i} href={src} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden border border-line bg-paper">
                      <img src={src} alt={`Рендер ${i + 1}`} className="w-full h-56 object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {resultText && <p className="text-sm leading-relaxed whitespace-pre-wrap">{resultText}</p>}
            </div>
          )}
        </div>

        <div className="space-y-3 min-w-0">
          <h3 className="font-display text-xl">История</h3>
          {history.length === 0 && <div className="card p-6 text-sm text-dim text-center">Прошлые генерации появятся здесь.</div>}
          {history.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-start gap-2">
                <p className="text-[13px] leading-snug flex-1 min-w-0">{r.prompt}</p>
                <button className="p-1 rounded-md text-dim hover:text-red-700 hover:bg-red-50 transition-colors shrink-0" onClick={() => removeRecord(r)}>
                  <Trash2 size={13} />
                </button>
              </div>
              {r.image_urls?.length > 0 && (
                <div className="flex gap-1.5 mt-2">
                  {r.image_urls.slice(0, 3).map((src, i) => (
                    <a key={i} href={src} target="_blank" rel="noreferrer" className="block w-16 h-16 rounded-lg overflow-hidden border border-line">
                      <img src={src} alt="" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {!r.image_urls?.length && r.result_text && (
                <p className="text-[11px] text-dim mt-1.5 line-clamp-2 flex items-start gap-1">
                  <ImageIcon size={11} className="mt-0.5 shrink-0" />
                  {r.result_text}
                </p>
              )}
              <p className="text-[11px] text-dim mt-2">{fmtDate(r.created_at)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
