/** Browser-side port of the Celengan deterministic core for the static demo.
 *
 * Backed by the frozen Python engine snapshot (`public/demo-data/`), this
 * module reimplements exactly two things, verified against the Python
 * original by `scripts/parity.ts` (run in CI):
 *   1. the forecaster's projection math (`backend/app/engine/forecaster.py`)
 *   2. the Policy Engine + Action Desk state machine (`backend/app/policy`,
 *      `backend/app/state.py`) — same checks, same order, same reason strings.
 *
 * Faithfulness notes:
 *  - numbers are IEEE doubles in both worlds; `pyRound` reproduces Python's
 *    round-half-even for the only rounding that matters (2 decimals)
 *  - event ordering relies on stable sort (ES2019+), matching Python's sort
 *  - income series and the burn rate are COMPUTED IN PYTHON and imported —
 *    no detection logic is duplicated here beyond the day loop.
 */

import type { AuditEvent, Consent, ForecastPoint, Receipt } from "../apiTypes";

/* --------------------------------------------------------------- numbers */
/** Python's round(x, n): correctly-rounded decimal, half to even. */
export function pyRound(x: number, digits = 2): number {
  const p = Math.pow(10, digits);
  const y = x * p;
  const r = Math.round(y);
  if (Math.abs(y - r) === 0.5) {
    // exact decimal tie at this scale → Python picks the even integer
    const r2 = r % 2 === 0 ? r : r + Math.sign(y);
    return r2 / p;
  }
  return r / p;
}

/* ------------------------------------------------------------------ dates */
const pad2 = (n: number) => String(n).padStart(2, "0");

/** ISO date arithmetic via UTC-serial days — no timezone drift. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/* -------------------------------------------------------- projection port */
export interface ProjectionParams {
  anchor: string;
  balance_now: number;
  burn_daily: number;
  /** recurring outflows: median_amount & last_due precomputed in Python */
  recurring: {
    merchant: string;
    cadence_days: number;
    median_amount: number;
    last_due: string;
  }[];
  /** scheduled inflows (payroll etc.), detected & median-rounded in Python */
  income_series: {
    merchant: string;
    cadence_days: number;
    amount: number;
    last_date: string;
  }[];
}

export interface ProjectionOptions {
  exclusions?: string[];
  one_time_credits?: number[];
  discounts?: Record<string, number>;
}

export interface ProjectionResult {
  points: ForecastPoint[];
  doom_day: string | null;
  lowest_balance: number;
  window_days: number;
}

const add = (a: number, b: number) => a + b;

export function project(
  params: ProjectionParams,
  days: number,
  opts: ProjectionOptions = {},
): ProjectionResult {
  const excluded = new Set(opts.exclusions ?? []);
  const discounts = opts.discounts ?? {};
  const horizon = addDaysIso(params.anchor, days);

  // Scheduled outflow events (recurring bills) — mirrors forecaster.project
  const events: { due: string; amount: number }[] = [];
  for (const r of params.recurring) {
    if (excluded.has(r.merchant)) continue;
    const billed = r.median_amount - (discounts[r.merchant] ?? 0.0);
    let due = addDaysIso(r.last_due, r.cadence_days);
    while (due <= horizon) {
      events.push({ due, amount: -billed });
      due = addDaysIso(due, r.cadence_days);
    }
  }
  // Scheduled income events
  for (const s of params.income_series) {
    let due = addDaysIso(s.last_date, s.cadence_days);
    while (due <= horizon) {
      events.push({ due, amount: s.amount });
      due = addDaysIso(due, s.cadence_days);
    }
  }
  events.sort((a, b) => a.due.localeCompare(b.due)); // stable, like Python's sort

  let idx = 0;
  let balance = params.balance_now;
  // Events due exactly on the anchor day are part of "now".
  while (idx < events.length && events[idx].due <= params.anchor) {
    balance += events[idx].amount;
    idx += 1;
  }

  const creditTotal = (opts.one_time_credits ?? []).reduce(add, 0);
  const burn = params.burn_daily;
  const points: ForecastPoint[] = [];
  let doomDay: string | null = null;
  let lowest = balance;

  for (let day = 1; day <= days; day++) {
    const current = addDaysIso(params.anchor, day);
    while (idx < events.length && events[idx].due <= current) {
      balance += events[idx].amount;
      idx += 1;
    }
    if (day === 3 && creditTotal) balance += creditTotal; // refunds post in 3 days
    balance -= burn;
    points.push({ day_offset: day, date: current, balance: pyRound(balance, 2) });
    lowest = Math.min(lowest, balance);
    if (doomDay === null && balance < 0) doomDay = current;
  }

  return {
    points,
    doom_day: doomDay,
    lowest_balance: pyRound(lowest, 2),
    window_days: days,
  };
}

