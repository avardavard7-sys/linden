"use client";

import { useEffect, useState } from "react";
import { BookOpenText, Building2, Database, Factory, Eye, EyeOff, FileCog, FileUp, GraduationCap, KeyRound, Plug, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import { useToast } from "@/components/Toast";
import { fmtDate, num } from "@/lib/calc";
import { fileToParts } from "@/lib/files";
import { identityFromSession } from "@/lib/identity";
import { supabase } from "@/lib/supabase";
import type { AiKnowledge, CompanyInfo, Integration, PriceItem, Settings } from "@/lib/types";
import { DEFAULT_STANDARDS, type CompanyStandards } from "@/lib/prompts";

const AI_LEVELS = [
  { value: "claude-fable-5", label: "Высокое" },
  { value: "claude-opus-4-8", label: "Среднее" },
  { value: "claude-sonnet-4-6", label: "Низкое" }
];
const CURRENCIES = ["₸", "₽", "$", "€"];

export default function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [passBusy, setPassBusy] = useState(false);
  const [knowledge, setKnowledge] = useState<AiKnowledge[]>([]);
  const [kTitle, setKTitle] = useState("");
  const [kContent, setKContent] = useState("");
  const [kBusy, setKBusy] = useState(false);
  const [kFileBusy, setKFileBusy] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [dbUrl, setDbUrl] = useState("");
  const [std, setStd] = useState<CompanyStandards>(DEFAULT_STANDARDS);
  const [prices, setPrices] = useState<Pick<PriceItem, "id" | "name" | "category">[]>([]);

  useEffect(() => {
    let alive = true;
    supabase
      .from("app_settings")
      .select("*")
      .eq("id", 1)
      .single()
      .then(({ data }) => {
        if (alive && data) {
          setS(data as Settings);
          const raw = (data as any).standards;
          if (raw && typeof raw === "object") setStd({ ...DEFAULT_STANDARDS, ...raw });
        }
      });
    supabase.auth.getSession().then(({ data }) => {
      if (!alive || !data.session) return;
      if (identityFromSession(data.session).role === "owner") {
        setIsOwner(true);
        supabase
          .from("app_secrets")
          .select("db_url")
          .eq("id", 1)
          .single()
          .then(({ data: row }) => {
            if (alive && row) setDbUrl(String(row.db_url ?? ""));
          });
      }
    });
    supabase
      .from("price_items")
      .select("id,name,category")
      .eq("is_active", true)
      .order("category")
      .limit(400)
      .then(({ data }) => {
        if (alive) setPrices((data ?? []) as Pick<PriceItem, "id" | "name" | "category">[]);
      });
    supabase
      .from("ai_knowledge")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (alive) setKnowledge((data ?? []) as AiKnowledge[]);
      });
    return () => {
      alive = false;
    };
  }, []);

  function patch(fn: (x: Settings) => Settings) {
    setS((prev) => (prev ? fn({ ...prev, company: { ...prev.company }, integrations: prev.integrations.map((i) => ({ ...i })) }) : prev));
  }

  function patchCompany(key: keyof CompanyInfo, value: string) {
    patch((x) => ({ ...x, company: { ...x.company, [key]: value } }));
  }

  function patchIntegration(index: number, next: Partial<Integration>) {
    patch((x) => ({ ...x, integrations: x.integrations.map((i, idx) => (idx === index ? { ...i, ...next } : i)) }));
  }

  async function saveAll() {
    if (!s) return;
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .update({
        company: s.company,
        currency: s.currency,
        vat_rate: num(s.vat_rate),
        vat_included: s.vat_included,
        default_markup: num(s.default_markup),
        prepayment_percent: num(s.prepayment_percent),
        production_days: num(s.production_days),
        warranty_months: num(s.warranty_months),
        anthropic_api_key: s.anthropic_api_key.trim(),
        standards: std,
        ai_model: s.ai_model,
        integrations: s.integrations
      })
      .eq("id", 1);
    setSaving(false);
    if (error) {
      toast("Не удалось сохранить настройки.", "error");
      return;
    }
    if (isOwner) {
      await supabase.from("app_secrets").upsert({ id: 1, db_url: dbUrl.trim() });
    }
    toast("Настройки сохранены.", "ok");
  }

  async function changePassword() {
    if (pass1.length < 8) {
      toast("Пароль должен быть не короче 8 символов.", "info");
      return;
    }
    if (pass1 !== pass2) {
      toast("Пароли не совпадают.", "info");
      return;
    }
    setPassBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pass1 });
    setPassBusy(false);
    if (error) {
      toast("Не удалось сменить пароль.", "error");
      return;
    }
    setPass1("");
    setPass2("");
    toast("Пароль обновлён.", "ok");
  }

  async function addKnowledge() {
    const title = kTitle.trim();
    const content = kContent.trim();
    if (!title || !content) {
      toast("Заполните название и текст обучения.", "info");
      return;
    }
    setKBusy(true);
    const { data: sess } = await supabase.auth.getSession();
    const identity = sess.session ? identityFromSession(sess.session) : null;
    const { data, error } = await supabase
      .from("ai_knowledge")
      .insert({
        title: title.slice(0, 160),
        content: content.slice(0, 20000),
        author_name: identity?.name ?? "",
        author_employee: identity?.employeeId ?? null
      })
      .select("*")
      .single();
    setKBusy(false);
    if (error || !data) {
      toast("Не удалось сохранить.", "error");
      return;
    }
    setKnowledge((prev) => [data as AiKnowledge, ...prev]);
    setKTitle("");
    setKContent("");
    toast("Система обучена: знание добавлено и будет учитываться в каждом расчёте.", "ok");
  }

  async function removeKnowledge(k: AiKnowledge) {
    if (!confirm(`Удалить знание «${k.title}»? Оно полностью исчезнет и больше не будет использоваться в расчётах.`)) return;
    const { error } = await supabase.from("ai_knowledge").delete().eq("id", k.id);
    if (error) {
      toast("Не удалось удалить.", "error");
      return;
    }
    setKnowledge((prev) => prev.filter((x) => x.id !== k.id));
    toast("Знание удалено и исключено из расчётов.", "ok");
  }

  async function pickKnowledgeFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setKFileBusy(true);
    try {
      const parts = await fileToParts(file);
      const text = parts
        .filter((p) => p.kind === "text")
        .map((p: any) => p.text)
        .join("\n\n")
        .trim();
      if (!text) throw new Error("Для обучения подходят текстовые файлы: Word, Excel, CSV, TXT. Из PDF и фото скопируйте текст вручную.");
      setKContent((prev) => (prev.trim() ? prev + "\n\n" : "") + text.slice(0, 20000));
      if (!kTitle.trim()) setKTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 160));
      toast("Файл прочитан - проверьте текст и нажмите «Обучить».", "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Не удалось прочитать файл.", "error");
    } finally {
      setKFileBusy(false);
    }
  }

  if (!s) {
    return (
      <div className="flex items-center justify-center py-32">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div className="fade-up max-w-4xl">
      <PageTitle
        title="Настройки"
        subtitle="Реквизиты компании, параметры документов, ключ ИИ и интеграции."
        right={
          <button className="btn-primary" onClick={saveAll} disabled={saving}>
            {saving ? <span className="spinner" /> : <Save size={15} />}
            Сохранить
          </button>
        }
      />

      <div className="space-y-6">
        <section className="card p-5">
          <h3 className="font-display text-xl mb-4 flex items-center gap-2">
            <Building2 size={17} className="text-oak" />
            Компания
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Название</label>
              <input className="input" value={s.company.name} onChange={(e) => patchCompany("name", e.target.value)} />
            </div>
            <div>
              <label className="label">Город</label>
              <input className="input" value={s.company.city} onChange={(e) => patchCompany("city", e.target.value)} />
            </div>
            <div>
              <label className="label">Руководитель (ФИО)</label>
              <input className="input" value={s.company.director} onChange={(e) => patchCompany("director", e.target.value)} />
            </div>
            <div>
              <label className="label">Должность</label>
              <input className="input" value={s.company.position} onChange={(e) => patchCompany("position", e.target.value)} />
            </div>
            <div>
              <label className="label">БИН / ИИН</label>
              <input className="input num" value={s.company.bin} onChange={(e) => patchCompany("bin", e.target.value)} />
            </div>
            <div>
              <label className="label">Телефон</label>
              <input className="input num" value={s.company.phone} onChange={(e) => patchCompany("phone", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Адрес</label>
              <input className="input" value={s.company.address} onChange={(e) => patchCompany("address", e.target.value)} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" value={s.company.email} onChange={(e) => patchCompany("email", e.target.value)} />
            </div>
            <div>
              <label className="label">Банк</label>
              <input className="input" value={s.company.bank} onChange={(e) => patchCompany("bank", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Расчётный счёт (IBAN)</label>
              <input className="input num" value={s.company.account} onChange={(e) => patchCompany("account", e.target.value)} />
            </div>
          </div>
        </section>

        <section className="card p-5">
          <h3 className="font-display text-xl mb-4 flex items-center gap-2">
            <FileCog size={17} className="text-oak" />
            Документы и расчёты
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Валюта</label>
              <select className="input" value={s.currency} onChange={(e) => patch((x) => ({ ...x, currency: e.target.value }))}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Ставка НДС, %</label>
              <input className="input num" inputMode="decimal" value={s.vat_rate} onChange={(e) => patch((x) => ({ ...x, vat_rate: num(e.target.value) }))} />
            </div>
            <div className="flex items-end pb-2.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-[#B67F2E] h-4 w-4"
                  checked={s.vat_included}
                  onChange={(e) => patch((x) => ({ ...x, vat_included: e.target.checked }))}
                />
                НДС включён в цену
              </label>
            </div>
            <div>
              <label className="label">Наценка по умолчанию, %</label>
              <input
                className="input num"
                inputMode="decimal"
                value={s.default_markup}
                onChange={(e) => patch((x) => ({ ...x, default_markup: num(e.target.value) }))}
              />
            </div>
            <div>
              <label className="label">Предоплата, %</label>
              <input
                className="input num"
                inputMode="decimal"
                value={s.prepayment_percent}
                onChange={(e) => patch((x) => ({ ...x, prepayment_percent: num(e.target.value) }))}
              />
            </div>
            <div>
              <label className="label">Срок изготовления, раб. дней</label>
              <input
                className="input num"
                inputMode="numeric"
                value={s.production_days}
                onChange={(e) => patch((x) => ({ ...x, production_days: num(e.target.value) }))}
              />
            </div>
            <div>
              <label className="label">Гарантия, месяцев</label>
              <input
                className="input num"
                inputMode="numeric"
                value={s.warranty_months}
                onChange={(e) => patch((x) => ({ ...x, warranty_months: num(e.target.value) }))}
              />
            </div>
          </div>
        </section>

        <section className="card p-5">
          <h3 className="font-display text-xl mb-1 flex items-center gap-2">
            <KeyRound size={17} className="text-oak" />
            Искусственный интеллект
          </h3>
          <p className="text-sm text-dim mb-4">
            Ключ доступа к ИИ хранится в вашей базе. Без него не работают авторасчёт, разбор прайса и дизайн‑студия.
          </p>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <div>
              <label className="label">API‑ключ</label>
              <div className="relative">
                <input
                  className="input pr-10 num"
                  type={showKey ? "text" : "password"}
                  value={s.anthropic_api_key}
                  onChange={(e) => patch((x) => ({ ...x, anthropic_api_key: e.target.value }))}
                  placeholder="ключ доступа"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-dim hover:text-ink"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <div>
              <label className="label">Качество анализа</label>
              <select className="input" value={s.ai_model} onChange={(e) => patch((x) => ({ ...x, ai_model: e.target.value }))}>
                {AI_LEVELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="card p-5">
          <h3 className="font-display text-xl mb-1 flex items-center gap-2">
            <Plug size={17} className="text-oak" />
            Интеграции MCP
          </h3>
          <p className="text-sm text-dim mb-4">
            Подключайте генераторы 3D и визуализаций. Для Higgsfield адрес уже заполнен — вставьте токен из личного кабинета и включите
            переключатель. Можно добавить и другие серверы, например Blender MCP.
          </p>
          <div className="space-y-3">
            {s.integrations.map((it, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center">
                <input className="input py-2 text-sm" value={it.name} placeholder="имя" onChange={(e) => patchIntegration(i, { name: e.target.value })} />
                <input className="input py-2 text-sm num" value={it.url} placeholder="https://…/mcp" onChange={(e) => patchIntegration(i, { url: e.target.value })} />
                <input
                  className="input py-2 text-sm num"
                  type="password"
                  value={it.token}
                  placeholder="токен (если нужен)"
                  autoComplete="off"
                  onChange={(e) => patchIntegration(i, { token: e.target.value })}
                />
                <label className="flex items-center gap-1.5 text-sm cursor-pointer justify-self-start">
                  <input
                    type="checkbox"
                    className="accent-[#B67F2E] h-4 w-4"
                    checked={it.enabled}
                    onChange={(e) => patchIntegration(i, { enabled: e.target.checked })}
                  />
                  вкл
                </label>
                <button
                  className="p-1.5 rounded-md text-dim hover:text-red-700 hover:bg-red-50 transition-colors justify-self-end"
                  onClick={() => patch((x) => ({ ...x, integrations: x.integrations.filter((_, idx) => idx !== i) }))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="btn-ghost text-xs mt-3"
            onClick={() => patch((x) => ({ ...x, integrations: [...x.integrations, { name: "", url: "", token: "", enabled: false }] }))}
          >
            <Plus size={13} />
            Добавить сервер
          </button>
        </section>

        {isOwner && (
        <section className="card p-5">
          <h3 className="font-display text-xl mb-1 flex items-center gap-2">
            <Database size={17} className="text-oak" />
            Подключить базу данных
          </h3>
          <p className="text-sm text-dim mb-4">
            Строка подключения Supabase даёт разделу «Разработчик» право самому создавать таблицы и колонки: когда новая функция требует изменений в базе, они применяются автоматически. Где взять: Supabase → Project Settings → Database → Connection string → URI (пулер, порт 6543), подставьте пароль базы.
          </p>
          <label className="label">Строка подключения (postgresql://…)</label>
          <input
            className="input num text-[12px]"
            type="password"
            placeholder="postgresql://postgres.xxxx:пароль@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
            value={dbUrl}
            onChange={(e) => setDbUrl(e.target.value)}
          />
        </section>
        )}

        <section className="card p-5">
          <h3 className="font-display text-xl mb-1 flex items-center gap-2">
            <Factory size={17} className="text-oak" />
            Стандарты производства
          </h3>
          <p className="text-sm text-dim mb-4">
            Что компания ставит по умолчанию, когда проект не указывает иного. Эти правила применяются в каждом расчёте и защищают от завышения: без них система выбирает материалы наугад.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["corpus", "Корпус"],
                ["backwall", "Задняя стенка"],
                ["hinges", "Навесы (петли)"],
                ["drawers", "Выдвижные ящики"],
                ["lighting", "Подсветка"]
              ] as Array<[keyof CompanyStandards, string]>
            ).map(([key, label]) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input
                  className="input text-[13px]"
                  list={`price-${key}`}
                  value={String(std[key] ?? "")}
                  onChange={(e) => setStd({ ...std, [key]: e.target.value })}
                />
                <datalist id={`price-${key}`}>
                  {prices.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
              </div>
            ))}
            <div>
              <label className="label">Кухня — всегда закладывать</label>
              <input
                className="input text-[13px]"
                value={std.kitchen_always}
                onChange={(e) => setStd({ ...std, kitchen_always: e.target.value })}
                placeholder="бутылочница с наполнением"
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 mt-4">
            <label className="flex items-start gap-2.5 rounded-xl border border-line p-3 cursor-pointer hover:border-oak/60 transition-colors">
              <input
                type="checkbox"
                className="accent-[#B67F2E] h-4 w-4 mt-0.5"
                checked={std.sinks_from_client}
                onChange={(e) => setStd({ ...std, sinks_from_client: e.target.checked })}
              />
              <span className="text-[13px] leading-snug">
                <span className="font-semibold">Мойки — от клиента</span>
                <span className="block text-dim text-xs">Не включать в расчёт, писать в спецификации «от клиента»</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 rounded-xl border border-line p-3 cursor-pointer hover:border-oak/60 transition-colors">
              <input
                type="checkbox"
                className="accent-[#B67F2E] h-4 w-4 mt-0.5"
                checked={std.countertops_included}
                onChange={(e) => setStd({ ...std, countertops_included: e.target.checked })}
              />
              <span className="text-[13px] leading-snug">
                <span className="font-semibold">Столешницы считаем мы</span>
                <span className="block text-dim text-xs">Снимите галочку, если столешницы всегда от клиента</span>
              </span>
            </label>
          </div>
          <div className="mt-3">
            <label className="label">Дополнительное правило (необязательно)</label>
            <input
              className="input text-[13px]"
              value={std.notes}
              onChange={(e) => setStd({ ...std, notes: e.target.value })}
              placeholder="Например: фасады радиусных элементов считать с наценкой за сложность"
            />
          </div>
          <p className="text-xs text-dim mt-3">
            Материал фасада намеренно не задан: в разных проектах он разный (плёнка, краска, шпон) и зависит от бюджета клиента. Задавайте его в комментарии перед расчётом.
          </p>
        </section>

        <section className="card p-5">
          <h3 className="font-display text-xl mb-1 flex items-center gap-2">
            <GraduationCap size={17} className="text-oak" />
            Обучить систему
          </h3>
          <p className="text-sm text-dim mb-4">
            Добавляйте правила, формулы и примеры - словами или из файла. Знания дополняют методику расчёта и учитываются в каждом КП, не меняя сам способ анализа. Удалённое знание исчезает полностью и больше не используется. Раздел можно оставить пустым.
          </p>
          <div className="grid gap-3">
            <input className="input" placeholder="Название: например, «Расход кромки для фасадов с фрезеровкой»" value={kTitle} onChange={(e) => setKTitle(e.target.value)} />
            <textarea
              className="input min-h-[110px] text-sm leading-relaxed"
              placeholder="Опишите правило или формулу: «Для угловых кухонь добавляй 15% к расходу ЛДСП», «Столешницы из кварца всегда считай с запасом 100 мм на подрезку»…"
              value={kContent}
              onChange={(e) => setKContent(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={addKnowledge} disabled={kBusy}>
                {kBusy ? <span className="spinner" /> : <GraduationCap size={15} />}
                Обучить
              </button>
              <label className="btn cursor-pointer">
                {kFileBusy ? <span className="spinner" /> : <FileUp size={15} />}
                Из файла
                <input type="file" className="hidden" accept=".txt,.md,.csv,.docx,.xlsx,.xls" onChange={pickKnowledgeFile} />
              </label>
            </div>
          </div>
          {knowledge.length > 0 && (
            <div className="mt-5 border-t border-line pt-4 space-y-2">
              <p className="label !mb-2 flex items-center gap-1.5">
                <BookOpenText size={13} />
                Чему обучена система · {knowledge.length}
              </p>
              {knowledge.map((k) => (
                <details key={k.id} className="rounded-xl border border-line bg-paper/60 px-4 py-2.5">
                  <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate">{k.title}</span>
                    <span className="text-[11px] text-dim font-normal shrink-0">
                      {k.author_name || "-"} · {fmtDate(k.created_at)}
                    </span>
                    <span
                      className="p-1 rounded-md text-dim hover:text-red-700 hover:bg-red-50 transition-colors shrink-0"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeKnowledge(k);
                      }}
                    >
                      <Trash2 size={13} />
                    </span>
                  </summary>
                  <p className="text-xs text-dim whitespace-pre-wrap mt-2 leading-relaxed">{k.content.slice(0, 3000)}</p>
                </details>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h3 className="font-display text-xl mb-4 flex items-center gap-2">
            <ShieldCheck size={17} className="text-oak" />
            Безопасность
          </h3>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end">
            <div>
              <label className="label">Новый пароль</label>
              <input className="input" type="password" value={pass1} autoComplete="new-password" onChange={(e) => setPass1(e.target.value)} />
            </div>
            <div>
              <label className="label">Повторите пароль</label>
              <input className="input" type="password" value={pass2} autoComplete="new-password" onChange={(e) => setPass2(e.target.value)} />
            </div>
            <button className="btn" onClick={changePassword} disabled={passBusy}>
              {passBusy ? <span className="spinner" /> : <KeyRound size={15} />}
              Сменить пароль
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
