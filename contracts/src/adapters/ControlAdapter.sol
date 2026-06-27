// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IControlFunction, ControlRequest, Decision} from "../IControlFunction.sol";
import {Administered} from "../Administered.sol";

/// @title ControlAdapter
/// @notice Base for every PEP (Policy Enforcement Point). It assembles the canonical
///         ControlRequest the same way for every asset, so an ERC-20 and an
///         ERC-3643 token submit byte-identical requests and therefore receive
///         byte-identical decisions. Jurisdiction resolution is a small embedded PIP.
abstract contract ControlAdapter is Administered {
    bytes32 internal constant OP_TRANSFER = keccak256("TRANSFER");

    IControlFunction public immutable controlFunction;
    bytes32 public immutable assetId;
    bytes32 public immutable policyId;

    mapping(address => bytes32) public jurisdictionOf;

    event JurisdictionSet(address indexed account, bytes32 jurisdiction);

    constructor(address admin_, IControlFunction controlFunction_, bytes32 assetId_, bytes32 policyId_)
        Administered(admin_)
    {
        controlFunction = controlFunction_;
        assetId = assetId_;
        policyId = policyId_;
    }

    function setJurisdiction(address account, bytes32 jurisdiction) external onlyAdmin {
        jurisdictionOf[account] = jurisdiction;
        emit JurisdictionSet(account, jurisdiction);
    }

    /// @notice Decision query used by the conformance proof: forwards a fully-formed
    ///         request to the shared PDP unchanged.
    function screen(ControlRequest calldata req, bytes calldata evidence) external view returns (Decision memory) {
        return controlFunction.evaluate(req, evidence);
    }

    function _buildRequest(bytes32 operation, address from, address to, uint256 amount)
        internal
        view
        returns (ControlRequest memory)
    {
        return ControlRequest({
            assetId: assetId,
            operation: operation,
            from: from,
            to: to,
            amount: amount,
            context: abi.encode(policyId, jurisdictionOf[to])
        });
    }
}