/** Port of forecaster.what_if — counterfactual + quantified savings. */
export function whatIf(
  params: ProjectionParams,
  days: number,
  opts: ProjectionOptions,
): { baseline: ProjectionResult; counterfactual: ProjectionResult; monthly_savings: number } {
  const excluded = new Set(opts.exclusions ?? []);
  const discounts = opts.discounts ?? {};
  const savings =
    params.recurring
      .filter((r) => excluded.has(r.merchant))
      .reduce((acc, r) => acc + r.median_amount * (30 / r.cadence_days), 0) +
    Object.values(discounts).reduce(add, 0);
  return {
    baseline: project(params, days),
    counterfactual: project(params, days, opts),
    monthly_savings: pyRound(savings, 2),
  };
}

/* ------------------------------------------------- Policy Engine + Action
 * Desk state machine — mirrors app/policy/engine.py + app/state.py exactly:
 * same order of checks, same reason strings, same effect whitelist. */

export const STATIC_REASONS = {
  tier1NoConfirm: "Tier 1 requires one-tap human confirmation",
  tier1Ok: "confirmed draft action",
  killSwitch: "kill switch engaged — all autopilot halted",
  noConsent: "Tier 2 micro-autopilot not consented by user",
  withinEnvelope: "within consented autopilot envelope",
} as const;

export const amountExceedsCap = (amount: number, cap: number) =>
  `amount $${amount.toFixed(2)} exceeds per-action cap $${cap.toFixed(2)}`;

export const exceedsMonthlyCap = (spent: number, amount: number, cap: number) =>
  `would exceed monthly autopilot cap ($${spent.toFixed(2)} spent + $${amount.toFixed(2)} > $${cap.toFixed(2)})`;

/** USD formatting identical to Python's `f"${x:,.2f}"` (en-US grouping). */
export const usd = (x: number) =>
  x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ------------------------------------------------------- draft templates */

export interface FindingLike {
  id: string;
  type: string;
  merchant: string;
  playbook: string;
  impact_monthly: number;
  impact_annual: number;
  confidence: number;
  title: string;
  rationale: string;
  evidence_txn_ids: string[];
  score: number | null;
  context: Record<string, unknown>;
}

const PLAY_EFFECTS: Record<string, { tier: number; effect: string }[]> = {
  cancel_subscription: [
    { tier: 1, effect: "draft" },
    { tier: 2, effect: "recurring_exclusion" },
  ],
  dispute_duplicate: [{ tier: 1, effect: "one_time_credit" }],
  claim_fee_refund: [{ tier: 1, effect: "one_time_credit" }],
  renegotiate_hike: [
    { tier: 1, effect: "draft" },
    { tier: 2, effect: "recurring_discount" },
  ],
};

