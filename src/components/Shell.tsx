"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Calculator,
  FolderOpen,
  LogOut,
  Menu,
  MonitorDown,
  Settings,
  Sparkles,
  Tags,
  X
, Users,
  Wrench
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const NAV = [
  { href: "/", label: "Новый расчёт", icon: Calculator },
  { href: "/projects", label: "Проекты", icon: FolderOpen },
  { href: "/prices", label: "Прайс-лист", icon: Tags },
  { href: "/design", label: "Дизайн-студия", icon: Sparkles },
  { href: "/analytics", label: "Аналитика", icon: BarChart3 },
  { href: "/employees", label: "Сотрудники", icon: Users, ownerOnly: true },
  { href: "/developer", label: "Разработчик", icon: Wrench, ownerOnly: true },
  { href: "/settings", label: "Настройки", icon: Settings }
];

export default function Shell({ email, displayName, role, children }: { email: string; displayName: string; role: "owner" | "staff"; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<any>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const nav = (
    <nav className="flex-1 px-3 space-y-1">
      {NAV.filter((n: any) => !n.ownerOnly || role === "owner").map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              active ? "bg-brand text-white shadow-soft" : "text-oaklight/60 hover:text-oaklight hover:bg-white/5"
            }`}
          >
            <span className={`w-1 h-5 rounded-full -ml-1 ${active ? "bg-white/80" : "bg-transparent"}`} />
            <Icon size={17} className={active ? "text-white" : ""} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="px-4 pb-5 space-y-3">
      {installEvent && (
        <button
          className="w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm text-oaklight/80 bg-white/5 hover:bg-white/10 transition-colors"
          onClick={async () => {
            installEvent.prompt();
            await installEvent.userChoice;
            setInstallEvent(null);
          }}
        >
          <MonitorDown size={16} className="text-oak" />
          Установить приложение
        </button>
      )}
      <div className="border-t border-white/10 pt-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-oaklight/40">Сотрудник</div>
          <div className="text-sm text-oaklight/80 truncate">{displayName}</div>
          <div className="text-[11px] text-oaklight/50 truncate">{role === "owner" ? "Руководитель" : `ID ${email.split("@")[0]}`}</div>
        </div>
        <button
          className="p-2 rounded-lg text-oaklight/60 hover:text-oaklight hover:bg-white/10 transition-colors shrink-0"
          title="Выйти"
          onClick={() => supabase.auth.signOut()}
        >
          <LogOut size={17} />
        </button>
      </div>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-3 px-6 pt-6 pb-7">
      <div className="w-10 h-10 rounded-xl bg-oak/20 border border-oak/40 grid place-items-center shrink-0">
        <span className="font-display text-oaklight text-xl leading-none pb-0.5">L</span>
      </div>
      <div>
        <div className="font-display text-lg tracking-wide text-oaklight">LINDEN</div>
        <div className="text-[10px] uppercase tracking-[0.28em] text-oaklight/50">Расчётный центр</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px,1fr]">
      <aside className="hidden lg:flex flex-col bg-lacquer sticky top-0 h-screen">
        {brand}
        {nav}
        {footer}
      </aside>

      <div className="lg:hidden sticky top-0 z-40 bg-lacquer text-oaklight flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-oak/20 border border-oak/40 grid place-items-center">
            <span className="font-display text-base leading-none pb-0.5">L</span>
          </div>
          <span className="font-display tracking-wide">LINDEN</span>
        </div>
        <button className="p-2" onClick={() => setOpen(true)} aria-label="Меню">
          <Menu size={22} />
        </button>
      </div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-lacquer flex flex-col fade-up">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button className="p-2 text-oaklight/70" onClick={() => setOpen(false)} aria-label="Закрыть">
                <X size={20} />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}

      <main className="min-w-0 px-4 sm:px-8 lg:px-10 py-6 lg:py-9 max-w-[1400px] w-full mx-auto">{children}</main>
    </div>
  );
}
