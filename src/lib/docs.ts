import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  ImageRun,
  PageOrientation,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from "docx";
import { fetchImageBytes } from "./images";
import { amountInWords, contractNumber, dims, fmt, fmtDate, itemTotal, money, num, numberToWordsRu, plural, projectTotals } from "./calc";
import type { Project, ProjectItem, Settings } from "./types";

const LACQUER = "26382E";
const OAK = "97671F";
const DIM = "6F675A";
const LINE = "D8D2C2";

type RunOpts = { bold?: boolean; size?: number; color?: string; italics?: boolean; font?: string };
type ParaOpts = { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; before?: number; after?: number };

function kit(baseFont: string) {
  const t = (text: string, o: RunOpts = {}) =>
    new TextRun({
      text,
      font: o.font ?? baseFont,
      size: o.size ?? 22,
      bold: o.bold,
      color: o.color,
      italics: o.italics
    });
  const p = (content: string | TextRun[], o: ParaOpts = {}) =>
    new Paragraph({
      children: typeof content === "string" ? [t(content)] : content,
      alignment: o.align,
      spacing: { before: o.before ?? 0, after: o.after ?? 120 }
    });
  return { t, p };
}

const thinBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  left: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  right: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: LINE }
};

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }
};

function cell(children: Paragraph[], width: number, opts: { shade?: string } = {}) {
  return new TableCell({
    children,
    width: { size: width, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    ...(opts.shade ? { shading: { fill: opts.shade } } : {})
  });
}

function buildDoc(font: string, children: (Paragraph | Table)[]) {
  return new Document({
    styles: { default: { document: { run: { font, size: 22 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1100, right: 900, bottom: 1100, left: 1250 } } },
        children
      }
    ]
  });
}

async function save(doc: Document, filename: string) {
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, "·");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function clientDisplay(p: Project): string {
  if (p.client_company && p.client_name) return `${p.client_company}, ${p.client_name}`;
  return p.client_company || p.client_name || "________________________";
}

function itemDescr(item: ProjectItem): string {
  const d = dims(item);
  const parts: string[] = [];
  if (d !== "—×—×—") parts.push(`Габариты (Ш×В×Г): ${d} мм`);
  if (item.room) parts.push(item.room);
  return parts.join(" · ");
}

function specTable(project: Project, factor: number, currency: string, font: string): Table {
  const { t } = kit(font);
  const header = new TableRow({
    tableHeader: true,
    children: [
      cell([new Paragraph({ children: [t("№", { bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.CENTER })], 6, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Наименование", { bold: true, color: "FFFFFF", size: 20 })] })], 46, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Кол-во", { bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.CENTER })], 9, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Ед.", { bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.CENTER })], 7, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Цена", { bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.RIGHT })], 16, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Сумма", { bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.RIGHT })], 16, { shade: LACQUER })
    ]
  });
  const rows = project.items.map((item, i) => {
    const qty = Math.max(1, num(item.qty) || 1);
    const total = itemTotal(item) * factor;
    const unitPrice = total / qty;
    const descr = itemDescr(item);
    const namePar: Paragraph[] = [new Paragraph({ children: [t(item.name, { bold: true })], spacing: { after: descr ? 40 : 0 } })];
    if (descr) namePar.push(new Paragraph({ children: [t(descr, { size: 18, color: DIM })] }));
    return new TableRow({
      children: [
        cell([new Paragraph({ children: [t(String(i + 1))], alignment: AlignmentType.CENTER })], 6),
        cell(namePar, 46),
        cell([new Paragraph({ children: [t(fmt(qty))], alignment: AlignmentType.CENTER })], 9),
        cell([new Paragraph({ children: [t("шт")], alignment: AlignmentType.CENTER })], 7),
        cell([new Paragraph({ children: [t(money(unitPrice, currency))], alignment: AlignmentType.RIGHT })], 16),
        cell([new Paragraph({ children: [t(money(total, currency))], alignment: AlignmentType.RIGHT })], 16)
      ]
    });
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: thinBorders, rows: [header, ...rows] });
}

function totalsBlock(project: Project, currency: string, font: string): Paragraph[] {
  const { t, p } = kit(font);
  const tt = projectTotals(project);
  const out: Paragraph[] = [];
  const line = (label: string, value: string, bold = false, big = false) =>
    p([t(`${label}  `, { color: DIM, size: big ? 24 : 22 }), t(value, { bold, size: big ? 28 : 22 })], {
      align: AlignmentType.RIGHT,
      after: 60
    });
  out.push(line("Итого по спецификации:", money(tt.subtotal, currency)));
  if (num(project.vat_rate) > 0 && !project.vat_included) {
    out.push(line(`НДС ${fmt(num(project.vat_rate))}%:`, money(tt.vatAmount, currency)));
  }
  out.push(line("ВСЕГО К ОПЛАТЕ:", money(tt.total, currency), true, true));
  if (num(project.vat_rate) > 0 && project.vat_included) {
    out.push(p([t(`в том числе НДС ${fmt(num(project.vat_rate))}%: ${money(tt.vatAmount, currency)}`, { size: 18, color: DIM })], { align: AlignmentType.RIGHT, after: 60 }));
  }
  out.push(p([t(amountInWords(tt.total, currency), { italics: true, size: 20, color: DIM })], { align: AlignmentType.RIGHT, after: 200 }));
  return out;
}

