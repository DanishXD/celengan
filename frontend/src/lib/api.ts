/** Typed API client for Celengan.
 *
 * LIVE mode (default): requests go through the Vite `/api` proxy in dev and
 * at `VITE_API_BASE` in deployments — the FastAPI backend is the source of
 * truth.
 *
 * STATIC demo mode (VITE_STATIC_DEMO=1, used by the GitHub Pages preview):
 * the whole session — Policy Engine, drafts, undos, audit — runs client-side
 * in `src/lib/demo/`, backed by the frozen engine snapshot in
 * `public/demo-data/`. Response shapes are identical in both modes; CI runs
 * a parity test proving the port matches the Python engine exactly.
 */

import { ApiError } from "./ApiError";
import { makeStaticApi } from "./demo/staticApi";
import type { CelenganApi } from "./apiTypes";

export const DEMO_MODE = import.meta.env.VITE_STATIC_DEMO === "1";

/* ------------------------------------------------------------------ live */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers: extraHeaders, ...rest } = init ?? {};
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body === "string" ? body : (body.detail ?? JSON.stringify(body));
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, String(detail));
  }
  const contentType = res.headers.get("content-type") ?? "";
  return (contentType.includes("json") ? await res.json() : await res.text()) as T;
}

const liveApi: CelenganApi = {
  health: () => request("/health"),

  sandbox: () => request("/sandbox"),
  reloadSandbox: () => request("/sandbox/reload", { method: "POST" }),
  transactions: () => request("/transactions"),

  leaks: () => request("/leaks"),

  forecast: (days = 40) => request(`/forecast?days=${days}`),
  whatIf: (exclude: string[], credits: number[], days = 40) =>
    request(
      `/forecast/what-if?exclude=${encodeURIComponent(exclude.join(","))}` +
        `&credits=${credits.map(String).join(",")}&days=${days}`,
    ),

  plays: () => request("/actions/plays"),
  requestAction: (body) => request("/actions/request", { method: "POST", json: body }),
  undo: (receipt_id: string) =>
    request("/actions/undo", { method: "POST", json: { receipt_id } }),
  killSwitch: (enabled: boolean) =>
    request("/actions/kill-switch", { method: "POST", json: { enabled } }),

  consent: () => request("/consent"),
  setConsent: (enabled: boolean) =>
    request("/consent", { method: "POST", json: { enabled } }),

  receipts: () => request("/receipts"),

  audit: (limit = 200) => request(`/audit?limit=${limit}`),
};

/* ---------------------------------------------------------------- expose */

export const api: CelenganApi = DEMO_MODE ? makeStaticApi() : liveApi;

export { ApiError } from "./ApiError";
export * from "./apiTypes";
