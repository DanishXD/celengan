/** Full API surface for the STATIC GitHub-Pages demo.
 *
 * Every response shape is identical to the FastAPI backend; the session
 * (Policy Engine, receipts, audit) runs client-side in `DemoSession`, which
 * is parity-verified against the Python original in CI. Same guarantees as
 * live mode: policy reasons surface verbatim, effects are whitelisted, and
 * the money path terminates in one deterministic module.
 */

import { ApiError } from "../ApiError";
import type {
  AuditEvent,
  CelenganApi,
  Consent,
  Forecast,
  ForecastPair,
  Play,
  Receipt,
  Sandbox,
  Txn,
  WhatIf,
} from "../apiTypes";
import {
  DemoSession,
  project,
  pyRound,
  whatIf,
  type DemoMeta,
  type FindingLike,
  type ProjectionParams,
} from "./engine";

const DEMO_BASE = new URL("demo-data/", document.baseURI).href;

async function loadData<T>(file: string): Promise<T> {
  const res = await fetch(DEMO_BASE + file);
  if (!res.ok) throw new ApiError(res.status, `demo bundle file missing: ${file}`);
  return (await res.json()) as T;
}

let sessionPromise: Promise<DemoSession> | null = null;

function startSession(): Promise<DemoSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const [meta, leaks, plays] = await Promise.all([
        loadData<DemoMeta>("meta.json"),
        loadData<{ findings: FindingLike[]; totals: unknown }>("leaks.json"),
        loadData<Play[]>("plays.json"),
      ]);
      return new DemoSession(meta, leaks.findings, plays);
    })();
  }
  return sessionPromise;
}

/** Wrap an endpoint so engine rejections surface as typed API errors. */
function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e: unknown) => {
    if (e instanceof Error && e.name === "DemoError")
      throw new ApiError((e as unknown as { status: number }).status, e.message);
    throw e;
  });
}

export function makeStaticApi(): CelenganApi {
  const session = () => startSession();
  const params = async (): Promise<ProjectionParams> => (await session()).meta;

  /* Static transactions: the full ledger is intentionally not shipped with
   * the demo bundle (no page reads it); the endpoint reports an empty list
   * rather than erroring, to keep the surface complete. */
  const transactions = async (): Promise<Txn[]> => [];

  const forecastState = async (state: "baseline" | "current", days: number): Promise<Forecast> => {
    const m = await params();
    const s = await session();
    if (state === "baseline") {
      const r = project(m, days);
      return {
        state,
        window_days: days,
        doom_day: r.doom_day,
        lowest_balance: r.lowest_balance,
        applied_exclusions: [],
        applied_credits_total: 0,
        applied_discounts: {},
        points: r.points,
      };
    }
    const cur = s.forecastCurrent(m, days);
    return {
      state,
      window_days: days,
      doom_day: cur.doom_day,
      lowest_balance: cur.lowest_balance,
      applied_exclusions: [...s.applied.exclusions].sort(),
      applied_credits_total: pyRound(s.applied.credits.reduce((a, b) => a + b, 0), 2),
      applied_discounts: { ...s.applied.discounts },
      points: cur.points,
    };
  };

  function viewOf(state: string, r: { window_days: number; doom_day: string | null; lowest_balance: number; points: Forecast["points"] }): Forecast {
    return {
      state,
      window_days: r.window_days,
      doom_day: r.doom_day,
      lowest_balance: r.lowest_balance,
      applied_exclusions: [],
      applied_credits_total: 0,
      applied_discounts: {},
      points: r.points,
    };
  }

  const api: CelenganApi = {
    health: async () => {
      const meta = (await params()) as ProjectionParams & DemoMeta;
      return {
        status: "ok",
        app: "Celengan (static demo)",
        version: meta.version,
        sandbox: "static-demo",
        sandbox_seed: meta.seed,
        llm_enabled: false,
      };
    },

    sandbox: async (): Promise<Sandbox> => {
      const meta = (await params()) as ProjectionParams & DemoMeta;
      return {
        user: meta.user,
        synthetic: meta.synthetic,
        window_days: meta.window_days,
        transaction_count: meta.transaction_count,
        balance_now: meta.balance_now,
        recurring_count: meta.recurring_count,
        findings_count: meta.findings_count,
      };
    },

    reloadSandbox: async () => {
      const s = await session();
      s.reload();
      return { message: "sandbox session reloaded (deterministic seed)" };
    },

    transactions,

    leaks: async () => {
      const s = await session();
      const { totals } = await loadData<{ totals: { monthly_impact: number; annual_impact: number } }>(
        "leaks.json",
      );
      return { findings: s.findings, totals };
    },

    forecast: async (days = 40) => {
      const [baseline, current] = [await forecastState("baseline", days), await forecastState("current", days)];
      return { baseline, current } satisfies ForecastPair;
    },

    whatIf: async (exclude: string[], credits: number[], days = 40) => {
      const m = await params();
      const r = whatIf(m, days, { exclusions: exclude, one_time_credits: credits });
      return {
        excluded: [...exclude].sort(),
        one_time_credits: credits,
        monthly_savings: r.monthly_savings,
        baseline: viewOf("baseline", r.baseline),
        counterfactual: viewOf("counterfactual", r.counterfactual),
      } satisfies WhatIf;
    },

    plays: () => wrap(() => loadData<Play[]>("plays.json")),

    requestAction: (body) =>
      wrap(async () =>
        (await session()).requestAction(body.finding_id, body.tier, body.confirm) as Receipt,
      ),

    undo: (receipt_id: string) => wrap(async () => (await session()).undo(receipt_id)),

    killSwitch: (enabled: boolean) =>
      wrap(async () => ({ message: (await session()).setKillSwitch(enabled) })),

    consent: async (): Promise<Consent> => (await session()).consentView(),

    setConsent: (enabled: boolean) => wrap(async () => (await session()).setConsent(enabled)),

    receipts: async (): Promise<Receipt[]> => (await session()).receipts,

    audit: async (limit = 200): Promise<AuditEvent[]> => (await session()).audit.slice(-limit),
  };
  return api;
}
