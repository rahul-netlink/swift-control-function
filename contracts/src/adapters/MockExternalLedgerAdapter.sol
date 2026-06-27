// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ControlAdapter} from "./ControlAdapter.sol";
import {IControlFunction, ControlRequest, Decision} from "../IControlFunction.sol";

/// @title MockExternalLedgerAdapter
/// @notice PEP standing in for a projection onto a non-EVM ledger reached via the
///         SWIFT connector. It takes the same ControlRequest, asks the same PDP, and
///         records the decision as if relaying it off-EVM — demonstrating one control
///         function governing an off-chain venue without re-implementing policy.
contract MockExternalLedgerAdapter is ControlAdapter {
    event ProjectedDecision(
        bytes32 indexed assetId, address indexed from, address indexed to, bool allowed, bytes32 reasonCode
    );

    constructor(address admin_, IControlFunction controlFunction_, bytes32 assetId_, bytes32 policyId_)
        ControlAdapter(admin_, controlFunction_, assetId_, policyId_)
    {}

    /// @notice Evaluate and emit a relayed decision for an off-EVM settlement leg.
    function project(address from, address to, uint256 amount, bytes calldata evidence)
        external
        returns (Decision memory decision)
    {
        ControlRequest memory req = _buildRequest(OP_TRANSFER, from, to, amount);
        decision = controlFunction.evaluate(req, evidence);
        emit ProjectedDecision(assetId, from, to, decision.allowed, decision.reasonCode);
    }
}
