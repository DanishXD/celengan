import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowCounterClockwise,
  CaretDown,
  CheckCircle,
  Lightning,
  LightningSlash,
  Play,
  ShieldWarning,
} from "@phosphor-icons/react";
import { api, type Play as PlayModel, type Receipt } from "../lib/api";
import { fmtClock, money, PLAYBOOK_LABEL } from "../lib/format";
import { useResource } from "../lib/useApi";
import {
  ErrorBanner,
  PageHeader,
  Panel,
  Progress,
  RefreshButton,
  ReceiptStatusChip,
  SkeletonCard,
  Toggle,
} from "../components/ui";

export default function ActionDesk() {
  const plays = useResource(api.plays, []);
  const receipts = useResource(api.receipts, []);
  const consent = useResource(api.consent, []);

  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<{ key: string; message: string } | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [params] = useSearchParams();
  const focus = params.get("focus");

  const refreshAll = () => {
    plays.refresh();
    receipts.refresh();
    consent.refresh();
  };

  const setConsentToggle = async (fn: () => Promise<unknown>) => {
    setConsentBusy(true);
    try {
      await fn();
      consent.refresh();
    } finally {
      setConsentBusy(false);
    }
  };

  /** The active (not undone) receipt covering this finding+playbook, if any.
   * The backend enforces one active play per finding. */
  const activeReceipt = (p: PlayModel) =>
    (receipts.data ?? []).find(
      (r) => r.finding_id === p.finding_id && r.playbook === p.playbook && !r.undone,
    );

  const runPlay = async (p: PlayModel) => {
    const key = `${p.finding_id}:${p.playbook}`;
    setBusyItem(key);
    setPolicyError(null);
    try {
      await api.requestAction({ finding_id: p.finding_id, tier: p.tier, confirm: true });
      refreshAll();
    } catch (e) {
      setPolicyError({ key, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyItem(null);
    }
  };

  const undoReceipt = async (r: Receipt) => {
    setBusyItem(r.id);
    setPolicyError(null);
    try {
      await api.undo(r.id);
      refreshAll();
    } catch (e) {
      setPolicyError({ key: r.id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyItem(null);
    }
  };

  const loading = plays.loading || receipts.loading || consent.loading;
  const error = plays.error ?? receipts.error ?? consent.error;

  return (
    <>
      <PageHeader
        title="Action Desk"
        sub="Proposals may come from anywhere — approval comes from here. Every play is tier-gated, capped, reversible and audited."
        actions={<RefreshButton onClick={refreshAll} />}
      />

      {error && !loading ? <ErrorBanner message={error} onRetry={refreshAll} /> : null}

      {loading || !plays.data || !receipts.data || !consent.data ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <SkeletonCard lines={5} />
          <SkeletonCard lines={5} />
          <SkeletonCard lines={6} className="xl:col-span-2" />
        </div>
      ) : (
        <div className="grid gap-5">
          <Panel
            title="Permission ladder"
            sub="Tier 1 drafts what you send · Tier 2 executes inside your caps · kill switch halts all of it"
          >
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">Tier 2 autonomy</p>
                  <p className="mt-0.5 text-xs leading-snug text-ink-soft">
                    Bounded plays may pause or downgrade a bill at renewal
                  </p>
                </div>
                <Toggle
                  ariaLabel="Tier 2 consent"
                  checked={consent.data.tier2_enabled}
                  disabled={consentBusy}
                  onChange={(v) => setConsentToggle(() => api.setConsent(v))}
                />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">Kill switch</p>
                  <p className="mt-0.5 text-xs leading-snug text-ink-soft">
                    Hard stop — autopilot halts instantly, drafts stay allowed
                  </p>
                </div>
                <Toggle
                  ariaLabel="Kill switch"
                  tone="alert"
                  checked={consent.data.kill_switch}
                  disabled={consentBusy}
                  onChange={(v) => setConsentToggle(() => api.killSwitch(v))}
                />
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-soft">Autopilot budget this month</p>
                <p className="num mt-1 text-sm font-bold">
                  {money(consent.data.tier2_spent_this_month)}{" "}
                  <span className="font-semibold text-ink-faint">
                    / {money(consent.data.tier2_monthly_cap)}
                  </span>
                </p>
                <div className="mt-2">
                  <Progress
                    value={consent.data.tier2_spent_this_month}
                    max={consent.data.tier2_monthly_cap}
                  />
                </div>
                <p className="mt-2 text-[11px] text-ink-faint">
                  per-action cap {money(consent.data.tier2_max_single_action)} · undo refunds the
                  budget
                </p>
              </div>
            </div>
          </Panel>

          <Panel
            title="Available plays"
            sub="Derived live from Leak Radar — each play carries its own receipts and undo"
            bodyClassName="grid gap-4 p-5 xl:grid-cols-2"
          >
            {plays.data.length === 0 ? (
              <p className="text-xs text-ink-soft">No leaks → no plays. Nothing to do.</p>
            ) : (
              plays.data.map((p) => {
                const key = `${p.finding_id}:${p.playbook}`;
                const active = activeReceipt(p);
                const ownTierActive = active !== undefined && active.tier === p.tier;
                const busy = busyItem === key;
                const isTier2 = p.tier === 2;
                const rejectedHere = policyError?.key === key;
                return (
                  <div
                    key={key}
                    className={`rounded-2xl border p-4 transition-colors ${
                      focus === p.finding_id
                        ? "border-piggy bg-piggy-soft/60"
                        : "border-line bg-surface"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`chip ${isTier2 ? "chip-green" : "chip-amber"}`}>
                            Tier {p.tier}
                          </span>
                          <span className="text-sm font-bold tracking-tight">{p.label}</span>
                        </div>
                        <p className="mt-1 text-xs text-ink-soft">
                          {p.merchant} · {PLAYBOOK_LABEL[p.playbook]} ·{" "}
                          {money(p.impact_monthly)}/mo at stake
                        </p>
                      </div>
                      {isTier2 ? (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busy || active !== undefined}
                          onClick={() => void runPlay(p)}
                        >
                          <Play size={13} weight="bold" />
                          {active !== undefined ? (ownTierActive ? "Active" : "Taken") : "Activate"}
                        </button>
                      ) : (
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={busy || active !== undefined}
                          onClick={() => void runPlay(p)}
                        >
                          <Lightning size={13} weight="bold" />
                          {active !== undefined ? (ownTierActive ? "Drafted" : "Taken") : "One-tap draft"}
                        </button>
                      )}
                    </div>

                    {ownTierActive && !isTier2 ? (
                      <p className="mt-2 text-[11px] text-ok">
                        Draft saved in receipts — read it, send it, then track the refund.
                      </p>
                    ) : null}
                    {active !== undefined && active.tier !== p.tier ? (
                      <p className="mt-2 text-[11px] text-ok">
                        Tier {active.tier} play is already active for this leak — undo it to free
                        this one.
                      </p>
                    ) : null}
                    {rejectedHere ? (
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] font-semibold text-alert-strong">
                        <ShieldWarning size={13} weight="fill" className="mt-px shrink-0" />{" "}
                        Policy: {policyError.message}
                      </p>
                    ) : null}
                  </div>
                );
              })
            )}
          </Panel>

          <Panel
            title="Receipts"
            sub="Proof for every approved play — printed evidence, expected impact, one-tap undo"
            bodyClassName="p-3"
          >
            {receipts.data.length === 0 ? (
              <p className="px-3 py-6 text-xs text-ink-soft">
                No plays executed in this session yet. Drafts and autopilot pauses appear here the
                moment the Policy Engine approves them.
              </p>
            ) : (
              <div className="divide-y divide-line">
                {receipts.data.map((r) => {
                  const busy = busyItem === r.id;
                  const isFocus = focus === r.finding_id;
                  return (
                    <details key={r.id} className="group" open={isFocus}>
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3.5 transition-colors hover:bg-surface-warm [&::-webkit-details-marker]:hidden">
                        <ReceiptStatusChip status={r.status} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{r.subject}</p>
                          <p className="truncate text-xs text-ink-soft">
                            {r.id} · {fmtClock(r.created_at)} · {r.impact_note} · by{" "}
                            {r.generator}
                          </p>
                        </div>
                        {r.undone ? null : (
                          <button
                            className="btn btn-danger-outline btn-sm shrink-0"
                            disabled={busy}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void undoReceipt(r);
                            }}
                          >
                            <ArrowCounterClockwise size={13} weight="bold" />
                            Undo
                          </button>
                        )}
                        <CaretDown
                          size={15}
                          className="shrink-0 text-ink-faint transition-transform group-open:rotate-180"
                        />
                      </summary>
                      <div className="px-3 pb-4">
                        <div className="rounded-2xl bg-surface-warm p-4">
                          <p className="text-xs font-bold text-ink">{r.subject}</p>
                          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">
                            {r.body}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            {r.evidence_txn_ids.map((id) => (
                              <span key={id} className="num chip chip-ink text-[10px]">
                                {id}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </Panel>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-surface-warm px-5 py-4 text-xs text-ink-soft">
            <span className="flex items-center gap-1.5 font-semibold text-ink">
              <CheckCircle size={14} weight="fill" className="text-ok" />
              Policy verdicts are logged, never hidden
            </span>
            <span>Every decision lands in the Audit Trail — divergence is visible, not silent.</span>
            {consent.data.kill_switch ? (
              <span className="flex items-center gap-1.5 font-semibold text-alert-strong">
                <LightningSlash size={13} weight="fill" /> Kill switch engaged
              </span>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
