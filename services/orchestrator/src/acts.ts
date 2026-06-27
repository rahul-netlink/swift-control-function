import {encodeBytes32String, id, keccak256, parseEther} from "ethers";
import {
  OUTCOME,
  SERVICE_URLS,
  bytes32ToText,
  canonicalRequestHash,
  categoryToBytes32,
  jurisdictionToBytes32,
  reasonText,
  type Decision,
  type ControlRequest
} from "@swift-cf/shared";
import {
  MaxUint256,
  allWallets,
  asAdmin,
  asOperator,
  asOrchestrator,
  asWallet,
  attestationDraft,
  bicToBytes11,
  buildRequest,
  classCfg,
  clearPolicyOverride,
  coldEvidence,
  countryOf,
  currentEpochs,
  deployments,
  getAssetClass,
  getPolicyData,
  setAssetClass,
  type AssetClass,
  institutionOf,
  read,
  reqTuple,
  walletOf,
  type SignedAttestation
} from "./chain.js";
import {emitPacs002, type IsoResult} from "./iso.js";
import {hub, revokeClaim} from "./feeds.js";

interface PolicyBand {
  upTo: string | null;
  action: "ALLOW" | "REVIEW" | "DENY";
  label?: string;
}
interface PolicyCondition {
  code: string;
  allowed: boolean;
  maxAmount: string | null;
  requireEdd: boolean;
  note?: string;
}
interface PolicyVelocity {
  window: number;
  windowLabel?: string;
  cap: string;
}
interface PolicyShape {
  maxHolders: number;
  allowedCountries: string[];
  lockupEnd: string | null;
  assetName?: string;
  rules?: {id: string}[];
  bands?: PolicyBand[];
  jurisdictions?: PolicyCondition[];
  categories?: PolicyCondition[];
  velocity?: PolicyVelocity;
}
const activePolicy = (): PolicyShape => getPolicyData(getAssetClass()) as unknown as PolicyShape;
const activeRuleIds = (p: PolicyShape): Set<string> => new Set((p.rules ?? []).map((r) => r.id));

const VALID_FOR = 365 * 24 * 3600;
const now = () => Math.floor(Date.now() / 1000);
let seeded = false;

const toDecision = (raw: {outcome: bigint | number; allowed: boolean; reasonCode: string; validUntil: bigint}): Decision => {
  const code = bytes32ToText(raw.reasonCode);
  return {
    outcome: OUTCOME[Number(raw.outcome)],
    allowed: raw.allowed,
    reasonCode: code,
    reasonText: reasonText(code),
    validUntil: Number(raw.validUntil)
  };
};

const decisionGas = async (req: ControlRequest, evidence: string): Promise<number> =>
  Number(await read.controlFunction.evaluateAndConsume.estimateGas(reqTuple(req), evidence));

const REPRESENTATIONS = [
  {key: "erc20", label: "ERC-20 · fungible token", kind: "token", adapter: "erc20Adapter"},
  {key: "erc3643", label: "ERC-3643 · permissioned security token", kind: "token", adapter: "permAdapter"},
  {key: "ledger", label: "Book-entry ledger · non-token", kind: "ledger", adapter: "externalLedgerAdapter"}
] as const;

export interface AgnosticRepresentation {
  key: string;
  label: string;
  kind: "token" | "ledger";
  decision: Decision;
}
export interface Agnosticism {
  representations: AgnosticRepresentation[];
  identical: boolean;
}

const RAIL_ROUTE: Record<Asset, string> = {
  erc20: "Ethereum (ERC-20)",
  erc3643: "Ethereum (ERC-3643)",
  ledger: "External book-entry ledger (off-EVM)"
};
const RAIL_LABEL: Record<Asset, string> = {
  erc20: "ERC-20 fungible token",
  erc3643: "ERC-3643 security token",
  ledger: "Book-entry ledger (non-token)"
};

const screenRepresentations = async (req: ControlRequest, evidence: string): Promise<Agnosticism> => {
  const representations = await Promise.all(
    REPRESENTATIONS.map(async (r) => ({
      key: r.key,
      label: r.label,
      kind: r.kind,
      decision: toDecision(await read[r.adapter].screen(reqTuple(req), evidence))
    }))
  );
  const first = representations[0].decision;
  const identical = representations.every((r) => r.decision.allowed === first.allowed && r.decision.reasonCode === first.reasonCode);
  return {representations, identical};
};