function textBlock(text: string, font: string): Paragraph[] {
  const { t } = kit(font);
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(
      (s) =>
        new Paragraph({
          children: [t(s)],
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 120 }
        })
    );
}

function heading(text: string, font: string, opts: { size?: number; before?: number } = {}): Paragraph {
  const { t } = kit(font);
  return new Paragraph({
    children: [t(text.toUpperCase(), { bold: true, size: opts.size ?? 24, color: LACQUER })],
    spacing: { before: opts.before ?? 260, after: 130 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE } }
  });
}

function companyHeader(project: Project, settings: Settings, title: string, font: string): (Paragraph | Table)[] {
  const { t, p } = kit(font);
  const c = settings.company;
  const left: Paragraph[] = [
    new Paragraph({ children: [t(c.name || "Мебельная студия", { bold: true, size: 30, color: LACQUER })], spacing: { after: 60 } })
  ];
  const info = [c.address, c.bin ? `БИН ${c.bin}` : "", [c.phone, c.email].filter(Boolean).join(" · ")].filter(Boolean);
  for (const line of info) left.push(new Paragraph({ children: [t(line, { size: 18, color: DIM })], spacing: { after: 30 } }));
  const right: Paragraph[] = [
    new Paragraph({ children: [t(title, { bold: true, size: 26 })], alignment: AlignmentType.RIGHT, spacing: { after: 60 } }),
    new Paragraph({
      children: [t(`№ ${contractNumber(project)} от ${fmtDate(project.created_at)}`, { size: 20, color: DIM })],
      alignment: AlignmentType.RIGHT
    })
  ];
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: [new TableRow({ children: [cell(left, 55), cell(right, 45)] })]
  });
  return [table, p([t("", { size: 8 })], { after: 160 })];
}

const KP_BLACK = "141414";
const KP_ORANGE = "E08A2E";
const KP_PANEL = "C4C4C4";
const KP_SILVER = "B7B7B7";
const KP_RED = "E03030";

const DECK_WIDTH = 16272;
const DECK_HEIGHT = 10820;
const DECK_BODY = 15592;

const blackBorders = {
  top: { style: BorderStyle.SINGLE, size: 2, color: KP_BLACK },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: KP_BLACK },
  left: { style: BorderStyle.SINGLE, size: 2, color: KP_BLACK },
  right: { style: BorderStyle.SINGLE, size: 2, color: KP_BLACK },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: KP_BLACK },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: KP_BLACK }
};

function deckPage(children: (Paragraph | Table)[]): Table {
  return new Table({
    width: { size: DECK_WIDTH, type: WidthType.DXA },
    columnWidths: [DECK_WIDTH],
    layout: TableLayoutType.FIXED,
    borders: blackBorders,
    rows: [
      new TableRow({
        height: { value: DECK_HEIGHT, rule: HeightRule.EXACT },
        children: [
          new TableCell({
            children,
            width: { size: DECK_WIDTH, type: WidthType.DXA },
            shading: { fill: KP_BLACK },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 200, bottom: 200, left: 340, right: 340 }
          })
        ]
      })
    ]
  });
}

function pageGap(): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: "", size: 2 }), new PageBreak()],
    spacing: { before: 0, after: 0, line: 20 }
  });
}

function coverPage(companyName: string, font: string, caption?: string): Table {
  const { t } = kit(font);
  const logoBox = new Table({
    width: { size: 5200, type: WidthType.DXA },
    columnWidths: [5200],
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 18, color: KP_SILVER },
      bottom: { style: BorderStyle.SINGLE, size: 18, color: KP_SILVER },
      left: { style: BorderStyle.SINGLE, size: 18, color: KP_SILVER },
      right: { style: BorderStyle.SINGLE, size: 18, color: KP_SILVER },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: KP_BLACK },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: KP_BLACK }
    },
    rows: [
      new TableRow({
        height: { value: 3600, rule: HeightRule.EXACT },
        children: [
          new TableCell({
            width: { size: 5200, type: WidthType.DXA },
            shading: { fill: KP_BLACK },
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { top: 120, bottom: 220, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: [t(companyName.toUpperCase(), { bold: true, size: 72, color: KP_SILVER })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 20 }
              }),
              new Paragraph({
                children: [t("М Е Б Е Л Ь Н А Я   К О М П А Н И Я", { size: 15, color: KP_SILVER })],
                alignment: AlignmentType.CENTER
              })
            ]
          })
        ]
      })
    ]
  });
  const children: (Paragraph | Table)[] = [
    logoBox,
    new Paragraph({ children: [t("", { size: 10 })], spacing: { after: 500 } }),
    new Paragraph({
      children: [t(`WELCOME TO ${companyName.toUpperCase()} COMPANY`, { size: 40, color: KP_SILVER })],
      alignment: AlignmentType.CENTER
    })
  ];
  if (caption) {
    children.push(
      new Paragraph({ children: [t(caption, { size: 17, color: "6E6E6E" })], alignment: AlignmentType.CENTER, spacing: { before: 460 } })
    );
  }
  return deckPage(children);
}