/** Port of agent/planner._template_draft — needs finding.context fields. */
export function templateDraft(f: FindingLike): { subject: string; body: string } {
  const evidence = f.evidence_txn_ids.slice(0, 4).join(", ");
  const ctx = (f.context ?? {}) as Record<string, string | number>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
  switch (f.playbook) {
    case "cancel_subscription": {
      const subject = `Cancellation request — ${f.merchant} subscription`;
      const price = num(ctx["price"], f.impact_monthly);
      const body =
        `Hello ${f.merchant} Support,\n\n` +
        `Please cancel my subscription effective at the end of the current ` +
        `billing cycle. My statements show ${ctx["occurrences"] ?? "recurring"} ` +
        `recurring charges of $${usd(price)} (ref: ${evidence}).\n\n` +
        `Please confirm the cancellation and the final billing date.\n\n` +
        `Thank you,\nMaya (Celengan-managed account)`;
      return { subject, body };
    }
    case "dispute_duplicate": {
      const subject = `Duplicate charge dispute — $${usd(f.impact_monthly)} (${f.merchant})`;
      const body =
        `Dear Bank Disputes Team,\n\n` +
        `I am disputing a duplicate charge of $${usd(f.impact_monthly)} ` +
        `from ${f.merchant}. The same amount was debited twice within a ` +
        `24-hour window (transactions ${evidence}); only one was authorized.\n\n` +
        `I request a refund of $${usd(f.impact_monthly)} for the ` +
        `unauthorized second charge.\n\n` +
        `Thank you,\nMaya (Celengan-managed account)`;
      return { subject, body };
    }
    case "claim_fee_refund": {
      const subject = `Fee waiver request — $${usd(f.impact_monthly)} (${f.merchant})`;
      const body =
        `Dear ${f.merchant},\n\n` +
        `I would like to request a waiver of the fee(s) listed on my ` +
        `statements (ref: ${evidence}). This is my first request; I would ` +
        `appreciate a one-time courtesy reversal of $${usd(f.impact_monthly)}.\n\n` +
        `Thank you,\nMaya (Celengan-managed account)`;
      return { subject, body };
    }
    default: {
      // renegotiate_hike
      const prev = num(ctx["previous_price"], 0);
      const next = num(ctx["new_price"], f.impact_monthly);
      const subject = `Plan review request — ${f.merchant} price increase`;
      const body =
        `Hello ${f.merchant} Support,\n\n` +
        `My plan was recently repriced from $${usd(prev)} ` +
        `to $${usd(next)} per month without notice (ref: ${evidence}).\n\n` +
        `I would like to either restore the previous rate or move to an ` +
        `equivalent lower tier.\n\n` +
        `Thank you,\nMaya (Celengan-managed account)`;
      return { subject, body };
    }
  }
}

export function impactNote(f: FindingLike, effect: string): string {
  if (effect === "recurring_exclusion")
    return `saves ~$${usd(f.impact_monthly)}/month ($${usd(f.impact_annual)}/year)`;
  if (effect === "recurring_discount")
    return `reduces the bill by ~$${usd(f.impact_monthly)}/month ($${usd(f.impact_annual)}/year)`;
  if (effect === "one_time_credit")
    return `one-time credit of ~$${usd(f.impact_monthly)} expected`;
  return `potential saving ~$${usd(f.impact_monthly)}/month if accepted`;
}

/* ------------------------------------------------------------ DemoSession */

/** Error with HTTP-like status, shaped exactly like the FastAPI error paths. */
export class DemoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "DemoError";
  }
}

export interface DemoMeta extends ProjectionParams {
  anchor: string;
  edition?: string;
  version: string;
  mode: string;
  user: string;
  synthetic: boolean;
  seed: number;
  window_days: number;
  transaction_count: number;
  balance_now: number;
  recurring_count: number;
  findings_count: number;
  tier2_monthly_cap: number;
  tier2_max_single_action: number;
}

type PlaySpec = { tier: number; effect: string };

/** One client-side "AppState" — mirrors backend semantics 1:1. */
export class DemoSession {
  readonly meta: DemoMeta;
  readonly findings: FindingLike[];
  private specs: PlaySpec[][]; // per finding id
  consent: Consent;
  receipts: Receipt[] = [];
  audit: AuditEvent[] = [];
  applied = {
    exclusions: [] as string[],
    credits: [] as number[],
    discounts: {} as Record<string, number>,
  };
  private effectByReceipt = new Map<string, { type: string; merchant?: string; credit?: number }>();
  private seq = 0;

