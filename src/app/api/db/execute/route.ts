import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false }
    });
    const { data: userData } = await auth.auth.getUser(token);
    if (!userData?.user || userData.user.email !== "admin@linden.kz") {
      return NextResponse.json({ error: "Выполнять SQL может только руководитель." }, { status: 403 });
    }
    const { data: secrets } = await auth.from("app_secrets").select("db_url").eq("id", 1).single();
    const dbUrl = String(secrets?.db_url ?? "").trim();
    if (!dbUrl) {
      return NextResponse.json({ error: "База данных не подключена: добавьте строку подключения в Настройках." }, { status: 400 });
    }
    if (!/^postgres(ql)?:\/\//.test(dbUrl)) {
      return NextResponse.json({ error: "Строка подключения должна начинаться с postgresql://" }, { status: 400 });
    }
    const body = await req.json();
    const sql = String(body?.sql ?? "").trim();
    if (!sql) return NextResponse.json({ error: "Пустой SQL." }, { status: 400 });
    if (sql.length > 60000) return NextResponse.json({ error: "SQL слишком длинный." }, { status: 400 });

    const client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      statement_timeout: 30000,
      query_timeout: 40000,
      connectionTimeoutMillis: 12000
    });
    await client.connect();
    try {
      const raw = await client.query(sql);
      const results = (Array.isArray(raw) ? raw : [raw]).map((r: any) => ({
        command: String(r.command ?? ""),
        rowCount: typeof r.rowCount === "number" ? r.rowCount : null
      }));
      return NextResponse.json({ ok: true, results });
    } finally {
      await client.end().catch(() => undefined);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка выполнения SQL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