function summaryPage(text: string, font: string): Table {
  const { t } = kit(font);
  const paras = text
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [t("О   П Р О Е К Т Е", { size: 22, color: KP_SILVER })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 520 }
    })
  ];
  for (const para of paras) {
    children.push(
      new Paragraph({
        children: [t(para, { size: 24, color: "E8E8E8" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 220, line: 340 }
      })
    );
  }
  return deckPage(children);
}

function itemPage(
  item: ProjectItem,
  image: { data: Uint8Array; width: number; height: number } | null,
  factor: number,
  currency: string,
  font: string
): Table {
  const { t } = kit(font);
  const qty = Math.max(1, num(item.qty) || 1);
  const total = itemTotal(item) * factor;

  const imageChildren: Paragraph[] = [];
  if (image) {
    const boxW = 340;
    const boxH = 560;
    const ratio = Math.min(boxW / image.width, boxH / image.height);
    imageChildren.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: image.data,
            transformation: { width: Math.round(image.width * ratio), height: Math.round(image.height * ratio) }
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 }
      })
    );
  } else {
    imageChildren.push(
      new Paragraph({
        children: [t("Изображение не добавлено", { size: 18, color: "8A8A8A" })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 }
      })
    );
  }

  const specChildren: Paragraph[] = [
    new Paragraph({ children: [t(item.name.toUpperCase(), { bold: true, size: 26 })], spacing: { after: 200 } })
  ];
  const lines = (item.spec || "")
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const line of lines) {
    specChildren.push(new Paragraph({ children: [t(line, { size: 21 })], spacing: { after: 60 } }));
  }
  const meta: string[] = [];
  const d = dims(item);
  if (d !== "—×—×—") meta.push(`${d} мм`);
  if (item.room) meta.push(item.room);
  if (qty > 1) meta.push(`${fmt(qty)} шт`);
  if (meta.length) {
    specChildren.push(
      new Paragraph({ children: [t(meta.join("   ·   "), { size: 17, color: "5A5A5A" })], spacing: { before: 200 } })
    );
  }

  const priceChildren: Paragraph[] = [
    new Paragraph({
      children: [t(`${item.price_from ? "от " : ""}${money(total, currency)}`, { bold: true, size: 30, color: "FFFFFF" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 0 }
    })
  ];
  if (qty > 1) {
    priceChildren.push(
      new Paragraph({
        children: [t(`${money(total / qty, currency)} × ${fmt(qty)}`, { size: 16, color: "F0F0F0" })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 70 }
      })
    );
  }

  const body = new Table({
    width: { size: DECK_BODY, type: WidthType.DXA },
    columnWidths: [5400, 320, 6400, 170, 3302],
    layout: TableLayoutType.FIXED,
    borders: blackBorders,
    rows: [
      new TableRow({
        height: { value: 8800, rule: HeightRule.EXACT },
        children: [
          new TableCell({
            children: imageChildren,
            width: { size: 5400, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 14, color: KP_ORANGE },
              bottom: { style: BorderStyle.SINGLE, size: 14, color: KP_ORANGE },
              left: { style: BorderStyle.SINGLE, size: 14, color: KP_ORANGE },
              right: { style: BorderStyle.SINGLE, size: 14, color: KP_ORANGE }
            }
          }),
          new TableCell({
            children: [new Paragraph({ children: [t("", { size: 8 })] })],
            width: { size: 320, type: WidthType.DXA },
            shading: { fill: KP_BLACK }
          }),
          new TableCell({
            children: specChildren,
            width: { size: 6400, type: WidthType.DXA },
            shading: { fill: KP_PANEL },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 300, bottom: 300, left: 400, right: 300 }
          }),
          new TableCell({
            children: [new Paragraph({ children: [t("", { size: 8 })] })],
            width: { size: 170, type: WidthType.DXA },
            shading: { fill: KP_BLACK }
          }),
          new TableCell({
            children: priceChildren,
            width: { size: 3302, type: WidthType.DXA },
            shading: { fill: KP_PANEL },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 300, bottom: 300, left: 200, right: 200 }
          })
        ]
      })
    ]
  });

  return deckPage([
    new Paragraph({
      children: [t("Ц Е Н О В О Е   П Р Е Д Л О Ж Е Н И Е", { size: 22, color: KP_SILVER })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 420 }
    }),
    body
  ]);
}