  constructor(meta: DemoMeta, findings: FindingLike[], plays: { finding_id: string; tier: number; effect: string }[]) {
    this.meta = meta;
    this.findings = findings;
    this.specs = findings.map(() => []);
    const specById = new Map(this.findings.map((f, i) => [f.id, i]));
    for (const p of plays) {
      const i = specById.get(p.finding_id);
      if (i !== undefined) this.specs[i].push({ tier: p.tier, effect: p.effect });
    }
    this.consent = {
      tier2_enabled: false,
      kill_switch: false,
      tier2_spent_this_month: 0,
      tier2_monthly_cap: meta.tier2_monthly_cap,
      tier2_max_single_action: meta.tier2_max_single_action,
    };
    this.log("session.reloaded", { seed: meta.seed, findings: findings.length, source: "static snapshot" });
  }

  private now(): string {
    return new Date().toISOString().replace(/\.\d{3}/, "");
  }

  private log(event: string, details: Record<string, unknown>) {
    this.audit.push({ ts: this.now(), event, details });
  }

  private specFor(findingId: string, tier: number): PlaySpec | undefined {
    const f = this.findings.find((x) => x.id === findingId);
    return f ? (PLAY_EFFECTS[f.playbook] ?? []).find((s) => s.tier === tier) : undefined;
  }

  hasReceiptForFinding(findingId: string, playbook: string): boolean {
    return this.receipts.some((r) => r.finding_id === findingId && r.playbook === playbook && !r.undone);
  }

  /** POST /actions/request — policy-gated execution. */
  requestAction(findingId: string, tier: number, confirm = false): Receipt {
    const f = this.findings.find((x) => x.id === findingId);
    if (!f) throw new DemoError(404, `unknown finding ${findingId}`);
    const spec = this.specFor(findingId, tier);
    if (!spec)
      throw new DemoError(422, `playbook '${f.playbook}' has no tier-${tier} play`);
    if (this.hasReceiptForFinding(findingId, f.playbook))
      throw new DemoError(409, "this play is already active — undo it first");

    const amount = tier === 2 ? f.impact_monthly : 0.0;
    // ---- PolicyEngine._decide (same order, same strings) ----
    let approved = false;
    let reason = "";
    if (tier === 1) {
      if (!confirm) reason = STATIC_REASONS.tier1NoConfirm;
      else {
        approved = true;
        reason = STATIC_REASONS.tier1Ok;
      }
    } else if (tier === 2) {
      if (this.consent.kill_switch) reason = STATIC_REASONS.killSwitch;
      else if (!this.consent.tier2_enabled) reason = STATIC_REASONS.noConsent;
      else if (amount > this.consent.tier2_max_single_action)
        reason = amountExceedsCap(amount, this.consent.tier2_max_single_action);
      else if (this.consent.tier2_spent_this_month + amount > this.consent.tier2_monthly_cap)
        reason = exceedsMonthlyCap(
          this.consent.tier2_spent_this_month,
          amount,
          this.consent.tier2_monthly_cap,
        );
      else {
        approved = true;
        reason = STATIC_REASONS.withinEnvelope;
      }
    } else {
      reason = `unknown tier ${tier}`;
    }
    this.log("policy.decision", {
      finding_id: f.id,
      playbook: f.playbook,
      tier,
      amount,
      approved,
      reason,
    });
    if (!approved) throw new DemoError(422, reason);

    // ---- AppState.execute_action ----
    this.seq += 1;
    const id = `R${String(this.seq).padStart(3, "0")}`;
    let receipt: Receipt;
    if (tier === 1) {
      const { subject, body } = templateDraft(f);
      receipt = {
        id,
        created_at: this.now(),
        finding_id: f.id,
        playbook: f.playbook,
        tier,
        status: "draft_ready",
        subject,
        body,
        generator: "template",
        impact_monthly: f.impact_monthly,
        impact_note: impactNote(f, spec.effect),
        evidence_txn_ids: [...f.evidence_txn_ids],
        undone: false,
      };
      // Backend stores effect {"type": spec.effect, "credit": impact}; only
      // one_time_credit affects the forecast, and undo removes it again.
      this.effectByReceipt.set(id, { type: spec.effect, credit: f.impact_monthly });
      if (spec.effect === "one_time_credit") this.applied.credits.push(f.impact_monthly);
    } else {
      const isDiscount = spec.effect === "recurring_discount";
      receipt = {
        id,
        created_at: this.now(),
        finding_id: f.id,
        playbook: f.playbook,
        tier,
        status: "autopilot_active",
        subject: isDiscount
          ? `Autopilot: downgrade ${f.merchant} at next renewal`
          : `Autopilot: pause ${f.merchant} at next renewal`,
        body:
          `Bounded autopilot active: ${f.merchant} will be ` +
          `${isDiscount ? "moved to the previous rate" : "paused"} ` +
          `before its next renewal. Monthly cap ` +
          `$${usd(this.consent.tier2_monthly_cap)}, per-action cap ` +
          `$${usd(this.consent.tier2_max_single_action)}, instant undo, ` +
          `full audit trail.`,
        generator: "policy",
        impact_monthly: f.impact_monthly,
        impact_note: impactNote(f, spec.effect),
        evidence_txn_ids: [...f.evidence_txn_ids],
        undone: false,
      };
      this.effectByReceipt.set(id, { type: spec.effect, merchant: f.merchant });
      if (isDiscount) this.applied.discounts[f.merchant] = f.impact_monthly;
      else this.applied.exclusions.push(f.merchant);
      this.consent.tier2_spent_this_month += amount;
      this.log("tier2.spend_recorded", {
        amount,
        month_total: this.consent.tier2_spent_this_month,
      });
    }
    this.receipts.push(receipt);
    this.log("receipt.created", {
      receipt_id: receipt.id,
      finding_id: f.id,
      tier,
      status: receipt.status,
      impact_monthly: receipt.impact_monthly,
    });
    return receipt;
  }