const executeTransfer = async (fromRole: string, toRole: string, tokens: string, evidence: string) => {
  const c = asWallet(fromRole);
  const adapter = c[classCfg().adapterKey];
  const tx = await adapter.transfer(walletOf(toRole).address, parseEther(tokens), evidence);
  const receipt = await tx.wait();
  return {gasUsed: Number(receipt!.gasUsed), txHash: receipt!.hash};
};

const projectToLedger = async (req: ControlRequest, evidence: string) => {
  const tx = await asOrchestrator.controlFunction.evaluateAndConsume(reqTuple(req), evidence);
  const receipt = await tx.wait();
  return {gasUsed: Number(receipt!.gasUsed), txHash: receipt!.hash};
};

const publishStandingClaim = async (role: string, force: boolean): Promise<void> => {
  const w = walletOf(role);
  if (!w.bic) return;
  const claim = await read.claimCache.getClaim(w.address);
  const standing = claim.exists && !claim.revoked;
  if (standing && !force) return;
  const inst = institutionOf(w);
  const epochs = await currentEpochs();
  await (await asOrchestrator.claimCache.publishClaim(
    w.address,
    bicToBytes11(w.bic),
    id(inst?.registryRef ?? w.bic),
    now() + VALID_FOR,
    epochs.list,
    epochs.registry,
    categoryToBytes32(w.category ?? "BANK")
  )).wait();
};

const registerBinding = async (role: string): Promise<void> => {
  const w = walletOf(role);
  if (!w.bic) return;
  const inst = institutionOf(w);
  await fetch(`${SERVICE_URLS.registry}/binding`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      wallet: w.address,
      bic: w.bic,
      registryRef: inst?.registryRef ?? w.bic,
      validUntil: now() + VALID_FOR
    })
  }).catch(() => undefined);
};

export class SignerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SignerError";
  }
}

const callSigner = async (req: ControlRequest, ttlSeconds = 3600, edd = false): Promise<SignedAttestation> => {
  const epochs = await currentEpochs();
  const res = await fetch(`${SERVICE_URLS.signer}/attest`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({attestation: await attestationDraft(req, epochs.list, edd), ttlSeconds})
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as {error?: string; reason?: string} | null;
    const reason = detail?.error ?? detail?.reason ?? res.statusText;
    throw new SignerError(res.status === 409 ? "quorum not met" : `signer error (${res.status}): ${reason}`, res.status);
  }
  const body = (await res.json()) as SignedAttestation & {attestation: {nonce: string}};
  return {...body, attestation: {...body.attestation, nonce: BigInt(body.attestation.nonce)}};
};

const setJurisdictionAll = async (address: string, jur: string): Promise<void> => {
  await (await asAdmin.erc20Adapter.setJurisdiction(address, jur)).wait();
  await (await asAdmin.permAdapter.setJurisdiction(address, jur)).wait();
  await (await asAdmin.externalLedgerAdapter.setJurisdiction(address, jur)).wait();
  await (await asAdmin.depositAdapter.setJurisdiction(address, jur)).wait();
  await (await asAdmin.equityAdapter.setJurisdiction(address, jur)).wait();
  await (await asAdmin.fundAdapter.setJurisdiction(address, jur)).wait();
};

export const ensureSeed = async (force = false): Promise<void> => {
  if (!seeded || force) {
    for (const w of allWallets()) {
      const jur = jurisdictionToBytes32(countryOf(w));
      await setJurisdictionAll(w.address, jur);
      await (await asAdmin.erc20.mint(w.address, parseEther("1000000000"))).wait();
      await (await asWallet(w.role).erc20.approve(deployments.erc20Adapter, MaxUint256)).wait();
      await (await asAdmin.depositErc20.mint(w.address, parseEther("1000000000"))).wait();
      await (await asWallet(w.role).depositErc20.approve(deployments.depositAdapter, MaxUint256)).wait();
      await (await asAdmin.equityErc20.mint(w.address, parseEther("1000000000"))).wait();
      await (await asWallet(w.role).equityErc20.approve(deployments.equityAdapter, MaxUint256)).wait();
      await (await asAdmin.fundErc20.mint(w.address, parseEther("1000000000"))).wait();
      await (await asWallet(w.role).fundErc20.approve(deployments.fundAdapter, MaxUint256)).wait();
      if (w.bic) {
        await registerBinding(w.role);
        await publishStandingClaim(w.role, true);
      }
    }
    for (const assetId of [deployments.assetId, deployments.equityAssetId, deployments.fundAssetId]) {
      for (const role of ["debtco", "fundmgr", "luxclear"]) {
        await (await asOperator.freezeRegistry.registerHolder(assetId, walletOf(role).address)).wait();
      }
    }
    seeded = true;
  }
};