function totalPage(project: Project, settings: Settings, tt: ReturnType<typeof projectTotals>, font: string): Table {
  const { t } = kit(font);
  const currency = settings.currency;
  const days = num(settings.production_days) || 40;
  const wm = num(settings.warranty_months) || 12;
  const c = settings.company;

  const bannerChildren: Paragraph[] = [
    new Paragraph({ children: [t("ОБЩАЯ СТОИМОСТЬ", { size: 26 })], alignment: AlignmentType.CENTER, spacing: { after: 140 } }),
    new Paragraph({ children: [t(money(tt.total, currency), { bold: true, size: 76 })], alignment: AlignmentType.CENTER, spacing: { after: 160 } })
  ];
  if (num(project.vat_rate) > 0) {
    bannerChildren.push(
      new Paragraph({
        children: [
          t(
            project.vat_included
              ? `в том числе НДС ${fmt(num(project.vat_rate))}%: ${money(tt.vatAmount, currency)}`
              : `включая НДС ${fmt(num(project.vat_rate))}%: ${money(tt.vatAmount, currency)}`,
            { size: 18, color: "555555" }
          )
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 140 }
      })
    );
  }
  bannerChildren.push(
    new Paragraph({
      children: [t(`ДОСТАВКА И СБОРКА ВХОДЯТ В СТОИМОСТЬ    |    ГАРАНТИЯ — ${fmt(wm)} ${plural(wm, ["МЕСЯЦ", "МЕСЯЦА", "МЕСЯЦЕВ"]).toUpperCase()}`, { size: 24 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 }
    }),
    new Paragraph({
      children: [t(`СРОК ИЗГОТОВЛЕНИЯ — ОТ ${fmt(days)} ${plural(days, ["ДНЯ", "ДНЕЙ", "ДНЕЙ"]).toUpperCase()}`, { size: 24 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 90 }
    }),
    new Paragraph({
      children: [t("*цена может меняться, так как внутреннее наполнение и отдельные моменты могут меняться", { size: 18, color: KP_RED })],
      alignment: AlignmentType.CENTER
    })
  );

  const banner = new Table({
    width: { size: DECK_BODY, type: WidthType.DXA },
    columnWidths: [DECK_BODY],
    layout: TableLayoutType.FIXED,
    borders: blackBorders,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: bannerChildren,
            width: { size: DECK_BODY, type: WidthType.DXA },
            shading: { fill: "FFFFFF" },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 500, bottom: 500, left: 300, right: 300 }
          })
        ]
      })
    ]
  });

  return deckPage([
    new Paragraph({ children: [t((c.name || "LINDEN").toUpperCase(), { bold: true, size: 44, color: KP_ORANGE })], spacing: { after: 20 } }),
    new Paragraph({ children: [t("МЕБЕЛЬНАЯ КОМПАНИЯ", { size: 14, color: KP_SILVER })], spacing: { after: 520 } }),
    banner,
    new Paragraph({ children: [t(amountInWords(tt.total, currency), { italics: true, size: 17, color: KP_SILVER })], alignment: AlignmentType.CENTER, spacing: { before: 300 } })
  ]);
}

function buildDeck(font: string, children: (Paragraph | Table)[]) {
  return new Document({
    background: { color: KP_BLACK },
    styles: { default: { document: { run: { font, size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 283, right: 283, bottom: 283, left: 283 }
          }
        },
        children
      }
    ]
  });
}

export async function downloadOffer(project: Project, settings: Settings) {
  const font = "Calibri";
  const currency = settings.currency;
  const tt = projectTotals(project);
  const factor = tt.clientFactor;
  const company = settings.company.name || "LINDEN";

  const images = await Promise.all(project.items.map((item) => (item.image_url ? fetchImageBytes(item.image_url) : Promise.resolve(null))));

  const caption = [`Ценовое предложение № ${contractNumber(project)} от ${fmtDate(project.created_at)}`, clientDisplay(project), project.name]
    .filter(Boolean)
    .join("   ·   ");
  const children: (Paragraph | Table)[] = [coverPage(company, font, caption)];
  if (project.ai_summary.trim()) {
    children.push(pageGap());
    children.push(summaryPage(project.ai_summary.trim(), font));
  }
  project.items.forEach((item, i) => {
    children.push(pageGap());
    children.push(itemPage(item, images[i], factor, currency, font));
  });
  children.push(pageGap());
  children.push(totalPage(project, settings, tt, font));
  children.push(pageGap());
  children.push(coverPage(company, font));

  await save(buildDeck(font, children), `КП №${contractNumber(project)} — ${project.name}.docx`);
}

