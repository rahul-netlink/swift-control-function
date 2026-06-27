// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Administered} from "./Administered.sol";

/// @title ListRegistry
/// @notice PIP — the on-chain projection of the off-chain Sanctions List Monitor and
///         KYC Registry epochs. It holds two monotonically increasing counters that
///         double as freshness floors:
///
///         - listEpoch     : the current sanctions-list epoch. A clearance "screened
///                           clear" is stamped with the epoch in force at screening
///                           time. advanceListEpoch() bumps the counter, so every
///                           previously-stamped clear is now below the floor and must
///                           be re-screened. One write invalidates every stale
///                           clearance on the network — no expiry timer, no per-party
///                           message (invariant I3).
///         - registryEpoch : the analogous floor for KYC-registry standing.
///
///         This is deliberately tiny: the expensive part (deciding clear/hit) happens
///         off-chain in the Screening service; the contract only anchors the epoch a
///         decision must meet, so the floor check is a single SLOAD on the hot path.
contract ListRegistry is Administered {
    uint64 public listEpoch;
    uint64 public registryEpoch;

    mapping(address => bool) public isOperator;

    event ListEpochAdvanced(uint64 indexed newEpoch, address operator);
    event RegistryEpochAdvanced(uint64 indexed newEpoch, address operator);
    event OperatorSet(address indexed operator, bool allowed);

    error NotOperator();

    constructor(address admin_) Administered(admin_) {
        listEpoch = 1;
        registryEpoch = 1;
    }

    modifier onlyOperator() {
        if (!isOperator[msg.sender]) revert NotOperator();
        _;
    }

    function setOperator(address operator, bool allowed) external onlyAdmin {
        isOperator[operator] = allowed;
        emit OperatorSet(operator, allowed);
    }

    /// @notice Raise the sanctions-list floor. Fired by the Sanctions List Monitor the
    ///         instant the list changes. Returns the new epoch for convenience.
    function advanceListEpoch() external onlyOperator returns (uint64) {
        listEpoch += 1;
        emit ListEpochAdvanced(listEpoch, msg.sender);
        return listEpoch;
    }

    /// @notice Raise the KYC-registry floor (e.g. a registry-wide re-vet event).
    function advanceRegistryEpoch() external onlyOperator returns (uint64) {
        registryEpoch += 1;
        emit RegistryEpochAdvanced(registryEpoch, msg.sender);
        return registryEpoch;
    }

    /// @notice True when a clear stamped at `epoch` still meets the live list floor.
    function listFresh(uint64 epoch) external view returns (bool) {
        return epoch >= listEpoch;
    }

    /// @notice True when a claim stamped at `epoch` still meets the live registry floor.
    function registryFresh(uint64 epoch) external view returns (bool) {
        return epoch >= registryEpoch;
    }
}
