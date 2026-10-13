import type { Session } from "@supabase/supabase-js";

export type Identity = {
  role: "owner" | "staff";
  name: string;
  employeeId: string | null;
  loginCode: string;
  email: string;
};

export function identityFromSession(session: Session): Identity {
  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const email = session.user.email ?? "";
  const isOwner = meta.role === "owner" || email === "admin@linden.kz";
  return {
    role: isOwner ? "owner" : "staff",
    name: String(meta.full_name ?? (isOwner ? "Руководитель" : "Сотрудник")),
    employeeId: typeof meta.employee_id === "string" ? meta.employee_id : null,
    loginCode: String(meta.login_code ?? ""),
    email
  };
}

export function staffEmail(code: string): string {
  return `${code.trim()}@staff.linden.kz`;
}