export async function downloadCalculation(project: Project, settings: Settings) {
  const font = "Calibri";
  const { t, p } = kit(font);
  const currency = settings.currency;
  const tt = projectTotals(project);
  const children: (Paragraph | Table)[] = [];
  children.push(...companyHeader(project, settings, "КАЛЬКУЛЯЦИЯ", font));
  children.push(p([t("ВНУТРЕННИЙ ДОКУМЕНТ · не для передачи клиенту", { size: 18, color: OAK, bold: true })], { after: 200 }));
  children.push(p([t("Проект: ", { color: DIM }), t(project.name, { bold: true }), t(`  ·  Заказчик: ${clientDisplay(project)}`, { color: DIM })], { after: 200 }));

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell([new Paragraph({ children: [t("Наименование", { bold: true, color: "FFFFFF", size: 18 })] })], 30, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Расчёт", { bold: true, color: "FFFFFF", size: 18 })] })], 26, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Кол-во", { bold: true, color: "FFFFFF", size: 18 })], alignment: AlignmentType.RIGHT })], 10, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Ед.", { bold: true, color: "FFFFFF", size: 18 })], alignment: AlignmentType.CENTER })], 8, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Цена", { bold: true, color: "FFFFFF", size: 18 })], alignment: AlignmentType.RIGHT })], 13, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Сумма", { bold: true, color: "FFFFFF", size: 18 })], alignment: AlignmentType.RIGHT })], 13, { shade: LACQUER })
    ]
  });

  const typeLabel: Record<string, string> = { material: "материал", fitting: "фурнитура", labor: "работа" };
  for (const item of project.items) {
    const q = Math.max(1, num(item.qty) || 1);
    children.push(
      p([t(item.name, { bold: true, size: 24 }), t(`   ${itemDescr(item)}${q > 1 ? ` · ×${q}` : ""}`, { size: 18, color: DIM })], {
        before: 220,
        after: 100
      })
    );
    const rows = item.components.map(
      (comp) =>
        new TableRow({
          children: [
            cell(
              [
                new Paragraph({ children: [t(comp.name, { size: 18 })], spacing: { after: 20 } }),
                new Paragraph({ children: [t(typeLabel[comp.type] ?? comp.type, { size: 15, color: DIM })] })
              ],
              30
            ),
            cell([new Paragraph({ children: [t(comp.note || "—", { size: 16, color: DIM })] })], 26),
            cell([new Paragraph({ children: [t(fmt(num(comp.qty)), { size: 18 })], alignment: AlignmentType.RIGHT })], 10),
            cell([new Paragraph({ children: [t(comp.unit, { size: 18 })], alignment: AlignmentType.CENTER })], 8),
            cell([new Paragraph({ children: [t(money(num(comp.price), currency), { size: 18 })], alignment: AlignmentType.RIGHT })], 13),
            cell([new Paragraph({ children: [t(money(num(comp.qty) * num(comp.price), currency), { size: 18, bold: true })], alignment: AlignmentType.RIGHT })], 13)
          ]
        })
    );
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: thinBorders, rows: [headerRow, ...rows] }));
    children.push(p([t(`Итого по позиции${q > 1 ? ` (×${q})` : ""}:  `, { color: DIM }), t(money(itemTotal(item), currency), { bold: true })], { align: AlignmentType.RIGHT, before: 80, after: 60 }));
  }

  children.push(heading("Свод затрат", font, { before: 320 }));
  const svod: Array<[string, string, boolean]> = [
    ["Материалы", money(tt.materials, currency), false],
    ["Фурнитура", money(tt.fittings, currency), false],
    ["Работы", money(tt.labor, currency), false],
    ["Себестоимость (база)", money(tt.base, currency), true],
    [`Наценка ${fmt(num(project.markup))}%`, `+${money(tt.markupAmount, currency)}`, false],
    ...(num(project.discount) > 0 ? ([[`Скидка ${fmt(num(project.discount))}%`, `−${money(tt.discountAmount, currency)}`, false]] as Array<[string, string, boolean]>) : []),
    ...(num(project.coefficient) > 0 && num(project.coefficient) !== 1
      ? ([[`Коэффициент ×${fmt(num(project.coefficient))}`, money(tt.subtotal, currency), false]] as Array<[string, string, boolean]>)
      : []),
    ...(num(project.vat_rate) > 0
      ? ([[`НДС ${fmt(num(project.vat_rate))}% (${project.vat_included ? "в цене" : "сверху"})`, money(tt.vatAmount, currency), false]] as Array<[string, string, boolean]>)
      : []),
    ["ИТОГО ДЛЯ КЛИЕНТА", money(tt.total, currency), true]
  ];
  for (const [label, value, bold] of svod) {
    children.push(p([t(`${label}  `, { color: DIM }), t(value, { bold, size: bold ? 26 : 22 })], { align: AlignmentType.RIGHT, after: 50 }));
  }
  const revenueExVat = project.vat_included ? tt.total - tt.vatAmount : tt.subtotal;
  children.push(p([t(`Маржа (без НДС): ${money(revenueExVat - tt.base, currency)}`, { size: 18, color: OAK, bold: true })], { align: AlignmentType.RIGHT, after: 200 }));

  if (project.assumptions.trim()) {
    children.push(heading("Методика расчёта", font));
    children.push(...textBlock(project.assumptions, font));
  }
  await save(buildDoc(font, children), `Калькуляция №${contractNumber(project)} — ${project.name}.docx`);
}

