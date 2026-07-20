"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { IdCard, KeyRound, LogIn, UserRound } from "lucide-react";
import { identityFromSession, staffEmail } from "@/lib/identity";
import { supabase } from "@/lib/supabase";
import Shell from "./Shell";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center bg-paper">
        <div className="flex flex-col items-center gap-4">
          <Monogram />
          <div className="spinner text-oak" />
        </div>
      </div>
    );
  }

  if (!session) return <Login />;
  const identity = identityFromSession(session);
  return (
    <Shell email={session.user.email ?? ""} displayName={identity.name} role={identity.role}>
      {children}
    </Shell>
  );
}

function Monogram() {
  return (
    <div className="w-14 h-14 rounded-2xl bg-lacquer grid place-items-center shadow-soft">
      <span className="font-display text-oaklight text-3xl leading-none pb-1">L</span>
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState<"owner" | "staff">("owner");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password) {
      setError("Введите e-mail и пароль.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      setError("Неверный e-mail или пароль.");
      setBusy(false);
    }
  }

  async function submitStaff() {
    const id = code.trim();
    if (!id) {
      setError("Введите ID сотрудника.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email: staffEmail(id), password: id });
    if (err) {
      setError("Неверный ID. Проверьте код у руководителя.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr,1fr]">
      <div className="hidden lg:flex flex-col justify-between bg-lacquer text-oaklight p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent 0 79px, currentColor 79px 80px)" }} />
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-oak/20 border border-oak/40 grid place-items-center">
            <span className="font-display text-2xl leading-none pb-0.5">L</span>
          </div>
          <div>
            <div className="font-display text-xl tracking-wide">LINDEN</div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-oaklight/60">Расчётный центр</div>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="font-display text-5xl leading-[1.08] mb-6">
            Смета, договор и чек-лист — за минуты, а не за дни.
          </h1>
          <div className="dimline opacity-40 mb-6" style={{ background: "currentColor" }} />
          <p className="text-oaklight/70 leading-relaxed">
            Загрузите проект клиента — система сопоставит его с прайсом фабрики, рассчитает материалы, фурнитуру и работы, подготовит полный пакет документов в Word.
          </p>
        </div>
        <div className="relative text-[11px] uppercase tracking-[0.25em] text-oaklight/40">
          Проектирование · Расчёт · Производство
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm fade-up">
          <div className="lg:hidden flex justify-center mb-8">
            <Monogram />
          </div>
          <h2 className="font-display text-3xl mb-1">Вход в систему</h2>
          <p className="text-sm text-dim mb-6">Доступ только для сотрудников компании.</p>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-line/50 mb-6">
            <button
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${mode === "owner" ? "bg-card shadow-soft text-ink" : "text-dim hover:text-ink"}`}
              onClick={() => {
                setMode("owner");
                setError("");
              }}
            >
              <UserRound size={14} />
              Руководитель
            </button>
            <button
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${mode === "staff" ? "bg-card shadow-soft text-ink" : "text-dim hover:text-ink"}`}
              onClick={() => {
                setMode("staff");
                setError("");
              }}
            >
              <IdCard size={14} />
              Сотрудник
            </button>
          </div>
          {mode === "staff" ? (
            <div className="space-y-4">
              <div>
                <label className="label">ID сотрудника</label>
                <input
                  className="input num text-center tracking-[0.3em]"
                  inputMode="numeric"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitStaff()}
                />
              </div>
              {error && <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
              <button className="btn-primary w-full" onClick={submitStaff} disabled={busy}>
                {busy ? <span className="spinner" /> : <LogIn size={16} />}
                Войти по ID
              </button>
              <p className="text-xs text-dim flex items-start gap-1.5 pt-2">
                <KeyRound size={13} className="mt-0.5 shrink-0" />
                ID выдаёт руководитель в разделе «Сотрудники».
              </p>
            </div>
          ) : (
          <div className="space-y-4">
            <div>
              <label className="label">E-mail</label>
              <input
                className="input"
                type="email"
                autoComplete="username"
                placeholder="name@company.kz"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            <div>
              <label className="label">Пароль</label>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            {error && <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
            <button className="btn-primary w-full" onClick={submit} disabled={busy}>
              {busy ? <span className="spinner" /> : <LogIn size={16} />}
              Войти
            </button>
            <p className="text-xs text-dim flex items-start gap-1.5 pt-2">
              <KeyRound size={13} className="mt-0.5 shrink-0" />
              Сменить пароль можно после входа в разделе «Настройки → Безопасность».
            </p>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
