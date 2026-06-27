// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @dev Operation under control. Token-type agnostic: the same operation code is
///      interpreted identically regardless of the asset implementation.
struct ControlRequest {
    bytes32 assetId;
    bytes32 operation;
    address from;
    address to;
    uint256 amount;
    bytes context;
}

/// @dev Decision returned by the PDP. Deterministic for a given request and state,
///      which is what makes it byte-identical across adapters (asset agnostic).
///
///      Three-valued outcome. A purely binary permit/deny cannot express the real
///      compliance verb "hold for enhanced due diligence": a transfer that is neither
///      cleared nor refused, but parked until a higher-assurance approval arrives.
///      REVIEW models exactly that. `allowed` is kept as a derived convenience so every
///      PEP keeps its single `if (!decision.allowed) revert` gate unchanged — a REVIEW
///      is not allowed (value never moves) but is distinguished from a hard DENY for
///      reporting, the trace, and the held-transfer queue.
struct Decision {
    uint8 outcome;
    bool allowed;
    bytes32 reasonCode;
    uint64 validUntil;
    bytes32 evidenceHash;
}

uint8 constant OUTCOME_DENY = 0;
uint8 constant OUTCOME_ALLOW = 1;
uint8 constant OUTCOME_REVIEW = 2;

/// @dev Off-chain SWIFT signer commits to this typed payload (EIP-712).
///      The on-chain verifier performs a single ecrecover; the M-of-N threshold
///      that produced the group signature is invisible to the contract.
struct Attestation {
    bytes32 assetId;
    bytes32 policyVersion;
    uint8 scope;
    bytes32 subject;
    bool allowed;
    bytes32 reasonCode;
    uint64 notBefore;
    uint64 validUntil;
    uint64 listEpoch;
    uint64 registryEpoch;
    bool edd;
    uint256 nonce;
}

/// @dev The single new primitive: an institution that holds KYC in the Registry
///      signs an assertion that an on-chain identity is controlled by its BIC.
struct WalletBinding {
    address wallet;
    bytes11 bic;
    bytes32 registryRef;
    uint64 validUntil;
}

uint8 constant SCOPE_PARTY_STANDING = 0;
uint8 constant SCOPE_OPERATION_BOUND = 1;

/// @title IControlFunction
/// @notice Stable interface for the asset-agnostic control function (the PDP).
///         Any PEP (token adapter, ledger projection) calls this at its gating
///         point and obtains an identical Decision for an identical request.
interface IControlFunction {
    /// @notice Pure-ish decision query. MAY read on-chain state (claims, freeze,
    ///         caps); MUST NOT move value or mutate state.
    /// @dev Used by adapters that gate without consuming a one-shot nonce, and by
    ///      the conformance proof to compare decisions byte-for-byte.
    function evaluate(ControlRequest calldata req, bytes calldata evidence)
        external
        view
        returns (Decision memory);

    /// @notice Stateful path used by adapters that must consume an OPERATION_BOUND
    ///         nonce as part of enforcement.
    function evaluateAndConsume(ControlRequest calldata req, bytes calldata evidence)
        external
        returns (Decision memory);
}
