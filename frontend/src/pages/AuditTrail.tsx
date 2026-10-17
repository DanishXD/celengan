import { useMemo, useState } from "react";
import { MagnifyingGlass, Scroll } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useResource } from "../lib/useApi";
import { EmptyState, ErrorBanner, PageHeader, Panel, RefreshButton, SkeletonCard } from "../components/ui";

const KIND_TONE: Record<string, string> = {
  "policy.decision": "chip-red",
  "receipt.created": "chip-green",
  "action.undone": "chip-amber",
  "kill_switch": "chip-red",
  "consent.updated": "chip-green",
  "session.reloaded": "chip-ink",
  "tier2.spend_recorded": "chip-ink",
  "tier2.spend_released": "chip-ink",
};

export default function AuditTrail() {
  const audit = useResource(() => api.audit(500), []);
  const [kind, setKind] = useState<string>("all");
  const [query, setQuery] = useState("");

  const refresh = () => audit.refresh();
  const events = audit.data ?? [];

  const kinds = useMemo(() => Array.from(new Set(events.map((e) => e.event))), [events]);

  const filtered = events.filter((e) => {
    if (kind !== "all" && e.event !== kind) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      e.event.toLowerCase().includes(q) ||
      JSON.stringify(e.details).toLowerCase().includes(q) ||
      e.ts.includes(q)
    );
  });

  return (
    <>
      <PageHeader
        title="Audit Trail"
        sub="Append-only session log — consent changes, engine verdicts, receipts and undos. Replayed, it reconstructs the whole session."
        actions={<RefreshButton onClick={refresh} />}
      />

      {audit.error ? <ErrorBanner message={audit.error} onRetry={refresh} /> : null}

      {audit.loading ? (
        <SkeletonCard lines={10} />
      ) : (
        <div className="grid gap-5">
          <Panel bodyClassName="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[220px] flex-1">
                <div className="relative">
                  <MagnifyingGlass
                    size={15}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search events, findings, receipt ids…"
                    className="w-full rounded-xl border border-line-strong bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-ink-faint"
                    aria-label="Search audit events"
                  />
                </div>
              </div>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                aria-label="Filter by event kind"
              >
                <option value="all">All events ({events.length})</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k} ({events.filter((e) => e.event === k).length})
                  </option>
                ))}
              </select>
            </div>
          </Panel>

          <Panel title={`${filtered.length} entries`} bodyClassName="p-3">
            {filtered.length === 0 ? (
              <EmptyState
                title="Nothing matches this filter"
                body="Clear the search box or switch the event-kind filter to see the full session log."
              />
            ) : (
              <ul className="divide-y divide-line">
                {filtered.map((e, i) => (
                  <li key={i} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="num text-[11px] text-ink-faint">{e.ts}</span>
                      <span className={`chip ${KIND_TONE[e.event] ?? "chip-ink"}`}>{e.event}</span>
                      <span className="num min-w-0 flex-1 text-[11px] leading-relaxed break-all text-ink-soft">
                        {Object.entries(e.details)
                          .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : String(v)}`)
                          .join(" · ")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <p className="flex items-center gap-2 px-1 text-[11px] text-ink-faint">
            <Scroll size={13} />
            Log format: one JSON line per event, timestamped UTC. The log is append-only by design —
            history is evidence.
          </p>
        </div>
      )}
    </>
  );
}
