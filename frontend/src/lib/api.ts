/** Typed API client for the Celengan FastAPI backend.
 *
 * Dev: requests go through the Vite `/api` proxy (no CORS friction).
 * Build: point VITE_API_BASE at any deployed backend.
 */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers: extraHeaders, ...rest } = init ?? {};
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body === "string" ? body : (body.detail ?? JSON.stringify(body));
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, String(detail));
  }
  const contentType = res.headers.get("content-type") ?? "";
  return (contentType.includes("json") ? await res.json() : await res.text()) as T;
}

/* ------------------------------------------------------------------ types */

export interface Health {
  status: string;
  app: string;
  version: string;
  sandbox: string;
  sandbox_seed: number;
  llm_enabled: boolean;
}

export interface Sandbox {
  user: string;
  synthetic: boolean;
  window_days: number;
  transaction_count: number;
  balance_now: number;
  recurring_count: number;
  findings_count: number;
}

export interface Txn {
  id: string;
  date: string;
  description: string;
  amount: number;
  merchant: string | null;
  category: string | null;
}

export interface Leak {
  id: string;
  type: string;
  merchant: string;
  impact_monthly: number;
  impact_annual: number;
  confidence: number;
  title: string;
  rationale: string;
  evidence_txn_ids: string[];
  playbook: string;
  score: number | null;
  context: Record<string, unknown>;
}

export interface LeaksResponse {
  findings: Leak[];
  totals: { monthly_impact: number; annual_impact: number };
}

export interface ForecastPoint {
  day_offset: number;
  date: string;
  balance: number;
}

export interface Forecast {
  state: string;
  window_days: number;
  doom_day: string | null;
  lowest_balance: number;
  applied_exclusions: string[];
  applied_credits_total: number;
  applied_discounts: Record<string, number>;
  points: ForecastPoint[];
}

export interface ForecastPair {
  baseline: Forecast;
  current: Forecast;
}

export interface WhatIf {
  excluded: string[];
  one_time_credits: number[];
  monthly_savings: number;
  baseline: Forecast;
  counterfactual: Forecast;
}

export interface Play {
  finding_id: string;
  playbook: string;
  tier: number;
  label: string;
  effect: string;
  merchant: string;
  impact_monthly: number;
}

export interface Receipt {
  id: string;
  created_at: string;
  finding_id: string;
  playbook: string;
  tier: number;
  status: "draft_ready" | "autopilot_active" | "undone" | string;
  subject: string;
  body: string;
  generator: string;
  impact_monthly: number;
  impact_note: string;
  evidence_txn_ids: string[];
  undone: boolean;
}

export interface Consent {
  tier2_enabled: boolean;
  kill_switch: boolean;
  tier2_spent_this_month: number;
  tier2_monthly_cap: number;
  tier2_max_single_action: number;
}

export interface AuditEvent {
  ts: string;
  event: string;
  details: Record<string, unknown>;
}

/* ---------------------------------------------------------------- endpoints */

export const api = {
  health: () => request<Health>("/health"),

  sandbox: () => request<Sandbox>("/sandbox"),
  reloadSandbox: () => request<{ message: string }>("/sandbox/reload", { method: "POST" }),
  transactions: () => request<Txn[]>("/transactions"),

  leaks: () => request<LeaksResponse>("/leaks"),

  forecast: (days = 40) => request<ForecastPair>(`/forecast?days=${days}`),
  whatIf: (exclude: string[], credits: number[], days = 40) =>
    request<WhatIf>(
      `/forecast/what-if?exclude=${encodeURIComponent(exclude.join(","))}` +
        `&credits=${credits.map(String).join(",")}&days=${days}`,
    ),

  plays: () => request<Play[]>("/actions/plays"),
  requestAction: (body: { finding_id: string; tier: number; confirm: boolean }) =>
    request<Receipt>("/actions/request", { method: "POST", json: body }),
  undo: (receipt_id: string) =>
    request<Receipt>("/actions/undo", { method: "POST", json: { receipt_id } }),
  killSwitch: (enabled: boolean) =>
    request<{ message: string }>("/actions/kill-switch", { method: "POST", json: { enabled } }),

  consent: () => request<Consent>("/consent"),
  setConsent: (enabled: boolean) =>
    request<Consent>("/consent", { method: "POST", json: { enabled } }),

  receipts: () => request<Receipt[]>("/receipts"),

  audit: (limit = 200) => request<AuditEvent[]>(`/audit?limit=${limit}`),
};
