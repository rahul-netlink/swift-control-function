import {MaxUint256, id, parseEther} from "ethers";
import {categoryToBytes32, jurisdictionToBytes32} from "@swift-cf/shared";
import {asAdmin, classCfg, getAssetClass, getPolicyData, setPolicyOverride} from "./chain.js";
import {hub} from "./feeds.js";

const RULE_BIT = {
  KYC: 1 << 0,
  SANCTIONS: 1 << 1,
  JURISDICTION: 1 << 2,
  LOCKUP: 1 << 3,
  HOLDER_CAP: 1 << 4,
  FREEZE: 1 << 5,
  TRANSFER_LIMIT: 1 << 6,
  VELOCITY: 1 << 7,
  COUNTERPARTY: 1 << 8
} as const;

const RULE_CATALOG: {id: string; bit: number; label: string; check: string; denyReasonCode: string}[] = [
  {id: "freeze", bit: RULE_BIT.FREEZE, label: "Freeze", check: "neither party nor holding frozen", denyReasonCode: "FRZ06"},
  {id: "kyc", bit: RULE_BIT.KYC, label: "KYC", check: "wallet->BIC binding present and KYC claim valid", denyReasonCode: "BLCK01"},
  {id: "sanctions", bit: RULE_BIT.SANCTIONS, label: "Sanctions", check: "screening attestation clear and fresh", denyReasonCode: "AML02"},
  {id: "jurisdiction", bit: RULE_BIT.JURISDICTION, label: "Jurisdiction", check: "destination matches the jurisdiction matrix", denyReasonCode: "JUR03"},
  {id: "counterparty", bit: RULE_BIT.COUNTERPARTY, label: "Counterparty class", check: "recipient category permitted in the category matrix", denyReasonCode: "CTP12"},
  {id: "lockup", bit: RULE_BIT.LOCKUP, label: "Lock-up", check: "now >= lockupEnd", denyReasonCode: "LCK04"},
  {id: "holderCap", bit: RULE_BIT.HOLDER_CAP, label: "Holder cap", check: "holders < maxHolders or already a holder", denyReasonCode: "CAP05"},
  {id: "transferLimit", bit: RULE_BIT.TRANSFER_LIMIT, label: "Tiered limit", check: "amount resolved against the notional bands", denyReasonCode: "LIM07"},
  {id: "velocity", bit: RULE_BIT.VELOCITY, label: "Velocity", check: "rolling-window cumulative cap per party", denyReasonCode: "VEL11"}
];
const EDD_RULE = {id: "edd", label: "EDD gate", check: "enhanced approval present when policy demands review", reviewReasonCode: "EDD10"};

export const ruleCatalog = () => ({rules: RULE_CATALOG, gate: EDD_RULE});

const ACTION_CODE: Record<string, number> = {DENY: 0, ALLOW: 1, REVIEW: 2};

export interface PolicyBandSpec {
  upTo: string | null;
  action: "ALLOW" | "REVIEW" | "DENY";
  label?: string;
}
export interface PolicyConditionSpec {
  code: string;
  allowed: boolean;
  maxAmount: string | null;
  requireEdd: boolean;
  note?: string;
}
export interface PolicyVelocitySpec {
  window: number;
  windowLabel?: string;
  cap: string;
}
export interface PublishPolicySpec {
  version: string;
  activeRules: string[];
  maxHolders: number;
  lockupEnd: string | null;
  bands: PolicyBandSpec[];
  jurisdictions: PolicyConditionSpec[];
  categories: PolicyConditionSpec[];
  velocity: PolicyVelocitySpec | null;
}

const wei = (whole: string | null | undefined): bigint =>
  whole && Number(whole) > 0 ? parseEther(String(whole)) : 0n;
const isoToUnix = (iso: string | null): number =>
  iso ? Math.floor(new Date(iso).getTime() / 1000) : 0;

export const publishPolicy = async (
  spec: PublishPolicySpec
): Promise<{ok: boolean; version: string; policyId: string; ruleMask: number; gasUsed: number; txHash: string}> => {
  const cls = getAssetClass();
  const cfg = classCfg();
  const policyId = cfg.policyId;

  const active = new Set(spec.activeRules);
  const ruleMask = RULE_CATALOG.reduce((m, r) => (active.has(r.id) ? m | r.bit : m), 0);

  const velocityWindow = active.has("velocity") && spec.velocity ? spec.velocity.window : 0;
  const velocityCap = active.has("velocity") && spec.velocity ? wei(spec.velocity.cap) : 0n;

  let gasUsed = 0;
  const upsert = await asAdmin.ruleRegistry.upsertPolicy(
    policyId,
    id(spec.version),
    isoToUnix(spec.lockupEnd),
    Math.max(0, Math.floor(spec.maxHolders)),
    ruleMask,
    velocityWindow,
    velocityCap
  );
  const upsertReceipt = await upsert.wait();
  gasUsed += Number(upsertReceipt.gasUsed);
  const txHash = upsertReceipt.hash;

  const thresholds = spec.bands.map((b) => (b.upTo == null || b.upTo === "" ? MaxUint256 : parseEther(String(b.upTo))));
  const actions = spec.bands.map((b) => ACTION_CODE[b.action] ?? 0);
  if (thresholds.length > 0) {
    const tx = await asAdmin.ruleRegistry.setBands(policyId, thresholds, actions);
    gasUsed += Number((await tx.wait()).gasUsed);
  }

  const matrixTxs = [];
  for (const j of spec.jurisdictions) {
    matrixTxs.push(
      await asAdmin.ruleRegistry.setJurisdictionRule(
        policyId,
        jurisdictionToBytes32(j.code),
        j.allowed,
        wei(j.maxAmount),
        j.requireEdd
      )
    );
  }
  for (const c of spec.categories) {
    matrixTxs.push(
      await asAdmin.ruleRegistry.setCategoryRule(
        policyId,
        categoryToBytes32(c.code),
        c.allowed,
        wei(c.maxAmount),
        c.requireEdd
      )
    );
  }
  const matrixReceipts = await Promise.all(matrixTxs.map((tx) => tx.wait()));
  gasUsed += matrixReceipts.reduce((sum, r) => sum + Number(r.gasUsed), 0);

  const base = getPolicyData(cls);
  const rules = [...RULE_CATALOG.filter((r) => active.has(r.id)).map((r) => ({
    id: r.id,
    label: r.label,
    check: r.check,
    denyReasonCode: r.denyReasonCode
  })), {...EDD_RULE}];
  const normalized = {
    ...base,
    version: spec.version,
    rules,
    bands: spec.bands,
    jurisdictions: spec.jurisdictions,
    categories: spec.categories,
    velocity: spec.velocity,
    maxHolders: Math.max(0, Math.floor(spec.maxHolders)),
    lockupEnd: spec.lockupEnd,
    allowedCountries: spec.jurisdictions.filter((j) => j.allowed).map((j) => j.code)
  };
  setPolicyOverride(cls, normalized);

  hub.emit(
    "POLICY_PUBLISHED",
    `Policy ${spec.version} published to the rule registry. ${rules.length - 1} active rules, ${spec.bands.length} bands (gas ${gasUsed.toLocaleString()}). Effective for the next decision.`,
    {assetClass: cls, version: spec.version, ruleMask, gasUsed}
  );

  return {ok: true, version: spec.version, policyId, ruleMask, gasUsed, txHash};
};
