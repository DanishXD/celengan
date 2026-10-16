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

Full quickstart (frontend, seed, demo, deployment) is finalized in the docs phase.

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

- [ ] Technical documentation (architecture, core algorithms, security design) → `docs/architecture.md`
- [x] Source code with provenance and structure → this repository
- [ ] Deployment instructions → `README.md` + `docker-compose.yml`
- [ ] Test cases → `backend/tests/`
- [ ] Security self-assessment report → `docs/security_self_assessment.md`
- [ ] Execution evidence (sandbox operation logs + demo video) → `docs/evidence/`, `backend/demo/`
- [ ] Presentation deck (≤10 min) → final phase

## Team

**Team Celengan Labs** — International Track, Topic A.
