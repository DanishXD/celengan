import { useMemo, useState } from "react";
import { ChartLine } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { fmtDay, money } from "../lib/format";
import { useResource } from "../lib/useApi";
import {
  ErrorBanner,
  ForecastChart,
  PageHeader,
  Panel,
  RefreshButton,
  SkeletonCard,
  StatTile,
  findDoomPoint,
} from "../components/ui";

const DAYS = 40;

export default function FutureOracle() {
  const forecast = useResource(() => api.forecast(DAYS), []);
  const leaks = useResource(api.leaks, []);

  const [simExclude, setSimExclude] = useState<string[]>([]);
  const [simCredits, setSimCredits] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.whatIf>> | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const b = forecast.data?.baseline ?? null;
  const c = forecast.data?.current ?? null;
  const busy = forecast.loading || leaks.loading;
  const error = forecast.error ?? leaks.error;
  const refresh = () => {
    forecast.refresh();
    leaks.refresh();
    setResult(null);
  };

  /** Merchant choices come from findings; credits come from refundable findings. */
  const merchants = useMemo(
    () => Array.from(new Set((leaks.data?.findings ?? []).map((f) => f.merchant))),
    [leaks.data],
  );
  const creditFindings = useMemo(
    () => (leaks.data?.findings ?? []).filter((f) => f.playbook !== "cancel_subscription"),
    [leaks.data],
  );
  const creditTotal = creditFindings.reduce((s, f) => s + f.impact_monthly, 0);

  const toggleMerchant = (m: string) => {
    setSimExclude((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const runSim = async () => {
    setSimBusy(true);
    setSimError(null);
    try {
      const credits = simCredits ? creditFindings.map((f) => f.impact_monthly) : [];
      setResult(await api.whatIf(simExclude, credits, DAYS));
    } catch (e) {
      setSimError(e instanceof Error ? e.message : String(e));
    } finally {
      setSimBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Future Oracle"
        sub="Reflection Nebula — a deterministic 40-day projection of every balance, before and after plays."
        actions={<RefreshButton onClick={refresh} />}
      />

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}

      {busy || !b || !c ? (
        <div className="grid gap-5">
          <SkeletonCard lines={6} />
          <div className="grid gap-5 sm:grid-cols-2">
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
          </div>
        </div>
      ) : (
        <div className="grid gap-5">
          <Panel title="Behavioral projection" sub="Baseline vs today (active plays applied)">
            <ForecastChart baseline={b.points} current={c.points} doom={findDoomPoint(b)} height={340} />
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

          <div className="grid gap-5 sm:grid-cols-3">
            <StatTile
              label="Baseline doom day"
              value={b.doom_day ? fmtDay(b.doom_day) : "None"}
              tone={b.doom_day ? "alert" : "ink"}
              sub={b.doom_day ? `first negative-balance day · lowest ${money(b.lowest_balance)}` : "no dip inside the window"}
            />
            <StatTile
              label="Today’s doom day"
              value={c.doom_day ? fmtDay(c.doom_day) : "Cleared"}
              tone={c.doom_day ? "alert" : "ok"}
              sub={`lowest with plays ${money(c.lowest_balance)}`}
            />
            <StatTile
              label="Active-play effect"
              value={
                c.applied_exclusions.length + Object.keys(c.applied_discounts).length > 0
                  ? `Lowest ${money(c.lowest_balance)}`
                  : "—"
              }
              sub={
                curEffectSub(c.applied_exclusions.join(", "), Object.keys(c.applied_discounts).join(", "))
              }
            />
          </div>

          <Panel
            title="What-if simulator"
            sub="Explore counterfactuals — nothing here executes; the Action Desk does that"
            action={
              <button
                className="btn btn-primary btn-sm"
                onClick={runSim}
                disabled={simBusy || (simExclude.length === 0 && !simCredits)}
              >
                <ChartLine size={14} weight="bold" />
                {simBusy ? "Simulating…" : "Simulate"}
                </button>
            }
          >
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold text-ink-soft">
                  Remove these bills from the schedule
                </p>
                <div className="flex flex-wrap gap-2">
                  {merchants.map((m) => {
                    const on = simExclude.includes(m);
                    return (
                      <button
                        key={m}
                        role="switch"
                        aria-checked={on}
                        aria-pressed={on}
                        onClick={() => toggleMerchant(m)}
                        className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                          on
                            ? "border-piggy bg-piggy text-[#F2F6EE]"
                            : "border-line-strong text-ink-soft hover:bg-surface-warm hover:text-ink"
                        }`}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold text-ink-soft">
                  Assume one-time credits land
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    role="switch"
                    aria-checked={simCredits}
                    aria-pressed={simCredits}
                    onClick={() => setSimCredits((v) => !v)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      simCredits
                        ? "border-piggy bg-piggy text-[#F2F6EE]"
                        : "border-line-strong text-ink-soft hover:bg-surface-warm hover:text-ink"
                    }`}
                  >
                    All refunds & waivers (+{money(creditTotal)})
                  </button>
                </div>
              </div>

              {simError ? <ErrorBanner message={simError} /> : null}

              {result ? (
                <div className="grid gap-4 rounded-2xl bg-surface-warm p-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold text-ink-soft">Monthly savings</p>
                    <p className="num mt-1 text-xl font-bold text-ok">
                      {money(result.monthly_savings)}/mo
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-ink-soft">Doom day</p>
                    <p className="num mt-1 text-sm font-bold">
                      {result.baseline.doom_day ? fmtDay(result.baseline.doom_day) : "none"}
                      <span className="mx-1.5 text-ink-faint">→</span>
                      <span className={result.counterfactual.doom_day ? "text-alert" : "text-ok"}>
                        {result.counterfactual.doom_day ? fmtDay(result.counterfactual.doom_day) : "Cleared"}
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-ink-soft">Lowest balance</p>
                    <p className="num mt-1 text-sm font-bold">
                      {money(result.baseline.lowest_balance)}
                      <span className="mx-1.5 text-ink-faint">→</span>
                      <span className={result.counterfactual.lowest_balance >= 0 ? "text-ok" : "text-alert"}>
                        {money(result.counterfactual.lowest_balance)}
                      </span>
                    </p>
                  </div>
                  <div className="sm:col-span-3">
                    <ForecastChart
                      baseline={result.baseline.points}
                      current={result.counterfactual.points}
                      doom={findDoomPoint(result.baseline)}
                      height={280}
                    />
                    <p className="mt-2 text-[11px] text-ink-faint">
                      Solid line = counterfactual. Executing these plays on the Action Desk makes the
                      “current” line above converge to this.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs leading-relaxed text-ink-soft">
                  Pick merchants above and run the simulation. Simulations never touch money — they
                  are a rehearsal for the permission-laddered plays.
                </p>
              )}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

function curEffectSub(exclusions: string, discounts: string): string {
  if (!exclusions && !discounts) return "no recurring effect applied yet";
  const parts: string[] = [];
  if (exclusions) parts.push(`${exclusions} paused`);
  if (discounts) parts.push(`${discounts} downgraded`);
  return parts.join(" · ");
}
