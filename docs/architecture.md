# Celengan — System Architecture

> Working document. Final version due before the submission deadline
> (Oct 20, 2026, 23:59 Beijing).

## 1. Overview

TBD — three-loop agent: Leak Radar (detect), Future Oracle (simulate),
Action Desk (execute), governed by a deterministic Policy Engine.

## 2. Components

- **Ingest** — sandbox open-banking feed, CSV import
- **Engine** — merchant normalization, recurring detection, leak detectors,
  impact ranking, forecaster, counterfactual what-if
- **Policy Engine** — permission ladder (Tier 0/1/2), hard caps, undo, kill
  switch, append-only audit trail (JSONL)
- **Agent** — playbook registry; LLM planner behind a feature flag
- **API** — FastAPI (REST)
- **Frontend** — React PWA

## 3. Core algorithms

TBD (Day 2-3).

## 4. Security design

TBD — see `security_self_assessment.md`.
