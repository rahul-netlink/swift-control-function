// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ControlAdapter} from "./ControlAdapter.sol";
import {IControlFunction, ControlRequest} from "../IControlFunction.sol";
import {ICompliance} from "../mocks/DemoPermissionedToken.sol";

/// @title PermissionedTokenAdapter
/// @notice PEP exposing an ERC-3643-style canTransfer that routes to the SAME control
///         function instance as ERC20Adapter. The token type differs; the decision
///         component does not. canTransfer is a view gate on the hot path (cached
///         claims); cold-path attestations are submitted through evidence-bearing
///         flows on the value-moving adapters.
contract PermissionedTokenAdapter is ControlAdapter, ICompliance {
    event TransferScreened(address indexed from, address indexed to, uint256 amount, bool allowed, bytes32 reasonCode);

    constructor(address admin_, IControlFunction controlFunction_, bytes32 assetId_, bytes32 policyId_)
        ControlAdapter(admin_, controlFunction_, assetId_, policyId_)
    {}

    /// @inheritdoc ICompliance
    function canTransfer(address from, address to, uint256 amount) external view returns (bool) {
        ControlRequest memory req = _buildRequest(OP_TRANSFER, from, to, amount);
        return controlFunction.evaluate(req, "").allowed;
    }
}