export type Asset = "erc20" | "erc3643" | "ledger";
export type PathChoice = "auto" | "cold" | "hot";
export type EvidenceMode = "normal" | "expired" | "replay";
export type StepStatus = "pass" | "fail" | "skip" | "review";
export type Tier = "OFFCHAIN" | "ONCHAIN" | "HYBRID";

export interface TraceStep {
  key: string;
  label: string;
  detail: string;
  tier: Tier;
  status: StepStatus;
  reasonCode?: string;
}

export interface TransferInput {
  from: string;
  to: string;
  amount: string;
  asset: Asset;
  assetClass?: AssetClass;
  path: PathChoice;
  evidence?: EvidenceMode;
  edd?: boolean;
}

export interface TransferResult {
  decisionId: string;
  status: "PERMITTED" | "BLOCKED" | "REVIEW";
  decision: Decision;
  request: {fromRef: string; toRef: string; fromName: string; toName: string; amount: string; asset: Asset; assetClass: AssetClass};
  route: string;
  path: {basis: "COLD" | "HOT"; scope: "OPERATION_BOUND" | "PARTY_STANDING"; asset: Asset; label: string};
  gas: {control: number; settlement: number; total: number};
  agnosticism: Agnosticism;
  trace: TraceStep[];
  iso20022: IsoResult;
  txHash: string | null;
  settled: boolean;
  hashes: {request: string; evidence: string | null; attestation: string | null};
  freshness: {clearanceEpoch: number; listFloor: number};
  validUntil: number;
  quorum: {acks: {id: string; approved: boolean}[]; signer: string} | null;
}

const REF = (role: string) => walletOf(role).ref ?? role;
const NAME = (role: string) => walletOf(role).name ?? walletOf(role).bic ?? role;

const hasStanding = async (role: string): Promise<boolean> => {
  const c = await read.claimCache.getClaim(walletOf(role).address);
  return c.exists && !c.revoked && Number(c.validUntil) > now();
};
const claimRevoked = async (role: string): Promise<boolean> => {
  const c = await read.claimCache.getClaim(walletOf(role).address);
  return c.exists && c.revoked;
};
const hasBinding = (role: string): boolean => Boolean(walletOf(role).bic);

const postScreen = async (from: string, to: string): Promise<"hit" | "clear"> => {
  const res = await fetch(`${SERVICE_URLS.screening}/screen`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({from, to})
  });
  if (!res.ok) throw new Error(`screening service ${res.status}`);
  return ((await res.json()) as {result: "hit" | "clear"}).result;
};

const screenPair = async (from: string, to: string): Promise<"hit" | "clear" | "error"> => {
  try {
    return await postScreen(walletOf(from).address, walletOf(to).address);
  } catch {
    return "error";
  }
};

const coldEligible = async (from: string, to: string): Promise<boolean> => {
  if (!hasBinding(from) || !hasBinding(to)) return false;
  if ((await screenPair(from, to)) !== "clear") return false;
  if ((await claimRevoked(from)) || (await claimRevoked(to))) return false;
  return true;
};

const resolveBasis = async (input: TransferInput): Promise<"cold" | "hot"> => {
  if (input.path === "hot") return "hot";
  if (input.path === "auto" && (await hasStanding(input.from)) && (await hasStanding(input.to))) return "hot";
  return (await coldEligible(input.from, input.to)) ? "cold" : "hot";
};

const decisionId = (requestHash: string): string => {
  const h = requestHash.slice(2);
  const a = parseInt(h.slice(0, 10), 16).toString(36).toUpperCase().padStart(8, "0").slice(0, 8);
  const b = parseInt(h.slice(10, 16), 16).toString(36).toUpperCase().padStart(4, "0").slice(0, 4);
  return `DEC-${a}-${b}`;
};

const RULE_ORDER = [
  {key: "freeze", reason: "FRZ06"},
  {key: "binding", reason: "BND13"},
  {key: "kyc", reason: "BLCK01"},
  {key: "sanctions", reason: "AML02"},
  {key: "jurisdiction", reason: "JUR03"},
  {key: "counterparty", reason: "CTP12"},
  {key: "lockup", reason: "LCK04"},
  {key: "holderCap", reason: "CAP05"},
  {key: "transferLimit", reason: "LIM07"},
  {key: "velocity", reason: "VEL11"},
  {key: "edd", reason: "EDD10"}
];

const REASON_TO_RULE: Record<string, string> = {
  LIM14: "jurisdiction",
  LIM15: "counterparty",
  LIM16: "transferLimit"
};