  /** POST /actions/undo — reverses the effect, releases the Tier-2 envelope. */
  undo(receiptId: string): Receipt {
    const r = this.receipts.find((x) => x.id === receiptId);
    if (!r) throw new DemoError(404, `unknown receipt ${receiptId}`);
    if (r.undone) throw new DemoError(409, "receipt already undone");

    const effect = this.effectByReceipt.get(receiptId)!;
    if (effect.type === "recurring_exclusion" && effect.merchant) {
      this.applied.exclusions = this.applied.exclusions.filter((m) => m !== effect.merchant);
      this.releaseSpend(r.impact_monthly);
    } else if (effect.type === "recurring_discount" && effect.merchant) {
      delete this.applied.discounts[effect.merchant];
      this.releaseSpend(r.impact_monthly);
    } else if (effect.type === "one_time_credit") {
      const i = this.applied.credits.indexOf(r.impact_monthly);
      if (i >= 0) this.applied.credits.splice(i, 1);
    }

    r.undone = true;
    r.status = "undone" as Receipt["status"];
    this.log("action.undone", { receipt_id: r.id });
    return r;
  }

  private releaseSpend(amount: number) {
    this.consent.tier2_spent_this_month = Math.max(0, this.consent.tier2_spent_this_month - amount);
    this.log("tier2.spend_released", {
      amount,
      month_total: this.consent.tier2_spent_this_month,
    });
  }

  setConsent(enabled: boolean): Consent {
    this.consent.tier2_enabled = enabled;
    this.log("consent.updated", { tier2_enabled: enabled });
    return this.consentView();
  }

  setKillSwitch(enabled: boolean): string {
    this.consent.kill_switch = enabled;
    this.log("kill_switch", { enabled });
    return enabled ? "kill switch ENGAGED — autopilot halted" : "kill switch released";
  }

  consentView(): Consent {
    return { ...this.consent };
  }

  /** Rebuild the projection for the applied-effects state ("current"). */
  forecastCurrent(params: ProjectionParams, days: number): ProjectionResult {
    return project(params, days, {
      exclusions: [...this.applied.exclusions].sort(),
      one_time_credits: [...this.applied.credits],
      discounts: { ...this.applied.discounts },
    });
  }

  reload(): void {
    this.receipts = [];
    this.applied = { exclusions: [], credits: [], discounts: {} };
    this.effectByReceipt.clear();
    this.seq = 0;
    this.consent = { ...this.consent, tier2_enabled: false, kill_switch: false, tier2_spent_this_month: 0 };
    this.log("session.reloaded", { seed: this.meta.seed, findings: this.findings.length });
  }
}
