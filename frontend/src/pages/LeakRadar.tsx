import { Link } from "react-router-dom";
import { ArrowRight, CaretDown, MoonStars, CopySimple, Receipt, ArrowUpRight, Detective, type Icon } from "@phosphor-icons/react";
import { api, type Leak } from "../lib/api";
import { fmtDay, money, PLAYBOOK_LABEL } from "../lib/format";
import { useResource } from "../lib/useApi";
import { ErrorBanner, PageHeader, Panel, RefreshButton, SkeletonCard, StatTile } from "../components/ui";

const TYPE_ICON: Record<string, Icon> = {
  subscription_creep: MoonStars,
  duplicate_charge: CopySimple,
  hidden_fee: Receipt,
  silent_price_hike: ArrowUpRight,
};

/** Which tier ladders each playbook unlocks (mirrors the backend planner). */
const TIER_AVAILABILITY: Record<string, { tiers: [number, number?]; label: string }> = {
  cancel_subscription: { tiers: [1, 2], label: "Tier 2 autopilot ready" },
  dispute_duplicate: { tiers: [1], label: "Tier 1 draft only" },
  claim_fee_refund: { tiers: [1], label: "Tier 1 draft only" },
  renegotiate_hike: { tiers: [1, 2], label: "Tier 2 autopilot ready" },
};

function confidenceChip(v: number) {
  const pct = `${Math.round(v * 100)}% sure`;
  if (v >= 0.9) return <span className="chip chip-red">{pct}</span>;
  if (v >= 0.75) return <span className="chip chip-amber">{pct}</span>;
  return <span className="chip chip-ink">{pct}</span>;
}

function contextLine(f: Leak): string {
  const c = f.context as {
    dates?: string[];
    occurrences?: number;
    uses_90d?: number;
    previous_price?: number;
    new_price?: number;
    count?: number;
    total?: number;
  };
  if (c.dates) return `charges on ${c.dates.map(fmtDay).join(" and ")} — ${fmtDay(c.dates[1])} is the one to dispute`;
  if (c.previous_price !== undefined && c.new_price !== undefined)
    return `repriced ${money(c.previous_price)} → ${money(c.new_price)} without notice`;
  if (c.occurrences !== undefined)
    return `${c.occurrences} charges so far, only ${c.uses_90d} logged uses in the last 90 days`;
  if (c.count !== undefined) return `${c.count} fee event(s) totaling ${money(c.total ?? 0)}`;
  return "";
}

export default function LeakRadar() {
  const leaks = useResource(api.leaks, []);

  const refresh = () => leaks.refresh();
  const busy = leaks.loading;
  const error = leaks.error;
  const data = leaks.data;

  return (
    <>
      <PageHeader
        title="Leak Radar"
        sub="Every leak is quantified on statement evidence, ranked by impact and confidence, and mapped to an execution playbook."
        actions={<RefreshButton onClick={refresh} />}
      />

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}

      {busy || !data ? (
        <div className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </div>
          <SkeletonCard lines={8} />
        </div>
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <StatTile
              label="Monthly impact"
              value={`−${money(data.totals.monthly_impact)}`}
              tone="coin"
              sub="compounding every 30 days"
            />
            <StatTile
              label="Annualized"
              value={`−${money(data.totals.annual_impact)}`}
              tone="coin"
              sub="what 12 months of silence costs"
            />
            <StatTile
              label="Leaks found"
              value={String(data.findings.length)}
              sub="all types — fees, duplicates, hikes, dark subscriptions"
            />
          </div>

          <Panel
            title="Ranked findings"
            sub="Tap a leak to open its receipts and run the play"
            bodyClassName="px-2 py-1 sm:px-3"
          >
            <div>
              {data.findings.map((f) => {
                const IconC = TYPE_ICON[f.type] ?? Detective;
                const avail = TIER_AVAILABILITY[f.playbook];
                return (
                  <details key={f.id} className="group border-b border-line last:border-b-0">
                    <summary className="flex cursor-pointer list-none items-center gap-4 px-2 py-4 transition-colors hover:bg-surface-warm sm:px-3 [&::-webkit-details-marker]:hidden">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-warm text-ink-soft">
                        <IconC size={21} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-bold tracking-tight">{f.title}</span>
                          {confidenceChip(f.confidence)}
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-xs text-ink-soft">{f.rationale}</p>
                      </div>
                      <div className="hidden shrink-0 text-right sm:block">
                        <div className="num text-sm font-bold text-alert">
                          −{money(f.impact_monthly)}/mo
                        </div>
                        <div className="num text-[11px] text-ink-faint">
                          {money(f.impact_annual)}/yr
                        </div>
                      </div>
                      <CaretDown
                        size={16}
                        className="shrink-0 text-ink-faint transition-transform group-open:rotate-180"
                      />
                    </summary>

                    <div className="px-2 pb-5 pt-1 sm:px-3 sm:pl-[4.4rem]">
                      <div className="rounded-2xl bg-surface-warm p-4">
                        <p className="max-w-[68ch] text-xs leading-relaxed text-ink-soft">
                          <span className="font-semibold text-ink">Evidence.</span> {f.rationale}
                        </p>
                        {contextLine(f) ? (
                          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                            <span className="font-semibold text-ink">Pattern.</span> {contextLine(f)}
                          </p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="chip chip-ink">playbook · {PLAYBOOK_LABEL[f.playbook]}</span>
                          <span
                            className={
                              avail.tiers[1] ? "chip chip-green" : "chip chip-amber"
                            }
                          >
                            {avail.label}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {f.evidence_txn_ids.slice(0, 6).map((id) => (
                            <span key={id} className="num chip chip-ink text-[10px]">
                              {id}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <Link to={`/actions?focus=${f.id}`} className="btn btn-primary btn-sm">
                          Run the play <ArrowRight size={13} weight="bold" />
                        </Link>
                        <span className="num text-[11px] text-ink-faint">
                          impact score {f.score?.toFixed(1) ?? "—"}
                        </span>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
