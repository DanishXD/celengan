import { useState } from "react";
import { ArrowsClockwise, PiggyBank, WarningCircle } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { useResource } from "../lib/useApi";
import {
  ErrorBanner,
  PageHeader,
  Panel,
  Progress,
  SkeletonCard,
  Toggle,
} from "../components/ui";

export default function Settings() {
  const sandbox = useResource(api.sandbox, []);
  const health = useResource(api.health, []);
  const consent = useResource(api.consent, []);
  const [busy, setBusy] = useState<"consent" | "kill" | "reload" | null>(null);
  const [reloadNote, setReloadNote] = useState<string | null>(null);

  const loading = sandbox.loading || health.loading || consent.loading;
  const error = sandbox.error ?? health.error ?? consent.error;

  const setFlag = async (which: "consent" | "kill", fn: () => Promise<unknown>) => {
    setBusy(which);
    try {
      await fn();
      consent.refresh();
    } finally {
      setBusy(null);
    }
  };

  const reload = async () => {
    setBusy("reload");
    setReloadNote(null);
    try {
      const res = await api.reloadSandbox();
      setReloadNote(res.message);
      sandbox.refresh();
      consent.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Settings"
        sub="Sandbox session, feature flags and the autonomy envelope. The deterministic core runs with zero keys; every safe default is right here."
      />

      {error ? <ErrorBanner message={error} onRetry={() => { sandbox.refresh(); health.refresh(); consent.refresh(); }} /> : null}

      {loading || !sandbox.data || !health.data || !consent.data ? (
        <div className="grid gap-5">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      ) : (
        <div className="grid gap-5">
          <Panel title="Sandbox session" sub="Fresh state without restarting the backend">
            <div className="grid gap-4 sm:grid-cols-2">
              <dl className="space-y-2 text-sm">
                {[
                  ["User", `${sandbox.data.user} (fully synthetic)`],
                  ["Ledger window", `${sandbox.data.window_days} days`],
                  ["Transactions", String(sandbox.data.transaction_count)],
                  ["Recurring series", String(sandbox.data.recurring_count)],
                  ["Leaks found", String(sandbox.data.findings_count)],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line pb-1.5">
                    <dt className="text-xs font-semibold text-ink-soft">{k}</dt>
                    <dd className="min-w-0 truncate font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <div>
                <p className="text-xs font-semibold text-ink-soft">Balance right now</p>
                <p className="num mt-1 text-2xl font-bold">{money(sandbox.data.balance_now)}</p>
                <button className="btn btn-outline btn-sm mt-3" onClick={() => void reload()} disabled={busy !== null}>
                  <ArrowsClockwise size={14} className={busy === "reload" ? "animate-spin" : undefined} />
                  Reload sandbox (deterministic seed {health.data.sandbox_seed})
                </button>
                {reloadNote ? <p className="mt-2 text-[11px] text-ok">{reloadNote}</p> : null}
                <p className="mt-2 max-w-[56ch] text-[11px] leading-relaxed text-ink-faint">
                  Reload resets receipts, applied plays and the consent envelope for this session —
                  the audit log stays append-only.
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Autonomy envelope" sub="Same controls as the Action Desk — one source of truth in the Policy Engine">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">Tier 2 consent</p>
                  <p className="mt-0.5 text-xs leading-snug text-ink-soft">
                    Off means every autopilot request is refused before it exists
                  </p>
                </div>
                <Toggle
                  ariaLabel="Tier 2 consent"
                  checked={consent.data.tier2_enabled}
                  disabled={busy !== null}
                  onChange={(v) => setFlag("consent", () => api.setConsent(v))}
                />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">Kill switch</p>
                  <p className="mt-0.5 text-xs leading-snug text-ink-soft">
                    Engage to halt all Tier 2; drafts (Tier 1) remain available
                  </p>
                </div>
                <Toggle
                  ariaLabel="Kill switch"
                  tone="alert"
                  checked={consent.data.kill_switch}
                  disabled={busy !== null}
                  onChange={(v) => setFlag("kill", () => api.killSwitch(v))}
                />
              </div>
              <div className="sm:col-span-2">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-soft">Autopilot budget usage</span>
                  <span className="num text-ink-soft">
                    {money(consent.data.tier2_spent_this_month)} / {money(consent.data.tier2_monthly_cap)} ·
                    per-action {money(consent.data.tier2_max_single_action)}
                  </span>
                </div>
                <Progress value={consent.data.tier2_spent_this_month} max={consent.data.tier2_monthly_cap} />
              </div>
            </div>
          </Panel>

          <Panel title="Feature flags" sub="The deterministic core needs nothing — extras are opt-in">
            <ul className="divide-y divide-line">
              <li className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-bold">Deterministic engine</p>
                  <p className="text-xs leading-snug text-ink-soft">
                    Detection, ranking, forecasting, policy — pure Python, no network, no keys
                  </p>
                </div>
                <span className="chip chip-green">always on</span>
              </li>
              <li className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-bold">LLM draft upgrades</p>
                  <p className="text-xs leading-snug text-ink-soft">
                    Optional nicer wording for Tier 1 drafts via env key · falls back to the
                    deterministic template on any failure
                  </p>
                </div>
                {health.data.llm_enabled ? (
                  <span className="chip chip-green">on</span>
                ) : (
                  <span className="chip chip-ink">off · template mode</span>
                )}
              </li>
              <li className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-bold">Engine version</p>
                  <p className="num text-xs leading-snug text-ink-soft">
                    celengan-api v{health.data.version} · seed {health.data.sandbox_seed}
                  </p>
                </div>
                <span className="chip chip-ink">
                  <PiggyBank size={12} weight="bold" /> {health.data.status}
                </span>
              </li>
            </ul>
          </Panel>

          <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-line bg-surface-warm px-5 py-4">
            <WarningCircle size={17} className="mt-0.5 shrink-0 text-coin" />
            <div className="text-xs leading-relaxed text-ink-soft">
              <span className="font-bold text-ink">Celengan Labs</span> — entry for the 2026 Shenzhen
              International FinTech Competition (Topic A: Personal Finance Assistant). “Maya” and her
              ledger are 100% synthetic: no bank connections, no real personal data, no live
              transfers. The agent can only act inside the permissions on this page.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
