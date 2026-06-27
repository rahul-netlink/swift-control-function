export type Outcome = "DENY" | "ALLOW" | "REVIEW";

export interface Decision {
  outcome: Outcome;
  allowed: boolean;
  reasonCode: string;
  reasonText: string;
  validUntil: number;
}

export type Asset = "erc20" | "erc3643" | "ledger";
export type AssetClass = "bond" | "deposit" | "equity" | "fund";

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
export type PathChoice = "auto" | "cold" | "hot";

export interface TransferInput {
  from: string;
  to: string;
  amount: string;
  asset: Asset;
  assetClass?: AssetClass;
  path: PathChoice;
  edd?: boolean;
}

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

export interface TransferResult {
  decisionId: string;
  status: "PERMITTED" | "BLOCKED" | "REVIEW";
  decision: Decision;
  request: { fromRef: string; toRef: string; fromName: string; toName: string; amount: string; asset: Asset; assetClass?: AssetClass };
  route: string;
  path: { basis: "COLD" | "HOT"; scope: string; asset: Asset; label: string };
  gas: { control: number; settlement: number; total: number };
  agnosticism: Agnosticism;
  trace: TraceStep[];
  iso20022: { type: string; status: "ACSC" | "RJCT" | "PDNG"; xml: string; filename: string };
  txHash: string | null;
  settled: boolean;
  hashes: { request: string; evidence: string | null; attestation: string | null };
  freshness: { clearanceEpoch: number; listFloor: number };
  validUntil: number;
  quorum: { acks: { id: string; approved: boolean }[]; signer: string } | null;
}

/** A submitted transfer, captured client-side for the Transaction Log. */
export interface LogEntry {
  key: string;
  ts: number;
  result: TransferResult;
  /** When this record was produced by escalating a held transfer, the decisionId it resolved. */
  escalatedFrom?: string;
}

export interface Party {
  role: string;
  ref: string;
  name: string;
  bic: string | null;
  country: string;
  category?: string | null;
  kycValid: boolean;
  sanctioned: boolean;
  frozen: boolean;
  binding: { revoked: boolean; epoch: number; reason: string | null };
  holdings: string;
  isHolder: boolean;
  lockupEnd: string | null;
  claim: {
    exists: boolean;
    revoked: boolean;
    bic: string | null;
    validUntil: number;
    listEpoch?: number;
    registryEpoch?: number;
    revocationReason: string | null;
  };
}

export interface PolicyBand {
  upTo: string | null;
  action: "ALLOW" | "REVIEW" | "DENY";
  label?: string;
  denyReasonCode?: string;
}

export interface PolicyCondition {
  code: string;
  allowed: boolean;
  maxAmount: string | null;
  requireEdd: boolean;
  note?: string;
}

export interface PolicyVelocity {
  window: number;
  windowLabel?: string;
  cap: string;
}

export interface PolicyRule {
  id: string;
  label: string;
  check?: string;
  denyReasonCode?: string;
  reviewReasonCode?: string;
}

export interface Policy {
  policyId: string;
  version: string;
  assetName?: string;
  combination?: string;
  maxHolders: number;
  allowedCountries: string[];
  rules?: PolicyRule[];
  bands?: PolicyBand[];
  jurisdictions?: PolicyCondition[];
  categories?: PolicyCondition[];
  velocity?: PolicyVelocity;
  lockupEnd?: string | null;
  [k: string]: unknown;
}

/** A full ruleset authored in the policy builder and published to the RuleRegistry. */
export interface PublishPolicySpec {
  version: string;
  activeRules: string[];
  maxHolders: number;
  lockupEnd: string | null;
  bands: PolicyBand[];
  jurisdictions: PolicyCondition[];
  categories: PolicyCondition[];
  velocity: PolicyVelocity | null;
}

export interface MonitorStatus {
  provider: string;
  intervalMs: number;
  running: boolean;
  lastPollTs: number | null;
  nextPollTs: number | null;
  lastDelta: { ts: number; action: "add" | "remove"; entity: string; program?: string; listEpoch: number } | null;
  recent: { ts: number; kind: "poll" | "delta"; message: string; listEpoch?: number }[];
}

export interface DemoState {
  chain: "anvil" | "besu";
  addresses: Record<string, string>;
  assetClass?: AssetClass;
  policy: Policy;
  parties: Party[];
  bindings: { wallet: string; bic: string }[];
  sanctions: { listVersion: string; parties: { wallet: string; name?: string }[] };
  holderCount: number;
  epoch?: { list: number; registry: number };
  monitor?: MonitorStatus;
}

export interface StreamEvent {
  ts: number;
  source: string;
  type: string;
  message: string;
  data?: unknown;
}
