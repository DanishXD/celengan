# 🐷 Celengan

> **Detect. Simulate. Execute.** — An agentic personal CFO that turns bank statements into completed tasks, not dashboards.
>
> Entry for the 2026 Shenzhen International FinTech Competition — International Track, **Topic A (Personal Finance Assistant)**.

## What it is

Celengan connects to a simulated open-banking feed and runs three closed loops:

1. **🧭 Leak Radar** — normalizes raw transactions and detects subscription creep, duplicate charges, hidden fees, and silent price increases, ranked by quantified monthly impact.
2. **🔮 Future Oracle** — a behavioral cash-flow model that forecasts month-end balances, flags upcoming negative-balance days ("Doom Days"), and runs counterfactual what-if scenarios.
3. **⚡ Action Desk** — the agent's doer mode: fixes execute through a strict permission ladder (read-only → drafted actions → bounded micro-autopilot), protected by hard caps, instant undo, and an append-only audit trail.

Every recommendation ships with a **receipt**: evidence, reasoning, projected impact. A deterministic, non-LLM **Policy Engine** governs all agent actions.

## 🌐 Live preview (no install)

**https://danishxd.github.io/celengan/**

A self-contained **static demo** built from this repo by CI: the engine's
frozen sandbox snapshot ships with the app and the Policy Engine runs
in-browser — consent toggles, Tier-2 activation, caps, undo, kill switch and
the full audit trail all work. CI runs a parity test
(`frontend/scripts/parity.ts`) that proves the browser port reproduces the
Python engine **exactly** (every projected point, doom day, policy reason).
It is a demo of the same code, not a mock-up. Backend-dependent features
(ledger view, LLM draft polish) live in the full deployment below.

## Repository layout

```
celengan/
├── backend/          # FastAPI + SQLite — engines, policy engine, API, seed, demo CLI
│   ├── app/          # main application package (ingest, engine, policy, agent, api, models)
│   ├── seed/         # synthetic user & transaction generator (sandbox)
│   ├── tests/        # pytest suite
│   └── demo/         # `run_demo` CLI → sandbox operation logs (execution evidence)
├── frontend/         # React PWA (Vite + Tailwind + Recharts) — scaffolded in phase 2
├── docs/             # architecture.md, security_self_assessment.md, evidence/
├── docker-compose.yml
└── README.md
```

## Quickstart (backend, dev)

```bash
cd backend
python -m venv ../.venv
../.venv/Scripts/pip install -r requirements.txt     # (Linux/macOS: ../.venv/bin/pip)
../.venv/Scripts/python -m uvicorn app.main:app --reload
```

Health check: open http://127.0.0.1:8000/health

### Frontend (React PWA)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173  (proxies /api to 127.0.0.1:8000)
npm run build      # production build, PWA service worker + manifest included
```

Requires Node 20+. The dev server proxies `/api` to the backend, so run the
backend first. All data is the synthetic sandbox user "Maya" — nothing leaves
the machine.

## PWA pages

| Page | What it shows |
|---|---|
| **Dashboard** | Balance, leak totals, doom-day countdown, autopilot budget, 40-day projection chart |
| **Leak Radar** | Ranked findings with receipts: evidence, confidence, pattern, playbook |
| **Future Oracle** | Projection chart + what-if simulator (counterfactuals never execute) |
| **Action Desk** | Permission ladder (Tier 1 drafts / Tier 2 autopilot), kill switch, caps, one-tap undo |
| **Audit Trail** | Append-only session log: consent changes, policy verdicts, receipts |
| **Settings** | Feature flags (deterministic core / optional LLM), sandbox reload, about |

## LLM feature flag

Celengan runs 100% deterministic without any API key. To enable natural-language
explanations and drafted emails, set:

```env
CELENGAN_LLM_ENABLED=true
CELENGAN_LLM_API_KEY=...
CELENGAN_LLM_BASE_URL=https://api.openai.com/v1   # any OpenAI-compatible endpoint
CELENGAN_LLM_MODEL=gpt-4o-mini
```

The Policy Engine never permits the LLM to touch money directly — it may only
draft content and explain findings.

## Submission deliverables (competition checklist)

- [x] Technical documentation (architecture, core algorithms, security design) → `docs/architecture.md`
- [x] Source code with provenance and structure → this repository
- [x] Deployment instructions → below + `docker-compose.yml` (backend `Dockerfile`, frontend build + nginx)
- [x] Test cases → `backend/tests/` (44 tests: policy ladder, detectors, forecaster story locks, end-to-end API flows)
- [x] Security self-assessment report → `docs/security_self_assessment.md` (permission tiers, prompt-injection stance, known-risk list)
- [x] Execution evidence (sandbox operation logs) → `docs/evidence/leakradar_first_run.json`, `docs/evidence/actiondesk_first_run.json` (regenerate: `python -m demo.run_demo`)
- [ ] Demo video (≤5 min) → final phase
- [ ] Presentation deck (≤10 min) → final phase

## How to open the app (3 minutes)

**Requirements:** Python 3.11+ and Node 20+. All data is synthetic — nothing to sign up for.

**0. Fastest of all — the hosted static preview**

```text
https://danishxd.github.io/celengan/
```

(see §Live preview above; nothing to install, the policy engine runs in your browser)

**A. Fastest — dev mode**

```bash
# 1) backend
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload          # http://127.0.0.1:8000/health

# 2) frontend (second terminal)
cd frontend
npm install
npm run dev                                       # open http://localhost:5173
```

**B. Docker**

```bash
docker compose up --build                         # app on http://localhost:8080
```

`docker compose` builds the API and the nginx-served PWA; the frontend
proxies `/api` to the backend container. Requires Docker Engine v2+.

**C. Headless demo (terminal only)**

```bash
cd backend
python -m demo.run_demo
```

Prints the full three-act session (Leak Radar → Future Oracle → Action Desk
with live kill-switch enforcement) and writes evidence JSON to
`docs/evidence/`.

**Optional: LLM-polished drafts** — set `CELENGAN_LLM_ENABLED=true`,
`CELENGAN_LLM_API_KEY=…` (see §LLM feature flag) and restart the backend.
Without it, drafts come from the deterministic template: the recommended
judging configuration.

## Team

**Team Celengan Labs** — International Track, Topic A.
