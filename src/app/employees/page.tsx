"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpenText, Check, Copy, FolderOpen, Gauge, IdCard, MessageSquareText, Plus, Trash2, UserRound } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import { useToast } from "@/components/Toast";
import { fmtDate, money, projectTotals, STATUS_META } from "@/lib/calc";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { identityFromSession } from "@/lib/identity";
import { accessToken, supabase } from "@/lib/supabase";
import type { AiKnowledge, Employee, Project } from "@/lib/types";

export default function EmployeesPage() {
  const toast = useToast();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [list, setList] = useState<Employee[]>([]);
  const [fullName, setFullName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdCode, setCreatedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [knowledge, setKnowledge] = useState<AiKnowledge[]>([]);
  const [messagesCount, setMessagesCount] = useState(0);
  const [detailBusy, setDetailBusy] = useState(false);
  const [currency, setCurrency] = useState("₸");
  const [limitInput, setLimitInput] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const session = data.session;
      if (!session || identityFromSession(session).role !== "owner") {
        router.replace("/");
        return;
      }
      setReady(true);
      load();
    });
    supabase
      .from("app_settings")
      .select("currency")
      .eq("id", 1)
      .single()
      .then(({ data }) => {
        if (alive && data?.currency) setCurrency(data.currency);
      });
    return () => {
      alive = false;
    };
  }, [router]);

  async function load() {
    const { data } = await supabase.from("employees").select("*").order("created_at", { ascending: false });
    setList((data ?? []) as Employee[]);
  }

  async function callStaff(body: Record<string, unknown>) {
    const token = await accessToken();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Ошибка запроса.");
    return json;
  }

  async function create() {
    const name = fullName.trim();
    if (!name) {
      toast("Укажите ФИО сотрудника.", "info");
      return;
    }
    setCreating(true);
    setCreatedCode("");
    try {
      const { employee } = await callStaff({ action: "create", full_name: name });
      setFullName("");
      setCreatedCode(employee.login_code);
      setCopied(false);
      setList((prev) => [employee as Employee, ...prev]);
      toast("Сотрудник добавлен, ID создан.", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось создать сотрудника.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function remove(emp: Employee) {
    if (!confirm(`Удалить сотрудника «${emp.full_name}»? Вход по ID ${emp.login_code} перестанет работать. Его проекты и записи останутся в системе.`)) return;
    try {
      await callStaff({ action: "delete", employee_id: emp.id });
      setList((prev) => prev.filter((x) => x.id !== emp.id));
      if (selected?.id === emp.id) setSelected(null);
      toast("Сотрудник удалён.", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось удалить.", "error");
    }
  }

  async function openDetail(emp: Employee) {
    setSelected(emp);
    setLimitInput(emp.attempts_limit == null ? "" : String(emp.attempts_limit));
    setDetailBusy(true);
    const [{ data: pr }, { data: kn }, { count }] = await Promise.all([
      supabase.from("projects").select("*").eq("author_employee", emp.id).order("created_at", { ascending: false }).limit(60),
      supabase.from("ai_knowledge").select("*").eq("author_employee", emp.id).order("created_at", { ascending: false }).limit(60),
      supabase.from("project_messages").select("id", { count: "exact", head: true }).eq("author_employee", emp.id)
    ]);
    setProjects((pr ?? []) as Project[]);
    setKnowledge((kn ?? []) as AiKnowledge[]);
    setMessagesCount(count ?? 0);
    setDetailBusy(false);
  }

  function applyEmployeeUpdate(updated: Employee) {
    setSelected(updated);
    setList((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function grantAttempts() {
    if (!selected) return;
    const n = Math.floor(Number(limitInput.replace(",", ".")));
    if (!Number.isFinite(n) || n < 0) {
      toast("Укажите число попыток — целое, от 0.", "info");
      return;
    }
    setSavingLimit(true);
    const { error } = await supabase.from("employees").update({ attempts_limit: n, attempts_used: 0 }).eq("id", selected.id);
    setSavingLimit(false);
    if (error) {
      toast("Не удалось сохранить лимит.", "error");
      return;
    }
    applyEmployeeUpdate({ ...selected, attempts_limit: n, attempts_used: 0 });
    toast(`Выдано попыток: ${n}. Счётчик обнулён.`, "ok");
  }

  async function makeUnlimited() {
    if (!selected) return;
    setSavingLimit(true);
    const { error } = await supabase.from("employees").update({ attempts_limit: null, attempts_used: 0 }).eq("id", selected.id);
    setSavingLimit(false);
    if (error) {
      toast("Не удалось сохранить лимит.", "error");
      return;
    }
    applyEmployeeUpdate({ ...selected, attempts_limit: null, attempts_used: 0 });
    setLimitInput("");
    toast("Лимит снят — у сотрудника безлимит.", "ok");
  }

  function copyCode() {
    navigator.clipboard?.writeText(createdCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const totalSum = useMemo(() => projects.reduce((acc, project) => acc + projectTotals(project).total, 0), [projects]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-32">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div className="fade-up">
      <PageTitle
        title="Сотрудники"
        subtitle="Создавайте ID для входа менеджеров и просматривайте их работу: расчёты, обучение системы и переписку по проектам."
      />

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="font-display text-xl mb-3">Добавить сотрудника</h3>
            <label className="label">ФИО сотрудника</label>
            <input
              className="input"
              value={fullName}
              placeholder="Иванов Иван"
              onChange={(e) => setFullName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <button className="btn-primary w-full mt-3" onClick={create} disabled={creating}>
              {creating ? <span className="spinner" /> : <Plus size={15} />}
              Создать ID
            </button>
            {createdCode && (
              <div className="mt-4 rounded-xl border border-oak bg-oaklight/40 p-4 text-center">
                <p className="text-xs text-dim mb-1.5">ID для входа сотрудника</p>
                <p className="num font-display text-3xl font-semibold tracking-[0.25em]">{createdCode}</p>
                <button className="btn-ghost text-xs mt-2" onClick={copyCode}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Скопировано" : "Скопировать"}
                </button>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-line text-sm font-semibold flex items-center gap-2">
              <UserRound size={15} className="text-oak" />
              Все сотрудники
              <span className="pill ml-auto num">{list.length}</span>
            </div>
            {list.length === 0 && <p className="p-5 text-sm text-dim">Пока никого нет. Добавьте первого сотрудника выше.</p>}
            {list.map((emp) => (
              <button
                key={emp.id}
                className={`w-full flex items-center gap-3 px-5 py-3 border-b border-line last:border-0 text-left transition-colors ${
                  selected?.id === emp.id ? "bg-oaklight/40" : "hover:bg-paper"
                }`}
                onClick={() => openDetail(emp)}
              >
                <div className="w-9 h-9 rounded-full bg-lacquer text-oaklight grid place-items-center font-display">
                  {emp.full_name.trim().charAt(0).toUpperCase() || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{emp.full_name}</p>
                  <p className="text-[11px] text-dim num">
                    ID {emp.login_code} · {fmtDate(emp.created_at)}
                    {emp.attempts_limit != null && ` · попыток: ${Math.max(0, emp.attempts_limit - (emp.attempts_used ?? 0))}`}
                  </p>
                </div>
                <span
                  className="p-1.5 rounded-md text-dim hover:text-red-700 hover:bg-red-50 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(emp);
                  }}
                >
                  <Trash2 size={14} />
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          {!selected && (
            <div className="card p-10 text-center text-dim text-sm">
              <IdCard size={26} className="mx-auto mb-3 text-oak" />
              Выберите сотрудника слева, чтобы увидеть его расчёты, добавленные знания и активность в чатах проектов.
            </div>
          )}

          {selected && (
            <div className="space-y-5">
              <div className="card p-5 flex flex-wrap items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-lacquer text-oaklight grid place-items-center font-display text-xl">
                  {selected.full_name.trim().charAt(0).toUpperCase() || "?"}
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-2xl leading-tight">{selected.full_name}</h3>
                  <p className="text-xs text-dim num">ID {selected.login_code} · добавлен {fmtDate(selected.created_at)}</p>
                </div>
                <div className="flex gap-2 ml-auto text-center">
                  <div className="rounded-xl border border-line px-3 py-2">
                    <p className="num font-semibold">{projects.length}</p>
                    <p className="text-[10px] text-dim uppercase tracking-wide">расчётов</p>
                  </div>
                  <div className="rounded-xl border border-line px-3 py-2">
                    <p className="num font-semibold">{knowledge.length}</p>
                    <p className="text-[10px] text-dim uppercase tracking-wide">знаний</p>
                  </div>
                  <div className="rounded-xl border border-line px-3 py-2">
                    <p className="num font-semibold">{messagesCount}</p>
                    <p className="text-[10px] text-dim uppercase tracking-wide">сообщений</p>
                  </div>
                  <div className="rounded-xl border border-line px-3 py-2">
                    <p className="num font-semibold">
                      {selected.attempts_limit == null ? "∞" : Math.max(0, selected.attempts_limit - (selected.attempts_used ?? 0))}
                    </p>
                    <p className="text-[10px] text-dim uppercase tracking-wide">попыток</p>
                  </div>
                </div>
              </div>

              <div className="card p-5">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Gauge size={15} className="text-oak" />
                  <h4 className="text-sm font-semibold">Лимит расчётов</h4>
                  <span className="pill ml-auto num">
                    {selected.attempts_limit == null
                      ? "Безлимит"
                      : `осталось ${Math.max(0, selected.attempts_limit - (selected.attempts_used ?? 0))} из ${selected.attempts_limit}`}
                  </span>
                </div>
                <p className="text-xs text-dim leading-relaxed mb-3">
                  Сколько ИИ-расчётов (анализ файлов и создание КП) сотрудник может запустить. Когда попытки закончатся, при запуске расчёта он увидит:
                  «Попытки закончились. Обратитесь к руководителю». Выдача нового количества обнуляет использованные.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input !w-36 num"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="Например, 20"
                    value={limitInput}
                    onChange={(e) => setLimitInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && grantAttempts()}
                  />
                  <button className="btn-primary" onClick={grantAttempts} disabled={savingLimit}>
                    {savingLimit ? <span className="spinner" /> : <Gauge size={15} />}
                    Выдать попытки
                  </button>
                  <button className="btn-ghost" onClick={makeUnlimited} disabled={savingLimit || selected.attempts_limit == null}>
                    Сделать безлимит
                  </button>
                </div>
                {selected.attempts_limit != null && (
                  <p className="text-[11px] text-dim mt-2 num">
                    Использовано: {selected.attempts_used ?? 0} из {selected.attempts_limit}.
                  </p>
                )}
              </div>

              {detailBusy && (
                <div className="card p-10 grid place-items-center">
                  <span className="spinner" />
                </div>
              )}

              {!detailBusy && (
                <>
                  <div className="card overflow-hidden">
                    <div className="px-5 py-3 border-b border-line text-sm font-semibold flex items-center gap-2">
                      <FolderOpen size={15} className="text-oak" />
                      Расчёты сотрудника
                      {projects.length > 0 && <span className="ml-auto num text-dim text-xs">на {money(totalSum, currency)}</span>}
                    </div>
                    {projects.length === 0 && <p className="p-5 text-sm text-dim">Расчётов пока нет.</p>}
                    {projects.map((project) => (
                      <Link
                        key={project.id}
                        href={`/projects/${project.id}`}
                        className="flex items-center gap-3 px-5 py-3 border-b border-line last:border-0 hover:bg-paper transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            №{project.number} · {project.name}
                          </p>
                          <p className="text-[11px] text-dim">{fmtDate(project.created_at)} · {project.items.length} поз.</p>
                        </div>
                        <span className={`pill ${STATUS_META[project.status].cls}`}>{STATUS_META[project.status].label}</span>
                        <span className="num text-sm font-semibold">{money(projectTotals(project).total, currency)}</span>
                      </Link>
                    ))}
                  </div>

                  <div className="card overflow-hidden">
                    <div className="px-5 py-3 border-b border-line text-sm font-semibold flex items-center gap-2">
                      <BookOpenText size={15} className="text-oak" />
                      Добавленные знания
                    </div>
                    {knowledge.length === 0 && <p className="p-5 text-sm text-dim">Записей обучения нет.</p>}
                    {knowledge.map((k) => (
                      <details key={k.id} className="px-5 py-3 border-b border-line last:border-0">
                        <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
                          {k.title}
                          <span className="text-[11px] text-dim font-normal ml-auto">{fmtDate(k.created_at)}</span>
                        </summary>
                        <p className="text-xs text-dim whitespace-pre-wrap mt-2 leading-relaxed">{k.content.slice(0, 2000)}</p>
                      </details>
                    ))}
                  </div>

                  <div className="card p-5 flex items-center gap-3 text-sm text-dim">
                    <MessageSquareText size={16} className="text-oak shrink-0" />
                    Сообщений в чатах проектов: <span className="num font-semibold text-ink">{messagesCount}</span>. Полная переписка доступна внутри каждого проекта.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
