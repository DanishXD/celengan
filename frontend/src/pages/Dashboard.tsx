import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarX,
  Coins,
  Lightning,
  LightningSlash,
  Lock,
  PiggyBank,
} from "@phosphor-icons/react";
import { api, type Consent } from "../lib/api";
import { signedMoney, fmtDay, money, daysUntil, LEAK_TYPE_LABEL } from "../lib/format";
import { useResource } from "../lib/useApi";
import {
  ErrorBanner,
  ForecastChart,
  PageHeader,
  Panel,
  Progress,
  RefreshButton,
  SkeletonCard,
  StatTile,
  Toggle,
  findDoomPoint,
} from "../components/ui";

const DAYS = 40;

export default function Dashboard() {
  const sandbox = useResource(api.sandbox, []);
  const leaks = useResource(api.leaks, []);
  const forecast = useResource(() => api.forecast(DAYS), []);
  const policy = useResource(api.consent, []);
  const [policyBusy, setPolicyBusy] = useState(false);

  const busy = sandbox.loading || leaks.loading || forecast.loading || policy.loading;
  const error = sandbox.error ?? leaks.error ?? forecast.error ?? policy.error;
  const refreshAll = () => {
    sandbox.refresh();
    leaks.refresh();
    forecast.refresh();
    policy.refresh();
  };

  if (error) return <ErrorBanner message={error} onRetry={refreshAll} />;

  if (busy || !sandbox.data || !leaks.data || !forecast.data || !policy.data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} lines={2} />
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <SkeletonCard className="xl:col-span-2" lines={5} />
            <SkeletonCard lines={5} />
          </div>
        </div>
      </>
    );
  }

  const b = forecast.data.baseline;
  const cur = forecast.data.current;
  const findings = leaks.data.findings;
  const consent: Consent = policy.data;
  const doom = findDoomPoint(b);

  const cleared = b.doom_day !== null && cur.doom_day === null;
  const doomDays = b.doom_day ? daysUntil(b.doom_day) : null;

  const monthlySecured =
    findings
      .filter((f) => cur.applied_exclusions.includes(f.merchant))
      .reduce((s, f) => s + f.impact_monthly, 0) +
    Object.values(cur.applied_discounts).reduce((s, v) => s + v, 0);
  const playsActive =
    cur.applied_exclusions.length + Object.keys(cur.applied_discounts).length > 0;

  const consentBusy = async (fn: () => Promise<unknown>) => {
    setPolicyBusy(true);
    try {
      await fn();
      policy.refresh();
    } finally {
      setPolicyBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub={`Maya — synthetic sandbox user · ${sandbox.data.window_days}-day ledger window · ${DAYS}-day projection`}
        actions={<RefreshButton onClick={refreshAll} />}
      />

      <div className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Balance right now"
            value={money(sandbox.data.balance_now)}
            sub={`${sandbox.data.transaction_count} normalized transactions`}
            icon={<PiggyBank size={15} className="text-piggy" />}
          />
          <StatTile
            label="Leak total"
            value={`−${money(leaks.data.totals.monthly_impact)}/mo`}
            tone="coin"
            sub={`${money(leaks.data.totals.annual_impact)}/year across ${findings.length} quantified leaks`}
            icon={<Coins size={15} className="text-coin" />}
          />
          <StatTile
            label="Doom day"
            value={
              cleared
                ? "Cleared"
                : b.doom_day
                  ? fmtDay(b.doom_day)
                  : "None in 40d"
            }
            tone={cleared ? "ok" : b.doom_day ? "alert" : "ink"}
            sub={
              cleared
                ? "Active plays erased the last dip"
                : b.doom_day && doomDays !== null
                  ? `≈ ${doomDays} days away · lowest ${signedMoney(b.lowest_balance)}`
                  : `Lowest ${signedMoney(b.lowest_balance)} — tracks upward`
            }
            icon={<CalendarX size={15} className={cleared ? "text-ok" : "text-alert"} />}
          />
          <StatTile
            label="Secured"
            value={
              monthlySecured > 0
                ? `+${money(monthlySecured)}/mo`
                : cur.applied_credits_total > 0
                  ? `+${money(cur.applied_credits_total)} credits`
                  : "—"
            }
            tone="ok"
            sub={
              cur.applied_credits_total > 0
                ? `plus ${money(cur.applied_credits_total)} one-time refunds in flight`
                : "run plays on the Action Desk to secure this"
            }
            icon={<Lock size={15} className="text-ok" />}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <Panel
            title="40-day projection"
            sub="Baseline vs. today with active plays applied"
            className="xl:col-span-2"
          >
            <ForecastChart baseline={b.points} current={cur.points} doom={doom} />
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] font-semibold text-ink-soft">
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-5 border-t-2 border-dashed border-ink-faint" /> baseline
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-5 border-t-2 border-solid border-piggy" /> current
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-alert" /> doom day
              </span>
            </div>
          </Panel>

          <Panel title="Autonomy envelope" sub="You set the lines the agent cannot cross">
            <div className="space-y-4">
              <label className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Tier 2 micro-autopilot</span>
                  <span className="block text-xs text-ink-soft">
                    Bounded, reversible, audited plays
                  </span>
                </span>
                <Toggle
                  ariaLabel="Tier 2 consent"
                  checked={consent.tier2_enabled}
                  disabled={policyBusy}
                  onChange={(v) => consentBusy(() => api.setConsent(v))}
                />
              </label>

              <label className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Kill switch</span>
                  <span className="block text-xs text-ink-soft">
                    Halts all autopilot instantly
                  </span>
                </span>
                <Toggle
                  ariaLabel="Kill switch"
                  tone="alert"
                  checked={consent.kill_switch}
                  disabled={policyBusy}
                  onChange={(v) => consentBusy(() => api.killSwitch(v))}
                />
              </label>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-soft">Autopilot this month</span>
                  <span className="num text-ink-soft">
                    {money(consent.tier2_spent_this_month)} / {money(consent.tier2_monthly_cap)}
                  </span>
                </div>
                <Progress value={consent.tier2_spent_this_month} max={consent.tier2_monthly_cap} />
              </div>

              <Link
                to="/actions"
                className="btn btn-primary btn-sm w-full"
              >
                <Lightning size={14} weight="bold" />
                Open Action Desk
              </Link>
            </div>
          </Panel>
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <Panel
            title="Top leaks by score"
            action={
              <Link to="/leaks" className="btn btn-outline btn-sm">
                Full radar <ArrowRight size={13} weight="bold" />
              </Link>
            }
            className="xl:col-span-2"
            bodyClassName="px-3 py-2"
          >
            <ol>
              {findings.slice(0, 3).map((f, i) => (
                <li key={f.id}>
                  <Link
                    to="/leaks"
                    className="group flex items-center gap-4 rounded-2xl px-3 py-3.5 transition-colors hover:bg-surface-warm"
                  >
                    <span className="num text-sm font-bold text-ink-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{f.title}</span>
                      <span className="block text-xs text-ink-soft">{LEAK_TYPE_LABEL[f.type]}</span>
                    </span>
                    <span className="num text-sm font-bold text-alert">
                      −{money(f.impact_monthly)}/mo
                    </span>
                    <ArrowRight
                      size={15}
                      weight="bold"
                      className="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel
            title={playsActive ? "Active plays" : "No plays running"}
            sub={playsActive ? "Effects already shaping the projection" : "The agent has not touched money yet"}
          >
            {playsActive ? (
              <div className="space-y-2">
                {cur.applied_exclusions.map((m) => (
                  <div key={m} className="chip chip-green-on w-fit">
                    <LightningSlash size={12} weight="bold" /> {m} · paused
                  </div>
                ))}
                {Object.entries(cur.applied_discounts).map(([m, v]) => (
                  <div key={m} className="chip chip-green-on w-fit">
                    <LightningSlash size={12} weight="bold" /> {m} · −{money(v)}/mo bill
                  </div>
                ))}
                {cur.applied_credits_total > 0 ? (
                  <div className="chip chip-green w-fit">
                    {money(cur.applied_credits_total)} refunds in flight
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-ink-soft">
                Plays only run inside your autonomy envelope. Everything is undoable and written to
                the audit trail.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
