import type { ReactNode } from "react";
import { Warning, ArrowClockwise, ArrowsClockwise } from "@phosphor-icons/react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastPoint } from "../lib/api";
import { fmtDay, signedMoney, moneyCompact } from "../lib/format";

/* ------------------------------------------------------------------ layout */

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight lg:text-3xl">{title}</h1>
        {sub ? <p className="mt-1 max-w-[62ch] text-sm text-ink-soft">{sub}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  sub,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  sub?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel fade-up ${className ?? ""}`}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
            {sub ? <p className="mt-0.5 text-xs text-ink-soft">{sub}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={bodyClassName ?? "p-5"}>{children}</div>
    </section>
  );
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <button className="btn btn-outline btn-sm" onClick={onClick} disabled={busy}>
      <ArrowsClockwise size={14} className={busy ? "animate-spin" : undefined} />
      Refresh
    </button>
  );
}

/* ------------------------------------------------------------------- atoms */

export function StatTile({
  label,
  value,
  sub,
  tone = "ink",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ink" | "ok" | "alert" | "coin";
  icon?: ReactNode;
}) {
  const toneCls =
    tone === "ok"
      ? "text-ok"
      : tone === "alert"
        ? "text-alert"
        : tone === "coin"
          ? "text-coin"
          : "text-ink";
  return (
    <div className="panel fade-up p-5">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
        {icon}
        {label}
      </div>
      <div className={`num mt-2 text-[26px] font-bold leading-none ${toneCls}`}>{value}</div>
      {sub ? <p className="mt-2 text-xs leading-snug text-ink-soft">{sub}</p> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  tone = "piggy",
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  tone?: "piggy" | "alert";
  ariaLabel: string;
}) {
  const onBg = tone === "alert" ? "bg-alert" : "bg-piggy";
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-45 ${
        checked ? onBg : "bg-line-strong"
      }`}
    >
      <span
        className={`toggle-knob absolute top-1 h-5 w-5 rounded-full bg-surface shadow-[0_1px_3px_rgba(24,36,29,0.3)] transition-all ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

export function Progress({
  value,
  max,
  tone = "piggy",
}: {
  value: number;
  max: number;
  tone?: "piggy" | "alert";
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const bar = pct > 80 && tone !== "alert" ? "bg-alert" : tone === "alert" ? "bg-alert" : "bg-piggy";
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-surface-warm"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={`panel ${className ?? ""}`}>
      <div className="space-y-3 p-5">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="skeleton"
            style={{ height: i === 0 ? 24 : 14, width: i === 0 ? "45%" : "100%" }}
          />
        ))}
      </div>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-alert/40 bg-alert-soft px-4 py-3 text-sm text-alert-strong">
      <Warning size={18} weight="fill" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Could not reach the Celengan engine</p>
        <p className="mt-0.5 break-words text-xs opacity-90">{message}</p>
        {onRetry ? (
          <button className="btn btn-outline btn-sm mt-2" onClick={onRetry}>
            <ArrowClockwise size={13} />
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid place-items-center px-6 py-12 text-center">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mx-auto mt-1 max-w-[48ch] text-xs text-ink-soft">{body}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- forecast viz */

interface ChartDatum extends ForecastPoint {
  baseline: number;
  current: number;
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="font-mono text-[11px] font-semibold text-ink-soft">{fmtDay(row.date)}</div>
      <div className="num mt-1 font-bold text-piggy">{signedMoney(row.current)}</div>
      <div className="num text-[11px] text-ink-faint">baseline {signedMoney(row.baseline)}</div>
    </div>
  );
}

export function ForecastChart({
  baseline,
  current,
  doom,
  height = 300,
}: {
  baseline: ForecastPoint[];
  current: ForecastPoint[];
  /** {x, y} of the baseline doom-day point, or null when cleared */
  doom: { x: number; y: number } | null;
  height?: number;
}) {
  const data: ChartDatum[] = baseline.map((p, i) => ({
    ...p,
    baseline: p.balance,
    current: current[i]?.balance ?? p.balance,
  }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id="piggyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-piggy)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-piggy)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day_offset"
            type="number"
            ticks={[1, 10, 20, 30, 40]}
            tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }}
            axisLine={{ stroke: "var(--color-line)" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => moneyCompact(v)}
            tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          {!doom || doom.y >= 0 ? null : (
            <ReferenceLine
              y={0}
              stroke="var(--color-alert)"
              strokeDasharray="5 5"
              strokeOpacity={0.6}
            />
          )}
          <Area
            type="monotone"
            dataKey="current"
            stroke="var(--color-piggy)"
            strokeWidth={2.4}
            fill="url(#piggyFill)"
            dot={false}
            name="current"
          />
          <Line
            type="monotone"
            dataKey="baseline"
            stroke="var(--color-ink-faint)"
            strokeWidth={1.6}
            strokeDasharray="4 5"
            dot={false}
            name="baseline"
          />
          {doom ? (
            <ReferenceDot
              x={doom.x}
              y={doom.y}
              r={5.5}
              fill="var(--color-alert)"
              stroke="var(--color-surface)"
              strokeWidth={2}
              label={{
                value: "Doom day",
                position: "top",
                fill: "var(--color-alert)",
                fontSize: 10.5,
                fontWeight: 700,
              }}
            />
          ) : null}
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--color-line-strong)" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function findDoomPoint(f: { doom_day: string | null; points: ForecastPoint[] }) {
  const hit = f.doom_day ? f.points.find((p) => p.date === f.doom_day) : undefined;
  return hit ? { x: hit.day_offset, y: hit.balance } : null;
}

/* ------------------------------------------------------------------ labels */

export function ReceiptStatusChip({ status }: { status: string }) {
  if (status === "draft_ready") return <span className="chip chip-amber">Draft ready · send</span>;
  if (status === "autopilot_active") return <span className="chip chip-green-on">Autopilot active</span>;
  if (status === "undone") return <span className="chip chip-ink">Undone</span>;
  return <span className="chip chip-ink">{status}</span>;
}
