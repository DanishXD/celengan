/** Formatting helpers — money, dates, and human labels. */

export function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function signedMoney(n: number): string {
  const sign = n < 0 ? "−" : n > 0 ? "+" : "";
  return `${sign}${money(Math.abs(n))}`;
}

export function moneyCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100_000) return `${n < 0 ? "−" : ""}$${(abs / 1000).toFixed(0)}k`;
  return `$${Math.round(abs).toLocaleString("en-US")}`;
}

export function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(`${iso}T00:00:00`),
  );
}

export function fmtClock(iso: string): string {
  const t = iso.replace("T", " ").replace(/:\d\d$/, "");
  return t;
}

export function daysUntil(iso: string, from = Date.now()): number {
  const target = new Date(`${iso}T00:00:00`).getTime();
  return Math.ceil((target - from) / 86_400_000);
}

export const LEAK_TYPE_LABEL: Record<string, string> = {
  subscription_creep: "Dark subscription",
  duplicate_charge: "Duplicate charge",
  hidden_fee: "Hidden fee",
  silent_price_hike: "Silent price hike",
};

export const PLAYBOOK_LABEL: Record<string, string> = {
  cancel_subscription: "Cancel by autopilot",
  dispute_duplicate: "Bank dispute",
  claim_fee_refund: "Fee waiver",
  renegotiate_hike: "Renegotiate",
};

export const LEAK_TYPE_ICON: Record<string, string> = {
  subscription_creep: "MoonStars",
  duplicate_charge: "CopySimple",
  hidden_fee: "Receipt",
  silent_price_hike: "ArrowUpRight",
};
