/** Parity test: the browser-side deterministic core vs the Python truth.
 *
 * Loads the frozen engine snapshot (public/demo-data/) produced by
 * `backend/demo/export_static.py`, replays the full demo story through the
 * TS port (projection + policy + effects + undo) and demands EXACT equality
 * on every projected point, doom day, lowest balance and savings figure.
 *
 * Bundle with esbuild (no extra deps) and run under node:
 *   esbuild scripts/parity.ts --bundle --platform=node --outfile=.parity.mjs && node .parity.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DemoError,
  DemoSession,
  project,
  whatIf,
  type DemoMeta,
} from "../src/lib/demo/engine";
import type { Play, Receipt } from "../src/lib/apiTypes";

const DEMO_DIR = fileURLToPath(new URL("../public/demo-data/", import.meta.url));
const readJson = <T>(f: string): T => JSON.parse(readFileSync(DEMO_DIR + f, "utf-8")) as T;

const meta = readJson<DemoMeta>("meta.json");
const leaks = readJson<{ findings: DemoSession["findings"] }>("leaks.json");
const plays = readJson<Play[]>("plays.json");
const expected = readJson<{
  story: { exclusions: string[]; one_time_credits: number[]; discounts: Record<string, number> };
  runs: Record<string, { baseline: ExpectedView; story: ExpectedView }>;
  story_result: { doom_day: string | null; lowest_balance: number; monthly_savings: number };
}>("expected.json");

interface ExpectedView {
  doom_day: string | null;
  lowest_balance: number;
  points: { day_offset: number; date: string; balance: number }[];
}

let checks = 0;
let failures = 0;

function expect(cond: boolean, label: string) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.error(`FAIL  ${label}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

function eq(a: unknown, b: unknown, label: string) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  expect(ja === jb, `${label} got=${ja} want=${jb}`);
}

/* ------------------------------------------------ 1. projection fidelity */
for (const [daysRaw, run] of Object.entries(expected.runs)) {
  const days = Number(daysRaw);
  const base = project(meta, days);
  eq(base.points, run.baseline.points, `baseline points (${days}d)`);
  expect(base.doom_day === run.baseline.doom_day, `baseline doom day (${days}d)`);
  const story = project(meta, days, {
    exclusions: expected.story.exclusions,
    one_time_credits: expected.story.one_time_credits,
    discounts: expected.story.discounts,
  });
  eq(story.points, run.story.points, `story points (${days}d)`);
  expect(story.doom_day === run.story.doom_day, `story doom day cleared (${days}d)`);
  expect(story.lowest_balance === run.story.lowest_balance, `story lowest (${days}d)`);
}

/* ---------------------------------------------------- 2. what-if port */
const w = whatIf(meta, 40, {
  exclusions: expected.story.exclusions,
  one_time_credits: expected.story.one_time_credits,
});
expect(w.monthly_savings === expected.story_result.monthly_savings, "what-if monthly savings");

/* ------------------------------------- 3. full session through policies */
const session = new DemoSession(meta, leaks.findings, plays);

// fresh session: no consent → tier 2 rejected with the exact backend reason
expectPolicyError(
  () => session.requestAction("L001", 2, true),
  422,
  "Tier 2 micro-autopilot not consented by user",
  "tier2 blocked without consent",
);
// tier 1 without confirm → rejected
expectPolicyError(
  () => session.requestAction("L003", 1, false),
  422,
  "Tier 1 requires one-tap human confirmation",
  "tier1 blocked without confirm",
);

// consent on → the whole story executes
session.setConsent(true);
expect((session.requestAction("L001", 2, true)).status === "autopilot_active", "gym autopilot");
expect((session.requestAction("L003", 1, true)).status === "draft_ready", "streamVibe dispute draft");
expect((session.requestAction("L002", 1, true)).status === "draft_ready", "penalty waiver draft");
expect((session.requestAction("L005", 2, true)).status === "autopilot_active", "spotify downgrade");

// duplicate play (any tier) → 409
expectPolicyError(
  () => session.requestAction("L001", 1, true),
  409,
  "this play is already active — undo it first",
  "duplicate play blocked",
);

// kill switch blocks a FRESH tier-2 rule (none left, but undo gym → retry)
const gymReceipt: Receipt = session.receipts[0];
session.undo(gymReceipt.id);
expect(gymReceipt.status === "undone" && gymReceipt.undone === true, "gym undo");
session.setKillSwitch(true);
expectPolicyError(
  () => session.requestAction("L001", 2, true),
  422,
  "kill switch engaged — all autopilot halted",
  "kill switch halts tier2",
);
session.setKillSwitch(false);
session.requestAction("L001", 2, true); // re-activate → full story state again

/* ------------------------------------ 4. post-story forecast vs fixtures */
const cur = session.forecastCurrent(meta, 40);
eq(cur.points, expected.runs["40"].story.points, "session forecast points = python truth");
expect(cur.doom_day === expected.runs["40"].story.doom_day, "session doom day cleared");
expect(
  cur.lowest_balance === expected.runs["40"].story.lowest_balance,
  `session lowest (${cur.lowest_balance})`,
);

/* ------------------------------------------- 5. budget envelope numbers */
expect(
  session.consent.tier2_spent_this_month === 29 + 3,
  `tier2 spend released+re-added (${session.consent.tier2_spent_this_month}) → $32`,
);

console.log(`\n${checks - failures}/${checks} parity checks passed`);
if (failures > 0) {
  console.error("PORT DRIFT DETECTED — the static demo must not ship this way");
  process.exit(1);
}

function expectPolicyError(fn: () => unknown, status: number, message: string, label: string) {
  try {
    fn();
    checks += 1;
    failures += 1;
    console.error(`FAIL  ${label} (no error thrown)`);
  } catch (e) {
    const de = e as DemoError;
    checks += 1;
    expect(de.status === status && de.message === message, `${label} (${de.status}: ${de.message})`);
  }
}

// top-level await works on node
export {};