export const runTransfer = async (input: TransferInput): Promise<TransferResult> => {
  await ensureSeed();
  if (input.assetClass) setAssetClass(input.assetClass);
  const {from, to, amount, asset} = input;
  const evidenceMode: EvidenceMode = input.evidence ?? "normal";
  const req = buildRequest(from, to, amount);
  const requestHash = canonicalRequestHash(req);

  const wantEdd = Boolean(input.edd);
  let basis: "cold" | "hot" = evidenceMode !== "normal" || wantEdd ? "cold" : await resolveBasis(input);
  let evidence = "0x";
  let signed: SignedAttestation | null = null;
  let attestationBad: string | null = null;

  if (basis === "cold") {
    if (evidenceMode === "expired") {
      signed = await callSigner(req, -3600);
      evidence = coldEvidence(signed);
      attestationBad = "attestation expired (notAfter in the past)";
    } else if (evidenceMode === "replay") {
      signed = await callSigner(req);
      evidence = coldEvidence(signed);
      await (await asOrchestrator.controlFunction.evaluateAndConsume(reqTuple(req), evidence)).wait();
      attestationBad = "nonce already consumed (replay)";
    } else {
      signed = await callSigner(req, 3600, wantEdd);
      evidence = coldEvidence(signed);
    }
  }

  const agnosticism = await screenRepresentations(req, evidence);
  let decision = (agnosticism.representations.find((r) => r.key === asset) ?? agnosticism.representations[0]).decision;

  if (attestationBad && decision.allowed) {
    decision = {outcome: "DENY", allowed: false, reasonCode: "BLCK01", reasonText: reasonText("BLCK01"), validUntil: 0};
  }

  const controlGas = await decisionGas(req, evidence);
  let settlementGas = 0;
  let txHash: string | null = null;
  let settled = false;
  if (decision.allowed) {
    const exec = asset === "ledger" ? await projectToLedger(req, evidence) : await executeTransfer(from, to, amount, evidence);
    settlementGas = exec.gasUsed;
    txHash = exec.txHash;
    settled = true;
    if (activeRuleIds(activePolicy()).has("holderCap")) {
      await (await asOperator.freezeRegistry.registerHolder(classCfg().assetId, walletOf(to).address)).wait().catch(() => undefined);
    }
  }

  const {steps: trace, freshness} = await buildTrace({req, from, to, amount, asset, assetClass: getAssetClass(), basis, decision, evidenceMode, attestationBad, settlementGas, settled, eddPresented: wantEdd});

  const iso = emitPacs002({fromRole: from, toRole: to, tokens: amount, outcome: decision.outcome, reasonCode: decision.reasonCode});

  const status: TransferResult["status"] =
    decision.outcome === "ALLOW" ? "PERMITTED" : decision.outcome === "REVIEW" ? "REVIEW" : "BLOCKED";
  const scope: "OPERATION_BOUND" | "PARTY_STANDING" = basis === "cold" ? "OPERATION_BOUND" : "PARTY_STANDING";
  const route = RAIL_ROUTE[asset];
  const result: TransferResult = {
    decisionId: decisionId(requestHash),
    status,
    decision,
    request: {fromRef: REF(from), toRef: REF(to), fromName: NAME(from), toName: NAME(to), amount, asset, assetClass: getAssetClass()},
    route,
    path: {basis: scope === "OPERATION_BOUND" ? "COLD" : "HOT", scope, asset, label: `${getAssetClass().toUpperCase()} · ${basis.toUpperCase()} · ${scope}`},
    gas: {control: controlGas, settlement: settlementGas, total: settled ? settlementGas : controlGas},
    agnosticism,
    trace,
    iso20022: iso,
    txHash,
    settled,
    hashes: {request: requestHash, evidence: evidence === "0x" ? null : keccak256(evidence), attestation: signed ? signed.attestation.subject : null},
    freshness,
    validUntil: decision.validUntil,
    quorum: signed ? {acks: signed.acks, signer: signed.signer} : null
  };

  hub.emit(
    "TRANSFER",
    `Transfer ${REF(from)} to ${REF(to)}, ${amount}, ${basis.toUpperCase()}: ${status} ${decision.reasonCode}`,
    {decision}
  );
  return result;
};

