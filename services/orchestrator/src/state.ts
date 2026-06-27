import {CHAIN, SERVICE_URLS, bytes11ToBic, bytes32ToText} from "@swift-cf/shared";
import {allWallets, classCfg, countryOf, deployments, getAssetClass, getPolicyData, read} from "./chain.js";
import {getMonitorStatus} from "./monitor.js";

const fetchJson = async <T>(url: string, fallback: T): Promise<T> => {
  try {
    const res = await fetch(url);
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
};

export const buildState = async () => {
  const [bindings, sanctions] = await Promise.all([
    fetchJson(`${SERVICE_URLS.registry}/bindings`, [] as {wallet: string}[]),
    fetchJson(`${SERVICE_URLS.screening}/list`, {listVersion: "", parties: [] as {wallet: string}[]})
  ]);
  const sanctioned = new Set(sanctions.parties.map((p) => p.wallet.toLowerCase()));

  const parties = await Promise.all(
    allWallets().map(async (w) => {
      const [claim, frozen, isHolder, bindingState] = await Promise.all([
        read.claimCache.getClaim(w.address),
        read.freezeRegistry.isFrozen(w.address),
        read.freezeRegistry.isHolder(classCfg().assetId, w.address),
        read.claimCache.binding(w.address)
      ]);
      return {
        role: w.role,
        ref: w.ref ?? w.role,
        name: w.name ?? w.bic ?? w.role,
        bic: w.bic,
        country: countryOf(w),
        category: w.category ?? (claim.exists ? bytes32ToText(claim.category) : null),
        kycValid: claim.exists && !claim.revoked,
        sanctioned: sanctioned.has(w.address.toLowerCase()),
        frozen,
        binding: {
          revoked: bindingState.revoked,
          epoch: Number(bindingState.bindingEpoch),
          reason: bindingState.revoked ? bytes32ToText(bindingState.reason) : null
        },
        holdings: w.holdings ?? "0",
        isHolder,
        lockupEnd: null as string | null,
        claim: {
          exists: claim.exists,
          revoked: claim.revoked,
          bic: claim.exists ? bytes11ToBic(claim.bic) : null,
          validUntil: Number(claim.validUntil),
          listEpoch: Number(claim.listEpoch),
          registryEpoch: Number(claim.registryEpoch),
          revocationReason: claim.revoked ? bytes32ToText(claim.revocationReason) : null
        }
      };
    })
  );

  const [holderCount, listEpoch, registryEpoch] = await Promise.all([
    read.freezeRegistry.holderCount(classCfg().assetId),
    read.listRegistry.listEpoch(),
    read.listRegistry.registryEpoch()
  ]);

  return {
    chain: CHAIN,
    addresses: deployments,
    assetClass: getAssetClass(),
    policy: getPolicyData(getAssetClass()),
    parties,
    bindings,
    sanctions,
    holderCount: Number(holderCount),
    epoch: {list: Number(listEpoch), registry: Number(registryEpoch)},
    monitor: getMonitorStatus()
  };
};
