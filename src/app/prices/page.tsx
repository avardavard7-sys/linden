"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileUp, History, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import { useToast } from "@/components/Toast";
import { parsePriceFile, type ParsedPriceItem } from "@/lib/ai";
import { fmt, fmtDate, money, num } from "@/lib/calc";
import { fileToParts } from "@/lib/files";
import { supabase } from "@/lib/supabase";
import type { ItemType, PriceHistoryRecord, PriceItem } from "@/lib/types";

const TYPE_LABEL: Record<ItemType, string> = { material: "Материалы", fitting: "Фурнитура", labor: "Работы" };

type Diff = {
  added: Array<{ data: ParsedPriceItem; checked: boolean }>;
  changed: Array<{ item: PriceItem; next: ParsedPriceItem; checked: boolean }>;
  missing: Array<{ item: PriceItem; checked: boolean }>;
  same: number;
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export default function PricesPage() {
  const toast = useToast();
  const [items, setItems] = useState<PriceItem[]>([]);
  const [currency, setCurrency] = useState("₸");
  const [tab, setTab] = useState<ItemType | "all">("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", category: "", item_type: "material" as ItemType, unit: "м²", price: "" });
  const [importBusy, setImportBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [historyFor, setHistoryFor] = useState<PriceItem | null>(null);
  const [history, setHistory] = useState<PriceHistoryRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [{ data }, { data: s }] = await Promise.all([
      supabase.from("price_items").select("*").eq("is_active", true).order("item_type").order("category").order("name"),
      supabase.from("app_settings").select("currency").eq("id", 1).single()
    ]);
    setItems((data ?? []) as PriceItem[]);
    if (s?.currency) setCurrency(s.currency);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = normalize(query);
    return items.filter((i) => {
      if (tab !== "all" && i.item_type !== tab) return false;
      if (!q) return true;
      return normalize(`${i.name} ${i.category}`).includes(q);
    });
  }, [items, tab, query]);

  async function updatePrice(item: PriceItem, next: number) {
    if (Math.abs(next - num(item.price)) < 0.005) return;
    const { error } = await supabase.from("price_items").update({ price: next }).eq("id", item.id);
    if (error) {
      toast("Не удалось обновить цену.", "error");
      return;
    }
    await supabase.from("price_history").insert({ price_item_id: item.id, item_name: item.name, old_price: item.price, new_price: next, source: "manual" });
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, price: next } : i)));
    toast("Цена обновлена.", "ok");
  }

  async function updateField(item: PriceItem, field: "name" | "unit" | "category", value: string) {
    if (value === String(item[field])) return;
    const { error } = await supabase.from("price_items").update({ [field]: value }).eq("id", item.id);
    if (!error) setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, [field]: value } : i)));
  }

  async function removeItem(item: PriceItem) {
    if (!confirm(`Удалить «${item.name}» из прайса?`)) return;
    const { error } = await supabase.from("price_items").delete().eq("id", item.id);
    if (error) {
      toast("Не удалось удалить позицию.", "error");
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast("Позиция удалена.", "ok");
  }

  async function addDraft() {
    const price = num(draft.price);
    if (!draft.name.trim() || price <= 0) {
      toast("Укажите название и цену.", "error");
      return;
    }
    const { data, error } = await supabase
      .from("price_items")
      .insert({
        name: draft.name.trim(),
        category: draft.category.trim() || TYPE_LABEL[draft.item_type],
        item_type: draft.item_type,
        unit: draft.unit.trim() || "шт",
        price
      })
      .select("*")
      .single();
    if (error || !data) {
      toast("Не удалось добавить позицию.", "error");
      return;
    }
    setItems((prev) => [...prev, data as PriceItem]);
    setDraft({ name: "", category: "", item_type: draft.item_type, unit: draft.unit, price: "" });
    setAdding(false);
    toast("Позиция добавлена в прайс.", "ok");
  }

  async function importFile(file: File) {
    setImportBusy(true);
    try {
      const parts = await fileToParts(file);
      const { items: incoming } = await parsePriceFile(parts);
      if (!incoming.length) throw new Error("В файле не найдено позиций с ценами.");
      const map = new Map(items.map((i) => [normalize(i.name), i]));
      const seen = new Set<string>();
      const d: Diff = { added: [], changed: [], missing: [], same: 0 };
      for (const inc of incoming) {
        const key = normalize(inc.name);
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = map.get(key);
        if (!existing) d.added.push({ data: inc, checked: true });
        else if (Math.abs(num(existing.price) - num(inc.price)) > 0.009) d.changed.push({ item: existing, next: inc, checked: true });
        else d.same += 1;
      }
      for (const item of items) {
        if (!seen.has(normalize(item.name))) d.missing.push({ item, checked: false });
      }
      setDiff(d);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось разобрать файл.", "error");
    } finally {
      setImportBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function applyDiff() {
    if (!diff) return;
    setApplying(true);
    try {
      const toAdd = diff.added.filter((a) => a.checked).map((a) => a.data);
      if (toAdd.length) {
        const { data, error } = await supabase.from("price_items").insert(toAdd).select("*");
        if (error) throw new Error("Ошибка при добавлении новых позиций.");
        const added = (data ?? []) as PriceItem[];
        if (added.length) {
          await supabase.from("price_history").insert(added.map((i) => ({ price_item_id: i.id, item_name: i.name, old_price: null, new_price: i.price, source: "import" })));
        }
      }
      for (const ch of diff.changed.filter((c) => c.checked)) {
        await supabase.from("price_items").update({ price: ch.next.price }).eq("id", ch.item.id);
        await supabase.from("price_history").insert({ price_item_id: ch.item.id, item_name: ch.item.name, old_price: ch.item.price, new_price: ch.next.price, source: "import" });
      }
      const toArchive = diff.missing.filter((m) => m.checked);
      for (const m of toArchive) {
        await supabase.from("price_items").update({ is_active: false }).eq("id", m.item.id);
        await supabase.from("price_history").insert({ price_item_id: m.item.id, item_name: m.item.name, old_price: m.item.price, new_price: null, source: "import-архив" });
      }
      toast(`Прайс обновлён: +${toAdd.length} новых, ${diff.changed.filter((c) => c.checked).length} изменено, ${toArchive.length} в архив.`, "ok");
      setDiff(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка обновления прайса.", "error");
    } finally {
      setApplying(false);
    }
  }

  async function openHistory(item: PriceItem) {
    setHistoryFor(item);
    const { data } = await supabase.from("price_history").select("*").eq("price_item_id", item.id).order("changed_at", { ascending: false }).limit(30);
    setHistory((data ?? []) as PriceHistoryRecord[]);
  }

  async function exportXlsx() {
    const XLSX = await import("xlsx");
    const rows = items.map((i) => ({
      Наименование: i.name,
      Категория: i.category,
      Тип: TYPE_LABEL[i.item_type],
      "Ед.": i.unit,
      Цена: num(i.price)
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Прайс");
    XLSX.writeFile(wb, `Прайс-лист ${new Date().toLocaleDateString("ru-RU")}.xlsx`);
  }

  return (
    <div className="fade-up">
      <PageTitle
        title="Прайс-лист"
        subtitle="Материалы, фурнитура и работы компании. Загрузите файл — система сама предложит новые цены и укажет, что удалить."
        right={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={exportXlsx}>
              <Download size={15} /> Excel
            </button>
            <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={importBusy}>
              {importBusy ? <span className="spinner" /> : <FileUp size={15} />}
              {importBusy ? "Анализирую файл…" : "Импорт из файла"}
            </button>
            <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv,.docx,.pdf,.png,.jpg,.jpeg,.webp,.txt" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </div>
        }
      />

      {diff && (
        <div className="card p-5 mb-6 border-oak/50 border-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles size={16} className="text-oak" /> Предлагаемые изменения прайса
            </div>
            <button className="p-2 rounded-lg hover:bg-line/50" onClick={() => setDiff(null)} aria-label="Отмена">
              <X size={16} />
            </button>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <DiffColumn
              title={`Новые позиции · ${diff.added.length}`}
              empty="Новых позиций нет"
              rows={diff.added.map((a, idx) => ({
                key: `a${idx}`,
                checked: a.checked,
                onToggle: () => setDiff({ ...diff, added: diff.added.map((x, i) => (i === idx ? { ...x, checked: !x.checked } : x)) }),
                main: a.data.name,
                sub: `${a.data.category} · ${a.data.unit}`,
                right: <span className="num text-emerald-800">{money(a.data.price, currency)}</span>
              }))}
            />
            <DiffColumn
              title={`Изменение цены · ${diff.changed.length}`}
              empty="Цены совпадают"
              rows={diff.changed.map((c, idx) => ({
                key: `c${idx}`,
                checked: c.checked,
                onToggle: () => setDiff({ ...diff, changed: diff.changed.map((x, i) => (i === idx ? { ...x, checked: !x.checked } : x)) }),
                main: c.item.name,
                sub: c.item.unit,
                right: (
                  <span className="num text-xs">
                    <span className="line-through text-dim">{fmt(num(c.item.price))}</span>{" "}
                    <span className={num(c.next.price) > num(c.item.price) ? "text-red-800" : "text-emerald-800"}>{money(c.next.price, currency)}</span>
                  </span>
                )
              }))}
            />
            <DiffColumn
              title={`Нет в файле — в архив? · ${diff.missing.length}`}
              empty="Все текущие позиции есть в файле"
              rows={diff.missing.map((m, idx) => ({
                key: `m${idx}`,
                checked: m.checked,
                onToggle: () => setDiff({ ...diff, missing: diff.missing.map((x, i) => (i === idx ? { ...x, checked: !x.checked } : x)) }),
                main: m.item.name,
                sub: m.item.category,
                right: <span className="num text-dim">{money(m.item.price, currency)}</span>
              }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button className="btn-primary" onClick={applyDiff} disabled={applying}>
              {applying ? <span className="spinner" /> : null} Применить выбранное
            </button>
            <span className="text-xs text-dim">Без изменений: {diff.same}. История цен сохраняется автоматически.</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input className="input pl-9" placeholder="Поиск по прайсу…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex gap-1.5">
          {(["all", "material", "fitting", "labor"] as const).map((t) => (
            <button
              key={t}
              className={`pill border ${tab === t ? "bg-lacquer text-oaklight border-lacquer" : "border-line bg-card text-dim hover:border-linehard"}`}
              onClick={() => setTab(t)}
            >
              {t === "all" ? "Все" : TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <button className="btn-ghost ml-auto" onClick={() => setAdding((v) => !v)}>
          <Plus size={15} /> Добавить позицию
        </button>
      </div>

      {adding && (
        <div className="card p-4 mb-4 grid sm:grid-cols-[1.6fr,1fr,0.8fr,0.6fr,0.8fr,auto] gap-3 items-end">
          <div>
            <label className="label">Название</label>
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Категория</label>
            <input className="input" placeholder="Плитные материалы" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          </div>
          <div>
            <label className="label">Тип</label>
            <select className="input" value={draft.item_type} onChange={(e) => setDraft({ ...draft, item_type: e.target.value as ItemType })}>
              <option value="material">Материал</option>
              <option value="fitting">Фурнитура</option>
              <option value="labor">Работа</option>
            </select>
          </div>
          <div>
            <label className="label">Ед.</label>
            <input className="input" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
          </div>
          <div>
            <label className="label">Цена</label>
            <input className="input num" type="number" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          </div>
          <button className="btn-primary" onClick={addDraft}>
            Сохранить
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-dim border-b border-line">
              <th className="px-4 py-3 font-semibold">Наименование</th>
              <th className="px-4 py-3 font-semibold">Категория</th>
              <th className="px-4 py-3 font-semibold">Тип</th>
              <th className="px-4 py-3 font-semibold">Ед.</th>
              <th className="px-4 py-3 font-semibold text-right">Цена</th>
              <th className="px-2 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b border-line last:border-0 hover:bg-oaklight/25 transition-colors">
                <td className="px-4 py-2">
                  <input className="input-bare font-medium w-full" defaultValue={item.name} onBlur={(e) => updateField(item, "name", e.target.value.trim() || item.name)} />
                </td>
                <td className="px-4 py-2">
                  <input className="input-bare text-dim w-full" defaultValue={item.category} onBlur={(e) => updateField(item, "category", e.target.value.trim())} />
                </td>
                <td className="px-4 py-2 text-dim">{TYPE_LABEL[item.item_type]}</td>
                <td className="px-4 py-2">
                  <input className="input-bare !w-16" defaultValue={item.unit} onBlur={(e) => updateField(item, "unit", e.target.value.trim() || "шт")} />
                </td>
                <td className="px-4 py-2 text-right">
                  <input
                    className="input-bare num !w-28 text-right font-semibold"
                    type="number"
                    step="any"
                    defaultValue={num(item.price)}
                    onBlur={(e) => updatePrice(item, num(e.target.value))}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex justify-end gap-1">
                    <button className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-line/60" title="История цены" onClick={() => openHistory(item)}>
                      <History size={14} />
                    </button>
                    <button className="p-1.5 rounded-lg text-dim hover:text-red-800 hover:bg-red-50" title="Удалить" onClick={() => removeItem(item)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-dim text-sm">
                  Ничего не найдено. Добавьте позиции вручную или импортируйте файл прайса.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {historyFor && (
        <div className="fixed inset-0 z-[90] bg-ink/50 flex items-center justify-center p-4" onClick={() => setHistoryFor(null)}>
          <div className="card shadow-lift w-full max-w-md p-5 fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm">{historyFor.name}</div>
              <button className="p-1.5 rounded-lg hover:bg-line/50" onClick={() => setHistoryFor(null)} aria-label="Закрыть">
                <X size={16} />
              </button>
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-dim">Изменений цены пока не было.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between py-2 border-b border-line last:border-0 text-sm">
                    <span className="text-dim num text-xs">{fmtDate(h.changed_at)}</span>
                    <span className="text-xs text-dim">{h.source}</span>
                    <span className="num">
                      {h.old_price === null ? "—" : fmt(num(h.old_price))} → {h.new_price === null ? "архив" : money(num(h.new_price), currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type DiffRow = {
  key: string;
  checked: boolean;
  onToggle: () => void;
  main: string;
  sub: string;
  right: React.ReactNode;
};

function DiffColumn({ title, empty, rows }: { title: string; empty: string; rows: DiffRow[] }) {
  return (
    <div className="border border-line rounded-xl bg-paper/40 flex flex-col min-h-[120px]">
      <div className="px-3.5 py-2.5 text-xs font-semibold border-b border-line">{title}</div>
      <div className="max-h-64 overflow-y-auto p-1.5 flex-1">
        {rows.length === 0 ? (
          <div className="text-xs text-dim px-2 py-3">{empty}</div>
        ) : (
          rows.map((r) => (
            <label key={r.key} className="flex items-start gap-2.5 px-2 py-2 rounded-lg hover:bg-card cursor-pointer">
              <input type="checkbox" className="mt-0.5 accent-[#B67F2E]" checked={r.checked} onChange={r.onToggle} />
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] leading-snug">{r.main}</span>
                <span className="block text-[11px] text-dim">{r.sub}</span>
              </span>
              <span className="shrink-0 text-[13px]">{r.right}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
