// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {DemoToken} from "./DemoToken.sol";

/// @title DemoERC20
/// @notice Minimal ERC-20 standing in for a plain fungible asset. Control is enforced
///         externally by ERC20Adapter, demonstrating that the control function governs
///         a token that has no compliance logic of its own.
contract DemoERC20 is DemoToken {
    constructor(string memory name_, string memory symbol_) DemoToken(name_, symbol_) {}

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendAllowance(from, amount);
        _transfer(from, to, amount);
        return true;
    }
}
