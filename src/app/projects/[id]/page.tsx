"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  SendHorizonal,
  Boxes,
  ChevronDown,
  ImagePlus,
  X,
  FileCheck2,
  FileSignature,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Plus,
  RefreshCw,
  Trash2,
  Wand2
} from "lucide-react";
import PageTitle from "@/components/PageTitle";
import { useToast } from "@/components/Toast";
import { uploadItemImage } from "@/lib/images";
import { describeProject, reviseProject } from "@/lib/ai";
import { identityFromSession } from "@/lib/identity";
import { amountInWords, dims, fmt, itemTotal, ITEM_COLORS, money, num, projectTotals, STATUS_META, STATUS_ORDER, uid } from "@/lib/calc";
import { downloadAct, downloadCalculation, downloadChecklist, downloadContract, downloadOffer } from "@/lib/docs";
import { supabase } from "@/lib/supabase";
import type { Component, ItemType, PriceItem, Project, ProjectItem, ProjectMessage, ProjectStatus, Settings } from "@/lib/types";

const Viewer3D = dynamic(() => import("@/components/Viewer3D"), { ssr: false });

const TYPE_LABEL: Record<ItemType, string> = { material: "Материалы", fitting: "Фурнитура", labor: "Работы" };

export default function ProjectPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [show3D, setShow3D] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const [docBusy, setDocBusy] = useState("");
  const [uploading, setUploading] = useState("");
  const [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Project | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("projects").select("*").eq("id", params.id).single(),
      supabase.from("app_settings").select("*").eq("id", 1).single(),
      supabase.from("price_items").select("*").eq("is_active", true).order("item_type").order("name")
    ]).then(([p, s, pr]) => {
      if (!alive) return;
      if (!p.data) {
        setNotFound(true);
        return;
      }
      setProject(p.data as Project);
      latest.current = p.data as Project;
      if (s.data) setSettings(s.data as Settings);
      setPrices((pr.data ?? []) as PriceItem[]);
    });
    return () => {
      alive = false;
    };
  }, [params.id]);

  const persist = useCallback(async () => {
    const p = latest.current;
    if (!p) return;
    setSaving(true);
    const { error } = await supabase
      .from("projects")
      .update({
        name: p.name,
        client_name: p.client_name,
        client_phone: p.client_phone,
        client_email: p.client_email,
        client_company: p.client_company,
        area: p.area,
        status: p.status,
        items: p.items,
        markup: num(p.markup),
        discount: num(p.discount),
        coefficient: num(p.coefficient) > 0 ? num(p.coefficient) : 1,
        vat_rate: num(p.vat_rate),
        vat_included: p.vat_included,
        notes: p.notes,
        ai_summary: p.ai_summary,
        assumptions: p.assumptions
      })
      .eq("id", p.id);
    setSaving(false);
    if (error) toast("Не удалось сохранить изменения.", "error");
    else setSaved(true);
  }, [toast]);

  const patch = useCallback(
    (partial: Partial<Project>) => {
      setProject((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...partial };
        latest.current = next;
        return next;
      });
      setSaved(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(persist, 1200);
    },
    [persist]
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!project) return;
    let alive = true;
    supabase
      .from("project_messages")
      .select("*")
      .eq("project_id", project.id)
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (alive) setMessages((data ?? []) as ProjectMessage[]);
      });
    return () => {
      alive = false;
    };
  }, [project?.id]);

  const totals = useMemo(() => (project ? projectTotals(project) : null), [project]);
  const currency = settings?.currency ?? "₸";

  const grouped = useMemo(() => {
    const g: Record<ItemType, PriceItem[]> = { material: [], fitting: [], labor: [] };
    for (const p of prices) g[p.item_type].push(p);
    return g;
  }, [prices]);

  if (notFound) {
    return (
      <div className="card p-12 text-center fade-up">
        <div className="font-display text-2xl mb-2">Проект не найден</div>
        <Link href="/projects" className="btn-ghost inline-flex mt-3">
          <ArrowLeft size={15} /> К списку проектов
        </Link>
      </div>
    );
  }

  if (!project || !totals || !settings) {
    return (
      <div className="min-h-[50vh] grid place-items-center">
        <span className="spinner text-oak" />
      </div>
    );
  }

  function setItem(itemId: string, partial: Partial<ProjectItem>) {
    patch({ items: project!.items.map((it) => (it.id === itemId ? { ...it, ...partial } : it)) });
  }

  function setComp(itemId: string, compId: string, partial: Partial<Component>) {
    patch({
      items: project!.items.map((it) =>
        it.id === itemId ? { ...it, components: it.components.map((c) => (c.id === compId ? { ...c, ...partial } : c)) } : it
      )
    });
  }

  function selectPriceItem(itemId: string, compId: string, priceItemId: string) {
    if (priceItemId === "custom") {
      setComp(itemId, compId, { priceItemId: null });
      return;
    }
    const found = prices.find((p) => p.id === priceItemId);
    if (found) {
      setComp(itemId, compId, { priceItemId: found.id, name: found.name, unit: found.unit, price: num(found.price), type: found.item_type });
    }
  }

  function addComp(itemId: string, type: ItemType) {
    const first = grouped[type][0];
    const comp: Component = first
      ? { id: uid(), priceItemId: first.id, name: first.name, type, unit: first.unit, qty: 1, price: num(first.price), note: "" }
      : { id: uid(), priceItemId: null, name: "", type, unit: "шт", qty: 1, price: 0, note: "" };
    patch({ items: project!.items.map((it) => (it.id === itemId ? { ...it, components: [...it.components, comp] } : it)) });
  }

  function removeComp(itemId: string, compId: string) {
    patch({
      items: project!.items.map((it) => (it.id === itemId ? { ...it, components: it.components.filter((c) => c.id !== compId) } : it))
    });
  }

  async function onPickImage(itemId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !project) return;
    setUploading(itemId);
    try {
      const url = await uploadItemImage(project.id, itemId, file);
      setItem(itemId, { image_url: url });
      toast("Изображение добавлено.", "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Не удалось загрузить изображение.", "error");
    } finally {
      setUploading("");
    }
  }

  function addItem() {
    const item: ProjectItem = {
      id: uid(),
      name: "Новая позиция",
      room: "",
      width: 0,
      height: 0,
      depth: 0,
      qty: 1,
      color: ITEM_COLORS[project!.items.length % ITEM_COLORS.length],
      spec: "",
      image_url: "",
      price_from: false,
      components: []
    };
    patch({ items: [...project!.items, item] });
  }

  function removeItem(itemId: string) {
    if (!confirm("Удалить позицию из расчёта?")) return;
    patch({ items: project!.items.filter((it) => it.id !== itemId) });
  }

  async function removeProject() {
    if (!confirm(`Удалить проект «${project!.name}» безвозвратно?`)) return;
    await supabase.from("projects").delete().eq("id", project!.id);
    router.push("/projects");
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || !project || chatBusy) return;
    setChatBusy(true);
    setChatInput("");
    const { data: sess } = await supabase.auth.getSession();
    const identity = sess.session ? identityFromSession(sess.session) : null;
    const authorName = identity?.name ?? "";
    const authorEmployee = identity?.employeeId ?? null;
    const { data: userMsg } = await supabase
      .from("project_messages")
      .insert({ project_id: project.id, role: "user", content: text, author_name: authorName, author_employee: authorEmployee })
      .select("*")
      .single();
    if (userMsg) setMessages((prev) => [...prev, userMsg as ProjectMessage]);
    try {
      const { data: priceRows } = await supabase
        .from("price_items")
        .select("id,item_type,name,unit,price")
        .eq("is_active", true)
        .order("item_type")
        .limit(800);
      const priceList = (priceRows ?? []).map((r) => `${r.id} | ${r.item_type} | ${r.name} | ${r.unit} | ${num(r.price)}`).join("\n");
      const snapshot = {
        name: project.name,
        area: project.area,
        items: project.items.map((it) => ({
          name: it.name,
          room: it.room,
          width: it.width,
          height: it.height,
          depth: it.depth,
          qty: it.qty,
          spec: it.spec,
          components: it.components.map((c) => ({
            priceItemId: c.priceItemId,
            name: c.name,
            type: c.type,
            unit: c.unit,
            qty: c.qty,
            price: c.price,
            note: c.note
          }))
        })),
        assumptions: project.assumptions,
        summary: project.ai_summary
      };
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const result = await reviseProject({ project: snapshot, priceList, history, instruction: text });
      const byKey = new Map(project.items.map((it) => [`${it.name}|${it.room}`, it] as const));
      const nextItems: ProjectItem[] = result.items.map((it, i) => {
        const prev = byKey.get(`${it.name}|${it.room}`);
        return {
          id: prev?.id ?? uid(),
          name: it.name,
          room: it.room,
          width: it.width,
          height: it.height,
          depth: it.depth,
          qty: it.qty,
          color: prev?.color ?? ITEM_COLORS[i % ITEM_COLORS.length],
          spec: it.spec || prev?.spec || "",
          image_url: prev?.image_url ?? "",
          price_from: prev?.price_from ?? false,
          components: it.components.map((c) => ({ id: uid(), ...c }))
        };
      });
      const nextProject: Project = {
        ...project,
        name: result.name || project.name,
        area: result.area ?? project.area,
        items: nextItems,
        assumptions: result.assumptions || project.assumptions,
        ai_summary: result.summary || project.ai_summary
      };
      setProject(nextProject);
      latest.current = nextProject;
      await persist();
      const replyText = `${result.reply}\n\nОбновлённое КП сформировано - файл скачан.`;
      const { data: botMsg } = await supabase
        .from("project_messages")
        .insert({ project_id: project.id, role: "assistant", content: replyText, author_name: "Система" })
        .select("*")
        .single();
      if (botMsg) setMessages((prev) => [...prev, botMsg as ProjectMessage]);
      if (settings) await downloadOffer(nextProject, settings);
      toast("Расчёт обновлён по замечанию.", "ok");
    } catch (e) {
      const errText = e instanceof Error ? e.message : "Не удалось обработать замечание.";
      const { data: botMsg } = await supabase
        .from("project_messages")
        .insert({ project_id: project.id, role: "assistant", content: `Не получилось применить правку: ${errText}`, author_name: "Система" })
        .select("*")
        .single();
      if (botMsg) setMessages((prev) => [...prev, botMsg as ProjectMessage]);
      toast(errText, "error");
    } finally {
      setChatBusy(false);
    }
  }

  async function makeDoc(key: string, fn: (p: Project, s: Settings) => Promise<void>) {
    setDocBusy(key);
    try {
      if (!saved) await persist();
      await fn(latest.current ?? project!, settings!);
      toast("Документ Word скачан.", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось сформировать документ.", "error");
    } finally {
      setDocBusy("");
    }
  }

  async function regenerateSummary() {
    setAiBusy(true);
    try {
      const p = latest.current ?? project!;
      const t = projectTotals(p);
      const brief = [
        `Проект: ${p.name}${p.area ? `, ${p.area} м²` : ""}. Валюта: ${currency}.`,
        ...p.items.map(
          (it) =>
            `• ${it.name} (${dims(it)} мм, ${it.qty} шт): ` +
            it.components.map((c) => `${c.name} — ${fmt(num(c.qty))} ${c.unit}`).join("; ")
        ),
        `Итоговая стоимость для клиента: ${money(t.total, currency)}.`
      ].join("\n");
      const res = await describeProject(brief);
      if (res.summary) {
        patch({ ai_summary: res.summary });
        toast("Обоснование обновлено.", "ok");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка генерации.", "error");
    } finally {
      setAiBusy(false);
    }
  }

  const vatMode = num(project.vat_rate) > 0 ? (project.vat_included ? "incl" : "over") : "none";

  const DOCS = [
    { key: "offer", label: "КП / смета клиенту", icon: FileText, fn: downloadOffer },
    { key: "calc", label: "Калькуляция (внутренняя)", icon: FileSpreadsheet, fn: downloadCalculation },
    { key: "contract", label: "Договор подряда", icon: FileSignature, fn: downloadContract },
    { key: "checklist", label: "Чек-лист производства", icon: ListChecks, fn: downloadChecklist },
    { key: "act", label: "Акт выполненных работ", icon: FileCheck2, fn: downloadAct }
  ];

  return (
    <div className="fade-up">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Link href="/projects" className="btn-ghost !px-3">
          <ArrowLeft size={16} />
        </Link>
        <input
          className="font-display text-2xl sm:text-3xl bg-transparent outline-none flex-1 min-w-[220px] border-b border-transparent focus:border-line py-1"
          value={project.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <span className="text-xs text-dim num shrink-0">№ {project.number}</span>
        <span className="text-xs text-dim shrink-0">{saving ? "Сохранение…" : saved ? "Сохранено" : "Изменения…"}</span>
        <button className="btn-dark" onClick={() => setShow3D(true)} disabled={project.items.length === 0}>
          <Boxes size={16} /> 3D-превью
        </button>
        <select
          className="input !w-auto"
          value={project.status}
          onChange={(e) => patch({ status: e.target.value as ProjectStatus })}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
      </div>
      <div className="dimline mb-6" />

      <div className="grid xl:grid-cols-[1fr,360px] gap-6 items-start">
        <div className="space-y-5 min-w-0">
          <div className="card p-5">
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-1">
                <label className="label">Клиент</label>
                <input className="input" value={project.client_name} onChange={(e) => patch({ client_name: e.target.value })} />
              </div>
              <div>
                <label className="label">Компания</label>
                <input className="input" value={project.client_company} onChange={(e) => patch({ client_company: e.target.value })} />
              </div>
              <div>
                <label className="label">Телефон</label>
                <input className="input" value={project.client_phone} onChange={(e) => patch({ client_phone: e.target.value })} />
              </div>
              <div>
                <label className="label">E-mail</label>
                <input className="input" value={project.client_email} onChange={(e) => patch({ client_email: e.target.value })} />
              </div>
              <div>
                <label className="label">Площадь, м²</label>
                <input
                  className="input num"
                  type="number"
                  value={project.area ?? ""}
                  onChange={(e) => patch({ area: e.target.value === "" ? null : num(e.target.value) })}
                />
              </div>
            </div>
          </div>

          {project.items.map((item) => (
            <div key={item.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                <label className="relative w-6 h-6 rounded-md border border-linehard overflow-hidden cursor-pointer shrink-0" title="Цвет для 3D">
                  <span className="absolute inset-0" style={{ background: item.color }} />
                  <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={item.color} onChange={(e) => setItem(item.id, { color: e.target.value })} />
                </label>
                <input
                  className="font-semibold text-[15px] bg-transparent outline-none flex-1 min-w-[180px] border-b border-transparent focus:border-line"
                  value={item.name}
                  onChange={(e) => setItem(item.id, { name: e.target.value })}
                />
                <input className="input-bare !w-28 text-dim" placeholder="Помещение" value={item.room} onChange={(e) => setItem(item.id, { room: e.target.value })} />
                <div className="flex items-center gap-1 text-xs text-dim">
                  {(["width", "height", "depth"] as const).map((k, i) => (
                    <span key={k} className="flex items-center gap-1">
                      {i > 0 && <span>×</span>}
                      <input
                        className="input-bare num !w-[62px] text-center !px-1"
                        type="number"
                        placeholder={["Ш", "В", "Г"][i]}
                        value={item[k] || ""}
                        onChange={(e) => setItem(item.id, { [k]: num(e.target.value) } as Partial<ProjectItem>)}
                      />
                    </span>
                  ))}
                  <span className="ml-1">мм</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-dim">
                  ×
                  <input
                    className="input-bare num !w-14 text-center !px-1"
                    type="number"
                    value={item.qty || ""}
                    onChange={(e) => setItem(item.id, { qty: num(e.target.value) })}
                  />
                  шт
                </div>
                <button className="p-2 rounded-lg text-dim hover:text-red-800 hover:bg-red-50" onClick={() => removeItem(item.id)} aria-label="Удалить позицию">
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-dim border-y border-line bg-paper/60">
                      <th className="px-5 py-2 font-semibold w-[34%]">Материал / работа</th>
                      <th className="px-3 py-2 font-semibold w-[22%]">Расчёт</th>
                      <th className="px-3 py-2 font-semibold text-right">Кол-во</th>
                      <th className="px-3 py-2 font-semibold">Ед.</th>
                      <th className="px-3 py-2 font-semibold text-right">Цена</th>
                      <th className="px-3 py-2 font-semibold text-right">Сумма</th>
                      <th className="px-2 py-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {item.components.map((comp) => (
                      <tr key={comp.id} className="border-b border-line/70 last:border-0 align-top">
                        <td className="px-5 py-2">
                          <select className="input !py-1.5 text-[13px]" value={comp.priceItemId ?? "custom"} onChange={(e) => selectPriceItem(item.id, comp.id, e.target.value)}>
                            <option value="custom">— своя позиция —</option>
                            {(["material", "fitting", "labor"] as ItemType[]).map((tp) =>
                              grouped[tp].length ? (
                                <optgroup key={tp} label={TYPE_LABEL[tp]}>
                                  {grouped[tp].map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} · {money(p.price, currency)}/{p.unit}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null
                            )}
                          </select>
                          {comp.priceItemId === null && (
                            <input
                              className="input !py-1.5 mt-1.5 text-[13px]"
                              placeholder="Название позиции"
                              value={comp.name}
                              onChange={(e) => setComp(item.id, comp.id, { name: e.target.value })}
                            />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input className="input-bare text-xs text-dim w-full" placeholder="формула / примечание" value={comp.note} onChange={(e) => setComp(item.id, comp.id, { note: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input className="input-bare num !w-20 text-right" type="number" step="any" value={comp.qty || ""} onChange={(e) => setComp(item.id, comp.id, { qty: num(e.target.value) })} />
                        </td>
                        <td className="px-3 py-2">
                          <input className="input-bare !w-16" value={comp.unit} onChange={(e) => setComp(item.id, comp.id, { unit: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input className="input-bare num !w-28 text-right" type="number" step="any" value={comp.price || ""} onChange={(e) => setComp(item.id, comp.id, { price: num(e.target.value) })} />
                        </td>
                        <td className="px-3 py-2 text-right num font-semibold whitespace-nowrap">{money(num(comp.qty) * num(comp.price), currency)}</td>
                        <td className="px-2 py-2">
                          <button className="p-1.5 rounded-lg text-dim hover:text-red-800 hover:bg-red-50" onClick={() => removeComp(item.id, comp.id)} aria-label="Удалить строку">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-5 pb-4 grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
                <div>
                  <label className="label">Фото для КП</label>
                  {item.image_url ? (
                    <div className="relative rounded-xl overflow-hidden border-2 border-oak">
                      <img src={item.image_url} alt="" className="w-full h-[150px] object-cover" />
                      <button
                        className="absolute top-1.5 right-1.5 p-1 rounded-md bg-ink/70 text-white hover:bg-red-700 transition-colors"
                        onClick={() => setItem(item.id, { image_url: "" })}
                        title="Убрать фото"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center gap-1.5 h-[150px] rounded-xl border-2 border-dashed border-line hover:border-oak text-dim hover:text-oak cursor-pointer transition-colors text-xs">
                      {uploading === item.id ? (
                        <span className="spinner" />
                      ) : (
                        <>
                          <ImagePlus size={20} />
                          <span>Загрузить изображение</span>
                        </>
                      )}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onPickImage(item.id, e)} />
                    </label>
                  )}
                </div>
                <div>
                  <label className="label">Спецификация для КП</label>
                  <textarea
                    className="input min-h-[112px] text-[13px] leading-relaxed"
                    value={item.spec || ""}
                    onChange={(e) => setItem(item.id, { spec: e.target.value })}
                    placeholder={"Фасад: МДФ в краске (Италия)\nКорпус: ЛДСП (Россия)\nЗадняя стенка: ХДФ\nНавесы: Blum (Австрия) н/д"}
                  />
                  <label className="flex items-center gap-2 text-xs text-dim mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-[#B67F2E] h-3.5 w-3.5"
                      checked={!!item.price_from}
                      onChange={(e) => setItem(item.id, { price_from: e.target.checked })}
                    />
                    Показывать цену как «от» (камень, наполнение уточняется)
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-paper/50 border-t border-line">
                <div className="flex gap-2">
                  <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => addComp(item.id, "material")}>
                    <Plus size={13} /> материал
                  </button>
                  <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => addComp(item.id, "fitting")}>
                    <Plus size={13} /> фурнитура
                  </button>
                  <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => addComp(item.id, "labor")}>
                    <Plus size={13} /> работа
                  </button>
                </div>
                <div className="text-sm">
                  <span className="text-dim">Итого по позиции: </span>
                  <span className="num font-bold">{money(itemTotal(item), currency)}</span>
                </div>
              </div>
            </div>
          ))}

          <button className="btn-ghost w-full py-4 border-dashed" onClick={addItem}>
            <Plus size={16} /> Добавить позицию мебели
          </button>

          <div className="card">
            <button className="w-full flex items-center justify-between px-5 py-4" onClick={() => setShowMethod((v) => !v)}>
              <span className="font-semibold text-sm">Как посчитано — методика и допущения</span>
              <ChevronDown size={17} className={`text-dim transition-transform ${showMethod ? "rotate-180" : ""}`} />
            </button>
            {showMethod && (
              <div className="px-5 pb-5">
                <textarea
                  className="input min-h-[140px] text-[13px] leading-relaxed"
                  placeholder="Методика расчёта: площади, нормы расхода, допущения…"
                  value={project.assumptions}
                  onChange={(e) => patch({ assumptions: e.target.value })}
                />
                <p className="text-xs text-dim mt-2">
                  Формулы по каждой строке видны в колонке «Расчёт». Этот блок попадает во внутреннюю калькуляцию.
                </p>
              </div>
            )}
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="font-semibold text-sm">Обоснование стоимости для клиента</div>
              <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={regenerateSummary} disabled={aiBusy}>
                {aiBusy ? <span className="spinner" /> : <Wand2 size={13} />}
                Сгенерировать
              </button>
            </div>
            <textarea
              className="input min-h-[120px] text-[13px] leading-relaxed"
              placeholder="Профессиональное объяснение, из чего складывается цена. Попадает в КП."
              value={project.ai_summary}
              onChange={(e) => patch({ ai_summary: e.target.value })}
            />
          </div>

          <div className="card p-5">
            <label className="label">Заметки по проекту</label>
            <textarea className="input min-h-[80px] text-[13px]" value={project.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-line flex items-center gap-2">
              <Bot size={16} className="text-oak" />
              <span className="text-sm font-semibold">Чат по проекту - доработка КП</span>
            </div>
            <div className="max-h-[340px] overflow-y-auto p-4 space-y-3 bg-paper/50">
              {messages.length === 0 && (
                <p className="text-xs text-dim text-center py-4">
                  Заметили ошибку в КП? Напишите замечание - система пересчитает проект, обновит позиции и сразу скачает новый файл КП. Писать можно сколько угодно раз.
                </p>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                      m.role === "user" ? "bg-lacquer text-oaklight rounded-br-md" : "bg-card border border-line rounded-bl-md"
                    }`}
                  >
                    {m.content}
                    <div className={`text-[10px] mt-1.5 ${m.role === "user" ? "text-oaklight/50" : "text-dim"}`}>
                      {m.role === "user" ? m.author_name || "Менеджер" : "Система"} · {new Date(m.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              ))}
              {chatBusy && (
                <div className="flex justify-start">
                  <div className="bg-card border border-line rounded-2xl rounded-bl-md px-3.5 py-2.5 flex items-center gap-2 text-[13px] text-dim">
                    <span className="spinner" /> Пересчитываю проект…
                  </div>
                </div>
              )}
            </div>
            <div className="p-3 border-t border-line flex items-end gap-2">
              <textarea
                className="input !min-h-[46px] max-h-32 text-[13px] flex-1"
                rows={1}
                placeholder="Например: в спальне два шкафа - посчитай оба; столешницу считай в погонных метрах…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                disabled={chatBusy}
              />
              <button className="btn-primary !px-3.5" onClick={sendChat} disabled={chatBusy || !chatInput.trim()}>
                <SendHorizonal size={16} />
              </button>
            </div>
          </div>

          <button className="btn-danger" onClick={removeProject}>
            <Trash2 size={15} /> Удалить проект
          </button>
        </div>

        <div className="space-y-5 xl:sticky xl:top-6">
          <div className="card p-5">
            <div className="label mb-3">Итоги расчёта</div>
            <Row label="Материалы" value={money(totals.materials, currency)} />
            <Row label="Фурнитура" value={money(totals.fittings, currency)} />
            <Row label="Работы" value={money(totals.labor, currency)} />
            <div className="dimline my-3" />
            <Row label="Себестоимость" value={money(totals.base, currency)} strong />
            <div className="flex items-center justify-between py-1.5 text-sm gap-2">
              <span className="text-dim flex items-center gap-1.5">
                Наценка
                <input className="input !w-16 !py-1 num text-right" type="number" value={project.markup || ""} onChange={(e) => patch({ markup: num(e.target.value) })} />
                %
              </span>
              <span className="num">+{money(totals.markupAmount, currency)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 text-sm gap-2">
              <span className="text-dim flex items-center gap-1.5">
                Скидка
                <input className="input !w-16 !py-1 num text-right" type="number" value={project.discount || ""} onChange={(e) => patch({ discount: num(e.target.value) })} />
                %
              </span>
              <span className="num">−{money(totals.discountAmount, currency)}</span>
            </div>
            <div className="py-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-dim flex items-center gap-1.5">
                  Коэффициент
                  <input
                    className="input !w-16 !py-1 num text-right"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={project.coefficient ?? 1}
                    onChange={(e) => patch({ coefficient: num(e.target.value) })}
                  />
                </span>
                <span className="num">×{fmt(num(project.coefficient) > 0 ? num(project.coefficient) : 1)}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {[1, 1.1, 1.2, 1.5, 2, 2.2].map((k) => (
                  <button
                    key={k}
                    className={`pill !py-0.5 !px-2 num transition-colors ${num(project.coefficient) === k ? "border-oak text-oak bg-oaklight/40" : "hover:border-oak hover:text-oak"}`}
                    onClick={() => patch({ coefficient: k })}
                  >
                    {fmt(k)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between py-1.5 text-sm gap-2">
              <span className="text-dim flex items-center gap-1.5">
                НДС
                <select
                  className="input !w-auto !py-1 text-xs"
                  value={vatMode}
                  onChange={(e) => {
                    const mode = e.target.value;
                    if (mode === "none") patch({ vat_rate: 0 });
                    else patch({ vat_included: mode === "incl", vat_rate: num(project.vat_rate) || settings.vat_rate || 12 });
                  }}
                >
                  <option value="incl">в цене</option>
                  <option value="over">сверху</option>
                  <option value="none">без НДС</option>
                </select>
                {vatMode !== "none" && (
                  <>
                    <input className="input !w-14 !py-1 num text-right" type="number" value={project.vat_rate || ""} onChange={(e) => patch({ vat_rate: num(e.target.value) })} />
                    %
                  </>
                )}
              </span>
              <span className="num">{money(totals.vatAmount, currency)}</span>
            </div>
            <div className="dimline my-3" />
            <div className="flex items-end justify-between gap-2">
              <span className="text-sm text-dim">Итого для клиента</span>
              <span className="num text-2xl font-bold">{money(totals.total, currency)}</span>
            </div>
            <p className="text-[11px] text-dim mt-2 leading-snug">{amountInWords(totals.total, currency)}</p>
          </div>

          <div className="card p-5">
            <div className="label mb-3">Документы · Word</div>
            <div className="space-y-2">
              {DOCS.map(({ key, label, icon: Icon, fn }) => (
                <button key={key} className="btn-ghost w-full !justify-start" onClick={() => makeDoc(key, fn)} disabled={docBusy !== ""}>
                  {docBusy === key ? <span className="spinner text-oak" /> : <Icon size={16} className="text-oak" />}
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-dim mt-3 leading-snug">
              Цены в клиентских документах указываются с учётом наценки и скидки. Реквизиты берутся из «Настроек».
            </p>
          </div>

          {project.source_file_name && (
            <div className="card p-4 text-xs text-dim flex items-center gap-2">
              <RefreshCw size={13} className="shrink-0" />
              Рассчитано из файла: <span className="truncate">{project.source_file_name}</span>
            </div>
          )}
        </div>
      </div>

      {show3D && <Viewer3D items={project.items} title={project.name} onClose={() => setShow3D(false)} />}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-dim">{label}</span>
      <span className={`num ${strong ? "font-bold" : ""}`}>{value}</span>
    </div>
  );
}