export async function downloadContract(project: Project, settings: Settings) {
  const font = "Times New Roman";
  const { t, p } = kit(font);
  const c = settings.company;
  const currency = settings.currency;
  const tt = projectTotals(project);
  const factor = tt.clientFactor;
  const no = contractNumber(project);
  const prep = Math.min(100, Math.max(0, num(settings.prepayment_percent) || 70));
  const prepAmount = (tt.total * prep) / 100;
  const restAmount = tt.total - prepAmount;
  const days = num(settings.production_days) || 45;
  const wm = num(settings.warranty_months) || 12;
  const executor = c.name || "________________";
  const children: (Paragraph | Table)[] = [];

  children.push(p([t(`ДОГОВОР ПОДРЯДА № ${no}`, { bold: true, size: 28 })], { align: AlignmentType.CENTER, after: 60 }));
  children.push(p([t("на изготовление, доставку и монтаж мебели", { size: 22 })], { align: AlignmentType.CENTER, after: 200 }));
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [
        new TableRow({
          children: [
            cell([new Paragraph({ children: [t(`г. ${c.city || "____________"}`)] })], 50),
            cell([new Paragraph({ children: [t(fmtDate(new Date().toISOString()))], alignment: AlignmentType.RIGHT })], 50)
          ]
        })
      ]
    })
  );
  children.push(
    p(
      `${executor}${c.bin ? ` (БИН ${c.bin})` : ""}, именуемое в дальнейшем «Исполнитель», в лице ${c.position || "директора"} ${c.director || "________________"}, действующего на основании Устава, с одной стороны, и ${clientDisplay(project)}${project.client_phone ? ` (тел. ${project.client_phone})` : ""}, именуемый(-ая) в дальнейшем «Заказчик», с другой стороны, совместно именуемые «Стороны», заключили настоящий Договор о нижеследующем:`,
      { before: 160, after: 160 }
    )
  );

  const section = (title: string) => p([t(title, { bold: true })], { before: 200, after: 100, align: AlignmentType.CENTER });
  const clause = (text: string) => new Paragraph({ children: [t(text)], alignment: AlignmentType.JUSTIFIED, spacing: { after: 90 } });

  children.push(section("1. Предмет договора"));
  children.push(clause(`1.1. Исполнитель обязуется изготовить, доставить и произвести монтаж мебели по индивидуальным размерам согласно Спецификации (Приложение № 1, являющееся неотъемлемой частью настоящего Договора) по проекту «${project.name}», а Заказчик обязуется принять и оплатить результат работ.`));
  children.push(clause("1.2. Материалы, фурнитура, размеры и комплектация изделий определяются Спецификацией. Изменения оформляются дополнительным соглашением Сторон."));

  children.push(section("2. Стоимость работ и порядок расчётов"));
  children.push(clause(`2.1. Общая стоимость работ по Договору составляет ${money(tt.total, currency)} (${amountInWords(tt.total, currency)})${num(project.vat_rate) > 0 ? (project.vat_included ? `, в том числе НДС ${fmt(num(project.vat_rate))}% — ${money(tt.vatAmount, currency)}` : `, включая НДС ${fmt(num(project.vat_rate))}% — ${money(tt.vatAmount, currency)}`) : ", НДС не облагается"}.`));
  children.push(clause(`2.2. Заказчик вносит предоплату в размере ${fmt(prep)}% — ${money(prepAmount, currency)} — в течение 3 (трёх) банковских дней с даты подписания Договора.`));
  children.push(clause(`2.3. Оставшаяся часть — ${money(restAmount, currency)} — оплачивается после уведомления Заказчика о готовности изделий, до начала монтажа.`));

  children.push(section("3. Сроки выполнения"));
  children.push(clause(`3.1. Срок изготовления — ${days} (${numberFix(days)}) ${plural(days, ["рабочий день", "рабочих дня", "рабочих дней"])} с даты поступления предоплаты и утверждения Спецификации.`));
  children.push(clause("3.2. Доставка и монтаж выполняются в течение 5 (пяти) рабочих дней после готовности изделий по согласованию с Заказчиком."));

  children.push(section("4. Права и обязанности сторон"));
  children.push(clause("4.1. Исполнитель обязуется выполнить работы качественно, в соответствии со Спецификацией и действующими стандартами, используя заявленные материалы и фурнитуру."));
  children.push(clause("4.2. Заказчик обязуется своевременно произвести оплату, обеспечить доступ на объект, готовность помещения (чистовая отделка, ровные полы и стены) и принять результат работ."));
  children.push(clause("4.3. Исполнитель вправе привлекать третьих лиц, оставаясь ответственным за результат."));

  children.push(section("5. Гарантия"));
  children.push(clause(`5.1. Гарантийный срок — ${wm} (${numberFix(wm)}) ${plural(wm, ["месяц", "месяца", "месяцев"])} с даты подписания акта выполненных работ.`));
  children.push(clause("5.2. Гарантия не распространяется на дефекты, возникшие вследствие механических повреждений, воздействия влаги и температур сверх норм эксплуатации, самостоятельной разборки или ремонта."));

  children.push(section("6. Ответственность сторон"));
  children.push(clause("6.1. За нарушение сроков виновная Сторона уплачивает пеню 0,1% от стоимости Договора за каждый день просрочки, но не более 10% общей стоимости."));
  children.push(clause("6.2. Уплата неустойки не освобождает Стороны от исполнения обязательств."));

  children.push(section("7. Форс-мажор"));
  children.push(clause("7.1. Стороны освобождаются от ответственности при обстоятельствах непреодолимой силы, подтверждённых уполномоченными органами. Сторона обязана уведомить другую Сторону в течение 5 дней."));

  children.push(section("8. Заключительные положения"));
  children.push(clause("8.1. Споры разрешаются путём переговоров, при недостижении согласия — в суде по месту нахождения Исполнителя."));
  children.push(clause("8.2. Договор составлен в двух экземплярах равной юридической силы, по одному для каждой из Сторон, и действует до полного исполнения обязательств."));

  children.push(section("9. Реквизиты и подписи сторон"));
  const execLines = [executor, c.bin ? `БИН: ${c.bin}` : "", c.address ? `Адрес: ${c.address}` : "", c.phone ? `Тел.: ${c.phone}` : "", c.email ? `E-mail: ${c.email}` : "", c.bank ? `Банк: ${c.bank}` : "", c.account ? `Счёт: ${c.account}` : ""].filter(Boolean);
  const custLines = [clientDisplay(project), project.client_phone ? `Тел.: ${project.client_phone}` : "", project.client_email ? `E-mail: ${project.client_email}` : ""].filter(Boolean);
  const colOf = (title: string, lines: string[], signName: string) => {
    const paras = [new Paragraph({ children: [t(title, { bold: true })], spacing: { after: 80 } })];
    for (const l of lines) paras.push(new Paragraph({ children: [t(l, { size: 20 })], spacing: { after: 40 } }));
    paras.push(new Paragraph({ children: [t("")], spacing: { after: 200 } }));
    paras.push(new Paragraph({ children: [t(`______________ / ${signName || "______________"} /`, { size: 20 })] }));
    return paras;
  };
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [new TableRow({ children: [cell(colOf("ИСПОЛНИТЕЛЬ:", execLines, c.director), 50), cell(colOf("ЗАКАЗЧИК:", custLines, project.client_name), 50)] })]
    })
  );

  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(p([t(`Приложение № 1 к Договору подряда № ${no}`, { bold: true })], { align: AlignmentType.RIGHT, after: 200 }));
  children.push(p([t("СПЕЦИФИКАЦИЯ", { bold: true, size: 26 })], { align: AlignmentType.CENTER, after: 200 }));
  children.push(specTable(project, factor, currency, font));
  children.push(p([t("", { size: 8 })], { after: 80 }));
  children.push(...totalsBlock(project, currency, font));
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [
        new TableRow({
          children: [
            cell([new Paragraph({ children: [t(`Исполнитель: ______________ / ${c.director || "____________"} /`, { size: 20 })] })], 50),
            cell([new Paragraph({ children: [t(`Заказчик: ______________ / ${project.client_name || "____________"} /`, { size: 20 })] })], 50)
          ]
        })
      ]
    })
  );
  await save(buildDoc(font, children), `Договор №${no} — ${project.name}.docx`);
}

