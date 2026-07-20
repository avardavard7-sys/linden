"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, PlusCircle, Search, Trash2 } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import { useToast } from "@/components/Toast";
import { fmtDate, money, projectTotals, STATUS_META, STATUS_ORDER } from "@/lib/calc";
import { supabase } from "@/lib/supabase";
import type { Project, ProjectStatus } from "@/lib/types";

export default function ProjectsPage() {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [currency, setCurrency] = useState("₸");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [{ data }, { data: s }] = await Promise.all([
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("app_settings").select("currency").eq("id", 1).single()
    ]);
    setProjects((data ?? []) as Project[]);
    if (s?.currency) setCurrency(s.currency);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return projects.filter((p) => {
      if (status !== "all" && p.status !== status) return false;
      if (!q) return true;
      return [p.name, p.client_name, p.client_company, p.client_phone, String(p.number)].join(" ").toLowerCase().includes(q);
    });
  }, [projects, query, status]);

  async function remove(p: Project) {
    if (!confirm(`Удалить проект «${p.name}» безвозвратно?`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", p.id);
    if (error) {
      toast("Не удалось удалить проект.", "error");
      return;
    }
    setProjects((prev) => prev.filter((x) => x.id !== p.id));
    toast("Проект удалён.", "ok");
  }

  return (
    <div className="fade-up">
      <PageTitle
        title="Проекты"
        subtitle="Все расчёты компании: от черновика до подписанного акта."
        right={
          <Link href="/" className="btn-primary">
            <PlusCircle size={16} /> Новый расчёт
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input className="input pl-9" placeholder="Поиск по названию, клиенту, номеру…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className={`pill border ${status === "all" ? "bg-lacquer text-oaklight border-lacquer" : "border-line bg-card text-dim hover:border-linehard"}`} onClick={() => setStatus("all")}>
            Все
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              className={`pill border ${status === s ? "bg-lacquer text-oaklight border-lacquer" : "border-line bg-card text-dim hover:border-linehard"}`}
              onClick={() => setStatus(s)}
            >
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card p-10 grid place-items-center text-dim">
          <span className="spinner text-oak" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="font-display text-2xl mb-2">Здесь пока пусто</div>
          <p className="text-sm text-dim mb-5">Загрузите первый проект клиента — расчёт займёт пару минут.</p>
          <Link href="/" className="btn-primary inline-flex">
            Создать расчёт <ArrowRight size={15} />
          </Link>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-dim border-b border-line">
                <th className="px-4 py-3 font-semibold">№</th>
                <th className="px-4 py-3 font-semibold">Проект</th>
                <th className="px-4 py-3 font-semibold">Клиент</th>
                <th className="px-4 py-3 font-semibold">Дата</th>
                <th className="px-4 py-3 font-semibold text-right">Позиций</th>
                <th className="px-4 py-3 font-semibold text-right">Сумма</th>
                <th className="px-4 py-3 font-semibold">Статус</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const t = projectTotals(p);
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-oaklight/25 transition-colors">
                    <td className="px-4 py-3 num text-dim">{p.number}</td>
                    <td className="px-4 py-3">
                      <Link href={`/projects/${p.id}`} className="font-semibold hover:text-oakdark">
                        {p.name}
                      </Link>
                      {p.area ? <span className="text-xs text-dim num ml-2">{p.area} м²</span> : null}
                    </td>
                    <td className="px-4 py-3 text-dim">{p.client_company || p.client_name || "—"}</td>
                    <td className="px-4 py-3 num text-dim">{fmtDate(p.created_at)}</td>
                    <td className="px-4 py-3 num text-right">{p.items.length}</td>
                    <td className="px-4 py-3 num text-right font-semibold">{money(t.total, currency)}</td>
                    <td className="px-4 py-3">
                      <span className={`pill ${STATUS_META[p.status].cls}`}>{STATUS_META[p.status].label}</span>
                    </td>
                    <td className="px-2 py-3">
                      <button className="p-2 rounded-lg text-dim hover:text-red-800 hover:bg-red-50" onClick={() => remove(p)} aria-label="Удалить">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
