// Errors + no-type plumbing shared by the live and static API clients.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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

export interface CelenganApi {
  health: () => Promise<Health>;
  sandbox: () => Promise<Sandbox>;
  reloadSandbox: () => Promise<{ message: string }>;
  transactions: () => Promise<Txn[]>;
  leaks: () => Promise<LeaksResponse>;
  forecast: (days?: number) => Promise<ForecastPair>;
  whatIf: (exclude: string[], credits: number[], days?: number) => Promise<WhatIf>;
  plays: () => Promise<Play[]>;
  requestAction: (body: { finding_id: string; tier: number; confirm: boolean }) => Promise<Receipt>;
  undo: (receipt_id: string) => Promise<Receipt>;
  killSwitch: (enabled: boolean) => Promise<{ message: string }>;
  consent: () => Promise<Consent>;
  setConsent: (enabled: boolean) => Promise<Consent>;
  receipts: () => Promise<Receipt[]>;
  audit: (limit?: number) => Promise<AuditEvent[]>;
}