function numberFix(n: number): string {
  return numberToWordsRu(n);
}

export async function downloadChecklist(project: Project, settings: Settings) {
  const font = "Calibri";
  const { t, p } = kit(font);
  const children: (Paragraph | Table)[] = [];
  const box = () => t("☐  ", { font: "Segoe UI Symbol", size: 24 });
  children.push(...companyHeader(project, settings, "ПРОИЗВОДСТВЕННЫЙ ЧЕК-ЛИСТ", font));
  children.push(p([t("Проект: ", { color: DIM }), t(project.name, { bold: true }), t(`  ·  Заказчик: ${clientDisplay(project)}`, { color: DIM })], { after: 200 }));

  const agg = new Map<string, { name: string; unit: string; qty: number }>();
  for (const item of project.items) {
    const mult = Math.max(1, num(item.qty) || 1);
    for (const comp of item.components) {
      if (comp.type === "labor") continue;
      const key = `${comp.name.toLowerCase().trim()}|${comp.unit}`;
      const prev = agg.get(key);
      const qty = num(comp.qty) * mult;
      if (prev) prev.qty += qty;
      else agg.set(key, { name: comp.name, unit: comp.unit, qty });
    }
  }
  children.push(heading("1. Закупка материалов и фурнитуры", font, { before: 120 }));
  const purchaseHeader = new TableRow({
    tableHeader: true,
    children: [
      cell([new Paragraph({ children: [t(" ", { color: "FFFFFF", size: 18 })] })], 7, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Наименование", { bold: true, color: "FFFFFF", size: 18 })] })], 61, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Кол-во", { bold: true, color: "FFFFFF", size: 18 })], alignment: AlignmentType.RIGHT })], 16, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Ед.", { bold: true, color: "FFFFFF", size: 18 })], alignment: AlignmentType.CENTER })], 16, { shade: LACQUER })
    ]
  });
  const purchaseRows = Array.from(agg.values()).map(
    (row) =>
      new TableRow({
        children: [
          cell([new Paragraph({ children: [box()], alignment: AlignmentType.CENTER })], 7),
          cell([new Paragraph({ children: [t(row.name, { size: 20 })] })], 61),
          cell([new Paragraph({ children: [t(fmt(Math.ceil(row.qty * 100) / 100), { size: 20 })], alignment: AlignmentType.RIGHT })], 16),
          cell([new Paragraph({ children: [t(row.unit, { size: 20 })], alignment: AlignmentType.CENTER })], 16)
        ]
      })
  );
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: thinBorders, rows: [purchaseHeader, ...purchaseRows] }));

  children.push(heading("2. Производство", font));
  for (const item of project.items) {
    children.push(p([t(item.name, { bold: true, size: 24 }), t(`   ${itemDescr(item)}`, { size: 18, color: DIM })], { before: 160, after: 80 }));
    const fittings = item.components.filter((comp) => comp.type === "fitting").map((comp) => comp.name);
    const steps = [
      "Раскрой деталей по карте распила",
      "Кромление и обработка торцов",
      "Присадка, фрезеровка под фурнитуру",
      "Сборка корпуса, проверка геометрии",
      "Навеска и регулировка фасадов",
      fittings.length ? `Установка фурнитуры: ${fittings.join(", ")}` : "Установка фурнитуры",
      "Контроль качества, чистка, упаковка"
    ];
    for (const step of steps) {
      children.push(new Paragraph({ children: [box(), t(step, { size: 20 })], spacing: { after: 50 }, indent: { left: 260 } }));
    }
  }

  children.push(heading("3. Доставка и монтаж", font));
  const finalSteps = [
    "Проверка комплектности перед отгрузкой",
    "Доставка на объект, подъём",
    ...project.items.map((item) => `Монтаж: ${item.name}`),
    "Финальная регулировка фасадов и механизмов",
    "Уборка рабочей зоны, вывоз упаковки",
    "Демонстрация клиенту, подписание акта"
  ];
  for (const step of finalSteps) {
    children.push(new Paragraph({ children: [box(), t(step, { size: 20 })], spacing: { after: 50 }, indent: { left: 260 } }));
  }

  children.push(p([t("Производство: ______________     Монтаж: ______________     ОТК: ______________", { size: 20, color: DIM })], { before: 320 }));
  await save(buildDoc(font, children), `Чек-лист №${contractNumber(project)} — ${project.name}.docx`);
}

