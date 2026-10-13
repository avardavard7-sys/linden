"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, CircleDollarSign, FolderOpen, Hammer } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import { fmt, money, num, projectTotals } from "@/lib/calc";
import { supabase } from "@/lib/supabase";
import type { Project } from "@/lib/types";

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export default function AnalyticsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currency, setCurrency] = useState("₸");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("projects").select("*"),
      supabase.from("app_settings").select("currency").eq("id", 1).single()
    ]).then(([{ data }, { data: s }]) => {
      if (!alive) return;
      setProjects((data ?? []) as Project[]);
      if (s?.currency) setCurrency(s.currency);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => {
    const real = projects.filter((p) => p.status !== "cancelled");
    const active = projects.filter((p) => p.status === "approved" || p.status === "production");
    const now = new Date();
    let monthSum = 0;
    let totalSum = 0;
    for (const p of real) {
      const t = projectTotals(p).total;
      totalSum += t;
      const d = new Date(p.created_at);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) monthSum += t;
    }
    const avg = real.length ? totalSum / real.length : 0;

    const bars: Array<{ label: string; value: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      let sum = 0;
      for (const p of real) {
        const pd = new Date(p.created_at);
        if (pd.getFullYear() === d.getFullYear() && pd.getMonth() === d.getMonth()) sum += projectTotals(p).total;
      }
      bars.push({ label: MONTHS[d.getMonth()], value: sum });
    }

    const mat = new Map<string, number>();
    for (const p of real) {
      for (const it of p.items) {
        const q = Math.max(1, num(it.qty) || 1);
        for (const c of it.components) {
          if (c.type !== "material") continue;
          mat.set(c.name, (mat.get(c.name) ?? 0) + num(c.qty) * num(c.price) * q);
        }
      }
    }
    const topMaterials = Array.from(mat.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7);

    return { total: projects.length, active: active.length, monthSum, avg, bars, topMaterials };
  }, [projects]);

  const maxBar = Math.max(1, ...stats.bars.map((b) => b.value));
  const maxMat = Math.max(1, ...stats.topMaterials.map(([, v]) => v));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div className="fade-up">
      <PageTitle title="Аналитика" subtitle="Деньги, загрузка производства и материалы, на которые уходит бюджет." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 text-dim text-sm mb-2">
            <FolderOpen size={15} />
            Всего проектов
          </div>
          <p className="num font-display text-3xl font-semibold">{stats.total}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-dim text-sm mb-2">
            <Hammer size={15} />
            В работе
          </div>
          <p className="num font-display text-3xl font-semibold">{stats.active}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-dim text-sm mb-2">
            <CircleDollarSign size={15} />
            Сумма за месяц
          </div>
          <p className="num font-display text-3xl font-semibold">{money(stats.monthSum, currency)}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-dim text-sm mb-2">
            <BarChart3 size={15} />
            Средний чек
          </div>
          <p className="num font-display text-3xl font-semibold">{money(stats.avg, currency)}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="font-display text-xl mb-5">Суммы расчётов, 6 месяцев</h3>
          <div className="flex items-end gap-3 h-48">
            {stats.bars.map((b, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                <span className="num text-[11px] text-dim">{b.value ? fmt(Math.round(b.value / 1000)) + "к" : ""}</span>
                <div className="w-full rounded-t-md bg-oak/85 transition-all" style={{ height: `${Math.max(2, (b.value / maxBar) * 100)}%` }} />
                <span className="text-xs text-dim">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-display text-xl mb-5">Топ материалов по затратам</h3>
          {stats.topMaterials.length === 0 && <p className="text-sm text-dim">Появится после первых расчётов.</p>}
          <div className="space-y-3">
            {stats.topMaterials.map(([name, value]) => (
              <div key={name}>
                <div className="flex justify-between text-sm mb-1 gap-3">
                  <span className="truncate">{name}</span>
                  <span className="num text-dim shrink-0">{money(value, currency)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-line/70 overflow-hidden">
                  <div className="h-full bg-lacquer rounded-full" style={{ width: `${(value / maxMat) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
