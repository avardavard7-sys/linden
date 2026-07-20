"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, FileUp, Gauge, PlusCircle, Sparkles, Trash2 } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import { useToast } from "@/components/Toast";
import { parseProjectFile } from "@/lib/ai";
import { identityFromSession } from "@/lib/identity";
import { ITEM_COLORS, plural, uid } from "@/lib/calc";
import { expandFiles, type SourceDoc } from "@/lib/files";
import { uploadItemImage } from "@/lib/images";
import { openPdf, renderPageJpeg } from "@/lib/pdf";
import { supabase } from "@/lib/supabase";
import type { PriceItem, ProjectItem } from "@/lib/types";

const STAGES = [
  "Готовлю файлы: распаковка и страницы…",
  "Читаю проект и визуализации…",
  "Сопоставляю позиции с прайсом…",
  "Считаю материалы и фурнитуру…",
  "Формирую смету и подтягиваю изображения…"
];

export default function HomePage() {
  const router = useRouter();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [managerNote, setManagerNote] = useState("");
  const [stage, setStage] = useState(0);
  const [stats, setStats] = useState<{ prices: number; active: number } | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [attempts, setAttempts] = useState<{ limit: number | null; used: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const attemptsLeft = attempts && attempts.limit != null ? Math.max(0, attempts.limit - attempts.used) : null;
  const exhausted = attemptsLeft === 0;

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("price_items").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("projects").select("id", { count: "exact", head: true }).in("status", ["approved", "production"])
    ]).then(([p, pr]) => {
      if (alive) setStats({ prices: p.count ?? 0, active: pr.count ?? 0 });
    });
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive || !data.session) return;
      if (identityFromSession(data.session).role !== "staff") return;
      setIsStaff(true);
      const { data: st } = await supabase.rpc("attempts_status");
      if (alive && st && typeof st === "object") {
        const s = st as { limit?: number | null; used?: number };
        setAttempts({ limit: s.limit ?? null, used: Number(s.used ?? 0) });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 6000);
    return () => clearInterval(t);
  }, [busy]);

  const pick = useCallback((list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    setFiles((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
      }
      return next.slice(0, 12);
    });
  }, []);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  async function createEmpty() {
    const { data: sess } = await supabase.auth.getSession();
    const identity = sess.session ? identityFromSession(sess.session) : null;
    const { data, error } = await supabase
      .from("projects")
      .insert({
        name: projectName.trim() || "Новый проект",
        client_name: clientName.trim(),
        client_phone: clientPhone.trim(),
        author_name: identity?.name ?? "",
        author_employee: identity?.employeeId ?? null
      })
      .select("id")
      .single();
    if (error || !data) {
      toast("Не удалось создать проект.", "error");
      return;
    }
    router.push(`/projects/${data.id}`);
  }

  async function attachImages(
    projectId: string,
    items: ProjectItem[],
    parsedItems: Array<{ image_ref: { file: number; page: number } | null }>,
    sources: SourceDoc[]
  ): Promise<number> {
    const bySource = new Map(sources.map((sd) => [sd.index, sd]));
    const docCache = new Map<number, Awaited<ReturnType<typeof openPdf>>>();
    let attached = 0;
    try {
      for (let i = 0; i < items.length; i++) {
        const ref = parsedItems[i]?.image_ref;
        if (!ref) continue;
        const source = bySource.get(ref.file);
        if (!source) continue;
        try {
          let uploadFile: File | null = null;
          if (source.kind === "image") {
            uploadFile = source.file;
          } else if (source.kind === "pdf") {
            const page = Math.min(Math.max(1, ref.page), source.pages);
            let doc = docCache.get(ref.file);
            if (!doc) {
              doc = await openPdf(source.file);
              docCache.set(ref.file, doc);
            }
            const { blob } = await renderPageJpeg(doc, page, 1600, 0.85);
            uploadFile = new File([blob], `page-${page}.jpg`, { type: "image/jpeg" });
          }
          if (!uploadFile) continue;
          const url = await uploadItemImage(projectId, items[i].id, uploadFile);
          items[i].image_url = url;
          attached++;
        } catch {
          continue;
        }
      }
    } finally {
      for (const doc of docCache.values()) {
        await doc.destroy().catch(() => undefined);
      }
    }
    return attached;
  }

  async function calculate() {
    if (files.length === 0) return;
    setBusy(true);
    let consumed = false;
    try {
      if (isStaff) {
        const { data: rem, error: quotaError } = await supabase.rpc("consume_attempt");
        if (quotaError) throw new Error("Не удалось проверить лимит попыток. Попробуйте ещё раз.");
        const remaining = Number(rem);
        if (remaining === -2) {
          setAttempts((prev) => (prev && prev.limit != null ? { ...prev, used: prev.limit } : prev));
          throw new Error("Попытки закончились. Обратитесь к руководителю.");
        }
        if (remaining >= 0) {
          consumed = true;
          setAttempts((prev) => (prev && prev.limit != null ? { limit: prev.limit, used: prev.limit - remaining } : prev));
        }
      }
      const { parts, sources, skipped } = await expandFiles(files);
      if (skipped.length) toast(`Пропущено: ${skipped.slice(0, 3).join("; ")}${skipped.length > 3 ? "…" : ""}`, "info");
      const { data: prices } = await supabase
        .from("price_items")
        .select("id,name,item_type,unit,price")
        .eq("is_active", true)
        .order("item_type")
        .limit(800);
      const priceList = ((prices ?? []) as Pick<PriceItem, "id" | "name" | "item_type" | "unit" | "price">[])
        .map((p) => `${p.id} | ${p.item_type} | ${p.name} | ${p.unit} | ${p.price}`)
        .join("\n");
      const parsed = await parseProjectFile(parts, priceList, managerNote);
      const items: ProjectItem[] = parsed.items.map((it, i) => ({
        id: uid(),
        name: it.name,
        room: it.room,
        width: it.width,
        height: it.height,
        depth: it.depth,
        qty: it.qty,
        color: ITEM_COLORS[i % ITEM_COLORS.length],
        spec: it.spec || "",
        image_url: "",
        price_from: false,
        components: it.components.map((c) => ({ id: uid(), ...c }))
      }));
      const { data: settings } = await supabase.from("app_settings").select("default_markup,vat_rate,vat_included").eq("id", 1).single();
      const { data: sess } = await supabase.auth.getSession();
      const identity = sess.session ? identityFromSession(sess.session) : null;
      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: projectName.trim() || parsed.name,
          client_name: clientName.trim() || parsed.client.name,
          client_phone: clientPhone.trim() || parsed.client.phone,
          client_email: parsed.client.email,
          client_company: parsed.client.company,
          area: parsed.area,
          items,
          markup: settings?.default_markup ?? 30,
          vat_rate: settings?.vat_rate ?? 12,
          vat_included: settings?.vat_included ?? true,
          source_file_name: files.map((f) => f.name).join(", ").slice(0, 300),
          ai_summary: parsed.summary,
          assumptions: parsed.assumptions,
          notes: managerNote.trim() ? `Комментарий менеджера перед расчётом: ${managerNote.trim()}` : "",
          author_name: identity?.name ?? "",
          author_employee: identity?.employeeId ?? null
        })
        .select("id")
        .single();
      if (error || !data) throw new Error("Не удалось сохранить проект.");
      const withImages = await attachImages(data.id, items, parsed.items, sources);
      if (withImages > 0) {
        await supabase.from("projects").update({ items }).eq("id", data.id);
      }
      toast(`Расчёт готов: ${items.length} позиций${withImages ? `, изображений: ${withImages}` : ""}.`, "ok");
      router.push(`/projects/${data.id}`);
    } catch (e) {
      if (consumed) {
        supabase.rpc("refund_attempt").then(
          () => undefined,
          () => undefined
        );
        setAttempts((prev) => (prev && prev.limit != null ? { ...prev, used: Math.max(0, prev.used - 1) } : prev));
      }
      toast(e instanceof Error ? e.message : "Ошибка расчёта.", "error");
      setBusy(false);
    }
  }

  return (
    <div className="fade-up">
      <PageTitle
        title="Новый расчёт"
        subtitle="Загрузите дизайн-проект или заявку клиента — система сопоставит её с прайсом и подготовит смету с полным пакетом документов."
      />
      <div className="grid lg:grid-cols-[1fr,340px] gap-6 items-start">
        <div className="space-y-5">
          <div
            className={`card p-8 sm:p-10 text-center border-2 border-dashed transition-colors cursor-pointer ${
              drag ? "border-oak bg-oaklight/40" : "border-linehard/70 hover:border-oak/60"
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept=".xlsx,.xls,.csv,.docx,.pdf,.png,.jpg,.jpeg,.webp,.txt,.zip"
              onChange={(e) => {
                pick(e.target.files);
                e.target.value = "";
              }}
            />
            {files.length > 0 ? (
              <div className="text-left space-y-2" onClick={(e) => e.stopPropagation()}>
                {files.map((f, i) => (
                  <div key={`${f.name}-${f.size}`} className="flex items-center gap-3 rounded-xl border border-line bg-paper/60 px-3 py-2">
                    <FileText className="text-oak shrink-0" size={20} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">{f.name}</div>
                      <div className="text-[11px] text-dim num">{(f.size / 1024 / 1024).toFixed(1)} МБ</div>
                    </div>
                    <button
                      className="p-1.5 rounded-lg hover:bg-line/60"
                      onClick={() => removeFile(i)}
                      aria-label="Убрать файл"
                    >
                      <Trash2 size={15} className="text-dim" />
                    </button>
                  </div>
                ))}
                <button className="btn-ghost w-full !py-2 text-xs" onClick={() => inputRef.current?.click()}>
                  <FileUp size={13} />
                  Добавить ещё файлы
                </button>
              </div>
            ) : (
              <>
                <FileUp size={30} className="mx-auto text-oak mb-3" />
                <div className="font-semibold mb-1">Перетащите файлы проекта или нажмите для выбора</div>
                <div className="text-xs text-dim">Можно несколько сразу: рабочий проект + визуализации · PDF до 220 МБ · ZIP · Excel · Word · фото</div>
              </>
            )}
          </div>

          <div className="card p-5 sm:p-6">
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="label">Название проекта</label>
                <input className="input" placeholder="Кухня, ул. Кабанбай батыра" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </div>
              <div>
                <label className="label">Клиент</label>
                <input className="input" placeholder="Имя или компания" value={clientName} onChange={(e) => setClientName(e.target.value)} />
              </div>
              <div>
                <label className="label">Телефон</label>
                <input className="input" placeholder="+7 ___ ___ __ __" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
              </div>
            </div>
            <div className="mt-4">
              <label className="label">Комментарий менеджера (необязательно)</label>
              <textarea
                className="input min-h-[76px] text-sm leading-relaxed"
                value={managerNote}
                onChange={(e) => setManagerNote(e.target.value)}
                placeholder="Пожелания к расчёту: какой формулой считать, что учесть, на что обратить внимание. Можно оставить пустым - система выполнит полный разбор самостоятельно."
              />
            </div>
            {isStaff && attempts && attempts.limit != null && (
              exhausted ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2.5">
                  <Gauge size={16} className="shrink-0" />
                  Попытки закончились. Обратитесь к руководителю, чтобы получить новые.
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-oak/50 bg-oaklight/40 px-4 py-2.5 text-xs flex items-center gap-2">
                  <Gauge size={14} className="text-oak shrink-0" />
                  <span>
                    У вас {attemptsLeft === attempts.limit ? "есть" : "осталось"}{" "}
                    <span className="num font-semibold">{attemptsLeft}</span>{" "}
                    {plural(attemptsLeft ?? 0, ["попытка", "попытки", "попыток"])} расчёта из {attempts.limit}.
                  </span>
                </div>
              )
            )}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button className="btn-primary" onClick={calculate} disabled={files.length === 0 || busy || (isStaff && exhausted)}>
                {busy ? <span className="spinner" /> : <Sparkles size={16} />}
                {busy ? STAGES[stage] : "Рассчитать стоимость"}
              </button>
              <button className="btn-ghost" onClick={createEmpty} disabled={busy}>
                <PlusCircle size={16} />
                Создать пустой проект
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <div className="label mb-3">Как это работает</div>
            {[
              ["01", "Загрузите файл", "Дизайн-проект, спецификация или заявка в любом формате."],
              ["02", "Система считает", "ИИ подбирает материалы и работы из вашего прайса, выводит формулы расчёта."],
              ["03", "Скачайте документы", "КП, договор, чек-лист производства и акт — в Word одним нажатием."]
            ].map(([n, t, d]) => (
              <div key={n} className="flex gap-3.5 py-2.5 border-b border-line last:border-0">
                <span className="num text-oak text-sm pt-0.5">{n}</span>
                <div>
                  <div className="text-sm font-semibold">{t}</div>
                  <div className="text-xs text-dim leading-relaxed">{d}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="card p-5 grid grid-cols-2 gap-4">
            <div>
              <div className="num text-2xl">{stats ? stats.prices : "—"}</div>
              <div className="text-xs text-dim">позиций в прайсе</div>
            </div>
            <div>
              <div className="num text-2xl">{stats ? stats.active : "—"}</div>
              <div className="text-xs text-dim">проектов в работе</div>
            </div>
            <a href="/prices" className="col-span-2 text-xs text-oak font-semibold inline-flex items-center gap-1 hover:underline">
              Обновить прайс-лист <ArrowRight size={13} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
