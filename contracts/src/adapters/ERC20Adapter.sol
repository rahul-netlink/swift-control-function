// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ControlAdapter} from "./ControlAdapter.sol";
import {IControlFunction, ControlRequest, Decision} from "../IControlFunction.sol";
import {DemoERC20} from "../mocks/DemoERC20.sol";

/// @title ERC20Adapter
/// @notice PEP wrapping a plain ERC-20. It gates the transfer through the control
///         function, reverts on a deny, then delegates the value movement. Evidence
///         carries the cold-path SWIFT attestation; an empty blob takes the hot path.
contract ERC20Adapter is ControlAdapter {
    DemoERC20 public immutable token;

    event TransferControlled(address indexed from, address indexed to, uint256 amount, bytes32 reasonCode);

    error ControlDenied(bytes32 reasonCode);

    constructor(
        address admin_,
        IControlFunction controlFunction_,
        DemoERC20 token_,
        bytes32 assetId_,
        bytes32 policyId_
    ) ControlAdapter(admin_, controlFunction_, assetId_, policyId_) {
        token = token_;
    }

    /// @notice Compliance-gated transfer. Caller must have approved this adapter.
    function transfer(address to, uint256 amount, bytes calldata evidence) external returns (Decision memory) {
        ControlRequest memory req = _buildRequest(OP_TRANSFER, msg.sender, to, amount);
        Decision memory decision = controlFunction.evaluateAndConsume(req, evidence);
        if (!decision.allowed) revert ControlDenied(decision.reasonCode);

        emit TransferControlled(msg.sender, to, amount, decision.reasonCode);
        require(token.transferFrom(msg.sender, to, amount), "transfer failed");
        return decision;
    }
}