interface TraceCtx {
  req: ControlRequest;
  from: string;
  to: string;
  amount: string;
  asset: Asset;
  assetClass: AssetClass;
  basis: "cold" | "hot";
  decision: Decision;
  evidenceMode: EvidenceMode;
  attestationBad: string | null;
  settlementGas: number;
  settled: boolean;
  eddPresented: boolean;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

interface TraceResult {
  steps: TraceStep[];
  freshness: {clearanceEpoch: number; listFloor: number};
}

const buildTrace = async (c: TraceCtx): Promise<TraceResult> => {
  const stale = c.decision.reasonCode === "STL08" || c.decision.reasonCode === "REG09";
  const isReview = c.decision.outcome === "REVIEW";
  const reason = c.decision.outcome === "ALLOW" ? null : c.decision.reasonCode;
  const blockerKey = reason
    ? REASON_TO_RULE[reason] ?? RULE_ORDER.find((r) => r.reason === reason)?.key
    : null;
  const blockerIdx = blockerKey ? RULE_ORDER.findIndex((r) => r.key === blockerKey) : Infinity;
  const ruleStatus = (key: string): StepStatus => {
    if (stale) return key === "freeze" ? "pass" : "skip";
    const i = RULE_ORDER.findIndex((r) => r.key === key);
    if (blockerIdx === Infinity) return "pass";
    if (i < blockerIdx) return "pass";
    if (i === blockerIdx) return key === "edd" && isReview ? "review" : "fail";
    return "skip";
  };

  const toW = walletOf(c.to);
  const fromW = walletOf(c.from);
  const amt = Number(c.amount);
  const toCountry = countryOf(toW);
  const toCategory = toW.category ?? "—";

  const p = activePolicy();
  const ACTIVE = activeRuleIds(p);
  const ALLOWED_COUNTRIES = new Set(p.allowedCountries);
  const bands = p.bands ?? [];
  const jurs = p.jurisdictions ?? [];
  const cats = p.categories ?? [];
  const velocity = p.velocity;

  const band = bands.find((b) => b.upTo == null || amt <= Number(b.upTo)) ?? bands[bands.length - 1];
  const jurRule = jurs.find((j) => j.code === toCountry);
  const catRule = cats.find((cc) => cc.code === toCategory);

  const [frozenFrom, holderCount, screen, listFloor, fromClaim, toClaim, fromBinding, toBinding] = await Promise.all([
    read.freezeRegistry.isFrozen(fromW.address),
    read.freezeRegistry.holderCount(c.req.assetId),
    screenPair(c.from, c.to),
    read.listRegistry.listEpoch(),
    read.claimCache.getClaim(fromW.address),
    read.claimCache.getClaim(toW.address),
    read.claimCache.binding(fromW.address),
    read.claimCache.binding(toW.address)
  ]);
  const deadBindingRef = fromBinding.revoked ? REF(c.from) : REF(c.to);
  const floorEpoch = Number(listFloor);
  const stampedEpoch = Math.min(Number(fromClaim.listEpoch ?? 0), Number(toClaim.listEpoch ?? 0));
  const MAX_HOLDERS = Number(p.maxHolders);

  let velSpent = 0;
  if (ACTIVE.has("velocity") && velocity) {
    const raw = await read.velocityRegistry.spent(c.req.assetId, fromW.address, velocity.window, now());
    velSpent = Number(raw) / 1e18;
  }

  const steps: TraceStep[] = [];
  const push = (s: TraceStep) => steps.push(s);

  push({key: "adapter", label: "Adapter ingest", detail: `${RAIL_LABEL[c.asset]} PEP → canonical ControlRequest`, tier: "HYBRID", status: "pass"});
  push({key: "cache", label: "Cache lookup", detail: c.basis === "hot" ? "HOT — cached standing claim resolved" : "COLD — no cached standing, attestation required", tier: "ONCHAIN", status: "pass"});
  push({
    key: "screen-off",
    label: "Off-chain sanctions screen",
    detail:
      screen === "clear"
        ? "No sanctions match on either party"
        : screen === "hit"
          ? "Screening hit on a counterparty"
          : "Screening service unavailable — treated as a potential match (fail closed)",
    tier: "OFFCHAIN",
    status: screen === "clear" ? "pass" : "fail"
  });
  push({key: "jur-off", label: "Off-chain jurisdiction pre-screen", detail: `${countryOf(fromW)} → ${toCountry} · allowed set {${[...ALLOWED_COUNTRIES].join(", ")}}`, tier: "OFFCHAIN", status: ALLOWED_COUNTRIES.has(toCountry) ? "pass" : "fail"});

  if (c.basis === "cold") {
    push({key: "sign", label: "Sign EIP-712", detail: c.eddPresented ? "SWIFT signer enhanced 3-of-3 EDD quorum → group signature" : "SWIFT signer 2-of-3 quorum → group signature", tier: "OFFCHAIN", status: "pass"});
    push({key: "verify", label: "Verify attestation", detail: c.attestationBad ?? `ecrecover ✓ · trusted issuer · in-window · subject bound${c.eddPresented ? " · EDD grant" : ""}`, tier: "ONCHAIN", status: c.attestationBad ? "fail" : "pass"});
  }

  push({
    key: "freshness",
    label: "Freshness (epoch floor)",
    detail: stale
      ? `Clearance epoch ${stampedEpoch} below on-chain list floor ${floorEpoch} — re-screen forced`
      : `Clearance epoch ${stampedEpoch || floorEpoch} ≥ on-chain list floor ${floorEpoch}`,
    tier: "ONCHAIN",
    status: stale ? "fail" : "pass",
    reasonCode: stale ? c.decision.reasonCode : undefined
  });
  push({
    key: "kyc",
    label: "KYC",
    detail: ruleStatus("kyc") === "fail" ? "No valid standing — wallet→BIC binding or attestation missing" : c.basis === "cold" ? "OPERATION_BOUND attestation vouches for both parties" : "Both parties hold a valid cached standing claim",
    tier: "ONCHAIN",
    status: ruleStatus("kyc"),
    reasonCode: ruleStatus("kyc") === "fail" ? "BLCK01" : undefined
  });
  push({
    key: "sanctions",
    label: "Sanctions",
    detail: ruleStatus("sanctions") === "fail" ? "Standing revoked — sanctions hit (AML02)" : "Screening clear",
    tier: "ONCHAIN",
    status: ruleStatus("sanctions"),
    reasonCode: ruleStatus("sanctions") === "fail" ? "AML02" : undefined
  });
  push({
    key: "freeze",
    label: "Freeze",
    detail: ruleStatus("freeze") === "fail" ? `Frozen party: ${frozenFrom ? REF(c.from) : REF(c.to)}` : "No frozen party or holding",
    tier: "ONCHAIN",
    status: ruleStatus("freeze"),
    reasonCode: ruleStatus("freeze") === "fail" ? "FRZ06" : undefined
  });
  push({
    key: "binding",
    label: "Wallet→BIC binding",
    detail:
      ruleStatus("binding") === "fail"
        ? `Binding revoked for ${deadBindingRef} — institution offboarded / credential revoked. Sticky: survives re-screen until a governed re-bind.`
        : `Live binding · ${REF(c.from)} e${Number(fromBinding.bindingEpoch)} · ${REF(c.to)} e${Number(toBinding.bindingEpoch)}`,
    tier: "ONCHAIN",
    status: ruleStatus("binding"),
    reasonCode: ruleStatus("binding") === "fail" ? "BND13" : undefined
  });
  push({
    key: "jurisdiction",
    label: "Jurisdiction",
    detail:
      ruleStatus("jurisdiction") === "fail"
        ? `Destination ${toCountry} not in the jurisdiction matrix`
        : jurRule?.maxAmount || jurRule?.requireEdd
          ? `${toCountry} permitted · ${jurRule?.maxAmount ? `cap €${fmt(Number(jurRule.maxAmount))}` : "no cap"}${jurRule?.requireEdd ? " · EDD required" : ""}`
          : `Destination ${toCountry} permitted`,
    tier: "ONCHAIN",
    status: ruleStatus("jurisdiction"),
    reasonCode: ruleStatus("jurisdiction") === "fail" ? c.decision.reasonCode : undefined
  });
  if (ACTIVE.has("counterparty")) {
    push({
      key: "counterparty",
      label: "Counterparty class",
      detail:
        ruleStatus("counterparty") === "fail"
          ? `Recipient category ${toCategory} not permitted`
          : catRule?.maxAmount || catRule?.requireEdd
            ? `${toCategory} permitted · ${catRule?.maxAmount ? `cap €${fmt(Number(catRule.maxAmount))}` : "no cap"}${catRule?.requireEdd ? " · EDD required" : ""}`
            : `Recipient ${toCategory} permitted`,
      tier: "ONCHAIN",
      status: ruleStatus("counterparty"),
      reasonCode: ruleStatus("counterparty") === "fail" ? c.decision.reasonCode : undefined
    });
  }
  if (ACTIVE.has("lockup")) {
    push({key: "lockup", label: "Lockup", detail: ruleStatus("lockup") === "fail" ? "Lock-up window not elapsed" : "No lockup restriction in force", tier: "ONCHAIN", status: ruleStatus("lockup"), reasonCode: ruleStatus("lockup") === "fail" ? "LCK04" : undefined});
  }
  if (ACTIVE.has("holderCap")) {
    push({
      key: "holderCap",
      label: "Holder cap",
      detail: ruleStatus("holderCap") === "fail" ? `Holder cap reached: ${holderCount}/${MAX_HOLDERS}, ${REF(c.to)} is a new holder` : `Holders ${holderCount}/${MAX_HOLDERS} · ${REF(c.to)} within cap`,
      tier: "ONCHAIN",
      status: ruleStatus("holderCap"),
      reasonCode: ruleStatus("holderCap") === "fail" ? "CAP05" : undefined
    });
  }
  push({
    key: "transferLimit",
    label: "Tiered limit",
    detail: band
      ? `€${fmt(amt)} → ${band.action} band${band.upTo ? ` (≤ €${fmt(Number(band.upTo))})` : " (top band)"}${band.label ? ` · ${band.label}` : ""}`
      : `€${fmt(amt)}`,
    tier: "ONCHAIN",
    status: ruleStatus("transferLimit"),
    reasonCode: ruleStatus("transferLimit") === "fail" ? c.decision.reasonCode : undefined
  });
  if (ACTIVE.has("velocity") && velocity) {
    const capN = Number(velocity.cap);
    push({
      key: "velocity",
      label: "Velocity",
      detail:
        ruleStatus("velocity") === "fail"
          ? `€${fmt(velSpent)} + €${fmt(amt)} exceeds €${fmt(capN)} / ${velocity.windowLabel ?? "window"}`
          : `€${fmt(velSpent)} of €${fmt(capN)} used this ${velocity.windowLabel ?? "window"} · €${fmt(amt)} fits`,
      tier: "ONCHAIN",
      status: ruleStatus("velocity"),
      reasonCode: ruleStatus("velocity") === "fail" ? "VEL11" : undefined
    });
  }
  {
    const st = ruleStatus("edd");
    const eddDetail =
      st === "review"
        ? "Policy requires enhanced due diligence — held pending an enhanced (3-of-3) approval"
        : st === "skip"
          ? "Not reached — denied earlier"
          : c.eddPresented
            ? "Enhanced (3-of-3) EDD attestation presented — review cleared"
            : "No enhanced review required for this transfer";
    push({key: "edd", label: "EDD gate", detail: eddDetail, tier: "ONCHAIN", status: st, reasonCode: st === "review" ? "EDD10" : undefined});
  }
  push({
    key: "settlement",
    label: "Settlement",
    detail: c.settled
      ? c.asset === "ledger"
        ? "Enforced & consumed on-chain · projected to external book-entry ledger (off-EVM)"
        : "On-chain transfer executed · holder registered"
      : isReview
        ? "Held — awaiting enhanced (EDD) approval"
        : "Skipped — decision blocked before settlement",
    tier: c.asset === "ledger" ? "HYBRID" : "ONCHAIN",
    status: c.settled ? "pass" : "skip"
  });

  return {steps, freshness: {clearanceEpoch: stampedEpoch || floorEpoch, listFloor: floorEpoch}};
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const screenOne = async (wallet: string): Promise<boolean> => (await postScreen(wallet, wallet)) === "hit";

export const runDifferentialRescreen = async (): Promise<{flagged: number; cleared: number; errored: number}> => {
  const parties = allWallets().filter((w) => w.bic);
  const listEpoch = Number(await read.listRegistry.listEpoch());
  hub.emit("RESCREEN_START", `Re-screening ${parties.length} parties against the updated sanctions list.`, {count: parties.length, listEpoch});
  let flagged = 0;
  let cleared = 0;
  let errored = 0;
  for (const w of parties) {
    await sleep(500);
    let hit: boolean;
    try {
      hit = await screenOne(w.address);
    } catch {
      errored++;
      hub.emit("RESCREEN_PARTY", `${REF(w.role)} could not be screened — screening service unavailable. Standing left unchanged (fail closed).`, {role: w.role, result: "error"});
      continue;
    }
    if (hit) {
      await publishStandingClaim(w.role, true);
      await revokeClaim(w.address, "AML02");
      flagged++;
      hub.emit("RESCREEN_PARTY", `${REF(w.role)} matched the updated list. Standing revoked (reason AML02).`, {role: w.role, result: "flagged"});
    } else {
      await publishStandingClaim(w.role, true);
      cleared++;
      hub.emit("RESCREEN_PARTY", `${REF(w.role)} cleared. Standing refreshed at epoch ${listEpoch}.`, {role: w.role, result: "cleared"});
    }
  }
  const tail = errored > 0 ? `, ${errored} could not be screened (left unchanged)` : "";
  hub.emit("RESCREEN_DONE", `Re-screening complete. ${cleared} cleared, ${flagged} flagged${tail}.`, {cleared, flagged, errored, listEpoch});
  return {flagged, cleared, errored};
};

export const advanceListEpoch = async (): Promise<{ok: boolean; listEpoch: number; gasUsed: number; txHash: string}> => {
  await fetch(`${SERVICE_URLS.screening}/list/update`, {method: "POST"}).catch(() => undefined);
  const tx = await asOrchestrator.listRegistry.advanceListEpoch();
  const receipt = await tx.wait();
  const listEpoch = Number(await read.listRegistry.listEpoch());
  hub.emit(
    "LIST_EPOCH",
    `Sanctions list advanced to epoch ${listEpoch}. A single on-chain write invalidated all prior clearances (gas ${Number(receipt!.gasUsed).toLocaleString()}). Re-screening dispatched.`,
    {listEpoch, gasUsed: Number(receipt!.gasUsed)}
  );
  void runDifferentialRescreen().catch(() => undefined);
  return {ok: true, listEpoch, gasUsed: Number(receipt!.gasUsed), txHash: receipt!.hash};
};

export const setAssetClassAct = async (cls: AssetClass): Promise<{ok: boolean; assetClass: AssetClass}> => {
  setAssetClass(cls);
  hub.emit("ASSET_CLASS", `Asset class set to ${cls.toUpperCase()}. Rule set updated; the control engine is unchanged.`, {assetClass: cls});
  return {ok: true, assetClass: cls};
};

export const freezeParty = async (role: string): Promise<{ok: true; role: string; frozen: true}> => {
  const w = walletOf(role);
  const tx = await asOperator.freezeRegistry.freeze(w.address);
  await tx.wait();
  hub.emit("FREEZE", `${REF(role)} frozen. Transfers involving this party are now denied (reason FRZ06).`, {role, frozen: true});
  return {ok: true as const, role, frozen: true as const};
};

export const unfreezeParty = async (role: string): Promise<{ok: true; role: string; frozen: false}> => {
  const w = walletOf(role);
  const tx = await asOperator.freezeRegistry.release(w.address);
  await tx.wait();
  hub.emit("FREEZE", `${REF(role)} unfrozen. Freeze restriction lifted.`, {role, frozen: false});
  return {ok: true as const, role, frozen: false as const};
};

export const offboardInstitution = async (role: string): Promise<{ok: true; role: string; bindingRevoked: true}> => {
  const w = walletOf(role);
  await (await asOrchestrator.claimCache.revokeBinding(w.address, encodeBytes32String("BND13"))).wait();
  await fetch(`${SERVICE_URLS.registry}/binding/${w.address}`, {method: "DELETE"}).catch(() => undefined);
  hub.emit(
    "BINDING",
    `${REF(role)} offboarded — wallet→BIC binding revoked (BND13). Sticky: a re-screen cannot resurrect it; a governed re-bind is required.`,
    {role, bindingRevoked: true}
  );
  return {ok: true as const, role, bindingRevoked: true as const};
};

export const rebindInstitution = async (role: string): Promise<{ok: true; role: string; bindingEpoch: number}> => {
  const w = walletOf(role);
  const current = await read.claimCache.binding(w.address);
  const next = Number(current.bindingEpoch) + 1;
  await (await asOrchestrator.claimCache.rebind(w.address, next)).wait();
  await registerBinding(role);
  await publishStandingClaim(role, true);
  hub.emit(
    "BINDING",
    `${REF(role)} re-bound — institution re-signed the wallet→BIC binding at epoch ${next}. Standing restored.`,
    {role, bindingEpoch: next}
  );
  return {ok: true as const, role, bindingEpoch: next};
};

export const reset = async (): Promise<void> => {
  setAssetClass("bond");
  clearPolicyOverride();
  for (const w of allWallets()) {
    if (await read.freezeRegistry.isFrozen(w.address)) {
      await (await asOperator.freezeRegistry.release(w.address)).wait();
    }
    await fetch(`${SERVICE_URLS.screening}/list/remove`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({wallet: w.address, name: w.name ?? w.ref})
    }).catch(() => undefined);
    if (w.bic) {
      const jur = jurisdictionToBytes32(w.jurisdiction);
      await setJurisdictionAll(w.address, jur);
      const bindingState = await read.claimCache.binding(w.address);
      if (bindingState.revoked) {
        await (await asOrchestrator.claimCache.rebind(w.address, Number(bindingState.bindingEpoch) + 1)).wait();
      }
      await registerBinding(w.role);
      await publishStandingClaim(w.role, true);
    }
  }
};
