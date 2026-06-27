export const SCOPE_PARTY_STANDING = 0;
export const SCOPE_OPERATION_BOUND = 1;

export interface ControlRequest {
  assetId: string;
  operation: string;
  from: string;
  to: string;
  amount: bigint;
  context: string;
}

export interface Attestation {
  assetId: string;
  policyVersion: string;
  scope: number;
  subject: string;
  allowed: boolean;
  reasonCode: string;
  notBefore: number;
  validUntil: number;
  listEpoch: number;
  registryEpoch: number;
  edd: boolean;
  nonce: bigint;
}

export type Outcome = "DENY" | "ALLOW" | "REVIEW";
export const OUTCOME: Record<number, Outcome> = {0: "DENY", 1: "ALLOW", 2: "REVIEW"};

export interface Decision {
  outcome: Outcome;
  allowed: boolean;
  reasonCode: string;
  reasonText: string;
  validUntil: number;
}

export const REASON_TEXT: Record<string, string> = {
  OK00: "Permitted",
  BLCK01: "No KYC / wallet→BIC binding (deny by default)",
  AML02: "Sanctions hit — screening not clear",
  JUR03: "Destination jurisdiction not allowed",
  LCK04: "Lock-up period not elapsed",
  CAP05: "Holder cap reached",
  FRZ06: "Party or holding is frozen",
  LIM07: "Transfer exceeds the applicable notional limit",
  LIM14: "Transfer exceeds the destination-jurisdiction notional cap",
  LIM15: "Transfer exceeds the recipient-category notional cap",
  LIM16: "Transfer exceeds the tiered notional band cap",
  STL08: "Sanctions-list epoch below floor — re-screen forced",
  REG09: "KYC-registry epoch below floor — re-vet forced",
  EDD10: "Held for enhanced due diligence — enhanced approval required",
  VEL11: "Rolling-window velocity cap exceeded",
  CTP12: "Counterparty category not permitted",
  BND13: "Wallet→BIC binding revoked — re-bind required (sticky, survives re-screen)"
};

export const reasonText = (code: string): string => REASON_TEXT[code] ?? code;
export const isoStatus = (allowed: boolean): "ACSC" | "RJCT" => (allowed ? "ACSC" : "RJCT");
