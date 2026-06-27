// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title Rules
/// @notice Shared rule identifiers and ISO 20022 aligned reason codes used across
///         the PAP (policy storage) and the PDP (decision logic). Keeping these in
///         one place ensures policy data and decision logic never drift.
library Rules {
    uint16 internal constant KYC = 1 << 0;
    uint16 internal constant SANCTIONS = 1 << 1;
    uint16 internal constant JURISDICTION = 1 << 2;
    uint16 internal constant LOCKUP = 1 << 3;
    uint16 internal constant HOLDER_CAP = 1 << 4;
    uint16 internal constant FREEZE = 1 << 5;
    uint16 internal constant TRANSFER_LIMIT = 1 << 6;
    uint16 internal constant VELOCITY = 1 << 7;
    uint16 internal constant COUNTERPARTY = 1 << 8;

    bytes32 internal constant OK = "OK00";
    bytes32 internal constant DENY_KYC = "BLCK01";
    bytes32 internal constant DENY_SANCTIONS = "AML02";
    bytes32 internal constant DENY_JURISDICTION = "JUR03";
    bytes32 internal constant DENY_LOCKUP = "LCK04";
    bytes32 internal constant DENY_HOLDER_CAP = "CAP05";
    bytes32 internal constant DENY_FREEZE = "FRZ06";
    bytes32 internal constant DENY_TRANSFER_LIMIT = "LIM07";
    bytes32 internal constant DENY_STALE_LIST = "STL08";
    bytes32 internal constant DENY_STALE_REGISTRY = "REG09";
    bytes32 internal constant REVIEW_EDD = "EDD10";
    bytes32 internal constant DENY_VELOCITY = "VEL11";
    bytes32 internal constant DENY_COUNTERPARTY = "CTP12";
    bytes32 internal constant DENY_JURISDICTION_LIMIT = "LIM14";
    bytes32 internal constant DENY_COUNTERPARTY_LIMIT = "LIM15";
    bytes32 internal constant DENY_BAND_LIMIT = "LIM16";
    bytes32 internal constant DENY_BINDING_REVOKED = "BND13";

    uint8 internal constant ACTION_DENY = 0;
    uint8 internal constant ACTION_ALLOW = 1;
    uint8 internal constant ACTION_REVIEW = 2;
}
