import EventSource from "eventsource";
import {
  EventHub,
  SERVICE_URLS,
  bytes11ToBic,
  bytes32ToText,
  provider,
  reasonToBytes32,
  type ServiceEvent
} from "@swift-cf/shared";
import {asOrchestrator, read} from "./chain.js";

export const hub = new EventHub("orchestrator");

export const revokeClaim = async (wallet: string, reasonCode: string): Promise<boolean> => {
  const claim = await read.claimCache.getClaim(wallet);
  if (!claim.exists || claim.revoked) return false;
  const tx = await asOrchestrator.claimCache.revokeClaim(wallet, reasonToBytes32(reasonCode));
  await tx.wait();
  return true;
};

const subscribe = (url: string, onEvent: (e: ServiceEvent) => void) => {
  const es = new EventSource(url);
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as ServiceEvent);
    } catch {
    }
  };
  es.onerror = () => {
  };
  return es;
};

export const startFeeds = (): void => {
  subscribe(`${SERVICE_URLS.screening}/events`, async (e) => {
    hub.relay(e);
    if (e.type === "LIST_UPDATED") {
      const party = e.data as {wallet: string; name?: string} | undefined;
      if (party?.wallet && (await revokeClaim(party.wallet, "AML02"))) {
        hub.emit("CLAIM_REVOKED", `Standing claim revoked for ${party.name ?? party.wallet} (AML02)`);
      }
    }
  });

  subscribe(`${SERVICE_URLS.registry}/events`, async (e) => {
    hub.relay(e);
    if (e.type === "KYC_WITHDRAWN") {
      const party = e.data as {wallet: string} | undefined;
      if (party?.wallet && (await revokeClaim(party.wallet, "BLCK01"))) {
        hub.emit("CLAIM_REVOKED", `Standing claim revoked for ${party.wallet} (BLCK01)`);
      }
    }
  });

  subscribe(`${SERVICE_URLS.signer}/events`, (e) => hub.relay(e));

  provider.pollingInterval = 500;

  read.claimCache.on("ClaimPublished", (wallet: string, bic: string, validUntil: bigint) =>
    hub.relay({ts: Date.now(), source: "chain", type: "ClaimPublished", message: `Standing claim published for ${bytes11ToBic(bic)} (${wallet})`})
  );
  read.claimCache.on("ClaimRevoked", (wallet: string, reason: string) =>
    hub.relay({ts: Date.now(), source: "chain", type: "ClaimRevoked", message: `Claim revoked: ${wallet} (${bytes32ToText(reason)})`})
  );
  read.freezeRegistry.on("FreezeApplied", (target: string) =>
    hub.relay({ts: Date.now(), source: "chain", type: "FreezeApplied", message: `Freeze applied to ${target}`})
  );
  read.freezeRegistry.on("FreezeReleased", (target: string) =>
    hub.relay({ts: Date.now(), source: "chain", type: "FreezeReleased", message: `Freeze released for ${target}`})
  );
  read.controlFunction.on(
    "ControlDecisionLogged",
    (_assetId: string, _op: string, allowed: boolean, reasonCode: string) =>
      hub.relay({ts: Date.now(), source: "chain", type: "ControlDecisionLogged", message: `Decision logged: ${allowed ? "ALLOW" : "DENY"} ${bytes32ToText(reasonCode)}`})
  );
};
