import type { Component, Project, ProjectItem, ProjectStatus } from "./types";

export function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".").replace(/\s/g, "")) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function money(v: number, currency: string): string {
  return `${Math.round(v).toLocaleString("ru-RU")} ${currency}`;
}

export function fmt(v: number): string {
  const r = Math.round(v * 100) / 100;
  return r.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export function componentSum(c: Component): number {
  return num(c.qty) * num(c.price);
}

export function itemTotal(item: ProjectItem): number {
  const per = item.components.reduce((s, c) => s + componentSum(c), 0);
  return per * Math.max(1, num(item.qty) || 1);
}

export type Totals = {
  materials: number;
  fittings: number;
  labor: number;
  base: number;
  markupAmount: number;
  afterMarkup: number;
  discountAmount: number;
  subtotal: number;
  vatAmount: number;
  total: number;
  clientFactor: number;
};

export function projectTotals(p: Project): Totals {
  let materials = 0;
  let fittings = 0;
  let labor = 0;
  for (const item of p.items) {
    const q = Math.max(1, num(item.qty) || 1);
    for (const c of item.components) {
      const s = componentSum(c) * q;
      if (c.type === "labor") labor += s;
      else if (c.type === "fitting") fittings += s;
      else materials += s;
    }
  }
  const base = materials + fittings + labor;
  const markupAmount = (base * num(p.markup)) / 100;
  const afterMarkup = base + markupAmount;
  const discountAmount = (afterMarkup * num(p.discount)) / 100;
  const k = num(p.coefficient) > 0 ? num(p.coefficient) : 1;
  const subtotal = (afterMarkup - discountAmount) * k;
  const rate = num(p.vat_rate);
  let vatAmount = 0;
  let total = subtotal;
  if (rate > 0) {
    if (p.vat_included) {
      vatAmount = (subtotal * rate) / (100 + rate);
      total = subtotal;
    } else {
      vatAmount = (subtotal * rate) / 100;
      total = subtotal + vatAmount;
    }
  }
  const clientFactor = base > 0 ? subtotal / base : 1;
  return {
    materials,
    fittings,
    labor,
    base,
    markupAmount,
    afterMarkup,
    discountAmount,
    subtotal,
    vatAmount,
    total,
    clientFactor
  };
}

const ONES_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = [
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать"
];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

function triad(n: number, female: boolean): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t) parts.push(TENS[t]);
    if (o) parts.push(female ? ONES_F[o] : ONES_M[o]);
  }
  return parts.join(" ");
}

const SCALES: Array<{ female: boolean; forms: [string, string, string] }> = [
  { female: false, forms: ["", "", ""] },
  { female: true, forms: ["тысяча", "тысячи", "тысяч"] },
  { female: false, forms: ["миллион", "миллиона", "миллионов"] },
  { female: false, forms: ["миллиард", "миллиарда", "миллиардов"] }
];

export function numberToWordsRu(value: number): string {
  const n = Math.abs(Math.trunc(value));
  if (n === 0) return "ноль";
  const groups: number[] = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    const scale = SCALES[i] ?? SCALES[3];
    const t = triad(g, scale.female);
    if (t) words.push(t);
    if (i > 0) words.push(plural(g, scale.forms));
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

type CurrencyForms = {
  int: [string, string, string];
  frac: [string, string, string];
};

function currencyForms(currency: string): CurrencyForms {
  switch (currency) {
    case "₽":
      return { int: ["рубль", "рубля", "рублей"], frac: ["копейка", "копейки", "копеек"] };
    case "$":
      return { int: ["доллар", "доллара", "долларов"], frac: ["цент", "цента", "центов"] };
    case "€":
      return { int: ["евро", "евро", "евро"], frac: ["цент", "цента", "центов"] };
    case "₸":
      return { int: ["тенге", "тенге", "тенге"], frac: ["тиын", "тиына", "тиынов"] };
    default:
      return { int: ["у.е.", "у.е.", "у.е."], frac: ["сотая", "сотых", "сотых"] };
  }
}

export function amountInWords(value: number, currency: string): string {
  const forms = currencyForms(currency);
  const abs = Math.round(Math.abs(value) * 100) / 100;
  const intPart = Math.trunc(abs);
  const fracPart = Math.round((abs - intPart) * 100);
  const words = numberToWordsRu(intPart);
  const capital = words.charAt(0).toUpperCase() + words.slice(1);
  const fracStr = String(fracPart).padStart(2, "0");
  return `${capital} ${plural(intPart, forms.int)} ${fracStr} ${plural(fracPart, forms.frac)}`;
}

export const STATUS_META: Record<ProjectStatus, { label: string; cls: string }> = {
  draft: { label: "Черновик", cls: "bg-line/60 text-ink" },
  sent: { label: "Отправлен", cls: "bg-sky-100 text-sky-900" },
  approved: { label: "Согласован", cls: "bg-emerald-100 text-emerald-900" },
  production: { label: "В производстве", cls: "bg-amber-100 text-amber-900" },
  done: { label: "Завершён", cls: "bg-lacquer text-oaklight" },
  cancelled: { label: "Отменён", cls: "bg-red-100 text-red-900" }
};

export const STATUS_ORDER: ProjectStatus[] = ["draft", "sent", "approved", "production", "done", "cancelled"];

export const ITEM_COLORS = ["#B67F2E", "#7A5533", "#CC3E00", "#8C8577", "#5B4632", "#A3773F", "#E0762E", "#6E5A3E"];

export function dims(item: ProjectItem): string {
  const parts = [item.width, item.height, item.depth].map((v) => (num(v) ? String(Math.round(num(v))) : "—"));
  return parts.join("×");
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function contractNumber(p: Project): string {
  const year = new Date(p.created_at || Date.now()).getFullYear().toString().slice(2);
  return `${p.number}-${year}`;
}