export async function downloadAct(project: Project, settings: Settings) {
  const font = "Times New Roman";
  const { t, p } = kit(font);
  const c = settings.company;
  const currency = settings.currency;
  const tt = projectTotals(project);
  const no = contractNumber(project);
  const children: (Paragraph | Table)[] = [];
  children.push(p([t(`АКТ ВЫПОЛНЕННЫХ РАБОТ № ${no}`, { bold: true, size: 28 })], { align: AlignmentType.CENTER, after: 60 }));
  children.push(p([t(`к Договору подряда № ${no} от ${fmtDate(project.created_at)}`, { size: 20, color: DIM })], { align: AlignmentType.CENTER, after: 200 }));
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [
        new TableRow({
          children: [
            cell([new Paragraph({ children: [t(`г. ${c.city || "____________"}`)] })], 50),
            cell([new Paragraph({ children: [t(fmtDate(new Date().toISOString()))], alignment: AlignmentType.RIGHT })], 50)
          ]
        })
      ]
    })
  );
  children.push(
    p(
      `${c.name || "________________"}, именуемое «Исполнитель», в лице ${c.position || "директора"} ${c.director || "________________"}, с одной стороны, и ${clientDisplay(project)}, именуемый(-ая) «Заказчик», с другой стороны, составили настоящий акт о том, что Исполнитель выполнил, а Заказчик принял следующие работы:`,
      { before: 160, after: 160 }
    )
  );
  const header = new TableRow({
    tableHeader: true,
    children: [
      cell([new Paragraph({ children: [t("№", { bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.CENTER })], 8, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Наименование работ", { bold: true, color: "FFFFFF", size: 20 })] })], 66, { shade: LACQUER }),
      cell([new Paragraph({ children: [t("Сумма", { bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.RIGHT })], 26, { shade: LACQUER })
    ]
  });
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: thinBorders,
      rows: [
        header,
        new TableRow({
          children: [
            cell([new Paragraph({ children: [t("1")], alignment: AlignmentType.CENTER })], 8),
            cell([new Paragraph({ children: [t(`Изготовление, доставка и монтаж мебели по проекту «${project.name}» согласно Спецификации (Приложение № 1 к Договору)`)] })], 66),
            cell([new Paragraph({ children: [t(money(tt.total, currency), { bold: true })], alignment: AlignmentType.RIGHT })], 26)
          ]
        })
      ]
    })
  );
  children.push(p([t(`Итого: ${money(tt.total, currency)}${num(project.vat_rate) > 0 ? ` (в т.ч. НДС ${fmt(num(project.vat_rate))}% — ${money(tt.vatAmount, currency)})` : ""}`, { bold: true })], { align: AlignmentType.RIGHT, before: 120, after: 60 }));
  children.push(p([t(amountInWords(tt.total, currency), { italics: true, size: 20, color: DIM })], { align: AlignmentType.RIGHT, after: 200 }));
  children.push(p("Вышеперечисленные работы выполнены полностью и в срок. Заказчик по объёму, качеству и срокам выполнения работ претензий не имеет.", { after: 300 }));
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [
        new TableRow({
          children: [
            cell([new Paragraph({ children: [t("ИСПОЛНИТЕЛЬ:", { bold: true })], spacing: { after: 240 } }), new Paragraph({ children: [t(`______________ / ${c.director || "____________"} /`, { size: 20 })] })], 50),
            cell([new Paragraph({ children: [t("ЗАКАЗЧИК:", { bold: true })], spacing: { after: 240 } }), new Paragraph({ children: [t(`______________ / ${project.client_name || "____________"} /`, { size: 20 })] })], 50)
          ]
        })
      ]
    })
  );
  await save(buildDoc(font, children), `Акт №${no} — ${project.name}.docx`);
}
