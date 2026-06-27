export const CONTROL_REQUEST_TUPLE =
  "(bytes32 assetId, bytes32 operation, address from, address to, uint256 amount, bytes context)";
export const DECISION_TUPLE =
  "(uint8 outcome, bool allowed, bytes32 reasonCode, uint64 validUntil, bytes32 evidenceHash)";
export const ATTESTATION_TUPLE =
  "(bytes32 assetId, bytes32 policyVersion, uint8 scope, bytes32 subject, bool allowed, bytes32 reasonCode, uint64 notBefore, uint64 validUntil, uint64 listEpoch, uint64 registryEpoch, bool edd, uint256 nonce)";

export const CONTROL_FUNCTION_ABI = [
  `function evaluate(${CONTROL_REQUEST_TUPLE} req, bytes evidence) view returns (${DECISION_TUPLE})`,
  `function evaluateAndConsume(${CONTROL_REQUEST_TUPLE} req, bytes evidence) returns (${DECISION_TUPLE})`,
  `function canonicalRequestHash(${CONTROL_REQUEST_TUPLE} req) pure returns (bytes32)`,
  "event ControlDecisionLogged(bytes32 indexed assetId, bytes32 operation, bool allowed, bytes32 reasonCode, bytes32 policyVersion, bytes32 evidenceHash)"
];

export const CLAIM_CACHE_ABI = [
  "function publishClaim(address wallet, bytes11 bic, bytes32 registryRef, uint64 validUntil, uint64 listEpoch, uint64 registryEpoch, bytes32 category)",
  "function revokeClaim(address wallet, bytes32 reason)",
  "function revokeBinding(address wallet, bytes32 reason)",
  "function rebind(address wallet, uint64 newBindingEpoch)",
  "function binding(address wallet) view returns (bool revoked, uint64 bindingEpoch, bytes32 reason)",
  "function getClaim(address wallet) view returns ((bool exists, bool revoked, bytes11 bic, bytes32 registryRef, uint64 validUntil, uint64 listEpoch, uint64 registryEpoch, bytes32 revocationReason, bytes32 category))",
  "event ClaimPublished(address indexed wallet, bytes11 bic, uint64 validUntil, uint64 listEpoch, uint64 registryEpoch)",
  "event ClaimRevoked(address indexed wallet, bytes32 reason)",
  "event BindingPublished(address indexed wallet, uint64 bindingEpoch)",
  "event BindingRevoked(address indexed wallet, bytes32 reason)"
];

export const RULE_REGISTRY_ABI = [
  "function policy(bytes32 policyId) view returns ((bool exists, bytes32 version, uint64 lockupEnd, uint32 maxHolders, uint16 ruleMask, uint64 velocityWindow, uint256 velocityCap))",
  "function getBands(bytes32 policyId) view returns ((uint256 threshold, uint8 action)[])",
  "function bandAction(bytes32 policyId, uint256 amount) view returns (uint8)",
  "function jurisdictionRule(bytes32 policyId, bytes32 jurisdiction) view returns ((bool configured, bool allowed, uint256 maxAmount, bool requireEdd))",
  "function categoryRule(bytes32 policyId, bytes32 category) view returns ((bool configured, bool allowed, uint256 maxAmount, bool requireEdd))",
  "function upsertPolicy(bytes32 policyId, bytes32 version, uint64 lockupEnd, uint32 maxHolders, uint16 ruleMask, uint64 velocityWindow, uint256 velocityCap)",
  "function setBands(bytes32 policyId, uint256[] thresholds, uint8[] actions)",
  "function setJurisdictionRule(bytes32 policyId, bytes32 jurisdiction, bool allowed, uint256 maxAmount, bool requireEdd)",
  "function setCategoryRule(bytes32 policyId, bytes32 category, bool allowed, uint256 maxAmount, bool requireEdd)",
  "event PolicyUpserted(bytes32 indexed policyId, bytes32 version, uint16 ruleMask)"
];

export const VELOCITY_REGISTRY_ABI = [
  "function spent(bytes32 assetId, address party, uint64 window, uint64 nowTs) view returns (uint256)",
  "function wouldExceed(bytes32 assetId, address party, uint256 amount, uint64 window, uint256 cap, uint64 nowTs) view returns (bool)",
  "event VelocityRecorded(bytes32 indexed assetId, address indexed party, uint256 amount, uint256 windowSpent)"
];

export const LIST_REGISTRY_ABI = [
  "function listEpoch() view returns (uint64)",
  "function registryEpoch() view returns (uint64)",
  "function advanceListEpoch() returns (uint64)",
  "function advanceRegistryEpoch() returns (uint64)",
  "function listFresh(uint64 epoch) view returns (bool)",
  "function registryFresh(uint64 epoch) view returns (bool)",
  "event ListEpochAdvanced(uint64 indexed newEpoch, address operator)",
  "event RegistryEpochAdvanced(uint64 indexed newEpoch, address operator)"
];

export const FREEZE_REGISTRY_ABI = [
  "function freeze(address target)",
  "function release(address target)",
  "function isFrozen(address account) view returns (bool)",
  "function registerHolder(bytes32 assetId, address holder)",
  "function holderCount(bytes32 assetId) view returns (uint256)",
  "function isHolder(bytes32 assetId, address holder) view returns (bool)",
  "function canAcquire(bytes32 assetId, address holder, uint32 maxHolders) view returns (bool)",
  "event FreezeApplied(address indexed target, bytes32 scope, address operator, uint64 ts)",
  "event FreezeReleased(address indexed target, bytes32 scope, address operator, uint64 ts)"
];

export const ERC20_ADAPTER_ABI = [
  `function transfer(address to, uint256 amount, bytes evidence) returns (${DECISION_TUPLE})`,
  `function screen(${CONTROL_REQUEST_TUPLE} req, bytes evidence) view returns (${DECISION_TUPLE})`,
  "function setJurisdiction(address account, bytes32 jurisdiction)",
  "event TransferControlled(address indexed from, address indexed to, uint256 amount, bytes32 reasonCode)",
  "error ControlDenied(bytes32 reasonCode)"
];

export const PERMISSIONED_ADAPTER_ABI = [
  `function screen(${CONTROL_REQUEST_TUPLE} req, bytes evidence) view returns (${DECISION_TUPLE})`,
  `function decide(address from, address to, uint256 amount) view returns (${DECISION_TUPLE})`,
  "function canTransfer(address from, address to, uint256 amount) view returns (bool)",
  "function setJurisdiction(address account, bytes32 jurisdiction)"
];

export const EXTERNAL_LEDGER_ADAPTER_ABI = [
  `function screen(${CONTROL_REQUEST_TUPLE} req, bytes evidence) view returns (${DECISION_TUPLE})`,
  `function project(address from, address to, uint256 amount, bytes evidence) returns (${DECISION_TUPLE})`,
  "function setJurisdiction(address account, bytes32 jurisdiction)",
  "event ProjectedDecision(bytes32 indexed assetId, address indexed from, address indexed to, bool allowed, bytes32 reasonCode)"
];

export const ERC20_ABI = [
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

export const VERIFIER_ABI = [
  `function hashAttestation(${ATTESTATION_TUPLE} att) view returns (bytes32)`,
  "function isNonceUsed(uint256 nonce) view returns (bool)"
];
