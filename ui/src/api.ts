import type { AssetClass, DemoState, PublishPolicySpec, TransferInput, TransferResult } from "./types";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  baseUrl: BASE_URL,

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean };
      return body.ok === true;
    } catch {
      return false;
    }
  },

  state(): Promise<DemoState> {
    return request<DemoState>("/api/state");
  },
  reset(): Promise<{ ok?: boolean }> {
    return request("/api/reset", { method: "POST" });
  },

  transfer(input: TransferInput): Promise<TransferResult> {
    return request<TransferResult>("/api/transfer", { method: "POST", body: JSON.stringify(input) });
  },

  setAssetClass(assetClass: AssetClass): Promise<{ ok: boolean; assetClass: string }> {
    return request("/api/asset", { method: "POST", body: JSON.stringify({ assetClass }) });
  },

  freezeParty(role: string): Promise<{ ok: true; role: string; frozen: true }> {
    return request("/api/party/freeze", { method: "POST", body: JSON.stringify({ role }) });
  },
  unfreezeParty(role: string): Promise<{ ok: true; role: string; frozen: false }> {
    return request("/api/party/unfreeze", { method: "POST", body: JSON.stringify({ role }) });
  },
  sanctionParty(role: string): Promise<{ ok: true; role: string; sanctioned: true; listEpoch: number }> {
    return request("/api/party/sanction", { method: "POST", body: JSON.stringify({ role }) });
  },
  delistParty(role: string): Promise<{ ok: true; role: string; sanctioned: false; listEpoch: number }> {
    return request("/api/party/delist", { method: "POST", body: JSON.stringify({ role }) });
  },

  offboardParty(role: string): Promise<{ ok: true; role: string; bindingRevoked: true }> {
    return request("/api/party/offboard", { method: "POST", body: JSON.stringify({ role }) });
  },
  rebindParty(role: string): Promise<{ ok: true; role: string; bindingEpoch: number }> {
    return request("/api/party/rebind", { method: "POST", body: JSON.stringify({ role }) });
  },

  publishPolicy(spec: PublishPolicySpec): Promise<{ ok: boolean; version: string; ruleMask: number; gasUsed: number; txHash: string }> {
    return request("/api/policy/publish", { method: "POST", body: JSON.stringify(spec) });
  },

  eventsUrl(): string {
    return `${BASE_URL}/api/events`;
  },
};
