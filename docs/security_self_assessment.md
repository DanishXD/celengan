# Celengan — Security Self-Assessment Report

> Required report: how the agent's permission tiers are implemented, and the
> honest list of known risks. Written against the actual code in this
> repository (backend `app/policy`, `app/state`, `app/agent`).

## 1. What this system is (and is not)

Celengan is a **sandbox-only** agentic personal CFO. All data is a
deterministic synthetic user ("Maya") generated in-repo; there is no bank
connectivity, no credentials, no live funds movement, and no external network
calls in the default configuration. The only external call is the opt-in LLM
drafting call (§5). The competition demo therefore cannot touch real money by
construction — the architecture is still designed as if it later would, so
that the governance model is real rather than cosmetic.

## 2. Permission-tier implementation

Status: **implemented**, enforced server-side in
`backend/app/policy/engine.py` (single decision point; the frontend only
displays verdicts, it never grants them).

| Tier | Name | Capability | Enforcement (exact mechanism) | Status |
|------|------|------------|-------------------------------|--------|
| 0 | Observe | read-only analysis of the sandbox ledger | always permitted (`_decide` tier-0 path) | ✅ shipped |
| 1 | Draft | prepare letters (dispute, waiver, cancel, renegotiate); never sends anything | request must carry `confirm=true` (the UI's one-tap); else 422 | ✅ shipped |
| 2 | Micro-autopilot | pause or downgrade one recurring bill at its renewal | all four checks must pass, in order: kill switch off → Tier-2 consent on → amount ≤ per-action cap ($50) → month-to-date spend + amount ≤ monthly cap ($400) | ✅ shipped |

Supporting mechanisms:

- **Consent envelope** (`Consent` dataclass): `tier2_enabled`,
  `kill_switch`, `tier2_spent_this_month`. POST `/consent` toggles consent;
  POST `/actions/kill-switch` engages the emergency stop; both are logged.
- **Kill switch precedence**: even with consent on and budget left, an
  engaged kill switch rejects every Tier-2 request (test:
  `test_kill_switch_blocks_tier2_even_with_consent`, API test asserts the
  verbatim reason).
- **Budget fairness**: undo releases the reserved spend
  (`release_tier2_spend`), so an undone play refunds the user's envelope
  rather than silently consuming cap space.
- **One active play per finding**: a duplicate request over an active
  finding+playbook is rejected with 409 *before* reaching the policy engine
  (test: `test_full_action_flow` / UI shows "Taken").
- **Session reset policy**: `/sandbox/reload` resets receipts, applied
  effects and the consent envelope (fresh-consent default is the safe
  failure mode), while the audit log persists.

## 3. Money-path invariants

1. **Single decision point.** All effects pass `PolicyEngine.evaluate`;
   `AppState.execute_action` is the only code path that creates receipts or
   applies effects (`recurring_exclusion`, `recurring_discount`,
   `one_time_credit` — the whitelist the forecaster accepts).
2. **Predictable blast radius.** A Tier-2 play may only remove one bill
   series or reduce it by the finding's quantified delta. It cannot invent
   transfers, change balances directly, or touch other merchants.
3. **Forecast honesty.** `GET /forecast` always returns the baseline *and*
   the current projection, so the user can see exactly what executed plays
   changed — and undo restores parity (test: `test_tier2_downgrade_applies_discount`
   asserts lowest-balance equality after undo).
4. **Verbatim rejections.** Rejected requests return the engine reason
   verbatim (HTTP 422) and the UI renders it; nothing is silently dropped.

## 4. Auditability

- `app/policy/audit.py` is an **append-only JSONL** writer; events are
  additionally held in-memory for `GET /audit`. Log locations are
  configurable (`settings.audit_path`).
- Events recorded: `session.reloaded`, `consent.updated`, `kill_switch`,
  `action.requested`-adjacent `policy.decision` (every verdict, approved or
  not), `receipt.created`, `action.undone`, `tier2.spend_recorded`,
  `tier2.spend_released`.
- There is **no code path that rewrites or deletes** past events; the demo
  evidence artifacts (`docs/evidence/*.json`) reference audit event counts
  for cross-checking.
- Replay property: the log alone reconstructs consent changes, decisions,
  receipts, undos and their timestamps for a session.

## 5. LLM posture (prompt-injection resilience)

- The LLM is **draft polish only**: with `CELENGAN_LLM_ENABLED` + key set,
  `app/agent/planner.build_draft` sends the deterministic template text to an
  OpenAI-compatible endpoint and asks for a friendlier rewrite. Facts are
  pinned in the prompt ("keep every factual figure identical").
- The model returns **text**, which replaces only the letter body. It is not
  parsed as instructions; it cannot invoke tools, reach the Policy Engine, or
  alter tiers, caps, or effects. The money path terminates in plain-Python
  code the model never sees (§3.1).
- Any failure (no key, timeout, non-JSON, empty body) falls back to the
  deterministic template — the flagged feature can degrade, the core cannot.
- Statement/merchant strings are treated as data end-to-end; no downstream
  eval of model or statement content.

## 6. Data handling

- **Minimization**: the sandbox contains a synthetic profile only; no real
  PII is collected, stored, or transmitted. The UI states this permanently
  ("100% simulated account · no bank access").
- **Transport/config**: dev CORS is `*` for demo reachability; production
  guidance is origin-pinning to the deployed frontend (known-risk R6).
- **Secrets**: the LLM key is env-only (`CELENGAN_LLM_API_KEY`), never
  logged through the audit writer, never embedded in the frontend; docker
  compose passes it via environment substitution without baking it into images.

## 7. Known-risk list (honest, current)

| # | Risk | Severity | Present mitigation | Production plan |
|---|------|----------|--------------------|-----------------|
| R1 | In-memory session state: consent, receipts and cap tracking reset when the API process restarts | Medium | accepted for the sandbox; audit trail proves what happened | durable per-user consent + cap ledger (SQLite table already in requirements) |
| R2 | Audit log is append-only *by code*, not tamper-proof: a user with disk access could edit the file | Medium | runs server-side, file outside web root | hash-chained events (each line includes prev-hash), periodic export |
| R3 | No authentication on the demo API | Medium | sandbox-only, binds to loopback in dev mode | per-user OAuth (open-banking identity), API keys for programmatic access |
| R4 | Tier-2 "amount" is the finding's quantified impact, not a real-money authorization | Low (sandbox) | effects are forecasts, no rails exist to move money | amount = verified payment authorization with provider-side confirmation |
| R5 | LLM endpoint pattern (`base_url` from env) allows operator misconfiguration (e.g. accidental network egress) | Low | documented defaults, key env-only, timeout 20 s, no tool access | egress allow-list at the container/host layer |
| R6 | Dev CORS `*` | Low | demo-only convenience | pin to deployed origin, credentials policy |
| R7 | No rate limiting on action endpoints | Low | caps already bound impact; repeat plays blocked (409) | token-bucket per user per endpoint |
| R8 | `sqlalchemy` is in requirements but unused (planned durable store) | Info | none needed | implement the persistence layer in R1 |

## 8. Self-assessment checklist

- [x] Permission tiers implemented **and tested** (tier ladder, caps, kill
      switch, undo, 40-on-duplicate — 44 backend tests, incl. API-level
      end-to-end flows)
- [x] Known-risk list with severity, current mitigation and production plan
- [x] Prompt-injection stance documented (draft-only LLM, fallback template)
- [x] Audit log: append-only, replayable, surfaced in the Audit Trail page
- [x] Data minimization: synthetic-only, no real PII or external calls by default
- [x] Safe failure modes: reset → no consent; LLM error → template; engine
      down → designed UI error states
- [ ] Real-bank deployment items (auth, durable state, tamper-evident audit)
      — intentionally out of scope for the sandbox submission, mapped in §7
