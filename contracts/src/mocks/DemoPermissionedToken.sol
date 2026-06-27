// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {DemoToken} from "./DemoToken.sol";

/// @notice ERC-3643-style compliance hook. The permissioned token defers its transfer
///         gate to whatever module implements this; here that module routes to the
///         shared control function.
interface ICompliance {
    function canTransfer(address from, address to, uint256 amount) external view returns (bool);
}

/// @title DemoPermissionedToken
/// @notice Minimal ERC-3643-shaped security token. Unlike DemoERC20 it has a built-in
///         compliance gate, yet it reaches the very same decision component, proving
///         the control function is asset-agnostic.
contract DemoPermissionedToken is DemoToken {
    ICompliance public compliance;

    error TransferNotCompliant();

    constructor(string memory name_, string memory symbol_, ICompliance compliance_) DemoToken(name_, symbol_) {
        compliance = compliance_;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (!compliance.canTransfer(msg.sender, to, amount)) revert TransferNotCompliant();
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (!compliance.canTransfer(from, to, amount)) revert TransferNotCompliant();
        _spendAllowance(from, amount);
        _transfer(from, to, amount);
        return true;
    }
}
