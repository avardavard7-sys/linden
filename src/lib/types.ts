export type ItemType = "material" | "fitting" | "labor";

export type ProjectStatus =
  | "draft"
  | "sent"
  | "approved"
  | "production"
  | "done"
  | "cancelled";

export type PriceItem = {
  id: string;
  name: string;
  category: string;
  item_type: ItemType;
  unit: string;
  price: number;
  note: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type Component = {
  id: string;
  priceItemId: string | null;
  name: string;
  type: ItemType;
  unit: string;
  qty: number;
  price: number;
  note: string;
};

export type ProjectItem = {
  id: string;
  name: string;
  room: string;
  width: number;
  height: number;
  depth: number;
  qty: number;
  color: string;
  spec: string;
  image_url: string;
  price_from: boolean;
  components: Component[];
};

export type Project = {
  id: string;
  number: number;
  name: string;
  client_name: string;
  client_phone: string;
  client_email: string;
  client_company: string;
  area: number | null;
  status: ProjectStatus;
  items: ProjectItem[];
  markup: number;
  discount: number;
  coefficient: number;
  vat_rate: number;
  vat_included: boolean;
  notes: string;
  source_file_name: string;
  ai_summary: string;
  assumptions: string;
  author_name: string;
  author_employee: string | null;
  created_at: string;
  updated_at: string;
};

export type Employee = {
  id: string;
  full_name: string;
  login_code: string;
  auth_user: string | null;
  created_at: string;
  attempts_limit: number | null;
  attempts_used: number;
};

export type AiKnowledge = {
  id: string;
  title: string;
  content: string;
  author_name: string;
  author_employee: string | null;
  created_at: string;
};

export type ProjectMessage = {
  id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  author_name: string;
  author_employee: string | null;
  created_at: string;
};

export type CompanyInfo = {
  name: string;
  city: string;
  director: string;
  position: string;
  bin: string;
  address: string;
  phone: string;
  email: string;
  bank: string;
  account: string;
};

export type Integration = {
  name: string;
  url: string;
  token: string;
  enabled: boolean;
};

export type Settings = {
  id: number;
  company: CompanyInfo;
  currency: string;
  vat_rate: number;
  vat_included: boolean;
  default_markup: number;
  prepayment_percent: number;
  production_days: number;
  warranty_months: number;
  anthropic_api_key: string;
  standards: unknown;
  ai_model: string;
  integrations: Integration[];
};

export type DesignRecord = {
  id: string;
  project_id: string | null;
  prompt: string;
  result_text: string;
  image_urls: string[];
  created_at: string;
};

export type PriceHistoryRecord = {
  id: string;
  price_item_id: string;
  item_name: string;
  old_price: number | null;
  new_price: number | null;
  source: string;
  changed_at: string;
};
